// Vy-modellen för ett rapportdokument (ReportDocView): det gemensamma huvudet (avtal, mottagare, status) plus modellen.
// Delas av rapportsidan (rapporter.dokument i view-handlers.ts) och deltagarkortets flik Månadsunderlag
// (arenden.kortManad), så att förhandsvisningen är exakt samma dokument som rapporten. Rena funktioner – bara för hanterare.
import type { Report } from "@/data/schema";
import type { DocBase, ReportDocView } from "./api";
import { personWithUnit, type MonthlyModel, type ReportDb } from "./model";

export type DocContract = { customerName: string; contract: { contractNumber: string; dnr?: string | null } };

/** Dokumentets huvud. recipientId = rapportens mottagare (beställaren); namnet skrivs med enhet. */
export function docBase(
  r: Pick<Report, "id" | "status" | "version" | "approvedAt" | "deliveredAt" | "superseded">,
  info: DocContract,
  profiles: readonly ReportDb["profiles"][number][],
  recipientId: string | null | undefined,
): DocBase {
  return {
    id: r.id, status: r.status, version: r.version || 1, approvedAt: r.approvedAt, deliveredAt: r.deliveredAt, superseded: r.superseded,
    contract: { customerName: info.customerName, contractNumber: info.contract.contractNumber, dnr: info.contract.dnr ?? "" },
    recipient: personWithUnit({ profiles: [...profiles] }, recipientId),
  };
}

/** Månadsrapportens dokument. participant = namnet läsaren får se ("Skyddade personuppgifter" eller namnet). */
export const monthlyDocView = (base: DocBase, participant: string, m: MonthlyModel): Extract<ReportDocView, { kind: "monthly" }> => ({ ...base, kind: "monthly", participant, m });
