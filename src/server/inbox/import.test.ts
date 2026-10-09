// Inläsningen av avrop@ mot minnesläget med en fejkad Graph: idempotens, beställning → ärende och ordererkännande,
// oparsat avrop → väntar på registrering, komplettering och övrigt kopplade via ärendenumret, bilagor, flytt till Inläst.
import { describe, expect, it } from "vitest";
import { SYSTEM_ACTOR } from "@/api/roles";
import type { Ctx } from "@/api/server";
import type { LocalDateTime } from "@/core/time";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START, TEST_PNR_CRYPTO } from "@/data/seed";
import type { AppRepo, Tables } from "@/data/schema";
import { createMemoryAttachments } from "@/features/_shared/attachment-port";
import { JobError } from "../jobs/errors";
import type { GraphAttachment, GraphMail, GraphMessage } from "./graph";
import { contractForSender, importInbox, receivedLocal } from "./import";

const NOW: LocalDateTime = DEMO_START;
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46]);

function setup() {
  const store = new MemoryStore<Tables>(createSeed());
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  let seq = 0;
  const newId = (p: string) => `${p}-t${++seq}`;
  const notified: { to: string; template: string; body: string; caseId: string | null }[] = [];
  const audits: { action: string; entityId: string | null; details: Record<string, unknown> }[] = [];
  const attachments = createMemoryAttachments({ system, now: () => NOW, newId });
  const ctx: Ctx = {
    actor: SYSTEM_ACTOR, now: () => NOW, repo: system, system, newId,
    audit: async (e) => void audits.push({ action: e.action, entityId: e.entityId, details: e.details ?? {} }),
    notify: async (m) => void notified.push({ to: m.to, template: m.template, body: m.body, caseId: m.caseId ?? null }),
    crypto: TEST_PNR_CRYPTO, attachments,
  };
  return { store, ctx, notified, audits, attachments };
}

type FakeOpts = { messages: GraphMessage[]; attachments?: Record<string, { meta: GraphAttachment; bytes: Uint8Array }[]>; failMove?: Set<string> };
function fakeGraph(o: FakeOpts): GraphMail & { moved: string[] } {
  const moved: string[] = [];
  return {
    moved,
    listUnread: async () => o.messages.filter((m) => !moved.includes(m.id)),
    listAttachments: async (id) => (o.attachments?.[id] ?? []).map((a) => a.meta),
    attachmentBytes: async (id, aid) => {
      const a = (o.attachments?.[id] ?? []).find((x) => x.meta.id === aid);
      if (!a) throw new JobError("saknas", { retryable: false });
      return a.bytes;
    },
    moveToDone: async (id) => {
      if (o.failMove?.has(id)) throw new JobError("Microsoft Graph: flytten svarade 503", { retryable: true });
      moved.push(id);
    },
  };
}

const msg = (over: Partial<GraphMessage> & { id: string }): GraphMessage => ({
  internetMessageId: `<${over.id}@botkyrka.se>`, subject: "Avrop", receivedDateTime: "2027-02-01T07:50:00Z", fromAddress: "linda.karlsson@botkyrka.se", fromName: "Linda Karlsson",
  bodyText: "", hasAttachments: false, ...over,
});

/** Mallen före 2026-10-09: bostadsort och föredragen kontaktväg, inget yrkesområde. Tolkas fortfarande. */
const OLD_TEMPLATE = `Hej!\n\n1. Beställning och kontakt\nHandläggare: Linda Karlsson\nEnhet: Arbetsmarknadsenheten Hallunda\nTelefon: 08-530 000 00\nE-post: linda.karlsson@botkyrka.se\nÖnskat startdatum: 2027-02-15\nOmfattning: 6 månader\n\n2. Deltagare\nFörnamn: Yonas\nEfternamn: Tesfay\nPersonnummer: 19920202-9999\nTelefon: 070-111 22 33\nBostadsort: Hallunda\nFöredragen kontaktväg: E-post\n\n3. Bakgrundsinformation om deltagaren\nKartläggning genomförd: Ja\nBakgrundsinformation: Vill arbeta i lager.\n\n/Linda`;
/** Mallen sedan 2026-10-09 (docs/lathund/mall-mejlavrop.md): yrkesområde i stället för bostadsort och kontaktväg. */
const TEMPLATE = OLD_TEMPLATE.replace("Bostadsort: Hallunda\nFöredragen kontaktväg: E-post\n", "Yrkesområde (se listan under mallen): Lager och logistik\n");

describe("importInbox", () => {
  it("en beställning enligt mallen blir ett ärende med ordererkännande, bilagan sparas och mejlet flyttas till Inläst", async () => {
    const t = setup();
    const graph = fakeGraph({
      messages: [msg({ id: "m1", subject: "Avrop lager", bodyText: TEMPLATE, hasAttachments: true })],
      attachments: { m1: [{ meta: { id: "a1", name: "Kartläggning.pdf", contentType: "application/pdf", size: PDF.byteLength }, bytes: PDF }, { meta: { id: "a2", name: "bild.gif", contentType: "image/gif", size: 10 }, bytes: new Uint8Array(10) }] },
    });
    const sum = await importInbox({ graph, ctx: t.ctx, now: NOW });
    expect(sum).toMatchObject({ seen: 1, imported: 1, cases: 1, toRegister: 0, supplements: 0, other: 0, skipped: 0, moved: 1, moveErrors: 0 });
    const m = t.store.rows("inbound_emails").find((e) => e.graphMessageId === "<m1@botkyrka.se>")!;
    expect(m).toMatchObject({ receivedAt: "2027-02-01T08:50", parseMethod: "template", classification: "order", status: "acknowledged", missingFields: [], fromAddress: "linda.karlsson@botkyrka.se", ackSentAt: NOW });
    expect(m.extracted).toMatchObject({ firstName: "Yonas", lastName: "Tesfay", pnr: "19920202-9999", desiredStart: "2027-02-15", orderPeriod: "6", priorAssessment: "ja", primaryArea: "G" });
    expect(m.attachments).toEqual([{ name: "Kartläggning.pdf", kind: "pdf", path: "c-bot/att-t2.pdf" }, { name: "bild.gif", kind: "gif", path: null }]);
    const c = t.store.getRow("cases", m.caseId!)!;
    expect(c).toMatchObject({ caseNumber: "BOT-27-0051", source: "email", status: "acknowledged", referredAt: "2027-02-01T08:50", referrerId: "k-linda", sourceEmailId: m.id, orderPeriodMonths: 6, plannedEnd: "2027-08-14", priorAssessment: "yes", backgroundInfo: "Vill arbeta i lager.", primaryAreaCode: "G" });
    // Ingen kontaktväg i mallen: SMS när telefonnummer finns. Ingen bostadsort.
    expect(t.store.getRow("persons", c.personId)).toMatchObject({ firstName: "Yonas", lastName: "Tesfay", personnummerLast4: "9999", city: "", preferredContact: "sms" });
    // Bilagan hör till ärendet (uppladdad av systemet), den otillåtna filen sparades inte.
    expect(t.store.rows("case_attachments").filter((a) => a.caseId === c.id).map((a) => [a.fileName, a.status, a.uploadedBy])).toEqual([["Kartläggning.pdf", "uploaded", "system"]]);
    // Ordererkännandet: till handläggaren, bara ärendenumret.
    expect(t.notified).toEqual([expect.objectContaining({ to: "linda.karlsson@botkyrka.se", template: "ordererkannande", caseId: c.id })]);
    expect(t.notified[0].body).toContain("BOT-27-0051");
    expect(t.notified[0].body).not.toMatch(/Yonas|Tesfay|19920202|Vi saknar/);
    expect(t.audits.map((a) => a.action)).toEqual(["case.created", "attachment.linked", "email.received"]);
    expect(t.audits[2]).toMatchObject({ entityId: m.id, details: { parseMethod: "template", classification: "order", caseId: c.id, attachments: 2 } });
    expect(JSON.stringify(t.audits)).not.toMatch(/Yonas|19920202|linda/);
    expect(graph.moved).toEqual(["m1"]);
    // Idempotent: samma mejl igen (flytten hade t.ex. misslyckats) ger ingen ny rad.
    graph.moved.length = 0;
    expect(await importInbox({ graph, ctx: t.ctx, now: NOW })).toMatchObject({ seen: 1, imported: 0, skipped: 1, moved: 1 });
    expect(t.store.rows("inbound_emails").filter((e) => e.graphMessageId === "<m1@botkyrka.se>")).toHaveLength(1);
  });

  it("ett äldre mejl med bostadsort och kontaktväg tolkas som förut – ordererkännandet frågar efter yrkesområdet", async () => {
    const t = setup();
    const graph = fakeGraph({ messages: [msg({ id: "o1", subject: "Avrop lager", bodyText: OLD_TEMPLATE })] });
    expect(await importInbox({ graph, ctx: t.ctx, now: NOW })).toMatchObject({ imported: 1, cases: 1, toRegister: 0 });
    const m = t.store.rows("inbound_emails").find((e) => e.graphMessageId === "<o1@botkyrka.se>")!;
    expect(m).toMatchObject({ classification: "order", status: "acknowledged", missingFields: ["primaryArea"] });
    const c = t.store.getRow("cases", m.caseId!)!;
    expect(c.primaryAreaCode).toBeNull();
    // Kontaktvägen och orten i mejlet behålls.
    expect(t.store.getRow("persons", c.personId)).toMatchObject({ city: "Hallunda", preferredContact: "email" });
    const ack = t.notified.find((n) => n.caseId === c.id)!;
    expect(ack.body).toContain("Vi saknar yrkesområde – svara på det här mejlet");
    expect(ack.body).not.toMatch(/Yonas|Tesfay|19920202|Hallunda/);
  });

  it("fritext utan etiketter: beställningen sparas och väntar på registrering; ett avrop med saknade uppgifter listar dem i ordererkännandet", async () => {
    const t = setup();
    const graph = fakeGraph({
      messages: [
        msg({ id: "f1", subject: "Ny deltagare", bodyText: "Hej! Vi vill anvisa Samir Test (19940404-6666) till er, gärna inom kök. /Ahmed", fromAddress: "ahmed.yusuf@botkyrka.se", fromName: "Ahmed Yusuf" }),
        msg({ id: "f2", subject: "Avrop", bodyText: "Förnamn: Mira\nEfternamn: Berg\nPersonnummer: 19950505-1111\nTelefon: 0700000000\nBostadsort: Alby" }),
      ],
    });
    const sum = await importInbox({ graph, ctx: t.ctx, now: NOW });
    expect(sum).toMatchObject({ imported: 2, cases: 1, toRegister: 1, moved: 2 });
    const f1 = t.store.rows("inbound_emails").find((e) => e.graphMessageId === "<f1@botkyrka.se>")!;
    expect(f1).toMatchObject({ classification: "order", parseMethod: "manual", status: "received", caseId: null, extracted: { pnr: "19940404-6666" } });
    expect(f1.missingFields).toEqual(["desiredStart", "orderPeriod", "firstName", "lastName", "primaryArea"]);
    const f2 = t.store.rows("inbound_emails").find((e) => e.graphMessageId === "<f2@botkyrka.se>")!;
    expect(f2).toMatchObject({ status: "acknowledged", missingFields: ["desiredStart", "orderPeriod", "primaryArea"] });
    const ack = t.notified.find((n) => n.caseId === f2.caseId)!;
    expect(ack.body).toContain("Vi saknar önskat startdatum, omfattningen");
    expect(ack.body).toContain("och yrkesområde");
    expect(ack.body).toContain("svara på det här mejlet");
    expect(t.store.getRow("cases", f2.caseId!)).toMatchObject({ referrerId: "k-linda", orderPeriodMonths: null, plannedEnd: null, desiredStart: null });
  });

  it("svar med ärendenumret: komplettering till ett öppet ärende, övrigt till ett pågående; okänt prefix blir övrigt", async () => {
    const t = setup();
    const graph = fakeGraph({
      messages: [
        msg({ id: "s1", subject: "SV: Vi har tagit emot er beställning – BOT-27-0049", bodyText: "Beställarreferens: 55102938\nSlutdatum: 2027-03-19\n/Ahmed", fromAddress: "ahmed.yusuf@botkyrka.se" }),
        msg({ id: "s2", subject: "Fråga om schema", bodyText: "Hej! Gäller BOT-26-0143. Vilka dagar är praktiken?" }),
        msg({ id: "s3", subject: "Lunch?", bodyText: "Ska vi ses nästa vecka och prata samarbete?" }),
      ],
    });
    const sum = await importInbox({ graph, ctx: t.ctx, now: NOW });
    expect(sum).toMatchObject({ imported: 3, cases: 0, supplements: 1, other: 2, moved: 3 });
    const rows = t.store.rows("inbound_emails");
    expect(rows.find((e) => e.graphMessageId === "<s1@botkyrka.se>")).toMatchObject({ classification: "supplement", status: "linked", caseId: "case-270049", linkedBy: "ärendenummer i ämnesraden", extracted: { buyerReference: "55102938", plannedEnd: "2027-03-19" } });
    expect(rows.find((e) => e.graphMessageId === "<s2@botkyrka.se>")).toMatchObject({ classification: "other", status: "other", caseId: "case-260143", linkedBy: "ärendenummer i texten" });
    expect(rows.find((e) => e.graphMessageId === "<s3@botkyrka.se>")).toMatchObject({ classification: "other", status: "other", caseId: null, linkedBy: null });
    expect(t.notified).toEqual([]);
  });

  it("personen har redan en insats: inget ärende – mejlet väntar på samordnaren; flytt som misslyckas ger ett nytt försök utan dubbletter", async () => {
    const t = setup();
    const body = "Förnamn: Rasha\nEfternamn: Khalaf\nPersonnummer: 19750312-5223\nÖnskat startdatum: 2027-02-15\nOmfattning: 6 månader";
    const graph = fakeGraph({ messages: [msg({ id: "d1", bodyText: body }), msg({ id: "d2", subject: "Avrop", bodyText: body.replace("5223", "5224") })], failMove: new Set(["d2"]) });
    await expect(importInbox({ graph, ctx: t.ctx, now: NOW })).rejects.toMatchObject({ retryable: true, message: expect.stringContaining("1 av 2 mejl kunde inte flyttas") });
    const d1 = t.store.rows("inbound_emails").find((e) => e.graphMessageId === "<d1@botkyrka.se>")!;
    expect(d1).toMatchObject({ classification: "order", status: "received", caseId: null });
    expect(t.store.rows("inbound_emails").filter((e) => e.graphMessageId === "<d2@botkyrka.se>")).toHaveLength(1);
    expect(graph.moved).toEqual(["d1"]);
    // Nästa körning: d2 hoppas över som rad men flyttas (när flytten fungerar).
    graph.moveToDone = async (id) => void graph.moved.push(id);
    expect(await importInbox({ graph, ctx: t.ctx, now: NOW })).toMatchObject({ seen: 1, imported: 0, skipped: 1, moved: 1 });
    expect(t.store.rows("inbound_emails").filter((e) => e.graphMessageId === "<d2@botkyrka.se>")).toHaveLength(1);
  });

  it("avtalet väljs på avsändarens domän (annars det första aktiva) och tiden räknas om till Stockholm", async () => {
    const t = setup();
    expect((await contractForSender(t.ctx, "linda.karlsson@botkyrka.se"))?.id).toBe("c-bot");
    expect((await contractForSender(t.ctx, "nagon@example.org"))?.id).toBe("c-bot");
    expect(receivedLocal("2027-02-01T07:50:00Z", NOW)).toBe("2027-02-01T08:50");
    expect(receivedLocal("2027-07-01T07:50:00Z", NOW)).toBe("2027-07-01T09:50");
    expect(receivedLocal("trasigt", NOW)).toBe(NOW);
  });
});
