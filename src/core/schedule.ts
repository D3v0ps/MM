// Veckoplan och tillfällen (beslut 2026-10-08, skarp drift): när insatsen startar skapas tillfällena (activities) från
// startdatumet till planerat slut enligt en enkel veckoplan – en rad per veckodag måndag–fredag. Standardplanen kommer
// ur avtalskonfigurationen (activities.defaultWeekPlan). Helgdagar (src/core/holidays.ts) och pausade veckor hoppas
// alltid över. Ren domänlogik utan I/O – hanterarna i src/features/arenden/handlers.ts skriver raderna.
import type { ContractConfig, WeekPlanKind } from "./config";
import { addDays, dayOf, isoWeek, isWorkingDay, monday, timeOf, weekday, type LocalDate, type LocalDateTime, type WeekKey } from "./time";

/** En rad i ärendets veckoplan: veckodag 0–4 (måndag–fredag), typ, klockslag, längd i minuter och plats. */
export type WeekPlanRow = { weekday: number; kind: WeekPlanKind; time: string; durationMin: number; location: string };
/** Ett tillfälle som ska skapas (utan id). */
export type PlannedActivity = { kind: WeekPlanKind; startsAt: LocalDateTime; durationMin: number; location: string };

/** Längsta period tillfällen planeras för (12 månader kan bli 53 ISO-veckor, annan tidsperiod lite längre). */
export const MAX_PLAN_WEEKS = 60;

const byDayAndTime = (a: WeekPlanRow, b: WeekPlanRow) => a.weekday - b.weekday || (a.time < b.time ? -1 : a.time > b.time ? 1 : 0);

/** Raderna sorterade på veckodag och klockslag, utan dubbletter (samma dag, typ och tid). */
export function normalizePlan(rows: readonly WeekPlanRow[]): WeekPlanRow[] {
  const seen = new Set<string>();
  const out: WeekPlanRow[] = [];
  for (const r of [...rows].sort(byDayAndTime)) {
    const key = `${r.weekday}|${r.kind}|${r.time}`;
    if (seen.has(key) || r.weekday < 0 || r.weekday > 4) continue;
    seen.add(key);
    out.push({ weekday: r.weekday, kind: r.kind, time: r.time, durationMin: r.durationMin, location: r.location.trim() });
  }
  return out;
}

/**
 * Standardveckoplanen för ett ärende: avtalets rader med första mötets veckodag och klockslag insatta. Utan avsnittet i
 * avtalet (eller utan första möte) föreslås bara coachträffen. En rad per veckodag: krockar en fast dag med första mötets
 * dag flyttas den till nästa lediga vardag, så att planen kan redigeras dag för dag.
 */
export function defaultWeekPlan(cfg: Pick<ContractConfig, "activities">, firstMeetingAt: LocalDateTime | null): WeekPlanRow[] {
  const meetDay = firstMeetingAt && weekday(firstMeetingAt) <= 4 ? weekday(firstMeetingAt) : 0;
  const meetTime = firstMeetingAt ? timeOf(firstMeetingAt) : "10:00";
  const rows = cfg.activities?.defaultWeekPlan ?? [{ weekday: "first_meeting" as const, kind: "möte" as const, durationMin: 60, location: "Miljonbemanning" }];
  const out: WeekPlanRow[] = [];
  const taken = new Set<number>();
  // Första mötets dag först, så att den fasta raden flyttar – inte coachträffen.
  const ordered = [...rows.filter((r) => r.weekday === "first_meeting"), ...rows.filter((r) => r.weekday !== "first_meeting")];
  for (const r of ordered) {
    let day = r.weekday === "first_meeting" ? meetDay : r.weekday;
    for (let i = 0; i < 5 && taken.has(day); i++) day = (day + 1) % 5;
    if (taken.has(day)) continue;
    taken.add(day);
    out.push({ weekday: day, kind: r.kind, time: r.time ?? meetTime, durationMin: r.durationMin, location: r.location });
  }
  return normalizePlan(out);
}

/**
 * Tillfällena mellan två datum (inklusive) enligt planen. Helgdagar och helger hoppas över, pausade veckor likaså, och
 * perioden begränsas till MAX_PLAN_WEEKS från måndagen i startveckan. notBefore: hoppa över tillfällen före den tidpunkten
 * (när planen ändras mitt i en vecka). Resultatet är sorterat och utan dubbletter.
 */
export function planActivities(
  plan: readonly WeekPlanRow[],
  from: LocalDate,
  to: LocalDate,
  opts: { pausedWeeks?: readonly WeekKey[]; notBefore?: LocalDateTime } = {},
): PlannedActivity[] {
  const rows = normalizePlan(plan);
  if (!rows.length || !from || !to || to < from) return [];
  const cap = addDays(monday(from), MAX_PLAN_WEEKS * 7 - 1);
  const end = to < cap ? to : cap;
  const paused = new Set(opts.pausedWeeks ?? []);
  const out: PlannedActivity[] = [];
  for (let mon = monday(from); mon <= end; mon = addDays(mon, 7)) {
    if (paused.has(isoWeek(mon).key)) continue;
    for (const r of rows) {
      const day = addDays(mon, r.weekday);
      if (day < from || day > end || !isWorkingDay(day)) continue;
      const startsAt: LocalDateTime = `${day}T${r.time}`;
      if (opts.notBefore && startsAt < opts.notBefore) continue;
      out.push({ kind: r.kind, startsAt, durationMin: r.durationMin, location: r.location });
    }
  }
  return out;
}

/**
 * Den gällande veckoplanen ur ärendets tillfällen: raderna i den första veckan från och med måndagen `mon` som har
 * tillfällen av veckoplanens typer. Tom lista om det inte finns några – då används avtalets standard.
 */
export function planFromActivities(
  acts: readonly { kind: string; startsAt: LocalDateTime; durationMin: number; location: string }[],
  mon: LocalDate,
): WeekPlanRow[] {
  const isPlanKind = (k: string): k is WeekPlanKind => k === "möte" || k === "yrkesmoment" || k === "praktikdag";
  const future = acts.filter((a) => isPlanKind(a.kind) && dayOf(a.startsAt) >= mon).sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  if (!future.length) return [];
  const first = monday(future[0].startsAt);
  const week = future.filter((a) => dayOf(a.startsAt) < addDays(first, 7));
  return normalizePlan(week.map((a) => ({ weekday: weekday(a.startsAt), kind: a.kind as WeekPlanKind, time: timeOf(a.startsAt), durationMin: a.durationMin, location: a.location })));
}

/** Praktikdagarna i en period: datumen på de valda veckodagarna (0–4), utan helgdagar och pausade veckor. */
export function placementDays(startsOn: LocalDate, endsOn: LocalDate, weekdays: readonly number[], pausedWeeks: readonly WeekKey[] = []): LocalDate[] {
  const days = new Set(weekdays.filter((d) => d >= 0 && d <= 4));
  if (!days.size || !startsOn || !endsOn || endsOn < startsOn) return [];
  const cap = addDays(monday(startsOn), MAX_PLAN_WEEKS * 7 - 1);
  const end = endsOn < cap ? endsOn : cap;
  const paused = new Set(pausedWeeks);
  const out: LocalDate[] = [];
  for (let day = startsOn; day <= end; day = addDays(day, 1)) {
    if (!days.has(weekday(day)) || !isWorkingDay(day) || paused.has(isoWeek(day).key)) continue;
    out.push(day);
  }
  return out;
}

/** Namnen på veckodagarna i planen (måndag–fredag). */
export const PLAN_WEEKDAYS = [0, 1, 2, 3, 4] as const;
