// Automatisk utkastsparning på servern (D2 punkt 2): samma kommandon som "Spara utkast" med autosave + editSession.
// Revisionsloggen får en rad per besök på sidan (editSession) – inte en per sparning; manuell sparning och godkännande
// loggas som förut. autosave tillsammans med approve avvisas. savedAt är serverns tid (demoklockan), aldrig webbläsarens.
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { addMinutes } from "@/core/time";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import type { TableName, Tables } from "@/data/schema";
import { createSeed, DEMO_START } from "@/data/seed";
import { caseHistory } from "@/features/arenden/api";
import { detailText } from "@/features/admin/audit-text";
import { assessmentSave, checkinSave, intakeSave } from "./api";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCommand = CommandDef<any, any>;
const run = <D extends AnyCommand>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
const rows = <N extends TableName>(name: N): Tables[N][] => rt.store.rows(name);
const amira = () => as("u-amira", "coach");
const logs = (action: string, entityId: string) => rows("audit_log").filter((x) => x.action === action && x.entityId === entityId);

const NADIA = "case-260143";
const AMAL = "case-270012";
const SESSION_A = "abc123def456";
const SESSION_B = "zzz999yyy888x";
const T = (n: number) => addMinutes(DEMO_START, n);

describe("veckoavstämning – coach.checkinSave med autosave", () => {
  const data = { heldAt: "2027-02-01T09:00", durationMin: 45, mode: "fysiskt" as const, inputMethod: "manual" as const, nextGoal: "Ringa två arbetsgivare", note: "Första utkastet." };

  it("två autosparningar i samma besök ger en loggrad; ett nytt besök ger en till; manuell sparning loggas alltid", async () => {
    const first = await run(checkinSave, { caseId: NADIA, data, approve: false, autosave: true, editSession: SESSION_A }, amira());
    expect(first).toMatchObject({ ok: true, savedAt: T(0) });
    if (!first.ok) return;
    const id = first.checkInId;
    expect(rows("check_ins").find((c) => c.id === id)).toMatchObject({ status: "draft", note: "Första utkastet.", nextGoal: "Ringa två arbetsgivare" });
    expect(logs("check_in.saved", id)).toMatchObject([{ actorId: "u-amira", details: { caseId: NADIA, aiUsed: false, autosave: true, editSession: SESSION_A } }]);

    const second = await run(checkinSave, { caseId: NADIA, checkInId: id, data: { ...data, note: "Andra utkastet." }, approve: false, autosave: true, editSession: SESSION_A }, amira());
    expect(second).toMatchObject({ ok: true, checkInId: id, savedAt: T(0) });
    expect(rows("check_ins").filter((c) => c.caseId === NADIA && c.status === "draft")).toHaveLength(1);
    expect(rows("check_ins").find((c) => c.id === id)!.note).toBe("Andra utkastet.");
    expect(logs("check_in.saved", id)).toHaveLength(1);

    // Nytt besök på sidan (ny editSession): en rad till.
    const third = await run(checkinSave, { caseId: NADIA, checkInId: id, data: { ...data, note: "Tredje." }, approve: false, autosave: true, editSession: SESSION_B }, amira());
    expect(third).toMatchObject({ ok: true, checkInId: id });
    expect(logs("check_in.saved", id).map((x) => x.details.editSession)).toEqual([SESSION_A, SESSION_B]);

    // Manuell "Spara utkast" loggas alltid (utan autosave), också mitt i samma besök.
    await run(checkinSave, { caseId: NADIA, checkInId: id, data, approve: false }, amira());
    await run(checkinSave, { caseId: NADIA, checkInId: id, data, approve: false }, amira());
    const all = logs("check_in.saved", id);
    expect(all).toHaveLength(4);
    expect(all.slice(2).every((x) => x.details.autosave === undefined)).toBe(true);
    // Samma besök igen efter de manuella: fortfarande ingen ny automatisk rad för besöket A.
    await run(checkinSave, { caseId: NADIA, checkInId: id, data, approve: false, autosave: true, editSession: SESSION_A }, amira());
    expect(logs("check_in.saved", id)).toHaveLength(4);
  });

  it("utan editSession loggas varje autosparning", async () => {
    const first = await run(checkinSave, { caseId: NADIA, data, approve: false, autosave: true }, amira());
    if (!first.ok) throw new Error("misslyckades");
    await run(checkinSave, { caseId: NADIA, checkInId: first.checkInId, data, approve: false, autosave: true }, amira());
    expect(logs("check_in.saved", first.checkInId).map((x) => x.details.editSession)).toEqual([null, null]);
  });

  it("autosave kan inte godkänna, och en annan coach nekas som vanligt", async () => {
    const n = rows("check_ins").length;
    expect(await run(checkinSave, { caseId: NADIA, data, approve: true, autosave: true, editSession: SESSION_A }, amira())).toMatchObject({ ok: false, error: "invalid" });
    expect(rows("check_ins").length).toBe(n);
    expect(await run(checkinSave, { caseId: "case-260120", data, approve: false, autosave: true, editSession: SESSION_A }, amira())).toMatchObject({ ok: false, error: "not_found" });
    // Fel form på besöksnyckeln stoppas av kontraktet (ogiltiga uppgifter).
    await expect(run(checkinSave, { caseId: NADIA, data, approve: false, autosave: true, editSession: "FEL" as never }, amira())).rejects.toThrow();
  });

  it("röd status utan avvikelse avvisas också automatiskt – ingenting sparas", async () => {
    const n = rows("check_ins").length;
    expect(await run(checkinSave, { caseId: NADIA, data: { ...data, overallStatus: "red" }, approve: false, autosave: true, editSession: SESSION_A }, amira())).toMatchObject({ ok: false, error: "deviation_required" });
    expect(rows("check_ins").length).toBe(n);
  });

  it("godkännande efter autosparning gäller samma rad och loggas som förut", async () => {
    const first = await run(checkinSave, { caseId: NADIA, data, approve: false, autosave: true, editSession: SESSION_A }, amira());
    if (!first.ok) throw new Error("misslyckades");
    const ok = await run(checkinSave, {
      caseId: NADIA, checkInId: first.checkInId, approve: true,
      data: { ...data, goalStatus: "yes", phase: 4, employerContacts: { count: "1", types: ["ansökan"] }, overallStatus: "green" },
    }, amira());
    expect(ok).toMatchObject({ ok: true, checkInId: first.checkInId });
    expect(rows("check_ins").find((c) => c.id === first.checkInId)).toMatchObject({ status: "approved", approvedBy: "u-amira" });
    expect(logs("check_in.approved", first.checkInId)).toMatchObject([{ details: { caseId: NADIA, aiUsed: false } }]);
    // Historiken (chefen): "Avstämning sparades som utkast · Sparades automatiskt" och "Avstämning godkändes".
    const h = await rt.run("query", caseHistory.key, { caseId: NADIA }, as("u-karin", "chef")) as ResultOf<typeof caseHistory>;
    expect(h!.log.filter((x) => x.text === "Avstämning sparades som utkast")).toMatchObject([{ sub: "Sparades automatiskt", actorName: "Amira Haddad" }]);
    expect(h!.log.filter((x) => x.text === "Avstämning godkändes")).toHaveLength(1);
    // Revisionsloggen (admin): "Automatiskt: Ja" – aldrig besöksnyckeln.
    const row = logs("check_in.saved", first.checkInId)[0];
    const lookups = { userName: () => null, caseNumber: () => "BOT-26-0143", kpiLabel: () => null, templateLabel: (k: string) => k };
    const text = detailText({ action: row.action, entity: row.entity, entityId: row.entityId, details: row.details }, lookups);
    expect(text).toBe("AI använd: Nej · Automatiskt: Ja");
    expect(text).not.toContain(SESSION_A);
  });
});

describe("månadsbedömning – coach.assessmentSave med autosave", () => {
  const areas = { narvaro: { level: 2 as const, observation: "Kommer i tid varje dag." } };

  it("en loggrad per besök, anteckningarna loggas en gång, savedAt = serverns tid, godkännande avvisas", async () => {
    const first = await run(assessmentSave, { caseId: NADIA, month: "2027-01", areas, summary: "Utkast.", approve: false, plan: { goal1: "Mål", status: "draft" }, autosave: true, editSession: SESSION_A }, amira());
    expect(first).toMatchObject({ ok: true, savedAt: T(0) });
    if (!first.ok) return;
    const id = first.assessmentId;
    expect(rows("monthly_assessments").find((m) => m.id === id)).toMatchObject({ status: "draft", summary: "Utkast." });
    const second = await run(assessmentSave, { caseId: NADIA, month: "2027-01", areas, summary: "Utkast 2.", approve: false, autosave: true, editSession: SESSION_A }, amira());
    expect(second).toMatchObject({ ok: true, assessmentId: id, savedAt: T(0) });
    expect(logs("assessment.saved", id)).toMatchObject([{ details: { caseId: NADIA, month: "2027-01", autosave: true, editSession: SESSION_A } }]);
    expect(rows("monthly_assessments").filter((m) => m.caseId === NADIA && m.month === "2027-01")).toHaveLength(1);
    // Anteckning i sammanfattningen: loggas en gång när den skickas med.
    const note = rows("case_notes").find((n) => n.caseId === NADIA && n.occurredOn.startsWith("2027-01") && !n.removedAt)!;
    expect(note).toBeTruthy();
    await run(assessmentSave, { caseId: NADIA, month: "2027-01", summary: `Utkast 2.\n\n${note.body}`, approve: false, usedNoteIds: [note.id], autosave: true, editSession: SESSION_A }, amira());
    expect(rows("audit_log").filter((x) => x.action === "case_note.used_in_summary" && x.entityId === note.id)).toHaveLength(1);
    expect(logs("assessment.saved", id)).toHaveLength(1);
    expect(await run(assessmentSave, { caseId: NADIA, month: "2027-01", areas, approve: true, autosave: true, editSession: SESSION_A }, amira())).toMatchObject({ ok: false, error: "invalid" });
    // Manuellt: alltid en rad.
    await run(assessmentSave, { caseId: NADIA, month: "2027-01", areas, approve: false }, amira());
    expect(logs("assessment.saved", id)).toHaveLength(2);
  });
});

describe("kartläggning – coach.intakeSave med autosave", () => {
  it("en loggrad per besök, samma rad, savedAt = serverns tid, godkännande avvisas", async () => {
    const first = await run(intakeSave, { caseId: AMAL, data: { workExperience: "Lager i två år." }, approve: false, autosave: true, editSession: SESSION_A }, amira());
    expect(first).toMatchObject({ ok: true, savedAt: T(0) });
    if (!first.ok) return;
    const id = first.intakeId;
    await run(intakeSave, { caseId: AMAL, data: { workExperience: "Lager i två år, även truck." }, approve: false, autosave: true, editSession: SESSION_A }, amira());
    expect(rows("intake_assessments").filter((x) => x.caseId === AMAL)).toHaveLength(1);
    expect(rows("intake_assessments").find((x) => x.id === id)).toMatchObject({ status: "draft", workExperience: "Lager i två år, även truck." });
    expect(logs("intake.saved", id)).toMatchObject([{ details: { caseId: AMAL, autosave: true, editSession: SESSION_A } }]);
    await run(intakeSave, { caseId: AMAL, data: { education: "Gymnasium" }, approve: false, autosave: true, editSession: SESSION_B }, amira());
    expect(logs("intake.saved", id)).toHaveLength(2);
    expect(await run(intakeSave, { caseId: AMAL, data: {}, approve: true, autosave: true, editSession: SESSION_A }, amira())).toMatchObject({ ok: false, error: "invalid" });
    expect(rows("intake_assessments").find((x) => x.id === id)!.status).toBe("draft");
    // Godkännande (manuellt) loggas som förut.
    const ok = await run(intakeSave, { caseId: AMAL, data: { chosenTrack: "Individuellt spår" }, approve: true }, amira());
    expect(ok).toMatchObject({ ok: true, intakeId: id });
    expect(logs("intake.approved", id)).toHaveLength(1);
  });
});
