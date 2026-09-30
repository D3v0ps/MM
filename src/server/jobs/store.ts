// JobStore mot Supabase (service role). mm.claim_jobs nås via public.claim_jobs (bara service role får anropa den).
import type { LocalDateTime } from "@/core/time";
import { SupabaseRepo, type PgClient, type PgResult } from "@/data/supabase/repo";
import { DataError, fromDbRow, toTimestamptz } from "@/data/supabase";
import type { JobRow, NotifyTables } from "../notify/types";
import type { JobPatch, JobStore } from "./runner";

/** Den del av supabase-js som behövs för rpc (lätt att fejka i tester). */
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<PgResult<unknown>>;
}

export function supabaseJobStore(client: PgClient & RpcClient): JobStore {
  const jobs = new SupabaseRepo<NotifyTables>(client).table("jobs");
  return {
    async claim(n: number, now: LocalDateTime, maxAttempts: number): Promise<JobRow[]> {
      const { data, error } = await client.rpc("claim_jobs", { n, p_now: toTimestamptz(now), p_max_attempts: maxAttempts });
      if (error) throw new DataError("jobs", String(error.code ?? ""));
      return ((data as Record<string, unknown>[] | null) ?? []).map((r) => fromDbRow<JobRow>(r));
    },
    async finish(id: string, patch: JobPatch): Promise<void> {
      await jobs.update(id, patch);
    },
  };
}
