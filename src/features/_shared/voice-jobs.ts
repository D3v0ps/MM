// Röstinspelningens bakgrundsjobb (docs/PLAN-ROST.md, docs/AI.md, SPEC §8.3). Isomorf – samma kod i alla körlägen:
//   minnesläget och prototypen  jobbet körs direkt i kommandot (enqueueVoiceJob, ingen kö – deterministiskt: id via
//                               ctx.newId, tid via ctx.now)
//   supabase-läget              jobbet läggs i tabellen jobs och körs med after() direkt efter svaret, annars av cron
//                               (/api/jobs/run varje minut) – src/server/jobs/voice.ts. Ctx har då fältet jobs (JobKick).
//
// Jobben:
//   transcribe_recording    coachens inspelning/ljudfil: transcribe -> ljudet raderas -> extract -> förslag med belägg i
//                           ai_runs (och i avstämningsutkastet om det finns) – coachen godkänner i veckoavstämningen
//   transcribe_dictation    kommunens "Tala in": transcribe -> ljudet raderas -> texten i ai_runs.output (gallras efter 24 h)
//   transcribe_participant  deltagarens länk: transcribe -> ljudet raderas -> translate till svenska -> participant_voice_notes
//   draft_monthly           utkast till månadsbedömningen – BARA från godkända avstämningar och registrerad närvaro
//   retention_audio         ljud som inte raderats efter 24 timmar raderas (CLAUDE.md punkt 7)
//   retention_transcripts   råtranskript raderas när avstämningen godkänts, senast efter 30 dagar; dikteringens text efter 24 h
//
// Regler (CLAUDE.md punkt 5–8): AI sätter aldrig nivå, samlad status, avslutsorsak eller resultat. Aldrig AI för skyddade
// personuppgifter och aldrig coachens inspelning utan samtycke – kontrolleras när jobbet läggs OCH när det körs (samtycket
// kan ha återkallats). Ljudet raderas direkt efter lyckad transkribering. Ogiltiga AI-svar sparas som fel och visas aldrig.
// Varje körning i ai_runs (leverantör, modell, tid, token, kostnad), varje radering och körning i revisionsloggen (bara id).
// Felorsaker är fasta texter utan personuppgifter.
//
// Alla läsningar och skrivningar går via ctx.system: jobbet är ett systemsteg (bakgrundsjobb) som körs efter att
// hanteraren kontrollerat behörigheten (startAudioUpload/confirmOwnUpload i voice-upload.ts, eller coachens ärende).
import { z } from "zod";
import type { Ctx } from "@/api/server";
import { aiAllowed } from "@/core/cases";
import { aiLanguages, isOperational, progressionAreas, recordingEnabled, type ContractConfig } from "@/core/config";
import { addDays, addMinutes, monthKey, type LocalDateTime, type MonthKey } from "@/core/time";
import type { AiRun, AiRunKind, AiRunStatus, AudioUpload, Case, CheckIn, CheckInAiDraft, Job, MonthlyAssessment, ParticipantVoiceNote, Person } from "@/data/schema";
import {
  aiRunRow, approvedCheckIns, EXTRACT_SCHEMAS, recordingBlock, requireAi, sumRuns, transcriptLines, TranscriptSchema,
  type AiRunMeta, type CheckInSuggestions, type DraftInput, type DraftTemplateKey, type DraftText, type RecordingBlock, type Transcript,
} from "./ai-port";
import { AUDIO_RETENTION_HOURS, requireAudio } from "./audio-port";
import { AI_FIELDS, type AiSource } from "./ai-types";
import { blankArea, newAssessment } from "./rows";

// ---------------------------------------------------------------- Jobbtyperna och deras innehåll
export const VOICE_JOB_KINDS = [
  "transcribe_recording", "transcribe_dictation", "transcribe_participant", "draft_monthly", "retention_audio", "retention_transcripts",
] as const;
export type VoiceJobKind = (typeof VOICE_JOB_KINDS)[number];
export const isVoiceJobKind = (k: string): k is VoiceJobKind => (VOICE_JOB_KINDS as readonly string[]).includes(k);

const Id = z.string().min(1).max(200);
const LocalDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
/** Jobbens payload (jobs.payload). Bara id:n och fasta värden – aldrig personuppgifter. */
export const VOICE_JOB_PAYLOADS = {
  transcribe_recording: z.strictObject({ aiRunId: Id, uploadId: Id, source: z.enum(["recording", "upload"]), checkInId: Id.nullable() }),
  transcribe_dictation: z.strictObject({ aiRunId: Id, uploadId: Id, contractId: Id }),
  transcribe_participant: z.strictObject({
    aiRunId: Id, uploadId: Id, linkId: Id, language: z.string().regex(/^[a-z]{2}$/), consentTextVersion: z.string().min(1).max(200), consentGivenAt: LocalDateTimeSchema,
  }),
  draft_monthly: z.strictObject({ aiRunId: Id, caseId: Id, month: z.string().regex(/^\d{4}-\d{2}$/) }),
  retention_audio: z.strictObject({}),
  retention_transcripts: z.strictObject({}),
} as const;
export type VoiceJobPayloads = { [K in VoiceJobKind]: z.infer<(typeof VOICE_JOB_PAYLOADS)[K]> };

/** AI-körningens typ (ai_runs.kind) per jobb. */
const RUN_KIND: Partial<Record<VoiceJobKind, AiRunKind>> = {
  transcribe_recording: "transcribe_extract",
  transcribe_dictation: "transcribe_dictation",
  transcribe_participant: "transcribe_participant",
  draft_monthly: "monthly_draft",
};

// ---------------------------------------------------------------- Fel (fasta texter, inga personuppgifter)
export const VOICE_JOB_ERRORS = [
  "not_found", "audio_missing", "blocked_disabled", "blocked_protected", "blocked_no_consent", "language", "invalid_response", "provider_blocked",
  "provider_unavailable", "provider_config", "audio_too_large", "audio_unsupported", "audio_expired", "unexpected",
] as const;
export type VoiceJobErrorCode = (typeof VOICE_JOB_ERRORS)[number];
/** Texten till användaren (och jobs.last_error). */
export const VOICE_JOB_ERROR_TEXT: Record<VoiceJobErrorCode, string> = {
  not_found: "Underlaget för AI-körningen finns inte längre.",
  audio_missing: "Ljudfilen saknas. Spela in eller ladda upp igen.",
  blocked_disabled: "Inspelning är inte påslagen i avtalet.",
  blocked_protected: "Inspelning och AI används aldrig för personer med skyddade personuppgifter.",
  blocked_no_consent: "Deltagaren har inte gett sitt samtycke till inspelning. Fyll i formuläret själv.",
  language: "Språket finns inte bland avtalets språk.",
  invalid_response: "AI-svaret kunde inte användas. Fyll i formuläret själv eller försök igen.",
  provider_blocked: "AI-tjänsten stoppade svaret. Fyll i formuläret själv.",
  provider_unavailable: "AI-tjänsten svarar inte just nu. Försök igen om en stund.",
  provider_config: "AI-tjänsten är inte rätt inställd. Kontakta administratören.",
  audio_too_large: "Inspelningen är för lång för att transkriberas. Dela upp den eller fyll i formuläret själv.",
  audio_unsupported: "Ljudformatet kunde inte läsas. Använd m4a, mp3, wav eller webm.",
  audio_expired: "Ljudet raderades efter 24 timmar utan att ha transkriberats.",
  unexpected: "Något gick fel i AI-körningen. Fyll i formuläret själv eller försök igen.",
};
const BLOCK_CODE: Record<RecordingBlock, VoiceJobErrorCode> = { disabled: "blocked_disabled", protected: "blocked_protected", no_consent: "blocked_no_consent" };

/** Fel i ett röstjobb. retryable = värt att försöka igen senare (servern lägger tillbaka jobbet i kön). */
export class VoiceJobError extends Error {
  readonly code: VoiceJobErrorCode;
  readonly retryable: boolean;
  /** Mätvärden för AI-anrop som hann göras (token förbrukade även när svaret var ogiltigt). */
  readonly runs: AiRunMeta[];
  constructor(code: VoiceJobErrorCode, opts: { retryable?: boolean; runs?: AiRunMeta[] } = {}) {
    super(VOICE_JOB_ERROR_TEXT[code]);
    this.name = "VoiceJobError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.runs = opts.runs ?? [];
  }
}

/** Leverantörens fel (src/server/ai/errors.ts: code, retryable, run) -> VoiceJobError. Känner inte till serverns klasser. */
export function toVoiceJobError(e: unknown, spent: AiRunMeta[] = []): VoiceJobError {
  if (e instanceof VoiceJobError) return spent.length ? new VoiceJobError(e.code, { retryable: e.retryable, runs: [...spent, ...e.runs] }) : e;
  const x = (e && typeof e === "object" ? e : {}) as { code?: unknown; retryable?: unknown; run?: unknown };
  const run = x.run && typeof x.run === "object" ? [x.run as AiRunMeta] : [];
  const runs = [...spent, ...run];
  const map: Record<string, VoiceJobErrorCode> = {
    invalid_response: "invalid_response", blocked: "provider_blocked", unavailable: "provider_unavailable", config: "provider_config",
    too_large: "audio_too_large", unsupported: "audio_unsupported",
  };
  const code = typeof x.code === "string" && map[x.code] ? map[x.code] : x.retryable === true ? "provider_unavailable" : "unexpected";
  return new VoiceJobError(code, { retryable: x.retryable === true, runs });
}

/** Felkoden ur jobs.last_error (texten) – för onGiveUp på servern. */
export const voiceErrorCodeFromText = (text: string): VoiceJobErrorCode =>
  (Object.entries(VOICE_JOB_ERROR_TEXT).find(([, t]) => t === text)?.[0] as VoiceJobErrorCode | undefined) ?? "unexpected";

/** Felet för en misslyckad AI-körning (ai_runs.output.error), eller null. */
export function aiRunError(run: Pick<AiRun, "status" | "output"> | null | undefined): { code: VoiceJobErrorCode; text: string } | null {
  if (!run || run.status !== "failed") return null;
  const c = (run.output as { error?: unknown } | null)?.error;
  const code = typeof c === "string" && (VOICE_JOB_ERRORS as readonly string[]).includes(c) ? (c as VoiceJobErrorCode) : "unexpected";
  return { code, text: VOICE_JOB_ERROR_TEXT[code] };
}

// ---------------------------------------------------------------- Kön
/** Serverns kö (supabase-läget): kör jobben snart (after()). Finns inte i minnesläget – där körs jobbet direkt. Fältet ctx.jobs. */
export type { JobKick } from "@/api/server";
/** Ctx med serverns kö – samma som Ctx (fältet jobs finns i Ctx sedan 2026-10-01). Kvar som namn för befintlig kod. */
export type CtxWithJobs = Ctx;

/** Det som sparas i ai_runs.output för en avstämning (samma form som coach/handlers.ts läser vid checkinSave). */
export type CheckInAiOutput = { source: AiSource; suggestions: CheckInSuggestions; transcript: ReturnType<typeof transcriptLines> };
/** Deltagarens och dikteringens resultat. */
export type DictationOutput = { text: string | null; clearedAt?: LocalDateTime };
export type ParticipantOutput = { noteId: string };
export type MonthlyDraftOutput = { month: MonthKey; areas: Record<string, DraftText>; summary: DraftText; plan: DraftText; assessmentId: string | null };

export type VoiceJobRequest =
  | { kind: "transcribe_recording"; uploadId: string; source: "recording" | "upload"; checkInId?: string | null }
  | { kind: "transcribe_dictation"; uploadId: string; contractId: string }
  | { kind: "transcribe_participant"; uploadId: string; linkId: string; language: string; consentTextVersion: string; consentGivenAt: LocalDateTime }
  | { kind: "draft_monthly"; caseId: string; month: MonthKey };

export type EnqueueResult = {
  jobId: string;
  /** AI-körningen – frågan om läget läser den (status running -> succeeded/failed, output). */
  aiRunId: string;
  /** running = ligger i kön (servern). succeeded/failed = kördes direkt (minnesläget). */
  status: AiRunStatus;
  /** Felet om körningen misslyckades direkt. */
  error: { code: VoiceJobErrorCode; text: string } | null;
};

const zeroRun = (ctx: Ctx): AiRunMeta => {
  const ai = requireAi(ctx);
  return { provider: ai.provider, model: ai.model, latencyMs: 0, tokensIn: null, tokensOut: null, audioSeconds: null, costOre: 0 };
};

/**
 * Lägg ett röstjobb: AI-körningen (ai_runs, status running) och jobbet (jobs). Hanteraren har kontrollerat behörigheten
 * (ärendet via ctx.repo, confirmOwnUpload). Minnesläget: jobbet körs direkt och resultatet finns när kommandot svarar.
 * Supabase-läget: jobbet körs direkt efter svaret (after()) – frågan om läget läser ai_runs tills status ändras.
 */
export async function enqueueVoiceJob(ctx: CtxWithJobs, req: VoiceJobRequest): Promise<EnqueueResult> {
  const now = ctx.now();
  const { kind } = req;
  // ctx.system: systemsteg – körningen och jobbet skrivs av systemet efter hanterarens behörighetskontroll.
  let caseId: string | null;
  let inputRef: string | null;
  if (req.kind === "draft_monthly") {
    caseId = req.caseId;
    inputRef = req.month;
  } else {
    const u = await ctx.system.table("audio_uploads").get(req.uploadId);
    caseId = u?.caseId ?? null;
    inputRef = req.uploadId;
  }
  const aiRunId = ctx.newId("ai");
  await ctx.system.table("ai_runs").insert(aiRunRow({ id: aiRunId, now, caseId, kind: RUN_KIND[kind] as AiRunKind, inputRef, status: "running", run: zeroRun(ctx) }));
  const payload = payloadOf(req, aiRunId);
  const jobId = ctx.newId("job");
  const job: Job = {
    id: jobId, kind, payload, status: ctx.jobs ? "queued" : "running", attempts: ctx.jobs ? 0 : 1, runAfter: now, lastError: null, createdAt: now,
    createdBy: ctx.actor.userId, finishedAt: null,
  };
  await ctx.system.table("jobs").insert(job);
  if (ctx.jobs) {
    ctx.jobs.schedule();
    return { jobId, aiRunId, status: "running", error: null };
  }
  // Minnesläget och prototypen: kör direkt (inga nya försök – felet visas och den manuella vägen gäller).
  try {
    await runVoiceJob(ctx, kind, payload);
    await ctx.system.table("jobs").update(jobId, { status: "done", finishedAt: ctx.now() });
  } catch (e) {
    const err = toVoiceJobError(e);
    await failVoiceJob(ctx, kind, payload, err);
    await ctx.system.table("jobs").update(jobId, { status: "failed", lastError: err.message, finishedAt: ctx.now() });
  }
  const run = await ctx.system.table("ai_runs").get(aiRunId);
  return { jobId, aiRunId, status: run?.status ?? "failed", error: aiRunError(run) };
}

function payloadOf(req: VoiceJobRequest, aiRunId: string): Record<string, unknown> {
  switch (req.kind) {
    case "transcribe_recording":
      return { aiRunId, uploadId: req.uploadId, source: req.source, checkInId: req.checkInId ?? null };
    case "transcribe_dictation":
      return { aiRunId, uploadId: req.uploadId, contractId: req.contractId };
    case "transcribe_participant":
      return { aiRunId, uploadId: req.uploadId, linkId: req.linkId, language: req.language, consentTextVersion: req.consentTextVersion, consentGivenAt: req.consentGivenAt };
    case "draft_monthly":
      return { aiRunId, caseId: req.caseId, month: req.month };
  }
}

/** Kontrollera jobbets payload. Ogiltig payload: inte värt att försöka igen. */
export function parseVoicePayload<K extends VoiceJobKind>(kind: K, payload: unknown): VoiceJobPayloads[K] {
  const p = VOICE_JOB_PAYLOADS[kind].safeParse(payload ?? {});
  if (!p.success) throw new VoiceJobError("not_found");
  return p.data as VoiceJobPayloads[K];
}

// ---------------------------------------------------------------- Körning
/** Kör ett röstjobb. Returnerar ett kort utfall ("succeeded", "already_done", "removed:3" …). Kastar VoiceJobError. */
export async function runVoiceJob(ctx: Ctx, kind: VoiceJobKind, payload: unknown): Promise<string> {
  switch (kind) {
    case "transcribe_recording":
      return transcribeRecording(ctx, parseVoicePayload(kind, payload));
    case "transcribe_dictation":
      return transcribeDictation(ctx, parseVoicePayload(kind, payload));
    case "transcribe_participant":
      return transcribeParticipant(ctx, parseVoicePayload(kind, payload));
    case "draft_monthly":
      return draftMonthly(ctx, parseVoicePayload(kind, payload));
    case "retention_audio":
      return retentionAudio(ctx);
    case "retention_transcripts":
      return retentionTranscripts(ctx);
  }
}

/**
 * Jobbet gav upp: körningen markeras som misslyckad (felkoden, aldrig AI-svaret), ett råtranskript som sparats för nya
 * försök töms, och ljudet markeras failed (gallras senast efter 24 timmar – eller raderas direkt om det inte fick användas).
 * Deltagarens länk (transcribe_participant) går att använda igen (usedAt = null), så att deltagaren kan försöka på nytt.
 */
export async function failVoiceJob(ctx: Ctx, kind: VoiceJobKind, payload: unknown, error: unknown): Promise<void> {
  const err = error instanceof VoiceJobError ? error : toVoiceJobError(error);
  const p = (payload ?? {}) as { aiRunId?: unknown; uploadId?: unknown };
  const runId = typeof p.aiRunId === "string" ? p.aiRunId : null;
  const run = runId ? await ctx.system.table("ai_runs").get(runId) : null;
  // Bara en körning som pågår markeras – ett andra anrop (t.ex. onGiveUp efter sista försöket) ändrar ingenting.
  if (run && run.status === "running") {
    // Felets mätvärden innehåller redan transkriberingen när felet kom efter den; annars de sparade från tidigare försök.
    const spent = err.runs.length ? err.runs : pendingOf(run).runs;
    const m = spent.length ? sumRuns(spent) : null;
    await ctx.system.table("ai_runs").update(run.id, {
      status: "failed",
      output: { error: err.code },
      evidence: null,
      ...(m ? { tokensIn: m.tokensIn, tokensOut: m.tokensOut, costOre: m.costOre, latencyMs: m.latencyMs, audioSeconds: m.audioSeconds ?? run.audioSeconds } : {}),
    });
    await ctx.audit({ action: "ai.run_failed", entity: "ai_run", entityId: run.id, contractId: await contractIdOf(ctx, run.caseId), details: { kind: run.kind, code: err.code } });
    // Deltagarens länk: rost.send förbrukade den när jobbet lades (supabase-läget). Transkriberingen gick inte – länken
    // öppnas igen så att deltagaren kan försöka på nytt (den gäller fortfarande bara till expiresAt). Bara en gång per körning.
    const linkId = kind === "transcribe_participant" && typeof (p as { linkId?: unknown }).linkId === "string" ? (p as { linkId: string }).linkId : null;
    const link = linkId ? await ctx.system.table("voice_links").get(linkId) : null;
    if (link?.usedAt) {
      await ctx.system.table("voice_links").update(link.id, { usedAt: null });
      await ctx.audit({ action: "voice.link_reopened", entity: "voice_link", entityId: link.id, contractId: await contractIdOf(ctx, link.caseId), details: { caseId: link.caseId, aiRunId: run.id, code: err.code } });
    }
  }
  const uploadId = typeof p.uploadId === "string" ? p.uploadId : null;
  if (uploadId && ctx.audio) {
    const u = await ctx.system.table("audio_uploads").get(uploadId);
    if (u && u.status !== "deleted") {
      if (err.code.startsWith("blocked_")) await deleteAudio(ctx, u, run?.id ?? null, "Inspelningen fick inte användas");
      else await ctx.audio.mark(u.id, "failed");
    }
  }
}

// ---------------------------------------------------------------- Hjälpare
type Pending = { transcript: Transcript | null; runs: AiRunMeta[] };
/** Råtranskript som sparats i körningen innan ljudet raderades (för nya försök utan ljud). */
function pendingOf(run: AiRun): Pending {
  const p = (run.output as { pending?: { transcript?: unknown; runs?: unknown } } | null)?.pending;
  const t = p?.transcript ? TranscriptSchema.safeParse(p.transcript) : null;
  return { transcript: t?.success ? t.data : null, runs: Array.isArray(p?.runs) ? (p.runs as AiRunMeta[]) : [] };
}

async function contractIdOf(ctx: Ctx, caseId: string | null): Promise<string | null> {
  if (!caseId) return null;
  return (await ctx.system.table("cases").get(caseId))?.contractId ?? null;
}

type CaseCtx = { c: Case; person: Person | null; config: ContractConfig | null };
async function caseCtx(ctx: Ctx, caseId: string | null): Promise<CaseCtx | null> {
  if (!caseId) return null;
  const c = await ctx.system.table("cases").get(caseId);
  if (!c) return null;
  const [person, contract] = await Promise.all([ctx.system.table("persons").get(c.personId), ctx.system.table("contracts").get(c.contractId)]);
  return { c, person, config: contract?.config ?? null };
}

/** Radera ljudet (ctx.audio.remove), notera det i körningen och revisionsloggen. */
async function deleteAudio(ctx: Ctx, u: AudioUpload, runId: string | null, reason: string): Promise<LocalDateTime | null> {
  const r = await requireAudio(ctx).remove(u.id);
  const deletedAt = r?.deletedAt ?? null;
  if (runId && deletedAt) await ctx.system.table("ai_runs").update(runId, { inputDeletedAt: deletedAt });
  await ctx.audit({ action: "audio.deleted", entity: "audio_upload", entityId: u.id, contractId: await contractIdOf(ctx, u.caseId), details: { reason, purpose: u.purpose, aiRunId: runId } });
  return deletedAt;
}

/**
 * Transkribera ljudet – eller använd råtranskriptet från ett tidigare försök. Efter lyckad transkribering sparas
 * transkriptet i körningen (för nya försök) och ljudet raderas direkt (CLAUDE.md punkt 7).
 */
async function transcribeOnce(ctx: Ctx, run: AiRun, u: AudioUpload, language: string): Promise<{ transcript: Transcript; runs: AiRunMeta[]; deletedAt: LocalDateTime | null }> {
  const pending = pendingOf(run);
  if (pending.transcript) return { transcript: pending.transcript, runs: pending.runs, deletedAt: run.inputDeletedAt };
  const audio = requireAudio(ctx);
  const data = await audio.read(u.id);
  if (!data) throw new VoiceJobError(u.status === "deleted" ? "audio_expired" : "audio_missing");
  let r: Awaited<ReturnType<ReturnType<typeof requireAi>["transcribe"]>>;
  try {
    r = await requireAi(ctx).transcribe(data, { language });
  } catch (e) {
    throw toVoiceJobError(e);
  }
  const t = TranscriptSchema.safeParse(r.value);
  if (!t.success) throw new VoiceJobError("invalid_response", { runs: [r.run] });
  await audio.mark(u.id, "transcribed");
  await ctx.system.table("ai_runs").update(run.id, { output: { pending: { transcript: t.data, runs: [r.run] } }, audioSeconds: r.run.audioSeconds ?? u.durationSec });
  const deletedAt = await deleteAudio(ctx, u, run.id, "Transkribering klar");
  return { transcript: t.data, runs: [r.run], deletedAt };
}

async function finishRun(ctx: Ctx, run: AiRun, runs: AiRunMeta[], patch: Partial<AiRun>): Promise<void> {
  const m = sumRuns(runs.length ? runs : [zeroRun(ctx)]);
  await ctx.system.table("ai_runs").update(run.id, {
    status: "succeeded", provider: m.provider, model: m.model, tokensIn: m.tokensIn, tokensOut: m.tokensOut, costOre: m.costOre, latencyMs: m.latencyMs,
    audioSeconds: m.audioSeconds ?? run.audioSeconds, ...patch,
  });
  await ctx.audit({ action: "ai.run", entity: "ai_run", entityId: run.id, contractId: await contractIdOf(ctx, run.caseId), details: { kind: run.kind, caseId: run.caseId } });
}

async function runFor(ctx: Ctx, aiRunId: string): Promise<AiRun> {
  const run = await ctx.system.table("ai_runs").get(aiRunId);
  if (!run) throw new VoiceJobError("not_found");
  return run;
}

// ---------------------------------------------------------------- Belägg
const NO_EVIDENCE_TEXT = "Framgår inte av samtalet. Fyll i själv.";
const NO_PHASE_TEXT = "Framgår inte av samtalet. Fasen ändras inte.";
const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Förslagen efter kontroll: ett förslag utan värde är "Framgår inte". Ett citat som inte finns i transkriptet (efter
 * normalisering av skiljetecken och versaler) räknas som saknat belägg – påhittade belägg visas aldrig (SPEC §8.4:
 * påhittade uppgifter ska vara noll). Anteckningen är en sammanfattning och undantas från citatkontrollen.
 * Returnerar också fälten vars citat inte hittades (ai_runs.evidence).
 */
export function checkEvidence(s: CheckInSuggestions, t: Transcript): { suggestions: CheckInSuggestions; unverified: string[] } {
  const hay = ` ${norm([t.text, ...t.segments.map((x) => x.text)].join(" "))} `;
  const out = { ...s } as Record<(typeof AI_FIELDS)[number], CheckInSuggestions[(typeof AI_FIELDS)[number]]>;
  const unverified: string[] = [];
  for (const f of AI_FIELDS) {
    const x = s[f];
    const none = { value: null, quote: f === "phase" ? NO_PHASE_TEXT : NO_EVIDENCE_TEXT, t: null, noEvidence: true };
    if (x.noEvidence || x.value === null) {
      out[f] = none;
      continue;
    }
    if (f === "note") continue;
    const parts = x.quote.split(/\.{3}|…/).map(norm).filter((q) => q.length >= 3);
    if (!parts.length || parts.some((q) => !hay.includes(q))) {
      unverified.push(f);
      out[f] = none;
    }
  }
  return { suggestions: out as CheckInSuggestions, unverified };
}

// ---------------------------------------------------------------- transcribe_recording
async function transcribeRecording(ctx: Ctx, p: VoiceJobPayloads["transcribe_recording"]): Promise<string> {
  const run = await runFor(ctx, p.aiRunId);
  if (run.status === "succeeded") return "already_done";
  const u = await ctx.system.table("audio_uploads").get(p.uploadId);
  if (!u || u.purpose !== "checkin" || (run.caseId && u.caseId !== run.caseId)) throw new VoiceJobError("audio_missing");
  const cc = await caseCtx(ctx, u.caseId);
  if (!cc) throw new VoiceJobError("not_found");
  // Samtycket och skyddet kontrolleras igen när jobbet körs – samtycket kan ha återkallats sedan inspelningen.
  const block = recordingBlock({ cfg: cc.config, kind: "coach", person: cc.person, consent: cc.c.aiConsentStatus });
  if (block) throw new VoiceJobError(BLOCK_CODE[block]);
  const tr = await transcribeOnce(ctx, run, u, "sv");
  const spent = [...tr.runs];
  let ex: Awaited<ReturnType<ReturnType<typeof requireAi>["extract"]>>;
  try {
    ex = await requireAi(ctx).extract(tr.transcript, "check_in");
  } catch (e) {
    throw toVoiceJobError(e, spent);
  }
  spent.push(ex.run);
  const v = EXTRACT_SCHEMAS.check_in.safeParse(ex.value);
  if (!v.success) throw new VoiceJobError("invalid_response", { runs: spent });
  const { suggestions, unverified } = checkEvidence(v.data, tr.transcript);
  const output: CheckInAiOutput = { source: p.source, suggestions, transcript: transcriptLines(tr.transcript) };
  await finishRun(ctx, run, spent, { output, evidence: unverified.length ? { unverifiedQuotes: unverified } : null, inputDeletedAt: tr.deletedAt });
  if (p.checkInId) await fillCheckInDraft(ctx, p.checkInId, { ...run, inputDeletedAt: tr.deletedAt }, output);
  return "succeeded";
}

/** Förslagen i avstämningsutkastet – bara ett utkast i samma ärende som inte redan har andra AI-förslag. */
async function fillCheckInDraft(ctx: Ctx, checkInId: string, run: AiRun, out: CheckInAiOutput): Promise<void> {
  const ci: CheckIn | null = await ctx.system.table("check_ins").get(checkInId);
  if (!ci || ci.caseId !== run.caseId || ci.status === "approved" || (ci.aiRunId && ci.aiRunId !== run.id)) return;
  // Förslag utan belägg ("Framgår inte") har value null – samma form som checkinSave (coach/handlers.ts) sparar.
  const ai = { ...out.suggestions, transcript: out.transcript, audioDeletedAt: run.inputDeletedAt, rawTranscriptDeleteBy: addDays(run.createdAt, RAW_TRANSCRIPT_DAYS) } as unknown as CheckInAiDraft;
  await ctx.system.table("check_ins").update(ci.id, { ai, aiRunId: run.id, inputMethod: out.source === "upload" ? "ai_upload" : "ai_recording" });
}

// ---------------------------------------------------------------- transcribe_dictation
async function transcribeDictation(ctx: Ctx, p: VoiceJobPayloads["transcribe_dictation"]): Promise<string> {
  const run = await runFor(ctx, p.aiRunId);
  if (run.status === "succeeded") return "already_done";
  const u = await ctx.system.table("audio_uploads").get(p.uploadId);
  if (!u || u.purpose !== "dictation") throw new VoiceJobError("audio_missing");
  if (u.caseId) {
    const cc = await caseCtx(ctx, u.caseId);
    if (!cc) throw new VoiceJobError("not_found");
    const block = recordingBlock({ cfg: cc.config, kind: "customer", person: cc.person });
    if (block) throw new VoiceJobError(BLOCK_CODE[block]);
  } else {
    const config = (await ctx.system.table("contracts").get(p.contractId))?.config ?? null;
    if (!recordingEnabled(config, "customer")) throw new VoiceJobError("blocked_disabled");
  }
  const tr = await transcribeOnce(ctx, run, u, "sv");
  const output: DictationOutput = { text: tr.transcript.text };
  await finishRun(ctx, run, tr.runs, { output, inputDeletedAt: tr.deletedAt });
  return "succeeded";
}

// ---------------------------------------------------------------- transcribe_participant
async function transcribeParticipant(ctx: Ctx, p: VoiceJobPayloads["transcribe_participant"]): Promise<string> {
  const run = await runFor(ctx, p.aiRunId);
  if (run.status === "succeeded") return "already_done";
  const link = await ctx.system.table("voice_links").get(p.linkId);
  const u = await ctx.system.table("audio_uploads").get(p.uploadId);
  if (!link || !u || u.purpose !== "participant" || u.caseId !== link.caseId) throw new VoiceJobError("audio_missing");
  const cc = await caseCtx(ctx, link.caseId);
  if (!cc) throw new VoiceJobError("not_found");
  const block = recordingBlock({ cfg: cc.config, kind: "participant", person: cc.person });
  if (block) throw new VoiceJobError(BLOCK_CODE[block]);
  if (!aiLanguages(cc.config).includes(p.language)) throw new VoiceJobError("language");
  // Idempotent: finns röstmeddelandet redan för körningen är jobbet klart.
  const existing = await ctx.system.table("participant_voice_notes").first({ aiRunId: run.id });
  if (existing) {
    await finishRun(ctx, run, pendingOf(run).runs, { output: { noteId: existing.id } satisfies ParticipantOutput });
    return "already_done";
  }
  const tr = await transcribeOnce(ctx, run, u, p.language);
  const spent = [...tr.runs];
  const spoken = tr.transcript.language || p.language;
  let textSv = tr.transcript.text;
  let textOriginal: string | null = null;
  if (spoken !== "sv") {
    try {
      const t = await requireAi(ctx).translate(tr.transcript.text, spoken, "sv");
      spent.push(t.run);
      textSv = t.value.text;
    } catch (e) {
      throw toVoiceJobError(e, spent);
    }
    textOriginal = tr.transcript.text;
  }
  const note: ParticipantVoiceNote = {
    id: ctx.newId("pvn"), caseId: link.caseId, linkId: link.id, language: spoken, textSv, textOriginal, consentTextVersion: p.consentTextVersion,
    consentGivenAt: p.consentGivenAt, status: "new", createdAt: ctx.now(), reviewedBy: null, reviewedAt: null, aiRunId: run.id,
  };
  await ctx.system.table("participant_voice_notes").insert(note);
  // Texten finns bara i röstmeddelandet (underlag för coachen) – körningen sparar bara id:t.
  await finishRun(ctx, run, spent, { output: { noteId: note.id } satisfies ParticipantOutput, inputDeletedAt: tr.deletedAt });
  return "succeeded";
}

// ---------------------------------------------------------------- draft_monthly (bara godkända uppgifter)
/** Underlaget för månadens utkast: godkända avstämningar och registrerad närvaro (tillfällen som redan varit). */
export async function monthlyDraftInput(ctx: Ctx, caseId: string, month: MonthKey): Promise<DraftInput> {
  const now = ctx.now();
  const [cis, acts, att] = await Promise.all([
    ctx.system.table("check_ins").list({ caseId, status: "approved" }),
    ctx.system.table("activities").list({ caseId }),
    ctx.system.table("attendance").list({ caseId }),
  ]);
  const monthActs = acts.filter((a) => monthKey(a.startsAt) === month && a.startsAt < now);
  const byActivity = new Map(att.map((x) => [x.activityId, x]));
  const attendance = monthActs.map((a) => byActivity.get(a.id)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ status: x.status }));
  return { caseId, month, checkIns: approvedCheckIns(cis.filter((c) => monthKey(c.heldAt) === month)), attendance };
}

async function draftMonthly(ctx: Ctx, p: VoiceJobPayloads["draft_monthly"]): Promise<string> {
  const run = await runFor(ctx, p.aiRunId);
  if (run.status === "succeeded") return "already_done";
  const cc = await caseCtx(ctx, p.caseId);
  if (!cc) throw new VoiceJobError("not_found");
  // AI bara med samtycke och aldrig för skyddade personuppgifter (samma regel som coachens AI-förslag).
  if (!cc.person || cc.person.protectedIdentity) throw new VoiceJobError("blocked_protected");
  if (!aiAllowed(cc.c, cc.person)) throw new VoiceJobError("blocked_no_consent");
  if (!cc.config || !isOperational(cc.config)) throw new VoiceJobError("not_found");
  const input = await monthlyDraftInput(ctx, cc.c.id, p.month);
  const ai = requireAi(ctx);
  const spent: AiRunMeta[] = [];
  const draft = async (key: DraftTemplateKey): Promise<DraftText> => {
    try {
      const r = await ai.draft(input, key);
      spent.push(r.run);
      return r.value;
    } catch (e) {
      throw toVoiceJobError(e, spent);
    }
  };
  const areas: Record<string, DraftText> = {};
  for (const a of progressionAreas(cc.config)) areas[a.key] = await draft(`monthly_area:${a.key}`);
  const summary = await draft("monthly_summary");
  const plan = await draft("monthly_plan");

  // Utkasten in i månadsbedömningen (om den inte redan är godkänd). Nivå, observation, nästa steg, sammanfattning och
  // samlad status rörs aldrig – coachen väljer själv (CLAUDE.md punkt 5).
  const table = ctx.system.table("monthly_assessments");
  const cur = await table.first({ caseId: cc.c.id, month: p.month });
  let assessmentId: string | null = null;
  if (!cur || cur.status !== "approved") {
    const ma: MonthlyAssessment = cur ?? newAssessment({ id: ctx.newId("ma"), caseId: cc.c.id, month: p.month });
    const next = { ...ma.areas };
    for (const [k, d] of Object.entries(areas)) next[k] = { ...(next[k] ?? blankArea()), aiObservationDraft: { text: d.text, sources: d.sources, noEvidence: d.noEvidence } };
    const aiSummaryDraft = summary.noEvidence ? null : summary.text;
    if (cur) await table.update(cur.id, { areas: next, aiSummaryDraft });
    else await table.insert({ ...ma, areas: next, aiSummaryDraft });
    assessmentId = ma.id;
  }
  const output: MonthlyDraftOutput = { month: p.month, areas, summary, plan, assessmentId };
  await finishRun(ctx, run, spent, { output, evidence: { sourceIds: [...new Set([...Object.values(areas), summary, plan].flatMap((d) => d.sourceIds))] } });
  // Redan godkänd månadsbedömning: utkasten finns bara i körningen.
  return assessmentId ? "succeeded" : "succeeded_approved";
}

// ---------------------------------------------------------------- Gallring
/** Gallringen körs varje timme; ljud raderas när det är 23–24 timmar gammalt, så att inget blir äldre än 24 timmar. */
export const RETENTION_INTERVAL_MINUTES = 60;
/** Råtranskript raderas senast efter så här många dagar (CLAUDE.md punkt 7). */
export const RAW_TRANSCRIPT_DAYS = 30;
/** Kommunens dikterade text (ai_runs.output) finns kvar så här länge – handläggaren har då skickat eller kastat den. */
export const DICTATION_TEXT_HOURS = 24;
/** Så långt bakåt gallringen letar efter körningar (äldre har redan gallrats vid tidigare körningar). */
const RETENTION_LOOKBACK_DAYS = 120;
/** Högst så många ljudfiler per körning (resten tas nästa timme). */
const AUDIO_BATCH = 200;

/** Ljud som inte raderats inom 24 timmar (misslyckad transkribering, avbruten uppladdning) raderas. */
export async function retentionAudio(ctx: Ctx): Promise<string> {
  const now = ctx.now();
  const cutoff = addMinutes(now, -(AUDIO_RETENTION_HOURS * 60 - RETENTION_INTERVAL_MINUTES));
  const rows = await ctx.system.table("audio_uploads").list({ status: { neq: "deleted" }, createdAt: { lte: cutoff } }, { orderBy: "createdAt", limit: AUDIO_BATCH });
  for (const u of rows) {
    const runs = await ctx.system.table("ai_runs").list({ inputRef: u.id });
    const deletedAt = (await deleteAudio(ctx, u, null, "Gallring: ljudet raderas senast efter 24 timmar")) ?? now;
    for (const r of runs) {
      if (r.status === "running") {
        // Transkriberingen blev aldrig klar – körningen avslutas som misslyckad.
        await ctx.system.table("ai_runs").update(r.id, { status: "failed", output: { error: "audio_expired" satisfies VoiceJobErrorCode }, inputDeletedAt: deletedAt });
      } else if (!r.inputDeletedAt) {
        await ctx.system.table("ai_runs").update(r.id, { inputDeletedAt: deletedAt });
      }
    }
  }
  return `removed:${rows.length}`;
}

const TRANSCRIPT_RUN_KINDS: AiRunKind[] = ["transcribe_extract", "extract_teams", "extract_notes"];

/**
 * Råtranskript raderas när avstämningen godkänts, senast efter 30 dagar – i avstämningen (ai.transcript) och i körningen
 * (ai_runs.output.transcript). Kommunens dikterade text raderas efter 24 timmar. Förslagen och beläggen (citaten) finns
 * kvar tills avstämningen godkänts; det godkända är det som sparas.
 */
export async function retentionTranscripts(ctx: Ctx): Promise<string> {
  const now = ctx.now();
  let checkIns = 0;
  let runs = 0;
  // 1. Avstämningarna: godkända, eller där sista dagen passerats.
  const withAi = await ctx.system.table("check_ins").list({ aiRunId: { isNull: false } });
  const approvedRuns = new Set(withAi.filter((c) => c.status === "approved").map((c) => c.aiRunId));
  for (const ci of withAi) {
    const ai = ci.ai;
    if (!ai || !ai.transcript?.length) continue;
    const due = ci.status === "approved" || (ai.rawTranscriptDeleteBy != null && ai.rawTranscriptDeleteBy <= now);
    if (!due) continue;
    await ctx.system.table("check_ins").update(ci.id, { ai: { ...ai, transcript: [], rawTranscriptDeletedAt: now } });
    await ctx.audit({ action: "transcript.deleted", entity: "check_in", entityId: ci.id, contractId: await contractIdOf(ctx, ci.caseId), details: { reason: ci.status === "approved" ? "Avstämningen godkänd" : "Gallring efter 30 dagar" } });
    checkIns++;
  }
  // 2. Körningarna: transkript äldre än 30 dagar, eller vars avstämning är godkänd. Råtranskript som sparats för nya försök.
  const from = addDays(now, -RETENTION_LOOKBACK_DAYS);
  const cands = await ctx.system.table("ai_runs").list({ createdAt: { gte: from } });
  for (const r of cands) {
    const out = (r.output ?? null) as Record<string, unknown> | null;
    if (!out) continue;
    const age30 = r.createdAt <= addDays(now, -RAW_TRANSCRIPT_DAYS);
    const age24h = r.createdAt <= addMinutes(now, -DICTATION_TEXT_HOURS * 60);
    let patch: Record<string, unknown> | null = null;
    if (TRANSCRIPT_RUN_KINDS.includes(r.kind) && Array.isArray(out.transcript) && out.transcript.length && (age30 || approvedRuns.has(r.id))) {
      patch = { ...out, transcript: [] };
    }
    if (out.pending && (r.status !== "running" || age24h)) patch = { ...(patch ?? out), pending: undefined };
    if (r.kind === "transcribe_dictation" && typeof out.text === "string" && age24h) patch = { text: null, clearedAt: now } satisfies DictationOutput;
    if (!patch) continue;
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    await ctx.system.table("ai_runs").update(r.id, { output: clean });
    runs++;
  }
  if (checkIns || runs) {
    await ctx.audit({ action: "retention.transcripts", entity: "ai_run", entityId: null, details: { checkIns, runs } });
  }
  return `cleared:${checkIns + runs}`;
}

// ---------------------------------------------------------------- Frågor för skärmarna
/** Läget för en AI-körning som skärmen väntar på (ingen text – den hämtas av respektive fråga med rätt behörighet). */
export type VoiceRunState = { aiRunId: string; status: AiRunStatus; error: { code: VoiceJobErrorCode; text: string } | null; audioDeletedAt: LocalDateTime | null };
export const voiceRunState = (run: AiRun): VoiceRunState => ({ aiRunId: run.id, status: run.status, error: aiRunError(run), audioDeletedAt: run.inputDeletedAt });

/**
 * Kommunens dikterade text – bara för den som talade in (ljudfilens ägare). ctx.system: kommunen läser inte ai_runs
 * (policy.ts), men den egna dikteringen ska tillbaka i textfältet. Null om körningen inte finns eller inte är den egna.
 */
export async function ownDictation(ctx: Ctx, aiRunId: string): Promise<(VoiceRunState & { text: string | null }) | null> {
  const run = await ctx.system.table("ai_runs").get(aiRunId);
  if (!run || run.kind !== "transcribe_dictation" || !run.inputRef) return null;
  const u = await ctx.system.table("audio_uploads").get(run.inputRef);
  if (!u || u.ownerId !== ctx.actor.userId || ctx.actor.role === "deltagare") return null;
  const text = run.status === "succeeded" ? ((run.output as DictationOutput | null)?.text ?? null) : null;
  return { ...voiceRunState(run), text };
}
