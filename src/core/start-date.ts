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
//     (raden tas bort med tillfället). Ett tillfälle med närvaro som en människa registrerat tas aldrig bort – då stoppas
//     ändringen och meddelandet säger vilket datum som går.
//   * Planerat slut, planerade veckor och beställningens veckor ändras inte – de räknas från första mötet (beslut 7, 2026-10-08).
// Samma regler i databasen (mm.apply_case_start_change och mm.start_change_locked_month, 0038) och i policy.ts.
import type { Role } from "@/api/roles";
import type { Activity, Attendance, BillingRun, Case, CaseStartChange, CaseStatus, InvoiceDraft, InvoiceLine, InvoiceStatus } from "@/data/schema";
import { CONTRACT_GROUP, isCreated, parseGroupingKey } from "./billing";
import { plural } from "./format";
import { addDays, dayOf, fmtDate, isoWeek, monday, monthName, weekMonthKey, type LocalDate, type MonthKey, type WeekKey } from "./time";
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

/** Fakturans status som stoppar ändringen: godkänd, skapad (Fortnox eller manuellt), skickad, betald eller returnerad. */
export const START_LOCKING_STATUSES: readonly InvoiceStatus[] = ["approved", "fortnox_created", "booked", "sent", "paid", "manual", "returned"];

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
 * som en människa registrerat – source manual). Bara ärendets egna rader.
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
 * Nuvarande fas sedan (cases.phaseSince) efter ändringen: en fas kan inte ha börjat före insatsen. Var den startdatumet, eller
 * ligger den före det nya startdatumet, blir den det nya startdatumet – annars ligger den kvar. Samma regel som 0038.
 */
export function phaseSinceAfter(phaseSince: LocalDate | null, from: LocalDate, to: LocalDate): LocalDate | null {
  return phaseSince != null && (phaseSince === from || phaseSince < to) ? to : phaseSince;
}

export type StartChangeCase = Pick<Case, "id" | "contractId" | "status" | "startDate" | "endDate" | "plannedEnd" | "firstMeetingAt" | "pausedWeeks" | "phaseSince">;

/** Varför startdatumet inte kan ändras i ärendet (status), eller null. Visas i stället för knappen och prövas av servern. */
export function startChangeBlockedText(c: Pick<Case, "status" | "startDate">): string | null {
  if (c.status === "closed") return "Insatsen är avslutad. Startdatumet kan inte ändras.";
  if (c.status === "declined") return "Beställningen är avböjd. Startdatumet kan inte ändras.";
  if (!START_CHANGE_STATUSES.includes(c.status) || !c.startDate) return "Insatsen har inte startat än. Startdatumet väljs när insatsen startas.";
  return null;
}

export type StartChangeProblemCode = "wrong_status" | "same" | "before_meeting" | "after_end" | "invoiced" | "attendance" | "motivation" | "pnr";
export type StartChangeProblem = {
  code: StartChangeProblemCode;
  /** Fältet i dialogen som felet hör till. */
  field: "date" | "motivation";
  text: string;
  /** Månaden som är fakturerad eller godkänd (invoiced). */
  month?: MonthKey;
  /** Senaste startdatum som går (attendance). */
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
  /** Nuvarande fas sedan efter ändringen (phaseSinceAfter). */
  phaseSince: LocalDate | null;
};

export type StartChangeInput = {
  case: StartChangeCase;
  to: LocalDate;
  motivation: string;
  activities: readonly Pick<Activity, "id" | "caseId" | "startsAt" | "groupActivityId">[];
  attendance: readonly Pick<Attendance, "id" | "activityId" | "source">[];
  billing: StartChangeBilling;
};

/**
 * Kontrollen av en ändring och vad den gör (hanteraren arenden.andraStartdatum). I ordning:
 *   wrong_status    ärendet pågår inte (avslutat, inte startat, inget startdatum)
 *   same            samma datum som nu
 *   before_meeting  före första mötets dag (samma regel som Starta insatsen)
 *   after_end       efter slutdatumet eller planerat slut
 *   invoiced        en av månaderna ändringen rör är fakturerad eller godkänd (startChangeLock) – meddelandet säger vilken
 *   attendance      ett tillfälle före det nya datumet har närvaro som en människa registrerat – meddelandet säger senaste datum
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
  if (before.blocked.length) {
    const latest = before.blocked.map((b) => b.day).sort()[0];
    return fail({
      code: "attendance", field: "date", latest,
      text: `${plural(before.blocked.length, "tillfälle", "tillfällen")} före det nya startdatumet har registrerad närvaro. Ett tillfälle med registrerad närvaro tas aldrig bort, så startdatumet kan vara senast ${fmtDate(latest)}.`,
    });
  }
  const m = input.motivation.trim();
  if (m.length < START_MOTIVATION_MIN || m.length > START_MOTIVATION_MAX) {
    return fail({ code: "motivation", field: "motivation", text: `Skriv en kort motivering, ${START_MOTIVATION_MIN}–${START_MOTIVATION_MAX} tecken.` });
  }
  if (looksLikePnr(m)) return fail({ code: "pnr", field: "motivation", text: "Det ser ut som ett personnummer i motiveringen. Ta bort det – ärendenumret räcker." });
  return { ok: true, plan: { from, to, later: to > from, months, remove: before.remove, phaseSince: phaseSinceAfter(c.phaseSince, from, to) } };
}
