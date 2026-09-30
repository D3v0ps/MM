// Omvandling mellan appens rader (camelCase, Stockholms lokala tid) och Postgres-rader (snake_case, timestamptz).
// Bara radens översta nivå byter namn – innehållet i jsonb-kolumner lämnas orört.
// Regler (docs/briefs 90-live-gemensamt): kolumnnamn = fältnamnet omskrivet mekaniskt till snake_case
// (caseNumber -> case_number, personnummerLast4 -> personnummer_last4, goal1 -> goal1).
import { ms, toStockholmLocal, type LocalDateTime } from "@/core/time";

const toSnakeCache = new Map<string, string>();
const toCamelCache = new Map<string, string>();

/** Fältnamn -> kolumnnamn: stor bokstav blir understreck + liten bokstav. Siffror lämnas som de är. */
export function toColumn(field: string): string {
  let c = toSnakeCache.get(field);
  if (c === undefined) {
    c = field.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
    toSnakeCache.set(field, c);
  }
  return c;
}

/** Kolumnnamn -> fältnamn. Tål även `goal_1`/`last_4` (siffra efter understreck) om en kolumn skulle heta så. */
export function toField(column: string): string {
  let f = toCamelCache.get(column);
  if (f === undefined) {
    f = column.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
    toCamelCache.set(column, f);
  }
  return f;
}

/** LocalDateTime som appen skriver: 'YYYY-MM-DDTHH:mm'. */
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
/** timestamptz som PostgREST returnerar: '2027-02-01T09:12:00+01:00', '…Z', '…+01', med eller utan bråkdelar av sekunder. */
const TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/;

export const isLocalDateTime = (v: unknown): v is LocalDateTime => typeof v === "string" && LOCAL_DATE_TIME.test(v);
export const isTimestamptz = (v: unknown): v is string => typeof v === "string" && TIMESTAMPTZ.test(v);

/** Gör om en timestamptz-sträng till ett värde som Date förstår (mellanslag -> T, '+01' -> '+01:00'). */
export function normalizeTimestamptz(v: string): string {
  let s = v.replace(" ", "T");
  const m = /([+-]\d{2})(:?)(\d{2})?$/.exec(s);
  if (m && !s.endsWith("Z")) {
    s = s.slice(0, m.index) + `${m[1]}:${m[3] ?? "00"}`;
  }
  // Date klarar högst millisekunder.
  s = s.replace(/(\.\d{3})\d+/, "$1");
  return s;
}

/** timestamptz -> LocalDateTime i Stockholm. */
export const fromTimestamptz = (v: string): LocalDateTime => toStockholmLocal(normalizeTimestamptz(v));

/**
 * LocalDateTime (Stockholm) -> ISO med rätt förskjutning (+01:00 vintertid, +02:00 sommartid).
 * Databasen körs med timezone = Europe/Stockholm och skulle tolka tiden rätt ändå, men med uttrycklig förskjutning
 * blir skrivningen rätt även om en anslutning skulle ha en annan tidszon.
 */
export function toTimestamptz(local: LocalDateTime): string {
  const base = ms(local);
  for (const off of [60, 120]) {
    if (toStockholmLocal(new Date(base - off * 60_000).toISOString()) === local) return `${local}:00${off === 60 ? "+01:00" : "+02:00"}`;
  }
  // Klockslaget finns inte (timmen som hoppas över vid sommartid) – tolka som vintertid.
  return `${local}:00+01:00`;
}

/** Ett värde på väg till databasen (radens översta nivå eller ett filtervärde). */
export const toDbValue = (v: unknown): unknown => (isLocalDateTime(v) ? toTimestamptz(v) : v);
/** Ett värde från databasen (radens översta nivå). */
export const fromDbValue = (v: unknown): unknown => (isTimestamptz(v) ? fromTimestamptz(v) : v);

/** Appens rad -> databasrad. Fält med undefined skickas inte. */
export function toDbRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue;
    out[toColumn(k)] = toDbValue(v);
  }
  return out;
}

/** Databasrad -> appens rad. */
export function fromDbRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toField(k)] = fromDbValue(v);
  return out as T;
}
