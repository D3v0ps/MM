// Återkommande nivåaktiviteter och målgruppen (Karims beslut 2026-10-22) genom samma execute() som appen och prototypen, mot
// testdatat i minnet (demoklockan: måndag 1 februari 2027 kl. 09.12):
//   * aktiviteter.serieSkapa: tillfällena från i dag och 14 dagar framåt, målgruppen inbjuden, meddelandet av som standard
//   * jobbets steg (ensureGroupActivities): nya tillfällen när dagarna går, aldrig ett inställt tillfälle igen, idempotent
//   * aktiviteter.serieAndra och aktiviteter.serieAvsluta, och att ett tillfälle i en serie inte får ny tid
//   * målgruppen hålls aktuell: en avslutad insats tas bort ur kommande tillfällen, startade tillfällen, rader med närvaro och
//     manuellt inbjudna rörs aldrig
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import { SYSTEM_ACTOR, type Actor, type Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { TableName, Tables } from "@/data/schema";
import { caseClose } from "@/features/arenden/api";
import { attendanceSet } from "@/features/coach/api";
import "@/api/handlers";
import {
  groupActivityCancel, groupActivityInvite, groupActivityList, groupActivitySeriesCreate, groupActivitySeriesEnd, groupActivitySeriesUpdate, groupActivityUpdate,
  groupActivityView,
} from "./api";
import { ensureGroupActivities, syncAudienceInvites } from "./audience-sync";

const SEED: MemoryData<Tables> = createSeed();
const NADIA = "case-260143";
const MEHMET = "case-260130";
const L = (n: number) => `grp-c-bot-niva-${n}`;

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
const occurrencesOf = (seriesId: string) => rows("group_activities").filter((g) => g.seriesId === seriesId).sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
const partsOf = (id: string) => rows("activities").filter((a) => a.groupActivityId === id);
const system = () => rt.ctxFor(SYSTEM_ACTOR);
const plan = { name: "Studiebesök", kind: "annat" as const, weekdays: [2, 4], startTime: "15:00", durationMin: 60, location: "Miljonbemanning Alby", startsOn: "2027-02-01" };
async function createSeries(extra: Partial<ParamsOf<typeof groupActivitySeriesCreate>> = {}) {
  const res = await run(groupActivitySeriesCreate, { ...plan, audience: { kind: "level", levelId: L(3) }, ...extra }, amira());
  if (!res.ok) throw new Error(`${res.error}: ${res.message}`);
  return res;
}

describe("ny återkommande aktivitet (aktiviteter.serieSkapa)", () => {
  it("tisdag och torsdag 15.00 för nivå 3: fyra tillfällen de närmaste 14 dagarna, nivån inbjuden, inget meddelande – loggad utan namn", async () => {
    const messages = rows("outbound_messages").length;
    const res = await createSeries();
    const occ = occurrencesOf(res.seriesId);
    expect(res.occurrences).toBe(4);
    expect(occ.map((g) => g.startsAt)).toEqual(["2027-02-02T15:00", "2027-02-04T15:00", "2027-02-09T15:00", "2027-02-11T15:00"]);
    expect(res.firstId).toBe(occ[0].id);
    expect(occ.every((g) => g.audience === "level" && g.audienceLevelId === L(3) && g.notify === false && g.name === "Studiebesök" && g.durationMin === 60)).toBe(true);
    expect(rows("group_activity_series").find((s) => s.id === res.seriesId)).toMatchObject({ weekdays: [2, 4], startTime: "15:00", notify: false, endedAt: null, createdBy: "u-amira" });
    // Nivåns aktiva deltagare bjuds in till varje tillfälle (källan audience); inget meddelande utan att det slagits på.
    const invited = occ.flatMap((g) => partsOf(g.id));
    expect(res.invited).toBe(invited.length);
    expect(invited.length).toBeGreaterThan(0);
    expect(invited.every((a) => a.inviteSource === "audience" && a.startsAt.endsWith("T15:00") && a.location === "Miljonbemanning Alby")).toBe(true);
    expect(partsOf(occ[0].id).map((a) => a.caseId)).toContain(MEHMET);
    expect(rows("outbound_messages")).toHaveLength(messages);
    // Loggen: koder, tider och id:n – aldrig namnet eller platsen.
    const created = audit("group_activity_series.created").at(-1)!;
    expect(created).toMatchObject({ entity: "group_activity_series", entityId: res.seriesId, details: { weekdays: [2, 4], startTime: "15:00", audience: "level", audienceId: L(3), notify: false } });
    expect(audit("group_activity_series.occurrences_created").at(-1)!.details).toEqual({ count: 4, groupActivityIds: occ.map((g) => g.id) });
    expect(JSON.stringify(rows("audit_log").slice(-20))).not.toMatch(/Studiebesök|Alby/);
    // Listan: Återkommande med texten och nästa tillfälle.
    const list = await q(groupActivityList, {}, amira());
    expect(list.series.find((s) => s.id === res.seriesId)).toMatchObject({ schedule: "tis och tor 15.00", upcoming: 4, next: { id: occ[0].id, startsAt: "2027-02-02T15:00" }, notify: false, audienceLabel: "Nivå 3 – På väg" });
    // Tillfällets vy visar serien.
    const view = await q(groupActivityView, { id: occ[0].id }, amira());
    expect(view.kind === "ok" && view.activity.series).toMatchObject({ id: res.seriesId, schedule: "tis och tor 15.00", ended: false });
  });

  it("meddelandet påslaget: deltagarna får en inbjudan med bara tid, plats och telefonnummer", async () => {
    const before = rows("outbound_messages").length;
    const res = await createSeries({ weekdays: [5], audience: { kind: "area", areaCode: "E" }, notify: true });
    expect(res.occurrences).toBe(2);
    const sent = rows("outbound_messages").slice(before);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((m) => m.template === "aktivitetsinbjudan")).toBe(true);
    for (const m of sent) expect(m.body).not.toMatch(/BOT-\d|Studiebesök|insats|kommun/i);
  });

  it("dagar, tid, datum och målgrupp prövas; chef, ekonom och kommunen skapar inte", async () => {
    await expect(run(groupActivitySeriesCreate, { ...plan, weekdays: [], audience: { kind: "level", levelId: L(3) } }, amira())).rejects.toBeInstanceOf(ApiError);
    await expect(run(groupActivitySeriesCreate, { ...plan, weekdays: [6], audience: { kind: "level", levelId: L(3) } }, amira())).rejects.toBeInstanceOf(ApiError);
    expect(await run(groupActivitySeriesCreate, { ...plan, weekdays: [2, 2], audience: { kind: "level", levelId: L(3) } }, amira())).toMatchObject({ ok: false, error: "invalid" });
    expect(await run(groupActivitySeriesCreate, { ...plan, startsOn: "2027-01-29", audience: { kind: "level", levelId: L(3) } }, amira())).toMatchObject({ ok: false, error: "invalid" });
    expect(await run(groupActivitySeriesCreate, { ...plan, endsOn: "2027-01-31", audience: { kind: "level", levelId: L(3) } }, amira())).toMatchObject({ ok: false, error: "invalid" });
    expect(await run(groupActivitySeriesCreate, { ...plan, audience: { kind: "level", levelId: "grp-c-bot-vill-arbeta-heltid" } }, amira())).toMatchObject({ ok: false, error: "audience" });
    expect(await run(groupActivitySeriesCreate, { ...plan, audience: { kind: "area", areaCode: "Z" } }, amira())).toMatchObject({ ok: false, error: "audience" });
    for (const a of [as("u-karin", "chef"), as("u-lars", "ekonom"), as("k-maria")]) {
      await expect(run(groupActivitySeriesCreate, { ...plan, audience: { kind: "level", levelId: L(3) } }, a), a.role).rejects.toBeInstanceOf(ApiError);
    }
    expect(rows("group_activity_series")).toHaveLength(SEED.group_activity_series.length);
  });
});

describe("tillfällena över tid, ändra och avsluta", () => {
  it("ett inställt tillfälle skapas aldrig igen; nya tillfällen kommer när dagarna går; jobbets steg är idempotent", async () => {
    const res = await createSeries();
    const [, second] = occurrencesOf(res.seriesId);
    expect(await run(groupActivityCancel, { id: second.id }, amira())).toMatchObject({ ok: true });
    expect(await ensureGroupActivities(system())).toEqual({ created: 0, changed: 0 });
    expect(occurrencesOf(res.seriesId).filter((g) => g.startsAt === second.startsAt)).toHaveLength(1);
    // En vecka senare: tillfällena fram till 22 februari (tisdag 16 och torsdag 18 kommer till) – också i testdatats serier.
    rt.clock.set("2027-02-08T09:00");
    const later = await ensureGroupActivities(system());
    expect(later.created).toBeGreaterThan(2);
    expect(occurrencesOf(res.seriesId).map((g) => [g.startsAt, !!g.cancelledAt])).toEqual([
      ["2027-02-02T15:00", false], ["2027-02-04T15:00", true], ["2027-02-09T15:00", false], ["2027-02-11T15:00", false], ["2027-02-16T15:00", false], ["2027-02-18T15:00", false],
    ]);
    expect(partsOf(occurrencesOf(res.seriesId)[4].id).length).toBeGreaterThan(0);
    expect(await ensureGroupActivities(system())).toEqual({ created: 0, changed: 0 });
  });

  it("ett tillfälle i en serie får inte ny dag eller tid – men namnet går att ändra; serieAndra ändrar alla kommande", async () => {
    const res = await createSeries();
    const occ = occurrencesOf(res.seriesId);
    const base = { name: occ[1].name, kind: occ[1].kind, startsAt: occ[1].startsAt, durationMin: occ[1].durationMin, location: occ[1].location };
    expect(await run(groupActivityUpdate, { id: occ[1].id, ...base, startsAt: "2027-02-04T16:00" }, amira())).toMatchObject({ ok: false, error: "series" });
    expect(await run(groupActivityUpdate, { id: occ[1].id, ...base, name: "Studiebesök – lager" }, amira())).toMatchObject({ ok: true, changed: 1 });
    const upd = await run(groupActivitySeriesUpdate, { id: res.seriesId, name: "Studiebesök 2", location: "Tumba", responsibleId: null, goal: null, notify: false }, amira());
    expect(upd).toMatchObject({ ok: true, changed: 2, occurrences: 4, notified: null });
    expect(occurrencesOf(res.seriesId).map((g) => [g.name, g.location])).toEqual(occ.map(() => ["Studiebesök 2", "Tumba"]));
    expect(occurrencesOf(res.seriesId).flatMap((g) => partsOf(g.id)).every((a) => a.location === "Tumba")).toBe(true);
    expect(audit("group_activity_series.updated").at(-1)!.details).toMatchObject({ fields: ["name", "location"], occurrences: 4 });
    expect(JSON.stringify(audit("group_activity_series.updated"))).not.toMatch(/Tumba|Studiebesök/);
    // Inget ändrat: ingen skrivning.
    expect(await run(groupActivitySeriesUpdate, { id: res.seriesId, name: "Studiebesök 2", location: "Tumba", responsibleId: null, goal: null, notify: false }, amira())).toMatchObject({ ok: true, changed: 0 });
  });

  it("Avsluta hela serien: kommande tillfällen ställs in och deltagarnas rader tas bort – inga nya skapas, och den kan inte ändras igen", async () => {
    const res = await createSeries();
    const occ = occurrencesOf(res.seriesId);
    const end = await run(groupActivitySeriesEnd, { id: res.seriesId }, amira());
    expect(end).toMatchObject({ ok: true, cancelled: 4, kept: 0, notified: null });
    expect(rows("group_activity_series").find((s) => s.id === res.seriesId)).toMatchObject({ endsOn: "2027-02-01", endedBy: "u-amira" });
    expect(occurrencesOf(res.seriesId).every((g) => g.cancelledAt)).toBe(true);
    expect(occ.flatMap((g) => partsOf(g.id))).toEqual([]);
    expect(audit("group_activity_series.ended").at(-1)!.details).toMatchObject({ endsOn: "2027-02-01", cancelled: 4, kept: 0 });
    rt.clock.set("2027-02-08T09:00");
    await ensureGroupActivities(system());
    expect(occurrencesOf(res.seriesId)).toHaveLength(4);
    expect(await run(groupActivitySeriesEnd, { id: res.seriesId }, amira())).toMatchObject({ ok: false, error: "ended" });
    expect(await run(groupActivitySeriesUpdate, { id: res.seriesId, name: "X", location: "Y", responsibleId: null, goal: null, notify: false }, amira())).toMatchObject({ ok: false, error: "ended" });
    expect((await q(groupActivityList, {}, amira())).series.some((s) => s.id === res.seriesId)).toBe(false);
  });
});

describe("målgruppen hålls aktuell (syncAudienceInvites)", () => {
  const LEVEL_4 = ["ga-ser-c-bot-niva-4-2027-02-08", "ga-ser-c-bot-niva-4-2027-02-10", "ga-ser-c-bot-niva-4-2027-02-15"];
  const nadiaIn = () => rows("activities").filter((a) => a.caseId === NADIA && a.groupActivityId).map((a) => a.groupActivityId).sort();

  it("en avslutad insats tas bort ur kommande tillfällen – det som har börjat och raden med närvaro ligger kvar", async () => {
    expect(nadiaIn()).toEqual([...LEVEL_4, "ga-traff-c-bot-g-2027-02"].sort());
    // Måndag 8 februari 14.00: nivå 4:s tillfälle 13.30 har börjat och Nadia är där.
    rt.clock.set("2027-02-08T14:00");
    const first = rows("activities").find((a) => a.caseId === NADIA && a.groupActivityId === LEVEL_4[0])!;
    expect(await run(attendanceSet, { activityId: first.id, status: "present" }, amira())).toMatchObject({ ok: true });
    // Dagens första anrop skapade också nya tillfällen fram till 22 februari (jobbets steg) – Nadia bjöds in till nivå 4:s.
    const beforeClose = nadiaIn();
    expect(beforeClose.length).toBeGreaterThan(LEVEL_4.length + 1);
    expect(await run(caseClose, { caseId: NADIA, endDate: "2027-02-08", endReason: "avbrott_flytt" }, amira())).toMatchObject({ ok: true });
    expect(nadiaIn()).toEqual([LEVEL_4[0]]);
    const log = audit("group_activity.audience_synced").filter((x) => (x.details as { removedCaseIds?: string[] }).removedCaseIds?.includes(NADIA));
    expect(log.map((x) => x.entityId).sort()).toEqual(beforeClose.filter((id) => id !== LEVEL_4[0]));
    expect(log.map((x) => x.entityId)).toEqual(expect.arrayContaining([LEVEL_4[1], LEVEL_4[2], "ga-traff-c-bot-g-2027-02"]));
    expect(log.every((x) => (x.details as { automatic?: boolean }).automatic === true)).toBe(true);
    expect(JSON.stringify(log)).not.toMatch(/Nadia|Jobbsök/);
  });

  it("manuellt inbjudna rörs aldrig – och en andra synkning ändrar ingenting", async () => {
    // Mehmet (nivå 3) bjuds in för hand till nivå 4:s tillfälle onsdag 10 februari.
    expect(await run(groupActivityInvite, { id: LEVEL_4[1], caseIds: [MEHMET] }, amira())).toMatchObject({ ok: true, invited: 1 });
    const ctx = system();
    const r = await syncAudienceInvites(ctx, { contractId: "c-bot" });
    expect([r.added, r.removed]).toEqual([0, 0]);
    expect(partsOf(LEVEL_4[1]).find((a) => a.caseId === MEHMET)).toMatchObject({ inviteSource: "manual" });
    // Bara de angivna ärendena prövas.
    expect(await syncAudienceInvites(ctx, { contractId: "c-bot", caseIds: [MEHMET, NADIA] })).toMatchObject({ added: 0, removed: 0 });
  });
});
