// "Läs in testdata på nytt" mot riktiga migrationer (PGlite): bootstrap-staging.sql, mm.reset_test_data() och inläsningen i
// batchar via en fejkad PostgREST-klient (upsert som PostgREST: insert … on conflict (id) do update / do nothing, raderna via
// json_populate_recordset med samma namn- och tidsomvandling som SupabaseRepo). Radantalen jämförs med createSeed() + testarna.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { createSeed, DEMO_START, decodeTestPnr } from "@/data/seed";
import { TABLE_NAMES } from "@/data/schema";
import { asUser, attempt, createMigratedDatabase, type Tx } from "@/data/supabase/pglite";
import { authUserIdFor, BOOTSTRAP_TABLES, seedData, TESTERS } from "@/data/supabase/seed-rows";
import { bootstrapSql } from "../../../scripts/db/seed-sql";
import { loadTestData, MAX_BATCH_BYTES, SeedLoadError, seedBatches, type SeedClient } from "./load";

vi.mock("server-only", () => ({}));
const { pnrCryptoFromKeys } = await import("../crypto");

const key = (s: string) => createHash("sha256").update(s).digest();
const CRYPTO = pnrCryptoFromKeys(key("testmiljö-kryptering"), key("testmiljö-hmac"));
const KARIM_AUTH = "aaaaaaaa-0000-4000-8000-000000000001";

/** PostgREST-klienten (rpc + upsert) mot en transaktion, som service role. */
function pgClient(tx: Tx): SeedClient & { calls: { table: string; rows: number; ignore: boolean }[] } {
  const calls: { table: string; rows: number; ignore: boolean }[] = [];
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return { error: null };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return { error: { code: err.code ?? "", message: err.message ?? "" } };
    }
  };
  return {
    calls,
    rpc: (fn, args) => run(async () => {
      // savepoint: ett fel i funktionen ska inte förstöra resten av transaktionen (som PostgREST, ett anrop per transaktion)
      const a = await attempt(tx, `select public.${fn}($1)`, [args.p_demo_epoch], { keep: true });
      if (!a.ok) throw Object.assign(new Error(a.message), { code: a.code });
    }),
    from: (table) => ({
      upsert: (rows, opts) => run(async () => {
        calls.push({ table, rows: rows.length, ignore: opts.ignoreDuplicates });
        const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
        const list = cols.map((c) => `"${c}"`).join(", ");
        const conflict = opts.ignoreDuplicates
          ? "do nothing"
          : `do update set ${cols.filter((c) => c !== "id").map((c) => `"${c}" = excluded."${c}"`).join(", ")}`;
        const a = await attempt(
          tx,
          `insert into public.${table} (${list}) select ${list} from json_populate_recordset(null::public.${table}, $1::json) on conflict (${opts.onConflict}) ${conflict}`,
          [JSON.stringify(rows)],
          { keep: true },
        );
        if (!a.ok) throw Object.assign(new Error(a.message), { code: a.code });
      }),
    }),
  };
}

const asService = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, null, fn, { role: "service_role" });
const COUNT_SQL = TABLE_NAMES.map((t) => `select '${t}' as t, count(*)::int as n from public.${t}`).join(" union all ");
async function counts(tx: Tx): Promise<Record<string, number>> {
  const r = await tx.query<{ t: string; n: number }>(COUNT_SQL);
  return Object.fromEntries(r.rows.map((x) => [x.t, x.n]));
}
const expected = (): Record<string, number> => {
  const d = seedData();
  return Object.fromEntries(TABLE_NAMES.map((t) => [t, (d[t] as unknown[]).length]));
};

let db: PGlite;
beforeAll(async () => {
  db = await createMigratedDatabase();
  // Karim har loggat in en gång (kontot finns i auth.users) – bootstrap kopplar profilen via e-postadressen.
  await db.query("insert into auth.users (id, email) values ($1, $2)", [KARIM_AUTH, "karim.khalil@miljonbemanning.se"]);
  await db.exec(bootstrapSql());
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("bootstrap-staging.sql", () => {
  it("filen i repot är genererad från nuvarande testdata (npx tsx scripts/db/generate-bootstrap.ts) och är liten", () => {
    const file = readFileSync(new URL("../../../supabase/bootstrap-staging.sql", import.meta.url), "utf8");
    expect(file).toBe(bootstrapSql());
    expect(file.length).toBeLessThan(64 * 1024);
  });

  it("lägger in organisationer, avtal, områden, priser, helgdagar, testarna och testmiljöns inställningar", async () => {
    const seed = createSeed();
    await asService(async (tx) => {
      const n = await counts(tx);
      for (const t of BOOTSTRAP_TABLES) expect(n[t], t).toBe((seed[t] as unknown[]).length);
      expect(n.profiles).toBe(TESTERS.length);
      expect(n.memberships).toBe(TESTERS.length * 2);
      expect(n.cases).toBe(0);
      const s = await tx.query<{ key: string; value: string }>("select key, value from public.app_settings order by key");
      expect(Object.fromEntries(s.rows.map((r) => [r.key, r.value]))).toMatchObject({ environment: "staging", clock_demo_epoch: DEMO_START });
      const p = await tx.query<{ id: string; auth_user_id: string | null; is_tester: boolean }>("select id, auth_user_id, is_tester from public.profiles order by id");
      expect(p.rows).toEqual([
        { id: "tester-ali", auth_user_id: null, is_tester: true },
        { id: "tester-karim", auth_user_id: KARIM_AUTH, is_tester: true },
      ]);
    });
  });

  it("kan köras igen utan fel och utan att ändra något (idempotent)", async () => {
    const before = await asService(counts);
    await db.exec(bootstrapSql());
    expect(await asService(counts)).toEqual(before);
    const k = await db.query<{ auth_user_id: string }>("select auth_user_id from public.profiles where id = 'tester-karim'");
    expect(k.rows[0].auth_user_id).toBe(KARIM_AUTH);
  });
});

describe("batcharna", () => {
  it("alla rader, i seed.sql:s ordning, med krypterade personnummer och inga batchar över gränsen", () => {
    const batches = seedBatches(CRYPTO);
    const total = batches.reduce((n, b) => n + b.rows.length, 0);
    expect(total).toBe(Object.values(expected()).reduce((a, b) => a + b, 0));
    for (const b of batches) expect(JSON.stringify(b.rows).length).toBeLessThan(MAX_BATCH_BYTES + 64 * 1024);
    const order = [...new Set(batches.map((b) => b.table))];
    expect(order.indexOf("buyer_references")).toBeLessThan(order.indexOf("profiles"));
    expect(order.indexOf("persons")).toBeLessThan(order.indexOf("cases"));
    // Bara revisionsloggen och testarnas rader läggs in med "do nothing".
    expect([...new Set(batches.filter((b) => b.ignoreDuplicates).map((b) => b.table))].sort()).toEqual(["audit_log", "memberships", "profiles"]);
    const persons = batches.filter((b) => b.table === "persons").flatMap((b) => b.rows);
    expect(persons.every((p) => !String(p.personnummer_enc).startsWith("test:"))).toBe(true);
  });

  it("saknade nycklar stoppar innan något töms", async () => {
    const broken = { ...CRYPTO, encryptPnr: () => { throw new Error("MM_PNR_KEY saknas"); } };
    let resetCalled = false;
    const client: SeedClient = { rpc: async () => ((resetCalled = true), { error: null }), from: () => ({ upsert: async () => ({ error: null }) }) };
    await expect(loadTestData(client, { crypto: broken, demoStart: DEMO_START })).rejects.toThrow("MM_PNR_KEY saknas");
    expect(resetCalled).toBe(false);
  });
});

describe("inläsningen (mm.reset_test_data + upsert i batchar)", () => {
  it("ger exakt testdatats radantal i varje tabell, personnummer som går att dekryptera och testklockan på DEMO_START", async () => {
    await asService(async (tx) => {
      const client = pgClient(tx);
      const summary = await loadTestData(client, { crypto: CRYPTO, demoStart: DEMO_START });
      const want = expected();
      expect(await counts(tx)).toEqual(want);
      expect(summary.rows).toBe(Object.values(want).reduce((a, b) => a + b, 0));
      expect(summary.requests).toBe(client.calls.length + 1);
      expect(summary.requests).toBeLessThan(120);

      // Personnummer: krypterade med testmiljöns nyckel, samma nummer som testdatat, sökhash med HMAC.
      const seed = createSeed();
      const r = await tx.query<{ id: string; personnummer_enc: string; personnummer_hash: string; personnummer_last4: string }>(
        "select id, personnummer_enc, personnummer_hash, personnummer_last4 from public.persons order by id",
      );
      const byId = new Map(seed.persons.map((p) => [p.id, p]));
      let withPnr = 0;
      for (const row of r.rows) {
        const orig = byId.get(row.id)!;
        const pnr = orig.personnummerEnc ? decodeTestPnr(orig.personnummerEnc) : "";
        expect(row.personnummer_last4).toBe(orig.personnummerLast4);
        if (!pnr) {
          expect(row.personnummer_enc).toBe("");
          continue;
        }
        withPnr++;
        expect(row.personnummer_enc.startsWith("v1:")).toBe(true);
        expect(row.personnummer_enc).not.toContain(pnr.replace(/\D/g, "").slice(-4));
        expect(CRYPTO.decryptPnr(row.personnummer_enc)).toBe(pnr);
        expect(row.personnummer_hash).toBe(CRYPTO.hashPnr(pnr));
      }
      expect(withPnr).toBeGreaterThan(200);

      // Testpersonernas profiler får samma deterministiska auth_user_id som seed.sql; Karims inloggning finns kvar.
      const p = await tx.query<{ id: string; auth_user_id: string | null; is_tester: boolean }>("select id, auth_user_id, is_tester from public.profiles");
      for (const row of p.rows) {
        if (row.id === "tester-karim") expect(row).toMatchObject({ auth_user_id: KARIM_AUTH, is_tester: true });
        else if (row.id === "tester-ali") expect(row).toMatchObject({ auth_user_id: null, is_tester: true });
        else expect(row).toMatchObject({ auth_user_id: authUserIdFor(row.id), is_tester: false });
      }

      // Tider läses tillbaka som samma lokala tid (Stockholm) som i testdatat.
      const c = await tx.query<{ t: string }>("select to_char(referred_at, 'YYYY-MM-DD\"T\"HH24:MI') as t from public.cases where id = 'case-270048'");
      expect(c.rows[0].t).toBe(seed.cases.find((x) => x.id === "case-270048")!.referredAt);
      const s = await tx.query<{ value: string }>("select value from public.app_settings where key = 'clock_demo_epoch'");
      expect(s.rows[0].value).toBe(DEMO_START);
    });
  }, 120_000);

  it("kan köras igen: allt som testats nollställs, revisionsloggen och testarna finns kvar", async () => {
    await asService(async (tx) => {
      const client = pgClient(tx);
      await loadTestData(client, { crypto: CRYPTO, demoStart: DEMO_START });
      // Testaren har arbetat: ändrat ett ärende, skapat ett nytt, ändrat avtalet, loggats och valt testperson.
      await tx.exec(`
        update public.cases set status = 'closed' where id = 'case-270048';
        insert into public.persons (id, personnummer_enc, personnummer_hash, personnummer_last4, first_name, last_name, phone, email, city, preferred_contact, protected_identity, accessibility_needs, language, needs_interpreter)
          values ('p-ny', '', '', '', 'Test', 'Testsson', '', '', '', 'sms', false, '', 'svenska', false);
        insert into public.cases (id, case_number, contract_id, person_id, status, source, referred_at, vocational_track, phase, background_info, ai_consent_status, location, paused_weeks)
          values ('case-ny', 'BOT-27-9999', 'c-bot', 'p-ny', 'received', 'portal', '2027-02-01T10:00', '', 0, '', 'unknown', '', '{}');
        update public.contracts set name = 'Ändrat namn' where id = 'c-bot';
        insert into public.audit_log (id, occurred_at, actor_id, action, entity, entity_id, contract_id, details)
          values ('log-testaren', '2027-02-01T10:00', 'tester-karim', 'case.update', 'case', 'case-270048', 'c-bot', '{}');
        update public.app_settings set value = '2027-03-01T08:00' where key = 'clock_demo_epoch';
      `);
      await tx.query("insert into public.tester_sessions (auth_user_id, profile_id, role) values ($1, 'u-sara', 'samordnare')", [KARIM_AUTH]);

      await loadTestData(client, { crypto: CRYPTO, demoStart: DEMO_START });
      const want = expected();
      const n = await counts(tx);
      expect({ ...n, audit_log: 0 }).toEqual({ ...want, audit_log: 0 });
      // Revisionsloggen töms aldrig: testdatats rader + testarens rad.
      expect(n.audit_log).toBe(want.audit_log + 1);
      expect((await tx.query("select 1 from public.cases where id = 'case-ny'")).rows).toHaveLength(0);
      expect((await tx.query<{ status: string }>("select status from public.cases where id = 'case-270048'")).rows[0].status).toBe(
        createSeed().cases.find((c) => c.id === "case-270048")!.status,
      );
      expect((await tx.query<{ name: string }>("select name from public.contracts where id = 'c-bot'")).rows[0].name).toBe(createSeed().contracts.find((c) => c.id === "c-bot")!.name);
      expect((await tx.query<{ value: string }>("select value from public.app_settings where key = 'clock_demo_epoch'")).rows[0].value).toBe(DEMO_START);
      // Testarens val av testperson och inloggning finns kvar (samma id:n efter inläsningen).
      expect((await tx.query("select 1 from public.tester_sessions where auth_user_id = $1", [KARIM_AUTH])).rows).toHaveLength(1);
      expect((await tx.query<{ auth_user_id: string }>("select auth_user_id from public.profiles where id = 'tester-karim'")).rows[0].auth_user_id).toBe(KARIM_AUTH);
    });
  }, 120_000);

  it("gör ingenting och kastar fel utanför testmiljön", async () => {
    await asService(async (tx) => {
      await loadTestData(pgClient(tx), { crypto: CRYPTO, demoStart: DEMO_START });
      const before = await counts(tx);
      for (const env of ["production", null]) {
        await tx.exec("delete from public.app_settings where key = 'environment'");
        if (env) await tx.query("insert into public.app_settings (key, value) values ('environment', $1)", [env]);
        await expect(loadTestData(pgClient(tx), { crypto: CRYPTO, demoStart: DEMO_START })).rejects.toBeInstanceOf(SeedLoadError);
        const a = await attempt(tx, "select public.reset_test_data($1)", [DEMO_START]);
        expect(a).toMatchObject({ ok: false, code: "42501" });
        expect(await counts(tx)).toEqual(before);
      }
    });
  }, 120_000);

  it("bara service role får anropa den", async () => {
    for (const role of ["authenticated", "anon"] as const) {
      await asUser(db, role === "authenticated" ? KARIM_AUTH : null, async (tx) => {
        for (const fn of ["public.reset_test_data", "mm.reset_test_data"]) {
          const a = await attempt(tx, `select ${fn}($1)`, [DEMO_START]);
          expect(a.ok, `${role} ${fn}`).toBe(false);
          if (!a.ok) expect(["42501", "3F000"]).toContain(a.code);
        }
      }, { role });
    }
  });

  it("felaktig starttid stoppas", async () => {
    await asService(async (tx) => {
      const a = await attempt(tx, "select public.reset_test_data($1)", ["1 februari"]);
      expect(a).toMatchObject({ ok: false, code: "22023" });
    });
  });
});
