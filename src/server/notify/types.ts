// Typer för utskicken i supabase-läget. Statusarna, orsaken (statusReason) och leverantörens id (providerMessageId) finns i
// appens schema (src/data/schema.ts: OUTBOUND_STATUSES, OutboundMessage, Job.startedAt) och i migrationerna 0006/0009.
import type { OutgoingMessage } from "@/api/server";
import type { Repo } from "@/data/repo";
import type { Case, Job, Membership, Organization, OutboundChannel, OutboundMessage, OutboundStatus, Person, Profile } from "@/data/schema";

/**
 * Utskickets status.
 *   queued      väntar på att skickas (jobbet send_message)
 *   sent        lämnat till leverantören (Resend, 46elks) – i testmiljön ibland till testaren (statusReason "redirected")
 *   failed      gick inte att skicka efter alla försök, leverantören avvisade det eller telefonnumret har fel format
 *   suppressed  stoppat med avsikt: spärrlistan i testmiljön, saknad adress eller nummer, SMS eller utringning som inte är
 *               kopplad, personnummer i texten
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
  // Deltagarens e-postadress eller telefonnummer slås upp via ärendet precis innan utskicket skickas (mottagaren i
  // utskicksloggen är bara "deltagare (SMS)" o.s.v.). Läses med service role och lämnas aldrig ut.
  persons: Person;
  // Bara för testmiljöns omdirigering (MM_EMAIL_REDIRECT_TO): mottagarens roll och organisation i mejlets första rad.
  profiles: Profile;
  memberships: Membership;
  organizations: Organization;
};
export type NotifyRepo = Repo<NotifyTables>;

/** Hanterarnas utskick. Kallelsen skickar kanalen "brev" direkt (src/features/_shared/context.ts). */
export type QueuedMessage = Omit<OutgoingMessage, "channel"> & { channel: OutgoingMessage["channel"] | "brev" };

/** OutgoingMessage.channel -> outbound_messages.channel. */
export const CHANNEL: Record<QueuedMessage["channel"], OutboundChannel> = { email: "email", sms: "sms", letter: "brev", brev: "brev", call: "call" };

/** Jobbtypen som skickar ett utskick. payload = { messageId }. */
export const SEND_MESSAGE = "send_message";
