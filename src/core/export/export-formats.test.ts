// Filformaten för resultatfilen (rapporter steg 3): CSV, zip och Excel – utan beroenden, så att de fungerar likadant i
// Next, i prototypens enda HTML-fil och i testerna.
import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./base64";
import { csvCell, toCsv, type CsvColumn } from "./csv";
import { entryText, readZip } from "./read-zip.test-helper";
import { buildXlsx, colName, xlsxParts, xmlText, type XlsxSheet } from "./xlsx";
import { crc32, zip } from "./zip";

describe("csv", () => {
  const cols: CsvColumn[] = [
    { key: "arendenummer", type: "text" }, { key: "namn", type: "text" }, { key: "veckor", type: "int" }, { key: "procent", type: "decimal1" },
    { key: "datum", type: "date" }, { key: "manad", type: "month" }, { key: "flagga", type: "bool01" },
  ];
  it("semikolon, CRLF, rubrikrad, decimalkomma, tom cell och 1/0", () => {
    const csv = toCsv(cols, [
      { arendenummer: "BOT-26-0001", namn: "Alex Exempelsson", veckor: 5, procent: 88.94, datum: "2026-10-01", manad: "2026-10", flagga: true },
      { arendenummer: "BOT-26-0002", namn: null, veckor: 0, procent: null, datum: null, manad: "2026-11", flagga: false },
    ]);
    expect(csv).toBe(
      "arendenummer;namn;veckor;procent;datum;manad;flagga\r\n" +
        "BOT-26-0001;Alex Exempelsson;5;88,9;2026-10-01;2026-10;1\r\n" +
        "BOT-26-0002;;0;;;2026-11;0\r\n",
    );
    expect(csv.split("\r\n")[0]).toMatch(/^[a-z0-9_;]+$/);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  });
  it("citattecken runt ; \" CR och LF – citattecken dubbleras", () => {
    expect(csvCell("text", "a;b")).toBe('"a;b"');
    expect(csvCell("text", 'Han sa "hej"')).toBe('"Han sa ""hej"""');
    expect(csvCell("text", "rad 1\nrad 2")).toBe('"rad 1\nrad 2"');
    expect(csvCell("text", "rad 1\r\nrad 2")).toBe('"rad 1\r\nrad 2"');
  });
  it("formelskydd för =, +, -, @, tabb och CR i textceller – inte i talceller", () => {
    expect(csvCell("text", "=SUMMA(A1:A2)")).toBe("'=SUMMA(A1:A2)");
    expect(csvCell("text", "+46701234567")).toBe("'+46701234567");
    expect(csvCell("text", "-1")).toBe("'-1");
    expect(csvCell("text", "@cmd")).toBe("'@cmd");
    expect(csvCell("text", "\tx")).toBe("'\tx");
    expect(csvCell("text", "\rx")).toBe("\"'\rx\"");
    expect(csvCell("int", -3)).toBe("-3");
    expect(csvCell("decimal1", -0.5)).toBe("-0,5");
    expect(csvCell("text", "Lager och logistik")).toBe("Lager och logistik");
  });
});

describe("base64", () => {
  it("fram och tillbaka, med och utan utfyllnad", () => {
    for (const s of ["", "a", "ab", "abc", "abcd", "Å ä ö – PK\u0003\u0004"]) {
      const b = new TextEncoder().encode(s);
      const enc = bytesToBase64(b);
      expect(enc).toBe(Buffer.from(b).toString("base64"));
      expect(new TextDecoder().decode(base64ToBytes(enc))).toBe(s);
    }
    expect(() => base64ToBytes("abc")).toThrow();
  });
});

describe("zip", () => {
  it("CRC32 mot kända värden", () => {
    expect(crc32("")).toBe(0);
    expect(crc32("123456789")).toBe(0xcbf43926);
    expect(crc32("The quick brown fox jumps over the lazy dog")).toBe(0x414fa339);
  });
  it("posterna går att läsa tillbaka: lokala huvuden, centralkatalog, namn, CRC och storlek (STORE och DEFLATE)", async () => {
    const big = "rad;med;data\r\n".repeat(500);
    for (const compress of [false, true]) {
      const buf = await zip([{ name: "a.txt", data: "hej" }, { name: "mapp/b.csv", data: big }], { date: "2027-02-01T09:12", compress });
      expect(String.fromCharCode(buf[0], buf[1])).toBe("PK");
      const es = await readZip(buf);
      expect(es.map((e) => e.name)).toEqual(["a.txt", "mapp/b.csv"]);
      expect(es.map((e) => e.crc)).toEqual([crc32("hej"), crc32(big)]);
      expect(es.map((e) => e.usize)).toEqual([3, big.length]);
      expect(entryText(es, "mapp/b.csv")).toBe(big);
      // DEFLATE används bara när den gör posten mindre ("hej" lagras alltid okomprimerad).
      expect(es.map((e) => e.method)).toEqual(compress ? [0, 8] : [0, 0]);
    }
  });
  it("samma indata och tid ger samma bytes", async () => {
    const a = await zip([{ name: "x", data: "1" }], { date: "2027-02-01T09:12" });
    const b = await zip([{ name: "x", data: "1" }], { date: "2027-02-01T09:12" });
    expect(bytesToBase64(a)).toBe(bytesToBase64(b));
  });
});

describe("xlsx", () => {
  const data: XlsxSheet = {
    name: "Resultat", header: true, decimalColumns: [2],
    rows: [["arendenummer", "namn", "narvaro_procent", "veckor"], ["BOT-26-0001", "A & B <c> \"d\"\u0001\u0008", 88.9, 5], ["BOT-26-0002", "=1+1", null, 0]],
  };
  const about: XlsxSheet = { name: "Om filen", rows: [["Avtal", "332026110, Botkyrka kommun"], ["Schemaversion", 1]], boldRows: [] };

  it("kolumnbokstäver och XML-skydd", () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(colName)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
    expect(xmlText("a & b < c > \"d\" \u0000\u0007￾\uD800x")).toBe("a &amp; b &lt; c &gt; &quot;d&quot; x");
  });

  it("delarna, bladen och bladnamnen; inget <f>; låst rubrikrad och autofilter med rätt område", async () => {
    const buf = await buildXlsx([data, { ...data, name: "Händelser" }, about], { date: "2027-02-01T09:12" });
    expect(String.fromCharCode(buf[0], buf[1])).toBe("PK");
    const es = await readZip(buf);
    expect(es.map((e) => e.name)).toEqual([
      "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml",
      "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml",
    ]);
    const wb = entryText(es, "xl/workbook.xml");
    expect([...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(["Resultat", "Händelser", "Om filen"]);
    expect(wb).toContain(`<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Resultat'!$A$1:$D$3</definedName>`);
    const s1 = entryText(es, "xl/worksheets/sheet1.xml");
    expect(s1).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(s1).toContain('<autoFilter ref="A1:D3"/>');
    expect(s1).toContain('<dimension ref="A1:D3"/>');
    expect([...s1.matchAll(/<row /g)]).toHaveLength(3);
    // Text som inlineStr, tal som tal, en decimal i procentkolumnen, tomma celler utelämnas
    expect(s1).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">BOT-26-0001</t></is></c>');
    expect(s1).toContain('<c r="C2" s="2"><v>88.9</v></c>');
    expect(s1).toContain('<c r="D3"><v>0</v></c>');
    expect(s1).not.toContain('r="C3"');
    expect(s1).toContain("A &amp; B &lt;c&gt; &quot;d&quot;</t>");
    // En formel i texten är bara text – inget <f> någonstans.
    for (const e of es) expect(new TextDecoder().decode(e.data)).not.toMatch(/<f[ >]/);
    expect(s1).toContain('<t xml:space="preserve">=1+1</t>');
    // Rubrikraden i fetstil
    expect(s1).toContain('<c r="A1" s="1" t="inlineStr">');
    // Bladet "Om filen" har ingen låst rad och inget autofilter
    const s3 = entryText(es, "xl/worksheets/sheet3.xml");
    expect(s3).not.toContain("<pane");
    expect(s3).not.toContain("<autoFilter");
    // All XML är välformad (enkel kontroll: inga råa & eller < i text och inga styrtecken)
    for (const e of es) expect(new TextDecoder().decode(e.data)).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]|&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it("ogiltiga bladnamn stoppas", () => {
    expect(() => xlsxParts([{ name: "A/B", rows: [] }])).toThrow();
    expect(() => xlsxParts([{ name: "x".repeat(32), rows: [] }])).toThrow();
    expect(() => xlsxParts([])).toThrow();
  });
});
