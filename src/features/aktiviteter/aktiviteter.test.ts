// Gruppaktiviteter (coachmötet 2026-10-09) genom samma execute() som appen och prototypen, mot testdatat i minnet: skapa med
// deltagare (en rad per deltagare i activities), inbjudan nekas för avslutade och pausade ärenden, helgdagsvarningen, ändrad tid
// slår igenom på alla deltagares rader men inte efter registrerad närvaro, ta bort deltagare och ställ in, anteckningsraderna
// (personnummer stoppas, aktivitetens dag som datum), behörigheten per roll, och att veckorapporten och fakturaunderlaget räknar
// deltagarnas tillfällen som vanliga tillfällen.
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { attendanceStats } from "@/core/attendance";
import { billableWeeks, billingLines } from "@/core/billing";
import { requireOperational } from "@/core/config";
import { overlaps } from "@/core/group-activities";
import { weeklyReport } from "@/core/weekly-report";
import { listPersonas } from "@/data/actors";
import { dormantSupervisor } from "@/data/dormant-role.test-helper";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { TableName, Tables } from "@/data/schema";
import { activityAdd, activityRemove, caseAttendance, caseScheduleChange } from "@/features/arenden/api";
import { attendanceSet, attendanceSetAll, narvaroView } from "@/features/coach/api";
import { placementCreate } from "@/features/praktik/api";
import { auditView } from "@/features/session/api";
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
    expect(await run(groupActivityInvite, { id, caseIds: [CASES.nadia, CASES.elif] }, amira())).toEqual({ ok: true, invited: 1, already: 1, replaced: 0 });
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
    expect(res).toEqual({ ok: true, changed: 3, replaced: 0 });
    expect(partsOf(id).map((a) => [a.startsAt, a.durationMin, a.location])).toEqual(THREE.map(() => ["2027-02-02T13:00", 60, "Rum 2"]));
    expect(rows("group_activities")[0]).toMatchObject({ updatedBy: "u-sara", location: "Rum 2" });
    expect(audit("group_activity.updated")[0].details).toMatchObject({ fields: ["startsAt", "durationMin", "location"], count: 3 });
    // Inget ändrat: ingen skrivning.
    expect(await run(groupActivityUpdate, { id, ...base, startsAt: "2027-02-02T13:00", durationMin: 60, location: "Rum 2" }, amira())).toEqual({ ok: true, changed: 0, replaced: 0 });
  });

  it("tiden flyttas inte när närvaro är registrerad – namn och plats går att ändra", async () => {
    const id = await create();
    const [first] = partsOf(id);
    expect(await run(attendanceSet, { activityId: first.id, status: "present" }, amira())).toMatchObject({ ok: true });
    expect(await run(groupActivityUpdate, { id, ...base, startsAt: "2027-02-01T08:30" }, amira())).toMatchObject({ ok: false, error: "has_attendance" });
    expect(await run(groupActivityUpdate, { id, ...base, name: "CV-verkstad del 2" }, amira())).toEqual({ ok: true, changed: 1, replaced: 0 });
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
    expect(await run(groupActivityCancel, { id: later }, amira())).toEqual({ ok: true, removed: 3, kept: 0 });
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
    // Petra är coach sedan rollen handledare togs bort (Karims beslut 2026-10-09).
    for (const [userId, role] of [["u-sara", "samordnare"], ["u-johan", "avtalsansvarig"], ["u-leila", "coach"], ["u-petra", "coach"], ["u-karin", "chef"], ["u-robin", "admin"]] as const) {
      const list = await q(groupActivityList, {}, as(userId, role));
      expect(list.upcoming.map((r) => r.id), userId).toEqual([id]);
      expect(list.canCreate, userId).toBe(["samordnare", "avtalsansvarig", "coach"].includes(role));
    }
    // Den vilande rollen handledare: hanterarnas regler ligger kvar (läser och skapar) så att rollen kan slås på igen – men
    // ingen kan få rollen och ingen sida når den (src/shell/route-table.test.ts).
    const dormant = await q(groupActivityList, {}, dormantSupervisor());
    expect(dormant.upcoming.map((r) => r.id)).toEqual([id]);
    expect(dormant.canCreate).toBe(true);
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

// ================================================================ Efter granskningen (2026-10-10)
describe("deltagarens övriga tillfällen rör aldrig gruppraderna", () => {
  const ELIF_WED = "2027-02-03T13:00";
  const plan = [{ weekday: 2, kind: "yrkesmoment" as const, time: "13:30", durationMin: 120, location: "Miljonbemanning Alby" }];

  it("ändrad veckoplan: deltagaren ligger kvar i gruppaktiviteten och planen lägger inget tillfälle som krockar med den", async () => {
    const id = await create([CASES.elif], { startsAt: ELIF_WED });
    const [row] = partsOf(id);
    const res = await run(caseScheduleChange, { caseId: CASES.elif, plan }, amira());
    expect(res.ok, !res.ok ? res.message : "").toBe(true);
    expect(partsOf(id)).toEqual([row]);
    const elif = rows("activities").filter((a) => a.caseId === CASES.elif && a.startsAt >= DEMO_START);
    // Planens onsdag 13.30 krockar med aktiviteten 13.00–14.30 den veckan och hoppas över – men läggs alla andra onsdagar.
    expect(elif.filter((a) => a.startsAt.startsWith("2027-02-03") && !a.groupActivityId)).toEqual([]);
    expect(elif.some((a) => a.startsAt === "2027-02-10T13:30")).toBe(true);
    expect(elif.filter((a) => !a.groupActivityId).every((a) => !overlaps(a, row))).toBe(true);
    expect(audit("group_activity.removed_participant")).toEqual([]);
    // Aktivitetsvyn och listan visar fortfarande deltagaren.
    const view = await q(groupActivityView, { id }, amira());
    expect(view.kind === "ok" && view.participants.map((x) => x.caseId)).toEqual([CASES.elif]);
    expect((await q(groupActivityList, {}, amira())).upcoming.find((r) => r.id === id)?.invited).toBe(1);
  });

  it("ny praktik: yrkesmoment på praktikdagarna ersätts som förut, gruppaktiviteten ligger kvar och räknas i svaret och loggen", async () => {
    const id = await create([CASES.elif], { startsAt: ELIF_WED });
    const res = await run(placementCreate, {
      caseId: CASES.elif, newEmployer: { name: "Testföretaget AB" }, startsOn: "2027-02-03", endsOn: "2027-02-05", weekdays: [2], time: "08:00", durationMin: 420,
    }, amira());
    expect(res).toMatchObject({ ok: true, days: 1, groupActivities: 1 });
    expect(partsOf(id)).toHaveLength(1);
    // Det enskilda yrkesmomentet samma dag (09.00) är ersatt av praktikdagen.
    const day = rows("activities").filter((a) => a.caseId === CASES.elif && a.startsAt.startsWith("2027-02-03"));
    expect(day.map((a) => [a.kind, a.groupActivityId ? "grupp" : "egen"]).sort()).toEqual([["praktikdag", "egen"], ["yrkesmoment", "grupp"]]);
    expect(audit("placement.created")[0].details).toMatchObject({ groupActivityIds: [id] });
  });

  it("Ta bort tillfälle (Närvaro, deltagarkortet) nekar grupprader och hänvisar till aktivitetsvyn – vyerna länkar dit", async () => {
    const id = await create([CASES.nadia], { startsAt: "2027-02-02T13:00" });
    const [row] = partsOf(id);
    expect(await run(activityRemove, { activityId: row.id }, amira())).toMatchObject({ ok: false, error: "group_activity" });
    expect(partsOf(id)).toEqual([row]);
    const narvaro = await q(narvaroView, {}, amira());
    expect(narvaro.weeks.this.rows.find((r) => r.activityId === row.id)?.groupActivityId).toBe(id);
    const kort = await q(caseAttendance, { caseId: CASES.nadia }, amira());
    expect(kort?.upcoming.find((a) => a.id === row.id)?.groupActivityId).toBe(id);
    expect(kort?.upcoming.filter((a) => a.id !== row.id).every((a) => a.groupActivityId === null)).toBe(true);
  });
});

describe("samma tid: inga dubbla tillfällen för en deltagare", () => {
  // Testdatat: alla tre har yrkesmoment onsdag 2027-02-03 09.00–12.00 (avtalets veckoplan).
  const WED_10 = "2027-02-03T10:00";

  it("skapa: ett eget tillfälle utan närvaro ger overlap per ärende tills användaren bekräftar – då ersätts det och loggas", async () => {
    const before = rows("activities").length;
    const res = await run(groupActivityCreate, { ...base, startsAt: WED_10, durationMin: 60, caseIds: THREE }, amira());
    expect(res).toMatchObject({ ok: false, error: "overlap" });
    const problems = (res as unknown as { problems: { caseId: string; reason: string }[] }).problems;
    expect(problems.map((x) => x.caseId).sort()).toEqual([...THREE].sort());
    expect(problems[0].reason).toBe("Har redan yrkesmoment kl. 09.00–12.00. Det ersätts av aktiviteten");
    expect(rows("group_activities")).toEqual([]);
    expect(rows("activities").length).toBe(before);
    const ok = await run(groupActivityCreate, { ...base, startsAt: WED_10, durationMin: 60, caseIds: THREE, replaceOverlapping: true }, amira());
    expect(ok).toMatchObject({ ok: true, invited: 3, replaced: 3 });
    for (const c of THREE) {
      const wed = rows("activities").filter((a) => a.caseId === c && a.startsAt.startsWith("2027-02-03"));
      expect(wed.map((a) => [a.startsAt, !!a.groupActivityId])).toEqual([[WED_10, true]]);
    }
    expect((audit("group_activity.created")[0].details as { replacedActivityIds: string[] }).replacedActivityIds).toHaveLength(3);
  });

  it("ett tillfälle med registrerad närvaro eller en annan gruppaktivitet vid samma tid stoppar – det ersätts aldrig", async () => {
    const add = await run(activityAdd, { caseId: CASES.nadia, kind: "annat", startsAt: "2027-02-01T07:00", durationMin: 60, location: "Alby" }, amira());
    expect(add.ok).toBe(true);
    await run(attendanceSet, { activityId: (add as { activityId: string }).activityId, status: "present" }, amira());
    const res = await run(groupActivityCreate, { ...base, startsAt: "2027-02-01T07:30", durationMin: 30, caseIds: [CASES.nadia], replaceOverlapping: true }, amira());
    expect(res).toMatchObject({ ok: false, error: "not_invitable" });
    expect((res as unknown as { problems: { reason: string }[] }).problems[0].reason).toBe("Har redan annan aktivitet kl. 07.00–08.00 med registrerad närvaro");
    const first = await create([CASES.nadia], { startsAt: "2027-02-02T13:00" });
    const second = await run(groupActivityCreate, { ...base, startsAt: "2027-02-02T13:30", caseIds: [CASES.nadia], replaceOverlapping: true }, amira());
    expect(second).toMatchObject({ ok: false, error: "not_invitable" });
    expect((second as unknown as { problems: { reason: string }[] }).problems[0].reason).toBe("Är redan inbjuden till en annan aktivitet kl. 13.00–14.30");
    expect(partsOf(first)).toHaveLength(1);
  });

  it("bjud in och ändra tid prövas på samma sätt – aktivitetens egna rader räknas inte som krock", async () => {
    const id = await create([CASES.elif], { startsAt: "2027-02-02T13:00" });
    // Längre aktivitet samma dag: inga andra tillfällen den dagen – ingen krock med de egna raderna.
    expect(await run(groupActivityUpdate, { id, ...base, startsAt: "2027-02-02T13:00", durationMin: 120 }, amira())).toEqual({ ok: true, changed: 1, replaced: 0 });
    // Flytt till onsdag 10.00: krockar med yrkesmomentet 09.00–12.00.
    const move = { id, ...base, startsAt: WED_10, durationMin: 60 };
    expect(await run(groupActivityUpdate, move, amira())).toMatchObject({ ok: false, error: "overlap" });
    expect(partsOf(id)[0].startsAt).toBe("2027-02-02T13:00");
    expect(await run(groupActivityUpdate, { ...move, replaceOverlapping: true }, amira())).toEqual({ ok: true, changed: 2, replaced: 1 });
    expect(rows("activities").filter((a) => a.caseId === CASES.elif && a.startsAt.startsWith("2027-02-03")).map((a) => a.groupActivityId)).toEqual([id]);
    expect(await run(groupActivityInvite, { id, caseIds: [CASES.nadia] }, amira())).toMatchObject({ ok: false, error: "overlap" });
    expect(await run(groupActivityInvite, { id, caseIds: [CASES.nadia], replaceOverlapping: true }, amira())).toEqual({ ok: true, invited: 1, already: 0, replaced: 1 });
  });
});

describe("samtidiga anrop", () => {
  it("två samtidiga inbjudningar av samma deltagare ger ett tillfälle (unika nyckeln) – båda svarar ok", async () => {
    const id = await create([CASES.nadia]);
    const [a, b] = await Promise.all([run(groupActivityInvite, { id, caseIds: [CASES.elif] }, amira()), run(groupActivityInvite, { id, caseIds: [CASES.elif] }, as("u-sara", "samordnare"))]);
    expect(a.ok && b.ok).toBe(true);
    expect(partsOf(id).filter((x) => x.caseId === CASES.elif)).toHaveLength(1);
    expect((a.ok ? a.invited : 0) + (b.ok ? b.invited : 0)).toBe(1);
  });

  it("Ställ in två gånger samtidigt: aktiviteten ställs in en gång, tillfällena tas bort en gång", async () => {
    const id = await create(THREE, { startsAt: "2027-02-03T13:00" });
    const res = await Promise.all([run(groupActivityCancel, { id }, amira()), run(groupActivityCancel, { id }, as("u-sara", "samordnare"))]);
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    expect(res.find((r) => !r.ok)).toMatchObject({ ok: false, error: "cancelled" });
    expect(partsOf(id)).toEqual([]);
    expect(audit("group_activity.cancelled")).toHaveLength(1);
  });
});

describe("vilande spärren för skyddade personuppgifter (påslagen)", () => {
  const protect = () => rt.store.updateRow("persons", rows("cases").find((c) => c.id === CASES.nadia)!.personId, { protectedIdentity: true });

  it("den som inte arbetar i ärendet får ett ordnat nej per ärende – ingenting skrivs", async () => {
    protect();
    const before = rows("activities").length;
    const res = await run(groupActivityCreate, { ...base, caseIds: [CASES.nadia, CASES.elif] }, as("u-leila", "coach"));
    expect(res).toMatchObject({ ok: false, error: "not_invitable" });
    expect((res as unknown as { problems: { caseId: string; reason: string }[] }).problems).toEqual([
      { caseId: CASES.nadia, caseNumber: "BOT-26-0143", reason: "Skyddade personuppgifter – bara huvudcoachen och avtalsansvarig kan bjuda in deltagaren" },
    ]);
    expect(rows("group_activities")).toEqual([]);
    expect(rows("activities").length).toBe(before);
    // Huvudcoachen arbetar i ärendet och bjuder in; samordnaren kan sedan inte bjuda in, flytta eller ställa in för den skyddade.
    const id = await create([CASES.nadia, CASES.elif], { startsAt: "2027-02-02T13:00" });
    const sara = as("u-sara", "samordnare");
    const other = await create([CASES.elif], { startsAt: "2027-02-02T09:00" }, sara);
    expect(await run(groupActivityInvite, { id: other, caseIds: [CASES.nadia] }, sara)).toMatchObject({ ok: false, error: "not_invitable" });
    expect(await run(groupActivityUpdate, { id, ...base, startsAt: "2027-02-02T14:00" }, sara)).toMatchObject({ ok: false, error: "restricted" });
    expect(await run(groupActivityCancel, { id }, sara)).toMatchObject({ ok: false, error: "restricted" });
    expect(partsOf(id).map((a) => a.startsAt)).toEqual(["2027-02-02T13:00", "2027-02-02T13:00"]);
    expect(rows("group_activities").find((g) => g.id === id)?.cancelledAt).toBeNull();
    // Namnet går att ändra (deltagarnas rader rörs inte).
    expect(await run(groupActivityUpdate, { id, ...base, startsAt: "2027-02-02T13:00", name: "CV-verkstad 2" }, sara)).toMatchObject({ ok: true, changed: 1 });
  });
});

describe("visningslogg för aktivitetsvyn", () => {
  it("visningen loggas med deltagarnas ärenden (servern slår upp dem) – ekonomen och kommunen kan inte logga den", async () => {
    const id = await create();
    expect(await run(auditView, { action: "group_activity.view", entity: "group_activity", entityId: id }, as("u-karin", "chef"))).toEqual({ ok: true });
    const log = audit("group_activity.view");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity: "group_activity", entityId: id, contractId: "c-bot", actorId: "u-karin", details: { caseIds: [...THREE].sort() } });
    expect(await run(auditView, { action: "group_activity.view", entity: "group_activity", entityId: id }, as("u-lars", "ekonom"))).toMatchObject({ ok: false });
    expect(await run(auditView, { action: "group_activity.view", entity: "case", entityId: id }, amira())).toMatchObject({ ok: false });
  });
});

describe("fakturaunderlaget räknar gruppaktivitetens rader som enskilda tillfällen", () => {
  it("frånvaro på gruppaktiviteten ger samma debiterbara veckor, nollnärvaroflagga och fakturarad som samma frånvaro på ett eget tillfälle", async () => {
    const NOW = "2027-02-05T23:00";
    // Hela vecka 5 för Nadia: alla passerade tillfällen frånvaro – sista tillfället är antingen gruppaktiviteten eller ett eget.
    const scenario = async (group: boolean) => {
      rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
      rt.clock.set("2027-02-05T09:00");
      let actId: string;
      if (group) {
        const id = await create([CASES.nadia], { startsAt: "2027-02-05T08:00", durationMin: 60 });
        actId = partsOf(id)[0].id;
      } else {
        const add = await run(activityAdd, { caseId: CASES.nadia, kind: "yrkesmoment", startsAt: "2027-02-05T08:00", durationMin: 60, location: base.location }, amira());
        if (!add.ok) throw new Error(add.message);
        actId = add.activityId;
      }
      for (const a of rows("activities").filter((x) => x.caseId === CASES.nadia && x.startsAt >= "2027-02-01" && x.startsAt < "2027-02-05T09:00")) {
        const r = await run(attendanceSet, { activityId: a.id, status: "absent_invalid" }, amira());
        if (!r.ok) throw new Error(r.message);
      }
      const c = rows("cases").find((x) => x.id === CASES.nadia)!;
      const db = { activities: rows("activities"), attendance: rows("attendance") };
      const weeks = billableWeeks(c, db, { now: NOW });
      const contract = rows("contracts").find((x) => x.id === c.contractId)!;
      const lines = billingLines(
        { cases: rows("cases"), activities: rows("activities"), attendance: rows("attendance"), price_items: rows("price_items"), billing_week_approvals: rows("billing_week_approvals") },
        "2027-02", { now: NOW, cfg: requireOperational(contract.config) },
      ).filter((l) => l.caseId === CASES.nadia);
      return { actId, weeks, lines };
    };
    const g = await scenario(true);
    const own = await scenario(false);
    expect(g.weeks).toEqual(own.weeks);
    const w5 = g.weeks.find((w) => w.key === "2027-W05")!;
    expect(w5).toMatchObject({ zeroAttendance: true, missingRegistration: false, attended: 0 });
    expect(w5.planned).toBe(w5.registered);
    // Fakturaraden: samma veckor, belopp och kontroller (nollnärvaroveckan flaggas i båda).
    expect(JSON.stringify(g.lines)).toBe(JSON.stringify(own.lines));
    expect(g.lines[0]?.checks.map((x) => x.kind)).toContain("zero_week");
  });
});
