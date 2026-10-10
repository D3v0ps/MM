// Roller enligt SPEC §4. Nyckeln används i kod, etiketten visas.
export const SUPPLIER_ROLES = ["admin", "avtalsansvarig", "samordnare", "coach", "handledare", "chef", "ekonom"] as const;
/**
 * Rollen handledare – borttagen ur appen, Karims beslut 2026-10-09; vilande så att den kan slås på igen utan migration.
 * Rollen finns inte i verkligheten (två jobbcoacher = rollen coach). Den ligger kvar i typen, i databasens rollista och i
 * RLS-reglerna (och i src/core/access.ts och src/data/policy.ts), men ingen kan få den eller se den: Lägg till kollega och
 * Ändra roller tar bara emot STAFF_ROLES, och menyn, rutterna, testpersonerna och teamvalen har den inte.
 */
export const DORMANT_ROLES = ["handledare"] as const;
export type DormantRole = (typeof DORMANT_ROLES)[number];
export const isDormantRole = (role: string): role is DormantRole => (DORMANT_ROLES as readonly string[]).includes(role);
/** Rollerna en kollega kan få i appen (Lägg till kollega, Ändra roller) – Miljonbemannings roller utom de vilande. */
export const STAFF_ROLES = ["admin", "avtalsansvarig", "samordnare", "coach", "chef", "ekonom"] as const satisfies readonly Exclude<(typeof SUPPLIER_ROLES)[number], DormantRole>[];
export type StaffRole = (typeof STAFF_ROLES)[number];
/**
 * Kommunens roller. Beslut 2026-10-07 (synpunkt #14): kommunen har bara rollen handläggare – rollen kommunens chef är
 * borttagen. Alla med en adress på avtalets kommundomän kan skapa ett konto själva (contracts.config.selfRegistration).
 */
export const CUSTOMER_ROLES = ["kommun_handlaggare"] as const;
export const PARTICIPANT_ROLES = ["deltagare"] as const;
export const ROLES = [...SUPPLIER_ROLES, ...CUSTOMER_ROLES, ...PARTICIPANT_ROLES] as const;
export type SupplierRole = (typeof SUPPLIER_ROLES)[number];
export type CustomerRole = (typeof CUSTOMER_ROLES)[number];
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Systemadministratör",
  avtalsansvarig: "Avtalsansvarig",
  samordnare: "Operativ samordnare",
  coach: "Huvudcoach",
  handledare: "Handledare",
  chef: "Chef/controller",
  ekonom: "Ekonom",
  kommun_handlaggare: "Kommunens handläggare",
  deltagare: "Deltagare",
};

export type Perspective = "leverantor" | "kund" | "deltagare";
export const perspectiveOf = (role: Role): Perspective =>
  (CUSTOMER_ROLES as readonly string[]).includes(role) ? "kund" : role === "deltagare" ? "deltagare" : "leverantor";
export const isSupplierRole = (role: Role): role is SupplierRole => (SUPPLIER_ROLES as readonly string[]).includes(role);
export const isCustomerRole = (role: Role): role is CustomerRole => (CUSTOMER_ROLES as readonly string[]).includes(role);

/**
 * Den som anropar API:t. I riktiga appen kommer den från inloggningen, i prototypen från testpersonen.
 * Alla roller samtidigt (Karims beslut 7, coachmötet 2026-10-09): den som har flera roller har alla sina behörigheter på en
 * gång, utan rollbyte. Behörigheten är summan av rollerna – en regel som är skriven för en roll prövas för varje roll och
 * unionen tas (roleActors, src/data/policy.ts, mm.current_roles() i 0034). Belopp i kronor syns bara för den som har rollen
 * ekonom (hidesMoney i src/api/tester-access.ts).
 */
export type Actor = {
  /** profiles.id (MB och kommun) eller 'system' för bakgrundsjobb. Deltagare via pulslänk har ingen användare. */
  userId: string;
  /** Alla roller (medlemskapen), i rollernas ordning (ROLES). Minst en. */
  roles: Role[];
  /** Avtal där användaren har någon roll (memberships) – unionen. */
  contractIds: string[];
  /**
   * Avtalen per roll, när de skiljer sig mellan rollerna (en roll ger bara rätt i avtal där personen har just den rollen).
   * Saknas en roll här gäller den i alla contractIds. Sätts av actorFor och servern (current_actor().roleContracts).
   */
  roleContracts?: Partial<Record<Role, string[]>>;
  /** Kommunens enhet (för behörighet "unit" i avtalskonfigurationen) – från kommunens medlemskap. */
  customerUnit?: string | null;
  /**
   * Bara testmiljön: den inloggade testarens egen profil (profiles.id) – även när testaren agerar som en testperson.
   * Sätts av servern när databasen säger mm.auth_is_tester() (testare OCH app_settings.environment = 'staging').
   * Saknas alltid i produktion, i minnesläget och i prototypen. Styr bara testarnas egna funktioner (synpunkter).
   */
  testerId?: string;
};
export const SYSTEM_ACTOR: Actor = { userId: "system", roles: ["admin"], contractIds: [] };

/**
 * Aktören i EN roll – för regler som är skrivna per roll (src/data/policy.ts, caseAccessAs i src/core/access.ts). Bygg den
 * bara med roleActors/asRole: avtalen är rollens egna.
 */
export type RoleActor = {
  userId: string;
  role: Role;
  contractIds: string[];
  customerUnit?: string | null;
  testerId?: string;
};

/** Rollerna utan dubbletter, i rollernas ordning (ROLES). */
export const sortRoles = <R extends Role>(roles: readonly R[]): R[] => (ROLES as readonly Role[]).filter((r) => roles.includes(r as R)) as R[];
/** Har aktören rollen? */
export const hasRole = (a: Pick<Actor, "roles"> | null | undefined, role: Role): boolean => !!a && a.roles.includes(role);
/** Har aktören någon av rollerna? */
export const hasAnyRole = (a: Pick<Actor, "roles"> | null | undefined, roles: readonly Role[]): boolean => !!a && a.roles.some((r) => roles.includes(r));
/** Har aktören bara roller bland de angivna (och minst en)? Används för spärrar som en annan roll lyfter (t.ex. bara ekonom). */
export const onlyRoles = (a: Pick<Actor, "roles"> | null | undefined, roles: readonly Role[]): boolean => !!a && a.roles.length > 0 && a.roles.every((r) => roles.includes(r));
/** Avtalen där aktören har rollen. */
export const contractsFor = (a: Pick<Actor, "contractIds" | "roleContracts">, role: Role): string[] => a.roleContracts?.[role] ?? a.contractIds;
/** Aktören i en av sina roller (null om aktören inte har rollen). */
export function asRole(a: Actor, role: Role): RoleActor | null {
  if (!a.roles.includes(role)) return null;
  return {
    userId: a.userId, role, contractIds: contractsFor(a, role), customerUnit: a.customerUnit ?? null,
    ...(a.testerId !== undefined ? { testerId: a.testerId } : {}),
  };
}
/** Aktören i var och en av sina roller – en regel per roll, unionen tas av den som frågar. */
export const roleActors = (a: Actor): RoleActor[] => a.roles.map((r) => asRole(a, r)).filter((x): x is RoleActor => x !== null);
/** Någon av Miljonbemannings roller (MB-ytan med sidopanel). */
export const isStaffActor = (a: Pick<Actor, "roles">): boolean => a.roles.some((r) => isSupplierRole(r));
/** Kommunens portal: bara kommunens roller. */
export const isCustomerActor = (a: Pick<Actor, "roles">): boolean => a.roles.length > 0 && !isStaffActor(a) && a.roles.some((r) => isCustomerRole(r));
/** Deltagaren (pulslänk utan inloggning). */
export const isParticipantActor = (a: Pick<Actor, "roles">): boolean => a.roles.length > 0 && a.roles.every((r) => r === "deltagare");
/** Rollernas namn för visning ("Huvudcoach och Ekonom"). */
export const rolesLabel = (roles: readonly Role[]): string => {
  const names = sortRoles(roles).map((r) => ROLE_LABEL[r]);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} och ${names[names.length - 1]}`;
};
