// SMS och utringning via 46elks (beslut 2026-10-09). 46elks fejkas (test-helpers.ts fakeElks) – inget skickas på riktigt.
// Kontrollerar: variablerna (stoppat utan dem, bara namnen i läget), anropens format (form-kodat, basic auth, voice_start),
// E.164, deltagarens nummer slås upp via ärendet, testmiljöns spärr och omdirigering, felorsaker utan nummer eller text,
// nya försök och att ett avbrutet försök aldrig skickar samma SMS två gånger.
import { describe, expect, it } from "vitest";
import { toE164 } from "@/core/phone";
import type { Case, Person } from "@/data/schema";
import { createSeed } from "@/data/seed";
import { CALL_RECORDING_TEXT } from "@/features/_shared/participant-notify";
import { PARTICIPANT_TO } from "@/features/_shared/messaging-port";
import { runJobs } from "../jobs/runner";
import { JOB_HANDLERS, type JobDeps } from "../jobs/registry";
import { DEFAULT_SMS_FROM, messagingStatus, phoneEnv } from "./config";
import { phoneDecision, phoneGate, recipientGate, REASON } from "./decision";
import { ELKS_CALLS_ENDPOINT, ELKS_SMS_ENDPOINT, placeCallVia46elks, scrubElksError, sendSmsVia46elks } from "./elks";
import { queueMessage } from "./queue";
import { deliverMessage, PENDING_PROVIDER_ID, SMS_TEST_PREFIX, type SenderDeps } from "./sender";
import { fakeElks, fakeResend, memoryJobStore, memoryNotifyRepo } from "./test-helpers";

const NOW = "2027-02-01T09:12";
const SEED = createSeed();
const CASE = SEED.cases.find((c) => c.id === "case-270048")! as Case;
const PERSON = SEED.persons.find((p) => p.id === CASE.personId)! as Person;
const PHONE = toE164(PERSON.phone)!;
const TESTER = "+46701112233";
const BODY = "Hej! Du är inbjuden till en aktivitet hos Miljonbemanning torsdag 4 februari kl. 13.30, Alby. Frågor? Ring 08-400 22 750.";
const SMS = { username: "u_test", password: "hemligt-losenord", from: "Miljonbem" };
const CALL = { username: "u_test", password: "hemligt-losenord", from: "+46766860000", audioUrl: "https://www.miljonmatch.se/ljud/kallelse.mp3" };
const ENV = { MM_SMS_PROVIDER: "46elks", ELKS_API_USERNAME: "u_test", ELKS_API_PASSWORD: "hemligt-losenord", MM_CALL_FROM: "0766-86 00 00", MM_CALL_AUDIO_URL: CALL.audioUrl };

let seq = 0;
const newId = (p: string) => `${p}-sms${++seq}`;

function setup(o: { env?: "staging" | "production"; allow?: string[]; redirect?: string | null; sms?: typeof SMS | null; call?: typeof CALL | null; persons?: Person[]; fail?: { status: number; text?: string }[]; throwError?: { name: "TypeError" | "TimeoutError"; times: number } } = {}) {
  const { repo, store } = memoryNotifyRepo(SEED.cases, { persons: o.persons ?? (SEED.persons as Person[]), profiles: SEED.profiles, memberships: SEED.memberships, organizations: SEED.organizations });
  const elks = fakeElks({ fail: o.fail, throwError: o.throwError });
  const resend = fakeResend();
  const env = o.env ?? "production";
  const deps: SenderDeps = {
    repo, gate: recipientGate(env, []), render: { appUrl: "https://www.miljonmatch.se", staffDomains: ["miljonbemanning.se"] }, resend: { apiKey: "re_x", from: "Miljonmatch <notis@miljonmatch.se>" },
    fetch: resend.fetch, now: NOW,
    phone: { gate: phoneGate(env, o.allow ?? [], o.redirect ?? null), sms: o.sms === undefined ? SMS : o.sms, call: o.call === undefined ? CALL : o.call, fetch: elks.fetch },
  };
  const jobs = memoryJobStore(store);
  const run = (now = NOW) => runJobs<JobDeps>({ store: jobs, handlers: JOB_HANDLERS, ctx: { notify: { ...deps, now } } as JobDeps, now, limit: 20 });
  const queue = (channel: "sms" | "call", body = BODY, to = PARTICIPANT_TO[channel]) =>
    queueMessage(repo, { channel, to, template: "aktivitetsinbjudan", body, caseId: CASE.id }, NOW, newId, { phone: { sms: !!deps.phone?.sms, call: !!deps.phone?.call } });
  const msg = (id: string) => store.getRow("outbound_messages", id)!;
  return { repo, store, elks, resend, deps, run, queue, msg };
}

/** Inga nummer eller meddelandets text i utskicksloggens orsak eller jobbens felorsak. */
function expectClean(store: ReturnType<typeof setup>["store"]) {
  for (const r of store.rows("outbound_messages")) {
    const reason = r.statusReason ?? "";
    // HTTP-statusen (400, 503) får stå – ett telefonnummer aldrig.
    expect(reason).not.toMatch(/\d{5}/);
    expect(reason.replace(/\D/g, "")).not.toContain(PHONE.slice(3));
    expect(reason).not.toContain("inbjuden");
    expect(r.to).not.toMatch(/\d/);
  }
  for (const j of store.rows("jobs")) {
    expect(j.lastError ?? "").not.toMatch(/\d{6}/);
    expect(j.lastError ?? "").not.toContain("inbjuden");
  }
}

// ================================================================ Variablerna
describe("variablerna (MM_SMS_PROVIDER, ELKS_API_USERNAME, ELKS_API_PASSWORD, MM_SMS_FROM, MM_CALL_FROM, MM_CALL_AUDIO_URL)", () => {
  it("utan variabler: inget kopplat – läget har bara namnen", () => {
    const e = phoneEnv({});
    expect(e).toMatchObject({ sms: null, call: null, allowlist: [], redirectTo: null });
    expect(e.status).toEqual({
      sms: { connected: false, missing: ["MM_SMS_PROVIDER", "ELKS_API_USERNAME", "ELKS_API_PASSWORD"] },
      call: { connected: false, missing: ["ELKS_API_USERNAME", "ELKS_API_PASSWORD", "MM_CALL_FROM", "MM_CALL_AUDIO_URL"] },
    });
  });

  it("alla variabler: SMS och utringning kopplade, avsändaren Miljonbem som standard, MM_CALL_FROM i E.164", () => {
    const e = phoneEnv(ENV);
    expect(e.sms).toEqual({ username: "u_test", password: "hemligt-losenord", from: DEFAULT_SMS_FROM });
    expect(e.call).toEqual({ username: "u_test", password: "hemligt-losenord", from: "+46766860000", audioUrl: CALL.audioUrl });
    expect(e.status).toEqual({ sms: { connected: true, missing: [] }, call: { connected: true, missing: [] } });
    expect(DEFAULT_SMS_FROM.length).toBeLessThanOrEqual(11);
    expect(phoneEnv({ ...ENV, MM_SMS_FROM: "Miljonbeman" }).sms?.from).toBe("Miljonbeman");
  });

  it("fel värden: namnet och vad som är fel – aldrig värdet", () => {
    const e = phoneEnv({ ...ENV, MM_SMS_PROVIDER: "twilio", MM_SMS_FROM: "Miljonbemanning AB", MM_CALL_FROM: "123", MM_CALL_AUDIO_URL: "http://exempel.se/ljud.mp3" });
    expect(e.sms).toBeNull();
    expect(e.call).toBeNull();
    expect(e.status.sms.missing).toEqual(["MM_SMS_PROVIDER (ska vara 46elks)", "MM_SMS_FROM (3–11 bokstäver eller siffror, börjar med en bokstav)"]);
    expect(e.status.call.missing).toEqual(["MM_CALL_FROM (fel format – ett 46elks-nummer som +46…)", "MM_CALL_AUDIO_URL (ska börja med https://)"]);
    const json = JSON.stringify(e.status);
    for (const secret of ["twilio", "Miljonbemanning AB", "http://exempel.se", "hemligt-losenord", "u_test"]) expect(json).not.toContain(secret);
    // Utringningen kräver inte MM_SMS_PROVIDER – bara inloggningen, numret och inspelningen.
    expect(messagingStatus({ ELKS_API_USERNAME: "u", ELKS_API_PASSWORD: "p", MM_CALL_FROM: "+46766860000", MM_CALL_AUDIO_URL: CALL.audioUrl })).toEqual({
      sms: { connected: false, missing: ["MM_SMS_PROVIDER"] }, call: { connected: true, missing: [] },
    });
  });

  it("testmiljöns spärrlista och omdirigering för telefonnummer (MM_SMS_ALLOWLIST, MM_SMS_REDIRECT_TO)", () => {
    const e = phoneEnv({ MM_SMS_ALLOWLIST: "070-111 22 33; +46 70 444 55 66, inte-ett-nummer", MM_SMS_REDIRECT_TO: "070-111 22 33" });
    expect(e.allowlist).toEqual([TESTER, "+46704445566"]);
    expect(e.redirectTo).toBe(TESTER);
    expect(phoneGate("staging", e.allowlist, e.redirectTo)).toEqual({ restricted: true, allowlist: [TESTER, "+46704445566"], environment: "staging", redirectTo: TESTER });
    // Aldrig omdirigering i produktion eller okänd miljö, och bara till ett nummer i listan.
    expect(phoneGate("production", e.allowlist, TESTER).redirectTo).toBeNull();
    expect(phoneGate(null, e.allowlist, TESTER)).toMatchObject({ restricted: true, environment: "unknown", redirectTo: null });
    expect(phoneGate("staging", ["+46704445566"], TESTER).redirectTo).toBeNull();
    expect(phoneGate("production", [], null).restricted).toBe(false);
  });

  it("beslutet för ett nummer: E.164, fel format, saknas, spärrlistan, personnummer i texten", () => {
    const prod = phoneGate("production", []);
    expect(phoneDecision("070-000 00 00", "Hej", prod)).toEqual({ action: "send", to: "+46700000000" });
    expect(phoneDecision("070", "Hej", prod)).toEqual({ action: "invalid", reason: REASON.badPhone });
    expect(phoneDecision("", "Hej", prod)).toEqual({ action: "suppressed", reason: REASON.noPhone });
    expect(phoneDecision("070-000 00 00", "Ditt nummer 19750818-8340", prod)).toEqual({ action: "suppressed", reason: REASON.personnummer });
    const stg = phoneGate("staging", [TESTER], TESTER);
    expect(phoneDecision("070-111 22 33", "Hej", stg)).toEqual({ action: "send", to: TESTER });
    expect(phoneDecision("070-000 00 00", "Hej", stg)).toEqual({ action: "redirect", to: TESTER, reason: REASON.redirected });
    expect(phoneDecision("070-000 00 00", "Hej", phoneGate("staging", [TESTER]))).toEqual({ action: "suppressed", reason: REASON.phoneNotAllowed });
    for (const r of Object.values(REASON)) expect(r).not.toMatch(/\d{3}|@/);
  });
});

// ================================================================ Anropen till 46elks
describe("46elks-anropen", () => {
  it("SMS: POST /a1/sms, basic auth, form-kodat from, to och message – id tillbaka", async () => {
    const elks = fakeElks();
    expect(await sendSmsVia46elks(elks.fetch, SMS, { to: PHONE, message: BODY })).toEqual({ id: "s1" });
    const [c] = elks.calls;
    expect(c.url).toBe(ELKS_SMS_ENDPOINT);
    expect(ELKS_SMS_ENDPOINT).toBe("https://api.46elks.com/a1/sms");
    expect(c.headers).toEqual({ Authorization: `Basic ${Buffer.from("u_test:hemligt-losenord").toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" });
    expect(c.form).toEqual({ from: "Miljonbem", to: PHONE, message: BODY });
  });

  it("samtal: POST /a1/calls med from (46elks-numret), to och voice_start = {\"play\": inspelningen}", async () => {
    const elks = fakeElks();
    expect(await placeCallVia46elks(elks.fetch, CALL, { to: PHONE })).toEqual({ id: "c1" });
    expect(elks.calls[0].url).toBe(ELKS_CALLS_ENDPOINT);
    expect(ELKS_CALLS_ENDPOINT).toBe("https://api.46elks.com/a1/calls");
    expect(elks.calls[0].form).toEqual({ from: "+46766860000", to: PHONE, voice_start: JSON.stringify({ play: CALL.audioUrl }) });
    expect(JSON.parse(elks.calls[0].form.voice_start)).toEqual({ play: "https://www.miljonmatch.se/ljud/kallelse.mp3" });
  });

  it("felorsakerna tvättas: inga nummer, ingen adress, inget eko av meddelandet", () => {
    expect(scrubElksError("Invalid 'to' number +46700000000. Must be E.164", BODY)).toBe("Invalid 'to' number [nummer]. Must be E.[nummer]");
    expect(scrubElksError("Not enough credits\nmore", "")).toBe("Not enough credits");
    expect(scrubElksError("Error for test@example.com", "")).toBe("Error for [adress]");
    expect(scrubElksError(`Message rejected: ${BODY}`, BODY)).toBe("okänd orsak");
    expect(scrubElksError("", "")).toBe("okänd orsak");
    expect(scrubElksError("x".repeat(500), "").length).toBeLessThanOrEqual(80);
  });
});

// ================================================================ Kön och sändningen
describe("SMS och samtal i kön och jobbet send_message", () => {
  it("utan variabler: SMS och samtal stoppas direkt (som förut) – inget jobb, inget anrop", async () => {
    const t = setup({ sms: null, call: null });
    const sms = await t.queue("sms");
    const call = await t.queue("call", CALL_RECORDING_TEXT);
    expect([sms.status, call.status, sms.jobId, call.jobId]).toEqual(["suppressed", "suppressed", null, null]);
    expect(t.msg(sms.messageId)).toMatchObject({ status: "suppressed", statusReason: "SMS-leverantör inte vald" });
    expect(t.msg(call.messageId)).toMatchObject({ status: "suppressed", statusReason: "Utringning inte kopplad" });
    // Standardvärdet (inga telefonkanaler angivna) är också stoppat.
    const legacy = await queueMessage(t.repo, { channel: "sms", to: PARTICIPANT_TO.sms, template: "kallelse", body: BODY, caseId: CASE.id }, NOW, newId);
    expect(legacy.status).toBe("suppressed");
    expect(t.elks.calls).toHaveLength(0);
  });

  it("kopplat (produktion): deltagarens nummer slås upp via ärendet och normaliseras – 46elks id sparas, mottagaren i loggen är bara en beskrivning", async () => {
    const t = setup();
    const q = await t.queue("sms");
    expect(q.status).toBe("queued");
    expect(await t.run()).toMatchObject({ done: 1, outcomes: { "send_message:sent": 1 } });
    expect(t.elks.calls).toHaveLength(1);
    expect(t.elks.calls[0].form).toEqual({ from: "Miljonbem", to: PHONE, message: BODY });
    expect(t.msg(q.messageId)).toMatchObject({ status: "sent", sentAt: NOW, providerMessageId: "s1", statusReason: null, to: "deltagare (SMS)" });
    const c = await t.queue("call", CALL_RECORDING_TEXT);
    await t.run();
    expect(t.elks.calls[1].form).toEqual({ from: "+46766860000", to: PHONE, voice_start: JSON.stringify({ play: CALL.audioUrl }) });
    expect(t.msg(c.messageId)).toMatchObject({ status: "sent", providerMessageId: "c1" });
    expectClean(t.store);
  });

  it("ogiltigt nummer: failed med orsak utan numret, inga nya försök; saknat nummer: stoppat", async () => {
    const bad = { ...PERSON, phone: "070-12" };
    const t = setup({ persons: [bad] });
    const q = await t.queue("sms");
    expect(await t.run()).toMatchObject({ failed: 1, retried: 0 });
    expect(t.msg(q.messageId)).toMatchObject({ status: "failed", statusReason: "Telefonnumret har fel format" });
    expect(t.elks.calls).toHaveLength(0);
    const none = setup({ persons: [{ ...PERSON, phone: "" }] });
    const q2 = await none.queue("sms");
    await none.run();
    expect(none.msg(q2.messageId)).toMatchObject({ status: "suppressed", statusReason: "Mottagaren saknar telefonnummer" });
    expectClean(t.store);
  });

  it("testmiljön: bara numren i MM_SMS_ALLOWLIST; med MM_SMS_REDIRECT_TO går SMS:et till testaren med en rad om vem det var till", async () => {
    const blocked = setup({ env: "staging", allow: [TESTER] });
    const q = await blocked.queue("sms");
    await blocked.run();
    expect(blocked.msg(q.messageId)).toMatchObject({ status: "suppressed", statusReason: "Testmiljön: numret finns inte i MM_SMS_ALLOWLIST" });
    expect(blocked.elks.calls).toHaveLength(0);

    const t = setup({ env: "staging", allow: [TESTER], redirect: TESTER });
    const r = await t.queue("sms");
    const c = await t.queue("call", CALL_RECORDING_TEXT);
    await t.run();
    expect(t.elks.calls.map((x) => x.form.to)).toEqual([TESTER, TESTER]);
    expect(t.elks.calls[0].form.message).toBe(`${SMS_TEST_PREFIX}Skulle ha gått till deltagaren i ärende ${CASE.caseNumber}. ${BODY}`);
    expect(t.msg(r.messageId)).toMatchObject({ status: "sent", statusReason: "redirected" });
    expect(t.msg(c.messageId)).toMatchObject({ status: "sent", statusReason: "redirected" });
    // Deltagarens nummer och namn står aldrig i SMS:et till testaren.
    expect(t.elks.calls[0].form.message).not.toContain(PERSON.firstName);
    expect(JSON.stringify(t.elks.calls)).not.toContain(PHONE);
  });

  it("46elks avvisar (400): failed direkt med tvättad orsak; 503 och nätverksfel: nya försök, sedan sent", async () => {
    const t = setup({ fail: [{ status: 400, text: `Invalid to number ${PHONE}: ${BODY}` }] });
    const q = await t.queue("sms");
    expect(await t.run()).toMatchObject({ failed: 1 });
    expect(t.msg(q.messageId)).toMatchObject({ status: "failed", statusReason: "46elks svarade 400 (okänd orsak)", providerMessageId: null });
    expectClean(t.store);

    const r = setup({ fail: [{ status: 503 }], throwError: { name: "TypeError", times: 1 } });
    const q2 = await r.queue("sms");
    expect(await r.run()).toMatchObject({ retried: 1 });
    expect(r.msg(q2.messageId)).toMatchObject({ status: "queued", providerMessageId: null });
    expect(r.store.rows("jobs")[0].lastError).toBe("46elks kunde inte nås (nätverksfel)");
    expect(await r.run("2027-02-01T09:13")).toMatchObject({ retried: 1 });
    expect(r.store.rows("jobs")[0].lastError).toBe("46elks svarade 503 (Error)");
    expect(await r.run("2027-02-01T09:18")).toMatchObject({ done: 1 });
    expect(r.msg(q2.messageId)).toMatchObject({ status: "sent", providerMessageId: "s1" });
    expect(r.elks.calls).toHaveLength(3);
  });

  it("fel inloggning (401): failed med orsak som pekar på variablerna – aldrig värdena", async () => {
    const t = setup({ fail: [{ status: 401, text: "Unauthorized u_test" }] });
    const q = await t.queue("sms");
    await t.run();
    expect(t.msg(q.messageId).statusReason).toBe("46elks nekade inloggningen (401) – kontrollera ELKS_API_USERNAME och ELKS_API_PASSWORD");
  });

  it("tidsgränsen (svaret kom aldrig): inget nytt försök – samma SMS skickas aldrig två gånger", async () => {
    const t = setup({ throwError: { name: "TimeoutError", times: 1 } });
    const q = await t.queue("sms");
    expect(await t.run()).toMatchObject({ failed: 1, retried: 0 });
    expect(t.msg(q.messageId)).toMatchObject({ status: "failed", providerMessageId: null });
    expect(t.msg(q.messageId).statusReason).toBe("46elks svarade inte i tid – kontrollera i 46elks om SMS:et gick iväg");
    expect(t.elks.calls).toHaveLength(1);
  });

  it("ett försök som avbröts efter anropet (markeringen står kvar): skickas inte igen", async () => {
    const t = setup();
    const q = await t.queue("sms");
    t.store.updateRow("outbound_messages", q.messageId, { providerMessageId: PENDING_PROVIDER_ID });
    expect(await t.run()).toMatchObject({ failed: 1 });
    expect(t.msg(q.messageId)).toMatchObject({ status: "failed", statusReason: REASON.uncertain, providerMessageId: null });
    expect(t.elks.calls).toHaveLength(0);
  });

  it("vilande spärr: skyddade personuppgifter får inget SMS, samtal eller mejl", async () => {
    const t = setup({ persons: [{ ...PERSON, protectedIdentity: true }] });
    const ids = [(await t.queue("sms")).messageId, (await t.queue("call", CALL_RECORDING_TEXT)).messageId];
    const mail = await queueMessage(t.repo, { channel: "email", to: PARTICIPANT_TO.email, template: "aktivitetsinbjudan", body: BODY, caseId: CASE.id }, NOW, newId);
    await t.run();
    for (const id of [...ids, mail.messageId]) expect(t.msg(id)).toMatchObject({ status: "suppressed", statusReason: REASON.protectedIdentity });
    expect(t.elks.calls).toHaveLength(0);
    expect(t.resend.calls).toHaveLength(0);
  });
});

describe("e-post till deltagaren", () => {
  it("adressen slås upp via ärendet (utskicksloggen har bara \"deltagare (e-post)\") – utan knapp och utan ärendenummer", async () => {
    const t = setup();
    const q = await queueMessage(t.repo, { channel: "email", to: PARTICIPANT_TO.email, template: "aktivitetsinbjudan", body: BODY, caseId: CASE.id }, NOW, newId);
    expect(t.msg(q.messageId)).toMatchObject({ subject: "Inbjudan till aktivitet hos Miljonbemanning", to: "deltagare (e-post)" });
    expect(await deliverMessage(t.deps, q.messageId)).toBe("sent");
    expect(t.resend.calls).toHaveLength(1);
    expect(t.resend.calls[0].body.to).toEqual([PERSON.email]);
    expect(t.resend.calls[0].body.text).toContain(BODY);
    expect(t.resend.calls[0].body.text).not.toContain("Logga in");
    expect(t.resend.calls[0].body.text).not.toContain(CASE.caseNumber);
    expect(t.msg(q.messageId)).toMatchObject({ status: "sent", to: "deltagare (e-post)" });
  });

  it("deltagaren saknar e-post: stoppat med orsak", async () => {
    const t = setup({ persons: [{ ...PERSON, email: "" }] });
    const q = await queueMessage(t.repo, { channel: "email", to: PARTICIPANT_TO.email, template: "kallelse", body: BODY, caseId: CASE.id }, NOW, newId);
    expect(await deliverMessage(t.deps, q.messageId)).toBe("suppressed");
    expect(t.msg(q.messageId)).toMatchObject({ status: "suppressed", statusReason: REASON.noAddress });
  });
});
