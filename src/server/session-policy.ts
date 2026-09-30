// Sessionsregler (SPEC §4) och testarens rättigheter – rena funktioner utan I/O, används av proxy.ts och API-rutterna.
//   - utloggning efter 60 minuters inaktivitet och senast 12 timmar efter inloggningen
//   - testare får agera som testpersoner bara i testmiljön (app_settings.environment = 'staging')

export const SESSION_IDLE_MINUTES = 60;
export const SESSION_MAX_HOURS = 12;
const IDLE_MS = SESSION_IDLE_MINUTES * 60_000;
const MAX_MS = SESSION_MAX_HOURS * 3_600_000;

/**
 * Kakor som proxy.ts läser och skriver (httpOnly). Värdet är millisekunder sedan 1970 (riktig tid, inte testtid);
 * mm_last_seen är dessutom signerad (signLastSeen nedan).
 */
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

// ---------------------------------------------------------------- Senaste aktivitet (signerad kaka)
// mm_last_seen är signerad: "<ms>.<hmac>", där hmac = HMAC-SHA256(serverns nyckel, "mm_last_seen:<session_id>:<ms>").
// Utan signatur kunde den som kommer åt webbläsarens kakor sätta tiden själv och hålla en övergiven session vid liv efter
// 60 minuter. Signaturen är knuten till Supabase-sessionen (session_id i tokenet), så värdet går inte heller att flytta
// till en annan session. Ett osignerat eller ändrat värde räknas som saknat (= inaktiv). Web Crypto: fungerar både i
// proxyn och i API-rutterna.

/** Supabase-sessionens id ur tokenets claims (session_id), annars användarens id. */
export function sessionIdFromClaims(claims: unknown): string {
  const c = claims as { session_id?: unknown; sub?: unknown } | null;
  return typeof c?.session_id === "string" ? c.session_id : typeof c?.sub === "string" ? c.sub : "";
}

async function lastSeenMac(secret: string, sessionId: string, ms: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`mm_last_seen:${sessionId}:${ms}`)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Kakans värde för tidpunkten ms i sessionen. */
export async function signLastSeen(secret: string, sessionId: string, ms: number): Promise<string> {
  const v = String(Math.trunc(ms));
  return `${v}.${await lastSeenMac(secret, sessionId, v)}`;
}

/** Tidpunkten ur en signerad kaka (millisekunder), eller null om den saknas, är trasig eller inte signerad för sessionen. */
export async function lastSeenFromCookie(secret: string, sessionId: string, value: string | undefined | null): Promise<number | null> {
  const m = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(value ?? "");
  if (!m) return null;
  const expected = await lastSeenMac(secret, sessionId, m[1]);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0 ? parseMs(m[1]) : null;
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

/** Säker återhoppsadress efter inloggning: bara egna sökvägar (samma funktion som klienten använder). */
export { safeReturnPath } from "@/core/return-path";
