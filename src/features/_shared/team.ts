// Teamet i ett ärende (beslut 2026-10-08, skarp drift): kandidaterna bygger på medlemskapens roller i avtalet – inte på
// profiles.teamRole, som bara testdatat sätter. Rollen coach ger huvudcoach-listan, rollen handledare ger handledar-listan,
// och arbetsgivarmatchare eller SYV/metodstöd kan vara vem som helst av Miljonbemannings personal utom ekonom och
// systemadministratör. Används av Acceptera-dialogen, Ändra team på deltagarkortet och kommandona som skriver case_team.
import type { Role } from "@/api/roles";
import type { Ctx } from "@/api/server";
import { coaches } from "@/core/cases";
import type { Profile, TeamRole } from "@/data/schema";
import { hasRoleIn } from "./context";

/** MB-roller som kan vara arbetsgivarmatchare eller SYV/metodstöd i ett team. */
export const TEAM_STAFF_ROLES: readonly Role[] = ["coach", "handledare", "samordnare", "avtalsansvarig", "chef"];
/** Roller i avtalet som får ha respektive teamroll. */
export const ROLES_FOR_TEAM_ROLE: Record<TeamRole, readonly Role[]> = {
  lead_coach: ["coach"],
  vocational_supervisor: ["handledare", "coach"],
  employer_matcher: TEAM_STAFF_ROLES,
  guidance_counselor: TEAM_STAFF_ROLES,
};

export type TeamCandidate = { id: string; name: string };
export type TeamCandidates = {
  /** Rollen coach i avtalet (huvudcoach). */
  coaches: Profile[];
  /** Rollen handledare i avtalet (yrkesspecifik handledare). */
  supervisors: TeamCandidate[];
  /** Alla MB-roller utom ekonom och systemadministratör (arbetsgivarmatchare, SYV/metodstöd). */
  staff: TeamCandidate[];
};

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "sv");

/** Kandidaterna till teamet i ett avtal, bara aktiva profiler. Läses via behörigheten (profiler och medlemskap i avtalet). */
export async function teamCandidates(ctx: Ctx, contractId: string): Promise<TeamCandidates> {
  const [profiles, memberships] = await Promise.all([ctx.repo.table("profiles").list(), ctx.repo.table("memberships").list({ contractId })]);
  const active = profiles.filter((u) => u.active !== false);
  const byId = new Map(active.map((u) => [u.id, u]));
  const withRole = (roles: readonly Role[]): TeamCandidate[] => {
    const ids = new Set(memberships.filter((m) => roles.includes(m.role)).map((m) => m.userId));
    return [...ids].map((id) => byId.get(id)).filter((u): u is Profile => !!u).map((u) => ({ id: u.id, name: u.fullName })).sort(byName);
  };
  return {
    coaches: coaches({ profiles: active, memberships }, contractId).sort((a, b) => a.fullName.localeCompare(b.fullName, "sv")),
    supervisors: withRole(["handledare"]),
    staff: withRole(TEAM_STAFF_ROLES),
  };
}

/** Får användaren ha teamrollen i avtalet? */
export const canHaveTeamRole = (ctx: Ctx, userId: string, contractId: string, role: TeamRole): Promise<boolean> =>
  hasRoleIn(ctx, userId, contractId, ROLES_FOR_TEAM_ROLE[role]);
