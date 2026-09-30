// Utskick: spärrlistan i testmiljön, statusar, idempotens, mallen och att texten aldrig innehåller personnummer.
// Resend fejkas (test-helpers.ts) – inga riktiga mejl skickas.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { addMinutes } from "@/core/time";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock } from "@/data/memory-runtime";
import type { Case } from "@/data/schema";
import { createSeed, DEMO_START, decodeTestPnr, normalizePnr } from "@/data/seed";
import { caseAccept, caseChangeCoach, caseCreate, caseDecline, messageSend } from "@/features/arenden/api";
import { runJobs } from "../jobs/runner";
import { JOB_HANDLERS, type JobDeps } from "../jobs/registry";
import { notifyEnv } from "./config";
import { channelDecision, deliveryDecision, emailDecision, REASON, recipientGate, type RecipientGate } from "./decision";
import { containsPersonnummer } from "./personnummer";
import { queueMessage } from "./queue";
import { escapeHtml, FOOTER_LINES, loginLink, renderEmail, TEST_SUBJECT_PREFIX } from "./render";
import { RESEND_ENDPOINT, sendViaResend } from "./resend";
import { deliverMessage, sendMessageJob, type SenderDeps } from "./sender";
import { FALLBACK_SUBJECT, GENERIC_PORTAL_BODY, subjectFor } from "./templates";
import { fakeResend, memoryJobStore, memoryNotifyRepo } from "./test-helpers";
import { JobError } from "../jobs/errors";
import type { OutboundRow } from "./types";

const NOW = "2027-02-01T09:12";
const KARIM = "karim.khalil@miljonbemanning.se";
const ALI = "ali.khalil@miljonbemanning.se";
const MARIA = "maria.ekdahl@botkyrka.se";
const ALLOW = [KARIM, ALI];
const STAGING = recipientGate("staging", ALLOW);
const PRODUCTION = recipientGate("production", []);
const RESEND = { apiKey: "re_test_nyckel", from: "Miljonmatch <notis@miljonbemanning.se>" };
const APP = "https://test.miljonmatch.se";

const SEED = createSeed();
const CASE = SEED.cases.find((c) => c.id === "case-270048")! as Case;
let seq = 0;
const newId = (p: string) => `${p}-${++seq}`;

function setup(o: { gate?: RecipientGate; resend?: typeof RESEND | null; fail?: { status: number; name?: string; message?: string }[]; throwNetwork?: number } = {}) {
  const { repo, store } = memoryNotifyRepo(SEED.cases);
  const resend = fakeResend({ fail: o.fail, throwNetwork: o.throwNetwork });
  const deps: SenderDeps = {
    repo,
    gate: o.gate ?? STAGING,
    render: { appUrl: APP, staffDomains: ["miljonbemanning.se"] },
    resend: o.resend === undefined ? RESEND : o.resend,
    fetch: resend.fetch,
    now: NOW,
  };
  const jobs = memoryJobStore(store);
  const run = (now = NOW, limit = 20) => runJobs<JobDeps>({ store: jobs, handlers: JOB_HANDLERS, ctx: { notify: { ...deps, now } }, now, limit });
  return { repo, store, resend, deps, jobs, run };
}

const email = (to: string, extra: Partial<{ template: string; body: string; caseId: string | null; subject: string }> = {}) => ({
  channel: "email" as const,
  to,
  template: extra.template ?? "ordererkannande",
  body: extra.body ?? `Tack! Vi har tagit emot er beställning och gett den ärendenummer ${CASE.caseNumber}.`,
  caseId: extra.caseId === undefined ? CASE.id : extra.caseId,
  ...(extra.subject ? { subject: extra.subject } : {}),
});

// ================================================================ Spärren för mottagare
describe("spärrlistan (MM_EMAIL_ALLOWLIST)", () => {
  it("testmiljön och okänd miljö spärrar, produktion med tom lista spärrar inte", () => {
    expect(recipientGate("staging", ALLOW)).toMatchObject({ restricted: true, environment: "staging" });
    expect(recipientGate("staging", [])).toMatchObject({ restricted: true });
    expect(recipientGate(null, [])).toMatchObject({ restricted: true, environment: "unknown" });
    expect(recipientGate("prod", [])).toMatchObject({ restricted: true, environment: "unknown" });
    expect(recipientGate("production", [])).toMatchObject({ restricted: false, environment: "production" });
    expect(recipientGate("production", ["@miljonbemanning.se"])).toMatchObject({ restricted: true });
  });

  it("bara adresser i listan får mejl i testmiljön – även med stora bokstäver och mellanslag", () => {
    expect(emailDecision({ to: KARIM, subject: null, body: "Hej" }, STAGING)).toEqual({ action: "send" });
    expect(emailDecision({ to: "  Karim.Khalil@Miljonbemanning.se ", subject: null, body: "Hej" }, STAGING)).toEqual({ action: "send" });
    expect(emailDecision({ to: MARIA, subject: null, body: "Hej" }, STAGING)).toEqual({ action: "suppressed", reason: REASON.notAllowed });
    expect(emailDecision({ to: "sara.lindqvist@miljonbemanning.se", subject: null, body: "Hej" }, STAGING)).toEqual({ action: "suppressed", reason: REASON.notAllowed });
    // Tom lista i testmiljön: ingen får mejl
    expect(emailDecision({ to: KARIM, subject: null, body: "Hej" }, recipientGate("staging", []))).toMatchObject({ action: "suppressed" });
    // Domänpost
    expect(emailDecision({ to: "vem.som.helst@miljonbemanning.se", subject: null, body: "Hej" }, recipientGate("staging", ["@miljonbemanning.se"]))).toEqual({ action: "send" });
    expect(emailDecision({ to: "x@botkyrka.se", subject: null, body: "Hej" }, recipientGate("staging", ["@miljonbemanning.se"]))).toMatchObject({ action: "suppressed" });
    // Produktion: alla giltiga adresser
    expect(emailDecision({ to: MARIA, subject: null, body: "Hej" }, PRODUCTION)).toEqual({ action: "send" });
  });

  it("saknad eller ogiltig adress stoppas (även i produktion), och orsaken innehåller aldrig adressen", () => {
    for (const to of ["", "kommunens chef", "deltagare (e-post)", "a@b"]) {
      expect(emailDecision({ to, subject: null, body: "Hej" }, PRODUCTION)).toEqual({ action: "suppressed", reason: REASON.noAddress });
    }
    for (const r of Object.values(REASON)) expect(r).not.toMatch(/@/);
  });

  it("SMS stoppas (ingen leverantör), brev skickas för hand", () => {
    expect(channelDecision("sms")).toEqual({ action: "suppressed", reason: "SMS-leverantör inte vald" });
    expect(channelDecision("brev")).toEqual({ action: "manual", reason: "Brev skickas manuellt" });
    expect(channelDecision("email")).toBeNull();
    expect(deliveryDecision({ channel: "sms", to: KARIM, subject: null, body: "Hej" }, PRODUCTION)).toMatchObject({ action: "suppressed" });
  });

  it("MM_EMAIL_ALLOWLIST och övriga variabler läses som i docs/UTSKICK.md", () => {
    const env = notifyEnv({ RESEND_API_KEY: " re_x ", MM_EMAIL_FROM: "Miljonmatch <notis@miljonbemanning.se>", MM_APP_URL: "https://test.miljonmatch.se/", MM_EMAIL_ALLOWLIST: `${KARIM}, ${ALI.toUpperCase()};@exempel.se` });
    expect(env).toEqual({ resend: { apiKey: "re_x", from: "Miljonmatch <notis@miljonbemanning.se>" }, appUrl: APP, allowlist: [KARIM, ALI, "@exempel.se"], staffDomains: ["miljonbemanning.se"] });
    expect(notifyEnv({ RESEND_API_KEY: "re_x" }).resend).toBeNull();
    expect(notifyEnv({}).allowlist).toEqual([]);
  });
});

// ================================================================ Kön
describe("queueMessage", () => {
  it("e-post: status queued, ämnesrad med ärendenumret och ett jobb send_message", async () => {
    const { repo, store } = setup();
    const r = await queueMessage(repo, email(MARIA), NOW, newId);
    expect(r.status).toBe("queued");
    const row = store.getRow("outbound_messages", r.messageId)!;
    expect(row).toMatchObject({ channel: "email", to: MARIA, template: "ordererkannande", status: "queued", subject: `Vi har tagit emot er beställning – ${CASE.caseNumber}`, caseId: CASE.id, createdAt: NOW, sentAt: null, statusReason: null });
    expect(store.getRow("jobs", r.jobId!)).toMatchObject({ kind: "send_message", payload: { messageId: r.messageId }, status: "queued", attempts: 0, runAfter: NOW });
  });

  it("SMS och brev får slutstatus direkt och inget jobb", async () => {
    const { repo, store } = setup();
    const sms = await queueMessage(repo, { channel: "sms", to: "deltagare (SMS)", template: "kallelse", body: "Välkommen!", caseId: CASE.id }, NOW, newId);
    const brev = await queueMessage(repo, { channel: "brev", to: "deltagare (brev)", template: "kallelse", body: "Välkommen!", caseId: CASE.id }, NOW, newId);
    const letter = await queueMessage(repo, { channel: "letter", to: "deltagare (brev)", template: "kallelse", body: "Välkommen!", caseId: CASE.id }, NOW, newId);
    expect([sms.status, brev.status, letter.status]).toEqual(["suppressed", "manual", "manual"]);
    expect([sms.jobId, brev.jobId, letter.jobId]).toEqual([null, null, null]);
    expect(store.getRow("outbound_messages", sms.messageId)).toMatchObject({ channel: "sms", status: "suppressed", statusReason: "SMS-leverantör inte vald", subject: null });
    expect(store.getRow("outbound_messages", letter.messageId)).toMatchObject({ channel: "brev", status: "manual" });
    expect(store.rows("jobs")).toHaveLength(0);
  });

  it("ämnesrader från mallkatalogen (samma som prototypens adminvy)", () => {
    expect(subjectFor("ordererkannande", "x", "BOT-27-0048")).toBe("Vi har tagit emot er beställning – BOT-27-0048");
    expect(subjectFor("ordererkannande", "x", null)).toBe(FALLBACK_SUBJECT);
    expect(subjectFor("ny_rapport", "x", null)).toBe("Ny rapport i portalen");
    expect(subjectFor("nytt_meddelande", "x", "BOT-26-0143")).toBe("Nytt meddelande om BOT-26-0143");
    expect(subjectFor("generisk_mottagningsbekraftelse", GENERIC_PORTAL_BODY, null)).toBe("Vi har tagit emot er beställning");
    expect(subjectFor("generisk_mottagningsbekraftelse", "Tack för ditt mejl. Vi har tagit emot det och ringer dig i dag.", null)).toBe("Vi har tagit emot ditt mejl");
    expect(subjectFor("okand_mall", "x", "BOT-27-0048")).toBe(FALLBACK_SUBJECT);
  });
});

// ================================================================ Sändning
describe("send_message: statusar", () => {
  it("mottagare i listan → sent, ett anrop till Resend med rätt nyckel, avsändare, Idempotency-Key och testmärkning", async () => {
    const { repo, store, resend, run } = setup();
    const q = await queueMessage(repo, email(KARIM), NOW, newId);
    const sum = await run();
    expect(sum).toMatchObject({ claimed: 1, done: 1, retried: 0, failed: 0, outcomes: { "send_message:sent": 1 } });
    expect(resend.calls).toHaveLength(1);
    const c = resend.calls[0];
    expect(c.url).toBe(RESEND_ENDPOINT);
    expect(c.headers).toMatchObject({ Authorization: "Bearer re_test_nyckel", "Content-Type": "application/json", "Idempotency-Key": q.messageId });
    expect(c.body).toMatchObject({ from: RESEND.from, to: [KARIM], subject: `${TEST_SUBJECT_PREFIX}Vi har tagit emot er beställning – ${CASE.caseNumber}`, tags: [{ name: "template", value: "ordererkannande" }] });
    expect(c.body.text).toContain(`gett den ärendenummer ${CASE.caseNumber}`);
    expect(c.body.text).toContain(`Logga in i Miljonmatch: ${APP}/`);
    expect(c.body.html).toContain(`href="${APP}/"`);
    expect(store.getRow("outbound_messages", q.messageId)).toMatchObject({ status: "sent", sentAt: NOW, providerMessageId: "re-1", statusReason: null });
    expect(store.getRow("jobs", q.jobId!)).toMatchObject({ status: "done", attempts: 1, lastError: null, finishedAt: NOW });
  });

  it("testdatats adresser (botkyrka.se) → suppressed med orsak, Resend anropas aldrig", async () => {
    const { repo, store, resend, run } = setup();
    const q = await queueMessage(repo, email(MARIA), NOW, newId);
    expect(await run()).toMatchObject({ done: 1, outcomes: { "send_message:suppressed": 1 } });
    expect(resend.calls).toHaveLength(0);
    expect(store.getRow("outbound_messages", q.messageId)).toMatchObject({ status: "suppressed", statusReason: REASON.notAllowed, sentAt: null });
    expect(store.getRow("jobs", q.jobId!)).toMatchObject({ status: "done" });
  });

  it("produktion (uttrycklig miljörad, tom lista) skickar till alla – utan testmärkning", async () => {
    const { repo, resend, run } = setup({ gate: PRODUCTION });
    await queueMessage(repo, email(MARIA), NOW, newId);
    await run();
    expect(resend.calls.map((c) => c.body.to)).toEqual([[MARIA]]);
    expect(resend.calls[0].body.subject).toBe(`Vi har tagit emot er beställning – ${CASE.caseNumber}`);
    expect(resend.calls[0].body.text).toContain(`Logga in i portalen: ${APP}/portal`);
    expect(resend.calls[0].body.html).not.toContain("TESTMILJÖ");
  });

  it("jobbet körs inte före run_after", async () => {
    const { repo, resend, run } = setup();
    await queueMessage(repo, email(KARIM), "2027-02-01T09:30", newId);
    expect(await run("2027-02-01T09:29")).toMatchObject({ claimed: 0 });
    expect(await run("2027-02-01T09:30")).toMatchObject({ claimed: 1, done: 1 });
    expect(resend.delivered.size).toBe(1);
  });

  it("utan RESEND_API_KEY/MM_EMAIL_FROM: försöks igen senare, utskicket står kvar i kön", async () => {
    const { repo, store, resend, run } = setup({ resend: null });
    const q = await queueMessage(repo, email(KARIM), NOW, newId);
    expect(await run()).toMatchObject({ retried: 1 });
    expect(resend.calls).toHaveLength(0);
    expect(store.getRow("outbound_messages", q.messageId)!.status).toBe("queued");
    expect(store.getRow("jobs", q.jobId!)).toMatchObject({ status: "queued", runAfter: addMinutes(NOW, 1), lastError: "E-post är inte konfigurerad (RESEND_API_KEY eller MM_EMAIL_FROM saknas)" });
  });

  it("503 från Resend: nya försök med väntetid, efter fem försök failed – felorsaken utan Resends feltext", async () => {
    const fail = Array.from({ length: 5 }, () => ({ status: 503, name: "service_unavailable", message: `kunde inte skicka till ${KARIM}` }));
    const { repo, store, resend, run } = setup({ fail });
    const q = await queueMessage(repo, email(KARIM), NOW, newId);
    let t = NOW;
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      const sum = await run(t);
      expect(sum.claimed).toBe(1);
      const j = store.getRow("jobs", q.jobId!)!;
      if (i < 4) {
        expect(j).toMatchObject({ status: "queued", attempts: i + 1, lastError: "Resend svarade 503 (service_unavailable)" });
        waits.push((Date.parse(`${j.runAfter}:00Z`) - Date.parse(`${t}:00Z`)) / 60_000);
        t = j.runAfter;
      } else {
        expect(j).toMatchObject({ status: "failed", attempts: 5, finishedAt: t });
      }
      expect(j.lastError).not.toContain("@");
    }
    expect(waits).toEqual([1, 5, 15, 60]);
    expect(resend.calls).toHaveLength(5);
    expect(new Set(resend.calls.map((c) => c.headers["Idempotency-Key"]))).toEqual(new Set([q.messageId]));
    expect(store.getRow("outbound_messages", q.messageId)).toMatchObject({ status: "failed", statusReason: "Resend svarade 503 (service_unavailable)" });
    // Ett sjätte försök görs aldrig
    expect(await run(addMinutes(t, 120))).toMatchObject({ claimed: 0 });
  });

  it("422 från Resend (avvisat): failed direkt, inga nya försök", async () => {
    const { repo, store, resend, run } = setup({ fail: [{ status: 422, name: "validation_error" }] });
    const q = await queueMessage(repo, email(KARIM), NOW, newId);
    expect(await run()).toMatchObject({ failed: 1, retried: 0 });
    expect(resend.calls).toHaveLength(1);
    expect(store.getRow("jobs", q.jobId!)).toMatchObject({ status: "failed", attempts: 1, lastError: "Resend svarade 422 (validation_error)" });
    expect(store.getRow("outbound_messages", q.messageId)).toMatchObject({ status: "failed", statusReason: "Resend svarade 422 (validation_error)" });
  });

  it("nätverksfel: nytt försök, sedan sent", async () => {
    const { repo, store, resend, run } = setup({ throwNetwork: 1 });
    const q = await queueMessage(repo, email(KARIM), NOW, newId);
    expect(await run()).toMatchObject({ retried: 1 });
    expect(store.getRow("jobs", q.jobId!)!.lastError).toBe("Resend kunde inte nås (nätverksfel eller tidsgräns)");
    expect(await run(addMinutes(NOW, 1))).toMatchObject({ done: 1 });
    expect(store.getRow("outbound_messages", q.messageId)!.status).toBe("sent");
    expect(resend.delivered.size).toBe(1);
  });

  it("okänd jobbtyp → failed", async () => {
    const { store, run } = setup();
    store.insertRow("jobs", { id: "job-x", kind: "okand", payload: {}, status: "queued", attempts: 0, runAfter: NOW, lastError: null, createdAt: NOW, createdBy: null, finishedAt: null });
    expect(await run()).toMatchObject({ failed: 1 });
    expect(store.getRow("jobs", "job-x")).toMatchObject({ status: "failed", lastError: "Okänd jobbtyp" });
  });
});

describe("send_message: idempotens", () => {
  it("samma jobb två gånger skickar ett mejl", async () => {
    const { repo, store, resend, deps } = setup();
    const q = await queueMessage(repo, email(KARIM), NOW, newId);
    const job = store.getRow("jobs", q.jobId!)!;
    expect(await sendMessageJob.run(job, deps)).toBe("sent");
    expect(await sendMessageJob.run(job, deps)).toBe("skipped");
    expect(resend.calls).toHaveLength(1);
    expect(resend.delivered.size).toBe(1);
  });

  it("jobbet körs igen efter att statusen inte hann sparas: samma Idempotency-Key, Resend levererar ett mejl", async () => {
    const { repo, store, resend, deps } = setup();
    const q = await queueMessage(repo, email(KARIM), NOW, newId);
    // Databasen fallerar när "sent" ska sparas första gången (t.ex. avbruten körning)
    let broken = true;
    const flaky = {
      table: ((name: "outbound_messages") => {
        const t = repo.table(name);
        return {
          ...t,
          update: async (id: string, patch: Partial<OutboundRow>) => {
            if (broken && patch.status === "sent") {
              broken = false;
              throw new Error("anslutningen bröts");
            }
            return t.update(id, patch);
          },
        };
      }) as typeof repo.table,
    };
    const job = store.getRow("jobs", q.jobId!)!;
    await expect(sendMessageJob.run(job, { ...deps, repo: flaky })).rejects.toThrow();
    expect(store.getRow("outbound_messages", q.messageId)!.status).toBe("queued");
    expect(await sendMessageJob.run(job, { ...deps, repo: flaky })).toBe("sent");
    expect(resend.calls).toHaveLength(2);
    expect(resend.calls.map((c) => c.headers["Idempotency-Key"])).toEqual([q.messageId, q.messageId]);
    expect(resend.delivered.size).toBe(1);
  });

  it("två köer med samma jobb (parallella körningar) tar aldrig samma jobb", async () => {
    const { repo, jobs, resend, deps } = setup();
    for (let i = 0; i < 3; i++) await queueMessage(repo, email(KARIM), NOW, newId);
    const a = await jobs.claim(2, NOW, 5);
    const b = await jobs.claim(2, NOW, 5);
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(1);
    expect(new Set([...a, ...b].map((j) => j.id)).size).toBe(3);
    for (const j of [...a, ...b]) await sendMessageJob.run(j, deps);
    expect(resend.delivered.size).toBe(3);
  });

  it("utskick som redan är stoppat eller manuellt skickas aldrig", async () => {
    const { repo, store, resend, deps } = setup();
    const q = await queueMessage(repo, email(KARIM), NOW, newId);
    store.updateRow("outbound_messages", q.messageId, { status: "suppressed" });
    expect(await deliverMessage(deps, q.messageId)).toBe("skipped");
    expect(await deliverMessage(deps, "out-finns-inte")).toBe("missing");
    expect(resend.calls).toHaveLength(0);
  });
});

// ================================================================ Personnummer
describe("personnummer i utskick", () => {
  const seedPnrs = SEED.persons.map((p) => decodeTestPnr(p.personnummerEnc)).filter(Boolean);

  it("känner igen personnummer i alla format, men inte ärendenummer, telefonnummer, datum eller referenser", () => {
    // Ett tiosiffrigt nummer som ser ut som ett datum (t.ex. beställarreferensen 4410023817) stoppas också – hellre ett
    // stoppat utskick (syns med orsak i utskicksloggen) än ett personnummer i ett mejl.
    expect(containsPersonnummer("Referens 4410023817")).toBe(true);
    for (const s of ["19750818-8340", "750818-8340", "750818+8340", "7508188340", "197508188340", "Pnr: 19900101-1234.", "750878-8340", "19750818 8340"]) {
      expect(containsPersonnummer(`Text ${s} text`), s).toBe(true);
    }
    for (const s of [
      "BOT-27-0048", "BOT-26-0143", "08-000 00 00", "070-000 00 00", "2027-02-01T09:12", "måndag 1 februari 2027 klockan 10.05",
      "vecka 4", "Beställarreferens (8–10 siffror)", "1234567890", "991234567", "12345678", "123456-7890",
    ]) {
      expect(containsPersonnummer(`Text ${s} text`), s).toBe(false);
    }
  });

  it("fångar alla testdatats personnummer", () => {
    expect(seedPnrs.length).toBeGreaterThan(200);
    for (const p of seedPnrs) {
      expect(containsPersonnummer(p), p).toBe(true);
      expect(containsPersonnummer(normalizePnr(p)), p).toBe(true);
    }
  });

  it("ett utskick med personnummer i texten eller ämnesraden stoppas och skickas aldrig – även i produktion", async () => {
    const { repo, store, resend, run } = setup({ gate: PRODUCTION });
    const a = await queueMessage(repo, email(MARIA, { body: `Deltagaren ${seedPnrs[0]} har börjat.` }), NOW, newId);
    const b = await queueMessage(repo, email(MARIA, { subject: `Ärende ${normalizePnr(seedPnrs[1])}` }), NOW, newId);
    await run();
    expect(resend.calls).toHaveLength(0);
    for (const q of [a, b]) expect(store.getRow("outbound_messages", q.messageId)).toMatchObject({ status: "suppressed", statusReason: REASON.personnummer });
  });

  it("hanterarnas riktiga utskick (testdata + kommandon) blir mejl utan personnummer och utan deltagarnas namn", async () => {
    // Kör kommandon som skickar utskick genom samma execute() som appen, mot testdatat i minnet.
    const rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
    const as = (userId: string, role: Role): Actor => listPersonas(rt.raw()).find((x) => x.actor.userId === userId && x.actor.role === role)!.actor;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cmd = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
    const order = { firstName: "Testa", lastName: "Testsson", pnr: "19900101-1234", phone: "070-000 00 00", city: "Tumba", preferredContact: "email" as const,
      email: "testa@exempel.se", buyerReference: "4410023817", primaryArea: "G", desiredStart: "2027-02-08", plannedWeeks: 6, source: "portal" as const };
    expect(await cmd(caseCreate, order, as("k-maria", "kommun_handlaggare"))).toMatchObject({ ok: true });
    expect(await cmd(caseCreate, { ...order, pnr: "19900303-3456", protectedIdentity: true }, as("k-maria", "kommun_handlaggare"))).toMatchObject({ ok: true });
    expect(await cmd(caseAccept, { caseId: "case-270050", leadCoachId: "u-amira", firstMeetingAt: "2027-02-03T10:00", plannedWeeks: 6 }, as("u-sara", "samordnare"))).toMatchObject({ ok: true });
    expect(await cmd(caseDecline, { caseId: "case-270048", reason: "Vi har inte kapacitet under önskad period" }, as("u-sara", "samordnare"))).toMatchObject({ ok: true });
    expect(await cmd(messageSend, { caseId: "case-260143", body: "Hej! Hur går praktiken?" }, as("k-maria", "kommun_handlaggare"))).toMatchObject({ ok: true });
    expect(await cmd(messageSend, { caseId: "case-260143", body: "Bra, tack!" }, as("u-amira", "coach"))).toMatchObject({ ok: true });
    expect(await cmd(caseChangeCoach, { caseId: "case-260143", toCoachId: "u-erik", reason: "Föräldraledighet från vecka 8." }, as("u-sara", "samordnare"))).toMatchObject({ ok: true });

    const all = rt.store.rows("outbound_messages");
    const templates = new Set(all.filter((m) => m.channel === "email").map((m) => m.template));
    for (const t of ["ordererkannande", "generisk_mottagningsbekraftelse", "orderbekraftelse", "tilldelning_coach", "avbojt", "coachbyte", "nytt_meddelande", "ny_rapport"]) {
      expect(templates.has(t), t).toBe(true);
    }

    // Samma utskick genom kön och sändaren – produktion (alla adresser tillåtna), så att varje mejl renderas och skickas.
    const { repo, store, resend, run } = setup({ gate: PRODUCTION });
    for (const c of rt.store.rows("cases")) if (!store.getRow("cases", c.id)) store.insertRow("cases", structuredClone(c));
    for (const m of all) await queueMessage(repo, { channel: m.channel, to: m.to, template: m.template, body: m.body, caseId: m.caseId }, NOW, newId);
    await run(NOW, 200);
    const sendable = all.filter((m) => m.channel === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.to));
    expect(sendable.length).toBeGreaterThan(10);
    expect(resend.calls).toHaveLength(sendable.length);

    const persons = rt.store.rows("persons");
    const pnrDigits = persons.map((p) => normalizePnr(decodeTestPnr(p.personnummerEnc))).filter(Boolean);
    const names = persons.flatMap((p) => [p.firstName, p.lastName]).filter((x) => x && x.length >= 4);
    for (const c of resend.calls) {
      const { subject, html, text } = c.body;
      for (const part of [subject, html, text]) expect(containsPersonnummer(part), `${c.body.tags[0].value}`).toBe(false);
      const digits = `${subject} ${text}`.replace(/\D/g, "");
      for (const d of pnrDigits) expect(digits.includes(d)).toBe(false);
      for (const n of names) expect(new RegExp(`(^|[^\\p{L}])${n}([^\\p{L}]|$)`, "u").test(`${subject}\n${text}`), `namnet ${n} i ${c.body.tags[0].value}`).toBe(false);
    }
  });
});

// ================================================================ Mallen
describe("mallen (render.ts)", () => {
  const row = { template: "ny_rapport", to: MARIA, subject: "Ny rapport i portalen", body: "Veckorapporten för vecka 4 finns i portalen – logga in för att läsa." };

  it("ram i MB:s profil: ordmärke, rubrik i versaler, texten, knapp till portalen och fot – bara MB:s färger", () => {
    const m = renderEmail(row, { appUrl: APP, staffDomains: ["miljonbemanning.se"], testEnvironment: false });
    expect(m.subject).toBe("Ny rapport i portalen");
    expect(m.html).toContain("MILJONMATCH");
    expect(m.html).toContain("NY RAPPORT I PORTALEN</h1>");
    expect(m.html).toContain("Veckorapporten för vecka 4 finns i portalen – logga in för att läsa.");
    expect(m.html).toContain(`href="${APP}/portal"`);
    expect(m.html).toContain("Logga in i portalen");
    for (const l of FOOTER_LINES) expect(m.html).toContain(escapeHtml(l));
    expect(m.html).toContain('lang="sv"');
    const colors = new Set([...m.html.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((x) => x[0].toUpperCase()));
    for (const c of colors) expect(["#1E252B", "#FF0C01", "#D1D3D3", "#6BA2B9", "#FFFFFF"]).toContain(c);
    expect(m.html).not.toMatch(/<img|<script|https?:\/\/(?!test\.miljonmatch\.se)/);
    expect(m.text).toBe(
      ["Veckorapporten för vecka 4 finns i portalen – logga in för att läsa.", "", `Logga in i portalen: ${APP}/portal`, "", "--", ...FOOTER_LINES].join("\n"),
    );
  });

  it("testmiljön märks i ämnesraden, överst i HTML och i texten", () => {
    const m = renderEmail(row, { appUrl: APP, staffDomains: [], testEnvironment: true });
    expect(m.subject).toBe("[Testmiljö] Ny rapport i portalen");
    expect(m.html).toContain("TESTMILJÖ – påhittade testdata");
    expect(m.text.startsWith("TESTMILJÖ – påhittade testdata")).toBe(true);
  });

  it("ärendenumret bryts inte över två rader", () => {
    const m = renderEmail({ ...row, body: "Ärende BOT-27-0049 har fått ny huvudcoach." }, { appUrl: APP, staffDomains: [], testEnvironment: false });
    expect(m.html).toContain('Ärende <span style="white-space:nowrap;">BOT-27-0049</span> har fått ny huvudcoach.');
    expect(m.text).toContain("Ärende BOT-27-0049 har fått ny huvudcoach.");
  });

  it("texten escapas och styckena behålls", () => {
    const m = renderEmail({ ...row, body: 'Rad 1 <b>&"\nRad 2\n\nNytt stycke' }, { appUrl: APP, staffDomains: [], testEnvironment: false });
    expect(m.html).toContain("<p style=\"margin:0 0 16px 0;\">Rad 1 &lt;b&gt;&amp;&quot;<br>Rad 2</p>");
    expect(m.html).toContain(">Nytt stycke</p>");
    expect(m.html).not.toContain("<b>");
  });

  it("länken: personalen till appen, kommunen till portalen, deltagaren ingen länk, utan MM_APP_URL ingen länk", () => {
    const cfg = { appUrl: `${APP}/`, staffDomains: ["miljonbemanning.se"] };
    expect(loginLink({ template: "tilldelning_coach", to: "amira.haddad@miljonbemanning.se" }, cfg)).toEqual({ url: `${APP}/`, label: "Logga in i Miljonmatch" });
    expect(loginLink({ template: "nytt_meddelande", to: "amira.haddad@miljonbemanning.se" }, cfg)).toEqual({ url: `${APP}/`, label: "Logga in i Miljonmatch" });
    expect(loginLink({ template: "nytt_meddelande", to: MARIA }, cfg)).toEqual({ url: `${APP}/portal`, label: "Logga in i portalen" });
    expect(loginLink({ template: "kallelse", to: "testa@exempel.se" }, cfg)).toBeNull();
    expect(loginLink({ template: "ny_rapport", to: MARIA }, { appUrl: null, staffDomains: [] })).toBeNull();
    expect(loginLink({ template: "ny_rapport", to: MARIA }, { appUrl: "javascript:alert(1)", staffDomains: [] })).toBeNull();
  });
});

// ================================================================ Resend
describe("sendViaResend – felhantering", () => {
  const mail = { subject: "Ämne", html: "<p>x</p>", text: "x", to: KARIM, idempotencyKey: "out-1", template: "ny_rapport" };
  const cases: [number, string, boolean][] = [
    [429, "rate_limit_exceeded", true],
    [429, "daily_quota_exceeded", true],
    [500, "application_error", true],
    [409, "concurrent_idempotent_requests", true],
    [409, "invalid_idempotent_request", false],
    [422, "validation_error", false],
    [403, "validation_error", false],
    [401, "missing_api_key", false],
  ];
  for (const [status, name, retryable] of cases) {
    it(`${status} ${name} → ${retryable ? "försök igen" : "ge upp"}`, async () => {
      const r = fakeResend({ fail: [{ status, name, message: `The ${KARIM} address` }] });
      const e = await sendViaResend(r.fetch, RESEND, mail).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(JobError);
      expect((e as JobError).retryable).toBe(retryable);
      expect((e as JobError).message).toBe(`Resend svarade ${status} (${name})`);
    });
  }
  it("konstigt felnamn sparas inte", async () => {
    const r = fakeResend({ fail: [{ status: 400, name: `fel för ${KARIM}` }] });
    const e = (await sendViaResend(r.fetch, RESEND, mail).catch((x: unknown) => x)) as JobError;
    expect(e.message).toBe("Resend svarade 400 (okänt)");
  });
});

// ================================================================ Supabase Auths mall för inloggningskoden
describe("supabase/templates/otp.html", () => {
  const html = readFileSync(new URL("../../../supabase/templates/otp.html", import.meta.url), "utf8");
  it("visar koden, att den gäller 10 minuter och att man kan strunta i mejlet – utan länkar", () => {
    expect(html).toContain("{{ .Token }}");
    expect(html).toContain("10 minuter");
    expect(html).toMatch(/strunta i (det här )?mejlet/);
    expect(html).not.toMatch(/ConfirmationURL|TokenHash|RedirectTo|SiteURL|href=/);
    expect(html).toContain('lang="sv"');
    const colors = new Set([...html.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((x) => x[0].toUpperCase()));
    for (const c of colors) expect(["#1E252B", "#FF0C01", "#D1D3D3", "#6BA2B9", "#FFFFFF"]).toContain(c);
  });
});
