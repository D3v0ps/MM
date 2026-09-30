// Datalagret mot Supabase. Klienterna skapas i src/server/supabase.ts (användarens session eller service role).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRepo, Tables } from "../schema";
import { SupabaseRepo, type PgClient } from "./repo";

export { SupabaseRepo, DataError, toRepoError, applyWhere, PAGE_SIZE, IN_CHUNK, type PgClient, type PgError, type PgResult } from "./repo";
export { toColumn, toField, toDbRow, fromDbRow, toTimestamptz, fromTimestamptz, normalizeTimestamptz } from "./columns";

/** Repo<Tables> ovanpå en supabase-js-klient. Behörigheten avgörs av klientens roll (RLS eller service role). */
export function appRepo(client: SupabaseClient | PgClient): AppRepo {
  return new SupabaseRepo<Tables>(client as unknown as PgClient);
}
