// Ändra startdatum (Karims beslut 2026-10-29): kommandot arenden.andraStartdatum och raden på deltagarkortet mot testdatat i
// minnet (MemoryRuntime, samma hanterare som appen). Ordningen: anteckningen, ändringen (som ändrar ärendets startdatum i samma
// steg – triggern case_start_changes_apply), tillfällena före det nya datumet, revisionsloggen och inbjudningarna.
import { beforeEach, describe, expect, it } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { SYSTEM_ACTOR } from "@/api/roles";
import { ApiError } from "@/api/server";
import { billingLines } from "@/core/billing";
import { requireOperational } from "@/core/config";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import { monthlyDraftInput } from "@/features/_shared/voice-jobs";
import { assessmentPage } from "@/features/coach/api";
import { kommunCase } from "@/features/kommun/api";
import { activityAdd, caseChangeStart, caseHistory, caseNoteRemove, caseNoteSave, caseStartView, caseTimeline } from "./api";

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
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const change = (input: ParamsOf<typeof caseChangeStart>, actor: Actor) => rt.run("command", caseChangeStart.key, input, actor) as Promise<ResultOf<typeof caseChangeStart>>;

/** Startade 1 februari (demoklockans dag), inga registrerade tillfällen än – handläggare Maria, huvudcoach Sofia. */
const NEW = "case-270041";
/** Startade 26 januari (testdatats ändring från 1 februari), närvaro registrerad 26–28 januari – huvudcoach Amira. */
const JAN = "case-270031";
/** Startade 1 december – december är fakturerad (skickad) i testdatat. */
const DEC = "case-260126";
const amira = () => as("u-amira", "coach");
const sara = () => as("u-sara", "samordnare");
const johan = () => as("u-johan", "avtalsansvarig");
const karin = () => as("u-karin", "chef");
const robin = () => as("u-robin", "admin");
const lars = () => as("u-lars", "ekonom");
const maria = () => as("k-maria", "kommun_handlaggare");
const WHY = "Deltagaren kunde inte komma första veckan och började på onsdagen i stället.";
const raw = () => rt.raw();
const acts = (caseId: string) => raw().all("activities").filter((a) => a.caseId === caseId);
const startCases = () => raw().all("case_start_changes");
/** Ärendets närvaro blir automatisk (som om jobbet auto_attendance registrerat den). */
const makeAuto = (caseId: string) => {
  for (const a of raw().all("attendance").filter((x) => x.caseId === caseId)) rt.store.updateRow("attendance", a.id, { source: "auto", registeredBy: "system" });
};

describe("Ändra startdatum (arenden.andraStartdatum)", () => {
  it("framåt: anteckning, ändring, nytt startdatum, tillfällen före det nya datumet borttagna och revisionslogg utan motivering", async () => {
    const before = raw().get("cases", NEW)!;
    expect(before).toMatchObject({ startDate: "2027-02-01", plannedEnd: "2027-04-09" });
    const firstDay = acts(NEW).filter((a) => a.startsAt < "2027-02-03");
    expect(firstDay.map((a) => a.startsAt)).toEqual(["2027-02-01T13:00"]);
    const sent = [raw().all("outbound_messages").length, raw().all("user_notifications").length];
    // En coach i avtalet som inte är huvudcoach (alla coacher arbetar i alla ärenden, beslut 2026-10-09).
    const res = await change({ caseId: NEW, startDate: "2027-02-03", expectedStartDate: "2027-02-01", motivation: `  ${WHY}  ` }, amira());
    expect(res).toMatchObject({ ok: true, startDate: "2027-02-03", removed: 1, autoAttendanceRemoved: 0 });
    if (!res.ok) return;
    const c = raw().get("cases", NEW)!;
    // Planerat slut, planerade veckor och beställningens veckor ändras inte (de räknas från första mötet).
    expect(c).toMatchObject({ startDate: "2027-02-03", plannedEnd: before.plannedEnd, plannedWeeks: before.plannedWeeks, orderValueWeeks: before.orderValueWeeks, status: "active" });
    expect(acts(NEW).some((a) => a.startsAt < "2027-02-03")).toBe(false);
    expect(acts(NEW).map((a) => a.startsAt)).toContain("2027-02-03T09:00");
    const note = raw().get("case_notes", res.noteId)!;
    expect(note).toMatchObject({ caseId: NEW, authorId: "u-amira", kind: "other", audience: "team", body: `Ändrat startdatum: 1 feb 2027 → 3 feb 2027. ${WHY}` });
    expect(raw().get("case_start_changes", res.changeId)).toMatchObject({
      contractId: "c-bot", caseId: NEW, fromDate: "2027-02-01", toDate: "2027-02-03", changedBy: "u-amira", noteId: res.noteId, seq: 1,
    });
    const log = raw().all("audit_log").filter((l) => l.action === "case.start_date_changed");
    expect(log).toHaveLength(1);
    expect(log[0].details).toEqual({
      caseId: NEW, changeId: res.changeId, noteId: res.noteId, seq: 1, from: "2027-02-01", to: "2027-02-03", removedActivityIds: firstDay.map((a) => a.id), removedAutoAttendanceIds: [],
    });
    // Revisionsloggen har aldrig motiveringen.
    expect(JSON.stringify(raw().all("audit_log"))).not.toContain("kunde inte komma");
    // Kommunen får inget meddelande: inget utskick och ingen notis alls.
    expect([raw().all("outbound_messages").length, raw().all("user_notifications").length]).toEqual(sent);
  });

  it("samordnare och avtalsansvarig får ändra – chef, admin, ekonom och kommunen nekas av rollkontrollen", async () => {
    expect(await change({ caseId: NEW, startDate: "2027-02-03", expectedStartDate: "2027-02-01", motivation: WHY }, sara())).toMatchObject({ ok: true });
    expect(await change({ caseId: NEW, startDate: "2027-02-04", expectedStartDate: "2027-02-03", motivation: WHY }, johan())).toMatchObject({ ok: true });
    for (const a of [karin(), robin(), lars(), maria()]) {
      await expect(change({ caseId: NEW, startDate: "2027-02-05", expectedStartDate: "2027-02-04", motivation: WHY }, a), a.role).rejects.toBeInstanceOf(ApiError);
    }
    expect(startCases().filter((x) => x.caseId === NEW).map((x) => [x.seq, x.fromDate, x.toDate])).toEqual([[1, "2027-02-01", "2027-02-03"], [2, "2027-02-03", "2027-02-04"]]);
  });

  it("konflikt: dialogen visade ett annat startdatum än ärendet har nu – inget skrivs", async () => {
    const notes = raw().all("case_notes").length;
    expect(await change({ caseId: NEW, startDate: "2027-02-03", expectedStartDate: "2027-01-28", motivation: WHY }, sara())).toMatchObject({ ok: false, error: "conflict" });
    expect(raw().all("case_notes")).toHaveLength(notes);
    expect(startCases()).toHaveLength(1); // bara testdatats ändring
    expect(raw().get("cases", NEW)?.startDate).toBe("2027-02-01");
  });

  it("samma ändring igen (dubbelklick, svaret kom inte fram): ok, ingen andra ändring och ingen andra loggrad", async () => {
    const input = { caseId: NEW, startDate: "2027-02-03", expectedStartDate: "2027-02-01", motivation: WHY };
    const first = await change(input, sara());
    const again = await change(input, sara());
    expect(again).toMatchObject({ ok: true, startDate: "2027-02-03", removed: 1 });
    if (!first.ok || !again.ok) return;
    expect(again.changeId).toBe(first.changeId);
    expect(startCases().filter((x) => x.caseId === NEW)).toHaveLength(1);
    expect(raw().all("audit_log").filter((l) => l.action === "case.start_date_changed")).toHaveLength(1);
    // Någon annan med samma datum: konflikt (det är inte hens ändring).
    expect(await change(input, johan())).toMatchObject({ ok: false, error: "conflict" });
  });

  it("en ändring som inte blev klar (städningen avbröts) görs klar av samma ändring igen", async () => {
    // Ändringen finns (ärendet har det nya datumet) men tillfällena och loggen saknas – som efter ett avbrott.
    rt.store.insertRow("case_notes", {
      id: "note-t-avbruten", contractId: "c-bot", caseId: NEW, authorId: "u-sara", occurredOn: "2027-02-01", kind: "other", audience: "team",
      body: `Ändrat startdatum: 1 feb 2027 → 3 feb 2027. ${WHY}`, createdAt: DEMO_START, updatedAt: null, removedAt: null, removedBy: null,
    });
    rt.store.insertRow("case_start_changes", {
      id: "csc-t-avbruten", contractId: "c-bot", caseId: NEW, fromDate: "2027-02-01", toDate: "2027-02-03", changedBy: "u-sara", changedAt: DEMO_START, noteId: "note-t-avbruten", seq: 1,
    });
    rt.store.updateRow("cases", NEW, { startDate: "2027-02-03" });
    const res = await change({ caseId: NEW, startDate: "2027-02-03", expectedStartDate: "2027-02-01", motivation: WHY }, sara());
    expect(res).toMatchObject({ ok: true, changeId: "csc-t-avbruten", removed: 1 });
    expect(acts(NEW).some((a) => a.startsAt < "2027-02-03")).toBe(false);
    expect(raw().all("audit_log").filter((l) => l.action === "case.start_date_changed").map((l) => l.details.changeId)).toEqual(["csc-t-avbruten"]);
  });

  it("stoppas när en månad ändringen rör är fakturerad – december – och inget skrivs", async () => {
    const c = raw().get("cases", DEC)!;
    expect(c.startDate).toBe("2026-12-01");
    const notes = raw().all("case_notes").length;
    const res = await change({ caseId: DEC, startDate: "2026-12-08", expectedStartDate: "2026-12-01", motivation: WHY }, amira());
    expect(res).toEqual({ ok: false, error: "invoiced", message: "December 2026 är redan fakturerad. Ekonomen behöver kreditera fakturan innan startdatumet kan ändras." });
    expect(raw().get("cases", DEC)?.startDate).toBe("2026-12-01");
    expect(raw().all("case_notes")).toHaveLength(notes);
    expect(startCases()).toHaveLength(1);
  });

  it("stoppas när januari är godkänd av ekonomen – och går igen när fakturan är krediterad utan ny faktura", async () => {
    makeAuto(JAN);
    rt.store.insertRow("invoice_drafts", {
      id: "inv-c-bot-2027-01-avtal", billingRunId: "br-2027-01", contractId: "c-bot", month: "2027-01", kind: "periodic", caseId: null, groupingKey: "avtal", buyerReference: "12345678",
      purchaseOrderNumber: null, invoicedObject: "332026110", accruedOre: null, remainingOre: null, status: "approved", approvedBy: "u-lars", approvedAt: "2027-02-01T08:00",
      manualInvoiceNo: null, fortnoxDocumentNumber: null, fortnoxIdempotencyKey: null, fortnoxCreatedAt: null, syncedAt: null,
    });
    const res = await change({ caseId: JAN, startDate: "2027-02-02", expectedStartDate: "2027-01-26", motivation: WHY }, amira());
    expect(res).toMatchObject({ ok: false, error: "invoiced", message: expect.stringContaining("Fakturan för januari 2027 är redan godkänd av ekonomen.") });
    rt.store.updateRow("invoice_drafts", "inv-c-bot-2027-01-avtal", { status: "credited" });
    expect(await change({ caseId: JAN, startDate: "2027-02-02", expectedStartDate: "2027-01-26", motivation: WHY }, amira())).toMatchObject({ ok: true });
  });

  it("stoppas när tillfällen före det nya datumet har närvaro som en människa registrerat – meddelandet säger vilket datum som går", async () => {
    const res = await change({ caseId: JAN, startDate: "2027-02-02", expectedStartDate: "2027-01-26", motivation: WHY }, amira());
    expect(res).toEqual({
      ok: false, error: "attendance",
      message: "3 tillfällen före det nya startdatumet har registrerad närvaro. Ett tillfälle med registrerad närvaro tas aldrig bort, så startdatumet kan vara senast 26 jan 2027.",
    });
    expect(raw().get("cases", JAN)?.startDate).toBe("2027-01-26");
    expect(acts(JAN).filter((a) => a.startsAt < "2027-02-02")).toHaveLength(3);
  });

  it("tillfällen med bara automatisk närvaro tas bort med närvaron – loggen har id:n", async () => {
    makeAuto(JAN);
    const before = acts(JAN).filter((a) => a.startsAt < "2027-02-02");
    const auto = raw().all("attendance").filter((x) => before.some((a) => a.id === x.activityId));
    expect(before).toHaveLength(3);
    expect(auto).toHaveLength(3);
    const res = await change({ caseId: JAN, startDate: "2027-02-02", expectedStartDate: "2027-01-26", motivation: WHY }, amira());
    expect(res).toMatchObject({ ok: true, removed: 3, autoAttendanceRemoved: 3 });
    expect(acts(JAN).filter((a) => a.startsAt < "2027-02-02")).toEqual([]);
    for (const x of auto) expect(raw().get("attendance", x.id)).toBeUndefined();
    const log = raw().all("audit_log").find((l) => l.action === "case.start_date_changed")!;
    expect(log.details).toMatchObject({ removedActivityIds: before.map((a) => a.id).sort(), removedAutoAttendanceIds: expect.arrayContaining(auto.map((x) => x.id)) });
  });

  it("rader i gruppaktiviteter före det nya datumet: målgruppens kommande rad tar synkningen bort, en rad inbjuden för hand loggas på aktiviteten", async () => {
    // BOT-27-0038 är inbjuden av målgruppen (yrkesområdet) till en träff 24 februari.
    const id = "case-270038";
    const group = acts(id).find((a) => a.groupActivityId)!;
    expect(group).toMatchObject({ inviteSource: "audience" });
    expect(group.startsAt.slice(0, 10)).toBe("2027-02-24");
    const res = await change({ caseId: id, startDate: "2027-02-25", expectedStartDate: "2027-02-01", motivation: WHY }, sara());
    expect(res).toMatchObject({ ok: true, groups: { removed: 1 } });
    expect(raw().get("activities", group.id)).toBeUndefined();
    const synced = raw().all("audit_log").filter((l) => l.action === "group_activity.audience_synced" && l.entityId === group.groupActivityId);
    expect(synced.map((l) => l.details.removedCaseIds)).toEqual([[id]]);
    expect(raw().all("audit_log").find((l) => l.action === "case.start_date_changed")?.details.removedActivityIds).not.toContain(group.id);

    // Samma rad inbjuden för hand: tas bort av ändringen och loggas på aktiviteten (som Ta bort i aktivitetsvyn).
    rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
    rt.store.updateRow("activities", group.id, { inviteSource: "manual" });
    expect(await change({ caseId: id, startDate: "2027-02-25", expectedStartDate: "2027-02-01", motivation: WHY }, sara())).toMatchObject({ ok: true });
    expect(raw().get("activities", group.id)).toBeUndefined();
    const logs = raw().all("audit_log").filter((l) => l.action === "group_activity.removed_participant" && l.entityId === group.groupActivityId);
    expect(logs.map((l) => l.details)).toEqual([{ caseIds: [id], activityIds: [group.id], via: "start_date_changed" }]);
    expect(raw().all("audit_log").find((l) => l.action === "case.start_date_changed")?.details.removedActivityIds).toContain(group.id);
  });

  it("bakåt: inga tillfällen skapas; coachen lägger till det som hände – och januari faktureras nu för ärendet", async () => {
    // Första mötet hölls 25 januari men insatsen registrerades med start 1 februari.
    rt.store.updateRow("cases", NEW, { firstMeetingAt: "2027-01-25T13:00" });
    const count = acts(NEW).length;
    const cfg = requireOperational(raw().get("contracts", "c-bot")!.config);
    const linesFor = (month: string) => billingLines({ ...Object.fromEntries(["activities", "attendance", "price_items", "case_area_changes", "billing_week_approvals"].map((n) => [n, [...raw().all(n as never)]])), cases: raw().all("cases").filter((c) => c.id === NEW) } as never, month, { now: rt.clock.now(), cfg })
      .filter((l) => l.caseId === NEW);
    expect(linesFor("2027-01")).toEqual([]);
    const res = await change({ caseId: NEW, startDate: "2027-01-27", expectedStartDate: "2027-02-01", motivation: WHY }, amira());
    expect(res).toMatchObject({ ok: true, removed: 0, startDate: "2027-01-27" });
    expect(acts(NEW)).toHaveLength(count);
    // Januari (underlag, inte fakturerad) räknas om: vecka 4 (torsdag 28 januari) är nu debiterbar för ärendet.
    expect(linesFor("2027-01").map((l) => l.weeks.map((w) => w.key))).toEqual([["2027-W04"]]);
    // Tillfället som hände läggs till för hand – före startdatumet går det inte.
    expect(await rt.run("command", activityAdd.key, { caseId: NEW, kind: "möte", startsAt: "2027-01-27T13:00", durationMin: 60, location: "Miljonbemanning" }, amira())).toMatchObject({ ok: true });
    expect(await rt.run("command", activityAdd.key, { caseId: NEW, kind: "möte", startsAt: "2027-01-26T13:00", durationMin: 60, location: "Miljonbemanning" }, amira())).toMatchObject({ ok: false, error: "date" });
  });

  it("framåt i ett underlag: januari räknas om utan ärendets vecka 4, februari har kvar sina veckor", async () => {
    makeAuto(JAN);
    const cfg = requireOperational(raw().get("contracts", "c-bot")!.config);
    const linesFor = (month: string) => billingLines({ ...Object.fromEntries(["activities", "attendance", "price_items", "case_area_changes", "billing_week_approvals"].map((n) => [n, [...raw().all(n as never)]])), cases: raw().all("cases").filter((c) => c.id === JAN) } as never, month, { now: rt.clock.now(), cfg })
      .filter((l) => l.caseId === JAN);
    expect(linesFor("2027-01").map((l) => l.weeks.map((w) => w.key))).toEqual([["2027-W04"]]);
    expect(await change({ caseId: JAN, startDate: "2027-02-02", expectedStartDate: "2027-01-26", motivation: WHY }, amira())).toMatchObject({ ok: true });
    expect(linesFor("2027-01")).toEqual([]);
    // Det nya startdatumet ligger i morgon: ingen vecka är debiterbar än. En vecka senare räknas februari från vecka 5.
    expect(linesFor("2027-02")).toEqual([]);
    rt.clock.set("2027-02-08T09:00");
    expect(linesFor("2027-02").map((l) => l.weeks.map((w) => w.key))).toEqual([["2027-W05", "2027-W06"]]);
  });

  it("nekas: avslutat ärende, samma datum, före första mötet, efter planerat slut, för kort motivering och personnummer", async () => {
    const closed = raw().all("cases").find((c) => c.status === "closed" && c.contractId === "c-bot" && c.startDate)!;
    const cases: [ParamsOf<typeof caseChangeStart>, string][] = [
      [{ caseId: closed.id, startDate: "2026-12-08", expectedStartDate: closed.startDate!, motivation: WHY }, "wrong_status"],
      [{ caseId: NEW, startDate: "2027-02-01", expectedStartDate: "2027-02-01", motivation: WHY }, "same"],
      [{ caseId: NEW, startDate: "2027-01-29", expectedStartDate: "2027-02-01", motivation: WHY }, "before_meeting"],
      [{ caseId: NEW, startDate: "2027-04-10", expectedStartDate: "2027-02-01", motivation: WHY }, "after_end"],
      [{ caseId: NEW, startDate: "2027-02-03", expectedStartDate: "2027-02-01", motivation: "  kort  " }, "motivation"],
      [{ caseId: NEW, startDate: "2027-02-03", expectedStartDate: "2027-02-01", motivation: "Enligt kommunen gäller 19730216-9545 numera." }, "pnr"],
      [{ caseId: "case-finns-inte", startDate: "2027-02-03", expectedStartDate: "2027-02-01", motivation: WHY }, "not_found"],
    ];
    const notes = raw().all("case_notes").length;
    for (const [input, code] of cases) expect(await change(input, sara()), code).toMatchObject({ ok: false, error: code });
    expect(raw().all("case_notes")).toHaveLength(notes);
    expect(startCases()).toHaveLength(1);
    expect(raw().get("cases", NEW)?.startDate).toBe("2027-02-01");
  });

  it("en pausad insats kan ändras", async () => {
    rt.store.updateRow("cases", NEW, { status: "paused" });
    expect(await change({ caseId: NEW, startDate: "2027-02-03", expectedStartDate: "2027-02-01", motivation: WHY }, sara())).toMatchObject({ ok: true });
    expect(raw().get("cases", NEW)).toMatchObject({ status: "paused", startDate: "2027-02-03" });
  });

  it("motiveringen är låst: den ändras och tas aldrig bort, och historiken visar den – revisionsloggens rad har datumen", async () => {
    const res = await change({ caseId: NEW, startDate: "2027-02-03", expectedStartDate: "2027-02-01", motivation: WHY }, sara());
    if (!res.ok) throw new Error(res.message);
    const note = raw().get("case_notes", res.noteId)!;
    const edit = { caseId: NEW, noteId: res.noteId, occurredOn: note.occurredOn, kind: note.kind, audience: note.audience, body: "Ändrad motivering." };
    expect(await rt.run("command", caseNoteSave.key, edit, sara())).toMatchObject({
      ok: false, error: "locked", message: "Anteckningen är motiveringen till ett ändrat startdatum och kan inte ändras eller tas bort.",
    });
    for (const a of [sara(), johan(), amira()]) expect(await rt.run("command", caseNoteRemove.key, { caseId: NEW, noteId: res.noteId }, a), a.role).toMatchObject({ ok: false, error: "locked" });
    expect(raw().get("case_notes", res.noteId)).toMatchObject({ body: note.body, removedAt: null });
    // Tidslinjen visar anteckningen utan knappar.
    const page = (await q(caseTimeline, { caseId: NEW, visa: "anteckningar" }, sara()))!;
    const entry = page.months.flatMap((m) => m.entries).find((e) => e.note?.id === res.noteId);
    expect(entry?.note).toMatchObject({ canEdit: false, canRemove: false });
    // Historiken (chef): raden med datumen och antalet borttagna tillfällen.
    const h = (await q(caseHistory, { caseId: NEW }, karin()))!;
    expect(h.log.find((l) => l.text === "Startdatumet ändrades")?.sub).toBe("1 feb 2027 → 3 feb 2027, 1 tillfälle före det nya datumet togs bort");
  });

  it("motiveringen skickas aldrig till AI och står inte bland månadens anteckningar i månadsbedömningen", async () => {
    rt.store.updateRow("cases", JAN, { aiConsentStatus: "given" });
    rt.store.insertRow("case_notes", {
      id: "note-t-vanlig", contractId: "c-bot", caseId: JAN, authorId: "u-amira", occurredOn: "2027-01-28", kind: "conversation", audience: "full",
      body: "Pratade om CV.", createdAt: "2027-01-28T11:00", updatedAt: null, removedAt: null, removedBy: null,
    });
    // Testdatats motivering (28 januari) för BOT-27-0031.
    expect(raw().get("case_notes", "note-startdatum-0031")?.occurredOn).toBe("2027-01-28");
    const input = await monthlyDraftInput(rt.ctxFor(SYSTEM_ACTOR), JAN, "2027-01");
    expect(input.notes.map((n) => n.id)).toContain("note-t-vanlig");
    expect(input.notes.map((n) => n.id)).not.toContain("note-startdatum-0031");
    expect(JSON.stringify(input)).not.toContain("registrerat en vecka för sent");
    const page = await q(assessmentPage, { caseId: JAN, month: "2027-01" }, amira());
    expect(JSON.stringify(page)).not.toContain("registrerat en vecka för sent");
    expect(JSON.stringify(page)).toContain("Pratade om CV.");
  });
});

describe("Startdatumet på deltagarkortet (arenden.startdatum)", () => {
  it("testdatats ändring med motiveringen, nyast först – och gränserna för ett nytt datum", async () => {
    const v = (await q(caseStartView, { caseId: JAN }, amira()))!;
    expect(v).toEqual({
      caseId: JAN, startDate: "2027-01-26", canChange: true, blockedText: null, earliest: "2027-01-26", latest: "2027-04-02",
      history: [{
        id: "csc-seed-0031", changedAt: "2027-01-28T10:05", fromDate: "2027-02-01", toDate: "2027-01-26", byName: "Amira Haddad",
        motivation: "Deltagaren började redan vid första mötet den 26 januari. Startdatumet var registrerat en vecka för sent.",
      }],
    });
    await change({ caseId: NEW, startDate: "2027-02-03", expectedStartDate: "2027-02-01", motivation: WHY }, sara());
    await change({ caseId: NEW, startDate: "2027-02-04", expectedStartDate: "2027-02-03", motivation: WHY }, sara());
    const n = (await q(caseStartView, { caseId: NEW }, sara()))!;
    expect(n.history.map((h) => [h.fromDate, h.toDate, h.byName, h.motivation])).toEqual([
      ["2027-02-03", "2027-02-04", "Sara Lindqvist", WHY], ["2027-02-01", "2027-02-03", "Sara Lindqvist", WHY],
    ]);
  });

  it("chef och systemadministratör ser ändringarna i läsläge; kommunen och ekonomen får inget", async () => {
    for (const a of [karin(), robin()]) expect(await q(caseStartView, { caseId: JAN }, a), a.role).toMatchObject({ canChange: false, blockedText: null, history: [{ id: "csc-seed-0031" }] });
    await expect(q(caseStartView, { caseId: JAN }, lars())).rejects.toBeInstanceOf(ApiError);
    await expect(q(caseStartView, { caseId: JAN }, maria())).rejects.toBeInstanceOf(ApiError);
  });

  it("avslutat och inte startat ärende: kan inte ändras och raden säger varför", async () => {
    const closed = raw().all("cases").find((c) => c.status === "closed" && c.contractId === "c-bot")!;
    expect(await q(caseStartView, { caseId: closed.id }, amira())).toMatchObject({ canChange: false, blockedText: "Insatsen är avslutad. Startdatumet kan inte ändras." });
    const confirmed = raw().all("cases").find((c) => c.status === "confirmed" && c.contractId === "c-bot")!;
    expect(await q(caseStartView, { caseId: confirmed.id }, sara())).toMatchObject({ canChange: false, blockedText: "Insatsen har inte startat än. Startdatumet väljs när insatsen startas." });
  });

  it("kommunen ser det nya startdatumet i portalen – aldrig motiveringen eller ändringen", async () => {
    expect(raw().get("cases", NEW)?.referrerId).toBe("k-maria");
    const before = await q(kommunCase, { caseId: NEW }, maria());
    expect(before).toMatchObject({ case: { startDate: "2027-02-01" } });
    await change({ caseId: NEW, startDate: "2027-02-03", expectedStartDate: "2027-02-01", motivation: WHY }, sara());
    const after = await q(kommunCase, { caseId: NEW }, maria());
    expect(after).toMatchObject({ case: { startDate: "2027-02-03" } });
    const text = JSON.stringify(after);
    expect(text).not.toContain("kunde inte komma");
    expect(text).not.toContain("Ändrat startdatum");
    // Kommunen läser aldrig ändringarna eller anteckningarna (RLS-spegeln i minnet).
    const repo = rt.ctxFor(maria()).repo;
    expect(await repo.table("case_start_changes").list({})).toEqual([]);
    expect(await repo.table("case_notes").list({ caseId: NEW })).toEqual([]);
  });
});
