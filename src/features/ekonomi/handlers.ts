// Hanterare för området ekonomi (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
//
// Beslut 2026-10-07 (Karim, synpunkt #13 och beslut 3): en faktura per avtal och månad med en rad per ärende
// (src/core/billing.ts monthInvoices). Beställarreferensen fylls i av ekonomen, en per faktura, och kontrolleras innan fakturan
// skapas (CLAUDE.md punkt 11). Raderna fryses (invoice_lines) när fakturan skapas i Fortnox eller markeras som manuellt
// fakturerad; veckor som tillkommer efteråt hamnar på en tilläggsfaktura.
// Beslut 5 (2026-10-07): belopp syns bara för rollen ekonom – alla frågor och kommandon här är bara för ekonomen (och nekas
// för begränsade testare, HandlerOpts.commercial).
import { fail, ok } from "@/api/contract";
import { loadDb } from "@/api/load";
import type { Role } from "@/api/roles";
import { ApiError, handleCommand, handleQuery, type Ctx } from "@/api/server";
import {
  BILLED_STATUSES, billableWeeks, billingLines, findInvoice, fortnoxKeyOf, fortnoxNumber, invoiceOfCase, isCreated, monthInvoices, reissueLines, reissueRound, unbilledOld,
  type BillingMonth, type InvoiceLineView, type MonthInvoice,
} from "@/core/billing";
import { CASE_NUMBER_RE, findCaseNumber, priceFor, priceItem } from "@/core/cases";
import { DEFAULT_ORG_SETTINGS, isOperational, requireOperational, type OperationalConfig } from "@/core/config";
import { areaName, invoiceStatusLabel, personName } from "@/core/labels";
import { slaStatus, type SlaStatus } from "@/core/sla";
import { addDays, addMonths, dayOf, diffDays, monday, monthKey, monthName, relative, weeksOfMonth, type LocalDateTime, type MonthKey } from "@/core/time";
import { by, groupBy, sum } from "@/core/util";
import { buyerRefError, poNumberError, poNumberValid } from "@/core/validation";
import { PolicyError, UniqueError } from "@/data/repo";
import type { Case, Contract, ContractArea, InvoiceCredit, InvoiceDisplayStatus, InvoiceDraft, InvoiceLine, InvoiceStatus, Organization, Profile, Task } from "@/data/schema";
import { upsert } from "../_shared/context";
import { FORTNOX_OFF_ERROR, fortnoxOff } from "../_shared/fortnox-port";
import { newInvoiceDraft } from "../_shared/rows";
import {
  billingApproveInvoice, billingApproveZeroWeek, billingExport, billingMarkManual, billingSendFortnox, ekoAskCoordinator, ekoCase, ekoCaseList, ekoCloseRun, ekoCsv,
  ekoFortnoxSync, ekoLine, ekoPreview, ekoPriceList, ekoReissue, ekoRun, ekoStart, ekoTaskDone, invoiceSetBuyerRef, invoiceSetPo,
  type BillingStartView, type CaseMonthRow, type InvoiceCheckView, type InvoiceView, type LineRow, type OverlapView, type RefInvoiceRow, type RefSuggestion,
  type ReturnedRow, type RunRow, type RunView, type SlaView, type TaskRef, type TaskView, type UnbilledRow, type ZeroRow,
} from "./api";
import {
  bucketOf, cap, caseLedger, checkText, fortnoxDue, invoiceSummary, invoiceText, invoiceTitle, monthRules, noteText, periodOf, poText, prescText, prescriptionDate, priceSpan,
  refFromTask, refInfo, refLenText, remarksOf, tally, toCsv, type RefRules,
} from "./model";

/** Bara ekonomen gör fakturakörningen och ser fakturaunderlaget (SPEC §4, beslut 5 2026-10-07: belopp bara för ekonomen). */
const BILLING: readonly Role[] = ["ekonom"];
const NOT_FOUND = "Ärendet finns inte, eller så har du inte behörighet att se det.";
const NO_INVOICE = "Fakturan finns inte för månaden.";

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
  perContract: boolean;
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
    contract, cfg, env: { now: ctx.now(), cfg }, customer, supplier, areas, profiles, canAct: ctx.actor.role === "ekonom", perContract: cfg.billing.invoicePer === "contract_and_month",
    refRules: { billing: cfg.billing, registry: registry.map((b) => ({ reference: b.reference, unit: b.unit, active: b.active, note: b.note })) },
  };
}

/** Fakturadata för avtalet (ärenden, närvaro, priser, referenser, fakturor, frysta rader och körningar). */
async function loadBilling(ctx: Ctx, contract: Contract) {
  const db = await loadDb(ctx.repo, BILLING_TABLES, {
    cases: { contractId: contract.id }, price_items: { contractId: contract.id }, buyer_references: { customerId: contract.customerId },
    invoice_drafts: { contractId: contract.id }, billing_runs: { contractId: contract.id }, billing_week_approvals: { contractId: contract.id },
  });
  const ids = db.invoice_drafts.map((d) => d.id);
  const invoice_lines = ids.length ? await ctx.repo.table("invoice_lines").list({ invoiceDraftId: { in: ids } }) : [];
  return { ...db, invoice_lines };
}
type BillingData = Awaited<ReturnType<typeof loadBilling>>;

const areaTitle = (b: Base, code: string | null) => b.areas.find((a) => a.code === code)?.name ?? "";

function checkView(b: Base, ch: InvoiceLineView["checks"][number], line?: Pick<InvoiceLineView, "orderWeeks" | "accruedWeeks">): InvoiceCheckView {
  return {
    kind: ch.kind, severity: ch.severity, label: ch.label, text: line ? checkText(ch, line) : noteText(ch.text), weekKey: ch.weekKey ?? null,
    approval: ch.approval ? { byName: personName(b.profiles, ch.approval.by), at: ch.approval.at, note: ch.approval.note } : null,
  };
}

function lineRow(b: Base, l: InvoiceLineView): LineRow {
  return {
    caseId: l.caseId, caseNumber: l.caseNumber, areaCode: l.areaCode, areaTitle: areaTitle(b, l.areaCode), areaName: areaName(b.areas, l.areaCode), articleNo: l.articleNo,
    weeks: l.weeks, quantity: l.quantity, unitPriceOre: l.unitPriceOre, amountOre: l.amountOre, vatRate: l.vatRate, checks: l.checks.map((ch) => checkView(b, ch, l)),
    needsApproval: l.needsApproval, remarks: remarksOfLine(l), frozen: l.frozen, lineText: l.lineText, orderWeeks: l.orderWeeks, accruedWeeks: l.accruedWeeks,
  };
}

/** Anmärkningar på raden. En fryst rad har bara en: veckor som inte längre är debiterbara (de behöver krediteras). */
const remarksOfLine = (l: InvoiceLineView): number => (l.frozen ? l.checks.filter((c) => c.kind === "not_billable").length : remarksOf(l.checks));

const caseNumberOf = (inv: MonthInvoice) => (inv.groupingKey.startsWith("avtal") ? null : (inv.lines[0]?.caseNumber ?? null));
const titleOf = (inv: MonthInvoice) => invoiceTitle(inv, caseNumberOf(inv));

/**
 * Förslag till fakturans beställarreferens – ekonomen bekräftar, referensen fylls aldrig i av sig själv: referensen i en öppen
 * uppgift till ekonomen (t.ex. från avtalsansvarig), förra månadens faktura och referenserna i ärendenas beställningar.
 */
function refSuggestions(b: Base, db: BillingData, inv: MonthInvoice, tasks: readonly Task[]): RefSuggestion[] {
  if (inv.created && inv.storedStatus !== "returned") return [];
  const out: RefSuggestion[] = [];
  const add = (reference: string | null | undefined, source: string) => {
    const r = String(reference ?? "").trim();
    if (!r || r === inv.buyerReference || out.some((x) => x.reference === r) || !refInfo(r, b.refRules).ok) return;
    out.push({ reference: r, source });
  };
  const caseIds = new Set(inv.lines.map((l) => l.caseId));
  for (const t of tasks.filter((x) => x.status === "open" && (x.caseIds.some((id) => caseIds.has(id)) || !x.caseIds.length))) {
    add(refFromTask(t.text, inv.buyerReference, b.refRules), `Uppgift från ${personName(b.profiles, t.fromId)}`);
  }
  const prev = db.invoice_drafts
    .filter((d) => d.kind === "periodic" && d.month === addMonths(inv.month, -1) && isCreated(d.status) && d.status !== "returned")
    .sort((a, x) => (a.groupingKey < x.groupingKey ? -1 : 1))[0];
  add(prev?.buyerReference, `Förra månadens faktura (${monthName(addMonths(inv.month, -1))})`);
  const counts = Object.entries(groupBy(inv.lines.filter((l) => l.caseBuyerReference), (l) => l.caseBuyerReference as string)).sort((a, x) => x[1].length - a[1].length);
  for (const [ref, ls] of counts) add(ref, `Beställningarna: ${ls.length} av ${inv.lines.length} ärenden`);
  return out.slice(0, 4);
}

function creditOf(credits: readonly InvoiceCredit[], inv: Pick<MonthInvoice, "id">): { at: LocalDateTime; reference: string | null } | null {
  const c = credits.filter((x) => x.invoiceDraftId === inv.id).sort((a, x) => (a.creditedAt < x.creditedAt ? 1 : -1))[0];
  return c ? { at: c.creditedAt, reference: c.buyerReference } : null;
}

function invoiceView(b: Base, db: BillingData, inv: MonthInvoice, tasks: readonly Task[], credits: readonly InvoiceCredit[]): InvoiceView {
  const draft = db.invoice_drafts.find((d) => d.id === inv.id) ?? null;
  return {
    id: inv.id, month: inv.month, groupingKey: inv.groupingKey, number: inv.number, title: titleOf(inv), status: inv.status, created: inv.created,
    buyerReference: inv.buyerReference, ref: refInfo(inv.buyerReference, b.refRules), refSuggestions: refSuggestions(b, db, inv, tasks),
    purchaseOrderNumber: inv.purchaseOrderNumber, poSet: draft?.purchaseOrderNumber != null, checks: inv.checks.map((ch) => checkView(b, ch)), blocked: inv.blocked,
    needsApproval: inv.needsApproval, remarks: inv.lines.filter((l) => remarksOfLine(l) > 0).length, bucket: bucketOf(inv), quantity: inv.quantity,
    amountOre: inv.amountOre, vatOre: inv.vatOre, vat: inv.vat, approved: inv.approvedAt ? { at: inv.approvedAt, byName: personName(b.profiles, inv.approvedBy) } : null,
    fortnoxNo: inv.fortnoxNo, manualInvoiceNo: inv.manualInvoiceNo, hasKey: !!inv.fortnoxIdempotencyKey, credit: creditOf(credits, inv), lines: inv.lines.map((l) => lineRow(b, l)),
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

/**
 * Månadens fakturor för hela avtalet, räknade en gång per månad och fråga. Fakturans status och kontroller (referens,
 * inköpsordernummer) gäller hela fakturan – de räknas aldrig på bara deltagarens ärenden (granskningen 2026-10-07).
 */
function monthCache(db: BillingData, env: Base["env"]): (month: MonthKey) => BillingMonth {
  const cache = new Map<MonthKey, BillingMonth>();
  return (month) => {
    let bm = cache.get(month);
    if (!bm) cache.set(month, (bm = monthInvoices(db, month, env)));
    return bm;
  };
}

/** Fakturan som har ärendets rad – för ärendets vy och radens detalj. */
function invoiceForCase(months: (month: MonthKey) => BillingMonth, c: Case, month: MonthKey): MonthInvoice | null {
  return invoiceOfCase(months(month), c.id);
}

/** Uppgifter till ekonomen (t.ex. rätt beställarreferens från avtalsansvarig). */
async function ekonomTasks(ctx: Ctx): Promise<Task[]> {
  return ctx.repo.table("tasks").list({ toRole: "ekonom" });
}
const taskRef = (b: Base, t: Task): TaskRef => ({ id: t.id, fromName: personName(b.profiles, t.fromId), createdAt: t.createdAt, text: t.text });

/** Radens anmärkning (Peppol BT-127): upparbetat och återstående på beställningen. En fryst rad behåller sin sparade text. */
function lineNote(db: BillingData, inv: MonthInvoice, l: InvoiceLineView, env: Base["env"]): string {
  if (l.frozen && l.note) return l.note;
  const c = db.cases.find((x) => x.id === l.caseId);
  return c ? invoiceSummary(l, caseLedger(c, db, env), inv.stored ? inv.id : null).text : "";
}

/** Månadens fakturor för kommandona (underlaget läses om – aldrig från skärmen). */
async function monthOf(ctx: Ctx, month: MonthKey) {
  const b = await base(ctx);
  const db = await loadBilling(ctx, b.contract);
  return { b, db, bm: monthInvoices(db, month, b.env) };
}

/** Spara fakturans rad i invoice_drafts (den finns först när ekonomen gör något med fakturan). */
async function saveInvoice(ctx: Ctx, b: Base, db: BillingData, inv: MonthInvoice, patch: Partial<InvoiceDraft>): Promise<InvoiceDraft> {
  const cur = await ctx.repo.table("invoice_drafts").get(inv.id);
  const run = db.billing_runs.find((r) => r.month === inv.month) ?? null;
  const row = cur ?? newInvoiceDraft({
    id: inv.id, month: inv.month, contractId: inv.contractId, groupingKey: inv.groupingKey, billingRunId: run?.id ?? null,
    invoicedObject: b.perContract ? b.contract.contractNumber : (inv.lines[0]?.caseNumber ?? b.contract.contractNumber), caseId: b.perContract ? null : (inv.lines[0]?.caseId ?? null),
  });
  return upsert(ctx.repo.table("invoice_drafts"), { ...row, ...patch });
}

/** Fakturans rad i invoice_drafts – skapas som underlag om den saknas. En befintlig rad ändras aldrig här. */
async function ensureInvoiceRow(ctx: Ctx, b: Base, db: BillingData, inv: MonthInvoice): Promise<InvoiceDraft> {
  const table = ctx.repo.table("invoice_drafts");
  const cur = await table.get(inv.id);
  if (cur) return cur;
  const run = db.billing_runs.find((r) => r.month === inv.month) ?? null;
  const row = newInvoiceDraft({
    id: inv.id, month: inv.month, contractId: inv.contractId, groupingKey: inv.groupingKey, billingRunId: run?.id ?? null,
    invoicedObject: b.perContract ? b.contract.contractNumber : (inv.lines[0]?.caseNumber ?? b.contract.contractNumber), caseId: b.perContract ? null : (inv.lines[0]?.caseId ?? null),
  });
  try {
    return await table.insert(row);
  } catch (e) {
    // En samtidig körning skapade raden.
    const again = e instanceof UniqueError ? await table.get(inv.id) : null;
    if (again) return again;
    throw e;
  }
}

/**
 * Skriv fakturans rader (invoice_lines) så att de blir exakt `lines` – idempotent med fasta id:n (faktura:ärende): en rad som
 * redan finns (en tidigare körning som avbröts) skrivs över, och rader för ärenden som inte längre är med tas bort. Går bara
 * medan fakturan får ändras (underlag, godkänd, eller returnerad när den görs om – 0023 mm.invoice_editable och policy.ts);
 * annars PolicyError.
 */
async function writeLines(ctx: Ctx, db: BillingData, inv: MonthInvoice, lines: readonly InvoiceLineView[], env: Base["env"]): Promise<void> {
  const table = ctx.repo.table("invoice_lines");
  const keep = new Set<string>();
  for (const l of lines) {
    const row: InvoiceLine = {
      id: `${inv.id}:${l.caseId}`, invoiceDraftId: inv.id, caseId: l.caseId, priceItemId: l.priceItemId, quantity: l.quantity, unitPriceOre: l.unitPriceOre,
      vatRate: l.vatRate, description: l.lineText, isoWeeks: l.weeks.map((w) => w.key), zeroAttendanceWeeks: l.weeks.filter((w) => w.zeroAttendance).map((w) => w.key),
      note: lineNote(db, inv, { ...l, frozen: false, note: "" }, env),
    };
    keep.add(row.id);
    try {
      await table.insert(row);
    } catch (e) {
      if (!(e instanceof UniqueError)) throw e;
      await table.update(row.id, row);
    }
  }
  for (const old of await table.list({ invoiceDraftId: inv.id })) if (!keep.has(old.id)) await table.remove(old.id);
}

/**
 * Skapa fakturan (i Fortnox eller manuellt): raden i invoice_drafts finns, raderna skrivs (idempotent) och statusen ändras
 * villkorat från `from` (Table.updateIf) – sist. En körning som avbröts (nätverksfel, tidsgräns) kan därför göras om, och två
 * samtidiga körningar skapar aldrig samma faktura två gånger. "Redan skapad" avgörs av fakturans status – aldrig av att en
 * rad finns. already = en tidigare eller samtidig körning hann före; not_ready = fakturan har inte statusen i `from`.
 */
async function createInvoice(
  ctx: Ctx, b: Base, db: BillingData, inv: MonthInvoice, from: readonly InvoiceStatus[], patch: Partial<InvoiceDraft>,
): Promise<"created" | "already" | "not_ready"> {
  const drafts = ctx.repo.table("invoice_drafts");
  const row = await ensureInvoiceRow(ctx, b, db, inv);
  if (isCreated(row.status)) return "already";
  if (!from.includes(row.status)) return "not_ready";
  const settled = async () => {
    const cur = await drafts.get(inv.id);
    return cur && isCreated(cur.status) ? "already" : "not_ready";
  };
  try {
    await writeLines(ctx, db, inv, inv.lines, b.env);
  } catch (e) {
    // Raderna får inte längre ändras: en samtidig körning har redan skapat fakturan.
    if (e instanceof PolicyError) return settled();
    throw e;
  }
  const done = await drafts.updateIf(inv.id, { status: { in: [...from] } }, patch);
  return done ? "created" : settled();
}

// ================================================================ Kommandon

// ---------------------------------------------------------------- billing.approveZeroWeek
handleCommand(billingApproveZeroWeek, { roles: BILLING, commercial: true }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  await upsert(ctx.repo.table("billing_week_approvals"), {
    id: `${c.id}:${p.weekKey}`, contractId: c.contractId, month: p.month, caseId: c.id, weekKey: p.weekKey, approvedBy: ctx.actor.userId, approvedAt: ctx.now(), note: p.note ?? "",
  });
  await ctx.audit({ action: "billing.zero_week_approved", entity: "case", entityId: c.id, contractId: c.contractId, details: { week: p.weekKey, note: p.note ?? "" } });
  return ok({});
});

// ---------------------------------------------------------------- billing.approveInvoice (hela fakturan)
handleCommand(billingApproveInvoice, { roles: BILLING, commercial: true }, async (ctx, p) => {
  const { b, db, bm } = await monthOf(ctx, p.month);
  const inv = findInvoice(bm, p.invoiceId);
  if (!inv) return fail("not_found", NO_INVOICE);
  if (inv.created) return fail("created", "Fakturan är redan skapad.");
  if (!inv.lines.length) return fail("empty", "Fakturan har inga rader.");
  if (inv.needsApproval) return fail("needs_approval", "Godkänn veckorna utan närvaro först.");
  await saveInvoice(ctx, b, db, inv, { status: "approved", approvedBy: ctx.actor.userId, approvedAt: ctx.now() });
  await ctx.audit({ action: "billing.approved", entity: "invoice", entityId: inv.id, contractId: inv.contractId, details: { month: p.month, rows: inv.lines.length } });
  return ok({ lines: inv.lines.length });
});

// ---------------------------------------------------------------- billing.sendFortnox (idempotent) + körningens logg
handleCommand(billingSendFortnox, { roles: BILLING, commercial: true }, async (ctx, p) => {
  // Utan Fortnox-port (supabase-läget tills en riktig klient finns) ändras ingenting: ingen rad fryses, ingen status, inget
  // nummer, ingen logg "skapad i Fortnox". Fakturan skapas i Fortnox för hand och markeras som manuellt fakturerad.
  if (fortnoxOff(ctx)) return fail("fortnox_off", FORTNOX_OFF_ERROR);
  const { b, db, bm } = await monthOf(ctx, p.month);
  const invoices: MonthInvoice[] = [];
  for (const id of new Set(p.invoiceIds)) {
    const inv = findInvoice(bm, id);
    if (!inv) return fail("not_found", NO_INVOICE);
    invoices.push(inv);
  }
  const now = ctx.now();
  const created: string[] = [];
  const skipped: string[] = [];
  const blocked: string[] = [];
  const notApproved: string[] = [];
  for (const inv of invoices) {
    // Samma faktura skapas aldrig två gånger (nyckel avtal:månad:grupp).
    if (inv.created) {
      skipped.push(inv.id);
      continue;
    }
    // Beställarreferensen och inköpsordernumret kontrolleras innan en faktura skapas (CLAUDE.md punkt 11).
    if (inv.blocked) {
      blocked.push(inv.id);
      continue;
    }
    if (inv.storedStatus !== "approved" || inv.needsApproval) {
      notApproved.push(inv.id);
      continue;
    }
    const outcome = await createInvoice(ctx, b, db, inv, ["approved"], {
      status: "fortnox_created", fortnoxIdempotencyKey: fortnoxKeyOf(inv.contractId, inv.month, inv.groupingKey), fortnoxCreatedAt: now,
      fortnoxDocumentNumber: fortnoxNumber(null, inv.month, inv.groupingKey), buyerReference: inv.buyerReference, purchaseOrderNumber: inv.purchaseOrderNumber,
    });
    if (outcome === "created") created.push(inv.id);
    else if (outcome === "already") skipped.push(inv.id);
    else notApproved.push(inv.id);
  }
  const runId = ctx.newId("fxrun");
  await ctx.repo.table("fortnox_runs").insert({
    id: runId, contractId: b.contract.id, month: p.month, kind: "create", ranAt: now, ranBy: ctx.actor.userId, created: created.length, skipped: skipped.length,
    notReady: notApproved.length, blocked: blocked.length, changed: 0,
  });
  await ctx.audit({
    action: "billing.fortnox_created", entity: "billing_run", entityId: p.month, contractId: b.contract.id,
    details: {
      created: created.length, skippedAlreadyCreated: skipped.length, blocked: blocked.length, notApproved: notApproved.length,
      idempotencyKeys: invoices.filter((x) => created.includes(x.id)).map((x) => fortnoxKeyOf(x.contractId, x.month, x.groupingKey)),
    },
  });
  return ok({ created, skipped, blocked, notApproved, runId });
});

// ---------------------------------------------------------------- billing.markManual (reservvägen)
handleCommand(billingMarkManual, { roles: BILLING, commercial: true }, async (ctx, p) => {
  const { b, db, bm } = await monthOf(ctx, p.month);
  const inv = findInvoice(bm, p.invoiceId);
  if (!inv) return fail("not_found", NO_INVOICE);
  if (inv.created) return fail("created", "Fakturan är redan skapad.");
  // Referensen krävs också när fakturan registreras för hand (CLAUDE.md punkt 11).
  if (inv.blocked) return fail("blocked", "Fakturan är stoppad. Fyll i en giltig beställarreferens först.");
  if (inv.needsApproval) return fail("needs_approval", "Godkänn veckorna utan närvaro först.");
  if (!inv.lines.length) return fail("empty", "Fakturan har inga rader.");
  // Raden i invoice_drafts skapas först (en faktura som ännu inte är sparad), sedan raderna och sist statusen.
  const outcome = await createInvoice(ctx, b, db, inv, ["draft", "approved"], {
    status: "manual", manualInvoiceNo: p.invoiceNo, buyerReference: inv.buyerReference, purchaseOrderNumber: inv.purchaseOrderNumber,
  });
  if (outcome !== "created") return fail("created", "Fakturan är redan skapad.");
  await ctx.audit({ action: "billing.manual", entity: "invoice", entityId: inv.id, contractId: inv.contractId, details: { month: p.month, invoiceNo: p.invoiceNo } });
  return ok({});
});

// ---------------------------------------------------------------- billing.export
handleCommand(billingExport, { roles: BILLING, commercial: true }, async (ctx, p) => {
  await ctx.audit({ action: "export.billing", entity: "billing_run", entityId: p.month, contractId: ctx.actor.contractIds[0] ?? null, details: { format: p.format } });
  return ok({});
});

// ---------------------------------------------------------------- Fakturans beställarreferens (beslut 3: en per faktura)
handleCommand(invoiceSetBuyerRef, { roles: BILLING, commercial: true }, async (ctx, p) => {
  const { b, db, bm } = await monthOf(ctx, p.month);
  const inv = findInvoice(bm, p.invoiceId);
  if (!inv) return fail("not_found", NO_INVOICE);
  if (inv.created && inv.storedStatus !== "returned") return fail("created", "Fakturan är redan skapad. Referensen kan inte ändras.");
  const ref = p.reference.trim();
  const err = buyerRefError(ref, b.cfg);
  if (err) return fail("buyer_ref", noteText(err));
  if (!refInfo(ref, b.refRules).ok) return fail("buyer_ref", `Referensen ${ref} är spärrad hos kommunen. Använd referensen som kommunen har bekräftat.`);
  if (ref === inv.buyerReference) return fail("unchanged", "Fakturan har redan den referensen.");
  await saveInvoice(ctx, b, db, inv, { buyerReference: ref });
  await ctx.audit({ action: "billing.buyer_reference_set", entity: "invoice", entityId: inv.id, contractId: inv.contractId, details: { month: p.month, from: inv.buyerReference ?? "", to: ref } });
  return ok({});
});

// ---------------------------------------------------------------- Fakturans inköpsordernummer (bara kommunens 99-nummer)
handleCommand(invoiceSetPo, { roles: BILLING, commercial: true }, async (ctx, p) => {
  const { b, db, bm } = await monthOf(ctx, p.month);
  const inv = findInvoice(bm, p.invoiceId);
  if (!inv) return fail("not_found", NO_INVOICE);
  if (inv.created) return fail("created", "Fakturan är redan skapad. Inköpsordernumret kan inte ändras.");
  const po = p.purchaseOrderNumber.trim();
  // Våra egna nummer (ärendenummer) får aldrig ligga i fältet för kommunens ordernummer (CLAUDE.md punkt 11).
  if (CASE_NUMBER_RE.test(po)) return fail("po", "Ärendenumret får aldrig stå som inköpsordernummer. Fältet är bara för kommunens eget ordernummer.");
  if (po && !poNumberValid(po, b.cfg)) return fail("po", poNumberError(po, b.cfg) ?? "Inköpsordernumret har fel format.");
  await saveInvoice(ctx, b, db, inv, { purchaseOrderNumber: po });
  await ctx.audit({
    action: "billing.purchase_order_set", entity: "invoice", entityId: inv.id, contractId: inv.contractId,
    details: { month: p.month, from: inv.purchaseOrderNumber, to: po },
  });
  return ok({});
});

// ---------------------------------------------------------------- eko.fortnoxSync (statushämtning; minnesläget: simulerad)
const NEXT: Partial<Record<InvoiceStatus, InvoiceStatus>> = { fortnox_created: "booked", booked: "sent", sent: "paid" };
handleCommand(ekoFortnoxSync, { roles: BILLING, commercial: true }, async (ctx, p) => {
  // Utan Fortnox-port flyttas ingen status och ingen körning loggas.
  if (fortnoxOff(ctx)) return fail("fortnox_off", FORTNOX_OFF_ERROR);
  const b = await base(ctx);
  const now = ctx.now();
  const drafts = await ctx.repo.table("invoice_drafts").list({ month: p.month, contractId: b.contract.id, kind: "periodic" });
  let changed = 0;
  for (const d of drafts.sort((a, x) => (a.id < x.id ? -1 : 1))) {
    const next = NEXT[d.status];
    if (!next) continue;
    await ctx.repo.table("invoice_drafts").update(d.id, { status: next, syncedAt: now });
    changed++;
  }
  await ctx.repo.table("fortnox_runs").insert({
    id: ctx.newId("fxrun"), contractId: b.contract.id, month: p.month, kind: "sync", ranAt: now, ranBy: ctx.actor.userId, created: 0, skipped: 0, notReady: 0, blocked: 0, changed,
  });
  await ctx.audit({ action: "billing.fortnox_status_synced", entity: "billing_run", entityId: p.month, contractId: b.contract.id, details: { changed } });
  return ok({ changed });
});

// ---------------------------------------------------------------- eko.reissue (kreditera och skapa ny faktura)
handleCommand(ekoReissue, { roles: BILLING, commercial: true }, async (ctx, p) => {
  // Den nya fakturan får status "Skapad i Fortnox" och ett fakturanummer – förutsätter porten. Utan port: ingen kreditering,
  // ingen ny faktura.
  if (fortnoxOff(ctx)) return fail("fortnox_off", FORTNOX_OFF_ERROR);
  const { b, db, bm } = await monthOf(ctx, p.month);
  const inv = findInvoice(bm, p.invoiceId);
  if (!inv || !inv.stored) return fail("not_found", NO_INVOICE);
  if (inv.storedStatus !== "returned") return fail("not_returned", "Fakturan är inte returnerad.");
  if (inv.blocked) return fail("buyer_ref", "Rätta beställarreferensen innan du skapar en ny faktura.");
  const now = ctx.now();
  // Den nya fakturan räknas på nytt från dagens underlag: de frysta raderna med bara de veckor som fortfarande är debiterbara
  // (en vecka som rättats bort i efterhand, t.ex. ett uppehåll, faktureras inte igen). Nya veckor står på månadens öppna faktura.
  const lines = reissueLines(inv, billingLines(db, p.month, b.env));
  const round = reissueRound(inv.fortnoxIdempotencyKey);
  const drafts = ctx.repo.table("invoice_drafts");
  // Kreditfakturan: en per returnerad faktura och omgång (fast id) – en omkörning efter ett avbrott skriver den inte två gånger.
  try {
    await ctx.repo.table("invoice_credits").insert({
      id: `kredit-${inv.id}-${round}`, contractId: inv.contractId, month: p.month, invoiceDraftId: inv.id, caseId: null, creditedAt: now, creditedBy: ctx.actor.userId,
      buyerReference: inv.buyerReference,
    });
  } catch (e) {
    if (!(e instanceof UniqueError)) throw e;
  }
  const before = new Map(inv.lines.map((l) => [l.caseId, l.quantity]));
  const changes = inv.lines
    .map((l) => ({ caseId: l.caseId, from: l.quantity, to: lines.find((x) => x.caseId === l.caseId)?.quantity ?? 0 }))
    .filter((x) => x.from !== x.to);
  if (!lines.length) {
    // Ingen vecka är längre debiterbar: fakturan krediteras utan ny faktura (täcker inga veckor). De frysta raderna står kvar
    // som spår av det som fakturerades.
    if (!(await drafts.updateIf(inv.id, { status: "returned" }, { status: "credited" }))) return fail("not_returned", "Fakturan är inte returnerad.");
    await ctx.audit({ action: "billing.credited", entity: "invoice", entityId: inv.id, contractId: inv.contractId, details: { month: p.month, buyerReference: inv.buyerReference, changes } });
    return ok({ reissued: false });
  }
  // Raderna skrivs om medan fakturan är returnerad (0023: raderna får ändras i den statusen), statusen ändras sist.
  await writeLines(ctx, db, inv, lines, b.env);
  const suffix = `ny${round > 1 ? round : ""}`;
  const done = await drafts.updateIf(inv.id, { status: "returned" }, {
    status: "fortnox_created", fortnoxIdempotencyKey: `${fortnoxKeyOf(inv.contractId, inv.month, inv.groupingKey)}:${suffix}`, fortnoxCreatedAt: now,
    fortnoxDocumentNumber: fortnoxNumber(null, inv.month, `${inv.groupingKey}-${suffix}`),
  });
  if (!done) return fail("not_returned", "Fakturan är inte returnerad.");
  await ctx.audit({
    action: "billing.credited_and_reissued", entity: "invoice", entityId: inv.id, contractId: inv.contractId,
    details: { month: p.month, buyerReference: inv.buyerReference, lines: lines.length, removedLines: [...before.keys()].filter((id) => !lines.some((l) => l.caseId === id)).length, changes },
  });
  return ok({ reissued: true });
});

// ---------------------------------------------------------------- eko.taskDone
handleCommand(ekoTaskDone, { roles: BILLING, commercial: true }, async (ctx, p) => {
  const t = await ctx.repo.table("tasks").get(p.taskId);
  if (!t) return fail("not_found", "Uppgiften finns inte.");
  await ctx.repo.table("tasks").update(t.id, { status: "done", doneAt: ctx.now(), doneBy: ctx.actor.userId, doneNote: p.note ?? "" });
  await ctx.audit({ action: "task.done", entity: "task", entityId: t.id, contractId: null, details: {} });
  return ok({});
});

// ---------------------------------------------------------------- eko.askCoordinator (bara ärendenummer – inga namn)
handleCommand(ekoAskCoordinator, { roles: BILLING, commercial: true }, async (ctx, p) => {
  const [c, other] = await Promise.all([ctx.repo.table("cases").get(p.caseId), ctx.repo.table("cases").get(p.otherCaseId)]);
  if (!c || !other) return fail("not_found", NOT_FOUND);
  const b = await base(ctx);
  const db = await loadBilling(ctx, b.contract);
  const inv = invoiceForCase(monthCache(db, b.env), c, p.month);
  const ch = inv?.lines.find((l) => l.caseId === c.id)?.checks.find((x) => x.kind === "overlap" && x.label.includes(other.caseNumber));
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
handleCommand(ekoCloseRun, { roles: BILLING, commercial: true }, async (ctx, p) => {
  const { db, bm } = await monthOf(ctx, p.month);
  const r = db.billing_runs.find((x) => x.month === p.month);
  if (!r) return fail("not_found", "Det finns ingen fakturakörning för månaden.");
  if (!bm.invoices.every((x) => BILLED_STATUSES.includes(x.storedStatus))) return fail("not_done", "Alla fakturor är inte skapade eller manuellt fakturerade.");
  await ctx.repo.table("billing_runs").update(r.id, { status: "closed", closedAt: ctx.now(), closedBy: ctx.actor.userId });
  await ctx.audit({ action: "billing.run_closed", entity: "billing_run", entityId: r.id, contractId: r.contractId, details: { month: p.month } });
  return ok({});
});

// ================================================================ Frågor
// Vy-modeller för prototypens eko.start, eko.korning, eko.faktura och eko.arende. Läser via ctx.repo – policyn (RLS i
// produktion) ger ekonomen ärenden, närvaro och fakturering men aldrig personer, anteckningar eller rapporter.

// ---------------------------------------------------------------- ekonomi.run (eko.korning)
handleQuery(ekoRun, { roles: BILLING, commercial: true }, async (ctx, p) => {
  const b = await base(ctx);
  const db = await loadBilling(ctx, b.contract);
  const runs = runsSorted(db);
  const month = p.month ?? currentRun(db)?.month ?? null;
  const rules = { weeks: [], notes: [], perContract: b.perContract, refLen: refLenText(b.cfg.billing), poText: poText(b.cfg.billing) };
  const empty: RunView = {
    month: null, canAct: b.canAct, customerName: b.customer?.name ?? "", contractNumber: b.contract.contractNumber, runs: [], run: null, due: null, invoices: [], count: 0,
    totalOre: 0, weeks: 0, vatOre: 0, calendarWeeks: 0, rules, fortnoxRuns: [], fortnox: { connected: !fortnoxOff(ctx) }, priceSpan: null, refRules: b.refRules,
  };
  if (!month) return empty;
  const run = runs.find((r) => r.month === month) ?? null;
  const bm = monthInvoices(db, month, b.env);
  const days = await fortnoxDays(ctx, b.contract);
  const dueAt = fortnoxDue(month, days);
  const [fxRuns, tasks, credits] = await Promise.all([
    ctx.repo.table("fortnox_runs").list({ month, kind: "create", contractId: b.contract.id }),
    ekonomTasks(ctx),
    ctx.repo.table("invoice_credits").list({ contractId: b.contract.id, month }),
  ]);
  return {
    ...empty, month, runs: runs.map((r) => ({ month: r.month, status: r.status })), run: run ? { status: run.status } : null,
    due: run?.status === "draft" ? { at: dueAt, sla: pickSla(slaStatus(dueAt, null, b.env)), days } : null,
    invoices: bm.invoices.map((inv) => invoiceView(b, db, inv, tasks, credits)), count: bm.count, totalOre: bm.totalOre, weeks: bm.weeks,
    vatOre: sum(bm.invoices, (x) => x.vatOre), calendarWeeks: weeksOfMonth(month).length, rules: { ...rules, ...monthRules(month) },
    fortnoxRuns: fxRuns
      .sort((a, x) => (a.ranAt < x.ranAt ? 1 : a.ranAt > x.ranAt ? -1 : a.id < x.id ? 1 : -1))
      .map((r) => ({ id: r.id, at: r.ranAt, byName: personName(b.profiles, r.ranBy), created: r.created, skipped: r.skipped, blocked: r.blocked })),
    priceSpan: priceSpan(db.price_items, dayOf(ctx.now())),
  };
});
const pickSla = (s: SlaStatus): SlaView => ({ label: s.label, tone: s.tone });

// ---------------------------------------------------------------- ekonomi.line (radens detalj i körningen)
handleQuery(ekoLine, { roles: BILLING, commercial: true }, async (ctx, p) => {
  const b = await base(ctx);
  const db = await loadBilling(ctx, b.contract);
  const c = db.cases.find((x) => x.id === p.caseId);
  if (!c) return null;
  const months = monthCache(db, b.env);
  const inv = invoiceForCase(months, c, p.month);
  const line = inv?.lines.find((l) => l.caseId === c.id);
  if (!inv || !line) return null;
  const questions = await ctx.repo.table("tasks").list({ kind: "billing_question", month: p.month });
  const overlaps: Record<string, OverlapView> = {};
  for (const ch of line.checks.filter((x) => x.kind === "overlap")) {
    const num = findCaseNumber(ch.label);
    const other = num ? db.cases.find((x) => x.caseNumber === num) : null;
    if (!other) continue;
    const oInv = invoiceForCase(months, other, p.month);
    const asked = questions.find((t) => t.caseIds.includes(c.id) && t.caseIds.includes(other.id));
    overlaps[ch.label] = { caseId: other.id, caseNumber: other.caseNumber, status: oInv?.status ?? null, startDate: other.startDate, endDate: other.endDate, askedAt: asked?.createdAt ?? null };
  }
  return {
    canAct: b.canAct, month: p.month, line: lineRow(b, line), invoice: { id: inv.id, title: titleOf(inv), status: inv.status, created: inv.created },
    summary: invoiceSummary(line, caseLedger(c, db, b.env), inv.stored ? inv.id : null), overlaps,
  };
});

// ---------------------------------------------------------------- ekonomi.csv (reservvägen: export av underlaget)
handleQuery(ekoCsv, { roles: BILLING, commercial: true }, async (ctx, p) => {
  const b = await base(ctx);
  const db = await loadBilling(ctx, b.contract);
  const bm = monthInvoices(db, p.month, b.env);
  const csv = toCsv(bm.invoices.flatMap((inv) => inv.lines.map((l) => ({
    ...l, invoiceTitle: titleOf(inv), invoiceStatus: invoiceStatusLabel(inv.status), buyerReference: inv.buyerReference, purchaseOrderNumber: inv.purchaseOrderNumber,
    areaName: areaName(b.areas, l.areaCode), checkLabels: [...inv.checks, ...l.checks].map((ch) => ch.label), note: lineNote(db, inv, l, b.env),
  }))));
  return { filename: `fakturaunderlag-${p.month}.csv`, csv };
});

// ---------------------------------------------------------------- ekonomi.preview (eko.faktura)
handleQuery(ekoPreview, { roles: BILLING, commercial: true }, async (ctx, p) => {
  const b = await base(ctx);
  const db = await loadBilling(ctx, b.contract);
  const c = p.caseId ? (db.cases.find((x) => x.id === p.caseId) ?? null) : null;
  const month = p.month ?? currentRun(db)?.month ?? null;
  const none = { month, invoiceId: p.invoiceId ?? null, caseId: c?.id ?? p.caseId ?? null, caseNumber: c?.caseNumber ?? null, invoices: [], preview: null };
  if (!month) return none;
  const bm: BillingMonth = monthInvoices(db, month, b.env);
  const inv = p.invoiceId ? findInvoice(bm, p.invoiceId) : c ? invoiceOfCase(bm, c.id) : (bm.invoices.find((x) => !x.created) ?? bm.invoices[0] ?? null);
  const invoices = bm.invoices.map((x) => ({ id: x.id, title: titleOf(x), status: x.status }));
  if (!inv || !inv.lines.length) return { ...none, invoices };
  const [tasks, credits] = await Promise.all([ekonomTasks(ctx), ctx.repo.table("invoice_credits").list({ contractId: b.contract.id, month })]);
  const run = db.billing_runs.find((r) => r.month === month);
  const invoiceDate = dayOf(inv.created ? (inv.fortnoxCreatedAt ?? run?.createdAt ?? ctx.now()) : ctx.now());
  const gross = inv.amountOre + inv.vatOre;
  const grossRoundedOre = Math.round(gross / 100) * 100;
  const customerName = b.customer?.name ?? "";
  const short = customerName.replace(/ kommun$/, "");
  const domain = b.customer?.emailDomains[0];
  const allWeeks = inv.lines.flatMap((l) => l.weeks).sort((a, x) => (a.monday < x.monday ? -1 : 1));
  return {
    month, invoiceId: inv.id, caseId: c?.id ?? null, caseNumber: c?.caseNumber ?? null, invoices,
    preview: {
      inv: invoiceView(b, db, inv, tasks, credits), notes: Object.fromEntries(inv.lines.map((l) => [l.caseId, lineNote(db, inv, l, b.env)])),
      invoiceText: invoiceText({ contractNumber: b.contract.contractNumber, month, lines: inv.lines.length, weeks: inv.quantity, number: inv.number, perContract: b.perContract }),
      invoiceDate, dueDate: addDays(invoiceDate, b.cfg.billing.paymentTermsDays), paymentTermsDays: b.cfg.billing.paymentTermsDays, roundingOre: grossRoundedOre - gross,
      grossRoundedOre, period: periodOf(allWeeks), refLen: refLenText(b.cfg.billing), poText: poText(b.cfg.billing),
      supplier: { name: b.supplier?.name ?? "", orgNr: b.supplier?.orgNr ?? "", vatNo: `SE${String(b.supplier?.orgNr ?? "").replace(/\D/g, "")}01` },
      customer: { name: customerName, orgNr: b.customer?.orgNr ?? "", possessive: `${short}s`, eInvoiceContact: domain ? `${short}s e-handel (e-handel@${domain})` : `${short}s e-handel` },
      contractNumber: b.contract.contractNumber, dnr: b.contract.dnr,
    },
  };
});

// ---------------------------------------------------------------- ekonomi.case (eko.arende)
handleQuery(ekoCase, { roles: BILLING, commercial: true }, async (ctx, p) => {
  const b = await base(ctx);
  const db = await loadBilling(ctx, b.contract);
  const c = db.cases.find((x) => x.id === p.caseId);
  if (!c) return null;
  const today = dayOf(ctx.now());
  const weeks = billableWeeks(c, db, b.env);
  const priceDate = c.startDate || today;
  const price = priceFor(db.price_items, c.primaryAreaCode, priceDate, c.contractId);
  const item = priceItem(db.price_items, c.primaryAreaCode, priceDate, c.contractId);
  const led = caseLedger(c, db, b.env);
  const curMk = monthKey(today);
  const runMonths = new Set(db.billing_runs.map((r) => r.month));
  // Fakturorna räknas för hela avtalet (fakturans status och kontroller gäller hela fakturan) – en gång per månad.
  const monthOfInvoices = monthCache(db, b.env);
  const months: CaseMonthRow[] = [...new Set(weeks.map((w) => w.monthKey))].sort().flatMap((mk) => {
    const paused = weeks.filter((w) => w.monthKey === mk && w.paused);
    const rows = led.filter((x) => x.mk === mk);
    if (!rows.length) return [{ mk, bill: [], paused, qty: 0, amountOre: 0, status: mk >= curMk ? "open" : null, invoiceId: null, invoiceTitle: null, invoiceNo: null }];
    const bmk = runMonths.has(mk) ? monthOfInvoices(mk) : null;
    return rows.map((l, i): CaseMonthRow => {
      // Raden kan vara delad: veckor på en skapad faktura och veckor på den öppna (tilläggsfakturan).
      const showInv = bmk ? (l.invoiceId ? (bmk.invoices.find((x) => x.id === l.invoiceId) ?? null) : invoiceOfCase(bmk, c.id)) : null;
      return {
        mk, bill: l.weeks, paused: i === 0 ? paused : [], qty: l.qty, amountOre: l.amountOre,
        status: showInv ? showInv.status : mk >= curMk ? "open" : null, invoiceId: showInv?.id ?? null, invoiceTitle: showInv ? titleOf(showInv) : null,
        invoiceNo: showInv ? (showInv.fortnoxNo || showInv.manualInvoiceNo) : null,
      };
    });
  });
  const qa = (t: { qty: number; amountOre: number }) => ({ qty: t.qty, amountOre: t.amountOre });
  return {
    canAct: b.canAct, caseId: c.id, caseNumber: c.caseNumber, name: "–", areaName: areaName(b.areas, c.primaryAreaCode), articleNo: item?.fortnoxArticleNo || "–",
    priceOre: price, status: c.status, startDate: c.startDate, endDate: c.endDate, plannedEnd: c.plannedEnd, pausedWeeks: c.pausedWeeks, caseBuyerReference: c.buyerReference,
    referredAt: c.referredAt, referrerId: c.referrerId, orderWeeks: c.orderValueWeeks || c.plannedWeeks || 0, accrued: qa(tally(led)),
    billed: qa(tally(led.filter((x) => x.kind === "billed"))), returned: qa(tally(led.filter((x) => x.kind === "returned"))),
    pending: qa(tally(led.filter((x) => x.kind === "unbilled"))), months, weeks, thisMonday: monday(today),
  };
});

// ---------------------------------------------------------------- ekonomi.caseList (sök ärende)
handleQuery(ekoCaseList, { roles: BILLING, commercial: true }, async (ctx) => {
  const b = await base(ctx);
  const cases = await ctx.repo.table("cases").list({ contractId: b.contract.id });
  return {
    canAct: b.canAct,
    cases: cases
      .filter((c) => c.startDate)
      .sort((a, x) => (a.caseNumber < x.caseNumber ? 1 : a.caseNumber > x.caseNumber ? -1 : 0))
      .map((c) => ({ caseId: c.id, caseNumber: c.caseNumber, areaName: areaName(b.areas, c.primaryAreaCode), startDate: c.startDate, status: c.status })),
  };
});

// ---------------------------------------------------------------- ekonomi.priceList (prislistan, beslut 5)
const UNIT_TEXT: Record<string, string> = { participant_week: "Pris per deltagare och vecka" };
handleQuery(ekoPriceList, { roles: BILLING, commercial: true }, async (ctx) => {
  const b = await base(ctx);
  const items = await ctx.repo.table("price_items").list({ contractId: b.contract.id });
  return {
    customerName: b.customer?.name ?? "",
    contractNumber: b.contract.contractNumber,
    unitText: UNIT_TEXT[b.cfg.billing.unit] ?? b.cfg.billing.unit,
    items: items
      .slice()
      .sort(by((p) => `${p.areaCode ?? ""}:${p.validFrom}`))
      .map((p) => ({ id: p.id, areaName: areaName(b.areas, p.areaCode), fortnoxArticleNo: p.fortnoxArticleNo, unit: p.unit, priceOre: p.priceOre, vatRate: p.vatRate, validFrom: p.validFrom, validTo: p.validTo })),
  };
});

// ---------------------------------------------------------------- ekonomi.start (eko.start)
handleQuery(ekoStart, { roles: BILLING, commercial: true }, async (ctx) => {
  const b = await base(ctx);
  const db = await loadBilling(ctx, b.contract);
  const today = dayOf(ctx.now());
  const runs = runsSorted(db);
  const cur = currentRun(db);
  const billingOf = new Map(runs.map((r) => [r.month, monthInvoices(db, r.month, b.env)]));
  const bm = cur ? billingOf.get(cur.month)! : null;
  const [tasks, credits] = await Promise.all([ekonomTasks(ctx), ctx.repo.table("invoice_credits").list({ contractId: b.contract.id })]);

  // Veckor utan närvaro i öppna körningar (på fakturor som inte är skapade)
  const zero: ZeroRow[] = runs.filter((r) => r.status === "draft").flatMap((r) =>
    billingOf.get(r.month)!.invoices.filter((inv) => !inv.created).flatMap((inv) =>
      inv.lines.flatMap((l) =>
        l.checks.filter((ch) => ch.kind === "zero_week").map((ch) => ({
          id: `${r.month}:${l.caseId}:${ch.weekKey}`, month: r.month, caseId: l.caseId, caseNumber: l.caseNumber, weekKey: ch.weekKey ?? "",
          planned: l.weeks.find((w) => w.key === ch.weekKey)?.planned ?? null, approved: ch.severity === "approved",
        })))));

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

  // Returnerade fakturor (och de som krediterats och gjorts om)
  const all = runs.flatMap((r) => billingOf.get(r.month)!.invoices);
  const returned: ReturnedRow[] = all
    .filter((inv) => inv.storedStatus === "returned" || credits.some((x) => x.invoiceDraftId === inv.id))
    .map((inv) => ({
      invoiceId: inv.id, month: inv.month, title: titleOf(inv), status: inv.status, lines: inv.lines.length, quantity: inv.quantity, amountOre: inv.amountOre,
      caseNumbers: inv.lines.map((l) => l.caseNumber), buyerReference: inv.buyerReference, refOk: refInfo(inv.buyerReference, b.refRules).ok, credit: creditOf(credits, inv),
    }));

  // Fakturor som inte kan skapas: beställarreferensen saknas eller är fel (öppna körningar och returnerade fakturor)
  const openMonths = new Set(runs.filter((r) => r.status === "draft").map((r) => r.month));
  const refInvoices: RefInvoiceRow[] = all
    .filter((inv) => (openMonths.has(inv.month) && !inv.created) || inv.storedStatus === "returned")
    .filter((inv) => inv.checks.some((ch) => ch.kind === "buyer_ref"))
    .map((inv) => ({
      invoiceId: inv.id, month: inv.month, title: titleOf(inv), status: inv.status, buyerReference: inv.buyerReference, lines: inv.lines.length,
      problem: noteText(inv.checks.find((ch) => ch.kind === "buyer_ref")?.text),
    }));
  const refSuggestionsBy = Object.fromEntries(all.filter((inv) => refInvoices.some((x) => x.invoiceId === inv.id)).map((inv) => [inv.id, refSuggestions(b, db, inv, tasks)]));

  // Uppgifter till ekonomen: öppna först, sedan nyast först
  const caseById = new Map(db.cases.map((c) => [c.id, c]));
  const sortedTasks = tasks.slice().sort((a, x) => (a.status === x.status ? (a.createdAt < x.createdAt ? 1 : -1) : a.status === "open" ? -1 : 1));
  const taskViews: TaskView[] = sortedTasks.map((t) => ({
    ...taskRef(b, t), status: t.status, doneAt: t.doneAt, doneByName: t.doneBy ? personName(b.profiles, t.doneBy) : null,
    cases: t.caseIds.map((id) => caseById.get(id)).filter((c): c is Case => !!c).map((c) => ({ caseId: c.id, caseNumber: c.caseNumber })),
  }));

  const runRows: RunRow[] = runs.map((r) => {
    const bb = billingOf.get(r.month)!;
    const entries = Object.entries(groupBy(bb.invoices, (x) => x.status)).map(([s, xs]) => [s as InvoiceDisplayStatus, xs.length] as [InvoiceDisplayStatus, number]);
    entries.sort((a, x) => x[1] - a[1]);
    return {
      id: r.id, month: r.month, status: r.status, invoices: bb.invoices.length, count: bb.count, weeks: bb.weeks, totalOre: bb.totalOre, entries,
      todo: bb.invoices.filter((x) => bucketOf(x) !== "ready").length,
    };
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
    const stepNow = !bm.invoices.length ? 0 : buckets.some((x) => x !== "ready") ? 1 : bm.invoices.some((x) => x.storedStatus === "approved") ? 2
      : bm.invoices.some((x) => x.storedStatus === "fortnox_created" || x.storedStatus === "booked") ? 3 : 4;
    current = {
      month: cur.month, status: cur.status, totalOre: bm.totalOre, invoices: bm.invoices.length, count: bm.count, weeks: bm.weeks, blocked: bm.blocked, due,
      dueRelative: cap(relative(due, ctx.now())), fortnoxDays: days, stepNow, perContract: b.perContract,
      counts: {
        blocked: buckets.filter((x) => x === "blocked").length, zeroPending: zero.filter((z) => z.month === cur.month && !z.approved).length,
        review: buckets.filter((x) => x === "review").length, ready: buckets.filter((x) => x === "ready").length,
      },
    };
  }

  return {
    canAct: b.canAct, customerName: b.customer?.name ?? "", current, openTasks: tasks.filter((t) => t.status === "open").length,
    unbilled: { totalOre: sum(ub, (x) => x.amountOre), count: ub.length, limit: b.cfg.billing.unbilledWarningDays, prescText: prescText(b.cfg.billing), rows: ubRows },
    tasks: taskViews, returned, refInvoices, zero, runs: runRows,
    fortnox: {
      connected: !fortnoxOff(ctx),
      lastRun: lastRun ? { at: lastRun.ranAt, created: lastRun.created, skipped: lastRun.skipped } : null, lastSync: lastSync ? { at: lastSync.ranAt, changed: lastSync.changed } : null,
    },
    priceSpan: priceSpan(db.price_items, today), refRules: b.refRules, refSuggestions: refSuggestionsBy,
  };
});
