// Kör API:t mot data i minnet. Används av prototypen (i webbläsaren) och av utvecklingsläget i Next.js (MM_BACKEND=memory).
// Samma hanterare som i produktion – bara datalagret skiljer. Portarna i minnesläget:
//   ctx.crypto  testdatats ersättning för personnummer (TEST_PNR_CRYPTO)
//   ctx.ai      simulerad AI (createSimulatedAi, src/features/_shared/ai-sim.ts) – deterministisk, inga anrop utanför
//   ctx.audio   ljud i minnet (createMemoryAudio, src/features/_shared/audio-port.ts) – raderna i audio_uploads via system
// Rapportutkasten (src/features/rapporter/ensure.ts) skapas här i stället för i jobbkörningen: när testdatat läses in (första
// anropet) och när demoklockan passerar en vecko- eller månadsgräns – samma funktion som jobbet i testmiljön.
import { execute, isSilentCommand } from "@/api/handlers";
import type { Ctx } from "@/api/server";
import { SYSTEM_ACTOR, type Actor } from "@/api/roles";
import { nextScheduleBoundary } from "@/core/report-schedule";
import { addMinutes, type LocalDateTime } from "@/core/time";
import type { AiPort } from "@/features/_shared/ai-port";
import { createSimulatedAi } from "@/features/_shared/ai-sim";
import { createMemoryAudio } from "@/features/_shared/audio-port";
import { ensureReports } from "@/features/rapporter/ensure";
import { MemoryRepo, MemoryStore, type MemoryData } from "./memory";
import { POLICIES } from "./policy";
import { TEST_PNR_CRYPTO } from "./seed/pnr";
import type { AppRepo, Tables } from "./schema";

export type DemoClock = { now(): LocalDateTime; tick(): void; set(t: LocalDateTime): void };

/** Demoklocka: står still och flyttas fram en minut per kommando, så att förloppet blir deterministiskt. */
export function demoClock(start: LocalDateTime): DemoClock {
  let t = start;
  return { now: () => t, tick: () => { t = addMinutes(t, 1); }, set: (v) => { t = v; } };
}

export type MemoryRuntime = ReturnType<typeof createMemoryRuntime>;

export function createMemoryRuntime(opts: {
  data: MemoryData<Tables>;
  clock: DemoClock;
  /** AI-porten. Standard: simulerad AI. Tester kan skicka in en egen (t.ex. en som misslyckas). */
  ai?: AiPort;
}) {
  const store = new MemoryStore<Tables>(opts.data);
  let seq = 0;
  const newId = (prefix: string) => `${prefix}-n${String(++seq).padStart(5, "0")}`;
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  const ai = opts.ai ?? createSimulatedAi();
  // Ljudfilernas rader skrivs av porten (systemsteg) med samma id-följd och klocka som hanterarna – deterministiskt vid uppspelning.
  const audio = createMemoryAudio({ system, now: opts.clock.now, newId });

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
      // Påhittade personnummer: testdatats ersättning för kryptering och sökhash (src/data/seed/pnr.ts).
      crypto: TEST_PNR_CRYPTO,
      ai,
      audio,
    };
  }

  // ---- Rapportutkasten: körs vid inläsningen och sedan när klockan passerat nästa vecko- eller månadsgräns.
  // Ett lås gör att två anrop samtidigt (utvecklingsservern) inte skapar samma rad två gånger.
  let checkedAt: LocalDateTime | null = null;
  let ensuring: Promise<void> | null = null;
  async function ensureScheduledReports(): Promise<void> {
    while (ensuring) await ensuring;
    const now = opts.clock.now();
    if (checkedAt && nextScheduleBoundary(checkedAt) > now) return;
    ensuring = (async () => {
      // Från där de befintliga raderna slutar: på nyinläst testdata skapas inget (testdatat har raderna redan).
      try {
        await ensureReports(ctxFor(SYSTEM_ACTOR));
      } catch (e) {
        // Ett fel här får inte stoppa appen – nästa försök vid nästa vecko- eller månadsgräns. Bara feltypen loggas.
        console.error("rapportutkast: kunde inte skapas", e instanceof Error ? e.name : typeof e);
      }
      checkedAt = now;
    })();
    try {
      await ensuring;
    } finally {
      ensuring = null;
    }
  }

  /** Kör en fråga eller ett kommando. Resultatet serialiseras så att det beter sig exakt som över HTTP. */
  async function run(kind: "query" | "command", key: string, input: unknown, actor: Actor): Promise<unknown> {
    // Klockan flyttas en minut före varje kommando som inte är tyst – samma ordning som den gamla prototypen,
    // så att tidsstämplarna blir identiska. Kastar kommandot ett fel eller avvisas det återställs klockan.
    const ticks = kind === "command" && !isSilentCommand(key);
    const before = opts.clock.now();
    if (ticks) opts.clock.tick();
    await ensureScheduledReports();
    let res: unknown;
    try {
      res = await execute(kind, key, input, ctxFor(actor));
    } catch (e) {
      if (ticks) opts.clock.set(before);
      throw e;
    }
    // Ett avvisat kommando (fail) motsvarar att prototypens formulär stoppade åtgärden – klockan står kvar.
    if (ticks && res && typeof res === "object" && (res as { ok?: unknown }).ok === false) opts.clock.set(before);
    return res === undefined ? null : JSON.parse(JSON.stringify(res));
  }

  return { store, run, clock: opts.clock, raw: () => store.raw(), ai, audio, ensureScheduledReports };
}
