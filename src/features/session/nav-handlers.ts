// Hanterare: räknare i sidopanelen – exakt som prototypens navCount (prototyp/src/99-shell.js) och sel.unreadNotifications:
//   inbox          avrop och mejl att hantera = fliken "Att hantera" i avropsinkorgen (samordnare, avtalsansvarig)
//   deadlines      förfaller: försenat + i dag (samordnare, avtalsansvarig, chef)
//   unregistered   coachens oregistrerade närvaro från förra veckans måndag till i dag
//   notifications  olästa personliga notiser (alla MB-roller)
// Bara räknarna för rollernas menyrader räknas fram (övriga är 0 – de visas inte). Den som har flera roller får räknarna för
// alla sina roller (Karims beslut 7, 2026-10-09).
import type { Ctx } from "@/api/server";
import { handleQuery } from "@/api/server";
import { hasAnyRole, isStaffActor, type Role } from "@/api/roles";
import { unregistered } from "@/core/attendance";
import { addDays, monday } from "@/core/time";
import { DEADLINE_ROLES, deadlineItems, inboxEnv, INBOX_ROLES, inboxToHandle, loadInbox, loadOps, visibleCaseIds, type InboxEnv } from "@/features/inkorg/model";
import { orgRulesFor, personalNotifications } from "@/features/notiser/model";
import { navCounts, type NavCounts } from "./nav-api";


async function unregisteredCount(ctx: Ctx, e: InboxEnv): Promise<number> {
  const me = ctx.actor.userId;
  // Coachens egna ärenden och deras närvaro (policyn ger coachen bara egna ärenden och team).
  const cases = await ctx.repo.table("cases").list({ leadCoachId: me, status: { in: ["active", "closed"] } });
  const ids = cases.map((c) => c.id);
  if (!ids.length) return 0;
  const [activities, attendance] = await Promise.all([
    ctx.repo.table("activities").list({ caseId: { in: ids } }),
    ctx.repo.table("attendance").list({ caseId: { in: ids } }),
  ]);
  const lastMon = addDays(monday(e.today), -7);
  return unregistered({ cases, activities, attendance }, me, lastMon, e.today, e.env).length;
}

/**
 * Olästa personliga notiser – samma som notiser.list (personalNotifications: sparade notiser och påminnelser och eskaleringar
 * per roll i rollens avtal). Bara antalet lämnas ut.
 */
async function notificationCount(ctx: Ctx): Promise<number> {
  return (await personalNotifications(ctx, await orgRulesFor(ctx))).filter((n) => !n.readAt).length;
}

handleQuery(navCounts, {}, async (ctx): Promise<NavCounts> => {
  const a = ctx.actor;
  const out: NavCounts = { inbox: 0, deadlines: 0, unregistered: 0, notifications: 0 };
  if (!isStaffActor(a) || !a.contractIds.length) return out;
  // Varje räknare i avtalet där personen har räknarens roll (inkorgen samordnarens, förfallolistan också chefens, närvaron
  // coachens) – aldrig ett avtal där personen bara har en annan roll.
  const envFor = (roles: readonly Role[]) => (hasAnyRole(a, roles) ? inboxEnv(ctx, roles).catch(() => null) : Promise.resolve(null));
  const inbox = await envFor(INBOX_ROLES);
  if (inbox) out.inbox = inboxToHandle((await loadInbox(ctx, inbox)).items).length;
  const dl = await envFor(DEADLINE_ROLES);
  if (dl) {
    const ops = await loadOps(ctx, dl);
    out.deadlines = deadlineItems(ops, dl, await visibleCaseIds(ctx, dl), 0).filter((x) => x.bucket !== "week").length;
  }
  const coach = await envFor(["coach"]);
  if (coach) out.unregistered = await unregisteredCount(ctx, coach);
  out.notifications = await notificationCount(ctx);
  return out;
});
