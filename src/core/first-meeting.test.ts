// Deltagaren kom inte till första mötet (Karims beslut 2026-11-09): när det går, vad som stoppar och texterna.
import { describe, expect, it } from "vitest";
import type { Case, FirstMeetingNoShow } from "@/data/schema";
import {
  acceptDefaultDate, FIRST_MEETING_DEFAULT_TIME,
  canRegisterNoShow, currentNoShow, firstBookedMeetingAt, firstMeetingBookingProblem, firstMeetingPassed, noShowOpen, noShowProblem, noShowSentence, noShowStartText,
  noShowTitle,
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

describe("starta insatsen efter en registrering (Karims beslut 2026-11-09, triggern cases_start_date_no_show_guard)", () => {
  it("bara ärendets nuvarande första möte stoppar – ett nytt möte samma dag kan startas den dagen", () => {
    // Det registrerade mötet är ärendets första möte: Starta insatsen nekas med texten.
    expect(currentNoShow(c(), [reg()])).toEqual(reg());
    expect(noShowStartText(reg())).toBe("Deltagaren kom inte till första mötet 29 jan kl. 14.00. Boka ett nytt första möte innan insatsen startar – eller avsluta insatsen om deltagaren aldrig kom.");
    // Nytt möte samma fredag kl. 16.00 eller en annan dag: ingen registrering för det – den vanliga regeln gäller.
    expect(currentNoShow(c({ firstMeetingAt: "2027-01-29T16:00" }), [reg()])).toBeNull();
    expect(currentNoShow(c({ firstMeetingAt: "2027-02-03T10:00" }), [reg()])).toBeNull();
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
  it("en arbetsdag som inte har passerat, inte före beställningen och inte samma tid som det bokade mötet (accept: utan bokat möte)", () => {
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

describe("acceptdialogens förvalda datum (Karims beslut 2026-11-11)", () => {
  // Måndag 1 februari 2027 kl. 09.12 (demoklockan). Beställd fredag 29 januari.
  const NOW = "2027-02-01T09:12";
  const ORDER = "2027-01-29T10:05";
  const d = (desiredStart: string | null, now = NOW, referredAt = ORDER) => acceptDefaultDate({ desiredStart, referredAt, now });

  it("kommunens önskade start när den går att boka", () => {
    expect(d("2027-02-08")).toBe("2027-02-08");
    expect(d("2027-02-03")).toBe("2027-02-03");
    // I dag före det förvalda klockslaget 10.00 går också.
    expect(d("2027-02-01")).toBe("2027-02-01");
  });

  it("utan önskad start: två arbetsdagar fram, som förut", () => {
    expect(d(null)).toBe("2027-02-03");
  });

  it("en helg eller helgdag ger första arbetsdagen efter", () => {
    expect(d("2027-02-06")).toBe("2027-02-08"); // lördag → måndag
    expect(d("2027-01-06", "2027-01-05T08:00", "2027-01-04T08:00")).toBe("2027-01-07"); // trettondedag jul → torsdag
    expect(d("2027-03-26", "2027-03-22T08:00", "2027-03-22T08:00")).toBe("2027-03-30"); // långfredag och påskhelgen → tisdag
  });

  it("en önskad start som har passerat ger i dag, eller nästa arbetsdag när klockslaget har passerat", () => {
    expect(d("2027-01-27")).toBe("2027-02-01");
    expect(d("2027-01-27", "2027-02-01T10:00")).toBe("2027-02-02");
    expect(d("2027-02-01", "2027-02-01T14:30")).toBe("2027-02-02");
    // Fredag eftermiddag → måndag.
    expect(d("2027-01-29", "2027-01-29T15:00", "2027-01-28T08:00")).toBe("2027-02-01");
  });

  it("aldrig före beställningens dag", () => {
    expect(d("2027-01-20", "2027-01-18T08:00", "2027-01-25T08:00")).toBe("2027-01-25");
  });

  it("dagen går alltid att boka enligt serverns regel", () => {
    for (const ds of ["2027-01-01", "2027-01-30", "2027-02-01", "2027-02-05", "2027-02-06", "2027-02-28", "2027-04-02", null]) {
      for (const now of ["2027-02-01T06:00", "2027-02-01T09:59", "2027-02-01T10:00", "2027-02-05T17:00"]) {
        const day = d(ds, now);
        expect(firstMeetingBookingProblem({ referredAt: ORDER, firstMeetingAt: null }, `${day}T${FIRST_MEETING_DEFAULT_TIME}`, now), `${ds} ${now}`).toBeNull();
      }
    }
  });
});
