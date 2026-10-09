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
    expect(stayOrStart("/ledning", "handledare")).toBe("/");
  });

  it("går till startsidan från en sida för en enskild post – den nya personen har kanske inte åtkomst till just den", () => {
    // Deltagarkortet loggar annars en nekad visning (case.view_denied) för den nya personen.
    expect(stayOrStart("/arenden/case-260145", "handledare")).toBe("/");
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
    for (const role of ["admin", "avtalsansvarig", "samordnare", "coach", "handledare", "chef", "ekonom"] as const) {
      expect(stayOrStart("/min-vecka", role), role).toBe("/min-vecka");
      expect(stayOrStart("/start", role), role).toBe("/start");
    }
    expect(stayOrStart("/min-vecka", "kommun_handlaggare")).toBe("/");
    expect(stayOrStart("/start", "kommun_handlaggare")).toBe("/");
    // De gamla startsidorna finns kvar under rollens flik.
    expect(stayOrStart("/handledare", "handledare")).toBe("/handledare");
    expect(stayOrStart("/ledning", "chef")).toBe("/ledning");
    expect(stayOrStart("/ekonomi", "ekonom")).toBe("/ekonomi");
    expect(stayOrStart("/admin/anvandare", "admin")).toBe("/admin/anvandare");
  });

  it("okända adresser leder till startsidan", () => {
    expect(stayOrStart("/finns-inte", "coach")).toBe("/");
    expect(stayOrStart("/", "coach")).toBe("/");
  });
});
