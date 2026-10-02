// Röstjobben i jobbkön (supabase-läget). Logiken är isomorf och finns i src/features/_shared/voice-jobs.ts – här kopplas
// den till jobbkörningen (runner.ts): felen blir JobError (nya försök vid nätverksfel och 429/5xx från AI-leverantören),
// och när jobbet ger upp markeras AI-körningen som misslyckad och ljudet gallras (senast efter 24 timmar).
// Gallringen (retention_audio, retention_transcripts) läggs som ett jobb per timme av ensureRetentionJobs.
import type { Ctx } from "@/api/server";
import type { LocalDateTime } from "@/core/time";
import type { Repo } from "@/data/repo";
import { DataError } from "@/data/supabase/repo";
import type { Job } from "@/data/schema";
import {
  failVoiceJob, runVoiceJob, toVoiceJobError, VOICE_JOB_KINDS, voiceErrorCodeFromText, VoiceJobError, type VoiceJobKind,
} from "@/features/_shared/voice-jobs";
import { JobError } from "./errors";
import { INTERRUPTED_REASON, MAX_ATTEMPTS, type JobHandler } from "./runner";

/**
 * Det röstjobben behöver: en Ctx för systemsteg (service role, AI, ljudlagring, klocka) – byggs först när den behövs.
 * Saknas den (t.ex. i utskickens tester) stoppas röstjobbet utan nya försök.
 */
export type VoiceDeps = { voice?: () => Ctx };

const ctxOf = (d: VoiceDeps): Ctx => {
  if (!d.voice) throw new JobError("Röstjobb kan inte köras här", { retryable: false });
  return d.voice();
};

/** Handler per röstjobb. */
export function voiceJobHandlers<D extends VoiceDeps>(): Record<VoiceJobKind, JobHandler<D>> {
  const out = {} as Record<VoiceJobKind, JobHandler<D>>;
  for (const kind of VOICE_JOB_KINDS) {
    out[kind] = {
      async run(job, d) {
        const ctx = ctxOf(d);
        try {
          return await runVoiceJob(ctx, kind, job.payload);
        } catch (e) {
          const err = toVoiceJobError(e);
          const last = !err.retryable || job.attempts >= MAX_ATTEMPTS;
          // Sista försöket: körningen markeras här, med AI-anropens mätvärden (onGiveUp får bara felets text).
          if (last) await failVoiceJob(ctx, kind, job.payload, err);
          throw new JobError(err.message, { retryable: err.retryable });
        }
      },
      async onGiveUp(job, reason, d) {
        // Avbrutet vid tidsgränsen även i sista försöket: för transkribering är inspelningen för lång för serverns tidsgräns.
        const code = reason === INTERRUPTED_REASON ? (kind.startsWith("transcribe_") ? "audio_too_large" : "provider_unavailable") : voiceErrorCodeFromText(reason);
        // Idempotent: failVoiceJob rör bara körningar som fortfarande pågår.
        if (d.voice) await failVoiceJob(d.voice(), kind, job.payload, new VoiceJobError(code));
      },
    };
  }
  return out;
}

// ---------------------------------------------------------------- Gallringen varje timme
export const RETENTION_JOB_KINDS = ["retention_audio", "retention_transcripts"] as const satisfies readonly VoiceJobKind[];

/** Jobbets id för timmen: "job-retention_audio-2027-02-01T09" – samma id gör att jobbet bara läggs en gång per timme. */
export const retentionJobId = (kind: (typeof RETENTION_JOB_KINDS)[number], now: LocalDateTime): string => `job-${kind}-${now.slice(0, 13)}`;

/**
 * Lägg timmens gallringsjobb om de inte redan finns. Anropas före varje jobbkörning (cron varje minut och after()).
 * Två samtidiga körningar kan båda försöka – den andra får ett dubblettfel som ignoreras.
 */
export async function ensureRetentionJobs(repo: Repo<{ jobs: Job }>, now: LocalDateTime): Promise<number> {
  const jobs = repo.table("jobs");
  let added = 0;
  for (const kind of RETENTION_JOB_KINDS) {
    const id = retentionJobId(kind, now);
    if (await jobs.get(id)) continue;
    try {
      await jobs.insert({ id, kind, payload: {}, status: "queued", attempts: 0, runAfter: now, lastError: null, createdAt: now, createdBy: null, finishedAt: null });
      added++;
    } catch (e) {
      if (e instanceof DataError && e.code === "23505") continue;
      throw e;
    }
  }
  return added;
}
