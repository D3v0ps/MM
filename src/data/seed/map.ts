// Från prototypens datastruktur till tabellerna i schema.ts (namnbytena beskrivs överst i schema.ts).
// Fält som prototypen saknar får null/false/[] – inga nya uppgifter hittas på.
import { BOTKYRKA_CONFIG, DEFAULT_ORG_SETTINGS } from "@/core/config";
import { holidaysOf } from "@/core/holidays";
import type { MemoryData } from "../memory";
import type { Role } from "@/api/roles";
import { emptyDb, type Case, type Db, type DemoTag, type Profile, type Report, type Tables } from "../schema";
import { AREAS } from "./constants";
import type { PCase, ProtoState, PUser } from "./context";
import { encodeTestPnr, testPnrHash } from "./pnr";

/** Organisationer: leverantören och beställaren (Botkyrka). */
export const ORG_MB = "org-mb";
export const ORG_BOTKYRKA = "org-botkyrka";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Prototypens roller -> Role (kommunens roller har prefix i koden). Kommunen har bara rollen handläggare (beslut 2026-10-07)
 * – prototypens kommunchef (k-eva) tas bort i steget decisions-2026-10-07.ts.
 */
const roleOf = (u: PUser): Role => (u.org === "customer" ? "kommun_handlaggare" : u.role) as Role;

function profileOf(u: PUser): Profile {
  return {
    id: u.id, organizationId: u.org === "mb" ? ORG_MB : ORG_BOTKYRKA, fullName: u.name, email: u.email, phone: u.phone, title: u.title, active: u.active,
    lastLoginAt: u.lastLoginAt ?? null, customerUnit: u.unit ?? null, buyerReferenceId: u.buyerReferenceId ?? null, teamRole: u.teamRole ?? null,
    invitedAt: null, invitedBy: null,
  };
}

function caseOf(c: PCase): Case {
  return {
    id: c.id, caseNumber: c.number, contractId: c.contractId, personId: c.personId as string, status: c.status, source: c.source, referredAt: c.referredAt,
    referrerId: c.referrerId, referrerName: null, referrerUnit: null, referrerPhone: null, referrerEmail: null,
    buyerReference: c.buyerReference, purchaseOrderNumber: c.purchaseOrderNumber, primaryAreaCode: c.primaryArea, secondaryAreaCode: c.secondaryArea,
    vocationalTrack: c.vocationalTrack, desiredStart: c.desiredStart, plannedStart: null, plannedWeeks: c.plannedWeeks, plannedEnd: c.plannedEnd,
    orderValueWeeks: c.orderValueWeeks, acknowledgedAt: c.acknowledgedAt, confirmedAt: c.confirmedAt, declinedAt: null, declineReason: c.declineReason,
    firstMeetingAt: c.firstMeetingAt, startDate: c.startDate, endDate: c.endDate, closedAt: c.closedAt, endReason: c.endReason, resultClass: c.resultClass,
    resultVerifiedAt: c.resultVerifiedAt, phase: c.phase, phaseSince: c.phaseSince ?? null, leadCoachId: c.leadCoachId, backgroundInfo: c.backgroundInfo,
    aiConsentStatus: c.aiConsent, meetingDay: c.meetingDay, meetingTime: c.meetingTime, location: c.location, pausedWeeks: [...c.pausedWeeks],
    pauseReason: c.pauseReason ?? null, sourceEmailId: null,
    // Beställningsformuläret (beslut 2026-10-07): prototypens ärenden är beställda i veckor – omfattningen i månader och
    // kartläggningen sätts för de öppna avropen i decisions-2026-10-07.ts.
    orderPeriodMonths: null, orderPeriodReason: null, priorAssessment: null,
  };
}

const REPORT_DEFAULTS: Omit<Report, "id" | "contractId" | "kind" | "periodStart" | "periodEnd" | "status" | "version" | "dueAt" | "approvedBy" | "approvedAt" | "deliveredAt" | "deliveredTo" | "openedAt"> = {
  caseId: null, recipientUserId: null, week: null, month: null, openedBy: null, provisionalDue: false, pdfPath: null, aiSummaryDraft: null, summary: null,
  summaryAiUsed: false, finalText: null, previousId: null, correctionPending: null, superseded: false, supersededAt: null, supersededBy: null,
  correctionReason: null, correctedBy: null, correctedAt: null, qualityReviewedBy: null, qualityReviewedAt: null, snapshot: null,
};

/** Avtal, organisationer, områden och priser (prototypens S.contracts, S.areas, S.priceItems). */
function contractTables(db: Db) {
  db.organizations.push(
    { id: ORG_MB, name: "Miljonbemanning AB", orgNr: "556959-9318", kind: "supplier", emailDomains: [] },
    { id: ORG_BOTKYRKA, name: "Botkyrka kommun", orgNr: "212000-2882", kind: "customer", emailDomains: ["botkyrka.se"] },
  );
  db.contracts.push(
    { id: "c-bot", supplierId: ORG_MB, customerId: ORG_BOTKYRKA, name: "Yrkesförberedande och yrkesinriktade insatser", contractNumber: "332026110", dnr: "AVN/2026:00048",
      startsOn: "2026-09-10", endsOn: "2030-09-10", casePrefix: "BOT", dataRole: "processor", config: clone(BOTKYRKA_CONFIG), status: "active", contractManagerId: "u-johan" },
  );
  for (const [code, name, price] of AREAS) {
    db.contract_areas.push({ id: `c-bot:${code}`, contractId: "c-bot", code, name, active: true });
    db.price_items.push({ id: `pi-${code}`, contractId: "c-bot", areaCode: code, code: `vecka-${code}`, unit: "participant_week", packageMonths: null, priceOre: price, vatRate: 25,
      validFrom: "2026-09-10", validTo: "2027-09-09", fortnoxArticleNo: `BOT-${code}`, exampleOnly: true });
  }
  // Helgdagar 2026–2027 (samma som prototypens lista – beräknas i src/core/holidays.ts)
  for (const year of [2026, 2027]) for (const [date, name] of Object.entries(holidaysOf(year)).sort(([a], [b]) => (a < b ? -1 : 1))) db.holidays.push({ id: date, date, name });
  // Integrationer (prototypens lista i adminvyn "Underbiträden och integrationer")
  db.integrations.push(
    { id: "graph", kind: "graph", name: "avrop@-brevlådan", status: "active", config: { description: "Microsoft Graph" }, secretsEnc: null, tokenExpiresAt: null },
    { id: "entra", kind: "entra", name: "Microsoft Entra ID", status: "active", config: { description: "Inloggning för Miljonbemanning" }, secretsEnc: null, tokenExpiresAt: null },
    { id: "fortnox", kind: "fortnox", name: "Fortnox", status: "off", config: { description: "Fakturor som Peppol BIS Billing 3", phase: 2 }, secretsEnc: null, tokenExpiresAt: null },
    { id: "sms", kind: "sms", name: "SMS-leverantör", status: "notchosen", config: { description: "Påminnelser och pulslänkar" }, secretsEnc: null, tokenExpiresAt: null },
    { id: "email", kind: "email", name: "E-postleverantör", status: "notchosen", config: { description: "Notiser och inloggningskoder" }, secretsEnc: null, tokenExpiresAt: null },
    { id: "ai", kind: "ai", name: "AI-leverantör", status: "test", config: { description: "Transkribering och textutkast", phase: 2 }, secretsEnc: null, tokenExpiresAt: null },
  );
  db.org_settings.push({ id: ORG_MB, organizationId: ORG_MB, settings: clone(DEFAULT_ORG_SETTINGS), updatedAt: null, updatedBy: null });
}

/** Alla tabeller ur prototypens tillstånd. */
export function toTables(S: ProtoState, meta: { checkInTags: Record<string, string[]>; pulseDemoIds: string[] }): MemoryData<Tables> {
  const db = emptyDb();
  contractTables(db);

  // ---- Användare och medlemskap. Alla arbetar i Botkyrkaavtalet (det enda avtalet i testdatat).
  for (const u of [...S.users, ...S.customerUsers]) {
    db.profiles.push(profileOf(u));
    const contractId = "c-bot";
    db.memberships.push({ id: `${u.id}:${contractId}`, userId: u.id, contractId, role: roleOf(u), customerUnit: u.unit ?? null });
  }
  for (const b of S.buyerReferences) db.buyer_references.push({ id: b.id, customerId: ORG_BOTKYRKA, reference: b.reference, unit: b.unit, active: b.active, note: b.note ?? null });

  // ---- Personer (personnummer krypteras i produktion – se pnr.ts)
  for (const p of S.persons) {
    db.persons.push({
      id: p.id, personnummerEnc: encodeTestPnr(p.pnr), personnummerHash: testPnrHash(p.pnr), personnummerLast4: p.pnrLast4, birthYear: p.birthYear,
      firstName: p.firstName, lastName: p.lastName, phone: p.phone, email: p.email, city: p.city, address: p.address, preferredContact: p.preferredContact,
      protectedIdentity: p.protectedIdentity, accessibilityNeeds: p.accessibilityNeeds, language: p.language, needsInterpreter: p.needsInterpreter,
    });
  }

  // ---- Ärenden och team
  for (const c of S.cases) {
    db.cases.push(caseOf(c));
    for (const t of c.team) db.case_team.push({ id: `${c.id}:${t.userId}`, caseId: c.id, userId: t.userId, role: t.role });
  }
  for (const [key, lastValue] of Object.entries(S.caseCounters)) {
    const [contractId, year] = key.split(":");
    db.case_counters.push({ id: key, contractId, year: Number(year), lastValue });
  }
  for (const h of S.caseStatusHistory) db.case_status_history.push({ ...h, fromCoach: h.fromCoach ?? null, toCoach: h.toCoach ?? null, customerNotifiedAt: h.customerNotifiedAt ?? null });

  // ---- Mejl
  for (const e of S.inboundEmails) {
    db.inbound_emails.push({
      id: e.id, graphMessageId: e.graphMessageId, receivedAt: e.receivedAt, fromAddress: e.fromAddress, fromName: e.fromName, subject: e.subject, bodyText: e.bodyText,
      attachments: e.attachments.map((a) => ({ ...a, path: null })), parseMethod: e.parseMethod, classification: e.classification, extracted: e.extracted,
      confidence: e.confidence, missingFields: e.missingFields, corrections: {}, status: e.status, caseId: e.caseId, ackSentAt: e.ackSentAt, ackKind: e.ackKind ?? null,
      aiRunId: e.aiRunId ?? null, linkedBy: e.linkedBy ?? null, registeredBy: null, registeredAt: null, handledBy: e.handledBy, handledAt: e.handledAt,
    });
  }

  // ---- Coachning
  // version (0022): testdatat börjar på 1 – ökas av hanterarna vid varje sparning.
  db.intake_assessments.push(...S.intakeAssessments.map((x) => ({ ...x, version: 1 })));
  db.activities.push(...S.activities);
  db.attendance.push(...S.attendance);
  for (const ci of S.checkIns) {
    const { tags, ...rest } = ci;
    void tags;
    db.check_ins.push({ ...rest, ai: ci.ai ?? null, version: 1 });
  }
  db.monthly_assessments.push(...S.monthlyAssessments.map((x) => ({ ...x, version: 1 })));
  db.monthly_plans.push(...S.monthlyPlans);
  for (const e of S.outcomeEvents) db.outcome_events.push({ ...e, possibleBonus: e.possibleBonus ?? false });
  for (const d of S.deviations) db.deviations.push({ ...d, checkInId: null });
  for (const cd of S.contractDeviations) {
    db.contract_deviations.push({
      ...cd, caseId: null, registeredBy: null, ownerId: null, planSubmittedAt: null, customerApprovedBy: null, warningIssuedAt: null,
      penaltyKind: null, penaltyOffsetMonth: null, orderStop: false, closedAt: null, closedBy: null,
    });
  }
  for (const e of S.employers) db.employers.push({ ...e, createdAt: null, createdBy: null });
  db.placements.push(...S.placements);
  for (const c of S.consents) db.consents.push({ ...c, declinedAt: c.declinedAt ?? null });

  // ---- Rapporter
  for (const r of S.reports) db.reports.push({ ...REPORT_DEFAULTS, ...r });

  // ---- Puls
  for (const i of S.pulseInvites) {
    const { demo, ...rest } = i;
    void demo;
    db.pulse_invites.push({ ...rest, tokenHash: null });
  }
  db.pulse_responses.push(...S.pulseResponses);

  // ---- Kommunikation
  for (const m of S.messages) db.messages.push({ ...m, kind: null });

  // ---- Fakturering: körningarna per månad. Fakturorna (en per avtal och månad, beslut 2026-10-07) byggs av prototypens
  // status per månad och ärende (S.invoiceStatus) i src/data/seed/decisions-2026-10-07.ts.
  for (const b of S.billingRuns) {
    db.billing_runs.push({ id: b.id, contractId: "c-bot", month: b.month, status: b.status, createdBy: b.createdBy, createdAt: b.createdAt, closedAt: null, closedBy: null });
  }

  // ---- AI, logg, utskick, notiser, uppgifter
  for (const a of S.aiRuns) {
    db.ai_runs.push({
      id: a.id, caseId: a.caseId, kind: a.kind, provider: a.provider, model: a.model, inputRef: null, status: a.status, createdAt: a.createdAt,
      audioSeconds: a.audioSeconds ?? null, tokensIn: null, tokensOut: null, costOre: a.costOre, latencyMs: a.latencyMs, output: null, evidence: null,
      inputDeletedAt: a.inputDeletedAt ?? null,
    });
  }
  db.audit_log.push(...S.auditLog);
  for (const n of S.notifications) db.outbound_messages.push({ id: n.id, createdAt: n.at, channel: n.channel, to: n.to, template: n.template, subject: null, body: n.body, caseId: n.caseId, status: "sent", sentAt: n.at });
  db.user_notifications.push(...S.userNotifications);
  for (const [userId, reads] of Object.entries(S.notifRead)) for (const [key, at] of Object.entries(reads)) db.notification_reads.push({ id: `${userId}:${key}`, userId, notificationKey: key, readAt: at });
  for (const t of S.tasks) {
    db.tasks.push({
      id: t.id, toRole: t.toRole, toId: null, fromId: t.fromId, createdAt: t.createdAt, status: t.status, kind: null, caseIds: t.caseIds ?? [], text: t.text,
      deviationId: null, emailId: t.emailId ?? null, responseId: null, month: null, doneAt: null, doneBy: null, doneNote: null,
    });
  }

  // ---- Testdatans namngivna rader (prototypens S.script, c.tags, ci.tags, S.meta, pi-demo)
  const tags: DemoTag[] = [];
  const caseTags = new Map<string, string[]>();
  for (const c of S.cases) for (const tag of c.tags) caseTags.set(tag, [...(caseTags.get(tag) ?? []), c.id]);
  for (const [tag, caseId] of Object.entries(S.script)) tags.push({ id: tag, tag, entity: "cases", entityIds: [caseId] });
  for (const [tag, ids] of caseTags) if (!(tag in S.script)) tags.push({ id: tag, tag, entity: "cases", entityIds: ids });
  for (const [tag, ids] of Object.entries(meta.checkInTags)) tags.push({ id: tag, tag, entity: "check_ins", entityIds: ids });
  tags.push({ id: "pi-demo", tag: "pi-demo", entity: "pulse_invites", entityIds: meta.pulseDemoIds });
  tags.push({ id: "w4MissingActivityIds", tag: "w4MissingActivityIds", entity: "activities", entityIds: [...S.w4MissingActivityIds] });
  db.demo_tags.push(...tags);

  return db as unknown as MemoryData<Tables>;
}
