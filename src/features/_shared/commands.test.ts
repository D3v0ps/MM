// Tester för de delade kommandona (portade från prototypens 03-domain.js). Kommandona körs genom samma execute() som
// riktiga appen och prototypen, mot testdatat i minnet och som testpersonerna i rollväljaren (behörighet via policy.ts).
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START, decodeTestPnr, normalizePnr } from "@/data/seed";
import type { MemoryData } from "@/data/memory";
import type { OutboundMessage, TableName, Tables } from "@/data/schema";
import { weeklyReport } from "@/core/weekly-report";
import { addMinutes } from "@/core/time";

/** Tiden för första kommandot: klockan flyttas en minut före varje kommando (som i den gamla prototypen). */
const T1 = addMinutes(DEMO_START, 1);
import { addDays, monday } from "@/core/time";
import { avropDue } from "@/core/sla";
import { BOTKYRKA_CONFIG } from "@/core/config";
import {
  caseAccept, caseBookFirstMeeting, caseChangeCoach, caseClose, caseCreate, caseDecline, caseSetBuyerRef, caseUpdate, consentSet, messageRead, messageSend,
} from "@/features/arenden/api";
import { emailApplySupplement, emailSetStatus } from "@/features/inkorg/api";
import { aiRun, assessmentSave, attendanceSet, checkinSave, deviationCallCustomer, deviationSave, eventAdd, intakeSave, resultVerify } from "@/features/coach/api";
import { reportApprove, reportCorrect, reportDeliver, reportOpen } from "@/features/rapporter/api";
import { notifRead } from "@/features/notiser/api";
import { alertAck } from "@/features/ledning/api";
import { billingApproveInvoice, billingApproveZeroWeek, billingExport, billingMarkManual, billingSendFortnox } from "@/features/ekonomi/api";
import { auditView } from "@/features/session/api";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});

// ---------------------------------------------------------------- Hjälpare
const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCommand = CommandDef<any, any>;
const run = <D extends AnyCommand>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
const rows = <N extends TableName>(name: N): Tables[N][] => rt.store.rows(name);
const row = <N extends TableName>(name: N, id: string): Tables[N] | undefined => rt.raw().get(name, id);
const outboundSince = (n: number): OutboundMessage[] => rows("outbound_messages").slice(n);

const sara = () => as("u-sara", "samordnare");
const johan = () => as("u-johan", "avtalsansvarig");
const amira = () => as("u-amira", "coach");
const lars = () => as("u-lars", "ekonom");
const maria = () => as("k-maria", "kommun_handlaggare");
const eva = () => as("k-eva", "kommun_chef");

/** Utskick får aldrig innehålla personuppgifter: inga namn eller personnummer på deltagare (CLAUDE.md punkt 9). */
function expectNoPersonalData(msgs: readonly OutboundMessage[]) {
  const pii = rows("persons").flatMap((p) => [p.firstName, p.lastName, normalizePnr(decodeTestPnr(p.personnummerEnc))]).filter((x) => x && x.length >= 4);
  for (const m of msgs) {
    const text = `${m.to} ${m.subject ?? ""} ${m.body}`;
    const digits = text.replace(/\D/g, "");
    for (const x of pii) {
      if (/^\d+$/.test(x)) expect(digits.includes(x), `personnummer i utskicket ${m.template}`).toBe(false);
      else expect(new RegExp(`\\b${x}\\b`).test(text), `namnet ${x} i utskicket ${m.template}`).toBe(false);
    }
  }
}

async function expectForbidden(p: Promise<unknown>) {
  await expect(p).rejects.toBeInstanceOf(ApiError);
  await p.catch((e: ApiError) => expect(e.status).toBe(403));
}

// ================================================================ Ärenden
describe("arenden.caseAccept (case.accept)", () => {
  it("utan giltig beställarreferens → buyer_ref och inget ändras", async () => {
    const before = row("cases", "case-270049")!;
    expect(before.buyerReference).toBeNull();
    const res = await run(caseAccept, { caseId: "case-270049", leadCoachId: "u-amira", firstMeetingAt: "2027-02-03T10:00", plannedWeeks: 6 }, sara());
    expect(res).toMatchObject({ ok: false, error: "buyer_ref", message: "Beställarreferens saknas. Den får ni av kommunens ekonomi eller er chef." });
    const bad = await run(caseAccept, { caseId: "case-270049", leadCoachId: "u-amira", firstMeetingAt: "2027-02-03T10:00", plannedWeeks: 6, buyerReference: "123" }, sara());
    expect(bad).toMatchObject({ ok: false, error: "buyer_ref", message: "Beställarreferensen ska vara 8–10 siffror. Du har skrivit 3." });
    expect(row("cases", "case-270049")!.status).toBe("acknowledged");
    expect(rows("reports").filter((r) => r.caseId === "case-270049")).toHaveLength(0);
  });

  it("med giltig referens → bekräftad, orderbekräftelse, team, notiser och utskick utan personnummer", async () => {
    const n = rows("outbound_messages").length;
    const due = avropDue({ ...row("cases", "case-270050")! }, BOTKYRKA_CONFIG);
    expect(due).toBe("2027-02-02T08:41");
    const res = await run(caseAccept, { caseId: "case-270050", leadCoachId: "u-amira", firstMeetingAt: "2027-02-03T10:00", plannedWeeks: 6, team: [{ userId: "u-petra", role: "vocational_supervisor" }] }, sara());
    expect(res).toMatchObject({ ok: true, caseNumber: "BOT-27-0050" });
    if (!res.ok) return;
    const c = row("cases", "case-270050")!;
    expect(c).toMatchObject({
      status: "confirmed", confirmedAt: T1, leadCoachId: "u-amira", buyerReference: "4410023817", firstMeetingAt: "2027-02-03T10:00",
      plannedStart: "2027-02-03", plannedWeeks: 6, orderValueWeeks: 6, plannedEnd: addDays(monday("2027-02-03"), 5 * 7 + 4),
    });
    expect(c.plannedEnd).toBe("2027-03-12");
    const rep = row("reports", res.reportId)!;
    expect(rep).toMatchObject({ kind: "order_confirmation", status: "delivered", deliveredTo: ["k-maria"], approvedBy: "u-sara", caseId: "case-270050", dueAt: due });
    expect(rows("case_team").filter((t) => t.caseId === "case-270050").map((t) => [t.userId, t.role])).toEqual([["u-amira", "lead_coach"], ["u-petra", "vocational_supervisor"]]);
    expect(rows("case_status_history").filter((h) => h.caseId === "case-270050").pop()).toMatchObject({ fromStatus: "acknowledged", toStatus: "confirmed", toCoach: "u-amira", reason: "Avrop accepterat" });
    expect(row("inbound_emails", "em-101")).toMatchObject({ status: "accepted", handledBy: "u-sara" });
    const notes = rows("user_notifications").filter((x) => x.caseId === "case-270050");
    expect(notes.map((x) => [x.recipientId, x.title, x.body, x.emailBody])).toEqual([
      ["u-amira", "Nytt ärende tilldelat dig", "Du är huvudcoach för BOT-27-0050 (J Parti- och detaljhandel). Första möte 3 feb kl. 10.00.", "Du har fått ett nytt ärende i Miljonmatch: BOT-27-0050. Logga in för att se detaljerna."],
      ["u-petra", "Du har lagts till i ett team", "Du är yrkesspecifik handledare för BOT-27-0050.", "Du har fått ett nytt ärende i Miljonmatch: BOT-27-0050. Logga in för att se detaljerna."],
    ]);
    const out = outboundSince(n);
    expect(out.map((m) => [m.template, m.to])).toEqual([
      ["tilldelning_coach", "amira.haddad@miljonbemanning.se"],
      ["tilldelning_coach", "petra.ek@miljonbemanning.se"],
      ["orderbekraftelse", "maria.ekdahl@botkyrka.se"],
      ["kallelse", "deltagare (e-post)"],
    ]);
    expect(out[2].body).toBe("Orderbekräftelse för ärende BOT-27-0050 finns i portalen – logga in för att läsa. Startdatum och ansvarig coach framgår där.");
    expect(out[3]).toMatchObject({ channel: "email", body: "Välkommen till Miljonbemanning! Ditt första möte är onsdag 3 februari klockan 10.00 i Alby. Frågor? Ring 08-000 00 00." });
    expectNoPersonalData(out);
    expect(rows("audit_log").pop()).toMatchObject({ action: "case.accepted", entityId: "case-270050", actorId: "u-sara", details: { withinSla: true } });
    // Ett andra svar på samma avrop skapar ingen ny orderbekräftelse
    const again = await run(caseAccept, { caseId: "case-270050", leadCoachId: "u-amira", firstMeetingAt: "2027-02-03T10:00" }, sara());
    expect(again).toMatchObject({ ok: false, error: "wrong_status" });
  });

  it("en kommunanvändare kan inte acceptera (403)", async () => {
    await expectForbidden(run(caseAccept, { caseId: "case-270050", leadCoachId: "u-amira" }, maria()));
  });

  it("kompletteringen från mejlet ger referensen så att avropet kan accepteras", async () => {
    const r1 = await run(emailApplySupplement, { emailId: "em-103" }, sara());
    expect(r1).toMatchObject({ ok: true, fields: ["buyerReference", "plannedEnd"] });
    expect(row("cases", "case-270049")).toMatchObject({ buyerReference: "55102938", plannedEnd: "2027-03-19" });
    expect(row("inbound_emails", "em-103")).toMatchObject({ status: "applied", handledBy: "u-sara" });
    const orig = rows("inbound_emails").find((e) => e.caseId === "case-270049" && e.classification === "order")!;
    expect(orig.missingFields).not.toContain("buyerReference");
    expect(await run(caseAccept, { caseId: "case-270049", leadCoachId: "u-amira", firstMeetingAt: "2027-02-03T10:00" }, sara())).toMatchObject({ ok: true });
  });
});

describe("arenden.caseCreate (case.create)", () => {
  const order = { firstName: "Testa", lastName: "Testsson", pnr: "19900101-1234", phone: "070-000 00 00", city: "Tumba", preferredContact: "sms" as const,
    buyerReference: "4410023817", primaryArea: "G", desiredStart: "2027-02-08", plannedWeeks: 6, source: "portal" as const };

  it("via portalen ger nästa ärendenummer i serien och ordererkännande utan personuppgifter", async () => {
    const n = rows("outbound_messages").length;
    const r1 = await run(caseCreate, { ...order, referrerId: "k-ahmed" }, maria());
    expect(r1).toMatchObject({ ok: true, caseNumber: "BOT-27-0051" });
    const r2 = await run(caseCreate, { ...order, pnr: "19900202-2345" }, maria());
    expect(r2).toMatchObject({ ok: true, caseNumber: "BOT-27-0052" });
    expect(row("case_counters", "c-bot:2027")!.lastValue).toBe(52);
    if (!r1.ok) return;
    const c = row("cases", r1.caseId)!;
    // Kommunens handläggare beställer alltid i eget namn
    expect(c).toMatchObject({ status: "acknowledged", referrerId: "k-maria", source: "portal", buyerReference: "4410023817", aiConsentStatus: "not_asked", acknowledgedAt: T1 });
    expect(r1.caseId).toMatch(/-n\d{5}$/);
    const person = row("persons", c.personId)!;
    expect(person).toMatchObject({ personnummerLast4: "1234", protectedIdentity: false, phone: "070-000 00 00" });
    expect(person.personnummerEnc).not.toBe("19900101-1234");
    expect(rows("case_status_history").filter((h) => h.caseId === c.id)).toMatchObject([{ fromStatus: null, toStatus: "acknowledged", reason: "Beställning via portalen" }]);
    const out = outboundSince(n);
    expect(out[0]).toMatchObject({ template: "ordererkannande", to: "maria.ekdahl@botkyrka.se", caseId: c.id });
    expect(out[0].body).toBe(
      "Tack! Vi har tagit emot er beställning och gett den ärendenummer BOT-27-0051. Ni får besked om startdatum och ansvarig coach senast tisdag 2 februari 2027 klockan 09.13. Använd gärna ärendenumret i stället för personnummer när ni kontaktar oss om deltagaren.",
    );
    expectNoPersonalData(out);
  });

  it("skyddade personuppgifter → uppgift till avtalsansvarig, ingen adress och inget SMS", async () => {
    const n = rows("outbound_messages").length;
    const res = await run(caseCreate, { ...order, protectedIdentity: true, address: "Hemlig väg 1", preferredContact: "letter" }, maria());
    expect(res).toMatchObject({ ok: true, caseNumber: "BOT-27-0051" });
    if (!res.ok) return;
    const c = row("cases", res.caseId)!;
    expect(c).toMatchObject({ status: "received", acknowledgedAt: null, aiConsentStatus: "not_applicable", backgroundInfo: "" });
    expect(row("persons", c.personId)).toMatchObject({ protectedIdentity: true, address: null, phone: "", email: "", city: "", preferredContact: "phone" });
    const task = rows("tasks").find((t) => t.caseIds.includes(c.id))!;
    expect(task).toMatchObject({
      toRole: "avtalsansvarig", fromId: "system", kind: "protected_order", status: "open",
      text: "Beställning BOT-27-0051 med skyddade personuppgifter. Ring handläggaren enligt den säkra rutinen. Ingen automatik har körts.",
    });
    const out = outboundSince(n);
    expect(out.map((m) => [m.channel, m.template, m.caseId])).toEqual([["email", "generisk_mottagningsbekraftelse", null]]);
    expect(out[0].body).toBe("Tack. Vi har tagit emot beställningen. Ring oss på 08-000 00 00 så tar vi resten enligt den säkra rutinen.");
    // Samordnaren registrerar inte skyddade beställningar – det gör avtalsansvarig enligt den säkra rutinen
    expect(await run(caseCreate, { ...order, pnr: "19900303-3456", protectedIdentity: true, source: "phone", referrerId: "k-omar" }, sara())).toMatchObject({ ok: false, error: "forbidden" });
    expect(await run(caseCreate, { ...order, pnr: "19900303-3456", protectedIdentity: true, source: "phone", referrerId: "k-omar" }, johan())).toMatchObject({ ok: true, caseNumber: "BOT-27-0052" });
    // Acceptera: samordnaren ser bara ärendenumret; avtalsansvarig accepterar och ingen kallelse skickas till deltagaren
    expect(await run(caseAccept, { caseId: res.caseId, leadCoachId: "u-erik", firstMeetingAt: "2027-02-03T10:00" }, sara())).toMatchObject({ ok: false, error: "forbidden" });
    const m = rows("outbound_messages").length;
    expect(await run(caseAccept, { caseId: res.caseId, leadCoachId: "u-erik", firstMeetingAt: "2027-02-03T10:00" }, johan())).toMatchObject({ ok: true });
    expect(outboundSince(m).map((x) => x.template)).toEqual(["tilldelning_coach", "orderbekraftelse"]);
    expect(rows("audit_log").pop()).toMatchObject({ action: "notify.suppressed", entityId: res.caseId });
  });

  it("felaktig beställarreferens → buyer_ref, och samma person två gånger → duplicate", async () => {
    expect(await run(caseCreate, { ...order, buyerReference: "12-34" }, maria())).toMatchObject({ ok: false, error: "buyer_ref" });
    expect(await run(caseCreate, order, maria())).toMatchObject({ ok: true });
    expect(await run(caseCreate, { ...order, pnr: "900101-1234" }, maria())).toMatchObject({ ok: false, error: "duplicate" });
    // Nadia har en pågående insats i testdatat
    expect(await run(caseCreate, { ...order, pnr: "19730216-9545" }, maria())).toMatchObject({ ok: false, error: "duplicate" });
  });
});

describe("arenden: övriga ärendekommandon", () => {
  it("case.decline kräver orsak och meddelar kommunen utan personuppgifter", async () => {
    expect(await run(caseDecline, { caseId: "case-270048", reason: "  " }, sara())).toMatchObject({ ok: false, error: "reason", message: "Välj en orsak." });
    const n = rows("outbound_messages").length;
    const t = addMinutes(rt.clock.now(), 1); // klockan flyttas före kommandot, som i den gamla prototypen
    expect(await run(caseDecline, { caseId: "case-270048", reason: "Vi har inte kapacitet under önskad period" }, sara())).toMatchObject({ ok: true });
    expect(row("cases", "case-270048")).toMatchObject({ status: "declined", declineReason: "Vi har inte kapacitet under önskad period", declinedAt: t });
    expect(outboundSince(n)).toMatchObject([{ template: "avbojt", to: "linda.karlsson@botkyrka.se", body: "Vi kan tyvärr inte ta emot beställning BOT-27-0048. Logga in i portalen för att läsa orsaken." }]);
  });

  it("case.changeCoach byter huvudcoach, loggar orsaken och meddelar coach och kommun", async () => {
    const from = row("cases", "case-260143")!.leadCoachId;
    expect(from).toBe("u-amira");
    expect(await run(caseChangeCoach, { caseId: "case-260143", toCoachId: "u-erik", reason: "" }, sara())).toMatchObject({ ok: false, error: "reason" });
    expect(await run(caseChangeCoach, { caseId: "case-260143", toCoachId: "u-petra", reason: "Test" }, sara())).toMatchObject({ ok: false, error: "coach" });
    const n = rows("outbound_messages").length;
    const t = addMinutes(rt.clock.now(), 1); // klockan flyttas före kommandot, som i den gamla prototypen
    expect(await run(caseChangeCoach, { caseId: "case-260143", toCoachId: "u-erik", reason: "Föräldraledighet från vecka 8." }, sara())).toMatchObject({ ok: true });
    expect(row("cases", "case-260143")!.leadCoachId).toBe("u-erik");
    expect(rows("case_team").filter((t) => t.caseId === "case-260143" && t.role === "lead_coach").map((t) => t.userId)).toEqual(["u-erik"]);
    expect(rows("case_status_history").filter((h) => h.caseId === "case-260143").pop()).toMatchObject({ fromCoach: from, toCoach: "u-erik", reason: "Föräldraledighet från vecka 8.", customerNotifiedAt: t });
    expect(outboundSince(n).map((m) => [m.template, m.to, m.body])).toEqual([
      ["tilldelning_coach", "erik.sjoberg@miljonbemanning.se", "Du har fått ett nytt ärende i Miljonmatch: BOT-26-0143. Logga in för att se detaljerna."],
      ["coachbyte", "maria.ekdahl@botkyrka.se", "Ärende BOT-26-0143 har fått ny huvudcoach. Logga in i portalen för att se vem."],
    ]);
  });

  it("case.bookFirstMeeting: kallelse via föredragen kontaktväg, aldrig vid skyddade personuppgifter", async () => {
    await run(caseAccept, { caseId: "case-270048", leadCoachId: "u-leila" }, sara());
    const n = rows("outbound_messages").length;
    expect(await run(caseBookFirstMeeting, { caseId: "case-270048", at: "2027-02-04T13:30" }, sara())).toMatchObject({ ok: true });
    expect(row("cases", "case-270048")).toMatchObject({ firstMeetingAt: "2027-02-04T13:30", plannedStart: "2027-02-04" });
    const out = outboundSince(n);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ template: "kallelse", body: "Välkommen till Miljonbemanning! Ditt första möte är torsdag 4 februari klockan 13.30 i Alby. Frågor? Ring 08-000 00 00." });
    // Skyddat ärende: avtalsansvarig bokar, ingen kallelse skickas
    const m = rows("outbound_messages").length;
    expect(await run(caseBookFirstMeeting, { caseId: "case-260120", at: "2027-02-04T13:30" }, johan())).toMatchObject({ ok: true });
    expect(outboundSince(m)).toHaveLength(0);
    // Samordnaren ser bara ärendenumret för det skyddade ärendet
    expect(await run(caseBookFirstMeeting, { caseId: "case-260120", at: "2027-02-04T13:30" }, sara())).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("case.setBuyerRef och case.update validerar mot avtalets mönster", async () => {
    expect(await run(caseSetBuyerRef, { caseId: "case-260117", reference: "1234" }, lars())).toMatchObject({ ok: false, error: "buyer_ref" });
    expect(await run(caseSetBuyerRef, { caseId: "case-260117", reference: " 44100238 ", source: "ekonom" }, lars())).toMatchObject({ ok: true });
    expect(row("cases", "case-260117")!.buyerReference).toBe("44100238");
    expect(rows("audit_log").pop()).toMatchObject({ action: "case.buyer_reference_changed", details: { to: "44100238", source: "ekonom" } });
    expect(await run(caseUpdate, { caseId: "case-260143", patch: { purchaseOrderNumber: "BOT-26-0143" } }, sara())).toMatchObject({ ok: false, error: "po_number" });
    const upd = await run(caseUpdate, { caseId: "case-260143", patch: { purchaseOrderNumber: "991234567", location: "Tumba" } }, sara());
    expect(upd.ok && [...upd.changed].sort()).toEqual(["location", "purchaseOrderNumber"]);
    expect(row("cases", "case-260143")).toMatchObject({ purchaseOrderNumber: "991234567", location: "Tumba" });
    // Kommunens handläggare ändrar bara sina kontaktuppgifter i sina egna beställningar
    expect(await run(caseUpdate, { caseId: "case-260143", patch: { referrerPhone: "08-530 610 00" } }, maria())).toMatchObject({ ok: true, changed: ["referrerPhone"] });
    expect(await run(caseUpdate, { caseId: "case-260143", patch: { location: "Fittja" } }, maria())).toMatchObject({ ok: false, error: "forbidden" });
    expect(await run(caseUpdate, { caseId: "case-270049", patch: { referrerPhone: "08-1" } }, maria())).toMatchObject({ ok: false, error: "not_found" });
  });

  it("case.close: resultatklass, utkast till slutrapport och exit-puls", async () => {
    expect(await run(caseClose, { caseId: "case-260143", endDate: "", endReason: "arbete" }, amira())).toMatchObject({ ok: false, error: "missing" });
    const t = addMinutes(rt.clock.now(), 1); // klockan flyttas före kommandot, som i den gamla prototypen
    const res = await run(caseClose, { caseId: "case-260143", endDate: "2027-02-01", endReason: "arbete", verified: true }, amira());
    expect(res).toMatchObject({ ok: true, resultClass: "result" });
    if (!res.ok) return;
    expect(row("cases", "case-260143")).toMatchObject({ status: "closed", endDate: "2027-02-01", endReason: "arbete", resultVerifiedAt: t, closedAt: t });
    expect(row("reports", res.reportId)).toMatchObject({ kind: "final", status: "draft", periodEnd: "2027-02-01", dueAt: "2027-02-08T23:59", provisionalDue: true });
    expect(rows("pulse_invites").filter((i) => i.caseId === "case-260143" && i.occasion === "exit")).toMatchObject([{ channel: "sms", sentAt: t, expiresAt: addDays(t, 7), usedAt: null }]);
    // Avbrott på grund av flytt räknas inte i nämnaren (preliminärt, avtalets prototypeExcluded)
    expect(await run(caseClose, { caseId: "case-260119", endDate: "2027-02-01", endReason: "avbrott_flytt" }, amira())).toMatchObject({ ok: true, resultClass: "excluded" });
    // Skyddade personuppgifter: ingen pulsmätning
    expect(await run(caseClose, { caseId: "case-260120", endDate: "2027-02-01", endReason: "planerat_utan_resultat" }, as("u-erik", "coach"))).toMatchObject({ ok: true, resultClass: "no_result" });
    expect(rows("pulse_invites").filter((i) => i.caseId === "case-260120" && i.occasion === "exit")).toHaveLength(0);
  });

  it("consent.set: samtycke ges, återkallas – aldrig vid skyddade personuppgifter", async () => {
    expect(await run(consentSet, { caseId: "case-260129", value: "given", language: "somaliska" }, amira())).toMatchObject({ ok: true });
    expect(row("cases", "case-260129")!.aiConsentStatus).toBe("given");
    expect(rows("consents").filter((x) => x.caseId === "case-260129").pop()).toMatchObject({ givenAt: T1, informedBy: "u-amira", language: "somaliska", textVersion: "v1.0 (2026-10-01)" });
    expect(await run(consentSet, { caseId: "case-260129", value: "revoked" }, amira())).toMatchObject({ ok: true });
    expect(row("cases", "case-260129")!.aiConsentStatus).toBe("revoked");
    expect(rows("consents").filter((x) => x.caseId === "case-260129").pop()!.revokedAt).not.toBeNull();
    expect(await run(consentSet, { caseId: "case-260120", value: "given" }, as("u-erik", "coach"))).toMatchObject({ ok: false, error: "protected" });
  });
});

describe("arenden: meddelanden", () => {
  it("en kommunanvändare kan inte skicka meddelande i någon annans ärende", async () => {
    // case-270049 beställdes av Ahmed – Maria ser det inte (synlighet "egna ärenden")
    expect(await run(messageSend, { caseId: "case-270049", body: "Hej" }, maria())).toMatchObject({ ok: false, error: "not_found" });
    expect(rows("messages").filter((m) => m.caseId === "case-270049" && m.senderId === "k-maria")).toHaveLength(0);
    // Kommunens chef ser enhetens ärenden men skriver inte meddelanden
    await expectForbidden(run(messageSend, { caseId: "case-260143", body: "Hej" }, eva()));
  });

  it("från kommunen → notis och mejl till huvudcoachen; från MB → mejl till handläggaren", async () => {
    const n = rows("outbound_messages").length;
    const res = await run(messageSend, { caseId: "case-260143", body: "  Hej! Hur går praktiken?  " }, maria());
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) return;
    expect(row("messages", res.messageId)).toMatchObject({ senderId: "k-maria", body: "Hej! Hur går praktiken?", readBy: [] });
    expect(rows("user_notifications").pop()).toMatchObject({
      recipientId: "u-amira", kind: "message", title: "Nytt meddelande från kommunen", body: "Nytt säkert meddelande om BOT-26-0143. Läs och svara i ärendets flik Meddelanden.",
    });
    const reply = await run(messageSend, { caseId: "case-260143", body: "Bra, tack!" }, amira());
    expect(reply).toMatchObject({ ok: true });
    const out = outboundSince(n);
    expect(out.map((m) => [m.template, m.to, m.body])).toEqual([
      ["nytt_meddelande", "amira.haddad@miljonbemanning.se", "Du har ett nytt meddelande om ärende BOT-26-0143 – logga in för att läsa."],
      ["nytt_meddelande", "maria.ekdahl@botkyrka.se", "Du har ett nytt meddelande om ärende BOT-26-0143 – logga in för att läsa."],
    ]);
    expectNoPersonalData(out);
    // Läskvitto: bara handläggaren som beställde, och tyst (demoklockan flyttas inte)
    const t = rt.clock.now();
    expect(await run(messageRead, { caseId: "case-260143" }, eva())).toMatchObject({ ok: true, marked: 0 });
    const read = await run(messageRead, { caseId: "case-260143" }, maria());
    expect(read.ok && read.marked).toBeGreaterThan(0);
    expect(rt.clock.now()).toBe(t);
    if (reply.ok) expect(row("messages", reply.messageId)!.readBy).toEqual(["k-maria"]);
  });
});

// ================================================================ Coach
describe("coach.attendanceSet (attendance.set)", () => {
  it("när den sista oregistrerade deltagaren hos en handläggare registreras publiceras veckorapporten", async () => {
    const wr = () => weeklyReport(rt.store.data as never, "k-maria", "2027-W04", { now: rt.clock.now() });
    const missing = wr().sections.flatMap((s) => s.rows.filter((r) => !r.att && r.activity.startsAt < rt.clock.now()).map((r) => ({ activityId: r.activity.id, coach: s.case.leadCoachId as string })));
    expect(missing.length).toBeGreaterThan(1);
    expect(row("reports", "rep-16692")).toMatchObject({ kind: "weekly_attendance", week: "2027-W04", recipientUserId: "k-maria", status: "waiting" });
    for (const m of missing.slice(0, -1)) {
      const r = await run(attendanceSet, { activityId: m.activityId, status: "present" }, as(m.coach, "coach"));
      expect(r).toMatchObject({ ok: true, published: null });
    }
    expect(row("reports", "rep-16692")!.status).toBe("waiting");
    const n = rows("outbound_messages").length;
    const last = missing[missing.length - 1];
    const res = await run(attendanceSet, { activityId: last.activityId, status: "absent_valid", reason: "Sjukdom" }, as(last.coach, "coach"));
    expect(res).toMatchObject({ ok: true, published: { reportId: "rep-16692", weekKey: "2027-W04", recipientName: "Maria Ekdahl", text: "Veckorapporten för v. 4 2027 till Maria Ekdahl publicerades automatiskt." } });
    expect(row("reports", "rep-16692")).toMatchObject({ status: "delivered", deliveredTo: ["k-maria"], deliveredAt: rt.store.data.attendance.at(-1)!.registeredAt });
    expect(outboundSince(n)).toMatchObject([{ template: "ny_rapport", to: "maria.ekdahl@botkyrka.se", caseId: null, body: "Veckorapporten för v. 4 2027 finns i portalen – logga in för att läsa." }]);
    expect(rows("audit_log").pop()).toMatchObject({ action: "report.published", entityId: "rep-16692", details: { kind: "weekly_attendance", week: "2027-W04", automatic: true } });
    expect(rows("attendance").find((a) => a.activityId === last.activityId)).toMatchObject({ status: "absent_valid", reason: "Sjukdom", registeredBy: last.coach });
  });

  it("en coach kan inte registrera närvaro i någon annans ärende", async () => {
    const act = rows("activities").find((a) => a.caseId === "case-260120")!; // skyddat ärende, coach Erik
    expect(await run(attendanceSet, { activityId: act.id, status: "present" }, amira())).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("coach.checkinSave (checkin.save)", () => {
  const data = { heldAt: "2027-02-01T09:00", durationMin: 30, mode: "fysiskt" as const, inputMethod: "manual" as const, goalStatus: "no" as const, nextGoal: "Komma i tid", phase: 4,
    activitiesDone: ["Praktik/APL"], employerContacts: { count: "0" as const, types: [] }, obstacles: [], note: "Uteblev två gånger." };

  it("Röd utan avvikelse → deviation_required och inget sparas", async () => {
    const n = rows("check_ins").length;
    expect(await run(checkinSave, { caseId: "case-260143", data: { ...data, overallStatus: "red" }, approve: true }, amira())).toMatchObject({ ok: false, error: "deviation_required" });
    expect(await run(checkinSave, { caseId: "case-260143", data: { ...data, overallStatus: "red" }, deviation: { description: "", action: "" } }, amira())).toMatchObject({ ok: false, error: "deviation_required" });
    expect(rows("check_ins")).toHaveLength(n);
  });

  it("Röd med avvikelse → godkänd avstämning, avvikelse och uppgift till kommunen när beslut behövs", async () => {
    const n = rows("outbound_messages").length;
    const res = await run(checkinSave, {
      caseId: "case-260143", data: { ...data, overallStatus: "red" }, approve: true,
      deviation: { description: "Upprepad ogiltig frånvaro", action: "Samtal om hinder", ownerId: "u-amira", followUpOn: "2027-02-08", needsCustomerDecision: true },
    }, amira());
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) return;
    expect(row("check_ins", res.checkInId)).toMatchObject({ status: "approved", approvedBy: "u-amira", overallStatus: "red", phase: 4 });
    expect(row("deviations", res.deviationId!)).toMatchObject({ checkInId: res.checkInId, status: "open", needsCustomerDecision: true });
    expect(rows("tasks").find((t) => t.deviationId === res.deviationId)).toMatchObject({
      toId: "k-maria", kind: "customer_decision", text: "Miljonbemanning behöver ert beslut eller stöd i ärende BOT-26-0143: Upprepad ogiltig frånvaro. Läs mer och svara under ärendets meddelanden.",
    });
    expect(outboundSince(n)).toMatchObject([{ template: "beslut_behovs", body: "Ärende BOT-26-0143 behöver ert beslut eller stöd – logga in för att läsa." }]);
    // Samma avvikelse sparad igen ger ingen ny uppgift
    await run(deviationSave, { id: res.deviationId!, caseId: "case-260143", data: { assessment: "Risk för avbrott" } }, amira());
    expect(rows("tasks").filter((t) => t.deviationId === res.deviationId)).toHaveLength(1);
  });

  it("AI-inmatning utan samtycke eller vid skyddade personuppgifter → ai_not_allowed", async () => {
    expect(await run(checkinSave, { caseId: "case-260129", data: { ...data, inputMethod: "ai_recording", overallStatus: "green" } }, amira())).toMatchObject({ ok: false, error: "ai_not_allowed" });
    expect(await run(checkinSave, { caseId: "case-260120", data: { ...data, inputMethod: "notes", overallStatus: "green" } }, as("u-erik", "coach"))).toMatchObject({ ok: false, error: "ai_not_allowed" });
  });

  it("AI-förslagen från körningen sparas med avstämningen och råtranskriptet raderas vid godkännande", async () => {
    const ai = await run(aiRun, { caseId: "case-260143", kind: "transcribe_extract", audioSeconds: 1800, costOre: 80 }, amira());
    expect(ai).toMatchObject({ ok: true, source: "recording", audioDeletedAt: T1, rawTranscriptDeleteBy: "2027-03-03T09:13" });
    if (!ai.ok || !ai.suggestions) throw new Error("förslag saknas");
    expect(Object.keys(ai.suggestions)).not.toContain("overallStatus");
    expect(ai.suggestions.goalStatus).toEqual({ value: "partly", quote: "Jag har gjort det mesta av målet, men en dag hann jag inte.", t: 184 });
    expect(ai.suggestions.phase).toMatchObject({ value: 4, quote: "Praktiken fortsätter som planerat." });
    expect(ai.transcript.map((x) => x.t)).toEqual([96, 96, 184, 742, 1034, 1320, 1485]);
    const res = await run(checkinSave, {
      caseId: "case-260143", approve: true, data: { ...data, inputMethod: "ai_recording", goalStatus: "partly", overallStatus: "green", aiRunId: ai.runId },
      aiDecisions: [{ field: "goalStatus", decision: "accepted", suggested: "partly", final: "partly" }],
    }, amira());
    expect(res).toMatchObject({ ok: true, rawTranscriptDeletedAt: rt.store.data.check_ins.at(-1)!.approvedAt });
    if (!res.ok) return;
    const ci = row("check_ins", res.checkInId)!;
    expect(ci.aiRunId).toBe(ai.runId);
    expect(ci.ai).toMatchObject({ goalStatus: { value: "partly" }, transcript: [], audioDeletedAt: T1 });
    expect(rows("ai_field_decisions").pop()).toMatchObject({ aiRunId: ai.runId, field: "goalStatus", decision: "accepted", changed: false, decidedBy: "u-amira" });
    expect((row("ai_runs", ai.runId)!.output as { transcript: unknown[] }).transcript).toEqual([]);
    expect(rows("audit_log").map((x) => x.action).slice(-2)).toEqual(["transcript.deleted", "check_in.approved"]);
  });
});

describe("coach.assessmentSave (assessment.save)", () => {
  const AREAS = ["narvaro_rutiner", "yrkesfardigheter", "arbetskapacitet", "sjalvstandighet", "digital_sjalvstandighet", "instruktioner", "arbetsgivarkontakter", "beredskap", "sprak_kommunikation", "ovrigt"];
  const all = (level: 0 | 1 | 2 | 3, observation = "") => Object.fromEntries(AREAS.map((k) => [k, { level, observation, nextStep: "" }]));

  it("nivå ≥ 1 utan observation → incomplete med missing", async () => {
    const res = await run(assessmentSave, { caseId: "case-260143", month: "2027-01", areas: { ...all(0), yrkesfardigheter: { level: 2, observation: " " } }, overallStatus: "green", approve: true }, amira());
    expect(res).toMatchObject({ ok: false, error: "incomplete", missing: ["yrkesfardigheter"], message: "Bedömningen kan inte godkännas: 1 område saknar uppgifter." });
    const noStatus = await run(assessmentSave, { caseId: "case-260143", month: "2027-01", areas: all(0), overallStatus: null, approve: true }, amira());
    expect(noStatus).toMatchObject({ ok: false, error: "incomplete", missing: [] });
    expect(rows("monthly_assessments").find((m) => m.caseId === "case-260143" && m.month === "2027-01")!.status).toBe("draft");
  });

  it("komplett bedömning godkänns och månadsrapporten blir granskad", async () => {
    const res = await run(assessmentSave, {
      caseId: "case-260143", month: "2027-01", areas: all(1, "Kom i tid till samtliga tillfällen under månaden."), summary: "Sammanfattning", overallStatus: "green", approve: true,
      plan: { goal1: "Mål 1", nextCustomerMeeting: "" },
    }, amira());
    expect(res).toMatchObject({ ok: true });
    const ma = rows("monthly_assessments").find((m) => m.caseId === "case-260143" && m.month === "2027-01")!;
    expect(ma).toMatchObject({ status: "approved", decidedBy: "u-amira", overallStatus: "green" });
    expect(row("reports", "rep-16011")!.status).toBe("reviewed");
    expect(rows("monthly_plans").find((m) => m.caseId === "case-260143" && m.month === "2027-01")).toMatchObject({ goal1: "Mål 1", nextCustomerMeeting: null });
  });
});

describe("coach: kartläggning, händelser, avvikelser", () => {
  it("intake.save, event.add, result.verify och deviation.callCustomer", async () => {
    expect(await run(intakeSave, { caseId: "case-270012", data: { chosenTrack: "Truckförare A+B", workGoals: "Lager" }, approve: true }, amira())).toMatchObject({ ok: true });
    expect(row("cases", "case-270012")!.vocationalTrack).toBe("Truckförare A+B");
    const ev = await run(eventAdd, { caseId: "case-260143", kind: "arbete_paborjat", occurredOn: "2027-02-01", actor: "Hallunda Lagerservice AB" }, amira());
    expect(ev).toMatchObject({ ok: true });
    if (ev.ok) expect(row("outcome_events", ev.eventId)).toMatchObject({ possibleBonus: true, verificationPath: null });
    expect(await run(resultVerify, { caseId: "case-260143", verificationKind: "anställningsbevis" }, amira())).toMatchObject({ ok: true });
    expect(row("cases", "case-260143")!.resultVerifiedAt).not.toBeNull();
    const n = rows("outbound_messages").length;
    const dv = await run(deviationSave, { caseId: "case-260143", data: { description: "Planen håller inte", action: "Omplanering", ownerId: "u-amira", followUpOn: "2027-02-10" } }, amira());
    expect(dv).toMatchObject({ ok: true });
    if (!dv.ok) return;
    expect(await run(deviationCallCustomer, { caseId: "case-260143", deviationId: dv.deviationId, body: "Vi vill kalla till ett uppföljningsmöte.", proposedAt: "2027-02-03T10:00" }, amira())).toMatchObject({ ok: true });
    expect(row("deviations", dv.deviationId)!.followUpMeetingAt).toBe("2027-02-03T10:00");
    expect(rows("messages").pop()).toMatchObject({ kind: "meeting_request", senderId: "u-amira" });
    expect(outboundSince(n)).toMatchObject([{ template: "nytt_meddelande", body: "Du har ett nytt meddelande om ärende BOT-26-0143 – logga in för att läsa." }]);
    // Stäng avvikelsen
    expect(await run(deviationSave, { id: dv.deviationId, caseId: "case-260143", data: { status: "closed" } }, amira())).toMatchObject({ ok: true });
    expect(row("deviations", dv.deviationId)!.status).toBe("closed");
  });
});

describe("coach.aiRun (ai.run)", () => {
  it("skyddat ärende → ai_not_allowed, loggas och ingen AI-körning sparas", async () => {
    const n = rows("ai_runs").length;
    expect(await run(aiRun, { caseId: "case-260120", kind: "transcribe_extract", audioSeconds: 1200 }, as("u-erik", "coach"))).toMatchObject({ ok: false, error: "ai_not_allowed" });
    expect(rows("ai_runs")).toHaveLength(n);
    expect(rows("audit_log").pop()).toMatchObject({ action: "ai.blocked", entityId: "case-260120" });
    // Utan samtycke
    expect(await run(aiRun, { caseId: "case-260129", kind: "extract_notes", notesText: "Hej." }, amira())).toMatchObject({ ok: false, error: "ai_not_allowed" });
  });

  it("anteckningar: bara det som står i texten blir förslag, resten 'Framgår inte'", async () => {
    const res = await run(aiRun, { caseId: "case-260143", kind: "extract_notes", notesText: "Klarade veckomålet. Övade på truck och lastsäkring.\nNästa vecka: Skicka tre ansökningar." }, amira());
    expect(res).toMatchObject({ ok: true, source: "notes", transcript: [], audioDeletedAt: null });
    if (!res.ok || !res.suggestions) throw new Error("förslag saknas");
    expect(res.suggestions.goalStatus).toMatchObject({ value: "yes", quote: "Klarade veckomålet." });
    expect(res.suggestions.nextGoal).toMatchObject({ value: "Nästa vecka: Skicka tre ansökningar" });
    // "ansökningar" i nästa veckas mål räknas också (samma nyckelord som prototypen)
    expect(res.suggestions.activitiesDone).toMatchObject({ value: ["Yrkesspecifika moment", "CV och ansökningar"], quote: "Övade på truck och lastsäkring." });
    expect(res.suggestions.phase).toMatchObject({ value: null, noEvidence: true, quote: "Framgår inte av anteckningarna. Fasen ändras inte." });
    expect(row("ai_runs", res.runId)).toMatchObject({ kind: "extract_notes", costOre: 80, inputDeletedAt: null, provider: "Berget AI (test)" });
  });
});

// ================================================================ Rapporter
describe("rapporter", () => {
  it("report.open: bara mottagaren kvitterar, visningen loggas alltid och demoklockan står still", async () => {
    const t = rt.clock.now();
    expect(await run(reportOpen, { reportId: "rep-15828" }, eva())).toMatchObject({ ok: true, acknowledged: false });
    expect(row("reports", "rep-15828")!.openedAt).toBeNull();
    expect(await run(reportOpen, { reportId: "rep-15828" }, maria())).toMatchObject({ ok: true, acknowledged: true });
    expect(row("reports", "rep-15828")).toMatchObject({ openedAt: t, openedBy: "k-maria" });
    expect(rows("audit_log").slice(-2).map((x) => [x.action, x.details])).toEqual([["report.view", { by: "customer", acknowledged: false }], ["report.view", { by: "customer", acknowledged: true }]]);
    expect(rt.clock.now()).toBe(t);
    // Ett utkast syns inte för kommunen
    expect(await run(reportOpen, { reportId: "rep-16011" }, maria())).toMatchObject({ ok: false, error: "not_found" });
  });

  it("månadsrapport: coachen godkänner, levererar, rättar – ny version ersätter den gamla vid leverans", async () => {
    expect(await run(reportApprove, { reportId: "rep-16011" }, sara())).toMatchObject({ ok: false, error: "forbidden" });
    expect(await run(reportDeliver, { reportId: "rep-16011" }, amira())).toMatchObject({ ok: false, error: "not_approved" });
    expect(await run(reportApprove, { reportId: "rep-16011" }, amira())).toMatchObject({ ok: true });
    const n = rows("outbound_messages").length;
    expect(await run(reportDeliver, { reportId: "rep-16011" }, amira())).toMatchObject({ ok: true });
    expect(row("reports", "rep-16011")).toMatchObject({ status: "delivered", deliveredTo: ["k-maria"] });
    expect(outboundSince(n)).toMatchObject([{ template: "ny_rapport", to: "maria.ekdahl@botkyrka.se", body: "Månadsrapport individ för ärende BOT-26-0143 finns i portalen – logga in för att läsa." }]);
    const cor = await run(reportCorrect, { reportId: "rep-16011" }, amira());
    expect(cor).toMatchObject({ ok: true, version: 2 });
    if (!cor.ok) return;
    expect(row("reports", cor.reportId)).toMatchObject({ status: "draft", previousId: "rep-16011", deliveredAt: null, approvedAt: null, snapshot: null });
    expect(row("reports", "rep-16011")!.correctionPending).toBe(cor.reportId);
    expect(await run(reportCorrect, { reportId: "rep-16011" }, amira())).toMatchObject({ ok: false, error: "wrong_status" });
    await run(reportApprove, { reportId: cor.reportId }, amira());
    await run(reportDeliver, { reportId: cor.reportId }, amira());
    expect(row("reports", "rep-16011")).toMatchObject({ superseded: true, supersededBy: cor.reportId });
  });

  it("veckorapport som väntar på närvaro kan inte levereras innan all närvaro är registrerad", async () => {
    expect(await run(reportDeliver, { reportId: "rep-16692" }, sara())).toMatchObject({ ok: false, error: "incomplete" });
  });
});

// ================================================================ Notiser, flaggor, visningslogg
describe("notiser, ledning och session", () => {
  it("notif.read markerar bara egna notiser och är idempotent", async () => {
    const ids = rows("user_notifications").filter((x) => x.recipientId === "u-amira").slice(0, 2).map((x) => x.id);
    const keys = [...ids, "nprog:case-260143:2027-W04"];
    const unread = keys.filter((k) => !row("notification_reads", `u-amira:${k}`));
    const before = rows("notification_reads").length;
    expect(await run(notifRead, { ids: keys }, amira())).toMatchObject({ ok: true, marked: unread.length });
    expect(rows("notification_reads").length - before).toBe(unread.length);
    expect(unread.length).toBeGreaterThan(0);
    expect(await run(notifRead, { ids }, amira())).toMatchObject({ ok: true, marked: 0 });
    expect(rows("notification_reads").find((x) => x.id === "u-amira:nprog:case-260143:2027-W04")).toMatchObject({ userId: "u-amira", readAt: DEMO_START });
  });

  it("alert.ack sparar kvittensen med åtgärdsplan och loggar den", async () => {
    expect(await run(alertAck, { key: "stuck:case-260128:3", plan: "Avstämning med coachen denna vecka." }, as("u-karin", "chef"))).toMatchObject({ ok: true });
    expect(row("alert_acks", "stuck:case-260128:3")).toMatchObject({ acknowledgedBy: "u-karin", actionPlan: "Avstämning med coachen denna vecka.", acknowledgedAt: T1 });
    expect(rows("audit_log").pop()).toMatchObject({ action: "alert.acknowledged", entity: "alert", entityId: "stuck:case-260128:3" });
    await expectForbidden(run(alertAck, { key: "x", plan: "y" }, maria()));
  });

  it("audit.view loggar visningen med ärendets avtal och flyttar inte klockan", async () => {
    const t = rt.clock.now();
    expect(await run(auditView, { action: "case.view", entity: "case", entityId: "case-260143" }, amira())).toMatchObject({ ok: true });
    expect(rows("audit_log").pop()).toMatchObject({ action: "case.view", entity: "case", entityId: "case-260143", actorId: "u-amira", contractId: "c-bot", details: {} });
    expect(rt.clock.now()).toBe(t);
  });

  it("audit.view: bara visningshändelser, bara för objekt man får se, och ingen fri text", async () => {
    const n = rows("audit_log").length;
    const nadia = "case-260143"; // Marias beställning, Amiras ärende
    const other = rows("cases").find((c) => c.contractId === "c-bot" && c.referrerId !== "k-maria" && c.leadCoachId !== "u-amira" && !rows("case_team").some((x) => x.caseId === c.id && x.userId === "u-amira"))!;
    // Händelser som bara hanterarna själva skriver går inte att förfalska.
    for (const action of ["pnr.revealed", "event.added", "report.approved", "case.coach_changed", "auth.login_failed"]) {
      await expect(rt.run("command", auditView.key, { action, entity: "case", entityId: nadia }, maria())).rejects.toThrow();
    }
    // Fri text i details stoppas av schemat.
    await expect(rt.run("command", auditView.key, { action: "case.view", entity: "case", entityId: nadia, details: { reason: "Deltagaren Anna Andersson 19850101-1234" } }, maria())).rejects.toThrow();
    // Fel slags objekt och objekt som man inte får se loggas inte.
    expect(await run(auditView, { action: "case.view", entity: "person", entityId: "p-5143" }, maria())).toMatchObject({ ok: false });
    expect(await run(auditView, { action: "case.view", entity: "case", entityId: other.id }, maria())).toMatchObject({ ok: false });
    expect(await run(auditView, { action: "report.view", entity: "report", entityId: "rep-finns-inte" }, amira())).toMatchObject({ ok: false });
    expect(await run(auditView, { action: "export.audit_log", entity: "audit_log", entityId: "c-bot", details: { rows: 3, filter: "inget" } }, maria())).toMatchObject({ ok: false });
    expect(await run(auditView, { action: "case.view_denied", entity: "case", entityId: other.id }, as("u-johan", "avtalsansvarig"))).toMatchObject({ ok: true });
    expect(await run(auditView, { action: "case.view_denied", entity: "case", entityId: rows("cases").find((c) => c.contractId === "c-kk")?.id ?? "case-saknas" }, eva())).toMatchObject({ ok: false });
    expect(rows("audit_log").length).toBe(n + 1);
    // Export: bara kända detaljer följer med.
    expect(await run(auditView, { action: "export.contract_deviations", entity: "contract_deviation", entityId: null, details: { month: "2027-01" } }, sara())).toMatchObject({ ok: true });
    expect(rows("audit_log").pop()).toMatchObject({ action: "export.contract_deviations", details: { month: "2027-01" }, contractId: "c-bot" });
  });
});

// ================================================================ Ekonomi
describe("ekonomi", () => {
  it("billing.sendFortnox två gånger skapar inga dubbletter", async () => {
    const ids = ["case-260143", "case-260072"];
    expect(await run(billingApproveInvoice, { month: "2027-01", caseIds: ids }, lars())).toMatchObject({ ok: true, approved: 2 });
    const first = await run(billingSendFortnox, { month: "2027-01", caseIds: ids }, lars());
    expect(first).toMatchObject({ ok: true, created: ids, skipped: [], blocked: [] });
    const second = await run(billingSendFortnox, { month: "2027-01", caseIds: ids }, lars());
    expect(second).toMatchObject({ ok: true, created: [], skipped: ids, blocked: [] });
    for (const id of ids) {
      const drafts = rows("invoice_drafts").filter((x) => x.month === "2027-01" && x.caseId === id);
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({ status: "fortnox_created", fortnoxIdempotencyKey: `2027-01:${id}`, approvedBy: "u-lars", invoicedObject: row("cases", id)!.caseNumber });
    }
    expect(rows("audit_log").pop()).toMatchObject({ action: "billing.fortnox_created", details: { created: 0, skippedAlreadyCreated: 2 } });
    // Historiska månader som redan är fakturerade skapas inte igen
    expect(await run(billingSendFortnox, { month: "2026-11", caseIds: ["case-260143"] }, lars())).toMatchObject({ ok: true, created: [], skipped: ["case-260143"] });
  });

  it("utan giltig beställarreferens skapas ingen faktura (CLAUDE.md punkt 11)", async () => {
    const res = await run(billingSendFortnox, { month: "2027-01", caseIds: ["case-260117"] }, lars());
    expect(res).toMatchObject({ ok: true, created: [], blocked: ["case-260117"] });
    expect(rows("invoice_drafts").find((x) => x.month === "2027-01" && x.caseId === "case-260117")).toBeUndefined();
  });

  it("nollvecka, manuell faktura och export loggas; bara ekonomen", async () => {
    expect(await run(billingApproveZeroWeek, { month: "2027-01", caseId: "case-260157", weekKey: "2027-W02", note: "Sjukdom hela veckan, kontrollerat med coachen." }, lars())).toMatchObject({ ok: true });
    expect(row("billing_week_approvals", "case-260157:2027-W02")).toMatchObject({ approvedBy: "u-lars", month: "2027-01", note: "Sjukdom hela veckan, kontrollerat med coachen." });
    expect(await run(billingMarkManual, { month: "2027-01", caseId: "case-260121", invoiceNo: "F-2027-001" }, lars())).toMatchObject({ ok: true });
    expect(row("invoice_drafts", "inv-2027-01-case-260121")).toMatchObject({ status: "manual", manualInvoiceNo: "F-2027-001" });
    expect(await run(billingSendFortnox, { month: "2027-01", caseIds: ["case-260121"] }, lars())).toMatchObject({ ok: true, skipped: ["case-260121"] });
    expect(await run(billingExport, { month: "2027-01", format: "csv" }, lars())).toMatchObject({ ok: true });
    expect(rows("audit_log").pop()).toMatchObject({ action: "export.billing", entityId: "2027-01", details: { format: "csv" } });
    await expectForbidden(run(billingSendFortnox, { month: "2027-01", caseIds: ["case-260143"] }, as("u-karin", "chef")));
  });
});

// ================================================================ Inkorg
describe("inkorg.emailSetStatus (email.setStatus)", () => {
  it("markerar mejlet som hanterat och loggar", async () => {
    const e = rows("inbound_emails").find((x) => x.status === "other")!;
    expect(await run(emailSetStatus, { emailId: e.id, status: "handled" }, sara())).toMatchObject({ ok: true });
    expect(row("inbound_emails", e.id)).toMatchObject({ status: "handled", handledBy: "u-sara", handledAt: T1 });
    expect(rows("audit_log").pop()).toMatchObject({ action: "email.handled", entity: "inbound_email", entityId: e.id, details: { status: "handled" } });
    await expectForbidden(run(emailSetStatus, { emailId: e.id, status: "handled" }, amira()));
  });
});
