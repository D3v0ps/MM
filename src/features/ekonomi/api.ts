// Kontrakt för området ekonomi (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
//
// Beslut 2026-10-07 (Karim, synpunkt #13 och beslut 3): en faktura per avtal och månad med en rad per ärende. Fakturan
// identifieras med sitt id (invoice_drafts.id – samma id innan den är sparad, src/core/billing.ts invoiceIdOf), raden med
// ärendet och månaden. Beställarreferensen och inköpsordernumret hör till fakturan och fylls i av ekonomen.
// Beslut 5 (2026-10-07): belopp syns bara för rollen ekonom – alla frågor och kommandon här är bara för ekonomen.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import { NAV, LOG, CARD, CASES, MGMT, START, BILLING } from "@/api/invalidation";
import type { BillableWeek, BillingCheckKind, BillingCheckSeverity } from "@/core/billing";
import type { SlaStatus } from "@/core/sla";
import type { LocalDate, LocalDateTime, MonthKey, WeekKey } from "@/core/time";
import type { BillingRunStatus, CaseStatus, InvoiceDisplayStatus, InvoiceStatus } from "@/data/schema";
import { IdSchema, MonthKeySchema, WeekKeySchema } from "../_shared/schemas";
export { FORTNOX_OFF_TEXT } from "../_shared/fortnox-port";
import type { Bucket, CaseMonthStatus, InvoiceSummary, MonthRules, RefInfo, RefRules } from "./model";

/** Fakturans id (inv-<avtal>-<månad>-<grupp>). */
const InvoiceIdSchema = z.string().trim().min(1).max(200).regex(/^inv-[A-Za-z0-9_.:-]+$/);
const AFTER = [BILLING, MGMT, "arenden.lista", CARD, ...START, "coach.minVecka", NAV, ...LOG] as const;

// ---- Kommandon (bara ekonomen)

/** Godkänn en debiterbar vecka utan närvaro för fakturering (prototypens billing.approveZeroWeek). */
export const billingApproveZeroWeek = command("ekonomi.billingApproveZeroWeek", z.object({
  month: MonthKeySchema,
  caseId: IdSchema,
  weekKey: WeekKeySchema,
  note: z.string().max(1000).optional(),
}), { invalidates: [...AFTER] }).returns<Result<object, "not_found">>();

/**
 * Godkänn fakturan (alla rader). Kräver att varje vecka utan närvaro är godkänd. Beställarreferensen kontrolleras när
 * fakturan skapas – en faktura kan godkännas innan referensen är ifylld.
 */
export const billingApproveInvoice = command("ekonomi.billingApproveInvoice", z.object({
  month: MonthKeySchema,
  invoiceId: InvoiceIdSchema,
}), { invalidates: [...AFTER] }).returns<Result<{ lines: number }, "not_found" | "created" | "needs_approval" | "empty">>();

/**
 * Skapa fakturorna i Fortnox och logga körningen. Idempotent: en faktura som redan är skapad (eller manuellt
 * fakturerad) skapas inte igen – nyckeln är avtal:månad:grupp. Beställarreferensen och inköpsordernumret kontrolleras innan
 * en faktura skapas (CLAUDE.md punkt 11): en stoppad faktura hamnar i blocked. En faktura som inte är godkänd tas inte med.
 * Raderna fryses (invoice_lines) när fakturan skapas. Kräver ctx.fortnox (minnesläget: simulerat) – utan port svaret
 * fortnox_off (FORTNOX_OFF_ERROR) och ingenting ändras eller loggas.
 */
export const billingSendFortnox = command("ekonomi.billingSendFortnox", z.object({
  month: MonthKeySchema,
  // Skärmen skickar alla månadens fakturor (en per ärende i reservläget invoicePer "case_and_month": fler än 100).
  invoiceIds: z.array(InvoiceIdSchema).max(1000),
}), { invalidates: [...AFTER] }).returns<Result<{ created: string[]; skipped: string[]; blocked: string[]; notApproved: string[]; runId: string }, "not_found" | "fortnox_off">>();

/** Markera fakturan som manuellt fakturerad med fakturanummer (reservvägen). Referensen krävs också här. Raderna fryses. */
export const billingMarkManual = command("ekonomi.billingMarkManual", z.object({
  month: MonthKeySchema,
  invoiceId: InvoiceIdSchema,
  invoiceNo: z.string().trim().regex(/^\d{3,10}$/),
}), { invalidates: [...AFTER] }).returns<Result<object, "not_found" | "created" | "blocked" | "needs_approval" | "empty">>();

/** Logga en export av fakturaunderlaget (prototypens billing.export). Själva filen byggs av skärmen med useDownload(). */
export const billingExport = command("ekonomi.billingExport", z.object({
  month: MonthKeySchema,
  format: z.enum(["csv", "xlsx", "pdf"]),
}), { invalidates: [BILLING, ...LOG] }).returns<Result<object>>();

/**
 * Fakturans beställarreferens (beslut 3: Miljonbemanning fyller i den, en per faktura). Formatet (8–10 siffror) och kommunens
 * referensregister kontrolleras. Går att ändra tills fakturan är skapad – och på en returnerad faktura innan den görs om.
 */
export const invoiceSetBuyerRef = command("ekonomi.invoiceSetBuyerRef", z.object({
  month: MonthKeySchema,
  invoiceId: InvoiceIdSchema,
  reference: z.string().trim().max(20),
}), { invalidates: [...AFTER] }).returns<Result<object, "not_found" | "created" | "buyer_ref" | "unchanged">>();

/**
 * Fakturans inköpsordernummer: bara kommunens eget ordernummer (Botkyrka: nio siffror som börjar med 99,
 * billing.purchaseOrderNumber). Tom sträng = inget inköpsordernummer. Ärendenummer och andra egna nummer stoppas.
 */
export const invoiceSetPo = command("ekonomi.invoiceSetPo", z.object({
  month: MonthKeySchema,
  invoiceId: InvoiceIdSchema,
  purchaseOrderNumber: z.string().trim().max(20),
}), { invalidates: [...AFTER] }).returns<Result<object, "not_found" | "created" | "po">>();

/**
 * Statushämtning från Fortnox (minnesläget: simulerad – varje hämtning flyttar månadens skapade fakturor ett steg: skapad →
 * bokförd → skickad → betald). Kräver ctx.fortnox – utan port svaret fortnox_off och ingenting ändras.
 */
export const ekoFortnoxSync = command("ekonomi.fortnoxSync", z.object({
  month: MonthKeySchema,
}), { invalidates: [BILLING, NAV, ...LOG] }).returns<Result<{ changed: number }, "fortnox_off">>();

/**
 * Returnerad faktura: kreditera och skapa en ny i Fortnox med rätt beställarreferens. Raderna fryses på nytt från dagens
 * underlag – bara de veckor som fortfarande är debiterbara. reissued false = ingen vecka återstod: fakturan krediterades utan
 * ny faktura. Kräver ctx.fortnox (den nya fakturan får status "Skapad i Fortnox") – utan port svaret fortnox_off.
 */
export const ekoReissue = command("ekonomi.reissue", z.object({
  month: MonthKeySchema,
  invoiceId: InvoiceIdSchema,
}), { invalidates: [BILLING, MGMT, CARD, NAV, ...LOG] }).returns<Result<{ reissued: boolean }, "not_found" | "buyer_ref" | "not_returned" | "fortnox_off">>();

/** Markera en uppgift till ekonomen som klar. */
export const ekoTaskDone = command("ekonomi.taskDone", z.object({
  taskId: IdSchema,
  note: z.string().max(1000).optional(),
}), { invalidates: [BILLING, "inkorg.start", "kommun.start", "kommun.deltagare", "arenden.kortManad", ...LOG] }).returns<Result<object, "not_found">>();

/**
 * Fråga samordnaren om två ärenden som överlappar samma vecka (samma deltagare). Texten byggs av hanteraren och
 * innehåller bara ärendenummer och veckor – inga namn.
 */
export const ekoAskCoordinator = command("ekonomi.askCoordinator", z.object({
  month: MonthKeySchema,
  caseId: IdSchema,
  otherCaseId: IdSchema,
}), { invalidates: [BILLING, "inkorg.start", ...LOG] }).returns<Result<{ taskId: string }, "not_found" | "no_overlap">>();

/** Stäng månadens fakturakörning (alla fakturor är skapade eller manuellt fakturerade). */
export const ekoCloseRun = command("ekonomi.closeRun", z.object({ month: MonthKeySchema }), { invalidates: [BILLING, MGMT, CASES, ...START, "coach.minVecka", NAV, ...LOG] })
  .returns<Result<object, "not_found" | "not_done">>();

// ---- Frågor (bara ekonomen)
// Vy-modellerna innehåller bara det ekonomen behöver: ärendenummer, perioder, avtalsområde, referenser och fakturaunderlag.
// Inga namn, personnummer, anteckningar eller rapporter (ekonomen ser deltagaren som "–"). Alla belopp i öre, tider i
// Stockholms lokala tid. Inget ordervärde (beslut 2026-10-07, synpunkt #11) – bara beställda veckor.

/** Kontroll på en rad eller en faktura. text = texten som visas (datum i läsbar form). approval = godkänd vecka utan närvaro. */
export type InvoiceCheckView = {
  kind: BillingCheckKind;
  severity: BillingCheckSeverity;
  label: string;
  text: string;
  weekKey: WeekKey | null;
  approval: { byName: string; at: LocalDateTime; note: string } | null;
};

/** En rad på fakturan: ett ärende och dess veckor i månaden. */
export type LineRow = {
  caseId: string;
  caseNumber: string;
  areaCode: string | null;
  /** Områdets namn utan kod, t.ex. "Lager och logistik". */
  areaTitle: string;
  /** "G Lager och logistik" */
  areaName: string;
  articleNo: string;
  weeks: BillableWeek[];
  quantity: number;
  unitPriceOre: number;
  amountOre: number;
  vatRate: number;
  checks: InvoiceCheckView[];
  needsApproval: boolean;
  /** Antal anmärkningar (kräver godkännande eller kontrollera). */
  remarks: number;
  /** Raden är fryst (fakturan är skapad). */
  frozen: boolean;
  /** Radtext: "BOT-26-0132 · v. 1, 3–4 2027" */
  lineText: string;
  /** Beställda veckor och upparbetade veckor till och med månaden. */
  orderWeeks: number;
  accruedWeeks: number;
};

/** Förslag till fakturans beställarreferens (människan bekräftar – fylls aldrig i av sig själv). */
export type RefSuggestion = { reference: string; source: string };

/** En faktura i körningen: huvudfakturan för månaden eller en tilläggsfaktura. */
export type InvoiceView = {
  id: string;
  month: MonthKey;
  groupingKey: string;
  /** 1 = månadens faktura, 2… = tilläggsfaktura. */
  number: number;
  /** "Faktura januari 2027" eller "Tilläggsfaktura 2 · december 2026" (eller ärendenumret med en faktura per ärende). */
  title: string;
  status: InvoiceDisplayStatus;
  /** Skapad i Fortnox eller manuellt (också returnerad) – raderna är frysta. */
  created: boolean;
  buyerReference: string | null;
  ref: RefInfo;
  refSuggestions: RefSuggestion[];
  /** Kommunens inköpsordernummer eller tom sträng. poSet = ekonomen har angett det (annars radernas gemensamma). */
  purchaseOrderNumber: string;
  poSet: boolean;
  checks: InvoiceCheckView[];
  blocked: boolean;
  needsApproval: boolean;
  /** Rader med anmärkning (kräver godkännande eller kontrollera). */
  remarks: number;
  bucket: Bucket;
  quantity: number;
  amountOre: number;
  vatOre: number;
  vat: { rate: number; baseOre: number; vatOre: number }[];
  approved: { at: LocalDateTime; byName: string } | null;
  fortnoxNo: string | null;
  manualInvoiceNo: string | null;
  /** Idempotensnyckeln finns redan (fakturan har skickats till Fortnox). */
  hasKey: boolean;
  credit: { at: LocalDateTime; reference: string | null } | null;
  lines: LineRow[];
};

export type SlaView = Pick<SlaStatus, "label" | "tone">;
export type FortnoxRunView = { id: string; at: LocalDateTime; byName: string; created: number; skipped: number; blocked: number };

/** Fakturakörningen för en månad (prototypens eko.korning). month = null: det finns ingen körning ännu. */
export type RunView = {
  month: MonthKey | null;
  canAct: boolean;
  customerName: string;
  contractNumber: string;
  runs: { month: MonthKey; status: BillingRunStatus }[];
  run: { status: BillingRunStatus } | null;
  /** Internt mål för när fakturorna ska vara i Fortnox (bara för en pågående körning). */
  due: { at: LocalDateTime; sla: SlaView; days: number } | null;
  invoices: InvoiceView[];
  /** Antal rader (ärenden), veckor och belopp för hela månaden. */
  count: number;
  totalOre: number;
  weeks: number;
  vatOre: number;
  calendarWeeks: number;
  rules: MonthRules & { perContract: boolean; refLen: string; poText: string };
  fortnoxRuns: FortnoxRunView[];
  /** connected = ctx.fortnox finns (minnesläget: simulerat). Annars döljs "Skapa i Fortnox" och "Hämta status" – manuell fakturering gäller. */
  fortnox: { connected: boolean };
  priceSpan: string | null;
  refRules: RefRules;
};
export const ekoRun = query("ekonomi.run", z.object({ month: MonthKeySchema.optional() })).returns<RunView>();

export type TaskRef = { id: string; fromName: string; createdAt: LocalDateTime; text: string };
export type OverlapView = {
  caseId: string;
  caseNumber: string;
  /** Det andra ärendets rad samma månad: fakturans status, om den finns. */
  status: InvoiceDisplayStatus | null;
  startDate: LocalDate | null;
  endDate: LocalDate | null;
  /** När ekonomen frågade samordnaren om överlappet (null = inte frågat). */
  askedAt: LocalDateTime | null;
};

/** En rad i körningens detaljvy (dialogen när man klickar på en rad). null = ärendet har ingen rad den månaden. */
export type LineDetailView = {
  canAct: boolean;
  month: MonthKey;
  line: LineRow;
  invoice: { id: string; title: string; status: InvoiceDisplayStatus; created: boolean };
  summary: InvoiceSummary;
  /** Per kontroll av typen överlapp (nyckel = kontrollens etikett). */
  overlaps: Record<string, OverlapView>;
};
export const ekoLine = query("ekonomi.line", z.object({ month: MonthKeySchema, caseId: IdSchema })).returns<LineDetailView | null>();

/** Fakturaunderlaget som CSV (reservvägen): en rad per fakturarad med fakturans huvud först. Exporten loggas med billingExport. */
export const ekoCsv = query("ekonomi.csv", z.object({ month: MonthKeySchema })).returns<{ filename: string; csv: string }>();

/** Förhandsvisning av en faktura (prototypens eko.faktura) med alla rader. preview = null: ingen faktura att visa. */
export type InvoicePreviewView = {
  month: MonthKey | null;
  /** Fakturan som visas, och ärendet vars rad är markerad (om sidan öppnades från ett ärende). */
  invoiceId: string | null;
  caseId: string | null;
  caseNumber: string | null;
  /** Månadens fakturor (för att byta mellan huvudfaktura och tilläggsfaktura). */
  invoices: { id: string; title: string; status: InvoiceDisplayStatus }[];
  preview: {
    inv: InvoiceView;
    /** Radernas anmärkning (Peppol BT-127): upparbetat och återstående, per ärende. */
    notes: Record<string, string>;
    /** Fakturatexten (Peppol BT-22). */
    invoiceText: string;
    invoiceDate: LocalDate;
    dueDate: LocalDate;
    paymentTermsDays: number;
    roundingOre: number;
    grossRoundedOre: number;
    period: [LocalDate | null, LocalDate | null];
    refLen: string;
    poText: string;
    supplier: { name: string; orgNr: string; vatNo: string };
    customer: { name: string; orgNr: string; possessive: string; eInvoiceContact: string };
    contractNumber: string;
    dnr: string | null;
  } | null;
};
export const ekoPreview = query("ekonomi.preview", z.object({ month: MonthKeySchema.optional(), invoiceId: InvoiceIdSchema.optional(), caseId: IdSchema.optional() }))
  .returns<InvoicePreviewView>();

export type CaseMonthRow = {
  mk: MonthKey;
  /** Debiterbara veckor (utan pausade) på fakturan. */
  bill: BillableWeek[];
  paused: BillableWeek[];
  qty: number;
  amountOre: number;
  /** Fakturans status, "open" för innevarande eller senare månad (faktureras efter månadsskiftet), annars null. */
  status: CaseMonthStatus;
  /** Fakturan som har raden (för länken till förhandsvisningen), null utan faktura. */
  invoiceId: string | null;
  invoiceTitle: string | null;
  invoiceNo: string | null;
};
export type QtyAmount = { qty: number; amountOre: number };

/** Ärendets fakturaunderlag (prototypens eko.arende). null = ärendet finns inte eller rollen får inte se det. */
export type CaseBillingView = {
  canAct: boolean;
  caseId: string;
  caseNumber: string;
  /** Visningsnamn: alltid "–" för ekonomen (inga namn). */
  name: string;
  areaName: string;
  articleNo: string;
  priceOre: number;
  status: CaseStatus;
  startDate: LocalDate | null;
  endDate: LocalDate | null;
  plannedEnd: LocalDate | null;
  pausedWeeks: WeekKey[];
  /** Ärendets beställarreferens från mottagandet (en anteckning – fakturan har sin egen referens). */
  caseBuyerReference: string | null;
  referredAt: LocalDateTime;
  referrerId: string | null;
  /** Beställda veckor (omfattningen). Inget ordervärde (synpunkt #11). */
  orderWeeks: number;
  accrued: QtyAmount;
  billed: QtyAmount;
  returned: QtyAmount;
  pending: QtyAmount;
  months: CaseMonthRow[];
  weeks: BillableWeek[];
  /** Måndag innevarande vecka (veckor före den utan registrerad närvaro märks "Närvaro saknas"). */
  thisMonday: LocalDate;
};
export const ekoCase = query("ekonomi.case", z.object({ caseId: IdSchema })).returns<CaseBillingView | null>();

export type CasePickRow = { caseId: string; caseNumber: string; areaName: string; startDate: LocalDate | null; status: CaseStatus };
/** Ärenden som har startat (sök på ärendenummer), nyast först. */
export const ekoCaseList = query("ekonomi.caseList", z.object({})).returns<{ canAct: boolean; cases: CasePickRow[] }>();

/**
 * Prislistan som fakturan bygger på (price_items per avtalsområde). Bara för ekonomen (beslut 5, 2026-10-07) – avtalssidan
 * visar den inte längre för systemadministratören.
 */
export type PriceListRow = {
  id: string;
  areaName: string;
  fortnoxArticleNo: string | null;
  unit: string;
  priceOre: number;
  vatRate: number;
  validFrom: LocalDate;
  validTo: LocalDate | null;
};
export type PriceListView = { customerName: string; contractNumber: string; unitText: string; items: PriceListRow[] };
export const ekoPriceList = query("ekonomi.priceList", z.object({})).returns<PriceListView>();

export type TaskCaseView = { caseId: string; caseNumber: string };
export type TaskView = TaskRef & { status: "open" | "done"; cases: TaskCaseView[]; doneAt: LocalDateTime | null; doneByName: string | null };
export type UnbilledRow = { caseId: string; caseNumber: string; status: InvoiceStatus; weeks: BillableWeek[]; age: number; amountOre: number; presc: LocalDate; left: number };
/** En returnerad faktura (och en som krediterats och gjorts om). */
export type ReturnedRow = {
  invoiceId: string;
  month: MonthKey;
  title: string;
  status: InvoiceDisplayStatus;
  lines: number;
  quantity: number;
  amountOre: number;
  caseNumbers: string[];
  buyerReference: string | null;
  refOk: boolean;
  credit: { at: LocalDateTime; reference: string | null } | null;
};
/** En faktura som inte kan skapas eftersom beställarreferensen saknas eller är fel. */
export type RefInvoiceRow = { invoiceId: string; month: MonthKey; title: string; status: InvoiceDisplayStatus; buyerReference: string | null; problem: string; lines: number };
export type ZeroRow = { id: string; month: MonthKey; caseId: string; caseNumber: string; weekKey: WeekKey; planned: number | null; approved: boolean };
export type RunRow = { id: string; month: MonthKey; status: BillingRunStatus; invoices: number; count: number; weeks: number; totalOre: number; entries: [InvoiceDisplayStatus, number][]; todo: number };

/** Ekonomens startsida (prototypens eko.start). */
export type BillingStartView = {
  canAct: boolean;
  customerName: string;
  current: {
    month: MonthKey;
    status: BillingRunStatus;
    totalOre: number;
    /** Antal fakturor och rader (ärenden). */
    invoices: number;
    count: number;
    weeks: number;
    blocked: number;
    due: LocalDateTime;
    /** "Om 2 dagar" */
    dueRelative: string;
    fortnoxDays: number;
    counts: { blocked: number; zeroPending: number; review: number; ready: number };
    stepNow: number;
    perContract: boolean;
  } | null;
  openTasks: number;
  unbilled: { totalOre: number; count: number; limit: number; prescText: string; rows: UnbilledRow[] };
  tasks: TaskView[];
  returned: ReturnedRow[];
  refInvoices: RefInvoiceRow[];
  zero: ZeroRow[];
  runs: RunRow[];
  /** connected = ctx.fortnox finns (minnesläget: simulerat); kortet Fortnox-synk säger annars "inte kopplat". */
  fortnox: { connected: boolean; lastRun: { at: LocalDateTime; created: number; skipped: number } | null; lastSync: { at: LocalDateTime; changed: number } | null };
  priceSpan: string | null;
  refRules: RefRules;
  /** Förslag till referens per faktura (för dialogen "Fyll i referensen"). */
  refSuggestions: Record<string, RefSuggestion[]>;
};
export const ekoStart = query("ekonomi.start", z.object({})).returns<BillingStartView>();
