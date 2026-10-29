// Testmiljöns platshållare för testdatats filer på deltagarkortet (Karims beslut 2026-10-29): en giltig PDF med påhittad
// text, en per uppladdad fil i testdatat, på testdatats sökväg. Fejkad lagring.
import { describe, expect, it } from "vitest";
import { signatureMatches } from "@/core/attachments";
import { SEED_PARTICIPANT_FILES } from "@/data/seed/decisions-2026-10-29";
import { AttachmentStorageError, type AttachmentBucketLike } from "../attachments/storage";
import { PLACEHOLDER_LINES, placeholderPdf, uploadSeedPlaceholders } from "./placeholders";

const latin1 = (b: Uint8Array) => String.fromCharCode(...b);

describe("placeholderPdf", () => {
  it("en PDF med rätt filsignatur, texten och korrekta byteadresser i xref", () => {
    const pdf = placeholderPdf(PLACEHOLDER_LINES);
    expect(signatureMatches("application/pdf", pdf.slice(0, 16))).toBe(true);
    const s = latin1(pdf);
    expect(s).toContain("(Påhittad testfil) Tj");
    expect(s.endsWith("%%EOF\n")).toBe(true);
    // Varje objekts adress i xref pekar på "n 0 obj", och startxref på "xref".
    const offsets = [...s.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((o, i) => expect(s.slice(o, o + 8)).toBe(`${i + 1} 0 obj\n`));
    const startxref = Number(/startxref\n(\d+)\n/.exec(s)![1]);
    expect(s.slice(startxref, startxref + 4)).toBe("xref");
    // Strömmens längd stämmer.
    const len = Number(/\/Length (\d+)/.exec(s)![1]);
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(s)![1];
    expect(stream.length).toBe(len);
    // Parenteser i texten skyddas.
    expect(latin1(placeholderPdf(["a (b) c"]))).toContain("(a \\(b\\) c) Tj");
  });
});

describe("uploadSeedPlaceholders", () => {
  it("en platshållare per uppladdad PDF i testdatat, på testdatats sökväg – fel i lagringen blir AttachmentStorageError utan sökväg", async () => {
    const put: [string, string | undefined, boolean | undefined][] = [];
    const bucket = {
      upload: async (path: string, _b: Uint8Array, o?: { contentType?: string; upsert?: boolean }) => (put.push([path, o?.contentType, o?.upsert]), { data: null, error: null }),
    };
    const client = { storage: { from: () => bucket as unknown as AttachmentBucketLike } };
    expect(await uploadSeedPlaceholders(client)).toBe(SEED_PARTICIPANT_FILES.length);
    expect(put).toEqual(SEED_PARTICIPANT_FILES.map((f) => [f.storagePath, "application/pdf", true]));
    // Raderade filer och andra typer hoppas över.
    const skip = [
      { storagePath: "c-bot/x.pdf", mimeType: "application/pdf", status: "deleted" as const },
      { storagePath: "c-bot/y.png", mimeType: "image/png", status: "uploaded" as const },
    ];
    expect(await uploadSeedPlaceholders(client, skip)).toBe(0);
    const broken = { storage: { from: () => ({ upload: async () => ({ data: null, error: { statusCode: "403" } }) }) as unknown as AttachmentBucketLike } };
    const err = await uploadSeedPlaceholders(broken).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AttachmentStorageError);
    expect((err as Error).message).toBe("Bilagorna: upload misslyckades (403)");
  });
});
