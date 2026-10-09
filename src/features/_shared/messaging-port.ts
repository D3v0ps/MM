// Läget för SMS och utringning (46elks, beslut 2026-10-09). Isomorf. Hanterarna läser läget via ctx.messaging – aldrig
// miljövariablerna själva (de finns bara på servern, src/server/notify/config.ts).
//   Minnesläget (prototypen, utvecklingsläget, e2e): inget är kopplat (MESSAGING_OFF) – SMS och samtal stoppas med orsak,
//   precis som i en drift utan variablerna. Tester kan skicka in ett eget läge (createMemoryRuntime({ messaging })).
//   Supabase-läget: läget räknas fram ur miljövariablerna (messagingStatus i src/server/notify/config.ts).
// Mottagaren av ett utskick till en deltagare sparas som en beskrivning ("deltagare (SMS)") – utskicket slår upp numret eller
// adressen via ärendet precis innan det skickas (src/server/notify/sender.ts). Inga nummer eller adresser i utskicksloggen.
import type { Ctx } from "@/api/server";

/** Kanalens läge. missing = variablerna som saknas eller har fel format – bara namnen, aldrig värdena. */
export type ChannelState = { connected: boolean; missing: readonly string[] };
export type MessagingStatus = { sms: ChannelState; call: ChannelState };

/** Variablerna som krävs för SMS. MM_SMS_FROM (avsändarnamnet) är valfri – standard "Miljonbem". */
export const SMS_ENV_VARS = ["MM_SMS_PROVIDER", "ELKS_API_USERNAME", "ELKS_API_PASSWORD"] as const;
/** Variablerna som krävs för utringning: inloggningen hos 46elks, numret det ringer från och inspelningens adress. */
export const CALL_ENV_VARS = ["ELKS_API_USERNAME", "ELKS_API_PASSWORD", "MM_CALL_FROM", "MM_CALL_AUDIO_URL"] as const;

/** Inget kopplat (minnesläget och en drift utan variablerna). */
export const MESSAGING_OFF: MessagingStatus = {
  sms: { connected: false, missing: [...SMS_ENV_VARS] },
  call: { connected: false, missing: [...CALL_ENV_VARS] },
};

export const messagingOf = (ctx: Pick<Ctx, "messaging">): MessagingStatus => ctx.messaging ?? MESSAGING_OFF;

/** Orsaken (outbound_messages.statusReason) när SMS inte är kopplat. Samma text som före 46elks. */
export const SMS_OFF_REASON = "SMS-leverantör inte vald";
/** Orsaken när utringningen inte är kopplad (alla tre variablerna och inloggningen hos 46elks krävs). */
export const CALL_OFF_REASON = "Utringning inte kopplad";
/** Orsaken för brev (status manual – skickas för hand). */
export const LETTER_REASON = "Brev skickas manuellt";

/** Kanalerna till en deltagare. brev = kallelse per post (bara när deltagaren valt brev och adressen finns). */
export type ParticipantChannel = "email" | "sms" | "call" | "brev";

/** Mottagaren i utskicksloggen för ett utskick till en deltagare. Numret eller adressen slås upp när utskicket skickas. */
export const PARTICIPANT_TO: Readonly<Record<ParticipantChannel, string>> = {
  email: "deltagare (e-post)", sms: "deltagare (SMS)", call: "deltagare (samtal)", brev: "deltagare (brev)",
};

/** Är mottagaren en deltagare (beskrivningen ovan, även äldre varianter som "deltagare (SMS (telefon vald …))")? */
export const isParticipantRecipient = (to: string | null | undefined): boolean => /^deltagare \(/.test(String(to ?? "").trim());

/**
 * Status för ett utskick i minnesläget, där inget skickas på riktigt: SMS och samtal som inte är kopplade stoppas och brev
 * skickas för hand, med samma orsak som servern ger (src/server/notify/decision.ts); allt annat räknas som skickat (simulerat).
 */
export function memoryDeliveryStatus(channel: string, status: MessagingStatus): { status: "sent" | "suppressed" | "manual"; statusReason: string | null } {
  if (channel === "sms" && !status.sms.connected) return { status: "suppressed", statusReason: SMS_OFF_REASON };
  if (channel === "call" && !status.call.connected) return { status: "suppressed", statusReason: CALL_OFF_REASON };
  if (channel === "brev" || channel === "letter") return { status: "manual", statusReason: LETTER_REASON };
  return { status: "sent", statusReason: null };
}
