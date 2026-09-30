// PLATSHÅLLARE (serveragenten) – ersätts av utskicksagenten (Resend, spärrlista i testmiljön, jobb send_message).
// Behåll signaturen: enqueueMessage(system, msg, now). Sparar bara utskicket i outbound_messages med status "queued".
// Texten innehåller aldrig personuppgifter (CLAUDE.md punkt 9) – hanterarna skickar bara ärendenummer och länk.
import type { OutgoingMessage } from "@/api/server";
import type { LocalDateTime } from "@/core/time";
import type { AppRepo, OutboundChannel } from "@/data/schema";

const CHANNEL: Record<OutgoingMessage["channel"], OutboundChannel> = { email: "email", sms: "sms", letter: "brev" };

/** Lägg ett utskick i kön. Returnerar utskickets id. */
export async function enqueueMessage(system: AppRepo, msg: OutgoingMessage, now: LocalDateTime): Promise<string> {
  const id = `out-${crypto.randomUUID()}`;
  await system.table("outbound_messages").insert({
    id,
    createdAt: now,
    channel: CHANNEL[msg.channel],
    to: msg.to,
    template: msg.template,
    subject: msg.subject ?? null,
    body: msg.body,
    caseId: msg.caseId ?? null,
    status: "queued",
    sentAt: null,
  });
  return id;
}
