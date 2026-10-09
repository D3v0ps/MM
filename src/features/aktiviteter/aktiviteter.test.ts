// Gruppaktiviteter (coachmötet 2026-10-09) genom samma execute() som appen och prototypen, mot testdatat i minnet: skapa med
// deltagare (en rad per deltagare i activities), inbjudan nekas för avslutade och pausade ärenden, helgdagsvarningen, ändrad tid
// slår igenom på alla deltagares rader men inte efter registrerad närvaro, ta bort deltagare och ställ in, anteckningsraderna
// (personnummer stoppas, aktivitetens dag som datum), behörigheten per roll, och att veckorapporten och fakturaunderlaget räknar
// deltagarnas tillfällen som vanliga tillfällen.
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { attendanceStats } from "@/core/attendance";
import { weeklyReport } from "@/core/weekly-report";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { TableName, Tables } from "@/data/schema";
import { attendanceSet, attendanceSetAll } from "@/features/coach/api";
import "@/api/handlers";
import {
  groupActivityCancel, groupActivityCreate, groupActivityForm, groupActivityInvite, groupActivityList, groupActivityNotes, groupActivityRemove, groupActivityUpdate,
  groupActivityView,
} from "./api";

const SEED: MemoryData<Tables> = createSeed();
const CASES = { nadia: "case-260143", elif: "case-270003", amal: "case-270012" };
const THREE = [CASES.nadia, CASES.elif, CASES.amal];
const TODAY_0800 = "2027-02-01T08:00";

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
const run = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const rows = <N extends TableName>(name: N): Tables[N][] => rt.store.rows(name);
const amira = () => as("u-amira", "coach");
const audit = (action: string) => rows("audit_log").filter((x) => x.action === action);
const base = { name: "CV-verkstad", kind: "yrkesmoment" as const, startsAt: TODAY_0800, durationMin: 90, location: "Miljonbemanning Alby" };
async function create(caseIds = THREE, extra: Partial<ParamsOf<typeof groupActivityCreate>> = {}, actor = amira()) {
  const res = await run(groupActivityCreate, { ...base, caseIds, ...extra }, actor);
  if (!res.ok) throw new Error(`${res.error}: ${res.message}`);
  return res.groupActivityId;
}
const partsOf = (id: string) => rows("activities").filter((a) => a.groupActivityId === id);

describe("skapa och bjuda in", () => {
  it("en gruppaktivitet med tre deltagare: en rad per deltagare med samma tid, längd, plats och typ – loggad med id:n, utan namn", async () => {
    const id = await create();
    const g = rows("group_activities").find((x) => x.id === id)!;
    expect(g).toMatchObject({ contractId: "c-bot", name: "CV-verkstad", kind: "yrkesmoment", startsAt: TODAY_0800, createdBy: "u-amira", cancelledAt: null });
    expect(partsOf(id).map((a) => [a.caseId, a.kind, a.startsAt, a.durationMin, a.location, a.note]).sort()).toEqual(
      THREE.map((c) => [c, "yrkesmoment", TODAY_0800, 90, "Miljonbemanning Alby", ""]).sort(),
    );
    const log = audit("group_activity.created")[0];
    expect(log).toMatchObject({ entity: "group_activity", entityId: id, contractId: "c-bot", details: { count: 3, caseIds: [...THREE].sort() } });
    expect(JSON.stringify(log.details)).not.toMatch(/CV-verkstad|Alby/);
  });

  it("avslutade och pausade ärenden kan inte bjudas in – ingenting skrivs och orsaken visas per ärende", async () => {
    const closed = rows("cases").find((c) => c.status === "closed" && c.contractId === "c-bot")!;
    rt.store.updateRow("cases", "case-270020", { status: "paused" });
    const before = rows("activities").length;
    const res = await run(groupActivityCreate, { ...base, caseIds: [CASES.nadia, closed.id, "case-270020"] }, amira());
    expect(res).toMatchObject({ ok: false, error: "not_invitable" });
    if (res.ok) return;
    expect((res as { problems: { caseNumber: string; reason: string }[] }).problems.map((x) => x.reason).sort()).toEqual(["Insatsen är avslutad", "Insatsen är pausad"]);
    expect(rows("group_activities")).toEqual([]);
    expect(rows("activities").length).toBe(before);
    // Samma regel när fler bjuds in efteråt.
    const id = await create([CASES.nadia]);
    expect(await run(groupActivityInvite, { id, caseIds: [closed.id] }, amira())).toMatchObject({ ok: false, error: "not_invitable" });
    expect(await run(groupActivityInvite, { id, caseIds: [CASES.nadia, CASES.elif] }, amira())).toEqual({ ok: true, invited: 1, already: 1 });
    expect(partsOf(id)).toHaveLength(2);
  });

  it("helgdag (tabellen holidays): varning tills användaren bekräftar", async () => {
    const holiday = { ...base, startsAt: "2027-03-26T10:00", caseIds: [CASES.nadia] }; // Långfredag 2027
    const res = await run(groupActivityCreate, holiday, amira());
    expect(res).toMatchObject({ ok: false, error: "holiday" });
    expect(!res.ok && res.message).toContain("helgdag");
    expect(await run(groupActivityCreate, { ...holiday, acceptHoliday: true }, amira())).toMatchObject({ ok: true, invited: 1 });
  });

  it("ansvarig måste vara en coach i avtalet", async () => {
    expect(await run(groupActivityCreate, { ...base, caseIds: [], responsibleId: "u-lars" }, amira())).toMatchObject({ ok: false, error: "responsible" });
    expect(await run(groupActivityCreate, { ...base, caseIds: [], responsibleId: "u-amira" }, amira())).toMatchObject({ ok: true, invited: 0 });
  });
});

describe("ändra, ta bort och ställa in", () => {
  it("ändrad tid, längd och plats slår igenom på alla deltagares tillfällen", async () => {
    const id = await create();
    const res = await run(groupActivityUpdate, { id, ...base, startsAt: "2027-02-02T13:00", durationMin: 60, location: "Rum 2" }, as("u-sara", "samordnare"));
    expect(res).toEqual({ ok: true, changed: 3 });
    expect(partsOf(id).map((a) => [a.startsAt, a.durationMin, a.location])).toEqual(THREE.map(() => ["2027-02-02T13:00", 60, "Rum 2"]));
    expect(rows("group_activities")[0]).toMatchObject({ updatedBy: "u-sara", location: "Rum 2" });
    expect(audit("group_activity.updated")[0].details).toMatchObject({ fields: ["startsAt", "durationMin", "location"], count: 3 });
    // Inget ändrat: ingen skrivning.
    expect(await run(groupActivityUpdate, { id, ...base, startsAt: "2027-02-02T13:00", durationMin: 60, location: "Rum 2" }, amira())).toEqual({ ok: true, changed: 0 });
  });

  it("tiden flyttas inte när närvaro är registrerad – namn och plats går att ändra", async () => {
    const id = await create();
    const [first] = partsOf(id);
    expect(await run(attendanceSet, { activityId: first.id, status: "present" }, amira())).toMatchObject({ ok: true });
    expect(await run(groupActivityUpdate, { id, ...base, startsAt: "2027-02-01T08:30" }, amira())).toMatchObject({ ok: false, error: "has_attendance" });
    expect(await run(groupActivityUpdate, { id, ...base, name: "CV-verkstad del 2" }, amira())).toEqual({ ok: true, changed: 1 });
  });

  it("ta bort en deltagare: bara utan registrerad närvaro", async () => {
    const id = await create();
    const nadia = partsOf(id).find((a) => a.caseId === CASES.nadia)!;
    await run(attendanceSet, { activityId: nadia.id, status: "absent_valid", reason: "Sjukdom" }, amira());
    expect(await run(groupActivityRemove, { id, caseId: CASES.nadia }, amira())).toMatchObject({ ok: false, error: "has_attendance" });
    expect(await run(groupActivityRemove, { id, caseId: CASES.elif }, amira())).toEqual({ ok: true });
    expect(partsOf(id).map((a) => a.caseId).sort()).toEqual([CASES.amal, CASES.nadia].sort());
  });

  it("ställa in: deltagarnas tillfällen tas bort och aktiviteten kan sedan inte ändras – inte när närvaro är registrerad", async () => {
    const done = await create();
    await run(attendanceSet, { activityId: partsOf(done)[0].id, status: "present" }, amira());
    expect(await run(groupActivityCancel, { id: done }, amira())).toMatchObject({ ok: false, error: "has_attendance" });
    const later = await create(THREE, { startsAt: "2027-02-03T13:00" });
    expect(await run(groupActivityCancel, { id: later }, amira())).toEqual({ ok: true, removed: 3 });
    expect(partsOf(later)).toEqual([]);
    expect(rows("group_activities").find((g) => g.id === later)).toMatchObject({ cancelledBy: "u-amira" });
    expect(await run(groupActivityUpdate, { id: later, ...base }, amira())).toMatchObject({ ok: false, error: "cancelled" });
    expect(await run(groupActivityInvite, { id: later, caseIds: [CASES.nadia] }, amira())).toMatchObject({ ok: false, error: "cancelled" });
  });
});

describe("aktivitetsvyn: närvaro och anteckningar", () => {
  it("frånvaro för en, Markera övriga som närvarande för resten – samma rader som Närvaro, aldrig över en registrerad", async () => {
    const id = await create();
    const parts = partsOf(id);
    const elif = parts.find((a) => a.caseId === CASES.elif)!;
    await run(attendanceSet, { activityId: elif.id, status: "absent_invalid", reason: "Uteblev utan att meddela" }, as("u-sara", "samordnare"));
    const res = await run(attendanceSetAll, { day: "2027-02-01", activityIds: parts.map((a) => a.id) }, as("u-sara", "samordnare"));
    expect(res).toMatchObject({ ok: true, skipped: [elif.id] });
    const view = await q(groupActivityView, { id }, amira());
    if (view.kind !== "ok") throw new Error("gate");
    expect(view.participants.map((x) => [x.caseId, x.attendance?.status, x.attendance?.source]).sort()).toEqual(
      [[CASES.amal, "present", "manual"], [CASES.elif, "absent_invalid", "manual"], [CASES.nadia, "present", "manual"]].sort(),
    );
    expect(view.canEdit).toBe(true);
  });

  it("anteckningsrader: sparas som vanliga anteckningar med aktivitetens dag – personnummer stoppar alla rader", async () => {
    const id = await create();
    const bad = await run(groupActivityNotes, { id, notes: [{ caseId: CASES.nadia, body: "Aktiv och kom i tid." }, { caseId: CASES.elif, body: "Pnr 19900101-1234" }] }, amira());
    expect(bad).toMatchObject({ ok: false, error: "pnr" });
    expect(!bad.ok && (bad as { problems: { caseId: string }[] }).problems.map((x) => x.caseId)).toEqual([CASES.elif]);
    expect(rows("case_notes").filter((n) => n.createdAt >= DEMO_START)).toEqual([]);
    const okRes = await run(groupActivityNotes, { id, notes: [{ caseId: CASES.nadia, body: "Aktiv och kom i tid." }, { caseId: CASES.elif, body: "Behöver stöd med CV." }] }, amira());
    expect(okRes).toMatchObject({ ok: true, saved: 2 });
    const notes = rows("case_notes").filter((n) => okRes.ok && okRes.noteIds.includes(n.id));
    expect(notes.map((n) => [n.caseId, n.occurredOn, n.kind, n.authorId])).toEqual([[CASES.nadia, "2027-02-01", "other", "u-amira"], [CASES.elif, "2027-02-01", "other", "u-amira"]]);
    expect(audit("case_note.created").map((l) => l.details)).toEqual(expect.arrayContaining([{ caseId: CASES.nadia, groupActivityId: id }]));
    for (const l of audit("case_note.created")) expect(JSON.stringify(l.details)).not.toContain("CV");
    const view = await q(groupActivityView, { id }, amira());
    if (view.kind !== "ok") throw new Error("gate");
    expect(view.participants.find((x) => x.caseId === CASES.nadia)?.notes.map((n) => n.body)).toEqual(["Aktiv och kom i tid."]);
    // En deltagare som inte är inbjuden och en framtida aktivitet nekas.
    expect(await run(groupActivityNotes, { id, notes: [{ caseId: "case-260130", body: "Text" }] }, amira())).toMatchObject({ ok: false, error: "not_invited" });
    const later = await create(THREE, { startsAt: "2027-02-03T13:00" });
    expect(await run(groupActivityNotes, { id: later, notes: [{ caseId: CASES.nadia, body: "Text" }] }, amira())).toMatchObject({ ok: false, error: "date" });
  });

  it("veckorapporten och närvarograden räknar deltagarnas tillfällen som vanliga tillfällen", async () => {
    const dbNow = () => ({ cases: rows("cases"), activities: rows("activities"), attendance: rows("attendance"), deviations: rows("deviations") });
    const before = attendanceStats(dbNow(), CASES.nadia, "2027-02-01", "2027-02-07", { now: "2027-02-01T23:00" });
    const id = await create();
    const nadia = partsOf(id).find((a) => a.caseId === CASES.nadia)!;
    await run(attendanceSet, { activityId: nadia.id, status: "absent_invalid" }, amira());
    const db = dbNow();
    const after = attendanceStats(db, CASES.nadia, "2027-02-01", "2027-02-07", { now: "2027-02-01T23:00" });
    expect(after.planned).toBe(before.planned + 1);
    expect(after.absentInvalid).toBe(before.absentInvalid + 1);
    const wr = weeklyReport(db, "k-maria", "2027-W05", { now: "2027-02-01T23:00" });
    expect(wr.sections.find((s) => s.case.id === CASES.nadia)?.rows.some((r) => r.activity.id === nadia.id && r.att?.status === "absent_invalid")).toBe(true);
  });
});

describe("behörighet", () => {
  it("alla på Miljonbemanning utom ekonomen ser alla gruppaktiviteter – chef och systemadministratör läser, kommunen och ekonomen ingenting", async () => {
    const id = await create();
    for (const [userId, role] of [["u-sara", "samordnare"], ["u-johan", "avtalsansvarig"], ["u-leila", "coach"], ["u-petra", "handledare"], ["u-karin", "chef"], ["u-robin", "admin"]] as const) {
      const list = await q(groupActivityList, {}, as(userId, role));
      expect(list.upcoming.map((r) => r.id), userId).toEqual([id]);
      expect(list.canCreate, userId).toBe(["samordnare", "avtalsansvarig", "coach", "handledare"].includes(role));
    }
    const chefView = await q(groupActivityView, { id }, as("u-karin", "chef"));
    expect(chefView).toMatchObject({ kind: "ok", canEdit: false });
    await expect(run(groupActivityCreate, { ...base, caseIds: [] }, as("u-karin", "chef"))).rejects.toMatchObject({ status: 403 });
    for (const [userId, role] of [["u-lars", "ekonom"], ["k-maria", "kommun_handlaggare"]] as const) {
      await expect(q(groupActivityList, {}, as(userId, role))).rejects.toMatchObject({ status: 403 });
      await expect(q(groupActivityView, { id }, as(userId, role))).rejects.toMatchObject({ status: 403 });
      await expect(run(groupActivityCreate, { ...base, caseIds: [] }, as(userId, role))).rejects.toMatchObject({ status: 403 });
    }
  });

  it("formuläret: pågående och pausade ärenden i avtalet, coacherna och helgdagarna", async () => {
    const f = await q(groupActivityForm, {}, as("u-sara", "samordnare"));
    expect(f.contractId).toBe("c-bot");
    expect(f.kinds.map((k) => k.value)).toEqual(["yrkesmoment", "arbetsgivarbesök", "annat"]);
    expect(f.candidates.every((c) => c.status === "active" || c.status === "paused")).toBe(true);
    expect(f.candidates.some((c) => c.caseId === CASES.nadia)).toBe(true);
    expect(f.coaches.map((c) => c.id)).toContain("u-amira");
    expect(f.holidays.map((h) => h.date)).toContain("2027-03-26");
    expect(f.me).toBeNull();
    expect((await q(groupActivityForm, {}, amira())).me).toBe("u-amira");
  });
});
