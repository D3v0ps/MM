// Bilagor till beställningen (beslut 2026-10-07, synpunkt #7) – konstanter och rena funktioner utan I/O. Används av porten
// (src/features/_shared/attachment-port.ts), servern (src/server/attachments) och skärmarna (filväljaren i beställningen).
import { ms, type LocalDateTime } from "./time";

/** Den privata bucketen i Supabase Storage (0024_bilagor.sql). Bara service role läser och skriver. */
export const ATTACHMENT_BUCKET = "bilagor";
/** Största fil som tas emot (samma som bucketens file_size_limit i 0024): 10 MB. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Högst så här många bilagor per beställning (plattformsregel – inte ett avtalsvärde). */
export const ATTACHMENT_MAX_FILES = 10;
/** Uppladdningar som aldrig kopplades till en beställning raderas efter så här många timmar. */
export const ATTACHMENT_UNLINKED_HOURS = 24;
/** Nedladdningsadressen gäller så här många sekunder. */
export const ATTACHMENT_DOWNLOAD_SECONDS = 60;
/** Längsta filnamn som sparas (visas bara i appen). */
export const ATTACHMENT_NAME_MAX = 200;

/** Filtyper som tas emot (grundtypen) och filändelsen i lagringen: PDF, Word och bild. */
export const ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
};
export const ATTACHMENT_MIME_TYPES: readonly string[] = Object.keys(ATTACHMENT_TYPES);
/** Filändelser i filväljaren (accept-attributet). */
export const ATTACHMENT_ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png,.heic";
/** "PDF, Word eller bild (JPG, PNG, HEIC)" – texten vid fältet och i felmeddelandet. */
export const ATTACHMENT_TYPES_TEXT = "PDF, Word eller bild (JPG, PNG eller HEIC)";

const EXT_TO_MIME: Readonly<Record<string, string>> = {
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic",
};

/**
 * Filtypen som tas emot, eller null. Webbläsaren anger ibland ingen typ (t.ex. HEIC) – då gäller filändelsen. Är typen
 * angiven måste den vara en av typerna ovan.
 */
export function attachmentMime(fileName: string, mime: string | null | undefined): string | null {
  const base = String(mime ?? "").split(";")[0].trim().toLowerCase();
  if (base && base !== "application/octet-stream") return base in ATTACHMENT_TYPES ? base : null;
  const ext = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return EXT_TO_MIME[ext] ?? null;
}

/** Filnamnet utan sökväg och kontrolltecken, högst 200 tecken. Tom sträng om inget namn finns kvar. */
export function cleanFileName(name: string): string {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  // Tabb och radbrytning blir mellanslag; övriga kontrolltecken tas bort.
  const clean = base.replace(/[\t\n\r]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return [...clean].slice(0, ATTACHMENT_NAME_MAX).join("");
}

/** Sökvägen i bucketen: bara avtal och id – aldrig filnamn eller personuppgifter. T.ex. "c-bot/att-n00012.pdf". */
export const attachmentStoragePath = (contractId: string, id: string, mime: string): string => `${contractId}/${id}.${ATTACHMENT_TYPES[mime] ?? "bin"}`;

/** "2,4 MB" eller "320 kB". */
export function fileSizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/**
 * Stämmer filens första byte med typen? PDF "%PDF", DOCX "PK\x03\x04" (zip), DOC "D0 CF 11 E0" (OLE), JPEG "FF D8 FF",
 * PNG "89 50 4E 47", HEIC "ftyp" + heic/heix/hevc/mif1/msf1 på plats 4. Filerna öppnas aldrig på servern – bara början läses.
 */
export function signatureMatches(mime: string, head: Uint8Array): boolean {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => head[i + k] === b);
  const ascii = (i: number, n: number) => String.fromCharCode(...head.slice(i, i + n));
  switch (mime) {
    case "application/pdf":
      return ascii(0, 4) === "%PDF";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return at(0, 0x50, 0x4b, 0x03, 0x04);
    case "application/msword":
      return at(0, 0xd0, 0xcf, 0x11, 0xe0);
    case "image/jpeg":
      return at(0, 0xff, 0xd8, 0xff);
    case "image/png":
      return at(0, 0x89, 0x50, 0x4e, 0x47);
    case "image/heic":
      return ascii(4, 4) === "ftyp" && ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(ascii(8, 4));
    default:
      return false;
  }
}


/** Ska uppladdningen raderas av gallringen? Inte kopplad till en beställning och äldre än 24 timmar. */
export function attachmentUnlinkedOverdue(a: { status: string; caseId: string | null; createdAt: LocalDateTime }, now: LocalDateTime): boolean {
  return a.status !== "deleted" && !a.caseId && ms(now) - ms(a.createdAt) >= ATTACHMENT_UNLINKED_HOURS * 3600_000;
}
