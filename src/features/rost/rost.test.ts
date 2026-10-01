// Röstinspelningens flöden genom samma execute() som appen och prototypen (minnesläget: simulerad AI och ljud i minnet).
//   Coachen: inspelad avstämning (samtycke krävs, aldrig skyddade), förslag med belägg, ljudet raderas, råtranskriptet vid godkännande
//   Kommunen: "Tala in" – texten tillbaka till den som talade in, inget ljud sparas
//   Deltagaren: länken /rost, samtycke, inspelning, översättning till svenska, länken används en gång
//   Coachen: skicka länk (utan personuppgifter), granska röstmeddelanden, AI-utkast till månadsbedömningen
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import type { Tables } from "@/data/schema";
import { createSeed, DEMO_START } from "@/data/seed";
import { AUDIO_MAX_BYTES } from "@/features/_shared/audio-port";
import { DICTATIONS, participantMessage } from "@/data/seed/voice-texts";
import { assessmentPage, checkInPage, checkinSave, monthlyDraft, recordingFinish, recordingState } from "@/features/coach/api";
import { dictationFinish, dictationOptions } from "@/features/kommun/api";
import "@/api/handlers";
import "@/features/coach/handlers";
import {
  caseVoice, linkSend, noteReview, notesSeen, pendingNotes, rostLink, rostSend, rostSendStatus, UPLOAD_MAX_BYTES, uploadStart,
} from "./api";
import { sha256Hex } from "./sha256";
import { languageCodeOf, VOICE_CONSENT_VERSION } from "./texts";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cmd = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
/** Tabellerna i minnet (utan behörighetsfilter) – för att kontrollera vad som sparats. */
const raw = () => new Proxy({} as { [K in keyof Tables]: Tables[K][] }, { get: (_t, name: string) => rt.store.rows(name as keyof Tables & string) });
const amira = () => as("u-amira", "coach");
const maria = () => as("k-maria", "kommun_handlaggare");
const DELTAGARE: Actor = { userId: "deltagare", role: "deltagare", contractIds: [], customerUnit: null };
const SC = { nadia: "case-260143", yusuf: "case-260148", elif: "case-270003", amal: "case-270012", skyddad: "case-260120" };

describe("kontrollerna", () => {
  it("SHA-256 i ren TypeScript ger samma värde som node:crypto och testdatats länkar", () => {
    for (const s of ["", "abc", "testdata-vl-nadia", "å".repeat(200), "x".repeat(55), "y".repeat(64)]) {
      expect(sha256Hex(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
    }
    expect(sha256Hex("testdata-vl-nadia")).toBe(SEED.voice_links.find((l) => l.id === "vl-nadia")?.tokenHash);
    expect(sha256Hex("testdata-vl-yusuf")).toBe(SEED.voice_links.find((l) => l.id === "vl-yusuf")?.tokenHash);
  });
  it("samma filgräns som lagringen och språken från deltagarens språk i ärendet", () => {
    expect(UPLOAD_MAX_BYTES).toBe(AUDIO_MAX_BYTES);
    expect([languageCodeOf("somaliska"), languageCodeOf("arabiska"), languageCodeOf("lättläst svenska"), languageCodeOf("turkiska")]).toEqual(["so", "ar", "sv", null]);
  });
});

describe("coachen spelar in avstämningen", () => {
  it("Nadia (samtycke): förslag med belägg, fasen framgår inte, ljudet raderas direkt och råtranskriptet vid godkännandet", async () => {
    const page = await q(checkInPage, { caseId: SC.nadia }, amira());
    expect(page.kind === "ok" && page.recording).toEqual({ allowed: true, block: null, blockText: null, maxMinutes: 60 });
    const start = await cmd(uploadStart, { purpose: "checkin", caseId: SC.nadia, mimeType: "audio/webm;codecs=opus", bytes: 120000, durationSec: 1500 }, amira());
    expect(start).toMatchObject({ ok: true, maxMinutes: 60, ticket: { uploadUrl: null, expiresAt: null, maxBytes: AUDIO_MAX_BYTES } });
    if (!start.ok) throw new Error("start");
    const up = raw().audio_uploads.find((u) => u.id === start.ticket.uploadId);
    expect(up).toMatchObject({ caseId: SC.nadia, ownerId: "u-amira", purpose: "checkin", mimeType: "audio/webm", status: "pending", storagePath: `checkin/${start.ticket.uploadId}.webm` });

    const res = await cmd(recordingFinish, { caseId: SC.nadia, uploadId: start.ticket.uploadId, source: "recording", durationSec: 1500 }, amira());
    expect(res.ok).toBe(true);
    if (!res.ok || !res.result) throw new Error("finish");
    expect(res.status).toBe("succeeded");
    expect(res.error).toBeNull();
    const s = res.result.suggestions;
    expect(s).not.toBeNull();
    // Förslag bara med belägg (citat ur samtalet + tidpunkt). Fasen nämns inte: "Framgår inte". Samlad status föreslås aldrig.
    expect(s && Object.keys(s).sort()).toEqual(["activitiesDone", "employerContacts", "goalStatus", "nextGoal", "note", "obstacles", "phase"]);
    expect(s?.phase).toMatchObject({ value: null, noEvidence: true, quote: "Framgår inte av samtalet. Fasen ändras inte." });
    const withEvidence = Object.values(s ?? {}).filter((x) => !x.noEvidence);
    expect(withEvidence).toHaveLength(6);
    expect(withEvidence.every((x) => x.quote.length > 0)).toBe(true);
    // Ljudet raderades direkt efter transkriberingen
    expect(res.audioDeletedAt).toBe(res.result.audioDeletedAt);
    const u2 = raw().audio_uploads.find((u) => u.id === start.ticket.uploadId);
    expect(u2).toMatchObject({ status: "deleted" });
    expect(u2?.deletedAt).toBe(res.audioDeletedAt);
    expect(rt.audio.stored()).toBe(0);
    const run = raw().ai_runs.find((r) => r.id === res.aiRunId);
    expect(run).toMatchObject({ kind: "transcribe_extract", provider: "simulated", model: "simulerad", status: "succeeded", caseId: SC.nadia, inputRef: start.ticket.uploadId, audioSeconds: 1500 });
    const { ok: _ok, ...state } = res;
    void _ok;
    expect(await q(recordingState, { aiRunId: res.aiRunId }, amira())).toEqual(state);

    // Coachen godkänner: förslagen sparas i avstämningen och råtranskriptet raderas.
    const saved = await cmd(checkinSave, {
      caseId: SC.nadia, approve: true,
      data: { heldAt: "2027-02-01T09:00", durationMin: 45, mode: "fysiskt", inputMethod: "ai_recording", goalStatus: "partly", nextGoal: "Plocka en hel order själv", phase: 3, activitiesDone: ["Yrkesspecifika moment"], employerContacts: { count: "1", types: ["studiebesök"] }, overallStatus: "yellow", obstacles: [], note: "Bra vecka.", aiRunId: res.aiRunId },
    }, amira());
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error("save");
    const ci = raw().check_ins.find((x) => x.id === saved.checkInId);
    expect(ci?.aiRunId).toBe(res.aiRunId);
    expect(ci?.ai?.transcript).toEqual([]);
    expect(ci?.ai?.audioDeletedAt).toBe(res.audioDeletedAt);
    expect(saved.rawTranscriptDeletedAt).not.toBeNull();
    const acts = raw().audit_log.map((l) => l.action);
    expect(acts).toEqual(expect.arrayContaining(["audio.upload_started", "audio.deleted", "ai.run", "transcript.deleted", "check_in.approved"]));
  });

  it("aldrig utan samtycke och aldrig för andras ärenden", async () => {
    const elif = await q(checkInPage, { caseId: SC.elif }, amira());
    expect(elif.kind === "ok" && elif.recording).toMatchObject({ allowed: false, block: "no_consent" });
    expect(await cmd(uploadStart, { purpose: "checkin", caseId: SC.elif, mimeType: "audio/webm" }, amira())).toMatchObject({ ok: false, error: "no_consent" });
    expect(await cmd(uploadStart, { purpose: "checkin", caseId: SC.yusuf, mimeType: "audio/webm" }, amira())).toMatchObject({ ok: false, error: "no_consent" });
    expect(await cmd(uploadStart, { purpose: "checkin", caseId: SC.skyddad, mimeType: "audio/webm" }, amira())).toMatchObject({ ok: false });
    // Fel filtyp och för lång inspelning
    expect(await cmd(uploadStart, { purpose: "checkin", caseId: SC.nadia, mimeType: "video/avi" }, amira())).toMatchObject({ ok: false, error: "audio_type" });
    expect(await cmd(uploadStart, { purpose: "checkin", caseId: SC.nadia, mimeType: "audio/webm", durationSec: 61 * 60 }, amira())).toMatchObject({ ok: false, error: "too_long" });
    expect(raw().audio_uploads.filter((u) => u.status !== "deleted")).toHaveLength(0);
  });
});

describe("kommunens Tala in", () => {
  it("texten kommer tillbaka till handläggaren – ljudet raderas och ingenting sparas i ärendet", async () => {
    expect(await q(dictationOptions, {}, maria())).toEqual({ enabled: true, maxMinutes: 5, reason: null });
    expect(await q(dictationOptions, { protectedOrder: true }, maria())).toEqual({
      enabled: false, maxMinutes: 0, reason: "Inspelning och AI används aldrig för personer med skyddade personuppgifter.",
    });
    const start = await cmd(uploadStart, { purpose: "dictation", mimeType: "audio/mp4", durationSec: 20 }, maria());
    if (!start.ok) throw new Error(start.error);
    const res = await cmd(dictationFinish, { uploadId: start.ticket.uploadId, durationSec: 20 }, maria());
    if (!res.ok) throw new Error(res.error);
    expect(res.status).toBe("succeeded");
    expect(DICTATIONS.map((d) => d.join(" "))).toContain(res.text);
    expect(raw().audio_uploads.find((u) => u.id === start.ticket.uploadId)?.status).toBe("deleted");
    expect(raw().ai_runs.find((r) => r.id === res.aiRunId)).toMatchObject({ kind: "transcribe_dictation", caseId: null, status: "succeeded" });
    // Coachen kan inte starta en diktering, och kommunen kan inte spela in avstämningar.
    expect(await cmd(uploadStart, { purpose: "dictation", mimeType: "audio/webm" }, amira())).toMatchObject({ ok: false, error: "forbidden" });
    expect(await cmd(uploadStart, { purpose: "checkin", caseId: SC.nadia, mimeType: "audio/webm" }, maria())).toMatchObject({ ok: false });
  });
  it("i ett ärende: bara beställande handläggare", async () => {
    expect(await q(dictationOptions, { caseId: SC.nadia }, maria())).toMatchObject({ enabled: true });
    const linda = as("k-linda", "kommun_handlaggare");
    expect(await q(dictationOptions, { caseId: SC.nadia }, linda)).toMatchObject({ enabled: false });
  });
});

describe("deltagarens länk", () => {
  it("exempellänken: samtycke, inspelning på arabiska, svensk översättning till coachen, länken används en gång", async () => {
    const link = await q(rostLink, {}, DELTAGARE);
    expect(link).toEqual({ state: "open", language: "ar", languages: ["sv", "en", "ar", "so"], maxMinutes: 5, days: 7, location: expect.any(String), consentVersion: VOICE_CONSENT_VERSION });
    expect(await cmd(uploadStart, { purpose: "participant", mimeType: "audio/webm" }, DELTAGARE)).toMatchObject({ ok: false, error: "consent" });
    const start = await cmd(uploadStart, { purpose: "participant", consent: true, mimeType: "audio/webm", durationSec: 40 }, DELTAGARE);
    if (!start.ok) throw new Error(start.error);
    const res = await cmd(rostSend, { uploadId: start.ticket.uploadId, language: "ar", consent: true, durationSec: 40 }, DELTAGARE);
    if (!res.ok) throw new Error(res.error);
    expect(res).toMatchObject({ status: "succeeded", error: null });
    expect(res.audioDeletedAt).not.toBeNull();
    const note = raw().participant_voice_notes.find((n) => n.aiRunId === res.aiRunId);
    expect(note).toMatchObject({ caseId: SC.amal, linkId: "vl-demo", language: "ar", status: "new", consentTextVersion: VOICE_CONSENT_VERSION });
    expect([participantMessage(0, "sv"), participantMessage(1, "sv")]).toContain(note?.textSv);
    expect([participantMessage(0, "ar"), participantMessage(1, "ar")]).toContain(note?.textOriginal);
    expect(raw().voice_links.find((l) => l.id === "vl-demo")?.usedAt).not.toBeNull();
    expect(raw().audio_uploads.find((u) => u.id === start.ticket.uploadId)?.status).toBe("deleted");
    expect(await q(rostSendStatus, { aiRunId: res.aiRunId }, DELTAGARE)).toMatchObject({ status: "succeeded" });
    // Länken fungerar en gång
    expect((await q(rostLink, {}, DELTAGARE)).state).toBe("used");
    expect(await cmd(uploadStart, { purpose: "participant", consent: true, mimeType: "audio/webm" }, DELTAGARE)).toMatchObject({ ok: false, error: "link_used" });
    // Coachen ser det nya röstmeddelandet på Min vecka; kommunen ser det inte
    const pending = await q(pendingNotes, {}, amira());
    expect(pending.map((p) => [p.caseId, p.languageName, p.translated])).toEqual([[SC.amal, "arabiska", true], [SC.nadia, "somaliska", true]]);
    await expect(q(caseVoice, { caseId: SC.amal }, maria())).rejects.toMatchObject({ status: 403 });
  });
  it("okänd eller felaktig token: länken fungerar inte", async () => {
    expect((await q(rostLink, { token: "okand-lank-12345" }, DELTAGARE)).state).toBe("missing");
    expect((await q(rostLink, { token: "<script>" }, DELTAGARE)).state).toBe("missing");
    expect(await cmd(uploadStart, { purpose: "participant", token: "okand-lank-12345", consent: true, mimeType: "audio/webm" }, DELTAGARE)).toMatchObject({ ok: false, error: "link_missing" });
  });
});

describe("coachen och röstmeddelandena", () => {
  it("skickar länk via deltagarens kontaktväg utan personuppgifter – deltagaren kan använda den", async () => {
    const v = await q(caseVoice, { caseId: SC.nadia }, amira());
    expect(v?.send).toMatchObject({ allowed: true, channel: "sms", channelText: "SMS till deltagarens telefonnummer", defaultLanguage: "so", days: 7, maxMinutes: 5 });
    expect(v?.notes.map((n) => [n.id, n.status, n.translated])).toEqual([["pvn-nadia", "new", true]]);
    const res = await cmd(linkSend, { caseId: SC.nadia, language: "so" }, amira());
    if (!res.ok) throw new Error(res.error);
    expect(res.path).toMatch(/^\/rost\/[A-Za-z0-9_-]{8,}$/);
    const token = res.path.slice("/rost/".length);
    const row = raw().voice_links.find((l) => l.id === res.linkId);
    expect(row).toMatchObject({ caseId: SC.nadia, channel: "sms", language: "so", tokenHash: sha256Hex(token), usedAt: null, createdBy: "u-amira" });
    expect(row?.expiresAt).toBe("2027-02-08T09:13");
    const msg = raw().outbound_messages.filter((m) => m.template === "rostlank");
    expect(msg).toHaveLength(1);
    expect(msg[0]).toMatchObject({ channel: "sms", to: "deltagare (SMS)", caseId: SC.nadia });
    expect(msg[0].body).toContain(res.path);
    expect(msg[0].body).not.toMatch(/Nadia|Warsame|BOT-/);
    const link = await q(rostLink, { token }, DELTAGARE);
    expect(link).toMatchObject({ state: "open", language: "so", days: 7 });
  });
  it("aldrig länk vid skyddade personuppgifter, och en ny länk ersätter den gamla", async () => {
    const ansv = as("u-johan", "avtalsansvarig");
    const res = await cmd(linkSend, { caseId: SC.skyddad, language: "sv" }, ansv);
    expect(res).toMatchObject({ ok: false, error: "protected" });
    expect(raw().voice_links.filter((l) => l.caseId === SC.skyddad)).toHaveLength(0);
    const first = await cmd(linkSend, { caseId: SC.amal, language: "ar" }, amira());
    expect(first.ok).toBe(true);
    expect((await q(rostLink, {}, DELTAGARE)).state).toBe("expired");
  });
  it("granskar ett röstmeddelande (loggas) och visningen loggas", async () => {
    expect((await q(pendingNotes, {}, amira())).map((p) => p.id)).toEqual(["pvn-nadia"]);
    expect(await cmd(notesSeen, { caseId: SC.nadia }, amira())).toMatchObject({ ok: true });
    expect(await cmd(noteReview, { noteId: "pvn-nadia", status: "reviewed" }, amira())).toMatchObject({ ok: true });
    expect(raw().participant_voice_notes.find((n) => n.id === "pvn-nadia")).toMatchObject({ status: "reviewed", reviewedBy: "u-amira", reviewedAt: expect.any(String) });
    expect(await q(pendingNotes, {}, amira())).toEqual([]);
    expect(raw().audit_log.map((l) => l.action)).toEqual(expect.arrayContaining(["voice_note.view", "voice_note.reviewed"]));
    // Kommunen kan inte granska
    await expect(cmd(noteReview, { noteId: "pvn-nadia", status: "new" }, maria())).rejects.toMatchObject({ status: 403 });
  });
});

describe("AI-utkast till månadsbedömningen", () => {
  it("bara från godkända avstämningar – nivåerna rörs aldrig", async () => {
    const before = await q(assessmentPage, { caseId: SC.nadia, month: "2027-01" }, amira());
    if (before.kind !== "ok") throw new Error("gate");
    const res = await cmd(monthlyDraft, { caseId: SC.nadia, month: "2027-01" }, amira());
    if (!res.ok) throw new Error(res.error);
    expect(res.status).toBe("succeeded");
    const after = await q(assessmentPage, { caseId: SC.nadia, month: "2027-01" }, amira());
    if (after.kind !== "ok") throw new Error("gate");
    expect(after.aiDraft).toMatchObject({ aiRunId: res.aiRunId, status: "succeeded", error: null });
    expect(after.aiDraft?.plan?.sources.every((x) => x.startsWith("Avstämning"))).toBe(true);
    expect(after.areas.map((a) => a.level)).toEqual(before.areas.map((a) => a.level));
    expect(after.areas.every((a) => a.aiObservationDraft !== null)).toBe(true);
    expect(after.areas.find((a) => a.key === "narvaro_rutiner")?.aiObservationDraft?.sources).toContain("Närvaroregistrering");
    // Utan samtycke: stopp
    expect(await cmd(monthlyDraft, { caseId: SC.elif, month: "2027-01" }, amira())).toMatchObject({ ok: false, error: "ai_not_allowed" });
  });
});
