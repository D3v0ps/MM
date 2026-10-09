// Kontrakt för området coach (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
import { z } from "zod";
import { command, query, type Fail, type Result } from "@/api/contract";
import { NAV, LOG, CASES, COACH, PORTAL, REPORTS, MGMT, START, INBOX, CASE_STATS, CASE_FACTS } from "@/api/invalidation";
import type { SlaTone } from "@/core/sla";
import type { ProgressionRuleText } from "@/core/config";
import {
  AI_DECISIONS, AI_RUN_KINDS, ATTENDANCE_STATUSES, CHECK_IN_MODES, DEVIATION_STATUSES, EMPLOYER_CONTACT_COUNTS, GOAL_STATUSES, INPUT_METHODS, OUTCOME_EVENT_KINDS,
  TRAFFIC_LIGHTS, type ActivityKind, type AiConsentStatus, type AttendanceSource, type AttendanceStatus, type CaseStatus, type CheckInMode, type EmployerContacts, type EndReason,
  type GoalStatus, type InputMethod, type LocalDate, type LocalDateTime, type MonthKey, type OutcomeEventKind, type ProgressLevel, type ReportStatus,
  type ResultClass, type TrafficLight, type TranscriptLine, type WeekKey,
} from "@/data/schema";
import { AI_SOURCES, type AiSource, type CheckInSuggestions } from "../_shared/ai-types";
// Texten när AI-stödet inte är kopplat (produktion utan leverantör) – skärmarna läser den härifrån.
export { AI_OFF_TEXT } from "../_shared/ai-port";
import { IdSchema, LocalDateSchema, LocalDateTimeSchema, LongText, MonthKeySchema, ShortText } from "../_shared/schemas";
import type { WeeklyPublished } from "../_shared/weekly";
import type { TodayGroupActivity } from "../aktiviteter/api";

export type { AiFieldSuggestion, AiField, AiSource, CheckInSuggestions } from "../_shared/ai-types";
export { AI_FIELDS, AI_SOURCES, recordingOffered } from "../_shared/ai-types";
export type { WeeklyPublished } from "../_shared/weekly";

// ---- Delade kommandon (portade från prototypens 03-domain.js)
// Samma beteende, valideringar, felkoder och texter som prototypens MM.defineAction. Nyckeln är "coach.<prototypens namn>".
// Gemensamma felkoder: not_found = ärendet/raden finns inte eller rollen får inte se det, forbidden = får se men inte ändra.

/**
 * Registrera närvaro (prototypens attendance.set och coach.attendanceSet). Veckorapporten till handläggaren publiceras
 * automatiskt när all närvaro för hennes deltagare är registrerad – kontrollen görs mot färska data i samma kommando.
 * published = rapporten som publicerades (för meddelandet "Veckorapporten för v. 4 2027 till … publicerades automatiskt.").
 */
// Omräkning CASE_FACTS (brett med flit): närvaron styr veckorapporter, fakturaunderlag, flaggor, sidopanelens räknare och KPI:er.
export const attendanceSet = command("coach.attendanceSet", z.object({
  activityId: IdSchema,
  status: z.enum(ATTENDANCE_STATUSES),
  /** Frånvaroorsak (giltig frånvaro). */
  reason: ShortText.optional(),
// Samordnaren registrerar också (aktivitetsvyn, beslut 2026-10-09): hennes orderbekräftelse i inkorgen läser rapporterna.
}), { invalidates: [...CASE_FACTS, "inkorg.confirmation"] }).returns<Result<{ attendanceId: string; published: WeeklyPublished | null }, "not_found">>();

/**
 * Markera alla oregistrerade tillfällen en dag som närvarande (beslut 2026-10-02, kommun-och-mobil-18). Samma regler som
 * attendanceSet: de som arbetar i ärendena (coach, handledare och sedan gruppaktiviteterna samordnare och avtalsansvarig, beslut
 * 2026-10-09 – aktivitetsvyns "Markera övriga som närvarande"), skyddade ärenden bara för namngiven coach. Tillfällen som
 * redan har närvaro eller frånvaro ändras aldrig (skipped). Raderna skrivs exakt som vid enskild registrering, så
 * fakturaunderlaget och veckorapporterna blir desamma; veckorapporterna publiceras som vid enskild registrering (published).
 * En loggrad med antal och id:n (attendance.registered_all). Finns något id inte, eller får du inte registrera det, skrivs
 * ingenting (not_found). Alla tillfällen måste ligga på dagen (wrong_day) och ha startat (not_started).
 */
// Omräkning CASE_FACTS (brett med flit) – samma följder som attendanceSet.
export const attendanceSetAll = command("coach.attendanceSetAll", z.object({
  day: LocalDateSchema,
  /** Tillfällena som visades i bekräftelsen – servern kontrollerar varje. */
  activityIds: z.array(IdSchema).min(1).max(200),
}), { invalidates: [...CASE_FACTS, "inkorg.confirmation"] }).returns<
  Result<{ marked: string[]; skipped: string[]; published: WeeklyPublished[]; registeredAt: LocalDateTime }, "not_found" | "wrong_day" | "not_started">
>();

/**
 * Automatisk utkastsparning (D2 punkt 2, src/shell/autosave.ts) – bara med approve false (annars "invalid"):
 *   autosave: sparningen gjordes automatiskt av skärmen (loggas med details.autosave).
 *   editSession: skärmens besöksnyckel (slumpad när formuläret öppnas, bara små bokstäver och siffror) – revisionsloggen
 *   får en rad per besök på sidan, inte en per sparning. Saknas den loggas varje autosparning.
 *   expectedVersion (manuell och automatisk sparning): radens version som skärmen senast såg eller sparade. Stämmer den
 *   inte med radens (samma utkast öppet i en annan flik eller på en annan enhet) avvisas sparningen med "conflict" – inget
 *   skrivs över. Svaret ger den nya versionen (version). Utan expectedVersion sparas utan kontroll (äldre anropare).
 */
const AutosaveFields = {
  autosave: z.boolean().optional(),
  editSession: z.string().regex(/^[a-z0-9]{12,32}$/).optional(),
  expectedVersion: z.number().int().min(1).optional(),
};
/** Svaret från en sparning: serverns tid ("Utkast sparat 09.41") och radens nya version (nästa expectedVersion). */
export type SavedInfo = { savedAt: LocalDateTime; version: number };

/** Fälten i en avstämning som coachen fyller i. AI-utkastet (ai) hämtas av hanteraren från AI-körningen (aiRunId) – skicka det inte. */
export const CheckInDataSchema = z.object({
  heldAt: LocalDateTimeSchema.optional(),
  durationMin: z.number().int().min(0).max(600).nullable().optional(),
  mode: z.enum(CHECK_IN_MODES).nullable().optional(),
  inputMethod: z.enum(INPUT_METHODS).optional(),
  goalStatus: z.enum(GOAL_STATUSES).nullable().optional(),
  nextGoal: z.string().max(500).optional(),
  phase: z.number().int().min(1).max(10).nullable().optional(),
  activitiesDone: z.array(ShortText).max(30).optional(),
  employerContacts: z.object({ count: z.enum(EMPLOYER_CONTACT_COUNTS).nullable(), types: z.array(z.string().max(60)).max(10) }).optional(),
  /** Coachens bedömning. AI föreslår den aldrig (CLAUDE.md punkt 5). */
  overallStatus: z.enum(TRAFFIC_LIGHTS).nullable().optional(),
  obstacles: z.array(ShortText).max(20).optional(),
  note: LongText.optional(),
  /** Coachens kommentar om veckans närvaro (valfri, prototypens attendanceComment). */
  attendanceComment: z.string().max(300).optional(),
  /** Dokumentationstid i minuter (SPEC §8.5). */
  docMinutes: z.number().int().min(0).max(1000).nullable().optional(),
  /** AI-körningen (coach.aiRun) vars förslag coachen har granskat. */
  aiRunId: IdSchema.nullable().optional(),
});
export type CheckInData = z.infer<typeof CheckInDataSchema>;

/** Avvikelse, risk och åtgärd (deltagarnivå). */
export const DeviationInputSchema = z.object({
  description: z.string().max(2000),
  assessment: z.string().max(2000).optional(),
  action: z.string().max(2000),
  ownerId: IdSchema.nullable().optional(),
  followUpOn: LocalDateSchema.nullable().optional(),
  needsCustomerDecision: z.boolean().optional(),
});

/**
 * Spara eller godkänn en veckoavstämning (prototypens checkin.save).
 * Röd samlad status kräver en avvikelse (deviation_required) – den skapas i samma kommando och hör till avstämningen
 * (deviations.checkInId): en senare sparning av samma avstämning uppdaterar samma avvikelse, aldrig en ny. Uppgiften till
 * kommunen och mejlet skapas bara vid manuell sparning eller godkännande (aldrig av en automatisk utkastsparning medan
 * coachen skriver) och bara en gång per avvikelse. AI-baserad inmatning kräver samtycke och är aldrig tillåten vid skyddade
 * personuppgifter (ai_not_allowed). Vid godkännande raderas råtranskriptet. En godkänd avstämning ändras inte (approved).
 * aiDecisions: coachens beslut per AI-förslag (accepted/edited/rejected) – loggas.
 */
// Omräkning brett med flit: en avstämning kan ändra fas, skapa avvikelse och uppgift till kommunen och påverkar rapporter, flaggor
// och KPI:er. Inte coach.checkInAttendance, coach.aiRunInfo, rost.* eller ekonomi.* – de rör inte avstämningens innehåll.
export const checkinSave = command("coach.checkinSave", z.object({
  caseId: IdSchema,
  checkInId: IdSchema.optional(),
  data: CheckInDataSchema,
  approve: z.boolean().optional(),
  deviation: DeviationInputSchema.optional(),
  aiDecisions: z.array(z.object({
    field: z.string().max(40),
    decision: z.enum(AI_DECISIONS),
    suggested: z.unknown(),
    final: z.unknown(),
    changed: z.boolean().optional(),
  })).max(20).optional(),
  ...AutosaveFields,
}), { invalidates: ["coach.minVecka", "coach.casePicker", "coach.checkInPage", "coach.checkInReceipt", "coach.assessmentPage", "coach.intakePage", CASES, PORTAL, REPORTS, MGMT, ...START, "notiser.", ...CASE_STATS, NAV, ...LOG] }).returns<
  Result<{ checkInId: string; deviationId: string | null; rawTranscriptDeletedAt: string | null } & SavedInfo, "not_found" | "forbidden" | "deviation_required" | "ai_not_allowed" | "invalid" | "approved" | "conflict">
>();

/** Spara (eller stäng) en avvikelse (prototypens deviation.save). Kräver den beslut av kommunen skapas en uppgift till handläggaren. */
// Omräkning brett med flit: avvikelsen kan skapa en uppgift till kommunen – deadlines och räknare kan läsa den.
export const deviationSave = command("coach.deviationSave", z.object({
  id: IdSchema.optional(),
  caseId: IdSchema,
  data: DeviationInputSchema.partial().extend({
    followUpMeetingAt: LocalDateTimeSchema.nullable().optional(),
    status: z.enum(DEVIATION_STATUSES).optional(),
  }),
}), { invalidates: [CASES, COACH, PORTAL, REPORTS, MGMT, ...START, NAV, ...LOG] }).returns<Result<{ deviationId: string }, "not_found" | "forbidden">>();

/** Kalla kommunen till uppföljning (AFK 7.8): säkert meddelande + mejl utan personuppgifter (prototypens deviation.callCustomer). */
export const deviationCallCustomer = command("coach.deviationCallCustomer", z.object({
  caseId: IdSchema,
  deviationId: IdSchema.nullable().optional(),
  body: LongText,
  proposedAt: LocalDateTimeSchema.nullable().optional(),
}), { invalidates: [CASES, "coach.minVecka", "coach.checkInReceipt", PORTAL, INBOX, REPORTS, MGMT, NAV, ...LOG] }).returns<Result<{ messageId: string }, "not_found" | "forbidden" | "empty">>();

/** Ett progressionsområde som coachen bedömt. Nivån sätts bara av coachen – aldrig av AI. */
export const AreaInputSchema = z.object({
  level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).nullable().optional(),
  observation: z.string().max(2000).optional(),
  nextStep: z.string().max(1000).optional(),
});

/** Högsta längd på månadsbedömningens sammanfattning (tecken). Skärmen räknar och stoppar innan anropet. */
export const ASSESSMENT_SUMMARY_MAX = 4000;
/** En anteckning lagd sist i sammanfattningen, med en tom rad emellan (tom sammanfattning: bara anteckningen). */
export function appendToSummary(summary: string, text: string): string {
  const base = summary.replace(/\s+$/, "");
  return base ? `${base}\n\n${text}` : text;
}
/** Får anteckningen plats i sammanfattningen (texten + den tomma raden högst ASSESSMENT_SUMMARY_MAX tecken)? */
export const canAppendToSummary = (summary: string, text: string, max: number = ASSESSMENT_SUMMARY_MAX): boolean => appendToSummary(summary, text).length <= max;
/**
 * Finns anteckningens text redan i sammanfattningen? Då visas "Tillagd i sammanfattningen" även efter omladdning, så att
 * samma text inte läggs in två gånger. Har coachen skrivit om texten går den att lägga till igen.
 */
export const noteInSummary = (summary: string, text: string): boolean => {
  const t = text.trim();
  return t.length > 0 && summary.includes(t);
};

/**
 * Spara eller godkänn månadsbedömningen (prototypens assessment.save). Godkännande kräver nivå i varje område, observation
 * från avtalets nivå (observationRequiredFromLevel) och samlad status – annars incomplete med missing (områdesnycklarna).
 * Vid godkännande blir månadsrapporten "Granskad av coach". plan = planen för nästa månad.
 * usedNoteIds = fria anteckningar som coachen lagt in i sammanfattningen (rapporter steg 2): kontrolleras och loggas
 * (case_note.used_in_summary, bara id:n och månad). Inget annat sparas – texten finns bara i sammanfattningen.
 */
export const assessmentSave = command("coach.assessmentSave", z.object({
  caseId: IdSchema,
  month: MonthKeySchema,
  areas: z.record(z.string().max(60), AreaInputSchema).optional(),
  summary: z.string().max(ASSESSMENT_SUMMARY_MAX).nullable().optional(),
  overallStatus: z.enum(TRAFFIC_LIGHTS).nullable().optional(),
  approve: z.boolean().optional(),
  plan: z.object({
    goal1: z.string().max(500).optional(),
    goal2: z.string().max(500).optional(),
    plannedActivities: z.string().max(2000).optional(),
    plannedEmployerContact: z.string().max(2000).optional(),
    plannedAdaptation: z.string().max(2000).optional(),
    nextCustomerMeeting: z.union([LocalDateSchema, z.literal("")]).nullable().optional(),
    status: z.enum(["draft", "approved"]).optional(),
  }).optional(),
  usedNoteIds: z.array(IdSchema).max(50).optional(),
  ...AutosaveFields,
}), { invalidates: [COACH, CASES, PORTAL, REPORTS, MGMT, ...START, "admin.contract", NAV, ...LOG] }).returns<
  Result<{ assessmentId: string } & SavedInfo, "not_found" | "forbidden" | "bad_note" | "invalid" | "approved" | "conflict"> | (Fail<"incomplete"> & { missing: string[] })
>();

/** Spara eller godkänn kartläggningen (prototypens intake.save). Vid godkännande blir valt yrkesspår ärendets yrkesspår. */
export const intakeSave = command("coach.intakeSave", z.object({
  caseId: IdSchema,
  data: z.object({
    workExperience: z.string().max(4000),
    education: z.string().max(4000),
    languageNotes: z.string().max(4000),
    digitalSkills: z.string().max(4000),
    drivingLicence: z.string().max(200),
    workGoals: z.string().max(4000),
    chosenTrack: z.string().max(200),
    adaptations: z.string().max(4000),
    firstWeekGoal: z.string().max(1000),
  }).partial().optional(),
  approve: z.boolean().optional(),
  ...AutosaveFields,
}), { invalidates: [COACH, CASES, "kommun.deltagare", "kommun.deltagareLista", REPORTS, MGMT, ...LOG] }).returns<Result<{ intakeId: string } & SavedInfo, "not_found" | "forbidden" | "invalid" | "conflict">>();

/** Registrera en händelse/ett utfall (prototypens event.add). Arbete påbörjat markeras som möjligt bonusunderlag. */
export const eventAdd = command("coach.eventAdd", z.object({
  caseId: IdSchema,
  kind: z.enum(OUTCOME_EVENT_KINDS),
  occurredOn: LocalDateSchema,
  actor: ShortText.optional(),
  verificationKind: ShortText.nullable().optional(),
  /** Filnamn/sökväg till underlaget i privat lagring. */
  verificationFile: ShortText.nullable().optional(),
  note: z.string().max(4000).optional(),
}), { invalidates: [COACH, CASES, PORTAL, REPORTS, MGMT, "praktik.", "admin.contract", ...LOG] }).returns<Result<{ eventId: string }, "not_found" | "forbidden">>();

/**
 * Verifiera resultatet (arbete/studier) med underlag (prototypens result.verify). finalDelivered = ärendets slutrapport är
 * redan levererad och inte ersatt (finalReportId). Kommunens resultatfil visar verifieringen som den stod i den levererade
 * slutrapporten (rapporter steg 3, beslut sätt a) – skärmen ska då säga FINAL_DELIVERED_VERIFY_TEXT.
 */
export const resultVerify = command("coach.resultVerify", z.object({
  caseId: IdSchema,
  verificationKind: ShortText,
  file: ShortText.nullable().optional(),
}), { invalidates: [COACH, CASES, PORTAL, REPORTS, MGMT, INBOX, "praktik.", "admin.contract", NAV, ...LOG] }).returns<Result<{ finalDelivered: boolean; finalReportId: string | null }, "not_found" | "forbidden">>();
/** Visas när verifieringen registreras efter att slutrapporten levererats (se resultVerify). */
export const FINAL_DELIVERED_VERIFY_TEXT =
  "Slutrapporten är redan levererad till kommunen. Rätta slutrapporten så att verifieringen kommer med i rapporten och i kommunens resultatfil.";

/**
 * AI-körning (prototypens ai.run) – SIMULERAD tills AI-adaptern är godkänd. Spärras utan samtycke och vid skyddade
 * personuppgifter (ai_not_allowed, loggas). För avstämningar (transcribe_extract, extract_teams, extract_notes) returneras
 * förslag med belägg (citat + tidpunkt) – aldrig samlad status. Ljudet raderas direkt (audioDeletedAt), råtranskriptet
 * senast efter 30 dagar eller när avstämningen godkänts.
 */
export const aiRun = command("coach.aiRun", z.object({
  caseId: IdSchema.nullable().optional(),
  kind: z.enum(AI_RUN_KINDS),
  /** Underlaget för avstämningen. Standard: extract_notes → notes, extract_teams → teams, annars recording. */
  source: z.enum(AI_SOURCES).optional(),
  /** Inklistrade anteckningar (source notes). */
  notesText: z.string().max(20000).optional(),
  audioSeconds: z.number().int().min(0).max(4 * 3600).optional(),
  costOre: z.number().int().min(0).max(100000).optional(),
  model: ShortText.optional(),
}), { invalidates: ["coach.checkInPage", "coach.aiRunInfo", "coach.recordingState", "coach.assessmentPage", "arenden.kortHistorik", "admin.integrations", ...LOG] }).returns<Result<AiRunResult, "not_found" | "ai_not_allowed" | "ai_unavailable">>();

export type AiRunResult = {
  runId: string;
  source: AiSource | null;
  /** Förslagen per fält (null för körningar som inte gäller en avstämning). */
  suggestions: CheckInSuggestions | null;
  transcript: TranscriptLine[];
  audioDeletedAt: string | null;
  rawTranscriptDeleteBy: string | null;
};

// ---- Röstinspelning (docs/PLAN-ROST.md): coachen spelar in avstämningen eller laddar upp en ljudfil
// Flödet: rost.uploadStart (behörighet, avtal, samtycke) -> webbläsaren laddar upp ljudet (appen) -> coach.recordingFinish
// (transkribering -> ljudet raderas -> förslag med belägg) -> coach.recordingState tills förslagen är klara (appen).
// Förslagen granskas i samma formulär som coach.aiRun och sparas med checkinSave (aiRunId).

/** Läget för coachens inspelning. result = förslagen (samma form som coach.aiRun) när transkriberingen är klar. */
export type RecordingState = {
  aiRunId: string;
  status: "running" | "succeeded" | "failed";
  /** Fast text utan personuppgifter när körningen misslyckades. */
  error: string | null;
  audioDeletedAt: string | null;
  result: AiRunResult | null;
};
/**
 * Inspelningen (eller ljudfilen) är uppladdad: bekräfta den och starta transkriberingen (jobbet transcribe_recording).
 * Kräver registrerat samtycke och aldrig skyddade personuppgifter – kontrolleras här och igen när jobbet körs.
 * checkInId: ett sparat avstämningsutkast som förslagen också ska in i (om coachen lämnar sidan innan de är klara).
 */
export const recordingFinish = command("coach.recordingFinish", z.object({
  caseId: IdSchema,
  uploadId: IdSchema,
  source: z.enum(["recording", "upload"]),
  checkInId: IdSchema.nullish(),
  durationSec: z.number().min(0).max(86_400).nullish(),
}), { invalidates: [COACH, CASES, "admin.integrations", "rost.", ...LOG] }).returns<Result<RecordingState, "not_found" | "forbidden" | "disabled" | "protected" | "no_consent" | "link_missing" | "link_used" | "link_expired" | "audio_missing">>();
export const recordingState = query("coach.recordingState", z.object({ aiRunId: IdSchema })).returns<RecordingState | null>();

/**
 * AI-utkast till månadsbedömningen: observation per progressionsområde, sammanfattning och plan – BARA från månadens
 * godkända avstämningar och registrerad närvaro (jobbet draft_monthly). Nivåer och samlad status sätts aldrig.
 */
export const monthlyDraft = command("coach.monthlyDraft", z.object({ caseId: IdSchema, month: MonthKeySchema }), { invalidates: ["coach.assessmentPage", "coach.minVecka", "arenden.kortHistorik", "admin.integrations", ...LOG] }).returns<
  Result<{ aiRunId: string; status: "running" | "succeeded" | "failed"; error: string | null }, "not_found" | "forbidden" | "ai_not_allowed" | "approved">
>();

// ================================================================ Frågor för coachens skärmar
// En fråga per skärm (och några små för delar som ändras med formuläret). Resultatet är en vy-modell med bara det skärmen
// visar. Ärendevyerna returnerar { kind: "gate" } när rollen inte får arbeta i ärendet (prototypens gate()).

/** Tidsgräns med status, räknad i hanteraren (src/core/sla). */
export type CoachSla = { label: string; tone: SlaTone };
/**
 * Registrerad närvaro (null = ej registrerad). source auto = registrerad automatiskt efter dagens slut (beslut 2026-10-09) –
 * visas "Automatiskt registrerad" tills någon ändrar raden (då blir den manuell).
 */
export type AttMark = { status: AttendanceStatus; reason: string; source: AttendanceSource } | null;
/** Varför vyn inte kan visas ärendet (prototypens gate): "Ärendet finns inte" eller "Inte ditt ärende". */
export type CoachGate = { title: string; text: string };
/** Deltagarhuvudet i ärendevyerna (prototypens CaseHead). */
export type CaseHead = {
  caseId: string;
  caseNumber: string;
  /** Deltagarens namn (huvudcoachen har full åtkomst). */
  name: string;
  protected: boolean;
  phase: number;
  phaseName: string;
  status: CaseStatus;
  /** "G Lager och logistik" */
  areaName: string;
  /** Yrkesspåret, eller "Yrkesspår inte valt". */
  track: string;
};
/** Beställande handläggare – för perspektivbytet i prototypen och texten om mötesförfrågan. */
export type ReferrerView = { id: string | null; name: string | null; unit: string | null };
type Gated<T> = { kind: "gate"; gate: CoachGate } | ({ kind: "ok" } & T);

// ---------------------------------------------------------------- Min vecka (/min-vecka)
export type TodayActivity = {
  id: string;
  caseId: string;
  caseNumber: string;
  name: string;
  kind: ActivityKind;
  startsAt: LocalDateTime;
  durationMin: number;
  location: string;
  attendance: AttMark;
  /** Dagens avstämning för coachträffen, om den påbörjats. */
  checkIn: { id: string; approved: boolean } | null;
  /** Inspelning erbjuds (deltagaren har inte sagt nej eller återkallat samtycket) – annars är "Nytt möte" vägen. */
  recordable: boolean;
};
export type CalendarActivity = {
  id: string;
  caseId: string;
  kind: ActivityKind;
  startsAt: LocalDateTime;
  location: string;
  /** "Nadia W." (kortnamn i kalendern). */
  shortName: string;
  attendance: AttendanceStatus | null;
};
export type MinVeckaView = {
  now: LocalDateTime;
  /** Förra veckan: veckonummer och måndag. */
  lastWeek: { no: number; mon: LocalDate };
  /** Registrering av förra veckans närvaro: förfallotid och status, "måndag 10.00", publicering "måndag 16.00". */
  reg: { dueAt: LocalDateTime; sla: CoachSla; dueText: string; pubText: string };
  unregistered: {
    count: number;
    byCase: { caseId: string; caseNumber: string; name: string; items: { startsAt: LocalDateTime; kind: ActivityKind }[] }[];
    /** Handläggare vars veckorapport väntar på coachens registrering. */
    waitingFor: string[];
  };
  /** Dagens enskilda tillfällen. Deltagarnas tillfällen i en gruppaktivitet visas i groups i stället (en rad per aktivitet). */
  today: TodayActivity[];
  /**
   * Dagens gruppaktiviteter (coachmötet 2026-10-09): de coachen är ansvarig för eller där någon av coachens deltagare är
   * inbjuden. Länk till aktivitetsvyn, där närvaron och anteckningarna tas.
   */
  groups: TodayGroupActivity[];
  /** Nästa aktivitet i dag (id) och kortnamn för KPI:n – group: en gruppaktivitet (kortnamnet är aktivitetens namn). */
  next: { id: string; shortName: string; group?: boolean } | null;
  /** Insatser att starta (beslut 2026-10-08): bekräftade ärenden vars första möte är i dag eller har passerat. */
  toStart: { caseId: string; caseNumber: string; name: string; firstMeetingAt: LocalDateTime }[];
  drafts: { checkInId: string; caseId: string; caseNumber: string; name: string; heldAt: LocalDateTime; inputMethod: InputMethod; audioDeletedAt: string | null; rawTranscriptDeleteBy: string | null }[];
  monthly: {
    month: MonthKey;
    dueAt: LocalDateTime;
    /** "Sista dag ej fastställd – förslag 5:e arbetsdagen" eller "Sista dag enligt avtalet". */
    dueNote: string;
    done: number;
    total: number;
    open: { caseId: string; caseNumber: string; name: string; hasAi: boolean }[];
  };
  /**
   * Olästa meddelanden från kommunen, ett per ärende (det senaste) – samma räkning som deltagarkortets olästa (unread):
   * meddelanden från kommunens användare som coachen inte har läst. notificationId = notisen om meddelandet, om det finns en.
   */
  messages: { notificationId: string | null; caseId: string; caseNumber: string; name: string; createdAt: LocalDateTime; from: string | null; excerpt: string | null; count: number }[];
  reminders: { caseId: string; caseNumber: string; name: string; streak: number; reason: string; weekKey: WeekKey }[];
  flags: { key: string; kind: string; severity: "critical" | "warning" | "info"; title: string; text: string; caseId: string | null; href: string | null }[];
  unread: { count: number; latest: { id: string; title: string; caseNumber: string | null }[] };
  due: {
    monthly: { count: number; byStatus: Partial<Record<ReportStatus, number>>; dueAt: LocalDateTime; sla: CoachSla } | null;
    other: { id: string; label: string; caseNumber: string | null; name: string | null; dueAt: LocalDateTime; sla: CoachSla; provisional: boolean; href: string | null }[];
  };
  calendar: { mon: LocalDate; activities: CalendarActivity[] };
};
export const minVecka = query("coach.minVecka", z.object({})).returns<MinVeckaView>();

// ---------------------------------------------------------------- Närvaro (/narvaro)
export type NarvaroRow = {
  activityId: string;
  caseId: string;
  caseNumber: string;
  name: string;
  kind: ActivityKind;
  startsAt: LocalDateTime;
  durationMin: number;
  location: string;
  attendance: AttMark;
  /** Upprepad ogiltig frånvaro enligt avtalets regel (visas vid ogiltig frånvaro). */
  repeated: boolean;
  referrerId: string | null;
};
export type NarvaroReport = {
  recipientId: string;
  name: string;
  unit: string;
  reportId: string | null;
  /** Publicerad (levererad eller kvitterad): tidpunkten. */
  publishedAt: LocalDateTime | null;
  /** Oregistrerade tillfällen i hela rapporten (alla handläggarens deltagare – bara antalet). */
  left: number;
  /** Mina oregistrerade tillfällen för handläggaren. */
  mine: number;
};
export type NarvaroWeek = { key: WeekKey; no: number; mon: LocalDate; dueAt: LocalDateTime; sla: CoachSla; rows: NarvaroRow[]; reports: NarvaroReport[] };
export type NarvaroView = {
  now: LocalDateTime;
  dueText: string;
  pubText: string;
  /** "Frånvaronotis samma dag: …" (avtalets tillval). */
  sameDayText: string;
  absenceReasons: string[];
  repeatedRule: { absentInvalid: number; withinDays: number };
  caseCount: number;
  /** Pågående ärenden som tillfällen kan läggas till i (beslut 2026-10-08). */
  cases: { caseId: string; caseNumber: string; name: string; location: string }[];
  weeks: { last: NarvaroWeek; this: NarvaroWeek };
};
export const narvaroView = query("coach.narvaro", z.object({})).returns<NarvaroView>();

// ---------------------------------------------------------------- Deltagarlistan när en vy öppnas utan ärende
export const CASE_PICKER_KINDS = ["avstamning", "manad", "kartlaggning", "handelse"] as const;
export type CasePickerKind = (typeof CASE_PICKER_KINDS)[number];
export type CasePickerRow = {
  caseId: string;
  caseNumber: string;
  name: string;
  phaseLabel: string;
  badge: { tone: "outline" | "blue"; icon: "edit" | "check" | null; text: string } | null;
  note: string | null;
};
export type CasePickerView = { month: MonthKey; monthDueAt: LocalDateTime; monthDueNote: string; rows: CasePickerRow[] };
export const casePicker = query("coach.casePicker", z.object({ kind: z.enum(CASE_PICKER_KINDS), month: MonthKeySchema.optional() })).returns<CasePickerView>();

// ---------------------------------------------------------------- Veckoavstämning (/avstamning/:caseId?avstamning=)
export type CheckInAi = CheckInSuggestions & {
  transcript: TranscriptLine[];
  audioDeletedAt: string | null;
  rawTranscriptDeleteBy: string | null;
  rawTranscriptDeletedAt: string | null;
};
export type CheckInView = {
  id: string;
  caseId: string;
  status: "draft" | "approved";
  heldAt: LocalDateTime;
  durationMin: number | null;
  mode: CheckInMode | null;
  inputMethod: InputMethod;
  goalStatus: GoalStatus | null;
  nextGoal: string;
  phase: number | null;
  activitiesDone: string[];
  employerContacts: EmployerContacts;
  overallStatus: TrafficLight | null;
  obstacles: string[];
  note: string;
  attendanceComment: string;
  docMinutes: number | null;
  approvedAt: LocalDateTime | null;
  approvedByName: string | null;
  aiRunId: string | null;
  /** AI-utkastet (förslag med belägg). Aldrig för skyddade ärenden eller utan samtycke. */
  ai: CheckInAi | null;
  /** Radens version – skickas som expectedVersion vid nästa sparning. */
  version: number;
};
export type CheckInPage = Gated<{
  now: LocalDateTime;
  head: CaseHead;
  referrer: ReferrerView;
  aiConsent: AiConsentStatus;
  consent: { givenAt: string | null; declinedAt: string | null; textVersion: string; informedByName: string; language: string | null } | null;
  /** Förvalt språk för samtyckesinformationen (deltagarens språk om översättning finns). */
  consentLanguage: string;
  /** Avstämningen som öppnades (?avstamning=), om den finns i ärendet. */
  checkIn: CheckInView | null;
  /** Utkast i ärendet (för "Det finns ett sparat utkast"). */
  drafts: { id: string; heldAt: LocalDateTime; ai: boolean }[];
  lastApproved: { nextGoal: string; durationMin: number | null; mode: CheckInMode | null } | null;
  /** Dagens coachträff (förifyllning av datum och tid). */
  todayMeetingAt: LocalDateTime | null;
  watch: { streak: number; reason: string; weekKey: WeekKey } | null;
  repeatedAbsence: { count: number; withinDays: number } | null;
  owners: { id: string; name: string }[];
  phases: { no: number; name: string }[];
  phaseSince: LocalDate | null;
  options: { activityTypes: string[]; obstacles: string[]; goalsByPhase: Record<number, string[]> };
  /**
   * Coachens inspelning i avtalet (ai.recording.coach): får inspelning göras i ärendet, längsta tid och varför inte
   * (avtalet, skyddade personuppgifter, samtycke saknas). Den manuella vägen fungerar alltid.
   */
  recording: { allowed: boolean; block: "ai_off" | "disabled" | "protected" | "no_consent" | null; blockText: string | null; maxMinutes: number };
}>;
export const checkInPage = query("coach.checkInPage", z.object({ caseId: IdSchema, checkInId: IdSchema.optional() })).returns<CheckInPage>();

/** Närvaron senaste veckan fram till avstämningens datum (sektion 2 – ändras med datumet). */
export type CheckInAttendance = {
  from: LocalDate;
  to: LocalDate;
  present: number;
  late: number;
  absentValid: number;
  absentInvalid: number;
  unregistered: number;
  planned: number;
  rate: number | null;
};
export const checkInAttendance = query("coach.checkInAttendance", z.object({ caseId: IdSchema, date: LocalDateSchema })).returns<CheckInAttendance | null>();

/** AI-körningens leverantör och modell (visas vid utkastet). */
export const aiRunInfo = query("coach.aiRunInfo", z.object({ runId: IdSchema })).returns<{ provider: string; model: string } | null>();

/** Kvittot efter godkänd avstämning: status, dataminimering, avvikelse och mötesförfrågan. */
export type CheckInReceipt = Gated<{
  now: LocalDateTime;
  caseNumber: string;
  name: string;
  location: string;
  referrer: ReferrerView;
  coachName: string;
  /** Förslag på uppföljningsmöte: om två arbetsdagar kl. 10. */
  proposedAt: LocalDateTime;
  checkIn: { overallStatus: TrafficLight | null; phase: number | null; phaseLabel: string | null; ai: { audioDeletedAt: string | null; rawTranscriptDeletedAt: string | null } | null } | null;
  deviation: { id: string; description: string; action: string; ownerName: string; followUpOn: LocalDate | null; needsCustomerDecision: boolean; taskCreated: boolean } | null;
}>;
export const checkInReceipt = query("coach.checkInReceipt", z.object({ caseId: IdSchema, checkInId: IdSchema, deviationId: IdSchema.nullable().optional() })).returns<CheckInReceipt>();

// ---------------------------------------------------------------- Månadsbedömning (/manadsbedomning/:caseId?manad=)
export type AssessmentArea = {
  key: string;
  label: string;
  level: ProgressLevel | null;
  observation: string;
  nextStep: string;
  /** AI:s förslag – bara när AI får användas i ärendet. Fylls aldrig i automatiskt. */
  aiLevelSuggestion: ProgressLevel | null;
  aiObservationDraft: { text: string; sources: string[]; noEvidence: boolean } | null;
};
export type AssessmentPage = Gated<{
  now: LocalDateTime;
  month: MonthKey;
  head: CaseHead;
  referrer: ReferrerView;
  aiOk: boolean;
  scale: Record<ProgressLevel, string>;
  requiredFrom: number;
  /**
   * Avtalets gränser för tydlig och någon progression (clearFromLevel, anyFromLevel) och texterna (progressionRuleText).
   * Räknas bara på de obligatoriska områdena – areas nedan är just de.
   */
  progressionRule: { clearFromLevel: number; anyFromLevel: number } & ProgressionRuleText;
  areas: AssessmentArea[];
  assessment: { status: "draft" | "approved"; decidedAt: LocalDateTime | null; summary: string; aiSummaryDraft: string | null; overallStatus: TrafficLight | null; /** Radens version – expectedVersion vid nästa sparning. */ version: number } | null;
  plan: { goal1: string; goal2: string; plannedActivities: string; plannedEmployerContact: string; plannedAdaptation: string; nextCustomerMeeting: LocalDate | null } | null;
  basis: {
    checkIns: LocalDateTime[];
    attendance: { rate: number | null; present: number; late: number; planned: number; unregistered: number };
    events: string[];
  };
  report: { id: string; statusLabel: string } | null;
  dueAt: LocalDateTime;
  dueNote: string;
  goals: string[];
  /**
   * Fria anteckningar från månaden (inte borttagna) som coachen får läsa. De kommer inte med i rapporten av sig själva –
   * coachen lägger in det som behövs i sammanfattningen och godkänner den.
   */
  notes: { id: string; occurredOn: LocalDate; kindLabel: string; authorName: string; body: string }[];
  /**
   * Senaste AI-utkastet för månaden (coach.monthlyDraft): läget, när det skapades och utkastet till planen med källor.
   * Utkasten per område och sammanfattningen visas i areas (aiObservationDraft) och assessment.aiSummaryDraft.
   */
  aiDraft: {
    aiRunId: string;
    status: "running" | "succeeded" | "failed";
    error: string | null;
    createdAt: LocalDateTime;
    plan: { text: string; sources: string[]; noEvidence: boolean } | null;
    summary: { text: string; sources: string[]; noEvidence: boolean } | null;
  } | null;
  /** AI-stödet är inte kopplat (produktion utan leverantör, beslut 2026-10-08): inga AI-utkast – skärmen säger det i klarspråk. */
  aiOff: boolean;
}>;
export const assessmentPage = query("coach.assessmentPage", z.object({ caseId: IdSchema, month: MonthKeySchema.optional() })).returns<AssessmentPage>();

// ---------------------------------------------------------------- Kartläggning (/kartlaggning/:caseId)
export type IntakePage = Gated<{
  head: CaseHead;
  referrer: ReferrerView;
  intake: {
    workExperience: string; education: string; languageNotes: string; digitalSkills: string; drivingLicence: string; workGoals: string;
    chosenTrack: string; adaptations: string; firstWeekGoal: string; status: "draft" | "approved"; approvedAt: LocalDateTime | null;
    /** Radens version – expectedVersion vid nästa sparning. */
    version: number;
  } | null;
  stuck: { phase: number; phaseName: string; days: number; maxDays: number } | null;
  backgroundInfo: string;
  needsInterpreter: boolean;
  /** "G Lager och logistik" och ev. sekundärt område (för hjälptexten). */
  areaNames: { primary: string; secondary: string | null };
  tracks: { area: string[]; all: { value: string; label: string }[] };
  firstWeekGoals: string[];
}>;
export const intakePage = query("coach.intakePage", z.object({ caseId: IdSchema })).returns<IntakePage>();

// ---------------------------------------------------------------- Händelser och avslut (/handelse/:caseId?lage=avslut)
export type EventsPage = Gated<{
  now: LocalDateTime;
  head: CaseHead;
  referrer: ReferrerView;
  closed: { endReason: EndReason | null; endDate: LocalDate | null; resultClass: ResultClass | null; resultVerifiedAt: LocalDateTime | null } | null;
  events: { id: string; kind: OutcomeEventKind; label: string; occurredOn: LocalDate; actor: string; verificationKind: string | null; note: string; possibleBonus: boolean }[];
  employers: { id: string; name: string }[];
  eventKinds: { value: OutcomeEventKind; label: string }[];
  endReasons: { value: EndReason; label: string }[];
  result: { countsAsResult: string[]; excluded: string[]; definitionText: string };
  finalReport: { id: string; dueAt: LocalDateTime | null; sla: CoachSla | null } | null;
  exitPulse: { sentAt: LocalDateTime; channel: "sms" | "email"; expiresAt: LocalDateTime } | null;
  finalDays: number;
  finalProvisional: boolean;
  /**
   * Bonusmodellen är aktiv. Saknas för begränsade testare i testmiljön (src/api/tester-access.ts): bonus är ett ekonomiskt
   * villkor – kortet Bonus, kolumnen Bonusunderlag och markeringen visas då inte (events[].possibleBonus är alltid false).
   */
  bonusOn?: boolean;
}>;
export const eventsPage = query("coach.eventsPage", z.object({ caseId: IdSchema })).returns<EventsPage>();
