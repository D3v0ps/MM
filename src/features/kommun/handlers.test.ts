// Tester för kommunportalens frågor och kommandon – det som inte syns på skärmen i E2E-testet (tests/e2e/kommun.spec.ts):
// revisionslogg, utskick, rollkontroller och siffrorna jämfört med den gamla prototypen (prototyp/tools/test-kommun.mjs).
// Körs genom execute() mot testdatat i minnet som testpersonerna i rollväljaren (behörighet via policy.ts).
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { TableName, Tables } from "@/data/schema";
import { caseCreate, caseDecline, messageSend } from "@/features/arenden/api";
import { deviationCallCustomer } from "@/features/coach/api";
import {
  kommunApproveActionPlan, kommunCase, kommunCaseList, kommunCaseSeen, kommunChef, kommunDuplicate, kommunOrderForm, kommunReceipt, kommunReports, kommunRevealPnr,
  kommunStart, kommunTaskDone, kommunTestPersonas, type KomCaseDetail,
} from "./api";

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
const run = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ask = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const rows = <N extends TableName>(name: N): Tables[N][] => rt.store.rows(name);

const maria = () => as("k-maria", "kommun_handlaggare");
const eva = () => as("k-eva", "kommun_chef");
const sara = () => as("u-sara", "samordnare");
const amira = () => as("u-amira", "coach");
const NADIA = "case-260143";
const YUSUF = "case-260148";
const ELIF = "case-270003";
const SKYDDAD = "case-260120";
const MALL = "case-270050";

const expectForbidden = async (p: Promise<unknown>) => {
  await expect(p).rejects.toBeInstanceOf(ApiError);
  await p.catch((e: ApiError) => expect(e.status).toBe(403));
};

describe("startsidan och listorna – samma siffror som den gamla prototypen", () => {
  it("startsidan: 4 olästa rapporter, 27 pågår och 2 väntar på start", async () => {
    const s = await ask(kommunStart, {}, maria());
    expect(s.firstName).toBe("Maria");
    expect(s.customerName).toBe("Botkyrka kommun");
    expect(s.unreadReports.map((r) => r.sub)).toEqual(["BOT-26-0112 · Habiba Mohamed", "BOT-26-0108 · Selam Ibrahim", "BOT-26-0170 · Bashir Karlsson", "BOT-26-0145 · Anders Karlsson"]);
    expect(s.unreadTotal).toBe(4);
    expect([s.active, s.waiting]).toEqual([27, 2]);
    expect(s.tasks).toEqual([]);
    expect(s.events).toEqual([]);
  });
  it("listan: handläggaren ser 71 egna, chefen 231 i enheten och den skyddade bara som ärendenummer", async () => {
    const own = await ask(kommunCaseList, {}, maria());
    expect(own.rows).toHaveLength(71);
    expect(own.rows.filter((r) => !["closed", "declined"].includes(r.status))).toHaveLength(29);
    expect(own.rows.every((r) => r.referrerId === "k-maria")).toBe(true);
    const chef = await ask(kommunCaseList, {}, eva());
    expect(chef.rows).toHaveLength(231);
    const prot = chef.rows.find((r) => r.id === SKYDDAD);
    expect(prot).toMatchObject({ name: "Skyddade personuppgifter", restricted: true, protectedIdentity: true });
    expect(JSON.stringify(chef)).not.toContain("Lindgren");
  });
  it("rapporterna: 211 levererade till handläggaren och veckorapporten för vecka 4 är på väg", async () => {
    const r = await ask(kommunReports, {}, maria());
    expect(r.reports).toHaveLength(211);
    expect(r.coming).toEqual([{ id: "rep-16692", title: "Veckorapport närvaro, vecka 4", dueAt: "2027-02-01T16:00" }]);
    const c = await ask(kommunReports, {}, eva());
    expect(c.reports.map((x) => x.title)).toEqual(["Beställarrapport december 2026", "Beställarrapport november 2026", "Beställarrapport oktober 2026"]);
    expect(c.coming.map((x) => x.title)).toEqual(["Beställarrapport januari 2027"]);
  });
});

describe("deltagarens sida", () => {
  it("Nadia: orderbekräftelse, närvaro och maskerat personnummer", async () => {
    const d = (await ask(kommunCase, { caseId: NADIA }, maria())) as KomCaseDetail;
    expect(d.kind).toBe("ok");
    expect(d.order).toMatchObject({ coachName: "Amira Haddad", weeks: 10, priceOre: 139800, valueOre: 1398000, buyerReference: "4410023817" });
    expect(d.attendance).toMatchObject({ restricted: false, prev: { label: "januari", planned: 11, present: 8, late: 1, unregistered: 2, rate: 1 } });
    expect(d.participant?.pnrMasked).toBe("••••••••-9545");
    expect(JSON.stringify(d)).not.toContain("19730216");
  });
  it("en annan handläggares ärende nekas, ett okänt ärende finns inte", async () => {
    expect(await ask(kommunCase, { caseId: ELIF }, maria())).toEqual({ kind: "denied" });
    expect(await ask(kommunCase, { caseId: "case-finns-inte" }, maria())).toEqual({ kind: "not_found" });
  });
  it("kommunens chef och skyddade personuppgifter: inga personuppgifter, meddelanden eller närvaro", async () => {
    const d = (await ask(kommunCase, { caseId: SKYDDAD }, eva())) as KomCaseDetail;
    expect(d.case).toMatchObject({ name: "Skyddade personuppgifter", restricted: true });
    expect(d.participant).toBeNull();
    expect(d.messages).toBeNull();
    expect(d.attendance).toEqual({ restricted: true });
    expect(d.reports).toEqual([]);
    expect(JSON.stringify(d)).not.toMatch(/Sanna|Lindgren/);
  });
  it("Visa personnummer loggas utan numret i loggen, och bara med kommunens åtkomst", async () => {
    const r = await run(kommunRevealPnr, { caseId: NADIA }, maria());
    expect(r).toEqual({ ok: true, pnr: "19730216-9545" });
    const log = rows("audit_log").filter((x) => x.action === "pnr.revealed");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: "k-maria", entity: "person", details: { caseId: NADIA } });
    expect(JSON.stringify(log[0])).not.toContain("9545");
    expect(await run(kommunRevealPnr, { caseId: SKYDDAD }, eva())).toMatchObject({ ok: false, error: "forbidden" });
    expect(await run(kommunRevealPnr, { caseId: ELIF }, maria())).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("beställning", () => {
  it("formuläret: avtalets regler, senaste referensen och spärrade referenser", async () => {
    const f = await ask(kommunOrderForm, {}, maria());
    expect(f).toMatchObject({
      today: "2027-02-01", defaultStart: "2027-02-15", lastBuyerRef: "4410023817", buyerReference: { pattern: "^[0-9]{8,10}$" }, blockedRefs: ["55102983"],
      weeks: { min: 4, max: 10 }, firstMeetingWithin: "en vecka", answerDue: "2027-02-02T09:12",
    });
    expect(f.areas).toHaveLength(12);
    expect(f.tracks.G).toContain("Truckförare A+B");
  });
  it("dubblettkontrollen: egen insats med nummer, andras insatser bara som att de finns", async () => {
    expect(await ask(kommunDuplicate, { pnr: "19730216-9545" }, maria())).toEqual([{ caseId: NADIA, caseNumber: "BOT-26-0143", status: "active" }]);
    expect(await ask(kommunDuplicate, { pnr: "20030516-9502" }, maria())).toEqual([{ caseId: null, caseNumber: null, status: null }]);
    expect(await ask(kommunDuplicate, { pnr: "1988041" }, maria())).toEqual([]);
  });
  it("kvittot: ordererkännandet och mejlet innehåller bara ärendenumret; skyddade får en generisk bekräftelse", async () => {
    const c = await run(caseCreate, { source: "portal", protectedIdentity: false, firstName: "Samira", lastName: "Testsson", pnr: "19880412-3456", city: "Tumba", preferredContact: "letter", address: "Testgatan 1", buyerReference: "4410023817", primaryArea: "G", plannedWeeks: 8, desiredStart: "2027-02-15" }, maria());
    if (!c.ok) throw new Error(c.error);
    expect(c.caseNumber).toBe("BOT-27-0051");
    const r = await ask(kommunReceipt, { caseId: c.caseId }, maria());
    expect(r?.ackText).toMatch(/^Tack! Vi har tagit emot er beställning och gett den ärendenummer BOT-27-0051\./);
    expect(r?.mail).toMatchObject({ from: "notis@miljonmatch.se", to: "maria.ekdahl@botkyrka.se" });
    expect(r?.mail?.body).toContain("BOT-27-0051");
    expect(r?.mail?.body).not.toMatch(/Samira|Testsson|3456|Tumba/);
    expect(r?.contactLabel).toBe("Brev");
    const p = await run(caseCreate, { source: "portal", protectedIdentity: true, firstName: "Skyddad", lastName: "Person", pnr: "19790101-1111", buyerReference: "4410023817", plannedWeeks: 6 }, maria());
    if (!p.ok) throw new Error(p.error);
    const pr = await ask(kommunReceipt, { caseId: p.caseId }, maria());
    expect(pr).toMatchObject({ protectedIdentity: true, ackText: null, contactLabel: null });
    expect(pr?.mail?.body).toBe("Tack. Vi har tagit emot beställningen. Ring oss på 08-000 00 00 så tar vi resten enligt den säkra rutinen.");
    // Någon annans kvitto finns inte
    expect(await ask(kommunReceipt, { caseId: NADIA }, as("k-linda", "kommun_handlaggare"))).toBeNull();
  });
  it("bara handläggaren beställer i portalen", async () => {
    await expectForbidden(ask(kommunOrderForm, {}, eva()));
    await expectForbidden(ask(kommunStart, {}, eva()));
  });
});

describe("kommandon (prototypens kom.*)", () => {
  it("kom.caseSeen: en avböjd beställning försvinner ur händelserna när ärendet har öppnats", async () => {
    await run(caseDecline, { caseId: MALL, reason: "Ingen ledig plats." }, sara());
    let s = await ask(kommunStart, {}, maria());
    expect(s.events.map((e) => e.title)).toEqual(["Beställning BOT-27-0050 kunde inte tas emot"]);
    const d = (await ask(kommunCase, { caseId: MALL }, maria())) as KomCaseDetail;
    expect(d.unseenEvents).toBe(1);
    const before = rt.clock.now();
    expect(await run(kommunCaseSeen, { caseId: MALL }, maria())).toEqual({ ok: true });
    expect(rt.clock.now(), "tyst kommando flyttar inte klockan").toBe(before);
    expect(rows("case_seen")).toContainEqual({ id: `k-maria:${MALL}`, userId: "k-maria", caseId: MALL, seenAt: before });
    s = await ask(kommunStart, {}, maria());
    expect(s.events).toEqual([]);
    expect(await run(kommunCaseSeen, { caseId: ELIF }, maria())).toMatchObject({ ok: false, error: "not_found" });
  });
  it("kom.taskDone: handläggaren markerar Miljonbemannings uppgift som klar – loggas", async () => {
    await run(deviationCallCustomer, { caseId: YUSUF, body: "Hej Maria! Kan vi ses?", proposedAt: "2027-02-04T13:00" }, amira());
    const { deviationSave } = await import("@/features/coach/api");
    await run(deviationSave, { caseId: YUSUF, data: { description: "Upprepad ogiltig frånvaro", action: "Möte med deltagaren", needsCustomerDecision: true } }, amira());
    const s = await ask(kommunStart, {}, maria());
    expect(s.tasks).toHaveLength(1);
    expect(s.unreadMessages[0]).toMatchObject({ caseNumber: "BOT-26-0148", meeting: true, senderLabel: "Amira Haddad, Miljonbemanning" });
    const t = s.tasks[0];
    expect(await run(kommunTaskDone, { taskId: t.id }, as("k-linda", "kommun_handlaggare"))).toMatchObject({ ok: false, error: "not_found" });
    expect(await run(kommunTaskDone, { taskId: t.id }, maria())).toEqual({ ok: true });
    expect(rows("tasks").find((x) => x.id === t.id)).toMatchObject({ status: "done", doneBy: "k-maria" });
    expect(rows("audit_log").some((x) => x.action === "task.done" && x.entityId === t.id && x.actorId === "k-maria")).toBe(true);
    expect((await ask(kommunStart, {}, maria())).tasks).toEqual([]);
  });
  it("kom.approveActionPlan: chefen godkänner med tid och namn, loggas och avtalsansvarig får mejl utan personuppgifter", async () => {
    const c = await ask(kommunChef, {}, eva());
    expect(c.pendingPlans.map((x) => x.id)).toEqual(["cd-3"]);
    expect(await run(kommunApproveActionPlan, { id: "cd-3" }, eva())).toEqual({ ok: true });
    const cd = rows("contract_deviations").find((x) => x.id === "cd-3");
    expect(cd).toMatchObject({ customerApprovedBy: "k-eva", customerApprovedAt: rt.clock.now(), status: "action_plan" });
    expect(rows("audit_log").some((x) => x.action === "contract_deviation.action_plan_approved" && x.entityId === "cd-3")).toBe(true);
    const mail = rows("outbound_messages").filter((x) => x.template === "atgardsplan_godkand");
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ to: "johan.berg@miljonbemanning.se", body: "Beställaren har godkänt en åtgärdsplan i Miljonmatch. Logga in för att se den." });
    expect(await run(kommunApproveActionPlan, { id: "cd-1" }, eva())).toMatchObject({ ok: false, error: "already_approved" });
    await expectForbidden(run(kommunApproveActionPlan, { id: "cd-3" }, maria()));
  });
  it("meddelanden: handläggaren som beställde skriver, chefen läser utan läskvitto", async () => {
    const r = await run(messageSend, { caseId: NADIA, body: "Hej Amira!" }, maria());
    expect(r.ok).toBe(true);
    const d = (await ask(kommunCase, { caseId: NADIA }, maria())) as KomCaseDetail;
    expect(d.canWrite).toBe(true);
    expect(d.messages?.at(-1)).toMatchObject({ senderLabel: "Du", mine: true, read: false, body: "Hej Amira!" });
    const c = (await ask(kommunCase, { caseId: NADIA }, eva())) as KomCaseDetail;
    expect(c.canWrite).toBe(false);
    expect(c.messages?.at(-1)).toMatchObject({ senderLabel: "Maria Ekdahl, Botkyrka kommun", fromCustomer: true });
  });
  it("testpersonernas adresser (prototypens snabbval) – bara användare läsaren redan får se", async () => {
    expect(await ask(kommunTestPersonas, { userIds: ["k-maria", "k-eva"] }, maria())).toEqual([
      { userId: "k-maria", email: "maria.ekdahl@botkyrka.se" },
      { userId: "k-eva", email: "eva.bergstrom@botkyrka.se" },
    ]);
  });
});

describe("beställarrapporten", () => {
  it("december är förvald och siffrorna är den levererade rapportens (som prototypen)", async () => {
    const c = await ask(kommunChef, {}, eva());
    expect(c.months).toEqual([
      { month: "2026-10", delivered: true },
      { month: "2026-11", delivered: true },
      { month: "2026-12", delivered: true },
      { month: "2027-01", delivered: false },
    ]);
    expect(c.month).toBe("2026-12");
    expect(c.contractTarget).toBe(0.32);
    expect(c.minN).toBe(5);
    expect(c.summary).toMatchObject({ active: 129, started: 53, closed: 39, deviations: 7 });
    expect(c.summary?.result.rolling).toMatchObject({ num: 24, den: 77, excluded: 6, minN: 10 });
    expect(c.summary?.result.month).toMatchObject({ num: 13, den: 37 });
    expect(c.summary?.pulse).toMatchObject({ enough: true, responses: 165 });
    expect(c.report).toMatchObject({ id: "rep-16698", approvedByName: "Johan Berg", deliveredAt: "2027-01-12T10:05" });
    expect(c.warnings).toBeGreaterThanOrEqual(0);
    expect(c.managerName).toBe("Johan Berg");
    // Det interna målet (35 %) finns aldrig i vy-modellen.
    expect(JSON.stringify(c)).not.toMatch(/:0\.35[,}]|internalTarget|internt/i);
  });
  it("oktober: små grupper (4 av 6) och januari som utkast utan siffror", async () => {
    const o = await ask(kommunChef, { month: "2026-10" }, eva());
    expect(o.summary?.result.rolling).toMatchObject({ num: 4, den: 6 });
    const j = await ask(kommunChef, { month: "2027-01" }, eva());
    expect(j.summary).toBeNull();
    expect(j.report).toBeNull();
    expect(j.pending).toEqual({ dueAt: expect.any(String) });
  });
  it("bara kommunens chef", async () => {
    await expectForbidden(ask(kommunChef, {}, maria()));
  });
});
