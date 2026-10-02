// Rapportbyggarens mallar (Del B5) och testdatats sparade rapporter (Del C5).
import { describe, expect, it } from "vitest";
import { createSeed } from "@/data/seed";
import { ReportDefinitionSchema } from "./definition";
import { STANDARD_COLUMNS, TEMPLATE_KEYS, TEMPLATES, templateFor } from "./templates";

describe("mallarna", () => {
  it("alla mallar validerar mot ReportDefinitionSchema; nycklarna är unika och matchar ^[a-z0-9-]+$", () => {
    for (const t of TEMPLATES) expect(ReportDefinitionSchema.safeParse(t.definition).success, t.key).toBe(true);
    const keys = TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9-]+$/);
    expect([...TEMPLATE_KEYS]).toEqual(keys);
  });
  it("standardkolumnerna börjar med ärendenumret och validerar som lista för sin datamängd", () => {
    for (const [ds, cols] of Object.entries(STANDARD_COLUMNS)) {
      expect(cols[0]).toMatch(/\.arendenummer$/);
      const def = { v: 1, dataset: ds, period: { kind: "senaste", months: 1 }, filters: {}, output: "lista", groupBy: null, split: "inget", measures: [], columns: cols, chart: null };
      expect(ReportDefinitionSchema.safeParse(def).success, ds).toBe(true);
    }
  });
  it("templateFor är ett uppslag – en okänd nyckel ger null", () => {
    expect(templateFor("narvaro-per-manad")?.name).toBe("Närvaro per månad");
    expect(templateFor("anna-andersson")).toBeNull();
    expect(templateFor(null)).toBeNull();
  });
});

describe("testdatats sparade rapporter", () => {
  const seed = createSeed();
  it("tre rader i c-bot med mallens definition och nyckel", () => {
    expect(seed.saved_reports.map((r) => [r.id, r.ownerId, r.visibility, r.templateKey])).toEqual([
      ["sr-seed-privat", "u-sara", "private", "narvaro-per-manad"],
      ["sr-seed-mb", "u-karin", "mb", "progression-per-omrade"],
      ["sr-seed-kommun", "u-johan", "customer", "resultatgrad-per-omrade"],
    ]);
    for (const r of seed.saved_reports) {
      expect(r.contractId).toBe("c-bot");
      expect(ReportDefinitionSchema.safeParse(r.definition).success, r.id).toBe(true);
      expect(r.definition).toEqual(templateFor(r.templateKey)!.definition);
      expect(r.title).toBe(templateFor(r.templateKey)!.name);
      expect(r.createdAt < "2027-02-01T09:12").toBe(true);
      expect(r.archivedAt).toBeNull();
      expect(r.visibility === "private" ? r.sharedAt : r.sharedBy).toBe(r.visibility === "private" ? null : r.ownerId);
    }
  });
});
