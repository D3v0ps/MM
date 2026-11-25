// Den interna månadsrapportens vy-modell (Karims beslut 2026-11-18) – ren funktion, handgjorda testdata (bara påhittade uppgifter).
import { describe, expect, it } from "vitest";
import { attendanceStats } from "@/core/attendance";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { resultRate } from "@/core/kpi";
import { mkActivity, mkAttendance, mkCase, mkEvent } from "@/core/test-data";
import type { Case, CaseAreaChange, MonthlyAssessment } from "@/data/schema";
import { barPath, flowLayout, hbarLayout } from "./charts";
import { buildMonthlyOverview, maskParticipant, overviewFilename, sortParticipants, type OverviewDb, type OverviewEnv } from "./model";

const NOW = "2027-02-01T09:12";
const JAN = "2027-01";
const AREAS = [{ code: "D", name: "Kök, restaurang och måltidsservice" }, { code: "F", name: "Lokalvård" }, { code: "G", name: "Lager och logistik" }];
const env = (p: Partial<OverviewEnv> = {}): OverviewEnv => ({
  cfg: BOTKYRKA_CONFIG, contractStart: "2026-09-10", now: NOW, month: JAN, area: null, showCommercial: true, showRate: true, ...p,
});
const db = (p: Partial<OverviewDb> = {}): OverviewDb => ({
  cases: [], case_area_changes: [], contract_areas: AREAS, activities: [], attendance: [], group_activities: [], activity_progress_goals: [], monthly_assessments: [],
  progress_goals: [], case_progress_goals: [], outcome_events: [], bonus_claims: [], ...p,
});
const areasAt = (level: 0 | 1 | 2 | 3 | null, keys = BOTKYRKA_CONFIG.progression.areas): MonthlyAssessment["areas"] =>
  Object.fromEntries(keys.map((k) => [k, { level, observation: "", nextStep: "" }])) as MonthlyAssessment["areas"];
const area = (level: 0 | 1 | 2 | 3, observation = ""): MonthlyAssessment["areas"][string] => ({ level, observation, nextStep: "", aiLevelSuggestion: null, aiObservationDraft: null });
const ma = (id: string, caseId: string, status: MonthlyAssessment["status"], areas: MonthlyAssessment["areas"], month = JAN) => ({ id, caseId, month, status, areas });

// Ärenden i januari 2027:
//   a  G, startade i december, pågår                → vid start
//   b  G, startade 11 jan, pågår                    → startade
//   c  G, startade i november, avslutades 20 jan     → vid start och avslutad (arbete, verifierat)
//   d  F, startade 18 jan, avslutades 29 jan        → startade och avslutad (avbrott, räknas inte)
//   e  G→D: bytet gjordes 15 jan och gäller från februari – i januari G, i februari D
//   x  avslutad i december – inte med i januari
//   y  bekräftad utan startdatum (deltagaren kom inte till första mötet) – aldrig med
const CASES: Case[] = [
  mkCase({ id: "a", startDate: "2026-12-07", primaryAreaCode: "G" }),
  mkCase({ id: "b", startDate: "2027-01-11", primaryAreaCode: "G" }),
  mkCase({ id: "c", startDate: "2026-11-02", primaryAreaCode: "G", status: "closed", endDate: "2027-01-20", closedAt: "2027-01-20T15:00", endReason: "arbete", resultClass: "result", resultVerifiedAt: "2027-01-25T10:00" }),
  mkCase({ id: "d", startDate: "2027-01-18", primaryAreaCode: "F", status: "closed", endDate: "2027-01-29", closedAt: "2027-01-29T15:00", endReason: "avbrott_flytt", resultClass: "excluded" }),
  mkCase({ id: "e", startDate: "2026-12-14", primaryAreaCode: "D" }),
  mkCase({ id: "x", startDate: "2026-10-05", primaryAreaCode: "G", status: "closed", endDate: "2026-12-18", closedAt: "2026-12-18T15:00", endReason: "studier", resultClass: "result", resultVerifiedAt: "2026-12-20T10:00" }),
  mkCase({ id: "y", status: "confirmed", startDate: null, primaryAreaCode: "G", firstMeetingAt: "2027-01-12T10:00" }),
];
const CHANGE: Pick<CaseAreaChange, "id" | "caseId" | "fromArea" | "toArea" | "effectiveMonth" | "changedAt" | "seq"> = {
  id: "ch-e", caseId: "e", fromArea: "G", toArea: "D", effectiveMonth: "2027-02", changedAt: "2027-01-15T11:00", seq: 1,
};

describe("start och slut per yrkesområde", () => {
  it("räknar vid start, startade, avslutade och vid slut per yrkesområde – flödet går ihop", () => {
    const v = buildMonthlyOverview(db({ cases: CASES, case_area_changes: [CHANGE] }), env());
    expect(v.flow.rows.map((r) => [r.code, r.atStart, r.started, r.ended, r.atEnd])).toEqual([
      ["F", 0, 1, 1, 0],
      // e räknas i G i januari: bytet gjordes i januari men gäller från februari (areaForMonth).
      ["G", 3, 1, 1, 3],
    ]);
    expect(v.flow.total).toMatchObject({ atStart: 3, started: 2, ended: 2, atEnd: 3 });
    for (const r of [...v.flow.rows, v.flow.total]) expect(r.atStart + r.started - r.ended).toBe(r.atEnd);
    expect(v.flow.endReasons).toEqual([{ key: "arbete", label: "Arbete", count: 1 }, { key: "avbrott_flytt", label: "Avbrott: flytt", count: 1 }]);
    expect(v.participants.map((p) => p.caseId).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(v.participants.find((p) => p.caseId === "e")?.areaCode).toBe("G");
  });

  it("bytet av yrkesområde gäller från månaden efter: i februari står e i D från månadens start", () => {
    const v = buildMonthlyOverview(db({ cases: CASES, case_area_changes: [CHANGE] }), env({ month: "2027-02", now: "2027-02-20T10:00" }));
    expect(v.flow.rows.find((r) => r.code === "D")).toMatchObject({ atStart: 1, started: 0, ended: 0, atEnd: 1 });
    expect(v.flow.rows.find((r) => r.code === "G")).toMatchObject({ atStart: 2, atEnd: 2 });
    // Filtret på yrkesområde följer samma regel.
    expect(buildMonthlyOverview(db({ cases: CASES, case_area_changes: [CHANGE] }), env({ area: "D" })).participants).toEqual([]);
    expect(buildMonthlyOverview(db({ cases: CASES, case_area_changes: [CHANGE] }), env({ area: "G" })).participants.map((p) => p.caseId).sort()).toEqual(["a", "b", "c", "e"]);
  });
});

describe("närvarograd", () => {
  const acts = [
    mkActivity({ id: "a1", caseId: "a", startsAt: "2027-01-12T10:00" }),
    mkActivity({ id: "a2", caseId: "a", startsAt: "2027-01-13T10:00", kind: "yrkesmoment" }),
    mkActivity({ id: "a3", caseId: "a", startsAt: "2027-01-14T10:00" }),
    mkActivity({ id: "b1", caseId: "b", startsAt: "2027-01-12T10:00", kind: "yrkesmoment" }),
    mkActivity({ id: "b2", caseId: "b", startsAt: "2027-01-19T10:00" }),
    mkActivity({ id: "d1", caseId: "d", startsAt: "2027-01-19T10:00" }),
    // Utanför månaden – räknas inte.
    mkActivity({ id: "a0", caseId: "a", startsAt: "2026-12-30T10:00" }),
  ];
  const att = [
    mkAttendance({ activityId: "a1", caseId: "a", status: "present" }),
    mkAttendance({ activityId: "a2", caseId: "a", status: "late" }),
    mkAttendance({ activityId: "a3", caseId: "a", status: "absent_invalid", reason: "Uteblev utan att meddela" }),
    mkAttendance({ activityId: "b1", caseId: "b", status: "absent_valid", reason: "Sjukdom" }),
    // b2 är inte registrerad. d1 är automatiskt registrerad (räknas som närvaron i övrigt).
    mkAttendance({ activityId: "d1", caseId: "d", status: "present", source: "auto" }),
    mkAttendance({ activityId: "a0", caseId: "a", status: "absent_invalid" }),
  ];

  it("räknas som nyckeltalet: närvarande och sena av registrerade passerade tillfällen – totalt, per yrkesområde och per deltagare", () => {
    const v = buildMonthlyOverview(db({ cases: CASES, activities: acts, attendance: att }), env());
    const kpi = attendanceStats({ activities: acts, attendance: att }, null, "2027-01-01", "2027-01-31", { now: NOW });
    expect(v.attendance.total).toMatchObject({ planned: kpi.planned, present: kpi.present, late: kpi.late, unregistered: kpi.unregistered, rate: kpi.rate });
    expect(v.attendance.total.rate).toBeCloseTo(3 / 5);
    expect(v.attendance.total.rateText).toBe("60,0\u00a0%");
    // Raderna är yrkesområdena som har tillfällen (D har inga) – de går ihop med Totalt.
    expect(v.attendance.byArea.map((r) => [r.key, r.planned, r.registered, r.rate])).toEqual([["F", 1, 1, 1], ["G", 5, 4, 0.5]]);
    expect(v.attendance.byArea.reduce((s, r) => s + r.planned, 0)).toBe(v.attendance.total.planned);
    const a = v.participants.find((p) => p.caseId === "a")!;
    expect(a.attendance).toMatchObject({ registered: 3, attended: 2, detail: "2 av 3", present: 1, late: 1, absentValid: 0, absentInvalid: 1, unregistered: 0 });
    expect(v.participants.find((p) => p.caseId === "b")?.attendance).toMatchObject({ absentValid: 1, unregistered: 1, registered: 1 });
    // Totalt för tillfällena per typ har samma närvarograd som avsnittet Närvarograd.
    expect(v.activities.byKindTotal).toMatchObject({ key: "total", held: 6, participants: 3, rate: v.attendance.total.rate });
    expect(a.attendance.rate).toBeCloseTo(2 / 3);
    // Diagrammet har samma tal som tabellen (yrkesområden utan registrerade tillfällen har ingen stapel).
    expect(v.attendance.chart.bars.map((b) => [b.key, b.value])).toEqual([["F", 1], ["G", 0.5]]);
    expect(v.attendance.chart.ariaLabel).toContain("G Lager och logistik: 50,0\u00a0%");
  });

  it("att deltagaren inte kom till första mötet är inget tillfälle – ärendet utan start räknas inte någonstans", () => {
    const v = buildMonthlyOverview(db({ cases: CASES, activities: acts, attendance: att }), env());
    expect(v.participants.some((p) => p.caseId === "y")).toBe(false);
    expect(v.totals.participants).toBe(5);
    // Underlaget har ingen tabell för registreringen (first_meeting_no_shows läses aldrig).
    expect(Object.keys(db())).not.toContain("first_meeting_no_shows");
  });

  it("tillfällen som inte har passerat räknas inte i innevarande månad", () => {
    const later = [...acts, mkActivity({ id: "a9", caseId: "a", startsAt: "2027-02-01T13:00" }), mkActivity({ id: "a8", caseId: "a", startsAt: "2027-02-01T08:00" })];
    const v = buildMonthlyOverview(db({ cases: CASES, activities: later, attendance: att }), env({ month: "2027-02" }));
    expect(v.partial).toBe(true);
    expect(v.attendance.total.planned).toBe(1);
    expect(v.activities.held).toBe(1);
  });
});

describe("progression", () => {
  const goals = [
    { id: "g1", areaKey: "beredskap", label: "Har ett uppdaterat CV", sortOrder: 1 },
    { id: "g2", areaKey: "beredskap", label: "Har ett personligt brev", sortOrder: 2 },
    { id: "g3", areaKey: "narvaro_rutiner", label: "Håller en egen veckoplan", sortOrder: 1 },
  ];
  const assessments = [
    ma("m-a", "a", "approved", { ...areasAt(1), beredskap: area(3, "Skrev CV."), halsa_funktionellt: area(2) }),
    ma("m-b", "b", "approved", areasAt(0)),
    // Utkast (också automatiskt ifyllda) räknas aldrig.
    ma("m-c", "c", "draft", areasAt(3)),
    ma("m-e", "e", "submitted" as MonthlyAssessment["status"], areasAt(3)),
  ];

  it("bara godkända bedömningar, nivåerna bara som fördelning – aldrig ett medelvärde", () => {
    const v = buildMonthlyOverview(db({ cases: CASES, monthly_assessments: assessments }), env());
    expect(v.progression.approved).toBe(2);
    const beredskap = v.progression.areas.find((r) => r.key === "beredskap")!;
    expect(beredskap.levels).toEqual([1, 0, 0, 1]);
    const narvaro = v.progression.areas.find((r) => r.key === "narvaro_rutiner")!;
    expect(narvaro.levels).toEqual([1, 1, 0, 0]);
    // Summan: tio obligatoriska områden × två bedömningar.
    expect(v.progression.total.levels.reduce((s, n) => s + n, 0)).toBe(20);
    expect(v.progression.total.levels).toEqual([10, 9, 0, 1]);
    // Tydlig progression (minst ett område på nivå 2): bara a. Någon progression: bara a.
    expect([v.progression.clear, v.progression.any]).toEqual([1, 1]);
    // Inga medelvärden någonstans i modellen.
    const json = JSON.stringify(v.progression);
    expect(json).not.toMatch(/average|mean|medel|snitt/i);
    expect(v.progression.levelChart.bars.map((b) => b.value)).toEqual([10, 9, 0, 1]);
    // Valfria områden räknas aldrig i summan – de står för sig när något är bedömt.
    expect(v.progression.optional.map((r) => [r.key, r.levels])).toEqual([["halsa_funktionellt", [0, 0, 1, 0]]]);
    expect(v.progression.areas.some((r) => r.key === "halsa_funktionellt")).toBe(false);
    expect(v.participants.find((p) => p.caseId === "c")?.progression).toMatchObject({ state: "not_approved", text: "Väntar på godkännande", areas: [] });
    // Nivåerna per progressionsområde ur den godkända bedömningen – en lista, aldrig ett medelvärde (valfria bara när de är bedömda).
    const aLevels = v.participants.find((p) => p.caseId === "a")!.progression.areas;
    expect(aLevels).toHaveLength(BOTKYRKA_CONFIG.progression.areas.length + 1);
    expect(aLevels.find((x) => x.key === "beredskap")).toMatchObject({ level: 3, text: "Beredskap för praktik, arbete eller studier: nivå 3" });
    expect(aLevels.at(-1)).toMatchObject({ key: "halsa_funktionellt", level: 2 });
    expect(v.participants.find((p) => p.caseId === "a")?.progression.text).toBe("Tydlig progression");
  });

  it("delmål: uppnått i månaden av en människa, och Tränar ur närvaron på tillfällen som tränar delmålet", () => {
    const acts = [
      mkActivity({ id: "own1", caseId: "a", startsAt: "2027-01-12T10:00" }),
      mkActivity({ id: "own2", caseId: "b", startsAt: "2027-01-12T10:00" }),
      mkActivity({ id: "grp-a", caseId: "a", startsAt: "2027-01-14T10:00", kind: "yrkesmoment", groupActivityId: "ga1" }),
      mkActivity({ id: "grp-b", caseId: "b", startsAt: "2027-01-14T10:00", kind: "yrkesmoment", groupActivityId: "ga1" }),
      mkActivity({ id: "grp-x", caseId: "b", startsAt: "2027-01-21T10:00", kind: "yrkesmoment", groupActivityId: "ga2" }),
    ];
    const att = [
      mkAttendance({ activityId: "own1", caseId: "a", status: "present" }),
      mkAttendance({ activityId: "own2", caseId: "b", status: "absent_invalid" }),
      mkAttendance({ activityId: "grp-a", caseId: "a", status: "late" }),
      mkAttendance({ activityId: "grp-b", caseId: "b", status: "present" }),
      mkAttendance({ activityId: "grp-x", caseId: "b", status: "present" }),
    ];
    const v = buildMonthlyOverview(
      db({
        cases: CASES, activities: acts, attendance: att, progress_goals: goals,
        activity_progress_goals: [{ id: "own1", caseId: "a", goalIds: ["g3"] }, { id: "own2", caseId: "b", goalIds: ["g3"] }],
        // ga2 är inställd – ger aldrig Tränar.
        group_activities: [
          { id: "ga1", kind: "yrkesmoment", startsAt: "2027-01-14T10:00", cancelledAt: null, progressGoalIds: ["g1", "g2"] },
          { id: "ga2", kind: "yrkesmoment", startsAt: "2027-01-21T10:00", cancelledAt: "2027-01-20T09:00", progressGoalIds: ["g1"] },
        ],
        case_progress_goals: [
          { id: "r1", caseId: "a", goalId: "g1", status: "achieved", source: "manual", achievedOn: "2027-01-20" },
          // Uppnått före månaden, Tränar och en rad som inte satts av en människa räknas inte som uppnådda i januari.
          { id: "r2", caseId: "b", goalId: "g1", status: "achieved", source: "manual", achievedOn: "2026-12-20" },
          { id: "r3", caseId: "b", goalId: "g2", status: "training", source: "auto", achievedOn: null },
          { id: "r4", caseId: "e", goalId: "g2", status: "achieved", source: "auto", achievedOn: "2027-01-22" },
        ],
      }),
      env(),
    );
    expect(v.progression.achievedCount).toBe(1);
    // Tränade: a (g3 eget tillfälle, g1 och g2 i gruppen), b (g1 och g2 i gruppen; g3 frånvaro, ga2 inställd).
    expect(v.progression.trainedCount).toBe(5);
    expect(v.progression.areas.find((r) => r.key === "beredskap")).toMatchObject({ achieved: 1, trained: 4 });
    expect(v.progression.areas.find((r) => r.key === "narvaro_rutiner")).toMatchObject({ achieved: 0, trained: 1 });
    expect(v.participants.find((p) => p.caseId === "a")?.goals).toMatchObject({ achieved: 1, trained: 3, text: "1 uppnådda, 3 tränade", lines: ["1 uppnådda", "3 tränade"] });
    // Aktiviteterna: tillfällena med delmål per progressionsområde och vilka som var med – bara antal (Karims beslut 2026-11-24).
    expect(v.activities.goalAreas.map((g) => [g.key, g.sessions, g.participants, g.trained])).toEqual([["narvaro_rutiner", 2, 1, 1], ["beredskap", 2, 2, 4]]);
    expect(v.activities.groupActivities).toBe(2);
    expect(v.activities.byKind.find((k) => k.key === "yrkesmoment")).toMatchObject({ held: 3, inGroup: 3, participants: 2, withGoals: 2 });
    // Aldrig delmålens namn eller id i vy-modellen.
    const json = JSON.stringify(v);
    for (const g of goals) {
      expect(json).not.toContain(g.label);
      expect(json).not.toContain(`"${g.id}"`);
    }
  });
});

describe("resultat", () => {
  it("resultatgraden räknas som nyckeltalet; för litet underlag står gränsen ur kpis i statusen", () => {
    const v = buildMonthlyOverview(db({ cases: CASES }), env());
    const kpi = resultRate({ cases: CASES.filter((c) => c.id !== "x") }, { from: "2027-01-01", to: "2027-01-31" }, { cfg: BOTKYRKA_CONFIG, now: NOW, contractStart: "2026-09-10" });
    expect(v.results.month).toMatchObject({ value: kpi.value, num: kpi.num, den: kpi.den, status: "insufficient", contractTarget: 0.32, internalTarget: 0.35 });
    expect(v.results.month).toMatchObject({ num: 1, den: 1, valueText: "100,0\u00a0%" });
    expect(v.results.month?.statusText).toBe("Färre än 10 avslut");
    expect(JSON.stringify(v)).not.toMatch(/Jämför försiktigt|Underlaget är litet/);
    // Rullande sex månader till och med januari, aldrig före avtalets start: september 2026 – januari 2027 (x räknas med).
    expect(v.results.rolling).toMatchObject({ period: "september 2026 – januari 2027", num: 2, den: 2 });
    expect(v.results.closures.map((c) => [c.key, c.count, c.counted])).toEqual([["result_verified", 1, true], ["excluded", 1, false]]);
    expect([v.results.closedTotal, v.results.closuresCounted, v.results.verifiedResults]).toEqual([2, 1, 1]);
    // En begränsad testare ser inte det interna målet.
    expect(buildMonthlyOverview(db({ cases: CASES }), env({ showCommercial: false })).results.month?.internalTarget).toBeNull();
  });

  it("coachen får inte resultatgraden eller målen för den (Karims beslut 2026-11-24) – allt annat är detsamma", () => {
    const full = buildMonthlyOverview(db({ cases: CASES }), env());
    const coach = buildMonthlyOverview(db({ cases: CASES }), env({ showRate: false }));
    expect(coach.results.month).toBeNull();
    expect(coach.results.rolling).toBeNull();
    expect(JSON.stringify(coach)).not.toMatch(/contractTarget|internalTarget|Resultatgrad/);
    expect({ ...coach, results: { ...coach.results, month: null, rolling: null } }).toEqual({ ...full, results: { ...full.results, month: null, rolling: null } });
    expect(coach.results.verifiedResults).toBe(1);
  });

  it("ett ärende som avslutades i månaden utan att ha startat står på en egen rad – raderna som räknas går ihop med nämnaren", () => {
    const z = mkCase({ id: "z", status: "closed", startDate: null, primaryAreaCode: "G", endDate: "2027-01-15", closedAt: "2027-01-15T10:00", endReason: "avbrott_deltagarens_val", resultClass: "no_result" });
    const zx = mkCase({ id: "zx", status: "closed", startDate: null, primaryAreaCode: "G", endDate: "2027-01-16", closedAt: "2027-01-16T10:00", endReason: "avbrott_flytt", resultClass: "excluded" });
    const v = buildMonthlyOverview(db({ cases: [...CASES, z, zx] }), env());
    expect(v.results.closures.map((c) => [c.key, c.count, c.counted])).toEqual([["result_verified", 1, true], ["excluded", 2, false], ["no_start", 1, true]]);
    expect(v.results.closures.find((c) => c.key === "no_start")?.label).toBe("Avslutade utan start");
    expect(v.results.closuresCounted).toBe(v.results.month?.den);
    expect(v.results.closedTotal).toBe(4);
    // Flödet är oförändrat: ärendet utan start är inte med i urvalet.
    expect(v.flow.total).toMatchObject({ started: 2, ended: 2 });
    expect(v.participants.some((p) => p.caseId === "z")).toBe(false);
  });

  it("händelser i månaden per typ och stegen i Progression och resultat – bara skickade och godkända, inga belopp", () => {
    const v = buildMonthlyOverview(
      db({
        cases: CASES,
        outcome_events: [
          mkEvent({ id: "e1", caseId: "c", kind: "arbete_paborjat", occurredOn: "2027-01-18", verificationKind: "anställningsbevis" }),
          mkEvent({ id: "e2", caseId: "a", kind: "praktik_startad", occurredOn: "2027-01-08", verificationKind: null }),
          mkEvent({ id: "e3", caseId: "a", kind: "praktik_startad", occurredOn: "2026-12-08", verificationKind: null }),
          // Efter avslutet (inom fönstret för resultat) räknas i månaden den hände.
          mkEvent({ id: "e4", caseId: "x", kind: "studier_paborjade", occurredOn: "2027-01-10", verificationKind: "antagningsbesked" }),
        ],
        bonus_claims: [
          { id: "b1", caseId: "c", step: 3, status: "approved", reachedOn: "2027-01-18" },
          { id: "b2", caseId: "c", step: 5, status: "submitted", reachedOn: "2027-01-18" },
          { id: "b3", caseId: "a", step: 1, status: "submitted", reachedOn: "2026-12-30" },
        ],
      }),
      env(),
    );
    expect(v.results.events.map((e) => [e.kind, e.count, e.verified])).toEqual([["praktik_startad", 1, 0], ["arbete_paborjat", 1, 1], ["studier_paborjade", 1, 1]]);
    expect(v.results.steps?.map((s) => [s.step, s.submitted, s.approved])).toEqual([[1, 0, 0], [2, 0, 0], [3, 0, 1], [4, 0, 0], [5, 1, 0]]);
    expect(v.results.steps?.[4].label).toBe("Steg 5 · Snabbt resultat");
    expect(JSON.stringify(v)).not.toMatch(/amount|belopp|öre|kr\b/i);
    expect(v.participants.find((p) => p.caseId === "c")?.results).toEqual(["Arbete påbörjat 18 jan", "Avslut: Arbete"]);
    expect(v.participants.find((p) => p.caseId === "c")?.steps).toEqual([`${v.results.steps?.[2].label}: godkänt av kommunen`, "Steg 5 · Snabbt resultat: skickat till kommunen"]);
    // Resultatet efter avslutet har en egen rad, märkt med avslutet (x avslutades i december).
    const x = v.participants.find((p) => p.caseId === "x")!;
    expect(x).toMatchObject({ outside: "Avslutad 18 dec 2026", periodLines: ["5 okt 2026", "Avslutad 18 dec 2026"], results: ["Studier påbörjade/antagen 10 jan"], endedInMonth: false });
    expect(x.attendance.rate).toBeNull();
    expect(v.totals.participants).toBe(5);
    expect(v.participants).toHaveLength(6);
    expect(v.results.eventTotal).toMatchObject({ kind: "total", count: 3, verified: 2, participants: 3 });
    // Stegen visas inte för en begränsad testare (ekonomiskt villkor).
    expect(buildMonthlyOverview(db({ cases: CASES }), env({ showCommercial: false })).results.steps).toBeNull();
  });
});

describe("per deltagare och filnamn", () => {
  it("sorteras på yrkesområde, ärendenummer eller närvarograd", () => {
    const acts = [mkActivity({ id: "a1", caseId: "a", startsAt: "2027-01-12T10:00" }), mkActivity({ id: "b1", caseId: "b", startsAt: "2027-01-12T10:00" })];
    const att = [mkAttendance({ activityId: "a1", caseId: "a", status: "absent_invalid" }), mkAttendance({ activityId: "b1", caseId: "b", status: "present" })];
    const v = buildMonthlyOverview(db({ cases: CASES, activities: acts, attendance: att }), env());
    // Utan byte står e i sitt eget yrkesområde (D).
    expect(v.participants.map((p) => p.areaCode)).toEqual(["D", "F", "G", "G", "G"]);
    expect(sortParticipants(v.participants, "narvaro").slice(0, 2).map((p) => p.caseId)).toEqual(["a", "b"]);
    expect(sortParticipants(v.participants, "arende").map((p) => p.caseNumber)).toEqual([...v.participants.map((p) => p.caseNumber)].sort());
    expect(v.participants.find((p) => p.caseId === "d")).toMatchObject({ periodText: "18 jan 2027 – 29 jan 2027", periodLines: ["18 jan 2027", "– 29 jan 2027"], startedInMonth: true, endedInMonth: true, name: "" });
  });

  it("bytet av yrkesområde står på raden i månaden det gjordes och månaden det börjar gälla", () => {
    const jan = buildMonthlyOverview(db({ cases: CASES, case_area_changes: [CHANGE] }), env());
    expect(jan.participants.find((p) => p.caseId === "e")?.areaChanges).toEqual(["G till D från februari 2027"]);
    const feb = buildMonthlyOverview(db({ cases: CASES, case_area_changes: [CHANGE] }), env({ month: "2027-02", now: "2027-02-20T10:00" }));
    expect(feb.participants.find((p) => p.caseId === "e")).toMatchObject({ areaCode: "D", areaChanges: ["G till D från februari 2027"] });
    expect(jan.participants.find((p) => p.caseId === "a")?.areaChanges).toEqual([]);
  });

  it("en skyddad rad har bara ärendenumret och området", () => {
    const acts = [mkActivity({ id: "a1", caseId: "a", startsAt: "2027-01-12T10:00" })];
    const v = buildMonthlyOverview(db({ cases: CASES, activities: acts, attendance: [mkAttendance({ activityId: "a1", caseId: "a", status: "present" })] }), env());
    const m = maskParticipant(v.participants.find((p) => p.caseId === "a")!);
    expect(m).toMatchObject({ caseId: "a", name: "Skyddade personuppgifter", restricted: true, areaCode: "G", periodLines: [], results: [], steps: [], areaChanges: [] });
    expect(m.attendance.rate).toBeNull();
    expect(m.progression.areas).toEqual([]);
  });

  it("filnamnet har bara avtalets prefix, rapportens slag och månaden", () => {
    expect(overviewFilename("BOT", "2027-01")).toBe("rapport_bot_manadsrapport_2027-01.pdf");
  });
});

describe("granskningen 2026-11-24", () => {
  it("närvarograden räknas över alla tillfällen i månaden – också för ett ärende som avslutats med ett tidigare slutdatum (som nyckeltalet)", () => {
    // w avslutades 20 december, men tillfällen i januari har registrerad närvaro (slutdatum satt i efterhand).
    const w = mkCase({ id: "w", startDate: "2026-10-05", primaryAreaCode: "F", status: "closed", endDate: "2026-12-20", closedAt: "2027-01-25T10:00", endReason: "arbete", resultClass: "result" });
    const acts = [
      mkActivity({ id: "a1", caseId: "a", startsAt: "2027-01-12T10:00" }),
      mkActivity({ id: "w1", caseId: "w", startsAt: "2027-01-12T10:00" }),
      mkActivity({ id: "w2", caseId: "w", startsAt: "2027-01-13T10:00" }),
    ];
    const att = [
      mkAttendance({ activityId: "a1", caseId: "a", status: "present" }),
      mkAttendance({ activityId: "w1", caseId: "w", status: "absent_invalid" }),
      mkAttendance({ activityId: "w2", caseId: "w", status: "present", source: "auto" }),
    ];
    const cases = [...CASES, w];
    const v = buildMonthlyOverview(db({ cases, activities: acts, attendance: att }), env());
    const kpi = attendanceStats({ activities: acts, attendance: att }, null, "2027-01-01", "2027-01-31", { now: NOW });
    expect(v.attendance.total).toMatchObject({ planned: kpi.planned, present: kpi.present, absentInvalid: kpi.absentInvalid, rate: kpi.rate });
    expect(v.attendance.total.rate).toBeCloseTo(2 / 3);
    // Yrkesområdena med tillfällen (F genom w) går ihop med Totalt; w är inte en deltagare i januari.
    expect(v.attendance.byArea.map((r) => [r.key, r.planned])).toEqual([["F", 2], ["G", 1]]);
    expect(v.participants.some((p) => p.caseId === "w")).toBe(false);
    expect(v.flow.rows.find((r) => r.code === "F")).toMatchObject({ atStart: 0, started: 1 });
  });

  it("raden per deltagare räknar bara tillfällen under insatsen – inte efter slutdatum", () => {
    const acts = [
      mkActivity({ id: "c1", caseId: "c", startsAt: "2027-01-19T10:00" }),
      // Efter c:s slutdatum 20 januari – oregistrerat, står inte på raden (men räknas i Totalt som nyckeltalet).
      mkActivity({ id: "c2", caseId: "c", startsAt: "2027-01-22T10:00" }),
      mkActivity({ id: "c3", caseId: "c", startsAt: "2027-01-26T10:00" }),
    ];
    const v = buildMonthlyOverview(db({ cases: CASES, activities: acts, attendance: [mkAttendance({ activityId: "c1", caseId: "c", status: "present" })] }), env());
    expect(v.participants.find((p) => p.caseId === "c")).toMatchObject({ activities: { held: 1 }, attendance: { unregistered: 0, registered: 1, rate: 1 } });
    expect(v.attendance.total).toMatchObject({ planned: 3, unregistered: 2 });
  });

  it("innevarande månad räknas till och med i dag: den som startar senare i månaden är inte med än", () => {
    const later = mkCase({ id: "later", startDate: "2027-02-15", primaryAreaCode: "G", status: "active" });
    const today = mkCase({ id: "idag", startDate: "2027-02-10", primaryAreaCode: "G", status: "active" });
    const v = buildMonthlyOverview(db({ cases: [...CASES, later, today] }), env({ month: "2027-02", now: "2027-02-10T09:00" }));
    expect(v.partial).toBe(true);
    expect(v.participants.some((p) => p.caseId === "later")).toBe(false);
    expect(v.participants.find((p) => p.caseId === "idag")?.startedInMonth).toBe(true);
    expect(v.flow.total.started).toBe(1);
    // En avslutad månad påverkas inte.
    expect(buildMonthlyOverview(db({ cases: [...CASES, later] }), env({ month: "2027-02", now: "2027-03-01T09:00" })).participants.some((p) => p.caseId === "later")).toBe(true);
  });

  it("utan bedömda nivåer finns inget nivådiagram – tabellen står kvar", () => {
    const v = buildMonthlyOverview(db({ cases: CASES }), env());
    expect(v.progression.levelChart.bars).toEqual([]);
    expect(v.progression.areas.length).toBe(BOTKYRKA_CONFIG.progression.areas.length);
  });
});

describe("diagrammens geometri", () => {
  it("staplarna har rak bas och rundad dataände, mållinjerna hamnar på rätt ställe", () => {
    expect(barPath(10, 0, 50, 16)).toBe("M10 0 H56 Q60 0 60 4 V12 Q60 16 56 16 H10 Z");
    expect(barPath(100, 0, 50, 16, -1)).toBe("M100 0 H54 Q50 0 50 4 V12 Q50 16 54 16 H100 Z");
    expect(barPath(0, 0, 0, 16)).toBe("");
    const g = hbarLayout([{ label: "A", value: 0.5, valueText: "50,0 %" }], "andel", [{ kind: "contract", value: 0.32, label: "Avtalets mål" }], { width: 400, fontSize: 8, rowH: 14, barH: 8, labelW: 100, valueW: 40 });
    expect(g.rows[0].w).toBeCloseTo(g.plotW / 2);
    expect(g.targets[0].x).toBeCloseTo(g.x0 + g.plotW * 0.32);
    const f = flowLayout([{ label: "G", started: 10, ended: 5 }], { width: 400, fontSize: 8, rowH: 14, barH: 8, labelW: 100, valueW: 20 });
    expect(f.rows[0].startedW).toBeCloseTo(f.half);
    expect(f.rows[0].endedW).toBeCloseTo(f.half / 2);
  });
});
