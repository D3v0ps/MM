// Testmiljön: en liten påhittad PDF i bucketen "bilagor" för varje fil i testdatat (deltagarfilerna i
// src/data/seed/decisions-2026-10-29.ts, Karims beslut 2026-10-29), så att filerna går att öppna efter "Läs in testdata på nytt"
// (POST /api/staging/seed – bucketen töms först). Bara i testmiljön; innehållet är samma påhittade text för alla filer och
// sökvägen är testdatats ("<avtal>/<id>.pdf"). Inga personuppgifter.
import { ATTACHMENT_BUCKET } from "@/core/attachments";
import type { CaseAttachment } from "@/data/schema";
import { SEED_PARTICIPANT_FILES } from "@/data/seed/decisions-2026-10-29";
import { AttachmentStorageError, type AttachmentStorageClientLike } from "../attachments/storage";

/** Raden i PDF-strängen: parenteser och snedstreck skyddas. */
const pdfText = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

/**
 * En giltig PDF med en sida och några rader text (Helvetica, WinAnsiEncoding – latin1-tecken som å, ä och ö fungerar).
 * Byteadresserna i xref räknas fram, så att alla läsare öppnar filen.
 */
export function placeholderPdf(lines: readonly string[]): Uint8Array {
  const text = lines.map((l, i) => `BT /F1 ${i === 0 ? 16 : 12} Tf 72 ${770 - i * 24} Td (${pdfText(l)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // latin1: ett tecken = en byte (samma räkning som offsets ovan).
  return Uint8Array.from(body, (c) => c.charCodeAt(0) & 0xff);
}

/** Texten i platshållarna. */
export const PLACEHOLDER_LINES = ["Påhittad testfil", "Filen hör till testdatat i Miljonmatchs testmiljö.", "Den innehåller inga riktiga personuppgifter."] as const;

/** Lägg en platshållare i bucketen för varje uppladdad fil i testdatat. Returnerar antalet filer. */
export async function uploadSeedPlaceholders(
  client: AttachmentStorageClientLike,
  rows: readonly Pick<CaseAttachment, "storagePath" | "mimeType" | "status">[] = SEED_PARTICIPANT_FILES,
  bucket: string = ATTACHMENT_BUCKET,
): Promise<number> {
  const pdf = placeholderPdf(PLACEHOLDER_LINES);
  let n = 0;
  for (const r of rows) {
    // Bara PDF i testdatat – andra typer skulle behöva en egen platshållare med rätt filsignatur.
    if (r.status !== "uploaded" || r.mimeType !== "application/pdf") continue;
    const { error } = await client.storage.from(bucket).upload(r.storagePath, pdf, { contentType: "application/pdf", upsert: true });
    if (error) throw new AttachmentStorageError("upload", String((error as { statusCode?: unknown; status?: unknown }).statusCode ?? (error as { status?: unknown }).status ?? ""));
    n++;
  }
  return n;
}
