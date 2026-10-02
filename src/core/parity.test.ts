// Paritet mot den gamla prototypen: domänfunktionerna körs på testdatat (createSeed) och jämförs med facit
// som tagits fram ur prototypens egen kod (src/core/parity/generate-facit.mjs -> facit.json).
// Obs: prototyp/tools/data-samples.json är äldre än prototypens nuvarande seed och används därför inte som facit.
//
// Testet hoppas över (skipIf) så länge seeden är en platshållare utan ärenden – det körs automatiskt när
// src/data/seed exporterar riktiga data.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_SETTINGS } from "./config";
import { domainEnv } from "./env";
import { paritySections, type Facit } from "./parity/sections";
import { createSeed } from "@/data/seed";
import { emptyDb, type Db } from "@/data/schema";

// Läses som fil (inte import) så att typkontrollen slipper härleda typer för hela facit.
const facit = JSON.parse(readFileSync(new URL("./parity/facit.json", import.meta.url), "utf8")) as Facit;

function loadSeed(): Db | null {
  try {
    const raw = createSeed() as unknown as Partial<Db>;
    if (!Array.isArray(raw.cases) || raw.cases.length === 0) return null;
    return { ...emptyDb(), ...raw } as Db;
  } catch {
    return null;
  }
}
const db = loadSeed();

describe.skipIf(!db)("paritet med den gamla prototypen (createSeed mot facit)", () => {
  // Callbacken körs även när describe hoppas över (för att samla testerna) – därför en tom databas som reserv.
  const data = db ?? emptyDb();
  const contract = data.contracts.find((c) => c.id === "c-bot");
  const env = contract ? domainEnv(contract, data.org_settings[0]?.settings ?? DEFAULT_ORG_SETTINGS, facit.meta.now) : null;

  it("testdatat har avtalet Botkyrka", () => {
    expect(contract?.casePrefix).toBe("BOT");
  });

  for (const s of env ? paritySections(data, env, facit) : []) {
    it(s.name, () => {
      expect(JSON.parse(JSON.stringify(s.actual() ?? null))).toEqual(s.expected ?? null);
    });
  }
});
