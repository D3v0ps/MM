// Återhopp efter inloggning (?till= på inloggningssidan) – ren funktion utan beroenden. Används av klientroten i riktiga
// appen, av inloggningssidorna i prototypen och av src/server/session-policy.ts.

/** Bas som bara används för att tolka sökvägen – adressen lämnar aldrig funktionen. */
const BASE = "https://miljonmatch.invalid";

/**
 * Säker återhoppsadress: bara egna sökvägar, aldrig en annan domän. Webbläsarens URL-tolkning tar bort tabb, radbrytning
 * och vagnretur och läser bakstreck som snedstreck – "/\t/annan.example" och "/\\annan.example" blir då "//annan.example",
 * alltså en annan domän. Därför avvisas styrtecken och bakstreck, och sökvägen tolkas som webbläsaren gör och måste
 * stanna på samma ursprung. Inloggningssidorna och API:t är aldrig återhoppsadresser. Svaret är den tolkade sökvägen.
 */
export function safeReturnPath(v: string | null | undefined): string | null {
  if (!v || v.length > 2000 || !v.startsWith("/") || v.startsWith("//")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return null;
  let url: URL;
  try {
    url = new URL(v, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  const path = url.pathname;
  if (path === "/api" || path.startsWith("/api/") || path === "/logga-in" || path === "/portal/logga-in") return null;
  return path + url.search + url.hash;
}
