// Personnummer när en person skapas (beställning). Bara för hanterare – aldrig för skärmar.
//
// MINNESLÄGET (prototypen och utvecklingsläget): samma tydligt märkta ersättning för kryptering och sökhash som testdatat
// (src/data/seed/pnr.ts), så att dubblettkontrollen fungerar mellan testdata och nya beställningar.
// PRODUKTION (efter godkänd plan): AES-256-GCM med nyckel i miljövariabel och HMAC-SHA256 för sökning (CLAUDE.md punkt 2).
// Den adaptern ska nås via ctx (t.ex. ctx.crypto) så att hanterarna inte ändras – se slutrapporten för kommandona.
import { encodeTestPnr, normalizePnr, pnrLast4, testPnrHash } from "@/data/seed/pnr";
import type { Person } from "@/data/schema";

export type ProtectedPnr = Pick<Person, "personnummerEnc" | "personnummerHash" | "personnummerLast4">;

/** Krypterat personnummer, sökhash och de fyra sista siffrorna. Tomma strängar när personnummer saknas. */
export function protectPnr(pnr: string | null | undefined): ProtectedPnr {
  const v = String(pnr ?? "").trim();
  if (!v) return { personnummerEnc: "", personnummerHash: "", personnummerLast4: "" };
  return { personnummerEnc: encodeTestPnr(v), personnummerHash: testPnrHash(v), personnummerLast4: pnrLast4(v) };
}

/** Sökhash för ett personnummer (dubblettkontroll). Tom sträng om det saknas siffror. */
export const pnrSearchHash = (pnr: string | null | undefined): string => (normalizePnr(String(pnr ?? "")) ? testPnrHash(String(pnr ?? "")) : "");
