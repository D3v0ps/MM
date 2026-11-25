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
//   - Delmålen bara som antal per progressionsområde – aldrig delmålens namn eller id (Karims beslut 2026-11-24). Underlaget har
//     bara delmålets id och område.
//   - Progressionsnivåerna 0–3 bara som fördelning – aldrig ett medelvärde.
//   - Yrkesområdet är det som gällde månaden (areaForMonth – samma regel som fakturan och månadsrapporten till kommunen).
//   - Närvarograden räknas som nyckeltalet (attendanceStats: närvarande och sena av registrerade passerade tillfällen) över alla
//     tillfällen i månaden för ärendena i yrkesområdet – också ett tillfälle efter ett avslut med tidigare slutdatum. Att
//     deltagaren inte kom till första mötet (first_meeting_no_shows) är inget tillfälle och läses aldrig.
//   - Resultatgraden räknas som nyckeltalet (resultRate) – och visas inte för coachen (Karims beslut 2026-11-24, showRate).
//   - Inga belopp, inga personnummer och inga namn: hanteraren sätter namnet efter läsarens behörighet.
import { areaForMonth } from "@/core/area-changes";
import { attendanceStats, type AttendanceStats } from "@/core/attendance";
import { bonusStepTitle } from "@/core/bonus";
import { bonusModel, kpiDef, progressionAreas, progressionFlags, type OperationalConfig, type ProgressLevel } from "@/core/config";
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
/** Tabellerna som rapporten byggs av – bara fälten som behövs. Gruppaktiviteterna har aldrig gruppmålet, delmålen aldrig namnet. */
export type OverviewDb = {
  /** Avtalets ärenden (läsarens behörighet). */
  cases: readonly Case[];
  case_area_changes: readonly Pick<CaseAreaChange, "id" | "caseId" | "fromArea" | "toArea" | "effectiveMonth" | "changedAt" | "seq">[];
  contract_areas: readonly Pick<ContractArea, "code" | "name">[];
  /** Tillfällen i månaden för avtalets ärenden i yrkesområdet (också efter ett avslut – som nyckeltalet). */
  activities: readonly Pick<Activity, "id" | "caseId" | "kind" | "startsAt" | "groupActivityId">[];
  /** Närvaron på tillfällena (också den automatiska). */
  attendance: readonly Pick<Attendance, "id" | "activityId" | "caseId" | "status" | "reason">[];
  /** Gruppaktiviteterna som tillfällena hör till – utan namn och utan gruppmål. */
  group_activities: readonly Pick<GroupActivity, "id" | "kind" | "startsAt" | "cancelledAt" | "progressGoalIds">[];
  /** Delmålen på deltagarnas egna tillfällen (id = tillfällets id). */
  activity_progress_goals: readonly Pick<ActivityProgressGoal, "id" | "caseId" | "goalIds">[];
  /** Månadsbedömningarna för månaden – bara de godkända räknas. */
  monthly_assessments: readonly Pick<MonthlyAssessment, "id" | "caseId" | "month" | "status" | "areas">[];
  /** Avtalets delmål (också inaktiva) – bara id och progressionsområde, aldrig namnet (Karims beslut 2026-11-24). */
  progress_goals: readonly Pick<ProgressGoal, "id" | "areaKey">[];
  /** Delmålens lägen – bara Uppnått räknas här (Tränade räknas ur närvaron på tillfällena i månaden). */
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
  /**
   * Stegen i Progression och resultat och Miljonbemannings interna mål visas (false för en begränsad testare i testmiljön –
   * de är ekonomiska villkor, src/api/tester-access.ts).
   */
  showCommercial: boolean;
  /** Resultatgraden (månaden och rullande) med avtalets och det interna målet visas – inte för coachen (Karims beslut 2026-11-24). */
  showRate: boolean;
};

// ================================================================ Vy-modellen
export type FlowRow = { code: string; label: string; atStart: number; started: number; ended: number; atEnd: number };
export type CountRow = { key: string; label: string; count: number };
export const CLOSURE_CLASSES = ["result_verified", "result_prelim", "no_result", "excluded", "unclassified"] as const;
/** no_start: avslutade i månaden utan att ha startat – räknas i resultatgraden men är inte med i urvalet. */
export type ClosureKey = (typeof CLOSURE_CLASSES)[number] | "no_start";
/** Avsluten efter hur de räknas i resultatgraden. counted = räknas i nämnaren. */
export type ClosureRow = { key: ClosureKey; label: string; count: number; counted: boolean };
export type AttendanceRow = {
  key: string; label: string; planned: number; registered: number; present: number; late: number; absentValid: number; absentInvalid: number; unregistered: number;
  rate: number | null; rateText: string;
};
/**
 * Fördelningen per progressionsområde: antal deltagare per nivå 0–3 – aldrig ett medelvärde. achieved och trained räknar
 * deltagare × delmål (en deltagare som uppnått två delmål i området räknas två gånger).
 */
export type LevelRow = { key: string; label: string; levels: [number, number, number, number]; notAssessed: number; achieved: number; trained: number };
/** Tillfällen som tränade delmål i ett progressionsområde – bara antal, aldrig delmålens namn (Karims beslut 2026-11-24). */
export type GoalAreaRow = { key: string; label: string; sessions: number; participants: number; trained: number };
export type ActivityKindRow = { key: string; label: string; held: number; inGroup: number; participants: number; rate: number | null; rateText: string; withGoals: number };
export type EventRow = { kind: string; label: string; count: number; verified: number; participants: number };
export type StepRow = { step: number; label: string; submitted: number; approved: number };
export type RateView = {
  /** "januari 2027", "augusti 2026 – januari 2027". */
  period: string;
  value: number | null; valueText: string; num: number; den: number; prelim: number;
  /** statusText för för litet underlag har gränsen ur kpis: "Färre än 10 avslut". */
  status: ResultStatus; statusText: string;
  contractTarget: number | null; internalTarget: number | null;
};
export type ParticipantLevel = { key: string; label: string; level: ProgressLevel | null; text: string };
export type ParticipantRow = {
  caseId: string; caseNumber: string;
  /** Namnet enligt läsarens behörighet – sätts av hanteraren ("" i modellen). */
  name: string;
  areaCode: string; areaLabel: string;
  /** Skyddade personuppgifter för läsaren (den vilande spärren): bara ärendenumret och området, inga andra uppgifter. */
  restricted: boolean;
  /** Med utan att vara inskriven i månaden – för en händelse eller ett steg i månaden: "Avslutad 29 jan 2027". */
  outside: string | null;
  startDate: LocalDate | null; endDate: LocalDate | null; startText: string; endText: string; startedInMonth: boolean; endedInMonth: boolean;
  /** "29 okt 2026 – 1 jan 2027" eller "Från 14 dec 2026". */
  periodText: string;
  /** Perioden på två rader: ["29 okt 2026", "– 1 jan 2027"], ["14 dec 2026", "– pågår"] eller ["5 okt 2026", "Avslutad 29 dec 2026"]. */
  periodLines: string[];
  /**
   * Deltagarens tillfällen i månaden under insatsen (från start till slut). rateText "85,7 %", detail "6 av 7" (närvarande och
   * sena av registrerade), text båda ihop; frånvaron uppdelad.
   */
  attendance: {
    rate: number | null; rateText: string; detail: string; text: string; registered: number; attended: number;
    present: number; late: number; absentValid: number; absentInvalid: number; unregistered: number;
  };
  /** Läget och nivåerna per progressionsområde ur den godkända bedömningen (tom utan godkänd bedömning). */
  progression: { state: "clear" | "any" | "none" | "not_approved" | "not_needed"; text: string; areas: ParticipantLevel[] };
  /** Antal – aldrig delmålens namn (Karims beslut 2026-11-24). lines: ["1 uppnådda", "3 tränade"]. */
  goals: { achieved: number; trained: number; text: string; lines: string[] };
  activities: { held: number; inGroup: number; text: string };
  /** Stegen i Progression och resultat i månaden, utan belopp: "Steg 3 · …: godkänt av kommunen". */
  steps: string[];
  /** Byte av yrkesområde som gjordes eller började gälla i månaden: "G till D från februari 2027". */
  areaChanges: string[];
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
  /** endReasons summeras i total.ended. */
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
    /** Deltagare × delmål. */
    achievedCount: number;
    trainedCount: number;
    /** Inga staplar när ingen nivå är bedömd (tabellen står kvar). */
    levelChart: BarChartSpec;
    goalChart: BarChartSpec;
  };
  activities: {
    held: number; groupActivities: number; withGoals: number; rate: number | null; rateText: string;
    byKind: ActivityKindRow[]; byKindTotal: ActivityKindRow; goalAreas: GoalAreaRow[]; chart: BarChartSpec;
  };
  results: {
    events: EventRow[];
    eventTotal: EventRow;
    eventsTotal: number;
    verifiedTotal: number;
    closures: ClosureRow[];
    /** Summan av raderna – och de som räknas i resultatgraden (= resultatgradens nämnare för månaden). */
    closedTotal: number;
    closuresCounted: number;
    /** Avslut med verifierat resultat i månaden (resultatgradens täljare). */
    verifiedResults: number;
    /** null = visas inte för läsaren (coachen, Karims beslut 2026-11-24). */
    month: RateView | null;
    rolling: RateView | null;
    /** null = visas inte (avtalet saknar stegen eller läsaren är en begränsad testare). */
    steps: StepRow[] | null;
    chart: BarChartSpec;
  };
  participants: ParticipantRow[];
};

// ================================================================ Texter
export const KIND_LABEL: Record<ActivityKind, string> = { möte: "Coachträff", yrkesmoment: "Yrkesmoment", praktikdag: "Praktikdag", arbetsgivarbesök: "Arbetsgivarbesök", annat: "Annan aktivitet" };
const RATE_STATUS_TEXT: Record<Exclude<ResultStatus, "insufficient">, string> = {
  ok: "Når målet", below_internal: "Under det interna målet", below_contract: "Under avtalets mål",
};
const CLOSURE_LABEL: Record<ClosureKey, string> = {
  result_verified: "Resultat, verifierat", result_prelim: "Resultat, väntar på verifiering", no_result: RESULT_CLASS_LABEL.no_result,
  excluded: RESULT_CLASS_LABEL.excluded, unclassified: "Inte klassat", no_start: "Avslutade utan start",
};
const PROGRESSION_TEXT: Record<ParticipantRow["progression"]["state"], string> = {
  clear: "Tydlig progression", any: "Någon progression", none: "Ingen progression", not_approved: "Väntar på godkännande", not_needed: "Ingen bedömning",
};
/** "41,7 %" eller "–". */
export const rateText = (v: number | null): string => pct(v);
const NONE_AREA = "–";
export const PROTECTED_NAME = "Skyddade personuppgifter";

// ================================================================ Byggstenar
const endOf = (c: Pick<Case, "status" | "endDate" | "closedAt">): LocalDate | null => c.endDate ?? (c.status === "closed" && c.closedAt ? dayOf(c.closedAt) : null);
const isClosed = (c: Pick<Case, "status">) => c.status === "closed";
const isLevel = (lv: unknown): lv is ProgressLevel => lv === 0 || lv === 1 || lv === 2 || lv === 3;

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

/** Resultatgraden med status – samma räkning som nyckeltalet (resultRate). För litet underlag: gränsen ur kpis i statustexten. */
function rateView(cases: readonly Case[], from: LocalDate, to: LocalDate, period: string, env: OverviewEnv): RateView {
  const r = resultRate({ cases: [...cases] }, { from, to }, { cfg: env.cfg, now: env.now, contractStart: env.contractStart });
  const internalTarget = env.showCommercial ? r.internalTarget : null;
  // Statusen utan det interna målet för den som inte får se det (samma ordning som resultRate).
  let status: ResultStatus = "ok";
  if (r.den < r.minN) status = "insufficient";
  else if (r.value != null && r.contractTarget != null && r.value < r.contractTarget) status = "below_contract";
  else if (r.value != null && internalTarget != null && r.value < internalTarget) status = "below_internal";
  return {
    period, value: r.value, valueText: rateText(r.value), num: r.num, den: r.den, prelim: r.prelim, status,
    statusText: status === "insufficient" ? `Färre än ${r.minN} avslut` : RATE_STATUS_TEXT[status],
    contractTarget: r.contractTarget, internalTarget,
  };
}

/** Raden för en deltagare med skyddade personuppgifter (läsarens åtkomst "restricted"): bara ärendenumret och området. */
export function maskParticipant(r: ParticipantRow): ParticipantRow {
  return {
    caseId: r.caseId, caseNumber: r.caseNumber, name: PROTECTED_NAME, areaCode: r.areaCode, areaLabel: r.areaLabel, restricted: true, outside: null,
    startDate: null, endDate: null, startText: "–", endText: "–", startedInMonth: false, endedInMonth: false, periodText: "–", periodLines: [],
    attendance: { rate: null, rateText: "–", detail: "", text: "–", registered: 0, attended: 0, present: 0, late: 0, absentValid: 0, absentInvalid: 0, unregistered: 0 },
    progression: { state: "not_needed", text: "–", areas: [] },
    goals: { achieved: 0, trained: 0, text: "–", lines: [] },
    activities: { held: 0, inGroup: 0, text: "–" },
    steps: [], areaChanges: [], results: [], resultText: "–",
  };
}

// ================================================================ Rapporten
export function buildMonthlyOverview(db: OverviewDb, env: OverviewEnv): MonthlyOverview {
  const { cfg, month: M } = env;
  const from = `${M}-01`;
  const to = monthEnd(M);
  const today = dayOf(env.now);
  const partial = monthKey(today) === M;
  // Innevarande månad räknas till och med i dag: den som inte har startat än är inte med. Bara starten begränsas – avsluten räknas
  // som i resultatgraden (slutdatum i månaden).
  const startTo = partial && today < to ? today : to;
  const areaLabelOf = (code: string | null): string => {
    if (!code) return NONE_AREA;
    const a = db.contract_areas.find((x) => x.code === code);
    return a ? `${code} ${a.name}` : code;
  };
  const areaOf = (c: Pick<Case, "id" | "primaryAreaCode">, mk: MonthKey): string => areaForMonth(c, db.case_area_changes, mk) ?? "";
  const inArea = (c: Case, mk: MonthKey) => !env.area || areaOf(c, mk) === env.area;
  const sortCodes = (xs: Iterable<string>) => [...new Set(xs)].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "sv")));

  // ---- Urvalet: deltagare som var inskrivna någon dag i månaden, i yrkesområdet som gällde månaden. Händelserna, stegen och
  // tillfällena gäller alla avtalets ärenden i yrkesområdet (areaCases) – ett resultat kan komma efter avslutet.
  const scope = db.cases.filter((c) => enrolledDays(c, from, startTo) > 0 && inArea(c, M));
  const scopeIds = new Set(scope.map((c) => c.id));
  const areaCases = db.cases.filter((c) => inArea(c, M));
  const areaCaseIds = new Set(areaCases.map((c) => c.id));
  const areaCode = new Map(areaCases.map((c) => [c.id, areaOf(c, M)]));
  const codeOf = (caseId: string) => areaCode.get(caseId) ?? "";

  // ---- 1. Start och slut per yrkesområde (flödet går ihop: vid start + startade − avslutade = vid slut).
  const startedBefore = (c: Case) => !!c.startDate && c.startDate < from;
  const startedIn = (c: Case) => !!c.startDate && c.startDate >= from && c.startDate <= startTo;
  const endedIn = (c: Case) => isClosed(c) && !!endOf(c) && (endOf(c) as LocalDate) >= from && (endOf(c) as LocalDate) <= to;
  const flowOf = (code: string, label: string, cs: readonly Case[]): FlowRow => ({
    code, label, atStart: cs.filter(startedBefore).length, started: cs.filter(startedIn).length, ended: cs.filter(endedIn).length,
    atEnd: cs.filter((c) => !endedIn(c)).length,
  });
  const codes = sortCodes(scope.map((c) => codeOf(c.id)));
  const flowRows = codes.map((code) => flowOf(code, areaLabelOf(code || null), scope.filter((c) => codeOf(c.id) === code)));
  const flowTotal = flowOf("total", "Totalt", scope);
  const ended = scope.filter(endedIn);
  const endReasons: CountRow[] = [...END_REASONS, null]
    .map((k) => ({ key: k ?? "saknas", label: k ? endReasonLabel(k) : "Avslutsorsak saknas", count: ended.filter((c) => (c.endReason ?? null) === k).length }))
    .filter((x) => x.count > 0);

  // ---- 2. Närvarograd (samma räkning som nyckeltalet: närvarande och sena av registrerade passerade tillfällen) över alla
  // tillfällen i månaden för ärendena i yrkesområdet. Raderna per yrkesområde är områdena som har tillfällen – de går ihop med Totalt.
  const acts = db.activities.filter((a) => areaCaseIds.has(a.caseId) && dayOf(a.startsAt) >= from && dayOf(a.startsAt) <= to);
  type Act = (typeof acts)[number];
  const actIds = new Set(acts.map((a) => a.id));
  const att = db.attendance.filter((x) => actIds.has(x.activityId));
  const stats = (xs: readonly Act[]): AttendanceStats => attendanceStats({ activities: xs as Activity[], attendance: att as Attendance[] }, null, from, to, { now: env.now });
  const attTotal = attRow("total", "Totalt", stats(acts));
  const attByArea = sortCodes(acts.map((a) => codeOf(a.caseId))).map((code) => attRow(code || "saknas", areaLabelOf(code || null), stats(acts.filter((a) => codeOf(a.caseId) === code))));
  const attTarget = kpiDef(cfg, "narvarograd");
  const attTargets: ChartTarget[] = [];
  if (attTarget?.contractTarget != null) attTargets.push({ kind: "contract", value: attTarget.contractTarget, label: "Avtalets mål" });
  if (env.showCommercial && typeof attTarget?.internalTarget === "number") attTargets.push({ kind: "internal", value: attTarget.internalTarget, label: "Internt mål" });

  // ---- Delmålen på tillfällena (egna tillfällen: activity_progress_goals; gruppaktiviteter: aktivitetens delmål, aldrig en inställd).
  const goalArea = new Map(db.progress_goals.map((g) => [g.id, g.areaKey]));
  const ownTags = new Map(db.activity_progress_goals.map((r) => [r.id, r.goalIds ?? []]));
  const groupById = new Map(db.group_activities.map((g) => [g.id, g]));
  const tagsOf = (a: Act): string[] => {
    if (a.groupActivityId) {
      const g = groupById.get(a.groupActivityId);
      return g && !g.cancelledAt ? (g.progressGoalIds ?? []).filter((id) => goalArea.has(id)) : [];
    }
    return (ownTags.get(a.id) ?? []).filter((id) => goalArea.has(id));
  };
  const passed = acts.filter((a) => a.startsAt < env.now);
  const attByActivity = new Map(att.map((x) => [x.activityId, x]));
  const trainedHere = (a: Act) => {
    const s = attByActivity.get(a.id)?.status;
    return s === "present" || s === "late";
  };
  /** Tränade delmål: deltagare × delmål där deltagaren var närvarande eller sen på ett märkt tillfälle i månaden. */
  const pairsOf = (xs: readonly Act[]): string[][] => {
    const seen = new Set<string>();
    const out: string[][] = [];
    for (const a of xs) {
      if (a.startsAt >= env.now || !trainedHere(a)) continue;
      for (const g of tagsOf(a)) {
        const k = `${a.caseId}|${g}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push([a.caseId, g]);
        }
      }
    }
    return out;
  };
  const trainedPairs = pairsOf(acts);

  // ---- 3. Progression: godkända bedömningar (fördelning per nivå) och delmål som en människa markerat uppnådda i månaden.
  const approved = db.monthly_assessments.filter((m) => m.month === M && m.status === "approved" && scopeIds.has(m.caseId));
  const approvedByCase = new Map(approved.map((m) => [m.caseId, m]));
  const minDays = cfg.reportSchedule?.monthly?.minEnrolledDays;
  const required = scope.filter((c) => needsAssessment(c, M, minDays)).length;
  const flags = approved.map((m) => progressionFlags(cfg, m.areas));
  const achievedRows = db.case_progress_goals.filter(
    (r) => scopeIds.has(r.caseId) && r.status === "achieved" && r.source === "manual" && !!r.achievedOn && r.achievedOn >= from && r.achievedOn <= to && goalArea.has(r.goalId),
  );
  const inAreaGoal = (key: string) => (goalId: string) => goalArea.get(goalId) === key;
  const levelRow = (key: string, label: string): LevelRow => {
    const levels = emptyLevels();
    let notAssessed = 0;
    for (const m of approved) {
      const lv = m.areas[key]?.level;
      if (isLevel(lv)) levels[lv]++;
      else notAssessed++;
    }
    return {
      key, label, levels, notAssessed,
      achieved: achievedRows.filter((r) => inAreaGoal(key)(r.goalId)).length,
      trained: trainedPairs.filter(([, g]) => inAreaGoal(key)(g)).length,
    };
  };
  const areasMain = progressionAreas(cfg).map((a) => levelRow(a.key, a.label));
  // De valfria områdena (hälsa, livskvalitet) står för sig och räknas aldrig i summorna – och bara när något är bedömt i dem.
  const areasOptional = cfg.progression.optionalAreas
    .map((k) => levelRow(k, cfg.progression.areaLabels[k] ?? k))
    .filter((r) => r.levels.some((n) => n > 0) || r.achieved > 0 || r.trained > 0);
  const totalLevels = emptyLevels();
  for (const r of areasMain) for (let i = 0; i < 4; i++) totalLevels[i] += r.levels[i];
  // Summan av nivåerna gäller de obligatoriska områdena; delmålen räknas alla (samma tal som rutorna för delmålen).
  const levelTotal: LevelRow = {
    key: "total", label: "Totalt", levels: totalLevels, notAssessed: areasMain.reduce((s, r) => s + r.notAssessed, 0),
    achieved: achievedRows.length, trained: trainedPairs.length,
  };
  const scaleText = (lv: ProgressLevel) => `${lv} – ${cfg.progression.scale[String(lv) as "0" | "1" | "2" | "3"]}`;
  const scale: [string, string, string, string] = [scaleText(0), scaleText(1), scaleText(2), scaleText(3)];
  const areaOrder = [...cfg.progression.areas, ...cfg.progression.optionalAreas];
  const areaLabel = (key: string) => cfg.progression.areaLabels[key] ?? key;

  // ---- 4. Aktiviteter: passerade tillfällen i månaden (egna och i gruppaktiviteter), närvaron på dem och delmålen de tränade.
  const kindRow = (key: string, label: string, xs: readonly Act[]): ActivityKindRow => {
    const st = stats(xs);
    return {
      key, label, held: xs.length, inGroup: xs.filter((a) => !!a.groupActivityId).length, participants: new Set(xs.map((a) => a.caseId)).size,
      rate: st.rate, rateText: rateText(st.rate), withGoals: xs.filter((a) => tagsOf(a).length > 0).length,
    };
  };
  const byKind = ACTIVITY_KINDS.map((kind) => kindRow(kind, KIND_LABEL[kind], passed.filter((a) => a.kind === kind))).filter((r) => r.held > 0);
  const byKindTotal = kindRow("total", "Totalt", passed);
  const taggedActs = passed.filter((a) => tagsOf(a).length > 0);
  const goalAreas: GoalAreaRow[] = areaOrder
    .map((key) => {
      const xs = taggedActs.filter((a) => tagsOf(a).some(inAreaGoal(key)));
      return {
        key, label: areaLabel(key), sessions: xs.length, participants: new Set(xs.filter(trainedHere).map((a) => a.caseId)).size,
        trained: trainedPairs.filter(([, g]) => inAreaGoal(key)(g)).length,
      };
    })
    .filter((r) => r.sessions > 0);

  // ---- 5. Resultat: händelser och avslut i månaden (yrkesområdet som gällde månaden), resultatgraden och stegen.
  const events = db.outcome_events.filter((e) => areaCaseIds.has(e.caseId) && e.occurredOn >= from && e.occurredOn <= to);
  const eventRow = (kind: string, label: string, xs: typeof events): EventRow => ({
    kind, label, count: xs.length, verified: xs.filter((e) => !!e.verificationKind).length, participants: new Set(xs.map((e) => e.caseId)).size,
  });
  const eventRows: EventRow[] = OUTCOME_EVENT_KINDS.map((kind) => eventRow(kind, eventLabel(kind), events.filter((e) => e.kind === kind))).filter((r) => r.count > 0);
  // Resultatgraden: avslutade ärenden med yrkesområdet som gällde avslutsmånaden.
  const closedInArea = (c: Case) => isClosed(c) && !!c.endDate && (!env.area || areaOf(c, monthKey(c.endDate)) === env.area);
  const rateCases = db.cases.filter(closedInArea);
  // Avsluten i månaden efter hur de räknas i resultatgraden (samma klasser som resultTally: verifierat resultat i täljaren,
  // allt utom "räknas inte" i nämnaren – också ett avslut utan klass). Avslut i månaden utan start (inte i urvalet) står på en
  // egen rad, så att raderna som räknas går ihop med resultatgradens nämnare.
  const closureClass = (c: Case): (typeof CLOSURE_CLASSES)[number] =>
    c.resultClass === "result" ? (c.resultVerifiedAt ? "result_verified" : "result_prelim") : (c.resultClass ?? "unclassified");
  const endedIds = new Set(ended.map((c) => c.id));
  const noStart = rateCases.filter((c) => (c.endDate as LocalDate) >= from && (c.endDate as LocalDate) <= to && !endedIds.has(c.id));
  const closures: ClosureRow[] = [
    ...CLOSURE_CLASSES.map((k): ClosureRow => ({
      key: k, label: CLOSURE_LABEL[k], counted: k !== "excluded",
      count: ended.filter((c) => closureClass(c) === k).length + (k === "excluded" ? noStart.filter((c) => c.resultClass === "excluded").length : 0),
    })),
    { key: "no_start" as const, label: CLOSURE_LABEL.no_start, counted: true, count: noStart.filter((c) => c.resultClass !== "excluded").length },
  ].filter((x) => x.count > 0);
  // Rullande sex månader till och med rapportmånaden (som beställarrapporten), aldrig före avtalets start.
  const rollFromMonth = addMonths(M, -5) < monthKey(env.contractStart) ? monthKey(env.contractStart) : addMonths(M, -5);
  const monthRate = rateView(rateCases, from, to, monthName(M), env);
  const rollingRate = rateView(rateCases, `${rollFromMonth}-01`, to, rollFromMonth === M ? monthName(M) : `${monthName(rollFromMonth)} – ${monthName(M)}`, env);
  const bonus = bonusModel(cfg);
  const showSteps = env.showCommercial && !!bonus;
  const claims = showSteps
    ? db.bonus_claims.filter(
        (b): b is typeof b & { step: number } =>
          areaCaseIds.has(b.caseId) && b.step != null && (b.status === "submitted" || b.status === "approved") && !!b.reachedOn && b.reachedOn >= from && b.reachedOn <= to,
      )
    : [];
  const steps: StepRow[] | null =
    showSteps && bonus
      ? bonus.steps.map((s) => {
          const xs = claims.filter((b) => b.step === s.step);
          return { step: s.step, label: bonusStepTitle(bonus, s.step), submitted: xs.filter((b) => b.status === "submitted").length, approved: xs.filter((b) => b.status === "approved").length };
        })
      : null;

  // ---- 6. Per deltagare: urvalet, och dessutom ärenden i yrkesområdet med en händelse eller ett steg i månaden utan att vara
  // inskrivna (t.ex. ett resultat efter avslutet) – så att varje händelse och varje steg i summorna har en rad.
  const group = <T extends { caseId: string }>(xs: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) m.set(x.caseId, [...(m.get(x.caseId) ?? []), x]);
    return m;
  };
  const eventsByCase = group(events);
  const claimsByCase = group(claims);
  const changesByCase = group(db.case_area_changes.filter((x) => x.effectiveMonth === M || (dayOf(x.changedAt) >= from && dayOf(x.changedAt) <= to)));
  const extra = areaCases.filter((c) => !scopeIds.has(c.id) && (eventsByCase.has(c.id) || claimsByCase.has(c.id)));
  const mainAreas = progressionAreas(cfg);
  const rowOf = (c: Case): ParticipantRow => {
    const inScope = scopeIds.has(c.id);
    const end = endOf(c);
    // Tillfällena räknas under insatsen: från start till slut (ett tillfälle efter slutdatum står inte på raden).
    const winFrom = c.startDate && c.startDate > from ? c.startDate : from;
    const winTo = isClosed(c) && end && end < to ? end : to;
    const mine = inScope ? passed.filter((a) => a.caseId === c.id && dayOf(a.startsAt) >= winFrom && dayOf(a.startsAt) <= winTo) : [];
    const st = stats(mine);
    const registered = st.planned - st.unregistered;
    const attended = st.present + st.late;
    const ma = inScope ? approvedByCase.get(c.id) : undefined;
    const f = ma ? progressionFlags(cfg, ma.areas) : null;
    const pstate: ParticipantRow["progression"]["state"] = f ? (f.clear ? "clear" : f.any ? "any" : "none") : inScope && needsAssessment(c, M, minDays) ? "not_approved" : "not_needed";
    const levelAreas = ma
      ? [...mainAreas.map((a) => a.key), ...cfg.progression.optionalAreas.filter((k) => isLevel(ma.areas[k]?.level))].map((key): ParticipantLevel => {
          const lv = ma.areas[key]?.level;
          const level = isLevel(lv) ? lv : null;
          return { key, label: areaLabel(key), level, text: `${areaLabel(key)}: ${level == null ? "ej bedömd" : `nivå ${level}`}` };
        })
      : [];
    const achieved = inScope ? achievedRows.filter((r) => r.caseId === c.id).length : 0;
    const trained = pairsOf(mine).length;
    const goalLines = [achieved ? `${achieved} uppnådda` : "", trained ? `${trained} tränade` : ""].filter(Boolean);
    const inGroup = mine.filter((a) => !!a.groupActivityId).length;
    const closed = isClosed(c) && !!end;
    const outside = inScope ? null : closed ? `Avslutad ${fmtDate(end)}` : c.startDate ? `Startar ${fmtDate(c.startDate)}` : "Ingen start";
    const results = [
      ...(eventsByCase.get(c.id) ?? []).map((e) => `${eventLabel(e.kind)} ${fmtDateShort(e.occurredOn)}`),
      ...(inScope && endedIn(c) ? [`Avslut: ${endReasonLabel(c.endReason)}`] : []),
    ];
    return {
      caseId: c.id, caseNumber: c.caseNumber, name: "", areaCode: codeOf(c.id), areaLabel: areaLabelOf(codeOf(c.id) || null), restricted: false, outside,
      startDate: c.startDate, endDate: closed ? end : null, startText: fmtDate(c.startDate), endText: closed ? fmtDate(end) : "Pågår",
      periodText: closed ? `${fmtDate(c.startDate)} – ${fmtDate(end)}` : `Från ${fmtDate(c.startDate)}`,
      periodLines: inScope ? [fmtDate(c.startDate), `– ${closed ? fmtDate(end) : "pågår"}`] : closed && c.startDate ? [fmtDate(c.startDate), outside as string] : [outside as string],
      startedInMonth: inScope && startedIn(c), endedInMonth: inScope && endedIn(c),
      attendance: {
        rate: st.rate, rateText: rateText(st.rate), detail: registered ? `${attended} av ${registered}` : "", text: st.rate == null ? "–" : `${rateText(st.rate)} (${attended} av ${registered})`,
        registered, attended, present: st.present, late: st.late, absentValid: st.absentValid, absentInvalid: st.absentInvalid, unregistered: st.unregistered,
      },
      progression: { state: pstate, text: PROGRESSION_TEXT[pstate], areas: levelAreas },
      goals: { achieved, trained, text: goalLines.length ? goalLines.join(", ") : "–", lines: goalLines },
      activities: { held: mine.length, inGroup, text: mine.length ? `${plural(mine.length, "tillfälle", "tillfällen")}${inGroup ? `, ${inGroup} i grupp` : ""}` : "–" },
      steps: [...(claimsByCase.get(c.id) ?? [])]
        .sort((a, b) => a.step - b.step)
        .map((b) => `${bonusStepTitle(bonus, b.step)}: ${b.status === "approved" ? "godkänt av kommunen" : "skickat till kommunen"}`),
      areaChanges: [...(changesByCase.get(c.id) ?? [])].sort((a, b) => a.seq - b.seq).map((x) => `${x.fromArea} till ${x.toArea} från ${monthName(x.effectiveMonth)}`),
      results, resultText: results.length ? results.join("; ") : "–",
    };
  };
  const participants = [...scope, ...extra].map(rowOf);

  // ---- Diagrammen (samma tal som tabellerna).
  const flowChart: FlowChartSpec = {
    title: `Startade och avslutade insatser per yrkesområde, ${monthName(M)}`,
    rows: flowRows.map((r) => ({ key: r.code || "saknas", label: r.label, started: r.started, ended: r.ended })),
    ariaLabel: `Startade och avslutade insatser per yrkesområde, ${monthName(M)}. ${flowRows.length ? flowRows.map((r) => `${r.label}: ${r.started} startade, ${r.ended} avslutade`).join(". ") : "Inga uppgifter"}.`,
  };
  const levelBars = totalLevels.some((n) => n > 0) ? scale.map((s, i) => countBar(`niva-${i}`, `Nivå ${s}`, totalLevels[i])) : [];
  return {
    month: M, monthLabel: monthName(M), partial, area: env.area ? { code: env.area, label: areaLabelOf(env.area) } : null,
    totals: { participants: scope.length, atStart: flowTotal.atStart, started: flowTotal.started, ended: flowTotal.ended, atEnd: flowTotal.atEnd },
    flow: { rows: flowRows, total: flowTotal, endReasons, chart: flowChart },
    attendance: {
      total: attTotal, byArea: attByArea,
      chart: barChart(`Närvarograd per yrkesområde, ${monthName(M)}`, "andel", attByArea.filter((r) => r.rate != null).map((r) => ({ key: r.key, label: r.label, value: r.rate as number, valueText: r.rateText })), attTargets),
    },
    progression: {
      required, approved: approved.length, clear: flags.filter((x) => x.clear).length, any: flags.filter((x) => x.any).length,
      clearLabel: `Tydlig progression, nivå ${cfg.progression.clearFromLevel} eller högre`, anyLabel: `Någon progression, nivå ${cfg.progression.anyFromLevel} eller högre`,
      scale, areas: areasMain, total: levelTotal, optional: areasOptional, achievedCount: achievedRows.length, trainedCount: trainedPairs.length,
      levelChart: barChart(`Områdesbedömningar per nivå i godkända månadsbedömningar, ${monthName(M)}`, "antal", levelBars),
      goalChart: barChart(`Deltagarnas uppnådda delmål per progressionsområde, ${monthName(M)}`, "antal", [...areasMain, ...areasOptional].filter((r) => r.achieved > 0).map((r) => countBar(r.key, r.label, r.achieved))),
    },
    activities: {
      held: passed.length, groupActivities: new Set(passed.map((a) => a.groupActivityId).filter(Boolean)).size, withGoals: taggedActs.length,
      rate: byKindTotal.rate, rateText: byKindTotal.rateText, byKind, byKindTotal, goalAreas,
      chart: barChart(`Tillfällen per typ, ${monthName(M)}`, "antal", byKind.map((r) => countBar(r.key, r.label, r.held))),
    },
    results: {
      events: eventRows, eventTotal: eventRow("total", "Totalt", events), eventsTotal: events.length, verifiedTotal: events.filter((e) => !!e.verificationKind).length,
      closures, closedTotal: closures.reduce((s, x) => s + x.count, 0), closuresCounted: closures.filter((x) => x.counted).reduce((s, x) => s + x.count, 0),
      verifiedResults: monthRate.num,
      month: env.showRate ? monthRate : null, rolling: env.showRate ? rollingRate : null, steps,
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
