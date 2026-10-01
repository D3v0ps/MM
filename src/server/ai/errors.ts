// Fel från AI-leverantören (src/server/ai). Meddelandena är fasta texter – aldrig transkript, citat, namn eller svar från
// leverantören (CLAUDE.md punkt 2). Felet kan bära körningens mätvärden (token och kostnad som redan förbrukats), så att
// även misslyckade anrop syns i ai_runs.
//   retryable = true   värt att försöka igen senare (nätverk, 429, 5xx, tidsgräns) – jobbet läggs tillbaka i kön
//   retryable = false  försök inte igen (fel inställning, ogiltigt svar, stoppat svar, för stor fil)
import type { AiRunMeta } from "@/features/_shared/ai-port";

export const AI_ERROR_CODES = ["config", "unavailable", "invalid_response", "blocked", "too_large", "unsupported"] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export const AI_ERROR_TEXT: Record<AiErrorCode, string> = {
  config: "AI-leverantören är inte rätt inställd",
  unavailable: "AI-leverantören svarar inte just nu",
  invalid_response: "AI-svaret följde inte formatet och används inte",
  blocked: "AI-leverantören stoppade svaret",
  too_large: "Ljudfilen är för stor för transkribering",
  unsupported: "Ljudformatet stöds inte av AI-leverantören",
};

export class AiProviderError extends Error {
  readonly code: AiErrorCode;
  readonly retryable: boolean;
  /** Mätvärden för anropet om leverantören hann svara (token förbrukade även när svaret var ogiltigt). */
  readonly run: AiRunMeta | null;
  /** Teknisk detalj utan personuppgifter, t.ex. HTTP-status eller vilka fält som var ogiltiga ("goalStatus.value"). */
  readonly detail: string | null;
  constructor(code: AiErrorCode, opts: { retryable?: boolean; run?: AiRunMeta | null; detail?: string | null } = {}) {
    super(AI_ERROR_TEXT[code]);
    this.name = "AiProviderError";
    this.code = code;
    this.retryable = opts.retryable ?? code === "unavailable";
    this.run = opts.run ?? null;
    this.detail = opts.detail ?? null;
  }
}
