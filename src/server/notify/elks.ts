// 46elks (svensk leverantör, data i EU) för SMS och utringning – REST-API via fetch, inget SDK (beslut 2026-10-09).
//   SMS:    POST https://api.46elks.com/a1/sms     form: from, to, message
//   Samtal: POST https://api.46elks.com/a1/calls   form: from (ett 46elks-nummer), to, voice_start = {"play": "<inspelningens adress>"}
// Basic auth med ELKS_API_USERNAME och ELKS_API_PASSWORD. Svaret har leverantörens id (sparas i outbound_messages.provider_message_id).
// Felen innehåller bara HTTP-status och en tvättad kort orsak – aldrig nummer, aldrig meddelandets text (46elks svar kan
// innehålla båda). 46elks har ingen idempotensnyckel: sender.ts markerar utskicket innan anropet, så att ett avbrutet försök
// aldrig skickas en gång till utan kontroll.
import { JobError } from "../jobs/errors";

export const ELKS_SMS_ENDPOINT = "https://api.46elks.com/a1/sms";
export const ELKS_CALLS_ENDPOINT = "https://api.46elks.com/a1/calls";

export type ElksAuth = { username: string; password: string };
/** from = avsändarnamnet (MM_SMS_FROM, standard "Miljonbem") eller ett nummer i E.164. */
export type ElksSmsConfig = ElksAuth & { from: string };
/** from = ett 46elks-nummer i E.164 (MM_CALL_FROM). audioUrl = inspelningen som spelas upp (MM_CALL_AUDIO_URL, https). */
export type ElksCallConfig = ElksAuth & { from: string; audioUrl: string };

export type ElksFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/**
 * Fel från 46elks. ambiguous = det går inte att veta om SMS:et eller samtalet gick iväg (tidsgränsen löpte ut efter att anropet
 * skickats) – då försöker utskicket inte igen (sender.ts), så att deltagaren aldrig får samma SMS två gånger.
 */
export class ElksError extends JobError {
  readonly ambiguous: boolean;
  constructor(message: string, opts: { retryable: boolean; ambiguous?: boolean }) {
    super(message, { retryable: opts.retryable });
    this.name = "ElksError";
    this.ambiguous = !!opts.ambiguous;
  }
}

const basic = (a: ElksAuth): string => `Basic ${Buffer.from(`${a.username}:${a.password}`, "utf8").toString("base64")}`;

/**
 * 46elks felorsak, tvättad: första raden, siffror (nummer) och adresser bort, bara bokstäver och enkla skiljetecken, högst 80
 * tecken. Innehåller den något av meddelandets text blir den "okänd orsak".
 */
export function scrubElksError(text: string, message = ""): string {
  const first = String(text ?? "").split(/\r?\n/)[0] ?? "";
  const cleaned = first
    .replace(/\S+@\S+/g, "[adress]")
    .replace(/\+?\d[\d\s\-()]*\d|\d/g, "[nummer]")
    .replace(/[^\p{L}\s.,:;'()[\]_-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  if (!cleaned) return "okänd orsak";
  const m = message.toLowerCase().replace(/\s+/g, " ");
  // Ett eko av meddelandet (minst tolv tecken i följd) får aldrig hamna i felorsaken.
  const c = cleaned.toLowerCase();
  for (let i = 0; i + 12 <= c.length; i++) if (m && m.includes(c.slice(i, i + 12))) return "okänd orsak";
  return cleaned;
}

/** Leverantörens id ur svaret ("s…" för SMS, "c…" för samtal). Bara bokstäver och siffror, annars tomt. */
function idOf(text: string): string {
  try {
    const id = (JSON.parse(text) as { id?: unknown } | null)?.id;
    return typeof id === "string" && /^[A-Za-z0-9]{1,64}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

async function post(fetchFn: ElksFetch, url: string, auth: ElksAuth, form: Record<string, string>, what: "SMS" | "Samtal", secret: string, timeoutMs: number): Promise<{ id: string }> {
  let res: Awaited<ReturnType<ElksFetch>>;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { Authorization: basic(auth), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      // Anropet kan ha kommit fram – försök inte igen (ingen idempotensnyckel hos 46elks).
      throw new ElksError(`46elks svarade inte i tid – kontrollera i 46elks om ${what === "SMS" ? "SMS:et" : "samtalet"} gick iväg`, { retryable: false, ambiguous: true });
    }
    throw new ElksError("46elks kunde inte nås (nätverksfel)", { retryable: true });
  }
  let body = "";
  try {
    body = await res.text();
  } catch {
    body = "";
  }
  if (res.ok) return { id: idOf(body) };
  const reason = scrubElksError(body, secret);
  if (res.status === 401 || res.status === 403) throw new ElksError(`46elks nekade inloggningen (${res.status}) – kontrollera ELKS_API_USERNAME och ELKS_API_PASSWORD`, { retryable: false });
  // 402 = slut på krediter (fylls på), 429 = för många anrop, 5xx = fel hos 46elks: försök igen senare.
  const retryable = res.status === 402 || res.status === 429 || res.status >= 500;
  throw new ElksError(`46elks svarade ${res.status} (${reason})`, { retryable });
}

/** Skicka ett SMS. Returnerar 46elks id. */
export function sendSmsVia46elks(fetchFn: ElksFetch, cfg: ElksSmsConfig, sms: { to: string; message: string }, timeoutMs = 15_000): Promise<{ id: string }> {
  return post(fetchFn, ELKS_SMS_ENDPOINT, cfg, { from: cfg.from, to: sms.to, message: sms.message }, "SMS", sms.message, timeoutMs);
}

/** Ring upp och spela inspelningen (voice_start). Returnerar 46elks id för samtalet. */
export function placeCallVia46elks(fetchFn: ElksFetch, cfg: ElksCallConfig, call: { to: string }, timeoutMs = 15_000): Promise<{ id: string }> {
  return post(fetchFn, ELKS_CALLS_ENDPOINT, cfg, { from: cfg.from, to: call.to, voice_start: JSON.stringify({ play: cfg.audioUrl }) }, "Samtal", "", timeoutMs);
}
