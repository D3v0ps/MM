// Minimal zip-skrivare utan beroenden (för Excel-filen, som är ett zip-paket). Isomorf: fungerar i Next, i prototypens
// enda HTML-fil (webbläsaren) och i testerna (Node).
//
// Komprimering: DEFLATE med CompressionStream("deflate-raw") när den finns (Node 21.2+, alla moderna webbläsare), annars
// STORE (okomprimerat). En post lagras också okomprimerad om DEFLATE inte gör den mindre. CRC32 räknas i ren TypeScript.
// Tidsstämpeln i posterna kommer från anroparen (ctx.now()), så att samma indata ger samma fil.
import type { LocalDateTime } from "../time";

// ---------------------------------------------------------------- CRC32 (IEEE 802.3, samma som zip och PNG)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** CRC32 för bytes eller text (UTF-8). crc32("") = 0, crc32("123456789") = 0xCBF43926. */
export function crc32(data: Uint8Array | string): number {
  const b = typeof data === "string" ? utf8(data) : data;
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- DEFLATE
/** Rå DEFLATE via CompressionStream. null om den inte finns eller misslyckas (då lagras posten okomprimerad). */
export async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as { CompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array> }).CompressionStream;
  if (!CS) return null;
  try {
    const stream = new Blob([data.slice()]).stream().pipeThrough(new CS("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Zip
export type ZipEntry = { name: string; data: Uint8Array | string };
export type ZipOptions = {
  /** Tidsstämpel för posterna (Stockholms lokala tid). Standard 1980-01-01 00:00. */
  date?: LocalDateTime | null;
  /** false = alltid STORE (för test och mätning). Standard: DEFLATE när det går. */
  compress?: boolean;
};

/** MS-DOS-tid och -datum (lokal tid, sekunder i steg om två). */
function dosDateTime(t: LocalDateTime | null | undefined): { time: number; date: number } {
  const m = t ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(t) : null;
  if (!m) return { time: 0, date: (0 << 9) | (1 << 5) | 1 };
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  return { time: (h << 11) | (mi << 5), date: ((Math.max(1980, y) - 1980) << 9) | (mo << 5) | d };
}

class ByteWriter {
  private parts: Uint8Array[] = [];
  length = 0;
  u16(v: number) {
    this.bytes(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]));
  }
  u32(v: number) {
    this.bytes(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
  }
  bytes(b: Uint8Array) {
    this.parts.push(b);
    this.length += b.length;
  }
  result(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

const UTF8_FLAG = 0x0800;

/** Bygg ett zip-paket av posterna (i den ordning de ges). */
export async function zip(entries: readonly ZipEntry[], opts: ZipOptions = {}): Promise<Uint8Array> {
  const { time, date } = dosDateTime(opts.date);
  const w = new ByteWriter();
  const central: { name: Uint8Array; crc: number; method: number; csize: number; usize: number; offset: number }[] = [];
  for (const e of entries) {
    const raw = typeof e.data === "string" ? utf8(e.data) : e.data;
    const name = utf8(e.name);
    const crc = crc32(raw);
    const deflated = opts.compress === false ? null : await deflateRaw(raw);
    const useDeflate = !!deflated && deflated.length < raw.length;
    const body = useDeflate ? (deflated as Uint8Array) : raw;
    const method = useDeflate ? 8 : 0;
    const offset = w.length;
    // Lokalt filhuvud
    w.u32(0x04034b50);
    w.u16(20);
    w.u16(UTF8_FLAG);
    w.u16(method);
    w.u16(time);
    w.u16(date);
    w.u32(crc);
    w.u32(body.length);
    w.u32(raw.length);
    w.u16(name.length);
    w.u16(0);
    w.bytes(name);
    w.bytes(body);
    central.push({ name, crc, method, csize: body.length, usize: raw.length, offset });
  }
  const cdStart = w.length;
  for (const c of central) {
    w.u32(0x02014b50);
    w.u16(20); // skapad av: version 2.0
    w.u16(20); // behövs: version 2.0
    w.u16(UTF8_FLAG);
    w.u16(c.method);
    w.u16(time);
    w.u16(date);
    w.u32(c.crc);
    w.u32(c.csize);
    w.u32(c.usize);
    w.u16(c.name.length);
    w.u16(0); // extra
    w.u16(0); // kommentar
    w.u16(0); // disk
    w.u16(0); // interna attribut
    w.u32(0); // externa attribut
    w.u32(c.offset);
    w.bytes(c.name);
  }
  const cdSize = w.length - cdStart;
  w.u32(0x06054b50);
  w.u16(0);
  w.u16(0);
  w.u16(central.length);
  w.u16(central.length);
  w.u32(cdSize);
  w.u32(cdStart);
  w.u16(0);
  return w.result();
}
