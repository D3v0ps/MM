// Skapa en beställning (person + ärende + ordererkännande) – gemensam logik för tre vägar (beslut 4, 2026-10-08):
//   portalen           arenden.caseCreate (kommunens handläggare, ./handlers.ts)
//   registrering       inkorg.register (samordnare/avtalsansvarig efter mejl, telefon eller annan väg)
//   mejlinläsningen    jobbet inbox_import (src/server/inbox/import.ts, systemaktören) när avropet går att tolka
// Registrerar inga hanterare – kan importeras av alla områden och av servern. Deterministisk: tid via ctx.now(), id via ctx.newId().
// Personnummer krypteras via ctx.crypto innan det sparas (CLAUDE.md punkt 2) och lämnas aldrig tillbaka.
import type { Ctx } from "@/api/server";
import { ackTextFor, caseCounterId, duplicateActive, nextCaseNumber } from "@/core/cases";
import { requireOperational, type OperationalConfig } from "@/core/config";
import { billableWeekCount, orderPeriodEnd, type LocalDate } from "@/core/time";
import { buyerRefError, buyerRefValid, poNumberError } from "@/core/validation";
import type { Case, CaseSource, CaseStatus, CaseStatusHistory, Contract, OrderField, Person, PreferredContact, PriorAssessment } from "@/data/schema";
import { requireAttachments } from "../_shared/attachment-port";
import { referrerEmail } from "../_shared/context";
import { protectPnr } from "../_shared/pnr";
import { MAX_ORDER_WEEKS, ORDER_REASON_MIN } from "./api";

/** Ärenden som väntar på svar eller pågår – en person kan bara ha ett sådant (dubblettkontroll). */
export const OPEN_CASE_STATUSES: readonly CaseStatus[] = ["received", "acknowledged", "confirmed", "active", "paused"];

/** Kanalen i klarspråk (statushistoriken och deltagarkortet). */
export const SOURCE_TEXT: Record<CaseSource, string> = { portal: "portalen", email: "mejl", phone: "telefon", other: "annan väg" };

/** Etiketterna i ordererkännandet när uppgifter saknas (samma ord som avropsinkorgen, gemener). */
const MISSING_LABEL: Partial<Record<OrderField, string>> = {
  desiredStart: "önskat startdatum", orderPeriod: "omfattningen (6 eller 12 månader, eller annan tidsperiod med motivering)", firstName: "deltagarens förnamn",
  lastName: "deltagarens efternamn", pnr: "deltagarens personnummer", phone: "deltagarens telefonnummer", city: "deltagarens bostadsort", plannedEnd: "slutdatum",
  orderPeriodReason: "motivering till annan tidsperiod", buyerReference: "beställarreferens",
};

/** "a, b och c" */
const joinSv = (xs: readonly string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} och ${xs[xs.length - 1]}`);

/**
 * Ordererkännandets text (SPEC §7.1): ärendenummer och när besked kommer; saknas uppgifter i avropet listas de i samma svar
 * ("Vi saknar …, svara på det här mejlet"). Aldrig personuppgifter.
 */
export function orderAckText(c: Pick<Case, "caseNumber" | "referredAt">, cfg: Pick<OperationalConfig, "sla">, missing: readonly OrderField[] = []): string {
  const base = ackTextFor(c, cfg);
  const labels = missing.map((k) => MISSING_LABEL[k]).filter((x): x is string => !!x);
  return labels.length ? `${base} Vi saknar ${joinSv(labels)} – svara på det här mejlet med uppgifterna.` : base;
}

// ---------------------------------------------------------------- Omfattningen
/**
 * Omfattningen i en beställning (beslut 2026-10-07): ett av avtalets alternativ i månader (planerat slut räknas fram från
 * startdatumet) eller "Annan tidsperiod" med slutdatum och motivering. null = ingen omfattning angiven.
 */
export type OrderPeriod = { orderPeriodMonths: number | null; orderPeriodReason: string | null; plannedEnd: LocalDate; plannedWeeks: number };
export function orderPeriodFrom(
  cfg: OperationalConfig, start: LocalDate | null | undefined,
  p: { orderPeriodMonths?: number | null; plannedEnd?: LocalDate | null; orderPeriodReason?: string | null },
): { ok: true; value: OrderPeriod | null } | { ok: false; message: string } {
  if (p.orderPeriodMonths != null) {
    if (!cfg.orderPeriods.months.includes(p.orderPeriodMonths)) return { ok: false, message: "Välj en av omfattningarna i avtalet." };
    if (!start) return { ok: false, message: "Välj ett önskat startdatum. Slutdatumet räknas fram från det." };
    const plannedEnd = orderPeriodEnd(start, p.orderPeriodMonths);
    return { ok: true, value: { orderPeriodMonths: p.orderPeriodMonths, orderPeriodReason: null, plannedEnd, plannedWeeks: billableWeekCount(start, plannedEnd) } };
  }
  if (p.plannedEnd) {
    if (!cfg.orderPeriods.allowOther) return { ok: false, message: "Välj en av omfattningarna i avtalet." };
    const reason = (p.orderPeriodReason ?? "").trim();
    if (reason.length < ORDER_REASON_MIN) return { ok: false, message: "Skriv varför insatsen behöver en annan längd." };
    if (!start) return { ok: false, message: "Välj ett önskat startdatum." };
    if (p.plannedEnd <= start) return { ok: false, message: "Slutdatumet måste komma efter startdatumet." };
    const plannedWeeks = billableWeekCount(start, p.plannedEnd);
    if (plannedWeeks > MAX_ORDER_WEEKS) return { ok: false, message: "Perioden är för lång. Kontakta Miljonbemanning." };
    return { ok: true, value: { orderPeriodMonths: null, orderPeriodReason: reason, plannedEnd: p.plannedEnd, plannedWeeks } };
  }
  return { ok: true, value: null };
}

// ---------------------------------------------------------------- Statushistorik
/** Statushistorik för ärendet (en rad per status- eller coachbyte). Skrivs via ctx.repo (systemaktören: utan filter). */
export async function addCaseHistory(ctx: Ctx, h: Pick<CaseStatusHistory, "caseId" | "fromStatus" | "toStatus" | "reason"> & Partial<CaseStatusHistory>): Promise<void> {
  await ctx.repo.table("case_status_history").insert({
    id: ctx.newId("csh"), fromCoach: null, toCoach: null, customerNotifiedAt: null, changedBy: ctx.actor.userId, changedAt: ctx.now(), ...h,
  });
}

// ---------------------------------------------------------------- Skapa beställningen
export type CreateOrderInput = {
  contract: Contract;
  source: CaseSource;
  /** Beställande handläggare med konto, annars null med uppgifterna nedan på ärendet. */
  referrerId: string | null;
  referrerName?: string | null;
  referrerUnit?: string | null;
  referrerPhone?: string | null;
  referrerEmail?: string | null;
  firstName: string;
  lastName: string;
  pnr?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  address?: string | null;
  preferredContact?: PreferredContact | null;
  language?: string | null;
  needsInterpreter?: boolean;
  /** Bara Miljonbemanning – kommunens formulär skickar ingen referens, inget avtalsområde och inget yrkesspår. */
  buyerReference?: string | null;
  purchaseOrderNumber?: string | null;
  primaryArea?: string | null;
  secondaryArea?: string | null;
  vocationalTrack?: string | null;
  desiredStart?: LocalDate | null;
  orderPeriodMonths?: number | null;
  plannedEnd?: LocalDate | null;
  orderPeriodReason?: string | null;
  priorAssessment?: PriorAssessment | null;
  background?: string | null;
  /** Bilagor (case_attachments) som redan är kontrollerade av anroparen – kopplas till ärendet. */
  attachmentIds?: readonly string[];
  /** Mejlet beställningen kom med (inbound_emails.id) – telefon/mejl registrerat av Miljonbemanning eller inläst avrop. */
  sourceEmailId?: string | null;
  /** Uppgifter som saknas i avropet – listas i ordererkännandet. */
  missingFields?: readonly OrderField[];
  /** Mottagningstiden (registrering i efterhand, eller mejlets tid). Standard: nu. */
  referredAt?: string | null;
};

export type CreateOrderResult =
  | { ok: true; caseId: string; caseNumber: string; personId: string }
  | { ok: false; error: "buyer_ref" | "po_number" | "duplicate" | "order_period"; message: string };

/**
 * Skapa person, ärende och ordererkännande. Anroparen har redan kontrollerat behörighet, avtal, handläggare och bilagor.
 * Dubblettkontrollen (ctx.system: alla pågående ärenden i avtalet, bara sökhashen jämförs) stoppar en andra pågående insats.
 */
export async function createOrder(ctx: Ctx, p: CreateOrderInput): Promise<CreateOrderResult> {
  const contract = p.contract;
  const cfg = requireOperational(contract.config);
  const buyerReference = (p.buyerReference ?? "").trim();
  if (buyerReference && !buyerRefValid(buyerReference, cfg)) return { ok: false, error: "buyer_ref", message: buyerRefError(buyerReference, cfg) ?? "Beställarreferensen har fel format." };
  const po = (p.purchaseOrderNumber ?? "").trim();
  const poErr = poNumberError(po, cfg);
  if (poErr) return { ok: false, error: "po_number", message: poErr };
  const period = orderPeriodFrom(cfg, p.desiredStart, p);
  if (!period.ok) return { ok: false, error: "order_period", message: period.message };

  const pnr = protectPnr(ctx.crypto, p.pnr);
  if (pnr.personnummerHash) {
    // ctx.system: dubblettkontrollen ska se alla pågående ärenden i avtalet, även sådana användaren inte får se.
    // Bara sökhashen jämförs och svaret är ja eller nej – inga uppgifter om det andra ärendet lämnas ut.
    const same = await ctx.system.table("persons").list({ personnummerHash: pnr.personnummerHash });
    if (same.length) {
      const cases = await ctx.system.table("cases").list({ personId: { in: same.map((x) => x.id) }, contractId: contract.id, status: { in: OPEN_CASE_STATUSES } });
      if (duplicateActive({ persons: same, cases }, pnr.personnummerHash).length) {
        return { ok: false, error: "duplicate", message: "Personen har redan en pågående insats. En person kan inte ha två pågående insatser samtidigt." };
      }
    }
  }

  const now = ctx.now();
  const referredAt = p.referredAt || now;
  const preferredContact = p.preferredContact ?? "sms";
  // Skyddade personuppgifter är borttaget ur appen (beslut 2026-10-07): alla deltagare hanteras lika (protectedIdentity false).
  const person: Person = {
    id: ctx.newId("p"), ...pnr, birthYear: null, firstName: p.firstName.trim(), lastName: p.lastName.trim(),
    phone: (p.phone ?? "").trim(), email: (p.email ?? "").trim(), city: (p.city ?? "").trim(),
    address: preferredContact === "letter" ? (p.address ?? "").trim() || null : null,
    preferredContact, protectedIdentity: false, accessibilityNeeds: "",
    language: p.language || "svenska", needsInterpreter: !!p.needsInterpreter,
  };
  await ctx.repo.table("persons").insert(person);

  // ctx.system: löpnumret per avtal och år är ett systemsteg (case_counters skrivs aldrig av användare). Numret återanvänds aldrig.
  const year = referredAt.slice(0, 4);
  const counterId = caseCounterId(contract.id, year);
  const counter = await ctx.system.table("case_counters").get(counterId);
  const { caseNumber, lastValue } = nextCaseNumber(counter, cfg, year);
  if (counter) await ctx.system.table("case_counters").update(counterId, { lastValue });
  else await ctx.system.table("case_counters").insert({ id: counterId, contractId: contract.id, year: Number(year), lastValue });

  const status: CaseStatus = "acknowledged";
  const pv = period.value;
  const trim = (v: string | null | undefined) => (v ?? "").trim() || null;
  const c: Case = {
    id: ctx.newId("case"), caseNumber, contractId: contract.id, personId: person.id, status, source: p.source, referredAt, referrerId: p.referrerId,
    referrerName: trim(p.referrerName), referrerUnit: trim(p.referrerUnit), referrerPhone: trim(p.referrerPhone), referrerEmail: trim(p.referrerEmail)?.toLowerCase() ?? null,
    buyerReference: buyerReference || null, purchaseOrderNumber: po || null,
    primaryAreaCode: (p.primaryArea as Case["primaryAreaCode"]) || null, secondaryAreaCode: (p.secondaryArea as Case["secondaryAreaCode"]) || null,
    vocationalTrack: (p.vocationalTrack ?? "").trim(), desiredStart: p.desiredStart || null, plannedStart: null,
    plannedWeeks: pv?.plannedWeeks ?? null, plannedEnd: pv?.plannedEnd ?? null, orderValueWeeks: pv?.plannedWeeks ?? null,
    orderPeriodMonths: pv?.orderPeriodMonths ?? null, orderPeriodReason: pv?.orderPeriodReason ?? null, priorAssessment: p.priorAssessment ?? null,
    acknowledgedAt: now, confirmedAt: null, declinedAt: null,
    declineReason: null, firstMeetingAt: null, startDate: null, endDate: null, closedAt: null, endReason: null, resultClass: null, resultVerifiedAt: null,
    phase: 1, phaseSince: null, leadCoachId: null, backgroundInfo: (p.background ?? "").trim(),
    aiConsentStatus: "not_asked", meetingDay: null, meetingTime: null,
    // Mötesplatsen är Miljonbemannings kontor i Alby tills en annan plats bokas (som i prototypen).
    location: "Alby", pausedWeeks: [], pauseReason: null, sourceEmailId: p.sourceEmailId ?? null,
  };
  await ctx.repo.table("cases").insert(c);
  await addCaseHistory(ctx, { caseId: c.id, fromStatus: null, toStatus: status, reason: `Beställning via ${SOURCE_TEXT[p.source]}` });
  const missing = [...(p.missingFields ?? [])];
  await ctx.audit({ action: "case.created", entity: "case", entityId: c.id, contractId: c.contractId, details: { number: caseNumber, source: p.source, ...(missing.length ? { missing } : {}) } });

  const attachmentIds = [...new Set(p.attachmentIds ?? [])];
  if (attachmentIds.length) {
    // Systemsteg (porten, service role): bilagorna kopplas till ärendet. Bara id:n i loggen – aldrig filnamnen.
    await requireAttachments(ctx).link(attachmentIds, c.id);
    await ctx.audit({ action: "attachment.linked", entity: "case", entityId: c.id, contractId: c.contractId, details: { attachmentIds } });
  }

  // Ordererkännandet: handläggarens konto, annars kontaktuppgiften i beställningen (handläggare utan konto). Inga personuppgifter.
  const to = await referrerEmail(ctx, c);
  await ctx.notify({ channel: "email", to, template: "ordererkannande", body: orderAckText(c, cfg, missing), caseId: c.id });
  return { ok: true, caseId: c.id, caseNumber, personId: person.id };
}
