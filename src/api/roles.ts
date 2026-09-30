// Roller enligt SPEC §4. Nyckeln används i kod, etiketten visas.
export const SUPPLIER_ROLES = ["admin", "avtalsansvarig", "samordnare", "coach", "handledare", "chef", "ekonom"] as const;
export const CUSTOMER_ROLES = ["kommun_handlaggare", "kommun_chef"] as const;
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
  kommun_chef: "Kommunens chef",
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
};
export const SYSTEM_ACTOR: Actor = { userId: "system", role: "admin", contractIds: [] };
