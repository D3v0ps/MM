// Text ur en bifogad Word-mall (.docx) för tolkningen (beslut 4c): zip-paketet läses (centralkatalogen + node:zlib), och
// word/document.xml blir rader – tabellrader med två celler som "Etikett: värde" (mallens fasta etiketter i tabellcellerna,
// SPEC §7.1), övriga stycken som egna rader. Inget annat ur dokumentet används. Bara på servern (inläsningsjobbet).
import { inflateRawSync } from "node:zlib";

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** En post ur zip-paketet (lagrad eller DEFLATE), eller null om den saknas eller paketet inte går att läsa. */
export function zipEntry(buf: Uint8Array, wanted: string): Uint8Array | null {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (u32(buf, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (u32(buf, p) !== 0x02014b50) return null;
    const method = u16(buf, p + 10);
    const csize = u32(buf, p + 20);
    const nlen = u16(buf, p + 28);
    const xlen = u16(buf, p + 30);
    const clen = u16(buf, p + 32);
    const offset = u32(buf, p + 42);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name !== wanted) continue;
    if (u32(buf, offset) !== 0x04034b50) return null;
    const start = offset + 30 + u16(buf, offset + 26) + u16(buf, offset + 28);
    const raw = buf.subarray(start, start + csize);
    try {
      if (method === 0) return raw.slice();
      if (method === 8) return new Uint8Array(inflateRawSync(raw));
    } catch {
      return null;
    }
    return null;
  }
  return null;
}

const decode = (s: string): string =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)));
/** Texten i ett XML-fragment: w:t-element (och w:tab som tabb, w:br som radbrytning). */
const textOf = (xml: string): string =>
  decode(
    xml
      .replace(/<w:tab\s*\/>/g, "\t")
      .replace(/<w:br\s*\/>/g, "\n")
      .replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, "$1\u0000")
      .replace(/<[^>]+>/g, "")
      .replace(/\u0000/g, ""),
  ).replace(/\s+/g, " ").trim();

/**
 * Rader ur word/document.xml: tabellrader med minst två celler blir "cell 1: cell 2" (fler celler skiljs med tabb – det
 * första paret är etiketten och värdet), stycken utanför tabeller blir egna rader. Tom sträng om dokumentet inte går att läsa.
 */
export function docxText(file: Uint8Array): string {
  const xmlBytes = zipEntry(file, "word/document.xml");
  if (!xmlBytes) return "";
  const xml = new TextDecoder().decode(xmlBytes);
  const out: string[] = [];
  // Tabellerna först (ersätts med platshållare så att styckena i dem inte räknas två gånger).
  const rest = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    for (const tr of tbl.match(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g) ?? []) {
      const cells = (tr.match(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g) ?? []).map((tc) => {
        const paras = (tc.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p\s*\/>/g) ?? []).map(textOf).filter(Boolean);
        return paras.join("\n");
      });
      if (cells.length >= 2 && cells[0]) out.push(`${cells[0].replace(/[:：]\s*$/, "")}: ${cells.slice(1).filter(Boolean).join("\t")}`);
      else if (cells.length === 1 && cells[0]) out.push(cells[0]);
    }
    return "";
  });
  // En tom rad mellan tabellerna och styckena utanför dem: ett fält över flera rader (bakgrunden) slutar vid tabellens slut.
  const paras = (rest.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? []).map(textOf).filter(Boolean);
  return [...out, ...(out.length && paras.length ? [""] : []), ...paras].join("\n");
}

/** Är filen en docx (zip med PK-signatur)? */
export const looksLikeDocx = (file: Uint8Array): boolean => file.length > 4 && file[0] === 0x50 && file[1] === 0x4b && file[2] === 0x03 && file[3] === 0x04;
