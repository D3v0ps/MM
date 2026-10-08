// Gallringen av bilagor till beställningen (beslut 2026-10-07, 0024). Isomorf: körs av jobbet attachments_retention i
// supabase-läget (src/server/jobs/attachments.ts, högst en gång i timmen) och kan köras i minnet i testerna.
//   1. Uppladdningar som aldrig kopplades till en beställning raderas efter 24 timmar (plattformsregel).
//   2. Bilagor i avslutade och avböjda ärenden raderas när avtalets retentionRules.attachmentsAfterCloseDays har gått sedan
//      avslutet (avslutade: slutdatum, annars avslutstiden) respektive avböjandet. ATT_FASTSTÄLLA eller saknad regel = inget
//      raderas (Botkyrka: inte fastställt, SPEC §13 fråga 27).
//   3. Avstämning: filer i lagringen utan levande rad (pending/uploaded) raderas. Den signerade uppladdningsadressen gäller i
//      2 timmar och kan inte återkallas, så efter "Ta bort" eller en avvisad fil kan samma adress användas igen så länge
//      filen inte finns – en sådan fil fångas här (granskningen 2026-10-07). Lagringen listas FÖRE raderna läses: en fil som
//      finns vid listningen har alltid sin rad (raden skrivs innan uppladdningsadressen skapas), så en uppladdning som pågår
//      samtidigt raderas aldrig.
// Varje radering loggas (attachment.deleted: id, ärende och orsak – aldrig filnamnet). Systemsteg: ctx.system (service role).
import type { Ctx } from "@/api/server";
import { isUnset } from "@/core/config";
import { addDays, dayOf } from "@/core/time";
import type { Case } from "@/data/schema";
import { attachmentIdOfPath, attachmentUnlinkedOverdue, requireAttachments } from "./attachment-port";

export type AttachmentRetentionResult = { unlinked: number; retention: number; orphans: number };

/** Dagen gallringsfristen räknas från: avslutade ärenden slutdatumet (annars avslutstiden), avböjda beställningar avböjandet. */
export function retentionStartOf(c: Pick<Case, "status" | "endDate" | "closedAt" | "declinedAt">): string | null {
  if (c.status === "closed") return c.endDate ?? (c.closedAt ? dayOf(c.closedAt) : null);
  if (c.status === "declined") return c.declinedAt ? dayOf(c.declinedAt) : null;
  return null;
}

export async function runAttachmentRetention(ctx: Ctx): Promise<AttachmentRetentionResult> {
  const port = requireAttachments(ctx);
  const now = ctx.now();
  const today = dayOf(now);
  // Lagringen först (se 3 ovan), sedan raderna.
  const stored = await port.listStoredPaths();
  // ctx.system: gallringen är ett systemsteg och går igenom alla avtal.
  const rows = await ctx.system.table("case_attachments").list({ status: { in: ["pending", "uploaded"] } });
  let unlinked = 0;
  let retention = 0;
  let orphans = 0;
  const removed = new Set<string>();
  const log = async (id: string, contractId: string, caseId: string | null, reason: "unlinked_24h" | "retention" | "orphan") =>
    ctx.audit({ action: "attachment.deleted", entity: "case_attachment", entityId: id, contractId, details: { caseId, reason } });

  for (const a of rows.filter((x) => attachmentUnlinkedOverdue(x, now))) {
    await port.remove(a.id, "unlinked_24h");
    await log(a.id, a.contractId, null, "unlinked_24h");
    removed.add(a.id);
    unlinked++;
  }

  const linked = rows.filter((x) => !!x.caseId && !removed.has(x.id));
  if (linked.length) {
    const caseIds = [...new Set(linked.map((x) => x.caseId as string))];
    const contractIds = [...new Set(linked.map((x) => x.contractId))];
    const [cases, contracts] = await Promise.all([
      ctx.system.table("cases").list({ id: { in: caseIds }, status: { in: ["closed", "declined"] } }),
      ctx.system.table("contracts").list({ id: { in: contractIds } }),
    ]);
    const ended = new Map(cases.map((c) => [c.id, c]));
    const days = new Map(contracts.map((c) => [c.id, c.config.retentionRules?.attachmentsAfterCloseDays]));
    for (const a of linked) {
      const c = ended.get(a.caseId as string);
      const d = days.get(a.contractId);
      const end = c ? retentionStartOf(c) : null;
      if (!c || !end || d == null || isUnset(d) || typeof d !== "number") continue;
      if (addDays(end, d) > today) continue;
      await port.remove(a.id, "retention");
      await log(a.id, a.contractId, a.caseId, "retention");
      removed.add(a.id);
      retention++;
    }
  }

  // 3. Filer utan levande rad (raderade, avvisade eller okända rader).
  const live = new Set(rows.filter((x) => !removed.has(x.id)).map((x) => x.storagePath));
  const removedPaths = new Set(rows.filter((x) => removed.has(x.id)).map((x) => x.storagePath));
  for (const path of stored) {
    if (live.has(path) || removedPaths.has(path)) continue;
    await port.removeStoredFile(path);
    const ref = attachmentIdOfPath(path);
    await ctx.audit({ action: "attachment.deleted", entity: "case_attachment", entityId: ref?.id ?? null, contractId: ref?.contractId ?? null, details: { caseId: null, reason: "orphan" } });
    orphans++;
  }
  return { unlinked, retention, orphans };
}
