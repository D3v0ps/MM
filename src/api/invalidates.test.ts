// Tysta kommandon (loggning, utlämning, läskvitton) ska säga vilka frågor de räknar om (CommandDef.invalidates).
// Annars räknar useCommand om alla frågor – och varje sidvisning (session.auditView) hämtar sidan två–tre gånger.
import { describe, expect, it } from "vitest";
import type { AnyDef, CommandDef } from "./contract";
import { isSilentCommand, registeredKeys } from "./handlers";

const apis = import.meta.glob("../features/*/api.ts", { eager: true }) as Record<string, Record<string, unknown>>;

const commands = (): CommandDef<unknown, unknown>[] =>
  Object.values(apis)
    .flatMap((m) => Object.values(m))
    .filter((v): v is CommandDef<unknown, unknown> => !!v && typeof v === "object" && (v as AnyDef).kind === "command" && typeof (v as AnyDef).key === "string");

describe("invalidates på tysta kommandon", () => {
  it("hittar kommandona i områdenas kontrakt", () => {
    const keys = commands().map((c) => c.key);
    expect(keys).toContain("session.auditView");
    expect(keys).toContain("rost.notesSeen");
    // Alla registrerade tysta kommandon finns i ett kontrakt som testet läser.
    const silent = registeredKeys().filter(isSilentCommand);
    expect(silent.length).toBeGreaterThan(10);
    expect(silent.filter((k) => !keys.includes(k))).toEqual([]);
  });

  it("varje tyst kommando anger invalidates", () => {
    const missing = commands().filter((c) => isSilentCommand(c.key) && c.invalidates === undefined).map((c) => c.key);
    expect(missing).toEqual([]);
  });

  it("loggkommandona räknar inte om något", () => {
    const byKey = new Map(commands().map((c) => [c.key, c]));
    for (const k of ["session.auditView", "rost.notesSeen", "arenden.visaPersonnummer", "kommun.visaPersonnummer", "inkorg.revealPnr", "rapporter.download"]) {
      expect(byKey.get(k)?.invalidates, k).toBe("none");
    }
    expect(byKey.get("notiser.notifRead")?.invalidates).toContain("session.navCounts");
  });
});
