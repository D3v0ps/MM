// Hanterare för området ledning (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
// Källa: prototyp/src/views/ledning.js (chef.oversikt och chef.avvikelser) och prototypens alert.ack.
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { ApiError, handleCommand, handleQuery, type Ctx } from "@/api/server";
import { hidesCommercial } from "@/api/tester-access";
import { accessIndex, caseAccessIn, displayName } from "@/core/access";
import { alerts, type AlertItem } from "@/core/alerts";
import { attendanceStats as attendanceStatsFor } from "@/core/attendance";
import { unbilledOld } from "@/core/billing";
import { coaches } from "@/core/cases";
import { isOperational, isUnset, kpiDef, requireOperational } from "@/core/config";
import { customerSummary } from "@/core/customer-summary";
import { checkInsOf } from "@/core/db-index";
import { deadlines } from "@/core/deadlines";
import { domainEnv, type DomainEnv } from "@/core/env";
import { kr, pct } from "@/core/format";
import { kpis, resultForecast, resultRate, resultTrend, type KpiValue, type ResultRate } from "@/core/kpi";
import { personName } from "@/core/labels";
import type { ViewId } from "@/core/links";
import { progressionWatch, weekProgress } from "@/core/progression";
import { pulseStats } from "@/core/pulse";
import { slaStatus } from "@/core/sla";
import { addDays, addMonths, dayOf, fmtDate, fmtWeekKey, monthEnd, monthKey, monthName, weekMonday, weeksOfMonth, type MonthKey } from "@/core/time";
import { by, groupBy, sum, uniq } from "@/core/util";
import { loadDb } from "@/api/load";
import type { AlertAck, Contract, ContractDeviation, Db, TableName } from "@/data/schema";
import { orgSettingsFor, upsert, userEmail, userName } from "../_shared/context";
import {
  alertAck, cdevClose, cdevDetail, cdevMonth, cdevRegister, cdevSave, cdLevelLabel, cdStatusKey, CD_STATUS_LABEL, cdTypeLabel, ledningAreas, ledningCoaches,
  ledningHead, ledningOverview, ledningPulse,
  type AlertView, type CdevForm, type CdevRow, type CdevMonthItem, type KpiRow, type RateView, type ResultTargets,
} from "./api";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

// ---------------------------------------------------------------- alert.ack
// Flaggorna kvitteras av dem som får dem: coach (egna ärenden), samordnare, avtalsansvarig och chef/controller.
handleCommand(alertAck, { roles: ["coach", "samordnare", "avtalsansvarig", "chef"] }, async (ctx, p) => {
  await upsert(ctx.repo.table("alert_acks"), { id: p.key, alertKey: p.key, acknowledgedBy: ctx.actor.userId, acknowledgedAt: ctx.now(), actionPlan: p.plan });
  await ctx.audit({ action: "alert.acknowledged", entity: "alert", entityId: p.key, contractId: ctx.actor.contractIds[0] ?? null, details: { plan: p.plan } });
  return ok({});
});

// ================================================================ Gemensamt för områdets skärmar

const CHEF: readonly Role[] = ["chef"];
/** Registret över avtalsavvikelser (prototypens chef.avvikelser). */
const CDEV_ROLES: readonly Role[] = ["chef", "avtalsansvarig", "samordnare"];
/** Varningar, viten och avropsstopp registreras av chef eller avtalsansvarig (prototypens canManage). */
const MANAGE_ROLES: readonly Role[] = ["chef", "avtalsansvarig"];
/** Interna framgångsmått från SPEC §2 – Miljonbemannings egna mål, inte avtalsvärden (samma som prototypen). */
const INTERNAL_GOALS = { docMinutes: 5, pulseResponseRate: 0.6 } as const;
/**
 * Stegen i eskaleringstrappan där kommunen kan ge skriftlig varning (prototypens regel "steg 1–3").
 * Avtalskonfigurationen beskriver det bara i trappans texter – föreslås som eget fält i config.escalationLadder.
 */
const WARNING_STEPS = { min: 1, max: 3 } as const;
const isWarningStep = (n: number) => n >= WARNING_STEPS.min && n <= WARNING_STEPS.max;

/** Roller per sida som flaggorna länkar till (prototypens vyer och roller) – länken visas bara om rollen kan öppna sidan. */
const VIEW_ROLES: Partial<Record<ViewId, readonly Role[]>> = {
  "arende.kort": ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin"],
  "rapport.visa": ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "kommun_handlaggare", "kommun_chef"],
  "eko.start": ["ekonom", "chef"],
  "sam.inkorg": ["samordnare", "avtalsansvarig"],
  "sam.deadlines": ["samordnare", "avtalsansvarig", "chef"],
  "coach.avstamning": ["coach"],
  "chef.oversikt": ["chef"],
};
const canOpen = (view: ViewId, role: Role) => !!VIEW_ROLES[view]?.includes(role);
const LINK_LABEL: Partial<Record<ViewId, string>> = { "arende.kort": "Öppna ärendet", "rapport.visa": "Öppna rapporten", "eko.start": "Till faktureringen", "sam.inkorg": "Till inkorgen" };

/** Avtalet som ledningsvyn och registret gäller: användarens första aktiva avtal där ärenden hanteras (prototypens MM.contract()). */
async function actorContract(ctx: Ctx): Promise<Contract> {
  for (const id of ctx.actor.contractIds) {
    const c = await ctx.repo.table("contracts").get(id);
    if (c && c.status === "active" && isOperational(c.config)) return c;
  }
  throw new ApiError(404, "no_contract", "Det finns inget aktivt avtal att visa.");
}

type Scope = { contract: Contract; env: DomainEnv; customerName: string };
async function scopeFor(ctx: Ctx, contract?: Contract): Promise<Scope> {
  const c = contract ?? (await actorContract(ctx));
  const org = await orgSettingsFor(ctx, c);
  const customer = await ctx.repo.table("organizations").get(c.customerId);
  return { contract: c, env: domainEnv(c, org, ctx.now()), customerName: customer?.name ?? "" };
}

/** Tabeller med contractId respektive caseId – filtreras på avtalet och dess ärenden. */
const BY_CONTRACT = new Set<TableName>(["reports", "contract_deviations", "contract_areas", "price_items", "memberships", "billing_runs", "invoice_drafts", "billing_week_approvals"]);
const BY_CASE = new Set<TableName>([
  "activities", "attendance", "check_ins", "outcome_events", "placements", "pulse_invites", "pulse_responses", "deviations", "monthly_assessments", "case_team",
]);

/**
 * Avtalets data för ledningens aggregat (KPI:er, flaggor, prognos, jämförelse per coach och område).
 *
 * ctx.system: ledningsvyn visar avtalets samlade nyckeltal – i den riktiga tjänsten räknas de av ett schemalagt jobb
 * (service role). Chef/controller får se ärenden med skyddade personuppgifter bara som ärendenummer (policyn ger
 * "restricted"), men de ärendena ska ändå räknas med i avtalets resultatgrad, närvaro och flaggor – precis som i den
 * gamla prototypen. Inga rader lämnas ut: vy-modellerna innehåller bara aggregat, ärendenummer, användarnas namn och
 * deltagarnamn enligt displayName med aktörens egen åtkomst (skyddade visas som "Skyddade personuppgifter").
 * Pulssvar redovisas bara som aggregat och först från avtalets minsta antal (pulse.minNForAggregate).
 */
async function contractDb(ctx: Ctx, contract: Contract): Promise<Db> {
  const cases = await ctx.system.table("cases").list({ contractId: contract.id });
  const caseIds = cases.map((c) => c.id);
  const personIds = uniq(cases.map((c) => c.personId));
  const names: TableName[] = [
    "activities", "attendance", "check_ins", "outcome_events", "placements", "pulse_invites", "pulse_responses", "deviations", "monthly_assessments", "case_team",
    "reports", "contract_deviations", "contract_areas", "price_items", "memberships", "billing_runs", "invoice_drafts", "billing_week_approvals",
    "buyer_references", "profiles", "persons", "contracts", "alert_acks", "demo_tags",
  ];
  const filters: Record<string, unknown> = {
    persons: { id: { in: personIds } },
    contracts: { id: contract.id },
    buyer_references: { customerId: contract.customerId },
  };
  for (const n of names) {
    if (BY_CONTRACT.has(n)) filters[n] = { contractId: contract.id };
    if (BY_CASE.has(n)) filters[n] = { caseId: { in: caseIds } };
  }
  const rest = (await loadDb(ctx.system, names, filters as never)) as unknown as Partial<Db>;
  // Avrop med skyddade personuppgifter (inkorgen) går bara till avtalsansvarig och samordnare – aldrig till chef/controller.
  return { ...(rest as Db), cases, inbound_emails: [] };
}

/** Allt ledningsvyns flikar behöver: avtal, miljö och data. */
async function ledningData(ctx: Ctx) {
  const scope = await scopeFor(ctx);
  const db = await contractDb(ctx, scope.contract);
  return { ...scope, db };
}

/**
 * Resultatgraden för vyn. hide = begränsad testare i testmiljön (src/api/tester-access.ts): Miljonbemannings interna mål
 * lämnas inte ut, så "under internt mål" blir "ok" (samma regel som för kunden, src/core/customer-summary.ts).
 * Avtalsmålet och "under avtalsmålet" finns kvar.
 */
const rateView = (r: ResultRate, hide = false): RateView => ({
  value: r.value, num: r.num, den: r.den, prelim: r.prelim, excluded: r.excluded, status: hide && r.status === "below_internal" ? "ok" : r.status, minN: r.minN,
});

/** Resultatgradens mål. Begränsade testare: utan internt mål (internal = null). */
function targetsOf(env: DomainEnv, hide = false): ResultTargets {
  const k = kpiDef(env.cfg, "resultatgrad");
  return { contract: k?.contractTarget ?? null, internal: !hide && typeof k?.internalTarget === "number" ? k.internalTarget : null, minN: k?.minN ?? 0 };
}

const ackView = (db: Pick<Db, "profiles">, ack: { by: string; at: string; plan: string } | null) =>
  ack ? { byName: personName(db.profiles, ack.by), at: ack.at, plan: ack.plan } : null;

function alertView(a: AlertItem, db: Pick<Db, "profiles">, role: Role): AlertView {
  const link = a.link.view !== "chef.oversikt" && canOpen(a.link.view, role) ? { href: a.href, label: LINK_LABEL[a.link.view] ?? "Öppna" } : null;
  return { key: a.key, kind: a.kind, severity: a.severity, title: a.title, text: a.text, createdAt: a.createdAt, ack: ackView(db, a.ack), link };
}

/**
 * En KPI-rad. target är Miljonbemannings interna mål. hide = begränsad testare: målet lämnas inte ut. Resultatgraden behåller
 * avtalsmålet ("under internt mål" blir "ok"); övriga KPI:er har bara internt mål och får statusen "target_hidden" (utfall
 * utan mål) – utom när underlag saknas.
 */
function kpiRow(v: KpiValue, hide = false): KpiRow {
  const status: KpiRow["status"] = !hide
    ? v.status
    : v.key === "resultatgrad"
      ? v.status === "below_internal" ? "ok" : v.status
      : v.status === "no_data" ? "no_data" : "target_hidden";
  return {
    key: v.key, label: v.label, value: v.value, num: v.num, den: v.den, target: hide ? null : v.target, targetUnset: !hide && !!v.targetUnset,
    contractTarget: v.contractTarget ?? null, status, provisional: !!v.provisional,
  };
}

/** Chefens flaggor. Begränsade testare: utan flaggorna om internt mål och ofakturerat (src/core/alerts.ts, hideCommercial). */
const chefAlerts = (db: Db, ctx: Ctx, env: DomainEnv, includeAcked = false) =>
  alerts(db, { role: "chef", personaId: ctx.actor.userId, includeAcked, hideCommercial: hidesCommercial(ctx.actor) }, env);
const lastMonthOf = (env: DomainEnv): MonthKey => addMonths(monthKey(dayOf(env.now)), -1);
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const a = xs.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
/** Kommunens chef (den som får beställarrapporten och godkänner åtgärdsplaner) – första kommunchefen i avtalet. */
const customerChefId = (db: Pick<Db, "memberships">, contractId: string): string | null =>
  db.memberships.find((m) => m.role === "kommun_chef" && m.contractId === contractId)?.userId ?? null;

// ================================================================ Ledningsvyn

// ---------------------------------------------------------------- ledning.head
handleQuery(ledningHead, { roles: CHEF }, async (ctx) => {
  const { contract, env, db, customerName } = await ledningData(ctx);
  return { customerName, contractNumber: contract.contractNumber, alertCount: chefAlerts(db, ctx, env).length };
});

// ---------------------------------------------------------------- ledning.overview (flik Resultat och KPI:er)
const SLA_KEYS = ["avrop_besvarade_i_tid", "forsta_mote_inom_en_vecka", "veckorapporter_i_tid", "manadsrapporter_i_tid"];

handleQuery(ledningOverview, { roles: CHEF }, async (ctx) => {
  const { contract, env, db } = await ledningData(ctx);
  const role = ctx.actor.role;
  const cfg = env.cfg;
  // Begränsade testare (testmiljön): inga interna mål och inget fakturaunderlag (ofakturerat) eller länk till Ekonomi.
  const hide = hidesCommercial(ctx.actor);
  const targets = targetsOf(env, hide);
  const rolling = resultRate(db, { window: "rolling_6m" }, env);
  const sinceStart = resultRate(db, { from: contract.startsOn }, env);
  const open = chefAlerts(db, ctx, env);
  const acked = chefAlerts(db, ctx, env, true).filter((a) => a.ack);
  const isRr = (a: AlertItem) => a.key.startsWith("kpi:resultatgrad");
  const flagAlerts = open.filter((a) => a.kind !== "no_progress_escalated").sort((a, b) => Number(isRr(b)) - Number(isRr(a)));
  const rrAlert = open.find(isRr) ?? null;
  const rrAck = acked.find(isRr) ?? null;

  // Tidig uppmärksamhet: eskalerade ärenden per coach (coachen ser bara sina påminnelser).
  const escalated = progressionWatch(db, {}, env).filter((w) => w.level === "escalated");
  const acks = new Map<string, AlertAck>(db.alert_acks.map((x) => [x.id, x]));
  const src = accessIndex(db);
  const persons = new Map(db.persons.map((p) => [p.id, p]));
  const early = Object.entries(groupBy(escalated, (w) => w.case.leadCoachId ?? "")).map(([coachId, ws]) => ({
    coachId,
    coachName: personName(db.profiles, coachId),
    reminders: progressionWatch(db, { coachId }, env).length,
    cases: ws.map((w) => {
      const key = `noprog_esc:${w.case.id}:${w.lastWeek}`;
      const ack = acks.get(key);
      const a = open.find((x) => x.key === key);
      return {
        caseId: w.case.id,
        caseNumber: w.case.caseNumber,
        name: displayName(w.case, persons.get(w.case.personId), caseAccessIn(w.case, ctx.actor, src)),
        streak: w.streak,
        weeks: w.weeks.map((x) => ({ key: x.key, label: fmtWeekKey(x.key), reason: x.reason })),
        alert: a ? { key: a.key, kind: a.kind, title: a.title, text: a.text } : { key, kind: "no_progress_escalated" as const, title: `${w.streak} veckor i rad utan progression`, text: w.case.caseNumber },
        ack: ack ? { byName: personName(db.profiles, ack.acknowledgedBy), at: ack.acknowledgedAt, plan: ack.actionPlan } : null,
      };
    }),
  }));

  const kpiList = kpis(db, {}, env);
  const sla = kpiList.filter((x) => SLA_KEYS.includes(x.key));
  const slaTargets = uniq(sla.filter((x) => x.target != null).map((x) => x.target as number));
  const unbilled = unbilledOld(db, env);
  const unbilledCases = uniq(unbilled.map((x) => x.case.id)).map((id) => ({ caseId: id, caseNumber: unbilled.find((x) => x.case.id === id)?.case.caseNumber ?? "" }));
  const cds = db.contract_deviations;
  const openCds = cds.filter((x) => x.status !== "closed");
  const dueTime = env.org.alerts.followUpDueTime;

  // Så ser kommunens chef resultatet: den senast levererade beställarrapporten (samma urval som portalens beställarrapport).
  const chefId = customerChefId(db, contract.id);
  const delivered = (r: Db["reports"][number]) => !!r.deliveredAt && (r.status === "delivered" || r.status === "opened") && !r.superseded;
  const reps = db.reports
    .filter((r) => r.kind === "customer_summary" && !r.superseded && !!chefId && (r.recipientUserId === chefId || r.deliveredTo.includes(chefId)))
    .sort(by("month"));
  const latest = reps.filter(delivered).slice(-1)[0] ?? null;
  const next = reps.find((r) => !delivered(r) && (!latest || (r.month ?? "") > (latest.month ?? ""))) ?? null;
  // Samma räknesätt som beställarrapporten (customerSummary: rullande 6 månader till och med månadens slut).
  const customerRolling = (mk: MonthKey) => {
    const r = resultRate(db, { window: "rolling_6m", to: monthEnd(mk) }, env);
    return { value: r.value, num: r.num, den: r.den, minN: r.minN };
  };

  return {
    contractStart: contract.startsOn,
    lastMonth: lastMonthOf(env),
    targets,
    rolling: rateView(rolling, hide),
    sinceStart: rateView(sinceStart, hide),
    forecast: resultForecast(db, env),
    trend: resultTrend(db, env).map((r) => ({ month: r.month, value: r.value, num: r.num, den: r.den, excluded: r.excluded, cumulative: r.cumulative, cumulativeN: r.cumulativeN })),
    resultDefinitionUnset: isUnset(cfg.result.definition),
    prototypeDefinition: cfg.result.prototypeDefinition ?? null,
    alertCount: open.length,
    criticalCount: open.filter((a) => a.severity === "critical").length,
    flagAlerts: flagAlerts.map((a) => alertView(a, db, role)),
    acked: acked.map((a) => alertView(a, db, role)),
    rrAlert: rrAlert ? alertView(rrAlert, db, role) : null,
    rrAckAt: rrAck?.ack?.at ?? null,
    escalateAfterWeeks: env.org.notifications.progressionWatch.escalateAfterConsecutiveWeeks,
    escalatedCount: escalated.length,
    early,
    sla: {
      rows: sla.map((v) => kpiRow(v, hide)),
      targetText: hide ? "" : slaTargets.length === 1 ? `internt mål ${pct(slaTargets[0], 0)}` : "internt mål per rad",
      overdueCount: deadlines(db, { days: 0 }, env).filter((x) => x.bucket === "overdue").length,
      canOpenDeadlines: canOpen("sam.deadlines", role),
      seesSlaStats: !!cfg.customerVisibility.seesSlaStats,
    },
    // Begränsade testare: fakturaunderlaget (ofakturerade veckor, ärenden och belopp) lämnas inte ut och Ekonomi är stängd.
    ...(hide
      ? {}
      : {
          unbilled: {
            totalOre: sum(unbilled, (x) => x.amountOre),
            weeks: unbilled.length,
            cases: unbilledCases,
            oldestDays: unbilled.length ? Math.max(...unbilled.map((x) => x.age)) : null,
            warningDays: cfg.billing.unbilledWarningDays,
            canOpenBilling: canOpen("eko.start", role),
          },
        }),
    cds: {
      open: openCds.length,
      warnings: cds.filter((x) => x.warningIssued).length,
      warningsBeforeTermination: cfg.warningsBeforeTermination,
      openPlans: openCds.filter((x) => x.actionPlan).map((x) => {
        const dueAt = x.actionPlanDue ? `${x.actionPlanDue}T${dueTime}` : null;
        const s = dueAt ? slaStatus(dueAt, null, env) : null;
        return { id: x.id, description: x.description, actionPlanDue: x.actionPlanDue, dueAt, sla: s ? { label: s.label, tone: s.tone } : null };
      }),
    },
    kpis: kpiList.map((v) => kpiRow(v, hide)),
    customer: {
      latest: latest && latest.month && latest.deliveredAt ? { id: latest.id, month: latest.month, deliveredAt: latest.deliveredAt } : null,
      rolling: latest?.month ? customerRolling(latest.month) : null,
      contractTarget: targets.contract,
      next: next?.month ? { id: next.id, month: next.month } : null,
      nextRolling: next?.month ? customerRolling(next.month) : null,
      correctionPending: !!(latest?.correctionPending && db.reports.some((r) => r.id === latest.correctionPending)),
      smallGroupN: cfg.pulse.minNForAggregate,
      canOpenReport: canOpen("rapport.visa", role),
    },
  };
});

// ---------------------------------------------------------------- ledning.coaches (flik Per coach)
handleQuery(ledningCoaches, { roles: CHEF }, async (ctx) => {
  const { contract, env, db } = await ledningData(ctx);
  const hide = hidesCommercial(ctx.actor);
  const mk = lastMonthOf(env);
  const from = `${mk}-01`;
  const to = monthEnd(mk);
  const weeks = weeksOfMonth(mk).map((w) => w.key);
  const isManual = (x: { inputMethod: string | null }) => (x.inputMethod || "manual") === "manual";
  const rows = coaches(db, contract.id).map((u) => {
    const cases = db.cases.filter((c) => c.leadCoachId === u.id);
    const rr = resultRate(db, { window: "rolling_6m", coachId: u.id }, env);
    let att = 0;
    let reg = 0;
    for (const c of cases) {
      if (!c.startDate) continue;
      const s = attendanceStatsFor(db, c.id, from, to, env);
      att += s.present + s.late;
      reg += s.planned - s.unregistered;
    }
    let wk = 0;
    let wkOk = 0;
    for (const c of cases) {
      for (const key of weeks) {
        const wp = weekProgress(c, key, db);
        if (!wp || wp.progress === null) continue;
        const mon = weekMonday(key);
        const end = `${addDays(mon, 6)}T23:59`;
        wk++;
        if (checkInsOf(db, c.id).some((x) => x.status === "approved" && x.heldAt >= mon && x.heldAt <= end)) wkOk++;
      }
    }
    const manual = cases
      .flatMap((c) => checkInsOf(db, c.id))
      .filter((x) => x.status === "approved" && monthKey(x.heldAt) === mk && x.docMinutes != null && isManual(x))
      .map((x) => x.docMinutes as number);
    const watch = progressionWatch(db, { coachId: u.id }, env);
    return {
      id: u.id, name: u.fullName, active: cases.filter((c) => c.status === "active").length, rr: rateView(rr, hide),
      att, reg, attRate: reg ? att / reg : null, wk, wkOk, ciRate: wk ? wkOk / wk : null,
      docMedian: median(manual), docN: manual.length, reminders: watch.length, escalated: watch.filter((w) => w.level === "escalated").length,
    };
  });
  const total = {
    active: sum(rows, (r) => r.active), reminders: sum(rows, (r) => r.reminders), escalated: sum(rows, (r) => r.escalated),
    att: sum(rows, (r) => r.att), reg: sum(rows, (r) => r.reg), wk: sum(rows, (r) => r.wk), wkOk: sum(rows, (r) => r.wkOk),
  };
  const allDoc = median(db.check_ins.filter((x) => x.status === "approved" && monthKey(x.heldAt) === mk && x.docMinutes != null && isManual(x)).map((x) => x.docMinutes as number));
  return {
    lastMonth: mk, targets: targetsOf(env, hide),
    // Begränsade testare (testmiljön): Miljonbemannings interna mål för dokumentationstiden lämnas inte ut.
    ...(hide ? {} : { docGoalMinutes: INTERNAL_GOALS.docMinutes }),
    escalateAfterWeeks: env.org.notifications.progressionWatch.escalateAfterConsecutiveWeeks,
    rows, total, allDoc, all: rateView(resultRate(db, { window: "rolling_6m" }, env), hide),
  };
});

// ---------------------------------------------------------------- ledning.areas (flik Per avtalsområde)
handleQuery(ledningAreas, { roles: CHEF }, async (ctx) => {
  const { contract, env, db } = await ledningData(ctx);
  const hide = hidesCommercial(ctx.actor);
  const t = targetsOf(env, hide);
  const lm = lastMonthOf(env);
  const rows = db.contract_areas.map((a) => {
    const cs = db.cases.filter((c) => c.primaryAreaCode === a.code);
    return {
      code: a.code, name: a.name, active: cs.filter((c) => c.status === "active").length, closed: cs.filter((c) => c.status === "closed").length,
      rr: rateView(resultRate(db, { area: a.code, from: contract.startsOn }, env), hide),
    };
  });
  return {
    lastMonth: lm,
    minN: t.minN,
    smallGroupN: env.cfg.pulse.minNForAggregate,
    rows,
    total: { active: sum(rows, (r) => r.active), closed: sum(rows, (r) => r.closed) },
    all: rateView(resultRate(db, { from: contract.startsOn }, env), hide),
    monthActive: customerSummary(db, lm, env).active,
  };
});

// ---------------------------------------------------------------- ledning.pulse (flik Deltagarnas röst)
handleQuery(ledningPulse, { roles: CHEF }, async (ctx) => {
  const { contract, env, db } = await ledningData(ctx);
  const st = pulseStats(db, {}, env);
  const low = chefAlerts(db, ctx, env, true).filter((a) => a.kind === "pulse_low");
  const prio = Object.entries(st.priorities).map(([k, n]) => [k, n ?? 0] as [string, number]).sort((a, b) => b[1] - a[1]);
  return {
    minN: st.minN,
    enough: st.enough,
    periodicEveryDays: env.cfg.pulse.periodicEveryDays,
    // Begränsade testare (testmiljön): Miljonbemannings interna mål för svarsfrekvensen lämnas inte ut.
    ...(hidesCommercial(ctx.actor) ? {} : { responseGoal: INTERNAL_GOALS.pulseResponseRate }),
    // Aggregaten lämnas bara ut från minsta antal svar – annars kan deltagare identifieras.
    stats: st.enough
      ? { invites: st.invites, responses: st.responses, responseRate: st.responseRate, satisfaction: st.satisfaction, closer: st.closer, support: st.support, q1: st.q1, q2: st.q2, q3: st.q3, priorities: prio }
      : null,
    lowAlerts: low.map((a) => alertView(a, db, ctx.actor.role)),
    lowOpen: low.filter((a) => !a.ack).length,
    contactRequested: db.pulse_responses.filter((p) => p.contactRequested).length,
    perCoach: coaches(db, contract.id).map((u) => {
      const s = pulseStats(db, { coachId: u.id }, env);
      return {
        id: u.id, name: u.fullName, responses: s.responses, enough: s.enough,
        satisfaction: s.enough ? s.satisfaction : null, support: s.enough ? s.support : null, responseRate: s.enough ? s.responseRate : null,
      };
    }),
  };
});

// ================================================================ Avtalsavvikelser

/** När avvikelsen stängdes. Äldre (förifyllda) poster saknar closedAt – då används planens slutdatum (bara datum). */
const closedOn = (cd: ContractDeviation): string | null => (cd.status === "closed" ? cd.closedAt || cd.actionPlanDue || cd.raisedAt : null);

/** En rad i registret. hide = begränsad testare: vitets belopp lämnas inte ut. */
function cdevRow(cd: ContractDeviation, hide = false): CdevRow {
  return {
    id: cd.id, raisedAt: cd.raisedAt, type: cd.type, level: cd.level, source: cd.source, escalationStep: cd.escalationStep, description: cd.description,
    hasPlan: !!String(cd.actionPlan || "").trim(), actionPlanDue: cd.actionPlanDue, customerApprovedAt: cd.customerApprovedAt, statusKey: cdStatusKey(cd),
    warningIssued: cd.warningIssued, ...(hide ? {} : { penaltyOre: cd.penaltyOre || 0 }), orderStop: cd.orderStop,
  };
}

/** Val i formulären: ansvariga (MB:s aktiva användare), viten och trappan från avtalskonfigurationen. */
async function formFor(ctx: Ctx, contract: Contract, env: DomainEnv): Promise<CdevForm> {
  const cfg = env.cfg;
  const staff = await ctx.repo.table("profiles").list({ organizationId: contract.supplierId });
  const today = dayOf(env.now);
  const offsetMonths: string[] = [];
  for (let mk = monthKey(today); offsetMonths.length < 3; mk = addMonths(mk, 1)) offsetMonths.push(mk);
  return {
    economicHelp: cfg.economicDeviation,
    owners: staff.filter((u) => u.active !== false).map((u) => ({ value: u.id, label: `${u.fullName} – ${u.title}` })),
    defaultOwnerId: ctx.actor.userId,
    today,
    offsetMonths,
    // Begränsade testare (testmiljön): avtalets viten lämnas inte ut.
    ...(hidesCommercial(ctx.actor) ? {} : { penalties: { deviationOre: cfg.penalties.deviationOre, insufficientInformationOre: cfg.penalties.insufficientInformationOre } }),
    warningsBeforeTermination: cfg.warningsBeforeTermination,
    ladder: cfg.escalationLadder.map((s) => ({ step: s.step, level: s.level, text: s.text })),
    canManage: MANAGE_ROLES.includes(ctx.actor.role),
    caseNumberExample: `${cfg.casePrefix}-26-0042`,
    warningSteps: { ...WARNING_STEPS },
  };
}

/** Öppna först, därefter senast registrerade först (prototypens ordning i registret). */
const registerOrder = (a: ContractDeviation, b: ContractDeviation) => Number(a.status === "closed") - Number(b.status === "closed") || (a.raisedAt < b.raisedAt ? 1 : -1);

// ---------------------------------------------------------------- ledning.cdevRegister
handleQuery(cdevRegister, { roles: CDEV_ROLES }, async (ctx) => {
  const { contract, env, customerName } = await scopeFor(ctx);
  const hide = hidesCommercial(ctx.actor);
  const all = (await ctx.repo.table("contract_deviations").list({ contractId: contract.id })).sort(registerOrder);
  const open = all.filter((x) => x.status !== "closed");
  const stepCounts: Record<number, number> = {};
  for (const x of open) stepCounts[x.escalationStep] = (stepCounts[x.escalationStep] || 0) + 1;
  const aptMonths: string[] = [];
  for (let m = monthKey(contract.startsOn); m <= monthKey(dayOf(env.now)); m = addMonths(m, 1)) aptMonths.push(m);
  return {
    customerName,
    rows: all.map((x) => cdevRow(x, hide)),
    counts: {
      open: open.length,
      openComplaints: open.filter((x) => x.type === "klagomål").length,
      waiting: open.filter((x) => x.actionPlan && !x.customerApprovedAt).length,
      warnings: all.filter((x) => x.warningIssued).length,
      ...(hide ? {} : { penaltiesOre: sum(all, (x) => x.penaltyOre || 0) }),
    },
    stepCounts,
    maxStep: open.length ? Math.max(...open.map((x) => x.escalationStep || 0)) : null,
    aptMonths,
    lastMonth: lastMonthOf(env),
    form: await formFor(ctx, contract, env),
  };
});

// ---------------------------------------------------------------- ledning.cdevDetail
handleQuery(cdevDetail, { roles: CDEV_ROLES }, async (ctx, p) => {
  const cd = await ctx.repo.table("contract_deviations").get(p.id);
  const contract = cd ? await ctx.repo.table("contracts").get(cd.contractId) : null;
  if (!cd || !contract || !isOperational(contract.config)) return { found: false as const };
  const { env } = await scopeFor(ctx, contract);
  const all = await ctx.repo.table("contract_deviations").list({ contractId: contract.id });
  const c = cd.caseId ? await ctx.repo.table("cases").get(cd.caseId) : null;
  const chefMs = await ctx.repo.table("memberships").first({ contractId: contract.id, role: "kommun_chef" });
  const chefName = chefMs ? await userName(ctx, chefMs.userId) : null;
  const closed = cd.status === "closed";
  const dueAt = !closed && cd.actionPlanDue ? `${cd.actionPlanDue}T${env.org.alerts.followUpDueTime}` : null;
  const s = dueAt ? slaStatus(dueAt, null, env) : null;
  const hide = hidesCommercial(ctx.actor);
  return {
    found: true as const,
    cd: {
      ...cdevRow(cd, hide),
      actionPlan: cd.actionPlan || "",
      ownerId: cd.ownerId,
      ownerName: cd.ownerId ? await userName(ctx, cd.ownerId) : null,
      registeredByName: cd.registeredBy ? await userName(ctx, cd.registeredBy) : null,
      caseId: c ? c.id : null,
      caseNumber: c ? c.caseNumber : null,
      planSubmittedAt: cd.planSubmittedAt,
      approvedByName: cd.customerApprovedAt ? (cd.customerApprovedBy ? await userName(ctx, cd.customerApprovedBy) : chefName) : null,
      warningIssuedAt: cd.warningIssuedAt,
      // Begränsade testare: vitet och fakturan det avräknas på lämnas inte ut.
      ...(hide ? {} : { penaltyKind: cd.penaltyKind ?? (cd.penaltyOre ? "deviation" : null), penaltyOffsetMonth: cd.penaltyOffsetMonth }),
      lessons: cd.lessons || "",
      closedOn: closedOn(cd),
    },
    planDue: dueAt && s ? { dueAt, sla: { label: s.label, tone: s.tone } } : null,
    totalWarnings: all.filter((x) => x.warningIssued).length,
    customerChefName: chefName,
    form: await formFor(ctx, contract, env),
  };
});

// ---------------------------------------------------------------- ledning.cdevMonth (månadssammanställning för APT)
handleQuery(cdevMonth, { roles: CDEV_ROLES }, async (ctx, p) => {
  const { contract, env, customerName } = await scopeFor(ctx);
  const hide = hidesCommercial(ctx.actor);
  const cfg = env.cfg;
  const mk = p.month;
  const start = `${mk}-01`;
  const end = monthEnd(mk);
  const all = await ctx.repo.table("contract_deviations").list({ contractId: contract.id });
  const inMonth = (s: string | null) => !!s && s.slice(0, 10) >= start && s.slice(0, 10) <= end;
  const created = all.filter((x) => inMonth(x.raisedAt));
  const openAtEnd = all.filter((x) => x.raisedAt.slice(0, 10) <= end && !(closedOn(x) && (closedOn(x) as string).slice(0, 10) <= end));
  const closedN = all.filter((x) => inMonth(closedOn(x))).length;
  const actions = all.filter((x) => x.actionPlan && x.raisedAt.slice(0, 10) <= end && (!closedOn(x) || (closedOn(x) as string).slice(0, 10) >= start));
  const lessons = all.filter((x) => x.lessons && x.raisedAt.slice(0, 10) <= end);
  // ctx.system: bara antalet avvikelser på deltagarnivå i avtalet under månaden (ett tal, inga rader) – även ärenden
  // med skyddade personuppgifter, som samordnaren inte får läsa anteckningar i, ska räknas med.
  const caseIds = (await ctx.system.table("cases").list({ contractId: contract.id })).map((c) => c.id);
  const participantDevs = caseIds.length ? (await ctx.system.table("deviations").list({ caseId: { in: caseIds } })).filter((x) => inMonth(x.createdAt)).length : 0;
  const complaints = created.filter((x) => x.type === "klagomål").length;
  const warnings = all.filter((x) => x.warningIssued && (x.warningIssuedAt || x.raisedAt).slice(0, 10) <= end).length;
  const penaltiesOre = sum(all.filter((x) => x.penaltyOre && x.raisedAt.slice(0, 10) <= end), (x) => x.penaltyOre);
  const createdIds = new Set(created.map((x) => x.id));
  const seen = new Set<string>();
  const items: CdevMonthItem[] = [];
  for (const x of [...created, ...openAtEnd]) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    items.push({ id: x.id, type: x.type, level: x.level, escalationStep: x.escalationStep, description: x.description, isNew: createdIds.has(x.id), statusKey: cdStatusKey(x) });
  }
  const line = (x: ContractDeviation) => `- ${cdTypeLabel(x.type)}, ${cdLevelLabel(x.level).toLowerCase()} (steg ${x.escalationStep}): ${x.description}`;
  const text = [
    `Månadssammanställning avtalsavvikelser och klagomål – ${monthName(mk)}`,
    `Avtal ${contract.contractNumber}, ${customerName}`,
    "",
    `Nya under månaden: ${created.length} (varav klagomål: ${complaints})`,
    ...created.map(line),
    "",
    `Öppna vid månadens slut: ${openAtEnd.length}`,
    ...openAtEnd.map(line),
    "",
    "Åtgärder:",
    ...(actions.length
      ? actions.map((x) => `- ${x.actionPlan} (klart senast ${x.actionPlanDue ? fmtDate(x.actionPlanDue) : "datum saknas"}; ${CD_STATUS_LABEL[cdStatusKey(x)].toLowerCase()})`)
      : ["- Inga"]),
    "",
    "Lärdomar:",
    ...(lessons.length ? lessons.map((x) => `- ${x.lessons}`) : ["- Inga registrerade"]),
    "",
    `Avvikelser på deltagarnivå (från veckoavstämningar): ${participantDevs}`,
    `Skriftliga varningar hittills: ${warnings} av ${cfg.warningsBeforeTermination}`,
    // Begränsade testare: summan av viten står inte i texten (Kopiera text och Exportera).
    ...(hide ? [] : [`Viten hittills: ${kr(penaltiesOre)}`]),
  ].join("\n");
  return {
    month: mk,
    createdCount: created.length,
    complaints,
    openAtEnd: openAtEnd.length,
    closed: closedN,
    participantDeviations: participantDevs,
    items,
    actions: actions.map((x) => ({ id: x.id, actionPlan: x.actionPlan, actionPlanDue: x.actionPlanDue, statusKey: cdStatusKey(x) })),
    lessons: lessons.map((x) => ({ id: x.id, lessons: x.lessons, type: x.type, raisedAt: x.raisedAt })),
    warnings,
    warningsBeforeTermination: cfg.warningsBeforeTermination,
    ...(hide ? {} : { penaltiesOre }),
    text,
  };
});

// ---------------------------------------------------------------- ledning.cdevSave (prototypens cdev.save)
const NO_SANCTIONS = "Varningar, viten och avropsstopp registreras av avtalsansvarig eller chef.";
const APPROVAL_MAIL = "En åtgärdsplan inom avtalet med Miljonbemanning väntar på ert godkännande. Logga in i portalen för att läsa den.";

handleCommand(cdevSave, { roles: CDEV_ROLES }, async (ctx, p) => {
  // Begränsade testare (testmiljön) ser inte vitet – deras formulär saknar vitesvalet. Vitet och avräkningen ändras därför
  // aldrig av dem (ett tomt val får inte ta bort ett registrerat vite).
  const data = hidesCommercial(ctx.actor) ? { ...p.data, penaltyKind: undefined, penaltyOffsetMonth: undefined } : p.data;
  const now = ctx.now();
  const existing = p.id ? await ctx.repo.table("contract_deviations").get(p.id) : null;
  if (p.id && !existing) return fail("not_found", "Avvikelsen finns inte.");
  const isNew = !existing;
  if (isNew) {
    const missing = (["type", "level", "source", "description"] as const).filter((k) => !String(data[k] ?? "").trim());
    if (missing.length) return fail("missing", "Avvikelsen kunde inte sparas. Kontrollera fälten.", Object.fromEntries(missing.map((k) => [k, "Obligatoriskt fält."])));
  }
  const contract = existing ? await ctx.repo.table("contracts").get(existing.contractId) : await actorContract(ctx);
  if (!contract || !isOperational(contract.config)) return fail("no_contract", "Det finns inget aktivt avtal att registrera avvikelsen i.");
  const cfg = requireOperational(contract.config);

  // Sanktioner från kommunen registreras bara av chef och avtalsansvarig (prototypen spärrade fälten för övriga roller).
  const cur = existing ?? { warningIssued: false, penaltyKind: null, orderStop: false };
  const sanctionChange =
    (data.warningIssued !== undefined && data.warningIssued !== cur.warningIssued)
    || (data.penaltyKind !== undefined && (data.penaltyKind ?? null) !== (cur.penaltyKind ?? null))
    || (data.orderStop !== undefined && data.orderStop !== cur.orderStop);
  if (sanctionChange && !MANAGE_ROLES.includes(ctx.actor.role)) return fail("forbidden", NO_SANCTIONS);

  const step = data.escalationStep ?? existing?.escalationStep ?? 0;
  if (data.warningIssued && !isWarningStep(step)) return fail("warning_step", `Skriftlig varning kan bara ges på steg ${WARNING_STEPS.min}–${WARNING_STEPS.max}.`);

  // Ärendenummer -> ärende i samma avtal (prototypens sel.caseByNumber).
  const patch: Partial<ContractDeviation> = {};
  if (data.caseNumber !== undefined) {
    const no = data.caseNumber.trim().toUpperCase();
    if (!no) patch.caseId = null;
    else {
      const c = await ctx.repo.table("cases").first({ caseNumber: no, contractId: contract.id });
      const msg = `Hittar inget ärende med det numret. Skriv till exempel ${cfg.casePrefix}-26-0042.`;
      if (!c) return fail("case_not_found", msg, { caseNumber: msg });
      patch.caseId = c.id;
    }
  }
  if (data.type !== undefined) patch.type = data.type;
  if (data.level !== undefined) patch.level = data.level;
  if (data.source !== undefined) patch.source = data.source;
  if (data.description !== undefined) patch.description = data.description.trim();
  if (data.actionPlan !== undefined) patch.actionPlan = data.actionPlan.trim();
  if (data.actionPlanDue !== undefined) patch.actionPlanDue = data.actionPlanDue || null;
  if (data.ownerId !== undefined) patch.ownerId = data.ownerId || null;
  if (data.warningIssued !== undefined) patch.warningIssued = data.warningIssued;
  if (data.orderStop !== undefined) patch.orderStop = data.orderStop;
  if (data.penaltyKind !== undefined) {
    // Vitets belopp kommer från avtalskonfigurationen (penalties), aldrig från klienten.
    const kind = data.penaltyKind ?? null;
    const ore = kind === "deviation" ? cfg.penalties.deviationOre : kind === "information" ? cfg.penalties.insufficientInformationOre : 0;
    patch.penaltyKind = kind;
    patch.penaltyOre = ore;
    patch.penaltyOffsetMonth = ore ? data.penaltyOffsetMonth || null : null;
  } else if (data.penaltyOffsetMonth !== undefined && (existing?.penaltyOre ?? 0) > 0) patch.penaltyOffsetMonth = data.penaltyOffsetMonth || null;

  const base: ContractDeviation = existing ?? {
    id: ctx.newId("cd"), contractId: contract.id, caseId: null, source: data.source ?? "intern", type: data.type ?? "kvalitet", level: data.level ?? "mindre",
    escalationStep: 0, description: "", raisedAt: now, registeredBy: ctx.actor.userId, actionPlan: "", actionPlanDue: null, ownerId: null, planSubmittedAt: null,
    customerApprovedAt: null, customerApprovedBy: null, warningIssued: false, warningIssuedAt: null, penaltyKind: null, penaltyOre: 0, penaltyOffsetMonth: null,
    orderStop: false, status: "open", lessons: "", closedAt: null, closedBy: null,
  };
  const changed = (Object.keys(patch) as (keyof ContractDeviation)[]).filter((k) => base[k] !== patch[k]);
  const next: ContractDeviation = { ...base, ...patch, escalationStep: step };
  if (data.raisedOn) next.raisedAt = `${data.raisedOn}T${now.slice(11, 16)}`;
  if (data.warningIssued && !next.warningIssuedAt) next.warningIssuedAt = now;
  if (data.warningIssued === false) next.warningIssuedAt = null;

  // En ny eller ändrad åtgärdsplan skickas till kommunens chef för (nytt) godkännande.
  let sentToCustomer = false;
  const planBefore = String(existing?.actionPlan || "");
  if (String(next.actionPlan || "").trim() && next.actionPlan !== planBefore) {
    next.customerApprovedAt = null;
    next.customerApprovedBy = null;
    next.planSubmittedAt = now;
    if (next.status !== "closed") next.status = "action_plan";
    sentToCustomer = true;
  }

  if (isNew) await ctx.repo.table("contract_deviations").insert(next);
  else await ctx.repo.table("contract_deviations").update(next.id, next);

  if (sentToCustomer) {
    // Mejlet innehåller inga personuppgifter och inget ärendenummer – bara att en plan väntar (CLAUDE.md punkt 9).
    const chefMs = await ctx.repo.table("memberships").first({ contractId: contract.id, role: "kommun_chef" });
    const to = chefMs ? await userEmail(ctx, chefMs.userId) : "";
    await ctx.notify({ channel: "email", to: to || "kommunens chef", template: "atgardsplan_godkannande", body: APPROVAL_MAIL, caseId: null });
  }
  await ctx.audit({
    action: isNew ? "contract_deviation.created" : "contract_deviation.updated", entity: "contract_deviation", entityId: next.id, contractId: contract.id,
    details: { type: next.type, level: next.level, step: next.escalationStep, fields: changed, sentToCustomer },
  });
  return ok({ id: next.id, sentToCustomer });
});

// ---------------------------------------------------------------- ledning.cdevClose (prototypens cdev.close)
handleCommand(cdevClose, { roles: CDEV_ROLES }, async (ctx, p) => {
  const cd = await ctx.repo.table("contract_deviations").get(p.id);
  if (!cd) return fail("not_found", "Avvikelsen finns inte.");
  const lessons = p.lessons.trim();
  if (!lessons) return fail("lessons", "Skriv vad ni har lärt er – det används i månadssammanställningen till APT.");
  await ctx.repo.table("contract_deviations").update(cd.id, { status: "closed", closedAt: ctx.now(), closedBy: ctx.actor.userId, lessons });
  await ctx.audit({ action: "contract_deviation.closed", entity: "contract_deviation", entityId: cd.id, contractId: cd.contractId, details: { hadCustomerApproval: !!cd.customerApprovedAt } });
  return ok({ id: cd.id });
});
