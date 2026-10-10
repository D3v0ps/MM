// Åtkomsten till ett ärende per roll i hanterarna (alla roller samtidigt, Karims beslut 7, 2026-10-09). Bara för hanterare –
// importeras aldrig av skärmar.
//
// En hanterare som släpps in på vissa roller frågar "har någon av DE rollerna nivån?" – aldrig den högsta nivån över alla
// aktörens roller (caseAccess). Annars ger en roll rätt i en annan rolls namn: den som är samordnare i ett avtal och chef i ett
// annat skulle få samordnarens rätt i chefens avtal. Samma fråga som policyerna i RLS (mm.case_access_as, 0034).
import type { Role } from "@/api/roles";
import type { Ctx } from "@/api/server";
import { caseAccessFor, lookupsFor, type AccessSource, type CaseAccess } from "@/core/access";
import type { Case } from "@/data/schema";

/** Fälten i ärendet som åtkomsten bygger på. */
export type AccessCase = Pick<Case, "id" | "contractId" | "personId" | "leadCoachId" | "referrerId" | "referrerUnit">;

/**
 * Uppslagen som behörigheten bygger på (skyddad person, team, handläggarens enhet, avtalets synlighet).
 * ctx.system: samma uppslag som policyn gör utan filter (security definer i Postgres). Bara flaggor och id:n används.
 */
export async function caseAccessSource(ctx: Ctx, cases: readonly Pick<Case, "id" | "personId" | "referrerId" | "contractId">[]): Promise<AccessSource> {
  const personIds = [...new Set(cases.map((c) => c.personId))];
  const caseIds = [...new Set(cases.map((c) => c.id))];
  const referrerIds = [...new Set(cases.map((c) => c.referrerId).filter((x): x is string => !!x))];
  const contractIds = [...new Set(cases.map((c) => c.contractId))];
  const [persons, team, profiles, contracts] = await Promise.all([
    personIds.length ? ctx.system.table("persons").pick(["protectedIdentity"], { id: { in: personIds } }) : [],
    caseIds.length ? ctx.system.table("case_team").pick(["caseId", "userId"], { caseId: { in: caseIds } }) : [],
    referrerIds.length ? ctx.system.table("profiles").pick(["customerUnit"], { id: { in: referrerIds } }) : [],
    contractIds.length ? ctx.system.table("contracts").pick(["config"], { id: { in: contractIds } }) : [],
  ]);
  const prot = new Map(persons.map((p) => [p.id, { protectedIdentity: !!p.protectedIdentity }]));
  const teamBy = new Map<string, string[]>();
  for (const t of team) teamBy.set(t.caseId, [...(teamBy.get(t.caseId) ?? []), t.userId]);
  const prof = new Map(profiles.map((p) => [p.id, { customerUnit: p.customerUnit }]));
  const cons = new Map(contracts.map((c) => [c.id, { config: c.config }]));
  return {
    person: (id) => prot.get(id),
    teamUserIds: (caseId) => teamBy.get(caseId) ?? [],
    profile: (id) => prof.get(id),
    contract: (id) => cons.get(id),
  };
}

/** Den högsta nivån till ärendet bland de angivna rollerna (de som aktören har) – none om ingen av rollerna når det. */
export async function caseAccessAsRoles(ctx: Ctx, c: AccessCase, roles: readonly Role[]): Promise<CaseAccess> {
  if (!ctx.actor.roles.some((r) => roles.includes(r))) return "none";
  const src = await caseAccessSource(ctx, [c]);
  return caseAccessFor(c, ctx.actor, lookupsFor(c, src), roles);
}
