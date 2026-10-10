// Automatisk närvaro (Karims beslut 1, 2026-10-09): vilka tillfällen får Närvarande automatiskt när dagen är slut.
import { describe, expect, it } from "vitest";
import { autoAttendanceDue, autoAttendanceFrom, nextDayEnd, sentWeekKey, type AutoAttendanceActivity, type AutoAttendanceCase, type AutoAttendanceInput } from "./auto-attendance";

// Måndag 1 februari 2027 (vecka 5). Förra veckan = vecka 4 (25–31 januari).
const MON = "2027-02-01";
const c = (id: string, p: Partial<AutoAttendanceCase> = {}): AutoAttendanceCase => ({
  id, contractId: "c-bot", status: "active", referrerId: "k-maria", pausedWeeks: [], startDate: "2026-12-01", endDate: null, ...p,
});
const a = (id: string, caseId: string, startsAt: string, durationMin = 60): AutoAttendanceActivity => ({ id, caseId, startsAt, durationMin });
const input = (p: Partial<AutoAttendanceInput>): AutoAttendanceInput => ({
  now: `${MON}T18:05`, at: "18:00", cases: [c("c1")], activities: [], registered: new Set(), holidays: new Set(), sentWeeks: new Set(), floor: null, ...p,
});
const ids = (p: Partial<AutoAttendanceInput>) => autoAttendanceDue(input(p)).map((d) => d.activityId);

describe("autoAttendanceDue", () => {
  it("registrerar ett passerat tillfälle utan närvaro när dagen är slut – inte före klockslaget", () => {
    const acts = [a("a1", "c1", `${MON}T09:00`)];
    expect(autoAttendanceDue(input({ activities: acts }))).toEqual([
      { activityId: "a1", caseId: "c1", contractId: "c-bot", referrerId: "k-maria", day: MON, weekKey: "2027-W05" },
    ]);
    expect(ids({ activities: acts, now: `${MON}T17:59` })).toEqual([]);
    // Klockslaget är organisationens inställning.
    expect(ids({ activities: acts, now: `${MON}T16:30`, at: "16:00" })).toEqual(["a1"]);
  });

  it("ett tillfälle som inte slutat vid dagens slut registreras nästa körning", () => {
    const acts = [a("sent", "c1", `${MON}T17:30`, 60)];
    expect(ids({ activities: acts })).toEqual([]);
    expect(ids({ activities: acts, now: "2027-02-02T18:00" })).toEqual(["sent"]);
  });

  it("rör aldrig ett tillfälle som redan har närvaro eller frånvaro (manuell eller automatisk)", () => {
    const acts = [a("a1", "c1", `${MON}T09:00`), a("a2", "c1", `${MON}T13:00`)];
    expect(ids({ activities: acts, registered: new Set(["a1"]) })).toEqual(["a2"]);
  });

  it("hoppar över pausade, avslutade och inte startade ärenden, pausade veckor och dagar utanför insatsen", () => {
    const acts = [
      a("pausad", "p", `${MON}T09:00`), a("avslutad", "x", `${MON}T09:00`), a("bekraftad", "b", `${MON}T09:00`), a("uppehall", "u", `${MON}T09:00`),
      a("fore-start", "s", `${MON}T09:00`), a("efter-slut", "e", `${MON}T09:00`), a("ok", "c1", `${MON}T09:00`),
    ];
    const cases = [
      c("p", { status: "paused" }), c("x", { status: "closed", endDate: "2027-02-05" }), c("b", { status: "confirmed", startDate: null }), c("u", { pausedWeeks: ["2027-W05"] }),
      c("s", { startDate: "2027-02-02" }), c("e", { endDate: "2027-01-29" }), c("c1"),
    ];
    expect(ids({ activities: acts, cases })).toEqual(["ok"]);
  });

  it("hoppar över helgdagar (tabellen holidays)", () => {
    const acts = [a("helg", "c1", "2027-01-06T09:00"), a("vardag", "c1", "2027-01-07T09:00")];
    expect(ids({ activities: acts, now: "2027-01-07T18:30", holidays: new Set(["2027-01-06"]) })).toEqual(["vardag"]);
  });

  it("aldrig en vecka vars veckorapport till handläggaren redan skickats – andra handläggares veckor påverkas inte", () => {
    const acts = [a("maria-v4", "c1", "2027-01-27T09:00"), a("linda-v4", "c2", "2027-01-27T09:00"), a("maria-v5", "c1", `${MON}T09:00`)];
    const cases = [c("c1"), c("c2", { referrerId: "k-linda" })];
    expect(ids({ activities: acts, cases, sentWeeks: new Set([sentWeekKey("c-bot", "k-maria", "2027-W04")]) })).toEqual(["linda-v4", "maria-v5"]);
    // Ett ärende utan handläggarkonto (mejlavrop) har ingen veckorapport som stoppar.
    expect(ids({ activities: [a("utan", "c3", "2027-01-27T09:00")], cases: [c("c3", { referrerId: null })], sentWeeks: new Set([sentWeekKey("c-bot", "k-maria", "2027-W04")]) })).toEqual(["utan"]);
  });

  it("tar igen innevarande och föregående vecka – inte äldre", () => {
    expect(autoAttendanceFrom(`${MON}T18:05`)).toBe("2027-01-25");
    expect(autoAttendanceFrom("2027-02-07T18:05")).toBe("2027-01-25");
    const acts = [a("v3", "c1", "2027-01-22T09:00"), a("v4-man", "c1", "2027-01-25T09:00"), a("v4-fre", "c1", "2027-01-29T09:00"), a("v5", "c1", `${MON}T09:00`)];
    expect(ids({ activities: acts })).toEqual(["v4-man", "v4-fre", "v5"]);
  });

  it("golvet: dagar som slutade senast vid golvet räknas inte (nyinläst testdata)", () => {
    const acts = [a("fore", "c1", "2027-01-29T09:00"), a("idag", "c1", `${MON}T09:00`)];
    expect(ids({ activities: acts, floor: `${MON}T09:12` })).toEqual(["idag"]);
    expect(ids({ activities: acts, floor: `${MON}T18:00` })).toEqual([]);
    expect(ids({ activities: acts, floor: null })).toEqual(["fore", "idag"]);
  });

  it("samma indata ger samma svar i tidsordning (idempotent – en registrerad rad räknas inte igen)", () => {
    const acts = [a("b", "c1", `${MON}T13:00`), a("a", "c1", `${MON}T09:00`), a("c", "c1", `${MON}T09:00`)];
    const first = ids({ activities: acts });
    expect(first).toEqual(["a", "c", "b"]);
    expect(ids({ activities: acts })).toEqual(first);
    expect(ids({ activities: acts, registered: new Set(first) })).toEqual([]);
  });
});

describe("nextDayEnd", () => {
  it("samma dag om klockslaget inte passerat, annars nästa dag", () => {
    expect(nextDayEnd("2027-02-01T09:12", "18:00")).toBe("2027-02-01T18:00");
    expect(nextDayEnd("2027-02-01T18:00", "18:00")).toBe("2027-02-02T18:00");
    expect(nextDayEnd("2027-02-01T23:59", "18:00")).toBe("2027-02-02T18:00");
  });
});
