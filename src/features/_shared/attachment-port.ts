// Porten till bilagorna i beställningen (beslut 2026-10-07, synpunkt #7: "Bakgrundsinformation om deltagaren" – bifoga fil).
// Hanterare når filerna bara via ctx.attachments – samma mönster som ctx.audio (audio-port.ts). Isomorf.
//   Minnesläget (prototypen, utveckling, e2e): createMemoryAttachments nedan – innehållet i minnet (prototypen: bara i
//   webbläsarens minne, aldrig i kommandologgen).
//   Supabase-läget: privat bucket "bilagor" i Supabase Storage (Stockholm, 0024_bilagor.sql) via service role
//   (src/server/attachments). Webbläsaren laddar upp direkt till lagringen med en signerad adress (Vercels funktioner tar
//   högst 4,5 MB, filerna får vara 10 MB) och hämtar med en kort signerad adress (60 sekunder).
//
// Porten äger tabellen case_attachments: raderna skrivs bara här, med service role (policy.ts: write never). Hanteraren
// kontrollerar ALLTID behörigheten först (ärendet via ctx.repo, rollen, den egna uppladdningen). Porten kontrollerar typ,
// storlek och filsignatur.
//
// Filnamnet visas bara i appen. Det hamnar aldrig i lagringens sökväg, i en URL eller i revisionsloggen: sökvägen är
// "<avtal>/<id>.<ändelse>" och adressen för nedladdning saknar parametern download.
//
// Livscykel:
//   createUpload  -> status pending (rad + uppladdningsadress i appen; ingen adress i minnet)
//   confirm       -> uploaded (storlek och filsignatur kontrolleras – annars raderas filen: deleted, reason invalid)
//   link          -> kopplas till ärendet när beställningen skickas (caseId, linkedAt)
//   signedDownload-> kort signerad adress (appen) eller innehållet (minnet)
//   remove        -> filen raderas ur lagringen, raden får status deleted, deletedAt och orsak (spåret finns kvar)
// Gallringen (jobbet attachments_retention): uppladdningar som aldrig kopplades raderas efter 24 timmar; bilagor i avslutade
// och avböjda ärenden raderas enligt avtalets retentionRules.attachmentsAfterCloseDays (ATT_FASTSTÄLLA = inget raderas); och
// filer i lagringen utan levande rad raderas (avstämningen – en signerad uppladdningsadress gäller i 2 timmar och kan användas
// igen efter att filen tagits bort eller avvisats, granskningen 2026-10-07).
import { ApiError, type Ctx } from "@/api/server";
import {
  ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES_TEXT, attachmentMime, attachmentStoragePath, cleanFileName, signatureMatches,
} from "@/core/attachments";
import type { LocalDateTime } from "@/core/time";
import type { AppRepo, AttachmentDeleteReason, CaseAttachment } from "@/data/schema";

export type { CaseAttachment };

// ---------------------------------------------------------------- Konstanter och rena funktioner (src/core/attachments.ts)
export {
  ATTACHMENT_ACCEPT, ATTACHMENT_BUCKET, ATTACHMENT_DOWNLOAD_SECONDS, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES, ATTACHMENT_MIME_TYPES, ATTACHMENT_NAME_MAX,
  ATTACHMENT_TYPES, ATTACHMENT_TYPES_TEXT, ATTACHMENT_UNLINKED_HOURS, attachmentMime, attachmentStoragePath, attachmentUnlinkedOverdue, cleanFileName,
  fileSizeText, signatureMatches,
} from "@/core/attachments";

/** Kontroll före createUpload (samma i båda körlägena): namn, typ och storlek. Kastar ApiError 400 med text till användaren. */
export function validateAttachment(meta: { fileName: string; mimeType: string; bytes: number }): { fileName: string; mimeType: string } {
  const fileName = cleanFileName(meta.fileName);
  if (!fileName) throw new ApiError(400, "attachment_name", "Filen saknar namn.");
  const mimeType = attachmentMime(fileName, meta.mimeType);
  if (!mimeType) throw new ApiError(400, "attachment_type", `Filtypen tas inte emot. Bifoga ${ATTACHMENT_TYPES_TEXT}.`);
  if (!(meta.bytes > 0)) throw new ApiError(400, "attachment_empty", "Filen är tom.");
  if (meta.bytes > ATTACHMENT_MAX_BYTES) throw new ApiError(400, "attachment_size", "Filen är större än 10 MB.");
  return { fileName, mimeType };
}


// ---------------------------------------------------------------- Typerna
export type AttachmentUploadMeta = { contractId: string; caseId: string | null; ownerId: string; fileName: string; mimeType: string; bytes: number };
/** Var webbläsaren laddar upp filen. uploadUrl null = minnesläget/prototypen (innehållet skickas med i confirm). */
export type AttachmentTicket = { attachmentId: string; uploadUrl: string | null; token: string | null; maxBytes: number };
/** Nedladdning: en kort signerad adress (appen) eller innehållet (minnet). placeholder = innehållet finns inte kvar (prototypen). */
export type AttachmentDownload = { url: string | null; content: Uint8Array | null; placeholder?: boolean };

export interface AttachmentPort {
  /** Skapa raden (pending) och uppladdningsadressen. Kastar ApiError 400 vid fel namn, typ eller storlek. */
  createUpload(meta: AttachmentUploadMeta): Promise<AttachmentTicket>;
  /**
   * Filen är uppladdad: kontrollera storlek och filsignatur och sätt status uploaded. content = filens innehåll i minnesläget
   * (appen läser filen ur lagringen). Fel storlek eller signatur: filen raderas (reason invalid) och svaret är null.
   */
  confirm(id: string, content?: Uint8Array | null): Promise<CaseAttachment | null>;
  /**
   * Lägg in en fil från servern (mejlinläsningen, beslut 4c 2026-10-08): raden skapas och innehållet kontrolleras (typ,
   * storlek, filsignatur) och sparas i ett steg – status uploaded. Null om filen inte togs emot (ingen rad finns då kvar).
   */
  store(meta: AttachmentUploadMeta, content: Uint8Array): Promise<CaseAttachment | null>;
  /** Koppla uppladdade filer (utan ärende) till ärendet. */
  link(ids: readonly string[], caseId: string): Promise<void>;
  /** Adressen eller innehållet för nedladdning. Null om filen saknas eller är raderad. */
  signedDownload(id: string): Promise<AttachmentDownload | null>;
  /** Radera filen ur lagringen (status deleted). Idempotent. by = den som tog bort (reason removed). */
  remove(id: string, reason: AttachmentDeleteReason, by?: string | null): Promise<void>;
  /** Sökvägarna ("<avtal>/<id>.<ändelse>") till alla filer som finns i lagringen – för avstämningen i gallringen. */
  listStoredPaths(): Promise<string[]>;
  /** Radera en fil som saknar levande rad (avstämningen). Raden ändras inte. En fil som inte finns är inget fel. */
  removeStoredFile(path: string): Promise<void>;
}

/** Bilagans id ur sökvägen "<avtal>/<id>.<ändelse>" (för revisionsloggen vid avstämningen), eller null. */
export function attachmentIdOfPath(path: string): { contractId: string; id: string } | null {
  const m = /^([^/]+)\/([^/.]+)\.[a-z0-9]+$/.exec(path);
  return m ? { contractId: m[1], id: m[2] } : null;
}

/** ctx.attachments, eller ApiError 500 om lagringen inte är inkopplad i körläget. */
export function requireAttachments(ctx: Pick<Ctx, "attachments">): AttachmentPort {
  if (!ctx.attachments) throw new ApiError(500, "attachments_unavailable", "Det går inte att bifoga filer just nu. Skriv bakgrunden i textfältet i stället.");
  return ctx.attachments;
}

/** Raden för en ny uppladdning (samma i båda körlägena). */
export function newAttachmentRow(id: string, meta: AttachmentUploadMeta, mimeType: string, fileName: string, now: LocalDateTime): CaseAttachment {
  return {
    id, contractId: meta.contractId, caseId: meta.caseId, uploadedBy: meta.ownerId, fileName, mimeType, bytes: meta.bytes,
    storagePath: attachmentStoragePath(meta.contractId, id, mimeType), status: "pending", createdAt: now, linkedAt: meta.caseId ? now : null,
    removedAt: null, removedBy: null, deletedAt: null, deleteReason: null,
  };
}

/** Ändringen när en fil raderas. */
export const deletedPatch = (now: LocalDateTime, reason: AttachmentDeleteReason, by?: string | null): Partial<CaseAttachment> => ({
  status: "deleted", deletedAt: now, deleteReason: reason, ...(reason === "removed" ? { removedAt: now, removedBy: by ?? null } : {}),
});

// ---------------------------------------------------------------- Minnesläget
export type MemoryAttachments = AttachmentPort & {
  /** Antal filer med innehåll i minnet. */
  stored(): number;
};

/** Platshållaren när innehållet inte finns i minnet (t.ex. efter omladdning av prototypen). */
export const MEMORY_PLACEHOLDER_TEXT = "Filen finns inte kvar i prototypen. I den riktiga tjänsten laddas den uppladdade filen ned här.";

/**
 * Bilagor i minnet för prototypen och minnesläget. Raderna skrivs via system (service role i minnet) – deterministiskt: id via
 * newId och tid via now, så att prototypens uppspelning av kommandon ger samma rader. Innehållet finns bara i minnet.
 * Utan innehåll (kommandot spelas upp i prototypen, där innehållet aldrig sparas i loggen) godtas filen utan signaturkontroll
 * och nedladdningen ger en platshållare.
 */
export function createMemoryAttachments(o: { system: AppRepo; now: () => LocalDateTime; newId: (prefix: string) => string }): MemoryAttachments {
  const blobs = new Map<string, Uint8Array>();
  // Sökvägen för varje fil i minnet (avstämningen i gallringen läser lagringen på sökväg, som bucketen).
  const pathOf = new Map<string, string>();
  const table = () => o.system.table("case_attachments");
  return {
    async createUpload(meta) {
      const { fileName, mimeType } = validateAttachment(meta);
      const id = o.newId("att");
      await table().insert(newAttachmentRow(id, meta, mimeType, fileName, o.now()));
      return { attachmentId: id, uploadUrl: null, token: null, maxBytes: ATTACHMENT_MAX_BYTES };
    },
    async confirm(id, content) {
      const a = await table().get(id);
      if (!a || (a.status !== "pending" && a.status !== "uploaded")) return null;
      if (content) {
        if (content.byteLength > ATTACHMENT_MAX_BYTES || content.byteLength === 0 || !signatureMatches(a.mimeType, content.slice(0, 16))) {
          await table().update(id, deletedPatch(o.now(), "invalid"));
          return null;
        }
        blobs.set(id, content);
        pathOf.set(id, a.storagePath);
        return table().update(id, { status: "uploaded", bytes: content.byteLength });
      }
      return table().update(id, { status: "uploaded" });
    },
    async store(meta, content) {
      let fileName: string;
      let mimeType: string;
      try {
        ({ fileName, mimeType } = validateAttachment({ ...meta, bytes: content.byteLength }));
      } catch {
        return null;
      }
      if (!signatureMatches(mimeType, content.slice(0, 16))) return null;
      const id = o.newId("att");
      const row = await table().insert({ ...newAttachmentRow(id, { ...meta, bytes: content.byteLength }, mimeType, fileName, o.now()), status: "uploaded" });
      blobs.set(id, content);
      pathOf.set(id, row.storagePath);
      return row;
    },
    async link(ids, caseId) {
      for (const id of ids) await table().update(id, { caseId, linkedAt: o.now() });
    },
    async signedDownload(id) {
      const a = await table().get(id);
      if (!a || a.status !== "uploaded") return null;
      const blob = blobs.get(id);
      return blob ? { url: null, content: blob } : { url: null, content: new TextEncoder().encode(MEMORY_PLACEHOLDER_TEXT), placeholder: true };
    },
    async remove(id, reason, by) {
      const a = await table().get(id);
      if (!a || a.status === "deleted") return;
      blobs.delete(id);
      pathOf.delete(id);
      await table().update(id, deletedPatch(o.now(), reason, by));
    },
    async listStoredPaths() {
      return [...blobs.keys()].map((id) => pathOf.get(id)).filter((p): p is string => !!p).sort();
    },
    async removeStoredFile(path) {
      for (const [id, p] of pathOf) {
        if (p !== path) continue;
        blobs.delete(id);
        pathOf.delete(id);
      }
    },
    stored: () => blobs.size,
  };
}
