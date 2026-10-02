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

  it("okända adresser leder till startsidan", () => {
    expect(stayOrStart("/finns-inte", "coach")).toBe("/");
    expect(stayOrStart("/", "coach")).toBe("/");
  });
});
