// Vem är inloggad i supabase-läget? Aktören (Actor) kommer från databasens public.current_actor() – samma funktioner
// som RLS använder (mm.current_profile_id, mm.current_roles, mm.my_contract_ids … – 0034: alla roller samtidigt) – så att
// hanterarnas rollkontroll och RLS alltid ser samma aktör. Testare (profiles.is_tester) kan i testmiljön agera som en testperson (tester_sessions).
// I produktion finns ingen testarfunktion (databasen svarar då alltid med den egna profilen).
import { ROLES, sortRoles, type Actor, type Role } from "@/api/roles";
import { hidesCommercial, roleHiddenFromTesters } from "@/api/tester-access";
import { listPersonas, personaFor, type Persona } from "@/data/actors";
import type { RawAccess } from "@/data/memory";
import type { Membership, Organization, Profile, Tables } from "@/data/schema";
import type { PersonaOption } from "@/shell/session";
import { canImpersonate, type Environment } from "./session-policy";

/** Profilraden i databasen har två kolumner utöver schemat: auth_user_id och is_tester. */
export type ProfileRow = Profile & { authUserId?: string | null; isTester?: boolean | null };

/** Svaret från public.current_actor() (supabase/migrations/0002_anvandare.sql, 0034_alla_roller.sql). */
export type DbActor = {
  authProfileId: string | null;
  isTester: boolean;
  environment: string | null;
  impersonating: boolean;
  userId: string | null;
  /** Alla roller (mm.current_roles(), 0034). */
  roles: string[] | null;
  /** Avtalen per roll (0034). */
  roleContracts?: Record<string, string[]> | null;
  contractIds: string[] | null;
  customerUnit: string | null;
};

export type Directory = { profiles: Profile[]; memberships: Membership[]; organizations: Organization[] };

/** Uppslag som identiteten behöver. Fejkas i tester. */
export type IdentityStore = {
  /** public.current_actor() med användarens session (null = ingen session). */
  currentActor(): Promise<DbActor | null>;
  /** Profiler, medlemskap och organisationer (service role) – för vissa profiler eller alla (testarens personaväljare). */
  directory(scope: "self" | "all", profileIds: string[]): Promise<Directory>;
};

export type Identity = {
  /** Den inloggades egen profil. */
  self: ProfileRow;
  /** Den som hanterarna och RLS ser: egen persona eller testarens valda testperson. */
  persona: Persona;
  isTester: boolean;
  impersonating: boolean;
  /** Testarens valbara testpersoner (tom för alla andra). */
  personas: PersonaOption[];
};

/** Enkel RawAccess över några tabeller (för personaFor/listPersonas i src/data/actors.ts). */
export function rawOf(tables: Partial<{ [N in keyof Tables]: Tables[N][] }>): RawAccess<Tables> {
  const idx = new Map<string, Map<string, unknown>>();
  const all = <N extends keyof Tables & string>(name: N): readonly Tables[N][] => (tables[name] ?? []) as Tables[N][];
  return {
    all,
    get: <N extends keyof Tables & string>(name: N, id: string) => {
      let m = idx.get(name);
      if (!m) {
        m = new Map(all(name).map((r) => [r.id, r]));
        idx.set(name, m);
      }
      return m.get(id) as Tables[N] | undefined;
    },
  };
}

export const toOption = (p: Persona): PersonaOption => ({ userId: p.actor.userId, role: p.role, roles: p.actor.roles, name: p.user.name, title: p.user.title, isDefaultForRole: p.isDefaultForRole });

/**
 * Testpersonerna som testaren får välja ("Agera som"). En begränsad testare (src/api/tester-access.ts) får inte välja en
 * testperson med rollen ekonom – hela rollen handlar om fakturering och belopp. Alla andra får hela listan.
 */
export function personaOptionsFor(options: PersonaOption[], actor: Pick<Actor, "testerId"> | null | undefined): PersonaOption[] {
  return hidesCommercial(actor) ? options.filter((p) => !p.roles.some(roleHiddenFromTesters)) : options;
}

const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);

/** Identiteten för den inloggade, eller null om profilen saknas, är spärrad eller saknar roll. */
export async function resolveIdentity(store: IdentityStore, environment: Environment): Promise<Identity | null> {
  const a = await store.currentActor();
  const roles = sortRoles((a?.roles ?? []).filter(isRole));
  if (!a?.authProfileId || !a.userId || !roles.length) return null;
  const tester = canImpersonate(environment, a.isTester === true);
  const dir = rawOf(await store.directory(tester ? "all" : "self", [...new Set([a.authProfileId, a.userId])]));
  const self = dir.get("profiles", a.authProfileId) as ProfileRow | undefined;
  if (!self || !self.active) return null;

  // Aktören exakt som databasen ser den. Namn och titel från profilen (samma som testpersonerna i prototypen).
  // testerId = mm.auth_is_tester(): den inloggade testaren i testmiljön (RLS för synpunkterna ser testaren, inte testpersonen).
  const contractIds = [...(a.contractIds ?? [])].sort();
  const roleContracts: Partial<Record<Role, string[]>> = {};
  for (const r of roles) {
    const own = [...(a.roleContracts?.[r] ?? contractIds)].sort();
    if (own.length !== contractIds.length) roleContracts[r] = own;
  }
  const actor: Actor = {
    userId: a.userId, roles, contractIds, ...(Object.keys(roleContracts).length ? { roleContracts } : {}), customerUnit: a.customerUnit ?? null,
    ...(tester ? { testerId: a.authProfileId } : {}),
  };
  const known = personaFor(dir, a.userId);
  const persona: Persona = known
    ? { ...known, actor }
    : { actor, user: { id: self.id, name: self.fullName, title: self.title, email: self.email, orgName: dir.get("organizations", self.organizationId)?.name ?? "", unit: self.customerUnit }, role: roles[0], isDefaultForRole: false, roleDescription: "" };
  const impersonating = tester && a.impersonating === true;
  return {
    self, persona, isTester: tester, impersonating,
    personas: tester ? personaOptionsFor(listPersonas(dir).map(toOption), actor) : [],
  };
}

/**
 * Testpersonen testaren får välja, eller null. (Kontrolleras innan tester_sessions skrivs.) Testpersonen har alla sina roller
 * samtidigt; role i tester_sessions blir personens huvudroll (raden kräver en roll som personen har).
 */
export function impersonationTarget(identity: Identity | null, userId: string): PersonaOption | null {
  if (!identity?.isTester) return null;
  const p = identity.personas.find((x) => x.userId === userId);
  if (!p) return null;
  // Begränsade testare: aldrig en testperson med rollen ekonom (uttrycklig kontroll utöver den filtrerade listan).
  if (hidesCommercial(identity.persona.actor) && p.roles.some(roleHiddenFromTesters)) return null;
  return p;
}
/** Får testaren välja den här testpersonen? */
export const mayImpersonate = (identity: Identity | null, target: { userId: string }): boolean => impersonationTarget(identity, target.userId) !== null;
