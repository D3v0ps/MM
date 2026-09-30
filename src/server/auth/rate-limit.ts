// Hastighetsbegränsning för inloggningen (SPEC §4): per adress och per IP, med hashade värden i login_attempts
// (email_hash, ip_hash, attempted_at, kind). Adressen och IP-adressen sparas eller loggas aldrig i klartext.
import { createHmac } from "node:crypto";

export type AttemptKind = "code" | "verify_failed" | "verify_ok";
export type Hashes = { emailHash: string; ipHash: string };

export type AttemptStore = {
  /** Antal försök av ett slag sedan en tidpunkt (ISO), för en adress eller en IP. */
  count(q: { kind: AttemptKind; since: string; emailHash?: string; ipHash?: string }): Promise<number>;
  /** Senaste försöket av ett slag för adressen (millisekunder) eller null. */
  lastAt(q: { kind: AttemptKind; emailHash: string }): Promise<number | null>;
  record(a: { kind: AttemptKind; at: string } & Hashes): Promise<void>;
};

/** Gränserna. Koden gäller 10 minuter och får prövas högst 5 gånger (Supabase Auth begränsar dessutom själv). */
export const LIMITS = {
  windowMinutes: 15,
  codesPerEmail: 5,
  codesPerIp: 20,
  attemptsPerCode: 5,
  failedPerIp: 30,
} as const;

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
  // Försöken räknas sedan den senaste koden skickades – högst 10 minuter bakåt (äldre koder har gått ut).
  const codeSince = iso(Math.max(lastCode ?? 0, nowMs - 10 * 60_000));
  const [failedForCode, failedByIp] = await Promise.all([
    store.count({ kind: "verify_failed", since: codeSince, emailHash: h.emailHash }),
    store.count({ kind: "verify_failed", since: window, ipHash: h.ipHash }),
  ]);
  if (failedByIp >= LIMITS.failedPerIp) return "rate_limited";
  if (failedForCode >= LIMITS.attemptsPerCode) return "too_many_attempts";
  return "ok";
}
