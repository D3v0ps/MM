import { describe, expect, it } from "vitest";
import { activePath, navFor, PORTAL_NAV, portalNavFor } from "./nav-config";

const labels = (role: Parameters<typeof navFor>[0], now: string | null = "2027-02-01T09:12") =>
  navFor(role, { now }).map((g) => [g.label, g.items.map((i) => `${i.label} ${i.to}${i.count ? ` #${i.count}` : ""}`)]);

describe("navFor – samma meny som prototypens NAV", () => {
  it("samordnare", () => {
    expect(labels("samordnare")).toEqual([
      ["Arbete", ["Startsida /start", "Avropsinkorg /inkorg #inbox", "Förfaller /forfaller #deadlines", "Ärenden /arenden"]],
      ["Uppföljning", ["Rapporter /rapporter", "Bygg rapport /rapportbyggare", "Arbetsgivare och praktik /praktik"]],
    ]);
  });
  it("avtalsansvarig", () => {
    expect(labels("avtalsansvarig")[1]).toEqual(["Avtalet", ["Rapporter /rapporter", "Bygg rapport /rapportbyggare", "Avtalsavvikelser /avtalsavvikelser", "Kommunanvändare /admin/anvandare"]]);
  });
  it("coach och handledare", () => {
    expect(labels("coach")).toEqual([
      ["Min vardag", ["Min vecka /min-vecka", "Närvaro /narvaro #unregistered", "Mina ärenden /arenden"]],
      ["Uppföljning", ["Rapporter /rapporter", "Arbetsgivare och praktik /praktik"]],
    ]);
    expect(labels("handledare")).toEqual([["Min vardag", ["Mina tilldelade ärenden /handledare", "Närvaro /narvaro", "Arbetsgivare och praktik /praktik"]]]);
  });
  it("chef och admin", () => {
    expect(labels("chef")).toEqual([
      ["Ledning", ["Ledningsvy /ledning", "Avtalsavvikelser /avtalsavvikelser", "Förfaller /forfaller #deadlines"]],
      ["Insyn", ["Ärenden /arenden", "Rapporter /rapporter", "Bygg rapport /rapportbyggare", "Revisionslogg /admin/logg"]],
    ]);
    expect(labels("admin")[0][1]).toEqual([
      "Avtal och konfiguration /admin/avtal",
      "Användare och roller /admin/anvandare",
      "Underbiträden och integrationer /admin/integrationer",
      "Mallar och utskick /admin/mallar",
      "Revisionslogg /admin/logg",
    ]);
  });
  it("ekonom: fakturakörning för förra månaden enligt klockan", () => {
    expect(labels("ekonom")).toEqual([["Ekonomi", ["Fakturering /ekonomi", "Fakturakörning januari /ekonomi/2027-01"]]]);
    expect(labels("ekonom", "2027-01-05T08:00")[0][1]).toEqual(["Fakturering /ekonomi", "Fakturakörning december /ekonomi/2026-12"]);
    // Utan klocka visas bara Fakturering (raden kommer när tiden är hämtad).
    expect(labels("ekonom", null)[0][1]).toEqual(["Fakturering /ekonomi"]);
  });
  it("kommun och deltagare har ingen sidopanel", () => {
    expect(navFor("kommun_handlaggare", { now: null })).toEqual([]);
    expect(navFor("deltagare", { now: null })).toEqual([]);
  });
});

describe("portalens meny (KOM_NAV)", () => {
  it("handläggare och chef", () => {
    expect(PORTAL_NAV.kommun_handlaggare.map((i) => i.label)).toEqual(["Start", "Beställ ny insats", "Mina deltagare", "Rapporter och meddelanden"]);
    expect(PORTAL_NAV.kommun_chef.map((i) => `${i.label} ${i.to}`)).toEqual([
      "Beställarrapport /portal/bestallarrapport", "Enhetens deltagare /portal/deltagare", "Rapporter /portal/rapporter", "Hämta resultat /portal/resultat",
    ]);
  });
  it("Hämta resultat visas bara när avtalet har resultatfilen (navCounts.resultFile)", () => {
    const chef = (counts: { resultFile?: boolean } | null) => portalNavFor("kommun_chef", counts).map((i) => i.label);
    expect(chef({ resultFile: true })).toEqual(["Beställarrapport", "Enhetens deltagare", "Rapporter", "Hämta resultat"]);
    expect(chef({ resultFile: false })).toEqual(["Beställarrapport", "Enhetens deltagare", "Rapporter"]);
    expect(chef(null)).toEqual(["Beställarrapport", "Enhetens deltagare", "Rapporter"]);
    // Handläggaren har aldrig menyvalet
    expect(portalNavFor("kommun_handlaggare", { resultFile: true }).map((i) => i.to)).not.toContain("/portal/resultat");
  });
});

describe("rapportbyggaren (rapporter steg 4)", () => {
  it("Bygg rapport direkt efter Rapporter – bara samordnare, avtalsansvarig och chef", () => {
    const has = (role: Parameters<typeof navFor>[0]) => navFor(role, { now: "2027-02-01T09:12" }).flatMap((g) => g.items.map((i) => i.to)).includes("/rapportbyggare");
    expect(["samordnare", "avtalsansvarig", "chef"].map((r) => has(r as never))).toEqual([true, true, true]);
    expect(["coach", "handledare", "ekonom", "admin"].map((r) => has(r as never))).toEqual([false, false, false, false]);
    // Rapportbyggaren och rapportlistan är olika menyval.
    expect(activePath("/rapportbyggare/sr-1", ["/rapporter", "/rapportbyggare"])).toBe("/rapportbyggare");
    expect(activePath("/rapporter/rep-1", ["/rapporter", "/rapportbyggare"])).toBe("/rapporter");
    // Kommunens delade rapporter ligger under Hämta resultat (ingen ny menyrad).
    expect(activePath("/portal/resultat/rapporter/sr-1", PORTAL_NAV.kommun_chef.map((i) => i.to))).toBe("/portal/resultat");
  });
});

describe("activePath", () => {
  const mb = ["/notiser", "/start", "/inkorg", "/arenden", "/ekonomi", "/ekonomi/2027-01"];
  it("samma sökväg eller undersida, längsta träff vinner", () => {
    expect(activePath("/arenden", mb)).toBe("/arenden");
    expect(activePath("/arenden/case-1", mb)).toBe("/arenden");
    expect(activePath("/inkorg/em-101", mb)).toBe("/inkorg");
    expect(activePath("/ekonomi/2027-01/faktura/case-1", mb)).toBe("/ekonomi/2027-01");
    expect(activePath("/ekonomi/arende/case-1", mb)).toBe("/ekonomi");
    expect(activePath("/arendekort", mb)).toBeNull();
    expect(activePath("/ledning", mb)).toBeNull();
  });
  it("portalen: Start är bara aktiv på /portal", () => {
    const p = PORTAL_NAV.kommun_handlaggare.map((i) => i.to);
    expect(activePath("/portal", p)).toBe("/portal");
    expect(activePath("/portal/deltagare/case-1", p)).toBe("/portal/deltagare");
    expect(activePath("/portal/bestall", p)).toBe("/portal/bestall");
  });
});
