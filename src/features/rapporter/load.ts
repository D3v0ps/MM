// Datainläsning och behörighet för rapporternas hanterare. Bara för hanterare – importeras aldrig av skärmar.
//
// ctx.system används på tre ställen, med samma motivering som i RLS (security definer-funktioner):
//   1. Uppslagen för behörigheten (skyddade personuppgifter, teamet, beställarens enhet) – bara flaggor och id:n.
//   2. Rapportens underlag. Rapporten får läsas (kontrollerat via ctx.repo eller reportAccess nedan), men underlaget
//      får inte alltid läsas radvis: kommunen läser inga avstämningar, veckorapporten omfattar handläggarens alla
//      deltagare, beställarrapporten är ett aggregat över hela avtalet. Bara det rapporten visar lämnas ut.
//   3. Rapportens rubrik och status när rapporten inte får visas (för att kunna säga varför) – aldrig innehållet.
// Namn på deltagare läses alltid via ctx.repo, så att bara de namn läsaren får se lämnas ut.
import type { Actor } from "@/api/roles";
import { isCustomerRole } from "@/api/roles";
import type { Ctx } from "@/api/server";
import { caseAccess, displayName, lookupsFor, type AccessSource, type CaseAccess } from "@/core/access";
import { requireOperational, type OperationalConfig } from "@/core/config";
import { addDays, monthEnd, weekMonday } from "@/core/time";
import { ACTIVITY_TYPES } from "@/data/seed/constants";
import type { Case, Contract, Report } from "@/data/schema";
import type { ReportDb, ReportEnv } from "./model";
import { isDelivered } from "./report-helpers";

// ---------------------------------------------------------------- Avtalet
export type ContractInfo = {
  contract: Contract;
  cfg: OperationalConfig;
  customerName: string;
  supplierName: string;
  env: ReportEnv;
};

/** Avtalet, parternas namn och miljön för modellerna. ctx.system: avtalet för en rapport som läsaren redan får se. */
export async function contractInfo(ctx: Ctx, contractId: string): Promise<ContractInfo> {
  const contract = await ctx.system.table("contracts").get(contractId);
  if (!contract) throw new Error(`Avtalet ${contractId} saknas`);
  const [customer, supplier] = await Promise.all([ctx.system.table("organizations").get(contract.customerId), ctx.system.table("organizations").get(contract.supplierId)]);
  const cfg = requireOperational(contract.config);
  const supplierName = supplier?.name ?? "";
  return {
    contract, cfg, customerName: customer?.name ?? "", supplierName,
    env: { cfg, contract: { id: contract.id, startsOn: contract.startsOn, supplierName }, now: ctx.now(), activityTypes: ACTIVITY_TYPES },
  };
}

// ---------------------------------------------------------------- Behörighet per ärende
/** Uppslagskälla för caseAccess för de här ärendena. ctx.system: bara flaggor och id:n (se ovan). */
export async function accessSourceFor(ctx: Ctx, cases: readonly Case[]): Promise<AccessSource> {
  const personIds = [...new Set(cases.map((c) => c.personId))];
  const caseIds = [...new Set(cases.map((c) => c.id))];
  const contractIds = [...new Set(cases.map((c) => c.contractId))];
  const [persons, team, profiles, contracts] = await Promise.all([
    personIds.length ? ctx.system.table("persons").list({ id: { in: personIds } }) : [],
    caseIds.length ? ctx.system.table("case_team").list({ caseId: { in: caseIds } }) : [],
    ctx.system.table("profiles").list(),
    contractIds.length ? ctx.system.table("contracts").list({ id: { in: contractIds } }) : [],
  ]);
  const protectedIds = new Map(persons.map((p) => [p.id, { protectedIdentity: p.protectedIdentity }]));
  const teamBy = new Map<string, string[]>();
  for (const t of team) teamBy.set(t.caseId, [...(teamBy.get(t.caseId) ?? []), t.userId]);
  const prof = new Map(profiles.map((p) => [p.id, { customerUnit: p.customerUnit }]));
  const cons = new Map(contracts.map((c) => [c.id, { config: c.config }]));
  return {
    person: (id) => protectedIds.get(id),
    teamUserIds: (caseId) => teamBy.get(caseId) ?? [],
    profile: (id) => prof.get(id),
    contract: (id) => cons.get(id),
  };
}

export type Viewer = {
  actor: Actor;
  /** Åtkomst per ärende. */
  access(c: Case | null | undefined): CaseAccess;
  /** Namnet att visa för läsaren ("Skyddade personuppgifter", "–" eller namnet). */
  name(c: Case | null | undefined): string;
  /**
   * Ärendets person har skyddade personuppgifter (samma uppslag som access – accessSourceFor). Ett ärende eller en person
   * som saknas räknas som skyddat (som protectedCase i policy.ts). Rapportbyggaren utesluter dem även för avtalsansvarig,
   * som har full åtkomst i skyddade ärenden.
   */
  isProtected(c: Case | null | undefined): boolean;
};

/** Åtkomst och namn för ärendena. Namnen läses via ctx.repo (policyn/RLS avgör vilka personer läsaren ser). */
export async function viewerFor(ctx: Ctx, cases: readonly Case[]): Promise<Viewer> {
  const src = await accessSourceFor(ctx, cases);
  const acc = new Map<string, CaseAccess>();
  const access = (c: Case | null | undefined): CaseAccess => {
    if (!c) return "none";
    let a = acc.get(c.id);
    if (!a) {
      a = caseAccess(c, ctx.actor, lookupsFor(c, src));
      acc.set(c.id, a);
    }
    return a;
  };
  const visible = cases.filter((c) => ["full", "team", "customer"].includes(access(c)));
  const personIds = [...new Set(visible.map((c) => c.personId))];
  const persons = personIds.length ? await ctx.repo.table("persons").list({ id: { in: personIds } }) : [];
  const byPerson = new Map(persons.map((p) => [p.id, p]));
  const name = (c: Case | null | undefined): string => {
    if (!c) return "–";
    // Skyddade personuppgifter: personen läses aldrig – bara texten visas.
    if (access(c) === "restricted") return "Skyddade personuppgifter";
    return displayName(c, byPerson.get(c.personId), access(c));
  };
  const isProtected = (c: Case | null | undefined): boolean => {
    const p = c ? src.person(c.personId) : null;
    return !p || p.protectedIdentity;
  };
  return { actor: ctx.actor, access, name, isProtected };
}

// ---------------------------------------------------------------- Får läsaren se rapporten? (prototypens reportAccess)
const VIEW_ROLES = ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "kommun_handlaggare"] as const;
export type ReportAccess =
  | { ok: true; access: "full" | "team" | "customer"; partial?: boolean; recipient?: boolean }
  | { ok: false; reason: "role" | "handledare" | "handledare_order" | "missing" | "not_assigned" | "protected" | "not_yours" | "not_delivered" | "protected_customer" };

/** Mottagaren: rapportens mottagare, annars beställaren, annars den första den levererades till. */
export const recipientOf = (r: Pick<Report, "recipientUserId" | "deliveredTo">, c: Case | null): string | null => r.recipientUserId || c?.referrerId || r.deliveredTo[0] || null;

/**
 * Samma regler som prototypens reportAccess och policyn för rapporter (src/data/policy.ts):
 * kommunens handläggare ser bara levererade rapporter till sig (aldrig beställarrapporten – den lämnas utanför portalen sedan
 * 2026-10-07), handledaren bara veckorapporten, beställarrapporten bara avtalsansvarig, samordnare och chef.
 */
export function reportAccess(r: Pick<Report, "kind" | "status" | "deliveredTo" | "recipientUserId">, c: Case | null, viewer: Viewer): ReportAccess {
  const { role, userId } = viewer.actor;
  if (isCustomerRole(role)) {
    const recipient = r.deliveredTo.includes(userId);
    const mine = recipient || recipientOf(r, c) === userId || (!!c && c.referrerId === userId);
    if (!mine || r.kind === "customer_summary") return { ok: false, reason: "not_yours" };
    if (!isDelivered(r)) return { ok: false, reason: "not_delivered" };
    if (c) {
      const a = viewer.access(c);
      // Skyddade personuppgifter (vilande sedan 2026-10-07): åtkomsten "restricted" ger ingen rapport i portalen.
      if (a !== "customer") return { ok: false, reason: "not_yours" };
    }
    return { ok: true, access: "customer", recipient };
  }
  if (!(VIEW_ROLES as readonly string[]).includes(role)) return { ok: false, reason: "role" };
  // Handledare ser bara veckorapporten (närvaro). Månads- och slutrapporter innehåller coachens bedömningar.
  if (role === "handledare" && r.kind !== "weekly_attendance") return { ok: false, reason: r.kind === "order_confirmation" ? "handledare_order" : r.kind === "customer_summary" ? "role" : "handledare" };
  if (r.kind === "customer_summary") return ["samordnare", "avtalsansvarig", "chef"].includes(role) ? { ok: true, access: "full" } : { ok: false, reason: "role" };
  if (r.kind === "weekly_attendance") return ["samordnare", "avtalsansvarig", "chef"].includes(role) ? { ok: true, access: "full" } : { ok: true, partial: true, access: "team" };
  if (!c) return { ok: false, reason: "missing" };
  const a = viewer.access(c);
  if (a === "none") return { ok: false, reason: "not_assigned" };
  if (a === "restricted") return { ok: false, reason: "protected" };
  if (a !== "full" && a !== "team") return { ok: false, reason: "role" };
  return { ok: true, access: a };
}

// ---------------------------------------------------------------- Rapportens underlag
const EMPTY: ReportDb = {
  cases: [], activities: [], attendance: [], check_ins: [], monthly_assessments: [], monthly_plans: [], outcome_events: [], deviations: [], tasks: [],
  audit_log: [], contract_deviations: [], pulse_responses: [], contract_areas: [], profiles: [], price_items: [], reports: [],
};

/** Underlaget för ett ärendes rapporter (månad, slut, orderbekräftelse). ctx.system: se överst i filen. */
async function caseData(ctx: Ctx, caseIds: string[]): Promise<Omit<ReportDb, "contract_areas" | "profiles" | "price_items" | "contract_deviations" | "pulse_responses" | "reports">> {
  const s = ctx.system;
  const inCases = { caseId: { in: caseIds } };
  const [cases, activities, attendance, check_ins, monthly_assessments, monthly_plans, outcome_events, deviations] = await Promise.all([
    s.table("cases").list({ id: { in: caseIds } }),
    s.table("activities").list(inCases),
    s.table("attendance").list(inCases),
    s.table("check_ins").list(inCases),
    s.table("monthly_assessments").list(inCases),
    s.table("monthly_plans").list(inCases),
    s.table("outcome_events").list(inCases),
    s.table("deviations").list(inCases),
  ]);
  const devIds = deviations.map((d) => d.id);
  const evIds = outcome_events.map((e) => e.id);
  const [tasks, audit_log] = await Promise.all([
    devIds.length ? s.table("tasks").list({ deviationId: { in: devIds } }) : [],
    evIds.length ? s.table("audit_log").list({ action: "event.added", entityId: { in: evIds } }) : [],
  ]);
  return { cases, activities, attendance, check_ins, monthly_assessments, monthly_plans, outcome_events, deviations, tasks, audit_log };
}

/** Läs underlaget för rapporten. ctx.system: se överst i filen – anropas bara när läsaren får se rapporten. */
export async function loadReportDb(ctx: Ctx, r: Report, info: ContractInfo): Promise<ReportDb> {
  const s = ctx.system;
  const [contract_areas, profiles] = await Promise.all([s.table("contract_areas").list({ contractId: r.contractId }), s.table("profiles").list()]);
  const base: ReportDb = { ...EMPTY, contract_areas, profiles };
  switch (r.kind) {
    case "monthly":
    case "final":
      return r.caseId ? { ...base, ...(await caseData(ctx, [r.caseId])) } : base;
    case "order_confirmation": {
      if (!r.caseId) return base;
      const [cases, price_items] = await Promise.all([s.table("cases").list({ id: r.caseId }), s.table("price_items").list({ contractId: r.contractId })]);
      return { ...base, cases, price_items };
    }
    case "weekly_attendance": {
      if (!r.week || !r.recipientUserId) return base;
      const mon = weekMonday(r.week);
      const sun = addDays(mon, 6);
      const cases = await s.table("cases").list({ referrerId: r.recipientUserId, contractId: r.contractId }, { orderBy: "id" });
      const caseIds = cases.map((c) => c.id);
      if (!caseIds.length) return { ...base, cases };
      const [activities, attendance, deviations] = await Promise.all([
        s.table("activities").list({ caseId: { in: caseIds }, startsAt: { gte: mon, lte: `${sun}T23:59` } }),
        s.table("attendance").list({ caseId: { in: caseIds } }),
        s.table("deviations").list({ caseId: { in: caseIds } }),
      ]);
      return { ...base, cases, activities, attendance, deviations };
    }
    case "customer_summary": {
      const mk = r.month ?? (r.periodStart ?? "").slice(0, 7);
      const start = `${mk}-01`;
      const end = monthEnd(mk);
      const cases = await s.table("cases").list({ contractId: r.contractId }, { orderBy: "id" });
      const caseIds = cases.map((c) => c.id);
      const inCases = { caseId: { in: caseIds } };
      const sla = !!info.cfg.customerVisibility.seesSlaStats;
      const activities = await s.table("activities").list({ ...inCases, startsAt: { gte: start, lte: `${end}T23:59` } });
      const actIds = activities.map((a) => a.id);
      const [attendance, monthly_assessments, pulse_responses, deviations, contract_deviations, reports] = await Promise.all([
        actIds.length ? s.table("attendance").list({ activityId: { in: actIds } }) : [],
        s.table("monthly_assessments").list({ ...inCases, month: mk }),
        s.table("pulse_responses").list(inCases),
        s.table("deviations").list(inCases),
        s.table("contract_deviations").list({ contractId: r.contractId }),
        sla ? s.table("reports").list({ contractId: r.contractId }) : [],
      ]);
      return { ...base, cases, activities, attendance, monthly_assessments, pulse_responses, deviations, contract_deviations, reports };
    }
    default:
      return base;
  }
}

/**
 * Underlaget för månads- och slutrapporterna i flera ärenden på en gång (frysningen när kommunens resultatfil byggs).
 * ctx.system: se överst i filen – anropas bara för rapporter som läsaren redan får se (kontrollerat via ctx.repo).
 */
export async function loadCasesReportDb(ctx: Ctx, contractId: string, caseIds: readonly string[]): Promise<ReportDb> {
  const s = ctx.system;
  const ids = [...new Set(caseIds)];
  const [contract_areas, profiles] = await Promise.all([s.table("contract_areas").list({ contractId }), s.table("profiles").list()]);
  return { ...EMPTY, contract_areas, profiles, ...(ids.length ? await caseData(ctx, ids) : {}) };
}

/** Rapportens versionskedja (äldst först). ctx.system: bara id, version och status (kommunen ser inte utkasten). */
export async function versionChain(ctx: Ctx, r: Report): Promise<Report[]> {
  const all = await ctx.system.table("reports").list(r.caseId ? { caseId: r.caseId, kind: r.kind } : { kind: r.kind, recipientUserId: r.recipientUserId });
  const byId = new Map(all.map((x) => [x.id, x]));
  const chain: Report[] = [r];
  let cur: Report | undefined = r;
  while (cur && cur.previousId) {
    cur = byId.get(cur.previousId);
    if (cur) chain.unshift(cur);
  }
  cur = r;
  for (let i = 0; i < 20; i++) {
    const id: string = cur.id;
    const nx = all.find((x) => x.previousId === id);
    if (!nx) break;
    chain.push(nx);
    cur = nx;
  }
  return chain;
}

/** En pågående rättelse (ny version som inte är levererad än), annars null. */
export async function pendingCorrection(ctx: Ctx, r: Report): Promise<Report | null> {
  if (!r.correctionPending) return null;
  const nx = await ctx.system.table("reports").get(r.correctionPending);
  return nx && !isDelivered(nx) && !nx.superseded ? nx : null;
}
