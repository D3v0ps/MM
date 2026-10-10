// Kör API:t mot data i minnet. Används av prototypen (i webbläsaren) och av utvecklingsläget i Next.js (MM_BACKEND=memory).
// Samma hanterare som i produktion – bara datalagret skiljer. Portarna i minnesläget:
//   ctx.crypto  testdatats ersättning för personnummer (TEST_PNR_CRYPTO)
//   ctx.ai      simulerad AI (createSimulatedAi, src/features/_shared/ai-sim.ts) – deterministisk, inga anrop utanför
//   ctx.audio   ljud i minnet (createMemoryAudio, src/features/_shared/audio-port.ts) – raderna i audio_uploads via system
//   ctx.attachments  bilagor i minnet (createMemoryAttachments, src/features/_shared/attachment-port.ts) – raderna via system
//   ctx.fortnox  simulerad Fortnox-port (createSimulatedFortnox, src/features/_shared/fortnox-port.ts) – statusen sätts i appen
// Rapportutkasten (src/features/rapporter/ensure.ts) skapas här i stället för i jobbkörningen: när testdatat läses in (första
// anropet) och när demoklockan passerar en vecko- eller månadsgräns – samma funktion som jobbet i testmiljön. Golvet är
// klockan när datat lästes in (testdatat är komplett dit) och högvattenmärkena sparas i minnet.
import { execute, isSilentCommand } from "@/api/handlers";
import type { Ctx } from "@/api/server";
import { SYSTEM_ACTOR, type Actor } from "@/api/roles";
import { nextScheduleBoundary } from "@/core/report-schedule";
import { maskLinkTokens } from "@/core/link-tokens";
import { addMinutes, toStockholmLocal, type LocalDateTime } from "@/core/time";
import type { AiPort } from "@/features/_shared/ai-port";
import { createSimulatedAi } from "@/features/_shared/ai-sim";
import { createMemoryAttachments } from "@/features/_shared/attachment-port";
import { createMemoryAudio } from "@/features/_shared/audio-port";
import { createSimulatedFortnox } from "@/features/_shared/fortnox-port";
import { isParticipantRecipient, MESSAGING_OFF, memoryDeliveryStatus, type MessagingStatus } from "@/features/_shared/messaging-port";
import { ensureReports, type ReportScheduleState } from "@/features/rapporter/ensure";
import { selfRegister, selfRegisteredAudit, type SelfRegisterResult } from "@/features/session/self-register";
import { MemoryRepo, MemoryStore, type MemoryData } from "./memory";
import { POLICIES } from "./policy";
import { TEST_PNR_CRYPTO } from "./seed/pnr";
import { UNIQUE_KEYS, type AppRepo, type Tables } from "./schema";

export type DemoClock = { now(): LocalDateTime; tick(): void; set(t: LocalDateTime): void };

/** Demoklocka: står still och flyttas fram en minut per kommando, så att förloppet blir deterministiskt. */
export function demoClock(start: LocalDateTime): DemoClock {
  let t = start;
  return { now: () => t, tick: () => { t = addMinutes(t, 1); }, set: (v) => { t = v; } };
}

/**
 * Riktig klocka (minnesläget med MM_SEED=empty, beslut 2026-10-08): Stockholms lokala tid just nu. tick och set gör ingenting –
 * tiden går av sig själv, som i produktion.
 */
export function realClock(nowIso: () => string = () => new Date().toISOString()): DemoClock {
  return { now: () => toStockholmLocal(nowIso()), tick: () => undefined, set: () => undefined };
}

export type MemoryRuntime = ReturnType<typeof createMemoryRuntime>;

/** Kommandot är en automatisk utkastsparning (coach.checkinSave m.fl. med autosave: true). */
const isAutosave = (input: unknown): boolean => !!input && typeof input === "object" && (input as { autosave?: unknown }).autosave === true;

export function createMemoryRuntime(opts: {
  data: MemoryData<Tables>;
  clock: DemoClock;
  /** AI-porten. Standard: simulerad AI. Tester kan skicka in en egen (t.ex. en som misslyckas). */
  ai?: AiPort;
  /**
   * Rapportutkasten: datat är komplett hit – perioder som slutar senast då skapas aldrig automatiskt. Standard: klockan när
   * runtime skapas (testdatat vid DEMO_START har redan sina rapporter). null = från avtalets start.
   */
  reportFloor?: LocalDateTime | null;
  /**
   * SMS och utringning (46elks). Standard: inget kopplat – som en drift utan variablerna (SMS och samtal stoppas med orsak).
   * Tester kan skicka in ett kopplat läge. Inget skickas på riktigt i minnesläget.
   */
  messaging?: MessagingStatus;
}) {
  // Samma unika nycklar som databasen (UNIQUE_KEYS): en dubblett stoppas med UniqueError, som i Postgres.
  const store = new MemoryStore<Tables>(opts.data, UNIQUE_KEYS);
  let seq = 0;
  const newId = (prefix: string) => `${prefix}-n${String(++seq).padStart(5, "0")}`;
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  const ai = opts.ai ?? createSimulatedAi();
  // Ljudfilernas rader skrivs av porten (systemsteg) med samma id-följd och klocka som hanterarna – deterministiskt vid uppspelning.
  const audio = createMemoryAudio({ system, now: opts.clock.now, newId });
  // Bilagornas rader skrivs av porten (systemsteg) på samma sätt.
  const attachments = createMemoryAttachments({ system, now: opts.clock.now, newId });
  // Fortnox är simulerat i minnesläget: "Skapa i Fortnox" sätter statusen i Miljonmatch. Supabase-läget har ingen port.
  const fortnox = createSimulatedFortnox();
  const messaging = opts.messaging ?? MESSAGING_OFF;

  /** Deltagarens e-postadress och telefonnummer via ärendet (systemsteg – lämnas aldrig ut, bara prövade). */
  async function participantContact(caseId: string): Promise<{ email: string | null; phone: string | null }> {
    const c = await system.table("cases").get(caseId);
    const p = c ? await system.table("persons").get(c.personId) : null;
    return { email: p?.email ?? null, phone: p?.phone ?? null };
  }

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
        // Som servern: engångslänkarnas token sparas aldrig i utskicksloggen (src/core/link-tokens.ts). SMS och samtal som inte
        // är kopplade stoppas med samma orsak som servern ger; allt annat räknas som skickat (simulerat – inget går iväg).
        // Till en deltagare ("deltagare (…)"): adressen och numret prövas via ärendet, som servern gör precis innan utskicket skickas.
        const participant = isParticipantRecipient(m.to) && m.caseId ? await participantContact(m.caseId) : null;
        const d = memoryDeliveryStatus(m.channel, messaging, participant);
        await t.insert({
          id: newId("out"), createdAt: opts.clock.now(), channel: m.channel, to: m.to, template: m.template, subject: m.subject ?? null, body: maskLinkTokens(m.body), caseId: m.caseId ?? null,
          status: d.status, sentAt: d.status === "sent" ? opts.clock.now() : null, ...(d.statusReason ? { statusReason: d.statusReason } : {}),
        });
      },
      // Påhittade personnummer: testdatats ersättning för kryptering och sökhash (src/data/seed/pnr.ts).
      crypto: TEST_PNR_CRYPTO,
      ai,
      audio,
      attachments,
      fortnox,
      messaging,
      // Prototypen visar länken som deltagaren fick (rost.linkSend). Servern i supabase-läget lämnar aldrig ut den.
      exposeLinkPaths: true,
    };
  }

  // ---- Rapportutkasten: körs vid inläsningen och sedan när klockan passerat nästa vecko- eller månadsgräns.
  // Ett lås gör att två anrop samtidigt (utvecklingsservern) inte skapar samma rad två gånger.
  const marks = new Map<string, LocalDateTime>();
  const reportState: ReportScheduleState = {
    floor: opts.reportFloor === undefined ? opts.clock.now() : opts.reportFloor,
    checkedThrough: async (contractId) => marks.get(contractId) ?? null,
    markChecked: async (contractId, at) => {
      marks.set(contractId, at);
    },
  };
  let checkedAt: LocalDateTime | null = null;
  let ensuring: Promise<void> | null = null;
  async function ensureScheduledReports(): Promise<void> {
    while (ensuring) await ensuring;
    const now = opts.clock.now();
    if (checkedAt && nextScheduleBoundary(checkedAt) > now) return;
    ensuring = (async () => {
      // Golvet gör att inget skapas på nyinläst testdata (testdatat har raderna redan).
      try {
        await ensureReports(ctxFor(SYSTEM_ACTOR), reportState);
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
    // Automatisk utkastsparning (autosave: true) flyttar inte klockan: annars blir dagens kommande möten "passerade"
    // medan coachen skriver (varje paus på 2 s skulle annars vara en minut).
    const ticks = kind === "command" && !isSilentCommand(key) && !isAutosave(input);
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

  /**
   * Självregistrering (beslut 2026-10-07): en adress på avtalets kommundomän utan profil får ett konto som kommunens handläggare
   * – samma funktion som servern (src/features/session/self-register.ts). Klockan flyttas en minut som för ett kommando.
   * Revisionsloggen får profile.self_registered (bara id:n och domänen).
   */
  async function selfRegisterMemory(email: string): Promise<SelfRegisterResult> {
    await ensureScheduledReports();
    const before = opts.clock.now();
    opts.clock.tick();
    const res = await selfRegister(system, { email, now: opts.clock.now(), newId });
    if (!res.ok) {
      opts.clock.set(before);
      return res;
    }
    await ctxFor({ userId: res.profileId, role: "kommun_handlaggare", contractIds: res.contractIds, customerUnit: null }).audit(selfRegisteredAudit(res));
    return res;
  }

  // ctxFor: en hanterares Ctx för en aktör – för tester av delade hjälpare som inte är kommandon (t.ex. notifyParticipant).
  return { store, run, clock: opts.clock, raw: () => store.raw(), ai, audio, attachments, ensureScheduledReports, selfRegister: selfRegisterMemory, ctxFor };
}
