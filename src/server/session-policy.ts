// Sessionsregler (SPEC §4) och testarens rättigheter – rena funktioner utan I/O, används av proxy.ts och API-rutterna.
//   - utloggning efter 60 minuters inaktivitet och senast 12 timmar efter inloggningen
//   - testare får agera som testpersoner bara i testmiljön (app_settings.environment = 'staging')

export const SESSION_IDLE_MINUTES = 60;
export const SESSION_MAX_HOURS = 12;
const IDLE_MS = SESSION_IDLE_MINUTES * 60_000;
const MAX_MS = SESSION_MAX_HOURS * 3_600_000;

/** Kakor som proxy.ts läser och skriver (httpOnly). Värdet är millisekunder sedan 1970 (riktig tid, inte testtid). */
export const LAST_SEEN_COOKIE = "mm_last_seen";
export const LOGIN_AT_COOKIE = "mm_login_at";
export const MM_SESSION_COOKIES = [LAST_SEEN_COOKIE, LOGIN_AT_COOKIE] as const;

export type SessionVerdict = "ok" | "idle" | "max";

/**
 * Får sessionen fortsätta? `loginAt` = inloggningstiden (helst från tokenets amr, annars kakan), `lastSeen` = senaste anropet.
 * Saknas tiderna räknas sessionen som utgången – en ny inloggning sätter dem alltid.
 */
export function sessionVerdict(t: { now: number; loginAt: number | null; lastSeen: number | null }): SessionVerdict {
  if (t.loginAt == null || t.now - t.loginAt > MAX_MS) return "max";
  if (t.lastSeen == null || t.now - t.lastSeen > IDLE_MS) return "idle";
  return "ok";
}

/** Kakans värde -> millisekunder (null om det saknas eller är trasigt). */
export function parseMs(v: string | undefined | null): number | null {
  if (!v || !/^\d{10,16}$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Inloggningstiden ur Supabase-tokenets claims: amr = [{ method: "otp", timestamp: <sekunder> }].
 * Tidigaste tidpunkten används (den går inte att flytta fram genom att radera en kaka).
 */
export function loginTimeFromClaims(claims: unknown): number | null {
  const amr = (claims as { amr?: unknown } | null)?.amr;
  if (!Array.isArray(amr)) return null;
  const ts = amr.map((a) => Number((a as { timestamp?: unknown })?.timestamp)).filter((x) => Number.isFinite(x) && x > 0);
  return ts.length ? Math.min(...ts) * 1000 : null;
}

/** Inloggningstid att räkna med: tokenets amr, annars kakan. */
export const effectiveLoginAt = (claims: unknown, cookie: string | undefined | null): number | null => loginTimeFromClaims(claims) ?? parseMs(cookie);

// ---------------------------------------------------------------- Testare
export type Environment = "staging" | "production" | "memory";

/** Testmiljöns namn i app_settings. Allt annat (även en saknad rad) räknas som produktion. */
export const toEnvironment = (v: string | null | undefined): Exclude<Environment, "memory"> => (v === "staging" ? "staging" : "production");

/** Får den inloggade agera som testpersoner? Bara testare, och bara i testmiljön. */
export const canImpersonate = (environment: Environment, isTester: boolean): boolean => environment === "staging" && isTester === true;

// ---------------------------------------------------------------- Sökvägar
/** Sidor som nås utan inloggning (samma som de publika rutterna i rutt-tabellen). */
export function isPublicPagePath(path: string): boolean {
  return (
    path === "/logga-in" ||
    path === "/portal/logga-in" ||
    path === "/puls" ||
    path.startsWith("/puls/") ||
    path.startsWith("/p/")
  );
}

/** Inloggningssida för en sökväg (samma regel som loginPathFor i src/shell/routes.ts). */
export const loginPathFor = (path: string): string => (path.startsWith("/portal") ? "/portal/logga-in" : "/logga-in");

/** Säker återhoppsadress efter inloggning: bara egna sökvägar (inga andra domäner, inga "//"). */
export function safeReturnPath(v: string | null | undefined): string | null {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return null;
  if (v.startsWith("/api/") || v === "/logga-in" || v === "/portal/logga-in") return null;
  return v;
}
