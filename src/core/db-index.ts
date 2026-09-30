// Uppslagsindex över datat (per ärende, per aktivitet, per id). Motsvarar prototypens cachade index i 03-domain.js.
// Indexen cachas per tabellarray och byggs om när arrayen byter längd, så att nya rader syns direkt.
// Raderna i indexen är samma objekt som i datat – ändringar av fält på en rad syns alltså också.
import type {
  Activity, Attendance, Case, CaseStatusHistory, CheckIn, Consent, Deviation, IntakeAssessment, Message, MonthlyAssessment, MonthlyPlan, OutcomeEvent, Placement, Report,
} from "@/data/schema";
import type { MonthKey } from "./time";
import { by } from "./util";

type Entry = { len: number; value: unknown };
const cache = new WeakMap<readonly object[], Map<string, Entry>>();

/** Cachat värde per array och nyckel. Byggs om om arrayens längd ändrats. */
function cached<T extends object, V>(rows: readonly T[], tag: string, build: (rows: readonly T[]) => V): V {
  let m = cache.get(rows);
  if (!m) {
    m = new Map();
    cache.set(rows, m);
  }
  const hit = m.get(tag);
  if (hit && hit.len === rows.length) return hit.value as V;
  const value = build(rows);
  m.set(tag, { len: rows.length, value });
  return value;
}

/** Gruppera rader per nyckel (radernas inbördes ordning behålls). */
export function groupedBy<T extends object>(rows: readonly T[], tag: string, key: (x: T) => string | null | undefined): Map<string, T[]> {
  return cached(rows, `group:${tag}`, (rs) => {
    const out = new Map<string, T[]>();
    for (const r of rs) {
      const k = key(r);
      if (k == null) continue;
      const arr = out.get(k);
      if (arr) arr.push(r);
      else out.set(k, [r]);
    }
    return out;
  });
}

/** Rad per id. */
export function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return cached(rows, "id", (rs) => new Map(rs.map((r) => [r.id, r])));
}

export const caseById = (cases: readonly Case[], id: string | null | undefined): Case | null => (id ? byId(cases).get(id) ?? null : null);

/** Ärendets aktiviteter i tidsordning. */
export function activitiesOf(db: { activities: readonly Activity[] }, caseId: string): Activity[] {
  return (groupedBy(db.activities, "caseId", (a) => a.caseId).get(caseId) ?? []).slice().sort(by<Activity>("startsAt"));
}

/** Närvaron för en aktivitet (om flera finns gäller den sista, som i prototypen). */
export function attendanceFor(db: { attendance: readonly Attendance[] }, activityId: string): Attendance | null {
  const m = cached(db.attendance, "byActivity", (rs) => {
    const out = new Map<string, Attendance>();
    for (const a of rs) out.set(a.activityId, a);
    return out;
  });
  return m.get(activityId) ?? null;
}

/** Ärendets avstämningar, senaste först. */
export function checkInsOf(db: { check_ins: readonly CheckIn[] }, caseId: string): CheckIn[] {
  return (groupedBy(db.check_ins, "caseId", (x) => x.caseId).get(caseId) ?? []).slice().sort(by<CheckIn>("heldAt", -1));
}

/** Senaste godkända avstämningen. */
export const latestCheckIn = (db: { check_ins: readonly CheckIn[] }, caseId: string): CheckIn | null =>
  checkInsOf(db, caseId).find((x) => x.status === "approved") ?? null;

/** Ärendets månadsbedömningar, senaste månaden först. */
export function assessmentsOf(db: { monthly_assessments: readonly MonthlyAssessment[] }, caseId: string): MonthlyAssessment[] {
  return (groupedBy(db.monthly_assessments, "caseId", (x) => x.caseId).get(caseId) ?? []).slice().sort(by<MonthlyAssessment>("month", -1));
}

/** Rapporter för ärendet, senaste perioden först. */
export function reportsOf(db: { reports: readonly Report[] }, caseId: string): Report[] {
  return (groupedBy(db.reports, "caseId", (r) => r.caseId).get(caseId) ?? []).slice().sort(by<Report>((r) => r.periodEnd || "", -1));
}

/** Händelser, senaste först. */
export function eventsOf(db: { outcome_events: readonly OutcomeEvent[] }, caseId: string): OutcomeEvent[] {
  return (groupedBy(db.outcome_events, "caseId", (x) => x.caseId).get(caseId) ?? []).slice().sort(by<OutcomeEvent>("occurredOn", -1));
}

/** Avvikelser, senaste först. */
export function deviationsOf(db: { deviations: readonly Deviation[] }, caseId: string): Deviation[] {
  return (groupedBy(db.deviations, "caseId", (x) => x.caseId).get(caseId) ?? []).slice().sort(by<Deviation>("createdAt", -1));
}

export function placementsOf(db: { placements: readonly Placement[] }, caseId: string): Placement[] {
  return (groupedBy(db.placements, "caseId", (x) => x.caseId).get(caseId) ?? []).slice();
}

/** Månadsbedömningen för ärendet och månaden. */
export const assessmentFor = (db: { monthly_assessments: readonly MonthlyAssessment[] }, caseId: string, month: MonthKey): MonthlyAssessment | null =>
  (groupedBy(db.monthly_assessments, "caseId", (x) => x.caseId).get(caseId) ?? []).find((x) => x.month === month) ?? null;

/** Planen för nästa månad (mall 02 avsnitt 7) för ärendet och månaden. */
export const planOf = (db: { monthly_plans: readonly MonthlyPlan[] }, caseId: string, month: MonthKey): MonthlyPlan | null =>
  db.monthly_plans.find((x) => x.caseId === caseId && x.month === month) ?? null;

/** Kartläggningen för ärendet. */
export const intakeOf = (db: { intake_assessments: readonly IntakeAssessment[] }, caseId: string): IntakeAssessment | null =>
  db.intake_assessments.find((x) => x.caseId === caseId) ?? null;

/** Senaste samtycket (givet eller nekat) för ärendet. */
export const consentOf = (db: { consents: readonly Consent[] }, caseId: string): Consent | null =>
  db.consents.filter((x) => x.caseId === caseId).sort(by<Consent>((x) => x.givenAt || x.declinedAt || "", -1))[0] ?? null;

/** Status- och coachbyten, senaste först. */
export const historyOf = (db: { case_status_history: readonly CaseStatusHistory[] }, caseId: string): CaseStatusHistory[] =>
  db.case_status_history.filter((x) => x.caseId === caseId).sort(by<CaseStatusHistory>("changedAt", -1));

/** Säkra meddelanden i ärendet, äldst först. */
export const messagesOf = (db: { messages: readonly Message[] }, caseId: string): Message[] =>
  db.messages.filter((m) => m.caseId === caseId).sort(by<Message>("createdAt"));
