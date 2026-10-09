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

export async function loadSeed(db: PGlite, sql: string = readFileSync(SEED_FILE, "utf8")): Promise<void> {
  await db.exec(sql);
}

/**
 * Seeden på en databas som bara är migrerad till en viss migration (migrationstesterna, t.ex. migration-0026.test.ts):
 * seed.sql tömmer alla tabeller i schema.ts, också de som en senare migration skapar (t.ex. role_choices från 0027). Här tas
 * tabeller som inte finns ännu bort ur truncate-satsen. Finns det rader att läsa in i en sådan tabell stoppas testet med ett
 * tydligt fel – då måste testet läsa in de raderna själv efter migrationen.
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
  await db.exec(out);
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
