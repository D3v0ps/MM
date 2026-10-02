// Dataåtkomst. Hanterarna (src/features/*/handlers.ts) läser och skriver bara via Repo.
// Två implementationer med samma beteende:
//   - MemoryRepo (src/data/memory.ts): prototypen och utvecklingsläget – data i minnet, behörighet via policy.ts
//   - SupabaseRepo (byggs efter godkänd plan): Postgres i Stockholm, behörighet via Row Level Security
// Filtren är deklarativa så att de kan översättas till SQL.

export type Row = { id: string };

/** Behörighet saknas för en läsning eller skrivning (RLS/policy). Blir 403 i execute(). */
export class PolicyError extends Error {
  constructor(public readonly table: string) {
    super(`Behörighet saknas för ${table}`);
  }
}
export type Cmp<V> =
  | V
  | { in: readonly V[] }
  | { neq: V }
  | { gte?: V; lte?: V; gt?: V; lt?: V }
  | { isNull: boolean };
export type Where<T> = { [K in keyof T]?: Cmp<T[K]> };
export type ListOpts<T> = { orderBy?: keyof T & string; desc?: boolean; limit?: number };

export interface Table<T extends Row> {
  get(id: string): Promise<T | null>;
  list(where?: Where<T>, opts?: ListOpts<T>): Promise<T[]>;
  /**
   * Som list, men bara de angivna fälten (och id). För listor som inte behöver hela raden – t.ex. rapporter utan
   * ögonblicksbildens jsonb. Fältet i orderBy läses också (det behövs för sorteringen).
   */
  pick<K extends keyof T & string>(fields: readonly K[], where?: Where<T>, opts?: ListOpts<T>): Promise<Pick<T, K | "id">[]>;
  first(where?: Where<T>, opts?: ListOpts<T>): Promise<T | null>;
  count(where?: Where<T>): Promise<number>;
  insert(row: T): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T>;
  remove(id: string): Promise<void>;
}

export interface Repo<TT extends Record<string, Row>> {
  table<N extends keyof TT & string>(name: N): Table<TT[N]>;
}

// ---------------------------------------------------------------- Filtrering (delas av MemoryRepo och tester)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function matches<T extends object>(row: T, where?: Where<T>): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where) as [keyof T & string, unknown][]) {
    const v = row[k] as unknown;
    if (cond === undefined) continue;
    if (isObj(cond)) {
      if ("in" in cond) { if (!(cond.in as unknown[]).includes(v)) return false; continue; }
      if ("neq" in cond) { if (v === cond.neq) return false; continue; }
      if ("isNull" in cond) { if ((v == null) !== cond.isNull) return false; continue; }
      const c = cond as { gte?: unknown; lte?: unknown; gt?: unknown; lt?: unknown };
      if (v == null) return false;
      if (c.gte !== undefined && !((v as never) >= (c.gte as never))) return false;
      if (c.lte !== undefined && !((v as never) <= (c.lte as never))) return false;
      if (c.gt !== undefined && !((v as never) > (c.gt as never))) return false;
      if (c.lt !== undefined && !((v as never) < (c.lt as never))) return false;
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}

/** Fälten som pick() läser: id, de angivna och fältet i orderBy (utan dubbletter). */
export function pickFields<T>(fields: readonly string[], opts?: ListOpts<T>): string[] {
  return [...new Set(["id", ...fields, ...(opts?.orderBy ? [opts.orderBy] : [])])];
}

/** Raden med bara de angivna fälten. */
export function pickRow<T extends object>(row: T, fields: readonly string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (f in row) out[f] = (row as Record<string, unknown>)[f];
  return out as Partial<T>;
}

export function applyOpts<T>(rows: T[], opts?: ListOpts<T>): T[] {
  let out = rows;
  if (opts?.orderBy) {
    const k = opts.orderBy;
    const dir = opts.desc ? -1 : 1;
    out = [...out].sort((a, b) => {
      const x = a[k] as never;
      const y = b[k] as never;
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return x < y ? -dir : x > y ? dir : 0;
    });
  }
  if (opts?.limit != null) out = out.slice(0, opts.limit);
  return out;
}
