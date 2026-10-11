// Dagens gruppaktiviteter för Min vecka (coachmötet 2026-10-09): coachens (ansvarig eller med egna deltagare) och
// samordnarens (alla i avtalet). Bara för hanterare – läser via ctx.repo (behörigheten gäller), inställda visas inte.
import type { Ctx } from "@/api/server";
import { uniq } from "@/core/util";
import type { LocalDate } from "@/core/time";
import type { GroupActivity } from "@/data/schema";
import type { TodayGroupActivity } from "./api";

export async function todaysGroupActivities(ctx: Ctx, today: LocalDate, include: (g: GroupActivity) => boolean = () => true): Promise<TodayGroupActivity[]> {
  const groups = (await ctx.repo.table("group_activities").list({ startsAt: { gte: `${today}T00:00`, lte: `${today}T23:59` } }, { orderBy: "startsAt" }))
    .filter((g) => !g.cancelledAt && include(g));
  if (!groups.length) return [];
  const acts = await ctx.repo.table("activities").list({ groupActivityId: { in: groups.map((g) => g.id) } });
  const regs = new Set(acts.length ? (await ctx.repo.table("attendance").pick(["activityId"], { activityId: { in: acts.map((a) => a.id) } })).map((r) => r.activityId) : []);
  const names = new Map<string, string>();
  for (const id of uniq(groups.map((g) => g.responsibleId).filter((x): x is string => !!x))) {
    const p = await ctx.repo.table("profiles").get(id);
    if (p) names.set(id, p.fullName);
  }
  return groups.map((g) => {
    const mine = acts.filter((a) => a.groupActivityId === g.id);
    return {
      id: g.id, name: g.name, kind: g.kind, startsAt: g.startsAt, durationMin: g.durationMin, location: g.location, invited: mine.length,
      registered: mine.filter((a) => regs.has(a.id)).length, responsibleName: g.responsibleId ? names.get(g.responsibleId) ?? null : null,
    };
  });
}
