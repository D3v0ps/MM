// Personnummer i testdata och i minnesläget.
// Produktion: personnummer krypteras på applikationsnivå (AES-256-GCM, nyckel i miljövariabel) och söks via HMAC-SHA256
// (CLAUDE.md punkt 2). Minnesläget (prototypen och utvecklingsläget) har bara påhittade nummer med medvetet fel
// kontrollsiffra, och använder därför en enkel, synkron och tydligt märkt ersättning som går att köra i webbläsaren:
//   personnummerEnc  = "test:" + numret som det skrevs
//   personnummerHash = "test-fnv1a:" + FNV-1a (64 bitar, hex) av de tio sista siffrorna
// Samma funktioner måste användas av hanterare som skapar personer i minnesläget, så att dubblettkontrollen fungerar.
// Hanterarna når dem via ctx.crypto (TEST_PNR_CRYPTO nedan i minnesläget, src/server/crypto.ts i supabase-läget).
import type { PnrCrypto } from "@/api/server";

/** Luhn-kontroll (samma som prototypens MM.valid.luhn). */
export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let v = Number(digits[i]) * (i % 2 === 0 ? 2 : 1);
    if (v > 9) v -= 9;
    sum += v;
  }
  return sum % 10 === 0;
}

/** De tio sista siffrorna (ÅÅMMDDNNNN) – samma normalisering som prototypens dubblettkontroll. */
export const normalizePnr = (pnr: string): string => String(pnr || "").replace(/\D/g, "").slice(-10);

/** Sista fyra siffrorna för maskerad visning. */
export const pnrLast4 = (pnr: string): string => String(pnr || "").replace(/\D/g, "").slice(-4);

const TEST_PREFIX = "test:";

/** Minneslägets ersättning för kryptering. Tom sträng när personnummer saknas. */
export const encodeTestPnr = (pnr: string): string => (pnr ? `${TEST_PREFIX}${pnr}` : "");

/** Minneslägets ersättning för dekryptering. */
export function decodeTestPnr(enc: string): string {
  if (!enc) return "";
  if (!enc.startsWith(TEST_PREFIX)) throw new Error("Okänt format för personnummer i minnesläget");
  return enc.slice(TEST_PREFIX.length);
}

/** FNV-1a 64 bitar som hex (utan BigInt: fyra 16-bitarsord). */
export function fnv1a64(s: string): string {
  // offset basis 0xcbf29ce484222325, prime 0x100000001b3
  let h0 = 0x2325, h1 = 0x8422, h2 = 0x9ce4, h3 = 0xcbf2;
  for (let i = 0; i < s.length; i++) {
    h0 ^= s.charCodeAt(i);
    // multiplicera med 0x100000001b3 = 2^40 + 0x1b3 (16-bitarsord)
    const t0 = h0 * 0x1b3, t1 = h1 * 0x1b3, t2 = h2 * 0x1b3 + (h0 << 8), t3 = h3 * 0x1b3 + (h1 << 8);
    const c1 = t1 + (t0 >>> 16);
    const c2 = t2 + (c1 >>> 16);
    h3 = (t3 + (c2 >>> 16)) & 0xffff;
    h2 = c2 & 0xffff;
    h1 = c1 & 0xffff;
    h0 = t0 & 0xffff;
  }
  const hex = (n: number) => n.toString(16).padStart(4, "0");
  return hex(h3) + hex(h2) + hex(h1) + hex(h0);
}

/** Minneslägets ersättning för HMAC-sökhash. Tom sträng när personnummer saknas. */
export const testPnrHash = (pnr: string): string => {
  const n = normalizePnr(pnr);
  return n ? `test-fnv1a:${fnv1a64(n)}` : "";
};

/** Minneslägets ctx.crypto (prototypen, utvecklingsläget, e2e): testdatats ersättning – aldrig i supabase-läget. */
export const TEST_PNR_CRYPTO: PnrCrypto = {
  encryptPnr: (pnr) => encodeTestPnr(String(pnr ?? "").trim()),
  decryptPnr: (enc) => decodeTestPnr(enc),
  hashPnr: (pnr) => testPnrHash(String(pnr ?? "")),
};
