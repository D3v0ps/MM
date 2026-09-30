// Kontrakt för området ekonomi (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import type { BillableWeek, BillingCheckKind, BillingCheckSeverity } from "@/core/billing";
import type { SlaStatus } from "@/core/sla";
import type { LocalDate, LocalDateTime, MonthKey, WeekKey } from "@/core/time";
import type { BillingRunStatus, CaseStatus, InvoiceDisplayStatus, InvoiceStatus } from "@/data/schema";
import { IdSchema, MonthKeySchema, WeekKeySchema } from "../_shared/schemas";
import type { Bucket, CaseMonthStatus, InvoiceSummary, MonthRules, RefInfo, RefRules } from "./model";

// ---- Delade kommandon (portade från prototypens 03-domain.js)
// Samma beteende som prototypens MM.defineAction. Nyckeln är "ekonomi.<prototypens namn>". Bara ekonomen ändrar.
// Fakturor per ärende och månad identifieras med ärendets id och månaden – inga namn eller personnummer.

/** Godkänn en debiterbar vecka utan närvaro för fakturering (prototypens billing.approveZeroWeek). */
export const billingApproveZeroWeek = command("ekonomi.billingApproveZeroWeek", z.object({
  month: MonthKeySchema,
  caseId: IdSchema,
  weekKey: WeekKeySchema,
  note: z.string().max(1000).optional(),
})).returns<Result<object, "not_found">>();

/** Godkänn fakturor (ett eller flera ärenden) för månaden (prototypens billing.approveInvoice). */
export const billingApproveInvoice = command("ekonomi.billingApproveInvoice", z.object({
  month: MonthKeySchema,
  caseIds: z.array(IdSchema).min(1).max(1000),
})).returns<Result<{ approved: number }, "not_found">>();

/**
 * Skapa fakturor i Fortnox (simulerat) – prototypens billing.sendFortnox. Idempotent: en faktura som redan skapats
 * (eller fakturerats manuellt) skapas inte igen – nyckeln är månad:ärende. Beställarreferensen kontrolleras innan en
 * faktura skapas (CLAUDE.md punkt 11): ärenden med saknad, felaktig eller spärrad referens hamnar i blocked.
 */
export const billingSendFortnox = command("ekonomi.billingSendFortnox", z.object({
  month: MonthKeySchema,
  caseIds: z.array(IdSchema).min(1).max(1000),
})).returns<Result<{ created: string[]; skipped: string[]; blocked: string[] }, "not_found">>();

/** Markera fakturan som manuellt fakturerad med fakturanummer (prototypens billing.markManual). */
export const billingMarkManual = command("ekonomi.billingMarkManual", z.object({
  month: MonthKeySchema,
  caseId: IdSchema,
  invoiceNo: z.string().trim().min(1).max(60),
})).returns<Result<object, "not_found">>();

/** Logga en export av fakturaunderlaget (prototypens billing.export). Själva filen byggs av skärmen med useDownload(). */
export const billingExport = command("ekonomi.billingExport", z.object({
  month: MonthKeySchema,
  format: z.enum(["csv", "xlsx", "pdf"]),
})).returns<Result<object>>();

// ---- Ekonomins skärmar (prototypens eko.start, eko.korning, eko.faktura och eko.arende)
// Vy-modellerna innehåller bara det ekonomen behöver: ärendenummer, perioder, avtalsområde, referenser och fakturaunderlag.
// Inga namn, personnummer, anteckningar eller rapporter (ekonomen ser deltagaren som "–"). Chef/controller läser samma vyer
// i läsläge (canAct = false). Alla belopp i öre, tider i Stockholms lokala tid.

/** Kontroll på en faktura. text = texten som visas (datum i läsbar form). approval = godkänd vecka utan närvaro. */
export type InvoiceCheckView = {
  kind: BillingCheckKind;
  severity: BillingCheckSeverity;
  label: string;
  text: string;
  weekKey: WeekKey | null;
  approval: { byName: string; at: LocalDateTime; note: string } | null;
};

/** En faktura (ett ärende och en månad) i körningen. */
export type InvoiceRow = {
  id: string;
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
  buyerReference: string | null;
  ref: RefInfo;
  /** Kommunens inköpsordernummer (tom sträng om det saknas) – aldrig våra egna nummer. */
  purchaseOrderNumber: string;
  status: InvoiceDisplayStatus;
  blocked: boolean;
  needsApproval: boolean;
  checks: InvoiceCheckView[];
  fortnoxNo: string | null;
  manualInvoiceNo: string | null;
  orderWeeks: number;
  accruedWeeks: number;
  orderValueOre: number;
  bucket: Bucket;
  /** Antal anmärkningar (kräver godkännande eller kontrollera). */
  remarks: number;
  /** Idempotensnyckeln månad:ärende finns redan (fakturan har skickats till Fortnox). */
  hasKey: boolean;
};

export type SlaView = Pick<SlaStatus, "label" | "tone">;
export type FortnoxRunView = { id: string; at: LocalDateTime; byName: string; created: number; skipped: number; blocked: number };

/** Fakturakörningen för en månad (prototypens eko.korning). month = null: det finns ingen körning ännu. */
export type RunView = {
  month: MonthKey | null;
  canAct: boolean;
  customerName: string;
  runs: { month: MonthKey; status: BillingRunStatus }[];
  run: { status: BillingRunStatus } | null;
  /** Internt mål för när fakturorna ska vara i Fortnox (bara för en pågående körning). */
  due: { at: LocalDateTime; sla: SlaView; days: number } | null;
  count: number;
  totalOre: number;
  weeks: number;
  vatOre: number;
  calendarWeeks: number;
  rows: InvoiceRow[];
  rules: MonthRules & { collectiveAllowed: boolean; refLen: string };
  fortnoxRuns: FortnoxRunView[];
  priceSpan: string | null;
};
export const ekoRun = query("ekonomi.run", z.object({ month: MonthKeySchema.optional() })).returns<RunView>();

export type TaskRef = { id: string; fromName: string; createdAt: LocalDateTime; text: string };
/** Underlag för formuläret "Rätta beställarreferens": ärendets referens och ev. öppen uppgift från avtalsansvarig. */
export type RefFormCase = { caseId: string; caseNumber: string; buyerReference: string | null };
export type OverlapView = {
  caseId: string;
  caseNumber: string;
  /** Det andra ärendets faktura samma månad, om den finns. */
  status: InvoiceDisplayStatus | null;
  startDate: LocalDate | null;
  endDate: LocalDate | null;
  /** När ekonomen frågade samordnaren om överlappet (null = inte frågat). */
  askedAt: LocalDateTime | null;
};

/** En faktura i körningens detaljvy (dialogen när man klickar på en rad). null = ingen faktura. */
export type InvoiceDetailView = {
  canAct: boolean;
  month: MonthKey;
  inv: InvoiceRow;
  case: RefFormCase;
  summary: InvoiceSummary;
  /** Per kontroll av typen överlapp (nyckel = kontrollens etikett). */
  overlaps: Record<string, OverlapView>;
  credit: { at: LocalDateTime; reference: string | null } | null;
  task: TaskRef | null;
  refRules: RefRules;
};
export const ekoInvoice = query("ekonomi.invoice", z.object({ month: MonthKeySchema, caseId: IdSchema })).returns<InvoiceDetailView | null>();

/** Fakturaunderlaget som CSV (reservvägen). Exporten loggas med billingExport. */
export const ekoCsv = query("ekonomi.csv", z.object({ month: MonthKeySchema })).returns<{ filename: string; csv: string }>();

/** Förhandsvisning av fakturan (prototypens eko.faktura). preview = null: ärendet har ingen faktura den månaden. */
export type InvoicePreviewView = {
  month: MonthKey | null;
  caseId: string;
  caseNumber: string | null;
  preview: {
    inv: InvoiceRow;
    summary: InvoiceSummary;
    invoiceDate: LocalDate;
    dueDate: LocalDate;
    paymentTermsDays: number;
    vatOre: number;
    roundingOre: number;
    grossRoundedOre: number;
    /** Kommunens inköpsordernummer om det är giltigt, annars tom sträng. */
    po: string;
    period: [LocalDate | null, LocalDate | null];
    /** Radtext: "BOT-26-0132 · v. 1, 3–4 2027" */
    lineText: string;
    refLen: string;
    poText: string;
    supplier: { name: string; orgNr: string; vatNo: string };
    customer: { name: string; orgNr: string; possessive: string; eInvoiceContact: string };
    contractNumber: string;
    dnr: string | null;
    /** Beställande handläggare (för perspektivbytet i prototypen). */
    referrerId: string | null;
  } | null;
};
export const ekoPreview = query("ekonomi.preview", z.object({ month: MonthKeySchema.optional(), caseId: IdSchema })).returns<InvoicePreviewView>();

export type CaseMonthRow = {
  mk: MonthKey;
  /** Debiterbara veckor (utan pausade). */
  bill: BillableWeek[];
  paused: BillableWeek[];
  qty: number;
  amountOre: number;
  /** Fakturans status, "open" för innevarande eller senare månad (faktureras efter månadsskiftet), annars null. */
  status: CaseMonthStatus;
  hasInvoice: boolean;
  invoiceNo: string | null;
};
export type QtyAmount = { qty: number; amountOre: number };

/** Ärendets fakturaunderlag (prototypens eko.arende). null = ärendet finns inte eller rollen får inte se det. */
export type CaseBillingView = {
  canAct: boolean;
  caseId: string;
  caseNumber: string;
  /** Visningsnamn: "–" för ekonomen (inga namn), "Skyddade personuppgifter" vid skyddade personuppgifter. */
  name: string;
  areaName: string;
  articleNo: string;
  priceOre: number;
  status: CaseStatus;
  startDate: LocalDate | null;
  endDate: LocalDate | null;
  plannedEnd: LocalDate | null;
  pausedWeeks: WeekKey[];
  buyerReference: string | null;
  ref: RefInfo;
  purchaseOrderNumber: string | null;
  referredAt: LocalDateTime;
  referrerId: string | null;
  orderWeeks: number;
  orderValueOre: number;
  accrued: QtyAmount;
  billed: QtyAmount;
  returned: QtyAmount;
  pending: QtyAmount;
  months: CaseMonthRow[];
  weeks: BillableWeek[];
  /** Måndag innevarande vecka (veckor före den utan registrerad närvaro märks "Närvaro saknas"). */
  thisMonday: LocalDate;
  task: TaskRef | null;
  refRules: RefRules;
};
export const ekoCase = query("ekonomi.case", z.object({ caseId: IdSchema })).returns<CaseBillingView | null>();

export type CasePickRow = { caseId: string; caseNumber: string; areaName: string; startDate: LocalDate | null; status: CaseStatus; buyerReference: string | null; ref: RefInfo };
/** Ärenden som har startat (sök på ärendenummer), nyast först. */
export const ekoCaseList = query("ekonomi.caseList", z.object({})).returns<{ canAct: boolean; cases: CasePickRow[] }>();

export type TaskCaseView = { caseId: string; caseNumber: string; buyerReference: string | null; problem: boolean };
export type TaskView = TaskRef & { status: "open" | "done"; cases: TaskCaseView[]; doneAt: LocalDateTime | null; doneByName: string | null };
export type UnbilledRow = { caseId: string; caseNumber: string; status: InvoiceStatus; weeks: BillableWeek[]; age: number; amountOre: number; presc: LocalDate; left: number };
export type ReturnedRow = {
  id: string;
  month: MonthKey;
  caseId: string;
  caseNumber: string;
  status: InvoiceDisplayStatus;
  weeks: BillableWeek[];
  quantity: number;
  amountOre: number;
  /** Ärendets nuvarande referens. */
  buyerReference: string | null;
  refOk: boolean;
  credit: { at: LocalDateTime; reference: string | null } | null;
};
export type RefCaseRow = { caseId: string; caseNumber: string; buyerReference: string | null; problem: string; started: boolean };
export type ZeroRow = { id: string; month: MonthKey; caseId: string; caseNumber: string; weekKey: WeekKey; planned: number | null; approved: boolean };
export type RunRow = { id: string; month: MonthKey; status: BillingRunStatus; count: number; weeks: number; totalOre: number; entries: [InvoiceDisplayStatus, number][]; todo: number };

/** Ekonomens startsida (prototypens eko.start). */
export type BillingStartView = {
  canAct: boolean;
  customerName: string;
  current: {
    month: MonthKey;
    status: BillingRunStatus;
    totalOre: number;
    count: number;
    weeks: number;
    blocked: number;
    due: LocalDateTime;
    /** "Om 2 dagar" */
    dueRelative: string;
    fortnoxDays: number;
    counts: { blocked: number; zeroPending: number; review: number; ready: number };
    stepNow: number;
    collectiveAllowed: boolean;
  } | null;
  openTasks: number;
  unbilled: { totalOre: number; count: number; limit: number; prescText: string; rows: UnbilledRow[] };
  tasks: TaskView[];
  returned: ReturnedRow[];
  refCases: RefCaseRow[];
  zero: ZeroRow[];
  runs: RunRow[];
  fortnox: { lastRun: { at: LocalDateTime; created: number; skipped: number } | null; lastSync: { at: LocalDateTime; changed: number } | null };
  priceSpan: string | null;
  refRules: RefRules;
};
export const ekoStart = query("ekonomi.start", z.object({})).returns<BillingStartView>();

// ---- Ekonomins egna åtgärder (prototypens eko.*). Bara ekonomen.

/**
 * Logga en körning mot Fortnox (prototypens eko.fortnoxLog). Själva skapandet görs av billingSendFortnox; här sparas
 * körningen (skapade, överhoppade dubbletter, stoppade och ej godkända) för idempotensloggen.
 */
export const ekoFortnoxLog = command("ekonomi.fortnoxLog", z.object({
  month: MonthKeySchema,
  created: z.array(IdSchema).max(1000),
  skipped: z.number().int().min(0),
  notReady: z.number().int().min(0),
  blocked: z.number().int().min(0),
})).returns<Result<{ runId: string }>>();

/** Simulerad statushämtning från Fortnox: varje hämtning flyttar fakturan ett steg (skapad → bokförd → skickad → betald). */
export const ekoFortnoxSync = command("ekonomi.fortnoxSync", z.object({
  month: MonthKeySchema,
  caseIds: z.array(IdSchema).max(1000),
})).returns<Result<{ changed: number }, "not_found">>();

/** Returnerad faktura: kreditera och skapa en ny med rätt beställarreferens (simulerat). */
export const ekoReissue = command("ekonomi.reissue", z.object({
  month: MonthKeySchema,
  caseId: IdSchema,
})).returns<Result<object, "not_found" | "buyer_ref" | "not_returned">>();

/** Markera en uppgift till ekonomen som klar. */
export const ekoTaskDone = command("ekonomi.taskDone", z.object({
  taskId: IdSchema,
  note: z.string().max(1000).optional(),
})).returns<Result<object, "not_found">>();

/**
 * Fråga samordnaren om två ärenden som överlappar samma vecka (samma deltagare). Texten byggs av hanteraren och
 * innehåller bara ärendenummer och veckor – inga namn.
 */
export const ekoAskCoordinator = command("ekonomi.askCoordinator", z.object({
  month: MonthKeySchema,
  caseId: IdSchema,
  otherCaseId: IdSchema,
})).returns<Result<{ taskId: string }, "not_found" | "no_overlap">>();

/** Stäng månadens fakturakörning (alla fakturor är skapade eller manuellt fakturerade). */
export const ekoCloseRun = command("ekonomi.closeRun", z.object({ month: MonthKeySchema })).returns<Result<object, "not_found">>();
