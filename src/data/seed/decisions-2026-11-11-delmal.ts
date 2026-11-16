// Steg efter mappningen: Karims beslut 2026-11-11 i testdatat (påhittade uppgifter) – delmål för progressionerna.
// Prototypens tillstånd och generatorerna ändras inte, så slumpen och ordningen ligger kvar.
//
//   Katalogen      startlistan för Botkyrkaavtalet (DEFAULT_PROGRESS_GOALS i src/core/progress-goals.ts – samma nummer och id som
//                  supabase/manual/2026-11-delmal-botkyrka.sql), inlagd av systemet 11 november.
//   Tillfällen     den återkommande aktiviteten Jobbsök och CV (och dess tillfällen) tränar CV, personligt brev och att söka jobb
//                  via datorn; Intervjuträning tränar att presentera sig för en arbetsgivare.
//   BOT-26-0143    (Nadia, huvudcoach Amira) Tränar automatiskt på två passerade egna tillfällen med närvaro (yrkesmomentet och
//                  coachträffen har delmålen – i activity_progress_goals, inte på tillfället), och två uppnådda delmål – ett uppdaterat CV (förbättrade ansökningshandlingar kräver
//                  två: inte uppfyllt än) och att logga in på en dator.
//   BOT-26-0002    (huvudcoach Erik) har förslaget till steg 1 – delmålen som uppfyller de fyra punkterna är uppnådda under
//                  insatsen (som är avslutad), så att förslaget kan granskas och skickas.
// Revisionsloggen: en rad för startlistan och en per uppnått delmål – bara id:n och datum.
import { SYSTEM_ACTOR } from "@/api/roles";
import { caseGoalId, defaultGoalId, defaultProgressGoals } from "@/core/progress-goals";
import { addDays, dayOf } from "@/core/time";
import type { CaseProgressGoal, Db } from "../schema";
import { TODAY } from "./constants";
import { seedSeriesId } from "./gen-group-activities";

const CONTRACT = "c-bot";
/** När startlistan lades in (Karims godkännande 2026-11-11). */
export const DELMAL_SEEDED_AT = "2026-11-11T18:00";
const goal = (n: number) => defaultGoalId(CONTRACT, n);
/** När delmål som uppnåddes före startlistan registrerades i efterhand. */
const REGISTERED_AFTER = "2026-11-12T10:00";

/** Delmålen på de återkommande aktiviteterna (seriens nummer → startlistans nummer). */
const SERIES_GOALS: readonly [number, number[]][] = [[4, [13, 14, 20, 21]], [5, [24]]];

export function applyDecisions20261111Delmal(db: Db): void {
  if (!db.contracts.some((c) => c.id === CONTRACT)) return;
  db.progress_goals.push(...defaultProgressGoals(CONTRACT, DELMAL_SEEDED_AT, SYSTEM_ACTOR.userId));
  db.audit_log.push({
    id: "log-delmal-startlista", occurredAt: DELMAL_SEEDED_AT, actorId: SYSTEM_ACTOR.userId, action: "progress_goal.catalog_seeded", entity: "contract", entityId: CONTRACT, contractId: CONTRACT,
    details: { count: db.progress_goals.filter((g) => g.contractId === CONTRACT).length, decision: "2026-11-11" },
  });

  // Tillfällena i Jobbsök och CV och Intervjuträning (kommande – de skapades av jobbet) får seriens delmål.
  for (const [n, goals] of SERIES_GOALS) {
    const ids = goals.map(goal);
    const s = db.group_activity_series.find((x) => x.id === seedSeriesId(n));
    if (!s) continue;
    s.progressGoalIds = ids;
    for (const g of db.group_activities.filter((x) => x.seriesId === s.id)) g.progressGoalIds = [...ids];
  }

  const rows: CaseProgressGoal[] = [];
  const achieved = (caseId: string, n: number, on: string, by: string, evidence: Pick<CaseProgressGoal, "evidenceKind" | "evidenceId"> = { evidenceKind: null, evidenceId: null }) => {
    const id = caseGoalId(caseId, goal(n));
    // Ett delmål som uppnåddes innan startlistan fanns registrerades i efterhand, dagen efter.
    const setAt = `${on}T15:30` > DELMAL_SEEDED_AT ? `${on}T15:30` : REGISTERED_AFTER;
    rows.push({ id, caseId, contractId: CONTRACT, goalId: goal(n), status: "achieved", source: "manual", achievedOn: on, ...evidence, setBy: by, setAt });
    db.audit_log.push({
      id: `log-${id}-uppnatt`, occurredAt: setAt, actorId: by, action: "case_progress_goal.achieved", entity: "case_progress_goal", entityId: id, contractId: CONTRACT,
      details: { caseId, goalId: goal(n), achievedOn: on, from: "none", ...(evidence.evidenceKind ? { evidenceKind: evidence.evidenceKind, evidenceId: evidence.evidenceId } : {}) },
    });
  };

  // BOT-26-0143 (Nadia): de senaste passerade egna tillfällena med närvaro – yrkesmomentet tränar en arbetsuppgift självständigt,
  // coachträffen en egen veckoplan. Tränar automatiskt (systemet, när närvaron registrerades).
  const nadia = db.cases.find((c) => c.id === "case-260143");
  if (nadia) {
    const present = new Map(db.attendance.filter((a) => a.caseId === nadia.id && (a.status === "present" || a.status === "late")).map((a) => [a.activityId, a]));
    const past = db.activities.filter((a) => a.caseId === nadia.id && !a.groupActivityId && present.has(a.id)).sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1));
    for (const [kind, n] of [["yrkesmoment", 5], ["möte", 3]] as const) {
      const a = past.find((x) => x.kind === kind);
      if (!a) continue;
      const at = present.get(a.id)!;
      db.activity_progress_goals.push({ id: a.id, caseId: nadia.id, goalIds: [goal(n)], updatedBy: nadia.leadCoachId ?? "u-amira", updatedAt: a.startsAt });
      const id = caseGoalId(nadia.id, goal(n));
      rows.push({ id, caseId: nadia.id, contractId: CONTRACT, goalId: goal(n), status: "training", source: "auto", achievedOn: null, evidenceKind: "activity", evidenceId: a.id, setBy: SYSTEM_ACTOR.userId, setAt: at.registeredAt });
      db.audit_log.push({
        id: `log-${id}-tranar`, occurredAt: at.registeredAt, actorId: SYSTEM_ACTOR.userId, action: "case_progress_goal.training_auto", entity: "case_progress_goal", entityId: id, contractId: CONTRACT,
        details: { count: 1, ids: [id], caseIds: [nadia.id], goalIds: [goal(n)], activityIds: [a.id], automatic: true },
      });
    }
    const start = nadia.startDate ?? dayOf(nadia.referredAt);
    const cv = minDay(addDays(start, 28), addDays(TODAY, -14));
    const note = db.case_notes.filter((x) => x.caseId === nadia.id && !x.removedAt && x.occurredOn <= cv).sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1))[0];
    achieved(nadia.id, 20, cv, nadia.leadCoachId ?? "u-amira", note ? { evidenceKind: "case_note", evidenceId: note.id } : undefined);
    achieved(nadia.id, 11, minDay(addDays(start, 15), addDays(TODAY, -20)), nadia.leadCoachId ?? "u-amira");
  }

  // BOT-26-0002: delmålen som uppfyller de fyra punkterna i steg 1 (förslaget till steg 1 i testdatat) – alla under insatsen (bara
  // delmål som uppnåtts mellan startdatumet och slutdatumet räknas).
  const two = db.cases.find((c) => c.id === "case-260002");
  if (two?.startDate) {
    const by = two.leadCoachId ?? "u-erik";
    const last = minDay(two.endDate ?? TODAY, addDays(TODAY, -3));
    const day = (d: number) => minDay(addDays(two.startDate as string, d), last);
    achieved(two.id, 4, day(7), by);
    achieved(two.id, 3, day(14), by);
    achieved(two.id, 13, day(21), by);
    achieved(two.id, 20, day(28), by);
    achieved(two.id, 17, day(35), by);
  }
  db.case_progress_goals.push(...rows);
}

const minDay = (a: string, b: string) => (a < b ? a : b);
