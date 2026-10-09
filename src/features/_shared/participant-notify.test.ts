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
import { MESSAGING_OFF, type MessagingStatus } from "./messaging-port";
import {
  CALL_RECORDING_TEXT, contactTaskText, notifyParticipant, notifySummary, participantMessage, planParticipantChannels, type NotifyParticipantInput, type ParticipantContact,
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
  });

  it("ogiltiga adresser och nummer räknas inte", () => {
    expect(planParticipantChannels(who("inte-en-adress", "070"), status(true, true))).toEqual({ send: [], off: [] });
    expect(planParticipantChannels(who(" ", "+46 (0)70-000 00 00"), status(true, false))).toEqual({ send: ["sms"], off: ["call"] });
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

  it("uppgiften till samordnaren: ärendenummer, tid och plats – aldrig namn", () => {
    expect(contactTaskText("kallelse", "BOT-27-0048", "2027-02-04T13:30", "Alby", who("", PHONE))).toBe(
      "Ring deltagaren och kalla till första mötet – ärende BOT-27-0048, torsdag 4 februari kl. 13.30, Alby. Kallelsen kunde inte skickas: deltagaren har ingen e-postadress och SMS är inte kopplat.",
    );
    expect(contactTaskText("aktivitetsinbjudan", "BOT-27-0048", "2027-02-04T13:30", "Alby", who("", ""))).toBe(
      "Ring deltagaren och bjud in till aktiviteten – ärende BOT-27-0048, torsdag 4 februari kl. 13.30, Alby. Deltagaren har varken e-postadress eller telefonnummer – fråga beställande handläggare.",
    );
  });

  it("meningen till den som bokade", () => {
    expect(notifySummary("kallelse", { channels: ["email"], taskId: null, blocked: false })).toBe("Kallelsen är skickad med e-post.");
    expect(notifySummary("kallelse", { channels: ["sms", "email", "call"], taskId: null, blocked: false })).toBe("Kallelsen är skickad med SMS och e-post. Deltagaren blir också uppringd med ett inspelat meddelande.");
    expect(notifySummary("aktivitetsinbjudan", { channels: [], taskId: "task-1", blocked: false })).toBe("Inbjudan kunde inte skickas. Samordnaren har fått en uppgift att ringa deltagaren.");
    expect(notifySummary("kallelse", { channels: [], taskId: null, blocked: true })).toBe("Kallelsen skickades inte.");
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
    expect(r).toEqual({ channels: ["email"], off: ["sms", "call"], taskId: null, blocked: false, summary: "Inbjudan är skickad med e-post." });
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
    expect(r).toMatchObject({ channels: ["sms", "email", "call"], off: [], taskId: null, summary: "Inbjudan är skickad med SMS och e-post. Deltagaren blir också uppringd med ett inspelat meddelande." });
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
