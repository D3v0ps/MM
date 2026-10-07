// Hanterare: användare och roller (/admin/anvandare) – personal, kommunanvändare, inbjudan och spärr.
// Källa: prototyp/src/views/admin.js (admin.anvandare, admin.inviteCustomer, admin.setCustomerActive).
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand, handleQuery } from "@/api/server";
import { isOperational } from "@/core/config";
import { teamLabel } from "@/core/labels";
import { dayOf, diffDays } from "@/core/time";
import { uniq } from "@/core/util";
import { emailValid } from "@/core/validation";
import { SELF_REGISTERED } from "@/core/self-registration";
import type { Membership, Profile } from "@/data/schema";
import { adminInviteCustomer, adminSetCustomerActive, adminUsers, type CustomerUserRow, type MbUserRow, type UnitOption } from "./api";
import { mainContract, orgRow } from "./shared";
import { INVITE_TEXT } from "./templates";

/** Rollernas namn i adminvyn (prototypens MM.ROLES). */
export const ROLE_NAME: Partial<Record<Role, string>> = {
  admin: "Systemadmin", avtalsansvarig: "Avtalsansvarig", samordnare: "Samordnare", coach: "Huvudcoach", handledare: "Handledare", chef: "Chef och controller", ekonom: "Ekonom",
};
const ROLE_ORDER: Role[] = ["admin", "avtalsansvarig", "samordnare", "coach", "handledare", "chef", "ekonom"];

handleQuery(adminUsers, { roles: ["admin", "avtalsansvarig"] }, async (ctx) => {
  const isAdmin = ctx.actor.role === "admin";
  const main = await mainContract(ctx);
  const [customer, memberships, refs] = await Promise.all([
    ctx.repo.table("organizations").get(main.customerId),
    ctx.repo.table("memberships").list(),
    ctx.repo.table("buyer_references").list({ customerId: main.customerId }),
  ]);
  const today = dayOf(ctx.now());
  const roleIn = (userId: string, contractId: string): Membership | undefined => memberships.find((m) => m.userId === userId && m.contractId === contractId);

  // Kommunens användare: inbjudna först, sedan i namnordning.
  const kProfiles = await ctx.repo.table("profiles").list({ organizationId: main.customerId });
  const customers: CustomerUserRow[] = kProfiles
    .map((u): CustomerUserRow => ({
      id: u.id, name: u.fullName, email: u.email, unit: u.customerUnit ?? "", lastLoginAt: u.lastLoginAt, invitedAt: u.invitedAt,
      selfRegistered: u.invitedBy === SELF_REGISTERED, active: u.active,
    }))
    .sort((a, b) => Number(!a.invitedAt) - Number(!b.invitedAt) || a.name.localeCompare(b.name, "sv"));

  // Personalen – bara för systemadmin. Rollen gäller per avtal (memberships).
  let mb: MbUserRow[] | null = null;
  let mbActive = 0;
  const staff: Profile[] = await ctx.repo.table("profiles").list({ organizationId: main.supplierId });
  const rows = staff
    .map((u) => ({ u, role: roleIn(u.id, main.id)?.role ?? null }))
    .filter((x) => x.role !== null)
    .sort((a, b) => ROLE_ORDER.indexOf(a.role as Role) - ROLE_ORDER.indexOf(b.role as Role) || a.u.fullName.localeCompare(b.u.fullName, "sv"));
  mbActive = rows.filter((x) => x.u.active).length;
  if (isAdmin) {
    mb = rows.map(({ u, role }) => ({
      id: u.id, name: u.fullName, email: u.email, title: u.title, roleLabel: ROLE_NAME[role as Role] ?? String(role), isAdmin: role === "admin",
      teamRoleLabel: u.teamRole ? teamLabel(u.teamRole) : null, active: u.active,
    }));
  }

  const units: UnitOption[] = uniq([...refs.filter((b) => b.active).map((b) => b.unit), ...customers.map((u) => u.unit)])
    .filter(Boolean)
    .map((unit) => ({ unit, buyerReference: refs.find((b) => b.unit === unit && b.active)?.reference ?? null }));
  const { settings } = await orgRow(ctx, main.supplierId);
  return {
    isAdmin,
    contractId: main.id,
    customerName: customer?.name ?? "",
    domains: customer?.emailDomains ?? [],
    // Självregistreringen: avtalets domäner som också är beställarens (samma dubbla nyckel som inloggningen).
    selfRegistrationDomains: isOperational(main.config)
      ? (main.config.selfRegistration?.emailDomains ?? []).filter((x) => (customer?.emailDomains ?? []).map((y) => y.toLowerCase()).includes(x))
      : [],
    mb,
    customers,
    units,
    kpis: {
      mbActive,
      customerActive: customers.filter((u) => u.active).length,
      unitCount: uniq(customers.map((u) => u.unit)).length,
      loggedIn30: customers.filter((u) => u.lastLoginAt && diffDays(u.lastLoginAt, today) <= 30).length,
      invited: customers.filter((u) => u.invitedAt && !u.lastLoginAt && u.active).length,
    },
    escalateTo: [...settings.notifications.progressionWatch.escalateTo],
  };
});

/**
 * Bjud in kommunens handläggare. Bara tillåtna e-postdomäner för avtalet. Den som har en adress på avtalets kommundomän kan
 * också skapa ett konto själv (självregistrering, src/features/session/self-register.ts).
 */
handleCommand(adminInviteCustomer, { roles: ["admin", "avtalsansvarig"] }, async (ctx, p) => {
  const main = await mainContract(ctx);
  const k = (p.contractId && (await ctx.repo.table("contracts").get(p.contractId))) || main;
  const customer = await ctx.repo.table("organizations").get(k.customerId);
  const email = String(p.email || "").trim().toLowerCase();
  const name = String(p.name || "").trim();
  if (!name) return fail("name", "Skriv personens namn.");
  if (!emailValid(email)) return fail("email", "E-postadressen ser inte ut att stämma. Kontrollera stavningen.");
  const domain = email.split("@")[1];
  const domains = customer?.emailDomains ?? [];
  if (!domains.includes(domain)) return fail("domain", "Adressen har inte en tillåten domän.");
  // ctx.system: e-postadressen måste vara unik bland alla konton (inloggningen) – bara ja/nej lämnas ut.
  if ((await ctx.system.table("profiles").list()).some((u) => String(u.email).toLowerCase() === email)) return fail("exists", "Det finns redan en användare med den adressen.");
  const unit = String(p.unit || "").trim().replace(/\s+/g, " ");
  if (!unit) return fail("unit", "Skriv vilken enhet personen arbetar på.");
  const br = await ctx.repo.table("buyer_references").first({ customerId: k.customerId, unit, active: true });
  const id = ctx.newId("k");
  await ctx.repo.table("profiles").insert({
    id, organizationId: k.customerId, fullName: name, email, phone: "", title: "Handläggare", active: true, lastLoginAt: null,
    customerUnit: unit, buyerReferenceId: br?.id ?? null, teamRole: null, invitedAt: ctx.now(), invitedBy: ctx.actor.userId,
  });
  await ctx.repo.table("memberships").insert({ id: `${id}:${k.id}`, userId: id, contractId: k.id, role: "kommun_handlaggare", customerUnit: unit });
  // Inbjudan innehåller inga personuppgifter – bara adressen till portalen (CLAUDE.md punkt 9).
  await ctx.notify({ channel: "email", to: email, template: "inbjudan_kommun", body: INVITE_TEXT, caseId: null });
  await ctx.audit({ action: "customer_user.invited", entity: "profile", entityId: id, contractId: k.id, details: { role: "kommun_handlaggare", domain } });
  return ok({ userId: id });
});

handleCommand(adminSetCustomerActive, { roles: ["admin", "avtalsansvarig"] }, async (ctx, p) => {
  const main = await mainContract(ctx);
  const u = await ctx.repo.table("profiles").get(p.userId);
  if (!u || u.organizationId !== main.customerId) return fail("not_found", "Användaren finns inte.");
  await ctx.repo.table("profiles").update(u.id, { active: p.active });
  await ctx.audit({ action: p.active ? "customer_user.reactivated" : "customer_user.blocked", entity: "profile", entityId: u.id, contractId: main.id, details: {} });
  return ok({});
});
