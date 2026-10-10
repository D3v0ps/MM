// Behörighet per ärende (SPEC §4, CLAUDE.md punkt 1 och 8) – rena funktioner utan I/O.
// Port av prototypens sel.access, sel.canSeeNotes, sel.visibleCases och sel.displayName (prototyp/src/03-domain.js),
// med två tillägg som prototypen inte behövde: avtalsmedlemskap (bara ärenden i användarens avtal) och kommunens
// synlighet enligt avtalskonfigurationen (egna ärenden, enhetens eller alla).
//
// Beslut 2026-10-09 (Karim): alla på Miljonbemanning ser och arbetar i alla ärenden i avtalet – coachen (och den vilande
// rollen handledare) får "full" som samordnaren, inte bara i teamets ärenden. Tilldelningen (case_team) finns kvar och styr
// notiser, mejl, påminnelser och Mina ärenden – inte åtkomsten. Kommunen ser bara sina egna.
//
// Samma regler används av policyn i minnesläget (src/data/policy.ts) och av RLS i Postgres (mm.case_access_level, 0029).
//
// Nivåer:
//   full        allt i ärendet (anteckningar, bedömningar, personuppgifter)
//   team        finns kvar i typen men ges inte längre till någon roll (före 2026-10-09: tilldelad i teamet utan att vara
//               huvudcoach). Skärmar och regler som behandlar "team" fungerar oförändrat om nivån skulle behövas igen.
//   restricted  ärendet finns (nummer och status) men personen och detaljerna döljs – skyddade personuppgifter.
//               VILANDE sedan 2026-10-07 (Karims beslut): skyddet är borttaget ur appen och persons.protected_identity är
//               alltid false, så nivån uppstår inte. Spärren ligger kvar här, i policy.ts och i RLS så att skyddet kan slås
//               på igen utan migration om Botkyrka kräver det. Skärmarna behandlar "restricted" som ingen åtkomst.
//   billing     ekonom: nummer, perioder, område, referenser och närvaro för debitering – inga namn eller anteckningar
//   customer    kommunen: sina ärenden (inga coachanteckningar, internt mål eller interna flaggor)
//   none        ingen åtkomst
import type { Actor, Role } from "@/api/roles";
import type { Case, Contract, Db, Person, Profile } from "@/data/schema";
import { isUnset, type ContractConfig, type VisibilityScope } from "./config";

export const CASE_ACCESS_LEVELS = ["full", "team", "restricted", "billing", "customer", "none"] as const;
export type CaseAccess = (typeof CASE_ACCESS_LEVELS)[number];

/** Fälten i ärendet som behörigheten bygger på. */
export type CaseAccessCase = Pick<Case, "contractId" | "leadCoachId" | "referrerId">;

/** Uppslag utanför ärendet. Hämtas utan behörighetsfilter (motsvarar en security definer-funktion i Postgres). */
export type CaseAccessLookups = {
  /** Personen har skyddade personuppgifter. */
  protectedIdentity: boolean;
  /** Användare i ärendets team (case_team.userId, inklusive huvudcoachen). Styr inte åtkomsten sedan 2026-10-09 – behålls i uppslaget (och i mm.case_access_level) så att teamnivån kan slås på igen utan ny signatur. */
  teamUserIds: readonly string[];
  /** Beställande handläggares enhet (profilen, annars ärendets referrerUnit) – för synlighet "unit". */
  referrerUnit?: string | null;
  /** Kommunens handläggare: egna ärenden, enhetens eller alla (effectiveCustomerScope). Standard "own". */
  customerScope?: VisibilityScope;
};

/** Kommunens synlighet enligt avtalet: fastställt värde, annars det preliminära, annars "own" (det mest begränsade). */
export function effectiveCustomerScope(cfg: Pick<ContractConfig, "customerVisibility"> | null | undefined): VisibilityScope {
  const v = cfg?.customerVisibility;
  if (!v) return "own";
  if (v.scope && !isUnset(v.scope)) return v.scope;
  return v.prototypeScope ?? "own";
}

/** Åtkomstnivå för aktören i ärendet. Admin har alla avtal; övriga bara avtal de är medlemmar i. */
export function caseAccess(c: CaseAccessCase | null | undefined, actor: Actor, l: CaseAccessLookups): CaseAccess {
  if (!c) return "none";
  if (actor.role !== "admin" && !actor.contractIds.includes(c.contractId)) return "none";
  const prot = l.protectedIdentity;
  switch (actor.role) {
    case "avtalsansvarig":
      return "full";
    case "samordnare":
    case "chef":
    case "admin":
      return prot ? "restricted" : "full";
    case "coach":
      // Huvudcoachen ser allt, även skyddade. Övriga coacher: alla ärenden i avtalet (beslut 2026-10-09), skyddade bara som ärende.
      return c.leadCoachId === actor.userId ? "full" : prot ? "restricted" : "full";
    case "handledare":
      // Rollen handledare – borttagen ur appen, Karims beslut 2026-10-09; vilande så att den kan slås på igen utan migration.
      // Ingen kan få rollen (src/api/roles.ts, DORMANT_ROLES). Regeln speglar RLS: alla ärenden i avtalet (beslut
      // 2026-10-09), skyddade bara som ärende.
      return prot ? "restricted" : "full";
    case "ekonom":
      return "billing";
    case "kommun_handlaggare": {
      // Handläggaren som beställde ser alltid sitt ärende (även skyddade – hon lämnade uppgifterna).
      if (c.referrerId && c.referrerId === actor.userId) return "customer";
      if (prot) return "none";
      const scope = l.customerScope ?? "own";
      if (scope === "all") return "customer";
      if (scope === "unit" && actor.customerUnit && l.referrerUnit === actor.customerUnit) return "customer";
      return "none";
    }
    default:
      return "none";
  }
}

/** Får rollen se anteckningar och bedömningar (avstämningar, kartläggning, månadsbedömningar, avvikelser)? */
export const canSeeNotes = (access: CaseAccess, role?: Role): boolean => (access === "full" || access === "team") && role !== "ekonom";

/** Ser rollen personens uppgifter (namn, personnummer, kontaktuppgifter)? */
export const canSeePerson = (access: CaseAccess): boolean => access === "full" || access === "team" || access === "customer";

/** Namn att visa: skyddade ärenden visar "Skyddade personuppgifter", ekonomen och den utan åtkomst ser aldrig namn. */
export function displayName(c: { id: string } | null | undefined, person: Pick<Person, "firstName" | "lastName"> | null | undefined, access: CaseAccess): string {
  if (!c || !person || access === "none") return "–";
  if (access === "restricted") return "Skyddade personuppgifter";
  if (access === "billing") return "–";
  return `${person.firstName} ${person.lastName}`;
}

// ---------------------------------------------------------------- Uppslag från data
/** Källa för uppslagen. Bygg den av ofiltrerad data (ctx.system) – bara flaggor och id:n lämnas ut, aldrig personuppgifter. */
export type AccessSource = {
  person(id: string): Pick<Person, "protectedIdentity"> | null | undefined;
  teamUserIds(caseId: string): readonly string[];
  profile(id: string): Pick<Profile, "customerUnit"> | null | undefined;
  contract(id: string): Pick<Contract, "config"> | null | undefined;
};

/** Uppslagen för ett ärende. */
export function lookupsFor(c: Pick<Case, "id" | "contractId" | "personId" | "referrerId" | "referrerUnit">, src: AccessSource): CaseAccessLookups {
  return {
    protectedIdentity: !!src.person(c.personId)?.protectedIdentity,
    teamUserIds: src.teamUserIds(c.id),
    referrerUnit: (c.referrerId ? src.profile(c.referrerId)?.customerUnit : null) ?? c.referrerUnit ?? null,
    customerScope: effectiveCustomerScope(src.contract(c.contractId)?.config),
  };
}

/** Index över data för många ärenden på en gång. */
export function accessIndex(db: Pick<Db, "persons" | "case_team" | "profiles" | "contracts">): AccessSource {
  const persons = new Map(db.persons.map((p) => [p.id, p]));
  const profiles = new Map(db.profiles.map((p) => [p.id, p]));
  const contracts = new Map(db.contracts.map((c) => [c.id, c]));
  const team = new Map<string, string[]>();
  for (const t of db.case_team) {
    const l = team.get(t.caseId);
    if (l) l.push(t.userId);
    else team.set(t.caseId, [t.userId]);
  }
  return {
    person: (id) => persons.get(id),
    teamUserIds: (caseId) => team.get(caseId) ?? [],
    profile: (id) => profiles.get(id),
    contract: (id) => contracts.get(id),
  };
}

type AccessCase = Pick<Case, "id" | "contractId" | "personId" | "referrerId" | "referrerUnit" | "leadCoachId">;
/** Åtkomst för ett ärende via en uppslagskälla. */
export const caseAccessIn = (c: AccessCase, actor: Actor, src: AccessSource): CaseAccess => caseAccess(c, actor, lookupsFor(c, src));

/** Ärenden som aktören har någon åtkomst till (prototypens sel.visibleCases). */
export function visibleCases<C extends AccessCase>(cases: readonly C[], actor: Actor, src: AccessSource): C[] {
  return cases.filter((c) => caseAccessIn(c, actor, src) !== "none");
}
