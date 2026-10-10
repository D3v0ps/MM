// Telefonnummer till E.164 (SMS och utringning via 46elks).
import { describe, expect, it } from "vitest";
import { hasPhone, toE164 } from "./phone";

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
