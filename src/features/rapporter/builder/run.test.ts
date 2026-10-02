// Rapportbyggarens motor (Del B4): gruppering, tidsuppdelning, Totalt, kommunens läge ("färre än N", inget internt mål),
// noterna, kopplingen för avslut och vad som är "tomt".
import { describe, expect, it } from "vitest";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { cfgWith } from "@/core/test-data";
import type { ExportRow } from "../export";
import type { MonthlyFacts } from "../facts";
import { MISSING_LABEL } from "./catalog";
import type { ReportDefinition } from "./definition";
import { AREAS, aRow, hRow, mkExp, mRow, pRow, summaryDef } from "./fixtures.test-helper";
import { monthsLabel, runDefinition, timePart, type BuilderView, type RunInput } from "./run";
import { TEMPLATES } from "./templates";

const period = { from: "2026-10", to: "2027-01" };
const run = (def: ReportDefinition, tables: Parameters<typeof mkExp>[0], over: Partial<RunInput> = {}) =>
  runDefinition({ exp: mkExp(tables), joinFacts: new Map(), def, period, audience: "mb", cfg: BOTKYRKA_CONFIG, areas: AREAS, title: "Test", ...over });
const view = (r: ReturnType<typeof run>): BuilderView => {
  if (!r.ok) throw new Error(r.message);
  return r.view;
};
/** n deltagare (olika ärendenummer från start) i området, en rad var för månaden. */
const people = (start: number, n: number, manad: string, p: Partial<ExportRow> = {}) => Array.from({ length: n }, (_, i) => mRow(start + i, manad, p));

describe("tidsdelar", () => {
  it("kalenderkvartal och halvår klipps vid perioden; etiketten är månaderna som ingår", () => {
    const p = { from: "2026-11", to: "2027-02" };
    expect(timePart("2026-11", "kvartal", p)).toEqual({ from: "2026-11", to: "2026-12", label: "november–december 2026" });
    expect(timePart("2027-02", "kvartal", p)).toEqual({ from: "2027-01", to: "2027-02", label: "januari–februari 2027" });
    expect(timePart("2027-01", "halvar", { from: "2026-09", to: "2027-06" })).toEqual({ from: "2027-01", to: "2027-06", label: "januari–juni 2027" });
    expect(timePart("2026-12", "manad", p)).toEqual({ from: "2026-12", to: "2026-12", label: "december 2026" });
    expect(timePart("2026-10", "inget", p)).toBeNull();
    expect(monthsLabel("2026-10", "2026-10")).toBe("oktober 2026");
  });
});

describe("sammanställning", () => {
  const rows = [
    ...people(1, 3, "2026-10", { avtalsomrade_kod: "H" }),
    ...people(10, 2, "2026-10", { avtalsomrade_kod: "G" }),
    ...people(10, 2, "2026-11", { avtalsomrade_kod: "G" }),
    mRow(20, "2026-12", { avtalsomrade_kod: null }),
    mRow(21, "2026-12", { avtalsomrade_kod: "B" }),
  ];
  it("gruppering på kod med etiketten, ordning på kod, Uppgift saknas sist och Totalt på alla rader", () => {
    const v = view(run(summaryDef({ groupBy: "avtalsomrade_kod", measures: ["deltagarmanader", "narvarograd"] }), { resultat: rows }));
    expect(v.table!.rows.map((r) => [r.group, r.groupCode, r.cases, r.cells[0]])).toEqual([
      ["B Bygg och anläggning", "B", 1, 1], ["G Lager och logistik", "G", 2, 4], ["H Vård och omsorg", "H", 3, 3], [MISSING_LABEL, "", 1, 1],
    ]);
    expect(v.table!.total).toMatchObject({ group: "Totalt", cases: 7, casesText: "7", cells: [9, 0.9], small: false });
    expect(v.counts).toEqual({ rows: 9, cases: 7, casesText: "7" });
    expect(v.table!.columns.map((c) => c.key)).toEqual(["deltagare", "deltagarmanader", "narvarograd"]);
    expect(v.table!.groupLabel).toBe("Avtalsområde");
  });
  it("uppdelning per månad och kvartal", () => {
    const m = view(run(summaryDef({ split: "manad" }), { resultat: rows }));
    expect(m.table!.rows.map((r) => [r.period, r.from, r.to, r.cases])).toEqual([["oktober 2026", "2026-10", "2026-10", 5], ["november 2026", "2026-11", "2026-11", 2], ["december 2026", "2026-12", "2026-12", 2]]);
    expect(m.table!.splitLabel).toBe("Månad");
    const q = view(run(summaryDef({ split: "kvartal", groupBy: "avtalsomrade_kod" }), { resultat: [...rows, mRow(30, "2027-01", { avtalsomrade_kod: "G" })] }));
    expect(q.table!.rows.filter((r) => r.groupCode === "G").map((r) => [r.period, r.cases])).toEqual([["oktober–december 2026", 2], ["januari 2027", 1]]);
  });
  it("högst 200 rader – annars too_many_groups", () => {
    const many = Array.from({ length: 201 }, (_, i) => mRow(i + 1, "2026-10", { yrkesspar: `Spår ${i}` }));
    const r = run(summaryDef({ groupBy: "yrkesspar" }), { resultat: many });
    expect(r).toEqual({ ok: false, error: "too_many_groups", message: "Tabellen får för många rader (högst 200). Välj färre värden eller dela upp på ett annat sätt." });
    expect(run(summaryDef({ groupBy: "yrkesspar" }), { resultat: many.slice(0, 200) }).ok).toBe(true);
  });
  it("urval: 'är en av'; inga rader efter urvalet = empty", () => {
    const v = view(run(summaryDef({ filters: { avtalsomrade_kod: ["G", "B"] } }), { resultat: rows }));
    expect(v.counts.rows).toBe(5);
    expect(run(summaryDef({ filters: { avtalsomrade_kod: ["L"] } }), { resultat: rows })).toMatchObject({ ok: false, error: "empty", message: "Det finns inga levererade rapporter för urvalet. Välj en annan period eller färre urval." });
  });
  it("noterna: tomma celler i andelar och litet underlag för resultatgraden (minN ur kpis)", () => {
    const v = view(run(summaryDef({ measures: ["narvarograd", "tydlig_progression"] }), {
      resultat: [mRow(1, "2026-10"), mRow(2, "2026-10", { narvarande: 0, franvaro_giltig: 0, bedomning_godkand: 0, progression_tydlig: null })],
    }));
    expect(v.notes).toEqual(["1 deltagarmånad har ingen registrerad närvaro och räknas inte.", "1 deltagarmånad utan godkänd bedömning räknas inte."]);
    const minN = BOTKYRKA_CONFIG.kpis.find((k) => k.key === "resultatgrad")!.minN!;
    const avslut = [...Array.from({ length: minN }, (_, i) => aRow(i + 1, "2026-11")), aRow(50, "2026-11", { resultat_kod: null, resultat_verifierat: 0 })];
    const join = new Map(avslut.map((a, i) => [String(a.arendenummer), { primaryAreaCode: i < 3 ? "H" : "G", vocationalTrack: null, referrerUnit: null }]));
    const r = view(run(summaryDef({ dataset: "avslut", groupBy: "avtalsomrade_kod", measures: ["resultatgrad"] }), { avslut }, { joinFacts: join }));
    expect(r.notes).toContain("1 avslut saknar uppgift om resultat och räknas som avslut utan resultat.");
    expect(r.notes).toContain("Räknat på levererade slutrapporter. Kan skilja sig från Ledning, som räknar på ärendena som de ser ut nu.");
    // Varför siffran skiljer sig: sena verifieringar räknas först efter en rättelse, och Lednings period.
    expect(r.notes).toContain("Ett resultat som verifierats efter att slutrapporten lämnades räknas här först när slutrapporten har rättats.");
    expect(r.notes).toContain("Ledning räknar de sex senaste hela månaderna och den pågående månaden.");
    expect(r.notes.join(" ")).not.toContain("Beställarrapporten");
    expect(r.notes).toContain(`I 2 av grupperna är underlaget litet (färre än ${minN} avslut som räknas). Jämför försiktigt.`);
    expect(r.notes).toContain("Resultatdefinitionen är inte fastställd. Resultatet är preliminärt.");
    const fixed = view(run(summaryDef({ dataset: "avslut", measures: ["resultatgrad"] }), { avslut }, { cfg: cfgWith((c) => { c.result.definition = "Arbete eller studier"; }) }));
    expect(fixed.notes.join(" ")).not.toContain("inte fastställd");
  });
  it("diagram bara med högst 20 rader – annars en not; mållinjer ur kpis", () => {
    const def = summaryDef({ dataset: "avslut", groupBy: "avslutsorsak_kod", measures: ["resultatgrad"], chart: { measure: "resultatgrad" } });
    const v = view(run(def, { avslut: [aRow(1, "2026-11"), aRow(2, "2026-11", { avslutsorsak_kod: "studier" })] }));
    expect(v.chart).toMatchObject({ measure: "resultatgrad", label: "Resultatgrad", unit: "andel", contractTarget: 0.32, internalTarget: 0.35 });
    expect(v.chart!.bars.map((b) => [b.label, b.value])).toEqual([["Arbete", 1], ["Studier", 1]]);
    const many = Array.from({ length: 21 }, (_, i) => mRow(i + 1, "2026-10", { yrkesspar: `Spår ${i}` }));
    const big = view(run(summaryDef({ groupBy: "yrkesspar", measures: ["narvarograd"], chart: { measure: "narvarograd" } }), { resultat: many }));
    expect(big.chart).toBeNull();
    expect(big.notes).toContain("Diagrammet visas när tabellen har högst 20 rader. Tabellen har alla siffror.");
    // Närvarogradens interna mål är inte fastställt i Botkyrka – inga linjer.
    const n = view(run(summaryDef({ measures: ["narvarograd"], chart: { measure: "narvarograd" }, split: "manad" }), { resultat: rows }));
    expect(n.chart).toMatchObject({ contractTarget: null, internalTarget: null });
  });
});

describe("kommunens läge", () => {
  const cfg3 = cfgWith((c) => { c.pulse.minNForAggregate = 3; });
  const rows = [...people(1, 2, "2026-10", { avtalsomrade_kod: "B" }), ...people(10, 3, "2026-10", { avtalsomrade_kod: "G" }), ...people(20, 4, "2026-11", { avtalsomrade_kod: "H", narvarande: 5, franvaro_giltig: 5 })];
  const def = summaryDef({ groupBy: "avtalsomrade_kod", measures: ["deltagarmanader", "narvarograd"], chart: { measure: "narvarograd" } });
  const k = view(run(def, { resultat: rows }, { audience: "kommun", cfg: cfg3 }));

  it("gränsen läses ur konfigurationen: 2 deltagare blir 'färre än 3', 3 visas – utan exakta antal någonstans", () => {
    const [b, g, h] = k.table!.rows;
    expect(b).toMatchObject({ group: "B Bygg och anläggning", small: true, cases: null, casesText: "färre än 3", cells: [null, null] });
    expect(g).toMatchObject({ small: false, cases: 3, casesText: "3", cells: [3, 0.9] });
    expect(h).toMatchObject({ small: false, cases: 4, casesText: "4" });
    for (const r of k.table!.rows.filter((x) => x.small)) {
      expect(r.cases).toBeNull();
      expect(r.cells.every((c) => c === null)).toBe(true);
    }
    expect(k.chart!.bars.find((x) => x.label.startsWith("B"))).toEqual({ label: "B Bygg och anläggning", value: null, small: true });
    expect(k.table!.columns[0]).toEqual({ key: "deltagare", label: "Deltagare", unit: "antal", fileKey: "deltagare" });
  });
  it("hela urvalet litet: Totalt och counts utan exakta antal", () => {
    const small = view(run(def, { resultat: people(1, 2, "2026-10") }, { audience: "kommun", cfg: cfg3 }));
    expect(small.table!.total).toMatchObject({ small: true, cases: null, casesText: "färre än 3", cells: [null, null] });
    expect(small.counts).toEqual({ rows: null, cases: null, casesText: "färre än 3" });
    // Miljonbemannings läge har alltid antalen.
    const mb = view(run(def, { resultat: people(1, 2, "2026-10") }, { cfg: cfg3 }));
    expect(mb.counts).toEqual({ rows: 2, cases: 2, casesText: "2" });
    expect(mb.table!.rows[0]).toMatchObject({ small: false, cases: 2 });
  });
  it("inget internt mål: ingen nyckel och inget värde – avtalets mål finns", () => {
    const def2 = summaryDef({ dataset: "avslut", groupBy: "avslutsorsak_kod", measures: ["resultatgrad"], chart: { measure: "resultatgrad" } });
    const avslut = Array.from({ length: 6 }, (_, i) => aRow(i + 1, "2026-11"));
    const kv = view(run(def2, { avslut }, { audience: "kommun" }));
    const json = JSON.stringify(kv);
    expect(json).not.toContain("internalTarget");
    expect(json).not.toContain("0.35");
    expect(kv.chart).toMatchObject({ contractTarget: 0.32 });
    expect("internalTarget" in kv.chart!).toBe(false);
    expect([...kv.notes, ...kv.rules].join(" ")).not.toMatch(/Ledning|Internt|interna/);
    expect(kv.notes).toContain("Räknat på levererade slutrapporter.");
    // Skillnaden mot beställarrapporten förklaras (kommunen känner till den – inte Ledning).
    expect(kv.notes).toContain("Ett resultat som verifierats efter att slutrapporten lämnades räknas här först när slutrapporten har rättats.");
    expect(kv.notes).toContain("Beställarrapporten räknar på ärendena som de såg ut när den lämnades och kan därför visa en annan resultatgrad.");
    expect(kv.rules).toEqual(["Ärenden med skyddade personuppgifter finns aldrig med.", "Bara levererade månads- och slutrapporter kommer med. Siffrorna är desamma som när rapporten lämnades."]);
    expect(kv.notes).toContain('Grupper med färre än 5 deltagare visas som "färre än 5", så att ingen kan kännas igen.');
    expect(kv.dimensionValues).toEqual({});
  });
  it("en lista har exakta antal (raderna finns ändå i filen) och inga rader i vy-modellen", () => {
    const lv = view(run(summaryDef({ output: "lista", measures: [], columns: ["resultat.arendenummer", "resultat.namn", "resultat.manad"] }), { resultat: people(1, 2, "2026-10") }, { audience: "kommun", cfg: cfg3 }));
    expect(lv.list).toEqual({ rows: 2, cases: 2, hasNames: true, columns: [{ key: "arendenummer", label: expect.any(String) }, { key: "namn", label: "Deltagarens namn" }, { key: "manad", label: "Månaden som raden gäller" }] });
    expect(JSON.stringify(lv)).not.toMatch(/BOT-26-|Testperson/);
    // Utan resultatkolumn: bara regeln om tomma celler.
    expect(lv.notes).toEqual(["Tom cell betyder att uppgiften saknas eller inte är bedömd. 0 betyder noll."]);
  });
  it("en lista med resultatkolumner har samma regler som resultatfilen (steg 3): definitionen, verifieringen och tomma celler", () => {
    const rules = [
      "Resultatdefinitionen är inte fastställd. Resultatet är preliminärt.",
      "Ett resultat räknas först när resultat_verifierat = 1. Kommer underlaget efter att slutrapporten lämnats rättar vi slutrapporten – hämta då en ny fil.",
      "Tom cell betyder att uppgiften saknas eller inte är bedömd. 0 betyder noll.",
    ];
    const av = view(run(summaryDef({ dataset: "avslut", output: "lista", measures: [], columns: ["avslut.arendenummer", "avslut.resultat", "avslut.resultat_verifierat"] }), { avslut: [aRow(1, "2026-11")] }, { audience: "kommun" }));
    expect(av.notes).toEqual(rules);
    const dm = view(run(summaryDef({ output: "lista", measures: [], columns: ["resultat.arendenummer", "resultat.resultat_kod"] }), { resultat: people(1, 2, "2026-10") }));
    expect(dm.notes).toEqual(rules);
    // Fastställd definition och utan krav på verifiering: bara regeln om tomma celler.
    const cfg = cfgWith((c) => { c.result.definition = "Arbete eller studier"; c.result.requiresVerification = false; });
    expect(view(run(summaryDef({ dataset: "avslut", output: "lista", measures: [], columns: ["avslut.arendenummer", "avslut.resultat"] }), { avslut: [aRow(1, "2026-11")] }, { cfg })).notes).toEqual([rules[2]]);
  });
});

describe("datamängderna", () => {
  it("kolumnen Deltagare finns först för alla fyra datamängder – också i mallen resultatgrad-per-omrade", () => {
    const tables = { resultat: people(1, 2, "2026-10"), avslut: [aRow(1, "2026-11")], handelser: [hRow(1, "2026-10")], progression: [pRow(1, "2026-10", "yrkesfardigheter", 2)] };
    for (const def of [summaryDef(), summaryDef({ dataset: "avslut", measures: ["avslut"] }), summaryDef({ dataset: "handelser", measures: ["handelser"] }), summaryDef({ dataset: "progression", measures: ["fordelning"] })]) {
      expect(view(run(def, tables)).table!.columns[0].key, def.dataset).toBe("deltagare");
    }
    const tpl = TEMPLATES.find((t) => t.key === "resultatgrad-per-omrade")!.definition;
    expect(view(run({ ...tpl, period: { kind: "fast", ...period } }, tables)).table!.columns.map((c) => c.key)).toEqual(["deltagare", "avslut_som_raknas", "verifierat_resultat", "preliminara", "resultatgrad"]);
  });
  it("avslut kopplas till ärendets senaste levererade månadsrapport; utan månadsrapport blir gruppen Uppgift saknas", () => {
    const join = new Map<string, Pick<MonthlyFacts, "primaryAreaCode" | "vocationalTrack" | "referrerUnit">>([["BOT-26-0001", { primaryAreaCode: "H", vocationalTrack: "Undersköterska", referrerUnit: "Arbetsmarknadsenheten Tumba" }]]);
    const v = view(run(summaryDef({ dataset: "avslut", groupBy: "avtalsomrade_kod", measures: ["avslut"] }), { avslut: [aRow(1, "2026-11"), aRow(2, "2026-11")] }, { joinFacts: join }));
    expect(v.table!.rows.map((r) => [r.group, r.cases])).toEqual([["H Vård och omsorg", 1], [MISSING_LABEL, 1]]);
    expect(v.dimensionValues).toEqual({ yrkesspar: ["Undersköterska"], bestallare_enhet: ["Arbetsmarknadsenheten Tumba"] });
  });
  it("händelser och progression kopplas till samma månadsrapport (ärendenummer och månad)", () => {
    const tables = { resultat: [mRow(1, "2026-10", { fas_nr: 3 }), mRow(1, "2026-11", { fas_nr: 4 })], handelser: [hRow(1, "2026-10"), hRow(1, "2026-11"), hRow(1, "2026-11")] };
    const v = view(run(summaryDef({ dataset: "handelser", groupBy: "fas_nr", measures: ["handelser"] }), tables));
    expect(v.table!.rows.map((r) => [r.group, r.cells[0]])).toEqual([["Yrkesspecifika moment", 1], ["Praktik (arbetsplatsförlagt lärande)", 2]]);
  });
  it("empty: avslut utan månadsrapporter i perioden är inte tomt; urval som tar bort alla rader är tomt", () => {
    expect(run(summaryDef({ dataset: "avslut", measures: ["avslut"] }), { avslut: [aRow(1, "2026-11")] }).ok).toBe(true);
    expect(run(summaryDef({ dataset: "avslut", measures: ["avslut"], filters: { avslutsorsak_kod: ["studier"] } }), { avslut: [aRow(1, "2026-11")] })).toMatchObject({ ok: false, error: "empty" });
    expect(run(summaryDef({ dataset: "handelser", measures: ["handelser"] }), { resultat: people(1, 2, "2026-10") })).toMatchObject({ ok: false, error: "empty" });
  });
});
