import { describe, expect, it } from "vitest";
import type { Actor } from "@/api/roles";
import { createSeed } from "@/data/seed";
import type { Db } from "@/data/schema";
import {
  accessIndex, canSeeNotes, canSeePerson, caseAccess, caseAccessIn, displayName, effectiveCustomerScope, lookupsFor, visibleCases,
  type CaseAccessLookups,
} from "./access";
import { BOTKYRKA_CONFIG, parseContractConfig } from "./config";

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
  it("coach: huvudcoachen full (även skyddade); en annan coach ser kollegans ärende (beslut 2026-10-09) – skyddade bara som ärende", () => {
    expect(caseAccess(C, A("u-amira", "coach"), L({ protectedIdentity: true }))).toBe("full");
    // Teammedlemskap spelar ingen roll för åtkomsten längre: nivån "team" ges inte till någon.
    expect(caseAccess(C, A("u-erik", "coach"), L({ teamUserIds: ["u-amira", "u-erik"] }))).toBe("full");
    expect(caseAccess(C, A("u-erik", "coach"), L())).toBe("full");
    // Den vilande spärren: en coach som inte är huvudcoach ser bara ärendet (nummer och status), som samordnaren.
    expect(caseAccess(C, A("u-erik", "coach"), L({ teamUserIds: ["u-amira", "u-erik"], protectedIdentity: true }))).toBe("restricted");
    expect(caseAccess(C, A("u-erik", "coach"), L({ protectedIdentity: true }))).toBe("restricted");
  });
  it("handledare ser alla ärenden i avtalet, också utan att vara i teamet (beslut 2026-10-09) – skyddade bara som ärende", () => {
    expect(caseAccess(C, A("u-petra", "handledare"), L())).toBe("full");
    expect(caseAccess(C, A("u-david", "handledare"), L())).toBe("full");
    expect(caseAccess(C, A("u-petra", "handledare"), L({ protectedIdentity: true }))).toBe("restricted");
    expect(caseAccess(C, A("u-david", "handledare"), L({ protectedIdentity: true }))).toBe("restricted");
    // Men bara i avtal hen är medlem i.
    expect(caseAccess({ ...C, contractId: "c-ny" }, A("u-petra", "handledare"), L())).toBe("none");
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
  it("kommunens chef finns inte (beslut 2026-10-07): en kvarglömd roll kommun_chef ger ingen åtkomst", () => {
    const eva = A("k-eva", "kommun_chef" as Actor["role"], { customerUnit: "Arbetsmarknadsenheten" });
    expect(caseAccess(C, eva, L())).toBe("none");
    expect(caseAccess(C, eva, L({ protectedIdentity: true }))).toBe("none");
  });
  it("deltagare och okända ärenden: ingen åtkomst", () => {
    expect(caseAccess(C, A("deltagare", "deltagare"), L())).toBe("none");
    expect(caseAccess(null, A("u-johan", "avtalsansvarig"), L())).toBe("none");
  });
  it("bara ärenden i användarens avtal – admin ser alla avtal", () => {
    // Ett annat kommunavtal (påhittat id) – flera avtal i datamodellen.
    const other = { ...C, contractId: "c-ny" };
    expect(caseAccess(other, A("u-sara", "samordnare"), L())).toBe("none");
    expect(caseAccess(other, A("k-maria", "kommun_handlaggare"), L())).toBe("none");
    expect(caseAccess(other, A("u-lars", "ekonom"), L())).toBe("none");
    expect(caseAccess(other, A("u-robin", "admin", { contractIds: [] }), L())).toBe("full");
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
    // Ett avtal i utkast utan fastställd synlighet.
    expect(effectiveCustomerScope(parseContractConfig({ casePrefix: "NYK", dataRole: "processor", customerVisibility: { seesIndividualReports: false, seesCoachNotes: false } }))).toBe("own");
    expect(effectiveCustomerScope({ customerVisibility: { scope: "unit", seesIndividualReports: true, seesCoachNotes: false } })).toBe("unit");
    expect(effectiveCustomerScope({ customerVisibility: { scope: "ATT_FASTSTÄLLA", prototypeScope: "all", seesIndividualReports: true, seesCoachNotes: false } })).toBe("all");
    expect(effectiveCustomerScope(null)).toBe("own");
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
  // Facit räknat med prototypens sel.access på prototypens MM.seed() (prototyp/src/03-domain.js) – efter besluten 2026-10-07:
  // ingen person har skyddade personuppgifter (ärendet "skyddad" är ett vanligt ärende) och kommunens chef finns inte.
  // Beslut 2026-10-09: coach och handledare ser alla 231 ärenden i avtalet (tidigare Amira 29, Erik 54, Petra 63, David 171,
  // Hanna 64 – tilldelningen styr nu bara listor, notiser och påminnelser).
  it.each([
    ["u-sara", "samordnare", { full: 231 }],
    ["u-johan", "avtalsansvarig", { full: 231 }],
    ["u-amira", "coach", { full: 231 }],
    ["u-erik", "coach", { full: 231 }],
    ["u-petra", "handledare", { full: 231 }],
    ["u-david", "handledare", { full: 231 }],
    ["u-hanna", "handledare", { full: 231 }],
    ["u-karin", "chef", { full: 231 }],
    ["u-lars", "ekonom", { billing: 231 }],
    ["u-robin", "admin", { full: 231 }],
    ["k-maria", "kommun_handlaggare", { customer: 71, none: 160 }],
    ["k-ahmed", "kommun_handlaggare", { none: 166, customer: 65 }],
    ["k-omar", "kommun_handlaggare", { none: 192, customer: 39 }],
  ] as const)("%s (%s)", (userId, role, expected) => {
    expect(count(userId, role)).toEqual(expected);
  });
  it("ingen person i testdatat har skyddade personuppgifter, och ingen har rollen kommunens chef", () => {
    expect(db.persons.every((p) => !p.protectedIdentity)).toBe(true);
    expect(db.memberships.some((m) => (m.role as string) === "kommun_chef")).toBe(false);
  });
  it("vilande spärr: sätts skyddade personuppgifter på en person ser bara namngiven coach, avtalsansvarig och beställande handläggare personen", () => {
    const skyddad = db.cases.find((c) => c.id === db.demo_tags.find((t) => t.tag === "skyddad")!.entityIds[0])!;
    // Testet sätter spärren själv (testdatat har inga skyddade personer sedan 2026-10-07).
    const dormant = { ...db, persons: db.persons.map((p) => (p.id === skyddad.personId ? { ...p, protectedIdentity: true } : p)) } as Db;
    const src2 = accessIndex(dormant);
    expect(lookupsFor(skyddad, src2).protectedIdentity).toBe(true);
    const who = dormant.profiles.map((p) => p.id).flatMap((id) => dormant.memberships.filter((m) => m.userId === id && m.contractId === "c-bot").map((m) => ({ id, a: caseAccessIn(skyddad, actorFor(id, m.role), src2) })));
    expect(who.filter((x) => canSeePerson(x.a)).map((x) => x.id).sort()).toEqual([skyddad.leadCoachId, "u-johan", skyddad.referrerId].sort());
    const person = dormant.persons.find((p) => p.id === skyddad.personId)!;
    expect(displayName(skyddad, person, caseAccessIn(skyddad, actorFor("u-sara", "samordnare"), src2))).toBe("Skyddade personuppgifter");
    // En annan coach och en handledare får bara ärendet (restricted) – inte personen.
    expect(caseAccessIn(skyddad, actorFor("u-amira", "coach"), src2)).toBe("restricted");
    expect(caseAccessIn(skyddad, actorFor("u-petra", "handledare"), src2)).toBe("restricted");
    expect(displayName(skyddad, person, caseAccessIn(skyddad, actorFor("u-petra", "handledare"), src2))).toBe("Skyddade personuppgifter");
    expect(displayName(skyddad, person, caseAccessIn(skyddad, actorFor("u-lars", "ekonom"), src2))).toBe("–");
  });
  it("visibleCases = ärenden med annan nivå än none", () => {
    expect(visibleCases(db.cases, actorFor("u-amira", "coach"), src)).toHaveLength(231);
    expect(visibleCases(db.cases, actorFor("u-petra", "handledare"), src)).toHaveLength(231);
    expect(visibleCases(db.cases, actorFor("k-maria", "kommun_handlaggare"), src)).toHaveLength(71);
    expect(visibleCases(db.cases, actorFor("k-maria", "kommun_handlaggare"), src).every((c) => c.referrerId === "k-maria")).toBe(true);
  });
});
