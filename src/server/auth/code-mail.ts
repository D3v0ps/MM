// Inloggningskoden: servern tar fram koden och skickar mejlet själv (beslut 2026-10-02).
//   1. Supabase Auth skapar koden: auth.admin.generateLink({ type: "magiclink", email }) med service role. Supabase skickar då
//      INGET mejl. Svaret har den sexsiffriga koden i properties.email_otp (GenerateLinkProperties i @supabase/auth-js).
//      Koden verifieras som tidigare med verifyOtp({ email, token, type: "email" }) (service.ts, verifyCode).
//      Länken i svaret (action_link, hashed_token) används aldrig och skickas aldrig – Safe Links förbrukar länkar.
//   2. Mejlet skickas direkt med Resend (samma nyckel och avsändare som notiserna, ingen svarsadress) – inte via kön
//      outbound_messages/jobs, eftersom koden aldrig får sparas i klartext någonstans.
//   3. En rad i outbound_messages för spårbarhet: mallen inloggningskod, mottagaren, ämnet, status sent/failed och en text
//      UTAN koden. Koden finns aldrig i databasen, i loggar, i felmeddelanden eller i revisionsloggen.
//   4. Taket för hela appen (CODE_MAILS_PER_HOUR i rate-limit.ts): raden skrivs först (queued) och sedan räknas raderna den
//      senaste timmen. Över taket blir raden suppressed – ingen kod tas fram och inget mejl skickas. Supabase Auth har ingen
//      spärr på generateLink och skickar inget mejl, så dess gräns för e-post gäller inte längre.
// Spärrarna (aktiv profil, roll, domän, MM_EMAIL_ALLOWLIST) prövas före anropet (eligibleForCode i service.ts). Ingen
// omdirigering (MM_EMAIL_REDIRECT_TO) – koden går alltid till den som loggar in.
import { addMinutes, type LocalDateTime } from "@/core/time";
import type { Repo } from "@/data/repo";
import type { OutboundMessage, OutboundStatus } from "@/data/schema";
import { JobError } from "../jobs/errors";
import { renderLoginCodeEmail } from "../notify/render";
import { sendViaResend, type FetchLike, type ResendConfig } from "../notify/resend";
import { LOGIN_CODE_TEMPLATE, TEMPLATES } from "../notify/templates";
import { CODE_MAILS_PER_HOUR } from "./rate-limit";

/** Det som står i stället för koden i utskicksloggen. */
export const CODE_MASK = "••••••";

/** Utskicksloggens text – aldrig koden. */
export const LOGGED_BODY = {
  queued: `Inloggningskod skickas (${CODE_MASK}). Koden sparas aldrig.`,
  sent: `Inloggningskod skickad (${CODE_MASK}). Koden sparas aldrig.`,
  failed: `Inloggningskoden kunde inte skickas (${CODE_MASK}). Koden sparas aldrig.`,
  suppressed: "Ingen inloggningskod skickades – taket för hela appen är nått.",
} as const;

export const CODE_REASON = {
  notConfigured: "E-post är inte konfigurerad (RESEND_API_KEY eller MM_EMAIL_FROM saknas)",
  noCode: (code: string) => `Supabase Auth gav ingen kod (${code})`,
  badFormat: "Supabase Auth gav en kod med fel format (Email OTP Length ska vara 6)",
  unknown: "Okänt fel när koden skickades",
  overLimit: `Taket är nått: högst ${CODE_MAILS_PER_HOUR} inloggningskoder per timme för hela appen`,
} as const;

/** Raderna som räknas mot taket – alla utom de som taket själv stoppade. */
const COUNTED: readonly OutboundStatus[] = ["queued", "sent", "failed"];

/** Loggrad utan personuppgifter: bara steget och en felkod. Aldrig adresser, koder eller IP-adresser. */
export const logCode = (step: string, code: unknown) => console.error("inloggning", step, typeof code === "string" && /^[\w.-]{1,60}$/.test(code) ? code : "okänt");

/** Supabase Auth:s felkod (t.ex. "user_not_found") – bara bokstäver, siffror och understreck, annars "okänt". */
const authErrorCode = (e: { code?: unknown; status?: unknown } | null | undefined): string => {
  const c = typeof e?.code === "string" ? e.code : typeof e?.status === "number" ? String(e.status) : "";
  return /^[a-z0-9_]{1,60}$/.test(c) ? c : "okänt";
};

/** Det generateLink behöver – service role-klientens auth.admin (SupabaseClient["auth"]["admin"]). */
export type LinkAdmin = {
  generateLink(params: { type: "magiclink"; email: string }): Promise<{
    data: { properties: { email_otp?: string | null } | null } | null;
    error: { code?: string; status?: number } | null;
  }>;
};

export type LoginCodeDeps = {
  /** Service role: supabase.auth.admin. */
  admin: LinkAdmin;
  /** Service role: utskicksloggen. */
  log: Repo<{ outbound_messages: OutboundMessage }>;
  /** Null när RESEND_API_KEY eller MM_EMAIL_FROM saknas. */
  resend: ResendConfig | null;
  fetch: FetchLike;
  /** Appens klocka (testtid i testmiljön). */
  now: LocalDateTime;
  newId: (prefix: string) => string;
  /** Testmiljön märks i ämnesraden och överst i mejlet. */
  testEnvironment: boolean;
  /** Kodens giltighetstid i minuter (samma som Supabase Auth). */
  validMinutes?: number;
};

export type LoginCodeOutcome = "sent" | "failed" | "suppressed";

/** Ta fram koden, skicka den och logga utskicket utan koden. Kastar aldrig. */
export async function sendLoginCode(deps: LoginCodeDeps, email: string): Promise<LoginCodeOutcome> {
  const id = deps.newId("out");
  const log = deps.log.table("outbound_messages");
  // Taket: raden skrivs innan koden tas fram och räknas sedan tillsammans med övriga rader den senaste timmen. Samtidiga
  // anrop ser varandras rader, så fler än taket kan aldrig skickas (vid många samtidiga anrop precis vid taket kan något
  // stoppas fast taket inte är helt fullt). Går utskicksloggen inte att skriva eller läsa skickas ingen kod.
  try {
    await log.insert({
      id,
      createdAt: deps.now,
      channel: "email",
      to: email,
      template: LOGIN_CODE_TEMPLATE,
      subject: TEMPLATES[LOGIN_CODE_TEMPLATE].subject,
      body: LOGGED_BODY.queued,
      caseId: null,
      status: "queued",
      sentAt: null,
      statusReason: null,
      providerMessageId: null,
    });
    const used = await log.count({ template: LOGIN_CODE_TEMPLATE, status: { in: COUNTED }, createdAt: { gt: addMinutes(deps.now, -60), lte: deps.now } });
    if (used > CODE_MAILS_PER_HOUR) {
      await log.update(id, { status: "suppressed", body: LOGGED_BODY.suppressed, statusReason: CODE_REASON.overLimit });
      logCode("skicka-kod", "tak");
      return "suppressed";
    }
  } catch (e) {
    logCode("utskickslogg", (e as Error)?.name);
    return "failed";
  }

  let status: Exclude<LoginCodeOutcome, "suppressed"> = "failed";
  let reason: string | null = null;
  let providerMessageId: string | null = null;
  try {
    const { data, error } = await deps.admin.generateLink({ type: "magiclink", email });
    const code = data?.properties?.email_otp ?? "";
    if (error || !code) {
      reason = CODE_REASON.noCode(authErrorCode(error));
      logCode("skapa-kod", authErrorCode(error));
    } else if (!/^\d{6}$/.test(code)) {
      // Appen tar bara emot sex siffror (verifyCode). Fel längd i Supabase Auth: skicka ingen kod som inte går att använda.
      reason = CODE_REASON.badFormat;
      logCode("skapa-kod", "fel-format");
    } else if (!deps.resend) {
      reason = CODE_REASON.notConfigured;
      logCode("skicka-kod", "resend-saknas");
    } else {
      const mail = renderLoginCodeEmail(code, { testEnvironment: deps.testEnvironment, validMinutes: deps.validMinutes });
      // Ingen svarsadress: ett svar skulle citera koden. Foten säger att det inte går att svara.
      const res = await sendViaResend(deps.fetch, { ...deps.resend, replyTo: null }, { ...mail, to: email, idempotencyKey: id, template: LOGIN_CODE_TEMPLATE });
      status = "sent";
      providerMessageId = res.id || null;
    }
  } catch (e) {
    // JobError har bara HTTP-status och Resends felnamn – aldrig adressen eller koden.
    reason = e instanceof JobError ? e.message : CODE_REASON.unknown;
    logCode("skicka-kod", e instanceof JobError ? "resend" : (e as Error)?.name);
  }
  try {
    await log.update(id, { body: LOGGED_BODY[status], status, sentAt: status === "sent" ? deps.now : null, statusReason: reason, providerMessageId });
  } catch (e) {
    logCode("utskickslogg", (e as Error)?.name);
  }
  return status;
}
