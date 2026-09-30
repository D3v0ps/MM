// Kör API:t mot data i minnet. Används av prototypen (i webbläsaren) och av utvecklingsläget i Next.js (MM_BACKEND=memory).
// Samma hanterare som i produktion – bara datalagret skiljer.
import { execute } from "@/api/handlers";
import type { Ctx } from "@/api/server";
import { SYSTEM_ACTOR, type Actor } from "@/api/roles";
import { addMinutes, type LocalDateTime } from "@/core/time";
import { MemoryRepo, MemoryStore, type MemoryData } from "./memory";
import { POLICIES } from "./policy";
import type { AppRepo, Tables } from "./schema";

export type DemoClock = { now(): LocalDateTime; tick(): void; set(t: LocalDateTime): void };

/** Demoklocka: står still och flyttas fram en minut per kommando, så att förloppet blir deterministiskt. */
export function demoClock(start: LocalDateTime): DemoClock {
  let t = start;
  return { now: () => t, tick: () => { t = addMinutes(t, 1); }, set: (v) => { t = v; } };
}

export type MemoryRuntime = ReturnType<typeof createMemoryRuntime>;

export function createMemoryRuntime(opts: { data: MemoryData<Tables>; clock: DemoClock }) {
  const store = new MemoryStore<Tables>(opts.data);
  let seq = 0;
  const newId = (prefix: string) => `${prefix}-n${String(++seq).padStart(5, "0")}`;
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;

  function ctxFor(actor: Actor): Ctx {
    return {
      actor,
      now: opts.clock.now,
      repo: new MemoryRepo<Tables>(store, actor, POLICIES) as unknown as AppRepo,
      system,
      newId,
      audit: async (e) => {
        const t = (system as unknown as { table(n: string): { insert(r: unknown): Promise<unknown> } }).table("audit_log");
        await t.insert({ id: newId("log"), occurredAt: opts.clock.now(), actorId: actor.userId, action: e.action, entity: e.entity, entityId: e.entityId, contractId: e.contractId ?? null, details: e.details ?? {} });
      },
      notify: async (m) => {
        const t = (system as unknown as { table(n: string): { insert(r: unknown): Promise<unknown> } }).table("outbound_messages");
        await t.insert({ id: newId("out"), createdAt: opts.clock.now(), channel: m.channel, to: m.to, template: m.template, subject: m.subject ?? null, body: m.body, caseId: m.caseId ?? null, status: "sent", sentAt: opts.clock.now() });
      },
    };
  }

  /** Kör en fråga eller ett kommando. Resultatet serialiseras så att det beter sig exakt som över HTTP. */
  async function run(kind: "query" | "command", key: string, input: unknown, actor: Actor): Promise<unknown> {
    const res = await execute(kind, key, input, ctxFor(actor));
    if (kind === "command") opts.clock.tick();
    return res === undefined ? null : JSON.parse(JSON.stringify(res));
  }

  return { store, run, clock: opts.clock, raw: () => store.raw() };
}
