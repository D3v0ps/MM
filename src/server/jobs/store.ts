// JobStore mot Supabase (service role). mm.claim_jobs nås via public.claim_jobs (bara service role får anropa den).
import type { LocalDateTime } from "@/core/time";
import { SupabaseRepo, type PgClient, type PgResult } from "@/data/supabase/repo";
import { DataError, fromDbRow, toTimestamptz } from "@/data/supabase";
import type { JobRow, NotifyTables } from "../notify/types";
import { STALE_MINUTES, type JobPatch, type JobStore } from "./runner";

/** Den del av supabase-js som behövs för rpc (lätt att fejka i tester). */
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<PgResult<unknown>>;
}

export function supabaseJobStore(client: PgClient & RpcClient): JobStore {
  const jobs = new SupabaseRepo<NotifyTables>(client).table("jobs");
  return {
    async claim(n: number, now: LocalDateTime, maxAttempts: number): Promise<JobRow[]> {
      // p_stale_after: jobb som fastnat i running (avbrutna vid tidsgränsen) hämtas igen efter STALE_MINUTES.
      const { data, error } = await client.rpc("claim_jobs", { n, p_now: toTimestamptz(now), p_max_attempts: maxAttempts, p_stale_after: `${STALE_MINUTES} minutes` });
      if (error) throw new DataError("jobs", String(error.code ?? ""));
      return ((data as Record<string, unknown>[] | null) ?? []).map((r) => fromDbRow<JobRow>(r));
    },
    async finish(id: string, patch: JobPatch): Promise<void> {
      await jobs.update(id, patch);
    },
  };
}
