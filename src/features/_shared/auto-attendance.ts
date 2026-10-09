// Automatisk närvaro (Karims beslut 1, 2026-10-09). Bara för systemsteg – importeras aldrig av skärmar.
//
// Körs av:
//   - jobbet auto_attendance i testmiljön och produktionen (src/server/jobs/attendance.ts) en gång per dag efter dagens slut
//     (organisationens klockslag, standard 18:00), före rapportjobbet så att föregående vecka är komplett när veckorapporten
//     skapas måndag 00.00
//   - minnesläget och prototypen (src/data/memory-runtime.ts) när demoklockan passerar dagens slut – före rapportutkasten
//   - "Kör nu" på Underbiträden och integrationer (admin.runJob, nyckeln auto_attendance): minnesläget kör direkt, supabase-läget
//     lägger ett jobb. En manuell körning har inget golv (som produktionen).
//
// Reglerna finns i src/core/auto-attendance.ts. ctx.system används för allt (systemsteg utan användare, motsvarar service
// role): raderna skrivs med källan "auto" och registeredBy "system" – RLS låter bara servern skriva sådana rader. Funktionen
// är idempotent: en rad som redan finns (också en som en coach hann registrera mellan läsningen och skrivningen – den unika
// nyckeln på attendance.activity_id) hoppas över och skrivs aldrig över. En loggrad per avtal och körning: antal och id:n,
// aldrig namn. Veckorapporter där all närvaro nu är registrerad publiceras som vid manuell registrering.
import type { Ctx } from "@/api/server";
import { autoAttendanceDue, autoAttendanceFrom, sentWeekKey } from "@/core/auto-attendance";
import { autoAttendanceOf, type OrgSettings } from "@/core/config";
import { dayOf, isoWeek, type LocalDateTime } from "@/core/time";
import { uniq } from "@/core/util";
import { UniqueError } from "@/data/repo";
import type { WeekKey } from "@/data/schema";
import { orgSettingsFor } from "./context";
import { publishWeeklyIfComplete } from "./weekly";

/** registeredBy på en automatisk rad. */
export const AUTO_ATTENDANCE_BY = "system";

/**
 * Klockslaget då jobbet körs: det tidigaste bland organisationerna som har automatisk närvaro påslagen (en organisation i dag).
 * Inga inställningar: standardvärdet. null = ingen organisation har automatisk närvaro.
 */
export function autoAttendanceTime(rows: readonly { settings: OrgSettings }[]): string | null {
  const on = (rows.length ? rows.map((r) => autoAttendanceOf(r.settings)) : [autoAttendanceOf(null)]).filter((x) => x.autoPresent);
  return on.length ? on.map((x) => x.autoPresentAt).sort()[0] : null;
}

export type AutoAttendanceRun = {
  /** Per avtal som gicks igenom: antal och id:n (inga namn). */
  contracts: { contractId: string; registered: number; activityIds: string[] }[];
  registered: number;
  /** Veckorapporter som publicerades för att närvaron blev komplett. */
  published: number;
};

export async function runAutoAttendance(ctx: Ctx, opts: { floor?: LocalDateTime | null; manual?: boolean } = {}): Promise<AutoAttendanceRun> {
  const s = ctx.system;
  const now = ctx.now();
  const from = autoAttendanceFrom(now);
  const run: AutoAttendanceRun = { contracts: [], registered: 0, published: 0 };
  const contracts = await s.table("contracts").list({ status: "active" }, { orderBy: "id" });
  if (!contracts.length) return run;
  // Tillfällen från måndag förra veckan till nu (alla avtal) – avtalet avgörs av ärendet.
  const [activities, holidays] = await Promise.all([
    s.table("activities").list({ startsAt: { gte: `${from}T00:00`, lte: now } }),
    s.table("holidays").list({ date: { gte: from, lte: dayOf(now) } }),
  ]);
  const holidaySet = new Set(holidays.map((h) => h.date));
  const weeks = uniq([isoWeek(from).key, isoWeek(dayOf(now)).key]);
  for (const contract of contracts) {
    const settings = autoAttendanceOf(await orgSettingsFor(ctx, contract));
    if (!settings.autoPresent) continue;
    const cases = await s.table("cases").list({ contractId: contract.id, status: "active" });
    const caseIds = new Set(cases.map((c) => c.id));
    const acts = activities.filter((a) => caseIds.has(a.caseId));
    const registered = acts.length ? await s.table("attendance").pick(["activityId"], { activityId: { in: acts.map((a) => a.id) } }) : [];
    const sent = await s.table("reports").pick(["recipientUserId", "week", "status", "deliveredAt"], { contractId: contract.id, kind: "weekly_attendance", week: { in: weeks } });
    const due = autoAttendanceDue({
      now, at: settings.autoPresentAt, cases, activities: acts, registered: new Set(registered.map((r) => r.activityId)), holidays: holidaySet,
      sentWeeks: new Set(sent.filter((r) => r.recipientUserId && (r.deliveredAt || r.status === "delivered" || r.status === "opened")).map((r) => sentWeekKey(contract.id, r.recipientUserId as string, r.week as WeekKey))),
      floor: opts.floor ?? null,
    });
    const written: typeof due = [];
    const attendanceIds: string[] = [];
    for (const d of due) {
      const id = ctx.newId("at");
      try {
        await s.table("attendance").insert({
          id, activityId: d.activityId, caseId: d.caseId, status: "present", reason: "", registeredBy: AUTO_ATTENDANCE_BY, registeredAt: now, customerNotifiedAt: null, source: "auto",
        });
      } catch (e) {
        // Någon registrerade tillfället mellan läsningen och skrivningen: den raden gäller – ingenting skrivs över.
        if (e instanceof UniqueError || (e as { code?: unknown })?.code === "23505") continue;
        throw e;
      }
      written.push(d);
      attendanceIds.push(id);
    }
    // En loggrad per avtal och körning: antal och id:n, aldrig namn. Kortets Historik hittar raden via details.caseIds.
    await ctx.audit({
      action: "attendance.auto_registered", entity: "attendance", entityId: null, contractId: contract.id,
      details: {
        count: written.length, activityIds: written.map((d) => d.activityId), attendanceIds, caseIds: uniq(written.map((d) => d.caseId)), days: uniq(written.map((d) => d.day)),
        dayEndsAt: settings.autoPresentAt, ...(opts.manual ? { manual: true } : {}),
      },
    });
    run.contracts.push({ contractId: contract.id, registered: written.length, activityIds: written.map((d) => d.activityId) });
    run.registered += written.length;
    // Veckorapporterna: en kontroll per handläggare och vecka bland de registrerade – i fast ordning.
    const keys = uniq(written.filter((d) => d.referrerId).map((d) => `${d.referrerId}|${d.weekKey}`)).sort();
    for (const k of keys) {
      const [referrerId, weekKey] = k.split("|");
      if (await publishWeeklyIfComplete(ctx, contract.id, referrerId, weekKey)) run.published++;
    }
  }
  return run;
}
