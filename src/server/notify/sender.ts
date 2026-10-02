// Skicka ett utskick som ligger i kön (jobbet send_message). Idempotent:
//   - bara utskick med status queued skickas – ett utskick som redan är skickat eller stoppat hoppas över
//   - Resend får utskickets id som Idempotency-Key, så att ett nytt försök (t.ex. efter att statusen inte hann sparas)
//     inte blir ett andra mejl
// Spärrarna (decision.ts) kontrolleras igen precis innan mejlet skickas. Inget loggas med adress eller text.
// Engångslänkar: utskicksloggen har länken utan token ("/rost/•••••"), och hela texten ligger i jobbets payload (body) tills
// utskicket är avgjort (skickat, stoppat eller misslyckat) – då tas den bort ur jobbet (queue.ts, src/core/link-tokens.ts).
import type { LocalDateTime } from "@/core/time";
import { JobError } from "../jobs/errors";
import { deliveryDecision, REASON, type RecipientGate } from "./decision";
import { intendedRecipient, redirectNote } from "./redirect";
import { renderEmail, type RenderConfig } from "./render";
import { sendViaResend, type FetchLike, type ResendConfig } from "./resend";
import type { DeliveryStatus, JobRow, NotifyRepo } from "./types";

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
};

export type DeliveryOutcome = Exclude<DeliveryStatus, "queued" | "failed"> | "skipped" | "missing";

/**
 * Skicka utskicket. `body` = hela texten med engångslänkens token (jobbets payload), annars utskicksloggens text.
 * Spärrarna prövas mot utskicksloggens text (token är maskerad där – en slumpad token kan inte se ut som ett personnummer).
 */
export async function deliverMessage(deps: SenderDeps, messageId: string, body?: string | null): Promise<DeliveryOutcome> {
  const t = deps.repo.table("outbound_messages");
  const row = await t.get(messageId);
  if (!row) return "missing";
  if (row.status !== "queued") return "skipped";

  const decision = deliveryDecision(row, deps.gate);
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
  const to = redirected ? decision.to : row.to.trim();
  const res = await sendViaResend(deps.fetch, deps.resend, { ...mail, to, idempotencyKey: row.id, template: row.template });
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

/** Ta bort hela texten ur jobbet när utskicket är avgjort – token ska bara finnas så länge den behövs. */
async function forgetSecretBody(job: JobRow, deps: SenderDeps, messageId: string): Promise<void> {
  if (secretBodyOf(job)) await deps.repo.table("jobs").update(job.id, { payload: { messageId } });
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
    if (row && row.status === "queued") await t.update(id, { status: "failed", statusReason: reason });
    await forgetSecretBody(job, deps, id);
  },
};
