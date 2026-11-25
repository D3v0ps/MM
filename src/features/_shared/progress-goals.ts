// Delmål för progressionerna (Karims beslut 2026-11-11, 0043): det som flera områden delar – bara för hanterare och jobb, aldrig
// för skärmar. Reglerna finns i src/core/progress-goals.ts (rena funktioner med tester).
//
//   trainFromAttendance  systemsteget Tränar automatiskt: efter att närvaro registrerats (coachen, Markera alla, den automatiska
//                        närvaron) eller delmålen på ett tillfälle ändrats. ctx.system (motsvarar service role – källan auto skrivs
//                        bara av servern). Idempotent: ett delmål som redan tränas eller är uppnått rörs aldrig, och raden har ett
//                        fast id (ärendet och delmålet) och en unik nyckel – två samtidiga körningar skriver aldrig två. En loggrad
//                        per avtal och körning med bara id:n. Bästa försök: närvaron är redan sparad när steget körs – ett fel här
//                        stoppar aldrig coachen (bara felets kod loggas, som för månadsbedömningens förifyllnad). En rad som
//                        databasen nekar (23505 eller 23514, till exempel ett delmål som inaktiverats under tiden) hoppas över –
//                        resten skrivs ändå. Inte heller loggraden kastar.
//   goalTagsCheck        prövar delmålen som ska stå på ett tillfälle (avtalet, aktiva, inga dubbletter) – samma regel som
//                        triggrarna i 0043.
//   ownGoalTags          delmålen på deltagarens egna tillfällen (activity_progress_goals – inte på activities, som kommunen och
//   setOwnGoalTags       ekonomen läser): läsa per tillfälle och skriva via behörigheten (ctx.repo, i eget namn).
import type { Ctx } from "@/api/server";
import { SYSTEM_ACTOR } from "@/api/roles";
import { isOperational, progressionAreas, type OperationalConfig } from "@/core/config";
import { caseGoalId, goalTagsProblem, shownCaseGoals, sortGoals, trainingRowsToAdd } from "@/core/progress-goals";
import { uniq } from "@/core/util";
import { PolicyError, UniqueError } from "@/data/repo";
import { PROGRESS_GOAL_TAGS_MAX, type Activity, type AppRepo, type Case, type ProgressGoal } from "@/data/schema";
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

/**
 * Har ärendet delmål att visa? Avgör om deltagarkortet har fliken Delmål (Karims beslut 2026-11-25) – samma urval som kortet
 * Delmål (shownCaseGoals). Läser via repot som anroparen ger (ctx.repo – behörigheten: kommunen och ekonomen läser inga delmål).
 */
export async function caseHasGoals(repo: AppRepo, c: Pick<Case, "id" | "contractId">, cfg: Pick<OperationalConfig, "progression">): Promise<boolean> {
  const [goals, rows] = await Promise.all([repo.table("progress_goals").list({ contractId: c.contractId }), repo.table("case_progress_goals").list({ caseId: c.id })]);
  return shownCaseGoals(goals, new Set(rows.map((r) => r.goalId)), progressionAreas(cfg).map((a) => a.key)).length > 0;
}

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

/**
 * Delmålen på deltagarens egna tillfällen (activity_progress_goals): tillfällets id → delmålen. Ett tillfälle utan rad har inga.
 * Läser via repot som anroparen ger – ctx.repo (full- eller teamåtkomst) eller ctx.system.
 */
export async function ownGoalTags(repo: AppRepo, activityIds: readonly string[]): Promise<Map<string, string[]>> {
  const ids = uniq(activityIds);
  if (!ids.length) return new Map();
  const rows = await repo.table("activity_progress_goals").list({ id: { in: ids } });
  return new Map(rows.map((r) => [r.id, r.goalIds]));
}

/**
 * Skriv delmålen på deltagarens eget tillfälle (efter goalTagsCheck): via behörigheten (ctx.repo), i eget namn. En tom lista på ett
 * tillfälle utan rad skriver ingenting. changed = något ändrades.
 */
export async function setOwnGoalTags(ctx: Ctx, a: Pick<Activity, "id" | "caseId">, goalIds: readonly string[]): Promise<boolean> {
  const table = ctx.repo.table("activity_progress_goals");
  const next = [...goalIds];
  const patch = { goalIds: next, updatedBy: ctx.actor.userId, updatedAt: ctx.now() };
  const cur = await table.get(a.id);
  if (cur) {
    if (JSON.stringify(cur.goalIds) === JSON.stringify(next)) return false;
    await table.update(a.id, patch);
    return true;
  }
  if (!next.length) return false;
  try {
    await table.insert({ id: a.id, caseId: a.caseId, ...patch });
  } catch (e) {
    // Någon hann skriva raden samtidigt: den skrivs över med det här valet.
    if (!(e instanceof UniqueError) && (e as { code?: unknown } | null)?.code !== "23505") throw e;
    await table.update(a.id, patch);
  }
  return true;
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
    const [groups, ownTags] = await Promise.all([
      groupIds.length ? s.table("group_activities").list({ id: { in: groupIds } }) : Promise.resolve([]),
      ownGoalTags(s, acts.filter((a) => !a.groupActivityId).map((a) => a.id)),
    ]);
    const tagIds = uniq([...[...ownTags.values()].flat(), ...groups.filter((g) => !g.cancelledAt).flatMap((g) => g.progressGoalIds ?? [])]);
    if (!tagIds.length) return { added: 0, failed: false };
    const caseIds = uniq(acts.map((a) => a.caseId));
    const [attendance, goals, cases, existing] = await Promise.all([
      s.table("attendance").list({ activityId: { in: acts.map((a) => a.id) } }),
      s.table("progress_goals").list({ id: { in: tagIds } }),
      s.table("cases").pick(["contractId"], { id: { in: caseIds } }),
      s.table("case_progress_goals").list({ caseId: { in: caseIds }, goalId: { in: tagIds } }),
    ]);
    const rows = trainingRowsToAdd({ activities: acts, ownTags, groupActivities: groups, attendance, goals, existing, contractOfCase: new Map(cases.map((c) => [c.id, c.contractId])) });
    const now = ctx.now();
    for (const r of rows) {
      const id = caseGoalId(r.caseId, r.goalId);
      try {
        await s.table("case_progress_goals").insert({
          id, caseId: r.caseId, contractId: r.contractId, goalId: r.goalId, status: "training", source: "auto", achievedOn: null, evidenceKind: "activity", evidenceId: r.activityId,
          setBy: SYSTEM_ACTOR.userId, setAt: now,
        });
      } catch (e) {
        // En coach eller en samtidig körning hann sätta ett läge (23505), eller raden stämmer inte längre – till exempel ett delmål
        // som inaktiverats under tiden (23514; minnet: PolicyError från kontrollen). Den raden hoppas över, resten skrivs.
        if (e instanceof UniqueError || e instanceof PolicyError || isCode(e, "23505") || isCode(e, "23514")) {
          if (!(e instanceof UniqueError) && !isCode(e, "23505")) console.error("delmålen: ett Tränar hoppades över", errorCode(e), id);
          continue;
        }
        throw e;
      }
      written.push({ id, ...r });
    }
  } catch (e) {
    console.error("delmålen: Tränar kunde inte registreras efter närvaron", errorCode(e));
    await logTraining(ctx, written);
    return { added: written.length, failed: true };
  }
  await logTraining(ctx, written);
  return { added: written.length, failed: false };
}

const isCode = (e: unknown, code: string): boolean => (e as { code?: unknown } | null)?.code === code;

/**
 * En loggrad per avtal: id:n på raderna, ärendena, delmålen och tillfällena – aldrig namn eller delmålens text. Kastar aldrig: raderna
 * är redan sparade och närvaron likaså – går loggraden inte att skriva loggas felets kod och radernas id:n.
 */
async function logTraining(ctx: Ctx, written: readonly { id: string; caseId: string; contractId: string; goalId: string; activityId: string }[]): Promise<void> {
  for (const contractId of uniq(written.map((w) => w.contractId)).sort()) {
    const mine = written.filter((w) => w.contractId === contractId);
    try {
      await ctx.audit({
        action: "case_progress_goal.training_auto", entity: "case_progress_goal", entityId: mine.length === 1 ? mine[0].id : null, contractId,
        details: {
          count: mine.length, ids: mine.map((w) => w.id), caseIds: uniq(mine.map((w) => w.caseId)).sort(), goalIds: uniq(mine.map((w) => w.goalId)).sort(),
          activityIds: uniq(mine.map((w) => w.activityId)).sort(), automatic: true,
        },
      });
    } catch (e) {
      console.error("delmålen: loggraden för Tränar kunde inte skrivas", errorCode(e), mine.map((w) => w.id).join(","));
    }
  }
}
