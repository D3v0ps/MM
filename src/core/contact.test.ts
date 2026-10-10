// Kontaktvägen (beslut 2026-10-09): förvalet när beställningen inte anger någon, och om deltagaren alls går att nå.
import { describe, expect, it } from "vitest";
import { defaultPreferredContact, hasContactDetails, hasEmail, hasPhone } from "./contact";
import { NO_CONTACT_TEXT, NO_CONTACT_TEXT_PORTAL, participantContactLabel } from "./labels";

describe("kontaktvägen", () => {
  it("förvalet: SMS med telefonnummer, annars e-post, annars telefon", () => {
    expect(defaultPreferredContact({ phone: "070-000 00 00", email: "" })).toBe("sms");
    expect(defaultPreferredContact({ phone: "070-12", email: "test@example.invalid" })).toBe("email");
    expect(defaultPreferredContact({ phone: "", email: "" })).toBe("phone");
  });

  it("förvalet telefon utan nummer är inget val: kontaktuppgift saknas", () => {
    const none = { preferredContact: "phone", phone: "", email: "" };
    expect(hasContactDetails(none)).toBe(false);
    expect(participantContactLabel(none)).toBe(NO_CONTACT_TEXT);
    expect(participantContactLabel(none, NO_CONTACT_TEXT_PORTAL)).toBe("Kontaktuppgift saknas");
    // Ett aktivt val av telefon (äldre mall) med nummer visas som telefon.
    expect(participantContactLabel({ preferredContact: "phone", phone: "070-000 00 00", email: "" })).toBe("Telefon");
    expect(participantContactLabel({ preferredContact: "sms", phone: "070-000 00 00", email: "" })).toBe("SMS");
    expect(participantContactLabel({ preferredContact: "email", phone: "", email: "test@example.invalid" })).toBe("E-post");
    // Brev med adress går att nå.
    expect(hasContactDetails({ preferredContact: "letter", phone: "", email: "", address: "Testgatan 1, 123 45 Testby" })).toBe(true);
    expect(hasContactDetails({ preferredContact: "letter", phone: "", email: "", address: "" })).toBe(false);
  });

  it("samma regel som kanalvalet (SMS och e-post): ett nummer som inte går att tolka eller en adress utan toppdomän räknas inte", () => {
    // Utan nolla eller plus går numret inte att göra om till +46… (src/core/phone.ts) – då finns ingen SMS-kanal.
    for (const phone of ["70 123 45 67", "701234567", "46701234567"]) {
      expect(hasPhone(phone), phone).toBe(false);
      expect(defaultPreferredContact({ phone, email: "" }), phone).toBe("phone");
      expect(hasContactDetails({ preferredContact: "sms", phone, email: "" }), phone).toBe(false);
    }
    expect(hasPhone("070-123 45 67")).toBe(true);
    expect(hasPhone("+46 70 123 45 67")).toBe(true);
    expect(hasEmail("anna@botkyrka")).toBe(false);
    expect(hasEmail(" test@example.invalid ")).toBe(true);
    expect(hasContactDetails({ preferredContact: "email", phone: "", email: "anna@botkyrka" })).toBe(false);
    expect(defaultPreferredContact({ phone: "701234567", email: "test@example.invalid" })).toBe("email");
  });
});
