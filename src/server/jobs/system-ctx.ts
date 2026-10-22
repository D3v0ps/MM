// Systemstegens Ctx i jobbkörningen (src/server/jobs/live.ts): service role, systemets aktör, utskickskön, personnummerkrypteringen
// och läget för SMS, utringning och e-postens spärrlista (messaging). Alla jobb som bygger en Ctx gör det här, så att inget jobb
// kan glömma ett av fälten – utan messaging faller notifyParticipant tillbaka på "inget kopplat": inbjudningar som rapportjobbet
// skickar (nya tillfällen i en återkommande aktivitet, målgruppens synkning) skulle aldrig gå som SMS eller utringning och
// samordnaren skulle få en ring-uppgift för varje tillfälle. Ingen "server-only" här: modulen tar emot allt den behöver och går att
// testa (system-ctx.test.ts).
import type { Ctx, PnrCrypto } from "@/api/server";
import { SYSTEM_ACTOR } from "@/api/roles";
import type { AppRepo } from "@/data/schema";
import type { MessagingStatus } from "@/features/_shared/messaging-port";
import { liveCtx, type Enqueue } from "../ctx";

/** Det som är lika för alla jobbens Ctx i en körning. */
export type JobCtxBase = { system: AppRepo; enqueue: Enqueue; crypto: PnrCrypto; messaging: MessagingStatus };

/** Övriga fält per jobb (klockan, AI, ljud, bilagor, kön för röstjobben). */
type JobCtxOpts = Omit<Parameters<typeof liveCtx>[0], "actor" | "repo" | "system" | "enqueue" | "crypto" | "messaging">;

/** Ett systemstegs Ctx: repo och system är båda service role. */
export function jobCtx(base: JobCtxBase, o: JobCtxOpts): Ctx {
  return liveCtx({ ...o, actor: SYSTEM_ACTOR, repo: base.system, system: base.system, enqueue: base.enqueue, crypto: base.crypto, messaging: base.messaging });
}
