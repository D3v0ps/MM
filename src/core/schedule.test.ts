// Veckoplanen och tillfällena (beslut 2026-10-08): standardplanen ur avtalet, tillfällen utan helgdagar och dubbletter,
// taket på 60 veckor, pausade veckor och praktikdagar.
import { describe, expect, it } from "vitest";
import { BOTKYRKA_CONFIG } from "./config";
import { holidayName } from "./holidays";
import { defaultWeekPlan, MAX_PLAN_WEEKS, normalizePlan, placementDays, planActivities, planFromActivities, type WeekPlanRow } from "./schedule";
import { addDays, dayOf, isWorkingDay, weekday } from "./time";

const PLAN: WeekPlanRow[] = [
  { weekday: 0, kind: "möte", time: "09:00", durationMin: 60, location: "Miljonbemanning" },
  { weekday: 1, kind: "yrkesmoment", time: "09:00", durationMin: 180, location: "Miljonbemanning" },
  { weekday: 3, kind: "yrkesmoment", time: "09:00", durationMin: 180, location: "Miljonbemanning" },
];

describe("defaultWeekPlan – avtalets standard med första mötets dag och tid", () => {
  it("Botkyrka: coachträff på första mötets dag och tid, yrkesmoment tisdag och torsdag", () => {
    expect(defaultWeekPlan(BOTKYRKA_CONFIG, "2027-02-01T09:00")).toEqual(PLAN);
    expect(defaultWeekPlan(BOTKYRKA_CONFIG, "2027-02-03T13:30")).toEqual([
      { weekday: 1, kind: "yrkesmoment", time: "09:00", durationMin: 180, location: "Miljonbemanning" },
      { weekday: 2, kind: "möte", time: "13:30", durationMin: 60, location: "Miljonbemanning" },
      { weekday: 3, kind: "yrkesmoment", time: "09:00", durationMin: 180, location: "Miljonbemanning" },
    ]);
  });
  it("krockar första mötet med en fast dag flyttas yrkesmomentet till nästa lediga vardag – en rad per veckodag", () => {
    const plan = defaultWeekPlan(BOTKYRKA_CONFIG, "2027-02-02T10:00"); // tisdag
    expect(plan.map((r) => [r.weekday, r.kind])).toEqual([[1, "möte"], [2, "yrkesmoment"], [3, "yrkesmoment"]]);
    expect(new Set(plan.map((r) => r.weekday)).size).toBe(plan.length);
  });
  it("utan avsnittet i avtalet, eller utan första möte: bara coachträffen", () => {
    expect(defaultWeekPlan({}, "2027-02-04T11:00")).toEqual([{ weekday: 3, kind: "möte", time: "11:00", durationMin: 60, location: "Miljonbemanning" }]);
    expect(defaultWeekPlan(BOTKYRKA_CONFIG, null).map((r) => [r.weekday, r.kind, r.time])).toEqual([[0, "möte", "10:00"], [1, "yrkesmoment", "09:00"], [3, "yrkesmoment", "09:00"]]);
  });
});

describe("planActivities – tillfällen från start till planerat slut", () => {
  const from = "2027-02-01";
  const to = "2027-07-30"; // sex månader
  const rows = planActivities(PLAN, from, to);
  it("sex månader: tre tillfällen per vecka utom helgdagar, inga dubbletter, allt på arbetsdagar i perioden", () => {
    // 26 veckor × 3 = 78, minus helgdagarna annandag påsk (mån 29 mars) och Kristi himmelsfärdsdag (tor 6 maj) 2027.
    expect(holidayName("2027-03-29")).toBe("Annandag påsk");
    expect(holidayName("2027-05-06")).toBe("Kristi himmelsfärdsdag");
    expect(rows).toHaveLength(78 - 2);
    expect(rows.some((r) => dayOf(r.startsAt) === "2027-03-29" || dayOf(r.startsAt) === "2027-05-06")).toBe(false);
    expect(new Set(rows.map((r) => r.startsAt)).size).toBe(rows.length);
    expect(rows.every((r) => isWorkingDay(r.startsAt) && dayOf(r.startsAt) >= from && dayOf(r.startsAt) <= to)).toBe(true);
    expect(rows[0]).toEqual({ kind: "möte", startsAt: "2027-02-01T09:00", durationMin: 60, location: "Miljonbemanning" });
    expect(rows.map((r) => r.startsAt)).toEqual([...rows.map((r) => r.startsAt)].sort());
  });
  it("startar mitt i veckan: inga tillfällen före startdatumet", () => {
    const r = planActivities(PLAN, "2027-02-03", "2027-02-12");
    expect(r.map((x) => x.startsAt)).toEqual(["2027-02-04T09:00", "2027-02-08T09:00", "2027-02-09T09:00", "2027-02-11T09:00"]);
  });
  it("pausade veckor och tidpunkter före notBefore hoppas över", () => {
    const r = planActivities(PLAN, "2027-02-01", "2027-02-14", { pausedWeeks: ["2027-W06"], notBefore: "2027-02-01T12:00" });
    expect(r.map((x) => x.startsAt)).toEqual(["2027-02-02T09:00", "2027-02-04T09:00"]);
  });
  it("högst 60 veckor från startveckan", () => {
    const r = planActivities(PLAN, "2027-02-01", "2030-01-01");
    const last = addDays("2027-02-01", MAX_PLAN_WEEKS * 7 - 1);
    expect(r.every((x) => dayOf(x.startsAt) <= last)).toBe(true);
    expect(r.filter((x) => x.kind === "möte").length).toBeLessThanOrEqual(MAX_PLAN_WEEKS);
    expect(r.filter((x) => x.kind === "möte").length).toBeGreaterThan(55);
  });
  it("tom plan eller omvänd period ger inga tillfällen", () => {
    expect(planActivities([], from, to)).toEqual([]);
    expect(planActivities(PLAN, to, from)).toEqual([]);
  });
});

describe("normalizePlan och planFromActivities", () => {
  it("sorterar på dag och tid och tar bort dubbletter", () => {
    const rows = normalizePlan([PLAN[2], PLAN[0], { ...PLAN[0] }, { ...PLAN[1], weekday: 7 }]);
    expect(rows).toEqual([PLAN[0], PLAN[2]]);
  });
  it("läser av den gällande planen ur nästa veckas tillfällen", () => {
    const acts = planActivities(PLAN, "2027-01-11", "2027-03-05");
    expect(planFromActivities(acts, "2027-02-08")).toEqual(PLAN);
    expect(planFromActivities([], "2027-02-08")).toEqual([]);
    // Tillfällen av andra slag (arbetsgivarbesök, annat) ingår inte i veckoplanen.
    expect(planFromActivities([{ kind: "annat", startsAt: "2027-02-08T10:00", durationMin: 30, location: "x" }], "2027-02-08")).toEqual([]);
  });
});

describe("placementDays – praktikdagar", () => {
  it("valda veckodagar i perioden utan helgdagar", () => {
    const days = placementDays("2027-03-22", "2027-04-09", [0, 2, 4]);
    expect(days).toEqual(["2027-03-22", "2027-03-24", "2027-03-31", "2027-04-02", "2027-04-05", "2027-04-07", "2027-04-09"]);
    expect(days.includes("2027-03-26")).toBe(false); // långfredagen
    expect(days.includes("2027-03-29")).toBe(false); // annandag påsk
    expect(days.every((d) => [0, 2, 4].includes(weekday(d)))).toBe(true);
  });
  it("inga dagar utan veckodagar, vid omvänd period eller i pausade veckor", () => {
    expect(placementDays("2027-03-22", "2027-04-09", [])).toEqual([]);
    expect(placementDays("2027-04-09", "2027-03-22", [0])).toEqual([]);
    expect(placementDays("2027-03-22", "2027-04-09", [0], ["2027-W12"])).toEqual(["2027-04-05"]);
  });
});
