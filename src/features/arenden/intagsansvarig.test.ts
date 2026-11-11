// Intagsansvarig tar emot nya beställningar (Karims beslut 2026-11-09, migration 0041). Mot testdatat i minnet med demoklockan
// (måndag 1 februari 2027 kl. 09.12). Amira Haddad är intagsansvarig i Botkyrkaavtalet (testdatat). Tre beställningar väntar på
// svar: BOT-27-0048, BOT-27-0049 och BOT-27-0050 (Marias mejlavrop em-101). Bara påhittade uppgifter.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, Role } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import { MemoryStore, type MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import type { MinVeckaView } from "@/features/coach/api";
import type { NotifList } from "@/features/notiser/api";
import type { NavCounts } from "@/features/session/nav-api";
import { acceptDefaultDate } from "@/core/first-meeting";
import { notifyIntakeCoach } from "../_shared/intake";
import type { AcceptFormView, CaseCardResult } from "./api";

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
type Res = { ok: boolean; error?: string; message?: string } & Record<string, unknown>;
const cmd = (key: string, input: unknown, actor: Actor) => rt.run("command", key, input, actor) as Promise<Res>;
const query = <T,>(key: string, input: unknown, actor: Actor) => rt.run("query", key, input, actor) as Promise<T>;
/**
 * Coachens siffra vid Min vecka: beställningarna att ta emot och SMS att skicka (Karims beslut 2026-11-11). Den här filen prövar
 * beställningarna – SMS-raderna räknas fram och dras av.
 */
const ordersCount = async (actor: Actor) =>
  (await query<NavCounts>("session.navCounts", {}, actor)).tasks - (await query<{ rows: unknown[] }>("coach.smsAttSkicka", {}, actor)).rows.length;
const rows = <N extends keyof Tables>(name: N) => rt.raw().all(name) as readonly Tables[N][];
const amira = () => as("u-amira", "coach");
const erik = () => as("u-erik", "coach");
const sara = () => as("u-sara", "samordnare");
const johan = () => as("u-johan", "avtalsansvarig");
const robin = () => as("u-robin", "admin");
const maria = () => as("k-maria", "kommun_handlaggare");

/** Marias mejlavrop em-101: BOT-27-0050, sex månader. */
const CASE = "case-270050";
const CASE_NO = "BOT-27-0050";
const MEETING = "2027-02-08T10:00";
const accept = (actor: Actor, patch: Record<string, unknown> = {}) =>
  cmd("arenden.caseAccept", { caseId: CASE, leadCoachId: "u-amira", firstMeetingAt: MEETING, primaryArea: "J", orderPeriodMonths: 6, ...patch }, actor);
const caseOf = (id = CASE) => rt.raw().get("cases", id)!;
const notices = (kind: string, caseId = CASE) => rows("user_notifications").filter((n) => n.kind === kind && n.caseId === caseId);
/** Det som skrevs i en tabell sedan räkningen gjordes. */
const since = <N extends keyof Tables>(name: N, n: number) => rows(name).slice(n);
const person = () => rt.raw().get("persons", caseOf().personId)!;
/** En ny beställning i portalen (kommunens handläggare) – påhittade uppgifter. */
const order = (actor: Actor = maria()) =>
  cmd("arenden.caseCreate", {
    firstName: "Tove", lastName: "Testsson", pnr: "19900101-2385", phone: "070-000 00 00", email: "", desiredStart: "2027-02-15", orderPeriodMonths: 6, primaryArea: "G",
    priorAssessment: "no", background: "", referrerUnit: "Arbetsmarknadsenheten", source: "portal",
  }, actor);
/** En samordnare till (påhittad roll för Hanna) – för att se vem som får notisen. */
const addCoordinator = (userId = "u-hanna") => rt.store.insertRow("memberships", { id: `${userId}:c-bot:samordnare`, userId, contractId: "c-bot", role: "samordnare", customerUnit: null });

describe("testdatat och avtalet", () => {
  it("Amira är intagsansvarig i Botkyrkaavtalet och har rollen coach; tre beställningar väntar på svar", () => {
    expect(rt.raw().get("contracts", "c-bot")?.intakeCoachId).toBe("u-amira");
    expect(rows("memberships").some((m) => m.userId === "u-amira" && m.contractId === "c-bot" && m.role === "coach")).toBe(true);
    expect(rows("cases").filter((c) => c.status === "received" || c.status === "acknowledged").map((c) => c.caseNumber).sort()).toEqual(["BOT-27-0048", "BOT-27-0049", CASE_NO]);
    // Testdatat har inga notiser om dem – notisen skrivs när en beställning kommer in.
    expect(rows("user_notifications").filter((n) => n.kind === "new_order" || n.kind === "case_received")).toEqual([]);
  });

  it("kommunen läser aldrig vem som är intagsansvarig – Miljonbemanning gör det", async () => {
    const forKommun = await rt.ctxFor(maria()).repo.table("contracts").get("c-bot");
    expect(forKommun).toMatchObject({ id: "c-bot", intakeCoachId: null });
    expect((await rt.ctxFor(maria()).repo.table("contracts").list({ intakeCoachId: "u-amira" })).length).toBe(0);
    for (const a of [amira(), erik(), sara(), robin()]) expect((await rt.ctxFor(a).repo.table("contracts").get("c-bot"))?.intakeCoachId, a.userId).toBe("u-amira");
    // Kommunens portal nämner inte personen som intagsansvarig.
    expect(JSON.stringify(await query("kommun.start", {}, maria()))).not.toMatch(/intake|intagsansvarig/i);
  });
});

describe("notisen till den intagsansvarige när en beställning kommer in", () => {
  it("portalen: en notis i appen med ärendenumret och sista svarstid – ingen e-post, inget SMS, inget namn", async () => {
    const n = { un: rows("user_notifications").length, out: rows("outbound_messages").length };
    const res = await order();
    expect(res.ok, res.message).toBe(true);
    const created = since("user_notifications", n.un);
    expect(created).toEqual([{
      id: expect.any(String), recipientId: "u-amira", kind: "new_order", caseId: res.caseId, createdAt: expect.any(String), channels: ["app"], emailBody: "",
      title: `Ny beställning att ta emot – ${res.caseNumber}`, body: expect.stringMatching(/^Boka första mötet och tryck på Ta emot\. Kommunen ska ha svar senast \d+ feb kl\. \d\d\.\d\d\.$/),
    }]);
    expect(JSON.stringify(created)).not.toMatch(/Tove|Testsson|19900101/);
    // Utskicken: bara ordererkännandet till handläggaren – inget till coachen.
    expect(since("outbound_messages", n.out).map((m) => [m.channel, m.template])).toEqual([["email", "ordererkannande"]]);
    // Coachen ser notisen i Notiser, med länken till beställningen (bara id i sökvägen).
    const list = await query<NotifList>("notiser.list", {}, amira());
    expect(list.items.find((x) => x.kind === "new_order")).toMatchObject({ title: `Ny beställning att ta emot – ${res.caseNumber}`, caseId: res.caseId, readAt: null, channels: ["app"] });
    // En annan coach och samordnaren får ingen sådan notis.
    for (const a of [erik(), sara()]) expect((await query<NotifList>("notiser.list", {}, a)).items.filter((x) => x.kind === "new_order"), a.userId).toEqual([]);
  });

  it("samordnarens registrering (telefon) ger samma notis", async () => {
    const n = rows("user_notifications").length;
    const res = await cmd("inkorg.register", {
      channel: "phone", receivedAt: "2027-02-01T08:30", referrerId: "k-maria", referrerName: "", referrerEmail: "", referrerUnit: "", referrerPhone: "",
      firstName: "Tove", lastName: "Testsson", pnr: "19930303-1111", phone: "070-000 00 00", email: "", city: "Tumba", address: null, preferredContact: "sms",
      desiredStart: "2027-02-15", orderPeriodMonths: 6, plannedEnd: null, orderPeriodReason: null, priorAssessment: "no", background: "", buyerReference: "", attachmentIds: [],
    }, sara());
    expect(res.ok, res.message).toBe(true);
    expect(since("user_notifications", n).map((x) => [x.recipientId, x.kind, x.caseId, x.channels])).toEqual([["u-amira", "new_order", res.caseId, ["app"]]]);
  });

  it("högst en notis per ärende, och ingen för en beställning som redan är besvarad", async () => {
    const ctx = rt.ctxFor(sara());
    const c = caseOf();
    await notifyIntakeCoach(ctx, c, null);
    await notifyIntakeCoach(ctx, c, null);
    expect(notices("new_order")).toHaveLength(1);
    expect(notices("new_order")[0].body).toBe("Boka första mötet och tryck på Ta emot.");
    const n = rows("user_notifications").length;
    await notifyIntakeCoach(ctx, { ...caseOf("case-270039") }, null);
    expect(rows("user_notifications")).toHaveLength(n);
  });

  it("ingen intagsansvarig, en avstängd kollega eller en utan rollen coach: ingen notis – samordnaren tar emot som förut", async () => {
    const n = rows("user_notifications").length;
    rt.store.updateRow("contracts", "c-bot", { intakeCoachId: null });
    expect((await order()).ok).toBe(true);
    expect(rows("user_notifications")).toHaveLength(n);
    // Avstängd kollega.
    rt.store.updateRow("contracts", "c-bot", { intakeCoachId: "u-amira" });
    rt.store.updateRow("profiles", "u-amira", { active: false });
    await notifyIntakeCoach(rt.ctxFor(sara()), caseOf(), null);
    expect(rows("user_notifications")).toHaveLength(n);
    // Utan rollen coach (medlemskapet borttaget efter att personen valdes).
    rt.store.updateRow("profiles", "u-amira", { active: true });
    const m = rows("memberships").find((x) => x.userId === "u-amira" && x.role === "coach")!;
    rt.store.removeRow("memberships", m.id);
    await notifyIntakeCoach(rt.ctxFor(sara()), caseOf(), null);
    expect(rows("user_notifications")).toHaveLength(n);
  });
});

describe("den intagsansvariges Min vecka, deltagarkort och räknare", () => {
  it("raderna Ny beställning att ta emot – sorterade på sista svarstid – bara för den intagsansvarige", async () => {
    const v = await query<MinVeckaView>("coach.minVecka", {}, amira());
    expect(v.toReceive.map((x) => x.caseNumber)).toEqual(["BOT-27-0048", "BOT-27-0049", CASE_NO]);
    expect(v.toReceive.map((x) => x.dueAt)).toEqual([...v.toReceive.map((x) => x.dueAt)].sort());
    const row = v.toReceive.find((x) => x.caseId === CASE)!;
    expect(row).toMatchObject({ caseNumber: CASE_NO, name: `${person().firstName} ${person().lastName}`, from: "Maria Ekdahl", dueAt: expect.stringMatching(/^2027-02-0\dT/), sla: { label: expect.any(String) } });
    // Andra coacher: ingen rad, ingen räknare och ingen knapp på kortet.
    expect((await query<MinVeckaView>("coach.minVecka", {}, erik())).toReceive).toEqual([]);
    expect(await ordersCount(amira())).toBe(3);
    expect(await ordersCount(erik())).toBe(0);
  });

  it("deltagarkortet: Ta emot bara för den intagsansvarige, och underlaget från beställningen utan belopp", async () => {
    const card = async (a: Actor) => {
      const c = await query<CaseCardResult>("arenden.kort", { caseId: CASE }, a);
      if (c.kind !== "ok") throw new Error(c.kind);
      return c;
    };
    const mine = await card(amira());
    expect(mine).toMatchObject({ canReceive: true, status: "acknowledged", access: "full" });
    // Det coachen behöver för att ta ställning: yrkesområdet, omfattningen, handläggaren och bakgrunden från beställningen.
    expect(mine.areaName).toBeTruthy();
    expect(mine.referrer).toMatchObject({ name: "Maria Ekdahl" });
    expect(mine.background).toMatchObject({ orderPeriodText: expect.stringContaining("6 månader") });
    // Inga belopp, priser eller ordervärden i kronor – bara veckor och referenser.
    expect(JSON.stringify(mine)).not.toMatch(/priceOre|amountOre|"pris|kronor|\d\s?kr\b/i);
    for (const a of [erik(), sara(), johan(), as("u-karin"), robin()]) expect((await card(a)).canReceive, a.userId).toBe(false);
    // När beställningen är besvarad finns knappen inte längre.
    expect((await accept(amira())).ok).toBe(true);
    expect((await card(amira())).canReceive).toBe(false);
  });

  it("underlaget till dialogen: samma som inkorgens, läst utan avropsinkorgen – förvald huvudcoach är den intagsansvarige", async () => {
    const mine = await query<AcceptFormView | null>("arenden.acceptForm", { caseId: CASE }, amira());
    const coordinators = await query<AcceptFormView | null>("arenden.acceptForm", { caseId: CASE }, sara());
    expect(mine).toMatchObject({ intake: true, defaultCoachId: "u-amira", caseNumber: CASE_NO, pendingSup: null });
    expect(coordinators).toMatchObject({ intake: false, defaultCoachId: null, caseNumber: CASE_NO });
    // Samma underlag för beslutet (coacher, team, områden, omfattning, bakgrund) – utom det som hör till inkorgen.
    const strip = (f: AcceptFormView | null) => {
      const { intake: _i, defaultCoachId: _d, pendingSup: _p, declined: _x, total: _t, ...rest } = f!;
      void [_i, _d, _p, _x, _t];
      return rest;
    };
    expect(strip(mine)).toEqual(strip(coordinators));
    expect(mine!.coaches.map((c) => c.id)).toContain("u-amira");
    // Första mötet är förifyllt med kommunens önskade start (Karims beslut 2026-11-11) – i båda dialogerna.
    expect(caseOf().desiredStart).toBeTruthy();
    expect(mine).toMatchObject({ desiredStart: caseOf().desiredStart, defaultDate: acceptDefaultDate({ desiredStart: caseOf().desiredStart, referredAt: caseOf().referredAt, now: rt.clock.now() }) });
    expect(mine!.defaultDate >= caseOf().desiredStart!).toBe(true);
    // Omfattning, avtalsområde och beställarreferens kommer också från beställningen.
    expect(mine).toMatchObject({ primaryArea: caseOf().primaryAreaCode, orderPeriodMonths: caseOf().orderPeriodMonths, buyerReference: caseOf().buyerReference });
    // En annan coach, en besvarad beställning och ett ärende som inte finns: inget underlag.
    expect(await query("arenden.acceptForm", { caseId: CASE }, erik())).toBeNull();
    expect(await query("arenden.acceptForm", { caseId: "case-270039" }, amira())).toBeNull();
    expect(await query("arenden.acceptForm", { caseId: "case-finns-inte" }, amira())).toBeNull();
    // Kommunen, ekonomen, chefen och admin når inte frågan.
    for (const key of ["k-maria", "u-lars", "u-karin", "u-robin"]) await expect(query("arenden.acceptForm", { caseId: CASE }, as(key)), key).rejects.toThrow();
  });

  it("coachen når fortfarande inte avropsinkorgen eller dess mejl", async () => {
    for (const key of ["inkorg.list", "inkorg.start", "inkorg.decisionForm", "inkorg.confirmation", "inkorg.item"]) {
      await expect(query(key, { caseId: CASE, id: "em-101" }, amira()), key).rejects.toThrow();
    }
    await expect(cmd("inkorg.emailSetStatus", { emailId: "em-101", status: "handled" }, amira())).rejects.toThrow();
    expect(await rt.ctxFor(amira()).repo.table("inbound_emails").list()).toEqual([]);
    expect(await rt.ctxFor(amira()).repo.table("inbound_emails").get("em-101")).toBeNull();
  });
});

describe("arenden.caseAccept – den intagsansvarige tar emot", () => {
  it("allt skrivs: ärendet bekräftat med huvudcoach och första möte, teamet, historiken, orderbekräftelsen, mejlet bokfört och loggen", async () => {
    const n = { out: rows("outbound_messages").length, un: rows("user_notifications").length };
    const res = await accept(amira());
    expect(res).toMatchObject({ ok: true, caseNumber: CASE_NO, reportId: expect.any(String), invitation: expect.any(String) });
    expect(caseOf()).toMatchObject({
      status: "confirmed", leadCoachId: "u-amira", firstMeetingAt: MEETING, plannedStart: "2027-02-08", plannedEnd: "2027-08-07", primaryAreaCode: "J", confirmedAt: expect.any(String),
    });
    expect(rows("case_team").filter((t) => t.caseId === CASE)).toEqual([{ id: `${CASE}:u-amira`, caseId: CASE, userId: "u-amira", role: "lead_coach" }]);
    expect(rows("case_status_history").filter((h) => h.caseId === CASE).at(-1)).toMatchObject({ fromStatus: "acknowledged", toStatus: "confirmed", toCoach: "u-amira", changedBy: "u-amira", reason: "Avrop accepterat" });
    expect(rows("reports").filter((r) => r.caseId === CASE && r.kind === "order_confirmation")).toEqual([
      expect.objectContaining({ id: res.reportId, status: "delivered", version: 1, approvedBy: "u-amira", deliveredTo: ["k-maria"] }),
    ]);
    // Avropsmejlet är bokfört som accepterat (systemsteg – coachen läser aldrig mejlet).
    expect(rt.raw().get("inbound_emails", "em-101")).toMatchObject({ status: "accepted", handledBy: "u-amira", handledAt: expect.any(String) });
    const log = rows("audit_log").find((l) => l.action === "case.accepted" && l.entityId === CASE)!;
    expect(log).toMatchObject({ actorId: "u-amira", details: { leadCoachId: "u-amira", firstMeetingAt: MEETING, withinSla: true, via: "intake_coach" } });
    // Utskicken som vid samordnarens accept: orderbekräftelsen till kommunen, tilldelningen till coachen och kallelsen – inget till samordnaren.
    const sent = since("outbound_messages", n.out);
    expect(sent.some((m) => m.template === "orderbekraftelse" && m.channel === "email")).toBe(true);
    expect(sent.some((m) => m.template === "kallelse")).toBe(true);
    expect(sent.filter((m) => /sara/i.test(m.to))).toEqual([]);
    // Loggen och notiserna har inga personuppgifter om deltagaren.
    const text = JSON.stringify([rows("audit_log").filter((l) => l.entityId === CASE), since("user_notifications", n.un)]);
    expect(text).not.toContain(person().firstName);
    expect(text).not.toContain(person().lastName);
  });

  it("samordnarna får notisen Ny deltagare mottagen i appen – med vem som tog emot, första mötet och huvudcoachen; aldrig e-post", async () => {
    addCoordinator();
    const n = { un: rows("user_notifications").length, out: rows("outbound_messages").length };
    expect((await accept(amira(), { leadCoachId: "u-erik" })).ok).toBe(true);
    const got = notices("case_received");
    expect(got.map((x) => x.recipientId).sort()).toEqual(["u-hanna", "u-sara"]);
    for (const x of got) {
      expect(x).toMatchObject({
        kind: "case_received", caseId: CASE, channels: ["app"], emailBody: "", title: `Ny deltagare mottagen – ${CASE_NO}`,
        body: "Mottagen av Amira Haddad. Första mötet måndag 8 feb 2027 kl. 10.00. Huvudcoach: Erik Sjöberg.",
      });
    }
    // Inget mejl och inget SMS om notisen: utskicken till samordnarna är oförändrade (inga).
    expect(since("outbound_messages", n.out).filter((m) => m.template !== "orderbekraftelse" && m.template !== "kallelse" && m.template !== "tilldelning_coach")).toEqual([]);
    // Samordnaren ser den som oläst i Notiser (och därmed i kortet Olästa notiser på Min vecka) och i räknaren.
    const list = await query<NotifList>("notiser.list", {}, sara());
    expect(list.items.find((x) => x.kind === "case_received")).toMatchObject({ title: `Ny deltagare mottagen – ${CASE_NO}`, caseId: CASE, readAt: null });
    expect((await query<NavCounts>("session.navCounts", {}, sara())).notifications).toBe(1);
    // Ingen annan får den: inte den som tog emot, inte huvudcoachen, inte avtalsansvarig, chefen eller kommunen.
    expect(since("user_notifications", n.un).filter((x) => x.kind === "case_received").every((x) => ["u-sara", "u-hanna"].includes(x.recipientId))).toBe(true);
    for (const a of [amira(), erik(), johan()]) expect((await query<NotifList>("notiser.list", {}, a)).items.filter((x) => x.kind === "case_received"), a.userId).toEqual([]);
  });

  it("samordnaren tar emot: notisen går till de andra samordnarna – aldrig till den som själv tog emot", async () => {
    addCoordinator();
    expect((await accept(sara())).ok).toBe(true);
    expect(notices("case_received").map((x) => [x.recipientId, x.body])).toEqual([["u-hanna", "Mottagen av Sara Lindqvist. Första mötet måndag 8 feb 2027 kl. 10.00. Huvudcoach: Amira Haddad."]]);
    // Ensam samordnare som tar emot själv: ingen notis alls.
    rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
    expect((await accept(sara())).ok).toBe(true);
    expect(notices("case_received")).toEqual([]);
  });

  it("den intagsansvariges notis om beställningen märks som läst när beställningen är besvarad – också när samordnaren hann före eller avböjde", async () => {
    for (const answer of [() => accept(amira()), () => accept(sara()), () => cmd("arenden.caseDecline", { caseId: CASE, reason: "Kapacitetsbrist" }, sara())]) {
      rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
      await notifyIntakeCoach(rt.ctxFor(sara()), caseOf(), null);
      const before = await query<NotifList>("notiser.list", {}, amira());
      expect(before.items.find((x) => x.kind === "new_order")?.readAt).toBeNull();
      expect((await answer()).ok).toBe(true);
      const after = await query<NotifList>("notiser.list", {}, amira());
      expect(after.items.find((x) => x.kind === "new_order")?.readAt).toEqual(expect.any(String));
      expect((await query<MinVeckaView>("coach.minVecka", {}, amira())).toReceive.map((x) => x.caseId)).not.toContain(CASE);
    }
  });

  it("andra coacher nekas, och ingenting skrivs", async () => {
    const n = { out: rows("outbound_messages").length, un: rows("user_notifications").length, rep: rows("reports").length, log: rows("audit_log").length };
    for (const a of [erik(), as("u-leila", "coach"), as("u-petra", "coach")]) {
      expect(await accept(a, { leadCoachId: a.userId }), a.userId).toEqual({ ok: false, error: "forbidden", message: "Nya beställningar tas emot av samordnaren eller av avtalets intagsansvarige." });
    }
    // Samma svar för en beställning som redan är besvarad – en annan coach får aldrig veta läget den vägen.
    expect(await accept(erik(), { caseId: "case-270039" })).toMatchObject({ ok: false, error: "forbidden" });
    expect(caseOf()).toMatchObject({ status: "acknowledged", leadCoachId: null, firstMeetingAt: null });
    expect([rows("outbound_messages").length, rows("user_notifications").length, rows("reports").length, rows("audit_log").length]).toEqual([n.out, n.un, n.rep, n.log]);
    expect(rt.raw().get("inbound_emails", "em-101")?.status).toBe("acknowledged");
  });

  it("kommunen, ekonomen, chefen och admin tar aldrig emot; den intagsansvarige avböjer aldrig", async () => {
    for (const key of ["k-maria", "u-lars", "u-karin", "u-robin"]) await expect(accept(as(key)), key).rejects.toThrow();
    await expect(cmd("arenden.caseDecline", { caseId: CASE, reason: "Kapacitetsbrist" }, amira())).rejects.toThrow();
    expect(caseOf().status).toBe("acknowledged");
    // Policyn (spegeln av triggern cases_accept_guard): inte heller direkt i tabellen.
    await expect(rt.ctxFor(amira()).repo.table("cases").update(CASE, { status: "declined" })).rejects.toThrow();
    await expect(rt.ctxFor(erik()).repo.table("cases").update(CASE, { status: "confirmed" })).rejects.toThrow();
    await expect(rt.ctxFor(erik()).repo.table("cases").update(CASE, { status: "active" })).rejects.toThrow();
    expect(caseOf().status).toBe("acknowledged");
  });

  it("utan intagsansvarig är allt som förut: coachen tar inte emot, samordnaren gör det", async () => {
    rt.store.updateRow("contracts", "c-bot", { intakeCoachId: null });
    expect(await accept(amira())).toMatchObject({ ok: false, error: "forbidden" });
    expect(await query("arenden.acceptForm", { caseId: CASE }, amira())).toBeNull();
    expect((await query<MinVeckaView>("coach.minVecka", {}, amira())).toReceive).toEqual([]);
    expect(await ordersCount(amira())).toBe(0);
    const res = await accept(sara());
    expect(res.ok).toBe(true);
    expect(rows("audit_log").find((l) => l.action === "case.accepted" && l.entityId === CASE)?.details).not.toHaveProperty("via");
  });

  it("redan besvarad: den som kommer tvåa får svaret och ingenting skrivs en gång till", async () => {
    expect((await accept(sara())).ok).toBe(true);
    const n = { out: rows("outbound_messages").length, un: rows("user_notifications").length, rep: rows("reports").length };
    expect(await accept(amira())).toEqual({ ok: false, error: "wrong_status", message: `${CASE_NO} är redan besvarat.` });
    expect([rows("outbound_messages").length, rows("user_notifications").length, rows("reports").length]).toEqual([n.out, n.un, n.rep]);
  });

  it("två samtidigt: hinner samordnaren ta emot under tiden går den intagsansvariges accept inte igenom – en orderbekräftelse, en kallelse", async () => {
    // Samordnaren tar emot precis efter att den intagsansvariges accept har läst ärendet (när avtalsområdena läses).
    const store = rt.store;
    const origRows = MemoryStore.prototype.rows;
    let raced = false;
    const spy = vi.spyOn(MemoryStore.prototype, "rows").mockImplementation(function (this: MemoryStore<Tables>, name) {
      if (name === "contract_areas" && !raced && this === store) {
        raced = true;
        this.updateRow("cases", CASE, { status: "confirmed", leadCoachId: "u-erik", confirmedAt: DEMO_START });
      }
      return origRows.call(this, name);
    } as typeof origRows);
    const n = { out: rows("outbound_messages").length, un: rows("user_notifications").length, rep: rows("reports").length, team: rows("case_team").length };
    const res = await accept(amira());
    spy.mockRestore();
    expect(raced).toBe(true);
    expect(res).toEqual({ ok: false, error: "wrong_status", message: `${CASE_NO} är redan besvarat.` });
    expect(caseOf()).toMatchObject({ status: "confirmed", leadCoachId: "u-erik", firstMeetingAt: null });
    expect([rows("outbound_messages").length, rows("user_notifications").length, rows("reports").length, rows("case_team").length]).toEqual([n.out, n.un, n.rep, n.team]);
  });
});

describe("systemadministratören väljer intagsansvarig", () => {
  const set = (userId: string | null, actor: Actor = robin()) => cmd("admin.setIntakeCoach", { contractId: "c-bot", userId }, actor);
  type ContractView = { contract: { intakeCoachId: string | null; intakeCoachName: string | null; intakeCoachOptions: { id: string; name: string }[] } };

  it("avtalssidan visar personen och avtalets coacher att välja bland", async () => {
    const v = await query<ContractView>("admin.contract", {}, robin());
    expect(v.contract).toMatchObject({ intakeCoachId: "u-amira", intakeCoachName: "Amira Haddad" });
    const coachIds = rows("memberships").filter((m) => m.contractId === "c-bot" && m.role === "coach").map((m) => m.userId).sort();
    expect(v.contract.intakeCoachOptions.map((o) => o.id).sort()).toEqual(coachIds);
  });

  it("byta person (semester), ingen, och loggen med bara id:n – den nya personen ser raderna, den gamla inte", async () => {
    expect(await set("u-erik")).toEqual({ ok: true });
    expect(rt.raw().get("contracts", "c-bot")?.intakeCoachId).toBe("u-erik");
    expect((await query<MinVeckaView>("coach.minVecka", {}, erik())).toReceive).toHaveLength(3);
    expect((await query<MinVeckaView>("coach.minVecka", {}, amira())).toReceive).toEqual([]);
    expect((await accept(erik(), { leadCoachId: "u-erik" })).ok).toBe(true);
    expect(await set("u-erik")).toMatchObject({ ok: false, error: "unchanged" });
    expect(await set(null)).toEqual({ ok: true });
    expect(rt.raw().get("contracts", "c-bot")?.intakeCoachId).toBeNull();
    expect(await set(null)).toMatchObject({ ok: false, error: "unchanged" });
    const logs = rows("audit_log").filter((l) => l.action === "contract.intake_coach_changed");
    expect(logs.map((l) => [l.entity, l.entityId, l.actorId, l.details])).toEqual([
      ["contract", "c-bot", "u-robin", { from: "u-amira", to: "u-erik" }],
      ["contract", "c-bot", "u-robin", { from: "u-erik", to: null }],
    ]);
  });

  it("bara en coach i avtalet kan väljas – och bara systemadministratören väljer", async () => {
    for (const userId of ["u-sara", "u-lars", "u-karin", "k-maria", "finns-inte"]) {
      expect(await set(userId), userId).toEqual({ ok: false, error: "not_coach", message: "Personen måste ha rollen coach i avtalet. Ge rollen under Användare och roller först." });
    }
    for (const a of [sara(), johan(), amira(), as("u-karin"), as("u-lars"), maria()]) await expect(set("u-erik", a), a.userId).rejects.toThrow();
    expect(rt.raw().get("contracts", "c-bot")?.intakeCoachId).toBe("u-amira");
    // Policyn (spegeln av triggern contracts_intake_coach_check och contracts_update): inte heller direkt i tabellen.
    await expect(rt.ctxFor(robin()).repo.table("contracts").update("c-bot", { intakeCoachId: "u-sara" })).rejects.toThrow();
    await expect(rt.ctxFor(sara()).repo.table("contracts").update("c-bot", { intakeCoachId: "u-erik" })).rejects.toThrow();
    await expect(rt.ctxFor(amira()).repo.table("contracts").update("c-bot", { intakeCoachId: null })).rejects.toThrow();
  });

  it("tas rollen coach bort eller spärras kollegan står avtalet utan intagsansvarig – loggat med orsaken", async () => {
    expect(await cmd("admin.setStaffRoles", { userId: "u-amira", roles: ["chef"] }, robin())).toMatchObject({ ok: true, changed: true });
    expect(rt.raw().get("contracts", "c-bot")?.intakeCoachId).toBeNull();
    expect(rows("audit_log").filter((l) => l.action === "contract.intake_coach_changed").at(-1)?.details).toEqual({ from: "u-amira", to: null, reason: "role_removed" });
    // Spärrad kollega.
    expect(await set("u-erik")).toEqual({ ok: true });
    expect(await cmd("admin.setStaffActive", { userId: "u-erik", active: false }, robin())).toMatchObject({ ok: true });
    expect(rt.raw().get("contracts", "c-bot")?.intakeCoachId).toBeNull();
    expect(rows("audit_log").filter((l) => l.action === "contract.intake_coach_changed").at(-1)?.details).toEqual({ from: "u-erik", to: null, reason: "blocked" });
    // En annan kollegas roller rör inte avtalet.
    expect(await set("u-leila")).toEqual({ ok: true });
    expect(await cmd("admin.setStaffRoles", { userId: "u-mats", roles: ["chef"] }, robin())).toMatchObject({ ok: true });
    expect(rt.raw().get("contracts", "c-bot")?.intakeCoachId).toBe("u-leila");
  });
});

// ---------------------------------------------------------------- Granskningen 2026-11-10
describe("en komplettering från kommunen väntar i avropsinkorgen", () => {
  // BOT-27-0049 (Ahmeds avrop) saknar omfattning. Kommunen har svarat med ärendenumret (em-103: sex månader och en
  // beställarreferens) – svaret är kopplat till ärendet men inte infört. Samordnaren för in det i avropsinkorgen.
  const WAITING = "case-270049";
  const SUP = "em-103";
  const receive = (actor: Actor) => cmd("arenden.caseAccept", { caseId: WAITING, leadCoachId: "u-amira", firstMeetingAt: MEETING, primaryArea: "D", orderPeriodMonths: 12 }, actor);

  it("testdatat: kompletteringen är kopplad till ärendet och inte införd", () => {
    expect(rows("inbound_emails").filter((e) => e.caseId === WAITING && e.classification === "supplement").map((e) => [e.id, e.status])).toEqual([[SUP, "linked"]]);
    expect(caseOf(WAITING)).toMatchObject({ status: "acknowledged", orderPeriodMonths: null });
  });

  it("underlaget säger bara att en komplettering väntar – ingenting ur mejlet – och bara för den intagsansvarige", async () => {
    const f = (await query<AcceptFormView | null>("arenden.acceptForm", { caseId: WAITING }, amira()))!;
    expect(f).toMatchObject({ intake: true, supplementPending: true, pendingSup: null });
    const mail = rows("inbound_emails").find((e) => e.id === SUP)!;
    const text = JSON.stringify(f);
    for (const secret of [mail.subject, mail.bodyText.slice(0, 40), "55102938", SUP]) expect(text, secret).not.toContain(secret);
    // En beställning utan komplettering, och samordnarens underlag (som visar kompletteringen i pendingSup).
    expect(await query<AcceptFormView | null>("arenden.acceptForm", { caseId: CASE }, amira())).toMatchObject({ intake: true, supplementPending: false });
    const forSara = (await query<AcceptFormView | null>("arenden.acceptForm", { caseId: WAITING }, sara()))!;
    expect(forSara).toMatchObject({ intake: false, supplementPending: false });
    expect(forSara.pendingSup).toMatchObject({ id: SUP });
  });

  it("den intagsansvarige tar inte emot förrän kompletteringen är införd – ingenting skrivs", async () => {
    const before = JSON.stringify([caseOf(WAITING), rows("reports").length, rows("user_notifications").length, rows("outbound_messages").length, rows("audit_log").length]);
    expect(await receive(amira())).toEqual({
      ok: false, error: "pending_supplement", message: "Kommunen har skickat en komplettering som väntar i inkorgen. Be samordnaren föra in den innan du tar emot.",
    });
    expect(JSON.stringify([caseOf(WAITING), rows("reports").length, rows("user_notifications").length, rows("outbound_messages").length, rows("audit_log").length])).toBe(before);
  });

  it("när samordnaren har fört in kompletteringen tar den intagsansvarige emot – med kommunens omfattning", async () => {
    expect((await cmd("inkorg.emailApplySupplement", { emailId: SUP }, sara())).ok).toBe(true);
    expect(caseOf(WAITING)).toMatchObject({ orderPeriodMonths: 6, buyerReference: "55102938" });
    expect(await query<AcceptFormView | null>("arenden.acceptForm", { caseId: WAITING }, amira())).toMatchObject({ supplementPending: false, orderPeriodMonths: 6 });
    // Dialogen skickar beställningens omfattning (förvald) – här utan eget val.
    expect((await cmd("arenden.caseAccept", { caseId: WAITING, leadCoachId: "u-amira", firstMeetingAt: MEETING, primaryArea: "D" }, amira())).ok).toBe(true);
    expect(caseOf(WAITING)).toMatchObject({ status: "confirmed", orderPeriodMonths: 6, plannedEnd: "2027-08-07", leadCoachId: "u-amira" });
    expect(rows("reports").filter((r) => r.caseId === WAITING && r.kind === "order_confirmation")).toHaveLength(1);
  });

  it("samordnaren och avtalsansvarig tar emot som förut – också med en komplettering som väntar", async () => {
    expect((await receive(sara())).ok).toBe(true);
    expect(caseOf(WAITING)).toMatchObject({ status: "confirmed", orderPeriodMonths: 12 });
  });
});

describe("notiserna följer beställningen och personen", () => {
  const set = (userId: string | null) => cmd("admin.setIntakeCoach", { contractId: "c-bot", userId }, robin());
  const readBy = (userId: string) => new Set(rows("notification_reads").filter((r) => r.userId === userId).map((r) => r.notificationKey));
  const newOrder = (userId: string) => rows("user_notifications").filter((n) => n.kind === "new_order" && n.recipientId === userId);
  const WAITING_CASES = ["case-270048", "case-270049", CASE];

  it("en beställning som avslutas utan att ha tagits emot: notisen om den märks som läst", async () => {
    await notifyIntakeCoach(rt.ctxFor(sara()), caseOf(), null);
    const n = notices("new_order")[0];
    expect(readBy("u-amira").has(n.id)).toBe(false);
    // En coach (inte den intagsansvarige) avslutar beställningen – deltagaren kom aldrig.
    expect((await cmd("arenden.caseClose", { caseId: CASE, endDate: "2027-02-01", endReason: "avbrott_deltagarens_val" }, erik())).ok).toBe(true);
    expect(caseOf().status).toBe("closed");
    expect(readBy("u-amira").has(n.id)).toBe(true);
    expect(await ordersCount(amira())).toBe(2);
    // Ett avslut av en pågående insats rör inga notiser om beställningar.
    const reads = rows("notification_reads").length;
    const active = rows("cases").find((c) => c.status === "active" && c.leadCoachId === "u-amira")!;
    expect((await cmd("arenden.caseClose", { caseId: active.id, endDate: "2027-02-01", endReason: "avbrott_deltagarens_val" }, amira())).ok).toBe(true);
    expect(rows("notification_reads")).toHaveLength(reads);
  });

  /** Olästa notiser om beställningar att ta emot per ärende, för en person. */
  const unread = (userId: string) => {
    const read = readBy(userId);
    return newOrder(userId).filter((n) => !read.has(n.id)).map((n) => n.caseId as string).sort();
  };

  it("byte av intagsansvarig: den förras notiser märks som lästa och den nya får en oläst notis per beställning som väntar", async () => {
    // Amira har en oläst notis om en ny beställning (portalen) – de tre i testdatat har ingen notis.
    const res = await order();
    const fresh = res.caseId as string;
    expect(unread("u-amira")).toEqual([fresh]);
    expect(await set("u-erik")).toEqual({ ok: true });
    // Den förra: notisen är läst (beställningen är inte längre hennes att ta emot).
    expect(unread("u-amira")).toEqual([]);
    expect((await query<NotifList>("notiser.list", {}, amira())).items.filter((x) => x.kind === "new_order" && !x.readAt)).toEqual([]);
    // Den nya: en notis per beställning som väntar – bara i appen, utan personuppgifter, med svarstiden.
    const toErik = newOrder("u-erik");
    expect(unread("u-erik")).toEqual([...WAITING_CASES, fresh].sort());
    for (const n of toErik) expect(n).toMatchObject({ channels: ["app"], emailBody: "", title: `Ny beställning att ta emot – ${caseOf(n.caseId as string).caseNumber}` });
    expect(toErik.find((n) => n.caseId === CASE)?.body).toBe("Boka första mötet och tryck på Ta emot. Kommunen ska ha svar senast 2 feb kl. 08.41.");
    expect(JSON.stringify(toErik)).not.toMatch(/Tove|Testsson|19900101/);
    expect((await query<NotifList>("notiser.list", {}, erik())).items.filter((x) => x.kind === "new_order" && !x.readAt)).toHaveLength(4);
    // En besvarad beställning ger ingen notis till nästa person.
    expect((await accept(erik(), { leadCoachId: "u-erik" })).ok).toBe(true);
    expect(await set("u-amira")).toEqual({ ok: true });
    expect(unread("u-amira")).toEqual(["case-270048", "case-270049", fresh].sort());
    expect(unread("u-erik")).toEqual([]);
    // Ingen e-post och inget SMS om något av detta.
    expect(rows("outbound_messages").filter((m) => /beställning att ta emot/i.test(m.body))).toEqual([]);
  });

  it("den som blir intagsansvarig igen har en oläst notis per beställning som väntar – A → B → A → B, och ingen → A (granskningen, runda 2)", async () => {
    // Systemadministratören väljer fel person och rättar det direkt: den första personens gamla notiser är lästa, så hon får
    // nya – exakt en oläst per beställning och person, aldrig två.
    const fresh = (await order()).caseId as string;
    const waiting = [...WAITING_CASES, fresh].sort();
    expect(unread("u-amira")).toEqual([fresh]);
    // A → B
    expect(await set("u-erik")).toEqual({ ok: true });
    expect({ amira: unread("u-amira"), erik: unread("u-erik") }).toEqual({ amira: [], erik: waiting });
    // B → A: också beställningen som Amira redan hade en (nu läst) notis om.
    expect(await set("u-amira")).toEqual({ ok: true });
    expect({ amira: unread("u-amira"), erik: unread("u-erik") }).toEqual({ amira: waiting, erik: [] });
    expect((await query<NotifList>("notiser.list", {}, amira())).items.filter((x) => x.kind === "new_order" && !x.readAt)).toHaveLength(4);
    expect(await ordersCount(amira())).toBe(4);
    // A → B igen
    expect(await set("u-erik")).toEqual({ ok: true });
    expect({ amira: unread("u-amira"), erik: unread("u-erik") }).toEqual({ amira: [], erik: waiting });
    // ingen → A
    expect(await set(null)).toEqual({ ok: true });
    expect({ amira: unread("u-amira"), erik: unread("u-erik") }).toEqual({ amira: [], erik: [] });
    expect(await set("u-amira")).toEqual({ ok: true });
    expect({ amira: unread("u-amira"), erik: unread("u-erik") }).toEqual({ amira: waiting, erik: [] });
    // Aldrig två olästa om samma ärende, hur många gånger notisen än skrivs.
    for (const id of waiting) await notifyIntakeCoach(rt.ctxFor(sara()), caseOf(id), null);
    expect(unread("u-amira")).toEqual(waiting);
    // En notis som hon själv märker som läst står kvar som läst – beställningen finns ändå på Min vecka tills den är besvarad.
    const n = newOrder("u-amira").find((x) => x.caseId === fresh && !readBy("u-amira").has(x.id))!;
    expect((await cmd("notiser.notifRead", { ids: [n.id] }, amira())).ok).toBe(true);
    expect(unread("u-amira")).toEqual(waiting.filter((id) => id !== fresh));
    expect((await query<MinVeckaView>("coach.minVecka", {}, amira())).toReceive.map((x) => x.caseId).sort()).toEqual(waiting);
  });

  it("ingen intagsansvarig (vald bort, rollen coach borttagen eller kollegan spärrad): personens notiser märks som lästa och ingen får nya", async () => {
    const fresh = (await order()).caseId as string;
    const mine = () => newOrder("u-amira").filter((n) => n.caseId === fresh);
    expect(readBy("u-amira").has(mine()[0].id)).toBe(false);
    const count = rows("user_notifications").length;
    expect(await set(null)).toEqual({ ok: true });
    expect(readBy("u-amira").has(mine()[0].id)).toBe(true);
    expect(rows("user_notifications")).toHaveLength(count);
    // Rollen coach tas bort från den intagsansvarige: samma sak.
    expect(await set("u-erik")).toEqual({ ok: true });
    const toErik = newOrder("u-erik");
    expect(toErik.length).toBeGreaterThan(0);
    expect(await cmd("admin.setStaffRoles", { userId: "u-erik", roles: ["chef"] }, robin())).toMatchObject({ ok: true });
    expect(rt.raw().get("contracts", "c-bot")?.intakeCoachId).toBeNull();
    expect(toErik.every((n) => readBy("u-erik").has(n.id))).toBe(true);
    // Spärrad kollega.
    expect(await set("u-leila")).toEqual({ ok: true });
    const toLeila = newOrder("u-leila");
    expect(toLeila.length).toBeGreaterThan(0);
    expect(await cmd("admin.setStaffActive", { userId: "u-leila", active: false }, robin())).toMatchObject({ ok: true });
    expect(toLeila.every((n) => readBy("u-leila").has(n.id))).toBe(true);
  });
});
