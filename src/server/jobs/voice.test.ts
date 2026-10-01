// Röstjobben i jobbkörningen (runner.ts + voice.ts) mot testdatat i minnet: köade jobb körs, tillfälliga fel försöks igen
// med väntetid, jobbet ger upp efter max antal försök (AI-körningen markeras då som misslyckad med mätvärdena),
// fel som inte är värda att försöka igen stoppas direkt, och gallringsjobben läggs en gång per timme.
import { describe, expect, it } from "vitest";
import { SYSTEM_ACTOR, type Actor } from "@/api/roles";
import type { Ctx } from "@/api/server";
import { addMinutes, type LocalDateTime } from "@/core/time";
import { personaFor } from "@/data/actors";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import type { Repo } from "@/data/repo";
import { createSeed, DEMO_START } from "@/data/seed";
import { TEST_PNR_CRYPTO } from "@/data/seed/pnr";
import { DataError } from "@/data/supabase/repo";
import type { AppRepo, Job, Tables } from "@/data/schema";
import type { AiPort } from "@/features/_shared/ai-port";
import { createSimulatedAi } from "@/features/_shared/ai-sim";
import { createMemoryAudio } from "@/features/_shared/audio-port";
import { enqueueVoiceJob, VOICE_JOB_KINDS, type CtxWithJobs } from "@/features/_shared/voice-jobs";
import { JOB_HANDLERS, type JobDeps } from "./registry";
import { MAX_ATTEMPTS, runJobs, type JobStore } from "./runner";
import { ensureRetentionJobs, retentionJobId } from "./voice";

const NADIA = "case-260143";

function setup(ai: AiPort = createSimulatedAi()) {
  const store = new MemoryStore<Tables>(createSeed());
  let seq = 0;
  const newId = (p: string) => `${p}-t${String(++seq).padStart(4, "0")}`;
  let clock: LocalDateTime = DEMO_START;
  const now = () => clock;
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  const audio = createMemoryAudio({ system, now, newId });
  const ctxFor = (a: Actor): CtxWithJobs => ({
    actor: a, now, repo: new MemoryRepo<Tables>(store, a, POLICIES) as unknown as AppRepo, system, newId,
    audit: async (e) => {
      await system.table("audit_log").insert({ id: newId("log"), occurredAt: now(), actorId: a.userId, action: e.action, entity: e.entity, entityId: e.entityId, contractId: e.contractId ?? null, details: e.details ?? {} });
    },
    notify: async () => undefined, crypto: TEST_PNR_CRYPTO, ai, audio, jobs: { schedule: () => undefined },
  });
  const amira = ctxFor(personaFor(store.raw(), "u-amira", "coach")!.actor);
  const voice: Ctx = ctxFor(SYSTEM_ACTOR);
  // JobStore i minnet: samma regler som mm.claim_jobs (queued, run_after passerad, färre än max försök).
  const jobStore: JobStore = {
    async claim(n, at, max) {
      const due = store.rows("jobs").filter((j) => j.status === "queued" && j.runAfter <= at && j.attempts < max).sort((a, b) => (a.runAfter + a.id < b.runAfter + b.id ? -1 : 1)).slice(0, n);
      return due.map((j) => store.updateRow("jobs", j.id, { status: "running", attempts: j.attempts + 1, startedAt: at }));
    },
    async finish(id, patch) {
      store.updateRow("jobs", id, patch);
    },
  };
  const deps = { voice: () => voice } as unknown as JobDeps;
  const run = (at: LocalDateTime) => {
    clock = at;
    return runJobs({ store: jobStore, handlers: JOB_HANDLERS, ctx: deps, now: at, sleep: async () => undefined });
  };
  async function recording() {
    const t = await audio.createUpload({ caseId: NADIA, ownerId: "u-amira", purpose: "checkin", mimeType: "audio/webm", durationSec: 900 });
    await audio.confirm(t.uploadId);
    return t.uploadId;
  }
  return { store, system, amira, run, recording, deps, jobStore };
}

describe("röstjobben i jobbkörningen", () => {
  it("alla röstjobb är registrerade bredvid send_message", () => {
    expect(Object.keys(JOB_HANDLERS).sort()).toEqual(["send_message", "report_schedule", ...VOICE_JOB_KINDS].sort());
  });

  it("ett köat transkriberingsjobb körs och blir klart", async () => {
    const t = setup();
    const id = await t.recording();
    const r = await enqueueVoiceJob(t.amira, { kind: "transcribe_recording", uploadId: id, source: "recording" });
    const sum = await t.run(DEMO_START);
    expect(sum).toMatchObject({ claimed: 1, done: 1, failed: 0, outcomes: { "transcribe_recording:succeeded": 1 } });
    expect(t.store.getRow("jobs", r.jobId)).toMatchObject({ status: "done", attempts: 1, lastError: null });
    expect(t.store.getRow("ai_runs", r.aiRunId)!.status).toBe("succeeded");
  });

  it("tillfälligt fel hos leverantören: nya försök med väntetid, sedan ger jobbet upp – körningen misslyckad, ljudet redan raderat", async () => {
    const sim = createSimulatedAi();
    const down: AiPort = {
      ...sim, provider: sim.provider, model: sim.model,
      extract: async () => {
        throw Object.assign(new Error("x"), { code: "unavailable", retryable: true, run: { provider: "simulated", model: "simulerad", latencyMs: 90_000, tokensIn: null, tokensOut: null, audioSeconds: null, costOre: 0 } });
      },
    };
    const t = setup(down);
    const id = await t.recording();
    const r = await enqueueVoiceJob(t.amira, { kind: "transcribe_recording", uploadId: id, source: "recording" });
    let at: LocalDateTime = DEMO_START;
    expect(await t.run(at)).toMatchObject({ retried: 1 });
    expect(t.store.getRow("jobs", r.jobId)).toMatchObject({ status: "queued", attempts: 1, lastError: "AI-tjänsten svarar inte just nu. Försök igen om en stund.", runAfter: addMinutes(at, 1) });
    expect(t.store.getRow("ai_runs", r.aiRunId)!.status).toBe("running");
    expect(t.store.getRow("audio_uploads", id)!.status).toBe("deleted");
    for (let i = 2; i <= MAX_ATTEMPTS; i++) {
      at = t.store.getRow("jobs", r.jobId)!.runAfter;
      await t.run(at);
    }
    expect(t.store.getRow("jobs", r.jobId)).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    const run = t.store.getRow("ai_runs", r.aiRunId)!;
    expect(run).toMatchObject({ status: "failed", output: { error: "provider_unavailable" } });
    // Transkriberingen (900 s ljud) och det sista misslyckade anropet räknas
    expect(run.audioSeconds).toBe(900);
    expect(run.latencyMs).toBeGreaterThan(90_000);
    expect(t.store.rows("audit_log").filter((x) => x.action === "ai.run_failed" && x.entityId === run.id)).toHaveLength(1);
  });

  it("fel som inte är värda att försöka igen (återkallat samtycke) stoppar jobbet direkt", async () => {
    const t = setup();
    const id = await t.recording();
    const r = await enqueueVoiceJob(t.amira, { kind: "transcribe_recording", uploadId: id, source: "recording" });
    t.store.updateRow("cases", NADIA, { aiConsentStatus: "revoked" });
    expect(await t.run(DEMO_START)).toMatchObject({ failed: 1, retried: 0 });
    expect(t.store.getRow("jobs", r.jobId)).toMatchObject({ status: "failed", attempts: 1, lastError: "Deltagaren har inte gett sitt samtycke till inspelning. Fyll i formuläret själv." });
    expect(t.store.getRow("ai_runs", r.aiRunId)).toMatchObject({ status: "failed", output: { error: "blocked_no_consent" } });
    expect(t.store.getRow("audio_uploads", id)!.status).toBe("deleted");
  });

  it("deltagarens inspelning: när jobbet ger upp går länken att använda igen (usedAt = null, loggas en gång)", async () => {
    const sim = createSimulatedAi();
    const broken: AiPort = {
      ...sim, provider: sim.provider, model: sim.model,
      transcribe: async () => {
        throw Object.assign(new Error("x"), { code: "invalid_response", retryable: false });
      },
    };
    const t = setup(broken);
    const AMAL = "case-270012";
    const deltagare = { userId: "deltagare", role: "deltagare", contractIds: [], customerUnit: null } as Actor;
    const audio = createMemoryAudio({ system: t.system, now: () => DEMO_START, newId: (p) => `${p}-d1` });
    const up = await audio.createUpload({ caseId: AMAL, ownerId: "deltagare", purpose: "participant", mimeType: "audio/webm", durationSec: 40 });
    await audio.confirm(up.uploadId);
    const ctx: CtxWithJobs = { ...t.amira, actor: deltagare };
    const r = await enqueueVoiceJob(ctx, { kind: "transcribe_participant", uploadId: up.uploadId, linkId: "vl-demo", language: "ar", consentTextVersion: "röst-v1.0 (2026-09-30)", consentGivenAt: DEMO_START });
    // rost.send förbrukar länken när jobbet läggs (supabase-läget)
    t.store.updateRow("voice_links", "vl-demo", { usedAt: DEMO_START });
    expect(await t.run(DEMO_START)).toMatchObject({ failed: 1, retried: 0 });
    expect(t.store.getRow("ai_runs", r.aiRunId)).toMatchObject({ status: "failed", output: { error: "invalid_response" } });
    expect(t.store.getRow("voice_links", "vl-demo")!.usedAt).toBeNull();
    expect(t.store.rows("participant_voice_notes").filter((n) => n.linkId === "vl-demo")).toHaveLength(0);
    const reopened = t.store.rows("audit_log").filter((x) => x.action === "voice.link_reopened");
    expect(reopened).toHaveLength(1);
    expect(reopened[0]).toMatchObject({ entity: "voice_link", entityId: "vl-demo", contractId: "c-bot", details: { caseId: AMAL, aiRunId: r.aiRunId, code: "invalid_response" } });
  });

  it("utan röstjobbens Ctx stoppas jobbet utan nya försök", async () => {
    const t = setup();
    const id = await t.recording();
    const r = await enqueueVoiceJob(t.amira, { kind: "transcribe_recording", uploadId: id, source: "recording" });
    const sum = await runJobs({ store: t.jobStore, handlers: JOB_HANDLERS, ctx: {} as JobDeps, now: DEMO_START, sleep: async () => undefined });
    expect(sum.failed).toBe(1);
    expect(t.store.getRow("jobs", r.jobId)!.lastError).toBe("Röstjobb kan inte köras här");
  });
});

describe("ensureRetentionJobs", () => {
  it("gallringen läggs en gång per timme och körs av jobbkörningen", async () => {
    const t = setup();
    const repo = t.system as unknown as Repo<{ jobs: Job }>;
    expect(await ensureRetentionJobs(repo, DEMO_START)).toBe(2);
    expect(await ensureRetentionJobs(repo, "2027-02-01T09:59")).toBe(0);
    expect(t.store.getRow("jobs", retentionJobId("retention_audio", DEMO_START))).toMatchObject({ id: "job-retention_audio-2027-02-01T09", status: "queued", payload: {} });
    expect(await t.run(DEMO_START)).toMatchObject({ done: 2, outcomes: { "retention_audio:removed:0": 1, "retention_transcripts:cleared:0": 1 } });
    expect(await ensureRetentionJobs(repo, "2027-02-01T10:00")).toBe(2);
  });

  it("två samtidiga körningar: dubblettfelet från databasen ignoreras", async () => {
    const jobs = { get: async () => null, insert: async () => { throw new DataError("jobs", "23505"); } };
    expect(await ensureRetentionJobs({ table: () => jobs } as unknown as Repo<{ jobs: Job }>, DEMO_START)).toBe(0);
    const other = { get: async () => null, insert: async () => { throw new DataError("jobs", "42501"); } };
    await expect(ensureRetentionJobs({ table: () => other } as unknown as Repo<{ jobs: Job }>, DEMO_START)).rejects.toBeInstanceOf(DataError);
  });
});
