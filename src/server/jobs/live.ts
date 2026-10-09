// Kör bakgrundsjobben mot Supabase (service role). Används av POST /api/jobs/run och av after() efter ett utskick eller
// ett röstjobb (schedule.ts). Före varje körning läggs timmens gallringsjobb (ljud och råtranskript), timmens jobb för
// bilagorna och kontostädningen (attachments.ts), tiominutersperiodens jobb för rapportutkasten (reports.ts) och
// tvåminutersperiodens mejlinläsning från avrop@ (inbox.ts) om de saknas.
import "server-only";
import type { Ctx } from "@/api/server";
import { SYSTEM_ACTOR } from "@/api/roles";
import { appRepo } from "@/data/supabase";
import { DataError, SupabaseRepo, type PgClient } from "@/data/supabase/repo";
import { serverAi } from "../ai";
import { serverAttachments } from "../attachments";
import { serverAudio } from "../audio";
import { clockNow } from "../clock";
import { lazyServerCrypto } from "../crypto";
import { liveCtx, randomId, type Enqueue } from "../ctx";
import { phoneGate, recipientGate } from "../notify/decision";
import { notifyEnv, phoneEnv } from "../notify/config";
import type { ElksFetch } from "../notify/elks";
import { queueMessage } from "../notify/queue";
import type { FetchLike } from "../notify/resend";
import type { NotifyRepo, NotifyTables } from "../notify/types";
import { clockMode } from "../config";
import { loadAppSettings, settingsFromRows } from "../settings";
import { serviceClient } from "../supabase";
import { JOB_HANDLERS, type JobDeps } from "./registry";
import { safeErrorText } from "./errors";
import { ensureReportScheduleJob, reportScheduleState, type AppSettingsClient } from "./reports";
import { runJobs, type RunSummary } from "./runner";
import { supabaseJobStore, type RpcClient } from "./store";
import { ensureRetentionJobs } from "./voice";
import { deleteOrphanAuthUsers, ensureHourlyJobs, type AuthAdminLike } from "./attachments";
import { ensureInboxImportJob, runInboxImport } from "./inbox";
import { docxText } from "../inbox/docx-text";
import type { GraphFetch } from "../inbox/graph";

/** Paus mellan jobben – håller oss under Resends gräns för anrop per sekund. */
const PAUSE_MS = 500;

/** Alla rader i app_settings, utan cache (rapportutkasten: testklockan och högvattenmärkena precis när jobbet körs). */
async function freshSettingsRows(db: PgClient): Promise<{ key: string; value: unknown }[]> {
  const { data, error } = await db.from("app_settings").select("key,value");
  if (error) throw new DataError("app_settings", String(error.code ?? ""));
  return (data as { key: string; value: unknown }[] | null) ?? [];
}

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
  const phone = phoneEnv();
  const system = appRepo(client);
  // Röstjobbens Ctx (systemsteg: service role, AI-leverantören, ljudlagringen) byggs först när ett röstjobb körs.
  let voice: Ctx | null = null;
  // Utskick från systemstegen läggs i kön och skickas av cron.
  const enqueue: Enqueue = (sys, msg, at) => queueMessage(sys as unknown as NotifyRepo, msg, at, randomId, { appUrl: cfg.appUrl, phone: { sms: !!phone.sms, call: !!phone.call } });
  const voiceCtx = (): Ctx =>
    (voice ??= liveCtx({
      actor: SYSTEM_ACTOR,
      now,
      repo: system,
      system,
      // Röstjobben skickar inga utskick själva; om det behövs läggs de i kön och cron skickar dem.
      enqueue,
      crypto: lazyServerCrypto,
      ai: serverAi(settings.environment),
      audio: (d) => serverAudio(d),
      attachments: (d) => serverAttachments(d),
      messaging: phone.status,
    }));
  // Städningen av Auth-användare utan profil (självregistrering som aldrig slutfördes).
  const authCleanup = async () => {
    const service = serviceClient();
    return deleteOrphanAuthUsers(service.auth.admin as unknown as AuthAdminLike, async (u) => {
      const byId = await service.from("profiles").select("id").eq("auth_user_id", u.id).maybeSingle();
      if (byId.error) throw new DataError("profiles", String(byId.error.code ?? ""));
      if (byId.data) return true;
      if (!u.email) return false;
      const byEmail = await service.from("profiles").select("id").eq("email", u.email).maybeSingle();
      if (byEmail.error) throw new DataError("profiles", String(byEmail.error.code ?? ""));
      return !!byEmail.data;
    }, Date.now());
  };
  // Rapportutkasten: klockan och läget läses om utan cache när jobbet körs. Inställningarna ovan kan vara upp till 30 sekunder
  // gamla – direkt efter "Läs in testdata på nytt" skulle klockan då stå på den förra testtiden (src/server/jobs/reports.ts).
  const reportSchedule = async () => {
    const rows = await freshSettingsRows(client);
    const fresh = settingsFromRows(rows, clockMode());
    const at = clockNow(fresh.clock, Date.now());
    const ctx = liveCtx({
      actor: SYSTEM_ACTOR,
      now: at,
      repo: system,
      system,
      // Veckorapporter som publiceras direkt lägger "ny rapport" i utskickskön.
      enqueue,
      crypto: lazyServerCrypto,
    });
    return { ctx, state: reportScheduleState(client as unknown as AppSettingsClient, rows, fresh.clock) };
  };
  try {
    await ensureRetentionJobs(system, now);
  } catch (e) {
    // Gallringen läggs vid nästa körning (inom en minut). Övriga jobb körs ändå.
    console.error("jobb: gallringen kunde inte läggas", safeErrorText(e));
  }
  try {
    await ensureHourlyJobs(system, now);
  } catch (e) {
    // Bilagornas gallring och kontostädningen läggs vid nästa körning.
    console.error("jobb: timjobben kunde inte läggas", safeErrorText(e));
  }
  try {
    await ensureReportScheduleJob(system, now);
  } catch (e) {
    // Rapportutkasten läggs vid nästa körning (inom en minut). Övriga jobb körs ändå.
    console.error("jobb: rapportutkasten kunde inte läggas", safeErrorText(e));
  }
  try {
    await ensureInboxImportJob(system, now);
  } catch (e) {
    // Mejlinläsningen läggs vid nästa körning (inom en minut). Övriga jobb körs ändå.
    console.error("jobb: mejlinläsningen kunde inte läggas", safeErrorText(e));
  }
  const deps: JobDeps = {
    notify: {
      repo: new SupabaseRepo<NotifyTables>(client),
      gate: recipientGate(env, cfg.allowlist, cfg.redirectTo),
      render: { appUrl: cfg.appUrl, staffDomains: cfg.staffDomains },
      resend: cfg.resend,
      fetch: globalThis.fetch as unknown as FetchLike,
      now,
      // SMS och utringning via 46elks – samma spärr för testmiljön som e-posten (MM_SMS_ALLOWLIST, MM_SMS_REDIRECT_TO).
      phone: { gate: phoneGate(env, phone.allowlist, phone.redirectTo), sms: phone.sms, call: phone.call, fetch: globalThis.fetch as unknown as ElksFetch },
    },
    voice: voiceCtx,
    reportSchedule,
    attachmentsCtx: voiceCtx,
    authCleanup,
    // Mejlinläsningen från avrop@: systemstegens Ctx (service role, bilagor, krypto, utskickskön) och Graph via fetch.
    inboxImport: () => runInboxImport({ ctx: voiceCtx(), repo: system, now, fetchFn: globalThis.fetch as unknown as GraphFetch, docxText }),
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
