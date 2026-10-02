// Rapportbyggarens definition (Del B1): strikt schema, regler per datamängd, perioden i Stockholms tid och rapportens namn.
import { describe, expect, it } from "vitest";
import { charCount, definitionError, definitionIssue, firstChars, ReportDefinitionSchema, resolvePeriod, TitleSchema, titleError, type ReportDefinition } from "./definition";
import { summaryDef } from "./fixtures.test-helper";

const err = (d: unknown) => definitionError(d);
const list = (dataset: ReportDefinition["dataset"], columns: string[], p: Partial<ReportDefinition> = {}) =>
  summaryDef({ dataset, output: "lista", measures: [], columns, ...p });

describe("ReportDefinitionSchema", () => {
  it("en giltig sammanställning och en giltig lista godkänns", () => {
    expect(err(summaryDef())).toBeNull();
    expect(err(list("deltagarmanader", ["resultat.arendenummer", "resultat.namn", "resultat.niva_yrkesfardigheter"]))).toBeNull();
  });
  it("strikt: okänd nyckel nekas – också i urvalet och perioden", () => {
    expect(err({ ...summaryDef(), extra: 1 })).not.toBeNull();
    expect(err(summaryDef({ filters: { coach: ["u-amira"] } as never }))).not.toBeNull();
    expect(err(summaryDef({ period: { kind: "fast", from: "2026-10", to: "2026-12", x: 1 } as never }))).not.toBeNull();
    expect(err({ ...summaryDef(), v: 2 })).not.toBeNull();
  });
  it("arendenummer och namn kan aldrig bli urval eller uppdelning", () => {
    expect(err(summaryDef({ groupBy: "arendenummer" as never }))).not.toBeNull();
    expect(err(summaryDef({ groupBy: "namn" as never }))).not.toBeNull();
    expect(err(summaryDef({ filters: { arendenummer: ["BOT-26-0001"] } as never }))).not.toBeNull();
    expect(err(summaryDef({ filters: { namn: ["Anna"] } as never }))).not.toBeNull();
  });
  it("urval, uppdelning och mått som inte hör till datamängden nekas", () => {
    expect(err(summaryDef({ filters: { handelse_kod: ["arbete_paborjat"] } }))).toBe("Urvalet Händelse finns inte för Deltagarmånader.");
    expect(err(summaryDef({ groupBy: "omrade_kod" }))).toBe("Uppdelningen Område finns inte för Deltagarmånader.");
    expect(err(summaryDef({ measures: ["resultatgrad"] }))).toBe("Måttet Resultatgrad finns inte för Deltagarmånader.");
    // Kopplade dimensioner är urval och uppdelning för avslut, händelser och progression.
    expect(err(summaryDef({ dataset: "avslut", measures: ["avslut"], groupBy: "avtalsomrade_kod", filters: { yrkesspar: ["Truckförare"] } }))).toBeNull();
    expect(err(summaryDef({ dataset: "avslut", measures: ["avslut"], groupBy: "fas_nr" }))).toBe("Uppdelningen Fas finns inte för Avslut.");
    expect(err(summaryDef({ dataset: "handelser", measures: ["handelser"], groupBy: "fas_nr" }))).toBeNull();
  });
  it("sammanställning: 1–4 mått (räknas i mått – fördelningen är ett mått med fem kolumner), inga kolumner", () => {
    expect(err(summaryDef({ measures: [] }))).toBe("Välj minst ett mått.");
    expect(err(summaryDef({ measures: ["deltagarmanader", "narvarograd", "tydlig_progression", "nagon_progression", "avstamningar"] }))).toBe("Välj högst fyra mått.");
    expect(err(summaryDef({ measures: ["deltagarmanader", "narvarograd", "tydlig_progression", "nagon_progression"] }))).toBeNull();
    expect(err(summaryDef({ columns: ["resultat.arendenummer"] }))).not.toBeNull();
    expect(err(summaryDef({ dataset: "progression", measures: ["fordelning"], groupBy: "omrade_kod" }))).toBeNull();
  });
  it("staplar: ett av de valda måtten med en kolumn – aldrig fördelningen", () => {
    expect(err(summaryDef({ dataset: "progression", measures: ["fordelning"], chart: { measure: "fordelning" } }))).toBe("Fördelningen per nivå kan inte visas som staplar.");
    expect(err(summaryDef({ measures: ["deltagarmanader"], chart: { measure: "narvarograd" } }))).toBe("Diagrammet ska visa ett av de valda måtten.");
    expect(err(summaryDef({ measures: ["deltagarmanader", "narvarograd"], chart: { measure: "narvarograd" } }))).toBeNull();
  });
  it("lista: inga mått, ingen uppdelning, inget diagram, 1–40 kolumner och ärendenumret först", () => {
    expect(err(list("deltagarmanader", ["resultat.namn", "resultat.arendenummer"]))).toBe("Ärendenumret ska vara den första kolumnen.");
    expect(err(list("deltagarmanader", []))).toBe("Välj minst en kolumn.");
    expect(err(list("deltagarmanader", ["resultat.arendenummer"], { measures: ["deltagarmanader"] }))).not.toBeNull();
    expect(err(list("deltagarmanader", ["resultat.arendenummer"], { groupBy: "avtalsomrade_kod" }))).not.toBeNull();
    expect(err(list("deltagarmanader", ["resultat.arendenummer"], { split: "manad" }))).not.toBeNull();
    expect(err(list("deltagarmanader", ["resultat.arendenummer"], { chart: { measure: "deltagarmanader" } }))).not.toBeNull();
    const many = Array.from({ length: 41 }, (_, i) => (i === 0 ? "resultat.arendenummer" : `resultat.niva_x${i}`));
    expect(err(list("deltagarmanader", many))).toBe("Välj högst 40 kolumner.");
  });
  it("listans kolumner kommer bara ur datamängdens egen tabell – namnet bara i deltagarmånader", () => {
    expect(err(list("avslut", ["avslut.arendenummer", "resultat.namn"]))).toBe("Kolumnen resultat.namn finns inte för Avslut.");
    expect(err(list("handelser", ["handelser.arendenummer", "resultat.yrkesspar"]))).toBe("Kolumnen resultat.yrkesspar finns inte för Händelser.");
    expect(err(list("avslut", ["resultat.arendenummer"]))).toBe("Ärendenumret ska vara den första kolumnen.");
    expect(err(list("avslut", ["avslut.arendenummer", "avslut.resultat_verifierat"]))).toBeNull();
    expect(err(list("progression", ["progression.arendenummer", "progression.namn"]))).toBe("Kolumnen progression.namn finns inte för Progression.");
    expect(err(list("deltagarmanader", ["resultat.arendenummer", "resultat.finns_inte"]))).toBe("Kolumnen resultat.finns_inte finns inte för Deltagarmånader.");
  });
  it("fast period: från före till och högst 12 månader; senaste N 1–12", () => {
    expect(err(summaryDef({ period: { kind: "fast", from: "2026-12", to: "2026-10" } }))).toBe("Till-månaden kan inte vara före från-månaden.");
    expect(err(summaryDef({ period: { kind: "fast", from: "2026-01", to: "2027-01" } }))).toBe("Välj högst 12 månader.");
    expect(err(summaryDef({ period: { kind: "fast", from: "2026-02", to: "2027-01" } }))).toBeNull();
    expect(err(summaryDef({ period: { kind: "senaste", months: 13 } }))).not.toBeNull();
    expect(err(summaryDef({ period: { kind: "senaste", months: 0 } }))).not.toBeNull();
  });
  it("definitionIssue: felet och steget i byggaren där det rättas (perioden och urvalet i steg 2, visningen i steg 3)", () => {
    expect(definitionIssue(summaryDef())).toBeNull();
    expect(definitionIssue(summaryDef({ period: { kind: "fast", from: "2027-01", to: "2026-10" } }))).toEqual({ message: "Till-månaden kan inte vara före från-månaden.", step: "urval" });
    expect(definitionIssue(summaryDef({ filters: { handelse_kod: ["praktik_startad"] } }))).toMatchObject({ step: "urval" });
    expect(definitionIssue(summaryDef({ measures: [] }))).toEqual({ message: "Välj minst ett mått.", step: "visa" });
  });
  it("urvalets värden får inte se ut som personnummer", () => {
    expect(err(summaryDef({ filters: { yrkesspar: ["850101-1234"] } }))).toBe("Ett urval får inte innehålla personnummer.");
  });
  it("schemat är strikt även för typerna (zod-parse)", () => {
    expect(ReportDefinitionSchema.safeParse(summaryDef()).success).toBe(true);
  });
});

describe("resolvePeriod", () => {
  const start = "2026-09-10";
  it("senaste N i Stockholms tid: 23.30 den 31 januari ger december som sista månad, 00.05 den 1 februari januari", () => {
    expect(resolvePeriod({ kind: "senaste", months: 3 }, { now: "2027-01-31T23:30", contractStart: start })).toEqual({ from: "2026-10", to: "2026-12" });
    expect(resolvePeriod({ kind: "senaste", months: 3 }, { now: "2027-02-01T00:05", contractStart: start })).toEqual({ from: "2026-11", to: "2027-01" });
  });
  it("klipps vid avtalets start; hela perioden före starten ger ett fel", () => {
    expect(resolvePeriod({ kind: "senaste", months: 12 }, { now: "2027-02-01T09:12", contractStart: start })).toEqual({ from: "2026-09", to: "2027-01" });
    expect(resolvePeriod({ kind: "senaste", months: 6 }, { now: "2026-09-20T09:00", contractStart: start })).toEqual({ error: "Avtalet har inga hela månader i perioden ännu." });
    expect(resolvePeriod({ kind: "senaste", months: 1 }, { now: "2026-10-01T09:00", contractStart: start })).toEqual({ from: "2026-09", to: "2026-09" });
  });
  it("fast period med steg 3:s regler", () => {
    expect(resolvePeriod({ kind: "fast", from: "2026-10", to: "2026-12" }, { now: "2027-02-01T09:12", contractStart: start })).toEqual({ from: "2026-10", to: "2026-12" });
    expect(resolvePeriod({ kind: "fast", from: "2026-08", to: "2026-12" }, { now: "2027-02-01T09:12", contractStart: start })).toEqual({ error: "Välj månader från september 2026 till februari 2027." });
  });
});

describe("TitleSchema", () => {
  it("personnummer, ärendenummer (även med gemener) och formeltecken först nekas; längden 3–80", () => {
    expect(titleError("123456-7890")).toBe("Det ser ut som ett personnummer. Skriv inga namn, personnummer eller ärendenummer.");
    expect(titleError("Rapport 19850101-1234")).toMatch(/^Det ser ut som ett personnummer/);
    expect(titleError("Avslut BOT-26-0143")).toBe("Det ser ut som ett ärendenummer. Skriv inga namn, personnummer eller ärendenummer.");
    expect(titleError("avslut bot-26-0143")).toMatch(/^Det ser ut som ett ärendenummer/);
    for (const s of ["=SUMMA(A1)", "+1 rapport", "-rapport", "@rapport"]) expect(titleError(s), s).toBe("Namnet kan inte börja med =, +, - eller @.");
    expect(titleError("ab")).toBe("Namnet ska ha minst 3 tecken.");
    expect(titleError("x".repeat(81))).toBe("Namnet får ha högst 80 tecken.");
    expect(titleError("  Närvaro hösten  ")).toBeNull();
    expect(TitleSchema.parse("  Närvaro hösten  ")).toBe("Närvaro hösten");
  });
  it("längden räknas i tecken som i databasen (char_length) – en emoji är ett tecken, inte två", () => {
    // "a📊" och "📊📊" är 3 och 4 i JavaScript men 2 i Postgres.
    expect(titleError("a📊")).toBe("Namnet ska ha minst 3 tecken.");
    expect(titleError("📊📊")).toBe("Namnet ska ha minst 3 tecken.");
    expect(titleError("ab📊")).toBeNull();
    expect(titleError("📊".repeat(80))).toBeNull();
    expect(titleError("📊".repeat(81))).toBe("Namnet får ha högst 80 tecken.");
    expect(charCount("Rapport 📊")).toBe(9);
    // Kortningen delar aldrig en emoji (ingen ensam surrogathalva).
    expect(firstChars("ab📊c", 3)).toBe("ab📊");
  });
});
