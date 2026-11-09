// Starta insatsen före det bokade första mötet (Karims beslut 2026-11-09): reglerna i src/core/early-start.ts. Bara påhittade
// uppgifter. Ärendet: beställt onsdag 27 januari 2027, första mötet bokat måndag 8 februari kl. 10.00.
import { describe, expect, it } from "vitest";
import type { Case } from "@/data/schema";
import { earlyStartDateProblem, earlyStartMonths, earlyStartProblem, isEarlyStart, movedMeetingAt, orderPeriodBasis, plannedEndFrom } from "./early-start";
import { NO_BILLING, type StartChangeBilling } from "./start-date";

const CASE: Pick<Case, "id" | "contractId" | "referredAt" | "firstMeetingAt" | "pausedWeeks"> = {
  id: "case-1", contractId: "c-1", referredAt: "2027-01-27T14:00", firstMeetingAt: "2027-02-08T10:00", pausedWeeks: [],
};
const TODAY = "2027-02-03"; // onsdag
const problem = (startDate: string, o: { today?: string; time?: string; billing?: StartChangeBilling; noShows?: { caseId: string; meetingAt: string }[]; c?: typeof CASE } = {}) => {
  const c = o.c ?? CASE;
  return earlyStartProblem({ c, startDate, meetingAt: movedMeetingAt(c, startDate, o.time), today: o.today ?? TODAY, billing: o.billing ?? NO_BILLING, noShows: o.noShows ?? [] });
};

describe("isEarlyStart och movedMeetingAt", () => {
  it("före det bokade mötets dag – inte samma dag och inte efter, och aldrig utan bokat möte", () => {
    expect(isEarlyStart(CASE, "2027-02-05")).toBe(true);
    expect(isEarlyStart(CASE, "2027-02-08")).toBe(false);
    expect(isEarlyStart(CASE, "2027-02-09")).toBe(false);
    expect(isEarlyStart({ firstMeetingAt: null }, "2027-02-01")).toBe(false);
  });

  it("det flyttade mötet: startdagen med klockslaget ur dialogen, annars det bokade mötets klockslag", () => {
    expect(movedMeetingAt(CASE, "2027-02-03", "13:30")).toBe("2027-02-03T13:30");
    expect(movedMeetingAt(CASE, "2027-02-03", undefined)).toBe("2027-02-03T10:00");
    expect(movedMeetingAt(CASE, "2027-02-03", "")).toBe("2027-02-03T10:00");
    // Ett ogiltigt klockslag läses aldrig (schemat stoppar det redan) – det bokade mötets tid gäller.
    expect(movedMeetingAt(CASE, "2027-02-03", "25:00")).toBe("2027-02-03T10:00");
  });
});

describe("earlyStartProblem – vad som stoppar en start före det bokade mötet", () => {
  it("i dag och i går går", () => {
    expect(problem("2027-02-03")).toBeNull();
    expect(problem("2027-02-02")).toBeNull();
  });

  it("beställningens dag går – dagen före nekas", () => {
    expect(problem("2027-01-27")).toBeNull();
    expect(problem("2027-01-26")).toEqual({ code: "before_order", text: "Startdatumet kan inte vara före beställningen 27 jan 2027." });
  });

  it("en kommande dag före mötet nekas – då bokas mötet om", () => {
    expect(problem("2027-02-04")).toEqual({
      code: "start_date",
      text: "Startdatumet ligger före första mötet 8 feb 2027 men har inte varit än. Välj dagen deltagaren kom – i dag eller tidigare. Ska mötet hållas tidigare? Boka om första mötet.",
    });
    // Samma dag en dag senare går.
    expect(problem("2027-02-04", { today: "2027-02-04" })).toBeNull();
  });

  it("helg och helgdag nekas (samma regel som bokningen av första mötet)", () => {
    expect(problem("2027-01-30")).toEqual({ code: "not_working_day", text: "Dagen är inte en arbetsdag. Välj en vardag." });
    expect(problem("2027-01-31")).toMatchObject({ code: "not_working_day" });
    // Trettondedag jul (onsdag 6 januari 2027) i ett ärende beställt före jul.
    const c = { ...CASE, referredAt: "2026-12-21T09:00", firstMeetingAt: "2027-01-11T10:00" };
    expect(problem("2027-01-06", { c, today: "2027-01-07" })).toEqual({ code: "not_working_day", text: "Trettondedag jul är inte en arbetsdag. Välj en vardag." });
    expect(problem("2027-01-05", { c, today: "2027-01-07" })).toBeNull();
  });

  it("fakturerad eller godkänd månad stoppar – månaden för veckorna från startdatumet till det bokade mötet (torsdagsregeln)", () => {
    // Fredag 29 januari hör till vecka 4, vars torsdag ligger i januari.
    expect(earlyStartMonths(CASE, "2027-01-29")).toEqual(["2027-01", "2027-02"]);
    expect(earlyStartMonths(CASE, "2027-02-03")).toEqual(["2027-02"]);
    const closed: StartChangeBilling = { drafts: [], lines: [], runs: [{ contractId: "c-1", month: "2027-01", status: "closed" }] };
    expect(problem("2027-01-29", { billing: closed })).toEqual({
      code: "invoiced", month: "2027-01", text: "Januari 2027 är redan fakturerad. Ekonomen behöver kreditera fakturan innan insatsen kan starta 29 jan 2027.",
    });
    // Samma körning stoppar inte en start i februari.
    expect(problem("2027-02-03", { billing: closed })).toBeNull();
    const approved: StartChangeBilling = {
      drafts: [{ id: "inv-1", contractId: "c-1", month: "2027-01", kind: "periodic", groupingKey: "avtal", status: "approved" }], lines: [], runs: [],
    };
    expect(problem("2027-01-29", { billing: approved })).toEqual({
      code: "invoiced", month: "2027-01",
      text: "Fakturan för januari 2027 är redan godkänd av ekonomen. Insatsen kan inte starta 29 jan 2027 när månadens faktura är godkänd – kontakta ekonomen.",
    });
    // Ett underlag (draft) och ett annat avtals faktura stoppar inte.
    const draft: StartChangeBilling = { drafts: [{ ...approved.drafts[0], status: "draft" }], lines: [], runs: [{ contractId: "c-2", month: "2027-01", status: "closed" }] };
    expect(problem("2027-01-29", { billing: draft })).toBeNull();
    // Uppehållsveckor faktureras aldrig och låser inte.
    expect(earlyStartMonths({ ...CASE, pausedWeeks: ["2027-W04"] }, "2027-01-29")).toEqual(["2027-02"]);
  });

  it("insatsen startar aldrig före ett möte som deltagaren enligt en registrering inte kom till – senare samma dag går", () => {
    const noShows = [{ caseId: "case-1", meetingAt: "2027-01-29T14:00" }];
    const text = "Det är registrerat att deltagaren inte kom till första mötet 29 jan kl. 14.00. Insatsen kan inte starta före det – välj en senare dag eller ett senare klockslag för mötet.";
    expect(problem("2027-01-28", { noShows })).toEqual({ code: "no_show", text });
    expect(problem("2027-01-29", { noShows, time: "14:00" })).toEqual({ code: "no_show", text });
    expect(problem("2027-01-29", { noShows, time: "10:00" })).toEqual({ code: "no_show", text });
    expect(problem("2027-01-29", { noShows, time: "16:00" })).toBeNull();
    expect(problem("2027-02-01", { noShows })).toBeNull();
    // Ett annat ärendes registrering räknas inte.
    expect(problem("2027-01-28", { noShows: [{ caseId: "case-2", meetingAt: "2027-01-29T14:00" }] })).toBeNull();
  });

  it("ordningen: kommande dag, före beställningen, arbetsdag, fakturerad månad, registreringen", () => {
    const closed: StartChangeBilling = { drafts: [], lines: [], runs: [{ contractId: "c-1", month: "2027-01", status: "closed" }] };
    const noShows = [{ caseId: "case-1", meetingAt: "2027-02-01T09:00" }];
    expect(problem("2027-01-23", { billing: closed, noShows })?.code).toBe("before_order");
    expect(problem("2027-01-30", { billing: closed, noShows })?.code).toBe("not_working_day");
    expect(problem("2027-01-29", { billing: closed, noShows })?.code).toBe("invoiced");
    expect(problem("2027-01-29", { noShows })?.code).toBe("no_show");
  });

  it("dialogens kontroll (earlyStartDateProblem) säger samma sak som servern för datumet", () => {
    for (const day of ["2027-01-26", "2027-01-27", "2027-01-30", "2027-02-02", "2027-02-03", "2027-02-04"]) {
      expect(earlyStartDateProblem(CASE, day, TODAY), day).toEqual(problem(day));
    }
  });
});

describe("plannedEndFrom – planerat slut räknat från startdagen", () => {
  const base = { orderPeriodMonths: null, orderPeriodReason: null, plannedEnd: "2027-08-07", plannedWeeks: 26 };
  it("månader ur avtalet: dagen före samma datum n månader senare", () => {
    const basis = orderPeriodBasis({ ...base, orderPeriodMonths: 6 });
    expect(basis).toEqual({ months: 6, other: false, weeks: 26 });
    expect(plannedEndFrom(basis, "2027-08-07", "2027-02-01")).toBe("2027-07-31");
    expect(plannedEndFrom(orderPeriodBasis({ ...base, orderPeriodMonths: 12 }), "2028-02-07", "2027-02-01")).toBe("2028-01-31");
  });

  it("annan tidsperiod: kommunens slutdatum gäller", () => {
    const basis = orderPeriodBasis({ ...base, orderPeriodReason: "Kortare insats enligt planeringen." });
    expect(basis).toEqual({ months: null, other: true, weeks: 26 });
    expect(plannedEndFrom(basis, "2027-08-07", "2027-02-01")).toBe("2027-08-07");
  });

  it("äldre beställning i veckor: fredagen i sista veckan, räknat från startveckan", () => {
    const basis = orderPeriodBasis({ ...base, plannedEnd: "2027-03-12", plannedWeeks: 6 });
    expect(basis).toEqual({ months: null, other: false, weeks: 6 });
    // Start fredag 29 januari (vecka 4): sex veckor slutar fredag 5 mars.
    expect(plannedEndFrom(basis, "2027-03-12", "2027-01-29")).toBe("2027-03-05");
    expect(plannedEndFrom(basis, "2027-03-12", "2027-02-01")).toBe("2027-03-12");
  });

  it("utan omfattning ligger slutet kvar", () => {
    expect(plannedEndFrom({ months: null, other: false, weeks: null }, null, "2027-02-01")).toBeNull();
  });
});
