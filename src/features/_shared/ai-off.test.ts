// AI av i produktion (beslut 2026-10-08): utan MM_AI_PROVIDER saknas ctx.ai. Då visar inspelning, diktering, AI-förslag och
// AI-utkast klartext ("Tal till text är inte kopplat ännu – skriv själv så länge"), inget kraschar och ingen simulerad text
// lämnas ut. Ctx byggs som servern gör (liveCtx utan ai) mot testdatat i minnet.
import { describe, expect, it } from "vitest";
import { execute } from "@/api/handlers";
import { ApiError } from "@/api/server";
import { SYSTEM_ACTOR, type Actor } from "@/api/roles";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed } from "@/data/seed";
import type { AppRepo, Tables } from "@/data/schema";
import { liveCtx } from "@/server/ctx";
import { adminIntegrations } from "@/features/admin/api";
import { aiRun, assessmentPage, checkInPage, monthlyDraft } from "@/features/coach/api";
import { dictationOptions } from "@/features/kommun/api";
import { caseVoice, linkSend, uploadStart } from "@/features/rost/api";
import { AI_OFF_LINK_TEXT, AI_OFF_TEXT } from "./ai-port";
import { createSimulatedAi } from "./ai-sim";

const AMIRA: Actor = { userId: "u-amira", role: "coach", contractIds: ["c-bot"], customerUnit: null };
const MARIA: Actor = { userId: "k-maria", role: "kommun_handlaggare", contractIds: ["c-bot"], customerUnit: "Arbetsmarknadsenheten Alby" };
const ROBIN: Actor = { userId: "u-robin", role: "admin", contractIds: ["c-bot"], customerUnit: null };
const NADIA = "case-260143";

function ctxFor(actor: Actor, withAi = false) {
  const store = new MemoryStore<Tables>(createSeed());
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  const repo = new MemoryRepo<Tables>(store, actor, POLICIES) as unknown as AppRepo;
  let n = 0;
  return liveCtx({ actor, now: "2027-02-01T09:40", repo, system, enqueue: async () => undefined, newId: (p) => `${p}-${++n}`, ...(withAi ? { ai: createSimulatedAi() } : {}) });
}
const run = (ctx: ReturnType<typeof ctxFor>, kind: "query" | "command", key: string, input: unknown) => execute(kind, key, input, ctx);

describe("AI av: klartext och den manuella vägen", () => {
  it("avstämningen: inspelningen är blockerad med texten, oavsett samtycke", async () => {
    const page = (await run(ctxFor(AMIRA), "query", checkInPage.key, { caseId: NADIA })) as { kind: string; recording: { allowed: boolean; block: string | null; blockText: string | null } };
    expect(page.kind).toBe("ok");
    expect(page.recording).toMatchObject({ allowed: false, block: "ai_off", blockText: AI_OFF_TEXT });
    // Med leverantör (testmiljön, minnesläget): som förut.
    const on = (await run(ctxFor(AMIRA, true), "query", checkInPage.key, { caseId: NADIA })) as { recording: { block: string | null } };
    expect(on.recording.block).not.toBe("ai_off");
  });

  it("coach.aiRun ger aldrig simulerad text utan leverantör", async () => {
    const res = await run(ctxFor(AMIRA), "command", aiRun.key, { caseId: NADIA, kind: "extract_notes", source: "notes", notesText: "Stödord från mötet som räcker.", audioSeconds: 0, costOre: 4 });
    expect(res).toMatchObject({ ok: false, error: "ai_unavailable", message: AI_OFF_TEXT });
    const on = (await run(ctxFor(AMIRA, true), "command", aiRun.key, { caseId: NADIA, kind: "extract_notes", source: "notes", notesText: "Stödord från mötet som räcker.", audioSeconds: 0, costOre: 4 })) as { ok: boolean };
    expect(on.ok).toBe(true);
  });

  it("månadsbedömningen: aiOff i vyn och AI-utkastet stoppas med texten", async () => {
    const page = (await run(ctxFor(AMIRA), "query", assessmentPage.key, { caseId: NADIA, month: "2027-01" })) as { kind: string; aiOff?: boolean };
    expect(page.kind).toBe("ok");
    expect(page.aiOff).toBe(true);
    const on = (await run(ctxFor(AMIRA, true), "query", assessmentPage.key, { caseId: NADIA, month: "2027-01" })) as { aiOff?: boolean };
    expect(on.aiOff).toBe(false);
    const err = await run(ctxFor(AMIRA), "command", monthlyDraft.key, { caseId: NADIA, month: "2027-01" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe(AI_OFF_TEXT);
  });

  it("kommunens Tala in är av med texten; inspelningslänkar kan inte skickas", async () => {
    expect(await run(ctxFor(MARIA), "query", dictationOptions.key, {})).toEqual({ enabled: false, maxMinutes: 0, reason: AI_OFF_TEXT });
    expect(await run(ctxFor(MARIA, true), "query", dictationOptions.key, {})).toMatchObject({ enabled: true });
    const voice = (await run(ctxFor(AMIRA), "query", caseVoice.key, { caseId: NADIA })) as { send: { allowed: boolean; reason: string | null } };
    expect(voice.send).toMatchObject({ allowed: false, reason: AI_OFF_LINK_TEXT });
    expect(await run(ctxFor(AMIRA), "command", linkSend.key, { caseId: NADIA, language: "sv" })).toMatchObject({ ok: false, error: "disabled", message: AI_OFF_LINK_TEXT });
    expect(await run(ctxFor(AMIRA), "command", uploadStart.key, { purpose: "checkin", caseId: NADIA, mimeType: "audio/webm", bytes: 4000, durationSec: 30 })).toMatchObject({ ok: false, error: "ai_unavailable", message: AI_OFF_TEXT });
  });

  it("integrationskortet AI säger Inte kopplad utan leverantör och I test med den simulerade", async () => {
    const off = (await run(ctxFor(ROBIN), "query", adminIntegrations.key, {})) as { integrations: { id: string; status: string; items: [string, string][] }[] };
    const card = off.integrations.find((i) => i.id === "ai")!;
    expect(card.status).toBe("off");
    expect(card.items.some(([k, v]) => k === "Läge" && /Inte kopplad/.test(v))).toBe(true);
    expect(JSON.stringify(off)).not.toMatch(/Simulerad leverantör/);
    const test = (await run(ctxFor(ROBIN, true), "query", adminIntegrations.key, {})) as { integrations: { id: string; status: string; items: [string, string][] }[] };
    expect(test.integrations.find((i) => i.id === "ai")).toMatchObject({ status: "test" });
  });
});
