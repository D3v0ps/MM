// Generatorns arbetsminne: prototypens datastruktur (prototyp/src/01-seed.js, "S") under tiden testdata byggs.
// Ärenden, användare och personer har prototypens fältnamn här och mappas till tabellerna i map.ts.
// Övriga rader byggs direkt i tabellernas form (schema.ts) – fältnamnen är desamma som i prototypen.
//
// VIKTIGT: slumpen (rng) och löpnumret (seq) anropas i exakt samma ordning som i prototypen.
// Ändra aldrig ordningen på anrop, villkor med kortslutning (&&, ||, ?:) eller fältordning i objekt som anropar slumpen.
import { rng, type Rng } from "@/core/util";
import type {
  Activity, AiConsentStatus, AiRun, Attendance, CaseSource, CaseStatus, CaseStatusHistory, CheckIn, Consent, ContractDeviation, Deviation,
  EmailAttachment, EmailClassification, EndReason, InboundEmail, IntakeAssessment, Message, MonthlyAssessment, MonthlyPlan, OrderExtract,
  OutcomeEvent, Placement, PreferredContact, PulseInvite, PulseResponse, Report, ResultClass, TeamRole, UserNotification, AuditLogEntry,
  InboundEmailStatus, ParseMethod, OrderField, Task, OutboundChannel, InvoiceStatus,
} from "../schema";

export type PUser = {
  id: string; name: string; title: string; role: string; org: "mb" | "customer"; email: string; phone: string; active: boolean;
  teamRole?: TeamRole; unit?: string; buyerReferenceId?: string | null; lastLoginAt?: string | null;
};
export type PBuyerRef = { id: string; customer: string; reference: string; unit: string; active: boolean; note?: string };
export type PPerson = {
  id: string; firstName: string; lastName: string; pnr: string; pnrLast4: string; birthYear: number | null; phone: string; email: string; city: string;
  address: string | null; preferredContact: PreferredContact; protectedIdentity: boolean; accessibilityNeeds: string; language: string; needsInterpreter: boolean;
};
export type PersonOverride = Partial<Omit<PPerson, "id" | "pnr" | "pnrLast4" | "birthYear">>;
export type PTeam = { userId: string; role: TeamRole };
export type PCase = {
  id: string; number: string; contractId: string; personId: string | null; status: CaseStatus; source: CaseSource; referredAt: string; referrerId: string;
  buyerReference: string | null; purchaseOrderNumber: string | null; primaryArea: string; secondaryArea: string | null; vocationalTrack: string;
  desiredStart: string; plannedWeeks: number; plannedEnd: string | null; acknowledgedAt: string; confirmedAt: string | null; firstMeetingAt: string | null;
  startDate: string | null; endDate: string | null; endReason: EndReason | null; resultClass: ResultClass | null; resultVerifiedAt: string | null; phase: number;
  leadCoachId: string | null; team: PTeam[]; backgroundInfo: string; aiConsent: AiConsentStatus; meetingDay: number | null; meetingTime: string | null;
  location: string; pausedWeeks: string[]; pauseReason?: string; tags: string[]; declineReason: string | null; orderValueWeeks: number; closedAt: string | null;
  phaseSince?: string;
  // Hjälpfält som bara används medan testdata byggs (finns inte i tabellerna).
  forcePhase?: number; forcedEnd?: { date: string; reason: EndReason; verified?: boolean }; interrupted?: boolean; noMeeting?: boolean;
  coachChange?: { from: string; at: string; reason: string };
};
/** Utskick i prototypens form (S.notifications). */
export type PNotification = { id: string; at: string; channel: OutboundChannel; to: string; template: string; body: string; caseId: string | null };
/** Mejl i prototypens form – mappas till InboundEmail (bilagor får path, saknade fält blir null). */
export type PEmail = {
  id: string; graphMessageId: string; receivedAt: string; fromAddress: string; fromName: string; subject: string; bodyText: string;
  attachments: Omit<EmailAttachment, "path">[]; parseMethod: ParseMethod; classification: EmailClassification; extracted: OrderExtract;
  confidence: Partial<Record<OrderField, number>>; missingFields: OrderField[]; status: InboundEmailStatus; caseId: string | null;
  ackSentAt: string | null; ackKind?: InboundEmail["ackKind"]; aiRunId?: string; linkedBy?: string; handledBy: string | null; handledAt: string | null;
};
/** Rapport i prototypens form: bara de fält seeden sätter. Övriga fält får standardvärden i map.ts. */
export type PReport = Pick<Report, "id" | "contractId" | "kind" | "periodStart" | "periodEnd" | "status" | "version" | "dueAt" | "approvedBy" | "approvedAt" | "deliveredAt" | "deliveredTo" | "openedAt"> &
  Partial<Pick<Report, "caseId" | "recipientUserId" | "week" | "month" | "provisionalDue" | "aiSummaryDraft">>;
export type PContractDeviation = Pick<ContractDeviation, "id" | "contractId" | "source" | "type" | "level" | "escalationStep" | "description" | "raisedAt" | "actionPlan" | "actionPlanDue" | "customerApprovedAt" | "warningIssued" | "penaltyOre" | "status" | "lessons">;
export type PPulseInvite = Omit<PulseInvite, "tokenHash"> & { demo?: boolean };
export type PAiRun = Pick<AiRun, "id" | "caseId" | "kind" | "provider" | "model" | "status" | "createdAt" | "costOre" | "latencyMs"> & Partial<Pick<AiRun, "audioSeconds" | "inputDeletedAt">>;
export type PTask = Pick<Task, "id" | "toRole" | "fromId" | "createdAt" | "status" | "text"> & Partial<Pick<Task, "caseIds" | "emailId">>;
export type PConsent = Omit<Consent, "declinedAt"> & { declinedAt?: string | null };
/** Tillfälle och närvaro som i prototypen: gruppaktiviteten och närvarons källa (0030) läggs till i map.ts. */
export type PActivity = Omit<Activity, "groupActivityId">;
export type PAttendance = Omit<Attendance, "source">;
export type PCheckIn = Omit<CheckIn, "ai" | "version"> & { ai?: CheckIn["ai"]; tags?: string[] };
export type POutcomeEvent = Omit<OutcomeEvent, "possibleBonus"> & { possibleBonus?: boolean };
export type PBillingRun = { id: string; month: string; status: "draft" | "closed"; createdBy: string; createdAt: string };

export type ProtoState = {
  seq: number;
  users: PUser[]; customerUsers: PUser[]; buyerReferences: PBuyerRef[]; persons: PPerson[]; cases: PCase[];
  caseCounters: Record<string, number>; caseStatusHistory: (Omit<CaseStatusHistory, "fromCoach" | "toCoach" | "customerNotifiedAt"> & Partial<Pick<CaseStatusHistory, "fromCoach" | "toCoach" | "customerNotifiedAt">>)[];
  inboundEmails: PEmail[]; intakeAssessments: Omit<IntakeAssessment, "version">[]; activities: PActivity[]; attendance: PAttendance[]; checkIns: PCheckIn[];
  monthlyAssessments: Omit<MonthlyAssessment, "version">[]; monthlyPlans: MonthlyPlan[]; outcomeEvents: POutcomeEvent[]; deviations: Omit<Deviation, "checkInId">[];
  contractDeviations: PContractDeviation[]; employers: { id: string; name: string; orgNr: string; contactName: string; phone: string; email: string; areas: string[] }[];
  placements: Placement[]; reports: PReport[]; pulseInvites: PPulseInvite[]; pulseResponses: PulseResponse[]; messages: Omit<Message, "kind">[];
  invoiceStatus: Record<string, Record<string, InvoiceStatus>>; billingRuns: PBillingRun[]; consents: PConsent[]; aiRuns: PAiRun[];
  auditLog: AuditLogEntry[]; notifications: PNotification[]; tasks: PTask[]; userNotifications: UserNotification[];
  notifRead: Record<string, Record<string, string>>; w4MissingActivityIds: string[]; script: Record<string, string>;
};

/** Generatorns gemensamma tillstånd. */
export type Gen = {
  r: Rng;
  S: ProtoState;
  /** Prototypens nid(p): `${p}-${++S.seq}`. */
  nid(prefix: string): string;
  cases: PCase[];
  script: Record<string, PCase>;
  /** Kommunanvändarens sparade beställarreferens. */
  brFor(kid: string): string;
  makePerson(over?: PersonOverride): PPerson;
  customerUser(id: string): PUser;
  personOf(c: PCase): PPerson;
  /** Stängda ärenden i den ordning livscykeln hittade dem. */
  closed: PCase[];
  /** Fas vid ett visst datum (prototypens phaseAt). */
  phaseAt(c: PCase, day: string): number;
  /** Uppslag för snabbare körning (samma resultat som prototypens find/filter). */
  idx: {
    personById: Map<string, PPerson>;
    attendanceByActivity: Map<string, PAttendance>;
    activitiesByCase: Map<string, PActivity[]>;
    checkInsByCase: Map<string, PCheckIn[]>;
  };
};

export function createGen(): Gen {
  const S: ProtoState = {
    seq: 5000,
    users: [], customerUsers: [], buyerReferences: [], persons: [], cases: [], caseCounters: {}, caseStatusHistory: [], inboundEmails: [],
    intakeAssessments: [], activities: [], attendance: [], checkIns: [], monthlyAssessments: [], monthlyPlans: [], outcomeEvents: [], deviations: [],
    contractDeviations: [], employers: [], placements: [], reports: [], pulseInvites: [], pulseResponses: [], messages: [], invoiceStatus: {},
    billingRuns: [], consents: [], aiRuns: [], auditLog: [], notifications: [], tasks: [], userNotifications: [], notifRead: {},
    w4MissingActivityIds: [], script: {},
  };
  const gen: Gen = {
    r: rng(20270201),
    S,
    nid: (p) => `${p}-${++S.seq}`,
    cases: [],
    script: {},
    brFor: (kid) => {
      const u = S.customerUsers.find((x) => x.id === kid);
      const br = S.buyerReferences.find((b) => b.id === u?.buyerReferenceId);
      if (!br) throw new Error(`Beställarreferens saknas för ${kid}`);
      return br.reference;
    },
    makePerson: () => { throw new Error("makePerson är inte initierad"); },
    customerUser: (id) => {
      const u = S.customerUsers.find((x) => x.id === id);
      if (!u) throw new Error(`Kommunanvändare saknas: ${id}`);
      return u;
    },
    personOf: (c) => {
      const p = c.personId ? gen.idx.personById.get(c.personId) : undefined;
      if (!p) throw new Error(`Person saknas för ${c.id}`);
      return p;
    },
    closed: [],
    phaseAt: () => 1,
    idx: { personById: new Map(), attendanceByActivity: new Map(), activitiesByCase: new Map(), checkInsByCase: new Map() },
  };
  return gen;
}

export const pad2 = (n: number) => String(n).padStart(2, "0");
