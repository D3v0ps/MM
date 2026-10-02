// E-postadresser vid inloggning: normalisering, format, tillåtna domäner och testmiljöns spärrlista. Rena funktioner.

/** Gemener utan mellanslag runt om. */
export const normalizeEmail = (v: unknown): string => String(v ?? "").trim().toLowerCase();

/** Enkel formatkontroll (samma som prototypens MM.valid.email): något@något.tld utan mellanslag. */
export const isValidEmail = (v: string): boolean => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export const domainOf = (email: string): string => email.slice(email.lastIndexOf("@") + 1);

/**
 * Finns adressen i spärrlistan? Poster är hela adresser ("karim.khalil@miljonbemanning.se") eller domäner ("@miljonbemanning.se").
 * Tom lista = ingen får (används i testmiljön, där bara testarna ska få mejl).
 */
export function allowedByList(email: string, list: readonly string[]): boolean {
  const e = normalizeEmail(email);
  return list.some((x) => (x.startsWith("@") ? e.endsWith(x) : e === x));
}

/**
 * Är domänen tillåten för organisationen? Kundens domäner står i organizations.emailDomains (Botkyrka: botkyrka.se).
 * Leverantören (Miljonbemanning) har inga domäner i testdatat – då gäller MM_STAFF_EMAIL_DOMAINS (miljonbemanning.se).
 */
export function domainAllowed(email: string, org: { kind: string; emailDomains: readonly string[] } | null, staffDomains: readonly string[]): boolean {
  if (!org) return false;
  const allowed = (org.emailDomains.length ? org.emailDomains : org.kind === "supplier" ? staffDomains : []).map((d) => d.toLowerCase().replace(/^@/, ""));
  return allowed.includes(domainOf(normalizeEmail(email)));
}

/** Texter till användaren. Svaret på "skicka kod" är alltid detsamma, så att ingen kan pröva fram vilka adresser som finns. */
export const AUTH_TEXT = {
  codeSent: "Om adressen finns hos oss har vi skickat en kod. Den gäller i 10 minuter.",
  invalidEmail: "Skriv en giltig e-postadress, till exempel fornamn.efternamn@kommun.se.",
  invalidCode: "Koden har sex siffror.",
  wrongCode: "Koden stämmer inte eller har gått ut. Kontrollera koden eller begär en ny kod.",
  tooManyAttempts: "Du har skrivit fel kod för många gånger. Begär en ny kod.",
  rateLimited: "Du har försökt för många gånger. Vänta en stund och försök igen.",
  noAccess: "Adressen har inte tillgång till Miljonmatch. Kontakta den som bjöd in dig.",
  error: "Något gick fel. Försök igen om en stund.",
} as const;
