// Rapportbyggarens filer (Del B6): filnamnet, CSV-rubrikerna, kommunens anmärkning, formelskyddet, flikarna och storleksgränsen.
import { describe, expect, it } from "vitest";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { cfgWith } from "@/core/test-data";
import { entryText, readZip } from "@/core/export/read-zip.test-helper";
import { titleError, type ReportDefinition } from "./definition";
import { builderCsv, builderFilename, builderXlsx, fileTable, filtersText, withinLimit } from "./files";
import { AREAS, aRow, mkExp, mRow, pRow, summaryDef } from "./fixtures.test-helper";
import { runDefinition, type RunInput } from "./run";

const FILENAME = /^rapport_[a-z0-9]+_[a-z0-9-]+_\d{4}-\d{2}_\d{4}-\d{2}\.(xlsx|csv|pdf)$/;
const period = { from: "2026-10", to: "2026-12" };
function built(def: ReportDefinition, tables: Parameters<typeof mkExp>[0], over: Partial<RunInput> = {}) {
  const exp = mkExp(tables);
  const r = runDefinition({ exp, joinFacts: new Map(), def, period, audience: "mb", cfg: BOTKYRKA_CONFIG, areas: AREAS, title: "Test", ...over });
  if (!r.ok) throw new Error(r.message);
  return { exp, view: r.view, rows: r.rows };
}
const about = { title: "=SUMMA(A1)", contractNumber: "332026110", customerName: "Botkyrka kommun", now: "2027-02-01T09:12", cfg: BOTKYRKA_CONFIG, areas: AREAS };

describe("filnamnet", () => {
  it("mallens nyckel (uppslag) eller datamängden – aldrig rapportens namn", () => {
    const a = builderFilename("BOT", "resultatgrad-per-omrade", "avslut", "2026-10", "2026-12", "xlsx");
    expect(a).toBe("rapport_bot_resultatgrad-per-omrade_2026-10_2026-12.xlsx");
    expect(a).toMatch(FILENAME);
    // En godtycklig sträng i template_key (inte en mall) hamnar aldrig i filnamnet.
    expect(builderFilename("BOT", "anna-andersson", "deltagarmanader", "2026-10", "2026-12", "csv")).toBe("rapport_bot_deltagarmanader_2026-10_2026-12.csv");
    expect(builderFilename("BOT", null, "progression", "2026-10", "2026-10", "pdf")).toMatch(FILENAME);
  });
});

describe("CSV", () => {
  it("sammanställning: grupp_kod, grupp, deltagare före måtten, andelar 0–100 med decimalkomma, Totalt sist", () => {
    const { exp, view, rows } = built(summaryDef({ groupBy: "avtalsomrade_kod", measures: ["deltagarmanader", "narvarograd"] }), {
      resultat: [mRow(1, "2026-10"), mRow(2, "2026-10", { narvarande: 6, franvaro_giltig: 4 })],
    });
    const csv = builderCsv(fileTable(view, summaryDef({ groupBy: "avtalsomrade_kod", measures: ["deltagarmanader", "narvarograd"] }), exp, rows));
    expect(csv).toBe("grupp_kod;grupp;deltagare;deltagarmanader;narvarograd_procent\r\nG;G Lager och logistik;2;2;75,0\r\n;Totalt;2;2;75,0\r\n");
  });
  it("tidsuppdelning ger period_fran och period_till; fördelningen fem kolumner", () => {
    const def = summaryDef({ dataset: "progression", measures: ["fordelning"], split: "manad" });
    const { exp, view, rows } = built(def, { progression: [pRow(1, "2026-10", "yrkesfardigheter", 2), pRow(1, "2026-11", "yrkesfardigheter", null)] });
    const head = builderCsv(fileTable(view, def, exp, rows)).split("\r\n")[0];
    expect(head).toBe("grupp;period_fran;period_till;deltagare;niva_0;niva_1;niva_2;niva_3;niva_ej_bedomd");
  });
  it("kommunens läge: anmarkning sist, små grupper utan andra värden", () => {
    const def = summaryDef({ dataset: "avslut", groupBy: "avslutsorsak_kod", measures: ["avslut", "resultatgrad"] });
    const avslut = [...Array.from({ length: 5 }, (_, i) => aRow(i + 1, "2026-11")), aRow(9, "2026-11", { avslutsorsak_kod: "studier" })];
    const { exp, view, rows } = built(def, { avslut }, { audience: "kommun" });
    const lines = builderCsv(fileTable(view, def, exp, rows)).trimEnd().split("\r\n");
    expect(lines[0]).toBe("grupp_kod;grupp;deltagare;avslut;resultatgrad_procent;anmarkning");
    expect(lines[1]).toBe("arbete;Arbete;5;5;100,0;");
    expect(lines[2]).toBe("studier;Studier;;;;färre än 5 deltagare");
    expect(lines[3]).toBe(";Totalt;6;6;100,0;");
  });
  it("lista: de valda kolumnerna med registrets typer – formelskyddet följer med", () => {
    const def = summaryDef({ output: "lista", measures: [], columns: ["resultat.arendenummer", "resultat.yrkesspar", "resultat.narvaro_procent"] });
    const { exp, view, rows } = built(def, { resultat: [mRow(1, "2026-10", { yrkesspar: "=1+1", narvaro_procent: 88.9 })] });
    expect(builderCsv(fileTable(view, def, exp, rows))).toBe("arendenummer;yrkesspar;narvaro_procent\r\nBOT-26-0001;'=1+1;88,9\r\n");
    // Namnet finns bara när resultat.namn är vald.
    expect(builderCsv(fileTable(view, def, exp, rows))).not.toContain("Testperson");
  });
  it("urvalet i klarspråk", () => {
    expect(filtersText(summaryDef({ filters: { avtalsomrade_kod: ["G", "H"], fas_nr: ["4"] } }), { cfg: BOTKYRKA_CONFIG, areas: AREAS }))
      .toBe("Avtalsområde: G Lager och logistik, H Vård och omsorg; Fas: Praktik (arbetsplatsförlagt lärande)");
    expect(filtersText(summaryDef(), { cfg: BOTKYRKA_CONFIG, areas: AREAS })).toBe("Alla");
  });
});

describe("Excel", () => {
  it("flikarna Rapport och Om rapporten; namnet bara som text (inlineStr) – aldrig som formel", async () => {
    expect(titleError("=SUMMA(A1)")).toBe("Namnet kan inte börja med =, +, - eller @.");
    const def = summaryDef({ output: "lista", measures: [], columns: ["resultat.arendenummer", "resultat.namn"] });
    const { exp, view, rows } = built(def, { resultat: [mRow(1, "2026-10")] });
    const es = await readZip(await builderXlsx(view, def, exp, rows, about));
    expect(entryText(es, "xl/workbook.xml")).toMatch(/name="Rapport"[\s\S]*name="Om rapporten"/);
    const sheet1 = entryText(es, "xl/worksheets/sheet1.xml");
    const sheet2 = entryText(es, "xl/worksheets/sheet2.xml");
    expect(sheet1).toContain("<pane");
    expect(sheet1).toContain("autoFilter");
    expect(sheet1 + sheet2).not.toContain("<f>");
    expect(sheet2).toContain("=SUMMA(A1)");
    expect(sheet2).toContain('t="inlineStr"');
    for (const k of ["Rapport", "Avtal", "Uppgifter", "Period", "Urval", "Kolumner", "Visning", "Hämtad", "Schemaversion", "Fältbeskrivning"]) expect(sheet2).toContain(`>${k}<`);
    expect(sheet2).toContain("332026110, Botkyrka kommun");
    expect(sheet2).toContain("Miljonbemanning");
  });
  it("sammanställning: Om rapporten har mått, uppdelning och Så räknas det", async () => {
    const def = summaryDef({ groupBy: "avtalsomrade_kod", measures: ["narvarograd"], split: "manad" });
    const { exp, view, rows } = built(def, { resultat: [mRow(1, "2026-10")] }, { cfg: cfgWith(() => undefined) });
    const sheet2 = entryText(await readZip(await builderXlsx(view, def, exp, rows, { ...about, title: "Närvaro" })), "xl/worksheets/sheet2.xml");
    for (const k of ["Mått", "Dela upp efter", "Dela upp per tid", "Så räknas det", "Deltagare", "Närvarograd"]) expect(sheet2).toContain(k);
  });
});

describe("storleken", () => {
  it("över gränsen (en parameter – liten gräns i testet) är för stort", () => {
    expect(withinLimit("x".repeat(10), 10)).toBe(true);
    expect(withinLimit("x".repeat(11), 10)).toBe(false);
  });
});
