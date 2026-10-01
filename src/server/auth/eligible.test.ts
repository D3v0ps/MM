// Vem får en inloggningskod i testmiljön (eligibleForCode i service.ts)? Bara adresser i MM_EMAIL_ALLOWLIST OCH en känd,
// aktiv profil med roll och tillåten domän. Testdatat har påhittade adresser på riktiga domäner (botkyrka.se) och på
// miljonbemanning.se (t.ex. sara.lindqvist@) – de får aldrig en kod. Därför står testarnas hela adresser i listan, aldrig
// "@miljonbemanning.se". Dokumentationen visar exakt det värde som ska in i Vercel (TESTER_ALLOWLIST).
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../settings";
import { seedData, TESTER_ALLOWLIST, TESTERS } from "@/data/supabase/seed-rows";

vi.mock("server-only", () => ({}));
const SEED = seedData();
vi.mock("../live", () => ({
  profileByEmail: async (_service: unknown, email: string) => {
    const profile = SEED.profiles.find((p) => p.email === email);
    if (!profile) return null;
    return { profile, org: SEED.organizations.find((o) => o.id === profile.organizationId) ?? null, memberships: SEED.memberships.filter((m) => m.userId === profile.id) };
  },
  loginGate: () => null,
}));
vi.mock("../supabase", () => ({ serviceClient: () => ({}), anonClient: () => ({}) }));
const { eligibleForCode } = await import("./service");

const STAGING: AppSettings = { environment: "staging", clock: { mode: "real", realEpochMs: null, demoEpoch: null } } as unknown as AppSettings;
const service = {} as never;
const eligible = async (email: string, allowlist: string, settings = STAGING) => {
  vi.stubEnv("MM_EMAIL_ALLOWLIST", allowlist);
  vi.stubEnv("MM_STAFF_EMAIL_DOMAINS", "");
  return (await eligibleForCode(service, email, settings))?.profile.id ?? null;
};
afterEach(() => vi.unstubAllEnvs());

describe("inloggningskoden i testmiljön", () => {
  it("MM_EMAIL_ALLOWLIST = testarnas sex hela adresser", () => {
    expect(TESTERS.map((t) => t.email)).toEqual([
      "karim.khalil@miljonbemanning.se", "ali.khalil@miljonbemanning.se", "sara.salah@miljonbemanning.se", "adam.abdalla@miljonbemanning.se",
      "shafik.muwanga@miljonbemanning.se", "moda.habib@miljonbemanning.se",
    ]);
    expect(TESTER_ALLOWLIST).toBe(TESTERS.map((t) => t.email).join(","));
    expect(TESTER_ALLOWLIST.split(",").every((x) => /^[a-z.]+@miljonbemanning\.se$/.test(x))).toBe(true);
  });

  it("alla sex testarna får en kod – testpersonernas påhittade adresser aldrig, inte heller okända adresser i listan", async () => {
    for (const t of TESTERS) expect(await eligible(t.email, TESTER_ALLOWLIST), t.email).toBe(t.id);
    const fakeMb = SEED.profiles.find((p) => p.id === "u-sara")!.email;
    const fakeKommun = SEED.profiles.find((p) => p.id === "k-maria")!.email;
    expect(fakeMb).toMatch(/@miljonbemanning\.se$/);
    expect(fakeKommun).toMatch(/@botkyrka\.se$/);
    expect(await eligible(fakeMb, TESTER_ALLOWLIST)).toBeNull();
    expect(await eligible(fakeKommun, TESTER_ALLOWLIST)).toBeNull();
    // I listan men utan profil: ingen kod.
    expect(await eligible("okand.person@miljonbemanning.se", `${TESTER_ALLOWLIST},okand.person@miljonbemanning.se`)).toBeNull();
    // Tom lista i testmiljön: ingen får en kod.
    expect(await eligible(TESTERS[0].email, "")).toBeNull();
  });

  it("därför hela adresser: med @miljonbemanning.se i listan skulle testpersonernas påhittade adresser få en kod", async () => {
    const fakeMb = SEED.profiles.find((p) => p.id === "u-sara")!.email;
    expect(await eligible(fakeMb, "@miljonbemanning.se")).toBe("u-sara");
  });

  it("docs/DRIFT.md och supabase/README.md visar exakt värdet för Vercel", () => {
    for (const file of ["../../../docs/DRIFT.md", "../../../supabase/README.md"]) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(text, file).toContain(`\`${TESTER_ALLOWLIST}\``);
      for (const t of TESTERS) expect(text, `${file} ${t.email}`).toContain(t.email);
    }
  });
});
