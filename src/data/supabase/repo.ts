// SupabaseRepo – Repo<Tables> mot Postgres via PostgREST (supabase-js). Samma beteende som MemoryRepo:
//   - läsningar filtreras av Row Level Security (användarens session) i stället för policy.ts
//   - fältnamn camelCase <-> kolumner snake_case (bara radens översta nivå; jsonb lämnas orört)
//   - tider: timestamptz <-> LocalDateTime i Stockholm (se columns.ts)
//   - Where -> PostgREST-filter med samma semantik som matches() i src/data/repo.ts (t.ex. neq släpper igenom null)
//   - fel blir PolicyError (behörighet) eller DataError – aldrig med värden eller personuppgifter i meddelandet
// Klienten skickas in utifrån: användarens klient (RLS) för ctx.repo, service role för ctx.system (src/server/runtime.ts).
import { PolicyError, UniqueError } from "../memory";
import { applyOpts, checkJsonPaths, pickFields, type JsonPaths, type ListOpts, type Repo, type Row, type Table, type Where } from "../repo";
import { fromDbRow, toColumn, toDbRow, toDbValue } from "./columns";

// ---------------------------------------------------------------- Den del av supabase-js som används (gör det lätt att fejka i tester)
export type PgError = { code?: string; message?: string; details?: string; hint?: string };
export type PgResult<T = unknown> = { data: T | null; error: PgError | null; count?: number | null };
export interface PgFilter<T = unknown> extends PromiseLike<PgResult<T>> {
  eq(column: string, value: unknown): PgFilter<T>;
  neq(column: string, value: unknown): PgFilter<T>;
  gt(column: string, value: unknown): PgFilter<T>;
  gte(column: string, value: unknown): PgFilter<T>;
  lt(column: string, value: unknown): PgFilter<T>;
  lte(column: string, value: unknown): PgFilter<T>;
  in(column: string, values: readonly unknown[]): PgFilter<T>;
  is(column: string, value: null | boolean): PgFilter<T>;
  not(column: string, operator: string, value: unknown): PgFilter<T>;
  or(filters: string): PgFilter<T>;
  order(column: string, options: { ascending: boolean; nullsFirst: boolean }): PgFilter<T>;
  range(from: number, to: number): PgFilter<T>;
  select(columns?: string): PgFilter<T>;
  maybeSingle(): PromiseLike<PgResult<T>>;
}
export interface PgTable {
  select(columns?: string, options?: { count?: "exact"; head?: boolean }): PgFilter;
  insert(values: Record<string, unknown> | Record<string, unknown>[]): PgFilter;
  update(values: Record<string, unknown>): PgFilter;
  delete(): PgFilter;
}
export interface PgClient {
  from(table: string): PgTable;
}

// ---------------------------------------------------------------- Fel
/** Databasfel som inte gäller behörighet. Meddelandet innehåller bara tabell och felkod – aldrig värden. */
export class DataError extends Error {
  constructor(public readonly table: string, public readonly code: string) {
    super(`Databasfel i ${table}${code ? ` (${code})` : ""}`);
    this.name = "DataError";
  }
}

/** Felkoder som betyder att behörighet saknas (RLS, saknad rättighet, ogiltig eller utgången inloggning). */
const POLICY_CODES = new Set(["42501", "PGRST301", "PGRST302", "PGRST303"]);

export function toRepoError(table: string, error: PgError): Error {
  const code = String(error.code ?? "");
  if (POLICY_CODES.has(code)) return new PolicyError(table);
  // Unik nyckel (23505): samma fel som MemoryStore ger, så att hanteraren kan läsa om raden. Bara nyckelns namn – aldrig värden.
  if (code === "23505") return new UniqueError(table, String(error.details ?? error.message ?? "").match(/\(([a-z_]+)\)/)?.[1] ?? "");
  return new DataError(table, code);
}

// ---------------------------------------------------------------- Filter
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Värde i ett or()-filter: strängar citeras (PostgREST: " och \ skyddas med \). */
export function orValue(v: unknown): string {
  const x = toDbValue(v);
  if (typeof x === "string") return `"${x.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return String(x);
}

/** Längsta in-lista som skickas i en fråga. Längre listor delas upp (adressen får inte bli för lång). */
export const IN_CHUNK = 200;

/** Lägg på Where-villkoren. Samma semantik som matches() i src/data/repo.ts. */
export function applyWhere<Q extends PgFilter>(q: Q, where: Record<string, unknown> | undefined): Q {
  if (!where) return q;
  let f: PgFilter = q;
  for (const [field, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    const col = toColumn(field);
    if (Array.isArray(cond)) throw new DataError(col, "filter_array");
    if (!isObj(cond)) {
      f = cond === null ? f.is(col, null) : f.eq(col, toDbValue(cond));
      continue;
    }
    if ("in" in cond) {
      const values = [...new Set(cond.in as readonly unknown[])];
      const nonNull = values.filter((v) => v !== null && v !== undefined);
      const withNull = nonNull.length !== values.length;
      if (!withNull) f = f.in(col, nonNull.map(toDbValue));
      else if (!nonNull.length) f = f.is(col, null);
      else f = f.or(`${col}.in.(${nonNull.map(orValue).join(",")}),${col}.is.null`);
      continue;
    }
    if ("neq" in cond) {
      // matches(): raden utesluts bara när värdet är lika – null (saknat värde) räknas som "inte lika".
      if (cond.neq === null) f = f.not(col, "is", null);
      else f = f.or(`${col}.neq.${orValue(cond.neq)},${col}.is.null`);
      continue;
    }
    if ("isNull" in cond) {
      f = cond.isNull ? f.is(col, null) : f.not(col, "is", null);
      continue;
    }
    // Intervall: matches() utesluter rader utan värde.
    const r = cond as { gte?: unknown; lte?: unknown; gt?: unknown; lt?: unknown };
    let any = false;
    if (r.gte !== undefined) { f = f.gte(col, toDbValue(r.gte)); any = true; }
    if (r.lte !== undefined) { f = f.lte(col, toDbValue(r.lte)); any = true; }
    if (r.gt !== undefined) { f = f.gt(col, toDbValue(r.gt)); any = true; }
    if (r.lt !== undefined) { f = f.lt(col, toDbValue(r.lt)); any = true; }
    if (!any) f = f.not(col, "is", null);
  }
  return f as Q;
}

/** Tom in-lista: inga rader kan matcha (frågan behöver inte skickas). */
function matchesNothing(where: Record<string, unknown> | undefined): boolean {
  if (!where) return false;
  return Object.values(where).some((c) => isObj(c) && "in" in c && Array.isArray(c.in) && c.in.length === 0);
}

/** Den längsta in-listan som är längre än IN_CHUNK – den delas upp i flera frågor. */
function oversizedIn(where: Record<string, unknown> | undefined): { field: string; values: unknown[] } | null {
  if (!where) return null;
  let best: { field: string; values: unknown[] } | null = null;
  for (const [field, c] of Object.entries(where)) {
    if (!isObj(c) || !("in" in c) || !Array.isArray(c.in)) continue;
    const values = [...new Set(c.in as unknown[])];
    if (values.length > IN_CHUNK && (!best || values.length > best.values.length)) best = { field, values };
  }
  return best;
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Sidstorlek vid hämtning. Supabase lämnar högst "max rows" (standard 1000) per svar – därför hämtas listor i sidor. */
export const PAGE_SIZE = 1000;

// ---------------------------------------------------------------- Repo
export type SupabaseRepoOpts = {
  /**
   * Läs vissa tabeller via en vy (skrivningar går till tabellen). Användarens repo läser contracts via contracts_public,
   * som döljer avtalets interna mål för kommunen (supabase/migrations/0002), och cases via cases_public, som döljer
   * detaljerna i skyddade ärenden och för ekonomen (0013). Service role läser tabellerna direkt.
   */
  readFrom?: Readonly<Record<string, string>>;
};

export class SupabaseRepo<TT extends Record<string, Row>> implements Repo<TT> {
  constructor(private readonly db: PgClient, private readonly opts: SupabaseRepoOpts = {}) {}

  table<N extends keyof TT & string>(name: N): Table<TT[N]> {
    return new SupabaseTable<TT[N]>(this.db, name, this.opts.readFrom?.[name] ?? name);
  }
}

class SupabaseTable<T extends Row> implements Table<T> {
  constructor(private readonly db: PgClient, private readonly name: string, private readonly readName: string) {}

  private fail(error: PgError): never {
    throw toRepoError(this.name, error);
  }

  async get(id: string): Promise<T | null> {
    const { data, error } = await this.db.from(this.readName).select("*").eq("id", id).maybeSingle();
    if (error) this.fail(error);
    return data ? fromDbRow<T>(data as Record<string, unknown>) : null;
  }

  async list(where?: Where<T>, opts?: ListOpts<T>): Promise<T[]> {
    return this.listColumns(where, opts, "*");
  }

  async pick<K extends keyof T & string>(fields: readonly K[], where?: Where<T>, opts?: ListOpts<T>): Promise<Pick<T, K | "id">[]> {
    return this.listColumns(where, opts, pickFields(fields, opts).map(toColumn).join(","));
  }

  async pickJson<K extends keyof T & string, J extends JsonPaths<T>>(fields: readonly K[], json: J, where?: Where<T>, opts?: ListOpts<T>): Promise<(Pick<T, K | "id"> & { [A in keyof J]: unknown })[]> {
    checkJsonPaths(json);
    // facts:snapshot->facts – PostgREST lämnar jsonb-värdet som det är (objekt, text, tal eller null). Aliaset blir snake_case
    // i frågan och camelCase i raden (fromDbRow), precis som kolumnerna.
    const paths = Object.entries(json).map(([alias, [field, ...keys]]) => `${toColumn(alias)}:${toColumn(field)}${keys.map((k) => `->${k}`).join("")}`);
    const rows = await this.listColumns(where, opts, [...pickFields(fields, opts).map(toColumn), ...paths].join(","));
    return rows as unknown as (Pick<T, K | "id"> & { [A in keyof J]: unknown })[];
  }

  private async listColumns(where: Where<T> | undefined, opts: ListOpts<T> | undefined, columns: string): Promise<T[]> {
    const w = where as Record<string, unknown> | undefined;
    if (matchesNothing(w)) return [];
    const big = oversizedIn(w);
    if (big) {
      // Dela upp den långa in-listan. Delarna är disjunkta, så resultaten kan läggas ihop och sorteras här.
      const parts = await Promise.all(chunks(big.values, IN_CHUNK).map((vs) => this.fetch({ ...w, [big.field]: { in: vs } }, { ...opts, limit: undefined }, columns)));
      return applyOpts(parts.flat(), opts);
    }
    return this.fetch(w, opts, columns);
  }

  /** Hämta alla rader som matchar, sida för sida, sorterade (orderBy, sedan id för stabil ordning). columns = select-listan. */
  private async fetch(where: Record<string, unknown> | undefined, opts?: ListOpts<T>, columns = "*"): Promise<T[]> {
    const want = opts?.limit ?? Number.POSITIVE_INFINITY;
    const out: T[] = [];
    for (let from = 0; out.length < want; from += PAGE_SIZE) {
      const size = Math.min(PAGE_SIZE, want - out.length);
      let q = applyWhere(this.db.from(this.readName).select(columns), where);
      if (opts?.orderBy) q = q.order(toColumn(opts.orderBy), { ascending: !opts.desc, nullsFirst: false });
      if (opts?.orderBy !== "id") q = q.order("id", { ascending: true, nullsFirst: false });
      const { data, error } = await q.range(from, from + size - 1);
      if (error) this.fail(error);
      const rows = (data as Record<string, unknown>[] | null) ?? [];
      for (const r of rows) out.push(fromDbRow<T>(r));
      if (rows.length < size) break;
    }
    return out;
  }

  async first(where?: Where<T>, opts?: ListOpts<T>): Promise<T | null> {
    const rows = await this.list(where, { ...opts, limit: 1 });
    return rows[0] ?? null;
  }

  async count(where?: Where<T>): Promise<number> {
    const w = where as Record<string, unknown> | undefined;
    if (matchesNothing(w)) return 0;
    const big = oversizedIn(w);
    if (big) {
      const parts = await Promise.all(chunks(big.values, IN_CHUNK).map((vs) => this.countOnce({ ...w, [big.field]: { in: vs } })));
      return parts.reduce((a, b) => a + b, 0);
    }
    return this.countOnce(w);
  }

  private async countOnce(where: Record<string, unknown> | undefined): Promise<number> {
    const { count, error } = await applyWhere(this.db.from(this.readName).select("*", { count: "exact", head: true }), where);
    if (error) this.fail(error);
    return count ?? 0;
  }

  async insert(row: T): Promise<T> {
    // Ingen läsning tillbaka: som MemoryRepo returneras raden som skrevs (och RLS behöver inte tillåta läsning av den).
    const { error } = await this.db.from(this.name).insert(toDbRow(row as unknown as Record<string, unknown>));
    if (error) this.fail(error);
    return structuredClone(row);
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const rest: Record<string, unknown> = { ...(patch as Record<string, unknown>) };
    delete rest.id;
    const values = toDbRow(rest);
    if (!Object.keys(values).length) {
      const cur = await this.get(id);
      if (!cur) throw new PolicyError(this.name);
      return cur;
    }
    // Tabeller som läses via en vy (t.ex. cases via cases_public): användaren får inte läsa alla kolumner i tabellen,
    // så ändringen returnerar bara id och raden läses sedan via vyn – samma kolumner som en vanlig läsning ger.
    const viaView = this.readName !== this.name;
    const { data, error } = await this.db.from(this.name).update(values).eq("id", id).select(viaView ? "id" : "*");
    if (error) this.fail(error);
    const rows = (data as Record<string, unknown>[] | null) ?? [];
    // Ingen rad ändrad: raden finns inte eller får inte ändras av användaren (samma som MemoryRepo).
    if (!rows.length) throw new PolicyError(this.name);
    if (viaView) {
      const row = await this.get(id);
      if (!row) throw new PolicyError(this.name);
      return row;
    }
    return fromDbRow<T>(rows[0]);
  }

  async updateIf(id: string, where: Where<T>, patch: Partial<T>): Promise<T | null> {
    const rest: Record<string, unknown> = { ...(patch as Record<string, unknown>) };
    delete rest.id;
    const values = toDbRow(rest);
    if (!Object.keys(values).length) throw new DataError(this.name, "empty_patch");
    // update … where id = ? and <where> returning: noll rader = raden matchar inte längre (eller får inte ändras).
    const viaView = this.readName !== this.name;
    const { data, error } = await applyWhere(this.db.from(this.name).update(values).eq("id", id), where as Record<string, unknown>).select(viaView ? "id" : "*");
    if (error) this.fail(error);
    const rows = (data as Record<string, unknown>[] | null) ?? [];
    if (!rows.length) return null;
    return viaView ? this.get(id) : fromDbRow<T>(rows[0]);
  }

  async remove(id: string): Promise<void> {
    const { data, error } = await this.db.from(this.name).delete().eq("id", id).select("id");
    if (error) this.fail(error);
    if (!((data as unknown[] | null) ?? []).length) throw new PolicyError(this.name);
  }
}
