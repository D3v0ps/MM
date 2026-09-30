// Får utskicket skickas? Rena funktioner – samma regler när utskicket läggs i kön och precis innan det skickas.
//   SMS: ingen leverantör är vald ännu -> suppressed
//   Brev: skickas för hand -> manual
//   E-post: stoppas om adressen saknas, om texten ser ut att innehålla ett personnummer eller – i testmiljön – om
//           mottagaren inte finns i MM_EMAIL_ALLOWLIST. Texterna i statusReason innehåller aldrig adressen.
import { allowedByList, isValidEmail, normalizeEmail } from "../auth/email";
import { containsPersonnummer } from "./personnummer";
import type { DeliveryStatus, OutboundRow } from "./types";

/** Utskicket stoppas: suppressed (spärrat med avsikt) eller manual (skickas för hand). */
export type Stop = { action: Extract<DeliveryStatus, "suppressed" | "manual">; reason: string };
export type Decision = { action: "send" } | Stop;

export const REASON = {
  sms: "SMS-leverantör inte vald",
  letter: "Brev skickas manuellt",
  noAddress: "Mottagaren saknar giltig e-postadress",
  personnummer: "Stoppat: texten ser ut att innehålla ett personnummer",
  notAllowed: "Testmiljön: mottagaren finns inte i MM_EMAIL_ALLOWLIST",
} as const;

/**
 * Spärren för mottagare. `restricted` = bara adresserna i `allowlist` får mejl.
 * Spärren gäller alltid utom när databasen uttryckligen är produktion (app_settings.environment = 'production') och
 * spärrlistan är tom. En saknad eller okänd miljörad räknas alltså som testmiljö – hellre inga mejl än mejl till
 * testdatats adresser på riktiga domäner (t.ex. botkyrka.se).
 */
export type RecipientGate = { restricted: boolean; allowlist: readonly string[]; environment: "staging" | "production" | "unknown" };

export function recipientGate(environmentSetting: string | null | undefined, allowlist: readonly string[]): RecipientGate {
  const environment = environmentSetting === "production" ? "production" : environmentSetting === "staging" ? "staging" : "unknown";
  return { restricted: environment !== "production" || allowlist.length > 0, allowlist, environment };
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
  if (gate.restricted && !allowedByList(to, gate.allowlist)) return { action: "suppressed", reason: REASON.notAllowed };
  return { action: "send" };
}

/** Hela beslutet för ett utskick. */
export function deliveryDecision(row: Pick<OutboundRow, "channel" | "to" | "subject" | "body">, gate: RecipientGate): Decision {
  return channelDecision(row.channel) ?? emailDecision(row, gate);
}
