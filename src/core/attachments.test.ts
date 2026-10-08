// Bilagor till beställningen (beslut 2026-10-07, synpunkt #7): filtyp, namn, sökväg i lagringen, storlek som text,
// filsignatur och gallringen av uppladdningar som aldrig kopplades.
import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MAX_BYTES, attachmentMime, attachmentStoragePath, attachmentUnlinkedOverdue, cleanFileName, fileSizeText, signatureMatches,
} from "./attachments";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)].slice(0, 16));
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)).concat(new Array(16).fill(0)).slice(0, 16));

describe("attachmentMime", () => {
  it("PDF, Word och bild – webbläsarens typ gäller, annars filändelsen", () => {
    expect(attachmentMime("kartlaggning.pdf", "application/pdf")).toBe("application/pdf");
    expect(attachmentMime("intyg.docx", "")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(attachmentMime("intyg.DOC", "application/octet-stream")).toBe("application/msword");
    expect(attachmentMime("foto.HEIC", "")).toBe("image/heic");
    expect(attachmentMime("foto.jpeg", "image/jpeg; charset=binary")).toBe("image/jpeg");
  });
  it("andra typer tas inte emot – också när filändelsen ser rätt ut men typen är fel", () => {
    for (const [name, mime] of [["arkiv.zip", "application/zip"], ["skript.exe", ""], ["dokument.pdf", "text/html"], ["bild.gif", "image/gif"], ["utan-andelse", ""]]) {
      expect(attachmentMime(name, mime), name).toBeNull();
    }
  });
});

describe("cleanFileName och sökvägen i lagringen", () => {
  it("namnet utan sökväg och kontrolltecken, högst 200 tecken", () => {
    expect(cleanFileName("C:\\Users\\maria\\Kartläggning\tNadia.pdf")).toBe("Kartläggning Nadia.pdf");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("   ")).toBe("");
    expect([...cleanFileName(`${"å".repeat(300)}.pdf`)]).toHaveLength(200);
  });
  it("sökvägen har bara avtal, id och ändelse – aldrig filnamnet", () => {
    expect(attachmentStoragePath("c-bot", "att-n00012", "application/pdf")).toBe("c-bot/att-n00012.pdf");
    expect(attachmentStoragePath("c-bot", "att-x", "image/heic")).toBe("c-bot/att-x.heic");
    expect(attachmentStoragePath("c-bot", "att-y", "text/plain")).toBe("c-bot/att-y.bin");
  });
});

describe("fileSizeText", () => {
  it("kB eller MB med decimalkomma", () => {
    expect(fileSizeText(1)).toBe("1 kB");
    expect(fileSizeText(320 * 1024)).toBe("320 kB");
    expect(fileSizeText(2.4 * 1024 * 1024)).toBe("2,4 MB");
    expect(fileSizeText(ATTACHMENT_MAX_BYTES)).toBe("10,0 MB");
  });
});

describe("signatureMatches", () => {
  it("filens första byte stämmer med typen", () => {
    expect(signatureMatches("application/pdf", ascii("%PDF-1.7"))).toBe(true);
    expect(signatureMatches("application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes(0x50, 0x4b, 0x03, 0x04))).toBe(true);
    expect(signatureMatches("application/msword", bytes(0xd0, 0xcf, 0x11, 0xe0))).toBe(true);
    expect(signatureMatches("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(signatureMatches("image/png", bytes(0x89, 0x50, 0x4e, 0x47))).toBe(true);
    expect(signatureMatches("image/heic", ascii("\0\0\0\x18ftypheic"))).toBe(true);
  });
  it("en fil som utger sig för att vara något annat stoppas", () => {
    expect(signatureMatches("application/pdf", ascii("<html><script>"))).toBe(false);
    expect(signatureMatches("image/png", ascii("%PDF-1.7"))).toBe(false);
    expect(signatureMatches("image/heic", ascii("\0\0\0\x18ftypisom"))).toBe(false);
    expect(signatureMatches("application/zip", bytes(0x50, 0x4b, 0x03, 0x04))).toBe(false);
  });
});

describe("attachmentUnlinkedOverdue", () => {
  const a = (patch: Partial<{ status: string; caseId: string | null; createdAt: string }> = {}) => ({ status: "uploaded", caseId: null, createdAt: "2027-02-01T09:00", ...patch });
  it("en uppladdning som aldrig kopplades raderas efter 24 timmar – inte en kopplad eller redan raderad", () => {
    expect(attachmentUnlinkedOverdue(a(), "2027-02-02T08:59")).toBe(false);
    expect(attachmentUnlinkedOverdue(a(), "2027-02-02T09:00")).toBe(true);
    expect(attachmentUnlinkedOverdue(a({ status: "pending" }), "2027-02-03T09:00")).toBe(true);
    expect(attachmentUnlinkedOverdue(a({ caseId: "case-1" }), "2027-02-03T09:00")).toBe(false);
    expect(attachmentUnlinkedOverdue(a({ status: "deleted" }), "2027-02-03T09:00")).toBe(false);
  });
});
