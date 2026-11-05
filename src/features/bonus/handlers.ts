// Hanterare för området bonus (SPEC §7.17, beslut 2026-11-04). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
//
// Flödet: servern föreslår (jobbet report_schedule, ./ensure.ts) eller coachen skapar ett anspråk → den som arbetar i ärendet
// granskar, fyller i verifiering eller checklista och skickar (redovisningsunderlaget fryses, beställande handläggare får ett mejl
// utan personuppgifter) → kommunen godkänner eller avslår i portalen (eller beslutar med mejl och samordnaren eller avtalsansvarig
// registrerar det) → huvudcoachen får en notis → ekonomen fakturerar godkända anspråk på bonusfakturan (src/core/bonus-billing.ts).
// Inga belopp i något svar här – beloppen finns bara hos ekonomen. Bonus är ett ekonomiskt villkor: begränsade testare ser det inte
// (hidesCommercial – kortet säger on: false och sidorna nekas med commercial).
// Skrivning via ctx.repo (RLS och policy.ts prövar övergångarna, 0039). ctx.system bara för notisen till huvudcoachen (en annan
// användare) och för revisionsloggen. Revisionsloggen får id:n, steg och beslut – aldrig kommentarer, motiveringar eller namn.
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { hidesCommercial } from "@/api/tester-access";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { loadDb } from "@/api/load";
import {
  approvedAssessments, bonusAttendance, BONUS_CHECKLIST_LABEL, BONUS_STATUS_TEXT, FOLLOWS_STEP3, isActiveClaim, manualCreateProblem, speedDeadline, step3For, stepKind, submitProblems,
  sustainDate,
} from "@/core/bonus";
import { bonusModel, bonusStepLabel, isOperational, type BonusModel, type OperationalConfig } from "@/core/config";
import { eventLabel, personName } from "@/core/labels";
import { dayOf } from "@/core/time";
import { looksLikePnr } from "@/core/validation";
import { PolicyError, UniqueError } from "@/data/repo";
import { BONUS_CHECKLIST_ITEMS, type BonusChecklist, type BonusClaim, type BonusClaimDecision, type Case, type Contract } from "@/data/schema";
import { notifyReferrer } from "../_shared/context";
import {
  bonusCard, bonusCreate, bonusDecide, bonusPortal, bonusRecordMail, bonusReview, bonusSave, bonusSubmit, bonusUnderlag, bonusWithdraw, type BonusCardView, type BonusDecisionView,
  type BonusPortalView, type BonusReviewView, type BonusStepRow, type BonusUnderlag,
} from "./api";
import { buildUnderlag, bonusRuleText, underlagFilename, windowEndOf } from "./underlag";

/** Arbetar i ärendet: granskar, skapar, skickar och återtar. Rollen handledare – vilande sedan 2026-10-09 (spegel av policy.ts). */
const WORKERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare"];
/** Läser bonus på deltagarkortet och i granskningen (chef och systemadministratör i läsläge). */
const READERS: readonly Role[] = [...WORKERS, "chef", "admin"];
/** Registrerar ett beslut som kommunen skickade med mejl. */
const MAIL_RECORDERS: readonly Role[] = ["samordnare", "avtalsansvarig"];
const NOT_FOUND = "Anspråket finns inte, eller så har du inte behörighet att se det.";
const CASE_NOT_FOUND = "Ärendet finns inte, eller så har du inte behörighet att se det.";
const OFF = "Bonus är inte påslagen i avtalet.";
const LOCKED = "Anspråket är redan skickat, beslutat eller återtaget. Ladda om sidan.";
const PNR = "Det ser ut som ett personnummer i texten. Ta bort det – ärendenumret räcker.";

// ---------------------------------------------------------------- Uppslag
type CaseCtx = { c: Case; contract: Contract; cfg: OperationalConfig; m: BonusModel };
/** Ärendet med avtalet och bonusmodellen (null = ärendet syns inte för aktören, eller bonus är inte påslagen). */
async function caseCtx(ctx: Ctx, caseId: string): Promise<CaseCtx | null> {
  const c = await ctx.repo.table("cases").get(caseId);
  if (!c) return null;
  const contract = await ctx.repo.table("contracts").get(c.contractId);
  if (!contract || !isOperational(contract.config)) return null;
  const m = bonusModel(contract.config);
  return m ? { c, contract, cfg: contract.config, m } : null;
}
/** Aktören arbetar i ärendet (workOn i policy.ts): rollen och personen läsbar via behörigheten (full- eller teamåtkomst). */
async function worksOn(ctx: Ctx, c: Pick<Case, "personId">): Promise<boolean> {
  return WORKERS.includes(ctx.actor.role) && (await ctx.repo.table("persons").get(c.personId)) !== null;
}
const nameOf = (p: { firstName: string; lastName: string } | null): string => (p ? `${p.firstName} ${p.lastName}` : "–");
const statusOf = (s: BonusClaim["status"] | "none") => ({ statusText: BONUS_STATUS_TEXT[s].text, icon: BONUS_STATUS_TEXT[s].icon });

/**
 * Underlaget för anspråket: det frysta (skickat), eller en förhandsvisning av det som skulle frysas nu. sentBy = den som skickar
 * just nu (Skicka till kommunen); null = förhandsvisning, märkt "Utkast – inte skickat" och utan "Skickat … av …".
 */
async function underlagOf(ctx: Ctx, x: CaseCtx, k: BonusClaim, sentBy: string | null): Promise<BonusUnderlag> {
  if (k.snapshot) return k.snapshot as unknown as BonusUnderlag;
  const byCase = { caseId: x.c.id };
  const db = await loadDb(ctx.repo, ["activities", "attendance", "monthly_assessments", "monthly_plans", "outcome_events", "placements", "bonus_claims", "contract_areas", "profiles", "employers"], {
    activities: byCase, attendance: byCase, monthly_assessments: byCase, monthly_plans: byCase, outcome_events: byCase, placements: byCase, bonus_claims: byCase,
    contract_areas: { contractId: x.c.contractId },
  });
  const customer = await ctx.repo.table("organizations").get(x.contract.customerId);
  return buildUnderlag({ db, cfg: x.cfg, model: x.m, claim: k, case: x.c, contract: x.contract, customerName: customer?.name ?? "", now: ctx.now(), sentBy });
}
async function decisionOf(ctx: Ctx, k: BonusClaim): Promise<BonusDecisionView | null> {
  const d = await ctx.repo.table("bonus_claim_decisions").first({ claimId: k.id });
  if (!d) return null;
  const profiles = await ctx.repo.table("profiles").list({ id: { in: [d.decidedBy ?? d.recordedBy] } });
  return { decision: d.decision, at: d.decidedAt, byName: personName(profiles, d.decidedBy ?? d.recordedBy), via: d.via, note: d.note };
}
/** Steg 4 och 5: anspråket för steg 3 som det bygger på. */
const followsOf = async (ctx: Ctx, k: Pick<BonusClaim, "followsClaimId">): Promise<BonusClaim | null> => (k.followsClaimId ? ctx.repo.table("bonus_claims").get(k.followsClaimId) : null);
/** Kommunen kan godkänna steg 4 och 5 först när steg 3 är godkänt. */
const waitsForStep3 = (k: Pick<BonusClaim, "step" | "followsClaimId">, step3: Pick<BonusClaim, "status"> | null) =>
  FOLLOWS_STEP3.includes(k.step ?? 0) && !!k.followsClaimId && step3?.status !== "approved";

// ================================================================ Frågor

// ---------------------------------------------------------------- bonus.kort (deltagarkortet)
handleQuery(bonusCard, { roles: READERS }, async (ctx, p): Promise<BonusCardView> => {
  // Bonus är ett ekonomiskt villkor: begränsade testare ser det inte (src/api/tester-access.ts).
  if (hidesCommercial(ctx.actor)) return { on: false };
  const x = await caseCtx(ctx, p.caseId);
  if (!x) return { on: false };
  const { c, m } = x;
  const canAct = await worksOn(ctx, c);
  const claims = (await ctx.repo.table("bonus_claims").list({ caseId: c.id })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  const steps: BonusStepRow[] = m.steps
    .slice()
    .sort((a, b) => a.step - b.step)
    .map((s) => {
      const mine = claims.filter((k) => k.step === s.step);
      const shown = mine.find(isActiveClaim) ?? mine[0] ?? null;
      const problem = manualCreateProblem(c, claims, s.step);
      return {
        step: s.step, label: s.label, status: shown?.status ?? "none", ...statusOf(shown?.status ?? "none"), claimId: shown?.id ?? null, source: shown?.source ?? null,
        // Steg 4 och 5: resultatdatum är bonussteg 3:s (det levande), aldrig kopian på anspråket.
        reachedOn: (shown?.followsClaimId ? claims.find((y) => y.id === shown.followsClaimId)?.reachedOn : shown?.reachedOn) ?? null, submittedAt: shown?.submittedAt ?? null, decidedAt: shown?.decidedAt ?? null, canCreate: canAct && !problem, createProblem: canAct ? problem : null,
        history: mine.filter((k) => k !== shown).map((k) => ({ claimId: k.id, status: k.status, statusText: BONUS_STATUS_TEXT[k.status].text, at: k.decidedAt ?? k.withdrawnAt ?? k.createdAt })),
      };
    });
  return { on: true, caseId: c.id, caseNumber: c.caseNumber, canAct, steps, rules: m.steps.map((s) => `Bonussteg ${s.step} · ${s.label}: ${bonusRuleText(m, s.step)}`) };
});

// ---------------------------------------------------------------- bonus.granska (Granska och skicka)
handleQuery(bonusReview, { roles: READERS, commercial: true }, async (ctx, p): Promise<BonusReviewView | null> => {
  const k = await ctx.repo.table("bonus_claims").get(p.claimId);
  if (!k || k.step == null) return null;
  const x = await caseCtx(ctx, k.caseId);
  if (!x) return null;
  const { c, m } = x;
  const today = dayOf(ctx.now());
  const [person, canWork, events, assessments, step3, decision, profiles] = await Promise.all([
    ctx.repo.table("persons").get(c.personId), worksOn(ctx, c), ctx.repo.table("outcome_events").list({ caseId: c.id }), ctx.repo.table("monthly_assessments").list({ caseId: c.id }),
    followsOf(ctx, k), decisionOf(ctx, k), ctx.repo.table("profiles").list({ id: { in: [k.submittedBy, k.withdrawnBy].filter((v): v is string => !!v) } }),
  ]);
  const acts = await loadDb(ctx.repo, ["activities", "attendance"], { activities: { caseId: c.id }, attendance: { caseId: c.id } });
  const att = bonusAttendance(acts, c, m, { now: ctx.now() });
  const nApproved = approvedAssessments({ monthly_assessments: assessments }, c.id).length;
  const evId = step3 ? step3.outcomeEventId : k.outcomeEventId;
  const ev = evId ? events.find((e) => e.id === evId) ?? null : null;
  const checklist = BONUS_CHECKLIST_ITEMS.map((item) => ({ item, label: BONUS_CHECKLIST_LABEL[item], done: !!(k.checklist as BonusChecklist)[item]?.done, where: (k.checklist as BonusChecklist)[item]?.where ?? "" }));
  const problems = k.status === "suggested" ? submitProblems({ claim: k, case: c, step3, attendance: att, approvedAssessments: nApproved, today }, m) : [];
  const resultDay = step3?.reachedOn ?? null;
  return {
    claimId: k.id, caseId: c.id, caseNumber: c.caseNumber, participantName: nameOf(person), step: k.step, label: bonusStepLabel(m, k.step), status: k.status, ...statusOf(k.status), source: k.source,
    canAct: canWork && k.status === "suggested", canWithdraw: canWork && (k.status === "suggested" || k.status === "submitted"),
    canRecordMail: MAIL_RECORDERS.includes(ctx.actor.role) && canWork && k.status === "submitted" && !waitsForStep3(k, step3),
    rule: bonusRuleText(m, k.step),
    fields: { basis: k.basis, reachedOn: k.reachedOn, verificationKind: k.verificationKind, verificationOn: k.verificationOn, checklist },
    needsChecklist: k.step === 1, needsVerification: k.step >= 2,
    facts: {
      start: c.startDate, end: c.endDate, attendancePercent: att.percent, attendanceMeets: att.meets, minPercent: m.attendanceMinPercent, approvedAssessments: nApproved,
      event: ev ? { label: eventLabel(ev.kind), date: ev.occurredOn, actor: ev.actor, verificationKind: ev.verificationKind } : null,
      step3: step3 ? { status: step3.status, statusText: BONUS_STATUS_TEXT[step3.status].text, reachedOn: step3.reachedOn } : null,
      sustainDue: k.step === 4 && resultDay ? sustainDate(resultDay, m) : null,
      speedDeadline: k.step === 5 && c.startDate ? speedDeadline(c.startDate, m) : null,
      windowEnd: k.step === 3 ? windowEndOf(c, m) : null,
    },
    problems,
    underlag: await underlagOf(ctx, x, k, null),
    submitted: k.submittedAt ? { at: k.submittedAt, byName: personName(profiles, k.submittedBy) } : null,
    withdrawn: k.withdrawnAt ? { at: k.withdrawnAt, byName: personName(profiles, k.withdrawnBy) } : null,
    decision,
    waitingForStep3: k.status === "submitted" && waitsForStep3(k, step3),
  };
});

// ---------------------------------------------------------------- bonus.portal (kommunens beslut)
handleQuery(bonusPortal, { roles: ["kommun_handlaggare"], commercial: true }, async (ctx, p): Promise<BonusPortalView | null> => {
  // RLS och policy.ts: kommunen läser bara skickade och beslutade anspråk i sina ärenden.
  const k = await ctx.repo.table("bonus_claims").get(p.claimId);
  if (!k || k.step == null || !k.snapshot) return null;
  const c = await ctx.repo.table("cases").get(k.caseId);
  if (!c) return null;
  const [person, step3, decision] = await Promise.all([ctx.repo.table("persons").get(c.personId), followsOf(ctx, k), decisionOf(ctx, k)]);
  const u = k.snapshot as unknown as BonusUnderlag;
  const waiting = k.status === "submitted" && waitsForStep3(k, step3);
  return {
    claimId: k.id, caseId: c.id, caseNumber: c.caseNumber, participantName: nameOf(person), step: k.step, label: u.stepLabel, status: k.status, ...statusOf(k.status), sentAt: k.submittedAt,
    // Bara handläggaren som beställde insatsen beslutar (bonus_claim_decisions_insert, 0039) – också när synligheten är vidare.
    underlag: u, canDecide: k.status === "submitted" && !k.customerDecision && !waiting && c.referrerId === ctx.actor.userId, waitingForStep3: waiting, decision,
  };
});

// ================================================================ Kommandon
type Fields = { basis: string; reachedOn: string | null; verificationKind: string | null; verificationOn: string | null; checklist: BonusChecklist };
/**
 * Fälten städade: trimmade texter, tom verifiering = null, checklistan bara med kända punkter. Steg 4 och 5 har inget eget
 * resultatdatum att ändra – det kommer från bonussteg 3 (ett datum från klienten ignoreras).
 */
function cleanFields(p: Fields, k: Pick<BonusClaim, "step" | "reachedOn">): Fields {
  const checklist: BonusChecklist = {};
  for (const item of BONUS_CHECKLIST_ITEMS) {
    const v = p.checklist[item];
    if (v && (v.done || v.where.trim())) checklist[item] = { done: v.done, where: v.where.trim() };
  }
  const kind = p.verificationKind?.trim() || null;
  const reachedOn = FOLLOWS_STEP3.includes(k.step ?? 0) ? k.reachedOn : p.reachedOn;
  return { basis: p.basis.trim(), reachedOn, verificationKind: kind, verificationOn: p.verificationOn, checklist };
}
const hasPnr = (f: Fields): boolean => looksLikePnr(f.basis) || looksLikePnr(f.verificationKind ?? "") || Object.values(f.checklist).some((v) => looksLikePnr(v?.where ?? ""));
/** Bara de fält som ändras (en ändring som inte ändrar något nekas av triggern bonus_claims_guard). */
function fieldPatch(k: BonusClaim, f: Fields): Partial<BonusClaim> {
  const patch: Partial<BonusClaim> = {};
  if (f.basis !== k.basis) patch.basis = f.basis;
  if (f.reachedOn !== k.reachedOn) patch.reachedOn = f.reachedOn;
  if (f.verificationKind !== k.verificationKind) patch.verificationKind = f.verificationKind;
  if (f.verificationOn !== k.verificationOn) patch.verificationOn = f.verificationOn;
  if (JSON.stringify(f.checklist) !== JSON.stringify(k.checklist)) patch.checklist = f.checklist;
  return patch;
}

// ---------------------------------------------------------------- bonus.skapa
handleCommand(bonusCreate, { roles: WORKERS, commercial: true }, async (ctx, p) => {
  const x = await caseCtx(ctx, p.caseId);
  if (!x) return (await ctx.repo.table("cases").get(p.caseId)) ? fail("off", OFF) : fail("not_found", CASE_NOT_FOUND);
  const { c, m } = x;
  if (!(await worksOn(ctx, c))) return fail("not_found", CASE_NOT_FOUND);
  const claims = await ctx.repo.table("bonus_claims").list({ caseId: c.id });
  const problem = manualCreateProblem(c, claims, p.step);
  if (problem) return fail("exists", problem);
  const step3 = FOLLOWS_STEP3.includes(p.step) ? step3For(claims) : null;
  const now = ctx.now();
  const reachedOn = p.step === 5 ? (step3?.reachedOn ?? null) : p.step === 4 && step3?.reachedOn ? sustainDate(step3.reachedOn, m) : null;
  const row: BonusClaim = {
    id: ctx.newId("bonus"), caseId: c.id, contractId: c.contractId, step: p.step, kind: stepKind(p.step), status: "suggested", source: "manual", basis: "", evidencePaths: [],
    outcomeEventId: null, followsClaimId: step3?.id ?? null, reachedOn, verificationKind: null, verificationOn: null, checklist: {}, snapshot: null, createdBy: ctx.actor.userId,
    createdAt: now, submittedAt: null, submittedBy: null, withdrawnBy: null, withdrawnAt: null, customerDecision: null, decidedBy: null, decidedAt: null, decisionNote: null,
    amountOre: null, invoiceDraftId: null,
  };
  try {
    await ctx.repo.table("bonus_claims").insert(row);
  } catch (e) {
    // En kollega hann skapa ett anspråk för steget samtidigt (bonus_claims_case_step_active_key).
    if (e instanceof UniqueError) return fail("exists", `Det finns redan ett anspråk för bonussteg ${p.step} i ärendet.`);
    throw e;
  }
  await ctx.audit({ action: "bonus_claim.created", entity: "bonus_claim", entityId: row.id, contractId: c.contractId, details: { caseId: c.id, step: p.step, source: "manual" } });
  return ok({ claimId: row.id });
});

/** Anspråket och ärendet för ett kommando från den som arbetar i ärendet. */
async function workClaim(ctx: Ctx, claimId: string): Promise<{ k: BonusClaim; x: CaseCtx } | null> {
  const k = await ctx.repo.table("bonus_claims").get(claimId);
  if (!k || k.step == null) return null;
  const x = await caseCtx(ctx, k.caseId);
  if (!x || !(await worksOn(ctx, x.c))) return null;
  return { k, x };
}

// ---------------------------------------------------------------- bonus.spara
handleCommand(bonusSave, { roles: WORKERS, commercial: true }, async (ctx, p) => {
  const w = await workClaim(ctx, p.claimId);
  if (!w) return fail("not_found", NOT_FOUND);
  const { k, x } = w;
  if (k.status !== "suggested") return fail("locked", LOCKED);
  const f = cleanFields(p, k);
  if (hasPnr(f)) return fail("pnr", PNR);
  const patch = fieldPatch(k, f);
  let cur = k;
  if (Object.keys(patch).length) {
    const done = await ctx.repo.table("bonus_claims").updateIf(k.id, { status: "suggested" }, patch);
    if (!done) return fail("locked", LOCKED);
    cur = done;
    await ctx.audit({ action: "bonus_claim.saved", entity: "bonus_claim", entityId: k.id, contractId: k.contractId, details: { caseId: k.caseId, step: k.step, fields: Object.keys(patch) } });
  }
  const problems = await problemsOf(ctx, x, cur);
  return ok({ problems });
});

async function problemsOf(ctx: Ctx, x: CaseCtx, k: BonusClaim): Promise<string[]> {
  const acts = await loadDb(ctx.repo, ["activities", "attendance", "monthly_assessments"], { activities: { caseId: x.c.id }, attendance: { caseId: x.c.id }, monthly_assessments: { caseId: x.c.id } });
  const step3 = await followsOf(ctx, k);
  const att = bonusAttendance(acts, x.c, x.m, { now: ctx.now() });
  return submitProblems({ claim: k, case: x.c, step3, attendance: att, approvedAssessments: approvedAssessments(acts, x.c.id).length, today: dayOf(ctx.now()) }, x.m);
}

// ---------------------------------------------------------------- bonus.skicka
handleCommand(bonusSubmit, { roles: WORKERS, commercial: true }, async (ctx, p) => {
  const w = await workClaim(ctx, p.claimId);
  if (!w) return fail("not_found", NOT_FOUND);
  const { k, x } = w;
  if (k.status !== "suggested") return fail("locked", LOCKED);
  const f = cleanFields(p, k);
  if (hasPnr(f)) return fail("pnr", PNR);
  const next: BonusClaim = { ...k, ...f };
  const problems = await problemsOf(ctx, x, next);
  if (problems.length) return fail("problems", problems.join(" "));
  // Redovisningsunderlaget byggs av godkända uppgifter och fryses i samma ändring som skickar anspråket.
  const now = ctx.now();
  const snapshot = await underlagOf(ctx, x, next, ctx.actor.userId);
  const done = await ctx.repo.table("bonus_claims").updateIf(k.id, { status: "suggested" }, {
    ...fieldPatch(k, f), status: "submitted", snapshot: snapshot as unknown as Record<string, unknown>, submittedAt: now, submittedBy: ctx.actor.userId,
  });
  if (!done) return fail("locked", LOCKED);
  await ctx.audit({ action: "bonus_claim.submitted", entity: "bonus_claim", entityId: k.id, contractId: k.contractId, details: { caseId: k.caseId, step: k.step } });
  // Mejl till beställande handläggare: bara ärendenumret och en länk till portalen (CLAUDE.md punkt 9).
  await notifyReferrer(ctx, x.c, "bonusansprak", `Miljonbemanning har skickat ett bonusanspråk för ärende ${x.c.caseNumber}. Logga in i portalen för att läsa underlaget och besluta.`);
  return ok({});
});

// ---------------------------------------------------------------- bonus.aterta
handleCommand(bonusWithdraw, { roles: WORKERS, commercial: true }, async (ctx, p) => {
  const w = await workClaim(ctx, p.claimId);
  if (!w) return fail("not_found", NOT_FOUND);
  const { k } = w;
  if (k.status !== "suggested" && k.status !== "submitted") return fail("locked", LOCKED);
  const now = ctx.now();
  const table = ctx.repo.table("bonus_claims");
  // Steg 4 och 5 bygger på steg 3: återtas steg 3 följer de anspråk med som ännu inte är beslutade.
  const followers = k.step === 3 ? (await table.list({ caseId: k.caseId })).filter((y) => y.followsClaimId === k.id && (y.status === "suggested" || y.status === "submitted")) : [];
  let withdrawn = 0;
  for (const y of [k, ...followers]) {
    const done = await table.updateIf(y.id, { status: y.status }, { status: "withdrawn", withdrawnAt: now, withdrawnBy: ctx.actor.userId });
    if (!done) {
      if (y === k) return fail("locked", LOCKED);
      continue;
    }
    withdrawn++;
    await ctx.audit({ action: "bonus_claim.withdrawn", entity: "bonus_claim", entityId: y.id, contractId: y.contractId, details: { caseId: y.caseId, step: y.step, wasSubmitted: y.status === "submitted" } });
  }
  return ok({ withdrawn });
});

// ---------------------------------------------------------------- Beslut (portalen och mejl)
/** Notis till huvudcoachen om kommunens beslut – i appen, utan namn (ctx.system: notisen går till en annan användare). */
async function notifyDecision(ctx: Ctx, c: Case, k: BonusClaim, decision: "approved" | "rejected"): Promise<void> {
  if (!c.leadCoachId) return;
  const text = `Bonussteg ${k.step}: ${decision === "approved" ? "godkänt" : "avslaget"} av kommunen.`;
  await ctx.system.table("user_notifications").insert({
    id: ctx.newId("un"), recipientId: c.leadCoachId, kind: "bonus_decision", caseId: c.id, createdAt: ctx.now(), channels: ["app"],
    title: `Kommunen har beslutat om bonus – ${c.caseNumber}`, body: text, emailBody: `Kommunen har beslutat om ett bonusanspråk för ärende ${c.caseNumber}. Logga in för att läsa.`,
  });
}

async function decide(ctx: Ctx, claimId: string, decision: "approved" | "rejected", note: string | null, via: BonusClaimDecision["via"]) {
  const k = await ctx.repo.table("bonus_claims").get(claimId);
  if (!k || k.step == null) return fail("not_found", NOT_FOUND);
  const c = await ctx.repo.table("cases").get(k.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (via === "mejl" && !(await worksOn(ctx, c))) return fail("not_found", NOT_FOUND);
  if (via === "portal" && c.referrerId !== ctx.actor.userId) return fail("not_found", NOT_FOUND);
  if (k.status !== "submitted" || k.customerDecision) return fail("decided", "Anspråket är redan beslutat eller återtaget.");
  if (note && looksLikePnr(note)) return fail("pnr", PNR);
  if (decision === "approved" && waitsForStep3(k, await followsOf(ctx, k))) {
    return fail("needs_step3", `Bonussteg ${k.step} bygger på bonussteg 3. Bonussteg 3 behöver godkännas först.`);
  }
  // Steg 4 och 5 som bygger på steg 3 och inte är beslutade: ett avslag av steg 3 återtar dem i samma transaktion
  // (mm.apply_bonus_decision, policy.ts bonusDecisionApply). ctx.system: kommunen läser inte förslagen – bara för loggen.
  const followers = decision === "rejected" && k.step === 3
    ? (await ctx.system.table("bonus_claims").list({ caseId: k.caseId })).filter((y) => y.followsClaimId === k.id && (y.status === "suggested" || y.status === "submitted"))
    : [];
  const row: BonusClaimDecision = {
    id: ctx.newId("bonusbeslut"), claimId: k.id, caseId: k.caseId, contractId: k.contractId, decision, note: note?.trim() || null, via,
    decidedBy: via === "portal" ? ctx.actor.userId : null, recordedBy: ctx.actor.userId, decidedAt: ctx.now(),
  };
  try {
    // Beslutet ändrar anspråket i samma steg (triggern bonus_claim_decisions_apply, policy.ts afterInsert).
    await ctx.repo.table("bonus_claim_decisions").insert(row);
  } catch (e) {
    if (e instanceof PolicyError || e instanceof UniqueError || (e as { code?: unknown } | null)?.code === "23514") return fail("decided", "Anspråket är redan beslutat eller återtaget.");
    throw e;
  }
  await ctx.audit({ action: "bonus_claim.decided", entity: "bonus_claim", entityId: k.id, contractId: k.contractId, details: { caseId: k.caseId, step: k.step, decision, via, decisionId: row.id } });
  for (const y of followers) {
    if ((await ctx.system.table("bonus_claims").get(y.id))?.status !== "withdrawn") continue;
    await ctx.audit({
      action: "bonus_claim.withdrawn", entity: "bonus_claim", entityId: y.id, contractId: y.contractId,
      details: { caseId: y.caseId, step: y.step, wasSubmitted: y.status === "submitted", reason: "step3_rejected", decisionId: row.id },
    });
  }
  await notifyDecision(ctx, c, k, decision);
  return ok({});
}

handleCommand(bonusDecide, { roles: ["kommun_handlaggare"], commercial: true }, async (ctx, p) => decide(ctx, p.claimId, p.decision, p.note ?? null, "portal"));
handleCommand(bonusRecordMail, { roles: MAIL_RECORDERS, commercial: true }, async (ctx, p) => decide(ctx, p.claimId, p.decision, p.note, "mejl"));

// ---------------------------------------------------------------- bonus.underlag (visning och nedladdning, tyst)
handleCommand(bonusUnderlag, { roles: [...READERS, "kommun_handlaggare"], silent: true, commercial: true }, async (ctx, p) => {
  const k = await ctx.repo.table("bonus_claims").get(p.claimId);
  if (!k || k.step == null) return fail("not_found", NOT_FOUND);
  const kommun = ctx.actor.role === "kommun_handlaggare";
  // Kommunen läser bara det frysta underlaget (anspråket är skickat); Miljonbemanning också förhandsvisningen.
  if (kommun && !k.snapshot) return fail("not_found", NOT_FOUND);
  const c = await ctx.repo.table("cases").get(k.caseId);
  const x = kommun ? null : await caseCtx(ctx, k.caseId);
  if (!c || (!kommun && !x)) return fail("not_found", NOT_FOUND);
  const underlag = x ? await underlagOf(ctx, x, k, null) : (k.snapshot as unknown as BonusUnderlag);
  const person = await ctx.repo.table("persons").get(c.personId);
  await ctx.audit({
    action: p.purpose === "download" ? "bonus_claim.underlag_downloaded" : "bonus_claim.underlag_viewed", entity: "bonus_claim", entityId: k.id, contractId: k.contractId,
    details: { caseId: k.caseId, step: k.step, frozen: !!k.snapshot },
  });
  return ok({ filename: underlagFilename(underlag), underlag, participantName: nameOf(person) });
});
