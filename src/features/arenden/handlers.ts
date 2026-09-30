// Hanterare för området ärenden (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
import { fail, ok } from "@/api/contract";
import { isCustomerRole, type Role } from "@/api/roles";
import { handleCommand, type Ctx } from "@/api/server";
import { ackTextFor, caseCounterId, duplicateActive, nextCaseNumber } from "@/core/cases";
import { isOperational, isUnset, requireOperational } from "@/core/config";
import { consentOf } from "@/core/db-index";
import { avropDue, finalReportDueAt, isProvisionalDue } from "@/core/sla";
import { addDays, dayOf, monday } from "@/core/time";
import { buyerRefError, buyerRefValid, poNumberError } from "@/core/validation";
import type { Case, CaseStatus, CaseStatusHistory, Contract, Person, ResultClass, TeamRole } from "@/data/schema";
import {
  canEditCase, contractOf, hasRoleIn, notifyAssignment, notifyReferrer, orgSettingsFor, sendMeetingInvitation, userEmail,
} from "../_shared/context";
import { protectPnr } from "../_shared/pnr";
import { newReport } from "../_shared/rows";
import {
  caseAccept, caseBookFirstMeeting, caseChangeCoach, caseClose, caseCreate, caseDecline, caseSetBuyerRef, caseUpdate, consentSet, messageRead, messageSend,
  CUSTOMER_PATCH_FIELDS, type CasePatch,
} from "./api";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

const NOT_FOUND = "Ärendet finns inte, eller så har du inte behörighet att se det.";
const NO_EDIT = "Du har inte behörighet att ändra i ärendet.";
/** Samordnare och avtalsansvarig: avropsinkorgen, tilldelning och bokning (prototypens isManager). */
const MANAGERS: readonly Role[] = ["samordnare", "avtalsansvarig"];
/** Arbetar i ärendet (policyns CASE_WORKERS). */
const CASE_WORKERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare"];
/** Ärenden som väntar på svar eller pågår – en person kan bara ha ett sådant (dubblettkontroll). */
const OPEN_STATUSES: readonly CaseStatus[] = ["received", "acknowledged", "confirmed", "active", "paused"];
/** Textversionen av samtyckesinformationen (sparas med samtycket). */
const CONSENT_TEXT_VERSION = "v1.0 (2026-10-01)";

const SOURCE_TEXT: Record<Case["source"], string> = { portal: "portalen", email: "mejl", phone: "telefon" };

/** Statushistorik för ärendet (en rad per status- eller coachbyte). */
async function addHistory(ctx: Ctx, h: Pick<CaseStatusHistory, "caseId" | "fromStatus" | "toStatus" | "reason"> & Partial<CaseStatusHistory>): Promise<void> {
  await ctx.repo.table("case_status_history").insert({
    id: ctx.newId("csh"), fromCoach: null, toCoach: null, customerNotifiedAt: null, changedBy: ctx.actor.userId, changedAt: ctx.now(), ...h,
  });
}

/** Avtalet en beställning görs i: det angivna, annars användarens första aktiva avtal som har driftkonfiguration. */
async function orderContract(ctx: Ctx, requested: string | undefined): Promise<Contract | null> {
  const ok = (c: Contract | null | undefined): c is Contract => !!c && c.status === "active" && isOperational(c.config) && (ctx.actor.contractIds.includes(c.id));
  if (requested) {
    const c = await ctx.repo.table("contracts").get(requested);
    return ok(c) ? c : null;
  }
  const all = await ctx.repo.table("contracts").list({ status: "active" });
  for (const id of ctx.actor.contractIds) {
    const c = all.find((x) => x.id === id);
    if (ok(c)) return c;
  }
  return null;
}

// ---------------------------------------------------------------- case.create
handleCommand(caseCreate, { roles: ["samordnare", "avtalsansvarig", "kommun_handlaggare"] }, async (ctx, p) => {
  const customer = isCustomerRole(ctx.actor.role);
  const prot = !!p.protectedIdentity;
  // Skyddade avrop hanteras av avtalsansvarig enligt den säkra rutinen (prototypens handlesProtected) – eller beställs av kommunen själv.
  if (prot && ctx.actor.role === "samordnare") return fail("forbidden", "Beställningar med skyddade personuppgifter registreras av avtalsansvarig enligt den säkra rutinen.");
  const contract = await orderContract(ctx, p.contractId);
  if (!contract) return fail("no_contract", "Det finns inget aktivt avtal att beställa i.");
  const cfg = requireOperational(contract.config);

  const buyerReference = (p.buyerReference ?? "").trim();
  if (!prot && cfg.billing.buyerReference.required && buyerReference && !buyerRefValid(buyerReference, cfg)) {
    return fail("buyer_ref", buyerRefError(buyerReference, cfg) ?? "Beställarreferensen har fel format.");
  }
  const po = (p.purchaseOrderNumber ?? "").trim();
  const poErr = poNumberError(po, cfg);
  if (poErr) return fail("po_number", poErr);

  // Kommunens handläggare beställer alltid i eget namn. MB (telefon/mejl) anger vilken handläggare som beställde.
  const referrerId = customer ? ctx.actor.userId : p.referrerId ?? null;
  if (!customer && referrerId && !(await hasRoleIn(ctx, referrerId, contract.id, ["kommun_handlaggare"]))) {
    return fail("referrer", "Välj en handläggare hos beställaren.");
  }

  const pnr = protectPnr(p.pnr);
  if (pnr.personnummerHash) {
    // ctx.system: dubblettkontrollen ska se alla pågående ärenden i avtalet, även sådana användaren inte får se.
    // Bara sökhashen jämförs och svaret är ja eller nej – inga uppgifter om det andra ärendet lämnas ut.
    const same = await ctx.system.table("persons").list({ personnummerHash: pnr.personnummerHash });
    if (same.length) {
      const cases = await ctx.system.table("cases").list({ personId: { in: same.map((x) => x.id) }, contractId: contract.id, status: { in: OPEN_STATUSES } });
      if (duplicateActive({ persons: same, cases }, pnr.personnummerHash).length) {
        return fail("duplicate", "Personen har redan en pågående insats. En person kan inte ha två pågående insatser samtidigt.");
      }
    }
  }

  const now = ctx.now();
  const preferredContact = prot ? "phone" : p.preferredContact ?? "sms";
  const person: Person = {
    id: ctx.newId("p"), ...pnr, birthYear: null, firstName: p.firstName.trim(), lastName: p.lastName.trim(),
    // Skyddade personuppgifter: bara namn och personnummer – ingen adress, telefon eller e-post (CLAUDE.md punkt 8).
    phone: prot ? "" : (p.phone ?? "").trim(), email: prot ? "" : (p.email ?? "").trim(), city: prot ? "" : (p.city ?? "").trim(),
    address: !prot && preferredContact === "letter" ? (p.address ?? "").trim() || null : null,
    preferredContact, protectedIdentity: prot, accessibilityNeeds: prot ? "" : (p.accessibilityNeeds ?? "").trim(),
    language: p.language || "svenska", needsInterpreter: !!p.needsInterpreter,
  };
  await ctx.repo.table("persons").insert(person);

  // ctx.system: löpnumret per avtal och år är ett systemsteg (case_counters skrivs aldrig av användare). Numret återanvänds aldrig.
  const year = now.slice(0, 4);
  const counterId = caseCounterId(contract.id, year);
  const counter = await ctx.system.table("case_counters").get(counterId);
  const { caseNumber, lastValue } = nextCaseNumber(counter, cfg, year);
  if (counter) await ctx.system.table("case_counters").update(counterId, { lastValue });
  else await ctx.system.table("case_counters").insert({ id: counterId, contractId: contract.id, year: Number(year), lastValue });

  const status: CaseStatus = prot ? "received" : "acknowledged";
  const source = p.source ?? "portal";
  const c: Case = {
    id: ctx.newId("case"), caseNumber, contractId: contract.id, personId: person.id, status, source, referredAt: now, referrerId,
    referrerName: null, referrerUnit: null, referrerPhone: null, referrerEmail: null,
    buyerReference: buyerReference || null, purchaseOrderNumber: po || null, primaryAreaCode: p.primaryArea || null, secondaryAreaCode: p.secondaryArea || null,
    vocationalTrack: (p.vocationalTrack ?? "").trim(), desiredStart: p.desiredStart || null, plannedStart: null, plannedWeeks: p.plannedWeeks || null,
    plannedEnd: p.plannedEnd || null, orderValueWeeks: p.plannedWeeks || null, acknowledgedAt: prot ? null : now, confirmedAt: null, declinedAt: null,
    declineReason: null, firstMeetingAt: null, startDate: null, endDate: null, closedAt: null, endReason: null, resultClass: null, resultVerifiedAt: null,
    phase: 1, phaseSince: null, leadCoachId: null, backgroundInfo: prot ? "" : (p.background ?? "").trim(),
    aiConsentStatus: prot ? "not_applicable" : "not_asked", meetingDay: null, meetingTime: null,
    // Mötesplatsen är Miljonbemannings kontor i Alby tills en annan plats bokas (som i prototypen).
    location: "Alby", pausedWeeks: [], pauseReason: null, sourceEmailId: null,
  };
  await ctx.repo.table("cases").insert(c);
  await addHistory(ctx, { caseId: c.id, fromStatus: null, toStatus: status, reason: `Beställning via ${SOURCE_TEXT[source]}` });
  await ctx.audit({ action: "case.created", entity: "case", entityId: c.id, contractId: c.contractId, details: { number: caseNumber, source } });

  const to = await userEmail(ctx, referrerId);
  if (prot) {
    // ctx.system: uppgiften går till rollen avtalsansvarig från systemet – ingen automatik körs för skyddade beställningar.
    await ctx.system.table("tasks").insert({
      id: ctx.newId("task"), toRole: "avtalsansvarig", toId: null, fromId: "system", createdAt: now, status: "open", kind: "protected_order", caseIds: [c.id],
      text: `Beställning ${caseNumber} med skyddade personuppgifter. Ring handläggaren enligt den säkra rutinen. Ingen automatik har körts.`,
      deviationId: null, emailId: null, responseId: null, month: null, doneAt: null, doneBy: null, doneNote: null,
    });
    await ctx.notify({ channel: "email", to, template: "generisk_mottagningsbekraftelse", body: "Tack. Vi har tagit emot beställningen. Ring oss på 08-000 00 00 så tar vi resten enligt den säkra rutinen.", caseId: null });
  } else {
    await ctx.notify({ channel: "email", to, template: "ordererkannande", body: ackTextFor(c, cfg), caseId: c.id });
  }
  return ok({ caseId: c.id, caseNumber });
});

// ---------------------------------------------------------------- case.accept
handleCommand(caseAccept, { roles: MANAGERS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  // Samordnaren ser bara ärendenumret vid skyddade personuppgifter – avropet hanteras av avtalsansvarig.
  const person = await ctx.repo.table("persons").get(c.personId);
  if (!person) return fail("forbidden", "Skyddade avrop hanteras av avtalsansvarig enligt den säkra rutinen.");
  if (c.status !== "received" && c.status !== "acknowledged") return fail("wrong_status", `${c.caseNumber} är redan besvarat.`);
  const { contract, cfg } = await contractOf(ctx, c.contractId);
  const ref = p.buyerReference != null ? p.buyerReference.trim() : c.buyerReference;
  if (cfg.billing.buyerReference.required && !buyerRefValid(ref, cfg)) {
    return fail("buyer_ref", buyerRefError(ref, cfg) ?? "Beställarreferensen har fel format.");
  }
  if (!(await hasRoleIn(ctx, p.leadCoachId, c.contractId, ["coach"]))) return fail("coach", "Välj huvudcoach.");
  const team: { userId: string; role: TeamRole }[] = [{ userId: p.leadCoachId, role: "lead_coach" }];
  for (const t of p.team ?? []) {
    if (team.some((x) => x.userId === t.userId)) continue;
    if (!(await hasRoleIn(ctx, t.userId, c.contractId, ["coach", "handledare"]))) return fail("team", "Välj teammedlemmar bland Miljonbemannings personal i avtalet.");
    team.push({ userId: t.userId, role: t.role });
  }

  const now = ctx.now();
  const plannedWeeks = p.plannedWeeks ?? c.plannedWeeks;
  const plannedStart = p.firstMeetingAt ? dayOf(p.firstMeetingAt) : p.startDate ?? c.desiredStart;
  const patch: Partial<Case> = { buyerReference: ref, leadCoachId: p.leadCoachId, status: "confirmed", confirmedAt: now, plannedStart };
  if (p.plannedWeeks) {
    patch.plannedWeeks = p.plannedWeeks;
    patch.orderValueWeeks = p.plannedWeeks;
  }
  if (p.firstMeetingAt) patch.firstMeetingAt = p.firstMeetingAt;
  if (plannedStart && plannedWeeks) patch.plannedEnd = addDays(monday(plannedStart), (plannedWeeks - 1) * 7 + 4);
  const updated = await ctx.repo.table("cases").update(c.id, patch);

  const teamTable = ctx.repo.table("case_team");
  for (const t of await teamTable.list({ caseId: c.id })) await teamTable.remove(t.id);
  for (const t of team) await teamTable.insert({ id: `${c.id}:${t.userId}`, caseId: c.id, userId: t.userId, role: t.role });
  await addHistory(ctx, { caseId: c.id, fromStatus: c.status, toStatus: "confirmed", toCoach: p.leadCoachId, reason: "Avrop accepterat" });

  const due = avropDue(c, cfg);
  const today = dayOf(now);
  const rep = newReport({
    id: ctx.newId("rep"), contractId: c.contractId, caseId: c.id, kind: "order_confirmation", periodStart: today, periodEnd: today, status: "delivered", dueAt: due,
    approvedBy: ctx.actor.userId, approvedAt: now, deliveredAt: now, deliveredTo: c.referrerId ? [c.referrerId] : [],
  });
  await ctx.repo.table("reports").insert(rep);
  const email = await ctx.repo.table("inbound_emails").first({ caseId: c.id, status: { in: ["acknowledged", "received"] } });
  if (email) await ctx.repo.table("inbound_emails").update(email.id, { status: "accepted", handledBy: ctx.actor.userId, handledAt: now });
  await ctx.audit({
    action: "case.accepted", entity: "case", entityId: c.id, contractId: c.contractId,
    details: { leadCoachId: p.leadCoachId, firstMeetingAt: p.firstMeetingAt ?? null, withinSla: due ? now <= due : null },
  });

  const settings = await orgSettingsFor(ctx, contract);
  for (const t of team) await notifyAssignment(ctx, updated, t.userId, t.role, settings);
  await notifyReferrer(ctx, c, "orderbekraftelse", `Orderbekräftelse för ärende ${c.caseNumber} finns i portalen – logga in för att läsa. Startdatum och ansvarig coach framgår där.`);
  if (person.protectedIdentity) {
    // Prototypens ink.acceptProtected: ingen kallelse till deltagaren – den namngivna coachen ringer enligt den säkra rutinen.
    await ctx.audit({ action: "notify.suppressed", entity: "case", entityId: c.id, contractId: c.contractId, details: { reason: "Skyddade personuppgifter – ingen kallelse via SMS eller e-post till deltagaren" } });
  } else if (p.firstMeetingAt) {
    await sendMeetingInvitation(ctx, updated, person, p.firstMeetingAt);
  }
  return ok({ reportId: rep.id, caseNumber: c.caseNumber });
});

// ---------------------------------------------------------------- case.decline
handleCommand(caseDecline, { roles: MANAGERS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  const reason = p.reason.trim();
  if (!reason) return fail("reason", "Välj en orsak.");
  if (!(await canEditCase(ctx, c))) return fail("forbidden", "Skyddade avrop hanteras av avtalsansvarig enligt den säkra rutinen.");
  if (c.status !== "received" && c.status !== "acknowledged") return fail("wrong_status", `${c.caseNumber} är redan besvarat.`);
  const now = ctx.now();
  await ctx.repo.table("cases").update(c.id, { status: "declined", declineReason: reason, declinedAt: now });
  const email = await ctx.repo.table("inbound_emails").first({ caseId: c.id });
  if (email) await ctx.repo.table("inbound_emails").update(email.id, { status: "declined", handledBy: ctx.actor.userId, handledAt: now });
  await addHistory(ctx, { caseId: c.id, fromStatus: c.status, toStatus: "declined", reason });
  await ctx.audit({ action: "case.declined", entity: "case", entityId: c.id, contractId: c.contractId, details: { reason } });
  await notifyReferrer(ctx, c, "avbojt", `Vi kan tyvärr inte ta emot beställning ${c.caseNumber}. Logga in i portalen för att läsa orsaken.`);
  return ok({});
});

// ---------------------------------------------------------------- case.update
handleCommand(caseUpdate, { roles: ["samordnare", "avtalsansvarig", "coach", "kommun_handlaggare"] }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  const keys = Object.keys(p.patch) as (keyof CasePatch)[];
  if (isCustomerRole(ctx.actor.role) && keys.some((k) => !(CUSTOMER_PATCH_FIELDS as readonly string[]).includes(k))) {
    return fail("forbidden", "Du kan bara ändra dina kontaktuppgifter i beställningen.");
  }
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  if (p.patch.purchaseOrderNumber) {
    const { cfg } = await contractOf(ctx, c.contractId);
    const err = poNumberError(p.patch.purchaseOrderNumber, cfg);
    if (err) return fail("po_number", err);
  }
  const changed: Partial<Case> = {};
  for (const k of keys) {
    const v = p.patch[k];
    if (JSON.stringify(c[k]) !== JSON.stringify(v)) (changed as Record<string, unknown>)[k] = v;
  }
  const fields = Object.keys(changed);
  if (fields.length) await ctx.repo.table("cases").update(c.id, changed);
  await ctx.audit({ action: "case.updated", entity: "case", entityId: c.id, contractId: c.contractId, details: { fields } });
  return ok({ changed: fields });
});

// ---------------------------------------------------------------- case.setBuyerRef
handleCommand(caseSetBuyerRef, { roles: ["ekonom", "samordnare", "avtalsansvarig"] }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  const ref = p.reference.trim();
  const { cfg } = await contractOf(ctx, c.contractId);
  const err = buyerRefError(ref, cfg);
  if (err) return fail("buyer_ref", err);
  await ctx.repo.table("cases").update(c.id, { buyerReference: ref });
  await ctx.audit({ action: "case.buyer_reference_changed", entity: "case", entityId: c.id, contractId: c.contractId, details: { from: c.buyerReference, to: ref, source: p.source ?? "" } });
  return ok({});
});

// ---------------------------------------------------------------- case.bookFirstMeeting
handleCommand(caseBookFirstMeeting, { roles: MANAGERS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  const person = await ctx.repo.table("persons").get(c.personId);
  if (!person) return fail("forbidden", NO_EDIT);
  await ctx.repo.table("cases").update(c.id, { firstMeetingAt: p.at, plannedStart: dayOf(p.at) });
  await ctx.audit({ action: "case.first_meeting_booked", entity: "case", entityId: c.id, contractId: c.contractId, details: { at: p.at } });
  await sendMeetingInvitation(ctx, c, person, p.at);
  return ok({});
});

// ---------------------------------------------------------------- case.changeCoach
handleCommand(caseChangeCoach, { roles: MANAGERS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  const reason = p.reason.trim();
  if (!reason) return fail("reason", "Skriv orsaken till bytet. Den sparas i historiken.");
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  if (!(await hasRoleIn(ctx, p.toCoachId, c.contractId, ["coach"]))) return fail("coach", "Välj ny huvudcoach.");
  const from = c.leadCoachId;
  const now = ctx.now();
  const updated = await ctx.repo.table("cases").update(c.id, { leadCoachId: p.toCoachId });
  // Teamet: ny huvudcoach först; den tidigare huvudcoachen lämnar teamet (som i prototypen).
  const teamTable = ctx.repo.table("case_team");
  for (const t of await teamTable.list({ caseId: c.id })) if (t.role === "lead_coach" || t.userId === p.toCoachId) await teamTable.remove(t.id);
  await teamTable.insert({ id: `${c.id}:${p.toCoachId}`, caseId: c.id, userId: p.toCoachId, role: "lead_coach" });
  await addHistory(ctx, { caseId: c.id, fromStatus: c.status, toStatus: c.status, fromCoach: from, toCoach: p.toCoachId, reason, customerNotifiedAt: now });
  await ctx.audit({ action: "case.coach_changed", entity: "case", entityId: c.id, contractId: c.contractId, details: { from, to: p.toCoachId, reason } });
  const { contract } = await contractOf(ctx, c.contractId);
  await notifyAssignment(ctx, updated, p.toCoachId, "lead_coach", await orgSettingsFor(ctx, contract));
  await notifyReferrer(ctx, c, "coachbyte", `Ärende ${c.caseNumber} har fått ny huvudcoach. Logga in i portalen för att se vem.`);
  return ok({});
});

// ---------------------------------------------------------------- case.close
handleCommand(caseClose, { roles: ["coach"] }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!p.endDate || !p.endReason) return fail("missing", "Välj datum och orsak för avslutet.");
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  if (c.status === "closed" || c.status === "declined") return fail("wrong_status", "Insatsen är redan avslutad.");
  const { cfg } = await contractOf(ctx, c.contractId);
  // Resultatklass enligt avtalets resultatdefinition. Tills nämnarens undantag är fastställda gäller det preliminära.
  const excluded = isUnset(cfg.result.excludedFromDenominator) ? cfg.result.prototypeExcluded ?? [] : cfg.result.excludedFromDenominator;
  const resultClass: ResultClass = cfg.result.countsAsResult.includes(p.endReason) ? "result" : excluded.includes(p.endReason) ? "excluded" : "no_result";
  const now = ctx.now();
  await ctx.repo.table("cases").update(c.id, {
    status: "closed", endDate: p.endDate, endReason: p.endReason, closedAt: now, resultClass, resultVerifiedAt: resultClass === "result" && p.verified ? now : null,
  });
  await addHistory(ctx, { caseId: c.id, fromStatus: c.status, toStatus: "closed", reason: p.endReason });
  // Utkast till slutrapport (SPEC §7.8). Förfallotiden är preliminär så länge avtalets regel är ATT_FASTSTÄLLA.
  const rep = newReport({
    id: ctx.newId("rep"), contractId: c.contractId, caseId: c.id, kind: "final", periodStart: c.startDate, periodEnd: p.endDate, status: "draft",
    dueAt: finalReportDueAt(cfg, p.endDate), provisionalDue: isProvisionalDue(cfg, "final"),
  });
  await ctx.repo.table("reports").insert(rep);
  // Exit-pulsmätning – aldrig vid skyddade personuppgifter (inga SMS eller mejl till deltagaren).
  const person = await ctx.repo.table("persons").get(c.personId);
  if (person && !person.protectedIdentity && cfg.pulse.occasions.includes("exit")) {
    await ctx.repo.table("pulse_invites").insert({
      id: ctx.newId("pi"), caseId: c.id, tokenHash: null, channel: person.preferredContact === "email" ? "email" : "sms", language: "sv", occasion: "exit",
      sentAt: now, expiresAt: addDays(now, 7), usedAt: null,
    });
  }
  await ctx.audit({ action: "case.closed", entity: "case", entityId: c.id, contractId: c.contractId, details: { endReason: p.endReason, resultClass } });
  return ok({ reportId: rep.id, resultClass });
});

// ---------------------------------------------------------------- message.send
handleCommand(messageSend, { roles: [...CASE_WORKERS, "kommun_handlaggare"] }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  const fromCustomer = isCustomerRole(ctx.actor.role);
  // Från kommunen skriver bara handläggaren som beställde insatsen (prototypens canWrite).
  if (fromCustomer && c.referrerId !== ctx.actor.userId) return fail("forbidden", "Meddelanden om deltagaren skickas av handläggaren som beställde insatsen.");
  const body = p.body.trim();
  if (!body) return fail("empty", "Skriv ett meddelande först.");
  const now = ctx.now();
  const id = ctx.newId("msg");
  await ctx.repo.table("messages").insert({ id, caseId: c.id, senderId: ctx.actor.userId, body, createdAt: now, readBy: [], readAt: null, kind: null });
  const mailText = `Du har ett nytt meddelande om ärende ${c.caseNumber} – logga in för att läsa.`;
  if (!fromCustomer) {
    await notifyReferrer(ctx, c, "nytt_meddelande", mailText);
  } else if (c.leadCoachId) {
    // ctx.system: notisen går till huvudcoachen (en annan användare) – user_notifications skrivs bara av systemet.
    const coach = await ctx.system.table("profiles").get(c.leadCoachId);
    if (coach) {
      await ctx.system.table("user_notifications").insert({
        id: ctx.newId("un"), recipientId: coach.id, kind: "message", caseId: c.id, createdAt: now, channels: ["app", "email"],
        title: "Nytt meddelande från kommunen", body: `Nytt säkert meddelande om ${c.caseNumber}. Läs och svara i ärendets flik Meddelanden.`, emailBody: mailText,
      });
      await ctx.notify({ channel: "email", to: coach.email, template: "nytt_meddelande", body: mailText, caseId: c.id });
    }
  }
  await ctx.audit({ action: "message.sent", entity: "case", entityId: c.id, contractId: c.contractId, details: {} });
  return ok({ messageId: id });
});

// ---------------------------------------------------------------- message.read (tyst)
handleCommand(
  messageRead,
  { roles: ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin", "kommun_handlaggare", "kommun_chef"], silent: true },
  async (ctx, p) => {
    const c = await ctx.repo.table("cases").get(p.caseId);
    if (!c) return fail("not_found", NOT_FOUND);
    const me = ctx.actor.userId;
    // Läskvitto bara från den som arbetar i ärendet eller beställande handläggare. Chef, admin och kommunens chef läser utan kvitto.
    const marks = CASE_WORKERS.includes(ctx.actor.role) || (ctx.actor.role === "kommun_handlaggare" && c.referrerId === me);
    if (!marks) return ok({ marked: 0 });
    const now = ctx.now();
    let marked = 0;
    for (const m of await ctx.repo.table("messages").list({ caseId: c.id })) {
      if (m.senderId === me || m.readBy.includes(me)) continue;
      await ctx.repo.table("messages").update(m.id, { readBy: [...m.readBy, me], readAt: m.readAt ?? now });
      marked++;
    }
    return ok({ marked });
  },
);

// ---------------------------------------------------------------- consent.set
handleCommand(consentSet, { roles: ["samordnare", "avtalsansvarig", "coach"] }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  const person = await ctx.repo.table("persons").get(c.personId);
  // Skyddade personuppgifter: ingen inspelning och ingen AI – samtycke kan inte registreras (CLAUDE.md punkt 8).
  if (!person || person.protectedIdentity) return fail("protected", "Samtycke kan inte registreras för skyddade personuppgifter.");
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  const now = ctx.now();
  const consents = ctx.repo.table("consents");
  if (p.value === "given") {
    await consents.insert({
      id: ctx.newId("cons"), personId: c.personId, caseId: c.id, kind: "recording_and_ai", textVersion: CONSENT_TEXT_VERSION, givenAt: now, declinedAt: null,
      informedBy: ctx.actor.userId, language: p.language || "lättläst svenska", revokedAt: null,
    });
  } else if (p.value === "declined") {
    await consents.insert({
      id: ctx.newId("cons"), personId: c.personId, caseId: c.id, kind: "recording_and_ai", textVersion: CONSENT_TEXT_VERSION, givenAt: null, declinedAt: now,
      informedBy: ctx.actor.userId, language: null, revokedAt: null,
    });
  } else {
    const cur = consentOf({ consents: await consents.list({ caseId: c.id }) }, c.id);
    if (cur) await consents.update(cur.id, { revokedAt: now });
  }
  await ctx.repo.table("cases").update(c.id, { aiConsentStatus: p.value });
  await ctx.audit({ action: `consent.${p.value}`, entity: "consent", entityId: c.id, contractId: c.contractId, details: { caseId: c.id } });
  return ok({});
});
