// Hanterare för den interna månadsrapporten (Karims beslut 2026-11-18). Registreras via rapporter/handlers.ts – importeras aldrig
// av skärmar.
//
// Behörighet: rollerna i MANAD_ROLES (samordnare, avtalsansvarig, coach och chef) – execute() nekar alla andra (ekonomen, kommunen,
// systemadministratören och deltagaren). Coachen får inte resultatgraden eller målen för den (RATE_HIDDEN_ROLES, Karims beslut
// 2026-11-24) – de skickas inte. Allt underlag läses via ctx.repo, så att policyn (RLS i produktion) avgör vad läsaren ser. Bara
// namnen går via viewerFor (rapporter/load.ts) som veckorapporten: åtkomsten per ärende slås upp med ctx.system (bara flaggor och
// id:n), namnen läses via ctx.repo, och ett ärende med skyddade personuppgifter (den vilande spärren) får bara ärendenumret.
// Inga AI-anrop. Gruppmålet (group_activities.goal, group_goal_results) läses aldrig: gruppaktiviteterna hämtas med pick utan
// målet. Delmålens namn läses aldrig (bara id och område, Karims beslut 2026-11-24). Nivåer och taggar (groupings) läses inte.
// Revisionsloggen: visningen (monthly_overview.viewed) och PDF:en (monthly_overview.downloaded) med avtalet, månaden,
// yrkesområdets kod och ärendenas id:n (raderna rapporten visar) – aldrig namn.
import { fail, ok } from "@/api/contract";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { hidesCommercial } from "@/api/tester-access";
import { areaForMonth } from "@/core/area-changes";
import { isOperational, requireOperational, type OperationalConfig } from "@/core/config";
import { addMonths, monthEnd, monthKey, monthName, type MonthKey } from "@/core/time";
import type { Contract } from "@/data/schema";
import { viewerFor } from "../load";
import { MANAD_ROLES, monthlyOverview, monthlyOverviewPdf, monthlyOverviewViewed, RATE_HIDDEN_ROLES, type MonthlyOverviewView, type OverviewOption } from "./api";
import { buildMonthlyOverview, maskParticipant, overviewFilename, type MonthlyOverview, type OverviewDb } from "./model";

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

/** Månaderna från avtalets start till och med innevarande månad, den senaste först (tom för ett avtal som inte har startat). */
function monthsOf(ctx: Ctx, c: Contract): MonthKey[] {
  const out: MonthKey[] = [];
  for (let mk = monthKey(ctx.now()); mk >= monthKey(c.startsOn); mk = addMonths(mk, -1)) out.push(mk);
  return out;
}
/** Vald månad om den finns bland avtalets, annars förra månaden (eller innevarande i avtalets första månad); null före start. */
function monthFor(ctx: Ctx, c: Contract, month: string | undefined): MonthKey | null {
  const ms = monthsOf(ctx, c);
  if (month && ms.includes(month)) return month;
  return ms[1] ?? ms[0] ?? null;
}
/**
 * Avtalet: det valda om läsaren har det, annars det första som har startat. Ett okänt val ger standardvalet (som månaden och
 * yrkesområdet), och ett avtal som inte har startat är aldrig förvalt.
 */
function chooseContract(ctx: Ctx, all: readonly Chosen[], contractId: string | undefined): Chosen | null {
  const picked = contractId ? all.find((c) => c.contract.id === contractId) : undefined;
  return picked ?? all.find((c) => monthsOf(ctx, c.contract).length > 0) ?? all[0] ?? null;
}

/** Rapporten för avtalet, månaden och yrkesområdet – med namnen efter läsarens behörighet. */
async function overviewOf(ctx: Ctx, { contract, cfg }: Chosen, month: MonthKey, area: string | null): Promise<MonthlyOverview> {
  const from = `${month}-01`;
  const to = monthEnd(month);
  const [cases, changes] = await Promise.all([
    ctx.repo.table("cases").list({ contractId: contract.id }, { orderBy: "id" }),
    ctx.repo.table("case_area_changes").pick(["caseId", "fromArea", "toArea", "effectiveMonth", "changedAt", "seq"], { contractId: contract.id }),
  ]);
  // Avtalets ärenden i yrkesområdet som gällde månaden (också efter avslutet – ett resultat eller en registrerad närvaro kan
  // komma efter slutdatum). Urvalet av deltagare görs i modellen; här hämtas bara månadens rader.
  const ids = cases.filter((c) => !area || areaForMonth(c, changes, month) === area).map((c) => c.id);
  const showCommercial = !hidesCommercial(ctx.actor);
  const none = <T>(): T[] => [];
  const [activities, assessments, goals, achieved, events, claims] = await Promise.all([
    ids.length ? ctx.repo.table("activities").pick(["caseId", "kind", "startsAt", "groupActivityId"], { caseId: { in: ids }, startsAt: { gte: `${from}T00:00`, lte: `${to}T23:59` } }) : none<never>(),
    // Bara godkända bedömningar (CLAUDE.md punkt 6) – utkast och automatiskt ifyllda utkast hämtas inte.
    ids.length ? ctx.repo.table("monthly_assessments").pick(["caseId", "month", "status", "areas"], { caseId: { in: ids }, month, status: "approved" }) : none<never>(),
    // Bara id och område – aldrig delmålets namn (Karims beslut 2026-11-24).
    ctx.repo.table("progress_goals").pick(["areaKey"], { contractId: contract.id }),
    // Uppnått sätts bara av en människa (source manual) – Tränade räknas i modellen ur närvaron på tillfällena i månaden.
    ids.length
      ? ctx.repo.table("case_progress_goals").pick(["caseId", "goalId", "status", "source", "achievedOn"], { caseId: { in: ids }, status: "achieved", achievedOn: { gte: from, lte: to } })
      : none<never>(),
    ids.length ? ctx.repo.table("outcome_events").pick(["caseId", "kind", "occurredOn", "verificationKind"], { caseId: { in: ids }, occurredOn: { gte: from, lte: to } }) : none<never>(),
    // Stegen i Progression och resultat: bara skickade och godkända (förslagen från regeln är inte en människas beslut). Inga belopp.
    showCommercial ? ctx.repo.table("bonus_claims").pick(["caseId", "step", "status", "reachedOn"], { contractId: contract.id, status: { in: ["submitted", "approved"] }, reachedOn: { gte: from, lte: to } }) : none<never>(),
  ]);
  const actIds = activities.map((a) => a.id);
  const groupIds = [...new Set(activities.map((a) => a.groupActivityId).filter((x): x is string => !!x))];
  const ownIds = activities.filter((a) => !a.groupActivityId).map((a) => a.id);
  const [attendance, groups, ownGoals, areas] = await Promise.all([
    actIds.length ? ctx.repo.table("attendance").pick(["activityId", "caseId", "status", "reason"], { activityId: { in: actIds } }) : none<never>(),
    // Utan namn och utan gruppmål (goal, goalVersion) – bara typen, tiden, om den är inställd och delmålen.
    groupIds.length ? ctx.repo.table("group_activities").pick(["kind", "startsAt", "cancelledAt", "progressGoalIds"], { id: { in: groupIds } }) : none<never>(),
    ownIds.length ? ctx.repo.table("activity_progress_goals").pick(["caseId", "goalIds"], { id: { in: ownIds } }) : none<never>(),
    ctx.repo.table("contract_areas").pick(["code", "name"], { contractId: contract.id }),
  ]);
  const db: OverviewDb = {
    cases, case_area_changes: changes, contract_areas: areas, activities, attendance, group_activities: groups, activity_progress_goals: ownGoals,
    monthly_assessments: assessments, progress_goals: goals, case_progress_goals: achieved, outcome_events: events, bonus_claims: claims,
  };
  const view = buildMonthlyOverview(db, {
    cfg, contractStart: contract.startsOn, now: ctx.now(), month, area, showCommercial, showRate: !RATE_HIDDEN_ROLES.includes(ctx.actor.role),
  });
  // Namnen efter läsarens åtkomst per ärende (som veckorapporten): skyddade personuppgifter ger bara ärendenumret och området.
  const byId = new Map(cases.map((c) => [c.id, c]));
  const viewer = await viewerFor(ctx, view.participants.map((r) => byId.get(r.caseId)).filter((c) => !!c));
  return {
    ...view,
    participants: view.participants.map((r) => {
      const c = byId.get(r.caseId);
      return viewer.access(c) === "restricted" ? maskParticipant(r) : { ...r, name: viewer.name(c) };
    }),
  };
}

handleQuery(monthlyOverview, { roles: MANAD_ROLES }, async (ctx, p): Promise<MonthlyOverviewView> => {
  const all = await overviewContracts(ctx);
  const contracts: OverviewOption[] = all.map((c) => ({ value: c.contract.id, label: contractLabel(c.contract) }));
  const chosen = chooseContract(ctx, all, p.contractId);
  if (!chosen) return { allowed: false, contracts, notStarted: null };
  const { contract } = chosen;
  const month = monthFor(ctx, contract, p.month);
  // Avtalet har inte startat: inga månader att visa.
  if (!month) return { allowed: false, contracts, notStarted: { contractId: contract.id, startsOn: contract.startsOn } };
  const [areas, customer] = await Promise.all([ctx.repo.table("contract_areas").list({ contractId: contract.id }), ctx.repo.table("organizations").get(contract.customerId)]);
  const area = p.area && areas.some((a) => a.code === p.area) ? p.area : null;
  const view = await overviewOf(ctx, chosen, month, area);
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
  // Samma rader som rapporten (läsarens behörighet). Bara id:n och koder – aldrig namn.
  const view = await overviewOf(ctx, chosen, p.month, p.area);
  const caseIds = view.participants.map((r) => r.caseId).sort();
  return { chosen, details: { month: p.month, area: p.area, rows: caseIds.length, caseIds } };
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
