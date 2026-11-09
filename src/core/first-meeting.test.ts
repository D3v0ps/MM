// Deltagaren kom inte till första mötet (Karims beslut 2026-11-09): när det går, vad som stoppar och texterna.
import { describe, expect, it } from "vitest";
import type { Case, FirstMeetingNoShow } from "@/data/schema";
import {
  canRegisterNoShow, currentNoShow, earliestStartDay, firstBookedMeetingAt, firstMeetingBookingProblem, firstMeetingPassed, lastNoShowDay, noShowOpen, noShowProblem, noShowSentence,
  noShowStartProblem, noShowTitle,
} from "./first-meeting";

const MEETING = "2027-01-29T14:00";
const c = (patch: Partial<Case> = {}): Pick<Case, "id" | "status" | "startDate" | "firstMeetingAt"> => ({ id: "case-1", status: "confirmed", startDate: null, firstMeetingAt: MEETING, ...patch });
const reg = (patch: Partial<FirstMeetingNoShow> = {}): Pick<FirstMeetingNoShow, "caseId" | "meetingAt"> => ({ caseId: "case-1", meetingAt: MEETING, ...patch });
const problem = (o: Partial<Parameters<typeof noShowProblem>[0]> = {}) =>
  noShowProblem({ c: c(), now: "2027-02-01T09:12", meetingAt: MEETING, kind: "uteblev", reason: null, rows: [], ...o })?.code ?? null;

describe("när det går", () => {
  it("bara i ett bekräftat ärende utan startdatum", () => {
    expect(noShowOpen(c())).toBe(true);
    for (const status of ["received", "acknowledged", "active", "paused", "closed", "declined"] as const) expect(noShowOpen(c({ status })), status).toBe(false);
    expect(noShowOpen(c({ startDate: "2027-02-01" }))).toBe(false);
  });

  it("mötet har varit när tiden har kommit – Stockholms tid, samma minut räknas", () => {
    expect(firstMeetingPassed(c(), "2027-01-29T13:59")).toBe(false);
    expect(firstMeetingPassed(c(), MEETING)).toBe(true);
    expect(firstMeetingPassed(c(), "2027-02-01T09:12")).toBe(true);
    expect(firstMeetingPassed(c({ firstMeetingAt: null }), "2027-02-01T09:12")).toBe(false);
  });

  it("registreringen gäller ärendets nuvarande första möte – ett ombokat möte har ingen", () => {
    expect(currentNoShow(c(), [reg()])).toEqual(reg());
    expect(currentNoShow(c({ firstMeetingAt: "2027-02-03T10:00" }), [reg()])).toBeNull();
    expect(currentNoShow(c(), [reg({ caseId: "case-2" })])).toBeNull();
    expect(currentNoShow(c({ firstMeetingAt: null }), [reg()])).toBeNull();
  });

  it("knappen: öppet ärende, mötet har varit och inget registrerat", () => {
    const now = "2027-02-01T09:12";
    expect(canRegisterNoShow(c(), now, [])).toBe(true);
    expect(canRegisterNoShow(c(), now, [reg()])).toBe(false);
    expect(canRegisterNoShow(c(), "2027-01-29T13:00", [])).toBe(false);
    expect(canRegisterNoShow(c({ status: "active", startDate: "2027-01-29" }), now, [])).toBe(false);
    // Efter en ombokning: det nya mötet kan registreras när det har varit.
    expect(canRegisterNoShow(c({ firstMeetingAt: "2027-02-01T09:00" }), now, [reg()])).toBe(true);
  });
});

describe("noShowProblem – vad som stoppar", () => {
  it("godkänt: uteblev utan orsak, giltig frånvaro med orsak, orsak med 300 tecken", () => {
    expect(problem()).toBeNull();
    expect(problem({ kind: "giltig", reason: "Sjuk enligt handläggaren." })).toBeNull();
    expect(problem({ reason: "x".repeat(300) })).toBeNull();
  });

  it("ärendet: startat, avslutat, inte accepterat, med startdatum och utan möte", () => {
    expect(problem({ c: c({ status: "active", startDate: "2027-01-29" }) })).toBe("wrong_status");
    expect(problem({ c: c({ status: "closed" }) })).toBe("wrong_status");
    expect(problem({ c: c({ status: "acknowledged", firstMeetingAt: null }) })).toBe("wrong_status");
    expect(problem({ c: c({ startDate: "2027-02-01" }) })).toBe("wrong_status");
    expect(problem({ c: c({ firstMeetingAt: null }) })).toBe("no_meeting");
  });

  it("mötet: bokat om under tiden (conflict), inte varit än och redan registrerat", () => {
    expect(problem({ meetingAt: "2027-01-28T14:00" })).toBe("conflict");
    expect(problem({ now: "2027-01-29T13:59" })).toBe("not_passed");
    expect(problem({ rows: [reg()] })).toBe("already");
  });

  it("orsaken: krävs vid giltig frånvaro (inte bara blanksteg), högst 300 tecken och inga personnummer", () => {
    expect(problem({ kind: "giltig", reason: null })).toBe("reason");
    expect(problem({ kind: "giltig", reason: "  \n " })).toBe("reason");
    expect(problem({ reason: "x".repeat(301) })).toBe("reason");
    expect(problem({ kind: "giltig", reason: "Sjuk, 19900101-1234" })).toBe("pnr");
    expect(problem({ reason: "Personnummer 900101-1234 i texten" })).toBe("pnr");
  });
});

describe("startdatumet efter en registrering (Karims beslut 2026-11-09, triggern cases_start_date_no_show_guard)", () => {
  it("aldrig på eller före en dag då deltagaren inte kom – det nya mötets dag föreslås, och bokades det samma dag nästa arbetsdag", () => {
    const rows = [reg(), reg({ caseId: "case-2", meetingAt: "2027-02-10T10:00" })];
    expect(lastNoShowDay("case-1", rows)).toBe("2027-01-29");
    expect(lastNoShowDay("case-3", rows)).toBeNull();
    // Inget registrerat: första mötets dag som förut.
    expect(earliestStartDay(c(), [])).toBe("2027-01-29");
    // Nytt möte onsdag 3 februari: den dagen.
    expect(earliestStartDay(c({ firstMeetingAt: "2027-02-03T10:00" }), rows)).toBe("2027-02-03");
    // Nytt möte samma fredag kl. 16.00: nästa arbetsdag (måndag) – aldrig fredagen och ingen helgdag.
    expect(earliestStartDay(c({ firstMeetingAt: "2027-01-29T16:00" }), rows)).toBe("2027-02-01");
    expect(earliestStartDay(c({ firstMeetingAt: null }), rows)).toBeNull();
    expect(noShowStartProblem("case-1", "2027-01-29", rows)).toBe("Startdatumet måste vara efter 29 jan 2027 – deltagaren kom inte till första mötet den dagen.");
    expect(noShowStartProblem("case-1", "2027-01-28", rows)).not.toBeNull();
    expect(noShowStartProblem("case-1", "2027-01-30", rows)).toBeNull();
    expect(noShowStartProblem("case-3", "2027-01-29", rows)).toBeNull();
  });
});

describe("nyckeltalet räknar det första bokade mötet (Karims beslut 2026-11-09)", () => {
  it("det tidigaste mötet som deltagaren inte kom till – annars ärendets första möte; bara ärendets egna", () => {
    const now = c({ firstMeetingAt: "2027-02-10T10:00" });
    expect(firstBookedMeetingAt(now, [reg({ meetingAt: "2027-02-03T10:00" }), reg(), reg({ caseId: "case-2", meetingAt: "2027-01-20T10:00" })])).toBe(MEETING);
    expect(firstBookedMeetingAt(now, [])).toBe("2027-02-10T10:00");
    expect(firstBookedMeetingAt(c({ firstMeetingAt: null }), [])).toBeNull();
  });
});

describe("bokningen av första mötet (alla roller)", () => {
  const order = { referredAt: "2027-01-25T10:00", firstMeetingAt: "2027-02-03T10:00" };
  const code = (at: string, now = "2027-02-01T09:12", o: Pick<Case, "referredAt" | "firstMeetingAt"> = order) => firstMeetingBookingProblem(o, at, now)?.code ?? null;
  it("en arbetsdag som inte har passerat, inte före beställningen och inte samma tid som det bokade mötet", () => {
    expect(code("2027-02-04T10:00")).toBeNull();
    expect(code("2027-02-01T09:12")).toBe("past");
    expect(code("2027-01-29T14:00")).toBe("past");
    expect(code("2027-02-03T10:00")).toBe("same_time");
    expect(code("2027-02-03T10:30")).toBeNull();
    expect(code("2027-02-06T10:00")).toBe("not_working_day");
    expect(code("2027-03-29T10:00")).toBe("not_working_day"); // annandag påsk
    expect(firstMeetingBookingProblem(order, "2027-03-29T10:00", "2027-02-01T09:12")?.text).toBe("Annandag påsk är inte en arbetsdag. Välj en vardag.");
    // Före beställningens dag (en klocka före beställningen – t.ex. en beställning med framtida tid).
    expect(code("2027-01-22T10:00", "2027-01-20T08:00")).toBe("before_order");
    expect(code("2027-01-25T08:00", "2027-01-20T08:00")).toBeNull();
    // Inget bokat möte: ingen jämförelse med en tidigare tid.
    expect(code("2027-02-03T10:00", "2027-02-01T09:12", { referredAt: order.referredAt, firstMeetingAt: null })).toBeNull();
  });
});

describe("texterna", () => {
  it("kortets ruta och tidslinjen: datum och tid i Stockholms tid", () => {
    expect(noShowTitle(MEETING)).toBe("Kom inte till första mötet 29 jan kl. 14.00");
    expect(noShowSentence({ meetingAt: MEETING, kind: "uteblev" })).toBe("Kom inte till första mötet 29 jan kl. 14.00 – uteblev utan att meddela.");
    expect(noShowSentence({ meetingAt: "2026-11-02T10:00", kind: "giltig" })).toBe("Kom inte till första mötet 2 nov kl. 10.00 – giltig frånvaro.");
  });
});
