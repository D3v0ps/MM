// Porten till ljudlagringen (röstinspelning, docs/PLAN-ROST.md). Hanterare och jobb når ljudfiler bara via ctx.audio –
// samma mönster som ctx.crypto och ctx.ai. Isomorf: typerna används av båda körlägena.
//   Minnesläget (prototypen, utveckling, e2e): createMemoryAudio nedan – ljudet i minnet (bara ett id, inga riktiga filer).
//   Supabase-läget: privat bucket "ljud" i Supabase Storage (Stockholm), signerade uppladdningsadresser (src/server/audio).
//
// Porten äger tabellen audio_uploads: raden skapas, ändras och "raderas" (status deleted) bara här, med service role
// (systemsteg – användare har bara läsrätt, se src/data/policy.ts). Hanteraren kontrollerar ALLTID behörigheten först:
// ärendet via ctx.repo, rollen, avtalets ai.recording (recordingEnabled), samtycket och att ärendet inte har skyddade
// personuppgifter (recordingBlock i ai-port.ts). Porten själv kontrollerar bara filtyp och storlek.
//
// Livscykel (CLAUDE.md punkt 7 – ljud raderas direkt efter lyckad transkribering, senast efter 24 timmar vid fel):
//   createUpload  -> status pending, uppladdningsadress (appen) eller ingen (minnet)
//   confirm       -> status uploaded (filen finns)
//   read          -> ljudet till ctx.ai.transcribe
//   mark          -> transcribed eller failed
//   remove        -> status deleted, deletedAt – direkt efter lyckad transkribering, och av gallringen (audioOverdue)
import { ApiError, type Ctx } from "@/api/server";
import { addMinutes, ms, type LocalDateTime } from "@/core/time";
import type { AppRepo, AudioPurpose, AudioUpload, AudioUploadStatus } from "@/data/schema";

export type { AudioPurpose, AudioUpload, AudioUploadStatus };

// ---------------------------------------------------------------- Konstanter
/** Den privata bucketen i Supabase Storage (0015_rost.sql). Bara service role läser och skriver. */
export const AUDIO_BUCKET = "ljud";
/** Största fil som tas emot (samma som bucketens file_size_limit): 25 MB. */
export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
/** Ljud som inte raderats efter så här många timmar raderas av gallringen (CLAUDE.md punkt 7). */
export const AUDIO_RETENTION_HOURS = 24;
/** Uppladdningsadressen gäller så här länge (minuter). */
export const AUDIO_UPLOAD_URL_MINUTES = 30;

/**
 * Filtyper som tas emot (grundtypen, utan parametrar) och filändelsen i lagringen. Inspelning i webbläsaren: webm/opus
 * (Chrome, Edge, Firefox) och mp4 (Safari). Uppladdad fil: m4a, mp3, wav, webm (SPEC §8.2).
 */
export const AUDIO_MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
};
export const AUDIO_MIME_TYPES: readonly string[] = Object.keys(AUDIO_MIME_EXTENSIONS);
/** Filändelser som "Ladda upp ljudfil" tar emot (accept-attributet: ".m4a,.mp3,.wav,.webm"). */
export const AUDIO_FILE_EXTENSIONS = ["m4a", "mp3", "wav", "webm"] as const;

/** "audio/webm;codecs=opus" -> "audio/webm". Null om typen inte tas emot. Ladda upp med grundtypen som Content-Type. */
export function normalizeAudioMime(mime: string | null | undefined): string | null {
  const base = String(mime ?? "").split(";")[0].trim().toLowerCase();
  return base in AUDIO_MIME_EXTENSIONS ? base : null;
}
/** Sökvägen i bucketen: bara syfte och id – aldrig namn eller andra personuppgifter. T.ex. "checkin/aud-n00012.webm". */
export function audioStoragePath(purpose: AudioPurpose, uploadId: string, mime: string): string {
  const ext = AUDIO_MIME_EXTENSIONS[normalizeAudioMime(mime) ?? ""] ?? "bin";
  return `${purpose}/${uploadId}.${ext}`;
}
/** Ska ljudet raderas av gallringen? Allt som inte redan är raderat och är äldre än 24 timmar. */
export function audioOverdue(u: Pick<AudioUpload, "status" | "createdAt">, now: LocalDateTime): boolean {
  return u.status !== "deleted" && ms(now) - ms(u.createdAt) >= AUDIO_RETENTION_HOURS * 3600_000;
}

// ---------------------------------------------------------------- Typerna
/** Referens till en uppladdad ljudfil (utan innehåll). Det som ctx.ai.transcribe behöver veta om ljudet. */
export type AudioRef = {
  uploadId: string;
  purpose: AudioPurpose;
  /** Grundtypen, t.ex. "audio/webm". */
  mimeType: string;
  /** Längd i hela sekunder, om den är känd. */
  durationSec: number | null;
  caseId: string | null;
};
/** Ljudet med innehåll (ctx.audio.read). bytes är null i minnesläget när inget riktigt ljud finns (simulerad inspelning). */
export type AudioData = AudioRef & { bytes: Uint8Array | null };

export type AudioUploadMeta = {
  /** Ärendet, eller null ("Tala in" i en ny beställning). */
  caseId: string | null;
  /** Den som spelar in: ctx.actor.userId, eller "deltagare" för deltagarens länk. */
  ownerId: string;
  purpose: AudioPurpose;
  /** Filtypen från webbläsaren, t.ex. "audio/webm;codecs=opus". */
  mimeType: string;
  bytes?: number | null;
  durationSec?: number | null;
};

/**
 * Var klienten laddar upp ljudet. Appen: uploadUrl + token (Supabase Storage signerad uppladdning, direkt från webbläsaren –
 * Vercels funktioner tar högst 4,5 MB). Minnesläget och prototypen: uploadUrl och token är null – ingen uppladdning behövs,
 * anropa confirm direkt.
 */
export type AudioUploadTicket = {
  uploadId: string;
  storagePath: string;
  uploadUrl: string | null;
  token: string | null;
  /** När uploadUrl slutar gälla. Null i minnesläget. */
  expiresAt: LocalDateTime | null;
  maxBytes: number;
};

export interface AudioPort {
  /** Skapa en uppladdning (raden i audio_uploads med status pending). Kastar ApiError 400 vid fel filtyp eller för stor fil. */
  createUpload(meta: AudioUploadMeta): Promise<AudioUploadTicket>;
  /** Klienten har laddat upp: kontrollera att filen finns och sätt status uploaded. Null om uppladdningen saknas eller är raderad. */
  confirm(uploadId: string, info?: { bytes?: number | null; durationSec?: number | null }): Promise<AudioRef | null>;
  /** Läs ljudet (status uploaded, transcribed eller failed). Null om det saknas, inte är bekräftat eller redan är raderat. */
  read(uploadId: string): Promise<AudioData | null>;
  /** Transkriberingen lyckades (transcribed – radera sedan direkt med remove) eller misslyckades (failed – gallras inom 24 h). */
  mark(uploadId: string, status: "transcribed" | "failed"): Promise<void>;
  /** Radera ljudet ur lagringen (status deleted, deletedAt). Idempotent: redan raderat ger samma tidpunkt. Null om det saknas. */
  remove(uploadId: string): Promise<{ deletedAt: LocalDateTime } | null>;
}

/** ctx.audio, eller ApiError 500 om ljudlagringen inte är inkopplad i körläget. */
export function requireAudio(ctx: Pick<Ctx, "audio">): AudioPort {
  if (!ctx.audio) throw new ApiError(500, "audio_unavailable", "Inspelningen är inte tillgänglig just nu. Fyll i formuläret själv.");
  return ctx.audio;
}

/** Kontroll före createUpload (samma i båda körlägena): filtyp och storlek. */
export function validateAudioMeta(meta: AudioUploadMeta): string {
  const mime = normalizeAudioMime(meta.mimeType);
  if (!mime) throw new ApiError(400, "audio_type", "Filtypen stöds inte. Använd m4a, mp3, wav eller webm.");
  if (meta.bytes != null && (meta.bytes < 0 || meta.bytes > AUDIO_MAX_BYTES)) throw new ApiError(400, "audio_size", "Ljudfilen är för stor (högst 25 MB).");
  if (meta.durationSec != null && meta.durationSec < 0) throw new ApiError(400, "audio_duration", "Ogiltig längd på inspelningen.");
  return mime;
}

export const audioRefOf = (u: AudioUpload): AudioRef => ({ uploadId: u.id, purpose: u.purpose, mimeType: u.mimeType, durationSec: u.durationSec, caseId: u.caseId });

// ---------------------------------------------------------------- Minnesläget
export type MemoryAudio = AudioPort & {
  /** Lägg in riktigt ljud för en uppladdning (tester, eller en inspelning i utvecklingsläget). */
  put(uploadId: string, bytes: Uint8Array): void;
  /** Antal ljudfiler som finns i minnet (0 när allt är raderat). */
  stored(): number;
};

/**
 * Ljud i minnet för prototypen och minnesläget. Raderna i audio_uploads skrivs via system (service role i minnet) –
 * deterministiskt: id via newId och tid via now, så att prototypens uppspelning av kommandon ger samma rader.
 */
export function createMemoryAudio(o: { system: AppRepo; now: () => LocalDateTime; newId: (prefix: string) => string }): MemoryAudio {
  const blobs = new Map<string, Uint8Array>();
  const table = () => o.system.table("audio_uploads");
  const readable: readonly AudioUploadStatus[] = ["uploaded", "transcribed", "failed"];
  return {
    async createUpload(meta) {
      const mimeType = validateAudioMeta(meta);
      const id = o.newId("aud");
      const row: AudioUpload = {
        id, caseId: meta.caseId, ownerId: meta.ownerId, purpose: meta.purpose, storagePath: audioStoragePath(meta.purpose, id, mimeType), mimeType,
        bytes: meta.bytes ?? null, durationSec: meta.durationSec == null ? null : Math.round(meta.durationSec), status: "pending", createdAt: o.now(), deletedAt: null,
      };
      await table().insert(row);
      return { uploadId: id, storagePath: row.storagePath, uploadUrl: null, token: null, expiresAt: null, maxBytes: AUDIO_MAX_BYTES };
    },
    async confirm(uploadId, info) {
      const u = await table().get(uploadId);
      if (!u || (u.status !== "pending" && u.status !== "uploaded")) return null;
      const blob = blobs.get(uploadId);
      const patch: Partial<AudioUpload> = { status: "uploaded" };
      if (blob) patch.bytes = blob.byteLength;
      else if (info?.bytes != null) patch.bytes = info.bytes;
      if (info?.durationSec != null) patch.durationSec = Math.round(info.durationSec);
      return audioRefOf(await table().update(uploadId, patch));
    },
    async read(uploadId) {
      const u = await table().get(uploadId);
      if (!u || !readable.includes(u.status)) return null;
      return { ...audioRefOf(u), bytes: blobs.get(uploadId) ?? null };
    },
    async mark(uploadId, status) {
      const u = await table().get(uploadId);
      if (u && u.status !== "deleted") await table().update(uploadId, { status });
    },
    async remove(uploadId) {
      const u = await table().get(uploadId);
      if (!u) return null;
      blobs.delete(uploadId);
      if (u.status === "deleted" && u.deletedAt) return { deletedAt: u.deletedAt };
      const deletedAt = o.now();
      await table().update(uploadId, { status: "deleted", deletedAt });
      return { deletedAt };
    },
    put(uploadId, bytes) {
      blobs.set(uploadId, bytes);
    },
    stored: () => blobs.size,
  };
}

/** Uppladdningsadressens sista giltiga minut (servern: signerade adresser gäller AUDIO_UPLOAD_URL_MINUTES). */
export const uploadUrlExpiry = (now: LocalDateTime): LocalDateTime => addMinutes(now, AUDIO_UPLOAD_URL_MINUTES);
