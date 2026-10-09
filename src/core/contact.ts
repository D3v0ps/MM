// Deltagarens kontaktväg (beslut 2026-10-09: beställningen frågar inte längre efter kontaktväg). Rena funktioner – används av
// servern (createOrder), skärmarna (Registrera beställning, kommunens formulär) och vyerna (deltagarkortet, avropsinkorgen).
import type { PreferredContact } from "@/data/schema";

/** Minsta antal siffror i deltagarens telefonnummer (portalens kontroll och förvalet SMS). */
export const PHONE_MIN_DIGITS = 8;

const hasPhone = (phone: string | null | undefined): boolean => (phone ?? "").replace(/\D/g, "").length >= PHONE_MIN_DIGITS;
const hasEmail = (email: string | null | undefined): boolean => (email ?? "").includes("@");

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
 * Går det att nå deltagaren? Ett telefonnummer (minst 8 siffror), en e-postadress eller – med brev – en adress. Annars är
 * kontaktvägen bara förvalet "telefon" och inget val.
 */
export function hasContactDetails(p: { preferredContact?: string | null; phone?: string | null; email?: string | null; address?: string | null }): boolean {
  if (hasPhone(p.phone) || hasEmail(p.email)) return true;
  return p.preferredContact === "letter" && !!(p.address ?? "").trim();
}
