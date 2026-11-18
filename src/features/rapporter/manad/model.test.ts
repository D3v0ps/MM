// Den interna månadsrapportens vy-modell (Karims beslut 2026-11-18) – ren funktion, handgjorda testdata (bara påhittade uppgifter).
import { describe, expect, it } from "vitest";
import { attendanceStats } from "@/core/attendance";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { resultRate } from "@/core/kpi";
import { mkActivity, mkAttendance, mkCase, mkEvent } from "@/core/test-data";
import type { Case, CaseAreaChange, MonthlyAssessment } from "@/data/schema";
import { barPath, flowLayout, hbarLayout } from "./charts";
import { buildMonthlyOverview, overviewFilename, sortParticipants, type OverviewDb, type OverviewEnv } from "./model";

const NOW = "2027-02-01T09:12";
const JAN = "2027-01";
const AREAS = [{ code: "D", name: "Kök, restaurang och måltidsservice" }, { code: "F", name: "Lokalvård" }, { code: "G", name: "Lager och logistik" }];
const env = (p: Partial<OverviewEnv> = {}): OverviewEnv => ({
  cfg: BOTKYRKA_CONFIG, contractStart: "2026-09-10", now: NOW, month: JAN, area: null, name: (id) => `Namn ${id}`, showCommercial: true, ...p,
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
    expect(v.attendance.byArea.map((r) => [r.key, r.planned, r.registered, r.rate])).toEqual([["D", 0, 0, null], ["F", 1, 1, 1], ["G", 5, 4, 0.5]]);
    const a = v.participants.find((p) => p.caseId === "a")!;
    expect(a.attendance).toMatchObject({ registered: 3, attended: 2, detail: "2 av 3" });
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
    expect(v.participants.find((p) => p.caseId === "c")?.progression.state).toBe("not_approved");
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
    expect(v.progression.achieved).toEqual([{ id: "g1", label: "Har ett uppdaterat CV", areaLabel: "Beredskap för praktik, arbete eller studier", participants: 1 }]);
    // Tränade: a (g3 eget tillfälle, g1 och g2 i gruppen), b (g1 och g2 i gruppen; g3 frånvaro, ga2 inställd).
    expect(v.progression.trainedCount).toBe(5);
    expect(v.progression.areas.find((r) => r.key === "beredskap")).toMatchObject({ achieved: 1, trained: 4 });
    expect(v.progression.areas.find((r) => r.key === "narvaro_rutiner")).toMatchObject({ achieved: 0, trained: 1 });
    expect(v.participants.find((p) => p.caseId === "a")?.goals).toMatchObject({ achieved: 1, trained: 3, text: "1 uppnådda, 3 tränade" });
    // Aktiviteterna: vilka delmål tillfällena tränade och vilka som var med.
    expect(v.activities.goals.map((g) => [g.id, g.sessions, g.participants])).toEqual([["g3", 2, 1], ["g1", 2, 2], ["g2", 2, 2]]);
    expect(v.activities.groupActivities).toBe(2);
    expect(v.activities.byKind.find((k) => k.kind === "yrkesmoment")).toMatchObject({ held: 3, inGroup: 3, participants: 2, goals: 2 });
  });
});

describe("resultat", () => {
  it("resultatgraden räknas som nyckeltalet, med notisen om litet underlag ur kpis", () => {
    const v = buildMonthlyOverview(db({ cases: CASES }), env());
    const kpi = resultRate({ cases: CASES.filter((c) => c.id !== "x") }, { from: "2027-01-01", to: "2027-01-31" }, { cfg: BOTKYRKA_CONFIG, now: NOW, contractStart: "2026-09-10" });
    expect(v.results.month).toMatchObject({ value: kpi.value, num: kpi.num, den: kpi.den, status: "insufficient", contractTarget: 0.32, internalTarget: 0.35 });
    expect(v.results.month).toMatchObject({ num: 1, den: 1, valueText: "100,0\u00a0%" });
    expect(v.results.month.note).toBe("Underlaget är litet (färre än 10 avslut som räknas). Jämför försiktigt.");
    // Rullande sex månader till och med januari, aldrig före avtalets start: september 2026 – januari 2027 (x räknas med).
    expect(v.results.rolling).toMatchObject({ period: "september 2026 – januari 2027", num: 2, den: 2 });
    expect(v.results.closures.map((c) => [c.key, c.count, c.counted])).toEqual([["result_verified", 1, true], ["excluded", 1, false]]);
    // En begränsad testare ser inte det interna målet.
    expect(buildMonthlyOverview(db({ cases: CASES }), env({ showCommercial: false })).results.month.internalTarget).toBeNull();
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
    expect(v.participants.find((p) => p.caseId === "d")).toMatchObject({ periodText: "18 jan 2027 – 29 jan 2027", startedInMonth: true, endedInMonth: true, name: "Namn d" });
  });

  it("filnamnet har bara avtalets prefix, rapportens slag och månaden", () => {
    expect(overviewFilename("BOT", "2027-01")).toBe("rapport_bot_manadsrapport_2027-01.pdf");
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
