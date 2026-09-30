import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOTKYRKA_CONFIG,
  ContractConfigSchema,
  DEFAULT_ORG_SETTINGS,
  KK_CONFIG,
  OperationalConfigSchema,
  OrgSettingsSchema,
  UNSET,
  UNSET_LABEL,
  buyerRefLengthText,
  buyerRefPattern,
  configValueText,
  effectiveVisibilityScope,
  isOperational,
  isUnset,
  kpiDef,
  parseContractConfig,
  phaseLabel,
  phaseName,
  progressionAreas,
  progressionScaleLabel,
  purchaseOrderPattern,
  requireOperational,
  slaRule,
  slaWithin,
  stuckRule,
  unsetHint,
  unsetPaths,
} from "./config";
import { TABLE_NAMES, emptyDb, type Contract } from "@/data/schema";

// ---------------------------------------------------------------- Den gamla prototypens värden (facit)
// CONFIG_BOT och CONFIG_KK läses ur prototyp/src/01-seed.js (MM.seedConstants), S.orgConfig ur samma fil.
const seedSrc = readFileSync(new URL("../../prototyp/src/01-seed.js", import.meta.url), "utf8");
type Proto = { seedConstants: { CONFIG_BOT: unknown; CONFIG_KK: { priceItems: { price: number }[] } & Record<string, unknown> } };
const proto: Proto = (() => {
  const MM = { d: {} } as unknown as Proto;
  new Function("MM", seedSrc)(MM);
  return MM;
})();
/** Objektliteralen efter "S.orgConfig = " (klammerparentesmatchning). */
function protoOrgConfig(): unknown {
  const start = seedSrc.indexOf("{", seedSrc.indexOf("S.orgConfig = "));
  let depth = 0;
  for (let i = start; i < seedSrc.length; i++) {
    if (seedSrc[i] === "{") depth++;
    if (seedSrc[i] === "}" && --depth === 0) return new Function(`return (${seedSrc.slice(start, i + 1)});`)();
  }
  throw new Error("S.orgConfig hittades inte");
}

/** Prototypens avtalstexter (CONTRACT_NOTES i prototyp/src/views/admin.js), per avtals-id. */
function protoContractNotes(): Record<"c-bot" | "c-kk", { termination: string; scope: string }> {
  const src = readFileSync(new URL("../../prototyp/src/views/admin.js", import.meta.url), "utf8");
  const start = src.indexOf("{", src.indexOf("const CONTRACT_NOTES = "));
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    if (src[i] === "}" && --depth === 0) return new Function(`return (${src.slice(start, i + 1)});`)();
  }
  throw new Error("CONTRACT_NOTES hittades inte");
}

describe("avtalskonfigurationen – samma värden som den gamla prototypen", () => {
  const notes = protoContractNotes();
  it("Botkyrka är exakt prototypens CONFIG_BOT, plus avtalstexterna (CONTRACT_NOTES) som flyttats in i konfigurationen", () => {
    const { texts, ...rest } = BOTKYRKA_CONFIG;
    expect(rest).toStrictEqual(proto.seedConstants.CONFIG_BOT);
    expect(texts).toStrictEqual(notes["c-bot"]);
    expect(texts?.scope).toBe("Minst 70 och upp till 100 årsplatser i tolv avtalsområden (A–L). Miljonbemanning är rangordnad 1 i alla områden.");
  });
  it("Kammarkollegiet är prototypens CONFIG_KK med priserna i öre, plus avtalstexterna", () => {
    const kk = proto.seedConstants.CONFIG_KK;
    const expected = { ...kk, priceItems: kk.priceItems.map(({ price, ...rest }) => ({ ...rest, priceOre: price * 100 })), texts: notes["c-kk"] };
    expect(KK_CONFIG).toStrictEqual(expected);
    expect(KK_CONFIG.texts?.termination).toBe("Enligt KK-avtalet – kontrolleras före start.");
    expect(KK_CONFIG.priceItems?.map((p) => p.priceOre)).toEqual([412000, 120000, 135000, 408000, 69900]);
  });
  it("interna regler är exakt prototypens S.orgConfig", () => {
    expect(DEFAULT_ORG_SETTINGS).toStrictEqual(protoOrgConfig());
  });
});

describe("zod-scheman", () => {
  it("båda konfigurationerna parsar, bara Botkyrka är driftklar", () => {
    expect(ContractConfigSchema.safeParse(BOTKYRKA_CONFIG).success).toBe(true);
    expect(OperationalConfigSchema.safeParse(BOTKYRKA_CONFIG).success).toBe(true);
    expect(ContractConfigSchema.safeParse(KK_CONFIG).success).toBe(true);
    expect(OperationalConfigSchema.safeParse(KK_CONFIG).success).toBe(false);
    expect(isOperational(BOTKYRKA_CONFIG)).toBe(true);
    expect(isOperational(KK_CONFIG)).toBe(false);
    expect(requireOperational(BOTKYRKA_CONFIG)).toBe(BOTKYRKA_CONFIG);
    expect(() => requireOperational(KK_CONFIG)).toThrow(/KK.*saknar.*phases/);
    // Samma värde från databasen (JSON) parsar till samma objekt.
    expect(parseContractConfig(JSON.parse(JSON.stringify(BOTKYRKA_CONFIG)))).toStrictEqual(BOTKYRKA_CONFIG);
  });

  const withBilling = (patch: Record<string, unknown>) => ({ ...BOTKYRKA_CONFIG, billing: { ...BOTKYRKA_CONFIG.billing, ...patch } });
  it("stoppar felaktig konfiguration", () => {
    const bad: unknown[] = [
      { ...BOTKYRKA_CONFIG, casePrefix: "bot" },
      { ...BOTKYRKA_CONFIG, casePrefx: "BOT" },
      withBilling({ buyerReference: { required: true, pattern: "^[0-9]{8,10$(" } }),
      withBilling({ unit: "hour" }),
      { ...BOTKYRKA_CONFIG, sla: [{ key: "x", within: { days: 1, workingDays: 1 } }] },
      { ...BOTKYRKA_CONFIG, sla: [{ key: "x", within: "7 dagar" }] },
      { ...BOTKYRKA_CONFIG, kpis: [{ key: "a", internalTarget: 1.5 }] },
      { ...BOTKYRKA_CONFIG, kpis: [{ key: "a" }, { key: "a" }] },
      { ...BOTKYRKA_CONFIG, stuckRules: [{ phase: 9, maxDays: 10 }] },
      { ...BOTKYRKA_CONFIG, progression: { ...BOTKYRKA_CONFIG.progression, areas: [...BOTKYRKA_CONFIG.progression.areas, "nytt_omrade"] } },
      { ...BOTKYRKA_CONFIG, progression: { ...BOTKYRKA_CONFIG.progression, scale: { 0: "a", 1: "b", 2: "c" } } },
      { ...BOTKYRKA_CONFIG, customerVisibility: { ...BOTKYRKA_CONFIG.customerVisibility, scope: "alla" } },
      { ...BOTKYRKA_CONFIG, texts: { scope: "" } },
      { ...BOTKYRKA_CONFIG, texts: { ...BOTKYRKA_CONFIG.texts, uppsagning: "Tre månader" } },
    ];
    for (const b of bad) expect(ContractConfigSchema.safeParse(b).success, JSON.stringify(b).slice(0, 80)).toBe(false);
    // ATT_FASTSTÄLLA är tillåtet där värdet inte är fastställt.
    expect(ContractConfigSchema.safeParse({ ...BOTKYRKA_CONFIG, customerVisibility: { ...BOTKYRKA_CONFIG.customerVisibility, scope: "unit" } }).success).toBe(true);
    expect(ContractConfigSchema.safeParse({ ...BOTKYRKA_CONFIG, kpis: [{ key: "a", internalTarget: UNSET }] }).success).toBe(true);
    // Avtalstexterna är valfria – ett nytt avtal utan texter parsar (administrationen visar "–").
    const noTexts: Record<string, unknown> = { ...BOTKYRKA_CONFIG };
    delete noTexts.texts;
    expect(OperationalConfigSchema.safeParse(noTexts).success).toBe(true);
    expect(ContractConfigSchema.safeParse({ ...KK_CONFIG, texts: { termination: "Enligt avtalet." } }).success).toBe(true);
  });

  it("interna regler: eskalering efter påminnelse, e-post utan personuppgifter", () => {
    const pw = DEFAULT_ORG_SETTINGS.notifications.progressionWatch;
    const withWatch = (patch: Record<string, unknown>) => ({
      ...DEFAULT_ORG_SETTINGS,
      notifications: { ...DEFAULT_ORG_SETTINGS.notifications, progressionWatch: { ...pw, ...patch } },
    });
    expect(OrgSettingsSchema.safeParse(withWatch({ remindCoachAfterWeeks: 2, escalateAfterConsecutiveWeeks: 3 })).success).toBe(true);
    expect(OrgSettingsSchema.safeParse(withWatch({ remindCoachAfterWeeks: 2, escalateAfterConsecutiveWeeks: 2 })).success).toBe(false);
    expect(OrgSettingsSchema.safeParse(withWatch({ escalateTo: [] })).success).toBe(false);
    expect(OrgSettingsSchema.safeParse(withWatch({ escalationVisibleToCoach: true })).success).toBe(false);
    const onAssignment = { ...DEFAULT_ORG_SETTINGS.notifications.onAssignment, emailContainsPersonalData: true };
    expect(OrgSettingsSchema.safeParse({ ...DEFAULT_ORG_SETTINGS, notifications: { ...DEFAULT_ORG_SETTINGS.notifications, onAssignment } }).success).toBe(false);
  });

  it("konstanterna kan inte ändras av misstag", () => {
    expect(() => {
      (BOTKYRKA_CONFIG.phases[0] as { name: string }).name = "Ändrad";
    }).toThrow(TypeError);
    expect(BOTKYRKA_CONFIG.phases[0].name).toBe("Kartläggning");
  });
});

describe("ATT_FASTSTÄLLA", () => {
  it("isUnset känner igen värdet med och utan förklaring", () => {
    expect(isUnset("ATT_FASTSTÄLLA")).toBe(true);
    expect(isUnset("ATT_FASTSTÄLLA (förslag: 5 arbetsdagar)")).toBe(true);
    expect(isUnset(BOTKYRKA_CONFIG.retention)).toBe(true);
    expect(isUnset(BOTKYRKA_CONFIG.kpis[0].internalTarget)).toBe(false);
    for (const v of ["Fastställt", "", 0.32, 0, null, undefined, false, {}]) expect(isUnset(v)).toBe(false);
  });
  it("visas som Ej fastställt", () => {
    expect(UNSET_LABEL).toBe("Ej fastställt");
    expect(configValueText(kpiDef(BOTKYRKA_CONFIG, "narvarograd")?.internalTarget)).toBe("Ej fastställt");
    expect(configValueText(kpiDef(BOTKYRKA_CONFIG, "resultatgrad")?.internalTarget, (v) => `${Math.round(v * 100)} %`)).toBe("35 %");
    expect(configValueText(BOTKYRKA_CONFIG.retention)).toBe("Ej fastställt");
    expect(configValueText(null)).toBe("–");
  });
  it("förklaringen i klarspråk", () => {
    expect(unsetHint(slaRule(BOTKYRKA_CONFIG, "slutrapport")?.within)).toBe("Förslag: 5 arbetsdagar");
    expect(unsetHint(slaRule(BOTKYRKA_CONFIG, "manadsrapport")?.due)).toBe("Förslag: 5:e arbetsdagen efter månadsskiftet");
    expect(unsetHint(BOTKYRKA_CONFIG.customerVisibility.scope)).toBe("Alternativ: egna ärenden, enhetens ärenden eller alla");
    expect(unsetHint(BOTKYRKA_CONFIG.retention)).toBe("Fastställs enligt PUB-avtalet");
    expect(unsetHint(BOTKYRKA_CONFIG.bonus.model)).toBe("Fastställs enligt incitamentsmodellen");
    expect(unsetHint(BOTKYRKA_CONFIG.ai.provider)).toBe("Berget AI eller Gemini via Vertex AI EU");
    expect(unsetHint(BOTKYRKA_CONFIG.result.definition)).toBeNull();
    expect(unsetHint("Fastställt")).toBeNull();
  });
  it("unsetPaths listar alla värden som ska bekräftas med Botkyrka", () => {
    expect(unsetPaths(BOTKYRKA_CONFIG)).toEqual([
      "customerVisibility.scope",
      "result.definition",
      "result.excludedFromDenominator",
      "kpis[narvarograd].internalTarget",
      "kpis[nojdhet].internalTarget",
      "sla[manadsrapport].due",
      "sla[slutrapport].within",
      "attendance.sameDayNoticeOnInvalidAbsence",
      "bonus.model",
      "retention",
      "ai.provider",
    ]);
    expect(unsetPaths(KK_CONFIG)).toEqual([]);
  });
});

describe("hjälpare", () => {
  it("beställarreferens: 8–10 siffror, bara siffror", () => {
    expect(buyerRefLengthText(BOTKYRKA_CONFIG)).toBe("8–10");
    expect(buyerRefLengthText({ billing: { ...BOTKYRKA_CONFIG.billing, buyerReference: { required: true, pattern: "^[0-9]{9}$" } } })).toBe("9");
    const re = buyerRefPattern(BOTKYRKA_CONFIG);
    for (const ok of ["4410023817", "55102938", "7730045120"]) expect(re.test(ok)).toBe(true);
    for (const bad of ["1234567", "12345678901", "5510 2938", "5510-2938", "BOT-27-0049", ""]) expect(re.test(bad)).toBe(false);
  });
  it("inköpsordernummer: nio siffror som börjar med 99", () => {
    const re = purchaseOrderPattern(BOTKYRKA_CONFIG);
    expect(re.test("991234567")).toBe(true);
    for (const bad of ["981234567", "99123456", "9912345678", "BOT-27-0049"]) expect(re.test(bad)).toBe(false);
  });
  it("faser", () => {
    expect(phaseName(BOTKYRKA_CONFIG, 4)).toBe("Praktik/APL");
    expect(phaseName(BOTKYRKA_CONFIG, 1)).toBe("Kartläggning");
    expect(phaseName(BOTKYRKA_CONFIG, 9)).toBe("–");
    expect(phaseLabel(BOTKYRKA_CONFIG, 4)).toBe("Fas 4 · Praktik/APL");
    expect(stuckRule(BOTKYRKA_CONFIG, 3)).toEqual({ phase: 3, maxDays: 35, unlessPlacementPlanned: true });
    expect(stuckRule(BOTKYRKA_CONFIG, 2)).toBeNull();
  });
  it("progressionsområden med etiketter", () => {
    const areas = progressionAreas(BOTKYRKA_CONFIG);
    expect(areas).toHaveLength(10);
    expect(areas[0]).toEqual({ key: "narvaro_rutiner", label: "Närvaro, punktlighet och rutiner", optional: false });
    expect(areas[9]).toEqual({ key: "ovrigt", label: "Övrig relevant progression", optional: false });
    const all = progressionAreas(BOTKYRKA_CONFIG, { includeOptional: true });
    expect(all).toHaveLength(12);
    expect(all[11]).toEqual({ key: "livskvalitet_sjalvskattad", label: "Livskvalitet (deltagarens egen skattning)", optional: true });
    expect(progressionScaleLabel(BOTKYRKA_CONFIG, 2)).toBe("Tydlig");
    expect(progressionScaleLabel(BOTKYRKA_CONFIG, 0)).toBe("Ingen / för tidigt att bedöma");
  });
  it("SLA och KPI", () => {
    expect(slaWithin(BOTKYRKA_CONFIG, "avrop_svar")).toEqual({ workingDays: 1 });
    expect(slaWithin(BOTKYRKA_CONFIG, "forsta_mote")).toEqual({ days: 7 });
    expect(slaWithin(BOTKYRKA_CONFIG, "ordererkannande")).toEqual({ minutes: 5 });
    expect(slaWithin(BOTKYRKA_CONFIG, "slutrapport")).toBeNull();
    expect(slaWithin(BOTKYRKA_CONFIG, "finns_inte")).toBeNull();
    expect(slaRule(BOTKYRKA_CONFIG, "slutrapport")?.proposal).toEqual({ workingDays: 5 });
    expect(slaRule(BOTKYRKA_CONFIG, "veckorapport_registrering")).toMatchObject({ weekday: 0, time: "10:00" });
    expect(slaWithin(KK_CONFIG, "forsta_mote")).toEqual({ days: 10 });
    expect(kpiDef(BOTKYRKA_CONFIG, "resultatgrad")).toMatchObject({ contractTarget: 0.32, internalTarget: 0.35, minN: 10 });
    expect(kpiDef(KK_CONFIG, "placeringsgrad")?.contractTarget).toBe(0.6);
  });
  it("kommunens synlighet: preliminärt egna ärenden tills det är fastställt", () => {
    expect(effectiveVisibilityScope(BOTKYRKA_CONFIG)).toBe("own");
    expect(effectiveVisibilityScope({ customerVisibility: { ...BOTKYRKA_CONFIG.customerVisibility, scope: "unit" } })).toBe("unit");
  });
  it("vite och eskalering läses från konfigurationen", () => {
    expect(BOTKYRKA_CONFIG.penalties.deviationOre).toBe(2_500_000);
    expect(BOTKYRKA_CONFIG.warningsBeforeTermination).toBe(3);
    expect(BOTKYRKA_CONFIG.escalationLadder.map((s) => s.level)).toEqual(["mindre", "större", "allvarlig", "allvarlig", "hävning"]);
  });
});

describe("schema.ts", () => {
  it("TABLE_NAMES är unika och emptyDb har alla tabeller", () => {
    expect(new Set(TABLE_NAMES).size).toBe(TABLE_NAMES.length);
    const db = emptyDb();
    expect(Object.keys(db).sort()).toEqual([...TABLE_NAMES].sort());
    expect(db.cases).toEqual([]);
  });
  it("contracts.config tar emot båda avtalens konfiguration", () => {
    const c: Pick<Contract, "config">[] = [{ config: BOTKYRKA_CONFIG }, { config: KK_CONFIG }];
    expect(c.map((x) => x.config.casePrefix)).toEqual(["BOT", "KK"]);
  });
});
