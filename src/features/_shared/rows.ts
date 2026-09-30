// Nya rader med alla fält satta (samma standardvärden som testdatat i src/data/seed/map.ts). Bara för hanterare.
import type { AreaAssessment, CheckIn, IntakeAssessment, InvoiceDraft, MonthlyAssessment, MonthlyPlan, Report } from "@/data/schema";

type ReportCore = Pick<Report, "id" | "contractId" | "kind" | "status" | "periodStart" | "periodEnd" | "dueAt">;

/** En rapport där bara de fält som skiljer anges. */
export function newReport(r: ReportCore & Partial<Report>): Report {
  return {
    caseId: null, recipientUserId: null, week: null, month: null, version: 1, approvedBy: null, approvedAt: null, deliveredAt: null, deliveredTo: [],
    openedAt: null, openedBy: null, provisionalDue: false, pdfPath: null, aiSummaryDraft: null, summary: null, summaryAiUsed: false, finalText: null,
    previousId: null, correctionPending: null, superseded: false, supersededAt: null, supersededBy: null, correctionReason: null, correctedBy: null,
    correctedAt: null, qualityReviewedBy: null, qualityReviewedAt: null, snapshot: null,
    ...r,
  };
}

/** En ny avstämning (utkast). */
export function newCheckIn(r: Pick<CheckIn, "id" | "caseId" | "heldAt">): CheckIn {
  return {
    durationMin: null, mode: null, inputMethod: "manual", goalStatus: null, nextGoal: "", phase: null, activitiesDone: [], employerContacts: { count: null, types: [] },
    overallStatus: null, obstacles: [], note: "", status: "draft", approvedBy: null, approvedAt: null, aiRunId: null, docMinutes: null, ai: null,
    ...r,
  };
}

/** En ny månadsbedömning (utkast) utan områden. */
export function newAssessment(r: Pick<MonthlyAssessment, "id" | "caseId" | "month">): MonthlyAssessment {
  return { areas: {}, status: "draft", decidedBy: null, decidedAt: null, summary: "", aiSummaryDraft: null, overallStatus: null, ...r };
}

/** Ett progressionsområde utan bedömning. Nivån är tom tills coachen valt (CLAUDE.md punkt 5). */
export const blankArea = (): AreaAssessment => ({ level: null, observation: "", nextStep: "", aiLevelSuggestion: null, aiObservationDraft: null });

/** En ny plan för nästa månad (utkast). */
export function newPlan(r: Pick<MonthlyPlan, "id" | "caseId" | "month">): MonthlyPlan {
  return { goal1: "", goal2: "", plannedActivities: "", plannedEmployerContact: "", plannedAdaptation: "", nextCustomerMeeting: null, status: "draft", ...r };
}

/** En ny kartläggning (utkast). */
export function newIntake(r: Pick<IntakeAssessment, "id" | "caseId">): IntakeAssessment {
  return {
    workExperience: "", education: "", languageNotes: "", digitalSkills: "", drivingLicence: "", workGoals: "", chosenTrack: "", adaptations: "", firstWeekGoal: "",
    status: "draft", approvedBy: null, approvedAt: null, ...r,
  };
}

/** Fakturans id per ärende och månad (samma som prototypens och fakturaunderlagets, src/core/billing.ts). */
export const invoiceDraftId = (month: string, caseId: string): string => `inv-${month}-${caseId}`;

/** Ett nytt fakturautkast för ärendet och månaden (status draft = ingen egen status, se invoiceStatus i src/core/billing.ts). */
export function newInvoiceDraft(r: Pick<InvoiceDraft, "month" | "caseId" | "contractId" | "billingRunId" | "buyerReference" | "purchaseOrderNumber" | "invoicedObject"> & { caseId: string }): InvoiceDraft {
  return {
    id: invoiceDraftId(r.month, r.caseId), kind: "periodic", groupingKey: `${r.month}:${r.caseId}`, accruedOre: null, remainingOre: null, status: "draft",
    approvedBy: null, approvedAt: null, manualInvoiceNo: null, fortnoxDocumentNumber: null, fortnoxIdempotencyKey: null, fortnoxCreatedAt: null, syncedAt: null,
    ...r,
  };
}
