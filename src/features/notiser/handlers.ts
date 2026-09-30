// Hanterare för området notiser (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
import { ok } from "@/api/contract";
import { SUPPLIER_ROLES } from "@/api/roles";
import { handleCommand } from "@/api/server";
import { notifRead } from "./api";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

// ---------------------------------------------------------------- notif.read (tyst)
handleCommand(notifRead, { roles: SUPPLIER_ROLES, silent: true }, async (ctx, p) => {
  const me = ctx.actor.userId;
  const reads = ctx.repo.table("notification_reads");
  const now = ctx.now();
  let marked = 0;
  for (const key of new Set(p.ids)) {
    const id = `${me}:${key}`;
    if (await reads.get(id)) continue;
    await reads.insert({ id, userId: me, notificationKey: key, readAt: now });
    marked++;
  }
  return ok({ marked });
});
