// Seeden för testmiljön och lokal utveckling: samma påhittade testdata som prototypen (createSeed()) som SQL,
// plus testarna (Karim och Ali), app_settings (miljö och testklocka) och deterministiska auth_user_id för seedens profiler.
// Används av scripts/db/generate-seed.ts (skriver supabase/seed.sql) och av RLS-testerna (src/data/supabase/rls-parity.test.ts).
import { createHash } from "node:crypto";
import type { MemoryData } from "../../src/data/memory";
import { createSeed, DEMO_START } from "../../src/data/seed";
import { TABLE_NAMES, type Membership, type Profile, type TableName, type Tables } from "../../src/data/schema";
import { COLUMNS, quoteIdent, snakeCase, type SqlType } from "./columns";

// ---------------------------------------------------------------- Deterministiska auth-id:n
/** Namnrymd för uuid v5 av profil-id (fast värde – samma id vid varje körning). */
export const AUTH_UUID_NAMESPACE = "6f1d3c2a-8b7e-4f5a-9c0d-2e4b6a8c0f1e";

/** uuid v5 (RFC 4122, SHA-1) av ett namn i en namnrymd. */
export function uuidV5(name: string, namespace: string = AUTH_UUID_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * auth_user_id för en påhittad profil i seeden. Det finns inget konto i auth.users för dem – ingen kan logga in som
 * dem; testarna agerar som dem via tester_sessions, och RLS-testerna använder id:t som JWT-claim (sub).
 */
export const authUserIdFor = (profileId: string): string => uuidV5(`profile:${profileId}`);

// ---------------------------------------------------------------- Testarna i testmiljön
/** Riktiga användare som testar i testmiljön: admin i båda avtalen och testare (kan agera som testpersoner). */
export const TESTERS: readonly { id: string; fullName: string; email: string }[] = [
  { id: "tester-karim", fullName: "Karim Khalil", email: "karim.khalil@miljonbemanning.se" },
  { id: "tester-ali", fullName: "Ali Khalil", email: "ali.khalil@miljonbemanning.se" },
];
const TESTER_CONTRACTS = ["c-bot", "c-kk"];
const TESTER_ORG = "org-mb";

export function testerProfiles(): Profile[] {
  return TESTERS.map((t) => ({
    id: t.id, organizationId: TESTER_ORG, fullName: t.fullName, email: t.email, phone: "", title: "Testare (systemadministratör)", active: true,
    lastLoginAt: null, customerUnit: null, buyerReferenceId: null, teamRole: null, invitedAt: null, invitedBy: null,
  }));
}
export function testerMemberships(): Membership[] {
  return TESTERS.flatMap((t) => TESTER_CONTRACTS.map((contractId) => ({ id: `${t.id}:${contractId}`, userId: t.id, contractId, role: "admin" as const, customerUnit: null })));
}
const TESTER_IDS = new Set(TESTERS.map((t) => t.id));

/** Testmiljöns data: prototypens testdata plus testarna. */
export function seedData(): MemoryData<Tables> {
  const data = createSeed();
  data.profiles.push(...testerProfiles());
  data.memberships.push(...testerMemberships());
  return data;
}

// ---------------------------------------------------------------- SQL
/** Tabellerna i den ordning raderna läses in (främmande nycklar: beställarreferenser före profiler). */
export const SEED_TABLE_ORDER: readonly TableName[] = (() => {
  const order: TableName[] = TABLE_NAMES.filter((t) => t !== "buyer_references");
  order.splice(order.indexOf("profiles"), 0, "buyer_references");
  return order;
})();

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
      { field: "authUserId", column: "auth_user_id", type: "uuid | null", value: (row) => (TESTER_IDS.has(String(row.id)) ? null : authUserIdFor(String(row.id))) },
      { field: "isTester", column: "is_tester", type: "boolean", value: (row) => TESTER_IDS.has(String(row.id)) },
    );
  }
  return cols;
}

/** INSERT-satser för en tabell, flera rader per sats. */
export function insertStatements(table: TableName, rows: readonly object[], batch = 250): string[] {
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
    out.push(`insert into public.${table} (${cols.map((c) => quoteIdent(c.column)).join(", ")}) values\n${values.join(",\n")};`);
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
