// Automatisk närvaro (Karims beslut 1, 2026-10-09) mot testdatat i minnet: jobbets funktion registrerar Närvarande med källan
// "auto" för passerade tillfällen utan närvaro, är idempotent, rör aldrig manuell närvaro, hoppar över pausade och avslutade
// ärenden, helgdagar och veckor med skickad veckorapport, loggar en rad per körning (antal och id:n), publicerar veckorapporter
// som blir kompletta – och en automatisk rad som coachen ändrar blir manuell. Minnesläget kör den när klockan passerar dagens slut
// (med golvet) och "Kör nu" kör den direkt (utan golv).
import { beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_ACTOR, type Actor } from "@/api/roles";
import type { Ctx } from "@/api/server";
import { listPersonas } from "@/data/actors";
import { MemoryRepo, type MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START } from "@/data/seed";
import { TEST_PNR_CRYPTO } from "@/data/seed/pnr";
import type { Tables } from "@/data/schema";
import { adminIntegrations, adminRunJob } from "@/features/admin/api";
import { attendanceSet } from "@/features/coach/api";
import "@/api/handlers";
import { AUTO_ATTENDANCE_BY, autoAttendanceTime, runAutoAttendance } from "./auto-attendance";

const SEED: MemoryData<Tables> = createSeed();
/** Amiras oregistrerade tillfällen vecka 4 (testdatats scenario): Nadia och Hodan (Maria), Elif (Linda). */
const W4 = SEED.demo_tags.find((t) => t.tag === "w4MissingActivityIds")!.entityIds;
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});

const actor = (userId: string, role?: string): Actor => listPersonas(rt.raw()).find((p) => p.actor.userId === userId && (!role || p.actor.role === role))!.actor;
function systemCtx(): Ctx {
  const system = new MemoryRepo<Tables>(rt.store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as Ctx["system"];
  let seq = 0;
  const newId = (p: string) => `${p}-t${++seq}`;
  return {
    actor: SYSTEM_ACTOR, now: rt.clock.now, repo: system, system, newId, crypto: TEST_PNR_CRYPTO,
    audit: async (e) => {
      await system.table("audit_log").insert({ id: newId("log"), occurredAt: rt.clock.now(), actorId: "system", action: e.action, entity: e.entity, entityId: e.entityId, contractId: e.contractId ?? null, details: e.details ?? {} });
    },
    notify: async () => undefined,
  };
}
const att = () => rt.store.rows("attendance");
const auto = () => att().filter((a) => a.source === "auto");
const runs = () => rt.store.rows("audit_log").filter((l) => l.action === "attendance.auto_registered");

describe("runAutoAttendance", () => {
  it("måndag 18.05: Närvarande med källan auto för förra veckans och dagens passerade tillfällen utan närvaro – loggat med antal och id:n", async () => {
    const manualBefore = att().filter((a) => a.source === "manual").map((a) => JSON.stringify(a));
    rt.clock.set("2027-02-01T18:05");
    const res = await runAutoAttendance(systemCtx());
    expect(res.registered).toBe(50);
    expect(auto().map((a) => a.activityId)).toEqual(expect.arrayContaining(W4));
    for (const a of auto()) expect(a).toMatchObject({ status: "present", reason: "", registeredBy: AUTO_ATTENDANCE_BY, registeredAt: "2027-02-01T18:05", source: "auto" });
    // Manuell närvaro ändras aldrig.
    expect(att().filter((a) => a.source === "manual").map((a) => JSON.stringify(a))).toEqual(manualBefore);
    // En loggrad per avtal och körning: antal, tillfällen, närvaroposter och ärenden – aldrig namn.
    expect(runs()).toHaveLength(1);
    const log = runs()[0];
    expect(log).toMatchObject({ entity: "attendance", entityId: null, contractId: "c-bot", actorId: "system" });
    expect(log.details).toMatchObject({ count: 50, dayEndsAt: "18:00", days: ["2027-01-27", "2027-01-28", "2027-02-01"] });
    expect((log.details as { activityIds: string[] }).activityIds).toHaveLength(50);
    const text = JSON.stringify(log.details);
    for (const p of rt.store.rows("persons").slice(0, 50)) expect(text).not.toContain(p.lastName);
    // Vecka 4 är nu komplett: Marias och Lindas veckorapporter publiceras som vid manuell registrering.
    expect(res.published).toBe(2);
    const w4 = rt.store.rows("reports").filter((r) => r.kind === "weekly_attendance" && r.week === "2027-W04");
    expect(w4.every((r) => r.status === "delivered" || r.status === "opened")).toBe(true);
  });

  it("idempotent: en andra körning registrerar ingenting nytt och skriver aldrig över", async () => {
    rt.clock.set("2027-02-01T18:05");
    await runAutoAttendance(systemCtx());
    const first = JSON.stringify(att());
    rt.clock.set("2027-02-01T18:10");
    const again = await runAutoAttendance(systemCtx());
    expect(again.registered).toBe(0);
    expect(JSON.stringify(att())).toBe(first);
    expect(runs().map((l) => (l.details as { count: number }).count)).toEqual([50, 0]);
  });

  it("före dagens slut: bara förra veckans tillfällen – dagens väntar till klockslaget", async () => {
    rt.clock.set("2027-02-01T17:59");
    const res = await runAutoAttendance(systemCtx());
    expect(res.registered).toBe(6);
    expect(auto().map((a) => a.activityId).sort()).toEqual([...W4].sort());
  });

  it("hoppar över pausade och avslutade ärenden och helgdagar", async () => {
    const [nadia, elif] = [rt.store.rows("activities").find((a) => a.id === W4[0])!.caseId, rt.store.rows("activities").find((a) => a.id === W4[2])!.caseId];
    rt.store.updateRow("cases", nadia, { status: "paused" });
    rt.store.updateRow("cases", elif, { status: "closed" });
    rt.store.insertRow("holidays", { id: "2027-01-27", date: "2027-01-27", name: "Påhittad helgdag" });
    rt.clock.set("2027-02-01T17:59");
    const res = await runAutoAttendance(systemCtx());
    const caseOf = (id: string) => rt.store.rows("activities").find((a) => a.id === id)!;
    // Kvar: Hodans torsdag (onsdagen är helgdag). Nadia är pausad och Elif avslutad.
    expect(res.contracts[0].activityIds).toEqual(W4.filter((id) => ![nadia, elif].includes(caseOf(id).caseId) && !caseOf(id).startsAt.startsWith("2027-01-27")));
    expect(res.registered).toBe(1);
  });

  it("aldrig en vecka vars veckorapport redan skickats", async () => {
    // Ahmeds veckorapport för vecka 4 är levererad. Ett av hans ärendens tillfällen den veckan saknar plötsligt närvaro.
    const ahmedCase = rt.store.rows("cases").find((c) => c.referrerId === "k-ahmed" && c.status === "active")!;
    const act = rt.store.rows("activities").find((a) => a.caseId === ahmedCase.id && a.startsAt >= "2027-01-25" && a.startsAt < "2027-02-01")!;
    const row = att().find((a) => a.activityId === act.id)!;
    rt.store.removeRow("attendance", row.id);
    rt.clock.set("2027-02-01T17:59");
    const res = await runAutoAttendance(systemCtx());
    expect(res.contracts[0].activityIds).not.toContain(act.id);
    expect(res.registered).toBe(6);
  });

  it("avstängd i organisationens inställningar: ingenting registreras och ingen loggrad", async () => {
    const org = rt.store.rows("org_settings")[0];
    rt.store.updateRow("org_settings", org.id, { settings: { ...org.settings, attendance: { autoPresent: false, autoPresentAt: "18:00" } } });
    expect(autoAttendanceTime(rt.store.rows("org_settings"))).toBeNull();
    rt.clock.set("2027-02-01T18:05");
    const res = await runAutoAttendance(systemCtx());
    expect(res).toEqual({ contracts: [], registered: 0, published: 0 });
    expect(runs()).toEqual([]);
  });

  it("klockslaget följer organisationens inställning", async () => {
    const org = rt.store.rows("org_settings")[0];
    rt.store.updateRow("org_settings", org.id, { settings: { ...org.settings, attendance: { autoPresent: true, autoPresentAt: "16:00" } } });
    expect(autoAttendanceTime(rt.store.rows("org_settings"))).toBe("16:00");
    rt.clock.set("2027-02-01T16:05");
    expect((await runAutoAttendance(systemCtx())).registered).toBe(50);
  });

  it("coachen ändrar en automatisk rad till frånvaro – raden blir manuell och loggas som tidigare automatisk", async () => {
    rt.clock.set("2027-02-01T18:05");
    await runAutoAttendance(systemCtx());
    const res = await rt.run("command", attendanceSet.key, { activityId: W4[0], status: "absent_invalid", reason: "Uteblev utan att meddela" }, actor("u-amira"));
    expect(res).toMatchObject({ ok: true });
    expect(att().find((a) => a.activityId === W4[0])).toMatchObject({ status: "absent_invalid", source: "manual", registeredBy: "u-amira" });
    expect(rt.store.rows("audit_log").filter((l) => l.action === "attendance.registered").pop()?.details).toMatchObject({ wasAuto: true });
  });
});

describe("avbruten körning", () => {
  it("ett fel mitt i ett avtal: raderna som hann skrivas loggas ändå (failed, felkoden) innan felet går vidare – nästa körning loggar resten", async () => {
    rt.clock.set("2027-02-01T18:05");
    const ctx = systemCtx();
    // Den fjärde skrivningen misslyckas (t.ex. nätverksfel mot databasen) – inte en dubblett.
    let n = 0;
    const realTable = ctx.system.table.bind(ctx.system);
    const failing = Object.create(ctx.system) as Ctx["system"];
    failing.table = ((name: string) => {
      const t = realTable(name as "attendance");
      if (name !== "attendance") return t;
      return { ...t, insert: async (row: Tables["attendance"]) => { if (++n > 3) throw Object.assign(new Error("Databasfel i attendance (08006)"), { code: "08006" }); return t.insert(row); } };
    }) as Ctx["system"]["table"];
    await expect(runAutoAttendance({ ...ctx, system: failing })).rejects.toThrow("08006");
    expect(auto()).toHaveLength(3);
    expect(runs()).toHaveLength(1);
    expect(runs()[0].details).toMatchObject({ count: 3, failed: true, error: "08006", remaining: 47 });
    expect((runs()[0].details as { attendanceIds: string[] }).attendanceIds.sort()).toEqual(auto().map((a) => a.id).sort());
    // Nästa försök: de tre räknas som registrerade och loggas inte igen – de övriga 47 får en egen loggrad.
    const again = await runAutoAttendance(ctx); // samma ctx: nya id:n fortsätter löpnumret
    expect(again.registered).toBe(47);
    expect(runs()).toHaveLength(2);
    expect(runs()[1].details).toMatchObject({ count: 47 });
    expect(runs()[1].details).not.toHaveProperty("failed");
  });
});

describe("minnesläget och Kör nu", () => {
  const query = (userId: string) => rt.run("query", "session.ping", {}, actor(userId));

  it("när demoklockan passerar dagens slut registreras dagens tillfällen – aldrig nyinläst testdata (golvet)", async () => {
    await query("u-amira");
    expect(auto()).toEqual([]);
    rt.clock.set("2027-02-01T18:05");
    await query("u-amira");
    // Golvet (klockan när testdatat lästes in): vecka 4 ligger före – bara dagens 44 tillfällen.
    expect(auto()).toHaveLength(44);
    expect(auto().some((a) => W4.includes(a.activityId))).toBe(false);
    // Samma dag igen: inget nytt.
    rt.clock.set("2027-02-01T19:00");
    await query("u-amira");
    expect(runs()).toHaveLength(1);
  });

  it("Kör nu (admin.runJob auto_attendance) registrerar direkt, utan golv – och syns på integrationssidan", async () => {
    const robin = actor("u-robin", "admin");
    expect(await rt.run("command", adminRunJob.key, { key: "auto_attendance" }, robin)).toEqual({ ok: true, queued: false });
    // Klockan 09.13: förra veckans sex tillfällen (dagens dag är inte slut).
    expect(auto().map((a) => a.activityId).sort()).toEqual([...W4].sort());
    expect(runs()[0]).toMatchObject({ actorId: "u-robin", details: { count: 6, manual: true } });
    const view = (await rt.run("query", adminIntegrations.key, {}, robin)) as { jobs: { key: string; status: string; result: string; manual: boolean }[] };
    expect(view.jobs.find((j) => j.key === "auto_attendance")).toMatchObject({ status: "ok", manual: true, result: "6 tillfällen registrerade automatiskt vid senaste körningen" });
  });
});
