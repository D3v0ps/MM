// Användare och roller (profiles + memberships) -> Actor och testpersoner.
// Riktiga appen: aktören kommer från inloggningen (Microsoft för MB, e-postkod för kommunen) och medlemskapen i databasen.
// Prototypen och utvecklingsläget: välj testperson. Standardpersonerna per roll är den gamla prototypens MM.ROLES
// (prototyp/src/02-store.js); övriga användare i testdatat kan väljas med alla sina roller (en testperson per användare).
import { isCustomerRole, ROLES, sortRoles, type Actor, type Role } from "@/api/roles";
import type { SessionUser } from "@/shell/session";
import type { RawAccess } from "./memory";
import type { Profile, Tables } from "./schema";

/**
 * En testperson: användaren med alla sina roller (Karims beslut 7, 2026-10-09 – ingen rollväxling). role = personens
 * huvudroll för visning och val i prototypfältet: rollen personen är standardperson för, annars den första i rollernas ordning.
 */
export type Persona = { actor: Actor; user: SessionUser; role: Role; isDefaultForRole: boolean; roleDescription: string };

export type PrototypeRole = {
  key: Role;
  /** Kort etikett i rollväljaren (prototypens label). */
  label: string;
  org: "mb" | "customer" | "participant";
  /** Standardperson för rollen. Deltagaren har ingen användare (pulslänk utan inloggning). */
  personaId: string | null;
  description: string;
};

/**
 * Rollerna i prototypens ordning, med standardperson och beskrivning (prototypens MM.ROLES). Rollen handledare är borttagen
 * (Karims beslut 2026-10-09, vilande i databasen) – ingen testperson har den.
 */
export const PROTOTYPE_ROLES: readonly PrototypeRole[] = [
  { key: "samordnare", label: "Samordnare", org: "mb", personaId: "u-sara", description: "Avropsinkorg med SLA-klocka, tilldelar coach, bokar start." },
  { key: "avtalsansvarig", label: "Avtalsansvarig", org: "mb", personaId: "u-johan", description: "Accepterar och avböjer avrop, avtalsavvikelser, godkänner beställarrapport." },
  { key: "coach", label: "Huvudcoach", org: "mb", personaId: "u-amira", description: "Min vecka: närvaro, avstämningar, månadsbedömningar och rapporter." },
  { key: "chef", label: "Chef och controller", org: "mb", personaId: "u-karin", description: "KPI:er mot mål, flaggor, prognos, avvikelser och revisionslogg." },
  { key: "ekonom", label: "Ekonom", org: "mb", personaId: "u-lars", description: "Fakturaunderlag per ärende och månad – inga anteckningar eller rapporter." },
  { key: "admin", label: "Systemadmin", org: "mb", personaId: "u-robin", description: "Avtalskonfiguration, användare, underbiträden och logg." },
  { key: "kommun_handlaggare", label: "Kommunens handläggare", org: "customer", personaId: "k-maria", description: "Beställer, läser rapporter och skickar meddelanden." },
  { key: "deltagare", label: "Deltagare (pulslänk)", org: "participant", personaId: null, description: "Svarar på pulsmätningen via engångslänk – ingen inloggning." },
];

export type PrototypePerspective = { key: "leverantor" | "kund" | "deltagare"; label: string; long: string; roles: Role[]; defaultRole: Role };
/** Perspektiven i prototypfältet (prototypens MM.PERSPECTIVES). */
export const PERSPECTIVES: readonly PrototypePerspective[] = [
  { key: "leverantor", label: "Leverantör", long: "Leverantörens perspektiv – Miljonbemanning", roles: ["samordnare", "avtalsansvarig", "coach", "chef", "ekonom", "admin"], defaultRole: "samordnare" },
  { key: "kund", label: "Kund", long: "Kundens perspektiv – Botkyrka kommun", roles: ["kommun_handlaggare"], defaultRole: "kommun_handlaggare" },
  { key: "deltagare", label: "Deltagare", long: "Deltagarens perspektiv", roles: ["deltagare"], defaultRole: "deltagare" },
];

/** Deltagaren (pulslänk) har ingen användare och inga avtal – svaren tas emot via engångslänken. */
export const PARTICIPANT_USER_ID = "deltagare";

const roleDef = (role: Role) => PROTOTYPE_ROLES.find((r) => r.key === role);

function userOf(raw: RawAccess<Tables>, p: Profile): SessionUser {
  return { id: p.id, name: p.fullName, title: p.title, email: p.email, orgName: raw.get("organizations", p.organizationId)?.name ?? "", unit: p.customerUnit };
}

/**
 * Aktören för en användare: alla roller (medlemskapen), avtalen per roll och kommunens enhet – samma regel som
 * mm.current_roles(), mm.contracts_as och mm.current_unit i databasen (0034). Null om användaren saknas eller saknar roller,
 * eller om role anges och användaren inte har den rollen.
 * Enheten (synligheten "unit") tas bara från kommunens medlemskap (lägst id), som Miljonbemanning sätter – aldrig från
 * profilen, som handläggaren själv skriver i Mina uppgifter (beslut 2026-10-07, självregistrering). Samma regel i mm.current_unit.
 */
export function actorFor(raw: RawAccess<Tables>, userId: string, role?: Role): Actor | null {
  if (userId === PARTICIPANT_USER_ID) return role && role !== "deltagare" ? null : { userId, roles: ["deltagare"], contractIds: [], customerUnit: null };
  const profile = raw.get("profiles", userId);
  if (!profile) return null;
  const ms = raw.all("memberships").filter((m) => m.userId === userId).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const roles = sortRoles([...new Set(ms.map((m) => m.role))]);
  if (!roles.length || (role && !roles.includes(role))) return null;
  const contractIds = [...new Set(ms.map((m) => m.contractId))].sort();
  const roleContracts: Partial<Record<Role, string[]>> = {};
  for (const r of roles) {
    const own = [...new Set(ms.filter((m) => m.role === r).map((m) => m.contractId))].sort();
    if (own.length !== contractIds.length) roleContracts[r] = own;
  }
  const unit = ms.find((m) => isCustomerRole(m.role))?.customerUnit ?? null;
  return { userId, roles, contractIds, ...(Object.keys(roleContracts).length ? { roleContracts } : {}), customerUnit: unit };
}

/** Rollerna användaren har medlemskap för (dubbletter borttagna, i rollernas ordning i SPEC §4). */
export function ownRolesOf(raw: RawAccess<Tables>, userId: string): Role[] {
  const mine = new Set(raw.all("memberships").filter((m) => m.userId === userId).map((m) => m.role));
  return ROLES.filter((r) => mine.has(r));
}

function personaOf(raw: RawAccess<Tables>, p: Profile, defaultFor: Role | null): Persona | null {
  const actor = actorFor(raw, p.id);
  if (!actor) return null;
  const role = defaultFor ?? actor.roles[0];
  return { actor, user: userOf(raw, p), role, isDefaultForRole: defaultFor !== null, roleDescription: roleDef(role)?.description ?? "" };
}

/**
 * Valbara testpersoner, en per användare med alla roller: först standardpersonen för varje roll i prototypens ordning (även
 * deltagaren), sedan övriga aktiva användare (MB-personal och kommunanvändare) i testdatats ordning.
 */
export function listPersonas(raw: RawAccess<Tables>): Persona[] {
  const out: Persona[] = [];
  const seen = new Set<string>();
  const add = (p: Persona | null) => {
    if (!p || seen.has(p.actor.userId)) return;
    seen.add(p.actor.userId);
    out.push(p);
  };
  for (const def of PROTOTYPE_ROLES) {
    if (def.key === "deltagare") {
      add({
        actor: { userId: PARTICIPANT_USER_ID, roles: ["deltagare"], contractIds: [], customerUnit: null },
        user: { id: PARTICIPANT_USER_ID, name: "Deltagare", title: def.label, email: "", orgName: "", unit: null },
        role: "deltagare", isDefaultForRole: true, roleDescription: def.description,
      });
      continue;
    }
    const p = def.personaId ? raw.get("profiles", def.personaId) : undefined;
    if (p && ownRolesOf(raw, p.id).includes(def.key)) add(personaOf(raw, p, def.key));
  }
  for (const p of raw.all("profiles")) {
    if (!p.active) continue;
    add(personaOf(raw, p, null));
  }
  return out;
}

/** Testpersonen för en användare (alla roller). */
export function personaFor(raw: RawAccess<Tables>, userId: string): Persona | null {
  return listPersonas(raw).find((p) => p.actor.userId === userId) ?? null;
}

/** Standardpersonen för en roll (annars den första personen med rollen). */
export const defaultPersonaFor = (raw: RawAccess<Tables>, role: Role): Persona | null => {
  const all = listPersonas(raw);
  return all.find((p) => p.role === role && p.isDefaultForRole) ?? all.find((p) => p.actor.roles.includes(role)) ?? null;
};
