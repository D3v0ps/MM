// Hanterare för området ekonomi (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand, type Ctx } from "@/api/server";
import { BILLED_STATUSES, buyerRefProblem, invoiceStatus } from "@/core/billing";
import type { Case, InvoiceDraft } from "@/data/schema";
import { contractOf, upsert } from "../_shared/context";
import { invoiceDraftId, newInvoiceDraft } from "../_shared/rows";
import { billingApproveInvoice, billingApproveZeroWeek, billingExport, billingMarkManual, billingSendFortnox } from "./api";

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
