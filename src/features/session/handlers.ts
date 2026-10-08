// Hanterare: session och diagnos.
import { fail, ok } from "@/api/contract";
import { CUSTOMER_ROLES, SUPPLIER_ROLES, type Role } from "@/api/roles";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { auditView, sessionPing, switchRole, VIEW_EVENTS, type ViewEvent } from "./api";
import "./nav-handlers";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

// ---------------------------------------------------------------- audit.view (tyst)
/** Roller som får logga exporter (samma som skärmarna: revisionsloggen och avtalsavvikelserna). */
const EXPORT_ROLES: Partial<Record<ViewEvent, readonly Role[]>> = {
  "export.audit_log": ["admin", "chef"],
  "export.contract_deviations": ["samordnare", "avtalsansvarig", "chef", "admin"],
};
/** Detaljer som får följa med per händelse (exporter). Allt annat tas bort. */
const DETAIL_KEYS: Partial<Record<ViewEvent, readonly string[]>> = {
  "export.audit_log": ["rows", "filter"],
  "export.contract_deviations": ["month"],
};
const DENIED = () => fail("forbidden", "Visningen kunde inte loggas.");

/**
 * Avtalet för loggraden, eller null om aktören inte får logga händelsen för objektet: visningar bara av objekt som
 * aktören får läsa (ctx.repo), "case.view_denied" bara för ärenden i aktörens avtal, exporter bara för skärmens roller.
 */
async function contractFor(ctx: Ctx, action: ViewEvent, entityId: string | null): Promise<{ contractId: string | null } | null> {
  const a = ctx.actor;
  const member = (contractId: string | null | undefined) => !!contractId && (a.role === "admin" || a.contractIds.includes(contractId));
  const fallback = { contractId: a.contractIds[0] ?? null };
  switch (action) {
    case "case.view": {
      const c = entityId ? await ctx.repo.table("cases").get(entityId) : null;
      return c ? { contractId: c.contractId } : null;
    }
    case "case.view_denied": {
      // ctx.system: bara ärendets avtal slås upp (användaren får inte läsa ärendet) – inget lämnas ut till anroparen.
      const c = entityId ? await ctx.system.table("cases").get(entityId) : null;
      return c && member(c.contractId) ? { contractId: c.contractId } : null;
    }
    case "report.view": {
      const r = entityId ? await ctx.repo.table("reports").get(entityId) : null;
      return r ? { contractId: r.contractId } : null;
    }
    case "transcript.view": {
      if (!entityId) return fallback; // ny avstämning utan id
      const ci = await ctx.repo.table("check_ins").get(entityId);
      if (!ci) return null;
      const c = await ctx.repo.table("cases").get(ci.caseId);
      return { contractId: c?.contractId ?? fallback.contractId };
    }
    case "export.audit_log":
    case "export.contract_deviations": {
      if (!EXPORT_ROLES[action]?.includes(a.role)) return null;
      if (entityId && action === "export.audit_log") return member(entityId) ? { contractId: entityId } : null;
      return fallback;
    }
  }
}

handleCommand(auditView, { roles: [...SUPPLIER_ROLES, ...CUSTOMER_ROLES], silent: true }, async (ctx, p) => {
  if (p.entity !== VIEW_EVENTS[p.action]) return DENIED();
  const target = await contractFor(ctx, p.action, p.entityId);
  if (!target) return DENIED();
  const allowed = DETAIL_KEYS[p.action] ?? [];
  const details = Object.fromEntries(Object.entries(p.details ?? {}).filter(([k, v]) => allowed.includes(k) && v !== undefined));
  await ctx.audit({ action: p.action, entity: p.entity, entityId: p.entityId, contractId: target.contractId, details });
  return ok({});
});

handleQuery(sessionPing, {}, (ctx) => ({ now: ctx.now(), role: ctx.actor.role, userId: ctx.actor.userId }));

// ---------------------------------------------------------------- Rollväxling (beslut 2026-10-08)
// Bara MB-personal och kommunens användare (deltagaren har inga medlemskap). Rollen måste finnas bland de egna medlemskapen –
// policyn (RLS role_choices_insert/update) stoppar annars. Raden skrivs i eget namn via ctx.repo; id = userId (0027).
handleCommand(switchRole, { roles: [...SUPPLIER_ROLES, ...CUSTOMER_ROLES] }, async (ctx, p) => {
  const me = ctx.actor.userId;
  const mine = await ctx.repo.table("memberships").list({ userId: me, role: p.role });
  if (!mine.length) return fail("no_membership", "Du har inte den rollen.");
  const table = ctx.repo.table("role_choices");
  const cur = await table.get(me);
  if (cur?.role === p.role && ctx.actor.role === p.role) return fail("unchanged", "Du har redan den rollen.");
  if (cur) await table.update(me, { role: p.role, chosenAt: ctx.now() });
  else await table.insert({ id: me, userId: me, role: p.role, chosenAt: ctx.now() });
  await ctx.audit({ action: "role.switched", entity: "profile", entityId: me, contractId: mine[0].contractId, details: { role: p.role } });
  return ok({ role: p.role });
});
