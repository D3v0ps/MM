// Behörighet i minnesläget (policy.ts) – samma fall som RLS-testerna i Postgres ska täcka (CLAUDE.md "RLS-tester per roll"):
// kommunanvändare ser bara sina ärenden, ekonom ser inga coachanteckningar, handledare ser bara tilldelade ärenden,
// skyddade ärenden syns bara för namngivna – plus pulssvar, notiser, revisionslogg, utskick och skrivregler.
import { describe, expect, it } from "vitest";
import type { Actor, Role } from "@/api/roles";
import { actorFor, listPersonas, personaFor } from "./actors";
import { MemoryRepo, MemoryStore, PolicyError } from "./memory";
import { POLICIES } from "./policy";
import { createSeed } from "./seed";
import { TABLE_NAMES, type AppRepo, type Tables } from "./schema";

const store = new MemoryStore<Tables>(createSeed());
const raw = store.raw();
const repoFor = (actor: Actor, s = store) => new MemoryRepo<Tables>(s, actor, POLICIES) as unknown as AppRepo;
const who = (userId: string, role?: Role) => {
  const a = actorFor(raw, userId, role);
  if (!a) throw new Error(`Ingen aktör ${userId}`);
  return a;
};
const tagged = (t: string) => raw.all("demo_tags").find((x) => x.tag === t)!.entityIds[0];
const all = <N extends keyof Tables>(name: N) => raw.all(name) as readonly Tables[N][];
const count = (actor: Actor, name: keyof Tables) => repoFor(actor).table(name).count();

const MARIA = who("k-maria");
const EVA = who("k-eva");
const LARS = who("u-lars");
const PETRA = who("u-petra");
const AMIRA = who("u-amira");
const ERIK = who("u-erik");
const SARA = who("u-sara");
const JOHAN = who("u-johan");
const KARIN = who("u-karin");
const ROBIN = who("u-robin");
const OMAR = who("k-omar");
const DELTAGARE = who("deltagare");

/** Tabeller med coachens anteckningar och bedömningar. */
const NOTE_TABLES = ["check_ins", "intake_assessments", "monthly_assessments", "monthly_plans", "deviations", "consents"] as const;

describe("testpersoner (actors.ts)", () => {
  it("standardpersonen för varje roll först, i prototypens ordning, sedan övriga användare", () => {
    const ps = listPersonas(raw);
    expect(ps.filter((p) => p.isDefaultForRole).map((p) => `${p.actor.userId}:${p.actor.role}`)).toEqual([
      "u-sara:samordnare", "u-johan:avtalsansvarig", "u-amira:coach", "u-petra:handledare", "u-karin:chef", "u-lars:ekonom", "u-robin:admin",
      "k-maria:kommun_handlaggare", "k-eva:kommun_chef", "deltagare:deltagare",
    ]);
    expect(ps.slice(10).map((p) => p.actor.userId)).toEqual(["u-erik", "u-leila", "u-mats", "u-sofia", "u-david", "u-hanna", "k-ahmed", "k-linda", "k-omar"]);
    expect(ps.every((p, i) => p.isDefaultForRole === i < 10)).toBe(true);
  });
  it("aktören får avtal från medlemskapen och kommunens enhet från profilen", () => {
    expect(JOHAN).toEqual({ userId: "u-johan", role: "avtalsansvarig", contractIds: ["c-bot", "c-kk"], customerUnit: null });
    expect(MARIA).toEqual({ userId: "k-maria", role: "kommun_handlaggare", contractIds: ["c-bot"], customerUnit: "Arbetsmarknadsenheten Alby" });
    expect(EVA.role).toBe("kommun_chef");
    expect(DELTAGARE).toEqual({ userId: "deltagare", role: "deltagare", contractIds: [], customerUnit: null });
    expect(actorFor(raw, "u-amira", "chef")).toBeNull();
  });
  it("sessionens användare: namn, titel, e-post, organisation och enhet – deltagaren har ingen e-post", () => {
    const ps = listPersonas(raw);
    expect(ps.find((p) => p.actor.userId === "k-maria")!.user).toEqual({ id: "k-maria", name: "Maria Ekdahl", title: "Handläggare", email: "maria.ekdahl@botkyrka.se", orgName: "Botkyrka kommun", unit: "Arbetsmarknadsenheten Alby" });
    expect(ps.find((p) => p.actor.userId === "u-amira")!).toMatchObject({ user: { name: "Amira Haddad", orgName: "Miljonbemanning AB" }, roleDescription: "Min vecka: närvaro, avstämningar, månadsbedömningar och rapporter." });
    expect(ps.find((p) => p.actor.role === "deltagare")!.user.email).toBe("");
    expect(personaFor(raw, "u-johan")!.actor.role).toBe("avtalsansvarig");
    expect(personaFor(raw, "okänd")).toBeNull();
  });
});

describe("alla tabeller har en regel (neka som standard)", () => {
  it("POLICIES täcker varje tabell med läs- och skrivregel", () => {
    for (const n of TABLE_NAMES) {
      expect([n, typeof POLICIES[n]?.read]).toEqual([n, "function"]);
      expect([n, typeof POLICIES[n]?.write]).toEqual([n, "function"]);
    }
  });
  it("deltagaren (pulslänk utan inloggning) läser ingenting med personuppgifter", async () => {
    for (const n of TABLE_NAMES) {
      if (n === "holidays" || n === "demo_tags") continue;
      expect([n, await count(DELTAGARE, n)]).toEqual([n, 0]);
    }
  });
});

describe("kommunens handläggare ser bara sina ärenden", () => {
  it("ärenden, personer och team bara där hon är beställare", async () => {
    const cases = await repoFor(MARIA).table("cases").list();
    expect(cases).toHaveLength(71);
    expect(cases.every((c) => c.referrerId === "k-maria")).toBe(true);
    const own = new Set(cases.map((c) => c.id));
    const persons = await repoFor(MARIA).table("persons").list();
    expect(persons.length).toBe(new Set(cases.map((c) => c.personId)).size);
    expect((await repoFor(MARIA).table("case_team").list()).every((t) => own.has(t.caseId))).toBe(true);
    // Någon annans ärende går inte att hämta med id
    const other = all("cases").find((c) => c.referrerId === "k-ahmed")!;
    expect(await repoFor(MARIA).table("cases").get(other.id)).toBeNull();
    expect(await repoFor(MARIA).table("persons").get(other.personId)).toBeNull();
  });
  it("aldrig coachanteckningar, bedömningar, pulssvar, flaggor, revisionslogg eller interna regler", async () => {
    for (const n of [...NOTE_TABLES, "pulse_invites", "pulse_responses", "alerts", "alert_acks", "kpi_snapshots", "deadlines", "audit_log", "outbound_messages",
      "org_settings", "inbound_emails", "billing_runs", "invoice_drafts", "ai_runs"] as const) {
      expect([n, await count(MARIA, n)]).toEqual([n, 0]);
    }
  });
  it("bara levererade rapporter till henne", async () => {
    const reps = await repoFor(MARIA).table("reports").list();
    const expected = all("reports").filter((r) => r.deliveredAt && (r.deliveredTo.includes("k-maria") || r.recipientUserId === "k-maria"));
    expect(reps.map((r) => r.id).sort()).toEqual(expected.map((r) => r.id).sort());
    expect(reps.length).toBeGreaterThan(100);
    // Veckorapporten som väntar på närvaro och beställarrapportens utkast syns inte
    expect(reps.some((r) => r.status === "waiting" || r.status === "draft")).toBe(false);
    expect(reps.some((r) => r.kind === "customer_summary")).toBe(false);
    // pick: samma rader som list (samma regel), men bara de angivna fälten och id
    const light = await repoFor(MARIA).table("reports").pick(["kind", "status"], undefined, { orderBy: "deliveredAt" });
    expect(light.map((r) => r.id).sort()).toEqual(reps.map((r) => r.id).sort());
    expect(Object.keys(light[0]).sort()).toEqual(["deliveredAt", "id", "kind", "status"]);
    expect(light.some((r) => "snapshot" in r || "caseId" in r)).toBe(false);
  });
  it("meddelanden bara i hennes ärenden", async () => {
    const msgs = await repoFor(MARIA).table("messages").list();
    expect(msgs.map((m) => m.id).sort()).toEqual(["msg-1", "msg-2", "msg-3", "msg-4", "msg-5"]);
    expect((await repoFor(who("k-ahmed")).table("messages").list()).map((m) => m.id)).toEqual(["msg-6", "msg-7"]);
  });
  it("närvaro och aktiviteter för veckorapporten, men inte för andras deltagare", async () => {
    const att = await repoFor(MARIA).table("attendance").list();
    const own = new Set(all("cases").filter((c) => c.referrerId === "k-maria").map((c) => c.id));
    expect(att.length).toBe(all("attendance").filter((a) => own.has(a.caseId)).length);
    expect(att.every((a) => own.has(a.caseId))).toBe(true);
  });
  it("Omar ser sin skyddade beställning – han lämnade uppgifterna", async () => {
    const skyddad = raw.get("cases", tagged("skyddad"))!;
    expect(skyddad.referrerId).toBe("k-omar");
    expect(await repoFor(OMAR).table("persons").get(skyddad.personId)).not.toBeNull();
  });
});

describe("kommunens chef: enhetens ärenden men inte skyddade personer", () => {
  it("ser alla ärenden i enheten, det skyddade bara som ärende", async () => {
    expect(await count(EVA, "cases")).toBe(231);
    const skyddad = raw.get("cases", tagged("skyddad"))!;
    expect(await repoFor(EVA).table("cases").get(skyddad.id)).not.toBeNull();
    expect(await repoFor(EVA).table("persons").get(skyddad.personId)).toBeNull();
    expect(await count(EVA, "persons")).toBe(229);
    expect((await repoFor(EVA).table("attendance").list()).some((a) => a.caseId === skyddad.id)).toBe(false);
  });
  it("beställarrapporterna som levererats till henne och individrapporter enligt avtalet (seesIndividualReports)", async () => {
    const reps = await repoFor(EVA).table("reports").list();
    expect(reps.filter((r) => r.kind === "customer_summary").map((r) => r.month)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(reps.every((r) => r.deliveredAt)).toBe(true);
    expect(reps.some((r) => r.kind === "monthly")).toBe(true);
    expect(reps.some((r) => r.caseId === tagged("skyddad"))).toBe(false);
  });
  it("avtalsavvikelser att godkänna – men inga coachanteckningar", async () => {
    expect(await count(EVA, "contract_deviations")).toBe(3);
    for (const n of NOTE_TABLES) expect([n, await count(EVA, n)]).toEqual([n, 0]);
  });
});

describe("ekonomen ser inga coachanteckningar", () => {
  it("ärenden, närvaro, priser och fakturor – men inga namn, anteckningar, rapporter eller meddelanden", async () => {
    expect(await count(LARS, "cases")).toBe(231);
    expect(await count(LARS, "activities")).toBe(3861);
    expect(await count(LARS, "attendance")).toBe(3590);
    expect(await count(LARS, "price_items")).toBe(12);
    expect(await count(LARS, "billing_runs")).toBe(5);
    expect(await count(LARS, "invoice_drafts")).toBe(3);
    expect(await count(LARS, "buyer_references")).toBe(4);
    for (const n of [...NOTE_TABLES, "persons", "reports", "messages", "pulse_invites", "pulse_responses", "case_status_history", "outcome_events", "placements", "ai_runs", "inbound_emails", "audit_log"] as const) {
      expect([n, await count(LARS, n)]).toEqual([n, 0]);
    }
  });
  it("uppgiften från avtalsansvarig om rätt beställarreferens", async () => {
    expect((await repoFor(LARS).table("tasks").list()).map((t) => t.id)).toEqual(["task-1"]);
  });
});

describe("handledaren ser bara tilldelade ärenden", () => {
  it("ärenden och anteckningar bara där hon är i teamet", async () => {
    const assigned = new Set(all("case_team").filter((t) => t.userId === "u-petra").map((t) => t.caseId));
    const cases = await repoFor(PETRA).table("cases").list();
    expect(cases).toHaveLength(63);
    expect(cases.every((c) => assigned.has(c.id))).toBe(true);
    const cis = await repoFor(PETRA).table("check_ins").list();
    expect(cis.length).toBeGreaterThan(0);
    expect(cis.every((x) => assigned.has(x.caseId))).toBe(true);
  });
  it("bara veckorapporter – månads- och slutrapporter innehåller coachens bedömningar", async () => {
    const reps = await repoFor(PETRA).table("reports").list();
    expect(reps.length).toBeGreaterThan(0);
    expect(reps.every((r) => r.kind === "weekly_attendance")).toBe(true);
  });
  it("coachen ser egna ärenden och team, inte andras", async () => {
    expect(await count(AMIRA, "cases")).toBe(29);
    const nadia = tagged("nadia");
    expect(await repoFor(ERIK).table("cases").get(nadia)).toBeNull();
    expect((await repoFor(ERIK).table("check_ins").list()).some((x) => x.caseId === nadia)).toBe(false);
  });
});

describe("skyddade personuppgifter syns bara för namngivna", () => {
  const skyddad = () => raw.get("cases", tagged("skyddad"))!;
  it("personen: bara namngiven huvudcoach, avtalsansvarig och beställande handläggare", async () => {
    const c = skyddad();
    const seeing: string[] = [];
    for (const p of listPersonas(raw)) if (await repoFor(p.actor).table("persons").get(c.personId)) seeing.push(`${p.actor.userId}:${p.actor.role}`);
    expect(seeing.sort()).toEqual([`${c.leadCoachId}:coach`, "k-omar:kommun_handlaggare", "u-johan:avtalsansvarig"].sort());
  });
  it("samordnare, chef och admin ser ärendet men inga detaljer", async () => {
    const c = skyddad();
    for (const a of [SARA, KARIN, ROBIN]) {
      expect(await repoFor(a).table("cases").get(c.id)).not.toBeNull();
      for (const n of [...NOTE_TABLES, "activities", "attendance", "case_status_history", "case_team", "messages", "outcome_events"] as const) {
        const rows = (await repoFor(a).table(n).list()) as { caseId: string }[];
        expect([a.role, n, rows.some((r) => r.caseId === c.id)]).toEqual([a.role, n, false]);
      }
      expect((await repoFor(a).table("reports").list()).some((r) => r.caseId === c.id)).toBe(false);
    }
    // Den namngivna coachen ser allt
    const lead = who(c.leadCoachId!, "coach");
    expect((await repoFor(lead).table("check_ins").list()).some((x) => x.caseId === c.id)).toBe(true);
  });
  it("teammedlemmar i det skyddade ärendet ser det inte", async () => {
    const c = skyddad();
    for (const t of all("case_team").filter((x) => x.caseId === c.id && x.role !== "lead_coach")) {
      expect(await repoFor(who(t.userId)).table("cases").get(c.id)).toBeNull();
    }
  });
});

describe("pulssvar, notiser, revisionslogg och utskick", () => {
  it("coachen läser inga enskilda pulssvar – chef och samordnare gör det", async () => {
    expect(await count(AMIRA, "pulse_responses")).toBe(0);
    expect(await count(PETRA, "pulse_responses")).toBe(0);
    expect(await count(KARIN, "pulse_responses")).toBe(217);
    expect(await count(SARA, "pulse_responses")).toBe(217);
    expect(await count(MARIA, "pulse_responses")).toBe(0);
  });
  it("notiser bara till mottagaren", async () => {
    const mine = await repoFor(AMIRA).table("user_notifications").list();
    expect(mine.length).toBe(all("user_notifications").filter((n) => n.recipientId === "u-amira").length);
    expect(mine.every((n) => n.recipientId === "u-amira")).toBe(true);
    expect(await count(KARIN, "user_notifications")).toBe(0);
    expect((await repoFor(AMIRA).table("notification_reads").list()).every((r) => r.userId === "u-amira")).toBe(true);
  });
  it("revisionsloggen: admin och chef", async () => {
    expect(await count(ROBIN, "audit_log")).toBe(20);
    expect(await count(KARIN, "audit_log")).toBe(20);
    for (const a of [SARA, JOHAN, AMIRA, LARS, MARIA, EVA]) expect([a.role, await count(a, "audit_log")]).toEqual([a.role, 0]);
  });
  it("utskick: admin och samordnare", async () => {
    expect(await count(ROBIN, "outbound_messages")).toBe(8);
    expect(await count(SARA, "outbound_messages")).toBe(8);
    for (const a of [JOHAN, AMIRA, KARIN, LARS, MARIA]) expect([a.role, await count(a, "outbound_messages")]).toEqual([a.role, 0]);
  });
  it("interna regler: MB läser, kommunen inte", async () => {
    expect(await count(AMIRA, "org_settings")).toBe(1);
    expect(await count(EVA, "org_settings")).toBe(0);
  });
  it("avtal: bara avtal man är medlem i", async () => {
    expect((await repoFor(SARA).table("contracts").list()).map((c) => c.id)).toEqual(["c-bot"]);
    expect((await repoFor(JOHAN).table("contracts").list()).map((c) => c.id)).toEqual(["c-bot", "c-kk"]);
    expect((await repoFor(MARIA).table("contracts").list()).map((c) => c.id)).toEqual(["c-bot"]);
  });
  it("avropsinkorgen: samordnare och avtalsansvarig – inte coach eller kommun", async () => {
    expect(await count(SARA, "inbound_emails")).toBe(27);
    expect(await count(AMIRA, "inbound_emails")).toBe(0);
    expect(await count(MARIA, "inbound_emails")).toBe(0);
  });
});

describe("skrivregler", () => {
  const fresh = () => new MemoryStore<Tables>(createSeed());
  const msg = (id: string, caseId: string, senderId: string) => ({ id, caseId, senderId, body: "Hej", createdAt: "2027-02-01T09:13", readBy: [], readAt: null, kind: null });

  it("kommunen skickar meddelanden bara i sina egna ärenden och i eget namn", async () => {
    const s = fresh();
    const nadia = tagged("nadia");
    const other = all("cases").find((c) => c.referrerId === "k-ahmed")!.id;
    await expect(repoFor(MARIA, s).table("messages").insert(msg("m-a", nadia, "k-maria"))).resolves.toBeTruthy();
    await expect(repoFor(MARIA, s).table("messages").insert(msg("m-b", other, "k-maria"))).rejects.toBeInstanceOf(PolicyError);
    await expect(repoFor(MARIA, s).table("messages").insert(msg("m-c", nadia, "u-amira"))).rejects.toBeInstanceOf(PolicyError);
    await expect(repoFor(EVA, s).table("messages").insert(msg("m-d", nadia, "k-eva"))).rejects.toBeInstanceOf(PolicyError);
    // Läskvitto på ett befintligt meddelande
    await expect(repoFor(MARIA, s).table("messages").update("msg-2", { readBy: ["k-maria"] })).resolves.toBeTruthy();
  });
  it("kommunen beställer bara i eget namn", async () => {
    const s = fresh();
    const base = { ...all("cases").find((c) => c.id === tagged("inkorg-mall"))! };
    await expect(repoFor(MARIA, s).table("cases").insert({ ...base, id: "case-new-1", referrerId: "k-maria" })).resolves.toBeTruthy();
    await expect(repoFor(MARIA, s).table("cases").insert({ ...base, id: "case-new-2", referrerId: "k-ahmed" })).rejects.toBeInstanceOf(PolicyError);
    await expect(repoFor(EVA, s).table("cases").insert({ ...base, id: "case-new-3", referrerId: "k-eva" })).rejects.toBeInstanceOf(PolicyError);
  });
  it("coachen ändrar bara sina ärenden; chef och admin är i läsläge", async () => {
    const s = fresh();
    const nadia = tagged("nadia");
    await expect(repoFor(AMIRA, s).table("cases").update(nadia, { phase: 5 })).resolves.toBeTruthy();
    await expect(repoFor(ERIK, s).table("cases").update(nadia, { phase: 5 })).rejects.toBeInstanceOf(PolicyError);
    await expect(repoFor(KARIN, s).table("cases").update(nadia, { phase: 5 })).rejects.toBeInstanceOf(PolicyError);
    await expect(repoFor(ROBIN, s).table("cases").update(nadia, { phase: 5 })).rejects.toBeInstanceOf(PolicyError);
    const ci = all("check_ins").find((x) => x.caseId === nadia)!;
    await expect(repoFor(KARIN, s).table("check_ins").update(ci.id, { note: "x" })).rejects.toBeInstanceOf(PolicyError);
    await expect(repoFor(AMIRA, s).table("check_ins").update(ci.id, { note: "x" })).resolves.toBeTruthy();
  });
  it("handledaren registrerar närvaro i tilldelade ärenden", async () => {
    const s = fresh();
    const assigned = all("case_team").find((t) => t.userId === "u-petra")!.caseId;
    const act = all("activities").find((a) => a.caseId === assigned)!;
    const notAssigned = all("activities").find((a) => !all("case_team").some((t) => t.caseId === a.caseId && t.userId === "u-petra"))!;
    const att = (id: string, a: typeof act) => ({ id, activityId: a.id, caseId: a.caseId, status: "present" as const, reason: "", registeredBy: "u-petra", registeredAt: "2027-02-01T09:13", customerNotifiedAt: null });
    await expect(repoFor(PETRA, s).table("attendance").insert(att("at-x1", act))).resolves.toBeTruthy();
    await expect(repoFor(PETRA, s).table("attendance").insert(att("at-x2", notAssigned))).rejects.toBeInstanceOf(PolicyError);
  });
  it("ekonomen rättar beställarreferensen men kan inte skriva anteckningar", async () => {
    const s = fresh();
    const reffel = tagged("reffel1");
    await expect(repoFor(LARS, s).table("cases").update(reffel, { buyerReference: "55102938" })).resolves.toBeTruthy();
    await expect(repoFor(LARS, s).table("deviations").insert({ ...all("deviations")[0], id: "dev-x" })).rejects.toBeInstanceOf(PolicyError);
  });
  it("kvittens av rapport: kommunen får markera sina levererade rapporter som öppnade", async () => {
    const s = fresh();
    const mine = all("reports").find((r) => r.deliveredAt && r.deliveredTo.includes("k-maria") && !r.openedAt)!;
    await expect(repoFor(MARIA, s).table("reports").update(mine.id, { openedAt: "2027-02-01T09:13", openedBy: "k-maria" })).resolves.toBeTruthy();
    const others = all("reports").find((r) => r.deliveredAt && r.deliveredTo.includes("k-ahmed"))!;
    await expect(repoFor(MARIA, s).table("reports").update(others.id, { openedAt: "2027-02-01T09:13" })).rejects.toBeInstanceOf(PolicyError);
  });
  it("revisionslogg, utskick och notiser skrivs bara av systemet", async () => {
    const s = fresh();
    await expect(repoFor(ROBIN, s).table("audit_log").insert({ id: "log-x", occurredAt: "2027-02-01T09:13", actorId: "u-robin", action: "x", entity: "x", entityId: null, contractId: "c-bot", details: {} })).rejects.toBeInstanceOf(PolicyError);
    await expect(repoFor(ROBIN, s).table("audit_log").remove(all("audit_log")[0].id)).rejects.toBeInstanceOf(PolicyError);
    await expect(repoFor(SARA, s).table("outbound_messages").insert({ id: "out-x", createdAt: "2027-02-01T09:13", channel: "email", to: "x", template: "x", subject: null, body: "x", caseId: null, status: "sent", sentAt: null })).rejects.toBeInstanceOf(PolicyError);
    await expect(repoFor(AMIRA, s).table("user_notifications").insert({ ...all("user_notifications")[0], id: "un-x" })).rejects.toBeInstanceOf(PolicyError);
  });
  it("deltagaren svarar på en oanvänd pulslänk men kan inte läsa svaren", async () => {
    const s = fresh();
    const inv = all("pulse_invites").find((i) => i.id === "pi-demo")!;
    const answer = { id: "pr-x", inviteId: inv.id, caseId: inv.caseId, coachId: null, occasion: inv.occasion, language: "sv", answers: { q1: 5 as const, q2: 4 as const, q3: 5 as const, q4: "jobb" as const, q5: "nej" as const }, text: "", contactRequested: false, submittedAt: "2027-02-01T09:13" };
    await expect(repoFor(DELTAGARE, s).table("pulse_responses").insert(answer)).resolves.toBeTruthy();
    expect(await repoFor(DELTAGARE, s).table("pulse_responses").get("pr-x")).toBeNull();
    const used = all("pulse_invites").find((i) => i.usedAt)!;
    await expect(repoFor(DELTAGARE, s).table("pulse_responses").insert({ ...answer, id: "pr-y", inviteId: used.id, caseId: used.caseId })).rejects.toBeInstanceOf(PolicyError);
    await expect(repoFor(AMIRA, s).table("pulse_responses").insert({ ...answer, id: "pr-z" })).rejects.toBeInstanceOf(PolicyError);
  });
  it("kommunens chef godkänner åtgärdsplaner men skapar inga avtalsavvikelser", async () => {
    const s = fresh();
    await expect(repoFor(EVA, s).table("contract_deviations").update("cd-3", { customerApprovedAt: "2027-02-01T09:13", customerApprovedBy: "k-eva" })).resolves.toBeTruthy();
    await expect(repoFor(EVA, s).table("contract_deviations").insert({ ...all("contract_deviations")[0], id: "cd-x" })).rejects.toBeInstanceOf(PolicyError);
    await expect(repoFor(MARIA, s).table("contract_deviations").update("cd-3", { customerApprovedAt: "2027-02-01T09:13" })).rejects.toBeInstanceOf(PolicyError);
  });
  it("konfiguration: bara admin", async () => {
    const s = fresh();
    await expect(repoFor(ROBIN, s).table("contracts").update("c-bot", { name: "x" })).resolves.toBeTruthy();
    await expect(repoFor(JOHAN, s).table("contracts").update("c-bot", { name: "y" })).rejects.toBeInstanceOf(PolicyError);
    await expect(repoFor(SARA, s).table("org_settings").update("org-mb", { updatedBy: "u-sara" })).rejects.toBeInstanceOf(PolicyError);
  });
});

describe("röstinspelning: länkar, deltagarens röstmeddelanden och ljudfiler", () => {
  const fresh = () => new MemoryStore<Tables>(createSeed());
  const ids = async (actor: Actor, name: "voice_links" | "participant_voice_notes" | "audio_uploads", s = store) =>
    (await repoFor(actor, s).table(name).list()).map((r) => r.id).sort();
  const protectedCase = all("cases").find((c) => all("persons").find((p) => p.id === c.personId)?.protectedIdentity)!;
  const link = (id: string, caseId: string, createdBy: string): Tables["voice_links"] => ({
    id, caseId, tokenHash: `hash-${id}`, channel: "sms", language: "sv", sentAt: "2027-02-01T09:13", expiresAt: "2027-02-08T09:13", usedAt: null, createdBy,
  });

  it("coachen och teamet läser röstmeddelandena i sina ärenden – aldrig ekonomen, andra coacher eller kommunen", async () => {
    expect(await ids(AMIRA, "participant_voice_notes")).toEqual(["pvn-nadia", "pvn-yusuf"]);
    expect(await ids(AMIRA, "voice_links")).toEqual(["vl-demo", "vl-nadia", "vl-yusuf"]);
    // Petra är handledare i Nadias team men inte i Yusufs
    expect(await ids(PETRA, "participant_voice_notes")).toEqual(["pvn-nadia"]);
    for (const a of [LARS, ERIK, MARIA, EVA, DELTAGARE]) {
      expect([a.userId, await ids(a, "participant_voice_notes")]).toEqual([a.userId, []]);
      expect([a.userId, await ids(a, "voice_links")]).toEqual([a.userId, []]);
    }
    // Samordnare och avtalsansvarig ser allt i avtalet (full åtkomst), chefen i läsläge
    expect(await ids(SARA, "participant_voice_notes")).toEqual(["pvn-nadia", "pvn-yusuf"]);
    expect(await ids(KARIN, "voice_links")).toEqual(["vl-demo", "vl-nadia", "vl-yusuf"]);
  });

  it("kommunen läser granskade röstmeddelanden bara om avtalet säger det", async () => {
    const s = fresh();
    const bot = s.getRow("contracts", "c-bot")!;
    s.updateRow("contracts", "c-bot", { config: { ...bot.config, customerVisibility: { ...bot.config.customerVisibility!, seesParticipantVoiceNotes: true } } });
    // Yusufs röstmeddelande är granskat, Nadias väntar – båda i Marias ärenden
    expect(await ids(MARIA, "participant_voice_notes", s)).toEqual(["pvn-yusuf"]);
    expect(await ids(EVA, "participant_voice_notes", s)).toEqual(["pvn-yusuf"]);
    expect(await ids(who("k-ahmed"), "participant_voice_notes", s)).toEqual([]);
    expect(await ids(LARS, "participant_voice_notes", s)).toEqual([]);
    // Länkar och ljudfiler ser kommunen fortfarande inte
    expect(await ids(MARIA, "voice_links", s)).toEqual([]);
    expect(await ids(MARIA, "audio_uploads", s)).toEqual([]);
  });

  it("röstlänkar skapas av den som arbetar i ärendet – aldrig i skyddade ärenden, inte ens av namngiven coach", async () => {
    const s = fresh();
    const nadia = tagged("nadia");
    await expect(repoFor(AMIRA, s).table("voice_links").insert(link("vl-a", nadia, "u-amira"))).resolves.toBeTruthy();
    await expect(repoFor(SARA, s).table("voice_links").insert(link("vl-b", nadia, "u-sara"))).resolves.toBeTruthy();
    expect(protectedCase.leadCoachId).toBe("u-erik");
    await expect(repoFor(ERIK, s).table("voice_links").insert(link("vl-c", protectedCase.id, "u-erik"))).rejects.toBeInstanceOf(PolicyError);
    await expect(repoFor(JOHAN, s).table("voice_links").insert(link("vl-d", protectedCase.id, "u-johan"))).rejects.toBeInstanceOf(PolicyError);
    for (const a of [LARS, MARIA, KARIN, ROBIN, DELTAGARE]) {
      await expect(repoFor(a, s).table("voice_links").insert(link(`vl-${a.userId}`, nadia, a.userId))).rejects.toBeInstanceOf(PolicyError);
    }
  });

  it("granskningen ändrar bara status och görs i eget namn; nya röstmeddelanden sparas bara av systemet", async () => {
    const s = fresh();
    const t = () => repoFor(AMIRA, s).table("participant_voice_notes");
    await expect(t().update("pvn-nadia", { textSv: "Ändrad" })).rejects.toBeInstanceOf(PolicyError);
    await expect(t().update("pvn-nadia", { status: "reviewed", reviewedBy: "u-sara", reviewedAt: "2027-02-01T09:13" })).rejects.toBeInstanceOf(PolicyError);
    await expect(t().update("pvn-nadia", { status: "reviewed", reviewedBy: "u-amira", reviewedAt: "2027-02-01T09:13" })).resolves.toMatchObject({ status: "reviewed" });
    await expect(t().update("pvn-yusuf", { status: "archived" })).resolves.toMatchObject({ status: "archived" });
    await expect(repoFor(LARS, s).table("participant_voice_notes").update("pvn-nadia", { status: "archived" })).rejects.toBeInstanceOf(PolicyError);
    const note = { ...all("participant_voice_notes")[0], id: "pvn-ny" };
    for (const a of [AMIRA, SARA, DELTAGARE]) await expect(repoFor(a, s).table("participant_voice_notes").insert(note)).rejects.toBeInstanceOf(PolicyError);
  });

  it("ljudfilernas rader: bara systemet skriver; den som spelat in och den som arbetar i ärendet läser läget", async () => {
    const s = fresh();
    expect(await ids(AMIRA, "audio_uploads")).toEqual(["aud-mehmet", "aud-pvn-nadia", "aud-pvn-yusuf"]);
    expect(await ids(PETRA, "audio_uploads")).toEqual(["aud-mehmet", "aud-pvn-nadia"]);
    for (const a of [LARS, MARIA, ERIK, DELTAGARE]) expect([a.userId, await ids(a, "audio_uploads")]).toEqual([a.userId, []]);
    const u = all("audio_uploads").find((x) => x.id === "aud-mehmet")!;
    for (const a of [AMIRA, ROBIN, MARIA]) {
      await expect(repoFor(a, s).table("audio_uploads").update(u.id, { status: "uploaded", deletedAt: null })).rejects.toBeInstanceOf(PolicyError);
      await expect(repoFor(a, s).table("audio_uploads").insert({ ...u, id: `aud-${a.userId}`, ownerId: a.userId })).rejects.toBeInstanceOf(PolicyError);
    }
    // Kommunens "Tala in": bara den som talade in läser raden
    s.insertRow("audio_uploads", { ...u, id: "aud-diktat", caseId: tagged("nadia"), ownerId: "k-maria", purpose: "dictation", storagePath: "dictation/aud-diktat.webm" });
    expect(await ids(MARIA, "audio_uploads", s)).toEqual(["aud-diktat"]);
    expect(await ids(AMIRA, "audio_uploads", s)).not.toContain("aud-diktat");
  });
});

describe("fria anteckningar (case_notes, rapporter steg 2)", () => {
  const NADIA = tagged("nadia");
  const SKYDDAD = tagged("skyddad");
  const ids = async (a: Actor) => (await repoFor(a).table("case_notes").list()).map((n) => n.id).sort();
  const fresh = () => new MemoryStore<Tables>(createSeed());
  const base = (patch: Partial<Tables["case_notes"]> = {}): Tables["case_notes"] => ({
    id: "note-x", contractId: "c-bot", caseId: NADIA, authorId: "u-amira", occurredOn: "2027-01-30", kind: "other", audience: "full", body: "Text",
    createdAt: "2027-02-01T09:30", updatedAt: null, removedAt: null, removedBy: null, ...patch,
  });

  it("läsning: full eller team (team bara 'team'), aldrig ekonom eller kommunen; skyddat ärende bara namngivna", async () => {
    expect(await ids(AMIRA)).toEqual(["note-mehmet-handledare", "note-nadia-borttagen", "note-nadia-kommun", "note-nadia-praktiskt", "note-nadia-samtal"]);
    expect(await ids(PETRA)).toEqual(["note-mehmet-handledare", "note-nadia-borttagen", "note-nadia-praktiskt"]);
    for (const a of [LARS, MARIA, EVA, OMAR, who("u-leila")]) expect(await ids(a), a.userId).toEqual([]);
    expect(await ids(ERIK)).toEqual(["note-skyddad"]);
    expect(await ids(JOHAN)).toContain("note-skyddad");
    for (const a of [SARA, KARIN, ROBIN]) expect(await ids(a), a.userId).not.toContain("note-skyddad");
    expect(raw.get("case_notes", "note-skyddad")?.caseId).toBe(SKYDDAD);
  });

  it("skriva: den som arbetar i ärendet i eget namn – teamet bara 'team', chef, admin och ekonom aldrig", async () => {
    const s = fresh();
    await expect(repoFor(AMIRA, s).table("case_notes").insert(base())).resolves.toBeTruthy();
    await expect(repoFor(PETRA, s).table("case_notes").insert(base({ id: "note-y", authorId: "u-petra", audience: "team" }))).resolves.toBeTruthy();
    await expect(repoFor(PETRA, s).table("case_notes").insert(base({ id: "note-z", authorId: "u-petra", audience: "full" }))).rejects.toBeInstanceOf(PolicyError);
    await expect(repoFor(AMIRA, s).table("case_notes").insert(base({ id: "note-w", authorId: "u-sara" }))).rejects.toBeInstanceOf(PolicyError);
    for (const a of [KARIN, ROBIN, LARS, MARIA]) {
      await expect(repoFor(a, s).table("case_notes").insert(base({ id: `note-${a.userId}`, authorId: a.userId, audience: "team" })), a.userId).rejects.toBeInstanceOf(PolicyError);
    }
  });

  it("ändra bara författaren, dölja även samordnare och avtalsansvarig – en borttagen anteckning är låst och ingen raderar", async () => {
    const s = fresh();
    const t = (a: Actor) => repoFor(a, s).table("case_notes");
    await expect(t(SARA).update("note-nadia-samtal", { body: "Ändrad" })).rejects.toBeInstanceOf(PolicyError);
    await expect(t(AMIRA).update("note-nadia-samtal", { body: "Ändrad", updatedAt: "2027-02-01T09:40" })).resolves.toBeTruthy();
    await expect(t(PETRA).update("note-nadia-praktiskt", { removedAt: "2027-02-01T09:40", removedBy: "u-petra" })).rejects.toBeInstanceOf(PolicyError);
    await expect(t(SARA).update("note-nadia-praktiskt", { removedAt: "2027-02-01T09:40", removedBy: "u-sara", body: "x" })).rejects.toBeInstanceOf(PolicyError);
    await expect(t(SARA).update("note-nadia-praktiskt", { removedAt: "2027-02-01T09:40", removedBy: "u-sara" })).resolves.toBeTruthy();
    await expect(t(AMIRA).update("note-nadia-praktiskt", { removedAt: null, removedBy: null })).rejects.toBeInstanceOf(PolicyError);
    await expect(t(AMIRA).update("note-nadia-borttagen", { body: "Ny" })).rejects.toBeInstanceOf(PolicyError);
    await expect(t(AMIRA).remove("note-nadia-samtal")).rejects.toBeInstanceOf(PolicyError);
    await expect(t(JOHAN).update("note-skyddad", { removedAt: "2027-02-01T09:40", removedBy: "u-johan" })).resolves.toBeTruthy();
  });
});

describe("prestanda", () => {
  it("en coach listar alla aktiviteter och närvaro snabbt", async () => {
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) {
      await repoFor(AMIRA).table("activities").list();
      await repoFor(AMIRA).table("attendance").list();
    }
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
