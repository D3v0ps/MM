// Delmål för progressionerna (Karims beslut 2026-11-11) – genom samma execute() som appen och prototypen, mot testdatat i minnet
// (demoklockan 1 februari 2027 kl. 09.12). Bara påhittade uppgifter.
//   BOT-26-0143 (Nadia, huvudcoach Amira, handläggare Maria)  Tränar automatiskt på två egna tillfällen och två uppnådda delmål
//   BOT-26-0002 (huvudcoach Erik)                              förslaget till steg 1 – de fyra punkterna uppfyllda av delmålen
import { beforeEach, describe, expect, it } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import "@/api/handlers";
import type { Actor, Role } from "@/api/roles";
import { ApiError, type Ctx } from "@/api/server";
import { SYSTEM_ACTOR } from "@/api/roles";
import { trainFromAttendance } from "@/features/_shared/progress-goals";
import { defaultGoalId, DEFAULT_PROGRESS_GOALS } from "@/core/progress-goals";
import { listPersonas } from "@/data/actors";
import { MemoryRepo, type MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type DemoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START } from "@/data/seed";
import type { TableName, Tables } from "@/data/schema";
import { groupActivityCreate, groupActivityUpdate, groupActivityView } from "@/features/aktiviteter/api";
import { bonusCard, bonusDecide, bonusPortal, bonusReview, bonusSubmit, bonusUnderlag, type BonusUnderlag } from "@/features/bonus/api";
import { underlagSections } from "@/features/bonus/underlag-text";
import { assessmentPage, attendanceSet } from "@/features/coach/api";
import { kommunCase, kommunCaseList, kommunReports, kommunStart } from "@/features/kommun/api";
import { activityAdd, caseAttendance } from "@/features/arenden/api";
import { caseGoals, goalAchieve, goalCatalog, goalCreate, goalEvidence, goalMove, goalPicker, goalSetActive, goalUndo, goalUpdate } from "./api";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
let clock: DemoClock;
beforeEach(() => {
  clock = demoClock(DEMO_START);
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock });
});
const as = (userId: string, role: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && x.actor.role === role);
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
const amira = () => as("u-amira", "coach");
const erik = () => as("u-erik", "coach");
const johan = () => as("u-johan", "avtalsansvarig");
const robin = () => as("u-robin", "admin");
const maria = () => as("k-maria", "kommun_handlaggare");
const lars = () => as("u-lars", "ekonom");
const rows = <N extends TableName>(name: N): Tables[N][] => rt.store.rows(name);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cmd = (def: { key: string }, input: unknown, actor: Actor): Promise<any> => rt.run("command", def.key, input, actor);

const NADIA = "case-260143";
const TWO = "case-260002";
const G = (n: number) => defaultGoalId("c-bot", n);
const caseRow = (caseId: string, n: number) => rows("case_progress_goals").find((r) => r.caseId === caseId && r.goalId === G(n)) ?? null;
/** En gruppaktivitet i dag med Nadia som tränar delmål 21 (personligt brev) och 4 (branschintroduktion). */
async function groupWithGoals(startsAt = "2027-02-01T08:00", goals = [G(21), G(4)]) {
  const res = await cmd(groupActivityCreate, { name: "CV-verkstad", kind: "yrkesmoment", startsAt, durationMin: 60, location: "Alby", caseIds: [NADIA], progressGoalIds: goals }, amira());
  expect(res).toMatchObject({ ok: true });
  const act = rows("activities").find((a) => a.groupActivityId === res.groupActivityId && a.caseId === NADIA)!;
  return { groupActivityId: res.groupActivityId as string, activityId: act.id };
}

describe("Tränar automatiskt vid närvaro", () => {
  it("närvaro på en gruppaktivitet med delmål ger Tränar (automatiskt) – loggat, deltagarens rad har inga egna delmål", async () => {
    const { groupActivityId, activityId } = await groupWithGoals();
    // Deltagarens rad i gruppaktiviteten har inga egna delmål (de står på aktiviteten).
    expect(rows("activity_progress_goals").find((r) => r.id === activityId)).toBeUndefined();
    expect(caseRow(NADIA, 21)).toBeNull();
    expect(await cmd(attendanceSet, { activityId, status: "present" }, amira())).toMatchObject({ ok: true });
    expect([caseRow(NADIA, 21), caseRow(NADIA, 4)].map((r) => r && [r.status, r.source, r.setBy, r.evidenceKind, r.evidenceId])).toEqual([
      ["training", "auto", "system", "activity", activityId], ["training", "auto", "system", "activity", activityId],
    ]);
    const log = rows("audit_log").filter((l) => l.action === "case_progress_goal.training_auto" && (l.details.activityIds as string[] | undefined)?.includes(activityId));
    expect(log).toHaveLength(1);
    expect(log[0].details).toMatchObject({ count: 2, caseIds: [NADIA], goalIds: [G(4), G(21)].sort(), automatic: true });
    // Aktivitetsvyn visar delmålen (internt).
    const v = await q(groupActivityView, { id: groupActivityId }, amira());
    expect(v.kind === "ok" && v.activity.goalLabels).toEqual(["Har ett personligt brev", "Genomfört branschintroduktion"]);
    // Deltagarkortet: Tränar (automatiskt).
    const card = await q(caseGoals, { caseId: NADIA }, amira());
    const g21 = card.on ? card.areas.flatMap((a) => a.goals).find((g) => g.goalId === G(21)) : null;
    expect(g21).toMatchObject({ state: "training", stateText: "Tränar (automatiskt)", icon: "activity" });
  });

  it("idempotent och aldrig nedgradering: samma närvaro igen, sen och frånvaro ändrar inget – Uppnått står kvar", async () => {
    const { activityId } = await groupWithGoals();
    await cmd(attendanceSet, { activityId, status: "present" }, amira());
    expect(await cmd(goalAchieve, { caseId: NADIA, goalId: G(4), achievedOn: "2027-02-01", evidence: { kind: "activity", id: activityId } }, amira())).toMatchObject({ ok: true });
    const before = structuredClone(rows("case_progress_goals"));
    const logs = rows("audit_log").filter((l) => l.action === "case_progress_goal.training_auto").length;
    await cmd(attendanceSet, { activityId, status: "late" }, amira());
    await cmd(attendanceSet, { activityId, status: "present" }, amira());
    await cmd(attendanceSet, { activityId, status: "absent_invalid", reason: "Uteblev utan att meddela" }, amira());
    expect(rows("case_progress_goals")).toEqual(before);
    expect(caseRow(NADIA, 4)).toMatchObject({ status: "achieved", source: "manual", achievedOn: "2027-02-01" });
    expect(rows("audit_log").filter((l) => l.action === "case_progress_goal.training_auto")).toHaveLength(logs);
  });

  it("frånvaro ger inte Tränar; ett inaktiverat delmål får inget nytt läge", async () => {
    const { activityId } = await groupWithGoals();
    await cmd(attendanceSet, { activityId, status: "absent_valid", reason: "Sjukdom" }, amira());
    expect(caseRow(NADIA, 21)).toBeNull();
    expect(await cmd(goalSetActive, { id: G(21), active: false }, johan())).toMatchObject({ ok: true });
    await cmd(attendanceSet, { activityId, status: "present" }, amira());
    expect(caseRow(NADIA, 21)).toBeNull();
    expect(caseRow(NADIA, 4)).toMatchObject({ status: "training", source: "auto" });
  });

  it("den automatiska närvaron (dagens slut) ger Tränar för tillfällen med delmål", async () => {
    const { activityId } = await groupWithGoals("2027-02-01T13:00", [G(18)]);
    clock.set("2027-02-01T18:30");
    await q(caseGoals, { caseId: NADIA }, amira());
    expect(rows("attendance").find((a) => a.activityId === activityId)).toMatchObject({ status: "present", source: "auto" });
    expect(caseRow(NADIA, 18)).toMatchObject({ status: "training", source: "auto", evidenceId: activityId });
  });

  it("nya delmål på ett eget tillfälle (Ändra tid) med registrerad närvaro ger Tränar – utan meddelande och utan flytt", async () => {
    const own = rows("activities").find((a) => a.caseId === NADIA && !a.groupActivityId && a.startsAt > "2027-02-01T10:00")!;
    const res = await cmd({ key: "arenden.activityMove" }, { activityId: own.id, expectedStartsAt: own.startsAt, startsAt: own.startsAt, durationMin: own.durationMin, notify: true, progressGoalIds: [G(16)] }, amira());
    expect(res).toMatchObject({ ok: true, changed: true, notified: null });
    expect(rows("activities").find((a) => a.id === own.id)).toEqual(own);
    // Delmålen står i activity_progress_goals – inte på tillfället (som kommunen och ekonomen läser).
    expect(rows("activity_progress_goals").find((r) => r.id === own.id)).toMatchObject({ caseId: NADIA, goalIds: [G(16)], updatedBy: "u-amira" });
    expect(Object.keys(own)).not.toContain("progressGoalIds");
    // Ett delmål från ett annat avtal eller som inte finns nekas.
    expect(await cmd({ key: "arenden.activityMove" }, { activityId: own.id, expectedStartsAt: own.startsAt, startsAt: own.startsAt, durationMin: own.durationMin, notify: false, progressGoalIds: ["pg-okand"] }, amira()))
      .toMatchObject({ ok: false, error: "goals" });
    // Kortets Närvaro visar delmålen på kommande tillfällen (Ändra tid).
    const att = await q(caseAttendance, { caseId: NADIA }, amira());
    expect(att?.upcoming.find((a) => a.id === own.id)?.progressGoalIds).toEqual([G(16)]);
  });
});

describe("Uppnått och Ångra – bara en människa", () => {
  it("Markera uppnått: dagen (i dag eller tidigare, inte före start) och underlag i ärendet – loggat; Ångra tillbaka till Tränar eller bort", async () => {
    expect(await cmd(goalAchieve, { caseId: NADIA, goalId: G(7), achievedOn: "2027-02-02", evidence: null }, amira())).toMatchObject({ ok: false, error: "date" });
    expect(await cmd(goalAchieve, { caseId: NADIA, goalId: G(7), achievedOn: "2026-01-01", evidence: null }, amira())).toMatchObject({ ok: false, error: "date" });
    const foreign = rows("activities").find((a) => a.caseId !== NADIA)!;
    expect(await cmd(goalAchieve, { caseId: NADIA, goalId: G(7), achievedOn: "2027-01-29", evidence: { kind: "activity", id: foreign.id } }, amira())).toMatchObject({ ok: false });
    const evidence = await q(goalEvidence, { caseId: NADIA }, amira());
    expect(evidence.length).toBeGreaterThan(0);
    const [kind, id] = evidence[0].value.split(":");
    expect(await cmd(goalAchieve, { caseId: NADIA, goalId: G(7), achievedOn: "2027-01-29", evidence: { kind, id } }, amira())).toMatchObject({ ok: true });
    expect(caseRow(NADIA, 7)).toMatchObject({ status: "achieved", source: "manual", achievedOn: "2027-01-29", setBy: "u-amira", evidenceKind: kind, evidenceId: id });
    expect(await cmd(goalAchieve, { caseId: NADIA, goalId: G(7), achievedOn: "2027-01-29", evidence: null }, amira())).toMatchObject({ ok: false, error: "already" });
    expect(rows("audit_log").find((l) => l.action === "case_progress_goal.achieved" && l.details.goalId === G(7))?.details).toMatchObject({ caseId: NADIA, from: "none", achievedOn: "2027-01-29" });
    // Ett automatiskt Tränar blir Uppnått (loggen säger att det var automatiskt).
    expect(await cmd(goalAchieve, { caseId: NADIA, goalId: G(5), achievedOn: "2027-01-28", evidence: null }, amira())).toMatchObject({ ok: true });
    expect(rows("audit_log").find((l) => l.action === "case_progress_goal.achieved" && l.details.goalId === G(5))?.details).toMatchObject({ from: "training", wasAuto: true });
    // Ångra: tillbaka till Tränar (i eget namn) och till Inte påbörjat (raden tas bort).
    expect(await cmd(goalUndo, { caseId: NADIA, goalId: G(5), to: "training" }, amira())).toMatchObject({ ok: true });
    expect(caseRow(NADIA, 5)).toMatchObject({ status: "training", source: "manual", achievedOn: null, setBy: "u-amira" });
    expect(await cmd(goalUndo, { caseId: NADIA, goalId: G(5), to: "none" }, amira())).toMatchObject({ ok: false, error: "not_achieved" });
    expect(await cmd(goalUndo, { caseId: NADIA, goalId: G(7), to: "none" }, amira())).toMatchObject({ ok: true });
    expect(caseRow(NADIA, 7)).toBeNull();
    expect(rows("audit_log").filter((l) => l.action === "case_progress_goal.undone").map((l) => [l.details.goalId, l.details.to])).toEqual([[G(5), "training"], [G(7), "none"]]);
  });

  it("bara de som arbetar i ärendet: kommunen, ekonomen, chefen och systemadministratören nekas", async () => {
    for (const a of [maria(), lars(), as("u-karin", "chef"), robin()]) {
      await expect(cmd(goalAchieve, { caseId: NADIA, goalId: G(7), achievedOn: "2027-01-29", evidence: null }, a)).rejects.toBeInstanceOf(ApiError);
    }
    expect(caseRow(NADIA, 7)).toBeNull();
  });

  it("ett uppnått delmål är ingen nivå: månadsbedömningen visar det som belägg i området – förifyllnaden är oförändrad", async () => {
    const before = await q(assessmentPage, { caseId: NADIA, month: "2027-01" }, amira());
    expect(await cmd(goalAchieve, { caseId: NADIA, goalId: G(12), achievedOn: "2027-01-20", evidence: null }, amira())).toMatchObject({ ok: true });
    const after = await q(assessmentPage, { caseId: NADIA, month: "2027-01" }, amira());
    if (before.kind !== "ok" || after.kind !== "ok") throw new Error("ingen sida");
    const area = after.areas.find((a) => a.key === "digital_sjalvstandighet")!;
    expect(area.achievedGoals.map((g) => g.label)).toContain("Loggar in på sin e-post via dator");
    expect(after.areas.map((a) => [a.key, a.level, a.levelSource])).toEqual(before.areas.map((a) => [a.key, a.level, a.levelSource]));
    expect(after.assessment?.prefill).toEqual(before.assessment?.prefill);
  });
});

describe("Progression och resultat: punkterna i steg 1–2 ur de uppnådda delmålen", () => {
  it("kortet visar punkterna med delmålen som uppfyller dem – tröskeln två för ansökningshandlingar", async () => {
    const step = async (n: number) => {
      const v = await q(bonusCard, { caseId: NADIA }, amira());
      return v.on ? v.steps.find((s) => s.step === n)!.items : [];
    };
    const ans = async () => (await step(1)).find((x) => x.label === "Förbättrade ansökningshandlingar");
    expect(await ans()).toEqual({ label: "Förbättrade ansökningshandlingar", fulfilled: false, need: 2, goals: ["Har ett uppdaterat CV"] });
    expect(await cmd(goalAchieve, { caseId: NADIA, goalId: G(21), achievedOn: "2027-01-27", evidence: null }, amira())).toMatchObject({ ok: true });
    expect(await ans()).toEqual({ label: "Förbättrade ansökningshandlingar", fulfilled: true, need: 2, goals: ["Har ett uppdaterat CV", "Har ett personligt brev"] });
    expect((await step(3))).toEqual([]);
  });

  it("ett uppnått delmål som räknas mot steg 2 ger ett förslag direkt (regeln, ingen AI) – en gång; en händelse går före", async () => {
    const ONE = "case-260130"; // Amira, start 11 dec 2026, ingen händelse för steg 2
    expect(rows("bonus_claims").filter((k) => k.caseId === ONE && k.step === 2)).toEqual([]);
    expect(await cmd(goalAchieve, { caseId: ONE, goalId: G(18), achievedOn: "2027-01-25", evidence: null }, amira())).toMatchObject({ ok: true, suggested: 0 });
    const res = await cmd(goalAchieve, { caseId: ONE, goalId: G(19), achievedOn: "2027-01-26", evidence: null }, amira());
    expect(res).toMatchObject({ ok: true, suggested: 1 });
    const claim = rows("bonus_claims").find((k) => k.caseId === ONE && k.step === 2)!;
    expect(claim).toMatchObject({ status: "suggested", source: "auto", outcomeEventId: null, reachedOn: "2027-01-26", createdBy: "system" });
    expect(rows("audit_log").find((l) => l.action === "bonus_claim.suggested" && l.entityId === claim.id)).toBeTruthy();
    // Ett till delmål mot steg 2 ger inget nytt förslag.
    expect(await cmd(goalAchieve, { caseId: ONE, goalId: G(22), achievedOn: "2027-01-27", evidence: null }, amira())).toMatchObject({ ok: true, suggested: 0 });
    expect(rows("bonus_claims").filter((k) => k.caseId === ONE && k.step === 2)).toHaveLength(1);
    // Nadia har en händelse för steg 2 under insatsen: förslaget bygger på händelsen, inte på delmålet.
    expect(await cmd(goalAchieve, { caseId: NADIA, goalId: G(19), achievedOn: "2027-01-26", evidence: null }, amira())).toMatchObject({ ok: true, suggested: 1 });
    expect(rows("bonus_claims").find((k) => k.caseId === NADIA && k.step === 2)?.outcomeEventId).toBeTruthy();
  });

  it("steg 1 skickas med punkterna i redovisningsunderlaget – aldrig delmålen, taggarna eller deras id:n", async () => {
    const claimId = "bonus-case-260002-1-1";
    const review = await q(bonusReview, { claimId }, erik());
    expect(review?.needsChecklist).toBe(false);
    expect(review?.facts.stepItems.map((x) => [x.label, x.fulfilled])).toEqual([
      ["Genomförd individuell plan", true], ["Förbättrade ansökningshandlingar", true], ["Genomförd branschintroduktion", true], ["Aktivt deltagande i arbetsgivarnära aktivitet", true],
    ]);
    expect(review?.problems).toEqual([]);
    expect(await cmd(bonusSubmit, { claimId, basis: "", reachedOn: review!.fields.reachedOn, verificationKind: null, verificationOn: null, checklist: {} }, erik())).toMatchObject({ ok: true });
    const snapshot = rows("bonus_claims").find((k) => k.id === claimId)!.snapshot as unknown as BonusUnderlag;
    expect(snapshot.items).toEqual([
      { label: "Genomförd individuell plan", fulfilled: true }, { label: "Förbättrade ansökningshandlingar", fulfilled: true },
      { label: "Genomförd branschintroduktion", fulfilled: true }, { label: "Aktivt deltagande i arbetsgivarnära aktivitet", fulfilled: true },
    ]);
    const text = JSON.stringify(snapshot) + JSON.stringify(underlagSections(snapshot, "Namn"));
    expect(text).toContain("Genomförd individuell plan");
    expect(text).toContain("Uppfyllt");
    for (const g of DEFAULT_PROGRESS_GOALS) expect(text).not.toContain(g.label);
    // ("Uppnått delmål" i skalan är mallens ord för nivå 3, inget delmål.)
    expect(text).not.toMatch(/pg-c-bot|progressGoal|stepItem|Tränar/i);
    // Kommunen läser samma frysta underlag.
    const handlaggare = as(rows("cases").find((c) => c.id === TWO)!.referrerId!, "kommun_handlaggare");
    const kom = [await cmd(bonusUnderlag, { claimId, purpose: "view" }, handlaggare), await q(bonusPortal, { claimId }, handlaggare)];
    expect(kom[0]).toMatchObject({ ok: true });
    expect(kom[1]).not.toBeNull();
    const komText = JSON.stringify(kom);
    for (const g of DEFAULT_PROGRESS_GOALS) expect(komText).not.toContain(g.label);
    expect(komText).not.toMatch(/pg-c-bot|progressGoal|stepItem|Tränar/i);
  });
});

describe("kommunen ser aldrig delmålen eller taggarna", () => {
  it("portalens svar har inga delmål, inga namn på delmål och inga taggar – och kommunen når inga frågor om delmål", async () => {
    const { activityId } = await groupWithGoals();
    await cmd(attendanceSet, { activityId, status: "present" }, amira());
    const own = rows("activity_progress_goals").find((r) => r.caseId === NADIA && r.goalIds.length > 0);
    expect(own).toBeTruthy();
    const answers = [
      await q(kommunStart, {}, maria()), await q(kommunCaseList, {}, maria()), await q(kommunCase, { caseId: NADIA }, maria()), await q(kommunReports, {}, maria()),
    ];
    const text = JSON.stringify(answers);
    expect(text).toContain("BOT-26-0143");
    for (const g of DEFAULT_PROGRESS_GOALS) expect(text).not.toContain(g.label);
    expect(text).not.toMatch(/pg-c-bot|progressGoal|stepItem|delmål|Tränar/i);
    for (const def of [caseGoals, goalCatalog, goalPicker, goalEvidence]) {
      await expect(q(def as QueryDef<unknown, unknown>, { caseId: NADIA }, maria())).rejects.toBeInstanceOf(ApiError);
    }
    // Rader: kommunen och ekonomen läser varken katalogen eller lägena (policyn – samma som RLS).
    for (const a of [maria(), lars()]) {
      const repo = new MemoryRepo<Tables>(rt.store, a, POLICIES);
      expect([await repo.table("progress_goals").count(), await repo.table("case_progress_goals").count()]).toEqual([0, 0]);
    }
  });
});

describe("delmålen är interna: aldrig i kommunens vyer, rapporter, resultatfil, export eller faktura", () => {
  /** Allt som kommunen, rapporterna, exporterna och fakturan visar för Nadia och avtalet (samma urval som gruppmålets test). */
  async function outputs() {
    clock.set("2027-02-01T10:00");
    const out: Record<string, unknown> = {
      "kommun.start": await q(kommunStart, {}, maria()),
      "kommun.deltagareLista": await q(kommunCaseList, {}, maria()),
      "kommun.deltagare": await q(kommunCase, { caseId: NADIA }, maria()),
      "kommun.rapporter": await q(kommunReports, {}, maria()),
      "rapporter.dokument": await rt.run("query", "rapporter.dokument", { reportId: "rep-16008" }, as("u-sara", "samordnare")),
      "rapporter.dokument kommun": await rt.run("query", "rapporter.dokument", { reportId: "rep-16008" }, maria()),
      "ekonomi.csv": await rt.run("query", "ekonomi.csv", { month: "2027-02" }, lars()),
      "ekonomi.run": await rt.run("query", "ekonomi.run", { month: "2027-02" }, lars()),
    };
    for (const table of ["resultat", "progression", "handelser", "avslut", "faltbeskrivning"] as const) {
      out[`resultatfil ${table}`] = await rt.run("command", "rapporter.resultatfilExport", { contractId: "c-bot", from: "2026-09", to: "2027-02", format: "csv", table }, johan());
    }
    for (const id of ["sr-seed-privat", "sr-seed-mb", "sr-seed-kommun"]) {
      const owner = rt.raw().get("saved_reports", id)!.ownerId;
      const actor = listPersonas(rt.raw()).find((p) => p.actor.userId === owner)!.actor;
      out[`byggExport ${id}`] = await rt.run("command", "rapporter.byggExport", { savedReportId: id, format: "csv" }, actor);
    }
    return out;
  }

  it("samma svar före och efter att tillfället fått delmål, Nadia tränar dem och ett markerats uppnått – och inget av det syns", async () => {
    const { groupActivityId, activityId } = await groupWithGoals("2027-02-01T08:00", []);
    await cmd(attendanceSet, { activityId, status: "present" }, amira());
    // En första omgång: rapportens ögonblicksbild sparas första gången dokumentet läses – sedan är svaren stabila.
    await outputs();
    const before = await outputs();
    const res = await cmd(groupActivityUpdate, { id: groupActivityId, name: "CV-verkstad", kind: "yrkesmoment", startsAt: "2027-02-01T08:00", durationMin: 60, location: "Alby", progressGoalIds: [G(21), G(14)] }, amira());
    expect(res).toMatchObject({ ok: true });
    // Nya delmål på ett tillfälle med registrerad närvaro: Tränar direkt.
    expect([caseRow(NADIA, 21)?.status, caseRow(NADIA, 14)?.source]).toEqual(["training", "auto"]);
    expect(await cmd(goalAchieve, { caseId: NADIA, goalId: G(21), achievedOn: "2027-02-01", evidence: { kind: "activity", id: activityId } }, amira())).toMatchObject({ ok: true });
    const after = await outputs();
    for (const key of Object.keys(before)) {
      expect(JSON.stringify(after[key]), key).toBe(JSON.stringify(before[key]));
      expect(JSON.stringify(after[key]), key).not.toMatch(/pg-c-bot|progressGoal|stepItem|Tränar|Har ett personligt brev/);
    }
  });
});

describe("katalogen – avtalsansvarig och systemadministratören", () => {
  it("lägga till, byta namn och punkter, flytta och inaktivera – loggat utan namn; ingen dubblett i samma område", async () => {
    const cat = await q(goalCatalog, {}, johan());
    expect(cat?.canEdit).toBe(true);
    expect(cat?.areas.map((a) => [a.key, a.goals.length])).toEqual([
      ["narvaro_rutiner", 3], ["yrkesfardigheter", 3], ["arbetskapacitet", 2], ["sjalvstandighet", 2], ["digital_sjalvstandighet", 4], ["instruktioner", 2],
      ["arbetsgivarkontakter", 3], ["beredskap", 4], ["sprak_kommunikation", 2], ["ovrigt", 0],
    ]);
    const res = await cmd(goalCreate, { contractId: "c-bot", areaKey: "ovrigt", label: "  Har  ett körkort ", stepItems: ["jobbspar", "praktik"] }, johan());
    expect(res).toMatchObject({ ok: true });
    const g = rows("progress_goals").find((x) => x.id === res.id)!;
    expect(g).toMatchObject({ areaKey: "ovrigt", label: "Har ett körkort", stepItems: ["praktik", "jobbspar"], sortOrder: 10, active: true, createdBy: "u-johan" });
    expect(await cmd(goalCreate, { contractId: "c-bot", areaKey: "ovrigt", label: "har ett KÖRKORT", stepItems: [] }, robin())).toMatchObject({ ok: false, error: "duplicate" });
    expect(await cmd(goalCreate, { contractId: "c-bot", areaKey: "halsa_funktionellt", label: "X", stepItems: [] }, johan())).toMatchObject({ ok: false, error: "area" });
    expect(await cmd(goalUpdate, { id: g.id, label: "Har B-körkort", stepItems: [] }, robin())).toMatchObject({ ok: true, changed: true });
    expect(await cmd(goalMove, { id: G(2), direction: "up" }, johan())).toMatchObject({ ok: true, moved: true });
    expect(rows("progress_goals").filter((x) => x.areaKey === "narvaro_rutiner").sort((a, b) => a.sortOrder - b.sortOrder).map((x) => x.id)).toEqual([G(2), G(1), G(3)]);
    expect(await cmd(goalSetActive, { id: G(1), active: false }, johan())).toMatchObject({ ok: true, changed: true });
    // Ett inaktiverat delmål kan inte väljas på ett nytt tillfälle.
    expect(await cmd(groupActivityCreate, { name: "X", kind: "annat", startsAt: "2027-02-03T10:00", durationMin: 60, location: "Alby", caseIds: [], progressGoalIds: [G(1)] }, amira()))
      .toMatchObject({ ok: false, error: "goals" });
    const logs = rows("audit_log").filter((l) => l.entity === "progress_goal");
    expect(logs.map((l) => l.action)).toEqual(["progress_goal.created", "progress_goal.updated", "progress_goal.reordered", "progress_goal.deactivated"]);
    expect(JSON.stringify(logs.map((l) => l.details))).not.toMatch(/körkort/i);
    // Coachen, samordnaren och ekonomen ändrar inte katalogen.
    for (const a of [amira(), as("u-sara", "samordnare"), lars()]) {
      await expect(cmd(goalCreate, { contractId: "c-bot", areaKey: "ovrigt", label: "Y", stepItems: [] }, a)).rejects.toBeInstanceOf(ApiError);
    }
  });
});

describe("granskningen 2026-11-16", () => {
  it("startdatumet flyttas fram efter Uppnått (25 → 27 jan): punkten räknas inte längre – ändringen av startdatumet stoppas inte", async () => {
    const base = rows("cases").find((c) => c.id === "case-260130")!;
    const person = rows("persons").find((p) => p.id === base.personId)!;
    rt.store.insertRow("persons", { ...person, id: "p-test-flytt" });
    rt.store.insertRow("cases", { ...base, id: "case-test-flytt", personId: "p-test-flytt", caseNumber: "BOT-27-9998", startDate: "2027-01-25", firstMeetingAt: "2027-01-25T09:00" });
    const praktik = async () => {
      const card = await q(bonusCard, { caseId: "case-test-flytt" }, amira());
      return card.on ? card.steps.find((s) => s.step === 2)!.items.find((x) => x.label === "Praktik eller arbetsträning")?.fulfilled ?? false : null;
    };
    expect(await cmd(goalAchieve, { caseId: "case-test-flytt", goalId: G(22), achievedOn: "2027-01-25", evidence: null }, amira())).toMatchObject({ ok: true });
    expect(await praktik()).toBe(true);
    // Förslaget från delmålet tas bort ur testet, så att bara startdatumet prövas.
    for (const k of rows("bonus_claims").filter((x) => x.caseId === "case-test-flytt")) rt.store.removeRow("bonus_claims", k.id);
    const res = await cmd({ key: "arenden.andraStartdatum" }, { caseId: "case-test-flytt", expectedStartDate: "2027-01-25", startDate: "2027-01-27", motivation: "Deltagaren började senare." }, amira());
    expect(res).toMatchObject({ ok: true });
    expect(rows("cases").find((c) => c.id === "case-test-flytt")!.startDate).toBe("2027-01-27");
    expect(await praktik()).toBe(false);
    // Delmålet står kvar som uppnått på kortet Delmål (det som hände ändras inte).
    expect(caseRow("case-test-flytt", 22)).toMatchObject({ status: "achieved", achievedOn: "2027-01-25" });
  });

  it("ett skickat anspråk visar det som skickades – också efter Ångra; ett äldre anspråk visar checklistan", async () => {
    const claimId = "bonus-case-260002-1-1";
    const review = await q(bonusReview, { claimId }, erik());
    expect(await cmd(bonusSubmit, { claimId, basis: "", reachedOn: review!.fields.reachedOn, verificationKind: null, verificationOn: null, checklist: {} }, erik())).toMatchObject({ ok: true });
    expect(await cmd(goalUndo, { caseId: TWO, goalId: G(4), to: "none" }, erik())).toMatchObject({ ok: true });
    const card = await q(bonusCard, { caseId: TWO }, erik());
    const s1 = card.on ? card.steps.find((s) => s.step === 1)! : null;
    expect(s1?.status).toBe("submitted");
    expect(s1?.items.map((x) => [x.label, x.fulfilled])).toEqual([
      ["Genomförd individuell plan", true], ["Förbättrade ansökningshandlingar", true], ["Genomförd branschintroduktion", true], ["Aktivt deltagande i arbetsgivarnära aktivitet", true],
    ]);
    expect((await q(bonusReview, { claimId }, erik()))?.facts.stepItems.every((x) => x.fulfilled)).toBe(true);
    // Ett anspråk som skickades före delmålen (fryst checklista): punkterna ur checklistan.
    const tpl = rows("bonus_claims").find((k) => k.id === claimId)!;
    rt.store.insertRow("bonus_claims", {
      ...tpl, id: "bonus-legacy", caseId: "case-260130", status: "submitted", submittedAt: "2027-01-20T10:00", submittedBy: "u-amira",
      snapshot: { v: 1, checklist: [{ label: "Genomförd individuell plan", where: "Planen i pärmen" }] },
    });
    const legacy = await q(bonusCard, { caseId: "case-260130" }, amira());
    expect(legacy.on && legacy.steps.find((s) => s.step === 1)!.items.map((x) => [x.label, x.fulfilled])).toEqual([
      ["Genomförd individuell plan", true], ["Förbättrade ansökningshandlingar", false], ["Genomförd branschintroduktion", false], ["Aktivt deltagande i arbetsgivarnära aktivitet", false],
    ]);
  });

  it("underlaget som valdes vid Uppnått visas på kortet Delmål", async () => {
    const evidence = await q(goalEvidence, { caseId: NADIA }, amira());
    const checkIn = evidence.find((x) => x.value.startsWith("check_in:"))!;
    const [kind, id] = checkIn.value.split(":");
    expect(await cmd(goalAchieve, { caseId: NADIA, goalId: G(9), achievedOn: "2027-01-29", evidence: { kind, id } }, amira())).toMatchObject({ ok: true });
    const card = await q(caseGoals, { caseId: NADIA }, amira());
    const goals = card.on ? card.areas.flatMap((a) => a.goals) : [];
    expect(goals.find((g) => g.goalId === G(9))).toMatchObject({ state: "achieved", evidenceLabel: checkIn.label });
    expect(checkIn.label).toMatch(/^Mötesrapport /);
    // Utan underlag: inget.
    expect(goals.find((g) => g.goalId === G(11))?.evidenceLabel).toBeNull();
  });

  it("Ångra två gånger samtidigt: bara den första går igenom – ingen tar bort en rad som redan ändrats", async () => {
    const [a, b] = await Promise.all([
      cmd(goalUndo, { caseId: NADIA, goalId: G(20), to: "none" }, amira()),
      cmd(goalUndo, { caseId: NADIA, goalId: G(20), to: "training" }, as("u-sara", "samordnare")),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(rows("audit_log").filter((l) => l.action === "case_progress_goal.undone" && l.details.goalId === G(20))).toHaveLength(1);
  });

  it("Ändra tid med bara nya delmål: inget meddelande; en begränsad testare får inget besked om förslag", async () => {
    const own = rows("activities").find((a) => a.caseId === NADIA && !a.groupActivityId && a.startsAt > "2027-02-01T10:00")!;
    const sent = rows("outbound_messages").length;
    const res = await cmd({ key: "arenden.activityMove" }, { activityId: own.id, expectedStartsAt: own.startsAt, startsAt: own.startsAt, durationMin: own.durationMin, notify: true, progressGoalIds: [G(16)] }, amira());
    expect(res).toMatchObject({ ok: true, changed: true, notified: null });
    expect(rows("outbound_messages")).toHaveLength(sent);
    // Begränsad testare (Progression och resultat är ett ekonomiskt villkor): förslaget skapas av regeln men beskedet är 0.
    const tester: Actor = { ...amira(), testerId: "t-begransad" };
    expect(await cmd(goalAchieve, { caseId: "case-260130", goalId: G(19), achievedOn: "2027-01-26", evidence: null }, tester)).toMatchObject({ ok: true, suggested: 0 });
    expect(rows("bonus_claims").filter((k) => k.caseId === "case-260130" && k.step === 2)).toHaveLength(1);
  });

  it("Tränar är bästa möjliga: ett delmål som inaktiveras samtidigt hoppas över – resten tränas och närvaron sparas", async () => {
    const { activityId } = await groupWithGoals("2027-02-01T08:00", [G(21), G(4)]);
    rt.store.updateRow("progress_goals", G(4), { active: false });
    expect(await cmd(attendanceSet, { activityId, status: "present" }, amira())).toMatchObject({ ok: true });
    expect([caseRow(NADIA, 21)?.status, caseRow(NADIA, 4)]).toEqual(["training", null]);
  });

  it("Tränar är bästa möjliga: en rad som databasen nekar (23514) hoppas över, och en loggrad som inte går att skriva kastar inte", async () => {
    const { activityId } = await groupWithGoals("2027-02-01T08:00", [G(21), G(4)]);
    expect(await cmd(attendanceSet, { activityId, status: "present" }, amira())).toMatchObject({ ok: true });
    for (const n of [21, 4]) rt.store.removeRow("case_progress_goals", caseRow(NADIA, n)!.id);
    const system = new MemoryRepo<Tables>(rt.store, SYSTEM_ACTOR, POLICIES, { bypass: true });
    const repo = {
      table: (name: TableName) => {
        const t = system.table(name);
        if (name !== "case_progress_goals") return t;
        return {
          ...t,
          insert: async (row: Tables["case_progress_goals"]) => {
            if (row.goalId === G(4)) throw Object.assign(new Error("check"), { code: "23514" });
            return (t as typeof t & { insert: (r: Tables["case_progress_goals"]) => Promise<unknown> }).insert(row);
          },
        };
      },
    };
    const ctx = { system: repo, now: () => "2027-02-01T09:30", audit: async () => { throw new Error("loggen kan inte skrivas"); } } as unknown as Ctx;
    expect(await trainFromAttendance(ctx, [activityId])).toEqual({ added: 1, failed: false });
    expect([caseRow(NADIA, 21)?.status, caseRow(NADIA, 4)]).toEqual(["training", null]);
  });
});

describe("granskningen 2026-11-16, andra omgången", () => {
  it("ett avslaget anspråk är inte stegets läge: kortet visar dagens punkter – granskningen av anspråket visar det som skickades", async () => {
    const claimId = "bonus-case-260002-1-1";
    const review = await q(bonusReview, { claimId }, erik());
    expect(await cmd(bonusSubmit, { claimId, basis: "", reachedOn: review!.fields.reachedOn, verificationKind: null, verificationOn: null, checklist: {} }, erik())).toMatchObject({ ok: true });
    const handlaggare = as(rows("cases").find((c) => c.id === TWO)!.referrerId!, "kommun_handlaggare");
    expect(await cmd(bonusDecide, { claimId, decision: "rejected", note: "Underlaget räcker inte." }, handlaggare)).toMatchObject({ ok: true });
    expect(await cmd(goalUndo, { caseId: TWO, goalId: G(4), to: "none" }, erik())).toMatchObject({ ok: true });
    const card = await q(bonusCard, { caseId: TWO }, erik());
    const s1 = card.on ? card.steps.find((s) => s.step === 1)! : null;
    expect(s1?.status).toBe("rejected");
    expect(s1?.items.find((x) => x.label === "Genomförd branschintroduktion")?.fulfilled).toBe(false);
    expect((await q(bonusReview, { claimId }, erik()))?.facts.stepItems.find((x) => x.label === "Genomförd branschintroduktion")?.fulfilled).toBe(true);
  });

  /** Databasen nekar delmålen (ett delmål inaktiverades mellan kontrollen och skrivningen – 23514; minnet: kontrollen nekar). */
  async function withRefusedGoals<T>(fn: () => Promise<T>): Promise<T> {
    const policy = POLICIES.activity_progress_goals!;
    const guard = policy.guard;
    policy.guard = () => false;
    try {
      return await fn();
    } finally {
      policy.guard = guard;
    }
  }

  it("Lägg till tillfälle: nekas delmålen är tillfället ändå tillagt och loggat – svaret säger att delmålen inte sparades", async () => {
    const at = "2027-02-04T13:00";
    const res = await withRefusedGoals(() => cmd(activityAdd, { caseId: NADIA, kind: "yrkesmoment", startsAt: at, durationMin: 60, location: "Alby", progressGoalIds: [G(16)] }, amira()));
    expect(res).toMatchObject({ ok: false, error: "goals" });
    const act = rows("activities").find((a) => a.caseId === NADIA && a.startsAt === at && a.kind === "yrkesmoment")!;
    expect(act).toBeTruthy();
    expect(rows("activity_progress_goals").find((r) => r.id === act.id)).toBeUndefined();
    const log = rows("audit_log").find((l) => l.action === "activity.added" && l.entityId === act.id);
    expect(log?.details).toMatchObject({ caseId: NADIA, kind: "yrkesmoment", startsAt: at });
    expect(log?.details).not.toHaveProperty("progressGoalIds");
  });

  it("Ändra tid med nya delmål: nekas delmålen flyttas ingenting – inget meddelande, ingen loggrad om flytten", async () => {
    const own = rows("activities").find((a) => a.caseId === NADIA && !a.groupActivityId && a.kind !== "praktikdag" && a.startsAt > "2027-02-01T10:00")!;
    const sent = rows("outbound_messages").length;
    const res = await withRefusedGoals(() => cmd({ key: "arenden.activityMove" }, {
      activityId: own.id, expectedStartsAt: own.startsAt, startsAt: "2027-02-05T13:30", durationMin: own.durationMin, notify: true, progressGoalIds: [G(16)],
    }, amira()));
    expect(res).toMatchObject({ ok: false, error: "goals" });
    expect(rows("activities").find((a) => a.id === own.id)?.startsAt).toBe(own.startsAt);
    expect(rows("activity_progress_goals").find((r) => r.id === own.id)).toBeUndefined();
    expect(rows("outbound_messages")).toHaveLength(sent);
    expect(rows("audit_log").some((l) => l.action === "activity.moved" && l.entityId === own.id)).toBe(false);
    // Utan nekandet går samma ändring igenom: flyttad, delmålen sparade, meddelandet skickat.
    const ok = await cmd({ key: "arenden.activityMove" }, {
      activityId: own.id, expectedStartsAt: own.startsAt, startsAt: "2027-02-05T13:30", durationMin: own.durationMin, notify: true, progressGoalIds: [G(16)],
    }, amira());
    expect(ok).toMatchObject({ ok: true, changed: true });
    expect(rows("activities").find((a) => a.id === own.id)?.startsAt).toBe("2027-02-05T13:30");
    expect(rows("activity_progress_goals").find((r) => r.id === own.id)?.goalIds).toEqual([G(16)]);
  });
});
