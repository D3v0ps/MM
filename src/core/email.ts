// E-postadressens form (något@något.tld) – samma regel i formulären, servern och avtalskonfigurationen. Ren funktion utan
// beroenden, så att src/core/config.ts kan använda den (src/core/validation.ts importerar config.ts och återexporterar den här).

/** Har texten formen något@något.tld (utan mellanslag)? Mellanslag först och sist räknas inte. */
export const emailValid = (s: string | null | undefined): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s ?? "").trim());
