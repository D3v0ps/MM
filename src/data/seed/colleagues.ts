// Kollegorna på Miljonbemanning som har konton i Miljonmatch (beslut 2026-10-08, skarp drift): samma id:n som i databasen.
// Utan node-beroenden – används av det tomma testdatat (empty.ts, MM_SEED=empty) och av testmiljöns seed
// (src/data/supabase/seed-rows.ts). Fler kollegor läggs till i appen (Användare och roller → Lägg till kollega), inte här.
import type { Membership, Profile } from "../schema";

export const COLLEAGUE_ORG = "org-mb";
export const COLLEAGUE_CONTRACT = "c-bot";
/** Titeln alla sju har från start – rollerna ändras i appen. */
export const COLLEAGUE_TITLE = "Systemadministratör";

export const COLLEAGUES: readonly { id: string; fullName: string; email: string }[] = [
  { id: "tester-karim", fullName: "Karim Khalil", email: "karim.khalil@miljonbemanning.se" },
  { id: "tester-ali", fullName: "Ali Khalil", email: "ali.khalil@miljonbemanning.se" },
  { id: "tester-sara", fullName: "Sara Salah", email: "sara.salah@miljonbemanning.se" },
  { id: "tester-adam", fullName: "Adam Abdalla", email: "adam.abdalla@miljonbemanning.se" },
  { id: "tester-shafik", fullName: "Shafik Muwanga", email: "shafik.muwanga@miljonbemanning.se" },
  { id: "tester-moda", fullName: "Moda Habib", email: "moda.habib@miljonbemanning.se" },
  { id: "tester-yacine", fullName: "Yacine Laghmari", email: "yacine.laghmari@miljonbemanning.se" },
];
/** Avtalsansvarig för Botkyrkaavtalet (contracts.contract_manager_id, beslut 2026-10-08). */
export const CONTRACT_MANAGER_ID = "tester-ali";

export function colleagueProfiles(): Profile[] {
  return COLLEAGUES.map((t) => ({
    id: t.id, organizationId: COLLEAGUE_ORG, fullName: t.fullName, email: t.email, phone: "", title: COLLEAGUE_TITLE, active: true,
    lastLoginAt: null, customerUnit: null, buyerReferenceId: null, teamRole: null, invitedAt: null, invitedBy: null,
  }));
}

/** Alla sju är systemadministratörer i Botkyrkaavtalet; Ali är dessutom avtalsansvarig (samma rader som scratchpad/skarp-drift.sql). */
export function colleagueMemberships(): Membership[] {
  const rows: Membership[] = COLLEAGUES.map((t) => ({ id: `${t.id}:${COLLEAGUE_CONTRACT}`, userId: t.id, contractId: COLLEAGUE_CONTRACT, role: "admin" as const, customerUnit: null }));
  rows.push({ id: `${CONTRACT_MANAGER_ID}:${COLLEAGUE_CONTRACT}:avtalsansvarig`, userId: CONTRACT_MANAGER_ID, contractId: COLLEAGUE_CONTRACT, role: "avtalsansvarig", customerUnit: null });
  return rows;
}
