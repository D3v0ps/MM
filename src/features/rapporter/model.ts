// Rapportens innehåll som en modell (ren data) – port av prototypens MM.reports.modelFor (views/rapporter.js).
// Rena funktioner utan I/O: hanterarna läser data (load.ts) och anropar funktionerna här med ctx.now().
//
// Regler (CLAUDE.md punkt 6): rapporter byggs bara av godkända uppgifter – registrerad närvaro, godkända avstämningar och
// godkända månadsbedömningar. Utkast byggs ur dagens data. En levererad rapport är fryst: den visas från ögonblicksbilden
// (reports.snapshot) och annars av de uppgifter som fanns vid leveransen (närvaro registrerad senast vid leveransen,
// avstämningar godkända senast då osv.). Beställarrapporten innehåller aldrig det interna målet.
//
// Modellen innehåller inga namn på deltagare och inga personnummer – bara ärendenummer och id:n. Namnet läggs till per
// läsare i vy-modellen (behörigheten avgör om det är namnet eller "Skyddade personuppgifter").
import { levelIsClear, progressionFlags, type OperationalConfig } from "@/core/config";
import { activitiesOf, attendanceFor, byId, groupedBy } from "@/core/db-index";
import { pct } from "@/core/format";
import { kpiValue, type KpiDb } from "@/core/kpi";
import { areaName, endReasonLabel, eventLabel, personName } from "@/core/labels";
import { priceFor } from "@/core/cases";
import { addDays, addMonths, dayOf, diffDays, isoWeek, MONTHS, monday, monthEnd, monthKey, monthName, weekMonday, type LocalDate, type LocalDateTime, type MonthKey } from "@/core/time";
import { by, groupBy, sum, uniq } from "@/core/util";
import type { AttendanceStatus, Case, Db, MonthlyAssessment, MonthlyPlan, Report, ReportKind, TrafficLight } from "@/data/schema";
import { dayMonth, dFull, dtFull, isDelivered, joinSv, lcfirst, plain, smallN, ucfirst, wdFull } from "./report-helpers";
import { FACTS_VERSION, parseFacts, type FinalFacts, type MonthlyFacts, type ReportFacts } from "./facts";
export { smallN };

// ================================================================ Indata
/** Tabellerna som modellerna byggs av. Tabeller som inte behövs för rapporttypen kan vara tomma. */
export type ReportDb = Pick<
  Db,
  | "cases" | "activities" | "attendance" | "check_ins" | "monthly_assessments" | "monthly_plans" | "outcome_events" | "deviations" | "tasks"
  | "audit_log" | "contract_deviations" | "pulse_responses" | "contract_areas" | "profiles" | "price_items" | "reports"
>;

export type ReportEnv = {
  cfg: OperationalConfig;
  contract: { id: string; startsOn: LocalDate; supplierName: string };
  /** ctx.now() */
  now: LocalDateTime;
  /** Aktivitetstyperna i checklistan (exempel som stäms av mot mall 02). */
  activityTypes: readonly string[];
};

// ================================================================ Modellerna
export type AttStats = {
  planned: number; present: number; late: number; absentValid: number; absentInvalid: number; unregistered: number;
  reasons: Record<string, number>; rate: number | null;
};
export type Repeated = { hit: boolean; count: number; absentInvalid: number; withinDays: number };
export type AttRow = { key: string; label: string; sub?: string; st: AttStats; paused: boolean };
export type ActivityModel = { types: string[]; done: string[] };
export type EventRow = { id: string; date: string; label: string; actor: string; basis: string };
export type DeviationItem = { id: string; description: string; date: string; status: string; assessment: string; action: string; follow: string };
export type DeviationModel = { items: DeviationItem[]; repeated: Repeated; decision: string };
export type ProgressionRow = { key: string; label: string; level: string; observation: string; nextStep: string };
export type AssessmentModel = { overallStatus: TrafficLight | null; summary: string; coach: string; date: string };
export type Kv = [string, string];

export type MonthlyModel = {
  kind: "monthly"; caseId: string; caseNumber: string; month: MonthKey; approved: boolean; basics: Kv[];
  weeks: AttRow[]; total: AttStats; reasons: string; repeated: Repeated; activities: ActivityModel; docText: string;
  progression: { scale: string; rows: ProgressionRow[] } | null; events: EventRow[]; deviations: DeviationModel;
  nextMonth: string; plan: Kv[] | null; assessment: AssessmentModel | null;
};
export type FinalModel = {
  kind: "final"; caseId: string; caseNumber: string; period: string; basics: Kv[];
  months: AttRow[]; total: AttStats; reasons: string; repeated: Repeated; activities: ActivityModel; docText: string;
  progression: { firstMonth: string; lastMonth: string; rows: { key: string; label: string; first: number | string; last: number | string; observation: string }[] } | null;
  resultText: string; events: EventRow[]; deviations: DeviationModel; obstacles: string; recommendation: string; assessment: AssessmentModel | null;
};
export type WeeklyRow = { id: string; startsAt: LocalDateTime; kind: string; status: AttendanceStatus | null; reason: string };
export type WeeklySection = { caseId: string; caseNumber: string; stats: AttStats; paused: boolean; rows: WeeklyRow[]; actions: string[]; risk: string };
export type WeeklyModel = { kind: "weekly_attendance"; week: string; recipientUserId: string; now: LocalDateTime; sections: WeeklySection[] };
export type OrderModel = {
  kind: "order_confirmation"; caseId: string; caseNumber: string; area: string; track: string; start: string; coach: string; firstMeeting: string;
  weeks: number | null; plannedEnd: string | null; price: number; buyerReference: string | null; purchaseOrderNumber: string | null;
};
export type RateModel = { value: number | null; num: number; den: number; prelim: number };
export type SummaryModel = {
  kind: "customer_summary"; month: MonthKey; minN: number; resultMinN: number; active: number; started: number; closed: number;
  byArea: { code: string; name: string; active: number; started: number; closed: number }[];
  byTrack: { track: string; active: number }[];
  result: { month: RateModel; rolling: RateModel; sinceStart: RateModel; contractTarget: number };
  progression: { assessed: number; clear: number; areaDist: { key: string; label: string; clear: number; n: number }[] };
  attendance: AttStats; attendanceRate: number | null; deviations: number; contractDeviations: number;
  pulse: { responses: number; satisfaction: number | null; enough: boolean; period: string };
  contractorName: string; sla: Kv[] | null; summary: string | null;
};
export type ReportModel = MonthlyModel | FinalModel | WeeklyModel | OrderModel | SummaryModel;

/** Rapporttyper som har ett dokument. */
export const DOC_KINDS = ["monthly", "final", "weekly_attendance", "order_confirmation", "customer_summary"] as const satisfies readonly ReportKind[];
export const hasDocument = (kind: ReportKind): boolean => (DOC_KINDS as readonly string[]).includes(kind);

// ================================================================ Datakälla: dagens data eller data som vid leveransen
type Src = {
  db: ReportDb;
  asOf: LocalDateTime | null;
  now: LocalDateTime;
  /** Dagens datum enligt klockan (orderbekräftelsens pris). */
  today: LocalDate;
  ok(t: string | null | undefined): boolean;
  caseById(id: string | null): Case | null;
  endOf(c: Case): LocalDate | null;
  closed(c: Case): boolean;
  att(activityId: string): ReportDb["attendance"][number] | null;
  checkIns(caseId: string, from: LocalDate, to: LocalDate): ReportDb["check_ins"];
  assessment(caseId: string, mk: MonthKey): MonthlyAssessment | null;
  approved(m: MonthlyAssessment | null): m is MonthlyAssessment;
  assessments(caseId: string): MonthlyAssessment[];
  plan(caseId: string, mk: MonthKey): MonthlyPlan | null;
  events(caseId: string, from: LocalDate, to: LocalDate): ReportDb["outcome_events"];
  deviations(caseId: string): ReportDb["deviations"];
  taskFor(deviationId: string): ReportDb["tasks"][number] | null;
};

/**
 * Datakällan. asOf = leveranstidpunkten (bara uppgifter som fanns då räknas). since = räkna också med uppgifter som
 * ändrats efter den tidpunkten (för att upptäcka att underlaget ändrats efter att rapporten frystes).
 */
function makeSrc(db: ReportDb, env: ReportEnv, asOf: LocalDateTime | null, since: LocalDateTime | null = null): Src {
  const ok = (t: string | null | undefined) => !asOf || !t || t <= asOf || (since != null && t >= since);
  const cases = byId(db.cases);
  const ci = groupedBy(db.check_ins, "caseId", (x) => x.caseId);
  const ma = groupedBy(db.monthly_assessments, "caseId", (x) => x.caseId);
  const ev = groupedBy(db.outcome_events, "caseId", (x) => x.caseId);
  const dev = groupedBy(db.deviations, "caseId", (x) => x.caseId);
  // Sista raden vinner, som prototypens index.
  const added = new Map<string, string>();
  for (const l of db.audit_log) if (l.action === "event.added" && l.entityId) added.set(l.entityId, l.occurredAt);
  const plans = new Map<string, MonthlyPlan>();
  for (const p of db.monthly_plans) plans.set(`${p.caseId}:${p.month}`, p);
  const tasks = new Map<string, ReportDb["tasks"][number]>();
  for (const t of db.tasks) if (t.deviationId) tasks.set(t.deviationId, t);
  const src: Src = {
    db, asOf, now: asOf || env.now, today: dayOf(env.now), ok,
    caseById: (id) => (id ? cases.get(id) ?? null : null),
    endOf: (c) => (c.endDate && (!asOf || !c.closedAt || c.closedAt <= asOf) ? c.endDate : null),
    closed: (c) => c.status === "closed" && ok(c.closedAt),
    att: (aid) => {
      const x = attendanceFor(db, aid);
      return x && ok(x.registeredAt) ? x : null;
    },
    checkIns: (cid, from, to) =>
      (ci.get(cid) ?? []).filter((x) => x.status === "approved" && ok(x.approvedAt) && dayOf(x.heldAt) >= from && dayOf(x.heldAt) <= to).sort(by("heldAt")),
    assessment: (cid, mk) => (ma.get(cid) ?? []).find((x) => x.month === mk) ?? null,
    approved: (m): m is MonthlyAssessment => !!m && m.status === "approved" && ok(m.decidedAt),
    assessments: (cid) => (ma.get(cid) ?? []).filter((m) => m.status === "approved" && ok(m.decidedAt)).sort(by("month")),
    plan: (cid, mk) => plans.get(`${cid}:${mk}`) ?? null,
    events: (cid, from, to) =>
      (ev.get(cid) ?? []).filter((e) => e.occurredOn >= from && e.occurredOn <= to && ok(e.occurredOn) && ok(added.get(e.id))).sort(by("occurredOn")),
    deviations: (cid) => (dev.get(cid) ?? []).filter((x) => ok(x.createdAt)).sort(by("createdAt", -1)),
    taskFor: (id) => {
      const t = tasks.get(id);
      return t && ok(t.createdAt) ? t : null;
    },
  };
  return src;
}

// ================================================================ Byggstenar
const maxS = (a: string, b: string) => (a > b ? a : b);
const minS = (a: string, b: string) => (a < b ? a : b);
const profileName = (db: ReportDb, id: string | null | undefined) => personName(db.profiles, id);
/** "Maria Ekdahl, Arbetsmarknadsenheten Alby" */
export const personWithUnit = (db: Pick<ReportDb, "profiles">, id: string | null | undefined): string => {
  const unit = id ? byId(db.profiles).get(id)?.customerUnit ?? "" : "";
  return `${personName(db.profiles, id)}${unit ? `, ${unit}` : ""}`;
};
const phaseText = (cfg: OperationalConfig, n: number) => plain(`Fas ${n} · ${cfg.phases.find((p) => p.no === n)?.name ?? "–"}`);

/** Närvarostatistik (samma regler som attendanceStats i src/core, men mot vald datakälla). caseId null = alla aktiviteter. */
function attStats(src: Src, caseId: string | null, from: LocalDate, to: LocalDate): AttStats {
  const acts = (caseId ? activitiesOf(src.db, caseId) : src.db.activities).filter((a) => dayOf(a.startsAt) >= from && dayOf(a.startsAt) <= to && a.startsAt < src.now);
  const r: AttStats = { planned: acts.length, present: 0, late: 0, absentValid: 0, absentInvalid: 0, unregistered: 0, reasons: {}, rate: null };
  for (const a of acts) {
    const at = src.att(a.id);
    if (!at) {
      r.unregistered++;
      continue;
    }
    if (at.status === "present") r.present++;
    else if (at.status === "late") r.late++;
    else if (at.status === "absent_valid") {
      r.absentValid++;
      r.reasons[at.reason] = (r.reasons[at.reason] || 0) + 1;
    } else r.absentInvalid++;
  }
  const registered = r.planned - r.unregistered;
  r.rate = registered ? (r.present + r.late) / registered : null;
  return r;
}

/** Två eller fler ogiltiga frånvarotillfällen inom avtalets fönster (Botkyrka: 14 dagar) under perioden. */
function repeatedIn(src: Src, cfg: OperationalConfig, caseId: string, from: LocalDate, to: LocalDate): Repeated {
  const rule = cfg.attendance.repeatedAbsenceRule;
  const dates = activitiesOf(src.db, caseId)
    .filter((a) => dayOf(a.startsAt) >= from && dayOf(a.startsAt) <= to && a.startsAt < src.now)
    .filter((a) => src.att(a.id)?.status === "absent_invalid")
    .map((a) => dayOf(a.startsAt));
  const n = rule.absentInvalid;
  const hit = dates.some((x, i) => i + n - 1 < dates.length && diffDays(x, dates[i + n - 1]) <= rule.withinDays);
  return { hit, count: dates.length, absentInvalid: rule.absentInvalid, withinDays: rule.withinDays };
}

/** Textbeskrivning av aktiviteterna från godkända avstämningar (i fas 2 ett AI-utkast som coachen godkänner). */
function docText(cis: ReportDb["check_ins"], label: string): string {
  if (!cis.length) return `Inga godkända veckoavstämningar finns för ${label}.`;
  const acts = uniq(cis.flatMap((x) => (Array.isArray(x.activitiesDone) ? x.activitiesDone : [])));
  const contacts = sum(cis, (x) => parseInt(String(x.employerContacts?.count ?? ""), 10) || 0);
  const types = uniq(cis.flatMap((x) => x.employerContacts?.types ?? []));
  const g = { yes: 0, partly: 0, no: 0 };
  for (const x of cis) if (typeof x.goalStatus === "string" && x.goalStatus in g) g[x.goalStatus as keyof typeof g]++;
  const times = (n: number) => `${n} ${n === 1 ? "gång" : "gånger"}`;
  return [
    `Under ${label} genomfördes ${cis.length} godkända veckoavstämningar.`,
    acts.length ? `Deltagaren har arbetat med ${joinSv(acts.map((a) => plain(lcfirst(a))))}.` : "",
    `Arbetsgivarkontakter: ${contacts}${types.length ? ` (${types.join(", ")})` : ""}.`,
    `Veckomålet uppnåddes ${times(g.yes)}, delvis ${times(g.partly)} och inte ${times(g.no)}.`,
  ].filter(Boolean).join(" ");
}
const reasonsText = (reasons: Record<string, number>) => {
  const xs = Object.entries(reasons || {}).map(([k, v]) => `${lcfirst(k)} ${v}`);
  return xs.length ? xs.join(", ") : "inga";
};
const activityModel = (env: ReportEnv, cis: ReportDb["check_ins"]): ActivityModel => {
  const done = uniq(cis.flatMap((x) => (Array.isArray(x.activitiesDone) ? x.activitiesDone : [])));
  return { types: [...(env.activityTypes.length ? env.activityTypes : done)], done };
};
const eventRows = (evs: ReportDb["outcome_events"]): EventRow[] =>
  evs.map((e) => ({ id: e.id, date: dFull(e.occurredOn), label: eventLabel(e.kind), actor: e.actor || "–", basis: e.verificationKind ? ucfirst(e.verificationKind) : e.note || "Inte verifierat" }));
function deviationModel(src: Src, devs: ReportDb["deviations"], rep: Repeated): DeviationModel {
  const needs = devs.filter((x) => x.needsCustomerDecision);
  const decision =
    needs.length === 0
      ? "Nej."
      : needs.every((x) => src.taskFor(x.id))
        ? "Ja – handläggaren har fått en uppgift i portalen och ett mejl utan personuppgifter om att logga in."
        : "Ja – Miljonbemanning kontaktar handläggaren.";
  return {
    items: devs.map((x) => ({
      id: x.id, description: x.description, date: dFull(x.createdAt), status: x.status === "open" ? "Pågår" : "Avslutad", assessment: x.assessment || "", action: x.action || "Framgår inte",
      follow: `Ansvarig: ${profileName(src.db, x.ownerId)}${x.followUpOn ? ` · Uppföljning ${dFull(x.followUpOn)}` : ""}${x.followUpMeetingAt ? ` · Möte med kommunen ${dtFull(x.followUpMeetingAt)}` : ""}`,
    })),
    repeated: rep,
    decision,
  };
}
function progressionModel(cfg: OperationalConfig, ma: MonthlyAssessment): NonNullable<MonthlyModel["progression"]> {
  const p = cfg.progression;
  const scale = p.scale as Record<string, string>;
  const keys = [...p.areas, ...(p.optionalAreas || []).filter((k) => ma.areas[k] && ma.areas[k].level != null)];
  return {
    scale: Object.entries(scale).map(([k, v]) => `${k} = ${lcfirst(v)}`).join(" · "),
    rows: keys.map((k) => {
      const a = ma.areas[k];
      return {
        key: k, label: p.areaLabels[k] || k, level: a && a.level != null ? `${a.level} – ${lcfirst(scale[String(a.level)])}` : "Ej bedömd",
        observation: a?.observation || "–", nextStep: a?.nextStep || "–",
      };
    }),
  };
}
const planModel = (plan: MonthlyPlan | null): Kv[] | null =>
  plan
    ? [
        ["Mål 1", plan.goal1 || "Framgår inte"], ["Mål 2", plan.goal2 || "Framgår inte"], ["Planerade aktiviteter", plan.plannedActivities || "Framgår inte"],
        ["Planerad arbetsgivarkontakt", plan.plannedEmployerContact || "Inget planerat"], ["Anpassning", plan.plannedAdaptation || "Ingen särskild anpassning"],
        ["Nästa uppföljning med kommunen", plan.nextCustomerMeeting ? dFull(plan.nextCustomerMeeting) : "Inte bokad"],
      ]
    : null;

// ================================================================ Månadsrapport individ (mall 02, avsnitt 1–8)
/**
 * Veckoraderna i avsnitt 2: ISO-veckor som helt eller delvis ligger i månaden och under insatsen (uppehållsveckorna
 * inräknade). Samma rader i modellen, i fakta (weeks, pausedWeeks) och i månadsunderlaget (monthlyGaps).
 */
function monthWeeks(src: Src, c: Case, mk: MonthKey, end: LocalDate | null): AttRow[] {
  const from = `${mk}-01`;
  const to = monthEnd(mk);
  const weeks: AttRow[] = [];
  for (let mon = monday(from); mon <= to; mon = addDays(mon, 7)) {
    const wFrom = maxS(mon, from);
    const wTo = minS(addDays(mon, 6), to);
    if (c.startDate && wTo < c.startDate) continue;
    if (end && wFrom > end) continue;
    const wk = isoWeek(mon);
    weeks.push({ key: wk.key, label: `Vecka ${wk.week}`, sub: wFrom === wTo ? dayMonth(wFrom) : `${dayMonth(wFrom)} – ${dayMonth(wTo)}`, st: attStats(src, c.id, wFrom, wTo), paused: c.pausedWeeks.includes(wk.key) });
  }
  return weeks;
}

/** Avvikelserna i avsnitt 6: skapade senast vid månadens slut och antingen skapade i månaden eller fortfarande öppna. */
const monthDeviations = (src: Src, caseId: string, from: LocalDate, to: LocalDate) =>
  src.deviations(caseId).filter((x) => dayOf(x.createdAt) <= to && (dayOf(x.createdAt) >= from || x.status === "open"));

function buildMonthly(src: Src, env: ReportEnv, r: Report): MonthlyModel | null {
  const c = src.caseById(r.caseId);
  if (!c || !r.month) return null;
  const { cfg } = env;
  const mk = r.month;
  const from = `${mk}-01`;
  const to = monthEnd(mk);
  const end = src.endOf(c);
  const maRaw = src.assessment(c.id, mk);
  const ok = src.approved(maRaw);
  const cis = src.checkIns(c.id, from, to);
  const weeks = monthWeeks(src, c, mk, end);
  const total = attStats(src, c.id, from, to);
  const rep = repeatedIn(src, cfg, c.id, from, to);
  const lastCi = cis[cis.length - 1];
  const phase = lastCi && lastCi.phase ? Number(lastCi.phase) : c.phase;
  const devs = monthDeviations(src, c.id, from, to);
  return {
    kind: "monthly", caseId: c.id, caseNumber: c.caseNumber, month: mk, approved: ok,
    basics: [
      ["Ärendenummer", c.caseNumber], ["Avtalsområde", areaName(src.db.contract_areas, c.primaryAreaCode)], ["Yrkesspår", c.vocationalTrack || "Framgår inte"], ["Insatsen startade", dFull(c.startDate)],
      [end ? "Insatsen avslutades" : "Planerat slut", dFull(end || c.plannedEnd)], ["Fas vid månadens slut", phaseText(cfg, phase)], ["Huvudcoach", profileName(src.db, c.leadCoachId)],
      ["Beställare", personWithUnit(src.db, c.referrerId)],
    ],
    weeks, total, reasons: reasonsText(total.reasons), repeated: rep,
    activities: activityModel(env, cis), docText: docText(cis, monthName(mk)),
    progression: ok ? progressionModel(cfg, maRaw) : null,
    events: eventRows(src.events(c.id, from, to)),
    deviations: deviationModel(src, devs, rep),
    nextMonth: monthName(addMonths(mk, 1)), plan: ok ? planModel(src.plan(c.id, mk)) : null,
    assessment: ok ? { overallStatus: maRaw.overallStatus, summary: maRaw.summary || "Framgår inte.", coach: profileName(src.db, maRaw.decidedBy || c.leadCoachId), date: dFull(maRaw.decidedAt) } : null,
  };
}

// ================================================================ Slutrapport (hela perioden)
function defaultRecommendation(c: Case, plan: MonthlyPlan | null): string {
  if (c.endReason === "arbete") return "Deltagaren har påbörjat arbete. Ingen fortsatt insats rekommenderas.";
  if (c.endReason === "studier") return "Deltagaren har påbörjat studier. Ingen fortsatt insats rekommenderas.";
  if (plan && (plan.goal1 || plan.goal2)) return `Fortsatt arbete mot målen i den senaste planen: ${joinSv([plan.goal1, plan.goal2].filter(Boolean).map(lcfirst))}. Kommunen avgör om en ny insats ska beställas.`;
  return "Framgår inte.";
}
/** Förslag till kvarstående hinder: hindren i den senaste godkända avstämningen. */
export const obstaclesText = (obstacles: readonly string[] | null | undefined): string => (obstacles && obstacles.length ? `${ucfirst(joinSv(obstacles.map(lcfirst)))}.` : "");

function buildFinal(src: Src, env: ReportEnv, r: Report, frozen: boolean): FinalModel | null {
  const c = src.caseById(r.caseId);
  if (!c) return null;
  const end = src.endOf(c);
  const from = r.periodStart || c.startDate || "";
  const to = r.periodEnd || end || dayOf(src.now);
  const months: AttRow[] = [];
  for (let mk = monthKey(from); mk <= monthKey(to); mk = addMonths(mk, 1)) {
    const mFrom = maxS(`${mk}-01`, from);
    const mTo = minS(monthEnd(mk), to);
    months.push({ key: mk, label: ucfirst(monthName(mk)), st: attStats(src, c.id, mFrom, mTo), paused: false });
  }
  const total = attStats(src, c.id, from, to);
  const rep = repeatedIn(src, env.cfg, c.id, from, to);
  const cis = src.checkIns(c.id, from, to);
  const mas = src.assessments(c.id).filter((m) => m.month >= monthKey(from) && m.month <= monthKey(to));
  const first = mas[0];
  const last = mas[mas.length - 1];
  const lastCi = cis[cis.length - 1];
  const plan = last ? src.plan(c.id, last.month) : null;
  const ft = r.finalText;
  const obstacles = ft && ft.obstacles != null && ft.obstacles !== "" ? ft.obstacles : obstaclesText(lastCi?.obstacles) || "Inga hinder noterade i den senaste godkända avstämningen.";
  // Rekommendationen är coachens text. En levererad rapport utan sparad text (seedade) får texten fryst vid leveransen.
  const recommendation = String(ft?.recommendation || "").trim() || (frozen ? defaultRecommendation(c, plan) : "");
  const verified = !!c.resultVerifiedAt && src.ok(c.resultVerifiedAt);
  const resultText =
    c.resultClass === "result"
      ? verified
        ? `Arbete eller studier – verifierat ${dFull(c.resultVerifiedAt)}.`
        : "Arbete eller studier – väntar på verifiering. Räknas inte som resultat förrän underlaget är verifierat."
      : c.resultClass === "excluded"
        ? "Avslutet räknas inte i resultatgraden (avbrott som inte beror på insatsen)."
        : c.resultClass === "no_result"
          ? "Inget resultat enligt resultatdefinitionen."
          : "Framgår inte.";
  const p = env.cfg.progression;
  return {
    kind: "final", caseId: c.id, caseNumber: c.caseNumber, period: `${dFull(from)} – ${dFull(to)}`,
    basics: [
      ["Ärendenummer", c.caseNumber], ["Avtalsområde", areaName(src.db.contract_areas, c.primaryAreaCode)], ["Yrkesspår", c.vocationalTrack || "Framgår inte"], ["Insatsen startade", dFull(c.startDate)],
      ["Insatsen avslutades", dFull(end)], ["Avslutsorsak", endReasonLabel(c.endReason)], ["Huvudcoach", profileName(src.db, c.leadCoachId)], ["Beställare", personWithUnit(src.db, c.referrerId)],
    ],
    months, total, reasons: reasonsText(total.reasons), repeated: rep,
    activities: activityModel(env, cis), docText: docText(cis, "insatsen"),
    progression: last
      ? {
          firstMonth: monthName(first.month), lastMonth: monthName(last.month),
          rows: p.areas.map((k) => {
            const a0 = first.areas[k];
            const a1 = last.areas[k];
            return { key: k, label: p.areaLabels[k], first: a0?.level ?? "–", last: a1?.level ?? "–", observation: a1?.observation || "–" };
          }),
        }
      : null,
    resultText, events: eventRows(src.events(c.id, from, to)),
    deviations: deviationModel(src, src.deviations(c.id).filter((x) => dayOf(x.createdAt) <= to), rep),
    obstacles, recommendation,
    assessment: last ? { overallStatus: last.overallStatus, summary: last.summary || "Framgår inte.", coach: profileName(src.db, c.leadCoachId), date: dFull(r.approvedAt || last.decidedAt) } : null,
  };
}

// ================================================================ Frysta fakta för kommunens resultatfil (rapporter steg 3)
// Samma datakälla och samma regler som modellerna ovan (bara godkända uppgifter, asOf = leveransen), men bara koder, tal,
// sanningsvärden och ISO-datum – inga namn och ingen fritext (facts.ts).

/** Beställarens enhet: profilens enhet, annars ärendets (samma uppslag som behörigheten i src/core/access.ts). */
const referrerUnitOf = (src: Src, c: Case): string | null => (c.referrerId ? byId(src.db.profiles).get(c.referrerId)?.customerUnit : null) ?? c.referrerUnit ?? null;

function buildMonthlyFacts(src: Src, env: ReportEnv, r: Report): MonthlyFacts | null {
  const c = src.caseById(r.caseId);
  if (!c || !r.month) return null;
  const { cfg } = env;
  const mk = r.month;
  const from = `${mk}-01`;
  const to = monthEnd(mk);
  const end = src.endOf(c);
  const ma = src.assessment(c.id, mk);
  const ok = src.approved(ma);
  const cis = src.checkIns(c.id, from, to);
  const weeks = monthWeeks(src, c, mk, end);
  const t = attStats(src, c.id, from, to);
  const lastCi = cis[cis.length - 1];
  const phase = lastCi && lastCi.phase ? Number(lastCi.phase) : c.phase;
  const goals = { yes: 0, partly: 0, no: 0 };
  for (const x of cis) if (typeof x.goalStatus === "string" && x.goalStatus in goals) goals[x.goalStatus as keyof typeof goals]++;
  // Tydlig/någon progression bara på de obligatoriska områdena (progressionFlags filtrerar själv, beslut 2026-10-01).
  const flags = ok ? progressionFlags(cfg, ma.areas) : null;
  const allDevs = src.deviations(c.id);
  return {
    factsVersion: FACTS_VERSION, kind: "monthly", caseNumber: c.caseNumber, month: mk,
    referrerUnit: referrerUnitOf(src, c), primaryAreaCode: c.primaryAreaCode || null, secondaryAreaCode: c.secondaryAreaCode || null,
    vocationalTrack: c.vocationalTrack || null, startDate: c.startDate || null, plannedEnd: c.plannedEnd || null, endDate: end || null,
    phase: Number.isInteger(phase) && phase >= 1 ? phase : null,
    weeks: weeks.length, pausedWeeks: weeks.filter((w) => w.paused).length,
    attendance: { planned: t.planned, present: t.present, late: t.late, absentValid: t.absentValid, absentInvalid: t.absentInvalid, unregistered: t.unregistered, rate: t.rate },
    repeatedAbsence: repeatedIn(src, cfg, c.id, from, to).hit,
    checkInsApproved: cis.length,
    employerContacts: sum(cis, (x) => parseInt(String(x.employerContacts?.count ?? ""), 10) || 0),
    goals,
    assessmentApproved: ok,
    levels: ok ? Object.fromEntries(cfg.progression.areas.map((k) => [k, ma.areas[k]?.level ?? null])) : {},
    areasAssessed: flags ? flags.assessed : null,
    progressionClear: flags ? flags.clear : null,
    progressionAny: flags ? flags.any : null,
    overallStatus: ok ? ma.overallStatus : null,
    assessmentDate: ok && ma.decidedAt ? dayOf(ma.decidedAt) : null,
    events: src.events(c.id, from, to).map((e) => ({ kind: e.kind, date: e.occurredOn, verified: !!e.verificationKind })),
    deviationsNew: allDevs.filter((x) => dayOf(x.createdAt) >= from && dayOf(x.createdAt) <= to).length,
    // Öppen vid månadens slut: skapad senast då och inte stängd då (utan stängningstid: statusen, som avsnitt 6).
    deviationsOpen: allDevs.filter((x) => dayOf(x.createdAt) <= to && (x.closedAt ? dayOf(x.closedAt) > to : x.status === "open")).length,
    needsCustomerDecision: monthDeviations(src, c.id, from, to).some((x) => x.needsCustomerDecision),
  };
}

function buildFinalFacts(src: Src, r: Report): FinalFacts | null {
  const c = src.caseById(r.caseId);
  if (!c) return null;
  // Samma regler som slutrapportens resultattext (buildFinal): verifierad bara om verifieringen fanns vid leveransen.
  const verified = !!c.resultVerifiedAt && src.ok(c.resultVerifiedAt);
  return {
    factsVersion: FACTS_VERSION, kind: "final", caseNumber: c.caseNumber, endDate: src.endOf(c), endReason: c.endReason ?? null, resultClass: c.resultClass ?? null,
    resultVerified: verified, resultVerifiedAt: verified ? dayOf(c.resultVerifiedAt as string) : null,
  };
}

function buildFacts(src: Src, env: ReportEnv, r: Report): ReportFacts | null {
  if (r.kind === "monthly") return buildMonthlyFacts(src, env, r);
  if (r.kind === "final") return buildFinalFacts(src, r);
  return null;
}

/** Rapporttyper som har fakta i resultatfilen. */
export const hasFacts = (kind: ReportKind): boolean => kind === "monthly" || kind === "final";

/**
 * Rapportens fakta. Utkast: dagens data. Levererad: ögonblicksbildens fakta om de finns och är giltiga, annars de uppgifter
 * som fanns vid leveransen (ärendefälten är då dagens värden – se ensureFacts i freeze.ts).
 */
export function reportFacts(db: ReportDb, r: Report, env: ReportEnv): ReportFacts | null {
  if (!hasFacts(r.kind)) return null;
  if (!isDelivered(r)) return buildFacts(makeSrc(db, env, null), env, r);
  const frozen = r.snapshot && r.snapshot.reportId === r.id ? parseFacts(r.snapshot.facts) : null;
  if (frozen && frozen.kind === r.kind) return frozen;
  return buildFacts(makeSrc(db, env, r.deliveredAt), env, r);
}

/** Fakta som fryses i ögonblicksbilden: det som gällde vid leveransen. */
export function frozenFacts(db: ReportDb, r: Report, env: ReportEnv): ReportFacts | null {
  if (!hasFacts(r.kind) || !isDelivered(r)) return null;
  return buildFacts(makeSrc(db, env, r.deliveredAt), env, r);
}

/** Modellen och fakta i samma pass och med samma datakälla (frysningen vid leveransen). */
export function frozenModelAndFacts(db: ReportDb, r: Report, env: ReportEnv): { model: ReportModel | null; facts: ReportFacts | null } {
  if (!hasDocument(r.kind) || !isDelivered(r)) return { model: null, facts: null };
  const src = makeSrc(db, env, r.deliveredAt);
  return { model: build(src, env, r, true), facts: hasFacts(r.kind) ? buildFacts(src, env, r) : null };
}

// ================================================================ Veckorapport närvaro (en per handläggare och vecka)
function buildWeekly(src: Src, r: Report): WeeklyModel | null {
  if (!r.week || !r.recipientUserId) return null;
  const mon = weekMonday(r.week);
  const sun = addDays(mon, 6);
  const week = r.week;
  const cases = src.db.cases.filter((c) => {
    const end = src.endOf(c);
    return c.referrerId === r.recipientUserId && c.startDate && c.startDate <= sun && (!end || end >= mon);
  });
  return {
    kind: "weekly_attendance", week, recipientUserId: r.recipientUserId, now: src.now,
    sections: cases.map((c) => {
      const acts = activitiesOf(src.db, c.id).filter((a) => a.startsAt >= mon && a.startsAt <= `${sun}T23:59`);
      const stats = attStats(src, c.id, mon, sun);
      const devs = src.deviations(c.id).filter((x) => dayOf(x.createdAt) >= mon && dayOf(x.createdAt) <= sun);
      return {
        caseId: c.id, caseNumber: c.caseNumber, stats, paused: c.pausedWeeks.includes(week),
        rows: acts.map((a) => {
          const at = src.att(a.id);
          return { id: a.id, startsAt: a.startsAt, kind: a.kind, status: at ? at.status : null, reason: at ? at.reason || "" : "" };
        }),
        actions: devs.map((x) => x.action).filter(Boolean),
        risk: stats.absentInvalid >= 2 ? "Risk för avbrott – uppföljningsmöte föreslås" : stats.absentInvalid === 1 ? "Bevakas" : "Ingen risk noterad",
      };
    }),
  };
}

// ================================================================ Orderbekräftelse
function buildOrder(src: Src, r: Report): OrderModel | null {
  const c = src.caseById(r.caseId);
  if (!c) return null;
  const start = c.startDate || c.plannedStart || c.desiredStart;
  const weeks = c.orderValueWeeks || c.plannedWeeks || null;
  const coach = c.leadCoachId ? byId(src.db.profiles).get(c.leadCoachId) : null;
  return {
    kind: "order_confirmation", caseId: c.id, caseNumber: c.caseNumber, area: areaName(src.db.contract_areas, c.primaryAreaCode), track: c.vocationalTrack || "Bestäms vid kartläggningen",
    start: start ? dFull(start) : "Inte bestämt", coach: coach ? `${coach.fullName}${coach.phone ? `, telefon ${coach.phone}` : ""}` : "Inte utsedd",
    firstMeeting: c.firstMeetingAt ? `${ucfirst(wdFull(c.firstMeetingAt))}, ${c.location || "Alby"}` : "Bokas inom en vecka",
    weeks, plannedEnd: c.plannedEnd ? dFull(c.plannedEnd) : null, price: priceFor(src.db.price_items, c.primaryAreaCode, start || src.today, c.contractId),
    buyerReference: c.buyerReference || null, purchaseOrderNumber: c.purchaseOrderNumber || null,
  };
}

// ================================================================ Beställarrapport (kommunens chef)

/** Förslag till sammanfattning ur rapportens siffror (avsnitt 1–6). Nämner aldrig det interna målet. */
export function summaryFromNumbers(m: SummaryModel): string {
  const sm = (n: number) => smallN(m.minN, n);
  return `Under ${monthName(m.month)} var ${sm(m.active)} deltagare aktiva och ${sm(m.started)} nya insatser startade. ${ucfirst(sm(m.closed))} insatser avslutades, varav ${sm(m.result.month.num)} till arbete eller studier. Närvarograden var ${pct(m.attendanceRate)}. ${m.deviations > 0 ? `${ucfirst(sm(m.deviations))} avvikelser på deltagarnivå har hanterats med åtgärd.` : "Inga avvikelser på deltagarnivå registrerades."}`;
}

/** SLA-nyckeltal som kommunen ser om avtalet säger det (customerVisibility.seesSlaStats). */
const SLA_KPIS = ["avrop_besvarade_i_tid", "forsta_mote_inom_en_vecka", "veckorapporter_i_tid"] as const;

function buildSummary(src: Src, env: ReportEnv, r: Report, frozen: boolean): SummaryModel {
  const { cfg } = env;
  const mk = r.month || monthKey(r.periodStart ?? "");
  const minN = cfg.pulse.minNForAggregate;
  const start = `${mk}-01`;
  const end = monthEnd(mk);
  const all = src.db.cases.filter((c) => c.startDate);
  const active = all.filter((c) => {
    const e = src.endOf(c);
    return (c.startDate as string) <= end && (!e || e >= start);
  });
  const started = new Set(all.filter((c) => (c.startDate as string) >= start && (c.startDate as string) <= end));
  const closed = new Set(all.filter((c) => src.closed(c) && c.endDate != null && c.endDate >= start && c.endDate <= end));
  const byArea = Object.entries(groupBy(active, (c) => String(c.primaryAreaCode)))
    .map(([code, cs]) => ({ code, name: areaName(src.db.contract_areas, code), active: cs.length, started: cs.filter((c) => started.has(c)).length, closed: cs.filter((c) => closed.has(c)).length }))
    .sort(by("code"));
  const byTrack = Object.entries(groupBy(active, (c) => String(c.vocationalTrack ?? "")))
    .map(([t, cs]) => ({ track: t === "undefined" || t === "null" ? "" : t, active: cs.length }))
    .sort(by("active", -1));
  const mas = src.db.monthly_assessments.filter((m) => m.month === mk && src.approved(m));
  // Tydlig progression enligt avtalets gräns, bara på de obligatoriska områdena (beslut 2026-10-01).
  const clear = mas.filter((m) => progressionFlags(cfg, m.areas).clear).length;
  const areaDist = cfg.progression.areas.map((key) => ({
    key, label: cfg.progression.areaLabels[key], clear: mas.filter((m) => levelIsClear(cfg, m.areas[key]?.level)).length, n: mas.length,
  }));
  const att = attStats(src, null, start, end);
  const pFrom = maxS(`${addMonths(mk, -2)}-01`, `${monthKey(env.contract.startsOn)}-01`);
  const rs = src.db.pulse_responses.filter((x) => x.submittedAt >= pFrom && x.submittedAt <= `${end}T23:59` && src.ok(x.submittedAt));
  const k = cfg.kpis.find((x) => x.key === "resultatgrad");
  const rate = (from: LocalDate, to: LocalDate): RateModel => {
    const cs = src.db.cases.filter((c) => src.closed(c) && c.endDate != null && c.endDate >= from && c.endDate <= to);
    const counted = cs.filter((c) => c.resultClass !== "excluded");
    const isVer = (c: Case) => c.resultClass === "result" && !!c.resultVerifiedAt && src.ok(c.resultVerifiedAt);
    const num = counted.filter(isVer).length;
    return { value: counted.length ? num / counted.length : null, num, den: counted.length, prelim: counted.filter((c) => c.resultClass === "result" && !isVer(c)).length };
  };
  const pm = monthKey(pFrom);
  const kpiDb: KpiDb = { cases: src.db.cases, reports: src.db.reports, activities: src.db.activities, attendance: src.db.attendance, pulse_responses: src.db.pulse_responses };
  const kpiEnv = { cfg, now: env.now, contractStart: env.contract.startsOn };
  const m: SummaryModel = {
    kind: "customer_summary", month: mk, minN, resultMinN: k?.minN ?? 0, active: active.length, started: started.size, closed: closed.size, byArea, byTrack,
    result: { month: rate(start, end), rolling: rate(`${addMonths(mk, -5)}-01`, end), sinceStart: rate(env.contract.startsOn, end), contractTarget: k?.contractTarget ?? 0 },
    progression: { assessed: mas.length, clear, areaDist }, attendance: att, attendanceRate: att.rate,
    deviations: src.db.deviations.filter((x) => dayOf(x.createdAt) >= start && dayOf(x.createdAt) <= end && src.ok(x.createdAt)).length,
    contractDeviations: src.db.contract_deviations.filter((x) => dayOf(x.raisedAt) >= start && dayOf(x.raisedAt) <= end && src.ok(x.raisedAt)).length,
    pulse: {
      responses: rs.length, satisfaction: rs.length ? rs.filter((x) => x.answers.q1 >= 4).length / rs.length : null, enough: rs.length >= minN,
      period: pm === mk ? monthName(mk) : pm.slice(0, 4) === mk.slice(0, 4) ? `${MONTHS[Number(pm.slice(5)) - 1]}–${monthName(mk)}` : `${monthName(pm)} – ${monthName(mk)}`,
    },
    contractorName: env.contract.supplierName,
    sla: cfg.customerVisibility.seesSlaStats
      ? SLA_KPIS.map((key): Kv | null => {
          const v = kpiValue(kpiDb, key, { month: mk }, kpiEnv);
          return v ? [v.label, v.den ? `${pct(v.value, 0)} (${v.num} av ${v.den})` : "–"] : null;
        }).filter((x): x is Kv => x != null)
      : null,
    summary: null,
  };
  // Sammanfattningen är avtalsansvarigs godkända text. En levererad rapport utan sparad text (seedade) får texten fryst vid leveransen.
  m.summary = r.summary || (frozen ? summaryFromNumbers(m) : null);
  return m;
}

// ================================================================ Modellen för en rapport
function build(src: Src, env: ReportEnv, r: Report, frozen: boolean): ReportModel | null {
  switch (r.kind) {
    case "monthly":
      return buildMonthly(src, env, r);
    case "final":
      return buildFinal(src, env, r, frozen);
    case "weekly_attendance":
      return buildWeekly(src, r);
    case "order_confirmation":
      return buildOrder(src, r);
    case "customer_summary":
      return buildSummary(src, env, r, frozen);
    default:
      return null;
  }
}

// ================================================================ Månadsunderlaget i deltagarkortet (rapporter steg 2)
/** En rapportrad som inte finns än – bara det buildMonthly läser (ärende och månad). */
function stubReport(caseId: string, month: MonthKey): Report {
  return {
    id: `preview:${caseId}:${month}`, contractId: "", caseId, recipientUserId: null, kind: "monthly", week: null, month, periodStart: `${month}-01`, periodEnd: monthEnd(month),
    status: "draft", version: 1, dueAt: null, approvedBy: null, approvedAt: null, deliveredAt: null, deliveredTo: [], openedAt: null, openedBy: null, provisionalDue: false,
    pdfPath: null, aiSummaryDraft: null, summary: null, summaryAiUsed: false, finalText: null, previousId: null, correctionPending: null, superseded: false,
    supersededAt: null, supersededBy: null, correctionReason: null, correctedBy: null, correctedAt: null, qualityReviewedBy: null, qualityReviewedAt: null, snapshot: null,
  };
}

/**
 * Det som kommer i månadsrapporten för ärendet och månaden – samma funktion som rapporten (buildMonthly via build) med
 * dagens data och bara godkända uppgifter. Behöver ingen rapportrad: fliken Månadsunderlag visar den före månadsskiftet.
 */
export function monthlyPreview(db: ReportDb, caseId: string, month: MonthKey, env: ReportEnv): MonthlyModel | null {
  return build(makeSrc(db, env, null), env, stubReport(caseId, month), false) as MonthlyModel | null;
}

export type MonthlyGaps = {
  /** Veckorader i rapportens avsnitt 2 (ISO-veckor helt eller delvis i månaden och under insatsen, uppehållsveckor inräknade). */
  weeks: number;
  /** De av veckorna som är uppehåll. Veckor att stämma av = weeks − pausedWeeks. */
  pausedWeeks: number;
  checkInsApproved: number;
  checkInsDraft: number;
  /** Samma tal som rapportens total.unregistered. */
  unregistered: number;
  assessment: "approved" | "draft" | "missing";
  /** Anteckningar från månaden (inte borttagna) som läsaren ser. */
  notes: number;
};

/**
 * Vad saknas innan månadsrapporten kan godkännas? Bara antal – aldrig text. Samma definitioner som rapporten (veckorna och
 * oregistrerade tillfällen kommer från monthlyPreview) och som dataexporten i steg 3 (facts.weeks/facts.pausedWeeks).
 */
export function monthlyGaps(db: ReportDb & Pick<Db, "case_notes">, caseId: string, month: MonthKey, env: ReportEnv): MonthlyGaps | null {
  const m = monthlyPreview(db, caseId, month, env);
  if (!m) return null;
  const from = `${month}-01`;
  const to = monthEnd(month);
  const inMonth = (t: string) => dayOf(t) >= from && dayOf(t) <= to;
  const cis = db.check_ins.filter((x) => x.caseId === caseId && inMonth(x.heldAt) && x.heldAt <= env.now);
  const ma = db.monthly_assessments.find((x) => x.caseId === caseId && x.month === month) ?? null;
  return {
    weeks: m.weeks.length,
    pausedWeeks: m.weeks.filter((w) => w.paused).length,
    checkInsApproved: cis.filter((x) => x.status === "approved").length,
    checkInsDraft: cis.filter((x) => x.status !== "approved").length,
    unregistered: m.total.unregistered,
    assessment: !ma ? "missing" : ma.status === "approved" ? "approved" : "draft",
    notes: db.case_notes.filter((x) => x.caseId === caseId && !x.removedAt && x.occurredOn >= from && x.occurredOn <= to).length,
  };
}

/** Har rapporten en ögonblicksbild av sitt levererade innehåll? */
export const hasSnapshot = (r: Pick<Report, "id" | "snapshot">): boolean => !!(r.snapshot && r.snapshot.reportId === r.id && r.snapshot.model);

/**
 * Rapportens innehåll (prototypens modelFor). Utkast: dagens data. Levererad: ögonblicksbilden, annars de uppgifter som
 * fanns vid leveransen. opts.live = bygg en levererad rapport ur dagens data.
 */
export function reportModel(db: ReportDb, r: Report, env: ReportEnv, opts: { live?: boolean } = {}): ReportModel | null {
  if (!hasDocument(r.kind)) return null;
  if (!isDelivered(r)) return build(makeSrc(db, env, null), env, r, false);
  if (opts.live) return build(makeSrc(db, env, null), env, r, true);
  if (hasSnapshot(r)) return r.snapshot!.model as ReportModel;
  return build(makeSrc(db, env, r.deliveredAt), env, r, true);
}

/** Innehållet som fryses i ögonblicksbilden: det som gällde vid leveransen. */
export function frozenModel(db: ReportDb, r: Report, env: ReportEnv): ReportModel | null {
  if (!hasDocument(r.kind) || !isDelivered(r)) return null;
  return build(makeSrc(db, env, r.deliveredAt), env, r, true);
}

/** JSON med sorterade nycklar – jämförelsen får inte bero på nycklarnas ordning (jsonb sorterar om dem). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

/**
 * Har underlaget för den rapporterade perioden ändrats efter att rapporten frystes? Jämför det frysta innehållet med
 * samma uppgifter plus allt som ändrats efter ögonblicksbilden. Uppgifter som tillkom mellan leveransen och
 * ögonblicksbilden (testdatats historik) räknas inte. Utan ögonblicksbild finns inget att jämföra med.
 */
export function driftedSinceDelivery(db: ReportDb, r: Report, env: ReportEnv): boolean {
  if (!isDelivered(r) || r.superseded || !hasDocument(r.kind) || !hasSnapshot(r)) return false;
  const a = reportModel(db, r, env);
  const b = build(makeSrc(db, env, r.deliveredAt, r.snapshot!.takenAt), env, r, true);
  if (!a || !b) return false;
  const norm = (m: ReportModel) => canonicalJson({ ...m, now: null, summary: null, recommendation: null, sla: null, basics: null });
  return norm(a) !== norm(b);
}

/** Senaste godkända avstämningen i perioden (förslaget till kvarstående hinder i slutrapporten). */
export function lastApprovedCheckIn(db: Pick<ReportDb, "check_ins">, caseId: string, from: LocalDate, to: LocalDate): ReportDb["check_ins"][number] | null {
  const cis = db.check_ins.filter((x) => x.caseId === caseId && x.status === "approved" && dayOf(x.heldAt) >= from && dayOf(x.heldAt) <= to).sort(by("heldAt"));
  return cis[cis.length - 1] ?? null;
}
