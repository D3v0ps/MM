// Granskningen av D2 (2026-10-03): det som den automatiska utkastsparningen och "Markera alla" inte fick göra.
//   * Röd status med avvikelse: en avvikelse per avstämning (aldrig en ny per sparning); uppgiften till kommunen och mejlet
//     skapas bara vid manuell sparning eller godkännande, en gång.
//   * En godkänd avstämning eller bedömning ändras inte – inte heller av en autosparning från en annan flik ("approved").
//   * Radversionen (0022): samma utkast sparat i en annan flik ger "conflict", inget skrivs över.
//   * Samtidiga närvarokommandon ger en rad per tillfälle, och en veckorapport publiceras bara en gång.
//   * En loggrad per avtal när dagens tillfällen ligger i två avtal.
//   * Autosparningar flyttar inte demoklockan.
// Körs genom samma execute() som appen och prototypen, mot testdatat i minnet.
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { addMinutes } from "@/core/time";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import type { TableName, Tables } from "@/data/schema";
import { createSeed, DEMO_START } from "@/data/seed";
import { assessmentPage, assessmentSave, attendanceSet, attendanceSetAll, checkinSave, checkInPage, intakeSave, narvaroView } from "./api";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
const fresh = (data: MemoryData<Tables> = structuredClone(SEED)) => createMemoryRuntime({ data, clock: demoClock(DEMO_START) });
beforeEach(() => {
  rt = fresh();
});
const as = (userId: string, role?: Role, r: MemoryRuntime = rt): Actor => {
  const p = listPersonas(r.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCommand = CommandDef<any, any>;
const run = <D extends AnyCommand>(def: D, input: ParamsOf<D>, actor: Actor, r: MemoryRuntime = rt) => r.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor, r: MemoryRuntime = rt) => r.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const rows = <N extends TableName>(name: N, r: MemoryRuntime = rt): Tables[N][] => r.store.rows(name);
const amira = (r: MemoryRuntime = rt) => as("u-amira", "coach", r);
const audit = (action: string, r: MemoryRuntime = rt) => rows("audit_log", r).filter((x) => x.action === action);

const NADIA = "case-260143";
const AMAL = "case-270012";
const SESSION_A = "abc123def456";
const SESSION_B = "zzz999yyy888x";
const WED = { nadia: "a-12496", elif: "a-13882", amal: "a-14070" };
const THU = { nadia: "a-12497", elif: "a-13883", amal: "a-14071" };
const data = { heldAt: "2027-02-01T09:00", durationMin: 45, mode: "fysiskt" as const, inputMethod: "manual" as const, nextGoal: "Ringa två arbetsgivare", note: "Utkast." };
const red = { ...data, overallStatus: "red" as const };
const deviation = { description: "Upprepad ogiltig frånvaro", action: "Samtal om hinder och ny veckoplan", ownerId: "u-amira", followUpOn: "2027-02-08", needsCustomerDecision: true };
const tasksFor = (deviationId: string) => rows("tasks").filter((t) => t.kind === "customer_decision" && t.deviationId === deviationId);
const mails = (template: string) => rows("outbound_messages").filter((m) => m.template === template);

describe("röd status med avvikelse – en avvikelse per avstämning", () => {
  it("två autosparningar och ett godkännande ger exakt en avvikelse, en uppgift, ett mejl och en rad deviation.created", async () => {
    const mailsBefore = mails("beslut_behovs").length;
    const first = await run(checkinSave, { caseId: NADIA, data: red, deviation, approve: false, autosave: true, editSession: SESSION_A }, amira());
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) return;
    const id = first.checkInId;
    const devs = () => rows("deviations").filter((d) => d.checkInId === id);
    expect(devs()).toHaveLength(1);
    expect(first.deviationId).toBe(devs()[0].id);
    // Autosparningen skapar aldrig uppgiften till kommunen eller mejlet – coachen skriver fortfarande.
    expect(tasksFor(first.deviationId!)).toHaveLength(0);
    expect(mails("beslut_behovs")).toHaveLength(mailsBefore);

    const second = await run(checkinSave, { caseId: NADIA, checkInId: id, data: { ...red, note: "Mer text." }, deviation: { ...deviation, action: "Samtal om hinder, ny veckoplan och uppföljningsmöte" }, approve: false, autosave: true, editSession: SESSION_A }, amira());
    expect(second).toMatchObject({ ok: true, deviationId: first.deviationId });
    expect(devs()).toHaveLength(1);
    expect(devs()[0].action).toBe("Samtal om hinder, ny veckoplan och uppföljningsmöte");
    expect(tasksFor(first.deviationId!)).toHaveLength(0);

    const approved = await run(checkinSave, { caseId: NADIA, checkInId: id, data: { ...red, goalStatus: "no", employerContacts: { count: "0", types: [] } }, deviation, approve: true }, amira());
    expect(approved).toMatchObject({ ok: true, deviationId: first.deviationId });
    expect(devs()).toHaveLength(1);
    expect(devs()[0]).toMatchObject({ status: "open", needsCustomerDecision: true, action: deviation.action });
    expect(tasksFor(first.deviationId!)).toHaveLength(1);
    expect(tasksFor(first.deviationId!)[0]).toMatchObject({ toId: "k-maria", status: "open" });
    expect(mails("beslut_behovs")).toHaveLength(mailsBefore + 1);
    expect(audit("deviation.created").filter((x) => x.details.fromCheckIn === id)).toHaveLength(1);
    // Godkännandet uppdaterade avvikelsen: loggas som "Avvikelse sparades" (autosparningen loggade ingen avvikelserad).
    expect(audit("deviation.saved").filter((x) => x.details.fromCheckIn === id)).toHaveLength(1);
    // Ett godkännande till (t.ex. dubbelklick) gör ingenting: avstämningen är godkänd.
    const again = await run(checkinSave, { caseId: NADIA, checkInId: id, data: red, deviation, approve: true }, amira());
    expect(again).toMatchObject({ ok: false, error: "approved" });
    expect(tasksFor(first.deviationId!)).toHaveLength(1);
    expect(mails("beslut_behovs")).toHaveLength(mailsBefore + 1);
  });

  it("manuellt Spara utkast + Godkänn ger också en avvikelse och en uppgift (felet fanns före D2)", async () => {
    const draft = await run(checkinSave, { caseId: NADIA, data: red, deviation, approve: false }, amira());
    if (!draft.ok) throw new Error("misslyckades");
    expect(tasksFor(draft.deviationId!)).toHaveLength(1);
    const ok = await run(checkinSave, { caseId: NADIA, checkInId: draft.checkInId, data: { ...red, goalStatus: "no", employerContacts: { count: "0", types: [] } }, deviation, approve: true }, amira());
    expect(ok).toMatchObject({ ok: true, deviationId: draft.deviationId });
    expect(rows("deviations").filter((d) => d.checkInId === draft.checkInId)).toHaveLength(1);
    expect(tasksFor(draft.deviationId!)).toHaveLength(1);
  });
});

describe("godkända rader ändras inte", () => {
  it("en autosparning med en godkänd avstämnings id avvisas (approved) och raden är orörd", async () => {
    const draft = await run(checkinSave, { caseId: NADIA, data, approve: false, autosave: true, editSession: SESSION_A }, amira());
    if (!draft.ok) throw new Error("misslyckades");
    const id = draft.checkInId;
    const approved = await run(checkinSave, { caseId: NADIA, checkInId: id, data: { ...data, goalStatus: "yes", overallStatus: "green", employerContacts: { count: "1", types: ["ansökan"] }, note: "Godkänd anteckning." }, approve: true }, amira());
    expect(approved).toMatchObject({ ok: true });
    const before = structuredClone(rows("check_ins").find((c) => c.id === id)!);
    expect(before.status).toBe("approved");
    // Flik B skriver 2 s senare – med gamla värden och sin egen besöksnyckel.
    const res = await run(checkinSave, { caseId: NADIA, checkInId: id, data: { ...data, note: "Gammal text från flik B", nextGoal: "Gammalt veckomål", overallStatus: "yellow" }, approve: false, autosave: true, editSession: SESSION_B }, amira());
    expect(res).toMatchObject({ ok: false, error: "approved" });
    expect(rows("check_ins").find((c) => c.id === id)).toEqual(before);
    expect(audit("check_in.saved").filter((x) => x.entityId === id && x.details.editSession === SESSION_B)).toHaveLength(0);
    // Manuellt "Spara utkast" från flik B: samma svar.
    expect(await run(checkinSave, { caseId: NADIA, checkInId: id, data, approve: false }, amira())).toMatchObject({ ok: false, error: "approved" });
  });

  it("en godkänd månadsbedömning avvisas (approved) – nivåer, sammanfattning och planen står kvar", async () => {
    const areas = { narvaro_rutiner: { level: 2 as const, observation: "Kommer i tid.", nextStep: "" } };
    const page = await q(assessmentPage, { caseId: NADIA, month: "2027-01" }, amira());
    if (page.kind !== "ok") throw new Error("gate");
    const full = Object.fromEntries(page.areas.map((a) => [a.key, { level: 2 as const, observation: "Konkret observation med belägg.", nextStep: "" }]));
    const approved = await run(assessmentSave, { caseId: NADIA, month: "2027-01", areas: full, summary: "Sammanfattning.", overallStatus: "green", approve: true, plan: { goal1: "Mål 1", status: "approved" } }, amira());
    expect(approved).toMatchObject({ ok: true });
    const ma = structuredClone(rows("monthly_assessments").find((x) => x.caseId === NADIA && x.month === "2027-01")!);
    const plan = structuredClone(rows("monthly_plans").find((x) => x.caseId === NADIA && x.month === "2027-01")!);
    expect(ma.status).toBe("approved");
    const res = await run(assessmentSave, { caseId: NADIA, month: "2027-01", areas, summary: "Gammal sammanfattning", overallStatus: "red", approve: false, plan: { goal1: "Gammalt mål", status: "draft" }, autosave: true, editSession: SESSION_B }, amira());
    expect(res).toMatchObject({ ok: false, error: "approved" });
    expect(rows("monthly_assessments").find((x) => x.caseId === NADIA && x.month === "2027-01")).toEqual(ma);
    expect(rows("monthly_plans").find((x) => x.caseId === NADIA && x.month === "2027-01")).toEqual(plan);
  });
});

describe("radversionen (0022): samma utkast i två flikar", () => {
  it("avstämning: flik A sparar först, flik B med den gamla versionen får conflict och inget skrivs över", async () => {
    const first = await run(checkinSave, { caseId: NADIA, data, approve: false, autosave: true, editSession: SESSION_A }, amira());
    if (!first.ok) throw new Error("misslyckades");
    expect(first.version).toBe(1);
    const id = first.checkInId;
    // Båda flikarna öppnade utkastet med version 1. A sparar nyare text.
    const a = await run(checkinSave, { caseId: NADIA, checkInId: id, expectedVersion: 1, data: { ...data, note: "Start. Nyare text (flik A)." }, approve: false, autosave: true, editSession: SESSION_A }, amira());
    expect(a).toMatchObject({ ok: true, version: 2 });
    // B sparar äldre text med version 1: avvisas.
    const b = await run(checkinSave, { caseId: NADIA, checkInId: id, expectedVersion: 1, data: { ...data, note: "Start. Äld" }, approve: false, autosave: true, editSession: SESSION_B }, amira());
    expect(b).toMatchObject({ ok: false, error: "conflict" });
    expect(rows("check_ins").find((c) => c.id === id)).toMatchObject({ note: "Start. Nyare text (flik A).", version: 2 });
    // Godkännande från B med den gamla versionen: samma spärr.
    expect(await run(checkinSave, { caseId: NADIA, checkInId: id, expectedVersion: 1, data: { ...data, goalStatus: "yes", overallStatus: "green", employerContacts: { count: "0", types: [] } }, approve: true }, amira())).toMatchObject({ ok: false, error: "conflict" });
    // Efter omladdning (version 2 från sidan) går det igen.
    const page = await q(checkInPage, { caseId: NADIA, checkInId: id }, amira());
    expect(page.kind === "ok" && page.checkIn?.version).toBe(2);
    expect(await run(checkinSave, { caseId: NADIA, checkInId: id, expectedVersion: 2, data: { ...data, note: "Efter omladdning." }, approve: false, autosave: true, editSession: SESSION_B }, amira())).toMatchObject({ ok: true, version: 3 });
    // Utan expectedVersion (äldre anropare): ingen kontroll, versionen ökar ändå.
    expect(await run(checkinSave, { caseId: NADIA, checkInId: id, data, approve: false }, amira())).toMatchObject({ ok: true, version: 4 });
  });

  it("månadsbedömning och kartläggning: samma regel", async () => {
    const areas = { narvaro_rutiner: { level: 1 as const, observation: "x", nextStep: "" } };
    const ma1 = await run(assessmentSave, { caseId: AMAL, month: "2027-01", areas, summary: "A", approve: false, autosave: true, editSession: SESSION_A }, amira());
    if (!ma1.ok) throw new Error("misslyckades");
    const v = ma1.version;
    expect(await run(assessmentSave, { caseId: AMAL, month: "2027-01", areas, summary: "A2", approve: false, autosave: true, editSession: SESSION_A, expectedVersion: v }, amira())).toMatchObject({ ok: true, version: v + 1 });
    expect(await run(assessmentSave, { caseId: AMAL, month: "2027-01", areas, summary: "B", approve: false, autosave: true, editSession: SESSION_B, expectedVersion: v }, amira())).toMatchObject({ ok: false, error: "conflict" });
    expect(rows("monthly_assessments").find((x) => x.caseId === AMAL && x.month === "2027-01")).toMatchObject({ summary: "A2", version: v + 1 });

    const ia1 = await run(intakeSave, { caseId: AMAL, data: { workExperience: "Lager" }, approve: false, autosave: true, editSession: SESSION_A }, amira());
    if (!ia1.ok) throw new Error("misslyckades");
    expect(await run(intakeSave, { caseId: AMAL, data: { workExperience: "Lager i två år" }, approve: false, autosave: true, editSession: SESSION_A, expectedVersion: ia1.version }, amira())).toMatchObject({ ok: true, version: ia1.version + 1 });
    expect(await run(intakeSave, { caseId: AMAL, data: { workExperience: "Gammalt" }, approve: false, autosave: true, editSession: SESSION_B, expectedVersion: ia1.version }, amira())).toMatchObject({ ok: false, error: "conflict" });
    expect(rows("intake_assessments").find((x) => x.caseId === AMAL)!.workExperience).toBe("Lager i två år");
  });
});

describe("samtidiga närvarokommandon", () => {
  const rowsFor = (activityId: string) => rows("attendance").filter((a) => a.activityId === activityId);
  it("'Markera alla' samtidigt med en radknapp: en rad per tillfälle, och vyn visar samma status som rättningen", async () => {
    const [all, one] = await Promise.all([
      run(attendanceSetAll, { day: "2027-01-27", activityIds: [WED.nadia, WED.elif, WED.amal] }, amira()),
      run(attendanceSet, { activityId: WED.nadia, status: "absent_invalid" }, amira()),
    ]);
    expect(all).toMatchObject({ ok: true });
    expect(one).toMatchObject({ ok: true });
    for (const id of [WED.nadia, WED.elif, WED.amal]) expect(rowsFor(id)).toHaveLength(1);
    // Rättning efteråt: raden som vyn, veckorapporten och fakturaunderlaget läser är samma som den som ändras.
    expect(await run(attendanceSet, { activityId: WED.nadia, status: "late" }, amira())).toMatchObject({ ok: true });
    expect(rowsFor(WED.nadia)).toHaveLength(1);
    expect(rowsFor(WED.nadia)[0].status).toBe("late");
    const view = await q(narvaroView, {}, amira());
    expect(view.weeks.last.rows.find((r) => r.activityId === WED.nadia)?.attendance?.status).toBe("late");
  });

  it("dubbelklick på en radknapp och dubbelt masskommando ger en rad per tillfälle", async () => {
    await Promise.all([run(attendanceSet, { activityId: WED.nadia, status: "present" }, amira()), run(attendanceSet, { activityId: WED.nadia, status: "present" }, amira())]);
    expect(rowsFor(WED.nadia)).toHaveLength(1);
    const [a, b] = await Promise.all([
      run(attendanceSetAll, { day: "2027-01-27", activityIds: [WED.elif, WED.amal] }, amira()),
      run(attendanceSetAll, { day: "2027-01-27", activityIds: [WED.elif, WED.amal] }, amira()),
    ]);
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    expect(rowsFor(WED.elif)).toHaveLength(1);
    expect(rowsFor(WED.amal)).toHaveLength(1);
  });

  it("veckorapporten publiceras en gång när de två sista registreringarna kommer samtidigt (dubbelklick och dubbelt masskommando)", async () => {
    const rep = (recipient: string) => rows("reports").find((r) => r.kind === "weekly_attendance" && r.week === "2027-W04" && r.recipientUserId === recipient)!;
    const mailsBefore = mails("ny_rapport").length;
    expect(await run(attendanceSetAll, { day: "2027-01-27", activityIds: [WED.nadia, WED.elif, WED.amal] }, amira())).toMatchObject({ ok: true, published: [] });
    expect(await run(attendanceSet, { activityId: THU.nadia, status: "present" }, amira())).toMatchObject({ ok: true, published: null });
    // Elif är Lindas enda kvarvarande: Lindas rapport publiceras här (en gång).
    expect(await run(attendanceSet, { activityId: THU.elif, status: "present" }, amira())).toMatchObject({ ok: true, published: { reportId: rep("k-linda").id } });
    // Amal torsdag två gånger samtidigt: Marias rapport publiceras av exakt ett av kommandona.
    const [x, y] = await Promise.all([run(attendanceSet, { activityId: THU.amal, status: "present" }, amira()), run(attendanceSet, { activityId: THU.amal, status: "present" }, amira())]);
    const published = [x, y].filter((r) => r.ok && r.published);
    expect(published).toHaveLength(1);
    expect(rep("k-maria").status).toBe("delivered");
    expect(audit("report.published").filter((e) => e.entityId === rep("k-maria").id)).toHaveLength(1);
    expect(audit("report.published").filter((e) => e.entityId === rep("k-linda").id)).toHaveLength(1);
    expect(mails("ny_rapport")).toHaveLength(mailsBefore + 2);

    // Samma sak med två masskommandon i en färsk körning.
    const r2 = fresh();
    await run(attendanceSetAll, { day: "2027-01-27", activityIds: [WED.nadia, WED.elif, WED.amal] }, amira(r2), r2);
    const [p, s] = await Promise.all([
      run(attendanceSetAll, { day: "2027-01-28", activityIds: [THU.nadia, THU.elif, THU.amal] }, amira(r2), r2),
      run(attendanceSetAll, { day: "2027-01-28", activityIds: [THU.nadia, THU.elif, THU.amal] }, amira(r2), r2),
    ]);
    const pubs = [p, s].flatMap((r) => (r.ok ? r.published : []));
    expect(pubs.map((x) => x.recipientId).sort()).toEqual(["k-linda", "k-maria"]);
    expect(audit("report.published", r2).filter((e) => e.details.week === "2027-W04")).toHaveLength(2);
    expect(mails("ny_rapport").length).toBe(mailsBefore + 2);
    expect(rows("outbound_messages", r2).filter((m) => m.template === "ny_rapport")).toHaveLength(mailsBefore + 2);
  });
});

describe("'Markera alla' i två avtal", () => {
  it("en loggrad per avtal, med avtalets egna tillfällen och ärenden", async () => {
    const d = structuredClone(SEED);
    // Ett andra kommunavtal (påhittat, samma konfiguration som Botkyrka): Amal (c-bot) flyttas dit, och Amira blir medlem där.
    const bot = d.contracts.find((c) => c.id === "c-bot")!;
    d.contracts.push({ ...structuredClone(bot), id: "c-ny", contractNumber: "000000000", casePrefix: "NYK" });
    d.cases.find((c) => c.id === AMAL)!.contractId = "c-ny";
    d.memberships.push({ id: "ms-x-amira-ny", userId: "u-amira", contractId: "c-ny", role: "coach", customerUnit: null });
    const r = fresh(d);
    const res = await run(attendanceSetAll, { day: "2027-01-27", activityIds: [WED.nadia, WED.elif, WED.amal] }, amira(r), r);
    expect(res).toMatchObject({ ok: true, marked: [WED.nadia, WED.elif, WED.amal] });
    const logs = audit("attendance.registered_all", r).sort((a, b) => (a.contractId! < b.contractId! ? -1 : 1));
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ contractId: "c-bot", details: { count: 2, activityIds: [WED.nadia, WED.elif], caseIds: [NADIA, "case-270003"] } });
    expect(logs[1]).toMatchObject({ contractId: "c-ny", details: { count: 1, activityIds: [WED.amal], caseIds: [AMAL] } });
    expect(logs.every((l) => !("contractIds" in l.details))).toBe(true);
  });
});

describe("demoklockan", () => {
  it("autosparningar flyttar inte klockan – dagens kommande möten blir inte 'passerade'", async () => {
    const upcoming = rows("activities").find((a) => a.caseId === NADIA && a.startsAt > DEMO_START && a.startsAt.startsWith("2027-02-01"));
    expect(upcoming).toBeTruthy();
    expect(await run(attendanceSetAll, { day: "2027-02-01", activityIds: [upcoming!.id] }, amira())).toMatchObject({ ok: false, error: "not_started" });
    const first = await run(checkinSave, { caseId: NADIA, data, approve: false, autosave: true, editSession: SESSION_A }, amira());
    if (!first.ok) throw new Error("misslyckades");
    for (let i = 0; i < 60; i++) {
      const r = await run(checkinSave, { caseId: NADIA, checkInId: first.checkInId, data: { ...data, note: `Text ${i}` }, approve: false, autosave: true, editSession: SESSION_A }, amira());
      expect(r).toMatchObject({ ok: true, savedAt: DEMO_START });
    }
    expect(rt.clock.now()).toBe(DEMO_START);
    expect(await run(attendanceSetAll, { day: "2027-02-01", activityIds: [upcoming!.id] }, amira())).toMatchObject({ ok: false, error: "not_started" });
    // Manuell sparning flyttar klockan som förut.
    expect(await run(checkinSave, { caseId: NADIA, checkInId: first.checkInId, data, approve: false }, amira())).toMatchObject({ ok: true, savedAt: addMinutes(DEMO_START, 1) });
  });
});
