// Starta insatsen en dag före det bokade första mötet (Karims beslut 2026-11-09). Ren domänlogik utan I/O.
//
// Bakgrund: en deltagare kom en vecka före det bokade första mötet, och insatsen gick inte att starta – Starta insatsen nekade
// alla startdatum före mötets dag. Beslutet: det går, när deltagaren verkligen har kommit.
//   * Startdatumet är i dag eller tidigare. En kommande dag före mötet nekas – då bokar man om första mötet i stället.
//   * Tidigast beställningens dag, och en arbetsdag (samma regel som bokningen av första mötet).
//   * Ingen av månaderna som de nya veckorna hör till är fakturerad eller godkänd (samma spärr som Ändra startdatum,
//     startChangeLock): veckorna från startdatumet till det bokade mötets vecka blir debiterbara.
//   * Ärendets nuvarande första möte är inte registrerat som ett möte som deltagaren inte kom till (prövas av hanteraren före
//     den här kontrollen – samma regel som förut), och det flyttade mötet ligger efter varje möte som deltagaren enligt en
//     registrering inte kom till: en registrering gäller bara tiden före insatsen (0040), så insatsen startar aldrig före den.
//     Ett möte senare samma dag går, som vid en ombokning.
// Följden (hanteraren arenden.caseStart): första mötet flyttas till startdagen med klockslaget ur dialogen, planerat slut räknas
// om från den dagen, kommunen får en ny version av orderbekräftelsen – och deltagaren får ingen kallelse (hen har redan kommit).
import type { Case, FirstMeetingNoShow } from "@/data/schema";
import { startChangeLock, startChangeMonths, type StartChangeBilling } from "./start-date";
import {
  addDays, dayOf, fmtDate, fmtDateTime, holidayName, isWorkingDay, monday, monthName, orderPeriodEnd, timeOf, type LocalDate, type LocalDateTime, type MonthKey,
} from "./time";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Hjälptexten under Startdatum i dialogen Starta insatsen. */
export const EARLY_START_HELP = "Tidigast beställningens dag. Kom deltagaren före det bokade mötet? Välj dagen hen kom.";

/** Startdatumet ligger före det bokade första mötets dag. */
export const isEarlyStart = (c: Pick<Case, "firstMeetingAt">, startDate: LocalDate): boolean => !!c.firstMeetingAt && startDate < dayOf(c.firstMeetingAt);

/** Det flyttade första mötet: startdagen med klockslaget ur dialogen, annars det bokade mötets klockslag. */
export function movedMeetingAt(c: Pick<Case, "firstMeetingAt">, startDate: LocalDate, time: string | null | undefined): LocalDateTime {
  const t = time && TIME.test(time) ? time : c.firstMeetingAt ? timeOf(c.firstMeetingAt) : "10:00";
  return `${startDate}T${t}`;
}

/**
 * Omfattningen som planerat slut räknas från (ur ärendet): månader ur avtalet, "annan tidsperiod" (kommunens slutdatum gäller)
 * eller en äldre beställning i veckor.
 */
export type OrderPeriodBasis = { months: number | null; other: boolean; weeks: number | null };
export const orderPeriodBasis = (c: Pick<Case, "orderPeriodMonths" | "orderPeriodReason" | "plannedEnd" | "plannedWeeks">): OrderPeriodBasis => ({
  months: c.orderPeriodMonths ?? null, other: c.orderPeriodMonths == null && !!c.orderPeriodReason && !!c.plannedEnd, weeks: c.plannedWeeks ?? null,
});

/**
 * Planerat slut räknat från en startdag (beslut 7, 2026-10-08 – samma regel som hanterarens periodFromStart): n månader ur avtalet
 * slutar dagen före samma datum n månader senare, "annan tidsperiod" behåller kommunens slutdatum och en äldre beställning i
 * veckor slutar fredagen i sista veckan. current = ärendets planerade slut i dag. Dialogen Starta insatsen visar det nya slutet
 * innan något sparas; servern räknar själv.
 */
export function plannedEndFrom(basis: OrderPeriodBasis, current: LocalDate | null, start: LocalDate): LocalDate | null {
  if (basis.months != null) return orderPeriodEnd(start, basis.months);
  if (basis.other) return current;
  if (basis.weeks) return addDays(monday(start), (basis.weeks - 1) * 7 + 4);
  return current;
}

/** Månaderna (torsdagsregeln) för veckorna som blir debiterbara: från startdatumets vecka till det bokade mötets vecka. */
export const earlyStartMonths = (c: Pick<Case, "firstMeetingAt" | "pausedWeeks">, startDate: LocalDate): MonthKey[] =>
  c.firstMeetingAt ? startChangeMonths(startDate, dayOf(c.firstMeetingAt), c.pausedWeeks) : [];

export type EarlyStartProblemCode = "start_date" | "before_order" | "not_working_day" | "invoiced" | "no_show";
export type EarlyStartProblem = { code: EarlyStartProblemCode; text: string; month?: MonthKey };

/** Reglerna som dialogen kan pröva själv (utan faktureringen och registreringarna) – samma texter som servern. */
export function earlyStartDateProblem(c: Pick<Case, "referredAt" | "firstMeetingAt">, startDate: LocalDate, today: LocalDate): EarlyStartProblem | null {
  if (!c.firstMeetingAt) return null;
  const meetingDay = dayOf(c.firstMeetingAt);
  if (startDate > today) {
    return {
      code: "start_date",
      text: `Startdatumet ligger före första mötet ${fmtDate(meetingDay)} men har inte varit än. Välj dagen deltagaren kom – i dag eller tidigare. Ska mötet hållas tidigare? Boka om första mötet.`,
    };
  }
  if (startDate < dayOf(c.referredAt)) return { code: "before_order", text: `Startdatumet kan inte vara före beställningen ${fmtDate(c.referredAt)}.` };
  if (!isWorkingDay(startDate)) return { code: "not_working_day", text: `${holidayName(startDate) || "Dagen"} är inte en arbetsdag. Välj en vardag.` };
  return null;
}

/**
 * Vad som stoppar en start före det bokade första mötet, eller null. Anropas bara när isEarlyStart är sant. I ordning:
 *   start_date       startdatumet har inte varit än (en kommande dag före mötet – boka om mötet i stället)
 *   before_order     före beställningens dag
 *   not_working_day  helg eller helgdag
 *   invoiced         en av månaderna för veckorna som blir debiterbara är fakturerad eller godkänd (startChangeLock)
 *   no_show          det flyttade mötet ligger inte efter ett möte som deltagaren enligt en registrering inte kom till
 */
export function earlyStartProblem(o: {
  c: Pick<Case, "id" | "contractId" | "referredAt" | "firstMeetingAt" | "pausedWeeks">;
  startDate: LocalDate;
  /** Det flyttade mötet (movedMeetingAt). */
  meetingAt: LocalDateTime;
  today: LocalDate;
  billing: StartChangeBilling;
  noShows: readonly Pick<FirstMeetingNoShow, "caseId" | "meetingAt">[];
}): EarlyStartProblem | null {
  const { c, startDate } = o;
  const basic = earlyStartDateProblem(c, startDate, o.today);
  if (basic) return basic;
  const lock = startChangeLock(c, earlyStartMonths(c, startDate), o.billing);
  if (lock) {
    const text = lock.kind === "invoiced"
      ? `${cap(monthName(lock.month))} är redan fakturerad. Ekonomen behöver kreditera fakturan innan insatsen kan starta ${fmtDate(startDate)}.`
      : `Fakturan för ${monthName(lock.month)} är redan godkänd av ekonomen. Insatsen kan inte starta ${fmtDate(startDate)} när månadens faktura är godkänd – kontakta ekonomen.`;
    return { code: "invoiced", text, month: lock.month };
  }
  const missed = o.noShows.filter((x) => x.caseId === c.id && x.meetingAt >= o.meetingAt).map((x) => x.meetingAt).sort().at(-1);
  if (missed) {
    return {
      code: "no_show",
      text: `Det är registrerat att deltagaren inte kom till första mötet ${fmtDateTime(missed)}. Insatsen kan inte starta före det – välj en senare dag eller ett senare klockslag för mötet.`,
    };
  }
  return null;
}
