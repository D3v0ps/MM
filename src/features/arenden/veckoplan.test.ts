// Ändra veckoplan (Karims beslut 2026-11-11): den förifyllda planen läses bara av deltagarens egna tillfällen – aldrig av
// gruppaktiviteternas rader (t.ex. en nivåserie) – och en plan som sparas oförändrad ändrar ingenting, inte heller ett tillfälle
// som fått ny tid med Ändra tid. Mot testdatat i minnet (måndag 1 februari 2027 kl. 09.12). Bara påhittade uppgifter.
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor, Role } from "@/api/roles";
import { planFromActivities } from "@/core/schedule";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Activity, Tables } from "@/data/schema";
import { groupActivityCreate } from "@/features/aktiviteter/api";
import "@/api/handlers";
import { activityMove, caseCard, caseScheduleChange, type CaseCardResult } from "./api";

const SEED: MemoryData<Tables> = createSeed();
const NADIA = "case-260143";
let rt: MemoryRuntime;
beforeEach(async () => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
  // Testdatat har bara nästa veckas egna tillfällen. Planen fylls först ut till planerat slut – som när insatsen startas
  // (Starta insatsen skapar alla veckor) – så att testerna utgår från ett ärende med hela planen.
  expect(await cmd(caseScheduleChange.key, { caseId: NADIA, plan: (await card()).weekPlan })).toMatchObject({ ok: true, removed: 0 });
});
const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
const amira = () => as("u-amira", "coach");
type Res = { ok: boolean; error?: string; removed?: number; added?: number };
const cmd = (key: string, input: unknown, actor: Actor = amira()) => rt.run("command", key, input, actor) as Promise<Res>;
const card = async () => {
  const r = (await rt.run("query", caseCard.key, { caseId: NADIA }, amira())) as CaseCardResult;
  if (r.kind !== "ok") throw new Error(r.kind);
  return r;
};
/** Nadias kommande tillfällen som jämförbara rader (id, typ, tid, längd, plats och gruppaktivitet). */
const snapshot = () =>
  (rt.store.rows("activities") as Activity[])
    .filter((a) => a.caseId === NADIA && a.startsAt >= DEMO_START)
    .map((a) => [a.id, a.kind, a.startsAt, a.durationMin, a.location, a.groupActivityId ?? null].join("|"))
    .sort();

describe("Ändra veckoplan – den förifyllda planen", () => {
  it("gruppaktiviteternas rader blir aldrig deltagarens egna: en nivåaktivitet onsdag 13.00 står inte i planen", async () => {
    const g = await rt.run("command", groupActivityCreate.key, {
      name: "Nivåträff", kind: "yrkesmoment", startsAt: "2027-02-03T13:00", durationMin: 90, location: "Miljonbemanning Alby", caseIds: [NADIA], replaceOverlapping: true,
    }, amira()) as { ok: boolean };
    expect(g).toMatchObject({ ok: true });
    const plan = (await card()).weekPlan!;
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.some((r) => r.weekday === 2 && r.time === "13:00")).toBe(false);
    // Samma regel i den rena funktionen.
    expect(planFromActivities([{ kind: "yrkesmoment", startsAt: "2027-02-03T13:00", durationMin: 90, location: "x", groupActivityId: "ga-1" }], "2027-02-01")).toEqual([]);
  });

  it("planen sparad oförändrad ändrar ingenting – inte gruppaktiviteten och inte deltagarens egna tillfällen", async () => {
    await rt.run("command", groupActivityCreate.key, {
      name: "Nivåträff", kind: "yrkesmoment", startsAt: "2027-02-03T13:00", durationMin: 90, location: "Miljonbemanning Alby", caseIds: [NADIA], replaceOverlapping: true,
    }, amira());
    const before = snapshot();
    const res = await cmd(caseScheduleChange.key, { caseId: NADIA, plan: (await card()).weekPlan });
    expect(res).toMatchObject({ ok: true, removed: 0, added: 0 });
    expect(snapshot()).toEqual(before);
    expect(rt.store.rows("audit_log").filter((l) => l.action === "case.schedule_changed").pop()!.details).toMatchObject({ removed: 0, added: 0 });
  });

  it("ett tillfälle som fått ny tid med Ändra tid: planen är densamma, och en oförändrad plan ångrar inte flytten", async () => {
    const planBefore = (await card()).weekPlan;
    const meeting = { ...(rt.store.rows("activities") as Activity[]).filter((a) => a.caseId === NADIA && !a.groupActivityId && a.kind === "möte" && a.startsAt > DEMO_START).sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))[0] };
    expect(await cmd(activityMove.key, { activityId: meeting.id, expectedStartsAt: meeting.startsAt, startsAt: "2027-02-05T13:30", durationMin: 60, notify: false })).toMatchObject({ ok: true });
    expect((await card()).weekPlan).toEqual(planBefore);
    const before = snapshot();
    expect(await cmd(caseScheduleChange.key, { caseId: NADIA, plan: planBefore })).toMatchObject({ ok: true, removed: 0, added: 0 });
    expect(snapshot()).toEqual(before);
    expect(rt.raw().get("activities", meeting.id)).toMatchObject({ startsAt: "2027-02-05T13:30" });
    expect((rt.store.rows("activities") as Activity[]).some((a) => a.caseId === NADIA && a.startsAt === meeting.startsAt && a.kind === "möte")).toBe(false);
  });

  it("en ändrad plan ersätter bara det som inte stämmer: ny tid för coachträffen (11.00), yrkesmomenten ligger kvar", async () => {
    const plan = (await card()).weekPlan!;
    const meet = plan.find((r) => r.kind === "möte")!;
    const keptIds = (rt.store.rows("activities") as Activity[]).filter((a) => a.caseId === NADIA && !a.groupActivityId && a.kind === "yrkesmoment" && a.startsAt > DEMO_START).map((a) => a.id);
    const res = await cmd(caseScheduleChange.key, { caseId: NADIA, plan: plan.map((r) => (r === meet ? { ...r, time: "11:00" } : r)) });
    expect(res).toMatchObject({ ok: true });
    expect(res.removed).toBe(res.added);
    const now = (rt.store.rows("activities") as Activity[]).filter((a) => a.caseId === NADIA && a.startsAt > DEMO_START);
    for (const id of keptIds) expect(now.some((a) => a.id === id)).toBe(true);
    expect(now.filter((a) => a.kind === "möte" && !a.groupActivityId).every((a) => a.startsAt.endsWith("T11:00"))).toBe(true);
  });
});
