// Hanterare för området ekonomi (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
import { fail, ok } from "@/api/contract";
import { loadDb } from "@/api/load";
import type { Role } from "@/api/roles";
import { ApiError, handleCommand, handleQuery, type Ctx } from "@/api/server";
import { BILLED_STATUSES, billableWeeks, billingForMonth, buyerRefProblem, invoiceStatus, unbilledOld, type Invoice } from "@/core/billing";
import { findCaseNumber, orderValueOre, priceFor, priceItem } from "@/core/cases";
import { DEFAULT_ORG_SETTINGS, isOperational, requireOperational, type OperationalConfig } from "@/core/config";
import { areaName, invoiceStatusLabel, personName } from "@/core/labels";
import { slaStatus, type SlaStatus } from "@/core/sla";
import { addDays, dayOf, diffDays, monday, monthKey, monthName, relative, weeksOfMonth, type LocalDateTime, type MonthKey } from "@/core/time";
import { by, groupBy, sum } from "@/core/util";
import { poNumberValid } from "@/core/validation";
import type { Case, Contract, ContractArea, InvoiceDisplayStatus, InvoiceDraft, InvoiceStatus, Organization, Profile, Task } from "@/data/schema";
import { contractOf, upsert } from "../_shared/context";
import { invoiceDraftId, newInvoiceDraft } from "../_shared/rows";
import {
  billingApproveInvoice, billingApproveZeroWeek, billingExport, billingMarkManual, billingSendFortnox, ekoAskCoordinator, ekoCase, ekoCaseList, ekoCloseRun, ekoCsv,
  ekoFortnoxLog, ekoFortnoxSync, ekoInvoice, ekoPreview, ekoReissue, ekoRun, ekoStart, ekoTaskDone,
  type BillingStartView, type CaseMonthRow, type InvoiceRow, type OverlapView, type RefCaseRow, type ReturnedRow, type RunRow, type RunView, type SlaView, type TaskRef,
  type TaskView, type UnbilledRow, type ZeroRow,
} from "./api";
import {
  BILLED, bucketOf, cap, caseLedger, checkText, fortnoxDue, invoiceSummary, monthRules, noteText, periodOf, poText, prescText, prescriptionDate, priceSpan, refInfo,
  refLenText, remarksOf, tally, toCsv, weekText, type RefRules,
} from "./model";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

/** Bara ekonomen gör fakturakörningen (SPEC §4). Chef/controller läser. */
const BILLING: readonly Role[] = ["ekonom"];
const NOT_FOUND = "Ärendet finns inte, eller så har du inte behörighet att se det.";

/** Läs alla ärenden innan något ändras, så att ett okänt id inte lämnar en halvgjord körning. */
async function loadCases(ctx: Ctx, ids: readonly string[]): Promise<Case[] | null> {
  const out: Case[] = [];
  for (const id of new Set(ids)) {
    const c = await ctx.repo.table("cases").get(id);
    if (!c) return null;
    out.push(c);
  }
  return out;
}

/** Fakturautkastet för ärendet och månaden – det befintliga eller ett nytt (sparas av anroparen). */
async function draftFor(ctx: Ctx, month: string, c: Case): Promise<InvoiceDraft> {
  const cur = await ctx.repo.table("invoice_drafts").get(invoiceDraftId(month, c.id));
  if (cur) return cur;
  const run = await ctx.repo.table("billing_runs").first({ month, contractId: c.contractId });
  return newInvoiceDraft({
    month, caseId: c.id, contractId: c.contractId, billingRunId: run?.id ?? null, buyerReference: c.buyerReference, purchaseOrderNumber: c.purchaseOrderNumber,
    invoicedObject: c.caseNumber,
  });
}

// ---------------------------------------------------------------- billing.approveZeroWeek
handleCommand(billingApproveZeroWeek, { roles: BILLING }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  await upsert(ctx.repo.table("billing_week_approvals"), {
    id: `${c.id}:${p.weekKey}`, contractId: c.contractId, month: p.month, caseId: c.id, weekKey: p.weekKey, approvedBy: ctx.actor.userId, approvedAt: ctx.now(), note: p.note ?? "",
  });
  await ctx.audit({ action: "billing.zero_week_approved", entity: "case", entityId: c.id, contractId: c.contractId, details: { week: p.weekKey, note: p.note ?? "" } });
  return ok({});
});

// ---------------------------------------------------------------- billing.approveInvoice
handleCommand(billingApproveInvoice, { roles: BILLING }, async (ctx, p) => {
  const cases = await loadCases(ctx, p.caseIds);
  if (!cases) return fail("not_found", NOT_FOUND);
  const now = ctx.now();
  for (const c of cases) await upsert(ctx.repo.table("invoice_drafts"), { ...(await draftFor(ctx, p.month, c)), approvedBy: ctx.actor.userId, approvedAt: now });
  await ctx.audit({ action: "billing.approved", entity: "billing_run", entityId: p.month, contractId: cases[0]?.contractId ?? null, details: { count: cases.length } });
  return ok({ approved: cases.length });
});

// ---------------------------------------------------------------- billing.sendFortnox (idempotent)
handleCommand(billingSendFortnox, { roles: BILLING }, async (ctx, p) => {
  const cases = await loadCases(ctx, p.caseIds);
  if (!cases) return fail("not_found", NOT_FOUND);
  const now = ctx.now();
  const runs = await ctx.repo.table("billing_runs").list({ month: p.month });
  const buyerRefs = await ctx.repo.table("buyer_references").list();
  const created: string[] = [];
  const skipped: string[] = [];
  const blocked: string[] = [];
  for (const c of cases) {
    const draft = await draftFor(ctx, p.month, c);
    const cur = invoiceStatus({ invoice_drafts: [draft], billing_runs: runs.filter((r) => r.contractId === c.contractId) }, p.month, c.id);
    // Samma faktura skapas aldrig två gånger (nyckel månad:ärende).
    if (BILLED_STATUSES.includes(cur)) {
      skipped.push(c.id);
      continue;
    }
    // Beställarreferensen krävs och valideras innan en faktura skapas (CLAUDE.md punkt 11).
    const { cfg } = await contractOf(ctx, c.contractId);
    if (cfg.billing.buyerReference.required && buyerRefProblem(c, { buyer_references: buyerRefs }, cfg)) {
      blocked.push(c.id);
      continue;
    }
    await upsert(ctx.repo.table("invoice_drafts"), {
      ...draft, status: "fortnox_created", fortnoxIdempotencyKey: `${p.month}:${c.id}`, fortnoxCreatedAt: now, buyerReference: c.buyerReference,
      purchaseOrderNumber: c.purchaseOrderNumber, invoicedObject: c.caseNumber,
    });
    created.push(c.id);
  }
  await ctx.audit({
    action: "billing.fortnox_created", entity: "billing_run", entityId: p.month, contractId: cases[0]?.contractId ?? null,
    details: { created: created.length, skippedAlreadyCreated: skipped.length, blockedBuyerReference: blocked.length, idempotencyKeys: created.map((id) => `${p.month}:${id}`) },
  });
  return ok({ created, skipped, blocked });
});

// ---------------------------------------------------------------- billing.markManual
handleCommand(billingMarkManual, { roles: BILLING }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  await upsert(ctx.repo.table("invoice_drafts"), { ...(await draftFor(ctx, p.month, c)), status: "manual", manualInvoiceNo: p.invoiceNo });
  await ctx.audit({ action: "billing.manual", entity: "case", entityId: c.id, contractId: c.contractId, details: { month: p.month, invoiceNo: p.invoiceNo } });
  return ok({});
});

// ---------------------------------------------------------------- billing.export
handleCommand(billingExport, { roles: BILLING }, async (ctx, p) => {
  await ctx.audit({ action: "export.billing", entity: "billing_run", entityId: p.month, contractId: ctx.actor.contractIds[0] ?? null, details: { format: p.format } });
  return ok({});
});

// ================================================================ Ekonomins skärmar och egna åtgärder
// Vy-modeller för prototypens eko.start, eko.korning, eko.faktura och eko.arende. Läser via ctx.repo – policyn (RLS i
// produktion) ger ekonomen ärenden, närvaro och fakturering men aldrig personer, anteckningar eller rapporter.

/** Ekonomen gör körningen; chef/controller läser samma vyer i läsläge (prototypens ROLES för eko.*). */
const READERS: readonly Role[] = ["ekonom", "chef"];

const BILLING_TABLES = ["cases", "activities", "attendance", "price_items", "buyer_references", "invoice_drafts", "billing_runs", "billing_week_approvals"] as const;

type Base = {
  contract: Contract;
  cfg: OperationalConfig;
  env: { now: LocalDateTime; cfg: OperationalConfig };
  customer: Organization | null;
  supplier: Organization | null;
  areas: ContractArea[];
  profiles: Profile[];
  refRules: RefRules;
  canAct: boolean;
};

/** Avtalet som faktureras (det första med driftkonfiguration), dess regler och uppslag. */
async function base(ctx: Ctx): Promise<Base> {
  const contracts = await ctx.repo.table("contracts").list();
  const contract = contracts.find((c) => isOperational(c.config));
  if (!contract) throw new ApiError(404, "no_contract", "Det finns inget avtal med fakturering för din roll.");
  const cfg = requireOperational(contract.config);
  const [customer, supplier, areas, profiles, registry] = await Promise.all([
    ctx.repo.table("organizations").get(contract.customerId),
    ctx.repo.table("organizations").get(contract.supplierId),
    ctx.repo.table("contract_areas").list({ contractId: contract.id }),
    ctx.repo.table("profiles").list(),
    ctx.repo.table("buyer_references").list({ customerId: contract.customerId }),
  ]);
  return {
    contract, cfg, env: { now: ctx.now(), cfg }, customer, supplier, areas, profiles, canAct: ctx.actor.role === "ekonom",
    refRules: { billing: cfg.billing, registry: registry.map((b) => ({ reference: b.reference, unit: b.unit, active: b.active, note: b.note })) },
  };
}

/** Fakturadata för avtalet (ärenden, närvaro, priser, referenser, fakturor och körningar). */
const loadBilling = (ctx: Ctx, contract: Contract) =>
  loadDb(ctx.repo, BILLING_TABLES, {
    cases: { contractId: contract.id }, price_items: { contractId: contract.id }, buyer_references: { customerId: contract.customerId },
    invoice_drafts: { contractId: contract.id }, billing_runs: { contractId: contract.id }, billing_week_approvals: { contractId: contract.id },
  });
type BillingData = Awaited<ReturnType<typeof loadBilling>>;

const areaTitle = (b: Base, code: string | null) => b.areas.find((a) => a.code === code)?.name ?? "";

/** Fakturan som vy-rad: kontrolltexter, referensens status och om idempotensnyckeln redan finns. */
function invoiceRow(b: Base, db: BillingData, inv: Invoice): InvoiceRow {
  const draft = db.invoice_drafts.find((x) => x.id === invoiceDraftId(inv.month, inv.caseId));
  return {
    id: inv.id, caseId: inv.caseId, caseNumber: inv.caseNumber, areaCode: inv.areaCode, areaTitle: areaTitle(b, inv.areaCode), areaName: areaName(b.areas, inv.areaCode),
    articleNo: inv.articleNo, weeks: inv.weeks, quantity: inv.quantity, unitPriceOre: inv.unitPriceOre, amountOre: inv.amountOre, vatRate: inv.vatRate,
    buyerReference: inv.buyerReference, ref: refInfo(inv.buyerReference, b.refRules), purchaseOrderNumber: inv.purchaseOrderNumber, status: inv.status,
    blocked: inv.blocked, needsApproval: inv.needsApproval,
    checks: inv.checks.map((ch) => ({
      kind: ch.kind, severity: ch.severity, label: ch.label, text: checkText(ch, inv), weekKey: ch.weekKey ?? null,
      approval: ch.approval ? { byName: personName(b.profiles, ch.approval.by), at: ch.approval.at, note: ch.approval.note } : null,
    })),
    fortnoxNo: inv.fortnoxNo, manualInvoiceNo: inv.manualInvoiceNo, orderWeeks: inv.orderWeeks, accruedWeeks: inv.accruedWeeks, orderValueOre: inv.orderValueOre,
    bucket: bucketOf(inv), remarks: remarksOf(inv.checks), hasKey: draft?.fortnoxIdempotencyKey === `${inv.month}:${inv.caseId}`,
  };
}

/** Körningarna, nyast först. */
const runsSorted = (db: BillingData) => [...db.billing_runs].sort((a, x) => (a.month < x.month ? 1 : a.month > x.month ? -1 : 0));
/** Pågående körning (den senaste med status draft), annars den senaste. */
const currentRun = (db: BillingData) => {
  const runs = runsSorted(db);
  return runs.find((r) => r.status === "draft") ?? runs[0] ?? null;
};

/** Internt mål: fakturorna i Fortnox senast n:e arbetsdagen efter månadsskiftet (Miljonbemannings regel, org_settings). */
async function fortnoxDays(ctx: Ctx, contract: Contract): Promise<number> {
  const row = await ctx.repo.table("org_settings").first({ organizationId: contract.supplierId });
  return (row?.settings ?? DEFAULT_ORG_SETTINGS).billing.fortnoxWithinWorkingDays;
}

/** Fakturan för ett ärende och en månad, med kontrollerna mot deltagarens andra ärenden (överlapp). */
function invoiceFor(db: BillingData, c: Case, month: MonthKey, env: Base["env"]): Invoice | null {
  const personCases = db.cases.filter((x) => x.personId === c.personId);
  return billingForMonth({ ...db, cases: personCases }, month, env).invoices.find((x) => x.caseId === c.id) ?? null;
}

/** Öppen uppgift till ekonomen om ärendet (t.ex. rätt beställarreferens från avtalsansvarig). */
async function openTasksToEkonom(ctx: Ctx): Promise<Task[]> {
  return ctx.repo.table("tasks").list({ toRole: "ekonom" });
}
const taskRef = (b: Base, t: Task): TaskRef => ({ id: t.id, fromName: personName(b.profiles, t.fromId), createdAt: t.createdAt, text: t.text });
const taskFor = (tasks: readonly Task[], caseId: string) => tasks.find((t) => t.status === "open" && t.caseIds.includes(caseId)) ?? null;

// ---------------------------------------------------------------- ekonomi.run (eko.korning)
handleQuery(ekoRun, { roles: READERS }, async (ctx, p) => {
  const b = await base(ctx);
  const db = await loadBilling(ctx, b.contract);
  const runs = runsSorted(db);
  const month = p.month ?? currentRun(db)?.month ?? null;
  const customerName = b.customer?.name ?? "";
  const empty: RunView = {
    month: null, canAct: b.canAct, customerName, runs: [], run: null, due: null, count: 0, totalOre: 0, weeks: 0, vatOre: 0, calendarWeeks: 0, rows: [],
    rules: { weeks: [], notes: [], collectiveAllowed: b.cfg.billing.collectiveInvoiceAllowed, refLen: refLenText(b.cfg.billing) }, fortnoxRuns: [], priceSpan: null,
  };
  if (!month) return empty;
  const run = runs.find((r) => r.month === month) ?? null;
  const bm = billingForMonth(db, month, b.env);
  const days = await fortnoxDays(ctx, b.contract);
  const dueAt = fortnoxDue(month, days);
  const fxRuns = (await ctx.repo.table("fortnox_runs").list({ month, kind: "create", contractId: b.contract.id }))
    .sort((a, x) => (a.ranAt < x.ranAt ? 1 : a.ranAt > x.ranAt ? -1 : a.id < x.id ? 1 : -1));
  return {
    ...empty, month, runs: runs.map((r) => ({ month: r.month, status: r.status })), run: run ? { status: run.status } : null,
    due: run?.status === "draft" ? { at: dueAt, sla: pickSla(slaStatus(dueAt, null, b.env)), days } : null,
    count: bm.count, totalOre: bm.totalOre, weeks: bm.weeks, vatOre: sum(bm.invoices, (x) => Math.round((x.amountOre * x.vatRate) / 100)), calendarWeeks: weeksOfMonth(month).length,
    rows: bm.invoices.map((inv) => invoiceRow(b, db, inv)),
    rules: { ...monthRules(month), collectiveAllowed: b.cfg.billing.collectiveInvoiceAllowed, refLen: refLenText(b.cfg.billing) },
    fortnoxRuns: fxRuns.map((r) => ({ id: r.id, at: r.ranAt, byName: personName(b.profiles, r.ranBy), created: r.created, skipped: r.skipped, blocked: r.blocked })),
    priceSpan: priceSpan(db.price_items, dayOf(ctx.now())),
  };
});
const pickSla = (s: SlaStatus): SlaView => ({ label: s.label, tone: s.tone });

// ---------------------------------------------------------------- ekonomi.invoice (detaljen i körningen)
handleQuery(ekoInvoice, { roles: READERS }, async (ctx, p) => {
  const b = await base(ctx);
  const db = await loadBilling(ctx, b.contract);
  const c = db.cases.find((x) => x.id === p.caseId);
  if (!c) return null;
  const inv = invoiceFor(db, c, p.month, b.env);
  if (!inv) return null;
  const tasks = await openTasksToEkonom(ctx);
  const questions = await ctx.repo.table("tasks").list({ kind: "billing_question", month: p.month });
  const overlaps: Record<string, OverlapView> = {};
  for (const ch of inv.checks.filter((x) => x.kind === "overlap")) {
    const num = findCaseNumber(ch.label);
    const other = num ? db.cases.find((x) => x.caseNumber === num) : null;
    if (!other) continue;
    const oInv = invoiceFor(db, other, p.month, b.env);
    const asked = questions.find((t) => t.caseIds.includes(c.id) && t.caseIds.includes(other.id));
    overlaps[ch.label] = { caseId: other.id, caseNumber: other.caseNumber, status: oInv?.status ?? null, startDate: other.startDate, endDate: other.endDate, askedAt: asked?.createdAt ?? null };
  }
  const credit = (await ctx.repo.table("invoice_credits").list({ month: p.month, caseId: c.id }))[0] ?? null;
  const task = taskFor(tasks, c.id);
  return {
    canAct: b.canAct, month: p.month, inv: invoiceRow(b, db, inv), case: { caseId: c.id, caseNumber: c.caseNumber, buyerReference: c.buyerReference },
    summary: invoiceSummary(inv, caseLedger(c, db, b.env)), overlaps, credit: credit ? { at: credit.creditedAt, reference: credit.buyerReference } : null,
    task: task ? taskRef(b, task) : null, refRules: b.refRules,
  };
});

// ---------------------------------------------------------------- ekonomi.csv (reservvägen: export av underlaget)
handleQuery(ekoCsv, { roles: READERS }, async (ctx, p) => {
  const b = await base(ctx);
  const db = await loadBilling(ctx, b.contract);
  const bm = billingForMonth(db, p.month, b.env);
  const byId = new Map(db.cases.map((c) => [c.id, c]));
  const csv = toCsv(bm.invoices.map((x) => {
    const c = byId.get(x.caseId);
    return {
      ...x, areaName: areaName(b.areas, x.areaCode), statusLabel: invoiceStatusLabel(x.status), checkLabels: x.checks.map((ch) => ch.label),
      invoiceText: c ? invoiceSummary(x, caseLedger(c, db, b.env)).text : x.invoiceText,
    };
  }));
  return { filename: `fakturaunderlag-${p.month}.csv`, csv };
});

// ---------------------------------------------------------------- ekonomi.preview (eko.faktura)
handleQuery(ekoPreview, { roles: READERS }, async (ctx, p) => {
  const b = await base(ctx);
  const db = await loadBilling(ctx, b.contract);
  const c = db.cases.find((x) => x.id === p.caseId) ?? null;
  const month = p.month ?? null;
  const inv = month && c ? invoiceFor(db, c, month, b.env) : null;
  if (!inv || !c || !month) return { month, caseId: p.caseId, caseNumber: c?.caseNumber ?? null, preview: null };
  const run = db.billing_runs.find((r) => r.month === month);
  const draft = db.invoice_drafts.find((x) => x.id === invoiceDraftId(month, c.id));
  const keyAt = draft?.fortnoxIdempotencyKey === `${month}:${c.id}` ? draft.fortnoxCreatedAt : null;
  const isOut = BILLED.includes(inv.status) || inv.status === "returned";
  const invoiceDate = dayOf(keyAt || (isOut && run ? run.createdAt : ctx.now()));
  const vatOre = Math.round((inv.amountOre * inv.vatRate) / 100);
  const gross = inv.amountOre + vatOre;
  const grossRoundedOre = Math.round(gross / 100) * 100;
  const customerName = b.customer?.name ?? "";
  const short = customerName.replace(/ kommun$/, "");
  const domain = b.customer?.emailDomains[0];
  return {
    month, caseId: c.id, caseNumber: c.caseNumber,
    preview: {
      inv: invoiceRow(b, db, inv), summary: invoiceSummary(inv, caseLedger(c, db, b.env)), invoiceDate, dueDate: addDays(invoiceDate, b.cfg.billing.paymentTermsDays),
      paymentTermsDays: b.cfg.billing.paymentTermsDays, vatOre, roundingOre: grossRoundedOre - gross, grossRoundedOre,
      po: c.purchaseOrderNumber && poNumberValid(c.purchaseOrderNumber, b.cfg) ? c.purchaseOrderNumber : "", period: periodOf(inv.weeks),
      lineText: `${inv.caseNumber} · ${weekText(inv.weeks)}`, refLen: refLenText(b.cfg.billing), poText: poText(b.cfg.billing),
      supplier: { name: b.supplier?.name ?? "", orgNr: b.supplier?.orgNr ?? "", vatNo: `SE${String(b.supplier?.orgNr ?? "").replace(/\D/g, "")}01` },
      customer: { name: customerName, orgNr: b.customer?.orgNr ?? "", possessive: `${short}s`, eInvoiceContact: domain ? `${short}s e-handel (e-handel@${domain})` : `${short}s e-handel` },
      contractNumber: b.contract.contractNumber, dnr: b.contract.dnr, referrerId: c.referrerId,
    },
  };
});

// ---------------------------------------------------------------- ekonomi.case (eko.arende)
/** Namnet som visas: ekonomen ser aldrig namn ("–"); chefen ser namnet, eller "Skyddade personuppgifter" när policyn döljer personen. */
async function nameFor(ctx: Ctx, c: Case): Promise<string> {
  if (ctx.actor.role === "ekonom") return "–";
  const person = await ctx.repo.table("persons").get(c.personId);
  return person ? `${person.firstName} ${person.lastName}` : "Skyddade personuppgifter";
}

handleQuery(ekoCase, { roles: READERS }, async (ctx, p) => {
  const b = await base(ctx);
  const db = await loadBilling(ctx, b.contract);
  const c = db.cases.find((x) => x.id === p.caseId);
  if (!c) return null;
  const today = dayOf(ctx.now());
  const weeks = billableWeeks(c, db, b.env);
  const priceDate = c.startDate || today;
  const price = priceFor(db.price_items, c.primaryAreaCode, priceDate, c.contractId);
  const item = priceItem(db.price_items, c.primaryAreaCode, priceDate, c.contractId);
  const orderWeeks = c.orderValueWeeks || c.plannedWeeks || 0;
  const led = caseLedger(c, db, b.env);
  const curMk = monthKey(today);
  const runMonths = new Set(db.billing_runs.map((r) => r.month));
  const months: CaseMonthRow[] = [...new Set(weeks.map((w) => w.monthKey))].sort().map((mk) => {
    const l = led.find((x) => x.mk === mk) ?? null;
    const inv = l && runMonths.has(mk) ? invoiceFor(db, c, mk, b.env) : null;
    return {
      mk, bill: l ? l.weeks : [], paused: weeks.filter((w) => w.monthKey === mk && w.paused), qty: l ? l.qty : 0, amountOre: l ? l.amountOre : 0,
      status: inv ? inv.status : mk >= curMk ? "open" : null, hasInvoice: !!inv, invoiceNo: inv ? inv.fortnoxNo || inv.manualInvoiceNo : null,
    };
  });
  const qa = (t: { qty: number; amountOre: number }) => ({ qty: t.qty, amountOre: t.amountOre });
  const tasks = await openTasksToEkonom(ctx);
  const task = taskFor(tasks, c.id);
  return {
    canAct: b.canAct, caseId: c.id, caseNumber: c.caseNumber, name: await nameFor(ctx, c), areaName: areaName(b.areas, c.primaryAreaCode), articleNo: item?.fortnoxArticleNo || "–",
    priceOre: price, status: c.status, startDate: c.startDate, endDate: c.endDate, plannedEnd: c.plannedEnd, pausedWeeks: c.pausedWeeks, buyerReference: c.buyerReference,
    ref: refInfo(c.buyerReference, b.refRules), purchaseOrderNumber: c.purchaseOrderNumber, referredAt: c.referredAt, referrerId: c.referrerId, orderWeeks,
    orderValueOre: orderValueOre(c, db.price_items, b.env), accrued: qa(tally(led)), billed: qa(tally(led.filter((x) => x.kind === "billed"))),
    returned: qa(tally(led.filter((x) => x.kind === "returned"))), pending: qa(tally(led.filter((x) => x.kind === "unbilled"))), months, weeks, thisMonday: monday(today),
    task: task ? taskRef(b, task) : null, refRules: b.refRules,
  };
});

// ---------------------------------------------------------------- ekonomi.caseList (sök ärende)
handleQuery(ekoCaseList, { roles: READERS }, async (ctx) => {
  const b = await base(ctx);
  const cases = await ctx.repo.table("cases").list({ contractId: b.contract.id });
  return {
    canAct: b.canAct,
    cases: cases
      .filter((c) => c.startDate)
      .sort((a, x) => (a.caseNumber < x.caseNumber ? 1 : a.caseNumber > x.caseNumber ? -1 : 0))
      .map((c) => ({
        caseId: c.id, caseNumber: c.caseNumber, areaName: areaName(b.areas, c.primaryAreaCode), startDate: c.startDate, status: c.status, buyerReference: c.buyerReference,
        ref: refInfo(c.buyerReference, b.refRules),
      })),
  };
});

// ---------------------------------------------------------------- ekonomi.start (eko.start)
handleQuery(ekoStart, { roles: READERS }, async (ctx) => {
  const b = await base(ctx);
  const db = await loadBilling(ctx, b.contract);
  const today = dayOf(ctx.now());
  const runs = runsSorted(db);
  const cur = currentRun(db);
  const billingOf = new Map(runs.map((r) => [r.month, billingForMonth(db, r.month, b.env)]));
  const bm = cur ? billingOf.get(cur.month)! : null;
  const caseById = new Map(db.cases.map((c) => [c.id, c]));
  const problem = (c: Case) => buyerRefProblem(c, db, b.cfg);

  // Veckor utan närvaro i öppna körningar
  const zero: ZeroRow[] = runs.filter((r) => r.status === "draft").flatMap((r) =>
    billingOf.get(r.month)!.invoices.flatMap((inv) =>
      inv.checks.filter((ch) => ch.kind === "zero_week").map((ch) => ({
        id: `${r.month}:${inv.caseId}:${ch.weekKey}`, month: r.month, caseId: inv.caseId, caseNumber: inv.caseNumber, weekKey: ch.weekKey ?? "",
        planned: inv.weeks.find((w) => w.key === ch.weekKey)?.planned ?? null, approved: ch.severity === "approved",
      }))));

  // Ofakturerade veckor äldre än varningsgränsen, per ärende
  const ub = unbilledOld(db, b.env);
  const ubRows: UnbilledRow[] = Object.values(groupBy(ub, (x) => x.case.id)).map((xs) => {
    const sorted = [...xs].sort((a, x) => (a.week.key < x.week.key ? -1 : 1));
    const oldest = sorted[0];
    const presc = prescriptionDate(oldest.week.monday, b.cfg.billing);
    return {
      caseId: oldest.case.id, caseNumber: oldest.case.caseNumber, status: oldest.status, weeks: sorted.map((x) => x.week), age: Math.max(...xs.map((x) => x.age)),
      amountOre: sum(xs, (x) => x.amountOre), presc, left: diffDays(today, presc),
    };
  }).sort(by<UnbilledRow>("presc"));

  // Returnerade fakturor (och de som krediterats)
  const credits = await ctx.repo.table("invoice_credits").list({ contractId: b.contract.id });
  const returned: ReturnedRow[] = runs.flatMap((r) =>
    billingOf.get(r.month)!.invoices
      .filter((inv) => inv.status === "returned" || credits.some((x) => x.month === r.month && x.caseId === inv.caseId))
      .map((inv) => {
        const c = caseById.get(inv.caseId)!;
        const cr = credits.find((x) => x.month === r.month && x.caseId === inv.caseId);
        return {
          id: `${r.month}:${inv.caseId}`, month: r.month, caseId: inv.caseId, caseNumber: inv.caseNumber, status: inv.status, weeks: inv.weeks, quantity: inv.quantity,
          amountOre: inv.amountOre, buyerReference: c.buyerReference, refOk: !problem(c), credit: cr ? { at: cr.creditedAt, reference: cr.buyerReference } : null,
        };
      }));

  // Uppgifter till ekonomen: öppna först, sedan nyast först
  const tasks = (await openTasksToEkonom(ctx)).sort((a, x) => (a.status === x.status ? (a.createdAt < x.createdAt ? 1 : -1) : a.status === "open" ? -1 : 1));
  const taskViews: TaskView[] = tasks.map((t) => ({
    ...taskRef(b, t), status: t.status, doneAt: t.doneAt, doneByName: t.doneBy ? personName(b.profiles, t.doneBy) : null,
    cases: t.caseIds.map((id) => caseById.get(id)).filter((c): c is Case => !!c).map((c) => ({ caseId: c.id, caseNumber: c.caseNumber, buyerReference: c.buyerReference, problem: !!problem(c) })),
  }));

  const refCases: RefCaseRow[] = db.cases.filter((c) => c.status !== "declined" && problem(c)).map((c) => ({
    caseId: c.id, caseNumber: c.caseNumber, buyerReference: c.buyerReference, problem: noteText(problem(c)), started: !!c.startDate,
  }));

  const runRows: RunRow[] = runs.map((r) => {
    const bb = billingOf.get(r.month)!;
    const entries = Object.entries(groupBy(bb.invoices, (x) => x.status)).map(([s, xs]) => [s as InvoiceDisplayStatus, xs.length] as [InvoiceDisplayStatus, number]);
    entries.sort((a, x) => x[1] - a[1]);
    return { id: r.id, month: r.month, status: r.status, count: bb.count, weeks: bb.weeks, totalOre: bb.totalOre, entries, todo: bb.invoices.filter((x) => bucketOf(x) !== "ready").length };
  });

  const fx = await ctx.repo.table("fortnox_runs").list({ contractId: b.contract.id });
  const ordered = [...fx].sort((a, x) => (a.ranAt < x.ranAt ? -1 : a.ranAt > x.ranAt ? 1 : a.id < x.id ? -1 : 1));
  const lastRun = ordered.filter((r) => r.kind === "create").pop() ?? null;
  const lastSync = ordered.filter((r) => r.kind === "sync").pop() ?? null;

  let current: BillingStartView["current"] = null;
  if (cur && bm) {
    const days = await fortnoxDays(ctx, b.contract);
    const due = fortnoxDue(cur.month, days);
    const buckets = bm.invoices.map((x) => bucketOf(x));
    const stepNow = !bm.invoices.length ? 0 : buckets.some((x) => x !== "ready") ? 1 : bm.invoices.some((x) => x.status === "approved") ? 2
      : bm.invoices.some((x) => x.status === "fortnox_created" || x.status === "booked") ? 3 : 4;
    current = {
      month: cur.month, status: cur.status, totalOre: bm.totalOre, count: bm.count, weeks: bm.weeks, blocked: bm.blocked, due, dueRelative: cap(relative(due, ctx.now())),
      fortnoxDays: days, stepNow, collectiveAllowed: b.cfg.billing.collectiveInvoiceAllowed,
      counts: {
        blocked: buckets.filter((x) => x === "blocked").length, zeroPending: zero.filter((z) => z.month === cur.month && !z.approved).length,
        review: buckets.filter((x) => x === "review").length, ready: buckets.filter((x) => x === "ready").length,
      },
    };
  }

  return {
    canAct: b.canAct, customerName: b.customer?.name ?? "", current, openTasks: tasks.filter((t) => t.status === "open").length,
    unbilled: { totalOre: sum(ub, (x) => x.amountOre), count: ub.length, limit: b.cfg.billing.unbilledWarningDays, prescText: prescText(b.cfg.billing), rows: ubRows },
    tasks: taskViews, returned, refCases, zero, runs: runRows,
    fortnox: { lastRun: lastRun ? { at: lastRun.ranAt, created: lastRun.created, skipped: lastRun.skipped } : null, lastSync: lastSync ? { at: lastSync.ranAt, changed: lastSync.changed } : null },
    priceSpan: priceSpan(db.price_items, today), refRules: b.refRules,
  };
});

// ---------------------------------------------------------------- eko.fortnoxLog
handleCommand(ekoFortnoxLog, { roles: BILLING }, async (ctx, p) => {
  const contractId = (await currentContractId(ctx, p.month));
  const id = ctx.newId("fxrun");
  await ctx.repo.table("fortnox_runs").insert({
    id, contractId, month: p.month, kind: "create", ranAt: ctx.now(), ranBy: ctx.actor.userId, created: p.created.length, skipped: p.skipped, notReady: p.notReady,
    blocked: p.blocked, changed: 0,
  });
  await ctx.audit({
    action: "billing.fortnox_run", entity: "billing_run", entityId: p.month, contractId,
    details: { created: p.created.length, skippedDuplicates: p.skipped, blocked: p.blocked, notApproved: p.notReady, idempotencyKey: "månad:ärende" },
  });
  return ok({ runId: id });
});

/** Avtalet för månadens körning (annars användarens första avtal). */
async function currentContractId(ctx: Ctx, month: MonthKey): Promise<string> {
  const run = await ctx.repo.table("billing_runs").first({ month });
  return run?.contractId ?? ctx.actor.contractIds[0] ?? "";
}

// ---------------------------------------------------------------- eko.fortnoxSync (simulerad statushämtning)
const NEXT: Partial<Record<InvoiceStatus, InvoiceStatus>> = { fortnox_created: "booked", booked: "sent", sent: "paid" };
handleCommand(ekoFortnoxSync, { roles: BILLING }, async (ctx, p) => {
  const cases = await loadCases(ctx, p.caseIds);
  if (!cases) return fail("not_found", NOT_FOUND);
  const now = ctx.now();
  const runs = await ctx.repo.table("billing_runs").list({ month: p.month });
  let changed = 0;
  for (const c of cases) {
    const draft = await draftFor(ctx, p.month, c);
    const cur = invoiceStatus({ invoice_drafts: [draft], billing_runs: runs.filter((r) => r.contractId === c.contractId) }, p.month, c.id);
    const next = NEXT[cur];
    if (!next) continue;
    await upsert(ctx.repo.table("invoice_drafts"), { ...draft, status: next, syncedAt: now });
    changed++;
  }
  const contractId = cases[0]?.contractId ?? (await currentContractId(ctx, p.month));
  await ctx.repo.table("fortnox_runs").insert({
    id: ctx.newId("fxrun"), contractId, month: p.month, kind: "sync", ranAt: now, ranBy: ctx.actor.userId, created: 0, skipped: 0, notReady: 0, blocked: 0, changed,
  });
  await ctx.audit({ action: "billing.fortnox_status_synced", entity: "billing_run", entityId: p.month, contractId, details: { changed } });
  return ok({ changed });
});

// ---------------------------------------------------------------- eko.reissue (kreditera och skapa ny faktura)
handleCommand(ekoReissue, { roles: BILLING }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  const { cfg } = await contractOf(ctx, c.contractId);
  const refs = await ctx.repo.table("buyer_references").list();
  if (buyerRefProblem(c, { buyer_references: refs }, cfg)) return fail("buyer_ref", "Rätta beställarreferensen innan du skapar en ny faktura.");
  const draft = await draftFor(ctx, p.month, c);
  const runs = await ctx.repo.table("billing_runs").list({ month: p.month, contractId: c.contractId });
  if (invoiceStatus({ invoice_drafts: [draft], billing_runs: runs }, p.month, c.id) !== "returned") return fail("not_returned", "Fakturan är inte returnerad.");
  const now = ctx.now();
  await ctx.repo.table("invoice_credits").insert({
    id: ctx.newId("kredit"), contractId: c.contractId, month: p.month, caseId: c.id, creditedAt: now, creditedBy: ctx.actor.userId, buyerReference: c.buyerReference,
  });
  await upsert(ctx.repo.table("invoice_drafts"), {
    ...draft, status: "fortnox_created", fortnoxIdempotencyKey: `${p.month}:${c.id}:ny`, fortnoxCreatedAt: now, buyerReference: c.buyerReference,
  });
  await ctx.audit({ action: "billing.credited_and_reissued", entity: "case", entityId: c.id, contractId: c.contractId, details: { month: p.month, buyerReference: c.buyerReference } });
  return ok({});
});

// ---------------------------------------------------------------- eko.taskDone
handleCommand(ekoTaskDone, { roles: BILLING }, async (ctx, p) => {
  const t = await ctx.repo.table("tasks").get(p.taskId);
  if (!t) return fail("not_found", "Uppgiften finns inte.");
  await ctx.repo.table("tasks").update(t.id, { status: "done", doneAt: ctx.now(), doneBy: ctx.actor.userId, doneNote: p.note ?? "" });
  await ctx.audit({ action: "task.done", entity: "task", entityId: t.id, contractId: null, details: {} });
  return ok({});
});

// ---------------------------------------------------------------- eko.askCoordinator (bara ärendenummer – inga namn)
handleCommand(ekoAskCoordinator, { roles: BILLING }, async (ctx, p) => {
  const [c, other] = await Promise.all([ctx.repo.table("cases").get(p.caseId), ctx.repo.table("cases").get(p.otherCaseId)]);
  if (!c || !other) return fail("not_found", NOT_FOUND);
  const { contract } = await contractOf(ctx, c.contractId);
  const db = await loadBilling(ctx, contract);
  const env = { now: ctx.now(), cfg: requireOperational(contract.config) };
  const inv = invoiceFor(db, c, p.month, env);
  const ch = inv?.checks.find((x) => x.kind === "overlap" && x.label.includes(other.caseNumber));
  if (!ch) return fail("no_overlap", "Ärendena överlappar inte den här månaden.");
  const weeks = (ch.text.match(/\(([^)]*)\)/) ?? [])[1] ?? "";
  const id = ctx.newId("task");
  await ctx.repo.table("tasks").insert({
    id, toRole: "samordnare", toId: null, fromId: ctx.actor.userId, createdAt: ctx.now(), status: "open", kind: "billing_question", caseIds: [c.id, other.id],
    text: `Faktureringskontroll ${monthName(p.month)}: ${c.caseNumber} och ${other.caseNumber} gäller samma deltagare och överlappar (${weeks}). Samma vecka får bara faktureras en gång. Vilket ärende ska faktureras för veckan? Behöver start- eller slutdatum rättas?`,
    deviationId: null, emailId: null, responseId: null, month: p.month, doneAt: null, doneBy: null, doneNote: null,
  });
  await ctx.audit({ action: "task.created", entity: "task", entityId: id, contractId: c.contractId, details: { toRole: "samordnare", caseIds: [c.id, other.id] } });
  return ok({ taskId: id });
});

// ---------------------------------------------------------------- eko.closeRun
handleCommand(ekoCloseRun, { roles: BILLING }, async (ctx, p) => {
  const r = await ctx.repo.table("billing_runs").first({ month: p.month });
  if (!r) return fail("not_found", "Det finns ingen fakturakörning för månaden.");
  await ctx.repo.table("billing_runs").update(r.id, { status: "closed", closedAt: ctx.now(), closedBy: ctx.actor.userId });
  await ctx.audit({ action: "billing.run_closed", entity: "billing_run", entityId: r.id, contractId: r.contractId, details: { month: p.month } });
  return ok({});
});
