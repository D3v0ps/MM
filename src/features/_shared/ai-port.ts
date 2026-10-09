// Porten till AI-stödet (SPEC §8.3, docs/PLAN-ROST.md). Hanterare och jobb når AI bara via ctx.ai – aldrig en leverantör
// direkt (CLAUDE.md: AI bara via adaptern). Isomorf: typer, zod-scheman och hjälpare används av båda körlägena.
//   Minnesläget (prototypen, utveckling, e2e): simulerad AI (createSimulatedAi i ai-sim.ts) – deterministisk.
//   Supabase-läget: leverantören i MM_AI_PROVIDER – vertex (Gemini via Vertex AI EU, src/server/ai) eller simulated.
//
// Stegen: transcribe (ljud -> transkript med tidpunkter) -> extract (transkript -> formulärets fält med belägg) och
// draft (bara GODKÄNDA uppgifter -> utkast med källor), translate (deltagarens språk -> svenska).
// Varje anrop returnerar { value, run }: run är det som sparas i ai_runs (leverantör, modell, tid, token, kostnad).
// Varje körning sparas i ai_runs (aiRunRow nedan) och varje beslut i ai_field_decisions – av hanteraren eller jobbet.
//
// Regler (CLAUDE.md punkt 5–8): AI föreslår – människan bedömer. AI sätter aldrig nivå, samlad status, avslutsorsak eller
// resultat – därför finns inga sådana fält i schemana (strictObject: ett svar med t.ex. overallStatus underkänns).
// Belägg = kort citat + tidpunkt i sekunder; saknas belägg: "Framgår inte" (noEvidence). Aldrig AI för skyddade
// personuppgifter, aldrig coachens inspelning utan samtycke (recordingBlock). Rapporter byggs bara av godkända uppgifter
// (DraftInput tar bara godkända avstämningar – assertApprovedInput).
import { z } from "zod";
import { ApiError, type Ctx } from "@/api/server";
import { recordingEnabled, type ContractConfig, type RecordingKind } from "@/core/config";
import type { LocalDateTime, MonthKey } from "@/core/time";
import {
  EMPLOYER_CONTACT_COUNTS, GOAL_STATUSES,
  type AiConsentStatus, type AiRun, type AiRunKind, type AiRunStatus, type AttendanceStatus, type CheckIn, type EmployerContacts, type GoalStatus,
  type Person, type TranscriptLine,
} from "@/data/schema";
import type { AiFieldSuggestion, CheckInSuggestions } from "./ai-types";
import type { AudioRef } from "./audio-port";

export type { AiFieldSuggestion, CheckInSuggestions };

// ---------------------------------------------------------------- Körningens mätvärden (ai_runs)
/** Det som sparas i ai_runs för ett anrop (SPEC §8.5: tid, token, kostnad). */
export type AiRunMeta = {
  /** T.ex. "vertex_eu" eller "simulated". */
  provider: string;
  /** Modellen (MM_AI_MODEL), t.ex. "gemini-…-flash", eller "simulerad". */
  model: string;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Ljudets längd i sekunder (transcribe), annars null. */
  audioSeconds: number | null;
  /** Kostnad i öre (uppskattad från leverantörens prislista). */
  costOre: number;
};
/** Svaret från ett anrop: värdet och körningens mätvärden. */
export type AiResult<T> = { value: T; run: AiRunMeta };

// ---------------------------------------------------------------- transcribe
export type TranscriptSegment = {
  /** Sekunder från inspelningens början. */
  start: number;
  end: number;
  text: string;
  /** Talare om den går att avgöra ("Coach", "Deltagare"), annars null. */
  speaker?: string | null;
};
/** Transkriptet. language = språket som talades (ISO 639-1). Råtranskript raderas när avstämningen godkänts, senast efter 30 dagar. */
export type Transcript = { text: string; segments: TranscriptSegment[]; language: string };
/** Ljudet till transcribe: referensen från ctx.audio (read ger även bytes). */
export type AudioInput = AudioRef & { bytes?: Uint8Array | null };

export const TranscriptSchema = z.strictObject({
  text: z.string(),
  segments: z.array(
    z.strictObject({ start: z.number().min(0), end: z.number().min(0), text: z.string(), speaker: z.string().nullable().optional() })
      .refine((s) => s.end >= s.start, "Segmentet slutar före det börjar"),
  ),
  language: z.string().regex(/^[a-z]{2}$/),
}) satisfies z.ZodType<Transcript>;

// ---------------------------------------------------------------- extract
/** Varje fält som förslag med belägg (citat + tidpunkt), eller "Framgår inte" (noEvidence, value null). */
export type WithEvidence<T> = { [K in keyof T]: AiFieldSuggestion<T[K]> };
/** Fälten AI får föreslå i veckoavstämningen. Samlad status finns inte (CLAUDE.md punkt 5). */
export type CheckInExtract = {
  /** Kort kommentar om närvaron ur samtalet (dagar, frånvaro och skäl, anmäld i förväg, vad som bestämts). Aldrig närvarostatus. */
  attendanceComment: string;
  goalStatus: GoalStatus;
  nextGoal: string;
  phase: number;
  activitiesDone: string[];
  employerContacts: EmployerContacts;
  obstacles: string[];
  note: string;
};
/** Formulären som extract fyller i: nyckel -> värdena med belägg. */
export type ExtractSchemas = { check_in: WithEvidence<CheckInExtract> };
export type ExtractSchemaKey = keyof ExtractSchemas;

/** Belägget: med belägg ett citat, utan belägg "Framgår inte" (noEvidence) och inget värde. */
const evidenceRule = (x: { value?: unknown; quote: string; noEvidence?: boolean }) => (x.noEvidence ? x.value === null : x.quote.trim().length > 0);
const evidence = <S extends z.ZodType>(value: S) =>
  z.strictObject({ value: z.nullable(value), quote: z.string(), t: z.number().min(0).nullable(), noEvidence: z.boolean().optional() })
    .refine(evidenceRule, "Förslag utan belägg ska vara \"Framgår inte\" (noEvidence, inget värde)");

/** Veckoavstämningens förslag (samma form som CheckInSuggestions i ai-types.ts). Strikt: inga andra fält, t.ex. samlad status. */
export const CheckInExtractSchema = z.strictObject({
  attendanceComment: evidence(z.string()),
  goalStatus: evidence(z.enum(GOAL_STATUSES)),
  nextGoal: evidence(z.string()),
  phase: evidence(z.int().min(1)),
  activitiesDone: evidence(z.array(z.string())),
  employerContacts: evidence(z.strictObject({ count: z.enum(EMPLOYER_CONTACT_COUNTS).nullable(), types: z.array(z.string()) })),
  obstacles: evidence(z.array(z.string())),
  note: evidence(z.string()),
});
/** zod-schemat per formulär: validera ALLA svar från leverantören – ogiltiga svar sparas som fel och visas aldrig (SPEC §8.3). */
export const EXTRACT_SCHEMAS: { [K in ExtractSchemaKey]: z.ZodType<ExtractSchemas[K]> } = { check_in: CheckInExtractSchema };

// Kompileringskontroll: extract-svaret för avstämningen är exakt förslagen som veckoavstämningen redan visar.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const checkInShapeMatches: Same<ExtractSchemas["check_in"], CheckInSuggestions> = true;
void checkInShapeMatches;

/** Kärnan i instruktionerna till modellen (SPEC §8.3), på svenska. */
export const AI_CORE_INSTRUCTIONS = [
  "Du är ett dokumentationsstöd åt en jobbcoach. Du fattar inga beslut och bedömer inte personen.",
  "Skriv sakligt, respektfullt och funktionellt. Inga diagnoser, inga gissningar, inga värderande ord om personlighet.",
  "Varje uppgift ska ha ett belägg: kort citat och tidpunkt. Finns inget belägg skriver du \"Framgår inte\".",
  "Hälsa och liknande återges bara funktionellt och bara när det behövs för uppdraget (\"behöver instruktioner i skrift\", inte diagnosen).",
  "Svara endast med JSON enligt schemat.",
].join("\n");
/** Instruktionerna per formulär (standard i extract). */
export const EXTRACT_INSTRUCTIONS: Record<ExtractSchemaKey, string> = {
  check_in: [
    AI_CORE_INSTRUCTIONS,
    "Fyll i veckoavstämningen från samtalet mellan coach och deltagare: en kort kommentar om närvaron, veckomålet (yes, partly eller no), nästa veckas mål,",
    "fas (bara om den nämns), genomförda aktiviteter, arbetsgivarkontakter (antal 0, 1 eller 2+ och typ), hinder och en kort anteckning.",
    "Närvarostatus (närvarande/frånvarande) registreras av coachen i Närvaro – föreslå bara kommentarstexten.",
    "Föreslå aldrig samlad status (Grön/Gul/Röd) – den sätter coachen.",
  ].join("\n"),
};

// ---------------------------------------------------------------- draft (bara godkända uppgifter)
/** En godkänd avstämning – underlaget för utkast. status "approved" krävs (rapporter byggs aldrig av råtranskript). */
export type ApprovedCheckIn = Pick<CheckIn, "id" | "heldAt" | "goalStatus" | "nextGoal" | "phase" | "activitiesDone" | "employerContacts" | "obstacles" | "note"> & {
  status: "approved";
};
export type DraftInput = {
  caseId: string;
  month: MonthKey;
  /** Månadens godkända avstämningar. */
  checkIns: ApprovedCheckIn[];
  /** Månadens registrerade närvaro (ett tillfälle per rad). */
  attendance: { status: AttendanceStatus }[];
};
/**
 * Mallar: monthly_area:<områdesnyckel> (observation per progressionsområde, t.ex. "monthly_area:narvaro_rutiner"),
 * monthly_summary (sammanfattning) och monthly_plan (plan för nästa månad).
 */
export type DraftTemplateKey = "monthly_summary" | "monthly_plan" | `monthly_area:${string}`;
/** Utkastet med källor ("Avstämning 15 jan") och källornas id. noEvidence: "Framgår inte" – inget underlag. Märks "AI-utkast" tills det godkänts. */
export type DraftText = { text: string; sources: string[]; sourceIds: string[]; noEvidence: boolean };
export const DraftTextSchema = z.strictObject({
  text: z.string().min(1),
  sources: z.array(z.string()),
  sourceIds: z.array(z.string()),
  noEvidence: z.boolean(),
}) satisfies z.ZodType<DraftText>;

/** Bara godkända avstämningar som underlag (sorterade på tid). */
export function approvedCheckIns(checkIns: readonly CheckIn[]): ApprovedCheckIn[] {
  return checkIns
    .filter((c) => c.status === "approved")
    .sort((a, b) => (a.heldAt < b.heldAt ? -1 : a.heldAt > b.heldAt ? 1 : 0))
    .map((c) => ({
      id: c.id, heldAt: c.heldAt, goalStatus: c.goalStatus, nextGoal: c.nextGoal, phase: c.phase, activitiesDone: [...c.activitiesDone],
      employerContacts: { count: c.employerContacts.count, types: [...c.employerContacts.types] }, obstacles: [...c.obstacles], note: c.note, status: "approved",
    }));
}
/** Stoppar ett utkast som bygger på något annat än godkända uppgifter (CLAUDE.md punkt 6). Anropas av varje leverantör. */
export function assertApprovedInput(input: DraftInput): void {
  if (input.checkIns.some((c) => (c as { status?: unknown }).status !== "approved")) {
    throw new Error("AI-utkast får bara byggas av godkända avstämningar");
  }
}

// ---------------------------------------------------------------- translate
export type Translation = { text: string; from: string; to: string };
export const TranslationSchema = z.strictObject({
  text: z.string(),
  from: z.string().regex(/^[a-z]{2}$/),
  to: z.string().regex(/^[a-z]{2}$/),
}) satisfies z.ZodType<Translation>;

// ---------------------------------------------------------------- Porten
export interface AiPort {
  /** Leverantörens namn och modell (samma som i AiRunMeta). */
  readonly provider: string;
  readonly model: string;
  /** Ljud -> transkript med tidpunkter. language = språket som talas (coachens avstämning "sv", deltagaren sitt val). */
  transcribe(audio: AudioInput, opts: { language: string }): Promise<AiResult<Transcript>>;
  /** Transkript -> formulärets fält med belägg. instructions: standard EXTRACT_INSTRUCTIONS[schemaKey]. */
  extract<K extends ExtractSchemaKey>(transcript: Transcript, schemaKey: K, instructions?: string): Promise<AiResult<ExtractSchemas[K]>>;
  /** Bara godkända uppgifter -> utkast med källor. */
  draft(input: DraftInput, templateKey: DraftTemplateKey): Promise<AiResult<DraftText>>;
  /** Text från ett språk till ett annat (deltagarens röstmeddelande -> svenska). Märks "AI-översättning". */
  translate(text: string, from: string, to: string): Promise<AiResult<Translation>>;
}

/** ctx.ai, eller ApiError 500 om AI inte är inkopplad i körläget (den manuella vägen fungerar alltid). */
export function requireAi(ctx: Pick<Ctx, "ai">): AiPort {
  if (!ctx.ai) throw new ApiError(500, "ai_unavailable", AI_OFF_TEXT);
  return ctx.ai;
}

// ---------------------------------------------------------------- AI av (beslut 2026-10-08, skarp drift)
/**
 * Texten när AI-stödet inte är kopplat (produktion utan MM_AI_PROVIDER – ctx.ai saknas). Klarspråk i stället för krasch:
 * inspelning, diktering, AI-förslag och AI-utkast visar den här texten och den manuella vägen gäller. Ingen simulerad text
 * får visas i produktion – den simulerade leverantören finns bara i minnesläget, prototypen och testmiljön.
 */
export const AI_OFF_TEXT = "Tal till text är inte kopplat ännu – skriv själv så länge.";
/** Samma sak för deltagarens inspelningslänk (coachen kan inte skicka den när inget kan transkriberas). */
export const AI_OFF_LINK_TEXT = "Tal till text är inte kopplat ännu – inspelningslänkar kan skickas när AI-stödet är kopplat.";
/** true = AI-stödet är av i körläget (ctx.ai saknas). */
export const aiOff = (ctx: Pick<Ctx, "ai">): boolean => !ctx.ai;

// ---------------------------------------------------------------- Får inspelning och AI användas?
export type RecordingBlock = "ai_off" | "disabled" | "protected" | "no_consent";
export const RECORDING_BLOCK_TEXT: Record<RecordingBlock, string> = {
  ai_off: AI_OFF_TEXT,
  disabled: "Inspelning är inte påslagen i avtalet.",
  protected: "Inspelning och AI används aldrig för personer med skyddade personuppgifter.",
  no_consent: "Deltagaren har inte gett sitt samtycke till inspelning. Fyll i formuläret själv.",
};
/**
 * Varför inspelning (och AI) inte får användas – null om den får. Samma regler i alla flöden:
 *   avtalet (recordingEnabled: påslaget, kommunens godkännande, fastställd leverantör) · aldrig skyddade personuppgifter
 *   (person saknas räknas som skyddad; kommunens "Tala in" i en ny beställning utan person: person undefined) ·
 *   coachens inspelning kräver registrerat samtycke (cases.aiConsentStatus = given, consents). Deltagarens samtycke ges i länken.
 */
export function recordingBlock(o: {
  cfg: Pick<ContractConfig, "ai"> | null | undefined;
  kind: RecordingKind;
  /** Personen i ärendet. null = ärendet finns men personen syns inte (räknas som skyddad). undefined = ingen person (ny beställning). */
  person?: Pick<Person, "protectedIdentity"> | null;
  /** Ärendets samtycke (coachens inspelning). */
  consent?: AiConsentStatus | null;
  /** Den nya beställningen gäller skyddade personuppgifter (kommunens "Tala in" innan ärendet finns). */
  protectedOrder?: boolean;
}): RecordingBlock | null {
  if (!recordingEnabled(o.cfg, o.kind)) return "disabled";
  if (o.protectedOrder || o.person === null || o.person?.protectedIdentity) return "protected";
  // Coachens och deltagarens inspelning gäller alltid en känd person; bara kommunens "Tala in" kan sakna person (ny beställning).
  if (o.person === undefined && o.kind !== "customer") return "protected";
  if (o.kind === "coach" && o.consent !== "given") return "no_consent";
  return null;
}

// ---------------------------------------------------------------- Hjälpare
/** Raden i ai_runs för en körning. Inga personuppgifter i output utöver det som körningen gällde (raderas enligt reglerna). */
export function aiRunRow(o: {
  id: string;
  now: LocalDateTime;
  caseId: string | null;
  kind: AiRunKind;
  /** audio_uploads.id eller annan referens till underlaget. */
  inputRef: string | null;
  status: AiRunStatus;
  run: AiRunMeta | null;
  output?: unknown;
  evidence?: unknown;
  inputDeletedAt?: LocalDateTime | null;
}): AiRun {
  const r = o.run;
  return {
    id: o.id, caseId: o.caseId, kind: o.kind, provider: r?.provider ?? "okänd", model: r?.model ?? "okänd", inputRef: o.inputRef, status: o.status, createdAt: o.now,
    audioSeconds: r?.audioSeconds ?? null, tokensIn: r?.tokensIn ?? null, tokensOut: r?.tokensOut ?? null, costOre: r?.costOre ?? 0, latencyMs: r?.latencyMs ?? null,
    output: o.output ?? null, evidence: o.evidence ?? null, inputDeletedAt: o.inputDeletedAt ?? null,
  };
}
/** Summera flera anrop (t.ex. transcribe + translate) till en körning. */
export function sumRuns(runs: readonly AiRunMeta[]): AiRunMeta {
  const sumOrNull = (xs: (number | null)[]) => (xs.every((x) => x == null) ? null : xs.reduce<number>((a, b) => a + (b ?? 0), 0));
  return {
    provider: runs[0]?.provider ?? "okänd",
    model: runs[0]?.model ?? "okänd",
    latencyMs: runs.reduce((a, r) => a + r.latencyMs, 0),
    tokensIn: sumOrNull(runs.map((r) => r.tokensIn)),
    tokensOut: sumOrNull(runs.map((r) => r.tokensOut)),
    audioSeconds: sumOrNull(runs.map((r) => r.audioSeconds)),
    costOre: runs.reduce((a, r) => a + r.costOre, 0),
  };
}
/** Transkriptet som rader för avstämningens visning (CheckInAiDraft.transcript): t = sekunder, who = talaren. */
export function transcriptLines(t: Transcript): TranscriptLine[] {
  return t.segments.map((s) => ({ t: Math.round(s.start), who: s.speaker ?? "Samtal", text: s.text }));
}
/** Sekunder som "mm:ss" (belägg och transkript). */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
