// BARA FÖR TESTER. Små påhittade tabeller i steg 3:s form (ResultExport) till rapportbyggarens enhetstester.
import { BOTKYRKA_CONFIG, type OperationalConfig } from "@/core/config";
import type { ExportRow, ResultExport } from "../export";
import { EXPORT_TABLES, exportColumns, tableColumns, type ExportTable } from "../export-columns";
import type { ReportDefinition } from "./definition";

export const AREAS = [
  { code: "G", name: "Lager och logistik" },
  { code: "H", name: "Vård och omsorg" },
  { code: "B", name: "Bygg och anläggning" },
];

/** En rad i tabellen resultat med rimliga standardvärden (påhittade). */
export function mRow(no: number, manad: string, p: Partial<ExportRow> = {}): ExportRow {
  return {
    arendenummer: `BOT-26-${String(no).padStart(4, "0")}`, namn: `Testperson ${no}`, manad, bestallare_enhet: "Arbetsmarknadsenheten Alby", rapport_version: 1,
    rapport_levererad: `${manad}-28`, rattelse_pagar: 0, avtalsomrade_kod: "G", avtalsomrade: "Lager och logistik", avtalsomrade2_kod: null, yrkesspar: "Truckförare",
    insats_start: "2026-09-21", insats_planerat_slut: null, insats_slut: null, fas_nr: 2, fas: "Yrkesförberedande grund", veckor: 4, veckor_uppehall: 0,
    narvaro_procent: 90, upprepad_franvaro: 0, _narvaro_pa_plats: 9, _narvaro_registrerade: 10,
    avstamningar_godkanda: 4, arbetsgivarkontakter: 2, veckomal_uppnatt: 2, veckomal_delvis: 1, veckomal_ej_uppnatt: 1, bedomning_godkand: 1, omraden_bedomda: 9,
    progression_tydlig: 1, progression_nagon: 1, handelser: 0, handelser_verifierade: 0, praktik_startad: 0, arbete_paborjat: 0, studier_paborjade: 0,
    avvikelser_nya: 0, avvikelser_oppna: 0, kommunens_beslut_behovs: 0, samlad_status_kod: "green", samlad_status: "Grön", bedomning_datum: `${manad}-28`,
    avslut_datum: null, avslutsorsak_kod: null, avslutsorsak: null, resultat_kod: null, resultat: null, resultat_verifierat: null, ...p,
  };
}
export function aRow(no: number, manad: string, p: Partial<ExportRow> = {}): ExportRow {
  return {
    arendenummer: `BOT-26-${String(no).padStart(4, "0")}`, manad, avslut_datum: `${manad}-15`, avslutsorsak_kod: "arbete", avslutsorsak: "Arbete", resultat_kod: "result",
    resultat: "Resultat", resultat_verifierat: 1, rapport_version: 1, rapport_levererad: `${manad}-20`, rattelse_pagar: 0, ...p,
  };
}
export function hRow(no: number, manad: string, p: Partial<ExportRow> = {}): ExportRow {
  return { arendenummer: `BOT-26-${String(no).padStart(4, "0")}`, manad, datum: `${manad}-10`, handelse_kod: "praktik_startad", handelse: "Praktik startat", verifierad: 0, ...p };
}
export function pRow(no: number, manad: string, omrade_kod: string, niva: number | null): ExportRow {
  return { arendenummer: `BOT-26-${String(no).padStart(4, "0")}`, manad, omrade_kod, omrade: omrade_kod, niva, niva_text: niva == null ? null : String(niva) };
}

export function mkExp(tables: Partial<Record<ExportTable, ExportRow[]>>, cfg: OperationalConfig = BOTKYRKA_CONFIG, from = "2026-09", to = "2027-02"): ResultExport {
  const allColumns = exportColumns(cfg, AREAS);
  const t = Object.fromEntries(EXPORT_TABLES.map((k) => [k, tables[k] ?? []])) as Record<ExportTable, ExportRow[]>;
  return {
    columns: Object.fromEntries(EXPORT_TABLES.map((k) => [k, tableColumns(allColumns, k)])) as ResultExport["columns"],
    allColumns, tables: t,
    meta: {
      from, to, now: "2027-02-01T09:12", schema: 1, cases: new Set(t.resultat.map((r) => r.arendenummer)).size, reportIds: [],
      tableReportIds: { resultat: [], progression: [], handelser: [], avslut: [] }, rows: { resultat: t.resultat.length, progression: t.progression.length, handelser: t.handelser.length, avslut: t.avslut.length },
    },
  };
}

/** En giltig sammanställning (deltagarmånader) med ändringar. */
export function summaryDef(p: Partial<ReportDefinition> = {}): ReportDefinition {
  return {
    v: 1, dataset: "deltagarmanader", period: { kind: "fast", from: "2026-10", to: "2026-12" }, filters: {}, output: "sammanstallning", groupBy: null, split: "inget",
    measures: ["deltagarmanader"], columns: [], chart: null, ...p,
  } as ReportDefinition;
}
