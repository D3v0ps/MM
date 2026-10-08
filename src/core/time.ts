// Datum och tid. Alla värden är "naiva" Europe/Stockholm-strängar:
//   LocalDate     'YYYY-MM-DD'
//   LocalDateTime 'YYYY-MM-DDTHH:mm'
// Internt räknas de som UTC så att tittarens eller serverns tidszon aldrig påverkar resultatet.
// Omvandling till och från timestamptz sker bara i datalagret (se toStockholmLocal nedan).
// Veckor enligt ISO 8601. Arbetsdagar räknas med svenska helgdagar.
import { holidayName as holiday } from "./holidays";

export type LocalDate = string;
export type LocalDateTime = string;
/** ISO-veckonyckel, t.ex. '2027-W04'. */
export type WeekKey = string;
/** Månadsnyckel, t.ex. '2027-01'. */
export type MonthKey = string;

export const DAY_MS = 864e5;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export const WEEKDAYS = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"] as const;
export const WEEKDAYS_SHORT = ["mån", "tis", "ons", "tor", "fre", "lör", "sön"] as const;
export const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"] as const;
export const MONTHS_SHORT = ["jan", "feb", "mars", "apr", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"] as const;

/** 'YYYY-MM-DD' | 'YYYY-MM-DDTHH:mm' -> ms (UTC-behandlat) */
export function ms(s: string | number): number {
  if (typeof s === "number") return s;
  const [date, time = "00:00"] = String(s).split("T");
  const [y, m, dd] = date.split("-").map(Number);
  const [hh, mi] = time.split(":").map(Number);
  return Date.UTC(y, m - 1, dd, hh || 0, mi || 0);
}
export function toDate(t: number): LocalDate {
  const x = new Date(t);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}
export function toDateTime(t: number): LocalDateTime {
  const x = new Date(t);
  return `${toDate(t)}T${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
}

export const dayOf = (s: string): LocalDate => String(s).slice(0, 10);
export const timeOf = (s: string): string => String(s).slice(11, 16);
export const monthKey = (s: string): MonthKey => String(s).slice(0, 7);

export function addDays<T extends string>(s: T, n: number): T {
  const hasTime = String(s).includes("T");
  const v = ms(s) + n * DAY_MS;
  return (hasTime ? toDateTime(v) : toDate(v)) as T;
}
export const addMinutes = (s: LocalDateTime, n: number): LocalDateTime => toDateTime(ms(s) + n * 60000);
/** b − a i hela dagar */
export const diffDays = (a: string, b: string): number => Math.round((ms(dayOf(b)) - ms(dayOf(a))) / DAY_MS);
/** b − a i minuter */
export const diffMinutes = (a: string, b: string): number => Math.round((ms(b) - ms(a)) / 60000);

/** 0 = måndag … 6 = söndag */
export const weekday = (s: string): number => (new Date(ms(s)).getUTCDay() + 6) % 7;
export const isWeekend = (s: string): boolean => weekday(s) >= 5;
export const holidayName = (s: string): string | null => holiday(dayOf(s));
export const isWorkingDay = (s: string): boolean => !isWeekend(s) && !holidayName(s);

/** Lägg till n arbetsdagar och behåll klockslaget (SLA "inom en arbetsdag"). */
export function addWorkingDays<T extends string>(s: T, n: number): T {
  let cur = s;
  let left = n;
  while (left > 0) {
    cur = addDays(cur, 1);
    if (isWorkingDay(cur)) left--;
  }
  return cur;
}
/** n:e arbetsdagen i en månad (n >= 1). */
export function nthWorkingDay(month: MonthKey, n: number): LocalDate {
  let cur = `${month}-01`;
  let count = isWorkingDay(cur) ? 1 : 0;
  while (count < n) {
    cur = addDays(cur, 1);
    if (isWorkingDay(cur)) count++;
  }
  return cur;
}
/** Antal arbetsdagar i (a, b]. */
export function workingDaysBetween(a: string, b: string): number {
  let n = 0;
  let cur = dayOf(a);
  const end = dayOf(b);
  while (cur < end) {
    cur = addDays(cur, 1);
    if (isWorkingDay(cur)) n++;
  }
  return n;
}

export const monday = (s: string): LocalDate => addDays(dayOf(s), -weekday(s));
export const thursday = (s: string): LocalDate => addDays(monday(s), 3);

export type IsoWeek = { year: number; week: number; key: WeekKey };
/** ISO 8601-vecka för ett datum. */
export function isoWeek(s: string): IsoWeek {
  const th = thursday(s);
  const y = Number(th.slice(0, 4));
  const week = Math.ceil(((ms(th) - Date.UTC(y, 0, 1)) / DAY_MS + 1) / 7);
  return { year: y, week, key: `${y}-W${pad(week)}` };
}
/** Måndagen i en ISO-vecka. */
export function weekMonday(key: WeekKey): LocalDate;
export function weekMonday(year: number, week: number): LocalDate;
export function weekMonday(yearOrKey: number | WeekKey, week?: number): LocalDate {
  let y: number;
  let w: number;
  if (typeof yearOrKey === "string") {
    const m = yearOrKey.match(/^(\d{4})-W(\d{2})$/);
    if (!m) throw new Error(`Ogiltig veckonyckel: ${yearOrKey}`);
    y = Number(m[1]);
    w = Number(m[2]);
  } else {
    y = yearOrKey;
    w = week ?? 1;
  }
  return addDays(monday(`${y}-01-04`), (w - 1) * 7);
}
/** Månaden som veckan faktureras i: den månad där veckans torsdag infaller (ISO-regeln). */
export const weekMonthKey = (s: string): MonthKey => thursday(s).slice(0, 7);
/** ISO-veckor vars torsdag ligger i månaden. */
export function weeksOfMonth(month: MonthKey): IsoWeek[] {
  const out: IsoWeek[] = [];
  let th = thursday(`${month}-01`);
  if (th.slice(0, 7) < month) th = addDays(th, 7);
  while (th.slice(0, 7) === month) {
    out.push(isoWeek(th));
    th = addDays(th, 7);
  }
  return out;
}
export function addMonths(month: MonthKey, n: number): MonthKey {
  let [y, m] = month.split("-").map(Number);
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  return `${y}-${pad(m)}`;
}
export function monthName(month: MonthKey): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
export const monthEnd = (month: MonthKey): LocalDate => addDays(`${addMonths(month, 1)}-01`, -1);
/** Datumet n månader senare (dagen begränsas till månadens sista dag): 2027-01-31 + 1 -> 2027-02-28. */
export function addMonthsDate(s: LocalDate, n: number): LocalDate {
  const mk = addMonths(s.slice(0, 7), n);
  const day = Math.min(Number(s.slice(8, 10)), Number(monthEnd(mk).slice(8, 10)));
  return `${mk}-${pad(day)}`;
}
/**
 * Planerat slutdatum för en insats på n månader (beslut 2026-10-07, synpunkt #5): dagen före samma datum n månader senare.
 * 2027-02-15 + 6 -> 2027-08-14. Månadens sista dag klipps först: 2027-08-31 + 6 -> 2028-02-29 -> 2028-02-28.
 */
export const orderPeriodEnd = (start: LocalDate, months: number): LocalDate => addDays(addMonthsDate(dayOf(start), months), -1);
/** Antal ISO-veckor med minst en dag i perioden (start och slut räknas med) – samma regel som debiterbara veckor. 0 om slut < start. */
export function billableWeekCount(start: LocalDate, end: LocalDate): number {
  if (end < start) return 0;
  return Math.round((ms(monday(end)) - ms(monday(start))) / (7 * DAY_MS)) + 1;
}

// ---------------------------------------------------------------- Formatering (svenska)
const parts = (s: string) => new Date(ms(s));
export function fmtDate(s?: string | null): string {
  if (!s) return "–";
  const x = parts(s);
  return `${x.getUTCDate()} ${MONTHS_SHORT[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}
export function fmtDateShort(s?: string | null): string {
  if (!s) return "–";
  const x = parts(s);
  return `${x.getUTCDate()} ${MONTHS_SHORT[x.getUTCMonth()]}`;
}
export const fmtTime = (s?: string | null): string => (s ? timeOf(s).replace(":", ".") : "–");
export const fmtDateTime = (s?: string | null): string => (s ? `${fmtDateShort(s)} kl. ${fmtTime(s)}` : "–");
/** Utan förkortningar – för kommunportalen: "1 februari 2027". */
export function fmtDateFull(s?: string | null): string {
  if (!s) return "–";
  const x = parts(s);
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}
/** "1 februari 2027 klockan 09.12" */
export const fmtDateTimeFull = (s?: string | null): string => (s ? `${fmtDateFull(s)} klockan ${fmtTime(s)}` : "–");
export const fmtDateTimeLong = (s?: string | null): string => (s ? `${WEEKDAYS[weekday(s)]} ${fmtDate(s)} kl. ${fmtTime(s)}` : "–");
export function fmtWeekday(s: string): string {
  const x = parts(s);
  return `${WEEKDAYS[weekday(s)]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
}
export const fmtWeek = (s: string): string => `v. ${isoWeek(s).week}`;
export function fmtWeekKey(key: WeekKey): string {
  const m = key.match(/^(\d{4})-W(\d{2})$/);
  return m ? `v. ${Number(m[2])} ${m[1]}` : key;
}
export function fmtWeekRange(key: WeekKey): string {
  const mon = weekMonday(key);
  return `${fmtDateShort(mon)}–${fmtDateShort(addDays(mon, 6))}`;
}
/** "om 48 min", "om 2 tim", "för 3 dagar sedan" – relativt `from`. */
export function relative(s: string, from: string): string {
  const mins = diffMinutes(from, s);
  const abs = Math.abs(mins);
  let txt: string;
  if (abs < 60) txt = `${abs} min`;
  else if (abs < 60 * 24) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    txt = m && h < 5 ? `${h} tim ${m} min` : `${h} tim`;
  } else {
    const days = Math.round(abs / 1440);
    txt = days === 1 ? "1 dag" : `${days} dagar`;
  }
  return mins >= 0 ? `om ${txt}` : `för ${txt} sedan`;
}

// ---------------------------------------------------------------- Gränssnitt mot databasen
/** timestamptz (ISO med zon) -> Stockholms lokala tid 'YYYY-MM-DDTHH:mm'. */
export function toStockholmLocal(isoWithZone: string): LocalDateTime {
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(isoWithZone)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** Nuvarande tid i Stockholm. Bara för den riktiga klockan – domänkod får tiden via ctx.now(). */
export const stockholmNow = (): LocalDateTime => toStockholmLocal(new Date().toISOString());
