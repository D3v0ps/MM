// Fakturering (SPEC §7.15): debiterbara veckor, fakturarader per ärende och månad, fakturor, kontroller, fakturastatus och
// ofakturerade veckor. Port av prototypens sel.billableWeeks, billingForMonth, invoiceStatus, buyerRefProblem och unbilledOld.
// Reglerna läses från avtalskonfigurationen (billing): torsdagsregeln, beställarreferens, inköpsordernummer, varningsgräns.
//
// Beslut 2026-10-07 (Karim, synpunkt #13): en faktura per avtal och månad med en rad per ärende. Raderna räknas exakt som
// förut (billingLines – veckor, torsdagsregeln, pris och momssats per artikel, kontroller per ärende); bara grupperingen är ny
// (monthInvoices). Beställarreferensen och inköpsordernumret hör till fakturan, inte till raden.
//   Fakturans grupp (invoice_drafts.grouping_key): "avtal" = månadens faktura (billing.invoicePer "contract_and_month"), eller
//   ärendets id (invoicePer "case_and_month" – en faktura per ärende, om ett avtal kräver det).
//   Frysta rader: när fakturan skapas (Fortnox eller manuellt) skrivs raderna till invoice_lines med veckorna (iso_weeks).
//   En skapad faktura ändras aldrig av ny närvaro eller ändrade datum – veckor som tillkommer efteråt hamnar på en
//   tilläggsfaktura för samma månad ("avtal-tillagg-2", "avtal-tillagg-3" …). Varje vecka faktureras exakt en gång.
//   Äldre data (före migration 0023): en skapad faktura utan rader täcker alla veckor i månaden som inte står på en annan
//   faktura, och en rad utan veckor täcker ärendets alla veckor i månaden.
//   Rättelser (granskningen 2026-10-07): en fryst vecka som inte längre är debiterbar (uppehåll eller ändrade datum i
//   efterhand) får kontrollen "not_billable". En returnerad faktura görs om med raderna frysta på nytt från dagens underlag –
//   bara de veckor som fortfarande är debiterbara (reissueLines). Återstår inga veckor krediteras fakturan utan ny faktura
//   (status credited – täcker inga veckor).
import type { BillingWeekApproval, Case, Db, InvoiceDisplayStatus, InvoiceDraft, InvoiceLine, InvoiceStatus, UserId } from "@/data/schema";
import type { OperationalConfig } from "./config";
import { priceFor, priceItem } from "./cases";
import { activitiesOf, attendanceFor, groupedBy } from "./db-index";
import type { DomainEnv } from "./env";
import { plural } from "./format";
import { addDays, dayOf, diffDays, fmtWeekKey, isoWeek, monday, monthKey, weekMonday, weekMonthKey, type LocalDate, type LocalDateTime, type MonthKey, type WeekKey } from "./time";
import { by, sum } from "./util";
import { buyerRefError, poNumberError, poNumberValid } from "./validation";

export type BillableWeek = {
  key: WeekKey;
  week: number;
  year: number;
  monday: LocalDate;
  /** Månaden veckan faktureras i (där torsdagen infaller). */
  monthKey: MonthKey;
  paused: boolean;
  /** Start- eller slutveckan är bara delvis. */
  partial: boolean;
  enrolledDays: number;
  /** Passerade tillfällen i veckan. */
  planned: number;
  attended: number;
  registered: number;
  /** Debiterbar vecka där alla tillfällen är registrerade men deltagaren inte varit närvarande något tillfälle. */
  zeroAttendance: boolean;
  missingRegistration: boolean;
};

/**
 * Alla debiterbara ISO-veckor för ärendet: varje vecka med minst en inskriven dag mellan start och avslut
 * (eller till och med innevarande vecka för pågående ärenden). Pausade veckor finns med men är markerade.
 */
export function billableWeeks(c: Case, db: Pick<Db, "activities" | "attendance">, env: Pick<DomainEnv, "now">): BillableWeek[] {
  const today = dayOf(env.now);
  if (!c.startDate || c.startDate > today) return [];
  const end = c.endDate || addDays(monday(today), 6);
  const acts = activitiesOf(db, c.id);
  const out: BillableWeek[] = [];
  for (let mon = monday(c.startDate); mon <= end; mon = addDays(mon, 7)) {
    const w = isoWeek(mon);
    const paused = c.pausedWeeks.includes(w.key);
    const sun = addDays(mon, 6);
    const next = addDays(mon, 7);
    const firstDay = c.startDate > mon ? c.startDate : mon;
    const lastDay = c.endDate && c.endDate < sun ? c.endDate : sun;
    const weekActs = acts.filter((a) => a.startsAt >= mon && a.startsAt < next && a.startsAt < env.now);
    const atts = weekActs.map((a) => attendanceFor(db, a.id));
    const attended = atts.filter((x) => x && (x.status === "present" || x.status === "late")).length;
    const registered = atts.filter(Boolean).length;
    out.push({
      key: w.key, week: w.week, year: w.year, monday: mon, monthKey: weekMonthKey(mon), paused, partial: diffDays(firstDay, lastDay) < 6,
      enrolledDays: diffDays(firstDay, lastDay) + 1, planned: weekActs.length, attended, registered,
      zeroAttendance: !paused && weekActs.length > 0 && registered === weekActs.length && attended === 0, missingRegistration: registered < weekActs.length,
    });
  }
  return out;
}

// ---------------------------------------------------------------- Fakturastatus
/** Statusar där fakturan redan är skapad (i Fortnox eller manuellt) – räknas som fakturerad. */
export const BILLED_STATUSES: readonly InvoiceStatus[] = ["fortnox_created", "booked", "sent", "paid", "manual"];
/** Statusar där fakturan är skapad och raderna frysta – också en returnerad faktura (den krediteras och görs om). */
export const CREATED_STATUSES: readonly InvoiceStatus[] = [...BILLED_STATUSES, "returned"];
export const isCreated = (s: InvoiceStatus): boolean => CREATED_STATUSES.includes(s);
/** Krediterad utan ny faktura: varken skapad eller öppen – fakturan räknas inte längre (täcker inga veckor). */
export const isCredited = (s: InvoiceStatus): boolean => s === "credited";
/** Öppen faktura: underlag eller godkänd (inte skapad och inte krediterad). */
const isOpen = (s: InvoiceStatus): boolean => !isCreated(s) && !isCredited(s);
const FORTNOX_STATUSES: readonly InvoiceStatus[] = ["fortnox_created", "booked", "sent", "paid", "returned"];

/** Fakturans grupp för hela avtalet och månaden (billing.invoicePer "contract_and_month"). */
export const CONTRACT_GROUP = "avtal";
const SUPPLEMENT = "-tillagg-";
/** Gruppen som ärendets rad hör till: hela avtalet, eller ärendet (invoicePer "case_and_month"). */
export const baseGroupOf = (cfg: Pick<OperationalConfig, "billing">, caseId: string): string =>
  cfg.billing.invoicePer === "case_and_month" ? caseId : CONTRACT_GROUP;
/** Grupp för fakturan nummer n i månaden (1 = huvudfakturan, 2… = tilläggsfakturor). */
export const groupingKeyOf = (base: string, n: number): string => (n <= 1 ? base : `${base}${SUPPLEMENT}${n}`);
export function parseGroupingKey(key: string): { base: string; n: number } {
  const i = key.lastIndexOf(SUPPLEMENT);
  const n = i >= 0 ? Number(key.slice(i + SUPPLEMENT.length)) : NaN;
  return i >= 0 && Number.isInteger(n) && n >= 2 ? { base: key.slice(0, i), n } : { base: key, n: 1 };
}
/** Fakturans id (samma för en faktura som ännu inte är sparad – den räknas fram ur underlaget). */
export const invoiceIdOf = (contractId: string, month: MonthKey, groupingKey: string): string => `inv-${contractId}-${month}-${groupingKey}`;
/** Idempotensnyckeln mot Fortnox: avtal, månad och grupp. En ny faktura efter kreditering får tillägget ":ny". */
export const fortnoxKeyOf = (contractId: string, month: MonthKey, groupingKey: string): string => `${contractId}:${month}:${groupingKey}`;

export type InvoiceDb = Pick<Db, "invoice_drafts" | "invoice_lines">;
type Cover = { draft: InvoiceDraft; weeks: ReadonlySet<WeekKey> | null };
type MonthIndex = {
  drafts: InvoiceDraft[];
  /** Skapade fakturors rader per ärende. weeks = null: raden täcker ärendets alla veckor i månaden (äldre data). */
  byCase: Map<string, Cover[]>;
  /** Skapad faktura utan rader (äldre data): täcker allt som inte står på en annan faktura. */
  legacy: InvoiceDraft | null;
};

const periodic = (d: InvoiceDraft) => d.kind === "periodic";
const bySupplement = (a: InvoiceDraft, b: InvoiceDraft) => parseGroupingKey(a.groupingKey).n - parseGroupingKey(b.groupingKey).n || (a.id < b.id ? -1 : 1);

/**
 * Uppslag av fakturorna (en gång per anrop – raderna läses inte om för varje vecka). Ger fakturan som håller en vecka och
 * veckans status: den skapade fakturan som har veckan på en rad, annars månadens öppna faktura för ärendets grupp.
 */
export function invoiceLookup(db: InvoiceDb) {
  const months = new Map<string, MonthIndex>();
  const linesOf = groupedBy(db.invoice_lines, "invoiceDraftId", (l) => l.invoiceDraftId);
  const draftsOf = groupedBy(db.invoice_drafts, "contract:month", (d) => (periodic(d) ? `${d.contractId}|${d.month}` : null));
  const index = (contractId: string, month: MonthKey): MonthIndex => {
    const key = `${contractId}|${month}`;
    let m = months.get(key);
    if (m) return m;
    const drafts = (draftsOf.get(key) ?? []).slice().sort(bySupplement);
    const byCase = new Map<string, Cover[]>();
    let legacy: InvoiceDraft | null = null;
    for (const d of drafts.filter((x) => isCreated(x.status))) {
      const rows = linesOf.get(d.id) ?? [];
      if (!rows.length) legacy ??= d;
      for (const r of rows) {
        const list = byCase.get(r.caseId) ?? [];
        list.push({ draft: d, weeks: r.isoWeeks.length ? new Set(r.isoWeeks) : null });
        byCase.set(r.caseId, list);
      }
    }
    m = { drafts, byCase, legacy };
    months.set(key, m);
    return m;
  };
  /** Den skapade fakturan som har ärendets vecka på en rad (eller en äldre faktura som täcker den), annars null. */
  const createdHolder = (c: Pick<Case, "id" | "contractId">, month: MonthKey, weekKey: WeekKey | null): InvoiceDraft | null => {
    const m = index(c.contractId, month);
    const covers = m.byCase.get(c.id) ?? [];
    // Ett ärende med rader på en skapad faktura täcks bara av dem; den äldre fakturan utan rader täcker de andra ärendena.
    if (!covers.length) return m.legacy;
    const hit = covers.find((x) => !x.weeks || (weekKey != null && x.weeks.has(weekKey))) ?? (weekKey == null ? covers[0] : undefined);
    return hit?.draft ?? null;
  };
  /** Månadens öppna (inte skapade) faktura för ärendets grupp – huvudfakturan eller tilläggsfakturan som väntar. */
  const openDraft = (c: Pick<Case, "id" | "contractId">, month: MonthKey): InvoiceDraft | null =>
    index(c.contractId, month).drafts.find((d) => isOpen(d.status) && [CONTRACT_GROUP, c.id].includes(parseGroupingKey(d.groupingKey).base)) ?? null;
  return {
    index,
    createdHolder,
    openDraft,
    /** Fakturan som håller veckan: skapad, annars den öppna (kan saknas – då är veckan bara underlag). */
    holderOf: (c: Pick<Case, "id" | "contractId">, month: MonthKey, weekKey: WeekKey | null): InvoiceDraft | null => createdHolder(c, month, weekKey) ?? openDraft(c, month),
    /**
     * Veckans fakturastatus: den skapade fakturans status, annars den öppna fakturans (underlag eller godkänd). Utan vecka
     * (weekKey null) och utan rad i månaden gäller månadens huvudfaktura för ärendets grupp – som prototypens status per
     * ärende och månad.
     */
    statusOf: (c: Pick<Case, "id" | "contractId">, month: MonthKey, weekKey: WeekKey | null): InvoiceStatus => {
      const main = () => index(c.contractId, month).drafts.find((d) => !isCredited(d.status) && [CONTRACT_GROUP, c.id].includes(parseGroupingKey(d.groupingKey).base)) ?? null;
      const d = createdHolder(c, month, weekKey) ?? openDraft(c, month) ?? (weekKey == null ? main() : null);
      return d ? d.status : "draft";
    },
  };
}
export type InvoiceLookup = ReturnType<typeof invoiceLookup>;

/**
 * Fakturastatus för ärendet och månaden: fakturan som har ärendets rad (för en rad som delats på en tilläggsfaktura gäller
 * den skapade fakturan), annars månadens öppna faktura, annars "draft". Används där en status per ärende och månad behövs
 * (ärendets fakturaunderlag och jämförelsen med prototypen).
 */
export function invoiceStatus(db: InvoiceDb, month: MonthKey, c: Pick<Case, "id" | "contractId">): InvoiceStatus {
  return invoiceLookup(db).statusOf(c, month, null);
}

/** Problem med en beställarreferens (saknas, fel format eller spärrad), eller null. */
export function buyerRefProblem(c: Pick<Case, "buyerReference">, db: Pick<Db, "buyer_references">, cfg: Pick<OperationalConfig, "billing">): string | null {
  const ref = c.buyerReference;
  const err = buyerRefError(ref, cfg);
  if (err) return err;
  const known = db.buyer_references.find((b) => b.reference === ref);
  if (known && !known.active) return `Beställarreferensen ${ref} är spärrad. ${known.note || ""}`.trim();
  return null;
}

/**
 * Problem med fakturans beställarreferens, med en text skriven för ekonomen (CLAUDE.md punkt 11: referensen krävs och
 * kontrolleras innan en faktura får skapas). null = giltig.
 */
export function invoiceRefProblem(ref: string | null | undefined, db: Pick<Db, "buyer_references">, cfg: Pick<OperationalConfig, "billing">): string | null {
  if (!String(ref ?? "").trim()) return "Beställarreferens saknas. Fyll i kommunens referens för fakturan – utan den kan fakturan inte skapas.";
  return buyerRefProblem({ buyerReference: String(ref).trim() }, db, cfg);
}

// ---------------------------------------------------------------- Fakturarader (underlaget per ärende och månad)
export type BillingCheckKind = "buyer_ref" | "po" | "po_mixed" | "zero_week" | "missing_reg" | "too_many" | "over_order" | "overlap" | "paused" | "partial" | "not_billable";
export type BillingCheckSeverity = "blocking" | "needs_approval" | "approved" | "warning" | "info";
export type ZeroWeekApproval = { by: UserId; at: LocalDateTime; note: string };
export type BillingCheck = {
  kind: BillingCheckKind;
  severity: BillingCheckSeverity;
  label: string;
  text: string;
  weekKey?: WeekKey;
  approval?: ZeroWeekApproval | null;
};

/** En fakturarad: ett ärende och dess debiterbara veckor i månaden (pausade veckor räknas inte). */
export type BillingLine = {
  month: MonthKey;
  contractId: string;
  caseId: string;
  caseNumber: string;
  areaCode: string | null;
  weeks: BillableWeek[];
  quantity: number;
  /** Öre, exkl. moms – prislistans pris för området den första veckan. */
  unitPriceOre: number;
  amountOre: number;
  vatRate: number;
  articleNo: string;
  priceItemId: string;
  /** Ärendets beställarreferens (Miljonbemannings anteckning från mottagandet) – bara ett förslag till fakturans referens. */
  caseBuyerReference: string | null;
  /** Ärendets inköpsordernummer (kommunens 99-nummer), tom sträng om det saknas. */
  casePurchaseOrderNumber: string;
  /** Beställda veckor (omfattningen) – för kontrollen "fler veckor än beställningen" och återstående veckor. */
  orderWeeks: number;
  accruedWeeks: number;
  remainingWeeks: number;
  /** Radens kontroller (veckor utan närvaro, saknad registrering, överlapp …). Referensen kontrolleras på fakturan. */
  checks: BillingCheck[];
  needsApproval: boolean;
  /** Radtext: "BOT-26-0072 · v. 1, 3–4 2027" (ärendenumret är faktureringsobjekt – inga namn). */
  lineText: string;
};

export type BillingDb = Pick<
  Db,
  "cases" | "activities" | "attendance" | "price_items" | "buyer_references" | "invoice_drafts" | "invoice_lines" | "billing_runs" | "billing_week_approvals"
>;

/** Veckotext med luckor för pausade veckor: "v. 1, 3–4 2027". */
export function weekText(weeks: readonly Pick<BillableWeek, "key" | "week" | "year" | "monday">[]): string {
  if (!weeks.length) return "";
  const runs: { first: (typeof weeks)[number]; last: (typeof weeks)[number] }[] = [];
  for (const w of weeks) {
    const prev = runs[runs.length - 1];
    if (prev && addDays(prev.last.monday, 7) === w.monday) prev.last = w;
    else runs.push({ first: w, last: w });
  }
  const last = weeks[weeks.length - 1];
  return `v. ${runs.map((x) => (x.first.key === x.last.key ? `${x.first.week}` : `${x.first.week}–${x.last.week}`)).join(", ")} ${last.year}`;
}

/**
 * Fakturaraderna för en månad: en rad per ärende med debiterbara veckor (samma räkning som prototypens billingForMonth –
 * veckor, pris och momssats per artikel, kontroller). Sorterade på ärendenummer.
 */
export function billingLines(db: Omit<BillingDb, "invoice_drafts" | "invoice_lines" | "billing_runs" | "buyer_references">, month: MonthKey, env: Pick<DomainEnv, "now" | "cfg">): BillingLine[] {
  const cfg = env.cfg.billing;
  const zeroApprovals = new Map<string, BillingWeekApproval>();
  for (const x of db.billing_week_approvals) if (x.month === month) zeroApprovals.set(`${x.caseId}:${x.weekKey}`, x);
  const weeksOf = new Map<string, BillableWeek[]>();
  const billable = (c: Case) => {
    let w = weeksOf.get(c.id);
    if (!w) weeksOf.set(c.id, (w = billableWeeks(c, db, env)));
    return w;
  };
  const byPerson = groupedBy(db.cases, "personId", (c) => c.personId);

  const lines: BillingLine[] = [];
  for (const c of db.cases) {
    if (!c.startDate) continue;
    const all = billable(c);
    const weeks = all.filter((w) => w.monthKey === month && !w.paused);
    const pausedInMonth = all.filter((w) => w.monthKey === month && w.paused);
    if (!weeks.length) continue;
    const first = weeks[0];
    const price = priceFor(db.price_items, c.primaryAreaCode, first.monday, c.contractId);
    const orderWeeks = c.orderValueWeeks || c.plannedWeeks || 0;
    const accruedWeeks = all.filter((w) => !w.paused && w.monthKey <= month).length;

    const checks: BillingCheck[] = [];
    if (cfg.flagZeroAttendanceWeeks) {
      for (const w of weeks.filter((x) => x.zeroAttendance)) {
        const a = zeroApprovals.get(`${c.id}:${w.key}`);
        const approval = a ? { by: a.approvedBy, at: a.approvedAt, note: a.note } : null;
        checks.push({
          kind: "zero_week", severity: approval ? "approved" : "needs_approval", label: `Ingen närvaro ${fmtWeekKey(w.key)}`,
          text: "Veckan är debiterbar men deltagaren har inte varit närvarande något tillfälle. Kontrollera och godkänn innan fakturering.", weekKey: w.key, approval,
        });
      }
    }
    for (const w of weeks.filter((x) => x.missingRegistration)) {
      checks.push({ kind: "missing_reg", severity: "warning", label: `Närvaro saknas ${fmtWeekKey(w.key)}`, text: "Alla tillfällen är inte registrerade.", weekKey: w.key });
    }
    if (weeks.length > 5) checks.push({ kind: "too_many", severity: "warning", label: "Fler än 5 veckor i månaden", text: "Kontrollera veckornas månadstillhörighet." });
    if (accruedWeeks > orderWeeks) {
      checks.push({
        kind: "over_order", severity: "warning", label: "Fler veckor än beställningen",
        text: `Beställningen gäller ${plural(orderWeeks, "vecka", "veckor")} men ${plural(accruedWeeks, "vecka", "veckor")} är upparbetade inklusive denna faktura.`,
      });
    }
    for (const o of byPerson.get(c.personId) ?? []) {
      if (o.id === c.id || !o.startDate) continue;
      const ow = new Set(billable(o).filter((w) => w.monthKey === month && !w.paused).map((w) => w.key));
      const overlap = weeks.filter((w) => ow.has(w.key));
      if (overlap.length) {
        checks.push({
          kind: "overlap", severity: "warning", label: `Överlappar ${o.caseNumber}`,
          text: `Samma deltagare har ett annat ärende samma vecka (${overlap.map((w) => fmtWeekKey(w.key)).join(", ")}). Samma vecka får bara faktureras en gång.`,
        });
      }
    }
    if (pausedInMonth.length) {
      checks.push({ kind: "paused", severity: "info", label: `Pausad ${pausedInMonth.map((w) => fmtWeekKey(w.key)).join(", ")}`, text: "Pausade veckor debiteras inte." });
    }
    if (weeks.some((w) => w.partial)) {
      checks.push({ kind: "partial", severity: "info", label: "Delvis vecka", text: "Start- eller slutveckan är bara delvis, men räknas som debiterbar vecka enligt Botkyrkas besked." });
    }

    const item = priceItem(db.price_items, c.primaryAreaCode, first.monday, c.contractId);
    lines.push({
      month, contractId: c.contractId, caseId: c.id, caseNumber: c.caseNumber, areaCode: c.primaryAreaCode, weeks, quantity: weeks.length, unitPriceOre: price,
      amountOre: weeks.length * price, vatRate: item ? item.vatRate : 25, articleNo: item?.fortnoxArticleNo ?? "", priceItemId: item?.id ?? "",
      caseBuyerReference: c.buyerReference, casePurchaseOrderNumber: c.purchaseOrderNumber || "", orderWeeks, accruedWeeks,
      remainingWeeks: Math.max(0, orderWeeks - accruedWeeks), checks, needsApproval: checks.some((x) => x.severity === "needs_approval"),
      lineText: `${c.caseNumber} · ${weekText(weeks)}`,
    });
  }
  return lines.sort(by<BillingLine>("caseNumber"));
}

// ---------------------------------------------------------------- Fakturor (en grupp rader)
/** En rad på en faktura. frozen = raden är sparad i invoice_lines (fakturan är skapad) och ändras inte längre. */
export type InvoiceLineView = BillingLine & { frozen: boolean; lineId: string | null; note: string };

export type MonthInvoice = {
  /** invoice_drafts.id – samma för en faktura som ännu inte är sparad. */
  id: string;
  contractId: string;
  month: MonthKey;
  groupingKey: string;
  /** 1 = huvudfakturan, 2… = tilläggsfaktura (veckor som tillkom efter att månadens faktura skapats). */
  number: number;
  /** Raden finns i invoice_drafts. */
  stored: boolean;
  /** Fakturans egen status (draft, approved, fortnox_created …). */
  storedStatus: InvoiceStatus;
  /** Som storedStatus, men "blocked" när en stoppande kontroll gäller en faktura som inte är skapad. */
  status: InvoiceDisplayStatus;
  /** Fakturan är skapad (Fortnox eller manuellt, också returnerad) – raderna är frysta. */
  created: boolean;
  lines: InvoiceLineView[];
  quantity: number;
  amountOre: number;
  /** Moms per momssats (Peppol BT-116–BT-119): underlag och moms i öre. */
  vat: { rate: number; baseOre: number; vatOre: number }[];
  vatOre: number;
  buyerReference: string | null;
  /** Kommunens inköpsordernummer (99…) eller tom sträng – aldrig ärendenummer eller andra egna nummer. */
  purchaseOrderNumber: string;
  /** Fakturans egna kontroller: beställarreferens och inköpsordernummer. Radernas kontroller finns på raderna. */
  checks: BillingCheck[];
  blocked: boolean;
  /** Minst en rad har en vecka utan närvaro som inte är godkänd. */
  needsApproval: boolean;
  approvedAt: LocalDateTime | null;
  approvedBy: UserId | null;
  fortnoxNo: string | null;
  manualInvoiceNo: string | null;
  fortnoxIdempotencyKey: string | null;
  fortnoxCreatedAt: LocalDateTime | null;
};

export type BillingMonth = {
  month: MonthKey;
  invoices: MonthInvoice[];
  /** Alla rader på månadens fakturor. */
  lines: InvoiceLineView[];
  totalOre: number;
  /** Antal rader (ärenden). */
  count: number;
  weeks: number;
  /** Fakturor som är stoppade respektive väntar på godkännande av en vecka utan närvaro. */
  blocked: number;
  needsApproval: number;
  invoicePer: OperationalConfig["billing"]["invoicePer"];
};

/** Veckor ur nycklar (för frysta rader vars ärende inte längre har veckan som debiterbar). */
const weekFromKey = (key: WeekKey): BillableWeek => {
  const mon = weekMonday(key);
  const w = isoWeek(mon);
  return {
    key, week: w.week, year: w.year, monday: mon, monthKey: weekMonthKey(mon), paused: false, partial: false, enrolledDays: 7, planned: 0, attended: 0, registered: 0,
    zeroAttendance: false, missingRegistration: false,
  };
};

/** Raden med bara vissa veckor (resten står på en annan, redan skapad faktura). */
function restrictLine(l: BillingLine, keep: ReadonlySet<WeekKey>): BillingLine {
  if (l.weeks.every((w) => keep.has(w.key))) return l;
  const weeks = l.weeks.filter((w) => keep.has(w.key));
  const checks = l.checks.filter((c) => !c.weekKey || keep.has(c.weekKey));
  return {
    ...l, weeks, quantity: weeks.length, amountOre: weeks.length * l.unitPriceOre, checks, needsApproval: checks.some((x) => x.severity === "needs_approval"),
    lineText: `${l.caseNumber} · ${weekText(weeks)}`,
  };
}

/** Kontrollen på en fryst rad: veckor på fakturan som inte längre är debiterbara (uppehåll eller ändrade datum i efterhand). */
export function notBillableCheck(stale: readonly WeekKey[]): BillingCheck {
  const what = stale.map((k) => fmtWeekKey(k)).join(", ");
  return {
    kind: "not_billable", severity: "warning", label: `Inte längre debiterbar: ${what}`,
    text: `${stale.length === 1 ? "Veckan" : "Veckorna"} står på fakturan men är inte längre debiterbar (uppehåll eller ändrade datum efter att fakturan skapades). ${stale.length === 1 ? "Den" : "De"} behöver krediteras – en returnerad faktura görs om utan ${stale.length === 1 ? "veckan" : "veckorna"}.`,
  };
}

/** En sparad (fryst) rad som vy: de sparade siffrorna, veckorna och kontrollerna ur underlaget för samma veckor. */
function frozenLine(r: InvoiceLine, live: BillingLine | undefined, month: MonthKey, contractId: string, caseNumber: string): InvoiceLineView {
  const keys = new Set(r.isoWeeks);
  const liveWeeks = new Map((live?.weeks ?? []).map((w) => [w.key, w]));
  const weeks = r.isoWeeks.map((k) => liveWeeks.get(k) ?? weekFromKey(k));
  // Underlagets veckor är de debiterbara (pausade räknas inte): en fryst vecka som saknas där är inte längre debiterbar.
  const stale = r.isoWeeks.filter((k) => !liveWeeks.has(k));
  const checks = (live?.checks ?? []).filter((c) => (!c.weekKey || keys.has(c.weekKey)) && !(stale.length && c.kind === "paused"));
  if (stale.length) checks.unshift(notBillableCheck(stale));
  return {
    month, contractId, caseId: r.caseId, caseNumber, areaCode: live?.areaCode ?? null, weeks, quantity: r.quantity, unitPriceOre: r.unitPriceOre,
    amountOre: Math.round(r.quantity * r.unitPriceOre), vatRate: r.vatRate, articleNo: live?.articleNo ?? "", priceItemId: r.priceItemId,
    caseBuyerReference: live?.caseBuyerReference ?? null, casePurchaseOrderNumber: live?.casePurchaseOrderNumber ?? "", orderWeeks: live?.orderWeeks ?? 0,
    accruedWeeks: live?.accruedWeeks ?? 0, remainingWeeks: live?.remainingWeeks ?? 0, checks, needsApproval: false, lineText: r.description, frozen: true, lineId: r.id,
    note: r.note,
  };
}

const live = (l: BillingLine): InvoiceLineView => ({ ...l, frozen: false, lineId: null, note: "" });

/** Moms per momssats (avrundad per sats, som Peppol). */
export function vatBreakdown(lines: readonly Pick<BillingLine, "vatRate" | "amountOre">[]): { rate: number; baseOre: number; vatOre: number }[] {
  const rates = [...new Set(lines.map((l) => l.vatRate))].sort((a, b) => a - b);
  return rates.map((rate) => {
    const baseOre = sum(lines.filter((l) => l.vatRate === rate), (l) => l.amountOre);
    return { rate, baseOre, vatOre: Math.round((baseOre * rate) / 100) };
  });
}

/**
 * Fakturanummer i Fortnox för den SIMULERADE porten (minnesläget, ctx.fortnox.provider "simulated") och testdatat: sparat
 * nummer används om det finns; annars ett påhittat nummer för månaden och fakturan (samma nummer varje gång). Får aldrig
 * anropas utan port – hanterarna (ekonomi.billingSendFortnox, ekonomi.reissue) stoppar först med fortnox_off, och vyerna
 * (monthInvoices) visar bara det lagrade numret (fortnoxDocumentNumber), så inget påhittat nummer når skarp drift.
 */
export function fortnoxNumber(stored: string | null | undefined, month: MonthKey, groupingKey: string): string {
  if (stored) return stored;
  const { base, n } = parseGroupingKey(groupingKey);
  let h = 0;
  for (const ch of base) h = (h * 31 + ch.charCodeAt(0)) % 997;
  const months = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
  return String(10000 + ((months * 101 + h * 13 + n * 7) % 89999));
}

/** Inköpsordernumret på fakturan: det som ekonomen satt, annars det gemensamma för radernas ärenden. */
function invoicePo(draft: InvoiceDraft | null, lines: readonly BillingLine[]): { po: string; mixed: boolean } {
  if (draft?.purchaseOrderNumber != null) return { po: draft.purchaseOrderNumber, mixed: false };
  const pos = new Set(lines.map((l) => l.casePurchaseOrderNumber));
  if (pos.size === 1) return { po: [...pos][0], mixed: false };
  return { po: "", mixed: true };
}

/**
 * Månadens fakturor: en per avtal och månad (eller per ärende med invoicePer "case_and_month"), med en rad per ärende.
 * Skapade fakturor visar sina frysta rader; veckor som inte står på någon skapad faktura samlas på den öppna fakturan
 * (huvudfakturan, eller en tilläggsfaktura om huvudfakturan redan är skapad).
 */
export function monthInvoices(db: BillingDb, month: MonthKey, env: Pick<DomainEnv, "now" | "cfg">): BillingMonth {
  const cfg = env.cfg.billing;
  const lookup = invoiceLookup(db);
  const all = billingLines(db, month, env);
  const lineOf = new Map(all.map((l) => [l.caseId, l]));
  const caseNumberOf = new Map(db.cases.map((c) => [c.id, c.caseNumber]));
  const contracts = [...new Set([...all.map((l) => l.contractId), ...db.invoice_drafts.filter((d) => periodic(d) && d.month === month).map((d) => d.contractId)])].sort();
  const linesOf = groupedBy(db.invoice_lines, "invoiceDraftId", (l) => l.invoiceDraftId);

  const invoices: MonthInvoice[] = [];
  for (const contractId of contracts) {
    const m = lookup.index(contractId, month);
    const created = m.drafts.filter((d) => isCreated(d.status));
    const covered = new Map<string, Set<WeekKey> | "all">();
    const cover = (caseId: string, weeks: readonly WeekKey[] | "all") => {
      const cur = covered.get(caseId);
      if (cur === "all") return;
      if (weeks === "all") covered.set(caseId, "all");
      else covered.set(caseId, new Set([...(cur ?? []), ...weeks]));
    };
    const createdLines = new Map<string, InvoiceLineView[]>();
    // Rader som står på en skapad faktura (frysta) och äldre rader utan veckor.
    for (const d of created) {
      const out: InvoiceLineView[] = [];
      for (const r of linesOf.get(d.id) ?? []) {
        const l = lineOf.get(r.caseId);
        if (r.isoWeeks.length) {
          out.push(frozenLine(r, l, month, contractId, caseNumberOf.get(r.caseId) ?? r.description.split(" · ")[0]));
          cover(r.caseId, r.isoWeeks);
        } else {
          if (l) out.push(live(l));
          cover(r.caseId, "all");
        }
      }
      createdLines.set(d.id, out);
    }
    // En skapad faktura utan rader (äldre data) täcker allt som inte står på en annan faktura.
    if (m.legacy) {
      const rest = all.filter((l) => l.contractId === contractId && !covered.has(l.caseId));
      createdLines.get(m.legacy.id)?.push(...rest.map(live));
      for (const l of rest) cover(l.caseId, "all");
    }
    // Det som återstår hör till den öppna fakturan i ärendets grupp.
    const open = new Map<string, InvoiceLineView[]>();
    for (const l of all.filter((x) => x.contractId === contractId)) {
      const cov = covered.get(l.caseId);
      if (cov === "all") continue;
      const keep = new Set(l.weeks.map((w) => w.key).filter((k) => !cov?.has(k)));
      if (!keep.size) continue;
      const base = baseGroupOf(env.cfg, l.caseId);
      const list = open.get(base) ?? [];
      list.push(live(restrictLine(l, keep)));
      open.set(base, list);
    }

    const build = (draft: InvoiceDraft | null, groupingKey: string, lines: InvoiceLineView[]): MonthInvoice => {
      const storedStatus: InvoiceStatus = draft?.status ?? "draft";
      const isCreatedInv = isCreated(storedStatus);
      const sorted = lines.slice().sort(by<InvoiceLineView>("caseNumber"));
      const checks: BillingCheck[] = [];
      // En faktura per ärende (invoicePer "case_and_month"): ärendets referens – den som Miljonbemanning fyllde i när
      // beställningen togs emot (beslut 3) – gäller tills ekonomen anger en annan. Kontrolleras som alla referenser nedan.
      const caseRefs = new Set(sorted.map((l) => (l.caseBuyerReference ?? "").trim()));
      const caseRef = cfg.invoicePer === "case_and_month" && caseRefs.size === 1 ? [...caseRefs][0] || null : null;
      const buyerReference = draft?.buyerReference ?? caseRef;
      const { po, mixed } = invoicePo(draft, sorted);
      // Referensen och inköpsordernumret kontrolleras innan fakturan skapas – och på en returnerad faktura innan den görs om.
      if (!isCreatedInv || storedStatus === "returned") {
        const refProblem = invoiceRefProblem(buyerReference, db, env.cfg);
        if (cfg.buyerReference.required && refProblem) checks.push({ kind: "buyer_ref", severity: "blocking", label: "Beställarreferens saknas eller är fel", text: refProblem });
        if (po && !poNumberValid(po, env.cfg)) checks.push({ kind: "po", severity: "blocking", label: "Inköpsordernumret har fel format", text: poNumberError(po, env.cfg) ?? "" });
        if (mixed && !isCreatedInv) {
          checks.push({
            kind: "po_mixed", severity: "blocking", label: "Olika inköpsordernummer",
            text: "Ärendena på fakturan har olika inköpsordernummer, men en faktura kan bara ha ett. Ange fakturans inköpsordernummer, eller lämna fältet tomt.",
          });
        }
      }
      const blocked = checks.some((x) => x.severity === "blocking");
      const needsApproval = !isCreatedInv && sorted.some((l) => l.needsApproval);
      const amountOre = sum(sorted, (l) => l.amountOre);
      const vat = vatBreakdown(sorted);
      const id = draft?.id ?? invoiceIdOf(contractId, month, groupingKey);
      return {
        id, contractId, month, groupingKey, number: parseGroupingKey(groupingKey).n, stored: !!draft, storedStatus,
        status: blocked && !isCreatedInv ? "blocked" : storedStatus, created: isCreatedInv, lines: sorted, quantity: sum(sorted, (l) => l.quantity), amountOre, vat,
        vatOre: sum(vat, (v) => v.vatOre), buyerReference, purchaseOrderNumber: po, checks, blocked, needsApproval, approvedAt: draft?.approvedAt ?? null,
        // Bara det lagrade numret (satt av porten när fakturan skapades) – aldrig ett framräknat i vyn.
        approvedBy: draft?.approvedBy ?? null, fortnoxNo: FORTNOX_STATUSES.includes(storedStatus) ? (draft?.fortnoxDocumentNumber ?? null) : null,
        manualInvoiceNo: draft?.manualInvoiceNo ?? null, fortnoxIdempotencyKey: draft?.fortnoxIdempotencyKey ?? null, fortnoxCreatedAt: draft?.fortnoxCreatedAt ?? null,
      };
    };

    for (const d of created) invoices.push(build(d, d.groupingKey, createdLines.get(d.id) ?? []));
    for (const [base, lines] of open) {
      const drafts = m.drafts.filter((d) => parseGroupingKey(d.groupingKey).base === base);
      const waiting = drafts.find((d) => isOpen(d.status)) ?? null;
      const n = waiting ? parseGroupingKey(waiting.groupingKey).n : Math.max(0, ...drafts.map((d) => parseGroupingKey(d.groupingKey).n)) + 1;
      invoices.push(build(waiting, waiting?.groupingKey ?? groupingKeyOf(base, n), lines));
    }
  }
  invoices.sort((a, b) => (a.contractId < b.contractId ? -1 : a.contractId > b.contractId ? 1 : 0) || compareGroup(a.groupingKey, b.groupingKey));
  const lines = invoices.flatMap((x) => x.lines);
  return {
    month, invoices, lines, totalOre: sum(invoices, (x) => x.amountOre), count: lines.length, weeks: sum(lines, (l) => l.quantity),
    blocked: invoices.filter((x) => x.blocked).length, needsApproval: invoices.filter((x) => x.needsApproval).length, invoicePer: cfg.invoicePer,
  };
}

function compareGroup(a: string, b: string): number {
  const x = parseGroupingKey(a);
  const y = parseGroupingKey(b);
  return x.base < y.base ? -1 : x.base > y.base ? 1 : x.n - y.n;
}

/**
 * Raderna när en returnerad faktura görs om (eko.reissue): varje fryst rad med bara de veckor som fortfarande är
 * debiterbara, räknad på nytt från dagens underlag (pris, momssats, radtext och kontroller). Rader utan kvarvarande veckor
 * tas bort. Veckor som tillkommit efter att fakturan skapades läggs inte till – de står på månadens öppna faktura.
 */
export function reissueLines(inv: Pick<MonthInvoice, "lines">, current: readonly BillingLine[]): InvoiceLineView[] {
  const byCase = new Map(current.map((l) => [l.caseId, l]));
  const out: InvoiceLineView[] = [];
  for (const l of inv.lines) {
    const cur = byCase.get(l.caseId);
    if (!cur) continue;
    const was = new Set(l.weeks.map((w) => w.key));
    const keep = new Set(cur.weeks.map((w) => w.key).filter((k) => was.has(k)));
    if (!keep.size) continue;
    out.push(live(restrictLine(cur, keep)));
  }
  return out.sort(by<InvoiceLineView>("caseNumber"));
}

/**
 * Omgången när en returnerad faktura görs om, ur fakturans idempotensnyckel mot Fortnox: 1 för den ursprungliga nyckeln,
 * 2 efter ":ny", n + 1 efter ":ny<n>". Den nya fakturan får nyckeln "<nyckel>:ny" (omgång 1) eller "<nyckel>:ny<n>".
 */
export function reissueRound(key: string | null): number {
  const m = /:ny(\d*)$/.exec(key ?? "");
  return m ? (m[1] ? Number(m[1]) : 1) + 1 : 1;
}

/** Fakturan med id (också en faktura som ännu inte är sparad), eller null. */
export const findInvoice = (bm: BillingMonth, id: string): MonthInvoice | null => bm.invoices.find((x) => x.id === id) ?? null;
/** Fakturan som har ärendets rad (den öppna före en skapad om raden är delad), eller null. */
export const invoiceOfCase = (bm: BillingMonth, caseId: string): MonthInvoice | null =>
  bm.invoices.find((x) => !x.created && x.lines.some((l) => l.caseId === caseId)) ?? bm.invoices.find((x) => x.lines.some((l) => l.caseId === caseId)) ?? null;

// ---------------------------------------------------------------- Ofakturerade veckor
export type UnbilledWeek = { case: Case; week: BillableWeek; age: number; status: InvoiceStatus; amountOre: number };

/**
 * Debiterbara veckor i tidigare månader som inte fakturerats och är äldre än avtalets varningsgräns
 * (Botkyrka: 45 dagar – preskription två månader efter utfört arbete). Åldern räknas från veckans söndag.
 */
export function unbilledOld(db: BillingDb, env: Pick<DomainEnv, "now" | "cfg">): UnbilledWeek[] {
  const limit = env.cfg.billing.unbilledWarningDays;
  const today = dayOf(env.now);
  const current = monthKey(today);
  const lookup = invoiceLookup(db);
  const out: UnbilledWeek[] = [];
  for (const c of db.cases) {
    if (!c.startDate) continue;
    for (const w of billableWeeks(c, db, env)) {
      if (w.paused || w.monthKey >= current) continue;
      const st = lookup.statusOf(c, w.monthKey, w.key);
      if (BILLED_STATUSES.includes(st)) continue;
      const age = diffDays(addDays(w.monday, 6), today);
      if (age > limit) out.push({ case: c, week: w, age, status: st, amountOre: priceFor(db.price_items, c.primaryAreaCode, w.monday, c.contractId) });
    }
  }
  return out;
}
