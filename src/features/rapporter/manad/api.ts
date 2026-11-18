// Kontrakt för den interna månadsrapporten (Karims beslut 2026-11-18). Återexporteras från rapporter/api.ts, så att skärmarna och
// kontrollen av omräkningen (src/api/invalidation.test.ts) hittar dem. Importeras av skärmar – aldrig hanterarna.
//
// Vem: samordnare, avtalsansvarig, coach och chef i avtalet (MANAD_ROLES) – aldrig ekonomen, kommunen, systemadministratören eller
// deltagaren. Adressen har bara månaden (YYYY-MM), yrkesområdets kod och avtalets id – aldrig namn.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import type { Role } from "@/api/roles";
import { IdSchema, MonthKeySchema } from "../../_shared/schemas";
import type { MonthlyOverview } from "./model";

export type { MonthlyOverview, ParticipantRow, ParticipantSort, BarChartSpec, FlowChartSpec, ChartBar, ChartTarget, RateView, LevelRow, AttendanceRow, FlowRow } from "./model";
export { PARTICIPANT_SORTS, PARTICIPANT_SORT_LABEL, sortParticipants } from "./model";

/** Rollerna som läser den interna månadsrapporten (rutten, menyn och hanterarna). */
export const MANAD_ROLES: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "chef"];

/** Yrkesområdets kod (A–L i Botkyrka). */
const AreaCodeSchema = z.string().regex(/^[A-Z0-9]{1,4}$/);

export type OverviewOption = { value: string; label: string };
export type MonthlyOverviewView =
  | { allowed: false; contracts: OverviewOption[] }
  | ({
      allowed: true;
      contractId: string;
      contracts: OverviewOption[];
      contract: { number: string; name: string; customerName: string; casePrefix: string };
      /** Månaderna från avtalets start till och med innevarande, den senaste först. */
      months: OverviewOption[];
      /** Avtalets yrkesområden (A–L). */
      areas: OverviewOption[];
      /** Serverns tid när rapporten togs fram. */
      generatedAt: string;
    } & MonthlyOverview);

/**
 * Rapporten för ett avtal och en månad (standard: förra månaden), alla yrkesområden eller ett. Räknas av underlaget i ärendena
 * med läsarens behörighet (ctx.repo) – ingen databasmigration och inget fruset innehåll. Visningen loggas med
 * monthlyOverviewViewed (en gång per sidbesök och val), inte av frågan.
 */
export const monthlyOverview = query("rapporter.manadsrapport", z.object({
  contractId: IdSchema.optional(),
  month: MonthKeySchema.optional(),
  area: AreaCodeSchema.optional(),
})).returns<MonthlyOverviewView>();

const LogInput = z.object({ contractId: IdSchema, month: MonthKeySchema, area: AreaCodeSchema.nullable() });

/** Visningen (tyst): revisionsloggen får avtalet, månaden, yrkesområdet och ärendenas id:n – aldrig namn. */
export const monthlyOverviewViewed = command("rapporter.manadsrapportVisad", LogInput, { invalidates: "none" }).returns<Result<object, "not_found">>();

/**
 * PDF:en (tyst): servern prövar behörigheten och loggar nedladdningen först, och svarar med filnamnet (avtalets prefix, rapportens
 * slag och månaden). PDF:en byggs sedan i webbläsaren av samma vy-modell som sidan.
 */
export const monthlyOverviewPdf = command("rapporter.manadsrapportPdf", LogInput, { invalidates: "none" }).returns<Result<{ filename: string }, "not_found">>();
