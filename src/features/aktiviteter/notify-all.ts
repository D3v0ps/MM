// Meddelandet till deltagarna i en gruppaktivitet (spår G, coachmötet 2026-10-09) – delat av hanterarna (aktiviteter.skapa m.fl.)
// och den automatiska synkningen av målgruppen (audience-sync.ts, Karims beslut 2026-10-22). Bara för hanterare och systemsteg –
// importeras aldrig av skärmar.
import type { Ctx } from "@/api/server";
import type { LocalDateTime } from "@/core/time";
import type { Case, GroupActivity } from "@/data/schema";
import { closeActivityTasks, notifyManySummary, notifyParticipant, type ActivityTemplate, type NotifyParticipantResult } from "../_shared/participant-notify";
import type { NotifyOutcome } from "./api";

/**
 * Ett utskick per deltagare via notifyParticipant – tid, plats och Miljonbemannings telefonnummer, aldrig namn. Kanalerna och
 * uppgiften till samordnaren när ingen kanal finns avgörs där. Loggas som group_activity.notified med mallen, ärendena och
 * antalen. null när ingen deltagare berördes.
 */
export async function notifyAll(
  ctx: Ctx, g: Pick<GroupActivity, "id" | "contractId">, template: ActivityTemplate, caseIds: readonly string[], slot: { when: LocalDateTime; place: string },
  previous?: LocalDateTime,
): Promise<NotifyOutcome> {
  const results: NotifyParticipantResult[] = [];
  for (const caseId of caseIds) results.push(await notifyParticipant(ctx, { caseId, template, when: slot.when, place: slot.place, previous: previous ?? null }));
  const summary = notifyManySummary(template, results);
  if (!summary) return null;
  const sent = results.filter((r) => !r.blocked && r.channels.some((c) => c === "email" || c === "sms")).length;
  const tasks = results.filter((r) => !r.blocked && r.taskId).length;
  await ctx.audit({
    action: "group_activity.notified", entity: "group_activity", entityId: g.id, contractId: g.contractId,
    details: { template, caseIds: [...caseIds].sort(), count: caseIds.length, sent, tasks, startsAt: slot.when },
  });
  return { sent, tasks, summary };
}

/** Meddelanden skickas bara inför en aktivitet som inte har börjat. */
export const upcoming = (ctx: Ctx, startsAt: LocalDateTime): boolean => startsAt > ctx.now();

/**
 * Tiden eller platsen gäller inte längre (ny tid, inställd, borttagen deltagare): öppna uppgifter att ringa deltagarna om den
 * gamla tiden stängs (closeActivityTasks) – annars ringer samordnaren med fel tid.
 */
export async function supersedeTasks(ctx: Ctx, cases: readonly Pick<Case, "id" | "caseNumber" | "contractId">[], was: Pick<GroupActivity, "startsAt" | "location">, note: string): Promise<void> {
  for (const c of cases) await closeActivityTasks(ctx, c, { when: was.startsAt, place: was.location }, note);
}
