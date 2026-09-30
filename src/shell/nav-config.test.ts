import { describe, expect, it } from "vitest";
import { activePath, navFor, PORTAL_NAV } from "./nav-config";

const labels = (role: Parameters<typeof navFor>[0], now: string | null = "2027-02-01T09:12") =>
  navFor(role, { now }).map((g) => [g.label, g.items.map((i) => `${i.label} ${i.to}${i.count ? ` #${i.count}` : ""}`)]);

describe("navFor – samma meny som prototypens NAV", () => {
  it("samordnare", () => {
    expect(labels("samordnare")).toEqual([
      ["Arbete", ["Startsida /start", "Avropsinkorg /inkorg #inbox", "Förfaller /forfaller #deadlines", "Ärenden /arenden"]],
      ["Uppföljning", ["Rapporter /rapporter", "Arbetsgivare och praktik /praktik"]],
    ]);
  });
  it("avtalsansvarig", () => {
    expect(labels("avtalsansvarig")[1]).toEqual(["Avtalet", ["Rapporter /rapporter", "Avtalsavvikelser /avtalsavvikelser", "Kommunanvändare /admin/anvandare"]]);
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
      ["Insyn", ["Ärenden /arenden", "Rapporter /rapporter", "Revisionslogg /admin/logg"]],
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
    expect(PORTAL_NAV.kommun_chef.map((i) => `${i.label} ${i.to}`)).toEqual(["Beställarrapport /portal/bestallarrapport", "Enhetens deltagare /portal/deltagare", "Rapporter /portal/rapporter"]);
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
