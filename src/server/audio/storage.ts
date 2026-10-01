// ctx.audio på servern: ljudfilerna i Supabase Storage, privat bucket "ljud" i Stockholm (0015_rost.sql).
// Samma livscykel som minnesläget (createMemoryAudio i src/features/_shared/audio-port.ts):
//   createUpload  rad i audio_uploads (pending) + signerad uppladdningsadress – webbläsaren laddar upp direkt till Storage
//                 (Vercels funktioner tar högst 4,5 MB). Adressen innehåller bara syfte och id, aldrig namn.
//   confirm       filen finns och är inte för stor -> uploaded (bytes från lagringen, inte från klienten)
//   read          ljudet till ctx.ai.transcribe (service role)
//   mark          transcribed eller failed
//   remove        filen raderas ur bucketen, raden får status deleted och deletedAt (spåret finns kvar, utan innehåll)
// Raderna skrivs med service role (ctx.system) – användare läser bara läget (RLS). Hanteraren har redan kontrollerat
// behörigheten (startAudioUpload i src/features/_shared/voice-upload.ts). Bucketen nås bara med service role (inga policyer
// på storage.objects), och felmeddelanden innehåller aldrig sökvägar med personuppgifter (sökvägen är bara syfte och id).
import {
  AUDIO_BUCKET, AUDIO_MAX_BYTES, audioRefOf, audioStoragePath, uploadUrlExpiry, validateAudioMeta,
  type AudioPort, type AudioUpload, type AudioUploadStatus,
} from "@/features/_shared/audio-port";
import type { LocalDateTime } from "@/core/time";
import type { AppRepo } from "@/data/schema";

/** Den del av lagringen som porten behöver (Supabase Storage i drift, en fejk i testerna). */
export interface AudioStorage {
  /** Signerad uppladdningsadress för sökvägen (Supabase: gäller två timmar, bara en uppladdning). */
  createSignedUploadUrl(path: string): Promise<{ signedUrl: string; token: string }>;
  /** Filens storlek i byte, eller null om filen inte finns. */
  size(path: string): Promise<number | null>;
  /** Filens innehåll, eller null om den inte finns. */
  download(path: string): Promise<Uint8Array | null>;
  /** Radera filen. Ingen fil är inget fel. */
  remove(path: string): Promise<void>;
}

/** Fel i lagringen. Meddelandet innehåller bara steget och en felkod – aldrig sökväg eller innehåll. */
export class AudioStorageError extends Error {
  constructor(public readonly step: "sign" | "info" | "download" | "remove", public readonly code: string) {
    super(`Ljudlagringen: ${step} misslyckades${code ? ` (${code})` : ""}`);
    this.name = "AudioStorageError";
  }
}

const READABLE: readonly AudioUploadStatus[] = ["uploaded", "transcribed", "failed"];

export function createStorageAudio(o: { system: AppRepo; storage: AudioStorage; now: () => LocalDateTime; newId: (prefix: string) => string }): AudioPort {
  // ctx.system (service role): ljudfilernas rader skrivs bara av systemet (policy.ts: audio_uploads.write = never).
  const table = () => o.system.table("audio_uploads");
  return {
    async createUpload(meta) {
      const mimeType = validateAudioMeta(meta);
      const id = o.newId("aud");
      const now = o.now();
      const row: AudioUpload = {
        id, caseId: meta.caseId, ownerId: meta.ownerId, purpose: meta.purpose, storagePath: audioStoragePath(meta.purpose, id, mimeType), mimeType,
        bytes: meta.bytes ?? null, durationSec: meta.durationSec == null ? null : Math.round(meta.durationSec), status: "pending", createdAt: now, deletedAt: null,
      };
      // Raden först: finns en fil i bucketen finns alltid spåret, och gallringen hittar den (senast efter 24 timmar).
      await table().insert(row);
      const signed = await o.storage.createSignedUploadUrl(row.storagePath);
      return { uploadId: id, storagePath: row.storagePath, uploadUrl: signed.signedUrl, token: signed.token, expiresAt: uploadUrlExpiry(now), maxBytes: AUDIO_MAX_BYTES };
    },
    async confirm(uploadId, info) {
      const u = await table().get(uploadId);
      if (!u || (u.status !== "pending" && u.status !== "uploaded")) return null;
      const size = await o.storage.size(u.storagePath);
      if (size == null) return null;
      if (size > AUDIO_MAX_BYTES) {
        // För stor fil (bucketen stoppar normalt redan vid uppladdningen): radera direkt.
        await o.storage.remove(u.storagePath);
        await table().update(uploadId, { status: "deleted", deletedAt: o.now(), bytes: size });
        return null;
      }
      const patch: Partial<AudioUpload> = { status: "uploaded", bytes: size };
      if (info?.durationSec != null) patch.durationSec = Math.round(info.durationSec);
      return audioRefOf(await table().update(uploadId, patch));
    },
    async read(uploadId) {
      const u = await table().get(uploadId);
      if (!u || !READABLE.includes(u.status)) return null;
      const bytes = await o.storage.download(u.storagePath);
      if (!bytes) return null;
      return { ...audioRefOf(u), bytes };
    },
    async mark(uploadId, status) {
      const u = await table().get(uploadId);
      if (u && u.status !== "deleted") await table().update(uploadId, { status });
    },
    async remove(uploadId) {
      const u = await table().get(uploadId);
      if (!u) return null;
      if (u.status === "deleted" && u.deletedAt) return { deletedAt: u.deletedAt };
      // Filen raderas först. Misslyckas det står raden kvar oraderad och gallringen försöker igen.
      await o.storage.remove(u.storagePath);
      const deletedAt = o.now();
      await table().update(uploadId, { status: "deleted", deletedAt });
      return { deletedAt };
    },
  };
}

// ---------------------------------------------------------------- Supabase Storage
/** Den del av supabase-js lagringsklient som används (bucketen "ljud"). */
export interface StorageBucketLike {
  createSignedUploadUrl(path: string): PromiseLike<{ data: { signedUrl: string; token: string; path: string } | null; error: unknown }>;
  exists(path: string): PromiseLike<{ data: boolean; error: unknown }>;
  info(path: string): PromiseLike<{ data: { size?: number | null } | null; error: unknown }>;
  download(path: string): PromiseLike<{ data: Blob | null; error: unknown }>;
  remove(paths: string[]): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface StorageClientLike {
  storage: { from(bucket: string): StorageBucketLike };
}

const errCode = (e: unknown): string => {
  const x = e as { status?: unknown; statusCode?: unknown } | null;
  return String(x?.statusCode ?? x?.status ?? "");
};

/** Bucketen "ljud" via service role-klienten. */
export function supabaseAudioStorage(client: StorageClientLike, bucket: string = AUDIO_BUCKET): AudioStorage {
  const b = () => client.storage.from(bucket);
  return {
    async createSignedUploadUrl(path) {
      const { data, error } = await b().createSignedUploadUrl(path);
      if (error || !data) throw new AudioStorageError("sign", errCode(error));
      return { signedUrl: data.signedUrl, token: data.token };
    },
    async size(path) {
      const ex = await b().exists(path);
      if (!ex.data) {
        if (ex.error && !["400", "404"].includes(errCode(ex.error))) throw new AudioStorageError("info", errCode(ex.error));
        return null;
      }
      const { data, error } = await b().info(path);
      if (error || !data) throw new AudioStorageError("info", errCode(error));
      return typeof data.size === "number" ? data.size : 0;
    },
    async download(path) {
      const { data, error } = await b().download(path);
      if (error) {
        if (["400", "404"].includes(errCode(error))) return null;
        throw new AudioStorageError("download", errCode(error));
      }
      return data ? new Uint8Array(await data.arrayBuffer()) : null;
    },
    async remove(path) {
      const { error } = await b().remove([path]);
      if (error) throw new AudioStorageError("remove", errCode(error));
    },
  };
}
