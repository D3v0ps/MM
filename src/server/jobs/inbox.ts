// Jobbet inbox_import (beslut 4c, 2026-10-08): läser avrop@ via Microsoft Graph varannan minut (SPEC §7.1 "var 2–5 minut").
//   Läggs före varje jobbkörning (live.ts) med ett id per tvåminutersperiod – samma id gör att det bara läggs en gång, och
//   två samtidiga körningar ger ett dubblettfel som ignoreras (som rapportutkasten, reports.ts).
//   Saknas inställningarna (MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MM_INBOX_MAILBOX) gör jobbet
//   ingenting (utfallet not_configured), och integrationsraden säger "inte kopplad" så att /admin/integrationer kan visa
//   hur man kopplar. Läget (senaste körning, senaste fel, antal) sparas i integrations.config – aldrig hemligheter.
//   Fel: JobError från Graph (status, steg) eller ett annat fel – felorsaken sparas i jobs.last_error utan personuppgifter
//   (errors.ts) och jobbet försöks igen med runner.ts väntetider.
import type { Ctx } from "@/api/server";
import type { LocalDateTime } from "@/core/time";
import type { Repo } from "@/data/repo";
import type { Integration, Job } from "@/data/schema";
import { DataError } from "@/data/supabase/repo";
import { importInbox, type ImportSummary } from "../inbox/import";
import { graphEnv, graphMail, type GraphFetch, type GraphMail } from "../inbox/graph";
import { JobError, safeErrorText } from "./errors";
import type { JobHandler } from "./runner";

export const INBOX_IMPORT_JOB = "inbox_import";
/** Så ofta brevlådan läses (minuter). */
export const INBOX_INTERVAL_MINUTES = 2;
/** Integrationsraden som adminsidan läser (seedens id för avrop@-brevlådan). */
export const GRAPH_INTEGRATION_ID = "graph";

/** Jobbets id för tvåminutersperioden: "job-inbox_import-2027-02-01T09:12" (09.12–09.13). */
export function inboxImportJobId(now: LocalDateTime): string {
  const minute = Number(now.slice(14, 16));
  const slot = Math.floor(minute / INBOX_INTERVAL_MINUTES) * INBOX_INTERVAL_MINUTES;
  return `job-${INBOX_IMPORT_JOB}-${now.slice(0, 14)}${String(slot).padStart(2, "0")}`;
}

const isDuplicate = (e: unknown): boolean => (e instanceof DataError && e.code === "23505") || (!!e && typeof e === "object" && (e as { code?: unknown }).code === "23505");

/** Lägg periodens jobb om det saknas. Returnerar true om jobbet lades nu. */
export async function ensureInboxImportJob(repo: Repo<{ jobs: Job }>, now: LocalDateTime): Promise<boolean> {
  const jobs = repo.table("jobs");
  const id = inboxImportJobId(now);
  if (await jobs.get(id)) return false;
  try {
    await jobs.insert({ id, kind: INBOX_IMPORT_JOB, payload: {}, status: "queued", attempts: 0, runAfter: now, lastError: null, createdAt: now, createdBy: null, finishedAt: null });
    return true;
  } catch (e) {
    if (isDuplicate(e)) return false;
    throw e;
  }
}

// ---------------------------------------------------------------- Läget i integrations.config (inga hemligheter)
/** Det adminsidan visar om brevlådan. Sparas i integrations.config för raden "graph". */
export type InboxState = {
  configured: boolean;
  mailbox?: string;
  doneFolder?: string;
  lastRunAt: LocalDateTime;
  lastImportAt?: LocalDateTime;
  lastError: string | null;
  lastSummary?: ImportSummary;
};

export async function recordInboxState(repo: Repo<{ integrations: Integration }>, patch: InboxState): Promise<void> {
  const t = repo.table("integrations");
  const cur = await t.get(GRAPH_INTEGRATION_ID);
  const status: Integration["status"] = patch.configured ? "active" : "off";
  if (cur) await t.update(cur.id, { status, config: { ...cur.config, ...patch } });
  else await t.insert({ id: GRAPH_INTEGRATION_ID, kind: "graph", name: "avrop@-brevlådan", status, config: { description: "Microsoft Graph", ...patch }, secretsEnc: null, tokenExpiresAt: null });
}

// ---------------------------------------------------------------- Körningen
export type RunInboxOpts = {
  /** Systemsteg (service role): inbound_emails, cases, bilagor, utskickskön, revisionslogg. */
  ctx: Ctx;
  repo: Repo<{ integrations: Integration }>;
  now: LocalDateTime;
  env?: Record<string, string | undefined>;
  fetchFn?: GraphFetch;
  /** Fejkad Graph i tester (annars byggs klienten av miljön). */
  graph?: GraphMail;
  docxText?: (file: Uint8Array) => string;
};

/** Utfallet till jobbsammanfattningen: "not_configured", "none" eller "imported:<n>". */
export async function runInboxImport(o: RunInboxOpts): Promise<string> {
  const cfg = graphEnv(o.env ?? process.env);
  if (!cfg && !o.graph) {
    await recordInboxState(o.repo, { configured: false, lastRunAt: o.now, lastError: null });
    return "not_configured";
  }
  const graph = o.graph ?? graphMail(cfg as NonNullable<typeof cfg>, o.fetchFn ?? (globalThis.fetch as unknown as GraphFetch));
  const base = { configured: true as const, mailbox: cfg?.mailbox, doneFolder: cfg?.doneFolder, lastRunAt: o.now };
  try {
    const sum = await importInbox({ graph, ctx: o.ctx, now: o.now, docxText: o.docxText });
    const prev = (await o.repo.table("integrations").get(GRAPH_INTEGRATION_ID))?.config as { lastImportAt?: LocalDateTime } | undefined;
    await recordInboxState(o.repo, { ...base, lastImportAt: sum.imported ? o.now : prev?.lastImportAt, lastError: null, lastSummary: sum });
    return sum.imported ? `imported:${sum.imported}` : "none";
  } catch (e) {
    await recordInboxState(o.repo, { ...base, lastError: safeErrorText(e) }).catch(() => undefined);
    throw e;
  }
}

/** Det jobbet behöver: körningen, byggd av live.ts. Saknas den (andra tester) stoppas jobbet utan nya försök. */
export type InboxJobDeps = { inboxImport?: () => Promise<string> };

export function inboxJobHandler<D extends InboxJobDeps>(): JobHandler<D> {
  return {
    async run(_job, d) {
      if (!d.inboxImport) throw new JobError("Mejlinläsningen kan inte köras här", { retryable: false });
      return d.inboxImport();
    },
  };
}
