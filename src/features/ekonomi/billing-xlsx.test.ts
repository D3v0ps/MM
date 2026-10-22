// Excel-filen med fakturaunderlaget (reservvägen, SPEC §7.15): bladen och rubrikerna, summorna (öre → kronor utan glidning,
// samma som fakturakörningen), statusen (stoppad av referensen eller av ett exempelpris, väntar, klar, skapad), inga namn och
// bara ekonomen får exportera (loggas som export.billing med format xlsx). Körs genom samma execute() som appen och prototypen,
// mot testdatat i minnet (behörighet via policy.ts).
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import "@/api/handlers";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { base64ToBytes } from "@/core/export/base64";
import { entryText, readZip } from "@/core/export/read-zip.test-helper";
import { XLSX_MIME } from "@/core/export/xlsx";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START, decodeTestPnr, normalizePnr } from "@/data/seed";
import type { TableName, Tables } from "@/data/schema";
import { billingApproveZeroWeek, billingExportXlsx, ekoPreview, ekoRun, invoiceSetBuyerRef } from "./api";
import { LINE_COLUMNS, oreToKr } from "./billing-xlsx";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});

const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
const lars = () => as("u-lars", "ekonom");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cmd = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor = lars()) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const qry = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor = lars()) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const rows = <N extends TableName>(name: N): Tables[N][] => rt.store.rows(name);
const JAN = "inv-c-bot-2027-01-avtal";

// ---------------------------------------------------------------- Läs tillbaka filen (som Excel läser den)
type Cell = string | number | null;
type Sheet = { xml: string; grid: Cell[][]; styles: Map<string, string> };
const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

async function readWorkbook(content: string): Promise<{ names: string[]; sheets: Record<string, Sheet>; all: string }> {
  const es = await readZip(base64ToBytes(content));
  const names = [...entryText(es, "xl/workbook.xml").matchAll(/<sheet name="([^"]+)"/g)].map((m) => unxml(m[1]));
  const sheets: Record<string, Sheet> = {};
  names.forEach((name, i) => {
    const xml = entryText(es, `xl/worksheets/sheet${i + 1}.xml`);
    const grid: Cell[][] = [];
    const styles = new Map<string, string>();
    for (const m of xml.matchAll(/<c r="([A-Z]+)(\d+)"( s="(\d+)")?( t="inlineStr")?>(.*?)<\/c>/g)) {
      const [, col, row, , style, inline, body] = m;
      const r = Number(row) - 1;
      const c = colIndex(col);
      grid[r] ??= [];
      grid[r][c] = inline ? unxml(/<t xml:space="preserve">([\s\S]*)<\/t>/.exec(body)![1]) : Number(/<v>(.*)<\/v>/.exec(body)![1]);
      if (style) styles.set(`${col}${row}`, style);
    }
    for (let r = 0; r < grid.length; r++) grid[r] = Array.from({ length: grid[r]?.length ?? 0 }, (_, c) => grid[r]?.[c] ?? null);
    sheets[name] = { xml, grid, styles };
  });
  return { names, sheets, all: es.map((e) => new TextDecoder().decode(e.data)).join("\n") };
}
/** Värdet bredvid etiketten i ett block på bladet Faktura (från och med raden `from`). */
const valueOf = (grid: Cell[][], label: string, from = 0): Cell => grid.slice(from).find((r) => r?.[0] === label)?.[1] ?? null;
const blockStarts = (grid: Cell[][]): number[] => grid.flatMap((r, i) => (r?.[0] === "Faktura" ? [i] : []));

async function exportFile(month: string, actor: Actor = lars()) {
  const r = await cmd(billingExportXlsx, { month }, actor);
  if (!r.ok) throw new Error(r.message);
  return { ...r, wb: await readWorkbook(r.content) };
}

/** Namn och personnummer på deltagarna – får aldrig finnas i filen. */
function expectNoPersonalData(text: string) {
  const digits = text.replace(/\D/g, "");
  for (const p of rows("persons")) {
    for (const n of [p.firstName, p.lastName].filter((x) => x && x.length >= 4)) expect(new RegExp(`\\b${n}\\b`).test(text), `namnet ${n}`).toBe(false);
    const pnr = normalizePnr(decodeTestPnr(p.personnummerEnc));
    if (pnr) expect(digits.includes(pnr), "personnummer").toBe(false);
  }
}

async function approveZeroWeeks(month: string) {
  const v = await qry(ekoRun, { month });
  for (const l of v.invoices.flatMap((x) => x.lines).filter((x) => x.needsApproval)) {
    for (const ch of l.checks.filter((c) => c.kind === "zero_week" && c.severity === "needs_approval")) {
      await cmd(billingApproveZeroWeek, { month, caseId: l.caseId, weekKey: ch.weekKey!, note: "Kontrollerat med samordnaren." });
    }
  }
}

describe("Excel-filen med fakturaunderlaget", () => {
  it("bladen Faktura, Fakturarader och Om underlaget – rubriker, låst rubrikrad, autofilter, kronor och samma summor som körningen", async () => {
    const run = await qry(ekoRun, { month: "2027-01" });
    const f = await exportFile("2027-01");
    expect(f.filename).toBe("fakturaunderlag-2027-01.xlsx");
    expect(f.mime).toBe(XLSX_MIME);
    expect([f.invoices, f.rows]).toEqual([1, 124]);
    const { names, sheets, all } = f.wb;
    expect(names).toEqual(["Faktura", "Fakturarader", "Om underlaget"]);
    // Ingen formel någonstans – text är alltid text.
    expect(all).not.toMatch(/<f[ >]/);

    // Fakturarader: rubrikraden exakt, låst och med autofilter; en rad per ärende.
    const lines = sheets.Fakturarader;
    expect(lines.grid[0]).toEqual([...LINE_COLUMNS]);
    expect(LINE_COLUMNS).toEqual([
      "Faktura", "Er referens", "Ert ordernummer", "Artikelnummer", "Benämning", "Antal", "Enhet", "À-pris exkl. moms", "Moms %", "Belopp exkl. moms", "Anmärkning",
      "Anmärkningar för ekonomen",
    ]);
    expect(lines.xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(lines.xml).toContain('<autoFilter ref="A1:L125"/>');
    const data = lines.grid.slice(1);
    expect(data).toHaveLength(124);
    const inv = run.invoices[0];
    // Raderna i samma ordning som fakturan, med artikel, benämning (radtext + avtalsområde), veckor, à-pris och belopp i kronor.
    data.forEach((r, i) => {
      const l = inv.lines[i];
      expect(r[0]).toBe("Faktura januari 2027");
      expect(r[1]).toBeNull();
      expect(r[2]).toBeNull();
      expect(r[3]).toBe(l.articleNo);
      expect(r[4]).toBe(`${l.lineText} · ${l.areaName}`);
      expect(r[5]).toBe(l.quantity);
      expect(r[6]).toBe("vecka");
      expect(r[7]).toBe(l.unitPriceOre / 100);
      expect(r[8]).toBe(l.vatRate);
      expect(r[9]).toBe(l.amountOre / 100);
      expect(String(r[10])).toMatch(new RegExp(`^Beställning ${l.caseNumber}: `));
    });
    // Kronor med två decimaler (stil 4) i à-pris och belopp.
    expect(lines.styles.get("H2")).toBe("4");
    expect(lines.styles.get("J2")).toBe("4");
    // Summan av raderna i öre är exakt fakturans – ingen avrundningsglidning.
    expect(data.reduce((s, r) => s + Math.round((r[9] as number) * 100), 0)).toBe(inv.amountOre);
    expect(data.reduce((s, r) => s + (r[5] as number), 0)).toBe(inv.quantity);
    // Anmärkningar för ekonomen: veckor utan närvaro och saknad närvaro (bara för ekonomen – inte på fakturan).
    const remarks = data.map((r) => String(r[11] ?? ""));
    expect(remarks.some((x) => /^Ingen närvaro v\. \d+ 2027/.test(x))).toBe(true);
    expect(remarks.some((x) => x.includes("Närvaro saknas"))).toBe(true);
    expect(data.find((r) => String(r[4]).startsWith("BOT-26-0143 "))).toBeTruthy();

    // Faktura: ett block med fälten som i Fortnox och summorna.
    const g = sheets.Faktura.grid;
    expect(blockStarts(g)).toEqual([0]);
    expect(valueOf(g, "Faktura")).toBe("Faktura januari 2027");
    expect(valueOf(g, "Avtal")).toBe("332026110 (dnr AVN/2026:00048)");
    expect(valueOf(g, "Period")).toBe("Januari 2027 · v. 1–4 2027 (4 jan 2027 – 31 jan 2027)");
    expect(valueOf(g, "Status")).toBe("Stoppad – beställarreferens saknas. Dessutom: veckor utan närvaro ska godkännas i Miljonmatch");
    expect(valueOf(g, "Er referens")).toBeNull();
    expect(valueOf(g, "Ert ordernummer")).toBeNull();
    expect(valueOf(g, "Kund")).toBe("Botkyrka kommun (org.nr 212000-2882)");
    expect(valueOf(g, "Kundnummer i Fortnox")).toBeNull();
    expect(g.some((r) => r?.[0] === "Kundnummer i Fortnox")).toBe(true);
    expect(valueOf(g, "Betalningsvillkor")).toBe("30 dagar");
    expect(valueOf(g, "Antal rader")).toBe(124);
    expect(valueOf(g, "Veckor")).toBe(356);
    expect(valueOf(g, "Summa exkl. moms")).toBe(511332);
    expect(run.totalOre).toBe(51133200);
    expect(valueOf(g, "Moms 25 %")).toBe(inv.vat[0].vatOre / 100);
    const preview = (await qry(ekoPreview, { month: "2027-01", invoiceId: JAN })).preview!;
    expect(valueOf(g, "Öresavrundning")).toBe(preview.roundingOre / 100);
    expect(valueOf(g, "Att betala")).toBe(preview.grossRoundedOre / 100);
    expect(valueOf(g, "Fakturatext")).toBe(preview.invoiceText);
    const sumRow = g.findIndex((r) => r?.[0] === "Summa exkl. moms") + 1;
    expect(sheets.Faktura.styles.get(`B${sumRow}`)).toBe("4");

    // Om underlaget: avtalet, månaden, reglerna och hur filen används i Fortnox.
    const about = sheets["Om underlaget"].grid.map((r) => r.filter((x) => x !== null).join(" | ")).join("\n");
    for (const s of [
      "Fakturaunderlag januari 2027", "332026110 (dnr AVN/2026:00048), Botkyrka kommun", "Januari 2027: v. 1–4 2027", "Debiterbar vecka", "Torsdagsregeln", "En faktura per avtal och månad",
      "Er referens = beställarreferensen", "Ert ordernummer lämnas tomt", "Peppol", "Markera som manuellt fakturerad", "Anmärkningar för ekonomen",
    ]) {
      expect(about, s).toContain(s);
    }
    expect(about).toMatch(/Exporterad \| \d+ [a-z]+ \d{4} kl\. \d{2}:\d{2}/);
    expectNoPersonalData(all);
  });

  it("exporten loggas som export.billing med format xlsx – bara antal, inga ärendenummer eller belopp", async () => {
    const before = rows("audit_log").length;
    await exportFile("2027-01");
    const log = rows("audit_log").slice(before);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "export.billing", entity: "billing_run", entityId: "2027-01", actorId: "u-lars", contractId: "c-bot" });
    expect(log[0].details).toEqual({ format: "xlsx", invoices: 1, rows: 124 });
  });

  it("bara ekonomen får exportera: alla andra roller nekas på servern och ingenting loggas", async () => {
    const before = rows("audit_log").filter((l) => l.action === "export.billing").length;
    for (const who of [
      as("u-karin", "chef"), as("u-johan", "avtalsansvarig"), as("u-robin", "admin"), as("u-sara", "samordnare"), as("k-maria", "kommun_handlaggare"),
    ]) {
      await expect(cmd(billingExportXlsx, { month: "2027-01" }, who), who.role).rejects.toBeInstanceOf(ApiError);
    }
    const coach = listPersonas(rt.raw()).find((p) => p.actor.role === "coach")?.actor;
    expect(coach).toBeTruthy();
    await expect(cmd(billingExportXlsx, { month: "2027-01" }, coach!)).rejects.toBeInstanceOf(ApiError);
    expect(rows("audit_log").filter((l) => l.action === "export.billing")).toHaveLength(before);
  });

  it("exempelpris stoppar fakturan: statusen säger det och raderna har Exempelpris bland anmärkningarna", async () => {
    rt.store.updateRow("price_items", "pi-G", { exampleOnly: true });
    await cmd(invoiceSetBuyerRef, { month: "2027-01", invoiceId: JAN, reference: "55102938" });
    await approveZeroWeeks("2027-01");
    const { sheets } = (await exportFile("2027-01")).wb;
    expect(valueOf(sheets.Faktura.grid, "Status")).toBe("Stoppad – exempelpris i prislistan (avtalsområde G)");
    expect(valueOf(sheets.Faktura.grid, "Er referens")).toBe("55102938");
    const g = sheets.Fakturarader.grid.slice(1).filter((r) => r[3] === "BOT-G");
    expect(g.length).toBeGreaterThan(0);
    expect(g.every((r) => String(r[11]).split("; ").includes("Exempelpris"))).toBe(true);
    expect(g.every((r) => r[1] === "55102938")).toBe(true);
  });

  it("klar att skapa när referensen finns och veckorna utan närvaro är godkända (godkända veckor märks som godkända)", async () => {
    await cmd(invoiceSetBuyerRef, { month: "2027-01", invoiceId: JAN, reference: "55102938" });
    await approveZeroWeeks("2027-01");
    const { sheets } = (await exportFile("2027-01")).wb;
    expect(valueOf(sheets.Faktura.grid, "Status")).toBe("Klar att skapa");
    expect(sheets.Fakturarader.grid.slice(1).some((r) => /Ingen närvaro v\. \d+ 2027 \(godkänd\)/.test(String(r[11])))).toBe(true);
  });

  it("december: fakturan som är skickad och tilläggsfakturan som returnerades – ett block per faktura och fakturanumret", async () => {
    const run = await qry(ekoRun, { month: "2026-12" });
    const { sheets } = (await exportFile("2026-12")).wb;
    const g = sheets.Faktura.grid;
    const starts = blockStarts(g);
    expect(starts).toHaveLength(run.invoices.length);
    expect(starts.map((i) => g[i][1])).toEqual(run.invoices.map((x) => x.title));
    expect(run.invoices.map((x) => x.title)).toContain("Tilläggsfaktura 2 · december 2026");
    run.invoices.forEach((inv, k) => {
      expect(valueOf(g, "Summa exkl. moms", starts[k])).toBe(oreToKr(inv.amountOre));
      expect(valueOf(g, "Antal rader", starts[k])).toBe(inv.lines.length);
    });
    const statuses = starts.map((i) => String(valueOf(g, "Status", i)));
    expect(statuses[0]).toMatch(/^Skickad \(Peppol\), fakturanummer \d+$/);
    expect(statuses.some((s) => s.startsWith("Returnerad av kommunen") && s.includes("krediteras och görs om") && s.includes("beställarreferensen är fel eller spärrad"))).toBe(true);
    // Raderna: alla fakturornas rader, med fakturans namn på varje rad.
    const data = sheets.Fakturarader.grid.slice(1);
    expect(data).toHaveLength(run.invoices.reduce((n, x) => n + x.lines.length, 0));
    expect(data.filter((r) => r[0] === "Tilläggsfaktura 2 · december 2026")).toHaveLength(run.invoices.find((x) => x.number === 2)!.lines.length);
  });

  it("februari (pågår): stoppad av referensen och väntar på månadsskiftet", async () => {
    const { sheets } = (await exportFile("2027-02")).wb;
    expect(String(valueOf(sheets.Faktura.grid, "Status"))).toMatch(/^Stoppad – beställarreferens saknas\. Dessutom: .*månaden är inte slut, fakturan kan skapas från 1 mars 2027$/);
  });

  it("öre till kronor: heltal i öre delas en gång", () => {
    expect([152300, 12345, 1, 0, 51133200].map(oreToKr)).toEqual([1523, 123.45, 0.01, 0, 511332]);
  });
});
