// Vem får spela in vad (voice-upload.ts) – samma kontroller i kommandona och i POST /api/audio/upload-url.
// Mot testdatat i minnet med policyn (samma regler som RLS), den simulerade AI:n och ljudet i minnet.
import { describe, expect, it, vi } from "vitest";
import { SYSTEM_ACTOR, type Actor } from "@/api/roles";
import type { Ctx } from "@/api/server";
import { addDays, type LocalDateTime } from "@/core/time";
import { personaFor } from "@/data/actors";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START } from "@/data/seed";
import { TEST_PNR_CRYPTO } from "@/data/seed/pnr";
import type { AppRepo, Tables } from "@/data/schema";
import { createSimulatedAi } from "./ai-sim";
import { createMemoryAudio } from "./audio-port";
import { AUDIO_UPLOAD_ERROR_TEXT, confirmOwnUpload, MAX_UPLOADS_PER_LINK, startAudioUpload, voiceLinkByToken, voiceTokenHash } from "./voice-upload";

const NADIA = "case-260143";
const YUSUF = "case-260148";
const AMAL = "case-270012";
const SKYDDAD = "case-260120";
const PARTICIPANT: Actor = { userId: "deltagare", role: "deltagare", contractIds: [], customerUnit: null };

function setup(o: { noAi?: boolean } = {}) {
  const store = new MemoryStore<Tables>(createSeed());
  let seq = 0;
  const newId = (p: string) => `${p}-t${String(++seq).padStart(4, "0")}`;
  let clock: LocalDateTime = DEMO_START;
  const now = () => clock;
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  const audio = createMemoryAudio({ system, now, newId });
  const ctxAs = (a: Actor): Ctx => ({
    actor: a, now, repo: new MemoryRepo<Tables>(store, a, POLICIES) as unknown as AppRepo, system, newId,
    audit: async (e) => {
      await system.table("audit_log").insert({ id: newId("log"), occurredAt: now(), actorId: a.userId, action: e.action, entity: e.entity, entityId: e.entityId, contractId: e.contractId ?? null, details: e.details ?? {} });
    },
    notify: async () => undefined, crypto: TEST_PNR_CRYPTO, ...(o.noAi ? {} : { ai: createSimulatedAi() }), audio,
  });
  const as = (userId: string, role: Actor["role"]) => ctxAs(personaFor(store.raw(), userId, role)!.actor);
  return { store, audio, ctxAs, as, setNow: (t: LocalDateTime) => (clock = t) };
}
const webm = { mimeType: "audio/webm;codecs=opus" };
/** Den vilande spärren (beslut 2026-10-07): personen i SKYDDAD får skyddade personuppgifter – testdatat har inga. */
const protect = (t: ReturnType<typeof setup>) => t.store.updateRow("persons", t.store.getRow("cases", SKYDDAD)!.personId, { protectedIdentity: true });

describe("startAudioUpload", () => {
  it("coachen i sitt ärende med samtycke: rad i audio_uploads (pending), ingen adress i minnesläget, maxlängd ur avtalet, revisionslogg", async () => {
    const t = setup();
    const r = await startAudioUpload(t.as("u-amira", "coach"), { purpose: "checkin", caseId: NADIA, ...webm });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ maxMinutes: 60, languages: ["sv"], ticket: { uploadUrl: null, token: null, expiresAt: null, maxBytes: 25 * 1024 * 1024 } });
    expect(r.ticket.storagePath).toBe(`checkin/${r.ticket.uploadId}.webm`);
    expect(t.store.getRow("audio_uploads", r.ticket.uploadId)).toMatchObject({ caseId: NADIA, ownerId: "u-amira", purpose: "checkin", mimeType: "audio/webm", status: "pending", createdAt: DEMO_START });
    expect(t.store.rows("audit_log").at(-1)).toMatchObject({ action: "audio.upload_started", entityId: r.ticket.uploadId, actorId: "u-amira", contractId: "c-bot", details: { purpose: "checkin", caseId: NADIA } });
  });

  it("coachen: inget samtycke, skyddade personuppgifter, någon annans ärende och fel roll stoppas", async () => {
    const t = setup();
    const amira = t.as("u-amira", "coach");
    expect(await startAudioUpload(amira, { purpose: "checkin", caseId: YUSUF, ...webm })).toMatchObject({ ok: false, error: "no_consent" });
    protect(t);
    expect(await startAudioUpload(t.as("u-erik", "coach"), { purpose: "checkin", caseId: SKYDDAD, ...webm })).toMatchObject({ ok: false, error: "protected" });
    // Ärenden som coachen inte har: finns inte (policyn) eller inte hennes
    const other = t.store.rows("cases").find((c) => c.leadCoachId && c.leadCoachId !== "u-amira" && c.contractId === "c-bot" && c.id !== SKYDDAD)!;
    expect((await startAudioUpload(amira, { purpose: "checkin", caseId: other.id, ...webm })).ok).toBe(false);
    expect(await startAudioUpload(t.as("k-maria", "kommun_handlaggare"), { purpose: "checkin", caseId: NADIA, ...webm })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await startAudioUpload(amira, { purpose: "checkin", caseId: NADIA, mimeType: "video/mp4" })).toMatchObject({ ok: false, error: "audio_type" });
    expect(await startAudioUpload(amira, { purpose: "checkin", caseId: NADIA, ...webm, bytes: 26 * 1024 * 1024 })).toMatchObject({ ok: false, error: "audio_size" });
    expect(await startAudioUpload(amira, { purpose: "checkin", caseId: NADIA, ...webm, durationSec: 61 * 60 })).toMatchObject({ ok: false, error: "too_long" });
    expect(t.store.rows("audio_uploads").filter((u) => u.status === "pending")).toHaveLength(0);
  });

  it("utan AI tas ingen fil emot (den manuella vägen gäller)", async () => {
    const t = setup({ noAi: true });
    expect(await startAudioUpload(t.as("u-amira", "coach"), { purpose: "checkin", caseId: NADIA, ...webm })).toMatchObject({ ok: false, error: "ai_unavailable" });
  });

  it("kommunens handläggare: ny beställning (avtalet ur medlemskapet) och eget ärende – aldrig skyddade", async () => {
    const t = setup();
    const maria = t.as("k-maria", "kommun_handlaggare");
    const r = await startAudioUpload(maria, { purpose: "dictation", ...webm });
    expect(r).toMatchObject({ ok: true, maxMinutes: 5 });
    if (r.ok) expect(t.store.getRow("audio_uploads", r.ticket.uploadId)).toMatchObject({ caseId: null, ownerId: "k-maria", purpose: "dictation" });
    expect(await startAudioUpload(maria, { purpose: "dictation", ...webm, protectedOrder: true })).toMatchObject({ ok: false, error: "protected" });
    expect(await startAudioUpload(maria, { purpose: "dictation", caseId: NADIA, ...webm })).toMatchObject({ ok: true });
    expect(await startAudioUpload(maria, { purpose: "dictation", contractId: "c-ny", ...webm })).toMatchObject({ ok: false, error: "forbidden" });
    // Omars ärende med skyddade personuppgifter (vilande spärr påslagen)
    protect(t);
    expect(await startAudioUpload(t.as("k-omar", "kommun_handlaggare"), { purpose: "dictation", caseId: SKYDDAD, ...webm })).toMatchObject({ ok: false, error: "protected" });
    // Någon annans ärende syns inte
    expect((await startAudioUpload(t.as("k-omar", "kommun_handlaggare"), { purpose: "dictation", caseId: NADIA, ...webm })).ok).toBe(false);
  });

  it("deltagaren: exempellänken (utan token) öppen; testdatats använda länkar och påhittade token stoppas", async () => {
    const t = setup();
    const p = t.ctxAs(PARTICIPANT);
    const r = await startAudioUpload(p, { purpose: "participant", ...webm });
    expect(r).toMatchObject({ ok: true, maxMinutes: 5, languages: ["sv", "en", "ar", "so"] });
    if (r.ok) expect(t.store.getRow("audio_uploads", r.ticket.uploadId)).toMatchObject({ caseId: AMAL, ownerId: "deltagare", purpose: "participant" });
    expect(await startAudioUpload(p, { purpose: "participant", token: "testdata-vl-nadia", ...webm })).toMatchObject({ ok: false, error: "link_used", message: AUDIO_UPLOAD_ERROR_TEXT.link_used });
    expect(await startAudioUpload(p, { purpose: "participant", token: "finns-inte-alls", ...webm })).toMatchObject({ ok: false, error: "link_missing" });
    expect(await startAudioUpload(p, { purpose: "participant", token: "<script>", ...webm })).toMatchObject({ ok: false, error: "link_missing" });
    t.setNow(addDays(DEMO_START, 8));
    expect(await startAudioUpload(p, { purpose: "participant", ...webm })).toMatchObject({ ok: false, error: "link_expired" });
  });

  it("deltagaren: högst tio uppladdningar per länk", async () => {
    const t = setup();
    const p = t.ctxAs(PARTICIPANT);
    for (let i = 0; i < MAX_UPLOADS_PER_LINK; i++) expect((await startAudioUpload(p, { purpose: "participant", ...webm })).ok).toBe(true);
    expect(await startAudioUpload(p, { purpose: "participant", ...webm })).toMatchObject({ ok: false, error: "too_many" });
  });
});

describe("voiceLinkByToken", () => {
  it("tokenhash (SHA-256) som testdatat; skyddade ärenden (vilande spärr påslagen) räknas som saknade", async () => {
    const t = setup();
    protect(t);
    expect(await voiceTokenHash("testdata-vl-nadia")).toBe("3cb860bc33b1dce96d11e26e2a095e5e549a0f23e56340fd7261a53e59f42cb7");
    const l = await voiceLinkByToken(t.ctxAs(PARTICIPANT), "testdata-vl-nadia");
    expect(l).toMatchObject({ state: "used", link: { id: "vl-nadia" }, block: null });
    // En länk i det skyddade ärendet (får aldrig finnas) behandlas som saknad
    t.store.insertRow("voice_links", { id: "vl-x", caseId: SKYDDAD, tokenHash: (await voiceTokenHash("hemlig-token-123"))!, channel: "sms", language: "sv", sentAt: DEMO_START, expiresAt: addDays(DEMO_START, 7), usedAt: null, createdBy: "u-erik" });
    expect((await voiceLinkByToken(t.ctxAs(PARTICIPANT), "hemlig-token-123")).state).toBe("missing");
  });

  it("utan Web Crypto (sida utan https i prototypen): samma hash i ren TypeScript, och länken hittas", async () => {
    const t = setup();
    vi.stubGlobal("crypto", undefined);
    try {
      expect(globalThis.crypto).toBeUndefined();
      expect(await voiceTokenHash("testdata-vl-nadia")).toBe("3cb860bc33b1dce96d11e26e2a095e5e549a0f23e56340fd7261a53e59f42cb7");
      expect(await voiceLinkByToken(t.ctxAs(PARTICIPANT), "testdata-vl-nadia")).toMatchObject({ state: "used", link: { id: "vl-nadia" } });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(globalThis.crypto?.subtle).toBeDefined();
  });
});

describe("confirmOwnUpload", () => {
  it("bara den egna uppladdningen bekräftas (inloggad), och deltagarens bara i länkens ärende", async () => {
    const t = setup();
    const amira = t.as("u-amira", "coach");
    const r = await startAudioUpload(amira, { purpose: "checkin", caseId: NADIA, ...webm });
    if (!r.ok) throw new Error("start");
    // Någon annan (samordnaren ser raden men äger den inte)
    expect(await confirmOwnUpload(t.as("u-sara", "samordnare"), { uploadId: r.ticket.uploadId })).toMatchObject({ ok: false, error: "not_found" });
    expect(await confirmOwnUpload(amira, { uploadId: r.ticket.uploadId, durationSec: 1502.4 })).toMatchObject({ ok: true, audio: { uploadId: r.ticket.uploadId, purpose: "checkin", durationSec: 1502, caseId: NADIA } });
    expect(t.store.getRow("audio_uploads", r.ticket.uploadId)!.status).toBe("uploaded");

    const p = t.ctxAs(PARTICIPANT);
    const pr = await startAudioUpload(p, { purpose: "participant", ...webm });
    if (!pr.ok) throw new Error("start");
    // Coachens uppladdning kan inte bekräftas med deltagarens länk
    expect(await confirmOwnUpload(p, { uploadId: r.ticket.uploadId, token: null })).toMatchObject({ ok: false, error: "not_found" });
    expect(await confirmOwnUpload(p, { uploadId: pr.ticket.uploadId, token: null })).toMatchObject({ ok: true, audio: { caseId: AMAL } });
    expect(await confirmOwnUpload(p, { uploadId: pr.ticket.uploadId, token: "testdata-vl-nadia" })).toMatchObject({ ok: false, error: "link_used" });
  });
});
