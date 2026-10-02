// Rapportutkast som skapas automatiskt (rapportarbetet steg 1). Bara för systemsteg – importeras aldrig av skärmar.
//
// Körs av:
//   - jobbkörningen i testmiljön och produktionen (src/server/jobs/reports.ts) högst var tionde minut
//   - minnesläget och prototypen (src/data/memory-runtime.ts) när testdatat läses in och när klockan passerar en vecko- eller
//     månadsgräns
//
// Vilka perioder som prövas: scheduleFrom() i src/core/report-schedule.ts, per avtal utifrån
//   - högvattenmärket (state.checkedThrough): ctx.now() vid den senaste körningen där hela avtalet gicks igenom. Märket
//     flyttas bara när avtalet gåtts igenom utan fel, så en körning som avbryts halvvägs (fel i databasen, serverns
//     tidsgräns) tas om från samma ställe av nästa körning. Saknas märket prövas allt från avtalets start; har jobbet stått
//     still längre än fönstret prövas allt från märket.
//   - golvet (state.floor): testdatat är komplett till testklockans start – perioder som slutar senast då skapas aldrig.
//     Det gör att inget skapas på nyinläst testdata, inte heller medan testdatat läses in. null i produktionen.
//   - fönstret (LOOKBACK_DAYS): de senaste 62 dagarna prövas alltid, så att ett ärende som fått ett startdatum i efterhand
//     får sina rapporter. Bara rapporterna från fönstret läses.
// Reglerna finns i src/core/report-schedule.ts (avtalskonfigurationen, reportSchedule). Funktionen är idempotent: samma
// körning två gånger skapar inget nytt, och om två körningar krockar stoppar de unika indexen (0018_rapportutkast.sql)
// dubbletten – den hoppas över utan fel.
//
// ctx.system används för allt: det är ett systemsteg utan användare (motsvarar service role). Raderna innehåller bara id:n,
// perioder och tider. Varje skapad rad loggas (report.created, systemet) och en veckorapport där all närvaro redan är
// registrerad publiceras direkt (publishWeeklyIfComplete) – annars väntar den på närvaron som i dag.
import type { Ctx } from "@/api/server";
import { automaticKinds, missingReports, scheduleFrom, type ScheduleInput } from "@/core/report-schedule";
import { addDays, dayOf, monthKey, type LocalDateTime } from "@/core/time";
import type { Report, WeekKey } from "@/data/schema";
import { publishWeeklyIfComplete } from "../_shared/weekly";

/**
 * Var körningarna har kommit. Sparas av den som kör: app_settings i testmiljön och produktionen (src/server/jobs/reports.ts),
 * i minnet i prototypen och utvecklingsläget (src/data/memory-runtime.ts).
 */
export type ReportScheduleState = {
  /** Testdatat är komplett hit (testklockans start): perioder som slutar senast då skapas aldrig. null = ingen gräns. */
  floor: LocalDateTime | null;
  /** Avtalets högvattenmärke, eller null om avtalet aldrig gåtts igenom helt. */
  checkedThrough(contractId: string): Promise<LocalDateTime | null>;
  /** Spara högvattenmärket när hela avtalet gåtts igenom (alla rader som saknades är skapade). */
  markChecked(contractId: string, at: LocalDateTime): Promise<void>;
};

/** Inget sparat och inget golv: hela avtalstiden prövas vid varje körning (tester och jämförelser). */
export const FULL_HISTORY: ReportScheduleState = { floor: null, checkedThrough: async () => null, markChecked: async () => undefined };

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

/** Skapa de rapportrader som ska finnas men saknas, för perioder som slutat senast ctx.now() (se överst i filen). */
export async function ensureReports(ctx: Ctx, state: ReportScheduleState): Promise<EnsureReportsResult> {
  const s = ctx.system;
  const now = ctx.now();
  const res: EnsureReportsResult = { created: [], published: 0, duplicates: 0 };
  const contracts = (await s.table("contracts").list({ status: "active" }, { orderBy: "id" })).filter((c) => automaticKinds(c.config).length > 0);
  for (const contract of contracts) {
    const kinds = automaticKinds(contract.config);
    const since = scheduleFrom({ now, checkedThrough: await state.checkedThrough(contract.id), floor: state.floor });
    // Rapporterna läses bara från fönstret (med en veckas marginal för perioder som slutar i början av det).
    const loadFrom = since ? addDays(dayOf(since), -7) : null;
    const [cases, memberships, existing] = await Promise.all([
      s.table("cases").list({ contractId: contract.id }, { orderBy: "id" }),
      s.table("memberships").list({ contractId: contract.id, role: { in: ["kommun_handlaggare", "kommun_chef"] } }, { orderBy: "id" }),
      s.table("reports").list({ contractId: contract.id, kind: { in: kinds }, ...(loadFrom ? { periodEnd: { gte: loadFrom } } : {}) }),
    ]);
    // Bara konton som är aktiva får rapporter – ett spärrat konto kan inte läsa dem.
    const userIds = [...new Set(memberships.map((m) => m.userId))];
    const active = new Set(userIds.length ? (await s.table("profiles").list({ id: { in: userIds }, active: true })).map((p) => p.id) : []);
    const recipients = (role: string) => memberships.filter((m) => m.role === role && active.has(m.userId)).map((m) => m.userId);
    const caseIds = cases.map((c) => c.id);
    const approved = kinds.includes("monthly") && caseIds.length
      ? await s.table("monthly_assessments").list({ caseId: { in: caseIds }, status: "approved", ...(loadFrom ? { month: { gte: monthKey(loadFrom) } } : {}) })
      : [];
    const input: ScheduleInput = {
      contract: { id: contract.id, startsOn: contract.startsOn, endsOn: contract.endsOn, config: contract.config },
      cases,
      caseworkerIds: recipients("kommun_handlaggare"),
      managerIds: recipients("kommun_chef"),
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
    // Hela avtalet är genomgånget – nästa körning behöver bara pröva fönstret (eller från hit, om den dröjer).
    await state.markChecked(contract.id, now);
  }
  return res;
}
