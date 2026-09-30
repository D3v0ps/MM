// Hanterare för området notiser (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
import { ok } from "@/api/contract";
import { SUPPLIER_ROLES } from "@/api/roles";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { DEFAULT_ORG_SETTINGS, type OrgSettings } from "@/core/config";
import { notificationsFor, type NotificationDb } from "@/core/progression";
import { orgSettingsFor } from "../_shared/context";
import { notifList, notifRead } from "./api";

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

/** Miljonbemannings interna regler (org_settings) för leverantören i användarens första avtal. */
async function orgRulesFor(ctx: Ctx): Promise<OrgSettings> {
  for (const id of ctx.actor.contractIds) {
    const c = await ctx.repo.table("contracts").get(id);
    if (c) return orgSettingsFor(ctx, c);
  }
  return DEFAULT_ORG_SETTINGS;
}

// ---------------------------------------------------------------- notiser.list
handleQuery(notifList, { roles: SUPPLIER_ROLES }, async (ctx) => {
  const { userId, role } = ctx.actor;
  const org = await orgRulesFor(ctx);
  const rule = org.notifications.progressionWatch;
  const isEscalationRole = (rule.escalateTo as readonly string[]).includes(role);
  const getsReminders = role === "coach" || role === "handledare";

  // Sparade notiser och läsmarkeringar: bara den inloggades egna (policyn/RLS: mottagaren läser sina rader).
  const user_notifications = await ctx.repo.table("user_notifications").list({ recipientId: userId });
  const notification_reads = await ctx.repo.table("notification_reads").list({ userId });

  // ctx.system: påminnelser och eskaleringar räknas fram ur ärendena och avstämningarna i användarens avtal – i den riktiga
  // tjänsten gör ett schemalagt jobb detta och sparar notisen till mottagaren. Eskaleringar ska omfatta alla ärenden (även
  // skyddade, som chefen bara ser som ärendenummer). Ut lämnas bara den inloggades egna notiser: ärendenummer, coachens namn
  // och veckans orsak – aldrig deltagarens namn eller personuppgifter.
  let cases: NotificationDb["cases"] = [];
  let check_ins: NotificationDb["check_ins"] = [];
  let profiles: NotificationDb["profiles"] = [];
  if ((getsReminders || isEscalationRole) && ctx.actor.contractIds.length) {
    cases = await ctx.system.table("cases").list({ contractId: { in: ctx.actor.contractIds }, status: "active" });
    const ids = cases.map((c) => c.id);
    check_ins = ids.length ? await ctx.system.table("check_ins").list({ caseId: { in: ids } }) : [];
    if (isEscalationRole) profiles = await ctx.system.table("profiles").list({ id: { in: [...new Set(cases.map((c) => c.leadCoachId).filter((x): x is string => !!x))] } });
  }
  const items = notificationsFor({ cases, check_ins, user_notifications, notification_reads, profiles }, userId, role, { now: ctx.now(), org });
  return {
    items: items.map((n) => ({
      id: n.id, kind: n.kind, title: n.title, body: n.body, emailBody: n.emailBody, channels: n.channels, createdAt: n.createdAt, readAt: n.readAt, caseId: n.caseId,
    })),
    isCoach: role === "coach",
    isEscalationRole,
    isAdmin: role === "admin",
    reminderSchedule: rule.reminderSchedule,
    escalateAfterWeeks: rule.escalateAfterConsecutiveWeeks,
  };
});
