// Självregistreringens regler (beslut 2026-10-07, synpunkt #2): domänen ur avtalets konfiguration och beställarens tillåtna
// domäner (dubbel nyckel), aldrig en underdomän och aldrig Miljonbemannings domän. Bara påhittade adresser.
import { describe, expect, it } from "vitest";
import { createSeed } from "@/data/seed";
import type { Contract, Organization } from "@/data/schema";
import { emailDomainOf, emailLocalPartOf, nameFromEmail, selfRegistrationContracts } from "./self-registration";

const seed = createSeed();
const contracts = seed.contracts as Contract[];
const orgs = seed.organizations as Organization[];

describe("emailDomainOf", () => {
  it("domänen med små bokstäver – tom sträng utan @ eller utan domän", () => {
    expect(emailDomainOf("Maria.Ekdahl@Botkyrka.SE")).toBe("botkyrka.se");
    expect(emailDomainOf("  ny.person@botkyrka.se ")).toBe("botkyrka.se");
    expect(emailDomainOf("a@b@botkyrka.se")).toBe("botkyrka.se");
    for (const bad of ["", "maria", "@botkyrka.se", "maria@", null, undefined]) expect(emailDomainOf(bad), String(bad)).toBe("");
  });
});

describe("selfRegistrationContracts", () => {
  it("en adress på Botkyrkas domän får registrera sig i avtalet – domänen läses ur avtalets konfiguration", () => {
    expect(contracts.find((c) => c.id === "c-bot")!.config.selfRegistration?.emailDomains).toEqual(["botkyrka.se"]);
    expect(selfRegistrationContracts("ny.handlaggare@botkyrka.se", contracts, orgs)).toEqual(["c-bot"]);
    expect(selfRegistrationContracts("NY.HANDLAGGARE@BOTKYRKA.SE", contracts, orgs)).toEqual(["c-bot"]);
  });

  it("andra domäner, underdomäner och Miljonbemannings domän får inte registrera sig", () => {
    for (const email of ["ny@gmail.com", "ny@sub.botkyrka.se", "ny@botkyrka.se.example.com", "ny@miljonbemanning.se", "ny@xbotkyrka.se", "botkyrka.se", ""]) {
      expect(selfRegistrationContracts(email, contracts, orgs), email).toEqual([]);
    }
  });

  it("dubbel nyckel: domänen måste finnas både i avtalet och bland beställarens domäner, och avtalet måste vara aktivt", () => {
    const bot = contracts.find((c) => c.id === "c-bot")!;
    const withConfig = (patch: Partial<NonNullable<Contract["config"]["selfRegistration"]>> | null) =>
      [{ ...bot, config: { ...bot.config, selfRegistration: patch === null ? undefined : { ...bot.config.selfRegistration!, ...patch } } }] as Contract[];
    // Avtalet saknar regeln: ingen självregistrering.
    expect(selfRegistrationContracts("ny@botkyrka.se", withConfig(null), orgs)).toEqual([]);
    // En felskriven konfiguration öppnar aldrig en domän som beställaren inte har.
    expect(selfRegistrationContracts("ny@miljonbemanning.se", withConfig({ emailDomains: ["botkyrka.se", "miljonbemanning.se"] }), orgs)).toEqual([]);
    // Beställarens domän utan avtalets regel räcker inte.
    expect(selfRegistrationContracts("ny@botkyrka.se", withConfig({ emailDomains: [] }), orgs)).toEqual([]);
    // Avtal i utkast eller avslutade.
    expect(selfRegistrationContracts("ny@botkyrka.se", [{ ...bot, status: "draft" }] as Contract[], orgs)).toEqual([]);
    // Organisationen måste vara en beställare.
    const asSupplier = orgs.map((o) => (o.id === bot.customerId ? { ...o, kind: "supplier" as const } : o));
    expect(selfRegistrationContracts("ny@botkyrka.se", contracts, asSupplier)).toEqual([]);
  });
});

describe("selfRegistrationContracts: kontrollerna i koden (granskningen 2026-10-07)", () => {
  const bot = contracts.find((c) => c.id === "c-bot")!;
  const withVisibility = (scope: string, prototypeScope?: string) =>
    [{ ...bot, config: { ...bot.config, customerVisibility: { ...bot.config.customerVisibility!, scope, ...(prototypeScope ? { prototypeScope } : {}) } } }] as Contract[];

  it("bara när kommunens handläggare ser sina egna beställningar – aldrig med synligheten unit eller all", () => {
    expect(selfRegistrationContracts("ny@botkyrka.se", withVisibility("own"), orgs)).toEqual(["c-bot"]);
    expect(selfRegistrationContracts("ny@botkyrka.se", withVisibility("unit"), orgs)).toEqual([]);
    expect(selfRegistrationContracts("ny@botkyrka.se", withVisibility("all"), orgs)).toEqual([]);
    // Ej fastställt: det preliminära värdet gäller.
    expect(selfRegistrationContracts("ny@botkyrka.se", withVisibility("ATT_FASTSTÄLLA", "unit"), orgs)).toEqual([]);
  });

  it("en konfiguration som inte klarar schemat öppnar aldrig självregistrering", () => {
    const broken = [{ ...bot, config: { ...bot.config, selfRegistration: { emailDomains: ["botkyrka.se", "botkyrka.se"] } } }] as Contract[];
    expect(selfRegistrationContracts("ny@botkyrka.se", broken, orgs)).toEqual([]);
  });

  it("adresser med plustecken får inget konto (samma brevlåda – ett spärrat konto kringgås annars)", () => {
    for (const email of ["kim.testsson+1@botkyrka.se", "+@botkyrka.se", "kim+test@BOTKYRKA.SE"]) expect(selfRegistrationContracts(email, contracts, orgs), email).toEqual([]);
    expect(emailLocalPartOf("Kim.Testsson+1@Botkyrka.se")).toBe("kim.testsson+1");
  });
});

describe("nameFromEmail", () => {
  it("ett preliminärt namn ur adressen – siffror och tecken tas bort", () => {
    expect(nameFromEmail("maria.ekdahl@botkyrka.se")).toBe("Maria Ekdahl");
    expect(nameFromEmail("anna-karin.berg@botkyrka.se")).toBe("Anna-Karin Berg");
    expect(nameFromEmail("ÅSA_ÖBERG2@botkyrka.se")).toBe("Åsa Öberg");
    expect(nameFromEmail("12345@botkyrka.se")).toBe("");
    expect(nameFromEmail("")).toBe("");
  });
});
