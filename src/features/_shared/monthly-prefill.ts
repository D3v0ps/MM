// Automatisk månadsbedömning (Karims beslut 2026-10-22): underlaget till förifyllnaden och raderna som skapas. Reglerna finns i
// src/core/monthly-prefill.ts (ren funktion med tester) – här läses bara datat och byggs raderna. Bara för hanterare och jobb.
//
// Samma förifyllnad på tre ställen: steget i rapportjobbet som skapar utkasten (ensure-assessments.ts), sidan när raden
// inte finns ännu (coach.assessmentPage) och coachens första sparning (coach.assessmentSave – märkningen för de fält som
// sparas med det förifyllda värdet). AI-jobbet (draft_monthly) skapar en förifylld rad om den saknas.
// Läser via den repo som anroparen ger: ctx.repo (coachen – behörigheten gäller) eller ctx.system (jobbet).
import { attendanceStats } from "@/core/attendance";
import type { OperationalConfig } from "@/core/config";
import type { Ctx } from "@/api/server";
import { prefillAssessment, previousMonth, refreshPrefill, type PlanFields, type Prefill } from "@/core/monthly-prefill";
import { monthEnd, type LocalDateTime, type MonthKey } from "@/core/time";
import type { AppRepo, Case, MonthlyAssessment, MonthlyPlan } from "@/data/schema";

/** Förifyllnaden för ärendet och månaden ur godkända uppgifter (utan AI – AI-utkastet läggs in av jobbet efteråt). */
export async function loadPrefill(repo: AppRepo, c: Pick<Case, "id">, month: MonthKey, cfg: Pick<OperationalConfig, "progression">, now: LocalDateTime): Promise<Prefill> {
  const byCase = { caseId: c.id };
  const [checkIns, activities, attendance, prev] = await Promise.all([
    repo.table("check_ins").list(byCase),
    repo.table("activities").list(byCase),
    repo.table("attendance").list(byCase),
    repo.table("monthly_plans").first({ caseId: c.id, month: previousMonth(month) }),
  ]);
  const att = attendanceStats({ activities, attendance }, c.id, `${month}-01`, monthEnd(month), { now });
  return prefillAssessment({ month, areaKeys: cfg.progression.areas, checkIns, attendance: att, previousPlan: prev ?? null });
}

/**
 * Förifyllnaden hålls aktuell (refreshPrefill i src/core/monthly-prefill.ts) efter att en mötesrapport i månaden godkänts: ett
 * utkast som finns får de automatiskt märkta fältens nya värden. Villkorat på version och status – en samtidig sparning eller ett
 * godkännande vinner. Raden får en ny version (ett öppet formulär får "ändrats i en annan flik" i stället för att skriva över).
 * Läser och skriver via ctx.repo (coachen som godkände mötesrapporten). Revisionsloggen: ärendet, månaden och mötesrapporten.
 */
export async function refreshMonthlyPrefill(ctx: Ctx, c: Pick<Case, "id" | "contractId">, month: MonthKey, cfg: Pick<OperationalConfig, "progression">, checkInId: string): Promise<boolean> {
  const table = ctx.repo.table("monthly_assessments");
  const ma = await table.first({ caseId: c.id, month });
  if (!ma || ma.status !== "draft") return false;
  const plans = ctx.repo.table("monthly_plans");
  const plan = await plans.first({ caseId: c.id, month });
  const fresh = await loadPrefill(ctx.repo, c, month, cfg, ctx.now());
  const r = refreshPrefill({ summary: ma.summary, overallStatus: ma.overallStatus, prefill: ma.prefill ?? {} }, plan && plan.status !== "approved" ? plan : null, fresh);
  if (!r.changed) return false;
  if (!(await table.updateIf(ma.id, { version: ma.version, status: "draft" }, { ...r.assessment, version: ma.version + 1 }))) return false;
  if (plan && r.plan) await plans.update(plan.id, r.plan);
  await ctx.audit({ action: "assessment.prefill_refreshed", entity: "monthly_assessment", entityId: ma.id, contractId: c.contractId, details: { caseId: c.id, month, checkInId, automatic: true } });
  return true;
}

/** Den förifyllda månadsbedömningen (utkast). */
export function prefilledAssessment(id: string, caseId: string, month: MonthKey, p: Prefill): MonthlyAssessment {
  return {
    id, caseId, month, areas: p.areas, status: "draft", decidedBy: null, decidedAt: null, summary: p.summary, aiSummaryDraft: null, overallStatus: p.overallStatus,
    version: 1, prefill: p.prefill,
  };
}

/** Den förifyllda planen för nästa månad (utkast). */
export function prefilledPlan(id: string, caseId: string, month: MonthKey, p: Pick<Prefill, "plan">): MonthlyPlan {
  return { id, caseId, month, ...p.plan, nextCustomerMeeting: p.plan.nextCustomerMeeting, status: "draft" };
}

/** Planens fält ur raden (för applyAiDraft och märkningen). */
export const planFieldsOf = (x: MonthlyPlan): PlanFields => ({
  goal1: x.goal1, goal2: x.goal2, plannedActivities: x.plannedActivities, plannedEmployerContact: x.plannedEmployerContact, plannedAdaptation: x.plannedAdaptation,
  nextCustomerMeeting: x.nextCustomerMeeting,
});

/** Fasta id:n för raderna som jobbet skapar – två samtidiga körningar kan aldrig skapa två (primärnyckeln). */
export const prefillAssessmentId = (caseId: string, month: MonthKey) => `ma-${caseId}-${month}`;
export const prefillPlanId = (caseId: string, month: MonthKey) => `mp-${caseId}-${month}`;
