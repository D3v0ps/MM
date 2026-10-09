// Tester för området inkorg: vy-modellerna (startsidan, inkorgen, förfaller), sidopanelens räknare och områdets kommandon.
// Förväntade värden är den gamla prototypens (prototyp/src/views/inkorg.js med samma testdata och demoklocka),
// hämtade med MM.sel.inboxToHandle, MM.sel.deadlines, MM.sel.alerts, sel.unregistered och sel.unreadNotifications.
// Beslut 2026-10-07: skyddade personuppgifter är borttagna ur appen – em-104 är en vanlig fråga (Övrigt) utan flagga,
// generisk bekräftelse eller telefonregistrering, och beställningen anger omfattningen i månader (inte veckor).
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import type { MemoryData } from "@/data/memory";
import { createSeed, DEMO_START } from "@/data/seed";
import type { TableName, Tables } from "@/data/schema";
import { caseAccept } from "@/features/arenden/api";
import { navCounts } from "@/features/session/nav-api";
import {
  emailApplySupplement, inboxConfirmation, inboxCorrect, inboxDeadlines, inboxDecisionForm, inboxDuplicateCheck, inboxItem, inboxList, inboxRegister, inboxRegisterForm,
  inboxRevealPnr, inboxStart, inboxTaskDone,
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
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const rows = <N extends TableName>(name: N): Tables[N][] => rt.store.rows(name);
const row = <N extends TableName>(name: N, id: string): Tables[N] | undefined => rt.raw().get(name, id);

const sara = () => as("u-sara", "samordnare");
const johan = () => as("u-johan", "avtalsansvarig");
const karin = () => as("u-karin", "chef");
const amira = () => as("u-amira", "coach");

// Den gamla prototypens värden vid demostart (måndag 1 februari 2027 kl. 09.12) – med em-104 som en vanlig fråga: den
// sorteras efter mottagningstiden (inte först som skyddat avrop) och ger ingen flagga till avtalsansvarig.
const OLD_PENDING = ["em-106", "em-102", "em-103", "em-101", "em-104", "em-105"];
const OLD_ALERTS_SAM = [
  "overdue:rep-16356", "nomeeting:case-270039", "stuck:case-270012:1", "stuck:case-260128:3", "kpi:manadsrapporter_i_tid:2027-01",
  "kpi:forsta_mote_inom_en_vecka:2027-01", "kpi:avrop_besvarade_i_tid:2027-01", "absence:case-260148:at-12691", "pulse_contact:pr-17026", "pulse_contact:pr-17000",
  "pulse_contact:pr-16983",
];
const OLD_DL_FIRST = ["rep:rep-16356", "reg:u-amira", "avrop:case-270048", "avrop:case-270049", "rep:rep-16692", "rep:rep-16694", "avrop:case-270050", "fm:case-270039", "bill:2027-01", "dev:dev-14317", "cd:cd-2", "rep:rep-15642"];

describe("sidopanelens räknare (navCounts)", () => {
  it("samma tal som prototypens navCount och olästa notiser", async () => {
    expect(await q(navCounts, {}, sara())).toEqual({ inbox: 6, deadlines: 6, unregistered: 0, notifications: 0 });
    expect(await q(navCounts, {}, johan())).toEqual({ inbox: 6, deadlines: 6, unregistered: 0, notifications: 0 });
    expect(await q(navCounts, {}, karin())).toEqual({ inbox: 0, deadlines: 6, unregistered: 0, notifications: 3 });
    expect(await q(navCounts, {}, amira())).toEqual({ inbox: 0, deadlines: 0, unregistered: 6, notifications: 4 });
  });
});

describe("avropsinkorgen", () => {
  it("fliken Att hantera: samma poster och ordning som prototypens sel.inboxToHandle", async () => {
    const l = await q(inboxList, {}, sara());
    expect(l.pending).toEqual(OLD_PENDING);
    expect(l.ackMinutes).toBe(5);
    expect(l.answerText).toBe("en arbetsdag");
    expect(l.rows).toHaveLength(27);
    expect(l.handled).toHaveLength(21);
    const r = l.rows.find((x) => x.id === "em-106");
    expect(r).toMatchObject({ caseNumber: "BOT-27-0048", receivedWhen: "fre 29 jan kl. 10.05", from: "Linda Karlsson", method: "template", sla: { dueAt: "2027-02-01T10:05", sla: { label: "53 min kvar", tone: "urgent" } } });
    // Beställarreferensen fylls i av Miljonbemanning (beslut 2026-10-07) – mejlet saknar bara omfattningen.
    expect(l.rows.find((x) => x.id === "em-102")?.missing).toEqual(["omfattning"]);
    expect(l.rows.find((x) => x.id === "em-104")).toMatchObject({ cls: "other", subject: "Fråga om startdatum", sla: null, missing: [] });
    expect(l.rows.find((x) => x.id === "em-104")).not.toHaveProperty("isProtected");
  });

  it("em-102 (AI – fritext): maskerat personnummer, osäkra fält och saknad beställarreferens", async () => {
    const d = await q(inboxItem, { id: "em-102" }, sara());
    expect(d?.body.kind).toBe("order");
    if (d?.body.kind !== "order") return;
    expect(d.steps).toEqual(["Mottaget", "Ordererkännande", "Beslut", "Orderbekräftelse"]);
    expect(d.current).toBe(2);
    expect(d.headSla?.text).toBe("Svar senast i dag kl. 15.20");
    expect(d.body.original?.body).toContain("(••••••••-5223)");
    expect(d.body.original?.body).not.toContain("19750312");
    expect(d.body.parsed).toMatchObject({ nMissing: 1, nLow: 2, aiRun: "Tolkat av Berget AI (test) på 6 s." });
    const pnr = d.body.parsed?.groups[1].fields.find((f) => f.key === "pnr");
    expect(pnr?.pnr).toMatchObject({ masked: "••••••••-5223", hidden: false });
    // Omfattningen saknas men stoppar inte beslutet (den väljs i beslutsdialogen); referensen är valfri vid accept.
    expect(d.body.missing).toEqual({ title: "Saknas: omfattning", critical: false, text: "Ordererkännandet bad kommunen svara med uppgifterna (fre 29 jan kl. 15.23)." });
    expect(d.correct).toMatchObject({ periods: { months: [6, 12], allowOther: true }, init: { orderPeriod: "" } });
    expect(d.body.pendingSups).toEqual([{ id: "em-103", fromName: "Ahmed Yusuf", when: "i dag kl. 08.02" }]);
    expect(d.body.ack).toMatchObject({ kind: "sent", mins: 3, ok: true, leak: false });
    expect(JSON.stringify(d)).not.toContain("19750312");
  });

  it("em-104 är en vanlig fråga (Övrigt): ingen flagga, ingen generisk bekräftelse och ingen telefonregistrering", async () => {
    const d = await q(inboxItem, { id: "em-104" }, sara());
    expect(d).toMatchObject({ cls: "other", status: "other", subject: "Fråga om startdatum", steps: null, decision: false, correct: null });
    for (const key of ["isProtected", "mine", "canPhone"]) expect(d).not.toHaveProperty(key);
    expect(d?.body.kind).toBe("other");
    if (d?.body.kind !== "other") return;
    expect(d.body.original?.body).toContain("När kan ni ta emot nästa deltagare");
    // Samma vy för avtalsansvarig – ingen särskild väg för skyddade avrop.
    expect(await q(inboxItem, { id: "em-104" }, johan())).toMatchObject({ cls: "other", body: { kind: "other" } });
    // Inget utskick (generisk bekräftelse) och ingen uppgift till avtalsansvarig.
    expect(rows("outbound_messages").some((m) => m.template === "generisk_mottagningsbekraftelse")).toBe(false);
    expect(rows("tasks").some((t) => t.kind === "protected_order")).toBe(false);
  });

  it("ärendet i Förfaller och startsidan: 96 förfallotider, samma ordning som prototypen", async () => {
    const v = await q(inboxDeadlines, {}, karin());
    expect(v.rows).toHaveLength(96);
    expect(["overdue", "today", "week"].map((b) => v.rows.filter((x) => x.bucket === b).length)).toEqual([1, 5, 90]);
    expect(v.rows.slice(0, 12).map((x) => x.id)).toEqual(OLD_DL_FIRST);
    expect(v.eyebrow).toBe("måndag 1 februari · v. 5");
    expect(v.unsetText).toBe("månadsrapport – förslag: 5:e arbetsdagen efter månadsskiftet; slutrapport – förslag: 5 arbetsdagar");
    const first = v.rows[0];
    expect(first).toMatchObject({ kind: "slutrapport", ownerName: "Leila Nouri", chain: ["Coach", "Samordnare", "Chef"], step: 2, sla: { label: "Försenad 2 dagar", tone: "over" } });
    expect(v.rows.find((x) => x.id === "avrop:case-270048")).toMatchObject({ ownerName: "Samordnare · Sara Lindqvist", href: null });
    const sam = await q(inboxDeadlines, {}, sara());
    expect(sam.rows.find((x) => x.id === "avrop:case-270048")?.href).toBe("/inkorg?arende=case-270048");
  });

  it("startsidan: flaggor, första möten, uppgifter och nyckeltal som i prototypen", async () => {
    const s = await q(inboxStart, {}, sara());
    expect(s.lead).toBe("God morgon, Sara! Måndag 1 februari, v. 5. Det mest brådskande står först.");
    expect(s.items.map((x) => x.id)).toEqual(OLD_PENDING);
    expect(s.urgent?.id).toBe("em-106");
    expect(s.alerts.map((a) => a.key)).toEqual(OLD_ALERTS_SAM);
    expect(s.firstMeetings.rows.map((r) => r.caseNumber)).toEqual(["BOT-27-0039"]);
    expect(s.firstMeetings.rows[0].sub).toBe("Coach Sofia Grahn · mottaget 26 jan 2027 · flaggat efter tre dagar");
    expect(s.deadlines).toMatchObject({ soonCount: 6, overdue: 1, weekCount: 90 });
    expect(s.deadlines.week).toHaveLength(3);
    expect(s.tasks).toEqual([]);
    expect(s.kpis.map((k) => [k.label, k.value, k.sub])).toEqual([
      ["Avrop besvarade inom en arbetsdag", "95,7\u00a0%", "45 av 47 · januari 2027"],
      ["Första möte inom en vecka", "93,5\u00a0%", "43 av 46 · januari 2027"],
    ]);
    expect(s.noCoach.map((r) => r.caseNumber)).toEqual(["BOT-27-0048", "BOT-27-0049", "BOT-27-0050"]);
    expect(s.assign.latest.map((n) => `${n.name} · ${n.caseNumber}`)).toEqual(["Leila Nouri · BOT-27-0047", "Mats Holm · BOT-27-0046", "Petra Ek · BOT-27-0046"]);
    const j = await q(inboxStart, {}, johan());
    expect(j.tasks).toEqual([]);
    expect(j).not.toHaveProperty("protectedItems");
    // Inga viten i kronor – belopp syns bara för ekonomen (beslut 5, 2026-10-07).
    expect(j.warnings.text).toBe("3 varningar kan leda till uppsägning.");
  });
});

describe("områdets kommandon", () => {
  it("ink.correct: omfattningen rättad till 6 månader, övrigt kontrollerat (em-102)", async () => {
    const c = row("cases", "case-270049");
    expect(c?.orderPeriodMonths).toBeNull();
    const res = await run(inboxCorrect, { caseId: "case-270049", emailId: "em-102", patch: { orderPeriod: "6" }, checked: ["desiredStart", "orderPeriod"] }, sara());
    expect(res).toEqual({ ok: true, changed: ["orderPeriod"] });
    expect(row("cases", "case-270049")).toMatchObject({ orderPeriodMonths: 6, orderPeriodReason: null });
    const e = row("inbound_emails", "em-102");
    expect(e?.corrections.orderPeriod).toMatchObject({ by: "u-sara", changed: true, from: "" });
    expect(e?.corrections.desiredStart).toMatchObject({ changed: false });
    expect(e?.confidence.orderPeriod).toBe(1);
    expect(e?.missingFields).toEqual([]);
    // Bara avtalets omfattningar: 9 månader stoppas.
    expect(await run(inboxCorrect, { caseId: "case-270049", patch: { orderPeriod: "9" }, checked: [] }, sara())).toMatchObject({ ok: false, error: "order_period" });
    const d = await q(inboxItem, { id: "em-102" }, sara());
    const notes = d?.body.kind === "order" ? d.body.parsed?.groups.flatMap((g) => g.fields).map((f) => f.note?.kind) : [];
    expect(notes).toContain("corrected");
    expect(notes).toContain("checked");
    expect(await run(inboxCorrect, { caseId: "case-270049", patch: { buyerReference: "12" }, checked: [] }, sara())).toMatchObject({ ok: false, error: "buyer_ref" });
  });

  it("kompletteringen förs in och avropet accepteras (em-103 → em-102)", async () => {
    expect(await run(emailApplySupplement, { emailId: "em-103" }, sara())).toMatchObject({ ok: true });
    const f = await q(inboxDecisionForm, { caseId: "case-270049" }, sara());
    expect(f).toMatchObject({ caseNumber: "BOT-27-0049", buyerReference: "55102938", pendingSup: null, defaultDate: "2027-02-03", meetingText: "en vecka" });
    expect(f?.coaches.map((x) => x.name)).toContain("Leila Nouri");
    // Kompletteringen gav omfattningen (6 månader) och referensen – avtalsområde och yrkesspår väljs av Miljonbemanning.
    expect(row("cases", "case-270049")).toMatchObject({ orderPeriodMonths: 6, buyerReference: "55102938" });
    expect(await run(caseAccept, { caseId: "case-270049", leadCoachId: "u-leila", firstMeetingAt: "2027-02-03T10:00", primaryArea: "G", vocationalTrack: "Kök och restaurang" }, sara())).toMatchObject({ ok: true });
    expect(row("cases", "case-270049")).toMatchObject({ orderPeriodMonths: 6, plannedEnd: "2027-08-02", primaryAreaCode: "G" });
    const conf = await q(inboxConfirmation, { caseId: "case-270049" }, sara());
    expect(conf).toMatchObject({ caseNumber: "BOT-27-0049", coachName: "Leila Nouri", team: "Bara huvudcoach", buyerReference: "55102938", leadNotif: { title: "Leila Nouri har fått en notis om tilldelningen" } });
    expect(conf?.confirmed).toMatch(/^i dag kl\. 09\.\d\d av Sara Lindqvist$/);
    expect((await q(inboxList, {}, sara())).pending).toEqual(["em-106", "em-101", "em-104", "em-105"]);
  });

  it("dubblettkontrollen i registreringen: bara ja eller nej", async () => {
    expect(await q(inboxDuplicateCheck, { pnr: "19880412-1234" }, johan())).toEqual({ duplicate: false });
    expect(await q(inboxDuplicateCheck, { pnr: "19750312-5223" }, sara())).toEqual({ duplicate: true });
  });

  it("ink.taskDone och Visa personnummer (loggas)", async () => {
    // En uppgift till avtalsansvarig (testdatat har ingen sedan uppgiften om det skyddade avropet togs bort).
    rt.store.insertRow("tasks", { ...row("tasks", "task-1")!, id: "task-x-johan", toRole: "avtalsansvarig", toId: "u-johan", fromId: "system", caseIds: [], status: "open", doneBy: null, doneAt: null });
    expect(await run(inboxTaskDone, { taskId: "task-x-johan" }, johan())).toEqual({ ok: true });
    expect(row("tasks", "task-x-johan")).toMatchObject({ status: "done", doneBy: "u-johan" });
    expect(await run(inboxTaskDone, { taskId: "task-x-johan" }, sara())).toMatchObject({ ok: false, error: "not_found" });
    const before = rt.clock.now();
    const r = await run(inboxRevealPnr, { emailId: "em-102" }, sara());
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.text).toContain("19750312-5223");
    expect(rows("audit_log").slice(-1)[0]).toMatchObject({ action: "pnr.revealed", entity: "inbound_email", entityId: "em-102", actorId: "u-sara", details: { caseId: "case-270049" } });
    const p = await run(inboxRevealPnr, { caseId: "case-270049" }, sara());
    expect(p).toEqual({ ok: true, text: "19750312-5223" });
    // Visningen är tyst: demoklockan står still.
    expect(rt.clock.now()).toBe(before);
  });
});

// ---------------------------------------------------------------- Registrera beställning (beslut 4a, 2026-10-08)
describe("registrera beställning (mejl, telefon eller annan väg)", () => {
  const PHONE_ORDER = {
    channel: "phone" as const, receivedAt: "2027-02-01T08:30", referrerId: null, referrerName: "Anna Ny", referrerEmail: "Anna.Ny@botkyrka.se", referrerUnit: "Arbetsmarknadsenheten Tumba", referrerPhone: "08-530 000 00",
    firstName: "Test", lastName: "Telefonsson", pnr: "19930303-1111", phone: "070-000 00 00", email: "", city: "Tumba", address: null, preferredContact: "sms" as const,
    desiredStart: "2027-02-15", orderPeriodMonths: 6, plannedEnd: null, orderPeriodReason: null, priorAssessment: "no" as const, background: "Vill jobba i lager.", buyerReference: "", attachmentIds: [],
  };

  it("formulärets underlag: kommunens handläggare, domäner, omfattningar och bilageregler – inget personnummer", async () => {
    const f = await q(inboxRegisterForm, {}, sara());
    expect(f).toMatchObject({ today: "2027-02-01", now: "2027-02-01T09:12", customerName: "Botkyrka kommun", customerDomains: ["botkyrka.se"], periods: { months: [6, 12], allowOther: true }, answerText: "en arbetsdag", email: null });
    expect(f.handlers.map((h) => h.id)).toContain("k-maria");
    expect(f.attachments.maxFiles).toBe(10);
    expect(JSON.stringify(f)).not.toMatch(/\d{8}-\d{4}/);
  });

  it("per telefon utan konto: rad i inbound_emails, ärendet med handläggarens uppgifter, ordererkännande och logg", async () => {
    const res = await run(inboxRegister, PHONE_ORDER, sara());
    expect(res).toMatchObject({ ok: true, caseNumber: "BOT-27-0051" });
    if (!res.ok) return;
    const c = row("cases", res.caseId)!;
    expect(c).toMatchObject({ source: "phone", status: "acknowledged", referredAt: "2027-02-01T08:30", referrerId: null, referrerName: "Anna Ny", referrerEmail: "anna.ny@botkyrka.se", referrerUnit: "Arbetsmarknadsenheten Tumba", sourceEmailId: res.emailId, orderPeriodMonths: 6, plannedEnd: "2027-08-14" });
    const m = row("inbound_emails", res.emailId)!;
    expect(m).toMatchObject({ parseMethod: "manual", classification: "order", status: "acknowledged", caseId: res.caseId, registeredBy: "u-sara", registeredAt: "2027-02-01T09:13", receivedAt: "2027-02-01T08:30", fromAddress: "anna.ny@botkyrka.se", subject: "Beställning per telefon", bodyText: "", graphMessageId: `manual:${res.emailId}` });
    // Ordererkännandet går till handläggarens adress (utan konto) och innehåller bara ärendenumret.
    const out = rows("outbound_messages").filter((x) => x.caseId === res.caseId && x.template === "ordererkannande");
    expect(out).toHaveLength(1);
    expect(out[0].to).toBe("anna.ny@botkyrka.se");
    expect(out[0].body).toContain("BOT-27-0051");
    expect(out[0].body).not.toMatch(/Telefonsson|19930303/);
    // Loggen: id:n och kanal – inga personuppgifter.
    const log = rows("audit_log").filter((a) => a.action === "email.registered");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity: "inbound_email", entityId: res.emailId, actorId: "u-sara", details: { caseId: res.caseId, number: "BOT-27-0051", channel: "phone", linkedProfile: false } });
    expect(JSON.stringify(rows("audit_log"))).not.toMatch(/Telefonsson|anna\.ny|19930303/);
    // Inkorgen: posten väntar på beslut med svarstiden från mottagandet, ärendets uppgifter i stället för en tolkning.
    const l = await q(inboxList, {}, sara());
    // Mest brådskande först: svarstiden räknas från mottagandet (08.30 i dag → i morgon 08.30), så dagens äldre avrop ligger före.
    expect(l.pending).toContain(res.emailId);
    expect(l.pending.indexOf(res.emailId)).toBeGreaterThan(l.pending.indexOf("em-106"));
    expect(l.rows.find((x) => x.id === res.emailId)).toMatchObject({ kind: "email", method: "phone", caseNumber: "BOT-27-0051", from: "Anna Ny", sla: { dueAt: "2027-02-02T08:30" } });
    const d = await q(inboxItem, { id: res.emailId }, sara());
    expect(d).toMatchObject({ decision: true, method: "phone", handledText: "Registrerad av Sara Lindqvist i dag kl. 09.13" });
    expect(d?.body.kind).toBe("order");
    if (d?.body.kind !== "order") return;
    expect(d.body.original).toBeNull();
    expect(d.body.parsed).toBeNull();
    expect(d.body.caseFields).toMatchObject({ method: "phone" });
    expect(d.body.caseFields?.groups[0].fields.map((f) => [f.label, f.value])).toEqual(expect.arrayContaining([["Handläggare", "Anna Ny"], ["Enhet", "Arbetsmarknadsenheten Tumba"], ["Omfattning", "6 månader"]]));
    expect(d.body.ack).toMatchObject({ kind: "sent", ok: true, registered: true });
    expect(d.body.register).toBeNull();
    expect(JSON.stringify(d)).not.toContain("19930303");
    // Vanligt flöde efteråt: acceptera.
    expect(await run(caseAccept, { caseId: res.caseId, leadCoachId: "u-leila", firstMeetingAt: "2027-02-03T10:00", primaryArea: "G", vocationalTrack: "Lager" }, sara())).toMatchObject({ ok: true });
  });

  it("handläggare med konto kopplas direkt; en adress utanför kommunens domän stoppas; annan väg sparas som 'other'", async () => {
    const res = await run(inboxRegister, { ...PHONE_ORDER, channel: "other", referrerId: "k-maria", referrerName: "", referrerEmail: "", referrerUnit: "", pnr: "19930303-2222" }, johan());
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) return;
    expect(row("cases", res.caseId)).toMatchObject({ source: "other", referrerId: "k-maria", referrerEmail: "maria.ekdahl@botkyrka.se", referrerUnit: "Arbetsmarknadsenheten Alby" });
    expect(row("inbound_emails", res.emailId)).toMatchObject({ subject: "Beställning registrerad av Miljonbemanning", fromName: "Maria Ekdahl" });
    expect((await q(inboxList, {}, sara())).rows.find((x) => x.id === res.emailId)?.method).toBe("registered");
    expect(await run(inboxRegister, { ...PHONE_ORDER, referrerEmail: "anna@gmail.com", pnr: "19930303-3333" }, sara())).toMatchObject({ ok: false, error: "referrer" });
    expect(await run(inboxRegister, { ...PHONE_ORDER, referrerEmail: "maria.ekdahl@botkyrka.se", pnr: "19930303-4444" }, sara())).toMatchObject({ ok: true });
    expect(rows("cases").at(-1)).toMatchObject({ referrerId: "k-maria" });
    expect(await run(inboxRegister, { ...PHONE_ORDER, receivedAt: "2027-02-01T12:00", pnr: "19930303-5555" }, sara())).toMatchObject({ ok: false, error: "received_at" });
    expect(await run(inboxRegister, { ...PHONE_ORDER, pnr: "19750312-5223" }, sara())).toMatchObject({ ok: false, error: "duplicate" });
  });

  it("ett inläst mejl utan ärende: förifyllning (personnumret bara maskerat) och registrering med numret ur mejlet", async () => {
    rt.store.insertRow("inbound_emails", {
      id: "em-ny", graphMessageId: "<ny@botkyrka.se>", receivedAt: "2027-02-01T08:50", fromAddress: "ahmed.yusuf@botkyrka.se", fromName: "Ahmed Yusuf", subject: "Ny deltagare",
      bodyText: "Hej! Jag vill anvisa Samir Test (19940404-6666) till er. /Ahmed", attachments: [], parseMethod: "manual", classification: "order",
      extracted: { pnr: "19940404-6666" }, confidence: { pnr: 0.5 }, missingFields: ["desiredStart", "orderPeriod", "firstName", "lastName"], corrections: {}, status: "received",
      caseId: null, ackSentAt: null, ackKind: null, aiRunId: null, linkedBy: null, registeredBy: null, registeredAt: null, handledBy: null, handledAt: null,
    });
    const before = await q(inboxItem, { id: "em-ny" }, sara());
    expect(before?.body.kind === "order" && before.body.register).toMatchObject({ emailId: "em-ny" });
    const f = await q(inboxRegisterForm, { emailId: "em-ny" }, sara());
    expect(f.email).toMatchObject({ id: "em-ny", from: "Ahmed Yusuf", prefill: { referrerEmail: "ahmed.yusuf@botkyrka.se", referrerName: "Ahmed Yusuf", pnrMasked: "••••••••-6666" } });
    expect(JSON.stringify(f)).not.toContain("19940404");
    const res = await run(inboxRegister, { ...PHONE_ORDER, emailId: "em-ny", referrerId: "k-ahmed", referrerName: "", referrerEmail: "", referrerUnit: "", firstName: "Samir", lastName: "Test", pnr: "" }, sara());
    expect(res).toMatchObject({ ok: true, emailId: "em-ny" });
    if (!res.ok) return;
    expect(row("inbound_emails", "em-ny")).toMatchObject({ caseId: res.caseId, status: "acknowledged", registeredBy: "u-sara", missingFields: [] });
    expect(row("cases", res.caseId)).toMatchObject({ source: "email", sourceEmailId: "em-ny", referrerId: "k-ahmed", referredAt: "2027-02-01T08:30" });
    expect(row("persons", row("cases", res.caseId)!.personId)).toMatchObject({ personnummerLast4: "6666", firstName: "Samir" });
    const after = await q(inboxItem, { id: "em-ny" }, sara());
    expect(after?.body.kind === "order" && after.body).toMatchObject({ register: null, caseFields: { method: "registered" }, parsed: null });
    expect(after?.body.kind === "order" && after.body.original?.body).toContain("••••••••-6666");
    // Samma mejl kan inte registreras två gånger.
    expect(await run(inboxRegister, { ...PHONE_ORDER, emailId: "em-ny", pnr: "19940404-7777" }, sara())).toMatchObject({ ok: false, error: "email" });
  });

  it("när handläggaren skapar konto kopplas ärendet via e-postadressen", async () => {
    const res = await run(inboxRegister, PHONE_ORDER, sara());
    if (!res.ok) throw new Error(res.error);
    const reg = await rt.selfRegister("anna.ny@botkyrka.se");
    expect(reg).toMatchObject({ ok: true, linkedCases: 1 });
    if (!reg.ok) return;
    expect(row("cases", res.caseId)).toMatchObject({ referrerId: reg.profileId, referrerName: "Anna Ny" });
    expect(rows("audit_log").at(-1)).toMatchObject({ action: "profile.self_registered", details: { linkedCases: 1 } });
  });
});
