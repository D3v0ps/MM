// Vertex AI-adaptern med fejkad fetch – inga riktiga anrop. Kontrollerar att bara EU-endpointen används, anropets form
// (ljud inline, svarsschema, lägsta resonemangsnivå), valideringen mot appens zod-scheman (ogiltiga svar används aldrig),
// nya försök, mätvärden och kostnad i öre, samt valet av leverantör per miljö.
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { DraftInput, Transcript } from "@/features/_shared/ai-port";
import { SIMULATED_PROVIDER } from "@/features/_shared/ai-sim";
import { aiProviderChoice, assertVertexEuEndpoint, costOre, parseAiPrices, vertexEndpoint, vertexSettings } from "./config";
import { AiProviderError } from "./errors";
import { GOOGLE_TOKEN_URL, type FetchLike } from "./google-auth";

vi.mock("server-only", () => ({}));
const { INLINE_AUDIO_MAX_BYTES, providerErrorDetail, thinkingFor, VERTEX_PROVIDER } = await import("./vertex");
const { buildServerAi } = await import("./index");

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_JSON = {
  type: "service_account", project_id: "miljonmatch-test", private_key_id: "k1", client_email: "ai@miljonmatch-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const ENV = {
  MM_AI_PROVIDER: "vertex",
  MM_AI_MODEL: "gemini-2.5-flash",
  GOOGLE_VERTEX_PROJECT: "miljonmatch-test",
  GOOGLE_SERVICE_ACCOUNT_KEY: Buffer.from(JSON.stringify(KEY_JSON)).toString("base64"),
  MM_AI_PRICES: JSON.stringify({ audioIn: 1100, textIn: 330, output: 2750 }),
};
const URL_EU = "https://aiplatform.eu.rep.googleapis.com/v1/projects/miljonmatch-test/locations/eu/publishers/google/models/gemini-2.5-flash:generateContent";

type Reply = { status?: number; body?: unknown; throws?: boolean };
/** Fejkad fetch: token från Google och svaren från Vertex AI i tur och ordning. */
function fakeFetch(replies: Reply[]) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  let tokens = 0;
  const fetch: FetchLike = async (url, init) => {
    if (url === GOOGLE_TOKEN_URL) return { ok: true, status: 200, json: async () => ({ access_token: `tok-${++tokens}`, expires_in: 3600 }) };
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const r = replies.shift() ?? { status: 500 };
    if (r.throws) throw new Error("ECONNRESET");
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body };
  };
  return { fetch, calls, tokens: () => tokens };
}
function vertex(env: Record<string, string> = ENV, replies: Reply[] = []) {
  const f = fakeFetch(replies);
  const out = buildServerAi({ env, environment: "staging", fetch: f.fetch, retryDelayMs: 0 });
  return { ai: out.ai!, ...f };
}
const reply = (json: unknown, usage: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Reply => ({
  body: { candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] }, finishReason: "STOP", ...extra }], usageMetadata: usage },
});
/** Felets tekniska detalj (meddelandet är en fast text). */
const detail = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof AiProviderError ? `${e.code}: ${e.detail ?? ""}` : String(e);
  }
  return "inget fel";
};
const audio = (bytes = new Uint8Array([1, 2, 3, 4]), mimeType = "audio/webm") => ({ uploadId: "aud-1", purpose: "checkin" as const, mimeType, durationSec: 1500, caseId: "case-1", bytes });

describe("endast Vertex AI:s EU-endpoint", () => {
  it("adressen byggs för location eu – AI Studio, global och regionala endpoints stoppas", () => {
    expect(vertexEndpoint("miljonmatch-test", "gemini-2.5-flash")).toBe(URL_EU);
    expect(() => assertVertexEuEndpoint(URL_EU)).not.toThrow();
    for (const bad of [
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      "https://aiplatform.googleapis.com/v1/projects/p1234/locations/global/publishers/google/models/gemini-2.5-flash:generateContent",
      "https://us-central1-aiplatform.googleapis.com/v1/projects/p1234/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent",
      "https://europe-north1-aiplatform.googleapis.com/v1/projects/p1234/locations/europe-north1/publishers/google/models/gemini-2.5-flash:generateContent",
      "https://aiplatform.eu.rep.googleapis.com/v1/projects/p1234/locations/global/publishers/google/models/gemini-2.5-flash:generateContent",
      "http://aiplatform.eu.rep.googleapis.com/v1/projects/p1234/locations/eu/publishers/google/models/gemini-2.5-flash:generateContent",
      `${URL_EU}?key=AIza-något`,
      "https://aiplatform.eu.rep.googleapis.com.evil.example/v1/projects/p1234/locations/eu/publishers/google/models/m:generateContent",
    ]) {
      expect(() => assertVertexEuEndpoint(bad), bad).toThrow(AiProviderError);
    }
    expect(() => vertexEndpoint("miljonmatch-test", "gemini-2.5-flash/../../x")).toThrow(AiProviderError);
  });

  it("inställningarna: location får bara vara eu; modell, projekt och nyckel krävs; prislistan kontrolleras", () => {
    expect(vertexSettings(ENV)).toMatchObject({ project: "miljonmatch-test", model: "gemini-2.5-flash", prices: { audioIn: 1100, textIn: 330, output: 2750 }, thinking: null });
    expect(detail(() => vertexSettings({ ...ENV, GOOGLE_VERTEX_LOCATION: "us-central1" }))).toBe('config: GOOGLE_VERTEX_LOCATION får bara vara "eu"');
    expect(() => vertexSettings({ ...ENV, GOOGLE_VERTEX_LOCATION: "global" })).toThrow(AiProviderError);
    expect(vertexSettings({ ...ENV, GOOGLE_VERTEX_LOCATION: "eu" }).project).toBe("miljonmatch-test");
    expect(detail(() => vertexSettings({ ...ENV, MM_AI_MODEL: "" }))).toMatch(/MM_AI_MODEL saknas/);
    expect(detail(() => vertexSettings({ ...ENV, MM_AI_PRICES: "{\"audioIn\": -1}" }))).toMatch(/MM_AI_PRICES/);
    expect(detail(() => vertexSettings({ ...ENV, MM_AI_THINKING: "max" }))).toMatch(/MM_AI_THINKING/);
    // Projektet kan tas ur nyckeln
    expect(vertexSettings({ ...ENV, GOOGLE_VERTEX_PROJECT: "" }, "miljonmatch-test").project).toBe("miljonmatch-test");
    expect(parseAiPrices(undefined)).toBeNull();
  });

  it("leverantör per miljö: simulerad i testmiljön som standard, aldrig simulerad i produktion", () => {
    expect(aiProviderChoice({}, "staging")).toBe("simulated");
    expect(aiProviderChoice({}, "production")).toBe("off");
    expect(aiProviderChoice({ MM_AI_PROVIDER: "simulated" }, "production")).toBe("off");
    expect(aiProviderChoice({ MM_AI_PROVIDER: "vertex" }, "production")).toBe("vertex");
    expect(aiProviderChoice({ MM_AI_PROVIDER: "off" }, "staging")).toBe("off");
    expect(() => aiProviderChoice({ MM_AI_PROVIDER: "ai-studio" }, "staging")).toThrow(AiProviderError);
    expect(buildServerAi({ env: {}, environment: "staging" }).ai?.provider).toBe(SIMULATED_PROVIDER);
    expect(buildServerAi({ env: {}, environment: "production" }).ai).toBeUndefined();
    expect(detail(() => buildServerAi({ env: { MM_AI_PROVIDER: "vertex" }, environment: "production" }))).toBe("config: GOOGLE_SERVICE_ACCOUNT_KEY saknas");
    expect(buildServerAi({ env: ENV, environment: "production" }).ai).toMatchObject({ provider: VERTEX_PROVIDER, model: "gemini-2.5-flash" });
  });

  it("kostnad i hela öre (uppåt) från prislistan; utan prislista 0", () => {
    const p = { audioIn: 1100, textIn: 330, output: 2750 };
    // 30 minuter ljud (57 600 token) + 500 texttoken + 10 000 utdatatoken = 63,36 + 0,165 + 27,5 = 91,025 öre -> 92
    expect(costOre({ audioIn: 57_600, textIn: 500, output: 10_000 }, p)).toBe(92);
    expect(costOre({ audioIn: 0, textIn: 10, output: 1 }, p)).toBe(1);
    expect(costOre({ audioIn: 0, textIn: 0, output: 0 }, p)).toBe(0);
    expect(costOre({ audioIn: 57_600, textIn: 0, output: 0 }, null)).toBe(0);
  });

  it("lägsta rimliga resonemangsnivå per modell", () => {
    expect(thinkingFor("gemini-2.5-flash", "minimal")).toEqual({ temperature: 0, thinkingConfig: { thinkingBudget: 0 } });
    expect(thinkingFor("gemini-2.5-flash-lite", "low")).toEqual({ temperature: 0, thinkingConfig: { thinkingBudget: 0 } });
    expect(thinkingFor("gemini-2.5-pro", "low")).toEqual({ temperature: 0, thinkingConfig: { thinkingBudget: 128 } });
    expect(thinkingFor("gemini-3-flash", "minimal")).toEqual({ thinkingConfig: { thinkingLevel: "MINIMAL" } });
    expect(thinkingFor("gemini-3.5-flash", "minimal")).toEqual({ thinkingConfig: { thinkingLevel: "MINIMAL" } });
    expect(thinkingFor("gemini-3.6-flash", "minimal")).toEqual({ thinkingConfig: { thinkingLevel: "MINIMAL" } });
    // Gemini 3.7 Flash och 3.8 Flash tar bara LOW, MEDIUM och HIGH (Googles tabell) – MINIMAL gav HTTP 400 i skarp drift 2026-10-09.
    expect(thinkingFor("gemini-3.8-flash", "minimal")).toEqual({ thinkingConfig: { thinkingLevel: "LOW" } });
    expect(thinkingFor("gemini-3.7-flash", "minimal")).toEqual({ thinkingConfig: { thinkingLevel: "LOW" } });
    expect(thinkingFor("gemini-3.8-flash", "low")).toEqual({ thinkingConfig: { thinkingLevel: "LOW" } });
    expect(thinkingFor("gemini-3.8-flash", "high")).toEqual({ thinkingConfig: { thinkingLevel: "HIGH" } });
    expect(thinkingFor("gemini-3-pro", "minimal")).toEqual({ thinkingConfig: { thinkingLevel: "LOW" } });
    expect(thinkingFor("gemini-3.1-pro", "minimal")).toEqual({ thinkingConfig: { thinkingLevel: "LOW" } });
    expect(thinkingFor("gemini-2.0-flash", "low")).toEqual({ temperature: 0 });
  });
});

describe("transcribe", () => {
  it("ljudet inline som base64 till EU-endpointen med token; svaret valideras, sorteras och ger mätvärden", async () => {
    const v = vertex(ENV, [
      reply(
        { language: "SV", segments: [{ start: 12.04, end: 15, speaker: "Deltagare", text: " Jag kom i tid alla dagar. " }, { start: 0, end: 11.96, speaker: "Coach", text: "Hur har veckan gått?" }] },
        { promptTokenCount: 48_400, candidatesTokenCount: 900, promptTokensDetails: [{ modality: "AUDIO", tokenCount: 48_000 }, { modality: "TEXT", tokenCount: 400 }] },
      ),
    ]);
    const r = await v.ai.transcribe(audio(new Uint8Array([104, 101, 106]), "audio/x-m4a"), { language: "sv" });
    expect(r.value).toEqual({
      text: "Hur har veckan gått? Jag kom i tid alla dagar.",
      language: "sv",
      segments: [
        { start: 0, end: 12, speaker: "Coach", text: "Hur har veckan gått?" },
        { start: 12, end: 15, speaker: "Deltagare", text: "Jag kom i tid alla dagar." },
      ],
    });
    expect(r.run).toMatchObject({ provider: "vertex_eu", model: "gemini-2.5-flash", tokensIn: 48_400, tokensOut: 900, audioSeconds: 1500 });
    // 48 000 ljud * 1100 + 400 text * 330 + 900 ut * 2750 = 55,4 öre -> 56
    expect(r.run.costOre).toBe(56);
    const call = v.calls[0];
    expect(call.url).toBe(URL_EU);
    expect(call.headers.authorization).toBe("Bearer tok-1");
    const contents = call.body.contents as { role: string; parts: { inlineData?: { mimeType: string; data: string }; text?: string }[] }[];
    expect(contents[0].parts[0].inlineData).toEqual({ mimeType: "audio/m4a", data: Buffer.from([104, 101, 106]).toString("base64") });
    const gc = call.body.generationConfig as Record<string, unknown>;
    expect(gc).toMatchObject({ responseMimeType: "application/json", candidateCount: 1, temperature: 0, thinkingConfig: { thinkingBudget: 0 } });
    expect((gc.responseSchema as { required: string[] }).required).toEqual(["language", "segments"]);
    const sys = (call.body.systemInstruction as { parts: { text: string }[] }).parts[0].text;
    expect(sys).toMatch(/ordagrant/);
    expect(sys).toMatch(/"Coach" eller "Deltagare"/);
  });

  it("ogiltigt svar försöks en gång till – blir även det ogiltigt används det aldrig (mätvärdena för båda anropen följer med)", async () => {
    const usage = { promptTokenCount: 1000, candidatesTokenCount: 10 };
    const v = vertex(ENV, [reply({ language: "sv" }, usage), reply({ language: "svenska", segments: [] }, usage)]);
    const e = await v.ai.transcribe(audio(), { language: "sv" }).catch((x: unknown) => x as AiProviderError);
    expect(e).toBeInstanceOf(AiProviderError);
    expect(e).toMatchObject({ code: "invalid_response", retryable: false, run: { tokensIn: 2000, tokensOut: 20 } });
    expect(v.calls).toHaveLength(2);
    // Felet innehåller bara fältnamn
    expect(String((e as AiProviderError).detail)).toMatch(/language/);
  });

  it("429 och 5xx försöks igen; 401 ger ny token; 403 är ett inställningsfel", async () => {
    const ok = reply({ language: "sv", segments: [{ start: 0, end: 1, speaker: null, text: "Hej." }] });
    const a = vertex(ENV, [{ status: 429 }, ok]);
    expect((await a.ai.transcribe(audio(), { language: "sv" })).value.text).toBe("Hej.");
    expect(a.calls).toHaveLength(2);
    const b = vertex(ENV, [{ status: 401 }, ok]);
    await b.ai.transcribe(audio(), { language: "sv" });
    expect(b.tokens()).toBe(2);
    expect(b.calls[1].headers.authorization).toBe("Bearer tok-2");
    const c = vertex(ENV, [{ status: 503 }, { status: 503 }]);
    await expect(c.ai.transcribe(audio(), { language: "sv" })).rejects.toMatchObject({ code: "unavailable", retryable: true });
    const d = vertex(ENV, [{ throws: true }, { throws: true }]);
    await expect(d.ai.transcribe(audio(), { language: "sv" })).rejects.toMatchObject({ code: "unavailable", retryable: true });
    const e = vertex(ENV, [{ status: 403 }]);
    await expect(e.ai.transcribe(audio(), { language: "sv" })).rejects.toMatchObject({ code: "config", retryable: false });
    expect(e.calls).toHaveLength(1);
  });

  it("stoppat svar, avbrutet svar och resonemangsdelar", async () => {
    const a = vertex(ENV, [reply({}, {}, { finishReason: "SAFETY" })]);
    await expect(a.ai.transcribe(audio(), { language: "sv" })).rejects.toMatchObject({ code: "blocked" });
    const b = vertex(ENV, [reply({}, {}, { finishReason: "MAX_TOKENS" }), reply({}, {}, { finishReason: "MAX_TOKENS" })]);
    await expect(b.ai.transcribe(audio(), { language: "sv" })).rejects.toMatchObject({ code: "invalid_response" });
    const c = vertex(ENV, [{ body: { promptFeedback: { blockReason: "PROHIBITED_CONTENT" } } }]);
    await expect(c.ai.transcribe(audio(), { language: "sv" })).rejects.toMatchObject({ code: "blocked" });
    const json = JSON.stringify({ language: "sv", segments: [{ start: 0, end: 1, speaker: null, text: "Ja." }] });
    const d = vertex(ENV, [{ body: { candidates: [{ content: { parts: [{ text: "tänker…", thought: true }, { text: json }] }, finishReason: "STOP" }] } }]);
    expect((await d.ai.transcribe(audio(), { language: "sv" })).value.text).toBe("Ja.");
  });

  it("HTTP 400: Googles felorsak (status + message) följer med i detail – texten till användaren är oförändrad", async () => {
    const msg = "Request contains an invalid argument. thinking_level MINIMAL is not supported for this model.";
    const a = vertex(ENV, [{ status: 400, body: { error: { code: 400, message: msg, status: "INVALID_ARGUMENT" } } }]);
    const e = (await a.ai.transcribe(audio(), { language: "sv" }).catch((x: unknown) => x)) as AiProviderError;
    expect(e).toBeInstanceOf(AiProviderError);
    expect(e).toMatchObject({ code: "unsupported", retryable: false, message: "Ljudformatet stöds inte av AI-leverantören" });
    expect(e.detail).toBe(`Vertex AI gav HTTP 400: INVALID_ARGUMENT: ${msg}`);
    expect(a.calls).toHaveLength(1);
    // 403 utan kropp: bara statusen. 404 med kropp: felorsaken följer med.
    const b = vertex(ENV, [{ status: 403, body: "not json" }]);
    expect(((await b.ai.transcribe(audio(), { language: "sv" }).catch((x: unknown) => x)) as AiProviderError).detail).toBe("Vertex AI gav HTTP 403");
    const c = vertex(ENV, [{ status: 404, body: { error: { message: "Publisher Model `gemini-x` not found", status: "NOT_FOUND" } } }]);
    expect(((await c.ai.transcribe(audio(), { language: "sv" }).catch((x: unknown) => x)) as AiProviderError).detail).toBe(
      "Vertex AI gav HTTP 404: NOT_FOUND: Publisher Model `gemini-x` not found",
    );
  });

  it("felorsaken kortas till 300 tecken, base64-block tas bort och radbrytningar slås ihop", () => {
    const b64 = Buffer.from(new Uint8Array(90)).toString("base64");
    expect(providerErrorDetail(400, { error: { message: `Invalid data ${b64} here\n  next line` } })).toBe("Vertex AI gav HTTP 400: Invalid data [data] here next line");
    expect(providerErrorDetail(400, { error: { message: "fel i anropet ".repeat(40), status: "INVALID_ARGUMENT" } })).toHaveLength(300);
    expect(providerErrorDetail(400, { error: { message: "https://cloud.google.com/vertex-ai/docs/generative-ai/learn/overview is the page" } })).toContain("overview is the page");
    expect(providerErrorDetail(500, null)).toBe("Vertex AI gav HTTP 500");
    expect(providerErrorDetail(400, { error: "sträng" })).toBe("Vertex AI gav HTTP 400");
  });

  it("inspelningens grundtyper (mp4, ogg, webm, mpeg, m4a, wav) skickas med Vertex AI:s mimeType", async () => {
    const ok = reply({ language: "sv", segments: [{ start: 0, end: 1, speaker: null, text: "Hej." }] });
    const cases: [string, string][] = [
      ["audio/mp4", "audio/mp4"], ["audio/ogg", "audio/ogg"], ["audio/webm", "audio/webm"], ["audio/mpeg", "audio/mpeg"], ["audio/mp3", "audio/mp3"],
      ["audio/x-m4a", "audio/m4a"], ["audio/wav", "audio/wav"], ["audio/x-wav", "audio/wav"],
    ];
    for (const [stored, sent] of cases) {
      const v = vertex(ENV, [ok]);
      await v.ai.transcribe(audio(new Uint8Array([1, 2, 3]), stored), { language: "sv" });
      const contents = v.calls[0].body.contents as { parts: { inlineData?: { mimeType: string; data: string }; text?: string }[] }[];
      expect(contents[0].parts[0].inlineData).toEqual({ mimeType: sent, data: "AQID" });
      expect(contents[0].parts[1].text).toBe("Transkribera ljudet.");
    }
  });

  it("för stort ljud och okänd filtyp skickas aldrig", async () => {
    const v = vertex(ENV, []);
    await expect(v.ai.transcribe(audio(new Uint8Array(INLINE_AUDIO_MAX_BYTES + 1)), { language: "sv" })).rejects.toMatchObject({ code: "too_large", retryable: false });
    await expect(v.ai.transcribe(audio(new Uint8Array(4), "video/mp4"), { language: "sv" })).rejects.toMatchObject({ code: "unsupported" });
    await expect(v.ai.transcribe({ ...audio(), bytes: null }, { language: "sv" })).rejects.toMatchObject({ code: "unsupported" });
    expect(v.calls).toHaveLength(0);
    // 20 MB-gränsen gäller hela anropet (base64)
    expect(Math.ceil(INLINE_AUDIO_MAX_BYTES / 3) * 4).toBeLessThan(20 * 1024 * 1024);
  });
});

const TRANSCRIPT: Transcript = {
  text: "Hur har veckan gått? Jag nådde målet.",
  language: "sv",
  segments: [
    { start: 0, end: 5, speaker: "Coach", text: "Hur har veckan gått?" },
    { start: 96, end: 100, speaker: "Deltagare", text: "Jag nådde målet." },
  ],
};
const none = { value: null, quote: "Framgår inte", t: null, noEvidence: true };
const EXTRACT = {
  attendanceComment: none,
  goalStatus: { value: "yes", quote: "Jag nådde målet.", t: 96, noEvidence: false },
  nextGoal: none, phase: none, activitiesDone: none, employerContacts: none, obstacles: none,
  note: { value: "Nådde veckomålet.", quote: "Jag nådde målet.", t: 96, noEvidence: false },
};

describe("extract", () => {
  it("transkriptet med tider och SPEC §8.3:s instruktioner; svaret valideras mot veckoavstämningens schema", async () => {
    const res = reply(EXTRACT, { promptTokenCount: 900, candidatesTokenCount: 200, thoughtsTokenCount: 50 });
    (res.body as Record<string, unknown>).modelVersion = "gemini-3-flash-001";
    const v = vertex({ ...ENV, MM_AI_MODEL: "gemini-3-flash" }, [res]);
    const r = await v.ai.extract(TRANSCRIPT, "check_in");
    expect(r.value.goalStatus).toEqual(EXTRACT.goalStatus);
    // Modellens version från svaret sparas i ai_runs.model
    expect(r.run).toMatchObject({ model: "gemini-3-flash-001", tokensIn: 900, tokensOut: 250, audioSeconds: null });
    const body = v.calls[0].body;
    expect(v.calls[0].url).toContain("/models/gemini-3-flash:generateContent");
    expect((body.generationConfig as Record<string, unknown>).thinkingConfig).toEqual({ thinkingLevel: "LOW" });
    const user = (body.contents as { parts: { text: string }[] }[])[0].parts[0].text;
    expect(user).toContain("[96] Deltagare: Jag nådde målet.");
    const sys = (body.systemInstruction as { parts: { text: string }[] }).parts[0].text;
    expect(sys).toContain("Du är ett dokumentationsstöd åt en jobbcoach");
    expect(sys).toContain("Framgår inte");
    expect(sys).toContain("Föreslå aldrig samlad status");
    const schema = (body.generationConfig as { responseSchema: { properties: Record<string, unknown> } }).responseSchema;
    expect(Object.keys(schema.properties)).toEqual(["attendanceComment", "goalStatus", "nextGoal", "phase", "activitiesDone", "employerContacts", "obstacles", "note"]);
    // Närvarokommentaren: bara texten föreslås – närvarostatusen sätts aldrig av AI (CLAUDE.md punkt 5)
    expect(sys).toContain("attendanceComment: ett kort förslag till kommentar om närvaron");
    expect(sys).toContain("Sätt aldrig närvarostatus");
  });

  it("samlad status eller värden utanför formulärets listor underkänns (två försök, sedan fel)", async () => {
    const withStatus = { ...EXTRACT, overallStatus: { value: "green", quote: "x", t: 1, noEvidence: false } };
    const a = vertex(ENV, [reply(withStatus), reply(withStatus)]);
    await expect(a.ai.extract(TRANSCRIPT, "check_in")).rejects.toMatchObject({ code: "invalid_response" });
    const badAct = { ...EXTRACT, activitiesDone: { value: ["Terapi"], quote: "Jag nådde målet.", t: 96, noEvidence: false } };
    const b = vertex(ENV, [reply(badAct), reply(EXTRACT)]);
    expect((await b.ai.extract(TRANSCRIPT, "check_in")).value.activitiesDone).toEqual(none);
    expect(b.calls).toHaveLength(2);
    const noQuote = { ...EXTRACT, goalStatus: { value: "yes", quote: "", t: null, noEvidence: false } };
    const c = vertex(ENV, [reply(noQuote), reply(noQuote)]);
    await expect(c.ai.extract(TRANSCRIPT, "check_in")).rejects.toMatchObject({ code: "invalid_response" });
  });
});

const INPUT: DraftInput = {
  caseId: "case-1",
  month: "2027-01",
  checkIns: [
    { id: "ci-1", heldAt: "2027-01-08T10:00", goalStatus: "yes", nextGoal: "Skicka tre ansökningar", phase: 5, activitiesDone: ["CV och ansökningar"], employerContacts: { count: "1", types: ["ansökan"] }, obstacles: [], note: "Bra vecka.", status: "approved" },
    { id: "ci-2", heldAt: "2027-01-22T10:00", goalStatus: "partly", nextGoal: "Förbereda intervjun", phase: 5, activitiesDone: ["Intervjuträning"], employerContacts: { count: "0", types: [] }, obstacles: ["Språk"], note: "Övade intervju.", status: "approved" },
  ],
  attendance: [{ status: "present" }, { status: "late" }],
  notes: [],
};

describe("draft (bara godkända uppgifter)", () => {
  it("källornas namn sätts av appen i tidsordning; påhittade källor underkänns", async () => {
    const v = vertex(ENV, [reply({ text: "Har sökt jobb och övat intervju.", sourceIds: ["ci-2", "ci-1"], usedAttendance: true, noEvidence: false })]);
    const r = await v.ai.draft(INPUT, "monthly_area:digital_sjalvstandighet");
    expect(r.value).toEqual({ text: "Har sökt jobb och övat intervju.", sources: ["Närvaroregistrering", "Avstämning 8 jan", "Avstämning 22 jan"], sourceIds: ["ci-1", "ci-2"], noEvidence: false });
    const sys = (v.calls[0].body.systemInstruction as { parts: { text: string }[] }).parts[0].text;
    expect(sys).toContain('"digital sjalvstandighet"');
    expect(sys).toContain("Sätt aldrig nivå");
    const user = (v.calls[0].body.contents as { parts: { text: string }[] }[])[0].parts[0].text;
    expect(user).toContain('"id":"ci-1"');
    expect(user).toContain('"registreradeTillfallen":2');

    const bad = vertex(ENV, [reply({ text: "x", sourceIds: ["ci-9"], usedAttendance: false, noEvidence: false }), reply({ text: "x", sourceIds: ["ci-9"], usedAttendance: false, noEvidence: false })]);
    await expect(bad.ai.draft(INPUT, "monthly_summary")).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("utan belägg: standardtexten \"Framgår inte\"; utan underlag görs inget anrop", async () => {
    const v = vertex(ENV, [reply({ text: "Framgår inte", sourceIds: [], usedAttendance: false, noEvidence: true })]);
    expect((await v.ai.draft(INPUT, "monthly_plan")).value).toEqual({ text: "Framgår inte av månadens godkända mötesrapporter.", sources: [], sourceIds: [], noEvidence: true });
    const empty = vertex(ENV, []);
    const r = await empty.ai.draft({ ...INPUT, checkIns: [], attendance: [] }, "monthly_summary");
    expect(r.value.noEvidence).toBe(true);
    expect(r.run.costOre).toBe(0);
    expect(empty.calls).toHaveLength(0);
    // Något annat än godkända avstämningar stoppas innan något skickas
    await expect(empty.ai.draft({ ...INPUT, checkIns: [{ ...INPUT.checkIns[0], status: "draft" as never }] }, "monthly_summary")).rejects.toThrow(/godkända/);
  });

  it("anteckningarna (beslut 4 2026-10-09): med i underlaget med id, datum, typ och text – aldrig författaren; källan heter Anteckning <datum>", async () => {
    const notes = [{ id: "note-1", date: "2027-01-15", kind: "conversation" as const, text: "Var med på gruppträffen och pratade om CV." }];
    const v = vertex(ENV, [reply({ text: "Har deltagit i gruppträff och arbetat med CV.", sourceIds: ["note-1", "ci-1"], usedAttendance: false, noEvidence: false })]);
    const r = await v.ai.draft({ ...INPUT, notes }, "monthly_summary");
    expect(r.value).toEqual({ text: "Har deltagit i gruppträff och arbetat med CV.", sources: ["Avstämning 8 jan", "Anteckning 15 jan"], sourceIds: ["ci-1", "note-1"], noEvidence: false });
    const user = (v.calls[0].body.contents as { parts: { text: string }[] }[])[0].parts[0].text;
    expect(user).toContain('"anteckningar":[{"id":"note-1","datum":"15 jan","typ":"Samtal med deltagaren","text":"Var med på gruppträffen och pratade om CV."}]');
    expect(user).not.toMatch(/authorId|u-amira|Amira|grp-|Nivå \d|Vill arbeta/);
    const sys = (v.calls[0].body.systemInstruction as { parts: { text: string }[] }).parts[0].text;
    expect(sys).toContain("coachernas anteckningar");
    expect(sys).toContain("Sätt aldrig nivå");
    // Bara anteckningar räcker för ett anrop; påhittade anteckningar underkänns.
    const only = vertex(ENV, [reply({ text: "Var med på gruppträffen.", sourceIds: ["note-1"], usedAttendance: false, noEvidence: false })]);
    expect((await only.ai.draft({ ...INPUT, checkIns: [], attendance: [], notes }, "monthly_summary")).value.sources).toEqual(["Anteckning 15 jan"]);
    const bad = vertex(ENV, [reply({ text: "x", sourceIds: ["note-9"], usedAttendance: false, noEvidence: false }), reply({ text: "x", sourceIds: ["note-9"], usedAttendance: false, noEvidence: false })]);
    await expect(bad.ai.draft({ ...INPUT, notes }, "monthly_summary")).rejects.toMatchObject({ code: "invalid_response" });
    // Personnummer i en anteckning eller fält utöver underlaget stoppas innan något skickas.
    const none = vertex(ENV, []);
    await expect(none.ai.draft({ ...INPUT, notes: [{ ...notes[0], text: "Pnr 850101-1234" }] }, "monthly_summary")).rejects.toThrow(/personnummer/);
    await expect(none.ai.draft({ ...INPUT, notes, groupings: ["Måndagsgruppen"] } as never, "monthly_summary")).rejects.toThrow(/bara innehålla/);
    expect(none.calls).toHaveLength(0);
  });
});

describe("translate", () => {
  it("till svenska; samma språk eller tom text skickas inte", async () => {
    const v = vertex(ENV, [reply({ text: "Jag vill börja på praktiken tidigare." })]);
    expect((await v.ai.translate("Waxaan rabaa inaan bilaabo tababarka goor hore.", "so", "sv")).value).toEqual({ text: "Jag vill börja på praktiken tidigare.", from: "so", to: "sv" });
    expect((v.calls[0].body.systemInstruction as { parts: { text: string }[] }).parts[0].text).toContain("från somaliska till svenska");
    expect((await v.ai.translate("Hej.", "sv", "sv")).value.text).toBe("Hej.");
    expect(v.calls).toHaveLength(1);
  });
});
