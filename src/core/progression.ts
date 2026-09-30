// Progressionsbevakning och personliga notiser (Miljonbemannings interna regler, org_settings.notifications).
// Coachen får påminnelse efter en vecka utan progression; efter två veckor i rad eskaleras ärendet till chef/controller.
// Varje notis har exakt en mottagare. Eskaleringar räknas bara fram för rollerna i escalateTo – coachen ser dem aldrig.
import type { AppNotifyChannel } from "./config";
import type { Role } from "@/api/roles";
import type { Case, Db, UserNotification, UserNotificationKind } from "@/data/schema";
import { checkInsOf } from "./db-index";
import type { DomainEnv } from "./env";
import { personName } from "./labels";
import { addDays, dayOf, fmtWeekKey, isoWeek, monday, weekMonday, type LocalDateTime, type WeekKey } from "./time";
import { by } from "./util";

export type WeekProgress = {
  key: WeekKey;
  /** true = progression, false = ingen progression, null = räknas inte (pausad vecka eller startvecka). */
  progress: boolean | null;
  reason: string;
};

/**
 * Progression en viss vecka: godkänd avstämning med veckomålet Ja eller Delvis.
 * Pausad vecka och startveckan räknas inte. null om ärendet inte pågick veckan.
 */
export function weekProgress(c: Case, weekKey: WeekKey, db: Pick<Db, "check_ins">): WeekProgress | null {
  const mon = weekMonday(weekKey);
  const sun = addDays(mon, 6);
  if (!c.startDate || c.startDate > sun || (c.endDate && c.endDate < mon)) return null;
  if (c.pausedWeeks.includes(weekKey)) return { key: weekKey, progress: null, reason: "Pausad" };
  if (monday(c.startDate) === mon) return { key: weekKey, progress: null, reason: "Startvecka" };
  const cis = checkInsOf(db, c.id).filter((x) => x.heldAt >= mon && x.heldAt <= `${sun}T23:59`);
  const approved = cis.filter((x) => x.status === "approved");
  if (approved.some((x) => x.goalStatus === "yes" || x.goalStatus === "partly")) return { key: weekKey, progress: true, reason: "Veckomålet uppnått helt eller delvis" };
  if (approved.some((x) => x.goalStatus === "no")) return { key: weekKey, progress: false, reason: "Veckomålet inte uppnått" };
  if (cis.length) return { key: weekKey, progress: false, reason: "Avstämningen är inte godkänd" };
  return { key: weekKey, progress: false, reason: "Ingen avstämning dokumenterad" };
}

export type NoProgressStreak = { streak: number; weeks: WeekProgress[] };

/** Antal veckor i rad utan progression, räknat bakåt från senaste avslutade vecka (högst åtta veckor). */
export function noProgressStreak(c: Case, db: Pick<Db, "check_ins">, env: Pick<DomainEnv, "now">): NoProgressStreak {
  const weeks: WeekProgress[] = [];
  let mon = addDays(monday(dayOf(env.now)), -7);
  for (let i = 0; i < 8; i++, mon = addDays(mon, -7)) {
    const wp = weekProgress(c, isoWeek(mon).key, db);
    if (!wp || wp.progress === true) break;
    if (wp.progress === null) {
      if (wp.reason === "Startvecka") break;
      continue;
    }
    weeks.unshift(wp);
  }
  return { streak: weeks.length, weeks };
}

export type ProgressionWatchItem = { case: Case; streak: number; weeks: WeekProgress[]; lastWeek: WeekKey; level: "reminder" | "escalated" };

/** Ärenden som ska påminnas (coach) eller eskaleras (chef/controller) enligt de interna reglerna, längst streak först. */
export function progressionWatch(db: Pick<Db, "cases" | "check_ins">, opts: { coachId?: string | null }, env: Pick<DomainEnv, "now" | "org">): ProgressionWatchItem[] {
  const rule = env.org.notifications.progressionWatch;
  const coachId = opts.coachId ?? null;
  const out: ProgressionWatchItem[] = [];
  for (const c of db.cases.filter((x) => x.status === "active" && (!coachId || x.leadCoachId === coachId))) {
    const { streak, weeks } = noProgressStreak(c, db, env);
    if (streak < rule.remindCoachAfterWeeks) continue;
    out.push({ case: c, streak, weeks, lastWeek: weeks[weeks.length - 1].key, level: streak >= rule.escalateAfterConsecutiveWeeks ? "escalated" : "reminder" });
  }
  return out.sort((a, b) => b.streak - a.streak);
}

export type PersonalNotification = {
  /** Sparad notis: user_notifications.id. Beräknad: "nprog:{caseId}:{vecka}" eller "nesc:{caseId}:{vecka}". */
  id: string;
  recipientId: string;
  kind: UserNotificationKind;
  caseId: string | null;
  createdAt: LocalDateTime;
  channels: AppNotifyChannel[];
  title: string;
  body: string;
  /** E-postens text – aldrig personuppgifter, bara ärendenummer och "logga in". */
  emailBody: string;
  /** Räknad fram ur reglerna (inte sparad). */
  computed?: boolean;
  /** Eskalering: syns aldrig för coachen (låst i reglerna). */
  visibleToCoach?: boolean;
  readAt: LocalDateTime | null;
};

export type NotificationDb = Pick<Db, "cases" | "check_ins" | "user_notifications" | "notification_reads" | "profiles">;

/**
 * Personliga notiser för en mottagare: sparade (tilldelning, meddelanden) och beräknade påminnelser/eskaleringar.
 * Coach och handledare får påminnelser för ärenden där de är huvudcoach. Eskaleringar bara till rollerna i escalateTo.
 */
export function notificationsFor(db: NotificationDb, recipientId: string | null | undefined, role: Role, env: Pick<DomainEnv, "now" | "org">): PersonalNotification[] {
  if (!recipientId) return [];
  const rule = env.org.notifications.progressionWatch;
  const read = new Map(db.notification_reads.filter((r) => r.userId === recipientId).map((r) => [r.notificationKey, r.readAt]));
  const out: Omit<PersonalNotification, "readAt">[] = db.user_notifications
    .filter((n) => n.recipientId === recipientId)
    .map((n: UserNotification) => ({ ...n }));
  const monday8 = `${monday(dayOf(env.now))}T08:00`;
  if (role === "coach" || role === "handledare") {
    for (const w of progressionWatch(db, { coachId: recipientId }, env)) {
      const last = w.weeks[w.weeks.length - 1];
      out.push({
        id: `nprog:${w.case.id}:${w.lastWeek}`, recipientId, kind: "progress_reminder", caseId: w.case.id, createdAt: monday8, channels: [...rule.channels], computed: true,
        title: w.streak >= 2 ? `Påminnelse: ingen progression ${w.streak} veckor i rad` : "Påminnelse: ingen progression förra veckan",
        body: `${w.case.caseNumber}: ${last.reason} (${fmtWeekKey(last.key)}). Planera nästa steg och dokumentera i veckoavstämningen.`,
        emailBody: `Påminnelse från Miljonmatch: ett av dina ärenden (${w.case.caseNumber}) saknar dokumenterad progression. Logga in för att se vilket steg som behövs.`,
      });
    }
  }
  if ((rule.escalateTo as readonly string[]).includes(role)) {
    for (const w of progressionWatch(db, {}, env).filter((x) => x.level === "escalated")) {
      out.push({
        id: `nesc:${w.case.id}:${w.lastWeek}`, recipientId, kind: "progress_escalation", caseId: w.case.id, createdAt: monday8, channels: [...rule.channels], computed: true,
        title: `Eskalering: ${w.streak} veckor i rad utan progression`,
        body: `${w.case.caseNumber} · coach ${personName(db.profiles, w.case.leadCoachId)} · ${w.weeks.map((x) => `${fmtWeekKey(x.key)}: ${x.reason}`).join(" · ")}.`,
        emailBody: `Eskalering i Miljonmatch: ett ärende (${w.case.caseNumber}) har ${w.streak} veckor i rad utan progression. Logga in för att se detaljerna.`,
        visibleToCoach: rule.escalationVisibleToCoach,
      });
    }
  }
  return out.map((n) => ({ ...n, readAt: read.get(n.id) ?? null })).sort(by<PersonalNotification>("createdAt", -1));
}

/** Antal olästa notiser. */
export const unreadNotifications = (db: NotificationDb, recipientId: string | null | undefined, role: Role, env: Pick<DomainEnv, "now" | "org">): number =>
  notificationsFor(db, recipientId, role, env).filter((n) => !n.readAt).length;
