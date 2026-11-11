// Ändra tiden för ett enskilt tillfälle utan att göra om det (Karims beslut 2026-11-11: "Vi vill kunna ändra tiden för aktiviteter
// utan att göra om och skicka ny aktivitet, kallelse måste dock följa med med uppdaterad datum/tid"). Ren domänlogik utan I/O –
// samma regler i hanteraren (arenden.activityMove) och i testerna.
//
// Ett tillfälle är deltagarens egen rad i activities (coachträff/möte, yrkesmoment, praktikdag, arbetsgivarbesök, annat) – inte en
// rad i en gruppaktivitet (den flyttas i aktivitetsvyn). Det flyttas när:
//   * ingen närvaro är registrerad för det (då har det hänt, och närvaron och veckorapporten bygger på tiden) och det inte har
//     börjat (granskningen 2026-11-11 – som gruppaktiviteterna, upcoming);
//   * den nya tiden inte har passerat, ligger inom insatsen (från startdatumet till slutdatumet eller planerat slut), är en
//     arbetsdag och inte i en vecka med uppehåll;
//   * ingen av månaderna (veckans månad enligt torsdagsregeln) för den gamla och den nya tiden är fakturerad eller godkänd av
//     ekonomen (samma spärr som Ändra startdatum, startChangeLock);
//   * deltagaren inte har ett annat tillfälle eller en gruppaktivitet som överlappar den nya tiden.
import type { Activity, Case } from "@/data/schema";
import { ACTIVITY_KIND_WORD, overlaps, slotText } from "./group-activities";
import { startChangeLock, type StartChangeBilling } from "./start-date";
import { dayOf, fmtDate, fmtWeekday, holidayName, isoWeek, isWorkingDay, monthName, weekMonthKey, type LocalDateTime, type MonthKey } from "./time";

export type ActivityMoveCode = "has_attendance" | "started" | "past" | "date" | "not_working_day" | "paused_week" | "invoiced" | "overlap";
export type ActivityMoveProblem = { code: ActivityMoveCode; text: string };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Slot = Pick<Activity, "startsAt" | "durationMin">;

/** Månaderna som flytten rör: veckans månad för den gamla och den nya tiden (torsdagsregeln), i tidsordning. */
export function activityMoveMonths(from: LocalDateTime, to: LocalDateTime): MonthKey[] {
  return [...new Set([weekMonthKey(dayOf(from)), weekMonthKey(dayOf(to))])].sort();
}

/**
 * Vad som stoppar flytten, eller null. others = ärendets övriga tillfällen (egna och gruppaktiviteternas rader) – tillfället
 * självt räknas inte.
 */
export function activityMoveProblem(o: {
  c: Pick<Case, "id" | "contractId" | "startDate" | "endDate" | "plannedEnd" | "pausedWeeks">;
  a: Pick<Activity, "id" | "startsAt">;
  to: Slot;
  now: LocalDateTime;
  registered: boolean;
  others: readonly Pick<Activity, "id" | "kind" | "startsAt" | "durationMin" | "groupActivityId">[];
  billing: StartChangeBilling;
}): ActivityMoveProblem | null {
  const { c, a, to } = o;
  if (o.registered) return { code: "has_attendance", text: "Närvaron är redan registrerad för tillfället. Tiden kan inte ändras." };
  if (a.startsAt <= o.now) return { code: "started", text: "Tillfället har redan börjat. Tiden kan inte ändras." };
  if (to.startsAt <= o.now) return { code: "past", text: "Tiden har redan passerat. Välj en senare tid." };
  const day = dayOf(to.startsAt);
  if (c.startDate && day < c.startDate) return { code: "date", text: `Tillfället kan inte ligga före startdatumet ${fmtDate(c.startDate)}.` };
  const end = c.endDate ?? c.plannedEnd;
  if (end && day > end) return { code: "date", text: `Tillfället kan inte ligga efter ${c.endDate ? "slutdatumet" : "planerat slut"} ${fmtDate(end)}.` };
  if (!isWorkingDay(day)) return { code: "not_working_day", text: `${holidayName(day) || "Dagen"} är inte en arbetsdag.` };
  const week = isoWeek(day);
  if (c.pausedWeeks.includes(week.key)) return { code: "paused_week", text: `Vecka ${week.week} är ett uppehåll i insatsen. Välj en annan vecka.` };
  const lock = startChangeLock(c, activityMoveMonths(a.startsAt, to.startsAt), o.billing);
  if (lock) {
    return {
      code: "invoiced",
      text: lock.kind === "invoiced"
        ? `${cap(monthName(lock.month))} är redan fakturerad. Tiden kan inte ändras – ekonomen behöver kreditera fakturan först.`
        : `Fakturan för ${monthName(lock.month)} är redan godkänd av ekonomen. Tiden kan inte ändras – kontakta ekonomen.`,
    };
  }
  const hit = o.others
    .filter((x) => x.id !== a.id && dayOf(x.startsAt) === day && overlaps(x, to))
    .sort((x, y) => (x.startsAt < y.startsAt ? -1 : 1))[0];
  if (hit) {
    return {
      code: "overlap",
      text: `Deltagaren har redan ${ACTIVITY_KIND_WORD[hit.kind]} ${fmtWeekday(hit.startsAt)} ${slotText(hit)}${hit.groupActivityId ? " i en gruppaktivitet" : ""}. Välj en annan tid.`,
    };
  }
  return null;
}
