// Resends REST-API (https://resend.com/docs/api-reference/emails/send-email) via fetch – inget SDK behövs.
//   POST https://api.resend.com/emails   Authorization: Bearer RESEND_API_KEY   Idempotency-Key: utskickets id
// Idempotency-Key gör att ett nytt försök med samma utskick inom 24 timmar inte skickar ett andra mejl.
// Felen innehåller bara HTTP-status och Resends felnamn (t.ex. validation_error) – aldrig Resends feltext, som kan
// innehålla mottagarens adress.
import { JobError } from "../jobs/errors";
import type { RenderedEmail } from "./render";

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** replyTo: svarsadress (MM_EMAIL_REPLY_TO), t.ex. avrop@miljonbemanning.se i produktion. */
export type ResendConfig = { apiKey: string; from: string; replyTo?: string | null };

/** Resends felnamn (t.ex. "validation_error") – bara bokstäver och understreck, annars "okänt". */
function errorName(body: unknown): string {
  const n = (body as { name?: unknown } | null)?.name;
  return typeof n === "string" && /^[a-z_]{1,60}$/.test(n) ? n : "okänt";
}

/** Taggar hos Resend: bara ASCII-bokstäver, siffror, understreck och bindestreck. */
const tagValue = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256) || "okand";

/** Skicka ett mejl. Returnerar Resends id. Kastar JobError (retryable = värt att försöka igen). */
export async function sendViaResend(
  fetchFn: FetchLike,
  cfg: ResendConfig,
  mail: RenderedEmail & { to: string; idempotencyKey: string; template: string },
  timeoutMs = 15_000,
): Promise<{ id: string }> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchFn(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": mail.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}),
        tags: [{ name: "template", value: tagValue(mail.template) }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new JobError("Resend kunde inte nås (nätverksfel eller tidsgräns)", { retryable: true });
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok) {
    const id = (body as { id?: unknown } | null)?.id;
    return { id: typeof id === "string" ? id : "" };
  }
  const name = errorName(body);
  // 429 (för många anrop eller kvoten slut), 409 när samma utskick skickas just nu och 5xx: försök igen senare.
  // 409 invalid_idempotent_request (nyckeln redan använd med annat innehåll) hjälper det inte att försöka igen.
  const retryable = res.status === 429 || res.status >= 500 || (res.status === 409 && name !== "invalid_idempotent_request");
  throw new JobError(`Resend svarade ${res.status} (${name})`, { retryable });
}
