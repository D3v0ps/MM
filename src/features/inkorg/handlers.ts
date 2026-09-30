// Hanterare för området inkorg (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand } from "@/api/server";
import type { Case, InboundEmail, OrderField } from "@/data/schema";
import { canEditCase } from "../_shared/context";
import { emailApplySupplement, emailSetStatus } from "./api";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

const INBOX_ROLES: readonly Role[] = ["samordnare", "avtalsansvarig"];
const EMAIL_NOT_FOUND = "Mejlet finns inte, eller så har du inte behörighet att se det.";

// ---------------------------------------------------------------- email.setStatus
handleCommand(emailSetStatus, { roles: INBOX_ROLES }, async (ctx, p) => {
  const e = await ctx.repo.table("inbound_emails").get(p.emailId);
  if (!e) return fail("not_found", EMAIL_NOT_FOUND);
  const linkedId = p.caseId ?? e.caseId;
  const c = linkedId ? await ctx.repo.table("cases").get(linkedId) : null;
  if (p.caseId && !c) return fail("not_found", "Ärendet finns inte, eller så har du inte behörighet att se det.");
  const patch: Partial<InboundEmail> = { status: p.status, handledBy: ctx.actor.userId, handledAt: ctx.now() };
  if (p.caseId) patch.caseId = p.caseId;
  await ctx.repo.table("inbound_emails").update(e.id, patch);
  await ctx.audit({ action: "email.handled", entity: "inbound_email", entityId: e.id, contractId: c?.contractId ?? ctx.actor.contractIds[0] ?? null, details: { status: p.status } });
  return ok({});
});

// ---------------------------------------------------------------- email.applySupplement
handleCommand(emailApplySupplement, { roles: INBOX_ROLES }, async (ctx, p) => {
  const e = await ctx.repo.table("inbound_emails").get(p.emailId);
  if (!e) return fail("not_found", EMAIL_NOT_FOUND);
  const c = e.caseId ? await ctx.repo.table("cases").get(e.caseId) : null;
  if (!c || !(await canEditCase(ctx, c))) return fail("not_found", "Mejlet är inte kopplat till ett ärende som du kan ändra.");
  const fields = Object.keys(e.extracted) as OrderField[];
  const patch: Partial<Case> = {};
  if (e.extracted.buyerReference) patch.buyerReference = e.extracted.buyerReference;
  if (e.extracted.plannedEnd) patch.plannedEnd = e.extracted.plannedEnd;
  if (Object.keys(patch).length) await ctx.repo.table("cases").update(c.id, patch);
  // Det ursprungliga avropsmejlet: uppgifterna finns nu och saknas inte längre.
  const orig = await ctx.repo.table("inbound_emails").first({ caseId: c.id, classification: "order" });
  if (orig) {
    await ctx.repo.table("inbound_emails").update(orig.id, { missingFields: orig.missingFields.filter((f) => !fields.includes(f)), extracted: { ...orig.extracted, ...e.extracted } });
  }
  await ctx.repo.table("inbound_emails").update(e.id, { status: "applied", handledBy: ctx.actor.userId, handledAt: ctx.now() });
  await ctx.audit({ action: "email.supplement_applied", entity: "case", entityId: c.id, contractId: c.contractId, details: { fields } });
  return ok({ fields });
});
