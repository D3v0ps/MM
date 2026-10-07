// Självregistreringen i servern (beslut 2026-10-07): taket för nya konton räknas på unika adresser – för hela appen och per
// IP – så att en enda avsändare med påhittade adresser inte kan stänga självregistreringen för riktiga handläggare
// (granskningen 2026-10-07). Fejkad Supabase; testdatat i minnet som service role. Bara påhittade adresser.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_ACTOR } from "@/api/roles";
import { MemoryRepo, MemoryStore, type MemoryData } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed } from "@/data/seed";
import type { Tables } from "@/data/schema";
import { checkSelfRegistration, SELF_REGISTRATION_LIMITS, type Hashes, type SelfRegistrationStore } from "./rate-limit";

const SEED: MemoryData<Tables> = createSeed();

/** login_attempts (kind self_registration) i minnet. */
function memoryStore() {
  const rows: (Hashes & { at: string })[] = [];
  const store: SelfRegistrationStore = {
    recent: async (since) => rows.filter((r) => r.at >= since).map(({ emailHash, ipHash }) => ({ emailHash, ipHash })),
    record: async (a) => void rows.push(a),
  };
  return { rows, store };
}

describe("checkSelfRegistration", () => {
  const T0 = Date.parse("2027-02-01T08:00:00Z");
  it("räknar unika adresser: samma adress igen räknas inte och registreras inte på nytt", async () => {
    const m = memoryStore();
    expect(await checkSelfRegistration(m.store, { emailHash: "e1", ipHash: "ip1" }, T0)).toBe("ok");
    for (let i = 0; i < 5; i++) expect(await checkSelfRegistration(m.store, { emailHash: "e1", ipHash: "ip1" }, T0 + i)).toBe("repeat");
    expect(m.rows).toHaveLength(1);
  });

  it("högst tre nya adresser per IP och timme – andra IP-adresser påverkas inte", async () => {
    const m = memoryStore();
    for (let i = 0; i < SELF_REGISTRATION_LIMITS.perIp; i++) expect(await checkSelfRegistration(m.store, { emailHash: `x${i}`, ipHash: "angripare" }, T0)).toBe("ok");
    expect(await checkSelfRegistration(m.store, { emailHash: "x9", ipHash: "angripare" }, T0)).toBe("ip_limit");
    expect(await checkSelfRegistration(m.store, { emailHash: "riktig", ipHash: "kommunen" }, T0)).toBe("ok");
    // Efter en timme räknas försöken inte längre.
    expect(await checkSelfRegistration(m.store, { emailHash: "x9", ipHash: "angripare" }, T0 + 61 * 60_000)).toBe("ok");
  });

  it("högst 20 nya adresser per timme i hela appen", async () => {
    const m = memoryStore();
    for (let i = 0; i < SELF_REGISTRATION_LIMITS.perApp; i++) expect(await checkSelfRegistration(m.store, { emailHash: `e${i}`, ipHash: `ip${i}` }, T0)).toBe("ok");
    expect(await checkSelfRegistration(m.store, { emailHash: "ny", ipHash: "ip-ny" }, T0)).toBe("app_limit");
    // En adress som redan påbörjat får en ny kod även när taket är nått.
    expect(await checkSelfRegistration(m.store, { emailHash: "e3", ipHash: "ip3" }, T0)).toBe("repeat");
  });
});

// ---------------------------------------------------------------- Servern (service.ts) med fejkad Supabase
const state = vi.hoisted(() => ({
  store: null as unknown as MemoryStore<Tables>,
  attempts: [] as { kind: string; email_hash: string; ip_hash: string; attempted_at: string }[],
  sent: [] as string[],
  created: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/settings", () => ({ loadAppSettings: async () => ({ environment: "production", clock: { mode: "real", realEpochMs: null, demoEpoch: null } }) }));
vi.mock("@/server/notify/config", () => ({ notifyEnv: () => ({ resend: {} }) }));
vi.mock("@/server/config", async (orig) => ({ ...(await orig<object>()), loginHashSecret: () => "testnyckel", emailAllowlist: () => [] }));
vi.mock("@/server/auth/code-mail", () => ({
  logCode: () => {},
  sendLoginCode: async (_d: unknown, email: string) => {
    state.sent.push(email);
    return "sent";
  },
}));
vi.mock("@/server/live", () => ({
  loginGate: () => ({ gate: async () => ({ verdict: "ok", id: 1 }), markVerified: async () => {} }),
  profileByEmail: async (_s: unknown, email: string) => {
    const raw = state.store.raw();
    const profile = raw.all("profiles").find((p) => p.email === email);
    if (!profile) return null;
    return { profile, org: raw.get("organizations", profile.organizationId) ?? null, memberships: raw.all("memberships").filter((m) => m.userId === profile.id) };
  },
  selfRegistrationStore: () => ({
    recent: async (since: string) => state.attempts.filter((a) => a.kind === "self_registration" && a.attempted_at >= since).map((a) => ({ emailHash: a.email_hash, ipHash: a.ip_hash })),
    record: async (a: { at: string; emailHash: string; ipHash: string }) => void state.attempts.push({ kind: "self_registration", email_hash: a.emailHash, ip_hash: a.ipHash, attempted_at: a.at }),
  }),
}));
vi.mock("@/server/supabase", () => ({
  serviceClient: () => ({ auth: { admin: { createUser: async ({ email }: { email: string }) => (state.created.push(email), { data: { user: { id: `auth-${email}` } }, error: null }) } } }),
}));
vi.mock("@/data/supabase", async (orig) => ({ ...(await orig<object>()), appRepo: () => new MemoryRepo<Tables>(state.store, SYSTEM_ACTOR, POLICIES, { bypass: true }) }));

describe("requestCode: nya konton", () => {
  beforeEach(() => {
    state.store = new MemoryStore<Tables>(structuredClone(SEED));
    state.attempts = [];
    state.sent = [];
    state.created = [];
  });
  const request = async (email: string, ip: string) => {
    const { requestCode } = await import("./service");
    const jobs: (() => Promise<void>)[] = [];
    const r = await requestCode(email, ip, (fn) => jobs.push(fn));
    for (const j of jobs) await j();
    return r;
  };

  it("påhittade adresser från en IP stänger inte självregistreringen för en riktig handläggare", async () => {
    for (let i = 0; i < 20; i++) await request(`finns.inte.${i}@botkyrka.se`, "203.0.113.7");
    // Bara tre nya adresser från samma IP fick kod och Auth-konto.
    expect(state.sent).toHaveLength(SELF_REGISTRATION_LIMITS.perIp);
    expect(state.created).toHaveLength(SELF_REGISTRATION_LIMITS.perIp);
    await request("riktig.handlaggare@botkyrka.se", "198.51.100.20");
    expect(state.sent).toContain("riktig.handlaggare@botkyrka.se");
    // Inga adresser eller IP-adresser i klartext i spärrtabellen eller revisionsloggen.
    expect(JSON.stringify(state.attempts)).not.toMatch(/botkyrka|203\.0\.113|198\.51/);
    const started = state.store.raw().all("audit_log").filter((l) => l.action === "auth.self_registration_started");
    expect(started).toHaveLength(SELF_REGISTRATION_LIMITS.perIp + 1);
    expect(started.every((l) => JSON.stringify(l.details) === JSON.stringify({ domain: "botkyrka.se" }))).toBe(true);
  });

  it("en ny kod till samma adress räknas inte igen och loggas en gång; plusadresser får ingen kod", async () => {
    for (let i = 0; i < 4; i++) await request("samma.adress@botkyrka.se", "203.0.113.7");
    expect(state.sent).toEqual(Array(4).fill("samma.adress@botkyrka.se"));
    expect(state.attempts).toHaveLength(1);
    expect(state.store.raw().all("audit_log").filter((l) => l.action === "auth.self_registration_started")).toHaveLength(1);
    await request("samma.adress+1@botkyrka.se", "203.0.113.7");
    expect(state.sent).not.toContain("samma.adress+1@botkyrka.se");
    expect(state.created).toEqual(Array(4).fill("samma.adress@botkyrka.se"));
  });
});
