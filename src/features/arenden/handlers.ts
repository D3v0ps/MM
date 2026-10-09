// Hanterare för området ärenden (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
import { fail, ok } from "@/api/contract";
import { loadDb } from "@/api/load";
import { isCustomerRole, type Role } from "@/api/roles";
import { handleCommand, handleQuery, type Ctx, type PnrCrypto } from "@/api/server";
import { hidesCommercial } from "@/api/tester-access";
import { caseAccessIn, displayName, type AccessSource } from "@/core/access";
import { alerts, type AlertDb, type AlertItem } from "@/core/alerts";
import { attendanceStats, repeatedAbsence, type AttendanceStats } from "@/core/attendance";
import { buyerRefProblem } from "@/core/billing";
import { coaches, phaseSince, stuck } from "@/core/cases";
import { isOperational, isUnset, phaseName, requireOperational, slaRule, WEEK_PLAN_KINDS, type OperationalConfig } from "@/core/config";
import {
  activitiesOf, assessmentFor, assessmentsOf, attendanceFor, byId, checkInsOf, consentOf, deviationsOf, eventsOf, groupedBy, historyOf, intakeOf, latestCheckIn,
  messagesOf, placementsOf, reportsOf,
} from "@/core/db-index";
import { domainEnv, type DomainEnv } from "@/core/env";
import { plural } from "@/core/format";
import {
  areaName, attLabel, contactLabel, END_REASONS, endReasonLabel, eventLabel, personName, reportKindLabel, reportStatusLabel, statusLabel, teamLabel,
} from "@/core/labels";
import { defaultWeekPlan, normalizePlan, planActivities, planFromActivities, type PlannedActivity, type WeekPlanRow } from "@/core/schedule";
import { scopeToContract } from "@/core/scope";
import { avropDue, finalReportDueAt, firstMeetingDays, firstMeetingDue, isProvisionalDue, slaStatus, type SlaTone } from "@/core/sla";
import {
  addDays, addMonths, addWorkingDays, billableWeekCount, dayOf, fmtDate, fmtDateShort, fmtDateTime, fmtDateTimeLong, isoWeek, monday, monthEnd, monthKey, monthName,
  WEEKDAYS,
} from "@/core/time";
import { by, groupBy } from "@/core/util";
import { buyerRefError, buyerRefValid, looksLikePnr, poNumberError } from "@/core/validation";
import { PROTOTYPE_ROLES } from "@/data/actors";
import { ACTIVITY_TYPES } from "@/data/seed/constants";
import type {
  Activity, AlertKind, AlertSeverity, Case, Contract, Db, FourRights, Message, OutcomeEventKind, Person, ResultClass, TeamRole,
} from "@/data/schema";
import {
  canEditCase, contractOf, hasRoleIn, notifyAssignment, notifyReferrer, orgSettingsFor, sendMeetingInvitation,
} from "../_shared/context";
import { revealPnr } from "../_shared/pnr";
import { canHaveTeamRole, teamCandidates } from "../_shared/team";
import { newReport } from "../_shared/rows";
import { docBase, monthlyDocView } from "../rapporter/doc-view";
import { freezeReport } from "../rapporter/freeze";
import { monthlyGaps, monthlyPreview, type ReportDb, type ReportEnv } from "../rapporter/model";
import { deliveredOk } from "../rapporter/report-helpers";
import { buildTimeline, enrolledIn, monthReportState } from "./timeline";
import "./attachment-handlers";
import { caseBackground } from "./background";
import { addCaseHistory, createOrder, orderPeriodFrom, SOURCE_TEXT } from "./order";
import {
  activityAdd, activityRemove, caseAccept, caseBookFirstMeeting, caseChangeCoach, caseClose, caseCreate, caseDecline, caseScheduleChange, caseSetBuyerRef, caseSetTeam, caseStart,
  caseUpdate, consentSet, messageRead, messageSend,
  CUSTOMER_PATCH_FIELDS, type CasePatch,
  caseAttendance, caseCard, caseCheckIns, caseDeviations, caseEvents, caseHistory, caseIntake, caseList, caseMessages, caseMonthBasis, caseNoteRemove, caseNoteSave,
  caseOverview, casePlacements, caseReports, caseRevealPnr, caseTimeline, caseTimelineText, supervisorStart, TEAM_TABS,
  type AttendanceSummary, type CaseAttendance, type CaseMonthBasis, type CaseMonthOption, type CaseTimeline, type CaseAttendanceWeek, type CaseCard, type CaseCardResult, type CaseDeviations, type CaseEvents,
  type CaseFlag, type CaseHistory, type CaseHistoryItem, type CaseIntake, type CaseListModel, type CaseListRow, type CaseMessageRow, type CaseOverview, type CasePlacements, type CaseReportRow,
  type CaseTab, type SupervisorCase, type SupervisorStart, type TimelineText,
} from "./api";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

const NOT_FOUND = "Ärendet finns inte, eller så har du inte behörighet att se det.";
const NO_EDIT = "Du har inte behörighet att ändra i ärendet.";
/** Samordnare och avtalsansvarig: avropsinkorgen, tilldelning och bokning (prototypens isManager). */
const MANAGERS: readonly Role[] = ["samordnare", "avtalsansvarig"];
/** Arbetar i ärendet (policyns CASE_WORKERS). */
const CASE_WORKERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare"];
/** Ärenden som väntar på svar eller pågår – en person kan bara ha ett sådant (dubblettkontroll). */
/** Textversionen av samtyckesinformationen (sparas med samtycket). */
const CONSENT_TEXT_VERSION = "v1.0 (2026-10-01)";

/** Statushistorik för ärendet (en rad per status- eller coachbyte) – gemensam med beställningens skapande (./order.ts). */
const addHistory = addCaseHistory;

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
// Själva skapandet (person, löpnummer, ärende, statushistorik, bilagor och ordererkännande) ligger i ./order.ts
// (createOrder) och delas med inkorg.register (telefon/mejl registrerat av Miljonbemanning) och mejlinläsningen.
handleCommand(caseCreate, { roles: ["samordnare", "avtalsansvarig", "kommun_handlaggare"] }, async (ctx, p) => {
  const customer = isCustomerRole(ctx.actor.role);
  const contract = await orderContract(ctx, p.contractId);
  if (!contract) return fail("no_contract", "Det finns inget aktivt avtal att beställa i.");
  const cfg = requireOperational(contract.config);

  // Beställarreferensen fylls i av Miljonbemanning (beslut 2026-10-07) – kommunens formulär skickar ingen.
  const buyerReference = customer ? "" : (p.buyerReference ?? "").trim();
  if (buyerReference && !buyerRefValid(buyerReference, cfg)) return fail("buyer_ref", buyerRefError(buyerReference, cfg) ?? "Beställarreferensen har fel format.");
  const po = customer ? "" : (p.purchaseOrderNumber ?? "").trim();
  const poErr = poNumberError(po, cfg);
  if (poErr) return fail("po_number", poErr);

  // Omfattningen: kommunen måste välja (6/12 månader eller annan tidsperiod med motivering).
  const period = orderPeriodFrom(cfg, p.desiredStart, p);
  if (!period.ok) return fail("order_period", period.message);
  if (customer && !period.value) return fail("order_period", "Välj hur länge insatsen ska pågå.");
  const unit = (p.referrerUnit ?? "").trim();
  if (customer && !unit) return fail("unit", "Skriv vilken enhet du arbetar på.");
  if (customer && !p.priorAssessment) return fail("prior_assessment", "Svara om en kartläggning har genomförts.");

  // Kommunens handläggare beställer alltid i eget namn. MB (telefon/mejl) anger vilken handläggare som beställde.
  const referrerId = customer ? ctx.actor.userId : p.referrerId ?? null;
  if (!customer && referrerId && !(await hasRoleIn(ctx, referrerId, contract.id, ["kommun_handlaggare"]))) {
    return fail("referrer", "Välj en handläggare hos beställaren.");
  }

  // Bilagorna: bara egna uppladdningar i avtalet som inte är kopplade till en beställning (läses via behörigheten).
  const attachmentIds = [...new Set(p.attachmentIds ?? [])];
  if (attachmentIds.length) {
    const rows = await ctx.repo.table("case_attachments").list({ id: { in: attachmentIds } });
    const ok = attachmentIds.every((id) => {
      const a = rows.find((x) => x.id === id);
      return !!a && a.uploadedBy === ctx.actor.userId && !a.caseId && a.contractId === contract.id && a.status === "uploaded";
    });
    if (!ok) return fail("attachments", "En bilaga kunde inte kopplas till beställningen. Ta bort den och bifoga den igen.");
  }

  const res = await createOrder(ctx, {
    contract, source: p.source ?? "portal", referrerId, referrerUnit: unit || null,
    firstName: p.firstName, lastName: p.lastName, pnr: p.pnr, phone: p.phone, email: p.email, city: p.city, address: p.address,
    preferredContact: p.preferredContact, language: p.language, needsInterpreter: p.needsInterpreter,
    buyerReference, purchaseOrderNumber: po, primaryArea: customer ? null : p.primaryArea, secondaryArea: customer ? null : p.secondaryArea,
    vocationalTrack: customer ? "" : p.vocationalTrack, desiredStart: p.desiredStart, orderPeriodMonths: p.orderPeriodMonths, plannedEnd: p.plannedEnd,
    orderPeriodReason: p.orderPeriodReason, priorAssessment: p.priorAssessment, background: p.background, attachmentIds,
  });
  if (!res.ok) return fail(res.error, res.message);

  // Enheten (fritext) sparas i handläggarens profil om den saknas där – förifylls nästa gång (egen profil, via behörigheten).
  if (customer && unit) {
    const me = await ctx.repo.table("profiles").get(ctx.actor.userId);
    if (me && !me.customerUnit) {
      await ctx.repo.table("profiles").update(me.id, { customerUnit: unit });
      await ctx.audit({ action: "profile.updated", entity: "profile", entityId: me.id, contractId: contract.id, details: { fields: ["customerUnit"] } });
    }
  }
  return ok({ caseId: res.caseId, caseNumber: res.caseNumber });
});

// ---------------------------------------------------------------- case.accept
handleCommand(caseAccept, { roles: MANAGERS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  // Personen läses via behörigheten (vilande spärr för skyddade personuppgifter: samordnaren ser då ingen person).
  const person = await ctx.repo.table("persons").get(c.personId);
  if (!person) return fail("forbidden", NO_EDIT);
  if (c.status !== "received" && c.status !== "acknowledged") return fail("wrong_status", `${c.caseNumber} är redan besvarat.`);
  const { contract, cfg } = await contractOf(ctx, c.contractId);
  // Beställarreferensen är valfri vid accept (beslut 2026-10-07) – formatet kontrolleras om något skrivits.
  const ref = p.buyerReference != null ? p.buyerReference.trim() || null : c.buyerReference;
  if (p.buyerReference != null && ref && !buyerRefValid(ref, cfg)) {
    return fail("buyer_ref", buyerRefError(ref, cfg) ?? "Beställarreferensen har fel format.");
  }
  // Avtalsområde och yrkesspår sätts av Miljonbemanning (synpunkt #8) – krävs om ärendet saknar dem.
  const primary = p.primaryArea !== undefined ? p.primaryArea || null : c.primaryAreaCode;
  const secondary = p.secondaryArea !== undefined ? p.secondaryArea || null : c.secondaryAreaCode;
  const areas = await ctx.repo.table("contract_areas").list({ contractId: c.contractId, active: true });
  if (!primary || !areas.some((a) => a.code === primary)) return fail("area", "Välj ett avtalsområde.");
  if (secondary && (secondary === primary || !areas.some((a) => a.code === secondary))) return fail("area", "Välj ett annat alternativt område än det första, eller inget.");
  const track = p.vocationalTrack !== undefined ? p.vocationalTrack.trim() : c.vocationalTrack;
  if (!track) return fail("track", "Skriv yrkesspåret.");
  if (!(await hasRoleIn(ctx, p.leadCoachId, c.contractId, ["coach"]))) return fail("coach", "Välj huvudcoach.");
  const team: { userId: string; role: TeamRole }[] = [{ userId: p.leadCoachId, role: "lead_coach" }];
  for (const t of p.team ?? []) {
    if (team.some((x) => x.userId === t.userId)) continue;
    // Teamrollerna bygger på medlemskapens roller (beslut 2026-10-08): handledare, eller all MB-personal utom ekonom och admin.
    if (t.role === "lead_coach" || !(await canHaveTeamRole(ctx, t.userId, c.contractId, t.role))) return fail("team", "Välj teammedlemmar bland Miljonbemannings personal i avtalet.");
    team.push({ userId: t.userId, role: t.role });
  }

  const now = ctx.now();
  // Slutdatumet räknas från första mötets dag (beslut 7, 2026-10-08) – mötet är obligatoriskt vid accept.
  const plannedStart = dayOf(p.firstMeetingAt);
  // Omfattningen: ny i dialogen, annars beställningens (planerat slut räknas om från mötesdagen). Äldre beställningar i
  // veckor räknas som förut (fredagen i sista veckan).
  const given = orderPeriodFrom(cfg, plannedStart, p);
  if (!given.ok) return fail("order_period", given.message);
  let period = given.value;
  if (!period && c.orderPeriodMonths != null) {
    const kept = orderPeriodFrom(cfg, plannedStart, { orderPeriodMonths: c.orderPeriodMonths });
    if (!kept.ok) return fail("order_period", kept.message);
    period = kept.value;
  } else if (!period && c.orderPeriodReason && c.plannedEnd && c.plannedEnd > plannedStart) {
    // Annan tidsperiod: kommunens slutdatum behålls, veckorna räknas om från mötesdagen.
    period = { orderPeriodMonths: null, orderPeriodReason: c.orderPeriodReason, plannedEnd: c.plannedEnd, plannedWeeks: billableWeekCount(plannedStart, c.plannedEnd) };
  }
  const patch: Partial<Case> = {
    buyerReference: ref, leadCoachId: p.leadCoachId, status: "confirmed", confirmedAt: now, plannedStart, firstMeetingAt: p.firstMeetingAt,
    primaryAreaCode: primary, secondaryAreaCode: secondary, vocationalTrack: track,
  };
  if (period) {
    Object.assign(patch, { orderPeriodMonths: period.orderPeriodMonths, orderPeriodReason: period.orderPeriodReason, plannedEnd: period.plannedEnd, plannedWeeks: period.plannedWeeks, orderValueWeeks: period.plannedWeeks });
  } else if (c.plannedWeeks) {
    patch.plannedEnd = addDays(monday(plannedStart), (c.plannedWeeks - 1) * 7 + 4);
  } else {
    return fail("order_period", "Välj hur länge insatsen ska pågå.");
  }
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
    details: { leadCoachId: p.leadCoachId, firstMeetingAt: p.firstMeetingAt, withinSla: due ? now <= due : null },
  });

  const settings = await orgSettingsFor(ctx, contract);
  for (const t of team) await notifyAssignment(ctx, updated, t.userId, t.role, settings);
  await notifyReferrer(ctx, c, "orderbekraftelse", `Orderbekräftelse för ärende ${c.caseNumber} finns i portalen – logga in för att läsa. Startdatum och ansvarig coach framgår där.`);
  if (person.protectedIdentity) {
    // VILANDE spärr (skyddade personuppgifter borttaget ur appen 2026-10-07, protectedIdentity är alltid false): ingen kallelse.
    await ctx.audit({ action: "notify.suppressed", entity: "case", entityId: c.id, contractId: c.contractId, details: { reason: "Skyddade personuppgifter – ingen kallelse via SMS eller e-post till deltagaren" } });
  } else {
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
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
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
/**
 * Omfattningen räknad från en startdag (beslut 7, 2026-10-08 – slutdatumet räknas från första mötet): 6 eller 12 månader ur
 * avtalet via orderPeriodFrom; "annan tidsperiod" behåller kommunens slutdatum men räknar om veckorna; en äldre beställning i
 * veckor slutar fredagen i sista veckan. Tomt när beställningen saknar omfattning (den väljs vid accept).
 */
function periodFromStart(cfg: OperationalConfig, c: Case, start: string): { ok: true; patch: Partial<Case> } | { ok: false; message: string } {
  if (c.orderPeriodMonths != null) {
    const r = orderPeriodFrom(cfg, start, { orderPeriodMonths: c.orderPeriodMonths });
    if (!r.ok) return r;
    const v = r.value;
    return v ? { ok: true, patch: { plannedEnd: v.plannedEnd, plannedWeeks: v.plannedWeeks, orderValueWeeks: v.plannedWeeks } } : { ok: true, patch: {} };
  }
  if (c.orderPeriodReason && c.plannedEnd) {
    if (c.plannedEnd <= start) return { ok: false, message: "Mötet ligger efter beställningens slutdatum. Ändra omfattningen i ärendet först." };
    const weeks = billableWeekCount(start, c.plannedEnd);
    return { ok: true, patch: { plannedWeeks: weeks, orderValueWeeks: weeks } };
  }
  if (c.plannedWeeks) return { ok: true, patch: { plannedEnd: addDays(monday(start), (c.plannedWeeks - 1) * 7 + 4) } };
  return { ok: true, patch: {} };
}

// Bokning och ombokning av första mötet. Slutdatumet räknas om från mötesdagen (beslut 7, 2026-10-08). Bokas mötet om efter
// att orderbekräftelsen levererats får kommunen en ny version av orderbekräftelsen (den gamla märks ersatt) och ett mejl med
// bara ärendenummer och länk – orderbekräftelsen visar alltid det slutdatum som gäller.
handleCommand(caseBookFirstMeeting, { roles: MANAGERS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  const person = await ctx.repo.table("persons").get(c.personId);
  if (!person) return fail("forbidden", NO_EDIT);
  const { cfg } = await contractOf(ctx, c.contractId);
  const day = dayOf(p.at);
  const period = periodFromStart(cfg, c, day);
  if (!period.ok) return fail("order_period", period.message);
  const now = ctx.now();
  const rebooked = !!c.firstMeetingAt;
  // Den senaste levererade orderbekräftelsen ersätts av en ny version. Den gamla fryses FÖRE ändringen av ärendet (bästa försök,
  // som vid leverans), så att den behåller det slutdatum och det möte den lovade.
  const previous = (await ctx.repo.table("reports").list({ caseId: c.id, kind: "order_confirmation" })).filter(deliveredOk).sort(by("version", -1))[0] ?? null;
  if (previous) {
    try {
      await freezeReport(ctx, previous.id);
    } catch (e) {
      console.error("orderbekräftelse: frysningen av den ersatta versionen misslyckades", previous.id, e instanceof Error ? e.name : typeof e);
    }
  }
  const updated = await ctx.repo.table("cases").update(c.id, { firstMeetingAt: p.at, plannedStart: day, ...period.patch });
  await ctx.audit({
    action: "case.first_meeting_booked", entity: "case", entityId: c.id, contractId: c.contractId,
    details: { at: p.at, rebooked, plannedEnd: updated.plannedEnd, plannedWeeks: updated.plannedWeeks },
  });
  if (previous) {
    const today = dayOf(now);
    const nr = newReport({
      id: ctx.newId("rep"), contractId: c.contractId, caseId: c.id, kind: "order_confirmation", periodStart: today, periodEnd: today, status: "delivered",
      dueAt: previous.dueAt, version: previous.version + 1, previousId: previous.id, approvedBy: ctx.actor.userId, approvedAt: now, deliveredAt: now,
      deliveredTo: c.referrerId ? [c.referrerId] : previous.deliveredTo,
    });
    await ctx.repo.table("reports").insert(nr);
    await ctx.repo.table("reports").update(previous.id, { superseded: true, supersededAt: now, supersededBy: nr.id });
    await ctx.audit({
      action: "report.delivered", entity: "report", entityId: nr.id, contractId: c.contractId,
      details: { kind: "order_confirmation", channel: "portal", version: nr.version, reason: "first_meeting_rebooked", previous: previous.id },
    });
    await notifyReferrer(ctx, c, "orderbekraftelse", `Orderbekräftelsen för ärende ${c.caseNumber} är uppdaterad – logga in i portalen för att läsa. Första mötet och planerat slut framgår där.`);
  }
  await sendMeetingInvitation(ctx, updated, person, p.at);
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

// ---------------------------------------------------------------- case.start, veckoplan, tillfällen och team (beslut 2026-10-08, skarp drift)
// I skarp drift blev ett ärende aldrig "Pågår": ingen hanterare satte status active eller startdatum och inga tillfällen
// skapades – bara testdatat gjorde det. Här startar huvudcoachen, samordnaren eller avtalsansvarig insatsen efter första
// mötet: startdatum, status, tillfällen enligt veckoplanen, statushistorik och logg.
const START_ROLES: readonly Role[] = ["coach", "samordnare", "avtalsansvarig"];
const NO_START = "Insatsen kan startas när avropet är accepterat.";
const toActivity = (ctx: Ctx, caseId: string, r: PlannedActivity): Activity => ({ id: ctx.newId("a"), caseId, kind: r.kind, startsAt: r.startsAt, durationMin: r.durationMin, location: r.location, note: "" });
/** Planen i loggen: bara dag, tid och typ – inga personuppgifter. */
const planKeys = (plan: readonly WeekPlanRow[]) => plan.map((r) => `${WEEKDAYS[r.weekday]} ${r.time} ${r.kind}`);
const isPlanKind = (k: string) => (WEEK_PLAN_KINDS as readonly string[]).includes(k);

handleCommand(caseStart, { roles: START_ROLES }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  if (c.status === "active" || c.status === "paused") return fail("wrong_status", "Insatsen har redan startat.");
  if (c.status !== "confirmed") return fail("wrong_status", NO_START);
  if (!c.firstMeetingAt) return fail("no_meeting", "Boka första mötet innan insatsen startar.");
  const meetingDay = dayOf(c.firstMeetingAt);
  if (p.startDate < meetingDay) return fail("start_date", `Startdatumet kan inte vara före första mötet ${fmtDate(meetingDay)}.`);
  const end = c.plannedEnd;
  if (!end || end < p.startDate) return fail("no_end", "Ärendet saknar ett planerat slut efter startdatumet. Rätta omfattningen i beställningen först.");
  const plan = normalizePlan(p.plan);
  if (!plan.length) return fail("plan", "Välj minst en dag i veckoplanen.");
  const rows = planActivities(plan, p.startDate, end, { pausedWeeks: c.pausedWeeks });
  const acts = ctx.repo.table("activities");
  for (const r of rows) await acts.insert(toActivity(ctx, c.id, r));
  const meet = plan.find((r) => r.kind === "möte");
  await ctx.repo.table("cases").update(c.id, {
    status: "active", startDate: p.startDate, meetingDay: meet?.weekday ?? c.meetingDay, meetingTime: meet?.time ?? c.meetingTime,
    phase: c.phase || 1, phaseSince: c.phaseSince ?? p.startDate,
  });
  await addHistory(ctx, { caseId: c.id, fromStatus: c.status, toStatus: "active", toCoach: c.leadCoachId, reason: "Insatsen startad" });
  await ctx.audit({ action: "case.started", entity: "case", entityId: c.id, contractId: c.contractId, details: { startDate: p.startDate, plannedEnd: end, activities: rows.length, plan: planKeys(plan) } });
  return ok({ activities: rows.length, firstActivityAt: rows[0]?.startsAt ?? null });
});

handleCommand(caseScheduleChange, { roles: START_ROLES }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  if (c.status !== "active" && c.status !== "paused") return fail("wrong_status", "Veckoplanen kan ändras när insatsen pågår.");
  const now = ctx.now();
  const today = dayOf(now);
  const end = c.endDate ?? c.plannedEnd;
  if (!end || end < today) return fail("no_end", "Insatsens planerade slut har passerat – inga nya tillfällen kan planeras.");
  const plan = normalizePlan(p.plan);
  if (!plan.length) return fail("plan", "Välj minst en dag i veckoplanen.");
  const acts = ctx.repo.table("activities");
  const existing = await acts.list({ caseId: c.id });
  const registered = new Set((await ctx.repo.table("attendance").list({ caseId: c.id })).map((a) => a.activityId));
  // Framtida tillfällen utan närvaro ersätts. Praktikdagar hör till praktiken och rörs bara om planen själv har praktikdagar.
  const replacesPractice = plan.some((r) => r.kind === "praktikdag");
  const removable = existing.filter((a) => a.startsAt >= now && !registered.has(a.id) && isPlanKind(a.kind) && (a.kind !== "praktikdag" || replacesPractice));
  for (const a of removable) await acts.remove(a.id);
  const kept = new Set(existing.filter((a) => !removable.includes(a)).map((a) => `${a.startsAt}|${a.kind}`));
  const from = c.startDate && c.startDate > today ? c.startDate : today;
  const rows = planActivities(plan, from, end, { pausedWeeks: c.pausedWeeks, notBefore: now }).filter((r) => !kept.has(`${r.startsAt}|${r.kind}`));
  for (const r of rows) await acts.insert(toActivity(ctx, c.id, r));
  const meet = plan.find((r) => r.kind === "möte");
  if (meet) await ctx.repo.table("cases").update(c.id, { meetingDay: meet.weekday, meetingTime: meet.time });
  await ctx.audit({ action: "case.schedule_changed", entity: "case", entityId: c.id, contractId: c.contractId, details: { removed: removable.length, added: rows.length, plan: planKeys(plan) } });
  return ok({ removed: removable.length, added: rows.length });
});

handleCommand(activityAdd, { roles: CASE_WORKERS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (c.status !== "active" && c.status !== "paused") return fail("wrong_status", "Tillfällen kan läggas till när insatsen pågår.");
  if (c.startDate && dayOf(p.startsAt) < c.startDate) return fail("date", `Tillfället kan inte ligga före startdatumet ${fmtDate(c.startDate)}.`);
  if (await ctx.repo.table("activities").first({ caseId: c.id, startsAt: p.startsAt, kind: p.kind })) return fail("duplicate", "Det finns redan ett sådant tillfälle vid den tiden.");
  const id = ctx.newId("a");
  // Skrivningen går via behörigheten: handledaren bara i sina teamärenden (policyn/RLS för activities).
  await ctx.repo.table("activities").insert({ id, caseId: c.id, kind: p.kind, startsAt: p.startsAt, durationMin: p.durationMin, location: p.location.trim(), note: "" });
  await ctx.audit({ action: "activity.added", entity: "activity", entityId: id, contractId: c.contractId, details: { caseId: c.id, kind: p.kind, startsAt: p.startsAt } });
  return ok({ activityId: id });
});

handleCommand(activityRemove, { roles: CASE_WORKERS }, async (ctx, p) => {
  const a = await ctx.repo.table("activities").get(p.activityId);
  if (!a) return fail("not_found", "Tillfället finns inte, eller så har du inte behörighet att se det.");
  const c = await ctx.repo.table("cases").get(a.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (await ctx.repo.table("attendance").first({ activityId: a.id })) return fail("has_attendance", "Tillfället har registrerad närvaro och kan inte tas bort.");
  await ctx.repo.table("activities").remove(a.id);
  await ctx.audit({ action: "activity.removed", entity: "activity", entityId: a.id, contractId: c.contractId, details: { caseId: c.id, kind: a.kind, startsAt: a.startsAt } });
  return ok({});
});

handleCommand(caseSetTeam, { roles: MANAGERS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  if (c.status === "closed" || c.status === "declined") return fail("wrong_status", "Teamet kan inte ändras i ett avslutat ärende.");
  const wanted = new Map<string, TeamRole>();
  for (const t of p.team) {
    // Huvudcoachen byts bara med Byt huvudcoach (orsak, historik och notis till kommunen).
    if (t.role === "lead_coach" || t.userId === c.leadCoachId) continue;
    if (wanted.has(t.userId)) return fail("team", "Samma person kan bara ha en roll i teamet.");
    if (!(await canHaveTeamRole(ctx, t.userId, c.contractId, t.role))) return fail("team", "Välj teammedlemmar bland Miljonbemannings personal i avtalet.");
    wanted.set(t.userId, t.role);
  }
  const teamTable = ctx.repo.table("case_team");
  const current = await teamTable.list({ caseId: c.id });
  const currentRole = new Map(current.map((t) => [t.userId, t.role]));
  const removed: string[] = [];
  const added: { userId: string; role: TeamRole }[] = [];
  for (const t of current) {
    if (t.role === "lead_coach" || wanted.get(t.userId) === t.role) continue;
    await teamTable.remove(t.id);
    if (!wanted.has(t.userId)) removed.push(t.userId);
  }
  for (const [userId, role] of wanted) {
    if (currentRole.get(userId) === role) continue;
    await teamTable.insert({ id: `${c.id}:${userId}`, caseId: c.id, userId, role });
    added.push({ userId, role });
  }
  await ctx.audit({ action: "case.team_changed", entity: "case", entityId: c.id, contractId: c.contractId, details: { added: added.map((a) => `${a.userId}:${a.role}`), removed } });
  // Nya medlemmar får samma notis som vid accept (bara ärendenummer). Den som bara bytt roll får ingen ny notis.
  const newUsers = added.filter((a) => !currentRole.has(a.userId));
  if (newUsers.length) {
    const { contract } = await contractOf(ctx, c.contractId);
    const settings = await orgSettingsFor(ctx, contract);
    for (const a of newUsers) await notifyAssignment(ctx, c, a.userId, a.role, settings);
  }
  return ok({ added: added.length, removed: removed.length });
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
  // Utkast till slutrapport (SPEC §7.8). Förfallotiden är preliminär så länge avtalets regel är ATT_FASTSTÄLLA. Ett ärende som
  // avslutas innan det startade (deltagaren kom aldrig) har inget startdatum – perioden är då avslutsdagen (fynd 5, 2026-10-08).
  const rep = newReport({
    id: ctx.newId("rep"), contractId: c.contractId, caseId: c.id, kind: "final", periodStart: c.startDate ?? p.endDate, periodEnd: p.endDate, status: "draft",
    dueAt: finalReportDueAt(cfg, p.endDate), provisionalDue: isProvisionalDue(cfg, "final"),
  });
  await ctx.repo.table("reports").insert(rep);
  // Exit-pulsmätning – aldrig vid skyddade personuppgifter (vilande spärr sedan 2026-10-07, inga SMS eller mejl till deltagaren).
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
  { roles: ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin", "kommun_handlaggare"], silent: true },
  async (ctx, p) => {
    const c = await ctx.repo.table("cases").get(p.caseId);
    if (!c) return fail("not_found", NOT_FOUND);
    const me = ctx.actor.userId;
    // Läskvitto bara från den som arbetar i ärendet eller beställande handläggare. Chef och admin läser utan kvitto.
    const marks = CASE_WORKERS.includes(ctx.actor.role) || (ctx.actor.role === "kommun_handlaggare" && c.referrerId === me);
    if (!marks) return ok({ marked: 0 });
    const now = ctx.now();
    let marked = 0;
    // Ett meddelande (texten fälldes ut i tidslinjen) eller alla i ärendet (fliken Meddelanden).
    for (const m of await ctx.repo.table("messages").list({ caseId: c.id, ...(p.messageId ? { id: p.messageId } : {}) })) {
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
  // Skyddade personuppgifter (vilande spärr sedan 2026-10-07): ingen inspelning och ingen AI – samtycke kan inte registreras.
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

// ================================================================ Skärmarna (prototypens views/arenden.js)
// Frågorna läser via ctx.repo (policyn/RLS avgör vad rollen ser). ctx.system används bara för uppslag som behörigheten
// bygger på (samma som policyns security definer-uppslag: skyddad person, team, handläggarens enhet, avtalets synlighet)
// och för att se om ett ärende finns när rollen saknar åtkomst (så att nekade försök kan loggas). Inga personuppgifter
// lämnas ut via ctx.system.

/** Rollerna som når ärendelistan och deltagarkortet (prototypens CASE_ROLES). */
const CASE_ROLES: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin"];
/** Chef och systemadmin läser bara. */
const READ_ONLY: readonly Role[] = ["chef", "admin"];
/** Flaggor som coach och handledare aldrig ser (eskaleringar till chef, lågt pulsbetyg). */
const HIDE_FOR_TEAM: readonly AlertKind[] = ["no_progress_escalated", "pulse_low"];
const SEV_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
/** Händelser som räknas som arbetsgivarkontakter (prototypens CONTACT_KINDS). */
const CONTACT_KINDS: readonly OutcomeEventKind[] = ["intervju_arbetsgivarkontakt", "arbetserbjudande", "praktik_startad", "arbete_paborjat"];
const FOUR_LABEL: [keyof FourRights, string][] = [["uppgift", "Arbetsuppgifter"], ["handledning", "Handledning"], ["timing", "Tidpunkt"], ["uppfoljning", "Uppföljning"]];
/** Revisionsloggens rena visningar – egna visningar är brus i coachens logg. */
const VIEW_ACTIONS = ["case.view", "case.view_denied", "report.view", "transcript.view", "voice_note.view"];

const isManager = (role: Role) => role === "samordnare" || role === "avtalsansvarig";
const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const clip = (s: string | null | undefined, n = 90) => (!s ? "" : s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Datum utan år om det är innevarande år (prototypens fd). */
const fd = (s: string | null | undefined, today: string) => (!s ? "–" : String(s).slice(0, 4) === today.slice(0, 4) ? fmtDateShort(s) : fmtDate(s));
const summary = (s: AttendanceStats): AttendanceSummary => ({
  planned: s.planned, present: s.present, late: s.late, absentValid: s.absentValid, absentInvalid: s.absentInvalid, unregistered: s.unregistered, rate: s.rate,
});
/** Namnet för rollen (displayName). Den vilande nivån restricted ger "–" – den visas aldrig i gränssnittet. */
const nameFor = (c: Case, person: Pick<Person, "firstName" | "lastName"> | null | undefined, access: ReturnType<typeof caseAccessIn>) =>
  access === "restricted" ? "–" : displayName(c, person, access);
const activityView = (a: Activity) => ({ id: a.id, kind: a.kind, startsAt: a.startsAt, location: a.location });
/** De fyra senaste hela ISO-veckorna (prototypens last4Weeks). */
function last4Weeks(today: string) {
  const from = addDays(monday(today), -28);
  const to = addDays(monday(today), -1);
  return { from, to, label: `v. ${isoWeek(from).week}–${isoWeek(to).week}` };
}

/** Avtalets driftkonfiguration och domänmiljön (klocka, interna regler). */
async function envFor(ctx: Ctx, contractId: string): Promise<{ contract: Contract; cfg: OperationalConfig; env: DomainEnv }> {
  const { contract, cfg } = await contractOf(ctx, contractId);
  return { contract, cfg, env: domainEnv(contract, await orgSettingsFor(ctx, contract), ctx.now()) };
}

/**
 * Uppslagen som behörigheten bygger på för ärendena (skyddad person, team, handläggarens enhet, avtalets synlighet).
 * ctx.system: samma uppslag som policyn gör utan filter (security definer i Postgres). Bara flaggor och id:n används.
 */
async function accessSourceFor(ctx: Ctx, cases: readonly Pick<Case, "id" | "personId" | "referrerId" | "contractId">[]): Promise<AccessSource> {
  const personIds = [...new Set(cases.map((c) => c.personId))];
  const caseIds = cases.map((c) => c.id);
  const referrerIds = [...new Set(cases.map((c) => c.referrerId).filter((x): x is string => !!x))];
  const contractIds = [...new Set(cases.map((c) => c.contractId))];
  const [persons, team, profiles, contracts] = await Promise.all([
    personIds.length ? ctx.system.table("persons").list({ id: { in: personIds } }) : [],
    caseIds.length ? ctx.system.table("case_team").list({ caseId: { in: caseIds } }) : [],
    referrerIds.length ? ctx.system.table("profiles").list({ id: { in: referrerIds } }) : [],
    contractIds.length ? ctx.system.table("contracts").list({ id: { in: contractIds } }) : [],
  ]);
  // Bara flaggan för skyddade personuppgifter, teamets id:n, handläggarens enhet och avtalets konfiguration används.
  const prot = new Map(persons.map((p) => [p.id, p.protectedIdentity]));
  const teamIds = groupedBy(team, "caseId", (t) => t.caseId);
  const profs = byId(profiles);
  const ks = byId(contracts);
  return {
    person: (id) => (prot.has(id) ? { protectedIdentity: !!prot.get(id) } : undefined),
    teamUserIds: (caseId) => (teamIds.get(caseId) ?? []).map((t) => t.userId),
    profile: (id) => profs.get(id),
    contract: (id) => ks.get(id),
  };
}

/** Flaggor för rollen (prototypens alertsFor): coach och handledare ser aldrig eskaleringar till chef. */
function flagsFor(db: AlertDb, ctx: Ctx, env: DomainEnv): AlertItem[] {
  const role = ctx.actor.role;
  // Begränsade testare: inga flaggor om ofakturerat (belopp) eller interna mål (src/api/tester-access.ts).
  const xs = alerts(db, { role, personaId: ctx.actor.userId, hideCommercial: hidesCommercial(ctx.actor) }, env);
  return role === "coach" || role === "handledare" ? xs.filter((a) => !HIDE_FOR_TEAM.includes(a.kind)) : xs;
}
/**
 * "Fastnat i fas n" i kortets huvud, med kvitteringen från Min vecka eller listan (alert_acks, samma nyckel som flaggan:
 * stuck:<ärende>:<fas>). Utan kvitteringen såg det ut som att kvitteringen inte tog: flaggraden försvann men taggen stod kvar.
 */
function stuckWithAck(c: Case, db: Pick<Db, "check_ins" | "placements" | "alert_acks" | "profiles">, env: DomainEnv): CaseCard["stuck"] {
  const s = stuck(c, db, env);
  if (!s) return null;
  const ack = db.alert_acks.find((a) => a.alertKey === `stuck:${c.id}:${c.phase}`) ?? null;
  return { ...s, acked: ack ? { byName: personName(db.profiles, ack.acknowledgedBy), at: ack.acknowledgedAt } : null };
}
function flagView(a: AlertItem, caseId: string | null): CaseFlag {
  const same = caseId && a.link.view === "arende.kort" && a.link.params.caseId === caseId ? { tab: a.link.params.tab ?? null } : null;
  return { key: a.key, kind: a.kind, severity: a.severity, title: a.title, text: a.text, href: a.href, sameCase: same, view: a.link.view };
}

/** Kunder (kommunens användare) – meddelanden från dem räknas som "från kommunen". */
async function customerUserIds(ctx: Ctx): Promise<Set<string>> {
  const [orgs, profiles] = await Promise.all([ctx.repo.table("organizations").list({ kind: "customer" }), ctx.repo.table("profiles").list()]);
  const ids = new Set(orgs.map((o) => o.id));
  return new Set(profiles.filter((p) => ids.has(p.organizationId)).map((p) => p.id));
}

/** Olästa meddelanden från kommunen till den inloggade (chef och systemadmin markerar inget som läst). */
function unreadCount(msgs: readonly Message[], role: Role, me: string, fromCustomer: Set<string>): number {
  if (READ_ONLY.includes(role)) return 0;
  return msgs.filter((m) => fromCustomer.has(m.senderId) && !m.readBy.includes(me)).length;
}

/** Deltagarens personnummer som det skrevs, via ctx.crypto (minnesläget: testdatats ersättning, servern: AES-256-GCM). */
function decodePnr(crypto: PnrCrypto, p: Pick<Person, "personnummerEnc">): string {
  return revealPnr(crypto, p);
}
/** Maskerat personnummer som prototypens MaskedPnr: "••••••••-9545" (bara de fyra sista siffrorna syns). */
function maskedPnr(crypto: PnrCrypto, p: Pick<Person, "personnummerEnc" | "personnummerLast4">): string | null {
  if (!p.personnummerEnc && !p.personnummerLast4) return null;
  const pnr = decodePnr(crypto, p);
  if (!pnr) return `••••••••-${p.personnummerLast4}`;
  return `${pnr.slice(0, pnr.length - 4).replace(/\d/g, "•")}${p.personnummerLast4}`;
}

/** "inom en vecka från beställningen" (avtalets tidsgräns för första mötet). */
function firstMeetingText(cfg: OperationalConfig): string {
  const days = firstMeetingDays(cfg);
  if (!days) return "så snart som möjligt efter beställningen";
  const t = days % 7 === 0 ? (days === 7 ? "en vecka" : `${days / 7} veckor`) : `${days} dagar`;
  return `inom ${t} från beställningen`;
}

type Loaded = {
  c: Case;
  access: "full" | "team";
  cfg: OperationalConfig;
  env: DomainEnv;
  contract: Contract;
  today: string;
  role: Role;
  me: string;
  team: boolean;
  edit: boolean;
};

/** Ärendet med rollens åtkomst. null = finns inte, rollen saknar åtkomst eller fliken visas inte för rollen. */
async function loadCase(ctx: Ctx, caseId: string, tab?: CaseTab): Promise<Loaded | null> {
  const c = await ctx.repo.table("cases").get(caseId);
  if (!c) return null;
  const access = caseAccessIn(c, ctx.actor, await accessSourceFor(ctx, [c]));
  if (access !== "full" && access !== "team") return null;
  const team = access === "team";
  if (tab && team && !(TEAM_TABS as readonly string[]).includes(tab)) return null;
  const { contract, cfg, env } = await envFor(ctx, c.contractId);
  const role = ctx.actor.role;
  const me = ctx.actor.userId;
  const edit = access === "full" && (isManager(role) || (role === "coach" && c.leadCoachId === me));
  return { c, access, cfg, env, contract, today: dayOf(env.now), role, me, team, edit };
}

/** Tabeller för flaggorna (prototypens sel.alerts). */
const ALERT_TABLES = [
  "cases", "activities", "attendance", "check_ins", "placements", "reports", "price_items", "buyer_references", "invoice_drafts", "invoice_lines", "billing_runs",
  "billing_week_approvals", "pulse_responses", "inbound_emails", "alert_acks", "profiles",
] as const;

// ---------------------------------------------------------------- arenden.lista
handleQuery(caseList, { roles: CASE_ROLES }, async (ctx): Promise<CaseListModel> => {
  const role = ctx.actor.role;
  const me = ctx.actor.userId;
  const db = await loadDb(ctx.repo, [...ALERT_TABLES, "memberships", "contract_areas", "messages", "persons"]);
  const src = await accessSourceFor(ctx, db.cases);
  const fromCustomer = await customerUserIds(ctx);
  const contracts = (await ctx.repo.table("contracts").list()).filter((x) => x.status === "active" && isOperational(x.config));
  const main = contracts.find((x) => ctx.actor.contractIds.includes(x.id)) ?? contracts[0];
  const today = dayOf(ctx.now());
  const w4 = last4Weeks(today);

  // Flaggor per avtal (varje avtal har sin konfiguration).
  const flagsByCase = new Map<string, AlertItem[]>();
  const envs = new Map<string, DomainEnv>();
  for (const k of contracts) {
    if (!db.cases.some((c) => c.contractId === k.id)) continue;
    const { env } = await envFor(ctx, k.id);
    envs.set(k.id, env);
    for (const a of flagsFor(scopeToContract(db, k.id), ctx, env)) {
      if (!a.caseId) continue;
      const l = flagsByCase.get(a.caseId);
      if (l) l.push(a);
      else flagsByCase.set(a.caseId, [a]);
    }
  }
  const persons = byId(db.persons);
  const msgsByCase = groupedBy(db.messages, "caseId", (m) => m.caseId);

  // Vilande spärr (skyddade personuppgifter, beslut 2026-10-07): ett ärende med nivån restricted visas inte alls (fail-closed).
  const listed = db.cases.filter((c) => caseAccessIn(c, ctx.actor, src) !== "restricted");
  const rows: CaseListRow[] = listed.map((c) => {
    const access = caseAccessIn(c, ctx.actor, src);
    const person = persons.get(c.personId) ?? null;
    const flags = flagsByCase.get(c.id) ?? [];
    const closed = c.status === "closed" || c.status === "declined";
    const base = {
      id: c.id, caseNumber: c.caseNumber, status: c.status, referredAt: c.referredAt, endSortKey: closed ? "z" : c.plannedEnd || "y",
      displayName: displayName(c, person, access), flagged: flags.length > 0,
      flagRank: Math.min(9, ...flags.map((a) => SEV_RANK[a.severity] ?? 9)),
    };
    const env = envs.get(c.contractId);
    const cfg = env?.cfg;
    const latest = latestCheckIn(db, c.id);
    return {
      ...base,
      detail: {
        areaCode: c.primaryAreaCode, areaName: areaName(db.contract_areas.filter((a) => a.contractId === c.contractId), c.primaryAreaCode), vocationalTrack: c.vocationalTrack,
        phase: c.phase, phaseName: cfg ? phaseName(cfg, c.phase) : "", leadCoachId: c.leadCoachId, leadCoachName: c.leadCoachId ? personName(db.profiles, c.leadCoachId) : null,
        start: c.startDate || c.firstMeetingAt || c.desiredStart, startNote: c.startDate ? null : c.firstMeetingAt ? "planerad start" : "önskad start",
        end: c.endDate || c.plannedEnd,
        latest: latest ? { overallStatus: latest.overallStatus, heldAt: latest.heldAt } : null,
        attendance: summary(attendanceStats(db, c.id, w4.from, w4.to, { now: ctx.now() })),
        flags: flags.map((a) => flagView(a, c.id)),
        unread: access === "full" ? unreadCount(msgsByCase.get(c.id) ?? [], role, me, fromCustomer) : 0,
      },
    };
  });

  const cfg = main && isOperational(main.config) ? main.config : null;
  const customer = main ? await ctx.repo.table("organizations").get(main.customerId) : null;
  return {
    customerName: customer?.name ?? "",
    today,
    weeks: w4,
    coaches: main ? coaches(db, main.id).map((u) => ({ id: u.id, name: u.fullName })) : [],
    areas: db.contract_areas.filter((a) => a.contractId === main?.id).map((a) => ({ code: a.code, name: a.name })),
    phases: cfg ? cfg.phases.map((p) => ({ no: p.no, name: p.name })) : [],
    rows,
  };
});

// ---------------------------------------------------------------- arenden.kort (huvudet och det som delas av flikarna)
handleQuery(caseCard, { roles: CASE_ROLES }, async (ctx, p): Promise<CaseCardResult> => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) {
    // ctx.system: finns ärendet? Bara ja eller nej – så att "Du saknar åtkomst" kan visas och försöket loggas.
    const exists = await ctx.system.table("cases").get(p.caseId);
    return exists ? { kind: "denied" } : { kind: "not_found" };
  }
  const src = await accessSourceFor(ctx, [c]);
  const access = caseAccessIn(c, ctx.actor, src);
  // restricted (vilande spärr för skyddade personuppgifter) behandlas som ingen åtkomst.
  if (access !== "full" && access !== "team") return { kind: "denied" };
  const L = (await loadCase(ctx, c.id))!;
  const { cfg, env, role, me, team, edit } = L;
  const now = env.now;
  const byCase = { caseId: c.id };
  const db = await loadDb(ctx.repo, [...ALERT_TABLES, "case_team", "messages", "deviations", "consents", "contract_areas", "memberships"], {
    // Fakturorna gäller hela avtalet och månaden (beslut 2026-10-07) – ärendets rader finns i invoice_lines.
    activities: byCase, attendance: byCase, check_ins: byCase, placements: byCase, reports: byCase, invoice_drafts: { contractId: c.contractId }, invoice_lines: byCase,
    billing_week_approvals: byCase,
    pulse_responses: byCase, inbound_emails: byCase, case_team: byCase, messages: byCase, deviations: byCase, consents: byCase,
  });
  // Flaggor för ärendet: bara ärendets rader behövs (flaggorna per ärende räknas på ärendets egna data).
  const caseDb = { ...db, cases: db.cases.filter((x) => x.id === c.id) };
  const flags = flagsFor(caseDb, ctx, env).filter((a) => a.caseId === c.id).map((a) => flagView(a, c.id));
  const person = await ctx.repo.table("persons").get(c.personId);
  const areas = db.contract_areas.filter((a) => a.contractId === c.contractId);
  const referrerProfile = c.referrerId ? db.profiles.find((x) => x.id === c.referrerId) ?? null : null;
  const teamRows = db.case_team.filter((t) => t.caseId === c.id);
  const fromCustomer = await customerUserIds(ctx);
  const cons = consentOf(db, c.id);
  const due = firstMeetingDue(c, cfg);
  const active = c.status !== "closed" && c.status !== "declined";
  const manage = isManager(role) && access === "full";

  // Kommunens roll för perspektivbytet (bara prototypen): beställande handläggare om hon är prototypens handläggare.
  // ctx.system: bara medlemskap och enhet för prototypens testpersoner.
  let customerRole: CaseCard["customerRole"] = null;
  for (const def of PROTOTYPE_ROLES.filter((r) => r.key === "kommun_handlaggare")) {
    if (!def.personaId) continue;
    const ms = await ctx.system.table("memberships").list({ userId: def.personaId, role: def.key });
    if (!ms.length) continue;
    // Enheten bara från medlemskapet (som actorFor i src/data/actors.ts) – profilens enhet skriver handläggaren själv.
    const actor = { userId: def.personaId, role: def.key, contractIds: ms.map((m) => m.contractId), customerUnit: ms[0].customerUnit ?? null };
    if (caseAccessIn(c, actor, src) === "customer") {
      customerRole = "kommun_handlaggare";
      break;
    }
  }

  const lead = teamRows.find((t) => t.role === "lead_coach");
  const myTeam = teamRows.find((t) => t.userId === me);
  return {
    kind: "ok",
    now,
    caseId: c.id,
    caseNumber: c.caseNumber,
    displayName: displayName(c, person, access),
    access,
    edit,
    manage,
    readOnly: READ_ONLY.includes(role),
    status: c.status,
    phase: c.phase,
    phaseName: phaseName(cfg, c.phase),
    phaseCount: cfg.phases.length,
    phaseSince: c.startDate && c.status === "active" ? phaseSince(c, db) : null,
    stuck: stuckWithAck(c, db, env),
    areaName: areaName(areas, c.primaryAreaCode),
    secondaryAreaName: c.secondaryAreaCode ? areaName(areas, c.secondaryAreaCode) : null,
    vocationalTrack: c.vocationalTrack,
    referredAt: c.referredAt,
    sourceText: SOURCE_TEXT[c.source] ?? c.source,
    startDate: c.startDate,
    firstMeetingAt: c.firstMeetingAt,
    plannedEnd: c.plannedEnd,
    endDate: c.endDate,
    endReasonLabel: c.endReason ? endReasonLabel(c.endReason) : null,
    resultPrelim: c.resultClass === "result" && !c.resultVerifiedAt,
    // Omfattningen i veckor – inget pris och inget ordervärde (synpunkt #10/#11 och beslut 5, 2026-10-07).
    order: team ? null : { weeks: c.orderValueWeeks || c.plannedWeeks },
    pnr: person ? { masked: maskedPnr(ctx.crypto, person), canReveal: access === "full", hidden: false } : { masked: null, canReveal: false, hidden: true },
    contactText: contactLabel(person?.preferredContact ?? ""),
    contactLabel: !person ? null : contactLabel(person.preferredContact),
    languageText: `${cap(person?.language) || "Framgår inte"}${person?.needsInterpreter ? " · behöver tolk" : ""}`,
    language: person?.language ?? "",
    accessibilityNeeds: person?.accessibilityNeeds || "Inga behov angivna",
    referrer: referrerProfile
      ? { name: referrerProfile.fullName, title: referrerProfile.title, unit: referrerProfile.customerUnit ?? "", email: referrerProfile.email }
      : c.referrerName ? { name: c.referrerName, title: "", unit: c.referrerUnit ?? "", email: c.referrerEmail ?? "" } : null,
    buyer: team ? null : {
      reference: c.buyerReference,
      problem: c.buyerReference ? buyerRefProblem(c, db, cfg) : null,
      purchaseOrderNumber: c.purchaseOrderNumber,
    },
    leadCoach: c.leadCoachId ? { id: c.leadCoachId, name: personName(db.profiles, c.leadCoachId) } : null,
    team: teamRows.filter((t) => t.role !== "lead_coach").map((t) => ({ userId: t.userId, name: personName(db.profiles, t.userId), role: t.role, roleLabel: teamLabel(t.role) })),
    hasLeadInTeam: !!lead,
    myTeamRoleLabel: team ? teamLabel(myTeam?.role ?? "") : null,
    location: c.location,
    flags,
    unread: READ_ONLY.includes(role) || team ? 0 : unreadCount(db.messages, role, me, fromCustomer),
    openDeviations: db.deviations.filter((x) => x.status === "open").length,
    consent: team ? null : {
      value: c.aiConsentStatus === "not_applicable" ? "not_asked" : c.aiConsentStatus || "not_asked",
      givenAt: cons?.givenAt ?? null,
      informedByName: cons ? personName(db.profiles, cons.informedBy) : null,
      textVersion: cons?.textVersion ?? null,
      language: cons?.language ?? null,
      revokedAt: cons?.revokedAt ?? null,
    },
    firstMeeting: { dueAt: due, sla: due ? pickSla(slaStatus(due, null, env)) : null, withinText: firstMeetingText(cfg) },
    keyPersonnelChangeRequiresApproval: !!cfg.keyPersonnelChangeRequiresApproval,
    customerSeesCoachNotes: cfg.customerVisibility.seesCoachNotes !== false,
    customerRole,
    // Bakgrunden från beställningen och bilagorna: bara med full åtkomst (bilagorna läses via behörigheten – chef och admin ser inga).
    background: access === "full" ? await caseBackground(ctx, c) : null,
    coachOptions: manage && active && c.leadCoachId
      ? await coachOptionsFor(ctx, c)
      : [],
    // Starta insatsen (beslut 2026-10-08): bekräftat ärende med bokat första möte – standardplanen ur avtalet.
    start: edit && c.status === "confirmed" && c.firstMeetingAt
      ? { firstMeetingAt: c.firstMeetingAt, startDate: dayOf(c.firstMeetingAt), plan: defaultWeekPlan(cfg, c.firstMeetingAt) }
      : null,
    weekPlan: edit && (c.status === "active" || c.status === "paused") ? currentWeekPlan(db.activities, dayOf(now), cfg, c) : null,
    teamOptions: manage && active ? await teamOptionsFor(ctx, c) : null,
  };
});

/** Den gällande veckoplanen: ur kommande tillfällen, annars avtalets standard. */
function currentWeekPlan(acts: readonly Activity[], today: string, cfg: OperationalConfig, c: Case): WeekPlanRow[] {
  const fromActs = planFromActivities(acts, today);
  return fromActs.length ? fromActs : defaultWeekPlan(cfg, c.firstMeetingAt);
}

/** Kandidater till teamet ur medlemskapens roller (beslut 2026-10-08) – huvudcoachen själv visas inte. */
async function teamOptionsFor(ctx: Ctx, c: Case): Promise<CaseCard["teamOptions"]> {
  const cand = await teamCandidates(ctx, c.contractId);
  const notLead = (u: { id: string }) => u.id !== c.leadCoachId;
  return { supervisors: cand.supervisors.filter(notLead), staff: cand.staff.filter(notLead) };
}

const pickSla = (s: { label: string; tone: SlaTone }) => ({ label: s.label, tone: s.tone });

/** Coacher att byta till med antal aktiva ärenden (prototypens CoachModal). */
async function coachOptionsFor(ctx: Ctx, c: Case): Promise<CaseCard["coachOptions"]> {
  const [profiles, memberships, cases] = await Promise.all([
    ctx.repo.table("profiles").list(), ctx.repo.table("memberships").list({ contractId: c.contractId }), ctx.repo.table("cases").list({ status: "active" }),
  ]);
  return coaches({ profiles, memberships }, c.contractId)
    .filter((u) => u.id !== c.leadCoachId)
    .map((u) => ({ id: u.id, name: u.fullName, active: cases.filter((x) => x.leadCoachId === u.id).length }));
}

// ---------------------------------------------------------------- Flik: Översikt
handleQuery(caseOverview, { roles: CASE_ROLES }, async (ctx, p): Promise<CaseOverview | null> => {
  const L = await loadCase(ctx, p.caseId, "oversikt");
  if (!L) return null;
  const { c, team, today, env } = L;
  const now = env.now;
  const q = { caseId: c.id };
  const db = await loadDb(ctx.repo, ["activities", "attendance", "check_ins", "placements", "employers"], { activities: q, attendance: q, check_ins: q, placements: q });
  const acts = activitiesOf(db, c.id);
  const nm = acts.find((a) => a.kind === "möte" && a.startsAt >= now);
  const nextMeeting = nm
    ? { startsAt: nm.startsAt, first: false, location: nm.location }
    : c.firstMeetingAt && c.firstMeetingAt >= now ? { startsAt: c.firstMeetingAt, first: true, location: `Miljonbemanning ${c.location || ""}`.trim() } : null;
  const lc = team ? null : latestCheckIn(db, c.id);
  const drafts = team ? [] : checkInsOf(db, c.id).filter((x) => x.status === "draft");
  const w4 = last4Weeks(today);
  const limit = `${addDays(today, 14)}T23:59`;
  const pl = placementsOf(db, c.id).find((x) => x.status === "ongoing");
  const emp = pl ? db.employers.find((e) => e.id === pl.employerId) : null;
  return {
    nextMeeting,
    closed: c.status === "closed" || c.status === "declined",
    latest: lc ? { overallStatus: lc.overallStatus, heldAt: lc.heldAt, mode: lc.mode, goalStatus: lc.goalStatus, nextGoal: lc.nextGoal, note: lc.note } : null,
    drafts: { count: drafts.length, ai: drafts.some((x) => !!x.ai) },
    weeksLabel: w4.label,
    attendance: summary(attendanceStats(db, c.id, w4.from, w4.to, env)),
    upcoming: acts.filter((a) => a.startsAt >= now && a.startsAt <= limit && (!team || a.kind !== "möte")).map(activityView),
    placement: pl ? { employerName: emp?.name ?? null, startsOn: pl.startsOn, endsOn: pl.endsOn, supervisorName: pl.supervisorName, fourRights: pl.fourRights ?? null } : null,
  };
});

// ---------------------------------------------------------------- Flik: Kartläggning
handleQuery(caseIntake, { roles: CASE_ROLES }, async (ctx, p): Promise<CaseIntake | null> => {
  const L = await loadCase(ctx, p.caseId, "kartlaggning");
  if (!L) return null;
  const { c, env } = L;
  const q = { caseId: c.id };
  const db = await loadDb(ctx.repo, ["intake_assessments", "check_ins", "placements", "profiles"], { intake_assessments: q, check_ins: q, placements: q });
  const ia = intakeOf(db, c.id);
  return {
    intake: ia ? {
      workExperience: ia.workExperience, education: ia.education, languageNotes: ia.languageNotes, digitalSkills: ia.digitalSkills, drivingLicence: ia.drivingLicence,
      workGoals: ia.workGoals, chosenTrack: ia.chosenTrack, adaptations: ia.adaptations, firstWeekGoal: ia.firstWeekGoal, approved: ia.status === "approved",
      approvedAt: ia.approvedAt, approvedByName: ia.approvedBy ? personName(db.profiles, ia.approvedBy) : null,
    } : null,
    stuck: stuck(c, db, env),
  };
});

// ---------------------------------------------------------------- Flik: Avstämningar
handleQuery(caseCheckIns, { roles: CASE_ROLES }, async (ctx, p) => {
  const L = await loadCase(ctx, p.caseId, "avstamningar");
  if (!L) return null;
  const db = await loadDb(ctx.repo, ["check_ins"], { check_ins: { caseId: L.c.id } });
  return {
    checkIns: checkInsOf(db, L.c.id).map((x) => ({
      id: x.id, heldAt: x.heldAt, mode: x.mode, goalStatus: x.goalStatus, phase: x.phase, overallStatus: x.overallStatus, obstacles: x.obstacles, note: x.note,
      approved: x.status === "approved", ai: !!x.ai,
    })),
  };
});

// ---------------------------------------------------------------- Flik: Närvaro
handleQuery(caseAttendance, { roles: CASE_ROLES }, async (ctx, p): Promise<CaseAttendance | null> => {
  const L = await loadCase(ctx, p.caseId, "narvaro");
  if (!L) return null;
  const { c, today, env, cfg } = L;
  const now = env.now;
  const w4 = last4Weeks(today);
  const reg = slaRule(cfg, "veckorapport_registrering");
  const registerBy = reg?.time ? `${WEEKDAYS[reg.weekday ?? 0]} ${reg.time.replace(":", ".")}` : null;
  if (!c.startDate) {
    const empty = summary(attendanceStats({ activities: [], attendance: [] }, c.id, today, today, env));
    return { started: false, weeks: [], total: { ...empty, reasons: [] }, last4: empty, weeksLabel: w4.label, repeated: null, past: [], upcoming: [], registerBy };
  }
  const q = { caseId: c.id };
  const db = await loadDb(ctx.repo, ["activities", "attendance"], { activities: q, attendance: q });
  const acts = activitiesOf(db, c.id);
  const endDay = c.endDate && c.endDate < today ? c.endDate : today;
  const weeks: CaseAttendanceWeek[] = [];
  for (let mon = monday(c.startDate); mon <= endDay; mon = addDays(mon, 7)) {
    const w = isoWeek(mon);
    const sun = addDays(mon, 6);
    weeks.push({
      key: w.key, paused: c.pausedWeeks.includes(w.key), stats: summary(attendanceStats(db, c.id, mon, sun, env)),
      future: acts.filter((a) => a.startsAt >= now && a.startsAt <= `${sun}T23:59` && a.startsAt >= mon).length,
    });
  }
  weeks.reverse();
  const total = attendanceStats(db, c.id, c.startDate, endDay, env);
  const rep = repeatedAbsence(db, c.id, env);
  const rule = cfg.attendance.repeatedAbsenceRule;
  return {
    started: true,
    weeks,
    total: { ...summary(total), reasons: Object.entries(total.reasons) },
    last4: summary(attendanceStats(db, c.id, w4.from, w4.to, env)),
    weeksLabel: w4.label,
    repeated: rep ? { dates: rep.map((x) => x.registeredAt), absentInvalid: rule.absentInvalid, withinDays: rule.withinDays } : null,
    past: acts.filter((a) => a.startsAt < now).slice(-10).reverse().map((a) => {
      const at = attendanceFor(db, a.id);
      return { ...activityView(a), attendance: at ? { status: at.status, reason: at.reason } : null };
    }),
    upcoming: acts.filter((a) => a.startsAt >= now).slice(0, 10).map((a) => ({ ...activityView(a), durationMin: a.durationMin })),
    registerBy,
  };
});

// ---------------------------------------------------------------- Flik: Tidslinje (rapporter steg 2)
// Läser bara via ctx.repo och bara de tabeller som rollens åtkomst ska visa: teamet läser inte avstämningar, bedömningar,
// avvikelser, rapporter, samtycken eller meddelanden alls. Ingen ctx.system. Domänfunktionen: timeline.ts.
handleQuery(caseTimeline, { roles: CASE_ROLES }, async (ctx, p): Promise<CaseTimeline | null> => {
  const L = await loadCase(ctx, p.caseId, "tidslinje");
  if (!L) return null;
  const { c, cfg, env, team, role, me, access } = L;
  const q = { caseId: c.id };
  const base = await loadDb(ctx.repo, ["persons", "activities", "attendance", "outcome_events", "placements", "employers", "case_status_history", "case_notes", "profiles"], {
    persons: { id: c.personId }, activities: q, attendance: q, outcome_events: q, placements: q, case_status_history: q, case_notes: q,
  });
  const fullDb = team
    ? { check_ins: [], intake_assessments: [], monthly_assessments: [], deviations: [], consents: [], reports: [], messages: [], organizations: [] }
    : await loadDb(ctx.repo, ["check_ins", "intake_assessments", "monthly_assessments", "deviations", "consents", "reports", "messages", "organizations"], {
        check_ins: q, intake_assessments: q, monthly_assessments: q, deviations: q, consents: q, reports: q, messages: q, organizations: { kind: "customer" },
      });
  return buildTimeline({ cases: [c], ...base, ...fullDb }, { caseId: c.id, viewer: { access, role, userId: me }, cfg, now: env.now, visa: p.visa, fore: p.fore });
});

// ---------------------------------------------------------------- Fria anteckningar (case_notes)
const NOTE_NOT_FOUND = "Anteckningen finns inte, eller så har du inte behörighet att se den.";
/** Skriver anteckningar: den som arbetar i ärendet. Chef och systemadministratör läser bara. */
const NOTE_WRITERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare"];

handleCommand(caseNoteSave, { roles: NOTE_WRITERS }, async (ctx, p) => {
  const L = await loadCase(ctx, p.caseId, "tidslinje");
  if (!L) return fail("not_found", NOT_FOUND);
  const { c, team, today, me } = L;
  // Skyddade personuppgifter: teamet har ingen åtkomst – anteckningen sparas alltid för full åtkomst
  // (bara namngiven huvudcoach och avtalsansvarig).
  const person = await ctx.repo.table("persons").get(c.personId);
  const audience = person?.protectedIdentity ? "full" : p.audience;
  if (team && audience === "full") return fail("forbidden", "Du kan bara skriva anteckningar som hela teamet ser.");
  if (p.occurredOn > today) return fail("date", "Datumet kan inte vara senare än i dag.");
  if (p.occurredOn < dayOf(c.referredAt)) return fail("date", "Datumet kan inte vara före beställningen.");
  if (looksLikePnr(p.body)) return fail("pnr", "Det ser ut som ett personnummer i texten. Ta bort det – ärendenumret räcker.");
  const table = ctx.repo.table("case_notes");
  if (p.noteId) {
    const cur = await table.get(p.noteId);
    if (!cur || cur.caseId !== c.id || cur.removedAt) return fail("not_found", NOTE_NOT_FOUND);
    if (cur.authorId !== me) return fail("not_author", "Bara den som skrev anteckningen kan ändra den.");
    await table.update(cur.id, { occurredOn: p.occurredOn, kind: p.kind, audience, body: p.body, updatedAt: ctx.now() });
    // Revisionsloggen: bara id:n – aldrig texten eller typen.
    await ctx.audit({ action: "case_note.updated", entity: "case_note", entityId: cur.id, contractId: c.contractId, details: { caseId: c.id } });
    return ok({ noteId: cur.id });
  }
  const id = ctx.newId("note");
  await table.insert({
    id, contractId: c.contractId, caseId: c.id, authorId: me, occurredOn: p.occurredOn, kind: p.kind, audience, body: p.body, createdAt: ctx.now(),
    updatedAt: null, removedAt: null, removedBy: null,
  });
  await ctx.audit({ action: "case_note.created", entity: "case_note", entityId: id, contractId: c.contractId, details: { caseId: c.id } });
  return ok({ noteId: id });
});

handleCommand(caseNoteRemove, { roles: NOTE_WRITERS }, async (ctx, p) => {
  const L = await loadCase(ctx, p.caseId, "tidslinje");
  if (!L) return fail("not_found", NOT_FOUND);
  const { c, me, role, access } = L;
  const table = ctx.repo.table("case_notes");
  const cur = await table.get(p.noteId);
  if (!cur || cur.caseId !== c.id || cur.removedAt) return fail("not_found", NOTE_NOT_FOUND);
  // Författaren, och samordnare och avtalsansvarig med full åtkomst i ärendet (beslut 2026-10-01). Inget raderas på riktigt.
  if (cur.authorId !== me && !(isManager(role) && access === "full")) {
    return fail("not_author", "Bara den som skrev anteckningen, samordnaren och avtalsansvarig kan ta bort den.");
  }
  await table.update(cur.id, { removedAt: ctx.now(), removedBy: me });
  // Vem som dolde är loggens aktör. Bara id:n – aldrig texten.
  await ctx.audit({ action: "case_note.removed", entity: "case_note", entityId: cur.id, contractId: c.contractId, details: { caseId: c.id, authorId: cur.authorId } });
  return ok({});
});

// ---------------------------------------------------------------- Flik: Månadsunderlag (rapporter steg 2)
// Samma innehåll som månadsrapporten, byggt med samma funktion (monthlyPreview → buildMonthly) och samma dokument
// (ReportDocView). Underlaget läses via ctx.repo efter loadCase – fliken är bara för full åtkomst, och med dagens data
// (asOf = null) behövs inte revisionsloggen. Ingen ctx.system.
handleQuery(caseMonthBasis, { roles: CASE_ROLES }, async (ctx, p): Promise<CaseMonthBasis | null> => {
  const L = await loadCase(ctx, p.caseId, "manad");
  if (!L) return null;
  const { c, cfg, contract, today, role, me } = L;
  const now = ctx.now();
  const current = monthKey(today);
  const q = { caseId: c.id };
  const db = await loadDb(ctx.repo, [
    "activities", "attendance", "check_ins", "monthly_assessments", "monthly_plans", "outcome_events", "deviations", "tasks", "reports", "case_notes", "contract_areas",
    "profiles", "persons", "organizations",
  ], {
    activities: q, attendance: q, check_ins: q, monthly_assessments: q, monthly_plans: q, outcome_events: q, deviations: q, reports: q, case_notes: q,
    contract_areas: { contractId: c.contractId }, persons: { id: c.personId }, organizations: { id: { in: [contract.customerId, contract.supplierId] } },
  });
  const prog = cfg.progression;
  // Månaderna: från startmånaden till innevarande månad (eller slutmånaden), senaste först.
  const startM = c.startDate ? monthKey(c.startDate) : null;
  const topM = c.endDate && monthKey(c.endDate) < current ? monthKey(c.endDate) : current;
  const monthly = db.reports.filter((r) => r.kind === "monthly" && r.caseId === c.id);
  // Samma läge som tidslinjens månadsrubrik (monthReportState): under en rättelse är den levererade versionen kvar.
  const deliveredOf = (mk: string) => monthReportState(monthly, c.id, mk).delivered;
  const months: CaseMonthOption[] = [];
  if (startM) for (let mk = topM; mk >= startM; mk = addMonths(mk, -1)) months.push({ month: mk, current: mk === current && c.status !== "closed", delivered: !!deliveredOf(mk) });
  const lastMonth = addMonths(current, -1);
  const fallback = enrolledIn(c, lastMonth) ? lastMonth : startM && current > topM ? topM : current;
  const month = p.manad && (months.some((m) => m.month === p.manad) || (startM != null && p.manad < startM) || !startM) ? p.manad : fallback;
  const beforeStart = !startM || month < startM;

  // Progression över tid: bara godkända bedömningar. Rader = de obligatoriska områdena och de valfria som någon gång bedömts.
  const approved = db.monthly_assessments.filter((m) => m.status === "approved").sort(by("month"));
  const optional = prog.optionalAreas.filter((k) => approved.some((m) => m.areas[k]?.level != null));
  const matrix = {
    months: approved.map((m) => m.month),
    rows: [...prog.areas.map((key) => ({ key, optional: false })), ...optional.map((key) => ({ key, optional: true }))].map((r) => ({
      ...r, label: prog.areaLabels[r.key] ?? r.key, levels: approved.map((m) => m.areas[r.key]?.level ?? null),
    })),
    scale: { ...prog.scale } as Record<string, string>,
  };

  const st = monthReportState(monthly, c.id, month);
  const del = beforeStart ? null : st.delivered;
  const pending = del ? st.correction : null;
  const row = st.latest;
  let gaps: CaseMonthBasis["gaps"] = null;
  let doc: CaseMonthBasis["doc"] = null;
  if (!beforeStart && !del) {
    const [customer, supplier] = [db.organizations.find((o) => o.id === contract.customerId), db.organizations.find((o) => o.id === contract.supplierId)];
    const renv: ReportEnv = { cfg, contract: { id: contract.id, startsOn: contract.startsOn, supplierName: supplier?.name ?? "" }, now, activityTypes: ACTIVITY_TYPES };
    const rdb: ReportDb & Pick<Db, "case_notes"> = {
      cases: [c], activities: db.activities, attendance: db.attendance, check_ins: db.check_ins, monthly_assessments: db.monthly_assessments, monthly_plans: db.monthly_plans,
      outcome_events: db.outcome_events, deviations: db.deviations, tasks: db.tasks, audit_log: [], contract_deviations: [], pulse_responses: [], contract_areas: db.contract_areas,
      profiles: db.profiles, price_items: [], reports: [], case_notes: db.case_notes,
    };
    const m = monthlyPreview(rdb, c.id, month, renv);
    gaps = monthlyGaps(rdb, c.id, month, renv);
    if (m) {
      const stub = { id: row?.id ?? `preview:${c.id}:${month}`, status: row?.status ?? "draft", version: row?.version ?? 1, approvedAt: row?.approvedAt ?? null, deliveredAt: null, superseded: false } as const;
      const participant = displayName(c, db.persons[0] ?? null, "full");
      doc = monthlyDocView(docBase(stub, { customerName: customer?.name ?? "", contract }, db.profiles, row?.recipientUserId ?? c.referrerId), participant, m);
    }
  }
  return {
    months, month, beforeStart, matrix,
    missingMonth: c.status === "active" && c.startDate && c.startDate <= monthEnd(lastMonth) && !assessmentFor(db, c.id, lastMonth) ? lastMonth : null,
    gaps, doc,
    delivered: del ? { reportId: del.id, deliveredAt: del.deliveredAt as string, version: del.version || 1, correctionDraft: pending ? pending.version : null } : null,
    reportId: row?.id ?? null,
    canAssess: role === "coach" && c.leadCoachId === me,
  };
});

// ---------------------------------------------------------------- Flik: Händelser och utfall
handleQuery(caseEvents, { roles: CASE_ROLES }, async (ctx, p): Promise<CaseEvents | null> => {
  const L = await loadCase(ctx, p.caseId, "handelser");
  if (!L) return null;
  const { c, cfg, team } = L;
  const q = { caseId: c.id };
  const db = await loadDb(ctx.repo, ["outcome_events", "check_ins"], { outcome_events: q, check_ins: q });
  const ev = eventsOf(db, c.id);
  const shown = team ? ev.filter((e) => CONTACT_KINDS.includes(e.kind) || e.kind === "praktik_startad") : ev;
  // Bonusunderlaget är ett ekonomiskt villkor: inte för teamet och inte för begränsade testare (src/api/tester-access.ts).
  const bonus = !team && !hidesCommercial(ctx.actor);
  return {
    events: shown.map((e) => ({
      id: e.id, kind: e.kind, label: eventLabel(e.kind), occurredOn: e.occurredOn, actor: e.actor, note: e.note, verificationKind: e.verificationKind,
      needsVerification: (e.kind === "arbete_paborjat" || e.kind === "studier_paborjade") && !e.verificationKind, possibleBonus: bonus && e.possibleBonus,
    })),
    checkInContacts: checkInContacts(db, c.id),
    result: team ? null : c.status === "closed" ? { endDate: c.endDate, endReasonLabel: endReasonLabel(c.endReason), resultClass: c.resultClass, verifiedAt: c.resultVerifiedAt } : null,
    resultDefinitionUnset: isUnset(cfg.result.definition),
    prototypeDefinition: cfg.result.prototypeDefinition ?? null,
    bonusEnabled: !!cfg.bonus.enabled,
  };
});

/** Arbetsgivarkontakter i godkända avstämningar ("2+" räknas som 2). */
function checkInContacts(db: Pick<Db, "check_ins">, caseId: string): number {
  return checkInsOf(db, caseId).filter((x) => x.status === "approved").reduce((s, x) => {
    const n = x.employerContacts?.count;
    return s + (n === "2+" ? 2 : Number(n) || 0);
  }, 0);
}

// ---------------------------------------------------------------- Flik: Avvikelser
handleQuery(caseDeviations, { roles: CASE_ROLES }, async (ctx, p): Promise<CaseDeviations | null> => {
  const L = await loadCase(ctx, p.caseId, "avvikelser");
  if (!L) return null;
  const { c, env, cfg, today, me } = L;
  const q = { caseId: c.id };
  const db = await loadDb(ctx.repo, ["deviations", "activities", "attendance", "profiles", "memberships"], { deviations: q, activities: q, attendance: q, memberships: { contractId: c.contractId } });
  const rep = repeatedAbsence(db, c.id, env);
  const ownerRoles: readonly Role[] = ["coach", "samordnare", "avtalsansvarig", "handledare"];
  const ownerIds = new Set(db.memberships.filter((m) => ownerRoles.includes(m.role)).map((m) => m.userId));
  return {
    deviations: deviationsOf(db, c.id).map((dv) => {
      const open = dv.status === "open";
      const dueAt = dv.followUpOn ? `${dv.followUpOn}T${env.org.alerts.followUpDueTime}` : null;
      return {
        id: dv.id, createdAt: dv.createdAt, description: dv.description, assessment: dv.assessment, action: dv.action,
        ownerName: dv.ownerId ? personName(db.profiles, dv.ownerId) : null, followUpOn: dv.followUpOn, needsCustomerDecision: dv.needsCustomerDecision,
        followUpMeetingAt: dv.followUpMeetingAt, open, fromCheckIn: !!dv.checkInId,
        due: open && dueAt ? { dueAt, sla: pickSla(slaStatus(dueAt, null, env)) } : null,
      };
    }),
    repeated: rep ? { count: rep.length, withinDays: cfg.attendance.repeatedAbsenceRule.withinDays } : null,
    owners: db.profiles.filter((u) => ownerIds.has(u.id) && u.active !== false).map((u) => ({ id: u.id, label: `${u.fullName} – ${u.title}` })),
    defaultOwnerId: c.leadCoachId || me,
    defaultFollowUpOn: addWorkingDays(today, 5),
    defaultCallAt: `${addWorkingDays(today, 2)}T10:00`,
    today,
    now: env.now,
  };
});

// ---------------------------------------------------------------- Flik: Praktik
handleQuery(casePlacements, { roles: CASE_ROLES }, async (ctx, p): Promise<CasePlacements | null> => {
  const L = await loadCase(ctx, p.caseId, "praktik");
  if (!L) return null;
  const { c, today } = L;
  const q = { caseId: c.id };
  const db = await loadDb(ctx.repo, ["placements", "employers", "outcome_events", "check_ins"], { placements: q, outcome_events: q, check_ins: q });
  const emp = byId(db.employers);
  return {
    placements: placementsOf(db, c.id).slice().sort(by("startsOn", -1)).map((pl) => {
      const e = emp.get(pl.employerId);
      return {
        id: pl.id, employerName: e?.name ?? null, contactName: e?.contactName ?? null, phone: e?.phone ?? null, status: pl.status, startsOn: pl.startsOn, endsOn: pl.endsOn,
        tasks: pl.tasks, goals: pl.goals, supervisorName: pl.supervisorName, followUpDates: pl.followUpDates ?? [],
        fourRights: pl.fourRights ?? { uppgift: false, handledning: false, timing: false, uppfoljning: false },
      };
    }),
    contacts: eventsOf(db, c.id).filter((e) => CONTACT_KINDS.includes(e.kind)).map((e) => ({ id: e.id, actor: e.actor, label: eventLabel(e.kind), occurredOn: e.occurredOn })),
    checkInContacts: checkInContacts(db, c.id),
    phase: c.phase,
    today,
  };
});

// ---------------------------------------------------------------- Flik: Rapporter
handleQuery(caseReports, { roles: CASE_ROLES }, async (ctx, p) => {
  const L = await loadCase(ctx, p.caseId, "rapporter");
  if (!L) return null;
  const { c, env, today } = L;
  const db = await loadDb(ctx.repo, ["reports"], { reports: { caseId: c.id } });
  const all = byId(db.reports);
  return {
    reports: reportsOf(db, c.id).filter((r) => !r.superseded).map((r): CaseReportRow => {
      const nv = r.correctionPending ? all.get(r.correctionPending) : null;
      return {
        id: r.id, kind: r.kind, kindLabel: reportKindLabel(r.kind),
        periodText: r.month ? cap(monthName(r.month)) : r.kind === "order_confirmation" ? fd(r.periodStart, today) : `${fd(r.periodStart, today)} – ${fd(r.periodEnd, today)}`,
        version: r.version, status: r.status, statusLabel: reportStatusLabel(r.status), correctionVersion: nv && !nv.deliveredAt ? nv.version : null,
        dueAt: r.dueAt, sla: r.dueAt ? pickSla(slaStatus(r.dueAt, r.deliveredAt, env)) : null, provisionalDue: r.provisionalDue, deliveredAt: r.deliveredAt, openedAt: r.openedAt,
      };
    }),
  };
});

// ---------------------------------------------------------------- Flik: Meddelanden
/** Uppslagen som meddelanderaderna behöver – fliken och tidslinjens utfällda text bygger raden med samma funktion. */
async function messageContext(ctx: Ctx, L: Loaded) {
  const [profiles, fromCustomer, supplier, customer] = await Promise.all([
    ctx.repo.table("profiles").list(), customerUserIds(ctx), ctx.repo.table("organizations").get(L.contract.supplierId), ctx.repo.table("organizations").get(L.contract.customerId),
  ]);
  return { profiles, fromCustomer, supplier, customer };
}
type MessageContext = Awaited<ReturnType<typeof messageContext>>;
function messageRowOf(m: Message, x: MessageContext): CaseMessageRow {
  const mine = !x.fromCustomer.has(m.senderId);
  const by = m.readBy.filter((id) => (mine ? x.fromCustomer.has(id) : !x.fromCustomer.has(id)));
  const readText = mine
    ? by.length ? `Läst av kommunen ${m.readAt ? fmtDateTime(m.readAt) : ""}`.trim() : "Inte läst av kommunen än"
    : by.length ? `Läst av ${by.map((id) => personName(x.profiles, id)).join(", ")}` : "Oläst";
  return {
    id: m.id, senderName: personName(x.profiles, m.senderId), mine, orgName: (mine ? x.supplier?.name : x.customer?.name) ?? "", createdAt: m.createdAt,
    meetingRequest: m.kind === "meeting_request", body: m.body, readText,
  };
}

handleQuery(caseMessages, { roles: CASE_ROLES }, async (ctx, p) => {
  const L = await loadCase(ctx, p.caseId, "meddelanden");
  if (!L) return null;
  const [msgs, x] = await Promise.all([ctx.repo.table("messages").list({ caseId: L.c.id }), messageContext(ctx, L)]);
  return { messages: messagesOf({ messages: msgs }, L.c.id).map((m) => messageRowOf(m, x)) };
});

// ---------------------------------------------------------------- Tidslinjens utfällda text (beslut 2026-10-02)
// Meddelandets text eller avstämningens anteckning, hinder och närvarokommentar – hämtas först när posten fälls ut i
// tidslinjen. Samma spärr som fliken (loadCase med flikens namn: teamet får null, kommunen har inte rutten) och samma
// rader som fliken visar (messageRowOf; utkastets anteckning visas inte förrän avstämningen är godkänd). Ingen ctx.audit:
// flikarna loggar inte heller visning av texten – kortets öppning loggas en gång (case.view).
handleQuery(caseTimelineText, { roles: CASE_ROLES }, async (ctx, p): Promise<TimelineText | null> => {
  const [kind, rawId] = p.id.split(":") as ["msg" | "ci", string];
  const L = await loadCase(ctx, p.caseId, kind === "msg" ? "meddelanden" : "avstamningar");
  if (!L) return null;
  if (kind === "msg") {
    const m = await ctx.repo.table("messages").get(rawId);
    if (!m || m.caseId !== L.c.id) return null;
    const x = await messageContext(ctx, L);
    const row = messageRowOf(m, x);
    // Oläst av den som tittar: bara kommunens meddelanden och bara för den som arbetar i ärendet (chef och admin läser utan kvitto).
    const unreadByMe = !row.mine && CASE_WORKERS.includes(L.role) && !m.readBy.includes(L.me);
    return { kind: "message", senderName: row.senderName, orgName: row.orgName, createdAt: row.createdAt, meetingRequest: row.meetingRequest, body: row.body, readText: row.readText, unreadByMe };
  }
  const ci = await ctx.repo.table("check_ins").get(rawId);
  if (!ci || ci.caseId !== L.c.id) return null;
  const approved = ci.status === "approved";
  return { kind: "check_in", heldAt: ci.heldAt, approved, note: approved ? ci.note : "", obstacles: ci.obstacles, attendanceComment: approved ? (ci.attendanceComment ?? "") : "" };
});

// ---------------------------------------------------------------- Flik: Historik
/** Händelser i revisionsloggen som text (prototypens AUDIT). */
const AUDIT_TEXT: Record<string, string> = {
  "case.view": "Öppnade deltagarkortet", "case.view_denied": "Försökte öppna deltagarkortet utan behörighet", "pnr.revealed": "Visade personnumret",
  "case.created": "Ärendet skapades", "case.accepted": "Avropet accepterades", "case.declined": "Avropet avböjdes", "case.updated": "Uppgifter ändrades",
  "case.buyer_reference_changed": "Beställarreferensen ändrades", "case.first_meeting_booked": "Första mötet bokades", "case.coach_changed": "Huvudcoach byttes", "case.closed": "Insatsen avslutades",
  "message.sent": "Säkert meddelande skickades", "deviation.customer_called": "Kommunen kallades till uppföljning", "deviation.saved": "Avvikelse sparades", "deviation.created": "Avvikelse skapades",
  "consent.given": "Samtycke registrerades", "consent.declined": "Deltagaren avböjde samtycke", "consent.revoked": "Samtycket återkallades",
  "check_in.saved": "Avstämning sparades som utkast", "check_in.approved": "Avstämning godkändes", "assessment.saved": "Månadsbedömning sparades", "assessment.approved": "Månadsbedömning godkändes",
  "intake.saved": "Kartläggning sparades", "intake.approved": "Kartläggning godkändes", "event.added": "Händelse registrerades", "result.verified": "Resultat verifierades",
  "attendance.registered": "Närvaro registrerades", "attendance.registered_all": "Närvaro registrerades för flera tillfällen samma dag", "report.approved": "Rapport godkändes", "report.delivered": "Rapport levererades", "report.corrected": "Rapport rättades", "report.view": "Rapport öppnades", "report.published": "Rapport publicerades",
  "transcript.deleted": "Råtranskript raderades", "ai.run": "AI-körning", "audio.deleted": "Ljudfil raderades", "notify.email": "E-post skickades",
  "voice_note.view": "Visade röstmeddelanden",
  "case_note.created": "Skrev anteckning", "case_note.updated": "Ändrade anteckning", "case_note.removed": "Tog bort anteckning",
  "case_note.used_in_summary": "Använde anteckning i sammanfattningen", "report.downloaded": "Rapport laddades ner som PDF", "report.created": "Rapportutkast skapades",
};

type LogEntry = { id: string; occurredAt: string; actorId: string | null; action: string; entity: string; entityId: string | null; details: Record<string, unknown>; text?: string };

handleQuery(caseHistory, { roles: CASE_ROLES }, async (ctx, p): Promise<CaseHistory | null> => {
  const L = await loadCase(ctx, p.caseId, "historik");
  if (!L) return null;
  const { c, role, me, today } = L;
  const q = { caseId: c.id };
  const db = await loadDb(ctx.repo, ["case_status_history", "profiles", "reports", "check_ins", "monthly_assessments", "intake_assessments", "messages", "attendance"], {
    case_status_history: q, reports: q, check_ins: q, monthly_assessments: q, intake_assessments: q, messages: q, attendance: q,
  });
  const name = (id: string | null | undefined) => personName(db.profiles, id);
  // Coach och handledare ser bara statushistoriken och sina egna åtgärder – aldrig andras poster (t.ex. vem som öppnat kortet).
  const ownOnly = role === "coach" || role === "handledare";
  const repIds = new Set(db.reports.map((r) => r.id));
  // Revisionsloggen läses via ctx.repo: behörigheten (policyn/RLS) avgör vilka poster rollen ser.
  const audit = (await ctx.repo.table("audit_log").list({ contractId: c.contractId })).filter(
    (x) =>
      x.entityId === c.id || x.details?.caseId === c.id || (Array.isArray(x.details?.caseIds) && x.details.caseIds.includes(c.id)) ||
      (x.entity === "report" && !!x.entityId && repIds.has(x.entityId)) || (x.entity === "person" && x.entityId === c.personId),
  );
  const auditOwn: LogEntry[] = ownOnly ? audit.filter((x) => x.actorId === me && !VIEW_ACTIONS.includes(x.action)) : audit;
  const log = (ownOnly ? [...auditOwn, ...ownActions(db, c, me, auditOwn, today)] : auditOwn).slice().sort(by<LogEntry>("occurredAt", -1));

  const detailText = (x: LogEntry): string => {
    const dt = x.details ?? {};
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    if (x.action === "case.coach_changed") return `${name(s(dt.from))} → ${name(s(dt.to))}. Orsak: ${s(dt.reason) || "–"}`;
    // Anteckningar: aldrig texten – bara vems anteckning som togs bort och vilken månads sammanfattning den användes i.
    if (x.action === "case_note.removed") return s(dt.authorId) && s(dt.authorId) !== x.actorId ? `Anteckning skriven av ${name(s(dt.authorId))}` : "";
    if (x.action === "case_note.used_in_summary") return s(dt.month) ? `Månadsbedömning ${monthName(s(dt.month))}` : "";
    // "Markera alla som närvarande": antalet tillfällen den dagen (alla deltagare) – raden hör till flera ärenden.
    if (x.action === "attendance.registered_all") return plural(Number(dt.count ?? 0), "tillfälle", "tillfällen");
    // Automatisk utkastsparning loggas en gång per besök på sidan.
    if (dt.autosave === true) return "Sparades automatiskt";
    if (dt.reason) return String(dt.reason);
    if (dt.status && x.entity === "attendance") return attLabel(s(dt.status));
    if (dt.at) return fmtDateTimeLong(s(dt.at));
    if (dt.kind) return reportKindLabel(s(dt.kind)) !== dt.kind ? reportKindLabel(s(dt.kind)) : eventLabel(s(dt.kind));
    if (Array.isArray(dt.fields)) return `Fält: ${dt.fields.join(", ")}`;
    return "";
  };
  return {
    ownOnly,
    items: historyOf(db, c.id).map((h): CaseHistoryItem => {
      const coachChange = !!h.fromCoach && !!h.toCoach && h.fromCoach !== h.toCoach;
      const reason = (END_REASONS as readonly string[]).includes(h.reason) ? endReasonLabel(h.reason) : h.reason;
      return {
        id: h.id,
        icon: coachChange ? "users" : h.toStatus === "closed" ? "check-square" : h.toStatus === "declined" ? "x-circle" : h.toStatus === "confirmed" ? "check" : "inbox",
        filled: h.toStatus === "closed", red: h.toStatus === "declined",
        title: coachChange ? `Huvudcoach bytt: ${name(h.fromCoach)} → ${name(h.toCoach)}` : `${h.fromStatus && h.fromStatus !== h.toStatus ? `${statusLabel(h.fromStatus)} → ` : ""}${statusLabel(h.toStatus)}`,
        sub: `${fmtDateTime(h.changedAt)} · ${name(h.changedBy)}`,
        reason: reason || null,
        customerNotifiedAt: h.customerNotifiedAt,
        leadCoachName: !coachChange && h.toCoach && h.toStatus === "confirmed" ? name(h.toCoach) : null,
      };
    }),
    log: log.map((x) => ({ id: x.id, occurredAt: x.occurredAt, actorName: name(x.actorId), text: AUDIT_TEXT[x.action] || x.action, sub: clip(x.text || detailText(x), 90) })),
  };
});

/**
 * Coachens och handledarens egna åtgärder: det personen själv har godkänt, skickat eller registrerat (testdatat har ingen
 * revisionslogg för äldre händelser). Dubbletter mot revisionsloggen tas bort (prototypens ownActions).
 */
function ownActions(db: Pick<Db, "check_ins" | "monthly_assessments" | "intake_assessments" | "messages" | "attendance">, c: Case, me: string, auditOwn: LogEntry[], today: string): LogEntry[] {
  const have = new Set(auditOwn.map((x) => `${x.action}:${x.entityId}`));
  const haveAt = new Set(auditOwn.map((x) => `${x.action}@${x.occurredAt}`));
  const out: LogEntry[] = [];
  const push = (action: string, entityId: string, at: string | null, text: string) => {
    if (!at || have.has(`${action}:${entityId}`) || haveAt.has(`${action}@${at}`)) return;
    out.push({ id: `own-${action}-${entityId}`, occurredAt: at, actorId: me, action, entity: "case", entityId, details: {}, text });
  };
  for (const x of checkInsOf(db, c.id)) if (x.status === "approved" && x.approvedBy === me) push("check_in.approved", x.id, x.approvedAt, `Avstämningen ${fd(x.heldAt, today)}`);
  for (const x of assessmentsOf(db, c.id)) if (x.status === "approved" && x.decidedBy === me) push("assessment.approved", x.id, x.decidedAt, cap(monthName(x.month)));
  const ia = intakeOf(db, c.id);
  if (ia && ia.status === "approved" && ia.approvedBy === me) push("intake.approved", ia.id, ia.approvedAt, "");
  for (const m of messagesOf(db, c.id)) if (m.senderId === me) push("message.sent", m.id, m.createdAt, m.kind === "meeting_request" ? "Kallelse till uppföljning" : clip(m.body, 60));
  const att = groupBy(db.attendance.filter((a) => a.caseId === c.id && a.registeredBy === me && a.registeredAt && !have.has(`attendance.registered:${a.id}`)), (a) => a.registeredAt.slice(0, 10));
  for (const [day, xs] of Object.entries(att)) {
    const at = xs.map((a) => a.registeredAt).sort().pop() as string;
    out.push({ id: `own-att-${day}`, occurredAt: at, actorId: me, action: "attendance.registered", entity: "attendance", entityId: null, details: {}, text: plural(xs.length, "tillfälle", "tillfällen") });
  }
  return out;
}

// ---------------------------------------------------------------- arenden.visaPersonnummer
handleCommand(caseRevealPnr, { roles: CASE_ROLES, silent: true }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  const access = caseAccessIn(c, ctx.actor, await accessSourceFor(ctx, [c]));
  if (access !== "full") return fail("forbidden", "Din roll kan inte visa personnumret.");
  const person = await ctx.repo.table("persons").get(c.personId);
  const pnr = person ? decodePnr(ctx.crypto, person) : "";
  if (!person || !pnr) return fail("missing", "Personnummer saknas.");
  await ctx.audit({ action: "pnr.revealed", entity: "person", entityId: person.id, contractId: c.contractId, details: { caseId: c.id } });
  return ok({ pnr });
});

// ---------------------------------------------------------------- arenden.handledare (hand.start)
handleQuery(supervisorStart, { roles: ["handledare"] }, async (ctx): Promise<SupervisorStart> => {
  const me = ctx.actor.userId;
  const now = ctx.now();
  const today = dayOf(now);
  const db = await loadDb(ctx.repo, ["cases", "case_team", "persons", "activities", "placements", "employers", "outcome_events", "contract_areas"]);
  const src = await accessSourceFor(ctx, db.cases);
  const persons = byId(db.persons);
  const emp = byId(db.employers);
  const teamOf = groupedBy(db.case_team, "caseId", (t) => t.caseId);
  const mine = db.cases.filter((c) => (teamOf.get(c.id) ?? []).some((t) => t.userId === me));
  const name = (c: Case) => nameFor(c, persons.get(c.personId), caseAccessIn(c, ctx.actor, src));
  const envs = new Map<string, OperationalConfig>();
  for (const id of new Set(mine.map((c) => c.contractId))) envs.set(id, (await contractOf(ctx, id)).cfg);
  const pagaende = mine.filter((c) => c.status === "active" || c.status === "paused");
  const start = mine.filter((c) => c.status === "received" || c.status === "acknowledged" || c.status === "confirmed");
  const avslutade = mine.filter((c) => c.status === "closed");
  const card = (c: Case): SupervisorCase => {
    const myRole = (teamOf.get(c.id) ?? []).find((t) => t.userId === me)?.role ?? "";
    const acts = activitiesOf(db, c.id).filter((a) => a.startsAt >= now && a.kind !== "möte");
    const pls = placementsOf(db, c.id);
    const pl = pls.find((x) => x.status === "ongoing") ?? pls.find((x) => x.status === "planned") ?? null;
    const e = pl ? emp.get(pl.employerId) : undefined;
    const contacts = eventsOf(db, c.id).filter((x) => CONTACT_KINDS.includes(x.kind));
    const cfg = envs.get(c.contractId);
    return {
      id: c.id, caseNumber: c.caseNumber, status: c.status, displayName: name(c), myRoleLabel: teamLabel(myRole), phase: c.phase, phaseName: cfg ? phaseName(cfg, c.phase) : "",
      areaCode: c.primaryAreaCode ?? null, areaName: areaName(db.contract_areas.filter((a) => a.contractId === c.contractId), c.primaryAreaCode),
      vocationalTrack: c.vocationalTrack, upcoming: acts.slice(0, 3).map(activityView), nextAt: acts[0]?.startsAt ?? null,
      placement: pl ? { employerName: e?.name ?? null, startsOn: pl.startsOn, endsOn: pl.endsOn, fourRights: pl.fourRights ?? null, contactName: e?.contactName ?? null, phone: e?.phone ?? null } : null,
      contacts: contacts.length,
      lastContact: contacts[0] ? { occurredOn: contacts[0].occurredOn, label: eventLabel(contacts[0].kind), actor: contacts[0].actor } : null,
    };
  };
  const mon = monday(today);
  const sun = addDays(mon, 6);
  const weekActs = pagaende.flatMap((c) => activitiesOf(db, c.id).filter((a) => a.startsAt >= mon && a.startsAt <= `${sun}T23:59`));
  const missingFour = pagaende.filter((c) => placementsOf(db, c.id).some((x) => x.status === "ongoing" && x.fourRights && Object.values(x.fourRights).some((v) => !v)));
  const limit = `${addDays(today, 6)}T23:59`;
  return {
    today,
    groups: { pagaende: pagaende.map(card), start: start.map(card), avslutade: avslutade.map(card) },
    practiceDays: weekActs.filter((a) => a.kind === "praktikdag").length,
    vocationalMoments: weekActs.filter((a) => a.kind === "yrkesmoment").length,
    missingFour: missingFour.map((c) => {
      const pl = placementsOf(db, c.id).find((x) => x.status === "ongoing");
      const e = pl ? emp.get(pl.employerId) : undefined;
      return {
        caseId: c.id, caseNumber: c.caseNumber, displayName: name(c), employerName: e?.name ?? null,
        missing: FOUR_LABEL.filter(([k]) => pl && pl.fourRights && !pl.fourRights[k]).map(([, l]) => l.toLowerCase()),
      };
    }),
    upcoming: pagaende
      .flatMap((c) => activitiesOf(db, c.id).filter((a) => a.startsAt >= now && a.startsAt <= limit && a.kind !== "möte").map((a) => ({ ...activityView(a), caseId: c.id, caseNumber: c.caseNumber, displayName: name(c) })))
      .sort((x, y) => (x.startsAt < y.startsAt ? -1 : 1)),
  };
});
