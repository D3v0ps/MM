// Kolumnregistret för kommunens resultatfil (rapporter steg 3, schemaversion 1). En post per kolumn: tabell, namn, typ,
// beskrivning, möjliga värden, källa och exempel. Fältbeskrivningen i filen (CSV-filen ..._faltbeskrivning.csv och fliken
// "Om filen") byggs härifrån, och docs/RESULTATFIL.md kontrolleras mot registret av ett test – de kan inte glida isär.
//
// Avtalet är konfiguration (CLAUDE.md punkt 4): texterna byggs av avtalets konfiguration och avtalsområden – prefix,
// faser, progressionsområden och gränser, regeln för upprepad frånvaro, skalan och avslutsorsakerna. Inga avtalsvärden står
// som fast text här. Exemplen (bara i docs/RESULTATFIL.md) är påhittade.
//
// Kolumner läggs bara till sist och byter aldrig namn eller plats. Ändras något annat höjs EXPORT_SCHEMA_VERSION. Områdes-
// kolumnerna niva_<område> ligger mitt i huvudtabellen; ändras områdena i avtalet flyttas kolumnerna efter dem – därför
// låser exporten kolumnlistan per avtal och schemaversion vid den första utlämnade filen (columnsStillCompatible).
import type { OperationalConfig } from "@/core/config";
import type { CellType, CsvColumn } from "@/core/export/csv";
import { END_REASON_LABEL, END_REASONS, RESULT_CLASS_LABEL, TRAFFIC_LIGHT_LABEL } from "@/core/labels";
import { OUTCOME_EVENT_KINDS, RESULT_CLASSES, TRAFFIC_LIGHTS, type ContractArea } from "@/data/schema";
import { monthName, type MonthKey } from "@/core/time";
import { plain } from "./report-helpers";

export const EXPORT_SCHEMA_VERSION = 1;
/** Högst så här många månader i en fil (produktens gräns, inte ett avtalsvärde). */
export const MAX_EXPORT_MONTHS = 12;

// Tabell 4 (avslut) lades till efter granskningen: avslutet står i tabell 1 bara när slutmånaden har en levererad
// månadsrapport, och det har den ofta inte (insatsen slutar tidigt i månaden). En ny tabell sist ändrar inga befintliga
// kolumner – schemaversionen är fortfarande 1.
export const EXPORT_TABLES = ["resultat", "progression", "handelser", "avslut"] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];
/** Flikarnas namn i Excel – och tabellens namn i fältbeskrivningen. */
export const TABLE_LABEL: Record<ExportTable, string> = { resultat: "Resultat", progression: "Progression", handelser: "Händelser", avslut: "Avslut" };

export type ExportColumn = {
  table: ExportTable;
  key: string;
  type: CellType;
  /** Betydelse (klarspråk, Markdown-backticks runt kolumnnamn tas bort i filen). */
  description: string;
  /** Möjliga värden. */
  values: string;
  /** Var uppgiften kommer ifrån – klarspråk för kommunen, aldrig kod (kolumnen kalla). */
  source: string;
  /** Påhittat exempel – bara i docs/RESULTATFIL.md, aldrig i filen. Tom sträng = tom cell i exemplet. */
  example?: string;
};

/** Formatet i fältbeskrivningen. */
export const FORMAT_LABEL: Record<CellType, string> = {
  text: "Text", int: "Heltal", decimal1: "Decimaltal med en decimal", date: "Datum (ÅÅÅÅ-MM-DD)", month: "Månad (ÅÅÅÅ-MM)", bool01: "1 eller 0",
};

const WORDS = ["noll", "en", "två", "tre", "fyra", "fem", "sex", "sju", "åtta", "nio", "tio", "elva", "tolv"];
/** Tal i ord upp till tolv ("två gånger", "de tio områdena"), annars siffror. */
export const numberWord = (n: number): string => WORDS[n] ?? String(n);
const range = (xs: readonly (string | number)[]): string => (xs.length ? (xs.length === 1 ? String(xs[0]) : `${xs[0]}–${xs[xs.length - 1]}`) : "");
const list = (xs: readonly string[]): string => xs.join(", ");

// Källa per grupp (kolumnen kalla). Klarspråk – inga kodnamn.
const S1 = "Månadsrapporten, avsnitt 1";
const S_CASE = "Ärendet i portalen";
const S_REPORT = "Månadsrapporten (månad, version och leveransdag)";
const S2 = "Månadsrapporten, avsnitt 2";
const S3 = "Månadsrapporten, avsnitt 3";
const S4 = "Månadsrapporten, avsnitt 4";
const S5 = "Månadsrapporten, avsnitt 5";
const S6 = "Månadsrapporten, avsnitt 6";
const S8 = "Månadsrapporten, avsnitt 8";
const S_FINAL = "Slutrapporten";
const S_FINAL_REPORT = "Slutrapporten (version och leveransdag)";

const YES_NO = "1 = ja, 0 = nej";
/** Påhittade exempel på nivåer per område (i områdenas ordning) för dokumentationen. */
const EXAMPLE_LEVELS = ["2", "2", "1", "1", "0", "2", "1", "1", "1", ""];

/** Kolumnerna i alla tabeller för avtalet, i filens ordning. */
export function exportColumns(cfg: OperationalConfig, areas: readonly Pick<ContractArea, "code" | "name">[]): ExportColumn[] {
  const prefix = cfg.casePrefix;
  const codes = [...new Set(areas.map((a) => a.code))].sort();
  const areaCodes = range(codes) || "Bokstav";
  const phases = [...cfg.phases].sort((a, b) => a.no - b.no);
  const prog = cfg.progression;
  const mandatory = prog.areas;
  const n = mandatory.length;
  const scaleKeys = Object.keys(prog.scale).sort();
  const levelRange = `${range(scaleKeys)} eller tom`;
  const scaleLabels = scaleKeys.map((k) => prog.scale[k as "0"]);
  const rule = cfg.attendance.repeatedAbsenceRule;
  const times = rule.absentInvalid === 1 ? "en gång" : `${numberWord(rule.absentInvalid)} gånger`;
  const caseNo = `${prefix}-ÅÅ-löpnummer`;
  const exCase = `${prefix}-26-0001`;
  const R = (key: string, type: CellType, description: string, values: string, source: string, example?: string): ExportColumn => ({ table: "resultat", key, type, description, values, source, example });

  const resultat: ExportColumn[] = [
    // Deltagare och rapport
    R("arendenummer", "text", "Ärendenumret, samma som i beställningen och på fakturan", caseNo, S1, exCase),
    R("namn", "text", "Deltagarens namn", "Text", S_CASE, "Alex Exempelsson"),
    R("manad", "month", "Månaden som raden gäller", "ÅÅÅÅ-MM", S_REPORT, "2026-10"),
    R("bestallare_enhet", "text", "Enheten som beställde insatsen", "Text", S1, "Arbetsmarknadsenheten"),
    R("rapport_version", "int", "Månadsrapportens version", "1, 2, 3 …", S_REPORT, "1"),
    R("rapport_levererad", "date", "Dagen då rapporten lämnades i portalen", "Datum", S_REPORT, "2026-11-06"),
    R("rattelse_pagar", "bool01", "En rättelse av rapporten är på väg", YES_NO, S_REPORT, "0"),
    // Insatsen (avsnitt 1)
    R("avtalsomrade_kod", "text", "Avtalsområde", areaCodes, S1, "G"),
    R("avtalsomrade", "text", "Avtalsområdets namn (utan bokstaven)", "Text", S1, "Lager och logistik"),
    R("avtalsomrade2_kod", "text", "Ett andra avtalsområde, om insatsen har det", `${areaCodes} eller tom`, S1, ""),
    R("yrkesspar", "text", "Yrkesspåret", "Text", S1, "Truckförare A+B"),
    R("insats_start", "date", "Dagen då insatsen startade", "Datum", S1, "2026-09-21"),
    R("insats_planerat_slut", "date", "Planerat slutdatum", "Datum eller tom", S1, "2026-11-27"),
    R("insats_slut", "date", "Dagen då insatsen avslutades", "Datum eller tom (pågår)", S1, ""),
    R("fas_nr", "int", "Fasens nummer vid månadens slut", range(phases.map((p) => p.no)), S1, "3"),
    R("fas", "text", "Fasens namn", list(phases.map((p) => plain(p.name))), S1, "Yrkesspecifika moment"),
    // Närvaro och frånvaro (avsnitt 2)
    R(
      "veckor", "int",
      "Antal veckor (måndag–söndag) som helt eller delvis ligger i månaden och då deltagaren var inskriven, veckor med uppehåll inräknade. En vecka som delas mellan två månader räknas i båda månaderna. Summera därför inte veckor över flera månader, och jämför inte med antalet veckor på fakturan",
      "Heltal", S2, "5",
    ),
    R("veckor_uppehall", "int", "Antal av veckorna med uppehåll", "Heltal", S2, "0"),
    R("tillfallen_planerade", "int", "Planerade tillfällen som har passerat", "Heltal", S2, "18"),
    R("narvarande", "int", "Tillfällen då deltagaren var på plats i tid", "Heltal", S2, "15"),
    R("sen_ankomst", "int", "Tillfällen då deltagaren kom för sent", "Heltal", S2, "1"),
    R("franvaro_giltig", "int", "Frånvaro med giltigt skäl", "Heltal", S2, "1"),
    R("franvaro_ogiltig", "int", "Frånvaro utan giltigt skäl", "Heltal", S2, "1"),
    R("ej_registrerade", "int", "Tillfällen där närvaron inte är registrerad", "Heltal", S2, "0"),
    R("narvaro_procent", "decimal1", "Andel av de registrerade tillfällena då deltagaren var på plats (i tid eller sent)", "0–100 med en decimal, tom om inget är registrerat", S2, "88,9"),
    R("upprepad_franvaro", "bool01", `Upprepad ogiltig frånvaro enligt avtalets regel (${times} inom ${rule.withinDays} dagar)`, YES_NO, S2, "0"),
    // Aktiviteter (avsnitt 3)
    R("avstamningar_godkanda", "int", "Godkända veckoavstämningar under månaden", "Heltal", S3, "4"),
    R(
      "arbetsgivarkontakter", "int",
      'Arbetsgivarkontakter enligt de godkända veckoavstämningarna. Coachen svarar 0, 1 eller "2 eller fler" varje vecka, och svaret "2 eller fler" räknas som 2 – talet är alltså ett minsta antal. Det är inte samma sak som händelsen "Anställningsintervju eller konkret arbetsgivarkontakt" i tabell 3, som registreras en gång per kontakt',
      "Heltal", S3, "3",
    ),
    R("veckomal_uppnatt", "int", "Veckor då veckomålet uppnåddes", "Heltal", S3, "2"),
    R("veckomal_delvis", "int", "Veckor då veckomålet uppnåddes delvis", "Heltal", S3, "1"),
    R("veckomal_ej_uppnatt", "int", "Veckor då veckomålet inte uppnåddes", "Heltal", S3, "1"),
    // Progression (avsnitt 4) – bara de obligatoriska områdena
    R("bedomning_godkand", "bool01", "Månadsbedömningen är godkänd", YES_NO, S4, "1"),
    R("omraden_bedomda", "int", `Antal av de ${numberWord(n)} obligatoriska områdena (kolumnerna \`niva_…\` nedan) som har en nivå`, `0–${n} eller tom`, S4, String(Math.max(0, n - 1))),
    R("progression_tydlig", "bool01", `Tydlig progression: minst ett av de ${numberWord(n)} områdena på nivå ${prog.clearFromLevel} eller högre`, "1, 0 eller tom", S4, "1"),
    R("progression_nagon", "bool01", `Någon progression: minst ett av de ${numberWord(n)} områdena på nivå ${prog.anyFromLevel} eller högre`, "1, 0 eller tom", S4, "1"),
    ...mandatory.map((k, i) => R(`niva_${k}`, "int", prog.areaLabels[k] ?? k, levelRange, S4, EXAMPLE_LEVELS[i] ?? "1")),
    // Resultat och utfall (avsnitt 5)
    R("handelser", "int", "Antal registrerade händelser under månaden", "Heltal", S5, "2"),
    R("handelser_verifierade", "int", "Av dem: antal med underlag (till exempel anställningsbevis)", "Heltal", S5, "1"),
    R("praktik_startad", "bool01", "Praktik eller arbetsplatsförlagt moment startade under månaden", YES_NO, S5, "1"),
    R("arbete_paborjat", "bool01", "Arbete påbörjades under månaden", YES_NO, S5, "0"),
    R("studier_paborjade", "bool01", "Studier påbörjades eller deltagaren blev antagen", YES_NO, S5, "0"),
    // Avvikelse och samlad bedömning (avsnitt 6 och 8)
    R("avvikelser_nya", "int", "Avvikelser som registrerades under månaden", "Heltal", S6, "0"),
    R("avvikelser_oppna", "int", "Avvikelser som var öppna vid månadens slut", "Heltal", S6, "0"),
    R("kommunens_beslut_behovs", "bool01", "Någon avvikelse behöver beslut eller stöd från kommunen", YES_NO, S6, "0"),
    R("samlad_status_kod", "text", "Coachens samlade status (kod)", `${list([...TRAFFIC_LIGHTS])} eller tom`, S8, "green"),
    R("samlad_status", "text", "Coachens samlade status", `${list(TRAFFIC_LIGHTS.map((t) => TRAFFIC_LIGHT_LABEL[t]))} eller tom`, S8, TRAFFIC_LIGHT_LABEL.green),
    R("bedomning_datum", "date", "Dagen då månadsbedömningen godkändes", "Datum eller tom", S8, "2026-11-02"),
    // Avslut och resultat (från slutrapporten)
    R("avslut_datum", "date", "Dagen då insatsen avslutades", "Datum eller tom", S_FINAL, "2026-11-20"),
    R("avslutsorsak_kod", "text", "Avslutsorsak (kod)", list([...END_REASONS]), S_FINAL, "arbete"),
    R("avslutsorsak", "text", "Avslutsorsak", list(END_REASONS.map((r) => END_REASON_LABEL[r])), S_FINAL, END_REASON_LABEL.arbete),
    R("resultat_kod", "text", "Hur avslutet räknas (kod)", list([...RESULT_CLASSES]), S_FINAL, "result"),
    R("resultat", "text", "Hur avslutet räknas", list(RESULT_CLASSES.map((r) => RESULT_CLASS_LABEL[r])), S_FINAL, RESULT_CLASS_LABEL.result),
    R("resultat_verifierat", "bool01", "Resultatet har underlag (till exempel anställningsbevis eller antagningsbesked) enligt slutrapporten", YES_NO, S_FINAL, "1"),
  ];

  const P = (key: string, type: CellType, description: string, values: string, example: string): ExportColumn => ({ table: "progression", key, type, description, values, source: S4, example });
  const progression: ExportColumn[] = [
    P("arendenummer", "text", "Ärendenumret", caseNo, exCase),
    P("manad", "month", "Månaden", "ÅÅÅÅ-MM", "2026-10"),
    P("omrade_kod", "text", "Områdets kod", "Se kolumnerna `niva_…` i tabell 1", mandatory[1] ?? mandatory[0] ?? ""),
    P("omrade", "text", "Områdets namn", "Text", prog.areaLabels[mandatory[1] ?? mandatory[0] ?? ""] ?? ""),
    P("niva", "int", "Nivån", `${range(scaleKeys)} eller tom (inte bedömd)`, "2"),
    P("niva_text", "text", "Nivån i ord", list(scaleLabels), prog.scale["2"] ?? ""),
  ];

  const H = (key: string, type: CellType, description: string, values: string, example: string): ExportColumn => ({ table: "handelser", key, type, description, values, source: S5, example });
  const handelser: ExportColumn[] = [
    H("arendenummer", "text", "Ärendenumret", caseNo, exCase),
    H("manad", "month", "Månaden", "ÅÅÅÅ-MM", "2026-10"),
    H("datum", "date", "Dagen då det hände", "Datum", "2026-10-14"),
    H("handelse_kod", "text", "Typ av händelse (kod)", list([...OUTCOME_EVENT_KINDS]), "intervju_arbetsgivarkontakt"),
    H("handelse", "text", "Typ av händelse", "Text", "Anställningsintervju eller konkret arbetsgivarkontakt"),
    H("verifierad", "bool01", "Händelsen har underlag", YES_NO, "0"),
  ];

  // Tabell 4: en rad per levererad slutrapport för insatser som avslutades under perioden. Samma koder och texter som
  // avslutskolumnerna i tabell 1.
  const A = (key: string, type: CellType, description: string, values: string, source: string, example: string): ExportColumn => ({ table: "avslut", key, type, description, values, source, example });
  const fin = (key: string) => resultat.find((c) => c.key === key)!;
  const avslut: ExportColumn[] = [
    A("arendenummer", "text", "Ärendenumret", caseNo, S_FINAL, exCase),
    A("manad", "month", "Månaden då insatsen avslutades", "ÅÅÅÅ-MM", S_FINAL, "2026-11"),
    A("avslut_datum", "date", "Dagen då insatsen avslutades", "Datum", S_FINAL, "2026-11-20"),
    A("avslutsorsak_kod", "text", fin("avslutsorsak_kod").description, fin("avslutsorsak_kod").values, S_FINAL, "arbete"),
    A("avslutsorsak", "text", fin("avslutsorsak").description, fin("avslutsorsak").values, S_FINAL, END_REASON_LABEL.arbete),
    A("resultat_kod", "text", fin("resultat_kod").description, fin("resultat_kod").values, S_FINAL, "result"),
    A("resultat", "text", fin("resultat").description, fin("resultat").values, S_FINAL, RESULT_CLASS_LABEL.result),
    A("resultat_verifierat", "bool01", fin("resultat_verifierat").description, YES_NO, S_FINAL, "1"),
    A("rapport_version", "int", "Slutrapportens version", "1, 2, 3 …", S_FINAL_REPORT, "1"),
    A("rapport_levererad", "date", "Dagen då slutrapporten lämnades i portalen", "Datum", S_FINAL_REPORT, "2026-11-27"),
    A("rattelse_pagar", "bool01", "En rättelse av slutrapporten är på väg", YES_NO, S_FINAL_REPORT, "0"),
  ];
  return [...resultat, ...progression, ...handelser, ...avslut];
}

/** Kolumnerna i en tabell. */
export const tableColumns = (all: readonly ExportColumn[], table: ExportTable): ExportColumn[] => all.filter((c) => c.table === table);
/** Kolumnnamnen i loggen och i kolumnspärren: "resultat.arendenummer". */
export const qualifiedKeys = (cols: readonly Pick<ExportColumn, "table" | "key">[]): string[] => cols.map((c) => `${c.table}.${c.key}`);

/** Fältbeskrivningens kolumner (CSV-filen ..._faltbeskrivning.csv och tabellen på fliken "Om filen"). */
export const FIELD_DESCRIPTION_COLUMNS: readonly CsvColumn[] = [
  { key: "tabell", type: "text" }, { key: "kolumn", type: "text" }, { key: "beskrivning", type: "text" }, { key: "format", type: "text" },
  { key: "mojliga_varden", type: "text" }, { key: "kalla", type: "text" }, { key: "schemaversion", type: "int" },
];

/** Text utan Markdown (backticks runt kolumnnamn). */
export const plainText = (s: string): string => s.replace(/`/g, "");

/** Fältbeskrivningens rader (utan exempel – de finns bara i docs/RESULTATFIL.md). */
export function fieldDescriptionRows(cols: readonly ExportColumn[]): Record<string, string | number>[] {
  return cols.map((c) => ({
    tabell: TABLE_LABEL[c.table], kolumn: c.key, beskrivning: plainText(c.description), format: FORMAT_LABEL[c.type], mojliga_varden: plainText(c.values),
    kalla: c.source, schemaversion: EXPORT_SCHEMA_VERSION,
  }));
}

/**
 * Får den nya kolumnlistan ersätta den gamla utan att schemaversionen höjs? Bara om den gamla listan är början av den nya
 * (samma kolumner i samma ordning, nya kolumner bara sist).
 */
export function columnsStillCompatible(prev: readonly string[], next: readonly string[]): boolean {
  return prev.length <= next.length && prev.every((k, i) => next[i] === k);
}

// ================================================================ Perioden (resultatfilen och rapportbyggaren)
/** Antal månader från och med from till och med to. */
export const monthsInPeriod = (from: MonthKey, to: MonthKey): number => {
  const [y1, m1] = from.split("-").map(Number);
  const [y2, m2] = to.split("-").map(Number);
  return (y2 * 12 + m2) - (y1 * 12 + m1) + 1;
};

/**
 * Felet för perioden, eller null. Regler: till-månaden inte före från-månaden, högst MAX_EXPORT_MONTHS månader, inte efter
 * innevarande månad och inte före avtalets start.
 */
export function periodError(from: MonthKey, to: MonthKey, opts: { current: MonthKey; start: MonthKey; maxMonths: number }): string | null {
  if (to < from) return "Till-månaden kan inte vara före från-månaden.";
  if (monthsInPeriod(from, to) > opts.maxMonths) return `Välj högst ${opts.maxMonths} månader.`;
  if (from < opts.start || to > opts.current) return `Välj månader från ${monthName(opts.start)} till ${monthName(opts.current)}.`;
  return null;
}
