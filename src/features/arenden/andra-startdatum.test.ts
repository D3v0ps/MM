// Ändra startdatum (Karims beslut 2026-10-29): kommandot arenden.andraStartdatum och raden på deltagarkortet mot testdatat i
// minnet (MemoryRuntime, samma hanterare som appen). Ordningen: anteckningen, ändringen (som ändrar ärendets startdatum i samma
// steg – triggern case_start_changes_apply), tillfällena före det nya datumet, revisionsloggen och inbjudningarna.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { SYSTEM_ACTOR } from "@/api/roles";
import { ApiError } from "@/api/server";
import { billingLines } from "@/core/billing";
import { requireOperational } from "@/core/config";
import { listPersonas } from "@/data/actors";
import { MemoryStore, type MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import { aiRunRow } from "@/features/_shared/ai-port";
import { loadPrefill } from "@/features/_shared/monthly-prefill";
import { monthlyDraftInput, runVoiceJob } from "@/features/_shared/voice-jobs";
import { assessmentPage, assessmentSave } from "@/features/coach/api";
import { inboxList, inboxStart } from "@/features/inkorg/api";
import { initialPick } from "@/features/inkorg/screens/inkorg";
import { kommunCase } from "@/features/kommun/api";
import { activityAdd, caseCard, caseChangeStart, caseHistory, caseNoteRemove, caseNoteSave, caseStart, caseStartView, caseTimeline } from "./api";
import { startChangedText } from "./screens/kort-startdatum";
import { finishStartChanges } from "./start-finish";

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
/** Revisionsloggens rader för ändringar av startdatum – utom testdatats (BOT-27-0031, csc-seed-0031). */
const startLogs = () => raw().all("audit_log").filter((l) => l.action === "case.start_date_changed" && l.details.changeId !== "csc-seed-0031");
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
    const log = startLogs();
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
    expect(startLogs()).toHaveLength(1);
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
    expect(startLogs().map((l) => l.details.changeId)).toEqual(["csc-t-avbruten"]);
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
    const log = startLogs()[0];
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
    expect(startLogs()[0]?.details.removedActivityIds).not.toContain(group.id);

    // Samma rad inbjuden för hand: tas bort av ändringen och loggas på aktiviteten (som Ta bort i aktivitetsvyn).
    rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
    rt.store.updateRow("activities", group.id, { inviteSource: "manual" });
    expect(await change({ caseId: id, startDate: "2027-02-25", expectedStartDate: "2027-02-01", motivation: WHY }, sara())).toMatchObject({ ok: true });
    expect(raw().get("activities", group.id)).toBeUndefined();
    const logs = raw().all("audit_log").filter((l) => l.action === "group_activity.removed_participant" && l.entityId === group.groupActivityId);
    expect(logs.map((l) => l.details)).toEqual([{ caseIds: [id], activityIds: [group.id], via: "start_date_changed" }]);
    expect(startLogs()[0]?.details.removedActivityIds).toContain(group.id);
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
      caseId: JAN, startDate: "2027-01-26", canChange: true, earliest: "2027-01-26", latest: "2027-04-02",
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

  it("kortet säger om knappen visas och om det finns ändringar – raden med ändringarna hämtas bara då", async () => {
    const card = async (caseId: string, a: Actor) => {
      const r = await q(caseCard, { caseId }, a);
      return r.kind === "ok" ? r.startChange : null;
    };
    expect(await card(NEW, sara())).toEqual({ canChange: true, changes: 0 });
    expect(await card(JAN, amira())).toEqual({ canChange: true, changes: 1 });
    expect(await card(JAN, karin())).toEqual({ canChange: false, changes: 1 });
    const closed = raw().all("cases").find((c) => c.status === "closed" && c.contractId === "c-bot" && c.startDate)!;
    expect(await card(closed.id, sara())).toMatchObject({ canChange: false });
    await change({ caseId: NEW, startDate: "2027-02-03", expectedStartDate: "2027-02-01", motivation: WHY }, sara());
    expect(await card(NEW, sara())).toEqual({ canChange: true, changes: 1 });
  });

  it("chef och systemadministratör ser ändringarna i läsläge; kommunen och ekonomen får inget", async () => {
    for (const a of [karin(), robin()]) expect(await q(caseStartView, { caseId: JAN }, a), a.role).toMatchObject({ canChange: false, history: [{ id: "csc-seed-0031" }] });
    await expect(q(caseStartView, { caseId: JAN }, lars())).rejects.toBeInstanceOf(ApiError);
    await expect(q(caseStartView, { caseId: JAN }, maria())).rejects.toBeInstanceOf(ApiError);
  });

  it("avslutat och inte startat ärende: ingen knapp – servern svarar wrong_status med orsaken", async () => {
    const closed = raw().all("cases").find((c) => c.status === "closed" && c.contractId === "c-bot" && c.startDate)!;
    expect(await q(caseStartView, { caseId: closed.id }, amira())).toMatchObject({ canChange: false });
    expect(await change({ caseId: closed.id, startDate: "2026-12-08", expectedStartDate: closed.startDate!, motivation: WHY }, amira())).toEqual({
      ok: false, error: "wrong_status", message: "Insatsen är avslutad. Startdatumet kan inte ändras.",
    });
    const confirmed = raw().all("cases").find((c) => c.status === "confirmed" && c.contractId === "c-bot")!;
    expect(await q(caseStartView, { caseId: confirmed.id }, sara())).toMatchObject({ canChange: false });
    expect(await change({ caseId: confirmed.id, startDate: "2027-02-05", expectedStartDate: "2027-02-04", motivation: WHY }, sara())).toMatchObject({
      ok: false, error: "wrong_status", message: "Insatsen har inte startat än. Startdatumet väljs när insatsen startas.",
    });
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

describe("granskningen 2026-10-29: rapporter, mötesrapporter, avbrott, två flikar och Starta insatsen", () => {
  /** BOT-27-0002 startade 7 januari (handläggare Linda, huvudcoach Leila): fyra godkända mötesrapporter och januarirapporten som utkast. */
  const JAN7 = "case-270002";
  /** BOT-27-0011 startade 18 januari (handläggare Maria): godkända mötesrapporter 18 och 25 januari, januarirapporten som utkast. */
  const JAN18 = "case-270011";
  const leila = () => as("u-leila", "coach");
  /** Mötesrapporterna blir utkast (som om de inte var godkända än). */
  const draftCheckIns = (caseId: string) => {
    for (const x of raw().all("check_ins").filter((k) => k.caseId === caseId)) rt.store.updateRow("check_ins", x.id, { status: "draft", approvedBy: null, approvedAt: null });
  };
  const monthlyOf = (caseId: string) => raw().all("reports").filter((r) => r.caseId === caseId && r.kind === "monthly" && r.month === "2027-01");
  const assessmentOf = (caseId: string) => raw().all("monthly_assessments").filter((m) => m.caseId === caseId && m.month === "2027-01");
  const planOf = (caseId: string) => raw().all("monthly_plans").filter((m) => m.caseId === caseId && m.month === "2027-01");
  const tasksOf = (caseId: string) => raw().all("tasks").filter((t) => t.kind === "report_correction" && t.caseIds.includes(caseId));

  it("godkända mötesrapporter före det nya datumet stoppar en senare start – meddelandet säger senaste datum och inget ändras", async () => {
    makeAuto(JAN7);
    const res = await change({ caseId: JAN7, startDate: "2027-02-01", expectedStartDate: "2027-01-07", motivation: WHY }, leila());
    expect(res).toEqual({
      ok: false, error: "attendance",
      message: "4 mötesrapporter före det nya startdatumet är godkända. En godkänd mötesrapport tas aldrig bort, så startdatumet kan vara senast 7 jan 2027.",
    });
    expect(raw().get("cases", JAN7)?.startDate).toBe("2027-01-07");
    expect(acts(JAN7).filter((a) => a.startsAt < "2027-02-01")).toHaveLength(11);
  });

  it("en månad som blir utan månadsrapport: systemets utkast till rapport och bedömning tas bort och loggas – planen för februari ligger kvar", async () => {
    makeAuto(JAN7);
    draftCheckIns(JAN7);
    const [rep] = monthlyOf(JAN7);
    const [ma] = assessmentOf(JAN7);
    const [mp] = planOf(JAN7);
    expect([rep.status, ma.status, mp.status]).toEqual(["draft", "draft", "draft"]);
    const res = await change({ caseId: JAN7, startDate: "2027-02-01", expectedStartDate: "2027-01-07", motivation: WHY }, leila());
    expect(res).toMatchObject({ ok: true, removed: 11, autoAttendanceRemoved: 11, droppedMonths: ["2027-01"], draftMonths: ["2027-01"], incomplete: false });
    // Januaris plan är planen för februari, där deltagaren är inskriven – den ligger kvar som underlag till februaris bedömning.
    expect([monthlyOf(JAN7), assessmentOf(JAN7), planOf(JAN7).map((x) => x.id)]).toEqual([[], [], [mp.id]]);
    expect(startLogs()[0].details).toMatchObject({ droppedMonths: ["2027-01"], draftMonths: ["2027-01"], removedReportIds: [rep.id], removedAssessmentIds: [ma.id], removedPlanIds: [] });
    // Lindas veckorapporter för vecka 1–4 och januarirapporten var inte lämnade som rättelser – vecka 1–3 är lämnade: en uppgift.
    expect(res.ok && res.corrections).toBe(3);
  });

  it("en lämnad eller godkänd januarirapport, eller en godkänd bedömning, stoppar – meddelandet säger vilket datum som behåller rapporten", async () => {
    makeAuto(JAN7);
    draftCheckIns(JAN7);
    const [rep] = monthlyOf(JAN7);
    rt.store.updateRow("reports", rep.id, { status: "delivered", deliveredAt: "2027-02-01T08:00" });
    const later = { caseId: JAN7, startDate: "2027-02-01", expectedStartDate: "2027-01-07", motivation: WHY };
    expect(await change(later, leila())).toEqual({
      ok: false, error: "report",
      message: "Månadsrapporten för januari 2027 är redan lämnad till kommunen. Med det nya startdatumet får januari för få inskrivna dagar för en månadsrapport, så startdatumet kan vara senast 21 jan 2027.",
    });
    rt.store.updateRow("reports", rep.id, { status: "approved", deliveredAt: null });
    expect(await change(later, leila())).toMatchObject({ ok: false, error: "report", message: expect.stringMatching(/^Månadsrapporten för januari 2027 är redan godkänd\./) });
    rt.store.updateRow("reports", rep.id, { status: "draft" });
    rt.store.updateRow("monthly_assessments", assessmentOf(JAN7)[0].id, { status: "approved" });
    expect(await change(later, leila())).toMatchObject({ ok: false, error: "report", message: expect.stringMatching(/^Månadsbedömningen för januari 2027 är redan godkänd\./) });
    expect(raw().get("cases", JAN7)?.startDate).toBe("2027-01-07");
    // Det senaste datumet som behåller januari går: rapporten och bedömningen ligger kvar.
    expect(await change({ ...later, startDate: "2027-01-21" }, leila())).toMatchObject({ ok: true, droppedMonths: [] });
    expect(monthlyOf(JAN7)).toHaveLength(1);
    expect(assessmentOf(JAN7)[0].status).toBe("approved");
  });

  it("BOT-27-0011 18 → 25 januari: januari får 7 inskrivna dagar (färre än 11) – utkasten tas bort, planen för februari ligger kvar", async () => {
    makeAuto(JAN18);
    draftCheckIns(JAN18);
    expect(await change({ caseId: JAN18, startDate: "2027-01-25", expectedStartDate: "2027-01-18", motivation: WHY }, leila())).toMatchObject({ ok: true, droppedMonths: ["2027-01"] });
    expect([monthlyOf(JAN18), assessmentOf(JAN18), planOf(JAN18).length]).toEqual([[], [], 1]);
  });

  it("BOT-27-0011 18 → 21 januari: januari behåller sin rapport, bedömningens närvaro räknas om och samordnaren får en uppgift att rätta vecka 3", async () => {
    makeAuto(JAN18);
    draftCheckIns(JAN18);
    // Sammanfattningen är ifylld automatiskt ur närvaron (inte AI-utkastet) – den följer de borttagna tillfällena.
    const [ma] = assessmentOf(JAN18);
    rt.store.updateRow("monthly_assessments", ma.id, { prefill: { summary: "rules" }, summary: "Gammal sammanfattning." });
    const res = await change({ caseId: JAN18, startDate: "2027-01-21", expectedStartDate: "2027-01-18", motivation: WHY }, leila());
    expect(res).toMatchObject({ ok: true, removed: 2, droppedMonths: [], corrections: 1 });
    expect(monthlyOf(JAN18)).toHaveLength(1);
    expect(raw().all("audit_log").filter((l) => l.action === "assessment.prefill_refreshed" && l.details.caseId === JAN18).map((l) => l.details.month)).toEqual(["2027-01"]);
    expect(raw().get("monthly_assessments", ma.id)?.summary).not.toBe("Gammal sammanfattning.");
    const weekly3 = raw().all("reports").find((r) => r.kind === "weekly_attendance" && r.recipientUserId === "k-maria" && r.week === "2027-W03")!;
    const [task] = tasksOf(JAN18);
    expect(task).toMatchObject({
      toRole: "samordnare", status: "open", caseIds: [JAN18],
      text: "BOT-27-0011: startdatumet är ändrat från 18 jan 2027 till 21 jan 2027. Rätta rapporten som redan är lämnad till kommunen: veckorapporten för vecka 3 2027.",
    });
    expect(startLogs()[0].details).toMatchObject({ correctionReportIds: [weekly3.id], taskId: task.id });
    // Samordnaren ser uppgiften; kommunen gör det aldrig. Uppgiften och loggen har inga namn.
    expect((await rt.ctxFor(sara()).repo.table("tasks").list({ kind: "report_correction" })).map((t) => t.id)).toEqual([task.id]);
    expect(await rt.ctxFor(maria()).repo.table("tasks").list({ kind: "report_correction" })).toEqual([]);
    const person = raw().get("persons", raw().get("cases", JAN18)!.personId)!;
    for (const text of [task.text, JSON.stringify(startLogs())]) expect(text).not.toContain(person.lastName);
  });

  it("två flikar: samma person och datum men en annan motivering – conflict och den andra motiveringen sparas inte", async () => {
    expect(await change({ caseId: NEW, startDate: "2027-02-03", expectedStartDate: "2027-02-01", motivation: WHY }, sara())).toMatchObject({ ok: true });
    const other = "Kommunen bad oss flytta starten till onsdagen.";
    expect(await change({ caseId: NEW, startDate: "2027-02-03", expectedStartDate: "2027-02-01", motivation: other }, sara())).toEqual({
      ok: false, error: "conflict",
      message: "Du har redan ändrat startdatumet till 3 feb 2027 med en annan motivering. Ladda om sidan – motiveringen som sparades står under startdatumet.",
    });
    // Utan kontroll av motiveringen skulle ett personnummer ha gett ok.
    expect(await change({ caseId: NEW, startDate: "2027-02-03", expectedStartDate: "2027-02-01", motivation: "19730216-9545" }, sara())).toMatchObject({ ok: false, error: "conflict" });
    expect(raw().all("case_notes").some((n) => n.body.includes("Kommunen bad oss") || n.body.includes("19730216"))).toBe(false);
    expect(startCases().filter((x) => x.caseId === NEW)).toHaveLength(1);
  });

  /** Ett databasfel när det andra tillfället före det nya datumet tas bort (som granskningens prov). */
  const breakSecondRemoval = () => {
    const before = acts(JAN).filter((a) => a.startsAt < "2027-02-02").sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
    const att = before.map((a) => raw().all("attendance").find((t) => t.activityId === a.id)!);
    const orig = MemoryStore.prototype.removeRow;
    const spy = vi.spyOn(MemoryStore.prototype, "removeRow").mockImplementation(function (this: MemoryStore<Tables>, name, id) {
      if (name === "activities" && id === before[1].id) throw Object.assign(new Error("anslutningen bröts"), { code: "08006" });
      return orig.call(this, name, id);
    });
    return { before, att, restore: () => spy.mockRestore() };
  };

  it("städningen avbryts: det som hann göras loggas (failed), svaret är ok med incomplete – nästa ändring i ärendet gör klart", async () => {
    makeAuto(JAN);
    const { before, att, restore } = breakSecondRemoval();
    const res = await change({ caseId: JAN, startDate: "2027-02-02", expectedStartDate: "2027-01-26", motivation: WHY }, amira());
    restore();
    expect(res).toMatchObject({ ok: true, startDate: "2027-02-02", removed: 1, autoAttendanceRemoved: 2, incomplete: true });
    expect(raw().get("cases", JAN)?.startDate).toBe("2027-02-02");
    const [failed] = startLogs();
    expect(failed.details).toMatchObject({ removedActivityIds: [before[0].id], removedAutoAttendanceIds: [att[0].id, att[1].id], failed: true, error: "08006" });
    // En kollega gör en ny ändring senare: först görs Amiras ändring klar (loggas på den, av Johan), sedan Johans.
    rt.clock.set("2027-02-01T12:00");
    const next = await change({ caseId: JAN, startDate: "2027-02-03", expectedStartDate: "2027-02-02", motivation: WHY }, johan());
    expect(next).toMatchObject({ ok: true, incomplete: false });
    const logs = startLogs();
    expect(logs.map((l) => [l.details.changeId, l.details.failed ?? false, l.details.finishedBy ?? null])).toEqual([
      [failed.details.changeId, true, null], [failed.details.changeId, false, "u-johan"], [next.ok && next.changeId, false, null],
    ]);
    // Alla borttagna tillfällen och närvarorader står i loggen för Amiras ändring.
    const amiras = logs.filter((l) => l.details.changeId === failed.details.changeId);
    expect(amiras.flatMap((l) => l.details.removedActivityIds as string[]).sort()).toEqual(before.map((a) => a.id).sort());
    expect(amiras.flatMap((l) => l.details.removedAutoAttendanceIds as string[]).sort()).toEqual(att.map((x) => x.id).sort());
    expect(acts(JAN).filter((a) => a.startsAt < "2027-02-03")).toEqual([]);
    // Historiken på kortet: avbrottet och att ändringen gjordes klar.
    const subs = (await q(caseHistory, { caseId: JAN }, karin()))!.log.filter((l) => l.text === "Startdatumet ändrades").map((l) => l.sub);
    expect(subs).toEqual(expect.arrayContaining([
      "26 jan 2027 → 2 feb 2027, avbröts – görs klart automatiskt",
      "Gjordes klar: 26 jan 2027 → 2 feb 2027, 2 tillfällen före det nya datumet togs bort",
    ]));
  });

  it("samma ändring igen efter ett avbrott gör klart och svarar med allt som gjordes", async () => {
    makeAuto(JAN);
    const { restore } = breakSecondRemoval();
    const input = { caseId: JAN, startDate: "2027-02-02", expectedStartDate: "2027-01-26", motivation: WHY };
    expect(await change(input, amira())).toMatchObject({ ok: true, incomplete: true });
    restore();
    expect(await change(input, amira())).toMatchObject({ ok: true, removed: 3, autoAttendanceRemoved: 3, incomplete: false });
    expect(startLogs()).toHaveLength(2);
  });

  it("rapportjobbet gör klart en ändring som inte blev klar – först efter tio minuter, och bara en gång", async () => {
    makeAuto(JAN);
    const { before, restore } = breakSecondRemoval();
    expect(await change({ caseId: JAN, startDate: "2027-02-02", expectedStartDate: "2027-01-26", motivation: WHY }, amira())).toMatchObject({ ok: true, incomplete: true });
    restore();
    const sys = () => rt.ctxFor(SYSTEM_ACTOR);
    expect(await finishStartChanges(sys(), { floor: null })).toBe(0);
    rt.clock.set("2027-02-01T09:30");
    expect(await finishStartChanges(sys(), { floor: null })).toBe(1);
    // Det andra tillfället (där felet kom) och det tredje (som aldrig hann tas bort) – loggade på Amiras ändring, av systemet.
    expect(startLogs().at(-1)?.details).toMatchObject({ removedActivityIds: [before[1].id, before[2].id], finishedBy: "system" });
    expect(acts(JAN).filter((a) => a.startsAt < "2027-02-02")).toEqual([]);
    expect(await finishStartChanges(sys(), { floor: null })).toBe(0);
    // Testdatats ändring är loggad och rörs inte.
    expect(raw().all("audit_log").filter((l) => l.details.changeId === "csc-seed-0031")).toHaveLength(1);
  });
});

describe("Starta insatsen i ett bekräftat ärende som redan har ett startdatum (granskningen 2026-10-29)", () => {
  const plan = [{ weekday: 1, kind: "möte" as const, time: "14:00", durationMin: 60, location: "Alby" }];
  it("BOT-27-0042 (startdatum 2 februari från beställningen) startas med 3 februari", async () => {
    expect(raw().get("cases", "case-270042")).toMatchObject({ status: "confirmed", startDate: "2027-02-02" });
    const res = await rt.run("command", caseStart.key, { caseId: "case-270042", startDate: "2027-02-03", plan }, sara());
    expect(res).toMatchObject({ ok: true });
    expect(raw().get("cases", "case-270042")).toMatchObject({ status: "active", startDate: "2027-02-03" });
  });

  it("kan ärendet inte startas tas tillfällena som hann skrivas bort igen – inga dubbletter vid nästa försök", async () => {
    const count = acts("case-270042").length;
    const orig = MemoryStore.prototype.updateRow;
    const spy = vi.spyOn(MemoryStore.prototype, "updateRow").mockImplementation(function (this: MemoryStore<Tables>, name, id, patch) {
      if (name === "cases" && id === "case-270042") throw Object.assign(new Error("anslutningen bröts"), { code: "08006" });
      return orig.call(this, name, id, patch);
    });
    await expect(rt.run("command", caseStart.key, { caseId: "case-270042", startDate: "2027-02-03", plan }, sara())).rejects.toThrow();
    spy.mockRestore();
    expect(acts("case-270042")).toHaveLength(count);
    expect(await rt.run("command", caseStart.key, { caseId: "case-270042", startDate: "2027-02-03", plan }, sara())).toMatchObject({ ok: true });
    const mondays = acts("case-270042").filter((a) => a.startsAt.endsWith("T14:00")).map((a) => a.startsAt);
    expect(new Set(mondays).size).toBe(mondays.length);
  });
});

describe("granskningen runda 2 (2026-10-29): fakturaunderlaget, coachens utkast, flikar, AI-utkastet, rättelseuppgiften och meddelandet", () => {
  /** BOT-27-0002 startade 7 januari (handläggare Linda, huvudcoach Leila): januaribedömningen och januarirapporten som utkast. */
  const JAN7 = "case-270002";
  const leila = () => as("u-leila", "coach");
  const draftCheckIns = (caseId: string) => {
    for (const x of raw().all("check_ins").filter((k) => k.caseId === caseId)) rt.store.updateRow("check_ins", x.id, { status: "draft", approvedBy: null, approvedAt: null });
  };
  const janAssessments = () => raw().all("monthly_assessments").filter((m) => m.caseId === JAN7 && m.month === "2027-01");
  const janPlans = () => raw().all("monthly_plans").filter((m) => m.caseId === JAN7 && m.month === "2027-01");
  const later = { caseId: JAN7, startDate: "2027-02-01", expectedStartDate: "2027-01-07", motivation: WHY };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cmd = (key: string, input: any, actor: Actor) => rt.run("command", key, input, actor) as Promise<any>;

  it("tidigare start: veckorna utan tillfällen kräver ekonomens godkännande (Ingen närvaro) i fakturaunderlaget", async () => {
    rt.store.updateRow("cases", NEW, { firstMeetingAt: "2027-01-11T13:00" });
    expect(await change({ caseId: NEW, startDate: "2027-01-11", expectedStartDate: "2027-02-01", motivation: WHY }, amira())).toMatchObject({ ok: true, removed: 0 });
    const cfg = requireOperational(raw().get("contracts", "c-bot")!.config);
    const db = { ...Object.fromEntries(["activities", "attendance", "price_items", "case_area_changes", "billing_week_approvals"].map((n) => [n, [...raw().all(n as never)]])), cases: raw().all("cases").filter((c) => c.id === NEW) } as never;
    const [line] = billingLines(db, "2027-01", { now: rt.clock.now(), cfg }).filter((l) => l.caseId === NEW);
    expect(line.weeks.map((w) => [w.key, w.planned, w.zeroAttendance])).toEqual([["2027-W02", 0, true], ["2027-W03", 0, true], ["2027-W04", 0, true]]);
    expect(line.checks.filter((c) => c.kind === "zero_week").map((c) => [c.weekKey, c.severity])).toEqual([
      ["2027-W02", "needs_approval"], ["2027-W03", "needs_approval"], ["2027-W04", "needs_approval"],
    ]);
    expect(line.needsApproval).toBe(true);
  });

  it("coachens sparade januaribedömning (och plan) stoppar en senare start – meddelandet säger senaste datum och inget tas bort", async () => {
    makeAuto(JAN7);
    draftCheckIns(JAN7);
    const [ma] = janAssessments();
    const area = Object.keys(ma.areas)[0];
    expect(await cmd(assessmentSave.key, {
      caseId: JAN7, month: "2027-01", expectedVersion: ma.version, summary: "Coachens egen sammanfattning av januari.",
      areas: { [area]: { level: 2, observation: "Coachens observation.", nextStep: "Nästa steg." } }, plan: { plannedActivities: "Studiebesök hos lagerföretag" },
    }, leila())).toMatchObject({ ok: true });
    const saved = raw().get("monthly_assessments", ma.id)!;
    expect(await change(later, leila())).toEqual({
      ok: false, error: "report",
      message: "Coachen har sparat månadsbedömningen för januari 2027, och det coachen skrivit tas aldrig bort. Med det nya startdatumet får januari för få inskrivna dagar för en månadsbedömning, så startdatumet kan vara senast 21 jan 2027.",
    });
    expect(raw().get("cases", JAN7)?.startDate).toBe("2027-01-07");
    expect(raw().get("monthly_assessments", ma.id)).toEqual(saved);
    expect(janPlans().map((x) => x.plannedActivities)).toEqual(["Studiebesök hos lagerföretag"]);
    // Senaste datumet som behåller januari går – bedömningen och planen ligger kvar.
    expect(await change({ ...later, startDate: "2027-01-21" }, leila())).toMatchObject({ ok: true, droppedMonths: [], draftMonths: [] });
    expect(raw().get("monthly_assessments", ma.id)?.summary).toBe("Coachens egen sammanfattning av januari.");
  });

  it("systemets utkast tas bort men planen för februari ligger kvar – februaris förifyllda plan har kvar förra månadens plan", async () => {
    makeAuto(JAN7);
    draftCheckIns(JAN7);
    const [mp] = janPlans();
    const cfg = requireOperational(raw().get("contracts", "c-bot")!.config);
    const sys = rt.ctxFor(SYSTEM_ACTOR).system;
    expect(await change(later, leila())).toMatchObject({ ok: true, droppedMonths: ["2027-01"], draftMonths: ["2027-01"] });
    expect(janAssessments()).toEqual([]);
    const feb = await loadPrefill(sys, { id: JAN7 }, "2027-02", cfg, "2027-03-01T00:10");
    expect(feb.plan.plannedActivities).toBe(mp.plannedActivities);
    expect(feb.prefill.plan?.plannedActivities).toBe("previous");
  });

  it("en öppen flik återskapar inte januaribedömningen: autosparningen får not_needed, och conflict när raden försvunnit i en månad som behövs", async () => {
    makeAuto(JAN7);
    draftCheckIns(JAN7);
    const [ma] = janAssessments();
    expect(await change(later, as("u-sara", "samordnare"))).toMatchObject({ ok: true, droppedMonths: ["2027-01"] });
    const autosave = { caseId: JAN7, month: "2027-01", autosave: true, editSession: "abcdefabcdef12", summary: "Coachen skriver vidare i den öppna fliken.", plan: { goal1: "Mål" } };
    const res = await cmd(assessmentSave.key, { ...autosave, expectedVersion: ma.version }, leila());
    expect(res).toMatchObject({ ok: false, error: "not_needed" });
    expect(res.message).toMatch(/^Januari 2027 har för få inskrivna dagar för en månadsbedömning/);
    // En ny sida (expectedVersion 0) skapar inte heller någon rad för januari.
    expect(await cmd(assessmentSave.key, { ...autosave, expectedVersion: 0 }, leila())).toMatchObject({ ok: false, error: "not_needed" });
    expect(janAssessments()).toEqual([]);
    // En månad som behöver bedömningen men vars rad försvunnit: formuläret som såg version 1 eller mer skapar den inte igen.
    const JAN18 = "case-270011";
    const [other] = raw().all("monthly_assessments").filter((m) => m.caseId === JAN18 && m.month === "2027-01");
    rt.store.removeRow("monthly_assessments", other.id);
    expect(await cmd(assessmentSave.key, { ...autosave, caseId: JAN18, expectedVersion: other.version }, leila())).toMatchObject({ ok: false, error: "conflict" });
    expect(await cmd(assessmentSave.key, { ...autosave, caseId: JAN18, expectedVersion: 0 }, leila())).toMatchObject({ ok: true });
  });

  it("ett AI-utkast för januari som låg i kön skapar inte januaribedömningen igen efter ändringen", async () => {
    makeAuto(JAN7);
    draftCheckIns(JAN7);
    rt.store.updateRow("cases", JAN7, { aiConsentStatus: "given" });
    const sys = rt.ctxFor(SYSTEM_ACTOR);
    const ai = (sys as unknown as { ai?: { provider: string; model: string } }).ai;
    expect(ai, "minnesläget har AI").toBeTruthy();
    rt.store.insertRow("ai_runs", aiRunRow({
      id: "ai-auto-jan7", now: "2027-02-01T00:10", caseId: JAN7, kind: "monthly_draft", inputRef: "2027-01", status: "running",
      run: { provider: ai!.provider, model: ai!.model, latencyMs: 0, tokensIn: null, tokensOut: null, audioSeconds: null, costOre: 0 },
    }));
    expect(await change(later, leila())).toMatchObject({ ok: true, droppedMonths: ["2027-01"] });
    await expect(runVoiceJob(sys, "draft_monthly", { aiRunId: "ai-auto-jan7", caseId: JAN7, month: "2027-01" })).rejects.toMatchObject({ name: "VoiceJobError", code: "not_found" });
    expect(janAssessments()).toEqual([]);
  });

  it("starten flyttas tillbaka: rättelseuppgiften stängs automatiskt och ingen ny skapas – rapporterna stämmer igen", async () => {
    makeAuto(JAN7);
    draftCheckIns(JAN7);
    const open = () => raw().all("tasks").filter((t) => t.kind === "report_correction" && t.caseIds.includes(JAN7) && t.status === "open");
    expect(await change(later, leila())).toMatchObject({ ok: true, corrections: 3 });
    const [first] = open();
    expect(first.text).toBe("BOT-27-0002: startdatumet är ändrat från 7 jan 2027 till 1 feb 2027. Rätta rapporterna som redan är lämnade till kommunen: veckorapporterna för vecka 1, 2 och 3 2027.");
    const back = await change({ caseId: JAN7, startDate: "2027-01-07", expectedStartDate: "2027-02-01", motivation: "Fel datum valdes – tillbaka till 7 januari." }, leila());
    expect(back).toMatchObject({ ok: true, corrections: 0 });
    expect(open()).toEqual([]);
    expect(raw().get("tasks", first.id)).toMatchObject({
      status: "done", doneBy: "system", doneNote: "Startdatumet är ändrat igen, till 7 jan 2027. Rapporterna som är lämnade till kommunen stämmer nu – inget behöver rättas.",
    });
    expect(startLogs().at(-1)?.details).toMatchObject({ closedTaskIds: [first.id] });
    expect(raw().all("audit_log").some((l) => l.action === "task.done" && l.entityId === first.id && l.details.auto === true)).toBe(true);
  });

  it("starten flyttas igen: den gamla uppgiften ersätts av en ny med rapporterna som räknade med det första datumet", async () => {
    makeAuto(JAN7);
    draftCheckIns(JAN7);
    expect(await change(later, leila())).toMatchObject({ ok: true, corrections: 3 });
    const res = await change({ caseId: JAN7, startDate: "2027-01-18", expectedStartDate: "2027-02-01", motivation: "Deltagaren började den 18 januari, inte den 1 februari." }, leila());
    expect(res).toMatchObject({ ok: true, corrections: 2 });
    const tasks = raw().all("tasks").filter((t) => t.kind === "report_correction" && t.caseIds.includes(JAN7));
    expect(tasks.map((t) => [t.status, t.text])).toEqual([
      ["done", "BOT-27-0002: startdatumet är ändrat från 7 jan 2027 till 1 feb 2027. Rätta rapporterna som redan är lämnade till kommunen: veckorapporterna för vecka 1, 2 och 3 2027."],
      ["open", "BOT-27-0002: startdatumet är ändrat från 7 jan 2027 till 18 jan 2027. Rätta rapporterna som redan är lämnade till kommunen: veckorapporterna för vecka 1 och 2 2027."],
    ]);
  });

  it("uppgiften i samordnarens Min vecka länkar till ärendets rapporter – inte till inkorgen", async () => {
    makeAuto(JAN7);
    draftCheckIns(JAN7);
    expect(await change(later, leila())).toMatchObject({ ok: true, corrections: 3 });
    const task = raw().all("tasks").find((t) => t.kind === "report_correction" && t.caseIds.includes(JAN7))!;
    const v = await q(inboxStart, {}, sara());
    expect(v.tasks.find((t) => t.id === task.id)).toMatchObject({ caseId: JAN7, href: `/arenden/${JAN7}?flik=rapporter` });
    // Inkorgen: ett ärende utan post i inkorgen väljer ingen annan deltagares avrop.
    const inbox = await q(inboxList, {}, sara());
    expect(inbox.rows.some((r) => r.caseId === JAN7)).toBe(false);
    expect(initialPick(inbox, null, JAN7, false)).toBeNull();
    expect(initialPick(inbox, null, null, false)).toBe(inbox.pending[0]);
  });

  it("meddelandet säger att utkast togs bort bara när det fanns några – februari som inte är slut får ingen månadsrapport", async () => {
    const res = await change({ caseId: "case-270038", startDate: "2027-02-25", expectedStartDate: "2027-02-01", motivation: WHY }, sara());
    expect(res).toMatchObject({ ok: true, droppedMonths: ["2027-02"], draftMonths: [] });
    if (!res.ok) return;
    const text = startChangedText(res, false);
    expect(text).toContain("Februari 2027 har nu för få dagar för en månadsrapport och får ingen månadsrapport eller månadsbedömning.");
    expect(text).not.toContain("Utkasten");
    makeAuto(JAN7);
    draftCheckIns(JAN7);
    const jan = await change(later, leila());
    expect(jan.ok && startChangedText(jan, false)).toContain("Januari 2027 har nu för få dagar för en månadsrapport. Utkasten till månadsrapport och månadsbedömning för månaden togs bort.");
  });
});
