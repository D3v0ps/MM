// Delmål för progressionerna (Karims beslut 2026-11-11): Tränar automatiskt vid närvaro (idempotent, aldrig över Uppnått), punkterna
// i steg 1–2 med trösklar ur avtalet, taggarnas kontroll och startlistan. Ren logik – påhittade ärenden och Botkyrkas konfiguration.
import { describe, expect, it } from "vitest";
import type { CaseProgressGoal, GroupActivity } from "@/data/schema";
import { STEP_ITEMS } from "@/data/schema";
import { BOTKYRKA_CONFIG, bonusModel } from "./config";
import {
  caseGoalId, DEFAULT_PROGRESS_GOALS, defaultGoalId, defaultProgressGoals, goalLabelProblem, goalStateText, goalTagsProblem, sortGoals, step1ItemsMet, step2ReachedOn, stepItemMin,
  stepItemStatuses, trainingRowsToAdd,
} from "./progress-goals";
import { mkActivity, mkAttendance } from "./test-data";

const M = bonusModel(BOTKYRKA_CONFIG)!;
const GOALS = defaultProgressGoals("c-bot", "2026-11-11T18:00");
const G = (n: number) => defaultGoalId("c-bot", n);
const row = (caseId: string, n: number, status: CaseProgressGoal["status"], on: string | null = null, source: CaseProgressGoal["source"] = "manual"): CaseProgressGoal => ({
  id: caseGoalId(caseId, G(n)), caseId, contractId: "c-bot", goalId: G(n), status, source, achievedOn: status === "achieved" ? on : null, evidenceKind: null, evidenceId: null,
  setBy: source === "auto" ? "system" : "u-amira", setAt: "2027-01-10T10:00",
});

describe("startlistan (Karims godkännande 2026-11-11)", () => {
  it("25 delmål i nio områden – Övrig relevant progression har inga än; alla områden finns i avtalet och alla punkter är kända", () => {
    expect(DEFAULT_PROGRESS_GOALS).toHaveLength(25);
    const areas = new Set(DEFAULT_PROGRESS_GOALS.map((g) => g.areaKey));
    expect(areas.size).toBe(9);
    expect(areas.has("ovrigt")).toBe(false);
    for (const g of DEFAULT_PROGRESS_GOALS) {
      expect(BOTKYRKA_CONFIG.progression!.areas).toContain(g.areaKey);
      for (const it of g.stepItems) expect(STEP_ITEMS).toContain(it);
    }
    // Id:t säger aldrig något om delmålet – bara avtalet och numret.
    expect(GOALS.map((g) => g.id)).toEqual(DEFAULT_PROGRESS_GOALS.map((g) => `pg-c-bot-${String(g.n).padStart(2, "0")}`));
    expect(GOALS.filter((g) => g.areaKey === "digital_sjalvstandighet").map((g) => [g.label, g.sortOrder])).toEqual([
      ["Kan starta och logga in på en dator", 10], ["Loggar in på sin e-post via dator", 20], ["Söker jobb via datorn (Platsbanken eller annan sajt)", 30],
      ["Skickar en ansökan med bifogat CV", 40],
    ]);
  });
  it("punkterna enligt listan: individuell plan två delmål, ansökningshandlingar fyra, steg 2 alla sex punkter", () => {
    const by = (item: string) => DEFAULT_PROGRESS_GOALS.filter((g) => (g.stepItems as string[]).includes(item)).map((g) => g.n);
    expect(by("individuell_plan")).toEqual([3, 10]);
    expect(by("ansokningshandlingar")).toEqual([13, 14, 20, 21]);
    expect(by("branschintroduktion")).toEqual([4]);
    expect(by("arbetsgivarnara")).toEqual([17]);
    expect(["praktik", "validering", "branschintyg", "arbetsintervju", "jobbspar", "utbildning"].map(by)).toEqual([[22], [6], [6], [19], [23], [23]]);
  });
});

describe("Tränar automatiskt vid närvaro", () => {
  const own = mkActivity({ id: "a1", caseId: "c1", startsAt: "2027-01-20T09:00", progressGoalIds: [G(5)] });
  const grp = mkActivity({ id: "a2", caseId: "c1", startsAt: "2027-01-21T13:00", groupActivityId: "ga1" });
  const ga = { id: "ga1", progressGoalIds: [G(20), G(13)], cancelledAt: null } as Pick<GroupActivity, "id" | "progressGoalIds" | "cancelledAt">;
  const contractOfCase = new Map([["c1", "c-bot"]]);
  const run = (status: "present" | "late" | "absent_invalid", existing: CaseProgressGoal[] = [], goals = GOALS) =>
    trainingRowsToAdd({
      activities: [own, grp], groupActivities: [ga], attendance: [mkAttendance({ activityId: "a1", caseId: "c1", status }), mkAttendance({ activityId: "a2", caseId: "c1", status })],
      goals, existing, contractOfCase,
    });
  it("närvarande och sen ger Tränar för tillfällets och gruppaktivitetens delmål – frånvaro aldrig", () => {
    expect(run("present").map((r) => [r.goalId, r.activityId])).toEqual([[G(5), "a1"], [G(20), "a2"], [G(13), "a2"]]);
    expect(run("late")).toHaveLength(3);
    expect(run("absent_invalid")).toEqual([]);
  });
  it("idempotent och aldrig över Uppnått: ett delmål som redan tränas eller är uppnått rörs inte", () => {
    const first = run("present");
    const again = run("present", first.map((r) => ({ ...row("c1", 0, "training"), goalId: r.goalId })));
    expect(again).toEqual([]);
    expect(run("present", [row("c1", 5, "achieved", "2027-01-15")]).map((r) => r.goalId)).toEqual([G(20), G(13)]);
  });
  it("bara aktiva delmål i ärendets avtal", () => {
    const goals = GOALS.map((g) => (g.id === G(5) ? { ...g, active: false } : g.id === G(20) ? { ...g, contractId: "c-annat" } : g));
    expect(run("present", [], goals).map((r) => r.goalId)).toEqual([G(13)]);
  });
  it("ett delmål på två tillfällen ger en rad – det tidigaste tillfället blir underlaget", () => {
    const later = mkActivity({ id: "a3", caseId: "c1", startsAt: "2027-01-27T09:00", progressGoalIds: [G(5)] });
    const rows = trainingRowsToAdd({
      activities: [later, own], groupActivities: [], attendance: [mkAttendance({ activityId: "a3", caseId: "c1", status: "present" }), mkAttendance({ activityId: "a1", caseId: "c1", status: "present" })],
      goals: GOALS, existing: [], contractOfCase,
    });
    expect(rows.map((r) => [r.goalId, r.activityId, r.day])).toEqual([[G(5), "a1", "2027-01-20"]]);
  });
});

describe("punkterna i steg 1–2 ur de uppnådda delmålen", () => {
  it("tröskeln ur avtalet: ansökningshandlingar kräver två i Botkyrka, övriga ett", () => {
    expect(stepItemMin(M, "ansokningshandlingar")).toBe(2);
    expect(stepItemMin(M, "individuell_plan")).toBe(1);
    expect(stepItemMin(null, "ansokningshandlingar")).toBe(1);
  });
  it("en punkt är uppfylld när minst N av dess delmål är uppnådda – dagen det N:te uppnåddes; tränar räknas inte", () => {
    const rows = [row("c1", 20, "achieved", "2027-01-12"), row("c1", 13, "training"), row("c1", 3, "achieved", "2027-01-05")];
    const s1 = stepItemStatuses(1, GOALS, rows, M);
    expect(s1.map((x) => [x.item, x.fulfilled, x.goals.length, x.need, x.fulfilledOn])).toEqual([
      ["individuell_plan", true, 1, 1, "2027-01-05"], ["ansokningshandlingar", false, 1, 2, null], ["branschintroduktion", false, 0, 1, null], ["arbetsgivarnara", false, 0, 1, null],
    ]);
    expect(step1ItemsMet(s1)).toBe(false);
    const more = [...rows, row("c1", 14, "achieved", "2027-01-20"), row("c1", 4, "achieved", "2027-01-08"), row("c1", 17, "achieved", "2027-01-09")];
    const s1b = stepItemStatuses(1, GOALS, more, M);
    expect(s1b.find((x) => x.item === "ansokningshandlingar")).toMatchObject({ fulfilled: true, fulfilledOn: "2027-01-20", goals: [{ id: G(20) }, { id: G(14) }] });
    expect(step1ItemsMet(s1b)).toBe(true);
  });
  it("steg 2: den tidigaste dagen då någon punkt blev uppfylld; ett delmål kan uppfylla två punkter", () => {
    const s2 = stepItemStatuses(2, GOALS, [row("c1", 6, "achieved", "2027-01-15"), row("c1", 19, "achieved", "2027-01-11")], M);
    expect(s2.filter((x) => x.fulfilled).map((x) => x.item)).toEqual(["validering", "branschintyg", "arbetsintervju"]);
    expect(step2ReachedOn(s2)).toBe("2027-01-11");
    expect(step2ReachedOn(stepItemStatuses(2, GOALS, [], M))).toBeNull();
  });
  it("ett uppnått delmål i ett annat avtal räknas inte; ett inaktiverat som uppnåddes räknas", () => {
    const goals = GOALS.map((g) => (g.id === G(3) ? { ...g, active: false } : g));
    expect(stepItemStatuses(1, goals, [row("c1", 3, "achieved", "2027-01-05")], M)[0].fulfilled).toBe(true);
    expect(stepItemStatuses(1, GOALS, [{ ...row("c1", 3, "achieved", "2027-01-05"), contractId: "c-annat" }], M)[0].fulfilled).toBe(false);
  });
});

describe("läget, namnen och taggarna", () => {
  it("läget som text: Inte påbörjat, Tränar (automatiskt), Tränar, Uppnått med datum", () => {
    expect(goalStateText(null)).toBe("Inte påbörjat");
    expect(goalStateText(row("c1", 1, "training", null, "auto"))).toBe("Tränar (automatiskt)");
    expect(goalStateText(row("c1", 1, "training"))).toBe("Tränar");
    expect(goalStateText(row("c1", 1, "achieved", "2027-01-12"))).toMatch(/^Uppnått 12 jan/);
  });
  it("namnet: 1–120 tecken", () => {
    expect(goalLabelProblem("  ")).toBe("Skriv delmålet.");
    expect(goalLabelProblem("x".repeat(121))).toMatch(/högst 120/);
    expect(goalLabelProblem("Har ett körkort")).toBeNull();
  });
  it("taggarna: i avtalet, inga dubbletter, de som läggs till är aktiva – ett inaktiverat som redan stod får ligga kvar", () => {
    const goals = GOALS.map((g) => (g.id === G(2) ? { ...g, active: false } : g));
    expect(goalTagsProblem([G(1), G(3)], [], goals, "c-bot", 20)).toBeNull();
    expect(goalTagsProblem([G(1), G(1)], [], goals, "c-bot", 20)).toMatch(/två gånger/);
    expect(goalTagsProblem([G(1)], [], goals, "c-annat", 20)).toMatch(/finns inte i avtalet/);
    expect(goalTagsProblem(["pg-okand"], [], goals, "c-bot", 20)).toMatch(/finns inte i avtalet/);
    expect(goalTagsProblem([G(2)], [], goals, "c-bot", 20)).toMatch(/inaktiverat/);
    expect(goalTagsProblem([G(2), G(1)], [G(2)], goals, "c-bot", 20)).toBeNull();
    expect(goalTagsProblem([G(1), G(3), G(4)], [], goals, "c-bot", 2)).toMatch(/högst 2/);
  });
  it("katalogen i ordning: områdets ordning, sedan sortOrder", () => {
    const sorted = sortGoals([...GOALS].reverse(), BOTKYRKA_CONFIG.progression!.areas);
    expect(sorted.map((g) => g.id)).toEqual(GOALS.map((g) => g.id));
  });
});
