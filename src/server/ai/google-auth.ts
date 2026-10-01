// Inloggning mot Google Cloud med tjänstekontots JSON-nyckel (GOOGLE_SERVICE_ACCOUNT_KEY, base64) – OAuth 2.0 JWT-bearer:
//   1. ett JWT signeras med tjänstekontots privata nyckel (RS256, node:crypto)
//   2. JWT:t byts mot en åtkomsttoken hos https://oauth2.googleapis.com/token (scope cloud-platform)
//   3. token cachas tills fem minuter före utgången och delas av alla anrop i serverinstansen
// Nyckeln och token loggas aldrig och står aldrig i felmeddelanden. Tokenadressen är fast – den tas inte ur nyckelfilen,
// så att en ändrad nyckelfil inte kan skicka inloggningen någon annanstans. Bara på servern.
import { createSign } from "node:crypto";
import { z } from "zod";
import { AiProviderError } from "./errors";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
/** Så länge JWT:t gäller (Googles högsta tillåtna). */
const JWT_LIFETIME_SEC = 3600;
/** Token förnyas så här många sekunder före utgången. */
const REFRESH_MARGIN_SEC = 300;

export type ServiceAccountKey = {
  clientEmail: string;
  privateKey: string;
  privateKeyId: string | null;
  projectId: string | null;
};

const KeySchema = z.object({
  type: z.literal("service_account"),
  client_email: z.string().regex(/^[^@\s]+@[^@\s]+$/),
  private_key: z.string().includes("PRIVATE KEY"),
  private_key_id: z.string().optional(),
  project_id: z.string().optional(),
});

/**
 * Nyckeln ur miljövariabeln: base64 av JSON-filen (rekommenderat i Vercel) eller JSON-texten direkt.
 * Kastar AiProviderError("config") utan att visa något av innehållet.
 */
export function parseServiceAccountKey(raw: string | undefined | null): ServiceAccountKey {
  const v = String(raw ?? "").trim();
  if (!v) throw new AiProviderError("config", { detail: "GOOGLE_SERVICE_ACCOUNT_KEY saknas" });
  let json: unknown;
  try {
    const text = v.startsWith("{") ? v : Buffer.from(v, "base64").toString("utf8");
    json = JSON.parse(text);
  } catch {
    throw new AiProviderError("config", { detail: "GOOGLE_SERVICE_ACCOUNT_KEY är inte giltig JSON eller base64" });
  }
  const k = KeySchema.safeParse(json);
  if (!k.success) throw new AiProviderError("config", { detail: "GOOGLE_SERVICE_ACCOUNT_KEY är inte en nyckel för ett tjänstekonto" });
  return { clientEmail: k.data.client_email, privateKey: k.data.private_key, privateKeyId: k.data.private_key_id ?? null, projectId: k.data.project_id ?? null };
}

const b64url = (b: Buffer | string): string => Buffer.from(b).toString("base64url");

/** JWT för tokenutbytet, signerat med RS256. nowSec = sekunder sedan 1970. */
export function signServiceAccountJwt(key: ServiceAccountKey, nowSec: number): string {
  const header = { alg: "RS256", typ: "JWT", ...(key.privateKeyId ? { kid: key.privateKeyId } : {}) };
  const claims = { iss: key.clientEmail, sub: key.clientEmail, aud: GOOGLE_TOKEN_URL, scope: GOOGLE_SCOPE, iat: nowSec, exp: nowSec + JWT_LIFETIME_SEC };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  let sig: Buffer;
  try {
    sig = createSign("RSA-SHA256").update(input).sign(key.privateKey);
  } catch {
    throw new AiProviderError("config", { detail: "Tjänstekontots privata nyckel går inte att använda" });
  }
  return `${input}.${b64url(sig)}`;
}

/** Den del av fetch som används (lätt att fejka i tester). */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface TokenSource {
  /** Giltig åtkomsttoken (från cachen om den räcker minst fem minuter till). */
  token(): Promise<string>;
  /** Glöm token (t.ex. efter 401 från Vertex AI). */
  invalidate(): void;
}

const TokenResponseSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive().optional() });

export function createTokenSource(o: { key: ServiceAccountKey; fetch: FetchLike; nowMs?: () => number; timeoutMs?: number }): TokenSource {
  const nowMs = o.nowMs ?? (() => Date.now());
  let cached: { token: string; expiresAtMs: number } | null = null;
  let pending: Promise<string> | null = null;

  async function fetchToken(): Promise<string> {
    const nowSec = Math.floor(nowMs() / 1000);
    const assertion = signServiceAccountJwt(o.key, nowSec);
    const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString();
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await o.fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
      });
    } catch {
      throw new AiProviderError("unavailable", { detail: "Inloggningen hos Google svarade inte" });
    }
    if (!res.ok) {
      // 400/401/403: fel nyckel, borttaget tjänstekonto eller fel klocka – inte värt att försöka igen.
      const retry = res.status === 429 || res.status >= 500;
      throw new AiProviderError(retry ? "unavailable" : "config", { detail: `Inloggningen hos Google gav HTTP ${res.status}` });
    }
    const parsed = TokenResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new AiProviderError("unavailable", { detail: "Oväntat svar från inloggningen hos Google" });
    const lifetime = parsed.data.expires_in ?? JWT_LIFETIME_SEC;
    cached = { token: parsed.data.access_token, expiresAtMs: nowMs() + lifetime * 1000 };
    return parsed.data.access_token;
  }

  return {
    async token() {
      if (cached && cached.expiresAtMs - nowMs() > REFRESH_MARGIN_SEC * 1000) return cached.token;
      // Samtidiga anrop delar på samma utbyte.
      pending ??= fetchToken().finally(() => {
        pending = null;
      });
      return pending;
    },
    invalidate() {
      cached = null;
    },
  };
}
