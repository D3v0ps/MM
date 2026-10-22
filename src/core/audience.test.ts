// Målgruppen (Karims beslut 2026-10-22): vem som hör till en nivå eller ett yrkesområde en viss dag, och vad den automatiska
// synkningen gör – lägger till och tar bort, rör aldrig manuellt inbjudna eller rader med närvaro, och hoppar över krockar.
import { describe, expect, it } from "vitest";
import { areaLabel, audienceColumns, audienceLabel, audienceMembersOn, audienceOf, belongsOn, planAudienceSync, type Audience, type AudienceCase, type AudienceRow } from "./audience";

const DAY = "2027-02-09";
const at = `${DAY}T13:30`;
const c = (n: number, o: Partial<AudienceCase> = {}): AudienceCase => ({
  id: `case-${n}`, caseNumber: `BOT-27-00${10 + n}`, status: "active", startDate: "2027-01-04", endDate: null, pausedWeeks: [], primaryAreaCode: "G", ...o,
});
const LEVEL_2: Audience = { kind: "level", levelId: "niva-2" };
const AREA_G: Audience = { kind: "area", areaCode: "G" };
const levelOf = new Map([["case-1", "niva-2"], ["case-2", "niva-2"], ["case-3", "niva-3"], ["case-4", "niva-2"], ["case-5", "niva-2"], ["case-6", "niva-2"]]);
const CASES = [
  c(1), c(2, { primaryAreaCode: "F" }), c(3), c(4, { status: "closed", endDate: "2027-02-05" }), c(5, { status: "paused" }), c(6, { startDate: "2027-02-15" }),
];
const row = (caseId: string, inviteSource: AudienceRow["inviteSource"], registered = false): AudienceRow => ({ id: `a-${caseId}`, caseId, inviteSource, registered });
const activity = (audience: Audience) => ({ id: "ga-1", startsAt: at, durationMin: 90, audience });

describe("vem hör till målgruppen en viss dag", () => {
  it("nivå: deltagarens aktiva nivå; yrkesområde: ärendets yrkesområde – och bara pågående insatser den dagen", () => {
    expect(audienceMembersOn(LEVEL_2, CASES, levelOf, DAY).map((x) => x.id)).toEqual(["case-1", "case-2"]);
    expect(audienceMembersOn(AREA_G, CASES, levelOf, DAY).map((x) => x.id)).toEqual(["case-1", "case-3"]);
    // Avslutad, pausad och inte startad hör inte till målgruppen den dagen.
    expect(["case-4", "case-5", "case-6"].map((id) => belongsOn(LEVEL_2, CASES.find((x) => x.id === id)!, levelOf, DAY))).toEqual([false, false, false]);
    expect(belongsOn(LEVEL_2, CASES.find((x) => x.id === "case-6")!, levelOf, "2027-02-16")).toBe(true);
    // Uppehållsveckan räknas inte.
    expect(belongsOn(AREA_G, c(1, { pausedWeeks: ["2027-W06"] }), levelOf, DAY)).toBe(false);
  });
  it("kolumnerna och texterna", () => {
    expect(audienceColumns(LEVEL_2)).toEqual({ audience: "level", audienceLevelId: "niva-2", audienceAreaCode: null });
    expect(audienceColumns(AREA_G)).toEqual({ audience: "area", audienceLevelId: null, audienceAreaCode: "G" });
    expect(audienceColumns(null)).toEqual({ audience: "manual", audienceLevelId: null, audienceAreaCode: null });
    expect(audienceOf(audienceColumns(AREA_G))).toEqual(AREA_G);
    expect(audienceOf(audienceColumns(null))).toBeNull();
    expect(areaLabel("G", "Lager och logistik")).toBe("G – Lager och logistik");
    expect(audienceLabel(AREA_G, { area: "Lager och logistik" })).toBe("Yrkesområde G – Lager och logistik");
    expect(audienceLabel(LEVEL_2, { level: "Nivå 2 – Behöver stöd för att komma igång" })).toBe("Nivå 2 – Behöver stöd för att komma igång");
  });
});

describe("planAudienceSync – den automatiska inbjudan", () => {
  it("lägger till de som hör till målgruppen och saknar en rad, i ärendenummerordning", () => {
    expect(planAudienceSync({ activity: activity(LEVEL_2), cases: CASES, levelOf, rows: [], others: [] })).toEqual({ add: ["case-1", "case-2"], remove: [], skipped: [] });
  });
  it("tar bort rader som målgruppen bjöd in när deltagaren inte längre hör till (ny nivå, avslutad, pausad) – men aldrig med närvaro", () => {
    const rows = [row("case-1", "audience"), row("case-3", "audience"), row("case-4", "audience"), row("case-5", "audience", true)];
    const p = planAudienceSync({ activity: activity(LEVEL_2), cases: CASES, levelOf, rows, others: [] });
    expect(p.remove.map((r) => r.caseId)).toEqual(["case-3", "case-4"]);
    expect(p.add).toEqual(["case-2"]);
  });
  it("manuellt inbjudna rörs aldrig – inte heller när de inte hör till målgruppen", () => {
    const rows = [row("case-3", "manual"), row("case-1", "manual")];
    const p = planAudienceSync({ activity: activity(LEVEL_2), cases: CASES, levelOf, rows, others: [] });
    expect(p).toEqual({ add: ["case-2"], remove: [], skipped: [] });
  });
  it("den som har ett annat tillfälle vid samma tid hoppas över – aktivitetens egna rader räknas inte som krock", () => {
    const others = [
      { caseId: "case-1", startsAt: `${DAY}T13:00`, durationMin: 60, groupActivityId: null },
      { caseId: "case-2", startsAt: `${DAY}T15:00`, durationMin: 60, groupActivityId: null },
      { caseId: "case-2", startsAt: at, durationMin: 90, groupActivityId: "ga-1" },
    ];
    expect(planAudienceSync({ activity: activity(LEVEL_2), cases: CASES, levelOf, rows: [], others })).toEqual({ add: ["case-2"], remove: [], skipped: [{ caseId: "case-1", reason: "overlap" }] });
  });
  it("scope: bara de angivna ärendena prövas (efter att ett ärende bytt nivå eller yrkesområde)", () => {
    const rows = [row("case-3", "audience")];
    expect(planAudienceSync({ activity: activity(LEVEL_2), cases: CASES, levelOf, rows, others: [], scope: new Set(["case-2"]) })).toEqual({ add: ["case-2"], remove: [], skipped: [] });
    expect(planAudienceSync({ activity: activity(LEVEL_2), cases: CASES, levelOf, rows, others: [], scope: new Set(["case-3"]) }).remove.map((r) => r.caseId)).toEqual(["case-3"]);
  });
  it("idempotent: med planen genomförd finns inget kvar att göra", () => {
    const first = planAudienceSync({ activity: activity(AREA_G), cases: CASES, levelOf, rows: [row("case-2", "audience")], others: [] });
    const after = [...first.add.map((id) => row(id, "audience"))];
    expect(planAudienceSync({ activity: activity(AREA_G), cases: CASES, levelOf, rows: after, others: [] })).toEqual({ add: [], remove: [], skipped: [] });
  });
});
