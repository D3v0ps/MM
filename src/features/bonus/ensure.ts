// Förslagen till bonusanspråk (SPEC §7.17, beslut 2026-11-04): regelstyrda, ingen AI – en människa granskar och skickar alltid.
// Bara för systemsteg – importeras aldrig av skärmar.
//
// Körs av:
//   - jobbkörningen i testmiljön och produktionen, i samma jobb som rapportutkasten (src/server/jobs/reports.ts) högst var tionde
//     minut
//   - minnesläget och prototypen (src/data/memory-runtime.ts) i samma steg som rapportutkasten
//
// Reglerna: bonusSuggestions i src/core/bonus.ts, bara när bonus är påslagen i avtalet (contracts.config.bonus). Ett förslag
// får status suggested, källa auto och skapas av systemet ("system").
// Idempotent och säker mot samtidiga körningar: förslagets id är fast för ärendet, steget och antalet tidigare anspråk för steget
// (bonus-<ärende>-<steg>-<n>), och högst ett anspråk som räknas per ärende och steg (bonus_claims_case_step_active_key) – en
// andra körning samtidigt stoppas (UniqueError) och hoppas över utan fel. Ett förslag skapas aldrig två gånger för samma underlag
// (samma händelse eller samma steg 3), inte heller efter ett avslag eller ett återtagande.
// Golvet: testdatat har sina anspråk – på den dag testdatat lästes in (testklockans start) skapas inga förslag. null i produktionen.
//
// ctx.system används för allt: ett systemsteg utan användare (motsvarar service role). Raden har bara id:n, steg och datum – inga
// belopp och inga personuppgifter. Varje förslag loggas (bonus_claim.suggested, systemet).
import type { Ctx } from "@/api/server";
import { SYSTEM_ACTOR } from "@/api/roles";
import { bonusSuggestions } from "@/core/bonus";
import { bonusModel, isOperational } from "@/core/config";
import { dayOf, type LocalDateTime } from "@/core/time";
import { UniqueError } from "@/data/repo";
import type { BonusClaim } from "@/data/schema";

export type EnsureBonusResult = { created: { id: string; caseId: string; step: number }[]; duplicates: number };

/** Förslagets id: ärendet, steget och antalet tidigare anspråk för steget i ärendet. */
export const suggestionIdOf = (caseId: string, step: number, n: number): string => `bonus-${caseId}-${step}-${n}`;

export async function ensureBonusClaims(ctx: Ctx, opts: { floor: LocalDateTime | null }): Promise<EnsureBonusResult> {
  const res: EnsureBonusResult = { created: [], duplicates: 0 };
  const now = ctx.now();
  if (opts.floor && dayOf(now) <= dayOf(opts.floor)) return res;
  const s = ctx.system;
  const contracts = (await s.table("contracts").list({ status: "active" }, { orderBy: "id" })).filter((c) => isOperational(c.config) && bonusModel(c.config));
  for (const contract of contracts) {
    const m = bonusModel(contract.config);
    if (!m) continue;
    const cases = (await s.table("cases").list({ contractId: contract.id })).filter((c) => !!c.startDate && ["active", "paused", "closed"].includes(c.status));
    if (!cases.length) continue;
    const ids = { in: cases.map((c) => c.id) };
    const [activities, attendance, assessments, events, claims] = await Promise.all([
      s.table("activities").list({ caseId: ids }), s.table("attendance").list({ caseId: ids }), s.table("monthly_assessments").list({ caseId: ids, status: "approved" }),
      s.table("outcome_events").list({ caseId: ids }), s.table("bonus_claims").list({ contractId: contract.id }),
    ]);
    const suggestions = bonusSuggestions({ cases, activities, attendance, monthly_assessments: assessments, outcome_events: events, bonus_claims: claims }, m, { now });
    // Steg 3 som skapas i samma omgång (steg 5 bygger på det).
    const newStep3 = new Map<string, string | null>();
    for (const x of suggestions) {
      const follows = x.follows === "new" ? newStep3.get(x.caseId) ?? null : x.follows;
      if (x.follows === "new" && !follows) continue;
      const n = claims.filter((k) => k.caseId === x.caseId && k.step === x.step).length + 1;
      const row: BonusClaim = {
        id: suggestionIdOf(x.caseId, x.step, n), caseId: x.caseId, contractId: x.contractId, step: x.step, kind: x.kind, status: "suggested", source: "auto", basis: "",
        evidencePaths: [], outcomeEventId: x.outcomeEventId, followsClaimId: follows, reachedOn: x.reachedOn, verificationKind: x.verificationKind, verificationOn: null,
        checklist: {}, snapshot: null, createdBy: SYSTEM_ACTOR.userId, createdAt: now, submittedAt: null, submittedBy: null, withdrawnBy: null, withdrawnAt: null,
        customerDecision: null, decidedBy: null, decidedAt: null, decisionNote: null, amountOre: null, invoiceDraftId: null,
      };
      try {
        await s.table("bonus_claims").insert(row);
      } catch (e) {
        if (e instanceof UniqueError) {
          res.duplicates++;
          if (x.step === 3) newStep3.set(x.caseId, null);
          continue;
        }
        throw e;
      }
      claims.push(row);
      if (x.step === 3) newStep3.set(x.caseId, row.id);
      res.created.push({ id: row.id, caseId: row.caseId, step: x.step });
      await ctx.audit({ action: "bonus_claim.suggested", entity: "bonus_claim", entityId: row.id, contractId: row.contractId, details: { caseId: row.caseId, step: x.step, source: "auto" } });
    }
  }
  return res;
}
