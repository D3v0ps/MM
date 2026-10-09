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
const facit = renamedMeeting(JSON.parse(readFileSync(new URL("./parity/facit.json", import.meta.url), "utf8"))) as Facit;

// Beslut 2026-10-09: veckoavstämningen heter Möte för coachen. Facit är genererat ur den gamla prototypen och behåller de gamla
// orden – texterna byts här så att resten av facit gäller oförändrat.
function renamedMeeting(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace("dokumentera i veckoavstämningen.", "dokumentera i mötet.").replace(/^Avstämning (\d{1,2} \w{3} kl\.)/u, "Möte $1");
  }
  if (Array.isArray(value)) return value.map(renamedMeeting);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renamedMeeting(v)]));
  return value;
}

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

  // Beslut 2026-10-01: tydlig/någon progression räknas bara på de obligatoriska områdena (progressionFlags). Prototypen räknade
  // alla bedömda områden. Testdatat har inga bedömda valfria områden, så facit gäller oförändrat – det här testet stoppar
  // om testdatat ändras så att facit (generate-facit.mjs) inte längre räknar som appen.
  it("testdatat har inga bedömda valfria progressionsområden (facit räknas som appen)", () => {
    const optional = new Set(env?.cfg.progression.optionalAreas ?? []);
    expect(optional.size).toBeGreaterThan(0);
    expect(data.monthly_assessments.filter((m) => Object.entries(m.areas).some(([k, a]) => optional.has(k) && a.level != null)).map((m) => m.id)).toEqual([]);
  });

  for (const s of env ? paritySections(data, env, facit) : []) {
    it(s.name, () => {
      expect(JSON.parse(JSON.stringify(s.actual() ?? null))).toEqual(s.expected ?? null);
    });
  }
});
