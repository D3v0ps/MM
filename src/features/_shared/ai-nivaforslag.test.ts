// AI:s nivåförslag i månadsbedömningen (Karims beslut 2026-10-22): AI får FÖRESLÅ progressionsnivå 1–3 per område bara med ett
// ordagrant citat som finns i underlaget. Kontrollen (verifyLevelSuggestion) görs på servern oavsett leverantör – i den riktiga
// leverantörens validering (validateDraft) och i jobbet draft_monthly. Förslaget skrivs aldrig i nivån.
import { describe, expect, it, vi } from "vitest";
import type { CheckIn } from "@/data/schema";
import { draftInstructions, DRAFT_RESPONSE_SCHEMA } from "@/server/ai/prompts";
import { approvedCheckIns, DraftTextSchema, verifyLevelSuggestion, type DraftInput } from "./ai-port";
import { simulatedDraft } from "./ai-sim";

vi.mock("server-only", () => ({}));
const { validateDraft } = await import("@/server/ai/vertex");

const ci = (id: string, heldAt: string, p: Partial<CheckIn> = {}): CheckIn => ({
  id, caseId: "case-1", heldAt, durationMin: 45, mode: "fysiskt", inputMethod: "manual", goalStatus: "yes", nextGoal: "Söka två jobb i lager", phase: 3,
  activitiesDone: ["Yrkesspecifika moment"], employerContacts: { count: "1", types: ["intervju"] }, overallStatus: "green", obstacles: [],
  note: "Klarade veckans moment utan stöd. Tog egna initiativ.", status: "approved", approvedBy: "u-amira", approvedAt: heldAt, aiRunId: null, docMinutes: null, ai: null, version: 1, ...p,
});
const input: DraftInput = {
  caseId: "case-1", month: "2027-01",
  checkIns: approvedCheckIns([ci("ci-1", "2027-01-08T10:00"), ci("ci-2", "2027-01-15T10:00", { note: "Kom i tid alla dagar. Arbetade med CV." }), ci("ci-3", "2027-01-22T10:00")]),
  attendance: [{ status: "present" }, { status: "late" }],
  notes: [{ id: "note-1", date: "2027-01-26", kind: "practical", text: "Har fått egna skyddsskor och arbetskläder till yrkesmomenten." }],
};

describe("verifyLevelSuggestion: citatet måste finnas ordagrant i källan", () => {
  it("citat ur en godkänd mötesrapport: nivån, citatet, källans namn och dag (ur underlaget, inte från modellen)", () => {
    expect(verifyLevelSuggestion({ level: 2, quote: "Klarade veckans moment utan stöd.", sourceId: "ci-3" }, input)).toEqual({
      level: 2, evidence: { quote: "Klarade veckans moment utan stöd.", source: "Avstämning 22 jan", date: "2027-01-22" },
    });
  });

  it("citat ur en anteckning: källan heter Anteckning och dagen är anteckningens", () => {
    expect(verifyLevelSuggestion({ level: 1, quote: "egna skyddsskor och arbetskläder", sourceId: "note-1" }, input)?.evidence).toEqual({
      quote: "egna skyddsskor och arbetskläder", source: "Anteckning 26 jan", date: "2027-01-26",
    });
  });

  it("mellanslag och citattecken runt citatet räknas inte – orden måste vara desamma", () => {
    expect(verifyLevelSuggestion({ level: 1, quote: " ”Kom i  tid alla\ndagar.” ", sourceId: "ci-2" }, input)?.evidence.quote).toBe("Kom i tid alla dagar.");
    expect(verifyLevelSuggestion({ level: 1, quote: "Kom i tid alla veckor.", sourceId: "ci-2" }, input)).toBeNull();
  });

  it("förslaget slängs: citatet finns inte i källan, i en annan källa, okänd källa, för kort, personnummer, nivå utanför 1–3", () => {
    const bad: unknown[] = [
      { level: 2, quote: "Klarade allt på egen hand hela månaden.", sourceId: "ci-3" }, // påhittat
      { level: 2, quote: "Kom i tid alla dagar.", sourceId: "ci-3" }, // står i ci-2, inte i ci-3
      { level: 2, quote: "Klarade veckans moment utan stöd.", sourceId: "ci-x" },
      { level: 2, quote: "Klarade", sourceId: "ci-3" },
      { level: 2, quote: "19730216-9545", sourceId: "ci-3" },
      { level: 0, quote: "Klarade veckans moment utan stöd.", sourceId: "ci-3" },
      { level: 4, quote: "Klarade veckans moment utan stöd.", sourceId: "ci-3" },
      { level: 2, quote: "Klarade veckans moment utan stöd.", sourceId: "ci-3", overallStatus: "green" },
      null,
    ];
    for (const raw of bad) expect(verifyLevelSuggestion(raw, input), JSON.stringify(raw)).toBeNull();
  });
});

describe("den simulerade AI:n: nivåförslag bara med ett citat som klarar kontrollen", () => {
  it("yrkesfärdigheter: tre veckor med yrkesmoment ger nivå 2 med citat ur den senaste mötesrapporten", () => {
    const d = simulatedDraft(input, "monthly_area:yrkesfardigheter");
    expect(DraftTextSchema.parse(d)).toEqual(d);
    expect(d.levelSuggestion).toEqual({ level: 2, quote: "Klarade veckans moment utan stöd.", sourceId: "ci-3" });
    expect(verifyLevelSuggestion(d.levelSuggestion, input)).not.toBeNull();
  });

  it("närvaron ger aldrig ett förslag (siffror är inget citat); sammanfattning och plan har inga förslag", () => {
    for (const key of ["monthly_area:narvaro_rutiner", "monthly_summary", "monthly_plan"] as const) expect(simulatedDraft(input, key).levelSuggestion ?? null, key).toBeNull();
  });

  it("utan godkända mötesrapporter: inget förslag", () => {
    expect(simulatedDraft({ ...input, checkIns: [] }, "monthly_area:yrkesfardigheter").levelSuggestion ?? null).toBeNull();
  });
});

describe("den riktiga leverantören (Vertex AI): svaret valideras, förslaget kontrolleras", () => {
  const ok = { text: "Yrkesmoment tre veckor.", sourceIds: ["ci-3"], usedAttendance: false, noEvidence: false };

  it("ett förslag med citat ur underlaget behålls (citatet normaliserat) – bara för ett område", () => {
    const d = validateDraft({ ...ok, levelSuggestion: { level: 2, quote: "Klarade  veckans moment utan stöd.", sourceId: "ci-3" } }, input, "monthly_area:yrkesfardigheter");
    expect(d.levelSuggestion).toEqual({ level: 2, quote: "Klarade veckans moment utan stöd.", sourceId: "ci-3" });
    expect(validateDraft({ ...ok, levelSuggestion: { level: 2, quote: "Klarade veckans moment utan stöd.", sourceId: "ci-3" } }, input, "monthly_summary").levelSuggestion ?? null).toBeNull();
  });

  it("ett påhittat citat slängs – resten av utkastet gäller", () => {
    const d = validateDraft({ ...ok, levelSuggestion: { level: 3, quote: "Har fått fast anställning.", sourceId: "ci-3" } }, input, "monthly_area:beredskap");
    expect(d).toMatchObject({ text: "Yrkesmoment tre veckor.", noEvidence: false });
    expect(d.levelSuggestion ?? null).toBeNull();
    expect(validateDraft({ ...ok, levelSuggestion: null }, input, "monthly_area:beredskap").levelSuggestion ?? null).toBeNull();
  });

  it("instruktionerna: bara områden får föreslå nivå 1–3 med citat, skalan ur avtalet, aldrig samlad status", () => {
    const area = draftInstructions("monthly_area:yrkesfardigheter", { levelScale: { 1: "Liten förändring", 2: "Tydlig förändring", 3: "Uppnått delmål" } });
    expect(area).toContain("FÖRESLÅ progressionsnivå 1, 2 eller 3");
    expect(area).toContain("Skalan: 1 = Liten förändring, 2 = Tydlig förändring, 3 = Uppnått delmål.");
    expect(area).toContain("Sätt aldrig nivå, samlad status");
    expect(draftInstructions("monthly_summary")).toContain("levelSuggestion: alltid null.");
    expect((DRAFT_RESPONSE_SCHEMA.properties as Record<string, { nullable?: boolean }>).levelSuggestion?.nullable).toBe(true);
  });
});
