// Tester för området inkorg: vy-modellerna (startsidan, inkorgen, förfaller), sidopanelens räknare och områdets kommandon.
// Förväntade värden är den gamla prototypens (prototyp/src/views/inkorg.js med samma testdata och demoklocka),
// hämtade med MM.sel.inboxToHandle, MM.sel.deadlines, MM.sel.alerts, sel.unregistered och sel.unreadNotifications.
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import type { MemoryData } from "@/data/memory";
import { createSeed, DEMO_START } from "@/data/seed";
import type { TableName, Tables } from "@/data/schema";
import { caseAccept, caseCreate } from "@/features/arenden/api";
import { navCounts } from "@/features/session/nav-api";
import {
  emailApplySupplement, inboxConfirmation, inboxCorrect, inboxDeadlines, inboxDecisionForm, inboxDuplicateCheck, inboxItem, inboxLinkPhoneOrder, inboxList,
  inboxPhoneForm, inboxRevealPnr, inboxStart, inboxTaskDone,
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

// Den gamla prototypens värden vid demostart (måndag 1 februari 2027 kl. 09.12).
const OLD_PENDING = ["em-106", "em-102", "em-103", "em-104", "em-101", "em-105"];
const OLD_ALERTS_SAM = [
  "protected:em-104", "overdue:rep-16356", "nomeeting:case-270039", "stuck:case-270012:1", "stuck:case-260128:3", "kpi:manadsrapporter_i_tid:2027-01",
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
    expect(l.rows.find((x) => x.id === "em-102")?.missing).toEqual(["beställarreferens", "planerat slutdatum"]);
    expect(l.rows.find((x) => x.id === "em-104")).toMatchObject({ isProtected: true, sla: { sla: { label: "Senast 2 feb kl. 07.55" } } });
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
    expect(d.body.parsed).toMatchObject({ nMissing: 2, nLow: 3, aiRun: "Tolkat av Berget AI (test) på 6 s." });
    const pnr = d.body.parsed?.groups[1].fields.find((f) => f.key === "pnr");
    expect(pnr?.pnr).toMatchObject({ masked: "••••••••-5223", hidden: false });
    expect(d.body.missing).toEqual({ title: "Saknas: beställarreferens, planerat slutdatum", critical: true, text: "Ordererkännandet bad kommunen svara med uppgifterna (fre 29 jan kl. 15.23). Ärendet kan inte bekräftas utan giltig beställarreferens." });
    expect(d.body.pendingSups).toEqual([{ id: "em-103", fromName: "Ahmed Yusuf", when: "i dag kl. 08.02" }]);
    expect(d.body.ack).toMatchObject({ kind: "sent", mins: 3, ok: true, leak: false });
    expect(JSON.stringify(d)).not.toContain("19750312");
  });

  it("em-104 som samordnare: ingen registrering, ingen AI och inga personuppgifter", async () => {
    const d = await q(inboxItem, { id: "em-104" }, sara());
    expect(d).toMatchObject({ isProtected: true, mine: false, canPhone: false, steps: ["Mottaget", "Generisk bekräftelse", "Telefonsamtal", "Beslut", "Orderbekräftelse"], current: 2 });
    expect(d?.body.kind).toBe("protected");
    if (d?.body.kind !== "protected") return;
    expect(d.body.timeline[1].title).toBe("Flagga till avtalsansvarig Johan Berg");
    expect(d.body.timeline[2].title).toBe("Avtalsansvarig ringer Omar Farah på 08-530 000 14");
    expect(d.body.ack).toMatchObject({ kind: "sent", generic: true, mins: 2, body: "Tack för ditt mejl. Vi har tagit emot det och ringer dig i dag." });
    const avt = await q(inboxItem, { id: "em-104" }, johan());
    expect(avt).toMatchObject({ mine: true, canPhone: true });
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
    expect(j.tasks.map((t) => t.text)).toEqual(["Avrop med skyddade personuppgifter från Omar Farah. Ring handläggaren enligt den säkra rutinen."]);
    expect(j.protectedItems.map((x) => [x.id, x.caseText])).toEqual([["em-104", "väntar på telefonsamtal"]]);
    expect(j.warnings.text).toBe("3 varningar kan leda till uppsägning. Vite 25\u00a0000\u00a0kr per tillfälle vid avvikelse.");
  });
});

describe("områdets kommandon", () => {
  it("ink.correct: planerad omfattning rättad, övrigt kontrollerat (em-102)", async () => {
    const c = row("cases", "case-270049");
    expect(c?.plannedWeeks).toBe(6);
    const res = await run(inboxCorrect, {
      caseId: "case-270049", emailId: "em-102", patch: { plannedWeeks: 8 },
      checked: ["desiredStart", "plannedWeeks", "primaryArea", "vocationalTrack"],
    }, sara());
    expect(res).toEqual({ ok: true, changed: ["plannedWeeks"] });
    expect(row("cases", "case-270049")).toMatchObject({ plannedWeeks: 8, orderValueWeeks: 8 });
    const e = row("inbound_emails", "em-102");
    expect(e?.corrections.plannedWeeks).toMatchObject({ by: "u-sara", changed: true, from: 6 });
    expect(e?.corrections.primaryArea).toMatchObject({ changed: false });
    expect(e?.confidence.plannedWeeks).toBe(1);
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
    expect(await run(caseAccept, { caseId: "case-270049", leadCoachId: "u-leila", firstMeetingAt: "2027-02-03T10:00", plannedWeeks: 6, buyerReference: "55102938" }, sara())).toMatchObject({ ok: true });
    const conf = await q(inboxConfirmation, { caseId: "case-270049" }, sara());
    expect(conf).toMatchObject({ caseNumber: "BOT-27-0049", coachName: "Leila Nouri", team: "Bara huvudcoach", buyerReference: "55102938", leadNotif: { title: "Leila Nouri har fått en notis om tilldelningen" } });
    expect(conf?.confirmed).toMatch(/^i dag kl\. 09\.\d\d av Sara Lindqvist$/);
    expect((await q(inboxList, {}, sara())).pending).toEqual(["em-106", "em-104", "em-101", "em-105"]);
  });

  it("ink.linkPhoneOrder: skyddat avrop registreras efter telefonsamtal (em-104)", async () => {
    const form = await q(inboxPhoneForm, { emailId: "em-104" }, johan());
    expect(form).toMatchObject({ referrerId: "k-omar", referrerName: "Omar Farah", phone: "08-530 000 14", nextCaseNumber: "BOT-27-0051" });
    expect(await q(inboxDuplicateCheck, { pnr: "19880412-1234" }, johan())).toEqual({ duplicate: false });
    const created = await run(caseCreate, { protectedIdentity: true, source: "phone", referrerId: "k-omar", firstName: "Samir", lastName: "Lindqvist-Test", pnr: "19880412-1234", buyerReference: form?.brReference ?? "", primaryArea: "G", plannedWeeks: 8 }, johan());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await run(inboxLinkPhoneOrder, { emailId: "em-104", caseId: created.caseId }, johan())).toEqual({ ok: true });
    const e = row("inbound_emails", "em-104");
    const c = row("cases", created.caseId);
    expect(e).toMatchObject({ status: "received", caseId: created.caseId, registeredBy: "u-johan" });
    expect(c?.referredAt).toBe(e?.receivedAt);
    expect(row("tasks", "task-2")?.status).toBe("done");
    expect(rows("tasks").filter((t) => t.status === "open" && t.kind === "protected_order")).toEqual([]);
    expect(await q(inboxDuplicateCheck, { pnr: "19880412-1234" }, johan())).toEqual({ duplicate: true });
    // Samordnaren ser bara ärendenumret och "Skyddade personuppgifter".
    const d = await q(inboxItem, { id: "em-104" }, sara());
    expect(JSON.stringify(d)).not.toMatch(/Samir|Lindqvist-Test|1234/);
    expect(d?.decision).toBe(true);
    expect(d?.mine).toBe(false);
    expect(await run(inboxLinkPhoneOrder, { emailId: "em-104", caseId: created.caseId }, sara()).catch((x: Error) => x.message)).toBe("Din roll har inte behörighet till det här.");
  });

  it("ink.taskDone och Visa personnummer (loggas)", async () => {
    expect(await run(inboxTaskDone, { taskId: "task-2" }, johan())).toEqual({ ok: true });
    expect(row("tasks", "task-2")).toMatchObject({ status: "done", doneBy: "u-johan" });
    expect(await run(inboxTaskDone, { taskId: "task-2" }, sara())).toMatchObject({ ok: false, error: "not_found" });
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
