// Ändra veckoplan (Karims beslut 2026-11-11): den förifyllda planen läses bara av deltagarens egna tillfällen – aldrig av
// gruppaktiviteternas rader (t.ex. en nivåserie) – och en plan som sparas oförändrad ändrar ingenting, inte heller ett tillfälle
// som fått ny tid med Ändra tid. Granskningen 2026-11-11: också mitt i veckan, en vecka med en helgdag, med enstaka tillfällen,
// med praktik och med två rader samma veckodag – dialogens egen plan (planToDays/daysToPlan) sparas. Borttagna tillfällen
// stänger uppgiften att ringa om dem, och platsen får inte likna ett personnummer. Mot testdatat i minnet (måndag 1 februari
// 2027 kl. 09.12). Bara påhittade uppgifter.
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor, Role } from "@/api/roles";
import { planFromActivities } from "@/core/schedule";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Activity, Tables } from "@/data/schema";
import { groupActivityCreate } from "@/features/aktiviteter/api";
import { placementCreate } from "@/features/praktik/api";
import { contactTaskText } from "@/features/_shared/participant-notify";
import "@/api/handlers";
import { activityAdd, activityMove, activityRemove, caseCard, caseScheduleChange, type CaseCardResult } from "./api";
import { daysToPlan, planToDays } from "./screens/kort-start";

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

// ---------------------------------------------------------------- Granskningen 2026-11-11
/** Amira, coachträff måndag 14.00, yrkesmoment onsdag och torsdag 09.00, planerat slut 12 mars – ingen praktik i testdatat. */
const ALBIN = "case-270012";
const cardOf = async (caseId: string) => {
  const r = (await rt.run("query", caseCard.key, { caseId }, amira())) as CaseCardResult;
  if (r.kind !== "ok") throw new Error(r.kind);
  return r;
};
/** Det dialogen skickar när coachen öppnar Ändra veckoplan och trycker Spara utan att röra något. */
const dialogPlan = async (caseId: string) => daysToPlan(planToDays((await cardOf(caseId)).weekPlan!, "Miljonbemanning"));
const saveUnchanged = async (caseId: string) => cmd(caseScheduleChange.key, { caseId, plan: await dialogPlan(caseId) });
const own = (caseId: string) => (rt.store.rows("activities") as Activity[]).filter((a) => a.caseId === caseId && !a.groupActivityId);
const snapOf = (caseId: string) => own(caseId).map((a) => [a.id, a.kind, a.startsAt, a.durationMin, a.location].join("|")).sort();
/** Planen fylld till planerat slut (som när insatsen startas) – planen sparas en gång. */
const fill = async (caseId: string) => expect(await saveUnchanged(caseId)).toMatchObject({ ok: true, removed: 0 });
const practice = (caseId: string, weekdays: number[], endsOn: string) =>
  cmd(placementCreate.key, { caseId, newEmployer: { name: "Testföretaget AB" }, startsOn: "2027-02-01", endsOn, weekdays, time: "08:00", durationMin: 420 });

describe("Ändra veckoplan – öppna och spara oförändrad (granskningen 2026-11-11)", () => {
  it("mitt i veckan (onsdag): planen läses av hela veckan från måndagen – måndagens coachträff står kvar och ingenting ändras", async () => {
    rt.clock.set("2027-02-03T08:00");
    const plan = (await cardOf(ALBIN)).weekPlan!;
    expect(plan.map((r) => `${r.weekday}|${r.kind}|${r.time}`)).toEqual(["0|möte|14:00", "2|yrkesmoment|09:00", "3|yrkesmoment|09:00"]);
    const first = await saveUnchanged(ALBIN);
    expect(first).toMatchObject({ ok: true, removed: 0 });
    expect(first.added).toBeGreaterThan(0);
    const before = snapOf(ALBIN);
    expect(await saveUnchanged(ALBIN)).toMatchObject({ ok: true, removed: 0, added: 0 });
    expect(snapOf(ALBIN)).toEqual(before);
    expect(own(ALBIN).filter((a) => a.kind === "möte" && a.startsAt > "2027-02-03").length).toBeGreaterThanOrEqual(5);
    // Samma regel i den rena funktionen: onsdag läser veckans måndag som har varit.
    expect(planFromActivities([{ kind: "möte", startsAt: "2027-02-01T14:00", durationMin: 60, location: "x" }, { kind: "yrkesmoment", startsAt: "2027-02-03T09:00", durationMin: 180, location: "x" }], "2027-02-03"))
      .toEqual([{ weekday: 0, kind: "möte", time: "14:00", durationMin: 60, location: "x" }, { weekday: 2, kind: "yrkesmoment", time: "09:00", durationMin: 180, location: "x" }]);
  });

  it("en helgdag i veckan: veckodagen läses nästa vecka – annandag påsk tar inte bort måndagarnas coachträff", async () => {
    rt.store.updateRow("cases", ALBIN, { plannedEnd: "2027-04-16" });
    await fill(ALBIN);
    rt.clock.set("2027-03-29T08:00");
    const plan = (await cardOf(ALBIN)).weekPlan!;
    expect(plan.some((r) => r.weekday === 0 && r.kind === "möte" && r.time === "14:00")).toBe(true);
    const before = snapOf(ALBIN);
    expect(await saveUnchanged(ALBIN)).toMatchObject({ ok: true, removed: 0, added: 0 });
    expect(snapOf(ALBIN)).toEqual(before);
    expect(own(ALBIN).some((a) => a.startsAt === "2027-04-05T14:00" && a.kind === "möte")).toBe(true);
    expect(own(ALBIN).some((a) => a.startsAt.startsWith("2027-03-29"))).toBe(false);
  });

  it("enstaka tillfällen (Lägg till tillfälle) står inte i planen och ligger kvar – också när planen ändras", async () => {
    await fill(ALBIN);
    const extra = await cmd(activityAdd.key, { caseId: ALBIN, kind: "yrkesmoment", startsAt: "2027-02-03T13:00", durationMin: 120, location: "Miljonbemanning Alby" }) as Res & { activityId: string };
    const extraMeeting = await cmd(activityAdd.key, { caseId: ALBIN, kind: "möte", startsAt: "2027-02-09T10:00", durationMin: 60, location: "Miljonbemanning Alby" }) as Res & { activityId: string };
    expect(extra).toMatchObject({ ok: true });
    const plan = (await cardOf(ALBIN)).weekPlan!;
    expect(plan.some((r) => r.time === "13:00" || r.weekday === 1)).toBe(false);
    const before = snapOf(ALBIN);
    expect(await saveUnchanged(ALBIN)).toMatchObject({ ok: true, removed: 0, added: 0 });
    expect(snapOf(ALBIN)).toEqual(before);
    const changed = await cmd(caseScheduleChange.key, { caseId: ALBIN, plan: plan.map((r) => (r.kind === "möte" ? { ...r, time: "15:00" } : r)) });
    expect(changed).toMatchObject({ ok: true });
    expect(changed.removed).toBeGreaterThan(0);
    expect(rt.raw().get("activities", extra.activityId)).toBeTruthy();
    expect(rt.raw().get("activities", extraMeeting.activityId)).toBeTruthy();
  });

  it("praktik måndag–fredag: praktikens dagar står inte i planen, coachträffen ligger kvar och inga praktikdagar efter praktikens slut", async () => {
    await fill(ALBIN);
    expect(await practice(ALBIN, [0, 1, 2, 3, 4], "2027-02-12")).toMatchObject({ ok: true });
    const plan = (await cardOf(ALBIN)).weekPlan!;
    expect(plan.map((r) => `${r.weekday}|${r.kind}|${r.time}`)).toEqual(["0|möte|14:00", "2|yrkesmoment|09:00", "3|yrkesmoment|09:00"]);
    const meetings = own(ALBIN).filter((a) => a.kind === "möte").length;
    const before = snapOf(ALBIN);
    expect(await saveUnchanged(ALBIN)).toMatchObject({ ok: true, removed: 0, added: 0 });
    expect(snapOf(ALBIN)).toEqual(before);
    expect(own(ALBIN).filter((a) => a.kind === "möte").length).toBe(meetings);
    expect(own(ALBIN).filter((a) => a.kind === "praktikdag").every((a) => a.startsAt <= "2027-02-12T23:59")).toBe(true);
  });

  it("praktik tisdag och torsdag som slutar mitt i insatsen: torsdagarnas yrkesmoment efter praktiken ligger kvar och planen lägger inga praktikdagar efter slutet", async () => {
    await fill(ALBIN);
    expect(await practice(ALBIN, [1, 3], "2027-02-12")).toMatchObject({ ok: true });
    const thursdaysAfter = () => own(ALBIN).filter((a) => a.kind === "yrkesmoment" && a.startsAt > "2027-02-13" && a.startsAt.endsWith("T09:00") && new Date(a.startsAt).getUTCDay() === 4).length;
    const after = thursdaysAfter();
    expect(after).toBeGreaterThan(0);
    const plan = (await cardOf(ALBIN)).weekPlan!;
    expect(plan.some((r) => r.kind === "praktikdag")).toBe(false);
    expect(plan.some((r) => r.weekday === 3 && r.kind === "yrkesmoment")).toBe(true);
    const before = snapOf(ALBIN);
    expect(await saveUnchanged(ALBIN)).toMatchObject({ ok: true, removed: 0, added: 0 });
    expect(snapOf(ALBIN)).toEqual(before);
    expect(thursdaysAfter()).toBe(after);
    // En plan med praktikdag på tisdagar: aldrig efter praktikens slut.
    expect(await cmd(caseScheduleChange.key, { caseId: ALBIN, plan: [...plan, { weekday: 1, kind: "praktikdag", time: "08:00", durationMin: 420, location: "Testföretaget AB" }] })).toMatchObject({ ok: true });
    expect(own(ALBIN).filter((a) => a.kind === "praktikdag").every((a) => a.startsAt <= "2027-02-12T23:59")).toBe(true);
  });

  it("två rader samma veckodag: dialogen visar den första, den andra ligger kvar när planen sparas", async () => {
    const plan = (await cardOf(ALBIN)).weekPlan!;
    const two = [...plan, { weekday: 0, kind: "yrkesmoment" as const, time: "09:00", durationMin: 120, location: "Miljonbemanning Alby" }];
    expect(await cmd(caseScheduleChange.key, { caseId: ALBIN, plan: two })).toMatchObject({ ok: true, removed: 0 });
    expect((await cardOf(ALBIN)).weekPlan!.filter((r) => r.weekday === 0)).toHaveLength(2);
    expect((await dialogPlan(ALBIN)).filter((r) => r.weekday === 0)).toHaveLength(1);
    const before = snapOf(ALBIN);
    expect(await saveUnchanged(ALBIN)).toMatchObject({ ok: true, removed: 0, added: 0 });
    expect(snapOf(ALBIN)).toEqual(before);
  });

  it("en gruppaktivitet som ersatte deltagarens eget tillfälle: dagen läses inte, och planen sparad oförändrad ändrar ingenting", async () => {
    const g = await rt.run("command", groupActivityCreate.key, {
      name: "Nivåträff", kind: "yrkesmoment", startsAt: "2027-02-03T09:00", durationMin: 120, location: "Miljonbemanning Alby", caseIds: [NADIA], replaceOverlapping: true,
    }, amira()) as { ok: boolean; replaced?: number };
    expect(g).toMatchObject({ ok: true, replaced: 1 });
    // Borttagningen loggas på ärendet – bara id:n och tiden.
    const log = rt.store.rows("audit_log").filter((l) => l.action === "activity.removed").pop()!;
    expect(log).toMatchObject({ entity: "case", entityId: NADIA, details: { caseId: NADIA, kind: "yrkesmoment", startsAt: "2027-02-03T09:00" } });
    expect(Object.keys(log.details ?? {}).sort()).toEqual(["activityId", "caseId", "groupActivityId", "kind", "startsAt"]);
    expect((await card()).weekPlan!.some((r) => r.weekday === 2 && r.kind === "yrkesmoment")).toBe(true);
    const before = snapshot();
    expect(await cmd(caseScheduleChange.key, { caseId: NADIA, plan: daysToPlan(planToDays((await card()).weekPlan!, "Miljonbemanning")) })).toMatchObject({ ok: true, removed: 0, added: 0 });
    expect(snapshot()).toEqual(before);
  });

  it("insatsens sista vecka: planen öppnad igen efter en sparning har kvar veckodagarna före sparningen", async () => {
    await fill(NADIA);
    rt.clock.set("2027-02-16T08:00");
    const plan = (await card()).weekPlan!;
    expect(plan.some((r) => r.weekday === 0 && r.kind === "möte")).toBe(true);
    expect(await cmd(caseScheduleChange.key, { caseId: NADIA, plan: daysToPlan(planToDays(plan, "Miljonbemanning")) })).toMatchObject({ ok: true, removed: 0, added: 0 });
    expect((await card()).weekPlan).toEqual(plan);
    const before = snapshot();
    expect(await cmd(caseScheduleChange.key, { caseId: NADIA, plan: daysToPlan(planToDays((await card()).weekPlan!, "Miljonbemanning")) })).toMatchObject({ ok: true, removed: 0, added: 0 });
    expect(snapshot()).toEqual(before);
    // Samma regel i den rena funktionen: ändrad i dag (tisdag), ingen måndag efter – måndagen i veckan räknas.
    expect(planFromActivities([{ kind: "möte", startsAt: "2027-02-15T10:00", durationMin: 60, location: "x" }, { kind: "yrkesmoment", startsAt: "2027-02-17T09:00", durationMin: 180, location: "x" }], "2027-02-16", { changedAt: "2027-02-16T08:00", end: "2027-02-19" }))
      .toEqual([{ weekday: 0, kind: "möte", time: "10:00", durationMin: 60, location: "x" }, { weekday: 2, kind: "yrkesmoment", time: "09:00", durationMin: 180, location: "x" }]);
  });

  it("ett tillfälle som tagits bort för hand den här veckan: veckodagen läses nästa vecka och ingenting annat ändras", async () => {
    await fill(ALBIN);
    const wed = own(ALBIN).find((a) => a.startsAt === "2027-02-03T09:00")!;
    expect(await cmd(activityRemove.key, { activityId: wed.id })).toMatchObject({ ok: true });
    expect((await cardOf(ALBIN)).weekPlan!.some((r) => r.weekday === 2)).toBe(true);
    const before = snapOf(ALBIN);
    expect(await saveUnchanged(ALBIN)).toMatchObject({ ok: true, removed: 0, added: 0 });
    expect(snapOf(ALBIN)).toEqual(before);
  });
});

describe("Ta bort och Ändra veckoplan – uppgifter och platsen (granskningen 2026-11-11)", () => {
  const openTasks = (caseId: string) => (rt.store.rows("tasks") as Tables["tasks"][]).filter((t) => t.kind === "participant_contact" && t.status === "open" && t.caseIds.includes(caseId));

  it("Ta bort: uppgiften att ringa deltagaren om tillfällets tid stängs", async () => {
    const c = rt.raw().get("cases", NADIA)!;
    rt.store.updateRow("persons", c.personId, { email: "", phone: "" });
    const meeting = own(NADIA).filter((a) => a.kind === "möte" && a.startsAt > DEMO_START).sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))[0];
    expect(await cmd(activityMove.key, { activityId: meeting.id, expectedStartsAt: meeting.startsAt, startsAt: "2027-02-05T13:30", durationMin: 60, notify: true })).toMatchObject({ ok: true });
    expect(openTasks(NADIA)).toHaveLength(1);
    expect(await cmd(activityRemove.key, { activityId: meeting.id })).toMatchObject({ ok: true });
    expect(openTasks(NADIA)).toEqual([]);
    const done = (rt.store.rows("tasks") as Tables["tasks"][]).filter((t) => t.kind === "participant_contact" && t.caseIds.includes(NADIA)).pop()!;
    expect(done).toMatchObject({ status: "done", doneNote: "Tillfället är borttaget." });
  });

  it("Ändra veckoplan: de borttagna tillfällenas uppgifter stängs, andra ligger kvar", async () => {
    await fill(ALBIN);
    const c = rt.raw().get("cases", ALBIN)!;
    const wed = own(ALBIN).find((a) => a.startsAt === "2027-02-10T09:00")!;
    const thu = own(ALBIN).find((a) => a.startsAt === "2027-02-11T09:00")!;
    for (const [i, a] of [wed, thu].entries()) {
      rt.store.insertRow("tasks", {
        id: `task-probe-${i}`, toRole: "samordnare", toId: null, fromId: "u-amira", createdAt: DEMO_START, status: "open", kind: "participant_contact", caseIds: [ALBIN],
        text: contactTaskText("aktivitet_andrad", c.caseNumber, a.startsAt, a.location, ["no_email", "no_phone"]), deviationId: null, emailId: null, responseId: null,
        month: null, doneAt: null, doneBy: null, doneNote: null,
      });
    }
    const plan = (await cardOf(ALBIN)).weekPlan!.filter((r) => r.weekday !== 2);
    expect(await cmd(caseScheduleChange.key, { caseId: ALBIN, plan })).toMatchObject({ ok: true });
    expect(rt.raw().get("activities", wed.id)).toBeFalsy();
    expect(openTasks(ALBIN).map((t) => t.id)).toEqual(["task-probe-1"]);
    expect(rt.raw().get("tasks", "task-probe-0")).toMatchObject({ status: "done", doneNote: "Tillfället är borttaget." });
  });

  it("en plats med ett giltigt personnummer stoppas – i veckoplanen och i Lägg till tillfälle", async () => {
    const plan = (await cardOf(ALBIN)).weekPlan!;
    const PNR = { ok: false, error: "location", message: "Platsen ser ut att innehålla ett personnummer. Skriv bara platsen." };
    const before = snapOf(ALBIN);
    expect(await cmd(caseScheduleChange.key, { caseId: ALBIN, plan: plan.map((r, i) => (i === 0 ? { ...r, location: "Hos 19121212-1212" } : r)) })).toMatchObject(PNR);
    expect(await cmd(activityAdd.key, { caseId: ALBIN, kind: "möte", startsAt: "2027-02-09T10:00", durationMin: 60, location: "121212-1212" })).toMatchObject(PNR);
    expect(snapOf(ALBIN)).toEqual(before);
  });

  it("ett telefon- eller organisationsnummer i platsen går – och en plats som redan finns på ärendets tillfällen kontrolleras inte", async () => {
    for (const [i, location] of ["Volvo AB 556013-9700", "Ring 0701234567"].entries()) {
      expect(await cmd(activityAdd.key, { caseId: ALBIN, kind: "möte", startsAt: `2027-02-0${8 + i}T15:00`, durationMin: 60, location })).toMatchObject({ ok: true });
    }
    // Äldre data: en plats som redan står på ärendets tillfällen stoppar inte en plan som sparas med samma plats.
    const old = own(ALBIN).find((a) => a.kind === "yrkesmoment" && a.startsAt > DEMO_START)!;
    for (const a of own(ALBIN).filter((x) => x.kind === "yrkesmoment" && x.startsAt.endsWith("T09:00"))) rt.store.updateRow("activities", a.id, { location: "Lokal 19121212-1212" });
    const plan = (await cardOf(ALBIN)).weekPlan!;
    expect(plan.some((r) => r.location === "Lokal 19121212-1212")).toBe(true);
    expect(await cmd(caseScheduleChange.key, { caseId: ALBIN, plan })).toMatchObject({ ok: true });
    expect(rt.raw().get("activities", old.id)).toBeTruthy();
  });
});
