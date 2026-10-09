// Miljonbemannings personal: tillåtna e-postdomäner när en kollega läggs till (beslut 2026-10-08, "Lägg till kollega").
// Samma regel som inloggningen (src/server/auth/email.ts domainAllowed): leverantörsorganisationens egna domäner i databasen
// om de finns, annars de konfigurerade (MM_STAFF_EMAIL_DOMAINS på servern, standard miljonbemanning.se). Ren funktion –
// används av hanterarna i minnesläget, prototypen och på servern.

export const DEFAULT_STAFF_EMAIL_DOMAINS: readonly string[] = ["miljonbemanning.se"];

/** Domäner (gemener, utan @) som en kollega får ha sin adress på. */
export function staffEmailDomainsOf(org: { emailDomains: readonly string[] } | null | undefined, configured: readonly string[] | undefined): string[] {
  const own = (org?.emailDomains ?? []).map((d) => d.toLowerCase().replace(/^@/, "")).filter(Boolean);
  if (own.length) return own;
  const c = (configured ?? DEFAULT_STAFF_EMAIL_DOMAINS).map((d) => d.toLowerCase().replace(/^@/, "")).filter(Boolean);
  return c.length ? c : [...DEFAULT_STAFF_EMAIL_DOMAINS];
}

/** Domänen i en adress (gemener), eller "" om adressen saknar @. */
export const emailDomain = (email: string): string => {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase();
};
