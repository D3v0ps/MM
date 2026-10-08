// Texten ur en Word-mall: tabellceller blir "Etikett: värde", stycken egna rader. Dokumentet byggs med appens egen zip-kod.
import { describe, expect, it } from "vitest";
import { zip } from "@/core/export/zip";
import { parseInboundMail } from "@/features/inkorg/parse";
import { docxText, looksLikeDocx, zipEntry } from "./docx-text";

const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
const row = (a: string, b: string) => `<w:tr>${cell(a)}${cell(b)}</w:tr>`;
const DOC = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>Avrop enligt avtal 332026110</w:t></w:r></w:p>
<w:tbl>${row("Förnamn:", "Tesfaye")}${row("Efternamn", "Haile")}${row("Personnummer", "19880101-2222")}${row("Önskat startdatum", "8 februari 2027")}${row("Omfattning", "12 månader")}<w:tr>${cell("Bakgrundsinformation")}<w:tc><w:p><w:r><w:t>Har jobbat i lager.</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Vill &amp; kan börja v. 6.</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>Med vänlig hälsning</w:t></w:r></w:p></w:body></w:document>`;

async function build(compress: boolean): Promise<Uint8Array> {
  return zip([{ name: "[Content_Types].xml", data: "<Types/>" }, { name: "word/document.xml", data: DOC }], { compress });
}

describe("docxText", () => {
  it("läser tabellcellerna som etikett och värde (komprimerat och okomprimerat) och tolkningen förstår dem", async () => {
    for (const compress of [true, false]) {
      const file = await build(compress);
      expect(looksLikeDocx(file)).toBe(true);
      expect(new TextDecoder().decode(zipEntry(file, "[Content_Types].xml")!)).toBe("<Types/>");
      const text = docxText(file);
      expect(text).toBe("Förnamn: Tesfaye\nEfternamn: Haile\nPersonnummer: 19880101-2222\nÖnskat startdatum: 8 februari 2027\nOmfattning: 12 månader\nBakgrundsinformation: Har jobbat i lager.\nVill & kan börja v. 6.\n\nAvrop enligt avtal 332026110\nMed vänlig hälsning");
      const r = parseInboundMail({ subject: "Avrop", bodyText: "Se bifogad mall.", attachmentText: text }, { casePrefix: "BOT" });
      expect(r.parseMethod).toBe("template");
      expect(r.extracted).toMatchObject({ firstName: "Tesfaye", lastName: "Haile", pnr: "19880101-2222", desiredStart: "2027-02-08", orderPeriod: "12", background: "Har jobbat i lager.\nVill & kan börja v. 6." });
    }
  });

  it("ett dokument som inte går att läsa ger tom text", () => {
    expect(docxText(new Uint8Array([1, 2, 3]))).toBe("");
    expect(looksLikeDocx(new Uint8Array([1, 2, 3, 4, 5]))).toBe(false);
  });
});
