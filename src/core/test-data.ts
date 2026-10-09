// BARA FÖR TESTER. Små handgjorda testdata till enhetstesterna i src/core (fält med rimliga standardvärden).
import type {
  Activity, Attendance, BillingRun, Case, CheckIn, Db, Deviation, InvoiceDraft, OutcomeEvent, Person, Placement, PriceItem, Profile, PulseInvite, PulseResponse, Report,
} from "@/data/schema";
import { emptyDb } from "@/data/schema";
import { BOTKYRKA_CONFIG, DEFAULT_ORG_SETTINGS, type OperationalConfig, type OrgSettings } from "./config";
import { domainEnv, type DomainEnv } from "./env";
import type { LocalDateTime } from "./time";

/** Demoklockan: måndag 1 februari 2027 kl. 09.12. */
export const NOW: LocalDateTime = "2027-02-01T09:12";

export function testEnv(opts: { now?: LocalDateTime; cfg?: OperationalConfig; org?: OrgSettings } = {}): DomainEnv {
  return domainEnv({ id: "c-bot", startsOn: "2026-09-10", config: opts.cfg ?? BOTKYRKA_CONFIG }, opts.org ?? DEFAULT_ORG_SETTINGS, opts.now ?? NOW);
}
/** Kopia av Botkyrkas konfiguration med ändringar (för tester av konfigurationsstyrda regler). */
export function cfgWith(patch: (c: OperationalConfig) => void): OperationalConfig {
  const c = structuredClone(BOTKYRKA_CONFIG) as OperationalConfig;
  patch(c);
  return c;
}

export const testDb = (p: Partial<Db> = {}): Db => ({ ...emptyDb(), ...p });

export function mkCase(p: Partial<Case> & { id: string }): Case {
  return {
    caseNumber: `BOT-27-${p.id.replace(/\D/g, "").slice(-4).padStart(4, "0")}`, contractId: "c-bot", personId: `p-${p.id}`, status: "active", source: "email",
    referredAt: "2027-01-04T10:00", referrerId: "k-maria", referrerName: null, referrerUnit: null, referrerPhone: null, referrerEmail: null,
    buyerReference: "55102938", purchaseOrderNumber: null, primaryAreaCode: "G", secondaryAreaCode: null, vocationalTrack: "Lager", desiredStart: null, plannedStart: null,
    plannedWeeks: 10, plannedEnd: null, orderValueWeeks: 10, acknowledgedAt: null, confirmedAt: null, declinedAt: null, declineReason: null, firstMeetingAt: null,
    startDate: null, endDate: null, closedAt: null, endReason: null, resultClass: null, resultVerifiedAt: null, phase: 2, phaseSince: null, leadCoachId: "u-amira",
    backgroundInfo: "", aiConsentStatus: "not_asked", meetingDay: null, meetingTime: null, location: "Alby", pausedWeeks: [], pauseReason: null, sourceEmailId: null,
    orderPeriodMonths: null, orderPeriodReason: null, priorAssessment: null,
    ...p,
  };
}

export function mkPerson(p: Partial<Person> & { id: string }): Person {
  return {
    personnummerEnc: "", personnummerHash: "", personnummerLast4: "", birthYear: null, firstName: "Test", lastName: "Testsson", phone: "", email: "", city: "",
    address: null, preferredContact: "sms", protectedIdentity: false, accessibilityNeeds: "", language: "svenska", needsInterpreter: false, ...p,
  };
}

export const mkActivity = (p: Partial<Activity> & { id: string; caseId: string; startsAt: LocalDateTime }): Activity => ({
  kind: "möte", durationMin: 60, location: "Alby", note: "", groupActivityId: null, ...p,
});

export const mkAttendance = (p: Partial<Attendance> & { activityId: string; caseId: string; status: Attendance["status"] }): Attendance => ({
  id: `at-${p.activityId}`, reason: "", registeredBy: "u-amira", registeredAt: "2027-01-29T16:00", customerNotifiedAt: null, source: "manual", ...p,
});

export const mkCheckIn = (p: Partial<CheckIn> & { id: string; caseId: string; heldAt: LocalDateTime }): CheckIn => ({
  durationMin: 30, mode: "fysiskt", inputMethod: "manual", goalStatus: "yes", nextGoal: "", phase: null, activitiesDone: [], employerContacts: { count: null, types: [] },
  overallStatus: "green", obstacles: [], note: "", status: "approved", approvedBy: "u-amira", approvedAt: p.heldAt, aiRunId: null, docMinutes: null, ai: null, version: 1, ...p,
});

export const mkReport = (p: Partial<Report> & { id: string; kind: Report["kind"] }): Report => ({
  contractId: "c-bot", caseId: null, recipientUserId: null, week: null, month: null, periodStart: null, periodEnd: null, status: "draft", version: 1, dueAt: null,
  approvedBy: null, approvedAt: null, deliveredAt: null, deliveredTo: [], openedAt: null, openedBy: null, provisionalDue: false, pdfPath: null, aiSummaryDraft: null,
  summary: null, summaryAiUsed: false, finalText: null, previousId: null, correctionPending: null, superseded: false, supersededAt: null, supersededBy: null,
  correctionReason: null, correctedBy: null, correctedAt: null, qualityReviewedBy: null, qualityReviewedAt: null, snapshot: null, ...p,
});

export const mkPriceItem = (p: Partial<PriceItem> & { areaCode: string; priceOre: number }): PriceItem => ({
  id: `pi-${p.areaCode}`, contractId: "c-bot", code: `vecka-${p.areaCode}`, unit: "participant_week", packageMonths: null, vatRate: 25, validFrom: "2026-09-10", validTo: "2027-09-09",
  fortnoxArticleNo: `BOT-${p.areaCode}`, exampleOnly: true, ...p,
});

/** En faktura för avtalet och månaden (beslut 2026-10-07: en per avtal och månad, grupp "avtal"). */
export const mkInvoiceDraft = (p: Partial<InvoiceDraft> & { month: string }): InvoiceDraft => ({
  id: `inv-c-bot-${p.month}-${p.groupingKey ?? "avtal"}`, billingRunId: null, contractId: "c-bot", kind: "periodic", caseId: null, groupingKey: "avtal", buyerReference: null,
  purchaseOrderNumber: null, invoicedObject: "332026110", accruedOre: null, remainingOre: null, status: "draft", approvedBy: null, approvedAt: null, manualInvoiceNo: null,
  fortnoxDocumentNumber: null, fortnoxIdempotencyKey: null, fortnoxCreatedAt: null, syncedAt: null, ...p,
});

export const mkBillingRun = (p: Partial<BillingRun> & { month: string }): BillingRun => ({
  id: `br-${p.month}`, contractId: "c-bot", status: "closed", createdBy: "u-lars", createdAt: `${p.month}-28T09:00`, closedAt: null, closedBy: null, ...p,
});

export const mkDeviation = (p: Partial<Deviation> & { id: string; caseId: string; createdAt: LocalDateTime }): Deviation => ({
  description: "Avvikelse", assessment: "", action: "", ownerId: "u-amira", followUpOn: null, needsCustomerDecision: false, followUpMeetingAt: null, status: "open", checkInId: null, ...p,
});

export const mkPlacement = (p: Partial<Placement> & { id: string; caseId: string }): Placement => ({
  employerId: "emp-1", startsOn: "2027-02-15", endsOn: null, tasks: "", supervisorName: "", goals: "", followUpDates: [], status: "planned",
  fourRights: { uppgift: true, handledning: true, timing: true, uppfoljning: true }, ...p,
});

export const mkEvent = (p: Partial<OutcomeEvent> & { id: string; caseId: string; kind: OutcomeEvent["kind"] }): OutcomeEvent => ({
  occurredOn: "2027-01-20", actor: "", verificationKind: null, verificationPath: null, note: "", possibleBonus: false, ...p,
});

export const mkProfile = (p: Partial<Profile> & { id: string; fullName: string }): Profile => ({
  organizationId: "org-mb", email: "", phone: "", title: "", active: true, lastLoginAt: null, customerUnit: null, buyerReferenceId: null, teamRole: null,
  invitedAt: null, invitedBy: null, ...p,
});

export const mkPulseInvite = (p: Partial<PulseInvite> & { id: string; caseId: string; sentAt: LocalDateTime }): PulseInvite => ({
  tokenHash: null, channel: "sms", language: "sv", occasion: "week2", expiresAt: "2027-12-31T00:00", usedAt: null, ...p,
});

export const mkPulseResponse = (p: Partial<PulseResponse> & { id: string; inviteId: string; caseId: string; submittedAt: LocalDateTime }): PulseResponse => ({
  coachId: "u-amira", occasion: "week2", language: "sv", answers: { q1: 4, q2: 4, q3: 4, q4: "jobb", q5: "nej" }, text: "", contactRequested: false, ...p,
});
