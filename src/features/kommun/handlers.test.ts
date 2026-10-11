// Tester för kommunportalens frågor och kommandon – det som inte syns på skärmen i E2E-testet (tests/e2e/kommun.spec.ts):
// revisionslogg, utskick, rollkontroller och siffrorna jämfört med den gamla prototypen (prototyp/tools/test-kommun.mjs).
// Beslut 2026-10-07: kommunen har bara rollen handläggare (ingen chef, beställarrapport eller resultatfil i portalen), inga
// belopp, beställarreferenser eller skyddade personuppgifter i portalen och ett nytt beställningsformulär (omfattning i
// månader, kartläggning, bilagor). Körs genom execute() mot testdatat i minnet som testpersonerna i rollväljaren.
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
  kommunCase, kommunCaseList, kommunCaseSeen, kommunDuplicate, kommunOrderForm, kommunProfile, kommunProfileSave, kommunReceipt, kommunReports, kommunRevealPnr,
  kommunStart, kommunTaskDone, type KomCaseDetail,
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
const omar = () => as("k-omar", "kommun_handlaggare");
const sara = () => as("u-sara", "samordnare");
const amira = () => as("u-amira", "coach");
const NADIA = "case-260143";
const YUSUF = "case-260148";
const ELIF = "case-270003";
/** Omars beställning – hade skyddade personuppgifter i testdatat före 2026-10-07, i dag ett vanligt ärende. */
const SKYDDAD = "case-260120";
const MALL = "case-270050";

const expectForbidden = async (p: Promise<unknown>) => {
  await expect(p).rejects.toBeInstanceOf(ApiError);
  await p.catch((e: ApiError) => expect(e.status).toBe(403));
};

describe("startsidan och listorna – samma siffror som den gamla prototypen", () => {
  it("startsidan: 4 olästa rapporter – inga händelser och inga siffror (beslut 2026-10-09)", async () => {
    const s = await ask(kommunStart, {}, maria());
    expect(s.firstName).toBe("Maria");
    expect(s.customerName).toBe("Botkyrka kommun");
    expect(s.unreadReports.map((r) => r.sub)).toEqual(["BOT-26-0112 · Habiba Mohamed", "BOT-26-0108 · Selam Ibrahim", "BOT-26-0170 · Bashir Karlsson", "BOT-26-0145 · Anders Karlsson"]);
    expect(s.tasks).toEqual([]);
    // Kommunens handläggare ser mindre: startsidan har bara Att göra och det olästa.
    expect(Object.keys(s).sort()).toEqual(["customerName", "firstName", "profileIncomplete", "tasks", "unit", "unreadMessages", "unreadReports"]);
  });
  it("listan: handläggaren ser 71 egna – inga fält om skyddade personuppgifter, inga belopp", async () => {
    const own = await ask(kommunCaseList, {}, maria());
    expect(own.rows).toHaveLength(71);
    expect(own.rows.filter((r) => !["closed", "declined"].includes(r.status))).toHaveLength(29);
    expect(own.rows.every((r) => r.referrerId === "k-maria")).toBe(true);
    for (const key of ["restricted", "protectedIdentity", "valueOre", "priceOre", "buyerReference"]) expect(own.rows[0]).not.toHaveProperty(key);
    // Omars beställning är ett vanligt ärende: namnet visas för honom.
    const o = await ask(kommunCaseList, {}, omar());
    expect(o.rows.find((r) => r.id === SKYDDAD)).toMatchObject({ name: "Sanna Lindgren" });
  });
  it("rapporterna: 211 levererade till handläggaren – inga rapporter på väg (beslut 2026-10-09)", async () => {
    const r = await ask(kommunReports, {}, maria());
    expect(r.reports).toHaveLength(211);
    // Kommunens handläggare ser mindre: rapporter som inte är levererade lämnas inte ut alls.
    expect(r).not.toHaveProperty("coming");
    expect(r.reports.some((x) => x.id === "rep-16692")).toBe(false);
    // Beställarrapporten lämnas utanför portalen (beslut 2026-10-07).
    expect(r.reports.some((x) => x.title.startsWith("Beställarrapport"))).toBe(false);
    for (const a of [omar(), as("k-ahmed", "kommun_handlaggare"), as("k-linda", "kommun_handlaggare")]) {
      const x = await ask(kommunReports, {}, a);
      expect(x.reports.some((y) => y.title.startsWith("Beställarrapport")), a.userId).toBe(false);
    }
  });
});

describe("deltagarens sida", () => {
  it("Nadia: orderbekräftelse, närvaro och maskerat personnummer", async () => {
    const d = (await ask(kommunCase, { caseId: NADIA }, maria())) as KomCaseDetail;
    expect(d.kind).toBe("ok");
    expect(d.order).toMatchObject({ coachName: "Amira Haddad" });
    // Inget ordervärde, pris eller beställarreferens i portalen (synpunkt #10 och #11).
    for (const key of ["weeks", "priceOre", "valueOre", "buyerReference"]) expect(d.order).not.toHaveProperty(key);
    expect(JSON.stringify(d)).not.toMatch(/4410023817|139800|1398000|valueOre|priceOre/);
    // Närvaron är en rad: närvarograden de senaste 30 dagarna – ingen uppdelning i giltig och ogiltig frånvaro (beslut 2026-10-09).
    // Testdatat för Nadia 3 januari–1 februari 2027 (startade 14 december): 11 passerade tillfällen – 8 närvarande, 1 sen och
    // 2 oregistrerade. Närvarograden räknas på de registrerade: (8 + 1) / 9 = 100 %.
    expect(d.attendance).toEqual({ rate: 1, planned: 11, ended: false });
    expect(JSON.stringify(d)).not.toMatch(/absentValid|absentInvalid|repeated|unregistered/);
    expect(d.participant).toEqual({ pnrMasked: "••••••••-9545", canReveal: true });
    // Inget team och inget ordererkännande att visa (beslut 2026-10-09) – orderbekräftelsen finns kvar.
    expect(Object.keys(d.order).sort()).toEqual(["coachName", "ocReportId"]);
    expect(d.order.ocReportId).toEqual(expect.any(String));
    expect(JSON.stringify(d)).not.toContain("19730216");
  });
  it("närvarograden: perioden börjar aldrig före startdatumet, en avslutad insats räknas fram till slutdatumet, inga tillfällen är inte 'inte registrerad'", async () => {
    const att = async (caseId: string) => ((await ask(kommunCase, { caseId }, maria())) as KomCaseDetail).attendance;
    // BOT-27-0004 startade 11 januari (inom 30 dagar): 10 tillfällen 11 januari–1 februari – 8 närvarande, 1 sen och 1 giltig
    // frånvaro = 9 / 10. Ett registrerat tillfälle före startdatumet (påhittat här) räknas inte med.
    const early = "case-270004";
    expect(rows("cases").find((c) => c.id === early)?.startDate).toBe("2027-01-11");
    expect(await att(early)).toEqual({ rate: 0.9, planned: 10, ended: false });
    rt.store.insertRow("activities", { id: "act-fore-start", caseId: early, kind: rows("activities").find((a) => a.caseId === early)!.kind, startsAt: "2027-01-08T10:00", durationMin: 60, location: "Alby", note: "", groupActivityId: null });
    rt.store.insertRow("attendance", { id: "att-fore-start", activityId: "act-fore-start", caseId: early, status: "absent_invalid", reason: "Uteblev utan att meddela", registeredBy: "u-amira", registeredAt: "2027-01-08T12:00", customerNotifiedAt: null, source: "manual" });
    expect(await att(early), "tillfället före startdatumet räknas inte").toEqual({ rate: 0.9, planned: 10, ended: false });
    // BOT-26-0094 avslutades 18 december 2026 (mer än 30 dagar sedan): de sista 30 dagarna i insatsen, 19 november–18
    // december – 13 tillfällen, alla närvarande. Tidigare räknades fönstret till i dag och visade "inte registrerad än".
    expect(rows("cases").find((c) => c.id === "case-260094")).toMatchObject({ status: "closed", endDate: "2026-12-18" });
    expect(await att("case-260094")).toEqual({ rate: 1, planned: 13, ended: true });
    // BOT-26-0082 (9 november–4 december 2026) är kortare än 30 dagar: hela insatsen – 12 tillfällen, 10 närvarande och 2 med giltig frånvaro.
    expect(await att("case-260082")).toEqual({ rate: 10 / 12, planned: 12, ended: true });
    // BOT-27-0046 startar i dag: inga passerade tillfällen – planned 0 (skärmen skriver "inga tillfällen", inte "inte registrerad än").
    expect(await att("case-270046")).toEqual({ rate: null, planned: 0, ended: false });
    // Inte startad: ingen närvarorad.
    expect(await att(MALL)).toBeNull();
  });
  it("yrkesspåret och fasen lämnas inte ut på deltagarens sida – fasen finns bara i listans rad (beslut 2026-10-09)", async () => {
    const d = (await ask(kommunCase, { caseId: NADIA }, maria())) as KomCaseDetail;
    for (const key of ["vocationalTrack", "phase", "phaseName"]) expect(d.case, key).not.toHaveProperty(key);
    expect(d).not.toHaveProperty("phaseCount");
    expect(rows("cases").find((c) => c.id === NADIA)?.vocationalTrack, "testdatat har ett yrkesspår som inte får lämnas ut").toBeTruthy();
    expect(JSON.stringify(d)).not.toContain(rows("cases").find((c) => c.id === NADIA)!.vocationalTrack);
    const list = await ask(kommunCaseList, {}, maria());
    const row = list.rows.find((r) => r.id === NADIA)!;
    expect(row).not.toHaveProperty("vocationalTrack");
    expect(row).toMatchObject({ phase: expect.any(Number), phaseName: expect.any(String) });
    expect(list.phaseCount).toBeGreaterThan(0);
  });
  it("en annan handläggares ärende nekas, ett okänt ärende finns inte", async () => {
    expect(await ask(kommunCase, { caseId: ELIF }, maria())).toEqual({ kind: "denied" });
    expect(await ask(kommunCase, { caseId: "case-finns-inte" }, maria())).toEqual({ kind: "not_found" });
  });
  it("deltagarens sida visar mindre (beslut 2026-10-09): ingen kontaktväg, bostadsort, bakgrundsinformation eller bilagor", async () => {
    const maria101 = rows("inbound_emails").find((m) => m.id === "em-101")!.caseId!;
    const d = (await ask(kommunCase, { caseId: maria101 }, maria())) as KomCaseDetail;
    expect(d.kind).toBe("ok");
    expect(d).not.toHaveProperty("background");
    expect(d.participant).not.toHaveProperty("contactLabel");
    expect(d.participant).not.toHaveProperty("city");
    // Omfattningen finns kvar på ärendet (orderbekräftelsen).
    expect(d.case).toMatchObject({ orderPeriodMonths: 6, otherPeriod: false });
  });
  it("Visa personnummer loggas utan numret i loggen, och bara med kommunens åtkomst", async () => {
    const r = await run(kommunRevealPnr, { caseId: NADIA }, maria());
    expect(r).toEqual({ ok: true, pnr: "19730216-9545" });
    const log = rows("audit_log").filter((x) => x.action === "pnr.revealed");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: "k-maria", entity: "person", details: { caseId: NADIA } });
    expect(JSON.stringify(log[0])).not.toContain("9545");
    expect(await run(kommunRevealPnr, { caseId: ELIF }, maria())).toMatchObject({ ok: false, error: "not_found" });
    expect(await run(kommunRevealPnr, { caseId: SKYDDAD }, maria())).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("beställning", () => {
  it("formuläret: omfattningen i månader ur avtalet, yrkesområdena, bilagorna och tidsgränserna – ingen referens, inga yrkesspår eller priser", async () => {
    const f = await ask(kommunOrderForm, {}, maria());
    expect(f).toMatchObject({
      customerName: "Botkyrka kommun", today: "2027-02-01", defaultStart: "2027-02-15", firstMeetingWithin: "en vecka", answerDue: "2027-02-02T09:12",
      me: { name: "Maria Ekdahl", unit: "Arbetsmarknadsenheten Alby", email: "maria.ekdahl@botkyrka.se" },
      periods: { months: [6, 12], allowOther: true },
      attachments: { maxBytes: 10 * 1024 * 1024, maxFiles: 10 },
    });
    // Yrkesområdet (beslut 2026-10-09): avtalets aktiva avtalsområden i ordning, värdet är koden. Övrigt nämns i hjälptexten.
    expect(f.areas).toHaveLength(12);
    expect(f.areas[0]).toEqual({ value: "A", label: "Administration" });
    expect(f.areas.find((a) => a.value === "G")).toEqual({ value: "G", label: "Lager och logistik" });
    expect(f.otherAreaName).toBe("Övrigt");
    // Ett avtalsområde som inte är aktivt går inte att välja.
    rt.store.updateRow("contract_areas", "c-bot:K", { active: false });
    expect((await ask(kommunOrderForm, {}, maria())).areas.map((a) => a.value)).not.toContain("K");
    // Synpunkt #5, #8 och #11: ingen beställarreferens, inga yrkesspår och inga belopp.
    for (const key of ["lastBuyerRef", "buyerReference", "blockedRefs", "tracks", "weeks", "prices"]) expect(f).not.toHaveProperty(key);
    expect(JSON.stringify(f)).not.toMatch(/Ore"|4410023817|Truckförare|price/);
  });
  it("dubblettkontrollen: egen insats med nummer, andras insatser bara som att de finns", async () => {
    expect(await ask(kommunDuplicate, { pnr: "19730216-9545" }, maria())).toEqual([{ caseId: NADIA, caseNumber: "BOT-26-0143", status: "active" }]);
    expect(await ask(kommunDuplicate, { pnr: "20030516-9502" }, maria())).toEqual([{ caseId: null, caseNumber: null, status: null }]);
    expect(await ask(kommunDuplicate, { pnr: "1988041" }, maria())).toEqual([]);
  });
  it("kvittot: bara ärendenumret och svarstiden – mejlet med ordererkännandet innehåller bara ärendenumret", async () => {
    // Portalens beställning (beslut 2026-10-09): yrkesområde, ingen bostadsort och ingen kontaktväg – bara e-post här.
    const order = {
      source: "portal" as const, firstName: "Samira", lastName: "Testsson", pnr: "19880412-3456", email: "samira.testsson@example.invalid", primaryArea: "G",
      referrerUnit: "Arbetsmarknadsenheten Alby", orderPeriodMonths: 6, priorAssessment: "yes" as const, desiredStart: "2027-02-15",
    };
    const c = await run(caseCreate, order, maria());
    if (!c.ok) throw new Error(c.error);
    expect(c.caseNumber).toBe("BOT-27-0051");
    // Omfattningen: planerat slut räknas fram från önskat startdatum (6 månader).
    expect(rows("cases").find((x) => x.id === c.caseId)).toMatchObject({ orderPeriodMonths: 6, orderPeriodReason: null, priorAssessment: "yes", plannedEnd: "2027-08-14", buyerReference: null, primaryAreaCode: "G" });
    const r = await ask(kommunReceipt, { caseId: c.caseId }, maria());
    // Beslut 2026-10-09 ("Vi behöver inte visa så mycket till kommunens handläggare"): kvittot har bara ärendenumret och
    // när orderbekräftelsen kommer – inget mejl, ingen kontaktväg och inget yrkesområde.
    expect(r).toEqual({ caseId: c.caseId, caseNumber: "BOT-27-0051", avropDue: expect.any(String) });
    // Mejlet med ordererkännandet går till handläggaren och innehåller bara ärendenumret (CLAUDE.md punkt 9).
    const mail = rows("outbound_messages").filter((m) => m.caseId === c.caseId && m.template === "ordererkannande").pop();
    expect(mail).toMatchObject({ to: "maria.ekdahl@botkyrka.se" });
    expect(mail?.body).toContain("BOT-27-0051");
    expect(mail?.body).not.toMatch(/Samira|Testsson|3456|example|Lager/);
    // Utan telefonnummer går kallelsen med e-post.
    expect(rows("persons").find((x) => x.id === rows("cases").find((y) => y.id === c.caseId)!.personId)?.preferredContact).toBe("email");
    // Någon annans kvitto finns inte
    expect(await ask(kommunReceipt, { caseId: NADIA }, as("k-linda", "kommun_handlaggare"))).toBeNull();
  });
  it("formulärets krav på servern: omfattning, enhet, yrkesområde och kartläggning – annan tidsperiod kräver slutdatum och motivering", async () => {
    const base = { source: "portal" as const, firstName: "Kim", lastName: "Testsson", pnr: "19900303-1234", referrerUnit: "Arbetsmarknadsenheten Alby", priorAssessment: "no" as const, desiredStart: "2027-02-15", primaryArea: "F" };
    expect(await run(caseCreate, { ...base }, maria())).toMatchObject({ ok: false, error: "order_period" });
    expect(await run(caseCreate, { ...base, orderPeriodMonths: 9 }, maria())).toMatchObject({ ok: false, error: "order_period", message: "Välj en av omfattningarna i avtalet." });
    expect(await run(caseCreate, { ...base, orderPeriodMonths: 6, referrerUnit: " " }, maria())).toMatchObject({ ok: false, error: "unit" });
    expect(await run(caseCreate, { ...base, orderPeriodMonths: 6, priorAssessment: null }, maria())).toMatchObject({ ok: false, error: "prior_assessment" });
    // "Vet inte" finns inte längre i portalen (beslut 2026-10-09) – bara ja eller nej tas emot från kommunen.
    expect(await run(caseCreate, { ...base, orderPeriodMonths: 6, priorAssessment: "unknown" }, maria())).toMatchObject({ ok: false, error: "prior_assessment" });
    // Yrkesområdet är obligatoriskt och måste vara ett av avtalets aktiva avtalsområden.
    expect(await run(caseCreate, { ...base, orderPeriodMonths: 6, primaryArea: undefined }, maria())).toMatchObject({ ok: false, error: "area" });
    expect(await run(caseCreate, { ...base, orderPeriodMonths: 6, primaryArea: " " }, maria())).toMatchObject({ ok: false, error: "area" });
    expect(await run(caseCreate, { ...base, orderPeriodMonths: 6, primaryArea: "Z" }, maria())).toMatchObject({ ok: false, error: "area" });
    rt.store.updateRow("contract_areas", "c-bot:K", { active: false });
    expect(await run(caseCreate, { ...base, orderPeriodMonths: 6, primaryArea: "K" }, maria())).toMatchObject({ ok: false, error: "area" });
    expect(await run(caseCreate, { ...base, plannedEnd: "2027-05-31" }, maria())).toMatchObject({ ok: false, error: "order_period" });
    const other = await run(caseCreate, { ...base, plannedEnd: "2027-05-31", orderPeriodReason: "Deltagaren flyttar i juni." }, maria());
    if (!other.ok) throw new Error(other.error);
    expect(rows("cases").find((x) => x.id === other.caseId)).toMatchObject({ orderPeriodMonths: null, orderPeriodReason: "Deltagaren flyttar i juni.", plannedEnd: "2027-05-31", priorAssessment: "no" });
    expect(rows("cases").find((x) => x.id === other.caseId)).toMatchObject({ primaryAreaCode: "F" });
    // Inget i formuläret ger skyddade personuppgifter, en beställarreferens, ett alternativt område eller ett yrkesspår.
    const extra = await run(caseCreate, { ...base, pnr: "19910404-2345", orderPeriodMonths: 12, protectedIdentity: true, buyerReference: "4410023817", primaryArea: "G", secondaryArea: "F", vocationalTrack: "Truckförare A+B" } as never, maria());
    if (!(extra as { ok: boolean }).ok) throw new Error("ingen beställning");
    const cx = rows("cases").find((x) => x.id === (extra as { caseId: string }).caseId)!;
    expect(cx).toMatchObject({ buyerReference: null, primaryAreaCode: "G", secondaryAreaCode: null, vocationalTrack: "", orderPeriodMonths: 12 });
    const px = rows("persons").find((x) => x.id === cx.personId)!;
    expect(px.protectedIdentity).toBe(false);
    // Varken telefon eller e-post i beställningen: kontaktvägen blir telefon (Miljonbemanning kontaktar deltagaren), ingen ort.
    expect(px).toMatchObject({ preferredContact: "phone", city: "", address: null });
  });
  it("bara handläggaren beställer i portalen", async () => {
    await expectForbidden(ask(kommunOrderForm, {}, sara()));
    await expectForbidden(ask(kommunStart, {}, sara()));
    await expectForbidden(ask(kommunProfile, {}, sara()));
  });
});

describe("kommandon (prototypens kom.*)", () => {
  it("kom.caseSeen: en avböjd beställning räknas som sedd när ärendet har öppnats (startsidan visar inga händelser sedan 2026-10-09)", async () => {
    await run(caseDecline, { caseId: MALL, reason: "Ingen ledig plats." }, sara());
    let d = (await ask(kommunCase, { caseId: MALL }, maria())) as KomCaseDetail;
    expect(d.unseenEvents).toBe(1);
    const before = rt.clock.now();
    expect(await run(kommunCaseSeen, { caseId: MALL }, maria())).toEqual({ ok: true });
    expect(rt.clock.now(), "tyst kommando flyttar inte klockan").toBe(before);
    expect(rows("case_seen")).toContainEqual({ id: `k-maria:${MALL}`, userId: "k-maria", caseId: MALL, seenAt: before });
    d = (await ask(kommunCase, { caseId: MALL }, maria())) as KomCaseDetail;
    expect(d.unseenEvents).toBe(0);
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
  it("meddelanden: handläggaren som beställde skriver – en annan handläggare når inte ärendet", async () => {
    const r = await run(messageSend, { caseId: NADIA, body: "Hej Amira!" }, maria());
    expect(r.ok).toBe(true);
    const d = (await ask(kommunCase, { caseId: NADIA }, maria())) as KomCaseDetail;
    expect(d.canWrite).toBe(true);
    expect(d.messages?.at(-1)).toMatchObject({ senderLabel: "Du", mine: true, read: false, body: "Hej Amira!" });
    expect(await ask(kommunCase, { caseId: NADIA }, omar())).toEqual({ kind: "denied" });
  });
});

describe("Mina uppgifter (kommun.profil)", () => {
  it("visar namn, telefon, enhet och e-postadress – och om något saknas", async () => {
    expect(await ask(kommunProfile, {}, maria())).toEqual({
      name: "Maria Ekdahl", email: "maria.ekdahl@botkyrka.se", phone: "08-530 000 11", unit: "Arbetsmarknadsenheten Alby", customerName: "Botkyrka kommun", incomplete: false,
    });
    rt.store.updateRow("profiles", "k-maria", { customerUnit: null });
    expect((await ask(kommunProfile, {}, maria())).incomplete).toBe(true);
  });
  it("sparar egna uppgifter – kontrollerar på servern och loggar bara fältnamnen", async () => {
    expect(await run(kommunProfileSave, { fullName: "M", phone: "08-530 000 11", unit: "Alby" }, maria())).toMatchObject({ ok: false, error: "name" });
    expect(await run(kommunProfileSave, { fullName: "Maria Ekdahl", phone: "123", unit: "Alby" }, maria())).toMatchObject({ ok: false, error: "phone" });
    expect(await run(kommunProfileSave, { fullName: "Maria Ekdahl", phone: "08-530 000 11", unit: "  " }, maria())).toMatchObject({ ok: false, error: "unit" });
    expect(await run(kommunProfileSave, { fullName: "Maria Ekdahl", phone: "08-530 000 11", unit: "Arbetsmarknadsenheten Alby" }, maria())).toEqual({ ok: true, changed: [] });
    expect(rows("audit_log").some((x) => x.action === "profile.updated")).toBe(false);
    expect(await run(kommunProfileSave, { fullName: "Maria  Ekdahl Berg", phone: "070-111 22 33", unit: "Arbetsmarknadsenheten  Alby" }, maria())).toEqual({ ok: true, changed: ["fullName", "phone"] });
    expect(rows("profiles").find((x) => x.id === "k-maria")).toMatchObject({ fullName: "Maria Ekdahl Berg", phone: "070-111 22 33", customerUnit: "Arbetsmarknadsenheten Alby" });
    const log = rows("audit_log").filter((x) => x.action === "profile.updated");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: "k-maria", entity: "profile", entityId: "k-maria", details: { fields: ["fullName", "phone"] } });
    expect(JSON.stringify(log[0])).not.toMatch(/070|Berg/);
  });
});
