// Kallelsen och inbjudan i servern, hela vägen: notifyParticipant lägger utskicken i kön (queueMessage), jobbet send_message
// skickar dem (Resend och 46elks fejkade) – och när inget skriftligt utskick når deltagaren får samordnaren uppgiften att ringa
// (participantSendStopped i registry.ts). Spärrlistan för e-post (MM_EMAIL_ALLOWLIST, också i drift) räknas redan i kanalvalet.
// Samtalet ringer bara när SMS:et eller mejlet gick iväg. Körs mot testdatat i minnet – inget skickas på riktigt.
import { describe, expect, it } from "vitest";
import type { Ctx } from "@/api/server";
import { SYSTEM_ACTOR } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import type { MemoryStore } from "@/data/memory";
import { createMemoryRuntime, demoClock } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import { CALL_WITHOUT_TEXT_REASON, EMAIL_NOT_ALLOWED_REASON } from "@/features/_shared/messaging-port";
import { notifyParticipant } from "@/features/_shared/participant-notify";
import { runJobs } from "../jobs/runner";
import { JOB_HANDLERS, type JobDeps } from "../jobs/registry";
import { emailReaches, phoneGate, recipientGate } from "./decision";
import { queueMessage } from "./queue";
import { fakeElks, fakeResend, memoryJobStore } from "./test-helpers";
import type { NotifyRepo, NotifyTables } from "./types";

const SEED = createSeed();
const CASE = "case-270048";
const NOW = "2027-02-01T09:12";
const SMS = { username: "u_test", password: "hemligt-losenord", from: "Miljonbem" };
const CALL = { username: "u_test", password: "hemligt-losenord", from: "+46766860000", audioUrl: "https://www.miljonmatch.se/ljud/kallelse.mp3" };
const ON = { connected: true, missing: [] };

/** Driften: app_settings.environment = production och spärrlistan för e-post (tom = alla adresser). */
function setup(allowlist: string[], elksFail: { status: number; text?: string }[] = []) {
  const gate = recipientGate("production", allowlist);
  const rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START), messaging: { sms: ON, call: ON, emailReaches: emailReaches(gate) } });
  const repo = rt.ctxFor(SYSTEM_ACTOR).system as unknown as NotifyRepo;
  let seq = 0;
  const newId = (p: string) => `${p}-q${String(++seq).padStart(4, "0")}`;
  const elks = fakeElks({ fail: elksFail });
  const resend = fakeResend();
  const actor = listPersonas(rt.raw()).find((p) => p.actor.userId === "u-sara" && p.actor.role === "samordnare")!.actor;
  // Hanterarens Ctx med serverns kö: utskicken blir rader i outbound_messages och jobb send_message (src/server/notify/index.ts).
  const ctx: Ctx = { ...rt.ctxFor(actor), notify: async (m) => void (await queueMessage(repo, m, NOW, newId, { phone: { sms: true, call: true } })) };
  const deps = (now: string): JobDeps => ({
    notify: {
      repo, gate, render: { appUrl: "https://www.miljonmatch.se", staffDomains: ["miljonbemanning.se"] }, resend: { apiKey: "re_x", from: "Miljonmatch <notis@miljonmatch.se>" },
      fetch: resend.fetch, now, phone: { gate: phoneGate("production", []), sms: SMS, call: CALL, fetch: elks.fetch },
    },
    // Systemstegens Ctx (service role) – samma som röstjobben får i src/server/jobs/live.ts.
    voice: () => rt.ctxFor(SYSTEM_ACTOR),
  });
  const jobs = memoryJobStore(rt.store as unknown as MemoryStore<NotifyTables>);
  const run = (now = NOW) => runJobs<JobDeps>({ store: jobs, handlers: JOB_HANDLERS, ctx: deps(now), now, limit: 20 });
  const out = () => rt.store.rows("outbound_messages").filter((m) => m.caseId === CASE && m.template === "aktivitetsinbjudan");
  const tasks = () => rt.store.rows("tasks").filter((t) => t.kind === "participant_contact");
  return { rt, ctx, run, out, tasks, elks, resend };
}

const INVITE = { caseId: CASE, template: "aktivitetsinbjudan" as const, when: "2027-02-04T13:30", place: "Alby" };

describe("jobbet send_message: uppgiften att ringa när inget utskick når deltagaren", () => {
  it("spärrlistan stoppar mejlet och 46elks avvisar SMS:et: samordnaren får en uppgift, samtalet ringer inte", async () => {
    const s = setup(["@miljonbemanning.se"], [{ status: 400, text: "Invalid to number" }]);
    const r = await notifyParticipant(s.ctx, INVITE);
    // Kanalvalet vet att mejlet stoppas: SMS och samtal går, e-posten sparas med orsak.
    expect(r).toMatchObject({ channels: ["sms", "call"], off: ["email"], taskId: null, summary: "Inbjudan skickas med SMS. Deltagaren blir också uppringd med ett inspelat meddelande." });
    expect(s.out().every((m) => m.status === "queued")).toBe(true);
    await s.run();
    expect(s.out().map((m) => [m.channel, m.status])).toEqual([["sms", "failed"], ["call", "queued"], ["email", "suppressed"]]);
    expect(s.out().find((m) => m.channel === "email")!.statusReason).toBe(EMAIL_NOT_ALLOWED_REASON);
    expect(s.tasks()).toHaveLength(1);
    expect(s.tasks()[0]).toMatchObject({ toRole: "samordnare", status: "open", caseIds: [CASE], fromId: "system" });
    expect(s.tasks()[0].text).toBe(
      "Ring deltagaren och bjud in till aktiviteten – ärende BOT-27-0048, torsdag 4 februari kl. 13.30, Alby. Inbjudan kunde inte skickas: e-post till deltagarens adress är spärrad just nu och SMS:et kunde inte skickas.",
    );
    // Samtalet väntade på SMS:et och mejlet – inget av dem gick, så det ringer inte (inspelningen hänvisar till dem).
    await s.run("2027-02-01T09:14");
    expect(s.out().find((m) => m.channel === "call")).toMatchObject({ status: "suppressed", statusReason: CALL_WITHOUT_TEXT_REASON });
    expect(s.elks.calls.filter((c) => c.url.endsWith("/calls"))).toEqual([]);
    expect(s.resend.calls).toEqual([]);
    expect(s.tasks()).toHaveLength(1);
  });

  it("mejlet går fram (tom spärrlista): ingen uppgift fast SMS:et avvisas, och samtalet ringer", async () => {
    const s = setup([], [{ status: 400, text: "Invalid to number" }]);
    const r = await notifyParticipant(s.ctx, INVITE);
    expect(r.channels).toEqual(["sms", "email", "call"]);
    await s.run();
    await s.run("2027-02-01T09:14");
    expect(s.out().map((m) => [m.channel, m.status])).toEqual([["sms", "failed"], ["email", "sent"], ["call", "sent"]]);
    expect(s.elks.calls.filter((c) => c.url.endsWith("/calls"))).toHaveLength(1);
    expect(s.tasks()).toEqual([]);
  });
});
