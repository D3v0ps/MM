// Utskickens inställningar från miljövariabler (docs/UTSKICK.md, docs/DRIFT.md avsnitt 13). Inga hemligheter loggas.
//   RESEND_API_KEY      Resends API-nyckel (bara sändrätt)          MM_EMAIL_FROM   avsändare, "Miljonmatch <notis@…>"
//   MM_APP_URL          appens adress – länken i mejlen            MM_EMAIL_ALLOWLIST  testmiljöns spärrlista
//   MM_STAFF_EMAIL_DOMAINS  personalens domäner (länk till appen i stället för portalen)
//   MM_EMAIL_REPLY_TO   svarsadress (produktion: avrop@miljonbemanning.se – svar hamnar i avropsflödet). Tom i testmiljön
//   MM_EMAIL_REDIRECT_TO  bara testmiljön: mejl till testpersoner går i stället hit (måste finnas i MM_EMAIL_ALLOWLIST)
// SMS och utringning via 46elks (beslut 2026-10-09) – phoneEnv() och messagingStatus():
//   MM_SMS_PROVIDER=46elks  ELKS_API_USERNAME  ELKS_API_PASSWORD (hemlig)  MM_SMS_FROM (avsändarnamn, 3–11 tecken, standard Miljonbem)
//   MM_CALL_FROM (ett 46elks-nummer, +46…)  MM_CALL_AUDIO_URL (https-adress till inspelningen, public/ljud/README.md)
//   MM_SMS_ALLOWLIST  testmiljöns spärrlista för telefonnummer (SMS och samtal)   MM_SMS_REDIRECT_TO  bara testmiljön: testarens nummer
import { toE164 } from "@/core/phone";
import { CALL_ENV_VARS, SMS_ENV_VARS, type ChannelState, type MessagingStatus } from "@/features/_shared/messaging-port";
import { parseList } from "../config";
import { emailReaches, recipientGate } from "./decision";
import type { ElksCallConfig, ElksSmsConfig } from "./elks";
import type { ResendConfig } from "./resend";

export type NotifyEnv = {
  /** Null när nyckeln eller avsändaren saknas – då skickas inga mejl (jobbet försöker igen senare). */
  resend: ResendConfig | null;
  appUrl: string | null;
  allowlist: string[];
  staffDomains: string[];
  /** Testmiljön: testarens adress för mejl som annars skulle ha stoppats. Används aldrig i produktion (decision.ts). */
  redirectTo: string | null;
};

export function notifyEnv(env: Record<string, string | undefined> = process.env): NotifyEnv {
  const apiKey = env.RESEND_API_KEY?.trim() || null;
  const from = env.MM_EMAIL_FROM?.trim() || null;
  const appUrl = env.MM_APP_URL?.trim().replace(/\/+$/, "") || null;
  const staff = parseList(env.MM_STAFF_EMAIL_DOMAINS).map((d) => d.replace(/^@/, ""));
  const replyTo = env.MM_EMAIL_REPLY_TO?.trim() || null;
  return {
    resend: apiKey && from ? { apiKey, from, replyTo } : null,
    appUrl,
    allowlist: parseList(env.MM_EMAIL_ALLOWLIST),
    staffDomains: staff.length ? staff : ["miljonbemanning.se"],
    redirectTo: env.MM_EMAIL_REDIRECT_TO?.trim().toLowerCase() || null,
  };
}

// ---------------------------------------------------------------- SMS och utringning (46elks)
/** Standardavsändaren för SMS (högst 11 tecken – 46elks visar den som avsändarnamn). */
export const DEFAULT_SMS_FROM = "Miljonbem";

/** Avsändarnamn hos 46elks: 3–11 bokstäver (a–z) eller siffror och första tecknet en bokstav – eller ett nummer i E.164. */
const validSmsFrom = (v: string): boolean => /^[A-Za-z][A-Za-z0-9]{2,10}$/.test(v) || /^\+[1-9]\d{6,14}$/.test(v);

export type PhoneEnv = {
  /** Null när SMS inte är kopplat (någon variabel saknas eller har fel format) – då stoppas SMS med "SMS-leverantör inte vald". */
  sms: ElksSmsConfig | null;
  /** Null när utringningen inte är kopplad – då stoppas samtalen med "Utringning inte kopplad". */
  call: ElksCallConfig | null;
  /** Testmiljöns spärrlista för telefonnummer (E.164). Ogiltiga poster hoppas över. */
  allowlist: string[];
  /** Testmiljön: testarens nummer (E.164) för SMS och samtal som annars skulle ha stoppats. Används aldrig i produktion. */
  redirectTo: string | null;
  /** Läget för hanterarna (ctx.messaging) och integrationskorten – bara variabelnamn, aldrig värden. */
  status: MessagingStatus;
};

export function phoneEnv(env: Record<string, string | undefined> = process.env): PhoneEnv {
  const v = (n: string) => env[n]?.trim() || "";
  const provider = v("MM_SMS_PROVIDER").toLowerCase();
  const username = v("ELKS_API_USERNAME");
  const password = v("ELKS_API_PASSWORD");
  const smsFrom = v("MM_SMS_FROM") || DEFAULT_SMS_FROM;
  const callFrom = toE164(v("MM_CALL_FROM"));
  const audio = v("MM_CALL_AUDIO_URL");
  const audioOk = /^https:\/\/[^\s]+$/i.test(audio);

  const missing = (names: readonly string[], extra: Record<string, string | null>): string[] =>
    names.flatMap((n) => {
      if (!v(n)) return [n];
      const problem = extra[n];
      return problem ? [`${n} (${problem})`] : [];
    });
  const smsMissing = missing(SMS_ENV_VARS, { MM_SMS_PROVIDER: provider && provider !== "46elks" ? "ska vara 46elks" : null });
  if (!validSmsFrom(smsFrom)) smsMissing.push("MM_SMS_FROM (3–11 bokstäver eller siffror, börjar med en bokstav)");
  const callMissing = missing(CALL_ENV_VARS, {
    MM_CALL_FROM: v("MM_CALL_FROM") && !callFrom ? "fel format – ett 46elks-nummer som +46…" : null,
    MM_CALL_AUDIO_URL: audio && !audioOk ? "ska börja med https://" : null,
  });
  const state = (m: string[]): ChannelState => ({ connected: m.length === 0, missing: m });
  const status: MessagingStatus = { sms: state(smsMissing), call: state(callMissing) };
  const redirect = toE164(v("MM_SMS_REDIRECT_TO"));
  return {
    sms: status.sms.connected ? { username, password, from: smsFrom } : null,
    call: status.call.connected && callFrom ? { username, password, from: callFrom, audioUrl: audio } : null,
    // Kommatecken eller semikolon mellan numren – mellanslag får stå i numren ("070-123 45 67").
    allowlist: (env.MM_SMS_ALLOWLIST ?? "").split(/[,;\n]+/).map((x) => toE164(x)).filter((x): x is string => !!x),
    redirectTo: redirect,
    status,
  };
}

/** Läget för SMS och utringning (integrationskorten) ur miljön. */
export const messagingStatus = (env: Record<string, string | undefined> = process.env): MessagingStatus => phoneEnv(env).status;

/**
 * Läget för hanterarna (ctx.messaging): SMS och utringning, och om ett mejl når deltagarens egen adress – spärrlistan
 * (MM_EMAIL_ALLOWLIST) gäller också i produktion (docs/DRIFT.md avsnitt 13). environmentSetting = app_settings.environment.
 * Kanalvalet räknar då inte e-post som kanal och samordnaren får en uppgift att ringa i stället.
 */
export function participantMessaging(environmentSetting: string | null | undefined, env: Record<string, string | undefined> = process.env): MessagingStatus {
  const mail = notifyEnv(env);
  return { ...phoneEnv(env).status, emailReaches: emailReaches(recipientGate(environmentSetting, mail.allowlist, mail.redirectTo)) };
}
