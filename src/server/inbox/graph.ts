// Microsoft Graph mot brevlådan avrop@ (beslut 4c, 2026-10-08, SPEC §7.1): bara fetch – inget SDK.
//   Inloggning   client credentials mot login.microsoftonline.com/<tenant>/oauth2/v2.0/token (scope .default) –
//                applikationsbehörigheten Mail.ReadWrite, begränsad till brevlådan med en ApplicationAccessPolicy
//                (docs/DRIFT.md avsnitt 12). Hemligheten finns bara i Vercel och loggas aldrig.
//   Läsning      olästa mejl i Inkorgen (text, inte HTML: Prefer outlook.body-content-type="text"), äldst först
//   Bilagor      bara filbilagor (inte inbäddade bilder eller bifogade mejl), högst 10 MB
//   Inläst       mappen hittas eller skapas; mejlet flyttas dit när det är inläst (ligger kvar som reserv)
// Fel blir JobError med bara steget och HTTP-statusen – aldrig adresser, ämnesrader eller innehåll (de sparas i
// jobs.last_error). 429 och 5xx (och nätverksfel) är värda ett nytt försök; 401/403 pekar på appregistreringen.
import { JobError } from "../jobs/errors";

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
export const LOGIN_BASE = "https://login.microsoftonline.com";
/** Standardnamnet på mappen dit inlästa mejl flyttas (MM_INBOX_DONE_FOLDER). */
export const DEFAULT_DONE_FOLDER = "Inläst";
/** Så många mejl per körning (resten tas nästa gång – jobbet körs varannan minut). */
export const PAGE_SIZE = 20;
/** Största bilaga som hämtas (samma gräns som bilagorna i beställningen). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type GraphEnv = { tenantId: string; clientId: string; clientSecret: string; mailbox: string; doneFolder: string };

/** Inställningarna ur miljön, eller null när någon av dem saknas (jobbet gör då ingenting). Inget loggas. */
export function graphEnv(env: Record<string, string | undefined> = process.env): GraphEnv | null {
  const v = (k: string) => env[k]?.trim() || "";
  const tenantId = v("MS_GRAPH_TENANT_ID");
  const clientId = v("MS_GRAPH_CLIENT_ID");
  const clientSecret = v("MS_GRAPH_CLIENT_SECRET");
  const mailbox = v("MM_INBOX_MAILBOX").toLowerCase();
  if (!tenantId || !clientId || !clientSecret || !mailbox || !mailbox.includes("@")) return null;
  return { tenantId, clientId, clientSecret, mailbox, doneFolder: v("MM_INBOX_DONE_FOLDER") || DEFAULT_DONE_FOLDER };
}

/** Den del av fetch som används (fejkas i testerna). */
export type GraphFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type GraphMessage = {
  id: string;
  /** RFC 5322 Message-ID – stabilt också när mejlet flyttas; används som graph_message_id. */
  internetMessageId: string | null;
  subject: string;
  /** ISO 8601 i UTC ("2027-02-01T07:41:12Z"). */
  receivedDateTime: string;
  fromAddress: string;
  fromName: string;
  bodyText: string;
  hasAttachments: boolean;
};
export type GraphAttachment = { id: string; name: string; contentType: string; size: number };

export interface GraphMail {
  /** Olästa mejl i Inkorgen, äldst först, högst PAGE_SIZE. */
  listUnread(): Promise<GraphMessage[]>;
  /** Filbilagorna (utan innehåll). */
  listAttachments(messageId: string): Promise<GraphAttachment[]>;
  /** Innehållet i en filbilaga. */
  attachmentBytes(messageId: string, attachmentId: string): Promise<Uint8Array>;
  /** Flytta mejlet till mappen Inläst (skapas om den saknas). */
  moveToDone(messageId: string): Promise<void>;
}

const err = (step: string, status: number): JobError => {
  const retry = status === 429 || status >= 500 || status === 408;
  const hint = status === 401 || status === 403 ? " – kontrollera appregistreringen och behörigheten till brevlådan" : status === 404 ? " – kontrollera brevlådans adress" : "";
  return new JobError(`Microsoft Graph: ${step} svarade ${status}${hint}`, { retryable: retry });
};
const netErr = (step: string): JobError => new JobError(`Microsoft Graph: ${step} kunde inte nås (nätverksfel eller tidsgräns)`, { retryable: true });

/** Bara ASCII-bokstäver, siffror och vanliga tecken i det som läggs i en adress. */
const safeSegment = (s: string): string => encodeURIComponent(s);
/** Text ur ett HTML-innehåll när Graph ändå svarade med HTML (taggar bort, radbrytningar kvar). */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/tr|\/li|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<\s*\/t[dh]\s*>/gi, "\t")
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Base64 → byte (Node och webbläsare). */
export function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Graph-klienten för en körning. Tokenet hämtas en gång per körning (gäller en timme). timeoutMs per anrop.
 */
export function graphMail(cfg: GraphEnv, fetchFn: GraphFetch, opts: { timeoutMs?: number } = {}): GraphMail {
  const timeout = opts.timeoutMs ?? 15_000;
  const user = `${GRAPH_BASE}/users/${safeSegment(cfg.mailbox)}`;
  let token: string | null = null;
  let doneFolderId: string | null = null;

  async function call<T>(step: string, url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    const bearer = await getToken();
    let res: Awaited<ReturnType<GraphFetch>>;
    try {
      res = await fetchFn(url, {
        method: init.method ?? "GET",
        headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw netErr(step);
    }
    if (!res.ok) throw err(step, res.status);
    if (res.status === 204) return undefined as T;
    try {
      return (await res.json()) as T;
    } catch {
      throw new JobError(`Microsoft Graph: ${step} gav ett oväntat svar`, { retryable: true });
    }
  }

  async function getToken(): Promise<string> {
    if (token) return token;
    const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }).toString();
    let res: Awaited<ReturnType<GraphFetch>>;
    try {
      res = await fetchFn(`${LOGIN_BASE}/${safeSegment(cfg.tenantId)}/oauth2/v2.0/token`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body, signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw netErr("inloggningen");
    }
    if (!res.ok) throw new JobError(`Microsoft Graph: inloggningen svarade ${res.status} – kontrollera klient-id, hemligheten och katalog-id`, { retryable: res.status === 429 || res.status >= 500 });
    const data = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
    if (!data || typeof data.access_token !== "string" || !data.access_token) throw new JobError("Microsoft Graph: inloggningen gav inget token", { retryable: false });
    token = data.access_token;
    return token;
  }

  return {
    async listUnread() {
      const url = `${user}/mailFolders/inbox/messages?$filter=isRead%20eq%20false&$orderby=receivedDateTime%20asc&$top=${PAGE_SIZE}&$select=id,internetMessageId,subject,receivedDateTime,from,hasAttachments,body`;
      const data = await call<{ value?: unknown[] }>("listningen", url, { headers: { Prefer: 'outlook.body-content-type="text"' } });
      return (data.value ?? []).map((raw): GraphMessage => {
        const m = (raw ?? {}) as Record<string, unknown>;
        const from = ((m.from as { emailAddress?: { address?: unknown; name?: unknown } } | undefined)?.emailAddress ?? {}) as { address?: unknown; name?: unknown };
        const body = (m.body ?? {}) as { contentType?: unknown; content?: unknown };
        const content = typeof body.content === "string" ? body.content : "";
        const text = String(body.contentType ?? "").toLowerCase() === "html" ? htmlToText(content) : content.replace(/\r\n?/g, "\n");
        return {
          id: String(m.id ?? ""), internetMessageId: typeof m.internetMessageId === "string" && m.internetMessageId ? m.internetMessageId : null,
          subject: typeof m.subject === "string" ? m.subject : "", receivedDateTime: String(m.receivedDateTime ?? ""),
          fromAddress: typeof from.address === "string" ? from.address.toLowerCase() : "", fromName: typeof from.name === "string" ? from.name : "",
          bodyText: text, hasAttachments: m.hasAttachments === true,
        };
      }).filter((m) => m.id);
    },
    async listAttachments(messageId) {
      const data = await call<{ value?: unknown[] }>("bilagorna", `${user}/messages/${safeSegment(messageId)}/attachments?$select=id,name,contentType,size,isInline`);
      return (data.value ?? [])
        .map((raw) => (raw ?? {}) as Record<string, unknown>)
        .filter((a) => a["@odata.type"] === "#microsoft.graph.fileAttachment" && a.isInline !== true)
        .map((a): GraphAttachment => ({ id: String(a.id ?? ""), name: typeof a.name === "string" ? a.name : "", contentType: typeof a.contentType === "string" ? a.contentType : "", size: typeof a.size === "number" ? a.size : 0 }))
        .filter((a) => a.id);
    },
    async attachmentBytes(messageId, attachmentId) {
      const data = await call<{ contentBytes?: unknown }>("bilagan", `${user}/messages/${safeSegment(messageId)}/attachments/${safeSegment(attachmentId)}`);
      if (typeof data.contentBytes !== "string") throw new JobError("Microsoft Graph: bilagan saknade innehåll", { retryable: false });
      return base64Bytes(data.contentBytes);
    },
    async moveToDone(messageId) {
      if (!doneFolderId) {
        const name = cfg.doneFolder.replace(/'/g, "''");
        const found = await call<{ value?: { id?: unknown }[] }>("mappen", `${user}/mailFolders?$filter=displayName%20eq%20'${encodeURIComponent(name)}'&$select=id`);
        const id = found.value?.[0]?.id;
        if (typeof id === "string" && id) doneFolderId = id;
        else {
          const created = await call<{ id?: unknown }>("mappen", `${user}/mailFolders`, { method: "POST", body: { displayName: cfg.doneFolder } });
          if (typeof created.id !== "string" || !created.id) throw new JobError("Microsoft Graph: mappen Inläst kunde inte skapas", { retryable: true });
          doneFolderId = created.id;
        }
      }
      await call<unknown>("flytten", `${user}/messages/${safeSegment(messageId)}/move`, { method: "POST", body: { destinationId: doneFolderId } });
    },
  };
}
