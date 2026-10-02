// Rapportbyggaren: färdiga mallar (i koden, version 1) och standardkolumnerna per datamängd. Isomorf.
// Ett test validerar alla mallar mot ReportDefinitionSchema. Mallnyckeln används i filnamnet (bara om den finns här).
import type { Dataset, ReportDefinition } from "./definition";

export const STANDARD_COLUMNS: Record<Dataset, readonly string[]> = {
  deltagarmanader: ["resultat.arendenummer", "resultat.namn", "resultat.manad", "resultat.avtalsomrade", "resultat.fas", "resultat.narvaro_procent", "resultat.samlad_status", "resultat.progression_tydlig"],
  avslut: ["avslut.arendenummer", "avslut.manad", "avslut.avslut_datum", "avslut.avslutsorsak", "avslut.resultat", "avslut.resultat_verifierat"],
  handelser: ["handelser.arendenummer", "handelser.manad", "handelser.datum", "handelser.handelse", "handelser.verifierad"],
  progression: ["progression.arendenummer", "progression.manad", "progression.omrade", "progression.niva", "progression.niva_text"],
};

export type Template = {
  key: string;
  name: string;
  /** Meningen på mallkortet utan avtalsvärden. */
  sentence: string;
  /**
   * Meningen med avtalets värden: resultReasons = vad som räknas som resultat i avtalet i klarspråk ("arbete och studier",
   * byggt av cfg.result.countsAsResult i katalogen – aldrig fast text).
   */
  sentenceFor?: (v: { resultReasons: string }) => string;
  definition: ReportDefinition;
};

const base = { v: 1 as const, filters: {}, columns: [] as string[], split: "inget" as const };

export const TEMPLATES: readonly Template[] = [
  {
    key: "resultatgrad-per-omrade", name: "Resultatgrad per avtalsområde",
    sentence: "Hur många av avsluten som gav resultat, per avtalsområde.",
    sentenceFor: (v) => `Hur många av avsluten som gav resultat (${v.resultReasons}), per avtalsområde.`,
    definition: {
      ...base, dataset: "avslut", period: { kind: "senaste", months: 6 }, output: "sammanstallning", groupBy: "avtalsomrade_kod",
      measures: ["avslut_som_raknas", "verifierat_resultat", "preliminara", "resultatgrad"], chart: { measure: "resultatgrad" },
    },
  },
  {
    key: "narvaro-per-manad", name: "Närvaro per månad", sentence: "Närvarograden månad för månad.",
    definition: {
      ...base, dataset: "deltagarmanader", period: { kind: "senaste", months: 6 }, output: "sammanstallning", groupBy: null, split: "manad",
      measures: ["deltagarmanader", "narvarograd"], chart: { measure: "narvarograd" },
    },
  },
  {
    key: "progression-per-omrade", name: "Progression per avtalsområde",
    sentence: "Andelen deltagarmånader med tydlig och någon progression, per avtalsområde.",
    definition: {
      ...base, dataset: "deltagarmanader", period: { kind: "senaste", months: 3 }, output: "sammanstallning", groupBy: "avtalsomrade_kod",
      measures: ["tydlig_progression", "nagon_progression"], chart: { measure: "tydlig_progression" },
    },
  },
  {
    key: "handelser-per-typ", name: "Händelser per typ",
    sentence: "Hur många händelser av varje typ som registrerats, och hur många som har underlag.",
    definition: {
      ...base, dataset: "handelser", period: { kind: "senaste", months: 3 }, output: "sammanstallning", groupBy: "handelse_kod",
      measures: ["handelser", "verifierade"], chart: { measure: "handelser" },
    },
  },
  {
    key: "nivaer-per-omrade", name: "Nivåer per område",
    sentence: "Hur många bedömningar som hamnade på varje nivå, per progressionsområde.",
    definition: {
      ...base, dataset: "progression", period: { kind: "senaste", months: 3 }, output: "sammanstallning", groupBy: "omrade_kod",
      measures: ["fordelning"], chart: null,
    },
  },
  {
    key: "deltagare-i-manaden", name: "Deltagare i månaden",
    sentence: "En lista med en rad per deltagare och månad. Listan finns bara i filen.",
    definition: {
      ...base, dataset: "deltagarmanader", period: { kind: "senaste", months: 1 }, output: "lista", groupBy: null,
      measures: [], columns: [...STANDARD_COLUMNS.deltagarmanader], chart: null,
    },
  },
];

/** Mallnycklarna (zod-enum i kontrakten – aldrig fri text). */
export const TEMPLATE_KEYS = ["resultatgrad-per-omrade", "narvaro-per-manad", "progression-per-omrade", "handelser-per-typ", "nivaer-per-omrade", "deltagare-i-manaden"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Meningen på mallkortet för avtalet (med avtalets värden när mallen nämner dem; utan avtal den neutrala meningen). */
export const templateSentence = (t: Template, v: { resultReasons: string } | null): string => (v && t.sentenceFor ? t.sentenceFor(v) : t.sentence);

/** Mallen för en nyckel – uppslag i koden. En okänd nyckel (t.ex. en godtycklig sträng i databasen) ger null. */
export const templateFor = (key: string | null | undefined): Template | null => (key ? (TEMPLATES.find((t) => t.key === key) ?? null) : null);
