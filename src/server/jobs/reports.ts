// Rapportutkasten i jobbkörningen (testmiljön och produktionen): ett jobb per tiominutersperiod som kör ensureReports
// (src/features/rapporter/ensure.ts) med ctx.system och appens klocka (testtiden i testmiljön). Jobbet läggs före varje
// jobbkörning (cron varje minut och after()) om det saknas – samma id för hela tiominutersperioden gör att funktionen körs
// högst var tionde minut. Två samtidiga körningar kan båda försöka lägga jobbet – den andra får ett dubblettfel som ignoreras.
// Funktionen är idempotent, så ett nytt försök efter ett fel skapar bara det som fattas.
import type { Ctx } from "@/api/server";
import type { LocalDateTime } from "@/core/time";
import type { Repo } from "@/data/repo";
import type { Job } from "@/data/schema";
import { ensureReports } from "@/features/rapporter/ensure";
import { JobError } from "./errors";
import type { JobHandler } from "./runner";

export const REPORT_SCHEDULE_JOB = "report_schedule";

/** Jobbets id för tiominutersperioden: "job-report_schedule-2027-02-01T09:1" (09.10–09.19). */
export const reportScheduleJobId = (now: LocalDateTime): string => `job-${REPORT_SCHEDULE_JOB}-${now.slice(0, 15)}`;

const isDuplicate = (e: unknown): boolean => !!e && typeof e === "object" && (e as { code?: unknown }).code === "23505";

/** Lägg periodens jobb om det inte redan finns. Returnerar true om jobbet lades nu. */
export async function ensureReportScheduleJob(repo: Repo<{ jobs: Job }>, now: LocalDateTime): Promise<boolean> {
  const jobs = repo.table("jobs");
  const id = reportScheduleJobId(now);
  if (await jobs.get(id)) return false;
  try {
    await jobs.insert({ id, kind: REPORT_SCHEDULE_JOB, payload: {}, status: "queued", attempts: 0, runAfter: now, lastError: null, createdAt: now, createdBy: null, finishedAt: null });
    return true;
  } catch (e) {
    if (isDuplicate(e)) return false;
    throw e;
  }
}

/** Det jobbet behöver: en Ctx för systemsteg (service role, appens klocka). Byggs först när jobbet körs. */
export type ReportDeps = { system?: () => Ctx };

/** Jobbet: kör ensureReports. Utfallet är "created" eller "none" – inga id:n eller namn. */
export function reportScheduleHandler<D extends ReportDeps>(): JobHandler<D> {
  return {
    async run(_job, d) {
      if (!d.system) throw new JobError("Rapportutkasten kan inte skapas här", { retryable: false });
      const res = await ensureReports(d.system());
      return res.created.length ? "created" : "none";
    },
  };
}
