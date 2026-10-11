// Skicka ett utskick som ligger i kön (jobbet send_message). Idempotent:
//   - bara utskick med status queued skickas – ett utskick som redan är skickat eller stoppat hoppas över
//   - Resend får utskickets id som Idempotency-Key, så att ett nytt försök (t.ex. efter att statusen inte hann sparas)
//     inte blir ett andra mejl
//   - 46elks (SMS och samtal) har ingen idempotensnyckel: utskicket markeras (providerMessageId "pending") med en villkorad
//     uppdatering innan anropet. Ett försök som hittar markeringen (det förra avbröts mitt i) skickar inte igen utan ger upp
//     med orsaken "Osäkert om utskicket gick iväg" – hellre ett SMS för lite än samma SMS två gånger
// Spärrarna (decision.ts) kontrolleras igen precis innan utskicket skickas. Inget loggas med adress, nummer eller text.
// Deltagare: mottagaren i utskicksloggen är bara en beskrivning ("deltagare (SMS)"). Adressen eller numret slås upp via ärendet
// här (service role) och lämnas aldrig ut. Vilande spärr: skyddade personuppgifter får inga utskick.
// Engångslänkar: utskicksloggen har länken utan token ("/rost/•••••"), och hela texten ligger i jobbets payload (body) tills
// utskicket är avgjort (skickat, stoppat eller misslyckat) – då tas den bort ur jobbet (queue.ts, src/core/link-tokens.ts).
import type { LocalDateTime } from "@/core/time";
import { isParticipantRecipient } from "@/features/_shared/messaging-port";
import { JobError } from "../jobs/errors";
import { deliveryDecision, phoneDecision, REASON, type PhoneGate, type RecipientGate } from "./decision";
import { ElksError, placeCallVia46elks, sendSmsVia46elks, type ElksCallConfig, type ElksFetch, type ElksSmsConfig } from "./elks";
import { intendedRecipient, redirectNote } from "./redirect";
import { renderEmail, type RenderConfig } from "./render";
import { sendViaResend, type FetchLike, type ResendConfig } from "./resend";
import type { DeliveryStatus, JobRow, NotifyRepo, OutboundRow } from "./types";

/** SMS och utringning via 46elks (phoneEnv i config.ts). */
export type PhoneSenderDeps = {
  gate: PhoneGate;
  /** Null när SMS inte är kopplat. */
  sms: ElksSmsConfig | null;
  /** Null när utringningen inte är kopplad. */
  call: ElksCallConfig | null;
  fetch: ElksFetch;
};

export type SenderDeps = {
  /** Service role (systemsteg). */
  repo: NotifyRepo;
  gate: RecipientGate;
  render: Omit<RenderConfig, "testEnvironment">;
  /** Null när RESEND_API_KEY eller MM_EMAIL_FROM saknas. */
  resend: ResendConfig | null;
  fetch: FetchLike;
  /** Appens klocka (testtid i testmiljön). */
  now: LocalDateTime;
  /** SMS och utringning. Saknas = inget kopplat: SMS och samtal stoppas med orsak. */
  phone?: PhoneSenderDeps;
};

export type DeliveryOutcome = Exclude<DeliveryStatus, "queued" | "failed"> | "skipped" | "missing";

/** Markeringen före ett anrop till 46elks (ersätts av 46elks id när anropet lyckats). */
export const PENDING_PROVIDER_ID = "pending";

/** SMS:ets början i testmiljön, och vem det skulle ha gått till när det skickas till testaren. */
export const SMS_TEST_PREFIX = "[Testmiljö] ";

/**
 * Deltagarens e-postadress eller telefonnummer via ärendet, när mottagaren är "deltagare (…)". Annars adressen som den står.
 * protected = vilande spärr för skyddade personuppgifter.
 */
async function recipientOf(repo: NotifyRepo, row: OutboundRow, field: "email" | "phone"): Promise<{ to: string; protected: boolean }> {
  if (!isParticipantRecipient(row.to)) return { to: row.to.trim(), protected: false };
  // service role: bara adressen eller numret läses, och bara för att skicka utskicket.
  const c = row.caseId ? await repo.table("cases").get(row.caseId) : null;
  const person = c ? await repo.table("persons").get(c.personId) : null;
  if (!person) return { to: "", protected: false };
  return { to: (person[field] ?? "").trim(), protected: !!person.protectedIdentity };
}

/**
 * Skicka utskicket. `body` = hela texten med engångslänkens token (jobbets payload), annars utskicksloggens text.
 * Spärrarna prövas mot utskicksloggens text (token är maskerad där – en slumpad token kan inte se ut som ett personnummer).
 */
export async function deliverMessage(deps: SenderDeps, messageId: string, body?: string | null): Promise<DeliveryOutcome> {
  const t = deps.repo.table("outbound_messages");
  const row = await t.get(messageId);
  if (!row) return "missing";
  if (row.status !== "queued") return "skipped";
  if (row.channel === "sms" || row.channel === "call") return deliverPhone(deps, row, body);

  const rcpt = await recipientOf(deps.repo, row, "email");
  if (rcpt.protected) {
    await t.update(row.id, { status: "suppressed", statusReason: REASON.protectedIdentity });
    return "suppressed";
  }
  const decision = deliveryDecision({ ...row, to: rcpt.to }, deps.gate);
  if (decision.action === "suppressed" || decision.action === "manual") {
    await t.update(row.id, { status: decision.action, statusReason: decision.reason });
    return decision.action;
  }
  if (!deps.resend) throw new JobError("E-post är inte konfigurerad (RESEND_API_KEY eller MM_EMAIL_FROM saknas)", { retryable: true });

  // Testmiljön: mejl till en testperson går till testarens adress, med en rad om vem det skulle ha gått till (roll och organisation).
  const redirected = decision.action === "redirect";
  const note = redirected ? redirectNote(await intendedRecipient(deps.repo, row)) : null;
  // Foten nämner svarsadressen (MM_EMAIL_REPLY_TO) när den finns – samma som Resend får som reply_to.
  const mail = renderEmail(body ? { ...row, body } : row, {
    ...deps.render, testEnvironment: deps.gate.environment !== "production", redirectNote: note, replyTo: deps.resend.replyTo ?? null,
  });
  const to = redirected ? decision.to : rcpt.to;
  const res = await sendViaResend(deps.fetch, deps.resend, { ...mail, to, idempotencyKey: row.id, template: row.template });
  await t.update(row.id, { status: "sent", sentAt: deps.now, statusReason: redirected ? REASON.redirected : null, providerMessageId: res.id || null });
  return "sent";
}

/**
 * SMS:et och mejlet i samma utskicksomgång som samtalet (samma ärende, mall och tid – notifyParticipant lägger dem tillsammans).
 * Bara status och kanal läses.
 */
async function writtenSiblings(repo: NotifyRepo, row: OutboundRow): Promise<OutboundRow[]> {
  if (!row.caseId) return [];
  return (await repo.table("outbound_messages").list({ caseId: row.caseId, template: row.template }))
    .filter((m) => m.id !== row.id && m.createdAt === row.createdAt && (m.channel === "email" || m.channel === "sms"));
}

/** SMS eller samtal via 46elks. Ogiltigt nummer: JobError utan nytt försök – utskicket får status failed med orsaken. */
async function deliverPhone(deps: SenderDeps, row: OutboundRow, body?: string | null): Promise<DeliveryOutcome> {
  const t = deps.repo.table("outbound_messages");
  const isSms = row.channel === "sms";
  const phone = deps.phone;
  const sms = phone?.sms ?? null;
  const call = phone?.call ?? null;
  if (!phone || (isSms ? !sms : !call)) {
    await t.update(row.id, { status: "suppressed", statusReason: isSms ? REASON.sms : REASON.call });
    return "suppressed";
  }
  const rcpt = await recipientOf(deps.repo, row, "phone");
  if (rcpt.protected) {
    await t.update(row.id, { status: "suppressed", statusReason: REASON.protectedIdentity });
    return "suppressed";
  }
  if (!isSms && isParticipantRecipient(row.to)) {
    // Utringningen spelar en inspelning som hänvisar till SMS:et eller mejlet: den ringer först när något av dem gått iväg.
    const written = await writtenSiblings(deps.repo, row);
    if (written.some((m) => m.status === "queued")) throw new JobError("Väntar på SMS:et eller mejlet innan samtalet ringer", { retryable: true });
    if (written.length && !written.some((m) => m.status === "sent")) {
      await t.update(row.id, { status: "suppressed", statusReason: REASON.callWithoutText });
      return "suppressed";
    }
  }
  const decision = phoneDecision(rcpt.to, row.body, phone.gate);
  if (decision.action === "invalid") throw new JobError(decision.reason, { retryable: false });
  if (decision.action !== "send" && decision.action !== "redirect") {
    await t.update(row.id, { status: decision.action, statusReason: decision.reason });
    return decision.action;
  }
  const redirected = decision.action === "redirect";
  let message = body ?? row.body;
  if (phone.gate.environment !== "production") {
    // Testmiljön: SMS:et märks, och när det går till testaren står det vem det skulle ha gått till (roll eller "deltagaren i ärende …").
    message = `${SMS_TEST_PREFIX}${redirected ? `Skulle ha gått till ${await intendedRecipient(deps.repo, row)}. ` : ""}${message}`;
  }
  // Markera före anropet: ett försök som avbryts mitt i skickas inte igen utan kontroll (46elks har ingen idempotensnyckel).
  const claimed = await t.updateIf(row.id, { status: "queued", providerMessageId: { isNull: true } }, { providerMessageId: PENDING_PROVIDER_ID });
  if (!claimed) throw new JobError(REASON.uncertain, { retryable: false });
  let res: { id: string };
  try {
    res = isSms ? await sendSmsVia46elks(phone.fetch, sms!, { to: decision.to, message }) : await placeCallVia46elks(phone.fetch, call!, { to: decision.to });
  } catch (e) {
    // 46elks tog inte emot anropet (svar med felstatus eller nätverksfel före svaret): släpp markeringen så att ett nytt försök får skicka.
    if (!(e instanceof ElksError && e.ambiguous)) await t.update(row.id, { providerMessageId: null });
    throw e;
  }
  await t.update(row.id, { status: "sent", sentAt: deps.now, statusReason: redirected ? REASON.redirected : null, providerMessageId: res.id || null });
  return "sent";
}

/** Utskickets id ur jobbets payload. */
export function messageIdOf(job: Pick<JobRow, "payload">): string {
  const id = (job.payload as { messageId?: unknown } | null)?.messageId;
  if (typeof id !== "string" || !id) throw new JobError("Jobbet saknar utskickets id", { retryable: false });
  return id;
}

/** Hela texten med engångslänkens token, om jobbet har den (queue.ts). */
export function secretBodyOf(job: Pick<JobRow, "payload">): string | null {
  const b = (job.payload as { body?: unknown } | null)?.body;
  return typeof b === "string" && b ? b : null;
}

/** Tid och plats för ett utskick till en deltagare (kallelse, inbjudan), om jobbet har dem (queue.ts). */
export function invitationOf(job: Pick<JobRow, "payload">): { when: LocalDateTime; place: string } | null {
  const v = (job.payload as { invitation?: { when?: unknown; place?: unknown } } | null)?.invitation;
  return v && typeof v.when === "string" && typeof v.place === "string" ? { when: v.when as LocalDateTime, place: v.place } : null;
}

/** Ta bort hela texten ur jobbet när utskicket är avgjort – token ska bara finnas så länge den behövs. Tid och plats står kvar. */
async function forgetSecretBody(job: JobRow, deps: SenderDeps, messageId: string): Promise<void> {
  const invitation = invitationOf(job);
  if (secretBodyOf(job)) await deps.repo.table("jobs").update(job.id, { payload: { messageId, ...(invitation ? { invitation } : {}) } });
}

/** Jobbet send_message. När alla försök är slut markeras utskicket som misslyckat med felorsaken. */
export const sendMessageJob = {
  async run(job: JobRow, deps: SenderDeps): Promise<string> {
    const id = messageIdOf(job);
    // Kastar vid fel som ska försökas igen – då står texten kvar i jobbet till nästa försök.
    const outcome = await deliverMessage(deps, id, secretBodyOf(job));
    await forgetSecretBody(job, deps, id);
    return outcome;
  },
  async onGiveUp(job: JobRow, reason: string, deps: SenderDeps): Promise<void> {
    const id = (job.payload as { messageId?: unknown } | null)?.messageId;
    if (typeof id !== "string" || !id) return;
    const t = deps.repo.table("outbound_messages");
    const row = await t.get(id);
    // Markeringen före ett 46elks-anrop tas bort – orsaken säger att det är osäkert om utskicket gick iväg.
    const pending = row?.providerMessageId === PENDING_PROVIDER_ID ? { providerMessageId: null } : {};
    if (row && row.status === "queued") await t.update(id, { status: "failed", statusReason: reason, ...pending });
    await forgetSecretBody(job, deps, id);
  },
};
