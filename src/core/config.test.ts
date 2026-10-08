import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_PROVIDER_LABEL,
  BOTKYRKA_CONFIG,
  ContractConfigSchema,
  DEFAULT_ORG_SETTINGS,
  OperationalConfigSchema,
  OrgSettingsSchema,
  RECORDING_KINDS,
  UNSET,
  UNSET_LABEL,
  aiLanguages,
  aiProviderText,
  buyerRefLengthText,
  buyerRefPattern,
  configValueText,
  effectiveVisibilityScope,
  isOperational,
  isUnset,
  kpiDef,
  levelIsAny,
  levelIsClear,
  monthlyReportWorkingDay,
  parseContractConfig,
  phaseLabel,
  phaseName,
  progressionAreas,
  progressionFlags,
  progressionRuleText,
  progressionScaleLabel,
  purchaseOrderPattern,
  recordingEnabled,
  recordingMaxMinutes,
  requireOperational,
  slaRule,
  slaWithin,
  stuckRule,
  unsetHint,
  unsetPaths,
} from "./config";
import { TABLE_NAMES, emptyDb, type Contract } from "@/data/schema";

/**
 * Ett nytt kommunavtal i utkast (påhittat): bara prefix, personuppgiftsroll och kommunens synlighet. Visar att schemat tar
 * emot ett avtal som ännu inte har alla driftavsnitt – flera avtal i datamodellen är en generell förmåga.
 */
const DRAFT = parseContractConfig({
  casePrefix: "NYK",
  dataRole: "processor",
  customerVisibility: { seesIndividualReports: false, seesCoachNotes: false },
  reportSchedule: { automatic: [] },
});

// ---------------------------------------------------------------- Den gamla prototypens värden (facit)
// CONFIG_BOT läses ur prototyp/src/01-seed.js (MM.seedConstants), S.orgConfig ur samma fil.
const seedSrc = readFileSync(new URL("../../prototyp/src/01-seed.js", import.meta.url), "utf8");
type Proto = { seedConstants: { CONFIG_BOT: unknown } };
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
function protoContractNotes(): Record<"c-bot", { termination: string; scope: string }> {
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
    // Avvikelser (beslut 2026-09-30, röstinspelning): ai-avsnittet och customerVisibility.seesParticipantVoiceNotes – se nästa test.
    // Tillägg (beslut 2026-10-01): reportSchedule – se testet för rapportutkasten nedan.
    // Avvikelse (beslut 2026-10-01, rapporter steg 2): progression.clearFromLevel/anyFromLevel ersätter fritexten statDefinition.
    // Avvikelse (beslut 2026-10-07): orderPeriods ersätter orderWeeks; selfRegistration och retentionRules är nya – se testet nedan.
    // Avvikelse (beslut 2026-10-07, synpunkt #13): en faktura per avtal och månad (billing.invoicePer, collectiveInvoiceAllowed).
    const { texts, ai, customerVisibility, reportSchedule, progression, orderPeriods, selfRegistration, retentionRules, billing, ...rest } = BOTKYRKA_CONFIG;
    void reportSchedule;
    void orderPeriods;
    void selfRegistration;
    void retentionRules;
    const { ai: protoAi, customerVisibility: protoVisibility, progression: protoProgression, orderWeeks: protoOrderWeeks, billing: protoBilling, ...protoRest } = proto.seedConstants.CONFIG_BOT as Record<string, unknown>;
    void protoOrderWeeks;
    expect(rest).toStrictEqual(protoRest);
    expect({ ...billing, invoicePer: "case_and_month", collectiveInvoiceAllowed: false }).toStrictEqual(protoBilling);
    const { clearFromLevel, anyFromLevel, ...prog } = progression;
    const { statDefinition, ...protoProg } = protoProgression as { statDefinition: { clear: string; any: string } };
    expect(prog).toStrictEqual(protoProg);
    // Samma gränser som prototypens text ("minst ett område på nivå >= 2" / ">= 1").
    expect(statDefinition).toStrictEqual({ clear: "minst ett område på nivå >= 2", any: "minst ett område på nivå >= 1" });
    expect([clearFromLevel, anyFromLevel]).toEqual([2, 1]);
    const { seesParticipantVoiceNotes, ...visibility } = customerVisibility;
    expect(visibility).toStrictEqual(protoVisibility);
    expect(seesParticipantVoiceNotes).toBe(false);
    expect(ai.recordingApprovedByCustomer).toBe((protoAi as { recordingApprovedByCustomer: string }).recordingApprovedByCustomer);
    expect(texts).toStrictEqual(notes["c-bot"]);
    expect(texts?.scope).toBe("Minst 70 och upp till 100 årsplatser i tolv avtalsområden (A–L). Miljonbemanning är rangordnad 1 i alla områden.");
  });
  it("Botkyrka: beställningen i månader, självregistrering på kommunens domän och bilagornas gallring ej fastställd (beslut 2026-10-07)", () => {
    expect(BOTKYRKA_CONFIG.orderPeriods).toStrictEqual({ months: [6, 12], allowOther: true });
    expect(BOTKYRKA_CONFIG.selfRegistration).toStrictEqual({ emailDomains: ["botkyrka.se"] });
    expect(isUnset(BOTKYRKA_CONFIG.retentionRules?.attachmentsAfterCloseDays)).toBe(true);
    expect("orderWeeks" in BOTKYRKA_CONFIG).toBe(false);
    // orderPeriods krävs i drift; orderWeeks läses inte längre.
    const noPeriods: Record<string, unknown> = { ...BOTKYRKA_CONFIG };
    delete noPeriods.orderPeriods;
    expect(OperationalConfigSchema.safeParse(noPeriods).success).toBe(false);
    // Självregistrering bara när kommunens användare ser sina egna ärenden (enheten är fritext och kan inte styra åtkomst).
    expect(ContractConfigSchema.safeParse({ ...BOTKYRKA_CONFIG, customerVisibility: { ...BOTKYRKA_CONFIG.customerVisibility, scope: "unit" } }).success).toBe(false);
    expect(ContractConfigSchema.safeParse({ ...BOTKYRKA_CONFIG, selfRegistration: { emailDomains: ["botkyrka.se", "botkyrka.se"] } }).success).toBe(false);
    expect(ContractConfigSchema.safeParse({ ...BOTKYRKA_CONFIG, selfRegistration: { emailDomains: ["@botkyrka.se"] } }).success).toBe(false);
    expect(ContractConfigSchema.safeParse({ ...BOTKYRKA_CONFIG, orderPeriods: { months: [6, 6], allowOther: true } }).success).toBe(false);
  });
  it("Botkyrka: AI via Vertex AI EU och alla tre inspelningsflödena påslagna (beslut 2026-09-30)", () => {
    expect(BOTKYRKA_CONFIG.ai).toStrictEqual({
      provider: "vertex_eu",
      recordingApprovedByCustomer: "2026-09-29",
      recording: { coach: true, customer: true, participant: true, approvedByCustomerOn: "2026-09-30" },
      maxMinutes: { coach: 60, customer: 5, participant: 5 },
      languages: ["sv", "en", "ar", "so"],
      participantLinkValidDays: 7,
    });
    // Samma språk som pulsmätningen.
    expect(BOTKYRKA_CONFIG.ai.languages).toEqual(BOTKYRKA_CONFIG.pulse.languages);
  });
  it("rapportutkast: Botkyrka skapar vecko-, månads- och beställarrapporter automatiskt med testdatats sista dagar, ett utkast inga", () => {
    expect(BOTKYRKA_CONFIG.reportSchedule).toStrictEqual({
      automatic: ["weekly_attendance", "monthly", "customer_summary"], monthly: { minEnrolledDays: 11 }, customerSummaryDue: { nthWorkingDay: 8, time: "16:00" },
    });
    // Veckorapporten och månadsrapporten förfaller enligt SLA-reglerna som redan finns.
    expect(slaRule(BOTKYRKA_CONFIG, "veckorapport_publicering")).toMatchObject({ weekday: 0, time: "16:00" });
    expect(slaRule(BOTKYRKA_CONFIG, "manadsrapport")?.proposal).toEqual({ nthWorkingDay: 5 });
    expect(DRAFT.reportSchedule).toStrictEqual({ automatic: [] });
    // Värdena är förslag (inte ATT_FASTSTÄLLA-texter) – listan över värden som ska bekräftas ändras inte.
    expect(unsetPaths(DRAFT)).toEqual([]);
  });
  it("interna regler är exakt prototypens S.orgConfig", () => {
    expect(DEFAULT_ORG_SETTINGS).toStrictEqual(protoOrgConfig());
  });
});

describe("zod-scheman", () => {
  it("Botkyrka och ett avtal i utkast parsar, bara Botkyrka är driftklar", () => {
    expect(ContractConfigSchema.safeParse(BOTKYRKA_CONFIG).success).toBe(true);
    expect(OperationalConfigSchema.safeParse(BOTKYRKA_CONFIG).success).toBe(true);
    expect(ContractConfigSchema.safeParse(DRAFT).success).toBe(true);
    expect(OperationalConfigSchema.safeParse(DRAFT).success).toBe(false);
    expect(isOperational(BOTKYRKA_CONFIG)).toBe(true);
    expect(isOperational(DRAFT)).toBe(false);
    expect(requireOperational(BOTKYRKA_CONFIG)).toBe(BOTKYRKA_CONFIG);
    expect(() => requireOperational(DRAFT)).toThrow(/NYK.*saknar.*phases/);
    // Samma värde från databasen (JSON) parsar till samma objekt.
    expect(parseContractConfig(JSON.parse(JSON.stringify(BOTKYRKA_CONFIG)))).toStrictEqual(BOTKYRKA_CONFIG);
  });

  it("fakturan: Botkyrka en faktura per avtal och månad (beslut 2026-10-07); en faktura per ärende finns kvar som val", () => {
    expect(BOTKYRKA_CONFIG.billing).toMatchObject({ invoicePer: "contract_and_month", collectiveInvoiceAllowed: true });
    expect(ContractConfigSchema.safeParse({ ...BOTKYRKA_CONFIG, billing: { ...BOTKYRKA_CONFIG.billing, invoicePer: "case_and_month", collectiveInvoiceAllowed: false } }).success).toBe(true);
    const r = ContractConfigSchema.safeParse({ ...BOTKYRKA_CONFIG, billing: { ...BOTKYRKA_CONFIG.billing, collectiveInvoiceAllowed: false } });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("samlingsfaktura");
  });

  const withBilling = (patch: Record<string, unknown>) => ({ ...BOTKYRKA_CONFIG, billing: { ...BOTKYRKA_CONFIG.billing, ...patch } });
  it("stoppar felaktig konfiguration", () => {
    const bad: unknown[] = [
      { ...BOTKYRKA_CONFIG, casePrefix: "bot" },
      { ...BOTKYRKA_CONFIG, casePrefx: "BOT" },
      withBilling({ buyerReference: { required: true, pattern: "^[0-9]{8,10$(" } }),
      withBilling({ unit: "hour" }),
      // En faktura per avtal och månad (beslut 2026-10-07) är en samlingsfaktura – den måste vara tillåten i avtalet.
      withBilling({ invoicePer: "contract_and_month", collectiveInvoiceAllowed: false }),
      withBilling({ invoicePer: "per_referens" }),
      // Kommunavtalen: MB är alltid personuppgiftsbiträde och priserna gäller per deltagare och vecka. Paket-, månads- och
      // styckpriser, mötesminimum och statistikexporter finns inte i Miljonmatch (beslut 2026-10-06).
      { ...BOTKYRKA_CONFIG, dataRole: "controller" },
      withBilling({ unit: "package" }),
      withBilling({ unit: "month" }),
      { ...DRAFT, priceItems: [{ code: "startpaket", unit: "package", packageMonths: 4, priceOre: 412000 }] },
      { ...DRAFT, meetingMinimums: [{ service: "startpaket", minMeetings: 4 }] },
      { ...DRAFT, exports: [{ key: "manadsstatistik", format: "xlsx" }] },
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
      // Rapportutkast: okänd rapporttyp, dubblett, beställarrapport utan sista dag, ogiltigt klockslag.
      { ...BOTKYRKA_CONFIG, reportSchedule: { automatic: ["final"] } },
      { ...BOTKYRKA_CONFIG, reportSchedule: { automatic: ["monthly", "monthly"] } },
      { ...BOTKYRKA_CONFIG, reportSchedule: { automatic: ["customer_summary"] } },
      { ...BOTKYRKA_CONFIG, reportSchedule: { automatic: ["customer_summary"], customerSummaryDue: { nthWorkingDay: 8, time: "16.00" } } },
      { ...BOTKYRKA_CONFIG, reportSchedule: { automatic: [], customerSummaryDue: { nthWorkingDay: 0, time: "16:00" } } },
      // Månadsrapport utan minsta antal inskrivna dagar, eller med 0 eller decimaler.
      { ...BOTKYRKA_CONFIG, reportSchedule: { automatic: ["monthly"] } },
      { ...BOTKYRKA_CONFIG, reportSchedule: { automatic: ["monthly"], monthly: { minEnrolledDays: 0 } } },
      { ...BOTKYRKA_CONFIG, reportSchedule: { automatic: ["monthly"], monthly: { minEnrolledDays: 10.5 } } },
      // En rapporttyp som skapas automatiskt utan sista dag i sla (då skulle inga rader skapas utan att någon märker det).
      { ...DRAFT, reportSchedule: { automatic: ["weekly_attendance", "monthly"], monthly: { minEnrolledDays: 11 } } },
      { ...BOTKYRKA_CONFIG, sla: BOTKYRKA_CONFIG.sla.map((r) => (r.key === "veckorapport_publicering" ? { key: r.key, weekday: 0 } : r)) },
      { ...BOTKYRKA_CONFIG, sla: BOTKYRKA_CONFIG.sla.map((r) => (r.key === "manadsrapport" ? { key: "manadsrapport", from: "manadsskifte", within: { days: 5 } } : r)) },
      { ...BOTKYRKA_CONFIG, sla: BOTKYRKA_CONFIG.sla.filter((r) => r.key !== "manadsrapport") },
    ];
    for (const b of bad) expect(ContractConfigSchema.safeParse(b).success, JSON.stringify(b).slice(0, 80)).toBe(false);
    // ATT_FASTSTÄLLA är tillåtet där värdet inte är fastställt.
    // (Utan självregistrering – med den krävs synligheten "own", se testet för besluten 2026-10-07.)
    const noSelfReg: Record<string, unknown> = { ...BOTKYRKA_CONFIG };
    delete noSelfReg.selfRegistration;
    expect(ContractConfigSchema.safeParse({ ...noSelfReg, customerVisibility: { ...BOTKYRKA_CONFIG.customerVisibility, scope: "unit" } }).success).toBe(true);
    expect(ContractConfigSchema.safeParse({ ...BOTKYRKA_CONFIG, kpis: [{ key: "a", internalTarget: UNSET }] }).success).toBe(true);
    // Avtalstexterna är valfria – ett nytt avtal utan texter parsar (administrationen visar "–").
    const noTexts: Record<string, unknown> = { ...BOTKYRKA_CONFIG };
    delete noTexts.texts;
    expect(OperationalConfigSchema.safeParse(noTexts).success).toBe(true);
    expect(ContractConfigSchema.safeParse({ ...DRAFT, texts: { termination: "Enligt avtalet." } }).success).toBe(true);
    // Rapportutkasten är valfria – utan avsnittet skapas inga rapporter automatiskt.
    const noSchedule: Record<string, unknown> = { ...BOTKYRKA_CONFIG };
    delete noSchedule.reportSchedule;
    expect(OperationalConfigSchema.safeParse(noSchedule).success).toBe(true);
    expect(ContractConfigSchema.safeParse({ ...BOTKYRKA_CONFIG, reportSchedule: { automatic: ["weekly_attendance", "monthly"], monthly: { minEnrolledDays: 1 } } }).success).toBe(true);
    // Ett avtal med bara beställarrapporten behöver ingen sla-regel för vecka eller månad.
    expect(ContractConfigSchema.safeParse({ ...DRAFT, reportSchedule: { automatic: ["customer_summary"], customerSummaryDue: { nthWorkingDay: 8, time: "16:00" } } }).success).toBe(true);
    // Månadsregeln i fastställd form (inom 5 arbetsdagar från månadsskiftet) räcker också – sista dagen blir densamma.
    const fixed = { ...BOTKYRKA_CONFIG, sla: BOTKYRKA_CONFIG.sla.map((r) => (r.key === "manadsrapport" ? { key: "manadsrapport", from: "manadsskifte", within: { workingDays: 5 } } : r)) };
    expect(ContractConfigSchema.safeParse(fixed).success).toBe(true);
    expect(monthlyReportWorkingDay(fixed)).toBe(5);
    expect(monthlyReportWorkingDay(BOTKYRKA_CONFIG)).toBe(5);
    expect(monthlyReportWorkingDay(DRAFT)).toBeNull();
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
    expect(unsetHint("ATT_FASTSTÄLLA (Berget AI eller Gemini via Vertex AI EU – väljs genom test)")).toBe("Berget AI eller Gemini via Vertex AI EU");
    expect(unsetHint(BOTKYRKA_CONFIG.ai.provider)).toBeNull(); // fastställd 2026-09-30
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
      "retentionRules.attachmentsAfterCloseDays",
    ]);
    expect(unsetPaths(DRAFT)).toEqual([]);
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
    expect(slaWithin(DRAFT, "forsta_mote")).toBeNull();
    expect(kpiDef(BOTKYRKA_CONFIG, "resultatgrad")).toMatchObject({ contractTarget: 0.32, internalTarget: 0.35, minN: 10 });
    expect(kpiDef(DRAFT, "resultatgrad")).toBeNull();
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

describe("tydlig och någon progression (beslut 2026-10-01)", () => {
  const withProg = (patch: Record<string, unknown>) => ({ ...BOTKYRKA_CONFIG, progression: { ...BOTKYRKA_CONFIG.progression, ...patch } });
  const lv = (level: number | null) => ({ level });
  it("levelIsClear och levelIsAny för ett enskilt område: gränsfall och tomma nivåer", () => {
    expect([0, 1, 2, 3].map((n) => levelIsClear(BOTKYRKA_CONFIG, n))).toEqual([false, false, true, true]);
    expect([0, 1, 2, 3].map((n) => levelIsAny(BOTKYRKA_CONFIG, n))).toEqual([false, true, true, true]);
    for (const empty of [null, undefined]) {
      expect(levelIsClear(BOTKYRKA_CONFIG, empty)).toBe(false);
      expect(levelIsAny(BOTKYRKA_CONFIG, empty)).toBe(false);
    }
    // Nivå 0 är "någon progression" bara om avtalet säger det (anyFromLevel 0) – null är aldrig bedömt.
    const zero = withProg({ anyFromLevel: 0 });
    expect(levelIsAny(zero, 0)).toBe(true);
    expect(levelIsAny(zero, null)).toBe(false);
  });
  it("progressionFlags: bara de obligatoriska områdena räknas – valfria och okända nycklar aldrig", () => {
    expect(progressionFlags(BOTKYRKA_CONFIG, { narvaro_rutiner: lv(2), yrkesfardigheter: lv(1), arbetskapacitet: lv(0), beredskap: lv(null) }))
      .toEqual({ assessed: 3, clearCount: 1, anyCount: 2, clear: true, any: true });
    // Hälsa och livskvalitet på nivå 3 ger ingen progression i statistiken.
    expect(progressionFlags(BOTKYRKA_CONFIG, { halsa_funktionellt: lv(3), livskvalitet_sjalvskattad: lv(3), okant: lv(3), narvaro_rutiner: lv(0) }))
      .toEqual({ assessed: 1, clearCount: 0, anyCount: 0, clear: false, any: false });
    expect(progressionFlags(BOTKYRKA_CONFIG, { narvaro_rutiner: lv(1), halsa_funktionellt: lv(2) })).toMatchObject({ clear: false, any: true, clearCount: 0, anyCount: 1 });
    expect(progressionFlags(BOTKYRKA_CONFIG, {})).toEqual({ assessed: 0, clearCount: 0, anyCount: 0, clear: false, any: false });
    expect(progressionFlags(BOTKYRKA_CONFIG, null)).toEqual({ assessed: 0, clearCount: 0, anyCount: 0, clear: false, any: false });
    // Med en högre gräns följer räkningen med.
    expect(progressionFlags(withProg({ clearFromLevel: 3 }), { narvaro_rutiner: lv(2), yrkesfardigheter: lv(3) })).toMatchObject({ clearCount: 1, anyCount: 2 });
  });
  it("texterna byggs av talen och av de valfria områdenas namn i konfigurationen", () => {
    const excluded = "Hälsa (funktionellt beskrivet) och livskvalitet (deltagarens egen skattning) är valfria områden och räknas inte.";
    expect(progressionRuleText(BOTKYRKA_CONFIG)).toEqual({ clear: "Minst ett område på nivå 2 eller högre", any: "Minst ett område på nivå 1 eller högre", excluded });
    expect(progressionRuleText(withProg({ clearFromLevel: 3, anyFromLevel: 2 }))).toEqual({ clear: "Minst ett område på nivå 3 eller högre", any: "Minst ett område på nivå 2 eller högre", excluded });
    // Kommunen ska se vilka områden som inte räknas – inte begreppet "obligatoriska områden".
    expect(progressionRuleText(withProg({ optionalAreas: ["halsa_funktionellt"] })).excluded).toBe("Hälsa (funktionellt beskrivet) är ett valfritt område och räknas inte.");
    expect(progressionRuleText(withProg({ optionalAreas: [] })).excluded).toBeNull();
  });
  it("zod: talen är obligatoriska, inom 0–3 och någon får inte kräva mer än tydlig", () => {
    const parse = (patch: Record<string, unknown>) => OperationalConfigSchema.safeParse(withProg(patch));
    expect(parse({}).success).toBe(true);
    expect(parse({ clearFromLevel: 3, anyFromLevel: 3 }).success).toBe(true);
    expect(parse({ clearFromLevel: 1, anyFromLevel: 0 }).success).toBe(true);
    const { clearFromLevel, ...noClear } = BOTKYRKA_CONFIG.progression;
    void clearFromLevel;
    expect(OperationalConfigSchema.safeParse({ ...BOTKYRKA_CONFIG, progression: noClear }).success).toBe(false);
    const { anyFromLevel, ...noAny } = BOTKYRKA_CONFIG.progression;
    void anyFromLevel;
    expect(OperationalConfigSchema.safeParse({ ...BOTKYRKA_CONFIG, progression: noAny }).success).toBe(false);
    expect(parse({ clearFromLevel: 0 }).success).toBe(false);
    expect(parse({ clearFromLevel: 4 }).success).toBe(false);
    expect(parse({ clearFromLevel: 2.5 }).success).toBe(false);
    expect(parse({ anyFromLevel: -1 }).success).toBe(false);
    const inverted = parse({ clearFromLevel: 1, anyFromLevel: 2 });
    expect(inverted.success).toBe(false);
    expect(inverted.error?.issues.map((i) => i.path.join("."))).toEqual(["progression.anyFromLevel"]);
    // Den äldre fritexten (statDefinition) validerar fortfarande men behövs inte.
    expect(parse({ statDefinition: { clear: "minst ett område på nivå >= 2", any: "minst ett område på nivå >= 1" } }).success).toBe(true);
    expect("statDefinition" in BOTKYRKA_CONFIG.progression).toBe(false);
  });
});

describe("AI och röstinspelning (ai)", () => {
  const withAi = (patch: Record<string, unknown>) => ({ ...BOTKYRKA_CONFIG, ai: { ...BOTKYRKA_CONFIG.ai, ...patch } });
  const recording = (patch: Record<string, unknown>) => withAi({ recording: { ...BOTKYRKA_CONFIG.ai.recording, ...patch } });

  it("Botkyrka: alla tre flödena påslagna, med maxlängd per flöde", () => {
    for (const kind of RECORDING_KINDS) expect(recordingEnabled(BOTKYRKA_CONFIG, kind), kind).toBe(true);
    expect(RECORDING_KINDS.map((k) => recordingMaxMinutes(BOTKYRKA_CONFIG, k))).toEqual([60, 5, 5]);
    expect(aiLanguages(BOTKYRKA_CONFIG)).toEqual(["sv", "en", "ar", "so"]);
    expect(aiProviderText(BOTKYRKA_CONFIG)).toBe(AI_PROVIDER_LABEL.vertex_eu);
    expect(aiProviderText(BOTKYRKA_CONFIG)).toBe("Gemini Flash via Google Cloud Vertex AI (EU)");
  });

  it("avtal utan ai-avsnitt: allt avstängt", () => {
    expect(DRAFT.ai).toBeUndefined();
    for (const kind of RECORDING_KINDS) {
      expect(recordingEnabled(DRAFT, kind), kind).toBe(false);
      expect(recordingMaxMinutes(DRAFT, kind), kind).toBeNull();
    }
    expect(aiLanguages(DRAFT)).toEqual(["sv"]);
    expect(aiProviderText(DRAFT)).toBe("–");
    expect(recordingEnabled(null, "coach")).toBe(false);
  });

  it("varje flöde kan slås av för sig, och inget flöde är på utan fastställd leverantör", () => {
    const noParticipant = ContractConfigSchema.parse(recording({ participant: false }));
    expect(RECORDING_KINDS.map((k) => recordingEnabled(noParticipant, k))).toEqual([true, true, false]);
    const unsetProvider = ContractConfigSchema.parse(withAi({ provider: "ATT_FASTSTÄLLA (väljs genom test)" }));
    expect(RECORDING_KINDS.map((k) => recordingEnabled(unsetProvider, k))).toEqual([false, false, false]);
    expect(aiProviderText(unsetProvider)).toBe("Ej fastställt");
    expect(unsetPaths(unsetProvider)).toContain("ai.provider");
  });

  it("tål en äldre sparad konfiguration (före röstinspelningen) – då är inspelning avstängd", () => {
    const old = { ai: { provider: "ATT_FASTSTÄLLA (Berget AI eller Gemini via Vertex AI EU – väljs genom test)", recordingApprovedByCustomer: "2026-09-29" } } as never;
    for (const kind of RECORDING_KINDS) expect(recordingEnabled(old, kind)).toBe(false);
    expect(aiLanguages(old)).toEqual(["sv"]);
    // Men den gamla formen godkänns inte längre av schemat (flödena, maxlängden och språken krävs).
    expect(ContractConfigSchema.safeParse({ ...BOTKYRKA_CONFIG, ...(old as object) }).success).toBe(false);
  });

  it("stoppar felaktiga AI-avsnitt", () => {
    const bad: unknown[] = [
      withAi({ provider: "ai_studio" }), // aldrig AI Studio eller global endpoint
      withAi({ provider: "gemini_global" }),
      recording({ approvedByCustomerOn: null }), // inspelning kräver kommunens skriftliga godkännande
      withAi({ languages: ["en", "ar"] }), // svenska måste finnas
      withAi({ languages: ["sv", "sv"] }),
      withAi({ languages: ["svenska"] }),
      withAi({ maxMinutes: { coach: 0, customer: 5, participant: 5 } }),
      withAi({ maxMinutes: { coach: 60, customer: 5 } }),
      withAi({ participantLinkValidDays: 0 }),
      withAi({ extra: true }),
      recording({ teams: true }),
    ];
    for (const b of bad) expect(ContractConfigSchema.safeParse(b).success, JSON.stringify((b as { ai: unknown }).ai).slice(0, 120)).toBe(false);
    // Allt avstängt behöver inget godkännande.
    expect(ContractConfigSchema.safeParse(recording({ coach: false, customer: false, participant: false, approvedByCustomerOn: null })).success).toBe(true);
  });
});

describe("schema.ts", () => {
  it("TABLE_NAMES är unika och emptyDb har alla tabeller", () => {
    expect(new Set(TABLE_NAMES).size).toBe(TABLE_NAMES.length);
    const db = emptyDb();
    expect(Object.keys(db).sort()).toEqual([...TABLE_NAMES].sort());
    expect(db.cases).toEqual([]);
  });
  it("contracts.config tar emot ett driftklart avtal och ett avtal i utkast", () => {
    const c: Pick<Contract, "config">[] = [{ config: BOTKYRKA_CONFIG }, { config: DRAFT }];
    expect(c.map((x) => x.config.casePrefix)).toEqual(["BOT", "NYK"]);
  });
});
