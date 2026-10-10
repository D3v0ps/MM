// Personliga notiser för den inloggade – delas av notiser.list och menyns räknare (session.navCounts). Bara för hanterare –
// importeras aldrig av skärmar.
import { contractsAs, SUPPLIER_ROLES, type Role } from "@/api/roles";
import type { Ctx } from "@/api/server";
import { DEFAULT_ORG_SETTINGS, type OrgSettings } from "@/core/config";
import { notificationsFor, type NotificationDb, type PersonalNotification } from "@/core/progression";
import { by } from "@/core/util";
import { orgSettingsFor } from "../_shared/context";

/** Rollerna som får påminnelser om sina ärenden utan progression (huvudcoachen; den vilande rollen handledare). */
const REMINDER_ROLES: readonly Role[] = ["coach", "handledare"];

/** Miljonbemannings interna regler (org_settings) för leverantören i användarens första avtal som Miljonbemanning. */
export async function orgRulesFor(ctx: Ctx): Promise<OrgSettings> {
  for (const id of contractsAs(ctx.actor, SUPPLIER_ROLES)) {
    const c = await ctx.repo.table("contracts").get(id);
    if (c) return orgSettingsFor(ctx, c);
  }
  return DEFAULT_ORG_SETTINGS;
}

/**
 * Den inloggades notiser: de sparade (tilldelning, meddelanden) och de beräknade – påminnelser för coachens ärenden och
 * eskaleringar till rollerna i escalateTo. Per roll och avtal (Karims beslut 7, 2026-10-09 – summan av rollerna, aldrig mer):
 * påminnelserna bara i avtalen där personen är coach, eskaleringarna bara i avtalen där personen har en eskaleringsroll (t.ex.
 * chef). Den som är chef i ett avtal och coach i ett annat får alltså inga eskaleringar för coachens avtal ("coachen ser dem
 * aldrig").
 *
 * ctx.system: påminnelser och eskaleringar räknas fram ur ärendena och avstämningarna i avtalen – i den riktiga tjänsten gör
 * ett schemalagt jobb detta och sparar notisen till mottagaren. Eskaleringar ska omfatta alla ärenden (även skyddade, som
 * chefen bara ser som ärendenummer). Ut lämnas bara den inloggades egna notiser: ärendenummer, coachens namn och veckans orsak
 * – aldrig deltagarens namn eller personuppgifter.
 */
export async function personalNotifications(ctx: Ctx, org: OrgSettings): Promise<PersonalNotification[]> {
  const { userId } = ctx.actor;
  const env = { now: ctx.now(), org };
  const escRoles = ctx.actor.roles.filter((r) => (org.notifications.progressionWatch.escalateTo as readonly string[]).includes(r));
  const remRoles = ctx.actor.roles.filter((r) => REMINDER_ROLES.includes(r));
  // Sparade notiser och läsmarkeringar: bara den inloggades egna (policyn/RLS: mottagaren läser sina rader).
  const [user_notifications, notification_reads] = await Promise.all([
    ctx.repo.table("user_notifications").list({ recipientId: userId }),
    ctx.repo.table("notification_reads").list({ userId }),
  ]);
  const computed = async (roles: readonly Role[]): Promise<PersonalNotification[]> => {
    const contracts = contractsAs(ctx.actor, roles);
    if (!roles.length || !contracts.length) return [];
    const cases = await ctx.system.table("cases").list({ contractId: { in: contracts }, status: "active" });
    const ids = cases.map((c) => c.id);
    const check_ins = ids.length ? await ctx.system.table("check_ins").list({ caseId: { in: ids } }) : [];
    const coachIds = [...new Set(cases.map((c) => c.leadCoachId).filter((x): x is string => !!x))];
    const profiles = coachIds.length ? await ctx.system.table("profiles").list({ id: { in: coachIds } }) : [];
    const db: NotificationDb = { cases, check_ins, user_notifications: [], notification_reads, profiles };
    return notificationsFor(db, userId, roles, env);
  };
  const stored = notificationsFor({ cases: [], check_ins: [], user_notifications, notification_reads, profiles: [] }, userId, [], env);
  return [...stored, ...(await computed(remRoles)), ...(await computed(escRoles))].sort(by<PersonalNotification>("createdAt", -1));
}
