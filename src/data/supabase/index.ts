// Datalagret mot Supabase. Klienterna skapas i src/server/supabase.ts (användarens session eller service role).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRepo, Tables } from "../schema";
import { SupabaseRepo, type PgClient } from "./repo";

export { SupabaseRepo, DataError, toRepoError, applyWhere, PAGE_SIZE, IN_CHUNK, type PgClient, type PgError, type PgResult, type SupabaseRepoOpts } from "./repo";
export { toColumn, toField, toDbRow, fromDbRow, toTimestamptz, fromTimestamptz, normalizeTimestamptz } from "./columns";

/**
 * Tabeller som användarens repo läser via en vy: contracts_public (0002: kommunen får inte avtalets interna mål),
 * cases_public (0013: plats, mötestider och bakgrund döljs i skyddade ärenden och för ekonomen) och tabellerna med belopp i
 * kronor (0034: beloppen bara för den som har rollen ekonom – MONEY_MASK i src/data/policy.ts).
 */
export const USER_READ_VIEWS: Readonly<Record<string, string>> = {
  contracts: "contracts_public",
  cases: "cases_public",
  price_items: "price_items_public",
  invoice_drafts: "invoice_drafts_public",
  invoice_lines: "invoice_lines_public",
  bonus_claims: "bonus_claims_public",
  contract_deviations: "contract_deviations_public",
  ai_runs: "ai_runs_public",
};

/** Repo för systemsteg (service role, ctx.system): läser och skriver tabellerna direkt. */
export function appRepo(client: SupabaseClient | PgClient): AppRepo {
  return new SupabaseRepo<Tables>(client as unknown as PgClient);
}

/** Repo med användarens session (ctx.repo): RLS gäller, och contracts och cases läses via sina vyer. */
export function userRepo(client: SupabaseClient | PgClient): AppRepo {
  return new SupabaseRepo<Tables>(client as unknown as PgClient, { readFrom: USER_READ_VIEWS });
}
