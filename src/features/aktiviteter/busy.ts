// Deltagare som redan har ett annat tillfälle vid en gruppaktivitets tid (krockar). Delas av hanterarna i ./handlers.ts
// (inbjudan, ändrad tid, aktivitetsvyn) och av visningsloggen (session.loggaVisning, group_activity.view): samma uppslag via
// ctx.repo, så att loggen får exakt de deltagare vars namn aktivitetsvyn visar (CLAUDE.md punkt 3).
import type { Ctx } from "@/api/server";
import { audienceOf, belongsOn } from "@/core/audience";
import { ACTIVITY_KIND_WORD, overlaps, slotText } from "@/core/group-activities";
import { dayOf } from "@/core/time";
import { uniq } from "@/core/util";
import type { Activity, Case, GroupActivity, Person } from "@/data/schema";
import type { InviteProblem } from "./api";
import { audienceCases } from "./audience-sync";
import { upcoming } from "./notify-all";

const nameOf = (p: Pick<Person, "firstName" | "lastName"> | null | undefined): string => (p ? `${p.firstName} ${p.lastName}` : "–");

/** En rad per ärende (orsakerna slås ihop), i ärendenummerordning. */
export function mergeProblems(problems: readonly InviteProblem[]): InviteProblem[] {
  const byCase = new Map<string, InviteProblem>();
  for (const p of problems) {
    const cur = byCase.get(p.caseId);
    byCase.set(p.caseId, cur ? { ...cur, reason: `${cur.reason}. ${p.reason}` } : p);
  }
  return [...byCase.values()].sort((a, b) => (a.caseNumber < b.caseNumber ? -1 : 1));
}

/**
 * Deltagarnas andra tillfällen som överlappar aktivitetens tid (samma dag; aktivitetens egna rader räknas inte). Ett eget tillfälle
 * utan närvaro kan ersättas (replaceable); ett tillfälle med registrerad närvaro eller en annan gruppaktivitet stoppar (blocking).
 * Utan kontrollen får deltagaren två planerade tillfällen samtidigt – båda räknas i veckorapporten, närvarograden och den
 * automatiska närvaron (avtalets veckoplan har t.ex. yrkesmoment tisdag och torsdag 09.00).
 */
export async function overlapsFor(
  ctx: Ctx, cases: readonly Case[], slot: { startsAt: string; durationMin: number }, groupActivityId: string | null,
): Promise<{ blocking: InviteProblem[]; replace: InviteProblem[]; replaceable: Activity[] }> {
  const none = { blocking: [], replace: [], replaceable: [] };
  if (!cases.length) return none;
  const day = dayOf(slot.startsAt);
  const caseOf = new Map(cases.map((c) => [c.id, c]));
  const same = (await ctx.repo.table("activities").list({ caseId: { in: [...caseOf.keys()] }, startsAt: { gte: `${day}T00:00`, lte: `${day}T23:59` } }, { orderBy: "startsAt" }))
    .filter((a) => (!groupActivityId || a.groupActivityId !== groupActivityId) && overlaps(a, slot));
  if (!same.length) return none;
  const registered = new Set((await ctx.repo.table("attendance").pick(["activityId"], { activityId: { in: same.map((a) => a.id) } })).map((r) => r.activityId));
  const blocking: InviteProblem[] = [];
  const replace: InviteProblem[] = [];
  const replaceable: Activity[] = [];
  for (const a of same) {
    const c = caseOf.get(a.caseId)!;
    const p = (reason: string): InviteProblem => ({ caseId: c.id, caseNumber: c.caseNumber, reason });
    if (a.groupActivityId) blocking.push(p(`Är redan inbjuden till en annan aktivitet ${slotText(a)}`));
    else if (registered.has(a.id)) blocking.push(p(`Har redan ${ACTIVITY_KIND_WORD[a.kind]} ${slotText(a)} med registrerad närvaro`));
    else {
      replace.push(p(`Har redan ${ACTIVITY_KIND_WORD[a.kind]} ${slotText(a)}. Det ersätts av aktiviteten`));
      replaceable.push(a);
    }
  }
  return { blocking: mergeProblems(blocking), replace: mergeProblems(replace), replaceable };
}

/** En deltagare i målgruppen som inte är inbjuden för att hen redan har ett annat tillfälle vid samma tid. */
export type AudienceBusy = InviteProblem & { name: string; replaceable: boolean };

/**
 * Målgruppens deltagare som synkningen hoppade över: de hör till målgruppen den dagen men har redan ett annat tillfälle vid samma
 * tid (samma regel som planAudienceSync). Bara för en kommande aktivitet med målgrupp – och bara de aktören får se (ctx.repo).
 * invited: ärendena som redan är inbjudna. Visas i aktivitetsvyn med namn – och loggas därför i group_activity.view.
 */
export async function audienceBusyOf(ctx: Ctx, g: GroupActivity, invited: readonly string[]): Promise<AudienceBusy[]> {
  const audience = audienceOf(g);
  const out: AudienceBusy[] = [];
  if (!audience || g.cancelledAt || !upcoming(ctx, g.startsAt)) return out;
  const day = dayOf(g.startsAt);
  const already = new Set(invited);
  const { cases: all, levelOf } = await audienceCases(ctx, g.contractId, null);
  const candidates = all.filter((c) => !already.has(c.id) && belongsOn(audience, c, levelOf, day));
  const visible = candidates.length ? await ctx.repo.table("cases").list({ id: { in: candidates.map((c) => c.id) } }) : [];
  const ov = await overlapsFor(ctx, visible, g, g.id);
  const persons = visible.length ? await ctx.repo.table("persons").list({ id: { in: uniq(visible.map((c) => c.personId)) } }) : [];
  const personOf = new Map(persons.map((x) => [x.id, x]));
  const caseOf = new Map(visible.map((c) => [c.id, c]));
  for (const [list, replaceable] of [[ov.blocking, false], [ov.replace, true]] as const) {
    for (const x of list) {
      if (out.some((b) => b.caseId === x.caseId)) continue;
      const c = caseOf.get(x.caseId);
      out.push({ ...x, name: nameOf(c ? personOf.get(c.personId) ?? null : null), replaceable: replaceable && !ov.blocking.some((b) => b.caseId === x.caseId) });
    }
  }
  return out.sort((x, y) => x.name.localeCompare(y.name, "sv") || (x.caseNumber < y.caseNumber ? -1 : 1));
}
