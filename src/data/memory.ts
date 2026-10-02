// MemoryRepo – data i minnet. Används av prototypen (i webbläsaren) och av utvecklingsläget i Next.js.
// Behörigheten speglar Row Level Security: varje läsning filtreras genom policyn för tabellen,
// så att prototypen visar exakt det rollen skulle få se i den riktiga databasen.
import type { Actor } from "@/api/roles";
import { applyOpts, matches, pickFields, pickRow, PolicyError, type ListOpts, type Repo, type Row, type Table, type Where } from "./repo";

export type MemoryData<TT extends Record<string, Row>> = { [N in keyof TT]: TT[N][] };

/** Policy för en tabell: får aktören läsa/skriva raden? `raw` ger ofiltrerad åtkomst för uppslag (t.ex. radens ärende). */
export type RowPolicy<TT extends Record<string, Row>, T extends Row> = {
  read(row: T, actor: Actor, raw: RawAccess<TT>): boolean;
  write?(row: T, actor: Actor, raw: RawAccess<TT>): boolean;
};
export type Policies<TT extends Record<string, Row>> = { [N in keyof TT]?: RowPolicy<TT, TT[N]> };

/** Ofiltrerad synkron åtkomst – bara för policyer och uppslag inom datalagret. */
export type RawAccess<TT extends Record<string, Row>> = {
  get<N extends keyof TT & string>(name: N, id: string): TT[N] | undefined;
  all<N extends keyof TT & string>(name: N): readonly TT[N][];
};

export { PolicyError };

/** Datat plus index på id. Delas mellan flera repo-instanser (en per aktör och anrop). */
export class MemoryStore<TT extends Record<string, Row>> {
  private byId = new Map<string, Map<string, Row>>();
  /** Ökas vid varje skrivning – används för att veta när frågor behöver räknas om. */
  version = 0;

  constructor(public data: MemoryData<TT>) {
    for (const name of Object.keys(data)) this.reindex(name);
  }
  private reindex(name: string) {
    const m = new Map<string, Row>();
    for (const r of (this.data as Record<string, Row[]>)[name] ?? []) m.set(r.id, r);
    this.byId.set(name, m);
  }
  raw(): RawAccess<TT> {
    return {
      get: (name, id) => this.byId.get(name)?.get(id) as never,
      all: (name) => ((this.data as Record<string, Row[]>)[name] ?? []) as never,
    };
  }
  rows<N extends keyof TT & string>(name: N): TT[N][] {
    return ((this.data as Record<string, Row[]>)[name] ??= []) as TT[N][];
  }
  getRow<N extends keyof TT & string>(name: N, id: string): TT[N] | undefined {
    return this.byId.get(name)?.get(id) as TT[N] | undefined;
  }
  insertRow<N extends keyof TT & string>(name: N, row: TT[N]) {
    if (this.getRow(name, row.id)) throw new Error(`Dubblett-id i ${name}: ${row.id}`);
    this.rows(name).push(row);
    if (!this.byId.has(name)) this.byId.set(name, new Map());
    this.byId.get(name)!.set(row.id, row);
    this.version++;
  }
  updateRow<N extends keyof TT & string>(name: N, id: string, patch: Partial<TT[N]>): TT[N] {
    const cur = this.getRow(name, id);
    if (!cur) throw new Error(`Saknas i ${name}: ${id}`);
    Object.assign(cur, patch, { id });
    this.version++;
    return cur;
  }
  removeRow<N extends keyof TT & string>(name: N, id: string) {
    const arr = this.rows(name);
    const i = arr.findIndex((r) => r.id === id);
    if (i >= 0) arr.splice(i, 1);
    this.byId.get(name)?.delete(id);
    this.version++;
  }
}

const clone = <T>(v: T): T => (v == null ? v : (JSON.parse(JSON.stringify(v)) as T));

/**
 * Repo för en aktör. Läsningar filtreras genom policyn; skrivningar kontrolleras mot write-policyn om den finns.
 * Rader returneras som kopior så att gränssnitt och hanterare aldrig kan ändra datat förbi repot.
 * `bypass` (bara bakgrundsjobb och seed) motsvarar service role i produktion.
 */
export class MemoryRepo<TT extends Record<string, Row>> implements Repo<TT> {
  constructor(
    private store: MemoryStore<TT>,
    private actor: Actor,
    private policies: Policies<TT>,
    private opts: { bypass?: boolean } = {},
  ) {}

  table<N extends keyof TT & string>(name: N): Table<TT[N]> {
    const store = this.store;
    const policy = this.policies[name];
    const raw = store.raw();
    const canRead = (r: TT[N]) => this.opts.bypass || !policy || policy.read(r, this.actor, raw);
    const canWrite = (r: TT[N]) => this.opts.bypass || !policy?.write || policy.write(r, this.actor, raw);
    const visible = (where?: Where<TT[N]>) => store.rows(name).filter((r) => matches(r, where) && canRead(r));
    return {
      get: async (id) => {
        const r = store.getRow(name, id);
        return r && canRead(r) ? clone(r) : null;
      },
      list: async (where, o?: ListOpts<TT[N]>) => applyOpts(visible(where), o).map(clone),
      // Samma fält som SupabaseRepo läser – så att en hanterare som använder ett fält den inte bett om upptäcks i minnesläget.
      pick: async <K extends keyof TT[N] & string>(fields: readonly K[], where?: Where<TT[N]>, o?: ListOpts<TT[N]>) => {
        const cols = pickFields(fields, o);
        return applyOpts(visible(where), o).map((r) => clone(pickRow(r, cols)) as Pick<TT[N], K | "id">);
      },
      first: async (where, o) => clone(applyOpts(visible(where), { ...o, limit: 1 })[0] ?? null),
      count: async (where) => visible(where).length,
      insert: async (row) => {
        if (!canWrite(row)) throw new PolicyError(name);
        store.insertRow(name, clone(row));
        return clone(row);
      },
      update: async (id, patch) => {
        const cur = store.getRow(name, id);
        if (!cur || !canRead(cur)) throw new PolicyError(name);
        const next = { ...cur, ...patch, id } as TT[N];
        if (!canWrite(next)) throw new PolicyError(name);
        return clone(store.updateRow(name, id, clone(patch)));
      },
      remove: async (id) => {
        const cur = store.getRow(name, id);
        if (!cur || !canWrite(cur)) throw new PolicyError(name);
        store.removeRow(name, id);
      },
    };
  }
}
