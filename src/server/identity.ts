// Vem är inloggad i supabase-läget? Auth-användaren (auth.uid) -> profil -> aktör och testperson.
// Testare (profiles.is_tester) får i testmiljön agera som en testperson (tester_sessions) – RLS gör samma sak i databasen
// via mm.current_profile_id(). I produktion finns ingen testarfunktion.
import type { Role } from "@/api/roles";
import { listPersonas, personaFor, type Persona } from "@/data/actors";
import type { RawAccess } from "@/data/memory";
import type { Membership, Organization, Profile, Tables } from "@/data/schema";
import type { PersonaOption } from "@/shell/session";
import { canImpersonate, type Environment } from "./session-policy";

/** Profilraden i databasen har två kolumner utöver schemat: auth_user_id och is_tester. */
export type ProfileRow = Profile & { authUserId?: string | null; isTester?: boolean | null };
export type TesterSession = { profileId: string; role: Role };

/** Uppslag som identiteten behöver (service role). Fejkas i tester. */
export type IdentityStore = {
  profileByAuthUser(authUserId: string): Promise<ProfileRow | null>;
  testerSession(authUserId: string): Promise<TesterSession | null>;
  /** Profiler, medlemskap och organisationer – för en användare ("self") eller alla (testarens personaväljare). */
  directory(scope: "self" | "all", profileId: string): Promise<{ profiles: Profile[]; memberships: Membership[]; organizations: Organization[] }>;
};

export type Identity = {
  authUserId: string;
  /** Den inloggades egen profil. */
  self: ProfileRow;
  /** Den som hanterarna och RLS ser: egen persona eller testarens valda testperson. */
  persona: Persona;
  isTester: boolean;
  impersonating: boolean;
  /** Testarens valbara testpersoner (tom för alla andra). */
  personas: PersonaOption[];
};

/** Enkel RawAccess över några tabeller (för actorFor/listPersonas i src/data/actors.ts). */
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

export const toOption = (p: Persona): PersonaOption => ({ userId: p.actor.userId, role: p.actor.role, name: p.user.name, title: p.user.title, isDefaultForRole: p.isDefaultForRole });

/** Testpersoner som en testare kan välja. Deltagaren (pulslänk utan inloggning) nås via länken, inte som inloggad. */
export const selectablePersonas = (raw: RawAccess<Tables>): Persona[] => listPersonas(raw).filter((p) => p.actor.role !== "deltagare");

/** Identiteten för en inloggad auth-användare, eller null om profilen saknas, är spärrad eller saknar roll. */
export async function resolveIdentity(store: IdentityStore, authUserId: string, environment: Environment): Promise<Identity | null> {
  const self = await store.profileByAuthUser(authUserId);
  if (!self || !self.active) return null;
  const tester = canImpersonate(environment, self.isTester === true);
  const dir = rawOf(await store.directory(tester ? "all" : "self", self.id));
  const own = personaFor(dir, self.id);
  if (!own || own.actor.userId !== self.id) return null;

  let persona = own;
  let personas: PersonaOption[] = [];
  if (tester) {
    const selectable = selectablePersonas(dir);
    personas = selectable.map(toOption);
    const ts = await store.testerSession(authUserId);
    const picked = ts ? selectable.find((p) => p.actor.userId === ts.profileId && p.actor.role === ts.role) : undefined;
    if (picked) persona = picked;
  }
  const impersonating = persona.actor.userId !== own.actor.userId || persona.actor.role !== own.actor.role;
  return { authUserId, self, persona, isTester: tester, impersonating, personas };
}

/** Får testaren välja den här testpersonen? (Kontrolleras innan tester_sessions skrivs.) */
export function mayImpersonate(identity: Identity | null, target: { userId: string; role: string }): boolean {
  if (!identity?.isTester) return false;
  return identity.personas.some((p) => p.userId === target.userId && p.role === target.role);
}
