// Rapportbyggarens kolumnkatalog (Del B2): en regel för varje kolumn i steg 3:s register, och dimensionernas etiketter och ordning.
import { describe, expect, it } from "vitest";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { exportColumns, type ExportColumn } from "../export-columns";
import { columnRule, compareDimension, dimensionChoices, dimensionLabel, MISSING_LABEL, uncataloged } from "./catalog";
import { DIMENSIONS } from "./definition";
import { AREAS } from "./fixtures.test-helper";

const env = { cfg: BOTKYRKA_CONFIG, areas: AREAS };

describe("COLUMN_CLASS", () => {
  const cols = exportColumns(BOTKYRKA_CONFIG, AREAS);
  it("varje kolumn i registret har en regel (niva_<område> via prefixregeln)", () => {
    expect(uncataloged(cols)).toEqual([]);
    expect(columnRule("resultat", "niva_yrkesfardigheter")).toEqual({ class: "fakta", section: "Progression" });
    // Prefixregeln gäller bara tabellen resultat – progressionstabellens niva_text har en egen regel.
    expect(columnRule("progression", "niva_text")).toEqual({ class: "dimension", section: "Progression" });
    expect(columnRule("handelser", "niva_x")).toBeNull();
  });
  it("en ny kolumn i registret utan regel ger rött", () => {
    const extra: ExportColumn = { table: "resultat", key: "ny_kolumn", type: "int", description: "Ny", values: "Heltal", source: "Månadsrapporten, avsnitt 2" };
    expect(uncataloged([...cols, extra])).toEqual(["resultat.ny_kolumn"]);
  });
  it("klasserna: namn identifierande, ärendenummer pseudonym, datum bara datum, dimensionerna är dimension", () => {
    expect(columnRule("resultat", "namn")?.class).toBe("identifierande");
    for (const t of ["resultat", "progression", "handelser", "avslut"] as const) expect(columnRule(t, "arendenummer")?.class).toBe("pseudonym");
    for (const [t, k] of [["resultat", "insats_start"], ["resultat", "bedomning_datum"], ["avslut", "avslut_datum"], ["handelser", "datum"]] as const) expect(columnRule(t, k)?.class).toBe("datum");
    for (const d of DIMENSIONS) {
      const table = d === "handelse_kod" ? "handelser" : d === "omrade_kod" ? "progression" : "resultat";
      expect(columnRule(table, d)?.class, d).toBe("dimension");
    }
  });
});

describe("dimensionernas etiketter och ordning", () => {
  it("koden grupperar, texten visas", () => {
    expect(dimensionLabel("avtalsomrade_kod", "G", env)).toBe("G Lager och logistik");
    expect(dimensionLabel("fas_nr", 4, env)).toBe("Praktik (arbetsplatsförlagt lärande)");
    expect(dimensionLabel("samlad_status_kod", "yellow", env)).toBe("Gul");
    expect(dimensionLabel("avslutsorsak_kod", "avbrott_flytt", env)).toBe("Avbrott: flytt");
    expect(dimensionLabel("resultat_kod", "excluded", env)).toBe("Räknas inte i resultatgraden");
    expect(dimensionLabel("omrade_kod", "yrkesfardigheter", env)).toBe(BOTKYRKA_CONFIG.progression.areaLabels.yrkesfardigheter);
    expect(dimensionLabel("yrkesspar", null, env)).toBe(MISSING_LABEL);
  });
  it("ordning: avtalsområde på kod, fas på nummer, samlad status grön–gul–röd, tomt sist", () => {
    const sort = (dim: string, xs: (string | number | null)[]) => [...xs].sort((a, b) => compareDimension(dim, a, b, env));
    expect(sort("avtalsomrade_kod", ["H", null, "B", "G"])).toEqual(["B", "G", "H", null]);
    expect(sort("fas_nr", [5, null, 1, 3])).toEqual([1, 3, 5, null]);
    expect(sort("samlad_status_kod", ["red", "green", null, "yellow"])).toEqual(["green", "yellow", "red", null]);
    expect(sort("yrkesspar", ["Ö-spår", "Är", "Bagare"])).toEqual(["Bagare", "Är", "Ö-spår"]);
  });
  it("fasta val ur konfigurationen och avtalsområdena", () => {
    expect(dimensionChoices("avtalsomrade_kod", env)?.map((c) => c.value)).toEqual(["B", "G", "H"]);
    expect(dimensionChoices("fas_nr", env)?.map((c) => c.value)).toEqual(["1", "2", "3", "4", "5"]);
    expect(dimensionChoices("yrkesspar", env)).toBeNull();
  });
});
