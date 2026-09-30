// Hanterare för området ledning (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
import { ok } from "@/api/contract";
import { handleCommand } from "@/api/server";
import { upsert } from "../_shared/context";
import { alertAck } from "./api";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

// ---------------------------------------------------------------- alert.ack
// Flaggorna kvitteras av dem som får dem: coach (egna ärenden), samordnare, avtalsansvarig och chef/controller.
handleCommand(alertAck, { roles: ["coach", "samordnare", "avtalsansvarig", "chef"] }, async (ctx, p) => {
  await upsert(ctx.repo.table("alert_acks"), { id: p.key, alertKey: p.key, acknowledgedBy: ctx.actor.userId, acknowledgedAt: ctx.now(), actionPlan: p.plan });
  await ctx.audit({ action: "alert.acknowledged", entity: "alert", entityId: p.key, contractId: ctx.actor.contractIds[0] ?? null, details: { plan: p.plan } });
  return ok({});
});
