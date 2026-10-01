// Testmiljön: MM_EMAIL_REDIRECT_TO skickar testpersonernas mejl till testaren (status sent, orsak redirected), med en rad
// överst om vem mejlet skulle ha gått till (roll och organisation – aldrig adressen). Aldrig i produktion. Svarsadressen
// MM_EMAIL_REPLY_TO skickas med till Resend. Resend fejkas – inga riktiga mejl skickas.
import { describe, expect, it } from "vitest";
import type { Case } from "@/data/schema";
import { createSeed } from "@/data/seed";
import { notifyEnv } from "./config";
import { emailDecision, REASON, recipientGate, type RecipientGate } from "./decision";
import { queueMessage } from "./queue";
import { intendedRecipient, REDIRECT_PREFIX } from "./redirect";
import { deliverMessage, type SenderDeps } from "./sender";
import { fakeResend, memoryNotifyRepo } from "./test-helpers";

const NOW = "2027-02-01T09:12";
const KARIM = "karim.khalil@miljonbemanning.se";
const ALI = "ali.khalil@miljonbemanning.se";
const MARIA = "maria.ekdahl@botkyrka.se";
const ALLOW = [KARIM, ALI];
const RESEND = { apiKey: "re_test_nyckel", from: "Miljonmatch <notis@miljonmatch.se>" };

const SEED = createSeed();
const CASE = SEED.cases.find((c) => c.id === "case-270048")! as Case;
const DIR = { profiles: SEED.profiles, memberships: SEED.memberships, organizations: SEED.organizations };
let seq = 0;
const newId = (p: string) => `${p}-r${++seq}`;

function setup(gate: RecipientGate, resend: SenderDeps["resend"] = RESEND) {
  const { repo, store } = memoryNotifyRepo(SEED.cases, DIR);
  const fake = fakeResend();
  const deps: SenderDeps = { repo, gate, render: { appUrl: "https://test.miljonmatch.se", staffDomains: ["miljonbemanning.se"] }, resend, fetch: fake.fetch, now: NOW };
  const send = async (to: string, template = "ordererkannande", body = `Tack! Vi har tagit emot er beställning och gett den ärendenummer ${CASE.caseNumber}.`) => {
    const q = await queueMessage(repo, { channel: "email", to, template, body, caseId: CASE.id }, NOW, newId);
    const outcome = await deliverMessage(deps, q.messageId);
    return { outcome, row: store.rows("outbound_messages").find((r) => r.id === q.messageId)! };
  };
  return { repo, store, fake, send };
}

describe("MM_EMAIL_REDIRECT_TO (bara testmiljön)", () => {
  it("gäller bara i testmiljön och bara när adressen själv finns i spärrlistan", () => {
    expect(recipientGate("staging", ALLOW, " Karim.Khalil@Miljonbemanning.se ").redirectTo).toBe(KARIM);
    expect(recipientGate("staging", ["@miljonbemanning.se"], KARIM).redirectTo).toBe(KARIM);
    // Aldrig i produktion – inte ens med spärrlista.
    expect(recipientGate("production", [], KARIM).redirectTo).toBeNull();
    expect(recipientGate("production", ALLOW, KARIM).redirectTo).toBeNull();
    // Okänd miljö: spärren gäller, men ingen omdirigering.
    expect(recipientGate(null, ALLOW, KARIM).redirectTo).toBeNull();
    // Adressen måste finnas i spärrlistan och vara giltig.
    expect(recipientGate("staging", [ALI], KARIM).redirectTo).toBeNull();
    expect(recipientGate("staging", ALLOW, "inte-en-adress").redirectTo).toBeNull();
    expect(recipientGate("staging", ALLOW, "").redirectTo).toBeNull();
    expect(recipientGate("staging", ALLOW).redirectTo).toBeNull();
  });

  it("beslutet: testpersoner omdirigeras, testarna får sina egna mejl, personnummer stoppas fortfarande", () => {
    const gate = recipientGate("staging", ALLOW, KARIM);
    expect(emailDecision({ to: MARIA, subject: null, body: "Hej" }, gate)).toEqual({ action: "redirect", to: KARIM, reason: REASON.redirected });
    expect(emailDecision({ to: ALI, subject: null, body: "Hej" }, gate)).toEqual({ action: "send" });
    expect(emailDecision({ to: MARIA, subject: null, body: "Personnummer 19750818-8340" }, gate)).toEqual({ action: "suppressed", reason: REASON.personnummer });
    expect(emailDecision({ to: "", subject: null, body: "Hej" }, gate)).toEqual({ action: "suppressed", reason: REASON.noAddress });
    expect(REASON.redirected).toBe("redirected");
  });

  it("skickar till testaren med raden överst: roll och organisation, aldrig testpersonens adress", async () => {
    const { send, fake } = setup(recipientGate("staging", ALLOW, KARIM));
    const { outcome, row } = await send(MARIA);
    expect(outcome).toBe("sent");
    expect(row).toMatchObject({ status: "sent", statusReason: "redirected", to: MARIA, sentAt: NOW, providerMessageId: "re-1" });
    expect(fake.calls).toHaveLength(1);
    const body = fake.calls[0].body;
    expect(body.to).toEqual([KARIM]);
    const note = `${REDIRECT_PREFIX} kommunens handläggare på Botkyrka kommun.`;
    expect(body.text.split("\n")[0]).toBe(note);
    expect(body.html).toContain(note);
    expect(body.subject.startsWith("[Testmiljö] ")).toBe(true);
    // Testpersonens adress och namn står aldrig i mejlet.
    for (const part of [body.text, body.html, body.subject]) {
      expect(part).not.toContain(MARIA);
      expect(part).not.toContain("Maria");
      expect(part).not.toContain("Ekdahl");
    }
    // Länken är den som testpersonen skulle ha fått (kommunens portal).
    expect(body.text).toContain("https://test.miljonmatch.se/portal");
  });

  it("MB-personal och deltagaren beskrivs med roll respektive ärendenummer", async () => {
    const { repo } = setup(recipientGate("staging", ALLOW, KARIM));
    const sara = SEED.profiles.find((p) => p.id === "u-sara")!;
    expect(await intendedRecipient(repo, { to: sara.email, template: "tilldelning_coach", caseId: null })).toBe("operativ samordnare på Miljonbemanning AB");
    expect(await intendedRecipient(repo, { to: "deltagare@example.com", template: "kallelse", caseId: CASE.id })).toBe(`deltagaren i ärende ${CASE.caseNumber}`);
    expect(await intendedRecipient(repo, { to: "okand.person@botkyrka.se", template: "ny_rapport", caseId: null })).toBe("en mottagare på Botkyrka kommun");
    expect(await intendedRecipient(repo, { to: "vem@example.com", template: "ny_rapport", caseId: null })).toBe("en mottagare som inte är testare");
  });

  it("utan MM_EMAIL_REDIRECT_TO stoppas testpersonernas mejl som förut", async () => {
    const { send, fake } = setup(recipientGate("staging", ALLOW));
    const { outcome, row } = await send(MARIA);
    expect(outcome).toBe("suppressed");
    expect(row).toMatchObject({ status: "suppressed", statusReason: REASON.notAllowed });
    expect(fake.calls).toHaveLength(0);
  });

  it("produktion: mejlet går till mottagaren, utan testrad", async () => {
    const { send, fake } = setup(recipientGate("production", [], KARIM));
    const { outcome, row } = await send(MARIA);
    expect(outcome).toBe("sent");
    expect(row.statusReason).toBeNull();
    expect(fake.calls[0].body.to).toEqual([MARIA]);
    expect(fake.calls[0].body.text).not.toContain(REDIRECT_PREFIX);
    expect(fake.calls[0].body.subject.startsWith("[Testmiljö]")).toBe(false);
  });
});

describe("MM_EMAIL_REPLY_TO", () => {
  it("läses från miljön och skickas som reply_to till Resend", async () => {
    const env = notifyEnv({ RESEND_API_KEY: "re_x", MM_EMAIL_FROM: "Miljonmatch <notis@miljonmatch.se>", MM_EMAIL_REPLY_TO: " avrop@miljonbemanning.se ", MM_EMAIL_REDIRECT_TO: " Karim.Khalil@Miljonbemanning.se" });
    expect(env.resend).toEqual({ apiKey: "re_x", from: "Miljonmatch <notis@miljonmatch.se>", replyTo: "avrop@miljonbemanning.se" });
    expect(env.redirectTo).toBe(KARIM);
    const { send, fake } = setup(recipientGate("production", []), env.resend);
    await send(MARIA);
    expect((fake.calls[0].body as unknown as { reply_to?: string }).reply_to).toBe("avrop@miljonbemanning.se");
  });

  it("utan svarsadress skickas ingen reply_to", async () => {
    expect(notifyEnv({ RESEND_API_KEY: "re_x", MM_EMAIL_FROM: "a@b.se" }).resend?.replyTo).toBeNull();
    const { send, fake } = setup(recipientGate("production", []));
    await send(MARIA);
    expect("reply_to" in fake.calls[0].body).toBe(false);
  });
});
