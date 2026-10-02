// ctx.crypto för personnummer: serverns AES-256-GCM + HMAC-SHA256 (src/server/crypto.ts) och minneslägets ersättning
// (TEST_PNR_CRYPTO). Båda: kryptera -> dekryptera ger samma värde, och olika skrivsätt av samma nummer ger samma sökhash.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { TEST_PNR_CRYPTO } from "@/data/seed/pnr";

vi.mock("server-only", () => ({}));
const { lazyServerCrypto, pnrCryptoFromEnv, pnrCryptoFromKeys, PnrKeyError } = await import("./crypto");

// Påhittade nycklar (bara för testet).
const key = (seed: string) => createHash("sha256").update(seed).digest();
const ENC = key("testnyckel-kryptering");
const MAC = key("testnyckel-hmac");
const ENV = { MM_PNR_KEY: ENC.toString("base64"), MM_PNR_HMAC_KEY: MAC.toString("base64") };
// Påhittat nummer med fel kontrollsiffra (samma sort som testdatat).
const PNR = "19750818-8340";
const SAME = ["19750818-8340", "197508188340", "750818-8340", "7508188340", " 19750818 8340 "];

describe("servern: AES-256-GCM och HMAC-SHA256", () => {
  const c = pnrCryptoFromKeys(ENC, MAC);

  it("krypterar och dekrypterar tillbaka till samma värde", () => {
    const enc = c.encryptPnr(PNR);
    expect(enc).toMatch(/^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]+$/);
    expect(enc).not.toContain("8340");
    expect(enc).not.toContain("750818");
    expect(c.decryptPnr(enc)).toBe(PNR);
    // Ny nonce varje gång: samma nummer ger olika chiffertext.
    expect(c.encryptPnr(PNR)).not.toBe(enc);
    expect(c.decryptPnr(c.encryptPnr(" 7508188340 "))).toBe("7508188340");
  });

  it("tomt värde ger tom sträng (som minnesläget)", () => {
    expect(c.encryptPnr("")).toBe("");
    expect(c.encryptPnr("   ")).toBe("");
    expect(c.decryptPnr("")).toBe("");
    expect(c.hashPnr("")).toBe("");
    expect(c.hashPnr("abc")).toBe("");
  });

  it("samma sökhash för olika skrivsätt, olika hash för olika nummer", () => {
    const h = c.hashPnr(PNR);
    expect(h).toMatch(/^v1:[0-9a-f]{64}$/);
    for (const v of SAME) expect(c.hashPnr(v)).toBe(h);
    expect(c.hashPnr("19750818-8341")).not.toBe(h);
    // Hashen är HMAC av de tio sista siffrorna – aldrig numret i klartext.
    expect(h).not.toContain("7508188340");
  });

  it("fel nyckel, ändrat värde och okänt format kan inte dekrypteras", () => {
    const enc = c.encryptPnr(PNR);
    const other = pnrCryptoFromKeys(key("annan"), MAC);
    expect(() => other.decryptPnr(enc)).toThrow(PnrKeyError);
    const [v, n, t, ct] = enc.split(":");
    const flipped = `${v}:${n}:${t}:${ct.slice(0, -2)}${ct.endsWith("A") ? "B" : "A"}${ct.slice(-1)}`;
    expect(() => c.decryptPnr(flipped)).toThrow(PnrKeyError);
    expect(() => c.decryptPnr(`test:${PNR}`)).toThrow(PnrKeyError);
    expect(() => c.decryptPnr("v1:x:y")).toThrow(PnrKeyError);
    // Felmeddelandet innehåller aldrig värdet.
    try {
      c.decryptPnr(`test:${PNR}`);
    } catch (e) {
      expect((e as Error).message).not.toContain("8340");
    }
  });

  it("hash-nyckeln påverkar hashen (en annan miljö ger andra hashar)", () => {
    expect(pnrCryptoFromKeys(ENC, key("annan-hmac")).hashPnr(PNR)).not.toBe(c.hashPnr(PNR));
  });
});

describe("nycklarna från miljön (MM_PNR_KEY, MM_PNR_HMAC_KEY)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("läser base64 (även base64url) och ger samma resultat som nycklarna direkt", () => {
    const fromEnv = pnrCryptoFromEnv(ENV);
    expect(fromEnv.hashPnr(PNR)).toBe(pnrCryptoFromKeys(ENC, MAC).hashPnr(PNR));
    expect(pnrCryptoFromKeys(ENC, MAC).decryptPnr(fromEnv.encryptPnr(PNR))).toBe(PNR);
    const url = pnrCryptoFromEnv({ MM_PNR_KEY: ENC.toString("base64url"), MM_PNR_HMAC_KEY: MAC.toString("base64url") });
    expect(url.hashPnr(PNR)).toBe(fromEnv.hashPnr(PNR));
  });

  it("saknade, för korta eller lika nycklar stoppas med ett fel utan nyckelns värde", () => {
    expect(() => pnrCryptoFromEnv({})).toThrow(/MM_PNR_KEY saknas/);
    expect(() => pnrCryptoFromEnv({ MM_PNR_KEY: ENV.MM_PNR_KEY })).toThrow(/MM_PNR_HMAC_KEY saknas/);
    expect(() => pnrCryptoFromEnv({ MM_PNR_KEY: Buffer.alloc(16, 1).toString("base64"), MM_PNR_HMAC_KEY: ENV.MM_PNR_HMAC_KEY })).toThrow(/32 byte/);
    expect(() => pnrCryptoFromEnv({ MM_PNR_KEY: ENV.MM_PNR_KEY, MM_PNR_HMAC_KEY: Buffer.alloc(8, 1).toString("base64") })).toThrow(/minst 32 byte/);
    expect(() => pnrCryptoFromEnv({ MM_PNR_KEY: ENV.MM_PNR_KEY, MM_PNR_HMAC_KEY: ENV.MM_PNR_KEY })).toThrow(/olika/);
    expect(() => pnrCryptoFromEnv({ MM_PNR_KEY: "inte base64!", MM_PNR_HMAC_KEY: ENV.MM_PNR_HMAC_KEY })).toThrow(PnrKeyError);
    try {
      pnrCryptoFromEnv({ MM_PNR_KEY: ENV.MM_PNR_KEY, MM_PNR_HMAC_KEY: ENV.MM_PNR_KEY });
    } catch (e) {
      expect((e as Error).message).not.toContain(ENV.MM_PNR_KEY);
    }
  });

  it("ctx.crypto på servern läser nycklarna vid första användningen", () => {
    vi.stubEnv("MM_PNR_KEY", ENV.MM_PNR_KEY);
    vi.stubEnv("MM_PNR_HMAC_KEY", ENV.MM_PNR_HMAC_KEY);
    expect(lazyServerCrypto.hashPnr(PNR)).toBe(pnrCryptoFromKeys(ENC, MAC).hashPnr(PNR));
    expect(lazyServerCrypto.decryptPnr(lazyServerCrypto.encryptPnr(PNR))).toBe(PNR);
  });
});

describe("minnesläget: testdatats ersättning (TEST_PNR_CRYPTO)", () => {
  it("kryptera/dekryptera och samma sökhash för olika skrivsätt – oförändrat mot testdatat", () => {
    const enc = TEST_PNR_CRYPTO.encryptPnr(PNR);
    expect(enc).toBe(`test:${PNR}`);
    expect(TEST_PNR_CRYPTO.decryptPnr(enc)).toBe(PNR);
    const h = TEST_PNR_CRYPTO.hashPnr(PNR);
    expect(h).toMatch(/^test-fnv1a:[0-9a-f]{16}$/);
    for (const v of SAME) expect(TEST_PNR_CRYPTO.hashPnr(v)).toBe(h);
    expect(TEST_PNR_CRYPTO.hashPnr("19750818-8341")).not.toBe(h);
    expect(TEST_PNR_CRYPTO.encryptPnr("")).toBe("");
    expect(TEST_PNR_CRYPTO.decryptPnr("")).toBe("");
    expect(TEST_PNR_CRYPTO.hashPnr("")).toBe("");
    expect(() => TEST_PNR_CRYPTO.decryptPnr("v1:a:b:c")).toThrow();
  });
});
