// Ctx i supabase-läget med röstinspelningens portar: ai, audio (byggd med förfrågans system, klocka och id) och jobbkön
// (after() begärs högst en gång per förfrågan). Utan portarna ser Ctx ut som förut.
import { describe, expect, it, vi } from "vitest";
import { SYSTEM_ACTOR, type Actor } from "@/api/roles";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed } from "@/data/seed";
import type { AppRepo, Tables } from "@/data/schema";
import { createSimulatedAi } from "@/features/_shared/ai-sim";
import { createMemoryAudio } from "@/features/_shared/audio-port";
import { enqueueVoiceJob } from "@/features/_shared/voice-jobs";
import { execute } from "@/api/handlers";
import { linkSend } from "@/features/rost/api";
import { createMemoryRuntime, demoClock } from "@/data/memory-runtime";
import { liveCtx } from "./ctx";

const AMIRA: Actor = { userId: "u-amira", role: "coach", contractIds: ["c-bot"], customerUnit: null };

describe("liveCtx med röstinspelningens portar", () => {
  it("ai och audio kopplas in; ljudlagringen får förfrågans system, klocka och id; jobben körs med after() en gång", async () => {
    const store = new MemoryStore<Tables>(createSeed());
    const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
    const repo = new MemoryRepo<Tables>(store, AMIRA, POLICIES) as unknown as AppRepo;
    const ai = createSimulatedAi();
    const scheduleJobs = vi.fn();
    let n = 0;
    const audioDeps: unknown[] = [];
    const ctx = liveCtx({
      actor: AMIRA, now: "2027-02-01T09:40", repo, system, enqueue: async () => undefined, newId: (p) => `${p}-${++n}`, ai, scheduleJobs,
      audio: (d) => {
        audioDeps.push(d);
        return createMemoryAudio(d);
      },
    });
    expect(ctx.ai).toBe(ai);
    expect(audioDeps).toHaveLength(1);
    expect((audioDeps[0] as { system: unknown }).system).toBe(system);
    const t = await ctx.audio!.createUpload({ caseId: "case-260143", ownerId: "u-amira", purpose: "checkin", mimeType: "audio/webm" });
    expect(store.getRow("audio_uploads", t.uploadId)).toMatchObject({ id: "aud-1", createdAt: "2027-02-01T09:40", status: "pending" });
    await ctx.audio!.confirm(t.uploadId);
    const a = await enqueueVoiceJob(ctx, { kind: "transcribe_recording", uploadId: t.uploadId, source: "recording" });
    const b = await enqueueVoiceJob(ctx, { kind: "draft_monthly", caseId: "case-260130", month: "2027-01" });
    expect([a.status, b.status]).toEqual(["running", "running"]);
    expect(store.getRow("jobs", a.jobId)!.status).toBe("queued");
    expect(scheduleJobs).toHaveBeenCalledTimes(1);
  });

  it("utan portarna: inga fält ai, audio eller jobs (AI avstängd – den manuella vägen gäller)", () => {
    const store = new MemoryStore<Tables>(createSeed());
    const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
    const ctx = liveCtx({ actor: AMIRA, now: "2027-02-01T09:40", repo: system, system, enqueue: async () => undefined });
    expect("ai" in ctx).toBe(false);
    expect("audio" in ctx).toBe(false);
    expect("jobs" in ctx).toBe(false);
  });
});

describe("rost.linkSend lämnar aldrig ut länken från servern", () => {
  it("supabase-läget (liveCtx): sökvägen med token är null; utskicket har länken. Minnesläget (prototypen): sökvägen finns", async () => {
    const store = new MemoryStore<Tables>(createSeed());
    const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
    const repo = new MemoryRepo<Tables>(store, AMIRA, POLICIES) as unknown as AppRepo;
    const sent: string[] = [];
    let n = 0;
    const ctx = liveCtx({ actor: AMIRA, now: "2027-02-01T09:40", repo, system, enqueue: async (_s, m) => void sent.push(m.body), newId: (p) => `${p}-${++n}abcdefgh` });
    expect("exposeLinkPaths" in ctx).toBe(false);
    const res = (await execute("command", linkSend.key, { caseId: "case-260143", language: "sv" }, ctx)) as { ok: boolean; path?: string | null; linkId?: string };
    expect(res).toMatchObject({ ok: true, path: null });
    expect(JSON.stringify(res)).not.toContain("/rost/");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/\/rost\/[A-Za-z0-9_-]{8,}$/);

    const rt = createMemoryRuntime({ data: createSeed(), clock: demoClock("2027-02-01T09:12") });
    const mem = (await rt.run("command", linkSend.key, { caseId: "case-260143", language: "sv" }, AMIRA)) as { ok: boolean; path: string | null };
    expect(mem.path).toMatch(/^\/rost\/[A-Za-z0-9_-]{8,}$/);
  });
});
