// Ctx för supabase-läget. Samma gränssnitt som minnesläget (src/data/memory-runtime.ts) – hanterarna märker ingen skillnad.
//   repo    användarens klient (RLS)            system  service role (bara systemsteg)
//   now     frusen per förfrågan (testtid i testmiljön, riktig tid i produktion)
//   newId   `${prefix}-${uuid}`                 audit   insert i audit_log via system
//   notify  enqueueMessage() i src/server/notify (skickas in, så att modulen går att testa utan servern)
import type { AuditEntry, Ctx, OutgoingMessage } from "@/api/server";
import type { Actor } from "@/api/roles";
import type { LocalDateTime } from "@/core/time";
import type { AppRepo } from "@/data/schema";

export type Enqueue = (system: AppRepo, msg: OutgoingMessage, now: LocalDateTime) => Promise<unknown>;

export const randomId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;

export function liveCtx(o: {
  actor: Actor;
  now: LocalDateTime;
  repo: AppRepo;
  system: AppRepo;
  enqueue: Enqueue;
  /** Testarens egen profil när testaren agerar som en testperson – sparas i revisionsloggen (bara id). */
  testerId?: string | null;
  newId?: (prefix: string) => string;
}): Ctx {
  const newId = o.newId ?? randomId;
  return {
    actor: o.actor,
    now: () => o.now,
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
  };
}
