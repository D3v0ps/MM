// ctx.attachments på servern: bilagorna i Supabase Storage, privat bucket "bilagor" i Stockholm (0024_bilagor.sql).
// Samma livscykel som minnesläget (createMemoryAttachments i src/features/_shared/attachment-port.ts):
//   createUpload  rad i case_attachments (pending) + signerad uppladdningsadress – webbläsaren laddar upp direkt till Storage
//                 (Vercels funktioner tar högst 4,5 MB, filerna får vara 10 MB). Sökvägen har bara avtal och id.
//   confirm       filen finns, storleken (från lagringen, inte från klienten) och filsignaturen stämmer -> uploaded;
//                 annars raderas filen (reason invalid)
//   link          kopplas till ärendet när beställningen skickas
//   signedDownload  signerad adress som gäller i 60 sekunder – UTAN parametern download, så att filnamnet aldrig hamnar i en
//                 URL. Webbläsaren hämtar filen och sparar den med filnamnet ur svaret (useDownload).
//   remove        filen raderas ur bucketen, raden får status deleted (spåret finns kvar, utan innehåll)
//   listStoredPaths / removeStoredFile  avstämningen i gallringen: filer i bucketen utan levande rad raderas. Den signerade
//                 uppladdningsadressen gäller i 2 timmar och kan inte återkallas – efter "Ta bort" eller en avvisad fil kan
//                 samma adress användas igen så länge filen inte finns (granskningen 2026-10-07).
// Raderna skrivs med service role (ctx.system) – användare läser bara (RLS). Hanteraren har redan kontrollerat behörigheten.
// Bucketen nås bara med service role (inga policyer på storage.objects). Felmeddelanden innehåller aldrig sökvägar eller namn.
import {
  ATTACHMENT_BUCKET, ATTACHMENT_DOWNLOAD_SECONDS, ATTACHMENT_MAX_BYTES, deletedPatch, newAttachmentRow, signatureMatches, validateAttachment,
  type AttachmentPort,
} from "@/features/_shared/attachment-port";
import type { LocalDateTime } from "@/core/time";
import type { AppRepo } from "@/data/schema";

/** Den del av lagringen som porten behöver (Supabase Storage i drift, en fejk i testerna). */
export interface AttachmentStorage {
  createSignedUploadUrl(path: string): Promise<{ signedUrl: string; token: string }>;
  /** Filens storlek i byte, eller null om filen inte finns. */
  size(path: string): Promise<number | null>;
  /** Filens början (för filsignaturen), eller null om filen inte finns. */
  head(path: string): Promise<Uint8Array | null>;
  /** Signerad adress för nedladdning som gäller i så många sekunder – utan filnamn. */
  createSignedUrl(path: string, seconds: number): Promise<string>;
  /** Radera filen. Ingen fil är inget fel. */
  remove(path: string): Promise<void>;
  /** Alla filers sökvägar i bucketen ("<avtal>/<id>.<ändelse>"). */
  list(): Promise<string[]>;
}

/** Fel i lagringen. Meddelandet innehåller bara steget och en felkod – aldrig sökväg, filnamn eller innehåll. */
export class AttachmentStorageError extends Error {
  constructor(public readonly step: "sign" | "info" | "download" | "remove" | "list", public readonly code: string) {
    super(`Bilagorna: ${step} misslyckades${code ? ` (${code})` : ""}`);
    this.name = "AttachmentStorageError";
  }
}

export function createStorageAttachments(o: { system: AppRepo; storage: AttachmentStorage; now: () => LocalDateTime; newId: (prefix: string) => string }): AttachmentPort {
  // ctx.system (service role): bilagornas rader skrivs bara av systemet (policy.ts: case_attachments.write = never).
  const table = () => o.system.table("case_attachments");
  return {
    async createUpload(meta) {
      const { fileName, mimeType } = validateAttachment(meta);
      const id = o.newId("att");
      const row = newAttachmentRow(id, meta, mimeType, fileName, o.now());
      // Raden först: finns en fil i bucketen finns alltid spåret, och gallringen hittar den (senast efter 24 timmar).
      await table().insert(row);
      const signed = await o.storage.createSignedUploadUrl(row.storagePath);
      return { attachmentId: id, uploadUrl: signed.signedUrl, token: signed.token, maxBytes: ATTACHMENT_MAX_BYTES };
    },
    async confirm(id) {
      const a = await table().get(id);
      if (!a || (a.status !== "pending" && a.status !== "uploaded")) return null;
      const size = await o.storage.size(a.storagePath);
      if (size == null) return null;
      const head = size > 0 && size <= ATTACHMENT_MAX_BYTES ? await o.storage.head(a.storagePath) : null;
      if (!head || !signatureMatches(a.mimeType, head)) {
        // Fel storlek eller filen är inte det den säger sig vara: radera direkt.
        await o.storage.remove(a.storagePath);
        await table().update(id, { ...deletedPatch(o.now(), "invalid"), bytes: Math.max(1, size) });
        return null;
      }
      return table().update(id, { status: "uploaded", bytes: size });
    },
    async link(ids, caseId) {
      for (const id of ids) await table().update(id, { caseId, linkedAt: o.now() });
    },
    async signedDownload(id) {
      const a = await table().get(id);
      if (!a || a.status !== "uploaded") return null;
      return { url: await o.storage.createSignedUrl(a.storagePath, ATTACHMENT_DOWNLOAD_SECONDS), content: null };
    },
    async remove(id, reason, by) {
      const a = await table().get(id);
      if (!a || a.status === "deleted") return;
      // Filen raderas först. Misslyckas det står raden kvar oraderad och gallringen försöker igen.
      await o.storage.remove(a.storagePath);
      await table().update(id, deletedPatch(o.now(), reason, by));
    },
    listStoredPaths: () => o.storage.list(),
    removeStoredFile: (path) => o.storage.remove(path),
  };
}

// ---------------------------------------------------------------- Supabase Storage
/** Den del av supabase-js lagringsklient som används (bucketen "bilagor"). */
export interface AttachmentBucketLike {
  createSignedUploadUrl(path: string): PromiseLike<{ data: { signedUrl: string; token: string; path: string } | null; error: unknown }>;
  createSignedUrl(path: string, expiresIn: number): PromiseLike<{ data: { signedUrl: string } | null; error: unknown }>;
  exists(path: string): PromiseLike<{ data: boolean; error: unknown }>;
  info(path: string): PromiseLike<{ data: { size?: number | null } | null; error: unknown }>;
  download(path: string): PromiseLike<{ data: Blob | null; error: unknown }>;
  remove(paths: string[]): PromiseLike<{ data: unknown; error: unknown }>;
  list(prefix?: string, options?: { limit?: number; offset?: number }): PromiseLike<{ data: { name: string; id?: string | null }[] | null; error: unknown }>;
}
export interface AttachmentStorageClientLike {
  storage: { from(bucket: string): AttachmentBucketLike };
}

const errCode = (e: unknown): string => {
  const x = e as { status?: unknown; statusCode?: unknown } | null;
  return String(x?.statusCode ?? x?.status ?? "");
};

/** Bucketen "bilagor" via service role-klienten. */
export function supabaseAttachmentStorage(client: AttachmentStorageClientLike, bucket: string = ATTACHMENT_BUCKET): AttachmentStorage {
  const b = () => client.storage.from(bucket);
  return {
    async createSignedUploadUrl(path) {
      const { data, error } = await b().createSignedUploadUrl(path);
      if (error || !data) throw new AttachmentStorageError("sign", errCode(error));
      return { signedUrl: data.signedUrl, token: data.token };
    },
    async size(path) {
      const ex = await b().exists(path);
      if (!ex.data) {
        if (ex.error && !["400", "404"].includes(errCode(ex.error))) throw new AttachmentStorageError("info", errCode(ex.error));
        return null;
      }
      const { data, error } = await b().info(path);
      if (error || !data) throw new AttachmentStorageError("info", errCode(error));
      return typeof data.size === "number" ? data.size : 0;
    },
    async head(path) {
      // Filen är högst 10 MB (bucketens gräns). Bara början används – filen öppnas aldrig.
      const { data, error } = await b().download(path);
      if (error) {
        if (["400", "404"].includes(errCode(error))) return null;
        throw new AttachmentStorageError("download", errCode(error));
      }
      return data ? new Uint8Array(await data.slice(0, 16).arrayBuffer()) : null;
    },
    async createSignedUrl(path, seconds) {
      // Ingen download-parameter: då skulle filnamnet stå i adressen.
      const { data, error } = await b().createSignedUrl(path, seconds);
      if (error || !data) throw new AttachmentStorageError("sign", errCode(error));
      return data.signedUrl;
    },
    async remove(path) {
      const { error } = await b().remove([path]);
      if (error) throw new AttachmentStorageError("remove", errCode(error));
    },
    async list() {
      return listBucketPaths(client, bucket);
    },
  };
}

/** Alla filers sökvägar i bucketen: avtalsmapparna och filerna i dem, i omgångar om 1 000. */
async function listBucketPaths(client: AttachmentStorageClientLike, bucket: string): Promise<string[]> {
  const b = () => client.storage.from(bucket);
  const top = await b().list("", { limit: 1000 });
  if (top.error) throw new AttachmentStorageError("list", errCode(top.error));
  const out: string[] = [];
  for (const folder of (top.data ?? []).filter((f) => !f.id)) {
    for (let offset = 0; ; offset += 1000) {
      const files = await b().list(folder.name, { limit: 1000, offset });
      if (files.error) throw new AttachmentStorageError("list", errCode(files.error));
      const page = files.data ?? [];
      out.push(...page.filter((f) => !!f.id).map((f) => `${folder.name}/${f.name}`));
      if (page.length < 1000) break;
    }
  }
  return out;
}

/**
 * "Läs in testdata på nytt" i testmiljön: töm bucketen (mm.reset_test_data() tömmer tabellen, filerna skulle annars bli kvar
 * utan spår). Sökvägarna är "<avtal>/<id>.<ändelse>". Returnerar antalet raderade filer.
 */
export async function emptyAttachmentBucket(client: AttachmentStorageClientLike, bucket: string = ATTACHMENT_BUCKET): Promise<number> {
  const b = () => client.storage.from(bucket);
  const top = await b().list("", { limit: 1000 });
  if (top.error) throw new AttachmentStorageError("list", errCode(top.error));
  let removed = 0;
  for (const folder of top.data ?? []) {
    // Mapparna (avtalen) saknar id; filerna i dem listas och raderas i omgångar.
    for (;;) {
      const files = await b().list(folder.name, { limit: 1000 });
      if (files.error) throw new AttachmentStorageError("list", errCode(files.error));
      const paths = (files.data ?? []).filter((f) => !!f.id).map((f) => `${folder.name}/${f.name}`);
      if (!paths.length) break;
      const { error } = await b().remove(paths);
      if (error) throw new AttachmentStorageError("remove", errCode(error));
      removed += paths.length;
    }
  }
  return removed;
}
