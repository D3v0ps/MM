// Ctx för supabase-läget. Samma gränssnitt som minnesläget (src/data/memory-runtime.ts) – hanterarna märker ingen skillnad.
//   repo    användarens klient (RLS)            system  service role (bara systemsteg)
//   now     frusen per förfrågan (testtid i testmiljön, riktig tid i produktion)
//   newId   `${prefix}-${uuid}`                 audit   insert i audit_log via system
//   notify  enqueueMessage() i src/server/notify (skickas in, så att modulen går att testa utan servern)
//   crypto  personnummer: AES-256-GCM och HMAC-SHA256 (src/server/crypto.ts, skickas in av live.ts)
//   ai      AI-leverantören (src/server/ai: Vertex AI EU eller simulerad) – saknas när AI är avstängd
//   audio   ljudfilerna i Supabase Storage (src/server/audio) – byggs med förfrågans system, klocka och id
//   jobs    kön för bakgrundsjobb: schedule() kör jobben med after() när svaret skickats (röstjobben, voice-jobs.ts)
import type { AuditEntry, Ctx, JobKick, OutgoingMessage, PnrCrypto } from "@/api/server";
import type { Actor } from "@/api/roles";
import type { LocalDateTime } from "@/core/time";
import type { AppRepo } from "@/data/schema";
import type { AiPort } from "@/features/_shared/ai-port";
import type { AudioPort } from "@/features/_shared/audio-port";

export type Enqueue = (system: AppRepo, msg: OutgoingMessage, now: LocalDateTime) => Promise<unknown>;

export const randomId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;

/** Utan nycklar: allt som rör personnummer stoppas (hellre fel än testdatats ersättning i drift). */
const NO_PNR_CRYPTO: PnrCrypto = {
  encryptPnr: () => {
    throw new Error("Kryptering av personnummer är inte konfigurerad");
  },
  decryptPnr: () => {
    throw new Error("Kryptering av personnummer är inte konfigurerad");
  },
  hashPnr: () => {
    throw new Error("Kryptering av personnummer är inte konfigurerad");
  },
};

export function liveCtx(o: {
  actor: Actor;
  now: LocalDateTime;
  repo: AppRepo;
  system: AppRepo;
  enqueue: Enqueue;
  /** Testarens egen profil när testaren agerar som en testperson – sparas i revisionsloggen (bara id). */
  testerId?: string | null;
  newId?: (prefix: string) => string;
  /** Personnummer (src/server/crypto.ts). Utelämnas bara i tester – då stoppas allt som rör personnummer. */
  crypto?: PnrCrypto;
  /** AI-leverantören. Utelämnas när AI är avstängd (requireAi ger då ett begripligt fel och den manuella vägen gäller). */
  ai?: AiPort;
  /** Ljudlagringen, byggd med förfrågans system, klocka och id (src/server/audio). */
  audio?: (d: { system: AppRepo; now: () => LocalDateTime; newId: (prefix: string) => string }) => AudioPort;
  /** Kör köade bakgrundsjobb snart (after()). Anropas högst en gång per förfrågan även om flera jobb läggs. */
  scheduleJobs?: () => void;
}): Ctx {
  const newId = o.newId ?? randomId;
  const now = () => o.now;
  let scheduled = false;
  const jobs: JobKick | undefined = o.scheduleJobs
    ? {
        schedule: () => {
          if (scheduled) return;
          scheduled = true;
          o.scheduleJobs?.();
        },
      }
    : undefined;
  return {
    actor: o.actor,
    now,
    repo: o.repo,
    system: o.system,
    newId,
    audit: async (e: AuditEntry) => {
      const details = o.testerId && o.testerId !== o.actor.userId ? { ...(e.details ?? {}), testerId: o.testerId } : (e.details ?? {});
      await o.system.table("audit_log").insert({
        id: newId("log"),
        occurredAt: o.now,
        actorId: o.actor.userId,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId,
        contractId: e.contractId ?? null,
        details,
      });
    },
    notify: async (m: OutgoingMessage) => {
      await o.enqueue(o.system, m, o.now);
    },
    crypto: o.crypto ?? NO_PNR_CRYPTO,
    ...(o.ai ? { ai: o.ai } : {}),
    ...(o.audio ? { audio: o.audio({ system: o.system, now, newId }) } : {}),
    ...(jobs ? { jobs } : {}),
  };
}
