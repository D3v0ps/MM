// Automatisk närvaro i jobbkörningen (attendance.ts + runner.ts) mot testdatat i minnet: jobbet läggs en gång per dag när
// klockslaget passerat, körs före rapportjobbet (samma körning, id:t sorteras först), med golvet i testmiljön och utan golv vid
// "Kör nu" (payload.manual). Utfallet är bara ett antal.
import { describe, expect, it } from "vitest";
import { SYSTEM_ACTOR } from "@/api/roles";
import type { Ctx } from "@/api/server";
import type { LocalDateTime } from "@/core/time";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START } from "@/data/seed";
import { TEST_PNR_CRYPTO } from "@/data/seed/pnr";
import type { AppRepo, Tables } from "@/data/schema";
import { AUTO_ATTENDANCE_JOB, autoAttendanceJobId, ensureAutoAttendanceJob } from "./attendance";
import { JOB_HANDLERS, type JobDeps } from "./registry";
import { ensureReportScheduleJob } from "./reports";
import { runJobs, type JobStore } from "./runner";

function setup() {
  const store = new MemoryStore<Tables>(createSeed());
  let seq = 0;
  const newId = (p: string) => `${p}-j${String(++seq).padStart(4, "0")}`;
  let clock: LocalDateTime = DEMO_START;
  const now = () => clock;
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  const ctx: Ctx = {
    actor: SYSTEM_ACTOR, now, repo: system, system, newId, crypto: TEST_PNR_CRYPTO,
    audit: async (e) => {
      await system.table("audit_log").insert({ id: newId("log"), occurredAt: now(), actorId: SYSTEM_ACTOR.userId, action: e.action, entity: e.entity, entityId: e.entityId, contractId: e.contractId ?? null, details: e.details ?? {} });
    },
    notify: async () => undefined,
  };
  const order: string[] = [];
  const jobStore: JobStore = {
    async claim(n, at, max) {
      // Som mm.claim_jobs: order by run_after, id.
      const due = store.rows("jobs").filter((j) => j.status === "queued" && j.runAfter <= at && j.attempts < max).sort((a, b) => (a.runAfter + a.id < b.runAfter + b.id ? -1 : 1)).slice(0, n);
      return due.map((j) => {
        order.push(j.kind);
        return store.updateRow("jobs", j.id, { status: "running", attempts: j.attempts + 1 });
      });
    },
    async finish(id, patch) {
      store.updateRow("jobs", id, patch);
    },
  };
  // Testmiljön: golvet är testklockans start.
  const deps = { autoAttendance: async () => ({ ctx, floor: DEMO_START }), reportSchedule: undefined } as unknown as JobDeps;
  const run = async (at: LocalDateTime) => {
    clock = at;
    await ensureAutoAttendanceJob(system, at);
    return runJobs({ store: jobStore, handlers: JOB_HANDLERS, ctx: deps, now: at });
  };
  return { store, system, run, order, setClock: (t: LocalDateTime) => (clock = t) };
}

describe("jobbet auto_attendance", () => {
  it("läggs först när dagens klockslag passerat – en gång per dag", async () => {
    const t = setup();
    expect(await ensureAutoAttendanceJob(t.system, "2027-02-01T17:59")).toBe(false);
    expect(await ensureAutoAttendanceJob(t.system, "2027-02-01T18:00")).toBe(true);
    expect(await ensureAutoAttendanceJob(t.system, "2027-02-01T18:01")).toBe(false);
    expect(t.store.rows("jobs").map((j) => [j.id, j.kind, j.runAfter, j.status])).toEqual([[autoAttendanceJobId("2027-02-01T18:00"), AUTO_ATTENDANCE_JOB, "2027-02-01T18:00", "queued"]]);
    expect(await ensureAutoAttendanceJob(t.system, "2027-02-02T18:30")).toBe(true);
  });

  it("avstängd: inget jobb; eget klockslag: jobbet läggs då", async () => {
    const t = setup();
    const org = t.store.rows("org_settings")[0];
    t.store.updateRow("org_settings", org.id, { settings: { ...org.settings, attendance: { autoPresent: false, autoPresentAt: "18:00" } } });
    expect(await ensureAutoAttendanceJob(t.system, "2027-02-01T20:00")).toBe(false);
    t.store.updateRow("org_settings", org.id, { settings: { ...org.settings, attendance: { autoPresent: true, autoPresentAt: "16:30" } } });
    expect(await ensureAutoAttendanceJob(t.system, "2027-02-01T16:30")).toBe(true);
  });

  it("körs med golvet i testmiljön: dagens tillfällen men inte testdatats vecka 4 – utfallet är bara ett antal", async () => {
    const t = setup();
    const sum = await t.run("2027-02-01T18:05");
    expect(sum).toMatchObject({ claimed: 1, done: 1, failed: 0, outcomes: { "auto_attendance:registered:44": 1 } });
    expect(t.store.rows("attendance").filter((a) => a.source === "auto")).toHaveLength(44);
    // Samma dag igen: jobbet finns redan och ingenting körs.
    expect(await t.run("2027-02-01T18:10")).toMatchObject({ claimed: 0 });
  });

  it("Kör nu (payload.manual): inget golv – förra veckans oregistrerade tillfällen också", async () => {
    const t = setup();
    await t.system.table("jobs").insert({
      id: "job-manuell", kind: AUTO_ATTENDANCE_JOB, payload: { manual: true }, status: "queued", attempts: 0, runAfter: "2027-02-01T09:20", lastError: null,
      createdAt: "2027-02-01T09:20", createdBy: "u-robin", finishedAt: null,
    });
    // Klockan 09.20: dagens dag är inte slut (inget dagens jobb läggs), men vecka 4 tas igen.
    const res = await t.run("2027-02-01T09:20");
    expect(res).toMatchObject({ claimed: 1, done: 1, outcomes: { "auto_attendance:registered:6": 1 } });
    const log = t.store.rows("audit_log").find((l) => l.action === "attendance.auto_registered");
    expect(log?.details).toMatchObject({ count: 6, manual: true });
  });

  it("körs före rapportjobbet i samma körning (id:t sorteras först vid samma tid)", async () => {
    const t = setup();
    // Söndag 18.00 vecka 5 och rapportperioden i samma körning: närvarojobbet hämtas först.
    await ensureReportScheduleJob(t.system, "2027-02-07T18:00");
    await t.run("2027-02-07T18:00");
    expect(t.order.slice(0, 2)).toEqual([AUTO_ATTENDANCE_JOB, "report_schedule"]);
  });
});
