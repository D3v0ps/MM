// Kommunens avtalsansvarig (Karims beslut 2026-11-27) – rena funktioner utan I/O. Systemadministratören skriver namn, telefon
// och e-post på avtalssidan (admin.setCustomerContact); här blir inmatningen det som sparas i contracts.config.customerContact
// (CustomerContactSchema i src/core/config.ts). Tre tomma fält tar bort kontaktpersonen. Felen säger aldrig vad som skrevs –
// värdena är personuppgifter (CLAUDE.md punkt 2).
import { CUSTOMER_CONTACT_EMAIL_MAX, CUSTOMER_CONTACT_NAME_MAX, CustomerContactSchema, type CustomerContact } from "./config";
import { emailValid } from "./email";
import { swedishPhoneE164 } from "./phone";

export type CustomerContactField = keyof CustomerContact;
/** Fälten i den ordning de visas och loggas. */
export const CUSTOMER_CONTACT_FIELDS: readonly CustomerContactField[] = ["name", "phone", "email"];

export type CustomerContactInput = { name: string; phone: string; email: string };
export type CustomerContactErrors = Partial<Record<CustomerContactField, string>>;
export type CustomerContactParse = { ok: true; contact: CustomerContact | null } | { ok: false; errors: CustomerContactErrors };

/** Felen per fält. */
export const CUSTOMER_CONTACT_ERROR = {
  name: "Skriv namnet.",
  nameLong: `Namnet får vara högst ${CUSTOMER_CONTACT_NAME_MAX} tecken.`,
  phone: "Skriv ett svenskt telefonnummer, till exempel 070-123 45 67.",
  email: "Skriv en hel e-postadress.",
} as const;

/**
 * Inmatningen som den sparas: namnet utan extra mellanslag, telefonnumret som svenskt E.164-nummer ("+46…") och e-postadressen
 * med små bokstäver. Alla tre tomma = ta bort (contact null). Annars krävs alla tre – felen per fält.
 */
export function parseCustomerContactInput(raw: CustomerContactInput): CustomerContactParse {
  const name = String(raw.name ?? "").trim().replace(/\s+/g, " ");
  const phoneRaw = String(raw.phone ?? "").trim();
  const email = String(raw.email ?? "").trim().toLowerCase();
  if (!name && !phoneRaw && !email) return { ok: true, contact: null };
  const errors: CustomerContactErrors = {};
  if (!name) errors.name = CUSTOMER_CONTACT_ERROR.name;
  else if (name.length > CUSTOMER_CONTACT_NAME_MAX) errors.name = CUSTOMER_CONTACT_ERROR.nameLong;
  const phone = swedishPhoneE164(phoneRaw);
  if (!phone) errors.phone = CUSTOMER_CONTACT_ERROR.phone;
  if (!emailValid(email) || email.length > CUSTOMER_CONTACT_EMAIL_MAX) errors.email = CUSTOMER_CONTACT_ERROR.email;
  if (Object.keys(errors).length) return { ok: false, errors };
  // Samma schema som avtalskonfigurationen: det som sparas klarar alltid ContractConfigSchema (kontrollerna ovan är minst lika
  // stränga – ett fel här är ett programfel, och ZodError har inga värden i meddelandet).
  return { ok: true, contact: CustomerContactSchema.parse({ name, phone, email }) };
}

/** Fälten som skiljer sig (för revisionsloggen – bara fältnamnen, aldrig värdena). */
export function changedCustomerContactFields(from: CustomerContact | null | undefined, to: CustomerContact | null | undefined): CustomerContactField[] {
  return CUSTOMER_CONTACT_FIELDS.filter((k) => (from?.[k] ?? null) !== (to?.[k] ?? null));
}
