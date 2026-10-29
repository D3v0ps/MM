// Ändra startdatum (Karims beslut 2026-10-29, migration 0038). Ren domänlogik utan I/O: vem som ändrar och läser, kontrollen
// av en ändring och vad den för med sig.
//
// "Lägg in så att vi kan ändra startdatum för deltagarna." Besluten:
//   * Ligger det gamla eller det nya startdatumet i en månad som redan är fakturerad stoppas ändringen – ekonomen behöver
//     kreditera först. Månaderna räknas som faktureringen gör (torsdagsregeln, utan uppehållsveckor): alla ISO-veckor från det
//     tidigare till det senare datumet (startChangeMonths). En godkänd faktura stoppar också – den skapas med dagens underlag.
//   * Kommunen får inget meddelande.
//   * Flyttas starten bakåt skapas inga tillfällen bakåt i tiden – coachen lägger till det som hände och registrerar närvaron.
//   * Flyttas starten framåt tas tillfällena före det nya datumet bort: de utan närvaro och de med bara automatisk närvaro
//     (raden tas bort med tillfället). Ett tillfälle med närvaro som en människa registrerat, och en godkänd mötesrapport, tas
//     aldrig bort – då stoppas ändringen och meddelandet säger vilket datum som går.
//   * En månad som med det nya startdatumet får för få inskrivna dagar för en månadsrapport (reportSchedule.monthly.minEnrolledDays,
//     samma regel som rapportutkasten och månadsbedömningarna) blir utan månadsrapport och månadsbedömning: utkasten tas bort.
//     Är månadens rapport redan granskad, godkänd eller lämnad till kommunen, eller månadsbedömningen godkänd, stoppas ändringen
//     – meddelandet säger vilket datum som går (startChangeReportLock).
//   * Rapporter som redan är lämnade till kommunen för veckor och månader som ändringen rör rättas: samordnaren får en uppgift
//     (startChangeCorrections).
//   * Planerat slut, planerade veckor och beställningens veckor ändras inte – de räknas från första mötet (beslut 7, 2026-10-08).
// Samma regler i databasen (mm.apply_case_start_change, mm.start_change_locked_month och mm.start_change_report_month, 0038) och
// i policy.ts.
import type { Role } from "@/api/roles";
import type {
  Activity, Attendance, BillingRun, Case, CaseStartChange, CaseStatus, CheckIn, InvoiceDraft, InvoiceLine, MonthlyAssessment, MonthlyPlan, Report, ReportStatus,
} from "@/data/schema";
import { CONTRACT_GROUP, isCreated, parseGroupingKey } from "./billing";
import { plural } from "./format";
import { enrolledDays } from "./report-schedule";
import { addDays, addMonths, dayOf, fmtDate, isoWeek, monday, monthEnd, monthKey, monthName, weekMonthKey, type LocalDate, type MonthKey, type WeekKey } from "./time";
import { looksLikePnr } from "./validation";

/** Ändrar startdatumet: huvudcoachen och de som leder ärendena (samma i hanteraren, RLS och policy.ts). */
export const START_CHANGERS: readonly Role[] = ["coach", "samordnare", "avtalsansvarig"];
/** Läser ändringarna (raden har bara datum och id:n): Miljonbemanning som öppnar deltagarkortet – aldrig ekonomen eller kommunen. */
export const START_CHANGE_READERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin"];
/** Ärenden där startdatumet kan ändras: pågående och pausade (startade, inte avslutade). */
export const START_CHANGE_STATUSES: readonly CaseStatus[] = ["active", "paused"];

/** Motiveringens längd i tecken (efter trim). */
export const START_MOTIVATION_MIN = 10;
export const START_MOTIVATION_MAX = 300;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Anteckningen med motiveringen (case_notes.body): "Ändrat startdatum: 1 feb 2027 → 3 feb 2027. <motivering>". Anteckningen är
 * låst – den ändras och tas aldrig bort (0038, policy.ts caseNoteWrite) – och visas under startdatumet på deltagarkortet.
 */
export const startChangeNoteBody = (from: LocalDate, to: LocalDate, motivation: string): string => `${startChangePrefix(from, to)}${motivation.trim()}`;
const startChangePrefix = (from: LocalDate, to: LocalDate) => `Ändrat startdatum: ${fmtDate(from)} → ${fmtDate(to)}. `;
/** Motiveringen ur anteckningen (texten efter inledningen), eller hela texten om inledningen inte stämmer. */
export const startMotivationOf = (body: string, from: LocalDate, to: LocalDate): string => {
  const prefix = startChangePrefix(from, to);
  return body.startsWith(prefix) ? body.slice(prefix.length) : body;
};

/** Ändringarna i den ordning de gjordes: nummer i ärendet (seq), sedan tid och id. */
export const startChangesInOrder = <T extends Pick<CaseStartChange, "id" | "changedAt" | "seq">>(changes: readonly T[]): T[] =>
  [...changes].sort((a, b) => a.seq - b.seq || (a.changedAt < b.changedAt ? -1 : a.changedAt > b.changedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Nästa nummer för en ny ändring i ärendet (seq): det högsta hittills plus ett. */
export const nextStartChangeSeq = (changes: readonly Pick<CaseStartChange, "seq">[]): number => changes.reduce((m, x) => Math.max(m, x.seq), 0) + 1;

/**
 * Månaderna ändringen rör, i tidsordning: månaden (torsdagsregeln, weekMonthKey) för varje ISO-vecka från veckan med det
 * tidigare datumet till veckan med det senare – utom uppehållsveckor, som aldrig faktureras. Veckorna emellan blir eller slutar
 * vara debiterbara; veckan med det senare datumet är kvar men blir delvis (eller hel). Samma regel som
 * mm.start_change_locked_month (0038).
 */
export function startChangeMonths(from: LocalDate, to: LocalDate, pausedWeeks: readonly WeekKey[]): MonthKey[] {
  const lo = from < to ? from : to;
  const hi = from < to ? to : from;
  const out: MonthKey[] = [];
  for (let mon = monday(lo); mon <= monday(hi); mon = addDays(mon, 7)) {
    if (pausedWeeks.includes(isoWeek(mon).key)) continue;
    const m = weekMonthKey(mon);
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

/** Faktureringens läge som kontrollen behöver: bara status, grupp och vilka ärenden fakturan har rader för – inga belopp. */
export type StartChangeBilling = {
  drafts: readonly Pick<InvoiceDraft, "id" | "contractId" | "month" | "kind" | "groupingKey" | "status">[];
  lines: readonly Pick<InvoiceLine, "invoiceDraftId" | "caseId">[];
  runs: readonly Pick<BillingRun, "contractId" | "month" | "status">[];
};
export const NO_BILLING: StartChangeBilling = { drafts: [], lines: [], runs: [] };

/**
 * Den första av månaderna som är fakturerad eller godkänd för ärendet, eller null. Fakturerad: månadens körning är stängd,
 * fakturan för ärendets grupp (månadens faktura "avtal" och tilläggsfakturorna, eller ärendets egen vid en faktura per ärende)
 * är skapad (Fortnox, manuellt, skickad, betald eller returnerad), eller en skapad faktura har en fryst rad för ärendet.
 * Godkänd: fakturan för ärendets grupp är godkänd men inte skapad – den skapas med dagens underlag. En krediterad faktura utan
 * ny faktura (credited) och ett underlag (draft) stoppar inte. Samma regel som mm.start_change_locked_month (0038).
 */
export function startChangeLock(
  c: Pick<Case, "id" | "contractId">,
  months: readonly MonthKey[],
  billing: StartChangeBilling,
): { month: MonthKey; kind: "invoiced" | "approved" } | null {
  for (const month of [...months].sort()) {
    const drafts = billing.drafts.filter((d) => d.contractId === c.contractId && d.month === month && d.kind === "periodic");
    const own = drafts.filter((d) => [CONTRACT_GROUP, c.id].includes(parseGroupingKey(d.groupingKey).base));
    const closed = billing.runs.some((r) => r.contractId === c.contractId && r.month === month && r.status === "closed");
    const frozen = drafts.some((d) => isCreated(d.status) && billing.lines.some((l) => l.invoiceDraftId === d.id && l.caseId === c.id));
    if (closed || frozen || own.some((d) => isCreated(d.status))) return { month, kind: "invoiced" };
    if (own.some((d) => d.status === "approved")) return { month, kind: "approved" };
  }
  return null;
}

/** Ett tillfälle före det nya startdatumet som tas bort, med den automatiska närvaroraden som tas bort med det (eller null). */
export type StartChangeRemoval = { activityId: string; groupActivityId: string | null; attendanceId: string | null; startsAt: string };

/**
 * Tillfällena före startdatumet: de som tas bort (utan närvaro eller med bara automatisk närvaro) och de som stoppar (närvaro
 * som en människa registrerat – source manual). Bara ärendets egna rader. Samma regel som policy.ts manualAttendanceBefore och
 * mm.apply_case_start_change (0038).
 */
export function activitiesBeforeStart(
  caseId: string,
  to: LocalDate,
  activities: readonly Pick<Activity, "id" | "caseId" | "startsAt" | "groupActivityId">[],
  attendance: readonly Pick<Attendance, "id" | "activityId" | "source">[],
): { remove: StartChangeRemoval[]; blocked: { activityId: string; day: LocalDate }[] } {
  const byActivity = new Map(attendance.map((a) => [a.activityId, a]));
  const remove: StartChangeRemoval[] = [];
  const blocked: { activityId: string; day: LocalDate }[] = [];
  const before = activities.filter((a) => a.caseId === caseId && dayOf(a.startsAt) < to).sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : a.id < b.id ? -1 : 1));
  for (const a of before) {
    const att = byActivity.get(a.id);
    if (att && att.source !== "auto") blocked.push({ activityId: a.id, day: dayOf(a.startsAt) });
    else remove.push({ activityId: a.id, groupActivityId: a.groupActivityId, attendanceId: att?.id ?? null, startsAt: a.startsAt });
  }
  return { remove, blocked };
}

/**
 * Godkända mötesrapporter (check_ins, status approved) hållna före startdatumet – de stoppar en senare start som manuell närvaro:
 * en godkänd mötesrapport visar att deltagaren var med, och den tas aldrig bort. Utkast stoppar inte. Bara ärendets egna rader,
 * dagarna i tidsordning. Samma regel som policy.ts approvedCheckInBefore och mm.apply_case_start_change (0038).
 */
export function checkInsBeforeStart(caseId: string, to: LocalDate, checkIns: readonly Pick<CheckIn, "id" | "caseId" | "heldAt" | "status">[]): { checkInId: string; day: LocalDate }[] {
  return checkIns
    .filter((x) => x.caseId === caseId && x.status === "approved" && dayOf(x.heldAt) < to)
    .map((x) => ({ checkInId: x.id, day: dayOf(x.heldAt) }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.checkInId < b.checkInId ? -1 : 1));
}

// ---------------------------------------------------------------- Månadsrapporterna och månadsbedömningarna
/** Månadsrapportens status som stoppar att månaden blir utan rapport: granskad, godkänd, lämnad eller öppnad av kommunen. */
const REPORT_LOCKING: readonly ReportStatus[] = ["reviewed", "approved", "delivered", "opened"];
/** Lämnad till kommunen (öppnad = lämnad och kvitterad). */
const DELIVERED: readonly ReportStatus[] = ["delivered", "opened"];

/** Rapporterna och bedömningarna som kontrollen behöver – bara id, typ, period och status (ingen text). */
export type StartChangeReports = {
  /** Ärendets månadsrapporter och veckorapporterna till ärendets handläggare (alla versioner). */
  reports: readonly Pick<Report, "id" | "kind" | "caseId" | "recipientUserId" | "week" | "month" | "status" | "superseded">[];
  /** Ärendets månadsbedömningar. */
  assessments: readonly Pick<MonthlyAssessment, "id" | "caseId" | "month" | "status">[];
  /** Avtalets reportSchedule.monthly.minEnrolledDays (Botkyrka 11) – undefined = ingen gräns (en inskriven dag räcker). */
  minEnrolledDays: number | undefined;
};
export const NO_REPORTS: StartChangeReports = { reports: [], assessments: [], minEnrolledDays: undefined };

/**
 * reportSchedule.monthly.minEnrolledDays ur avtalets konfiguration (contracts.config), eller undefined. Läses som databasen läser
 * den (mm.start_change_report_month: config #>> '{reportSchedule,monthly,minEnrolledDays}') – samma i hanteraren och policy.ts.
 */
export function startChangeMinDays(config: unknown): number | undefined {
  const n = (config as { reportSchedule?: { monthly?: { minEnrolledDays?: unknown } } } | null | undefined)?.reportSchedule?.monthly?.minEnrolledDays;
  return typeof n === "number" ? n : undefined;
}

/** Minsta antal inskrivna dagar för månadsrapporten och månadsbedömningen (needsAssessment, plannedReports): minst en. */
const monthlyMinDays = (minDays: number | undefined): number => Math.max(1, minDays ?? 1);
type EnrolledCase = Pick<Case, "id" | "status" | "startDate" | "endDate">;
const daysIn = (c: EnrolledCase, start: LocalDate, month: MonthKey): number =>
  enrolledDays({ id: c.id, status: c.status, referrerId: null, startDate: start, endDate: c.endDate, closedAt: null }, `${month}-01`, monthEnd(month));

/**
 * Månaderna som med det nya startdatumet får för få inskrivna dagar för en månadsrapport och en månadsbedömning (färre än
 * minEnrolledDays, minst en – samma regel som rapportutkasten, src/core/report-schedule.ts, och needsAssessment), men hade
 * tillräckligt många med det gamla. Bara när starten flyttas senare; i tidsordning. Samma regel som mm.start_change_report_month.
 */
export function startChangeDroppedMonths(c: EnrolledCase, from: LocalDate, to: LocalDate, minDays: number | undefined): MonthKey[] {
  if (to <= from) return [];
  const min = monthlyMinDays(minDays);
  const out: MonthKey[] = [];
  for (let m = monthKey(from); m <= monthKey(to); m = addMonths(m, 1)) {
    if (daysIn(c, from, m) >= min && daysIn(c, to, m) < min) out.push(m);
  }
  return out;
}

/** Det senaste startdatumet som ger månaden minst minEnrolledDays inskrivna dagar (till månadens sista dag eller slutdatumet). */
export function latestStartKeeping(c: Pick<Case, "endDate">, month: MonthKey, minDays: number | undefined): LocalDate {
  const last = c.endDate && c.endDate < monthEnd(month) ? c.endDate : monthEnd(month);
  return addDays(last, -(monthlyMinDays(minDays) - 1));
}

export type StartChangeReportLock = { month: MonthKey; kind: "delivered" | "approved_report" | "approved_assessment"; latest: LocalDate };

/**
 * Den första månaden som blir utan månadsrapport (startChangeDroppedMonths) men vars månadsrapport redan är lämnad till kommunen,
 * granskad eller godkänd, eller vars månadsbedömning är godkänd – då stoppas ändringen (en lämnad eller godkänd rapport tas aldrig
 * bort). latest = det senaste startdatumet som behåller månadens rapport. Ersatta versioner räknas inte. Samma regel som
 * mm.start_change_report_month (0038) och policy.ts caseStartChangeApplies.
 */
export function startChangeReportLock(c: EnrolledCase & Pick<Case, "endDate">, from: LocalDate, to: LocalDate, data: StartChangeReports): StartChangeReportLock | null {
  for (const month of startChangeDroppedMonths(c, from, to, data.minEnrolledDays)) {
    const reports = data.reports.filter((r) => r.kind === "monthly" && r.caseId === c.id && r.month === month && !r.superseded && REPORT_LOCKING.includes(r.status));
    const latest = latestStartKeeping(c, month, data.minEnrolledDays);
    if (reports.some((r) => DELIVERED.includes(r.status))) return { month, kind: "delivered", latest };
    if (reports.length) return { month, kind: "approved_report", latest };
    if (data.assessments.some((a) => a.caseId === c.id && a.month === month && a.status === "approved")) return { month, kind: "approved_assessment", latest };
  }
  return null;
}

/**
 * Utkasten som tas bort för månaderna som blir utan månadsrapport (startChangeDroppedMonths): månadsrapporterna som är utkast,
 * månadsbedömningarna som inte är godkända och planerna för nästa månad som inte är godkända. Systemet skapade dem
 * (rapportjobbet) – en lämnad eller godkänd rapport eller en godkänd bedömning stoppar ändringen i stället.
 */
export function startChangeDrafts(
  caseId: string,
  months: readonly MonthKey[],
  data: Pick<StartChangeReports, "reports" | "assessments"> & { plans: readonly Pick<MonthlyPlan, "id" | "caseId" | "month" | "status">[] },
): { reportIds: string[]; assessmentIds: string[]; planIds: string[] } {
  const inMonths = (m: string | null) => m != null && months.includes(m);
  return {
    reportIds: data.reports.filter((r) => r.kind === "monthly" && r.caseId === caseId && inMonths(r.month) && r.status === "draft").map((r) => r.id).sort(),
    assessmentIds: data.assessments.filter((a) => a.caseId === caseId && inMonths(a.month) && a.status !== "approved").map((a) => a.id).sort(),
    planIds: data.plans.filter((x) => x.caseId === caseId && inMonths(x.month) && x.status !== "approved").map((x) => x.id).sort(),
  };
}

/** En rapport som redan är lämnad till kommunen och behöver rättas efter ändringen. */
export type StartChangeCorrection = { reportId: string; kind: "weekly_attendance" | "monthly"; period: string };

/**
 * Rapporterna som redan är lämnade till kommunen för dagarna som ändringen rör (från det tidigare datumet till dagen före det
 * senare): veckorapporterna till ärendets handläggare för de veckorna och ärendets månadsrapporter för de månaderna. Deltagaren
 * står med eller saknas där på fel dagar – rapporterna är frysta och rättas med Rätta (en ny version). Ersatta versioner räknas
 * inte. Veckorapporterna först, i tidsordning.
 */
export function startChangeCorrections(
  c: Pick<Case, "id" | "referrerId">,
  from: LocalDate,
  to: LocalDate,
  reports: StartChangeReports["reports"],
): StartChangeCorrection[] {
  if (from === to) return [];
  const lo = from < to ? from : to;
  const last = addDays(from < to ? to : from, -1);
  const weeks = new Set<string>();
  for (let mon = monday(lo); mon <= last; mon = addDays(mon, 7)) weeks.add(isoWeek(mon).key);
  const months = new Set<string>();
  for (let m = monthKey(lo); m <= monthKey(last); m = addMonths(m, 1)) months.add(m);
  const delivered = reports.filter((r) => !r.superseded && DELIVERED.includes(r.status));
  const weekly = delivered.filter((r) => r.kind === "weekly_attendance" && !!c.referrerId && r.recipientUserId === c.referrerId && r.week != null && weeks.has(r.week));
  const monthly = delivered.filter((r) => r.kind === "monthly" && r.caseId === c.id && r.month != null && months.has(r.month));
  const by = (a: StartChangeCorrection, b: StartChangeCorrection) => (a.period < b.period ? -1 : a.period > b.period ? 1 : a.reportId < b.reportId ? -1 : 1);
  return [
    ...weekly.map((r) => ({ reportId: r.id, kind: "weekly_attendance" as const, period: r.week as string })).sort(by),
    ...monthly.map((r) => ({ reportId: r.id, kind: "monthly" as const, period: r.month as string })).sort(by),
  ];
}

const listSv = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} och ${xs[xs.length - 1]}`);
/** Veckorna per år: "vecka 1 och 2 2027", "vecka 53 2026 och vecka 1 2027". */
function weeksText(keys: readonly string[]): string {
  const byYear = new Map<string, number[]>();
  for (const k of [...keys].sort()) {
    const m = k.match(/^(\d{4})-W(\d{2})$/);
    if (m) byYear.set(m[1], [...(byYear.get(m[1]) ?? []), Number(m[2])]);
  }
  return listSv([...byYear].map(([y, ws]) => `vecka ${listSv(ws.map(String))} ${y}`));
}

/**
 * Uppgiften till samordnaren (tasks.text): ärendenumret, datumen och rapporterna att rätta – inga namn eller personnummer.
 * "BOT-27-0002: startdatumet är ändrat från 7 jan 2027 till 18 jan 2027. Rätta rapporterna som redan är lämnade till kommunen:
 * veckorapporterna för vecka 1 och 2 2027 samt månadsrapporten för januari 2027."
 */
export function startCorrectionTaskText(caseNumber: string, from: LocalDate, to: LocalDate, items: readonly StartChangeCorrection[]): string {
  const weeks = [...new Set(items.filter((x) => x.kind === "weekly_attendance").map((x) => x.period))];
  const months = [...new Set(items.filter((x) => x.kind === "monthly").map((x) => x.period))];
  const parts = [
    weeks.length ? `${weeks.length === 1 ? "veckorapporten" : "veckorapporterna"} för ${weeksText(weeks)}` : "",
    months.length ? `${months.length === 1 ? "månadsrapporten" : "månadsrapporterna"} för ${listSv(months.map(monthName))}` : "",
  ].filter(Boolean);
  return `${caseNumber}: startdatumet är ändrat från ${fmtDate(from)} till ${fmtDate(to)}. Rätta ${items.length === 1 ? "rapporten som redan är lämnad" : "rapporterna som redan är lämnade"} till kommunen: ${parts.join(" samt ")}.`;
}

/**
 * Nuvarande fas sedan (cases.phaseSince) efter ändringen: en fas kan inte ha börjat före insatsen. Var den startdatumet, eller
 * ligger den före det nya startdatumet, blir den det nya startdatumet – annars ligger den kvar. Samma regel som 0038.
 */
export function phaseSinceAfter(phaseSince: LocalDate | null, from: LocalDate, to: LocalDate): LocalDate | null {
  return phaseSince != null && (phaseSince === from || phaseSince < to) ? to : phaseSince;
}

export type StartChangeCase = Pick<
  Case,
  "id" | "contractId" | "status" | "startDate" | "endDate" | "plannedEnd" | "firstMeetingAt" | "pausedWeeks" | "phaseSince" | "referrerId"
>;

/** Varför startdatumet inte kan ändras i ärendet (status), eller null. Prövas av servern (wrong_status) – kortet visar ingen knapp. */
export function startChangeBlockedText(c: Pick<Case, "status" | "startDate">): string | null {
  if (c.status === "closed") return "Insatsen är avslutad. Startdatumet kan inte ändras.";
  if (c.status === "declined") return "Beställningen är avböjd. Startdatumet kan inte ändras.";
  if (!START_CHANGE_STATUSES.includes(c.status) || !c.startDate) return "Insatsen har inte startat än. Startdatumet väljs när insatsen startas.";
  return null;
}

export type StartChangeProblemCode = "wrong_status" | "same" | "before_meeting" | "after_end" | "invoiced" | "attendance" | "report" | "motivation" | "pnr";
export type StartChangeProblem = {
  code: StartChangeProblemCode;
  /** Fältet i dialogen som felet hör till. */
  field: "date" | "motivation";
  text: string;
  /** Månaden som är fakturerad eller godkänd (invoiced), eller vars månadsrapport eller månadsbedömning stoppar (report). */
  month?: MonthKey;
  /** Senaste startdatum som går (attendance, report). */
  latest?: LocalDate;
};

export type StartChangePlan = {
  from: LocalDate;
  to: LocalDate;
  /** Starten flyttas framåt i tiden (tillfällen före det nya datumet tas bort). */
  later: boolean;
  /** Månaderna ändringen rör (startChangeMonths). */
  months: MonthKey[];
  /** Tillfällen före det nya startdatumet som tas bort. */
  remove: StartChangeRemoval[];
  /** Månaderna som blir utan månadsrapport och månadsbedömning – utkasten tas bort (startChangeDroppedMonths). */
  droppedMonths: MonthKey[];
  /** Nuvarande fas sedan efter ändringen (phaseSinceAfter). */
  phaseSince: LocalDate | null;
};

export type StartChangeInput = {
  case: StartChangeCase;
  to: LocalDate;
  motivation: string;
  activities: readonly Pick<Activity, "id" | "caseId" | "startsAt" | "groupActivityId">[];
  attendance: readonly Pick<Attendance, "id" | "activityId" | "source">[];
  /** Ärendets mötesrapporter (bara id, dag och status). */
  checkIns: readonly Pick<CheckIn, "id" | "caseId" | "heldAt" | "status">[];
  billing: StartChangeBilling;
  reports: StartChangeReports;
};

/** Meningen när tillfällen med registrerad närvaro och godkända mötesrapporter före det nya datumet stoppar. */
function registeredText(attendance: number, checkIns: number, latest: LocalDate): string {
  const date = fmtDate(latest);
  if (!checkIns) {
    return `${plural(attendance, "tillfälle", "tillfällen")} före det nya startdatumet har registrerad närvaro. Ett tillfälle med registrerad närvaro tas aldrig bort, så startdatumet kan vara senast ${date}.`;
  }
  if (!attendance) {
    return `${plural(checkIns, "mötesrapport", "mötesrapporter")} före det nya startdatumet är ${checkIns === 1 ? "godkänd" : "godkända"}. En godkänd mötesrapport tas aldrig bort, så startdatumet kan vara senast ${date}.`;
  }
  return `Före det nya startdatumet finns ${plural(attendance, "tillfälle", "tillfällen")} med registrerad närvaro och ${plural(checkIns, "godkänd mötesrapport", "godkända mötesrapporter")}. De tas aldrig bort, så startdatumet kan vara senast ${date}.`;
}

/** Meningen när en månad som blir utan månadsrapport redan har en lämnad eller godkänd rapport eller en godkänd bedömning. */
function reportLockText(lock: StartChangeReportLock): string {
  const m = monthName(lock.month);
  const short = m.replace(/ \d{4}$/, "");
  const what = lock.kind === "approved_assessment" ? "månadsbedömning" : "månadsrapport";
  const head = lock.kind === "delivered"
    ? `Månadsrapporten för ${m} är redan lämnad till kommunen.`
    : lock.kind === "approved_report" ? `Månadsrapporten för ${m} är redan godkänd.` : `Månadsbedömningen för ${m} är redan godkänd.`;
  return `${head} Med det nya startdatumet får ${short} för få inskrivna dagar för en ${what}, så startdatumet kan vara senast ${fmtDate(lock.latest)}.`;
}

/**
 * Kontrollen av en ändring och vad den gör (hanteraren arenden.andraStartdatum). I ordning:
 *   wrong_status    ärendet pågår inte (avslutat, inte startat, inget startdatum)
 *   same            samma datum som nu
 *   before_meeting  före första mötets dag (samma regel som Starta insatsen)
 *   after_end       efter slutdatumet eller planerat slut
 *   invoiced        en av månaderna ändringen rör är fakturerad eller godkänd (startChangeLock) – meddelandet säger vilken
 *   attendance      före det nya datumet finns ett tillfälle med närvaro som en människa registrerat eller en godkänd mötesrapport
 *                   – meddelandet säger senaste datum
 *   report          en månad som blir utan månadsrapport har redan en lämnad, granskad eller godkänd månadsrapport eller en godkänd
 *                   månadsbedömning (startChangeReportLock) – meddelandet säger senaste datum
 *   motivation      motiveringen är kortare än 10 eller längre än 300 tecken
 *   pnr             motiveringen ser ut att innehålla ett personnummer
 */
export function planStartChange(input: StartChangeInput): { ok: true; plan: StartChangePlan } | { ok: false; problem: StartChangeProblem } {
  const { case: c, to } = input;
  const fail = (problem: StartChangeProblem) => ({ ok: false as const, problem });
  const blocked = startChangeBlockedText(c);
  if (blocked || !c.startDate) return fail({ code: "wrong_status", field: "date", text: blocked ?? "Insatsen har inte startat än." });
  const from = c.startDate;
  if (to === from) return fail({ code: "same", field: "date", text: "Det är redan insatsens startdatum. Välj ett annat datum." });
  const meetingDay = c.firstMeetingAt ? dayOf(c.firstMeetingAt) : null;
  if (meetingDay && to < meetingDay) return fail({ code: "before_meeting", field: "date", text: `Startdatumet kan inte vara före första mötet ${fmtDate(meetingDay)}.` });
  const end = c.endDate ?? c.plannedEnd;
  if (end && to > end) return fail({ code: "after_end", field: "date", text: `Startdatumet kan inte vara efter ${c.endDate ? "slutdatumet" : "planerat slut"} ${fmtDate(end)}.` });
  const months = startChangeMonths(from, to, c.pausedWeeks);
  const lock = startChangeLock(c, months, input.billing);
  if (lock) {
    const text = lock.kind === "invoiced"
      ? `${cap(monthName(lock.month))} är redan fakturerad. Ekonomen behöver kreditera fakturan innan startdatumet kan ändras.`
      : `Fakturan för ${monthName(lock.month)} är redan godkänd av ekonomen. Startdatumet kan inte ändras när månadens faktura är godkänd – kontakta ekonomen.`;
    return fail({ code: "invoiced", field: "date", text, month: lock.month });
  }
  const before = activitiesBeforeStart(c.id, to, input.activities, input.attendance);
  const checkIns = checkInsBeforeStart(c.id, to, input.checkIns);
  if (before.blocked.length || checkIns.length) {
    const latest = [...before.blocked.map((b) => b.day), ...checkIns.map((x) => x.day)].sort()[0];
    return fail({ code: "attendance", field: "date", latest, text: registeredText(before.blocked.length, checkIns.length, latest) });
  }
  const reportLock = startChangeReportLock(c, from, to, input.reports);
  if (reportLock) return fail({ code: "report", field: "date", month: reportLock.month, latest: reportLock.latest, text: reportLockText(reportLock) });
  const m = input.motivation.trim();
  if (m.length < START_MOTIVATION_MIN || m.length > START_MOTIVATION_MAX) {
    return fail({ code: "motivation", field: "motivation", text: `Skriv en kort motivering, ${START_MOTIVATION_MIN}–${START_MOTIVATION_MAX} tecken.` });
  }
  if (looksLikePnr(m)) return fail({ code: "pnr", field: "motivation", text: "Det ser ut som ett personnummer i motiveringen. Ta bort det – ärendenumret räcker." });
  return {
    ok: true,
    plan: {
      from, to, later: to > from, months, remove: before.remove, droppedMonths: startChangeDroppedMonths(c, from, to, input.reports.minEnrolledDays),
      phaseSince: phaseSinceAfter(c.phaseSince, from, to),
    },
  };
}
