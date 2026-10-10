// Identiteten i supabase-läget: aktören från databasen (current_actor), namn från profilen, testarens personaväljare
// bara i testmiljön, och att testaren bara får välja testpersoner som finns.
import { describe, expect, it } from "vitest";
import { listPersonas } from "@/data/actors";
import { createSeed, ORG_MB } from "@/data/seed";
import type { Membership, Profile } from "@/data/schema";
import { mayImpersonate, rawOf, resolveIdentity, type DbActor, type Directory, type IdentityStore } from "./identity";

const seed = createSeed();
const KARIM: Profile & { isTester: boolean } = {
  id: "tester-karim", organizationId: ORG_MB, fullName: "Karim Khalil", email: "karim.khalil@miljonbemanning.se", phone: "", title: "Testare",
  active: true, lastLoginAt: null, customerUnit: null, buyerReferenceId: null, teamRole: null, invitedAt: null, invitedBy: null, isTester: true,
};
const KARIM_ADMIN: Membership = { id: "m-test-karim", userId: KARIM.id, contractId: "c-bot", role: "admin", customerUnit: null };
/** En begränsad testare (src/api/tester-access.ts): alla testare utom Karim och Ali. */
const SARA_T: Profile & { isTester: boolean } = { ...KARIM, id: "tester-sara", fullName: "Sara Salah", email: "sara.salah@miljonbemanning.se" };
const SARA_T_ADMIN: Membership = { id: "m-test-sara", userId: SARA_T.id, contractId: "c-bot", role: "admin", customerUnit: null };
const BLOCKED: Profile = { ...KARIM, id: "u-test-blocked", fullName: "Spärrad Testperson", email: "sparrad@miljonbemanning.se", active: false };
const BLOCKED_COACH: Membership = { id: "m-test-blocked", userId: BLOCKED.id, contractId: "c-bot", role: "coach", customerUnit: null };
const all: Directory = { profiles: [...seed.profiles, KARIM, SARA_T, BLOCKED], memberships: [...seed.memberships, KARIM_ADMIN, SARA_T_ADMIN, BLOCKED_COACH], organizations: seed.organizations };

function store(actor: DbActor | null, calls: string[] = []): IdentityStore {
  return {
    currentActor: async () => actor,
    directory: async (scope, ids) => {
      calls.push(scope);
      if (scope === "all") return all;
      return { profiles: all.profiles.filter((p) => ids.includes(p.id)), memberships: all.memberships.filter((m) => ids.includes(m.userId)), organizations: all.organizations };
    },
  };
}
const self = (profileId: string, role: string, extra: Partial<DbActor> = {}): DbActor => ({
  authProfileId: profileId, isTester: false, environment: "staging", impersonating: false, userId: profileId, roles: [role], contractIds: ["c-bot"], customerUnit: null, ...extra,
});

describe("resolveIdentity", () => {
  it("vanlig användare: aktören exakt som databasen, namnet från profilen, inga testpersoner", async () => {
    const calls: string[] = [];
    const id = await resolveIdentity(store(self("k-maria", "kommun_handlaggare", { customerUnit: "Arbetsmarknadsenheten Alby" }), calls), "staging");
    expect(id?.persona.actor).toEqual({ userId: "k-maria", roles: ["kommun_handlaggare"], contractIds: ["c-bot"], customerUnit: "Arbetsmarknadsenheten Alby" });
    expect(id?.persona.user.name).toBe("Maria Ekdahl");
    expect(id?.persona.user.orgName).toBe("Botkyrka kommun");
    expect(id?.isTester).toBe(false);
    expect(id?.impersonating).toBe(false);
    expect(id?.personas).toEqual([]);
    expect(calls).toEqual(["self"]);
  });

  it("alla roller samtidigt (Karims beslut 7, 2026-10-09): aktören har databasens alla roller i rollernas ordning och avtalen per roll", async () => {
    const two: Directory = { ...all, memberships: [...all.memberships, { id: `${KARIM.id}:c-bot:coach`, userId: KARIM.id, contractId: "c-bot", role: "coach", customerUnit: null }] };
    const st: IdentityStore = { currentActor: async () => self(KARIM.id, "coach", { roles: ["coach", "admin", "superuser"] }), directory: async () => two };
    expect((await resolveIdentity(st, "production"))?.persona.actor).toEqual({ userId: KARIM.id, roles: ["admin", "coach"], contractIds: ["c-bot"], customerUnit: null });
    // Roller i olika avtal: avtalen per roll följer med (en roll ger bara rätt där personen har den).
    const split: IdentityStore = {
      currentActor: async () => self(KARIM.id, "admin", { roles: ["admin", "ekonom"], contractIds: ["c-bot", "c-ny"], roleContracts: { admin: ["c-bot", "c-ny"], ekonom: ["c-ny"] } }),
      directory: async () => two,
    };
    expect((await resolveIdentity(split, "production"))?.persona.actor).toEqual({
      userId: KARIM.id, roles: ["admin", "ekonom"], contractIds: ["c-bot", "c-ny"], roleContracts: { ekonom: ["c-ny"] }, customerUnit: null,
    });
  });

  it("ingen profil, spärrad profil eller ingen roll = ingen identitet", async () => {
    expect(await resolveIdentity(store(null), "staging")).toBeNull();
    expect(await resolveIdentity(store({ ...self("k-maria", "kommun_handlaggare"), authProfileId: null }), "staging")).toBeNull();
    expect(await resolveIdentity(store({ ...self("k-maria", "kommun_handlaggare"), roles: null }), "staging")).toBeNull();
    expect(await resolveIdentity(store({ ...self("k-maria", "kommun_handlaggare"), roles: [] }), "staging")).toBeNull();
    expect(await resolveIdentity(store({ ...self("k-maria", "kommun_handlaggare"), roles: ["superuser"] }), "staging")).toBeNull();
    expect(await resolveIdentity(store(self(BLOCKED.id, "coach")), "staging")).toBeNull();
  });

  it("testare i testmiljön: alla testpersoner att välja mellan och den valda testpersonen som aktör", async () => {
    const actor = self(KARIM.id, "admin", { isTester: true, impersonating: true, userId: "u-amira", roles: ["coach"], contractIds: ["c-bot"] });
    const id = await resolveIdentity(store(actor), "staging");
    expect(id?.isTester).toBe(true);
    expect(id?.impersonating).toBe(true);
    expect(id?.self.id).toBe(KARIM.id);
    // testerId: testarens egen profil (synpunkterna, RLS mm.auth_is_tester) – även när testaren agerar som en testperson.
    expect(id?.persona.actor).toEqual({ userId: "u-amira", roles: ["coach"], contractIds: ["c-bot"], customerUnit: null, testerId: KARIM.id });
    expect(id?.persona.user.name).toBe("Amira Haddad");
    // Samma testpersoner som prototypens rollväljare (plus testarna själva) – en per användare med alla roller.
    const expected = listPersonas(rawOf(all)).map((p) => `${p.actor.userId}|${p.actor.roles.join(",")}`);
    expect(id?.personas.map((p) => `${p.userId}|${p.roles.join(",")}`)).toEqual(expected);
    expect(id?.personas.some((p) => p.userId === KARIM.id && p.role === "admin")).toBe(true);
    expect(id?.personas.some((p) => p.role === "deltagare")).toBe(true);
  });

  it("testaren i produktion: ingen personaväljare och aldrig någon annan aktör", async () => {
    // Databasen svarar själv med den egna profilen i produktion (mm.auth_is_tester är falskt) – även om servern
    // skulle få ett felaktigt svar markeras testaren inte som testare utanför testmiljön.
    const id = await resolveIdentity(store(self(KARIM.id, "admin", { isTester: true, environment: "production" })), "production");
    expect(id?.isTester).toBe(false);
    expect(id?.impersonating).toBe(false);
    expect(id?.personas).toEqual([]);
    expect(id?.persona.actor.testerId).toBeUndefined();
    const notTester = await resolveIdentity(store(self("u-robin", "admin")), "staging");
    expect(notTester?.isTester).toBe(false);
    expect(notTester?.personas).toEqual([]);
    expect(notTester?.persona.actor.testerId).toBeUndefined();
  });
});

describe("begränsade testare (alla utom Karim och Ali)", () => {
  it("Agera som: alla testpersoner utom rollen ekonom – Karim får fortfarande välja ekonom", async () => {
    const sara = await resolveIdentity(store(self(SARA_T.id, "admin", { isTester: true })), "staging");
    const karim = await resolveIdentity(store(self(KARIM.id, "admin", { isTester: true })), "staging");
    expect(sara?.persona.actor.testerId).toBe("tester-sara");
    expect(karim?.personas.some((p) => p.role === "ekonom")).toBe(true);
    expect(sara?.personas.some((p) => p.role === "ekonom")).toBe(false);
    expect(sara?.personas.map((p) => p.userId)).toEqual(karim?.personas.filter((p) => !p.roles.includes("ekonom")).map((p) => p.userId));
    // Systemadministratör, chef, coach, kommunens handläggare m.fl. finns kvar. Kommunens chef finns inte (beslut 2026-10-07).
    for (const role of ["admin", "avtalsansvarig", "samordnare", "coach", "chef", "kommun_handlaggare"]) {
      expect(sara?.personas.some((p) => p.role === role), role).toBe(true);
    }
    // Rollen handledare är borttagen (Karims beslut 2026-10-09, vilande): ingen testperson har den.
    expect(karim?.personas.some((p) => p.role === "handledare")).toBe(false);
    expect(sara?.personas.some((p) => (p.role as string) === "kommun_chef")).toBe(false);
  });

  it("mayImpersonate nekar ekonomen på servern, också om listan skulle innehålla den", async () => {
    const sara = await resolveIdentity(store(self(SARA_T.id, "admin", { isTester: true })), "staging");
    const karim = await resolveIdentity(store(self(KARIM.id, "admin", { isTester: true })), "staging");
    expect(mayImpersonate(karim, { userId: "u-lars" })).toBe(true);
    expect(mayImpersonate(sara, { userId: "u-lars" })).toBe(false);
    expect(mayImpersonate(sara && { ...sara, personas: karim?.personas ?? [] }, { userId: "u-lars" })).toBe(false);
    expect(mayImpersonate(sara, { userId: "u-karin" })).toBe(true);
    expect(mayImpersonate(sara, { userId: "k-maria" })).toBe(true);
  });

  it("begränsad testare som agerar som en testperson: testerId är fortfarande den egna profilen (regeln följer testaren)", async () => {
    const actor = self(SARA_T.id, "admin", { isTester: true, impersonating: true, userId: "u-karin", roles: ["chef"] });
    const id = await resolveIdentity(store(actor), "staging");
    expect(id?.persona.actor).toMatchObject({ userId: "u-karin", roles: ["chef"], testerId: "tester-sara" });
  });

  it("produktion: ingen testerId – ingen ändring för någon", async () => {
    const id = await resolveIdentity(store(self(SARA_T.id, "admin", { isTester: true, environment: "production" })), "production");
    expect(id?.persona.actor.testerId).toBeUndefined();
    expect(id?.personas).toEqual([]);
  });
});

describe("mayImpersonate", () => {
  it("bara testare, bara testpersoner som finns", async () => {
    const tester = await resolveIdentity(store(self(KARIM.id, "admin", { isTester: true })), "staging");
    expect(mayImpersonate(tester, { userId: "u-amira" })).toBe(true);
    expect(mayImpersonate(tester, { userId: "k-maria" })).toBe(true);
    expect(mayImpersonate(tester, { userId: "u-finns-inte" })).toBe(false);
    const robin = await resolveIdentity(store(self("u-robin", "admin")), "staging");
    expect(mayImpersonate(robin, { userId: "u-amira" })).toBe(false);
    expect(mayImpersonate(null, { userId: "u-amira" })).toBe(false);
  });
});
