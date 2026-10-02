// ctx.ai på servern (supabase-läget). Leverantören väljs med MM_AI_PROVIDER (config.ts):
//   vertex     Gemini via Vertex AI, EU-endpointen (vertex.ts)
//   simulated  samma simulerade AI som minnesläget och prototypen (src/features/_shared/ai-sim.ts) – standard i testmiljön
//   off        ingen AI – ctx.ai saknas och den manuella vägen gäller (requireAi ger ett begripligt fel)
// Produktion kör aldrig den simulerade leverantören. Fel inställning stänger av AI (och loggas utan hemligheter) i stället för
// att stoppa hela appen. Instansen återanvänds i serverinstansen så att åtkomsttoken cachas.
import "server-only";
import type { AiPort } from "@/features/_shared/ai-port";
import { createSimulatedAi } from "@/features/_shared/ai-sim";
import { aiProviderChoice, vertexSettings, type AiProviderChoice } from "./config";
import { AiProviderError } from "./errors";
import { parseServiceAccountKey, type FetchLike } from "./google-auth";
import { createVertexAi } from "./vertex";

type Env = Record<string, string | undefined>;

/** Bygg porten (utan cache). Kastar AiProviderError("config") vid fel inställning. */
export function buildServerAi(o: { env: Env; environment: "staging" | "production"; fetch?: FetchLike; retryDelayMs?: number }): { choice: AiProviderChoice; ai: AiPort | undefined } {
  const choice = aiProviderChoice(o.env, o.environment);
  if (choice === "off") return { choice, ai: undefined };
  if (choice === "simulated") return { choice, ai: createSimulatedAi() };
  const key = parseServiceAccountKey(o.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const settings = vertexSettings(o.env, key.projectId);
  return { choice, ai: createVertexAi({ settings, key, fetch: o.fetch ?? (globalThis.fetch as unknown as FetchLike), retryDelayMs: o.retryDelayMs }) };
}

const cache = new Map<string, AiPort | undefined>();
const warned = new Set<string>();

/** ctx.ai för miljön (testmiljön eller produktion), eller undefined om AI är avstängd eller fel inställd. */
export function serverAi(environment: "staging" | "production", env: Env = process.env): AiPort | undefined {
  if (cache.has(environment)) return cache.get(environment);
  let ai: AiPort | undefined;
  try {
    ai = buildServerAi({ env, environment }).ai;
  } catch (e) {
    // Bara feltypen och en fast text – aldrig nyckeln eller dess innehåll.
    const text = e instanceof AiProviderError ? `${e.message}${e.detail ? ` (${e.detail})` : ""}` : "okänt fel";
    if (!warned.has(text)) {
      warned.add(text);
      console.error("ai: AI-stödet är avstängt –", text);
    }
    ai = undefined;
  }
  cache.set(environment, ai);
  return ai;
}

/** Töm cachen (tester, eller efter ändrade miljövariabler i utvecklingsläget). */
export const clearServerAiCache = () => {
  cache.clear();
  warned.clear();
};

export { AiProviderError } from "./errors";
