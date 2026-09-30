// Lägg ett utskick i kön: en rad i outbound_messages och – för e-post – ett jobb send_message som skickar det.
//   e-post  status queued + jobb (spärrar och sändning avgörs av jobbet, precis innan mejlet skickas)
//   SMS     status suppressed ("SMS-leverantör inte vald") – inget jobb
//   brev    status manual – inget jobb
// Ämnesraden sätts här från mallkatalogen (templates.ts) och innehåller högst ärendenumret.
import type { LocalDateTime } from "@/core/time";
import { channelDecision } from "./decision";
import { subjectFor, subjectNeedsCaseNumber } from "./templates";
import { CHANNEL, SEND_MESSAGE, type DeliveryStatus, type NotifyRepo, type QueuedMessage } from "./types";

export type QueueResult = { messageId: string; jobId: string | null; status: DeliveryStatus };

export async function queueMessage(system: NotifyRepo, msg: QueuedMessage, now: LocalDateTime, newId: (prefix: string) => string): Promise<QueueResult> {
  const channel = CHANNEL[msg.channel] ?? "email";
  const caseId = msg.caseId ?? null;
  let subject = msg.subject ?? null;
  if (!subject && channel === "email") {
    // ctx.system (service role): bara ärendenumret läses, för ämnesraden.
    const caseNumber = caseId && subjectNeedsCaseNumber(msg.template) ? ((await system.table("cases").get(caseId))?.caseNumber ?? null) : null;
    subject = subjectFor(msg.template, msg.body, caseNumber);
  }
  const early = channelDecision(channel);
  const messageId = newId("out");
  await system.table("outbound_messages").insert({
    id: messageId,
    createdAt: now,
    channel,
    to: msg.to,
    template: msg.template,
    subject,
    body: msg.body,
    caseId,
    status: early ? early.action : "queued",
    sentAt: null,
    statusReason: early ? early.reason : null,
    providerMessageId: null,
  });
  if (early) return { messageId, jobId: null, status: early.action };

  const jobId = newId("job");
  await system.table("jobs").insert({
    id: jobId,
    kind: SEND_MESSAGE,
    payload: { messageId },
    status: "queued",
    attempts: 0,
    runAfter: now,
    lastError: null,
    createdAt: now,
    createdBy: null,
    finishedAt: null,
  });
  return { messageId, jobId, status: "queued" };
}
