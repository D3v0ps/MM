// POST /api/audio/upload-url: bara supabase-läget, inloggning för coachen och kommunen, röstlänken för deltagaren och
// samma kontroller som kommandona (startAudioUpload). Sessionen och Ctx fejkas med testdatat i minnet.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_ACTOR, type Actor } from "@/api/roles";
import type { Ctx } from "@/api/server";
import { personaFor } from "@/data/actors";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START } from "@/data/seed";
import { TEST_PNR_CRYPTO } from "@/data/seed/pnr";
import type { AppRepo, Tables } from "@/data/schema";
import { createSimulatedAi } from "@/features/_shared/ai-sim";
import { createMemoryAudio } from "@/features/_shared/audio-port";

const state: { backend: "memory" | "supabase"; session: { authUserId: string | null; identity: { persona: { actor: Actor } } | null }; ctx: Ctx | null } = {
  backend: "supabase",
  session: { authUserId: null, identity: null },
  ctx: null,
};
vi.mock("@/server/config", () => ({ backend: () => state.backend }));
vi.mock("@/server/live", () => ({ liveSession: async () => state.session, ctxFor: () => state.ctx }));
const { POST } = await import("./route");

const PARTICIPANT: Actor = { userId: "deltagare", role: "deltagare", contractIds: [], customerUnit: null };
function memoryCtx(store: MemoryStore<Tables>, a: Actor): Ctx {
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  let n = 0;
  const newId = (p: string) => `${p}-${++n}`;
  const now = () => DEMO_START;
  return {
    actor: a, now, repo: new MemoryRepo<Tables>(store, a, POLICIES) as unknown as AppRepo, system, newId, audit: async () => undefined, notify: async () => undefined,
    crypto: TEST_PNR_CRYPTO, ai: createSimulatedAi(), audio: createMemoryAudio({ system, now, newId }),
  };
}
const post = (body: unknown) => POST(new Request("http://localhost/api/audio/upload-url", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("POST /api/audio/upload-url", () => {
  let store: MemoryStore<Tables>;
  beforeEach(() => {
    store = new MemoryStore<Tables>(createSeed());
    state.backend = "supabase";
    state.session = { authUserId: null, identity: null };
    state.ctx = memoryCtx(store, PARTICIPANT);
  });

  it("bara i supabase-läget; ogiltig begäran stoppas", async () => {
    state.backend = "memory";
    expect((await post({ purpose: "participant", mimeType: "audio/webm" })).status).toBe(404);
    state.backend = "supabase";
    expect((await post("{inte json")).status).toBe(400);
    expect((await post({ purpose: "video", mimeType: "audio/webm" })).status).toBe(400);
    expect((await post({ purpose: "participant", mimeType: "audio/webm", extra: 1 })).status).toBe(400);
  });

  it("coachen och kommunen måste vara inloggade; inloggad utan profil får inte komma åt", async () => {
    const r = await post({ purpose: "checkin", caseId: "case-260143", mimeType: "audio/webm" });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ ok: false, error: "unauthenticated", message: "Du är inte inloggad." });
    state.session = { authUserId: "auth-1", identity: null };
    expect((await post({ purpose: "participant", mimeType: "audio/webm" })).status).toBe(403);
  });

  it("inloggad coach: signerad adress (här minnets null) och samma kontroller som kommandot", async () => {
    const amira = personaFor(store.raw(), "u-amira", "coach")!.actor;
    state.session = { authUserId: "auth-amira", identity: { persona: { actor: amira } } };
    state.ctx = memoryCtx(store, amira);
    const ok = await post({ purpose: "checkin", caseId: "case-260143", mimeType: "audio/webm;codecs=opus" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, maxMinutes: 60, ticket: { storagePath: expect.stringMatching(/^checkin\/aud-\d+\.webm$/) } });
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const noConsent = await post({ purpose: "checkin", caseId: "case-260148", mimeType: "audio/webm" });
    expect(noConsent.status).toBe(403);
    expect(await noConsent.json()).toMatchObject({ ok: false, error: "no_consent" });
  });

  it("deltagaren utan inloggning: giltig länk ger en uppladdning, använd länk stoppas", async () => {
    const ok = await post({ purpose: "participant", mimeType: "audio/mp4" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, languages: ["sv", "en", "ar", "so"], ticket: { storagePath: expect.stringMatching(/^participant\/aud-\d+\.m4a$/) } });
    const used = await post({ purpose: "participant", token: "testdata-vl-nadia", mimeType: "audio/mp4" });
    expect(used.status).toBe(400);
    expect(await used.json()).toMatchObject({ ok: false, error: "link_used" });
  });
});
