// Hanterare för området notiser (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
import { ok } from "@/api/contract";
import { SUPPLIER_ROLES } from "@/api/roles";
import { handleCommand, handleQuery } from "@/api/server";
import { notifList, notifRead } from "./api";
import { orgRulesFor, personalNotifications } from "./model";

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

// ================================================================ Notiser (/notiser)

// ---------------------------------------------------------------- notiser.list
handleQuery(notifList, { roles: SUPPLIER_ROLES }, async (ctx) => {
  const { roles } = ctx.actor;
  const org = await orgRulesFor(ctx);
  const rule = org.notifications.progressionWatch;
  // Alla roller (Karims beslut 7, 2026-10-09): påminnelser och eskaleringar för var och en av rollerna – i rollens avtal
  // (personalNotifications).
  const isEscalationRole = roles.some((r) => (rule.escalateTo as readonly string[]).includes(r));
  const items = await personalNotifications(ctx, org);
  return {
    items: items.map((n) => ({
      id: n.id, kind: n.kind, title: n.title, body: n.body, emailBody: n.emailBody, channels: n.channels, createdAt: n.createdAt, readAt: n.readAt, caseId: n.caseId,
    })),
    isCoach: roles.includes("coach"),
    isEscalationRole,
    isAdmin: roles.includes("admin"),
    reminderSchedule: rule.reminderSchedule,
    escalateAfterWeeks: rule.escalateAfterConsecutiveWeeks,
  };
});
