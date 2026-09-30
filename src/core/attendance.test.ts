import { describe, expect, it } from "vitest";
import { attendanceStats, repeatedAbsence, unregistered } from "./attendance";
import { mkActivity, mkAttendance, mkCase, testDb, testEnv } from "./test-data";

const env = testEnv();

// Ärende c1: fem tillfällen v. 4 och ett i framtiden (v. 5).
const acts = [
  mkActivity({ id: "a1", caseId: "c1", startsAt: "2027-01-25T10:00" }),
  mkActivity({ id: "a2", caseId: "c1", startsAt: "2027-01-26T10:00" }),
  mkActivity({ id: "a3", caseId: "c1", startsAt: "2027-01-27T10:00" }),
  mkActivity({ id: "a4", caseId: "c1", startsAt: "2027-01-28T10:00" }),
  mkActivity({ id: "a5", caseId: "c1", startsAt: "2027-01-29T10:00" }),
  mkActivity({ id: "a6", caseId: "c1", startsAt: "2027-02-01T13:00" }),
  mkActivity({ id: "b1", caseId: "c2", startsAt: "2027-01-26T13:00" }),
];
const att = [
  mkAttendance({ activityId: "a1", caseId: "c1", status: "present" }),
  mkAttendance({ activityId: "a2", caseId: "c1", status: "late" }),
  mkAttendance({ activityId: "a3", caseId: "c1", status: "absent_valid", reason: "Sjukdom" }),
  mkAttendance({ activityId: "a4", caseId: "c1", status: "absent_invalid", reason: "Uteblev utan att meddela" }),
];
const db = testDb({
  cases: [mkCase({ id: "c1", startDate: "2027-01-11" }), mkCase({ id: "c2", startDate: "2027-01-11", leadCoachId: "u-erik" })],
  activities: acts,
  attendance: att,
});

describe("närvarostatistik", () => {
  it("räknar passerade tillfällen, orsaker och närvarograd (närvarande + sena / registrerade)", () => {
    expect(attendanceStats(db, "c1", "2027-01-25", "2027-01-31", env)).toEqual({
      planned: 5, present: 1, late: 1, absentValid: 1, absentInvalid: 1, unregistered: 1, reasons: { Sjukdom: 1 }, rate: 0.5,
    });
  });
  it("framtida tillfällen räknas inte", () => {
    expect(attendanceStats(db, "c1", "2027-02-01", "2027-02-07", env).planned).toBe(0);
    expect(attendanceStats(db, "c1", "2027-02-01", "2027-02-07", testEnv({ now: "2027-02-01T14:00" })).planned).toBe(1);
  });
  it("utan ärende: alla aktiviteter", () => {
    const s = attendanceStats(db, null, "2027-01-25", "2027-01-31", env);
    expect(s.planned).toBe(6);
    expect(s.unregistered).toBe(2);
  });
  it("inget registrerat -> ingen närvarograd", () => {
    expect(attendanceStats(db, "c2", "2027-01-25", "2027-01-31", env).rate).toBeNull();
  });
});

describe("oregistrerad närvaro", () => {
  it("coachens passerade tillfällen utan registrering, i tidsordning", () => {
    expect(unregistered(db, "u-amira", "2027-01-25", "2027-02-01", env).map((x) => x.activity.id)).toEqual(["a5"]);
    expect(unregistered(db, "u-erik", "2027-01-25", "2027-02-01", env).map((x) => x.activity.id)).toEqual(["b1"]);
  });
  it("bara pågående och avslutade ärenden", () => {
    const paused = testDb({ ...db, cases: [mkCase({ id: "c1", status: "paused" })] });
    expect(unregistered(paused, "u-amira", "2027-01-25", "2027-02-01", env)).toEqual([]);
  });
});

describe("upprepad ogiltig frånvaro (2 inom 14 dagar)", () => {
  it("slår till vid två ogiltiga inom fönstret", () => {
    const two = testDb({ ...db, attendance: [...att, mkAttendance({ activityId: "a5", caseId: "c1", status: "absent_invalid" })] });
    expect(repeatedAbsence(two, "c1", env)?.map((x) => x.activityId)).toEqual(["a4", "a5"]);
  });
  it("en ogiltig räcker inte, och äldre än 14 dagar räknas inte", () => {
    expect(repeatedAbsence(db, "c1", env)).toBeNull();
    const old = testDb({
      activities: [mkActivity({ id: "o1", caseId: "c1", startsAt: "2027-01-15T10:00" }), mkActivity({ id: "o2", caseId: "c1", startsAt: "2027-01-20T10:00" })],
      attendance: [mkAttendance({ activityId: "o1", caseId: "c1", status: "absent_invalid" }), mkAttendance({ activityId: "o2", caseId: "c1", status: "absent_invalid" })],
    });
    expect(repeatedAbsence(old, "c1", env)).toBeNull();
    expect(repeatedAbsence(old, "c1", testEnv({ now: "2027-01-29T09:00" }))?.length).toBe(2);
  });
});
