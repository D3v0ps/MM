// Rapportutkast som skapas automatiskt: vecko- och månadstillhörighet, årsskiftet, uppehåll, avslutade ärenden,
// sista dagar från avtalskonfigurationen, fönstret (since) och nycklarna som de unika indexen speglar.
import { describe, expect, it } from "vitest";
import { BOTKYRKA_CONFIG, KK_CONFIG, type ContractConfig } from "./config";
import {
  enrolledBetween, enrolledDays, LOOKBACK_DAYS, missingReports, nextScheduleBoundary, plannedReports, reportKey, scheduleFrom, type ScheduleCase, type ScheduleInput,
} from "./report-schedule";

const C = (id: string, startDate: string | null, endDate: string | null = null, extra: Partial<ScheduleCase> = {}): ScheduleCase => ({
  id, status: endDate ? "closed" : "active", referrerId: "k-maria", startDate, endDate, closedAt: endDate ? `${endDate}T15:00` : null, ...extra,
});
const input = (patch: Partial<ScheduleInput> = {}, config: ContractConfig = BOTKYRKA_CONFIG): ScheduleInput => ({
  contract: { id: "c-bot", startsOn: "2026-09-10", endsOn: null, config },
  cases: [],
  caseworkerIds: ["k-maria", "k-omar"],
  managerIds: ["k-eva"],
  existing: [],
  since: null,
  now: "2027-02-01T09:12",
  ...patch,
});
const keys = (rs: ReturnType<typeof plannedReports>) => rs.map((r) => `${r.kind}:${r.recipientUserId ?? r.caseId}:${r.week ?? r.month}`);

describe("vilka perioder ett ärende är inskrivet", () => {
  it("startdatum passerat och slutdatum inte passerat – mitt i en månad räcker en dag", () => {
    const c = C("a", "2027-01-29");
    expect(enrolledBetween(c, "2027-01-01", "2027-01-31")).toBe(true);
    expect(enrolledBetween(c, "2026-12-01", "2026-12-31")).toBe(false);
    const closed = C("b", "2026-10-05", "2026-11-03");
    expect(enrolledBetween(closed, "2026-11-01", "2026-11-30")).toBe(true);
    expect(enrolledBetween(closed, "2026-12-01", "2026-12-31")).toBe(false);
  });
  it("avböjda och obekräftade ärenden räknas inte, inte heller utan startdatum", () => {
    expect(enrolledBetween(C("a", "2027-01-04", null, { status: "declined" }), "2027-01-01", "2027-01-31")).toBe(false);
    expect(enrolledBetween(C("a", "2027-01-04", null, { status: "acknowledged" }), "2027-01-01", "2027-01-31")).toBe(false);
    expect(enrolledBetween(C("a", null), "2027-01-01", "2027-01-31")).toBe(false);
    // Bekräftat med passerat startdatum räknas (samma regel som veckorapporten och faktureringen).
    expect(enrolledBetween(C("a", "2027-01-04", null, { status: "confirmed" }), "2027-01-01", "2027-01-31")).toBe(true);
  });
});

describe("månadsrapport per ärende och månad", () => {
  const monthly = (cases: ScheduleCase[], now = "2027-02-01T09:12") => keys(plannedReports(input({ cases, now })).filter((r) => r.kind === "monthly"));
  it("minst 11 inskrivna dagar i månaden (reportSchedule.monthly.minEnrolledDays) – start- och slutdatum räknas med", () => {
    expect(BOTKYRKA_CONFIG.reportSchedule?.monthly?.minEnrolledDays).toBe(11);
    expect(enrolledDays(C("a", "2027-01-21"), "2027-01-01", "2027-01-31")).toBe(11);
    expect(enrolledDays(C("a", "2027-01-22"), "2027-01-01", "2027-01-31")).toBe(10);
    expect(enrolledDays(C("a", "2026-12-01", "2027-01-11"), "2027-01-01", "2027-01-31")).toBe(11);
    expect(enrolledDays(C("a", "2026-12-01", "2027-01-10"), "2027-01-01", "2027-01-31")).toBe(10);
    expect(enrolledDays(C("a", "2027-01-10", "2027-01-20"), "2027-01-01", "2027-01-31")).toBe(11);
    expect(enrolledDays(C("a", "2027-02-02"), "2027-01-01", "2027-01-31")).toBe(0);
  });
  it("start mitt i månaden: 11 dagar ger en rapport, 10 dagar ingen", () => {
    expect(monthly([C("a", "2027-01-21")])).toEqual(["monthly:a:2027-01"]);
    expect(monthly([C("a", "2027-01-22")])).toEqual([]);
  });
  it("avslut mitt i månaden: 11 dagar ger en rapport, 10 dagar ingen", () => {
    expect(monthly([C("a", "2026-12-01", "2027-01-11")])).toEqual(["monthly:a:2026-12", "monthly:a:2027-01"]);
    expect(monthly([C("a", "2026-12-01", "2027-01-10")])).toEqual(["monthly:a:2026-12"]);
  });
  it("start och avslut i samma månad: dagarna däremellan räknas", () => {
    expect(monthly([C("a", "2027-01-10", "2027-01-20")])).toEqual(["monthly:a:2027-01"]);
    expect(monthly([C("a", "2027-01-10", "2027-01-19")])).toEqual([]);
  });
  it("ärende som börjar och slutar mitt i månaden över flera månader: bara månaderna med minst 11 dagar", () => {
    // November 4 dagar, december hela, januari 5 dagar.
    expect(monthly([C("a", "2026-11-27", "2027-01-05")])).toEqual(["monthly:a:2026-12"]);
    // Med minEnrolledDays 1 räcker en dag (avtalet styr).
    const oneDay = { ...BOTKYRKA_CONFIG, reportSchedule: { ...BOTKYRKA_CONFIG.reportSchedule!, monthly: { minEnrolledDays: 1 } } };
    expect(keys(plannedReports(input({ cases: [C("a", "2026-11-27", "2027-01-05")] }, oneDay)).filter((r) => r.kind === "monthly"))).toEqual([
      "monthly:a:2026-11", "monthly:a:2026-12", "monthly:a:2027-01",
    ]);
  });
  it("avslutat ärende utan slutdatum: avslutsdagen räknas som slutdatum", () => {
    const c = C("a", "2026-12-01", null, { status: "closed", closedAt: "2027-01-08T15:00" });
    expect(enrolledDays(c, "2027-01-01", "2027-01-31")).toBe(8);
    expect(monthly([c])).toEqual(["monthly:a:2026-12"]);
  });
  it("fälten är exakt som testdatats: period, sista dag (5:e arbetsdagen kl. 23.59), preliminär, utkast, inga mottagare", () => {
    const [jan] = plannedReports(input({ cases: [C("a", "2027-01-04")], since: "2027-01-31T00:00" })).filter((r) => r.kind === "monthly");
    expect(jan).toMatchObject({
      contractId: "c-bot", kind: "monthly", caseId: "a", month: "2027-01", periodStart: "2027-01-01", periodEnd: "2027-01-31", status: "draft", version: 1,
      dueAt: "2027-02-05T23:59", provisionalDue: true, recipientUserId: null, week: null, deliveredTo: [], approvedBy: null, previousId: null, snapshot: null,
    });
  });
  it("godkänd månadsbedömning: rapporten blir granskad av coachen", () => {
    const rs = plannedReports(input({ cases: [C("a", "2027-01-04")], approvedAssessments: new Set(["a:2027-01"]), since: "2027-01-31T00:00" }));
    expect(rs.find((r) => r.kind === "monthly")?.status).toBe("reviewed");
  });
  it("skapas först när månaden är slut – inte för innevarande månad", () => {
    const rs = plannedReports(input({ cases: [C("a", "2027-01-04")], now: "2027-01-31T23:59" }));
    expect(rs.filter((r) => r.kind === "monthly" && r.month === "2027-01")).toEqual([]);
    expect(plannedReports(input({ cases: [C("a", "2027-01-04")], now: "2027-02-01T00:00" })).some((r) => r.kind === "monthly" && r.month === "2027-01")).toBe(true);
  });
  it("avslutat ärende: inga rapporter efter slutdatum", () => {
    const rs = plannedReports(input({ cases: [C("a", "2026-10-01", "2026-10-31")], now: "2027-03-01T00:00" }));
    expect(keys(rs.filter((r) => r.kind === "monthly"))).toEqual(["monthly:a:2026-10"]);
  });
  it("uppehåll: ärendet är fortfarande inskrivet – rapporten skapas och visar uppehållet", () => {
    const rs = plannedReports(input({ cases: [C("a", "2027-01-04", null, { status: "paused" })], since: "2027-01-31T00:00" }));
    expect(keys(rs.filter((r) => r.kind === "monthly"))).toEqual(["monthly:a:2027-01"]);
  });
});

describe("veckorapport per handläggare och ISO-vecka", () => {
  it("en rapport per handläggare med minst ett inskrivet ärende, sista dag måndag 16.00 veckan efter, väntar på närvaron", () => {
    const cases = [C("a", "2027-01-27"), C("b", "2027-01-20", null, { referrerId: "k-omar" }), C("c", "2027-02-02", null, { referrerId: "k-linda" })];
    const rs = plannedReports(input({ cases, since: "2027-01-31T00:00" })).filter((r) => r.kind === "weekly_attendance");
    // k-linda är inte handläggare i avtalet (bara de i caseworkerIds får veckorapporter), och hennes ärende startar vecka 5.
    expect(keys(rs)).toEqual(["weekly_attendance:k-maria:2027-W04", "weekly_attendance:k-omar:2027-W04"]);
    expect(rs[0]).toMatchObject({
      caseId: null, recipientUserId: "k-maria", week: "2027-W04", periodStart: "2027-01-25", periodEnd: "2027-01-31", status: "waiting", version: 1,
      dueAt: "2027-02-01T16:00", approvedBy: "system", approvedAt: null, provisionalDue: false, month: null,
    });
  });
  it("årsskiftet: 2026-W53 (28 december–3 januari) och 2027-W01", () => {
    const rs = plannedReports(input({ cases: [C("a", "2026-12-30", "2027-01-05")], now: "2027-01-12T00:00" })).filter((r) => r.kind === "weekly_attendance");
    expect(rs.map((r) => [r.week, r.periodStart, r.periodEnd, r.dueAt])).toEqual([
      ["2026-W53", "2026-12-28", "2027-01-03", "2027-01-04T16:00"],
      ["2027-W01", "2027-01-04", "2027-01-10", "2027-01-11T16:00"],
    ]);
    // Månaderna: december 2 dagar och januari 5 dagar – färre än 11, ingen månadsrapport. Med minEnrolledDays 1: båda.
    expect(plannedReports(input({ cases: [C("a", "2026-12-30", "2027-01-05")], now: "2027-02-01T00:00" })).filter((r) => r.kind === "monthly")).toEqual([]);
    const oneDay = { ...BOTKYRKA_CONFIG, reportSchedule: { ...BOTKYRKA_CONFIG.reportSchedule!, monthly: { minEnrolledDays: 1 } } };
    expect(keys(plannedReports(input({ cases: [C("a", "2026-12-30", "2027-01-05")], now: "2027-02-01T00:00" }, oneDay)).filter((r) => r.kind === "monthly"))).toEqual([
      "monthly:a:2026-12", "monthly:a:2027-01",
    ]);
  });
  it("uppehåll en vecka: veckorapporten skapas ändå (sektionen visar Uppehåll), avslutad vecka efter slutdatum skapas inte", () => {
    const rs = plannedReports(input({ cases: [C("a", "2027-01-04", "2027-01-13", { pausedWeeks: ["2027-W02"] } as Partial<ScheduleCase>)], now: "2027-01-25T00:00" }));
    expect(rs.filter((r) => r.kind === "weekly_attendance").map((r) => r.week)).toEqual(["2027-W01", "2027-W02"]);
  });
  it("veckan skapas först när den är slut (måndag 00.00)", () => {
    const cases = [C("a", "2027-01-25")];
    expect(plannedReports(input({ cases, now: "2027-01-31T23:59" })).filter((r) => r.kind === "weekly_attendance")).toEqual([]);
    expect(plannedReports(input({ cases, now: "2027-02-01T00:00" })).filter((r) => r.kind === "weekly_attendance").map((r) => r.week)).toEqual(["2027-W04"]);
  });
});

describe("beställarrapport per chef och månad", () => {
  it("sista dag från konfigurationen (8:e arbetsdagen kl. 16.00), utkast, mottagaren är kommunens chef", () => {
    const rs = plannedReports(input({ since: "2027-01-31T00:00" })).filter((r) => r.kind === "customer_summary");
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ recipientUserId: "k-eva", month: "2027-01", periodStart: "2027-01-01", periodEnd: "2027-01-31", status: "draft", dueAt: "2027-02-10T16:00", provisionalDue: false, caseId: null });
    const other = { ...BOTKYRKA_CONFIG, reportSchedule: { automatic: ["customer_summary" as const], customerSummaryDue: { nthWorkingDay: 3, time: "12:00" } } };
    expect(plannedReports(input({ since: "2027-01-31T00:00" }, other))[0].dueAt).toBe("2027-02-03T12:00");
  });
});

describe("avtalskonfigurationen styr", () => {
  it("bara rapporttyperna i reportSchedule.automatic – KK och avtal utan avsnittet får inga", () => {
    const cases = [C("a", "2027-01-04")];
    expect(plannedReports(input({ cases }, KK_CONFIG))).toEqual([]);
    const none = { ...BOTKYRKA_CONFIG } as ContractConfig;
    delete (none as { reportSchedule?: unknown }).reportSchedule;
    expect(plannedReports(input({ cases }, none))).toEqual([]);
    const onlyWeekly = { ...BOTKYRKA_CONFIG, reportSchedule: { automatic: ["weekly_attendance" as const] } };
    expect(new Set(plannedReports(input({ cases }, onlyWeekly)).map((r) => r.kind))).toEqual(new Set(["weekly_attendance"]));
  });
  it("veckorapportens sista dag följer SLA-regeln (veckodag och klockslag)", () => {
    const sla = BOTKYRKA_CONFIG.sla.map((s) => (s.key === "veckorapport_publicering" ? { ...s, weekday: 1, time: "12:00" } : s));
    const rs = plannedReports(input({ cases: [C("a", "2027-01-25")], since: "2027-01-31T00:00" }, { ...BOTKYRKA_CONFIG, sla }));
    expect(rs.find((r) => r.kind === "weekly_attendance")?.dueAt).toBe("2027-02-02T12:00");
  });
  it("avtalets slut: inga perioder som börjar efter slutdatumet", () => {
    const rs = plannedReports(input({ contract: { id: "c-bot", startsOn: "2026-09-10", endsOn: "2026-10-15", config: BOTKYRKA_CONFIG }, cases: [C("a", "2026-09-14")], now: "2027-02-01T09:12" }));
    expect([...new Set(rs.filter((r) => r.kind === "monthly").map((r) => r.month))]).toEqual(["2026-09", "2026-10"]);
    expect(rs.filter((r) => r.kind === "weekly_attendance").map((r) => r.week).pop()).toBe("2026-W42");
  });
});

describe("fönstret och idempotensen", () => {
  it("since: bara perioder som slutar efter tidpunkten och senast nu", () => {
    const cases = [C("a", "2026-12-01")];
    const rs = plannedReports(input({ cases, since: "2027-01-18T00:00", now: "2027-02-01T09:12" }));
    expect(keys(rs)).toEqual([
      "weekly_attendance:k-maria:2027-W03", "weekly_attendance:k-maria:2027-W04", "monthly:a:2027-01", "customer_summary:k-eva:2027-01",
    ]);
    // Per rapporttyp: veckorna redan klara, månaderna från december.
    const per = plannedReports(input({ cases, since: { weekly_attendance: "2027-02-01T00:00", monthly: "2026-12-01T00:00", customer_summary: "2027-02-01T00:00" } }));
    expect(keys(per)).toEqual(["monthly:a:2026-12", "monthly:a:2027-01"]);
  });
  it("befintliga rader (alla versioner) skapas inte igen – samma körning två gånger ger inget nytt", () => {
    const base = input({ cases: [C("a", "2027-01-04")], since: "2027-01-31T00:00" });
    const first = missingReports(base);
    expect(first.length).toBe(3);
    expect(missingReports({ ...base, existing: first })).toEqual([]);
    // En rättelse (version 2) av månadsrapporten räknas som samma rapport.
    const monthly = first.find((r) => r.kind === "monthly")!;
    expect(missingReports({ ...base, existing: [{ ...monthly, previousId: null }, { ...monthly }] }).map((r) => r.kind)).toEqual(["weekly_attendance", "customer_summary"]);
  });
  it("nycklarna för de unika indexen", () => {
    expect(reportKey({ kind: "weekly_attendance", contractId: "c", caseId: null, recipientUserId: "k", week: "2027-W04", month: null })).toBe("weekly_attendance|c|k|2027-W04");
    expect(reportKey({ kind: "monthly", contractId: "c", caseId: "a", recipientUserId: null, week: null, month: "2027-01" })).toBe("monthly|c|a|2027-01");
    expect(reportKey({ kind: "customer_summary", contractId: "c", caseId: null, recipientUserId: "k", week: null, month: "2027-01" })).toBe("customer_summary|c|k|2027-01");
    expect(reportKey({ kind: "final", contractId: "c", caseId: "a", recipientUserId: null, week: null, month: null })).toBeNull();
  });
  it("vilka perioder en körning prövar: högvattenmärket, golvet och fönstret", () => {
    const now = "2027-06-01T08:00";
    const recent = "2027-03-31T08:00";
    expect(LOOKBACK_DAYS).toBe(62);
    // Aldrig genomgånget och inget golv (produktionen, första körningen): från avtalets start.
    expect(scheduleFrom({ now, checkedThrough: null, floor: null })).toBeNull();
    // Färskt märke: de senaste 62 dagarna prövas ändå (startdatum i efterhand).
    expect(scheduleFrom({ now, checkedThrough: "2027-06-01T07:50", floor: null })).toBe(recent);
    // Gammalt märke (jobbet har stått still): från märket – inget hoppas över.
    expect(scheduleFrom({ now, checkedThrough: "2027-01-15T10:00", floor: null })).toBe("2027-01-15T10:00");
    // Golvet (testdatat är komplett till testklockans start) går aldrig att passera nedåt.
    expect(scheduleFrom({ now, checkedThrough: null, floor: "2027-02-01T09:12" })).toBe("2027-02-01T09:12");
    expect(scheduleFrom({ now: "2027-02-01T09:13", checkedThrough: null, floor: "2027-02-01T09:12" })).toBe("2027-02-01T09:12");
    expect(scheduleFrom({ now, checkedThrough: "2027-01-15T10:00", floor: "2027-02-01T09:12" })).toBe("2027-02-01T09:12");
    // Ett märke från en tidigare testomgång (efter klockan) gör ingen skada: fönstret eller golvet gäller.
    expect(scheduleFrom({ now: "2027-02-08T00:05", checkedThrough: "2027-04-01T10:00", floor: "2027-02-01T09:12" })).toBe("2027-02-01T09:12");
  });
  it("nästa gräns: måndag 00.00 eller den 1:a 00.00", () => {
    expect(nextScheduleBoundary("2027-02-01T09:12")).toBe("2027-02-08T00:00");
    expect(nextScheduleBoundary("2027-02-24T10:00")).toBe("2027-03-01T00:00");
    expect(nextScheduleBoundary("2027-02-28T23:59")).toBe("2027-03-01T00:00");
    expect(nextScheduleBoundary("2027-03-01T00:00")).toBe("2027-03-08T00:00");
  });
});
