// Månadens fakturakörning skapas automatiskt (ensure-runs.ts) mot testdatat i minnet: bara när månaden är slut, en gång per
// avtal och månad (idempotent, också när två körningar krockar), av systemet och loggad. Plus samma beteende i minnesläget
// och prototypen (memory-runtime.ts) när klockan passerar månadsskiftet.
import { describe, expect, it } from "vitest";
import "@/api/handlers";
import { SYSTEM_ACTOR } from "@/api/roles";
import type { Ctx } from "@/api/server";
import type { LocalDateTime } from "@/core/time";
import { listPersonas } from "@/data/actors";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { createMemoryRuntime, demoClock } from "@/data/memory-runtime";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START } from "@/data/seed";
import { TEST_PNR_CRYPTO } from "@/data/seed/pnr";
import { UNIQUE_KEYS, type AppRepo, type Tables } from "@/data/schema";
import { ekoRun, ekoStart } from "./api";
import { ensureBillingRuns } from "./ensure-runs";

function setup(at: LocalDateTime) {
  const store = new MemoryStore<Tables>(createSeed(), UNIQUE_KEYS);
  let seq = 0;
  let clock = at;
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  const ctx: Ctx = {
    actor: SYSTEM_ACTOR, now: () => clock, repo: system, system, newId: (p) => `${p}-t${String(++seq).padStart(4, "0")}`, crypto: TEST_PNR_CRYPTO,
    audit: async (e) => {
      await system.table("audit_log").insert({ id: `log-t${String(++seq).padStart(4, "0")}`, occurredAt: clock, actorId: SYSTEM_ACTOR.userId, action: e.action, entity: e.entity, entityId: e.entityId, contractId: e.contractId ?? null, details: e.details ?? {} });
    },
    notify: async () => undefined,
  };
  return { store, ctx, setClock: (t: LocalDateTime) => { clock = t; } };
}

describe("månadens fakturakörning skapas automatiskt", () => {
  it("ingen körning före månadsskiftet; februari skapas 1 mars av systemet, loggas, och en ny körning skapar inget mer", async () => {
    const t = setup("2027-02-28T23:59");
    expect(await ensureBillingRuns(t.ctx, { floor: DEMO_START })).toEqual({ created: [], duplicates: 0 });
    t.setClock("2027-03-01T00:05");
    expect(await ensureBillingRuns(t.ctx, { floor: DEMO_START })).toEqual({ created: [{ id: "br-c-bot-2027-02", contractId: "c-bot", month: "2027-02" }], duplicates: 0 });
    expect(t.store.getRow("billing_runs", "br-c-bot-2027-02")).toEqual({
      id: "br-c-bot-2027-02", contractId: "c-bot", month: "2027-02", status: "draft", createdBy: "system", createdAt: "2027-03-01T00:05", closedAt: null, closedBy: null,
    });
    const logs = t.store.rows("audit_log").filter((l) => l.action === "billing.run_created");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorId: "system", entity: "billing_run", entityId: "br-c-bot-2027-02", contractId: "c-bot", details: { month: "2027-02", automatic: true } });
    // Idempotent: samma körning igen (nästa tiominutersperiod) skapar inget.
    t.setClock("2027-03-01T00:15");
    expect(await ensureBillingRuns(t.ctx, { floor: DEMO_START })).toEqual({ created: [], duplicates: 0 });
    expect(t.store.rows("billing_runs").filter((r) => r.month === "2027-02")).toHaveLength(1);
  });

  it("två samtidiga körningar skapar exakt en (samma id – den andra stoppas av primärnyckeln och hoppas över utan fel)", async () => {
    const t = setup("2027-03-01T00:05");
    const [a, b] = await Promise.all([ensureBillingRuns(t.ctx, { floor: DEMO_START }), ensureBillingRuns(t.ctx, { floor: DEMO_START })]);
    expect(a.created.length + b.created.length).toBe(1);
    expect(a.duplicates + b.duplicates).toBe(1);
    expect(t.store.rows("billing_runs").filter((r) => r.month === "2027-02").map((r) => r.id)).toEqual(["br-c-bot-2027-02"]);
  });

  it("golvet: på nyinläst testdata skapas inget; utan golv (produktionen) fylls en saknad körning i, och en befintlig ändras aldrig", async () => {
    const t = setup(DEMO_START);
    const before = t.store.rows("billing_runs").map((r) => ({ ...r }));
    expect(await ensureBillingRuns(t.ctx, { floor: DEMO_START })).toEqual({ created: [], duplicates: 0 });
    // Januaris körning saknas (som i produktionen i dag): med golvet skapas den inte, utan golv skapas den.
    t.store.removeRow("billing_runs", "br-2027-01");
    expect((await ensureBillingRuns(t.ctx, { floor: DEMO_START })).created).toEqual([]);
    expect((await ensureBillingRuns(t.ctx, { floor: null })).created.map((r) => r.month)).toEqual(["2027-01"]);
    // De andra månadernas körningar (testdatats id:n, stängda) är orörda.
    expect(t.store.rows("billing_runs").filter((r) => r.month !== "2027-01")).toEqual(before.filter((r) => r.month !== "2027-01"));
  });
});

describe("minnesläget och prototypen: samma körning när klockan passerar månadsskiftet", () => {
  it("februari får en körning när klockan har passerat 1 mars – och ekonomen ser den som pågående körning", async () => {
    const clock = demoClock(DEMO_START);
    const rt = createMemoryRuntime({ data: createSeed(), clock });
    const lars = listPersonas(rt.raw()).find((x) => x.actor.userId === "u-lars" && x.actor.role === "ekonom")!.actor;
    const start = (await rt.run("query", ekoStart.key, {}, lars)) as { current: { month: string; status: string } | null };
    expect(start.current).toMatchObject({ month: "2027-01", status: "draft" });
    expect(rt.store.rows("billing_runs").some((r) => r.month === "2027-02")).toBe(false);
    clock.set("2027-03-01T08:00");
    const run = (await rt.run("query", ekoRun.key, {}, lars)) as { month: string; run: { status: string } | null; monthOpen: string | null };
    expect(rt.store.getRow("billing_runs", "br-c-bot-2027-02")).toMatchObject({ status: "draft", createdBy: "system" });
    // Den senaste pågående körningen visas: februari (januari är också öppen kvar).
    expect(run).toMatchObject({ month: "2027-02", run: { status: "draft" }, monthOpen: null });
  });
});
