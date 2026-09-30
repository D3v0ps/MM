import { describe, expect, it } from "vitest";
import { customerSummary, smallCount, stripInternal } from "./customer-summary";
import { resultRate } from "./kpi";
import { pulseStats } from "./pulse";
import { mkActivity, mkAttendance, mkCase, mkDeviation, mkPulseInvite, mkPulseResponse, testDb, testEnv } from "./test-data";
import { weeklyReport, weeklyRisk } from "./weekly-report";

const env = testEnv();

describe("veckorapport närvaro (per handläggare och vecka)", () => {
  const db = testDb({
    cases: [
      mkCase({ id: "c1", referrerId: "k-maria", startDate: "2027-01-11" }),
      mkCase({ id: "c2", referrerId: "k-maria", startDate: "2027-01-11", pausedWeeks: ["2027-W04"] }),
      mkCase({ id: "c3", referrerId: "k-maria", status: "closed", startDate: "2026-11-02", endDate: "2027-01-15" }),
      mkCase({ id: "c4", referrerId: "k-omar", startDate: "2027-01-11" }),
    ],
    activities: [
      mkActivity({ id: "a1", caseId: "c1", startsAt: "2027-01-25T10:00" }),
      mkActivity({ id: "a2", caseId: "c1", startsAt: "2027-01-27T10:00" }),
      mkActivity({ id: "a3", caseId: "c1", startsAt: "2027-01-29T10:00" }),
    ],
    attendance: [
      mkAttendance({ activityId: "a1", caseId: "c1", status: "absent_invalid" }),
      mkAttendance({ activityId: "a2", caseId: "c1", status: "absent_invalid" }),
    ],
    deviations: [mkDeviation({ id: "d1", caseId: "c1", createdAt: "2027-01-28T09:00" }), mkDeviation({ id: "d2", caseId: "c1", createdAt: "2027-01-20T09:00" })],
  });
  it("en sektion per deltagare som var inskriven under veckan", () => {
    const r = weeklyReport(db, "k-maria", "2027-W04", env);
    expect([r.monday, r.sunday]).toEqual(["2027-01-25", "2027-01-31"]);
    expect(r.sections.map((s) => s.case.id)).toEqual(["c1", "c2"]);
    expect(r.sections[1].paused).toBe(true);
  });
  it("rader, statistik, avvikelser och risk", () => {
    const s = weeklyReport(db, "k-maria", "2027-W04", env).sections[0];
    expect(s.rows.map((x) => [x.activity.id, x.att?.status ?? null])).toEqual([["a1", "absent_invalid"], ["a2", "absent_invalid"], ["a3", null]]);
    expect(s.stats).toMatchObject({ planned: 3, absentInvalid: 2, unregistered: 1 });
    expect(s.deviations.map((d) => d.id)).toEqual(["d1"]);
    expect(s.risk).toBe("Risk för avbrott – uppföljningsmöte föreslås");
  });
  it("komplett först när all närvaro är registrerad", () => {
    expect(weeklyReport(db, "k-maria", "2027-W04", env).complete).toBe(false);
    const done = testDb({ ...db, attendance: [...db.attendance, mkAttendance({ activityId: "a3", caseId: "c1", status: "present" })] });
    expect(weeklyReport(done, "k-maria", "2027-W04", env).complete).toBe(true);
  });
  it("risknivåer", () => {
    expect([weeklyRisk(0), weeklyRisk(1), weeklyRisk(2), weeklyRisk(3)]).toEqual([
      "Ingen risk noterad", "Bevakas", "Risk för avbrott – uppföljningsmöte föreslås", "Risk för avbrott – uppföljningsmöte föreslås",
    ]);
  });
});

describe("pulsmätning", () => {
  const invites = [
    mkPulseInvite({ id: "i1", caseId: "c1", sentAt: "2027-01-10T10:00" }),
    mkPulseInvite({ id: "i2", caseId: "c2", sentAt: "2027-01-12T10:00" }),
    mkPulseInvite({ id: "i3", caseId: "c1", sentAt: "2026-10-01T10:00" }),
    mkPulseInvite({ id: "pi-demo", caseId: "c1", sentAt: "2027-02-01T08:00" }),
  ];
  const responses = [
    mkPulseResponse({ id: "r1", inviteId: "i1", caseId: "c1", submittedAt: "2027-01-10T12:00", answers: { q1: 5, q2: 4, q3: 5, q4: "jobb", q5: "nej" } }),
    mkPulseResponse({ id: "r2", inviteId: "i2", caseId: "c2", submittedAt: "2027-01-12T12:00", answers: { q1: 3, q2: 2, q3: 4, q4: "praktik", q5: "nej" }, coachId: "u-erik" }),
  ];
  const db = testDb({
    cases: [mkCase({ id: "c1" }), mkCase({ id: "c2", leadCoachId: "u-erik" })], pulse_invites: invites, pulse_responses: responses,
    demo_tags: [{ id: "pi-demo", tag: "pi-demo", entity: "pulse_invites", entityIds: ["pi-demo"] }],
  });
  it("aggregat senaste tre månaderna; pulslänken för genomgången räknas inte", () => {
    expect(pulseStats(db, {}, env)).toEqual({
      invites: 2, responses: 2, responseRate: 1, q1: [0, 0, 1, 0, 1], q2: [0, 1, 0, 1, 0], q3: [0, 0, 0, 1, 1],
      satisfaction: 0.5, closer: 0.5, support: 1, priorities: { jobb: 1, praktik: 1 }, enough: false, minN: 5,
    });
  });
  it("per coach och period", () => {
    expect(pulseStats(db, { coachId: "u-erik" }, env)).toMatchObject({ invites: 1, responses: 1, satisfaction: 0 });
    expect(pulseStats(db, { from: "2026-09-10", to: "2026-12-31" }, env)).toMatchObject({ invites: 1, responses: 0, responseRate: 0, satisfaction: null });
  });
});

describe("beställarrapport (kommunens chef)", () => {
  it("det interna målet tas bort och 'under internt mål' visas som ok", () => {
    const r = resultRate(testDb(), {}, env);
    const s = stripInternal({ ...r, status: "below_internal" });
    expect(s).not.toHaveProperty("internalTarget");
    expect(s.status).toBe("ok");
    expect(stripInternal({ ...r, status: "below_contract" }).status).toBe("below_contract");
  });
  it("små grupper redovisas som 'färre än 5'", () => {
    expect([0, 1, 4, 5, 12].map((n) => smallCount(n, 5))).toEqual(["0", "färre än 5", "färre än 5", "5", "12"]);
  });
  it("räknar aktiva, startade och avslutade per område och spår", () => {
    const db = testDb({
      contract_areas: [{ id: "ar-G", contractId: "c-bot", code: "G", name: "Lager och logistik", active: true }, { id: "ar-B", contractId: "c-bot", code: "B", name: "Hälsa och sjukvård", active: true }],
      cases: [
        mkCase({ id: "a", startDate: "2027-01-11", primaryAreaCode: "G", vocationalTrack: "Truckförare A+B" }),
        mkCase({ id: "b", startDate: "2026-12-01", primaryAreaCode: "G", vocationalTrack: "E-handelslager", status: "closed", endDate: "2027-01-20", resultClass: "result", resultVerifiedAt: "2027-01-21T10:00" }),
        mkCase({ id: "c", startDate: "2026-11-01", primaryAreaCode: "B", vocationalTrack: "Truckförare A+B", status: "closed", endDate: "2026-12-20", resultClass: "no_result" }),
      ],
      monthly_assessments: [{
        id: "ma1", caseId: "a", month: "2027-01", status: "approved", decidedBy: "u-amira", decidedAt: "2027-02-01T08:00", summary: "", aiSummaryDraft: null, overallStatus: "green",
        areas: { narvaro_rutiner: { level: 2, observation: "x", nextStep: "", aiLevelSuggestion: null, aiObservationDraft: null } },
      }],
    });
    const s = customerSummary(db, "2027-01", env);
    expect([s.active, s.started, s.closed]).toEqual([2, 1, 1]);
    expect(s.byArea).toEqual([{ code: "G", name: "G Lager och logistik", active: 2, started: 1, closed: 1 }]);
    expect(s.byTrack).toEqual([{ track: "Truckförare A+B", active: 1 }, { track: "E-handelslager", active: 1 }]);
    expect(s.result.month).toEqual({ value: 1, num: 1, den: 1, prelim: 0, excluded: 0, closed: 1, status: "insufficient", minN: 10, contractTarget: 0.32 });
    expect(s.result.contractTarget).toBe(0.32);
    expect(s.progression).toMatchObject({ assessed: 1, clear: 1, any: 1 });
    expect(s.progression.areaDist[0]).toEqual({ key: "narvaro_rutiner", label: "Närvaro, punktlighet och rutiner", clear: 1, n: 1 });
    expect(s.seesSlaStats).toBe(false);
    expect(JSON.stringify(s)).not.toContain("internalTarget");
  });
});
