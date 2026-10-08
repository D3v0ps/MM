// Rapportbyggarens motor: kör en definition på steg 3:s tabeller (buildResultExport) och bygger vy-modellen. Ren funktion.
//
//   1. Rader = datamängdens tabell; kopplade dimensioner (avslut: ärendets senaste levererade månadsrapport – joinFacts;
//      händelser och progression: samma månadsrapport, arendenummer + manad).
//   2. Urval ("är en av"). Inga rader efter urvalet = empty (inte "urvalet saknar månadsrapporter" – avslut kan finnas utan
//      månadsrapporter i perioden).
//   3. Sammanställning: grupper = uppdelningen × tidsdelen (kalenderkvartal och halvår, klippta vid perioden). Högst 200 rader.
//      Raden Totalt räknas på alla rader i urvalet. Kolumnen Deltagare (olika ärenden) finns alltid först.
//   4. Kommunens läge: en grupp (och Totalt) med 1 till minN − 1 deltagare visas som "färre än minN" – utan exakta antal och
//      med alla andra celler tomma. Inget internt mål. Inga texter om Miljonbemannings interna vyer.
//   5. Lista: bara antal och kolumnnamn – raderna finns bara i filen (beslut 12).
import { kpiDef, type OperationalConfig } from "@/core/config";
import { MONTHS, monthName, type MonthKey } from "@/core/time";
import type { ContractArea } from "@/data/schema";
import { EMPTY_CELL_RULE, periodLabel as exportPeriodLabel, VERIFIED_RESULT_RULE, type ExportRow, type ResultExport } from "../export";
import { plainText, type ExportColumn } from "../export-columns";
import type { MonthlyFacts } from "../facts";
import { smallN } from "../report-helpers";
import { compareDimension, dimensionLabel, type DimensionValue } from "./catalog";
import {
  DATASET_LABEL, DATASET_TABLE, DIMENSION_LABEL, MEASURE_LABEL, MULTI_COLUMN_MEASURES, SPLIT_LABEL, type Dataset, type Dimension, type MeasureKey, type Output,
  type ReportDefinition, type Split,
} from "./definition";
import { measureDef, resultNotes, type MeasureUnit } from "./measures";

export type BuilderAudience = "mb" | "kommun";

export type BuilderRow = {
  key: string;
  /** Gruppens etikett ("G Lager och logistik", "Uppgift saknas") – null utan uppdelning. */
  group: string | null;
  /** Gruppens kod (tom för "Uppgift saknas") – null utan uppdelning. Bara för filens kolumn grupp_kod. */
  groupCode: string | null;
  /** Tidsdelens etikett ("oktober–december 2026") – null utan tidsuppdelning. */
  period: string | null;
  from: MonthKey | null;
  to: MonthKey | null;
  /** Antal olika deltagare – null i kommunens läge när gruppen är liten. */
  cases: number | null;
  /** Talet, eller "färre än 5" i kommunens läge. */
  casesText: string;
  /** Måttens kolumner (null = inget att räkna på, eller en liten grupp i kommunens läge). */
  cells: (number | null)[];
  small: boolean;
};
/** En kolumn i tabellen. fileKey = kolumnens namn i filen (andelarna har _procent). */
export type BuilderColumn = { key: string; label: string; unit: MeasureUnit; fileKey: string };
export type BuilderChart = {
  measure: MeasureKey;
  label: string;
  unit: MeasureUnit;
  bars: { label: string; value: number | null; small: boolean }[];
  contractTarget: number | null;
  /** Bara i Miljonbemannings läge – kommunens vy-modell har ingen sådan nyckel. */
  internalTarget?: number | null;
};
export type BuilderView = {
  audience: BuilderAudience;
  dataset: Dataset;
  datasetLabel: string;
  output: Output;
  title: string;
  /** "oktober 2026 – december 2026" */
  periodLabel: string;
  from: MonthKey;
  to: MonthKey;
  counts: { rows: number | null; cases: number | null; casesText: string };
  table?: { groupLabel: string | null; splitLabel: string | null; columns: BuilderColumn[]; rows: BuilderRow[]; total: BuilderRow };
  chart?: BuilderChart | null;
  /** Målen för de valda måtten som har ett mål i avtalet (sammanställning). internalTarget bara i Miljonbemannings läge. */
  targets?: { measure: MeasureKey; label: string; contractTarget: number | null; internalTarget?: number | null }[];
  list?: { rows: number; cases: number; columns: { key: string; label: string }[]; hasNames: boolean };
  /** "Så räknas det": Deltagare och måttens hjälptexter. */
  explain: { label: string; text: string }[];
  notes: string[];
  rules: string[];
  /** Värdena i urvalets rader för fritextdimensionerna (filtervalen i byggaren). Tomt i kommunens läge. */
  dimensionValues: Partial<Record<"yrkesspar" | "bestallare_enhet", string[]>>;
  /** Gränsen för "färre än" i kommunens läge (cfg.pulse.minNForAggregate). */
  minN: number;
};

export type RunInput = {
  exp: ResultExport;
  /** Fakta för ärendets senaste levererade månadsrapport (joinMonthly) per ärendenummer – bara för datamängden avslut. */
  joinFacts: ReadonlyMap<string, Pick<MonthlyFacts, "primaryAreaCode" | "vocationalTrack" | "referrerUnit">>;
  def: ReportDefinition;
  period: { from: MonthKey; to: MonthKey };
  audience: BuilderAudience;
  cfg: OperationalConfig;
  areas: readonly Pick<ContractArea, "code" | "name">[];
  title: string;
  /** Högsta antal rader i tabellen (standard MAX_GROUPS). */
  maxGroups?: number;
  /**
   * Begränsad testare i testmiljön (src/api/tester-access.ts): inget internt mål, inte heller i Miljonbemannings läge
   * (förhandsvisningen, Excel-fliken "Om rapporten" och PDF:en). Avtalets mål finns kvar.
   */
  hideInternal?: boolean;
};
export type RunError = "empty" | "too_many_groups";
export type RunResult = { ok: true; view: BuilderView; rows: ExportRow[] } | { ok: false; error: RunError; message: string };

export const MAX_GROUPS = 200;
export const MAX_CHART_ROWS = 20;
export const EMPTY_TEXT = "Det finns inga levererade rapporter för urvalet. Välj en annan period eller färre urval.";
export const TOO_MANY_GROUPS = `Tabellen får för många rader (högst ${MAX_GROUPS}). Välj färre värden eller dela upp på ett annat sätt.`;
export const CHART_TOO_BIG = `Diagrammet visas när tabellen har högst ${MAX_CHART_ROWS} rader. Tabellen har alla siffror.`;
export const PARTICIPANTS_HELP = "Antal olika deltagare (ärenden) i gruppen.";
/** Resultatgraden räknas på slutrapporternas frysta fakta – ett resultat som verifierats efteråt räknas först efter en rättelse. */
export const LATE_VERIFICATION_NOTE = "Ett resultat som verifierats efter att slutrapporten lämnades räknas här först när slutrapporten har rättats.";
/** Kommunens läge (används inte sedan 2026-10-07): jämförelsen med beställarrapporten (som räknar på levande ärenden). */
export const CUSTOMER_SUMMARY_NOTE = "Beställarrapporten räknar på ärendena som de såg ut när den lämnades och kan därför visa en annan resultatgrad.";
/** Miljonbemanning: Lednings period (rullande sex månader, src/core/env.ts windowStart) skiljer sig också. */
export const LEDNING_PERIOD_NOTE = "Ledning räknar de sex senaste hela månaderna och den pågående månaden.";
/** En kolumn i en lista med resultatet ur slutrapporten (resultat, resultat_kod, resultat_verifierat). */
const RESULT_COLUMN = /^(resultat|avslut)\.resultat(_kod|_verifierat)?$/;

/**
 * De fasta texterna för läget. Skyddade personuppgifter nämns inte sedan beslutet 2026-10-07 (borttaget ur appen – spärren
 * är vilande i behörigheten och urvalet tar fortfarande aldrig med sådana ärenden).
 */
export function builderRules(): string[] {
  return ["Bara levererade månads- och slutrapporter kommer med. Siffrorna är desamma som när rapporten lämnades."];
}

/**
 * Målen för läget: avtalets mål alltid, det interna målet bara för Miljonbemanning (aldrig en nyckel i kommunens vy-modell)
 * och aldrig för begränsade testare (hideInternal).
 */
export function targetsFor(audience: BuilderAudience, cfg: OperationalConfig, kpiKey: string | undefined, hideInternal = false): { contractTarget: number | null; internalTarget?: number | null } {
  const k = kpiKey ? kpiDef(cfg, kpiKey) : null;
  const contractTarget = typeof k?.contractTarget === "number" ? k.contractTarget : null;
  if (audience !== "mb" || hideInternal) return { contractTarget };
  return { contractTarget, internalTarget: typeof k?.internalTarget === "number" ? k.internalTarget : null };
}

// ---------------------------------------------------------------- Tidsdelar
/** "oktober 2026" eller "oktober–december 2026" (en tidsdel ligger alltid inom ett kalenderår). */
export function monthsLabel(from: MonthKey, to: MonthKey): string {
  if (from === to) return monthName(from);
  const y = from.slice(0, 4);
  return `${MONTHS[Number(from.slice(5, 7)) - 1]}–${MONTHS[Number(to.slice(5, 7)) - 1]} ${y}`;
}
/** Tidsdelen som månaden hör till, klippt vid perioden. null = ingen tidsuppdelning. */
export function timePart(month: MonthKey, split: Split, period: { from: MonthKey; to: MonthKey }): { from: MonthKey; to: MonthKey; label: string } | null {
  if (split === "inget") return null;
  const y = month.slice(0, 4);
  const m = Number(month.slice(5, 7));
  const size = split === "manad" ? 1 : split === "kvartal" ? 3 : 6;
  const first = Math.floor((m - 1) / size) * size + 1;
  const mk = (n: number) => `${y}-${String(n).padStart(2, "0")}`;
  const from = mk(first) < period.from ? period.from : mk(first);
  const to = mk(first + size - 1) > period.to ? period.to : mk(first + size - 1);
  return { from, to, label: monthsLabel(from, to) };
}

// ---------------------------------------------------------------- Raderna och deras dimensioner
type Item = { row: ExportRow; dims: Partial<Record<Dimension, DimensionValue>> };

function itemsFor(input: RunInput): Item[] {
  const { exp, def } = input;
  const rows = exp.tables[DATASET_TABLE[def.dataset]];
  if (def.dataset === "deltagarmanader") {
    return rows.map((row) => ({
      row,
      dims: { avtalsomrade_kod: row.avtalsomrade_kod, yrkesspar: row.yrkesspar, bestallare_enhet: row.bestallare_enhet, fas_nr: row.fas_nr, samlad_status_kod: row.samlad_status_kod },
    }));
  }
  if (def.dataset === "avslut") {
    return rows.map((row) => {
      const m = input.joinFacts.get(String(row.arendenummer));
      return {
        row,
        dims: {
          avslutsorsak_kod: row.avslutsorsak_kod, resultat_kod: row.resultat_kod,
          avtalsomrade_kod: m?.primaryAreaCode ?? null, yrkesspar: m?.vocationalTrack ?? null, bestallare_enhet: m?.referrerUnit ?? null,
        },
      };
    });
  }
  const monthly = new Map(exp.tables.resultat.map((r) => [`${r.arendenummer}|${r.manad}`, r]));
  return rows.map((row) => {
    const m = monthly.get(`${row.arendenummer}|${row.manad}`);
    const own: Partial<Record<Dimension, DimensionValue>> = def.dataset === "handelser" ? { handelse_kod: row.handelse_kod } : { omrade_kod: row.omrade_kod };
    return {
      row,
      dims: { ...own, avtalsomrade_kod: m?.avtalsomrade_kod ?? null, yrkesspar: m?.yrkesspar ?? null, bestallare_enhet: m?.bestallare_enhet ?? null, fas_nr: m?.fas_nr ?? null },
    };
  });
}

const empty = (v: DimensionValue | undefined) => v == null || v === "";
const casesIn = (items: readonly Item[]) => new Set(items.map((i) => String(i.row.arendenummer))).size;
const collator = new Intl.Collator("sv", { sensitivity: "base", numeric: true });

/** En kolumn i definitionen som inte finns i registret för avtalet (t.ex. niva_<område> efter ändrade områden), eller null. */
export function missingColumn(def: ReportDefinition, all: readonly Pick<ExportColumn, "table" | "key">[]): string | null {
  const have = new Set(all.map((c) => `${c.table}.${c.key}`));
  return def.columns.find((c) => !have.has(c)) ?? null;
}

// ---------------------------------------------------------------- Motorn
export function runDefinition(input: RunInput): RunResult {
  const { def, cfg, audience, period } = input;
  const env = { cfg, areas: input.areas };
  const minN = cfg.pulse.minNForAggregate;
  const all = itemsFor(input);
  // Filtervalen för fritextdimensionerna: värdena i urvalets rader (före urvalet). Bara för Miljonbemanning.
  const dimensionValues: BuilderView["dimensionValues"] = {};
  if (audience === "mb") {
    for (const d of ["yrkesspar", "bestallare_enhet"] as const) {
      const vs = [...new Set(all.map((i) => i.dims[d]).filter((v): v is string | number => !empty(v)).map(String))].sort(collator.compare);
      if (vs.length) dimensionValues[d] = vs;
    }
  }
  const filters = Object.entries(def.filters).filter(([, v]) => v && v.length) as [Dimension, string[]][];
  const items = all.filter((i) => filters.every(([d, vs]) => !empty(i.dims[d]) && vs.includes(String(i.dims[d]))));
  if (!items.length) return { ok: false, error: "empty", message: EMPTY_TEXT };

  const base = {
    audience, dataset: def.dataset, datasetLabel: DATASET_LABEL[def.dataset], output: def.output, title: input.title,
    periodLabel: exportPeriodLabel(period.from, period.to), from: period.from, to: period.to, rules: builderRules(), dimensionValues, minN,
  };
  const rows = items.map((i) => i.row);
  const totalCases = casesIn(items);

  if (def.output === "lista") {
    const table = DATASET_TABLE[def.dataset];
    const cols = input.exp.columns[table];
    // Samma regler som resultatfilen (steg 3) för listans kolumner: resultatet och verifieringen när listan har en
    // resultatkolumn, och vad en tom cell betyder.
    const listNotes = [
      ...(def.columns.some((q) => RESULT_COLUMN.test(q)) ? [...resultNotes(cfg, 0), ...(cfg.result.requiresVerification ? [VERIFIED_RESULT_RULE] : [])] : []),
      EMPTY_CELL_RULE,
    ];
    return {
      ok: true, rows,
      view: {
        ...base, counts: { rows: items.length, cases: totalCases, casesText: String(totalCases) },
        list: {
          rows: items.length, cases: totalCases, hasNames: def.columns.includes("resultat.namn"),
          columns: def.columns.map((q) => {
            const key = q.split(".")[1];
            return { key, label: plainText(cols.find((c) => c.key === key)?.description ?? key) };
          }),
        },
        explain: [], notes: listNotes,
      },
    };
  }

  // ---- Sammanställning
  const measures = def.measures.map(measureDef);
  const columns: BuilderColumn[] = [{ key: "deltagare", label: "Deltagare", unit: "antal", fileKey: "deltagare" }, ...measures.flatMap((m) => m.columns(cfg))];
  const groups = new Map<string, { value: DimensionValue; part: ReturnType<typeof timePart>; items: Item[] }>();
  for (const i of items) {
    const value = def.groupBy ? (i.dims[def.groupBy] ?? null) : null;
    const part = timePart(String(i.row.manad), def.split, period);
    const key = `${def.groupBy ? (empty(value) ? "" : String(value)) : "alla"}|${part?.from ?? ""}`;
    const g = groups.get(key);
    if (g) g.items.push(i);
    else groups.set(key, { value: empty(value) ? null : (value as DimensionValue), part, items: [i] });
  }
  if (groups.size > (input.maxGroups ?? MAX_GROUPS)) return { ok: false, error: "too_many_groups", message: TOO_MANY_GROUPS };
  const ordered = [...groups.entries()].sort(([, a], [, b]) =>
    (def.groupBy ? compareDimension(def.groupBy, a.value, b.value, env) : 0) || ((a.part?.from ?? "") < (b.part?.from ?? "") ? -1 : (a.part?.from ?? "") > (b.part?.from ?? "") ? 1 : 0));

  const build = (key: string, its: readonly Item[], group: string | null, groupCode: string | null, part: ReturnType<typeof timePart>): BuilderRow => {
    const n = casesIn(its);
    const small = audience === "kommun" && n > 0 && n < minN;
    const cells = small ? columns.slice(1).map(() => null) : measures.flatMap((m) => m.compute(its.map((i) => i.row)).values);
    return {
      key, group, groupCode, period: part?.label ?? null, from: part?.from ?? null, to: part?.to ?? null,
      cases: small ? null : n, casesText: audience === "kommun" ? smallN(minN, n) : String(n), cells, small,
    };
  };
  const tableRows = ordered.map(([key, g]) =>
    build(key, g.items, def.groupBy ? dimensionLabel(def.groupBy, g.value, env) : null, def.groupBy ? (g.value == null ? "" : String(g.value)) : null, g.part));
  const total = build("total", items, "Totalt", null, null);

  // ---- Noterna (räknade på alla rader i urvalet – inte i kommunens läge när hela urvalet är litet)
  const notes: string[] = [];
  const totalRows = items.map((i) => i.row);
  for (const m of measures) {
    const res = m.compute(totalRows);
    if (!total.small && m.skippedNote && res.skipped) notes.push(m.skippedNote(res.skipped));
    if (m.key === "resultatgrad") {
      if (!total.small) notes.push(...resultNotes(cfg, res.missing ?? 0).filter((t) => !t.startsWith("Resultatdefinitionen")));
      notes.push(audience === "mb" ? "Räknat på levererade slutrapporter. Kan skilja sig från Ledning, som räknar på ärendena som de ser ut nu." : "Räknat på levererade slutrapporter.");
      // Varför siffran skiljer sig från beställarrapporten (kommunen) och Ledning (Miljonbemanning).
      notes.push(LATE_VERIFICATION_NOTE, audience === "mb" ? LEDNING_PERIOD_NOTE : CUSTOMER_SUMMARY_NOTE);
      const kpiMin = kpiDef(cfg, m.kpiKey ?? "")?.minN ?? 0;
      const visible = tableRows.filter((r) => !r.small);
      const thin = visible.filter((r) => (m.compute(groupItems(ordered, r.key).map((i) => i.row)).den ?? 0) < kpiMin).length;
      if (kpiMin && thin) {
        notes.push(visible.length === 1
          ? `Underlaget är litet (färre än ${kpiMin} avslut som räknas). Jämför försiktigt.`
          : `I ${thin} av grupperna är underlaget litet (färre än ${kpiMin} avslut som räknas). Jämför försiktigt.`);
      }
    }
  }
  if (measures.some((m) => ["avslut_som_raknas", "verifierat_resultat", "preliminara", "resultatgrad"].includes(m.key))) {
    notes.push(...resultNotes(cfg, 0));
  }
  if (audience === "kommun") notes.push(`Grupper med färre än ${minN} deltagare visas som "färre än ${minN}", så att ingen kan kännas igen.`);

  // ---- Diagrammet: ett mått med en kolumn, högst 20 rader
  let chart: BuilderChart | null = null;
  if (def.chart && !MULTI_COLUMN_MEASURES.includes(def.chart.measure) && def.measures.includes(def.chart.measure)) {
    if (tableRows.length > MAX_CHART_ROWS) notes.push(CHART_TOO_BIG);
    else {
      const m = measureDef(def.chart.measure);
      const idx = columns.findIndex((c) => c.key === m.columns(cfg)[0].key) - 1;
      chart = {
        measure: m.key, label: MEASURE_LABEL[m.key], unit: m.columns(cfg)[0].unit,
        bars: tableRows.map((r) => ({ label: [r.group, r.period].filter(Boolean).join(" · ") || "Alla", value: r.small ? null : (r.cells[idx] ?? null), small: r.small })),
        ...targetsFor(audience, cfg, m.kpiKey, input.hideInternal),
      };
    }
  }

  return {
    ok: true, rows,
    view: {
      ...base,
      counts: total.small ? { rows: null, cases: null, casesText: total.casesText } : { rows: items.length, cases: totalCases, casesText: total.casesText },
      table: { groupLabel: def.groupBy ? DIMENSION_LABEL[def.groupBy] : null, splitLabel: def.split === "inget" ? null : SPLIT_LABEL[def.split], columns, rows: tableRows, total },
      chart,
      targets: measures.filter((m) => m.kpiKey).map((m) => ({ measure: m.key, label: m.label, ...targetsFor(audience, cfg, m.kpiKey, input.hideInternal) }))
        .filter((t) => t.contractTarget != null || (t.internalTarget ?? null) != null),
      explain: [{ label: "Deltagare", text: PARTICIPANTS_HELP }, ...measures.map((m) => ({ label: m.label, text: m.help(cfg) }))],
      notes: [...new Set(notes)],
    },
  };
}

function groupItems(ordered: readonly [string, { items: Item[] }][], key: string): Item[] {
  return ordered.find(([k]) => k === key)?.[1].items ?? [];
}
