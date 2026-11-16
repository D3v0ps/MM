// Hanterare för området delmål (Karims beslut 2026-11-11, SPEC §7.7 och §7.17). Registreras via src/api/handlers.ts – importeras
// aldrig av skärmar.
//
// Läsning och skrivning via ctx.repo (policyn/RLS i 0043: katalogen för Miljonbemanning i avtalet utom ekonomen, skrivs av
// avtalsansvarig och systemadministratören; läget per ärende med full- eller teamåtkomst, skrivs av den som arbetar i ärendet i
// eget namn med källan manual). ctx.system bara för systemsteg: om delmålet står någonstans (katalogens "används"), förslaget om
// Progression och resultat (ensureBonusClaims) och revisionsloggen. Loggen får id:n, datum och läget – aldrig delmålets namn.
// Uppnått sätts bara här, av en människa – AI sätter aldrig något (CLAUDE.md punkt 5). Ett uppnått delmål är ingen nivå.
import { fail, ok } from "@/api/contract";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { isOperational, progressionAreas, type OperationalConfig } from "@/core/config";
import { caseGoalId, GOAL_STATE_ICON, goalLabelProblem, goalStateText, sameGoalLabel, sortGoals, STEP_ITEM_LABEL, stepOfItem, stepItemsOf } from "@/core/progress-goals";
import { dayOf, fmtDate } from "@/core/time";
import { uniq } from "@/core/util";
import { UniqueError } from "@/data/repo";
import { STEP_ITEMS, type ActivityKind, type Case, type CaseProgressGoal, type Contract, type ProgressGoal, type StepItem } from "@/data/schema";
import { ensureBonusClaims } from "../bonus/ensure";
import { canEditCase } from "../_shared/context";
import { goalPickerAreas } from "../_shared/progress-goals";
import {
  CATALOG_ROLES, caseGoals, GOAL_READERS, GOAL_SETTERS, goalAchieve, goalCatalog, goalCreate, goalEvidence, goalMove, goalPicker, goalSetActive, goalUndo, goalUpdate,
  type CaseGoalsView, type GoalPickerArea,
} from "./api";

const NOT_FOUND = "Delmålet finns inte, eller så har du inte behörighet att ändra det.";
const CASE_NOT_FOUND = "Ärendet finns inte, eller så har du inte behörighet att se det.";
const NO_EDIT = "Du kan inte ändra delmålen i det här ärendet.";
/** Statusar där delmålen kan markeras: insatsen har startat (också avslutad – ett intyg kan komma efteråt). */
const STARTED: readonly Case["status"][] = ["active", "paused", "closed"];
const KIND_LABEL: Record<ActivityKind, string> = { möte: "Coachträff", yrkesmoment: "Yrkesmoment", praktikdag: "Praktikdag", arbetsgivarbesök: "Arbetsgivarbesök", annat: "Annat" };

/** Avtalet och dess driftkonfiguration via behörigheten, eller null. */
async function contractCfg(ctx: Ctx, contractId: string): Promise<{ contract: Contract; cfg: OperationalConfig } | null> {
  const contract = await ctx.repo.table("contracts").get(contractId);
  return contract && isOperational(contract.config) ? { contract, cfg: contract.config } : null;
}
/** Aktörens första aktiva avtal (fast ordning). */
async function firstContractId(ctx: Ctx): Promise<string | null> {
  const contracts = (await ctx.repo.table("contracts").list({ status: "active" }, { orderBy: "id" })).filter((c) => ctx.actor.role === "admin" || ctx.actor.contractIds.includes(c.id));
  return contracts[0]?.id ?? null;
}
/** Områdena i avtalets ordning med delmålen (sorterade). */
function byArea<T extends Pick<ProgressGoal, "areaKey" | "sortOrder" | "label" | "id">>(cfg: OperationalConfig, goals: readonly T[]): { key: string; label: string; goals: T[] }[] {
  const areas = progressionAreas(cfg);
  const sorted = sortGoals(goals, areas.map((a) => a.key));
  return areas.map((a) => ({ key: a.key, label: a.label, goals: sorted.filter((g) => g.areaKey === a.key) }));
}

// ================================================================ Valet "Tränar delmål"
handleQuery(goalPicker, { roles: ["samordnare", "avtalsansvarig", "coach", "handledare"] }, async (ctx, p): Promise<GoalPickerArea[]> => {
  const c = p.caseId ? await ctx.repo.table("cases").get(p.caseId) : null;
  if (p.caseId && !c) return [];
  const contractId = c?.contractId ?? p.contractId ?? (await firstContractId(ctx));
  return contractId ? goalPickerAreas(ctx.repo, contractId) : [];
});

// ================================================================ Katalogen
handleQuery(goalCatalog, { roles: CATALOG_ROLES }, async (ctx, p) => {
  const mine = (await ctx.repo.table("contracts").list({ status: "active" }, { orderBy: "id" })).filter((c) => ctx.actor.role === "admin" || ctx.actor.contractIds.includes(c.id));
  const contract = p.contractId ? mine.find((c) => c.id === p.contractId) : mine[0];
  if (!contract || !isOperational(contract.config)) return null;
  const goals = await ctx.repo.table("progress_goals").list({ contractId: contract.id });
  return {
    contractId: contract.id,
    contracts: mine.map((c) => ({ id: c.id, name: c.name })),
    canEdit: CATALOG_ROLES.includes(ctx.actor.role),
    areas: byArea(contract.config, goals).map((a) => ({
      key: a.key, label: a.label, goals: a.goals.map((g) => ({ id: g.id, label: g.label, active: g.active, stepItems: [...g.stepItems] })),
    })),
    stepItems: STEP_ITEMS.map((key) => ({ key, label: STEP_ITEM_LABEL[key], step: stepOfItem(key) })),
  };
});

/** Punkterna i steg 1–2: kända nycklar, i modellens ordning, utan dubbletter. */
const cleanItems = (items: readonly string[]): StepItem[] => STEP_ITEMS.filter((k) => items.includes(k));
/** Samma namn finns redan i området (ett annat delmål, aktivt eller inaktiverat). */
const duplicateIn = (goals: readonly ProgressGoal[], areaKey: string, label: string, except: string | null) =>
  goals.some((g) => g.areaKey === areaKey && g.id !== except && sameGoalLabel(g.label, label));
const DUPLICATE = "Det finns redan ett delmål med det namnet i området.";

handleCommand(goalCreate, { roles: CATALOG_ROLES }, async (ctx, p) => {
  const x = await contractCfg(ctx, p.contractId);
  if (!x || !(ctx.actor.role === "admin" || ctx.actor.contractIds.includes(p.contractId))) return fail("not_found", "Avtalet finns inte, eller så har du inte behörighet till det.");
  if (!x.cfg.progression.areas.includes(p.areaKey)) return fail("area", "Området finns inte bland avtalets progressionsområden.");
  const label = p.label.trim().replace(/\s+/g, " ");
  const problem = goalLabelProblem(label);
  if (problem) return fail("invalid", problem);
  const goals = await ctx.repo.table("progress_goals").list({ contractId: p.contractId });
  if (duplicateIn(goals, p.areaKey, label, null)) return fail("duplicate", DUPLICATE);
  const last = Math.max(0, ...goals.filter((g) => g.areaKey === p.areaKey).map((g) => g.sortOrder));
  const row: ProgressGoal = {
    id: ctx.newId("pg"), contractId: p.contractId, areaKey: p.areaKey, label, sortOrder: last + 10, active: true, stepItems: cleanItems(p.stepItems), createdBy: ctx.actor.userId,
    createdAt: ctx.now(), updatedBy: null, updatedAt: null,
  };
  await ctx.repo.table("progress_goals").insert(row);
  await ctx.audit({ action: "progress_goal.created", entity: "progress_goal", entityId: row.id, contractId: row.contractId, details: { areaKey: row.areaKey, stepItems: row.stepItems } });
  return ok({ id: row.id });
});

/** Delmålet i katalogen för en ändring (behörigheten: avtalsansvarig och systemadministratören i avtalet). */
async function catalogGoal(ctx: Ctx, id: string): Promise<ProgressGoal | null> {
  const g = await ctx.repo.table("progress_goals").get(id);
  return g && (ctx.actor.role === "admin" || ctx.actor.contractIds.includes(g.contractId)) ? g : null;
}

handleCommand(goalUpdate, { roles: CATALOG_ROLES }, async (ctx, p) => {
  const g = await catalogGoal(ctx, p.id);
  if (!g) return fail("not_found", NOT_FOUND);
  const label = p.label.trim().replace(/\s+/g, " ");
  const problem = goalLabelProblem(label);
  if (problem) return fail("invalid", problem);
  const stepItems = cleanItems(p.stepItems);
  const fields = [label !== g.label ? "label" : null, JSON.stringify(stepItems) !== JSON.stringify(g.stepItems) ? "stepItems" : null].filter((f): f is string => !!f);
  if (!fields.length) return ok({ changed: false });
  if (label !== g.label && duplicateIn(await ctx.repo.table("progress_goals").list({ contractId: g.contractId }), g.areaKey, label, g.id)) return fail("duplicate", DUPLICATE);
  await ctx.repo.table("progress_goals").update(g.id, { label, stepItems, updatedAt: ctx.now(), updatedBy: ctx.actor.userId });
  await ctx.audit({ action: "progress_goal.updated", entity: "progress_goal", entityId: g.id, contractId: g.contractId, details: { fields, stepItems } });
  return ok({ changed: true });
});

handleCommand(goalMove, { roles: CATALOG_ROLES }, async (ctx, p) => {
  const g = await catalogGoal(ctx, p.id);
  if (!g) return fail("not_found", NOT_FOUND);
  const x = await contractCfg(ctx, g.contractId);
  if (!x) return fail("not_found", NOT_FOUND);
  const area = sortGoals((await ctx.repo.table("progress_goals").list({ contractId: g.contractId, areaKey: g.areaKey })), x.cfg.progression.areas);
  const i = area.findIndex((y) => y.id === g.id);
  const j = p.direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= area.length) return ok({ moved: false });
  // Ny ordning för hela området (10, 20, 30 …) – bara de rader vars plats ändras skrivs.
  const order = [...area];
  [order[i], order[j]] = [order[j], order[i]];
  const now = ctx.now();
  for (const [k, y] of order.entries()) {
    const sortOrder = (k + 1) * 10;
    if (y.sortOrder !== sortOrder) await ctx.repo.table("progress_goals").update(y.id, { sortOrder, updatedAt: now, updatedBy: ctx.actor.userId });
  }
  await ctx.audit({ action: "progress_goal.reordered", entity: "progress_goal", entityId: g.id, contractId: g.contractId, details: { areaKey: g.areaKey, direction: p.direction, order: order.map((y) => y.id) } });
  return ok({ moved: true });
});

handleCommand(goalSetActive, { roles: CATALOG_ROLES }, async (ctx, p) => {
  const g = await catalogGoal(ctx, p.id);
  if (!g) return fail("not_found", NOT_FOUND);
  if (g.active === p.active) return ok({ changed: false });
  if (p.active && duplicateIn((await ctx.repo.table("progress_goals").list({ contractId: g.contractId })).filter((y) => y.active), g.areaKey, g.label, g.id)) return fail("duplicate", DUPLICATE);
  await ctx.repo.table("progress_goals").update(g.id, { active: p.active, updatedAt: ctx.now(), updatedBy: ctx.actor.userId });
  await ctx.audit({ action: p.active ? "progress_goal.activated" : "progress_goal.deactivated", entity: "progress_goal", entityId: g.id, contractId: g.contractId, details: { areaKey: g.areaKey } });
  return ok({ changed: true });
});

// ================================================================ Deltagarkortet
/** Underlaget att välja vid Uppnått: ärendets passerade tillfällen, mötesrapporter och anteckningar – nyast först, högst 15 av varje. */
async function evidenceOptions(ctx: Ctx, c: Case): Promise<{ value: string; label: string }[]> {
  const now = ctx.now();
  const [acts, checkIns, notes] = await Promise.all([
    ctx.repo.table("activities").list({ caseId: c.id, startsAt: { lte: now } }, { orderBy: "startsAt", desc: true, limit: 15 }),
    ctx.repo.table("check_ins").list({ caseId: c.id }, { orderBy: "heldAt", desc: true, limit: 15 }),
    ctx.repo.table("case_notes").list({ caseId: c.id }, { orderBy: "occurredOn", desc: true, limit: 30 }),
  ]);
  const groupIds = uniq(acts.map((a) => a.groupActivityId).filter((x): x is string => !!x));
  const groups = new Map((groupIds.length ? await ctx.repo.table("group_activities").pick(["name"], { id: { in: groupIds } }) : []).map((g) => [g.id, g.name]));
  return [
    ...acts.map((a) => ({ value: `activity:${a.id}`, label: `${(a.groupActivityId && groups.get(a.groupActivityId)) || KIND_LABEL[a.kind]} ${fmtDate(dayOf(a.startsAt))}`, at: a.startsAt })),
    ...checkIns.map((x) => ({ value: `check_in:${x.id}`, label: `Mötesrapport ${fmtDate(dayOf(x.heldAt))}`, at: x.heldAt })),
    ...notes.filter((n) => !n.removedAt).slice(0, 15).map((n) => ({ value: `case_note:${n.id}`, label: `Anteckning ${fmtDate(n.occurredOn)}`, at: `${n.occurredOn}T23:59` })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.value < b.value ? -1 : 1)).map(({ value, label }) => ({ value, label }));
}

handleQuery(caseGoals, { roles: GOAL_READERS }, async (ctx, p): Promise<CaseGoalsView> => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return { on: false };
  const x = await contractCfg(ctx, c.contractId);
  if (!x) return { on: false };
  const [goals, rows] = await Promise.all([ctx.repo.table("progress_goals").list({ contractId: c.contractId }), ctx.repo.table("case_progress_goals").list({ caseId: c.id })]);
  const rowOf = new Map(rows.map((r) => [r.goalId, r]));
  // Inaktiverade delmål visas bara när ärendet har ett läge för dem.
  const shown = goals.filter((g) => g.active || rowOf.has(g.id));
  const canEdit = GOAL_SETTERS.includes(ctx.actor.role) && STARTED.includes(c.status) && !!c.startDate && (await canEditCase(ctx, c));
  return {
    on: true, caseId: c.id, caseNumber: c.caseNumber, canEdit, today: dayOf(ctx.now()), minDate: c.startDate,
    areas: byArea(x.cfg, shown).filter((a) => a.goals.length).map((a) => ({
      key: a.key, label: a.label,
      goals: a.goals.map((g) => {
        const r = rowOf.get(g.id) ?? null;
        const state = r?.status ?? "none";
        return { goalId: g.id, label: g.label, state, stateText: goalStateText(r), icon: GOAL_STATE_ICON[state], source: r?.source ?? null, achievedOn: r?.achievedOn ?? null, inactive: !g.active };
      }),
    })),
  };
});

handleQuery(goalEvidence, { roles: GOAL_SETTERS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  return c && (await canEditCase(ctx, c)) ? evidenceOptions(ctx, c) : [];
});

/** Ärendet och delmålet för Uppnått och Ångra – via behörigheten. */
async function caseAndGoal(ctx: Ctx, caseId: string, goalId: string): Promise<{ c: Case; g: ProgressGoal; row: CaseProgressGoal | null } | { error: "not_found" | "forbidden"; text: string }> {
  const c = await ctx.repo.table("cases").get(caseId);
  if (!c) return { error: "not_found", text: CASE_NOT_FOUND };
  if (!(await canEditCase(ctx, c))) return { error: "forbidden", text: NO_EDIT };
  const g = await ctx.repo.table("progress_goals").get(goalId);
  if (!g || g.contractId !== c.contractId) return { error: "not_found", text: "Delmålet finns inte i ärendets avtal. Ladda om sidan." };
  const row = await ctx.repo.table("case_progress_goals").first({ caseId: c.id, goalId: g.id });
  return { c, g, row };
}

handleCommand(goalAchieve, { roles: GOAL_SETTERS }, async (ctx, p) => {
  const r = await caseAndGoal(ctx, p.caseId, p.goalId);
  if ("error" in r) return fail(r.error, r.text);
  const { c, g, row } = r;
  if (!STARTED.includes(c.status) || !c.startDate) return fail("wrong_status", "Delmål kan markeras när insatsen har startat.");
  if (row?.status === "achieved") return fail("already", "Delmålet är redan uppnått. Ladda om sidan.");
  // Ett nytt läge för ett inaktiverat delmål sätts inte – ett som redan tränas kan fortfarande bli uppnått.
  if (!g.active && !row) return fail("inactive", "Delmålet är inaktiverat och kan inte markeras.");
  const today = dayOf(ctx.now());
  if (p.achievedOn > today) return fail("date", "Datumet kan inte vara i framtiden.");
  if (p.achievedOn < c.startDate) return fail("date", `Datumet kan inte vara före startdatumet ${fmtDate(c.startDate)}.`);
  // Underlaget hör till ärendet (samma kontroll som databasen, 0043) – läst via behörigheten.
  if (p.evidence) {
    const id = p.evidence.id;
    const e = p.evidence.kind === "activity" ? await ctx.repo.table("activities").get(id)
      : p.evidence.kind === "check_in" ? await ctx.repo.table("check_ins").get(id)
        : await ctx.repo.table("case_notes").get(id);
    if (!e || e.caseId !== c.id) return fail("evidence", "Underlaget finns inte i ärendet. Ladda om sidan.");
  }
  const patch = {
    status: "achieved" as const, source: "manual" as const, achievedOn: p.achievedOn, evidenceKind: p.evidence?.kind ?? null, evidenceId: p.evidence?.id ?? null,
    setBy: ctx.actor.userId, setAt: ctx.now(),
  };
  const table = ctx.repo.table("case_progress_goals");
  const ALREADY = "Delmålet är redan uppnått. Ladda om sidan.";
  // Från Tränar med ett villkor på läget: två som markerar samtidigt går inte båda igenom (den andra får "already").
  const fromTraining = (id: string) => table.updateIf(id, { status: "training" }, patch);
  let from: "none" | "training" = row ? "training" : "none";
  let wasAuto = row?.source === "auto";
  if (row) {
    if (!(await fromTraining(row.id))) return fail("already", ALREADY);
  } else {
    try {
      await table.insert({ id: caseGoalId(c.id, g.id), caseId: c.id, contractId: c.contractId, goalId: g.id, ...patch });
    } catch (e) {
      // Tränar sattes automatiskt under tiden (närvaron): raden finns – den blir uppnådd.
      if (!(e instanceof UniqueError) && (e as { code?: unknown } | null)?.code !== "23505") throw e;
      const again = await table.first({ caseId: c.id, goalId: g.id });
      if (!again) throw e;
      from = "training";
      wasAuto = again.source === "auto";
      if (!(await fromTraining(again.id))) return fail("already", ALREADY);
    }
  }
  await ctx.audit({
    action: "case_progress_goal.achieved", entity: "case_progress_goal", entityId: caseGoalId(c.id, g.id), contractId: c.contractId,
    details: { caseId: c.id, goalId: g.id, achievedOn: p.achievedOn, from, ...(wasAuto ? { wasAuto: true } : {}), ...(p.evidence ? { evidenceKind: p.evidence.kind, evidenceId: p.evidence.id } : {}) },
  });
  // Ett delmål som räknas mot steg 1–2 kan göra en punkt uppfylld: förslaget om Progression och resultat prövas direkt för ärendet
  // (samma regler som jobbet, ingen AI – en människa granskar och skickar alltid). Bästa försök: delmålet är redan sparat.
  let suggested = 0;
  if (g.stepItems.some((it) => stepItemsOf(1).includes(it) || stepItemsOf(2).includes(it))) {
    try {
      suggested = (await ensureBonusClaims(ctx, { floor: null, caseIds: [c.id] })).created.length;
    } catch (e) {
      console.error("delmålen: förslaget om progression och resultat kunde inte prövas", (e as { code?: unknown; name?: unknown } | null)?.code ?? (e as { name?: unknown } | null)?.name ?? "error");
    }
  }
  return ok({ suggested });
});

handleCommand(goalUndo, { roles: GOAL_SETTERS }, async (ctx, p) => {
  const r = await caseAndGoal(ctx, p.caseId, p.goalId);
  if ("error" in r) return fail(r.error, r.text);
  const { c, g, row } = r;
  if (!row || row.status !== "achieved") return fail("not_achieved", "Delmålet är inte uppnått. Ladda om sidan.");
  const table = ctx.repo.table("case_progress_goals");
  if (p.to === "training") {
    const patch = { status: "training" as const, source: "manual" as const, achievedOn: null, evidenceKind: null, evidenceId: null, setBy: ctx.actor.userId, setAt: ctx.now() };
    if (!(await table.updateIf(row.id, { status: "achieved" }, patch))) return fail("not_achieved", "Delmålet är inte uppnått. Ladda om sidan.");
  } else {
    await table.remove(row.id);
  }
  await ctx.audit({
    action: "case_progress_goal.undone", entity: "case_progress_goal", entityId: row.id, contractId: c.contractId,
    details: { caseId: c.id, goalId: g.id, from: "achieved", to: p.to, achievedOn: row.achievedOn },
  });
  return ok({});
});
