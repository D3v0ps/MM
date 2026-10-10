// Deltagarens kontaktväg (beslut 2026-10-09: beställningen frågar inte längre efter kontaktväg). Rena funktioner – används av
// servern (createOrder), skärmarna (Registrera beställning, kommunens formulär), vyerna (deltagarkortet, avropsinkorgen) och
// kanalvalet för kallelsen och inbjudan (src/features/_shared/participant-notify.ts).
// En och samma regel överallt: ett telefonnummer räknas när det går att göra om till E.164 (src/core/phone.ts – samma som SMS
// och utringning), en e-postadress när den har formen något@något.tld (src/core/validation.ts – samma som formulären och servern).
import type { PreferredContact } from "@/data/schema";
import { hasPhone } from "./phone";
import { emailValid } from "./validation";

export { hasPhone };

/** Har deltagaren en e-postadress som går att skicka till? Samma kontroll som formulären och servern (högst 254 tecken). */
export const hasEmail = (email: string | null | undefined): boolean => {
  const s = String(email ?? "").trim();
  return s.length <= 254 && emailValid(s);
};

/**
 * Kontaktvägen när beställningen inte anger någon: SMS när ett telefonnummer finns, annars e-post när en e-postadress finns,
 * annars telefon (Miljonbemanning kontaktar deltagaren på annat sätt). Kolumnen persons.preferred_contact får inte vara tom.
 * Telefon som förval är inget val av deltagaren – vyerna visar då "Kontaktuppgift saknas" (hasContactDetails).
 */
export function defaultPreferredContact(p: { phone?: string | null; email?: string | null }): PreferredContact {
  if (hasPhone(p.phone)) return "sms";
  if (hasEmail(p.email)) return "email";
  return "phone";
}

/**
 * Går det att nå deltagaren? Ett telefonnummer som går att tolka, en giltig e-postadress eller – med brev – en adress. Annars
 * är kontaktvägen bara förvalet "telefon" och inget val.
 */
export function hasContactDetails(p: { preferredContact?: string | null; phone?: string | null; email?: string | null; address?: string | null }): boolean {
  if (hasPhone(p.phone) || hasEmail(p.email)) return true;
  return p.preferredContact === "letter" && !!(p.address ?? "").trim();
}

/** Fälten som kontaktuppgifterna kan ha fel i. */
export type ContactField = "phone" | "email" | "address";

/**
 * Deltagarens kontaktväg, telefonnummer och e-postadress – samma regler i Registrera beställning (inkorgen) och Ändra
 * kontaktväg på deltagarkortet (beslut 2026-10-09: kommunen anger inte längre kontaktvägen, Miljonbemanning frågar vid första
 * mötet). SMS och telefon kräver ett telefonnummer, och ett ifyllt nummer ska gå att skicka till (hasPhone – samma regel som
 * SMS:et och utringningen, src/core/phone.ts). E-post kräver en adress, en ifylld adress ska vara hel (hasEmail) och brev kräver
 * en postadress. Texterna visas vid fälten (klarspråk).
 */
export function contactErrors(p: { preferredContact: string; phone?: string | null; email?: string | null; address?: string | null }): Partial<Record<ContactField, string>> {
  const e: Partial<Record<ContactField, string>> = {};
  const phone = (p.phone ?? "").trim();
  const email = (p.email ?? "").trim();
  if ((p.preferredContact === "sms" || p.preferredContact === "phone") && !phone) e.phone = "Skriv deltagarens telefonnummer – det behövs för kallelsen.";
  else if (phone && !hasPhone(phone)) e.phone = "Skriv hela telefonnumret med riktnummer, till exempel 070-123 45 67.";
  if (email && !hasEmail(email)) e.email = "Skriv en hel e-postadress, eller lämna fältet tomt.";
  if (p.preferredContact === "email" && !email) e.email = "Skriv deltagarens e-postadress – e-post är vald som kontaktväg.";
  if (p.preferredContact === "letter" && (p.address ?? "").trim().length < 6) e.address = "Skriv hela adressen – kallelsen ska skickas med brev.";
  return e;
}
