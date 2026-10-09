// Timjobb som kom med självregistreringen och bilagorna (beslut 2026-10-07):
//   attachments_retention  städningen av bilagor (src/features/_shared/attachment-retention.ts): uppladdningar som aldrig
//                          kopplades till en beställning efter 24 timmar, och filer i bucketen utan levande rad (avstämningen).
//                          Bilagor i ett ärende gallras aldrig automatiskt (beslut 5, 2026-10-08).
//   auth_cleanup           Auth-användare som skapades när en kod skickades till en ny adress (självregistrering) men där koden
//                          aldrig prövades – ingen profil – raderas efter 24 timmar. Bara antalet loggas.
// Jobben läggs en gång per timme före varje jobbkörning (samma id för timmen, som gallringen av ljud i voice.ts).
import type { Ctx } from "@/api/server";
import type { LocalDateTime } from "@/core/time";
import type { Repo } from "@/data/repo";
import type { Job } from "@/data/schema";
import { DataError } from "@/data/supabase/repo";
import { runAttachmentRetention } from "@/features/_shared/attachment-retention";
import { JobError } from "./errors";
import type { JobHandler } from "./runner";

export const ATTACHMENTS_RETENTION_JOB = "attachments_retention";
export const AUTH_CLEANUP_JOB = "auth_cleanup";
const HOURLY = [ATTACHMENTS_RETENTION_JOB, AUTH_CLEANUP_JOB] as const;

/** Jobbets id för timmen: "job-attachments_retention-2027-02-01T09". */
export const hourlyJobId = (kind: (typeof HOURLY)[number], now: LocalDateTime): string => `job-${kind}-${now.slice(0, 13)}`;

/** Lägg timmens jobb om de saknas. Två samtidiga körningar kan båda försöka – den andra får ett dubblettfel som ignoreras. */
export async function ensureHourlyJobs(repo: Repo<{ jobs: Job }>, now: LocalDateTime): Promise<number> {
  const jobs = repo.table("jobs");
  let added = 0;
  for (const kind of HOURLY) {
    const id = hourlyJobId(kind, now);
    if (await jobs.get(id)) continue;
    try {
      await jobs.insert({ id, kind, payload: {}, status: "queued", attempts: 0, runAfter: now, lastError: null, createdAt: now, createdBy: null, finishedAt: null });
      added++;
    } catch (e) {
      if (e instanceof DataError && e.code === "23505") continue;
      if ((e as { code?: unknown })?.code === "23505") continue;
      throw e;
    }
  }
  return added;
}

/** Det jobben behöver: en Ctx för systemsteg med bilagornas lagring, och städningen av Auth-användare. Byggs när jobbet körs. */
export type AttachmentJobDeps = { attachmentsCtx?: () => Ctx; authCleanup?: () => Promise<number> };

export function attachmentJobHandlers<D extends AttachmentJobDeps>(): Record<string, JobHandler<D>> {
  return {
    [ATTACHMENTS_RETENTION_JOB]: {
      async run(_job, d) {
        if (!d.attachmentsCtx) throw new JobError("Bilagornas städning kan inte köras här", { retryable: false });
        const r = await runAttachmentRetention(d.attachmentsCtx());
        const n = r.unlinked + r.orphans;
        return n > 0 ? `deleted:${n}` : "none";
      },
    },
    [AUTH_CLEANUP_JOB]: {
      async run(_job, d) {
        if (!d.authCleanup) throw new JobError("Städningen av konton kan inte köras här", { retryable: false });
        const n = await d.authCleanup();
        return n > 0 ? `deleted:${n}` : "none";
      },
    },
  };
}

// ---------------------------------------------------------------- Auth-användare utan profil
/** Den del av supabase-js som städningen använder (fejkas i testet). */
export interface AuthAdminLike {
  listUsers(params: { page: number; perPage: number }): PromiseLike<{ data: { users: { id: string; email?: string | null; created_at: string }[] } | null; error: unknown }>;
  deleteUser(id: string): PromiseLike<{ error: unknown }>;
}
/** Hur länge en Auth-användare utan profil får finnas (koden gäller 10 minuter – ett dygn är gott om tid). */
export const AUTH_ORPHAN_HOURS = 24;

/**
 * Radera Auth-användare utan profil som är äldre än ett dygn (riktig tid – Auth har riktiga tider). hasProfile avgör om en
 * användare hör till en profil (auth_user_id eller e-postadressen). Returnerar antalet raderade.
 */
export async function deleteOrphanAuthUsers(admin: AuthAdminLike, hasProfile: (u: { id: string; email: string }) => Promise<boolean>, nowMs: number): Promise<number> {
  let removed = 0;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error || !data) throw new JobError("Kontona kunde inte läsas", { retryable: true });
    for (const u of data.users) {
      const created = Date.parse(u.created_at);
      if (!Number.isFinite(created) || nowMs - created < AUTH_ORPHAN_HOURS * 3600_000) continue;
      if (await hasProfile({ id: u.id, email: String(u.email ?? "").toLowerCase() })) continue;
      const del = await admin.deleteUser(u.id);
      if (!del.error) removed++;
    }
    if (data.users.length < 200) break;
  }
  return removed;
}
