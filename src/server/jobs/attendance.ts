// Automatisk närvaro i jobbkörningen (Karims beslut 1, 2026-10-09): ett jobb per dag (auto_attendance) som kör
// runAutoAttendance (src/features/_shared/auto-attendance.ts) med ctx.system efter dagens slut.
//
// Jobbet läggs före varje jobbkörning (cron varje minut och after()) när dagens klockslag har passerat – organisationens
// inställning attendance.autoPresentAt (standard 18:00 Stockholmstid, appens klocka: testtiden i testmiljön). Samma id för hela
// dagen gör att det körs en gång per dag; två samtidiga körningar kan båda försöka lägga det – den andra får ett dubblettfel som
// ignoreras. Jobbet läggs före rapportjobbet och har ett id som sorteras före det (mm.claim_jobs: run_after, id), och dagens
// körning söndag tar hela veckan – så föregående vecka är komplett när veckorapporten skapas måndag 00.00. Blir jobbet sent
// publiceras veckorapporten ändå när närvaron blir komplett (publishWeeklyIfComplete).
// Golvet: testmiljöns automatiska körningar räknar bara dagar som slutade efter testklockans start (testdatat är komplett
// dit). Produktionen och "Kör nu" (payload.manual): inget golv.
import type { Ctx } from "@/api/server";
import { dayOf, type LocalDateTime } from "@/core/time";
import type { Repo } from "@/data/repo";
import type { Job, OrgSettingsRow } from "@/data/schema";
import { autoAttendanceTime, runAutoAttendance } from "@/features/_shared/auto-attendance";
import { JobError } from "./errors";
import type { JobHandler } from "./runner";

export const AUTO_ATTENDANCE_JOB = "auto_attendance";

/** Jobbets id för dagen: "job-auto_attendance-2027-02-01". */
export const autoAttendanceJobId = (now: LocalDateTime): string => `job-${AUTO_ATTENDANCE_JOB}-${dayOf(now)}`;

const isDuplicate = (e: unknown): boolean => !!e && typeof e === "object" && (e as { code?: unknown }).code === "23505";

/**
 * Lägg dagens jobb om klockslaget har passerat och det saknas. Klockslaget: det tidigaste bland organisationerna som har
 * automatisk närvaro påslagen (en organisation i dag). Ingen organisation med automatisk närvaro: inget jobb.
 * Returnerar true om jobbet lades nu.
 */
export async function ensureAutoAttendanceJob(repo: Repo<{ jobs: Job; org_settings: OrgSettingsRow }>, now: LocalDateTime): Promise<boolean> {
  const at = autoAttendanceTime(await repo.table("org_settings").list());
  if (!at) return false;
  const runAfter = `${dayOf(now)}T${at}`;
  if (now < runAfter) return false;
  const jobs = repo.table("jobs");
  const id = autoAttendanceJobId(now);
  if (await jobs.get(id)) return false;
  try {
    await jobs.insert({ id, kind: AUTO_ATTENDANCE_JOB, payload: {}, status: "queued", attempts: 0, runAfter, lastError: null, createdAt: now, createdBy: null, finishedAt: null });
    return true;
  } catch (e) {
    if (isDuplicate(e)) return false;
    throw e;
  }
}

/** Det jobbet behöver: en Ctx för systemsteg (service role, appens klocka) och golvet. Byggs först när jobbet körs. */
export type AutoAttendanceDeps = { autoAttendance?: () => Promise<{ ctx: Ctx; floor: LocalDateTime | null }> };

/** Jobbet: kör runAutoAttendance. Utfallet är antalet registrerade tillfällen – inga id:n eller namn. */
export function autoAttendanceHandler<D extends AutoAttendanceDeps>(): JobHandler<D> {
  return {
    async run(job, d) {
      if (!d.autoAttendance) throw new JobError("Närvaron kan inte registreras automatiskt här", { retryable: false });
      const { ctx, floor } = await d.autoAttendance();
      const manual = (job.payload as { manual?: unknown } | null)?.manual === true;
      const res = await runAutoAttendance(ctx, { floor: manual ? null : floor, manual });
      return res.registered ? `registered:${res.registered}` : "none";
    },
  };
}
