// Kärnan i kommunens resultatfil (rapporter steg 3): raderna i tabellerna Resultat, Progression, Händelser och Avslut, byggda
// av de frysta fakta i levererade månads- och slutrapporter (facts.ts), och filerna (CSV och Excel). Ren och rollneutral: den vet
// inget om vem som frågar – urvalet (behörighet, enhet, skyddade personuppgifter) görs av hanteraren. Rapportbyggaren i
// steg 4 använder samma funktion för hela avtalet.
//
// Regler (fältbeskrivningen, docs/RESULTATFIL.md):
//   - En rad per deltagare och levererad månadsrapport, sorterad på ärendenummer och månad. Nyckeln är ärendenummer + månad.
//   - Tom cell = uppgiften saknas eller är inte bedömd. 0 = noll. Aldrig "–" eller "Framgår inte".
//   - Progressionen är tom när månadsbedömningen inte är godkänd. Bara de obligatoriska områdena – aldrig de valfria.
//   - Avslutet (från den levererade slutrapporten) står på raden för den månad då insatsen avslutades – om den månaden har en
//     levererad månadsrapport – och alltid i tabellen Avslut (en rad per slutrapport för insatser som avslutades i perioden).
//   - Bara den senaste levererade versionen per ärende och månad (slutrapport: per ärende).
//   - Namnet finns bara i tabellen Resultat. Ingen fritext, inga frånvaroorsaker och inga personnummer.
//   - Närvaron bara som veckor och närvarograd (schemaversion 2, beslut 6 2026-10-08) – inga antal per tillfälle.
//
// Raderna i tabellen Resultat bär dessutom interna fält (INTERNAL_FIELDS, nyckel med inledande understreck) som Miljonbemannings
// rapportbyggare räknar sina egna mått på (närvarograden viktad per tillfälle, builder/measures.ts). De kommer från samma frysta
// fakta och står aldrig i någon fil: filerna skrivs bara från kolumnregistret (exportColumns), aldrig från radens nycklar.
import { isUnset, type OperationalConfig } from "@/core/config";
import { toCsv, type CellType, type CsvColumn } from "@/core/export/csv";
import { buildXlsx, XLSX_MIME, type XlsxCell, type XlsxSheet } from "@/core/export/xlsx";
import { END_REASON_LABEL, EVENT_LABEL, RESULT_CLASS_LABEL, TRAFFIC_LIGHT_LABEL } from "@/core/labels";
import { dayOf, monthEnd, monthKey, monthName, type LocalDateTime, type MonthKey } from "@/core/time";
import type { ContractArea, Report } from "@/data/schema";
import {
  EXPORT_SCHEMA_VERSION, EXPORT_TABLES, FIELD_DESCRIPTION_COLUMNS, fieldDescriptionRows, TABLE_LABEL, exportColumns, tableColumns,
  type ExportColumn, type ExportTable,
} from "./export-columns";
import type { FinalFacts, MonthlyFacts } from "./facts";
import { plain } from "./report-helpers";

export type ExportCell = string | number | null;
export type ExportRow = Record<string, ExportCell>;

/** Interna fält på raderna i tabellen Resultat – bara för rapportbyggarens mått, aldrig i kolumnregistret eller i en fil. */
export const INTERNAL_FIELDS = {
  /** Tillfällen då deltagaren var på plats (i tid eller sent) – ur fakta, inte ur filens kolumner. */
  onSite: "_narvaro_pa_plats",
  /** Planerade tillfällen där närvaron är registrerad. */
  registered: "_narvaro_registrerade",
} as const;
export const isInternalField = (key: string): boolean => key.startsWith("_");

export type ExportMonthly = {
  report: Pick<Report, "id" | "caseId" | "month" | "version" | "deliveredAt">;
  /** En rättelse av rapporten är ett utkast som inte är levererat. */
  correctionPending: boolean;
  facts: MonthlyFacts;
};
export type ExportFinal = {
  report: Pick<Report, "id" | "caseId" | "version" | "deliveredAt">;
  /** En rättelse av slutrapporten är ett utkast som inte är levererat. */
  correctionPending: boolean;
  facts: FinalFacts;
};

export type ResultExportInput = {
  cfg: OperationalConfig;
  areas: readonly Pick<ContractArea, "code" | "name">[];
  /** Levererade, inte ersatta månadsrapporter med fakta. Rapporter utanför perioden tas inte med. */
  monthly: readonly ExportMonthly[];
  /** Levererade, inte ersatta slutrapporter med fakta (de som avslutades i perioden kommer med i tabellen Avslut). */
  finals: readonly ExportFinal[];
  /** Deltagarens namn per ärende-id (enligt läsarens behörighet). */
  names: ReadonlyMap<string, string>;
  from: MonthKey;
  to: MonthKey;
  now: LocalDateTime;
};

export type ResultExport = {
  columns: Record<ExportTable, ExportColumn[]>;
  allColumns: ExportColumn[];
  tables: Record<ExportTable, ExportRow[]>;
  meta: {
    from: MonthKey; to: MonthKey; now: LocalDateTime; schema: number; cases: number;
    /** Rapporterna vars uppgifter finns i filen (alla tabeller) – och per tabell (en CSV-fil). */
    reportIds: string[]; tableReportIds: Record<ExportTable, string[]>;
    rows: Record<ExportTable, number>;
  };
};

/**
 * Den senaste versionen per rapport: per ärende, typ och månad (slutrapporten: per ärende och typ). dropped = äldre versioner
 * som ändå var levererade och inte ersatta. Ska inte finnas (report.deliver ersätter hela versionskedjan) – men filen får
 * aldrig ha två rader med samma nyckel.
 */
export function latestVersions<R extends Pick<Report, "id" | "caseId" | "kind" | "month" | "version">>(rs: readonly R[]): { kept: R[]; dropped: R[] } {
  const best = new Map<string, R>();
  const dropped: R[] = [];
  for (const r of rs) {
    const key = `${r.kind}|${r.caseId ?? ""}|${r.kind === "final" ? "" : (r.month ?? "")}`;
    const cur = best.get(key);
    if (!cur) {
      best.set(key, r);
      continue;
    }
    const newer = r.version > cur.version || (r.version === cur.version && r.id > cur.id);
    best.set(key, newer ? r : cur);
    dropped.push(newer ? cur : r);
  }
  const kept = new Set([...best.values()].map((r) => r.id));
  return { kept: rs.filter((r) => kept.has(r.id)), dropped };
}

/** Samma regel för indata till buildResultExport (nyckeln ges av anroparen). */
function latestBy<X extends { report: { id: string; version: number } }>(xs: readonly X[], key: (x: X) => string): X[] {
  const best = new Map<string, X>();
  for (const x of xs) {
    const k = key(x);
    const cur = best.get(k);
    if (!cur || x.report.version > cur.report.version || (x.report.version === cur.report.version && x.report.id > cur.report.id)) best.set(k, x);
  }
  return [...best.values()];
}

/** Namn som aldrig får hamna i filen – då är urvalet fel (programfel). */
const BAD_NAMES = new Set(["", "–", "Skyddade personuppgifter"]);

const b01 = (v: boolean | null | undefined): number | null => (v == null ? null : v ? 1 : 0);
const nz = <T>(v: T | null | undefined | ""): T | null => (v == null || v === "" ? null : v);

/** Raderna i filens tre tabeller. */
export function buildResultExport(input: ResultExportInput): ResultExport {
  const { cfg, from, to } = input;
  const allColumns = exportColumns(cfg, input.areas);
  const columns = Object.fromEntries(EXPORT_TABLES.map((t) => [t, tableColumns(allColumns, t)])) as Record<ExportTable, ExportColumn[]>;
  const areaName = new Map(input.areas.map((a) => [a.code, a.name]));
  const phaseName = new Map(cfg.phases.map((p) => [p.no, plain(p.name)]));
  const mandatory = cfg.progression.areas;
  const monthly = latestBy(input.monthly.filter((m) => m.facts.month >= from && m.facts.month <= to), (m) => `${m.report.caseId ?? ""}|${m.facts.month}`)
    .sort((a, b) => (a.facts.caseNumber < b.facts.caseNumber ? -1 : a.facts.caseNumber > b.facts.caseNumber ? 1 : a.facts.month < b.facts.month ? -1 : a.facts.month > b.facts.month ? 1 : 0));
  // Slutrapporterna: den senaste versionen per ärende (inte den som råkar ligga sist i listan).
  const latestFinals = latestBy(input.finals.filter((f) => f.report.caseId), (f) => f.report.caseId as string);
  const finals = new Map(latestFinals.map((f) => [f.report.caseId as string, f]));
  /** Slutrapporterna i filen: på slutmånadens rad i Resultat och i tabellen Avslut. */
  const rowFinals = new Set<string>();
  const usedFinals = new Set<string>();

  const resultat: ExportRow[] = [];
  const progression: ExportRow[] = [];
  const handelser: ExportRow[] = [];
  for (const m of monthly) {
    const f = m.facts;
    const caseId = m.report.caseId ?? "";
    const name = input.names.get(caseId) ?? "";
    if (BAD_NAMES.has(name.trim())) throw new Error(`Resultatfilen: namnet saknas eller får inte lämnas ut (rapport ${m.report.id})`);
    const ok = f.assessmentApproved;
    const fin = finals.get(caseId);
    const closing = fin && fin.facts.endDate && monthKey(fin.facts.endDate) === f.month ? fin : null;
    if (closing) rowFinals.add(closing.report.id);
    const kinds = new Set(f.events.map((e) => e.kind));
    const row: ExportRow = {
      arendenummer: f.caseNumber,
      namn: name,
      manad: f.month,
      bestallare_enhet: nz(f.referrerUnit),
      rapport_version: m.report.version || 1,
      rapport_levererad: m.report.deliveredAt ? dayOf(m.report.deliveredAt) : null,
      rattelse_pagar: m.correctionPending ? 1 : 0,
      avtalsomrade_kod: nz(f.primaryAreaCode),
      avtalsomrade: f.primaryAreaCode ? (areaName.get(f.primaryAreaCode) ?? null) : null,
      avtalsomrade2_kod: nz(f.secondaryAreaCode),
      yrkesspar: nz(f.vocationalTrack),
      insats_start: nz(f.startDate),
      insats_planerat_slut: nz(f.plannedEnd),
      insats_slut: nz(f.endDate),
      fas_nr: f.phase,
      fas: f.phase != null ? (phaseName.get(f.phase) ?? null) : null,
      veckor: f.weeks,
      veckor_uppehall: f.pausedWeeks,
      narvaro_procent: f.attendance.rate == null ? null : Math.round(f.attendance.rate * 1000) / 10,
      upprepad_franvaro: b01(f.repeatedAbsence),
      avstamningar_godkanda: f.checkInsApproved,
      arbetsgivarkontakter: f.employerContacts,
      veckomal_uppnatt: f.goals.yes,
      veckomal_delvis: f.goals.partly,
      veckomal_ej_uppnatt: f.goals.no,
      bedomning_godkand: b01(ok),
      omraden_bedomda: ok ? f.areasAssessed : null,
      progression_tydlig: ok ? b01(f.progressionClear) : null,
      progression_nagon: ok ? b01(f.progressionAny) : null,
      ...Object.fromEntries(mandatory.map((k) => [`niva_${k}`, ok ? (f.levels[k] ?? null) : null])),
      handelser: f.events.length,
      handelser_verifierade: f.events.filter((e) => e.verified).length,
      praktik_startad: b01(kinds.has("praktik_startad")),
      arbete_paborjat: b01(kinds.has("arbete_paborjat")),
      studier_paborjade: b01(kinds.has("studier_paborjade")),
      avvikelser_nya: f.deviationsNew,
      avvikelser_oppna: f.deviationsOpen,
      kommunens_beslut_behovs: b01(f.needsCustomerDecision),
      samlad_status_kod: ok ? f.overallStatus : null,
      samlad_status: ok && f.overallStatus ? TRAFFIC_LIGHT_LABEL[f.overallStatus] : null,
      bedomning_datum: ok ? f.assessmentDate : null,
      avslut_datum: closing ? closing.facts.endDate : null,
      avslutsorsak_kod: closing ? closing.facts.endReason : null,
      avslutsorsak: closing && closing.facts.endReason ? END_REASON_LABEL[closing.facts.endReason] : null,
      resultat_kod: closing ? closing.facts.resultClass : null,
      resultat: closing && closing.facts.resultClass ? RESULT_CLASS_LABEL[closing.facts.resultClass] : null,
      resultat_verifierat: closing ? b01(closing.facts.resultVerified) : null,
      // Interna fält för rapportbyggaren (aldrig i filen).
      [INTERNAL_FIELDS.onSite]: f.attendance.present + f.attendance.late,
      [INTERNAL_FIELDS.registered]: f.attendance.planned - f.attendance.unregistered,
    };
    resultat.push(row);
    if (ok) {
      for (const k of mandatory) {
        const level = f.levels[k] ?? null;
        progression.push({
          arendenummer: f.caseNumber, manad: f.month, omrade_kod: k, omrade: cfg.progression.areaLabels[k] ?? k, niva: level,
          niva_text: level == null ? null : (cfg.progression.scale[String(level) as "0"] ?? null),
        });
      }
    }
    for (const e of [...f.events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
      handelser.push({ arendenummer: f.caseNumber, manad: f.month, datum: e.date, handelse_kod: e.kind, handelse: plain(EVENT_LABEL[e.kind] ?? e.kind), verifierad: e.verified ? 1 : 0 });
    }
  }
  // Tabellen Avslut: varje slutrapport för en insats som avslutades i perioden – också när slutmånaden saknar månadsrapport.
  const periodStart = `${from}-01`;
  const periodEnd = monthEnd(to);
  const closings = latestFinals
    .filter((f) => !!f.facts.endDate && f.facts.endDate >= periodStart && f.facts.endDate <= periodEnd)
    .sort((a, b) => (a.facts.caseNumber < b.facts.caseNumber ? -1 : a.facts.caseNumber > b.facts.caseNumber ? 1 : 0));
  const avslut: ExportRow[] = closings.map((fin) => {
    const f = fin.facts;
    usedFinals.add(fin.report.id);
    return {
      arendenummer: f.caseNumber,
      manad: monthKey(f.endDate as string),
      avslut_datum: f.endDate,
      avslutsorsak_kod: f.endReason,
      avslutsorsak: f.endReason ? END_REASON_LABEL[f.endReason] : null,
      resultat_kod: f.resultClass,
      resultat: f.resultClass ? RESULT_CLASS_LABEL[f.resultClass] : null,
      resultat_verifierat: b01(f.resultVerified),
      rapport_version: fin.report.version || 1,
      rapport_levererad: fin.report.deliveredAt ? dayOf(fin.report.deliveredAt) : null,
      rattelse_pagar: fin.correctionPending ? 1 : 0,
    };
  });
  const caseIds = new Set(monthly.map((m) => m.report.caseId));
  const monthlyIds = monthly.map((m) => m.report.id);
  const onRows = latestFinals.filter((f) => rowFinals.has(f.report.id)).map((f) => f.report.id);
  return {
    columns, allColumns, tables: { resultat, progression, handelser, avslut },
    meta: {
      from, to, now: input.now, schema: EXPORT_SCHEMA_VERSION, cases: caseIds.size,
      reportIds: [...monthlyIds, ...latestFinals.filter((f) => usedFinals.has(f.report.id) || rowFinals.has(f.report.id)).map((f) => f.report.id)],
      tableReportIds: { resultat: [...monthlyIds, ...onRows], progression: monthlyIds, handelser: monthlyIds, avslut: closings.map((f) => f.report.id) },
      rows: { resultat: resultat.length, progression: progression.length, handelser: handelser.length, avslut: avslut.length },
    },
  };
}

// ================================================================ Filerna
export const EXPORT_FILE_TABLES = [...EXPORT_TABLES, "faltbeskrivning"] as const;
export type ExportFileTable = (typeof EXPORT_FILE_TABLES)[number];
export type ExportFormat = "xlsx" | "csv";
export const CSV_MIME = "text/csv;charset=utf-8";

/** Filnamnet: bara avtalets prefix och perioden – aldrig namn eller personnummer. resultat_bot_2026-10_2026-12.xlsx */
export function resultFilename(casePrefix: string, from: MonthKey, to: MonthKey, format: ExportFormat, table: ExportFileTable = "resultat"): string {
  const base = `resultat_${casePrefix.toLowerCase().replace(/[^a-z0-9]/g, "")}_${from}_${to}`;
  if (format === "xlsx") return `${base}.xlsx`;
  return `${base}${table === "resultat" ? "" : `_${table}`}.csv`;
}

/** Perioden i klarspråk: "oktober 2026 – december 2026" (en månad: "oktober 2026"). */
export const periodLabel = (from: MonthKey, to: MonthKey): string => (from === to ? monthName(from) : `${monthName(from)} – ${monthName(to)}`);

/** Reglerna på fliken "Om filen" (exakta texter). Texten om resultatdefinitionen bara när den inte är fastställd. */
/** Regeln för verifierade resultat i filerna (resultatfilen och rapportbyggarens listor). */
export const VERIFIED_RESULT_RULE = "Ett resultat räknas först när resultat_verifierat = 1. Kommer underlaget efter att slutrapporten lämnats rättar vi slutrapporten – hämta då en ny fil.";
/** Tomma celler i filerna. */
export const EMPTY_CELL_RULE = "Tom cell betyder att uppgiften saknas eller inte är bedömd. 0 betyder noll.";

export function aboutRules(cfg: Pick<OperationalConfig, "result">): string[] {
  return [
    "Bara levererade månadsrapporter kommer med. Siffrorna är desamma som när rapporten lämnades.",
    "Avslut och resultat för alla insatser som avslutades under perioden finns på fliken Avslut. Räkna resultatgraden där.",
    isUnset(cfg.result.definition) ? "Resultatdefinitionen är inte fastställd. Resultatet är preliminärt." : null,
    cfg.result.requiresVerification ? VERIFIED_RESULT_RULE : null,
    EMPTY_CELL_RULE,
    "Rättade rapporter: filen har den senast levererade versionen. rattelse_pagar = 1 betyder att en rättelse är på väg.",
  ].filter((x): x is string => x !== null);
}

const csvColumns = (cols: readonly ExportColumn[]): CsvColumn[] => cols.map((c) => ({ key: c.key, type: c.type }));

/** En tabell som CSV-text (utan BOM – useDownload lägger till den). */
export function resultCsv(exp: ResultExport, table: ExportFileTable): string {
  if (table === "faltbeskrivning") return toCsv(FIELD_DESCRIPTION_COLUMNS, fieldDescriptionRows(exp.allColumns));
  return toCsv(csvColumns(exp.columns[table]), exp.tables[table]);
}

const NUMERIC: ReadonlySet<CellType> = new Set(["int", "decimal1", "bool01"]);
function sheetRows(cols: readonly ExportColumn[], rows: readonly ExportRow[]): XlsxCell[][] {
  return [cols.map((c) => c.key), ...rows.map((r) => cols.map((c) => {
    const v = r[c.key];
    if (v == null || v === "") return null;
    return NUMERIC.has(c.type) ? Number(v) : String(v);
  }))];
}
const widthFor = (c: ExportColumn) => (c.key === "namn" || c.key === "yrkesspar" || c.key === "handelse" || c.key === "omrade" || c.key === "bestallare_enhet" ? 32 : Math.max(10, c.key.length + 3));

export type AboutInfo = { contractNumber: string; customerName: string };

/** Excel-filen: flikarna Resultat, Progression, Händelser och Om filen. */
export async function resultXlsx(exp: ResultExport, cfg: OperationalConfig, about: AboutInfo): Promise<Uint8Array> {
  const data: XlsxSheet[] = EXPORT_TABLES.map((t) => {
    const cols = exp.columns[t];
    return {
      name: TABLE_LABEL[t], header: true, rows: sheetRows(cols, exp.tables[t]), widths: cols.map(widthFor),
      decimalColumns: cols.map((c, i) => (c.type === "decimal1" ? i : -1)).filter((i) => i >= 0),
    };
  });
  const { now } = exp.meta;
  const rowsText = EXPORT_TABLES.map((t) => `${TABLE_LABEL[t]}: ${exp.meta.rows[t]}`).join(", ");
  const head: XlsxCell[][] = [
    ["Avtal", `${about.contractNumber}, ${about.customerName}`],
    ["Period", periodLabel(exp.meta.from, exp.meta.to)],
    ["Hämtad", `${dayOf(now)} ${now.slice(11, 16)}`],
    ["Schemaversion", exp.meta.schema],
    ["Rader", rowsText],
    [],
    ...aboutRules(cfg).map((t) => [t]),
    [],
    ["Fältbeskrivning"],
  ];
  const fd = fieldDescriptionRows(exp.allColumns);
  const fdRows: XlsxCell[][] = [FIELD_DESCRIPTION_COLUMNS.map((c) => c.key), ...fd.map((r) => FIELD_DESCRIPTION_COLUMNS.map((c) => r[c.key] ?? null))];
  // Fältbeskrivningens rader bryts i cellerna (beskrivningarna är långa och grannkolumnerna aldrig tomma).
  const aboutSheet: XlsxSheet = {
    name: "Om filen", rows: [...head, ...fdRows], boldRows: [head.length - 1, head.length],
    widths: [16, 30, 70, 24, 50, 36, 14], wrapFromRow: head.length + 1,
  };
  return buildXlsx([...data, aboutSheet], { date: now });
}

export { XLSX_MIME };

// ================================================================ Perioden
// Reglerna ligger i export-columns.ts (lätt modul utan filformat – rapportbyggarens definition använder samma regler).
export { monthsInPeriod, periodError } from "./export-columns";
