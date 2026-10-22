// Granskningen av målgruppen och de återkommande aktiviteterna (Karims beslut 2026-10-22), genom samma execute() som appen och
// prototypen, mot testdatat i minnet (demoklockan: måndag 1 februari 2027 kl. 09.12):
//   * en serie som inte har börjat kan avslutas (sista dagen blir seriens första dag)
//   * byte av nivå: deltagaren tas bort ur den gamla nivåns tillfälle och bjuds in till den nya nivåns vid samma tid
//   * en aktivitet med målgrupp kan flyttas – den som målgruppen bjöd in och inte kan vara med tas bort i stället för att stoppa
//   * den som hör till målgruppen kan inte tas bort för hand, oavsett hur hen bjöds in
//   * samtidiga skrivningar: en rad som redan är borta, en serie som avslutas medan tillfällen skapas, en aktivitet som ställs in
//     medan synkningen bjuder in
//   * vilande spärren (påslagen): en deltagare med skyddade personuppgifter bjuds aldrig in automatiskt
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import { SYSTEM_ACTOR, type Actor, type Role } from "@/api/roles";
import type { Ctx } from "@/api/server";
import { overlaps } from "@/core/group-activities";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { TableName, Tables } from "@/data/schema";
import { caseLevelSet } from "@/features/grupper/api";
import "@/api/handlers";
import {
  groupActivityCancel, groupActivityCreate, groupActivityInvite, groupActivityRemove, groupActivitySeriesCreate, groupActivitySeriesEnd, groupActivityUpdate, groupActivityView,
} from "./api";
import { ensureGroupActivities, ensureSeriesOccurrences, removeParticipantRow, syncAudienceInvites } from "./audience-sync";

const SEED: MemoryData<Tables> = createSeed();
const NADIA = "case-260143";
const L = (n: number) => `grp-c-bot-niva-${n}`;
const TRAFF_G = "ga-traff-c-bot-g-2027-02";

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
const system = () => rt.ctxFor(SYSTEM_ACTOR);
const occurrencesOf = (seriesId: string) => rows("group_activities").filter((g) => g.seriesId === seriesId).sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
const partsOf = (id: string) => rows("activities").filter((a) => a.groupActivityId === id);
const groupOf = (id: string) => rows("group_activities").find((g) => g.id === id)!;
const plan = { name: "Studiebesök", kind: "annat" as const, weekdays: [2, 4], startTime: "15:00", durationMin: 60, location: "Miljonbemanning Alby" };

/** Ett systemsteg där en tabells insert gör något mer efteråt (en samtidig skrivning mitt i steget). */
function withAfterInsert(ctx: Ctx, table: TableName, after: () => void): Ctx {
  let done = false;
  const base = ctx.system;
  const system = {
    table: (name: TableName) => {
      const t = base.table(name);
      if (name !== table) return t;
      return {
        ...t,
        insert: async (row: never) => {
          const r = await t.insert(row);
          if (!done) {
            done = true;
            after();
          }
          return r;
        },
      };
    },
  } as unknown as Ctx["system"];
  return { ...ctx, system };
}

describe("en serie som inte har börjat", () => {
  it("kan avslutas: sista dagen blir seriens första dag, tillfällena ställs in och inga nya skapas", async () => {
    const res = await run(groupActivitySeriesCreate, { ...plan, startsOn: "2027-02-08", audience: { kind: "level", levelId: L(3) } }, amira());
    if (!res.ok) throw new Error(res.message);
    expect(occurrencesOf(res.seriesId).map((g) => g.startsAt)).toEqual(["2027-02-09T15:00", "2027-02-11T15:00"]);
    expect(occurrencesOf(res.seriesId).flatMap((g) => partsOf(g.id)).length).toBeGreaterThan(0);
    const end = await run(groupActivitySeriesEnd, { id: res.seriesId }, amira());
    expect(end).toMatchObject({ ok: true, cancelled: 2, kept: 0 });
    expect(rows("group_activity_series").find((s) => s.id === res.seriesId)).toMatchObject({ startsOn: "2027-02-08", endsOn: "2027-02-08", endedBy: "u-amira" });
    expect(occurrencesOf(res.seriesId).every((g) => g.cancelledAt)).toBe(true);
    expect(occurrencesOf(res.seriesId).flatMap((g) => partsOf(g.id))).toEqual([]);
    rt.clock.set("2027-02-08T09:00");
    await ensureGroupActivities(system());
    expect(occurrencesOf(res.seriesId)).toHaveLength(2);
  });

  it("avslutas medan jobbet skapar tillfällen: det nya tillfället ställs in direkt och ingen bjuds in", async () => {
    const res = await run(groupActivitySeriesCreate, { ...plan, startsOn: "2027-02-01", audience: { kind: "level", levelId: L(3) } }, amira());
    if (!res.ok) throw new Error(res.message);
    rt.clock.set("2027-02-08T09:00");
    const before = occurrencesOf(res.seriesId).length;
    // Avslutet hinner sättas medan jobbet skapar tillfällena (efter jobbets läsning av serierna).
    const ctx = withAfterInsert(system(), "group_activities", () => {
      rt.store.updateRow("group_activity_series", res.seriesId, { endsOn: "2027-02-08", endedAt: "2027-02-08T09:00", endedBy: "u-amira" });
    });
    const out = await ensureSeriesOccurrences(ctx, { seriesIds: [res.seriesId] });
    expect(out.created).toEqual([]);
    const fresh = occurrencesOf(res.seriesId).slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((g) => g.cancelledAt && g.cancelledBy === "u-amira")).toBe(true);
    expect(fresh.flatMap((g) => partsOf(g.id))).toEqual([]);
  });
});

describe("byte av nivå när två nivåer har samma tid", () => {
  it("Nadia från nivå 4 till nivå 2 (båda måndag och onsdag 13.30): bort ur nivå 4:s tillfällen och inbjuden till nivå 2:s", async () => {
    const level = (n: number) => rows("activities").filter((a) => a.caseId === NADIA && a.groupActivityId?.startsWith(`ga-ser-c-bot-niva-${n}-`)).map((a) => a.startsAt).sort();
    const nivå4 = level(4);
    expect(nivå4.length).toBeGreaterThan(0);
    expect(level(2)).toEqual([]);
    const res = await run(caseLevelSet, { caseId: NADIA, levelId: L(2), fromLevelId: L(4) }, amira());
    expect(res).toMatchObject({ ok: true, removed: nivå4.length, invited: nivå4.length });
    expect(level(4)).toEqual([]);
    expect(level(2)).toEqual(nivå4);
    // En andra synkning ändrar ingenting.
    expect(await syncAudienceInvites(system(), { contractId: "c-bot" })).toMatchObject({ added: 0, removed: 0 });
  });
});

describe("en aktivitet med målgrupp flyttas", () => {
  it("till en tid där flera i yrkesområdet redan har sin nivås tillfälle: flyttas, och de tas bort ur träffen i stället", async () => {
    const g = groupOf(TRAFF_G);
    const before = partsOf(TRAFF_G);
    expect(before.length).toBeGreaterThan(0);
    const startsAt = "2027-02-15T13:30";
    const res = await run(groupActivityUpdate, { id: TRAFF_G, name: g.name, kind: g.kind, startsAt, durationMin: g.durationMin, location: g.location }, amira());
    expect(res).toMatchObject({ ok: true, changed: 1 });
    if (!res.ok) return;
    expect(res.dropped).toBeGreaterThan(0);
    const after = partsOf(TRAFF_G);
    expect(after.length).toBe(before.length - res.dropped);
    expect(after.every((a) => a.startsAt === startsAt)).toBe(true);
    // Ingen deltagare har två tillfällen samtidigt.
    for (const a of after) {
      const others = rows("activities").filter((x) => x.caseId === a.caseId && x.id !== a.id && x.startsAt.slice(0, 10) === "2027-02-15");
      expect(others.filter((x) => overlaps(x, a)), a.caseId).toEqual([]);
    }
    const log = rt.store.rows("audit_log").filter((x) => x.action === "group_activity.updated").at(-1)!;
    expect((log.details as { droppedCaseIds?: string[] }).droppedCaseIds).toHaveLength(res.dropped);
  });

  it("en insats som slutar före den nya dagen faller bort ur träffen – manuellt inbjudna prövas som förut", async () => {
    const g = groupOf(TRAFF_G);
    const someone = partsOf(TRAFF_G)[0];
    rt.store.updateRow("cases", someone.caseId, { endDate: "2027-02-20" });
    const res = await run(groupActivityUpdate, { id: TRAFF_G, name: g.name, kind: g.kind, startsAt: "2027-02-24T15:30", durationMin: g.durationMin, location: g.location }, amira());
    expect(res).toMatchObject({ ok: true });
    expect(partsOf(TRAFF_G).some((a) => a.caseId === someone.caseId)).toBe(false);
  });
});

describe("den som hör till målgruppen tas inte bort för hand", () => {
  it("Nadia inbjuden för hand, sedan får aktiviteten yrkesområdet G: Ta bort nekas med orsaken, vyn säger att hen hör till målgruppen", async () => {
    const created = await run(groupActivityCreate, { name: "Studiebesök", kind: "annat", startsAt: "2027-02-12T10:00", durationMin: 60, location: "Alby", caseIds: [NADIA] }, amira());
    if (!created.ok) throw new Error(created.message);
    const id = created.groupActivityId;
    expect(await run(groupActivityInvite, { id, caseIds: [], audience: { kind: "area", areaCode: "G" } }, amira())).toMatchObject({ ok: true });
    expect(partsOf(id).find((a) => a.caseId === NADIA)).toMatchObject({ inviteSource: "manual" });
    const removed = await run(groupActivityRemove, { id, caseId: NADIA }, amira());
    expect(removed).toMatchObject({ ok: false, error: "audience" });
    expect(!removed.ok && removed.message).toMatch(/yrkesområde/);
    const view = await q(groupActivityView, { id }, amira());
    expect(view.kind === "ok" && view.participants.find((p) => p.caseId === NADIA)).toMatchObject({ audienceMember: true, inviteSource: "manual" });
  });

  it("nivåns aktivitet: texten säger nivå; den som inte hör till målgruppen kan tas bort", async () => {
    const level4 = "ga-ser-c-bot-niva-4-2027-02-08";
    const r = await run(groupActivityRemove, { id: level4, caseId: NADIA }, amira());
    expect(!r.ok && r.message).toMatch(/nivå/);
    const other = rows("cases").find((c) => c.status === "active" && c.contractId === "c-bot" && !partsOf(level4).some((a) => a.caseId === c.id))!;
    expect(await run(groupActivityInvite, { id: level4, caseIds: [other.id] }, amira())).toMatchObject({ ok: true, invited: 1 });
    const view = await q(groupActivityView, { id: level4 }, amira());
    expect(view.kind === "ok" && view.participants.find((p) => p.caseId === other.id)).toMatchObject({ audienceMember: false });
    expect(await run(groupActivityRemove, { id: level4, caseId: other.id }, amira())).toMatchObject({ ok: true });
  });
});

describe("samtidiga skrivningar", () => {
  it("en rad som redan är borta räknas som borttagen (gone) – inget fel", async () => {
    const ctx = system();
    const a = partsOf(TRAFF_G)[0];
    expect(await removeParticipantRow(ctx, ctx.system, a.id)).toBe("removed");
    expect(await removeParticipantRow(ctx, ctx.system, a.id)).toBe("gone");
    expect(await removeParticipantRow(ctx, ctx.repo, a.id)).toBe("gone");
  });

  it("aktiviteten ställs in medan synkningen bjuder in: de nya raderna tas bort igen", async () => {
    const created = await run(groupActivityCreate, { name: "Studiebesök", kind: "annat", startsAt: "2027-02-12T10:00", durationMin: 60, location: "Alby", caseIds: [] }, amira());
    if (!created.ok) throw new Error(created.message);
    const id = created.groupActivityId;
    rt.store.updateRow("group_activities", id, { audience: "area", audienceAreaCode: "G", audienceLevelId: null });
    const ctx = withAfterInsert(system(), "activities", () => {
      rt.store.updateRow("group_activities", id, { cancelledAt: "2027-02-01T09:20", cancelledBy: "u-amira" });
    });
    const r = await syncAudienceInvites(ctx, { contractId: "c-bot", groupActivityIds: [id] });
    expect(r.added).toBe(0);
    expect(partsOf(id)).toEqual([]);
  });

  it("Ställ in: rader som synkningen hann skriva efter läsningen sopas bort", async () => {
    const created = await run(groupActivityCreate, { name: "Studiebesök", kind: "annat", startsAt: "2027-02-12T10:00", durationMin: 60, location: "Alby", caseIds: [] }, amira());
    if (!created.ok) throw new Error(created.message);
    const id = created.groupActivityId;
    expect(await run(groupActivityInvite, { id, caseIds: [], audience: { kind: "area", areaCode: "G" } }, amira())).toMatchObject({ ok: true });
    expect(partsOf(id).length).toBeGreaterThan(0);
    expect(await run(groupActivityCancel, { id }, amira())).toMatchObject({ ok: true, kept: 0 });
    expect(partsOf(id)).toEqual([]);
  });
});

describe("vilande spärren (påslagen): skyddade personuppgifter", () => {
  const protect = () => rt.store.updateRow("persons", rows("cases").find((c) => c.id === NADIA)!.personId, { protectedIdentity: true });

  it("en skyddad deltagare bjuds aldrig in automatiskt – inte till en ny serie, en ny träff eller av jobbet", async () => {
    protect();
    // Jobbet tar bort Nadia ur de automatiska inbjudningarna (hon hör inte längre till målgruppen automatiskt).
    await ensureGroupActivities(system());
    expect(rows("activities").filter((a) => a.caseId === NADIA && a.groupActivityId && a.inviteSource === "audience" && a.startsAt > "2027-02-01T09:12")).toEqual([]);
    const sara = as("u-sara", "samordnare");
    const series = await run(groupActivitySeriesCreate, { ...plan, weekdays: [1, 3], startTime: "16:00", startsOn: "2027-02-01", audience: { kind: "level", levelId: L(4) } }, sara);
    if (!series.ok) throw new Error(series.message);
    expect(occurrencesOf(series.seriesId).flatMap((g) => partsOf(g.id)).some((a) => a.caseId === NADIA)).toBe(false);
    const meeting = await run(groupActivityCreate, { name: "Träff", kind: "annat", startsAt: "2027-02-12T10:00", durationMin: 60, location: "Alby", caseIds: [], audience: { kind: "area", areaCode: "G" } }, sara);
    if (!meeting.ok) throw new Error(meeting.message);
    expect(partsOf(meeting.groupActivityId).some((a) => a.caseId === NADIA)).toBe(false);
    // Samordnaren kan fortfarande avsluta sin serie (ingen dold deltagare).
    expect(await run(groupActivitySeriesEnd, { id: series.seriesId }, sara)).toMatchObject({ ok: true });
  });
});

/** Ett systemsteg där en tabells insert alltid kastar (ett databasfel eller en tidsgräns mitt i steget). */
function withFailingInsert(ctx: Ctx, table: TableName): Ctx {
  const base = ctx.system;
  const system = {
    table: (name: TableName) => {
      const t = base.table(name);
      if (name !== table) return t;
      return { ...t, insert: async () => { throw Object.assign(new Error("Databasfel (57014)"), { code: "57014" }); } };
    },
  } as unknown as Ctx["system"];
  return { ...ctx, system };
}

describe("granskningen, andra rundan", () => {
  it("en deltagare som bjöds in för hand och hör till målgruppen stoppar inte en flytt – hen tas bort när hen inte kan vara med", async () => {
    const created = await run(groupActivityCreate, { name: "Studiebesök", kind: "annat", startsAt: "2027-02-12T10:00", durationMin: 60, location: "Alby", caseIds: [NADIA] }, amira());
    if (!created.ok) throw new Error(created.message);
    const id = created.groupActivityId;
    expect(await run(groupActivityInvite, { id, caseIds: [], audience: { kind: "area", areaCode: "G" } }, amira())).toMatchObject({ ok: true });
    expect(partsOf(id).find((a) => a.caseId === NADIA)).toMatchObject({ inviteSource: "manual" });
    // Måndag 8 februari 13.00–14.00: Nadia har nivå 4:s tillfälle 13.30 – hon kan inte vara med vid den nya tiden.
    const moved = await run(groupActivityUpdate, { id, name: "Studiebesök", kind: "annat", startsAt: "2027-02-08T13:00", durationMin: 60, location: "Alby" }, amira());
    expect(moved).toMatchObject({ ok: true, changed: 1 });
    expect(partsOf(id).some((a) => a.caseId === NADIA)).toBe(false);
    const log = rows("audit_log").filter((x) => x.action === "group_activity.updated" && x.entityId === id).at(-1)!;
    expect((log.details as { droppedCaseIds?: string[] }).droppedCaseIds).toContain(NADIA);
    // Ingen deltagare har två tillfällen samtidigt.
    for (const a of partsOf(id)) {
      const others = rows("activities").filter((x) => x.caseId === a.caseId && x.id !== a.id && x.startsAt.slice(0, 10) === "2027-02-08");
      expect(others.filter((x) => overlaps(x, a)), a.caseId).toEqual([]);
    }
  });

  it("synkningen loggar varje borttagning innan något bjuds in – ett fel när inbjudningarna skrivs lämnar ingen borttagen rad utan logg", async () => {
    const level = (n: number) => rows("activities").filter((a) => a.caseId === NADIA && a.groupActivityId?.startsWith(`ga-ser-c-bot-niva-${n}-`));
    const before = level(4).map((a) => a.groupActivityId!).sort();
    expect(before.length).toBeGreaterThan(1);
    const m = rows("grouping_members").find((x) => x.caseId === NADIA && x.kind === "level" && !x.removedAt)!;
    rt.store.updateRow("grouping_members", m.id, { groupingId: L(3) });
    await expect(syncAudienceInvites(withFailingInsert(system(), "activities"), { contractId: "c-bot", caseIds: [NADIA] })).rejects.toThrow();
    expect(level(4)).toEqual([]);
    const logged = rows("audit_log")
      .filter((r) => r.action === "group_activity.audience_synced" && ((r.details as { removedCaseIds?: string[] }).removedCaseIds ?? []).includes(NADIA))
      .map((r) => r.entityId)
      .sort();
    expect(logged).toEqual(before);
  });

  it("en ny nivåserie säger hur många i målgruppen som redan har ett annat tillfälle – tillfället visar vilka och kan ersätta deras egna tillfällen", async () => {
    const res = await run(groupActivitySeriesCreate, { ...plan, name: "Morgonpass", weekdays: [1, 3], startTime: "09:00", startsOn: "2027-02-01", audience: { kind: "level", levelId: L(2) } }, amira());
    if (!res.ok) throw new Error(res.message);
    expect(res.skipped).toBeGreaterThan(0);
    let busyView: Extract<ResultOf<typeof groupActivityView>, { kind: "ok" }> | null = null;
    for (const g of occurrencesOf(res.seriesId)) {
      const v = await q(groupActivityView, { id: g.id }, amira());
      if (v.kind === "ok" && v.audienceBusy.some((x) => x.replaceable)) {
        busyView = v;
        break;
      }
    }
    expect(busyView).not.toBeNull();
    const busy = busyView!.audienceBusy.filter((x) => x.replaceable);
    // Bara deltagare i målgruppen som inte är inbjudna, med orsaken.
    for (const x of busyView!.audienceBusy) {
      expect(busyView!.participants.some((p) => p.caseId === x.caseId)).toBe(false);
      expect(x.reason).toMatch(/^(Har redan|Är redan inbjuden)/);
    }
    const invited = await run(groupActivityInvite, { id: busyView!.activity.id, caseIds: busy.map((x) => x.caseId), replaceOverlapping: true }, amira());
    expect(invited).toMatchObject({ ok: true, invited: busy.length, replaced: expect.any(Number) });
    const after = await q(groupActivityView, { id: busyView!.activity.id }, amira());
    expect(after.kind === "ok" && after.audienceBusy.filter((x) => x.replaceable)).toEqual([]);
  });

  it("en inställd aktivitet och en aktivitet utan målgrupp listar inga upptagna deltagare", async () => {
    const created = await run(groupActivityCreate, { name: "Studiebesök", kind: "annat", startsAt: "2027-02-12T10:00", durationMin: 60, location: "Alby", caseIds: [NADIA] }, amira());
    if (!created.ok) throw new Error(created.message);
    const v = await q(groupActivityView, { id: created.groupActivityId }, amira());
    expect(v.kind === "ok" && v.audienceBusy).toEqual([]);
    expect(await run(groupActivityCancel, { id: TRAFF_G }, amira())).toMatchObject({ ok: true });
    const c = await q(groupActivityView, { id: TRAFF_G }, amira());
    expect(c.kind === "ok" && c.audienceBusy).toEqual([]);
  });
});
