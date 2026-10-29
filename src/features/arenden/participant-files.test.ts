// Filer på deltagarkortet (Karims beslut 2026-10-29, 0037) i minnesläget: CV, personligt brev, betyg och intyg – bara
// Miljonbemanning. Roller, ärendets status, högsta antal (med uppladdningar som pågår), hämta och ta bort (när som helst, villkorat),
// revisionsloggen utan filnamn och Historik i klarspråk,
// att kommunen aldrig får filerna (portalens alla frågor, bakgrunden i kortet och inkorgen), att beställningens bilagor och
// deltagarfilerna hålls isär, och städningen (filer i ett ärende gallras aldrig automatiskt). Bara påhittade filer.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, ResultOf } from "@/api/contract";
import { SYSTEM_ACTOR, type Actor, type Role } from "@/api/roles";
import { ApiError, type Ctx } from "@/api/server";
import { PARTICIPANT_FILE_MAX_FILES } from "@/core/attachments";
import { bytesToBase64 } from "@/core/export/base64";
import { addMinutes } from "@/core/time";
import { listPersonas } from "@/data/actors";
import { dormantSupervisor } from "@/data/dormant-role.test-helper";
import { MemoryRepo, type MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START, TEST_PNR_CRYPTO } from "@/data/seed";
import { SEED_PARTICIPANT_FILES } from "@/data/seed/decisions-2026-10-29";
import type { AppRepo, CaseStatus, Tables } from "@/data/schema";
import { runAttachmentRetention } from "@/features/_shared/attachment-retention";
import * as kommunApi from "@/features/kommun/api";
import {
  attachmentDone, attachmentDownload, attachmentRemove, attachmentStart, caseCard, caseHistory, caseOverview, participantFileDone, participantFileRemove, participantFileStart,
  type CaseCard, type CaseFiles, type CaseHistory, type CaseOverview,
} from "./api";

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
const q = <T,>(key: string, input: unknown, actor: Actor) => rt.run("query", key, input, actor) as Promise<T>;
const amira = () => as("u-amira", "coach");
const erik = () => as("u-erik", "coach");
const sara = () => as("u-sara", "samordnare");
const johan = () => as("u-johan", "avtalsansvarig");
const maria = () => as("k-maria", "kommun_handlaggare");
const NADIA = "case-260143"; // Marias beställning, huvudcoach Amira – i testdatat finns ett CV, ett personligt brev och ett intyg

const PDF = new TextEncoder().encode("%PDF-1.7\n% påhittat cv\n");
const FILE_NAME = "CV Samira Testsson.pdf";

/** Ladda upp en fil på deltagarkortet hela vägen (start + klar) – returnerar id eller kastar. */
async function upload(actor: Actor, caseId = NADIA, category: "cv" | "personligt_brev" | "betyg_intyg" | "ovrigt" = "cv", fileName = FILE_NAME, content: Uint8Array = PDF) {
  const s = await run(participantFileStart, { caseId, category, fileName, mimeType: "application/pdf", bytes: content.byteLength }, actor);
  if (!s.ok) throw new Error(`start: ${s.error} ${s.message ?? ""}`);
  expect(s.uploadUrl).toBeNull(); // minnesläget: ingen lagring att ladda upp till
  const d = await run(participantFileDone, { attachmentId: s.attachmentId, contentBase64: bytesToBase64(content) }, actor);
  if (!d.ok) throw new Error(`klar: ${d.error}`);
  return d.file.id;
}
/** Kortet Filer – följer med fliken Översikt (arenden.kortOversikt, files). null = ingen åtkomst till filerna. */
const files = async (actor: Actor, caseId = NADIA): Promise<CaseFiles | null> => ((await q<CaseOverview | null>(caseOverview.key, { caseId }, actor)) ?? null)?.files ?? null;

describe("ladda upp", () => {
  it("coachen laddar upp ett CV – filen hamnar under CV på deltagarkortet, och loggen har id, slag och typ men aldrig filnamnet", async () => {
    const before = (await files(amira()))!;
    expect(before.groups.map((g) => [g.label, g.files.length])).toEqual([["CV", 1], ["Personligt brev", 1], ["Betyg och intyg", 1], ["Övrigt", 0]]);
    const id = await upload(amira());
    expect(rt.raw().get("case_attachments", id)).toMatchObject({
      kind: "participant", category: "cv", caseId: NADIA, uploadedBy: "u-amira", status: "uploaded", storagePath: `c-bot/${id}.pdf`, linkedAt: expect.any(String),
    });
    const after = (await files(amira()))!;
    const cv = after.groups.find((g) => g.category === "cv")!;
    // Nyaste först: den nya filen före testdatats CV.
    expect(cv.files.map((f) => f.id)).toEqual([id, "att-seed-nadia-cv"]);
    expect(cv.files[0]).toMatchObject({ fileName: FILE_NAME, categoryLabel: "CV", uploadedByName: "Amira Haddad", sizeText: "1 kB", canRemove: true });
    expect(after).toMatchObject({ count: before.count + 1, maxFiles: PARTICIPANT_FILE_MAX_FILES, uploadBlocked: null });
    expect(after.help).toBe("PDF, Word eller bild, högst 10 MB. Filerna syns bara för Miljonbemanning – aldrig för kommunen.");
    const logs = rt.raw().all("audit_log").filter((l) => l.entityId === id);
    expect(logs.map((l) => [l.action, l.details])).toEqual([
      ["attachment.upload_started", { caseId: NADIA, fileKind: "participant", fileCategory: "cv", mimeType: "application/pdf", bytes: PDF.byteLength }],
      ["attachment.uploaded", { caseId: NADIA, fileKind: "participant", fileCategory: "cv", mimeType: "application/pdf", bytes: PDF.byteLength }],
    ]);
    expect(JSON.stringify(rt.raw().all("audit_log"))).not.toMatch(/Samira|Testsson|CV Samira/);
  });

  it("samordnare, avtalsansvarig och alla coacher i avtalet (beslut 2026-10-09) – aldrig ekonom, chef, admin, kommunen eller den vilande rollen handledare", async () => {
    for (const a of [sara(), johan(), erik()]) expect(rt.raw().get("case_attachments", await upload(a)), a.userId).toMatchObject({ uploadedBy: a.userId });
    for (const a of [as("u-lars", "ekonom"), as("u-karin", "chef"), as("u-robin", "admin"), maria(), dormantSupervisor()]) {
      await expect(run(participantFileStart, { caseId: NADIA, category: "cv", fileName: "x.pdf", mimeType: "application/pdf", bytes: 10 }, a), a.role).rejects.toBeInstanceOf(ApiError);
      // Översikt (där kortet Filer följer med): rollen nekas, ser inte fliken (null) eller får files null – aldrig ett filnamn.
      const o = await q<CaseOverview | null>(caseOverview.key, { caseId: NADIA }, a).catch((e: unknown) => (e instanceof ApiError ? null : Promise.reject(e)));
      expect(o?.files ?? null, a.role).toBeNull();
      expect(JSON.stringify(o), a.role).not.toMatch(/CV truckförare|Personligt brev lager|att-seed-nadia/);
    }
    // Deltagarkortet visar kortet Filer bara för dem som får läsa filerna (chef och admin ser kortet i läsläge utan filer).
    for (const [a, shown] of [[amira(), true], [sara(), true], [johan(), true], [as("u-karin", "chef"), false], [as("u-robin", "admin"), false]] as const) {
      expect(((await q<CaseCard>(caseCard.key, { caseId: NADIA }, a)) as CaseCard).files, a.role).toBe(shown);
    }
  });

  it("ärendets status: bekräftat, pågående, pausat och avslutat – inte innan beställningen är bekräftad och inte i en avböjd", async () => {
    const tryIn = async (status: CaseStatus) => {
      rt.store.updateRow("cases", NADIA, { status });
      return run(participantFileStart, { caseId: NADIA, category: "ovrigt", fileName: "x.pdf", mimeType: "application/pdf", bytes: PDF.byteLength }, amira());
    };
    for (const s of ["confirmed", "active", "paused", "closed"] as const) expect((await tryIn(s)).ok, s).toBe(true);
    expect(await tryIn("received")).toMatchObject({ ok: false, error: "wrong_status", message: "Filer kan laddas upp när beställningen är bekräftad." });
    expect(await tryIn("acknowledged")).toMatchObject({ ok: false, error: "wrong_status" });
    expect(await tryIn("declined")).toMatchObject({ ok: false, error: "wrong_status", message: "Beställningen är avböjd. Det går inte att ladda upp filer." });
    // Kortet säger varför – filerna visas och kan öppnas och tas bort ändå.
    expect((await files(amira()))!).toMatchObject({ uploadBlocked: "Beställningen är avböjd. Det går inte att ladda upp filer.", count: 3 });
  });

  it("typen krävs; filtyp, storlek och filsignatur som bilagorna", async () => {
    const base = { caseId: NADIA, fileName: "cv.pdf", mimeType: "application/pdf", bytes: 100 };
    await expect(run(participantFileStart, { ...base, category: "intyg" as never }, amira())).rejects.toBeInstanceOf(ApiError);
    expect(await run(participantFileStart, { ...base, category: "cv", fileName: "cv.zip", mimeType: "application/zip" }, amira())).toMatchObject({ ok: false, error: "invalid" });
    expect(await run(participantFileStart, { ...base, category: "cv", bytes: 10 * 1024 * 1024 + 1 }, amira())).toMatchObject({ ok: false, error: "invalid", message: "Filen är större än 10 MB." });
    // En fil som utger sig för att vara PDF raderas och loggas som avvisad.
    const s = await run(participantFileStart, { ...base, category: "cv" }, amira());
    if (!s.ok) throw new Error(s.error);
    expect(await run(participantFileDone, { attachmentId: s.attachmentId, contentBase64: bytesToBase64(new TextEncoder().encode("<html>x</html>")) }, amira())).toMatchObject({ ok: false, error: "invalid" });
    expect(rt.raw().get("case_attachments", s.attachmentId)).toMatchObject({ status: "deleted", deleteReason: "invalid" });
    expect(rt.raw().all("audit_log").at(-1)).toMatchObject({ action: "attachment.rejected", entityId: s.attachmentId, details: { fileKind: "participant", fileCategory: "cv" } });
    // Word (.doc i det gamla formatet, filsignaturen kontrolleras) och bild går bra.
    const DOC = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const d = await run(participantFileStart, { caseId: NADIA, category: "personligt_brev", fileName: "brev.doc", mimeType: "application/msword", bytes: DOC.byteLength }, amira());
    if (!d.ok) throw new Error(d.error);
    expect(await run(participantFileDone, { attachmentId: d.attachmentId, contentBase64: bytesToBase64(DOC) }, amira())).toMatchObject({ ok: true, file: { categoryLabel: "Personligt brev" } });
  });

  it("den som laddade upp gör filen klar – inte någon annan, och bilagaKlar rör aldrig en deltagarfil", async () => {
    const s = await run(participantFileStart, { caseId: NADIA, category: "cv", fileName: "cv.pdf", mimeType: "application/pdf", bytes: PDF.byteLength }, amira());
    if (!s.ok) throw new Error(s.error);
    expect(await run(participantFileDone, { attachmentId: s.attachmentId, contentBase64: bytesToBase64(PDF) }, sara())).toMatchObject({ ok: false, error: "not_found" });
    expect(await run(attachmentDone, { attachmentId: s.attachmentId, contentBase64: bytesToBase64(PDF) }, sara())).toMatchObject({ ok: false, error: "not_found" });
    expect(rt.raw().get("case_attachments", s.attachmentId)).toMatchObject({ status: "pending" });
  });

  it(`högst ${PARTICIPANT_FILE_MAX_FILES} filer per deltagare – räknat skilt från beställningens bilagor`, async () => {
    const seeded = SEED_PARTICIPANT_FILES.filter((f) => f.caseId === NADIA).length;
    for (let i = seeded; i < PARTICIPANT_FILE_MAX_FILES; i++) await upload(amira(), NADIA, "ovrigt", `fil-${i}.pdf`);
    const fullText = `Deltagaren har ${PARTICIPANT_FILE_MAX_FILES} filer, vilket är det högsta antalet. Ta bort en fil som inte behövs för att ladda upp en ny.`;
    expect(await run(participantFileStart, { caseId: NADIA, category: "cv", fileName: "en-till.pdf", mimeType: "application/pdf", bytes: 10 }, amira())).toMatchObject({
      ok: false, error: "too_many", message: fullText,
    });
    // Kortet säger samma sak (och visar då inte Ladda upp fil).
    expect((await files(amira()))!).toMatchObject({ count: PARTICIPANT_FILE_MAX_FILES, fullText });
    // Beställningens bilagor har sin egen gräns: samordnaren kan fortfarande bifoga en bilaga till beställningen.
    expect((await run(attachmentStart, { caseId: NADIA, fileName: "kartlaggning.pdf", mimeType: "application/pdf", bytes: 10 }, sara())).ok).toBe(true);
    // Tar man bort en fil går det att ladda upp igen.
    const one = (await files(amira()))!.groups.find((g) => g.category === "ovrigt")!.files[0];
    expect(await run(participantFileRemove, { attachmentId: one.id }, amira())).toEqual({ ok: true });
    expect((await run(participantFileStart, { caseId: NADIA, category: "cv", fileName: "en-till.pdf", mimeType: "application/pdf", bytes: 10 }, amira())).ok).toBe(true);
  });

  it("en påbörjad uppladdning räknas likadant i kortet och i kontrollen – den som tas bort efter ett fel eller är äldre än 2 timmar räknas inte (granskningen 2026-10-29)", async () => {
    const seeded = SEED_PARTICIPANT_FILES.filter((f) => f.caseId === NADIA).length;
    for (let i = seeded; i < PARTICIPANT_FILE_MAX_FILES - 1; i++) await upload(amira(), NADIA, "ovrigt", `fil-${i}.pdf`);
    expect((await files(amira()))!).toMatchObject({ count: PARTICIPANT_FILE_MAX_FILES - 1, fullText: null });
    // En uppladdning som börjar men aldrig blir klar (t.ex. att lagringen svarade med fel eller att webbläsaren stängdes).
    const s = await run(participantFileStart, { caseId: NADIA, category: "cv", fileName: "avbruten.pdf", mimeType: "application/pdf", bytes: 10 }, amira());
    if (!s.ok) throw new Error(s.error);
    // Kortet och kontrollen är överens: knappen visas inte, och den som ändå försöker får samma förklaring.
    const card = (await files(amira()))!;
    expect(card.count).toBe(PARTICIPANT_FILE_MAX_FILES - 1);
    expect(card.fullText).toMatch(/^Deltagaren har 29 filer och en uppladdning som inte är klar\./);
    expect(await run(participantFileStart, { caseId: NADIA, category: "cv", fileName: "en-till.pdf", mimeType: "application/pdf", bytes: 10 }, erik())).toMatchObject({
      ok: false, error: "too_many", message: card.fullText,
    });
    // Dialogen tar bort den påbörjade uppladdningen när ett steg misslyckas – då går det att ladda upp igen direkt.
    expect(await run(participantFileRemove, { attachmentId: s.attachmentId }, amira())).toEqual({ ok: true });
    expect(rt.raw().get("case_attachments", s.attachmentId)).toMatchObject({ status: "deleted", deleteReason: "removed", removedBy: "u-amira" });
    expect((await files(amira()))!.fullText).toBeNull();
    // Stängdes webbläsaren i stället räknas den bara så länge uppladdningsadressen gäller (2 timmar).
    const t = await run(participantFileStart, { caseId: NADIA, category: "cv", fileName: "stangd.pdf", mimeType: "application/pdf", bytes: 10 }, amira());
    if (!t.ok) throw new Error(t.error);
    expect((await files(amira()))!.fullText).not.toBeNull();
    rt.clock.set(addMinutes(rt.clock.now(), 120));
    expect((await files(amira()))!.fullText).toBeNull();
    expect((await run(participantFileStart, { caseId: NADIA, category: "cv", fileName: "ny.pdf", mimeType: "application/pdf", bytes: 10 }, amira())).ok).toBe(true);
  });

  it("vilande spärr för skyddade personuppgifter: en annan coach än den namngivna får inte filerna", async () => {
    rt.store.updateRow("persons", rt.raw().get("cases", NADIA)!.personId, { protectedIdentity: true });
    expect(await files(erik())).toBeNull();
    expect(await run(participantFileStart, { caseId: NADIA, category: "cv", fileName: "x.pdf", mimeType: "application/pdf", bytes: 10 }, erik())).toMatchObject({ ok: false });
    // Huvudcoachen (Amira) och avtalsansvarig har kvar åtkomsten.
    expect((await files(amira()))!.count).toBe(3);
    expect((await files(johan()))!.count).toBe(3);
  });
});

describe("hämta och ta bort", () => {
  it("hämta (arenden.bilagaHamta): Miljonbemanning får filen, kommunen aldrig – inte heller handläggaren som beställde; varje öppning loggas utan filnamn", async () => {
    const id = await upload(amira());
    for (const a of [amira(), erik(), sara(), johan()]) {
      expect(await run(attachmentDownload, { attachmentId: id }, a), a.userId).toMatchObject({ ok: true, url: null, fileName: FILE_NAME, mimeType: "application/pdf", contentBase64: bytesToBase64(PDF) });
    }
    expect(await run(attachmentDownload, { attachmentId: id }, maria())).toMatchObject({ ok: false, error: "not_found" });
    expect(await run(attachmentDownload, { attachmentId: "att-seed-nadia-cv" }, maria())).toMatchObject({ ok: false, error: "not_found" });
    for (const a of [as("u-lars", "ekonom"), as("u-karin", "chef"), as("u-robin", "admin")]) {
      await expect(run(attachmentDownload, { attachmentId: id }, a), a.role).rejects.toBeInstanceOf(ApiError);
    }
    const views = rt.raw().all("audit_log").filter((l) => l.action === "attachment.viewed");
    expect(views.map((l) => l.actorId)).toEqual(["u-amira", "u-erik", "u-sara", "u-johan"]);
    expect(views[0].details).toEqual({ attachmentId: id, caseId: NADIA, fileKind: "participant", fileCategory: "cv" });
    expect(JSON.stringify(views)).not.toMatch(/Samira|Testsson/);
    // Testdatats filer saknar innehåll i minnet – prototypen ger en textfil som förklarar varför.
    expect(await run(attachmentDownload, { attachmentId: "att-seed-nadia-cv" }, amira())).toMatchObject({ ok: true, fileName: "CV truckförare januari 2027.pdf.txt" });
  });

  it("ta bort: när som helst – också under en pågående insats – av samordnare, avtalsansvarig och coach; spåret finns kvar", async () => {
    expect(rt.raw().get("cases", NADIA)!.status).toBe("active");
    const id = await upload(amira());
    expect(await run(participantFileRemove, { attachmentId: id }, erik())).toEqual({ ok: true });
    expect(rt.raw().get("case_attachments", id)).toMatchObject({ status: "deleted", deleteReason: "removed", removedBy: "u-erik" });
    expect(rt.attachments.stored()).toBe(0);
    expect((await files(amira()))!.groups.find((g) => g.category === "cv")!.files.map((f) => f.id)).toEqual(["att-seed-nadia-cv"]);
    expect(await run(attachmentDownload, { attachmentId: id }, amira())).toMatchObject({ ok: false, error: "not_found" });
    expect(rt.raw().all("audit_log").filter((l) => l.action === "attachment.removed").pop()).toMatchObject({ entityId: id, details: { caseId: NADIA, fileKind: "participant", fileCategory: "cv" } });
    // Testdatats filer – samordnaren och avtalsansvarig.
    expect(await run(participantFileRemove, { attachmentId: "att-seed-nadia-brev" }, sara())).toEqual({ ok: true });
    expect(await run(participantFileRemove, { attachmentId: "att-seed-nadia-truck" }, johan())).toEqual({ ok: true });
    // En borttagen fil kan inte tas bort igen.
    expect(await run(participantFileRemove, { attachmentId: id }, amira())).toMatchObject({ ok: false, error: "not_found" });
    // Ekonom, chef, admin och kommunen: rollkontrollen.
    for (const a of [as("u-lars", "ekonom"), as("u-karin", "chef"), as("u-robin", "admin"), maria()]) {
      await expect(run(participantFileRemove, { attachmentId: "att-seed-nadia-cv" }, a), a.role).rejects.toBeInstanceOf(ApiError);
    }
  });

  it("två samtidiga borttagningar av samma fil: en tar bort och loggar, den andra får \"finns inte\" (granskningen 2026-10-29)", async () => {
    const id = await upload(amira());
    const [a, b] = await Promise.all([run(participantFileRemove, { attachmentId: id }, amira()), run(participantFileRemove, { attachmentId: id }, sara())]);
    expect([a.ok, b.ok]).toEqual([true, false]);
    expect(b).toMatchObject({ ok: false, error: "not_found" });
    const removed = rt.raw().all("audit_log").filter((l) => l.action === "attachment.removed" && l.entityId === id);
    expect(removed.map((l) => l.actorId)).toEqual(["u-amira"]);
    expect(rt.raw().get("case_attachments", id)).toMatchObject({ status: "deleted", removedBy: "u-amira" });
    // Samma för beställningens bilagor (avslutat ärende – samordnaren och avtalsansvarig samtidigt).
    rt.store.updateRow("cases", NADIA, { status: "closed", endDate: "2027-02-01", closedAt: "2027-02-01T10:00" });
    const s = await run(attachmentStart, { caseId: NADIA, fileName: "kartlaggning.pdf", mimeType: "application/pdf", bytes: PDF.byteLength }, sara());
    if (!s.ok) throw new Error(s.error);
    expect(await run(attachmentDone, { attachmentId: s.attachmentId, contentBase64: bytesToBase64(PDF) }, sara())).toMatchObject({ ok: true });
    const [c, d] = await Promise.all([run(attachmentRemove, { attachmentId: s.attachmentId }, sara()), run(attachmentRemove, { attachmentId: s.attachmentId }, johan())]);
    expect([c.ok, d.ok]).toEqual([true, false]);
    expect(rt.raw().all("audit_log").filter((l) => l.action === "attachment.removed" && l.entityId === s.attachmentId)).toHaveLength(1);
  });

  it("beställningens kommandon och deltagarfilernas hålls isär: bilagaTaBort tar aldrig bort en deltagarfil, deltagarfilTaBort aldrig en bilaga", async () => {
    // Avslutat ärende: samordnaren får ta bort beställningens bilagor – men inte en deltagarfil med bilagornas kommando.
    rt.store.updateRow("cases", NADIA, { status: "closed", endDate: "2027-02-01", closedAt: "2027-02-01T10:00" });
    expect(await run(attachmentRemove, { attachmentId: "att-seed-nadia-cv" }, sara())).toMatchObject({ ok: false, error: "not_found" });
    const s = await run(attachmentStart, { caseId: NADIA, fileName: "kartlaggning.pdf", mimeType: "application/pdf", bytes: PDF.byteLength }, sara());
    if (!s.ok) throw new Error(s.error);
    expect(await run(attachmentDone, { attachmentId: s.attachmentId, contentBase64: bytesToBase64(PDF) }, sara())).toMatchObject({ ok: true });
    expect(await run(participantFileRemove, { attachmentId: s.attachmentId }, sara())).toMatchObject({ ok: false, error: "not_found" });
    expect(rt.raw().get("case_attachments", "att-seed-nadia-cv")).toMatchObject({ status: "uploaded" });
    expect(rt.raw().get("case_attachments", s.attachmentId)).toMatchObject({ status: "uploaded", kind: "order" });
  });
});

describe("kommunen och allt annat får aldrig deltagarfilerna", () => {
  // Samma exempel som src/api/invalidation.test.ts – varje fråga i kommunens portal, som Maria (som beställde Nadias insats).
  const KOMMUN_SAMPLES: Record<string, unknown> = {
    "kommun.start": {}, "kommun.bestallning": {}, "kommun.dubblett": { pnr: "19900101-1234" }, "kommun.kvitto": { caseId: NADIA }, "kommun.deltagareLista": {},
    "kommun.deltagare": { caseId: NADIA }, "kommun.rapporter": {}, "kommun.profil": {}, "kommun.dictationOptions": { caseId: NADIA }, "kommun.dictationState": { aiRunId: "ai-run-mehmet" },
  };

  it("ingen fråga i kommunens portal returnerar en deltagarfil – id, filnamn eller typ", async () => {
    const id = await upload(amira());
    const keys = (Object.values(kommunApi) as unknown[])
      .filter((v): v is { kind: "query"; key: string } => !!v && typeof v === "object" && (v as { kind?: unknown }).kind === "query")
      .map((v) => v.key)
      .sort();
    // En ny fråga i portalen måste läggas till här (och prövas).
    expect(keys).toEqual(Object.keys(KOMMUN_SAMPLES).sort());
    const secret = [id, FILE_NAME, ...SEED_PARTICIPANT_FILES.flatMap((f) => [f.id, f.fileName]), "personligt_brev", "betyg_intyg", "Personligt brev"];
    for (const key of keys) {
      const res = JSON.stringify(await q(key, KOMMUN_SAMPLES[key], maria()));
      for (const s of secret) expect(res.includes(s), `${key}: ${s}`).toBe(false);
    }
  });

  it("bakgrunden från beställningen (deltagarkortet och acceptdialogen i inkorgen) visar bara beställningens bilagor", async () => {
    await upload(amira());
    const card = (await q<CaseCard>(caseCard.key, { caseId: NADIA }, sara())) as CaseCard;
    expect(card.background!.attachments.map((a) => a.fileName)).not.toContain(FILE_NAME);
    expect(JSON.stringify(card.background)).not.toMatch(/att-seed-|CV truckförare/);
    // Acceptdialogen: ett ärende som väntar på beslut får en deltagarfil (kan inte hända – uppladdning kräver bekräftat ärende).
    const waiting = rt.raw().all("cases").find((c) => c.status === "acknowledged")!;
    rt.store.insertRow("case_attachments", { ...SEED_PARTICIPANT_FILES[0], id: "att-x-vantande", caseId: waiting.id, storagePath: "c-bot/att-x-vantande.pdf" });
    const form = await q<{ background?: { attachments: { id: string }[] } } | null>("inkorg.decisionForm", { caseId: waiting.id }, sara());
    expect(JSON.stringify(form)).not.toContain("att-x-vantande");
  });

  it("bara bilagornas egna moduler når tabellen och lagringen – aldrig AI, rapporter, resultatfil, export eller faktura", () => {
    const root = join(__dirname, "..", "..");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
    });
    const touching = walk(root)
      .filter((f) => /"case_attachments"|requireAttachments\(|ctx\.attachments|caseBackground\(/.test(readFileSync(f, "utf8")))
      .map((f) => relative(join(root, ".."), f).replace(/\\/g, "/"))
      .sort();
    expect(touching).toEqual([
      "src/api/server.ts", // Ctx.attachments (typen)
      "src/data/memory-runtime.ts", // porten i minnesläget
      "src/data/policy.ts", // läsregeln (RLS-spegeln)
      "src/data/schema.ts",
      "src/features/_shared/attachment-port.ts",
      "src/features/_shared/attachment-retention.ts", // städningen
      "src/features/arenden/attachment-handlers.ts", // bilagorna till beställningen
      "src/features/arenden/background.ts", // bakgrunden – bara kind order
      "src/features/arenden/handlers.ts", // beställningens bilagor kopplas och bakgrunden i kortet
      "src/features/arenden/order.ts", // kopplingen när beställningen skapas
      "src/features/arenden/participant-file-handlers.ts", // filerna på deltagarkortet
      "src/features/inkorg/register-handlers.ts", // beställningens bilagor vid registreringen
      "src/features/inkorg/views.ts", // acceptdialogens bakgrund (caseBackground – bara kind order)
      "src/server/attachments/index.ts",
      "src/server/attachments/storage.ts",
      "src/server/inbox/import.ts", // mejlets bilagor (kind order)
    ]);
  });
});

describe("städningen (jobbet attachments_retention)", () => {
  const sysCtx = (audits: { action: string; details: Record<string, unknown> }[]): Ctx => ({
    actor: SYSTEM_ACTOR, now: () => rt.clock.now(), repo: new MemoryRepo<Tables>(rt.store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo,
    system: new MemoryRepo<Tables>(rt.store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo, newId: (p) => `${p}-g`,
    audit: async (e) => void audits.push({ action: e.action, details: e.details ?? {} }), notify: async () => undefined, crypto: TEST_PNR_CRYPTO, attachments: rt.attachments,
  });

  it("deltagarfiler i ett ärende gallras aldrig automatiskt – inte heller år efter avslutet; avstämningen behåller deras filer", async () => {
    const id = await upload(amira());
    rt.store.updateRow("cases", NADIA, { status: "closed", endDate: "2027-02-02", closedAt: "2027-02-02T10:00" });
    const audits: { action: string; details: Record<string, unknown> }[] = [];
    rt.clock.set("2030-01-01T10:00");
    expect(await runAttachmentRetention(sysCtx(audits))).toEqual({ unlinked: 0, unconfirmed: 0, orphans: 0 });
    expect(rt.raw().get("case_attachments", id)).toMatchObject({ status: "uploaded" });
    for (const f of SEED_PARTICIPANT_FILES) expect(rt.raw().get("case_attachments", f.id), f.id).toMatchObject({ status: "uploaded" });
    expect(rt.attachments.stored()).toBe(1);
    expect(audits).toEqual([]);
  });

  it("en uppladdning som aldrig blev klar (pending) raderas efter 24 timmar – loggas med id och ärende, aldrig filnamnet", async () => {
    const s = await run(participantFileStart, { caseId: NADIA, category: "cv", fileName: FILE_NAME, mimeType: "application/pdf", bytes: PDF.byteLength }, amira());
    if (!s.ok) throw new Error(s.error);
    const audits: { action: string; details: Record<string, unknown> }[] = [];
    expect(await runAttachmentRetention(sysCtx(audits))).toEqual({ unlinked: 0, unconfirmed: 0, orphans: 0 });
    rt.clock.set("2027-02-02T10:00");
    expect(await runAttachmentRetention(sysCtx(audits))).toEqual({ unlinked: 0, unconfirmed: 1, orphans: 0 });
    expect(rt.raw().get("case_attachments", s.attachmentId)).toMatchObject({ status: "deleted", deleteReason: "invalid" });
    expect(audits).toEqual([{ action: "attachment.deleted", details: { caseId: NADIA, reason: "unconfirmed_24h", fileKind: "participant", fileCategory: "cv" } }]);
    expect(JSON.stringify(audits)).not.toMatch(/Samira|Testsson/);
    // Den raderade raden räknas inte längre mot högsta antalet.
    expect(rt.raw().all("case_attachments").filter((x) => x.caseId === NADIA && x.kind === "participant" && x.status !== "deleted")).toHaveLength(3);
  });
});

describe("Historik på deltagarkortet (granskningen 2026-10-29)", () => {
  const history = async (actor: Actor) => ((await q<CaseHistory | null>(caseHistory.key, { caseId: NADIA }, actor))!).log;
  let seq = 0;
  const sysCtx = (): Ctx => ({
    actor: SYSTEM_ACTOR, now: () => rt.clock.now(), repo: new MemoryRepo<Tables>(rt.store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo,
    system: new MemoryRepo<Tables>(rt.store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo, newId: (p) => `${p}-h`,
    audit: async (e) => void rt.store.insertRow("audit_log", {
      id: `log-h-${++seq}`, occurredAt: rt.clock.now(), actorId: SYSTEM_ACTOR.userId, action: e.action, entity: e.entity, entityId: e.entityId, contractId: e.contractId ?? null, details: e.details ?? {},
    }),
    notify: async () => undefined, crypto: TEST_PNR_CRYPTO, attachments: rt.attachments,
  });

  it("filhändelserna står på svenska – aldrig koder som attachment.uploaded eller unconfirmed_24h, och aldrig filnamnet", async () => {
    const id = await upload(amira());
    expect((await run(attachmentDownload, { attachmentId: id }, amira())).ok).toBe(true);
    expect(await run(participantFileRemove, { attachmentId: id }, amira())).toEqual({ ok: true });
    // En uppladdning som aldrig blev klar och som städningen raderar efter 24 timmar.
    const s = await run(participantFileStart, { caseId: NADIA, category: "betyg_intyg", fileName: FILE_NAME, mimeType: "application/pdf", bytes: 10 }, amira());
    if (!s.ok) throw new Error(s.error);
    rt.clock.set("2027-02-03T10:00");
    expect(await runAttachmentRetention(sysCtx())).toMatchObject({ unconfirmed: 1 });

    // Revisionsloggens poster i Historik ser bara chef och admin (policy.ts audit_log).
    for (const actor of [as("u-karin", "chef"), as("u-robin", "admin")]) {
      const log = (await history(actor)).filter((l) => /fil/i.test(l.text));
      const texts = log.map((l) => l.text);
      expect(texts, actor.role).toEqual(expect.arrayContaining([
        "Började ladda upp en fil på deltagarkortet", "Laddade upp en fil på deltagarkortet", "Hämtade en fil från deltagarkortet",
        "Tog bort en fil från deltagarkortet", "En fil på deltagarkortet raderades automatiskt",
      ]));
      const all = JSON.stringify(await history(actor));
      // Chef och admin ser inte filerna: att något hände står där, men aldrig filens namn eller typ.
      expect(all, actor.role).not.toMatch(/attachment\.|unconfirmed_24h|fileKind|Samira|Testsson|"CV"|Betyg och intyg/);
      expect(log.find((l) => l.text === "En fil på deltagarkortet raderades automatiskt")!.sub).toBe("uppladdningen blev aldrig klar inom 24 timmar");
      expect(log.find((l) => l.text === "Laddade upp en fil på deltagarkortet")!.sub).toBe("");
    }
  });

  it("beställningens bilagor har också svenska texter i Historik", async () => {
    rt.store.updateRow("cases", NADIA, { status: "closed", endDate: "2027-02-01", closedAt: "2027-02-01T10:00" });
    const s = await run(attachmentStart, { caseId: NADIA, fileName: "kartlaggning.pdf", mimeType: "application/pdf", bytes: PDF.byteLength }, sara());
    if (!s.ok) throw new Error(s.error);
    expect(await run(attachmentDone, { attachmentId: s.attachmentId, contentBase64: bytesToBase64(PDF) }, sara())).toMatchObject({ ok: true });
    expect(await run(attachmentRemove, { attachmentId: s.attachmentId }, sara())).toEqual({ ok: true });
    const texts = (await history(as("u-karin", "chef"))).map((l) => l.text);
    expect(texts).toEqual(expect.arrayContaining(["Började ladda upp en bilaga", "Laddade upp en bilaga", "Tog bort en bilaga"]));
    expect(texts.filter((t) => t.startsWith("attachment."))).toEqual([]);
  });
});
