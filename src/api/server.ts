// Hanterarregister och körning. Isomorf: samma kod körs i Next.js-servern och i prototypen.
// Hanterare får aldrig importera serverspecifika moduler direkt – sådant nås via ctx (t.ex. ctx.notify).
import type { AppRepo } from "@/data/schema";
import { PolicyError } from "@/data/repo";
import type { LocalDateTime } from "@/core/time";
import type { AiPort } from "@/features/_shared/ai-port";
import type { AttachmentPort } from "@/features/_shared/attachment-port";
import type { AudioPort } from "@/features/_shared/audio-port";
import type { CommandDef, QueryDef } from "./contract";
import type { Actor, Role } from "./roles";
import { hidesCommercial, testerRoleBlocks, TESTER_HIDDEN_CODE, TESTER_HIDDEN_PAGE } from "./tester-access";

/** Utskick (e-post/SMS/notis i appen). Innehåller aldrig personuppgifter – bara ärendenummer och länk. */
export type OutgoingMessage = {
  /** Brev används för kallelser när deltagaren vill ha post (fullständig adress lagras bara då). */
  channel: "email" | "sms" | "letter";
  to: string;
  template: string;
  subject?: string;
  body: string;
  caseId?: string | null;
};
export type AuditEntry = {
  action: string;
  entity: string;
  entityId: string | null;
  contractId?: string | null;
  details?: Record<string, unknown>;
};

/**
 * Personnummer (CLAUDE.md punkt 2): kryptering, dekryptering och sökhash. Hanterarna når dem bara via ctx.crypto.
 *   Minnesläget (prototypen, utveckling, e2e): testdatats tydligt märkta ersättning (src/data/seed/pnr.ts, TEST_PNR_CRYPTO).
 *   Supabase-läget: AES-256-GCM (MM_PNR_KEY) och HMAC-SHA256 (MM_PNR_HMAC_KEY) på servern (src/server/crypto.ts).
 * Tom sträng in ger tom sträng ut. hashPnr normaliserar först (de tio sista siffrorna), så olika skrivsätt ger samma hash.
 */
export type PnrCrypto = {
  encryptPnr(pnr: string): string;
  /** Kastar om värdet inte går att dekryptera (fel format eller fel nyckel). */
  decryptPnr(enc: string): string;
  hashPnr(pnr: string): string;
};

/**
 * Serverns kö för bakgrundsjobb (supabase-läget): schedule() kör köade jobb snart, med after() när svaret skickats –
 * annars tar cron (/api/jobs/run varje minut) dem. Finns inte i minnesläget och prototypen – där körs jobbet direkt.
 */
export type JobKick = { schedule(): void };

export type Ctx = {
  actor: Actor;
  /** Stockholms lokala tid. Prototypen har en egen demoklocka. */
  now(): LocalDateTime;
  repo: AppRepo;
  /** Repo utan behörighetsfilter – motsvarar service role. Bara för systemsteg som hanteraren uttryckligen behöver (t.ex. löpnummer, revisionslogg). */
  system: AppRepo;
  newId(prefix: string): string;
  audit(entry: AuditEntry): Promise<void>;
  notify(msg: OutgoingMessage): Promise<void>;
  /** Personnummer: kryptera, dekryptera ("Visa", loggas av hanteraren) och sökhash (dubblettkontrollen). */
  crypto: PnrCrypto;
  /**
   * AI-stödet (SPEC §8.3, src/features/_shared/ai-port.ts): transcribe, extract, draft, translate. Minnesläget: simulerad AI.
   * Supabase-läget: leverantören i MM_AI_PROVIDER (src/server/ai). Hämtas med requireAi(ctx) – saknas den blir det ett
   * begripligt fel och den manuella vägen gäller. Aldrig för skyddade personuppgifter eller utan samtycke (recordingBlock).
   */
  ai?: AiPort;
  /**
   * Ljudlagringen för röstinspelning (src/features/_shared/audio-port.ts): createUpload, confirm, read, mark, remove.
   * Minnesläget: ljud i minnet. Supabase-läget: privat bucket "ljud" i Stockholm (src/server/audio). Hämtas med requireAudio(ctx).
   */
  audio?: AudioPort;
  /**
   * Bilagor till beställningen (src/features/_shared/attachment-port.ts, beslut 2026-10-07): createUpload, confirm, link,
   * signedDownload, remove. Minnesläget: filerna i minnet. Supabase-läget: privat bucket "bilagor" i Stockholm
   * (src/server/attachments). Hämtas med requireAttachments(ctx).
   */
  attachments?: AttachmentPort;
  /** Jobbkön (src/server/jobs, röstjobben i src/features/_shared/voice-jobs.ts). Saknas i minnesläget och prototypen. */
  jobs?: JobKick;
  /**
   * Bara minnesläget (prototypen, utvecklingsläget, e2e): engångslänkarnas sökväg (med token) får lämnas ut i svaret, så att
   * prototypen kan visa länken som deltagaren fick. Saknas på servern i supabase-läget – där finns token bara i utskicket.
   */
  exposeLinkPaths?: boolean;
};

type Handler = (ctx: Ctx, input: unknown) => Promise<unknown>;
type Entry = { kind: "query" | "command"; roles?: readonly Role[]; silent?: boolean; commercial?: boolean; run: Handler; schema: { safeParse(v: unknown): { success: boolean; data?: unknown; error?: { issues: unknown[] } } } };

const registry = new Map<string, Entry>();

export type HandlerOpts = {
  /** Roller som får anropa. Utelämnas bara när hanteraren själv filtrerar per roll. */
  roles?: readonly Role[];
  /** Kommandon som bara registrerar att något lästs/visats (t.ex. läskvitto, visningslogg). Flyttar inte demoklockan. */
  silent?: boolean;
  /**
   * Hela frågan eller kommandot handlar om priser, belopp, fakturaunderlag eller avtalsvillkor (avtalssidan, jämförelsen,
   * prislistan, interna regler, Ekonomi). Nekas för begränsade testare i testmiljön (src/api/tester-access.ts) med koden
   * "tester_hidden" – skärmen visar "Den här sidan visas inte för testare."
   */
  commercial?: boolean;
};

export function handleQuery<P, R>(def: QueryDef<P, R>, opts: HandlerOpts, run: (ctx: Ctx, params: P) => Promise<R> | R) {
  register(def.key, { kind: "query", roles: opts.roles, commercial: opts.commercial, run: (ctx, p) => Promise.resolve(run(ctx, p as P)), schema: def.schema as never });
}
export function handleCommand<P, R>(def: CommandDef<P, R>, opts: HandlerOpts, run: (ctx: Ctx, payload: P) => Promise<R> | R) {
  register(def.key, { kind: "command", roles: opts.roles, silent: opts.silent, commercial: opts.commercial, run: (ctx, p) => Promise.resolve(run(ctx, p as P)), schema: def.schema as never });
}
function register(key: string, e: Entry) {
  if (registry.has(key)) throw new Error(`Hanteraren ${key} är redan registrerad`);
  registry.set(key, e);
}

export class ApiError extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 500, public readonly code: string, message: string) {
    super(message);
  }
}

/** Kör en fråga eller ett kommando: validera indata (zod), kontrollera roll, kör hanteraren. */
export async function execute(kind: "query" | "command", key: string, input: unknown, ctx: Ctx): Promise<unknown> {
  const e = registry.get(key);
  if (!e || e.kind !== kind) throw new ApiError(404, "unknown_key", `Okänd ${kind === "query" ? "fråga" : "åtgärd"}: ${key}`);
  if (e.roles && !e.roles.includes(ctx.actor.role)) throw new ApiError(403, "forbidden", "Din roll har inte behörighet till det här.");
  // Begränsade testare (testmiljön): sidor om pengar och villkor nekas, och rollen ekonom får de inte agera som.
  if ((e.commercial && hidesCommercial(ctx.actor)) || testerRoleBlocks(ctx.actor, key)) throw new ApiError(403, TESTER_HIDDEN_CODE, TESTER_HIDDEN_PAGE);
  const parsed = e.schema.safeParse(input ?? {});
  if (!parsed.success) throw new ApiError(400, "invalid_input", "Ogiltiga uppgifter.");
  try {
    return await e.run(ctx, parsed.data);
  } catch (err) {
    if (err instanceof PolicyError) throw new ApiError(403, "forbidden", "Din roll har inte behörighet till det här.");
    throw err;
  }
}

export const registeredKeys = () => [...registry.keys()];
/** Nycklar som nekas för begränsade testare (HandlerOpts.commercial) – för testerna. */
export const commercialKeys = () => [...registry.entries()].filter(([, e]) => e.commercial).map(([k]) => k);
export const isSilentCommand = (key: string) => registry.get(key)?.silent === true;
/** Rollerna som får köra nyckeln (undefined = alla roller) – för testerna (src/api/invalidation.test.ts). */
export const rolesOf = (key: string): readonly Role[] | undefined => registry.get(key)?.roles;
