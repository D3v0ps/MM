// Intern månadsrapport (Karims beslut 2026-11-18): allt som hände i ett avtal under en kalendermånad, per yrkesområde och per
// deltagare. Bara för Miljonbemanning – aldrig för kommunen. Samma vy-modell på sidan (/manadsrapport) och i PDF:en.
//
// Ren funktion utan I/O: hanteraren (handlers.ts) läser underlaget via ctx.repo (behörigheten) och anropar buildMonthlyOverview.
// Regler (CLAUDE.md punkt 5 och 6):
//   - Bara godkända eller registrerade uppgifter: godkända månadsbedömningar, registrerad närvaro (också den automatiska, som
//     närvarograden i övrigt), delmål som en människa markerat uppnådda, registrerade händelser och avslut, och stegen i
//     Progression och resultat som är skickade till eller godkända av kommunen (förslagen från regeln räknas inte).
//   - Aldrig råtranskript, AI-utkast, gruppmål (group_activities.goal, group_goal_results), nivåer eller taggar – underlaget har
//     inte ens fälten.
//   - Progressionsnivåerna 0–3 bara som fördelning – aldrig ett medelvärde.
//   - Yrkesområdet är det som gällde månaden (areaForMonth – samma regel som fakturan och månadsrapporten till kommunen).
//   - Närvarograden räknas som nyckeltalet (attendanceStats: närvarande och sena av registrerade passerade tillfällen). Att
//     deltagaren inte kom till första mötet (first_meeting_no_shows) är inget tillfälle och läses aldrig.
//   - Resultatgraden räknas som nyckeltalet (resultRate) och notisen om litet underlag läser gränsen ur kpis.
//   - Inga belopp, inga personnummer. Namnet kommer från hanteraren (läsarens behörighet).
import { areaForMonth } from "@/core/area-changes";
import { attendanceStats, type AttendanceStats } from "@/core/attendance";
import { bonusModel, kpiDef, progressionAreas, progressionFlags, type OperationalConfig, type ProgressLevel } from "@/core/config";
import { progressStepLabel } from "@/core/bonus";
import { pct, plural } from "@/core/format";
import { resultRate, type ResultStatus } from "@/core/kpi";
import { endReasonLabel, eventLabel, RESULT_CLASS_LABEL } from "@/core/labels";
import { enrolledDays, needsAssessment } from "@/core/report-schedule";
import { addMonths, dayOf, fmtDate, fmtDateShort, monthEnd, monthKey, monthName, type LocalDate, type LocalDateTime, type MonthKey } from "@/core/time";
import {
  ACTIVITY_KINDS, END_REASONS, OUTCOME_EVENT_KINDS,
  type Activity, type ActivityKind, type ActivityProgressGoal, type Attendance, type BonusClaim, type Case, type CaseAreaChange, type CaseProgressGoal,
  type ContractArea, type GroupActivity, type MonthlyAssessment, type OutcomeEvent, type ProgressGoal,
} from "@/data/schema";

// ================================================================ Underlaget
/** Tabellerna som rapporten byggs av – bara fälten som behövs. Gruppaktiviteterna har aldrig gruppmålet. */
export type OverviewDb = {
  /** Avtalets ärenden (läsarens behörighet). */
  cases: readonly Case[];
  case_area_changes: readonly Pick<CaseAreaChange, "id" | "caseId" | "fromArea" | "toArea" | "effectiveMonth" | "changedAt" | "seq">[];
  contract_areas: readonly Pick<ContractArea, "code" | "name">[];
  /** Tillfällen i månaden för ärendena i urvalet. */
  activities: readonly Pick<Activity, "id" | "caseId" | "kind" | "startsAt" | "groupActivityId">[];
  /** Närvaron på tillfällena (också den automatiska). */
  attendance: readonly Pick<Attendance, "id" | "activityId" | "caseId" | "status" | "reason">[];
  /** Gruppaktiviteterna som tillfällena hör till – utan namn och utan gruppmål. */
  group_activities: readonly Pick<GroupActivity, "id" | "kind" | "startsAt" | "cancelledAt" | "progressGoalIds">[];
  /** Delmålen på deltagarnas egna tillfällen (id = tillfällets id). */
  activity_progress_goals: readonly Pick<ActivityProgressGoal, "id" | "caseId" | "goalIds">[];
  /** Månadsbedömningarna för månaden – bara de godkända räknas. */
  monthly_assessments: readonly Pick<MonthlyAssessment, "id" | "caseId" | "month" | "status" | "areas">[];
  /** Avtalets delmål (också inaktiva). */
  progress_goals: readonly Pick<ProgressGoal, "id" | "areaKey" | "label" | "sortOrder">[];
  /** Delmålens lägen – bara Uppnått räknas här (Tränar räknas ur närvaron på tillfällena i månaden). */
  case_progress_goals: readonly Pick<CaseProgressGoal, "id" | "caseId" | "goalId" | "status" | "source" | "achievedOn">[];
  outcome_events: readonly Pick<OutcomeEvent, "id" | "caseId" | "kind" | "occurredOn" | "verificationKind">[];
  /** Stegen i Progression och resultat – inga belopp (raden har aldrig något). Tom när läsaren inte får se dem. */
  bonus_claims: readonly Pick<BonusClaim, "id" | "caseId" | "step" | "status" | "reachedOn">[];
};

export type OverviewEnv = {
  cfg: OperationalConfig;
  contractStart: LocalDate;
  /** ctx.now() */
  now: LocalDateTime;
  month: MonthKey;
  /** Yrkesområdets kod (A–L) eller null = alla. */
  area: string | null;
  /** Deltagarens namn enligt läsarens behörighet. */
  name: (caseId: string) => string;
  /**
   * Stegen i Progression och resultat och Miljonbemannings interna mål visas (false för en begränsad testare i testmiljön –
   * de är ekonomiska villkor, src/api/tester-access.ts).
   */
  showCommercial: boolean;
};

// ================================================================ Vy-modellen
export type FlowRow = { code: string; label: string; atStart: number; started: number; ended: number; atEnd: number };
export type CountRow = { key: string; label: string; count: number };
export const CLOSURE_CLASSES = ["result_verified", "result_prelim", "no_result", "excluded", "unclassified"] as const;
/** Avsluten efter hur de räknas i resultatgraden. counted = räknas i nämnaren. */
export type ClosureRow = { key: (typeof CLOSURE_CLASSES)[number]; label: string; count: number; counted: boolean };
export type AttendanceRow = {
  key: string; label: string; planned: number; registered: number; present: number; late: number; absentValid: number; absentInvalid: number; unregistered: number;
  rate: number | null; rateText: string;
};
/** Fördelningen per progressionsområde: antal deltagare per nivå 0–3 – aldrig ett medelvärde. */
export type LevelRow = { key: string; label: string; levels: [number, number, number, number]; notAssessed: number; achieved: number; trained: number };
export type GoalRow = { id: string; label: string; areaLabel: string; participants: number; sessions?: number };
export type ActivityKindRow = { kind: ActivityKind; label: string; held: number; inGroup: number; participants: number; rate: number | null; rateText: string; goals: number };
export type EventRow = { kind: string; label: string; count: number; verified: number; participants: number };
export type StepRow = { step: number; label: string; submitted: number; approved: number };
export type RateView = {
  /** "januari 2027", "augusti 2026 – januari 2027". */
  period: string;
  value: number | null; valueText: string; num: number; den: number; prelim: number;
  status: ResultStatus; statusText: string;
  /** "Underlaget är litet (färre än 10 avslut som räknas). Jämför försiktigt." – gränsen ur kpis. */
  note: string | null;
  contractTarget: number | null; internalTarget: number | null;
};
export type ParticipantRow = {
  caseId: string; caseNumber: string; name: string; areaCode: string; areaLabel: string;
  startDate: LocalDate | null; endDate: LocalDate | null; startText: string; endText: string; startedInMonth: boolean; endedInMonth: boolean;
  /** "29 okt 2026 – 1 jan 2027" eller "Från 14 dec 2026". */
  periodText: string;
  /** rateText "85,7 %", detail "6 av 7" (närvarande och sena av registrerade), text båda ihop. */
  attendance: { rate: number | null; rateText: string; detail: string; text: string; registered: number; attended: number };
  progression: { state: "clear" | "any" | "none" | "not_approved" | "not_needed"; text: string };
  goals: { achieved: number; trained: number; text: string };
  activities: { held: number; inGroup: number; text: string };
  results: string[];
  resultText: string;
};

export type ChartBar = { key: string; label: string; value: number; valueText: string };
export type ChartTarget = { kind: "contract" | "internal"; value: number; label: string };
export type BarChartSpec = { title: string; unit: "antal" | "andel"; bars: ChartBar[]; targets: ChartTarget[]; ariaLabel: string };
export type FlowChartSpec = { title: string; rows: { key: string; label: string; started: number; ended: number }[]; ariaLabel: string };

export type MonthlyOverview = {
  month: MonthKey;
  monthLabel: string;
  /** Månaden pågår (klockans månad): siffrorna gäller till och med i dag. */
  partial: boolean;
  area: { code: string; label: string } | null;
  totals: { participants: number; atStart: number; started: number; ended: number; atEnd: number };
  flow: { rows: FlowRow[]; total: FlowRow; endReasons: CountRow[]; chart: FlowChartSpec };
  attendance: { total: AttendanceRow; byArea: AttendanceRow[]; chart: BarChartSpec };
  progression: {
    /** Deltagare som ska ha en månadsbedömning för månaden (needsAssessment). */
    required: number;
    approved: number;
    clear: number;
    any: number;
    /** "Tydlig progression, nivå 2 eller högre" – gränserna ur avtalet (progression.clearFromLevel, anyFromLevel). */
    clearLabel: string;
    anyLabel: string;
    /** "0 – Ingen / för tidigt att bedöma" … (skalan ur avtalet). */
    scale: [string, string, string, string];
    areas: LevelRow[];
    total: LevelRow;
    optional: LevelRow[];
    achieved: GoalRow[];
    achievedCount: number;
    trainedCount: number;
    levelChart: BarChartSpec;
    goalChart: BarChartSpec;
  };
  activities: { held: number; groupActivities: number; withGoals: number; rate: number | null; rateText: string; byKind: ActivityKindRow[]; goals: GoalRow[]; chart: BarChartSpec };
  results: {
    events: EventRow[];
    eventsTotal: number;
    verifiedTotal: number;
    closures: ClosureRow[];
    closedTotal: number;
    month: RateView;
    rolling: RateView;
    /** null = visas inte (avtalet saknar stegen eller läsaren är en begränsad testare). */
    steps: StepRow[] | null;
    chart: BarChartSpec;
  };
  participants: ParticipantRow[];
};

// ================================================================ Texter
export const KIND_LABEL: Record<ActivityKind, string> = { möte: "Coachträff", yrkesmoment: "Yrkesmoment", praktikdag: "Praktikdag", arbetsgivarbesök: "Arbetsgivarbesök", annat: "Annan aktivitet" };
const RATE_STATUS_TEXT: Record<ResultStatus, string> = {
  ok: "Når målet", below_internal: "Under det interna målet", below_contract: "Under avtalets mål", insufficient: "För litet underlag",
};
const CLOSURE_LABEL: Record<ClosureRow["key"], string> = {
  result_verified: "Resultat, verifierat", result_prelim: "Resultat, väntar på verifiering", no_result: RESULT_CLASS_LABEL.no_result,
  excluded: RESULT_CLASS_LABEL.excluded, unclassified: "Inte klassat",
};
const PROGRESSION_TEXT: Record<ParticipantRow["progression"]["state"], string> = {
  clear: "Tydlig progression", any: "Någon progression", none: "Ingen progression", not_approved: "Inte godkänd", not_needed: "Ingen bedömning",
};
/** "41,7 %" eller "–". */
export const rateText = (v: number | null): string => pct(v);
const NONE_AREA = "–";

// ================================================================ Byggstenar
const endOf = (c: Pick<Case, "status" | "endDate" | "closedAt">): LocalDate | null => c.endDate ?? (c.status === "closed" && c.closedAt ? dayOf(c.closedAt) : null);
const isClosed = (c: Pick<Case, "status">) => c.status === "closed";

function attRow(key: string, label: string, st: AttendanceStats): AttendanceRow {
  const registered = st.planned - st.unregistered;
  return {
    key, label, planned: st.planned, registered, present: st.present, late: st.late, absentValid: st.absentValid, absentInvalid: st.absentInvalid,
    unregistered: st.unregistered, rate: st.rate, rateText: rateText(st.rate),
  };
}

const emptyLevels = (): [number, number, number, number] => [0, 0, 0, 0];

/** Diagrammets text för skärmläsare: rubriken och varje stapel med värdet. */
function barAria(title: string, bars: readonly ChartBar[], targets: readonly ChartTarget[]): string {
  const xs = bars.length ? bars.map((b) => `${b.label}: ${b.valueText}`).join(". ") : "Inga uppgifter";
  const ts = targets.map((t) => `${t.label} ${pct(t.value)}`).join(". ");
  return `${title}. ${xs}.${ts ? ` ${ts}.` : ""}`;
}
function barChart(title: string, unit: BarChartSpec["unit"], bars: ChartBar[], targets: ChartTarget[] = []): BarChartSpec {
  return { title, unit, bars, targets, ariaLabel: barAria(title, bars, targets) };
}
const countBar = (key: string, label: string, value: number): ChartBar => ({ key, label, value, valueText: String(value) });

/** Resultatgraden med status och notisen om litet underlag – samma räkning som nyckeltalet (resultRate). */
function rateView(cases: readonly Case[], from: LocalDate, to: LocalDate, period: string, env: OverviewEnv): RateView {
  const r = resultRate({ cases: [...cases] }, { from, to }, { cfg: env.cfg, now: env.now, contractStart: env.contractStart });
  const internalTarget = env.showCommercial ? r.internalTarget : null;
  // Statusen utan det interna målet för den som inte får se det (samma ordning som resultRate).
  let status: ResultStatus = "ok";
  if (r.den < r.minN) status = "insufficient";
  else if (r.value != null && r.contractTarget != null && r.value < r.contractTarget) status = "below_contract";
  else if (r.value != null && internalTarget != null && r.value < internalTarget) status = "below_internal";
  const minN = kpiDef(env.cfg, "resultatgrad")?.minN ?? 0;
  return {
    period, value: r.value, valueText: rateText(r.value), num: r.num, den: r.den, prelim: r.prelim, status, statusText: RATE_STATUS_TEXT[status],
    note: minN > 0 && r.den < minN ? `Underlaget är litet (färre än ${minN} avslut som räknas). Jämför försiktigt.` : null,
    contractTarget: r.contractTarget, internalTarget,
  };
}

// ================================================================ Rapporten
export function buildMonthlyOverview(db: OverviewDb, env: OverviewEnv): MonthlyOverview {
  const { cfg, month: M } = env;
  const from = `${M}-01`;
  const to = monthEnd(M);
  const today = dayOf(env.now);
  const areaLabelOf = (code: string | null): string => {
    if (!code) return NONE_AREA;
    const a = db.contract_areas.find((x) => x.code === code);
    return a ? `${code} ${a.name}` : code;
  };
  const areaOf = (c: Pick<Case, "id" | "primaryAreaCode">, mk: MonthKey): string => areaForMonth(c, db.case_area_changes, mk) ?? "";
  const inArea = (c: Case, mk: MonthKey) => !env.area || areaOf(c, mk) === env.area;

  // ---- Urvalet: deltagare som var inskrivna någon dag i månaden, i yrkesområdet som gällde månaden.
  const scope = db.cases.filter((c) => enrolledDays(c, from, to) > 0 && inArea(c, M));
  const scopeIds = new Set(scope.map((c) => c.id));
  const areaCode = new Map(scope.map((c) => [c.id, areaOf(c, M)]));

  // ---- 1. Start och slut per yrkesområde (flödet går ihop: vid start + startade − avslutade = vid slut).
  const startedBefore = (c: Case) => !!c.startDate && c.startDate < from;
  const startedIn = (c: Case) => !!c.startDate && c.startDate >= from && c.startDate <= to;
  const endedIn = (c: Case) => isClosed(c) && !!endOf(c) && (endOf(c) as LocalDate) >= from && (endOf(c) as LocalDate) <= to;
  const flowOf = (code: string, label: string, cs: readonly Case[]): FlowRow => ({
    code, label, atStart: cs.filter(startedBefore).length, started: cs.filter(startedIn).length, ended: cs.filter(endedIn).length,
    atEnd: cs.filter((c) => !endedIn(c)).length,
  });
  const codes = [...new Set(scope.map((c) => areaCode.get(c.id) ?? ""))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "sv")));
  const flowRows = codes.map((code) => flowOf(code, areaLabelOf(code || null), scope.filter((c) => (areaCode.get(c.id) ?? "") === code)));
  const flowTotal = flowOf("total", "Totalt", scope);
  const ended = scope.filter(endedIn);
  const endReasons: CountRow[] = [...END_REASONS, null]
    .map((k) => ({ key: k ?? "saknas", label: k ? endReasonLabel(k) : "Avslutsorsak saknas", count: ended.filter((c) => (c.endReason ?? null) === k).length }))
    .filter((x) => x.count > 0);

  // ---- 2. Närvarograd (samma räkning som nyckeltalet: närvarande och sena av registrerade passerade tillfällen).
  const acts = db.activities.filter((a) => scopeIds.has(a.caseId) && dayOf(a.startsAt) >= from && dayOf(a.startsAt) <= to);
  const actIds = new Set(acts.map((a) => a.id));
  const att = db.attendance.filter((x) => actIds.has(x.activityId));
  const statsFor = (caseIds: ReadonlySet<string> | null, filter: (a: (typeof acts)[number]) => boolean = () => true): AttendanceStats =>
    attendanceStats({ activities: acts.filter((a) => (!caseIds || caseIds.has(a.caseId)) && filter(a)) as Activity[], attendance: att as Attendance[] }, null, from, to, { now: env.now });
  const attTotal = attRow("total", "Totalt", statsFor(null));
  const attByArea = codes.map((code) => attRow(code || "saknas", areaLabelOf(code || null), statsFor(new Set(scope.filter((c) => (areaCode.get(c.id) ?? "") === code).map((c) => c.id)))));
  const attTarget = kpiDef(cfg, "narvarograd");
  const attTargets: ChartTarget[] = [];
  if (attTarget?.contractTarget != null) attTargets.push({ kind: "contract", value: attTarget.contractTarget, label: "Avtalets mål" });
  if (env.showCommercial && typeof attTarget?.internalTarget === "number") attTargets.push({ kind: "internal", value: attTarget.internalTarget, label: "Internt mål" });

  // ---- Delmålen på tillfällena (egna tillfällen: activity_progress_goals; gruppaktiviteter: aktivitetens delmål, aldrig en inställd).
  const goalById = new Map(db.progress_goals.map((g) => [g.id, g]));
  const ownTags = new Map(db.activity_progress_goals.map((r) => [r.id, r.goalIds ?? []]));
  const groupById = new Map(db.group_activities.map((g) => [g.id, g]));
  const tagsOf = (a: (typeof acts)[number]): string[] => {
    if (a.groupActivityId) {
      const g = groupById.get(a.groupActivityId);
      return g && !g.cancelledAt ? (g.progressGoalIds ?? []).filter((id) => goalById.has(id)) : [];
    }
    return (ownTags.get(a.id) ?? []).filter((id) => goalById.has(id));
  };
  const passed = acts.filter((a) => a.startsAt < env.now);
  const attByActivity = new Map(att.map((x) => [x.activityId, x]));
  const trainedHere = (a: (typeof acts)[number]) => {
    const s = attByActivity.get(a.id)?.status;
    return s === "present" || s === "late";
  };
  /** Delmål som deltagaren tränade i månaden: närvarande eller sen på ett tillfälle som tränar delmålet (samma regel som Tränar). */
  const trainedPairs = new Set<string>();
  for (const a of passed) if (trainedHere(a)) for (const g of tagsOf(a)) trainedPairs.add(`${a.caseId}|${g}`);

  // ---- 3. Progression: godkända bedömningar (fördelning per nivå) och delmål som en människa markerat uppnådda i månaden.
  const approved = db.monthly_assessments.filter((m) => m.month === M && m.status === "approved" && scopeIds.has(m.caseId));
  const approvedByCase = new Map(approved.map((m) => [m.caseId, m]));
  const minDays = cfg.reportSchedule?.monthly?.minEnrolledDays;
  const required = scope.filter((c) => needsAssessment(c, M, minDays)).length;
  const flags = approved.map((m) => progressionFlags(cfg, m.areas));
  const achievedRows = db.case_progress_goals.filter(
    (r) => scopeIds.has(r.caseId) && r.status === "achieved" && r.source === "manual" && !!r.achievedOn && r.achievedOn >= from && r.achievedOn <= to && goalById.has(r.goalId),
  );
  const levelRow = (key: string, label: string): LevelRow => {
    const levels = emptyLevels();
    let notAssessed = 0;
    for (const m of approved) {
      const lv = m.areas[key]?.level;
      if (lv === 0 || lv === 1 || lv === 2 || lv === 3) levels[lv]++;
      else notAssessed++;
    }
    const inAreaGoal = (goalId: string) => goalById.get(goalId)?.areaKey === key;
    return {
      key, label, levels, notAssessed,
      achieved: achievedRows.filter((r) => inAreaGoal(r.goalId)).length,
      trained: [...trainedPairs].filter((p) => inAreaGoal(p.split("|")[1])).length,
    };
  };
  const areasMain = progressionAreas(cfg).map((a) => levelRow(a.key, a.label));
  // De valfria områdena (hälsa, livskvalitet) står för sig och räknas aldrig i summorna – och bara när något är bedömt i dem.
  const areasOptional = cfg.progression.optionalAreas
    .map((k) => levelRow(k, cfg.progression.areaLabels[k] ?? k))
    .filter((r) => r.levels.some((n) => n > 0) || r.achieved > 0 || r.trained > 0);
  const totalLevels = emptyLevels();
  for (const r of areasMain) for (let i = 0; i < 4; i++) totalLevels[i] += r.levels[i];
  // Summan av nivåerna gäller de obligatoriska områdena; delmålen räknas alla (samma tal som rutorna Uppnådda och Tränade delmål).
  const levelTotal: LevelRow = {
    key: "total", label: "Totalt", levels: totalLevels, notAssessed: areasMain.reduce((s, r) => s + r.notAssessed, 0),
    achieved: achievedRows.length, trained: trainedPairs.size,
  };
  const scaleText = (lv: ProgressLevel) => `${lv} – ${cfg.progression.scale[String(lv) as "0" | "1" | "2" | "3"]}`;
  const scale: [string, string, string, string] = [scaleText(0), scaleText(1), scaleText(2), scaleText(3)];
  const areaOrder = [...cfg.progression.areas, ...cfg.progression.optionalAreas];
  const areaLabel = (key: string) => cfg.progression.areaLabels[key] ?? key;
  const goalSort = (a: string, b: string) => {
    const ga = goalById.get(a)!;
    const gb = goalById.get(b)!;
    const ia = areaOrder.indexOf(ga.areaKey);
    const ib = areaOrder.indexOf(gb.areaKey);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || ga.sortOrder - gb.sortOrder || ga.label.localeCompare(gb.label, "sv") || (a < b ? -1 : 1);
  };
  const achievedGoals: GoalRow[] = [...new Set(achievedRows.map((r) => r.goalId))].sort(goalSort).map((id) => ({
    id, label: goalById.get(id)!.label, areaLabel: areaLabel(goalById.get(id)!.areaKey), participants: new Set(achievedRows.filter((r) => r.goalId === id).map((r) => r.caseId)).size,
  }));

  // ---- 4. Aktiviteter: passerade tillfällen i månaden (egna och i gruppaktiviteter), närvaron på dem och delmålen de tränade.
  const byKind: ActivityKindRow[] = ACTIVITY_KINDS.map((kind) => {
    const xs = passed.filter((a) => a.kind === kind);
    const st = statsFor(null, (a) => a.kind === kind);
    return {
      kind, label: KIND_LABEL[kind], held: xs.length, inGroup: xs.filter((a) => !!a.groupActivityId).length, participants: new Set(xs.map((a) => a.caseId)).size,
      rate: st.rate, rateText: rateText(st.rate), goals: new Set(xs.flatMap(tagsOf)).size,
    };
  }).filter((r) => r.held > 0);
  const taggedActs = passed.filter((a) => tagsOf(a).length > 0);
  const trainedGoalIds = [...new Set(taggedActs.flatMap(tagsOf))].sort(goalSort);
  const activityGoals: GoalRow[] = trainedGoalIds.map((id) => {
    const xs = taggedActs.filter((a) => tagsOf(a).includes(id));
    return { id, label: goalById.get(id)!.label, areaLabel: areaLabel(goalById.get(id)!.areaKey), sessions: xs.length, participants: new Set(xs.filter(trainedHere).map((a) => a.caseId)).size };
  });
  const passedStats = statsFor(null, (a) => a.startsAt < env.now);

  // ---- 5. Resultat: händelser och avslut i månaden (yrkesområdet som gällde månaden), resultatgraden och stegen.
  const areaCases = db.cases.filter((c) => inArea(c, M));
  const areaCaseIds = new Set(areaCases.map((c) => c.id));
  const events = db.outcome_events.filter((e) => areaCaseIds.has(e.caseId) && e.occurredOn >= from && e.occurredOn <= to);
  const eventRows: EventRow[] = OUTCOME_EVENT_KINDS.map((kind) => {
    const xs = events.filter((e) => e.kind === kind);
    return { kind, label: eventLabel(kind), count: xs.length, verified: xs.filter((e) => !!e.verificationKind).length, participants: new Set(xs.map((e) => e.caseId)).size };
  }).filter((r) => r.count > 0);
  // Avsluten i månaden efter hur de räknas i resultatgraden (samma klasser som resultTally: verifierat resultat i täljaren,
  // allt utom "räknas inte" i nämnaren – också ett avslut utan klass).
  const closureClass = (c: Case): ClosureRow["key"] =>
    c.resultClass === "result" ? (c.resultVerifiedAt ? "result_verified" : "result_prelim") : (c.resultClass ?? "unclassified");
  const closures: ClosureRow[] = CLOSURE_CLASSES.map((k) => ({ key: k, label: CLOSURE_LABEL[k], count: ended.filter((c) => closureClass(c) === k).length, counted: k !== "excluded" })).filter(
    (x) => x.count > 0,
  );
  // Resultatgraden: avslutade ärenden med yrkesområdet som gällde avslutsmånaden.
  const closedInArea = (c: Case) => isClosed(c) && !!c.endDate && (!env.area || areaOf(c, monthKey(c.endDate)) === env.area);
  const rateCases = db.cases.filter(closedInArea);
  // Rullande sex månader till och med rapportmånaden (som beställarrapporten), aldrig före avtalets start.
  const rollFromMonth = addMonths(M, -5) < monthKey(env.contractStart) ? monthKey(env.contractStart) : addMonths(M, -5);
  const monthRate = rateView(rateCases, from, to, monthName(M), env);
  const rollingRate = rateView(rateCases, `${rollFromMonth}-01`, to, rollFromMonth === M ? monthName(M) : `${monthName(rollFromMonth)} – ${monthName(M)}`, env);
  const bonus = bonusModel(cfg);
  const steps: StepRow[] | null =
    env.showCommercial && bonus
      ? bonus.steps.map((s) => {
          const xs = db.bonus_claims.filter((b) => areaCaseIds.has(b.caseId) && b.step === s.step && !!b.reachedOn && b.reachedOn >= from && b.reachedOn <= to);
          return { step: s.step, label: `Steg ${s.step} · ${progressStepLabel(bonus, s.step)}`, submitted: xs.filter((b) => b.status === "submitted").length, approved: xs.filter((b) => b.status === "approved").length };
        })
      : null;

  // ---- 6. Per deltagare.
  const eventsByCase = new Map<string, typeof events>();
  for (const e of events) eventsByCase.set(e.caseId, [...(eventsByCase.get(e.caseId) ?? []), e]);
  const participants: ParticipantRow[] = scope.map((c) => {
    const st = statsFor(new Set([c.id]));
    const registered = st.planned - st.unregistered;
    const attended = st.present + st.late;
    const ma = approvedByCase.get(c.id);
    const f = ma ? progressionFlags(cfg, ma.areas) : null;
    const pstate: ParticipantRow["progression"]["state"] = f ? (f.clear ? "clear" : f.any ? "any" : "none") : needsAssessment(c, M, minDays) ? "not_approved" : "not_needed";
    const achieved = achievedRows.filter((r) => r.caseId === c.id).length;
    const trained = [...trainedPairs].filter((p) => p.startsWith(`${c.id}|`)).length;
    const mine = passed.filter((a) => a.caseId === c.id);
    const inGroup = mine.filter((a) => !!a.groupActivityId).length;
    const end = endOf(c);
    const results = [
      ...(eventsByCase.get(c.id) ?? []).map((e) => `${eventLabel(e.kind)} ${fmtDateShort(e.occurredOn)}`),
      ...(endedIn(c) ? [`Avslut: ${endReasonLabel(c.endReason)}`] : []),
    ];
    return {
      caseId: c.id, caseNumber: c.caseNumber, name: env.name(c.id), areaCode: areaCode.get(c.id) ?? "", areaLabel: areaLabelOf(areaCode.get(c.id) || null),
      startDate: c.startDate, endDate: isClosed(c) ? end : null, startText: fmtDate(c.startDate), endText: isClosed(c) && end ? fmtDate(end) : "Pågår",
      periodText: isClosed(c) && end ? `${fmtDate(c.startDate)} – ${fmtDate(end)}` : `Från ${fmtDate(c.startDate)}`,
      startedInMonth: startedIn(c), endedInMonth: endedIn(c),
      attendance: {
        rate: st.rate, rateText: rateText(st.rate), detail: registered ? `${attended} av ${registered}` : "", text: st.rate == null ? "–" : `${rateText(st.rate)} (${attended} av ${registered})`,
        registered, attended,
      },
      progression: { state: pstate, text: PROGRESSION_TEXT[pstate] },
      goals: { achieved, trained, text: achieved || trained ? [achieved ? `${achieved} uppnådda` : "", trained ? `${trained} tränade` : ""].filter(Boolean).join(", ") : "–" },
      activities: { held: mine.length, inGroup, text: mine.length ? `${plural(mine.length, "tillfälle", "tillfällen")}${inGroup ? `, ${inGroup} i grupp` : ""}` : "–" },
      results, resultText: results.length ? results.join("; ") : "–",
    };
  });

  // ---- Diagrammen (samma tal som tabellerna).
  const flowChart: FlowChartSpec = {
    title: `Startade och avslutade insatser per yrkesområde, ${monthName(M)}`,
    rows: flowRows.map((r) => ({ key: r.code || "saknas", label: r.label, started: r.started, ended: r.ended })),
    ariaLabel: `Startade och avslutade insatser per yrkesområde, ${monthName(M)}. ${flowRows.length ? flowRows.map((r) => `${r.label}: ${r.started} startade, ${r.ended} avslutade`).join(". ") : "Inga uppgifter"}.`,
  };
  return {
    month: M, monthLabel: monthName(M), partial: monthKey(today) === M, area: env.area ? { code: env.area, label: areaLabelOf(env.area) } : null,
    totals: { participants: scope.length, atStart: flowTotal.atStart, started: flowTotal.started, ended: flowTotal.ended, atEnd: flowTotal.atEnd },
    flow: { rows: flowRows, total: flowTotal, endReasons, chart: flowChart },
    attendance: {
      total: attTotal, byArea: attByArea,
      chart: barChart(`Närvarograd per yrkesområde, ${monthName(M)}`, "andel", attByArea.filter((r) => r.rate != null).map((r) => ({ key: r.key, label: r.label, value: r.rate as number, valueText: r.rateText })), attTargets),
    },
    progression: {
      required, approved: approved.length, clear: flags.filter((x) => x.clear).length, any: flags.filter((x) => x.any).length,
      clearLabel: `Tydlig progression, nivå ${cfg.progression.clearFromLevel} eller högre`, anyLabel: `Någon progression, nivå ${cfg.progression.anyFromLevel} eller högre`,
      scale, areas: areasMain, total: levelTotal, optional: areasOptional, achieved: achievedGoals, achievedCount: achievedRows.length, trainedCount: trainedPairs.size,
      levelChart: barChart(`Områdesbedömningar per nivå i godkända månadsbedömningar, ${monthName(M)}`, "antal", scale.map((s, i) => countBar(`niva-${i}`, `Nivå ${s}`, totalLevels[i]))),
      goalChart: barChart(`Uppnådda delmål per progressionsområde, ${monthName(M)}`, "antal", [...areasMain, ...areasOptional].filter((r) => r.achieved > 0).map((r) => countBar(r.key, r.label, r.achieved))),
    },
    activities: {
      held: passed.length, groupActivities: new Set(passed.map((a) => a.groupActivityId).filter(Boolean)).size, withGoals: taggedActs.length,
      rate: passedStats.rate, rateText: rateText(passedStats.rate), byKind, goals: activityGoals,
      chart: barChart(`Tillfällen per typ, ${monthName(M)}`, "antal", byKind.map((r) => countBar(r.kind, r.label, r.held))),
    },
    results: {
      events: eventRows, eventsTotal: events.length, verifiedTotal: events.filter((e) => !!e.verificationKind).length, closures, closedTotal: ended.length,
      month: monthRate, rolling: rollingRate, steps,
      chart: barChart(`Händelser per typ, ${monthName(M)}`, "antal", eventRows.map((r) => countBar(r.kind, r.label, r.count))),
    },
    participants: sortParticipants(participants, "omrade"),
  };
}

// ================================================================ Sortering (samma på sidan och i PDF:en)
export const PARTICIPANT_SORTS = ["omrade", "arende", "narvaro"] as const;
export type ParticipantSort = (typeof PARTICIPANT_SORTS)[number];
export const PARTICIPANT_SORT_LABEL: Record<ParticipantSort, string> = { omrade: "Yrkesområde", arende: "Ärendenummer", narvaro: "Närvarograd, lägst först" };
/** Yrkesområde och ärendenummer, ärendenummer, eller närvarograd (lägst först, utan registrering sist). */
export function sortParticipants(rows: readonly ParticipantRow[], sort: ParticipantSort): ParticipantRow[] {
  const byCase = (a: ParticipantRow, b: ParticipantRow) => a.caseNumber.localeCompare(b.caseNumber, "sv");
  const xs = [...rows];
  if (sort === "arende") return xs.sort(byCase);
  if (sort === "narvaro") return xs.sort((a, b) => (a.attendance.rate ?? 2) - (b.attendance.rate ?? 2) || byCase(a, b));
  return xs.sort((a, b) => (a.areaCode === "" ? 1 : 0) - (b.areaCode === "" ? 1 : 0) || a.areaCode.localeCompare(b.areaCode, "sv") || byCase(a, b));
}

/** Filnamnet: avtalets prefix, rapportens slag och perioden – aldrig namn eller ärendenummer ("rapport_bot_manadsrapport_2027-01.pdf"). */
export function overviewFilename(casePrefix: string, month: MonthKey): string {
  const prefix = casePrefix.toLowerCase().replace(/[^a-z0-9]/g, "") || "avtal";
  return `rapport_${prefix}_manadsrapport_${month}.pdf`;
}
