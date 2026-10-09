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

/** Den som anropar API:t. I riktiga appen kommer den från inloggningen, i prototypen från rollväljaren. */
export type Actor = {
  /** profiles.id (MB och kommun) eller 'system' för bakgrundsjobb. Deltagare via pulslänk har ingen användare. */
  userId: string;
  role: Role;
  /** Avtal som användaren har medlemskap i (memberships). */
  contractIds: string[];
  /** Kommunens enhet (för behörighet "unit" i avtalskonfigurationen). */
  customerUnit?: string | null;
  /**
   * Bara testmiljön: den inloggade testarens egen profil (profiles.id) – även när testaren agerar som en testperson.
   * Sätts av servern när databasen säger mm.auth_is_tester() (testare OCH app_settings.environment = 'staging').
   * Saknas alltid i produktion, i minnesläget och i prototypen. Styr bara testarnas egna funktioner (synpunkter).
   */
  testerId?: string;
};
export const SYSTEM_ACTOR: Actor = { userId: "system", role: "admin", contractIds: [] };
