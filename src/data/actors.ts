// Användare och roller (profiles + memberships) -> Actor och testpersoner.
// Riktiga appen: aktören kommer från inloggningen (Microsoft för MB, e-postkod för kommunen) och medlemskapen i databasen.
// Prototypen och utvecklingsläget: välj testperson. Standardpersonerna per roll är den gamla prototypens MM.ROLES
// (prototyp/src/02-store.js); övriga användare i testdatat kan väljas med sin roll.
import type { Actor, Role } from "@/api/roles";
import type { SessionUser } from "@/shell/session";
import type { RawAccess } from "./memory";
import type { Membership, Profile, Tables } from "./schema";

export type Persona = { actor: Actor; user: SessionUser; isDefaultForRole: boolean; roleDescription: string };

export type PrototypeRole = {
  key: Role;
  /** Kort etikett i rollväljaren (prototypens label). */
  label: string;
  org: "mb" | "customer" | "participant";
  /** Standardperson för rollen. Deltagaren har ingen användare (pulslänk utan inloggning). */
  personaId: string | null;
  description: string;
};

/** Rollerna i prototypens ordning, med standardperson och beskrivning (prototypens MM.ROLES). */
export const PROTOTYPE_ROLES: readonly PrototypeRole[] = [
  { key: "samordnare", label: "Samordnare", org: "mb", personaId: "u-sara", description: "Avropsinkorg med SLA-klocka, tilldelar coach, bokar start." },
  { key: "avtalsansvarig", label: "Avtalsansvarig", org: "mb", personaId: "u-johan", description: "Accepterar och avböjer avrop, avtalsavvikelser, godkänner beställarrapport." },
  { key: "coach", label: "Huvudcoach", org: "mb", personaId: "u-amira", description: "Min vecka: närvaro, avstämningar, månadsbedömningar och rapporter." },
  { key: "handledare", label: "Handledare", org: "mb", personaId: "u-petra", description: "Ser bara tilldelade ärenden: moment, praktik och närvaro." },
  { key: "chef", label: "Chef och controller", org: "mb", personaId: "u-karin", description: "KPI:er mot mål, flaggor, prognos, avvikelser och revisionslogg." },
  { key: "ekonom", label: "Ekonom", org: "mb", personaId: "u-lars", description: "Fakturaunderlag per ärende och månad – inga anteckningar eller rapporter." },
  { key: "admin", label: "Systemadmin", org: "mb", personaId: "u-robin", description: "Avtalskonfiguration, användare, underbiträden och logg." },
  { key: "kommun_handlaggare", label: "Kommunens handläggare", org: "customer", personaId: "k-maria", description: "Beställer, läser rapporter och skickar meddelanden." },
  { key: "deltagare", label: "Deltagare (pulslänk)", org: "participant", personaId: null, description: "Svarar på pulsmätningen via engångslänk – ingen inloggning." },
];

export type PrototypePerspective = { key: "leverantor" | "kund" | "deltagare"; label: string; long: string; roles: Role[]; defaultRole: Role };
/** Perspektiven i prototypfältet (prototypens MM.PERSPECTIVES). */
export const PERSPECTIVES: readonly PrototypePerspective[] = [
  { key: "leverantor", label: "Leverantör", long: "Leverantörens perspektiv – Miljonbemanning", roles: ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "ekonom", "admin"], defaultRole: "samordnare" },
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
 * Aktören för en användare i en roll: avtal = medlemskapen med rollen. Null om användaren saknar rollen.
 * Enheten (synligheten "unit") tas bara från medlemskapet, som Miljonbemanning sätter – aldrig från profilen, som
 * handläggaren själv skriver i Mina uppgifter (beslut 2026-10-07, självregistrering). Samma regel i mm.current_unit (0026).
 */
export function actorFor(raw: RawAccess<Tables>, userId: string, role?: Role): Actor | null {
  if (userId === PARTICIPANT_USER_ID) return { userId, role: "deltagare", contractIds: [], customerUnit: null };
  const profile = raw.get("profiles", userId);
  if (!profile) return null;
  const ms = raw.all("memberships").filter((m) => m.userId === userId);
  const r = role ?? ms[0]?.role;
  const mine = ms.filter((m) => m.role === r);
  if (!r || !mine.length) return null;
  return { userId, role: r, contractIds: [...new Set(mine.map((m) => m.contractId))], customerUnit: mine[0].customerUnit ?? null };
}

function personaOf(raw: RawAccess<Tables>, p: Profile, role: Role, isDefaultForRole: boolean): Persona | null {
  const actor = actorFor(raw, p.id, role);
  if (!actor) return null;
  return { actor, user: userOf(raw, p), isDefaultForRole, roleDescription: roleDef(role)?.description ?? "" };
}

/**
 * Valbara testpersoner: först standardpersonen för varje roll i prototypens ordning (även deltagaren),
 * sedan övriga aktiva användare (MB-personal och kommunanvändare) med sin roll, i testdatats ordning.
 */
export function listPersonas(raw: RawAccess<Tables>): Persona[] {
  const out: Persona[] = [];
  const seen = new Set<string>();
  const add = (p: Persona | null) => {
    if (!p) return;
    const key = `${p.actor.userId}|${p.actor.role}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p);
  };
  for (const def of PROTOTYPE_ROLES) {
    if (def.key === "deltagare") {
      add({
        actor: { userId: PARTICIPANT_USER_ID, role: "deltagare", contractIds: [], customerUnit: null },
        user: { id: PARTICIPANT_USER_ID, name: "Deltagare", title: def.label, email: "", orgName: "", unit: null },
        isDefaultForRole: true, roleDescription: def.description,
      });
      continue;
    }
    const p = def.personaId ? raw.get("profiles", def.personaId) : undefined;
    if (p) add(personaOf(raw, p, def.key, true));
  }
  const memberships = raw.all("memberships");
  const rolesOf = (userId: string) => [...new Set(memberships.filter((m: Membership) => m.userId === userId).map((m) => m.role))];
  for (const p of raw.all("profiles")) {
    if (!p.active) continue;
    for (const role of rolesOf(p.id)) add(personaOf(raw, p, role, false));
  }
  return out;
}

/** Testperson för en användare (och roll). Utan roll: användarens första persona. */
export function personaFor(raw: RawAccess<Tables>, userId: string, role?: Actor["role"]): Persona | null {
  const all = listPersonas(raw);
  return all.find((p) => p.actor.userId === userId && (!role || p.actor.role === role)) ?? all.find((p) => p.actor.userId === userId) ?? null;
}

/** Standardpersonen för en roll. */
export const defaultPersonaFor = (raw: RawAccess<Tables>, role: Role): Persona | null =>
  listPersonas(raw).find((p) => p.actor.role === role && p.isDefaultForRole) ?? null;
