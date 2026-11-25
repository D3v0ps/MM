// Delmål för progressionerna (Karims beslut 2026-11-11, migration 0043). Ren logik utan React och utan I/O – bara för hanterarna,
// systemstegen och testerna.
//
// Ett delmål är ett konkret steg inom ett progressionsområde i avtalets katalog (progress_goals): "Har ett uppdaterat CV" under
// Beredskap för praktik, arbete eller studier. Ett delmål kan räknas mot punkter i incitamentsmodellens steg 1–2 (stepItems, se
// STEP_ITEMS i src/data/schema.ts). I ärendet (case_progress_goals) har delmålet ett läge:
//   Inte påbörjat  ingen rad.
//   Tränar         satt AUTOMATISKT (source auto) när närvaro – närvarande eller sen – registreras på ett tillfälle som tränar
//                  delmålet (deltagarens eget tillfälle eller en gruppaktivitet). Idempotent: ett delmål som redan tränas eller är
//                  uppnått rörs aldrig (aldrig nedgradering). Märks "automatiskt" och loggas.
//   Uppnått        bara en människa (coach, samordnare, avtalsansvarig) – aldrig AI – med datum och frivilligt underlag.
// En punkt i steg 1–2 är uppfylld när minst N av delmålen som räknas mot den är uppnådda (N ur avtalets bonus.stepItemMin, annars
// 1). Ett uppnått delmål är aldrig en nivå i månadsbedömningen: coachen väljer nivån själv (CLAUDE.md punkt 5).
// Internt: delmålen och taggarna visas aldrig för kommunen, i rapporter, resultatfil, export eller PDF – redovisningsunderlaget
// säger bara vilka punkter i modellen som är uppfyllda.
import type { Activity, Attendance, CaseProgressGoal, GroupActivity, ProgressGoal, ProgressGoalSource, ProgressGoalStatus, StepItem } from "@/data/schema";
import { PROGRESS_GOAL_LABEL_MAX, STEP1_ITEMS, STEP2_ITEMS, STEP_ITEMS } from "@/data/schema";
import { dayOf, fmtDate, type LocalDate, type LocalDateTime } from "./time";

// ---------------------------------------------------------------- Punkterna i steg 1–2
/** Punkterna i klarspråk – samma ord som incitamentsmodellen (redovisningsunderlaget och kortet). */
export const STEP_ITEM_LABEL: Record<StepItem, string> = {
  individuell_plan: "Genomförd individuell plan",
  ansokningshandlingar: "Förbättrade ansökningshandlingar",
  branschintroduktion: "Genomförd branschintroduktion",
  arbetsgivarnara: "Aktivt deltagande i arbetsgivarnära aktivitet",
  praktik: "Praktik eller arbetsträning",
  validering: "Validering",
  branschintyg: "Branschintyg",
  arbetsintervju: "Genomförd arbetsintervju",
  jobbspar: "Påbörjat jobbspår",
  utbildning: "Antagning till utbildningsförberedande aktivitet",
};
/** Punkterna i ett steg (1 eller 2), i modellens ordning. */
export const stepItemsOf = (step: number): readonly StepItem[] => (step === 1 ? STEP1_ITEMS : step === 2 ? STEP2_ITEMS : []);
/** Steget som punkten hör till. */
export const stepOfItem = (item: StepItem): 1 | 2 => ((STEP1_ITEMS as readonly string[]).includes(item) ? 1 : 2);
export const isStepItem = (v: string): v is StepItem => (STEP_ITEMS as readonly string[]).includes(v);

/** Antalet uppnådda delmål som krävs för punkten: avtalets bonus.stepItemMin, annars 1. */
export const stepItemMin = (m: { stepItemMin?: Partial<Record<string, number>> } | null | undefined, item: StepItem): number => {
  const n = m?.stepItemMin?.[item];
  return typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : 1;
};

export type StepItemStatus = {
  item: StepItem;
  label: string;
  step: 1 | 2;
  /** Antalet uppnådda delmål som krävs. */
  need: number;
  fulfilled: boolean;
  /** Uppnådda delmål som räknas mot punkten (äldst först). */
  goals: { id: string; label: string; achievedOn: LocalDate }[];
  /** Dagen punkten blev uppfylld: dagen då det N:te delmålet uppnåddes. null = inte uppfylld. */
  fulfilledOn: LocalDate | null;
};

/**
 * Läget för punkterna i steget (1 eller 2) i ett ärende: vilka uppnådda delmål som räknas mot varje punkt och om de räcker. goals =
 * avtalets katalog (också inaktiva – ett delmål som uppnåddes innan det inaktiverades räknas), rows = ärendets lägen. inPeriod: bara
 * delmål som uppnåddes den dagen räknas – insatsen till och med i dag (caseStepItems i bonus.ts). Ett delmål som uppnåddes före ett
 * startdatum som flyttats fram räknas inte, och dagen då punkten blev uppfylld är alltid en dag under insatsen.
 */
export function stepItemStatuses(
  step: number,
  goals: readonly Pick<ProgressGoal, "id" | "label" | "stepItems" | "contractId">[],
  rows: readonly Pick<CaseProgressGoal, "goalId" | "status" | "achievedOn" | "contractId">[],
  m: { stepItemMin?: Partial<Record<string, number>> } | null | undefined,
  inPeriod?: (day: LocalDate) => boolean,
): StepItemStatus[] {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const achieved = rows
    .filter((r) => r.status === "achieved" && !!r.achievedOn && byId.get(r.goalId)?.contractId === r.contractId && (!inPeriod || inPeriod(r.achievedOn)))
    .map((r) => ({ goal: byId.get(r.goalId)!, on: r.achievedOn as LocalDate }))
    .sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : a.goal.id < b.goal.id ? -1 : 1));
  return stepItemsOf(step).map((item) => {
    const mine = achieved.filter((x) => x.goal.stepItems.includes(item));
    const need = stepItemMin(m, item);
    const fulfilled = mine.length >= need;
    return {
      item, label: STEP_ITEM_LABEL[item], step: stepOfItem(item), need, fulfilled,
      goals: mine.map((x) => ({ id: x.goal.id, label: x.goal.label, achievedOn: x.on })),
      fulfilledOn: fulfilled ? mine[need - 1].on : null,
    };
  });
}
/** Steg 1: alla fyra punkterna är uppfyllda. */
export const step1ItemsMet = (items: readonly StepItemStatus[]): boolean => items.length > 0 && items.every((x) => x.fulfilled);
/** Steg 2: den tidigaste dagen då någon punkt blev uppfylld, eller null. */
export const step2ReachedOn = (items: readonly StepItemStatus[]): LocalDate | null =>
  items.map((x) => x.fulfilledOn).filter((d): d is LocalDate => !!d).sort()[0] ?? null;

// ---------------------------------------------------------------- Läget i ärendet
export type GoalState = ProgressGoalStatus | "none";
/** Läget som text och ikon (status visas alltid som text och ikon, aldrig bara färg). */
export const GOAL_STATE_ICON: Record<GoalState, "circle" | "activity" | "check-circle"> = { none: "circle", training: "activity", achieved: "check-circle" };
/** "Inte påbörjat", "Tränar (automatiskt)", "Tränar" eller "Uppnått 12 jan 2027". */
export function goalStateText(row: Pick<CaseProgressGoal, "status" | "source" | "achievedOn"> | null | undefined): string {
  if (!row) return "Inte påbörjat";
  if (row.status === "training") return row.source === "auto" ? "Tränar (automatiskt)" : "Tränar";
  return row.achievedOn ? `Uppnått ${fmtDate(row.achievedOn)}` : "Uppnått";
}
/**
 * Dagen för Uppnått: i dag eller tidigare, inte före insatsens startdatum (också databasen prövar det, 0043). null = godkänd, annars
 * felet i klarspråk. Samma prövning i hanteraren (delmal.uppnatt) och i dialogerna innan något sparas.
 */
export function achievedOnProblem(day: LocalDate, startDate: LocalDate | null, today: LocalDate): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Välj datum.";
  if (day > today) return "Datumet kan inte vara i framtiden.";
  if (startDate && day < startDate) return `Datumet kan inte vara före startdatumet ${fmtDate(startDate)}.`;
  return null;
}
/** Radens fasta id: ett läge per ärende och delmål (också primärnyckeln stoppar en andra rad). */
export const caseGoalId = (caseId: string, goalId: string): string => `cpg-${caseId}-${goalId}`;

// ---------------------------------------------------------------- Tränar automatiskt
/** Närvaro som räknas som träning: närvarande eller sen. */
export const TRAINING_ATTENDANCE: readonly Attendance["status"][] = ["present", "late"];

export type TrainingRow = { caseId: string; contractId: string; goalId: string; activityId: string; day: LocalDate };
/**
 * Vilka delmål som ska få Tränar automatiskt (ren regel, idempotent): för varje tillfälle med närvaro (närvarande eller sen) och
 * delmål – deltagarens eget tillfälle (ownTags: activity_progress_goals, tillfällets id → delmålen) eller gruppaktivitetens
 * (group_activities.progressGoalIds; aldrig en inställd aktivitet) – en rad per ärende och delmål som ännu inte har något läge. Ett
 * delmål som redan tränas eller är uppnått rörs aldrig. Bara aktiva delmål i ärendets avtal. Det tidigaste tillfället (sedan id) blir
 * underlaget.
 */
export function trainingRowsToAdd(x: {
  activities: readonly Pick<Activity, "id" | "caseId" | "startsAt" | "groupActivityId">[];
  ownTags: ReadonlyMap<string, readonly string[]>;
  groupActivities: readonly Pick<GroupActivity, "id" | "progressGoalIds" | "cancelledAt">[];
  attendance: readonly Pick<Attendance, "activityId" | "status">[];
  goals: readonly Pick<ProgressGoal, "id" | "contractId" | "active">[];
  existing: readonly Pick<CaseProgressGoal, "caseId" | "goalId">[];
  contractOfCase: ReadonlyMap<string, string>;
}): TrainingRow[] {
  const goalById = new Map(x.goals.map((g) => [g.id, g]));
  const groupTags = new Map(x.groupActivities.filter((g) => !g.cancelledAt).map((g) => [g.id, g.progressGoalIds ?? []]));
  const trained = new Set(x.attendance.filter((a) => TRAINING_ATTENDANCE.includes(a.status)).map((a) => a.activityId));
  const taken = new Set(x.existing.map((r) => `${r.caseId}|${r.goalId}`));
  const out: TrainingRow[] = [];
  const acts = [...x.activities].sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : a.id < b.id ? -1 : 1));
  for (const a of acts) {
    if (!trained.has(a.id)) continue;
    const contractId = x.contractOfCase.get(a.caseId);
    if (!contractId) continue;
    const tags = a.groupActivityId ? (groupTags.get(a.groupActivityId) ?? []) : (x.ownTags.get(a.id) ?? []);
    for (const goalId of tags) {
      const g = goalById.get(goalId);
      if (!g || !g.active || g.contractId !== contractId) continue;
      const key = `${a.caseId}|${goalId}`;
      if (taken.has(key)) continue;
      taken.add(key);
      out.push({ caseId: a.caseId, contractId, goalId, activityId: a.id, day: dayOf(a.startsAt) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Katalogen
/** Delmålets namn: 1–120 tecken (utan blanksteg först och sist). null = godkänt, annars felet i klarspråk. */
export function goalLabelProblem(label: string): string | null {
  const t = label.trim();
  if (!t) return "Skriv delmålet.";
  if ([...t].length > PROGRESS_GOAL_LABEL_MAX) return `Delmålet får vara högst ${PROGRESS_GOAL_LABEL_MAX} tecken.`;
  return null;
}
/** Samma namn (utan skillnad på stora och små bokstäver och blanksteg). */
export const sameGoalLabel = (a: string, b: string): boolean => a.trim().replace(/\s+/g, " ").toLocaleLowerCase("sv") === b.trim().replace(/\s+/g, " ").toLocaleLowerCase("sv");

/**
 * Taggarna på ett tillfälle (ny lista mot den förra): alla delmål finns i avtalet, inga dubbletter, högst max, och de som läggs till
 * är aktiva (ett delmål som inaktiverats får ligga kvar där det redan stod). null = godkänt, annars felet i klarspråk.
 */
export function goalTagsProblem(
  next: readonly string[],
  before: readonly string[],
  goals: readonly Pick<ProgressGoal, "id" | "contractId" | "active">[],
  contractId: string,
  max: number,
): string | null {
  if (new Set(next).size !== next.length) return "Samma delmål är valt två gånger.";
  if (next.length > max) return `Välj högst ${max} delmål.`;
  const byId = new Map(goals.map((g) => [g.id, g]));
  for (const id of next) {
    const g = byId.get(id);
    if (!g || g.contractId !== contractId) return "Ett av delmålen finns inte i avtalet. Ladda om sidan.";
    if (!g.active && !before.includes(id)) return "Ett av delmålen är inaktiverat och kan inte väljas. Ladda om sidan.";
  }
  return null;
}

// ---------------------------------------------------------------- Startlistan (Karims godkännande 2026-11-11)
/** Ett delmål i startlistan: fast nummer (id:t), område, namn och punkterna i steg 1–2. */
export type DefaultGoal = { n: number; areaKey: string; label: string; stepItems: StepItem[] };
/**
 * Startlistan för Botkyrkaavtalet, godkänd av Karim 2026-11-11. Samma lista i testdatat (src/data/seed) och i produktionen
 * (supabase/manual/2026-11-delmal-botkyrka.sql – samma nummer och samma id). Övrig relevant progression har inga delmål än.
 */
export const DEFAULT_PROGRESS_GOALS: readonly DefaultGoal[] = [
  { n: 1, areaKey: "narvaro_rutiner", label: "Kommer i tid tre veckor i rad", stepItems: [] },
  { n: 2, areaKey: "narvaro_rutiner", label: "Meddelar frånvaro innan tillfället", stepItems: [] },
  { n: 3, areaKey: "narvaro_rutiner", label: "Håller en egen veckoplan", stepItems: ["individuell_plan"] },
  { n: 4, areaKey: "yrkesfardigheter", label: "Genomfört branschintroduktion", stepItems: ["branschintroduktion"] },
  { n: 5, areaKey: "yrkesfardigheter", label: "Utför en arbetsuppgift självständigt i yrkesmoment", stepItems: [] },
  { n: 6, areaKey: "yrkesfardigheter", label: "Klarat ett branschintyg eller en validering", stepItems: ["branschintyg", "validering"] },
  { n: 7, areaKey: "arbetskapacitet", label: "Klarar ett helt tillfälle utan avbrott", stepItems: [] },
  { n: 8, areaKey: "arbetskapacitet", label: "Klarar tre tillfällen i veckan", stepItems: [] },
  { n: 9, areaKey: "sjalvstandighet", label: "Bokar och håller egna möten", stepItems: [] },
  { n: 10, areaKey: "sjalvstandighet", label: "Följer sin individuella plan", stepItems: ["individuell_plan"] },
  { n: 11, areaKey: "digital_sjalvstandighet", label: "Kan starta och logga in på en dator", stepItems: [] },
  { n: 12, areaKey: "digital_sjalvstandighet", label: "Loggar in på sin e-post via dator", stepItems: [] },
  { n: 13, areaKey: "digital_sjalvstandighet", label: "Söker jobb via datorn (Platsbanken eller annan sajt)", stepItems: ["ansokningshandlingar"] },
  { n: 14, areaKey: "digital_sjalvstandighet", label: "Skickar en ansökan med bifogat CV", stepItems: ["ansokningshandlingar"] },
  { n: 15, areaKey: "instruktioner", label: "Följer en muntlig instruktion i flera steg", stepItems: [] },
  { n: 16, areaKey: "instruktioner", label: "Följer en skriftlig arbetsinstruktion", stepItems: [] },
  { n: 17, areaKey: "arbetsgivarkontakter", label: "Deltagit i en arbetsgivarnära aktivitet", stepItems: ["arbetsgivarnara"] },
  { n: 18, areaKey: "arbetsgivarkontakter", label: "Tagit egen kontakt med en arbetsgivare", stepItems: [] },
  { n: 19, areaKey: "arbetsgivarkontakter", label: "Genomfört en arbetsintervju", stepItems: ["arbetsintervju"] },
  { n: 20, areaKey: "beredskap", label: "Har ett uppdaterat CV", stepItems: ["ansokningshandlingar"] },
  { n: 21, areaKey: "beredskap", label: "Har ett personligt brev", stepItems: ["ansokningshandlingar"] },
  { n: 22, areaKey: "beredskap", label: "Påbörjat praktik eller arbetsträning", stepItems: ["praktik"] },
  { n: 23, areaKey: "beredskap", label: "Antagen till utbildningsförberedande aktivitet eller jobbspår", stepItems: ["jobbspar", "utbildning"] },
  { n: 24, areaKey: "sprak_kommunikation", label: "Presenterar sig själv för en arbetsgivare", stepItems: [] },
  { n: 25, areaKey: "sprak_kommunikation", label: "Skriver ett kort mejl på svenska", stepItems: [] },
];
/** Startlistans id: avtalet och numret (två siffror) – inga ord, så att id:t aldrig säger något om delmålet. */
export const defaultGoalId = (contractId: string, n: number): string => `pg-${contractId}-${String(n).padStart(2, "0")}`;
/** Startlistan som rader i ett avtal. Ordningen inom området: 10, 20, 30 … (plats för nya emellan). */
export function defaultProgressGoals(contractId: string, at: LocalDateTime, by = "system"): ProgressGoal[] {
  const seen = new Map<string, number>();
  return DEFAULT_PROGRESS_GOALS.map((g) => {
    const i = (seen.get(g.areaKey) ?? 0) + 1;
    seen.set(g.areaKey, i);
    return {
      id: defaultGoalId(contractId, g.n), contractId, areaKey: g.areaKey, label: g.label, sortOrder: i * 10, active: true, stepItems: [...g.stepItems], createdBy: by, createdAt: at,
      updatedBy: null, updatedAt: null,
    };
  });
}

/** Katalogen i ordning: områdets ordning, sedan sortOrder och namnet. */
export function sortGoals<T extends Pick<ProgressGoal, "areaKey" | "sortOrder" | "label" | "id">>(goals: readonly T[], areaOrder: readonly string[]): T[] {
  const pos = (k: string) => { const i = areaOrder.indexOf(k); return i < 0 ? areaOrder.length : i; };
  return [...goals].sort((a, b) => pos(a.areaKey) - pos(b.areaKey) || a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "sv") || (a.id < b.id ? -1 : 1));
}
/**
 * Delmålen som visas i ett ärende: de aktiva och de inaktiverade som ärendet har ett läge för, bara i avtalets progressionsområden.
 * Samma urval för kortet Delmål (delmal.arende) och för om deltagarkortet har fliken Delmål (Karims beslut 2026-11-25).
 */
export function shownCaseGoals<T extends Pick<ProgressGoal, "id" | "active" | "areaKey">>(goals: readonly T[], caseGoalIds: ReadonlySet<string>, areaKeys: readonly string[]): T[] {
  return goals.filter((g) => (g.active || caseGoalIds.has(g.id)) && areaKeys.includes(g.areaKey));
}

/** Källan i klarspråk för loggens text och kortet. */
export const goalSourceText = (s: ProgressGoalSource): string => (s === "auto" ? "automatiskt" : "av Miljonbemanning");
