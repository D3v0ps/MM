// Meddelanden till deltagare (beslut 2026-10-09): kanalvalet i alla kombinationer, mallarna (bara tid, plats och telefon),
// uppgiften till samordnaren när ingen kanal finns och att inga personuppgifter hamnar i utskick eller uppgifter.
// Körs mot testdatat i minnet (createMemoryRuntime) – inget skickas på riktigt.
import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/api/server";
import { SYSTEM_ACTOR } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import type { MemoryData } from "@/data/memory";
import type { PreferredContact, Tables } from "@/data/schema";
import { createSeed, DEMO_START, decodeTestPnr, normalizePnr } from "@/data/seed";
import { CONTACT_PHONE } from "./contact";
import { EMAIL_NOT_ALLOWED_REASON, MESSAGING_OFF, PHONE_FORMAT_REASON, type MessagingStatus } from "./messaging-port";
import {
  CALL_RECORDING_TEXT, contactTaskText, notifyParticipant, notifySummary, participantMessage, participantSendStopped, planParticipantChannels, unreachableReasons,
  type NotifyParticipantInput, type ParticipantContact,
} from "./participant-notify";

const ON = { connected: true, missing: [] };
const OFF_SMS = MESSAGING_OFF.sms;
const OFF_CALL = MESSAGING_OFF.call;
const status = (sms: boolean, call: boolean): MessagingStatus => ({ sms: sms ? ON : OFF_SMS, call: call ? ON : OFF_CALL });

const EMAIL = "test.deltagare@example.invalid";
const PHONE = "070-000 00 00";
const who = (email: string, phone: string, preferredContact: PreferredContact = "sms", address: string | null = null): ParticipantContact => ({ email, phone, preferredContact, address });

describe("planParticipantChannels – kanalvalet", () => {
  it("alla kombinationer av e-post, telefon och kopplade kanaler", () => {
    // [e-post, telefon, SMS kopplat, utringning kopplad] -> [skickas, stoppas (inte kopplat)]
    const cases: [boolean, boolean, boolean, boolean, string[], string[]][] = [
      [true, true, true, true, ["sms", "email", "call"], []],
      [true, true, true, false, ["sms", "email"], ["call"]],
      [true, true, false, true, ["email", "call"], ["sms"]],
      [true, true, false, false, ["email"], ["sms", "call"]],
      [true, false, true, true, ["email"], []],
      [true, false, false, false, ["email"], []],
      [false, true, true, true, ["sms", "call"], []],
      [false, true, true, false, ["sms"], ["call"]],
      // Bara telefon och SMS inte kopplat: ingen kanal (uppgift till samordnaren) – utringningen ringer bara när SMS eller mejl gått.
      [false, true, false, true, [], ["sms"]],
      [false, true, false, false, [], ["sms"]],
      [false, false, true, true, [], []],
      [false, false, false, false, [], []],
    ];
    for (const [e, p, sms, call, send, off] of cases) {
      const plan = planParticipantChannels(who(e ? EMAIL : "", p ? PHONE : ""), status(sms, call));
      expect(plan, JSON.stringify({ e, p, sms, call })).toEqual({ send, off });
    }
  });

  it("deltagarens valda kontaktväg går först när den kanalen är kopplad", () => {
    const all = status(true, true);
    expect(planParticipantChannels(who(EMAIL, PHONE, "email"), all).send).toEqual(["email", "sms", "call"]);
    expect(planParticipantChannels(who(EMAIL, PHONE, "sms"), all).send).toEqual(["sms", "email", "call"]);
    expect(planParticipantChannels(who(EMAIL, PHONE, "phone"), all).send).toEqual(["sms", "call", "email"]);
    // SMS valt men inte kopplat: e-posten går först.
    expect(planParticipantChannels(who(EMAIL, PHONE, "sms"), status(false, false)).send).toEqual(["email"]);
    // Brev bara när deltagaren valt brev och adressen finns – först.
    expect(planParticipantChannels(who(EMAIL, PHONE, "letter", "Testgatan 1, 147 00 Tumba"), all).send).toEqual(["brev", "email", "sms", "call"]);
    expect(planParticipantChannels(who("", "", "letter", "Testgatan 1, 147 00 Tumba"), status(false, false))).toEqual({ send: ["brev"], off: [] });
    expect(planParticipantChannels(who(EMAIL, "", "letter", null), all).send).toEqual(["email"]);
    // Inbjudan till en aktivitet går aldrig som brev (hinner inte fram): utan e-post och kopplat SMS blir det en uppgift.
    expect(planParticipantChannels(who(EMAIL, PHONE, "letter", "Testgatan 1, 147 00 Tumba"), all, { letter: false }).send).toEqual(["email", "sms", "call"]);
    expect(planParticipantChannels(who("", "", "letter", "Testgatan 1, 147 00 Tumba"), status(false, false), { letter: false })).toEqual({ send: [], off: [] });
  });

  it("ogiltiga adresser och nummer räknas inte – de sparas med orsak (stoppade eller misslyckade)", () => {
    expect(planParticipantChannels(who("inte-en-adress", "070"), status(true, true))).toEqual({ send: [], off: ["email", "sms"] });
    expect(planParticipantChannels(who(" ", "+46 (0)70-000 00 00"), status(true, false))).toEqual({ send: ["sms"], off: ["call"] });
    // Samma regel som portalen och deltagarkortet (src/core/contact.ts): utan nolla eller plus går numret inte att tolka.
    expect(planParticipantChannels(who(EMAIL, "701234567"), status(true, true))).toEqual({ send: ["email"], off: ["sms"] });
    expect(planParticipantChannels(who("anna@botkyrka", ""), status(true, true))).toEqual({ send: [], off: ["email"] });
  });

  it("e-post som spärrlistan stoppar (MM_EMAIL_ALLOWLIST i drift) räknas inte som kanal", () => {
    const blocked = (sms: boolean, call: boolean): MessagingStatus => ({ ...status(sms, call), emailReaches: (a) => a.endsWith("@miljonbemanning.se") });
    expect(planParticipantChannels(who(EMAIL, PHONE), blocked(false, false))).toEqual({ send: [], off: ["email", "sms"] });
    expect(planParticipantChannels(who(EMAIL, ""), blocked(false, false))).toEqual({ send: [], off: ["email"] });
    // SMS kopplat: SMS:et går, utringningen hänvisar till det.
    expect(planParticipantChannels(who(EMAIL, PHONE), blocked(true, true))).toEqual({ send: ["sms", "call"], off: ["email"] });
    // En adress som listan släpper igenom räknas.
    expect(planParticipantChannels(who("test@miljonbemanning.se", ""), blocked(false, false))).toEqual({ send: ["email"], off: [] });
  });

  it("orsakerna till uppgiften", () => {
    const blocked: MessagingStatus = { ...status(false, false), emailReaches: () => false };
    expect(unreachableReasons(who("", PHONE), status(false, false))).toEqual(["no_email", "sms_off"]);
    expect(unreachableReasons(who("", ""), status(true, true))).toEqual(["no_email", "no_phone"]);
    expect(unreachableReasons(who(EMAIL, PHONE), blocked)).toEqual(["email_blocked", "sms_off"]);
    expect(unreachableReasons(who("anna@botkyrka", "701234567"), status(true, true))).toEqual(["bad_email", "bad_phone"]);
  });
});

describe("mallarna – bara tid, plats och Miljonbemannings telefonnummer", () => {
  it("aktivitetsinbjudan och kallelse", () => {
    expect(CONTACT_PHONE).toBe("08-400 22 750");
    expect(participantMessage("aktivitetsinbjudan", "2027-02-04T13:30", "Miljonbemanning, Alby")).toBe(
      "Hej! Du är inbjuden till en aktivitet hos Miljonbemanning torsdag 4 februari kl. 13.30, Miljonbemanning, Alby. Frågor? Ring 08-400 22 750.",
    );
    expect(participantMessage("kallelse", "2027-02-04T13:30", "Alby")).toBe("Välkommen till Miljonbemanning! Ditt första möte är torsdag 4 februari klockan 13.30 i Alby. Frågor? Ring 08-400 22 750.");
    // Platsen trimmas och kortas; tom plats blir Miljonbemanning.
    expect(participantMessage("aktivitetsinbjudan", "2027-02-04T09:00", "  Alby\n  torg ")).toContain("kl. 09.00, Alby torg.");
    expect(participantMessage("aktivitetsinbjudan", "2027-02-04T09:00", "")).toContain("kl. 09.00, Miljonbemanning.");
    expect(participantMessage("aktivitetsinbjudan", "2027-02-04T09:00", "x".repeat(500)).length).toBeLessThan(250);
    // Inspelningens text: ingen tid, ingen plats, inget namn.
    expect(CALL_RECORDING_TEXT).toBe("Inspelat meddelande: Hej, det här är Miljonbemanning. Du har fått en inbjudan till ett möte hos oss. Tid och plats står i ditt SMS eller mejl. Har du frågor, ring 08-400 22 750.");
  });

  it("uppgiften till samordnaren: ärendenummer, tid, plats och varför – aldrig namn, adress eller nummer", () => {
    const text = (template: "kallelse" | "aktivitetsinbjudan", p: ParticipantContact, st: MessagingStatus = status(false, false)) =>
      contactTaskText(template, "BOT-27-0048", "2027-02-04T13:30", "Alby", unreachableReasons(p, st));
    expect(text("kallelse", who("", PHONE))).toBe(
      "Ring deltagaren och kalla till första mötet – ärende BOT-27-0048, torsdag 4 februari kl. 13.30, Alby. Kallelsen kunde inte skickas: deltagaren har ingen e-postadress och SMS är inte kopplat.",
    );
    expect(text("aktivitetsinbjudan", who("", ""))).toBe(
      "Ring deltagaren och bjud in till aktiviteten – ärende BOT-27-0048, torsdag 4 februari kl. 13.30, Alby. Deltagaren har varken e-postadress eller telefonnummer – fråga beställande handläggare.",
    );
    // Ett nummer som finns men inte går att tolka: inte "varken e-postadress eller telefonnummer".
    expect(text("kallelse", who("", "701234567"), status(true, true))).toBe(
      "Ring deltagaren och kalla till första mötet – ärende BOT-27-0048, torsdag 4 februari kl. 13.30, Alby. Kallelsen kunde inte skickas: deltagaren har ingen e-postadress och telefonnumret har fel format – kontrollera numret.",
    );
    expect(text("kallelse", who("anna@botkyrka", ""))).toContain("Kallelsen kunde inte skickas: e-postadressen har fel format och deltagaren har inget telefonnummer – kontrollera adressen.");
    // Spärrlistan för e-post: samordnaren ringer.
    expect(text("kallelse", who(EMAIL, PHONE), { ...status(false, false), emailReaches: () => false })).toContain(
      "Kallelsen kunde inte skickas: e-post till deltagarens adress är spärrad just nu och SMS är inte kopplat.",
    );
  });

  it("meningen till den som bokade – skickas, inte skickad: utskicket ligger i kön och kan stoppas när det skickas", () => {
    expect(notifySummary("kallelse", { channels: ["email"], taskId: null, blocked: false })).toBe("Kallelsen skickas med e-post.");
    expect(notifySummary("kallelse", { channels: ["sms", "email", "call"], taskId: null, blocked: false })).toBe("Kallelsen skickas med SMS och e-post. Deltagaren blir också uppringd med ett inspelat meddelande.");
    expect(notifySummary("aktivitetsinbjudan", { channels: [], taskId: "task-1", blocked: false })).toBe("Inbjudan kunde inte skickas. Samordnaren har fått en uppgift att ringa deltagaren.");
    expect(notifySummary("kallelse", { channels: [], taskId: null, blocked: true })).toBe("Kallelsen skickades inte.");
    // Brev (deltagaren har valt brev och adressen finns): skickas för hand, utöver e-posten.
    expect(notifySummary("kallelse", { channels: ["brev", "email"], taskId: null, blocked: false })).toBe("Kallelsen skickas med e-post. Ett brev skickas också för hand.");
    expect(notifySummary("kallelse", { channels: ["brev"], taskId: null, blocked: false })).toBe("Kallelsen ska skickas som brev. Brevet skickas för hand.");
  });
});

// ================================================================ notifyParticipant mot testdatat
const SEED: MemoryData<Tables> = createSeed();
const CASE = "case-270048";
let rt: MemoryRuntime;
const setup = (messaging?: MessagingStatus) => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START), ...(messaging ? { messaging } : {}) });
};
beforeEach(() => setup());

/** En Ctx för samordnaren (som hanterarna får) – samma runtime, samma behörighet. */
function ctxAs(userId: string, role: "samordnare" | "coach" | "avtalsansvarig"): Ctx {
  const actor = listPersonas(rt.raw()).find((p) => p.actor.userId === userId && p.actor.role === role)!.actor;
  return rt.ctxFor(actor);
}
const person = () => rt.store.rows("persons").find((p) => p.id === rt.raw().get("cases", CASE)!.personId)!;
const input = (o: Partial<NotifyParticipantInput> = {}): NotifyParticipantInput => ({ caseId: CASE, template: "aktivitetsinbjudan", when: "2027-02-04T13:30", place: "Alby", ...o });
const outbound = () => rt.store.rows("outbound_messages").filter((m) => m.caseId === CASE && (m.template === "aktivitetsinbjudan" || m.template === "kallelse"));
const contactTasks = () => rt.store.rows("tasks").filter((t) => t.kind === "participant_contact");

/** Inga namn eller personnummer på deltagare i utskick och uppgifter (CLAUDE.md punkt 9). */
function expectNoPersonalData(texts: string[]) {
  const pii = rt.store.rows("persons").flatMap((p) => [p.firstName, p.lastName, p.email, normalizePnr(decodeTestPnr(p.personnummerEnc))]).filter((x) => x && x.length >= 4);
  for (const t of texts) {
    for (const x of pii) expect(t.includes(x), `"${x}" i "${t}"`).toBe(false);
    expect(t).not.toMatch(/070-?\d/);
  }
}

describe("notifyParticipant", () => {
  it("bara e-post när SMS och utringning inte är kopplade – SMS och samtal stoppas med orsak", async () => {
    const r = await notifyParticipant(ctxAs("u-sara", "samordnare"), input());
    expect(r).toEqual({ channels: ["email"], off: ["sms", "call"], taskId: null, blocked: false, summary: "Inbjudan skickas med e-post." });
    expect(outbound().map((m) => [m.channel, m.to, m.status, m.statusReason ?? null])).toEqual([
      ["email", "deltagare (e-post)", "sent", null],
      ["sms", "deltagare (SMS)", "suppressed", "SMS-leverantör inte vald"],
      ["call", "deltagare (samtal)", "suppressed", "Utringning inte kopplad"],
    ]);
    expect(outbound()[0].body).toBe("Hej! Du är inbjuden till en aktivitet hos Miljonbemanning torsdag 4 februari kl. 13.30, Alby. Frågor? Ring 08-400 22 750.");
    expect(outbound()[2].body).toBe(CALL_RECORDING_TEXT);
    expect(contactTasks()).toEqual([]);
    expectNoPersonalData(outbound().flatMap((m) => [m.to, m.body, m.subject ?? ""]));
  });

  it("SMS och utringning kopplade: SMS (deltagarens val) först, e-post och samtal – samma text", async () => {
    setup(status(true, true));
    const r = await notifyParticipant(ctxAs("u-amira", "coach"), input());
    expect(r).toMatchObject({ channels: ["sms", "email", "call"], off: [], taskId: null, summary: "Inbjudan skickas med SMS och e-post. Deltagaren blir också uppringd med ett inspelat meddelande." });
    expect(outbound().map((m) => [m.channel, m.status])).toEqual([["sms", "sent"], ["email", "sent"], ["call", "sent"]]);
    expect(outbound()[0].body).toBe(outbound()[1].body);
  });

  it("ingen kanal: uppgift till samordnaren med ärendenumret – en gång, och kallelsens uppgift uppdateras vid ombokning", async () => {
    rt.store.updateRow("persons", person().id, { email: "" });
    const ctx = ctxAs("u-sara", "samordnare");
    const r = await notifyParticipant(ctx, input({ template: "kallelse" }));
    expect(r).toMatchObject({ channels: [], off: ["sms"], blocked: false, summary: "Kallelsen kunde inte skickas. Samordnaren har fått en uppgift att ringa deltagaren." });
    expect(r.taskId).toBeTruthy();
    const [t] = contactTasks();
    expect(t).toMatchObject({ id: r.taskId, toRole: "samordnare", toId: null, status: "open", caseIds: [CASE], fromId: "u-sara" });
    expect(t.text).toBe("Ring deltagaren och kalla till första mötet – ärende BOT-27-0048, torsdag 4 februari kl. 13.30, Alby. Kallelsen kunde inte skickas: deltagaren har ingen e-postadress och SMS är inte kopplat.");
    expect(rt.store.rows("audit_log").filter((a) => a.action === "task.created").pop()).toMatchObject({ entityId: r.taskId, details: { kind: "participant_contact", caseId: CASE, template: "kallelse" } });
    // SMS:et som inte kunde gå finns i utskicksloggen med orsak; inget samtal (det hänvisar till SMS:et eller mejlet).
    expect(outbound().map((m) => [m.channel, m.status])).toEqual([["sms", "suppressed"]]);
    // Ombokning: samma uppgift, ny tid.
    const again = await notifyParticipant(ctx, input({ template: "kallelse", when: "2027-02-05T10:00" }));
    expect(again.taskId).toBe(r.taskId);
    expect(contactTasks()).toHaveLength(1);
    expect(contactTasks()[0].text).toContain("fredag 5 februari kl. 10.00");
    // En inbjudan till aktivitet blir en egen uppgift – samma inbjudan två gånger blir inte två uppgifter.
    const a1 = await notifyParticipant(ctx, input());
    const a2 = await notifyParticipant(ctx, input());
    expect(a1.taskId).toBe(a2.taskId);
    expect(contactTasks()).toHaveLength(2);
    // Samordnaren ser uppgifterna (policyn för tasks: toRole).
    expect((await ctx.repo.table("tasks").list({ kind: "participant_contact" })).length).toBe(2);
    expectNoPersonalData(contactTasks().map((x) => x.text));
  });

  it("vilande spärr: skyddade personuppgifter ger inget utskick och ingen uppgift", async () => {
    rt.store.updateRow("persons", person().id, { protectedIdentity: true });
    const r = await notifyParticipant(rt.ctxFor(SYSTEM_ACTOR), input());
    expect(r).toMatchObject({ channels: [], off: [], taskId: null, blocked: true });
    expect(outbound()).toEqual([]);
    expect(contactTasks()).toEqual([]);
  });
});

// ================================================================ Granskningen: spärrlistan, fel format, ombokning, stoppat vid sändningen
describe("notifyParticipant – en kanal räknas bara när utskicket når fram", () => {
  it("e-post som spärrlistan stoppar (drift med MM_EMAIL_ALLOWLIST): mejlet sparas som stoppat och samordnaren får uppgiften", async () => {
    setup({ ...status(false, false), emailReaches: (a) => a.endsWith("@miljonbemanning.se") });
    const r = await notifyParticipant(ctxAs("u-sara", "samordnare"), input({ template: "kallelse" }));
    expect(r).toMatchObject({ channels: [], off: ["email", "sms"], summary: "Kallelsen kunde inte skickas. Samordnaren har fått en uppgift att ringa deltagaren." });
    expect(outbound().map((m) => [m.channel, m.status, m.statusReason])).toEqual([
      ["email", "suppressed", EMAIL_NOT_ALLOWED_REASON],
      ["sms", "suppressed", "SMS-leverantör inte vald"],
    ]);
    expect(contactTasks()).toHaveLength(1);
    expect(contactTasks()[0].text).toBe(
      "Ring deltagaren och kalla till första mötet – ärende BOT-27-0048, torsdag 4 februari kl. 13.30, Alby. Kallelsen kunde inte skickas: e-post till deltagarens adress är spärrad just nu och SMS är inte kopplat.",
    );
  });

  it("ett telefonnummer med fel format: SMS:et sparas som misslyckat med orsak (utan numret) och uppgiften säger det", async () => {
    setup(status(true, true));
    rt.store.updateRow("persons", person().id, { email: "", phone: "701234567" });
    const r = await notifyParticipant(ctxAs("u-sara", "samordnare"), input());
    expect(r).toMatchObject({ channels: [], off: ["sms"] });
    expect(outbound().map((m) => [m.channel, m.status, m.statusReason])).toEqual([["sms", "failed", PHONE_FORMAT_REASON]]);
    expect(contactTasks()[0].text).toContain("Inbjudan kunde inte skickas: deltagaren har ingen e-postadress och telefonnumret har fel format – kontrollera numret.");
    expectNoPersonalData([...contactTasks().map((x) => x.text), ...outbound().map((m) => m.statusReason ?? "")]);
  });

  it("ombokning när en kanal har tillkommit: kallelsens öppna uppgift med den gamla tiden stängs (systemet, anteckning, revisionslogg)", async () => {
    const mail = person().email;
    rt.store.updateRow("persons", person().id, { email: "" });
    const ctx = ctxAs("u-sara", "samordnare");
    const first = await notifyParticipant(ctx, input({ template: "kallelse", when: "2027-02-02T10:00" }));
    expect(contactTasks()[0]).toMatchObject({ id: first.taskId, status: "open" });
    expect(contactTasks()[0].text).toContain("tisdag 2 februari kl. 10.00");
    // Coachen lägger till e-postadressen och bokar om: mejlet går och uppgiften med den gamla tiden stängs.
    rt.store.updateRow("persons", person().id, { email: mail });
    const again = await notifyParticipant(ctxAs("u-amira", "coach"), input({ template: "kallelse", when: "2027-02-03T13:00" }));
    expect(again).toMatchObject({ channels: ["email"], taskId: null });
    expect(contactTasks()).toHaveLength(1);
    expect(contactTasks()[0]).toMatchObject({ status: "done", doneBy: "system", doneNote: "Kallelsen skickades med e-post vid ombokningen." });
    expect(contactTasks()[0].doneAt).toBeTruthy();
    expect(rt.store.rows("audit_log").filter((a) => a.action === "task.done").pop()).toMatchObject({
      actorId: "u-amira", entityId: first.taskId, details: { kind: "participant_contact", caseId: CASE, template: "kallelse", auto: true, channels: ["email"] },
    });
    // Samordnaren ser ingen öppen uppgift längre.
    expect(await ctx.repo.table("tasks").list({ kind: "participant_contact", status: "open" })).toEqual([]);
  });

  it("inbjudan: bara uppgiften med samma tid och plats stängs; ombokad kallelse utan kanal uppdaterar uppgiften och loggar ändringen", async () => {
    const mail = person().email;
    rt.store.updateRow("persons", person().id, { email: "" });
    const ctx = ctxAs("u-sara", "samordnare");
    const a1 = await notifyParticipant(ctx, input({ when: "2027-02-04T13:30" }));
    const a2 = await notifyParticipant(ctx, input({ when: "2027-02-05T09:00" }));
    const k = await notifyParticipant(ctx, input({ template: "kallelse", when: "2027-02-02T10:00" }));
    await notifyParticipant(ctx, input({ template: "kallelse", when: "2027-02-02T11:00" }));
    expect(rt.store.rows("audit_log").filter((a) => a.action === "task.updated").pop()).toMatchObject({ entityId: k.taskId, details: { kind: "participant_contact", template: "kallelse" } });
    rt.store.updateRow("persons", person().id, { email: mail });
    await notifyParticipant(ctx, input({ when: "2027-02-04T13:30" }));
    const byId = (id: string | null) => contactTasks().find((t) => t.id === id)!;
    expect(byId(a1.taskId)).toMatchObject({ status: "done", doneNote: "Inbjudan skickades med e-post." });
    expect(byId(a2.taskId).status).toBe("open");
    expect(byId(k.taskId).status).toBe("open");
    expect(byId(k.taskId).text).toContain("tisdag 2 februari kl. 11.00");
  });
});

describe("participantSendStopped – utskicket stoppades eller misslyckades när det skulle skickas (jobbet send_message)", () => {
  const sys = () => rt.ctxFor(SYSTEM_ACTOR);
  const AT = "2027-02-04T13:30";
  const inv = { when: AT, place: "Alby" };
  const row = (channel: string) => outbound().find((m) => m.channel === channel)!;

  it("inget annat skriftligt utskick gick: uppgift till samordnaren – en gång, med orsaken utan leverantör eller adress", async () => {
    setup(status(true, false));
    await notifyParticipant(ctxAs("u-sara", "samordnare"), input());
    expect(outbound().map((m) => [m.channel, m.status])).toEqual([["sms", "sent"], ["email", "sent"], ["call", "suppressed"]]);
    // Mejlet stoppas av spärrlistan; SMS:et ligger kvar i kön – det avgör själv när det är klart.
    rt.store.updateRow("outbound_messages", row("email").id, { status: "suppressed", statusReason: EMAIL_NOT_ALLOWED_REASON, sentAt: null });
    rt.store.updateRow("outbound_messages", row("sms").id, { status: "queued", sentAt: null });
    expect(await participantSendStopped(sys(), row("email").id, inv)).toBeNull();
    // 46elks avvisade SMS:et efter alla försök: ingen kanal nådde deltagaren.
    rt.store.updateRow("outbound_messages", row("sms").id, { status: "failed", statusReason: "46elks svarade 400 (Invalid to number)" });
    const id = await participantSendStopped(sys(), row("sms").id, inv);
    expect(id).toBeTruthy();
    expect(contactTasks()).toEqual([expect.objectContaining({ id, toRole: "samordnare", status: "open", caseIds: [CASE], fromId: "system" })]);
    expect(contactTasks()[0].text).toBe(
      "Ring deltagaren och bjud in till aktiviteten – ärende BOT-27-0048, torsdag 4 februari kl. 13.30, Alby. Inbjudan kunde inte skickas: e-post till deltagarens adress är spärrad just nu och SMS:et kunde inte skickas.",
    );
    expect(rt.store.rows("audit_log").filter((a) => a.action === "task.created").pop()).toMatchObject({ actorId: "system", entityId: id });
    // Idempotent: samma utskick (eller det andra i omgången) ger ingen andra uppgift.
    expect(await participantSendStopped(sys(), row("email").id, inv)).toBe(id);
    expect(contactTasks()).toHaveLength(1);
    expectNoPersonalData(contactTasks().map((x) => x.text));
  });

  it("ingen uppgift när en annan kanal gick, för samtalet, utan tid och plats, för en kallelse som bokats om, eller med skyddade personuppgifter", async () => {
    setup(status(true, true));
    rt.store.updateRow("cases", CASE, { firstMeetingAt: AT });
    await notifyParticipant(ctxAs("u-sara", "samordnare"), input({ template: "kallelse" }));
    rt.store.updateRow("outbound_messages", row("email").id, { status: "failed", statusReason: "Resend svarade 422 (validation_error)" });
    // SMS:et gick.
    expect(await participantSendStopped(sys(), row("email").id, inv)).toBeNull();
    rt.store.updateRow("outbound_messages", row("sms").id, { status: "failed", statusReason: PHONE_FORMAT_REASON });
    rt.store.updateRow("outbound_messages", row("call").id, { status: "failed", statusReason: "46elks svarade 400" });
    expect(await participantSendStopped(sys(), row("call").id, inv)).toBeNull();
    expect(await participantSendStopped(sys(), row("email").id, null)).toBeNull();
    // Kallelsen gäller inte längre ärendets första möte (ombokad): den nya omgången avgör.
    rt.store.updateRow("cases", CASE, { firstMeetingAt: "2027-02-05T10:00" });
    expect(await participantSendStopped(sys(), row("email").id, inv)).toBeNull();
    rt.store.updateRow("cases", CASE, { firstMeetingAt: AT });
    rt.store.updateRow("persons", person().id, { protectedIdentity: true });
    expect(await participantSendStopped(sys(), row("email").id, inv)).toBeNull();
    expect(contactTasks()).toEqual([]);
    rt.store.updateRow("persons", person().id, { protectedIdentity: false });
    expect(await participantSendStopped(sys(), row("sms").id, inv)).toBeTruthy();
    expect(contactTasks()[0].text).toContain("Kallelsen kunde inte skickas: mejlet kunde inte skickas och telefonnumret har fel format – kontrollera numret.");
  });
});
