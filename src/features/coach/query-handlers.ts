// Frågor för coachens skärmar (Min vecka, närvaro, avstämning, månadsbedömning, kartläggning, händelser och avslut).
// Port av vyerna i prototyp/src/views/coach.js: samma urval, regler och siffror. Beräkningarna görs med funktionerna i
// src/core och datat läses via ctx.repo (behörigheten gäller). Registreras via handlers.ts – importeras aldrig av skärmar.
import { isCustomerRole } from "@/api/roles";
import { handleQuery, type Ctx } from "@/api/server";
import { loadDb } from "@/api/load";
import { alerts, type AlertItem } from "@/core/alerts";
import { attendanceStats, repeatedAbsence, unregistered } from "@/core/attendance";
import { phaseSince, stuck } from "@/core/cases";
import { isOperational, isUnset, slaRule, type OperationalConfig, type ProgressLevel } from "@/core/config";
import { assessmentFor, attendanceFor, checkInsOf, consentOf, eventsOf, intakeOf, latestCheckIn, planOf } from "@/core/db-index";
import { deadlines, type DeadlineItem } from "@/core/deadlines";
import { domainEnv, type DomainEnv } from "@/core/env";
import { areaName, END_REASONS, END_REASON_LABEL, EVENT_KINDS, EVENT_LABEL, eventLabel, personName, phaseLabel, phaseName, reportStatusLabel } from "@/core/labels";
import { notificationsFor, progressionWatch } from "@/core/progression";
import { scopeToContract } from "@/core/scope";
import { finalReportWorkingDays, monthlyReportDueAt, slaStatus } from "@/core/sla";
import { addDays, addMonths, addWorkingDays, dayOf, isoWeek, monday, monthEnd, monthKey, WEEKDAYS, type LocalDate, type LocalDateTime, type MonthKey } from "@/core/time";
import { by, uniq } from "@/core/util";
import { weeklyReport } from "@/core/weekly-report";
import type { Case, CheckIn, Contract, Person, Report } from "@/data/schema";
// Mall 02:s listor (aktivitetstyper, hinder, veckomål per fas) och yrkesspåren per avtalsområde. Samma listor som den
// simulerade AI:n använder (src/features/_shared/ai-sim.ts) – flyttas till avtalskonfigurationen när mallarna är fastställda.
import { ACTIVITY_TYPES, GOALS, OBSTACLES, TRACKS } from "@/data/seed/constants";
import { orgSettingsFor } from "../_shared/context";
import {
  aiRunInfo, assessmentPage, casePicker, checkInAttendance, checkInPage, checkInReceipt, eventsPage, intakePage, minVecka, narvaroView,
  type CaseHead, type CasePickerRow, type CheckInView, type CoachGate, type CoachSla, type MinVeckaView, type NarvaroReport, type NarvaroRow,
  type NarvaroWeek, type ReferrerView,
} from "./api";

// ---------------------------------------------------------------- Gemensamt
const GATE_NOT_FOUND: CoachGate = { title: "Ärendet finns inte", text: "Välj ett av dina ärenden i listan." };
const GATE_NOT_MINE: CoachGate = { title: "Inte ditt ärende", text: "Coachen ser bara de ärenden där hen är huvudcoach. Kontakta samordnaren om du behöver åtkomst." };

const sla = (dueAt: LocalDateTime, env: Pick<DomainEnv, "now">): CoachSla => {
  const s = slaStatus(dueAt, null, env);
  return { label: s.label, tone: s.tone };
};
const nameOf = (p: Pick<Person, "firstName" | "lastName"> | null | undefined): string => (p ? `${p.firstName} ${p.lastName}` : "–");
/** "Nadia W." – kortnamn i kalendern. Skyddade personuppgifter visas med fullt namn (bara för namngiven coach), som i prototypen. */
const shortNameOf = (p: Pick<Person, "firstName" | "lastName" | "protectedIdentity"> | null | undefined): string =>
  !p ? "–" : p.protectedIdentity ? nameOf(p) : `${p.firstName} ${p.lastName.charAt(0)}.`;

/** Avtalens miljö (konfiguration, interna regler, klocka) – en gång per avtal och anrop. */
function envCache(ctx: Ctx) {
  const cache = new Map<string, Promise<DomainEnv | null>>();
  return (contractId: string): Promise<DomainEnv | null> => {
    let p = cache.get(contractId);
    if (!p) {
      p = (async () => {
        const contract: Contract | null = await ctx.repo.table("contracts").get(contractId);
        if (!contract || !isOperational(contract.config)) return null;
        return domainEnv(contract, await orgSettingsFor(ctx, contract), ctx.now());
      })();
      cache.set(contractId, p);
    }
    return p;
  };
}

/** Aktörens första avtal med driftkonfiguration (texter som "måndag 10.00" och interna regler). */
async function primaryEnv(ctx: Ctx, envOf: (id: string) => Promise<DomainEnv | null>, preferred: readonly string[] = []): Promise<DomainEnv | null> {
  for (const id of uniq([...preferred, ...ctx.actor.contractIds])) {
    const env = await envOf(id);
    if (env) return env;
  }
  return null;
}

// ---------------------------------------------------------------- Avtalets tidsgränser (prototypens slaCfg-hjälpare)
type SlaCfg = Pick<OperationalConfig, "sla">;
/** Registrering av förra veckans närvaro: måndag 10.00 veckan efter (Botkyrka). */
function regDueFor(cfg: SlaCfg, weekMonday: LocalDate): LocalDateTime | null {
  const r = slaRule(cfg, "veckorapport_registrering");
  return r?.time ? `${addDays(weekMonday, 7 + (r.weekday ?? 0))}T${r.time}` : null;
}
const weeklyRuleText = (cfg: SlaCfg, key: string): string => {
  const r = slaRule(cfg, key);
  return r?.time ? `${WEEKDAYS[r.weekday ?? 0]} ${r.time.replace(":", ".")}` : "Ej fastställt";
};
const monthDueFor = (cfg: SlaCfg, month: MonthKey): LocalDateTime | null => monthlyReportDueAt(cfg, month);
function monthDueNote(cfg: SlaCfg): string {
  const r = slaRule(cfg, "manadsrapport");
  if (r && !isUnset(r.due) && r.due != null) return "Sista dag enligt avtalet";
  const n = r?.proposal?.nthWorkingDay;
  return n != null ? `Sista dag ej fastställd – förslag ${n}:e arbetsdagen` : "Sista dag ej fastställd";
}

// ---------------------------------------------------------------- Ärendet
type CaseCtx = { c: Case; person: Person | null; env: DomainEnv; head: CaseHead; referrer: ReferrerView };

/**
 * Ärendet för en ärendevy (prototypens gate): coachen arbetar bara i ärenden där hen är huvudcoach.
 * Ett ärende som coachen inte får läsa ger "Inte ditt ärende" om det finns – ctx.system används bara för att se att
 * ärendet finns (ja/nej), inga uppgifter om ärendet lämnas ut.
 */
async function caseFor(ctx: Ctx, caseId: string, envOf: (id: string) => Promise<DomainEnv | null>): Promise<CaseCtx | { gate: CoachGate }> {
  const c = await ctx.repo.table("cases").get(caseId);
  if (!c) return { gate: (await ctx.system.table("cases").get(caseId)) ? GATE_NOT_MINE : GATE_NOT_FOUND };
  if (c.leadCoachId !== ctx.actor.userId) return { gate: GATE_NOT_MINE };
  const env = await envOf(c.contractId);
  if (!env) return { gate: GATE_NOT_FOUND };
  const person = await ctx.repo.table("persons").get(c.personId);
  const areas = await ctx.repo.table("contract_areas").list({ contractId: c.contractId });
  const head: CaseHead = {
    caseId: c.id, caseNumber: c.caseNumber, name: nameOf(person), protected: !!person?.protectedIdentity, phase: c.phase, phaseName: phaseName(env.cfg, c.phase),
    status: c.status, areaName: areaName(areas, c.primaryAreaCode), track: c.vocationalTrack || "Yrkesspår inte valt",
  };
  return { c, person, env, head, referrer: await referrerOf(ctx, c) };
}

/** Beställande handläggare (namn och enhet) – kontot om det finns, annars kontaktuppgifterna i beställningen. */
async function referrerOf(ctx: Ctx, c: Case): Promise<ReferrerView> {
  const p = c.referrerId ? await ctx.repo.table("profiles").get(c.referrerId) : null;
  return { id: p ? p.id : null, name: p?.fullName ?? c.referrerName ?? null, unit: p?.customerUnit ?? c.referrerUnit ?? null };
}

/** Coachens ärenden (huvudcoach), med personerna. */
async function myCases(ctx: Ctx) {
  const cases = (await ctx.repo.table("cases").list({ leadCoachId: ctx.actor.userId })).sort(by<Case>("caseNumber"));
  const persons = cases.length ? await ctx.repo.table("persons").list({ id: { in: uniq(cases.map((c) => c.personId)) } }) : [];
  const personOf = new Map(persons.map((p) => [p.id, p]));
  return { cases, person: (c: Case) => personOf.get(c.personId) ?? null };
}

// ================================================================ Min vecka
/** Vyer som coachen kan öppna (länkar i flaggor och deadlines). Inkorgen, ledningen och ekonomin är inte coachens. */
const COACH_VIEWS = new Set(["arende.kort", "arenden.lista", "coach.minvecka", "coach.narvaro", "coach.avstamning", "coach.manad", "coach.kartlaggning", "coach.handelse", "rapporter.lista", "rapport.visa", "notiser"]);
const coachHref = (x: Pick<AlertItem | DeadlineItem, "link" | "href">): string | null => (COACH_VIEWS.has(x.link.view) ? x.href : null);

handleQuery(minVecka, { roles: ["coach"] }, async (ctx): Promise<MinVeckaView> => {
  const me = ctx.actor.userId;
  const now = ctx.now();
  const today = dayOf(now);
  const mon = monday(today);
  const lastMon = addDays(mon, -7);
  const envOf = envCache(ctx);
  const { cases, person } = await myCases(ctx);
  const ids = cases.map((c) => c.id);
  const byCase = { caseId: { in: ids } };
  const db = await loadDb(
    ctx.repo,
    ["activities", "attendance", "check_ins", "monthly_assessments", "reports", "placements", "alert_acks", "profiles", "memberships", "deviations",
      "user_notifications", "notification_reads", "messages", "contract_deviations", "billing_runs", "price_items", "buyer_references", "invoice_drafts",
      "billing_week_approvals", "pulse_responses", "inbound_emails"],
    { activities: byCase, attendance: byCase, check_ins: byCase, monthly_assessments: byCase, placements: byCase, deviations: byCase, messages: byCase, user_notifications: { recipientId: me } },
  );
  const all = { ...db, cases };
  const main = await primaryEnv(ctx, envOf, cases.map((c) => c.contractId));
  if (!main) throw new Error("Inget avtal med driftkonfiguration");
  const envs = (await Promise.all(uniq([main.contractId, ...cases.map((c) => c.contractId)]).map(envOf))).filter((e): e is DomainEnv => !!e);
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const active = cases.filter((c) => c.status === "active");
  const activeIds = new Set(active.map((c) => c.id));

  // Närvaro att registrera (förra veckan)
  const unreg = unregistered(all, me, lastMon, addDays(lastMon, 6), main);
  const regDue = regDueFor(main.cfg, lastMon);
  const unregByCase = new Map<string, typeof unreg>();
  for (const x of unreg) unregByCase.set(x.case.id, [...(unregByCase.get(x.case.id) ?? []), x]);
  const referrers = new Set(cases.map((c) => c.referrerId).filter(Boolean));
  const waiting = db.reports.filter((r) => r.kind === "weekly_attendance" && r.week === isoWeek(lastMon).key && r.status === "waiting" && r.recipientUserId && referrers.has(r.recipientUserId));

  // I dag
  const todays = db.activities.filter((a) => dayOf(a.startsAt) === today && activeIds.has(a.caseId)).sort(by("startsAt"));
  const next = todays.find((a) => a.startsAt >= now) ?? null;
  const ciToday = (caseId: string): CheckIn | null => checkInsOf(all, caseId).find((x) => dayOf(x.heldAt) === today) ?? null;

  // AI-utkast och månadsbedömningar (förra månaden)
  const drafts = db.check_ins.filter((x) => x.status === "draft" && x.ai && caseById.has(x.caseId)).sort(by("heldAt"));
  const pm = addMonths(monthKey(today), -1);
  const assessments = cases.map((c) => ({ c, ma: assessmentFor(all, c.id, pm) })).filter((x) => x.ma);
  const maOpen = assessments.filter((x) => x.ma?.status !== "approved");

  // Meddelanden, påminnelser, flaggor, notiser
  const notifs = notificationsFor(all, me, "coach", main).filter((n) => !n.readAt && n.kind !== "progress_escalation");
  const customerIds = new Set(db.memberships.filter((m) => isCustomerRole(m.role)).map((m) => m.userId));
  const latestCustomerMsg = (caseId: string) => db.messages.filter((m) => m.caseId === caseId && customerIds.has(m.senderId)).sort(by("createdAt")).pop() ?? null;
  const reminders = progressionWatch(all, { coachId: me }, main);
  const flagList = envs
    .flatMap((env) => alerts(scopeToContract(all, env.contractId), { role: "coach", personaId: me }, env))
    .filter((a) => !["no_progress", "ai_draft"].includes(a.kind) && !/escalat/i.test(a.kind));
  const due = envs
    .flatMap((env) => deadlines(scopeToContract(all, env.contractId), { days: 7, coachId: me }, env))
    .filter((x) => x.kind !== "veckorapport_registrering");
  const dueMonthly = due.filter((x) => x.kind === "manadsrapport");
  const byStatus: Partial<Record<Report["status"], number>> = {};
  for (const x of dueMonthly) {
    const st = db.reports.find((r) => r.id === x.reportId)?.status;
    if (st) byStatus[st] = (byStatus[st] ?? 0) + 1;
  }
  const monthDue = monthDueFor(main.cfg, pm);

  const row = (c: Case) => ({ caseId: c.id, caseNumber: c.caseNumber, name: nameOf(person(c)) });
  return {
    now,
    lastWeek: { no: isoWeek(lastMon).week, mon: lastMon },
    reg: {
      dueAt: regDue ?? `${addDays(lastMon, 7)}T00:00`, sla: regDue ? sla(regDue, main) : { label: "Ej fastställt", tone: "ok" },
      dueText: weeklyRuleText(main.cfg, "veckorapport_registrering"), pubText: weeklyRuleText(main.cfg, "veckorapport_publicering"),
    },
    unregistered: {
      count: unreg.length,
      byCase: [...unregByCase.values()].map((rows) => ({ ...row(rows[0].case), items: rows.map((x) => ({ startsAt: x.activity.startsAt, kind: x.activity.kind })) })),
      waitingFor: waiting.map((r) => personName(db.profiles, r.recipientUserId)),
    },
    today: todays.map((a) => {
      const c = caseById.get(a.caseId) as Case;
      const at = attendanceFor(all, a.id);
      const ci = a.kind === "möte" ? ciToday(c.id) : null;
      return {
        id: a.id, ...row(c), kind: a.kind, startsAt: a.startsAt, durationMin: a.durationMin, location: a.location,
        attendance: at ? { status: at.status, reason: at.reason } : null, checkIn: ci ? { id: ci.id, approved: ci.status === "approved" } : null,
      };
    }),
    next: next ? { id: next.id, shortName: shortNameOf(person(caseById.get(next.caseId) as Case)) } : null,
    drafts: drafts.map((ci) => ({
      checkInId: ci.id, ...row(caseById.get(ci.caseId) as Case), heldAt: ci.heldAt, inputMethod: ci.inputMethod,
      audioDeletedAt: ci.ai?.audioDeletedAt ?? null, rawTranscriptDeleteBy: ci.ai?.rawTranscriptDeleteBy ?? null,
    })),
    monthly: {
      month: pm, dueAt: monthDue ?? `${monthEnd(addMonths(pm, 1))}T23:59`, dueNote: monthDueNote(main.cfg),
      done: assessments.length - maOpen.length, total: assessments.length,
      open: maOpen.map(({ c, ma }) => ({
        ...row(c),
        hasAi: !!ma?.aiSummaryDraft || Object.values(ma?.areas ?? {}).some((x) => !!x?.aiObservationDraft && !x.aiObservationDraft.noEvidence),
      })),
    },
    messages: notifs
      .filter((n) => n.kind === "message" && n.caseId && caseById.has(n.caseId))
      .map((n) => {
        const m = latestCustomerMsg(n.caseId as string);
        return {
          notificationId: n.id, ...row(caseById.get(n.caseId as string) as Case), createdAt: n.createdAt, from: m ? personName(db.profiles, m.senderId) : null,
          excerpt: m ? (m.body.length > 90 ? `${m.body.slice(0, 90)} …` : m.body) : null,
        };
      }),
    reminders: reminders.map((w) => ({ ...row(w.case), streak: w.streak, reason: w.weeks[w.weeks.length - 1].reason, weekKey: w.weeks[w.weeks.length - 1].key })),
    flags: flagList.map((a) => ({ key: a.key, kind: a.kind, severity: a.severity, title: a.title, text: a.text, caseId: a.caseId ?? null, href: coachHref(a) })),
    unread: {
      count: notifs.length,
      latest: notifs.slice(0, 3).map((n) => ({ id: n.id, title: n.title, caseNumber: (n.caseId && caseById.get(n.caseId)?.caseNumber) || (n.caseId ? null : null) })),
    },
    due: {
      monthly: dueMonthly.length ? { count: dueMonthly.length, byStatus, dueAt: dueMonthly[0].dueAt, sla: { label: dueMonthly[0].sla.label, tone: dueMonthly[0].sla.tone } } : null,
      other: due.filter((x) => x.kind !== "manadsrapport").map((x) => {
        const c = x.caseId ? caseById.get(x.caseId) : undefined;
        return {
          id: x.id, label: x.label, caseNumber: c?.caseNumber ?? null, name: c ? nameOf(person(c)) : null, dueAt: x.dueAt, sla: { label: x.sla.label, tone: x.sla.tone },
          provisional: !!x.provisional, href: coachHref(x),
        };
      }),
    },
    calendar: {
      mon,
      activities: db.activities
        .filter((a) => activeIds.has(a.caseId) && a.startsAt >= mon && a.startsAt < addDays(mon, 5))
        .sort(by("startsAt"))
        .map((a) => ({
          id: a.id, caseId: a.caseId, kind: a.kind, startsAt: a.startsAt, location: a.location, shortName: shortNameOf(person(caseById.get(a.caseId) as Case)),
          attendance: attendanceFor(all, a.id)?.status ?? null,
        })),
    },
  };
});

// ================================================================ Närvaro
handleQuery(narvaroView, { roles: ["coach", "handledare"] }, async (ctx) => {
  const me = ctx.actor.userId;
  const now = ctx.now();
  const today = dayOf(now);
  const thisMon = monday(today);
  const lastMon = addDays(thisMon, -7);
  const envOf = envCache(ctx);
  // Coachen: ärenden där hen är huvudcoach. Handledaren: teamärenden (policyn visar bara dem, aldrig skyddade).
  const visible = await ctx.repo.table("cases").list();
  const cases = visible.filter((c) => (ctx.actor.role === "coach" ? c.leadCoachId === me : true) && c.startDate);
  const ids = cases.map((c) => c.id);
  const main = await primaryEnv(ctx, envOf, cases.map((c) => c.contractId));
  if (!main) throw new Error("Inget avtal med driftkonfiguration");
  const db = await loadDb(ctx.repo, ["activities", "attendance", "persons", "reports", "profiles"], {
    activities: { caseId: { in: ids } }, attendance: { caseId: { in: ids } }, persons: { id: { in: uniq(cases.map((c) => c.personId)) } }, reports: { kind: "weekly_attendance" },
  });
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const personById = new Map(db.persons.map((p) => [p.id, p]));
  const repeated = new Map<string, boolean>();
  const isRepeated = async (c: Case) => {
    if (!repeated.has(c.id)) {
      const env = (await envOf(c.contractId)) ?? main;
      repeated.set(c.id, !!repeatedAbsence(db, c.id, env));
    }
    return repeated.get(c.id) as boolean;
  };

  const week = async (mon: LocalDate): Promise<NarvaroWeek> => {
    const wk = isoWeek(mon);
    const acts = db.activities.filter((a) => a.startsAt >= mon && a.startsAt < addDays(mon, 7)).sort(by("startsAt"));
    const rows: NarvaroRow[] = [];
    for (const a of acts) {
      const c = caseById.get(a.caseId) as Case;
      const at = attendanceFor(db, a.id);
      rows.push({
        activityId: a.id, caseId: c.id, caseNumber: c.caseNumber, name: nameOf(personById.get(c.personId)), kind: a.kind, startsAt: a.startsAt, durationMin: a.durationMin,
        location: a.location, attendance: at ? { status: at.status, reason: at.reason } : null, repeated: at?.status === "absent_invalid" ? await isRepeated(c) : false,
        referrerId: c.referrerId,
      });
    }
    const open = rows.filter((r) => r.startsAt < now && !r.attendance);
    const recipients = uniq(cases.filter((c) => rows.some((r) => r.caseId === c.id)).map((c) => c.referrerId)).filter((x): x is string => !!x);
    const reports: NarvaroReport[] = [];
    for (const rid of recipients) {
      const rep = db.reports.find((r) => r.week === wk.key && r.recipientUserId === rid) ?? null;
      const user = await ctx.repo.table("profiles").get(rid);
      reports.push({
        recipientId: rid, name: user?.fullName ?? personName(db.profiles, rid), unit: user?.customerUnit ?? "", reportId: rep?.id ?? null,
        publishedAt: rep && (rep.status === "delivered" || rep.status === "opened") ? rep.deliveredAt : null,
        left: await weeklyLeft(ctx, rid, wk.key, now), mine: open.filter((r) => r.referrerId === rid).length,
      });
    }
    reports.sort((a, b) => b.mine - a.mine);
    const dueAt = regDueFor(main.cfg, mon) ?? `${addDays(mon, 7)}T00:00`;
    return { key: wk.key, no: wk.week, mon, dueAt, sla: sla(dueAt, main), rows, reports };
  };

  const same = main.cfg.attendance.sameDayNoticeOnInvalidAbsence;
  return {
    now,
    dueText: weeklyRuleText(main.cfg, "veckorapport_registrering"),
    pubText: weeklyRuleText(main.cfg, "veckorapport_publicering"),
    sameDayText: `Frånvaronotis samma dag: ${isUnset(same) ? "tillval som inte är fastställt – ingen notis skickas." : same ? "skickas till handläggaren." : "används inte."}`,
    absenceReasons: ["Sjukdom", "Vård av barn", "Myndighetsbesök", "Annat giltigt skäl"],
    repeatedRule: { ...main.cfg.attendance.repeatedAbsenceRule },
    caseCount: cases.length,
    weeks: { last: await week(lastMon), this: await week(thisMon) },
  };
});

/**
 * Antal oregistrerade tillfällen i handläggarens hela veckorapport (alla hennes deltagare).
 * ctx.system: rapporten omfattar deltagare som coachen inte har åtkomst till – bara antalet lämnas ut.
 */
async function weeklyLeft(ctx: Ctx, recipientId: string, weekKey: string, now: LocalDateTime): Promise<number> {
  const mon = addDays(`${weekKey}`.length ? monday(`${isoMonday(weekKey)}`) : "", 0);
  const sun = addDays(mon, 6);
  const cases = await ctx.system.table("cases").list({ referrerId: recipientId });
  const ids = cases.map((c) => c.id);
  const activities = ids.length ? await ctx.system.table("activities").list({ caseId: { in: ids }, startsAt: { gte: mon, lte: `${sun}T23:59` } }) : [];
  const attendance = activities.length ? await ctx.system.table("attendance").list({ activityId: { in: activities.map((a) => a.id) } }) : [];
  const wr = weeklyReport({ cases, activities, attendance, deviations: [] }, recipientId, weekKey, { now });
  return wr.sections.reduce((s, x) => s + x.stats.unregistered, 0);
}
