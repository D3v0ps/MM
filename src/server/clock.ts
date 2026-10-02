// Klockan i supabase-läget. Produktion: riktig tid i Stockholm. Testmiljön: testtid – klockan startade på DEMO_START
// (2027-02-01T09:12) när seeden lästes in och går sedan i vanlig takt. Epokerna finns i app_settings
// (clock_real_epoch = riktig tid när seeden lästes in, clock_demo_epoch = testtiden då).
import { addMinutes, toStockholmLocal, type LocalDateTime } from "@/core/time";
import { isTimestamptz, normalizeTimestamptz } from "@/data/supabase/columns";

export type ClockSettings = { mode: "real" | "test"; realEpochMs: number | null; demoEpoch: LocalDateTime | null };
export const REAL_CLOCK: ClockSettings = { mode: "real", realEpochMs: null, demoEpoch: null };

/** Riktig tidpunkt (timestamptz-text eller ms) -> millisekunder. */
export function parseEpochMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d{10,16}$/.test(s)) return Number(s);
  if (!isTimestamptz(s)) return null;
  const n = Date.parse(normalizeTimestamptz(s));
  return Number.isFinite(n) ? n : null;
}

/** Testtidens start: LocalDateTime ('2027-02-01T09:12') eller timestamptz-text. */
export function parseDemoEpoch(v: string | null | undefined): LocalDateTime | null {
  if (!v) return null;
  const s = v.trim().replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) return s.slice(0, 16);
  if (isTimestamptz(s)) return toStockholmLocal(normalizeTimestamptz(s));
  return null;
}

/** Välj klocka: MM_CLOCK=real ger alltid riktig tid; annars testtid när epokerna finns. */
export function clockSettings(mode: "real" | "test" | "auto", realEpoch: string | null | undefined, demoEpoch: string | null | undefined): ClockSettings {
  if (mode === "real") return REAL_CLOCK;
  const realEpochMs = parseEpochMs(realEpoch);
  const demo = parseDemoEpoch(demoEpoch);
  if (realEpochMs == null || demo == null) return REAL_CLOCK;
  return { mode: "test", realEpochMs, demoEpoch: demo };
}

/** Klockan just nu (Stockholms lokala tid, minutupplösning). */
export function clockNow(s: ClockSettings, nowMs: number): LocalDateTime {
  if (s.mode === "test" && s.realEpochMs != null && s.demoEpoch) {
    const minutes = Math.max(0, Math.floor((nowMs - s.realEpochMs) / 60_000));
    return addMinutes(s.demoEpoch, minutes);
  }
  return toStockholmLocal(new Date(nowMs).toISOString());
}
