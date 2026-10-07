// Självregistrering i kommunens portal (beslut 2026-10-07, synpunkt #2) – samma funktion i alla körlägen:
//   supabase-läget  servern efter lyckad kod (src/server/auth/service.ts) med service role
//   minnesläget     POST /api/dev-session { email } (src/app/api/dev-session/route.ts) via memoryRuntime().selfRegister
//   prototypen      inloggningen i src/demo/main.tsx via demo.rt.selfRegister
// Systemsteg: profilen och medlemskapet skrivs med system (service role) – samma slags steg som kopplingen auth_user_id vid
// inloggningen. Domänen läses ur avtalets konfiguration (selfRegistration.emailDomains) och måste också finnas bland
// beställarens tillåtna domäner (selfRegistrationContracts). En befintlig profil – också en spärrad – registreras aldrig om.
// Revisionsloggen (profile.self_registered) skriver anroparen. Inga e-postadresser i loggen – bara id:n och domänen.
// Ingen server-only: importeras av servern, minnesläget och prototypen.
import { emailDomainOf, nameFromEmail, SELF_REGISTERED, selfRegistrationContracts } from "@/core/self-registration";
import type { LocalDateTime } from "@/core/time";
import type { AppRepo, Membership, Profile } from "@/data/schema";

export type SelfRegisterResult =
  | { ok: true; profileId: string; contractIds: string[]; domain: string }
  | { ok: false; reason: "exists" | "not_allowed" };

/** Titeln på ett konto som handläggaren skapade själv (rollens namn). */
export const SELF_REGISTERED_TITLE = "Handläggare";

/** Avtalen där adressen får skapa ett konto (läser avtal och beställare med system). Tom lista = ingen självregistrering. */
export async function selfRegistrationTargets(system: AppRepo, email: string): Promise<string[]> {
  const [contracts, organizations] = await Promise.all([system.table("contracts").list({ status: "active" }), system.table("organizations").list({ kind: "customer" })]);
  return selfRegistrationContracts(email, contracts, organizations);
}

/**
 * Skapa profil och medlemskap (kommunens handläggare) för en adress på avtalets kommundomän. Enheten är tom tills
 * handläggaren fyller i den (Mina uppgifter eller första beställningen), namnet preliminärt ur adressen.
 */
export async function selfRegister(system: AppRepo, o: { email: string; now: LocalDateTime; newId: (prefix: string) => string }): Promise<SelfRegisterResult> {
  const email = o.email.trim().toLowerCase();
  if (await system.table("profiles").first({ email })) return { ok: false, reason: "exists" };
  const ids = await selfRegistrationTargets(system, email);
  if (!ids.length) return { ok: false, reason: "not_allowed" };
  const contracts = await system.table("contracts").list({ id: { in: ids } });
  const first = contracts.find((c) => c.id === ids[0]);
  if (!first) return { ok: false, reason: "not_allowed" };
  // En profil hör till en organisation: bara avtalen med samma beställare.
  const contractIds = ids.filter((id) => contracts.find((c) => c.id === id)?.customerId === first.customerId);
  const id = o.newId("k");
  const profile: Profile = {
    id, organizationId: first.customerId, fullName: nameFromEmail(email) || "Ny handläggare", email, phone: "", title: SELF_REGISTERED_TITLE, active: true,
    lastLoginAt: null, customerUnit: null, buyerReferenceId: null, teamRole: null, invitedAt: o.now, invitedBy: SELF_REGISTERED,
  };
  await system.table("profiles").insert(profile);
  for (const contractId of contractIds) {
    const m: Membership = { id: `${id}:${contractId}`, userId: id, contractId, role: "kommun_handlaggare", customerUnit: null };
    await system.table("memberships").insert(m);
  }
  return { ok: true, profileId: id, contractIds, domain: emailDomainOf(email) };
}

/** Revisionsloggens rad för självregistreringen (anroparen skriver den med sin audit-funktion). */
export const selfRegisteredAudit = (r: Extract<SelfRegisterResult, { ok: true }>) => ({
  action: "profile.self_registered", entity: "profile", entityId: r.profileId, contractId: r.contractIds[0] ?? null,
  details: { contractIds: r.contractIds, domain: r.domain },
});
