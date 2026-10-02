// Kontrakt för området ärenden (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import {
  CASE_SOURCES, END_REASONS, PREFERRED_CONTACTS, TEAM_ROLES,
  type ActivityKind, type AiConsentStatus, type AlertKind, type AlertSeverity, type AttendanceStatus, type CaseStatus, type CheckInMode, type FourRights,
  type GoalStatus, type OutcomeEventKind, type PlacementStatus, type ReportKind, type ReportStatus, type ResultClass, type TrafficLight,
} from "@/data/schema";
import type { SlaTone } from "@/core/sla";
import { IdSchema, LocalDateSchema, LocalDateTimeSchema, LongText, ShortText, WeekKeySchema } from "../_shared/schemas";

// ---- Delade kommandon (portade från prototypens 03-domain.js)
// Samma beteende, valideringar, felkoder och texter som prototypens MM.defineAction. Nyckeln är "arenden.<prototypens namn>".
// Affärsfel returneras som { ok: false, error, message } – message är en text till användaren (klarspråk).
// Gemensamma felkoder: not_found = ärendet finns inte eller rollen får inte se det, forbidden = rollen får se men inte ändra.

/**
 * Ny beställning (portalen, telefon eller manuellt från mejl) – prototypens case.create.
 * Ger nästa ärendenummer i avtalets serie och skickar ordererkännande (eller generisk mottagningsbekräftelse vid
 * skyddade personuppgifter, plus en uppgift till avtalsansvarig). Kommunens handläggare beställer alltid i eget namn.
 * contractId: utelämnas = användarens aktiva avtal. Personnummer krypteras innan det sparas och skickas aldrig tillbaka.
 */
export const caseCreate = command("arenden.caseCreate", z.object({
  contractId: IdSchema.optional(),
  protectedIdentity: z.boolean().optional(),
  source: z.enum(CASE_SOURCES).optional(),
  /** Beställande handläggare. Ignoreras för kommunens handläggare (alltid den inloggade). */
  referrerId: IdSchema.nullable().optional(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  pnr: z.string().max(20).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  /** Bara när kontaktvägen är brev. Sparas aldrig vid skyddade personuppgifter. */
  address: z.string().max(300).nullable().optional(),
  preferredContact: z.enum(PREFERRED_CONTACTS).optional(),
  accessibilityNeeds: z.string().max(1000).optional(),
  language: z.string().max(60).optional(),
  needsInterpreter: z.boolean().optional(),
  buyerReference: z.string().max(40).optional(),
  purchaseOrderNumber: z.string().max(40).nullable().optional(),
  primaryArea: z.string().max(10).nullable().optional(),
  secondaryArea: z.string().max(10).nullable().optional(),
  vocationalTrack: z.string().max(200).optional(),
  desiredStart: LocalDateSchema.nullable().optional(),
  plannedWeeks: z.number().int().min(1).max(52).nullable().optional(),
  plannedEnd: LocalDateSchema.nullable().optional(),
  background: z.string().max(4000).optional(),
})).returns<Result<{ caseId: string; caseNumber: string }, "buyer_ref" | "po_number" | "duplicate" | "referrer" | "forbidden" | "no_contract">>();

/**
 * Acceptera avrop → orderbekräftelse (prototypens case.accept). Beställarreferensen valideras mot avtalets mönster
 * innan något sparas. Skapar orderbekräftelsen (levererad i portalen), teamet, notiser till coach och team, mejl till
 * kommunen och kallelse till deltagaren (aldrig vid skyddade personuppgifter).
 * Omfattar även prototypens ink.acceptProtected: vid skyddade personuppgifter skickas ingen kallelse och det loggas
 * (notify.suppressed). Samordnaren får forbidden – skyddade avrop hanteras av avtalsansvarig.
 * buyerReference: utelämnas = ärendets nuvarande referens.
 */
export const caseAccept = command("arenden.caseAccept", z.object({
  caseId: IdSchema,
  leadCoachId: IdSchema,
  firstMeetingAt: LocalDateTimeSchema.optional(),
  startDate: LocalDateSchema.optional(),
  plannedWeeks: z.number().int().min(1).max(52).optional(),
  buyerReference: z.string().max(40).nullable().optional(),
  team: z.array(z.object({ userId: IdSchema, role: z.enum(TEAM_ROLES) })).max(10).optional(),
})).returns<Result<{ reportId: string; caseNumber: string }, "not_found" | "buyer_ref" | "wrong_status" | "forbidden" | "coach" | "team">>();

/** Avböj avrop med orsak (prototypens case.decline). Kommunen får ett mejl utan personuppgifter. */
export const caseDecline = command("arenden.caseDecline", z.object({
  caseId: IdSchema,
  reason: z.string().max(2000),
})).returns<Result<object, "not_found" | "reason" | "wrong_status" | "forbidden">>();

/** Fält som kan ändras med arenden.caseUpdate. Kommunens handläggare får bara ändra beställarens kontaktuppgifter. */
export const CasePatchSchema = z.strictObject({
  referrerName: ShortText.nullable(),
  referrerUnit: ShortText.nullable(),
  referrerPhone: z.string().max(40).nullable(),
  referrerEmail: z.string().max(200).nullable(),
  desiredStart: LocalDateSchema.nullable(),
  plannedStart: LocalDateSchema.nullable(),
  plannedWeeks: z.number().int().min(1).max(52).nullable(),
  plannedEnd: LocalDateSchema.nullable(),
  orderValueWeeks: z.number().int().min(1).max(104).nullable(),
  meetingDay: z.number().int().min(0).max(6).nullable(),
  meetingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  location: ShortText,
  vocationalTrack: ShortText,
  secondaryAreaCode: z.string().max(10).nullable(),
  purchaseOrderNumber: z.string().max(40).nullable(),
  pausedWeeks: z.array(WeekKeySchema).max(60),
  pauseReason: ShortText.nullable(),
  backgroundInfo: z.string().max(4000),
}).partial();
export type CasePatch = z.infer<typeof CasePatchSchema>;
export const CUSTOMER_PATCH_FIELDS = ["referrerName", "referrerUnit", "referrerPhone", "referrerEmail"] as const satisfies readonly (keyof CasePatch)[];

/**
 * Ändra ärendefält med revisionslogg (prototypens case.update). Prototypens patch ordererContact { name, unit, phone, email }
 * motsvaras av referrerName, referrerUnit, referrerPhone och referrerEmail.
 */
export const caseUpdate = command("arenden.caseUpdate", z.object({
  caseId: IdSchema,
  patch: CasePatchSchema,
})).returns<Result<{ changed: string[] }, "not_found" | "forbidden" | "po_number">>();

/** Ändra beställarreferens (prototypens case.setBuyerRef). source = t.ex. uppgiftens id eller "ekonom". */
export const caseSetBuyerRef = command("arenden.caseSetBuyerRef", z.object({
  caseId: IdSchema,
  reference: z.string().max(40),
  source: ShortText.optional(),
})).returns<Result<object, "not_found" | "buyer_ref" | "forbidden">>();

/** Boka första mötet (prototypens case.bookFirstMeeting). Kallelse via föredragen kontaktväg – aldrig vid skyddade personuppgifter. */
export const caseBookFirstMeeting = command("arenden.caseBookFirstMeeting", z.object({
  caseId: IdSchema,
  at: LocalDateTimeSchema,
})).returns<Result<object, "not_found" | "forbidden">>();

/** Byt huvudcoach med orsak (prototypens case.changeCoach). Nya coachen och kommunen får notis utan personuppgifter. */
export const caseChangeCoach = command("arenden.caseChangeCoach", z.object({
  caseId: IdSchema,
  toCoachId: IdSchema,
  reason: z.string().max(2000),
})).returns<Result<object, "not_found" | "reason" | "coach" | "forbidden">>();

/**
 * Avsluta insatsen (prototypens case.close): resultatklass enligt avtalets resultatdefinition, utkast till slutrapport
 * och exit-pulsmätning (inte vid skyddade personuppgifter). verified = arbete/studier är verifierat.
 */
export const caseClose = command("arenden.caseClose", z.object({
  caseId: IdSchema,
  endDate: z.union([LocalDateSchema, z.literal("")]).nullable().optional(),
  endReason: z.union([z.enum(END_REASONS), z.literal("")]).nullable().optional(),
  verified: z.boolean().optional(),
})).returns<Result<{ reportId: string; resultClass: ResultClass }, "not_found" | "missing" | "forbidden" | "wrong_status">>();

/**
 * Säkert meddelande i ärendet (prototypens message.send). Från Miljonbemanning: kommunen får ett mejl utan innehåll.
 * Från kommunen: huvudcoachen får en notis i appen och ett mejl. Bara beställande handläggare skriver från kommunen.
 */
export const messageSend = command("arenden.messageSend", z.object({
  caseId: IdSchema,
  body: LongText,
})).returns<Result<{ messageId: string }, "not_found" | "forbidden" | "empty">>();

/** Läskvitto: markera andras meddelanden i ärendet som lästa (prototypens message.read, tyst). Gör inget för läsroller. */
export const messageRead = command("arenden.messageRead", z.object({
  caseId: IdSchema,
})).returns<Result<{ marked: number }, "not_found">>();

/** Samtycke till inspelning och AI (prototypens consent.set). Kan inte registreras vid skyddade personuppgifter. */
export const consentSet = command("arenden.consentSet", z.object({
  caseId: IdSchema,
  value: z.enum(["given", "declined", "revoked"]),
  /** Språket informationen gavs på (standard "lättläst svenska"). */
  language: z.string().max(60).optional(),
})).returns<Result<object, "not_found" | "protected" | "forbidden">>();

// ---- Skärmarna i området ärenden (prototypens views/arenden.js: arenden.lista, arende.kort, hand.start)
// Varje fråga returnerar en vy-modell med bara det skärmen visar och rollen får se. Personnummer skickas bara maskerat.
// Behörighet per ärende enligt caseAccess (src/core/access.ts): full = allt, team = handledare/teammedlem (ingen
// coachanteckning, bedömning eller rapport), restricted = bara ärendenummer och status (skyddade personuppgifter).

/** Närvarostatistik (prototypens sel.attendanceStats). rate = (närvarande + sena) / registrerade, null om inget registrerats. */
export type AttendanceSummary = {
  planned: number;
  present: number;
  late: number;
  absentValid: number;
  absentInvalid: number;
  unregistered: number;
  rate: number | null;
};
/** Flagga (prototypens sel.alerts) för rollen – coach och handledare ser aldrig eskaleringar till chef. */
export type CaseFlag = {
  key: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  text: string;
  /** Sökvägen flaggan leder till. */
  href: string;
  /** Leder flaggan till en flik i samma deltagarkort? Då byter knappen flik ("Visa"). tab null = översikten. */
  sameCase: { tab: string | null } | null;
  /** Prototypens vy-id för länken (för att avgöra om rollen får öppna den). */
  view: string;
};

// ---------------------------------------------------------------- Ärendelistan (/arenden)
export type CaseListDetail = {
  areaCode: string | null;
  /** "G Lager och logistik" */
  areaName: string;
  vocationalTrack: string;
  phase: number;
  phaseName: string;
  leadCoachId: string | null;
  leadCoachName: string | null;
  /** Start: startdatum, annars planerat första möte, annars önskad start. */
  start: string | null;
  /** Visas under datumet när insatsen inte har startat. */
  startNote: "planerad start" | "önskad start" | null;
  /** Avslutsdatum, annars planerat slut. */
  end: string | null;
  /** Samlad status i senaste godkända avstämningen. */
  latest: { overallStatus: TrafficLight | null; heldAt: string } | null;
  /** De fyra senaste hela ISO-veckorna. */
  attendance: AttendanceSummary;
  flags: CaseFlag[];
  /** Olästa meddelanden från kommunen till den inloggade (0 för chef och systemadmin). */
  unread: number;
};
export type CaseListRow = {
  id: string;
  caseNumber: string;
  status: CaseStatus;
  referredAt: string;
  /** Sorteringsnyckel "planerat slut – närmast först" (avslutade och avböjda sist). */
  endSortKey: string;
  /** Skyddade personuppgifter och rollen ser bara att ärendet finns. */
  restricted: boolean;
  /** Namnet ("Skyddade personuppgifter" när rollen bara ser ärendenumret). Används också i sökningen. */
  displayName: string;
  protectedIdentity: boolean;
  /** Ärendet har flaggor för rollen. */
  flagged: boolean;
  /** Allvarligaste flaggan: 0 kritisk, 1 varning, 2 information, 9 ingen (sortering "Flaggade först"). */
  flagRank: number;
  /** Null när rollen bara ser ärendenumret. */
  detail: CaseListDetail | null;
};
export type CaseListModel = {
  customerName: string;
  today: string;
  /** De fyra senaste hela ISO-veckorna ("v. 1–4"). */
  weeks: { from: string; to: string; label: string };
  coaches: { id: string; name: string }[];
  areas: { code: string; name: string }[];
  phases: { no: number; name: string }[];
  rows: CaseListRow[];
};
export const caseList = query("arenden.lista", z.object({})).returns<CaseListModel>();

// ---------------------------------------------------------------- Deltagarkortet (/arenden/:caseId)
export type CaseTab = "oversikt" | "kartlaggning" | "avstamningar" | "narvaro" | "manad" | "handelser" | "avvikelser" | "praktik" | "rapporter" | "meddelanden" | "historik";
export const CASE_TABS = ["oversikt", "kartlaggning", "avstamningar", "narvaro", "manad", "handelser", "avvikelser", "praktik", "rapporter", "meddelanden", "historik"] as const satisfies readonly CaseTab[];
/** Flikarna som teamet (handledare) ser – inga coachanteckningar, bedömningar eller rapporter. */
export const TEAM_TABS = ["oversikt", "narvaro", "praktik", "handelser"] as const satisfies readonly CaseTab[];

export type CaseCard = {
  kind: "ok";
  /** Klockan när frågan räknades (förval och kontroller i formulären). */
  now: string;
  caseId: string;
  caseNumber: string;
  displayName: string;
  access: "full" | "team";
  /** Får ändra i ärendet: samordnare och avtalsansvarig, huvudcoachen i egna ärenden. */
  edit: boolean;
  /** Samordnare eller avtalsansvarig med full åtkomst (byter coach, bokar möte). */
  manage: boolean;
  /** Chef och systemadmin ser ärendet i läsläge. */
  readOnly: boolean;
  protectedIdentity: boolean;
  status: CaseStatus;
  phase: number;
  phaseName: string;
  phaseCount: number;
  /** Sedan när ärendet är i nuvarande fas (bara pågående). */
  phaseSince: string | null;
  stuck: { days: number; phase: number; maxDays: number } | null;
  areaName: string;
  secondaryAreaName: string | null;
  vocationalTrack: string;
  referredAt: string;
  /** "mejl", "portalen", "telefon" */
  sourceText: string;
  startDate: string | null;
  firstMeetingAt: string | null;
  plannedEnd: string | null;
  endDate: string | null;
  endReasonLabel: string | null;
  /** Avslut till arbete eller studier som inte är verifierat. */
  resultPrelim: boolean;
  /** Beställningens omfattning och pris per deltagarvecka (inte för teamet). */
  order: { weeks: number | null; priceOre: number } | null;
  pnr: { masked: string | null; canReveal: boolean; hidden: boolean };
  contactText: string;
  /** Deltagarens föredragna kontaktväg ("SMS", "E-post" …), null vid skyddade personuppgifter. */
  contactLabel: string | null;
  languageText: string;
  /** Deltagarens språk (för samtyckets språkval). */
  language: string;
  accessibilityNeeds: string;
  /** Beställande handläggare. */
  referrer: { name: string; title: string; unit: string; email: string } | null;
  /** Inte för teamet. */
  buyer: { reference: string | null; problem: string | null; purchaseOrderNumber: string | null } | null;
  leadCoach: { id: string; name: string } | null;
  team: { userId: string; name: string; roleLabel: string }[];
  /** Teamet har en huvudcoach (för texten "Bara huvudcoach"). */
  hasLeadInTeam: boolean;
  /** Den inloggades roll i teamet (teamåtkomst). */
  myTeamRoleLabel: string | null;
  location: string;
  flags: CaseFlag[];
  /** Olästa meddelanden från kommunen till den inloggade. */
  unread: number;
  openDeviations: number;
  /** Samtycke till inspelning och AI (inte för teamet). */
  consent: {
    value: AiConsentStatus;
    givenAt: string | null;
    informedByName: string | null;
    textVersion: string | null;
    language: string | null;
    revokedAt: string | null;
  } | null;
  /** Första mötet: senaste tid enligt avtalet och text om tidsgränsen. */
  firstMeeting: { dueAt: string | null; sla: { label: string; tone: SlaTone } | null; withinText: string };
  keyPersonnelChangeRequiresApproval: boolean;
  customerSeesCoachNotes: boolean;
  /** Kommunens roll som har åtkomst till ärendet (bara för perspektivbytet i prototypen). */
  customerRole: "kommun_handlaggare" | "kommun_chef" | null;
  /** Coacher att byta till, med antal aktiva ärenden (bara samordnare och avtalsansvarig). */
  coachOptions: { id: string; name: string; active: number }[];
};
export type CaseCardResult =
  | CaseCard
  | { kind: "not_found" }
  /** Ärendet finns men rollen har ingen åtkomst. restricted = skyddade personuppgifter (nummer och status syns). */
  | { kind: "denied"; restricted: boolean; caseNumber: string | null; status: CaseStatus | null };
export const caseCard = query("arenden.kort", z.object({ caseId: IdSchema })).returns<CaseCardResult>();

const CaseParams = z.object({ caseId: IdSchema });
type CaseActivity = { id: string; kind: ActivityKind; startsAt: string; location: string };

/** Flik Översikt. null = ingen åtkomst. */
export type CaseOverview = {
  nextMeeting: { startsAt: string; first: boolean; location: string } | null;
  closed: boolean;
  /** Senaste godkända avstämning (inte för teamet). */
  latest: { overallStatus: TrafficLight | null; heldAt: string; mode: CheckInMode | null; goalStatus: GoalStatus | null; nextGoal: string; note: string } | null;
  drafts: { count: number; ai: boolean };
  weeksLabel: string;
  attendance: AttendanceSummary;
  /** Kommande 14 dagar (teamet: inga coachmöten). */
  upcoming: CaseActivity[];
  placement: { employerName: string | null; startsOn: string; endsOn: string | null; supervisorName: string; fourRights: FourRights | null } | null;
};
export const caseOverview = query("arenden.kortOversikt", CaseParams).returns<CaseOverview | null>();

export type CaseIntake = {
  intake: {
    workExperience: string; education: string; languageNotes: string; digitalSkills: string; drivingLicence: string; workGoals: string;
    chosenTrack: string; adaptations: string; firstWeekGoal: string; approved: boolean; approvedAt: string | null; approvedByName: string | null;
  } | null;
  stuck: { days: number; phase: number; maxDays: number } | null;
};
export const caseIntake = query("arenden.kortKartlaggning", CaseParams).returns<CaseIntake | null>();

export type CaseCheckInRow = {
  id: string; heldAt: string; mode: CheckInMode | null; goalStatus: GoalStatus | null; phase: number | null; overallStatus: TrafficLight | null;
  obstacles: string[]; note: string; approved: boolean; ai: boolean;
};
export const caseCheckIns = query("arenden.kortAvstamningar", CaseParams).returns<{ checkIns: CaseCheckInRow[] } | null>();

export type CaseAttendanceWeek = { key: string; paused: boolean; stats: AttendanceSummary; future: number };
export type CaseAttendance = {
  started: boolean;
  weeks: CaseAttendanceWeek[];
  total: AttendanceSummary & { reasons: [string, number][] };
  last4: AttendanceSummary;
  weeksLabel: string;
  /** Upprepad ogiltig frånvaro enligt avtalets regel. */
  repeated: { dates: string[]; absentInvalid: number; withinDays: number } | null;
  /** Senaste tio passerade tillfällena, senaste först. */
  past: (CaseActivity & { attendance: { status: AttendanceStatus; reason: string } | null })[];
  /** "måndag 10.00" – när närvaron ska vara registrerad (avtalet), eller null. */
  registerBy: string | null;
};
export const caseAttendance = query("arenden.kortNarvaro", CaseParams).returns<CaseAttendance | null>();

export type CaseAssessmentRow = {
  id: string; month: string; approved: boolean; overallStatus: TrafficLight | null; clear: number; summary: string; planGoals: string[];
  report: { id: string; statusLabel: string; opened: boolean } | null;
};
export type CaseAssessments = {
  list: CaseAssessmentRow[];
  /** Förra månaden saknar bedömning (pågående ärende som startade före månadens slut). */
  missingMonth: string | null;
  nAreas: number;
  scale: { min: number; max: number };
  observationFromLevel: number;
  /** "tydlig eller uppnått delmål" och "nivå 2–3". */
  clearLabel: string;
  clearRange: string;
};
export const caseAssessments = query("arenden.kortManad", CaseParams).returns<CaseAssessments | null>();

export type CaseEventRow = {
  id: string; kind: OutcomeEventKind; label: string; occurredOn: string; actor: string; note: string; verificationKind: string | null;
  needsVerification: boolean; possibleBonus: boolean;
};
export type CaseEvents = {
  events: CaseEventRow[];
  /** Arbetsgivarkontakter i godkända avstämningar (teamet). */
  checkInContacts: number;
  result: { endDate: string | null; endReasonLabel: string; resultClass: ResultClass | null; verifiedAt: string | null } | null;
  resultDefinitionUnset: boolean;
  prototypeDefinition: string | null;
  bonusEnabled: boolean;
};
export const caseEvents = query("arenden.kortHandelser", CaseParams).returns<CaseEvents | null>();

export type CaseDeviationRow = {
  id: string; createdAt: string; description: string; assessment: string; action: string; ownerName: string | null; followUpOn: string | null;
  needsCustomerDecision: boolean; followUpMeetingAt: string | null; open: boolean; fromCheckIn: boolean;
  /** Uppföljningens tidsgräns (öppna avvikelser). */
  due: { dueAt: string; sla: { label: string; tone: SlaTone } } | null;
};
export type CaseDeviations = {
  deviations: CaseDeviationRow[];
  repeated: { count: number; withinDays: number } | null;
  owners: { id: string; label: string }[];
  defaultOwnerId: string | null;
  defaultFollowUpOn: string;
  defaultCallAt: string;
  today: string;
  now: string;
};
export const caseDeviations = query("arenden.kortAvvikelser", CaseParams).returns<CaseDeviations | null>();

export type CasePlacements = {
  placements: {
    id: string; employerName: string | null; contactName: string | null; phone: string | null; status: PlacementStatus; startsOn: string; endsOn: string | null;
    tasks: string; goals: string; supervisorName: string; followUpDates: string[]; fourRights: FourRights;
  }[];
  contacts: { id: string; actor: string; label: string; occurredOn: string }[];
  checkInContacts: number;
  phase: number;
  today: string;
};
export const casePlacements = query("arenden.kortPraktik", CaseParams).returns<CasePlacements | null>();

export type CaseReportRow = {
  id: string; kind: ReportKind; kindLabel: string; periodText: string; version: number; status: ReportStatus; statusLabel: string;
  /** Version som håller på att rättas och inte levererats än. */
  correctionVersion: number | null;
  dueAt: string | null; sla: { label: string; tone: SlaTone } | null; provisionalDue: boolean; deliveredAt: string | null; openedAt: string | null;
};
export const caseReports = query("arenden.kortRapporter", CaseParams).returns<{ reports: CaseReportRow[] } | null>();

export type CaseMessageRow = { id: string; senderName: string; mine: boolean; orgName: string; createdAt: string; meetingRequest: boolean; body: string; readText: string };
export const caseMessages = query("arenden.kortMeddelanden", CaseParams).returns<{ messages: CaseMessageRow[] } | null>();

export type CaseHistoryItem = {
  id: string; icon: "users" | "check-square" | "x-circle" | "check" | "inbox"; filled: boolean; red: boolean; title: string; sub: string;
  reason: string | null; customerNotifiedAt: string | null; leadCoachName: string | null;
};
export type CaseLogRow = { id: string; occurredAt: string; actorName: string; text: string; sub: string };
export type CaseHistory = {
  items: CaseHistoryItem[];
  /** Coach och handledare ser bara sina egna åtgärder. */
  ownOnly: boolean;
  log: CaseLogRow[];
};
export const caseHistory = query("arenden.kortHistorik", CaseParams).returns<CaseHistory | null>();

/**
 * Visa hela personnumret (maskerat i vy-modellen). Bara roller med full åtkomst till ärendet. Visningen loggas i
 * revisionsloggen (pnr.revealed) – numret skickas aldrig i loggen.
 */
export const caseRevealPnr = command("arenden.visaPersonnummer", CaseParams).returns<Result<{ pnr: string }, "not_found" | "forbidden" | "missing">>();

// ---------------------------------------------------------------- Handledarens startsida (/handledare)
export type SupervisorCase = {
  id: string; caseNumber: string; status: CaseStatus; displayName: string; myRoleLabel: string; phase: number; phaseName: string; vocationalTrack: string;
  /** Kommande moment och praktikdagar (högst tre). */
  upcoming: CaseActivity[];
  /** Nästa moment eller praktikdag (sortering). */
  nextAt: string | null;
  placement: { employerName: string | null; startsOn: string; endsOn: string | null; fourRights: FourRights | null; contactName: string | null; phone: string | null } | null;
  contacts: number;
  lastContact: { occurredOn: string; label: string; actor: string } | null;
};
export type SupervisorStart = {
  today: string;
  groups: { pagaende: SupervisorCase[]; start: SupervisorCase[]; avslutade: SupervisorCase[] };
  practiceDays: number;
  vocationalMoments: number;
  missingFour: { caseId: string; caseNumber: string; displayName: string; employerName: string | null; missing: string[] }[];
  /** Kommande sju dagar: moment och praktikdagar i pågående ärenden. */
  upcoming: (CaseActivity & { caseId: string; caseNumber: string; displayName: string })[];
};
export const supervisorStart = query("arenden.handledare", z.object({})).returns<SupervisorStart>();
