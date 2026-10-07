// Hastighetsbegränsning för inloggningen (SPEC §4): per adress och per IP, med hashade värden i login_attempts
// (email_hash, ip_hash, attempted_at, kind). Adressen och IP-adressen sparas eller loggas aldrig i klartext.
import { createHmac } from "node:crypto";
import { CODE_VALID_MINUTES } from "./email";

export type AttemptKind = "code" | "verify_failed" | "verify_ok";
export type Hashes = { emailHash: string; ipHash: string };
export type GateVerdict = "ok" | "rate_limited" | "too_many_attempts";

/**
 * Spärren som servern använder (supabase/migrations/0012, mm.login_attempt_gate): kontrollen och registreringen görs i
 * samma transaktion, med lås per adress och per IP. Ett kodförsök registreras som verify_failed innan koden prövas hos
 * Supabase Auth och ändras till verify_ok när den stämde. Samtidiga anrop kan därför aldrig passera fler gånger än
 * gränserna tillåter (förut räknades försöken först efter svaret, och anrop i klump slapp igenom).
 */
export type LoginGate = {
  /** kind "code": en ny kod; "verify": ett försök att logga in med koden. id = det registrerade försöket (vid "ok"). */
  gate(a: { kind: "code" | "verify"; at: string } & Hashes): Promise<{ verdict: GateVerdict; id: number | null }>;
  /** Koden stämde: försöket räknas inte längre som misslyckat. */
  markVerified(id: number): Promise<void>;
};

/**
 * Referensreglerna i TypeScript (samma som mm.login_attempt_gate i databasen – testet i login-gate.test.ts jämför dem).
 * Räknar försöken i login_attempts; registreringen görs av anroparen.
 */
export type AttemptStore = {
  /** Antal försök av ett slag sedan en tidpunkt (ISO), för en adress eller en IP. */
  count(q: { kind: AttemptKind; since: string; emailHash?: string; ipHash?: string }): Promise<number>;
  /** Senaste försöket av ett slag för adressen (millisekunder) eller null. */
  lastAt(q: { kind: AttemptKind; emailHash: string }): Promise<number | null>;
  record(a: { kind: AttemptKind; at: string } & Hashes): Promise<void>;
};

/**
 * Gränserna per adress och IP (mm.login_attempt_gate får dem som p_limits). Koden gäller 10 minuter och får prövas högst
 * 5 gånger. Supabase Auth begränsar själv bara prövningen av koden (/verify) – inte utskicken: appen tar fram koden med
 * auth.admin.generateLink, som saknar egen spärr, och Supabase skickar inget mejl (så dess gräns för e-post gäller inte).
 * Spärrarna här och taket för hela appen (CODE_MAILS_PER_HOUR) är därför de enda för kodmejlen.
 */
export const LIMITS = {
  windowMinutes: 15,
  codesPerEmail: 5,
  codesPerIp: 20,
  attemptsPerCode: 5,
  failedPerIp: 30,
} as const;

/**
 * Taket för hela appen: högst så här många kodmejl per timme, oavsett adress och IP (src/server/auth/code-mail.ts räknar
 * utskicksloggens rader). Samma som Supabase Auths gräns för e-post (30 per timme) när Supabase skickade koden. Över taket
 * blir svaret detsamma, men ingen kod tas fram och inget mejl skickas – så att ingen kan tömma Resend-kontots kvot (som
 * notiserna delar) eller hålla många giltiga koder i omlopp samtidigt.
 */
export const CODE_MAILS_PER_HOUR = 30;

export const hmac = (secret: string, kind: "email" | "ip", value: string): string => createHmac("sha256", secret).update(`${kind}:${value}`).digest("hex");

export const hashesFor = (secret: string, email: string, ip: string): Hashes => ({ emailHash: hmac(secret, "email", email), ipHash: hmac(secret, "ip", ip || "okänd") });

/** Klientens IP-adress bakom Vercel (x-forwarded-for: första adressen). */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() ?? "";
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Får en ny kod skickas? */
export async function checkCodeRequest(store: AttemptStore, h: Hashes, nowMs: number): Promise<"ok" | "rate_limited"> {
  const since = iso(nowMs - LIMITS.windowMinutes * 60_000);
  const [byEmail, byIp] = await Promise.all([
    store.count({ kind: "code", since, emailHash: h.emailHash }),
    store.count({ kind: "code", since, ipHash: h.ipHash }),
  ]);
  return byEmail >= LIMITS.codesPerEmail || byIp >= LIMITS.codesPerIp ? "rate_limited" : "ok";
}

/** Får koden prövas? Högst 5 felaktiga försök sedan den senaste koden skickades, och en gräns per IP. */
export async function checkVerify(store: AttemptStore, h: Hashes, nowMs: number): Promise<"ok" | "too_many_attempts" | "rate_limited"> {
  const window = iso(nowMs - LIMITS.windowMinutes * 60_000);
  const lastCode = await store.lastAt({ kind: "code", emailHash: h.emailHash });
  // Försöken räknas sedan den senaste koden skickades – högst kodens giltighetstid (10 minuter) bakåt (äldre koder har gått ut).
  const codeSince = iso(Math.max(lastCode ?? 0, nowMs - CODE_VALID_MINUTES * 60_000));
  const [failedForCode, failedByIp] = await Promise.all([
    store.count({ kind: "verify_failed", since: codeSince, emailHash: h.emailHash }),
    store.count({ kind: "verify_failed", since: window, ipHash: h.ipHash }),
  ]);
  if (failedByIp >= LIMITS.failedPerIp) return "rate_limited";
  if (failedForCode >= LIMITS.attemptsPerCode) return "too_many_attempts";
  return "ok";
}

// ---------------------------------------------------------------- Självregistrering (beslut 2026-10-07)
/**
 * Tak för nya konton (självregistrering) – plattformsregler, inte avtalsvärden. Räknas på påbörjade självregistreringar i
 * login_attempts (kind "self_registration", bara hashade värden) och på unika adresser, inte på begäranden:
 *   * perApp: högst så här många olika nya adresser per timme i hela appen (skyddar kodmejlens kvot och Auth),
 *   * perIp:  högst så här många olika nya adresser per timme från samma IP – så att en enda avsändare med påhittade adresser
 *             inte kan förbruka hela appens tak och stänga självregistreringen för riktiga handläggare (granskningen 2026-10-07).
 * En ny kod till en adress som redan påbörjat en självregistrering inom fönstret räknas inte igen.
 */
export const SELF_REGISTRATION_LIMITS = { windowMinutes: 60, perApp: 20, perIp: 3 } as const;

/** login_attempts för självregistreringen (service role i drift, en fejk i testerna). */
export type SelfRegistrationStore = {
  /** Påbörjade självregistreringar sedan en tidpunkt (ISO). */
  recent(since: string): Promise<Hashes[]>;
  record(a: { at: string } & Hashes): Promise<void>;
};

/** "ok" = ny adress, registreras; "repeat" = adressen har redan påbörjat inom fönstret (räknas inte igen); annars taket. */
export type SelfRegistrationVerdict = "ok" | "repeat" | "app_limit" | "ip_limit";

/** Får en ny adress påbörja en självregistrering (kod och Auth-konto)? Registrerar försöket när svaret är "ok". */
export async function checkSelfRegistration(store: SelfRegistrationStore, h: Hashes, nowMs: number): Promise<SelfRegistrationVerdict> {
  const rows = await store.recent(iso(nowMs - SELF_REGISTRATION_LIMITS.windowMinutes * 60_000));
  if (rows.some((r) => r.emailHash === h.emailHash)) return "repeat";
  if (new Set(rows.map((r) => r.emailHash)).size >= SELF_REGISTRATION_LIMITS.perApp) return "app_limit";
  if (new Set(rows.filter((r) => r.ipHash === h.ipHash).map((r) => r.emailHash)).size >= SELF_REGISTRATION_LIMITS.perIp) return "ip_limit";
  await store.record({ at: iso(nowMs), ...h });
  return "ok";
}
