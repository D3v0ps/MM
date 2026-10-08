// Tomt testdata (MM_SEED=empty, beslut 2026-10-08): som databasen efter scratchpad/skarp-drift.sql – bara avtalet och dess
// konfiguration, organisationerna, avtalsområdena, prislistan (exempelpriser), helgdagarna, integrationerna, Miljonbemannings
// interna regler och de sju kollegorna (alla systemadministratörer, Ali också avtalsansvarig). Inga ärenden, inga personer.
// Körs med riktig tid (realClock i memory-runtime.ts). Används av utvecklingsläget och e2e (tests/e2e/tom.spec.ts) för att
// visa att appen fungerar utan ett enda ärende.
import { holidaysOf } from "@/core/holidays";
import type { MemoryData } from "../memory";
import { emptyDb, type Tables } from "../schema";
import { colleagueMemberships, colleagueProfiles, COLLEAGUE_CONTRACT, CONTRACT_MANAGER_ID } from "./colleagues";
import { contractTables } from "./map";

/** Helgdagar som finns i det tomma testdatat (riktig tid: året som gått, i år och de två kommande). */
export const EMPTY_SEED_HOLIDAY_YEARS = [2026, 2027, 2028, 2029] as const;

export function createEmptySeed(): MemoryData<Tables> {
  const db = emptyDb();
  contractTables(db);
  // Helgdagar för fler år än prototypens två (riktig tid går vidare).
  const have = new Set(db.holidays.map((h) => h.id));
  for (const year of EMPTY_SEED_HOLIDAY_YEARS) {
    for (const [date, name] of Object.entries(holidaysOf(year)).sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (!have.has(date)) db.holidays.push({ id: date, date, name });
    }
  }
  const contract = db.contracts.find((c) => c.id === COLLEAGUE_CONTRACT);
  if (contract) contract.contractManagerId = CONTRACT_MANAGER_ID;
  db.profiles.push(...colleagueProfiles());
  db.memberships.push(...colleagueMemberships());
  return db;
}
