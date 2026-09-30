// Kör bakgrundsjobben mot Supabase (service role). Används av POST /api/jobs/run och av after() efter ett utskick.
import "server-only";
import { DataError, SupabaseRepo, type PgClient } from "@/data/supabase/repo";
import { clockNow } from "../clock";
import { recipientGate } from "../notify/decision";
import { notifyEnv } from "../notify/config";
import type { FetchLike } from "../notify/resend";
import type { NotifyTables } from "../notify/types";
import { loadAppSettings } from "../settings";
import { serviceClient } from "../supabase";
import { JOB_HANDLERS, type JobDeps } from "./registry";
import { runJobs, type RunSummary } from "./runner";
import { supabaseJobStore, type RpcClient } from "./store";

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
  const deps: JobDeps = {
    notify: {
      repo: new SupabaseRepo<NotifyTables>(client),
      gate: recipientGate(env, cfg.allowlist),
      render: { appUrl: cfg.appUrl, staffDomains: cfg.staffDomains },
      resend: cfg.resend,
      fetch: globalThis.fetch as unknown as FetchLike,
      now,
    },
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
