// Hanterare för den interna månadsrapporten (Karims beslut 2026-11-18). Registreras via rapporter/handlers.ts – importeras aldrig
// av skärmar.
//
// Behörighet: rollerna i MANAD_ROLES (samordnare, avtalsansvarig, coach och chef) – execute() nekar alla andra (ekonomen, kommunen,
// systemadministratören och deltagaren). Allt underlag läses via ctx.repo, så att policyn (RLS i produktion) avgör vad läsaren
// ser – ingen ctx.system. Inga AI-anrop. Gruppmålet (group_activities.goal, group_goal_results) läses aldrig: gruppaktiviteterna
// hämtas med pick utan målet. Nivåer och taggar (groupings) behövs inte och läses inte.
// Revisionsloggen: visningen (monthly_overview.viewed) och PDF:en (monthly_overview.downloaded) med avtalet, månaden,
// yrkesområdets kod och ärendenas id:n – aldrig namn.
import { fail, ok } from "@/api/contract";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { hidesCommercial } from "@/api/tester-access";
import { areaForMonth } from "@/core/area-changes";
import { isOperational, requireOperational, type OperationalConfig } from "@/core/config";
import { enrolledDays } from "@/core/report-schedule";
import { addMonths, monthEnd, monthKey, monthName, type MonthKey } from "@/core/time";
import type { Case, Contract } from "@/data/schema";
import { MANAD_ROLES, monthlyOverview, monthlyOverviewPdf, monthlyOverviewViewed, type MonthlyOverviewView, type OverviewOption } from "./api";
import { buildMonthlyOverview, overviewFilename, type OverviewDb } from "./model";

type Chosen = { contract: Contract; cfg: OperationalConfig };

/** Läsarens avtal i drift (via ctx.repo), i medlemskapens ordning. */
async function overviewContracts(ctx: Ctx): Promise<Chosen[]> {
  const ids = ctx.actor.contractIds;
  if (!ids.length) return [];
  const contracts = await ctx.repo.table("contracts").list({ id: { in: ids } });
  return ids
    .map((id) => contracts.find((c) => c.id === id))
    .filter((c): c is Contract => !!c && isOperational(c.config))
    .map((contract) => ({ contract, cfg: requireOperational(contract.config) }));
}
const contractLabel = (c: Contract) => `${c.contractNumber} ${c.name}`.trim();

/** Månaderna från avtalets start till och med innevarande månad, den senaste först. */
function monthsOf(ctx: Ctx, c: Contract): MonthKey[] {
  const out: MonthKey[] = [];
  for (let mk = monthKey(ctx.now()); mk >= monthKey(c.startsOn); mk = addMonths(mk, -1)) out.push(mk);
  return out;
}
/** Vald månad om den finns bland avtalets, annars förra månaden (eller innevarande i avtalets första månad). */
function monthFor(ctx: Ctx, c: Contract, month: string | undefined): MonthKey {
  const ms = monthsOf(ctx, c);
  if (month && ms.includes(month)) return month;
  return ms[1] ?? ms[0];
}

/** Urvalet: avtalets ärenden och de som var inskrivna i månaden i yrkesområdet som gällde månaden (samma som modellen). */
async function scopeOf(ctx: Ctx, contractId: string, month: MonthKey, area: string | null) {
  const [cases, changes] = await Promise.all([
    ctx.repo.table("cases").list({ contractId }, { orderBy: "id" }),
    ctx.repo.table("case_area_changes").pick(["caseId", "fromArea", "toArea", "effectiveMonth", "changedAt", "seq"], { contractId }),
  ]);
  const from = `${month}-01`;
  const to = monthEnd(month);
  const inScope = (c: Case) => enrolledDays(c, from, to) > 0 && (!area || areaForMonth(c, changes, month) === area);
  return { cases, changes, scope: cases.filter(inScope) };
}

handleQuery(monthlyOverview, { roles: MANAD_ROLES }, async (ctx, p): Promise<MonthlyOverviewView> => {
  const all = await overviewContracts(ctx);
  const contracts: OverviewOption[] = all.map((c) => ({ value: c.contract.id, label: contractLabel(c.contract) }));
  const chosen = (p.contractId ? all.find((c) => c.contract.id === p.contractId) : all[0]) ?? null;
  if (!chosen) return { allowed: false, contracts };
  const { contract, cfg } = chosen;
  const month = monthFor(ctx, contract, p.month);
  const areas = await ctx.repo.table("contract_areas").list({ contractId: contract.id });
  const area = p.area && areas.some((a) => a.code === p.area) ? p.area : null;
  const from = `${month}-01`;
  const to = monthEnd(month);
  const { cases, changes, scope } = await scopeOf(ctx, contract.id, month, area);
  const scopeIds = scope.map((c) => c.id);
  // Händelserna och stegen gäller avtalets ärenden i yrkesområdet som gällde månaden (också efter avslutet – ett resultat kan
  // komma efter slutdatum). Urvalet görs i modellen; här hämtas bara månadens rader.
  const areaIds = cases.filter((c) => !area || areaForMonth(c, changes, month) === area).map((c) => c.id);
  const showCommercial = !hidesCommercial(ctx.actor);
  const none = <T>(): T[] => [];
  const [persons, activities, assessments, goals, achieved, events, claims, customer] = await Promise.all([
    scope.length ? ctx.repo.table("persons").pick(["firstName", "lastName"], { id: { in: [...new Set(scope.map((c) => c.personId))] } }) : none<{ id: string; firstName: string; lastName: string }>(),
    scopeIds.length ? ctx.repo.table("activities").pick(["caseId", "kind", "startsAt", "groupActivityId"], { caseId: { in: scopeIds }, startsAt: { gte: `${from}T00:00`, lte: `${to}T23:59` } }) : none<never>(),
    // Bara godkända bedömningar (CLAUDE.md punkt 6) – utkast och automatiskt ifyllda utkast hämtas inte.
    scopeIds.length ? ctx.repo.table("monthly_assessments").pick(["caseId", "month", "status", "areas"], { caseId: { in: scopeIds }, month, status: "approved" }) : none<never>(),
    ctx.repo.table("progress_goals").pick(["areaKey", "label", "sortOrder"], { contractId: contract.id }),
    // Uppnått sätts bara av en människa (source manual) – Tränar räknas i modellen ur närvaron på tillfällena i månaden.
    scopeIds.length
      ? ctx.repo.table("case_progress_goals").pick(["caseId", "goalId", "status", "source", "achievedOn"], { caseId: { in: scopeIds }, status: "achieved", achievedOn: { gte: from, lte: to } })
      : none<never>(),
    areaIds.length ? ctx.repo.table("outcome_events").pick(["caseId", "kind", "occurredOn", "verificationKind"], { caseId: { in: areaIds }, occurredOn: { gte: from, lte: to } }) : none<never>(),
    // Stegen i Progression och resultat: bara skickade och godkända (förslagen från regeln är inte en människas beslut). Inga belopp.
    showCommercial ? ctx.repo.table("bonus_claims").pick(["caseId", "step", "status", "reachedOn"], { contractId: contract.id, status: { in: ["submitted", "approved"] }, reachedOn: { gte: from, lte: to } }) : none<never>(),
    ctx.repo.table("organizations").get(contract.customerId),
  ]);
  const actIds = activities.map((a) => a.id);
  const groupIds = [...new Set(activities.map((a) => a.groupActivityId).filter((x): x is string => !!x))];
  const ownIds = activities.filter((a) => !a.groupActivityId).map((a) => a.id);
  const [attendance, groups, ownGoals] = await Promise.all([
    actIds.length ? ctx.repo.table("attendance").pick(["activityId", "caseId", "status", "reason"], { activityId: { in: actIds } }) : none<never>(),
    // Utan namn och utan gruppmål (goal, goalVersion) – bara typen, tiden, om den är inställd och delmålen.
    groupIds.length ? ctx.repo.table("group_activities").pick(["kind", "startsAt", "cancelledAt", "progressGoalIds"], { id: { in: groupIds } }) : none<never>(),
    ownIds.length ? ctx.repo.table("activity_progress_goals").pick(["caseId", "goalIds"], { id: { in: ownIds } }) : none<never>(),
  ]);
  const people = new Map(persons.map((x) => [x.id, x]));
  const personOf = new Map(scope.map((c) => [c.id, c.personId]));
  const db: OverviewDb = {
    cases, case_area_changes: changes, contract_areas: areas, activities, attendance, group_activities: groups, activity_progress_goals: ownGoals,
    monthly_assessments: assessments, progress_goals: goals, case_progress_goals: achieved, outcome_events: events, bonus_claims: claims,
  };
  const view = buildMonthlyOverview(db, {
    cfg, contractStart: contract.startsOn, now: ctx.now(), month, area, showCommercial,
    // Namnet bara när läsaren får se personen (policyn); annars ärendet utan namn (den vilande spärren för skyddade personuppgifter).
    name: (caseId) => {
      const x = people.get(personOf.get(caseId) ?? "");
      return x ? `${x.firstName} ${x.lastName}` : "Skyddade personuppgifter";
    },
  });
  return {
    allowed: true, contractId: contract.id, contracts,
    contract: { number: contract.contractNumber, name: contract.name, customerName: customer?.name ?? "", casePrefix: contract.casePrefix },
    months: monthsOf(ctx, contract).map((m) => ({ value: m, label: monthName(m) })),
    areas: areas.filter((a) => a.active || a.code === area).sort((a, b) => a.code.localeCompare(b.code, "sv")).map((a) => ({ value: a.code, label: `${a.code} ${a.name}` })),
    generatedAt: ctx.now(),
    ...view,
  };
});

/** Avtalet, månaden och yrkesområdet i en loggrad – eller null om läsaren inte har avtalet eller valet inte finns. */
async function logTarget(ctx: Ctx, p: { contractId: string; month: string; area: string | null }) {
  const chosen = (await overviewContracts(ctx)).find((c) => c.contract.id === p.contractId);
  if (!chosen || !monthsOf(ctx, chosen.contract).includes(p.month)) return null;
  if (p.area && !(await ctx.repo.table("contract_areas").list({ contractId: p.contractId })).some((a) => a.code === p.area)) return null;
  const { scope } = await scopeOf(ctx, p.contractId, p.month, p.area);
  // Bara id:n och koder – aldrig namn. caseIds = deltagarna vars rader rapporten visade (läsarens behörighet).
  return { chosen, details: { month: p.month, area: p.area, rows: scope.length, caseIds: scope.map((c) => c.id).sort() } };
}
const NOT_FOUND = "Rapporten finns inte för det valet.";

handleCommand(monthlyOverviewViewed, { roles: MANAD_ROLES, silent: true }, async (ctx, p) => {
  const t = await logTarget(ctx, p);
  if (!t) return fail("not_found", NOT_FOUND);
  await ctx.audit({ action: "monthly_overview.viewed", entity: "contract", entityId: p.contractId, contractId: p.contractId, details: t.details });
  return ok({});
});

handleCommand(monthlyOverviewPdf, { roles: MANAD_ROLES, silent: true }, async (ctx, p) => {
  const t = await logTarget(ctx, p);
  if (!t) return fail("not_found", NOT_FOUND);
  // Loggen skrivs innan filnamnet lämnas ut – misslyckas loggningen byggs ingen PDF.
  await ctx.audit({ action: "monthly_overview.downloaded", entity: "contract", entityId: p.contractId, contractId: p.contractId, details: { ...t.details, format: "pdf" } });
  return ok({ filename: overviewFilename(t.chosen.contract.casePrefix, p.month) });
});
