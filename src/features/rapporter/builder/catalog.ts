// Rapportbyggaren: en regel för varje kolumn i steg 3:s register (export-columns.ts) och dimensionernas etiketter. Isomorf.
//
// Klasser:
//   identifierande  namn – bara i listor (och bara i datamängden deltagarmånader)
//   pseudonym       arendenummer – bara i listor
//   datum           datum – bara i listor
//   dimension       koder och texter som kan bli urval och uppdelning (DIMENSIONS) och deras textkolumner
//   fakta           tal och 1/0-kolumner
// arendenummer och namn kan aldrig bli urval eller uppdelning – DIMENSIONS (definition.ts) innehåller dem inte.
// Ett test stoppar en ny kolumn i registret som saknar regel här.
import { phaseName as cfgPhaseName, type OperationalConfig } from "@/core/config";
import { END_REASON_LABEL, EVENT_LABEL, RESULT_CLASS_LABEL, TRAFFIC_LIGHT_LABEL } from "@/core/labels";
import type { ContractArea } from "@/data/schema";
import type { ExportColumn, ExportTable } from "../export-columns";
import { plain } from "../report-helpers";

export const COLUMN_CLASSES = ["identifierande", "pseudonym", "datum", "dimension", "fakta"] as const;
export type ColumnClass = (typeof COLUMN_CLASSES)[number];
/** Rubrikerna i kolumnväljaren. */
export const SECTIONS = ["Rapporten", "Insatsen", "Närvaro", "Aktiviteter", "Progression", "Resultat", "Avvikelser", "Avslut"] as const;
export type Section = (typeof SECTIONS)[number];
export type ColumnRule = { class: ColumnClass; section: Section };

const r = (cls: ColumnClass, section: Section): ColumnRule => ({ class: cls, section });

/** Regeln per kolumn och tabell. niva_<område> i tabellen resultat har en egen prefixregel (NIVA_RULE). */
export const COLUMN_CLASS: Record<ExportTable, Record<string, ColumnRule>> = {
  resultat: {
    arendenummer: r("pseudonym", "Rapporten"), namn: r("identifierande", "Rapporten"), manad: r("dimension", "Rapporten"),
    bestallare_enhet: r("dimension", "Rapporten"), rapport_version: r("fakta", "Rapporten"), rapport_levererad: r("datum", "Rapporten"),
    rattelse_pagar: r("fakta", "Rapporten"),
    avtalsomrade_kod: r("dimension", "Insatsen"), avtalsomrade: r("dimension", "Insatsen"), avtalsomrade2_kod: r("dimension", "Insatsen"),
    yrkesspar: r("dimension", "Insatsen"), insats_start: r("datum", "Insatsen"), insats_planerat_slut: r("datum", "Insatsen"), insats_slut: r("datum", "Insatsen"),
    fas_nr: r("dimension", "Insatsen"), fas: r("dimension", "Insatsen"),
    veckor: r("fakta", "Närvaro"), veckor_uppehall: r("fakta", "Närvaro"), narvaro_procent: r("fakta", "Närvaro"), upprepad_franvaro: r("fakta", "Närvaro"),
    avstamningar_godkanda: r("fakta", "Aktiviteter"), arbetsgivarkontakter: r("fakta", "Aktiviteter"), veckomal_uppnatt: r("fakta", "Aktiviteter"),
    veckomal_delvis: r("fakta", "Aktiviteter"), veckomal_ej_uppnatt: r("fakta", "Aktiviteter"),
    bedomning_godkand: r("fakta", "Progression"), omraden_bedomda: r("fakta", "Progression"), progression_tydlig: r("fakta", "Progression"),
    progression_nagon: r("fakta", "Progression"),
    handelser: r("fakta", "Resultat"), handelser_verifierade: r("fakta", "Resultat"), praktik_startad: r("fakta", "Resultat"), arbete_paborjat: r("fakta", "Resultat"),
    studier_paborjade: r("fakta", "Resultat"),
    avvikelser_nya: r("fakta", "Avvikelser"), avvikelser_oppna: r("fakta", "Avvikelser"), kommunens_beslut_behovs: r("fakta", "Avvikelser"),
    samlad_status_kod: r("dimension", "Progression"), samlad_status: r("dimension", "Progression"), bedomning_datum: r("datum", "Progression"),
    avslut_datum: r("datum", "Avslut"), avslutsorsak_kod: r("dimension", "Avslut"), avslutsorsak: r("dimension", "Avslut"), resultat_kod: r("dimension", "Avslut"),
    resultat: r("dimension", "Avslut"), resultat_verifierat: r("fakta", "Avslut"),
  },
  progression: {
    arendenummer: r("pseudonym", "Rapporten"), manad: r("dimension", "Rapporten"), omrade_kod: r("dimension", "Progression"), omrade: r("dimension", "Progression"),
    niva: r("dimension", "Progression"), niva_text: r("dimension", "Progression"),
  },
  handelser: {
    arendenummer: r("pseudonym", "Rapporten"), manad: r("dimension", "Rapporten"), datum: r("datum", "Resultat"), handelse_kod: r("dimension", "Resultat"),
    handelse: r("dimension", "Resultat"), verifierad: r("fakta", "Resultat"),
  },
  avslut: {
    arendenummer: r("pseudonym", "Rapporten"), manad: r("dimension", "Rapporten"), avslut_datum: r("datum", "Avslut"), avslutsorsak_kod: r("dimension", "Avslut"),
    avslutsorsak: r("dimension", "Avslut"), resultat_kod: r("dimension", "Avslut"), resultat: r("dimension", "Avslut"), resultat_verifierat: r("fakta", "Avslut"),
    rapport_version: r("fakta", "Rapporten"), rapport_levererad: r("datum", "Rapporten"), rattelse_pagar: r("fakta", "Rapporten"),
  },
};
/** Prefixregeln: områdeskolumnerna niva_<område> i tabellen resultat (byggs av avtalets progressionsområden). */
export const NIVA_PREFIX = "niva_";
const NIVA_RULE = r("fakta", "Progression");

/** Kolumnens regel, eller null när kolumnen saknar regel (en ny kolumn i registret). */
export function columnRule(table: ExportTable, key: string): ColumnRule | null {
  const own = COLUMN_CLASS[table][key];
  if (own) return own;
  if (table === "resultat" && key.startsWith(NIVA_PREFIX) && /^[a-z0-9_]+$/.test(key.slice(NIVA_PREFIX.length))) return NIVA_RULE;
  return null;
}
export const isCatalogColumn = (table: ExportTable, key: string): boolean => columnRule(table, key) !== null;

/** Kolumner i registret som saknar regel ("tabell.kolumn"). Tomt = alla kolumner har en regel. */
export const uncataloged = (cols: readonly Pick<ExportColumn, "table" | "key">[]): string[] => cols.filter((c) => !columnRule(c.table, c.key)).map((c) => `${c.table}.${c.key}`);

// ---------------------------------------------------------------- Dimensionernas etiketter och ordning
/** Gruppen för ett tomt värde (sist i ordningen). Cellen i filen är tom. */
export const MISSING_LABEL = "Uppgift saknas";

export type DimensionValue = string | number | null;
type LabelEnv = { cfg: OperationalConfig; areas: readonly Pick<ContractArea, "code" | "name">[] };

/** Etiketten för ett värde: koden grupperar, texten visas ("G Lager och logistik", "Yrkesspecifika moment", "Grön" …). */
export function dimensionLabel(dim: string, value: DimensionValue, env: LabelEnv): string {
  if (value == null || value === "") return MISSING_LABEL;
  const v = String(value);
  switch (dim) {
    case "avtalsomrade_kod": {
      const a = env.areas.find((x) => x.code === v);
      return a ? `${a.code} ${a.name}` : v;
    }
    case "fas_nr": {
      const name = cfgPhaseName(env.cfg, Number(v));
      return name === "–" ? `Fas ${v}` : plain(name);
    }
    case "samlad_status_kod":
      return TRAFFIC_LIGHT_LABEL[v as keyof typeof TRAFFIC_LIGHT_LABEL] ?? v;
    case "avslutsorsak_kod":
      return END_REASON_LABEL[v as keyof typeof END_REASON_LABEL] ?? v;
    case "resultat_kod":
      return RESULT_CLASS_LABEL[v as keyof typeof RESULT_CLASS_LABEL] ?? v;
    case "handelse_kod":
      return plain(EVENT_LABEL[v as keyof typeof EVENT_LABEL] ?? v);
    case "omrade_kod":
      return env.cfg.progression.areaLabels[v] ?? v;
    default:
      return v;
  }
}

const TRAFFIC_ORDER = ["green", "yellow", "red"];
const collator = new Intl.Collator("sv", { sensitivity: "base", numeric: true });

/** Jämför två värden i dimensionens ordning: avtalsområde på kod, fas på nummer, samlad status grön–gul–röd, övriga på etiketten. Tomt sist. */
export function compareDimension(dim: string, a: DimensionValue, b: DimensionValue, env: LabelEnv): number {
  const ea = a == null || a === "";
  const eb = b == null || b === "";
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  let c = 0;
  if (dim === "avtalsomrade_kod") c = collator.compare(String(a), String(b));
  else if (dim === "fas_nr") c = Number(a) - Number(b);
  else if (dim === "samlad_status_kod") c = TRAFFIC_ORDER.indexOf(String(a)) - TRAFFIC_ORDER.indexOf(String(b));
  else if (dim === "omrade_kod") c = env.cfg.progression.areas.indexOf(String(a)) - env.cfg.progression.areas.indexOf(String(b));
  else c = collator.compare(dimensionLabel(dim, a, env), dimensionLabel(dim, b, env));
  // Alltid deterministiskt: lika etiketter ordnas på koden.
  return c || (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
}

/** Fasta val för urvalet ur konfigurationen och avtalsområdena (yrkesspår och enhet kommer ur urvalets rader). */
export function dimensionChoices(dim: string, env: LabelEnv): { value: string; label: string }[] | null {
  const opt = (values: readonly (string | number)[]) => values.map((v) => ({ value: String(v), label: dimensionLabel(dim, v, env) }));
  switch (dim) {
    case "avtalsomrade_kod":
      return opt([...new Set(env.areas.map((a) => a.code))].sort(collator.compare));
    case "fas_nr":
      return opt([...env.cfg.phases].sort((x, y) => x.no - y.no).map((p) => p.no));
    case "samlad_status_kod":
      return opt(TRAFFIC_ORDER);
    case "avslutsorsak_kod":
      return opt(Object.keys(END_REASON_LABEL));
    case "resultat_kod":
      return opt(Object.keys(RESULT_CLASS_LABEL));
    case "handelse_kod":
      return opt(Object.keys(EVENT_LABEL));
    case "omrade_kod":
      return opt(env.cfg.progression.areas);
    default:
      return null;
  }
}
