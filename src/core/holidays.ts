// Svenska helgdagar och dagar som i praktiken är lediga (aftnar) – används för arbetsdagar och SLA.
// Räknas fram per år så att inga år behöver hårdkodas. I produktion speglas samma lista i tabellen `holidays`.

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function addDaysUtc(y: number, m: number, d: number, n: number): string {
  const t = new Date(Date.UTC(y, m - 1, d) + n * 864e5);
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Påskdagen enligt den gregorianska kalendern (anonym algoritm). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/** Första datumet i intervallet [fromDay, fromDay + 6] i given månad som är en viss veckodag (0 = måndag). */
function weekdayInRange(year: number, month: number, fromDay: number, weekday: number): string {
  for (let d = fromDay; d < fromDay + 7; d++) {
    const wd = (new Date(Date.UTC(year, month - 1, d)).getUTCDay() + 6) % 7;
    if (wd === weekday) return addDaysUtc(year, month, d, 0);
  }
  throw new Error("weekdayInRange: hittade ingen dag");
}

const cache = new Map<number, Record<string, string>>();

/** Alla lediga dagar ett år: { 'YYYY-MM-DD': 'Namn' }. */
export function holidaysOf(year: number): Record<string, string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const easter = easterSunday(year);
  const [ey, em, ed] = easter.split("-").map(Number);
  const midsummerEve = weekdayInRange(year, 6, 19, 4); // fredag 19–25 juni
  const [, , msd] = midsummerEve.split("-").map(Number);
  const allSaints = weekdayInRange(year, 10, 31, 5); // lördag 31 okt–6 nov
  const out: Record<string, string> = {
    [iso(year, 1, 1)]: "Nyårsdagen",
    [iso(year, 1, 6)]: "Trettondedag jul",
    [addDaysUtc(ey, em, ed, -2)]: "Långfredagen",
    [easter]: "Påskdagen",
    [addDaysUtc(ey, em, ed, 1)]: "Annandag påsk",
    [iso(year, 5, 1)]: "Första maj",
    [addDaysUtc(ey, em, ed, 39)]: "Kristi himmelsfärdsdag",
    [addDaysUtc(ey, em, ed, 49)]: "Pingstdagen",
    [iso(year, 6, 6)]: "Sveriges nationaldag",
    [midsummerEve]: "Midsommarafton",
    [addDaysUtc(year, 6, msd, 1)]: "Midsommardagen",
    [allSaints]: "Alla helgons dag",
    [iso(year, 12, 24)]: "Julafton",
    [iso(year, 12, 25)]: "Juldagen",
    [iso(year, 12, 26)]: "Annandag jul",
    [iso(year, 12, 31)]: "Nyårsafton",
  };
  cache.set(year, out);
  return out;
}

/** Namnet på helgdagen, eller null. */
export function holidayName(day: string): string | null {
  const year = Number(day.slice(0, 4));
  return holidaysOf(year)[day.slice(0, 10)] ?? null;
}
