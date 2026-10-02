// Inloggningens spärr utan kapplöpning (SPEC §4: högst 5 försök per kod, 5 koder per adress och 20 per IP under
// 15 minuter, högst 30 misslyckade försök per IP):
//   1. mm.login_attempt_gate (supabase/migrations/0012) i PGlite ger samma svar som referensreglerna i rate-limit.ts
//      och registrerar försöket i samma anrop – innan koden prövas.
//   2. verifyCode och requestCode frågar spärren innan Supabase Auth anropas, så anrop i klump aldrig passerar fler
//      gånger än gränsen (förut: 300 samtidiga försök gav 300 anrop till Supabase Auth).
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { asUser, attempt, createMigratedDatabase, type Tx } from "@/data/supabase/pglite";
import { checkCodeRequest, checkVerify, hashesFor, LIMITS, type AttemptKind, type AttemptStore, type GateVerdict, type Hashes, type LoginGate } from "./rate-limit";

// ---------------------------------------------------------------- Spärren i minnet (referensreglerna + ett lås, som i databasen)
type Row = { id: number; kind: AttemptKind; at: string } & Hashes;
function memoryGate() {
  const rows: Row[] = [];
  const store: AttemptStore = {
    count: async (q) => rows.filter((r) => r.kind === q.kind && r.at >= q.since && (!q.emailHash || r.emailHash === q.emailHash) && (!q.ipHash || r.ipHash === q.ipHash)).length,
    lastAt: async (q) => {
      const hit = rows.filter((r) => r.kind === q.kind && r.emailHash === q.emailHash).map((r) => Date.parse(r.at));
      return hit.length ? Math.max(...hit) : null;
    },
    record: async (a) => {
      rows.push({ id: rows.length + 1, ...a });
    },
  };
  let lock: Promise<unknown> = Promise.resolve();
  const gate: LoginGate = {
    gate(a) {
      const run = lock.then(async (): Promise<{ verdict: GateVerdict; id: number | null }> => {
        const h = { emailHash: a.emailHash, ipHash: a.ipHash };
        const ms = Date.parse(a.at);
        const verdict = a.kind === "code" ? await checkCodeRequest(store, h, ms) : await checkVerify(store, h, ms);
        if (verdict !== "ok") return { verdict, id: null };
        await store.record({ kind: a.kind === "code" ? "code" : "verify_failed", at: a.at, ...h });
        return { verdict, id: rows.length };
      });
      lock = run.catch(() => undefined);
      return run;
    },
    async markVerified(id) {
      const r = rows.find((x) => x.id === id);
      if (r) r.kind = "verify_ok";
    },
  };
  return { rows, gate };
}

// ---------------------------------------------------------------- 1. Databasen
let db: PGlite;
beforeAll(async () => {
  db = await createMigratedDatabase();
}, 120_000);

const T0 = Date.UTC(2026, 8, 30, 8, 0);
const at = (ms: number) => new Date(ms).toISOString();

async function sqlGate(tx: Tx, kind: "code" | "verify", h: Hashes, ms: number): Promise<{ verdict: GateVerdict; id: number | null }> {
  const r = await tx.query<{ r: { verdict: GateVerdict; id: number | null } }>(
    "select public.login_attempt_gate($1, $2, $3, $4::timestamptz, $5::jsonb) as r",
    [kind, h.emailHash, h.ipHash, at(ms), JSON.stringify(LIMITS)],
  );
  return r.rows[0].r;
}

/** Ett förlopp: koder, försök, en lyckad inloggning och många adresser från samma IP. */
function scenario(): { kind: "code" | "verify" | "ok"; h: Hashes; ms: number }[] {
  const a = hashesFor("k", "a@botkyrka.se", "1.1.1.1");
  const out: { kind: "code" | "verify" | "ok"; h: Hashes; ms: number }[] = [];
  for (let i = 0; i < 6; i++) out.push({ kind: "code", h: a, ms: T0 + i * 1000 });
  for (let i = 0; i < 7; i++) out.push({ kind: "verify", h: a, ms: T0 + 10_000 + i * 1000 });
  // En ny kod efter en minut ger fem nya försök; det sista lyckas och räknas inte som misslyckat.
  out.push({ kind: "code", h: hashesFor("k", "a@botkyrka.se", "1.1.1.1"), ms: T0 + 16 * 60_000 });
  for (let i = 0; i < 4; i++) out.push({ kind: "verify", h: a, ms: T0 + 16 * 60_000 + (i + 1) * 1000 });
  out.push({ kind: "ok", h: a, ms: T0 + 16 * 60_000 + 5000 });
  out.push({ kind: "verify", h: a, ms: T0 + 16 * 60_000 + 6000 });
  // Samma IP, många adresser: 20 koder, sedan stopp. 30 misslyckade försök, sedan stopp.
  for (let i = 0; i < 21; i++) out.push({ kind: "code", h: hashesFor("k", `x${i}@botkyrka.se`, "2.2.2.2"), ms: T0 + 40 * 60_000 + i * 100 });
  for (let i = 0; i < 31; i++) out.push({ kind: "verify", h: hashesFor("k", `y${i}@botkyrka.se`, "3.3.3.3"), ms: T0 + 60 * 60_000 + i * 100 });
  return out;
}

describe("mm.login_attempt_gate (databasen)", () => {
  it("ger samma svar som referensreglerna i rate-limit.ts, steg för steg", async () => {
    const steps = scenario();
    const mem = memoryGate();
    const expected: string[] = [];
    let lastId: number | null = null;
    for (const s of steps) {
      if (s.kind === "ok") {
        if (lastId != null) await mem.gate.markVerified(lastId);
        expected.push("verified");
        continue;
      }
      const r = await mem.gate.gate({ kind: s.kind, at: at(s.ms), ...s.h });
      if (r.id != null) lastId = r.id;
      expected.push(r.verdict);
    }
    const got = await asUser(db, null, async (tx) => {
      const out: string[] = [];
      let id: number | null = null;
      for (const s of steps) {
        if (s.kind === "ok") {
          if (id != null) await tx.query("update public.login_attempts set kind = 'verify_ok' where id = $1", [id]);
          out.push("verified");
          continue;
        }
        const r = await sqlGate(tx, s.kind, s.h, s.ms);
        if (r.id != null) id = Number(r.id);
        out.push(r.verdict);
      }
      return out;
    }, { role: "service_role" });
    expect(got).toEqual(expected);
    // Stickprov på förloppet: 5 koder, 5 försök, stopp; ny kod ger nya försök; IP-gränserna.
    expect(expected.slice(0, 13)).toEqual(["ok", "ok", "ok", "ok", "ok", "rate_limited", "ok", "ok", "ok", "ok", "ok", "too_many_attempts", "too_many_attempts"]);
    expect(expected.filter((v) => v === "rate_limited")).toHaveLength(3);
  });

  it("registrerar försöket innan koden prövas (verify_failed), och servern ändrar det till verify_ok", async () => {
    const h = hashesFor("k", "b@botkyrka.se", "4.4.4.4");
    const res = await asUser(db, null, async (tx) => {
      await sqlGate(tx, "code", h, T0);
      const r = await sqlGate(tx, "verify", h, T0 + 1000);
      const before = (await tx.query<{ kind: string }>("select kind from public.login_attempts where id = $1", [r.id])).rows[0].kind;
      await tx.query("update public.login_attempts set kind = 'verify_ok' where id = $1", [r.id]);
      const after = (await tx.query<{ kind: string }>("select kind from public.login_attempts where id = $1", [r.id])).rows[0].kind;
      return { verdict: r.verdict, before, after };
    }, { role: "service_role" });
    expect(res).toEqual({ verdict: "ok", before: "verify_failed", after: "verify_ok" });
  });

  it("bara service role får anropa spärren", async () => {
    const sql = "select public.login_attempt_gate('verify', 'e', 'i', now(), '{}'::jsonb)";
    const anon = await asUser(db, null, (tx) => attempt(tx, sql));
    const user = await asUser(db, "aaaaaaaa-0000-4000-8000-0000000000ff", (tx) => attempt(tx, sql));
    const direct = await asUser(db, "aaaaaaaa-0000-4000-8000-0000000000ff", (tx) => attempt(tx, "select mm.login_attempt_gate('verify', 'e', 'i', now(), '{}'::jsonb)"));
    expect([anon.ok, user.ok, direct.ok]).toEqual([false, false, false]);
  });
});

// ---------------------------------------------------------------- 2. Servern
const shared = vi.hoisted(() => ({ gate: null as LoginGate | null }));
vi.mock("server-only", () => ({}));
vi.mock("../live", () => ({ loginGate: () => shared.gate, profileByEmail: async () => null }));
vi.mock("../supabase", () => ({ serviceClient: () => ({}) }));
vi.mock("../settings", () => ({ loadAppSettings: async () => ({ environment: "staging", clock: { mode: "real", realEpochMs: null, demoEpoch: null } }) }));
const { requestCode, sessionIdOfToken, verifyCode } = await import("./service");

const EMAIL = "karim.khalil@miljonbemanning.se";
const later = () => undefined;
const jwt = (claims: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;

describe("verifyCode och requestCode: anrop i klump passerar aldrig spärren", () => {
  it("300 samtidiga försök med fel kod: Supabase Auth prövar koden högst 5 gånger", async () => {
    const mem = memoryGate();
    shared.gate = mem.gate;
    await mem.gate.gate({ kind: "code", at: new Date().toISOString(), ...hashesFor("x", EMAIL, "203.0.113.7") });
    let otpCalls = 0;
    const user = {
      auth: {
        verifyOtp: async () => {
          otpCalls++;
          await new Promise((r) => setTimeout(r, 20));
          return { data: { user: null, session: null }, error: { code: "otp_expired" } };
        },
      },
    } as unknown as SupabaseClient;
    const res = await Promise.all(Array.from({ length: 300 }, (_, i) => verifyCode(user, EMAIL, String(100000 + i), "203.0.113.7", later)));
    expect(otpCalls).toBe(LIMITS.attemptsPerCode);
    expect(res.filter((r) => r.status === 401)).toHaveLength(LIMITS.attemptsPerCode);
    expect(res.filter((r) => r.status === 429 && !r.body.ok && r.body.error === "too_many_attempts")).toHaveLength(300 - LIMITS.attemptsPerCode);
  });

  it("30 samtidiga kodbegäran från samma adress: högst 5 går igenom", async () => {
    shared.gate = memoryGate().gate;
    const res = await Promise.all(Array.from({ length: 30 }, () => requestCode(EMAIL, "203.0.113.7", later)));
    expect(res.filter((r) => r.status === 200)).toHaveLength(LIMITS.codesPerEmail);
    expect(res.filter((r) => r.status === 429)).toHaveLength(30 - LIMITS.codesPerEmail);
  });

  it("rätt kod: försöket markeras som lyckat, och sessionens id följer med till kakan", async () => {
    const mem = memoryGate();
    shared.gate = mem.gate;
    await mem.gate.gate({ kind: "code", at: new Date().toISOString(), ...hashesFor("x", EMAIL, "203.0.113.7") });
    const user = {
      auth: {
        verifyOtp: async () => ({ data: { user: { id: "u1" }, session: { access_token: jwt({ sub: "u1", session_id: "sess-1" }) } }, error: null }),
        signOut: async () => ({ error: null }),
      },
    } as unknown as SupabaseClient;
    // Profilen saknas i den här fejken (403), men koden stämde – försöket räknas inte som misslyckat.
    const r = await verifyCode(user, EMAIL, "123456", "203.0.113.7", later);
    expect(r.status).toBe(403);
    expect(mem.rows.map((x) => x.kind)).toEqual(["code", "verify_ok"]);
    expect(sessionIdOfToken(jwt({ sub: "u1", session_id: "sess-1" }))).toBe("sess-1");
    expect(sessionIdOfToken(jwt({ sub: "u1" }))).toBe("u1");
    expect(sessionIdOfToken("trasig")).toBe("");
  });
});
