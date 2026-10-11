// Automatisk närvaro (Karims beslut 1, 2026-10-09): "Närvaron ska registreras automatiskt om inget annat sägs, frånvaro ska
// manuellt registreras." Ren domänlogik utan I/O: vilka tillfällen ska få Närvarande med källan "auto" när dagen är slut.
// Hanteraren (src/features/_shared/auto-attendance.ts) läser data med ctx.system, anropar autoAttendanceDue och skriver raderna.
//
// Reglerna (samma i jobbet auto_attendance, i minnesläget och vid "Kör nu"):
//   * dagen är slut: organisationens klockslag (attendance.autoPresentAt, standard 18:00 Stockholmstid) har passerat den dagen,
//     och själva tillfället har slutat (start + längd)
//   * tillfället saknar närvaro – en registrerad rad (närvaro eller frånvaro, manuell eller automatisk) ändras aldrig
//   * ärendet pågår (status active), dagen ligger inom insatsen (start- och slutdatum) och veckan är inte pausad
//   * dagen är ingen helgdag (tabellen holidays)
//   * veckans veckorapport till handläggaren är inte redan skickad – en skickad rapport ändras aldrig i efterhand
//   * jobbet tar igen missade dagar i innevarande och föregående vecka (från måndag förra veckan)
//   * floor (minnesläget och testmiljöns automatiska körningar): dagar som slutade senast då räknas inte – testdatat är
//     komplett dit, så nyinläst testdata får ingen automatisk närvaro. Produktionen och "Kör nu": inget golv.
import type { Activity, Case } from "@/data/schema";
import { addDays, addMinutes, dayOf, isoWeek, monday, type LocalDate, type LocalDateTime, type WeekKey } from "./time";

export type AutoAttendanceCase = Pick<Case, "id" | "contractId" | "status" | "referrerId" | "pausedWeeks" | "startDate" | "endDate">;
export type AutoAttendanceActivity = Pick<Activity, "id" | "caseId" | "startsAt" | "durationMin">;

export type AutoAttendanceInput = {
  now: LocalDateTime;
  /** Klockslaget då dagen räknas som slut ("18:00"). */
  at: string;
  cases: readonly AutoAttendanceCase[];
  activities: readonly AutoAttendanceActivity[];
  /** Tillfällen som redan har en närvarorad. */
  registered: ReadonlySet<string>;
  /** Helgdagar (holidays.date). */
  holidays: ReadonlySet<LocalDate>;
  /** Skickade veckorapporter: sentWeekKey(avtal, handläggare, vecka). */
  sentWeeks: ReadonlySet<string>;
  /** Dagar som slutade senast här räknas inte (minnesläget och testmiljön). null = inget golv. */
  floor?: LocalDateTime | null;
};

export type AutoAttendanceDue = { activityId: string; caseId: string; contractId: string; referrerId: string | null; day: LocalDate; weekKey: WeekKey };

/** Nyckeln för en skickad veckorapport. */
export const sentWeekKey = (contractId: string, recipientId: string, weekKey: WeekKey): string => `${contractId}|${recipientId}|${weekKey}`;
/** Första dagen jobbet tar igen: måndag förra veckan (innevarande och föregående vecka). */
export const autoAttendanceFrom = (now: LocalDateTime): LocalDate => addDays(monday(dayOf(now)), -7);
/** När dagen räknas som slut: dagens datum och organisationens klockslag. */
export const dayEndsAt = (day: LocalDate, at: string): LocalDateTime => `${day}T${at}`;
/** Nästa tidpunkt efter t då en dag tar slut (samma dag om klockslaget inte passerat, annars nästa dag). */
export function nextDayEnd(t: LocalDateTime, at: string): LocalDateTime {
  const today = dayEndsAt(dayOf(t), at);
  return today > t ? today : dayEndsAt(addDays(dayOf(t), 1), at);
}

/** Tillfällena som ska få Närvarande automatiskt, i tidsordning (se reglerna överst i filen). */
export function autoAttendanceDue(input: AutoAttendanceInput): AutoAttendanceDue[] {
  const { now, at } = input;
  const from = autoAttendanceFrom(now);
  const caseById = new Map(input.cases.map((c) => [c.id, c]));
  const out: (AutoAttendanceDue & { startsAt: LocalDateTime })[] = [];
  for (const a of input.activities) {
    const day = dayOf(a.startsAt);
    if (day < from) continue;
    const ends = dayEndsAt(day, at);
    if (ends > now) continue;
    if (input.floor && ends <= input.floor) continue;
    if (addMinutes(a.startsAt, a.durationMin) > now) continue;
    if (input.registered.has(a.id) || input.holidays.has(day)) continue;
    const c = caseById.get(a.caseId);
    if (!c || c.status !== "active" || !c.startDate || day < c.startDate || (c.endDate && day > c.endDate)) continue;
    const weekKey = isoWeek(day).key;
    if (c.pausedWeeks.includes(weekKey)) continue;
    if (c.referrerId && input.sentWeeks.has(sentWeekKey(c.contractId, c.referrerId, weekKey))) continue;
    out.push({ activityId: a.id, caseId: c.id, contractId: c.contractId, referrerId: c.referrerId, day, weekKey, startsAt: a.startsAt });
  }
  return out
    .sort((x, y) => (x.startsAt < y.startsAt ? -1 : x.startsAt > y.startsAt ? 1 : x.activityId < y.activityId ? -1 : x.activityId > y.activityId ? 1 : 0))
    .map(({ startsAt: _s, ...d }) => {
      void _s;
      return d;
    });
}
