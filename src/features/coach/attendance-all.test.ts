// "Markera alla som närvarande" (coach.attendanceSetAll, D2 punkt 3): samma rader som enskild registrering, redan
// registrerade ändras aldrig, skyddade och andras ärenden ger not_found utan att något skrivs, en loggrad per dag, och
// fakturaunderlaget och veckorapporterna blir identiska med sex enskilda registreringar. Körs genom samma execute() som
// appen och prototypen, mot testdatat i minnet.
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { billableWeeks } from "@/core/billing";
import { addMinutes } from "@/core/time";
import { weeklyReport, type WeeklyReport } from "@/core/weekly-report";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import type { Case, TableName, Tables } from "@/data/schema";
import { createSeed, DEMO_START } from "@/data/seed";
import { caseHistory } from "@/features/arenden/api";
import { detailText } from "@/features/admin/audit-text";
import { attendanceSet, attendanceSetAll } from "./api";

const SEED: MemoryData<Tables> = createSeed();
/** Amiras oregistrerade tillfällen vecka 4 (testdatat): onsdag 27/1 och torsdag 28/1 för Nadia, Elif och Amal. */
const WED = { nadia: "a-12496", elif: "a-13882", amal: "a-14070" };
const THU = { nadia: "a-12497", elif: "a-13883", amal: "a-14071" };
const WED_IDS = [WED.nadia, WED.elif, WED.amal];
const THU_IDS = [THU.nadia, THU.elif, THU.amal];
const CASES = { nadia: "case-260143", elif: "case-270003", amal: "case-270012" };
/** Hodans onsdag (redan registrerad: närvarande, at-11386). */
const HODAN_WED = "a-11385";
const T1 = addMinutes(DEMO_START, 1);
const T2 = addMinutes(DEMO_START, 2);

let rt: MemoryRuntime;
const fresh = (data: MemoryData<Tables> = structuredClone(SEED)) => createMemoryRuntime({ data, clock: demoClock(DEMO_START) });
beforeEach(() => {
  rt = fresh();
});
const as = (userId: string, role?: Role, r: MemoryRuntime = rt): Actor => {
  const p = listPersonas(r.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCommand = CommandDef<any, any>;
const run = <D extends AnyCommand>(def: D, input: ParamsOf<D>, actor: Actor, r: MemoryRuntime = rt) => r.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const rows = <N extends TableName>(name: N, r: MemoryRuntime = rt): Tables[N][] => r.store.rows(name);
const amira = (r: MemoryRuntime = rt) => as("u-amira", "coach", r);
const attFor = (activityId: string, r: MemoryRuntime = rt) => rows("attendance", r).find((a) => a.activityId === activityId);
const audit = (action: string, r: MemoryRuntime = rt) => rows("audit_log", r).filter((x) => x.action === action);

describe("coach.attendanceSetAll", () => {
  it("1. markerar de tre oregistrerade onsdagstillfällena som närvarande – exakt som enskild registrering", async () => {
    const before = rows("attendance").length;
    const res = await run(attendanceSetAll, { day: "2027-01-27", activityIds: WED_IDS }, amira());
    expect(res).toMatchObject({ ok: true, marked: WED_IDS, skipped: [], published: [], registeredAt: T1 });
    expect(rows("attendance").length).toBe(before + 3);
    for (const id of WED_IDS) {
      const a = attFor(id)!;
      expect(a).toMatchObject({ activityId: id, status: "present", reason: "", registeredBy: "u-amira", registeredAt: T1, customerNotifiedAt: null });
      expect(a.caseId).toBe(rows("activities").find((x) => x.id === id)!.caseId);
    }
    // Torsdagen är kvar – ingen veckorapport publicerad ännu.
    expect(rows("reports").find((r) => r.id === "rep-16692")!.status).toBe("waiting");
  });

  it("2. samma anrop igen ändrar ingenting: allt hoppas över och raderna är orörda", async () => {
    await run(attendanceSetAll, { day: "2027-01-27", activityIds: WED_IDS }, amira());
    const snapshot = JSON.stringify(WED_IDS.map((id) => attFor(id)));
    const logs = rows("audit_log").length;
    const res = await run(attendanceSetAll, { day: "2027-01-27", activityIds: WED_IDS }, amira());
    expect(res).toMatchObject({ ok: true, marked: [], skipped: WED_IDS, published: [] });
    expect(JSON.stringify(WED_IDS.map((id) => attFor(id)))).toBe(snapshot);
    // Också den tomma dagen loggas (antal 0) – men inga närvarorader.
    expect(rows("audit_log").length).toBe(logs + 1);
    expect(audit("attendance.registered_all").at(-1)!.details).toMatchObject({ count: 0, activityIds: [], skippedActivityIds: WED_IDS });
  });

  it("3. ett tillfälle som redan är registrerat (ogiltig frånvaro) ändras aldrig", async () => {
    const data = structuredClone(SEED);
    const hodan = data.attendance.find((a) => a.activityId === HODAN_WED)!;
    hodan.status = "absent_invalid";
    hodan.reason = "Uteblev utan att meddela";
    rt = fresh(data);
    const res = await run(attendanceSetAll, { day: "2027-01-27", activityIds: [...WED_IDS, HODAN_WED] }, amira());
    expect(res).toMatchObject({ ok: true, marked: WED_IDS, skipped: [HODAN_WED] });
    expect(attFor(HODAN_WED)).toMatchObject({ id: "at-11386", status: "absent_invalid", reason: "Uteblev utan att meddela" });
    expect(attFor(HODAN_WED)!.registeredAt).not.toBe(T1);
  });

  it("4. ett tillfälle i en kollegas ärende registreras också (beslut 2026-10-09); ett som inte finns stoppar allt", async () => {
    const before = rows("attendance").length;
    const logs = rows("audit_log").length;
    // a-finns-inte: ingenting skrivs.
    const res = await run(attendanceSetAll, { day: "2027-01-27", activityIds: [...WED_IDS, "a-finns-inte"] }, amira());
    expect(res).toMatchObject({ ok: false, error: "not_found" });
    expect(rows("attendance").length).toBe(before);
    expect(rows("audit_log").length).toBe(logs);
    expect(WED_IDS.map((id) => attFor(id))).toEqual([undefined, undefined, undefined]);
    // a-11290: BOT-26-0117 (huvudcoach Mats), onsdag 27/1 – Amira registrerar i kollegans ärende.
    const ok = await run(attendanceSetAll, { day: "2027-01-27", activityIds: [...WED_IDS, "a-11290"] }, amira());
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) expect([...ok.marked, ...ok.skipped]).toContain("a-11290");
  });

  it("5. handledaren kan inte registrera i ett ärende med skyddade personuppgifter (vilande spärr påslagen)", async () => {
    const before = rows("attendance").length;
    // a-11443: BOT-26-0120 (coach Erik), onsdag 27/1. Med spärren påslagen ser Petra bara ärendet – inte tillfällena.
    rt.store.updateRow("persons", rt.raw().get("cases", "case-260120")!.personId, { protectedIdentity: true });
    const res = await run(attendanceSetAll, { day: "2027-01-27", activityIds: [WED.nadia, "a-11443"] }, as("u-petra", "handledare"));
    expect(res).toMatchObject({ ok: false, error: "not_found" });
    expect(rows("attendance").length).toBe(before);
    // Utan det skyddade går det bra – handledaren registrerar teamets tillfälle.
    const ok = await run(attendanceSetAll, { day: "2027-01-27", activityIds: [WED.nadia] }, as("u-petra", "handledare"));
    expect(ok).toMatchObject({ ok: true, marked: [WED.nadia] });
    expect(attFor(WED.nadia)).toMatchObject({ registeredBy: "u-petra", status: "present" });
  });

  it("6. fel dag eller ett tillfälle som inte har startat stoppar hela anropet", async () => {
    const before = rows("attendance").length;
    expect(await run(attendanceSetAll, { day: "2027-01-28", activityIds: WED_IDS }, amira())).toMatchObject({ ok: false, error: "wrong_day" });
    const future = rows("activities").find((a) => a.caseId === CASES.nadia && a.startsAt > DEMO_START)!;
    expect(future).toBeTruthy();
    expect(await run(attendanceSetAll, { day: future.startsAt.slice(0, 10), activityIds: [future.id] }, amira())).toMatchObject({ ok: false, error: "not_started" });
    expect(rows("attendance").length).toBe(before);
    expect(audit("attendance.registered_all")).toEqual([]);
  });

  it("7. onsdag och torsdag publicerar Marias och Lindas veckorapporter – en loggrad per dag, inga enskilda rader", async () => {
    const wed = await run(attendanceSetAll, { day: "2027-01-27", activityIds: WED_IDS }, amira());
    expect(wed).toMatchObject({ ok: true, published: [] });
    const thu = await run(attendanceSetAll, { day: "2027-01-28", activityIds: THU_IDS }, amira());
    expect(thu.ok).toBe(true);
    if (!thu.ok) return;
    expect(thu.published.map((p) => [p.reportId, p.recipientName, p.weekKey, p.text])).toEqual([
      ["rep-16694", "Linda Karlsson", "2027-W04", "Veckorapporten för v. 4 2027 till Linda Karlsson publicerades automatiskt."],
      ["rep-16692", "Maria Ekdahl", "2027-W04", "Veckorapporten för v. 4 2027 till Maria Ekdahl publicerades automatiskt."],
    ]);
    expect(rows("reports").find((r) => r.id === "rep-16692")).toMatchObject({ status: "delivered", deliveredTo: ["k-maria"], deliveredAt: T2 });
    expect(rows("reports").find((r) => r.id === "rep-16694")).toMatchObject({ status: "delivered", deliveredTo: ["k-linda"], deliveredAt: T2 });
    const all = audit("attendance.registered_all");
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ actorId: "u-amira", entity: "attendance", entityId: null, occurredAt: T1 });
    expect(all[0].details).toMatchObject({ day: "2027-01-27", status: "present", count: 3, activityIds: WED_IDS, caseIds: [CASES.nadia, CASES.elif, CASES.amal], skippedActivityIds: [] });
    expect((all[0].details.attendanceIds as string[]).sort()).toEqual(WED_IDS.map((id) => attFor(id)!.id).sort());
    expect(all[1].details).toMatchObject({ day: "2027-01-28", count: 3, activityIds: THU_IDS });
    expect(audit("attendance.registered")).toEqual([]);
    expect(audit("report.published").filter((x) => x.occurredAt >= T1).map((x) => x.entityId).sort()).toEqual(["rep-16692", "rep-16694"]);
    // Inga namn i loggraden – bara id:n och tal.
    expect(JSON.stringify(all.map((x) => x.details))).not.toMatch(/Nadia|Elif|Amal|Warsame|Yilmaz|Hassan/);
    // Samma rapporter och samma text som när de sex registreras en och en.
    const B = fresh();
    let last: unknown = null;
    for (const id of [...WED_IDS, ...THU_IDS]) last = await run(attendanceSet, { activityId: id, status: "present" }, amira(B), B);
    expect(last).toMatchObject({ ok: true, published: { reportId: "rep-16692", text: "Veckorapporten för v. 4 2027 till Maria Ekdahl publicerades automatiskt." } });
    expect(rows("reports", B).find((r) => r.id === "rep-16694")!.status).toBe("delivered");
  });

  it("8. fakturaunderlag och veckorapport blir identiska med sex enskilda registreringar", async () => {
    // A: två masskommandon (onsdag 09.13, torsdag 09.14). B: sex enskilda med samma klockslag (klockan sätts tillbaka).
    const A = rt;
    await run(attendanceSetAll, { day: "2027-01-27", activityIds: WED_IDS }, amira(A), A);
    await run(attendanceSetAll, { day: "2027-01-28", activityIds: THU_IDS }, amira(A), A);
    const B = fresh();
    for (const id of WED_IDS) {
      B.clock.set(DEMO_START);
      expect(await run(attendanceSet, { activityId: id, status: "present" }, amira(B), B)).toMatchObject({ ok: true });
    }
    for (const id of THU_IDS) {
      B.clock.set(T1);
      expect(await run(attendanceSet, { activityId: id, status: "present" }, amira(B), B)).toMatchObject({ ok: true });
    }
    expect(A.clock.now()).toBe(T2);
    expect(B.clock.now()).toBe(T2);
    const env = { now: T2 };
    const stripIds = (xs: readonly Tables["attendance"][]) => xs.map(({ id: _id, ...rest }) => {
      void _id;
      return rest;
    }).sort((x, y) => x.activityId.localeCompare(y.activityId));
    const mine = (r: MemoryRuntime) => stripIds(rows("attendance", r).filter((a) => [...WED_IDS, ...THU_IDS].includes(a.activityId)));
    expect(mine(A)).toEqual(mine(B));
    expect(mine(A)).toHaveLength(6);
    for (const caseId of Object.values(CASES)) {
      const cA = rows("cases", A).find((c) => c.id === caseId) as Case;
      const cB = rows("cases", B).find((c) => c.id === caseId) as Case;
      const weeksA = billableWeeks(cA, { activities: rows("activities", A), attendance: rows("attendance", A) }, env);
      const weeksB = billableWeeks(cB, { activities: rows("activities", B), attendance: rows("attendance", B) }, env);
      expect(weeksA).toEqual(weeksB);
      const w4 = weeksA.find((w) => w.key === "2027-W04")!;
      expect(w4).toMatchObject({ missingRegistration: false, zeroAttendance: false });
      expect(w4.registered).toBe(w4.planned);
    }
    const report = (r: MemoryRuntime, recipient: string) => {
      const db = { cases: rows("cases", r), activities: rows("activities", r), attendance: rows("attendance", r), deviations: rows("deviations", r) };
      const wr: WeeklyReport = weeklyReport(db, recipient, "2027-W04", env);
      return { ...wr, sections: wr.sections.map((s) => ({ ...s, rows: s.rows.map((x) => ({ activity: x.activity, att: x.att ? { ...x.att, id: "" } : null })) })) };
    };
    for (const recipient of ["k-maria", "k-linda"]) {
      expect(report(A, recipient)).toEqual(report(B, recipient));
      expect(report(A, recipient).complete).toBe(true);
    }
    const rep = (r: MemoryRuntime, id: string) => {
      const x = rows("reports", r).find((y) => y.id === id)!;
      return { status: x.status, deliveredAt: x.deliveredAt, deliveredTo: x.deliveredTo, approvedAt: x.approvedAt };
    };
    for (const id of ["rep-16692", "rep-16694"]) expect(rep(A, id)).toEqual(rep(B, id));
  });

  it("9. historiken: chefen ser raden med antalet, coachen ser den en gång utan dubblett per dag", async () => {
    await run(attendanceSetAll, { day: "2027-01-27", activityIds: WED_IDS }, amira());
    const karin = await q(caseHistory, { caseId: CASES.nadia }, as("u-karin", "chef"));
    expect(karin).not.toBeNull();
    const text = "Närvaro registrerades för flera tillfällen samma dag";
    expect(karin!.log.filter((x) => x.text === text)).toMatchObject([{ actorName: "Amira Haddad", sub: "3 tillfällen", occurredAt: T1 }]);
    // Coachen läser aldrig revisionsloggen (policyn): hennes "Dina åtgärder" byggs av närvaroraderna – en rad per dag, utan dubblett.
    const own = await q(caseHistory, { caseId: CASES.nadia }, amira());
    expect(own!.ownOnly).toBe(true);
    expect(own!.log.filter((x) => x.text === text)).toEqual([]);
    expect(own!.log.filter((x) => x.text === "Närvaro registrerades" && x.occurredAt.startsWith("2027-02-01"))).toMatchObject([{ occurredAt: T1, sub: "1 tillfälle" }]);
    // Elif och Amal har samma rad i sina kort.
    for (const caseId of [CASES.elif, CASES.amal]) expect((await q(caseHistory, { caseId }, as("u-karin", "chef")))!.log.filter((x) => x.text === text)).toHaveLength(1);
    // Revisionsloggen (admin): läsbar text utan namn.
    const row = audit("attendance.registered_all")[0];
    const lookups = { userName: () => null, caseNumber: (id: string) => rows("cases").find((c) => c.id === id)?.caseNumber ?? null, kpiLabel: () => null, templateLabel: (k: string) => k };
    expect(detailText({ action: row.action, entity: row.entity, entityId: row.entityId, details: row.details }, lookups)).toBe(
      "Dag: 27 jan 2027 · Status: Närvarande · Antal: 3 · Tillfällen: 3 tillfällen · Närvaroposter: 3 närvaroposter · Ärenden: 3 ärenden",
    );
  });
});
