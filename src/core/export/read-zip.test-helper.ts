// Bara för testerna: läs tillbaka ett zip-paket (lokala filhuvuden och centralkatalogen), packa upp posterna och kontrollera
// storlek och CRC. Används av zip-, xlsx- och exporttesterna och av E2E-testet (den nedladdade filen) för att kontrollera att
// filen går att läsa som Excel läser den.
import { crc32 } from "./zip";

export type ReadEntry = { name: string; method: number; crc: number; csize: number; usize: number; offset: number; data: Uint8Array };

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Läs centralkatalogen och kontrollera att varje lokalt filhuvud stämmer med den. Kastar vid fel. */
export async function readZip(buf: Uint8Array): Promise<ReadEntry[]> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Slutet på centralkatalogen saknas");
  const count = u16(buf, eocd + 10);
  const cdSize = u32(buf, eocd + 12);
  const cdStart = u32(buf, eocd + 16);
  if (cdStart + cdSize !== eocd) throw new Error("Centralkatalogens storlek stämmer inte");
  const out: ReadEntry[] = [];
  let p = cdStart;
  for (let i = 0; i < count; i++) {
    if (u32(buf, p) !== 0x02014b50) throw new Error("Fel signatur i centralkatalogen");
    const method = u16(buf, p + 10);
    const crc = u32(buf, p + 16);
    const csize = u32(buf, p + 20);
    const usize = u32(buf, p + 24);
    const nlen = u16(buf, p + 28);
    const xlen = u16(buf, p + 30);
    const clen = u16(buf, p + 32);
    const offset = u32(buf, p + 42);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    // Lokalt filhuvud
    if (u32(buf, offset) !== 0x04034b50) throw new Error(`Fel signatur i lokalt filhuvud för ${name}`);
    if (u16(buf, offset + 8) !== method || u32(buf, offset + 14) !== crc || u32(buf, offset + 18) !== csize || u32(buf, offset + 22) !== usize) {
      throw new Error(`Lokalt filhuvud och centralkatalog skiljer sig för ${name}`);
    }
    const lnlen = u16(buf, offset + 26);
    const lxlen = u16(buf, offset + 28);
    const lname = new TextDecoder().decode(buf.subarray(offset + 30, offset + 30 + lnlen));
    if (lname !== name) throw new Error("Filnamnen skiljer sig");
    const start = offset + 30 + lnlen + lxlen;
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw.slice() : method === 8 ? await inflateRaw(raw) : (() => { throw new Error("Okänd komprimering"); })();
    if (data.length !== usize) throw new Error(`Fel storlek för ${name}`);
    if (crc32(data) !== crc) throw new Error(`Fel CRC för ${name}`);
    out.push({ name, method, crc, csize, usize, offset, data });
  }
  return out;
}

export const entryText = (entries: readonly ReadEntry[], name: string): string => {
  const e = entries.find((x) => x.name === name);
  if (!e) throw new Error(`Posten ${name} saknas`);
  return new TextDecoder().decode(e.data);
};
