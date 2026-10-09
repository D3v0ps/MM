// Hanterare för området inkorg (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand, handleQuery } from "@/api/server";
import { duplicateActive } from "@/core/cases";
import { uniq } from "@/core/util";
import { buyerRefError, buyerRefValid } from "@/core/validation";
import type { Case, FieldCorrection, InboundEmail, OrderExtract, OrderField } from "@/data/schema";
import { canEditCase, contractOf } from "../_shared/context";
import { pnrSearchHash } from "../_shared/pnr";
import {
  emailApplySupplement, emailSetStatus, inboxConfirmation, inboxCorrect, inboxDeadlines, inboxDecisionForm, inboxDuplicateCheck, inboxItem,
  inboxList, inboxRevealPnr, inboxStart, inboxTaskDone, type OrderFieldKey,
} from "./api";
import { casePeriodValue, plainPnr } from "./model";
import { buildConfirmation, buildDeadlines, buildDecisionForm, buildItem, buildList, buildStart } from "./views";
// Registrera beställning (beslut 4a, 2026-10-08): inkorg.registerForm och inkorg.register.
import "./register-handlers";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

const INBOX_ROLES: readonly Role[] = ["samordnare", "avtalsansvarig"];
const EMAIL_NOT_FOUND = "Mejlet finns inte, eller så har du inte behörighet att se det.";
const CASE_NOT_FOUND = "Ärendet finns inte, eller så har du inte behörighet att se det.";

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
/**
 * För in en komplettering (svar med ärendenummer) i ärendet: beställarreferens, omfattning, slutdatum, motivering och – medan
 * beställningen väntar på beslut – yrkesområdet. Bara fälten som faktiskt förs in räknas som införda: de loggas, lämnas i svaret
 * och tas bort ur originalmejlets saknade uppgifter (CLAUDE.md punkt 3 – loggen visar aldrig en ändring som inte gjordes).
 * Övriga uppgifter i svaret (till exempel deltagarens telefonnummer) förs inte in och visas inte som införda.
 */
handleCommand(emailApplySupplement, { roles: INBOX_ROLES }, async (ctx, p) => {
  const e = await ctx.repo.table("inbound_emails").get(p.emailId);
  if (!e) return fail("not_found", EMAIL_NOT_FOUND);
  const c = e.caseId ? await ctx.repo.table("cases").get(e.caseId) : null;
  if (!c || !(await canEditCase(ctx, c))) return fail("not_found", "Mejlet är inte kopplat till ett ärende som du kan ändra.");
  const patch: Partial<Case> = {};
  const applied = new Set<OrderField>();
  if (e.extracted.buyerReference) {
    patch.buyerReference = e.extracted.buyerReference;
    applied.add("buyerReference");
  }
  if (e.extracted.plannedEnd) {
    patch.plannedEnd = e.extracted.plannedEnd;
    applied.add("plannedEnd");
  }
  // Omfattningen (beslut 2026-10-07): månader ur avtalet eller annan tidsperiod med motivering. Slutdatumet räknas vid accept.
  const period = periodFrom(e.extracted.orderPeriod);
  if (period.kind === "months") Object.assign(patch, { orderPeriodMonths: period.months, orderPeriodReason: null });
  if (period.kind === "other") patch.orderPeriodMonths = null;
  if (period.kind !== "none") applied.add("orderPeriod");
  if (e.extracted.orderPeriodReason) {
    patch.orderPeriodReason = e.extracted.orderPeriodReason;
    applied.add("orderPeriodReason");
  }
  // Yrkesområdet (beslut 2026-10-09): förs in medan beställningen väntar på beslut – sedan är avtalsområdet valt vid accept.
  const area = e.extracted.primaryArea;
  if (area && (c.status === "received" || c.status === "acknowledged") && (await ctx.repo.table("contract_areas").first({ contractId: c.contractId, code: area, active: true }))) {
    patch.primaryAreaCode = area as Case["primaryAreaCode"];
    applied.add("primaryArea");
  }
  // Fälten i mejlets ordning, bara de införda.
  const fields = (Object.keys(e.extracted) as OrderField[]).filter((k) => applied.has(k));
  if (Object.keys(patch).length) await ctx.repo.table("cases").update(c.id, patch);
  // Det ursprungliga avropsmejlet: de införda uppgifterna finns nu och saknas inte längre.
  const orig = await ctx.repo.table("inbound_emails").first({ caseId: c.id, classification: "order" });
  if (orig && fields.length) {
    const added = Object.fromEntries(fields.map((k) => [k, e.extracted[k]])) as OrderExtract;
    await ctx.repo.table("inbound_emails").update(orig.id, { missingFields: orig.missingFields.filter((f) => !fields.includes(f)), extracted: { ...orig.extracted, ...added } });
  }
  await ctx.repo.table("inbound_emails").update(e.id, { status: "applied", handledBy: ctx.actor.userId, handledAt: ctx.now() });
  await ctx.audit({ action: "email.supplement_applied", entity: "case", entityId: c.id, contractId: c.contractId, details: { fields } });
  return ok({ fields });
});

// ---- Området inkorg: startsidan, avropsinkorgen och förfaller

const DEADLINE_ROLES: readonly Role[] = ["samordnare", "avtalsansvarig", "chef"];

handleQuery(inboxList, { roles: INBOX_ROLES }, (ctx) => buildList(ctx));
handleQuery(inboxItem, { roles: INBOX_ROLES }, (ctx, p) => buildItem(ctx, p.id));
handleQuery(inboxConfirmation, { roles: INBOX_ROLES }, (ctx, p) => buildConfirmation(ctx, p.caseId));
handleQuery(inboxDecisionForm, { roles: INBOX_ROLES }, (ctx, p) => buildDecisionForm(ctx, p.caseId));
handleQuery(inboxStart, { roles: INBOX_ROLES }, (ctx) => buildStart(ctx));
handleQuery(inboxDeadlines, { roles: DEADLINE_ROLES }, (ctx) => buildDeadlines(ctx));

// ---------------------------------------------------------------- Dubblettkontroll i registreringen
handleQuery(inboxDuplicateCheck, { roles: INBOX_ROLES }, async (ctx, p) => {
  const hash = pnrSearchHash(ctx.crypto, p.pnr);
  if (!hash) return { duplicate: false };
  // ctx.system: dubblettkontrollen ska se alla pågående ärenden i användarens avtal, även sådana användaren inte får se
  // (samma kontroll som när beställningen sparas). Bara sökhashen jämförs och svaret är ja eller nej.
  const persons = await ctx.system.table("persons").list({ personnummerHash: hash });
  if (!persons.length) return { duplicate: false };
  const cases = await ctx.system.table("cases").list({ personId: { in: persons.map((x) => x.id) }, contractId: { in: ctx.actor.contractIds } });
  return { duplicate: duplicateActive({ persons, cases }, hash).length > 0 };
});

// ---------------------------------------------------------------- ink.correct
const CORRECT_FIELD: Record<Exclude<OrderFieldKey, "orderPeriod">, keyof Case> = {
  buyerReference: "buyerReference", desiredStart: "desiredStart", plannedEnd: "plannedEnd", orderPeriodReason: "orderPeriodReason",
};
/** Omfattningen i mejlet eller rättelsen: "6"/"12" = månader, "annan" = annan tidsperiod, annars inte angiven. */
function periodFrom(v: unknown): { kind: "months"; months: number } | { kind: "other" } | { kind: "none" } {
  const s = String(v ?? "").trim();
  if (s === "annan") return { kind: "other" };
  const n = Number(s);
  return s && Number.isInteger(n) && n > 0 ? { kind: "months", months: n } : { kind: "none" };
}

handleCommand(inboxCorrect, { roles: INBOX_ROLES }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", CASE_NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", "Du har inte behörighet att ändra i ärendet.");
  const { cfg } = await contractOf(ctx, c.contractId);
  const patch = p.patch as Partial<Record<OrderFieldKey, string | number | null>>;
  if (patch.buyerReference && !buyerRefValid(String(patch.buyerReference), cfg)) {
    return fail("buyer_ref", buyerRefError(String(patch.buyerReference), cfg) ?? "Beställarreferensen har fel format.");
  }
  const period = periodFrom(patch.orderPeriod);
  if (period.kind === "months" && !cfg.orderPeriods.months.includes(period.months)) return fail("order_period", "Välj en av omfattningarna i avtalet.");
  if (period.kind === "other" && !cfg.orderPeriods.allowOther) return fail("order_period", "Avtalet tillåter bara omfattningarna i avtalet.");
  const e = p.emailId ? await ctx.repo.table("inbound_emails").get(p.emailId) : null;
  const now = ctx.now();
  const changed: OrderFieldKey[] = [];
  const casePatch: Partial<Case> = {};
  const extracted = e ? ({ ...e.extracted } as Record<string, unknown>) : {};
  const confidence = e ? { ...e.confidence } : {};
  const corrections = e ? { ...e.corrections } : {};
  let missingFields = e ? [...e.missingFields] : [];
  const str = (v: unknown) => (v == null ? "" : String(v));
  for (const k of uniq([...(Object.keys(patch) as OrderFieldKey[]), ...p.checked])) {
    const has = Object.prototype.hasOwnProperty.call(patch, k);
    let v: string | number | null;
    let isChange: boolean;
    if (k === "orderPeriod") {
      // Omfattningen sparas som månader (orderPeriodMonths); "annan" = inga månader (slutdatum och motivering i egna fält).
      const cur = casePeriodValue(c);
      v = has ? (patch[k] ?? "") : cur;
      isChange = has && cur !== str(v);
      if (isChange) {
        const next = periodFrom(v);
        casePatch.orderPeriodMonths = next.kind === "months" ? next.months : null;
        if (next.kind === "months") casePatch.orderPeriodReason = null;
        changed.push(k);
      }
    } else {
      const field = CORRECT_FIELD[k];
      v = has ? (patch[k] ?? null) : (c[field] as string | number | null);
      isChange = has && str(c[field]) !== str(v);
      if (isChange) {
        (casePatch as Record<string, unknown>)[field] = v === "" ? null : v;
        changed.push(k);
      }
    }
    if (e) {
      const prevEx = extracted[k];
      if (isChange || prevEx == null || prevEx === "") extracted[k] = v == null ? "" : v;
      (confidence as Record<string, number>)[k] = 1;
      (corrections as Record<string, FieldCorrection>)[k] = { by: ctx.actor.userId, at: now, changed: isChange || str(prevEx) !== str(v), from: (prevEx ?? "") as FieldCorrection["from"] };
      if (v != null && v !== "") missingFields = missingFields.filter((f) => f !== k);
    }
  }
  if (Object.keys(casePatch).length) await ctx.repo.table("cases").update(c.id, casePatch);
  if (e) await ctx.repo.table("inbound_emails").update(e.id, { extracted: extracted as OrderExtract, confidence, corrections, missingFields });
  await ctx.audit({ action: "case.order_details_corrected", entity: "case", entityId: c.id, contractId: c.contractId, details: { fields: changed, checked: p.checked, emailId: p.emailId ?? null } });
  return ok({ changed });
});

// ---------------------------------------------------------------- ink.taskDone
handleCommand(inboxTaskDone, { roles: INBOX_ROLES }, async (ctx, p) => {
  const t = await ctx.repo.table("tasks").get(p.taskId);
  if (!t) return fail("not_found", "Uppgiften finns inte, eller så har du inte behörighet att se den.");
  await ctx.repo.table("tasks").update(t.id, { status: "done", doneBy: ctx.actor.userId, doneAt: ctx.now() });
  await ctx.audit({ action: "task.done", entity: "task", entityId: t.id, contractId: ctx.actor.contractIds[0] ?? null, details: {} });
  return ok({});
});

// ---------------------------------------------------------------- Visa personnummer (tyst, loggas)
handleCommand(inboxRevealPnr, { roles: INBOX_ROLES, silent: true }, async (ctx, p) => {
  if (p.emailId) {
    const e = await ctx.repo.table("inbound_emails").get(p.emailId);
    if (!e) return fail("not_found", EMAIL_NOT_FOUND);
    const c = e.caseId ? await ctx.repo.table("cases").get(e.caseId) : null;
    // Som prototypen: bara med full åtkomst till ärendet (personen syns), eller när mejlet inte hör till något ärende.
    if (c && !(await ctx.repo.table("persons").get(c.personId))) return fail("forbidden", "Personnumret visas inte för din roll.");
    await ctx.audit({ action: "pnr.revealed", entity: "inbound_email", entityId: e.id, contractId: c?.contractId ?? ctx.actor.contractIds[0] ?? null, details: { caseId: c?.id ?? null } });
    return ok({ text: e.bodyText });
  }
  if (!p.caseId) return fail("not_found", CASE_NOT_FOUND);
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", CASE_NOT_FOUND);
  const person = await ctx.repo.table("persons").get(c.personId);
  if (!person) return fail("forbidden", "Personnumret visas inte för din roll.");
  await ctx.audit({ action: "pnr.revealed", entity: "person", entityId: person.id, contractId: c.contractId, details: { caseId: c.id } });
  return ok({ text: plainPnr(ctx.crypto, person) });
});
