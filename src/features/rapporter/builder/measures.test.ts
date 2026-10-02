// Rapportbyggarens mått (Del B3): varje mått med små fasta rader.
import { describe, expect, it } from "vitest";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { resultTally } from "@/core/kpi";
import { MEASURES_BY_DATASET, MEASURE_KEYS, MULTI_COLUMN_MEASURES } from "./definition";
import { aRow, hRow, mRow, pRow } from "./fixtures.test-helper";
import { MEASURE_REGISTRY, measureDef, resultNotes } from "./measures";

const cfg = BOTKYRKA_CONFIG;
const v = (key: Parameters<typeof measureDef>[0], rows: Parameters<ReturnType<typeof measureDef>["compute"]>[0]) => measureDef(key).compute(rows);

describe("registret", () => {
  it("ett mått per nyckel, i rätt datamängd; bara fördelningen har flera kolumner", () => {
    expect([...MEASURE_REGISTRY.keys()].sort()).toEqual([...MEASURE_KEYS].sort());
    for (const [ds, keys] of Object.entries(MEASURES_BY_DATASET)) for (const k of keys) expect(measureDef(k).dataset).toBe(ds);
    for (const k of MEASURE_KEYS) expect(measureDef(k).columns(cfg).length > 1, k).toBe(MULTI_COLUMN_MEASURES.includes(k));
    for (const k of MEASURE_KEYS) for (const c of measureDef(k).columns(cfg)) expect(c.fileKey).toMatch(/^[a-z0-9_]+$/);
  });
  it("hjälptexterna byggs av konfigurationen", () => {
    expect(measureDef("tydlig_progression").help(cfg)).toContain(`nivå ${cfg.progression.clearFromLevel} eller högre`);
    expect(measureDef("nagon_progression").help(cfg)).toContain(`nivå ${cfg.progression.anyFromLevel} eller högre`);
    expect(measureDef("upprepad_franvaro").help(cfg)).toContain("två gånger inom 14 dagar");
    expect(measureDef("verifierat_resultat").help(cfg)).toContain("arbete och studier");
  });
});

describe("deltagarmånader", () => {
  it("närvarograden är viktad per tillfälle – inte ett medel av procenten", () => {
    const rows = [
      mRow(1, "2026-10", { narvarande: 9, sen_ankomst: 0, franvaro_giltig: 1, franvaro_ogiltig: 0 }),
      mRow(2, "2026-10", { narvarande: 1, sen_ankomst: 0, franvaro_giltig: 0, franvaro_ogiltig: 9 }),
    ];
    // (9 + 1) / (10 + 10) = 50 % – inte medel av 90 % och 10 % (också 50 % här), så prövas med olika antal tillfällen:
    expect(v("narvarograd", rows).values).toEqual([0.5]);
    const uneven = [mRow(1, "2026-10", { narvarande: 9, franvaro_giltig: 1 }), mRow(2, "2026-10", { narvarande: 0, sen_ankomst: 1, franvaro_giltig: 0, franvaro_ogiltig: 3 })];
    expect(v("narvarograd", uneven).values[0]).toBeCloseTo(10 / 14);
    const none = mRow(3, "2026-10", { narvarande: 0, sen_ankomst: 0, franvaro_giltig: 0, franvaro_ogiltig: 0, ej_registrerade: 10 });
    expect(v("narvarograd", [...uneven, none])).toMatchObject({ skipped: 1, den: 14 });
    expect(v("narvarograd", [none]).values).toEqual([null]);
    expect(measureDef("narvarograd").skippedNote!(2)).toBe("2 deltagarmånader har ingen registrerad närvaro och räknas inte.");
  });
  it("progressionens nämnare är bara godkända bedömningar – skipped räknas", () => {
    const rows = [
      mRow(1, "2026-10", { progression_tydlig: 1, progression_nagon: 1 }),
      mRow(2, "2026-10", { progression_tydlig: 0, progression_nagon: 1 }),
      mRow(3, "2026-10", { bedomning_godkand: 0, progression_tydlig: null, progression_nagon: null, omraden_bedomda: null }),
    ];
    expect(v("tydlig_progression", rows)).toEqual({ values: [0.5], num: 1, den: 2, skipped: 1 });
    expect(v("nagon_progression", rows)).toEqual({ values: [1], num: 2, den: 2, skipped: 1 });
    expect(measureDef("tydlig_progression").skippedNote!(1)).toBe("1 deltagarmånad utan godkänd bedömning räknas inte.");
  });
  it("summor och antal", () => {
    const rows = [mRow(1, "2026-10", { upprepad_franvaro: 1, praktik_startad: 1, avvikelser_nya: 2 }), mRow(1, "2026-11", { arbetsgivarkontakter: 3 })];
    expect(v("deltagarmanader", rows).values).toEqual([2]);
    expect(v("avstamningar", rows).values).toEqual([8]);
    expect(v("arbetsgivarkontakter", rows).values).toEqual([5]);
    expect(v("upprepad_franvaro", rows).values).toEqual([1]);
    expect(v("avvikelser_nya", rows).values).toEqual([2]);
    expect(v("praktik_startad", rows).values).toEqual([1]);
  });
});

describe("avslut", () => {
  it("slutrapport utan resultatklass räknas som avslut utan resultat (samma som resultTally); excluded räknas inte", () => {
    const rows = [
      aRow(1, "2026-11"),
      aRow(2, "2026-11", { avslutsorsak_kod: "planerat_utan_resultat", resultat_kod: "no_result", resultat_verifierat: 0 }),
      aRow(3, "2026-11", { avslutsorsak_kod: null, resultat_kod: null, resultat: null, resultat_verifierat: 0 }),
      aRow(4, "2026-11", { avslutsorsak_kod: "avbrott_flytt", resultat_kod: "excluded", resultat_verifierat: 0 }),
      aRow(5, "2026-12", { resultat_verifierat: 0 }),
    ];
    expect(v("avslut", rows).values).toEqual([5]);
    expect(v("avslut_som_raknas", rows).values).toEqual([4]);
    expect(v("verifierat_resultat", rows).values).toEqual([1]);
    expect(v("preliminara", rows).values).toEqual([1]);
    const rg = v("resultatgrad", rows);
    expect(rg).toEqual({ values: [1 / 4], num: 1, den: 4, missing: 1 });
    expect(rg.values[0]).toBe(resultTally([
      { resultClass: "result", verified: true }, { resultClass: "no_result", verified: false }, { resultClass: null, verified: false },
      { resultClass: "excluded", verified: false }, { resultClass: "result", verified: false },
    ]).value);
    // Briefens fall: result verifierat, no_result, null → 3 som räknas, 1/3, noten om 1 avslut.
    const three = [aRow(1, "2026-11"), aRow(2, "2026-11", { resultat_kod: "no_result", resultat_verifierat: 0 }), aRow(3, "2026-11", { resultat_kod: null, resultat_verifierat: 0 })];
    expect(v("avslut_som_raknas", three).values).toEqual([3]);
    expect(v("resultatgrad", three).values[0]).toBeCloseTo(1 / 3);
    expect(resultNotes(cfg, 1)[0]).toBe("1 avslut saknar uppgift om resultat och räknas som avslut utan resultat.");
    expect(resultNotes(cfg, 0)).toEqual(["Resultatdefinitionen är inte fastställd. Resultatet är preliminärt."]);
  });
});

describe("händelser och progression", () => {
  it("händelser och verifierade", () => {
    const rows = [hRow(1, "2026-10"), hRow(1, "2026-10", { verifierad: 1 }), hRow(2, "2026-11", { handelse_kod: "arbete_paborjat", verifierad: 1 })];
    expect(v("handelser", rows).values).toEqual([3]);
    expect(v("verifierade", rows).values).toEqual([2]);
  });
  it("fördelningen ger fem värden – ett per nivå och inte bedömd – och ingen medelvärdeskolumn", () => {
    const rows = [pRow(1, "2026-10", "a", 0), pRow(1, "2026-10", "b", 2), pRow(2, "2026-10", "a", 2), pRow(2, "2026-10", "b", null), pRow(3, "2026-10", "a", 3)];
    expect(v("fordelning", rows).values).toEqual([1, 0, 2, 1, 1]);
    const cols = measureDef("fordelning").columns(cfg);
    expect(cols.map((c) => c.fileKey)).toEqual(["niva_0", "niva_1", "niva_2", "niva_3", "niva_ej_bedomd"]);
    expect(cols.map((c) => c.label)).toEqual([`0 ${cfg.progression.scale["0"]}`, `1 ${cfg.progression.scale["1"]}`, `2 ${cfg.progression.scale["2"]}`, `3 ${cfg.progression.scale["3"]}`, "Inte bedömd"]);
    expect(cols.every((c) => c.unit === "antal")).toBe(true);
    expect(JSON.stringify(cols)).not.toMatch(/medel/i);
  });
});
