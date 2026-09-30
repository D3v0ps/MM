import { describe, expect, it } from "vitest";
import {
  addWithin, avropDue, finalReportDueAt, finalReportWorkingDays, firstMeetingDays, firstMeetingDue, isProvisionalDue, monthlyReportDueAt, slaDue, slaStatus,
} from "./sla";
import { cfgWith, mkCase, testEnv } from "./test-data";

const env = testEnv();
const cfg = env.cfg;

describe("svar på avrop inom en arbetsdag (arbetsdagar med svenska helgdagar)", () => {
  it("vanlig vardag: nästa dag samma klockslag", () => {
    expect(avropDue(mkCase({ id: "c", referredAt: "2027-01-12T15:35" }), cfg)).toBe("2027-01-13T15:35");
  });
  it("över helgen: fredag -> måndag", () => {
    expect(avropDue(mkCase({ id: "c", referredAt: "2027-01-29T15:20" }), cfg)).toBe("2027-02-01T15:20");
    expect(avropDue(mkCase({ id: "c", referredAt: "2027-01-30T11:00" }), cfg)).toBe("2027-02-01T11:00");
  });
  it("över helgdag: trettondedag jul och julen", () => {
    expect(avropDue(mkCase({ id: "c", referredAt: "2027-01-05T10:00" }), cfg)).toBe("2027-01-07T10:00");
    expect(avropDue(mkCase({ id: "c", referredAt: "2026-12-23T09:00" }), cfg)).toBe("2026-12-28T09:00");
  });
  it("över påsken: skärtorsdag -> tisdag efter annandag påsk", () => {
    expect(avropDue(mkCase({ id: "c", referredAt: "2027-03-25T12:00" }), cfg)).toBe("2027-03-30T12:00");
  });
  it("regeln är ej fastställd -> ingen förfallotid", () => {
    const unset = cfgWith((c) => { c.sla = c.sla.map((r) => (r.key === "avrop_svar" ? { ...r, within: "ATT_FASTSTÄLLA" } : r)); });
    expect(avropDue(mkCase({ id: "c" }), unset)).toBeNull();
  });
});

describe("övriga tidsgränser", () => {
  it("första möte inom sju kalenderdagar", () => {
    expect(firstMeetingDue(mkCase({ id: "c", referredAt: "2027-01-26T10:40" }), cfg)).toBe("2027-02-02T10:40");
    expect(firstMeetingDays(cfg)).toBe(7);
  });
  it("minuter, arbetsdagar och kalenderdagar", () => {
    expect(addWithin("2027-02-01T09:12", { minutes: 5 })).toBe("2027-02-01T09:17");
    expect(addWithin("2027-02-05T09:12", { workingDays: 2 })).toBe("2027-02-09T09:12");
    expect(addWithin("2027-02-05T09:12", { days: 2 })).toBe("2027-02-07T09:12");
    expect(slaDue(cfg, "ordererkannande", "2027-02-01T09:12")).toBe("2027-02-01T09:17");
    expect(slaDue(cfg, "finns_inte", "2027-02-01T09:12")).toBeNull();
  });
  it("slutrapport: förslaget 5 arbetsdagar efter avslut (ej fastställt)", () => {
    expect(finalReportWorkingDays(cfg)).toBe(5);
    expect(finalReportDueAt(cfg, "2027-01-22")).toBe("2027-01-29T23:59");
    expect(isProvisionalDue(cfg, "final")).toBe(true);
    const fixed = cfgWith((c) => { c.sla = c.sla.map((r) => (r.key === "slutrapport" ? { ...r, within: { workingDays: 3 } } : r)); });
    expect(finalReportWorkingDays(fixed)).toBe(3);
    expect(isProvisionalDue(fixed, "final")).toBe(false);
  });
  it("månadsrapport: förslaget 5:e arbetsdagen efter månadsskiftet (ej fastställt)", () => {
    expect(monthlyReportDueAt(cfg, "2027-01")).toBe("2027-02-05T23:59");
    // December: 1 januari och trettondedagen är helgdagar
    expect(monthlyReportDueAt(cfg, "2026-12")).toBe("2027-01-11T23:59");
    expect(isProvisionalDue(cfg, "monthly")).toBe(true);
    expect(isProvisionalDue(cfg, "customer_summary")).toBe(true);
    expect(isProvisionalDue(cfg, "weekly_attendance")).toBe(false);
  });
});

describe("SLA-status (klockan 1 februari 2027 kl. 09.12)", () => {
  it("snart, brådskande, i god tid och försenad", () => {
    expect(slaStatus("2027-02-01T10:05", null, env)).toEqual({ label: "53 min kvar", tone: "urgent", minutes: 53 });
    expect(slaStatus("2027-02-01T11:12", null, env)).toEqual({ label: "2 tim kvar", tone: "urgent", minutes: 120 });
    expect(slaStatus("2027-02-01T15:20", null, env)).toEqual({ label: "6 tim kvar", tone: "soon", minutes: 368 });
    expect(slaStatus("2027-02-02T08:41", null, env)).toEqual({ label: "Senast 2 feb kl. 08.41", tone: "ok", minutes: 1409 });
    expect(slaStatus("2027-01-29T23:59", null, env)).toEqual({ label: "Försenad 2 dagar", tone: "over", minutes: -3433 });
  });
  it("klar i tid eller sent", () => {
    expect(slaStatus("2027-02-01T10:00", "2027-02-01T09:40", env)).toEqual({ label: "I tid", tone: "met", minutes: 0 });
    expect(slaStatus("2027-02-01T10:00", "2027-02-01T12:25", env)).toEqual({ label: "Sent (2 tim 25 min)", tone: "over", minutes: 0 });
  });
});
