import { describe, expect, it } from "vitest";
import type { Actor } from "@/api/roles";
import { createSeed } from "@/data/seed";
import type { Db } from "@/data/schema";
import {
  accessIndex, canSeeNotes, canSeePerson, caseAccess, caseAccessIn, displayName, effectiveCustomerScope, lookupsFor, unitCovers, visibleCases,
  type CaseAccessLookups,
} from "./access";
import { BOTKYRKA_CONFIG, KK_CONFIG } from "./config";

const A = (userId: string, role: Actor["role"], extra: Partial<Actor> = {}): Actor => ({ userId, role, contractIds: ["c-bot"], ...extra });
const C = { contractId: "c-bot", leadCoachId: "u-amira", referrerId: "k-maria" };
const L = (extra: Partial<CaseAccessLookups> = {}): CaseAccessLookups => ({ protectedIdentity: false, teamUserIds: ["u-amira", "u-petra"], referrerUnit: "Arbetsmarknadsenheten Alby", ...extra });

describe("caseAccess – prototypens regler", () => {
  it("avtalsansvarig ser allt, även skyddade", () => {
    expect(caseAccess(C, A("u-johan", "avtalsansvarig"), L())).toBe("full");
    expect(caseAccess(C, A("u-johan", "avtalsansvarig"), L({ protectedIdentity: true }))).toBe("full");
  });
  it("samordnare, chef och admin: full, men bara ärendet (restricted) vid skyddade personuppgifter", () => {
    for (const role of ["samordnare", "chef", "admin"] as const) {
      expect(caseAccess(C, A("x", role), L())).toBe("full");
      expect(caseAccess(C, A("x", role), L({ protectedIdentity: true }))).toBe("restricted");
    }
  });
  it("coach: huvudcoachen full, teammedlem team, annars ingen – teamet ser aldrig skyddade", () => {
    expect(caseAccess(C, A("u-amira", "coach"), L({ protectedIdentity: true }))).toBe("full");
    expect(caseAccess(C, A("u-erik", "coach"), L({ teamUserIds: ["u-amira", "u-erik"] }))).toBe("team");
    expect(caseAccess(C, A("u-erik", "coach"), L({ teamUserIds: ["u-amira", "u-erik"], protectedIdentity: true }))).toBe("none");
    expect(caseAccess(C, A("u-erik", "coach"), L())).toBe("none");
  });
  it("handledare ser bara tilldelade ärenden", () => {
    expect(caseAccess(C, A("u-petra", "handledare"), L())).toBe("team");
    expect(caseAccess(C, A("u-david", "handledare"), L())).toBe("none");
    expect(caseAccess(C, A("u-petra", "handledare"), L({ protectedIdentity: true }))).toBe("none");
  });
  it("ekonom: billing för alla ärenden i avtalet", () => {
    expect(caseAccess(C, A("u-lars", "ekonom"), L())).toBe("billing");
    expect(caseAccess(C, A("u-lars", "ekonom"), L({ protectedIdentity: true }))).toBe("billing");
  });
  it("kommunens handläggare: egna beställningar (även skyddade), inte andras", () => {
    expect(caseAccess(C, A("k-maria", "kommun_handlaggare"), L())).toBe("customer");
    expect(caseAccess(C, A("k-maria", "kommun_handlaggare"), L({ protectedIdentity: true }))).toBe("customer");
    expect(caseAccess(C, A("k-omar", "kommun_handlaggare", { customerUnit: "Arbetsmarknadsenheten Alby" }), L())).toBe("none");
  });
  it("kommunens handläggare: enhetens eller alla ärenden om avtalet säger det – aldrig andras skyddade", () => {
    const omar = A("k-omar", "kommun_handlaggare", { customerUnit: "Arbetsmarknadsenheten Alby" });
    const ahmed = A("k-ahmed", "kommun_handlaggare", { customerUnit: "Arbetsmarknadsenheten Tumba" });
    expect(caseAccess(C, omar, L({ customerScope: "unit" }))).toBe("customer");
    expect(caseAccess(C, ahmed, L({ customerScope: "unit" }))).toBe("none");
    expect(caseAccess(C, ahmed, L({ customerScope: "all" }))).toBe("customer");
    expect(caseAccess(C, omar, L({ customerScope: "unit", protectedIdentity: true }))).toBe("none");
    expect(caseAccess(C, ahmed, L({ customerScope: "all", protectedIdentity: true }))).toBe("none");
  });
  it("kommunens chef: enhetens ärenden, skyddade bara som restricted", () => {
    const eva = A("k-eva", "kommun_chef", { customerUnit: "Arbetsmarknadsenheten" });
    expect(caseAccess(C, eva, L())).toBe("customer");
    expect(caseAccess(C, eva, L({ protectedIdentity: true }))).toBe("restricted");
    expect(caseAccess(C, A("k-x", "kommun_chef", { customerUnit: "Arbetsmarknadsenheten Tumba" }), L())).toBe("none");
    expect(caseAccess(C, A("k-y", "kommun_chef", { customerUnit: null }), L())).toBe("customer");
  });
  it("deltagare och okända ärenden: ingen åtkomst", () => {
    expect(caseAccess(C, A("deltagare", "deltagare"), L())).toBe("none");
    expect(caseAccess(null, A("u-johan", "avtalsansvarig"), L())).toBe("none");
  });
  it("bara ärenden i användarens avtal – admin ser alla avtal", () => {
    const kk = { ...C, contractId: "c-kk" };
    expect(caseAccess(kk, A("u-sara", "samordnare"), L())).toBe("none");
    expect(caseAccess(kk, A("k-maria", "kommun_handlaggare"), L())).toBe("none");
    expect(caseAccess(kk, A("u-lars", "ekonom"), L())).toBe("none");
    expect(caseAccess(kk, A("u-robin", "admin", { contractIds: [] }), L())).toBe("full");
  });
});

describe("canSeeNotes, canSeePerson och displayName", () => {
  it("anteckningar bara med full eller team, aldrig för ekonom", () => {
    expect(canSeeNotes("full", "coach")).toBe(true);
    expect(canSeeNotes("team", "handledare")).toBe(true);
    for (const a of ["restricted", "billing", "customer", "none"] as const) expect(canSeeNotes(a)).toBe(false);
    expect(canSeeNotes("full", "ekonom")).toBe(false);
  });
  it("personuppgifter med full, team och customer", () => {
    expect(["full", "team", "customer", "restricted", "billing", "none"].map((a) => canSeePerson(a as never))).toEqual([true, true, true, false, false, false]);
  });
  it("namn: skyddade visar 'Skyddade personuppgifter', ekonom och ingen åtkomst '–'", () => {
    const p = { firstName: "Nadia", lastName: "Warsame" };
    const c = { id: "case-1" };
    expect(displayName(c, p, "full")).toBe("Nadia Warsame");
    expect(displayName(c, p, "customer")).toBe("Nadia Warsame");
    expect(displayName(c, p, "restricted")).toBe("Skyddade personuppgifter");
    expect(displayName(c, p, "billing")).toBe("–");
    expect(displayName(c, p, "none")).toBe("–");
    expect(displayName(c, null, "full")).toBe("–");
    expect(displayName(null, p, "full")).toBe("–");
  });
});

describe("avtalskonfiguration och enheter", () => {
  it("synligheten är 'own' så länge avtalet inte fastställt den", () => {
    expect(effectiveCustomerScope(BOTKYRKA_CONFIG)).toBe("own");
    expect(effectiveCustomerScope(KK_CONFIG)).toBe("own");
    expect(effectiveCustomerScope({ customerVisibility: { scope: "unit", seesIndividualReports: true, seesCoachNotes: false } })).toBe("unit");
    expect(effectiveCustomerScope({ customerVisibility: { scope: "ATT_FASTSTÄLLA", prototypeScope: "all", seesIndividualReports: true, seesCoachNotes: false } })).toBe("all");
    expect(effectiveCustomerScope(null)).toBe("own");
  });
  it("chefens enhet omfattar underenheter men inte grannenheter", () => {
    expect(unitCovers("Arbetsmarknadsenheten", "Arbetsmarknadsenheten Hallunda–Fittja")).toBe(true);
    expect(unitCovers("Arbetsmarknadsenheten Alby", "Arbetsmarknadsenheten Alby")).toBe(true);
    expect(unitCovers("Arbetsmarknadsenheten Alby", "Arbetsmarknadsenheten Albyberg")).toBe(false);
    expect(unitCovers("Arbetsmarknadsenheten Alby", null)).toBe(false);
    expect(unitCovers(null, null)).toBe(true);
  });
});

describe("mot testdatat – samma antal som prototypens sel.access", () => {
  const db = createSeed() as unknown as Db;
  const src = accessIndex(db);
  const actorFor = (userId: string, role: Actor["role"]): Actor => {
    const profile = db.profiles.find((p) => p.id === userId);
    return { userId, role, contractIds: db.memberships.filter((m) => m.userId === userId).map((m) => m.contractId), customerUnit: profile?.customerUnit ?? null };
  };
  const count = (userId: string, role: Actor["role"]) => {
    const actor = actorFor(userId, role);
    const m: Record<string, number> = {};
    for (const c of db.cases) { const a = caseAccessIn(c, actor, src); m[a] = (m[a] ?? 0) + 1; }
    return m;
  };
  // Facit räknat med prototypens sel.access på prototypens MM.seed() (prototyp/src/03-domain.js).
  it.each([
    ["u-sara", "samordnare", { full: 230, restricted: 1 }],
    ["u-johan", "avtalsansvarig", { full: 231 }],
    ["u-amira", "coach", { none: 202, full: 29 }],
    ["u-erik", "coach", { none: 177, full: 54 }],
    ["u-petra", "handledare", { none: 168, team: 63 }],
    ["u-david", "handledare", { team: 170, none: 61 }],
    ["u-hanna", "handledare", { none: 167, team: 64 }],
    ["u-karin", "chef", { full: 230, restricted: 1 }],
    ["u-lars", "ekonom", { billing: 231 }],
    ["u-robin", "admin", { full: 230, restricted: 1 }],
    ["k-maria", "kommun_handlaggare", { customer: 71, none: 160 }],
    ["k-ahmed", "kommun_handlaggare", { none: 166, customer: 65 }],
    ["k-omar", "kommun_handlaggare", { none: 192, customer: 39 }],
    ["k-eva", "kommun_chef", { customer: 230, restricted: 1 }],
  ] as const)("%s (%s)", (userId, role, expected) => {
    expect(count(userId, role)).toEqual(expected);
  });
  it("skyddade ärendet: bara namngiven coach, avtalsansvarig och beställande handläggare ser personen", () => {
    const skyddad = db.cases.find((c) => c.id === db.demo_tags.find((t) => t.tag === "skyddad")!.entityIds[0])!;
    expect(lookupsFor(skyddad, src).protectedIdentity).toBe(true);
    const who = db.profiles.map((p) => p.id).flatMap((id) => db.memberships.filter((m) => m.userId === id && m.contractId === "c-bot").map((m) => ({ id, a: caseAccessIn(skyddad, actorFor(id, m.role), src) })));
    expect(who.filter((x) => canSeePerson(x.a)).map((x) => x.id).sort()).toEqual([skyddad.leadCoachId, "u-johan", skyddad.referrerId].sort());
    const person = db.persons.find((p) => p.id === skyddad.personId)!;
    expect(displayName(skyddad, person, caseAccessIn(skyddad, actorFor("u-sara", "samordnare"), src))).toBe("Skyddade personuppgifter");
    expect(displayName(skyddad, person, caseAccessIn(skyddad, actorFor("u-lars", "ekonom"), src))).toBe("–");
  });
  it("visibleCases = ärenden med annan nivå än none", () => {
    expect(visibleCases(db.cases, actorFor("u-amira", "coach"), src)).toHaveLength(29);
    expect(visibleCases(db.cases, actorFor("k-maria", "kommun_handlaggare"), src).every((c) => c.referrerId === "k-maria")).toBe(true);
  });
});
