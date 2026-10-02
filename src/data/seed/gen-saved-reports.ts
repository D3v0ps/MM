// Steg efter mappningen: sparade rapporter i rapportbyggaren (saved_reports – finns inte i den gamla prototypen, rapporter
// steg 4). Läggs till direkt i tabellen efter toTables(), med fasta id:n, så att prototypens testdata och paritetstesterna inte
// ändras. Definitionerna är skrivna som literaler (seeden importerar inte src/features) – ett test i
// src/features/rapporter/builder/templates.test.ts kontrollerar att de klarar ReportDefinitionSchema och är lika med mallarna.
// Alla tider före DEMO_START (2027-02-01 09.12). Inga personuppgifter.
//
//   sr-seed-privat   Sara (samordnare)        bara ägaren                    mallen "Närvaro per månad"
//   sr-seed-mb       Karin (chef)             alla på MB i avtalet           mallen "Progression per avtalsområde"
//   sr-seed-kommun   Johan (avtalsansvarig)   delad med kommunens chef       mallen "Resultatgrad per avtalsområde"
import type { Db, SavedReport } from "../schema";

const base = { v: 1, filters: {}, columns: [], split: "inget" } as const;

export function addSavedReports(db: Db): void {
  const row = (r: Pick<SavedReport, "id" | "ownerId" | "title" | "templateKey" | "definition" | "visibility" | "createdAt"> & Partial<SavedReport>): SavedReport => ({
    contractId: "c-bot", updatedAt: null, updatedBy: null, sharedAt: null, sharedBy: null, archivedAt: null, archivedBy: null, ...r,
  });
  db.saved_reports.push(
    row({
      id: "sr-seed-privat", ownerId: "u-sara", title: "Närvaro per månad", templateKey: "narvaro-per-manad", visibility: "private", createdAt: "2027-01-18T10:20",
      definition: { ...base, dataset: "deltagarmanader", period: { kind: "senaste", months: 6 }, output: "sammanstallning", groupBy: null, split: "manad", measures: ["deltagarmanader", "narvarograd"], chart: { measure: "narvarograd" } },
    }),
    row({
      id: "sr-seed-mb", ownerId: "u-karin", title: "Progression per avtalsområde", templateKey: "progression-per-omrade", visibility: "mb", createdAt: "2027-01-21T14:05",
      sharedAt: "2027-01-21T14:05", sharedBy: "u-karin",
      definition: { ...base, dataset: "deltagarmanader", period: { kind: "senaste", months: 3 }, output: "sammanstallning", groupBy: "avtalsomrade_kod", measures: ["tydlig_progression", "nagon_progression"], chart: { measure: "tydlig_progression" } },
    }),
    row({
      id: "sr-seed-kommun", ownerId: "u-johan", title: "Resultatgrad per avtalsområde", templateKey: "resultatgrad-per-omrade", visibility: "customer", createdAt: "2027-01-25T09:40",
      sharedAt: "2027-01-25T09:45", sharedBy: "u-johan",
      definition: {
        ...base, dataset: "avslut", period: { kind: "senaste", months: 6 }, output: "sammanstallning", groupBy: "avtalsomrade_kod",
        measures: ["avslut_som_raknas", "verifierat_resultat", "preliminara", "resultatgrad"], chart: { measure: "resultatgrad" },
      },
    }),
  );
}
