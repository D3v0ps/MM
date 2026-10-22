// Fakturaunderlaget som Excel-fil (reservvägen, SPEC §7.15): samma fält som fakturan i Fortnox, så att ekonomen kan skriva in
// fakturan för hand eller läsa in filen med en importapp för Fortnox. Ren och isomorf (samma kod i appen, prototypen och
// testerna) – hanteraren ekonomi.billingExportXlsx samlar månadens fakturor och loggar exporten.
//
// Bladen:
//   Faktura         ett block per faktura i månaden (månadens faktura och eventuella tilläggsfakturor): status, Er referens,
//                   Ert ordernummer, betalningsvillkor, antal rader och veckor, summa exkl. moms, moms per sats och att betala.
//   Fakturarader    en rad per fakturarad (ett ärende): artikel, benämning, antal veckor, à-pris, moms och radens anmärkning.
//                   Låst rubrikrad och autofilter.
//   Om underlaget   avtalet, månaden, när filen exporterades, reglerna och hur filen används i Fortnox.
//
// Beloppen räknas i öre (heltal) och delas med 100 en gång per cell – summorna är exakt fakturakörningens. Text skrivs alltid
// som text (aldrig formel, src/core/export/xlsx.ts). Inga namn eller personnummer: ärendenumret är faktureringsobjekt.
import { monthEnded, type MonthInvoice } from "@/core/billing";
import { buildXlsx, type XlsxCell, type XlsxSheet } from "@/core/export/xlsx";
import { areaName, invoiceStatusLabel } from "@/core/labels";
import { addMonths, dayOf, fmtDate, fmtDateFull, weekMonday, weeksOfMonth, type LocalDateTime, type MonthKey } from "@/core/time";
import type { ContractArea } from "@/data/schema";
import { invoiceText, invoiceTotals, monthLabel, monthRules, periodOf, plural, weekText } from "./model";

export const BILLING_XLSX_SHEETS = ["Faktura", "Fakturarader", "Om underlaget"] as const;

/** Rubrikerna på bladet Fakturarader (samma namn som fälten i Fortnox där de finns). */
export const LINE_COLUMNS = [
  "Faktura", "Er referens", "Ert ordernummer", "Artikelnummer", "Benämning", "Antal", "Enhet", "À-pris exkl. moms", "Moms %", "Belopp exkl. moms", "Anmärkning",
  "Anmärkningar för ekonomen",
] as const;
const COL = Object.fromEntries(LINE_COLUMNS.map((c, i) => [c, i])) as Record<(typeof LINE_COLUMNS)[number], number>;

/** Enheten på raden: priset gäller per deltagare och vecka. */
export const LINE_UNIT = "vecka";

export type BillingXlsxInvoice = {
  inv: MonthInvoice;
  /** "Faktura januari 2027", "Tilläggsfaktura 2 · december 2026". */
  title: string;
  /** Radens anmärkning (Peppol BT-127, upparbetat och återstående) per ärende-id. En fryst rad har sin sparade text. */
  notes: Readonly<Record<string, string>>;
};

export type BillingXlsxInput = {
  month: MonthKey;
  /** När filen exporterades (Stockholmstid). Styr också "månaden är inte slut". */
  now: LocalDateTime;
  contract: { contractNumber: string; dnr: string | null };
  customer: { name: string; orgNr: string };
  /** Kundnumret i Fortnox ur avtalskonfigurationen. null = avtalet har inget kundnummer – cellen lämnas tom. */
  customerNumber: string | null;
  paymentTermsDays: number;
  /** En faktura per avtal och månad (true) eller per ärende och månad (false). */
  perContract: boolean;
  areas: readonly Pick<ContractArea, "code" | "name">[];
  invoices: readonly BillingXlsxInvoice[];
};

/** Öre → kronor som tal (två decimaler i filen). Heltal i öre delas en gång – ingen avrundningsglidning. */
export const oreToKr = (ore: number): number => ore / 100;

// ---------------------------------------------------------------- Fakturans status i klartext
/** Områdena i klartext: "G", "A och C", "A, C och K". */
const areaList = (codes: readonly string[]): string => (codes.length <= 1 ? (codes[0] ?? "") : `${codes.slice(0, -1).join(", ")} och ${codes[codes.length - 1]}`);

const PRICE_STOP: Record<string, string> = { example: "exempelpris i prislistan", missing: "pris saknas i prislistan", zero: "priset är 0 kr i prislistan" };

/** Varför fakturan är stoppad, i den ordning ekonomen rättar: beställarreferensen, inköpsordernumret och priserna. */
export function stopReasons(inv: Pick<MonthInvoice, "checks" | "lines" | "buyerReference">): string[] {
  const kinds = new Set(inv.checks.filter((c) => c.severity === "blocking").map((c) => c.kind));
  const out: string[] = [];
  if (kinds.has("buyer_ref")) out.push(String(inv.buyerReference ?? "").trim() ? "beställarreferensen är fel eller spärrad" : "beställarreferens saknas");
  if (kinds.has("po")) out.push("inköpsordernumret har fel format");
  if (kinds.has("po_mixed")) out.push("ärendena har olika inköpsordernummer");
  if (kinds.has("price")) {
    for (const problem of ["example", "missing", "zero"] as const) {
      const codes = [...new Set(inv.lines.filter((l) => !l.frozen && l.priceProblem === problem).map((l) => l.areaCode ?? "").filter(Boolean))].sort();
      if (inv.lines.some((l) => !l.frozen && l.priceProblem === problem)) out.push(`${PRICE_STOP[problem]}${codes.length ? ` (avtalsområde ${areaList(codes)})` : ""}`);
    }
  }
  return out;
}

/**
 * Fakturans status i filen: vad som gäller för att skapa den. Skapad (i Fortnox eller manuellt) med fakturanumret; annars
 * "Stoppad – …" med orsaken, "Väntar – …" (veckor utan närvaro att godkänna, månaden är inte slut) eller "Klar att skapa".
 */
export function exportStatus(inv: MonthInvoice, now: LocalDateTime): string {
  const stops = stopReasons(inv);
  if (inv.created) {
    const no = inv.fortnoxNo || inv.manualInvoiceNo;
    const base = `${invoiceStatusLabel(inv.storedStatus)}${no ? `, fakturanummer ${no}` : ""}`;
    if (inv.storedStatus === "returned") return `${base} – krediteras och görs om${stops.length ? ` (${stops.join(", ")})` : ""}`;
    return base;
  }
  const waits = [
    inv.needsApproval && "veckor utan närvaro ska godkännas i Miljonmatch",
    !monthEnded(inv.month, now) && `månaden är inte slut, fakturan kan skapas från ${fmtDateFull(`${addMonths(inv.month, 1)}-01`)}`,
  ].filter((x): x is string => !!x);
  if (stops.length) return `Stoppad – ${stops.join(", ")}${waits.length ? `. Dessutom: ${waits.join(", ")}` : ""}`;
  // En ny stoppande kontroll som inte har någon text här ska aldrig bli "Klar att skapa".
  if (inv.blocked) return "Stoppad – se fakturakörningen i Miljonmatch";
  if (waits.length) return `Väntar – ${waits.join(", ")}`;
  return inv.storedStatus === "approved" ? "Godkänd – klar att skapa" : "Klar att skapa";
}

/** Radens kontroller för ekonomen (inte till kommunen): "Närvaro saknas v. 3 2027; Exempelpris". */
export function lineRemarks(l: MonthInvoice["lines"][number]): string {
  return l.checks.map((c) => (c.severity === "approved" ? `${c.label} (godkänd)` : c.label)).join("; ");
}

/** Benämningen på raden: radtexten (ärendenummer och veckor) och avtalsområdet – "BOT-26-0143 · v. 1–4 2027 · G Lager och logistik". */
export function rowDescription(l: Pick<MonthInvoice["lines"][number], "lineText" | "areaCode">, areas: BillingXlsxInput["areas"]): string {
  return l.areaCode ? `${l.lineText} · ${areaName(areas, l.areaCode)}` : l.lineText;
}

/** Fakturans period: månaden, veckorna och datumen ("Januari 2027 · v. 1–4 2027 (4 jan 2027 – 31 jan 2027)"). */
export function invoicePeriod(inv: Pick<MonthInvoice, "month" | "lines">): string {
  const byKey = new Map(inv.lines.flatMap((l) => l.weeks).map((w) => [w.key, w]));
  const weeks = [...byKey.values()].sort((a, x) => (a.monday < x.monday ? -1 : a.monday > x.monday ? 1 : 0));
  const [from, to] = periodOf(weeks);
  return weeks.length ? `${monthLabel(inv.month)} · ${weekText(weeks)} (${fmtDate(from)} – ${fmtDate(to)})` : monthLabel(inv.month);
}

// ---------------------------------------------------------------- Bladen
function invoiceSheet(input: BillingXlsxInput): XlsxSheet {
  const rows: XlsxCell[][] = [];
  const boldRows: number[] = [];
  const moneyCells: [number, number][] = [];
  const money = (label: string, ore: number) => {
    moneyCells.push([rows.length, 1]);
    rows.push([label, oreToKr(ore)]);
  };
  for (const { inv, title } of input.invoices) {
    if (rows.length) rows.push([]);
    boldRows.push(rows.length);
    rows.push(["Faktura", title]);
    rows.push(["Avtal", `${input.contract.contractNumber}${input.contract.dnr ? ` (dnr ${input.contract.dnr})` : ""}`]);
    rows.push(["Period", invoicePeriod(inv)]);
    rows.push(["Status", exportStatus(inv, input.now)]);
    rows.push(["Er referens", inv.buyerReference || null]);
    rows.push(["Ert ordernummer", inv.purchaseOrderNumber || null]);
    rows.push(["Kund", `${input.customer.name}${input.customer.orgNr ? ` (org.nr ${input.customer.orgNr})` : ""}`]);
    rows.push(["Kundnummer i Fortnox", input.customerNumber || null]);
    rows.push(["Betalningsvillkor", `${input.paymentTermsDays} dagar`]);
    rows.push(["Antal rader", inv.lines.length]);
    rows.push(["Veckor", inv.quantity]);
    money("Summa exkl. moms", inv.amountOre);
    for (const v of inv.vat) money(`Moms ${v.rate} %`, v.vatOre);
    const t = invoiceTotals(inv);
    money("Öresavrundning", t.roundingOre);
    money("Att betala", t.grossRoundedOre);
    rows.push([
      "Fakturatext",
      invoiceText({ contractNumber: input.contract.contractNumber, month: inv.month, lines: inv.lines.length, weeks: inv.quantity, number: inv.number, perContract: input.perContract }),
    ]);
  }
  if (!rows.length) rows.push([`Inga fakturor för ${monthLabel(input.month).toLowerCase()}.`]);
  return { name: "Faktura", rows, boldRows, moneyCells, widths: [24, 90], wrapFromRow: 0 };
}

function linesSheet(input: BillingXlsxInput): XlsxSheet {
  const rows: XlsxCell[][] = [[...LINE_COLUMNS]];
  for (const { inv, title, notes } of input.invoices) {
    for (const l of inv.lines) {
      const r: XlsxCell[] = new Array(LINE_COLUMNS.length).fill(null);
      r[COL.Faktura] = title;
      r[COL["Er referens"]] = inv.buyerReference || null;
      r[COL["Ert ordernummer"]] = inv.purchaseOrderNumber || null;
      r[COL.Artikelnummer] = l.articleNo || null;
      r[COL.Benämning] = rowDescription(l, input.areas);
      r[COL.Antal] = l.quantity;
      r[COL.Enhet] = LINE_UNIT;
      r[COL["À-pris exkl. moms"]] = oreToKr(l.unitPriceOre);
      r[COL["Moms %"]] = l.vatRate;
      r[COL["Belopp exkl. moms"]] = oreToKr(l.amountOre);
      r[COL.Anmärkning] = notes[l.caseId] || null;
      r[COL["Anmärkningar för ekonomen"]] = lineRemarks(l) || null;
      rows.push(r);
    }
  }
  return {
    name: "Fakturarader", header: true, rows, wrapFromRow: 1, moneyColumns: [COL["À-pris exkl. moms"], COL["Belopp exkl. moms"]],
    widths: [26, 12, 15, 13, 46, 8, 8, 15, 8, 16, 80, 40],
  };
}

function aboutSheet(input: BillingXlsxInput): XlsxSheet {
  const { month } = input;
  const rules = monthRules(month);
  const invs = input.invoices.map((x) => x.inv);
  const lines = invs.reduce((n, x) => n + x.lines.length, 0);
  const weeks = invs.reduce((n, x) => n + x.quantity, 0);
  const created = invs.filter((x) => x.created).length;
  const rows: XlsxCell[][] = [];
  const boldRows: number[] = [];
  const heading = (text: string) => {
    if (rows.length) rows.push([]);
    boldRows.push(rows.length);
    rows.push([text]);
  };
  heading(`Fakturaunderlag ${monthLabel(month).toLowerCase()}`);
  rows.push(["Avtal", `${input.contract.contractNumber}${input.contract.dnr ? ` (dnr ${input.contract.dnr})` : ""}, ${input.customer.name}`]);
  const monthWeeks = weeksOfMonth(month).map((w) => ({ ...w, monday: weekMonday(w.key) }));
  rows.push(["Månad", `${monthLabel(month)}: ${weekText(monthWeeks)} (veckorna vars torsdag infaller i månaden)`]);
  rows.push(["Exporterad", `${fmtDate(dayOf(input.now))} kl. ${input.now.slice(11, 16)} ur fakturakörningen i Miljonmatch`]);
  rows.push([
    "Innehåll",
    `${plural(invs.length, "faktura", "fakturor")}, ${plural(lines, "rad", "rader")} och ${plural(weeks, "vecka", "veckor")}.${created ? ` ${plural(created, "faktura är", "fakturor är")} redan ${created === 1 ? "skapad" : "skapade"} – se Status.` : ""}`,
  ]);

  heading("Regler");
  rows.push(["Debiterbar vecka", "Varje ISO-vecka med minst en inskriven dag mellan ärendets start och avslut. Veckor med uppehåll (pausade veckor) räknas inte. En delvis vecka räknas som en hel."]);
  rows.push(["Torsdagsregeln", ["En vecka faktureras i den månad där veckans torsdag infaller. Varje vecka faktureras en gång.", ...rules.notes].join(" ")]);
  rows.push([
    input.perContract ? "En faktura per avtal och månad" : "En faktura per ärende och månad",
    input.perContract
      ? "Månadens faktura har en rad per ärende. Ärendenumret är faktureringsobjekt. Veckor som registreras efter att fakturan skapats kommer på en tilläggsfaktura för samma månad."
      : "Varje ärende har en egen faktura för månaden. Ärendenumret är faktureringsobjekt. Veckor som registreras efter att fakturan skapats kommer på en tilläggsfaktura.",
  ]);
  rows.push(["Belopp", "Kronor exklusive moms, med två decimaler. Antal = veckor och À-pris = pris per deltagare och vecka enligt prislistan. Momsen räknas per momssats på fakturans summa. Summorna är desamma som i fakturakörningen."]);
  rows.push(["Personuppgifter", "Filen har bara ärendenummer – inga namn och inga personnummer. Spara den inte utanför ekonomins mappar."]);

  heading("Så här gör du i Fortnox");
  const steps = [
    "Skapa bara fakturor med status Klar att skapa (eller Godkänd – klar att skapa). En stoppad faktura rättas först i fakturakörningen i Miljonmatch. Exportera sedan filen på nytt.",
    `Skapa en kundfaktura till ${input.customer.name} med uppgifterna på fliken Faktura.`,
    "Er referens = beställarreferensen från fliken Faktura. Den krävs – fakturan får inte skapas utan den.",
    "Ert ordernummer lämnas tomt när cellen är tom. Skriv aldrig ärendenumret där – fältet är bara för kommunens eget inköpsordernummer.",
    "Lägg in en rad per rad på fliken Fakturarader: Artikelnummer, Benämning, Antal, Enhet, À-pris och Moms. Anmärkningen är radens anmärkning (upparbetat och återstående på beställningen).",
    "Kontrollera att summan exklusive moms och att betala stämmer med fliken Faktura.",
    "Skicka fakturan som e-faktura (Peppol) – inte som e-post eller papper.",
    "Gå tillbaka till fakturakörningen i Miljonmatch och välj Markera som manuellt fakturerad med fakturanumret från Fortnox. Då skapas fakturan inte igen.",
  ];
  steps.forEach((s, i) => rows.push([`Steg ${i + 1}`, s]));

  heading("Kolumnerna på fliken Fakturarader");
  const desc: Record<(typeof LINE_COLUMNS)[number], string> = {
    Faktura: "Fakturan som raden hör till (fliken Faktura).",
    "Er referens": "Kommunens beställarreferens för fakturan. Tom = saknas – fakturan är stoppad.",
    "Ert ordernummer": "Kommunens inköpsordernummer. Oftast tomt.",
    Artikelnummer: "Artikeln i Fortnox för ärendets avtalsområde.",
    Benämning: "Ärendenummer, veckor och avtalsområde. Inga namn.",
    Antal: "Antal debiterbara veckor på raden.",
    Enhet: "Vecka (pris per deltagare och vecka).",
    "À-pris exkl. moms": "Pris per vecka i kronor enligt prislistan.",
    "Moms %": "Momssatsen för artikeln.",
    "Belopp exkl. moms": "Antal × à-pris i kronor.",
    Anmärkning: "Radens anmärkning på fakturan: beställningen i veckor, denna rad, tidigare fakturerat, upparbetat och återstående (Botkyrkas fakturavillkor).",
    "Anmärkningar för ekonomen": "Kontroller att titta på innan fakturan skapas, t.ex. närvaro saknas, vecka utan närvaro eller exempelpris. Skrivs inte på fakturan.",
  };
  for (const c of LINE_COLUMNS) rows.push([c, desc[c]]);
  return { name: "Om underlaget", rows, boldRows, widths: [30, 100], wrapFromRow: 1 };
}

/** Bladen i filen (exporteras för testerna). */
export function billingWorkbook(input: BillingXlsxInput): XlsxSheet[] {
  return [invoiceSheet(input), linesSheet(input), aboutSheet(input)];
}

/** Excel-filen med månadens fakturaunderlag. */
export async function billingXlsx(input: BillingXlsxInput): Promise<Uint8Array> {
  return buildXlsx(billingWorkbook(input), { date: input.now });
}

/** Filnamnet: fakturaunderlag-2027-01.xlsx (samma som CSV-filen, bara ändelsen skiljer). */
export const billingXlsxFilename = (month: MonthKey): string => `fakturaunderlag-${month}.xlsx`;
