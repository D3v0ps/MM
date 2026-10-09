// Lägg ett utskick i kön: en rad i outbound_messages och – för e-post, SMS och samtal – ett jobb send_message som skickar det.
//   e-post  status queued + jobb (spärrar och sändning avgörs av jobbet, precis innan mejlet skickas)
//   SMS     kopplat (46elks): status queued + jobb. Annars status suppressed ("SMS-leverantör inte vald") – inget jobb
//   samtal  kopplat (46elks): status queued + jobb. Annars status suppressed ("Utringning inte kopplad") – inget jobb
//   brev    status manual – inget jobb
// Ämnesraden sätts här från mallkatalogen (templates.ts) och innehåller högst ärendenumret.
// Engångslänkar (deltagarens inspelningslänk /rost/<token>): sökvägen blir en fullständig adress med MM_APP_URL, och token
// sparas aldrig i outbound_messages.body ("/rost/•••••"). Ett mejl som ska skickas har hela texten i jobbets payload (body)
// tills det skickats eller stoppats – då tas den bort (sender.ts).
import { absoluteLinks, maskLinkTokens } from "@/core/link-tokens";
import type { LocalDateTime } from "@/core/time";
import { channelDecision, type PhoneChannels } from "./decision";
import { subjectFor, subjectNeedsCaseNumber } from "./templates";
import { CHANNEL, SEND_MESSAGE, type DeliveryStatus, type NotifyRepo, type QueuedMessage } from "./types";

export type QueueResult = { messageId: string; jobId: string | null; status: DeliveryStatus };

export type QueueOpts = {
  /** Appens adress (MM_APP_URL) – sökvägar till engångslänkar blir fullständiga adresser. */
  appUrl?: string | null;
  /** Kopplade telefonkanaler (46elks, phoneEnv i config.ts). Utelämnat = inga: SMS och samtal stoppas direkt. */
  phone?: PhoneChannels;
};

export async function queueMessage(
  system: NotifyRepo, msg: QueuedMessage, now: LocalDateTime, newId: (prefix: string) => string, opts: QueueOpts = {},
): Promise<QueueResult> {
  const channel = CHANNEL[msg.channel] ?? "email";
  // Texten som skickas (fullständiga länkar) och texten som sparas i utskicksloggen (utan token).
  const body = absoluteLinks(msg.body, opts.appUrl);
  const logged = maskLinkTokens(body);
  const caseId = msg.caseId ?? null;
  let subject = msg.subject ?? null;
  if (!subject && channel === "email") {
    // ctx.system (service role): bara ärendenumret läses, för ämnesraden.
    const caseNumber = caseId && subjectNeedsCaseNumber(msg.template) ? ((await system.table("cases").get(caseId))?.caseNumber ?? null) : null;
    subject = subjectFor(msg.template, logged, caseNumber);
  }
  const early = channelDecision(channel, opts.phone);
  const messageId = newId("out");
  await system.table("outbound_messages").insert({
    id: messageId,
    createdAt: now,
    channel,
    to: msg.to,
    template: msg.template,
    subject,
    body: logged,
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
    // Hela texten bara när utskicksloggen har en maskerad länk – sender.ts tar bort den när utskicket är avgjort.
    payload: logged === body ? { messageId } : { messageId, body },
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
