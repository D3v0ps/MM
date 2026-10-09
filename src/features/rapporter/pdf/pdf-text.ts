// Bara för tester: läser texten ur en färdig PDF från react-pdf (pdfkit) – det som faktiskt ritas, inte React-trädet.
// Text som react-pdf hoppar över i layouten (en rad som inte får plats) finns alltså inte med, och varje textblock får sin
// position, så att text som rinner ut över sidfoten eller utanför sidan syns i testet.
//
// Räcker för pdfkits utdata: Type0-typsnitt med Identity-H och ToUnicode, innehållsströmmar med FlateDecode, text i
// BT … ET med Tf, Tm/Td och Tj/TJ. Ingen allmän PDF-tolk.
import { inflateSync } from "node:zlib";

type PdfObject = { dict: string; stream?: Buffer };
/** En textrad (ett BT … ET-block): texten och baslinjens läge i punkter från sidans nederkant. */
export type PdfLine = { text: string; x: number; y: number };
export type PdfPage = { width: number; height: number; lines: PdfLine[] };

function parseObjects(buf: Buffer): Map<number, PdfObject> {
  const s = buf.toString("latin1");
  const out = new Map<number, PdfObject>();
  const re = /(\d+) 0 obj\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = re.lastIndex;
    const end = s.indexOf("endobj", start);
    const si = s.indexOf("stream", start);
    if (si !== -1 && si < end) {
      const dict = s.slice(start, si);
      const len = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? "0");
      let p = si + "stream".length;
      if (s[p] === "\r") p++;
      if (s[p] === "\n") p++;
      const raw = buf.subarray(p, p + len);
      out.set(Number(m[1]), { dict, stream: /\/FlateDecode/.test(dict) ? inflateSync(raw) : Buffer.from(raw) });
      re.lastIndex = s.indexOf("endobj", p + len) + "endobj".length;
    } else {
      out.set(Number(m[1]), { dict: s.slice(start, end) });
      re.lastIndex = end + "endobj".length;
    }
  }
  return out;
}

const ref = (dict: string, key: string): number | null => {
  const m = new RegExp(`/${key}\\s+(\\d+) 0 R`).exec(dict);
  return m ? Number(m[1]) : null;
};
/** UTF-16BE i hex -> text (en post kan vara flera tecken, t.ex. ligaturen fi: <0066 0069>). */
const utf16 = (spaced: string): string => {
  const hex = spaced.replace(/\s+/g, "");
  const units: number[] = [];
  for (let i = 0; i + 4 <= hex.length; i += 4) units.push(parseInt(hex.slice(i, i + 4), 16));
  return String.fromCharCode(...units);
};

/** ToUnicode-tabellen: teckenkod -> text. */
function toUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F\s]+)>/g)) map.set(parseInt(m[1], 16), utf16(m[2]));
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F\s]+>)/g)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (m[3].startsWith("[")) {
        const items = [...m[3].matchAll(/<([0-9a-fA-F\s]+)>/g)].map((x) => utf16(x[1]));
        for (let c = lo; c <= hi; c++) map.set(c, items[c - lo] ?? "");
      } else {
        const base = parseInt(m[3].slice(1, -1).replace(/\s+/g, ""), 16);
        for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(base + c - lo));
      }
    }
  }
  return map;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** m × n (PDF:s ordning: en punkt transformeras först med m, sedan med n). */
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const nums = (s: string): Matrix => s.trim().split(/\s+/).map(Number) as Matrix;

const OPS = new RegExp(
  [
    String.raw`(-?[\d.]+(?:\s+-?[\d.]+){5})\s+(cm|Tm)\b`,
    String.raw`(-?[\d.]+)\s+(-?[\d.]+)\s+Td\b`,
    String.raw`\/([\w.+-]+)\s+-?[\d.]+\s+Tf\b`,
    String.raw`\[([^\]]*)\]\s*TJ\b`,
    String.raw`<([0-9a-fA-F]*)>\s*Tj\b`,
    String.raw`(?<![\w/])(q|Q|BT|ET)(?![\w])`,
  ].join("|"),
  "g",
);

function pageLines(content: string, fonts: Map<string, Map<number, string>>): PdfLine[] {
  const lines: PdfLine[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  let tm: Matrix = IDENTITY;
  let font: Map<number, string> | undefined;
  let cur: PdfLine | null = null;
  const decode = (hex: string) => {
    let out = "";
    for (let i = 0; i + 4 <= hex.length; i += 4) out += font?.get(parseInt(hex.slice(i, i + 4), 16)) ?? "�";
    return out;
  };
  const show = (text: string) => {
    if (!cur) {
      const at = mul(tm, ctm);
      cur = { text: "", x: at[4], y: at[5] };
    }
    cur.text += text;
  };
  for (const m of content.matchAll(OPS)) {
    if (m[2] === "cm") ctm = mul(nums(m[1]), ctm);
    else if (m[2] === "Tm") tm = nums(m[1]);
    else if (m[3] !== undefined) tm = mul([1, 0, 0, 1, Number(m[3]), Number(m[4])], tm);
    else if (m[5] !== undefined) font = fonts.get(m[5]);
    else if (m[6] !== undefined) show([...m[6].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => decode(x[1])).join(""));
    else if (m[7] !== undefined) show(decode(m[7]));
    else if (m[8] === "q") stack.push(ctm);
    else if (m[8] === "Q") ctm = stack.pop() ?? IDENTITY;
    else if (m[8] === "BT") {
      tm = IDENTITY;
      cur = null;
    } else if (m[8] === "ET") {
      if (cur && (cur as PdfLine).text) lines.push(cur);
      cur = null;
    }
  }
  return lines;
}

/** Sidorna i ordning med textraderna som ritas. */
export function pdfPages(pdf: Uint8Array): PdfPage[] {
  const objs = parseObjects(Buffer.from(pdf));
  const get = (n: number | null) => (n == null ? undefined : objs.get(n));
  const catalog = [...objs.values()].find((o) => /\/Type \/Catalog/.test(o.dict));
  const pages = get(ref(catalog?.dict ?? "", "Pages"));
  const kids = [...(/\/Kids \[([^\]]*)\]/.exec(pages?.dict ?? "")?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map((x) => Number(x[1]));
  const cmaps = new Map<number, Map<number, string>>();
  return kids.map((n) => {
    const page = get(n)!;
    const box = /\/MediaBox \[([^\]]*)\]/.exec(page.dict)?.[1].trim().split(/\s+/).map(Number) ?? [0, 0, 595.28, 841.89];
    const resources = get(ref(page.dict, "Resources"))?.dict ?? page.dict;
    const fonts = new Map<string, Map<number, string>>();
    for (const f of (/\/Font\s*<<([\s\S]*?)>>/.exec(resources)?.[1] ?? "").matchAll(/\/([\w.+-]+)\s+(\d+) 0 R/g)) {
      const cmapRef = ref(get(Number(f[2]))?.dict ?? "", "ToUnicode");
      if (cmapRef == null) continue;
      if (!cmaps.has(cmapRef)) cmaps.set(cmapRef, toUnicode(get(cmapRef)?.stream?.toString("latin1") ?? ""));
      fonts.set(f[1], cmaps.get(cmapRef)!);
    }
    const content = get(ref(page.dict, "Contents"))?.stream?.toString("latin1") ?? "";
    return { width: box[2] - box[0], height: box[3] - box[1], lines: pageLines(content, fonts) };
  });
}

/** All text i dokumentet (raderna i ritordning, en per rad). */
export const pdfText = (pdf: Uint8Array): string => pdfPages(pdf).map((p) => p.lines.map((l) => l.text).join("\n")).join("\n");

/**
 * Textlagrets mappningar där en teckenkod står för mer än ett tecken (t.ex. ligaturen fi som <0066 0069>). Flera PDF-läsare tar
 * bara första tecknet av en sådan post, så rapporterna ska inte ha några (fynd 9, 2026-10-08). Surrogatpar (ett tecken utanför
 * BMP) räknas inte.
 */
export function pdfMultiUnicodeMappings(pdf: Uint8Array): string[] {
  const out: string[] = [];
  for (const o of parseObjects(Buffer.from(pdf)).values()) {
    const cmap = o.stream?.toString("latin1");
    if (!cmap || !cmap.includes("begincmap")) continue;
    for (const text of toUnicode(cmap).values()) {
      const isPair = text.length === 2 && text.charCodeAt(0) >= 0xd800 && text.charCodeAt(0) <= 0xdbff;
      if (text.length > 1 && !isPair) out.push(text);
    }
  }
  return out;
}
