// Kolumnregistret för kommunens resultatfil (rapporter steg 3, Del B): Botkyrkas kolumnlista är låst för schemaversion 2,
// texterna byggs av avtalets konfiguration, källan är klarspråk, kolumnspärren och docs/RESULTATFIL.md stämmer med registret.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOTKYRKA_CONFIG, OperationalConfigSchema, type OperationalConfig } from "@/core/config";
import { createSeed } from "@/data/seed";
import { aboutRules, buildResultExport, resultCsv, resultXlsx } from "./export";
import {
  columnsStillCompatible, EXPORT_SCHEMA_VERSION, exportColumns, fieldDescriptionRows, numberWord, qualifiedKeys, tableColumns, TABLE_LABEL, type ExportTable,
} from "./export-columns";
import { entryText, readZip } from "@/core/export/read-zip.test-helper";

const areas = createSeed().contract_areas.filter((a) => a.contractId === "c-bot");
const cols = exportColumns(BOTKYRKA_CONFIG, areas);
const keys = (t: ExportTable) => tableColumns(cols, t).map((c) => c.key);

/**
 * Schemaversion 2 för Botkyrka (beslut 6, 2026-10-08: närvaron bara som veckor och närvarograd – de sex antalskolumnerna i
 * version 1 är borta). Ändras listan utan att EXPORT_SCHEMA_VERSION höjs blir testet rött.
 */
const BOTKYRKA_V2 = {
  resultat: [
    "arendenummer", "namn", "manad", "bestallare_enhet", "rapport_version", "rapport_levererad", "rattelse_pagar",
    "avtalsomrade_kod", "avtalsomrade", "avtalsomrade2_kod", "yrkesspar", "insats_start", "insats_planerat_slut", "insats_slut", "fas_nr", "fas",
    "veckor", "veckor_uppehall", "narvaro_procent", "upprepad_franvaro",
    "avstamningar_godkanda", "arbetsgivarkontakter", "veckomal_uppnatt", "veckomal_delvis", "veckomal_ej_uppnatt",
    "bedomning_godkand", "omraden_bedomda", "progression_tydlig", "progression_nagon",
    "niva_narvaro_rutiner", "niva_yrkesfardigheter", "niva_arbetskapacitet", "niva_sjalvstandighet", "niva_digital_sjalvstandighet", "niva_instruktioner",
    "niva_arbetsgivarkontakter", "niva_beredskap", "niva_sprak_kommunikation", "niva_ovrigt",
    "handelser", "handelser_verifierade", "praktik_startad", "arbete_paborjat", "studier_paborjade",
    "avvikelser_nya", "avvikelser_oppna", "kommunens_beslut_behovs", "samlad_status_kod", "samlad_status", "bedomning_datum",
    "avslut_datum", "avslutsorsak_kod", "avslutsorsak", "resultat_kod", "resultat", "resultat_verifierat",
  ],
  progression: ["arendenummer", "manad", "omrade_kod", "omrade", "niva", "niva_text"],
  handelser: ["arendenummer", "manad", "datum", "handelse_kod", "handelse", "verifierad"],
  // Tillagd efter granskningen (en ny tabell sist – inga befintliga kolumner ändrade, schemaversionen är fortfarande 1).
  avslut: [
    "arendenummer", "manad", "avslut_datum", "avslutsorsak_kod", "avslutsorsak", "resultat_kod", "resultat", "resultat_verifierat",
    "rapport_version", "rapport_levererad", "rattelse_pagar",
  ],
};

describe("kolumnregistret – schemaversion 2", () => {
  it("Botkyrkas kolumnlista är låst (56 + 6 + 6 + 11 kolumner i exakt den här ordningen)", () => {
    expect(EXPORT_SCHEMA_VERSION).toBe(2);
    expect(keys("resultat")).toEqual(BOTKYRKA_V2.resultat);
    expect(keys("resultat")).toHaveLength(56);
    expect(keys("progression")).toEqual(BOTKYRKA_V2.progression);
    expect(keys("handelser")).toEqual(BOTKYRKA_V2.handelser);
    expect(keys("avslut")).toEqual(BOTKYRKA_V2.avslut);
    for (const c of cols) expect(c.key).toMatch(/^[a-z0-9_]+$/);
    // Inga antal per tillfälle i filen (beslut 6, 2026-10-08) – närvaron är veckor och närvarograd.
    for (const k of ["tillfallen_planerade", "narvarande", "sen_ankomst", "franvaro_giltig", "franvaro_ogiltig", "ej_registrerade"]) expect(keys("resultat")).not.toContain(k);
  });

  it("källan (kalla) är klarspråk – aldrig kod", () => {
    for (const c of cols) {
      expect(c.source).not.toMatch(/facts\.|reports\.|attendance\.|goals\.|cfg|_|\([a-z]+[A-Z.]|[a-z]+[A-Z]\w*/);
    }
    const src = (k: string) => cols.find((c) => c.table === "resultat" && c.key === k)!.source;
    expect(src("arendenummer")).toBe("Månadsrapporten, avsnitt 1");
    expect(src("namn")).toBe("Ärendet i portalen");
    expect(src("manad")).toBe("Månadsrapporten (månad, version och leveransdag)");
    expect(src("veckor")).toBe("Månadsrapporten, avsnitt 2");
    expect(src("arbetsgivarkontakter")).toBe("Månadsrapporten, avsnitt 3");
    expect(src("niva_ovrigt")).toBe("Månadsrapporten, avsnitt 4");
    expect(src("studier_paborjade")).toBe("Månadsrapporten, avsnitt 5");
    expect(src("kommunens_beslut_behovs")).toBe("Månadsrapporten, avsnitt 6");
    expect(src("bedomning_datum")).toBe("Månadsrapporten, avsnitt 8");
    expect(src("resultat_verifierat")).toBe("Slutrapporten");
    expect(new Set(tableColumns(cols, "progression").map((c) => c.source))).toEqual(new Set(["Månadsrapporten, avsnitt 4"]));
    expect(new Set(tableColumns(cols, "handelser").map((c) => c.source))).toEqual(new Set(["Månadsrapporten, avsnitt 5"]));
    expect(new Set(tableColumns(cols, "avslut").map((c) => c.source))).toEqual(new Set(["Slutrapporten", "Slutrapporten (version och leveransdag)"]));
    // Avslutstabellen har samma texter som avslutskolumnerna i tabell 1.
    for (const k of ["avslutsorsak_kod", "avslutsorsak", "resultat_kod", "resultat", "resultat_verifierat"]) {
      const a = cols.find((c) => c.table === "avslut" && c.key === k)!;
      expect({ d: a.description, v: a.values }).toEqual({ d: cols.find((c) => c.table === "resultat" && c.key === k)!.description, v: cols.find((c) => c.table === "resultat" && c.key === k)!.values });
    }
  });

  it("Botkyrkas texter (samma som fältbeskrivningen som skickats till kommunen)", () => {
    const d = (k: string) => cols.find((c) => c.table === "resultat" && c.key === k)!;
    expect(d("upprepad_franvaro").description).toBe("Upprepad ogiltig frånvaro enligt avtalets regel (två gånger inom 14 dagar)");
    expect(d("progression_tydlig").description).toBe("Tydlig progression: minst ett av de tio områdena på nivå 2 eller högre");
    expect(d("progression_nagon").description).toBe("Någon progression: minst ett av de tio områdena på nivå 1 eller högre");
    expect(d("omraden_bedomda")).toMatchObject({ description: "Antal av de tio obligatoriska områdena (kolumnerna `niva_…` nedan) som har en nivå", values: "0–10 eller tom" });
    expect(d("arendenummer").values).toBe("BOT-ÅÅ-löpnummer");
    expect(d("avtalsomrade_kod").values).toBe("A–L");
    expect(d("fas_nr").values).toBe("1–5");
    expect(d("fas").values).toBe("Kartläggning, Yrkesförberedande grund, Yrkesspecifika moment, Praktik (arbetsplatsförlagt lärande), Matchning och slutrapport");
    expect(d("niva_beredskap")).toMatchObject({ description: "Beredskap för praktik, arbete eller studier", values: "0–3 eller tom" });
    expect(d("resultat").values).toBe("Resultat, Inget resultat, Räknas inte i resultatgraden");
    expect(cols.find((c) => c.table === "progression" && c.key === "niva_text")!.values).toBe("Ingen / för tidigt att bedöma, Liten, Tydlig, Uppnått delmål");
    expect(numberWord(2)).toBe("två");
    expect(numberWord(14)).toBe("14");
  });

  it("texterna byggs av avtalets konfiguration – med en ändrad konfiguration ändras fältbeskrivningen och fliken Om filen", async () => {
    const raw = JSON.parse(JSON.stringify(BOTKYRKA_CONFIG)) as OperationalConfig;
    raw.casePrefix = "KOM";
    raw.attendance.repeatedAbsenceRule = { absentInvalid: 3, withinDays: 21 };
    raw.progression.clearFromLevel = 3;
    raw.progression.anyFromLevel = 3;
    raw.result.definition = "Arbete eller studier minst 50 procent i minst tre månader, verifierat.";
    raw.phases = [{ no: 1, name: "Start" }, { no: 2, name: "Praktik/APL" }, { no: 3, name: "Avslut" }];
    raw.progression.areas = raw.progression.areas.slice(0, 8);
    const cfg = OperationalConfigSchema.parse(raw);
    const changed = exportColumns(cfg, areas.slice(0, 6));
    const exp = buildResultExport({ cfg, areas: areas.slice(0, 6), monthly: [], finals: [], names: new Map(), from: "2026-10", to: "2026-12", now: "2027-02-01T09:12" });
    const fd = resultCsv(exp, "faltbeskrivning");
    const xlsx = await readZip(await resultXlsx(exp, cfg, { contractNumber: "123", customerName: "Kommunen" }));
    const about = entryText(xlsx, "xl/worksheets/sheet5.xml");
    for (const text of [fd, about]) {
      expect(text).not.toMatch(/14 dagar|nivå 2 eller|BOT|inte fastställd|tio /);
      expect(text).toContain("tre gånger inom 21 dagar");
      expect(text).toContain("Tydlig progression: minst ett av de åtta områdena på nivå 3 eller högre");
      expect(text).toContain("KOM-ÅÅ-löpnummer");
      expect(text).toContain("Start, Praktik (arbetsplatsförlagt lärande), Avslut");
      expect(text).toContain("A–F");
    }
    expect(tableColumns(changed, "resultat").filter((c) => c.key.startsWith("niva_"))).toHaveLength(8);
    expect(aboutRules(cfg).join(" ")).not.toContain("fastställd");
    // Botkyrka: resultatdefinitionen är inte fastställd – texten finns på fliken Om filen.
    expect(aboutRules(BOTKYRKA_CONFIG)).toContain("Resultatdefinitionen är inte fastställd. Resultatet är preliminärt.");
  });

  it("fältbeskrivningens rader: tabell, kolumn, beskrivning, format, möjliga värden, källa och schemaversion – utan exempel och utan Markdown", () => {
    const rows = fieldDescriptionRows(cols);
    expect(rows).toHaveLength(79);
    expect(rows[0]).toEqual({
      tabell: "Resultat", kolumn: "arendenummer", beskrivning: "Ärendenumret, samma som i beställningen och på fakturan", format: "Text", mojliga_varden: "BOT-ÅÅ-löpnummer",
      kalla: "Månadsrapporten, avsnitt 1", schemaversion: 2,
    });
    expect(JSON.stringify(rows)).not.toContain("`");
    expect(JSON.stringify(rows)).not.toContain("Alex Exempelsson");
    expect(new Set(rows.map((r) => r.tabell))).toEqual(new Set(Object.values(TABLE_LABEL)));
  });
});

describe("kolumnspärren (columnsStillCompatible)", () => {
  const v1 = qualifiedKeys(tableColumns(cols, "resultat"));
  it("samma lista och nya kolumner sist går bra", () => {
    expect(columnsStillCompatible(v1, v1)).toBe(true);
    expect(columnsStillCompatible(v1, [...v1, "resultat.ny_kolumn"])).toBe(true);
    expect(columnsStillCompatible([], v1)).toBe(true);
  });
  it("ändrad ordning, borttagen kolumn eller ett nytt område mitt i stoppar", () => {
    const swapped = [...v1];
    [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
    expect(columnsStillCompatible(v1, swapped)).toBe(false);
    expect(columnsStillCompatible(v1, v1.filter((k) => k !== "resultat.fas"))).toBe(false);
    const raw = JSON.parse(JSON.stringify(BOTKYRKA_CONFIG)) as OperationalConfig;
    raw.progression.areas = [...raw.progression.areas, "halsa_funktionellt"];
    raw.progression.optionalAreas = ["livskvalitet_sjalvskattad"];
    const withArea = qualifiedKeys(tableColumns(exportColumns(OperationalConfigSchema.parse(raw), areas), "resultat"));
    // Ett nytt område sist i areas hamnar före handelser – mitt i tabellen.
    expect(withArea.indexOf("resultat.niva_halsa_funktionellt")).toBe(withArea.indexOf("resultat.handelser") - 1);
    expect(columnsStillCompatible(v1, withArea)).toBe(false);
  });
});

describe("docs/RESULTATFIL.md stämmer med registret", () => {
  const doc = readFileSync(new URL("../../../docs/RESULTATFIL.md", import.meta.url), "utf8");
  const section = (start: string, end: string | null) => doc.slice(doc.indexOf(start), end ? doc.indexOf(end) : undefined);
  const parts: Record<ExportTable, string> = {
    resultat: section("## 7. Tabell 1: Resultat", "## 8. Tabell 2"),
    progression: section("## 8. Tabell 2: Progression", "## 9. Tabell 3"),
    handelser: section("## 9. Tabell 3: Händelser", "## 10. Tabell 4"),
    avslut: section("## 10. Tabell 4: Avslut", "## 11."),
  };
  it("varje kolumn finns med samma betydelse, exempel och möjliga värden – och inga andra kolumner", () => {
    for (const t of ["resultat", "progression", "handelser", "avslut"] as const) {
      const rows = parts[t]
        .split("\n")
        .filter((l) => /^\| `[a-z0-9_]+` \|/.test(l))
        .map((l) => {
          const cells = l.slice(1, -1).split(" |").map((x) => x.trim());
          return { key: cells[0].replace(/`/g, ""), description: cells[1], example: cells[2], values: cells[3] };
        });
      expect(rows.map((r) => r.key)).toEqual(keys(t));
      for (const c of tableColumns(cols, t)) {
        const r = rows.find((x) => x.key === c.key)!;
        expect({ key: c.key, description: r.description, values: r.values, example: r.example }).toEqual({ key: c.key, description: c.description, values: c.values, example: c.example ?? "" });
      }
    }
  });
  it("dokumentet är samma som fältbeskrivningen som skickats till kommunen (utom rubriken och förtydligandet om kolumnnamnen)", () => {
    expect(doc).toContain("## 12. Det här finns inte med i filen – och varför");
    expect(doc).toContain("Tabellerna 2, 3 och 4 har inte deltagarens namn.");
    expect(doc).toContain("**Alla avslut finns i tabell 4 (Avslut) – räkna resultatgraden där.**");
  });
});
