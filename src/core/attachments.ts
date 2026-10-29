// Bilagor till beställningen (beslut 2026-10-07, synpunkt #7) och filer på deltagarkortet (Karims beslut 2026-10-29) –
// konstanter och rena funktioner utan I/O. Används av porten (src/features/_shared/attachment-port.ts), servern
// (src/server/attachments), hanterarna och skärmarna (filväljaren i beställningen, kortet Filer på deltagarkortet).
import type { Role } from "@/api/roles";
import type { CaseStatus, ParticipantFileCategory } from "@/data/schema";
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
/**
 * Den signerade uppladdningsadressen gäller så här många timmar (Supabase Storage, går inte att ändra). Så länge kan en påbörjad
 * uppladdning (pending) fortfarande bli klar – därför räknas den mot det högsta antalet filer på deltagarkortet så länge.
 */
export const ATTACHMENT_UPLOAD_URL_HOURS = 2;
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

/**
 * En uppladdning i ett ärende som aldrig blev klar (status pending – filen kontrollerades aldrig och visas inte) och är äldre än
 * 24 timmar. Städningen raderar den (beslut 2026-10-29): det är ingen handling i ärendet, bara en avbruten uppladdning – t.ex.
 * att webbläsaren stängdes mellan uppladdningen och kontrollen. Uppladdade filer i ett ärende rörs aldrig (beslut 5, 2026-10-08).
 */
export function attachmentUnconfirmedOverdue(a: { status: string; caseId: string | null; createdAt: LocalDateTime }, now: LocalDateTime): boolean {
  return a.status === "pending" && !!a.caseId && ms(now) - ms(a.createdAt) >= ATTACHMENT_UNLINKED_HOURS * 3600_000;
}

// ---------------------------------------------------------------- Filer på deltagarkortet (Karims beslut 2026-10-29, 0037)
// "Vi vill kunna ladda upp filer på deltagares profiler. Typ CVn o så." – bara Miljonbemanning, aldrig kommunen. Samma
// filtyper, storlek och filsignatur som bilagorna till beställningen; egen gräns för antalet.

/** Läser bilagorna och deltagarfilerna i ärendet med full åtkomst (RLS case_attachments_select, policy.ts) – och laddar upp, öppnar och tar bort deltagarfiler. Aldrig ekonom, chef, admin eller kommunen. */
export const PARTICIPANT_FILE_ROLES: readonly Role[] = ["samordnare", "avtalsansvarig", "coach"];
/** Högst så här många filer på deltagarkortet per ärende (plattformsregel – inte ett avtalsvärde). Räknas skilt från beställningens bilagor. */
export const PARTICIPANT_FILE_MAX_FILES = 30;
/**
 * Ärenden där filer kan laddas upp: bekräftade, pågående, pausade och avslutade (t.ex. ett intyg som kommer efter avslutet).
 * Inte innan beställningen är bekräftad (inkommen, ordererkänd) och inte i en avböjd beställning – då är deltagaren inte
 * Miljonbemannings. Ta bort och öppna går i alla lägen.
 */
export const PARTICIPANT_FILE_UPLOAD_STATUSES: readonly CaseStatus[] = ["confirmed", "active", "paused", "closed"];
export const participantFileUploadOpen = (status: CaseStatus): boolean => PARTICIPANT_FILE_UPLOAD_STATUSES.includes(status);
/**
 * En påbörjad uppladdning som fortfarande kan bli klar: status pending och yngre än uppladdningsadressen (2 timmar). Räknas mot
 * det högsta antalet. En äldre påbörjad uppladdning kan aldrig bli klar och räknas inte – städningen raderar den efter 24 timmar.
 */
export function attachmentUploadInProgress(a: { status: string; createdAt: LocalDateTime }, now: LocalDateTime): boolean {
  return a.status === "pending" && ms(now) - ms(a.createdAt) < ATTACHMENT_UPLOAD_URL_HOURS * 3600_000;
}

/**
 * Det högsta antalet filer på deltagarkortet – samma räkning i kortet Filer (arenden.kortOversikt, files) och i kontrollen när en
 * uppladdning börjar (arenden.deltagarfilStart): uppladdade filer plus uppladdningar som pågår (attachmentUploadInProgress).
 * rows = ärendets deltagarfiler (alla lägen). full = det går inte att börja en ny uppladdning; text säger varför (null = går bra).
 */
export function participantFileSlots(
  rows: readonly { status: string; createdAt: LocalDateTime }[],
  now: LocalDateTime,
  max: number = PARTICIPANT_FILE_MAX_FILES,
): { uploaded: number; inProgress: number; full: boolean; text: string | null } {
  const uploaded = rows.filter((a) => a.status === "uploaded").length;
  const inProgress = rows.filter((a) => attachmentUploadInProgress(a, now)).length;
  const full = uploaded + inProgress >= max;
  if (!full) return { uploaded, inProgress, full, text: null };
  if (uploaded >= max) return { uploaded, inProgress, full, text: `Deltagaren har ${max} filer, vilket är det högsta antalet. Ta bort en fil som inte behövs för att ladda upp en ny.` };
  return {
    uploaded, inProgress, full,
    text:
      `Deltagaren har ${uploaded} filer och ${inProgress === 1 ? "en uppladdning" : `${inProgress} uppladdningar`} som inte är ${inProgress === 1 ? "klar" : "klara"}. ` +
      `Högst ${max} filer får finnas. En uppladdning som inte blev klar räknas inte efter ${ATTACHMENT_UPLOAD_URL_HOURS} timmar. ` +
      "Ta bort en fil som inte behövs för att ladda upp en ny nu.",
  };
}

/** Varför filer inte kan laddas upp i ärendet just nu, eller null. */
export function participantFileUploadBlocked(status: CaseStatus): string | null {
  if (participantFileUploadOpen(status)) return null;
  if (status === "declined") return "Beställningen är avböjd. Det går inte att ladda upp filer.";
  return "Filer kan laddas upp när beställningen är bekräftad.";
}

/** Typerna i den ordning de visas (kortet Filer och valet i Ladda upp fil). */
export const PARTICIPANT_FILE_CATEGORY_LABEL: Readonly<Record<ParticipantFileCategory, string>> = {
  cv: "CV",
  personligt_brev: "Personligt brev",
  betyg_intyg: "Betyg och intyg",
  ovrigt: "Övrigt",
};
/** Hjälptexten vid filväljaren i Ladda upp fil. */
export const PARTICIPANT_FILE_HELP = "PDF, Word eller bild, högst 10 MB. Filerna syns bara för Miljonbemanning – aldrig för kommunen.";

/** Grupperna i kortet Filer: alla fyra typer i ordning, nyaste filen först i varje grupp. */
export function groupParticipantFiles<T extends { category: ParticipantFileCategory; createdAt: string; id: string }>(
  files: readonly T[],
): { category: ParticipantFileCategory; label: string; files: T[] }[] {
  const order = Object.keys(PARTICIPANT_FILE_CATEGORY_LABEL) as ParticipantFileCategory[];
  const newest = (a: T, b: T) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : a.id < b.id ? 1 : -1);
  return order.map((category) => ({ category, label: PARTICIPANT_FILE_CATEGORY_LABEL[category], files: files.filter((f) => f.category === category).sort(newest) }));
}
