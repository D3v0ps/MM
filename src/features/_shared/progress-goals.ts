// Delmål för progressionerna (Karims beslut 2026-11-11, 0043): det som flera områden delar – bara för hanterare och jobb, aldrig
// för skärmar. Reglerna finns i src/core/progress-goals.ts (rena funktioner med tester).
//
//   trainFromAttendance  systemsteget Tränar automatiskt: efter att närvaro registrerats (coachen, Markera alla, den automatiska
//                        närvaron) eller delmålen på ett tillfälle ändrats. ctx.system (motsvarar service role – källan auto skrivs
//                        bara av servern). Idempotent: ett delmål som redan tränas eller är uppnått rörs aldrig, och raden har ett
//                        fast id (ärendet och delmålet) och en unik nyckel – två samtidiga körningar skriver aldrig två. En loggrad
//                        per avtal och körning med bara id:n. Bästa försök: närvaron är redan sparad när steget körs – ett fel här
//                        stoppar aldrig coachen (bara felets kod loggas, som för månadsbedömningens förifyllnad).
//   goalTagsCheck        prövar delmålen som ska stå på ett tillfälle (avtalet, aktiva, inga dubbletter) – samma regel som
//                        triggrarna i 0043.
import type { Ctx } from "@/api/server";
import { SYSTEM_ACTOR } from "@/api/roles";
import { isOperational, progressionAreas } from "@/core/config";
import { caseGoalId, goalTagsProblem, sortGoals, trainingRowsToAdd } from "@/core/progress-goals";
import { uniq } from "@/core/util";
import { UniqueError } from "@/data/repo";
import { PROGRESS_GOAL_TAGS_MAX, type AppRepo, type ProgressGoal } from "@/data/schema";
import type { GoalPickerArea } from "../delmal/api";

/**
 * Valet "Tränar delmål" i formulären: avtalets progressionsområden i avtalets ordning med delmålen (aktiva och inaktiverade – de
 * inaktiverade visas bara när de redan står på tillfället). Läser via repot som anroparen ger (ctx.repo – behörigheten).
 */
export async function goalPickerAreas(repo: AppRepo, contractId: string): Promise<GoalPickerArea[]> {
  const contract = await repo.table("contracts").get(contractId);
  if (!contract || !isOperational(contract.config)) return [];
  const areas = progressionAreas(contract.config);
  const goals = sortGoals(await repo.table("progress_goals").list({ contractId }), areas.map((a) => a.key));
  return areas
    .map((a) => ({ key: a.key, label: a.label, goals: goals.filter((g) => g.areaKey === a.key).map((g) => ({ id: g.id, label: g.label, active: g.active })) }))
    .filter((a) => a.goals.length);
}

/** Felets kod eller namn till loggen – aldrig meddelandet (det kan innehålla värden). */
const errorCode = (e: unknown): string => {
  const x = e as { code?: unknown; name?: unknown } | null;
  return typeof x?.code === "string" && x.code ? x.code : typeof x?.name === "string" && x.name ? x.name : "error";
};

/** Avtalets katalog (också inaktiva) via repot som anroparen ger – ctx.repo (behörigheten) eller ctx.system. */
export const goalsOfContract = (repo: AppRepo, contractId: string): Promise<ProgressGoal[]> => repo.table("progress_goals").list({ contractId });

/**
 * Delmålen som ska stå på ett tillfälle: null = godkänt, annars felet i klarspråk. Katalogen läses via ctx.repo – den som skapar
 * tillfället läser avtalets delmål (Miljonbemanning utom ekonomen).
 */
export async function goalTagsCheck(ctx: Ctx, contractId: string, next: readonly string[] | undefined, before: readonly string[] = []): Promise<string | null> {
  const ids = next ?? [];
  if (!ids.length) return null;
  const goals = await ctx.repo.table("progress_goals").list({ id: { in: uniq(ids) } });
  return goalTagsProblem(ids, before, goals, contractId, PROGRESS_GOAL_TAGS_MAX);
}

export type TrainingRun = { added: number; failed: boolean };

/**
 * Tränar automatiskt för tillfällena (se överst i filen). Bara närvaro som närvarande eller sen räknas, bara aktiva delmål i
 * ärendets avtal, och bara ärende och delmål som saknar läge. Returnerar antalet nya rader.
 */
export async function trainFromAttendance(ctx: Ctx, activityIds: readonly string[]): Promise<TrainingRun> {
  const ids = uniq(activityIds);
  if (!ids.length) return { added: 0, failed: false };
  const s = ctx.system;
  const written: { id: string; caseId: string; contractId: string; goalId: string; activityId: string }[] = [];
  try {
    const acts = await s.table("activities").list({ id: { in: ids } });
    const groupIds = uniq(acts.map((a) => a.groupActivityId).filter((x): x is string => !!x));
    const groups = groupIds.length ? await s.table("group_activities").list({ id: { in: groupIds } }) : [];
    const tagIds = uniq([...acts.flatMap((a) => a.progressGoalIds ?? []), ...groups.flatMap((g) => g.progressGoalIds ?? [])]);
    if (!tagIds.length) return { added: 0, failed: false };
    const caseIds = uniq(acts.map((a) => a.caseId));
    const [attendance, goals, cases, existing] = await Promise.all([
      s.table("attendance").list({ activityId: { in: acts.map((a) => a.id) } }),
      s.table("progress_goals").list({ id: { in: tagIds } }),
      s.table("cases").pick(["contractId"], { id: { in: caseIds } }),
      s.table("case_progress_goals").list({ caseId: { in: caseIds }, goalId: { in: tagIds } }),
    ]);
    const rows = trainingRowsToAdd({ activities: acts, groupActivities: groups, attendance, goals, existing, contractOfCase: new Map(cases.map((c) => [c.id, c.contractId])) });
    const now = ctx.now();
    for (const r of rows) {
      const id = caseGoalId(r.caseId, r.goalId);
      try {
        await s.table("case_progress_goals").insert({
          id, caseId: r.caseId, contractId: r.contractId, goalId: r.goalId, status: "training", source: "auto", achievedOn: null, evidenceKind: "activity", evidenceId: r.activityId,
          setBy: SYSTEM_ACTOR.userId, setAt: now,
        });
      } catch (e) {
        // En coach eller en samtidig körning hann sätta ett läge: det gäller – ingenting skrivs över.
        if (e instanceof UniqueError || (e as { code?: unknown } | null)?.code === "23505") continue;
        throw e;
      }
      written.push({ id, ...r });
    }
  } catch (e) {
    console.error("delmålen: Tränar kunde inte registreras efter närvaron", errorCode(e));
    await logTraining(ctx, written).catch(() => undefined);
    return { added: written.length, failed: true };
  }
  await logTraining(ctx, written);
  return { added: written.length, failed: false };
}

/** En loggrad per avtal: id:n på raderna, ärendena, delmålen och tillfällena – aldrig namn eller delmålens text. */
async function logTraining(ctx: Ctx, written: readonly { id: string; caseId: string; contractId: string; goalId: string; activityId: string }[]): Promise<void> {
  for (const contractId of uniq(written.map((w) => w.contractId)).sort()) {
    const mine = written.filter((w) => w.contractId === contractId);
    await ctx.audit({
      action: "case_progress_goal.training_auto", entity: "case_progress_goal", entityId: mine.length === 1 ? mine[0].id : null, contractId,
      details: {
        count: mine.length, ids: mine.map((w) => w.id), caseIds: uniq(mine.map((w) => w.caseId)).sort(), goalIds: uniq(mine.map((w) => w.goalId)).sort(),
        activityIds: uniq(mine.map((w) => w.activityId)).sort(), automatic: true,
      },
    });
  }
}
