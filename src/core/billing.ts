// Fakturering (SPEC §7.15): debiterbara veckor, fakturaunderlag per ärende och månad, kontroller, fakturastatus
// och ofakturerade veckor. Port av prototypens sel.billableWeeks, billingForMonth, invoiceStatus, buyerRefProblem och unbilledOld.
// Reglerna läses från avtalskonfigurationen (billing): torsdagsregeln, beställarreferens, inköpsordernummer, varningsgräns.
import type { BillingWeekApproval, Case, Db, InvoiceDisplayStatus, InvoiceDraft, InvoiceStatus, UserId } from "@/data/schema";
import type { OperationalConfig } from "./config";
import { priceFor, priceItem } from "./cases";
import { activitiesOf, attendanceFor, groupedBy } from "./db-index";
import type { DomainEnv } from "./env";
import { kr, plural } from "./format";
import { addDays, dayOf, diffDays, fmtWeekKey, isoWeek, monday, monthKey, weekMonthKey, type LocalDate, type LocalDateTime, type MonthKey, type WeekKey } from "./time";
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
export type InvoiceStatusDb = Pick<Db, "invoice_drafts" | "billing_runs">;

function draftRow(db: Pick<Db, "invoice_drafts">, month: MonthKey, caseId: string): InvoiceDraft | null {
  return (groupedBy(db.invoice_drafts, "month:case", (x) => (x.caseId && x.kind === "periodic" ? `${x.month}:${x.caseId}` : null)).get(`${month}:${caseId}`) ?? [])[0] ?? null;
}

/**
 * Fakturastatus för ärendet och månaden: fakturans egen status, annars körningens standardstatus
 * (billing_runs.defaultInvoiceStatus – historiska månader i testdata), annars "draft".
 * En rad med status "draft" (t.ex. bara godkänd eller manuellt nummer) räknas som "ingen egen status", som i prototypen.
 */
export function invoiceStatus(db: InvoiceStatusDb, month: MonthKey, caseId: string): InvoiceStatus {
  const row = draftRow(db, month, caseId);
  if (row && row.status !== "draft") return row.status;
  return db.billing_runs.find((r) => r.month === month)?.defaultInvoiceStatus ?? "draft";
}

/** Statusar där fakturan redan är skapad (i Fortnox eller manuellt) – räknas inte som ofakturerad. */
export const BILLED_STATUSES: readonly InvoiceStatus[] = ["fortnox_created", "booked", "sent", "paid", "manual"];
const FORTNOX_STATUSES: readonly InvoiceStatus[] = ["fortnox_created", "booked", "sent", "paid", "returned"];

/** Problem med ärendets beställarreferens (saknas, fel format eller spärrad), eller null. */
export function buyerRefProblem(c: Pick<Case, "buyerReference">, db: Pick<Db, "buyer_references">, cfg: Pick<OperationalConfig, "billing">): string | null {
  const ref = c.buyerReference;
  const err = buyerRefError(ref, cfg);
  if (err) return err;
  const known = db.buyer_references.find((b) => b.reference === ref);
  if (known && !known.active) return `Beställarreferensen ${ref} är spärrad. ${known.note || ""}`.trim();
  return null;
}

// ---------------------------------------------------------------- Fakturaunderlag
export type BillingCheckKind = "buyer_ref" | "po" | "zero_week" | "missing_reg" | "too_many" | "over_order" | "overlap" | "paused" | "partial";
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

export type Invoice = {
  /** `inv-${month}-${caseId}` */
  id: string;
  month: MonthKey;
  caseId: string;
  caseNumber: string;
  areaCode: string | null;
  weeks: BillableWeek[];
  quantity: number;
  unitPriceOre: number;
  amountOre: number;
  vatRate: number;
  articleNo: string;
  buyerReference: string | null;
  /** Kommunens inköpsordernummer – aldrig våra egna nummer. Tom sträng om det saknas. */
  purchaseOrderNumber: string;
  orderWeeks: number;
  orderValueOre: number;
  accruedWeeks: number;
  accruedOre: number;
  remainingWeeks: number;
  remainingOre: number;
  checks: BillingCheck[];
  blocked: boolean;
  needsApproval: boolean;
  status: InvoiceDisplayStatus;
  manualInvoiceNo: string | null;
  fortnoxNo: string | null;
  /** Fakturaraden: "BOT-26-0072 · v. 1, 3–4 2027" (ärendenumret är faktureringsobjekt – inga namn). */
  lineText: string;
  /** Upparbetat och återstående på beställningen. */
  invoiceText: string;
};

export type BillingMonth = {
  month: MonthKey;
  invoices: Invoice[];
  totalOre: number;
  count: number;
  blocked: number;
  needsApproval: number;
  weeks: number;
  collectiveAllowed: boolean;
};

export type BillingDb = Pick<
  Db,
  "cases" | "activities" | "attendance" | "price_items" | "buyer_references" | "invoice_drafts" | "billing_runs" | "billing_week_approvals"
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
 * Fakturanummer i Fortnox. Sparat nummer används om det finns; annars (testdata för historiska månader, där
 * fakturorna inte har egna rader) samma påhittade nummer som prototypen visar.
 */
function fortnoxNumber(stored: string | null | undefined, caseNumber: string, month: MonthKey): string {
  if (stored) return stored;
  return String(10000 + ((parseInt(caseNumber.slice(-4), 10) * 7 + Number(month.slice(5)) * 311) % 89999));
}

/** Fakturaunderlag för en månad: en faktura per ärende och månad (samlingsfakturor är inte tillåtna i Botkyrka). */
export function billingForMonth(db: BillingDb, month: MonthKey, env: Pick<DomainEnv, "now" | "cfg">): BillingMonth {
  const cfg = env.cfg.billing;
  const drafts = new Map<string, InvoiceDraft>();
  for (const x of db.invoice_drafts) if (x.month === month && x.caseId && x.kind === "periodic") drafts.set(x.caseId, x);
  const zeroApprovals = new Map<string, BillingWeekApproval>();
  for (const x of db.billing_week_approvals) if (x.month === month) zeroApprovals.set(`${x.caseId}:${x.weekKey}`, x);
  const weeksOf = new Map<string, BillableWeek[]>();
  const billable = (c: Case) => {
    let w = weeksOf.get(c.id);
    if (!w) weeksOf.set(c.id, (w = billableWeeks(c, db, env)));
    return w;
  };
  const byPerson = groupedBy(db.cases, "personId", (c) => c.personId);

  const invoices: Invoice[] = [];
  for (const c of db.cases) {
    if (!c.startDate) continue;
    const all = billable(c);
    const weeks = all.filter((w) => w.monthKey === month && !w.paused);
    const pausedInMonth = all.filter((w) => w.monthKey === month && w.paused);
    if (!weeks.length) continue;
    const first = weeks[0];
    const price = priceFor(db.price_items, c.primaryAreaCode, first.monday, c.contractId);
    const amount = weeks.length * price;
    const orderWeeks = c.orderValueWeeks || c.plannedWeeks || 0;
    const orderValue = orderWeeks * price;
    const accruedWeeks = all.filter((w) => !w.paused && w.monthKey <= month).length;
    const accrued = accruedWeeks * price;
    const remainingWeeks = Math.max(0, orderWeeks - accruedWeeks);
    const draft = drafts.get(c.id) ?? null;

    const checks: BillingCheck[] = [];
    const refProblem = buyerRefProblem(c, db, env.cfg);
    if (cfg.buyerReference.required && refProblem) checks.push({ kind: "buyer_ref", severity: "blocking", label: "Beställarreferens saknas eller är fel", text: refProblem });
    if (c.purchaseOrderNumber && !poNumberValid(c.purchaseOrderNumber, env.cfg)) {
      checks.push({ kind: "po", severity: "blocking", label: "Inköpsordernumret har fel format", text: poNumberError(c.purchaseOrderNumber, env.cfg) ?? "" });
    }
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
      checks.push({ kind: "missing_reg", severity: "warning", label: `Närvaro saknas ${fmtWeekKey(w.key)}`, text: "Alla tillfällen är inte registrerade." });
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

    let status: InvoiceStatus = invoiceStatus(db, month, c.id);
    if (status === "draft" && draft?.approvedAt) status = "approved";
    const blocked = checks.some((x) => x.severity === "blocking");
    const needsApproval = checks.some((x) => x.severity === "needs_approval");
    const areaItem = priceItem(db.price_items, c.primaryAreaCode, first.monday, c.contractId);
    const wt = weekText(weeks);
    invoices.push({
      id: `inv-${month}-${c.id}`, month, caseId: c.id, caseNumber: c.caseNumber, areaCode: c.primaryAreaCode, weeks, quantity: weeks.length, unitPriceOre: price, amountOre: amount,
      vatRate: areaItem ? areaItem.vatRate : 25, articleNo: areaItem?.fortnoxArticleNo ?? "", buyerReference: c.buyerReference, purchaseOrderNumber: c.purchaseOrderNumber || "",
      orderWeeks, orderValueOre: orderValue, accruedWeeks, accruedOre: accrued, remainingWeeks, remainingOre: Math.max(0, orderValue - accrued),
      checks, blocked, needsApproval, status: blocked && status === "draft" ? "blocked" : status, manualInvoiceNo: draft?.manualInvoiceNo ?? null,
      fortnoxNo: FORTNOX_STATUSES.includes(status) ? fortnoxNumber(draft?.fortnoxDocumentNumber, c.caseNumber, month) : null,
      lineText: `${c.caseNumber} · ${wt}`,
      invoiceText:
        `Beställning ${c.caseNumber}: planerat ${plural(orderWeeks, "vecka", "veckor")}, ${kr(orderValue)}. ` +
        `Upparbetat inklusive denna faktura: ${plural(accruedWeeks, "vecka", "veckor")}, ${kr(accrued)}. ` +
        `Återstår: ${plural(remainingWeeks, "vecka", "veckor")}, ${kr(Math.max(0, orderValue - accrued))}.`,
    });
  }
  invoices.sort(by<Invoice>("caseNumber"));
  return {
    month, invoices, totalOre: sum(invoices, (x) => x.amountOre), count: invoices.length, blocked: invoices.filter((x) => x.blocked).length,
    needsApproval: invoices.filter((x) => x.needsApproval).length, weeks: sum(invoices, (x) => x.quantity), collectiveAllowed: cfg.collectiveInvoiceAllowed,
  };
}

export type UnbilledWeek = { case: Case; week: BillableWeek; age: number; status: InvoiceStatus; amountOre: number };

/**
 * Debiterbara veckor i tidigare månader som inte fakturerats och är äldre än avtalets varningsgräns
 * (Botkyrka: 45 dagar – preskription två månader efter utfört arbete). Åldern räknas från veckans söndag.
 */
export function unbilledOld(db: BillingDb, env: Pick<DomainEnv, "now" | "cfg">): UnbilledWeek[] {
  const limit = env.cfg.billing.unbilledWarningDays;
  const today = dayOf(env.now);
  const current = monthKey(today);
  const out: UnbilledWeek[] = [];
  for (const c of db.cases) {
    if (!c.startDate) continue;
    for (const w of billableWeeks(c, db, env)) {
      if (w.paused || w.monthKey >= current) continue;
      const st = invoiceStatus(db, w.monthKey, c.id);
      if (BILLED_STATUSES.includes(st)) continue;
      const age = diffDays(addDays(w.monday, 6), today);
      if (age > limit) out.push({ case: c, week: w, age, status: st, amountOre: priceFor(db.price_items, c.primaryAreaCode, w.monday, c.contractId) });
    }
  }
  return out;
}
