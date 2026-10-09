// Tester för coachens vy-modeller (frågorna i query-handlers.ts). Körs genom samma execute() som appen och prototypen,
// mot testdatat och som testpersonerna. Värdena är den gamla prototypens (prototyp/tools/test-coach.mjs och skärmdumpar).
import { beforeEach, describe, expect, it } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import type { MemoryData } from "@/data/memory";
import type { Tables } from "@/data/schema";
import { createSeed, DEMO_START } from "@/data/seed";
import {
  assessmentPage, casePicker, checkInAttendance, checkInPage, checkinSave, eventsPage, intakePage, minVecka, narvaroView,
} from "./api";
import { messageRead, messageSend } from "@/features/arenden/api";
import { notifRead } from "@/features/notiser/api";

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
const amira = () => as("u-amira", "coach");
const SC = { nadia: "case-260143", yusuf: "case-260148", hodan: "case-260119", mehmet: "case-260130", amal: "case-270012", skyddad: "case-260120" };

describe("Min vecka", () => {
  it("ger samma siffror som prototypen: 6 att registrera, 1 AI-utkast, 4 av 15 bedömningar", async () => {
    const v = await q(minVecka, {}, amira());
    expect(v.now).toBe(DEMO_START);
    expect(v.lastWeek).toEqual({ no: 4, mon: "2027-01-25" });
    expect(v.reg).toMatchObject({ dueAt: "2027-02-01T10:00", sla: { label: "48 min kvar", tone: "urgent" }, dueText: "måndag 10.00", pubText: "måndag 16.00" });
    expect(v.unregistered.count).toBe(6);
    expect(v.unregistered.byCase.map((x) => [x.name, x.items.length])).toEqual([["Nadia Warsame", 2], ["Elif Yilmaz", 2], ["Amal Hassan", 2]]);
    expect(v.unregistered.waitingFor).toEqual(["Maria Ekdahl", "Linda Karlsson"]);
    expect(v.today).toHaveLength(9);
    expect(v.next).toMatchObject({ shortName: "Nadia W." });
    expect(v.drafts.map((d) => [d.caseId, d.inputMethod, d.rawTranscriptDeleteBy])).toEqual([[SC.mehmet, "ai_recording", "2027-02-28T13:00"]]);
    expect(v.monthly).toMatchObject({ month: "2027-01", dueAt: "2027-02-05T23:59", dueNote: "Sista dag ej fastställd – förslag 5:e arbetsdagen", done: 4, total: 15 });
    expect(v.monthly.open).toHaveLength(11);
    expect(v.flags.map((f) => f.key)).toEqual(["stuck:case-270012:1", expect.stringMatching(/^absence:case-260148:/)]);
    expect(v.flags.every((f) => !/escalat|no_progress|ai_draft/.test(f.kind))).toBe(true);
    expect(v.reminders.map((r) => [r.caseNumber, r.streak])).toEqual([["BOT-26-0148", 3], ["BOT-26-0126", 1], ["BOT-26-0130", 1], ["BOT-27-0003", 1]]);
    expect(v.unread.count).toBe(4);
    // Marias meddelande 1 februari 08.15 är oläst för Amira – det syns på Min vecka (samma räkning som kortets olästa).
    expect(v.messages).toEqual([
      {
        notificationId: null, caseId: SC.nadia, caseNumber: "BOT-26-0143", name: "Nadia Warsame", createdAt: "2027-02-01T08:15", from: "Maria Ekdahl",
        excerpt: "Tack! Kan vi ses på ett uppföljningsmöte vecka 6? Jag kan tisdag eller torsdag förmiddag.", count: 1,
      },
    ]);
    expect(v.due.monthly).toMatchObject({ count: 14, byStatus: { draft: 11, approved: 3 }, dueAt: "2027-02-05T23:59" });
    expect(v.calendar.mon).toBe("2027-02-01");
  });

  it("visar olästa meddelanden från kommunen tills coachen läst dem i ärendet", async () => {
    const sent = await rt.run("command", messageSend.key, { caseId: SC.nadia, body: "Tiden passar bra. Vi ses på torsdag." }, as("k-maria", "kommun_handlaggare"));
    expect(sent).toMatchObject({ ok: true });
    const v = await q(minVecka, {}, amira());
    expect(v.messages).toEqual([expect.objectContaining({ caseId: SC.nadia, caseNumber: "BOT-26-0143", from: "Maria Ekdahl", excerpt: "Tiden passar bra. Vi ses på torsdag.", count: 2 })]);
    expect(v.messages[0].notificationId).toEqual(expect.any(String));
    // Notisen läst: meddelandena är fortfarande olästa i ärendet.
    await rt.run("command", notifRead.key, { ids: [v.messages[0].notificationId as string] }, amira());
    expect((await q(minVecka, {}, amira())).messages).toEqual([expect.objectContaining({ caseId: SC.nadia, notificationId: null, count: 2 })]);
    // Coachen öppnar meddelandena i deltagarkortet (läskvitto): borta från Min vecka.
    await rt.run("command", messageRead.key, { caseId: SC.nadia }, amira());
    expect((await q(minVecka, {}, amira())).messages).toEqual([]);
  });

  it("är bara för coachen", async () => {
    await expect(q(minVecka, {}, as("u-petra", "handledare"))).rejects.toBeInstanceOf(ApiError);
  });
});

describe("Närvaro", () => {
  it("coachen: 6 av 42 tillfällen vecka 4 saknar närvaro, veckorapporterna väntar", async () => {
    const v = await q(narvaroView, {}, amira());
    const w = v.weeks.last;
    expect(w.key).toBe("2027-W04");
    expect(w.rows).toHaveLength(42);
    expect(w.rows.filter((r) => !r.attendance && r.startsAt < v.now)).toHaveLength(6);
    expect(v.sameDayText).toBe("Frånvaronotis samma dag: tillval som inte är fastställt – ingen notis skickas.");
    expect(v.absenceReasons).toEqual(["Sjukdom", "Vård av barn", "Myndighetsbesök", "Annat giltigt skäl"]);
    expect(v.repeatedRule).toEqual({ absentInvalid: 2, withinDays: 14 });
    expect(w.reports.slice(0, 2).map((r) => [r.name, r.mine, r.left, r.publishedAt])).toEqual([["Maria Ekdahl", 4, 4, null], ["Linda Karlsson", 2, 2, null]]);
    expect(w.reports.filter((r) => r.publishedAt).map((r) => r.publishedAt)).toEqual(["2027-02-01T07:00", "2027-02-01T07:00"]);
  });

  it("handledaren ser bara sina 63 teamärenden (81 tillfällen, 2 kvar)", async () => {
    const v = await q(narvaroView, {}, as("u-petra", "handledare"));
    expect(v.caseCount).toBe(63);
    expect(v.weeks.last.rows).toHaveLength(81);
    expect(v.weeks.last.rows.filter((r) => !r.attendance && r.startsAt < v.now)).toHaveLength(2);
    expect(v.weeks.last.rows.some((r) => r.caseId === SC.skyddad)).toBe(false);
  });
});

describe("Ärendevyerna", () => {
  it("deltagarlistan för månadsbedömningen visar alla coachens ärenden med bedömning för januari", async () => {
    const v = await q(casePicker, { kind: "manad" }, amira());
    expect(v.month).toBe("2027-01");
    expect(v.rows).toHaveLength(15);
    expect(v.rows.filter((r) => r.badge?.text === "Godkänd")).toHaveLength(4);
  });

  it("öppnar kollegans ärende (beslut 2026-10-09) men spärrar ett skyddat ärende (vilande spärr) och ärenden som inte finns", async () => {
    // Eriks ärende: Amira når det.
    expect((await q(checkInPage, { caseId: SC.skyddad }, amira())).kind).toBe("ok");
    rt.store.updateRow("persons", rt.raw().get("cases", SC.skyddad)!.personId, { protectedIdentity: true });
    expect(await q(checkInPage, { caseId: SC.skyddad }, amira())).toEqual({ kind: "gate", gate: expect.objectContaining({ title: "Du saknar åtkomst till ärendet" }) });
    expect(await q(checkInPage, { caseId: "case-finns-inte" }, amira())).toEqual({ kind: "gate", gate: expect.objectContaining({ title: "Ärendet finns inte" }) });
  });

  it("avstämningen för Yusuf: påminnelse, upprepad frånvaro, nekat samtycke och förifyllning", async () => {
    const v = await q(checkInPage, { caseId: SC.yusuf }, amira());
    if (v.kind !== "ok") throw new Error("spärrad");
    expect(v.watch).toMatchObject({ streak: 3, reason: "Inget möte dokumenterat", weekKey: "2027-W04" });
    expect(v.repeatedAbsence).toEqual({ count: 2, withinDays: 14 });
    expect(v.aiConsent).toBe("declined");
    expect(v.todayMeetingAt).toBe("2027-02-01T11:00");
    expect(v.owners[0]).toEqual({ id: "u-amira", name: "Amira Haddad (du)" });
    expect(v.owners.map((o) => o.id)).toContain("u-sara");
    expect(v.checkIn).toBeNull();
  });

  it("AI-utkastet för Mehmet har förslag med belägg men aldrig samlad status", async () => {
    const v = await q(checkInPage, { caseId: SC.mehmet, checkInId: "ci-11916" }, amira());
    if (v.kind !== "ok" || !v.checkIn?.ai) throw new Error("utkast saknas");
    expect(v.checkIn.status).toBe("draft");
    expect(v.checkIn.overallStatus).toBeNull();
    expect(Object.keys(v.checkIn.ai)).not.toContain("overallStatus");
    expect(v.checkIn.ai.goalStatus).toMatchObject({ value: "partly", t: expect.any(Number) });
    expect(v.checkIn.ai.transcript.length).toBeGreaterThan(0);
  });

  it("närvaron senaste veckan följer avstämningens datum", async () => {
    const a = await q(checkInAttendance, { caseId: SC.mehmet, date: "2027-01-29" }, amira());
    expect(a).toMatchObject({ from: "2027-01-23", to: "2027-01-29", present: 3, late: 0, absentInvalid: 0, rate: 1 });
    // Kollegans ärende nås (beslut 2026-10-09) – men inte med skyddade personuppgifter (vilande spärr).
    expect(await q(checkInAttendance, { caseId: SC.skyddad, date: "2027-01-29" }, amira())).not.toBeNull();
    rt.store.updateRow("persons", rt.raw().get("cases", SC.skyddad)!.personId, { protectedIdentity: true });
    expect(await q(checkInAttendance, { caseId: SC.skyddad, date: "2027-01-29" }, amira())).toBeNull();
  });

  it("månadsbedömningen för Nadia: nivåerna är tomma och AI-utkast har källor", async () => {
    const v = await q(assessmentPage, { caseId: SC.nadia, month: "2027-01" }, amira());
    if (v.kind !== "ok") throw new Error("spärrad");
    expect(v.areas).toHaveLength(10);
    expect(v.areas.every((a) => a.level === null)).toBe(true);
    expect(v.aiOk).toBe(true);
    expect(v.requiredFrom).toBe(1);
    expect(v.areas.some((a) => a.aiObservationDraft?.noEvidence && a.aiLevelSuggestion === null)).toBe(true);
    expect(v.basis.checkIns.map((x) => x.slice(0, 10))).toEqual(["2027-01-04", "2027-01-11", "2027-01-18", "2027-01-25"]);
    expect(v.basis.attendance.rate).toBe(1);
    expect(v.basis.events).toHaveLength(2);
    expect(v.dueAt).toBe("2027-02-05T23:59");
  });

  it("skyddade personuppgifter (vilande spärr påslagen): inga AI-utkast skickas till skärmen", async () => {
    // Testdatat har inga skyddade personer sedan 2026-10-07 – spärren slås på för personen i ärendet.
    rt.store.updateRow("persons", rt.raw().get("cases", SC.skyddad)!.personId, { protectedIdentity: true });
    const v = await q(assessmentPage, { caseId: SC.skyddad, month: "2027-01" }, as("u-erik", "coach"));
    if (v.kind !== "ok") throw new Error("spärrad");
    expect(v.head.protected).toBe(true);
    expect(v.aiOk).toBe(false);
    expect(v.areas.every((a) => a.aiObservationDraft === null && a.aiLevelSuggestion === null)).toBe(true);
    expect(v.assessment?.aiSummaryDraft ?? null).toBeNull();
  });

  it("kartläggningen för Amal: fastnat i fas 1 och spår i avtalsområdet", async () => {
    const v = await q(intakePage, { caseId: SC.amal }, amira());
    if (v.kind !== "ok") throw new Error("spärrad");
    expect(v.stuck).toEqual({ phase: 1, phaseName: "Kartläggning", days: 14, maxDays: 10 });
    expect(v.tracks.area).toContain("Individuellt spår");
    expect(v.tracks.all.length).toBeGreaterThan(v.tracks.area.length);
  });

  it("händelser och avslut för Hodan: resultatregler från avtalet", async () => {
    const v = await q(eventsPage, { caseId: SC.hodan }, amira());
    if (v.kind !== "ok") throw new Error("spärrad");
    expect(v.events).toHaveLength(2);
    expect(v.employers.map((e) => e.name)).toContain("Tumba Städ & Fastighet AB");
    expect(v.result).toMatchObject({ countsAsResult: ["arbete", "studier"], excluded: ["avbrott_flytt", "avbrott_kommunens_beslut"] });
    expect(v.result.definitionText).toMatch(/^Resultatdefinitionen är inte fastställd i avtalet\. Preliminärt i prototypen/);
    expect([v.finalDays, v.finalProvisional, v.bonusOn, v.closed]).toEqual([5, true, false, null]);
  });
});

describe("Avstämningens kommentar om närvaron", () => {
  it("sparas med avstämningen (fältet saknades i kommandots schema)", async () => {
    const res = await rt.run("command", checkinSave.key, { caseId: SC.yusuf, data: { heldAt: "2027-02-01T11:00", attendanceComment: "Vi har gått igenom resvägen." } }, amira());
    expect(res).toMatchObject({ ok: true });
    const id = (res as { checkInId: string }).checkInId;
    expect(rt.raw().get("check_ins", id)?.attendanceComment).toBe("Vi har gått igenom resvägen.");
  });
});
