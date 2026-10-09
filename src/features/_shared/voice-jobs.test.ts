// Röstinspelningens jobb (voice-jobs.ts) mot testdatat i minnet med den simulerade AI:n och ljudet i minnet – samma kod som
// körs av jobbkön på servern. Kontrollerar verkliga värden: förslagen och transkriptet i ai_runs, att ljudet raderas direkt
// efter lyckad transkribering, samtycke och skydd när jobbet körs, ogiltiga AI-svar, påhittade belägg, deltagarens
// röstmeddelande (somaliska -> testdatats svenska text), utkasten till månadsbedömningen (exakt testdatats/prototypens texter)
// och gallringen (ljud efter 24 timmar, råtranskript när avstämningen godkänts och efter 30 dagar).
import { describe, expect, it, vi } from "vitest";
import { SYSTEM_ACTOR, type Actor } from "@/api/roles";
import { addDays, addMinutes, type LocalDateTime } from "@/core/time";
import { personaFor } from "@/data/actors";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START } from "@/data/seed";
import { TEST_PNR_CRYPTO } from "@/data/seed/pnr";
import { participantMessage, PARTICIPANT_MESSAGES } from "@/data/seed/voice-texts";
import type { AppRepo, Tables } from "@/data/schema";
import { EXTRACT_SCHEMAS, type AiPort, type AiRunMeta } from "./ai-port";
import { createSimulatedAi, simulatedDraft } from "./ai-sim";
import { createMemoryAudio } from "./audio-port";
import {
  aiRunError, checkEvidence, enqueueVoiceJob, failVoiceJob, monthlyDraftInput, ownDictation, retentionAudio, retentionTranscripts, runVoiceJob,
  toVoiceJobError, VoiceJobError, type CheckInAiOutput, type CtxWithJobs, type MonthlyDraftOutput,
} from "./voice-jobs";

const NADIA = "case-260143"; // samtycke givet, coach Amira
const MEHMET = "case-260130"; // samtycke givet, coach Amira, januari: två godkända avstämningar
const YUSUF = "case-260148"; // har sagt nej till inspelning av avstämningarna
const AMAL = "case-270012"; // exempellänken vl-demo (arabiska som förval)
const SKYDDAD = "case-260120"; // skyddade personuppgifter, coach Erik

function setup(o: { ai?: AiPort; jobs?: boolean } = {}) {
  const store = new MemoryStore<Tables>(createSeed());
  let seq = 0;
  const newId = (p: string) => `${p}-t${String(++seq).padStart(4, "0")}`;
  let clock: LocalDateTime = DEMO_START;
  const now = () => clock;
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  const audio = createMemoryAudio({ system, now, newId });
  const ai = o.ai ?? createSimulatedAi();
  const schedule = vi.fn();
  const actor = (userId: string, role?: Actor["role"]): Actor => personaFor(store.raw(), userId, role)!.actor;
  const ctxFor = (a: Actor): CtxWithJobs => ({
    actor: a,
    now,
    repo: new MemoryRepo<Tables>(store, a, POLICIES) as unknown as AppRepo,
    system,
    newId,
    audit: async (e) => {
      await system.table("audit_log").insert({ id: newId("log"), occurredAt: now(), actorId: a.userId, action: e.action, entity: e.entity, entityId: e.entityId, contractId: e.contractId ?? null, details: e.details ?? {} });
    },
    notify: async () => undefined,
    crypto: TEST_PNR_CRYPTO,
    ai,
    audio,
    ...(o.jobs ? { jobs: { schedule } } : {}),
  });
  const amira = ctxFor(actor("u-amira", "coach"));
  const sys = ctxFor(SYSTEM_ACTOR);
  /** En bekräftad uppladdning (som efter confirmOwnUpload). */
  async function upload(caseId: string | null, purpose: "checkin" | "dictation" | "participant", ownerId: string, durationSec = 1500) {
    const t = await audio.createUpload({ caseId, ownerId, purpose, mimeType: "audio/webm;codecs=opus", durationSec });
    await audio.confirm(t.uploadId, { durationSec });
    return t.uploadId;
  }
  return {
    store, system, audio, ai, schedule, ctxFor, actor, amira, sys, upload,
    setNow: (t: LocalDateTime) => {
      clock = t;
    },
    run: (id: string) => store.getRow("ai_runs", id)!,
    audit: (action: string) => store.rows("audit_log").filter((x) => x.action === action),
  };
}

describe("transcribe_recording (coachens inspelning)", () => {
  it("minnesläget: körs direkt – förslag med belägg och transkript i ai_runs, ljudet raderat direkt, jobbet klart", async () => {
    const t = setup();
    const id = await t.upload(NADIA, "checkin", "u-amira", 1500);
    const r = await enqueueVoiceJob(t.amira, { kind: "transcribe_recording", uploadId: id, source: "recording" });
    expect(r).toMatchObject({ status: "succeeded", error: null });
    const run = t.run(r.aiRunId);
    expect(run).toMatchObject({ kind: "transcribe_extract", caseId: NADIA, inputRef: id, status: "succeeded", provider: "simulated", model: "simulerad", audioSeconds: 1500, inputDeletedAt: DEMO_START });
    expect(run.costOre).toBeGreaterThan(0);
    const out = run.output as CheckInAiOutput;
    expect(out.source).toBe("recording");
    expect(EXTRACT_SCHEMAS.check_in.parse(out.suggestions)).toEqual(out.suggestions);
    expect(Object.keys(out.suggestions)).not.toContain("overallStatus");
    expect(out.transcript.length).toBeGreaterThan(5);
    expect(out.transcript.some((l) => l.who === "Coach")).toBe(true);
    // Beläggen är citat ur transkriptet med rätt tidpunkt
    const g = out.suggestions.goalStatus;
    expect(g.noEvidence).toBeFalsy();
    expect(out.transcript.find((l) => l.text === g.quote)?.t).toBe(g.t);
    // Ljudet: raderat direkt (status deleted, inget kvar i minnet), revisionslogg utan innehåll
    expect(t.store.getRow("audio_uploads", id)).toMatchObject({ status: "deleted", deletedAt: DEMO_START });
    expect(t.audio.stored()).toBe(0);
    expect(t.audit("audio.deleted").at(-1)).toMatchObject({ entityId: id, contractId: "c-bot", details: { reason: "Transkribering klar", purpose: "checkin", aiRunId: run.id } });
    expect(t.audit("ai.run").at(-1)).toMatchObject({ entityId: run.id, details: { kind: "transcribe_extract", caseId: NADIA } });
    expect(t.store.getRow("jobs", r.jobId)).toMatchObject({ kind: "transcribe_recording", status: "done", attempts: 1, payload: { aiRunId: run.id, uploadId: id, source: "recording", checkInId: null } });
  });

  it("förslagen hamnar i avstämningsutkastet när det finns – aldrig i en godkänd avstämning", async () => {
    const t = setup();
    const ciId = "ci-test";
    const any = t.store.rows("check_ins").find((c) => c.caseId === NADIA)!;
    // Ett utkast där coachen ännu inte valt samlad status
    t.store.insertRow("check_ins", { ...any, id: ciId, status: "draft", approvedBy: null, approvedAt: null, aiRunId: null, ai: null, overallStatus: null, inputMethod: "manual" });
    const id = await t.upload(NADIA, "checkin", "u-amira");
    const r = await enqueueVoiceJob(t.amira, { kind: "transcribe_recording", uploadId: id, source: "upload", checkInId: ciId });
    const ci = t.store.getRow("check_ins", ciId)!;
    const out = t.run(r.aiRunId).output as CheckInAiOutput;
    // Samlad status förblir tom – den sätter coachen (CLAUDE.md punkt 5)
    expect(ci).toMatchObject({ aiRunId: r.aiRunId, inputMethod: "ai_upload", status: "draft", overallStatus: null });
    expect(ci.ai).toMatchObject({ goalStatus: out.suggestions.goalStatus, transcript: out.transcript, audioDeletedAt: DEMO_START, rawTranscriptDeleteBy: addDays(DEMO_START, 30) });

    const approved = t.store.rows("check_ins").find((c) => c.caseId === NADIA && c.status === "approved")!;
    const before = JSON.stringify(approved);
    const id2 = await t.upload(NADIA, "checkin", "u-amira");
    await enqueueVoiceJob(t.amira, { kind: "transcribe_recording", uploadId: id2, source: "recording", checkInId: approved.id });
    expect(JSON.stringify(t.store.getRow("check_ins", approved.id))).toBe(before);
  });

  it("supabase-läget: jobbet läggs i kön (queued) och after() begärs – körningen pågår tills jobbet körts", async () => {
    const t = setup({ jobs: true });
    const id = await t.upload(NADIA, "checkin", "u-amira");
    const r = await enqueueVoiceJob(t.amira, { kind: "transcribe_recording", uploadId: id, source: "recording" });
    expect(r).toMatchObject({ status: "running", error: null });
    expect(t.schedule).toHaveBeenCalledTimes(1);
    expect(t.store.getRow("jobs", r.jobId)).toMatchObject({ status: "queued", attempts: 0, createdBy: "u-amira", runAfter: DEMO_START });
    expect(t.run(r.aiRunId)).toMatchObject({ status: "running", output: null });
    expect(t.store.getRow("audio_uploads", id)!.status).toBe("uploaded");
    // Jobbkörningen (systemsteg)
    const job = t.store.getRow("jobs", r.jobId)!;
    expect(await runVoiceJob(t.sys, "transcribe_recording", job.payload)).toBe("succeeded");
    expect(t.run(r.aiRunId).status).toBe("succeeded");
    // Idempotent: samma jobb igen gör ingenting
    expect(await runVoiceJob(t.sys, "transcribe_recording", job.payload)).toBe("already_done");
  });

  it("samtycket kontrolleras när jobbet körs: återkallat samtycke -> misslyckad körning och ljudet raderas direkt", async () => {
    const t = setup({ jobs: true });
    const id = await t.upload(NADIA, "checkin", "u-amira");
    const r = await enqueueVoiceJob(t.amira, { kind: "transcribe_recording", uploadId: id, source: "recording" });
    t.store.updateRow("cases", NADIA, { aiConsentStatus: "revoked" });
    const job = t.store.getRow("jobs", r.jobId)!;
    const err = await runVoiceJob(t.sys, "transcribe_recording", job.payload).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VoiceJobError);
    expect((err as VoiceJobError).code).toBe("blocked_no_consent");
    await failVoiceJob(t.sys, "transcribe_recording", job.payload, err);
    expect(t.run(r.aiRunId)).toMatchObject({ status: "failed", output: { error: "blocked_no_consent" } });
    expect(aiRunError(t.run(r.aiRunId))?.text).toMatch(/samtycke/);
    expect(t.store.getRow("audio_uploads", id)).toMatchObject({ status: "deleted", deletedAt: DEMO_START });
  });

  it("aldrig för skyddade personuppgifter (vilande spärr påslagen) – och aldrig utan samtycke (Yusuf har sagt nej)", async () => {
    const t = setup();
    // Testdatat har inga skyddade personer sedan 2026-10-07 – spärren slås på för personen i ärendet.
    t.store.updateRow("persons", t.store.getRow("cases", SKYDDAD)!.personId, { protectedIdentity: true });
    const erik = t.ctxFor(t.actor("u-erik", "coach"));
    const id = await t.upload(SKYDDAD, "checkin", "u-erik");
    const r = await enqueueVoiceJob(erik, { kind: "transcribe_recording", uploadId: id, source: "recording" });
    expect(r).toMatchObject({ status: "failed", error: { code: "blocked_protected" } });
    expect(t.store.getRow("audio_uploads", id)!.status).toBe("deleted");
    expect(t.store.getRow("jobs", r.jobId)).toMatchObject({ status: "failed", lastError: "Inspelning och AI används aldrig för personer med skyddade personuppgifter." });

    const id2 = await t.upload(YUSUF, "checkin", "u-amira");
    const r2 = await enqueueVoiceJob(t.amira, { kind: "transcribe_recording", uploadId: id2, source: "recording" });
    expect(r2.error?.code).toBe("blocked_no_consent");
  });

  it("ogiltigt AI-svar (t.ex. samlad status) sparas som fel och visas aldrig", async () => {
    const sim = createSimulatedAi();
    const bad: AiPort = {
      ...sim,
      provider: sim.provider,
      model: sim.model,
      extract: async (tr, key) => {
        const r = await sim.extract(tr, key);
        return { ...r, value: { ...r.value, overallStatus: { value: "green", quote: "x", t: 1 } } as never };
      },
    };
    const t = setup({ ai: bad });
    const id = await t.upload(NADIA, "checkin", "u-amira");
    const r = await enqueueVoiceJob(t.amira, { kind: "transcribe_recording", uploadId: id, source: "recording" });
    expect(r).toMatchObject({ status: "failed", error: { code: "invalid_response" } });
    const run = t.run(r.aiRunId);
    expect(run.output).toEqual({ error: "invalid_response" });
    expect(run.tokensIn).toBeGreaterThan(0); // transkriberingen och extract räknas ändå
    // Ljudet raderades redan efter den lyckade transkriberingen
    expect(t.store.getRow("audio_uploads", id)!.status).toBe("deleted");
  });

  it("nytt försök efter tillfälligt fel använder det sparade transkriptet – ljudet behövs inte igen", async () => {
    const sim = createSimulatedAi();
    let fails = 1;
    let transcribes = 0;
    const flaky: AiPort = {
      ...sim,
      provider: sim.provider,
      model: sim.model,
      transcribe: async (a, o) => {
        transcribes++;
        return sim.transcribe(a, o);
      },
      extract: async (tr, key) => {
        if (fails-- > 0) throw Object.assign(new Error("AI-leverantören svarar inte just nu"), { code: "unavailable", retryable: true });
        return sim.extract(tr, key);
      },
    };
    const t = setup({ ai: flaky, jobs: true });
    const id = await t.upload(NADIA, "checkin", "u-amira");
    const r = await enqueueVoiceJob(t.amira, { kind: "transcribe_recording", uploadId: id, source: "recording" });
    const job = t.store.getRow("jobs", r.jobId)!;
    const err = await runVoiceJob(t.sys, "transcribe_recording", job.payload).catch((e: unknown) => toVoiceJobError(e));
    expect(err).toMatchObject({ code: "provider_unavailable", retryable: true });
    expect(t.run(r.aiRunId).status).toBe("running");
    expect(t.store.getRow("audio_uploads", id)!.status).toBe("deleted");
    expect(await runVoiceJob(t.sys, "transcribe_recording", job.payload)).toBe("succeeded");
    expect(transcribes).toBe(1);
    const run = t.run(r.aiRunId);
    expect(run.output).not.toHaveProperty("pending");
    expect((run.output as CheckInAiOutput).suggestions.goalStatus.noEvidence).toBeFalsy();
  });

  it("påhittade belägg visas aldrig: ett citat som inte finns i transkriptet blir \"Framgår inte\"", async () => {
    const sim = createSimulatedAi();
    const liar: AiPort = {
      ...sim,
      provider: sim.provider,
      model: sim.model,
      extract: async (tr, key) => {
        const r = await sim.extract(tr, key);
        const v = r.value as CheckInAiOutput["suggestions"];
        return { ...r, value: { ...v, goalStatus: { value: "yes", quote: "Jag har fått fast jobb som pilot.", t: 12 } } as never };
      },
    };
    const t = setup({ ai: liar });
    const id = await t.upload(NADIA, "checkin", "u-amira");
    const r = await enqueueVoiceJob(t.amira, { kind: "transcribe_recording", uploadId: id, source: "recording" });
    const run = t.run(r.aiRunId);
    expect((run.output as CheckInAiOutput).suggestions.goalStatus).toEqual({ value: null, quote: "Framgår inte av samtalet. Fyll i själv.", t: null, noEvidence: true });
    expect(run.evidence).toEqual({ unverifiedQuotes: ["goalStatus"] });
  });

  it("checkEvidence: citat med annan interpunktion och versaler godtas; citat med utelämning (…) kontrolleras del för del", () => {
    const tr = { text: "", language: "sv", segments: [{ start: 10, end: 20, text: "Jag var på en intervju hos en arbetsgivare i torsdags.", speaker: "Deltagare" }] };
    const base = { value: null, quote: "", t: null, noEvidence: true };
    const s = {
      attendanceComment: base, goalStatus: base, nextGoal: base, phase: base, activitiesDone: base, obstacles: base, note: base,
      employerContacts: { value: { count: "1" as const, types: ["intervju"] }, quote: "jag var på en INTERVJU … i torsdags", t: 10 },
    };
    expect(checkEvidence(s, tr).unverified).toEqual([]);
    expect(checkEvidence({ ...s, employerContacts: { ...s.employerContacts, quote: "jag var på en intervju … i fredags" } }, tr).unverified).toEqual(["employerContacts"]);
  });
});

describe("transcribe_dictation (kommunens \"Tala in\")", () => {
  it("texten tillbaka till den som talade in – ingen annan – och ljudet raderas", async () => {
    const t = setup();
    const maria = t.ctxFor(t.actor("k-maria", "kommun_handlaggare"));
    const id = await t.upload(null, "dictation", "k-maria", 20);
    const r = await enqueueVoiceJob(maria, { kind: "transcribe_dictation", uploadId: id, contractId: "c-bot" });
    expect(r.status).toBe("succeeded");
    const run = t.run(r.aiRunId);
    expect(run).toMatchObject({ kind: "transcribe_dictation", caseId: null, inputDeletedAt: DEMO_START });
    const text = (run.output as { text: string }).text;
    expect(text.length).toBeGreaterThan(20);
    expect(await ownDictation(maria, r.aiRunId)).toMatchObject({ status: "succeeded", text, audioDeletedAt: DEMO_START, error: null });
    expect(await ownDictation(t.ctxFor(t.actor("k-omar", "kommun_handlaggare")), r.aiRunId)).toBeNull();
    expect(t.store.getRow("audio_uploads", id)!.status).toBe("deleted");
  });
});

describe("transcribe_participant (deltagarens länk)", () => {
  it("somaliska: transkript på originalspråket + svensk översättning i ett nytt röstmeddelande (new) – inget ljud kvar", async () => {
    const t = setup();
    const participant = t.ctxFor({ userId: "deltagare", role: "deltagare", contractIds: [], customerUnit: null });
    const id = await t.upload(AMAL, "participant", "deltagare", 45);
    const r = await enqueueVoiceJob(participant, {
      kind: "transcribe_participant", uploadId: id, linkId: "vl-demo", language: "so", consentTextVersion: "röst-v1.0 (2026-09-30)", consentGivenAt: "2027-02-01T09:11",
    });
    expect(r.status).toBe("succeeded");
    const run = t.run(r.aiRunId);
    const noteId = (run.output as { noteId: string }).noteId;
    const note = t.store.getRow("participant_voice_notes", noteId)!;
    const v = PARTICIPANT_MESSAGES.findIndex((m) => m.so.join(" ") === note.textOriginal);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(note).toMatchObject({
      caseId: AMAL, linkId: "vl-demo", language: "so", textSv: participantMessage(v, "sv"), status: "new", consentTextVersion: "röst-v1.0 (2026-09-30)",
      consentGivenAt: "2027-02-01T09:11", reviewedBy: null, aiRunId: run.id, createdAt: DEMO_START,
    });
    // Texten finns bara i röstmeddelandet – inte i körningen
    expect(JSON.stringify(run.output)).not.toContain(note.textSv.slice(0, 20));
    expect(t.store.getRow("audio_uploads", id)!.status).toBe("deleted");
    // Idempotent
    expect(await runVoiceJob(t.sys, "transcribe_participant", t.store.getRow("jobs", r.jobId)!.payload)).toBe("already_done");
    expect(t.store.rows("participant_voice_notes").filter((n) => n.aiRunId === run.id)).toHaveLength(1);
  });

  it("svenska: ingen översättning (textOriginal null); ett språk utanför avtalet stoppas", async () => {
    const t = setup();
    const p = t.ctxFor({ userId: "deltagare", role: "deltagare", contractIds: [], customerUnit: null });
    const id = await t.upload(AMAL, "participant", "deltagare", 30);
    const r = await enqueueVoiceJob(p, { kind: "transcribe_participant", uploadId: id, linkId: "vl-demo", language: "sv", consentTextVersion: "v", consentGivenAt: DEMO_START });
    const note = t.store.getRow("participant_voice_notes", (t.run(r.aiRunId).output as { noteId: string }).noteId)!;
    expect(note).toMatchObject({ language: "sv", textOriginal: null });
    const id2 = await t.upload(AMAL, "participant", "deltagare", 30);
    const r2 = await enqueueVoiceJob(p, { kind: "transcribe_participant", uploadId: id2, linkId: "vl-demo", language: "fi", consentTextVersion: "v", consentGivenAt: DEMO_START });
    expect(r2.error?.code).toBe("language");
  });
});

describe("draft_monthly (bara godkända uppgifter)", () => {
  it("Mehmet januari: exakt testdatats (prototypens) AI-utkast per område och sammanfattning – nivåerna rörs aldrig", async () => {
    const t = setup();
    const before = structuredClone(t.store.getRow("monthly_assessments", "ma-15934")!);
    // Rensa utkasten så att jobbet måste skriva dem
    const cleared = Object.fromEntries(Object.entries(before.areas).map(([k, a]) => [k, { ...a, aiObservationDraft: null }]));
    t.store.updateRow("monthly_assessments", "ma-15934", { areas: cleared, aiSummaryDraft: null });
    const r = await enqueueVoiceJob(t.amira, { kind: "draft_monthly", caseId: MEHMET, month: "2027-01" });
    expect(r.status).toBe("succeeded");
    const ma = t.store.getRow("monthly_assessments", "ma-15934")!;
    for (const [k, a] of Object.entries(before.areas)) {
      const got = ma.areas[k];
      expect(got.level, k).toBe(a.level);
      expect(got.observation, k).toBe(a.observation);
      expect(got.aiLevelSuggestion, k).toBe(a.aiLevelSuggestion);
      expect(got.aiObservationDraft && { text: got.aiObservationDraft.text, sources: got.aiObservationDraft.sources, ne: !!got.aiObservationDraft.noEvidence }, k).toEqual(
        a.aiObservationDraft && { text: a.aiObservationDraft.text, sources: a.aiObservationDraft.sources, ne: !!a.aiObservationDraft.noEvidence },
      );
    }
    expect(ma.aiSummaryDraft).toBe(before.aiSummaryDraft);
    expect(ma.aiSummaryDraft).toBe("Under januari deltog deltagaren i 10 av 11 registrerade tillfällen. Inga arbetsgivarkontakter framgår. (Källa: 2 godkända avstämningar, 8 jan, 22 jan.)");
    expect(ma).toMatchObject({ status: "draft", summary: before.summary, overallStatus: before.overallStatus });
    const run = t.run(r.aiRunId);
    const out = run.output as MonthlyDraftOutput;
    expect(run).toMatchObject({ kind: "monthly_draft", caseId: MEHMET, inputRef: "2027-01", status: "succeeded" });
    expect(out.plan).toEqual(simulatedDraft(await monthlyDraftInput(t.sys, MEHMET, "2027-01"), "monthly_plan"));
    expect(out.assessmentId).toBe("ma-15934");
  });

  it("underlaget är bara godkända avstämningar i månaden och närvaro vid tillfällen som redan varit", async () => {
    const t = setup();
    const input = await monthlyDraftInput(t.sys, MEHMET, "2027-01");
    expect(input.checkIns.map((c) => c.status)).toEqual(["approved", "approved"]);
    expect(input.checkIns.every((c) => c.heldAt.startsWith("2027-01"))).toBe(true);
    expect(input.attendance).toHaveLength(11);
  });

  it("en godkänd månadsbedömning ändras inte; inget samtycke -> inget utkast", async () => {
    const t = setup();
    const approved = structuredClone(t.store.getRow("monthly_assessments", "ma-15931")!);
    const r = await enqueueVoiceJob(t.amira, { kind: "draft_monthly", caseId: MEHMET, month: "2026-12" });
    expect(r.status).toBe("succeeded");
    expect(t.store.getRow("monthly_assessments", "ma-15931")).toEqual(approved);
    expect((t.run(r.aiRunId).output as MonthlyDraftOutput).assessmentId).toBeNull();
    const r2 = await enqueueVoiceJob(t.amira, { kind: "draft_monthly", caseId: YUSUF, month: "2027-01" });
    expect(r2.error?.code).toBe("blocked_no_consent");
  });
});

describe("gallring", () => {
  it("ljud som inte transkriberats raderas senast efter 24 timmar – körningen avslutas som misslyckad", async () => {
    const t = setup({ jobs: true });
    const id = await t.upload(NADIA, "checkin", "u-amira");
    const r = await enqueueVoiceJob(t.amira, { kind: "transcribe_recording", uploadId: id, source: "recording" });
    await t.audio.mark(id, "failed");
    const fresh = await t.upload(NADIA, "checkin", "u-amira");
    t.setNow(addMinutes(DEMO_START, 23 * 60 - 1));
    expect(await retentionAudio(t.sys)).toBe("removed:0");
    t.setNow(addMinutes(DEMO_START, 23 * 60));
    expect(await retentionAudio(t.sys)).toBe("removed:2");
    expect(t.store.getRow("audio_uploads", id)).toMatchObject({ status: "deleted", deletedAt: addMinutes(DEMO_START, 23 * 60) });
    expect(t.store.getRow("audio_uploads", fresh)!.status).toBe("deleted");
    expect(t.run(r.aiRunId)).toMatchObject({ status: "failed", output: { error: "audio_expired" }, inputDeletedAt: addMinutes(DEMO_START, 23 * 60) });
    expect(t.audit("audio.deleted").filter((x) => x.entityId === id)).toHaveLength(1);
    // Redan raderade (testdatats spår) räknas inte igen
    expect(await retentionAudio(t.sys)).toBe("removed:0");
  });

  it("råtranskript: kvar i utkastet före sista dagen, raderat när avstämningen godkänts eller efter 30 dagar", async () => {
    const t = setup();
    expect(t.store.getRow("check_ins", "ci-11916")!.ai!.transcript.length).toBe(8);
    await retentionTranscripts(t.sys);
    expect(t.store.getRow("check_ins", "ci-11916")!.ai!.transcript.length).toBe(8);
    t.setNow("2027-02-28T13:00");
    expect(await retentionTranscripts(t.sys)).toBe("cleared:1");
    expect(t.store.getRow("check_ins", "ci-11916")!.ai).toMatchObject({ transcript: [], rawTranscriptDeletedAt: "2027-02-28T13:00" });
    expect(t.audit("transcript.deleted").at(-1)).toMatchObject({ entityId: "ci-11916", details: { reason: "Gallring efter 30 dagar" } });

    // En ny inspelning: transkriptet i körningen raderas när avstämningen godkänts
    const t2 = setup();
    const id = await t2.upload(NADIA, "checkin", "u-amira");
    const any = t2.store.rows("check_ins").find((c) => c.caseId === NADIA)!;
    t2.store.insertRow("check_ins", { ...any, id: "ci-t", status: "draft", approvedBy: null, approvedAt: null, aiRunId: null, ai: null });
    const r = await enqueueVoiceJob(t2.amira, { kind: "transcribe_recording", uploadId: id, source: "recording", checkInId: "ci-t" });
    t2.store.updateRow("check_ins", "ci-t", { status: "approved" });
    expect(await retentionTranscripts(t2.sys)).toBe("cleared:2");
    expect(t2.store.getRow("check_ins", "ci-t")!.ai!.transcript).toEqual([]);
    expect((t2.run(r.aiRunId).output as CheckInAiOutput).transcript).toEqual([]);
    // Förslagen finns kvar – bara råtranskriptet raderas
    expect((t2.run(r.aiRunId).output as CheckInAiOutput).suggestions.goalStatus.quote.length).toBeGreaterThan(0);
  });

  it("kommunens dikterade text raderas efter 24 timmar", async () => {
    const t = setup();
    const maria = t.ctxFor(t.actor("k-maria", "kommun_handlaggare"));
    const id = await t.upload(null, "dictation", "k-maria", 20);
    const r = await enqueueVoiceJob(maria, { kind: "transcribe_dictation", uploadId: id, contractId: "c-bot" });
    t.setNow(addMinutes(DEMO_START, 24 * 60 - 1));
    await retentionTranscripts(t.sys);
    expect((t.run(r.aiRunId).output as { text: string }).text.length).toBeGreaterThan(0);
    t.setNow(addMinutes(DEMO_START, 24 * 60));
    await retentionTranscripts(t.sys);
    expect(t.run(r.aiRunId).output).toEqual({ text: null, clearedAt: addMinutes(DEMO_START, 24 * 60) });
    expect((await ownDictation(maria, r.aiRunId))?.text).toBeNull();
  });
});

describe("fel", () => {
  it("leverantörens fel översätts till fasta texter; mätvärden följer med", () => {
    const run: AiRunMeta = { provider: "vertex_eu", model: "m", latencyMs: 5, tokensIn: 10, tokensOut: 2, audioSeconds: null, costOre: 1 };
    expect(toVoiceJobError(Object.assign(new Error("x"), { code: "invalid_response", retryable: false, run }))).toMatchObject({ code: "invalid_response", retryable: false, runs: [run] });
    expect(toVoiceJobError(Object.assign(new Error("x"), { code: "unavailable", retryable: true }))).toMatchObject({ code: "provider_unavailable", retryable: true });
    expect(toVoiceJobError(new TypeError("Nadia Hassan"))).toMatchObject({ code: "unexpected", message: "Något gick fel i AI-körningen. Fyll i formuläret själv eller försök igen." });
  });
});
