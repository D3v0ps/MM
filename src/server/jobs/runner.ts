// Bakgrundsjobben (tabellen jobs). Körs av POST /api/jobs/run (cron varje minut) och direkt efter en förfrågan som lagt
// ett utskick (after() i src/server/notify). Rena regler, databasen skickas in (JobStore) så att allt går att testa.
//   - mm.claim_jobs(n) hämtar jobb med FOR UPDATE SKIP LOCKED: två körningar tar aldrig samma jobb
//   - lyckat jobb -> done · fel som är värda att försöka igen -> queued med väntetid · annars (eller sista försöket) -> failed
//   - ett jobb som avbröts mitt i (serverfunktionens tidsgräns, maxDuration 60 s) står kvar i running; efter STALE_MINUTES
//     hämtas det igen och tar upp arbetet på nytt. Avbröts även sista försöket ger jobbet upp (failed, INTERRUPTED_REASON)
//     – inget jobb blir hängande i running för evigt
//   - felorsaken sparas i last_error, utan personuppgifter (errors.ts)
//   - jobben ska själva vara idempotenta (send_message hoppar över utskick som redan är skickade)
import { addMinutes, type LocalDateTime } from "@/core/time";
import type { JobRow } from "../notify/types";
import { isRetryable, safeErrorText } from "./errors";

export type JobHandler<C> = {
  /** Kör jobbet. Returnerar gärna ett kort utfall ("sent", "suppressed" …) till sammanfattningen. */
  run(job: JobRow, ctx: C): Promise<string | void>;
  /** När jobbet ger upp (sista försöket eller fel som inte är värt att försöka igen). */
  onGiveUp?(job: JobRow, reason: string, ctx: C): Promise<void>;
};

export type JobPatch = Partial<Pick<JobRow, "status" | "lastError" | "finishedAt" | "runAfter">>;

export interface JobStore {
  /** Hämta upp till n jobb att köra (status running, attempts ökat). */
  claim(n: number, now: LocalDateTime, maxAttempts: number): Promise<JobRow[]>;
  finish(id: string, patch: JobPatch): Promise<void>;
}

/** Högst så många försök per jobb (samma som standardvärdet i mm.claim_jobs). */
export const MAX_ATTEMPTS = 5;
/**
 * Ett jobb som stått i running längre än så har avbrutits (funktionen stoppades vid maxDuration, 60 s) och hämtas igen.
 * Ska vara längre än rutternas maxDuration – höjs den (Vercel Pro, 300 s) ska det här höjas till minst 10 minuter.
 */
export const STALE_MINUTES = 5;
/** Felorsaken när även sista försöket avbröts mitt i (tidsgränsen). Inga personuppgifter. */
export const INTERRUPTED_REASON = "Jobbet avbröts innan det blev klart (serverns tidsgräns) – inga fler försök";
/** Väntetid i minuter före försök 2, 3, 4 och 5. */
export const RETRY_MINUTES = [1, 5, 15, 60] as const;
export const retryDelayMinutes = (attempt: number): number => RETRY_MINUTES[Math.min(Math.max(attempt, 1), RETRY_MINUTES.length) - 1];

export type RunOpts<C> = {
  store: JobStore;
  handlers: Readonly<Record<string, JobHandler<C>>>;
  ctx: C;
  /** Appens klocka (testtid i testmiljön). */
  now: LocalDateTime;
  /** Högst så många jobb per körning. */
  limit?: number;
  /** Så många jobb hämtas åt gången. */
  batchSize?: number;
  maxAttempts?: number;
  /** Hämta inga fler jobb när körningen pågått så här länge (millisekunder). */
  budgetMs?: number;
  elapsedMs?: () => number;
  /** Paus mellan jobben (t.ex. Resends gräns för anrop per sekund). */
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type RunSummary = {
  claimed: number;
  done: number;
  retried: number;
  failed: number;
  /** Jobb som inte kunde avslutas (t.ex. databasfel) – de hämtas igen efter en stund. */
  errors: number;
  /** Utfall per jobbtyp, t.ex. { "send_message:sent": 2, "send_message:suppressed": 1 }. */
  outcomes: Record<string, number>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runJobs<C>(o: RunOpts<C>): Promise<RunSummary> {
  const limit = Math.max(0, o.limit ?? 20);
  const batchSize = Math.max(1, o.batchSize ?? 5);
  const maxAttempts = o.maxAttempts ?? MAX_ATTEMPTS;
  const budgetMs = o.budgetMs ?? 20_000;
  const elapsed = o.elapsedMs ?? (() => 0);
  const sleep = o.sleep ?? defaultSleep;
  const sum: RunSummary = { claimed: 0, done: 0, retried: 0, failed: 0, errors: 0, outcomes: {} };
  let first = true;

  while (sum.claimed < limit && elapsed() < budgetMs) {
    // maxAttempts + 1: köade jobb har alltid färre än maxAttempts försök (runOne lägger bara tillbaka dem då), så det enda
    // som tillkommer är jobb vars sista försök avbröts mitt i och som fastnat i running – de ges upp i runOne.
    const batch = await o.store.claim(Math.min(batchSize, limit - sum.claimed), o.now, maxAttempts + 1);
    if (!batch.length) break;
    sum.claimed += batch.length;
    for (const job of batch) {
      if (!first && o.pauseMs) await sleep(o.pauseMs);
      first = false;
      try {
        await runOne(o, job, sum, maxAttempts);
      } catch {
        // Statusen kunde inte sparas. Jobbet står kvar som running och hämtas igen av mm.claim_jobs efter en stund.
        sum.errors++;
      }
    }
  }
  return sum;
}

async function runOne<C>(o: RunOpts<C>, job: JobRow, sum: RunSummary, maxAttempts: number): Promise<void> {
  const handler = o.handlers[job.kind];
  if (job.attempts > maxAttempts) {
    // Sista försöket avbröts (t.ex. tidsgränsen) och jobbet hämtades igen som fastnat: ge upp i stället för att köra en gång till.
    try {
      await handler?.onGiveUp?.(job, INTERRUPTED_REASON, o.ctx);
    } catch {
      // Jobbet markeras som misslyckat ändå.
    }
    await o.store.finish(job.id, { status: "failed", lastError: INTERRUPTED_REASON, finishedAt: o.now });
    sum.failed++;
    return;
  }
  if (!handler) {
    await o.store.finish(job.id, { status: "failed", lastError: "Okänd jobbtyp", finishedAt: o.now });
    sum.failed++;
    return;
  }
  let outcome: string | void;
  try {
    outcome = await handler.run(job, o.ctx);
  } catch (e) {
    const reason = safeErrorText(e);
    if (isRetryable(e) && job.attempts < maxAttempts) {
      await o.store.finish(job.id, { status: "queued", lastError: reason, runAfter: addMinutes(o.now, retryDelayMinutes(job.attempts)) });
      sum.retried++;
      return;
    }
    try {
      await handler.onGiveUp?.(job, reason, o.ctx);
    } catch {
      // Jobbet markeras som misslyckat ändå – felorsaken står i jobs.last_error.
    }
    await o.store.finish(job.id, { status: "failed", lastError: reason, finishedAt: o.now });
    sum.failed++;
    return;
  }
  await o.store.finish(job.id, { status: "done", lastError: null, finishedAt: o.now });
  sum.done++;
  const key = `${job.kind}:${outcome || "done"}`;
  sum.outcomes[key] = (sum.outcomes[key] ?? 0) + 1;
}
