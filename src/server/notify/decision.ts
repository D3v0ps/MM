// Får utskicket skickas? Rena funktioner – samma regler när utskicket läggs i kön och precis innan det skickas.
//   SMS: ingen leverantör är vald ännu -> suppressed
//   Brev: skickas för hand -> manual
//   E-post: stoppas om adressen saknas, om texten ser ut att innehålla ett personnummer eller – i testmiljön – om
//           mottagaren inte finns i MM_EMAIL_ALLOWLIST. Texterna i statusReason innehåller aldrig adressen.
//   Testmiljön med MM_EMAIL_REDIRECT_TO: mejl som annars skulle ha stoppats av spärrlistan går i stället till testarens adress
//           (status sent, orsak "redirected"). Aldrig i produktion.
import { allowedByList, isValidEmail, normalizeEmail } from "../auth/email";
import { containsPersonnummer } from "./personnummer";
import type { DeliveryStatus, OutboundRow } from "./types";

/** Utskicket stoppas: suppressed (spärrat med avsikt) eller manual (skickas för hand). */
export type Stop = { action: Extract<DeliveryStatus, "suppressed" | "manual">; reason: string };
/** Testmiljön: skicka till testarens adress (MM_EMAIL_REDIRECT_TO) i stället för till testpersonen. */
export type Redirect = { action: "redirect"; to: string; reason: typeof REASON.redirected };
export type Decision = { action: "send" } | Redirect | Stop;

export const REASON = {
  sms: "SMS-leverantör inte vald",
  letter: "Brev skickas manuellt",
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

/** Beslut som bara beror på kanalen (SMS och brev). Null för e-post – då gäller emailDecision. */
export function channelDecision(channel: OutboundRow["channel"]): Stop | null {
  if (channel === "sms") return { action: "suppressed", reason: REASON.sms };
  if (channel === "brev") return { action: "manual", reason: REASON.letter };
  return null;
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
