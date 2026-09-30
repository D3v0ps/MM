// Veckorapport närvaro: publiceras automatiskt när all närvaro för handläggarens deltagare är registrerad
// (prototypens attendance.set och coach.attendanceSet). Bara för hanterare.
//
// ctx.system används för hela publiceringen: kontrollen omfattar alla handläggarens deltagare – även ärenden som den som
// registrerar (coach eller handledare) inte har åtkomst till – och publiceringen till kommunen är ett systemsteg.
// Ingen av raderna lämnas ut till anroparen, bara rapportens id, veckan och handläggarens namn.
import type { Ctx } from "@/api/server";
import { addDays, fmtWeekKey, weekMonday, type WeekKey } from "@/core/time";
import { weeklyReport } from "@/core/weekly-report";
import type { Report } from "@/data/schema";
import { userEmail, userName } from "./context";

export type WeeklyPublished = {
  reportId: string;
  weekKey: WeekKey;
  recipientId: string;
  recipientName: string;
  /** Prototypens meddelande: "Veckorapporten för v. 4 2027 till Maria Ekdahl publicerades automatiskt." */
  text: string;
};

/** Är all närvaro registrerad för handläggarens deltagare i veckan (passerade tillfällen)? */
export async function weeklyComplete(ctx: Ctx, contractId: string, recipientId: string, weekKey: WeekKey): Promise<boolean> {
  const mon = weekMonday(weekKey);
  const sun = addDays(mon, 6);
  const cases = await ctx.system.table("cases").list({ referrerId: recipientId, contractId });
  const caseIds = cases.map((c) => c.id);
  const activities = caseIds.length ? await ctx.system.table("activities").list({ caseId: { in: caseIds }, startsAt: { gte: mon, lte: `${sun}T23:59` } }) : [];
  const attendance = activities.length ? await ctx.system.table("attendance").list({ activityId: { in: activities.map((a) => a.id) } }) : [];
  return weeklyReport({ cases, activities, attendance, deviations: [] }, recipientId, weekKey, { now: ctx.now() }).complete;
}

/** Leverera en väntande veckorapport till handläggaren automatiskt: status, revisionslogg och mejl utan personuppgifter. */
async function publishWeekly(ctx: Ctx, rep: Report, recipientId: string): Promise<WeeklyPublished> {
  const now = ctx.now();
  const weekKey = rep.week as WeekKey;
  await ctx.system.table("reports").update(rep.id, { status: "delivered", deliveredAt: now, approvedAt: now, deliveredTo: [recipientId] });
  await ctx.audit({ action: "report.published", entity: "report", entityId: rep.id, contractId: rep.contractId, details: { kind: "weekly_attendance", week: weekKey, automatic: true } });
  await ctx.notify({ channel: "email", to: await userEmail(ctx, recipientId), template: "ny_rapport", body: `Veckorapporten för ${fmtWeekKey(weekKey)} finns i portalen – logga in för att läsa.`, caseId: null });
  const recipientName = await userName(ctx, recipientId);
  return { reportId: rep.id, weekKey, recipientId, recipientName, text: `Veckorapporten för ${fmtWeekKey(weekKey)} till ${recipientName} publicerades automatiskt.` };
}

/** Publicera handläggarens väntande veckorapport om all närvaro nu är registrerad. Null om inget publicerades. */
export async function publishWeeklyIfComplete(ctx: Ctx, contractId: string, recipientId: string | null, weekKey: WeekKey): Promise<WeeklyPublished | null> {
  if (!recipientId) return null;
  const rep = await ctx.system.table("reports").first({ kind: "weekly_attendance", week: weekKey, recipientUserId: recipientId, status: "waiting", contractId });
  if (!rep) return null;
  if (!(await weeklyComplete(ctx, contractId, recipientId, weekKey))) return null;
  return publishWeekly(ctx, rep, recipientId);
}
