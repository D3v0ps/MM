// Ändra startdatum (Karims beslut 2026-10-29): kontrollen och följderna i src/core/start-date.ts – månaderna ändringen rör
// (torsdagsregeln och uppehåll), fakturerade och godkända månader, tillfällena och de godkända mötesrapporterna före det nya
// datumet, månaderna som blir utan månadsrapport, rapporterna att rätta, fasen och varje fel.
import { describe, expect, it } from "vitest";
import type { Activity, Attendance, BillingRun, CaseStartChange, CheckIn, InvoiceDraft, InvoiceLine, InvoiceStatus, ReportStatus } from "@/data/schema";
import {
  activitiesBeforeStart, checkInsBeforeStart, startDateAt, latestStartKeeping, NO_BILLING, NO_REPORTS, nextStartChangeSeq, phaseSinceAfter, planStartChange, startChangeBlockedText,
  startChangeCorrections, startChangeDrafts, startChangeDroppedMonths, startChangeLock, startChangeMinDays, startChangeMonths, startChangeNoteBody, startChangeReportLock,
  startChangesInOrder, startCorrectionTaskText, startMotivationOf, type StartChangeBilling, type StartChangeCase, type StartChangeInput, type StartChangeReports,
} from "./start-date";

const WHY = "Deltagaren började en vecka senare än det som registrerades.";
const CASE: StartChangeCase = {
  id: "case-1", contractId: "c-bot", status: "active", startDate: "2027-01-26", endDate: null, plannedEnd: "2027-07-25", firstMeetingAt: "2027-01-19T10:00",
  pausedWeeks: [], phaseSince: "2027-01-26", referrerId: "k-maria",
};
const act = (id: string, startsAt: string, patch: Partial<Activity> = {}): Activity => ({
  id, caseId: "case-1", kind: "yrkesmoment", startsAt, durationMin: 180, location: "Miljonbemanning", note: "", groupActivityId: null, inviteSource: "manual", ...patch,
});
const att = (id: string, activityId: string, source: Attendance["source"] = "manual"): Attendance => ({
  id, activityId, caseId: "case-1", status: "present", reason: "", registeredBy: source === "auto" ? "system" : "u-amira", registeredAt: "2027-01-28T18:00", customerNotifiedAt: null, source,
});
const draft = (month: string, status: InvoiceStatus, groupingKey = "avtal", patch: Partial<InvoiceDraft> = {}): StartChangeBilling["drafts"][number] => ({
  id: `inv-c-bot-${month}-${groupingKey}`, contractId: "c-bot", month, kind: "periodic", groupingKey, status, ...patch,
});
const billing = (drafts: StartChangeBilling["drafts"] = [], lines: Pick<InvoiceLine, "invoiceDraftId" | "caseId">[] = [], runs: Pick<BillingRun, "contractId" | "month" | "status">[] = []): StartChangeBilling =>
  ({ drafts, lines, runs });
const plan = (to: string, patch: Partial<StartChangeInput> = {}) =>
  planStartChange({ case: CASE, to, motivation: WHY, activities: [], attendance: [], checkIns: [], billing: NO_BILLING, reports: NO_REPORTS, ...patch });
/** Som plan, med ett annat ärende. */
const planFor = (c: StartChangeCase, to: string, patch: Partial<StartChangeInput> = {}) => plan(to, { case: c, ...patch });
const ci = (id: string, heldAt: string, status: CheckIn["status"] = "approved", caseId = "case-1"): Pick<CheckIn, "id" | "caseId" | "heldAt" | "status"> => ({ id, caseId, heldAt, status });
type RepRow = StartChangeReports["reports"][number];
const monthly = (id: string, month: string, status: ReportStatus, patch: Partial<RepRow> = {}): RepRow => ({
  id, kind: "monthly", caseId: "case-1", recipientUserId: null, week: null, month, status, superseded: false, deliveredAt: null, ...patch,
});
const weekly = (id: string, week: string, status: ReportStatus, patch: Partial<RepRow> = {}): RepRow => ({
  id, kind: "weekly_attendance", caseId: null, recipientUserId: "k-maria", week, month: null, status, superseded: false, deliveredAt: null, ...patch,
});
const reportsOf = (reports: RepRow[], assessments: StartChangeReports["assessments"] = [], minEnrolledDays: number | undefined = 11): StartChangeReports =>
  ({ reports, assessments, minEnrolledDays });

describe("startChangeMonths: månaderna ändringen rör (torsdagsregeln, utan uppehåll)", () => {
  it("varje ISO-vecka från det tidigare till det senare datumet, i månaden där veckans torsdag ligger", () => {
    // Vecka 44 (torsdag 29 oktober) och vecka 45 (torsdag 5 november).
    expect(startChangeMonths("2026-10-27", "2026-11-03", [])).toEqual(["2026-10", "2026-11"]);
    // Samma veckor i omvänd ordning (starten flyttas bakåt).
    expect(startChangeMonths("2026-11-03", "2026-10-27", [])).toEqual(["2026-10", "2026-11"]);
  });

  it("månadsgränsen följer torsdagen: två septemberdagar i vecka 40 hör till oktober, två marsdagar i vecka 13 till april", () => {
    expect(startChangeMonths("2026-09-29", "2026-09-30", [])).toEqual(["2026-10"]);
    expect(startChangeMonths("2027-03-30", "2027-03-31", [])).toEqual(["2027-04"]);
  });

  it("över årsskiftet: vecka 53 2026 hör till december, vecka 1 2027 till januari", () => {
    expect(startChangeMonths("2026-12-29", "2027-01-05", [])).toEqual(["2026-12", "2027-01"]);
  });

  it("uppehållsveckor faktureras aldrig och räknas inte – inte heller veckan med det gamla startdatumet", () => {
    expect(startChangeMonths("2026-10-27", "2026-11-03", ["2026-W44"])).toEqual(["2026-11"]);
    expect(startChangeMonths("2026-10-27", "2026-11-03", ["2026-W44", "2026-W45"])).toEqual([]);
  });

  it("samma vecka: en månad", () => {
    expect(startChangeMonths("2027-01-26", "2027-01-28", [])).toEqual(["2027-01"]);
  });
});

describe("startChangeLock: fakturerad eller godkänd månad", () => {
  const c = { id: "case-1", contractId: "c-bot" };
  it("underlag (draft) och krediterad faktura stoppar inte – inga fakturor alls stoppar inte heller", () => {
    expect(startChangeLock(c, ["2026-10"], NO_BILLING)).toBeNull();
    expect(startChangeLock(c, ["2026-10"], billing([draft("2026-10", "draft")]))).toBeNull();
    expect(startChangeLock(c, ["2026-10"], billing([draft("2026-10", "credited")]))).toBeNull();
  });

  it("skapad, skickad, bokförd, betald, manuellt fakturerad eller returnerad: fakturerad", () => {
    for (const s of ["fortnox_created", "booked", "sent", "paid", "manual", "returned"] as InvoiceStatus[]) {
      expect(startChangeLock(c, ["2026-10"], billing([draft("2026-10", s)])), s).toEqual({ month: "2026-10", kind: "invoiced" });
    }
  });

  it("godkänd men inte skapad: godkänd", () => {
    expect(startChangeLock(c, ["2026-10"], billing([draft("2026-10", "approved")]))).toEqual({ month: "2026-10", kind: "approved" });
  });

  it("en skapad tilläggsfaktura och en stängd körning räknas som fakturerad", () => {
    expect(startChangeLock(c, ["2026-10"], billing([draft("2026-10", "draft"), draft("2026-10", "manual", "avtal-tillagg-2")]))).toEqual({ month: "2026-10", kind: "invoiced" });
    expect(startChangeLock(c, ["2026-10"], billing([], [], [{ contractId: "c-bot", month: "2026-10", status: "closed" }]))).toEqual({ month: "2026-10", kind: "invoiced" });
    expect(startChangeLock(c, ["2026-10"], billing([], [], [{ contractId: "c-bot", month: "2026-10", status: "draft" }]))).toBeNull();
  });

  it("en faktura per ärende: ett annat ärendes faktura stoppar inte, ärendets egen gör det", () => {
    expect(startChangeLock(c, ["2026-10"], billing([draft("2026-10", "sent", "case-2")]))).toBeNull();
    expect(startChangeLock(c, ["2026-10"], billing([draft("2026-10", "sent", "case-1")]))).toEqual({ month: "2026-10", kind: "invoiced" });
  });

  it("en fryst rad för ärendet på en skapad faktura stoppar, också i en annan grupp – men inte på ett underlag", () => {
    const other = draft("2026-10", "manual", "case-2");
    expect(startChangeLock(c, ["2026-10"], billing([other], [{ invoiceDraftId: other.id, caseId: "case-1" }]))).toEqual({ month: "2026-10", kind: "invoiced" });
    const open = draft("2026-10", "draft", "case-2");
    expect(startChangeLock(c, ["2026-10"], billing([open], [{ invoiceDraftId: open.id, caseId: "case-1" }]))).toBeNull();
  });

  it("bara periodiska fakturor i ärendets avtal och de månader ändringen rör räknas – den första fakturerade månaden svarar", () => {
    expect(startChangeLock(c, ["2026-10"], billing([draft("2026-10", "sent", "avtal", { kind: "bonus" })]))).toBeNull();
    expect(startChangeLock(c, ["2026-10"], billing([draft("2026-10", "sent", "avtal", { contractId: "c-annat" })]))).toBeNull();
    expect(startChangeLock(c, ["2026-11"], billing([draft("2026-10", "sent")]))).toBeNull();
    expect(startChangeLock(c, ["2026-12", "2026-11"], billing([draft("2026-12", "sent"), draft("2026-11", "approved")]))).toEqual({ month: "2026-11", kind: "approved" });
    // Fakturerad går före godkänd i samma månad.
    expect(startChangeLock(c, ["2026-11"], billing([draft("2026-11", "approved"), draft("2026-11", "manual", "avtal-tillagg-2")]))).toEqual({ month: "2026-11", kind: "invoiced" });
  });
});

describe("activitiesBeforeStart: tillfällena före det nya startdatumet", () => {
  it("utan närvaro och med bara automatisk närvaro tas bort (med den automatiska raden); manuell närvaro stoppar", () => {
    const acts = [
      act("a1", "2027-01-26T09:00"), act("a2", "2027-01-27T09:00"), act("a3", "2027-01-28T09:00", { groupActivityId: "ga-1" }), act("a4", "2027-02-02T09:00"),
      act("a5", "2027-01-27T13:00", { caseId: "case-2" }),
    ];
    const r = activitiesBeforeStart("case-1", "2027-02-02", acts, [att("t1", "a1", "auto"), att("t2", "a2", "manual")]);
    expect(r.remove).toEqual([
      { activityId: "a1", groupActivityId: null, attendanceId: "t1", startsAt: "2027-01-26T09:00" },
      { activityId: "a3", groupActivityId: "ga-1", attendanceId: null, startsAt: "2027-01-28T09:00" },
    ]);
    expect(r.blocked).toEqual([{ activityId: "a2", day: "2027-01-27" }]);
  });

  it("ett tillfälle på det nya startdatumet ligger kvar", () => {
    expect(activitiesBeforeStart("case-1", "2027-01-26", [act("a1", "2027-01-26T09:00")], [])).toEqual({ remove: [], blocked: [] });
  });
});

describe("phaseSinceAfter: fasen kan inte ha börjat före insatsen", () => {
  it("startdatumet följer med, en fas före det nya datumet blir det nya, en senare fas ligger kvar", () => {
    expect(phaseSinceAfter("2027-01-26", "2027-01-26", "2027-02-02")).toBe("2027-02-02");
    expect(phaseSinceAfter("2027-01-28", "2027-01-26", "2027-02-02")).toBe("2027-02-02");
    expect(phaseSinceAfter("2027-02-10", "2027-01-26", "2027-02-02")).toBe("2027-02-10");
    // Bakåt: fasen som började vid starten följer med, en senare ligger kvar.
    expect(phaseSinceAfter("2027-01-26", "2027-01-26", "2027-01-19")).toBe("2027-01-19");
    expect(phaseSinceAfter("2027-01-28", "2027-01-26", "2027-01-19")).toBe("2027-01-28");
    expect(phaseSinceAfter(null, "2027-01-26", "2027-02-02")).toBeNull();
  });
});

describe("startChangeBlockedText: bara pågående och pausade insatser", () => {
  it("avslutad, avböjd och inte startad har en orsak; pågående och pausad ingen", () => {
    expect(startChangeBlockedText({ status: "closed", startDate: "2026-10-01" })).toBe("Insatsen är avslutad. Startdatumet kan inte ändras.");
    expect(startChangeBlockedText({ status: "declined", startDate: null })).toMatch(/avböjd/);
    expect(startChangeBlockedText({ status: "confirmed", startDate: null })).toBe("Insatsen har inte startat än. Startdatumet väljs när insatsen startas.");
    expect(startChangeBlockedText({ status: "active", startDate: null })).toMatch(/inte startat/);
    expect(startChangeBlockedText({ status: "active", startDate: "2027-01-26" })).toBeNull();
    expect(startChangeBlockedText({ status: "paused", startDate: "2027-01-26" })).toBeNull();
  });
});

describe("planStartChange: kontrollen och följderna", () => {
  it("framåt: tillfällena före det nya datumet tas bort, månaderna och fasen följer – planerat slut ändras inte", () => {
    const acts = [act("a1", "2027-01-26T09:00"), act("a2", "2027-01-28T09:00"), act("a3", "2027-02-02T09:00")];
    const r = plan("2027-02-02", { activities: acts, attendance: [att("t1", "a2", "auto")] });
    expect(r).toEqual({
      ok: true,
      plan: {
        from: "2027-01-26", to: "2027-02-02", later: true, months: ["2027-01", "2027-02"], phaseSince: "2027-02-02",
        // Utan gräns för månadsrapporten räcker en inskriven dag – januari har ingen kvar.
        droppedMonths: ["2027-01"],
        remove: [
          { activityId: "a1", groupActivityId: null, attendanceId: null, startsAt: "2027-01-26T09:00" },
          { activityId: "a2", groupActivityId: null, attendanceId: "t1", startsAt: "2027-01-28T09:00" },
        ],
      },
    });
  });

  it("bakåt: inga tillfällen tas bort och inga skapas", () => {
    const r = plan("2027-01-20", { activities: [act("a1", "2027-01-26T09:00")] });
    expect(r).toMatchObject({ ok: true, plan: { from: "2027-01-26", to: "2027-01-20", later: false, months: ["2027-01"], remove: [], droppedMonths: [], phaseSince: "2027-01-20" } });
  });

  it("nekas: avslutad, inte startad, samma datum, före första mötet och efter planerat slut eller slutdatum", () => {
    expect(planFor({ ...CASE, status: "closed" }, "2027-02-02"))
      .toMatchObject({ ok: false, problem: { code: "wrong_status", field: "date" } });
    expect(planFor({ ...CASE, status: "confirmed", startDate: null }, "2027-02-02"))
      .toMatchObject({ ok: false, problem: { code: "wrong_status", text: "Insatsen har inte startat än. Startdatumet väljs när insatsen startas." } });
    expect(plan("2027-01-26")).toMatchObject({ ok: false, problem: { code: "same", text: "Det är redan insatsens startdatum. Välj ett annat datum." } });
    expect(plan("2027-01-18")).toMatchObject({ ok: false, problem: { code: "before_meeting", text: "Startdatumet kan inte vara före första mötet 19 jan 2027." } });
    // Första mötets dag går (tiden på dagen spelar ingen roll).
    expect(plan("2027-01-19")).toMatchObject({ ok: true });
    expect(plan("2027-07-26")).toMatchObject({ ok: false, problem: { code: "after_end", text: "Startdatumet kan inte vara efter planerat slut 25 juli 2027." } });
    expect(plan("2027-07-25")).toMatchObject({ ok: true });
    expect(planFor({ ...CASE, status: "paused", endDate: "2027-03-31" }, "2027-04-01"))
      .toMatchObject({ ok: false, problem: { code: "after_end", text: "Startdatumet kan inte vara efter slutdatumet 31 mars 2027." } });
  });

  it("nekas när en månad ändringen rör är fakturerad – meddelandet säger vilken och att ekonomen behöver kreditera", () => {
    const c: StartChangeCase = { ...CASE, startDate: "2026-11-03", firstMeetingAt: "2026-10-20T10:00", phaseSince: null };
    const r = planFor(c, "2026-10-27", { billing: billing([draft("2026-10", "sent"), draft("2026-11", "draft")]) });
    expect(r).toEqual({
      ok: false,
      problem: { code: "invoiced", field: "date", month: "2026-10", text: "Oktober 2026 är redan fakturerad. Ekonomen behöver kreditera fakturan innan startdatumet kan ändras." },
    });
    // Det nya datumet i en fakturerad månad stoppar lika väl som det gamla.
    const r2 = planFor(c, "2026-11-10", { billing: billing([draft("2026-11", "manual")]) });
    expect(r2).toMatchObject({ ok: false, problem: { code: "invoiced", month: "2026-11" } });
  });

  it("nekas när månadens faktura är godkänd – kontakta ekonomen", () => {
    const r = plan("2027-02-02", { billing: billing([draft("2027-01", "approved")]) });
    expect(r).toMatchObject({
      ok: false,
      problem: { code: "invoiced", month: "2027-01", text: "Fakturan för januari 2027 är redan godkänd av ekonomen. Startdatumet kan inte ändras när månadens faktura är godkänd – kontakta ekonomen." },
    });
  });

  it("torsdagsregeln avgör: starten flyttas inom vecka 5 (februari) – en fakturerad januari stoppar inte", () => {
    const c: StartChangeCase = { ...CASE, startDate: "2027-02-01", firstMeetingAt: "2027-01-29T10:00", phaseSince: null };
    expect(planFor(c, "2027-02-03", { billing: billing([draft("2027-01", "sent")]) })).toMatchObject({
      ok: true, plan: { months: ["2027-02"] },
    });
    // Flyttas starten in i vecka 4 (torsdag 28 januari) rör den januari.
    expect(planFor(c, "2027-01-29", { billing: billing([draft("2027-01", "sent")]) })).toMatchObject({
      ok: false, problem: { code: "invoiced", month: "2027-01" },
    });
  });

  it("en uppehållsvecka i en fakturerad månad stoppar inte – den faktureras aldrig", () => {
    const c: StartChangeCase = { ...CASE, startDate: "2026-10-27", firstMeetingAt: "2026-10-20T10:00", pausedWeeks: ["2026-W44"], phaseSince: null };
    expect(planFor(c, "2026-11-03", { billing: billing([draft("2026-10", "paid")]) })).toMatchObject({
      ok: true, plan: { months: ["2026-11"] },
    });
  });

  it("nekas när ett tillfälle före det nya datumet har manuell närvaro – meddelandet säger hur många och senaste datum", () => {
    const acts = [act("a1", "2027-01-26T09:00"), act("a2", "2027-01-27T09:00"), act("a3", "2027-01-28T09:00")];
    const r = plan("2027-02-02", { activities: acts, attendance: [att("t1", "a2"), att("t2", "a3"), att("t3", "a1", "auto")] });
    expect(r).toEqual({
      ok: false,
      problem: {
        code: "attendance", field: "date", latest: "2027-01-27",
        text: "2 tillfällen före det nya startdatumet har registrerad närvaro. Ett tillfälle med registrerad närvaro tas aldrig bort, så startdatumet kan vara senast 27 jan 2027.",
      },
    });
    expect(plan("2027-01-28", { activities: [act("a2", "2027-01-27T09:00")], attendance: [att("t1", "a2")] })).toMatchObject({
      ok: false, problem: { text: expect.stringMatching(/^1 tillfälle före det nya startdatumet/) },
    });
    // Samma tillfälle på det nya startdatumet stoppar inte.
    expect(plan("2027-01-27", { activities: [act("a2", "2027-01-27T09:00")], attendance: [att("t1", "a2")] })).toMatchObject({ ok: true });
  });

  it("nekas: för kort eller för lång motivering och personnummer i motiveringen", () => {
    expect(plan("2027-02-02", { motivation: "  kort  " })).toMatchObject({ ok: false, problem: { code: "motivation", field: "motivation", text: "Skriv en kort motivering, 10–300 tecken." } });
    expect(plan("2027-02-02", { motivation: "x".repeat(301) })).toMatchObject({ ok: false, problem: { code: "motivation" } });
    expect(plan("2027-02-02", { motivation: `  ${"x".repeat(300)}  ` })).toMatchObject({ ok: true });
    expect(plan("2027-02-02", { motivation: "Enligt kommunen gäller 19730216-9545 numera." })).toMatchObject({ ok: false, problem: { code: "pnr", field: "motivation" } });
  });
});

describe("godkända mötesrapporter före det nya datumet (checkInsBeforeStart)", () => {
  it("bara godkända mötesrapporter i ärendet före dagen räknas, i tidsordning – utkast och mötesrapporten på dagen stoppar inte", () => {
    const xs = [ci("k2", "2027-01-28T09:00"), ci("k1", "2027-01-27T09:00"), ci("k3", "2027-01-27T13:00", "draft"), ci("k4", "2027-01-27T09:00", "approved", "case-2"), ci("k5", "2027-02-02T09:00")];
    expect(checkInsBeforeStart("case-1", "2027-02-02", xs)).toEqual([{ checkInId: "k1", day: "2027-01-27" }, { checkInId: "k2", day: "2027-01-28" }]);
  });

  it("planStartChange: en godkänd mötesrapport stoppar som registrerad närvaro och meddelandet säger senaste datum", () => {
    expect(plan("2027-02-02", { checkIns: [ci("k1", "2027-01-28T09:00")] })).toEqual({
      ok: false,
      problem: {
        code: "attendance", field: "date", latest: "2027-01-28",
        text: "1 mötesrapport före det nya startdatumet är godkänd. En godkänd mötesrapport tas aldrig bort, så startdatumet kan vara senast 28 jan 2027.",
      },
    });
    // Närvaro och mötesrapporter tillsammans: det tidigaste datumet gäller.
    const acts = [act("a1", "2027-01-29T09:00")];
    expect(plan("2027-02-02", { activities: acts, attendance: [att("t1", "a1")], checkIns: [ci("k1", "2027-01-27T09:00"), ci("k2", "2027-01-28T09:00")] })).toMatchObject({
      ok: false,
      problem: {
        code: "attendance", latest: "2027-01-27",
        text: "Före det nya startdatumet finns 1 tillfälle med registrerad närvaro och 2 godkända mötesrapporter. De tas aldrig bort, så startdatumet kan vara senast 27 jan 2027.",
      },
    });
    // Ett utkast och en mötesrapport på det nya datumet stoppar inte; bakåt stoppar ingen mötesrapport.
    expect(plan("2027-02-02", { checkIns: [ci("k1", "2027-01-28T09:00", "draft"), ci("k2", "2027-02-02T09:00")] })).toMatchObject({ ok: true });
    expect(plan("2027-01-20", { checkIns: [ci("k1", "2027-01-28T09:00")] })).toMatchObject({ ok: true });
  });
});

describe("månader som blir utan månadsrapport (startChangeDroppedMonths, startChangeReportLock, startChangeDrafts)", () => {
  const JAN7: StartChangeCase = { ...CASE, startDate: "2027-01-07", firstMeetingAt: "2027-01-07T09:00", phaseSince: null };
  it("en månad faller bort när den får färre än minEnrolledDays inskrivna dagar – men hade tillräckligt många förut", () => {
    // 7 januari → 1 februari: januari har inga dagar kvar.
    expect(startChangeDroppedMonths(JAN7, "2027-01-07", "2027-02-01", 11)).toEqual(["2027-01"]);
    // 18 → 25 januari: 7 dagar kvar (< 11). 18 → 21 januari: 11 dagar kvar – rapporten finns kvar.
    expect(startChangeDroppedMonths(JAN7, "2027-01-18", "2027-01-25", 11)).toEqual(["2027-01"]);
    expect(startChangeDroppedMonths(JAN7, "2027-01-18", "2027-01-21", 11)).toEqual([]);
    // En månad som redan hade för få dagar faller inte bort (den hade ingen rapport): 25 → 28 januari.
    expect(startChangeDroppedMonths(JAN7, "2027-01-25", "2027-01-28", 11)).toEqual([]);
    // Över flera månader: december och januari faller bort.
    expect(startChangeDroppedMonths(JAN7, "2026-12-15", "2027-02-02", 11)).toEqual(["2026-12", "2027-01"]);
    // Bakåt faller ingen månad bort; utan gräns räcker en dag.
    expect(startChangeDroppedMonths(JAN7, "2027-02-01", "2027-01-07", 11)).toEqual([]);
    expect(startChangeDroppedMonths(JAN7, "2027-01-18", "2027-01-25", undefined)).toEqual([]);
    expect(startChangeDroppedMonths(JAN7, "2027-01-26", "2027-02-02", undefined)).toEqual(["2027-01"]);
    // Ett slutdatum i månaden räknas: 4–20 januari har 17 dagar, 12–20 januari 9.
    expect(startChangeDroppedMonths({ ...JAN7, endDate: "2027-01-20" }, "2027-01-04", "2027-01-12", 11)).toEqual(["2027-01"]);
  });

  it("senaste startdatum som behåller månadens rapport", () => {
    expect(latestStartKeeping({ endDate: null }, "2027-01", 11)).toBe("2027-01-21");
    expect(latestStartKeeping({ endDate: null }, "2027-02", 11)).toBe("2027-02-18");
    expect(latestStartKeeping({ endDate: "2027-01-25" }, "2027-01", 11)).toBe("2027-01-15");
    expect(latestStartKeeping({ endDate: null }, "2027-01", undefined)).toBe("2027-01-31");
  });

  it("stoppar när månadens rapport är lämnad, granskad eller godkänd eller bedömningen godkänd – utkast och ersatta versioner gör det inte", () => {
    const lock = (r: StartChangeReports) => startChangeReportLock(JAN7, "2027-01-07", "2027-02-01", r);
    expect(lock(reportsOf([monthly("r1", "2027-01", "delivered")]))).toEqual({ month: "2027-01", kind: "delivered", latest: "2027-01-21" });
    expect(lock(reportsOf([monthly("r1", "2027-01", "opened")]))).toMatchObject({ kind: "delivered" });
    expect(lock(reportsOf([monthly("r1", "2027-01", "approved")]))).toMatchObject({ kind: "approved_report" });
    expect(lock(reportsOf([monthly("r1", "2027-01", "reviewed")]))).toMatchObject({ kind: "approved_report" });
    expect(lock(reportsOf([], [{ id: "ma-1", caseId: "case-1", month: "2027-01", status: "approved" }]))).toMatchObject({ kind: "approved_assessment" });
    expect(lock(reportsOf([monthly("r1", "2027-01", "draft")], [{ id: "ma-1", caseId: "case-1", month: "2027-01", status: "draft" }]))).toBeNull();
    // Ett utkast som coachen har sparat (assessment.saved) stoppar – det coachen skrivit tas aldrig bort.
    const saved = { ...reportsOf([monthly("r1", "2027-01", "draft")], [{ id: "ma-1", caseId: "case-1", month: "2027-01", status: "draft" }]), savedAssessmentIds: ["ma-1"] };
    expect(lock(saved)).toEqual({ month: "2027-01", kind: "saved_assessment", latest: "2027-01-21" });
    expect(lock({ ...saved, savedAssessmentIds: ["ma-other"] })).toBeNull();
    expect(lock(reportsOf([monthly("r1", "2027-01", "delivered", { superseded: true })]))).toBeNull();
    // Ett annat ärendes rapport och en månad som inte faller bort stoppar inte.
    expect(lock(reportsOf([monthly("r1", "2027-01", "delivered", { caseId: "case-2" })]))).toBeNull();
    expect(startChangeReportLock(JAN7, "2027-01-07", "2027-01-14", reportsOf([monthly("r1", "2027-01", "delivered")]))).toBeNull();
  });

  it("planStartChange: report med meddelandet om senaste datum – utkasten ger droppedMonths", () => {
    expect(planFor(JAN7, "2027-02-01", { reports: reportsOf([monthly("r1", "2027-01", "delivered")]) })).toEqual({
      ok: false,
      problem: {
        code: "report", field: "date", month: "2027-01", latest: "2027-01-21",
        text: "Månadsrapporten för januari 2027 är redan lämnad till kommunen. Med det nya startdatumet får januari för få inskrivna dagar för en månadsrapport, så startdatumet kan vara senast 21 jan 2027.",
      },
    });
    expect(planFor(JAN7, "2027-02-01", { reports: reportsOf([monthly("r1", "2027-01", "approved")]) })).toMatchObject({
      ok: false, problem: { code: "report", text: expect.stringMatching(/^Månadsrapporten för januari 2027 är redan godkänd\./) },
    });
    expect(planFor(JAN7, "2027-02-01", { reports: reportsOf([], [{ id: "ma-1", caseId: "case-1", month: "2027-01", status: "approved" }]) })).toMatchObject({
      ok: false, problem: { code: "report", text: expect.stringContaining("Månadsbedömningen för januari 2027 är redan godkänd. Med det nya startdatumet får januari för få inskrivna dagar för en månadsbedömning") },
    });
    expect(planFor(JAN7, "2027-02-01", { reports: { ...reportsOf([], [{ id: "ma-1", caseId: "case-1", month: "2027-01", status: "draft" }]), savedAssessmentIds: ["ma-1"] } })).toEqual({
      ok: false,
      problem: {
        code: "report", field: "date", month: "2027-01", latest: "2027-01-21",
        text: "Coachen har sparat månadsbedömningen för januari 2027, och det coachen skrivit tas aldrig bort. Med det nya startdatumet får januari för få inskrivna dagar för en månadsbedömning, så startdatumet kan vara senast 21 jan 2027.",
      },
    });
    expect(planFor(JAN7, "2027-02-01", { reports: reportsOf([monthly("r1", "2027-01", "draft")]) })).toMatchObject({ ok: true, plan: { droppedMonths: ["2027-01"] } });
    expect(planFor(JAN7, "2027-01-21", { reports: reportsOf([monthly("r1", "2027-01", "delivered")]) })).toMatchObject({ ok: true, plan: { droppedMonths: [] } });
  });

  it("utkasten som tas bort: systemets rapport- och bedömningsutkast i månaderna – planen bara när nästa månad inte heller får en rapport", () => {
    const data = {
      reports: [monthly("r1", "2027-01", "draft"), monthly("r2", "2027-02", "draft"), monthly("r3", "2027-01", "draft", { caseId: "case-2" }), weekly("w1", "2027-W02", "draft")],
      assessments: [{ id: "ma-1", caseId: "case-1", month: "2027-01", status: "draft" as const }, { id: "ma-2", caseId: "case-1", month: "2027-02", status: "draft" as const }],
      plans: [{ id: "mp-1", caseId: "case-1", month: "2027-01", status: "draft" as const }, { id: "mp-0", caseId: "case-1", month: "2027-01", status: "approved" as const }],
      minEnrolledDays: 11,
    };
    // 7 januari → 1 februari: januari blir utan rapport. Januaris plan är planen för februari – februari får en rapport, planen ligger
    // kvar som underlag till februaris bedömning ("Förra månadens plan").
    expect(startChangeDrafts(JAN7, "2027-02-01", ["2027-01"], data)).toEqual({ reportIds: ["r1"], assessmentIds: ["ma-1"], planIds: [], keptAssessmentIds: [], months: ["2027-01"] });
    // 7 januari → 22 februari: februari får 7 dagar – januaris plan (planen för februari) tas bort med utkasten.
    expect(startChangeDrafts(JAN7, "2027-02-22", ["2027-01"], data)).toEqual({ reportIds: ["r1"], assessmentIds: ["ma-1"], planIds: ["mp-1"], keptAssessmentIds: [], months: ["2027-01"] });
    // En bedömning som coachen har sparat tas aldrig bort – inte heller dess plan (hann coachen spara efter kontrollen).
    expect(startChangeDrafts(JAN7, "2027-02-22", ["2027-01"], { ...data, savedAssessmentIds: ["ma-1"] })).toEqual({
      reportIds: ["r1"], assessmentIds: [], planIds: [], keptAssessmentIds: ["ma-1"], months: ["2027-01"],
    });
    expect(startChangeDrafts(JAN7, "2027-02-01", [], data)).toEqual({ reportIds: [], assessmentIds: [], planIds: [], keptAssessmentIds: [], months: [] });
    // Inga utkast i månaden (månaden är inte slut än): inget tas bort och ingen månad.
    expect(startChangeDrafts(JAN7, "2027-02-25", ["2027-02"], { ...data, reports: [], assessments: [], plans: [] }).months).toEqual([]);
  });

  it("avtalets gräns ur konfigurationen", () => {
    expect(startChangeMinDays({ reportSchedule: { monthly: { minEnrolledDays: 11 } } })).toBe(11);
    expect(startChangeMinDays({ reportSchedule: {} })).toBeUndefined();
    expect(startChangeMinDays(null)).toBeUndefined();
  });
});

describe("rapporter som redan är lämnade till kommunen (startChangeCorrections, startCorrectionTaskText)", () => {
  const c = { id: "case-1", referrerId: "k-maria" };
  const chg = (seq: number, fromDate: string, toDate: string, changedAt: string): Pick<CaseStartChange, "id" | "seq" | "changedAt" | "fromDate" | "toDate"> =>
    ({ id: `csc-${seq}`, seq, changedAt, fromDate, toDate });
  /** En ändring 7 → 18 januari, 1 februari 09.00. */
  const one = [chg(1, "2027-01-07", "2027-01-18", "2027-02-01T09:00")];
  it("startdatumet som gällde när rapporten lämnades: ändringen efter tidpunkten utgick från det", () => {
    const two = [...one, chg(2, "2027-01-18", "2027-01-07", "2027-02-02T09:00")];
    expect(startDateAt("2027-01-07", two, "2027-01-30T08:00")).toBe("2027-01-07");
    expect(startDateAt("2027-01-07", two, "2027-02-01T12:00")).toBe("2027-01-18");
    expect(startDateAt("2027-01-07", two, "2027-02-03T08:00")).toBe("2027-01-07");
    // Ingen tidpunkt (äldre rader): före alla ändringar. Inga ändringar: dagens.
    expect(startDateAt("2027-01-07", two, null)).toBe("2027-01-07");
    expect(startDateAt("2027-01-18", one, null)).toBe("2027-01-07");
    expect(startDateAt("2027-01-18", [], "2027-01-30T08:00")).toBe("2027-01-18");
  });

  it("veckorapporterna till handläggaren och ärendets månadsrapporter som räknade med det gamla startdatumet", () => {
    const at = { deliveredAt: "2027-01-30T08:00" };
    const reports = [
      weekly("w1", "2027-W01", "delivered", at), weekly("w2", "2027-W02", "opened", at), weekly("w3", "2027-W03", "delivered", at), weekly("w4", "2027-W04", "waiting"),
      weekly("w5", "2027-W02", "delivered", { recipientUserId: "k-omar", ...at }), weekly("w6", "2027-W02", "delivered", { superseded: true, ...at }),
      monthly("m1", "2027-01", "delivered", at), monthly("m2", "2027-01", "draft"), monthly("m3", "2027-02", "delivered", at),
    ];
    // 7 januari → 18 januari (måndag): vecka 1 och 2 rörs – inte vecka 3, som börjar på det nya datumet.
    expect(startChangeCorrections(c, "2027-01-18", one, reports)).toEqual([
      { reportId: "w1", kind: "weekly_attendance", period: "2027-W01", frozenStart: "2027-01-07" },
      { reportId: "w2", kind: "weekly_attendance", period: "2027-W02", frozenStart: "2027-01-07" },
      { reportId: "m1", kind: "monthly", period: "2027-01", frozenStart: "2027-01-07" },
    ]);
    // Bakåt (18 → 7 januari) rör samma dagar.
    expect(startChangeCorrections(c, "2027-01-07", [chg(1, "2027-01-18", "2027-01-07", "2027-02-01T09:00")], reports).map((x) => x.reportId)).toEqual(["w1", "w2", "m1"]);
    // Tillbaka till 7 januari: rapporterna lämnades med 7 januari – inget att rätta.
    expect(startChangeCorrections(c, "2027-01-07", [...one, chg(2, "2027-01-18", "2027-01-07", "2027-02-01T10:00")], reports)).toEqual([]);
    // En rättad version som lämnades efter ändringen räknar redan med 18 januari.
    expect(startChangeCorrections(c, "2027-01-18", one, [weekly("w1b", "2027-W01", "delivered", { deliveredAt: "2027-02-01T11:00" })])).toEqual([]);
    // Utan handläggare: bara månadsrapporterna.
    expect(startChangeCorrections({ id: "case-1", referrerId: null }, "2027-01-18", one, reports).map((x) => x.reportId)).toEqual(["m1"]);
  });

  it("uppgiftens text: ärendenumret, datumen och perioderna – inga namn", () => {
    const at = { deliveredAt: "2027-01-30T08:00" };
    const items = startChangeCorrections(c, "2027-01-18", one, [weekly("w1", "2027-W01", "delivered", at), weekly("w2", "2027-W02", "delivered", at), monthly("m1", "2027-01", "delivered", at)]);
    expect(startCorrectionTaskText("BOT-27-0002", "2027-01-18", items)).toBe(
      "BOT-27-0002: startdatumet är ändrat från 7 jan 2027 till 18 jan 2027. Rätta rapporterna som redan är lämnade till kommunen: veckorapporterna för vecka 1 och 2 2027 samt månadsrapporten för januari 2027.",
    );
    // Över årsskiftet: veckorna per år.
    expect(startCorrectionTaskText("BOT-27-0002", "2027-01-11", [
      { reportId: "w0", kind: "weekly_attendance", period: "2026-W53", frozenStart: "2026-12-29" }, { reportId: "w1", kind: "weekly_attendance", period: "2027-W01", frozenStart: "2026-12-29" },
    ])).toContain("veckorapporterna för vecka 53 2026 och vecka 1 2027.");
    expect(startCorrectionTaskText("BOT-27-0002", "2027-01-11", items.slice(0, 1))).toBe(
      "BOT-27-0002: startdatumet är ändrat från 7 jan 2027 till 11 jan 2027. Rätta rapporten som redan är lämnad till kommunen: veckorapporten för vecka 1 2027.",
    );
    // Rapporterna räknade med olika startdatum: bara det nya.
    expect(startCorrectionTaskText("BOT-27-0002", "2027-01-18", [{ ...items[0], frozenStart: "2027-01-04" }, items[1]])).toBe(
      "BOT-27-0002: startdatumet är ändrat till 18 jan 2027. Rätta rapporterna som redan är lämnade till kommunen: veckorapporterna för vecka 1 och 2 2027.",
    );
  });
});

describe("anteckningen och ordningen", () => {
  it("motiveringen ur anteckningen", () => {
    const body = startChangeNoteBody("2027-02-01", "2027-01-26", `  ${WHY}  `);
    expect(body).toBe(`Ändrat startdatum: 1 feb 2027 → 26 jan 2027. ${WHY}`);
    expect(startMotivationOf(body, "2027-02-01", "2027-01-26")).toBe(WHY);
    expect(startMotivationOf("Annan text.", "2027-02-01", "2027-01-26")).toBe("Annan text.");
  });

  it("ändringarna ordnas efter nummer i ärendet, nästa nummer är det högsta plus ett", () => {
    const x = (id: string, seq: number, changedAt: string): CaseStartChange => ({
      id, contractId: "c-bot", caseId: "case-1", fromDate: "2027-01-26", toDate: "2027-02-02", changedBy: "u-amira", changedAt, noteId: `n-${id}`, seq,
    });
    const xs = [x("b", 2, "2027-01-28T10:00"), x("a", 1, "2027-01-28T10:00"), x("c", 3, "2027-01-27T10:00")];
    expect(startChangesInOrder(xs).map((y) => y.id)).toEqual(["a", "b", "c"]);
    expect(nextStartChangeSeq(xs)).toBe(4);
    expect(nextStartChangeSeq([])).toBe(1);
  });
});
