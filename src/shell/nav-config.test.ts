import { describe, expect, it } from "vitest";
import { activePath, navFor, PORTAL_NAV, portalNavFor } from "./nav-config";

const labels = (role: Parameters<typeof navFor>[0], now: string | null = "2027-02-01T09:12") =>
  navFor(role, { now }).map((g) => [g.label, g.items.map((i) => `${i.label} ${i.to}${i.count ? ` #${i.count}` : ""}`)]);

describe("navFor – Min vardag för alla och en rollflik (beslut 2026-10-06)", () => {
  it("samordnare: Min vardag + Samordning", () => {
    expect(labels("samordnare")).toEqual([
      ["Min vardag", ["Min vecka /min-vecka", "Ärenden /arenden", "Rapporter /rapporter", "Arbetsgivare och praktik /praktik"]],
      ["Samordning", ["Avropsinkorg /inkorg #inbox", "Förfaller /forfaller #deadlines", "Bygg rapport /rapportbyggare"]],
    ]);
  });
  it("avtalsansvarig: Min vardag + Avtalet (Arbetsgivare och praktik är nytt i menyn – rollen har sidan)", () => {
    expect(labels("avtalsansvarig")).toEqual([
      ["Min vardag", ["Min vecka /min-vecka", "Ärenden /arenden", "Rapporter /rapporter", "Arbetsgivare och praktik /praktik"]],
      [
        "Avtalet",
        ["Avropsinkorg /inkorg #inbox", "Förfaller /forfaller #deadlines", "Avtalsavvikelser /avtalsavvikelser", "Kommunanvändare /admin/anvandare", "Bygg rapport /rapportbyggare"],
      ],
    ]);
  });
  it("coach: bara Min vardag – den vilande rollen handledare har ingen meny (Karims beslut 2026-10-09)", () => {
    expect(labels("coach")).toEqual([
      ["Min vardag", ["Min vecka /min-vecka", "Närvaro /narvaro #unregistered", "Mina ärenden /arenden", "Rapporter /rapporter", "Arbetsgivare och praktik /praktik"]],
    ]);
    expect(navFor("handledare", { now: "2027-02-01T09:12" })).toEqual([]);
    for (const role of ["admin", "avtalsansvarig", "samordnare", "coach", "chef", "ekonom"] as const) {
      expect(navFor(role, { now: "2027-02-01T09:12" }).flatMap((g) => g.items.map((i) => `${i.label} ${i.to}`)).join(" "), role).not.toMatch(/handledare|tilldelade/i);
    }
  });
  it("chef: Min vardag + Ledning", () => {
    expect(labels("chef")).toEqual([
      ["Min vardag", ["Min vecka /min-vecka", "Ärenden /arenden", "Rapporter /rapporter"]],
      ["Ledning", ["Ledningsvy /ledning", "Avtalsavvikelser /avtalsavvikelser", "Förfaller /forfaller #deadlines", "Bygg rapport /rapportbyggare", "Revisionslogg /admin/logg"]],
    ]);
  });
  it("systemadministratör: Min vardag (Ärenden i läsläge) + Administratör – Avtal och konfiguration ligger inte i menyn", () => {
    expect(labels("admin")).toEqual([
      ["Min vardag", ["Min vecka /min-vecka", "Ärenden /arenden"]],
      ["Administratör", ["Användare och roller /admin/anvandare", "Underbiträden och integrationer /admin/integrationer", "Mallar och utskick /admin/mallar", "Revisionslogg /admin/logg"]],
    ]);
    expect(navFor("admin", { now: null }).flatMap((g) => g.items.map((i) => i.to))).not.toContain("/admin/avtal");
  });
  it("ekonom: Min vardag + Ekonomi med fakturakörningen för förra månaden enligt klockan", () => {
    expect(labels("ekonom")).toEqual([
      ["Min vardag", ["Min vecka /min-vecka"]],
      ["Ekonomi", ["Fakturering /ekonomi", "Fakturakörning januari /ekonomi/2027-01", "Prislista /ekonomi/prislista"]],
    ]);
    expect(labels("ekonom", "2027-01-05T08:00")[1][1]).toEqual(["Fakturering /ekonomi", "Fakturakörning december /ekonomi/2026-12", "Prislista /ekonomi/prislista"]);
    // Utan klocka visas inte fakturakörningen (raden kommer när tiden är hämtad).
    expect(labels("ekonom", null)[1][1]).toEqual(["Fakturering /ekonomi", "Prislista /ekonomi/prislista"]);
  });
  it("alla MB-roller börjar menyn med Min vecka, och högst en rollflik", () => {
    for (const role of ["admin", "avtalsansvarig", "samordnare", "coach", "chef", "ekonom"] as const) {
      const groups = navFor(role, { now: "2027-02-01T09:12" });
      expect(groups[0].label, role).toBe("Min vardag");
      expect(groups[0].items[0].to, role).toBe("/min-vecka");
      expect(groups.length, role).toBeLessThanOrEqual(2);
    }
  });
  it("kommun och deltagare har ingen sidopanel", () => {
    expect(navFor("kommun_handlaggare", { now: null })).toEqual([]);
    expect(navFor("deltagare", { now: null })).toEqual([]);
  });
});

describe("portalens meny (KOM_NAV)", () => {
  it("bara handläggaren (beslut 2026-10-07) – med Mina uppgifter, utan beställarrapport och resultat", () => {
    expect(PORTAL_NAV.kommun_handlaggare.map((i) => i.label)).toEqual(["Start", "Beställ ny insats", "Mina deltagare", "Rapporter och meddelanden", "Mina uppgifter"]);
    expect(Object.keys(PORTAL_NAV)).toEqual(["kommun_handlaggare"]);
    const to = portalNavFor("kommun_handlaggare").map((i) => i.to);
    expect(to).toContain("/portal/mina-uppgifter");
    expect(to.some((x) => x.startsWith("/portal/resultat") || x === "/portal/bestallarrapport")).toBe(false);
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
  });
});

describe("activePath", () => {
  const mb = ["/notiser", "/min-vecka", "/inkorg", "/arenden", "/ekonomi", "/ekonomi/2027-01"];
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
