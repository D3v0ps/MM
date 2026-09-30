// Serverns inställningar från miljövariabler. Inga hemligheter loggas. Listan över alla variabler finns i docs/DRIFT.md
// och .env.example. Filen importerar inte "server-only" så att proxy.ts och enhetstesterna kan använda den.

export type Backend = "memory" | "supabase";

/** Körläge: "memory" (prototypen, lokal utveckling, e2e) eller "supabase" (testmiljön och produktion). */
export const backend = (): Backend => (process.env.MM_BACKEND === "supabase" ? "supabase" : "memory");

const first = (...names: string[]): string | undefined => {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  return undefined;
};

/** Supabase-projektets adress och nycklar. Namnen från Vercels Supabase-integration fungerar också. */
export function supabaseEnv(): { url: string; anonKey: string; serviceKey: string | undefined } {
  const url = first("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = first("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceKey = first("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey) throw new Error("SUPABASE_URL och SUPABASE_PUBLISHABLE_KEY (eller SUPABASE_ANON_KEY) måste vara satta när MM_BACKEND=supabase");
  return { url, anonKey, serviceKey };
}

/** Klockan: "real" = riktig tid (produktion), "test" = testtid från app_settings, annars testtid om epokerna finns. */
export function clockMode(): "real" | "test" | "auto" {
  const v = process.env.MM_CLOCK?.trim().toLowerCase();
  return v === "real" ? "real" : v === "test" ? "test" : "auto";
}

/** Lista med kommatecken eller mellanslag -> gemena poster. */
export const parseList = (v: string | undefined): string[] =>
  (v ?? "")
    .split(/[\s,;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

/** Adresser (eller @domäner) som får mejl i testmiljön – även inloggningskoder. */
export const emailAllowlist = (): string[] => parseList(process.env.MM_EMAIL_ALLOWLIST);

/** Tillåtna e-postdomäner för Miljonbemannings personal när organisationen saknar egna domäner i databasen. */
export const staffEmailDomains = (): string[] => {
  const l = parseList(process.env.MM_STAFF_EMAIL_DOMAINS);
  return l.length ? l.map((d) => d.replace(/^@/, "")) : ["miljonbemanning.se"];
};

/**
 * Nyckel för att hasha e-postadresser och IP-adresser i login_attempts (HMAC-SHA256). Adressen sparas aldrig i klartext.
 * Utan egen nyckel används service role-nyckeln (finns alltid på servern i supabase-läget).
 */
export const loginHashSecret = (): string => first("MM_LOGIN_HASH_SECRET") ?? first("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY") ?? "mm-login";

/** Säkra kakor (bara https) utom vid lokal utveckling (webbläsarna godtar dem ändå på http://localhost). */
export const secureCookies = (): boolean => process.env.NODE_ENV === "production";
