// Revisionsloggen när ett eget tillfälle tas bort (granskningen 2026-11-11): Ta bort tillfälle (arenden.activityRemove) och en
// gruppaktivitet som ersätter deltagarens eget tillfälle (aktiviteter, removeReplaced). Loggen activity.removed står på ärendet
// (entity case, entity_id = ärendets id) med tillfällets id, typ och tid och gruppaktivitetens id – inga namn och ingen plats
// (CLAUDE.md punkt 2). På ärendet för att Ändra veckoplan ska kunna läsa ärendets borttagningar billigt (indexet på entity,
// entity_id) i stället för hela avtalets logg: dagen med ett borttaget tillfälle visar inte planen, och planen lägger inte
// tillbaka tillfället (planContextFor i src/features/arenden/handlers.ts). Bara för hanterare.
import type { Ctx } from "@/api/server";
import type { LocalDateTime } from "@/core/time";

export const ACTIVITY_REMOVED = "activity.removed";

/** Logga att ett eget tillfälle togs bort ur ärendet. */
export async function logActivityRemoved(
  ctx: Ctx,
  x: { contractId: string; caseId: string; activityId: string; kind: string; startsAt: LocalDateTime; groupActivityId?: string | null },
): Promise<void> {
  await ctx.audit({
    action: ACTIVITY_REMOVED, entity: "case", entityId: x.caseId, contractId: x.contractId,
    details: { caseId: x.caseId, activityId: x.activityId, kind: x.kind, startsAt: x.startsAt, ...(x.groupActivityId ? { groupActivityId: x.groupActivityId } : {}) },
  });
}
