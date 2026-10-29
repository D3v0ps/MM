// Ändra startdatum (Karims beslut 2026-10-29): det som görs efter att ändringen sparats (ärendet har redan det nya startdatumet).
// Används av hanteraren arenden.andraStartdatum (src/features/arenden/start-handlers.ts) och av rapportjobbet (report_schedule,
// src/server/jobs/reports.ts, och minnesläget src/data/memory-runtime.ts) som gör klart en ändring som inte blev klar. Bara för
// hanterare och jobb – importeras aldrig av skärmar.
//
// Stegen (finishStartChange), räknade ur dagens data så att de kan göras om:
//   a. tillfällena före det nya startdatumet utan närvaro eller med bara automatisk närvaro tas bort (den automatiska raden av
//      servern, ctx.system – bara systemet skriver och tar bort automatisk närvaro; tillfället via behörigheten). Rader i
//      gruppaktiviteter som bjöds in för hand loggas på aktiviteten; kommande rader som målgruppen bjöd in tar synkningen i
//      steg f bort (med aktivitetens vanliga meddelande till deltagaren – tid och plats).
//   b. en månad som med det nya startdatumet får för få inskrivna dagar för en månadsrapport (startChangeDroppedMonths) blir utan
//      månadsrapport och månadsbedömning: utkasten (rapporten, bedömningen och planen) tas bort av servern – rapportjobbet
//      skapade dem. En lämnad eller godkänd rapport och en godkänd bedömning stoppade ändringen i kontrollen.
//   c. månadsbedömningarnas förifyllda närvaro följer de borttagna tillfällena (refreshPrefillAfterAttendance).
//   d. rapporter som redan är lämnade till kommunen för dagarna som ändringen rör: samordnaren får en uppgift att rätta dem
//      (tasks, kind report_correction – ärendenumret och perioderna, aldrig namn).
//   e. revisionsloggen case.start_date_changed (id:n och datum – aldrig motiveringen). Avbryts ett steg loggas det som hann göras
//      ändå (failed, felkoden – samma mönster som den automatiska närvaron) och svaret har incomplete.
//   f. inbjudningarna till kommande gruppaktiviteter med målgrupp (syncAudienceInvites).
// En ändring är klar när den har en loggrad utan failed (startChangeLogged). Ärendets senaste ändring som inte är klar görs klar
// av nästa ändring i ärendet (vem som helst som får ändra) och av rapportjobbet (finishStartChanges).
import type { Ctx } from "@/api/server";
import {
  activitiesBeforeStart, startChangeCorrections, startChangeDrafts, startChangeDroppedMonths, startChangeMinDays, startChangesInOrder, startCorrectionTaskText,
  type StartChangeCorrection, type StartChangeReports,
} from "@/core/start-date";
import { addMinutes, type LocalDateTime, type MonthKey } from "@/core/time";
import { uniq } from "@/core/util";
import { PolicyError } from "@/data/repo";
import type { AppRepo, Case, CaseStartChange, Report, Task } from "@/data/schema";
import { removeParticipantRow, syncAudienceInvites } from "../aktiviteter/audience-sync";
import { supersedeTasks } from "../aktiviteter/notify-all";
import { refreshPrefillAfterAttendance } from "../_shared/monthly-prefill";

/** Felets kod eller namn till loggen – aldrig meddelandet (det kan innehålla värden). */
const errorCode = (e: unknown): string => {
  const x = e as { code?: unknown; name?: unknown } | null;
  return typeof x?.code === "string" && x.code ? x.code : typeof x?.name === "string" && x.name ? x.name : "error";
};

/** Vad ändringen gjorde efter att den sparats (svaret och meddelandet på skärmen). */
export type Finished = {
  removed: number;
  autoAttendanceRemoved: number;
  groups: { invited: number; removed: number } | null;
  /** Månaderna som blev utan månadsrapport och månadsbedömning (utkasten togs bort). */
  droppedMonths: MonthKey[];
  /** Rapporter som redan är lämnade till kommunen och ska rättas (samordnaren har fått en uppgift). */
  corrections: number;
  /** Allt hann inte göras – resten görs klart av nästa ändring i ärendet eller rapportjobbet. */
  incomplete: boolean;
};

const REPORT_FIELDS = ["kind", "caseId", "recipientUserId", "week", "month", "status", "superseded"] as const satisfies readonly (keyof Report)[];
/**
 * Rapporternas läge: ärendets månadsrapporter, veckorapporterna till ärendets handläggare och ärendets månadsbedömningar – bara
 * id, typ, period och status (ingen text) – och avtalets minsta antal inskrivna dagar för en månadsrapport. ctx.system: kontrollen
 * ska svara likadant för coachen, samordnaren och avtalsansvarig (rapporternas läsrätt skiljer sig), och ingenting lämnas ut –
 * svaret säger bara vilken månad som stoppar och hur många rapporter som ska rättas.
 */
export async function reportsFor(ctx: Ctx, c: Case): Promise<StartChangeReports> {
  const s = ctx.system;
  const [monthly, weekly, assessments, contract] = await Promise.all([
    s.table("reports").pick(REPORT_FIELDS, { contractId: c.contractId, caseId: c.id, kind: "monthly" }),
    c.referrerId ? s.table("reports").pick(REPORT_FIELDS, { contractId: c.contractId, kind: "weekly_attendance", recipientUserId: c.referrerId }) : Promise.resolve([]),
    s.table("monthly_assessments").pick(["caseId", "month", "status"], { caseId: c.id }),
    s.table("contracts").get(c.contractId),
  ]);
  return { reports: [...monthly, ...weekly], assessments, minEnrolledDays: startChangeMinDays(contract?.config) };
}

/** Revisionsloggens rader för ändringen (ctx.system – bara id:n och datum). */
export const changeLogs = async (ctx: Ctx, caseId: string, changeId: string) =>
  (await ctx.system.table("audit_log").list({ entity: "case", entityId: caseId, action: "case.start_date_changed" })).filter((l) => l.details?.changeId === changeId);

/** Är ändringen klar: finns en loggrad för den utan failed (städningen gick igenom)? */
export async function startChangeLogged(ctx: Ctx, caseId: string, changeId: string): Promise<boolean> {
  return (await changeLogs(ctx, caseId, changeId)).some((l) => l.details?.failed !== true);
}

/** Tar bort raden; en rad som redan är borta (en samtidig städning) räknas inte. */
async function removeIfThere(repo: AppRepo, table: "attendance" | "reports" | "monthly_assessments" | "monthly_plans", id: string): Promise<boolean> {
  try {
    await repo.table(table).remove(id);
    return true;
  } catch (e) {
    if (e instanceof PolicyError && !(await repo.table(table).get(id))) return false;
    throw e;
  }
}

/**
 * Gör ändringen klar (ärendet har redan det nya startdatumet). Räknas fram ur dagens data, så att samma steg kan göras om av nästa
 * ändring i ärendet eller rapportjobbet. Kastar aldrig: avbryts ett steg loggas det som hann göras (failed, felkoden – aldrig
 * meddelandet) och svaret har incomplete. c = ärendet (fälten som inte ändras: id, avtal, ärendenummer, handläggare, status).
 * repo: ctx.repo (den som ändrar – tillfällena tas bort via behörigheten) eller ctx.system (rapportjobbet).
 */
export async function finishStartChange(ctx: Ctx, c: Case, change: CaseStartChange, repo: AppRepo = ctx.repo): Promise<Finished> {
  const removed: string[] = [];
  const autoRemoved: string[] = [];
  const kept: string[] = [];
  const removedStarts: LocalDateTime[] = [];
  const drafts = { reportIds: [] as string[], assessmentIds: [] as string[], planIds: [] as string[] };
  let dropped: MonthKey[] = [];
  let corrections: StartChangeCorrection[] = [];
  let taskId: string | null = null;
  let error: unknown = null;
  try {
    // a. Tillfällena före det nya startdatumet: de utan närvaro och de med bara automatisk närvaro tas bort. Ett tillfälle som fått
    //    närvaro registrerad av en människa under tiden ligger kvar (kept) – det loggas.
    const [activities, attendance] = await Promise.all([repo.table("activities").list({ caseId: c.id }), repo.table("attendance").list({ caseId: c.id })]);
    const { remove, blocked } = activitiesBeforeStart(c.id, change.toDate, activities, attendance);
    kept.push(...blocked.map((b) => b.activityId));
    const groupRows = new Map<string, string[]>();
    const now = ctx.now();
    const audienceRow = new Set(activities.filter((a) => a.inviteSource === "audience").map((a) => a.id));
    for (const r of remove) {
      // En kommande rad som målgruppen (nivån eller yrkesområdet) bjöd in tar synkningen bort i sista steget – med samma meddelande
      // till deltagaren som när nivån eller yrkesområdet ändras (när aktiviteten har meddelanden påslagna) och samma logg.
      if (r.groupActivityId && r.startsAt > now && audienceRow.has(r.activityId)) continue;
      // Den automatiska närvaroraden skrevs av systemet (jobbet auto_attendance) och tas bort av systemet – användare tar aldrig
      // bort närvaro. Raden finns bara för tillfällen som tas bort här.
      if (r.attendanceId && (await removeIfThere(ctx.system, "attendance", r.attendanceId))) autoRemoved.push(r.attendanceId);
      const out = await removeParticipantRow(ctx, repo, r.activityId);
      if (out === "kept") {
        kept.push(r.activityId);
        continue;
      }
      if (out !== "removed") continue;
      removed.push(r.activityId);
      removedStarts.push(r.startsAt);
      if (r.groupActivityId) groupRows.set(r.groupActivityId, [...(groupRows.get(r.groupActivityId) ?? []), r.activityId]);
    }
    // Rader i gruppaktiviteter loggas också på aktiviteten (samma händelse som Ta bort i aktivitetsvyn), och uppgiften att ringa om
    // inbjudan stängs. Deltagaren får inget meddelande om en rad som coachen eller samordnaren bjöd in för hand (Ta bort i
    // aktivitetsvyn frågar om det – här finns ingen fråga): coachen berättar om ett kommande tillfälle försvinner.
    for (const [groupActivityId, activityIds] of groupRows) {
      const g = await repo.table("group_activities").get(groupActivityId);
      if (!g) continue;
      await ctx.audit({
        action: "group_activity.removed_participant", entity: "group_activity", entityId: g.id, contractId: g.contractId,
        details: { caseIds: [c.id], activityIds, via: "start_date_changed" },
      });
      await supersedeTasks(ctx, [c], g, "Startdatumet är ändrat – deltagaren är inte med i aktiviteten.");
    }
    // b. Månader som blir utan månadsrapport: utkasten till månadsrapport, månadsbedömning och plan tas bort (rapportjobbet skapade
    //    dem – ctx.system). En lämnad eller godkänd rapport och en godkänd bedömning stoppade ändringen i kontrollen.
    const reports = await reportsFor(ctx, c);
    dropped = startChangeDroppedMonths(c, change.fromDate, change.toDate, reports.minEnrolledDays);
    if (dropped.length) {
      const plans = await ctx.system.table("monthly_plans").pick(["caseId", "month", "status"], { caseId: c.id, month: { in: dropped } });
      const d = startChangeDrafts(c.id, dropped, { ...reports, plans });
      for (const id of d.reportIds) if (await removeIfThere(ctx.system, "reports", id)) drafts.reportIds.push(id);
      for (const id of d.assessmentIds) if (await removeIfThere(ctx.system, "monthly_assessments", id)) drafts.assessmentIds.push(id);
      for (const id of d.planIds) if (await removeIfThere(ctx.system, "monthly_plans", id)) drafts.planIds.push(id);
    }
    // c. Månadsbedömningarnas förifyllda närvaro följer de borttagna tillfällena (bästa försök – loggar själv, kastar aldrig).
    await refreshPrefillAfterAttendance(ctx, removedStarts.map((startsAt) => ({ caseId: c.id, contractId: c.contractId, startsAt })));
    // d. Rapporter som redan är lämnade till kommunen för dagarna som ändringen rör: samordnaren får en uppgift att rätta dem.
    corrections = startChangeCorrections(c, change.fromDate, change.toDate, reports.reports);
    if (corrections.length) taskId = await correctionTask(ctx, c, change, corrections);
  } catch (e) {
    error = e;
  }
  // e. Revisionsloggen: id:n och datum – aldrig motiveringen. Också när ett steg avbröts (failed): det som hann göras står kvar.
  try {
    await ctx.audit({
      action: "case.start_date_changed", entity: "case", entityId: c.id, contractId: c.contractId,
      details: {
        caseId: c.id, changeId: change.id, noteId: change.noteId, seq: change.seq, from: change.fromDate, to: change.toDate,
        removedActivityIds: removed, removedAutoAttendanceIds: autoRemoved,
        ...(kept.length ? { keptActivityIds: uniq(kept) } : {}),
        ...(dropped.length ? { droppedMonths: dropped, removedReportIds: drafts.reportIds, removedAssessmentIds: drafts.assessmentIds, removedPlanIds: drafts.planIds } : {}),
        ...(corrections.length ? { correctionReportIds: corrections.map((x) => x.reportId), ...(taskId ? { taskId } : {}) } : {}),
        ...(ctx.actor.userId !== change.changedBy ? { finishedBy: ctx.actor.userId } : {}),
        ...(error ? { failed: true, error: errorCode(error) } : {}),
      },
    });
  } catch (e) {
    error ??= e;
  }
  if (error) {
    console.error("ändra startdatum: ändringen kunde inte göras klar", errorCode(error));
    return { removed: removed.length, autoAttendanceRemoved: autoRemoved.length, groups: null, droppedMonths: dropped, corrections: corrections.length, incomplete: true };
  }
  // f. Inbjudningarna till kommande gruppaktiviteter med målgrupp följer det nya startdatumet (samma systemsteg som när insatsen
  //    startar). Ändringen är redan sparad och loggad: ett fel här loggas bara som feltyp och jobbet report_schedule stämmer av.
  let groups: Finished["groups"] = null;
  try {
    const sync = await syncAudienceInvites(ctx, { contractId: c.contractId, caseIds: [c.id] });
    groups = { invited: sync.added, removed: sync.removed };
  } catch (e) {
    console.error("ändra startdatum: inbjudningarna kunde inte stämmas av", errorCode(e));
  }
  return { removed: removed.length, autoAttendanceRemoved: autoRemoved.length, groups, droppedMonths: dropped, corrections: corrections.length, incomplete: false };
}

/**
 * Uppgiften till samordnaren att rätta rapporterna som redan är lämnade till kommunen (tasks, kind report_correction): ärendenumret,
 * datumen och perioderna – aldrig namn. En öppen uppgift med samma text i ärendet skapas inte igen (en ändring som görs klar en
 * gång till). ctx.system: uppgiften går till en annan roll (samordnaren). Loggen: task.created med id:n.
 */
async function correctionTask(ctx: Ctx, c: Case, change: CaseStartChange, items: readonly StartChangeCorrection[]): Promise<string> {
  const t = ctx.system.table("tasks");
  const text = startCorrectionTaskText(c.caseNumber, change.fromDate, change.toDate, items);
  const same = (await t.list({ kind: "report_correction", status: "open" })).find((x) => x.caseIds.includes(c.id) && x.text === text);
  if (same) return same.id;
  const task: Task = {
    id: ctx.newId("task"), toRole: "samordnare", toId: null, fromId: ctx.actor.userId, createdAt: ctx.now(), status: "open", kind: "report_correction",
    caseIds: [c.id], text, deviationId: null, emailId: null, responseId: null, month: null, doneAt: null, doneBy: null, doneNote: null,
  };
  await t.insert(task);
  await ctx.audit({
    action: "task.created", entity: "task", entityId: task.id, contractId: c.contractId,
    details: { kind: "report_correction", caseId: c.id, changeId: change.id, reportIds: items.map((x) => x.reportId) },
  });
  return task.id;
}

/** Ändringar som jobbet gör klart: äldre än så här (minuter) – en ändring som pågår just nu hinner bli klar själv. */
export const FINISH_AFTER_MINUTES = 10;
/** Så långt bakåt (dagar) jobbet letar efter ändringar som inte blev klara. */
export const FINISH_LOOKBACK_DAYS = 30;

/**
 * Steget i rapportjobbet (och minnesläget): varje ärendes senaste ändring av startdatum som inte blev klar (ingen lyckad
 * case.start_date_changed) görs klar av systemet – när ingen ändrar i ärendet igen. Bara ändringar som är minst
 * FINISH_AFTER_MINUTES gamla och högst FINISH_LOOKBACK_DAYS dagar, efter golvet (testdatat är komplett dit), och bara när ärendet
 * har ändringens nya startdatum. Ett fel i ett ärende stoppar inte de andra; det första kastas sist (jobbet sparar felorsaken).
 * Returnerar antalet ändringar som gjordes klara.
 */
export async function finishStartChanges(ctx: Ctx, opts: { floor: LocalDateTime | null }): Promise<number> {
  const now = ctx.now();
  const s = ctx.system;
  const recent = (await s.table("case_start_changes").list({ changedAt: { gte: addMinutes(now, -FINISH_LOOKBACK_DAYS * 24 * 60) } }))
    .filter((x) => (!opts.floor || x.changedAt > opts.floor) && x.changedAt <= addMinutes(now, -FINISH_AFTER_MINUTES));
  let done = 0;
  let first: unknown = null;
  for (const caseId of uniq(recent.map((x) => x.caseId)).sort()) {
    try {
      const last = startChangesInOrder(await s.table("case_start_changes").list({ caseId })).at(-1);
      if (!last || !recent.some((x) => x.id === last.id)) continue;
      const c = await s.table("cases").get(caseId);
      if (!c || c.startDate !== last.toDate || (await startChangeLogged(ctx, caseId, last.id))) continue;
      const res = await finishStartChange(ctx, c, last, s);
      if (res.incomplete) throw new Error("incomplete");
      done++;
    } catch (e) {
      first ??= e;
    }
  }
  if (first) throw first;
  return done;
}
