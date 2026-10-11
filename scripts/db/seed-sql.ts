// Seeden för testmiljön och lokal utveckling: samma påhittade testdata som prototypen (createSeed()) som SQL,
// plus testarna (TESTERS), app_settings (miljö och testklocka) och deterministiska auth_user_id för seedens profiler.
// Testarnas synpunkter (TESTER_TABLES) hör inte till testdatat och töms aldrig.
// Används av scripts/db/generate-seed.ts (skriver supabase/seed.sql) och av RLS-testerna (src/data/supabase/rls-parity.test.ts).
import { defaultGroupings } from "../../src/core/groupings";
import type { MemoryData } from "../../src/data/memory";
import { DEMO_START } from "../../src/data/seed";
import type { TableName, Tables } from "../../src/data/schema";
import {
  AUTH_UUID_NAMESPACE, authUserIdFor, BOOTSTRAP_TABLES, profileExtras, SEED_TABLE_ORDER, seedData, TESTERS, testerMemberships, testerProfiles, uuidV5,
} from "../../src/data/supabase/seed-rows";
import { COLUMNS, quoteIdent, snakeCase, type SqlType } from "./columns";

// Testarna, auth-id:n och tabellordningen finns i src/data/supabase/seed-rows.ts (samma som inläsningen i appen använder).
export { AUTH_UUID_NAMESPACE, authUserIdFor, SEED_TABLE_ORDER, seedData, TESTERS, testerMemberships, testerProfiles, uuidV5 };

// ---------------------------------------------------------------- SQL
/** Tabeller som bara finns i databasen och töms när seeden körs om. */
const DB_ONLY_TABLES = ["app_settings", "tester_sessions", "login_attempts"] as const;

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** SQL-literal för ett värde i en kolumn av typen t. */
export function sqlLiteral(value: unknown, t: SqlType): string {
  if (value === null || value === undefined) {
    if (!t.endsWith("| null")) throw new Error(`null i kolumn som inte får vara null (${t})`);
    return "null";
  }
  const base = t.replace(" | null", "");
  switch (base) {
    case "text":
    case "date":
    case "timestamptz":
    case "uuid":
      if (typeof value !== "string") throw new Error(`Väntade sträng för ${base}`);
      return quote(value);
    case "boolean":
      if (typeof value !== "boolean") throw new Error("Väntade boolean");
      return value ? "true" : "false";
    case "integer":
    case "bigint":
    case "numeric":
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Väntade tal för ${base}`);
      if (base !== "numeric" && !Number.isInteger(value)) throw new Error(`Väntade heltal för ${base}`);
      return String(value);
    case "jsonb":
      return `${quote(JSON.stringify(value))}::jsonb`;
    case "text[]":
    case "date[]":
    case "integer[]": {
      if (!Array.isArray(value)) throw new Error(`Väntade lista för ${base}`);
      if (!value.length) return `'{}'::${base}`;
      const el = base === "integer[]" ? (v: unknown) => String(v) : (v: unknown) => quote(String(v));
      return `array[${value.map(el).join(", ")}]::${base}`;
    }
    default:
      throw new Error(`Okänd kolumntyp ${t}`);
  }
}

type ColumnDef = { field: string; column: string; type: SqlType; value: (row: Record<string, unknown>) => unknown };

function columnsOf(table: TableName): ColumnDef[] {
  const cols: ColumnDef[] = Object.entries(COLUMNS[table] as Record<string, SqlType>).map(([field, type]) => ({
    field, column: snakeCase(field), type, value: (row) => row[field],
  }));
  if (table === "profiles") {
    cols.push(
      { field: "authUserId", column: "auth_user_id", type: "uuid | null", value: (row) => profileExtras(String(row.id)).authUserId },
      { field: "isTester", column: "is_tester", type: "boolean", value: (row) => profileExtras(String(row.id)).isTester },
    );
  }
  return cols;
}

/**
 * ON CONFLICT-sats för idempotenta inläsningar (bootstrap-staging.sql): "nothing" eller "update" (alla kolumner utom id och
 * de som anges i keep – t.ex. profilens inloggningskoppling).
 */
export type OnConflict = { action: "nothing" } | { action: "update"; keep?: readonly string[] };

function conflictClause(table: TableName, on: OnConflict | undefined): string {
  if (!on) return "";
  if (on.action === "nothing") return "\non conflict (id) do nothing";
  const keep = new Set(["id", ...(on.keep ?? [])]);
  const cols = columnsOf(table).map((c) => c.column).filter((c) => !keep.has(c));
  return `\non conflict (id) do update set ${cols.map((c) => `${quoteIdent(c)} = excluded.${quoteIdent(c)}`).join(", ")}`;
}

/** INSERT-satser för en tabell, flera rader per sats. */
export function insertStatements(table: TableName, rows: readonly object[], batch = 250, onConflict?: OnConflict): string[] {
  if (!rows.length) return [];
  const cols = columnsOf(table);
  const known = new Set(Object.keys(COLUMNS[table]));
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += batch) {
    const values = rows.slice(i, i + batch).map((r) => {
      const row = r as Record<string, unknown>;
      for (const k of Object.keys(row)) if (!known.has(k)) throw new Error(`Fältet ${table}.${k} saknas i scripts/db/columns.ts`);
      return `  (${cols.map((c) => sqlLiteral(c.value(row), c.type)).join(", ")})`;
    });
    out.push(`insert into public.${table} (${cols.map((c) => quoteIdent(c.column)).join(", ")}) values\n${values.join(",\n")}${conflictClause(table, onConflict)};`);
  }
  return out;
}

/** Hela seed.sql. Deterministisk: samma testdata ger samma fil (realtiden sätts med now() när filen körs). */
export function seedSql(data: MemoryData<Tables> = seedData()): string {
  const all = [...SEED_TABLE_ORDER, ...DB_ONLY_TABLES].map((t) => `public.${t}`);
  const parts: string[] = [
    "-- Seed för testmiljön (staging) och lokal utveckling: bara påhittade testdata.",
    "-- GENERERAD av scripts/db/generate-seed.ts (npx tsx scripts/db/generate-seed.ts) – ändra inte för hand.",
    "-- Kör ALDRIG mot produktion: filen tömmer alla appens tabeller först (spärren nedan stoppar det).",
    "",
    "set timezone to 'Europe/Stockholm';",
    "begin;",
    "",
    "-- Spärr: bara en testmiljö (environment = staging) eller en tom databas utan inställningen får seedas.",
    "do $$",
    "begin",
    "  if exists (select 1 from public.app_settings where key = 'environment' and value <> 'staging')",
    "     or (not exists (select 1 from public.app_settings where key = 'environment') and exists (select 1 from public.cases)) then",
    "    raise exception 'seed.sql får bara köras i testmiljön (app_settings.environment = staging) eller i en tom databas';",
    "  end if;",
    "end",
    "$$;",
    "",
    "-- Töm appens tabeller (aldrig auth.*). Revisionsloggen töms bara här: triggern stoppar update och delete, inte truncate.",
    "-- Testarnas synpunkter (feedback, feedback_replies) hör inte till testdatat och töms aldrig.",
    `truncate table ${all.join(", ")} restart identity cascade;`,
    "",
  ];
  for (const table of SEED_TABLE_ORDER) {
    const rows = data[table] as readonly object[];
    parts.push(`-- ${table} (${rows.length})`);
    parts.push(...insertStatements(table, rows));
    parts.push("");
  }
  parts.push(
    "-- Testmiljön: miljö och testklocka. Klockan startar på testtiden när seeden läses in och går sedan i vanlig takt.",
    "insert into public.app_settings (key, value) values",
    "  ('environment', 'staging'),",
    `  ('clock_demo_epoch', ${quote(DEMO_START)}),`,
    `  ('clock_real_epoch', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));`,
    "",
    "-- Testarna behåller sin inloggning när seeden körs om: koppla profilen till kontot i auth.users via e-postadressen.",
    "update public.profiles p set auth_user_id = u.id",
    "from auth.users u",
    "where p.is_tester and lower(u.email) = p.email;",
    "",
    "commit;",
    "",
  );
  return parts.join("\n");
}

// ---------------------------------------------------------------- Startdata för en ny testmiljö
/**
 * supabase/bootstrap-staging.sql: det lilla startdatat som behövs för att testarna ska kunna logga in – organisationer,
 * avtal, avtalsområden, prislistor, helgdagar, grupperingarnas standardvärden (nivåerna och Vill arbeta, som 0031),
 * testarnas profiler och medlemskap, och app_settings (testmiljö + testklocka).
 * Resten av testdatat läser testaren in i appen ("Läs in testdata på nytt" i adminvyn, POST /api/staging/seed).
 * Idempotent: kan köras flera gånger (on conflict). Tömmer ingenting. Stoppar sig själv utanför testmiljön.
 */
export function bootstrapSql(data: MemoryData<Tables> = seedData()): string {
  const testers = new Set(TESTERS.map((t) => t.id));
  const parts: string[] = [
    `-- Startdata för testmiljön (staging): bara påhittade uppgifter och testarna (${TESTERS.map((t) => t.fullName.split(" ")[0]).join(", ")}).`,
    "-- GENERERAD av scripts/db/generate-bootstrap.ts (npx tsx scripts/db/generate-bootstrap.ts) – ändra inte för hand.",
    "-- Kör efter migrationerna 0001–0017. Idempotent. Kör ALDRIG mot produktion (spärren nedan stoppar det).",
    "-- Sedan: testaren loggar in och väljer \"Läs in testdata på nytt\" i adminvyn (resten av testdatat).",
    "",
    "set timezone to 'Europe/Stockholm';",
    "begin;",
    "",
    "-- Spärr: bara en testmiljö (environment = staging) eller en tom databas utan inställningen.",
    "do $$",
    "begin",
    "  if exists (select 1 from public.app_settings where key = 'environment' and value <> 'staging')",
    "     or (not exists (select 1 from public.app_settings where key = 'environment') and exists (select 1 from public.cases)) then",
    "    raise exception 'bootstrap-staging.sql får bara köras i testmiljön (app_settings.environment = staging) eller i en tom databas';",
    "  end if;",
    "end",
    "$$;",
    "",
  ];
  for (const table of BOOTSTRAP_TABLES) {
    const rows = data[table] as readonly object[];
    parts.push(`-- ${table} (${rows.length})`, ...insertStatements(table, rows, 250, { action: "update" }), "");
  }
  // Grupperingarnas standardvärden (fem nivåer och Vill arbeta, samma id som migrationen 0031): 0031 lägger bara in dem för
  // avtal som finns när migrationen körs – i en ny testmiljö kommer avtalen först här. "do nothing": namn som ändrats behålls.
  const defaultIds = new Set(data.contracts.flatMap((c) => defaultGroupings(c.id, DEMO_START).map((g) => g.id)));
  const groupings = data.groupings.filter((g) => defaultIds.has(g.id));
  parts.push(`-- groupings: standardvärdena (${groupings.length})`, ...insertStatements("groupings", groupings, 250, { action: "nothing" }), "");
  const profiles = data.profiles.filter((p) => testers.has(p.id));
  const memberships = data.memberships.filter((m) => testers.has(m.userId));
  parts.push(
    `-- Testarna (${profiles.length}): admin i båda avtalen, is_tester. Inloggningskopplingen (auth_user_id) och senaste inloggning behålls.`,
    ...insertStatements("profiles", profiles, 250, { action: "update", keep: ["auth_user_id", "last_login_at"] }),
    ...insertStatements("memberships", memberships, 250, { action: "update" }),
    "",
    "-- Testmiljön och testklockan. Klockan sätts bara om den saknas – \"Läs in testdata på nytt\" startar om den på testtiden.",
    "insert into public.app_settings (key, value) values ('environment', 'staging')",
    "on conflict (key) do update set value = excluded.value;",
    "insert into public.app_settings (key, value) values",
    `  ('clock_demo_epoch', ${quote(DEMO_START)}),`,
    `  ('clock_real_epoch', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,
    "on conflict (key) do nothing;",
    "",
    "-- Testarna behåller sin inloggning: koppla profilen till kontot i auth.users via e-postadressen (om kontot finns).",
    "update public.profiles p set auth_user_id = u.id",
    "from auth.users u",
    "where p.is_tester and p.auth_user_id is null and lower(u.email) = p.email;",
    "",
    "commit;",
    "",
  );
  return parts.join("\n");
}
