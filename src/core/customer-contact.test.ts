// Kommunens avtalsansvarig (Karims beslut 2026-11-27): systemadministratörens inmatning → contracts.config.customerContact.
// Påhittade uppgifter – aldrig riktiga personuppgifter i testerna.
import { describe, expect, it } from "vitest";
import { ContractConfigSchema, CUSTOMER_CONTACT_NAME_MAX, BOTKYRKA_CONFIG } from "./config";
import { changedCustomerContactFields, CUSTOMER_CONTACT_ERROR, parseCustomerContactInput } from "./customer-contact";

const TESTA = { name: "Testa Testsson", phone: "070-000 00 00", email: "testa.testsson@exempel.se" };
const SAVED = { name: "Testa Testsson", phone: "+46700000000", email: "testa.testsson@exempel.se" };

describe("parseCustomerContactInput", () => {
  it("sparas med telefonnumret som E.164, namnet utan extra mellanslag och e-postadressen med små bokstäver", () => {
    expect(parseCustomerContactInput(TESTA)).toEqual({ ok: true, contact: SAVED });
    expect(parseCustomerContactInput({ name: "  Testa   Testsson ", phone: " +46 70-000 00 00 ", email: " Testa.Testsson@Exempel.se " })).toEqual({ ok: true, contact: SAVED });
    const r = parseCustomerContactInput(TESTA);
    expect(r.ok && ContractConfigSchema.safeParse({ ...BOTKYRKA_CONFIG, customerContact: r.contact }).success).toBe(true);
  });

  it("alla tre tomma tar bort kontaktpersonen", () => {
    expect(parseCustomerContactInput({ name: "", phone: "", email: "" })).toEqual({ ok: true, contact: null });
    expect(parseCustomerContactInput({ name: "  ", phone: " ", email: "   " })).toEqual({ ok: true, contact: null });
  });

  it("annars krävs alla tre – felen per fält, utan värdena", () => {
    expect(parseCustomerContactInput({ ...TESTA, name: "" })).toEqual({ ok: false, errors: { name: CUSTOMER_CONTACT_ERROR.name } });
    expect(parseCustomerContactInput({ ...TESTA, name: "x".repeat(CUSTOMER_CONTACT_NAME_MAX + 1) })).toEqual({ ok: false, errors: { name: CUSTOMER_CONTACT_ERROR.nameLong } });
    expect(parseCustomerContactInput({ ...TESTA, phone: "" })).toEqual({ ok: false, errors: { phone: CUSTOMER_CONTACT_ERROR.phone } });
    expect(parseCustomerContactInput({ ...TESTA, email: "" })).toEqual({ ok: false, errors: { email: CUSTOMER_CONTACT_ERROR.email } });
    for (const phone of ["0046700000000", "+45 20 12 34 56", "070", "(070) 000 00 00", "ring växeln"]) {
      expect(parseCustomerContactInput({ ...TESTA, phone }), phone).toEqual({ ok: false, errors: { phone: CUSTOMER_CONTACT_ERROR.phone } });
    }
    expect(parseCustomerContactInput({ name: "", phone: "070", email: "testa" })).toEqual({
      ok: false, errors: { name: CUSTOMER_CONTACT_ERROR.name, phone: CUSTOMER_CONTACT_ERROR.phone, email: CUSTOMER_CONTACT_ERROR.email },
    });
    // Felen säger aldrig vad som skrevs.
    const r = parseCustomerContactInput({ name: "Testa Testsson", phone: "070-000", email: "testa.testsson" });
    expect(JSON.stringify(r)).not.toMatch(/Testsson|070-000|testa\.testsson/);
  });
});

describe("changedCustomerContactFields", () => {
  it("bara fälten som skiljer sig, i ordningen namn, telefon, e-post", () => {
    expect(changedCustomerContactFields(null, SAVED)).toEqual(["name", "phone", "email"]);
    expect(changedCustomerContactFields(SAVED, null)).toEqual(["name", "phone", "email"]);
    expect(changedCustomerContactFields(undefined, null)).toEqual([]);
    expect(changedCustomerContactFields(SAVED, { ...SAVED })).toEqual([]);
    expect(changedCustomerContactFields(SAVED, { ...SAVED, email: "testa@exempel.se", phone: "+46701234567" })).toEqual(["phone", "email"]);
  });
});
