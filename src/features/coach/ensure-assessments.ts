// Automatiska månadsbedömningar (Karims beslut 2026-10-22): steget i rapportjobbet som skapar de förifyllda utkasten. Bara för
// systemsteg – importeras aldrig av skärmar.
//
// "Allt ska vara ifyllt, våra huvudcoacher ska bara 'gå igenom' och kontrollera att vi inte missat något."
//
// Körs av:
//   - jobbkörningen i testmiljön och produktionen, i samma jobb som rapportutkasten (src/server/jobs/reports.ts) högst var
//     tionde minut
//   - minnesläget och prototypen (src/data/memory-runtime.ts) när klockan passerar en vecko- eller månadsgräns – samma funktion
//
// Månaden: "månaden att bedöma nu" – månaden före dagens (samma som Min vecka, assessMonthOf). Ärendena: de som får en
// månadsrapport för månaden (inskrivna minst reportSchedule.monthly.minEnrolledDays dagar, Botkyrka 11 – samma regel som
// rapportutkasten, src/core/report-schedule.ts), annars de som var inskrivna någon dag.
// Per ärende:
//   1. finns ingen månadsbedömning för månaden skapas den förifylld (src/core/monthly-prefill.ts) med planen för nästa månad –
//      fasta id:n (ma-<ärende>-<månad>, mp-<ärende>-<månad>), så att två samtidiga körningar aldrig skapar två rader
//   2. AI-utkastet (jobbet draft_monthly) läggs EN gång per ärende och månad – bara när deltagaren har registrerat samtycke till
//      AI, inte har skyddade personuppgifter och AI-stödet är kopplat (ctx.ai), och bara om ingen AI-körning för månaden finns
//      (inte heller en som coachen startat). "Skapa nytt AI-utkast" på sidan finns kvar för nya körningar.
//   En godkänd bedömning rörs aldrig.
// Golvet (opts.floor, testklockans start i testmiljön och prototypen): en månad som tog slut senast då rörs inte – testdatat
// har sina utkast (src/data/seed/decisions-2026-10-22.ts). null i produktionen.
// Idempotent: en körning till skapar ingenting nytt. Revisionsloggen får en rad per avtal och körning med månaden, antalen och
// ärendenas id:n (assessment.prefilled, systemet) – aldrig namn eller text.
import type { Ctx } from "@/api/server";
import { aiAllowed } from "@/core/cases";
import { isOperational, requireOperational } from "@/core/config";
import { enrolledDays, monthEndsAt } from "@/core/report-schedule";
import { addMonths, dayOf, monthEnd, monthKey, type LocalDateTime, type MonthKey } from "@/core/time";
import { UniqueError } from "@/data/repo";
import type { Case } from "@/data/schema";
import { aiOff } from "../_shared/ai-port";
import { loadPrefill, prefillAssessmentId, prefilledAssessment, prefilledPlan, prefillPlanId } from "../_shared/monthly-prefill";
import { enqueueVoiceJob } from "../_shared/voice-jobs";

/** Månaden att bedöma nu: månaden före dagens (samma som Min vecka). */
export const assessMonthOf = (now: LocalDateTime): MonthKey => addMonths(monthKey(dayOf(now)), -1);

/** Behöver ärendet en månadsbedömning för månaden? Samma regel som månadsrapporten (minEnrolledDays), annars någon inskriven dag. */
export function needsAssessment(c: Pick<Case, "id" | "status" | "referrerId" | "startDate" | "endDate" | "closedAt">, month: MonthKey, minDays: number | undefined): boolean {
  return enrolledDays(c, `${month}-01`, monthEnd(month)) >= Math.max(1, minDays ?? 1);
}

export type EnsureAssessmentsResult = {
  month: MonthKey;
  /** Skapade månadsbedömningar (id och ärende). */
  created: { id: string; caseId: string }[];
  /** Ärenden där AI-utkastet lades. */
  aiQueued: string[];
  /** Rader som en samtidig körning redan hade skapat. */
  duplicates: number;
};

/** Skapa de förifyllda månadsbedömningarna som saknas och lägg AI-utkasten (se överst i filen). */
export async function ensureMonthlyAssessments(ctx: Ctx, opts: { floor: LocalDateTime | null }): Promise<EnsureAssessmentsResult> {
  const s = ctx.system;
  const now = ctx.now();
  const month = assessMonthOf(now);
  const res: EnsureAssessmentsResult = { month, created: [], aiQueued: [], duplicates: 0 };
  if (opts.floor && monthEndsAt(month) <= opts.floor) return res;
  const contracts = (await s.table("contracts").list({ status: "active" }, { orderBy: "id" })).filter((c) => isOperational(c.config));
  for (const contract of contracts) {
    const cfg = requireOperational(contract.config);
    const minDays = cfg.reportSchedule?.monthly?.minEnrolledDays;
    const cases = (await s.table("cases").list({ contractId: contract.id }, { orderBy: "id" })).filter((c) => needsAssessment(c, month, minDays));
    if (!cases.length) continue;
    const ids = cases.map((c) => c.id);
    const [existing, plans, runs, persons] = await Promise.all([
      s.table("monthly_assessments").list({ caseId: { in: ids }, month }),
      s.table("monthly_plans").list({ caseId: { in: ids }, month }),
      s.table("ai_runs").list({ caseId: { in: ids }, kind: "monthly_draft" }),
      s.table("persons").list({ id: { in: [...new Set(cases.map((c) => c.personId))] } }),
    ]);
    const created: string[] = [];
    const queued: string[] = [];
    for (const c of cases) {
      let ma = existing.find((x) => x.caseId === c.id) ?? null;
      if (!ma) {
        const pre = await loadPrefill(s, c, month, cfg, now);
        const row = prefilledAssessment(prefillAssessmentId(c.id, month), c.id, month, pre);
        try {
          await s.table("monthly_assessments").insert(row);
        } catch (e) {
          if (!(e instanceof UniqueError)) throw e;
          res.duplicates++;
          continue;
        }
        ma = row;
        created.push(c.id);
        res.created.push({ id: row.id, caseId: c.id });
        if (!plans.some((x) => x.caseId === c.id)) {
          try {
            await s.table("monthly_plans").insert(prefilledPlan(prefillPlanId(c.id, month), c.id, month, pre));
          } catch (e) {
            if (!(e instanceof UniqueError)) throw e;
          }
        }
      }
      if (ma.status === "approved") continue;
      // AI-utkastet en gång per ärende och månad – bara med samtycke, utan skyddade personuppgifter och när AI är kopplat.
      const person = persons.find((p) => p.id === c.personId) ?? null;
      if (aiOff(ctx) || !aiAllowed(c, person) || runs.some((r) => r.caseId === c.id && r.inputRef === month)) continue;
      await enqueueVoiceJob(ctx, { kind: "draft_monthly", caseId: c.id, month });
      queued.push(c.id);
      res.aiQueued.push(c.id);
    }
    if (created.length || queued.length) {
      await ctx.audit({
        action: "assessment.prefilled", entity: "contract", entityId: contract.id, contractId: contract.id,
        details: { month, created: created.length, aiQueued: queued.length, caseIds: [...new Set([...created, ...queued])], automatic: true },
      });
    }
  }
  return res;
}
