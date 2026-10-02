// Tar fram facit för paritetstestet (src/core/parity.test.ts) ur den GAMLA prototypen (prototyp/src/00–03).
// Prototypens kärna laddas i Node med en fejkad window, seeden körs och selektorerna i MM.sel anropas.
// Resultaten normaliseras till den nya kodens fältnamn (number -> caseNumber, area -> areaCode, radobjekt -> id).
//
// Kör: node src/core/parity/generate-facit.mjs   (skriver src/core/parity/facit.json)
// Obs: prototyp/tools/data-samples.json är äldre än prototypens nuvarande seed och stämmer inte längre helt –
// därför tas facit fram direkt ur prototypens kod.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const protoSrc = path.resolve(here, "../../../prototyp/src");

function loadProto() {
  const noop = () => {};
  const g = { console, setTimeout: () => 0, clearTimeout: noop, localStorage: { getItem: () => null, setItem: noop, removeItem: noop, clear: noop } };
  g.window = g;
  g.htmPreact = { html: noop, h: noop, render: noop, useState: () => [0, noop], useEffect: noop, useMemo: (f) => f(), useRef: () => ({}), useCallback: (f) => f, useReducer: noop, useLayoutEffect: noop, useErrorBoundary: noop, createContext: noop, useContext: noop };
  vm.createContext(g);
  for (const f of ["00-core.js", "01-seed.js", "02-store.js", "03-domain.js"]) vm.runInContext(fs.readFileSync(path.join(protoSrc, f), "utf8"), g, { filename: f });
  g.MM.initState();
  return g.MM;
}

const MM = loadProto();
const sel = MM.sel;
const d = MM.d;
const st = MM.store.state;
const J = (x) => JSON.parse(JSON.stringify(x));

const PERSONAS = [
  ["samordnare", "u-sara"], ["avtalsansvarig", "u-johan"], ["coach", "u-amira"], ["handledare", "u-petra"], ["chef", "u-karin"],
  ["ekonom", "u-lars"], ["admin", "u-robin"], ["kommun_handlaggare", "k-maria"], ["kommun_chef", "k-eva"],
];
const COACHES = st.users.filter((u) => u.role === "coach").map((u) => u.id);
const HANDLAGGARE = st.customerUsers.filter((u) => u.role === "handlaggare").map((u) => u.id);
const MONTHS = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"];
const today = d.today();
const lastMon = d.addDays(d.monday(today), -7);
const lastSun = d.addDays(lastMon, 6);

// ---------------------------------------------------------------- normalisering
const normKpi = (k) => { const { late, ...rest } = k; return late ? { ...rest, late: late.map((c) => c.id) } : rest; };
const normInvoice = (x) => { const { number, area, ...rest } = x; return { ...rest, caseNumber: number, areaCode: area }; };
const normBilling = (b) => ({ ...b, invoices: b.invoices.map(normInvoice) });
/** Kompakt form för månader som inte jämförs i detalj: veckorna som nycklar. */
const compactBilling = (b) => ({
  ...b,
  invoices: b.invoices.map((x) => ({
    id: x.id, caseId: x.caseId, caseNumber: x.number, weeks: x.weeks.map((w) => w.key), quantity: x.quantity, unitPriceOre: x.unitPriceOre, amountOre: x.amountOre,
    accruedWeeks: x.accruedWeeks, remainingOre: x.remainingOre, status: x.status, fortnoxNo: x.fortnoxNo, blocked: x.blocked, needsApproval: x.needsApproval,
    checks: x.checks.map((c) => `${c.kind}:${c.severity}`),
  })),
});
const normUnbilled = (rows) => rows.map((x) => ({ caseId: x.case.id, week: x.week, age: x.age, status: x.status, amountOre: x.amountOre }));
const normWatch = (rows) => rows.map((w) => ({ caseId: w.case.id, streak: w.streak, weeks: w.weeks, lastWeek: w.lastWeek, level: w.level }));
const normWeekly = (r) => ({
  ...r,
  sections: r.sections.map((s) => ({ caseId: s.case.id, rows: s.rows.map((x) => ({ activityId: x.activity.id, attendanceId: x.att ? x.att.id : null })), stats: s.stats, paused: s.paused, deviationIds: s.deviations.map((x) => x.id), risk: s.risk })),
});
const normSummary = (s) => { const { small, ...rest } = s; void small; return J(rest); };

const byCase = (fn, cases) => Object.fromEntries(cases.map((c) => [c.id, fn(c)]).filter(([, v]) => v != null));

const activeCases = st.cases.filter((c) => c.status === "active");
const facit = {
  meta: { now: d.now(), source: "prototyp/src/00-core.js, 01-seed.js, 02-store.js, 03-domain.js", counts: Object.fromEntries(Object.entries(st).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])) },
  resultRate: {
    rolling_6m: sel.resultRate(),
    rolling_3m: sel.resultRate({ window: "rolling_3m" }),
    since_start: sel.resultRate({ window: "since_start" }),
    perCoach: Object.fromEntries(COACHES.map((id) => [id, sel.resultRate({ coachId: id })])),
    perArea: Object.fromEntries(st.areas.map((a) => [a.code, sel.resultRate({ area: a.code, window: "since_start" })])),
    december: sel.resultRate({ from: "2026-12-01", to: "2026-12-31" }),
  },
  resultForecast: sel.resultForecast(),
  resultTrend: sel.resultTrend(),
  kpis: {
    default: sel.kpis().map(normKpi),
    "2026-12": sel.kpis({ month: "2026-12" }).map(normKpi),
    "2026-11": sel.kpis({ month: "2026-11" }).map(normKpi),
    "u-amira": sel.kpis({ coachId: "u-amira" }).map(normKpi),
  },
  pulse: {
    default: sel.pulseStats(),
    "u-amira": sel.pulseStats({ coachId: "u-amira" }),
    januari: sel.pulseStats({ from: "2027-01-01", to: "2027-01-31" }),
    sedanStart: sel.pulseStats({ from: "2026-09-10" }),
  },
  billing: Object.fromEntries(MONTHS.map((mk) => [mk, mk === "2027-01" ? normBilling(sel.billingForMonth(mk)) : compactBilling(sel.billingForMonth(mk))])),
  unbilledOld: normUnbilled(sel.unbilledOld()),
  buyerRefProblem: byCase((c) => sel.buyerRefProblem(c), st.cases),
  orderValueOre: byCase((c) => sel.orderValueOre(c), st.cases),
  billableWeeks: byCase((c) => (c.startDate ? sel.billableWeeks(c) : null), st.cases.filter((c) => Object.values(st.script).includes(c.id))),
  alerts: Object.fromEntries(PERSONAS.map(([role, pid]) => [role, J(sel.alerts({ role, personaId: pid }))])),
  alertsOtherCoaches: Object.fromEntries(COACHES.map((id) => [id, J(sel.alerts({ role: "coach", personaId: id }))])),
  deadlines: {
    days7: J(sel.deadlines()),
    days30: J(sel.deadlines({ days: 30 })),
    includeMet: sel.deadlines({ days: 7, includeMet: true }).map((x) => [x.id, x.dueAt, x.sla.tone, x.bucket]),
    perCoach: Object.fromEntries(COACHES.map((id) => [id, J(sel.deadlines({ coachId: id }))])),
  },
  slaStatus: [
    ["2027-02-01T10:05", null], ["2027-02-01T09:00", null], ["2027-01-29T23:59", null], ["2027-02-01T15:20", null], ["2027-02-01T11:12", null],
    ["2027-02-01T11:13", null], ["2027-02-01T17:12", null], ["2027-02-01T17:13", null], ["2027-02-05T23:59", null], ["2027-01-20T12:00", null],
    ["2027-02-01T10:00", "2027-02-01T09:40"], ["2027-02-01T10:00", "2027-02-01T12:25"], ["2027-01-10T10:00", "2027-01-13T09:00"],
  ].map(([due, met]) => ({ dueAt: due, metAt: met, status: sel.slaStatus(due, met) })),
  attendance: {
    januari: sel.attendanceStats(null, "2027-01-01", "2027-01-31"),
    december: sel.attendanceStats(null, "2026-12-01", "2026-12-31"),
    lastWeekPerCase: byCase((c) => { const s = sel.attendanceStats(c.id, lastMon, lastSun); return s.planned ? s : null; }, st.cases),
    sinceStartPerActive: byCase((c) => sel.attendanceStats(c.id, c.startDate, today), activeCases),
  },
  unregistered: {
    lastWeek: Object.fromEntries(COACHES.map((id) => [id, sel.unregistered(id, lastMon, lastSun).map((x) => ({ activityId: x.activity.id, caseId: x.case.id }))])),
    lastWeekToToday: Object.fromEntries(COACHES.map((id) => [id, sel.unregistered(id, lastMon, today).map((x) => ({ activityId: x.activity.id, caseId: x.case.id }))])),
  },
  repeatedAbsence: byCase((c) => { const r = sel.repeatedAbsence(c.id); return r ? r.map((x) => x.id) : null; }, activeCases),
  phaseSince: byCase((c) => sel.phaseSince(c), activeCases),
  stuck: byCase((c) => sel.stuck(c), st.cases),
  noProgressStreak: byCase((c) => { const s = sel.noProgressStreak(c); return s.streak ? s : null; }, activeCases),
  weekProgress: byCase((c) => { const w = ["2027-W01", "2027-W02", "2027-W03", "2027-W04", "2027-W05"].map((k) => sel.weekProgress(c, k)); return w.some(Boolean) ? w : null; }, st.cases.filter((c) => Object.values(st.script).includes(c.id))),
  progressionWatch: { all: normWatch(sel.progressionWatch()), "u-amira": normWatch(sel.progressionWatch({ coachId: "u-amira" })) },
  notifications: Object.fromEntries([...PERSONAS, ...COACHES.filter((id) => id !== "u-amira").map((id) => ["coach", id])].map(([role, pid]) => [`${role}:${pid}`, J(sel.notificationsFor(pid, role))])),
  unreadNotifications: Object.fromEntries([...PERSONAS, ...COACHES.map((id) => ["coach", id])].map(([role, pid]) => [`${role}:${pid}`, sel.unreadNotifications(pid, role)])),
  weeklyReport: Object.fromEntries([...HANDLAGGARE.flatMap((k) => ["2027-W04", "2027-W05"].map((w) => [k, w])), ["k-linda", "2026-W47"]].map(([k, w]) => [`${k}:${w}`, normWeekly(sel.weeklyReport(k, w))])),
  customerSummary: Object.fromEntries(["2026-10", "2026-12", "2027-01"].map((mk) => [mk, normSummary(sel.customerSummary(mk))])),
  customerSummarySmall: [0, 1, 4, 5, 12].map((n) => sel.customerSummary("2027-01").small(n)),
  avropDue: byCase((c) => sel.avropDue(c), st.cases.filter((c) => c.referredAt >= "2027-01-01")),
  firstMeetingDue: byCase((c) => sel.firstMeetingDue(c), st.cases.filter((c) => c.referredAt >= "2027-01-01")),
  ackTextFor: byCase((c) => sel.ackTextFor(c), sel.awaitingAnswer()),
  awaitingAnswer: sel.awaitingAnswer().map((c) => c.id),
  inbox: sel.inbox().map((e) => e.id),
  previewNextCaseNumber: sel.previewNextCaseNumber(),
  invoiceStatus: Object.fromEntries(MONTHS.flatMap((mk) => ["case-260117", "case-260121", "case-260001", "case-270003"].map((id) => [`${mk}:${id}`, sel.invoiceStatus(mk, id)]))),
};

const out = path.join(here, "facit.json");
fs.writeFileSync(out, JSON.stringify(facit) + "\n");
console.log(`Skrev ${out} (${Math.round(fs.statSync(out).size / 1024)} kB)`);
