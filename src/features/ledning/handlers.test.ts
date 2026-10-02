// Tester för områdets hanterare: ledningsvyns vy-modeller (samma siffror som den gamla prototypen för testdatat
// 1 feb 2027 kl. 09.12), behörighet, pulsens minsta antal och registret över avtalsavvikelser (prototypens cdev.save/cdev.close).
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/api/server";
import { normalizePnr, decodeTestPnr } from "@/data/seed";
import "./handlers";
import {
  alertAck, cdevClose, cdevDetail, cdevMonth, cdevRegister, cdevSave, ledningAreas, ledningCoaches, ledningHead, ledningOverview, ledningPulse,
} from "./api";
import { testRuntime } from "./test-runtime";

let rt: ReturnType<typeof testRuntime>;
beforeEach(() => {
  rt = testRuntime();
});
const karin = () => rt.as("u-karin", "chef");
const sara = () => rt.as("u-sara", "samordnare");
const johan = () => rt.as("u-johan", "avtalsansvarig");

/** Namn och personnummer på deltagare – får aldrig finnas i utskick. */
const pii = () =>
  rt.rows("persons").flatMap((p) => [p.firstName, p.lastName, normalizePnr(decodeTestPnr(p.personnummerEnc))]).filter((x) => x && x.length >= 4);

describe("ledningsvyn", () => {
  it("sidhuvudet: avtal och antal flaggor", async () => {
    expect(await rt.query(ledningHead, {}, karin())).toEqual({ customerName: "Botkyrka kommun", contractNumber: "332026110", alertCount: 11 });
  });

  it("resultat och KPI:er har den gamla prototypens siffror", async () => {
    const d = await rt.query(ledningOverview, {}, karin());
    expect(d.targets).toEqual({ contract: 0.32, internal: 0.35, minN: 10 });
    expect(d.rolling).toMatchObject({ num: 43, den: 127, prelim: 2, excluded: 7, status: "below_internal", minN: 10 });
    expect(d.sinceStart).toMatchObject({ num: 43, den: 127 });
    expect(d.forecast).toEqual({ value: 0.44966442953020136, candidates: 22, withOffer: 4, offerOnly: 0.37404580152671757, prelim: 2 });
    expect(d.trend.map((r) => [r.month, r.num, r.den])).toEqual([["2026-09", 0, 0], ["2026-10", 4, 6], ["2026-11", 7, 34], ["2026-12", 13, 37], ["2027-01", 19, 50]]);
    expect(d.resultDefinitionUnset).toBe(true);
    expect([d.alertCount, d.criticalCount, d.flagAlerts.length, d.escalatedCount]).toEqual([11, 3, 8, 3]);
    // Resultatflaggan först, eskaleringarna inte bland flaggorna (de visas under Tidig uppmärksamhet)
    expect(d.flagAlerts[0].key).toBe("kpi:resultatgrad:internal");
    expect(d.flagAlerts.some((a) => a.kind === "no_progress_escalated")).toBe(false);
    expect(d.flagAlerts.find((a) => a.kind === "unbilled")?.link).toEqual({ href: "/ekonomi", label: "Till faktureringen" });
    expect(d.flagAlerts.find((a) => a.kind === "report_overdue")?.link?.label).toBe("Öppna rapporten");
    // Länkar till ledningsvyn själv visas inte
    expect(d.flagAlerts.find((a) => a.kind === "pulse_low")?.link).toBeNull();
    expect(d.early.map((g) => [g.coachName, g.reminders, g.cases.map((c) => [c.caseNumber, c.streak])])).toEqual([
      ["Amira Haddad", 4, [["BOT-26-0148", 3]]],
      ["Leila Nouri", 3, [["BOT-26-0178", 2]]],
      ["Mats Holm", 4, [["BOT-27-0016", 2]]],
    ]);
    expect(d.sla.rows.map((r) => [r.key, r.num, r.den, r.status])).toEqual([
      ["avrop_besvarade_i_tid", 45, 47, "below_internal"],
      ["forsta_mote_inom_en_vecka", 43, 46, "below_internal"],
      ["veckorapporter_i_tid", 16, 16, "ok"],
      ["manadsrapporter_i_tid", 107, 108, "below_internal"],
    ]);
    expect([d.sla.targetText, d.sla.overdueCount, d.sla.seesSlaStats]).toEqual(["internt mål 100\u00a0%", 1, false]);
    expect(d.unbilled).toMatchObject({ totalOre: 557400, weeks: 4, oldestDays: 57, warningDays: 45 });
    expect(d.unbilled?.cases.map((c) => c.caseNumber)).toEqual(["BOT-26-0117", "BOT-26-0121"]);
    expect(d.cds.open).toBe(2);
    expect(d.cds.warnings).toBe(0);
    expect(d.cds.warningsBeforeTermination).toBe(3);
    expect(d.cds.openPlans.map((x) => x.sla?.label)).toEqual(["Senast 5 feb kl. 16.00", "Senast 12 feb kl. 16.00"]);
    // Kommunens bild: senast levererade beställarrapporten (december) och utkastet för januari
    expect(d.customer.latest).toEqual({ id: "rep-16698", month: "2026-12", deliveredAt: "2027-01-12T10:05" });
    expect(d.customer.rolling).toMatchObject({ num: 24, den: 77 });
    expect(d.customer.next).toEqual({ id: "rep-16699", month: "2027-01" });
    expect(d.customer.nextRolling).toMatchObject({ num: 43, den: 127 });
    expect(d.kpis.map((k) => k.key)).toEqual(["resultatgrad", "avrop_besvarade_i_tid", "forsta_mote_inom_en_vecka", "veckorapporter_i_tid", "manadsrapporter_i_tid", "narvarograd", "nojdhet"]);
    // Vy-modellen innehåller inga hela ärenden (KpiValue.late tas bort)
    expect(JSON.stringify(d)).not.toMatch(/personId|personnummer/);
  });

  it("per coach, per avtalsområde och pulsmätningen", async () => {
    const c = await rt.query(ledningCoaches, {}, karin());
    expect(c.rows.map((r) => [r.name, r.active, r.rr.num, r.rr.den, r.att, r.reg, r.wkOk, r.wk, r.docMedian, r.reminders, r.escalated])).toEqual([
      ["Amira Haddad", 14, 4, 14, 124, 143, 39, 49, 9, 4, 1],
      ["Erik Sjöberg", 20, 14, 31, 176, 203, 55, 66, 8, 2, 0],
      ["Leila Nouri", 16, 9, 32, 187, 208, 53, 67, 8.5, 3, 1],
      ["Mats Holm", 21, 10, 29, 175, 207, 52, 68, 8, 4, 1],
      ["Sofia Grahn", 20, 6, 21, 177, 189, 53, 62, 9, 4, 0],
    ]);
    expect(c.total).toEqual({ active: 91, reminders: 17, escalated: 3, att: 839, reg: 950, wk: 312, wkOk: 252 });
    expect(c.allDoc).toBe(8);
    const a = await rt.query(ledningAreas, {}, karin());
    expect(a.rows).toHaveLength(12);
    expect([a.total, a.monthActive, a.all.num]).toEqual([{ active: 91, closed: 134 }, 134, 43]);
    expect(a.rows.filter((r) => r.rr.den < a.minN).length).toBe(6);
    const p = await rt.query(ledningPulse, {}, karin());
    expect(p.stats).toMatchObject({ invites: 275, responses: 175, q1: [3, 11, 26, 69, 66] });
    expect(p.stats?.priorities[0]).toEqual(["praktik", 45]);
    expect([p.lowOpen, p.contactRequested, p.perCoach.length]).toEqual([1, 3, 5]);
  });

  it("pulsens aggregat lämnas bara ut från minsta antal svar", async () => {
    // Behåll bara fyra svar (avtalets minsta antal är 5)
    const rs = rt.rows("pulse_responses");
    const keep = rs.filter((x) => x.submittedAt >= "2026-11-01").slice(0, 4);
    rs.splice(0, rs.length, ...keep);
    const p = await rt.query(ledningPulse, {}, karin());
    expect(p.enough).toBe(false);
    expect(p.stats).toBeNull();
    expect(p.perCoach.every((x) => x.satisfaction === null && x.support === null && x.responseRate === null)).toBe(true);
  });

  it("bara chef/controller får läsa ledningsvyn", async () => {
    for (const actor of [rt.as("u-amira", "coach"), sara(), johan(), rt.as("k-eva", "kommun_chef"), rt.as("u-lars", "ekonom")]) {
      await expect(rt.query(ledningOverview, {}, actor)).rejects.toBeInstanceOf(ApiError);
    }
  });

  it("skyddade personuppgifter syns aldrig i ledningens vy-modeller", async () => {
    const prot = rt.rows("persons").filter((x) => x.protectedIdentity);
    expect(prot.length).toBeGreaterThan(0);
    const all = JSON.stringify([
      await rt.query(ledningOverview, {}, karin()), await rt.query(ledningCoaches, {}, karin()), await rt.query(ledningAreas, {}, karin()), await rt.query(ledningPulse, {}, karin()),
    ]);
    for (const x of prot) {
      expect(all).not.toContain(x.lastName);
      expect(all).not.toContain(normalizePnr(decodeTestPnr(x.personnummerEnc)));
    }
  });

  it("kvittera resultatflaggan och en eskalering (alert.ack)", async () => {
    expect(await rt.command(alertAck, { key: "kpi:resultatgrad:internal", plan: "Genomgång torsdag." }, karin())).toEqual({ ok: true });
    expect(await rt.command(alertAck, { key: "noprog_esc:case-260148:2027-W04", plan: "Avstämning med coachen." }, karin())).toEqual({ ok: true });
    const d = await rt.query(ledningOverview, {}, karin());
    expect(d.rrAlert).toBeNull();
    expect(d.rrAckAt).toBe("2027-02-01T09:13");
    expect([d.alertCount, d.flagAlerts.length, d.acked.length]).toEqual([9, 7, 2]);
    expect(d.acked.find((a) => a.key === "kpi:resultatgrad:internal")?.ack).toEqual({ byName: "Karin Wallin", at: "2027-02-01T09:13", plan: "Genomgång torsdag." });
    expect(d.early[0].cases[0].ack).toEqual({ byName: "Karin Wallin", at: "2027-02-01T09:14", plan: "Avstämning med coachen." });
    expect(rt.rows("audit_log").filter((l) => l.action === "alert.acknowledged")).toHaveLength(2);
    expect((await rt.query(ledningHead, {}, karin())).alertCount).toBe(9);
  });
});

describe("avtalsavvikelser", () => {
  it("registret: rader, nyckeltal, trappan och formulärets val från avtalskonfigurationen", async () => {
    const r = await rt.query(cdevRegister, {}, karin());
    expect(r.rows.map((x) => [x.id, x.statusKey])).toEqual([["cd-3", "waiting"], ["cd-2", "in_progress"], ["cd-1", "closed"]]);
    expect(r.counts).toEqual({ open: 2, openComplaints: 1, waiting: 1, warnings: 0, penaltiesOre: 0 });
    expect([r.stepCounts, r.maxStep]).toEqual([{ 0: 1, 1: 1 }, 1]);
    expect(r.aptMonths).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(r.form.ladder).toHaveLength(5);
    expect(r.form.penalties).toEqual({ deviationOre: 2500000, insufficientInformationOre: 2500000 });
    expect(r.form.owners[0]).toEqual({ value: "u-sara", label: "Sara Lindqvist – Operativ samordnare" });
    expect([r.form.defaultOwnerId, r.form.canManage, r.form.caseNumberExample]).toEqual(["u-karin", true, "BOT-26-0042"]);
    expect((await rt.query(cdevRegister, {}, sara())).form.canManage).toBe(false);
    await expect(rt.query(cdevRegister, {}, rt.as("u-amira", "coach"))).rejects.toBeInstanceOf(ApiError);
  });

  it("registrera: obligatoriska fält, okänt ärende, vite från konfigurationen och notis utan personuppgifter", async () => {
    const before = rt.rows("contract_deviations").length;
    const missing = await rt.command(cdevSave, { data: { description: "" } }, karin());
    expect(missing).toMatchObject({ ok: false, error: "missing" });
    expect(Object.keys((missing as { fields: object }).fields)).toEqual(["type", "level", "source", "description"]);
    const base = { type: "klagomål" as const, source: "arbetsgivare" as const, level: "större" as const, escalationStep: 1, raisedOn: "2027-02-01", description: "Arbetsgivaren fick ingen information om ändrade praktiktider vecka 5." };
    expect(await rt.command(cdevSave, { data: { ...base, caseNumber: "BOT-99-9999" } }, karin())).toMatchObject({ ok: false, error: "case_not_found", message: "Hittar inget ärende med det numret. Skriv till exempel BOT-26-0042." });
    expect(await rt.command(cdevSave, { data: { ...base, escalationStep: 0, warningIssued: true } }, karin())).toMatchObject({ ok: false, error: "warning_step" });
    expect(rt.rows("contract_deviations")).toHaveLength(before);
    expect(rt.now()).toBe("2027-02-01T09:12");

    const out0 = rt.rows("outbound_messages").length;
    const res = await rt.command(
      cdevSave,
      { data: { ...base, caseNumber: "bot-26-0143", actionPlan: "Samordnaren informerar arbetsgivaren skriftligt.", actionPlanDue: "2027-02-19", ownerId: "u-sara", penaltyKind: "information", penaltyOffsetMonth: "2027-03" } },
      karin(),
    );
    expect(res).toMatchObject({ ok: true, sentToCustomer: true });
    const cd = rt.rows("contract_deviations").find((x) => x.id === (res as { id: string }).id);
    expect(cd).toMatchObject({
      contractId: "c-bot", type: "klagomål", source: "arbetsgivare", level: "större", escalationStep: 1, caseId: "case-260143", raisedAt: "2027-02-01T09:13", registeredBy: "u-karin",
      actionPlanDue: "2027-02-19", ownerId: "u-sara", status: "action_plan", planSubmittedAt: "2027-02-01T09:13", customerApprovedAt: null,
      penaltyKind: "information", penaltyOre: 2500000, penaltyOffsetMonth: "2027-03", warningIssued: false,
    });
    const msgs = rt.rows("outbound_messages").slice(out0);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ to: "eva.bergstrom@botkyrka.se", template: "atgardsplan_godkannande", caseId: null });
    expect(msgs[0].body).toBe("En åtgärdsplan inom avtalet med Miljonbemanning väntar på ert godkännande. Logga in i portalen för att läsa den.");
    for (const x of pii()) expect(msgs[0].body).not.toContain(x);
    expect(rt.rows("audit_log").at(-1)).toMatchObject({ action: "contract_deviation.created", entity: "contract_deviation", entityId: cd?.id, contractId: "c-bot" });
  });

  it("ändrad plan skickas för nytt godkännande; varning och markera klar", async () => {
    // cd-2 är godkänd av kommunen – en ändrad plan kräver nytt godkännande
    const out0 = rt.rows("outbound_messages").length;
    expect(await rt.command(cdevSave, { id: "cd-2", data: { actionPlan: "Ny plan: genomgång varje månad.", actionPlanDue: "2027-02-26" } }, johan())).toMatchObject({ ok: true, sentToCustomer: true });
    expect(rt.rows("contract_deviations").find((x) => x.id === "cd-2")).toMatchObject({ customerApprovedAt: null, customerApprovedBy: null, status: "action_plan", actionPlanDue: "2027-02-26" });
    expect(rt.rows("outbound_messages").length).toBe(out0 + 1);
    // Samma plan igen skickas inte
    expect(await rt.command(cdevSave, { id: "cd-2", data: { actionPlan: "Ny plan: genomgång varje månad." } }, johan())).toMatchObject({ ok: true, sentToCustomer: false });

    expect(await rt.command(cdevSave, { id: "cd-2", data: { warningIssued: true, penaltyKind: "deviation" } }, sara())).toMatchObject({ ok: false, error: "forbidden" });
    expect(await rt.command(cdevSave, { id: "cd-2", data: { escalationStep: 1, warningIssued: true, penaltyKind: "deviation", orderStop: false } }, karin())).toMatchObject({ ok: true });
    const d = await rt.query(cdevDetail, { id: "cd-2" }, karin());
    expect(d.found && [d.cd.warningIssued, d.cd.warningIssuedAt, d.cd.penaltyOre, d.totalWarnings]).toEqual([true, "2027-02-01T09:15", 2500000, 1]);

    expect(await rt.command(cdevClose, { id: "cd-2", lessons: "  " }, karin())).toMatchObject({ ok: false, error: "lessons" });
    expect(await rt.command(cdevClose, { id: "cd-2", lessons: "Observation krävs från nivå 1." }, karin())).toEqual({ ok: true, id: "cd-2" });
    expect(rt.rows("contract_deviations").find((x) => x.id === "cd-2")).toMatchObject({ status: "closed", closedAt: "2027-02-01T09:16", closedBy: "u-karin", lessons: "Observation krävs från nivå 1." });
    expect(rt.rows("audit_log").at(-1)).toMatchObject({ action: "contract_deviation.closed", details: { hadCustomerApproval: false } });
    expect(await rt.query(cdevDetail, { id: "finns-inte" }, karin())).toEqual({ found: false });
  });

  it("detaljvyn och månadssammanställningen för APT", async () => {
    const d = await rt.query(cdevDetail, { id: "cd-2" }, sara());
    expect(d.found && [d.cd.statusKey, d.cd.approvedByName, d.customerChefName, d.planDue?.sla.label, d.form.canManage]).toEqual([
      "in_progress", "Eva Bergström", "Eva Bergström", "Senast 5 feb kl. 16.00", false,
    ]);
    const m = await rt.query(cdevMonth, { month: "2027-01" }, karin());
    expect([m.createdCount, m.complaints, m.openAtEnd, m.closed, m.participantDeviations, m.warnings, m.penaltiesOre]).toEqual([2, 1, 2, 0, 2, 0, 0]);
    expect(m.items.map((x) => [x.id, x.isNew])).toEqual([["cd-2", true], ["cd-3", true]]);
    expect(m.text.split("\n").slice(0, 4)).toEqual([
      "Månadssammanställning avtalsavvikelser och klagomål – januari 2027",
      "Avtal 332026110, Botkyrka kommun",
      "",
      "Nya under månaden: 2 (varav klagomål: 1)",
    ]);
    expect(m.text).toContain("Skriftliga varningar hittills: 0 av 3");
    expect(m.text).toContain("Viten hittills: 0\u00a0kr");
    const nov = await rt.query(cdevMonth, { month: "2026-11" }, karin());
    expect([nov.createdCount, nov.closed, nov.lessons.map((x) => x.lessons)]).toEqual([1, 1, ["Automatisk eskalering infördes."]]);
  });
});
