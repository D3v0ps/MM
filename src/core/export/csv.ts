// CSV för filer som lämnas ut (resultatfilen till kommunen, rapporter steg 3). Ren funktion utan I/O – isomorf.
//
// Format (svensk Excel): semikolon mellan kolumnerna, CRLF efter varje rad, en rubrikrad med kolumnnamnen, decimalkomma.
// Celler som innehåller semikolon, citattecken, CR eller LF omges av citattecken (citattecken dubbleras).
// Formelskydd: en textcell som börjar med =, +, -, @, tabb eller CR får en inledande apostrof, så att Excel aldrig tolkar
// den som en formel. Talkolumner skyddas inte – varje kolumn har en känd typ, och tal skrivs alltid som tal.
// Texten returneras utan BOM. useDownload (src/ui/download.tsx) lägger till exakt en BOM för text/*, så att Excel läser
// å, ä och ö rätt.

/** Kolumnens typ. Bestämmer hur cellen skrivs (och om den skyddas mot formler). */
export type CellType = "text" | "int" | "decimal1" | "date" | "month" | "bool01";
/** En cell: text, tal eller tom (null). Sanningsvärden skrivs som 1 och 0 (bool01). */
export type Cell = string | number | boolean | null | undefined;
export type CsvColumn = { key: string; type: CellType };
export type CsvRow = Readonly<Record<string, Cell>>;

export const CSV_SEPARATOR = ";";
export const CSV_NEWLINE = "\r\n";

/** Textceller som skulle kunna tolkas som en formel i Excel. */
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[;"\r\n]/;

/** Cellens värde som text enligt kolumnens typ. Tom cell = tom sträng. */
export function csvCell(type: CellType, v: Cell): string {
  if (v === null || v === undefined || v === "") return "";
  let s: string;
  if (type === "bool01") s = v === true || v === 1 || v === "1" ? "1" : "0";
  else if (type === "int") s = String(typeof v === "number" ? Math.trunc(v) : v);
  else if (type === "decimal1") s = (typeof v === "number" ? v.toFixed(1) : String(v)).replace(".", ",");
  else {
    s = String(v);
    if (type === "text" && FORMULA_START.test(s)) s = `'${s}`;
  }
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Tabellen som CSV-text (utan BOM). */
export function toCsv(columns: readonly CsvColumn[], rows: readonly CsvRow[]): string {
  const head = columns.map((c) => c.key).join(CSV_SEPARATOR);
  const lines = rows.map((r) => columns.map((c) => csvCell(c.type, r[c.key])).join(CSV_SEPARATOR));
  return [head, ...lines].map((l) => `${l}${CSV_NEWLINE}`).join("");
}
