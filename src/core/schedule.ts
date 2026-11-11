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

/** Veckodagarna i planen (måndag–fredag). */
export const PLAN_WEEKDAYS = [0, 1, 2, 3, 4] as const;

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

/** Ett tillfälle som planen läses av: gruppaktiviteternas rader (groupActivityId) hör till aktiviteten, aldrig till veckoplanen. */
export type PlanSource = { id?: string; kind: string; startsAt: LocalDateTime; durationMin: number; location: string; groupActivityId?: string | null };

/** Hör tillfället till deltagarens egen veckoplan? Veckoplanens typer – och inte en rad i en gruppaktivitet (t.ex. en nivåserie). */
export const isOwnPlanRow = (a: Pick<PlanSource, "kind" | "groupActivityId">): boolean =>
  (a.kind === "möte" || a.kind === "yrkesmoment" || a.kind === "praktikdag") && !a.groupActivityId;

/** En praktikperiod (placements): från och med startdagen, till och med slutdagen – utan slutdag till insatsens slut. */
export type PracticePeriod = { startsOn: LocalDate; endsOn: LocalDate | null };

/** Praktikens dag: en praktikdag inom en praktikperiod. Den hör till praktiken (praktik.placementCreate), aldrig till veckoplanen. */
export const isPracticeDay = (a: Pick<PlanSource, "kind" | "startsAt" | "groupActivityId">, periods: readonly PracticePeriod[]): boolean =>
  a.kind === "praktikdag" && !a.groupActivityId && periods.some((p) => dayOf(a.startsAt) >= p.startsOn && (!p.endsOn || dayOf(a.startsAt) <= p.endsOn));

/**
 * Det som avgör vilka tillfällen och vilka dagar veckoplanen läses av (granskningen 2026-11-11):
 *   oneOff      – tillfällen lagda med Lägg till tillfälle (activity.added): enstaka, aldrig en del av planen.
 *   practice    – ärendets praktikperioder: praktikens dagar hör till praktiken, och en dag med praktik läses inte (praktiken har
 *                 ersatt dagens yrkesmoment, praktik.placementCreate).
 *   removedDays – dagar där ett tillfälle tagits bort för hand (activity.removed): dagen säger inget om planen.
 *   pausedWeeks, startDate, end – en pausad vecka, eller en dag före start eller efter slut, läses inte.
 *   changedAt   – senaste Ändra veckoplan: dagarna till och med den dagen kan ha den gamla planen och läses inte.
 */
export type PlanContext = {
  oneOff?: ReadonlySet<string>;
  practice?: readonly PracticePeriod[];
  removedDays?: ReadonlySet<LocalDate>;
  pausedWeeks?: readonly WeekKey[];
  startDate?: LocalDate | null;
  end?: LocalDate | null;
  changedAt?: LocalDateTime | null;
};

/** Hör tillfället till veckoplanen? Ett eget tillfälle av planens typer – inte ett enstaka tillfälle och inte praktikens dag. */
export const isPlanRow = (a: PlanSource, x: PlanContext = {}): boolean =>
  isOwnPlanRow(a) && !(a.id && x.oneOff?.has(a.id)) && !isPracticeDay(a, x.practice ?? []);

/** Planens rad för ett tillfälle (veckodag, typ, klockslag, längd och plats) – samma form som normalizePlan jämför. */
export const planRowKey = (r: Pick<WeekPlanRow, "weekday" | "kind" | "time" | "durationMin" | "location">): string =>
  `${r.weekday}|${r.kind}|${r.time}|${r.durationMin}|${r.location.trim()}`;
export const activityPlanKey = (a: Pick<PlanSource, "kind" | "startsAt" | "durationMin" | "location">): string =>
  planRowKey({ weekday: weekday(a.startsAt), kind: a.kind as WeekPlanKind, time: timeOf(a.startsAt), durationMin: a.durationMin, location: a.location });

/**
 * Den gällande veckoplanen ur ärendets tillfällen (granskningen 2026-11-11: en plan som öppnas och sparas oförändrad ändrar
 * ingenting – också mitt i veckan, en vecka med en helgdag och med praktik). Varje veckodag läses i den innevarande ISO-veckan
 * från måndagen (`monday(today)`, också dagarna som har varit), annars samma veckodag nästa vecka, och så vidare: dagen hoppas
 * över när den är en helgdag, ligger i en pausad vecka, före start eller efter slut, har praktik, har ett tillfälle som tagits
 * bort för hand eller inte är efter den senaste ändringen av planen (PlanContext). Den första dagen som räknas avgör veckodagen –
 * utan planens tillfällen den dagen har veckodagen inget. Bara planens rader (isPlanRow): gruppaktiviteternas rader räknas aldrig
 * (Karims beslut 2026-11-11), inte heller enstaka tillfällen eller praktikens dagar. Räknas ingen dag läses den första veckan från
 * måndagen som har planens tillfällen. Tom lista om det inte finns några – då används avtalets standard. En veckodag kan ha flera
 * rader (sorterade på klockslag).
 */
export function planFromActivities(acts: readonly PlanSource[], today: LocalDate, x: PlanContext = {}): WeekPlanRow[] {
  const rows = acts.filter((a) => isPlanRow(a, x));
  if (!rows.length) return [];
  const practiceDays = new Set(acts.filter((a) => isPracticeDay(a, x.practice ?? [])).map((a) => dayOf(a.startsAt)));
  const paused = new Set(x.pausedWeeks ?? []);
  const changedDay = x.changedAt ? dayOf(x.changedAt) : null;
  const lastDay = dayOf(rows.reduce((m, a) => (a.startsAt > m ? a.startsAt : m), rows[0].startsAt));
  const counts = (d: LocalDate): boolean =>
    isWorkingDay(d) && !paused.has(isoWeek(d).key) && !practiceDays.has(d) && !x.removedDays?.has(d)
    && (!x.startDate || d >= x.startDate) && (!x.end || d <= x.end) && (!changedDay || d > changedDay);
  const on = (d: LocalDate) => rows.filter((a) => dayOf(a.startsAt) === d);
  const read: PlanSource[] = [];
  for (const wd of PLAN_WEEKDAYS) {
    for (let d = addDays(monday(today), wd); d <= lastDay; d = addDays(d, 7)) {
      if (!counts(d)) continue;
      read.push(...on(d));
      break;
    }
  }
  if (read.length) return toPlanRows(read);
  const next = rows.filter((a) => dayOf(a.startsAt) >= monday(today)).sort((p, q) => (p.startsAt < q.startsAt ? -1 : 1))[0];
  const first = monday(next ? next.startsAt : today);
  return toPlanRows(rows.filter((a) => dayOf(a.startsAt) >= first && dayOf(a.startsAt) < addDays(first, 7)));
}

const toPlanRows = (week: readonly PlanSource[]): WeekPlanRow[] =>
  normalizePlan(week.map((a) => ({ weekday: weekday(a.startsAt), kind: a.kind as WeekPlanKind, time: timeOf(a.startsAt), durationMin: a.durationMin, location: a.location })));

/**
 * Raderna i planen som redigeraren inte visar: Ändra veckoplan har en rad per veckodag (den första på dagen). En andra rad samma
 * dag ligger kvar när planen sparas (granskningen 2026-11-11) – den tas bort ett tillfälle i taget. Nycklar enligt planRowKey.
 */
export const hiddenPlanRows = (plan: readonly WeekPlanRow[]): Set<string> => {
  const rows = normalizePlan(plan);
  return new Set(rows.filter((r, i) => rows.findIndex((o) => o.weekday === r.weekday) !== i).map(planRowKey));
};

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
