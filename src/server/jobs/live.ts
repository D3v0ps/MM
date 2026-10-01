// Kör bakgrundsjobben mot Supabase (service role). Används av POST /api/jobs/run och av after() efter ett utskick eller
// ett röstjobb (schedule.ts). Före varje körning läggs timmens gallringsjobb (ljud och råtranskript) om de saknas.
import "server-only";
import type { Ctx } from "@/api/server";
import { SYSTEM_ACTOR } from "@/api/roles";
import { appRepo } from "@/data/supabase";
import { DataError, SupabaseRepo, type PgClient } from "@/data/supabase/repo";
import { serverAi } from "../ai";
import { serverAudio } from "../audio";
import { clockNow } from "../clock";
import { lazyServerCrypto } from "../crypto";
import { liveCtx, randomId } from "../ctx";
import { recipientGate } from "../notify/decision";
import { notifyEnv } from "../notify/config";
import { queueMessage } from "../notify/queue";
import type { FetchLike } from "../notify/resend";
import type { NotifyRepo, NotifyTables } from "../notify/types";
import { loadAppSettings } from "../settings";
import { serviceClient } from "../supabase";
import { JOB_HANDLERS, type JobDeps } from "./registry";
import { safeErrorText } from "./errors";
import { runJobs, type RunSummary } from "./runner";
import { supabaseJobStore, type RpcClient } from "./store";
import { ensureRetentionJobs } from "./voice";

/** Paus mellan jobben – håller oss under Resends gräns för anrop per sekund. */
const PAUSE_MS = 500;

/** app_settings.environment som den står i databasen (null om raden saknas). Spärren för mottagare bygger på den. */
async function environmentSetting(db: PgClient): Promise<string | null> {
  const { data, error } = await db.from("app_settings").select("value").eq("key", "environment").maybeSingle();
  if (error) throw new DataError("app_settings", String(error.code ?? ""));
  const v = (data as { value?: unknown } | null)?.value;
  return typeof v === "string" ? v : null;
}

export async function runDueJobs(opts: { limit?: number } = {}): Promise<RunSummary> {
  const client = serviceClient() as unknown as PgClient & RpcClient;
  const startedMs = Date.now();
  const [settings, env] = await Promise.all([loadAppSettings(client, startedMs), environmentSetting(client)]);
  const now = clockNow(settings.clock, startedMs);
  const cfg = notifyEnv();
  const system = appRepo(client);
  // Röstjobbens Ctx (systemsteg: service role, AI-leverantören, ljudlagringen) byggs först när ett röstjobb körs.
  let voice: Ctx | null = null;
  const voiceCtx = (): Ctx =>
    (voice ??= liveCtx({
      actor: SYSTEM_ACTOR,
      now,
      repo: system,
      system,
      // Röstjobben skickar inga utskick själva; om det behövs läggs de i kön och cron skickar dem.
      enqueue: (sys, msg, at) => queueMessage(sys as unknown as NotifyRepo, msg, at, randomId),
      crypto: lazyServerCrypto,
      ai: serverAi(settings.environment),
      audio: (d) => serverAudio(d),
    }));
  try {
    await ensureRetentionJobs(system, now);
  } catch (e) {
    // Gallringen läggs vid nästa körning (inom en minut). Övriga jobb körs ändå.
    console.error("jobb: gallringen kunde inte läggas", safeErrorText(e));
  }
  const deps: JobDeps = {
    notify: {
      repo: new SupabaseRepo<NotifyTables>(client),
      gate: recipientGate(env, cfg.allowlist, cfg.redirectTo),
      render: { appUrl: cfg.appUrl, staffDomains: cfg.staffDomains },
      resend: cfg.resend,
      fetch: globalThis.fetch as unknown as FetchLike,
      now,
    },
    voice: voiceCtx,
  };
  return runJobs({
    store: supabaseJobStore(client),
    handlers: JOB_HANDLERS,
    ctx: deps,
    now,
    limit: opts.limit,
    pauseMs: PAUSE_MS,
    elapsedMs: () => Date.now() - startedMs,
  });
}
