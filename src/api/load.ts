// Hämta tabeller för domänfunktionerna i src/core. Läser via repot, så behörigheten (RLS i produktion,
// policy.ts i minnet) gäller – använd ctx.system bara för systemsteg och aggregat, med en kommentar.
//
//   const db = await loadDb(ctx.repo, ["cases", "activities", "attendance"], { cases: { contractId } });
//   const stats = attendanceStats(db, caseId, from, to, { now: ctx.now() });
import type { Where } from "@/data/repo";
import type { AppRepo, Db, TableName, Tables } from "@/data/schema";

export type LoadFilters<N extends TableName> = { [K in N]?: Where<Tables[K]> };

/** Läs tabellerna (parallellt) till ett delmängds-Db. Filter per tabell översätts till repots where-villkor. */
export async function loadDb<const N extends readonly TableName[]>(repo: AppRepo, names: N, filters: LoadFilters<N[number]> = {}): Promise<Pick<Db, N[number]>> {
  const unique = [...new Set(names)] as N[number][];
  const rows = await Promise.all(unique.map((n) => repo.table(n).list(filters[n] as Where<Tables[typeof n]> | undefined)));
  return Object.fromEntries(unique.map((n, i) => [n, rows[i]])) as unknown as Pick<Db, N[number]>;
}
