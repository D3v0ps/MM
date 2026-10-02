// Utskickens inställningar från miljövariabler (docs/UTSKICK.md). Inga hemligheter loggas.
//   RESEND_API_KEY      Resends API-nyckel (bara sändrätt)          MM_EMAIL_FROM   avsändare, "Miljonmatch <notis@…>"
//   MM_APP_URL          appens adress – länken i mejlen            MM_EMAIL_ALLOWLIST  testmiljöns spärrlista
//   MM_STAFF_EMAIL_DOMAINS  personalens domäner (länk till appen i stället för portalen)
//   MM_EMAIL_REPLY_TO   svarsadress (produktion: avrop@miljonbemanning.se – svar hamnar i avropsflödet). Tom i testmiljön
//   MM_EMAIL_REDIRECT_TO  bara testmiljön: mejl till testpersoner går i stället hit (måste finnas i MM_EMAIL_ALLOWLIST)
import { parseList } from "../config";
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
