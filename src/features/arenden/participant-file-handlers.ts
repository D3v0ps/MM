// Hanterare: filer på deltagarkortet – CV, personligt brev, betyg och intyg (Karims beslut 2026-10-29, 0037). Registreras via
// arenden/handlers.ts. "Vi vill kunna ladda upp filer på deltagares profiler. Typ CVn o så." – bara Miljonbemanning.
//   Vem:     samordnare, avtalsansvarig och coach med full åtkomst till ärendet (PARTICIPANT_FILE_ROLES – samma som läsrätten
//            i RLS case_attachments_select och policy.ts). Ekonom, chef, admin och kommunen nekas av rollkontrollen; kommunen
//            läser aldrig raderna (kind participant), inte heller handläggaren som beställde.
//   När:     uppladdning i bekräftade, pågående, pausade och avslutade ärenden (participantFileUploadOpen); öppna och ta bort
//            när som helst – deltagarfilerna gallras aldrig automatiskt (samma beslut som bilagorna, beslut 5 2026-10-08).
//   Antal:   högst PARTICIPANT_FILE_MAX_FILES per ärende, räknat skilt från beställningens bilagor (plattformsregel).
//   Lagring: porten (ctx.attachments, service role) – samma bucket, filtyper, storlek och filsignatur som bilagorna.
//   Öppna:   arenden.bilagaHamta (attachment-handlers.ts) – signerad adress i 60 sekunder, loggas attachment.viewed.
//   Logg:    id:n, slag (fileKind), typ (fileCategory), filtyp och storlek – aldrig filnamnet (CLAUDE.md punkt 2).
import { fail, ok } from "@/api/contract";
import { ApiError, handleCommand, handleQuery, type Ctx } from "@/api/server";
import { caseAccessIn } from "@/core/access";
import {
  ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES_TEXT, fileSizeText, groupParticipantFiles, PARTICIPANT_FILE_CATEGORY_LABEL, PARTICIPANT_FILE_HELP,
  PARTICIPANT_FILE_MAX_FILES, PARTICIPANT_FILE_ROLES, participantFileUploadBlocked,
} from "@/core/attachments";
import { base64ToBytes } from "@/core/export/base64";
import { PARTICIPANT_FILE_CATEGORIES, type Case, type CaseAttachment } from "@/data/schema";
import { requireAttachments } from "../_shared/attachment-port";
import { accessSourceFor } from "../rapporter/load";
import { caseFiles, participantFileDone, participantFileRemove, participantFileStart, type CaseFiles, type ParticipantFileRow } from "./api";

const CASE_NOT_FOUND = "Ärendet finns inte, eller så har du inte behörighet att se det.";
const FILE_NOT_FOUND = "Filen finns inte, eller så har du inte behörighet att se den.";

/** Ärendet med full åtkomst (läst via behörigheten), eller null. */
async function fullCase(ctx: Ctx, caseId: string | null): Promise<{ c: Case | null; full: boolean }> {
  const c = caseId ? await ctx.repo.table("cases").get(caseId) : null;
  if (!c) return { c: null, full: false };
  return { c, full: caseAccessIn(c, ctx.actor, await accessSourceFor(ctx, [c])) === "full" };
}

/** Raderna i kortet. Uppladdarens namn läses via behörigheten (namn som läsaren inte får se blir "–"). */
async function fileRows(ctx: Ctx, rows: readonly CaseAttachment[]): Promise<ParticipantFileRow[]> {
  const files = rows.filter((a) => a.kind === "participant" && a.status === "uploaded" && !!a.category);
  if (!files.length) return [];
  const ids = [...new Set(files.map((a) => a.uploadedBy))];
  const profiles = await ctx.repo.table("profiles").list({ id: { in: ids } });
  const name = new Map(profiles.map((p) => [p.id, p.fullName]));
  return files.map((a) => {
    const category = a.category!;
    return {
      id: a.id, fileName: a.fileName, mimeType: a.mimeType, bytes: a.bytes, sizeText: fileSizeText(a.bytes), uploadedByName: name.get(a.uploadedBy) ?? "–",
      createdAt: a.createdAt, category, categoryLabel: PARTICIPANT_FILE_CATEGORY_LABEL[category],
      // Den som ser filerna får ta bort dem – när som helst (rollen och full åtkomst är redan kontrollerade).
      canRemove: true,
    };
  });
}

// ---------------------------------------------------------------- arenden.kortFiler
handleQuery(caseFiles, { roles: PARTICIPANT_FILE_ROLES }, async (ctx, p): Promise<CaseFiles | null> => {
  const { c, full } = await fullCase(ctx, p.caseId);
  if (!c || !full) return null;
  const rows = await ctx.repo.table("case_attachments").list({ caseId: c.id, kind: "participant", status: "uploaded" });
  const files = await fileRows(ctx, rows);
  return {
    groups: groupParticipantFiles(files),
    count: files.length,
    maxFiles: PARTICIPANT_FILE_MAX_FILES,
    uploadBlocked: participantFileUploadBlocked(c.status),
    categories: PARTICIPANT_FILE_CATEGORIES.map((value) => ({ value, label: PARTICIPANT_FILE_CATEGORY_LABEL[value] })),
    accept: ATTACHMENT_ACCEPT,
    typesText: ATTACHMENT_TYPES_TEXT,
    maxBytes: ATTACHMENT_MAX_BYTES,
    help: PARTICIPANT_FILE_HELP,
  };
});

// ---------------------------------------------------------------- arenden.deltagarfilStart
handleCommand(participantFileStart, { roles: PARTICIPANT_FILE_ROLES }, async (ctx, p) => {
  const { c, full } = await fullCase(ctx, p.caseId);
  if (!c) return fail("not_found", CASE_NOT_FOUND);
  if (!full) return fail("forbidden", "Du kan inte ladda upp filer i det här ärendet.");
  const blocked = participantFileUploadBlocked(c.status);
  if (blocked) return fail("wrong_status", blocked);
  // Antalet deltagarfiler i ärendet (också påbörjade) – läsaren har full åtkomst och ser alla.
  const n = await ctx.repo.table("case_attachments").count({ caseId: c.id, kind: "participant", status: { neq: "deleted" } });
  if (n >= PARTICIPANT_FILE_MAX_FILES) return fail("too_many", `Högst ${PARTICIPANT_FILE_MAX_FILES} filer per deltagare. Ta bort en fil som inte behövs först.`);
  try {
    const t = await requireAttachments(ctx).createUpload({
      contractId: c.contractId, caseId: c.id, ownerId: ctx.actor.userId, kind: "participant", category: p.category, fileName: p.fileName, mimeType: p.mimeType, bytes: p.bytes,
    });
    const row = await ctx.system.table("case_attachments").get(t.attachmentId);
    await ctx.audit({
      action: "attachment.upload_started", entity: "case_attachment", entityId: t.attachmentId, contractId: c.contractId,
      details: { caseId: c.id, fileKind: "participant", fileCategory: p.category, mimeType: row?.mimeType ?? null, bytes: p.bytes },
    });
    return ok({ attachmentId: t.attachmentId, uploadUrl: t.uploadUrl, token: t.token, maxBytes: t.maxBytes });
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) return fail("invalid", e.message);
    throw e;
  }
});

// ---------------------------------------------------------------- arenden.deltagarfilKlar
handleCommand(participantFileDone, { roles: PARTICIPANT_FILE_ROLES }, async (ctx, p) => {
  // Bara den egna uppladdningen (läst via behörigheten: full åtkomst till ärendet).
  const a = await ctx.repo.table("case_attachments").get(p.attachmentId);
  if (!a || a.kind !== "participant" || a.uploadedBy !== ctx.actor.userId) return fail("not_found", FILE_NOT_FOUND);
  let content: Uint8Array | null = null;
  // Innehållet skickas bara med i minnesläget och prototypen (servern läser filen ur lagringen).
  if (p.contentBase64) {
    try {
      content = base64ToBytes(p.contentBase64);
    } catch {
      return fail("invalid", "Filen kunde inte läsas. Försök igen.");
    }
  }
  const details = { caseId: a.caseId, fileKind: "participant", fileCategory: a.category };
  const done = await requireAttachments(ctx).confirm(a.id, content);
  if (!done) {
    await ctx.audit({ action: "attachment.rejected", entity: "case_attachment", entityId: a.id, contractId: a.contractId, details: { ...details, mimeType: a.mimeType } });
    return fail("invalid", "Filen kunde inte tas emot. Kontrollera att den är en PDF, ett Word-dokument eller en bild och högst 10 MB.");
  }
  await ctx.audit({ action: "attachment.uploaded", entity: "case_attachment", entityId: a.id, contractId: a.contractId, details: { ...details, mimeType: done.mimeType, bytes: done.bytes } });
  const [file] = await fileRows(ctx, [done]);
  return ok({ file });
});

// ---------------------------------------------------------------- arenden.deltagarfilTaBort
// När som helst – också i ett pågående ärende (till skillnad från beställningens bilagor, som tas bort först efter avslutet).
handleCommand(participantFileRemove, { roles: PARTICIPANT_FILE_ROLES }, async (ctx, p) => {
  const a = await ctx.repo.table("case_attachments").get(p.attachmentId);
  if (!a || a.kind !== "participant") return fail("not_found", FILE_NOT_FOUND);
  const { full } = await fullCase(ctx, a.caseId);
  if (!full) return fail("forbidden", "Du kan inte ta bort den här filen.");
  await requireAttachments(ctx).remove(a.id, "removed", ctx.actor.userId);
  await ctx.audit({ action: "attachment.removed", entity: "case_attachment", entityId: a.id, contractId: a.contractId, details: { caseId: a.caseId, fileKind: "participant", fileCategory: a.category } });
  return ok({});
});
