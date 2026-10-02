// app_settings (key, value): miljön (staging/produktion) och testklockans epoker. Läses med service role och cachas kort.
import type { PgClient } from "@/data/supabase/repo";
import { clockSettings, type ClockSettings } from "./clock";
import { clockMode } from "./config";
import { toEnvironment } from "./session-policy";

export type AppSettings = { environment: "staging" | "production"; clock: ClockSettings };

/** Raderna i app_settings -> inställningar. Saknad miljörad = produktion (ingen testarfunktion). */
export function settingsFromRows(rows: readonly { key: string; value: unknown }[], mode: "real" | "test" | "auto"): AppSettings {
  const get = (k: string): string | null => {
    const v = rows.find((r) => r.key === k)?.value;
    return v == null ? null : String(v);
  };
  return {
    environment: toEnvironment(get("environment")),
    clock: clockSettings(mode, get("clock_real_epoch"), get("clock_demo_epoch")),
  };
}

const CACHE_MS = 30_000;
let cache: { at: number; value: AppSettings } | null = null;

/** Inställningarna (cachade 30 sekunder per serverinstans). */
export async function loadAppSettings(system: PgClient, nowMs: number): Promise<AppSettings> {
  if (cache && nowMs - cache.at < CACHE_MS) return cache.value;
  const { data, error } = await system.from("app_settings").select("key,value");
  if (error) throw new Error(`app_settings kunde inte läsas (${error.code ?? "okänt"})`);
  const value = settingsFromRows((data as { key: string; value: unknown }[] | null) ?? [], clockMode());
  cache = { at: nowMs, value };
  return value;
}

/** Töm cachen (t.ex. efter att seeden lästs in igen). */
export const clearAppSettingsCache = () => {
  cache = null;
};
