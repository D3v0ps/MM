// Ändra tid för ett tillfälle (Karims beslut 2026-11-11): kommandot arenden.activityMove mot testdatat i minnet (måndag 1 februari
// 2027 kl. 09.12), reglerna i src/core/activity-move.ts, meddelandet till deltagaren (CLAUDE.md punkt 9) och den delade
// formateraren för längd. Bara påhittade uppgifter.
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { activityMoveMonths, activityMoveProblem } from "@/core/activity-move";
import { fmtDuration } from "@/core/format";
import { NO_BILLING } from "@/core/start-date";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, decodeTestPnr, DEMO_START, normalizePnr } from "@/data/seed";
import type { Activity, Tables } from "@/data/schema";
import { groupActivityCreate } from "@/features/aktiviteter/api";
import { attendanceSet } from "@/features/coach/api";
import "@/api/handlers";
import { activityMove } from "./api";

const SEED: MemoryData<Tables> = createSeed();
const NADIA = "case-260143";
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
type Res = { ok: boolean; error?: string; message?: string; changed?: boolean; notified?: string | null };
const move = (input: Record<string, unknown>, actor: Actor) => rt.run("command", activityMove.key, input, actor) as Promise<Res>;
const rows = <N extends keyof Tables>(name: N) => rt.store.rows(name) as Tables[N][];
const amira = () => as("u-amira", "coach");
/** En annan coach än huvudcoachen – alla coacher arbetar i alla ärenden i avtalet (beslut 2026-10-09). */
const erik = () => as("u-erik", "coach");
const sara = () => as("u-sara", "samordnare");
const johan = () => as("u-johan", "avtalsansvarig");

/** Nadias nästa egna coachträff (inte en gruppaktivitet). */
const nextMeeting = (): Activity => ({
  ...rows("activities").filter((a) => a.caseId === NADIA && !a.groupActivityId && a.kind === "möte" && a.startsAt > DEMO_START).sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))[0],
});
const input = (a: Activity, patch: Record<string, unknown> = {}) => ({ activityId: a.id, expectedStartsAt: a.startsAt, startsAt: "2027-02-05T13:30", durationMin: 60, notify: true, ...patch });
const messages = (from: number) => rows("outbound_messages").slice(from);

/** Inga namn, personnummer, ärendenummer, aktivitetens namn eller ord om insatsen i utskicken (CLAUDE.md punkt 9). */
function expectOnlyTimePlacePhone(texts: string[]) {
  const pii = rows("persons").flatMap((p) => [p.firstName, p.lastName, p.email, p.phone, normalizePnr(decodeTestPnr(p.personnummerEnc))]).filter((x): x is string => !!x && x.length >= 4);
  for (const t of texts) {
    for (const x of pii) expect(t.includes(x), `"${x}" i "${t}"`).toBe(false);
    expect(t).not.toMatch(/BOT-\d|coachträff|yrkesmoment|arbetsmarknad|insats|kommun|Botkyrka/i);
  }
}

describe("arenden.activityMove – flytta en coachträff", () => {
  it("ny dag, tid och längd på samma rad; deltagaren får aktivitet_andrad med bara tid, plats och telefonnummer; loggen har bara id:n och tider", async () => {
    const a = nextMeeting();
    expect(a).toBeTruthy();
    const out0 = rows("outbound_messages").length;
    const res = await move(input(a), amira());
    expect(res).toMatchObject({ ok: true, changed: true });
    expect(res.notified).toMatch(/^Meddelandet om ändringen skickas med /);
    expect(rt.raw().get("activities", a.id)).toMatchObject({ startsAt: "2027-02-05T13:30", durationMin: 60, location: a.location, kind: "möte", caseId: NADIA });
    // Samma rad – inget nytt tillfälle.
    expect(rows("activities").filter((x) => x.caseId === NADIA && x.startsAt === "2027-02-05T13:30")).toHaveLength(1);
    const sent = messages(out0);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((m) => m.template === "aktivitet_andrad" && m.caseId === NADIA && m.to.startsWith("deltagare ("))).toBe(true);
    expect(sent.some((m) => m.channel === "call")).toBe(false);
    const body = sent.find((m) => m.channel === "email" || m.channel === "sms")!.body;
    expect(body).toContain("Nu gäller fredag 5 februari kl. 13.30");
    expect(body).toMatch(/Frågor\? Ring /);
    expectOnlyTimePlacePhone(sent.flatMap((m) => [m.body, m.subject ?? "", m.to]));
    const log = rows("audit_log").filter((l) => l.action === "activity.moved");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity: "activity", entityId: a.id, actorId: "u-amira", details: { caseId: NADIA, from: a.startsAt, to: "2027-02-05T13:30", fromDurationMin: a.durationMin, toDurationMin: 60 } });
    expect(Object.keys(log[0].details).sort()).toEqual(["caseId", "from", "fromDurationMin", "to", "toDurationMin"]);
  });

  it("utan meddelande när rutan inte är ikryssad; platsen kan ändras; samma tid igen ändrar ingenting", async () => {
    const a = nextMeeting();
    const out0 = rows("outbound_messages").length;
    expect(await move(input(a, { notify: false, location: "Miljonbemanning Tumba" }), amira())).toMatchObject({ ok: true, changed: true, notified: null });
    expect(messages(out0)).toEqual([]);
    expect(rt.raw().get("activities", a.id)).toMatchObject({ location: "Miljonbemanning Tumba" });
    expect(rows("audit_log").filter((l) => l.action === "activity.moved").pop()!.details).toMatchObject({ locationChanged: true });
    const again = await move({ activityId: a.id, expectedStartsAt: "2027-02-05T13:30", startsAt: "2027-02-05T13:30", durationMin: 60, location: "Miljonbemanning Tumba", notify: true }, amira());
    expect(again).toMatchObject({ ok: true, changed: false, notified: null });
    expect(messages(out0)).toEqual([]);
  });

  it("samordnaren, avtalsansvarig och en annan coach får flytta; kommunen, ekonomen, chefen och admin nekas av rollkontrollen", async () => {
    const a = nextMeeting();
    expect(await move(input(a, { startsAt: "2027-02-05T13:30" }), erik())).toMatchObject({ ok: true });
    expect(await move(input({ ...a, startsAt: "2027-02-05T13:30" }, { startsAt: "2027-02-05T14:30" }), sara())).toMatchObject({ ok: true });
    expect(await move(input({ ...a, startsAt: "2027-02-05T14:30" }, { startsAt: "2027-02-05T15:00" }), johan())).toMatchObject({ ok: true });
    const kommun = listPersonas(rt.raw()).find((p) => p.actor.role === "kommun_handlaggare")!.actor;
    for (const actor of [kommun, as("u-lars", "ekonom"), as("u-karin", "chef"), as("u-robin", "admin")]) {
      await expect(move(input({ ...a, startsAt: "2027-02-05T15:00" }, { startsAt: "2027-02-05T16:00" }), actor), actor.role).rejects.toBeInstanceOf(ApiError);
    }
    expect(rt.raw().get("activities", a.id)!.startsAt).toBe("2027-02-05T15:00");
  });

  it("två som flyttar samtidigt: bara den första går igenom – ett meddelande, en loggrad", async () => {
    const a = nextMeeting();
    const out0 = rows("outbound_messages").length;
    const [x, y] = await Promise.all([move(input(a, { startsAt: "2027-02-05T13:30" }), amira()), move(input(a, { startsAt: "2027-02-05T14:30" }), sara())]);
    expect([x, y].filter((r) => r.ok)).toHaveLength(1);
    expect([x, y].find((r) => !r.ok)).toMatchObject({ error: "conflict" });
    expect(rows("audit_log").filter((l) => l.action === "activity.moved")).toHaveLength(1);
    const rounds = new Set(messages(out0).map((m) => m.body));
    expect(rounds.size).toBe(1);
  });

  it("deltagaren går inte att nå: samordnaren får en uppgift att ringa med ärendenummer, tid och plats – aldrig namnet", async () => {
    const a = nextMeeting();
    const c = rt.raw().get("cases", NADIA)!;
    rt.store.updateRow("persons", c.personId, { email: "", phone: "" });
    const res = await move(input(a), amira());
    expect(res).toMatchObject({ ok: true, notified: "Meddelandet om ändringen kunde inte skickas. Samordnaren har fått en uppgift att ringa deltagaren." });
    const task = rows("tasks").filter((t) => t.kind === "participant_contact" && t.caseIds.includes(NADIA) && t.status === "open").pop()!;
    expect(task.text).toMatch(/^Ring deltagaren och berätta om aktivitetens nya tid eller plats – ärende BOT-26-0143, fredag 5 februari kl\. 13\.30/);
    const p = rt.raw().get("persons", c.personId)!;
    expect(task.text).not.toContain(p.firstName);
    expect(task.text).not.toContain(p.lastName);
  });
});

describe("arenden.activityMove – reglerna", () => {
  it("registrerad närvaro, passerad tid, före start, efter slut, helg, uppehåll, gruppaktivitet, fel ärendestatus och en tid som ändrats under tiden", async () => {
    const a = nextMeeting();
    const c = rt.raw().get("cases", NADIA)!;
    expect(await move(input(a, { startsAt: "2027-02-01T09:00" }), amira())).toMatchObject({ ok: false, error: "past" });
    expect(await move(input(a, { startsAt: `${c.startDate}T08:00` }), amira())).toMatchObject({ ok: false, error: "past" });
    const end = c.endDate ?? c.plannedEnd!;
    expect(await move(input(a, { startsAt: "2031-01-07T10:00" }), amira())).toMatchObject({ ok: false, error: "date", message: expect.stringContaining(end.slice(0, 4)) });
    expect(await move(input(a, { startsAt: "2027-02-06T10:00" }), amira())).toMatchObject({ ok: false, error: "not_working_day", message: "Dagen är inte en arbetsdag. Välj en vardag." });
    rt.store.updateRow("cases", NADIA, { pausedWeeks: ["2027-W06"] });
    expect(await move(input(a, { startsAt: "2027-02-09T10:00" }), amira())).toMatchObject({ ok: false, error: "paused_week", message: "Vecka 6 är ett uppehåll i insatsen. Välj en annan vecka." });
    rt.store.updateRow("cases", NADIA, { pausedWeeks: [] });
    expect(await move(input(a, { expectedStartsAt: "2027-02-02T10:00" }), amira())).toMatchObject({ ok: false, error: "conflict" });
    // Ett tillfälle i en gruppaktivitet flyttas i aktivitetsvyn.
    const g = await rt.run("command", groupActivityCreate.key, { name: "CV-verkstad", kind: "yrkesmoment", startsAt: "2027-02-04T13:00", durationMin: 90, location: "Miljonbemanning Alby", caseIds: [NADIA], replaceOverlapping: true }, amira()) as { ok: boolean; groupActivityId: string };
    expect(g).toMatchObject({ ok: true });
    const row = rows("activities").find((x) => x.groupActivityId === g.groupActivityId)!;
    expect(await move(input(row, { startsAt: "2027-02-05T13:30" }), amira())).toMatchObject({ ok: false, error: "group_activity" });
    rt.store.updateRow("cases", NADIA, { status: "closed" });
    expect(await move(input(a), amira())).toMatchObject({ ok: false, error: "wrong_status" });
    // Inget av det skrev något.
    expect(rt.raw().get("activities", a.id)!.startsAt).toBe(a.startsAt);
    expect(rows("audit_log").filter((l) => l.action === "activity.moved")).toEqual([]);
  });

  it("registrerad närvaro stoppar: ett tillfälle som har hänt flyttas inte", async () => {
    const past = rows("activities").filter((x) => x.caseId === NADIA && !x.groupActivityId && x.startsAt < DEMO_START && !rows("attendance").some((t) => t.activityId === x.id))
      .sort((x, y) => (x.startsAt < y.startsAt ? 1 : -1))[0];
    const reg = past ?? rows("activities").find((x) => x.caseId === NADIA && !x.groupActivityId && x.startsAt < DEMO_START)!;
    if (!rows("attendance").some((t) => t.activityId === reg.id)) expect(await rt.run("command", attendanceSet.key, { activityId: reg.id, status: "present" }, amira())).toMatchObject({ ok: true });
    expect(await move(input(reg), amira())).toMatchObject({ ok: false, error: "has_attendance", message: "Närvaron är redan registrerad för tillfället. Tiden kan inte ändras." });
  });

  it("krockar: ett annat eget tillfälle eller en gruppaktivitet vid den nya tiden stoppar – en tid som slutar när nästa börjar går", async () => {
    const a = nextMeeting();
    const other = rows("activities").find((x) => x.caseId === NADIA && !x.groupActivityId && x.id !== a.id && x.startsAt > DEMO_START && x.startsAt.slice(0, 10) !== a.startsAt.slice(0, 10))!;
    const res = await move(input(a, { startsAt: other.startsAt, durationMin: 30 }), amira());
    expect(res).toMatchObject({ ok: false, error: "overlap" });
    expect(res.message).toMatch(/^Deltagaren har redan .+ kl\. \d\d\.\d\d–\d\d\.\d\d\. Välj en annan tid\.$/);
    await rt.run("command", groupActivityCreate.key, { name: "CV-verkstad", kind: "yrkesmoment", startsAt: "2027-02-05T13:00", durationMin: 90, location: "Miljonbemanning Alby", caseIds: [NADIA], replaceOverlapping: true }, amira());
    const g = await move(input(a, { startsAt: "2027-02-05T14:00", durationMin: 60 }), amira());
    expect(g).toMatchObject({ ok: false, error: "overlap", message: expect.stringContaining("i en gruppaktivitet") });
    // Slutar 13.00 när gruppaktiviteten börjar: ingen krock.
    expect(await move(input(a, { startsAt: "2027-02-05T12:00", durationMin: 60 }), amira())).toMatchObject({ ok: true });
  });

  it("en fakturerad eller godkänd månad stoppar (samma spärr som Ändra startdatum)", async () => {
    const a = nextMeeting();
    rt.store.insertRow("billing_runs", { id: "br-test-2027-02", contractId: "c-bot", month: "2027-02", status: "closed", createdBy: "u-lars", createdAt: DEMO_START, closedAt: DEMO_START, closedBy: "u-lars" } as never);
    expect(await move(input(a), amira())).toMatchObject({ ok: false, error: "invoiced", message: "Februari 2027 är redan fakturerad. Tiden kan inte ändras – ekonomen behöver kreditera fakturan först." });
  });
});

describe("reglerna som ren funktion och längden i klarspråk", () => {
  const c = { id: "case-1", contractId: "c-1", startDate: "2027-01-11", endDate: null, plannedEnd: "2027-06-30", pausedWeeks: [] };
  const a = { id: "a-1", startsAt: "2027-02-03T10:00" };
  const p = (to: string, extra: Partial<Parameters<typeof activityMoveProblem>[0]> = {}) =>
    activityMoveProblem({ c, a, to: { startsAt: to, durationMin: 60 }, now: "2027-02-01T09:12", registered: false, others: [], billing: NO_BILLING, ...extra })?.code ?? null;

  it("Stockholms tid: en tid senare i dag går, en tid som har passerat går inte", () => {
    expect(p("2027-02-01T09:13")).toBeNull();
    expect(p("2027-02-01T09:12")).toBe("past");
    expect(p("2027-01-29T10:00")).toBe("past");
  });

  it("månaderna följer torsdagsregeln: fredag 1 oktober 2027 hör till september", () => {
    expect(activityMoveMonths("2027-09-28T10:00", "2027-10-01T10:00")).toEqual(["2027-09"]);
    expect(activityMoveMonths("2027-02-03T10:00", "2027-03-04T10:00")).toEqual(["2027-02", "2027-03"]);
  });

  it("tillfället självt räknas inte som krock", () => {
    expect(p("2027-02-03T10:30", { others: [{ id: "a-1", kind: "möte", startsAt: "2027-02-03T10:00", durationMin: 60, groupActivityId: null }] })).toBeNull();
  });

  it("längden: 45 minuter, 1 timme, 1,5 timmar, 3 timmar – samma ord i formulären och listorna", () => {
    expect([30, 45, 60, 90, 120, 180, 480].map(fmtDuration)).toEqual(["30 minuter", "45 minuter", "1 timme", "1,5 timmar", "2 timmar", "3 timmar", "8 timmar"]);
  });
});
