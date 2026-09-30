// "Läs in testdata på nytt" i testmiljön (POST /api/staging/seed): töm appens tabeller med mm.reset_test_data() och läs in
// hela prototypens testdata (createSeed() + testarna) via PostgREST med service role, i batchar och i beroendeordning.
// Samma rader och kolumner som supabase/seed.sql (src/data/supabase/seed-rows.ts, toDbRow = samma namn- och tidsomvandling
// som SupabaseRepo). Skillnader mot seed.sql:
//   - personnumren krypteras med testmiljöns riktiga nycklar (ctx.crypto på servern), så att "Visa" och dubblettkontrollen
//     fungerar – testdatats påhittade nummer avkodas och krypteras om (AES-256-GCM + HMAC-SHA256)
//   - revisionsloggen töms inte (append-only): testdatats loggrader läggs bara till om de saknas
//   - testarnas profiler och medlemskap behålls (inloggningen), de läggs bara till om de saknas
// Bara påhittade uppgifter. Inga värden i felmeddelanden eller loggar – bara tabell och felkod.
import type { PnrCrypto } from "@/api/server";
import type { LocalDateTime } from "@/core/time";
import type { MemoryData } from "@/data/memory";
import type { Person, TableName, Tables } from "@/data/schema";
import { decodeTestPnr } from "@/data/seed/pnr";
import { toDbRow } from "@/data/supabase/columns";
import { profileExtras, SEED_TABLE_ORDER, seedData, TESTER_IDS } from "@/data/supabase/seed-rows";

// ---------------------------------------------------------------- Den del av supabase-js som används (fejkas i testet)
export type SeedError = { code?: string; message?: string };
export type SeedResult = { error: SeedError | null };
export interface SeedClient {
  rpc(fn: "reset_test_data", args: { p_demo_epoch: string }): PromiseLike<SeedResult>;
  from(table: string): {
    upsert(rows: Record<string, unknown>[], opts: { onConflict: string; ignoreDuplicates: boolean }): PromiseLike<SeedResult>;
  };
}

/** Fel vid inläsningen: steget (tabellen) och databasens felkod – aldrig värden. */
export class SeedLoadError extends Error {
  constructor(public readonly step: string, public readonly code: string) {
    super(`Testdatat kunde inte läsas in (${step}${code ? `, ${code}` : ""})`);
    this.name = "SeedLoadError";
  }
}

// ---------------------------------------------------------------- Raderna
/** En batch till en tabell. ignoreDuplicates: raden läggs bara till om den saknas (revisionsloggen, testarna). */
export type SeedBatch = { table: TableName; rows: Record<string, unknown>[]; ignoreDuplicates: boolean };

/** Högst så här mycket per anrop (PostgREST tar emot större, men mindre anrop håller sig säkert under gränserna). */
export const MAX_BATCH_ROWS = 1000;
export const MAX_BATCH_BYTES = 512 * 1024;

/** Testpersonens personnummer krypterat med testmiljöns nycklar (testdatat har testdatats ersättning, "test:…"). */
export function reencryptPerson(p: Person, crypto: PnrCrypto): Person {
  const pnr = p.personnummerEnc ? decodeTestPnr(p.personnummerEnc) : "";
  if (!pnr) return { ...p, personnummerEnc: "", personnummerHash: "" };
  return { ...p, personnummerEnc: crypto.encryptPnr(pnr), personnummerHash: crypto.hashPnr(pnr) };
}

function toRows(table: TableName, rows: readonly object[], crypto: PnrCrypto): Record<string, unknown>[] {
  return rows.map((r) => {
    let row = r as Record<string, unknown>;
    if (table === "persons") row = reencryptPerson(r as Person, crypto) as unknown as Record<string, unknown>;
    if (table === "profiles") row = { ...row, ...profileExtras(String(row.id)) };
    return toDbRow(row);
  });
}

function chunk(table: TableName, rows: Record<string, unknown>[], ignoreDuplicates: boolean): SeedBatch[] {
  const out: SeedBatch[] = [];
  let cur: Record<string, unknown>[] = [];
  let bytes = 0;
  for (const r of rows) {
    const n = JSON.stringify(r).length;
    if (cur.length && (cur.length >= MAX_BATCH_ROWS || bytes + n > MAX_BATCH_BYTES)) {
      out.push({ table, rows: cur, ignoreDuplicates });
      cur = [];
      bytes = 0;
    }
    cur.push(r);
    bytes += n;
  }
  if (cur.length) out.push({ table, rows: cur, ignoreDuplicates });
  return out;
}

/** Alla batchar i beroendeordning (seed.sql:s ordning). */
export function seedBatches(crypto: PnrCrypto, data: MemoryData<Tables> = seedData()): SeedBatch[] {
  const out: SeedBatch[] = [];
  for (const table of SEED_TABLE_ORDER) {
    const all = data[table] as readonly object[];
    if (!all.length) continue;
    // Testarnas rader behålls av mm.reset_test_data() och läggs bara till om de saknas (inloggningskopplingen ändras inte).
    const isTesterRow = (r: object) =>
      (table === "profiles" && TESTER_IDS.has(String((r as { id: string }).id))) || (table === "memberships" && TESTER_IDS.has(String((r as { userId: string }).userId)));
    const testers = all.filter(isTesterRow);
    const rest = all.filter((r) => !isTesterRow(r));
    // Revisionsloggen töms aldrig: testdatats loggrader läggs bara till om de saknas (append-only, inga ändringar).
    out.push(...chunk(table, toRows(table, rest, crypto), table === "audit_log"));
    out.push(...chunk(table, toRows(table, testers, crypto), true));
  }
  return out;
}

// ---------------------------------------------------------------- Inläsningen
export type LoadSummary = { rows: number; tables: number; requests: number; perTable: Partial<Record<TableName, number>> };

/**
 * Töm och läs in. Raderna (och krypteringen) förbereds först, så att ett fel där – t.ex. saknade nycklar – stoppar innan
 * något töms. Inläsningen är inte en transaktion: avbryts den kan testaren bara köra den igen (den börjar alltid med att tömma).
 */
export async function loadTestData(client: SeedClient, o: { crypto: PnrCrypto; demoStart: LocalDateTime; data?: MemoryData<Tables> }): Promise<LoadSummary> {
  const batches = seedBatches(o.crypto, o.data);
  const reset = await client.rpc("reset_test_data", { p_demo_epoch: o.demoStart });
  if (reset.error) throw new SeedLoadError("reset_test_data", String(reset.error.code ?? ""));
  const perTable: Partial<Record<TableName, number>> = {};
  let rows = 0;
  for (const b of batches) {
    const { error } = await client.from(b.table).upsert(b.rows, { onConflict: "id", ignoreDuplicates: b.ignoreDuplicates });
    if (error) throw new SeedLoadError(b.table, String(error.code ?? ""));
    perTable[b.table] = (perTable[b.table] ?? 0) + b.rows.length;
    rows += b.rows.length;
  }
  return { rows, tables: Object.keys(perTable).length, requests: batches.length + 1, perTable };
}
