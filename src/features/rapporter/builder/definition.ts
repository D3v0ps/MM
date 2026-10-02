// Rapportbyggaren (rapporter steg 4): den sparade definitionen. Isomorf och utan avtalsvärden – importeras av skärmar (via
// rapporter/api.ts) och hanterare. Definitionen är säker att dela med kommunen: den bygger bara på steg 3:s urval och register
// (levererade rapporter, frysta fakta) och har inga kolumner eller urval bara för Miljonbemanning.
//
// Strikt zod (okända nycklar nekas). Felen är på svenska och visas i byggaren. Vid varje körning kontrolleras dessutom
// definitionens kolumner mot registret för avtalet (en kolumn som inte längre finns ger column_missing).
import { z } from "zod";
import { CASE_NUMBER_RE } from "@/core/cases";
import { addMonths, monthKey, monthName, type LocalDate, type LocalDateTime, type MonthKey } from "@/core/time";
import { looksLikePnr } from "@/core/validation";
import { MonthKeySchema } from "../../_shared/schemas";
import { EXPORT_TABLES, MAX_EXPORT_MONTHS, monthsInPeriod, periodError, type ExportTable } from "../export-columns";
import { isCatalogColumn } from "./catalog";

// ---------------------------------------------------------------- Datamängder, dimensioner, uppdelning och mått
export const DATASETS = ["deltagarmanader", "avslut", "handelser", "progression"] as const;
export type Dataset = (typeof DATASETS)[number];
export const DIMENSIONS = ["avtalsomrade_kod", "yrkesspar", "bestallare_enhet", "fas_nr", "samlad_status_kod", "avslutsorsak_kod", "resultat_kod", "handelse_kod", "omrade_kod"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export const SPLITS = ["inget", "manad", "kvartal", "halvar"] as const;
export type Split = (typeof SPLITS)[number];
export const OUTPUTS = ["sammanstallning", "lista"] as const;
export type Output = (typeof OUTPUTS)[number];

/** Datamängdens egen tabell i kolumnregistret (steg 3). En rad i datamängden = en rad i tabellen. */
export const DATASET_TABLE: Record<Dataset, ExportTable> = { deltagarmanader: "resultat", avslut: "avslut", handelser: "handelser", progression: "progression" };
export const DATASET_LABEL: Record<Dataset, string> = { deltagarmanader: "Deltagarmånader", avslut: "Avslut", handelser: "Händelser", progression: "Progression" };
/** Meningen under valet "Eller börja från början" (E3). */
export const DATASET_HELP: Record<Dataset, string> = {
  deltagarmanader: "En rad per deltagare och levererad månadsrapport.",
  avslut: "En rad per levererad slutrapport för insatser som avslutades under perioden.",
  handelser: "En rad per händelse i de levererade månadsrapporterna.",
  progression: "En rad per deltagare, månad och obligatoriskt område. Bara godkända bedömningar.",
};

export const DIMENSION_LABEL: Record<Dimension, string> = {
  avtalsomrade_kod: "Avtalsområde", yrkesspar: "Yrkesspår", bestallare_enhet: "Beställarens enhet", fas_nr: "Fas", samlad_status_kod: "Samlad status",
  avslutsorsak_kod: "Avslutsorsak", resultat_kod: "Resultat", handelse_kod: "Händelse", omrade_kod: "Område",
};

/**
 * Dimensioner per datamängd. Egna = kolumner i datamängdens tabell. Kopplade = hämtade ur en annan rad (avslut: ärendets
 * senaste levererade månadsrapport; händelser och progression: samma månadsrapport) – bara filter och gruppering, aldrig
 * kolumner i en lista.
 */
export const DATASET_DIMENSIONS: Record<Dataset, { own: readonly Dimension[]; joined: readonly Dimension[] }> = {
  deltagarmanader: { own: ["avtalsomrade_kod", "yrkesspar", "bestallare_enhet", "fas_nr", "samlad_status_kod"], joined: [] },
  avslut: { own: ["avslutsorsak_kod", "resultat_kod"], joined: ["avtalsomrade_kod", "yrkesspar", "bestallare_enhet"] },
  handelser: { own: ["handelse_kod"], joined: ["avtalsomrade_kod", "yrkesspar", "bestallare_enhet", "fas_nr"] },
  progression: { own: ["omrade_kod"], joined: ["avtalsomrade_kod", "yrkesspar", "bestallare_enhet", "fas_nr"] },
};
/** Alla dimensioner för datamängden (byggarens ordning: avtalsområde och yrkesspår först). */
export const datasetDimensions = (ds: Dataset): Dimension[] => DIMENSIONS.filter((d) => DATASET_DIMENSIONS[ds].own.includes(d) || DATASET_DIMENSIONS[ds].joined.includes(d));

export const MEASURE_KEYS = [
  "deltagarmanader", "narvarograd", "tydlig_progression", "nagon_progression", "avstamningar", "arbetsgivarkontakter", "upprepad_franvaro", "avvikelser_nya", "praktik_startad",
  "avslut", "avslut_som_raknas", "verifierat_resultat", "preliminara", "resultatgrad",
  "handelser", "verifierade",
  "fordelning",
] as const;
export type MeasureKey = (typeof MEASURE_KEYS)[number];
export const MEASURES_BY_DATASET: Record<Dataset, readonly MeasureKey[]> = {
  deltagarmanader: ["deltagarmanader", "narvarograd", "tydlig_progression", "nagon_progression", "avstamningar", "arbetsgivarkontakter", "upprepad_franvaro", "avvikelser_nya", "praktik_startad"],
  avslut: ["avslut", "avslut_som_raknas", "verifierat_resultat", "preliminara", "resultatgrad"],
  handelser: ["handelser", "verifierade"],
  progression: ["fordelning"],
};
export const MEASURE_LABEL: Record<MeasureKey, string> = {
  deltagarmanader: "Deltagarmånader", narvarograd: "Närvarograd", tydlig_progression: "Tydlig progression", nagon_progression: "Någon progression",
  avstamningar: "Godkända avstämningar", arbetsgivarkontakter: "Arbetsgivarkontakter (minst)", upprepad_franvaro: "Månader med upprepad frånvaro",
  avvikelser_nya: "Nya avvikelser", praktik_startad: "Praktik startad", avslut: "Avslut", avslut_som_raknas: "Avslut som räknas",
  verifierat_resultat: "Med verifierat resultat", preliminara: "Preliminära resultat", resultatgrad: "Resultatgrad", handelser: "Händelser",
  verifierade: "Verifierade händelser", fordelning: "Fördelning per nivå",
};
/** Mått med mer än en kolumn – kan inte visas som staplar (measures.ts kontrollerar att listan stämmer). */
export const MULTI_COLUMN_MEASURES: readonly MeasureKey[] = ["fordelning"];

export const SPLIT_LABEL: Record<Split, string> = { inget: "Ingen", manad: "Månad", kvartal: "Kvartal", halvar: "Halvår" };
export const OUTPUT_LABEL: Record<Output, string> = { sammanstallning: "Sammanställning", lista: "Lista med en rad per deltagare" };

export const MAX_MEASURES = 4;
export const MAX_COLUMNS = 40;

// ---------------------------------------------------------------- Schemat
const FilterValue = z.string().min(1).max(120).refine((s) => !looksLikePnr(s), "Ett urval får inte innehålla personnummer.");
const FilterValues = z.array(FilterValue).min(1).max(50);
const FiltersSchema = z.strictObject({
  avtalsomrade_kod: FilterValues.optional(),
  yrkesspar: FilterValues.optional(),
  bestallare_enhet: FilterValues.optional(),
  fas_nr: FilterValues.optional(),
  samlad_status_kod: FilterValues.optional(),
  avslutsorsak_kod: FilterValues.optional(),
  resultat_kod: FilterValues.optional(),
  handelse_kod: FilterValues.optional(),
  omrade_kod: FilterValues.optional(),
});
export type Filters = z.infer<typeof FiltersSchema>;
const MeasureKeySchema = z.enum(MEASURE_KEYS);
/** "resultat.namn" – tabell och kolumn i registret. */
const QualifiedKey = z.string().regex(new RegExp(`^(${EXPORT_TABLES.join("|")})\\.[a-z0-9_]{1,60}$`), "Okänd kolumn.");
const PeriodSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("fast"), from: MonthKeySchema, to: MonthKeySchema }),
  z.strictObject({ kind: z.literal("senaste"), months: z.int().min(1).max(MAX_EXPORT_MONTHS) }),
]);
export type PeriodDef = z.infer<typeof PeriodSchema>;

const DefinitionBase = z.strictObject({
  v: z.literal(1),
  dataset: z.enum(DATASETS),
  period: PeriodSchema,
  filters: FiltersSchema,
  output: z.enum(OUTPUTS),
  groupBy: z.enum(DIMENSIONS).nullable(),
  split: z.enum(SPLITS),
  measures: z.array(MeasureKeySchema).max(MAX_MEASURES, "Välj högst fyra mått."),
  columns: z.array(QualifiedKey).max(MAX_COLUMNS, `Välj högst ${MAX_COLUMNS} kolumner.`),
  chart: z.strictObject({ measure: MeasureKeySchema }).nullable(),
});

export const ReportDefinitionSchema = DefinitionBase.superRefine((d, ctx) => {
  const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: "custom", message, path });
  const dsLabel = DATASET_LABEL[d.dataset];
  const dims = datasetDimensions(d.dataset);
  // Filter och gruppering hör till datamängden.
  for (const [k, v] of Object.entries(d.filters) as [Dimension, string[] | undefined][]) {
    if (v && !dims.includes(k)) issue(`Urvalet ${DIMENSION_LABEL[k]} finns inte för ${dsLabel}.`, ["filters", k]);
  }
  if (d.groupBy && !dims.includes(d.groupBy)) issue(`Uppdelningen ${DIMENSION_LABEL[d.groupBy]} finns inte för ${dsLabel}.`, ["groupBy"]);
  for (const m of d.measures) if (!MEASURES_BY_DATASET[d.dataset].includes(m)) issue(`Måttet ${MEASURE_LABEL[m]} finns inte för ${dsLabel}.`, ["measures"]);
  if (new Set(d.measures).size !== d.measures.length) issue("Samma mått är valt två gånger.", ["measures"]);
  if (new Set(d.columns).size !== d.columns.length) issue("Samma kolumn är vald två gånger.", ["columns"]);
  if (d.output === "sammanstallning") {
    // Gränsen 1–4 räknas i mått (fordelning är ett mått med fem kolumner).
    if (d.measures.length < 1) issue("Välj minst ett mått.", ["measures"]);
    if (d.columns.length) issue("En sammanställning har inga kolumner. Välj mått i stället.", ["columns"]);
    if (d.chart) {
      if (MULTI_COLUMN_MEASURES.includes(d.chart.measure)) issue("Fördelningen per nivå kan inte visas som staplar.", ["chart"]);
      else if (!d.measures.includes(d.chart.measure)) issue("Diagrammet ska visa ett av de valda måtten.", ["chart"]);
    }
  } else {
    if (d.measures.length) issue("En lista har inga mått. Välj kolumner i stället.", ["measures"]);
    if (d.groupBy) issue("En lista kan inte delas upp.", ["groupBy"]);
    if (d.split !== "inget") issue("En lista kan inte delas upp per tid.", ["split"]);
    if (d.chart) issue("En lista har inget diagram.", ["chart"]);
    const table = DATASET_TABLE[d.dataset];
    if (!d.columns.length) issue("Välj minst en kolumn.", ["columns"]);
    else if (d.columns[0] !== `${table}.arendenummer`) issue("Ärendenumret ska vara den första kolumnen.", ["columns"]);
    // Listans kolumner kommer bara ur datamängdens egen tabell (kopplade dimensioner är aldrig kolumner).
    for (const c of d.columns) {
      const [t, key] = c.split(".");
      if (t !== table || !isCatalogColumn(table, key)) issue(`Kolumnen ${c} finns inte för ${dsLabel}.`, ["columns"]);
    }
  }
  if (d.period.kind === "fast") {
    if (d.period.to < d.period.from) issue("Till-månaden kan inte vara före från-månaden.", ["period"]);
    else if (monthsInPeriod(d.period.from, d.period.to) > MAX_EXPORT_MONTHS) issue(`Välj högst ${MAX_EXPORT_MONTHS} månader.`, ["period"]);
  }
});
export type ReportDefinition = z.infer<typeof ReportDefinitionSchema>;

/** Det första felet i definitionen som text (byggaren och den sparade rapporten visar det), eller null. */
export function definitionError(raw: unknown): string | null {
  const r = ReportDefinitionSchema.safeParse(raw);
  return r.success ? null : (r.error.issues[0]?.message ?? "Rapporten är inte giltig.");
}

/** Byggarens steg där ett fel i definitionen rättas: "urval" (period och urval, steg 2) eller "visa" (visningen, steg 3). */
export type DefinitionStep = "urval" | "visa";
/** Det första felet i definitionen och steget där det rättas, eller null. */
export function definitionIssue(raw: unknown): { message: string; step: DefinitionStep } | null {
  const r = ReportDefinitionSchema.safeParse(raw);
  if (r.success) return null;
  const first = r.error.issues[0];
  const head = String(first?.path[0] ?? "");
  return { message: first?.message ?? "Rapporten är inte giltig.", step: head === "period" || head === "filters" ? "urval" : "visa" };
}

/** Normaliserad JSON (sorterade nycklar) – för att jämföra två definitioner ("är något ändrat?"). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

// ---------------------------------------------------------------- Perioden
export const NO_FULL_MONTHS = "Avtalet har inga hela månader i perioden ännu.";

/**
 * Perioden för en körning. "Senaste N" = de N hela månaderna före innevarande månad i Stockholms tid (now är alltid
 * Stockholms lokala tid, ctx.now()), räknas om vid varje körning och klipps vid avtalets start. Ligger hela perioden före
 * starten: NO_FULL_MONTHS.
 */
export function resolvePeriod(period: PeriodDef, opts: { now: LocalDateTime; contractStart: LocalDate }): { from: MonthKey; to: MonthKey } | { error: string } {
  const current = monthKey(opts.now);
  const start = monthKey(opts.contractStart);
  if (period.kind === "fast") {
    // Fast period: steg 3:s regler (inte före avtalets start, inte efter innevarande månad, högst 12 månader).
    const err = periodError(period.from, period.to, { current, start, maxMonths: MAX_EXPORT_MONTHS });
    return err ? { error: err } : { from: period.from, to: period.to };
  }
  const to = addMonths(current, -1);
  const from = addMonths(to, -(period.months - 1));
  if (to < start) return { error: NO_FULL_MONTHS };
  return { from: from < start ? start : from, to };
}

/** Periodens text i listan: "De senaste 6 hela månaderna" eller "oktober 2026 – december 2026". */
export function periodDefText(period: PeriodDef): string {
  if (period.kind === "senaste") return period.months === 1 ? "Den senaste hela månaden" : `De senaste ${period.months} hela månaderna`;
  return period.from === period.to ? monthName(period.from) : `${monthName(period.from)} – ${monthName(period.to)}`;
}

// ---------------------------------------------------------------- Rapportens namn
export const TITLE_HELP = "Skriv inga namn, personnummer eller ärendenummer.";
const CASE_NUMBER_ANY_CASE = new RegExp(CASE_NUMBER_RE.source, "i");
/** Antal tecken som Postgres räknar dem (char_length = kodpunkter) – inte UTF-16-enheter (en emoji är två i JavaScript). */
export const charCount = (s: string): number => [...s].length;
/** De första n tecknen (kodpunkter) – delar aldrig ett tecken mitt itu. */
export const firstChars = (s: string, n: number): string => [...s].slice(0, n).join("");
/**
 * Namnet på en sparad rapport: 3–80 tecken (räknade som char_length i 0021), inga personnummer eller ärendenummer, aldrig en
 * formel. Står aldrig i filnamn eller logg.
 */
export const TitleSchema = z.string().trim().superRefine((s, ctx) => {
  const n = charCount(s);
  if (n < 3) ctx.addIssue({ code: "custom", message: "Namnet ska ha minst 3 tecken." });
  else if (n > 80) ctx.addIssue({ code: "custom", message: "Namnet får ha högst 80 tecken." });
  else if (looksLikePnr(s)) ctx.addIssue({ code: "custom", message: `Det ser ut som ett personnummer. ${TITLE_HELP}` });
  else if (CASE_NUMBER_ANY_CASE.test(s)) ctx.addIssue({ code: "custom", message: `Det ser ut som ett ärendenummer. ${TITLE_HELP}` });
  else if (/^[=+\-@]/.test(s)) ctx.addIssue({ code: "custom", message: "Namnet kan inte börja med =, +, - eller @." });
});
/** Felet i namnet som text, eller null. */
export function titleError(raw: string): string | null {
  const r = TitleSchema.safeParse(raw);
  return r.success ? null : (r.error.issues[0]?.message ?? "Namnet är inte giltigt.");
}
