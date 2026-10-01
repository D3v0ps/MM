// AI-leverantörens inställningar från miljövariabler (docs/AI.md, docs/DRIFT.md avsnitt 10). Inga hemligheter loggas.
//
//   MM_AI_PROVIDER              vertex | simulated | off. Tomt: simulated i testmiljön, off i produktion.
//                               simulated går aldrig i produktion (påhittade transkript får aldrig bli dokumentation).
//   MM_AI_MODEL                 Gemini-modellen i Vertex AI, t.ex. en Flash-modell. Kontrolleras inte mot nätet.
//   GOOGLE_VERTEX_PROJECT       Google Cloud-projektets id (annars project_id ur nyckeln).
//   GOOGLE_VERTEX_LOCATION      valfri – får bara vara "eu" (EU multi-region). Allt annat stoppas.
//   GOOGLE_SERVICE_ACCOUNT_KEY  HEMLIG. Tjänstekontots JSON-nyckel som base64 (rollen Vertex AI User).
//   MM_AI_PRICES                prislista i öre per miljon token: {"audioIn":…,"textIn":…,"output":…}. Tom = kostnad 0.
//   MM_AI_THINKING              valfri resonemangsnivå: minimal | low | medium | high. Standard: lägsta rimliga (docs/AI.md).
//
// Endast Vertex AI:s EU-endpoint (aiplatform.eu.rep.googleapis.com, location eu) – aldrig AI Studio-nyckel
// (generativelanguage.googleapis.com), aldrig global endpoint, aldrig en regional endpoint utanför EU (CLAUDE.md, SPEC §8.4).
import { z } from "zod";
import { AiProviderError } from "./errors";

export const VERTEX_EU_HOST = "aiplatform.eu.rep.googleapis.com";
export const VERTEX_EU_LOCATION = "eu";

const config = (detail: string) => new AiProviderError("config", { detail });

const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const MODEL_RE = /^[a-z0-9][a-z0-9._-]{1,80}$/;
const PATH_RE = /^\/v1\/projects\/([^/]+)\/locations\/([^/]+)\/publishers\/google\/models\/([^/:]+):generateContent$/;

/** Stoppar allt som inte är Vertex AI:s EU multi-region-endpoint med location eu. */
export function assertVertexEuEndpoint(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw config("Ogiltig adress till AI-leverantören");
  }
  if (u.protocol !== "https:" || u.hostname !== VERTEX_EU_HOST || u.port || u.username || u.password || u.search || u.hash) {
    throw config(`Endast ${VERTEX_EU_HOST} får användas (aldrig AI Studio eller global endpoint)`);
  }
  const m = PATH_RE.exec(u.pathname);
  if (!m || m[2] !== VERTEX_EU_LOCATION) throw config(`Endast location "${VERTEX_EU_LOCATION}" får användas`);
}

/** Adressen till generateContent för modellen i projektet – alltid EU-endpointen. */
export function vertexEndpoint(project: string, model: string): string {
  if (!PROJECT_RE.test(project)) throw config("GOOGLE_VERTEX_PROJECT har fel format");
  if (!MODEL_RE.test(model)) throw config("MM_AI_MODEL har fel format");
  const url = `https://${VERTEX_EU_HOST}/v1/projects/${project}/locations/${VERTEX_EU_LOCATION}/publishers/google/models/${model}:generateContent`;
  assertVertexEuEndpoint(url);
  return url;
}

// ---------------------------------------------------------------- Prislistan
/** Öre per miljon token (exkl. moms), från Googles prislista för EU-endpointen. */
export type AiPrices = { audioIn: number; textIn: number; output: number };
const PricesSchema = z.strictObject({ audioIn: z.number().min(0), textIn: z.number().min(0), output: z.number().min(0) });

/** MM_AI_PRICES -> prislista. Tom = null (kostnaden sparas som 0). Fel format stoppas. */
export function parseAiPrices(raw: string | undefined): AiPrices | null {
  const v = raw?.trim();
  if (!v) return null;
  let json: unknown;
  try {
    json = JSON.parse(v);
  } catch {
    throw config("MM_AI_PRICES är inte giltig JSON");
  }
  const p = PricesSchema.safeParse(json);
  if (!p.success) throw config('MM_AI_PRICES ska vara {"audioIn":…,"textIn":…,"output":…} i öre per miljon token');
  return p.data;
}

/** Token i ett anrop: ljud in, text in (instruktioner och transkript) och ut (svar och resonemang). */
export type TokenUsage = { audioIn: number; textIn: number; output: number };

/** Kostnad i hela öre (avrundat uppåt – hellre en uppskattning i överkant). */
export function costOre(u: TokenUsage, p: AiPrices | null): number {
  if (!p) return 0;
  const ore = (u.audioIn * p.audioIn + u.textIn * p.textIn + u.output * p.output) / 1_000_000;
  return ore > 0 ? Math.ceil(ore - 1e-9) : 0;
}

// ---------------------------------------------------------------- Resonemangsnivå
export const THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

// ---------------------------------------------------------------- Allt från miljön
export type AiProviderChoice = "vertex" | "simulated" | "off";

export type VertexSettings = {
  project: string;
  model: string;
  /** Rå nyckel (base64 eller JSON) – tolkas av google-auth.ts. */
  serviceAccountKey: string;
  prices: AiPrices | null;
  thinking: ThinkingLevel | null;
};

/**
 * Vilken leverantör servern ska använda. environment = app_settings.environment (testmiljön eller produktion).
 * Produktion kör aldrig den simulerade leverantören: då blir det "off" och den manuella vägen gäller.
 */
export function aiProviderChoice(env: Record<string, string | undefined>, environment: "staging" | "production"): AiProviderChoice {
  const v = env.MM_AI_PROVIDER?.trim().toLowerCase() ?? "";
  if (v === "vertex") return "vertex";
  if (v === "off") return "off";
  if (v === "" || v === "simulated") return environment === "staging" ? "simulated" : "off";
  throw config("MM_AI_PROVIDER ska vara vertex, simulated eller off");
}

/** Inställningarna för Vertex AI. Kastar AiProviderError("config") om något saknas eller pekar utanför EU. */
export function vertexSettings(env: Record<string, string | undefined>, projectFromKey: string | null = null): VertexSettings {
  const location = env.GOOGLE_VERTEX_LOCATION?.trim();
  if (location && location !== VERTEX_EU_LOCATION) throw config(`GOOGLE_VERTEX_LOCATION får bara vara "${VERTEX_EU_LOCATION}"`);
  const model = env.MM_AI_MODEL?.trim();
  if (!model) throw config("MM_AI_MODEL saknas");
  const project = env.GOOGLE_VERTEX_PROJECT?.trim() || projectFromKey || "";
  if (!project) throw config("GOOGLE_VERTEX_PROJECT saknas");
  const key = env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
  if (!key) throw config("GOOGLE_SERVICE_ACCOUNT_KEY saknas");
  const thinkingRaw = env.MM_AI_THINKING?.trim().toLowerCase();
  if (thinkingRaw && !(THINKING_LEVELS as readonly string[]).includes(thinkingRaw)) throw config("MM_AI_THINKING ska vara minimal, low, medium eller high");
  // Adressen byggs och kontrolleras redan här, så att fel inställning syns direkt.
  vertexEndpoint(project, model);
  return { project, model, serviceAccountKey: key, prices: parseAiPrices(env.MM_AI_PRICES), thinking: (thinkingRaw as ThinkingLevel | undefined) ?? null };
}
