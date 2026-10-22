// Automatisk månadsbedömning (Karims beslut 2026-10-22) mot testdatat i minnet (MemoryRuntime, samma hanterare som appen):
//   * sidan visar förifyllnaden också när raden saknas; januaris utkast i testdatat är ifyllda som jobbet fyller i dem
//   * godkännandet kräver "Jag har gått igenom bedömningen" (reviewed) och loggar antalen per ursprung
//   * servern skriver aldrig ett AI-förslag i nivån – bara coachens sparning, och bara med förslagets nivå ("Godta")
//   * steget i rapportjobbet skapar utkasten och lägger AI-utkastet en gång per ärende och månad (idempotent)
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import { SYSTEM_ACTOR, type Actor, type Role } from "@/api/roles";
import { AUTO_OBSERVATION } from "@/core/monthly-prefill";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import type { TableName, Tables } from "@/data/schema";
import { createSeed, DEMO_START } from "@/data/seed";
import { assessmentPage, assessmentSave, attendanceSet, checkinSave, minVecka, NOT_REVIEWED_TEXT } from "./api";
import { addMinutes } from "@/core/time";
import { AI_QUEUE_PER_RUN, assessMonthOf, autoDraftIds, ensureMonthlyAssessments, needsAssessment } from "./ensure-assessments";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const rows = <N extends TableName>(name: N): Tables[N][] => rt.store.rows(name);
const amira = () => as("u-amira", "coach");
const NADIA = "case-260143";
const JAN = "2027-01";
const page = async (caseId = NADIA, month = JAN) => {
  const v = await q(assessmentPage, { caseId, month }, amira());
  if (v.kind !== "ok") throw new Error("gate");
  return v;
};
const maOf = (caseId = NADIA, month = JAN) => rows("monthly_assessments").find((m) => m.caseId === caseId && m.month === month)!;

describe("sidan: allt är ifyllt när coachen öppnar bedömningen", () => {
  it("januari (testdatat): progressionsnivå 0 Automatiskt i varje område, AI-förslag bara med citat, samlad status från mötesrapporten", async () => {
    const v = await page();
    expect(v.areas.length).toBeGreaterThan(0);
    for (const a of v.areas) {
      expect(a.levelSource, a.key).toBe("auto");
      expect(a.level, a.key).toBe(0);
      expect(a.observation, a.key).toBe(AUTO_OBSERVATION);
      // Ett förslag har alltid belägg (citat, källa och dag) – annars visas det inte.
      expect(a.aiLevelSuggestion == null, a.key).toBe(a.aiLevelEvidence == null);
    }
    const withSuggestion = v.areas.filter((a) => a.aiLevelSuggestion != null);
    expect(withSuggestion.length).toBeGreaterThan(0);
    for (const a of withSuggestion) expect(a.aiLevelEvidence?.source).toMatch(/^(Mötesrapport|Anteckning) \d+ \w+/);
    expect(v.assessment).toMatchObject({ saved: true, status: "draft" });
    expect(v.assessment?.overallStatus).not.toBeNull();
    expect(v.assessment?.overallFrom).toMatch(/^2027-01-/);
    expect(v.assessment?.prefill.summary).toBeDefined();
  });

  it("en månad utan rad (februari): samma förifyllnad visas, ingenting sparas förrän coachen ändrar eller godkänner", async () => {
    const before = rows("monthly_assessments").length;
    const v = await page(NADIA, "2027-02");
    expect(v.assessment).toMatchObject({ saved: false, version: null, status: "draft" });
    expect(v.areas.every((a) => a.level === 0 && a.levelSource === "auto")).toBe(true);
    expect(v.assessment?.summary).toMatch(/^Närvaro i februari: /);
    expect(rows("monthly_assessments")).toHaveLength(before);
  });
});

describe("coachens sparning och godkännandet", () => {
  const base = { caseId: NADIA, month: JAN };

  it("Godkänn kräver 'Jag har gått igenom bedömningen' – utan den sparas inget", async () => {
    const version = maOf().version;
    expect(await run(assessmentSave, { ...base, approve: true, expectedVersion: version }, amira())).toMatchObject({ ok: false, error: "not_reviewed", message: NOT_REVIEWED_TEXT });
    expect(await run(assessmentSave, { ...base, approve: true, reviewed: false, expectedVersion: version }, amira())).toMatchObject({ ok: false, error: "not_reviewed" });
    expect(maOf()).toMatchObject({ status: "draft", version });
  });

  it("godkänd med alla områden automatiska: revisionsloggen har reviewed och antalen per ursprung – bara antal", async () => {
    const res = await run(assessmentSave, { ...base, approve: true, reviewed: true, expectedVersion: maOf().version }, amira());
    expect(res).toMatchObject({ ok: true });
    expect(maOf().status).toBe("approved");
    const log = rows("audit_log").filter((l) => l.action === "assessment.approved" && l.details.caseId === NADIA);
    const n = (await page()).areas.length;
    expect(log.at(-1)?.details).toEqual({ caseId: NADIA, month: JAN, reviewed: true, autoAreas: n, coachAreas: 0, aiAccepted: 0 });
  });

  it("servern skriver aldrig AI-förslaget i nivån: utan coachens val står nivån kvar på 0, och 'ai' med en annan nivå blir coachens val", async () => {
    const v = await page();
    const sug = v.areas.find((a) => a.aiLevelSuggestion != null)!;
    const other = v.areas.find((a) => a.aiLevelSuggestion == null)!;
    // En sparning som inte rör området: nivån är fortfarande 0 och automatisk – förslaget ligger kvar som förslag.
    expect(await run(assessmentSave, { ...base, summary: "Ny text.", expectedVersion: maOf().version }, amira())).toMatchObject({ ok: true });
    expect(maOf().areas[sug.key]).toMatchObject({ level: 0, levelSource: "auto", aiLevelSuggestion: sug.aiLevelSuggestion });
    // "ai" med en annan nivå än förslaget, och "ai" i ett område utan förslag: coachens val.
    const wrong = sug.aiLevelSuggestion === 3 ? 1 : 3;
    const r = await run(assessmentSave, {
      ...base, expectedVersion: maOf().version,
      areas: { [sug.key]: { level: wrong, levelSource: "ai", observation: "Egen observation." }, [other.key]: { level: 2, levelSource: "ai", observation: "Egen." } },
    }, amira());
    expect(r).toMatchObject({ ok: true });
    expect(maOf().areas[sug.key]).toMatchObject({ level: wrong, levelSource: "coach" });
    expect(maOf().areas[other.key]).toMatchObject({ level: 2, levelSource: "coach" });
    expect(rows("audit_log").filter((l) => l.action === "assessment.ai_accepted")).toEqual([]);
  });

  it("Godta: coachens sparning med förslagets nivå blir 'ai' och loggas med antal och områden – utan konkret observation går den inte att godkänna", async () => {
    const v = await page();
    const sug = v.areas.filter((a) => a.aiLevelSuggestion != null);
    const areas = Object.fromEntries(sug.map((a) => [a.key, { level: a.aiLevelSuggestion!, levelSource: "ai" as const, observation: AUTO_OBSERVATION }]));
    expect(await run(assessmentSave, { ...base, areas, expectedVersion: maOf().version }, amira())).toMatchObject({ ok: true });
    for (const a of sug) expect(maOf().areas[a.key], a.key).toMatchObject({ level: a.aiLevelSuggestion, levelSource: "ai" });
    const acc = rows("audit_log").filter((l) => l.action === "assessment.ai_accepted");
    expect(acc).toHaveLength(1);
    expect(acc[0].details).toEqual({ caseId: NADIA, month: JAN, count: sug.length, areas: sug.map((a) => a.key) });
    // Nivå 1 eller högre med den automatiska texten "Ingen förändring noterad …": observationen saknas.
    const res = await run(assessmentSave, { ...base, approve: true, reviewed: true, expectedVersion: maOf().version }, amira());
    expect(res).toMatchObject({ ok: false, error: "incomplete" });
    if (!res.ok && res.error === "incomplete" && "missing" in res) expect(res.missing).toEqual(sug.map((a) => a.key));
    // Med observationer går det – och loggen räknar de godtagna förslagen.
    const fixed = Object.fromEntries(sug.map((a) => [a.key, { level: a.aiLevelSuggestion!, levelSource: "ai" as const, observation: "Konkret observation ur mötesrapporten." }]));
    expect(await run(assessmentSave, { ...base, areas: fixed, approve: true, reviewed: true, expectedVersion: maOf().version }, amira())).toMatchObject({ ok: true });
    expect(rows("audit_log").filter((l) => l.action === "assessment.approved").at(-1)?.details).toMatchObject({ reviewed: true, aiAccepted: sug.length });
  });

  it("Ifyllt automatiskt: ett fält som coachen ändrar är inte längre märkt – de andra är det", async () => {
    const before = maOf().prefill;
    expect(before.summary).toBeDefined();
    expect(await run(assessmentSave, { ...base, summary: "Min egen sammanfattning.", expectedVersion: maOf().version }, amira())).toMatchObject({ ok: true });
    expect(maOf().prefill.summary).toBeUndefined();
    expect(maOf().prefill.overallStatus).toEqual(before.overallStatus);
  });

  it("första sparningen av en månad utan rad: raden får det fasta id:t och märkningen för det som sparas oförändrat", async () => {
    const v = await page(NADIA, "2027-02");
    const res = await run(assessmentSave, { caseId: NADIA, month: "2027-02", summary: v.assessment!.summary, overallStatus: v.assessment!.overallStatus }, amira());
    expect(res).toMatchObject({ ok: true, assessmentId: `ma-${NADIA}-2027-02` });
    const ma = maOf(NADIA, "2027-02");
    expect(ma.prefill.summary).toBe("rules");
    expect(Object.values(ma.areas).every((a) => a.levelSource === "auto" && a.level === 0)).toBe(true);
  });
});

describe("steget i rapportjobbet: utkasten skapas automatiskt (ensureMonthlyAssessments)", () => {
  const MARCH = "2027-03-02T08:00";

  it("månaden att bedöma nu är månaden före, och ärendena är de som får en månadsrapport", () => {
    expect(assessMonthOf("2027-03-02T08:00")).toBe("2027-02");
    expect(assessMonthOf("2027-01-01T00:00")).toBe("2026-12");
    const c = { id: "x", status: "active" as const, referrerId: null, startDate: "2027-02-20", endDate: null, closedAt: null };
    expect(needsAssessment(c, "2027-02", 11)).toBe(false); // 9 dagar
    expect(needsAssessment({ ...c, startDate: "2027-02-10" }, "2027-02", 11)).toBe(true);
  });

  it("skapar förifyllda utkast och lägger AI-utkastet en gång per ärende och månad – en körning till gör ingenting", async () => {
    rt.clock.set(MARCH);
    const ctx = rt.ctxFor(SYSTEM_ACTOR);
    const first = await ensureMonthlyAssessments(ctx, { floor: null });
    expect(first.month).toBe("2027-02");
    expect(first.created.length).toBeGreaterThan(10);
    expect(first.aiQueued.length).toBeGreaterThan(0);
    const created = rows("monthly_assessments").filter((m) => m.month === "2027-02");
    expect(created).toHaveLength(first.created.length);
    for (const m of created) {
      expect(m.id).toBe(`ma-${m.caseId}-2027-02`);
      // Nivån är 0 i varje område – också där AI föreslår något.
      expect(Object.values(m.areas).every((a) => a.level === 0 && a.levelSource === "auto"), m.caseId).toBe(true);
    }
    expect(rows("monthly_plans").filter((p) => p.month === "2027-02")).toHaveLength(first.created.length);
    // AI-utkastet: bara ärenden med samtycke, en körning per ärende och månad.
    const runs = rows("ai_runs").filter((r) => r.kind === "monthly_draft" && r.inputRef === "2027-02");
    expect(runs.map((r) => r.caseId).sort()).toEqual([...first.aiQueued].sort());
    for (const id of first.aiQueued) expect(rt.raw().get("cases", id)?.aiConsentStatus).toBe("given");
    // Revisionsloggen: en rad per ärende, skriven direkt när ärendets steg är klara (id:n och antal – aldrig text).
    const log = rows("audit_log").filter((l) => l.action === "assessment.prefilled");
    const touched = [...new Set([...first.created.map((x) => x.caseId), ...first.aiQueued])].sort();
    expect(log.map((l) => (l.details as { caseId: string }).caseId).sort()).toEqual(touched);
    for (const l of log) {
      const caseId = (l.details as { caseId: string }).caseId;
      expect(l).toMatchObject({
        actorId: SYSTEM_ACTOR.userId, contractId: "c-bot", entity: "monthly_assessment", entityId: `ma-${caseId}-2027-02`,
        details: { month: "2027-02", caseIds: [caseId], created: first.created.some((x) => x.caseId === caseId) ? 1 : 0, aiQueued: first.aiQueued.includes(caseId) ? 1 : 0 },
      });
    }
    // Det automatiska AI-utkastet har fasta id:n per ärende och månad.
    for (const r of runs) expect(r.id).toBe(`ai-auto-${r.caseId}-2027-02`);

    const again = await ensureMonthlyAssessments(ctx, { floor: null });
    expect(again).toEqual({ month: "2027-02", created: [], aiQueued: [], duplicates: 0 });
    expect(rows("ai_runs").filter((r) => r.kind === "monthly_draft" && r.inputRef === "2027-02")).toHaveLength(runs.length);
    expect(rows("audit_log").filter((l) => l.action === "assessment.prefilled")).toHaveLength(touched.length);
  });

  it("AI-stödet av: utkasten skapas, inget AI-jobb läggs; golvet: en månad som tog slut före golvet rörs inte", async () => {
    rt.clock.set(MARCH);
    const noAi = { ...rt.ctxFor(SYSTEM_ACTOR), ai: undefined };
    expect(await ensureMonthlyAssessments(noAi, { floor: "2027-03-01T06:00" })).toMatchObject({ created: [], aiQueued: [] });
    const r = await ensureMonthlyAssessments(noAi, { floor: null });
    expect(r.created.length).toBeGreaterThan(0);
    expect(r.aiQueued).toEqual([]);
    expect(rows("ai_runs").filter((x) => x.kind === "monthly_draft" && x.inputRef === "2027-02")).toEqual([]);
  });

  it("en godkänd bedömning och en befintlig AI-körning rörs inte (coachen har redan startat AI-utkastet)", async () => {
    rt.clock.set(MARCH);
    const ctx = rt.ctxFor(SYSTEM_ACTOR);
    // Coachen hann bedöma Nadia i februari och starta ett AI-utkast för ett annat ärende.
    rt.store.insertRow("monthly_assessments", { ...maOf(), id: "ma-egen", month: "2027-02", status: "approved", version: 1 });
    const res = await ensureMonthlyAssessments(ctx, { floor: null });
    expect(res.created.some((x) => x.caseId === NADIA)).toBe(false);
    expect(res.aiQueued).not.toContain(NADIA);
    expect(rows("monthly_assessments").filter((m) => m.caseId === NADIA && m.month === "2027-02")).toHaveLength(1);
  });
});

describe("granskningen: förifyllnaden hålls aktuell och skrivs aldrig över i tysthet", () => {
  it("en mötesrapport som godkänns efter att utkastet skapades: samlad status, sammanfattningen och mål 1 följer med (de automatiskt märkta)", async () => {
    const before = structuredClone(maOf());
    expect(before.prefill.overallStatus).toBeDefined();
    const res = await run(checkinSave, {
      caseId: NADIA, data: { heldAt: "2027-01-29T10:00", overallStatus: "yellow", nextGoal: "Gå på intervjun hos lagret", note: "Övade intervju.", goalStatus: "yes" }, approve: true,
    }, amira());
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) return;
    const after = maOf();
    expect(after.overallStatus).toBe("yellow");
    expect(after.prefill.overallStatus).toEqual({ checkInId: res.checkInId, heldAt: "2027-01-29T10:00" });
    expect(after.version).toBe(before.version + 1);
    const plan = rows("monthly_plans").find((p) => p.caseId === NADIA && p.month === JAN);
    if (before.prefill.plan?.goal1 === "check_in") expect(plan?.goal1).toBe("Gå på intervjun hos lagret");
    expect(rows("audit_log").filter((l) => l.action === "assessment.prefill_refreshed").at(-1)?.details).toEqual({ caseId: NADIA, month: JAN, checkInId: res.checkInId, automatic: true });
    // Sidan: statusen kommer nu från den nya mötesrapporten.
    expect((await page()).assessment?.overallFrom).toBe("2027-01-29T10:00");
  });

  it("coachen har valt samlad status själv: den rörs inte av en ny mötesrapport", async () => {
    expect(await run(assessmentSave, { caseId: NADIA, month: JAN, overallStatus: "red", expectedVersion: maOf().version }, amira())).toMatchObject({ ok: true });
    expect(await run(checkinSave, { caseId: NADIA, data: { heldAt: "2027-01-29T10:00", overallStatus: "green", nextGoal: "Mål", goalStatus: "yes" }, approve: true }, amira())).toMatchObject({ ok: true });
    expect(maOf().overallStatus).toBe("red");
  });

  it("sidan visade förifyllnaden utan rad (version 0) och jobbet skapade raden under tiden: conflict – inget skrivs över", async () => {
    const v = await page(NADIA, "2027-02");
    expect(v.assessment?.version).toBeNull();
    // Jobbet skapar raden (samma fasta id) medan formuläret är öppet.
    rt.store.insertRow("monthly_assessments", { ...maOf(), id: `ma-${NADIA}-2027-02`, month: "2027-02", summary: "AI:s sammanfattning.", prefill: { summary: "ai" }, version: 2 });
    const res = await run(assessmentSave, { caseId: NADIA, month: "2027-02", summary: v.assessment!.summary, autosave: true, expectedVersion: 0 }, amira());
    expect(res).toMatchObject({ ok: false, error: "conflict" });
    expect(maOf(NADIA, "2027-02")).toMatchObject({ summary: "AI:s sammanfattning.", prefill: { summary: "ai" }, version: 2 });
    // Utan rad går version 0 igenom.
    expect(await run(assessmentSave, { caseId: NADIA, month: "2027-03", summary: "Mars.", expectedVersion: 0 }, amira())).toMatchObject({ ok: true });
  });

  it("Min vecka: de förifyllda bedömningarna märks Ifylld automatiskt – inte som manuellt underlag", async () => {
    const v = await q(minVecka, {}, amira());
    expect(v.monthly.open.length).toBeGreaterThan(0);
    expect(v.monthly.open.every((r) => r.prefilled)).toBe(true);
  });
});

describe("granskningen, andra rundan: de automatiska AI-utkasten i kön", () => {
  const MARCH = "2027-03-02T08:00";
  /** Supabase-lägets Ctx: jobben läggs i kön (ctx.jobs) i stället för att köras direkt. */
  const queued = () => ({ ...rt.ctxFor(SYSTEM_ACTOR), jobs: { schedule: () => undefined } });
  const draftJobs = () => rows("jobs").filter((j) => j.kind === "draft_monthly");

  it("högst tio per körning, en minut isär i kön och med fasta id:n – nästa körning lägger resten", async () => {
    rt.clock.set(MARCH);
    const first = await ensureMonthlyAssessments(queued(), { floor: null });
    expect(first.aiQueued).toHaveLength(AI_QUEUE_PER_RUN);
    const jobs = draftJobs().sort((a, b) => (a.runAfter < b.runAfter ? -1 : 1));
    expect(jobs.map((j) => j.runAfter)).toEqual(Array.from({ length: AI_QUEUE_PER_RUN }, (_, i) => addMinutes(MARCH, i)));
    for (const id of first.aiQueued) {
      const ids = autoDraftIds(id, "2027-02");
      expect(rt.raw().get("ai_runs", ids.aiRunId)).toMatchObject({ caseId: id, inputRef: "2027-02", status: "running" });
      expect(rt.raw().get("jobs", ids.jobId)).toMatchObject({ kind: "draft_monthly", status: "queued" });
    }
    const second = await ensureMonthlyAssessments(queued(), { floor: null });
    expect(second.created).toEqual([]);
    expect(second.aiQueued.length).toBeGreaterThan(0);
    expect(second.aiQueued.some((id) => first.aiQueued.includes(id))).toBe(false);
  });

  it("två körningar som läste AI-körningarna samtidigt lägger aldrig två utkast för samma ärende och månad", async () => {
    rt.clock.set(MARCH);
    const a = await ensureMonthlyAssessments(queued(), { floor: null });
    // Den andra körningen läste ai_runs innan den första hann lägga sina utkast (samma ögonblicksbild som före den första).
    const base = queued();
    const stale = {
      ...base,
      system: {
        table: (name: TableName) => {
          const t = base.system.table(name);
          return name === "ai_runs" ? { ...t, list: async () => [] } : t;
        },
      } as unknown as typeof base.system,
    };
    const b = await ensureMonthlyAssessments(stale, { floor: null });
    const runs = rows("ai_runs").filter((r) => r.kind === "monthly_draft" && r.inputRef === "2027-02");
    expect(new Set(runs.map((r) => r.caseId)).size).toBe(runs.length);
    expect(b.aiQueued.some((id) => a.aiQueued.includes(id))).toBe(false);
  });

  it("revisionsloggen skrivs per ärende direkt – ett fel i ett senare ärende lämnar inget skapat utkast utan logg", async () => {
    rt.clock.set(MARCH);
    const base = rt.ctxFor(SYSTEM_ACTOR);
    let inserts = 0;
    const failing = {
      ...base,
      ai: undefined,
      system: {
        table: (name: TableName) => {
          const t = base.system.table(name);
          if (name !== "monthly_plans") return t;
          return { ...t, insert: async (row: never) => { if (++inserts === 3) throw new Error("Databasfel"); return t.insert(row); } };
        },
      } as unknown as typeof base.system,
    };
    await expect(ensureMonthlyAssessments(failing, { floor: null })).rejects.toThrow();
    const created = rows("monthly_assessments").filter((m) => m.month === "2027-02").map((m) => m.caseId).sort();
    expect(created.length).toBe(3);
    const logged = rows("audit_log").filter((l) => l.action === "assessment.prefilled").map((l) => (l.details as { caseId: string }).caseId).sort();
    expect(logged).toEqual(created);
  });
});

describe("granskningen, andra rundan: närvaron i sammanfattningen följer en rättad närvaro", () => {
  it("närvaro som ändras i en avslutad månad: den automatiska sammanfattningen får de nya siffrorna – coachens text rörs aldrig", async () => {
    const ma = structuredClone(rows("monthly_assessments").find((m) => m.month === JAN && m.status === "draft" && m.prefill.summary === "rules")!);
    expect(ma).toBeDefined();
    const present = rows("activities")
      .filter((a) => a.caseId === ma.caseId && a.startsAt.startsWith(JAN))
      .find((a) => rows("attendance").find((x) => x.activityId === a.id)?.status === "present")!;
    expect(present).toBeDefined();
    const before = ma.summary;
    expect(before).toMatch(/^Närvaro i januari: närvarande vid \d+ av \d+/);
    const res = await run(attendanceSet, { activityId: present.id, status: "absent_invalid" }, amira());
    expect(res).toMatchObject({ ok: true });
    const after = maOf(ma.caseId);
    expect(after.summary).not.toBe(before);
    expect(after.summary).toMatch(/ogiltig frånvaro/i);
    expect(after.version).toBe(ma.version + 1);
    expect(rows("audit_log").filter((l) => l.action === "assessment.prefill_refreshed").at(-1)?.details).toEqual({ caseId: ma.caseId, month: JAN, attendance: true, automatic: true });
    // Coachen skriver sin egen sammanfattning: en ny rättning ändrar den inte.
    expect(await run(assessmentSave, { caseId: ma.caseId, month: JAN, summary: "Coachens egen text.", expectedVersion: after.version }, amira())).toMatchObject({ ok: true });
    expect(await run(attendanceSet, { activityId: present.id, status: "present" }, amira())).toMatchObject({ ok: true });
    expect(maOf(ma.caseId).summary).toBe("Coachens egen text.");
  });
});
