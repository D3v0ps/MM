// Får utskicket skickas? Rena funktioner – samma regler när utskicket läggs i kön och precis innan det skickas.
//   SMS och utringning: stoppas (suppressed) när 46elks inte är kopplat (variablerna saknas, src/server/notify/config.ts).
//           Annars: numret måste gå att tolka (E.164, annars failed "Telefonnumret har fel format"), texten får inte innehålla
//           ett personnummer, och i testmiljön får bara numren i MM_SMS_ALLOWLIST SMS och samtal (MM_SMS_REDIRECT_TO som för e-post).
//   Brev: skickas för hand -> manual
//   E-post: stoppas om adressen saknas, om texten ser ut att innehålla ett personnummer eller – i testmiljön – om
//           mottagaren inte finns i MM_EMAIL_ALLOWLIST. Texterna i statusReason innehåller aldrig adressen.
//   Testmiljön med MM_EMAIL_REDIRECT_TO: mejl som annars skulle ha stoppats av spärrlistan går i stället till testarens adress
//           (status sent, orsak "redirected"). Aldrig i produktion.
import { toE164 } from "@/core/phone";
import { CALL_OFF_REASON, LETTER_REASON, SMS_OFF_REASON } from "@/features/_shared/messaging-port";
import { allowedByList, isValidEmail, normalizeEmail } from "../auth/email";
import { containsPersonnummer } from "./personnummer";
import type { DeliveryStatus, OutboundRow } from "./types";

/** Utskicket stoppas: suppressed (spärrat med avsikt) eller manual (skickas för hand). */
export type Stop = { action: Extract<DeliveryStatus, "suppressed" | "manual">; reason: string };
/** Testmiljön: skicka till testarens adress (MM_EMAIL_REDIRECT_TO) i stället för till testpersonen. */
export type Redirect = { action: "redirect"; to: string; reason: typeof REASON.redirected };
export type Decision = { action: "send" } | Redirect | Stop;

export const REASON = {
  sms: SMS_OFF_REASON,
  /** Utringningen är inte kopplad (MM_CALL_FROM, MM_CALL_AUDIO_URL eller inloggningen hos 46elks saknas). */
  call: CALL_OFF_REASON,
  noPhone: "Mottagaren saknar telefonnummer",
  /** Ger status failed (inte suppressed): numret finns men går inte att tolka. Numret står aldrig i orsaken. */
  badPhone: "Telefonnumret har fel format",
  phoneNotAllowed: "Testmiljön: numret finns inte i MM_SMS_ALLOWLIST",
  /** Vilande spärr (CLAUDE.md punkt 8): inga SMS, mejl eller samtal till en deltagare med skyddade personuppgifter. */
  protectedIdentity: "Skyddade personuppgifter – inget utskick till deltagaren",
  /** Ett tidigare försök avbröts efter att det skickats till 46elks – skickas inte igen utan kontroll (ingen idempotensnyckel). */
  uncertain: "Osäkert om utskicket gick iväg (avbrutet försök) – kontrollera i 46elks innan det skickas igen",
  letter: LETTER_REASON,
  noAddress: "Mottagaren saknar giltig e-postadress",
  personnummer: "Stoppat: texten ser ut att innehålla ett personnummer",
  notAllowed: "Testmiljön: mottagaren finns inte i MM_EMAIL_ALLOWLIST",
  /** Skickat till testarens adress i stället för till testpersonen (MM_EMAIL_REDIRECT_TO, bara testmiljön). */
  redirected: "redirected",
} as const;

/**
 * Spärren för mottagare. `restricted` = bara adresserna i `allowlist` får mejl.
 * Spärren gäller alltid utom när databasen uttryckligen är produktion (app_settings.environment = 'production') och
 * spärrlistan är tom. En saknad eller okänd miljörad räknas alltså som testmiljö – hellre inga mejl än mejl till
 * testdatats adresser på riktiga domäner (t.ex. botkyrka.se).
 */
export type RecipientGate = {
  restricted: boolean;
  allowlist: readonly string[];
  environment: "staging" | "production" | "unknown";
  /**
   * Testmiljön: adressen som får mejlen som spärrlistan annars skulle ha stoppat (MM_EMAIL_REDIRECT_TO). Null i produktion,
   * när miljön är okänd och när adressen själv inte finns i spärrlistan – då stoppas mejlen som vanligt.
   */
  redirectTo: string | null;
};

export function recipientGate(environmentSetting: string | null | undefined, allowlist: readonly string[], redirectTo?: string | null): RecipientGate {
  const environment = environmentSetting === "production" ? "production" : environmentSetting === "staging" ? "staging" : "unknown";
  const r = normalizeEmail(redirectTo);
  const redirect = environment === "staging" && isValidEmail(r) && allowedByList(r, allowlist) ? r : null;
  return { restricted: environment !== "production" || allowlist.length > 0, allowlist, environment, redirectTo: redirect };
}

/** Vilka telefonkanaler som är kopplade (46elks). Utelämnat = inga – som före 46elks. */
export type PhoneChannels = { sms: boolean; call: boolean };

/** Beslut som bara beror på kanalen (SMS, samtal och brev). Null när utskicket ska prövas vidare (e-post, kopplad SMS/samtal). */
export function channelDecision(channel: OutboundRow["channel"], phone: PhoneChannels = { sms: false, call: false }): Stop | null {
  if (channel === "sms" && !phone.sms) return { action: "suppressed", reason: REASON.sms };
  if (channel === "call" && !phone.call) return { action: "suppressed", reason: REASON.call };
  if (channel === "brev") return { action: "manual", reason: REASON.letter };
  return null;
}

// ---------------------------------------------------------------- Telefonnummer (SMS och utringning)
/** Spärren för telefonnummer – samma regler som för e-post (recipientGate), numren i E.164. */
export type PhoneGate = { restricted: boolean; allowlist: readonly string[]; environment: RecipientGate["environment"]; redirectTo: string | null };

export function phoneGate(environmentSetting: string | null | undefined, allowlist: readonly string[], redirectTo?: string | null): PhoneGate {
  const environment = environmentSetting === "production" ? "production" : environmentSetting === "staging" ? "staging" : "unknown";
  const list = allowlist.map((x) => toE164(x)).filter((x): x is string => !!x);
  const r = toE164(redirectTo);
  const redirect = environment === "staging" && r && list.includes(r) ? r : null;
  return { restricted: environment !== "production" || list.length > 0, allowlist: list, environment, redirectTo: redirect };
}

/** invalid = numret finns men går inte att tolka (utskicket får status failed). */
export type PhoneDecision = { action: "send"; to: string } | (Omit<Redirect, "to"> & { to: string }) | Stop | { action: "invalid"; reason: typeof REASON.badPhone };

/** Får SMS:et eller samtalet gå till numret? `to` är numret som det står hos deltagaren (normaliseras här). */
export function phoneDecision(to: string | null | undefined, body: string, gate: PhoneGate): PhoneDecision {
  if (containsPersonnummer(body)) return { action: "suppressed", reason: REASON.personnummer };
  if (!String(to ?? "").trim()) return { action: "suppressed", reason: REASON.noPhone };
  const n = toE164(to);
  if (!n) return { action: "invalid", reason: REASON.badPhone };
  if (gate.restricted && !gate.allowlist.includes(n)) {
    if (gate.redirectTo && gate.environment === "staging") return { action: "redirect", to: gate.redirectTo, reason: REASON.redirected };
    return { action: "suppressed", reason: REASON.phoneNotAllowed };
  }
  return { action: "send", to: n };
}

/** Får e-postutskicket skickas till mottagaren? */
export function emailDecision(row: Pick<OutboundRow, "to" | "subject" | "body">, gate: RecipientGate): Decision {
  if (containsPersonnummer(row.body) || containsPersonnummer(row.subject)) return { action: "suppressed", reason: REASON.personnummer };
  const to = normalizeEmail(row.to);
  if (!isValidEmail(to)) return { action: "suppressed", reason: REASON.noAddress };
  if (gate.restricted && !allowedByList(to, gate.allowlist)) {
    // Aldrig i produktion: recipientGate sätter redirectTo bara i testmiljön.
    if (gate.redirectTo && gate.environment === "staging") return { action: "redirect", to: gate.redirectTo, reason: REASON.redirected };
    return { action: "suppressed", reason: REASON.notAllowed };
  }
  return { action: "send" };
}

/** Hela beslutet för ett utskick. */
export function deliveryDecision(row: Pick<OutboundRow, "channel" | "to" | "subject" | "body">, gate: RecipientGate): Decision {
  return channelDecision(row.channel) ?? emailDecision(row, gate);
}
