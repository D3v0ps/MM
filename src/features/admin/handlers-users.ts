// Hanterare: användare och roller (/admin/anvandare) – personal, kommunanvändare, inbjudan och spärr.
// Källa: prototyp/src/views/admin.js (admin.anvandare, admin.inviteCustomer, admin.setCustomerActive).
// Beslut 2026-10-08 (skarp drift): kollegorna är vanliga användare som administratören lägger till i appen (Lägg till
// kollega), ger en eller flera roller (memberships är unik per användare, avtal och roll) och spärrar eller aktiverar.
// Ingen SQL ska behövas för att ta in hela avdelningen. Revisionsloggen får staff_user.added, staff_user.roles_changed,
// staff_user.blocked och staff_user.reactivated – bara id:n, roller och domänen, aldrig namn eller adresser.
import { fail, ok } from "@/api/contract";
import { SUPPLIER_ROLES, type Role, type SupplierRole } from "@/api/roles";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { isOperational } from "@/core/config";
import { teamLabel } from "@/core/labels";
import { emailDomain, staffEmailDomainsOf } from "@/core/staff";
import { dayOf, diffDays } from "@/core/time";
import { uniq } from "@/core/util";
import { emailValid } from "@/core/validation";
import { SELF_REGISTERED } from "@/core/self-registration";
import type { Contract, Membership, Profile } from "@/data/schema";
import {
  adminInviteCustomer, adminInviteStaff, adminSetCustomerActive, adminSetStaffActive, adminSetStaffRoles, adminUsers, type CustomerUserRow, type MbUserRow, type UnitOption,
} from "./api";
import { mainContract, orgRow } from "./shared";
import { INVITE_TEXT, STAFF_INVITE_TEXT } from "./templates";

/** Rollernas namn i adminvyn (prototypens MM.ROLES). */
export const ROLE_NAME: Partial<Record<Role, string>> = {
  admin: "Systemadmin", avtalsansvarig: "Avtalsansvarig", samordnare: "Samordnare", coach: "Huvudcoach", handledare: "Handledare", chef: "Chef och controller", ekonom: "Ekonom",
};
const ROLE_ORDER: Role[] = ["admin", "avtalsansvarig", "samordnare", "coach", "handledare", "chef", "ekonom"];
const isSupplier = (r: string): r is SupplierRole => (SUPPLIER_ROLES as readonly string[]).includes(r);
/** Rollerna utan dubbletter, i adminvyns ordning. */
const sortRoles = (rs: readonly string[]): SupplierRole[] => uniq(rs.filter(isSupplier)).sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
const sameRoles = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const tidy = (s: string | null | undefined) => String(s ?? "").trim().replace(/\s+/g, " ");

handleQuery(adminUsers, { roles: ["admin", "avtalsansvarig"] }, async (ctx) => {
  const isAdmin = ctx.actor.role === "admin";
  const main = await mainContract(ctx);
  const [customer, supplier, memberships, refs] = await Promise.all([
    ctx.repo.table("organizations").get(main.customerId),
    ctx.repo.table("organizations").get(main.supplierId),
    ctx.repo.table("memberships").list(),
    ctx.repo.table("buyer_references").list({ customerId: main.customerId }),
  ]);
  const today = dayOf(ctx.now());
  const roleIn = (userId: string, contractId: string): Membership | undefined => memberships.find((m) => m.userId === userId && m.contractId === contractId);

  // Kommunens användare: inbjudna först, sedan i namnordning.
  const kProfiles = await ctx.repo.table("profiles").list({ organizationId: main.customerId });
  const customers: CustomerUserRow[] = kProfiles
    .filter((u) => !!roleIn(u.id, main.id))
    .map((u): CustomerUserRow => ({
      id: u.id, name: u.fullName, email: u.email, unit: u.customerUnit ?? "", lastLoginAt: u.lastLoginAt, invitedAt: u.invitedAt,
      selfRegistered: u.invitedBy === SELF_REGISTERED, active: u.active,
    }))
    .sort((a, b) => Number(!a.invitedAt) - Number(!b.invitedAt) || a.name.localeCompare(b.name, "sv"));

  // Personalen – bara för systemadmin. Rollerna gäller per avtal (memberships); en person kan ha flera.
  let mb: MbUserRow[] | null = null;
  const staff: Profile[] = await ctx.repo.table("profiles").list({ organizationId: main.supplierId });
  const rolesOf = (userId: string) => sortRoles(memberships.filter((m) => m.userId === userId && m.contractId === main.id).map((m) => m.role));
  const rows = staff
    .map((u) => ({ u, roles: rolesOf(u.id) }))
    .filter((x) => x.roles.length > 0)
    .sort((a, b) => ROLE_ORDER.indexOf(a.roles[0]) - ROLE_ORDER.indexOf(b.roles[0]) || a.u.fullName.localeCompare(b.u.fullName, "sv"));
  const mbActive = rows.filter((x) => x.u.active).length;
  if (isAdmin) {
    mb = rows.map(({ u, roles }) => ({
      id: u.id, name: u.fullName, email: u.email, title: u.title, roles, roleLabel: roles.map((r) => ROLE_NAME[r] ?? r).join(", "), isAdmin: roles.includes("admin"),
      teamRoleLabel: u.teamRole ? teamLabel(u.teamRole) : null, active: u.active, self: u.id === ctx.actor.userId,
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
    staffDomains: staffEmailDomainsOf(supplier, ctx.staffEmailDomains),
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

// ================================================================ Kollegorna (beslut 2026-10-08)
/** Kollegan i leverantörsorganisationen, eller null. */
async function colleague(ctx: Ctx, main: Contract, userId: string): Promise<Profile | null> {
  const u = await ctx.repo.table("profiles").get(userId);
  return u && u.organizationId === main.supplierId ? u : null;
}

/**
 * Lägg till kollega: namn, e-postadress på personalens domän (organisationens egna domäner, annars MM_STAFF_EMAIL_DOMAINS),
 * en eller flera roller i avtalet, titel valfri. Mejlet innehåller inga personuppgifter – bara adressen till appen (knappen
 * läggs till av utskicket). Kollegan loggar in med e-post och kod.
 */
handleCommand(adminInviteStaff, { roles: ["admin"] }, async (ctx, p) => {
  const main = await mainContract(ctx);
  const k = (p.contractId && (await ctx.repo.table("contracts").get(p.contractId))) || main;
  const supplier = await ctx.repo.table("organizations").get(k.supplierId);
  const name = tidy(p.name);
  if (!name) return fail("name", "Skriv kollegans namn.");
  const email = tidy(p.email).toLowerCase();
  if (!emailValid(email)) return fail("email", "E-postadressen ser inte ut att stämma. Kontrollera stavningen.");
  const domains = staffEmailDomainsOf(supplier, ctx.staffEmailDomains);
  if (!domains.includes(emailDomain(email))) return fail("domain", `Adressen måste sluta på @${domains.join(" eller @")}.`);
  const roles = sortRoles(p.roles);
  if (!roles.length) return fail("roles", "Välj minst en roll.");
  // ctx.system: e-postadressen måste vara unik bland alla konton (inloggningen) – bara ja/nej lämnas ut.
  if ((await ctx.system.table("profiles").list()).some((u) => String(u.email).toLowerCase() === email)) return fail("exists", "Det finns redan en användare med den adressen.");
  const id = ctx.newId("u");
  await ctx.repo.table("profiles").insert({
    id, organizationId: k.supplierId, fullName: name, email, phone: "", title: tidy(p.title), active: true, lastLoginAt: null,
    customerUnit: null, buyerReferenceId: null, teamRole: null, invitedAt: ctx.now(), invitedBy: ctx.actor.userId,
  });
  for (const role of roles) await ctx.repo.table("memberships").insert({ id: `${id}:${k.id}:${role}`, userId: id, contractId: k.id, role, customerUnit: null });
  await ctx.notify({ channel: "email", to: email, template: "inbjudan_personal", body: STAFF_INVITE_TEXT, caseId: null });
  await ctx.audit({ action: "staff_user.added", entity: "profile", entityId: id, contractId: k.id, details: { roles, domain: emailDomain(email) } });
  return ok({ userId: id });
});

/** Ändra roller: medlemskapen i huvudavtalet görs lika med listan (minst en roll). Den egna adminrollen kan inte tas bort. */
handleCommand(adminSetStaffRoles, { roles: ["admin"] }, async (ctx, p) => {
  const main = await mainContract(ctx);
  const u = await colleague(ctx, main, p.userId);
  if (!u) return fail("not_found", "Kollegan finns inte.");
  const roles = sortRoles(p.roles);
  if (!roles.length) return fail("roles", "Välj minst en roll.");
  if (u.id === ctx.actor.userId && !roles.includes("admin")) return fail("self", "Du kan inte ta bort din egen roll som systemadministratör.");
  const table = ctx.repo.table("memberships");
  const cur = await table.list({ userId: u.id, contractId: main.id });
  const before = sortRoles(cur.map((m) => m.role));
  if (sameRoles(before, roles)) return ok({ changed: false });
  for (const m of cur) if (!roles.includes(m.role as SupplierRole)) await table.remove(m.id);
  for (const role of roles) if (!cur.some((m) => m.role === role)) await table.insert({ id: `${u.id}:${main.id}:${role}`, userId: u.id, contractId: main.id, role, customerUnit: null });
  await ctx.audit({ action: "staff_user.roles_changed", entity: "profile", entityId: u.id, contractId: main.id, details: { from: before, to: roles } });
  return ok({ changed: true });
});

/** Spärra eller aktivera en kollega. En spärrad kollega kan inte logga in. Aldrig sig själv. */
handleCommand(adminSetStaffActive, { roles: ["admin"] }, async (ctx, p) => {
  const main = await mainContract(ctx);
  const u = await colleague(ctx, main, p.userId);
  if (!u) return fail("not_found", "Kollegan finns inte.");
  if (u.id === ctx.actor.userId) return fail("self", "Du kan inte spärra dig själv.");
  if (u.active !== p.active) await ctx.repo.table("profiles").update(u.id, { active: p.active });
  await ctx.audit({ action: p.active ? "staff_user.reactivated" : "staff_user.blocked", entity: "profile", entityId: u.id, contractId: main.id, details: {} });
  return ok({});
});
