// Hanterare: session och diagnos.
import { ok } from "@/api/contract";
import { CUSTOMER_ROLES, SUPPLIER_ROLES } from "@/api/roles";
import { handleCommand, handleQuery } from "@/api/server";
import { auditView, sessionPing } from "./api";
import "./nav-handlers";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

// ---------------------------------------------------------------- audit.view (tyst)
handleCommand(auditView, { roles: [...SUPPLIER_ROLES, ...CUSTOMER_ROLES], silent: true }, async (ctx, p) => {
  // Avtalet för loggraden: ärendets avtal när visningen gäller ett ärende. ctx.system: bara avtalets id slås upp
  // (även för "case.view_denied", där användaren inte får läsa ärendet) – inget lämnas ut till anroparen.
  const caseId = p.entity === "case" ? p.entityId : typeof p.details?.caseId === "string" ? p.details.caseId : null;
  const c = caseId ? await ctx.system.table("cases").get(caseId) : null;
  await ctx.audit({ action: p.action || "view", entity: p.entity, entityId: p.entityId, contractId: c?.contractId ?? ctx.actor.contractIds[0] ?? null, details: p.details ?? {} });
  return ok({});
});

handleQuery(sessionPing, {}, (ctx) => ({ now: ctx.now(), role: ctx.actor.role, userId: ctx.actor.userId }));
