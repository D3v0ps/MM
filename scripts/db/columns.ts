// Kolumnerna i Postgres per tabell – facit för migrationerna, seeden och SupabaseRepo.
// Kolumnnamn = fältnamnet i src/data/schema.ts omskrivet mekaniskt till snake_case (snakeCase nedan).
// Typen kontrolleras vid kompilering mot schema.ts (ColumnManifest): varje fält finns, inga extra fält,
// och nullbarheten stämmer. rls-parity.test.ts kontrollerar att databasen efter migrationerna har exakt dessa kolumner.
//
// Typregler (docs: supabase/README.md): LocalDate -> date, LocalDateTime -> timestamptz, öre -> bigint,
// övriga heltal -> integer, andelar/momssats/antal -> numeric, strängar och nycklar -> text,
// listor av strängar -> text[] (datumlistor date[]), objekt och listor av objekt -> jsonb.
import type { TableName, Tables } from "../../src/data/schema";

export type BaseSqlType = "text" | "date" | "timestamptz" | "boolean" | "integer" | "bigint" | "numeric" | "jsonb" | "text[]" | "date[]" | "integer[]" | "uuid";
export type SqlType = BaseSqlType | `${BaseSqlType} | null`;

type Base<V> = [V] extends [boolean]
  ? "boolean"
  : [V] extends [number]
    ? "integer" | "bigint" | "numeric"
    : [V] extends [string]
      ? "text" | "date" | "timestamptz"
      : [V] extends [readonly string[]]
        ? "text[]" | "date[]"
        : [V] extends [readonly number[]]
          ? "integer[]"
          : "jsonb";
/** Kolumntyp för ett fält: nullbar precis när fältet kan vara null. */
type Col<V> = null extends V ? `${Base<NonNullable<V>>} | null` : Base<V>;
export type ColumnManifest = { [N in TableName]: { [K in keyof Tables[N]]-?: Col<Tables[N][K]> } };

export const COLUMNS = {
  organizations: { id: "text", name: "text", orgNr: "text", kind: "text", emailDomains: "text[]" },
  contracts: { id: "text", supplierId: "text", customerId: "text", name: "text", contractNumber: "text", dnr: "text | null", startsOn: "date", endsOn: "date | null", casePrefix: "text", dataRole: "text", config: "jsonb", status: "text", contractManagerId: "text | null" },
  contract_areas: { id: "text", contractId: "text", code: "text", name: "text", active: "boolean" },
  price_items: { id: "text", contractId: "text", areaCode: "text | null", code: "text", unit: "text", packageMonths: "integer | null", priceOre: "bigint", vatRate: "numeric", validFrom: "date", validTo: "date | null", fortnoxArticleNo: "text | null", exampleOnly: "boolean" },
  profiles: { id: "text", organizationId: "text", fullName: "text", email: "text", phone: "text", title: "text", active: "boolean", lastLoginAt: "timestamptz | null", customerUnit: "text | null", buyerReferenceId: "text | null", teamRole: "text | null", invitedAt: "timestamptz | null", invitedBy: "text | null" },
  memberships: { id: "text", userId: "text", contractId: "text", role: "text", customerUnit: "text | null" },
  buyer_references: { id: "text", customerId: "text", reference: "text", unit: "text", active: "boolean", note: "text | null" },
  persons: { id: "text", personnummerEnc: "text", personnummerHash: "text", personnummerLast4: "text", birthYear: "integer | null", firstName: "text", lastName: "text", phone: "text", email: "text", city: "text", address: "text | null", preferredContact: "text", protectedIdentity: "boolean", accessibilityNeeds: "text", language: "text", needsInterpreter: "boolean" },
  cases: { id: "text", caseNumber: "text", contractId: "text", personId: "text", status: "text", source: "text", referredAt: "timestamptz", referrerId: "text | null", referrerName: "text | null", referrerUnit: "text | null", referrerPhone: "text | null", referrerEmail: "text | null", buyerReference: "text | null", purchaseOrderNumber: "text | null", primaryAreaCode: "text | null", secondaryAreaCode: "text | null", vocationalTrack: "text", desiredStart: "date | null", plannedStart: "date | null", plannedWeeks: "integer | null", plannedEnd: "date | null", orderValueWeeks: "integer | null", acknowledgedAt: "timestamptz | null", confirmedAt: "timestamptz | null", declinedAt: "timestamptz | null", declineReason: "text | null", firstMeetingAt: "timestamptz | null", startDate: "date | null", endDate: "date | null", closedAt: "timestamptz | null", endReason: "text | null", resultClass: "text | null", resultVerifiedAt: "timestamptz | null", phase: "integer", phaseSince: "date | null", leadCoachId: "text | null", backgroundInfo: "text", aiConsentStatus: "text", meetingDay: "integer | null", meetingTime: "text | null", location: "text", pausedWeeks: "text[]", pauseReason: "text | null", sourceEmailId: "text | null" },
  case_status_history: { id: "text", caseId: "text", fromStatus: "text | null", toStatus: "text", fromCoach: "text | null", toCoach: "text | null", reason: "text", changedBy: "text", changedAt: "timestamptz", customerNotifiedAt: "timestamptz | null" },
  case_counters: { id: "text", contractId: "text", year: "integer", lastValue: "integer" },
  case_team: { id: "text", caseId: "text", userId: "text", role: "text" },
  inbound_emails: { id: "text", graphMessageId: "text", receivedAt: "timestamptz", fromAddress: "text", fromName: "text", subject: "text", bodyText: "text", attachments: "jsonb", parseMethod: "text", classification: "text", extracted: "jsonb", confidence: "jsonb", missingFields: "text[]", corrections: "jsonb", status: "text", caseId: "text | null", ackSentAt: "timestamptz | null", ackKind: "text | null", aiRunId: "text | null", linkedBy: "text | null", registeredBy: "text | null", registeredAt: "timestamptz | null", handledBy: "text | null", handledAt: "timestamptz | null" },
  intake_assessments: { id: "text", caseId: "text", workExperience: "text", education: "text", languageNotes: "text", digitalSkills: "text", drivingLicence: "text", workGoals: "text", chosenTrack: "text", adaptations: "text", firstWeekGoal: "text", status: "text", approvedBy: "text | null", approvedAt: "timestamptz | null" },
  activities: { id: "text", caseId: "text", kind: "text", startsAt: "timestamptz", durationMin: "integer", location: "text", note: "text" },
  attendance: { id: "text", activityId: "text", caseId: "text", status: "text", reason: "text", registeredBy: "text", registeredAt: "timestamptz", customerNotifiedAt: "timestamptz | null" },
  check_ins: { id: "text", caseId: "text", heldAt: "timestamptz", durationMin: "integer | null", mode: "text | null", inputMethod: "text", goalStatus: "text | null", nextGoal: "text", phase: "integer | null", activitiesDone: "text[]", employerContacts: "jsonb", overallStatus: "text | null", obstacles: "text[]", note: "text", attendanceComment: "text | null", status: "text", approvedBy: "text | null", approvedAt: "timestamptz | null", aiRunId: "text | null", docMinutes: "integer | null", ai: "jsonb | null" },
  monthly_assessments: { id: "text", caseId: "text", month: "text", areas: "jsonb", status: "text", decidedBy: "text | null", decidedAt: "timestamptz | null", summary: "text", aiSummaryDraft: "text | null", overallStatus: "text | null" },
  monthly_plans: { id: "text", caseId: "text", month: "text", goal1: "text", goal2: "text", plannedActivities: "text", plannedEmployerContact: "text", plannedAdaptation: "text", nextCustomerMeeting: "date | null", status: "text" },
  outcome_events: { id: "text", caseId: "text", kind: "text", occurredOn: "date", actor: "text", verificationKind: "text | null", verificationPath: "text | null", note: "text", possibleBonus: "boolean" },
  deviations: { id: "text", caseId: "text", createdAt: "timestamptz", description: "text", assessment: "text", action: "text", ownerId: "text | null", followUpOn: "date | null", needsCustomerDecision: "boolean", followUpMeetingAt: "timestamptz | null", status: "text", checkInId: "text | null", closedAt: "timestamptz | null" },
  contract_deviations: { id: "text", contractId: "text", caseId: "text | null", source: "text", type: "text", level: "text", escalationStep: "integer", description: "text", raisedAt: "timestamptz", registeredBy: "text | null", actionPlan: "text", actionPlanDue: "date | null", ownerId: "text | null", planSubmittedAt: "timestamptz | null", customerApprovedAt: "timestamptz | null", customerApprovedBy: "text | null", warningIssued: "boolean", warningIssuedAt: "timestamptz | null", penaltyKind: "text | null", penaltyOre: "bigint", penaltyOffsetMonth: "text | null", orderStop: "boolean", status: "text", lessons: "text", closedAt: "timestamptz | null", closedBy: "text | null" },
  employers: { id: "text", name: "text", orgNr: "text", contactName: "text", phone: "text", email: "text", areas: "text[]", createdAt: "timestamptz | null", createdBy: "text | null" },
  placements: { id: "text", caseId: "text", employerId: "text", startsOn: "date", endsOn: "date | null", tasks: "text", supervisorName: "text", goals: "text", followUpDates: "date[]", status: "text", fourRights: "jsonb" },
  reports: { id: "text", contractId: "text", caseId: "text | null", recipientUserId: "text | null", kind: "text", week: "text | null", month: "text | null", periodStart: "date | null", periodEnd: "date | null", status: "text", version: "integer", dueAt: "timestamptz | null", approvedBy: "text | null", approvedAt: "timestamptz | null", deliveredAt: "timestamptz | null", deliveredTo: "text[]", openedAt: "timestamptz | null", openedBy: "text | null", provisionalDue: "boolean", pdfPath: "text | null", aiSummaryDraft: "text | null", summary: "text | null", summaryAiUsed: "boolean", finalText: "jsonb | null", previousId: "text | null", correctionPending: "text | null", superseded: "boolean", supersededAt: "timestamptz | null", supersededBy: "text | null", correctionReason: "text | null", correctedBy: "text | null", correctedAt: "timestamptz | null", qualityReviewedBy: "text | null", qualityReviewedAt: "timestamptz | null", snapshot: "jsonb | null" },
  pulse_invites: { id: "text", caseId: "text", tokenHash: "text | null", channel: "text", language: "text", occasion: "text", sentAt: "timestamptz", expiresAt: "timestamptz", usedAt: "timestamptz | null" },
  pulse_responses: { id: "text", inviteId: "text", caseId: "text", coachId: "text | null", occasion: "text", language: "text", answers: "jsonb", text: "text", contactRequested: "boolean", submittedAt: "timestamptz" },
  bonus_claims: { id: "text", caseId: "text", kind: "text", basis: "text", evidencePaths: "text[]", submittedAt: "timestamptz | null", customerDecision: "text | null", decidedBy: "text | null", decidedAt: "timestamptz | null", amountOre: "bigint | null", invoiceDraftId: "text | null" },
  kpi_snapshots: { id: "text", contractId: "text", kpiKey: "text", window: "text", value: "numeric | null", numerator: "integer", denominator: "integer", computedAt: "timestamptz" },
  alerts: { id: "text", key: "text", contractId: "text", caseId: "text | null", kind: "text", severity: "text", title: "text", message: "text", recipientRoles: "text[]", createdAt: "timestamptz", acknowledgedBy: "text | null", acknowledgedAt: "timestamptz | null", actionPlan: "text | null" },
  alert_acks: { id: "text", alertKey: "text", acknowledgedBy: "text", acknowledgedAt: "timestamptz", actionPlan: "text" },
  deadlines: { id: "text", contractId: "text", caseId: "text | null", reportId: "text | null", kind: "text", dueAt: "timestamptz", metAt: "timestamptz | null", status: "text" },
  billing_runs: { id: "text", contractId: "text", month: "text", status: "text", createdBy: "text", createdAt: "timestamptz", closedAt: "timestamptz | null", closedBy: "text | null", defaultInvoiceStatus: "text | null" },
  invoice_drafts: { id: "text", billingRunId: "text | null", contractId: "text", month: "text", kind: "text", caseId: "text | null", groupingKey: "text", buyerReference: "text | null", purchaseOrderNumber: "text | null", invoicedObject: "text", accruedOre: "bigint | null", remainingOre: "bigint | null", status: "text", approvedBy: "text | null", approvedAt: "timestamptz | null", manualInvoiceNo: "text | null", fortnoxDocumentNumber: "text | null", fortnoxIdempotencyKey: "text | null", fortnoxCreatedAt: "timestamptz | null", syncedAt: "timestamptz | null" },
  invoice_lines: { id: "text", invoiceDraftId: "text", caseId: "text", priceItemId: "text", quantity: "numeric", unitPriceOre: "bigint", vatRate: "numeric", description: "text", isoWeeks: "text[]", zeroAttendanceWeeks: "text[]" },
  billing_week_approvals: { id: "text", contractId: "text", month: "text", caseId: "text", weekKey: "text", approvedBy: "text", approvedAt: "timestamptz", note: "text" },
  invoice_credits: { id: "text", contractId: "text", month: "text", caseId: "text", creditedAt: "timestamptz", creditedBy: "text", buyerReference: "text | null" },
  fortnox_runs: { id: "text", contractId: "text", month: "text", kind: "text", ranAt: "timestamptz", ranBy: "text", created: "integer", skipped: "integer", notReady: "integer", blocked: "integer", changed: "integer" },
  integrations: { id: "text", kind: "text", name: "text", status: "text", config: "jsonb", secretsEnc: "text | null", tokenExpiresAt: "timestamptz | null" },
  jobs: { id: "text", kind: "text", payload: "jsonb", status: "text", attempts: "integer", runAfter: "timestamptz", lastError: "text | null", createdAt: "timestamptz", createdBy: "text | null", finishedAt: "timestamptz | null", startedAt: "timestamptz | null" },
  ai_runs: { id: "text", caseId: "text | null", kind: "text", provider: "text", model: "text", inputRef: "text | null", status: "text", createdAt: "timestamptz", audioSeconds: "integer | null", tokensIn: "integer | null", tokensOut: "integer | null", costOre: "bigint", latencyMs: "integer | null", output: "jsonb | null", evidence: "jsonb | null", inputDeletedAt: "timestamptz | null" },
  ai_field_decisions: { id: "text", aiRunId: "text | null", field: "text", suggested: "jsonb | null", final: "jsonb | null", decision: "text", changed: "boolean", decidedBy: "text", decidedAt: "timestamptz" },
  consents: { id: "text", personId: "text", caseId: "text", kind: "text", textVersion: "text", givenAt: "timestamptz | null", declinedAt: "timestamptz | null", informedBy: "text", language: "text | null", revokedAt: "timestamptz | null" },
  messages: { id: "text", caseId: "text", senderId: "text", body: "text", createdAt: "timestamptz", readBy: "text[]", readAt: "timestamptz | null", kind: "text | null" },
  audit_log: { id: "text", occurredAt: "timestamptz", actorId: "text | null", action: "text", entity: "text", entityId: "text | null", contractId: "text | null", details: "jsonb" },
  holidays: { id: "text", date: "date", name: "text" },
  outbound_messages: { id: "text", createdAt: "timestamptz", channel: "text", to: "text", template: "text", subject: "text | null", body: "text", caseId: "text | null", status: "text", sentAt: "timestamptz | null", statusReason: "text | null", providerMessageId: "text | null" },
  user_notifications: { id: "text", recipientId: "text", kind: "text", caseId: "text | null", createdAt: "timestamptz", channels: "text[]", title: "text", body: "text", emailBody: "text" },
  notification_reads: { id: "text", userId: "text", notificationKey: "text", readAt: "timestamptz" },
  tasks: { id: "text", toRole: "text", toId: "text | null", fromId: "text", createdAt: "timestamptz", status: "text", kind: "text | null", caseIds: "text[]", text: "text", deviationId: "text | null", emailId: "text | null", responseId: "text | null", month: "text | null", doneAt: "timestamptz | null", doneBy: "text | null", doneNote: "text | null" },
  org_settings: { id: "text", organizationId: "text", settings: "jsonb", updatedAt: "timestamptz | null", updatedBy: "text | null" },
  case_seen: { id: "text", userId: "text", caseId: "text", seenAt: "timestamptz" },
  template_versions: { id: "text", templateKey: "text", version: "integer", subject: "text", body: "text", savedAt: "timestamptz", savedBy: "text", note: "text" },
  log_checks: { id: "text", month: "text", items: "jsonb", note: "text", signedBy: "text", signedAt: "timestamptz" },
  demo_tags: { id: "text", tag: "text", entity: "text", entityIds: "text[]" },
} as const satisfies ColumnManifest;

/** Extra kolumner som bara finns i databasen (inte i schema.ts). Läses av SupabaseRepo men används inte av hanterarna. */
export const EXTRA_COLUMNS: Partial<Record<TableName, Record<string, SqlType>>> = {
  // Inloggning (Supabase Auth) och testare i testmiljön – skrivs bara med service role (triggern mm.protect_profile_columns).
  profiles: { authUserId: "uuid | null", isTester: "boolean" },
};

/** camelCase -> snake_case (samma regel som SupabaseRepo): caseNumber -> case_number, q1 -> q1. */
export const snakeCase = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Kolumnnamn som är reserverade ord i Postgres och därför skrivs inom citattecken i SQL. */
export const RESERVED_COLUMNS = new Set(["to", "window"]);
export const quoteIdent = (col: string): string => (RESERVED_COLUMNS.has(col) || /[^a-z0-9_]/.test(col) ? `"${col.replace(/"/g, '""')}"` : col);
