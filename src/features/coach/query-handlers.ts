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
import { ABSENCE_REASONS, areaName, END_REASONS, END_REASON_LABEL, EVENT_KINDS, EVENT_LABEL, eventLabel, personName, phaseLabel, phaseName, reportStatusLabel } from "@/core/labels";
import { notificationsFor, progressionWatch } from "@/core/progression";
import { scopeToContract } from "@/core/scope";
import { finalReportWorkingDays, monthlyReportDueAt, slaStatus } from "@/core/sla";
import { addDays, addMonths, addWorkingDays, dayOf, fmtDate, isoWeek, monday, monthEnd, monthKey, weekMonday, WEEKDAYS, type LocalDate, type LocalDateTime, type MonthKey } from "@/core/time";
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
    absenceReasons: [...ABSENCE_REASONS],
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
  const mon = weekMonday(weekKey);
  const sun = addDays(mon, 6);
  const cases = await ctx.system.table("cases").list({ referrerId: recipientId });
  const ids = cases.map((c) => c.id);
  const activities = ids.length ? await ctx.system.table("activities").list({ caseId: { in: ids }, startsAt: { gte: mon, lte: `${sun}T23:59` } }) : [];
  const attendance = activities.length ? await ctx.system.table("attendance").list({ activityId: { in: activities.map((a) => a.id) } }) : [];
  const wr = weeklyReport({ cases, activities, attendance, deviations: [] }, recipientId, weekKey, { now });
  return wr.sections.reduce((s, x) => s + x.stats.unregistered, 0);
}

// ================================================================ Deltagarlistan (vyerna utan ärende)
handleQuery(casePicker, { roles: ["coach"] }, async (ctx, p) => {
  const now = ctx.now();
  const envOf = envCache(ctx);
  const { cases, person } = await myCases(ctx);
  const main = await primaryEnv(ctx, envOf, cases.map((c) => c.contractId));
  if (!main) throw new Error("Inget avtal med driftkonfiguration");
  const month = p.month ?? addMonths(monthKey(now), -1);
  const ids = { caseId: { in: cases.map((c) => c.id) } };
  const db = await loadDb(ctx.repo, ["check_ins", "monthly_assessments", "intake_assessments", "outcome_events"], {
    check_ins: ids, monthly_assessments: ids, intake_assessments: ids, outcome_events: ids,
  });
  // Månadsbedömningen: alla coachens ärenden som har en bedömning för månaden. Övriga vyer: pågående ärenden.
  const list = cases.filter((c) => (p.kind === "manad" ? !!assessmentFor(db, c.id, month) : c.status === "active"));
  const rows: CasePickerRow[] = [];
  for (const c of list) {
    const env = (await envOf(c.contractId)) ?? main;
    const base = { caseId: c.id, caseNumber: c.caseNumber, name: nameOf(person(c)), phaseLabel: phaseLabel(env.cfg, c.phase) };
    if (p.kind === "avstamning") {
      const last = latestCheckIn(db, c.id);
      const draft = checkInsOf(db, c.id).find((y) => y.status === "draft");
      rows.push({
        ...base, badge: draft ? { tone: "outline", icon: "edit", text: draft.ai ? "AI-utkast att granska" : "Utkast sparat" } : null,
        note: last ? `Senast godkänd ${fmtDate(last.heldAt)}` : "Ingen godkänd avstämning",
      });
    } else if (p.kind === "manad") {
      const ma = assessmentFor(db, c.id, month);
      rows.push({ ...base, badge: ma?.status === "approved" ? { tone: "blue", icon: "check", text: "Godkänd" } : { tone: "outline", icon: "edit", text: "Utkast" }, note: null });
    } else if (p.kind === "kartlaggning") {
      const ia = intakeOf(db, c.id);
      rows.push({
        ...base, note: null,
        badge: !ia ? { tone: "outline", icon: null, text: "Inte påbörjad" } : ia.status === "approved" ? { tone: "blue", icon: "check", text: "Godkänd" } : { tone: "outline", icon: "edit", text: "Utkast" },
      });
    } else {
      const n = eventsOf(db, c.id).length;
      rows.push({ ...base, badge: null, note: `${n} ${n === 1 ? "händelse registrerad" : "händelser registrerade"}` });
    }
  }
  return { month, monthDueAt: monthDueFor(main.cfg, month) ?? `${monthEnd(addMonths(month, 1))}T23:59`, monthDueNote: monthDueNote(main.cfg), rows };
});

// ================================================================ Veckoavstämning
/** Språk som samtyckesinformationen finns översatt till (annars lättläst svenska). */
const CONSENT_LANGUAGES = ["arabiska", "somaliska", "tigrinja", "engelska", "turkiska"];

handleQuery(checkInPage, { roles: ["coach"] }, async (ctx, p) => {
  const r = await caseFor(ctx, p.caseId, envCache(ctx));
  if ("gate" in r) return { kind: "gate" as const, gate: r.gate };
  const { c, person, env, head, referrer } = r;
  const me = ctx.actor.userId;
  const today = dayOf(env.now);
  const byCase = { caseId: c.id };
  const db = await loadDb(ctx.repo, ["check_ins", "activities", "attendance", "consents", "case_team", "memberships", "profiles"], {
    check_ins: byCase, activities: byCase, attendance: byCase, consents: byCase, case_team: byCase, memberships: { contractId: c.contractId },
  });
  const ci0 = p.checkInId ? db.check_ins.find((x) => x.id === p.checkInId) ?? null : null;
  const last = latestCheckIn(db, c.id);
  const meeting = db.activities.filter((a) => a.kind === "möte" && dayOf(a.startsAt) === today).sort(by("startsAt"))[0] ?? null;
  const watch = progressionWatch({ cases: [c], check_ins: db.check_ins }, { coachId: me }, env).find((w) => w.case.id === c.id) ?? null;
  const rep = repeatedAbsence(db, c.id, env);
  const consent = consentOf(db, c.id);
  // Ansvarig för en avvikelse: coachen själv, ärendets team och avtalets samordnare (prototypen: u-sara).
  const samordnare = db.memberships.filter((m) => m.role === "samordnare").map((m) => m.userId);
  const owners = uniq([me, ...db.case_team.map((t) => t.userId), ...samordnare]).map((id) => ({ id, name: `${personName(db.profiles, id)}${id === me ? " (du)" : ""}` }));
  const prot = !!person?.protectedIdentity;
  const view = (ci: CheckIn): CheckInView => ({
    id: ci.id, caseId: ci.caseId, status: ci.status, heldAt: ci.heldAt, durationMin: ci.durationMin, mode: ci.mode, inputMethod: ci.inputMethod, goalStatus: ci.goalStatus,
    nextGoal: ci.nextGoal, phase: ci.phase, activitiesDone: ci.activitiesDone, employerContacts: ci.employerContacts, overallStatus: ci.overallStatus, obstacles: ci.obstacles,
    note: ci.note, attendanceComment: ci.attendanceComment ?? "", docMinutes: ci.docMinutes, approvedAt: ci.approvedAt,
    approvedByName: ci.approvedBy ? personName(db.profiles, ci.approvedBy) : null, aiRunId: ci.aiRunId,
    // AI-utkastet visas aldrig för skyddade personuppgifter (CLAUDE.md punkt 8).
    ai: ci.ai && !prot ? ({ ...ci.ai, transcript: ci.ai.transcript ?? [], rawTranscriptDeletedAt: ci.ai.rawTranscriptDeletedAt ?? null } as CheckInView["ai"]) : null,
  });
  return {
    kind: "ok" as const,
    now: env.now,
    head,
    referrer,
    aiConsent: c.aiConsentStatus,
    consent: consent
      ? { givenAt: consent.givenAt, declinedAt: consent.declinedAt, textVersion: consent.textVersion, informedByName: personName(db.profiles, consent.informedBy), language: consent.language }
      : null,
    consentLanguage: person && CONSENT_LANGUAGES.includes(person.language) ? person.language : "lättläst svenska",
    checkIn: ci0 ? view(ci0) : null,
    drafts: checkInsOf(db, c.id).filter((x) => x.status === "draft").map((x) => ({ id: x.id, heldAt: x.heldAt, ai: !!x.ai })),
    lastApproved: last ? { nextGoal: last.nextGoal, durationMin: last.durationMin, mode: last.mode } : null,
    todayMeetingAt: meeting?.startsAt ?? null,
    watch: watch ? { streak: watch.streak, reason: watch.weeks[watch.weeks.length - 1].reason, weekKey: watch.lastWeek } : null,
    repeatedAbsence: rep ? { count: rep.length, withinDays: env.cfg.attendance.repeatedAbsenceRule.withinDays } : null,
    owners,
    phases: env.cfg.phases.map((x) => ({ no: x.no, name: x.name })),
    phaseSince: phaseSince(c, db),
    seesCoachNotes: !!env.cfg.customerVisibility.seesCoachNotes,
    options: { activityTypes: [...ACTIVITY_TYPES], obstacles: [...OBSTACLES], goalsByPhase: Object.fromEntries(Object.entries(GOALS).map(([k, v]) => [Number(k), [...v]])) },
  };
});

handleQuery(checkInAttendance, { roles: ["coach"] }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c || c.leadCoachId !== ctx.actor.userId) return null;
  const db = await loadDb(ctx.repo, ["activities", "attendance"], { activities: { caseId: c.id }, attendance: { caseId: c.id } });
  const from = addDays(p.date, -6);
  const s = attendanceStats(db, c.id, from, p.date, { now: ctx.now() });
  return { from, to: p.date, present: s.present, late: s.late, absentValid: s.absentValid, absentInvalid: s.absentInvalid, unregistered: s.unregistered, planned: s.planned, rate: s.rate };
});

handleQuery(aiRunInfo, { roles: ["coach"] }, async (ctx, p) => {
  const run = await ctx.repo.table("ai_runs").get(p.runId);
  return run ? { provider: run.provider, model: run.model } : null;
});

handleQuery(checkInReceipt, { roles: ["coach"] }, async (ctx, p) => {
  const r = await caseFor(ctx, p.caseId, envCache(ctx));
  if ("gate" in r) return { kind: "gate" as const, gate: r.gate };
  const { c, env, head, referrer } = r;
  const ci = await ctx.repo.table("check_ins").get(p.checkInId);
  const dv = p.deviationId ? await ctx.repo.table("deviations").get(p.deviationId) : null;
  const profiles = await ctx.repo.table("profiles").list();
  const task = dv ? await ctx.repo.table("tasks").first({ deviationId: dv.id }) : null;
  return {
    kind: "ok" as const,
    now: env.now,
    caseNumber: c.caseNumber,
    name: head.name,
    location: c.location || "Alby",
    referrer,
    coachName: personName(profiles, ctx.actor.userId),
    proposedAt: `${addWorkingDays(dayOf(env.now), 2)}T10:00`,
    checkIn: ci && ci.caseId === c.id
      ? {
        overallStatus: ci.overallStatus, phase: ci.phase, phaseLabel: ci.phase ? phaseLabel(env.cfg, ci.phase) : null,
        ai: ci.ai ? { audioDeletedAt: ci.ai.audioDeletedAt ?? null, rawTranscriptDeletedAt: ci.ai.rawTranscriptDeletedAt ?? null } : null,
      }
      : null,
    deviation: dv && dv.caseId === c.id
      ? {
        id: dv.id, description: dv.description, action: dv.action, ownerName: personName(profiles, dv.ownerId), followUpOn: dv.followUpOn,
        needsCustomerDecision: dv.needsCustomerDecision, taskCreated: !!task,
      }
      : null,
  };
});

// ================================================================ Månadsbedömning
handleQuery(assessmentPage, { roles: ["coach"] }, async (ctx, p) => {
  const r = await caseFor(ctx, p.caseId, envCache(ctx));
  if ("gate" in r) return { kind: "gate" as const, gate: r.gate };
  const { c, env, head, referrer } = r;
  const month = p.month ?? addMonths(monthKey(env.now), -1);
  const prog = env.cfg.progression;
  // AI-stöd bara med samtycke och aldrig vid skyddade personuppgifter – annars skickas inga AI-utkast till skärmen.
  const aiOk = c.aiConsentStatus === "given" && !head.protected;
  const byCase = { caseId: c.id };
  const db = await loadDb(ctx.repo, ["monthly_assessments", "monthly_plans", "check_ins", "activities", "attendance", "outcome_events", "reports"], {
    monthly_assessments: byCase, monthly_plans: byCase, check_ins: byCase, activities: byCase, attendance: byCase, outcome_events: byCase, reports: { caseId: c.id, kind: "monthly", month },
  });
  const ma = assessmentFor(db, c.id, month);
  const plan = planOf(db, c.id, month);
  const mStart = `${month}-01`;
  const mEnd = monthEnd(month);
  const cis = checkInsOf(db, c.id).filter((x) => x.status === "approved" && x.heldAt >= mStart && x.heldAt <= `${mEnd}T23:59`).sort(by("heldAt"));
  const att = attendanceStats(db, c.id, mStart, mEnd, env);
  const events = eventsOf(db, c.id).filter((e) => e.occurredOn >= mStart && e.occurredOn <= mEnd);
  const rep = db.reports[0] ?? null;
  const due = rep?.dueAt ?? monthDueFor(env.cfg, month) ?? `${mEnd}T23:59`;
  return {
    kind: "ok" as const,
    now: env.now,
    month,
    head,
    referrer,
    aiOk,
    scale: { 0: prog.scale["0"], 1: prog.scale["1"], 2: prog.scale["2"], 3: prog.scale["3"] },
    requiredFrom: prog.observationRequiredFromLevel,
    areas: prog.areas.map((key) => {
      const a = ma?.areas[key];
      const obs = aiOk && a?.aiObservationDraft ? { text: a.aiObservationDraft.text, sources: [...(a.aiObservationDraft.sources ?? [])], noEvidence: !!a.aiObservationDraft.noEvidence } : null;
      return {
        key, label: prog.areaLabels[key] ?? key, level: (a?.level ?? null) as ProgressLevel | null, observation: a?.observation ?? "", nextStep: a?.nextStep ?? "",
        aiLevelSuggestion: aiOk && !obs?.noEvidence ? ((a?.aiLevelSuggestion ?? null) as ProgressLevel | null) : null, aiObservationDraft: obs,
      };
    }),
    assessment: ma
      ? { status: ma.status, decidedAt: ma.decidedAt, summary: ma.summary ?? "", aiSummaryDraft: aiOk ? ma.aiSummaryDraft : null, overallStatus: ma.overallStatus }
      : null,
    plan: plan
      ? { goal1: plan.goal1, goal2: plan.goal2, plannedActivities: plan.plannedActivities, plannedEmployerContact: plan.plannedEmployerContact, plannedAdaptation: plan.plannedAdaptation, nextCustomerMeeting: plan.nextCustomerMeeting }
      : null,
    basis: {
      checkIns: cis.map((x) => x.heldAt),
      attendance: { rate: att.rate, present: att.present, late: att.late, planned: att.planned, unregistered: att.unregistered },
      events: events.map((e) => eventLabel(e.kind)),
    },
    report: rep ? { id: rep.id, statusLabel: reportStatusLabel(rep.status) } : null,
    dueAt: due,
    dueNote: monthDueNote(env.cfg),
    goals: [...(GOALS[Math.min(5, c.phase)] ?? [])],
  };
});

// ================================================================ Kartläggning
handleQuery(intakePage, { roles: ["coach"] }, async (ctx, p) => {
  const r = await caseFor(ctx, p.caseId, envCache(ctx));
  if ("gate" in r) return { kind: "gate" as const, gate: r.gate };
  const { c, person, env, head, referrer } = r;
  const byCase = { caseId: c.id };
  const db = await loadDb(ctx.repo, ["intake_assessments", "check_ins", "placements", "contract_areas"], {
    intake_assessments: byCase, check_ins: byCase, placements: byCase, contract_areas: { contractId: c.contractId },
  });
  const ia = intakeOf(db, c.id);
  const s = stuck(c, db, env);
  const areaTracks = uniq([...(c.primaryAreaCode ? TRACKS[c.primaryAreaCode] ?? [] : []), ...(c.secondaryAreaCode ? TRACKS[c.secondaryAreaCode] ?? [] : [])]);
  return {
    kind: "ok" as const,
    head,
    referrer,
    intake: ia
      ? {
        workExperience: ia.workExperience, education: ia.education, languageNotes: ia.languageNotes, digitalSkills: ia.digitalSkills, drivingLicence: ia.drivingLicence,
        workGoals: ia.workGoals, chosenTrack: ia.chosenTrack, adaptations: ia.adaptations, firstWeekGoal: ia.firstWeekGoal, status: ia.status, approvedAt: ia.approvedAt,
      }
      : null,
    stuck: s ? { phase: s.phase, phaseName: phaseName(env.cfg, s.phase), days: s.days, maxDays: s.maxDays } : null,
    backgroundInfo: c.backgroundInfo,
    needsInterpreter: !!person?.needsInterpreter,
    areaNames: { primary: areaName(db.contract_areas, c.primaryAreaCode), secondary: c.secondaryAreaCode ? areaName(db.contract_areas, c.secondaryAreaCode) : null },
    tracks: {
      area: areaTracks,
      all: db.contract_areas.flatMap((a) => (TRACKS[a.code] ?? []).map((t) => ({ value: t, label: `${a.code} ${a.name} – ${t}` }))),
    },
    firstWeekGoals: [...(GOALS[1] ?? [])],
  };
});

// ================================================================ Händelser och avslut
handleQuery(eventsPage, { roles: ["coach"] }, async (ctx, p) => {
  const r = await caseFor(ctx, p.caseId, envCache(ctx));
  if ("gate" in r) return { kind: "gate" as const, gate: r.gate };
  const { c, env, head, referrer } = r;
  const byCase = { caseId: c.id };
  const db = await loadDb(ctx.repo, ["outcome_events", "employers", "reports", "pulse_invites"], {
    outcome_events: byCase, reports: { caseId: c.id, kind: "final" }, pulse_invites: { caseId: c.id, occasion: "exit" },
  });
  const res = env.cfg.result;
  const areas = [c.primaryAreaCode, c.secondaryAreaCode].filter(Boolean);
  const finalRep = db.reports.sort(by<Report>((x) => x.version, -1))[0] ?? null;
  const pulse = db.pulse_invites.sort(by("sentAt", -1))[0] ?? null;
  const days = finalReportWorkingDays(env.cfg);
  return {
    kind: "ok" as const,
    now: env.now,
    head,
    referrer,
    closed: c.status === "closed" ? { endReason: c.endReason, endDate: c.endDate, resultClass: c.resultClass, resultVerifiedAt: c.resultVerifiedAt } : null,
    events: eventsOf(db, c.id).map((e) => ({
      id: e.id, kind: e.kind, label: eventLabel(e.kind), occurredOn: e.occurredOn, actor: e.actor, verificationKind: e.verificationKind, note: e.note, possibleBonus: e.possibleBonus,
    })),
    employers: db.employers.filter((e) => e.areas.some((a) => areas.includes(a))).map((e) => ({ id: e.id, name: e.name })),
    eventKinds: EVENT_KINDS.map((k) => ({ value: k, label: EVENT_LABEL[k] })),
    endReasons: END_REASONS.map((k) => ({ value: k, label: END_REASON_LABEL[k] })),
    result: {
      countsAsResult: [...res.countsAsResult],
      // Samma nämnarregel som avslutet (arenden.caseClose): tills undantagen är fastställda gäller den preliminära listan.
      excluded: [...(isUnset(res.excludedFromDenominator) ? res.prototypeExcluded ?? [] : res.excludedFromDenominator ?? [])],
      definitionText: isUnset(res.definition) ? `Resultatdefinitionen är inte fastställd i avtalet. ${res.prototypeDefinition ?? ""}`.trim() : String(res.definition),
    },
    finalReport: finalRep ? { id: finalRep.id, dueAt: finalRep.dueAt, sla: finalRep.dueAt ? sla(finalRep.dueAt, env) : null } : null,
    exitPulse: pulse ? { sentAt: pulse.sentAt, channel: pulse.channel, expiresAt: pulse.expiresAt } : null,
    finalDays: days ?? 0,
    finalProvisional: isUnset(slaRule(env.cfg, "slutrapport")?.within) || slaRule(env.cfg, "slutrapport")?.within == null,
    bonusOn: env.cfg.bonus?.enabled === true,
  };
});
