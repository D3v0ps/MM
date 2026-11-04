// Hanterare: räknare i sidopanelen – exakt som prototypens navCount (prototyp/src/99-shell.js) och sel.unreadNotifications:
//   inbox          avrop och mejl att hantera = fliken "Att hantera" i avropsinkorgen (samordnare, avtalsansvarig)
//   deadlines      förfaller: försenat + i dag som är användarens eget ansvar (samordnare, avtalsansvarig, chef)
//   unregistered   coachens oregistrerade närvaro från förra veckans måndag till i dag
//   tasks          öppna uppgifter till rollen eller personen (samordnare, avtalsansvarig, ekonom – siffran vid Min vecka)
//   notifications  olästa personliga notiser (alla MB-roller)
// Bara räknarna för rollens menyrader räknas fram (övriga är 0 – de visas inte).
import type { Ctx } from "@/api/server";
import { handleQuery } from "@/api/server";
import { isSupplierRole } from "@/api/roles";
import { visibleNotifications } from "@/api/tester-access";
import { loadDb } from "@/api/load";
import { unregistered } from "@/core/attendance";
import { unreadNotifications } from "@/core/progression";
import { scopeToContract } from "@/core/scope";
import { addDays, monday } from "@/core/time";
import { deadlineItems, deadlineRow, inboxEnv, inboxToHandle, loadInbox, loadOps, visibleCaseIds, type InboxEnv } from "@/features/inkorg/model";
import { navCounts, type NavCounts } from "./nav-api";

const INBOX_ROLES = ["samordnare", "avtalsansvarig"];
const DEADLINE_ROLES = ["samordnare", "avtalsansvarig", "chef"];
/** Rollerna som får uppgifter på Min vecka (tasks.to_role). */
const TASK_ROLES = ["samordnare", "avtalsansvarig", "ekonom"];

/** Öppna uppgifter till rollen eller till personen. Bara läsning via ctx.repo – policyn för tasks (ingen ny behörighet). */
async function openTaskCount(ctx: Ctx): Promise<number> {
  const me = ctx.actor.userId;
  const open = await ctx.repo.table("tasks").list({ status: "open" });
  return open.filter((t) => (t.toId ? t.toId === me : t.toRole === ctx.actor.role)).length;
}

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

async function notificationCount(ctx: Ctx, e: InboxEnv): Promise<number> {
  // Sparade notiser och läsmarkeringar är användarens egna (policyn: bara mottagaren).
  // Påminnelser och eskaleringar räknas fram av reglerna – i produktionen skapar ett schemalagt systemjobb dem som rader i
  // user_notifications. ctx.system läser därför avtalets ärenden och avstämningar som jobbet gör; bara antalet lämnas ut.
  const [own, reads, profiles] = await Promise.all([
    ctx.repo.table("user_notifications").list({ recipientId: ctx.actor.userId }),
    ctx.repo.table("notification_reads").list({ userId: ctx.actor.userId }),
    ctx.repo.table("profiles").list(),
  ]);
  const ops = scopeToContract(await loadDb(ctx.system, ["cases", "check_ins"], { cases: { contractId: e.contract.id } }), e.contract.id);
  return unreadNotifications({ ...ops, user_notifications: visibleNotifications(ctx.actor, own), notification_reads: reads, profiles }, ctx.actor.userId, ctx.actor.role, e.env);
}

handleQuery(navCounts, {}, async (ctx): Promise<NavCounts> => {
  const role = ctx.actor.role;
  const out: NavCounts = { inbox: 0, deadlines: 0, unregistered: 0, tasks: 0, notifications: 0 };
  if (!isSupplierRole(role) || !ctx.actor.contractIds.length) return out;
  const e = await inboxEnv(ctx).catch(() => null);
  if (!e) return out;
  if (INBOX_ROLES.includes(role)) out.inbox = inboxToHandle((await loadInbox(ctx, e)).items).length;
  if (DEADLINE_ROLES.includes(role)) {
    const ops = await loadOps(ctx, e);
    // Samma urval som Förfallers förval "Mitt ansvar" (paket 2, S7): försenat och i dag som är användarens eget ansvar.
    out.deadlines = deadlineItems(ops, e, await visibleCaseIds(ctx, e), 0).filter((x) => x.bucket !== "week" && deadlineRow(x, ops, e, ctx.actor).mine).length;
  }
  if (role === "coach") out.unregistered = await unregisteredCount(ctx, e);
  if (TASK_ROLES.includes(role)) out.tasks = await openTaskCount(ctx);
  out.notifications = await notificationCount(ctx, e);
  return out;
});
