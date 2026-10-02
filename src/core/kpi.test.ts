import { describe, expect, it } from "vitest";
import type { Case, ResultClass } from "@/data/schema";
import { windowStart } from "./env";
import { kpiValue, kpis, resultForecast, resultRate, resultTally, resultTrend } from "./kpi";
import { cfgWith, mkActivity, mkAttendance, mkCase, mkEvent, mkPulseResponse, mkReport, testDb, testEnv } from "./test-data";

const env = testEnv();
let n = 0;
const closed = (endDate: string, resultClass: ResultClass, verified = true, p: Partial<Case> = {}): Case =>
  mkCase({ id: `k${++n}`, status: "closed", startDate: "2026-09-14", endDate, resultClass, resultVerifiedAt: resultClass === "result" && verified ? `${endDate}T12:00` : null, ...p });

/** 4 verifierade resultat, 1 preliminärt, 6 utan resultat och 1 som inte räknas – alla avslutade i januari. */
const january = () => [
  ...["2027-01-08", "2027-01-12", "2027-01-19", "2027-01-26"].map((d) => closed(d, "result")),
  closed("2027-01-27", "result", false),
  ...["2027-01-05", "2027-01-07", "2027-01-14", "2027-01-15", "2027-01-21", "2027-01-28"].map((d) => closed(d, "no_result")),
  closed("2027-01-22", "excluded"),
];

describe("fönster", () => {
  it("rullande 6 och 3 månader räknas från månadens första dag; sedan start från avtalets start", () => {
    expect(windowStart("rolling_6m", env)).toBe("2026-08-01");
    expect(windowStart("rolling_3m", env)).toBe("2026-11-01");
    expect(windowStart("since_start", env)).toBe("2026-09-10");
  });
});

describe("resultatgrad = verifierade resultat / avslut som räknas", () => {
  it("räknar täljare, nämnare, preliminära och exkluderade", () => {
    const r = resultRate(testDb({ cases: january() }), {}, env);
    expect(r).toEqual({ value: 4 / 11, num: 4, den: 11, prelim: 1, excluded: 1, closed: 12, status: "ok", minN: 10, contractTarget: 0.32, internalTarget: 0.35 });
  });
  it("under internt mål (35 %) men över avtalsmålet (32 %)", () => {
    const r = resultRate(testDb({ cases: [...january(), closed("2027-01-29", "no_result")] }), {}, env);
    expect(r.value).toBeCloseTo(4 / 12);
    expect(r.status).toBe("below_internal");
  });
  it("under avtalsmålet", () => {
    const cs = january().slice(1);
    const r = resultRate(testDb({ cases: cs }), {}, env);
    expect([r.num, r.den]).toEqual([3, 10]);
    expect(r.status).toBe("below_contract");
  });
  it("färre än minN avslut ger 'insufficient' oavsett värde", () => {
    const cs = january().slice(0, 9);
    const r = resultRate(testDb({ cases: cs }), {}, env);
    expect(r.den).toBe(9);
    expect(r.status).toBe("insufficient");
  });
  it("mål och minN läses från konfigurationen", () => {
    const cfg = cfgWith((c) => {
      const k = c.kpis.find((x) => x.key === "resultatgrad");
      if (k) { k.minN = 20; k.internalTarget = "ATT_FASTSTÄLLA"; }
    });
    const r = resultRate(testDb({ cases: january() }), {}, { ...env, cfg });
    expect(r).toMatchObject({ status: "insufficient", minN: 20, internalTarget: null });
  });
  it("fönstret avgör vilka avslut som räknas", () => {
    const db = testDb({ cases: [closed("2026-10-15", "result"), closed("2026-09-05", "result"), closed("2026-12-01", "no_result"), closed("2027-02-01", "result")] });
    expect(resultRate(db, {}, env).den).toBe(4);
    expect(resultRate(db, { window: "rolling_3m" }, env).den).toBe(2);
    expect(resultRate(db, { window: "since_start" }, env).den).toBe(3);
    expect(resultRate(db, { from: "2026-12-01", to: "2026-12-31" }, env)).toMatchObject({ num: 0, den: 1, value: 0 });
  });
  it("per coach och per område", () => {
    const db = testDb({ cases: [closed("2027-01-10", "result", true, { leadCoachId: "u-erik", primaryAreaCode: "B" }), closed("2027-01-11", "no_result")] });
    expect(resultRate(db, { coachId: "u-erik" }, env)).toMatchObject({ num: 1, den: 1 });
    expect(resultRate(db, { area: "G" }, env)).toMatchObject({ num: 0, den: 1 });
  });
  it("inga avslut -> inget värde", () => {
    expect(resultRate(testDb(), {}, env)).toMatchObject({ value: null, den: 0, status: "insufficient" });
  });
  it("ett avslutat ärende utan resultatklass räknas i nämnaren men inte i täljaren (resultTally – samma siffror som förut)", () => {
    const noClass = mkCase({ id: "k-utan", status: "closed", startDate: "2026-09-14", endDate: "2027-01-30", resultClass: null, resultVerifiedAt: null });
    const r = resultRate(testDb({ cases: [...january(), noClass] }), {}, env);
    expect(r).toMatchObject({ num: 4, den: 12, prelim: 1, excluded: 1, closed: 13, value: 4 / 12 });
    expect(resultTally([{ resultClass: "result", verified: true }, { resultClass: "no_result", verified: false }, { resultClass: null, verified: false }, { resultClass: "excluded", verified: false }]))
      .toEqual({ num: 1, den: 3, prelim: 0, excluded: 1, closed: 4, missing: 1, value: 1 / 3 });
    expect(resultTally([])).toMatchObject({ den: 0, value: null, missing: 0 });
  });
});

describe("prognos och trend", () => {
  it("prognosen räknar med preliminära och deltagare i fas 5 eller med arbetserbjudande", () => {
    const cs = [...january(), mkCase({ id: "f5", status: "active", phase: 5 }), mkCase({ id: "offer", status: "active", phase: 3 }), mkCase({ id: "f2", status: "active", phase: 2 })];
    const db = testDb({ cases: cs, outcome_events: [mkEvent({ id: "e1", caseId: "offer", kind: "arbetserbjudande" })] });
    expect(resultForecast(db, env)).toEqual({ value: (4 + 1 + 2) / (11 + 2), candidates: 2, withOffer: 1, offerOnly: (4 + 1 + 1) / (11 + 1), prelim: 1 });
  });
  it("trend per avslutad månad sedan avtalets start med kumulativt värde", () => {
    const db = testDb({ cases: [closed("2026-10-15", "result"), closed("2026-11-10", "no_result"), ...january()] });
    const t = resultTrend(db, env);
    expect(t.map((x) => x.month)).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]);
    expect(t.map((x) => [x.num, x.den, x.cumulativeN])).toEqual([[0, 0, 0], [1, 1, 1], [0, 1, 2], [0, 0, 2], [4, 11, 13]]);
    expect(t[4].cumulative).toBeCloseTo(5 / 13);
  });
});

describe("månads-KPI:er (förra månaden)", () => {
  it("avrop besvarade inom en arbetsdag – trettondedagen räknas inte", () => {
    const cs = [
      mkCase({ id: "a", referredAt: "2027-01-05T08:50", confirmedAt: "2027-01-07T09:13" }),
      mkCase({ id: "b", referredAt: "2027-01-11T11:00", confirmedAt: "2027-01-11T13:38" }),
      mkCase({ id: "c", referredAt: "2027-01-14T10:00", status: "declined", declinedAt: "2027-01-15T09:00" }),
      mkCase({ id: "d", referredAt: "2026-12-30T10:00", confirmedAt: "2026-12-30T11:00" }),
      mkCase({ id: "e", referredAt: "2027-01-29T15:20", status: "acknowledged" }),
    ];
    const v = kpiValue(testDb({ cases: cs }), "avrop_besvarade_i_tid", {}, env);
    expect(v).toMatchObject({ label: "Avrop besvarade inom en arbetsdag", num: 2, den: 3, target: 1, targetUnset: false, status: "below_internal" });
    expect(v?.late?.map((c) => c.id)).toEqual(["a"]);
  });
  it("första möte inom en vecka", () => {
    const cs = [
      mkCase({ id: "a", referredAt: "2027-01-04T11:45", firstMeetingAt: "2027-01-11T13:00" }),
      mkCase({ id: "b", referredAt: "2027-01-11T11:00", firstMeetingAt: "2027-01-18T10:00" }),
    ];
    const v = kpiValue(testDb({ cases: cs }), "forsta_mote_inom_en_vecka", {}, env);
    expect(v).toMatchObject({ num: 1, den: 2, value: 0.5, status: "below_internal" });
    expect(v?.late?.map((c) => c.id)).toEqual(["a"]);
  });
  it("veckorapporter och månadsrapporter i tid (bara passerade förfallotider i månaden)", () => {
    const reports = [
      mkReport({ id: "w1", kind: "weekly_attendance", dueAt: "2027-01-11T16:00", deliveredAt: "2027-01-11T07:00" }),
      mkReport({ id: "w2", kind: "weekly_attendance", dueAt: "2027-01-18T16:00", deliveredAt: "2027-01-18T16:40" }),
      mkReport({ id: "w3", kind: "weekly_attendance", dueAt: "2027-02-01T16:00" }),
      mkReport({ id: "m1", kind: "monthly", dueAt: "2027-01-11T23:59", deliveredAt: "2027-01-08T10:00" }),
    ];
    expect(kpiValue(testDb({ reports }), "veckorapporter_i_tid", {}, env)).toMatchObject({ num: 1, den: 2, value: 0.5, status: "below_internal" });
    expect(kpiValue(testDb({ reports }), "manadsrapporter_i_tid", {}, env)).toMatchObject({ num: 1, den: 1, status: "ok", provisional: true });
  });
  it("närvarograd utan fastställt mål visas utan status mot mål", () => {
    const db = testDb({
      activities: [mkActivity({ id: "a1", caseId: "c1", startsAt: "2027-01-12T10:00" }), mkActivity({ id: "a2", caseId: "c1", startsAt: "2027-01-13T10:00" })],
      attendance: [mkAttendance({ activityId: "a1", caseId: "c1", status: "present" }), mkAttendance({ activityId: "a2", caseId: "c1", status: "absent_valid", reason: "Sjukdom" })],
    });
    expect(kpiValue(db, "narvarograd", {}, env)).toEqual({
      key: "narvarograd", label: "Närvarograd", value: 0.5, num: 1, den: 2, target: null, targetUnset: true, status: "no_target", absentValid: 1, absentInvalid: 0,
    });
    expect(kpiValue(testDb(), "narvarograd", {}, env)?.status).toBe("no_data");
  });
  it("nöjdhet: andel 4–5 senaste tre månaderna, per coach", () => {
    const rs = [
      mkPulseResponse({ id: "r1", inviteId: "i1", caseId: "c1", submittedAt: "2027-01-10T10:00", answers: { q1: 5, q2: 4, q3: 4, q4: "jobb", q5: "nej" } }),
      mkPulseResponse({ id: "r2", inviteId: "i2", caseId: "c2", submittedAt: "2026-12-10T10:00", answers: { q1: 2, q2: 4, q3: 4, q4: "jobb", q5: "nej" }, coachId: "u-erik" }),
      mkPulseResponse({ id: "r3", inviteId: "i3", caseId: "c3", submittedAt: "2026-10-10T10:00", answers: { q1: 5, q2: 4, q3: 4, q4: "jobb", q5: "nej" } }),
    ];
    expect(kpiValue(testDb({ pulse_responses: rs }), "nojdhet", {}, env)).toMatchObject({ num: 1, den: 2, value: 0.5, status: "no_target", minN: 5 });
    expect(kpiValue(testDb({ pulse_responses: rs }), "nojdhet", { coachId: "u-amira" }, env)).toMatchObject({ num: 1, den: 1 });
  });
  it("resultatgraden som KPI har avtalsmål och preliminära", () => {
    expect(kpiValue(testDb({ cases: january() }), "resultatgrad", {}, env)).toEqual({
      key: "resultatgrad", label: "Resultatgrad (arbete eller studier)", value: 4 / 11, num: 4, den: 11, target: 0.35, contractTarget: 0.32, status: "ok", prelim: 1,
    });
  });
  it("alla avtalets KPI:er i konfigurationens ordning; okända nycklar räknas inte", () => {
    expect(kpis(testDb(), {}, env).map((k) => k.key)).toEqual([
      "resultatgrad", "avrop_besvarade_i_tid", "forsta_mote_inom_en_vecka", "veckorapporter_i_tid", "manadsrapporter_i_tid", "narvarograd", "nojdhet",
    ]);
    expect(kpiValue(testDb(), "placeringsgrad", {}, env)).toBeNull();
  });
});
