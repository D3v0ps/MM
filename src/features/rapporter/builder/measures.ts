// Rapportbyggaren: måtten – ett register, en ren funktion per mått och en hjälptext ("Så räknas det"). Isomorf.
//
// Regler (beslut 15):
//   - Tomma celler räknas inte i andelar; antalet som inte räknats står i en not.
//   - Nivåerna 0–3 visas bara som fördelning (antal per nivå), aldrig som medelvärde.
//   - Andelar är 0–1 i vy-modellen ("41,7 %" på skärmen), 0–100 med en decimal i filen.
//   - Resultatgraden räknas med samma funktion som KPI:n (resultTally i src/core/kpi.ts): ett avslut utan resultatklass räknas
//     i nämnaren men aldrig i täljaren.
// Texterna byggs av avtalets konfiguration (gränserna för progression, regeln för upprepad frånvaro, vad som räknas som
// resultat) – inga avtalsvärden i fast text.
import { isUnset, type OperationalConfig } from "@/core/config";
import { resultTally } from "@/core/kpi";
import { END_REASON_LABEL } from "@/core/labels";
import type { ResultClass } from "@/data/schema";
import type { ExportRow } from "../export";
import { numberWord } from "../export-columns";
import { joinSv } from "../report-helpers";
import { MEASURE_LABEL, MEASURES_BY_DATASET, type Dataset, type MeasureKey } from "./definition";

export type MeasureUnit = "antal" | "andel";
export type MeasureColumn = { key: string; label: string; unit: MeasureUnit; fileKey: string };
export type MeasureResult = {
  /** Ett värde per kolumn (null = inget att räkna på). */
  values: (number | null)[];
  num?: number;
  den?: number;
  /** Rader som inte räknats (tomma celler). */
  skipped?: number;
  /** Avslut utan resultatklass (bara resultatgraden). */
  missing?: number;
};
export type MeasureDef = {
  key: MeasureKey;
  dataset: Dataset;
  label: string;
  help(cfg: OperationalConfig): string;
  /** KPI i avtalet (mållinjer ritas bara när kpiDef har ett värde). */
  kpiKey?: string;
  columns(cfg: OperationalConfig): MeasureColumn[];
  compute(rows: readonly ExportRow[]): MeasureResult;
  /** Not när rader inte räknats (tomma celler), byggd av antalet. */
  skippedNote?(n: number): string;
};

const num = (v: unknown): number => (typeof v === "number" ? v : v == null || v === "" ? 0 : Number(v) || 0);
const isOne = (v: unknown): boolean => v === 1 || v === "1";
const sum = (rows: readonly ExportRow[], key: string): number => rows.reduce((n, r) => n + num(r[key]), 0);
const countIf = (rows: readonly ExportRow[], f: (r: ExportRow) => boolean): number => rows.reduce((n, r) => n + (f(r) ? 1 : 0), 0);
const one = (key: MeasureKey, unit: MeasureUnit, fileKey: string) => (): MeasureColumn[] => [{ key, label: MEASURE_LABEL[key], unit, fileKey }];
const lc = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Avslutsorsakerna som räknas som resultat i klarspråk ("arbete och studier") – ur avtalets konfiguration. */
export const resultReasons = (cfg: OperationalConfig): string => joinSv(cfg.result.countsAsResult.map((k) => lc(END_REASON_LABEL[k as keyof typeof END_REASON_LABEL] ?? k)));

const share = (numerator: number, denominator: number): number | null => (denominator ? numerator / denominator : null);

const MEASURES: readonly MeasureDef[] = [
  // ---------------------------------------------------------------- Deltagarmånader (tabellen resultat)
  {
    key: "deltagarmanader", dataset: "deltagarmanader", label: MEASURE_LABEL.deltagarmanader,
    help: () => "Antal levererade månadsrapporter. En deltagare med tre månader räknas tre gånger.",
    columns: one("deltagarmanader", "antal", "deltagarmanader"),
    compute: (rows) => ({ values: [rows.length] }),
  },
  {
    key: "narvarograd", dataset: "deltagarmanader", label: MEASURE_LABEL.narvarograd, kpiKey: "narvarograd",
    help: () =>
      "Tillfällen då deltagaren var på plats (i tid eller sent) delat med alla registrerade tillfällen. Varje tillfälle väger lika mycket – det är inte ett medelvärde av deltagarnas procent.",
    columns: one("narvarograd", "andel", "narvarograd_procent"),
    compute: (rows) => {
      let n = 0;
      let d = 0;
      let skipped = 0;
      for (const r of rows) {
        const onSite = num(r.narvarande) + num(r.sen_ankomst);
        const registered = onSite + num(r.franvaro_giltig) + num(r.franvaro_ogiltig);
        if (!registered) skipped++;
        n += onSite;
        d += registered;
      }
      return { values: [share(n, d)], num: n, den: d, skipped };
    },
    skippedNote: (n) => `${n} ${n === 1 ? "deltagarmånad har" : "deltagarmånader har"} ingen registrerad närvaro och räknas inte.`,
  },
  {
    key: "tydlig_progression", dataset: "deltagarmanader", label: MEASURE_LABEL.tydlig_progression,
    help: (cfg) => `Andel av deltagarmånaderna med godkänd bedömning där minst ett av de obligatoriska områdena är på nivå ${cfg.progression.clearFromLevel} eller högre.`,
    columns: one("tydlig_progression", "andel", "tydlig_progression_procent"),
    compute: (rows) => {
      const approved = rows.filter((r) => isOne(r.bedomning_godkand));
      const n = countIf(approved, (r) => isOne(r.progression_tydlig));
      return { values: [share(n, approved.length)], num: n, den: approved.length, skipped: rows.length - approved.length };
    },
    skippedNote: (n) => `${n} ${n === 1 ? "deltagarmånad" : "deltagarmånader"} utan godkänd bedömning räknas inte.`,
  },
  {
    key: "nagon_progression", dataset: "deltagarmanader", label: MEASURE_LABEL.nagon_progression,
    help: (cfg) => `Andel av deltagarmånaderna med godkänd bedömning där minst ett av de obligatoriska områdena är på nivå ${cfg.progression.anyFromLevel} eller högre.`,
    columns: one("nagon_progression", "andel", "nagon_progression_procent"),
    compute: (rows) => {
      const approved = rows.filter((r) => isOne(r.bedomning_godkand));
      const n = countIf(approved, (r) => isOne(r.progression_nagon));
      return { values: [share(n, approved.length)], num: n, den: approved.length, skipped: rows.length - approved.length };
    },
    skippedNote: (n) => `${n} ${n === 1 ? "deltagarmånad" : "deltagarmånader"} utan godkänd bedömning räknas inte.`,
  },
  {
    key: "avstamningar", dataset: "deltagarmanader", label: MEASURE_LABEL.avstamningar,
    help: () => "Antal godkända veckoavstämningar, summerat för deltagarmånaderna.",
    columns: one("avstamningar", "antal", "avstamningar_godkanda"),
    compute: (rows) => ({ values: [sum(rows, "avstamningar_godkanda")] }),
  },
  {
    key: "arbetsgivarkontakter", dataset: "deltagarmanader", label: MEASURE_LABEL.arbetsgivarkontakter,
    help: () => 'Arbetsgivarkontakter enligt de godkända veckoavstämningarna, summerat. Svaret "2 eller fler" räknas som 2, så talet är ett minsta antal.',
    columns: one("arbetsgivarkontakter", "antal", "arbetsgivarkontakter"),
    compute: (rows) => ({ values: [sum(rows, "arbetsgivarkontakter")] }),
  },
  {
    key: "upprepad_franvaro", dataset: "deltagarmanader", label: MEASURE_LABEL.upprepad_franvaro,
    help: (cfg) => {
      const rule = cfg.attendance.repeatedAbsenceRule;
      const times = rule.absentInvalid === 1 ? "en gång" : `${numberWord(rule.absentInvalid)} gånger`;
      return `Antal deltagarmånader med upprepad ogiltig frånvaro enligt avtalets regel (${times} inom ${rule.withinDays} dagar).`;
    },
    columns: one("upprepad_franvaro", "antal", "manader_upprepad_franvaro"),
    compute: (rows) => ({ values: [countIf(rows, (r) => isOne(r.upprepad_franvaro))] }),
  },
  {
    key: "avvikelser_nya", dataset: "deltagarmanader", label: MEASURE_LABEL.avvikelser_nya,
    help: () => "Antal avvikelser som registrerades under månaderna.",
    columns: one("avvikelser_nya", "antal", "avvikelser_nya"),
    compute: (rows) => ({ values: [sum(rows, "avvikelser_nya")] }),
  },
  {
    key: "praktik_startad", dataset: "deltagarmanader", label: MEASURE_LABEL.praktik_startad,
    help: () => "Antal deltagarmånader då praktik eller ett arbetsplatsförlagt moment startade.",
    columns: one("praktik_startad", "antal", "praktik_startad"),
    compute: (rows) => ({ values: [countIf(rows, (r) => isOne(r.praktik_startad))] }),
  },
  // ---------------------------------------------------------------- Avslut (tabellen avslut)
  {
    key: "avslut", dataset: "avslut", label: MEASURE_LABEL.avslut,
    help: () => "Antal levererade slutrapporter för insatser som avslutades under perioden.",
    columns: one("avslut", "antal", "avslut"),
    compute: (rows) => ({ values: [rows.length] }),
  },
  {
    key: "avslut_som_raknas", dataset: "avslut", label: MEASURE_LABEL.avslut_som_raknas,
    help: () => "Avslut utom de som inte räknas i resultatgraden. Ett avslut utan uppgift om resultat räknas med.",
    columns: one("avslut_som_raknas", "antal", "avslut_som_raknas"),
    compute: (rows) => ({ values: [resultTally(tallyRows(rows)).den] }),
  },
  {
    key: "verifierat_resultat", dataset: "avslut", label: MEASURE_LABEL.verifierat_resultat,
    help: (cfg) => `Avslut med resultat (${resultReasons(cfg)}) där resultatet har underlag, till exempel anställningsbevis eller antagningsbesked.`,
    columns: one("verifierat_resultat", "antal", "verifierat_resultat"),
    compute: (rows) => ({ values: [resultTally(tallyRows(rows)).num] }),
  },
  {
    key: "preliminara", dataset: "avslut", label: MEASURE_LABEL.preliminara,
    help: (cfg) =>
      cfg.result.requiresVerification
        ? `Avslut med resultat (${resultReasons(cfg)}) som saknade underlag när slutrapporten lämnades. De räknas som resultat först när slutrapporten har rättats med underlaget.`
        : `Avslut med resultat (${resultReasons(cfg)}) som saknade underlag när slutrapporten lämnades.`,
    columns: one("preliminara", "antal", "preliminara_resultat"),
    compute: (rows) => ({ values: [resultTally(tallyRows(rows)).prelim] }),
  },
  {
    key: "resultatgrad", dataset: "avslut", label: MEASURE_LABEL.resultatgrad, kpiKey: "resultatgrad",
    help: () => "Avslut med verifierat resultat delat med avslut som räknas. Ett avslut utan uppgift om resultat räknas som ett avslut utan resultat.",
    columns: one("resultatgrad", "andel", "resultatgrad_procent"),
    compute: (rows) => {
      const t = resultTally(tallyRows(rows));
      return { values: [t.value], num: t.num, den: t.den, missing: t.missing };
    },
  },
  // ---------------------------------------------------------------- Händelser (tabellen handelser)
  {
    key: "handelser", dataset: "handelser", label: MEASURE_LABEL.handelser,
    help: () => "Antal registrerade händelser.",
    columns: one("handelser", "antal", "handelser"),
    compute: (rows) => ({ values: [rows.length] }),
  },
  {
    key: "verifierade", dataset: "handelser", label: MEASURE_LABEL.verifierade,
    help: () => "Händelser med underlag (till exempel anställningsbevis).",
    columns: one("verifierade", "antal", "handelser_verifierade"),
    compute: (rows) => ({ values: [countIf(rows, (r) => isOne(r.verifierad))] }),
  },
  // ---------------------------------------------------------------- Progression (tabellen progression)
  {
    key: "fordelning", dataset: "progression", label: MEASURE_LABEL.fordelning,
    help: () => "Antal bedömningar per nivå i de obligatoriska områdena. Nivåerna visas bara som antal per nivå, aldrig som medelvärde.",
    columns: (cfg) => [
      ...(["0", "1", "2", "3"] as const).map((k) => ({ key: `niva_${k}`, label: `${k} ${cfg.progression.scale[k]}`, unit: "antal" as const, fileKey: `niva_${k}` })),
      { key: "niva_ej_bedomd", label: "Inte bedömd", unit: "antal", fileKey: "niva_ej_bedomd" },
    ],
    compute: (rows) => {
      const counts = [0, 0, 0, 0, 0];
      for (const r of rows) {
        const v = r.niva;
        if (v == null || v === "") counts[4]++;
        else if (Number(v) >= 0 && Number(v) <= 3) counts[Number(v)]++;
      }
      return { values: counts };
    },
  },
];

/** Avslutens rader som indata till resultTally (en tom resultat_kod = null). */
function tallyRows(rows: readonly ExportRow[]): { resultClass: ResultClass | null; verified: boolean }[] {
  return rows.map((r) => ({ resultClass: (r.resultat_kod == null || r.resultat_kod === "" ? null : r.resultat_kod) as ResultClass | null, verified: isOne(r.resultat_verifierat) }));
}

export const MEASURE_REGISTRY: ReadonlyMap<MeasureKey, MeasureDef> = new Map(MEASURES.map((m) => [m.key, m]));
export const measureDef = (key: MeasureKey): MeasureDef => {
  const m = MEASURE_REGISTRY.get(key);
  if (!m) throw new Error(`Okänt mått: ${key}`);
  return m;
};
/** Måtten för datamängden i byggarens ordning. */
export const measuresFor = (ds: Dataset): MeasureDef[] => MEASURES_BY_DATASET[ds].map(measureDef);

/** Noterna för resultatgraden: avslut utan resultatklass och, när definitionen inte är fastställd, att resultatet är preliminärt. */
export function resultNotes(cfg: OperationalConfig, missing: number): string[] {
  return [
    missing > 0 ? `${missing} avslut saknar uppgift om resultat och räknas som avslut utan resultat.` : null,
    isUnset(cfg.result.definition) ? "Resultatdefinitionen är inte fastställd. Resultatet är preliminärt." : null,
  ].filter((x): x is string => !!x);
}
