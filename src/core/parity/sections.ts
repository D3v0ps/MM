// Jämförelse mot den gamla prototypen: räknar fram samma värden som facit.json (generate-facit.mjs) med
// funktionerna i src/core, normaliserade på samma sätt. Används av src/core/parity.test.ts.
import type { Role } from "@/api/roles";
import type { Db } from "@/data/schema";
import {
  ackTextFor, alerts, attendanceStats, avropDue, awaitingAnswer, billableWeeks, billingForMonth, buyerRefProblem, customerSummary, deadlines,
  firstMeetingDue, inboxEmails, invoiceStatus, kpis, noProgressStreak, notificationsFor, orderValueOre, phaseSince, previewNextCaseNumber,
  progressionWatch, pulseStats, repeatedAbsence, resultForecast, resultRate, resultTrend, slaStatus, smallCount, stuck, unbilledOld, unreadNotifications,
  unregistered, weekProgress, weeklyReport, type BillingMonth, type DomainEnv, type KpiValue, type ProgressionWatchItem, type WeeklyReport,
} from "../index";
import { addDays, dayOf, monday } from "../time";

/** Facit – formen som generate-facit.mjs skriver (lös typ: jämförs med toEqual). */
export type Facit = Record<string, unknown> & { meta: { now: string } };
export type ParitySection = { name: string; actual: () => unknown; expected: unknown };

const J = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const PERSONAS: [Role, string][] = [
  ["samordnare", "u-sara"], ["avtalsansvarig", "u-johan"], ["coach", "u-amira"], ["handledare", "u-petra"], ["chef", "u-karin"],
  ["ekonom", "u-lars"], ["admin", "u-robin"], ["kommun_handlaggare", "k-maria"], ["kommun_chef", "k-eva"],
];

const normKpi = (k: KpiValue) => {
  const { late, ...rest } = k;
  return late ? { ...rest, late: late.map((c) => c.id) } : rest;
};
const compactBilling = (b: BillingMonth) => ({
  ...b,
  invoices: b.invoices.map((x) => ({
    id: x.id, caseId: x.caseId, caseNumber: x.caseNumber, weeks: x.weeks.map((w) => w.key), quantity: x.quantity, unitPriceOre: x.unitPriceOre, amountOre: x.amountOre,
    accruedWeeks: x.accruedWeeks, remainingOre: x.remainingOre, status: x.status, fortnoxNo: x.fortnoxNo, blocked: x.blocked, needsApproval: x.needsApproval,
    checks: x.checks.map((c) => `${c.kind}:${c.severity}`),
  })),
});
const normWatch = (rows: ProgressionWatchItem[]) => rows.map((w) => ({ caseId: w.case.id, streak: w.streak, weeks: w.weeks, lastWeek: w.lastWeek, level: w.level }));
const normWeekly = (r: WeeklyReport) => ({
  ...r,
  sections: r.sections.map((s) => ({
    caseId: s.case.id, rows: s.rows.map((x) => ({ activityId: x.activity.id, attendanceId: x.att ? x.att.id : null })), stats: s.stats, paused: s.paused,
    deviationIds: s.deviations.map((x) => x.id), risk: s.risk,
  })),
});
const withoutHref = <T extends { href: string }>(rows: T[]) => J(rows.map(({ href, ...rest }) => (void href, rest)));

/** Alla jämförelser. `db` är hela datat (t.ex. createSeed()), `env` avtalet Botkyrka vid facits klocka. */
export function paritySections(db: Db, env: DomainEnv, facit: Facit): ParitySection[] {
  const f = facit as Record<string, Record<string, unknown>>;
  const caseById = new Map(db.cases.map((c) => [c.id, c]));
  const cs = (ids: Iterable<string>) => [...ids].map((id) => caseById.get(id)).filter((c) => c != null);
  const byCase = <V>(ids: Iterable<string>, fn: (c: Db["cases"][number]) => V | null) =>
    Object.fromEntries(cs(ids).map((c) => [c.id, fn(c)]).filter(([, v]) => v != null));
  const keys = (section: string) => Object.keys(f[section] ?? {});
  const coachIds = keys("alertsOtherCoaches");
  const today = dayOf(env.now);
  const lastMon = addDays(monday(today), -7);
  const lastSun = addDays(lastMon, 6);
  const active = db.cases.filter((c) => c.status === "active");
  const S = (name: string, expected: unknown, actual: () => unknown): ParitySection => ({ name, expected, actual });

  return [
    S("resultatgrad", f.resultRate, () => ({
      rolling_6m: resultRate(db, {}, env),
      rolling_3m: resultRate(db, { window: "rolling_3m" }, env),
      since_start: resultRate(db, { window: "since_start" }, env),
      perCoach: Object.fromEntries(Object.keys(f.resultRate.perCoach as object).map((id) => [id, resultRate(db, { coachId: id }, env)])),
      perArea: Object.fromEntries(Object.keys(f.resultRate.perArea as object).map((code) => [code, resultRate(db, { area: code, window: "since_start" }, env)])),
      december: resultRate(db, { from: "2026-12-01", to: "2026-12-31" }, env),
    })),
    S("prognos", f.resultForecast, () => resultForecast(db, env)),
    S("trend", f.resultTrend, () => J(resultTrend(db, env))),
    S("KPI:er", f.kpis, () => J({
      default: kpis(db, {}, env).map(normKpi),
      "2026-12": kpis(db, { month: "2026-12" }, env).map(normKpi),
      "2026-11": kpis(db, { month: "2026-11" }, env).map(normKpi),
      "u-amira": kpis(db, { coachId: "u-amira" }, env).map(normKpi),
    })),
    S("puls", f.pulse, () => ({
      default: pulseStats(db, {}, env),
      "u-amira": pulseStats(db, { coachId: "u-amira" }, env),
      januari: pulseStats(db, { from: "2027-01-01", to: "2027-01-31" }, env),
      sedanStart: pulseStats(db, { from: "2026-09-10" }, env),
    })),
    ...keys("billing").map((mk) => S(`fakturering ${mk}`, f.billing[mk], () => (mk === "2027-01" ? J(billingForMonth(db, mk, env)) : J(compactBilling(billingForMonth(db, mk, env)))))),
    S("ofakturerade veckor", f.unbilledOld, () => J(unbilledOld(db, env).map((x) => ({ caseId: x.case.id, week: x.week, age: x.age, status: x.status, amountOre: x.amountOre })))),
    S("beställarreferens", f.buyerRefProblem, () => byCase(db.cases.map((c) => c.id), (c) => buyerRefProblem(c, db, env.cfg))),
    S("ordervärde", f.orderValueOre, () => byCase(db.cases.map((c) => c.id), (c) => orderValueOre(c, db.price_items, env))),
    S("debiterbara veckor", f.billableWeeks, () => byCase(keys("billableWeeks"), (c) => (c.startDate ? billableWeeks(c, db, env) : null))),
    ...PERSONAS.map(([role, pid]) => S(`flaggor ${role}`, f.alerts[role], () => withoutHref(alerts(db, { role, personaId: pid }, env)))),
    S("flaggor övriga coacher", f.alertsOtherCoaches, () => Object.fromEntries(coachIds.map((id) => [id, withoutHref(alerts(db, { role: "coach", personaId: id }, env))]))),
    S("deadlines 7 dagar", f.deadlines.days7, () => withoutHref(deadlines(db, {}, env))),
    S("deadlines 30 dagar", f.deadlines.days30, () => withoutHref(deadlines(db, { days: 30 }, env))),
    S("deadlines inklusive klara", f.deadlines.includeMet, () => deadlines(db, { days: 7, includeMet: true }, env).map((x) => [x.id, x.dueAt, x.sla.tone, x.bucket])),
    S("deadlines per coach", f.deadlines.perCoach, () => Object.fromEntries(Object.keys(f.deadlines.perCoach as object).map((id) => [id, withoutHref(deadlines(db, { coachId: id }, env))]))),
    S("SLA-status", f.slaStatus, () => (f.slaStatus as unknown as { dueAt: string; metAt: string | null }[]).map((x) => ({ dueAt: x.dueAt, metAt: x.metAt, status: slaStatus(x.dueAt, x.metAt, env) }))),
    S("närvaro", f.attendance, () => ({
      januari: attendanceStats(db, null, "2027-01-01", "2027-01-31", env),
      december: attendanceStats(db, null, "2026-12-01", "2026-12-31", env),
      lastWeekPerCase: byCase(db.cases.map((c) => c.id), (c) => { const s = attendanceStats(db, c.id, lastMon, lastSun, env); return s.planned ? s : null; }),
      sinceStartPerActive: byCase(active.map((c) => c.id), (c) => attendanceStats(db, c.id, c.startDate ?? "", today, env)),
    })),
    S("oregistrerad närvaro", f.unregistered, () => ({
      lastWeek: Object.fromEntries(coachIds.map((id) => [id, unregistered(db, id, lastMon, lastSun, env).map((x) => ({ activityId: x.activity.id, caseId: x.case.id }))])),
      lastWeekToToday: Object.fromEntries(coachIds.map((id) => [id, unregistered(db, id, lastMon, today, env).map((x) => ({ activityId: x.activity.id, caseId: x.case.id }))])),
    })),
    S("upprepad frånvaro", f.repeatedAbsence, () => byCase(active.map((c) => c.id), (c) => repeatedAbsence(db, c.id, env)?.map((x) => x.id) ?? null)),
    S("fas sedan", f.phaseSince, () => byCase(active.map((c) => c.id), (c) => phaseSince(c, db))),
    S("fastnat", f.stuck, () => byCase(db.cases.map((c) => c.id), (c) => stuck(c, db, env))),
    S("veckor utan progression", f.noProgressStreak, () => byCase(active.map((c) => c.id), (c) => { const s = noProgressStreak(c, db, env); return s.streak ? s : null; })),
    S("progression per vecka", f.weekProgress, () => byCase(keys("weekProgress"), (c) => {
      const w = ["2027-W01", "2027-W02", "2027-W03", "2027-W04", "2027-W05"].map((k) => weekProgress(c, k, db));
      return w.some(Boolean) ? w : null;
    })),
    S("progressionsbevakning", f.progressionWatch, () => ({ all: normWatch(progressionWatch(db, {}, env)), "u-amira": normWatch(progressionWatch(db, { coachId: "u-amira" }, env)) })),
    S("notiser", f.notifications, () => Object.fromEntries(keys("notifications").map((k) => {
      const [role, pid] = k.split(":") as [Role, string];
      return [k, J(notificationsFor(db, pid, role, env))];
    }))),
    S("olästa notiser", f.unreadNotifications, () => Object.fromEntries(keys("unreadNotifications").map((k) => {
      const [role, pid] = k.split(":") as [Role, string];
      return [k, unreadNotifications(db, pid, role, env)];
    }))),
    S("veckorapporter", f.weeklyReport, () => Object.fromEntries(keys("weeklyReport").map((k) => {
      const [recipient, week] = k.split(":");
      return [k, J(normWeekly(weeklyReport(db, recipient, week, env)))];
    }))),
    S("beställarrapport", f.customerSummary, () => Object.fromEntries(keys("customerSummary").map((mk) => [mk, J(customerSummary(db, mk, env))]))),
    S("färre än 5", facit.customerSummarySmall, () => [0, 1, 4, 5, 12].map((n) => smallCount(n, env.cfg.pulse.minNForAggregate))),
    S("svar på avrop", f.avropDue, () => byCase(keys("avropDue"), (c) => avropDue(c, env.cfg))),
    S("första möte", f.firstMeetingDue, () => byCase(keys("firstMeetingDue"), (c) => firstMeetingDue(c, env.cfg))),
    S("ordererkännande", f.ackTextFor, () => byCase(keys("ackTextFor"), (c) => ackTextFor(c, env.cfg))),
    S("väntar på svar", facit.awaitingAnswer, () => awaitingAnswer(db).map((c) => c.id)),
    S("inkorg", facit.inbox, () => inboxEmails(db).map((e) => e.id)),
    S("nästa ärendenummer", facit.previewNextCaseNumber, () => previewNextCaseNumber(db, env)),
    S("fakturastatus", f.invoiceStatus, () => Object.fromEntries(keys("invoiceStatus").map((k) => {
      const [mk, id] = [k.slice(0, 7), k.slice(8)];
      return [k, invoiceStatus(db, mk, id)];
    }))),
  ];
}
