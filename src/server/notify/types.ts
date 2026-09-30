// Typer för utskicken i supabase-läget. Statusarna, orsaken (statusReason) och leverantörens id (providerMessageId) finns i
// appens schema (src/data/schema.ts: OUTBOUND_STATUSES, OutboundMessage, Job.startedAt) och i migrationerna 0006/0009.
import type { OutgoingMessage } from "@/api/server";
import type { Repo } from "@/data/repo";
import type { Case, Job, Membership, Organization, OutboundChannel, OutboundMessage, OutboundStatus, Profile } from "@/data/schema";

/**
 * Utskickets status.
 *   queued      väntar på att skickas (jobbet send_message)
 *   sent        lämnat till e-postleverantören (Resend) – i testmiljön ibland till testarens adress (statusReason "redirected")
 *   failed      gick inte att skicka efter alla försök, eller leverantören avvisade det
 *   suppressed  stoppat med avsikt: spärrlistan i testmiljön, saknad adress, SMS utan leverantör, personnummer i texten
 *   manual      skickas för hand (brev)
 */
export type DeliveryStatus = OutboundStatus;

/** Raden i outbound_messages som utskicken läser och skriver. statusReason: aldrig adresser eller andra personuppgifter. */
export type OutboundRow = OutboundMessage;

/** Jobbraden (startedAt sätts av mm.claim_jobs). */
export type JobRow = Job;

/** De tabeller utskicken och jobben använder. Samma Repo som hanterarnas ctx.system (service role). */
export type NotifyTables = {
  outbound_messages: OutboundRow;
  jobs: JobRow;
  cases: Case;
  // Bara för testmiljöns omdirigering (MM_EMAIL_REDIRECT_TO): mottagarens roll och organisation i mejlets första rad.
  profiles: Profile;
  memberships: Membership;
  organizations: Organization;
};
export type NotifyRepo = Repo<NotifyTables>;

/** Hanterarnas utskick. Kallelsen skickar kanalen "brev" direkt (src/features/_shared/context.ts). */
export type QueuedMessage = Omit<OutgoingMessage, "channel"> & { channel: OutgoingMessage["channel"] | "brev" };

/** OutgoingMessage.channel -> outbound_messages.channel. */
export const CHANNEL: Record<QueuedMessage["channel"], OutboundChannel> = { email: "email", sms: "sms", letter: "brev", brev: "brev" };

/** Jobbtypen som skickar ett utskick. payload = { messageId }. */
export const SEND_MESSAGE = "send_message";
