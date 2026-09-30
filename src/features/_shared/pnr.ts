// Personnummer när en person skapas (beställning) och i dubblettkontrollen. Bara för hanterare – aldrig för skärmar.
//
// Kryptering och sökhash går via ctx.crypto (CLAUDE.md punkt 2), så att hanterarna är desamma i båda körlägena:
//   MINNESLÄGET (prototypen och utvecklingsläget): testdatats tydligt märkta ersättning (src/data/seed/pnr.ts, TEST_PNR_CRYPTO),
//     så att dubblettkontrollen fungerar mellan testdata och nya beställningar.
//   SUPABASE-LÄGET: AES-256-GCM med nyckel i miljövariabel och HMAC-SHA256 för sökning (src/server/crypto.ts).
import type { PnrCrypto } from "@/api/server";
import { normalizePnr, pnrLast4 } from "@/data/seed/pnr";
import type { Person } from "@/data/schema";

export type ProtectedPnr = Pick<Person, "personnummerEnc" | "personnummerHash" | "personnummerLast4">;

/** Krypterat personnummer, sökhash och de fyra sista siffrorna. Tomma strängar när personnummer saknas. */
export function protectPnr(crypto: PnrCrypto, pnr: string | null | undefined): ProtectedPnr {
  const v = String(pnr ?? "").trim();
  if (!v) return { personnummerEnc: "", personnummerHash: "", personnummerLast4: "" };
  return { personnummerEnc: crypto.encryptPnr(v), personnummerHash: crypto.hashPnr(v), personnummerLast4: pnrLast4(v) };
}

/** Sökhash för ett personnummer (dubblettkontroll). Tom sträng om det saknas siffror. */
export const pnrSearchHash = (crypto: PnrCrypto, pnr: string | null | undefined): string => (normalizePnr(String(pnr ?? "")) ? crypto.hashPnr(String(pnr ?? "")) : "");

/** Personnumret i klartext (bara för "Visa", som loggas, och för kontroller). Tom sträng om det saknas eller inte går att dekryptera. */
export function revealPnr(crypto: PnrCrypto, p: Pick<Person, "personnummerEnc"> | null | undefined): string {
  try {
    return p?.personnummerEnc ? crypto.decryptPnr(p.personnummerEnc) : "";
  } catch {
    return "";
  }
}
