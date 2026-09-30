// Bara för tester i områdena ledning och notiser: kör hanterarna mot testdatat i minnet, som testpersonerna i rollväljaren.
// Samma ordning som src/data/memory-runtime.ts (klockan flyttas en minut före varje kommando som inte är tyst och står kvar
// om kommandot avvisas), men registrerar bara de hanterare som testet importerar – så att testerna inte beror på att
// alla andra områdens hanterare går att läsa in.
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import { SYSTEM_ACTOR, type Actor, type Role } from "@/api/roles";
import { execute, isSilentCommand, type Ctx } from "@/api/server";
import { addMinutes, type LocalDateTime } from "@/core/time";
import { listPersonas } from "@/data/actors";
import { MemoryRepo, MemoryStore, type MemoryData } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import type { AppRepo, TableName, Tables } from "@/data/schema";
import { createSeed, DEMO_START, TEST_PNR_CRYPTO } from "@/data/seed";

let SEED: MemoryData<Tables> | null = null;

export function testRuntime(start: LocalDateTime = DEMO_START) {
  SEED ??= createSeed();
  const store = new MemoryStore<Tables>(structuredClone(SEED));
  let now = start;
  let seq = 0;
  const newId = (prefix: string) => `${prefix}-n${String(++seq).padStart(5, "0")}`;
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  const ctxFor = (actor: Actor): Ctx => ({
    actor,
    now: () => now,
    repo: new MemoryRepo<Tables>(store, actor, POLICIES) as unknown as AppRepo,
    system,
    newId,
    audit: async (e) => {
      store.insertRow("audit_log", { id: newId("log"), occurredAt: now, actorId: actor.userId, action: e.action, entity: e.entity, entityId: e.entityId, contractId: e.contractId ?? null, details: e.details ?? {} } as Tables["audit_log"]);
    },
    notify: async (m) => {
      store.insertRow("outbound_messages", { id: newId("out"), createdAt: now, channel: m.channel, to: m.to, template: m.template, subject: m.subject ?? null, body: m.body, caseId: m.caseId ?? null, status: "sent", sentAt: now } as Tables["outbound_messages"]);
    },
    crypto: TEST_PNR_CRYPTO,
  });
  async function run(kind: "query" | "command", key: string, input: unknown, actor: Actor): Promise<unknown> {
    const ticks = kind === "command" && !isSilentCommand(key);
    const before = now;
    if (ticks) now = addMinutes(now, 1);
    let res: unknown;
    try {
      res = await execute(kind, key, input, ctxFor(actor));
    } catch (e) {
      if (ticks) now = before;
      throw e;
    }
    if (ticks && res && typeof res === "object" && (res as { ok?: unknown }).ok === false) now = before;
    return res === undefined ? null : JSON.parse(JSON.stringify(res));
  }
  const as = (userId: string, role?: Role): Actor => {
    const p = listPersonas(store.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
    if (!p) throw new Error(`Ingen testperson ${userId}`);
    return p.actor;
  };
  return {
    store,
    now: () => now,
    as,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => run("query", def.key, input, actor) as Promise<ResultOf<D>>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    command: <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => run("command", def.key, input, actor) as Promise<ResultOf<D>>,
    rows: <N extends TableName>(name: N): Tables[N][] => store.rows(name),
  };
}
