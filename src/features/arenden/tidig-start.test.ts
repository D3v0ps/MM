// Starta insatsen före det bokade första mötet (Karims beslut 2026-11-09 – deltagaren kom tidigare). Mot testdatat i minnet med
// demoklockan (måndag 1 februari 2027 kl. 09.12). Marias avrop em-101 (beställt i dag kl. 08.41, sex månader) accepteras med första
// möte måndag 8 februari kl. 10.00 – planerat slut 7 augusti. Deltagaren kommer redan i dag: insatsen startas i dag, första mötet
// flyttas till i dag och planerat slut räknas om till 31 juli. Bara påhittade uppgifter.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, Role } from "@/api/roles";
import { billableWeeks } from "@/core/billing";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { plannedEndFrom, orderPeriodBasis } from "@/core/early-start";
import { firstBookedMeetingAt } from "@/core/first-meeting";
import { defaultWeekPlan } from "@/core/schedule";
import { dayOf, isWorkingDay } from "@/core/time";
import { listPersonas } from "@/data/actors";
import { MemoryStore, type MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type DemoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import type { CaseCardResult, CaseHistory } from "./api";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
const boot = (clock: DemoClock = demoClock(DEMO_START)) => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock });
};
beforeEach(() => boot());
const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
type Res = { ok: boolean; error?: string; message?: string } & Record<string, unknown>;
const cmd = (key: string, input: unknown, actor: Actor) => rt.run("command", key, input, actor) as Promise<Res>;
const query = <T,>(key: string, input: unknown, actor: Actor) => rt.run("query", key, input, actor) as Promise<T>;
const sara = () => as("u-sara", "samordnare");
const amira = () => as("u-amira", "coach");
const leila = () => as("u-leila", "coach");
const erik = () => as("u-erik", "coach");
const rows = <N extends keyof Tables>(name: N) => rt.raw().all(name) as readonly Tables[N][];

/** Det bokade första mötet: måndag 8 februari kl. 10.00 – en vecka efter beställningen. */
const BOOKED = "2027-02-08T10:00";
const PLAN = defaultWeekPlan(BOTKYRKA_CONFIG, "2027-02-01T10:00");
const mariaCase = () => rt.raw().get("inbound_emails", "em-101")!.caseId as string;
const caseOf = (id: string) => rt.raw().get("cases", id)!;
const ownActivities = (caseId: string) => rows("activities").filter((a) => a.caseId === caseId && a.groupActivityId == null).sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
const confirmations = (caseId: string) => rows("reports").filter((r) => r.caseId === caseId && r.kind === "order_confirmation").sort((a, b) => a.version - b.version);

/** Sara accepterar em-101 med Amira som huvudcoach och första möte nästa måndag. */
async function accept(patch: Record<string, unknown> = {}) {
  const caseId = mariaCase();
  const res = await cmd("arenden.caseAccept", { caseId, leadCoachId: "u-amira", firstMeetingAt: BOOKED, primaryArea: "G", orderPeriodMonths: 6, ...patch }, sara());
  expect(res.ok, res.message).toBe(true);
  return caseId;
}
const startEarly = (caseId: string, startDate: string, actor: Actor = amira(), extra: Record<string, unknown> = {}) =>
  cmd("arenden.caseStart", { caseId, startDate, plan: PLAN, ...extra }, actor);
/** Inget skrevs: ärendet är bekräftat med det bokade mötet, inga tillfällen och bara den första orderbekräftelsen. */
function expectUntouched(caseId: string, booked = BOOKED) {
  expect(caseOf(caseId)).toMatchObject({ status: "confirmed", startDate: null, firstMeetingAt: booked });
  expect(ownActivities(caseId)).toEqual([]);
  expect(confirmations(caseId).map((r) => [r.version, r.superseded])).toEqual([[1, false]]);
  expect(rows("audit_log").filter((l) => l.entityId === caseId && l.action === "case.started")).toEqual([]);
}

describe("arenden.caseStart – deltagaren kom före det bokade första mötet", () => {
  it("i dag: insatsen startar, första mötet flyttas till startdagen, planerat slut räknas om och tillfällena skapas från startdatumet", async () => {
    const caseId = await accept();
    expect(caseOf(caseId)).toMatchObject({ status: "confirmed", firstMeetingAt: BOOKED, plannedStart: "2027-02-08", plannedEnd: "2027-08-07", plannedWeeks: 26 });
    const res = await startEarly(caseId, "2027-02-01");
    expect(res).toMatchObject({ ok: true, movedMeetingAt: "2027-02-01T10:00", plannedEnd: "2027-07-31", firstActivityAt: "2027-02-01T10:00" });
    const c = caseOf(caseId);
    expect(c).toMatchObject({
      status: "active", startDate: "2027-02-01", firstMeetingAt: "2027-02-01T10:00", plannedStart: "2027-02-01", plannedEnd: "2027-07-31", plannedWeeks: 26, orderValueWeeks: 26,
      orderPeriodMonths: 6, meetingDay: 0, meetingTime: "10:00", phaseSince: "2027-02-01",
    });
    // Slutet är det dialogen visar innan något sparas (plannedEndFrom).
    expect(plannedEndFrom(orderPeriodBasis(caseOf(caseId)), "2027-08-07", "2027-02-01")).toBe("2027-07-31");
    // Tillfällena: från startdatumet till det nya planerade slutet – det första är det flyttade mötet.
    const acts = ownActivities(caseId);
    expect(acts).toHaveLength(res.activities as number);
    expect(acts[0]).toMatchObject({ kind: "möte", startsAt: "2027-02-01T10:00" });
    expect(acts.every((a) => isWorkingDay(a.startsAt) && dayOf(a.startsAt) >= "2027-02-01" && dayOf(a.startsAt) <= "2027-07-31")).toBe(true);
    expect(new Set(acts.map((a) => `${a.startsAt}|${a.kind}`)).size).toBe(acts.length);
    // Statushistoriken och loggen: mötet flyttat (som en ombokning, med orsaken) och insatsen startad – bara id:n, tider och koder.
    expect(rows("case_status_history").filter((h) => h.caseId === caseId).at(-1)).toMatchObject({ fromStatus: "confirmed", toStatus: "active", reason: "Insatsen startad", changedBy: "u-amira" });
    const logs = rows("audit_log").filter((l) => l.entityId === caseId && ["case.first_meeting_booked", "case.started"].includes(l.action));
    expect(logs.map((l) => [l.action, l.actorId, l.details])).toEqual([
      ["case.first_meeting_booked", "u-amira", { at: "2027-02-01T10:00", rebooked: true, reason: "came_earlier", plannedEnd: "2027-07-31", plannedWeeks: 26 }],
      ["case.started", "u-amira", { startDate: "2027-02-01", plannedEnd: "2027-07-31", activities: acts.length, plan: ["måndag 10:00 möte", "tisdag 09:00 yrkesmoment", "torsdag 09:00 yrkesmoment"] }],
    ]);
  });

  it("kommunen får en ny version av orderbekräftelsen och mejlet om att den är uppdaterad – deltagaren får ingen kallelse", async () => {
    const caseId = await accept();
    const person = rt.raw().get("persons", caseOf(caseId).personId)!;
    const before = { out: rows("outbound_messages").length, tasks: rows("tasks").length, un: rows("user_notifications").length };
    expect((await startEarly(caseId, "2027-02-01", amira(), { meetingTime: "09:00" })).ok).toBe(true);
    expect(caseOf(caseId).firstMeetingAt).toBe("2027-02-01T09:00");
    // Version 2 är levererad till handläggaren, version 1 är ersatt (och fryst med det den lovade).
    const [v1, v2] = confirmations(caseId);
    expect(confirmations(caseId)).toHaveLength(2);
    expect(v1).toMatchObject({ version: 1, superseded: true, supersededBy: v2.id });
    expect(v2).toMatchObject({ version: 2, status: "delivered", superseded: false, previousId: v1.id, deliveredTo: ["k-maria"], approvedBy: "u-amira", deliveredAt: expect.any(String) });
    const delivered = rows("audit_log").filter((l) => l.action === "report.delivered" && l.entityId === v2.id);
    expect(delivered.map((l) => l.details)).toEqual([{ kind: "order_confirmation", channel: "portal", version: 2, reason: "first_meeting_rebooked", previous: v1.id }]);
    // Utskicken: bara mejlet till handläggaren – ärendenummer och länk, inga personuppgifter. Ingen kallelse, inget SMS, inget samtal
    // och ingen uppgift att ringa deltagaren.
    const sent = rows("outbound_messages").slice(before.out);
    expect(sent.map((m) => [m.channel, m.template])).toEqual([["email", "orderbekraftelse"]]);
    expect(sent[0].body).toBe(`Orderbekräftelsen för ärende ${caseOf(caseId).caseNumber} är uppdaterad – logga in i portalen för att läsa. Första mötet och planerat slut framgår där.`);
    expect(sent[0].body).not.toContain(person.firstName);
    expect(sent[0].body).not.toContain(person.lastName);
    expect(rows("outbound_messages").slice(before.out).filter((m) => m.template === "kallelse")).toEqual([]);
    expect(rows("tasks")).toHaveLength(before.tasks);
    // Loggen har inga personuppgifter – bara id:n, tider och koder.
    const text = JSON.stringify(rows("audit_log").filter((l) => l.entityId === caseId || l.entityId === v2.id));
    expect(text).not.toContain(person.firstName);
    expect(text).not.toContain(person.lastName);
    // Kommunens handläggare ser det flyttade mötet, det nya slutet och bara den gällande orderbekräftelsen.
    const portal = JSON.stringify(await query("kommun.deltagare", { caseId }, as("k-maria")));
    expect(portal).toContain("2027-02-01T09:00");
    expect(portal).toContain("2027-07-31");
    expect(portal).not.toContain("came_earlier");
  });

  it("i går går också: klockan onsdag 3 februari, deltagaren kom tisdag 2 februari", async () => {
    boot(demoClock("2027-02-03T09:00"));
    const caseId = await accept();
    const res = await startEarly(caseId, "2027-02-02", sara(), { meetingTime: "13:30" });
    expect(res).toMatchObject({ ok: true, movedMeetingAt: "2027-02-02T13:30", plannedEnd: "2027-08-01" });
    expect(caseOf(caseId)).toMatchObject({ status: "active", startDate: "2027-02-02", firstMeetingAt: "2027-02-02T13:30", plannedStart: "2027-02-02", plannedEnd: "2027-08-01" });
    expect(ownActivities(caseId)[0].startsAt >= "2027-02-02").toBe(true);
  });

  it("nekas utan att något skrivs: före beställningen, helg, en kommande dag före mötet", async () => {
    boot(demoClock("2027-02-09T09:00"));
    const caseId = await accept({ firstMeetingAt: "2027-02-15T10:00" });
    const out = rows("outbound_messages").length;
    const cases: [string, string, string][] = [
      ["2027-01-29", "before_order", "Startdatumet kan inte vara före beställningen 1 feb 2027."],
      ["2027-02-06", "not_working_day", "Dagen är inte en arbetsdag. Välj en vardag."],
      ["2027-02-07", "not_working_day", "Dagen är inte en arbetsdag. Välj en vardag."],
      ["2027-02-10", "start_date", "Startdatumet ligger före första mötet 15 feb 2027 men har inte varit än. Välj dagen deltagaren kom – i dag eller tidigare. Ska mötet hållas tidigare? Boka om första mötet."],
      ["2027-02-12", "start_date", "Startdatumet ligger före första mötet 15 feb 2027 men har inte varit än. Välj dagen deltagaren kom – i dag eller tidigare. Ska mötet hållas tidigare? Boka om första mötet."],
    ];
    for (const [startDate, error, message] of cases) {
      for (const actor of [amira(), leila(), sara()]) {
        expect(await startEarly(caseId, startDate, actor), `${startDate} ${actor.userId}`).toEqual({ ok: false, error, message });
      }
    }
    expectUntouched(caseId, "2027-02-15T10:00");
    expect(rows("outbound_messages")).toHaveLength(out);
  });

  it("vanlig start (mötets dag eller senare): mötet flyttas inte, ingen ny orderbekräftelse och inget mejl till kommunen", async () => {
    const caseId = await accept({ firstMeetingAt: "2027-02-01T10:00" });
    const out = rows("outbound_messages").length;
    const res = await cmd("arenden.caseStart", { caseId, startDate: "2027-02-01", plan: PLAN, meetingTime: "08:00" }, amira());
    expect(res).toMatchObject({ ok: true, movedMeetingAt: null, plannedEnd: "2027-07-31" });
    // Klockslaget läses bara när startdatumet ligger före det bokade mötet.
    expect(caseOf(caseId)).toMatchObject({ status: "active", firstMeetingAt: "2027-02-01T10:00", plannedEnd: "2027-07-31" });
    expect(confirmations(caseId).map((r) => [r.version, r.superseded])).toEqual([[1, false]]);
    expect(rows("outbound_messages").slice(out).filter((m) => m.template === "orderbekraftelse")).toEqual([]);
    expect(rows("audit_log").filter((l) => l.entityId === caseId && l.action === "case.first_meeting_booked")).toEqual([]);
  });

  it("fakturerad eller godkänd månad stoppar – och går igen när fakturan är krediterad", async () => {
    // BOT-27-0043: beställt torsdag 28 januari, första mötet bokat om till måndag 8 februari. Deltagaren kom fredag 29 januari.
    const CASE = "case-270043";
    expect((await cmd("arenden.caseBookFirstMeeting", { caseId: CASE, at: BOOKED }, sara())).ok).toBe(true);
    const plan = defaultWeekPlan(BOTKYRKA_CONFIG, "2027-01-29T10:00");
    const go = () => cmd("arenden.caseStart", { caseId: CASE, startDate: "2027-01-29", plan }, erik());
    const acts = ownActivities(CASE).length;
    const reps = confirmations(CASE).length;
    // Januari godkänd av ekonomen.
    rt.store.insertRow("invoice_drafts", {
      id: "inv-c-bot-2027-01-avtal", billingRunId: "br-2027-01", contractId: "c-bot", month: "2027-01", kind: "periodic", caseId: null, groupingKey: "avtal", buyerReference: "12345678",
      purchaseOrderNumber: null, invoicedObject: "332026110", accruedOre: null, remainingOre: null, status: "approved", approvedBy: "u-lars", approvedAt: "2027-02-01T08:00",
      manualInvoiceNo: null, fortnoxDocumentNumber: null, fortnoxIdempotencyKey: null, fortnoxCreatedAt: null, syncedAt: null,
    });
    expect(await go()).toEqual({
      ok: false, error: "invoiced",
      message: "Fakturan för januari 2027 är redan godkänd av ekonomen. Insatsen kan inte starta 29 jan 2027 när månadens faktura är godkänd – kontakta ekonomen.",
    });
    // Skapad faktura (skickad): fakturerad.
    rt.store.updateRow("invoice_drafts", "inv-c-bot-2027-01-avtal", { status: "sent" });
    expect(await go()).toEqual({
      ok: false, error: "invoiced", message: "Januari 2027 är redan fakturerad. Ekonomen behöver kreditera fakturan innan insatsen kan starta 29 jan 2027.",
    });
    expect(caseOf(CASE)).toMatchObject({ status: "confirmed", startDate: null, firstMeetingAt: BOOKED });
    expect(ownActivities(CASE)).toHaveLength(acts);
    expect(confirmations(CASE)).toHaveLength(reps);
    // Meddelandet säger ingenting om belopp, och svaret till coachen har bara koden och texten.
    // En start i februari (i dag) rörs inte av januarifakturan.
    rt.store.updateRow("invoice_drafts", "inv-c-bot-2027-01-avtal", { status: "credited" });
    expect(await go()).toMatchObject({ ok: true, movedMeetingAt: "2027-01-29T10:00" });
    expect(caseOf(CASE)).toMatchObject({ status: "active", startDate: "2027-01-29", firstMeetingAt: "2027-01-29T10:00" });
  });

  it("stängd körning för månaden stoppar också, men inte en start i en annan månad", async () => {
    const CASE = "case-270043";
    expect((await cmd("arenden.caseBookFirstMeeting", { caseId: CASE, at: BOOKED }, sara())).ok).toBe(true);
    const run = rows("billing_runs").find((r) => r.contractId === "c-bot" && r.month === "2027-01")!;
    rt.store.updateRow("billing_runs", run.id, { status: "closed" });
    const plan = defaultWeekPlan(BOTKYRKA_CONFIG, "2027-01-29T10:00");
    expect(await cmd("arenden.caseStart", { caseId: CASE, startDate: "2027-01-29", plan }, erik())).toMatchObject({ ok: false, error: "invoiced" });
    // I dag (måndag 1 februari, vecka 5 – februari) går.
    expect(await cmd("arenden.caseStart", { caseId: CASE, startDate: "2027-02-01", plan }, erik())).toMatchObject({ ok: true, movedMeetingAt: "2027-02-01T10:00" });
  });

  it("deltagaren kom inte till det bokade mötet: starten nekas som förut – och aldrig före ett möte som deltagaren inte kom till", async () => {
    const CASE = "case-270043";
    const plan = defaultWeekPlan(BOTKYRKA_CONFIG, "2027-01-29T14:00");
    expect((await cmd("arenden.caseFirstMeetingNoShow", { caseId: CASE, meetingAt: "2027-01-29T14:00", kind: "uteblev" }, erik())).ok).toBe(true);
    // Det nuvarande mötet är registrerat: ingen start, vilken dag det än är (regeln från 0040).
    for (const startDate of ["2027-01-28", "2027-01-29", "2027-02-01"]) {
      expect(await cmd("arenden.caseStart", { caseId: CASE, startDate, plan }, erik()), startDate).toMatchObject({ ok: false, error: "no_show" });
    }
    // Nytt första möte måndag 8 februari. Före mötet som deltagaren inte kom till går det inte – samma dag senare och dagarna efter går.
    expect((await cmd("arenden.caseBookFirstMeeting", { caseId: CASE, at: BOOKED }, erik())).ok).toBe(true);
    const text = "Det är registrerat att deltagaren inte kom till första mötet 29 jan kl. 14.00. Insatsen kan inte starta före det – välj en senare dag eller ett senare klockslag för mötet.";
    expect(await cmd("arenden.caseStart", { caseId: CASE, startDate: "2027-01-28", plan }, erik())).toEqual({ ok: false, error: "no_show", message: text });
    expect(await cmd("arenden.caseStart", { caseId: CASE, startDate: "2027-01-29", plan, meetingTime: "14:00" }, erik())).toEqual({ ok: false, error: "no_show", message: text });
    expect(await cmd("arenden.caseStart", { caseId: CASE, startDate: "2027-01-29", plan, meetingTime: "13:00" }, erik())).toEqual({ ok: false, error: "no_show", message: text });
    expect(caseOf(CASE)).toMatchObject({ status: "confirmed", startDate: null, firstMeetingAt: BOOKED });
    expect(await cmd("arenden.caseStart", { caseId: CASE, startDate: "2027-02-01", plan }, erik())).toMatchObject({ ok: true, movedMeetingAt: "2027-02-01T10:00" });
    // Nyckeltalet Första möte inom en vecka räknar fortfarande det första bokade mötet (mötet som deltagaren inte kom till).
    expect(firstBookedMeetingAt(caseOf(CASE), rows("first_meeting_no_shows"))).toBe("2027-01-29T14:00");
  });

  it("utan registrering räknas nyckeltalet på det flyttade mötet (Karims beslut 2026-11-09)", async () => {
    // BOT-27-0043 (beställt 28 januari – nyckeltalet på startsidan gäller förra månaden): mötet bokas om till 15 februari, sent.
    const CASE = "case-270043";
    type Kpi = { key: string; late: { caseId: string }[] };
    const late = async () => (await query<{ kpis: Kpi[] }>("inkorg.start", {}, sara())).kpis.find((k) => k.key === "forsta_mote_inom_en_vecka")?.late.map((x) => x.caseId) ?? [];
    expect(await late()).not.toContain(CASE);
    expect((await cmd("arenden.caseBookFirstMeeting", { caseId: CASE, at: "2027-02-15T10:00" }, sara())).ok).toBe(true);
    expect(await late()).toContain(CASE);
    // Deltagaren kom i dag: det flyttade mötet är ärendets första möte, och ärendet är inte längre sent.
    const plan = defaultWeekPlan(BOTKYRKA_CONFIG, "2027-02-01T10:00");
    expect((await cmd("arenden.caseStart", { caseId: CASE, startDate: "2027-02-01", plan }, erik())).ok).toBe(true);
    expect(firstBookedMeetingAt(caseOf(CASE), rows("first_meeting_no_shows"))).toBe("2027-02-01T10:00");
    expect(await late()).not.toContain(CASE);
  });

  it("veckorna faktureras från det tidiga startdatumet – inte från det bokade mötet", async () => {
    const CASE = "case-270043";
    expect((await cmd("arenden.caseBookFirstMeeting", { caseId: CASE, at: BOOKED }, sara())).ok).toBe(true);
    const db = () => ({ activities: [...rows("activities")], attendance: [...rows("attendance")] });
    expect(billableWeeks(caseOf(CASE), db(), { now: "2027-02-12T12:00" })).toEqual([]);
    const plan = defaultWeekPlan(BOTKYRKA_CONFIG, "2027-01-29T10:00");
    expect((await cmd("arenden.caseStart", { caseId: CASE, startDate: "2027-01-29", plan }, erik())).ok).toBe(true);
    // Fredag 29 januari är vecka 4: veckorna 4, 5 och 6 är debiterbara fredag 12 februari (med start på det bokade mötet: bara vecka 6).
    expect(billableWeeks(caseOf(CASE), db(), { now: "2027-02-12T12:00" }).map((w) => w.key)).toEqual(["2027-W04", "2027-W05", "2027-W06"]);
    // Äldre beställning i veckor (tio veckor): planerat slut räknas om från startveckan – fredagen i vecka 13.
    expect(caseOf(CASE)).toMatchObject({ plannedStart: "2027-01-29", plannedEnd: "2027-04-02", plannedWeeks: 10 });
    // Ekonomens underlag för ärendet har veckorna från starten (bara ekonomen ser belopp – coachens svar hade inga).
    const eko = JSON.stringify(await query("ekonomi.case", { caseId: CASE }, as("u-lars")));
    expect(eko).toContain("2027-W04");
  });

  it("annan tidsperiod: kommunens slutdatum ligger kvar och veckorna räknas om från startdagen", async () => {
    const caseId = await accept({ orderPeriodMonths: undefined, plannedEnd: "2027-05-28", orderPeriodReason: "Kortare insats enligt planeringen med deltagaren." });
    expect(caseOf(caseId)).toMatchObject({ plannedEnd: "2027-05-28", plannedWeeks: 16, orderPeriodMonths: null });
    const res = await startEarly(caseId, "2027-02-01");
    expect(res).toMatchObject({ ok: true, plannedEnd: "2027-05-28" });
    expect(caseOf(caseId)).toMatchObject({ plannedEnd: "2027-05-28", plannedWeeks: 17, orderValueWeeks: 17, firstMeetingAt: "2027-02-01T10:00" });
    expect(ownActivities(caseId).every((a) => dayOf(a.startsAt) <= "2027-05-28")).toBe(true);
  });

  it("roller: coach, samordnare och avtalsansvarig – kommunen, ekonomen, chefen och admin nekas av rollkontrollen", async () => {
    const caseId = await accept();
    for (const key of ["k-maria", "u-lars", "u-karin", "u-robin"]) {
      await expect(startEarly(caseId, "2027-02-01", as(key)), key).rejects.toThrow();
    }
    expectUntouched(caseId);
    expect((await startEarly(caseId, "2027-02-01", as("u-johan"))).ok).toBe(true);
  });

  it("två gånger: den andra starten nekas och ger ingen tredje orderbekräftelse", async () => {
    const caseId = await accept();
    expect((await startEarly(caseId, "2027-02-01")).ok).toBe(true);
    const n = { acts: ownActivities(caseId).length, out: rows("outbound_messages").length };
    expect(await startEarly(caseId, "2027-02-01")).toMatchObject({ ok: false, error: "wrong_status", message: "Insatsen har redan startat." });
    expect(confirmations(caseId)).toHaveLength(2);
    expect(ownActivities(caseId)).toHaveLength(n.acts);
    expect(rows("outbound_messages")).toHaveLength(n.out);
  });

  it("två samtidigt: hinner en kollega starta insatsen under tiden skrivs ingenting av den andra starten – inga dubbla tillfällen och ingen ny orderbekräftelse", async () => {
    const caseId = await accept();
    const out = rows("outbound_messages").length;
    // Kollegan startar insatsen (på det bokade mötets dag) precis när den här startens första tillfälle skrivs.
    const orig = MemoryStore.prototype.insertRow;
    let raced = false;
    const spy = vi.spyOn(MemoryStore.prototype, "insertRow").mockImplementation(function (this: MemoryStore<Tables>, name, row) {
      if (name === "activities" && !raced) {
        raced = true;
        this.updateRow("cases", caseId, { status: "active", startDate: "2027-02-08" });
      }
      return orig.call(this, name, row);
    });
    const res = await startEarly(caseId, "2027-02-01");
    spy.mockRestore();
    expect(raced).toBe(true);
    expect(res).toEqual({
      ok: false, error: "wrong_status", message: "Insatsen har redan startats eller ärendet har ändrats under tiden, kanske av en kollega. Ladda om sidan – inget har sparats.",
    });
    // Kollegans start står kvar orörd: det bokade mötet, inga tillfällen från den här starten och bara den första orderbekräftelsen.
    expect(caseOf(caseId)).toMatchObject({ status: "active", startDate: "2027-02-08", firstMeetingAt: BOOKED, plannedEnd: "2027-08-07" });
    expect(ownActivities(caseId)).toEqual([]);
    expect(confirmations(caseId).map((r) => [r.version, r.superseded])).toEqual([[1, false]]);
    expect(rows("outbound_messages")).toHaveLength(out);
    expect(rows("audit_log").filter((l) => l.entityId === caseId && ["case.first_meeting_booked", "case.started"].includes(l.action))).toEqual([]);
  });

  it("kan ärendet inte ändras blir ingenting halvskrivet: inga tillfällen, inget flyttat möte, ingen ny orderbekräftelse och inget mejl", async () => {
    const caseId = await accept();
    const out = rows("outbound_messages").length;
    const orig = MemoryStore.prototype.updateRow;
    const spy = vi.spyOn(MemoryStore.prototype, "updateRow").mockImplementation(function (this: MemoryStore<Tables>, name, id, patch) {
      if (name === "cases" && id === caseId) throw Object.assign(new Error("anslutningen bröts"), { code: "08006" });
      return orig.call(this, name, id, patch);
    });
    await expect(startEarly(caseId, "2027-02-01")).rejects.toThrow();
    spy.mockRestore();
    expectUntouched(caseId);
    expect(rows("outbound_messages")).toHaveLength(out);
    expect(rows("audit_log").filter((l) => l.entityId === caseId && l.action === "case.first_meeting_booked")).toEqual([]);
    // Nästa försök går, utan dubbletter.
    expect((await startEarly(caseId, "2027-02-01")).ok).toBe(true);
    const acts = ownActivities(caseId);
    expect(new Set(acts.map((a) => `${a.startsAt}|${a.kind}`)).size).toBe(acts.length);
    expect(confirmations(caseId)).toHaveLength(2);
  });

  it("deltagarkortet: underlaget till dialogen före starten, och historiken säger att mötet flyttades", async () => {
    const caseId = await accept();
    const card = await query<CaseCardResult>("arenden.kort", { caseId }, amira());
    if (card.kind !== "ok") throw new Error(card.kind);
    expect(card.start).toMatchObject({ firstMeetingAt: BOOKED, startDate: "2027-02-08", earliest: "2027-02-01", period: { months: 6, other: false, weeks: 26 } });
    expect(card.start?.planRows).toEqual(BOTKYRKA_CONFIG.activities?.defaultWeekPlan);
    expect((await startEarly(caseId, "2027-02-01")).ok).toBe(true);
    const after = await query<CaseCardResult>("arenden.kort", { caseId }, amira());
    if (after.kind !== "ok") throw new Error(after.kind);
    expect(after).toMatchObject({ status: "active", startDate: "2027-02-01", firstMeetingAt: "2027-02-01T10:00", plannedEnd: "2027-07-31", start: null });
    // Historiken (chefen läser revisionsloggens poster): "Första mötet bokades" med tiden och varför.
    const hist = await query<CaseHistory>("arenden.kortHistorik", { caseId }, as("u-karin"));
    expect(hist.log.find((x) => x.text === "Första mötet bokades" && x.sub.includes("flyttat"))).toMatchObject({
      actorName: "Amira Haddad", sub: "måndag 1 feb 2027 kl. 10.00, flyttat – deltagaren kom före det bokade mötet",
    });
    // Ändra startdatum efteråt: tidigast det flyttade mötets dag.
    const view = await query<{ earliest: string | null }>("arenden.startdatum", { caseId }, amira());
    expect(view.earliest).toBe("2027-02-01");
  });
});
