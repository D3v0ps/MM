// Inloggningskoden skickas av appen (beslut 2026-10-02): Supabase Auth tar fram koden med generateLink (inget mejl från
// Supabase), appen skickar den direkt med Resend och loggar utskicket utan koden. Supabase och Resend fejkas – inga riktiga
// anrop. Kontrollerna: koden går bara till en behörig adress (samma svar annars), aldrig omdirigerad, aldrig i
// outbound_messages, revisionsloggen eller konsolen; fel ger bara felkoder; signInWithOtp anropas inte längre.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_ACTOR } from "@/api/roles";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import type { AuditLogEntry, OutboundMessage } from "@/data/schema";
import { seedData, TESTER_ALLOWLIST, TESTERS } from "@/data/supabase/seed-rows";
import { fakeResend } from "../notify/test-helpers";
import { CODE_MASK, CODE_REASON, LOGGED_BODY, sendLoginCode, type LinkAdmin, type LoginCodeDeps } from "./code-mail";
import { CODE_MAILS_PER_HOUR } from "./rate-limit";
import { fillExample, templateDef } from "@/features/admin/templates";
import { renderLoginCodeEmail } from "../notify/render";
import { AUTH_TEXT } from "./email";

type LogTables = { outbound_messages: OutboundMessage; audit_log: AuditLogEntry };
const memoryLog = () => {
  const store = new MemoryStore<LogTables>({ outbound_messages: [], audit_log: [] });
  return { store, repo: new MemoryRepo<LogTables>(store, SYSTEM_ACTOR, {}, { bypass: true }) };
};

const KARIM = "karim.khalil@miljonbemanning.se";
const ALI = "ali.khalil@miljonbemanning.se";
const RESEND = { apiKey: "re_test_nyckel", from: "Miljonmatch <notis@miljonmatch.se>", replyTo: "avrop@miljonbemanning.se" };
const ACTION_LINK = "https://blx.supabase.co/auth/v1/verify?token=pkce_hemlig_hash&type=magiclink&redirect_to=http://localhost:3000";
const HASHED = "hemlig_hash_0f3c2a9e";

/** Fejkad supabase.auth.admin.generateLink: en ny sexsiffrig kod per anrop (eller ett fel). */
function fakeAdmin(o: { codes?: string[]; error?: { code?: string; status?: number } } = {}) {
  const codes = [...(o.codes ?? ["418302", "905117", "377210", "120458", "664913", "802376"])];
  const calls: { type: string; email: string }[] = [];
  const issued: string[] = [];
  const admin: LinkAdmin = {
    generateLink: async (p) => {
      calls.push(p);
      if (o.error) return { data: { properties: null }, error: o.error };
      const code = codes.shift() ?? "999999";
      issued.push(code);
      return { data: { properties: { action_link: ACTION_LINK, email_otp: code, hashed_token: HASHED, redirect_to: "http://localhost:3000", verification_type: "magiclink" } as never }, error: null };
    },
  };
  return { admin, calls, issued };
}

/** Allt som skrivs till konsolen under testet. */
function captureConsole() {
  const lines: string[] = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ================================================================ 1. sendLoginCode (code-mail.ts)
describe("sendLoginCode", () => {
  const deps = (o: Partial<LoginCodeDeps> & { admin: LinkAdmin }): LoginCodeDeps & { store: MemoryStore<LogTables>; resendFake: ReturnType<typeof fakeResend> } => {
    const { store, repo } = memoryLog();
    const resendFake = fakeResend();
    let n = 0;
    return { log: repo, resend: RESEND, fetch: resendFake.fetch, now: "2027-02-01T09:12", newId: (p) => `${p}-${++n}`, testEnvironment: true, store, resendFake, ...o };
  };

  it("koden från generateLink skickas direkt med Resend – utskicksloggen har raden utan koden", async () => {
    const a = fakeAdmin();
    const d = deps({ admin: a.admin });
    expect(await sendLoginCode(d, KARIM)).toBe("sent");
    expect(a.calls).toEqual([{ type: "magiclink", email: KARIM }]);
    const [call] = d.resendFake.calls;
    expect(d.resendFake.calls).toHaveLength(1);
    expect(call.body).toMatchObject({ from: RESEND.from, to: [KARIM], subject: "[Testmiljö] Din inloggningskod till Miljonmatch", tags: [{ name: "template", value: "inloggningskod" }] });
    // Ingen svarsadress för koden (ett svar skulle citera koden) – trots att MM_EMAIL_REPLY_TO är satt.
    expect(call.body).not.toHaveProperty("reply_to");
    expect(call.headers["Idempotency-Key"]).toBe("out-1");
    expect(call.body.text).toContain("\n418302\n");
    expect(call.body.html).toContain(">418302</td>");
    // Länken och den hashade token från Supabase används aldrig.
    for (const part of [call.body.html, call.body.text, call.body.subject]) {
      expect(part).not.toContain(HASHED);
      expect(part).not.toContain("supabase.co");
      expect(part).not.toContain("localhost");
    }
    expect(d.store.rows("outbound_messages")).toEqual([
      {
        id: "out-1", createdAt: "2027-02-01T09:12", channel: "email", to: KARIM, template: "inloggningskod", subject: "Din inloggningskod till Miljonmatch",
        body: LOGGED_BODY.sent, caseId: null, status: "sent", sentAt: "2027-02-01T09:12", statusReason: null, providerMessageId: "re-1",
      },
    ]);
    expect(LOGGED_BODY.sent).toBe(`Inloggningskod skickad (${CODE_MASK}). Koden sparas aldrig.`);
    expect(JSON.stringify(d.store.rows("outbound_messages"))).not.toMatch(/418302|hemlig/);
  });

  it("generateLink ger fel: inget mejl, raden failed med bara felkoden – konsolen har bara felkoden", async () => {
    const log = captureConsole();
    const d = deps({ admin: fakeAdmin({ error: { code: "user_not_found", status: 404 } }).admin });
    expect(await sendLoginCode(d, KARIM)).toBe("failed");
    expect(d.resendFake.calls).toHaveLength(0);
    expect(d.store.rows("outbound_messages")).toMatchObject([{ status: "failed", statusReason: CODE_REASON.noCode("user_not_found"), body: LOGGED_BODY.failed, sentAt: null }]);
    expect(log).toEqual(["inloggning skapa-kod user_not_found"]);
  });

  it("felkoder med konstiga tecken sparas inte – bara 'okänt'", async () => {
    const log = captureConsole();
    const d = deps({ admin: fakeAdmin({ error: { code: `fel för ${KARIM}` } }).admin });
    expect(await sendLoginCode(d, KARIM)).toBe("failed");
    expect(d.store.rows("outbound_messages")[0].statusReason).toBe(CODE_REASON.noCode("okänt"));
    expect(log).toEqual(["inloggning skapa-kod okänt"]);
  });

  it("koden har fel längd (Email OTP Length ≠ 6): inget mejl – appen tar bara emot sex siffror", async () => {
    const log = captureConsole();
    const d = deps({ admin: fakeAdmin({ codes: ["41830277"] }).admin });
    expect(await sendLoginCode(d, KARIM)).toBe("failed");
    expect(d.resendFake.calls).toHaveLength(0);
    expect(d.store.rows("outbound_messages")[0]).toMatchObject({ status: "failed", statusReason: CODE_REASON.badFormat });
    expect(log.join("\n")).not.toContain("41830277");
  });

  it("utan RESEND_API_KEY/MM_EMAIL_FROM: inget mejl, raden failed", async () => {
    const d = deps({ admin: fakeAdmin().admin, resend: null });
    captureConsole();
    expect(await sendLoginCode(d, KARIM)).toBe("failed");
    expect(d.store.rows("outbound_messages")[0]).toMatchObject({ status: "failed", statusReason: CODE_REASON.notConfigured });
  });

  it("Resend avvisar (422) eller nätverket fallerar: raden failed med HTTP-status och felnamn – aldrig Resends feltext, adressen eller koden", async () => {
    for (const [fake, reason] of [
      [fakeResend({ fail: [{ status: 422, name: "validation_error", message: `The ${KARIM} address is invalid` }] }), "Resend svarade 422 (validation_error)"],
      [fakeResend({ throwNetwork: 1 }), "Resend kunde inte nås (nätverksfel eller tidsgräns)"],
    ] as const) {
      const log = captureConsole();
      const d = deps({ admin: fakeAdmin().admin, fetch: fake.fetch });
      expect(await sendLoginCode(d, KARIM)).toBe("failed");
      const row = d.store.rows("outbound_messages")[0];
      expect(row).toMatchObject({ status: "failed", statusReason: reason, body: LOGGED_BODY.failed, providerMessageId: null });
      expect(log).toEqual(["inloggning skicka-kod resend"]);
      expect(JSON.stringify(row) + log.join("\n")).not.toMatch(/418302|address is invalid/);
      vi.restoreAllMocks();
    }
  });

  it("adminvyns mall (fast text) är exakt kodmejlets text", () => {
    const def = templateDef("inloggningskod")!;
    const mail = renderLoginCodeEmail("418302", { testEnvironment: false });
    expect(fillExample(def.body)).toBe(mail.text.split("\n\n--\n")[0]);
    expect(def.subject).toBe(mail.subject);
  });

  it("utskicksloggen går inte att skriva: ingen kod tas fram och inget mejl skickas (taket kan inte kontrolleras) – felet loggas utan detaljer", async () => {
    const log = captureConsole();
    const a = fakeAdmin();
    const d = deps({ admin: a.admin });
    const broken = { table: () => ({ insert: async () => Promise.reject(new TypeError(`insert ${KARIM} 418302`)) }) } as unknown as LoginCodeDeps["log"];
    expect(await sendLoginCode({ ...d, log: broken }, KARIM)).toBe("failed");
    expect(a.calls).toEqual([]);
    expect(d.resendFake.calls).toEqual([]);
    expect(log).toEqual(["inloggning utskickslogg TypeError"]);
  });

  it("raden kan inte uppdateras efter utskicket: mejlet är ändå skickat, felet loggas utan detaljer", async () => {
    const log = captureConsole();
    const d = deps({ admin: fakeAdmin().admin });
    const t = d.log.table("outbound_messages");
    const half = { table: () => ({ insert: (r: OutboundMessage) => t.insert(r), count: (w: never) => t.count(w), update: async () => Promise.reject(new TypeError(`update ${KARIM} 418302`)) }) } as unknown as LoginCodeDeps["log"];
    expect(await sendLoginCode({ ...d, log: half }, KARIM)).toBe("sent");
    expect(d.resendFake.calls).toHaveLength(1);
    expect(log).toEqual(["inloggning utskickslogg TypeError"]);
    // Raden står kvar som "queued" (räknas mot taket) – utan koden.
    expect(d.store.rows("outbound_messages")).toMatchObject([{ status: "queued", body: LOGGED_BODY.queued }]);
  });
});

// ================================================================ 1b. Taket för hela appen (CODE_MAILS_PER_HOUR)
describe("taket för hela appen: högst CODE_MAILS_PER_HOUR kodmejl per timme, oavsett adress och IP", () => {
  const NOW = "2027-02-01T09:12";
  const row = (i: number, o: Partial<OutboundMessage>): OutboundMessage => ({
    id: `old-${i}`, createdAt: NOW, channel: "email", to: `testare${i}@miljonbemanning.se`, template: "inloggningskod", subject: "Din inloggningskod till Miljonmatch",
    body: LOGGED_BODY.sent, caseId: null, status: "sent", sentAt: NOW, statusReason: null, providerMessageId: null, ...o,
  });
  const setup = (existing: OutboundMessage[]) => {
    const store = new MemoryStore<LogTables>({ outbound_messages: existing, audit_log: [] });
    const repo = new MemoryRepo<LogTables>(store, SYSTEM_ACTOR, {}, { bypass: true });
    const a = fakeAdmin({ codes: Array.from({ length: 200 }, (_, i) => String(100000 + i)) });
    const resend = fakeResend();
    let n = 0;
    const d: LoginCodeDeps = { admin: a.admin, log: repo, resend: RESEND, fetch: resend.fetch, now: NOW, newId: (p) => `${p}-${++n}`, testEnvironment: true };
    return { d, store, a, resend };
  };

  it("taket är 30 per timme (samma som Supabase Auths tidigare gräns för e-post)", () => {
    expect(CODE_MAILS_PER_HOUR).toBe(30);
  });

  it("30 utskick (sent, failed eller pågående) den senaste timmen: nästa stoppas – ingen kod tas fram, inget mejl, raden suppressed utan kod", async () => {
    const log = captureConsole();
    const existing = Array.from({ length: CODE_MAILS_PER_HOUR }, (_, i) => row(i, i % 3 === 1 ? { status: "failed", sentAt: null } : i % 3 === 2 ? { status: "queued", sentAt: null, createdAt: "2027-02-01T08:13" } : {}));
    const { d, store, a, resend } = setup(existing);
    expect(await sendLoginCode(d, KARIM)).toBe("suppressed");
    expect(a.calls).toEqual([]);
    expect(resend.calls).toEqual([]);
    expect(store.getRow("outbound_messages", "out-1")).toMatchObject({ to: KARIM, template: "inloggningskod", status: "suppressed", body: LOGGED_BODY.suppressed, statusReason: CODE_REASON.overLimit, sentAt: null });
    expect(CODE_REASON.overLimit).toBe("Taket är nått: högst 30 inloggningskoder per timme för hela appen");
    expect(log).toEqual(["inloggning skicka-kod tak"]);
  });

  it("räknas inte: äldre än en timme, stoppade av taket, andra mallar och rader efter klockan (testdata inläst på nytt)", async () => {
    const existing = [
      ...Array.from({ length: CODE_MAILS_PER_HOUR - 1 }, (_, i) => row(i, {})),
      row(100, { createdAt: "2027-02-01T08:12" }), // exakt en timme sedan
      row(101, { status: "suppressed", sentAt: null }),
      row(102, { template: "ny_rapport" }),
      row(103, { createdAt: "2027-02-01T09:13" }),
    ];
    const { d, a, resend } = setup(existing);
    expect(await sendLoginCode(d, KARIM)).toBe("sent");
    expect(a.calls).toHaveLength(1);
    expect(resend.calls).toHaveLength(1);
    // Nu är taket nått.
    expect(await sendLoginCode(d, ALI)).toBe("suppressed");
    expect(a.calls).toHaveLength(1);
  });

  it("många anrop efter varandra från olika adresser: exakt 30 mejl, resten stoppas", async () => {
    captureConsole();
    const { d, store, a, resend } = setup([]);
    const out: string[] = [];
    for (let i = 0; i < 45; i++) out.push(await sendLoginCode(d, `person${i}@botkyrka.se`));
    expect(out.filter((x) => x === "sent")).toHaveLength(CODE_MAILS_PER_HOUR);
    expect(out.slice(CODE_MAILS_PER_HOUR).every((x) => x === "suppressed")).toBe(true);
    expect(a.calls).toHaveLength(CODE_MAILS_PER_HOUR);
    expect(resend.calls).toHaveLength(CODE_MAILS_PER_HOUR);
    expect(store.rows("outbound_messages").filter((r) => r.status === "suppressed")).toHaveLength(45 - CODE_MAILS_PER_HOUR);
  });

  it("många samtidiga anrop: aldrig fler än 30 koder tas fram eller skickas", async () => {
    captureConsole();
    const { d, a, resend } = setup(Array.from({ length: 20 }, (_, i) => row(i, {})));
    const out = await Promise.all(Array.from({ length: 100 }, (_, i) => sendLoginCode(d, `person${i}@botkyrka.se`)));
    expect(out.filter((x) => x === "sent").length).toBeLessThanOrEqual(CODE_MAILS_PER_HOUR - 20);
    expect(a.calls.length).toBeLessThanOrEqual(CODE_MAILS_PER_HOUR - 20);
    expect(resend.calls.length).toBeLessThanOrEqual(CODE_MAILS_PER_HOUR - 20);
  });
});

// ================================================================ 2. Hela flödet via requestCode/verifyCode (service.ts)
const SEED = seedData();
const shared = vi.hoisted(() => ({
  admin: null as unknown as LinkAdmin & { createUser: (a: unknown) => Promise<unknown> },
  otp: [] as unknown[],
  repo: null as unknown,
  updates: [] as { table: string; patch: unknown }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("../live", () => ({
  profileByEmail: async (_service: unknown, email: string) => {
    const profile = SEED.profiles.find((p) => p.email === email);
    if (!profile) return null;
    return { profile, org: SEED.organizations.find((o) => o.id === profile.organizationId) ?? null, memberships: SEED.memberships.filter((m) => m.userId === profile.id) };
  },
  loginGate: () => {
    let id = 0;
    return { gate: async () => ({ verdict: "ok", id: ++id }), markVerified: async () => undefined };
  },
}));
vi.mock("../supabase", () => ({
  serviceClient: () => ({
    auth: {
      admin: shared.admin,
      // Får aldrig anropas längre – Supabase Auth skickar inga mejl.
      signInWithOtp: async (...a: unknown[]) => {
        shared.otp.push(a);
        return { data: {}, error: null };
      },
    },
    from: (table: string) => ({
      update: (patch: unknown) => ({ eq: async () => (shared.updates.push({ table, patch }), { error: null }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));
// Testklockan tickar med riktig tid från realEpochMs: startar den vid "nu" står demotiden kvar på 1 februari 2027 oavsett
// när testet körs (ett fast datum gav fel när mer än ett dygn gått sedan dess).
vi.mock("../settings", () => ({ loadAppSettings: async () => ({ environment: "staging", clock: { mode: "test", realEpochMs: Date.now(), demoEpoch: "2027-02-01T09:12" } }) }));
vi.mock("@/data/supabase", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/data/supabase")>()), appRepo: () => shared.repo }));
const { requestCode, verifyCode } = await import("./service");

describe("requestCode: appen skickar koden (supabase-läget, testmiljön)", () => {
  let log: string[];
  let store: MemoryStore<LogTables>;
  let resend: ReturnType<typeof fakeResend>;
  let links: ReturnType<typeof fakeAdmin>;
  let created: unknown[];

  beforeEach(() => {
    const m = memoryLog();
    store = m.store;
    shared.repo = m.repo;
    shared.otp = [];
    shared.updates = [];
    links = fakeAdmin();
    created = [];
    shared.admin = {
      generateLink: links.admin.generateLink,
      createUser: async (a: unknown) => (created.push(a), { data: { user: null }, error: { code: "email_exists", status: 422 } }),
    };
    resend = fakeResend();
    vi.stubGlobal("fetch", resend.fetch);
    vi.stubEnv("MM_EMAIL_ALLOWLIST", TESTER_ALLOWLIST);
    vi.stubEnv("MM_STAFF_EMAIL_DOMAINS", "");
    vi.stubEnv("RESEND_API_KEY", "re_test_nyckel");
    vi.stubEnv("MM_EMAIL_FROM", RESEND.from);
    vi.stubEnv("MM_EMAIL_REPLY_TO", "");
    // Omdirigeringen gäller notiserna – aldrig koderna.
    vi.stubEnv("MM_EMAIL_REDIRECT_TO", KARIM);
    log = captureConsole();
  });

  /** requestCode och sedan det som körs efter svaret (after). */
  const request = async (email: string) => {
    const later: (() => Promise<void>)[] = [];
    const res = await requestCode(email, "203.0.113.7", (fn) => later.push(fn));
    for (const fn of later) await fn();
    return res;
  };
  const SAME = { status: 200, body: { ok: true, message: AUTH_TEXT.codeSent } };

  it("behörig testare: koden skickas till just den adressen, utan omdirigering – signInWithOtp anropas inte", async () => {
    expect(await request(ALI)).toEqual(SAME);
    expect(created).toEqual([{ email: ALI, email_confirm: true }]);
    expect(links.calls).toEqual([{ type: "magiclink", email: ALI }]);
    expect(resend.calls.map((c) => c.body.to)).toEqual([[ALI]]);
    expect(resend.calls[0].body.text).toContain(links.issued[0]);
    expect(shared.otp).toEqual([]);
    // Testtid i utskicksloggen, mottagaren och mallen – utan koden.
    expect(store.rows("outbound_messages")).toMatchObject([{ to: ALI, template: "inloggningskod", status: "sent", body: LOGGED_BODY.sent, statusReason: null }]);
    expect(store.rows("outbound_messages")[0].createdAt).toMatch(/^2027-02-01T/);
    expect(log).toEqual([]);
  });

  it("obehörig, spärrad eller okänd adress: samma svar – ingen kod tas fram, inget mejl, ingen rad", async () => {
    const fakeMb = SEED.profiles.find((p) => p.id === "u-sara")!.email; // påhittad testperson på miljonbemanning.se
    const fakeKommun = SEED.profiles.find((p) => p.id === "k-maria")!.email; // påhittad testperson på botkyrka.se
    for (const email of [fakeMb, fakeKommun, "okand.person@miljonbemanning.se", "nagon@exempel.se"]) {
      expect(await request(email), email).toEqual(SAME);
    }
    expect(links.calls).toEqual([]);
    expect(created).toEqual([]);
    expect(resend.calls).toEqual([]);
    expect(store.rows("outbound_messages")).toEqual([]);
    expect(shared.otp).toEqual([]);
    // Ingen omdirigering till MM_EMAIL_REDIRECT_TO (Karim) för koder.
    expect(resend.calls.some((c) => c.body.to.includes(KARIM))).toBe(false);
  });

  it("tom MM_EMAIL_ALLOWLIST i testmiljön: ingen får en kod", async () => {
    vi.stubEnv("MM_EMAIL_ALLOWLIST", "");
    expect(await request(KARIM)).toEqual(SAME);
    expect(links.calls).toEqual([]);
    expect(resend.calls).toEqual([]);
  });

  it("kontot kunde inte skapas (oväntat fel): ingen kod – generateLink skulle annars skapa ett eget konto", async () => {
    shared.admin.createUser = async () => ({ data: { user: null }, error: { code: "unexpected_failure", status: 500 } });
    expect(await request(KARIM)).toEqual(SAME);
    expect(links.calls).toEqual([]);
    expect(resend.calls).toEqual([]);
    expect(log).toEqual(["inloggning skapa-konto unexpected_failure"]);
  });

  it("hela vägen: koden i mejlet loggar in med verifyOtp({ email, token, type: 'email' }) – koden finns aldrig i databasen, revisionsloggen eller konsolen", async () => {
    await request(KARIM);
    const code = links.issued[0];
    expect(resend.calls[0].body.text.split("\n")).toContain(code);
    const verified: unknown[] = [];
    const user = {
      auth: {
        verifyOtp: async (p: { email: string; token: string; type: string }) => {
          verified.push(p);
          return p.token === code ? { data: { user: { id: "auth-karim" }, session: { access_token: "x.e30.y" } }, error: null } : { data: { user: null, session: null }, error: { code: "otp_expired" } };
        },
        signOut: async () => ({ error: null }),
      },
    } as never;
    const r = await verifyCode(user, KARIM, ` ${code.slice(0, 3)} ${code.slice(3)} `, "203.0.113.7", () => undefined);
    expect(r).toMatchObject({ status: 200, body: { ok: true }, profileId: TESTERS.find((t) => t.email === KARIM)!.id });
    expect(verified).toEqual([{ email: KARIM, token: code, type: "email" }]);
    expect(store.rows("audit_log").map((a) => a.action)).toEqual(["auth.login"]);
    const everything = JSON.stringify({ rows: store.rows("outbound_messages"), audit: store.rows("audit_log"), updates: shared.updates, log });
    expect(everything).not.toContain(code);
    expect(everything).not.toContain(HASHED);
    expect(log).toEqual([]);
  });

  it("Resend avvisar: samma svar till användaren, raden failed, konsolen bara felkoden", async () => {
    const failing = fakeResend({ fail: [{ status: 422, name: "validation_error", message: `The ${KARIM} address` }] });
    vi.stubGlobal("fetch", failing.fetch);
    expect(await request(KARIM)).toEqual(SAME);
    expect(store.rows("outbound_messages")).toMatchObject([{ status: "failed", statusReason: "Resend svarade 422 (validation_error)" }]);
    expect(log).toEqual(["inloggning skicka-kod resend"]);
    expect(log.join("\n") + JSON.stringify(store.rows("outbound_messages"))).not.toContain(links.issued[0]);
  });
});
