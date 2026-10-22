// Månadens fakturakörning (billing_runs) skapas automatiskt när månaden är slut. Bara för systemsteg – importeras aldrig av
// skärmar.
//
// Körs av:
//   - jobbkörningen i testmiljön och produktionen, i samma jobb som rapportutkasten (src/server/jobs/reports.ts) högst var
//     tionde minut
//   - minnesläget och prototypen (src/data/memory-runtime.ts) när testdatat läses in och när klockan passerar en vecko- eller
//     månadsgräns – samma funktion
//
// Vilka månader: missingBillingRuns i src/core/billing.ts – varje månad från avtalets start som är slut och har något att
// fakturera, men saknar körning. Utan körning räknas månaden som ofakturerad i ärendets underlag och i anmärkningen på nästa
// månads faktura (Peppol BT-127), och Fakturering, Min vecka och "Stäng körningen" visar ingenting.
//
// Idempotent och säker mot samtidiga körningar: körningens id är fast för avtalet och månaden (br-<avtal>-<månad>), så en
// andra körning samtidigt stoppas av primärnyckeln (UniqueError) och hoppas över utan fel. En körning som redan finns för
// månaden (också med ett annat id, t.ex. testdatat eller en rad som lagts in för hand) ändras aldrig.
//
// ctx.system används för allt: ett systemsteg utan användare (motsvarar service role). created_by är "system", som för andra
// rader som systemet skapar. Raden innehåller bara id:n och månaden – inga belopp och inga personuppgifter. Varje skapad
// körning loggas (billing.run_created, systemet).
import type { Ctx } from "@/api/server";
import { SYSTEM_ACTOR } from "@/api/roles";
import { billingRunIdOf, missingBillingRuns } from "@/core/billing";
import { isOperational } from "@/core/config";
import type { LocalDateTime, MonthKey } from "@/core/time";
import { UniqueError } from "@/data/repo";
import type { BillingRun } from "@/data/schema";

export type EnsureBillingRunsResult = {
  /** Skapade körningar (id, avtal och månad). */
  created: { id: string; contractId: string; month: MonthKey }[];
  /** Körningar som en samtidig körning redan hade skapat. */
  duplicates: number;
};

/**
 * Skapa de fakturakörningar som saknas för månader som är slut (se överst i filen). floor: månader som slutade senast då
 * får ingen körning (testklockans start i testmiljön och prototypen – testdatat har sina körningar). null i produktionen.
 */
export async function ensureBillingRuns(ctx: Ctx, opts: { floor: LocalDateTime | null }): Promise<EnsureBillingRunsResult> {
  const s = ctx.system;
  const now = ctx.now();
  const res: EnsureBillingRunsResult = { created: [], duplicates: 0 };
  const contracts = (await s.table("contracts").list({ status: "active" }, { orderBy: "id" })).filter((c) => isOperational(c.config));
  for (const contract of contracts) {
    const [cases, invoiceDrafts, runs] = await Promise.all([
      s.table("cases").list({ contractId: contract.id }),
      s.table("invoice_drafts").list({ contractId: contract.id }),
      s.table("billing_runs").list({ contractId: contract.id }),
    ]);
    for (const month of missingBillingRuns(contract, { cases, invoice_drafts: invoiceDrafts, billing_runs: runs }, now, opts.floor)) {
      const row: BillingRun = {
        id: billingRunIdOf(contract.id, month), contractId: contract.id, month, status: "draft", createdBy: SYSTEM_ACTOR.userId, createdAt: now, closedAt: null, closedBy: null,
      };
      try {
        await s.table("billing_runs").insert(row);
      } catch (e) {
        if (e instanceof UniqueError) {
          res.duplicates++;
          continue;
        }
        throw e;
      }
      res.created.push({ id: row.id, contractId: row.contractId, month });
      await ctx.audit({ action: "billing.run_created", entity: "billing_run", entityId: row.id, contractId: row.contractId, details: { month, automatic: true } });
    }
  }
  return res;
}
