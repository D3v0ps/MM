// Alla coacher ser alla deltagare (Karims beslut 2026-11-11: "Alla ser alla"): coachens Min vecka, Närvaro och listorna som hör till
// dem visar alla ärenden i avtalen där personen har rollen coach – inte bara de där hen är huvudcoach. Huvudcoachen styr bara
// notiser, mejl, påminnelser till coachen och kommunens kontakt (mottagarna är oförändrade). Bara för hanterare.
// Läsningen går via ctx.repo (RLS/policy.ts: alla på Miljonbemanning läser alla ärenden i avtalet sedan 2026-10-09).
import type { Ctx } from "@/api/server";
import { personName } from "@/core/labels";
import type { Case, Profile } from "@/data/schema";
import type { Where } from "@/data/repo";

/** Avtalen där användaren har rollen coach (de egna medlemskapen). */
export async function coachContractIds(ctx: Ctx): Promise<string[]> {
  const ms = await ctx.repo.table("memberships").list({ userId: ctx.actor.userId, role: "coach" });
  return [...new Set(ms.map((m) => m.contractId))].sort();
}

/** Alla ärenden i avtalen där användaren är coach (med ett extra filter), i ärendenummerordning. */
export async function coachCases(ctx: Ctx, filter: Where<Case> = {}): Promise<Case[]> {
  const contracts = await coachContractIds(ctx);
  if (!contracts.length) return [];
  return (await ctx.repo.table("cases").list({ ...filter, contractId: { in: contracts } })).sort((a, b) => a.caseNumber.localeCompare(b.caseNumber));
}

/** "Amira" – huvudcoachens förnamn för raderna (tydligare när alla coacher ser alla deltagare). null utan huvudcoach. */
export function leadCoachFirstName(profiles: readonly Pick<Profile, "id" | "fullName">[], leadCoachId: string | null | undefined): string | null {
  if (!leadCoachId) return null;
  const full = personName(profiles as readonly Profile[], leadCoachId);
  return full && full !== "–" ? full.split(" ")[0] : null;
}
