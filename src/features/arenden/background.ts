// Beställningens bakgrundsinformation med bilagorna (beslut 2026-10-07, synpunkt #7) – byggs för portalens deltagarsida,
// deltagarkortet och acceptdialogen i inkorgen. Bara för hanterare (läser via ctx.repo: policy.ts/RLS case_attachments).
// Registrerar inga hanterare – kan importeras av alla områden.
import type { Role } from "@/api/roles";
import type { Ctx } from "@/api/server";
import { orderPeriodText } from "@/core/cases";
import type { Case, CaseAttachment } from "@/data/schema";
import { fileSizeText } from "../_shared/attachment-port";
import type { AttachmentRow, CaseBackground } from "./api";

/** Lägger till och tar bort bilagor i ett ärende som redan finns (full åtkomst). */
const MB_EDITORS: readonly Role[] = ["samordnare", "avtalsansvarig"];

/** Omfattningen i text (finns i src/core/cases.ts – används också av orderbekräftelsen). */
export { orderPeriodText };

/** Raden i listorna. Uppladdarens namn läses via behörigheten (namn som läsaren inte får se blir "–"). */
export async function rowsFor(ctx: Ctx, rows: readonly CaseAttachment[]): Promise<AttachmentRow[]> {
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((a) => a.uploadedBy))];
  const profiles = await ctx.repo.table("profiles").list({ id: { in: ids } });
  const name = new Map(profiles.map((p) => [p.id, p.fullName]));
  const mbEditor = MB_EDITORS.includes(ctx.actor.role);
  return rows
    .filter((a) => a.status === "uploaded")
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
    .map((a) => ({
      // "system" = bilagan kom med ett mejl till avrop@ och sparades av inläsningen (beslut 4c).
      id: a.id, fileName: a.fileName, mimeType: a.mimeType, bytes: a.bytes, sizeText: fileSizeText(a.bytes), uploadedByName: a.uploadedBy === "system" ? "Miljonmatch (bilaga i mejlet)" : name.get(a.uploadedBy) ?? "–",
      createdAt: a.createdAt, canRemove: (!a.caseId && a.uploadedBy === ctx.actor.userId) || (!!a.caseId && mbEditor),
    }));
}

/** Bakgrundsinformationen från beställningen med bilagorna (läses via behörigheten). */
export async function caseBackground(ctx: Ctx, c: Case): Promise<CaseBackground> {
  const rows = await ctx.repo.table("case_attachments").list({ caseId: c.id });
  return {
    orderPeriodText: orderPeriodText(c), orderPeriodReason: c.orderPeriodReason, priorAssessment: c.priorAssessment, text: c.backgroundInfo,
    attachments: await rowsFor(ctx, rows),
  };
}

