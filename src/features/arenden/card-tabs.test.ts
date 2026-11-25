// Deltagarkortets flikar (Karims beslut 2026-11-25): sex flikar i raden och resten under Mer, Delmål som egen flik och
// Händelser och utfall som heter Progression och resultat (nyckeln handelser kvar). Modellen (card-tabs.ts) och kortets fält
// progressGoals genom samma execute() som appen och prototypen, mot testdatat i minnet. Bara påhittade uppgifter.
import { beforeEach, describe, expect, it } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import "@/api/handlers";
import type { Actor, Role } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import { caseGoals } from "@/features/delmal/api";
import { CASE_TABS, caseCard, type CaseCard } from "./api";
import { CASE_TAB_LABEL, cardTabFor, cardTabLabel, cardTabs } from "./card-tabs";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
const start = (edit?: (d: MemoryData<Tables>) => void) => {
  const data = structuredClone(SEED);
  edit?.(data);
  rt = createMemoryRuntime({ data, clock: demoClock(DEMO_START) });
};
beforeEach(() => start());
const as = (userId: string, role: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && x.actor.role === role);
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const card = async (caseId: string, actor: Actor): Promise<CaseCard> => {
  const c = await q(caseCard, { caseId }, actor);
  if (c.kind !== "ok") throw new Error(`Kortet öppnas inte: ${c.kind}`);
  return c;
};

const NADIA = "case-260143"; // BOT-26-0143, huvudcoach Amira – har lägen för delmål i testdatat
const YUSUF = "case-260148"; // BOT-26-0148 – inga lägen för delmål

const MAIN_FULL = ["oversikt", "narvaro", "avstamningar", "anteckningar", "delmal", "handelser"];
const MORE_FULL = ["tidslinje", "kartlaggning", "manad", "avvikelser", "praktik", "rapporter", "meddelanden", "historik"];
const label = (ids: readonly string[]) => ids.map((t) => CASE_TAB_LABEL[t as keyof typeof CASE_TAB_LABEL]);

describe("modellen: sex flikar i raden och resten under Mer", () => {
  it("full åtkomst med delmål: Översikt · Närvaro · Möten · Anteckningar · Delmål · Progression och resultat, åtta under Mer", () => {
    const m = cardTabs({ access: "full", progressGoals: true });
    expect(label(m.main)).toEqual(["Översikt", "Närvaro", "Möten", "Anteckningar", "Delmål", "Progression och resultat"]);
    expect(label(m.more)).toEqual(["Tidslinje", "Kartläggning", "Månadsunderlag", "Avvikelser", "Praktik", "Rapporter", "Meddelanden", "Historik"]);
    // Inget försvinner: alla flikar finns kvar, i raden eller under Mer.
    expect([...m.main, ...m.more].sort()).toEqual([...CASE_TABS].sort());
    expect(m.all).toEqual([...m.main, ...m.more]);
  });

  it("utan delmål (tom katalog eller ingen läsrätt): ingen flik Delmål – resten oförändrat", () => {
    const m = cardTabs({ access: "full", progressGoals: false });
    expect(m.main).toEqual(MAIN_FULL.filter((t) => t !== "delmal"));
    expect(m.more).toEqual(MORE_FULL);
  });

  it("teamåtkomst (vilande handledare): samma flikar som förut – Möten, Kartläggning, Månadsunderlag och rapporterna saknas", () => {
    const m = cardTabs({ access: "team", progressGoals: true });
    expect(m.main).toEqual(["oversikt", "narvaro", "anteckningar", "delmal", "handelser"]);
    expect(m.more).toEqual(["tidslinje", "praktik"]);
    expect(cardTabs({ access: "team", progressGoals: false }).main).toEqual(["oversikt", "narvaro", "anteckningar", "handelser"]);
    // Teamet ser inte Progression och resultat – fliken heter som förut.
    expect(cardTabLabel("handelser", "team")).toBe("Arbetsgivarkontakter och händelser");
    expect(cardTabLabel("handelser", "full")).toBe("Progression och resultat");
  });

  it("?flik=: nyckeln handelser är kvar, Mer-flikar och delmal öppnas direkt, okänt och saknat ger Översikt", () => {
    const full = cardTabs({ access: "full", progressGoals: true });
    expect(cardTabFor("handelser", null, full)).toEqual({ tab: "handelser", blocked: false });
    expect(cardTabFor("delmal", null, full)).toEqual({ tab: "delmal", blocked: false });
    for (const t of MORE_FULL) expect(cardTabFor(t, null, full)).toEqual({ tab: t, blocked: false });
    expect(cardTabFor(null, null, full)).toEqual({ tab: "oversikt", blocked: false });
    expect(cardTabFor("finns-inte", null, full)).toEqual({ tab: "oversikt", blocked: false });
    // ?visa=rost ("Läs röstmeddelandet" på Min vecka) öppnar Meddelanden.
    expect(cardTabFor(null, "rost", full)).toEqual({ tab: "meddelanden", blocked: false });
    // Delmål saknas för att ärendet inte har några delmål: Översikt utan "visas inte för din roll".
    expect(cardTabFor("delmal", null, cardTabs({ access: "full", progressGoals: false }))).toEqual({ tab: "oversikt", blocked: false });
    // Teamet: en flik som rollen inte får visas inte – och det sägs.
    const team = cardTabs({ access: "team", progressGoals: true });
    expect(cardTabFor("rapporter", null, team)).toEqual({ tab: "oversikt", blocked: true });
    expect(cardTabFor(null, "rost", team)).toEqual({ tab: "oversikt", blocked: false });
    expect(cardTabFor("praktik", null, team)).toEqual({ tab: "praktik", blocked: false });
  });
});

describe("kortet per roll (arenden.kort → modellen)", () => {
  const roles: [string, Role][] = [["u-amira", "coach"], ["u-sara", "samordnare"], ["u-johan", "avtalsansvarig"], ["u-karin", "chef"], ["u-robin", "admin"]];
  for (const [userId, role] of roles) {
    it(`${role}: sex flikar med Delmål och åtta under Mer`, async () => {
      const c = await card(NADIA, as(userId, role));
      expect(c.access).toBe("full");
      expect(c.progressGoals).toBe(true);
      const m = cardTabs(c);
      expect(m.main).toEqual(MAIN_FULL);
      expect(m.more).toEqual(MORE_FULL);
    });
  }

  it("en begränsad testare får samma flikar som coachen (bara presentationen ändrades)", async () => {
    const tester: Actor = { ...as("u-amira", "coach"), testerId: "t-begransad" };
    expect(cardTabs(await card(NADIA, tester))).toEqual(cardTabs(await card(NADIA, as("u-amira", "coach"))));
  });

  it("kommunen och ekonomen når inte kortet – och därmed aldrig fliken Delmål", async () => {
    await expect(q(caseCard, { caseId: NADIA }, as("k-maria", "kommun_handlaggare"))).rejects.toThrow();
    await expect(q(caseCard, { caseId: NADIA }, as("u-lars", "ekonom"))).rejects.toThrow();
  });

  it("progressGoals följer kortet Delmål: visas när delmal.arende har delmål att visa", async () => {
    for (const caseId of [NADIA, YUSUF]) {
      const goals = await q(caseGoals, { caseId }, as("u-amira", "coach"));
      const c = await card(caseId, as("u-amira", "coach"));
      expect(c.progressGoals).toBe(goals.on && goals.areas.length > 0);
    }
  });

  it("tom katalog: ingen flik Delmål, ?flik=delmal visar Översikt", async () => {
    start((d) => {
      d.progress_goals = d.progress_goals.filter((g) => g.contractId !== "c-bot");
      d.case_progress_goals = [];
    });
    const c = await card(NADIA, as("u-amira", "coach"));
    expect(c.progressGoals).toBe(false);
    const goals = await q(caseGoals, { caseId: NADIA }, as("u-amira", "coach"));
    expect(goals.on && goals.areas.length).toBe(0);
    expect(cardTabs(c).main).not.toContain("delmal");
    expect(cardTabFor("delmal", null, cardTabs(c))).toEqual({ tab: "oversikt", blocked: false });
  });

  it("alla delmål inaktiverade: fliken visas bara i ärenden som har ett läge för något av dem", async () => {
    start((d) => {
      d.progress_goals = d.progress_goals.map((g) => (g.contractId === "c-bot" ? { ...g, active: false } : g));
      d.case_progress_goals = d.case_progress_goals.filter((r) => r.caseId === NADIA);
    });
    expect(rt.store.rows("case_progress_goals").some((r) => r.caseId === NADIA)).toBe(true);
    expect((await card(NADIA, as("u-amira", "coach"))).progressGoals).toBe(true);
    expect((await card(YUSUF, as("u-amira", "coach"))).progressGoals).toBe(false);
  });
});
