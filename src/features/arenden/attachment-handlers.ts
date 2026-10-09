// Hanterare: bilagor till beställningen (beslut 2026-10-07, synpunkt #7 och beslut 4). Registreras via arenden/handlers.ts.
// Bakgrunden med bilagorna (caseBackground) byggs i ./background.ts – den importeras av flera områden utan att registrera något.
// Behörigheten kontrolleras alltid först – ärendet och raderna läses via ctx.repo (policy.ts/RLS case_attachments, 0024);
// raderna skrivs bara av porten (ctx.attachments, service role). Revisionsloggen får id, typ och storlek – aldrig filnamnet.
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { ApiError, handleCommand, type Ctx } from "@/api/server";
import { caseAccessIn } from "@/core/access";
import { base64ToBytes, bytesToBase64 } from "@/core/export/base64";
import { isOperational } from "@/core/config";
import type { Contract } from "@/data/schema";
import { ATTACHMENT_MAX_FILES, requireAttachments } from "../_shared/attachment-port";
import { accessSourceFor } from "../rapporter/load";
import { attachmentDone, attachmentDownload, attachmentRemove, attachmentStart } from "./api";
import { ATTACHMENTS_REMOVED_BY_MB, attachmentsRemovable, rowsFor } from "./background";

const NOT_FOUND = "Filen finns inte, eller så har du inte behörighet att se den.";
/** Lägger till bilagor i ett ärende som redan finns (full åtkomst). */
const MB_EDITORS: readonly Role[] = ["samordnare", "avtalsansvarig"];

/** Avtalet för en ny beställning: användarens första aktiva avtal med driftkonfiguration (samma som caseCreate). */
async function orderContract(ctx: Ctx): Promise<Contract | null> {
  const all = await ctx.repo.table("contracts").list({ status: "active" });
  for (const id of ctx.actor.contractIds) {
    const c = all.find((x) => x.id === id);
    if (c && isOperational(c.config)) return c;
  }
  return null;
}

// ---------------------------------------------------------------- arenden.bilagaStart
handleCommand(attachmentStart, { roles: ["kommun_handlaggare", ...MB_EDITORS] }, async (ctx, p) => {
  const me = ctx.actor.userId;
  let contractId: string;
  if (p.caseId) {
    const c = await ctx.repo.table("cases").get(p.caseId);
    if (!c) return fail("not_found", "Ärendet finns inte, eller så har du inte behörighet att se det.");
    const access = caseAccessIn(c, ctx.actor, await accessSourceFor(ctx, [c]));
    const allowed = ctx.actor.role === "kommun_handlaggare" ? access === "customer" && c.referrerId === me : access === "full";
    if (!allowed) return fail("forbidden", "Du kan inte bifoga filer i det här ärendet.");
    // ctx.system: antalet bilagor i ärendet (bara antal) – också sådana läsaren inte ser.
    const n = await ctx.system.table("case_attachments").count({ caseId: c.id, status: { neq: "deleted" } });
    if (n >= ATTACHMENT_MAX_FILES) return fail("too_many", `Högst ${ATTACHMENT_MAX_FILES} filer per beställning.`);
    contractId = c.contractId;
  } else {
    // Kommunens handläggare i portalen, och samordnare/avtalsansvarig när de registrerar en beställning i avropsinkorgen (beslut 4a).
    const contract = await orderContract(ctx);
    if (!contract) return fail("no_contract", "Det finns inget aktivt avtal att beställa i.");
    // Egna uppladdningar som inte är skickade (via behörigheten).
    const mine = await ctx.repo.table("case_attachments").count({ uploadedBy: me, caseId: { isNull: true }, status: { neq: "deleted" } });
    if (mine >= ATTACHMENT_MAX_FILES) return fail("too_many", `Högst ${ATTACHMENT_MAX_FILES} filer per beställning.`);
    contractId = contract.id;
  }
  try {
    const t = await requireAttachments(ctx).createUpload({ contractId, caseId: p.caseId, ownerId: me, fileName: p.fileName, mimeType: p.mimeType, bytes: p.bytes });
    const row = await ctx.system.table("case_attachments").get(t.attachmentId);
    await ctx.audit({
      action: "attachment.upload_started", entity: "case_attachment", entityId: t.attachmentId, contractId,
      details: { caseId: p.caseId, mimeType: row?.mimeType ?? null, bytes: p.bytes },
    });
    return ok({ attachmentId: t.attachmentId, uploadUrl: t.uploadUrl, token: t.token, maxBytes: t.maxBytes });
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) return fail("invalid", e.message);
    throw e;
  }
});

// ---------------------------------------------------------------- arenden.bilagaKlar
handleCommand(attachmentDone, { roles: ["kommun_handlaggare", ...MB_EDITORS] }, async (ctx, p) => {
  const a = await ctx.repo.table("case_attachments").get(p.attachmentId);
  if (!a || a.uploadedBy !== ctx.actor.userId) return fail("not_found", NOT_FOUND);
  let content: Uint8Array | null = null;
  // Innehållet skickas bara med i minnesläget och prototypen (servern läser filen ur lagringen).
  if (p.contentBase64) {
    try {
      content = base64ToBytes(p.contentBase64);
    } catch {
      return fail("invalid", "Filen kunde inte läsas. Försök igen.");
    }
  }
  const done = await requireAttachments(ctx).confirm(a.id, content);
  if (!done) {
    await ctx.audit({ action: "attachment.rejected", entity: "case_attachment", entityId: a.id, contractId: a.contractId, details: { caseId: a.caseId, mimeType: a.mimeType } });
    return fail("invalid", "Filen kunde inte tas emot. Kontrollera att den är en PDF, ett Word-dokument eller en bild och högst 10 MB.");
  }
  await ctx.audit({ action: "attachment.uploaded", entity: "case_attachment", entityId: a.id, contractId: a.contractId, details: { caseId: a.caseId, mimeType: done.mimeType, bytes: done.bytes } });
  const c = done.caseId ? await ctx.repo.table("cases").get(done.caseId) : null;
  const [row] = await rowsFor(ctx, [done], c);
  return ok({ attachment: row });
});

// ---------------------------------------------------------------- arenden.bilagaTaBort
// Den egna uppladdningen innan beställningen skickats, eller Miljonbemanning (samordnare/avtalsansvarig) i ärendet – men bara
// när ärendet är avslutat eller beställningen avböjd (beslut 5, 2026-10-08). Ingen automatisk gallring av bilagor.
handleCommand(attachmentRemove, { roles: ["kommun_handlaggare", ...MB_EDITORS] }, async (ctx, p) => {
  const a = await ctx.repo.table("case_attachments").get(p.attachmentId);
  if (!a) return fail("not_found", NOT_FOUND);
  const own = !a.caseId && a.uploadedBy === ctx.actor.userId;
  let allowed = own;
  if (!allowed && a.caseId && MB_EDITORS.includes(ctx.actor.role)) {
    const c = await ctx.repo.table("cases").get(a.caseId);
    if (c && !attachmentsRemovable(c)) return fail("forbidden", ATTACHMENTS_REMOVED_BY_MB);
    allowed = !!c && caseAccessIn(c, ctx.actor, await accessSourceFor(ctx, [c])) === "full";
  }
  if (!allowed) return fail("forbidden", "Du kan inte ta bort den här filen.");
  await requireAttachments(ctx).remove(a.id, "removed", ctx.actor.userId);
  await ctx.audit({ action: "attachment.removed", entity: "case_attachment", entityId: a.id, contractId: a.contractId, details: { caseId: a.caseId } });
  return ok({});
});

// ---------------------------------------------------------------- arenden.bilagaHamta (tyst)
handleCommand(attachmentDownload, { roles: ["kommun_handlaggare", "samordnare", "avtalsansvarig", "coach"], silent: true }, async (ctx, p) => {
  // Läsrätten avgörs av behörigheten (policy.ts/RLS): uppladdaren, samordnare, avtalsansvarig, namngiven huvudcoach och
  // beställande handläggare – aldrig handledare, ekonom, chef eller admin.
  const a = await ctx.repo.table("case_attachments").get(p.attachmentId);
  if (!a || a.status !== "uploaded") return fail("not_found", NOT_FOUND);
  // Loggen först: misslyckas den lämnas ingen adress ut. Inget filnamn i loggen.
  await ctx.audit({ action: "attachment.viewed", entity: "case_attachment", entityId: a.id, contractId: a.contractId, details: { attachmentId: a.id, caseId: a.caseId } });
  const d = await requireAttachments(ctx).signedDownload(a.id);
  if (!d) return fail("not_found", NOT_FOUND);
  if (d.placeholder) return ok({ url: null, contentBase64: d.content ? bytesToBase64(d.content) : null, fileName: `${a.fileName}.txt`, mimeType: "text/plain;charset=utf-8" });
  return ok({ url: d.url, contentBase64: d.content ? bytesToBase64(d.content) : null, fileName: a.fileName, mimeType: a.mimeType });
});
