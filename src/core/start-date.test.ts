// Ändra startdatum (Karims beslut 2026-10-29): kontrollen och följderna i src/core/start-date.ts – månaderna ändringen rör
// (torsdagsregeln och uppehåll), fakturerade och godkända månader, tillfällena före det nya datumet, fasen och varje fel.
import { describe, expect, it } from "vitest";
import type { Activity, Attendance, BillingRun, CaseStartChange, InvoiceDraft, InvoiceLine, InvoiceStatus } from "@/data/schema";
import {
  activitiesBeforeStart, NO_BILLING, nextStartChangeSeq, phaseSinceAfter, planStartChange, startChangeBlockedText, startChangeLock, startChangeMonths, startChangeNoteBody,
  startChangesInOrder, startMotivationOf, type StartChangeBilling, type StartChangeCase, type StartChangeInput,
} from "./start-date";

const WHY = "Deltagaren började en vecka senare än det som registrerades.";
const CASE: StartChangeCase = {
  id: "case-1", contractId: "c-bot", status: "active", startDate: "2027-01-26", endDate: null, plannedEnd: "2027-07-25", firstMeetingAt: "2027-01-19T10:00",
  pausedWeeks: [], phaseSince: "2027-01-26",
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
  planStartChange({ case: CASE, to, motivation: WHY, activities: [], attendance: [], billing: NO_BILLING, ...patch });

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
        remove: [
          { activityId: "a1", groupActivityId: null, attendanceId: null, startsAt: "2027-01-26T09:00" },
          { activityId: "a2", groupActivityId: null, attendanceId: "t1", startsAt: "2027-01-28T09:00" },
        ],
      },
    });
  });

  it("bakåt: inga tillfällen tas bort och inga skapas", () => {
    const r = plan("2027-01-20", { activities: [act("a1", "2027-01-26T09:00")] });
    expect(r).toMatchObject({ ok: true, plan: { from: "2027-01-26", to: "2027-01-20", later: false, months: ["2027-01"], remove: [], phaseSince: "2027-01-20" } });
  });

  it("nekas: avslutad, inte startad, samma datum, före första mötet och efter planerat slut eller slutdatum", () => {
    expect(planStartChange({ case: { ...CASE, status: "closed" }, to: "2027-02-02", motivation: WHY, activities: [], attendance: [], billing: NO_BILLING }))
      .toMatchObject({ ok: false, problem: { code: "wrong_status", field: "date" } });
    expect(planStartChange({ case: { ...CASE, status: "confirmed", startDate: null }, to: "2027-02-02", motivation: WHY, activities: [], attendance: [], billing: NO_BILLING }))
      .toMatchObject({ ok: false, problem: { code: "wrong_status", text: "Insatsen har inte startat än. Startdatumet väljs när insatsen startas." } });
    expect(plan("2027-01-26")).toMatchObject({ ok: false, problem: { code: "same", text: "Det är redan insatsens startdatum. Välj ett annat datum." } });
    expect(plan("2027-01-18")).toMatchObject({ ok: false, problem: { code: "before_meeting", text: "Startdatumet kan inte vara före första mötet 19 jan 2027." } });
    // Första mötets dag går (tiden på dagen spelar ingen roll).
    expect(plan("2027-01-19")).toMatchObject({ ok: true });
    expect(plan("2027-07-26")).toMatchObject({ ok: false, problem: { code: "after_end", text: "Startdatumet kan inte vara efter planerat slut 25 juli 2027." } });
    expect(plan("2027-07-25")).toMatchObject({ ok: true });
    expect(planStartChange({ case: { ...CASE, status: "paused", endDate: "2027-03-31" }, to: "2027-04-01", motivation: WHY, activities: [], attendance: [], billing: NO_BILLING }))
      .toMatchObject({ ok: false, problem: { code: "after_end", text: "Startdatumet kan inte vara efter slutdatumet 31 mars 2027." } });
  });

  it("nekas när en månad ändringen rör är fakturerad – meddelandet säger vilken och att ekonomen behöver kreditera", () => {
    const c: StartChangeCase = { ...CASE, startDate: "2026-11-03", firstMeetingAt: "2026-10-20T10:00", phaseSince: null };
    const r = planStartChange({ case: c, to: "2026-10-27", motivation: WHY, activities: [], attendance: [], billing: billing([draft("2026-10", "sent"), draft("2026-11", "draft")]) });
    expect(r).toEqual({
      ok: false,
      problem: { code: "invoiced", field: "date", month: "2026-10", text: "Oktober 2026 är redan fakturerad. Ekonomen behöver kreditera fakturan innan startdatumet kan ändras." },
    });
    // Det nya datumet i en fakturerad månad stoppar lika väl som det gamla.
    const r2 = planStartChange({ case: c, to: "2026-11-10", motivation: WHY, activities: [], attendance: [], billing: billing([draft("2026-11", "manual")]) });
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
    expect(planStartChange({ case: c, to: "2027-02-03", motivation: WHY, activities: [], attendance: [], billing: billing([draft("2027-01", "sent")]) })).toMatchObject({
      ok: true, plan: { months: ["2027-02"] },
    });
    // Flyttas starten in i vecka 4 (torsdag 28 januari) rör den januari.
    expect(planStartChange({ case: c, to: "2027-01-29", motivation: WHY, activities: [], attendance: [], billing: billing([draft("2027-01", "sent")]) })).toMatchObject({
      ok: false, problem: { code: "invoiced", month: "2027-01" },
    });
  });

  it("en uppehållsvecka i en fakturerad månad stoppar inte – den faktureras aldrig", () => {
    const c: StartChangeCase = { ...CASE, startDate: "2026-10-27", firstMeetingAt: "2026-10-20T10:00", pausedWeeks: ["2026-W44"], phaseSince: null };
    expect(planStartChange({ case: c, to: "2026-11-03", motivation: WHY, activities: [], attendance: [], billing: billing([draft("2026-10", "paid")]) })).toMatchObject({
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
