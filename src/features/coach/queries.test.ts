// Tester för coachens vy-modeller (frågorna i query-handlers.ts). Körs genom samma execute() som appen och prototypen,
// mot testdatat och som testpersonerna. Värdena är den gamla prototypens (prototyp/tools/test-coach.mjs och skärmdumpar).
import { beforeEach, describe, expect, it } from "vitest";
import { dormantSupervisor } from "@/data/dormant-role.test-helper";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import type { MemoryData } from "@/data/memory";
import type { Tables } from "@/data/schema";
import { createSeed, DEMO_START } from "@/data/seed";
import { unregistered } from "@/core/attendance";
import {
  assessmentPage, casePicker, checkInAttendance, checkInPage, checkinSave, eventsPage, intakePage, minVecka, narvaroView,
} from "./api";
import { messageRead, messageSend } from "@/features/arenden/api";
import { notifRead } from "@/features/notiser/api";
import { groupingOverview } from "@/features/grupper/api";

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
  it("alla deltagare i avtalet – inte bara huvudcoachens (Karims beslut 2026-11-11: Alla ser alla)", async () => {
    const v = await q(minVecka, {}, amira());
    expect(v.now).toBe(DEMO_START);
    expect(v.lastWeek).toEqual({ no: 4, mon: "2027-01-25" });
    expect(v.reg).toMatchObject({ dueAt: "2027-02-01T10:00", sla: { label: "48 min kvar", tone: "urgent" }, dueText: "måndag 10.00", pubText: "måndag 16.00" });
    const cases = rt.store.rows("cases").filter((c) => c.contractId === "c-bot");
    const db = { cases, activities: rt.store.rows("activities"), attendance: rt.store.rows("attendance") };
    const all = unregistered(db, null, "2027-01-25", "2027-01-31", { now: DEMO_START });
    // Förr: Amiras 6 (Nadia, Elif och Amal). Nu alla deltagare i avtalet – också kollegornas.
    expect(v.unregistered.count).toBe(all.length);
    expect(v.unregistered.byCase.map((x) => x.caseId)).toEqual(expect.arrayContaining([SC.nadia, "case-270003", SC.amal]));
    // Huvudcoachen står på raden.
    expect(v.unregistered.byCase.find((x) => x.caseId === SC.nadia)!.leadCoach).toBe("Amira");
    // Dagens tillfällen för alla pågående ärenden i avtalet (egna rader – gruppaktiviteterna är en rad per aktivitet).
    const active = new Set(cases.filter((c) => c.status === "active").map((c) => c.id));
    expect(v.today).toHaveLength(rt.store.rows("activities").filter((a) => active.has(a.caseId) && !a.groupActivityId && a.startsAt.startsWith("2027-02-01")).length);
    expect(v.today.length).toBeGreaterThan(9);
    expect(v.today.some((t) => t.leadCoach && t.leadCoach !== "Amira")).toBe(true);
    expect(v.drafts.map((d) => d.caseId)).toContain(SC.mehmet);
    expect(v.monthly).toMatchObject({ month: "2027-01", dueAt: "2027-02-05T23:59", dueNote: "Sista dag ej fastställd – förslag 5:e arbetsdagen" });
    expect(v.monthly.total).toBeGreaterThan(15);
    expect(v.flags.map((f) => f.key)).toContain("stuck:case-270012:1");
    expect(v.flags.every((f) => !/escalat|no_progress|ai_draft/.test(f.kind))).toBe(true);
    // Inga deadlines som coachen inte såg förut: fakturering, åtgärdsplaner och svar på avrop är andras.
    expect(v.due.other.every((d) => !/^(bill|cd|avrop):/.test(d.id))).toBe(true);
    expect(v.reminders.map((r) => r.caseNumber)).toEqual(expect.arrayContaining(["BOT-26-0148", "BOT-26-0126", "BOT-26-0130", "BOT-27-0003"]));
    // Notiserna går som förut bara till huvudcoachen.
    expect(v.unread.count).toBe(4);
    expect(v.messages.find((m) => m.caseId === SC.nadia)).toEqual({
      notificationId: null, caseId: SC.nadia, caseNumber: "BOT-26-0143", name: "Nadia Warsame", createdAt: "2027-02-01T08:15", from: "Maria Ekdahl",
      excerpt: "Tack! Kan vi ses på ett uppföljningsmöte vecka 6? Jag kan tisdag eller torsdag förmiddag.", count: 1,
    });
    expect(v.calendar.mon).toBe("2027-02-01");
  });

  it("coach B ser coach A:s deltagare på Min vecka och i Närvaro", async () => {
    const erik = as("u-erik", "coach");
    const v = await q(minVecka, {}, erik);
    expect(v.unregistered.byCase.map((x) => x.caseId)).toContain(SC.nadia);
    const n = await q(narvaroView, {}, erik);
    expect(n.weeks.last.rows.some((r) => r.caseId === SC.nadia && r.leadCoach === "Amira")).toBe(true);
    expect(n.cases.map((c) => c.caseId)).toContain(SC.nadia);
  });

  it("visar olästa meddelanden från kommunen tills coachen läst dem i ärendet", async () => {
    const sent = await rt.run("command", messageSend.key, { caseId: SC.nadia, body: "Tiden passar bra. Vi ses på torsdag." }, as("k-maria", "kommun_handlaggare"));
    expect(sent).toMatchObject({ ok: true });
    const nadiaOf = async () => (await q(minVecka, {}, amira())).messages.filter((m) => m.caseId === SC.nadia);
    const first = await nadiaOf();
    expect(first).toEqual([expect.objectContaining({ caseId: SC.nadia, caseNumber: "BOT-26-0143", from: "Maria Ekdahl", excerpt: "Tiden passar bra. Vi ses på torsdag.", count: 2 })]);
    expect(first[0].notificationId).toEqual(expect.any(String));
    // Notisen läst: meddelandena är fortfarande olästa i ärendet.
    await rt.run("command", notifRead.key, { ids: [first[0].notificationId as string] }, amira());
    expect(await nadiaOf()).toEqual([expect.objectContaining({ caseId: SC.nadia, notificationId: null, count: 2 })]);
    // Coachen öppnar meddelandena i deltagarkortet (läskvitto): borta från Min vecka.
    await rt.run("command", messageRead.key, { caseId: SC.nadia }, amira());
    expect(await nadiaOf()).toEqual([]);
  });

  it("är bara för coachen", async () => {
    await expect(q(minVecka, {}, dormantSupervisor())).rejects.toBeInstanceOf(ApiError);
  });

  it("Att kartlägga (paket 2): samma urval som Grupper och nivåer-sidans Utan nivå – för alla deltagare i avtalet (2026-11-11)", async () => {
    const v = await q(minVecka, {}, amira());
    const overview = await q(groupingOverview, {}, amira());
    const mine = new Set(rt.store.rows("cases").filter((c) => c.contractId === "c-bot").map((c) => c.id));
    const expected = (overview?.unplaced ?? []).filter((m) => mine.has(m.caseId));
    expect(v.toMap.map((m) => [m.caseId, m.intake])).toEqual(expected.map((m) => [m.caseId, m.intake]));
    expect(v.toMap.map((m) => m.caseNumber)).toContain("BOT-27-0012");
  });

  it("Följ upp (paket 2): notiserna och flaggorna har ärendet, så att samma ärende står en gång", async () => {
    const v = await q(minVecka, {}, amira());
    expect(v.unread.items).toHaveLength(v.unread.count);
    // Påminnelserna på Min vecka gäller alla deltagare; notiserna går bara till huvudcoachen – varje notis har en påminnelse.
    const reminded = new Set(v.reminders.map((r) => r.caseNumber));
    expect(v.unread.items.filter((n) => n.kind === "progress_reminder").every((n) => reminded.has(n.caseNumber as string))).toBe(true);
    expect(v.flags.find((f) => f.kind === "stuck")).toMatchObject({ caseId: SC.amal, caseNumber: "BOT-27-0012", name: "Amal Hassan" });
    // Automatisk närvaro: klockslaget i regeln (organisationens inställning, standard 18.00).
    expect(v.autoPresentAt).toBe("18:00");
  });
});

describe("Närvaro", () => {
  it("coachen: alla deltagare i avtalet vecka 4 (Karims beslut 2026-11-11), de som saknar närvaro, veckorapporterna väntar", async () => {
    const v = await q(narvaroView, {}, amira());
    const w = v.weeks.last;
    expect(w.key).toBe("2027-W04");
    const started = new Set(rt.store.rows("cases").filter((c) => c.contractId === "c-bot" && c.startDate).map((c) => c.id));
    expect(w.rows).toHaveLength(rt.store.rows("activities").filter((a) => started.has(a.caseId) && a.startsAt >= "2027-01-25" && a.startsAt < "2027-02-01").length);
    expect(w.rows.length).toBeGreaterThan(42);
    const cases = rt.store.rows("cases").filter((c) => c.contractId === "c-bot");
    const open = unregistered({ cases, activities: rt.store.rows("activities"), attendance: rt.store.rows("attendance") }, null, "2027-01-25", "2027-01-31", { now: DEMO_START });
    expect(w.rows.filter((r) => !r.attendance && r.startsAt < v.now)).toHaveLength(open.length);
    expect(v.sameDayText).toBe("Frånvaronotis samma dag: tillval som inte är fastställt – ingen notis skickas.");
    expect(v.absenceReasons).toEqual(["Sjukdom", "Vård av barn", "Myndighetsbesök", "Annat giltigt skäl"]);
    expect(v.repeatedRule).toEqual({ absentInvalid: 2, withinDays: 14 });
    // Klockslaget för den automatiska närvaron kommer från samma källa som jobbet auto_attendance (paket 1, C4).
    expect(v.autoAttendance).toEqual({ on: true, at: "18:00" });
    const org = rt.store.rows("org_settings")[0];
    rt.store.updateRow("org_settings", org.id, { settings: { ...org.settings, attendance: { autoPresent: true, autoPresentAt: "16:30" } } });
    expect((await q(narvaroView, {}, amira())).autoAttendance).toEqual({ on: true, at: "16:30" });
    rt.store.updateRow("org_settings", org.id, { settings: { ...org.settings, attendance: { autoPresent: false, autoPresentAt: "16:30" } } });
    expect((await q(narvaroView, {}, amira())).autoAttendance).toEqual({ on: false, at: "16:30" });
    // Coachen ser nu alla deltagare: det som saknas i listan är allt som saknas i handläggarens veckorapport.
    for (const r of w.reports.filter((x) => !x.publishedAt)) expect(r.mine, r.name).toBe(r.left);
    expect(w.reports.some((r) => r.name === "Maria Ekdahl" && !r.publishedAt)).toBe(true);
  });

  // Rollen handledare är vilande (beslut 2026-10-09; före beslutet: Petras 63 teamärenden, 81 tillfällen, 2 kvar). Regeln
  // ligger kvar: listan bygger på teamet, inte på huvudcoachen – prövas med David (arbetsgivarmatchare i teamen).
  it("den vilande rollen handledare ser bara sina teamärenden", async () => {
    const v = await q(narvaroView, {}, dormantSupervisor("u-david"));
    const team = new Set(rt.raw().all("case_team").filter((t) => t.userId === "u-david").map((t) => t.caseId));
    expect(v.caseCount).toBe(rt.raw().all("cases").filter((c) => team.has(c.id) && c.startDate).length);
    expect(v.caseCount).toBeGreaterThan(0);
    expect(v.weeks.last.rows.length).toBeGreaterThan(0);
    expect(v.weeks.last.rows.every((r) => team.has(r.caseId))).toBe(true);
    // Petra har inga teamplatser sedan rollen togs bort ur testdatat.
    expect((await q(narvaroView, {}, dormantSupervisor())).caseCount).toBe(0);
  });
});

describe("Ärendevyerna", () => {
  it("deltagarlistan för månadsbedömningen visar alla deltagare i avtalet med bedömning för januari (2026-11-11)", async () => {
    const v = await q(casePicker, { kind: "manad" }, amira());
    expect(v.month).toBe("2027-01");
    const withMa = new Set(rt.store.rows("monthly_assessments").filter((m) => m.month === "2027-01").map((m) => m.caseId));
    expect(v.rows).toHaveLength(rt.store.rows("cases").filter((c) => c.contractId === "c-bot" && withMa.has(c.id)).length);
    expect(v.rows.length).toBeGreaterThan(15);
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

  it("månadsbedömningen för Nadia: progressionsnivå 0 automatiskt i varje område och AI-utkast har källor", async () => {
    const v = await q(assessmentPage, { caseId: SC.nadia, month: "2027-01" }, amira());
    if (v.kind !== "ok") throw new Error("spärrad");
    expect(v.areas).toHaveLength(10);
    // Karims beslut 2026-10-22: allt är ifyllt – nivå 0 "Automatiskt – inget belägg" tills coachen väljer eller godtar.
    expect(v.areas.every((a) => a.level === 0 && a.levelSource === "auto")).toBe(true);
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
    // Bonus är påslagen sedan Karims beslut 2026-11-04 (incitamentsmodellen med bonussteg 1–5).
    expect([v.finalDays, v.finalProvisional, v.bonusOn, v.closed]).toEqual([5, true, true, null]);
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
