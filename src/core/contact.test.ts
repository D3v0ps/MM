// Kontaktvägen (beslut 2026-10-09): förvalet när beställningen inte anger någon, och om deltagaren alls går att nå.
import { describe, expect, it } from "vitest";
import { contactErrors, defaultPreferredContact, hasContactDetails } from "./contact";
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

  it("kontrollen i Registrera beställning och Ändra kontaktväg: samma fält, samma texter", () => {
    expect(contactErrors({ preferredContact: "sms", phone: "070-000 00 00", email: "" })).toEqual({});
    expect(contactErrors({ preferredContact: "email", phone: "", email: "test@example.invalid" })).toEqual({});
    expect(Object.keys(contactErrors({ preferredContact: "sms", phone: "070-12", email: "" }))).toEqual(["phone"]);
    expect(Object.keys(contactErrors({ preferredContact: "phone", phone: "", email: "test@example.invalid" }))).toEqual(["phone"]);
    expect(contactErrors({ preferredContact: "email", phone: "070-000 00 00", email: "" }).email).toBe("Skriv deltagarens e-postadress – e-post är vald som kontaktväg.");
    expect(contactErrors({ preferredContact: "sms", phone: "070-000 00 00", email: "inte-en-adress" }).email).toBe("Skriv en hel e-postadress, eller lämna fältet tomt.");
    expect(contactErrors({ preferredContact: "letter", phone: "", email: "", address: "Kort" })).toEqual({ address: "Skriv hela adressen – kallelsen ska skickas med brev." });
    expect(contactErrors({ preferredContact: "letter", phone: "", email: "", address: "Testgatan 1, 123 45 Testby" })).toEqual({});
  });
});
