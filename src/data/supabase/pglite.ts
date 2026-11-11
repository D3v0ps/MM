// Testhjälpare: en lokal Postgres (PGlite, i processen) med en minimal Supabase-stubbe, alla migrationer och seeden.
// Används av RLS-testerna (rls-parity.test.ts) – bara i tester, aldrig i appen.
//
// Stubben efterliknar det i Supabase som migrationerna och policyerna använder:
//   * rollerna anon, authenticated och service_role (service_role går förbi RLS, som i Supabase)
//   * auth.users och auth.uid() (läser sub ur request.jwt.claims, som PostgREST sätter per anrop)
//   * Supabases standardrättigheter i public (anon och authenticated får allt på nya tabeller) – så att testerna
//     visar att migrationerna tar bort dem.
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PgClient, PgFilter, PgResult } from "./repo";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const MIGRATIONS_DIR = `${ROOT}supabase/migrations`;
export const SEED_FILE = `${ROOT}supabase/seed.sql`;

export const SUPABASE_STUB_SQL = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable
as $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable
as $$ select nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role' $$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
`;

/** Migrationsfilerna i ordning (0001_…, 0002_…). */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort().map((f) => `${MIGRATIONS_DIR}/${f}`);
}

/** Ny databas med stubben och alla migrationer. Seeden läses in separat (loadSeed), efter eventuella auth-konton. */
export async function createMigratedDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(SUPABASE_STUB_SQL);
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(`Migrationen ${file.split("/").pop()} misslyckades: ${(e as Error).message}`);
    }
  }
  return db;
}

/**
 * PGlite (0.5.8) frigör inte stacken efter ett fel: varje fel som når JavaScript (en nekad sats i attempt(), ett test med
 * rejects) gör stacken lite mindre, och efter ungefär 1 700 fel stoppas också enkla satser med "stack depth limit exceeded"
 * (mätt 2026-10-10 vid integrationen av coachmötets spår – RLS-paritetstestet hade då 131 tester mot samma databas). Långa
 * testfiler tar därför en ögonblicksbild efter inläsningen och börjar om från den (databaseFromSnapshot): en kopia tar under
 * en sekund, migrationerna och seeden fem.
 */
export type DatabaseSnapshot = File | Blob;
export const snapshotDatabase = (db: PGlite): Promise<DatabaseSnapshot> => db.dumpDataDir("none");
export async function databaseFromSnapshot(snapshot: DatabaseSnapshot): Promise<PGlite> {
  const db = new PGlite({ loadDataDir: snapshot });
  await db.waitReady;
  return db;
}

export async function loadSeed(db: PGlite, sql: string = readFileSync(SEED_FILE, "utf8")): Promise<void> {
  await db.exec(sql);
}

/**
 * Seeden på en databas som bara är migrerad till en viss migration (migrationstesterna, t.ex. migration-0026.test.ts):
 * seed.sql tömmer alla tabeller i schema.ts, också de som en senare migration skapar (t.ex. role_choices från 0027). Här tas
 * tabeller som inte finns ännu bort ur truncate-satsen. Finns det rader att läsa in i en sådan tabell stoppas testet med ett
 * tydligt fel – då måste testet läsa in de raderna själv efter migrationen. Kolumner som en senare migration lägger till i en
 * befintlig tabell (t.ex. activities.group_activity_id och attendance.source från 0030) läggs till tillfälligt som text medan
 * raderna läses in och tas sedan bort – den senare migrationen lägger till dem på riktigt (med sitt standardvärde).
 */
export async function loadSeedForExistingTables(db: PGlite, sql: string = readFileSync(SEED_FILE, "utf8"), opts: { later?: readonly string[] } = {}): Promise<void> {
  const existing = new Set((await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'")).rows.map((r) => r.tablename));
  const missing = new Set<string>();
  // Tabeller från en senare migration vars rader testet inte behöver (opts.later): deras insert-satser tas bort.
  for (const t of opts.later ?? []) sql = sql.replace(new RegExp(`^insert into public\\.${t} \\([^)]*\\) values\\n[\\s\\S]*?\\);$`, "m"), "");
  const out = sql.replace(/^truncate table (.+?) restart identity cascade;$/m, (_m, list: string) => {
    const kept = list.split(", ").filter((t) => {
      const name = t.replace(/^public\./, "");
      if (existing.has(name)) return true;
      missing.add(name);
      return false;
    });
    return `truncate table ${kept.join(", ")} restart identity cascade;`;
  });
  for (const t of missing) {
    if (new RegExp(`^insert into public\\.${t} \\(`, "m").test(out)) throw new Error(`seed.sql har rader för public.${t}, som inte finns i databasen ännu – läs in dem efter migrationen i testet`);
  }
  const cols = await db.query<{ t: string; c: string }>("select table_name as t, column_name as c from information_schema.columns where table_schema = 'public'");
  const have = new Set(cols.rows.map((r) => `${r.t}.${r.c}`));
  const later = new Set<string>();
  for (const m of out.matchAll(/^insert into public\.(\w+) \(([^)]*)\) values$/gm)) {
    if (!existing.has(m[1])) continue;
    for (const c of m[2].split(", ").map((x) => x.replace(/"/g, ""))) if (!have.has(`${m[1]}.${c}`)) later.add(`${m[1]}.${c}`);
  }
  const quoted = [...later].map((x) => x.split(".")).map(([t, c]) => [`public.${t}`, `"${c}"`] as const);
  for (const [t, c] of quoted) await db.exec(`alter table ${t} add column ${c} text`);
  await db.exec(out);
  for (const [t, c] of quoted) await db.exec(`alter table ${t} drop column ${c}`);
}

export type Tx = Transaction;

/**
 * Kör fn som en inloggad användare (rollen authenticated med JWT-claim sub = authUserId, som PostgREST), eller som
 * anon (authUserId null). before körs först som postgres i samma transaktion (t.ex. för att välja testperson).
 * Transaktionen rullas alltid tillbaka – testerna lämnar inga spår.
 */
export async function asUser<T>(
  db: PGlite,
  authUserId: string | null,
  fn: (tx: Tx) => Promise<T>,
  opts: { before?: (tx: Tx) => Promise<void>; role?: "authenticated" | "anon" | "service_role" } = {},
): Promise<T> {
  let result: T | undefined;
  let failure: unknown;
  await db.transaction(async (tx) => {
    try {
      if (opts.before) await opts.before(tx);
      const role = opts.role ?? (authUserId ? "authenticated" : "anon");
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(authUserId ? { sub: authUserId, role } : { role })]);
      await tx.exec(`set local role ${role}`);
      result = await fn(tx);
    } catch (e) {
      failure = e;
    }
    await tx.rollback();
  });
  if (failure) throw failure;
  return result as T;
}

export type Attempt = { ok: true; rows: number } | { ok: false; code: string; message: string };

/**
 * Kör en sats i en savepoint och rulla tillbaka den: 'ok' med antal påverkade rader, eller felkoden
 * (42501 = behörighet saknas eller raden bryter mot en policy). keep: behåll ändringen (inom transaktionen).
 */
export async function attempt(tx: Tx, sql: string, params: readonly unknown[] = [], opts: { keep?: boolean } = {}): Promise<Attempt> {
  await tx.exec("savepoint attempt");
  try {
    const r = await tx.query(sql, [...params]);
    await tx.exec(opts.keep ? "release savepoint attempt" : "rollback to savepoint attempt");
    return { ok: true, rows: r.affectedRows ?? r.rows.length };
  } catch (e) {
    await tx.exec("rollback to savepoint attempt");
    const err = e as { code?: string; message?: string };
    return { ok: false, code: err.code ?? "", message: err.message ?? String(e) };
  }
}

/** Tillåtet enligt databasen: satsen gick igenom och påverkade minst en rad. */
export const allowed = (a: Attempt): boolean => a.ok && a.rows > 0;

// ---------------------------------------------------------------- SupabaseRepo mot PGlite
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * En PgClient (den del av supabase-js som SupabaseRepo använder) mot en transaktion i PGlite. Satserna skrivs som PostgREST
 * skriver dem: värdena kommer in som JSON (json_populate_recordset mot tabellens radtyp), filtren står mot tabellens kolumner
 * (update … where "public"."t"."id" = $n and "public"."t"."status" in (…) returning "public"."t"."id") och svaret är raderna som
 * JSON (tider som ISO-text, som i appen). Kolumnerna i set, where och returning är desamma som i produktionen – alltså krävs
 * samma rättigheter. Så kör testerna den riktiga SupabaseRepo (userRepo, appRepo) som en inloggad användare (asUser) och ser
 * det som bara databasen vet: kolumnrättigheter, policyer och triggrar.
 * Varje anrop körs i en egen savepoint (PostgREST: en transaktion per anrop) – ett fel lämnar resten av transaktionen orörd.
 * Stöder det SupabaseRepo skickar: select (kolumner, filter, ordning, range, count/head, maybeSingle), insert, update och delete
 * med filtren eq, neq, gt, gte, lt, lte, in, is och not … is null. or() stöds inte (kastar).
 */
export function postgrestClient(tx: Tx): PgClient {
  const from = (table: string) => {
    const rel = `"public".${ident(table)}`;
    const col = (c: string) => `${rel}.${ident(c.trim())}`;
    const cols = (list: string | null) => (!list || list === "*" ? `${rel}.*` : list.split(",").map(col).join(", "));
    const mk = (op: "select" | "insert" | "update" | "delete", values: unknown, columns: string | null, head = false) => {
      const st = { filters: [] as string[], params: [] as unknown[], order: [] as string[], range: null as [number, number] | null, returning: columns, single: false };
      const p = (v: unknown) => `$${st.params.push(v)}`;
      const run = async (): Promise<PgResult> => {
        const where = st.filters.length ? ` where ${st.filters.join(" and ")}` : "";
        let sql: string;
        if (op === "select") {
          const tail = `${st.order.length ? ` order by ${st.order.join(", ")}` : ""}${st.range ? ` limit ${st.range[1] - st.range[0] + 1} offset ${st.range[0]}` : ""}`;
          sql = head ? `select count(*)::int as body from ${rel}${where}` : `select coalesce(json_agg(t), '[]')::json as body from (select ${cols(st.returning)} from ${rel}${where}${tail}) t`;
        } else {
          const ret = st.returning ? ` returning ${cols(st.returning)}` : "";
          let dml: string;
          if (op === "delete") {
            dml = `delete from ${rel}${where}${ret}`;
          } else {
            const rows = (Array.isArray(values) ? values : [values]) as Record<string, unknown>[];
            const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
            const body = `(select * from json_populate_recordset(null::${rel}, ${p(JSON.stringify(rows))}::json)) pgrst_body`;
            dml = op === "insert"
              ? `insert into ${rel} (${keys.map(ident).join(", ")}) select ${keys.map((k) => `pgrst_body.${ident(k)}`).join(", ")} from ${body}${ret}`
              : `update ${rel} set ${keys.map((k) => `${ident(k)} = pgrst_body.${ident(k)}`).join(", ")} from ${body}${where}${ret}`;
          }
          sql = st.returning ? `with pgrst_source as (${dml}) select coalesce(json_agg(pgrst_source), '[]')::json as body from pgrst_source` : dml;
        }
        await tx.exec("savepoint pgrst");
        try {
          const r = await tx.query<{ body: unknown }>(sql, st.params);
          await tx.exec("release savepoint pgrst");
          if (op === "select" && head) return { data: null, error: null, count: r.rows[0].body as number };
          const rows = op !== "select" && !st.returning ? null : ((r.rows[0]?.body ?? []) as unknown[]);
          return { data: st.single ? (rows?.[0] ?? null) : rows, error: null };
        } catch (e) {
          await tx.exec("rollback to savepoint pgrst");
          const err = e as { code?: string; message?: string };
          return { data: null, error: { code: err.code ?? "", message: err.message ?? String(e) } };
        }
      };
      const cmp = (sign: string) => (c: string, v: unknown) => {
        st.filters.push(`${col(c)} ${sign} ${p(v)}`);
        return b;
      };
      const b = {
        eq: cmp("="), neq: cmp("<>"), gt: cmp(">"), gte: cmp(">="), lt: cmp("<"), lte: cmp("<="),
        in: (c: string, vs: readonly unknown[]) => {
          st.filters.push(vs.length ? `${col(c)} in (${vs.map(p).join(", ")})` : "false");
          return b;
        },
        is: (c: string, v: null | boolean) => {
          st.filters.push(`${col(c)} is ${v === null ? "null" : String(v)}`);
          return b;
        },
        not: (c: string, operator: string, v: unknown) => {
          if (operator !== "is" || v !== null) throw new Error(`postgrestClient: not(${operator}) stöds inte`);
          st.filters.push(`${col(c)} is not null`);
          return b;
        },
        or: (): never => {
          throw new Error("postgrestClient: or() stöds inte");
        },
        order: (c: string, o: { ascending: boolean; nullsFirst: boolean }) => {
          st.order.push(`${col(c)} ${o.ascending ? "asc" : "desc"} nulls ${o.nullsFirst ? "first" : "last"}`);
          return b;
        },
        range: (a: number, z: number) => {
          st.range = [a, z];
          return b;
        },
        select: (c?: string) => {
          st.returning = c ?? "*";
          return b;
        },
        maybeSingle: () => {
          st.single = true;
          return run();
        },
        then: <A, B>(res: (v: PgResult) => A, rej?: (e: unknown) => B) => run().then(res, rej),
      };
      return b as unknown as PgFilter;
    };
    return {
      select: (c?: string, o?: { count?: "exact"; head?: boolean }) => mk("select", null, c ?? "*", !!o?.head),
      insert: (v: Record<string, unknown> | Record<string, unknown>[]) => mk("insert", v, null),
      update: (v: Record<string, unknown>) => mk("update", v, null),
      delete: () => mk("delete", null, null),
    };
  };
  return { from };
}
