// Rapportutkast som skapas automatiskt (rapportarbetet steg 1). Bara för systemsteg – importeras aldrig av skärmar.
//
// Körs av:
//   - jobbkörningen i testmiljön och produktionen (src/server/jobs/reports.ts) högst var tionde minut
//   - minnesläget och prototypen (src/data/memory-runtime.ts) när testdatat läses in och när klockan passerar en vecko- eller
//     månadsgräns
//
// Vilka perioder som prövas: allt som slutat efter frontlinjen och senast ctx.now(), högst LOOKBACK_DAYS bakåt.
// Frontlinjen är där rapportraderna som INTE skapats automatiskt slutar (testdatat, eller rader från tiden före funktionen) –
// per rapporttyp. Rader som körningen själv skapat (report.created i revisionsloggen) och rättelser (nya versioner) flyttar
// inte frontlinjen. Därför:
//   - på nyinläst testdata skapas inget (testdatat har raderna till och med vecka 4 och januari 2027)
//   - historiken före frontlinjen fylls aldrig i i efterhand
//   - efter frontlinjen prövas varje period i fönstret vid varje körning: en körning som avbröts halvvägs, eller ett ärende
//     som fått ett startdatum i efterhand, rättas av nästa körning
//   - fönstret (LOOKBACK_DAYS) håller körningen liten: bara rapporterna i fönstret läses
// Reglerna finns i src/core/report-schedule.ts (avtalskonfigurationen, reportSchedule). Funktionen är idempotent: samma
// körning två gånger skapar inget nytt, och om två körningar krockar stoppar de unika indexen (0018_rapportutkast.sql)
// dubbletten – den hoppas över utan fel.
//
// ctx.system används för allt: det är ett systemsteg utan användare (motsvarar service role). Raderna innehåller bara id:n,
// perioder och tider. Varje skapad rad loggas (report.created, systemet) och en veckorapport där all närvaro redan är
// registrerad publiceras direkt (publishWeeklyIfComplete) – annars väntar den på närvaron som i dag.
import type { Ctx } from "@/api/server";
import { automaticKinds, missingReports, reportFrontier, type ScheduleInput } from "@/core/report-schedule";
import type { AutoReportKind } from "@/core/config";
import { addDays, addMinutes, dayOf, monthKey, type LocalDateTime } from "@/core/time";
import type { Report, WeekKey } from "@/data/schema";
import { publishWeeklyIfComplete } from "../_shared/weekly";

/**
 * Så långt bakåt (dagar) varje körning prövar perioderna. Täcker förra månaden och de senaste åtta veckorna, även om
 * jobbet stått still en tid. Inte ett avtalsvärde – en driftgräns som håller körningen liten.
 */
export const LOOKBACK_DAYS = 62;

export type EnsureReportsResult = {
  /** Skapade rader (id, typ och period – inga namn). */
  created: { id: string; contractId: string; kind: Report["kind"]; period: string }[];
  /** Veckorapporter som publicerades direkt (all närvaro var redan registrerad). */
  published: number;
  /** Rader som en samtidig körning redan hade skapat (unika indexen). */
  duplicates: number;
};

/** Dubblett enligt ett unikt index (Postgres 23505). MemoryRepo har inga sådana index – där skyddar körningens lås. */
const isDuplicate = (e: unknown): boolean => !!e && typeof e === "object" && (e as { code?: unknown }).code === "23505";
const later = (a: LocalDateTime | null, b: LocalDateTime | null): LocalDateTime | null => (a && b ? (a > b ? a : b) : (a ?? b));

/**
 * Skapa de rapportrader som ska finnas men saknas, för perioder som slutat efter `since` och senast ctx.now().
 *   since utelämnad   frontlinjen inom fönstret (se överst i filen) – det som körningarna använder
 *   since = null      hela avtalstiden (bara för tester och jämförelser)
 */
export async function ensureReports(ctx: Ctx, opts: { since?: LocalDateTime | null } = {}): Promise<EnsureReportsResult> {
  const s = ctx.system;
  const now = ctx.now();
  const res: EnsureReportsResult = { created: [], published: 0, duplicates: 0 };
  const frontierMode = opts.since === undefined;
  const windowStart = frontierMode ? addMinutes(now, -LOOKBACK_DAYS * 24 * 60) : null;
  /** Rapporter och loggrader läses bara från fönstret (med en veckas marginal för perioder som slutar i början av det). */
  const loadFrom = windowStart ? addDays(dayOf(windowStart), -7) : null;
  const contracts = (await s.table("contracts").list({ status: "active" }, { orderBy: "id" })).filter((c) => automaticKinds(c.config).length > 0);
  for (const contract of contracts) {
    const kinds = automaticKinds(contract.config);
    const [cases, memberships, existing, auto] = await Promise.all([
      s.table("cases").list({ contractId: contract.id }, { orderBy: "id" }),
      s.table("memberships").list({ contractId: contract.id, role: { in: ["kommun_handlaggare", "kommun_chef"] } }, { orderBy: "id" }),
      s.table("reports").list({ contractId: contract.id, kind: { in: kinds }, ...(loadFrom ? { periodEnd: { gte: loadFrom } } : {}) }),
      // Raderna som körningen själv skapat (bara id:n).
      frontierMode ? s.table("audit_log").list({ action: "report.created", contractId: contract.id, ...(loadFrom ? { occurredAt: { gte: `${loadFrom}T00:00` } } : {}) }) : Promise.resolve([]),
    ]);
    const caseIds = cases.map((c) => c.id);
    const approved = kinds.includes("monthly") && caseIds.length
      ? await s.table("monthly_assessments").list({ caseId: { in: caseIds }, status: "approved", ...(loadFrom ? { month: { gte: monthKey(loadFrom) } } : {}) })
      : [];
    let since: ScheduleInput["since"] = opts.since ?? null;
    if (frontierMode) {
      const autoIds = new Set(auto.map((l) => l.entityId));
      const frontier = reportFrontier(existing.filter((r) => !r.previousId && !autoIds.has(r.id)));
      since = Object.fromEntries(kinds.map((k) => [k, later(frontier[k], windowStart)])) as Partial<Record<AutoReportKind, LocalDateTime | null>>;
    }
    const input: ScheduleInput = {
      contract: { id: contract.id, startsOn: contract.startsOn, endsOn: contract.endsOn, config: contract.config },
      cases,
      caseworkerIds: memberships.filter((m) => m.role === "kommun_handlaggare").map((m) => m.userId),
      managerIds: memberships.filter((m) => m.role === "kommun_chef").map((m) => m.userId),
      approvedAssessments: new Set(approved.map((m) => `${m.caseId}:${m.month}`)),
      existing,
      since,
      now,
    };
    for (const p of missingReports(input)) {
      const row: Report = { ...p, id: ctx.newId("rep") };
      try {
        await s.table("reports").insert(row);
      } catch (e) {
        if (isDuplicate(e)) {
          res.duplicates++;
          continue;
        }
        throw e;
      }
      const period = row.week ?? row.month ?? "";
      res.created.push({ id: row.id, contractId: row.contractId, kind: row.kind, period });
      await ctx.audit({
        action: "report.created", entity: "report", entityId: row.id, contractId: row.contractId,
        details: { kind: row.kind, ...(row.week ? { week: row.week } : {}), ...(row.month ? { month: row.month } : {}), ...(row.caseId ? { caseId: row.caseId } : {}), automatic: true },
      });
      if (row.kind === "weekly_attendance" && (await publishWeeklyIfComplete(ctx, row.contractId, row.recipientUserId, row.week as WeekKey))) res.published++;
    }
  }
  return res;
}
