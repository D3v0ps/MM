// Skyddet för /api/jobs/run: huvudet "Authorization: Bearer <MM_JOBS_SECRET>". Jämförelsen tar lika lång tid oavsett
// hur mycket av nyckeln som stämmer (SHA-256 av båda + timingSafeEqual). Nyckeln loggas aldrig.
import { createHash, timingSafeEqual } from "node:crypto";

/** Minsta längd på nyckeln – en kort nyckel räknas som saknad. */
export const MIN_SECRET_LENGTH = 16;

export function jobsSecret(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.MM_JOBS_SECRET?.trim();
  return v && v.length >= MIN_SECRET_LENGTH ? v : null;
}

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Stämmer Authorization-huvudet med nyckeln? */
export function bearerMatches(header: string | null | undefined, secret: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec((header ?? "").trim());
  if (!m) return false;
  return timingSafeEqual(digest(m[1].trim()), digest(secret));
}
