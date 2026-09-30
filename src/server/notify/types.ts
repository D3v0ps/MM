// Typer för utskicken i supabase-läget. Tabellerna har fler kolumner och statusar än appens schema (src/data/schema.ts):
//   outbound_messages.status_reason, outbound_messages.provider_message_id (supabase/migrations/0006)
//   jobs.started_at (supabase/migrations/0009)
// och statusarna "suppressed" (spärrat, t.ex. testmiljöns spärrlista) och "manual" (brev som skickas för hand).
import type { OutgoingMessage } from "@/api/server";
import type { LocalDateTime } from "@/core/time";
import type { Repo } from "@/data/repo";
import type { Case, Job, OutboundChannel, OutboundMessage } from "@/data/schema";

/**
 * Utskickets status.
 *   queued      väntar på att skickas (jobbet send_message)
 *   sent        lämnat till e-postleverantören (Resend)
 *   failed      gick inte att skicka efter alla försök, eller leverantören avvisade det
 *   suppressed  stoppat med avsikt: spärrlistan i testmiljön, saknad adress, SMS utan leverantör, personnummer i texten
 *   manual      skickas för hand (brev)
 */
export type DeliveryStatus = "queued" | "sent" | "failed" | "suppressed" | "manual";

/** Raden i outbound_messages som utskicken läser och skriver. */
export type OutboundRow = Omit<OutboundMessage, "status"> & {
  status: DeliveryStatus;
  /** Varför utskicket stoppades eller misslyckades. Aldrig adresser eller andra personuppgifter. */
  statusReason: string | null;
  /** E-postleverantörens id för utskicket (Resend). */
  providerMessageId: string | null;
};

/** Jobbraden som den finns i databasen (startedAt sätts av mm.claim_jobs). */
export type JobRow = Job & { startedAt?: LocalDateTime | null };

/** De tabeller utskicken och jobben använder. Samma Repo som hanterarnas ctx.system (service role). */
export type NotifyTables = {
  outbound_messages: OutboundRow;
  jobs: JobRow;
  cases: Case;
};
export type NotifyRepo = Repo<NotifyTables>;

/** Hanterarnas utskick. Kallelsen skickar kanalen "brev" direkt (src/features/_shared/context.ts). */
export type QueuedMessage = Omit<OutgoingMessage, "channel"> & { channel: OutgoingMessage["channel"] | "brev" };

/** OutgoingMessage.channel -> outbound_messages.channel. */
export const CHANNEL: Record<QueuedMessage["channel"], OutboundChannel> = { email: "email", sms: "sms", letter: "brev", brev: "brev" };

/** Jobbtypen som skickar ett utskick. payload = { messageId }. */
export const SEND_MESSAGE = "send_message";
