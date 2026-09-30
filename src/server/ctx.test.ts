// Ctx i supabase-läget med MemoryRepo i stället för Postgres: klockan fryst per förfrågan, id-format,
// revisionslogg via system (med testarens id när testaren agerar som testperson) och utskick via enqueue.
import { describe, expect, it } from "vitest";
import { SYSTEM_ACTOR, type Actor } from "@/api/roles";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed } from "@/data/seed";
import type { AppRepo, Tables } from "@/data/schema";
import { liveCtx, randomId } from "./ctx";

const AMIRA: Actor = { userId: "u-amira", role: "coach", contractIds: ["c-bot"], customerUnit: null };

function setup() {
  const store = new MemoryStore<Tables>(createSeed());
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  const repo = new MemoryRepo<Tables>(store, AMIRA, POLICIES) as unknown as AppRepo;
  const sent: unknown[] = [];
  return { store, system, repo, sent };
}

describe("liveCtx", () => {
  it("klockan är fryst för förfrågan och id:n är prefix + uuid", () => {
    const { system, repo, sent } = setup();
    const ctx = liveCtx({ actor: AMIRA, now: "2027-02-01T09:40", repo, system, enqueue: async (_s, m) => sent.push(m) });
    expect(ctx.now()).toBe("2027-02-01T09:40");
    expect(ctx.now()).toBe("2027-02-01T09:40");
    expect(ctx.newId("chk")).toMatch(/^chk-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(randomId("log")).not.toBe(randomId("log"));
  });

  it("revisionsloggen skrivs via system med aktören – och testarens id när testaren agerar som testperson", async () => {
    const { system, repo, store } = setup();
    const before = store.rows("audit_log").length;
    const ctx = liveCtx({ actor: AMIRA, now: "2027-02-01T09:40", repo, system, enqueue: async () => undefined, testerId: "u-test-karim", newId: (p) => `${p}-1` });
    await ctx.audit({ action: "case.view", entity: "case", entityId: "case-1", contractId: "c-bot" });
    const row = store.rows("audit_log").at(-1);
    expect(store.rows("audit_log").length).toBe(before + 1);
    expect(row).toEqual({ id: "log-1", occurredAt: "2027-02-01T09:40", actorId: "u-amira", action: "case.view", entity: "case", entityId: "case-1", contractId: "c-bot", details: { testerId: "u-test-karim" } });

    const own = liveCtx({ actor: AMIRA, now: "2027-02-01T09:41", repo, system, enqueue: async () => undefined, newId: (p) => `${p}-2` });
    await own.audit({ action: "x.y", entity: "case", entityId: null, details: { a: 1 } });
    expect(store.rows("audit_log").at(-1)).toMatchObject({ id: "log-2", contractId: null, details: { a: 1 } });
  });

  it("utskick går via enqueue med system och förfrågans tid", async () => {
    const { system, repo } = setup();
    const calls: unknown[][] = [];
    const ctx = liveCtx({ actor: AMIRA, now: "2027-02-01T09:40", repo, system, enqueue: async (...a) => calls.push(a) });
    const msg = { channel: "email" as const, to: "maria.ekdahl@botkyrka.se", template: "orderbekraftelse", body: "Ärende BOT-26-0143 är bekräftat. Logga in för att läsa.", caseId: "case-1" };
    await ctx.notify(msg);
    expect(calls).toEqual([[system, msg, "2027-02-01T09:40"]]);
  });
});
