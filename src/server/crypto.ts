// Personnummer på servern (supabase-läget, CLAUDE.md punkt 2): ctx.crypto.
//   encryptPnr  AES-256-GCM med MM_PNR_KEY (32 byte, base64), slumpad nonce per värde:  "v1:<nonce>:<tagg>:<chiffertext>" (base64url)
//   hashPnr     HMAC-SHA256 med MM_PNR_HMAC_KEY på det normaliserade numret (de tio sista siffrorna, normalizePnr) – samma
//               normalisering som minnesläget, så att "19750818-8340" och "7508188340" ger samma sökhash: "v1:<hex>"
// Nycklarna finns bara i serverns miljövariabler (aldrig NEXT_PUBLIC_, aldrig i webbläsaren – därav "server-only").
// Felmeddelandena innehåller aldrig värden eller nycklar. Nycklarna kan inte bytas utan att alla personnummer krypteras om
// och alla sökhashar räknas om (docs/DRIFT.md).
import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { PnrCrypto } from "@/api/server";
import { normalizePnr } from "@/data/seed/pnr";

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class PnrKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PnrKeyError";
  }
}

/** base64 (eller base64url) -> byte. Tom eller trasig nyckel ger null. */
function decodeKey(v: string | undefined): Buffer | null {
  const s = (v ?? "").trim();
  if (!s || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return null;
  const b = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return b.length ? b : null;
}

/** Krypteringen med givna nycklar (32 byte vardera). Används av serverCrypto() och av testerna. */
export function pnrCryptoFromKeys(encKey: Buffer, hmacKey: Buffer): PnrCrypto {
  if (encKey.length !== 32) throw new PnrKeyError("MM_PNR_KEY ska vara 32 byte (base64), skapa med: openssl rand -base64 32");
  if (hmacKey.length < 32) throw new PnrKeyError("MM_PNR_HMAC_KEY ska vara minst 32 byte (base64), skapa med: openssl rand -base64 32");
  if (encKey.equals(hmacKey)) throw new PnrKeyError("MM_PNR_KEY och MM_PNR_HMAC_KEY ska vara olika nycklar");
  return {
    encryptPnr(pnr: string): string {
      const v = String(pnr ?? "").trim();
      if (!v) return "";
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv(ALGO, encKey, nonce);
      const ct = Buffer.concat([cipher.update(v, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [VERSION, nonce.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
    },
    decryptPnr(enc: string): string {
      if (!enc) return "";
      const parts = String(enc).split(":");
      if (parts.length !== 4 || parts[0] !== VERSION) throw new PnrKeyError("Personnumret har ett okänt format");
      const [, n, t, c] = parts;
      const nonce = Buffer.from(n, "base64url");
      const tag = Buffer.from(t, "base64url");
      if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) throw new PnrKeyError("Personnumret har ett okänt format");
      try {
        const decipher = createDecipheriv(ALGO, encKey, nonce);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(Buffer.from(c, "base64url")), decipher.final()]).toString("utf8");
      } catch {
        // Fel nyckel eller ändrat värde (GCM-taggen stämmer inte).
        throw new PnrKeyError("Personnumret kunde inte dekrypteras");
      }
    },
    hashPnr(pnr: string): string {
      const n = normalizePnr(String(pnr ?? ""));
      if (!n) return "";
      return `${VERSION}:${createHmac("sha256", hmacKey).update(n, "utf8").digest("hex")}`;
    },
  };
}

/** Nycklarna från miljön. Kastar PnrKeyError (utan värden) om de saknas eller är fel. */
export function pnrCryptoFromEnv(env: Record<string, string | undefined> = process.env): PnrCrypto {
  const enc = decodeKey(env.MM_PNR_KEY);
  const mac = decodeKey(env.MM_PNR_HMAC_KEY);
  if (!enc) throw new PnrKeyError("MM_PNR_KEY saknas eller är inte base64 (skapa med: openssl rand -base64 32)");
  if (!mac) throw new PnrKeyError("MM_PNR_HMAC_KEY saknas eller är inte base64 (skapa med: openssl rand -base64 32)");
  return pnrCryptoFromKeys(enc, mac);
}

let cached: PnrCrypto | null = null;

/** Finns giltiga nycklar? (T.ex. innan testdatat läses in – då stoppas inläsningen innan något töms.) */
export function assertPnrKeys(): void {
  serverCrypto();
}

/**
 * ctx.crypto i supabase-läget. Nycklarna läses först när ett personnummer används, så att sidor utan personnummer fungerar
 * även om nycklarna saknas – då får hanteraren ett fel (500) och personnumret visas aldrig i klartext.
 */
export function serverCrypto(): PnrCrypto {
  return (cached ??= pnrCryptoFromEnv());
}

/** Lat variant för Ctx: nycklarna läses vid första anropet. */
export const lazyServerCrypto: PnrCrypto = {
  encryptPnr: (pnr) => serverCrypto().encryptPnr(pnr),
  decryptPnr: (enc) => serverCrypto().decryptPnr(enc),
  hashPnr: (pnr) => serverCrypto().hashPnr(pnr),
};
