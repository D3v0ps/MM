// Rapportutkasten i jobbkörningen (testmiljön och produktionen): ett jobb per tiominutersperiod som kör ensureReports
// (src/features/rapporter/ensure.ts) med ctx.system och appens klocka (testtiden i testmiljön). Jobbet läggs före varje
// jobbkörning (cron varje minut och after()) om det saknas – samma id för hela tiominutersperioden gör att funktionen körs
// högst var tionde minut. Två samtidiga körningar kan båda försöka lägga jobbet – den andra får ett dubblettfel som ignoreras.
// Funktionen är idempotent, så ett nytt försök efter ett fel skapar bara det som fattas.
//
// Var körningarna har kommit sparas i app_settings och läses utan cache när jobbet körs (reportScheduleState):
//   report_schedule_checked:<avtal>  högvattenmärket – appens klocka vid den senaste körningen där hela avtalet gicks igenom
//   golvet                           testklockans start (clock_demo_epoch) i testmiljön: testdatat är komplett dit, så inget
//                                    skapas på nyinläst testdata – inte heller medan "Läs in testdata på nytt" pågår, eftersom
//                                    mm.reset_test_data() sätter om klockan i samma transaktion som tabellerna töms (klockan
//                                    står då på testklockans start, och ingen period slutar mellan golvet och klockan).
//                                    Produktionen: inget golv.
import type { Ctx } from "@/api/server";
import type { LocalDateTime } from "@/core/time";
import type { Repo } from "@/data/repo";
import type { Job } from "@/data/schema";
import { DataError, type PgError } from "@/data/supabase/repo";
import { ensureReports, type ReportScheduleState } from "@/features/rapporter/ensure";
import { parseDemoEpoch, type ClockSettings } from "../clock";
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

// ---------------------------------------------------------------- Högvattenmärket och golvet (app_settings)
/** Nyckeln i app_settings för avtalets högvattenmärke. */
export const reportMarkKey = (contractId: string): string => `report_schedule_checked:${contractId}`;

/** Den del av supabase-js som används för app_settings (fejkas i testet). Bara service role läser och skriver tabellen. */
export interface AppSettingsClient {
  from(table: "app_settings"): {
    upsert(values: { key: string; value: string }, options: { onConflict: string }): PromiseLike<{ error: PgError | null }>;
  };
}

/**
 * Läget för en körning: golvet från testklockan (testmiljön) och högvattenmärkena från app_settings-raderna (lästa utan cache
 * när jobbet startar). markChecked skriver märket direkt, så att ett senare fel i ett annat avtal inte gör om det här.
 */
export function reportScheduleState(db: AppSettingsClient, rows: readonly { key: string; value: unknown }[], clock: ClockSettings): ReportScheduleState {
  const marks = new Map<string, LocalDateTime>();
  for (const r of rows) {
    const contractId = r.key.startsWith("report_schedule_checked:") ? r.key.slice("report_schedule_checked:".length) : null;
    const at = contractId ? parseDemoEpoch(r.value == null ? null : String(r.value)) : null;
    if (contractId && at) marks.set(contractId, at);
  }
  return {
    floor: clock.mode === "test" ? clock.demoEpoch : null,
    checkedThrough: async (contractId) => marks.get(contractId) ?? null,
    markChecked: async (contractId, at) => {
      const { error } = await db.from("app_settings").upsert({ key: reportMarkKey(contractId), value: at }, { onConflict: "key" });
      if (error) throw new DataError("app_settings", String(error.code ?? ""));
      marks.set(contractId, at);
    },
  };
}

// ---------------------------------------------------------------- Jobbet
/** Det jobbet behöver: en Ctx för systemsteg (service role, appens klocka) och läget. Byggs först när jobbet körs. */
export type ReportDeps = { reportSchedule?: () => Promise<{ ctx: Ctx; state: ReportScheduleState }> };

/** Jobbet: kör ensureReports. Utfallet är "created" eller "none" – inga id:n eller namn. */
export function reportScheduleHandler<D extends ReportDeps>(): JobHandler<D> {
  return {
    async run(_job, d) {
      if (!d.reportSchedule) throw new JobError("Rapportutkasten kan inte skapas här", { retryable: false });
      const { ctx, state } = await d.reportSchedule();
      const res = await ensureReports(ctx, state);
      return res.created.length ? "created" : "none";
    },
  };
}
