// Bonusstegen 1–5 (Karims beslut 2026-11-04, SPEC §7.17): reglerna för förslagen, gränsfallen för fönstret efter insatsen,
// snabbhetspremien och hållbart resultat, kontrollerna innan coachen skickar och taket per deltagare. Ren logik – påhittade
// ärenden, alla värden ur Botkyrkas konfiguration.
import { describe, expect, it } from "vitest";
import type { BonusClaim, MonthlyAssessment } from "@/data/schema";
import {
  BONUS_STATUS_TEXT, bonusAttendance, bonusSuggestions, capAmounts, duringInsats, inResultWindow, manualCreateProblem, resultWindowEnd, speedDeadline, stepKind,
  submitProblems, sustainDate, type BonusRuleDb, type SubmitContext,
} from "./bonus";
import { BOTKYRKA_CONFIG, bonusBillingModel } from "./config";
import { mkActivity, mkAttendance, mkCase, mkEvent, testDb } from "./test-data";

const M = bonusBillingModel(BOTKYRKA_CONFIG)!;
const env = (day: string) => ({ now: `${day}T09:00` });

const mkClaim = (p: Partial<BonusClaim> & { id: string; caseId: string; step: number; status: BonusClaim["status"] }): BonusClaim => ({
  contractId: "c-bot", kind: stepKind(p.step), source: "auto", basis: "", evidencePaths: [], outcomeEventId: null, followsClaimId: null, reachedOn: null,
  verificationKind: null, verificationOn: null, checklist: {}, snapshot: null, createdBy: "system", createdAt: "2027-01-02T06:00", submittedAt: null, submittedBy: null,
  withdrawnBy: null, withdrawnAt: null, customerDecision: null, decidedBy: null, decidedAt: null, decisionNote: null, amountOre: null, invoiceDraftId: null, ...p,
});
const mkAssessment = (caseId: string, month: string, status: MonthlyAssessment["status"] = "approved"): MonthlyAssessment => ({
  id: `ma-${caseId}-${month}`, caseId, month, areas: {}, status, decidedBy: "u-amira", decidedAt: `${month}-28T10:00`, summary: "", aiSummaryDraft: null, overallStatus: null,
  version: 1, prefill: {},
});
const db = (p: Partial<BonusRuleDb>): BonusRuleDb => ({ ...testDb(), ...p });
const steps = (s: { step: number }[]) => s.map((x) => x.step);

describe("modellen ur konfigurationen", () => {
  it("steg 1–2 är progression, 3–5 arbete eller studier; läget alltid som text och ikon", () => {
    expect([1, 2, 3, 4, 5].map(stepKind)).toEqual(["progression", "progression", "work", "work", "work"]);
    for (const s of Object.values(BONUS_STATUS_TEXT)) expect(s.text.length > 0 && s.icon.length > 0).toBe(true);
  });
  it("fönstret efter insatsen: till och med tre månader efter slutdatum – dagen efter ligger utanför", () => {
    const c = { startDate: "2026-09-01", endDate: "2026-12-18" };
    expect(resultWindowEnd(c, M)).toBe("2027-03-18");
    expect(inResultWindow(c, "2027-03-18", M)).toBe(true);
    expect(inResultWindow(c, "2027-03-19", M)).toBe(false);
    expect(inResultWindow(c, "2026-08-31", M)).toBe(false);
    // Pågående insats: allt från start.
    expect(inResultWindow({ startDate: "2026-09-01", endDate: null }, "2028-01-01", M)).toBe(true);
    // Månadens sista dag klipps: 30 november + 3 månader = 28 februari.
    expect(resultWindowEnd({ endDate: "2026-11-30" }, M)).toBe("2027-02-28");
  });
  it("under insatsen, snabbhetspremiens sista dag och hållbart resultat", () => {
    expect(duringInsats({ startDate: "2027-01-04", endDate: "2027-03-12" }, "2027-03-12", "2027-04-01")).toBe(true);
    expect(duringInsats({ startDate: "2027-01-04", endDate: "2027-03-12" }, "2027-03-13", "2027-04-01")).toBe(false);
    expect(duringInsats({ startDate: "2027-01-04", endDate: null }, "2027-02-02", "2027-02-01")).toBe(false);
    expect(speedDeadline("2027-01-04", M)).toBe("2027-03-15"); // 10 veckor
    expect(sustainDate("2026-10-16", M)).toBe("2027-01-16"); // 3 månader
  });
});

describe("förslagen från regeln", () => {
  const C = mkCase({ id: "case-a", startDate: "2027-01-04" });
  const work = (id: string, day: string, verified = true) => mkEvent({ id, caseId: C.id, kind: "arbete_paborjat", occurredOn: day, verificationKind: verified ? "anställningsavtal" : null });

  it("steg 3 med verifiering ger steg 3 och – inom tio veckor från start – steg 5 som bygger på det", () => {
    const s = bonusSuggestions(db({ cases: [C], outcome_events: [work("e1", "2027-02-10")] }), M, env("2027-02-15"));
    expect(s.map((x) => [x.step, x.outcomeEventId, x.follows, x.reachedOn])).toEqual([[3, "e1", null, "2027-02-10"], [5, null, "new", "2027-02-10"]]);
  });
  it("utan registrerad verifiering: inget förslag till steg 3", () => {
    expect(bonusSuggestions(db({ cases: [C], outcome_events: [work("e1", "2027-02-10", false)] }), M, env("2027-02-15"))).toEqual([]);
  });
  it("snabbhetspremien: resultatet på tionde veckans sista dag räknas, dagen efter inte", () => {
    expect(steps(bonusSuggestions(db({ cases: [C], outcome_events: [work("e1", "2027-03-15")] }), M, env("2027-04-01")))).toEqual([3, 5]);
    expect(steps(bonusSuggestions(db({ cases: [C], outcome_events: [work("e1", "2027-03-16")] }), M, env("2027-04-01")))).toEqual([3]);
  });
  it("i anslutning till insatsen: tre månader efter slutdatum räknas, dagen efter inte", () => {
    const closed = mkCase({ id: "case-b", status: "closed", startDate: "2026-09-01", endDate: "2026-12-18" });
    const ev = (day: string) => mkEvent({ id: "e2", caseId: closed.id, kind: "studier_paborjade", occurredOn: day, verificationKind: "antagningsbesked" });
    expect(steps(bonusSuggestions(db({ cases: [closed], outcome_events: [ev("2027-03-18")] }), M, env("2027-04-01")))).toEqual([3]);
    expect(bonusSuggestions(db({ cases: [closed], outcome_events: [ev("2027-03-19")] }), M, env("2027-04-01"))).toEqual([]);
  });
  it("en händelse i framtiden, ett ärende som inte startat och en avböjd beställning ger inga förslag", () => {
    expect(bonusSuggestions(db({ cases: [C], outcome_events: [work("e1", "2027-02-20")] }), M, env("2027-02-15"))).toEqual([]);
    const notStarted = mkCase({ id: "case-c", status: "confirmed", startDate: null });
    const declined = mkCase({ id: "case-d", status: "declined", startDate: "2027-01-04" });
    const evs = [notStarted, declined].map((c) => mkEvent({ id: `e-${c.id}`, caseId: c.id, kind: "arbete_paborjat", occurredOn: "2027-01-20", verificationKind: "anställningsavtal" }));
    expect(bonusSuggestions(db({ cases: [notStarted, declined], outcome_events: evs }), M, env("2027-02-15"))).toEqual([]);
  });
  it("steg 2: en händelse av rätt typ under insatsen – inte efter slutdatum, inte en annan typ", () => {
    const c = mkCase({ id: "case-e", status: "closed", startDate: "2026-10-01", endDate: "2026-12-31" });
    const ev = (id: string, kind: "praktik_startad" | "arbetserbjudande", day: string) => mkEvent({ id, caseId: c.id, kind, occurredOn: day });
    expect(bonusSuggestions(db({ cases: [c], outcome_events: [ev("p1", "praktik_startad", "2026-11-02")] }), M, env("2027-02-01")).map((x) => [x.step, x.outcomeEventId]))
      .toEqual([[2, "p1"]]);
    expect(bonusSuggestions(db({ cases: [c], outcome_events: [ev("p2", "praktik_startad", "2027-01-05")] }), M, env("2027-02-01"))).toEqual([]);
    expect(bonusSuggestions(db({ cases: [c], outcome_events: [ev("p3", "arbetserbjudande", "2026-11-02")] }), M, env("2027-02-01"))).toEqual([]);
  });
  it("steg 4: tre månader efter steg 3:s resultatdatum och bara när steg 3 är skickat eller godkänt", () => {
    const c = mkCase({ id: "case-f", startDate: "2026-09-24" });
    const s3 = (status: BonusClaim["status"]) => mkClaim({ id: "k3", caseId: c.id, step: 3, status, reachedOn: "2026-10-16", outcomeEventId: "e9", verificationKind: "anställningsavtal" });
    // Steg 5 finns redan (ett förslag per steg).
    const s5 = mkClaim({ id: "k5", caseId: c.id, step: 5, status: "approved", followsClaimId: "k3" });
    const at = (day: string, status: BonusClaim["status"]) => bonusSuggestions(db({ cases: [c], bonus_claims: [s3(status), s5] }), M, env(day));
    expect(at("2027-01-15", "approved")).toEqual([]);
    expect(at("2027-01-16", "approved").map((x) => [x.step, x.follows, x.reachedOn])).toEqual([[4, "k3", "2027-01-16"]]);
    expect(at("2027-01-16", "submitted").map((x) => x.step)).toEqual([4]);
    expect(at("2027-01-16", "suggested")).toEqual([]);
  });
  it("steg 1: närvaro minst 80 % (gränsen exakt) och minst två godkända månadsbedömningar", () => {
    const c = mkCase({ id: "case-g", startDate: "2026-11-02" });
    const acts = [1, 2, 3, 4, 5].map((i) => mkActivity({ id: `a${i}`, caseId: c.id, startsAt: `2026-11-0${i + 2}T09:00` }));
    const att = (absent: number) => acts.map((a, i) => mkAttendance({ activityId: a.id, caseId: c.id, status: i < absent ? "absent_invalid" : "present" }));
    const two = [mkAssessment(c.id, "2026-11"), mkAssessment(c.id, "2026-12")];
    const run = (absent: number, ma: MonthlyAssessment[]) => bonusSuggestions(db({ cases: [c], activities: acts, attendance: att(absent), monthly_assessments: ma }), M, env("2027-01-10"));
    expect(run(1, two).map((x) => [x.step, x.reachedOn])).toEqual([[1, "2027-01-10"]]); // 4 av 5 = 80 %
    expect(run(2, two)).toEqual([]); // 3 av 5 = 60 %
    expect(run(1, [two[0], mkAssessment(c.id, "2026-12", "draft")])).toEqual([]); // bara en godkänd
    expect(bonusAttendance(db({ activities: acts, attendance: att(1) }), c, M, env("2027-01-10"))).toEqual({ planned: 5, registered: 5, attended: 4, percent: 80, meets: true });
  });
  it("idempotent: samma data ger inga nya förslag när förslagen finns – och aldrig ett andra för samma underlag", () => {
    const events = [work("e1", "2027-02-10")];
    const first = bonusSuggestions(db({ cases: [C], outcome_events: events }), M, env("2027-02-15"));
    const claims = [
      mkClaim({ id: "k3", caseId: C.id, step: 3, status: "suggested", outcomeEventId: "e1", reachedOn: "2027-02-10" }),
      mkClaim({ id: "k5", caseId: C.id, step: 5, status: "suggested", followsClaimId: "k3", reachedOn: "2027-02-10" }),
    ];
    expect(first).toHaveLength(2);
    expect(bonusSuggestions(db({ cases: [C], outcome_events: events, bonus_claims: claims }), M, env("2027-02-16"))).toEqual([]);
    // Avslaget eller återtaget: samma händelse föreslås inte igen (coachen kan skapa ett nytt anspråk själv)…
    const closed = claims.map((k) => ({ ...k, status: k.step === 3 ? ("rejected" as const) : ("withdrawn" as const) }));
    expect(bonusSuggestions(db({ cases: [C], outcome_events: events, bonus_claims: closed }), M, env("2027-02-16"))).toEqual([]);
    // …men en ny händelse (en ny anställning) gör det.
    const more = [...events, work("e2", "2027-02-14")];
    expect(bonusSuggestions(db({ cases: [C], outcome_events: more, bonus_claims: closed }), M, env("2027-02-16")).map((x) => [x.step, x.outcomeEventId ?? x.follows]))
      .toEqual([[3, "e2"], [5, "new"]]);
  });
  it("steg 1 föreslås en gång per ärende – också om förslaget återtogs", () => {
    const c = mkCase({ id: "case-h", startDate: "2026-11-02" });
    const acts = [mkActivity({ id: "a1", caseId: c.id, startsAt: "2026-11-03T09:00" })];
    const att = [mkAttendance({ activityId: "a1", caseId: c.id, status: "present" })];
    const ma = [mkAssessment(c.id, "2026-11"), mkAssessment(c.id, "2026-12")];
    const withdrawn = mkClaim({ id: "k1", caseId: c.id, step: 1, status: "withdrawn", withdrawnAt: "2027-01-05T10:00", withdrawnBy: "u-amira" });
    expect(bonusSuggestions(db({ cases: [c], activities: acts, attendance: att, monthly_assessments: ma, bonus_claims: [withdrawn] }), M, env("2027-01-10"))).toEqual([]);
  });
});

describe("coachen skapar ett anspråk själv", () => {
  const c = { startDate: "2027-01-04", status: "active" as const };
  it("insatsen ska ha startat, inget anspråk som räknas för steget, och steg 4–5 kräver steg 3", () => {
    expect(manualCreateProblem({ startDate: null, status: "confirmed" }, [], 2)).toMatch(/har inte startat/);
    expect(manualCreateProblem(c, [{ id: "k", step: 2, status: "submitted" }], 2)).toMatch(/redan ett anspråk för steg 2/);
    expect(manualCreateProblem(c, [], 5)).toMatch(/bygger på steg 3/);
    expect(manualCreateProblem(c, [{ id: "k3", step: 3, status: "rejected" }], 4)).toMatch(/bygger på steg 3/);
    expect(manualCreateProblem(c, [{ id: "k3", step: 3, status: "suggested" }], 5)).toBeNull();
  });
  it("ett avslaget eller återtaget anspråk hindrar inte ett nytt", () => {
    expect(manualCreateProblem(c, [{ id: "k", step: 3, status: "rejected" }], 3)).toBeNull();
    expect(manualCreateProblem(c, [{ id: "k", step: 1, status: "withdrawn" }], 1)).toBeNull();
  });
});

describe("innan anspråket skickas till kommunen", () => {
  const ctx = (p: Partial<SubmitContext["claim"]> & { step: number }, extra: Partial<SubmitContext> = {}): SubmitContext => ({
    claim: { status: "suggested", reachedOn: "2027-01-20", verificationKind: "anställningsavtal", verificationOn: "2027-01-18", checklist: {}, basis: "", ...p },
    case: { startDate: "2027-01-04", endDate: null }, step3: null, attendance: { meets: true, percent: 90 }, approvedAssessments: 2, today: "2027-02-01", ...extra,
  });
  it("steg 3 med verifiering och resultatdatum under insatsen är klart", () => {
    expect(submitProblems(ctx({ step: 3 }), M)).toEqual([]);
  });
  it("verifieringens typ och datum krävs för steg 2–5, datumet inte i framtiden, inga personnummer", () => {
    expect(submitProblems(ctx({ step: 3, verificationKind: "", verificationOn: null }), M)).toEqual([
      "Fyll i vilken verifiering som finns (till exempel anställningsavtal eller antagningsbesked).", "Fyll i verifieringens datum.",
    ]);
    expect(submitProblems(ctx({ step: 3, verificationOn: "2027-02-02" }), M)).toEqual(["Verifieringens datum kan inte vara i framtiden."]);
    expect(submitProblems(ctx({ step: 3, basis: "Gäller 19900101-1234" }), M)).toEqual(["Kommentaren får inte innehålla personnummer."]);
    expect(submitProblems(ctx({ step: 3, basis: "x".repeat(501) }), M)).toEqual(["Kommentaren får vara högst 500 tecken."]);
  });
  it("steg 3: resultatdatum i fönstret – annars stoppas det", () => {
    const closed = { startDate: "2026-09-01", endDate: "2026-10-31" };
    expect(submitProblems(ctx({ step: 3, reachedOn: "2027-01-31" }, { case: closed }), M)).toEqual([]);
    expect(submitProblems(ctx({ step: 3, reachedOn: "2027-02-01" }, { case: closed }), M)).toEqual(["Resultatdatum ska ligga under insatsen eller högst 3 månader efter slutdatum."]);
  });
  it("steg 1: närvaron, två godkända bedömningar och checklistan med var underlaget finns", () => {
    const all = Object.fromEntries(["individuell_plan", "ansokningshandlingar", "branschintroduktion", "arbetsgivarnara_aktivitet"].map((k) => [k, { done: true, where: "Anteckning 12 januari" }]));
    expect(submitProblems(ctx({ step: 1, verificationKind: null, verificationOn: null, checklist: all }), M)).toEqual([]);
    const p = submitProblems(ctx({ step: 1, checklist: { ...all, branschintroduktion: { done: true, where: " " }, individuell_plan: { done: false, where: "" } } }, { attendance: { meets: false, percent: 70 }, approvedAssessments: 1 }), M);
    expect(p).toEqual([
      "Närvaron är under 80 procent.", "Det behövs minst två godkända månadsbedömningar (före och efter).", "Bocka av: Genomförd individuell plan.",
      "Skriv var underlaget finns: Genomförd branschintroduktion.",
    ]);
  });
  it("steg 5: steg 3 skickat och nått inom tio veckor; steg 4: tidigast efter tre månader med en ny verifiering", () => {
    expect(submitProblems(ctx({ step: 5 }, { step3: { status: "suggested", reachedOn: "2027-01-20" } }), M)).toEqual(["Skicka steg 3 till kommunen först."]);
    expect(submitProblems(ctx({ step: 5 }, { step3: { status: "submitted", reachedOn: "2027-01-20" } }), M)).toEqual([]);
    expect(submitProblems(ctx({ step: 5 }, { step3: { status: "approved", reachedOn: "2027-03-16" }, today: "2027-04-01" }), M)).toEqual(["Steg 3 nåddes inte inom 10 veckor från start."]);
    const s4 = (today: string, verificationOn: string) => submitProblems(ctx({ step: 4, verificationOn }, { step3: { status: "approved", reachedOn: "2026-10-16" }, today }), M);
    expect(s4("2027-01-15", "2027-01-14")).toEqual(["Hållbart resultat kan skickas tidigast 2027-01-16."]);
    expect(s4("2027-01-20", "2027-01-15")).toEqual(["Verifieringen ska vara daterad 2027-01-16 eller senare (efter 3 månader)."]);
    expect(s4("2027-01-20", "2027-01-16")).toEqual([]);
  });
  it("ett anspråk som redan är skickat kan inte skickas igen", () => {
    expect(submitProblems(ctx({ step: 3, status: "submitted" }), M)).toEqual(["Anspråket är redan skickat, beslutat eller återtaget."]);
  });
});

describe("taket per deltagare – stegen läggs ihop, aldrig avräkning", () => {
  it("16 500 kr blir 12 000 kr: i beslutsordning, steg 5 sänks och steg 4 blir 0 kr", () => {
    const k = (id: string, decidedAt: string, priceOre: number, caseId = "case-a") => ({ id, caseId, decidedAt, priceOre });
    const claims = [
      k("s4", "2027-02-01T10:00", 400000), k("s1", "2026-11-10T10:00", 150000), k("s2", "2026-12-15T10:00", 300000), k("s3", "2027-01-12T14:05", 600000),
      k("s5", "2027-01-12T14:06", 200000),
      // Ett annat ärende har sitt eget tak.
      k("b3", "2027-01-12T14:05", 600000, "case-b"),
    ];
    const a = capAmounts(claims, M.capOre);
    expect(Object.fromEntries([...a].map(([id, x]) => [id, [x.amountOre, x.reduced]]))).toEqual({
      s1: [150000, false], s2: [300000, false], s3: [600000, false], s5: [150000, true], s4: [0, true], b3: [600000, false],
    });
    expect([...a].filter(([id]) => id.startsWith("s")).reduce((n, [, x]) => n + x.amountOre, 0)).toBe(1200000);
  });
  it("ett fakturerat anspråk räknas med det fakturerade beloppet – inte dagens prislista", () => {
    const a = capAmounts([
      { id: "s3", caseId: "c", decidedAt: "2027-01-12T14:05", priceOre: 500000, frozenOre: 600000 },
      { id: "s5", caseId: "c", decidedAt: "2027-01-12T14:06", priceOre: 200000, frozenOre: 200000 },
      { id: "s2", caseId: "c", decidedAt: "2026-12-15T10:20", priceOre: 300000, frozenOre: 300000 },
      { id: "s4", caseId: "c", decidedAt: "2027-02-01T08:00", priceOre: 400000 },
    ], 1200000);
    expect(a.get("s4")).toEqual({ amountOre: 100000, priceOre: 400000, reduced: true, blocked: false });
    expect([...a.values()].reduce((n, x) => n + x.amountOre, 0)).toBe(1200000);
  });
  it("ett anspråk utan riktigt pris räknas aldrig som 0 kr: de senare i ärendet stoppas (blocked), andra ärenden påverkas inte", () => {
    const a = capAmounts([
      { id: "x1", caseId: "c", decidedAt: "2027-01-01T10:00", priceOre: null },
      { id: "x2", caseId: "c", decidedAt: "2027-01-02T10:00", priceOre: 300000 },
      { id: "y1", caseId: "d", decidedAt: "2027-01-02T10:00", priceOre: 300000 },
    ], 1200000);
    expect(Object.fromEntries([...a].map(([id, x]) => [id, [x.amountOre, x.blocked]]))).toEqual({ x1: [0, false], x2: [0, true], y1: [300000, false] });
  });
  it("samma beslutstid: id avgör ordningen, så beloppen är stabila", () => {
    const a = capAmounts([{ id: "y", caseId: "c", decidedAt: "2027-01-12T14:05", priceOre: 800000 }, { id: "x", caseId: "c", decidedAt: "2027-01-12T14:05", priceOre: 800000 }], 1200000);
    expect([a.get("x")!.amountOre, a.get("y")!.amountOre]).toEqual([800000, 400000]);
  });
});
