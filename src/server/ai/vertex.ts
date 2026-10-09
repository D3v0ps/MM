// AI-adaptern för Gemini via Google Cloud Vertex AI, EU multi-region-endpoint (SPEC §8.4, beslut 2026-09-30).
//   https://aiplatform.eu.rep.googleapis.com/v1/projects/{projekt}/locations/eu/publishers/google/models/{modell}:generateContent
// Endast den adressen (config.ts stoppar allt annat) – aldrig AI Studio-nyckel, aldrig global endpoint.
//
// Porten ctx.ai (src/features/_shared/ai-port.ts):
//   transcribe  ljudet inline (base64, högst 20 MB i anropet) + instruktion att transkribera ordagrant med tidpunkter
//   extract     transkriptet + veckoavstämningens schema + SPEC §8.3:s instruktioner -> förslag med belägg
//   draft       bara godkända avstämningar och närvaro -> utkast med källor (inget anrop alls när underlag saknas)
//   translate   deltagarens röstmeddelande -> svenska
// Alla svar är JSON enligt ett svarsschema och valideras sedan mot appens zod-scheman. Ogiltiga svar försöks en gång till;
// blir även det ogiltigt kastas AiProviderError("invalid_response") – svaret sparas aldrig och visas aldrig.
// Lägsta rimliga resonemangsnivå (uppgiften är extraktion, inte problemlösning). Varje anrop ger mätvärden till ai_runs:
// leverantör, modell, tid, token och kostnad (öre, prislistan i MM_AI_PRICES).
// Inga personuppgifter i loggar eller fel: bara HTTP-status och fältnamn.
import "server-only";
import {
  assertApprovedInput, DraftTextSchema, EXTRACT_SCHEMAS, TranscriptSchema, TranslationSchema,
  type AiPort, type AiResult, type AiRunMeta, type AudioInput, type DraftInput, type DraftTemplateKey, type DraftText, type ExtractSchemaKey,
  type ExtractSchemas, type Transcript, type Translation,
} from "@/features/_shared/ai-port";
import { ACTIVITY_TYPES, OBSTACLES } from "@/data/seed/constants";
import { fmtDateShort } from "@/core/time";
import { costOre, vertexEndpoint, type AiPrices, type ThinkingLevel, type TokenUsage, type VertexSettings } from "./config";
import { AiProviderError } from "./errors";
import { createTokenSource, type FetchLike, type ServiceAccountKey, type TokenSource } from "./google-auth";
import {
  CHECK_IN_RESPONSE_SCHEMA, checkInExtractInstructions, DRAFT_RESPONSE_SCHEMA, draftInputForPrompt, draftInstructions, EMPLOYER_CONTACT_TYPES,
  TRANSCRIPT_RESPONSE_SCHEMA, transcribeInstructions, transcriptForPrompt, TRANSLATION_RESPONSE_SCHEMA, translateInstructions, type ResponseSchema,
} from "./prompts";

/** Leverantörens namn i ai_runs (samma som avtalskonfigurationens ai.provider). */
export const VERTEX_PROVIDER = "vertex_eu";
/** Största ljud i ett anrop: anropet (base64, ca 4/3 av filen) får vara högst 20 MB. */
export const INLINE_REQUEST_MAX_BYTES = 20 * 1024 * 1024;
export const INLINE_AUDIO_MAX_BYTES = Math.floor((INLINE_REQUEST_MAX_BYTES * 3) / 4) - 64 * 1024;
/** Ljud räknas som 32 token per sekund (SPEC §8.6) när leverantören inte anger längden. */
const AUDIO_TOKENS_PER_SECOND = 32;
/** Tidsgränser per anrop. Transkribering av en timme ljud tar tid. */
const TIMEOUT_TRANSCRIBE_MS = 280_000;
const TIMEOUT_TEXT_MS = 90_000;
const MAX_OUTPUT_TRANSCRIBE = 65_536;
const MAX_OUTPUT_TEXT = 8_192;

/** Filtyper som Vertex AI tar emot för ljud (grundtypen från ctx.audio -> Vertex AI:s namn). */
const VERTEX_AUDIO_MIME: Readonly<Record<string, string>> = {
  "audio/webm": "audio/webm",
  "audio/ogg": "audio/ogg",
  "audio/mp4": "audio/mp4",
  "audio/x-m4a": "audio/m4a",
  "audio/m4a": "audio/m4a",
  "audio/aac": "audio/aac",
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mp3",
  "audio/wav": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
};

// ---------------------------------------------------------------- Resonemangsnivå
/**
 * Modeller som tar thinkingLevel MINIMAL enligt Googles tabell (docs.cloud.google.com/vertex-ai/generative-ai/docs/thinking):
 * Gemini 3 Flash, 3.5 Flash och 3.6 Flash. Gemini 3.7 Flash och 3.8 Flash tar bara LOW, MEDIUM och HIGH, och Pro-modellerna
 * har aldrig MINIMAL. Ett värde modellen inte tar ger HTTP 400 (INVALID_ARGUMENT) – skarp drift 2026-10-09 med gemini-3.8-flash.
 * Okända modeller får därför LOW, som alla Gemini 3-modeller tar.
 */
const MINIMAL_SUPPORTED = /^gemini-3(\.5|\.6)?-flash/;

/**
 * generationConfig för modellen: Gemini 2.5 styrs med thinkingBudget (0 = av för Flash), nyare modeller med thinkingLevel.
 * Äldre modeller utan resonemang får inget. Temperatur 0 bara för 2.x – Google avråder från att sänka den för Gemini 3.
 */
export function thinkingFor(model: string, level: ThinkingLevel): Record<string, unknown> {
  const m = model.toLowerCase();
  if (/^gemini-(1\.|2\.0)/.test(m)) return { temperature: 0 };
  if (/^gemini-2\.5/.test(m)) {
    const flash = m.includes("flash");
    const budget = level === "high" ? 8192 : level === "medium" ? 1024 : flash ? 0 : 128;
    return { temperature: 0, thinkingConfig: { thinkingBudget: budget } };
  }
  const lvl = level === "minimal" && !MINIMAL_SUPPORTED.test(m) ? "low" : level;
  return { thinkingConfig: { thinkingLevel: lvl.toUpperCase() } };
}

// ---------------------------------------------------------------- Leverantörens felorsak
/** Längsta felorsak som sparas (jobs.last_error, ai_runs.output.detail). */
export const PROVIDER_DETAIL_MAX = 300;
/**
 * Googles felorsak ur svarskroppen vid 4xx/5xx ({ error: { message, status } }), så att orsaken till t.ex. ett 400 syns i
 * jobbets last_error och ai_runs.output i stället för bara koden. Googles meddelanden beskriver anropet (fält, modell,
 * värden) – inga personuppgifter – men allt som ser ut som base64-data (ljudet) tas bort, och texten kortas till 300 tecken.
 */
export function providerErrorDetail(status: number, body: unknown): string {
  const head = `Vertex AI gav HTTP ${status}`;
  const err = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
  const e = err && typeof err === "object" ? (err as { message?: unknown; status?: unknown }) : null;
  const message = e && typeof e.message === "string" ? e.message : "";
  const st = e && typeof e.status === "string" ? e.status : "";
  const text = scrubProviderText([st, message].filter(Boolean).join(": "));
  return text ? `${head}: ${text}`.slice(0, PROVIDER_DETAIL_MAX) : head;
}
/** Tar bort base64-liknande block (≥ 40 tecken) och radbrytningar; kortar till PROVIDER_DETAIL_MAX. */
export function scrubProviderText(text: string): string {
  return text
    .replace(/[A-Za-z0-9+/=]{40,}/g, "[data]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PROVIDER_DETAIL_MAX);
}

// ---------------------------------------------------------------- Svaret från generateContent
type Part = { text?: string; thought?: boolean; inlineData?: { mimeType: string; data: string } };
type ModalityCount = { modality?: string; tokenCount?: number };
type GenerateResponse = {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  modelVersion?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    promptTokensDetails?: ModalityCount[];
  };
};
const BLOCKED_FINISH = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "LANGUAGE"]);

/** Token ur svaret: ljud in, text in och ut (svar + resonemang). */
export function usageOf(r: GenerateResponse): TokenUsage & { total: { in: number | null; out: number | null } } {
  const u = r.usageMetadata ?? {};
  const audioIn = (u.promptTokensDetails ?? []).filter((d) => d.modality === "AUDIO").reduce((a, d) => a + (d.tokenCount ?? 0), 0);
  const promptIn = u.promptTokenCount ?? 0;
  const out = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  return {
    audioIn,
    textIn: Math.max(0, promptIn - audioIn),
    output: out,
    total: { in: u.promptTokenCount ?? null, out: u.candidatesTokenCount != null || u.thoughtsTokenCount != null ? out : null },
  };
}

// ---------------------------------------------------------------- Adaptern
export type VertexAiOptions = {
  settings: VertexSettings;
  key: ServiceAccountKey;
  fetch: FetchLike;
  /** Klockan för tidtagning och token (tester). */
  nowMs?: () => number;
  tokenSource?: TokenSource;
  /** Paus före nytt försök efter 429/5xx (tester: 0). */
  retryDelayMs?: number;
};

type Call = {
  system: string;
  parts: Part[];
  schema: ResponseSchema;
  maxOutputTokens: number;
  level: ThinkingLevel;
  timeoutMs: number;
  /** Ljudets längd om den är känd (ai_runs.audio_seconds). */
  audioSeconds: number | null;
};

export function createVertexAi(o: VertexAiOptions): AiPort {
  const { settings } = o;
  const url = vertexEndpoint(settings.project, settings.model);
  const nowMs = o.nowMs ?? (() => Date.now());
  const tokens = o.tokenSource ?? createTokenSource({ key: o.key, fetch: o.fetch, nowMs });
  const prices: AiPrices | null = settings.prices;
  const retryDelay = o.retryDelayMs ?? 1500;
  const level = (dflt: ThinkingLevel): ThinkingLevel => settings.thinking ?? dflt;

  /** Mätvärden. model = modellens version från svaret (t.ex. "gemini-…-001") när den anges, annars MM_AI_MODEL. */
  const meta = (latencyMs: number, u: ReturnType<typeof usageOf> | null, audioSeconds: number | null, version?: string | null): AiRunMeta => ({
    provider: VERTEX_PROVIDER,
    model: version && /^[\w.@-]{1,100}$/.test(version) ? version : settings.model,
    latencyMs,
    tokensIn: u ? u.total.in : null,
    tokensOut: u ? u.total.out : null,
    audioSeconds: audioSeconds ?? (u && u.audioIn ? Math.round(u.audioIn / AUDIO_TOKENS_PER_SECOND) : null),
    costOre: u ? costOre(u, prices) : 0,
  });

  /** Ett anrop till generateContent. Försöker en gång till vid 401 (ny token), 429, 5xx och nätverksfel. */
  async function generate(c: Call): Promise<{ json: unknown; run: AiRunMeta }> {
    const body = JSON.stringify({
      contents: [{ role: "user", parts: c.parts }],
      systemInstruction: { parts: [{ text: c.system }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: c.schema,
        candidateCount: 1,
        maxOutputTokens: c.maxOutputTokens,
        ...thinkingFor(settings.model, c.level),
      },
    });
    const started = nowMs();
    let lastStatus = 0;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const token = await tokens.token();
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await o.fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
          body,
          signal: AbortSignal.timeout(c.timeoutMs),
        });
      } catch {
        lastStatus = 0;
        if (attempt < 2) {
          await pause(retryDelay);
          continue;
        }
        throw new AiProviderError("unavailable", { detail: "Vertex AI svarade inte (nätverk eller tidsgräns)", run: meta(nowMs() - started, null, c.audioSeconds) });
      }
      lastStatus = res.status;
      if (res.status === 401 && attempt < 2) {
        tokens.invalidate();
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await pause(retryDelay);
        continue;
      }
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        // 400: t.ex. fel format på ljudet, för stort anrop eller ett generationConfig-värde modellen inte tar.
        // 403/404: fel projekt, modell eller behörighet. Googles felorsak följer med i detail (aldrig i texten till användaren).
        const code = retryable ? "unavailable" : res.status === 400 ? "unsupported" : "config";
        const errBody = await res.json().catch(() => null);
        throw new AiProviderError(code, { retryable, detail: providerErrorDetail(res.status, errBody), run: meta(nowMs() - started, null, c.audioSeconds) });
      }
      const data = (await res.json().catch(() => null)) as GenerateResponse | null;
      const run = meta(nowMs() - started, data ? usageOf(data) : null, c.audioSeconds, data?.modelVersion);
      if (!data) throw new AiProviderError("invalid_response", { detail: "Svaret var inte JSON", run });
      if (data.promptFeedback?.blockReason) throw new AiProviderError("blocked", { detail: `Stoppat (${data.promptFeedback.blockReason})`, run });
      const cand = data.candidates?.[0];
      const finish = cand?.finishReason ?? "";
      if (BLOCKED_FINISH.has(finish)) throw new AiProviderError("blocked", { detail: `Stoppat (${finish})`, run });
      if (finish === "MAX_TOKENS") throw new AiProviderError("invalid_response", { detail: "Svaret blev för långt och avbröts", run });
      const text = (cand?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
      try {
        return { json: JSON.parse(text), run };
      } catch {
        throw new AiProviderError("invalid_response", { detail: "Svaret var inte JSON enligt schemat", run });
      }
    }
    throw new AiProviderError("unavailable", { detail: `Vertex AI gav HTTP ${lastStatus}` });
  }

  /**
   * Anrop + validering. Ogiltigt svar (fel form, fel värden) försöks en gång till; mätvärdena för båda anropen summeras.
   * validate kastar AiProviderError("invalid_response") med fältnamnen (aldrig värdena).
   */
  async function call<T>(c: Call, validate: (json: unknown) => T): Promise<AiResult<T>> {
    const spent: AiRunMeta[] = [];
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await generate(c);
        spent.push(r.run);
        return { value: validate(r.json), run: sum(spent) };
      } catch (e) {
        if (e instanceof AiProviderError && e.run && !spent.includes(e.run)) spent.push(e.run);
        if (e instanceof AiProviderError && e.code === "invalid_response" && attempt < 2) continue;
        if (e instanceof AiProviderError) throw new AiProviderError(e.code, { retryable: e.retryable, detail: e.detail, run: spent.length ? sum(spent) : e.run });
        throw e;
      }
    }
  }

  return {
    provider: VERTEX_PROVIDER,
    model: settings.model,

    async transcribe(audio: AudioInput, opts: { language: string }): Promise<AiResult<Transcript>> {
      const bytes = audio.bytes;
      if (!bytes || !bytes.byteLength) throw new AiProviderError("unsupported", { detail: "Ljudet saknar innehåll" });
      if (bytes.byteLength > INLINE_AUDIO_MAX_BYTES) throw new AiProviderError("too_large", { detail: `Ljudet är ${Math.round(bytes.byteLength / 1048576)} MB` });
      const mime = VERTEX_AUDIO_MIME[audio.mimeType];
      if (!mime) throw new AiProviderError("unsupported", { detail: `Filtypen ${audio.mimeType} stöds inte` });
      const language = /^[a-z]{2}$/.test(opts.language) ? opts.language : "sv";
      return call(
        {
          system: transcribeInstructions(audio.purpose, language),
          parts: [{ inlineData: { mimeType: mime, data: Buffer.from(bytes).toString("base64") } }, { text: "Transkribera ljudet." }],
          schema: TRANSCRIPT_RESPONSE_SCHEMA,
          maxOutputTokens: MAX_OUTPUT_TRANSCRIBE,
          level: level("minimal"),
          timeoutMs: TIMEOUT_TRANSCRIBE_MS,
          audioSeconds: audio.durationSec,
        },
        validateTranscript,
      );
    },

    async extract<K extends ExtractSchemaKey>(transcript: Transcript, schemaKey: K, instructions?: string): Promise<AiResult<ExtractSchemas[K]>> {
      if (schemaKey !== "check_in") throw new AiProviderError("config", { detail: "Okänt formulär för extract" });
      return call(
        {
          system: checkInExtractInstructions(instructions),
          parts: [{ text: `Transkript (tid i sekunder inom hakparentes):\n${transcriptForPrompt(transcript)}` }],
          schema: CHECK_IN_RESPONSE_SCHEMA,
          maxOutputTokens: MAX_OUTPUT_TEXT,
          level: level("low"),
          timeoutMs: TIMEOUT_TEXT_MS,
          audioSeconds: null,
        },
        (json) => validateCheckIn(json) as ExtractSchemas[K],
      );
    },

    async draft(input: DraftInput, templateKey: DraftTemplateKey): Promise<AiResult<DraftText>> {
      assertApprovedInput(input);
      // Inget underlag: inget anrop (ingen kostnad och inget att hitta på).
      if (!input.checkIns.length && !input.attendance.length) return { value: { ...NOT_FOUND }, run: meta(0, null, null) };
      return call(
        {
          system: draftInstructions(templateKey),
          parts: [{ text: `Underlag (JSON):\n${draftInputForPrompt(input)}` }],
          schema: DRAFT_RESPONSE_SCHEMA,
          maxOutputTokens: MAX_OUTPUT_TEXT,
          level: level("low"),
          timeoutMs: TIMEOUT_TEXT_MS,
          audioSeconds: null,
        },
        (json) => validateDraft(json, input),
      );
    },

    async translate(text: string, from: string, to: string): Promise<AiResult<Translation>> {
      const src = text.trim();
      if (from === to || !src) return { value: { text: src, from, to }, run: meta(0, null, null) };
      return call(
        {
          system: translateInstructions(from, to),
          parts: [{ text: src }],
          schema: TRANSLATION_RESPONSE_SCHEMA,
          maxOutputTokens: MAX_OUTPUT_TEXT,
          level: level("low"),
          timeoutMs: TIMEOUT_TEXT_MS,
          audioSeconds: null,
        },
        (json) => {
          const t = (json as { text?: unknown } | null)?.text;
          const v = TranslationSchema.safeParse({ text: typeof t === "string" ? t.trim() : t, from, to });
          if (!v.success || !v.data.text) throw invalid(v.success ? ["text"] : v.error.issues);
          return v.data;
        },
      );
    },
  };
}

// ---------------------------------------------------------------- Validering (zod – samma scheman som i appen)
const pause = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

function sum(runs: AiRunMeta[]): AiRunMeta {
  const nul = (xs: (number | null)[]) => (xs.every((x) => x == null) ? null : xs.reduce<number>((a, b) => a + (b ?? 0), 0));
  return {
    provider: runs[0].provider,
    model: runs[0].model,
    latencyMs: runs.reduce((a, r) => a + r.latencyMs, 0),
    tokensIn: nul(runs.map((r) => r.tokensIn)),
    tokensOut: nul(runs.map((r) => r.tokensOut)),
    audioSeconds: runs.find((r) => r.audioSeconds != null)?.audioSeconds ?? null,
    costOre: runs.reduce((a, r) => a + r.costOre, 0),
  };
}

/** Fältnamnen (aldrig värdena) i ett valideringsfel. */
function invalid(issues: readonly { path: PropertyKey[] }[] | string[]): AiProviderError {
  const paths = issues.map((i) => (typeof i === "string" ? i : i.path.map(String).join(".") || "(svaret)"));
  return new AiProviderError("invalid_response", { detail: `Ogiltiga fält: ${[...new Set(paths)].slice(0, 8).join(", ")}` });
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Modellens transkript -> Transcript. Tiderna rundas och sorteras; ett segment som slutar före starten får slut = start. */
export function validateTranscript(json: unknown): Transcript {
  const j = (json ?? {}) as { language?: unknown; segments?: unknown };
  if (!Array.isArray(j.segments)) throw invalid(["segments"]);
  const segments = (j.segments as Record<string, unknown>[])
    .map((s) => {
      const start = typeof s?.start === "number" && Number.isFinite(s.start) ? round1(Math.max(0, s.start)) : NaN;
      const end = typeof s?.end === "number" && Number.isFinite(s.end) ? round1(Math.max(0, s.end)) : NaN;
      return { start, end: Math.max(start, end), text: typeof s?.text === "string" ? s.text.trim() : s?.text, speaker: s?.speaker ?? null };
    })
    .filter((s) => typeof s.text !== "string" || s.text.length > 0)
    .sort((a, b) => a.start - b.start);
  const language = typeof j.language === "string" ? j.language.trim().toLowerCase() : j.language;
  const text = segments.map((s) => s.text).join(" ");
  const v = TranscriptSchema.safeParse({ text, segments, language });
  if (!v.success) throw invalid(v.error.issues);
  return v.data;
}

const ALLOWED_ACTIVITIES = new Set<string>(ACTIVITY_TYPES);
const ALLOWED_OBSTACLES = new Set<string>(OBSTACLES);
const ALLOWED_EC_TYPES = new Set<string>(EMPLOYER_CONTACT_TYPES);

/** Förslagen till veckoavstämningen: CheckInExtractSchema (strikt – t.ex. samlad status underkänns) + formulärets listor. */
export function validateCheckIn(json: unknown): ExtractSchemas["check_in"] {
  const v = EXTRACT_SCHEMAS.check_in.safeParse(json);
  if (!v.success) throw invalid(v.error.issues);
  const s = v.data;
  const bad: string[] = [];
  if (s.activitiesDone.value?.some((x) => !ALLOWED_ACTIVITIES.has(x))) bad.push("activitiesDone.value");
  if (s.obstacles.value?.some((x) => !ALLOWED_OBSTACLES.has(x))) bad.push("obstacles.value");
  if (s.employerContacts.value?.types.some((x) => !ALLOWED_EC_TYPES.has(x))) bad.push("employerContacts.value");
  if (bad.length) throw invalid(bad);
  return s;
}

const NOT_FOUND: DraftText = { text: "Framgår inte av månadens godkända avstämningar.", sources: [], sourceIds: [], noEvidence: true };

/**
 * Utkastet: bara id för avstämningar som finns i underlaget (annars ogiltigt – påhittade källor visas aldrig). Källornas
 * namn ("Avstämning 15 jan", "Närvaroregistrering") sätts här, inte av modellen. Utan belägg: standardtexten "Framgår inte".
 */
export function validateDraft(json: unknown, input: DraftInput): DraftText {
  const j = (json ?? {}) as { text?: unknown; sourceIds?: unknown; usedAttendance?: unknown; noEvidence?: unknown };
  const bad: string[] = [];
  if (typeof j.text !== "string") bad.push("text");
  if (!Array.isArray(j.sourceIds) || j.sourceIds.some((x) => typeof x !== "string")) bad.push("sourceIds");
  if (typeof j.usedAttendance !== "boolean") bad.push("usedAttendance");
  if (typeof j.noEvidence !== "boolean") bad.push("noEvidence");
  if (bad.length) throw invalid(bad);
  if (j.noEvidence) return { ...NOT_FOUND };
  const byId = new Map(input.checkIns.map((c) => [c.id, c]));
  const ids = [...new Set(j.sourceIds as string[])];
  if (ids.some((id) => !byId.has(id))) throw invalid(["sourceIds"]);
  if (j.usedAttendance && !input.attendance.length) throw invalid(["usedAttendance"]);
  const text = (j.text as string).trim();
  if (!text) throw invalid(["text"]);
  // Källorna i tidsordning, som i den simulerade leverantören.
  const used = input.checkIns.filter((c) => ids.includes(c.id));
  const out = DraftTextSchema.safeParse({
    text,
    sources: [...(j.usedAttendance ? ["Närvaroregistrering"] : []), ...used.map((c) => `Avstämning ${fmtDateShort(c.heldAt)}`)],
    sourceIds: used.map((c) => c.id),
    noEvidence: false,
  });
  if (!out.success) throw invalid(out.error.issues);
  return out.data;
}
