// En månad utan månadsrapport (färre inskrivna dagar än avtalets reportSchedule.monthly.minEnrolledDays, Botkyrka 11): samma regel
// (needsAssessment) på deltagarkortets flik Månadsunderlag, sidan Månadsbedömning, coachens sparning och AI-utkastet. Kortet ber
// aldrig om en bedömning som servern nekar – och allt kortet ber om går att spara. Testdatat i minnet (MemoryRuntime, samma
// hanterare som appen), demoklockan måndag 1 februari 2027.
import { beforeEach, describe, expect, it } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { requireOperational } from "@/core/config";
import { needsAssessment } from "@/core/report-schedule";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import { newAssessment } from "@/features/_shared/rows";
import { assessmentPage, assessmentSave, monthlyDraft } from "@/features/coach/api";
import { caseMonthBasis } from "./api";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
const as = (userId: string, role: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && x.actor.role === role);
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
type Res = { ok: boolean; error?: string; message?: string; status?: string };
const cmd = (key: string, input: unknown, actor: Actor) => rt.run("command", key, input, actor) as Promise<Res>;
const amira = () => as("u-amira", "coach");
const erik = () => as("u-erik", "coach");
const raw = () => rt.raw();
const MIN = requireOperational(SEED.contracts.find((c) => c.id === "c-bot")!.config).reportSchedule?.monthly?.minEnrolledDays;

/** Startade måndag 25 januari 2027: 7 inskrivna dagar i januari – ingen månadsrapport för januari. Inget samtycke till AI. */
const JAN25 = "case-270027";
/** Samma start (25 januari), samtycke till AI. */
const JAN25_AI = "case-270024";
/** Avslutades fredag 1 januari 2027: en inskriven dag i januari. */
const CLOSED_JAN1 = "case-260057";
const NOT_NEEDED_SAVE = "Januari 2027 har för få inskrivna dagar för en månadsbedömning. Månaden får ingen månadsrapport. Ladda om sidan – inget har sparats.";

describe("månad utan månadsrapport – samma regel överallt (needsAssessment)", () => {
  it("testdatat: Botkyrkas gräns är 11 dagar, och januari har för få dagar för båda startärendena", () => {
    expect(MIN).toBe(11);
    for (const id of [JAN25, JAN25_AI]) expect(needsAssessment(raw().get("cases", id)!, "2027-01", MIN), id).toBe(false);
    expect(needsAssessment(raw().get("cases", JAN25)!, "2027-02", MIN)).toBe(true);
  });

  it("BOT-27-0027 (start 25 januari): kortet ber inte om januaribedömningen – februari visas, januari säger Ingen månadsrapport", async () => {
    // Förr: "Januari 2027 är inte påbörjad" med Påbörja bedömningen – sparningen svarade sedan not_needed och varningen stod kvar.
    const b = (await q(caseMonthBasis, { caseId: JAN25 }, amira()))!;
    expect(b).toMatchObject({ month: "2027-02", missingMonth: null, noReport: null, beforeStart: false, delivered: null });
    expect(b.gaps).not.toBeNull();
    expect(b.months.map((m) => m.month)).toEqual(["2027-02", "2027-01"]);
    const jan = (await q(caseMonthBasis, { caseId: JAN25, manad: "2027-01" }, amira()))!;
    expect(jan).toMatchObject({ month: "2027-01", noReport: { enrolledDays: 7, minDays: 11, assessment: false }, gaps: null, doc: null, delivered: null, reportId: null });
  });

  it("sidan Månadsbedömning visar talen i stället för formuläret, och sparningen nekar med samma regel (utan text om startdatum)", async () => {
    const page = await q(assessmentPage, { caseId: JAN25, month: "2027-01" }, amira());
    expect(page).toMatchObject({ kind: "ok", month: "2027-01", notNeeded: { enrolledDays: 7, minDays: 11 } });
    // Februari behöver bedömningen: formuläret som vanligt.
    expect(await q(assessmentPage, { caseId: JAN25, month: "2027-02" }, amira())).toMatchObject({ kind: "ok", notNeeded: null });
    // En flik som ändå sparar (öppnad med en äldre version av sidan): nekas, inget skapas.
    const save = await cmd(assessmentSave.key, { caseId: JAN25, month: "2027-01", summary: "Första veckan", autosave: true, editSession: "abcdefabcdef12", expectedVersion: 0 }, amira());
    expect(save).toMatchObject({ ok: false, error: "not_needed", message: NOT_NEEDED_SAVE });
    expect(raw().all("monthly_assessments").filter((m) => m.caseId === JAN25)).toEqual([]);
  });

  it("BOT-26-0057 (avslutad 1 januari): januari får ingen månadsrapport – ingen knapp Gör månadsbedömningen", async () => {
    const b = (await q(caseMonthBasis, { caseId: CLOSED_JAN1 }, erik()))!;
    expect(b).toMatchObject({ month: "2027-01", missingMonth: null, noReport: { enrolledDays: 1, minDays: 11, assessment: false }, gaps: null, doc: null });
    expect(await q(assessmentPage, { caseId: CLOSED_JAN1, month: "2027-01" }, erik())).toMatchObject({ kind: "ok", notNeeded: { enrolledDays: 1, minDays: 11 } });
    // December behöver sin rapport (levererad eller underlaget) – inte "Ingen månadsrapport".
    expect((await q(caseMonthBasis, { caseId: CLOSED_JAN1, manad: "2026-12" }, erik()))!.noReport).toBeNull();
  });

  it("AI-utkast för en månad utan månadsrapport: not_needed – ingen AI-körning, inget jobb och inget fel i loggen", async () => {
    expect(raw().get("cases", JAN25_AI)!.aiConsentStatus).toBe("given");
    const runs = raw().all("ai_runs").length;
    const jobs = raw().all("jobs").length;
    const logs = raw().all("audit_log").length;
    const r = await cmd(monthlyDraft.key, { caseId: JAN25_AI, month: "2027-01" }, amira());
    expect(r).toMatchObject({
      ok: false, error: "not_needed", message: "Januari 2027 har för få inskrivna dagar för en månadsbedömning. Månaden får ingen månadsrapport, och inget AI-utkast har gjorts.",
    });
    expect([raw().all("ai_runs").length, raw().all("jobs").length, raw().all("audit_log").length]).toEqual([runs, jobs, logs]);
    expect(raw().all("monthly_assessments").filter((m) => m.caseId === JAN25_AI)).toEqual([]);
    // Februari (behöver bedömningen): utkastet görs.
    expect(await cmd(monthlyDraft.key, { caseId: JAN25_AI, month: "2027-02" }, amira())).toMatchObject({ ok: true });
  });

  it("en bedömning som redan finns i en sådan månad (sparad innan kortet följde regeln) går att öppna och spara", async () => {
    rt.store.insertRow("monthly_assessments", { ...newAssessment({ id: "ma-t-jan25", caseId: JAN25, month: "2027-01" }), version: 1 });
    const jan = (await q(caseMonthBasis, { caseId: JAN25, manad: "2027-01" }, amira()))!;
    expect(jan.noReport).toEqual({ enrolledDays: 7, minDays: 11, assessment: true });
    expect(await q(assessmentPage, { caseId: JAN25, month: "2027-01" }, amira())).toMatchObject({ kind: "ok", notNeeded: null, assessment: { version: 1 } });
    expect(await cmd(assessmentSave.key, { caseId: JAN25, month: "2027-01", summary: "Rättad text", expectedVersion: 1 }, amira())).toMatchObject({ ok: true });
  });

  it("alla ärenden i testdatat: kortet ber om en bedömning bara för en månad som behöver den – och den sparningen går igenom", async () => {
    const cases = raw().all("cases").filter((c) => c.contractId === "c-bot" && c.startDate && ["active", "paused", "closed"].includes(c.status));
    expect(cases.length).toBeGreaterThan(100);
    // Januaris utkast tas bort (som innan rapportjobbet hunnit skapa dem): kortet ber då om januaribedömningen där den behövs.
    for (const m of raw().all("monthly_assessments").filter((x) => x.month === "2027-01" && x.status === "draft")) rt.store.removeRow("monthly_assessments", m.id);
    let asked = 0;
    let none = 0;
    for (const c of cases) {
      const b = (await q(caseMonthBasis, { caseId: c.id }, amira()))!;
      for (const m of b.months) {
        const mb = m.month === b.month ? b : (await q(caseMonthBasis, { caseId: c.id, manad: m.month }, amira()))!;
        const needed = needsAssessment(c, m.month, MIN);
        // Underlaget ("Gör månadsbedömningen" när bedömningen inte är godkänd) bara för en månad med rapport; annars talen.
        if (mb.noReport) none++;
        expect(!!mb.noReport, `${c.caseNumber} ${m.month}`).toBe(!needed && !mb.reportId && !mb.delivered && !mb.beforeStart);
        if (mb.gaps) expect(needed || !!mb.reportId, `${c.caseNumber} ${m.month}`).toBe(true);
      }
      if (b.missingMonth) {
        asked++;
        expect(needsAssessment(c, b.missingMonth, MIN), c.caseNumber).toBe(true);
        const res = await cmd(assessmentSave.key, { caseId: c.id, month: b.missingMonth, summary: "Påbörjad från kortet.", expectedVersion: 0 }, amira());
        expect(res, c.caseNumber).toMatchObject({ ok: true });
        expect((await q(caseMonthBasis, { caseId: c.id }, amira()))!.missingMonth, c.caseNumber).toBeNull();
      }
    }
    // Testdatat har båda sorterna: start- och slutmånader utan rapport (bland dem de tolv som startade 25–29 januari) och månader
    // där kortet ber om bedömningen – och varje sådan sparning gick igenom.
    expect(none).toBeGreaterThan(50);
    expect(asked).toBeGreaterThan(30);
  });
});
