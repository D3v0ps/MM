// Automatisk månadsbedömning (Karims beslut 2026-10-22). Ren domänlogik utan I/O: vad som fylls i automatiskt innan
// huvudcoachen går igenom bedömningen, och hur coachens sparning förhåller sig till det.
//
// "Allt ska vara ifyllt, våra huvudcoacher ska bara 'gå igenom' och kontrollera att vi inte missat något."
// "Nivå 0-3 ska ligga på default på 0 om vi inte har någon anteckning som tydligt visar bedömning på nivån."
//
// Reglerna (ersätter "bedömningsfälten är tomma tills coachen valt" – bara för månadsbedömningen):
//   Områdena     varje progressionsområde har progressionsnivå 0 och observationen "Ingen bedömning av förändring denna månad.",
//                märkt Automatiskt – inget belägg (levelSource "auto"), tills coachen väljer något annat eller godtar ett
//                AI-förslag. AI får bara FÖRESLÅ nivå 1–3 med ett ordagrant citat ur underlaget (aiLevelSuggestion,
//                aiLevelEvidence) – servern och jobben skriver aldrig ett förslag i nivån.
//   Samlad status  från coachens senaste godkända mötesrapport i månaden (coachens eget val, inte AI). Ingen godkänd
//                mötesrapport: tom – coachen väljer.
//   Sammanfattning AI:s utkast när det finns, annars en saklig text ur godkända uppgifter (närvaroregistreringar, antal
//                godkända mötesrapporter, senaste veckomålet) – inga bedömningar, inga gissningar, "framgår inte".
//   Planen       AI:s utkast när det finns (planerade aktiviteter), mål 1 = senaste godkända veckomålet, övriga fält från förra
//                månadens plan.
//   Märkningen   allt förifyllt märks "Ifyllt automatiskt – kontrollera" (MonthlyPrefill) tills coachen ändrar det.
// Godkännandet kräver att coachen kryssat "Jag har gått igenom bedömningen" (reviewed) – approvalMissing nedan.
import type {
  AiLevelEvidence, AiObservationDraft, AreaAssessment, CheckIn, LevelSource, MonthlyAssessment, MonthlyPlan, MonthlyPrefill, TrafficLight,
} from "@/data/schema";
import type { AttendanceStats } from "./attendance";
import type { ProgressLevel } from "./config";
import { addMonths, MONTHS, type MonthKey } from "./time";

/**
 * Observationen i ett område utan belägg för en förändring. Neutral: den påstår aldrig att underlaget saknas (närvaron kan vara
 * registrerad hela månaden) – bara att ingen förändring är bedömd. Står i kommunens månadsrapport om coachen inte ändrar den.
 */
export const AUTO_OBSERVATION = "Ingen bedömning av förändring denna månad.";

/** Varifrån nivån kommer. Äldre rader utan fältet: en satt nivå är coachens val, ingen nivå = inget val. */
export function levelSourceOf(a: Pick<AreaAssessment, "level" | "levelSource"> | null | undefined): LevelSource | null {
  if (!a) return null;
  if (a.levelSource) return a.levelSource;
  return a.level != null ? "coach" : null;
}

/** Ett område som fyllts i automatiskt: nivå 0, "Framgår inte …", inget belägg. AI:s utkast behålls om de finns. */
export function autoArea(ai?: Pick<AreaAssessment, "aiLevelSuggestion" | "aiObservationDraft" | "aiLevelEvidence"> | null): AreaAssessment {
  return {
    level: 0, observation: AUTO_OBSERVATION, nextStep: "", aiLevelSuggestion: ai?.aiLevelSuggestion ?? null, aiObservationDraft: ai?.aiObservationDraft ?? null,
    levelSource: "auto", aiLevelEvidence: ai?.aiLevelEvidence ?? null,
  };
}

/**
 * Områdena med automatisk ifyllnad där inget val finns: ett område som saknas, eller som saknar både nivå och ursprung (äldre
 * utkast), blir progressionsnivå 0 "Automatiskt – inget belägg". Coachens val och redan förifyllda områden ändras inte.
 */
export function withAutoAreas(areas: Readonly<Record<string, AreaAssessment>>, keys: readonly string[]): Record<string, AreaAssessment> {
  const out: Record<string, AreaAssessment> = { ...areas };
  for (const k of keys) {
    const a = areas[k];
    if (!a || (a.level == null && !a.levelSource)) out[k] = { ...autoArea(a), nextStep: a?.nextStep ?? "" };
  }
  return out;
}

// ---------------------------------------------------------------- Förifyllnaden
export type PrefillCheckIn = Pick<CheckIn, "id" | "heldAt" | "status" | "overallStatus" | "nextGoal">;
export type PrefillPlan = Pick<MonthlyPlan, "goal1" | "goal2" | "plannedActivities" | "plannedEmployerContact" | "plannedAdaptation">;
export type PlanFields = PrefillPlan & { nextCustomerMeeting: string | null };

export type PrefillInput = {
  month: MonthKey;
  /** Avtalets obligatoriska progressionsområden (cfg.progression.areas). */
  areaKeys: readonly string[];
  /** Ärendets mötesrapporter (alla – bara godkända i månaden räknas). */
  checkIns: readonly PrefillCheckIn[];
  /** Närvaron i månaden (attendanceStats för månadens dagar). */
  attendance: Pick<AttendanceStats, "planned" | "unregistered" | "present" | "late" | "absentValid" | "absentInvalid">;
  /** Förra månadens plan (monthly_plans för månaden före), om den finns. */
  previousPlan: PrefillPlan | null;
  /** AI:s utkast till sammanfattning och plan (med belägg), om de finns. */
  ai?: { summary: string | null; plan: string | null } | null;
};

export type Prefill = {
  areas: Record<string, AreaAssessment>;
  overallStatus: TrafficLight | null;
  summary: string;
  plan: PlanFields;
  prefill: MonthlyPrefill;
};

const inMonth = (heldAt: string, month: MonthKey) => heldAt.slice(0, 7) === month;
const byHeld = (a: PrefillCheckIn, b: PrefillCheckIn) => (a.heldAt < b.heldAt ? -1 : a.heldAt > b.heldAt ? 1 : a.id < b.id ? -1 : 1);
const sentence = (s: string) => {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/** Månadens godkända mötesrapporter, äldst först. */
export function approvedInMonth<T extends PrefillCheckIn>(checkIns: readonly T[], month: MonthKey): T[] {
  return checkIns.filter((x) => x.status === "approved" && inMonth(x.heldAt, month)).sort(byHeld);
}

/** Det senaste godkända veckomålet i månaden (nästa veckas mål i den senaste mötesrapporten som har ett). */
export function latestGoal(checkIns: readonly PrefillCheckIn[], month: MonthKey): string | null {
  const withGoal = approvedInMonth(checkIns, month).filter((x) => x.nextGoal.trim());
  return withGoal.length ? withGoal[withGoal.length - 1].nextGoal.trim() : null;
}

/**
 * Sammanfattningen ur godkända uppgifter när AI-utkast saknas: närvaron, antalet godkända mötesrapporter och det senaste
 * veckomålet. Inga bedömningar och inga gissningar – det som saknas står som "framgår inte".
 */
export function rulesSummary(month: MonthKey, cis: readonly PrefillCheckIn[], att: PrefillInput["attendance"]): string {
  const m = MONTHS[Number(month.slice(5, 7)) - 1];
  const registered = att.planned - att.unregistered;
  const parts: string[] = [];
  if (registered > 0) {
    const extra = [
      att.late ? `varav ${att.late} med sen ankomst` : "",
    ].filter(Boolean);
    const absent = [att.absentValid ? `giltig frånvaro ${att.absentValid}` : "", att.absentInvalid ? `ogiltig frånvaro ${att.absentInvalid}` : ""].filter(Boolean);
    parts.push(
      `Närvaro i ${m}: närvarande vid ${att.present + att.late} av ${registered} registrerade tillfällen${extra.length ? `, ${extra.join(", ")}` : ""}.${absent.length ? ` ${absent.join(", ").replace(/^./, (c) => c.toUpperCase())}.` : ""}`,
    );
  } else parts.push(`Närvaro i ${m}: framgår inte – ingen närvaro är registrerad.`);
  const approved = approvedInMonth(cis, month);
  parts.push(approved.length ? `Godkända mötesrapporter: ${approved.length}.` : "Godkända mötesrapporter: inga.");
  const goal = latestGoal(cis, month);
  parts.push(goal ? `Senaste veckomålet: ${sentence(goal)}` : "Veckomål: framgår inte.");
  return parts.join(" ");
}

/**
 * Det som fylls i automatiskt för ett ärende och en månad (se överst i filen). prefill = märkningen ("Ifyllt automatiskt –
 * kontrollera") för de fält som fick ett värde.
 */
export function prefillAssessment(input: PrefillInput): Prefill {
  const { month } = input;
  const marks: MonthlyPrefill = {};
  const areas: Record<string, AreaAssessment> = {};
  for (const k of input.areaKeys) areas[k] = autoArea();

  // Samlad status: coachens senaste godkända mötesrapport i månaden som har en status.
  const withStatus = approvedInMonth(input.checkIns, month).filter((x) => x.overallStatus != null);
  const last = withStatus[withStatus.length - 1] ?? null;
  const overallStatus = last ? (last.overallStatus as TrafficLight) : null;
  if (last) marks.overallStatus = { checkInId: last.id, heldAt: last.heldAt };

  // Sammanfattningen: AI-utkastet, annars texten ur godkända uppgifter.
  const aiSummary = input.ai?.summary?.trim() || null;
  const summary = aiSummary ?? rulesSummary(month, input.checkIns, input.attendance);
  marks.summary = aiSummary ? "ai" : "rules";

  // Planen för nästa månad.
  const prev = input.previousPlan;
  const goal = latestGoal(input.checkIns, month);
  const aiPlan = input.ai?.plan?.trim() || null;
  const plan: PlanFields = { goal1: "", goal2: "", plannedActivities: "", plannedEmployerContact: "", plannedAdaptation: "", nextCustomerMeeting: null };
  const planMarks: NonNullable<MonthlyPrefill["plan"]> = {};
  if (goal) {
    plan.goal1 = goal;
    planMarks.goal1 = "check_in";
  }
  if (aiPlan) {
    plan.plannedActivities = aiPlan;
    planMarks.plannedActivities = "ai";
  }
  for (const k of ["goal2", "plannedActivities", "plannedEmployerContact", "plannedAdaptation"] as const) {
    const v = prev?.[k]?.trim();
    if (!plan[k] && v) {
      plan[k] = v;
      planMarks[k] = "previous";
    }
  }
  if (Object.keys(planMarks).length) marks.plan = planMarks;
  return { areas, overallStatus, summary, plan, prefill: marks };
}

/** Månaden före (förra månadens plan). */
export const previousMonth = (month: MonthKey): MonthKey => addMonths(month, -1);

/**
 * Förifyllnaden hålls aktuell när en mötesrapport i månaden godkänns efter att utkastet skapades (jobbet skapar det natten efter
 * månadsskiftet – coachen godkänner ofta den sista mötesrapporten några dagar senare). Bara fält som fortfarande är märkta som
 * automatiska, eller som inte har något värde, får den nya förifyllnadens värde:
 *   samlad status   märkt (eller inte vald) -> den senaste godkända mötesrapportens status
 *   sammanfattning  märkt "rules" (eller tom) -> den nya texten ur godkända uppgifter; AI:s utkast och coachens text rörs aldrig
 *   mål 1           märkt "check_in" (eller tomt) -> det senaste godkända veckomålet
 * changed = något ändrades. Ren funktion: samma regel i hanteraren och testerna.
 */
export function refreshPrefill(
  ma: Pick<MonthlyAssessment, "summary" | "overallStatus" | "prefill">,
  plan: Pick<PrefillPlan, "goal1"> | null,
  fresh: Prefill,
): { assessment: Pick<MonthlyAssessment, "summary" | "overallStatus" | "prefill">; plan: Pick<PrefillPlan, "goal1"> | null; changed: boolean } {
  const marks: MonthlyPrefill = { ...ma.prefill, ...(ma.prefill.plan ? { plan: { ...ma.prefill.plan } } : {}) };
  let { summary, overallStatus } = ma;
  let changed = false;
  const freshStatus = fresh.prefill.overallStatus;
  if ((marks.overallStatus || overallStatus == null) && freshStatus && fresh.overallStatus != null
    && (overallStatus !== fresh.overallStatus || marks.overallStatus?.checkInId !== freshStatus.checkInId)) {
    overallStatus = fresh.overallStatus;
    marks.overallStatus = freshStatus;
    changed = true;
  }
  if ((marks.summary === "rules" || (!marks.summary && !summary.trim())) && fresh.prefill.summary === "rules" && summary !== fresh.summary) {
    summary = fresh.summary;
    marks.summary = "rules";
    changed = true;
  }
  let planPatch: Pick<PrefillPlan, "goal1"> | null = null;
  if (plan && fresh.prefill.plan?.goal1 === "check_in" && (marks.plan?.goal1 === "check_in" || (!marks.plan?.goal1 && !plan.goal1.trim()))
    && plan.goal1 !== fresh.plan.goal1) {
    planPatch = { goal1: fresh.plan.goal1 };
    marks.plan = { ...marks.plan, goal1: "check_in" };
    changed = true;
  }
  return { assessment: { summary, overallStatus, prefill: marks }, plan: planPatch, changed };
}

// ---------------------------------------------------------------- Coachens sparning
/**
 * Nivåns ursprung efter en sparning av ett område (assessment.save). Coachen skickar ursprunget hon ser på skärmen:
 *   auto  bara med nivå 0 – annars är det coachens val
 *   ai    bara när nivån är AI-förslagets (förslaget finns i raden) – annars coachens val
 *   saknas  en ändrad nivå är coachens val, annars behålls ursprunget
 * Servern skriver aldrig själv ett AI-förslag i nivån: nivån kommer alltid från coachens sparning.
 */
export function nextLevelSource(
  cur: Pick<AreaAssessment, "level" | "levelSource" | "aiLevelSuggestion"> | null | undefined,
  level: ProgressLevel | null,
  claimed: LevelSource | undefined,
): LevelSource | undefined {
  if (claimed === "auto") return level === 0 ? "auto" : "coach";
  if (claimed === "ai") return cur?.aiLevelSuggestion != null && level === cur.aiLevelSuggestion ? "ai" : "coach";
  if (claimed === "coach") return "coach";
  if (cur && level !== cur.level) return "coach";
  return levelSourceOf(cur ? { level, levelSource: cur.levelSource } : { level, levelSource: undefined }) ?? undefined;
}

/** Fälten i planen som kan vara förifyllda. */
export const PREFILL_PLAN_FIELDS = ["goal1", "goal2", "plannedActivities", "plannedEmployerContact", "plannedAdaptation"] as const;

/**
 * Märkningen efter en sparning: ett förifyllt fält vars värde coachen ändrat är inte längre förifyllt. before/after är radens
 * och planens värden före och efter sparningen.
 */
export function keptPrefill(
  marks: MonthlyPrefill,
  before: { summary: string; overallStatus: TrafficLight | null; plan: PrefillPlan | null },
  after: { summary: string; overallStatus: TrafficLight | null; plan: PrefillPlan | null },
): MonthlyPrefill {
  const out: MonthlyPrefill = {};
  if (marks.overallStatus && after.overallStatus === before.overallStatus) out.overallStatus = marks.overallStatus;
  if (marks.summary && after.summary === before.summary) out.summary = marks.summary;
  if (marks.plan) {
    const plan: NonNullable<MonthlyPrefill["plan"]> = {};
    for (const k of PREFILL_PLAN_FIELDS) {
      const m = marks.plan[k];
      if (m && (after.plan?.[k] ?? "") === (before.plan?.[k] ?? "")) plan[k] = m;
    }
    if (Object.keys(plan).length) out.plan = plan;
  }
  return out;
}

/**
 * Märkningen för en ny rad som coachen sparar från en sida som visade förifyllnaden (raden fanns inte): de fält där coachen
 * sparar det förifyllda värdet är fortfarande förifyllda.
 */
export function prefillMarksFor(p: Prefill, saved: { summary: string; overallStatus: TrafficLight | null; plan: PrefillPlan | null }): MonthlyPrefill {
  return keptPrefill(p.prefill, { summary: p.summary, overallStatus: p.overallStatus, plan: p.plan }, saved);
}

// ---------------------------------------------------------------- Godkännandet
export type ApprovalCounts = { autoAreas: number; coachAreas: number; aiAccepted: number };

/** Områdena per ursprung (revisionsloggen vid godkännandet – bara antal). */
export function approvalCounts(areas: Readonly<Record<string, AreaAssessment>>, keys: readonly string[]): ApprovalCounts {
  const out: ApprovalCounts = { autoAreas: 0, coachAreas: 0, aiAccepted: 0 };
  for (const k of keys) {
    const s = levelSourceOf(areas[k]);
    if (s === "auto") out.autoAreas++;
    else if (s === "ai") out.aiAccepted++;
    else if (s === "coach") out.coachAreas++;
  }
  return out;
}

/**
 * Det som saknas för att godkänna: områden utan nivå, och områden från avtalets nivå (observationRequiredFromLevel) utan
 * konkret observation – den automatiska texten (AUTO_OBSERVATION) räknas inte som belägg för en nivå över 0.
 */
export function missingAreas(areas: Readonly<Record<string, AreaAssessment>>, keys: readonly string[], requiredFrom: number): string[] {
  return keys.filter((k) => {
    const a = areas[k];
    if (!a || a.level == null) return true;
    const obs = String(a.observation ?? "").trim();
    return a.level >= requiredFrom && (!obs || obs === AUTO_OBSERVATION);
  });
}

/** Har raden något som coachen inte har sett över – för listor ("Ifyllt automatiskt")? */
export function hasPrefill(ma: Pick<MonthlyAssessment, "prefill" | "areas">): boolean {
  return Object.keys(ma.prefill ?? {}).length > 0 || Object.values(ma.areas).some((a) => a?.levelSource === "auto");
}

// ---------------------------------------------------------------- AI-utkastet (jobbet draft_monthly)
export type AiAreaDraft = { observation: AiObservationDraft; suggestion: { level: ProgressLevel; evidence: AiLevelEvidence } | null };
export type AiMonthlyDraft = { areas: Record<string, AiAreaDraft>; summary: string | null; plan: string | null };

/**
 * AI-utkastet in i en månadsbedömning som inte är godkänd: utkastet och nivåförslaget med belägg per område – aldrig nivån
 * (den sätter coachen) – och, bara där fälten fortfarande är förifyllda eller tomma, sammanfattningen och planens planerade
 * aktiviteter (märkta "ai"). visible = något som coachen ser i formuläret ändrades: raden får en ny version, så att ett
 * öppet formulär inte skriver över utkastet utan att veta om det.
 */
export function applyAiDraft(
  ma: MonthlyAssessment,
  plan: PlanFields | null,
  d: AiMonthlyDraft,
): { ma: MonthlyAssessment; plan: PlanFields | null; visible: boolean } {
  const areas: Record<string, AreaAssessment> = { ...ma.areas };
  for (const [k, a] of Object.entries(d.areas)) {
    const cur = areas[k] ?? autoArea();
    const suggestion = a.observation.noEvidence ? null : a.suggestion;
    areas[k] = { ...cur, aiObservationDraft: a.observation, aiLevelSuggestion: suggestion?.level ?? null, aiLevelEvidence: suggestion?.evidence ?? null };
  }
  const marks: MonthlyPrefill = { ...ma.prefill, ...(ma.prefill.plan ? { plan: { ...ma.prefill.plan } } : {}) };
  let visible = false;
  let summary = ma.summary;
  const aiSummary = d.summary?.trim();
  if (aiSummary && (marks.summary || !summary.trim()) && summary !== aiSummary) {
    summary = aiSummary;
    marks.summary = "ai";
    visible = true;
  }
  let nextPlan = plan;
  const aiPlan = d.plan?.trim();
  if (plan && aiPlan && (marks.plan?.plannedActivities || !plan.plannedActivities.trim()) && plan.plannedActivities !== aiPlan) {
    nextPlan = { ...plan, plannedActivities: aiPlan };
    marks.plan = { ...marks.plan, plannedActivities: "ai" };
    visible = true;
  }
  return { ma: { ...ma, areas, summary, prefill: marks }, plan: nextPlan, visible };
}
