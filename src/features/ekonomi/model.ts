// Ekonomins vy-logik (port av prototypens hjälpfunktioner i prototyp/src/views/ekonomi.js). Rena funktioner utan I/O och
// utan React: används av hanterarna (vy-modellerna) och av skärmarna (formatering och kontroll av inskriven referens).
// Avtalsvärden (referensens mönster, inköpsordernumrets mönster, betalningsvillkor, samlingsfakturor) kommer från
// avtalskonfigurationen – aldrig hårdkodade (CLAUDE.md punkt 4).
import { BILLED_STATUSES, billableWeeks, invoiceLookup, parseGroupingKey, type BillableWeek, type BillingCheck, type BillingDb, type BillingLine } from "@/core/billing";
import { priceFor } from "@/core/cases";
import { buyerRefLengthText, type BillingConfig } from "@/core/config";
import type { DomainEnv } from "@/core/env";
import { kr, num } from "@/core/format";
import {
  addDays, addMonths, addMonthsDate, dayOf, diffDays, fmtDate, fmtWeekKey, fmtWeekRange, isoWeek, monday, monthEnd, monthKey, monthName, nthWorkingDay, thursday, weekMonthKey,
  weeksOfMonth, type LocalDate, type LocalDateTime, type MonthKey,
} from "@/core/time";
import { buyerRefError } from "@/core/validation";
import type { Case, InvoiceDisplayStatus, InvoiceStatus } from "@/data/schema";

/** Fakturans namn: "Faktura januari 2027", "Tilläggsfaktura 2 · december 2026" – eller med ärendet vid en faktura per ärende. */
export function invoiceTitle(inv: { month: MonthKey; groupingKey: string }, caseNumber?: string | null): string {
  const { n } = parseGroupingKey(inv.groupingKey);
  const what = caseNumber ? `${caseNumber} · ` : "";
  return n > 1 ? `Tilläggsfaktura ${n} · ${what}${monthName(inv.month)}` : `Faktura ${what}${monthName(inv.month)}`;
}

// ---------------------------------------------------------------- Ord och tal
/** "1 vecka", "356 veckor" (talet med tusentalsavgränsare, som prototypens fmt.plural). */
export const plural = (n: number, one: string, many: string): string => `${num(n)} ${n === 1 ? one : many}`;
/** Böjer bara ordet (utan talet): pl(1, "är godkänd", "är godkända"). */
export const pl = (n: number, one: string, many: string): string => (n === 1 ? one : many);
export const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
/** "Januari 2027" */
export const monthLabel = (mk: MonthKey): string => cap(monthName(mk));

type WeekLike = Pick<BillableWeek, "key" | "week" | "year" | "monday">;
/** "v. 1–4 2027" – tar hänsyn till luckor (pausade veckor): "v. 1, 3–4 2027". noYear = utan år. "–" utan veckor. */
export function weekText(weeks: readonly WeekLike[] | null | undefined, noYear = false): string {
  if (!weeks || !weeks.length) return "–";
  const groups: { first: WeekLike; last: WeekLike }[] = [];
  let cur: { first: WeekLike; last: WeekLike } | null = null;
  for (const w of weeks) {
    if (cur && diffDays(cur.last.monday, w.monday) === 7) cur.last = w;
    else {
      cur = { first: w, last: w };
      groups.push(cur);
    }
  }
  const body = groups.map((g) => (g.first.key === g.last.key ? `${g.first.week}` : `${g.first.week}–${g.last.week}`)).join(", ");
  return `v. ${body}${noYear ? "" : ` ${weeks[weeks.length - 1].year}`}`;
}

/** Första och sista dagen för veckorna (måndag–söndag). */
export const periodOf = (weeks: readonly Pick<BillableWeek, "monday">[]): [LocalDate | null, LocalDate | null] =>
  weeks.length ? [weeks[0].monday, addDays(weeks[weeks.length - 1].monday, 6)] : [null, null];

/** Datumet n månader senare – flyttad till src/core/time.ts (beställningens omfattning använder den också). */
export { addMonthsDate };

// ---------------------------------------------------------------- Avtalsvärden som text
/** "8–10" ur referensens mönster. */
export const refLenText = (billing: BillingConfig): string => buyerRefLengthText({ billing }) || "rätt antal";

/** "9 siffror som börjar med 99" ur mönstret för inköpsordernummer (prototypens poText). */
export function poText(billing: BillingConfig): string {
  const p = billing.purchaseOrderNumber.pattern || "";
  const m = p.match(/^\^?(\d*)\[0-9\]\{(\d+)\}\$?$/);
  return m ? `${m[1].length + Number(m[2])} siffror${m[1] ? ` som börjar med ${m[1]}` : ""}` : "kommunens format";
}

const NUMWORD = ["noll", "en", "två", "tre", "fyra", "fem", "sex"];
/**
 * Faktureringspreskription i månader (SPEC §3: två månader efter utfört arbete). Konfigurationen har ännu inget fält för
 * det – prototypen läste billing.prescriptionMonths med 2 som reserv, och det gör vi också.
 */
export const prescMonths = (billing: BillingConfig): number => (billing as BillingConfig & { prescriptionMonths?: number }).prescriptionMonths ?? 2;
export const prescText = (billing: BillingConfig): string => {
  const n = prescMonths(billing);
  return `${NUMWORD[n] ?? n} ${pl(n, "månad", "månader")}`;
};

/** Prisspannet i prislistan som gäller ett visst datum, t.ex. "1 323–1 668 kr". */
export function priceSpan(prices: readonly { priceOre: number; validFrom: LocalDate; validTo: LocalDate | null }[], today: LocalDate): string | null {
  const ps = prices.filter((p) => p.validFrom <= today && (!p.validTo || p.validTo >= today)).map((p) => p.priceOre);
  if (!ps.length) return null;
  const lo = Math.min(...ps);
  const hi = Math.max(...ps);
  return lo === hi ? kr(lo) : `${num(Math.round(lo / 100))}–${kr(hi)}`;
}

/** Internt mål för när fakturorna ska vara i Fortnox (MB:s regel i org_settings, inte ett avtalskrav). */
export const fortnoxDue = (mk: MonthKey, days: number): LocalDateTime => `${nthWorkingDay(addMonths(mk, 1), days)}T16:00`;

// ---------------------------------------------------------------- Beställarreferens
export type RegistryRef = { reference: string; unit: string; active: boolean; note: string | null };
/** Det skärmen behöver för att kontrollera en inskriven referens: avtalets faktureringsregler och kommunens referensregister. */
export type RefRules = { billing: BillingConfig; registry: RegistryRef[] };
export type RefInfo = { ok: boolean; label: "Saknas" | "Fel format" | "Spärrad" | "Giltig"; text: string; unit: string | null };

/**
 * Anteckning från referensregistret med datum i läsbar form (2027-01-12 → 12 jan 2027). Kärnans valideringstext för saknad
 * referens är skriven till kommunen – skriv om den för ekonomen.
 */
export const noteText = (s: string | null | undefined): string =>
  String(s ?? "")
    .trim()
    .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (m) => fmtDate(m))
    .replace("Den får ni av kommunens ekonomi eller er chef.", "Kommunen lämnar den när de beställer.");

export function refInfo(ref: string | null | undefined, rules: RefRules): RefInfo {
  const v = String(ref ?? "").trim();
  const known = rules.registry.find((b) => b.reference === v);
  if (!v) return { ok: false, label: "Saknas", text: "Beställarreferens saknas. Ingen faktura kan skapas utan den.", unit: null };
  const err = buyerRefError(v, { billing: rules.billing });
  if (err) return { ok: false, label: "Fel format", text: noteText(err), unit: null };
  if (known && !known.active) return { ok: false, label: "Spärrad", text: noteText(known.note) || "Referensen finns inte hos kommunen.", unit: known.unit };
  return { ok: true, label: "Giltig", unit: known ? known.unit : null, text: known ? `Tillhör ${known.unit}.` : "Rätt format. Kontrollera mot kommunens beställning." };
}

/** Fel i en inskriven referens (formulären för att rätta referensen), eller null. */
export function refError(v: string, current: string | null, rules: RefRules): string | null {
  const e = buyerRefError(v, { billing: rules.billing });
  if (e) return noteText(e);
  if (!refInfo(v, rules).ok) return `Referensen ${String(v).trim()} är spärrad hos kommunen. Använd referensen som kommunen har bekräftat.`;
  if (current && String(v).trim() === current) return "Det är samma referens som fakturan redan har.";
  return null;
}

/** Referens som avtalsansvarig har skrivit i uppgiften (människan bekräftar – fylls aldrig i automatiskt). */
export function refFromTask(text: string | null | undefined, current: string | null, rules: RefRules): string | null {
  if (!text) return null;
  return (text.match(/\b\d+\b/g) ?? []).find((x) => x !== current && refInfo(x, rules).ok) ?? null;
}

// ---------------------------------------------------------------- Fakturor och kontroller
export type Bucket = "blocked" | "review" | "ready";
/** Statusar där fakturan är skapad (i Fortnox eller manuellt). */
export const BILLED: readonly string[] = BILLED_STATUSES;
export const IN_FORTNOX: readonly string[] = ["fortnox_created", "booked", "sent", "paid"];
/** blocked = stoppad · review = kräver godkännande (eller åtgärd) · ready = klar (godkänd eller fakturerad) */
export const bucketOf = (inv: { blocked: boolean; status: string }): Bucket =>
  inv.blocked && !BILLED.includes(inv.status) ? "blocked" : ["draft", "returned", "blocked"].includes(inv.status) ? "review" : "ready";
export const BUCKET_ORDER: Record<Bucket, number> = { blocked: 0, review: 1, ready: 2 };
export const remarksOf = (checks: readonly Pick<BillingCheck, "severity">[]): number => checks.filter((c) => c.severity === "needs_approval" || c.severity === "warning").length;

/** Kärnans text för "fler veckor än beställningen" – samma begrepp som fakturatexten. Övriga kontroller: datum i läsbar form. */
export function checkText(ch: Pick<BillingCheck, "kind" | "text">, inv: Pick<BillingLine, "orderWeeks" | "accruedWeeks">): string {
  if (ch.kind === "over_order") return `Beställningen gäller ${plural(inv.orderWeeks, "vecka", "veckor")} men ${plural(inv.accruedWeeks, "vecka", "veckor")} är upparbetade inklusive denna faktura.`;
  return noteText(ch.text);
}

// ---------------------------------------------------------------- Ärendets veckor per månad
// Samma begrepp i alla ekonomivyer:
//   Upparbetat    = debiterbara veckor (pausade veckor räknas inte)
//   Fakturerat    = veckor på fakturor som är skapade i Fortnox, bokförda, skickade, betalda eller manuellt fakturerade
//   Faktureras om = veckor på en faktura som kommunen har returnerat (krediteras och faktureras på nytt)
//   Ej fakturerat = underlag, godkänd men inte skapad, stoppad eller pågående månad
//   Upparbetat = fakturerat + faktureras om + ej fakturerat. Återstår = beställda veckor − upparbetade veckor.
// En månad kan ha två rader för samma ärende: veckor på månadens faktura och veckor som tillkom efteråt (tilläggsfaktura).
export type LedgerKind = "billed" | "returned" | "unbilled";
export type LedgerRow = {
  mk: MonthKey;
  weeks: BillableWeek[];
  qty: number;
  amountOre: number;
  status: InvoiceStatus | null;
  kind: LedgerKind;
  /** Den sparade fakturan som håller veckorna (null = underlag på en faktura som ännu inte är sparad). */
  invoiceId: string | null;
};

export const kindOf = (status: string | null): LedgerKind => (status && BILLED.includes(status) ? "billed" : status === "returned" ? "returned" : "unbilled");

/** Ärendets debiterbara veckor per månad och faktura, med fakturastatus (bara månader som har en fakturakörning har status). */
export function caseLedger(
  c: Case,
  db: Pick<BillingDb, "activities" | "attendance" | "price_items" | "invoice_drafts" | "invoice_lines" | "billing_runs">,
  env: Pick<DomainEnv, "now">,
): LedgerRow[] {
  const weeks = billableWeeks(c, db, env).filter((w) => !w.paused);
  const runMonths = new Set(db.billing_runs.map((r) => r.month));
  const lookup = invoiceLookup(db);
  const months = [...new Set(weeks.map((w) => w.monthKey))].sort();
  return months.flatMap((mk) => {
    const ws = weeks.filter((w) => w.monthKey === mk);
    const price = priceFor(db.price_items, c.primaryAreaCode, ws[0].monday, c.contractId);
    const groups = new Map<string, BillableWeek[]>();
    for (const w of ws) {
      const holder = lookup.holderOf(c, mk, w.key);
      const key = holder?.id ?? "";
      groups.set(key, [...(groups.get(key) ?? []), w]);
    }
    return [...groups.entries()].map(([id, gw]) => {
      const holder = id ? db.invoice_drafts.find((d) => d.id === id) ?? null : null;
      const status = runMonths.has(mk) ? (holder?.status ?? "draft") : null;
      return { mk, weeks: gw, qty: gw.length, amountOre: gw.length * price, status, kind: kindOf(status), invoiceId: id || null };
    });
  });
}

export type Tally = { qty: number; amountOre: number; months: { mk: MonthKey; weeks: BillableWeek[] }[] };
export const tally = (rows: readonly LedgerRow[]): Tally => ({
  qty: rows.reduce((s, r) => s + r.qty, 0),
  amountOre: rows.reduce((s, r) => s + r.amountOre, 0),
  months: rows.map((r) => ({ mk: r.mk, weeks: r.weeks })),
});
export const qtyKr = (t: { qty: number; amountOre: number }): string => `${plural(t.qty, "vecka", "veckor")}, ${kr(t.amountOre)}`;

export type InvoiceSummary = {
  /** Beställda veckor (omfattningen) – inget ordervärde i kronor (synpunkt #11). */
  order: { qty: number };
  current: { qty: number; amountOre: number };
  billed: Tally;
  returned: Tally;
  pending: Tally;
  accrued: Tally;
  remaining: { qty: number; amountOre: number };
  over: number;
  /** Radens anmärkning (Peppol BT-127): beställningen, denna rad, tidigare fakturerat, faktureras om, upparbetat och återstående. */
  text: string;
};

type SummaryLine = Pick<BillingLine, "month" | "caseNumber" | "weeks" | "quantity" | "amountOre" | "orderWeeks" | "unitPriceOre">;

/**
 * Upparbetat och återstående för en fakturarad (till och med fakturans månad). currentInvoiceId = den sparade fakturan som
 * har raden (null för en faktura som ännu inte är sparad) – så att veckor på en annan faktura samma månad räknas som tidigare.
 * Botkyrkas fakturavillkor: upparbetat och återstående belopp på beställningen anges där det är tillämpligt (SPEC §3).
 */
export function invoiceSummary(inv: SummaryLine, ledger: readonly LedgerRow[], currentInvoiceId: string | null = null): InvoiceSummary {
  const upto = ledger.filter((r) => r.mk <= inv.month);
  const isCurrent = (r: LedgerRow) => r.mk === inv.month && r.invoiceId === currentInvoiceId;
  const earlier = upto.filter((r) => !isCurrent(r));
  const accrued = tally(upto);
  const billed = tally(earlier.filter((r) => r.kind === "billed"));
  const returned = tally(earlier.filter((r) => r.kind === "returned"));
  const pending = tally(earlier.filter((r) => r.kind === "unbilled"));
  const current = { qty: inv.quantity, amountOre: inv.amountOre };
  const orderWeeks = inv.orderWeeks || 0;
  const left = Math.max(0, orderWeeks - accrued.qty);
  const remaining = { qty: left, amountOre: left * inv.unitPriceOre };
  const over = Math.max(0, accrued.qty - orderWeeks);
  const monthsText = (t: Tally) => t.months.map((r) => `${monthName(r.mk)} (${weekText(r.weeks)})`).join(", ");
  const sentences = [
    `Beställning ${inv.caseNumber}: ${plural(orderWeeks, "vecka", "veckor")}.`,
    `Denna faktura: ${plural(current.qty, "vecka", "veckor")} (${weekText(inv.weeks)}), ${kr(current.amountOre)}.`,
    `Tidigare fakturerat: ${qtyKr(billed)}.`,
    returned.qty > 0 &&
      `${pl(returned.months.length, "Returnerad faktura", "Returnerade fakturor")} för ${monthsText(returned)}: ${qtyKr(returned)}. ${pl(returned.months.length, "Fakturan krediteras", "Fakturorna krediteras")} och ${pl(returned.qty, "veckan", "veckorna")} faktureras om på en ny faktura.`,
    pending.qty > 0 && `Ännu inte fakturerat från ${monthsText(pending)}: ${qtyKr(pending)}. Faktureras på fakturan för den månaden.`,
    `Upparbetat inklusive denna faktura: ${qtyKr(accrued)}.`,
    over > 0 ? `Upparbetat är ${plural(over, "vecka", "veckor")} mer än beställningen.` : `Återstår av beställningen: ${qtyKr(remaining)}.`,
  ].filter((x): x is string => !!x);
  return { order: { qty: orderWeeks }, current, billed, returned, pending, accrued, remaining, over, text: sentences.join(" ") };
}

/** Fakturatexten (Peppol BT-22): avtalet, månaden, antal ärenden och veckor. Inga namn eller personnummer. */
export function invoiceText(o: { contractNumber: string; month: MonthKey; lines: number; weeks: number; number: number; perContract: boolean }): string {
  const what = o.number > 1 ? `Tilläggsfaktura ${o.number} för ${monthName(o.month)}` : `Fakturaunderlag ${monthName(o.month)}`;
  const rows = o.perContract ? " En rad per ärende – ärendenumret är faktureringsobjekt." : " Ärendenumret är faktureringsobjekt.";
  return `${what}, avtal ${o.contractNumber}: ${plural(o.lines, "ärende", "ärenden")}, ${plural(o.weeks, "deltagarvecka", "deltagarveckor")}.${rows}`;
}

// ---------------------------------------------------------------- Regler för körningen
export type MonthRules = { weeks: string[]; notes: string[] };

/** Veckorna vars torsdag infaller i månaden och förklaringar om veckorna i månadsskiftena (torsdagsregeln). */
export function monthRules(mk: MonthKey): MonthRules {
  const first = `${mk}-01`;
  const last = monthEnd(mk);
  const notes: string[] = [];
  const wf = isoWeek(first);
  const thF = thursday(first);
  if (weekMonthKey(first) !== mk) notes.push(`${cap(fmtWeekKey(wf.key))} (${fmtWeekRange(wf.key)}) har sin torsdag ${fmtDate(thF)} och hör därför till ${monthName(monthKey(thF))}.`);
  else if (monday(first) < first) {
    notes.push(`${cap(fmtWeekKey(wf.key))} (${fmtWeekRange(wf.key)}) börjar i ${monthName(monthKey(monday(first)))}, men torsdagen ${fmtDate(thF)} infaller i ${monthName(mk)}. Veckan faktureras nu.`);
  }
  const wl = isoWeek(last);
  const thL = thursday(last);
  if (weekMonthKey(last) !== mk) notes.push(`${cap(fmtWeekKey(wl.key))} (${fmtWeekRange(wl.key)}) har sin torsdag ${fmtDate(thL)} och faktureras i ${monthName(monthKey(thL))}.`);
  return { weeks: weeksOfMonth(mk).map((w) => w.key), notes };
}

// ---------------------------------------------------------------- CSV-export (fakturaunderlag, inga namn)
const csvCell = (v: unknown): string => {
  const s = String(v ?? "");
  // Formelskydd: en cell som börjar med =, +, -, @ eller tab tolkas inte som formel i Excel.
  const safe = /^[=+\-@\t]/.test(s) ? `'${s}` : s;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const krCsv = (ore: number): string => (ore / 100).toFixed(2).replace(".", ",");

export type CsvLine = Pick<BillingLine, "caseNumber" | "articleNo" | "weeks" | "quantity" | "unitPriceOre" | "amountOre" | "vatRate"> & {
  invoiceTitle: string;
  invoiceStatus: string;
  buyerReference: string | null;
  purchaseOrderNumber: string;
  areaName: string;
  checkLabels: string[];
  note: string;
};

/**
 * Fakturaunderlaget som CSV (semikolon, svenska decimaler): en rad per fakturarad med fakturans huvud först (faktura, status,
 * beställarreferens, inköpsordernummer). Ärendenumret är faktureringsobjekt – inga namn eller personnummer.
 */
export function toCsv(lines: readonly CsvLine[]): string {
  const head = [
    "Faktura", "Fakturans status", "Beställarreferens", "Inköpsordernummer", "Ärendenummer (faktureringsobjekt)", "Avtalsområde", "Artikel", "Veckor", "Antal veckor",
    "À-pris exkl. moms (kr)", "Belopp exkl. moms (kr)", "Moms (%)", "Radtext", "Anmärkning", "Kontroller",
  ];
  const rows = lines.map((x) => [
    x.invoiceTitle, x.invoiceStatus, x.buyerReference || "", x.purchaseOrderNumber || "", x.caseNumber, x.areaName, x.articleNo, x.weeks.map((w) => w.week).join(" "), x.quantity,
    krCsv(x.unitPriceOre), krCsv(x.amountOre), x.vatRate, `${x.caseNumber} · ${weekText(x.weeks)}`, x.note, x.checkLabels.join(", "),
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
}

// ---------------------------------------------------------------- Ärendets vy
/** Dagar kvar till preskription för ofakturerade veckor (äldsta veckans söndag + preskriptionstiden). */
export function prescriptionDate(oldestMonday: LocalDate, billing: BillingConfig): LocalDate {
  return addMonthsDate(addDays(oldestMonday, 6), prescMonths(billing));
}

/** Dagens datum ur klockan. */
export const todayOf = (now: LocalDateTime): LocalDate => dayOf(now);

/** Fakturastatus i ärendets månadstabell: fakturans status, "open" för innevarande eller senare månad, annars null. */
export type CaseMonthStatus = InvoiceDisplayStatus | "open" | null;
