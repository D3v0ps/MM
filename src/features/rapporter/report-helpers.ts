// Hjälpare för rapporter – rena funktioner utan data och utan React. Delas av hanterarna (vy-modellerna), skärmarna i
// området och kommunportalen (som visar samma rapportdokument). Port av hjälparna överst i prototypens views/rapporter.js.
//
// API (stabilt – kommunportalen använder det):
//   reportTitle(r)       "Månadsrapport januari 2027", "Veckorapport närvaro vecka 4 2027", "Beställarrapport januari 2027" …
//   periodText(r)        "januari 2027", "vecka 4 2027 (25 januari – 31 januari 2027)", "14 december 2026" …
//   effStatus(r)         status där en levererad rapport som mottagaren öppnat är "opened" (kvitterad)
//   statusLabel(r)       "Utkast", "Granskad av coach"/"Granskad", "Godkänd", "Väntar på närvaro", "Levererad", "Kvitterad"
//   statusLook(r)        [märkets ton, ikon] för statusen (text + ikon, aldrig bara färg)
//   isDelivered(r)       levererad eller kvitterad
//   deliveredOk(r)       levererad (eller kvitterad) och inte ersatt av en rättelse
//   DENIED[reason]       rubrik och text när rapporten inte får visas
// Datum skrivs utan förkortningar ("1 februari 2027") eftersom dokumenten också visas i kommunportalen.
import { reportKindLabel, reportStatusLabel } from "@/core/labels";
import { addDays, fmtDateFull, fmtDateTimeFull, MONTHS, monthEnd, monthKey, monthName, weekday, weekMonday, WEEKDAYS, type MonthKey, type WeekKey } from "@/core/time";
import type { BadgeTone, IconName } from "@/ui";
import type { Report, ReportKind, ReportStatus } from "@/data/schema";

/** Fälten i en rapport som hjälparna behöver (vy-modellerna skickar bara dessa). */
export type ReportHead = Pick<Report, "kind" | "status" | "month" | "week" | "periodStart" | "periodEnd"> & { openedAt?: string | null };

/** Rapporttyperna i listan och filtret, i prototypens ordning. */
export const REPORT_LIST_KINDS = ["monthly", "final", "weekly_attendance", "order_confirmation", "customer_summary"] as const satisfies readonly ReportKind[];
/** Statusarna i filtret, i prototypens ordning. */
export const REPORT_LIST_STATUSES = ["draft", "reviewed", "approved", "waiting", "delivered", "opened"] as const satisfies readonly ReportStatus[];
/** Snabbfiltren (brickorna överst i listan). */
export const QUICK_FILTERS = { overdue: "Försenade", week: "Förfaller denna vecka", approval: "Väntar på godkännande", deliver: "Väntar på leverans" } as const;
export type QuickFilter = keyof typeof QUICK_FILTERS;

/** Rapportens livscykel (stegvisaren). */
export const LIFECYCLE = ["Utkast", "Granskad", "Godkänd", "Levererad", "Kvitterad"] as const;
/** Visas i stället för en förfallotid som inte är fastställd med kommunen. */
export const NO_DUE = "Sista dag ej fastställd";
/** Under grunduppgifterna i månads- och slutrapporten. */
export const NO_PNR = "Personnummer skrivs inte ut. Ärendenumret identifierar deltagaren.";
/** Månadsrapportens avsnitt 2 (beslut 2026-10-07, synpunkt #12): bara perioden och närvarograden, med regeln i en rad. */
export const ATTENDANCE_RATE_RULE = "Närvarograd = tillfällen med närvaro (också sen ankomst) delat med de planerade tillfällen där närvaron är registrerad.";
/** "1–31 januari 2027". */
export const monthRangeText = (mk: MonthKey): string => `1–${Number(monthEnd(mk).slice(8, 10))} ${monthName(mk)}`;
/** Orderbekräftelsen utan beställarreferens: Miljonbemanning fyller i den (beslut 2026-10-07, beslut 3 – en referens per faktura). */
export const BUYER_REFERENCE_LATER = "Fylls i av Miljonbemanning före faktureringen";
/** Fast text i månads- och slutrapporten (mall 02). */
export const PRINCIPLE =
  'Rapporteringsprincip: Rapporten beskriver vad deltagaren har gjort och vad coachen har observerat under perioden. Den bygger bara på godkända uppgifter – registrerad närvaro, godkända veckoavstämningar och coachens godkända månadsbedömning. Bedömningarna är coachens egna. Rapporten innehåller inga diagnoser, inga spekulationer och inga omdömen om personlighet. Det som inte är känt skrivs "Framgår inte". Personnummer skrivs inte ut – ärendenumret identifierar deltagaren.';

// ---------------------------------------------------------------- Text
export const ucfirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** Liten första bokstav – utom förkortningar som "CV" och "APL" (andra bokstaven är också versal). */
export const lcfirst = (s: string): string =>
  s && !(s.length > 1 && s.charAt(1) === s.charAt(1).toUpperCase() && /[A-ZÅÄÖ]/.test(s.charAt(1))) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
/** "a, b och c" */
export const joinSv = (xs: readonly string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} och ${xs[xs.length - 1]}`);
/** Förkortningar skrivs ut (dokumenten visas i kommunportalen): "Praktik/APL" → "Praktik (arbetsplatsförlagt lärande)". */
export const plain = (t: string | null | undefined): string => String(t == null ? "" : t).replace(/\/APL\b/i, " (arbetsplatsförlagt lärande)");

/** Antal för kommunen: 1 till minN − 1 skrivs "färre än 5" (små grupper redovisas inte). */
export const smallN = (minN: number, n: number): string => (n > 0 && n < minN ? `färre än ${minN}` : String(n));

// ---------------------------------------------------------------- Datum utan förkortningar
/** "14 december" */
export const dayMonth = (s: string | null | undefined): string => {
  if (!s) return "–";
  const [, m, dd] = s.slice(0, 10).split("-").map(Number);
  return `${dd} ${MONTHS[m - 1]}`;
};
/** "14 december 2026" */
export const dFull = (s: string | null | undefined): string => (s ? fmtDateFull(s) : "–");
/** "14 december 2026 klockan 10.00" */
export const dtFull = (s: string | null | undefined): string => (s ? fmtDateTimeFull(s) : "–");
/** "måndag 14 december 2026 klockan 10.00" */
export const wdFull = (s: string | null | undefined): string => (s ? `${WEEKDAYS[weekday(s)]} ${fmtDateTimeFull(s)}` : "–");
/** "vecka 4 2027" */
export const weekText = (key: string | null | undefined): string => {
  const m = String(key || "").match(/^(\d{4})-W(\d{2})$/);
  return m ? `vecka ${+m[2]} ${m[1]}` : "";
};
/** "25 januari – 31 januari 2027" (veckan över ett årsskifte: med år på båda). */
export const weekRange = (key: WeekKey): string => {
  const mon = weekMonday(key);
  const sun = addDays(mon, 6);
  return mon.slice(0, 4) === sun.slice(0, 4) ? `${dayMonth(mon)} – ${dayMonth(sun)} ${sun.slice(0, 4)}` : `${dFull(mon)} – ${dFull(sun)}`;
};

// ---------------------------------------------------------------- Rapporten
export const isDelivered = (r: Pick<Report, "status">): boolean => r.status === "delivered" || r.status === "opened";
/** Levererad och inte ersatt (prototypens deliveredOk) – det enda som kommunen, resultatfilen och rapportbyggaren läser. */
export const deliveredOk = (r: Pick<Report, "deliveredAt" | "status" | "superseded">): boolean => !!r.deliveredAt && (r.status === "delivered" || r.status === "opened") && !r.superseded;
/** Status där en levererad rapport som mottagaren öppnat räknas som kvitterad. */
export const effStatus = (r: Pick<Report, "status"> & { openedAt?: string | null }): ReportStatus => (r.status === "delivered" && r.openedAt ? "opened" : r.status);
/** Statusen som text. "Granskad" utan "av coach" för rapporter som coachen inte granskar. */
export function statusLabel(r: Pick<Report, "status" | "kind"> & { openedAt?: string | null }): string {
  const s = effStatus(r);
  if (s === "reviewed" && r.kind !== "monthly" && r.kind !== "final") return "Granskad";
  // Beställarrapporten lämnas till kommunen utanför Miljonmatch (beslut 2026-10-07) – den levereras inte i portalen.
  if (s === "delivered" && r.kind === "customer_summary") return "Lämnad till kommunen";
  return reportStatusLabel(s);
}
const STATUS_LOOK: Record<ReportStatus, [BadgeTone, IconName]> = {
  draft: ["grey", "edit"], reviewed: ["outline", "eye"], approved: ["bluetone", "check"], waiting: ["grey", "clock"], delivered: ["blue", "send"], opened: ["dark", "check-circle"],
};
/** Märkets ton och ikon för statusen. */
export const statusLook = (r: Pick<Report, "status"> & { openedAt?: string | null }): [BadgeTone, IconName] => STATUS_LOOK[effStatus(r)] ?? ["grey", "circle"];
/** Steget i livscykeln (0 = utkast … 5 = kvitterad, förbi sista steget). */
export const lifecycleIndex = (r: Pick<Report, "status"> & { openedAt?: string | null }): number =>
  ({ draft: 0, waiting: 0, reviewed: 1, approved: 2, delivered: 3, opened: 5 } as Record<ReportStatus, number>)[effStatus(r)] ?? 0;
/** Dokumentet visas med vattenstämpeln "Utkast". */
export const isDraftDoc = (status: ReportStatus): boolean => status === "draft" || status === "reviewed" || status === "waiting";

/** Rapportens rubrik. */
export function reportTitle(r: Pick<Report, "kind" | "month" | "week" | "periodStart">): string {
  const month = () => monthName(r.month || monthKey(r.periodStart ?? ""));
  switch (r.kind) {
    case "monthly":
      return `Månadsrapport ${month()}`;
    case "final":
      return "Slutrapport";
    case "weekly_attendance":
      return `Veckorapport närvaro ${r.week ? weekText(r.week) : ""}`.trim();
    case "order_confirmation":
      return "Orderbekräftelse";
    case "customer_summary":
      return `Beställarrapport ${month()}`;
    default:
      return reportKindLabel(r.kind);
  }
}

/** Rapportens period som text. */
export function periodText(r: Pick<Report, "kind" | "month" | "week" | "periodStart" | "periodEnd">): string {
  if (r.kind === "weekly_attendance" && r.week) return `${weekText(r.week)} (${weekRange(r.week)})`;
  if (r.month) return monthName(r.month);
  if (r.kind === "order_confirmation") return dFull(r.periodStart);
  return `${dFull(r.periodStart)} – ${dFull(r.periodEnd)}`;
}

// ---------------------------------------------------------------- Filnamn
const PDF_NAME: Partial<Record<ReportKind, string>> = {
  monthly: "Manadsrapport", final: "Slutrapport", weekly_attendance: "Veckorapport", order_confirmation: "Orderbekraftelse", customer_summary: "Bestallarrapport",
};
/**
 * Filnamnet för rapportens PDF – aldrig personuppgifter, bara ärendenummer, avtalsnummer, period och version:
 *   Manadsrapport_BOT-26-0143_2027-01_v1.pdf · Slutrapport_BOT-26-0143_v1.pdf · Orderbekraftelse_BOT-26-0143_v1.pdf
 *   Veckorapport_2027-W04.pdf · Bestallarrapport_332026110_2027-01.pdf (rättade versioner får _v2 …)
 */
export function reportFilename(r: { kind: ReportKind; version: number; week: string | null; month: string | null; caseNumber: string | null; contractNumber: string }): string {
  const v = r.version || 1;
  const parts: string[] = [PDF_NAME[r.kind] ?? "Rapport"];
  if (r.kind === "monthly" || r.kind === "final" || r.kind === "order_confirmation") {
    if (r.caseNumber) parts.push(r.caseNumber);
    if (r.kind === "monthly" && r.month) parts.push(r.month);
    parts.push(`v${v}`);
  } else {
    if (r.kind === "customer_summary") parts.push(r.contractNumber);
    const period = r.kind === "weekly_attendance" ? r.week : r.month;
    if (period) parts.push(period);
    if (v > 1) parts.push(`v${v}`);
  }
  return `${parts.map((x) => x.replace(/[^A-Za-z0-9.-]+/g, "-")).join("_")}.pdf`;
}

// ---------------------------------------------------------------- När rapporten inte får visas
export const DENIED_REASONS = ["not_assigned", "protected", "handledare", "handledare_order", "role", "missing", "not_yours", "not_delivered", "protected_customer", "not_found"] as const;
export type DeniedReason = (typeof DENIED_REASONS)[number];
/** Rubrik och förklaring per orsak (prototypens DENIED). */
export const DENIED: Record<DeniedReason, readonly [string, string]> = {
  not_assigned: ["Rapporten gäller ett ärende du inte är tilldelad", "Du ser bara rapporter för dina egna ärenden. Så fungerar behörigheten i den riktiga tjänsten också."],
  protected: ["Skyddade personuppgifter", "Rapporten gäller ett ärende med skyddade personuppgifter. Den visas bara för namngiven coach och avtalsansvarig."],
  handledare: [
    "Månads- och slutrapporter visas inte för handledare",
    "Rapporten innehåller coachens bedömningar och samlad status. Den är till för huvudcoachen, samordnaren, avtalsansvarig och kommunen. Som handledare ser du närvaron och veckorapporterna för dina tilldelade ärenden. Fråga huvudcoachen om du behöver veta hur det går för deltagaren.",
  ],
  handledare_order: [
    "Orderbekräftelsen visas inte för handledare",
    "Orderbekräftelsen innehåller beställningens fakturauppgifter. Som handledare ser du närvaron och veckorapporterna för dina tilldelade ärenden.",
  ],
  role: ["Rapporten är inte tillgänglig för din roll", "Beställarrapporten är till för avtalsansvarig, samordnare och ledningen."],
  missing: ["Rapporten saknar ärende", "Rapporten kan inte visas."],
  not_yours: ["Rapporten är inte tillgänglig för dig", "Du ser bara rapporter om dina egna deltagare."],
  not_delivered: ["Rapporten är inte klar ännu", "Du ser rapporten här när Miljonbemanning har levererat den. Du får ett mejl när den finns i portalen."],
  // Rapporter i ärenden med skyddade personuppgifter för kommunen (vilande spärr sedan 2026-10-07 – visas bara om den slås på).
  protected_customer: [
    "Skyddade personuppgifter",
    "Rapporten gäller en deltagare med skyddade personuppgifter. Den visas bara för handläggaren som beställde insatsen.",
  ],
  not_found: ["Rapporten finns inte", "Välj en rapport i listan."],
};
