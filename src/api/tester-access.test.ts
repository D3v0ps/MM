// Regeln för testarna i testmiljön (beslut 2026-10-02): bara Karim och Ali ser priser, belopp och villkor. Alla andra testare –
// också framtida – är begränsade. Ingen testare (riktiga användare, produktion, prototypen, minnesläget) = ingen ändring.
import { describe, expect, it } from "vitest";
import { TESTERS } from "@/data/supabase/seed-rows";
import { navFor } from "@/shell/nav-config";
import { startPathFor, START_PATH } from "@/shell/routes";
import { ROLES, type Actor } from "./roles";
import {
  FULL_ACCESS_TESTERS, hidesCommercial, hidesMoney, isTesterHiddenPath, MONEY_ROLES, moneyVisible, roleHiddenFromTesters, testerActor, testerRoleBlocks, TESTER_HIDDEN_PAGE,
  TESTER_HIDDEN_TEXT,
} from "./tester-access";

const actor = (extra: Partial<Actor> = {}): Actor => ({ userId: "u-robin", roles: ["admin"], contractIds: ["c-bot"], ...extra });

describe("hidesCommercial", () => {
  it("fullständig åtkomst: Karim och Ali (även när de agerar som en testperson)", () => {
    expect([...FULL_ACCESS_TESTERS]).toEqual(["tester-karim", "tester-ali"]);
    expect(hidesCommercial(actor({ testerId: "tester-karim" }))).toBe(false);
    expect(hidesCommercial(actor({ testerId: "tester-ali", userId: "u-karin", roles: ["chef"] }))).toBe(false);
  });

  it("begränsade: alla andra testare i TESTERS och framtida testare (neka som standard)", () => {
    const limited = TESTERS.map((t) => t.id).filter((id) => !FULL_ACCESS_TESTERS.includes(id));
    expect(limited).toEqual(expect.arrayContaining(["tester-sara", "tester-adam", "tester-shafik", "tester-moda"]));
    for (const id of [...limited, "tester-yacine", "tester-ny-kollega", ""]) expect(hidesCommercial(actor({ testerId: id })), id).toBe(true);
    // Agerar som vilken testperson som helst – regeln följer testaren, inte testpersonen.
    expect(hidesCommercial(actor({ testerId: "tester-sara", userId: "k-maria", roles: ["kommun_handlaggare"] }))).toBe(true);
  });

  it("ingen testare: riktiga användare, produktion, prototypen och minnesläget – ingen ändring", () => {
    expect(hidesCommercial(actor())).toBe(false);
    expect(hidesCommercial({})).toBe(false);
    expect(hidesCommercial(null)).toBe(false);
    expect(hidesCommercial(undefined)).toBe(false);
  });

  it("rollen ekonom är stängd för begränsade testare – utom sessionens egna frågor", () => {
    expect(roleHiddenFromTesters("ekonom")).toBe(true);
    expect(roleHiddenFromTesters("chef")).toBe(false);
    const ekonom = actor({ roles: ["ekonom"], userId: "u-lars", testerId: "tester-sara" });
    expect(testerRoleBlocks(ekonom, "notiser.list")).toBe(true);
    expect(testerRoleBlocks(ekonom, "session.navCounts")).toBe(false);
    expect(testerRoleBlocks({ ...ekonom, testerId: "tester-karim" }, "notiser.list")).toBe(false);
    expect(testerRoleBlocks({ ...ekonom, testerId: undefined }, "notiser.list")).toBe(false);
    expect(testerRoleBlocks(actor({ roles: ["chef"], testerId: "tester-sara" }), "ledning.overview")).toBe(false);
  });

  it("texterna", () => {
    expect(TESTER_HIDDEN_TEXT).toBe("Visas inte för testare");
    expect(TESTER_HIDDEN_PAGE).toBe("Den här sidan visas inte för testare.");
  });
});

// Beslut 5 (Karim 2026-10-07): belopp syns bara för rollen ekonom – samma skydd som en begränsad testare för alla andra roller.
describe("hidesMoney: belopp bara för rollen ekonom", () => {
  it("ekonomen ser belopp i sitt avtal – utom som begränsad testare", () => {
    expect([...MONEY_ROLES]).toEqual(["ekonom"]);
    const lars = actor({ userId: "u-lars", roles: ["ekonom"] });
    expect(hidesMoney(lars, "c-bot")).toBe(false);
    expect(hidesMoney({ ...lars, testerId: "tester-karim" }, "c-bot")).toBe(false);
    expect(hidesMoney({ ...lars, testerId: "tester-sara" }, "c-bot")).toBe(true);
    // Inget avtal, eller ett avtal där personen inte är ekonom: inga belopp.
    expect(hidesMoney(lars, "c-ny")).toBe(true);
    expect(hidesMoney(lars, null)).toBe(true);
  });

  it("alla andra roller – också systemadministratören, chefen och kommunen – får samma skydd som en begränsad testare", () => {
    const others = ROLES.filter((r) => r !== "ekonom");
    expect(others).toEqual(expect.arrayContaining(["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin", "kommun_handlaggare", "deltagare"]));
    for (const role of others) {
      for (const testerId of [undefined, "tester-karim", "tester-sara"]) expect(hidesMoney(actor({ roles: [role], testerId }), "c-bot"), `${role} ${testerId}`).toBe(true);
      expect(moneyVisible(role, false), role).toBe(false);
    }
    expect(hidesMoney(null, "c-bot")).toBe(true);
    expect(hidesMoney(undefined, "c-bot")).toBe(true);
    expect(moneyVisible("ekonom", false)).toBe(true);
    expect(moneyVisible("ekonom", true)).toBe(false);
  });
});

// Alla roller samtidigt (Karims beslut 7, 2026-10-09): den som har rollen ekonom ser belopp alltid – också med andra roller –
// men bara i avtalen där personen är ekonom (summan av rollerna, aldrig mer).
describe("hidesMoney med flera roller", () => {
  it("coach och ekonom ser belopp; coach utan ekonom aldrig; begränsad testare aldrig", () => {
    expect(hidesMoney(actor({ userId: "u-x", roles: ["coach", "ekonom"] }), "c-bot")).toBe(false);
    expect(hidesMoney(actor({ userId: "u-x", roles: ["admin", "avtalsansvarig", "chef", "coach", "samordnare"] }), "c-bot")).toBe(true);
    expect(hidesMoney(actor({ userId: "u-x", roles: ["coach", "ekonom"], testerId: "tester-sara" }), "c-bot")).toBe(true);
    expect(hidesMoney(actor({ userId: "u-x", roles: ["coach", "ekonom"], testerId: "tester-karim" }), "c-bot")).toBe(false);
  });
  it("roller i olika avtal: coach i c-bot och ekonom i c-ny ser belopp bara i c-ny", () => {
    const split = actor({ userId: "u-x", roles: ["coach", "ekonom"], contractIds: ["c-bot", "c-ny"], roleContracts: { coach: ["c-bot"], ekonom: ["c-ny"] } });
    expect(hidesMoney(split, "c-bot")).toBe(true);
    expect(hidesMoney(split, "c-ny")).toBe(false);
  });
  it("en begränsad testare med rollen ekonom och en annan roll arbetar med den andra rollen (testerActor) – utan ekonomen", () => {
    const raw = actor({ roles: ["coach", "ekonom"], testerId: "tester-sara", contractIds: ["c-bot", "c-ny"], roleContracts: { coach: ["c-bot"], ekonom: ["c-ny"] } });
    // Utan testerActor skulle allt nekas – testaren har fått rollerna av administratören och agerar som sig själv.
    expect(testerRoleBlocks(raw, "coach.minVecka")).toBe(true);
    const a = testerActor(raw);
    expect(a.roles).toEqual(["coach"]);
    expect(a.contractIds).toEqual(["c-bot"]);
    expect(a.roleContracts).toBeUndefined();
    expect(testerRoleBlocks(a, "coach.minVecka")).toBe(false);
    expect(hidesMoney(a, "c-ny")).toBe(true);
    // Bara dolda roller: aktören orörd – allt utom sessionens frågor nekas.
    const onlyEkonom = actor({ roles: ["ekonom"], testerId: "tester-sara" });
    expect(testerActor(onlyEkonom)).toBe(onlyEkonom);
    expect(testerRoleBlocks(onlyEkonom, "coach.minVecka")).toBe(true);
    // Testare med fullständig åtkomst och vanliga användare: orörda.
    const karim = { ...raw, testerId: "tester-karim" };
    expect(testerActor(karim)).toBe(karim);
    const plain = { ...raw, testerId: undefined };
    expect(testerActor(plain)).toBe(plain);
    expect(testerRoleBlocks(actor({ roles: ["coach"], testerId: "tester-sara" }), "coach.minVecka")).toBe(false);
  });
});

describe("stängda sidor, menyn och startsidan", () => {
  it("avtalssidan (alla flikar) och Ekonomi är stängda – inga andra sidor", () => {
    for (const p of ["/admin/avtal", "/ekonomi", "/ekonomi/2027-01", "/ekonomi/arende/case-260117", "/ekonomi/2027-01/faktura/case-260117", "/ekonomi/prislista"]) expect(isTesterHiddenPath(p), p).toBe(true);
    for (const p of ["/admin/avtalx", "/admin/anvandare", "/admin/integrationer", "/ekonomix", "/arenden", "/ledning", "/portal/bestall"]) expect(isTesterHiddenPath(p), p).toBe(false);
  });

  it("menyn: Ekonomi bara för ekonomen och döljs för begränsade testare; Avtal och konfiguration ligger inte i menyn för någon", () => {
    const now = "2027-02-01T09:12";
    const links = (role: Parameters<typeof navFor>[0], hidesCommercial?: boolean) => navFor(role, { now, hidesCommercial }).flatMap((g) => g.items.map((i) => i.to));
    expect(links("admin")).toEqual(["/min-vecka", "/aktiviteter", "/arenden", "/admin/anvandare", "/admin/integrationer", "/admin/mallar", "/grupper", "/admin/logg"]);
    expect(links("admin", true)).toEqual(links("admin"));
    expect(links("ekonom")).toEqual(["/min-vecka", "/ekonomi", "/ekonomi/2027-01", "/ekonomi/prislista"]);
    // Beslut 5: ingen annan roll har Ekonomi i menyn (chefen hade länken förut).
    for (const role of ["admin", "samordnare", "avtalsansvarig", "coach", "handledare", "chef"] as const) {
      expect(links(role).filter((to) => to.startsWith("/ekonomi")), role).toEqual([]);
    }
    // En begränsad testare får inte agera som ekonom – menyn är tom som förut (också Min vecka).
    expect(navFor("ekonom", { now, hidesCommercial: true })).toEqual([]);
    // Övriga roller har samma meny som förut.
    for (const role of ["samordnare", "avtalsansvarig", "coach", "handledare", "chef"] as const) expect(links(role, true)).toEqual(links(role));
    for (const role of ["admin", "samordnare", "avtalsansvarig", "coach", "handledare", "chef", "ekonom"] as const) {
      for (const to of links(role, true)) expect(isTesterHiddenPath(to), `${role} ${to}`).toBe(false);
    }
  });

  it("startsidan: alla MB-roller börjar på Min vecka – en begränsad testare som ekonom på Notiser", () => {
    expect(startPathFor("admin")).toBe(START_PATH.admin);
    expect(startPathFor("admin", false)).toBe("/min-vecka");
    expect(startPathFor("admin", true)).toBe("/min-vecka");
    expect(isTesterHiddenPath(START_PATH.admin)).toBe(false);
    expect(startPathFor("ekonom")).toBe("/min-vecka");
    expect(startPathFor("ekonom", true)).toBe("/notiser");
    expect(isTesterHiddenPath(startPathFor("ekonom", true))).toBe(false);
    for (const role of ["samordnare", "avtalsansvarig", "coach", "handledare", "chef"] as const) {
      expect(START_PATH[role], role).toBe("/min-vecka");
      expect(startPathFor(role, true)).toBe(START_PATH[role]);
    }
    expect(startPathFor("kommun_handlaggare", true)).toBe(START_PATH.kommun_handlaggare);
  });

  it("startsidan med flera roller (Karims beslut 7): MB-rollerna före kommunens; en begränsad testare med ekonom och coach börjar på Min vecka", () => {
    expect(startPathFor(["coach", "ekonom"])).toBe("/min-vecka");
    expect(startPathFor(["admin", "avtalsansvarig"])).toBe("/min-vecka");
    expect(startPathFor(["ekonom", "kommun_handlaggare"])).toBe("/min-vecka");
    expect(startPathFor(["coach", "ekonom"], true)).toBe("/min-vecka");
    // Bara roller som är dolda för testare: Notiser.
    expect(startPathFor(["ekonom"], true)).toBe("/notiser");
    // Ekonom och kommunens handläggare som begränsad testare: portalen (ekonomrollen räknas inte).
    expect(startPathFor(["ekonom", "kommun_handlaggare"], true)).toBe("/portal");
  });
});
