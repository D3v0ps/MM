// Tester för de delade kommandona (portade från prototypens 03-domain.js). Kommandona körs genom samma execute() som
// riktiga appen och prototypen, mot testdatat i minnet och som testpersonerna i rollväljaren (behörighet via policy.ts).
// Beslut 2026-10-07: kommunen har bara rollen handläggare, beställningen anger omfattningen i månader och beställarreferensen
// fylls i av Miljonbemanning. Skyddade personuppgifter är borttagna ur appen – spärren är vilande, och testerna av den slår
// på den själva (protect()) för ärendet case-260120 (Omars beställning, huvudcoach Erik).
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
import { addDays } from "@/core/time";
import { avropDue } from "@/core/sla";
import { BOTKYRKA_CONFIG } from "@/core/config";
import {
  caseAccept, caseBookFirstMeeting, caseChangeCoach, caseClose, caseCreate, caseDecline, caseSetBuyerRef, caseUpdate, consentSet, messageRead, messageSend,
} from "@/features/arenden/api";
import { emailApplySupplement, emailSetStatus } from "@/features/inkorg/api";
import { aiRun, assessmentSave, attendanceSet, checkinSave, deviationCallCustomer, deviationSave, eventAdd, intakeSave, resultVerify } from "@/features/coach/api";
import { reportApprove, reportCorrect, reportDeliver, reportDocument, reportOpen, reportSaveFinal, type ReportDocResult } from "@/features/rapporter/api";
import { notifRead } from "@/features/notiser/api";
import { alertAck } from "@/features/ledning/api";
import { billingApproveInvoice, billingApproveZeroWeek, billingExport, billingMarkManual, billingSendFortnox, ekoReissue, ekoRun, invoiceSetBuyerRef, invoiceSetPo } from "@/features/ekonomi/api";
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
const omar = () => as("k-omar", "kommun_handlaggare");
/** Den vilande spärren: personen i case-260120 får skyddade personuppgifter (testdatat har inga sedan 2026-10-07). */
const protect = () => rt.store.updateRow("persons", row("cases", "case-260120")!.personId, { protectedIdentity: true, address: null });

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
  it("beställarreferensen är valfri vid accept (beslut 2026-10-07) – fel format stoppas och inget ändras; omfattningen krävs", async () => {
    const before = row("cases", "case-270049")!;
    expect(before).toMatchObject({ buyerReference: null, orderPeriodMonths: null });
    const base = { caseId: "case-270049", leadCoachId: "u-amira", firstMeetingAt: "2027-02-03T10:00", primaryArea: "G", vocationalTrack: "Kök och restaurang" };
    const bad = await run(caseAccept, { ...base, orderPeriodMonths: 6, buyerReference: "123" }, sara());
    expect(bad).toMatchObject({ ok: false, error: "buyer_ref", message: "Beställarreferensen ska vara 8–10 siffror. Du har skrivit 3." });
    // Ahmeds mejl saknar omfattningen – den måste väljas i dialogen.
    expect(await run(caseAccept, base, sara())).toMatchObject({ ok: false, error: "order_period" });
    expect(await run(caseAccept, { ...base, orderPeriodMonths: 9 }, sara())).toMatchObject({ ok: false, error: "order_period", message: "Välj en av omfattningarna i avtalet." });
    expect(row("cases", "case-270049")!.status).toBe("acknowledged");
    expect(rows("reports").filter((r) => r.caseId === "case-270049")).toHaveLength(0);
    // Utan referens går det: Miljonbemanning fyller i den före faktureringen.
    expect(await run(caseAccept, { ...base, orderPeriodMonths: 12 }, sara())).toMatchObject({ ok: true });
    expect(row("cases", "case-270049")).toMatchObject({ status: "confirmed", buyerReference: null, orderPeriodMonths: 12, plannedEnd: "2028-02-02" });
  });

  it("med giltig referens → bekräftad, orderbekräftelse, team, notiser och utskick utan personnummer", async () => {
    const n = rows("outbound_messages").length;
    const due = avropDue({ ...row("cases", "case-270050")! }, BOTKYRKA_CONFIG);
    expect(due).toBe("2027-02-02T08:41");
    const res = await run(caseAccept, { caseId: "case-270050", leadCoachId: "u-amira", firstMeetingAt: "2027-02-03T10:00", team: [{ userId: "u-petra", role: "vocational_supervisor" }] }, sara());
    expect(res).toMatchObject({ ok: true, caseNumber: "BOT-27-0050" });
    if (!res.ok) return;
    const c = row("cases", "case-270050")!;
    expect(c).toMatchObject({
      status: "confirmed", confirmedAt: T1, leadCoachId: "u-amira", buyerReference: "4410023817", firstMeetingAt: "2027-02-03T10:00",
      // Omfattningen ur beställningen (6 månader): slutet räknas från startdatumet, veckorna är debiterbara ISO-veckor.
      plannedStart: "2027-02-03", orderPeriodMonths: 6, plannedEnd: "2027-08-02", plannedWeeks: 27, orderValueWeeks: 27,
    });
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
    // Inget påhittat telefonnummer i kallelsen: meningen "Frågor? Ring …" finns bara när CONTACT_PHONE är satt (_shared/contact.ts).
    expect(out[3]).toMatchObject({ channel: "email", body: "Välkommen till Miljonbemanning! Ditt första möte är onsdag 3 februari klockan 10.00 i Alby." });
    expect(out[3].body).not.toMatch(/08-000 00 00/);
    expectNoPersonalData(out);
    expect(rows("audit_log").pop()).toMatchObject({ action: "case.accepted", entityId: "case-270050", actorId: "u-sara", details: { withinSla: true } });
    // Ett andra svar på samma avrop skapar ingen ny orderbekräftelse
    const again = await run(caseAccept, { caseId: "case-270050", leadCoachId: "u-amira", firstMeetingAt: "2027-02-03T10:00" }, sara());
    expect(again).toMatchObject({ ok: false, error: "wrong_status" });
  });

  it("en kommunanvändare kan inte acceptera (403)", async () => {
    await expectForbidden(run(caseAccept, { caseId: "case-270050", leadCoachId: "u-amira", firstMeetingAt: "2027-02-03T10:00" }, maria()));
  });

  it("första mötet är obligatoriskt vid accept – slutdatumet räknas från mötesdagen (beslut 7, 2026-10-08)", async () => {
    await expect(run(caseAccept, { caseId: "case-270050", leadCoachId: "u-amira" } as never, sara())).rejects.toBeInstanceOf(ApiError);
    expect(row("cases", "case-270050")!.status).toBe("acknowledged");
  });

  it("kompletteringen från mejlet ger referensen så att avropet kan accepteras", async () => {
    const r1 = await run(emailApplySupplement, { emailId: "em-103" }, sara());
    expect(r1).toMatchObject({ ok: true, fields: ["orderPeriod", "buyerReference"] });
    expect(row("cases", "case-270049")).toMatchObject({ buyerReference: "55102938", orderPeriodMonths: 6 });
    expect(row("inbound_emails", "em-103")).toMatchObject({ status: "applied", handledBy: "u-sara" });
    const orig = rows("inbound_emails").find((e) => e.caseId === "case-270049" && e.classification === "order")!;
    expect(orig.missingFields).toEqual([]);
    expect(await run(caseAccept, { caseId: "case-270049", leadCoachId: "u-amira", firstMeetingAt: "2027-02-03T10:00", primaryArea: "G", vocationalTrack: "Kök och restaurang" }, sara())).toMatchObject({ ok: true });
    expect(row("cases", "case-270049")).toMatchObject({ orderPeriodMonths: 6, plannedEnd: "2027-08-02" });
  });
});

describe("arenden.caseCreate (case.create)", () => {
  const order = { firstName: "Testa", lastName: "Testsson", pnr: "19900101-1234", phone: "070-000 00 00", city: "Tumba", preferredContact: "sms" as const,
    referrerUnit: "Arbetsmarknadsenheten Alby", desiredStart: "2027-02-08", orderPeriodMonths: 6, priorAssessment: "unknown" as const, source: "portal" as const };

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
    expect(c).toMatchObject({ status: "acknowledged", referrerId: "k-maria", source: "portal", buyerReference: null, primaryAreaCode: null, aiConsentStatus: "not_asked", acknowledgedAt: T1, orderPeriodMonths: 6, priorAssessment: "unknown" });
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

  it("skyddade personuppgifter kan inte anges (beslut 2026-10-07): en vanlig beställning, ordererkännande och ingen uppgift", async () => {
    const n = rows("outbound_messages").length;
    const res = await run(caseCreate, { ...order, protectedIdentity: true, address: "Testvägen 1", preferredContact: "letter" } as never, maria());
    expect(res).toMatchObject({ ok: true, caseNumber: "BOT-27-0051" });
    const id = (res as { caseId: string }).caseId;
    const c = row("cases", id)!;
    expect(c).toMatchObject({ status: "acknowledged", aiConsentStatus: "not_asked" });
    expect(row("persons", c.personId)).toMatchObject({ protectedIdentity: false, address: "Testvägen 1", preferredContact: "letter" });
    expect(rows("tasks").some((t) => t.caseIds.includes(id) || t.kind === "protected_order")).toBe(false);
    expect(outboundSince(n).map((m) => m.template)).toEqual(["ordererkannande"]);
    // Miljonbemannings registrering (telefon): samma sak, också för samordnaren.
    const tel = await run(caseCreate, { ...order, pnr: "19900303-3456", protectedIdentity: true, source: "phone", referrerId: "k-omar" } as never, sara());
    expect(tel).toMatchObject({ ok: true, caseNumber: "BOT-27-0052" });
    expect(row("persons", row("cases", (tel as { caseId: string }).caseId)!.personId)!.protectedIdentity).toBe(false);
  });

  it("felaktig beställarreferens → buyer_ref, och samma person två gånger → duplicate", async () => {
    // Bara Miljonbemanning anger referensen (telefon eller mejl) – kommunens formulär har ingen, och en skickad ignoreras.
    expect(await run(caseCreate, { ...order, source: "phone", referrerId: "k-maria", buyerReference: "12-34" }, sara())).toMatchObject({ ok: false, error: "buyer_ref" });
    const ignored = await run(caseCreate, { ...order, pnr: "19900404-4567", buyerReference: "12-34" }, maria());
    expect(ignored).toMatchObject({ ok: true });
    expect(row("cases", (ignored as { caseId: string }).caseId)!.buyerReference).toBeNull();
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
    // Ett bokat möte utan levererad orderbekräftelse (beställningen är inte accepterad): bara kallelsen.
    const n = rows("outbound_messages").length;
    expect(await run(caseBookFirstMeeting, { caseId: "case-270048", at: "2027-02-04T13:30" }, sara())).toMatchObject({ ok: true });
    expect(row("cases", "case-270048")).toMatchObject({ firstMeetingAt: "2027-02-04T13:30", plannedStart: "2027-02-04" });
    const out = outboundSince(n);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ template: "kallelse", body: "Välkommen till Miljonbemanning! Ditt första möte är torsdag 4 februari klockan 13.30 i Alby. Frågor? Ring 08-400 22 750." });
    // Skyddat ärende (vilande spärr påslagen): avtalsansvarig bokar om, ingen kallelse skickas – bara den nya orderbekräftelsens
    // mejl till kommunen (ärendenummer och länk, inga personuppgifter).
    protect();
    const m = rows("outbound_messages").length;
    expect(await run(caseBookFirstMeeting, { caseId: "case-260120", at: "2027-02-04T13:30" }, johan())).toMatchObject({ ok: true });
    expect(outboundSince(m).map((x) => x.template)).toEqual(["orderbekraftelse"]);
    expectNoPersonalData(outboundSince(m));
    // Samordnaren ser bara ärendenumret för det skyddade ärendet
    expect(await run(caseBookFirstMeeting, { caseId: "case-260120", at: "2027-02-04T13:30" }, sara())).toMatchObject({ ok: false, error: "forbidden" });
  });

  // ---------------------------------------------------------------- Beslut 7 (2026-10-08): slutdatumet räknas från första mötet
  it("ombokning räknar om planerat slut, veckor och ordervärde i veckor från mötesdagen – 6 och 12 månader", async () => {
    // 6 månader (case-270050): accept med möte 3 februari → slut 2 augusti; ombokat till 10 februari → slut 9 augusti.
    expect(await run(caseAccept, { caseId: "case-270050", leadCoachId: "u-amira", firstMeetingAt: "2027-02-03T10:00" }, sara())).toMatchObject({ ok: true });
    expect(row("cases", "case-270050")).toMatchObject({ orderPeriodMonths: 6, plannedStart: "2027-02-03", plannedEnd: "2027-08-02", plannedWeeks: 27, orderValueWeeks: 27 });
    expect(await run(caseBookFirstMeeting, { caseId: "case-270050", at: "2027-02-10T10:00" }, sara())).toMatchObject({ ok: true });
    expect(row("cases", "case-270050")).toMatchObject({ firstMeetingAt: "2027-02-10T10:00", plannedStart: "2027-02-10", plannedEnd: "2027-08-09", plannedWeeks: 27, orderValueWeeks: 27, orderPeriodMonths: 6 });
    // 12 månader (case-270049 efter kompletteringen): möte 3 februari → slut 2 februari 2028; ombokat till 17 februari → 16 februari 2028.
    expect(await run(caseAccept, { caseId: "case-270049", leadCoachId: "u-amira", firstMeetingAt: "2027-02-03T10:00", orderPeriodMonths: 12, primaryArea: "G", vocationalTrack: "Kök och restaurang" }, sara())).toMatchObject({ ok: true });
    expect(row("cases", "case-270049")).toMatchObject({ orderPeriodMonths: 12, plannedEnd: "2028-02-02" });
    expect(await run(caseBookFirstMeeting, { caseId: "case-270049", at: "2027-02-17T09:00" }, sara())).toMatchObject({ ok: true });
    const c12 = row("cases", "case-270049")!;
    expect(c12).toMatchObject({ plannedStart: "2027-02-17", plannedEnd: "2028-02-16", orderPeriodMonths: 12 });
    expect(c12.plannedWeeks).toBe(53);
    expect(c12.orderValueWeeks).toBe(53);
    expect(rows("audit_log").filter((l) => l.action === "case.first_meeting_booked").pop()).toMatchObject({ entityId: "case-270049", details: { at: "2027-02-17T09:00", rebooked: true, plannedEnd: "2028-02-16", plannedWeeks: 53 } });
  });

  it("annan tidsperiod: kommunens slutdatum behålls vid accept och ombokning, bara veckorna räknas om", async () => {
    const end = "2027-05-14";
    expect(await run(caseAccept, { caseId: "case-270050", leadCoachId: "u-amira", firstMeetingAt: "2027-02-03T10:00", orderPeriodMonths: null, plannedEnd: end, orderPeriodReason: "Deltagaren har redan en praktikplats klar i maj." }, sara())).toMatchObject({ ok: true });
    expect(row("cases", "case-270050")).toMatchObject({ orderPeriodMonths: null, plannedEnd: end, plannedWeeks: 15, orderValueWeeks: 15 });
    expect(await run(caseBookFirstMeeting, { caseId: "case-270050", at: "2027-02-22T10:00" }, sara())).toMatchObject({ ok: true });
    expect(row("cases", "case-270050")).toMatchObject({ plannedStart: "2027-02-22", plannedEnd: end, plannedWeeks: 12, orderValueWeeks: 12, orderPeriodMonths: null });
    // Ett möte efter slutdatumet stoppas – omfattningen måste ändras först.
    expect(await run(caseBookFirstMeeting, { caseId: "case-270050", at: "2027-05-17T10:00" }, sara())).toMatchObject({ ok: false, error: "order_period" });
    expect(row("cases", "case-270050")).toMatchObject({ plannedStart: "2027-02-22", plannedEnd: end });
  });

  it("ombokning efter att orderbekräftelsen levererats: ny version till kommunen, den gamla ersatt, mejl utan personuppgifter", async () => {
    const res = await run(caseAccept, { caseId: "case-270050", leadCoachId: "u-amira", firstMeetingAt: "2027-02-03T10:00" }, sara());
    if (!res.ok) throw new Error(res.error);
    const v1 = row("reports", res.reportId)!;
    expect(v1).toMatchObject({ kind: "order_confirmation", version: 1, status: "delivered", superseded: false });
    const n = rows("outbound_messages").length;
    const t = addMinutes(rt.clock.now(), 1);
    expect(await run(caseBookFirstMeeting, { caseId: "case-270050", at: "2027-02-10T10:00" }, sara())).toMatchObject({ ok: true });
    const ocs = rows("reports").filter((r) => r.caseId === "case-270050" && r.kind === "order_confirmation").sort((a, b) => a.version - b.version);
    expect(ocs).toHaveLength(2);
    expect(ocs[0]).toMatchObject({ id: v1.id, superseded: true, supersededAt: t, supersededBy: ocs[1].id });
    expect(ocs[1]).toMatchObject({ version: 2, previousId: v1.id, status: "delivered", deliveredAt: t, deliveredTo: ["k-maria"], approvedBy: "u-sara", dueAt: v1.dueAt, superseded: false });
    // Den ersatta versionen är fryst med det gamla slutdatumet; den nya visar det som gäller.
    expect(ocs[0].snapshot?.reportId).toBe(v1.id);
    expect(JSON.stringify(ocs[0].snapshot?.model)).toContain("2 augusti 2027");
    const doc = (await rt.run("query", reportDocument.key, { reportId: ocs[1].id }, maria())) as ReportDocResult;
    expect(doc.ok && doc.doc.kind === "order_confirmation" && doc.doc.m.plannedEnd).toBe("9 augusti 2027");
    expect(doc.ok && doc.doc.version).toBe(2);
    // Kommunen ser bara den nya versionen i portalen.
    const kom = (await rt.run("query", "kommun.deltagare", { caseId: "case-270050" }, maria())) as { order: { ocReportId: string }; reports: { id: string }[] };
    expect(kom.order.ocReportId).toBe(ocs[1].id);
    expect(kom.reports.map((r) => r.id)).toContain(ocs[1].id);
    expect(kom.reports.map((r) => r.id)).not.toContain(v1.id);
    // Mejlet: bara ärendenummer och uppmaning att logga in, sedan kallelsen till deltagaren.
    const out = outboundSince(n);
    expect(out.map((m) => [m.template, m.to])).toEqual([["orderbekraftelse", "maria.ekdahl@botkyrka.se"], ["kallelse", "deltagare (e-post)"]]);
    expect(out[0].body).toBe("Orderbekräftelsen för ärende BOT-27-0050 är uppdaterad – logga in i portalen för att läsa. Första mötet och planerat slut framgår där.");
    expectNoPersonalData(out);
    expect(rows("audit_log").filter((l) => l.action === "report.delivered").pop()).toMatchObject({ entityId: ocs[1].id, details: { kind: "order_confirmation", version: 2, reason: "first_meeting_rebooked", previous: v1.id } });
    // En andra ombokning ersätter version 2 med version 3.
    expect(await run(caseBookFirstMeeting, { caseId: "case-270050", at: "2027-02-11T10:00" }, sara())).toMatchObject({ ok: true });
    const again = rows("reports").filter((r) => r.caseId === "case-270050" && r.kind === "order_confirmation").sort((a, b) => a.version - b.version);
    expect(again.map((r) => [r.version, r.superseded])).toEqual([[1, true], [2, true], [3, false]]);
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
    // Skyddade personuppgifter (vilande spärr påslagen): ingen pulsmätning
    protect();
    expect(await run(caseClose, { caseId: "case-260120", endDate: "2027-02-01", endReason: "planerat_utan_resultat" }, as("u-erik", "coach"))).toMatchObject({ ok: true, resultClass: "no_result" });
    expect(rows("pulse_invites").filter((i) => i.caseId === "case-260120" && i.occasion === "exit")).toHaveLength(0);
  });

  it("case.close innan insatsen startat (Start bokad, inget startdatum): slutrapporten byggs och levereras på millisekunder (fynd 5, 2026-10-08)", async () => {
    // Deltagaren kom aldrig: accepterat avrop med bokat första möte, coachen avslutar med avbrott före mötet.
    expect(await run(caseAccept, { caseId: "case-270050", leadCoachId: "u-amira", firstMeetingAt: "2027-02-03T10:00" }, sara())).toMatchObject({ ok: true });
    expect(row("cases", "case-270050")).toMatchObject({ status: "confirmed", startDate: null });
    const started = Date.now();
    const closed = await run(caseClose, { caseId: "case-270050", endDate: "2027-02-02", endReason: "avbrott_deltagarens_val" }, amira());
    expect(closed).toMatchObject({ ok: true, resultClass: "no_result" });
    if (!closed.ok) return;
    // Perioden är avslutsdagen – aldrig ett tomt från-datum.
    expect(row("reports", closed.reportId)).toMatchObject({ kind: "final", periodStart: "2027-02-02", periodEnd: "2027-02-02" });
    const draft = (await rt.run("query", reportDocument.key, { reportId: closed.reportId }, amira())) as ReportDocResult;
    expect(draft.ok && draft.doc.kind === "final" && draft.doc.m.period).toBe("2 februari 2027 – 2 februari 2027");
    expect(await run(reportSaveFinal, { reportId: closed.reportId, obstacles: "", recommendation: "Kommunen avgör om en ny insats ska beställas." }, amira())).toMatchObject({ ok: true });
    expect(await run(reportApprove, { reportId: closed.reportId }, amira())).toMatchObject({ ok: true });
    expect(await run(reportDeliver, { reportId: closed.reportId }, amira())).toMatchObject({ ok: true });
    const delivered = (await rt.run("query", reportDocument.key, { reportId: closed.reportId }, maria())) as ReportDocResult;
    expect(delivered.ok && delivered.doc.kind === "final" && delivered.doc.m.months.length).toBe(1);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("consent.set: samtycke ges, återkallas – aldrig vid skyddade personuppgifter", async () => {
    expect(await run(consentSet, { caseId: "case-260129", value: "given", language: "somaliska" }, amira())).toMatchObject({ ok: true });
    expect(row("cases", "case-260129")!.aiConsentStatus).toBe("given");
    expect(rows("consents").filter((x) => x.caseId === "case-260129").pop()).toMatchObject({ givenAt: T1, informedBy: "u-amira", language: "somaliska", textVersion: "v1.0 (2026-10-01)" });
    expect(await run(consentSet, { caseId: "case-260129", value: "revoked" }, amira())).toMatchObject({ ok: true });
    expect(row("cases", "case-260129")!.aiConsentStatus).toBe("revoked");
    expect(rows("consents").filter((x) => x.caseId === "case-260129").pop()!.revokedAt).not.toBeNull();
    // Utan spärren går samtycket att registrera i case-260120; med den påslagen aldrig.
    expect(await run(consentSet, { caseId: "case-260120", value: "given" }, as("u-erik", "coach"))).toMatchObject({ ok: true });
    protect();
    expect(await run(consentSet, { caseId: "case-260120", value: "given" }, as("u-erik", "coach"))).toMatchObject({ ok: false, error: "protected" });
  });
});

describe("arenden: meddelanden", () => {
  it("en kommunanvändare kan inte skicka meddelande i någon annans ärende", async () => {
    // case-270049 beställdes av Ahmed – Maria ser det inte (synlighet "egna ärenden")
    expect(await run(messageSend, { caseId: "case-270049", body: "Hej" }, maria())).toMatchObject({ ok: false, error: "not_found" });
    expect(rows("messages").filter((m) => m.caseId === "case-270049" && m.senderId === "k-maria")).toHaveLength(0);
    // En annan handläggare (Omar) når inte Marias ärende
    expect(await run(messageSend, { caseId: "case-260143", body: "Hej" }, omar())).toMatchObject({ ok: false, error: "not_found" });
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
    const act = rows("activities").find((a) => a.caseId === "case-260120")!; // Eriks ärende
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
    protect();
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
  it("skyddat ärende (vilande spärr påslagen) → ai_not_allowed, loggas och ingen AI-körning sparas", async () => {
    protect();
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
    // Kommunens chef (som läste utan att kvittera) finns inte längre: en annan handläggare når inte rapporten, och
    // Miljonbemannings roller öppnar rapporter på andra vägar (rollkontrollen).
    expect(await run(reportOpen, { reportId: "rep-15828" }, omar())).toMatchObject({ ok: false, error: "not_found" });
    await expectForbidden(run(reportOpen, { reportId: "rep-15828" }, sara()));
    expect(row("reports", "rep-15828")!.openedAt).toBeNull();
    const n = rows("audit_log").length;
    expect(await run(reportOpen, { reportId: "rep-15828" }, maria())).toMatchObject({ ok: true, acknowledged: true });
    expect(row("reports", "rep-15828")).toMatchObject({ openedAt: t, openedBy: "k-maria" });
    expect(rows("audit_log").slice(n).map((x) => [x.action, x.details])).toEqual([["report.view", { by: "customer", acknowledged: true }]]);
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
    expect(await run(auditView, { action: "case.view_denied", entity: "case", entityId: "case-saknas" }, omar())).toMatchObject({ ok: false });
    expect(rows("audit_log").length).toBe(n + 1);
    // Export: bara kända detaljer följer med.
    expect(await run(auditView, { action: "export.contract_deviations", entity: "contract_deviation", entityId: null, details: { month: "2027-01" } }, sara())).toMatchObject({ ok: true });
    expect(rows("audit_log").pop()).toMatchObject({ action: "export.contract_deviations", details: { month: "2027-01" }, contractId: "c-bot" });
  });
});

// ================================================================ Ekonomi
// Beslut 2026-10-07 (synpunkt #13): en faktura per avtal och månad med en rad per ärende. Januari 2027 i testdatat är öppen
// (räknas fram) och saknar beställarreferens; decembers tilläggsfaktura är returnerad med en spärrad referens.
describe("ekonomi", () => {
  const JAN = "inv-c-bot-2027-01-avtal";
  const DEC2 = "inv-c-bot-2026-12-avtal-tillagg-2";
  const runView = (month: string) => rt.run("query", ekoRun.key, { month }, lars()) as Promise<ResultOf<typeof ekoRun>>;
  /** Godkänn januaris veckor utan närvaro (samma steg som ekonomen gör i radens detalj). */
  const approveZeroWeeks = async () => {
    const v = await runView("2027-01");
    for (const l of v.invoices.flatMap((x) => x.lines).filter((x) => x.needsApproval)) {
      for (const ch of l.checks.filter((c) => c.kind === "zero_week" && c.severity === "needs_approval")) {
        expect(await run(billingApproveZeroWeek, { month: "2027-01", caseId: l.caseId, weekKey: ch.weekKey!, note: "Kontrollerat med samordnaren." }, lars())).toMatchObject({ ok: true });
      }
    }
  };

  it("billing.sendFortnox två gånger skapar inga dubbletter – en faktura, frysta rader, nyckeln avtal:månad:grupp", async () => {
    expect(await run(invoiceSetBuyerRef, { month: "2027-01", invoiceId: JAN, reference: "55102938" }, lars())).toMatchObject({ ok: true });
    // Veckor utan närvaro måste godkännas innan fakturan godkänns.
    expect(await run(billingApproveInvoice, { month: "2027-01", invoiceId: JAN }, lars())).toMatchObject({ ok: false, error: "needs_approval" });
    await approveZeroWeeks();
    const approved = await run(billingApproveInvoice, { month: "2027-01", invoiceId: JAN }, lars());
    expect(approved).toMatchObject({ ok: true });
    const lineCount = approved.ok ? approved.lines : 0;
    expect(lineCount).toBeGreaterThan(100);
    const first = await run(billingSendFortnox, { month: "2027-01", invoiceIds: [JAN] }, lars());
    expect(first).toMatchObject({ ok: true, created: [JAN], skipped: [], blocked: [], notApproved: [] });
    const second = await run(billingSendFortnox, { month: "2027-01", invoiceIds: [JAN] }, lars());
    expect(second).toMatchObject({ ok: true, created: [], skipped: [JAN], blocked: [] });
    const drafts = rows("invoice_drafts").filter((x) => x.month === "2027-01");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      id: JAN, status: "fortnox_created", fortnoxIdempotencyKey: "c-bot:2027-01:avtal", approvedBy: "u-lars", buyerReference: "55102938", caseId: null,
      invoicedObject: "332026110", purchaseOrderNumber: "",
    });
    const lines = rows("invoice_lines").filter((l) => l.invoiceDraftId === JAN);
    expect(lines).toHaveLength(lineCount);
    expect(new Set(lines.map((l) => l.caseId)).size).toBe(lineCount);
    expect(lines.every((l) => /^BOT-\d{2}-\d{4} · v\. /.test(l.description) && l.isoWeeks.length === l.quantity && l.note.includes("Upparbetat"))).toBe(true);
    expect(rows("audit_log").pop()).toMatchObject({ action: "billing.fortnox_created", details: { created: 0, skippedAlreadyCreated: 1 } });
    expect(rows("fortnox_runs").filter((r) => r.month === "2027-01").map((r) => [r.created, r.skipped])).toEqual([[1, 0], [0, 1]]);
    // Historiska månader som redan är fakturerade skapas inte igen
    expect(await run(billingSendFortnox, { month: "2026-11", invoiceIds: ["inv-c-bot-2026-11-avtal"] }, lars())).toMatchObject({ ok: true, created: [], skipped: ["inv-c-bot-2026-11-avtal"] });
  });

  it("utan giltig beställarreferens skapas ingen faktura – varken i Fortnox eller manuellt (CLAUDE.md punkt 11)", async () => {
    await approveZeroWeeks();
    expect(await run(billingApproveInvoice, { month: "2027-01", invoiceId: JAN }, lars())).toMatchObject({ ok: true });
    // Ingen referens: stoppad.
    expect(await run(billingSendFortnox, { month: "2027-01", invoiceIds: [JAN] }, lars())).toMatchObject({ ok: true, created: [], blocked: [JAN] });
    expect(await run(billingMarkManual, { month: "2027-01", invoiceId: JAN, invoiceNo: "20417" }, lars())).toMatchObject({ ok: false, error: "blocked" });
    expect(rows("invoice_lines").filter((l) => l.invoiceDraftId === JAN)).toEqual([]);
    expect(row("invoice_drafts", JAN)?.status).toBe("approved");
    // Fel format och spärrad referens sparas inte.
    expect(await run(invoiceSetBuyerRef, { month: "2027-01", invoiceId: JAN, reference: "5510293" }, lars())).toMatchObject({ ok: false, error: "buyer_ref" });
    expect(await run(invoiceSetBuyerRef, { month: "2027-01", invoiceId: JAN, reference: "12 34" }, lars())).toMatchObject({ ok: false, error: "buyer_ref" });
    expect(await run(invoiceSetBuyerRef, { month: "2027-01", invoiceId: JAN, reference: "55102983" }, lars())).toMatchObject({ ok: false, error: "buyer_ref" });
    expect(row("invoice_drafts", JAN)?.buyerReference).toBeNull();
    // Giltig referens: fakturan skapas.
    expect(await run(invoiceSetBuyerRef, { month: "2027-01", invoiceId: JAN, reference: "55102938" }, lars())).toMatchObject({ ok: true });
    expect(rows("audit_log").pop()).toMatchObject({ action: "billing.buyer_reference_set", entity: "invoice", entityId: JAN, details: { month: "2027-01", from: "", to: "55102938" } });
    expect(await run(billingSendFortnox, { month: "2027-01", invoiceIds: [JAN] }, lars())).toMatchObject({ ok: true, created: [JAN], blocked: [] });
    // En skapad faktura får ingen ny referens.
    expect(await run(invoiceSetBuyerRef, { month: "2027-01", invoiceId: JAN, reference: "4410023817" }, lars())).toMatchObject({ ok: false, error: "created" });
  });

  it("rättelse och kreditering: den returnerade tilläggsfakturan krediteras och görs om med rätt referens – utan rättelser blir raderna desamma", async () => {
    const linesBefore = rows("invoice_lines").filter((l) => l.invoiceDraftId === DEC2).map((l) => [l.caseId, l.quantity, l.unitPriceOre, l.isoWeeks.join(",")]);
    expect(linesBefore).toHaveLength(2);
    // Spärrad referens: kan inte göras om förrän referensen är rättad.
    expect(await run(ekoReissue, { month: "2026-12", invoiceId: DEC2 }, lars())).toMatchObject({ ok: false, error: "buyer_ref" });
    expect(await run(invoiceSetBuyerRef, { month: "2026-12", invoiceId: DEC2, reference: "55102938" }, lars())).toMatchObject({ ok: true });
    expect(await run(ekoReissue, { month: "2026-12", invoiceId: DEC2 }, lars())).toMatchObject({ ok: true });
    expect(row("invoice_drafts", DEC2)).toMatchObject({ status: "fortnox_created", buyerReference: "55102938", fortnoxIdempotencyKey: "c-bot:2026-12:avtal-tillagg-2:ny" });
    expect(rows("invoice_credits")).toEqual([expect.objectContaining({ invoiceDraftId: DEC2, caseId: null, month: "2026-12", buyerReference: "55102938", creditedBy: "u-lars" })]);
    // Inget i underlaget är rättat: raderna fryses på nytt med samma innehåll – inga nya rader och inga dubbletter.
    expect(rows("invoice_lines").filter((l) => l.invoiceDraftId === DEC2).map((l) => [l.caseId, l.quantity, l.unitPriceOre, l.isoWeeks.join(",")])).toEqual(linesBefore);
    expect(rows("audit_log").pop()).toMatchObject({ action: "billing.credited_and_reissued", entity: "invoice", entityId: DEC2, details: { month: "2026-12", buyerReference: "55102938" } });
    // Bara en returnerad faktura krediteras.
    expect(await run(ekoReissue, { month: "2026-12", invoiceId: DEC2 }, lars())).toMatchObject({ ok: false, error: "not_returned" });
    expect(await run(ekoReissue, { month: "2026-12", invoiceId: "inv-c-bot-2026-12-avtal" }, lars())).toMatchObject({ ok: false, error: "not_returned" });
    // Decembers veckor räknas nu som fakturerade.
    const v = await runView("2026-12");
    expect(v.invoices.map((x) => [x.groupingKey, x.status])).toEqual([["avtal", "sent"], ["avtal-tillagg-2", "fortnox_created"]]);
  });

  it("inköpsordernumret tar bara kommunens 99-nummer – aldrig ärendenummer eller andra egna nummer", async () => {
    const po = (purchaseOrderNumber: string) => run(invoiceSetPo, { month: "2027-01", invoiceId: JAN, purchaseOrderNumber }, lars());
    expect(await po("12345")).toMatchObject({ ok: false, error: "po", message: "Inköpsordernummer ska vara nio siffror som börjar med 99." });
    expect(await po("881234567")).toMatchObject({ ok: false, error: "po" });
    expect(await po("9912345678")).toMatchObject({ ok: false, error: "po" });
    expect(await po("BOT-26-0042")).toMatchObject({ ok: false, error: "po", message: "Ärendenumret får aldrig stå som inköpsordernummer. Fältet är bara för kommunens eget ordernummer." });
    expect(row("invoice_drafts", JAN)).toBeUndefined();
    expect(await po("991234567")).toMatchObject({ ok: true });
    expect(row("invoice_drafts", JAN)?.purchaseOrderNumber).toBe("991234567");
    expect(rows("audit_log").pop()).toMatchObject({ action: "billing.purchase_order_set", details: { from: "", to: "991234567" } });
    expect((await runView("2027-01")).invoices[0]).toMatchObject({ purchaseOrderNumber: "991234567", poSet: true });
    // Tomt = inget inköpsordernummer.
    expect(await po("")).toMatchObject({ ok: true });
    expect(row("invoice_drafts", JAN)?.purchaseOrderNumber).toBe("");
    // En skapad faktura ändras inte.
    expect(await run(invoiceSetPo, { month: "2026-11", invoiceId: "inv-c-bot-2026-11-avtal", purchaseOrderNumber: "991234567" }, lars())).toMatchObject({ ok: false, error: "created" });
  });

  it("nollvecka, manuell faktura och export loggas; bara ekonomen", async () => {
    expect(await run(billingApproveZeroWeek, { month: "2027-01", caseId: "case-260157", weekKey: "2027-W02", note: "Sjukdom hela veckan, kontrollerat med coachen." }, lars())).toMatchObject({ ok: true });
    expect(row("billing_week_approvals", "case-260157:2027-W02")).toMatchObject({ approvedBy: "u-lars", month: "2027-01", note: "Sjukdom hela veckan, kontrollerat med coachen." });
    await approveZeroWeeks();
    expect(await run(invoiceSetBuyerRef, { month: "2027-01", invoiceId: JAN, reference: "55102938" }, lars())).toMatchObject({ ok: true });
    expect(await run(billingMarkManual, { month: "2027-01", invoiceId: JAN, invoiceNo: "20417" }, lars())).toMatchObject({ ok: true });
    expect(row("invoice_drafts", JAN)).toMatchObject({ status: "manual", manualInvoiceNo: "20417" });
    expect(rows("invoice_lines").filter((l) => l.invoiceDraftId === JAN).length).toBeGreaterThan(100);
    expect(await run(billingSendFortnox, { month: "2027-01", invoiceIds: [JAN] }, lars())).toMatchObject({ ok: true, skipped: [JAN] });
    expect(await run(billingExport, { month: "2027-01", format: "csv" }, lars())).toMatchObject({ ok: true });
    expect(rows("audit_log").pop()).toMatchObject({ action: "export.billing", entityId: "2027-01", details: { format: "csv" } });
    // Beslut 5 (2026-10-07): belopp och fakturor bara för ekonomen – chef, avtalsansvarig och admin nekas.
    for (const who of [as("u-karin", "chef"), as("u-johan", "avtalsansvarig"), as("u-robin", "admin")]) {
      await expectForbidden(run(billingSendFortnox, { month: "2027-01", invoiceIds: [JAN] }, who));
      await expectForbidden(rt.run("query", ekoRun.key, { month: "2027-01" }, who));
    }
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
