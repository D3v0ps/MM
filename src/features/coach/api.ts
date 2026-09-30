// Kontrakt för området coach (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
import { z } from "zod";
import { command, type Fail, type Result } from "@/api/contract";
import {
  AI_DECISIONS, AI_RUN_KINDS, ATTENDANCE_STATUSES, CHECK_IN_MODES, DEVIATION_STATUSES, EMPLOYER_CONTACT_COUNTS, GOAL_STATUSES, INPUT_METHODS, OUTCOME_EVENT_KINDS,
  TRAFFIC_LIGHTS, type TranscriptLine,
} from "@/data/schema";
import { AI_SOURCES, type AiSource, type CheckInSuggestions } from "../_shared/ai-types";
import { IdSchema, LocalDateSchema, LocalDateTimeSchema, LongText, MonthKeySchema, ShortText } from "../_shared/schemas";
import type { WeeklyPublished } from "../_shared/weekly";

export type { AiFieldSuggestion, AiField, AiSource, CheckInSuggestions } from "../_shared/ai-types";
export { AI_FIELDS, AI_SOURCES } from "../_shared/ai-types";
export type { WeeklyPublished } from "../_shared/weekly";

// ---- Delade kommandon (portade från prototypens 03-domain.js)
// Samma beteende, valideringar, felkoder och texter som prototypens MM.defineAction. Nyckeln är "coach.<prototypens namn>".
// Gemensamma felkoder: not_found = ärendet/raden finns inte eller rollen får inte se det, forbidden = får se men inte ändra.

/**
 * Registrera närvaro (prototypens attendance.set och coach.attendanceSet). Veckorapporten till handläggaren publiceras
 * automatiskt när all närvaro för hennes deltagare är registrerad – kontrollen görs mot färska data i samma kommando.
 * published = rapporten som publicerades (för meddelandet "Veckorapporten för v. 4 2027 till … publicerades automatiskt.").
 */
export const attendanceSet = command("coach.attendanceSet", z.object({
  activityId: IdSchema,
  status: z.enum(ATTENDANCE_STATUSES),
  /** Frånvaroorsak (giltig frånvaro). */
  reason: ShortText.optional(),
})).returns<Result<{ attendanceId: string; published: WeeklyPublished | null }, "not_found">>();

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
 * Röd samlad status kräver en avvikelse (deviation_required) – den skapas i samma kommando. AI-baserad inmatning kräver
 * samtycke och är aldrig tillåten vid skyddade personuppgifter (ai_not_allowed). Vid godkännande raderas råtranskriptet.
 * aiDecisions: coachens beslut per AI-förslag (accepted/edited/rejected) – loggas.
 */
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
})).returns<Result<{ checkInId: string; deviationId: string | null; rawTranscriptDeletedAt: string | null }, "not_found" | "forbidden" | "deviation_required" | "ai_not_allowed">>();

/** Spara (eller stäng) en avvikelse (prototypens deviation.save). Kräver den beslut av kommunen skapas en uppgift till handläggaren. */
export const deviationSave = command("coach.deviationSave", z.object({
  id: IdSchema.optional(),
  caseId: IdSchema,
  data: DeviationInputSchema.partial().extend({
    followUpMeetingAt: LocalDateTimeSchema.nullable().optional(),
    status: z.enum(DEVIATION_STATUSES).optional(),
  }),
})).returns<Result<{ deviationId: string }, "not_found" | "forbidden">>();

/** Kalla kommunen till uppföljning (AFK 7.8): säkert meddelande + mejl utan personuppgifter (prototypens deviation.callCustomer). */
export const deviationCallCustomer = command("coach.deviationCallCustomer", z.object({
  caseId: IdSchema,
  deviationId: IdSchema.nullable().optional(),
  body: LongText,
  proposedAt: LocalDateTimeSchema.nullable().optional(),
})).returns<Result<{ messageId: string }, "not_found" | "forbidden" | "empty">>();

/** Ett progressionsområde som coachen bedömt. Nivån sätts bara av coachen – aldrig av AI. */
export const AreaInputSchema = z.object({
  level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).nullable().optional(),
  observation: z.string().max(2000).optional(),
  nextStep: z.string().max(1000).optional(),
});

/**
 * Spara eller godkänn månadsbedömningen (prototypens assessment.save). Godkännande kräver nivå i varje område, observation
 * från avtalets nivå (observationRequiredFromLevel) och samlad status – annars incomplete med missing (områdesnycklarna).
 * Vid godkännande blir månadsrapporten "Granskad av coach". plan = planen för nästa månad.
 */
export const assessmentSave = command("coach.assessmentSave", z.object({
  caseId: IdSchema,
  month: MonthKeySchema,
  areas: z.record(z.string().max(60), AreaInputSchema).optional(),
  summary: z.string().max(4000).nullable().optional(),
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
})).returns<Result<{ assessmentId: string }, "not_found" | "forbidden"> | (Fail<"incomplete"> & { missing: string[] })>();

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
})).returns<Result<{ intakeId: string }, "not_found" | "forbidden">>();

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
})).returns<Result<{ eventId: string }, "not_found" | "forbidden">>();

/** Verifiera resultatet (arbete/studier) med underlag (prototypens result.verify). */
export const resultVerify = command("coach.resultVerify", z.object({
  caseId: IdSchema,
  verificationKind: ShortText,
  file: ShortText.nullable().optional(),
})).returns<Result<object, "not_found" | "forbidden">>();

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
})).returns<Result<AiRunResult, "not_found" | "ai_not_allowed">>();

export type AiRunResult = {
  runId: string;
  source: AiSource | null;
  /** Förslagen per fält (null för körningar som inte gäller en avstämning). */
  suggestions: CheckInSuggestions | null;
  transcript: TranscriptLine[];
  audioDeletedAt: string | null;
  rawTranscriptDeleteBy: string | null;
};
