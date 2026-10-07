// Bilagor till beställningen (beslut 2026-10-07, synpunkt #7 och beslut 4) i minnesläget: uppladdning före och efter
// beställningen, koppling när beställningen skickas, behörigheten för att hämta och ta bort, filsignaturen, högsta antal,
// revisionsloggen utan filnamn och gallringen (24 timmar för okopplade, avtalets regel efter avslut). Bara påhittade filer.
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, ResultOf } from "@/api/contract";
import { execute } from "@/api/handlers";
import { SYSTEM_ACTOR, type Actor, type Role } from "@/api/roles";
import { ApiError, type Ctx } from "@/api/server";
import { ATTACHMENT_MAX_FILES } from "@/core/attachments";
import { bytesToBase64 } from "@/core/export/base64";
import { listPersonas } from "@/data/actors";
import { MemoryRepo, type MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START, TEST_PNR_CRYPTO } from "@/data/seed";
import type { AppRepo, Tables } from "@/data/schema";
import { runAttachmentRetention } from "@/features/_shared/attachment-retention";
import { attachmentDone, attachmentDownload, attachmentRemove, attachmentStart, caseCard, caseCreate, caseDecline, type CaseCard } from "./api";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
const q = (key: string, input: unknown, actor: Actor) => rt.run("query", key, input, actor) as Promise<Record<string, unknown>>;
const maria = () => as("k-maria", "kommun_handlaggare");
const sara = () => as("u-sara", "samordnare");
const NADIA = "case-260143"; // Marias beställning, huvudcoach Amira, Petra handledare i teamet

const PDF = new TextEncoder().encode("%PDF-1.7\n% påhittad kartläggning\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const FILE_NAME = "Kartläggning Samira Testsson.pdf";

/** Ladda upp en fil hela vägen (start + klar) – returnerar id eller kastar. */
async function upload(actor: Actor, caseId: string | null, fileName = FILE_NAME, content: Uint8Array = PDF, mimeType = "application/pdf") {
  const s = await run(attachmentStart, { caseId, fileName, mimeType, bytes: content.byteLength }, actor);
  if (!s.ok) throw new Error(`start: ${s.error} ${s.message ?? ""}`);
  expect(s.uploadUrl).toBeNull(); // minnesläget: ingen lagring att ladda upp till
  const d = await run(attachmentDone, { attachmentId: s.attachmentId, contentBase64: bytesToBase64(content) }, actor);
  if (!d.ok) throw new Error(`klar: ${d.error}`);
  return d.attachment.id;
}
const ORDER = {
  source: "portal" as const, firstName: "Samira", lastName: "Testsson", pnr: "19880412-3456", referrerUnit: "Arbetsmarknadsenheten Alby",
  orderPeriodMonths: 6, priorAssessment: "yes" as const, desiredStart: "2027-02-15", background: "Har arbetat i kök.",
};

describe("bilagor i beställningen", () => {
  it("handläggaren laddar upp innan beställningen skickas – filen kopplas till ärendet och syns i bakgrunden", async () => {
    const id = await upload(maria(), null);
    expect(rt.raw().get("case_attachments", id)).toMatchObject({ caseId: null, uploadedBy: "k-maria", status: "uploaded", mimeType: "application/pdf", storagePath: `c-bot/${id}.pdf` });
    const c = await run(caseCreate, { ...ORDER, attachmentIds: [id] }, maria());
    if (!c.ok) throw new Error(c.error);
    expect(rt.raw().get("case_attachments", id)).toMatchObject({ caseId: c.caseId, linkedAt: expect.any(String) });
    const d = await q("kommun.deltagare", { caseId: c.caseId }, maria());
    expect(d.background).toMatchObject({ orderPeriodText: "6 månader", priorAssessment: "yes", text: "Har arbetat i kök.", attachments: [{ id, fileName: FILE_NAME, sizeText: "1 kB", canRemove: false }] });
    // Samordnaren ser bilagan i deltagarkortet och får ta bort den.
    const card = (await rt.run("query", caseCard.key, { caseId: c.caseId }, sara())) as CaseCard;
    expect(card.background?.attachments.map((a) => [a.id, a.canRemove])).toEqual([[id, true]]);
    // Revisionsloggen: id, typ och storlek – aldrig filnamnet.
    const logs = rt.raw().all("audit_log").filter((l) => l.action.startsWith("attachment."));
    expect(logs.map((l) => l.action)).toEqual(["attachment.upload_started", "attachment.uploaded", "attachment.linked"]);
    expect(JSON.stringify(logs)).not.toMatch(/Kartläggning|Samira|Testsson/);
  });

  it("en annans uppladdning eller en fil i ett annat avtal kan inte kopplas till beställningen", async () => {
    const own = await upload(maria(), null);
    const other = await upload(as("k-omar", "kommun_handlaggare"), null);
    expect(await run(caseCreate, { ...ORDER, attachmentIds: [own, other] }, maria())).toMatchObject({ ok: false, error: "attachments" });
    expect(rt.raw().get("case_attachments", own)!.caseId).toBeNull();
  });

  it("filsignaturen kontrolleras: en fil som utger sig för att vara PDF raderas och loggas som avvisad", async () => {
    const s = await run(attachmentStart, { caseId: null, fileName: "falsk.pdf", mimeType: "application/pdf", bytes: 20 }, maria());
    if (!s.ok) throw new Error(s.error);
    const d = await run(attachmentDone, { attachmentId: s.attachmentId, contentBase64: bytesToBase64(new TextEncoder().encode("<html>x</html>")) }, maria());
    expect(d).toMatchObject({ ok: false, error: "invalid" });
    expect(rt.raw().get("case_attachments", s.attachmentId)).toMatchObject({ status: "deleted", deleteReason: "invalid" });
    expect(rt.raw().all("audit_log").at(-1)).toMatchObject({ action: "attachment.rejected", entityId: s.attachmentId });
    // Fel typ och för stor fil stoppas redan vid start.
    expect(await run(attachmentStart, { caseId: null, fileName: "arkiv.zip", mimeType: "application/zip", bytes: 100 }, maria())).toMatchObject({ ok: false, error: "invalid" });
    expect(await run(attachmentStart, { caseId: null, fileName: "stor.pdf", mimeType: "application/pdf", bytes: 10 * 1024 * 1024 + 1 }, maria())).toMatchObject({ ok: false, error: "invalid" });
    // En bild går bra.
    expect(rt.raw().get("case_attachments", await upload(maria(), null, "foto.png", PNG, "image/png"))!.status).toBe("uploaded");
  });

  it(`högst ${ATTACHMENT_MAX_FILES} filer per beställning`, async () => {
    for (let i = 0; i < ATTACHMENT_MAX_FILES; i++) await upload(maria(), null, `fil-${i}.pdf`);
    expect(await run(attachmentStart, { caseId: null, fileName: "en-till.pdf", mimeType: "application/pdf", bytes: PDF.byteLength }, maria())).toMatchObject({ ok: false, error: "too_many" });
  });
});

describe("hämta och ta bort", () => {
  it("hämta: uppladdaren, samordnare, avtalsansvarig och namngiven huvudcoach – aldrig handledare, ekonom, chef eller en annan handläggare", async () => {
    const id = await upload(sara(), NADIA);
    for (const a of [maria(), sara(), as("u-johan", "avtalsansvarig"), as("u-amira", "coach")]) {
      const r = await run(attachmentDownload, { attachmentId: id }, a);
      expect(r, a.userId).toMatchObject({ ok: true, url: null, fileName: FILE_NAME, mimeType: "application/pdf", contentBase64: bytesToBase64(PDF) });
    }
    // En annan handläggare och en coach som inte är huvudcoach: filen finns inte (behörigheten).
    for (const a of [as("k-omar", "kommun_handlaggare"), as("u-erik", "coach")]) {
      expect(await run(attachmentDownload, { attachmentId: id }, a), a.userId).toMatchObject({ ok: false, error: "not_found" });
    }
    // Handledare, ekonom, chef och admin: rollkontrollen.
    for (const a of [as("u-petra", "handledare"), as("u-lars", "ekonom"), as("u-karin", "chef"), as("u-robin", "admin")]) {
      await expect(run(attachmentDownload, { attachmentId: id }, a), a.role).rejects.toBeInstanceOf(ApiError);
    }
    // Varje hämtning loggas (tyst kommando – klockan står still), utan filnamn.
    const views = rt.raw().all("audit_log").filter((l) => l.action === "attachment.viewed");
    expect(views).toHaveLength(4);
    expect(views.map((l) => l.actorId)).toEqual(["k-maria", "u-sara", "u-johan", "u-amira"]);
    expect(JSON.stringify(views)).not.toContain("Kartläggning");
  });

  it("ta bort: den egna uppladdningen innan beställningen skickats, och samordnare/avtalsansvarig i ärendet – spåret finns kvar", async () => {
    const draft = await upload(maria(), null);
    expect(await run(attachmentRemove, { attachmentId: draft }, as("k-omar", "kommun_handlaggare"))).toMatchObject({ ok: false });
    expect(await run(attachmentRemove, { attachmentId: draft }, maria())).toEqual({ ok: true });
    expect(rt.raw().get("case_attachments", draft)).toMatchObject({ status: "deleted", deleteReason: "removed", removedBy: "k-maria" });
    const linked = await upload(sara(), NADIA);
    expect(await run(attachmentRemove, { attachmentId: linked }, maria())).toMatchObject({ ok: false, error: "forbidden" });
    await expect(run(attachmentRemove, { attachmentId: linked }, as("u-amira", "coach"))).rejects.toBeInstanceOf(ApiError);
    expect(await run(attachmentRemove, { attachmentId: linked }, as("u-johan", "avtalsansvarig"))).toEqual({ ok: true });
    expect(rt.raw().get("case_attachments", linked)).toMatchObject({ status: "deleted", removedBy: "u-johan" });
    // En borttagen fil går inte att hämta.
    expect(await run(attachmentDownload, { attachmentId: linked }, sara())).toMatchObject({ ok: false, error: "not_found" });
    expect(rt.raw().all("audit_log").filter((l) => l.action === "attachment.removed")).toHaveLength(2);
  });

  it("handläggaren bifogar fler filer till sin egen beställning – inte till andras", async () => {
    expect((await run(attachmentStart, { caseId: NADIA, fileName: "mer.pdf", mimeType: "application/pdf", bytes: 10 }, maria())).ok).toBe(true);
    expect(await run(attachmentStart, { caseId: NADIA, fileName: "mer.pdf", mimeType: "application/pdf", bytes: 10 }, as("k-omar", "kommun_handlaggare"))).toMatchObject({ ok: false });
    await expect(run(attachmentStart, { caseId: NADIA, fileName: "mer.pdf", mimeType: "application/pdf", bytes: 10 }, as("u-amira", "coach"))).rejects.toBeInstanceOf(ApiError);
  });
});

describe("gallringen (jobbet attachments_retention)", () => {
  const sysCtx = (audits: { action: string; details: Record<string, unknown> }[]): Ctx => ({
    actor: SYSTEM_ACTOR, now: () => rt.clock.now(), repo: new MemoryRepo<Tables>(rt.store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo,
    system: new MemoryRepo<Tables>(rt.store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo, newId: (p) => `${p}-g`,
    audit: async (e) => void audits.push({ action: e.action, details: e.details ?? {} }), notify: async () => undefined, crypto: TEST_PNR_CRYPTO, attachments: rt.attachments,
  });

  it("okopplade uppladdningar raderas efter 24 timmar; bilagor i avslutade ärenden bara när avtalets regel är fastställd", async () => {
    const draft = await upload(maria(), null);
    const linked = await upload(sara(), NADIA);
    const audits: { action: string; details: Record<string, unknown> }[] = [];
    // Inom 24 timmar: inget raderas.
    expect(await runAttachmentRetention(sysCtx(audits))).toEqual({ unlinked: 0, retention: 0, orphans: 0 });
    rt.clock.set("2027-02-02T10:00");
    expect(await runAttachmentRetention(sysCtx(audits))).toEqual({ unlinked: 1, retention: 0, orphans: 0 });
    expect(rt.raw().get("case_attachments", draft)).toMatchObject({ status: "deleted", deleteReason: "unlinked_24h" });
    // Ärendet avslutas – Botkyrkas regel är inte fastställd (ATT_FASTSTÄLLA): inget raderas.
    rt.store.updateRow("cases", NADIA, { status: "closed", endDate: "2027-02-02", closedAt: "2027-02-02T10:00" });
    rt.clock.set("2028-02-02T10:00");
    expect(await runAttachmentRetention(sysCtx(audits))).toEqual({ unlinked: 0, retention: 0, orphans: 0 });
    // Med en fastställd regel (påhittad: 90 dagar efter avslut) raderas bilagan.
    const bot = rt.raw().get("contracts", "c-bot")!;
    rt.store.updateRow("contracts", "c-bot", { config: { ...bot.config, retentionRules: { ...bot.config.retentionRules, attachmentsAfterCloseDays: 90 } } });
    rt.clock.set("2027-04-30T10:00");
    expect(await runAttachmentRetention(sysCtx(audits))).toEqual({ unlinked: 0, retention: 0, orphans: 0 });
    rt.clock.set("2027-05-03T10:00");
    expect(await runAttachmentRetention(sysCtx(audits))).toEqual({ unlinked: 0, retention: 1, orphans: 0 });
    expect(rt.raw().get("case_attachments", linked)).toMatchObject({ status: "deleted", deleteReason: "retention" });
    expect(audits.map((a) => [a.action, a.details.reason])).toEqual([["attachment.deleted", "unlinked_24h"], ["attachment.deleted", "retention"]]);
    expect(JSON.stringify(audits)).not.toContain("Kartläggning");
    expect(rt.attachments.stored()).toBe(0);
  });

  it("bilagor i en avböjd beställning gallras som i en avslutad – fristen räknas från avböjandet", async () => {
    const id = await upload(maria(), null);
    const c = await run(caseCreate, { ...ORDER, attachmentIds: [id] }, maria());
    if (!c.ok) throw new Error(c.error);
    const declined = await run(caseDecline, { caseId: c.caseId, reason: "Personen har redan en insats hos en annan leverantör." }, sara());
    expect(declined).toMatchObject({ ok: true });
    const declinedAt = rt.raw().get("cases", c.caseId)!.declinedAt!;
    expect(rt.raw().get("cases", c.caseId)).toMatchObject({ status: "declined", endDate: null });
    const audits: { action: string; details: Record<string, unknown> }[] = [];
    // Regeln är inte fastställd (Botkyrka): inget raderas.
    rt.clock.set("2029-01-01T10:00");
    expect(await runAttachmentRetention(sysCtx(audits))).toEqual({ unlinked: 0, retention: 0, orphans: 0 });
    // Fastställd regel (påhittad: 30 dagar): dagen före fristen kvar, sedan raderad.
    const bot = rt.raw().get("contracts", "c-bot")!;
    rt.store.updateRow("contracts", "c-bot", { config: { ...bot.config, retentionRules: { attachmentsAfterCloseDays: 30 } } });
    const day = declinedAt.slice(0, 10);
    const plus = (n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    rt.clock.set(`${plus(29)}T10:00`);
    expect(await runAttachmentRetention(sysCtx(audits))).toEqual({ unlinked: 0, retention: 0, orphans: 0 });
    rt.clock.set(`${plus(30)}T10:00`);
    expect(await runAttachmentRetention(sysCtx(audits))).toEqual({ unlinked: 0, retention: 1, orphans: 0 });
    expect(rt.raw().get("case_attachments", id)).toMatchObject({ status: "deleted", deleteReason: "retention" });
    expect(audits.map((a) => [a.action, a.details.caseId, a.details.reason])).toEqual([["attachment.deleted", c.caseId, "retention"]]);
  });

  it("avstämningen: en fil i lagringen utan levande rad raderas (loggas med id, aldrig filnamnet)", async () => {
    const id = await upload(maria(), null);
    // Raden tas bort ur tabellen utan att filen raderas (motsvarar en fil som laddats upp igen med samma adress efter "Ta bort").
    rt.store.updateRow("case_attachments", id, { status: "deleted", deletedAt: rt.clock.now(), deleteReason: "removed" });
    expect(rt.attachments.stored()).toBe(1);
    const audits: { action: string; details: Record<string, unknown> }[] = [];
    expect(await runAttachmentRetention(sysCtx(audits))).toEqual({ unlinked: 0, retention: 0, orphans: 1 });
    expect(rt.attachments.stored()).toBe(0);
    expect(audits).toEqual([{ action: "attachment.deleted", details: { caseId: null, reason: "orphan" } }]);
    // En levande uppladdning rörs inte.
    const live = await upload(maria(), null);
    expect(await runAttachmentRetention(sysCtx(audits))).toEqual({ unlinked: 0, retention: 0, orphans: 0 });
    expect(rt.raw().get("case_attachments", live)).toMatchObject({ status: "uploaded" });
    expect(rt.attachments.stored()).toBe(1);
  });
});

describe("prototypen spelar upp kommandon utan filinnehåll", () => {
  it("utan innehåll godtas filen och hämtningen ger en textfil som förklarar varför", async () => {
    const s = await run(attachmentStart, { caseId: null, fileName: "intyg.pdf", mimeType: "application/pdf", bytes: 1000 }, maria());
    if (!s.ok) throw new Error(s.error);
    expect(await run(attachmentDone, { attachmentId: s.attachmentId }, maria())).toMatchObject({ ok: true });
    const r = await run(attachmentDownload, { attachmentId: s.attachmentId }, maria());
    expect(r).toMatchObject({ ok: true, fileName: "intyg.pdf.txt", mimeType: "text/plain;charset=utf-8" });
    // Samma regler via execute() i en egen kontext (som servern): en annans uppladdning finns inte.
    const ctx: Ctx = {
      actor: as("k-omar", "kommun_handlaggare"), now: () => DEMO_START, repo: new MemoryRepo<Tables>(rt.store, as("k-omar", "kommun_handlaggare"), POLICIES) as unknown as AppRepo,
      system: new MemoryRepo<Tables>(rt.store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo, newId: (p) => `${p}-x`,
      audit: async () => undefined, notify: async () => undefined, crypto: TEST_PNR_CRYPTO, attachments: rt.attachments,
    };
    expect(await execute("command", attachmentDownload.key, { attachmentId: s.attachmentId }, ctx)).toMatchObject({ ok: false, error: "not_found" });
  });
});
