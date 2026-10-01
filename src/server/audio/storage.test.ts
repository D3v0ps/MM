// ctx.audio på servern (bucketen "ljud") med fejkad lagring och testdatat i minnet som ctx.system: signerad
// uppladdningsadress, bekräftelse med storleken från lagringen, läsning, radering och Supabase-klientens felkoder.
import { describe, expect, it } from "vitest";
import { SYSTEM_ACTOR } from "@/api/roles";
import { addMinutes, type LocalDateTime } from "@/core/time";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START } from "@/data/seed";
import type { AppRepo, Tables } from "@/data/schema";
import { AUDIO_MAX_BYTES } from "@/features/_shared/audio-port";
import { AudioStorageError, createStorageAudio, supabaseAudioStorage, type AudioStorage, type StorageBucketLike } from "./storage";

function fakeStorage() {
  const files = new Map<string, Uint8Array>();
  const removed: string[] = [];
  const storage: AudioStorage = {
    async createSignedUploadUrl(path) {
      return { signedUrl: `https://ref.supabase.co/storage/v1/object/upload/sign/ljud/${path}?token=t-${path.length}`, token: `t-${path.length}` };
    },
    async size(path) {
      return files.get(path)?.byteLength ?? null;
    },
    async download(path) {
      return files.get(path) ?? null;
    },
    async remove(path) {
      removed.push(path);
      files.delete(path);
    },
  };
  return { storage, files, removed };
}

function setup() {
  const store = new MemoryStore<Tables>(createSeed());
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  let clock: LocalDateTime = DEMO_START;
  let seq = 0;
  const f = fakeStorage();
  const audio = createStorageAudio({ system, storage: f.storage, now: () => clock, newId: (p) => `${p}-${++seq}` });
  return { store, audio, ...f, setNow: (t: LocalDateTime) => (clock = t) };
}

describe("createStorageAudio", () => {
  it("createUpload: raden (pending) och en signerad adress med bara syfte och id i sökvägen", async () => {
    const t = setup();
    const ticket = await t.audio.createUpload({ caseId: "case-260143", ownerId: "u-amira", purpose: "checkin", mimeType: "audio/webm;codecs=opus", durationSec: 12.6 });
    expect(ticket).toEqual({
      uploadId: "aud-1", storagePath: "checkin/aud-1.webm", uploadUrl: "https://ref.supabase.co/storage/v1/object/upload/sign/ljud/checkin/aud-1.webm?token=t-18",
      token: "t-18", expiresAt: addMinutes(DEMO_START, 30), maxBytes: AUDIO_MAX_BYTES,
    });
    expect(t.store.getRow("audio_uploads", "aud-1")).toEqual({
      id: "aud-1", caseId: "case-260143", ownerId: "u-amira", purpose: "checkin", storagePath: "checkin/aud-1.webm", mimeType: "audio/webm", bytes: null, durationSec: 13,
      status: "pending", createdAt: DEMO_START, deletedAt: null,
    });
    await expect(t.audio.createUpload({ caseId: null, ownerId: "k-maria", purpose: "dictation", mimeType: "text/plain" })).rejects.toMatchObject({ code: "audio_type" });
  });

  it("confirm: storleken från lagringen; saknad fil ger null; för stor fil raderas direkt", async () => {
    const t = setup();
    const a = await t.audio.createUpload({ caseId: "case-260143", ownerId: "u-amira", purpose: "checkin", mimeType: "audio/mp4" });
    expect(await t.audio.confirm(a.uploadId)).toBeNull();
    t.files.set(a.storagePath, new Uint8Array(4000));
    expect(await t.audio.confirm(a.uploadId, { bytes: 1, durationSec: 60 })).toEqual({ uploadId: a.uploadId, purpose: "checkin", mimeType: "audio/mp4", durationSec: 60, caseId: "case-260143" });
    expect(t.store.getRow("audio_uploads", a.uploadId)).toMatchObject({ status: "uploaded", bytes: 4000 });

    const big = await t.audio.createUpload({ caseId: "case-260143", ownerId: "u-amira", purpose: "checkin", mimeType: "audio/webm" });
    t.files.set(big.storagePath, new Uint8Array(AUDIO_MAX_BYTES + 1));
    expect(await t.audio.confirm(big.uploadId)).toBeNull();
    expect(t.store.getRow("audio_uploads", big.uploadId)).toMatchObject({ status: "deleted", deletedAt: DEMO_START });
    expect(t.files.has(big.storagePath)).toBe(false);
  });

  it("read, mark och remove: ljudet raderas ur bucketen och raden blir ett spår utan innehåll (idempotent)", async () => {
    const t = setup();
    const a = await t.audio.createUpload({ caseId: null, ownerId: "k-maria", purpose: "dictation", mimeType: "audio/wav" });
    expect(await t.audio.read(a.uploadId)).toBeNull(); // inte bekräftad
    t.files.set(a.storagePath, new Uint8Array([1, 2, 3]));
    await t.audio.confirm(a.uploadId);
    expect(await t.audio.read(a.uploadId)).toMatchObject({ uploadId: a.uploadId, purpose: "dictation", mimeType: "audio/wav", bytes: new Uint8Array([1, 2, 3]) });
    await t.audio.mark(a.uploadId, "transcribed");
    t.setNow("2027-02-01T09:14");
    expect(await t.audio.remove(a.uploadId)).toEqual({ deletedAt: "2027-02-01T09:14" });
    expect(t.files.size).toBe(0);
    expect(t.store.getRow("audio_uploads", a.uploadId)).toMatchObject({ status: "deleted", deletedAt: "2027-02-01T09:14", storagePath: "dictation/aud-1.wav" });
    expect(await t.audio.read(a.uploadId)).toBeNull();
    t.setNow("2027-02-01T10:00");
    expect(await t.audio.remove(a.uploadId)).toEqual({ deletedAt: "2027-02-01T09:14" });
    expect(t.removed).toEqual(["dictation/aud-1.wav"]);
    await t.audio.mark(a.uploadId, "failed");
    expect(t.store.getRow("audio_uploads", a.uploadId)!.status).toBe("deleted");
    expect(await t.audio.remove("aud-finns-inte")).toBeNull();
  });

  it("misslyckad radering i lagringen: raden står kvar oraderad så att gallringen försöker igen", async () => {
    const t = setup();
    const a = await t.audio.createUpload({ caseId: null, ownerId: "k-maria", purpose: "dictation", mimeType: "audio/wav" });
    t.storage.remove = async () => {
      throw new AudioStorageError("remove", "500");
    };
    await expect(t.audio.remove(a.uploadId)).rejects.toBeInstanceOf(AudioStorageError);
    expect(t.store.getRow("audio_uploads", a.uploadId)!.status).toBe("pending");
  });
});

describe("supabaseAudioStorage", () => {
  function bucket(o: Partial<StorageBucketLike> = {}) {
    const calls: string[] = [];
    const b: StorageBucketLike = {
      createSignedUploadUrl: async (p) => (calls.push(`sign ${p}`), { data: { signedUrl: `https://x/${p}?token=abc`, token: "abc", path: p }, error: null }),
      exists: async (p) => (calls.push(`exists ${p}`), { data: true, error: null }),
      info: async (p) => (calls.push(`info ${p}`), { data: { size: 1234 }, error: null }),
      download: async (p) => (calls.push(`download ${p}`), { data: new Blob([new Uint8Array([7, 8])]), error: null }),
      remove: async (ps) => (calls.push(`remove ${ps.join(",")}`), { data: [], error: null }),
      ...o,
    };
    const buckets: string[] = [];
    return { client: { storage: { from: (name: string) => (buckets.push(name), b) } }, calls, buckets };
  }

  it("bucketen ljud: signering, storlek, nedladdning och radering", async () => {
    const b = bucket();
    const s = supabaseAudioStorage(b.client);
    expect(await s.createSignedUploadUrl("checkin/aud-1.webm")).toEqual({ signedUrl: "https://x/checkin/aud-1.webm?token=abc", token: "abc" });
    expect(await s.size("checkin/aud-1.webm")).toBe(1234);
    expect(await s.download("checkin/aud-1.webm")).toEqual(new Uint8Array([7, 8]));
    await s.remove("checkin/aud-1.webm");
    expect(b.buckets.every((x) => x === "ljud")).toBe(true);
    expect(b.calls).toEqual(["sign checkin/aud-1.webm", "exists checkin/aud-1.webm", "info checkin/aud-1.webm", "download checkin/aud-1.webm", "remove checkin/aud-1.webm"]);
  });

  it("saknad fil är null; andra fel blir AudioStorageError utan sökväg i meddelandet", async () => {
    const missing = supabaseAudioStorage(bucket({ exists: async () => ({ data: false, error: { status: 400 } }), download: async () => ({ data: null, error: { status: 404 } }) }).client);
    expect(await missing.size("checkin/aud-1.webm")).toBeNull();
    expect(await missing.download("checkin/aud-1.webm")).toBeNull();
    const broken = supabaseAudioStorage(bucket({ createSignedUploadUrl: async () => ({ data: null, error: { statusCode: "403" } }), remove: async () => ({ data: null, error: { status: 500 } }) }).client);
    const e = await broken.createSignedUploadUrl("checkin/aud-1.webm").then(() => null, (x: unknown) => x as Error);
    expect(e).toBeInstanceOf(AudioStorageError);
    expect(e?.message).toBe("Ljudlagringen: sign misslyckades (403)");
    await expect(broken.remove("checkin/aud-1.webm")).rejects.toMatchObject({ step: "remove", code: "500" });
  });
});
