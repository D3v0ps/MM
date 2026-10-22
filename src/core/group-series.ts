// Återkommande nivå- och yrkesområdesaktiviteter (Karims beslut 2026-10-22: "Nivå aktiviteterna sker 1-3 gånger i veckan") –
// ren domänlogik utan I/O. Samma regler i skärmen (texterna, valideringen), i hanterarna (aktiviteter.serieSkapa m.fl.), i
// skaparen av tillfällena (src/features/aktiviteter/audience-sync.ts ensureSeriesOccurrences) och i testdatat.
//
// En serie har veckodagar (ISO 1–5, måndag–fredag), en starttid och en längd. Tillfällena är vanliga gruppaktiviteter
// (group_activities.seriesId) som skapas från i dag och SERIES_HORIZON_DAYS dagar framåt inom [startsOn, endsOn]: aldrig på en
// helgdag (tabellen holidays), aldrig ett tillfälle som redan har startat, och aldrig ett tillfälle som redan finns – också inställda
// (de ligger kvar som rader), så att ett inställt tillfälle aldrig skapas igen.
import type { GroupActivitySeries } from "@/data/schema";
import { addDays, dayOf, weekday, type LocalDate, type LocalDateTime } from "./time";

/** Hur långt fram tillfällena skapas (dagar från i dag). */
export const SERIES_HORIZON_DAYS = 14;
/**
 * Dagtid för jobbets steg med tillfällen och inbjudningar (Stockholms tid, [start, slut)): bara då skapas nya tillfällen och
 * synkas målgrupperna – och bara då kan jobbet skicka inbjudningar till deltagare. En ny dag kommer in i fönstret vid midnatt,
 * men tillfället (och inbjudan med e-post, SMS eller utringning) skapas först vid nästa körning efter 08.00. Ingen deltagare
 * får meddelanden från systemet på natten (granskningen, tredje rundan).
 */
export const SYSTEM_SEND_DAYTIME = { start: "08:00", end: "20:00" } as const;
/** Är det dagtid (SYSTEM_SEND_DAYTIME) – får jobbet skapa tillfällen och skicka inbjudningar nu? */
export const isSystemSendTime = (now: LocalDateTime): boolean => {
  const t = now.slice(11, 16);
  return t >= SYSTEM_SEND_DAYTIME.start && t < SYSTEM_SEND_DAYTIME.end;
};
/** Veckodagarna som kan väljas (ISO: 1 = måndag … 5 = fredag). */
export const SERIES_WEEKDAYS = [1, 2, 3, 4, 5] as const;
/** Kryssrutornas etiketter (Måndag–Fredag, utskrivna – klarspråk). */
export const SERIES_WEEKDAY_LABEL: Record<number, string> = { 1: "Måndag", 2: "Tisdag", 3: "Onsdag", 4: "Torsdag", 5: "Fredag" };
const DAY: Record<number, string> = { 1: "måndag", 2: "tisdag", 3: "onsdag", 4: "torsdag", 5: "fredag" };
/** Rekommendationen i formuläret (beslutet: 1–3 gånger i veckan) – fler går att välja. */
export const SERIES_RECOMMENDED_MAX_DAYS = 3;

/** ISO-veckodagen för ett datum (1 = måndag … 7 = söndag). */
export const isoWeekday = (day: string): number => weekday(day) + 1;

/** Starttiden "HH:MM" (samma kontroll som databasen, 0035). */
export const START_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Veckodagarna sorterade och utan dubbletter – så skickas de till servern och sparas. */
export const normalizeWeekdays = (days: readonly number[]): number[] => [...new Set(days)].sort((a, b) => a - b);

/** Felet i klarspråk för veckodagarna, eller null. Minst en, högst fem, bara måndag–fredag, varje dag en gång. */
export function seriesWeekdaysError(days: readonly number[]): string | null {
  if (!days.length) return "Välj minst en veckodag.";
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 5)) return "Välj veckodagar från måndag till fredag.";
  if (new Set(days).size !== days.length) return "Varje veckodag kan bara väljas en gång.";
  return null;
}

/** Felen för en ny serie (tid, första och sista dag) – null när allt stämmer. Namn, plats och längd prövas som för en aktivitet. */
export function seriesScheduleError(s: { weekdays: readonly number[]; startTime: string; startsOn: LocalDate; endsOn: LocalDate | null }, today: LocalDate): string | null {
  const days = seriesWeekdaysError(s.weekdays);
  if (days) return days;
  if (!START_TIME_RE.test(s.startTime)) return "Välj en tid, till exempel 10.00.";
  if (s.startsOn < today) return "Första dagen kan inte vara före i dag.";
  if (s.endsOn && s.endsOn < s.startsOn) return "Sista dagen kan inte vara före första dagen.";
  return null;
}

const listSv = (xs: readonly string[]): string => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} och ${xs[xs.length - 1]}` : xs.join(""));

/** Seriens dagar och tid i klarspråk: "tisdag och torsdag 10.00", "måndag, onsdag och fredag 13.30". */
export function seriesScheduleText(weekdays: readonly number[], startTime: string): string {
  return `${listSv(normalizeWeekdays(weekdays).map((d) => DAY[d] ?? String(d)))} ${startTime.replace(":", ".")}`;
}

/** Det skaparen behöver om serien. */
export type SeriesPlan = Pick<GroupActivitySeries, "weekdays" | "startTime" | "startsOn" | "endsOn" | "endedAt">;

/**
 * Starttiderna för de tillfällen som ska skapas nu: från i dag till och med i dag + horizonDays, inom [startsOn, endsOn], på seriens
 * veckodagar, inte på helgdagar, bara tider efter now (ett tillfälle som redan har börjat skapas aldrig – det skulle få automatisk
 * närvaro) och bara tider som inte redan finns (existing: alla seriens tillfällen, också inställda). En avslutad serie får inga nya
 * tillfällen. Stigande ordning.
 */
export function seriesOccurrenceStarts(
  s: SeriesPlan,
  opts: { now: LocalDateTime; holidays: ReadonlySet<LocalDate>; existing: ReadonlySet<LocalDateTime>; horizonDays?: number },
): LocalDateTime[] {
  if (s.endedAt) return [];
  const today = dayOf(opts.now);
  const last = addDays(today, opts.horizonDays ?? SERIES_HORIZON_DAYS);
  const from = s.startsOn > today ? s.startsOn : today;
  const to = s.endsOn && s.endsOn < last ? s.endsOn : last;
  const days = new Set(s.weekdays);
  const out: LocalDateTime[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!days.has(isoWeekday(d)) || opts.holidays.has(d)) continue;
    const startsAt = `${d}T${s.startTime}`;
    if (startsAt > opts.now && !opts.existing.has(startsAt)) out.push(startsAt);
  }
  return out;
}
