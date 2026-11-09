// Deltagaren kom inte till första mötet (Karims beslut 2026-11-09, migration 0040). Mot testdatat i minnet med demoklockan
// (måndag 1 februari 2027 kl. 09.12): BOT-27-0043 (huvudcoach Erik, handläggare Omar) är bekräftat utan startdatum och första mötet
// var fredag 29 januari kl. 14.00. Besluten: bara första mötet, internt (kommunen får inget besked och ser det aldrig), ingen
// närvaro och aldrig fakturerat.
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor, Role } from "@/api/roles";
import { billableWeeks } from "@/core/billing";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { defaultWeekPlan } from "@/core/schedule";
import { weeklyReport } from "@/core/weekly-report";
import { listPersonas } from "@/data/actors";
import { MemoryRepo, type MemoryData } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createMemoryRuntime, demoClock, type DemoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import type { CaseCardResult, CaseTimeline } from "./api";

const SEED: MemoryData<Tables> = createSeed();
const CASE = "case-270043";
const MEETING = "2027-01-29T14:00";
let rt: MemoryRuntime;
/** Klockan står still (samma svar före och efter ett kommando) – eller går som demoklockan, en minut per kommando. */
const fixedClock = (t = DEMO_START): DemoClock => ({ now: () => t, tick: () => undefined, set: () => undefined });
const start = (clock: DemoClock = demoClock(DEMO_START)) => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock });
};
beforeEach(() => start());
const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
type Res = { ok: boolean; error?: string; message?: string } & Record<string, unknown>;
const cmd = (key: string, input: unknown, actor: Actor) => rt.run("command", key, input, actor) as Promise<Res>;
const query = <T,>(key: string, input: unknown, actor: Actor) => rt.run("query", key, input, actor) as Promise<T>;
const erik = () => as("u-erik", "coach");
const amira = () => as("u-amira", "coach");
const sara = () => as("u-sara", "samordnare");
const register = (actor: Actor, patch: Record<string, unknown> = {}) =>
  cmd("arenden.caseFirstMeetingNoShow", { caseId: CASE, meetingAt: MEETING, kind: "uteblev", ...patch }, actor);
const rows = <N extends keyof Tables>(name: N) => rt.raw().all(name) as readonly Tables[N][];
const card = async (actor: Actor) => {
  const c = await query<CaseCardResult>("arenden.kort", { caseId: CASE }, actor);
  if (c.kind !== "ok") throw new Error(`kortet: ${c.kind}`);
  return c;
};
/** Svaret utan klockans fält (ett kommando flyttar inte den fasta klockan, men svaren innehåller "nu"). */
const stable = (v: unknown) => JSON.stringify(v);

describe("arenden.caseFirstMeetingNoShow – registrera att deltagaren inte kom", () => {
  it("coachen registrerar uteblev: en rad, loggen med id:n och slaget – inga tillfällen, ingen närvaro, inga utskick, inga notiser", async () => {
    const before = { act: rows("activities").length, att: rows("attendance").length, out: rows("outbound_messages").length, un: rows("user_notifications").length,
      tasks: rows("tasks").length, msg: rows("messages").length, hist: rows("case_status_history").length, rep: rows("reports").length };
    const res = await register(erik());
    expect(res).toMatchObject({ ok: true, kind: "uteblev" });
    expect(rows("first_meeting_no_shows")).toEqual([
      { id: res.noShowId, caseId: CASE, contractId: "c-bot", meetingAt: MEETING, kind: "uteblev", reason: null, registeredBy: "u-erik", registeredAt: expect.any(String) },
    ]);
    const log = rows("audit_log").filter((x) => x.action === "case.first_meeting_no_show");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: "u-erik", entity: "case", entityId: CASE, contractId: "c-bot", details: { caseId: CASE, noShowId: res.noShowId, kind: "uteblev" } });
    expect(Object.keys(log[0].details).sort()).toEqual(["caseId", "kind", "noShowId"]);
    expect({ act: rows("activities").length, att: rows("attendance").length, out: rows("outbound_messages").length, un: rows("user_notifications").length,
      tasks: rows("tasks").length, msg: rows("messages").length, hist: rows("case_status_history").length, rep: rows("reports").length }).toEqual(before);
    expect(rt.raw().get("cases", CASE)).toMatchObject({ status: "confirmed", startDate: null, firstMeetingAt: MEETING });
  });

  it("giltig frånvaro kräver en orsak – personnummer stoppas, och orsaken står aldrig i loggen", async () => {
    expect(await register(amira(), { kind: "giltig" })).toMatchObject({ ok: false, error: "reason" });
    expect(await register(amira(), { kind: "giltig", reason: "   " })).toMatchObject({ ok: false, error: "reason" });
    expect(await register(amira(), { kind: "giltig", reason: "Ringde och var sjuk, 19900101-1234" })).toMatchObject({ ok: false, error: "pnr" });
    expect(await register(amira(), { kind: "giltig", reason: "x".repeat(301) })).toMatchObject({ ok: false, error: "reason" });
    expect(rows("first_meeting_no_shows")).toEqual([]);
    const res = await register(amira(), { kind: "giltig", reason: "  Ringde på morgonen och var sjuk.  " });
    expect(res).toMatchObject({ ok: true, kind: "giltig" });
    expect(rows("first_meeting_no_shows")[0]).toMatchObject({ kind: "giltig", reason: "Ringde på morgonen och var sjuk.", registeredBy: "u-amira" });
    const log = rows("audit_log").filter((x) => x.entityId === CASE);
    expect(JSON.stringify(log)).not.toContain("sjuk");
  });

  it("roller: coach, samordnare och avtalsansvarig – chef, admin, ekonom och kommunen nekas", async () => {
    for (const a of [as("u-karin"), as("u-robin"), as("u-lars"), as("k-omar")]) await expect(register(a), a.userId).rejects.toThrow();
    expect(rows("first_meeting_no_shows")).toEqual([]);
    expect(await register(sara())).toMatchObject({ ok: true });
    start();
    expect(await register(as("u-johan", "avtalsansvarig"))).toMatchObject({ ok: true });
  });

  it("kontrollerna: mötet har inte varit, ett ombokat möte, startad insats, inget möte – och samma möte en gång", async () => {
    rt.store.updateRow("cases", CASE, { firstMeetingAt: "2027-02-01T10:00" });
    expect(await register(erik(), { meetingAt: "2027-02-01T10:00" })).toMatchObject({ ok: false, error: "not_passed" });
    // Dialogen visade det gamla mötet: bokat om under tiden.
    expect(await register(erik())).toMatchObject({ ok: false, error: "conflict" });
    rt.store.updateRow("cases", CASE, { firstMeetingAt: null });
    expect(await register(erik())).toMatchObject({ ok: false, error: "no_meeting" });
    rt.store.updateRow("cases", CASE, { firstMeetingAt: MEETING, status: "active", startDate: "2027-01-29" });
    expect(await register(erik())).toMatchObject({ ok: false, error: "wrong_status" });
    rt.store.updateRow("cases", CASE, { status: "confirmed", startDate: "2027-02-01" });
    expect(await register(erik())).toMatchObject({ ok: false, error: "wrong_status" });
    rt.store.updateRow("cases", CASE, { startDate: null });
    expect(rows("first_meeting_no_shows")).toEqual([]);
    // Samma möte en gång: samma registrering igen svarar som första gången (ingen ny rad), en annan nekas.
    const first = await register(erik());
    expect(first.ok).toBe(true);
    expect(await register(erik())).toEqual(first);
    expect(await register(erik(), { kind: "giltig", reason: "Sjuk." })).toMatchObject({ ok: false, error: "already" });
    expect(await register(sara())).toMatchObject({ ok: false, error: "already" });
    expect(rows("first_meeting_no_shows")).toHaveLength(1);
    expect(rows("audit_log").filter((x) => x.action === "case.first_meeting_no_show")).toHaveLength(1);
  });

  it("precis när mötet börjar går det (Stockholms tid) – en minut före inte", async () => {
    start(fixedClock("2027-01-29T13:59"));
    expect(await register(erik())).toMatchObject({ ok: false, error: "not_passed" });
    start(fixedClock(MEETING));
    expect(await register(erik())).toMatchObject({ ok: true });
  });
});

describe("deltagarkortet, ombokningen och tidslinjen", () => {
  it("kortet: knappen före, rutan efter – med Boka nytt första möte (coachen) och Avsluta (coachen); samordnaren bokar men avslutar inte", async () => {
    const before = await card(erik());
    expect(before.noShow).toEqual({ canRegister: true, missedBefore: false, current: null, canRebook: false, canClose: true });
    expect(before.start).toMatchObject({ firstMeetingAt: MEETING, startDate: "2027-01-29" });
    await register(erik());
    const after = await card(erik());
    expect(after.noShow).toMatchObject({
      canRegister: false, missedBefore: true, canRebook: true, canClose: true,
      current: { meetingAt: MEETING, kind: "uteblev", text: "Kom inte till första mötet 29 jan kl. 14.00 – uteblev utan att meddela.", reason: null },
    });
    // Starta insatsen finns inte längre: nästa steg är ett nytt första möte eller Avsluta.
    expect(after.start).toBeNull();
    const samordnare = await card(sara());
    expect(samordnare.noShow).toMatchObject({ canRegister: false, canRebook: true, canClose: false });
    expect(samordnare.start).toBeNull();
    // Chefen läser i läsläge: rutan utan knappar och utan orsak.
    expect((await card(as("u-karin"))).noShow).toMatchObject({ canRegister: false, canRebook: false, canClose: false, current: { kind: "uteblev", reason: null } });
  });

  it("orsaken syns bara för den som får ändra i ärendet", async () => {
    await register(erik(), { kind: "giltig", reason: "Sjuk enligt handläggaren." });
    expect((await card(sara())).noShow?.current?.reason).toBe("Sjuk enligt handläggaren.");
    expect((await card(as("u-karin"))).noShow?.current?.reason).toBeNull();
  });

  it("coachen bokar ett nytt första möte bara efter registreringen – en gång; orderbekräftelsen till kommunen som vid en ombokning, utan spår av registreringen", async () => {
    const at = "2027-02-03T10:00";
    expect(await cmd("arenden.caseBookFirstMeeting", { caseId: CASE, at }, erik())).toMatchObject({ ok: false, error: "forbidden" });
    await register(erik());
    const out0 = rows("outbound_messages").length;
    expect(await cmd("arenden.caseBookFirstMeeting", { caseId: CASE, at }, erik())).toMatchObject({ ok: true });
    expect(rt.raw().get("cases", CASE)).toMatchObject({ status: "confirmed", startDate: null, firstMeetingAt: at });
    // Ombokningens följder som förut: ny orderbekräftelse till handläggaren och kallelse till deltagaren (tid och plats).
    const confirmations = rows("reports").filter((r) => r.caseId === CASE && r.kind === "order_confirmation" && !r.superseded);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].version).toBe(2);
    const sent = rows("outbound_messages").slice(out0);
    expect(sent.some((m) => m.template === "orderbekraftelse")).toBe(true);
    expect(JSON.stringify(sent)).not.toMatch(/kom inte|uteblev|giltig|frånvaro/i);
    // Det nya mötet har ingen registrering: kortet visar Starta insatsen från det nya mötets dag, och coachen kan inte boka om igen.
    // missedBefore: bokningsdialogen varnar inte för en sen tid (nyckeltalet räknar det första bokade mötet).
    const c = await card(erik());
    expect(c.noShow).toMatchObject({ canRegister: false, missedBefore: true, current: null, canRebook: false });
    expect(c.start).toMatchObject({ firstMeetingAt: at, startDate: "2027-02-03" });
    expect(await cmd("arenden.caseBookFirstMeeting", { caseId: CASE, at: "2027-02-04T10:00" }, erik())).toMatchObject({ ok: false, error: "forbidden" });
    // Samordnaren bokar som förut.
    expect(await cmd("arenden.caseBookFirstMeeting", { caseId: CASE, at: "2027-02-04T10:00" }, sara())).toMatchObject({ ok: true });
    // Registreringen står kvar i tidslinjen.
    const tl = await query<CaseTimeline>("arenden.kortTidslinje", { caseId: CASE, visa: "alla" }, erik());
    const entries = tl.months.flatMap((m) => m.entries).filter((e) => e.id.startsWith("fmns:"));
    expect(entries).toEqual([{ id: expect.stringMatching(/^fmns:/), at: MEETING, cat: "insatser", icon: "x-circle", title: "Kom inte till första mötet 29 jan kl. 14.00", sub: "Uteblev utan att meddela" }]);
  });

  it("insatsen startas inte på mötet som deltagaren inte kom till – först efter ett nytt första möte, från det mötets dag", async () => {
    await register(erik());
    const plan = defaultWeekPlan(BOTKYRKA_CONFIG, MEETING);
    const acts0 = rows("activities").length;
    for (const [actor, startDate] of [[erik(), "2027-01-29"], [erik(), "2027-02-01"], [sara(), "2027-02-02"]] as const) {
      const res = await cmd("arenden.caseStart", { caseId: CASE, startDate, plan }, actor);
      expect(res, startDate).toMatchObject({ ok: false, error: "no_show" });
      expect(res.message).toBe("Deltagaren kom inte till första mötet 29 jan kl. 14.00. Boka ett nytt första möte innan insatsen startar – eller avsluta insatsen om deltagaren aldrig kom.");
    }
    expect(rt.raw().get("cases", CASE)).toMatchObject({ status: "confirmed", startDate: null });
    expect(rows("activities")).toHaveLength(acts0);
    // Nytt första möte onsdag 3 februari: Starta insatsen från den dagen.
    const at = "2027-02-03T10:00";
    expect(await cmd("arenden.caseBookFirstMeeting", { caseId: CASE, at }, erik())).toMatchObject({ ok: true });
    expect((await card(erik())).start).toMatchObject({ firstMeetingAt: at, startDate: "2027-02-03" });
    expect(await cmd("arenden.caseStart", { caseId: CASE, startDate: "2027-02-03", plan: defaultWeekPlan(BOTKYRKA_CONFIG, at) }, erik())).toMatchObject({ ok: true });
    expect(rt.raw().get("cases", CASE)).toMatchObject({ status: "active", startDate: "2027-02-03" });
    expect((await card(erik())).noShow).toBeNull();
    // Registreringen ligger kvar men skapade inga tillfällen eller närvaro – tillfällena kommer från veckoplanen, från 3 februari.
    expect(rows("first_meeting_no_shows")).toHaveLength(1);
    expect(rows("attendance").filter((x) => x.caseId === CASE)).toEqual([]);
    expect(rows("activities").filter((x) => x.caseId === CASE && x.startsAt < "2027-02-03")).toEqual([]);
  });

  it("bokas det nya mötet samma dag startar insatsen tidigast dagen efter – aldrig dagen då deltagaren inte kom", async () => {
    start(demoClock("2027-01-29T15:00"));
    expect((await register(erik())).ok).toBe(true);
    const at = "2027-01-29T16:00";
    expect(await cmd("arenden.caseBookFirstMeeting", { caseId: CASE, at }, erik())).toMatchObject({ ok: true });
    // Förslaget: nästa arbetsdag (fredag -> måndag), så att helgen inte gör veckan debiterbar.
    expect((await card(erik())).start).toMatchObject({ firstMeetingAt: at, startDate: "2027-02-01" });
    const plan = defaultWeekPlan(BOTKYRKA_CONFIG, at);
    const res = await cmd("arenden.caseStart", { caseId: CASE, startDate: "2027-01-29", plan }, erik());
    expect(res).toMatchObject({ ok: false, error: "start_date", message: "Startdatumet måste vara efter 29 jan 2027 – deltagaren kom inte till första mötet den dagen." });
    expect(rt.raw().get("cases", CASE)).toMatchObject({ status: "confirmed", startDate: null });
    expect(await cmd("arenden.caseStart", { caseId: CASE, startDate: "2027-02-01", plan }, erik())).toMatchObject({ ok: true });
    expect(rt.raw().get("cases", CASE)).toMatchObject({ status: "active", startDate: "2027-02-01" });
  });

  it("bokningen prövas på servern för alla roller: inte passerad, en ny tid och en arbetsdag – inga utskick och ingen ny orderbekräftelse när den nekas", async () => {
    await register(erik());
    const snapshot = () => ({ out: rows("outbound_messages").length, reps: rows("reports").length, c: rt.raw().get("cases", CASE) });
    const before = snapshot();
    const bad: [string, string][] = [["2027-01-29T14:00", "past"], ["2027-02-01T08:00", "past"], ["2027-02-06T10:00", "not_working_day"], ["2027-01-22T10:00", "past"]];
    for (const actor of [erik(), sara()]) {
      for (const [at, error] of bad) expect(await cmd("arenden.caseBookFirstMeeting", { caseId: CASE, at }, actor), `${actor.userId} ${at}`).toMatchObject({ ok: false, error });
    }
    expect(snapshot()).toEqual(before);
    // Samma tid som det bokade mötet igen (dubbelklick, två flikar): nekas – en orderbekräftelse och en kallelse, inte tre.
    const at = "2027-02-03T10:00";
    expect(await cmd("arenden.caseBookFirstMeeting", { caseId: CASE, at }, sara())).toMatchObject({ ok: true });
    const once = snapshot();
    for (const actor of [sara(), as("u-johan", "avtalsansvarig")]) {
      expect(await cmd("arenden.caseBookFirstMeeting", { caseId: CASE, at }, actor)).toMatchObject({ ok: false, error: "same_time", message: "Första mötet är redan bokat 3 feb kl. 10.00. Välj en annan tid." });
    }
    expect(snapshot()).toEqual(once);
    expect(rows("reports").filter((r) => r.caseId === CASE && r.kind === "order_confirmation" && !r.superseded)).toHaveLength(1);
  });

  it("Avsluta – deltagaren kom aldrig: coachen avslutar det bekräftade ärendet med en orsak som coachen väljer", async () => {
    await register(erik());
    const res = await cmd("arenden.caseClose", { caseId: CASE, endDate: "2027-02-01", endReason: "avbrott_deltagarens_val", verified: false }, erik());
    expect(res).toMatchObject({ ok: true });
    expect(rt.raw().get("cases", CASE)).toMatchObject({ status: "closed", endReason: "avbrott_deltagarens_val", startDate: null });
    expect((await card(erik())).noShow).toBeNull();
  });
});

describe("Min vecka", () => {
  it("coachen: raden för mötet som har varit får Deltagaren kom inte – efter registreringen blir den Boka nytt första möte", async () => {
    type Row = { caseId: string; noShow: { text: string } | null; canRegisterNoShow: boolean };
    const toStart = async () => (await query<{ toStart: Row[] }>("coach.minVecka", {}, erik())).toStart.find((x) => x.caseId === CASE);
    expect(await toStart()).toMatchObject({ noShow: null, canRegisterNoShow: true });
    await register(erik());
    expect(await toStart()).toMatchObject({ noShow: { text: "Kom inte till första mötet 29 jan kl. 14.00 – uteblev utan att meddela." }, canRegisterNoShow: false });
  });

  it("samordnaren: samma rad med underlaget för bokningen", async () => {
    type Row = { caseId: string; noShow: { text: string } | null; canRegisterNoShow: boolean; rebook: { caseId: string; caseNumber: string } };
    const toStart = async () => (await query<{ toStart: Row[] }>("inkorg.start", {}, sara())).toStart.find((x) => x.caseId === CASE);
    expect(await toStart()).toMatchObject({ noShow: null, canRegisterNoShow: true, rebook: { caseId: CASE, caseNumber: "BOT-27-0043" } });
    await register(sara());
    expect(await toStart()).toMatchObject({ noShow: { text: expect.stringContaining("uteblev utan att meddela") }, canRegisterNoShow: false });
  });
});

describe("räknas aldrig – och kommunen ser ingenting", () => {
  it("fakturering, veckorapporter, KPI:er, rapporter och ekonomens ärende är oförändrade med en registrering", async () => {
    start(fixedClock());
    const lars = as("u-lars");
    const karin = as("u-karin");
    const snapshot = async () => stable({
      runJan: await query("ekonomi.run", { month: "2027-01" }, lars), runFeb: await query("ekonomi.run", { month: "2027-02" }, lars),
      ekoCase: await query("ekonomi.case", { caseId: CASE }, lars), overview: await query("ledning.overview", {}, karin), reports: await query("rapporter.lista", {}, sara()),
      weekly: weeklyReport({ cases: [...rows("cases")], activities: [...rows("activities")], attendance: [...rows("attendance")], deviations: [...rows("deviations")] }, "k-omar", "2027-W04", { now: DEMO_START }),
      billable: billableWeeks(rt.raw().get("cases", CASE)!, { activities: [...rows("activities")], attendance: [...rows("attendance")] }, { now: DEMO_START }),
    });
    const before = await snapshot();
    expect((await register(erik(), { kind: "giltig", reason: "Sjuk enligt handläggaren." })).ok).toBe(true);
    expect(await snapshot()).toBe(before);
    expect(JSON.parse(before).billable).toEqual([]);
  });

  it("Första möte inom en vecka räknar det första bokade mötet: en sen ombokning efter registreringen gör inte ärendet sent (Karims beslut 2026-11-09)", async () => {
    start(fixedClock());
    type Kpi = { key: string; value: string; sub: string; late: { caseId: string }[] };
    const inbox = async () => (await query<{ kpis: Kpi[] }>("inkorg.start", {}, sara())).kpis.find((k) => k.key === "forsta_mote_inom_en_vecka");
    const mgmt = async () => stable((await query<{ sla: unknown }>("ledning.overview", {}, as("u-karin"))).sla);
    const before = { inbox: await inbox(), mgmt: await mgmt() };
    expect(before.inbox?.late.map((x) => x.caseId)).not.toContain(CASE);
    expect((await register(erik())).ok).toBe(true);
    // Det nya mötet ligger långt efter avtalets gräns (en vecka från beställningen).
    expect(await cmd("arenden.caseBookFirstMeeting", { caseId: CASE, at: "2027-02-15T10:00" }, sara())).toMatchObject({ ok: true });
    expect({ inbox: await inbox(), mgmt: await mgmt() }).toEqual(before);
  });

  it("kommunens svar (start, deltagarlistan, deltagarens sida och rapporterna) är desamma och har inget spår av registreringen", async () => {
    start(fixedClock());
    const omar = as("k-omar");
    const snapshot = async () => stable({
      start: await query("kommun.start", {}, omar), list: await query("kommun.deltagareLista", {}, omar), case: await query("kommun.deltagare", { caseId: CASE }, omar),
      reports: await query("kommun.rapporter", {}, omar),
    });
    const before = await snapshot();
    const res = await register(erik(), { kind: "giltig", reason: "Sjuk enligt handläggaren." });
    expect(res.ok).toBe(true);
    const after = await snapshot();
    expect(after).toBe(before);
    expect(after).not.toMatch(/kom inte|uteblev|giltig frånvaro|Sjuk enligt|fmns/i);
    // Kommunen läser inte raden – inte heller direkt i tabellen (policyn).
    expect(await new MemoryRepo<Tables>(rt.store, omar, POLICIES).table("first_meeting_no_shows").list()).toEqual([]);
    // Och inget mejl eller meddelande till kommunen eller deltagaren.
    expect(rows("outbound_messages").filter((m) => m.caseId === CASE && m.createdAt >= DEMO_START)).toEqual([]);
  });
});
