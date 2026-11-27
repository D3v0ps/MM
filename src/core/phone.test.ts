// Telefonnummer till E.164 (SMS och utringning via 46elks).
import { describe, expect, it } from "vitest";
import { hasPhone, SWEDISH_E164, swedishPhoneE164, swedishPhoneText, toE164 } from "./phone";

describe("toE164", () => {
  it("svenska nummer i alla vanliga skrivsätt blir +46…", () => {
    for (const s of ["070-123 45 67", "0701234567", "070 123 45 67", "+46 70 123 45 67", "+46701234567", "0046701234567", "+46 (0)70-123 45 67", "+460701234567", " 070.123.45.67 ", "(070) 123 45 67"]) {
      expect(toE164(s), s).toBe("+46701234567");
    }
    expect(toE164("08-400 22 750")).toBe("+46840022750");
    expect(toE164("08-123 456")).toBe("+468123456");
  });

  it("utländska nummer med + eller 00 behålls", () => {
    expect(toE164("+45 20 12 34 56")).toBe("+4520123456");
    expect(toE164("0047 912 34 567")).toBe("+4791234567");
  });

  it("ogiltiga nummer ger null", () => {
    for (const s of ["", "   ", "123", "070-12", "0701234567890", "701234567", "46701234567", "+46", "+46 0", "070-ABC 45 67", "ring mig", "+0701234567", "0046", "+12"]) {
      expect(toE164(s), s).toBeNull();
    }
    expect(toE164(null)).toBeNull();
    expect(toE164(undefined)).toBeNull();
  });

  it("hasPhone", () => {
    expect(hasPhone("070-000 00 00")).toBe(true);
    expect(hasPhone("")).toBe(false);
    expect(hasPhone("070")).toBe(false);
  });
});

// Kommunens avtalsansvarig (Karims beslut 2026-11-27): bara svenska nummer, sparade som E.164 och visade med riktnummer.
describe("swedishPhoneE164", () => {
  it("siffror med mellanslag och bindestreck, eller +46 först, blir +46…", () => {
    for (const s of ["070-000 00 00", "0700000000", "070 000 00 00", "+46 70 000 00 00", "+46700000000", "+46 70-000 00 00", " 070-000 00 00 ", "+46070-000 00 00"]) {
      expect(swedishPhoneE164(s), s).toBe("+46700000000");
    }
    expect(swedishPhoneE164("08-123 456 78")).toBe("+46812345678");
    expect(swedishPhoneE164("0123-123 45")).toBe("+4612312345");
  });

  it("annat än ett svenskt nummer ger null", () => {
    for (const s of ["", "070", "0046700000000", "(070) 000 00 00", "070.000.00.00", "+45 20 12 34 56", "700000000", "46700000000", "+46", "070-ABC 00 00", "ring växeln", "+460", "0701234567890"]) {
      expect(swedishPhoneE164(s), s).toBeNull();
    }
    expect(swedishPhoneE164(null)).toBeNull();
    expect(swedishPhoneE164(undefined)).toBeNull();
  });

  it("det sparade numret klarar SWEDISH_E164", () => {
    expect(SWEDISH_E164.test(swedishPhoneE164("070-123 45 67")!)).toBe(true);
    expect(SWEDISH_E164.test("0701234567")).toBe(false);
    expect(SWEDISH_E164.test("+4520123456")).toBe(false);
  });
});

describe("swedishPhoneText", () => {
  it("mobilnummer: 070-123 45 67", () => {
    expect(swedishPhoneText("+46701234567")).toBe("070-123 45 67");
    expect(swedishPhoneText("+46700000000")).toBe("070-000 00 00");
    expect(swedishPhoneText("0731234567")).toBe("073-123 45 67");
  });

  it("riktnummer med två, tre och fyra siffror", () => {
    expect(swedishPhoneText("+46812345678")).toBe("08-123 456 78");
    expect(swedishPhoneText("+4681234567")).toBe("08-123 45 67");
    expect(swedishPhoneText("+468123456")).toBe("08-12 34 56");
    expect(swedishPhoneText("+46311234567")).toBe("031-123 45 67");
    expect(swedishPhoneText("+4612312345")).toBe("0123-123 45");
    expect(swedishPhoneText("+46123123456")).toBe("0123-12 34 56");
  });

  it("ett nummer som inte går att tolka som svenskt visas som det står", () => {
    expect(swedishPhoneText("+4520123456")).toBe("+4520123456");
    expect(swedishPhoneText("växeln")).toBe("växeln");
    expect(swedishPhoneText("")).toBe("");
    expect(swedishPhoneText(null)).toBe("");
  });
});
