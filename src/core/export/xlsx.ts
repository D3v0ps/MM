// Minimal Excel-skrivare (Office Open XML, .xlsx) utan beroenden – isomorf, som zip.ts.
//
// Delar: [Content_Types].xml, _rels/.rels, xl/workbook.xml, xl/_rels/workbook.xml.rels, xl/styles.xml och ett blad per flik
// (xl/worksheets/sheetN.xml). Text skrivs som inlineStr – aldrig som formel (<f>), så ingenting i filen kan köras. Tal skrivs
// som talceller. Datum skrivs som text (ÅÅÅÅ-MM-DD) i version 1. Tecken som inte är tillåtna i XML tas bort.
// Databladen får låst rubrikrad (pane ySplit=1) och autofilter över hela tabellen.
import type { LocalDateTime } from "../time";
import { zip, type ZipEntry } from "./zip";

/** En cell: text (inlineStr), tal eller tom. */
export type XlsxCell = string | number | null | undefined;
export type XlsxSheet = {
  /** Bladets namn (högst 31 tecken, inte : \ / ? * [ ]). */
  name: string;
  rows: readonly (readonly XlsxCell[])[];
  /** Första raden är en rubrikrad: fet, låst och med autofilter över tabellen. */
  header?: boolean;
  /** Rader (0-baserade) som skrivs i fetstil, t.ex. rubriker på bladet "Om filen". */
  boldRows?: readonly number[];
  /** Kolumner (0-baserade) där tal visas med en decimal. */
  decimalColumns?: readonly number[];
  /** Kolumnbredder i tecken. */
  widths?: readonly number[];
  /**
   * Radbrytning: från och med raden fromRow (0-baserad) bryts texten i cellerna och ställs överst, så att långa texter syns
   * hela i en smal kolumn (t.ex. fältbeskrivningen på bladet "Om filen"). Fetstil går före.
   */
  wrapFromRow?: number;
};
export type XlsxOptions = { date?: LocalDateTime | null; compress?: boolean };

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// ---------------------------------------------------------------- XML
/** Tecken som inte får finnas i XML 1.0 (styrtecken utom tabb/LF/CR, ensamma surrogat, U+FFFE/U+FFFF). */
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const xmlText = (s: string): string =>
  s.replace(INVALID_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Kolumnens bokstäver: 0 → A, 25 → Z, 26 → AA. */
export function colName(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
export const cellRef = (col: number, row: number): string => `${colName(col)}${row + 1}`;

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
// Stilar: 0 = normal, 1 = fet, 2 = tal med en decimal, 3 = radbrytning och överst i cellen.
const STYLE_BOLD = 1;
const STYLE_DECIMAL = 2;
const STYLE_WRAP = 3;

function cellXml(v: XlsxCell, col: number, row: number, style: number): string {
  if (v === null || v === undefined || v === "") return "";
  const r = cellRef(col, row);
  const s = style ? ` s="${style}"` : "";
  if (typeof v === "number") return Number.isFinite(v) ? `<c r="${r}"${s}><v>${v}</v></c>` : "";
  return `<c r="${r}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlText(v)}</t></is></c>`;
}

function sheetXml(sh: XlsxSheet, index: number): string {
  const cols = Math.max(1, ...sh.rows.map((r) => r.length));
  const last = cellRef(cols - 1, Math.max(0, sh.rows.length - 1));
  const bold = new Set(sh.boldRows ?? []);
  if (sh.header) bold.add(0);
  const dec = new Set(sh.decimalColumns ?? []);
  const rows = sh.rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) =>
          cellXml(v, ci, ri, bold.has(ri) ? STYLE_BOLD : typeof v === "number" && dec.has(ci) ? STYLE_DECIMAL : sh.wrapFromRow != null && ri >= sh.wrapFromRow ? STYLE_WRAP : 0),
        )
        .join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  const pane = sh.header
    ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
    : "";
  const widths = sh.widths?.length
    ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.min(80, w))}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const filter = sh.header && sh.rows.length ? `<autoFilter ref="A1:${last}"/>` : "";
  return (
    `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<dimension ref="A1:${last}"/>` +
    `<sheetViews><sheetView workbookViewId="0"${index === 0 ? ' tabSelected="1"' : ""}>${pane}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>${widths}<sheetData>${rows}</sheetData>${filter}</worksheet>`
  );
}

/** Bladnamnet i en referens ('Om filen'!$A$1). */
const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;
const absRef = (ref: string) => ref.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2");

function workbookXml(sheets: readonly XlsxSheet[]): string {
  const defined = sheets
    .map((sh, i) => {
      if (!sh.header || !sh.rows.length) return "";
      const cols = Math.max(1, ...sh.rows.map((r) => r.length));
      const ref = `A1:${cellRef(cols - 1, sh.rows.length - 1)}`;
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xmlText(`${quoteSheet(sh.name)}!${absRef(ref)}`)}</definedName>`;
    })
    .join("");
  return (
    `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
    sheets.map((sh, i) => `<sheet name="${xmlText(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    `</sheets>${defined ? `<definedNames>${defined}</definedNames>` : ""}</workbook>`
  );
}

const STYLES =
  `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">` +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** Delarna i paketet (namn och XML) – utan att zippa. Exporteras för testerna. */
export function xlsxParts(sheets: readonly XlsxSheet[]): ZipEntry[] {
  if (!sheets.length) throw new Error("En Excel-fil behöver minst ett blad");
  const bad = sheets.find((s) => !s.name || s.name.length > 31 || /[:\\/?*[\]]/.test(s.name));
  if (bad) throw new Error(`Ogiltigt bladnamn: ${bad.name}`);
  const contentTypes =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
  const rootRels = `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const wbRels =
    `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`;
  return [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "xl/workbook.xml", data: workbookXml(sheets) },
    { name: "xl/_rels/workbook.xml.rels", data: wbRels },
    { name: "xl/styles.xml", data: STYLES },
    ...sheets.map((sh, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sh, i) })),
  ];
}

/** Bygg Excel-filen. */
export async function buildXlsx(sheets: readonly XlsxSheet[], opts: XlsxOptions = {}): Promise<Uint8Array> {
  return zip(xlsxParts(sheets), { date: opts.date ?? null, compress: opts.compress });
}
