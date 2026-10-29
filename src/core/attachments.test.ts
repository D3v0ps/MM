// Bilagor till beställningen (beslut 2026-10-07, synpunkt #7): filtyp, namn, sökväg i lagringen, storlek som text,
// filsignatur och gallringen av uppladdningar som aldrig kopplades.
import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MAX_BYTES, ATTACHMENT_UPLOAD_URL_HOURS, attachmentMime, attachmentStoragePath, attachmentUnconfirmedOverdue, attachmentUnlinkedOverdue, attachmentUploadInProgress,
  cleanFileName, fileSizeText, groupParticipantFiles, PARTICIPANT_FILE_CATEGORY_LABEL, PARTICIPANT_FILE_MAX_FILES, PARTICIPANT_FILE_ROLES, participantFileSlots,
  participantFileUploadBlocked, participantFileUploadOpen, signatureMatches,
} from "./attachments";
import { CASE_STATUSES, PARTICIPANT_FILE_CATEGORIES } from "@/data/schema";

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

describe("attachmentUnconfirmedOverdue (2026-10-29)", () => {
  const a = (patch: Partial<{ status: string; caseId: string | null; createdAt: string }> = {}) => ({ status: "pending", caseId: "case-1", createdAt: "2027-02-01T09:00", ...patch });
  it("en uppladdning i ett ärende som aldrig blev klar raderas efter 24 timmar – aldrig en uppladdad fil eller en utan ärende", () => {
    expect(attachmentUnconfirmedOverdue(a(), "2027-02-02T08:59")).toBe(false);
    expect(attachmentUnconfirmedOverdue(a(), "2027-02-02T09:00")).toBe(true);
    expect(attachmentUnconfirmedOverdue(a({ status: "uploaded" }), "2030-01-01T09:00")).toBe(false);
    expect(attachmentUnconfirmedOverdue(a({ status: "deleted" }), "2030-01-01T09:00")).toBe(false);
    // Utan ärende gäller attachmentUnlinkedOverdue – de två överlappar aldrig.
    expect(attachmentUnconfirmedOverdue(a({ caseId: null }), "2030-01-01T09:00")).toBe(false);
  });
});

describe("filer på deltagarkortet (Karims beslut 2026-10-29)", () => {
  it("bara Miljonbemanning: samordnare, avtalsansvarig och coach – aldrig ekonom, chef, admin eller kommunen", () => {
    expect([...PARTICIPANT_FILE_ROLES].sort()).toEqual(["avtalsansvarig", "coach", "samordnare"]);
    expect(PARTICIPANT_FILE_MAX_FILES).toBe(30);
  });
  it("uppladdning i bekräftade, pågående, pausade och avslutade ärenden – med en förklaring annars", () => {
    expect(CASE_STATUSES.filter(participantFileUploadOpen)).toEqual(["confirmed", "active", "paused", "closed"]);
    for (const s of CASE_STATUSES) expect(participantFileUploadBlocked(s) === null, s).toBe(participantFileUploadOpen(s));
    expect(participantFileUploadBlocked("received")).toBe("Filer kan laddas upp när beställningen är bekräftad.");
    expect(participantFileUploadBlocked("acknowledged")).toBe("Filer kan laddas upp när beställningen är bekräftad.");
    expect(participantFileUploadBlocked("declined")).toBe("Beställningen är avböjd. Det går inte att ladda upp filer.");
  });
  it("typerna i ordning med namn i klartext; grupperna har alla fyra typer och nyaste filen först", () => {
    expect(Object.keys(PARTICIPANT_FILE_CATEGORY_LABEL)).toEqual([...PARTICIPANT_FILE_CATEGORIES]);
    expect(Object.values(PARTICIPANT_FILE_CATEGORY_LABEL)).toEqual(["CV", "Personligt brev", "Betyg och intyg", "Övrigt"]);
    const f = (id: string, category: (typeof PARTICIPANT_FILE_CATEGORIES)[number], createdAt: string) => ({ id, category, createdAt });
    const g = groupParticipantFiles([f("a", "cv", "2027-01-10T10:00"), f("b", "ovrigt", "2027-01-11T10:00"), f("c", "cv", "2027-01-12T10:00"), f("d", "cv", "2027-01-12T10:00")]);
    expect(g.map((x) => [x.label, x.files.map((y) => y.id)])).toEqual([["CV", ["d", "c", "a"]], ["Personligt brev", []], ["Betyg och intyg", []], ["Övrigt", ["b"]]]);
  });
  it("det högsta antalet: uppladdade filer plus uppladdningar som pågår – en avbruten uppladdning räknas bara i 2 timmar (granskningen 2026-10-29)", () => {
    expect(ATTACHMENT_UPLOAD_URL_HOURS).toBe(2);
    const row = (status: string, createdAt = "2027-02-01T09:00") => ({ status, createdAt });
    const now = "2027-02-01T10:00";
    expect(attachmentUploadInProgress(row("pending"), "2027-02-01T10:59")).toBe(true);
    expect(attachmentUploadInProgress(row("pending"), "2027-02-01T11:00")).toBe(false);
    expect(attachmentUploadInProgress(row("uploaded"), now)).toBe(false);
    expect(attachmentUploadInProgress(row("deleted"), now)).toBe(false);
    const files = (n: number) => Array.from({ length: n }, () => row("uploaded"));
    expect(participantFileSlots(files(29), now)).toEqual({ uploaded: 29, inProgress: 0, full: false, text: null });
    // Raderade rader räknas aldrig.
    expect(participantFileSlots([...files(29), row("deleted")], now).full).toBe(false);
    expect(participantFileSlots(files(30), now)).toEqual({
      uploaded: 30, inProgress: 0, full: true, text: "Deltagaren har 30 filer, vilket är det högsta antalet. Ta bort en fil som inte behövs för att ladda upp en ny.",
    });
    // 29 filer och en uppladdning som pågår: fullt – och texten säger varför, så att kortet och kontrollen säger samma sak.
    expect(participantFileSlots([...files(29), row("pending", "2027-02-01T09:30")], now)).toEqual({
      uploaded: 29, inProgress: 1, full: true,
      text: "Deltagaren har 29 filer och en uppladdning som inte är klar. Högst 30 filer får finnas. En uppladdning som inte blev klar räknas inte efter 2 timmar. Ta bort en fil som inte behövs för att ladda upp en ny nu.",
    });
    expect(participantFileSlots([...files(28), row("pending"), row("pending")], now).text).toMatch(/^Deltagaren har 28 filer och 2 uppladdningar som inte är klara\./);
    // Efter 2 timmar kan den påbörjade uppladdningen aldrig bli klar – den räknas inte (städningen raderar den efter 24 timmar).
    expect(participantFileSlots([...files(29), row("pending", "2027-02-01T07:59")], now)).toEqual({ uploaded: 29, inProgress: 0, full: false, text: null });
    expect(participantFileSlots([row("pending")], now, 1).full).toBe(true);
  });
});
