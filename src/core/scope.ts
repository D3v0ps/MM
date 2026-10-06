// Avgränsa datat till ett avtal. Domänfunktionerna räknar på det data de får; när flera kommunavtal har ärenden
// ska hanteraren avgränsa först, så att KPI:er och fakturering inte blandar avtal.
import type { Db, TableName } from "@/data/schema";

/** Tabeller som hör till ett ärende via caseId. */
const BY_CASE = [
  "activities", "attendance", "check_ins", "monthly_assessments", "monthly_plans", "outcome_events", "deviations", "placements",
  "pulse_invites", "pulse_responses", "intake_assessments", "case_status_history", "case_team", "messages", "consents", "bonus_claims",
] as const satisfies readonly TableName[];
/** Tabeller med contractId. */
const BY_CONTRACT = [
  "contract_areas", "price_items", "memberships", "reports", "contract_deviations", "billing_runs", "invoice_drafts", "billing_week_approvals",
  "invoice_credits", "fortnox_runs", "case_counters", "kpi_snapshots", "alerts", "deadlines",
] as const satisfies readonly TableName[];

/** Samma data, men bara rader som hör till avtalet. Tabeller som inte finns i `db` lämnas utanför. */
export function scopeToContract<D extends Partial<Db>>(db: D, contractId: string): D {
  const out: Partial<Db> = { ...db };
  const caseIds = db.cases ? new Set(db.cases.filter((c) => c.contractId === contractId).map((c) => c.id)) : null;
  if (db.cases) out.cases = db.cases.filter((c) => c.contractId === contractId);
  for (const n of BY_CONTRACT) {
    const rows = db[n] as { contractId: string }[] | undefined;
    if (rows) (out as Record<string, unknown>)[n] = rows.filter((r) => r.contractId === contractId);
  }
  if (caseIds) {
    for (const n of BY_CASE) {
      const rows = db[n] as { caseId: string | null }[] | undefined;
      if (rows) (out as Record<string, unknown>)[n] = rows.filter((r) => r.caseId != null && caseIds.has(r.caseId));
    }
  }
  return out as D;
}
