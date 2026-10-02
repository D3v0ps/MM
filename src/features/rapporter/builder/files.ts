// Rapportbyggaren: filerna (CSV och Excel), filnamnet och storleksgränsen. Ren – bara för hanterare och tester.
//
//   Sammanställning, CSV: grupp_kod (med uppdelning), grupp, period_fran/period_till (med tidsuppdelning), deltagare, måttens
//     kolumner (andelar 0–100 med en decimal), i kommunens läge sist anmarkning ("färre än 5 deltagare" – övriga celler tomma).
//     Sista raden: grupp = "Totalt".
//   Lista, CSV: de valda kolumnerna ur datamängdens egen tabell med registrets typer (formelskyddet följer med).
//   Excel: fliken "Rapport" (samma tabell) och "Om rapporten" (nyckel och värde, reglerna, Så räknas det, noterna och för listor
//     fältbeskrivningen för de valda kolumnerna).
// Rapportens namn är fritext från Miljonbemanning: det skrivs bara som text i Excel (och PDF) – aldrig i filnamn, logg eller CSV.
import type { OperationalConfig } from "@/core/config";
import { toCsv, type CsvColumn, type CsvRow } from "@/core/export/csv";
import { buildXlsx, type XlsxCell, type XlsxSheet } from "@/core/export/xlsx";
import { dayOf, type LocalDateTime, type MonthKey } from "@/core/time";
import type { ContractArea } from "@/data/schema";
import type { ExportRow, ResultExport } from "../export";
import { EXPORT_SCHEMA_VERSION, FIELD_DESCRIPTION_COLUMNS, fieldDescriptionRows } from "../export-columns";
import { dimensionLabel } from "./catalog";
import { DATASET_TABLE, DATASETS, DIMENSION_LABEL, MEASURE_LABEL, SPLIT_LABEL, type Dataset, type Dimension, type ReportDefinition } from "./definition";
import type { BuilderRow, BuilderView } from "./run";
import { templateFor } from "./templates";

export type BuilderFormat = "xlsx" | "csv" | "pdf";
/** Produktgräns för svarets content (base64 för Excel, text för CSV) – Vercel tar högst 4,5 MB i ett svar. */
export const MAX_BUILDER_RESPONSE_CHARS = 3_500_000;
export const TOO_LARGE_TEXT = "Filen blir för stor. Välj en kortare period eller färre kolumner.";

/**
 * Filnamnet: rapport_<prefix>_<nyckel>_<från>_<till>.<xlsx|csv|pdf>. Nyckeln tas alltid ur koden: mallens nyckel om den är en
 * nyckel i TEMPLATES (uppslag, inte strängen som den är), annars datamängdens namn. Aldrig rapportens namn eller personuppgifter.
 */
export function builderFilename(casePrefix: string, templateKey: string | null | undefined, dataset: Dataset, from: MonthKey, to: MonthKey, format: BuilderFormat): string {
  const prefix = casePrefix.toLowerCase().replace(/[^a-z0-9]/g, "") || "avtal";
  const key = templateFor(templateKey)?.key ?? (DATASETS.includes(dataset) ? dataset : "rapport");
  return `rapport_${prefix}_${key}_${from}_${to}.${format}`;
}

/** Innehållet ryms i svaret (gränsen är en parameter så att testerna kan använda en liten gräns). */
export const withinLimit = (content: string, limit = MAX_BUILDER_RESPONSE_CHARS): boolean => content.length <= limit;

// ---------------------------------------------------------------- Sammanställningen som tabell
type FileTable = { columns: (CsvColumn & { decimal?: boolean })[]; rows: CsvRow[] };

const percent = (v: number | null): number | null => (v == null ? null : Math.round(v * 1000) / 10);

/** Sammanställningens tabell i filen (samma för CSV och Excel). */
export function summaryTable(view: BuilderView): FileTable {
  const t = view.table;
  if (!t) throw new Error("Rapporten är ingen sammanställning");
  const grouped = t.groupLabel !== null;
  const split = t.splitLabel !== null;
  const kommun = view.audience === "kommun";
  const measureCols = t.columns.slice(1);
  const columns: FileTable["columns"] = [
    ...(grouped ? [{ key: "grupp_kod", type: "text" as const }] : []),
    { key: "grupp", type: "text" },
    ...(split ? [{ key: "period_fran", type: "month" as const }, { key: "period_till", type: "month" as const }] : []),
    { key: "deltagare", type: "int" },
    ...measureCols.map((c) => ({ key: c.fileKey, type: c.unit === "andel" ? ("decimal1" as const) : ("int" as const), decimal: c.unit === "andel" })),
    ...(kommun ? [{ key: "anmarkning", type: "text" as const }] : []),
  ];
  const toRow = (r: BuilderRow, isTotal: boolean): CsvRow => {
    const out: Record<string, string | number | null> = {};
    if (grouped) out.grupp_kod = isTotal ? null : r.groupCode || null;
    out.grupp = isTotal ? "Totalt" : (r.group ?? "Alla");
    if (split) {
      out.period_fran = r.from;
      out.period_till = r.to;
    }
    out.deltagare = r.cases;
    measureCols.forEach((c, i) => {
      out[c.fileKey] = c.unit === "andel" ? percent(r.cells[i]) : r.cells[i];
    });
    if (kommun) out.anmarkning = r.small ? `färre än ${view.minN} deltagare` : null;
    return out;
  };
  return { columns, rows: [...t.rows.map((r) => toRow(r, false)), toRow(t.total, true)] };
}

// ---------------------------------------------------------------- Listan som tabell
/** Listans kolumner ur datamängdens egen tabell (registrets typer) och de filtrerade raderna. */
export function listTable(def: ReportDefinition, exp: ResultExport, rows: readonly ExportRow[]): FileTable {
  const table = DATASET_TABLE[def.dataset];
  const cols = def.columns.map((q) => {
    const key = q.split(".")[1];
    const c = exp.columns[table].find((x) => x.key === key);
    if (!c) throw new Error("Kolumnen finns inte i registret");
    return { key: c.key, type: c.type, decimal: c.type === "decimal1" };
  });
  return { columns: cols, rows: rows.map((r) => Object.fromEntries(cols.map((c) => [c.key, r[c.key] ?? null]))) };
}

export function fileTable(view: BuilderView, def: ReportDefinition, exp: ResultExport, rows: readonly ExportRow[]): FileTable {
  return def.output === "lista" ? listTable(def, exp, rows) : summaryTable(view);
}

// ---------------------------------------------------------------- CSV
/** Tabellen som CSV-text (utan BOM – useDownload lägger till den). */
export function builderCsv(t: FileTable): string {
  return toCsv(t.columns.map((c) => ({ key: c.key, type: c.type })), t.rows);
}

// ---------------------------------------------------------------- Excel
export type AboutReport = {
  /** Rapportens namn (eller mallens namn; "Ny rapport" för ett osparat utkast utan mall). */
  title: string;
  contractNumber: string;
  customerName: string;
  now: LocalDateTime;
  cfg: OperationalConfig;
  areas: readonly Pick<ContractArea, "code" | "name">[];
};

const pct = (v: number) => `${(Math.round(v * 1000) / 10).toFixed(1).replace(".", ",")} %`;

/** Urvalet i klarspråk ("Avtalsområde: G Lager och logistik; Fas: Yrkesspecifika moment"), annars "Alla". */
export function filtersText(def: ReportDefinition, env: Pick<AboutReport, "cfg" | "areas">): string {
  const parts = (Object.entries(def.filters) as [Dimension, string[] | undefined][])
    .filter(([, v]) => v && v.length)
    .map(([d, v]) => `${DIMENSION_LABEL[d]}: ${(v ?? []).map((x) => dimensionLabel(d, x, env)).join(", ")}`);
  return parts.length ? parts.join("; ") : "Alla";
}

/** Raderna på fliken "Om rapporten". */
export function aboutRows(view: BuilderView, def: ReportDefinition, exp: ResultExport, about: AboutReport): { rows: XlsxCell[][]; bold: number[] } {
  const rows: XlsxCell[][] = [];
  const bold: number[] = [];
  const kv = (k: string, v: XlsxCell) => rows.push([k, v]);
  kv("Rapport", about.title);
  kv("Avtal", `${about.contractNumber}, ${about.customerName}`);
  kv("Uppgifter", view.datasetLabel);
  kv("Period", view.periodLabel);
  kv("Urval", filtersText(def, about));
  if (def.output === "sammanstallning") {
    kv("Dela upp efter", def.groupBy ? DIMENSION_LABEL[def.groupBy] : "Ingen uppdelning");
    kv("Dela upp per tid", SPLIT_LABEL[def.split]);
    kv("Mått", def.measures.map((m) => MEASURE_LABEL[m]).join(", "));
    // Målen i avtalet (avtalets mål alltid, det interna målet bara i Miljonbemannings läge – vy-modellen har det inte för kommunen).
    for (const t of view.targets ?? []) {
      if (t.contractTarget != null) kv("Avtalets mål", `${t.label} ${pct(t.contractTarget)}`);
      if (t.internalTarget != null) kv("Internt mål", `${t.label} ${pct(t.internalTarget)}`);
    }
  } else {
    kv("Kolumner", def.columns.map((q) => q.split(".")[1]).join(", "));
  }
  kv("Visning", view.audience === "mb" ? "Miljonbemanning" : "Kommunens chef");
  kv("Hämtad", `${dayOf(about.now)} ${about.now.slice(11, 16)}`);
  kv("Schemaversion", EXPORT_SCHEMA_VERSION);
  rows.push([]);
  for (const r of view.rules) rows.push([r]);
  if (view.explain.length) {
    rows.push([]);
    bold.push(rows.length);
    rows.push(["Så räknas det"]);
    for (const e of view.explain) rows.push([e.label, e.text]);
  }
  if (view.notes.length) {
    rows.push([]);
    for (const n of view.notes) rows.push([n]);
  }
  if (def.output === "lista") {
    const table = DATASET_TABLE[def.dataset];
    const keys = new Set(def.columns.map((q) => q.split(".")[1]));
    const fd = fieldDescriptionRows(exp.columns[table].filter((c) => keys.has(c.key)));
    rows.push([]);
    bold.push(rows.length);
    rows.push(["Fältbeskrivning"]);
    bold.push(rows.length);
    rows.push(FIELD_DESCRIPTION_COLUMNS.map((c) => c.key));
    for (const r of fd) rows.push(FIELD_DESCRIPTION_COLUMNS.map((c) => r[c.key] ?? null));
  }
  return { rows, bold };
}

/** Excel-filen: flikarna "Rapport" och "Om rapporten". Text alltid som text (inlineStr) – aldrig som formel. */
export async function builderXlsx(view: BuilderView, def: ReportDefinition, exp: ResultExport, rows: readonly ExportRow[], about: AboutReport): Promise<Uint8Array> {
  const t = fileTable(view, def, exp, rows);
  const data: XlsxSheet = {
    name: "Rapport", header: true,
    rows: [t.columns.map((c) => c.key), ...t.rows.map((r) => t.columns.map((c) => {
      const v = r[c.key];
      if (v == null || v === "") return null;
      return c.type === "int" || c.type === "decimal1" || c.type === "bool01" ? Number(v) : String(v);
    }))],
    widths: t.columns.map((c) => (c.key === "grupp" || c.key === "namn" || c.key === "yrkesspar" || c.key === "anmarkning" ? 32 : Math.max(10, c.key.length + 3))),
    decimalColumns: t.columns.map((c, i) => (c.decimal ? i : -1)).filter((i) => i >= 0),
  };
  const a = aboutRows(view, def, exp, about);
  const aboutSheet: XlsxSheet = { name: "Om rapporten", rows: a.rows, boldRows: a.bold, widths: [24, 90, 40, 24, 50, 36, 14], wrapFromRow: 0 };
  return buildXlsx([data, aboutSheet], { date: about.now });
}
