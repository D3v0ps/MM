// Byte av testperson: stanna på listor och översikter som den nya rollen får se – annars rollens startsida ("/").
import { describe, expect, it } from "vitest";
import { stayOrStart } from "./stay-or-start";

describe("stayOrStart", () => {
  it("stannar på en lista som den nya rollen får se, med valen i adressen", () => {
    expect(stayOrStart("/arenden?status=active", "avtalsansvarig")).toBe("/arenden?status=active");
    expect(stayOrStart("/rapporter", "chef")).toBe("/rapporter");
    expect(stayOrStart("/inkorg", "avtalsansvarig")).toBe("/inkorg");
  });

  it("går till startsidan när den nya rollen inte får se sidan", () => {
    expect(stayOrStart("/inkorg", "coach")).toBe("/");
    expect(stayOrStart("/ledning", "coach")).toBe("/");
  });

  it("går till startsidan från en sida för en enskild post – den nya personen har kanske inte åtkomst till just den", () => {
    // Deltagarkortet loggar annars en nekad visning (case.view_denied) för den nya personen.
    expect(stayOrStart("/arenden/case-260145", "coach")).toBe("/");
    expect(stayOrStart("/arenden/case-260143?flik=tidslinje", "samordnare")).toBe("/");
    expect(stayOrStart("/avstamning/case-260143", "coach")).toBe("/");
    expect(stayOrStart("/rapporter/rep-16107", "chef")).toBe("/");
    expect(stayOrStart("/inkorg/em-103", "samordnare")).toBe("/");
  });

  it("en begränsad testare stannar aldrig på en sida som är stängd för testare", () => {
    expect(stayOrStart("/admin/avtal?flik=priser", "admin", true)).toBe("/");
    expect(stayOrStart("/ekonomi", "chef", true)).toBe("/");
    // Samma sidor för den som ser allt.
    expect(stayOrStart("/admin/avtal", "admin", false)).toBe("/admin/avtal");
  });

  it("Min vecka: alla MB-roller stannar; /start stannar för alla MB-roller och leder sedan vidare (beslut 2026-10-06, alla roller sedan 2026-10-08)", () => {
    for (const role of ["admin", "avtalsansvarig", "samordnare", "coach", "chef", "ekonom"] as const) {
      expect(stayOrStart("/min-vecka", role), role).toBe("/min-vecka");
      expect(stayOrStart("/start", role), role).toBe("/start");
    }
    // Rollen handledare är vilande (beslut 2026-10-09) och når inga sidor; handledarens lista /handledare finns inte.
    expect(stayOrStart("/min-vecka", "handledare")).toBe("/");
    expect(stayOrStart("/handledare", "coach")).toBe("/");
    expect(stayOrStart("/min-vecka", "kommun_handlaggare")).toBe("/");
    expect(stayOrStart("/start", "kommun_handlaggare")).toBe("/");
    // De gamla startsidorna finns kvar under rollens flik.
    expect(stayOrStart("/ledning", "chef")).toBe("/ledning");
    expect(stayOrStart("/ekonomi", "ekonom")).toBe("/ekonomi");
    expect(stayOrStart("/admin/anvandare", "admin")).toBe("/admin/anvandare");
  });

  it("flera roller (Karims beslut 7, 2026-10-09): stannar om någon av rollerna får se sidan – en begränsad testare aldrig på en stängd sida", () => {
    expect(stayOrStart("/inkorg", ["coach", "samordnare"])).toBe("/inkorg");
    expect(stayOrStart("/ledning", ["coach", "ekonom"])).toBe("/");
    expect(stayOrStart("/ekonomi", ["coach", "ekonom"])).toBe("/ekonomi");
    expect(stayOrStart("/admin/anvandare", ["admin", "avtalsansvarig"])).toBe("/admin/anvandare");
    expect(stayOrStart("/admin/avtal", ["admin", "avtalsansvarig"])).toBe("/admin/avtal");
    // Begränsad testare med coach och ekonom: Ekonomi är stängd, Min vecka och ärendelistan inte.
    expect(stayOrStart("/ekonomi", ["coach", "ekonom"], true)).toBe("/");
    expect(stayOrStart("/min-vecka", ["coach", "ekonom"], true)).toBe("/min-vecka");
    expect(stayOrStart("/arenden", ["coach", "ekonom"], true)).toBe("/arenden");
    // Kommunens handläggare och en MB-roll: portalen och MB-sidorna.
    expect(stayOrStart("/portal", ["ekonom", "kommun_handlaggare"])).toBe("/portal");
    expect(stayOrStart("/min-vecka", ["ekonom", "kommun_handlaggare"])).toBe("/min-vecka");
  });

  it("okända adresser leder till startsidan", () => {
    expect(stayOrStart("/finns-inte", "coach")).toBe("/");
    expect(stayOrStart("/", "coach")).toBe("/");
  });
});
