import { describe, expect, it } from "vitest";
import type { AreaAssessment, MonthlyAssessment } from "@/data/schema";
import {
  applyAiDraft, approvalCounts, AUTO_OBSERVATION, autoArea, keptPrefill, latestGoal, levelSourceOf, missingAreas, nextLevelSource, prefillAssessment, refreshPrefill, rulesSummary,
  withAutoAreas, type PrefillCheckIn, type PrefillInput,
} from "./monthly-prefill";

const KEYS = ["narvaro_rutiner", "yrkesfardigheter", "sjalvstandighet"];
const ci = (id: string, heldAt: string, p: Partial<PrefillCheckIn> = {}): PrefillCheckIn => ({ id, heldAt, status: "approved", overallStatus: "green", nextGoal: "", ...p });
const att = (p: Partial<PrefillInput["attendance"]> = {}): PrefillInput["attendance"] => ({ planned: 0, unregistered: 0, present: 0, late: 0, absentValid: 0, absentInvalid: 0, ...p });
const input = (p: Partial<PrefillInput> = {}): PrefillInput => ({ month: "2027-01", areaKeys: KEYS, checkIns: [], attendance: att(), previousPlan: null, ...p });
const prevPlan = { goal1: "Gammalt mål", goal2: "Söka två jobb", plannedActivities: "Yrkesmoment två dagar i veckan", plannedEmployerContact: "Studiebesök", plannedAdaptation: "" };

describe("prefillAssessment: allt ifyllt innan coachen går igenom (Karims beslut 2026-10-22)", () => {
  it("varje område: progressionsnivå 0, observationen 'Framgår inte …', Automatiskt – inget belägg", () => {
    const p = prefillAssessment(input());
    expect(Object.keys(p.areas)).toEqual(KEYS);
    for (const a of Object.values(p.areas)) {
      expect(a).toMatchObject({ level: 0, observation: AUTO_OBSERVATION, levelSource: "auto", aiLevelSuggestion: null, aiLevelEvidence: null });
    }
    expect(AUTO_OBSERVATION).toBe("Framgår inte av underlaget denna månad.");
  });

  it("samlad status: coachens senaste godkända mötesrapport i månaden med status – märkt med rapporten", () => {
    const p = prefillAssessment(input({
      checkIns: [
        ci("ci-1", "2027-01-08T10:00", { overallStatus: "green" }),
        ci("ci-2", "2027-01-22T10:00", { overallStatus: "yellow" }),
        ci("ci-3", "2027-01-29T10:00", { overallStatus: "red", status: "draft" }), // utkast räknas inte
        ci("ci-4", "2027-01-30T10:00", { overallStatus: null }), // ingen status
        ci("ci-5", "2027-02-02T10:00", { overallStatus: "red" }), // nästa månad
      ],
    }));
    expect(p.overallStatus).toBe("yellow");
    expect(p.prefill.overallStatus).toEqual({ checkInId: "ci-2", heldAt: "2027-01-22T10:00" });
  });

  it("samlad status: ingen godkänd mötesrapport – tom och utan märkning (coachen väljer)", () => {
    const p = prefillAssessment(input({ checkIns: [ci("ci-1", "2027-01-08T10:00", { status: "draft" })] }));
    expect(p.overallStatus).toBeNull();
    expect(p.prefill.overallStatus).toBeUndefined();
  });

  it("sammanfattningen: AI-utkastet när det finns", () => {
    const p = prefillAssessment(input({ ai: { summary: "  Under januari deltog deltagaren i 8 av 9 tillfällen.  ", plan: null } }));
    expect(p.summary).toBe("Under januari deltog deltagaren i 8 av 9 tillfällen.");
    expect(p.prefill.summary).toBe("ai");
  });

  it("sammanfattningen utan AI: närvaron, antalet godkända mötesrapporter och senaste veckomålet – inga bedömningar", () => {
    const p = prefillAssessment(input({
      checkIns: [ci("ci-1", "2027-01-08T10:00", { nextGoal: "Skriva CV" }), ci("ci-2", "2027-01-22T10:00", { nextGoal: "Söka två jobb" })],
      attendance: att({ planned: 10, unregistered: 1, present: 6, late: 1, absentValid: 1, absentInvalid: 1 }),
    }));
    expect(p.prefill.summary).toBe("rules");
    expect(p.summary).toBe(
      "Närvaro i januari: närvarande vid 7 av 9 registrerade tillfällen, varav 1 med sen ankomst. Giltig frånvaro 1, ogiltig frånvaro 1. Godkända mötesrapporter: 2. Senaste veckomålet: Söka två jobb.",
    );
  });

  it("sammanfattningen utan underlag: framgår inte", () => {
    expect(rulesSummary("2027-01", [], att())).toBe("Närvaro i januari: framgår inte – ingen närvaro är registrerad. Godkända mötesrapporter: inga. Veckomål: framgår inte.");
  });

  it("planen: AI-utkastet i planerade aktiviteter, mål 1 = senaste godkända veckomålet, övrigt från förra månadens plan", () => {
    const p = prefillAssessment(input({ checkIns: [ci("ci-1", "2027-01-22T10:00", { nextGoal: "Söka två jobb." })], previousPlan: prevPlan, ai: { summary: null, plan: "Mål: söka två jobb." } }));
    expect(p.plan).toEqual({
      goal1: "Söka två jobb.", goal2: "Söka två jobb", plannedActivities: "Mål: söka två jobb.", plannedEmployerContact: "Studiebesök", plannedAdaptation: "", nextCustomerMeeting: null,
    });
    expect(p.prefill.plan).toEqual({ goal1: "check_in", goal2: "previous", plannedActivities: "ai", plannedEmployerContact: "previous" });
  });

  it("planen utan AI och utan veckomål: övriga fält från förra månadens plan – mål 1 bara ur ett godkänt veckomål", () => {
    const p = prefillAssessment(input({ previousPlan: prevPlan }));
    expect(p.plan.goal1).toBe("");
    expect(p.plan.plannedActivities).toBe("Yrkesmoment två dagar i veckan");
    expect(p.prefill.plan).toEqual({ goal2: "previous", plannedActivities: "previous", plannedEmployerContact: "previous" });
  });

  it("planen utan underlag: tom och utan märkning", () => {
    const p = prefillAssessment(input());
    expect(p.plan).toMatchObject({ goal1: "", goal2: "", plannedActivities: "" });
    expect(p.prefill.plan).toBeUndefined();
  });

  it("latestGoal: senaste godkända mötesrapporten i månaden som har ett veckomål", () => {
    expect(latestGoal([ci("a", "2027-01-08T10:00", { nextGoal: "A" }), ci("b", "2027-01-22T10:00", { nextGoal: " " })], "2027-01")).toBe("A");
    expect(latestGoal([], "2027-01")).toBeNull();
  });
});

describe("nivåns ursprung och coachens sparning", () => {
  const auto = autoArea({ aiLevelSuggestion: 2, aiObservationDraft: { text: "x", sources: [] }, aiLevelEvidence: { quote: "Klarade momentet utan stöd.", source: "Avstämning 15 jan", date: "2027-01-15" } });

  it("levelSourceOf: äldre rader med nivå är coachens val, utan nivå inget", () => {
    expect(levelSourceOf({ level: 2 })).toBe("coach");
    expect(levelSourceOf({ level: null })).toBeNull();
    expect(levelSourceOf({ level: 0, levelSource: "auto" })).toBe("auto");
    expect(levelSourceOf(null)).toBeNull();
  });

  it("nextLevelSource: auto bara med nivå 0, ai bara med förslagets nivå – annars coachens val", () => {
    expect(nextLevelSource(auto, 0, "auto")).toBe("auto");
    expect(nextLevelSource(auto, 1, "auto")).toBe("coach");
    expect(nextLevelSource(auto, 2, "ai")).toBe("ai");
    expect(nextLevelSource(auto, 3, "ai")).toBe("coach");
    expect(nextLevelSource({ ...auto, aiLevelSuggestion: null }, 2, "ai")).toBe("coach");
    expect(nextLevelSource(auto, 0, "coach")).toBe("coach");
    // Utan uppgift: en ändrad nivå är coachens val, en oförändrad behåller ursprunget.
    expect(nextLevelSource(auto, 1, undefined)).toBe("coach");
    expect(nextLevelSource(auto, 0, undefined)).toBe("auto");
    expect(nextLevelSource(null, 2, undefined)).toBe("coach");
  });

  it("withAutoAreas: områden som saknas eller saknar val blir automatiska – coachens val och AI-utkast ligger kvar", () => {
    const coach: AreaAssessment = { level: 2, observation: "Klarar plock.", nextStep: "", aiLevelSuggestion: null, aiObservationDraft: null };
    const legacy: AreaAssessment = { level: null, observation: "", nextStep: "Öva tempo", aiLevelSuggestion: 3, aiObservationDraft: { text: "AI", sources: ["Avstämning 15 jan"] } };
    const out = withAutoAreas({ yrkesfardigheter: coach, sjalvstandighet: legacy }, KEYS);
    expect(out.yrkesfardigheter).toBe(coach);
    expect(out.sjalvstandighet).toMatchObject({ level: 0, levelSource: "auto", observation: AUTO_OBSERVATION, nextStep: "Öva tempo", aiObservationDraft: legacy.aiObservationDraft });
    expect(out.narvaro_rutiner).toMatchObject({ level: 0, levelSource: "auto" });
  });

  it("keptPrefill: ett fält som coachen ändrat är inte längre förifyllt", () => {
    const marks = { overallStatus: { checkInId: "ci-1", heldAt: "2027-01-22T10:00" }, summary: "rules" as const, plan: { goal1: "check_in" as const, goal2: "previous" as const } };
    const before = { summary: "S", overallStatus: "green" as const, plan: { ...prevPlan, goal1: "Söka jobb" } };
    expect(keptPrefill(marks, before, before)).toEqual(marks);
    const after = { summary: "Ändrad", overallStatus: "yellow" as const, plan: { ...prevPlan, goal1: "Nytt mål" } };
    expect(keptPrefill(marks, before, after)).toEqual({ plan: { goal2: "previous" } });
  });
});

describe("godkännandet", () => {
  const areas: Record<string, AreaAssessment> = {
    narvaro_rutiner: autoArea(),
    yrkesfardigheter: { level: 2, observation: AUTO_OBSERVATION, nextStep: "", aiLevelSuggestion: 2, aiObservationDraft: null, levelSource: "ai" },
    sjalvstandighet: { level: 1, observation: "Planerar själv sin vecka.", nextStep: "", aiLevelSuggestion: null, aiObservationDraft: null },
  };

  it("missingAreas: nivå saknas, eller nivå från avtalets gräns med den automatiska texten som observation", () => {
    expect(missingAreas(areas, KEYS, 1)).toEqual(["yrkesfardigheter"]);
    expect(missingAreas({ ...areas, narvaro_rutiner: { ...autoArea(), level: null } }, KEYS, 1)).toEqual(["narvaro_rutiner", "yrkesfardigheter"]);
    expect(missingAreas(areas, KEYS, 3)).toEqual([]);
  });

  it("approvalCounts: automatiska, coachens val och godtagna AI-förslag", () => {
    expect(approvalCounts(areas, KEYS)).toEqual({ autoAreas: 1, coachAreas: 1, aiAccepted: 1 });
  });
});

describe("applyAiDraft: AI-utkastet skriver aldrig nivån", () => {
  const base = (p: Partial<MonthlyAssessment> = {}): MonthlyAssessment => ({
    id: "ma-1", caseId: "case-1", month: "2027-01", areas: { yrkesfardigheter: autoArea(), sjalvstandighet: { ...autoArea(), level: 1, levelSource: "coach" } },
    status: "draft", decidedBy: null, decidedAt: null, summary: "Regeltext.", aiSummaryDraft: null, overallStatus: "green", version: 3, prefill: { summary: "rules" }, ...p,
  });
  const ev = { quote: "Klarade momentet utan stöd.", source: "Avstämning 15 jan", date: "2027-01-15" };
  const drafts = {
    areas: {
      yrkesfardigheter: { observation: { text: "Yrkesmoment 3 av 4 veckor.", sources: ["Avstämning 15 jan"], noEvidence: false }, suggestion: { level: 2 as const, evidence: ev } },
      sjalvstandighet: { observation: { text: "Framgår inte.", sources: [], noEvidence: true }, suggestion: { level: 3 as const, evidence: ev } },
    },
    summary: "AI-sammanfattning.",
    plan: "Mål: söka två jobb.",
  };

  it("förslag och belägg sparas som förslag – nivån och ursprunget rörs inte; utan belägg inget förslag", () => {
    const out = applyAiDraft(base(), null, drafts);
    expect(out.ma.areas.yrkesfardigheter).toMatchObject({ level: 0, levelSource: "auto", aiLevelSuggestion: 2, aiLevelEvidence: ev, aiObservationDraft: drafts.areas.yrkesfardigheter.observation });
    expect(out.ma.areas.sjalvstandighet).toMatchObject({ level: 1, levelSource: "coach", aiLevelSuggestion: null, aiLevelEvidence: null });
  });

  it("förifylld sammanfattning och plan byts mot AI-utkastet (märkt ai) – coachens egen text rörs inte", () => {
    const plan = { goal1: "", goal2: "", plannedActivities: "Gammalt", plannedEmployerContact: "", plannedAdaptation: "", nextCustomerMeeting: null };
    const a = applyAiDraft(base({ prefill: { summary: "rules", plan: { plannedActivities: "previous" } } }), plan, drafts);
    expect([a.ma.summary, a.ma.prefill.summary, a.plan?.plannedActivities, a.ma.prefill.plan?.plannedActivities, a.visible]).toEqual(["AI-sammanfattning.", "ai", "Mål: söka två jobb.", "ai", true]);
    const b = applyAiDraft(base({ prefill: {} }), plan, drafts);
    expect([b.ma.summary, b.plan?.plannedActivities, b.visible]).toEqual(["Regeltext.", "Gammalt", false]);
  });
});

describe("refreshPrefill: en mötesrapport godkänd efter att utkastet skapades", () => {
  const oct = (p: Partial<PrefillInput> = {}) => input({ month: "2026-10", ...p });
  const before = prefillAssessment(oct({ checkIns: [ci("ci-1", "2026-10-22T10:00", { overallStatus: "green", nextGoal: "Söka två jobb" })] }));
  const fresh = prefillAssessment(oct({
    checkIns: [ci("ci-1", "2026-10-22T10:00", { overallStatus: "green", nextGoal: "Söka två jobb" }), ci("ci-2", "2026-10-30T10:00", { overallStatus: "yellow", nextGoal: "Gå på intervjun" })],
  }));
  const ma = { summary: before.summary, overallStatus: before.overallStatus, prefill: before.prefill };

  it("automatiskt märkta fält får den nya mötesrapporten: samlad status, sammanfattningen och mål 1", () => {
    const r = refreshPrefill(ma, { goal1: before.plan.goal1 }, fresh);
    expect(r.changed).toBe(true);
    expect(r.assessment.overallStatus).toBe("yellow");
    expect(r.assessment.prefill.overallStatus).toEqual({ checkInId: "ci-2", heldAt: "2026-10-30T10:00" });
    expect(r.assessment.summary).toBe(fresh.summary);
    expect(r.assessment.summary).toMatch(/Godkända mötesrapporter: 2\./);
    expect(r.plan).toEqual({ goal1: "Gå på intervjun" });
  });

  it("coachens ändringar och AI:s sammanfattning rörs aldrig; inget nytt – ingen ändring", () => {
    const own = refreshPrefill({ summary: "Min text.", overallStatus: "red", prefill: {} }, { goal1: "Mitt mål" }, fresh);
    expect(own).toEqual({ assessment: { summary: "Min text.", overallStatus: "red", prefill: {} }, plan: null, changed: false });
    const ai = refreshPrefill({ ...ma, summary: "AI:s text.", prefill: { ...ma.prefill, summary: "ai" } }, null, fresh);
    expect(ai.assessment.summary).toBe("AI:s text.");
    expect(refreshPrefill({ summary: fresh.summary, overallStatus: fresh.overallStatus, prefill: fresh.prefill }, { goal1: fresh.plan.goal1 }, fresh).changed).toBe(false);
  });
});
