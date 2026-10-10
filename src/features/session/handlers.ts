// Hanterare: session och diagnos.
import { fail, ok } from "@/api/contract";
import { CUSTOMER_ROLES, hasAnyRole, SUPPLIER_ROLES, type Role } from "@/api/roles";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { auditView, sessionPing, VIEW_EVENTS, type ViewEvent } from "./api";
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
  const member = (contractId: string | null | undefined) => !!contractId && (a.roles.includes("admin") || a.contractIds.includes(contractId));
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
    case "group_activity.view": {
      const g = entityId ? await ctx.repo.table("group_activities").get(entityId) : null;
      return g ? { contractId: g.contractId } : null;
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
      if (!hasAnyRole(a, EXPORT_ROLES[action] ?? [])) return null;
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
  const details: Record<string, unknown> = Object.fromEntries(Object.entries(p.details ?? {}).filter(([k, v]) => allowed.includes(k) && v !== undefined));
  // Aktivitetsvyn: vilka deltagares namn, närvaro och anteckningar som visades – ärendena slås upp här (det aktören får läsa),
  // aldrig ur anropet. caseIds gör att visningen syns i deltagarkortets Historik för den som ser andras visningar.
  if (p.action === "group_activity.view" && p.entityId) {
    details.caseIds = [...new Set((await ctx.repo.table("activities").pick(["caseId"], { groupActivityId: p.entityId })).map((a) => a.caseId))].sort();
  }
  await ctx.audit({ action: p.action, entity: p.entity, entityId: p.entityId, contractId: target.contractId, details });
  return ok({});
});

handleQuery(sessionPing, {}, (ctx) => ({ now: ctx.now(), roles: ctx.actor.roles, userId: ctx.actor.userId }));
