// Teknisk städning av bilagor till beställningen (0024). Isomorf: körs av jobbet attachments_retention i supabase-läget
// (src/server/jobs/attachments.ts, högst en gång i timmen) och kan köras i minnet i testerna.
//
// Beslut 5 (Karim 2026-10-08, svar till Botkyrka): bilagor i ett ärende gallras ALDRIG automatiskt. De tas bort för hand av
// Miljonbemanning (samordnare eller avtalsansvarig, arenden.bilagaTaBort) och tidigast när ärendet är avslutat eller
// beställningen avböjd. Avtalets gamla regel retentionRules.attachmentsAfterCloseDays läses inte längre. Det som körs här är
// bara städning av filer som inte hör till något ärende – inte gallring av ärendets handlingar:
//   1. Uppladdningar som aldrig kopplades till en beställning raderas efter 24 timmar (plattformsregel). Undantag (beslut 4c,
//      2026-10-08): bilagor ur ett inläst mejl till avrop@ (uppladdade av systemet) som väntar på att samordnaren registrerar
//      beställningen för hand – de behålls så länge mejlet väntar (status received, utan ärende), t.ex. fredag → måndag.
//   2. Avstämning: filer i lagringen utan levande rad (pending/uploaded) raderas. Den signerade uppladdningsadressen gäller i
//      2 timmar och kan inte återkallas, så efter "Ta bort" eller en avvisad fil kan samma adress användas igen så länge
//      filen inte finns – en sådan fil fångas här (granskningen 2026-10-07). Lagringen listas FÖRE raderna läses: en fil som
//      finns vid listningen har alltid sin rad (raden skrivs innan uppladdningsadressen skapas), så en uppladdning som pågår
//      samtidigt raderas aldrig.
// Varje radering loggas (attachment.deleted: id, ärende och orsak – aldrig filnamnet). Systemsteg: ctx.system (service role).
import { SYSTEM_ACTOR } from "@/api/roles";
import type { Ctx } from "@/api/server";
import type { CaseAttachment } from "@/data/schema";
import { attachmentIdOfPath, attachmentUnlinkedOverdue, requireAttachments } from "./attachment-port";

/**
 * Okopplade bilagor som hör till ett inläst mejl som väntar på registrering (beslut 4c): uppladdade av systemet och med
 * sökvägen i ett avrop utan ärende som fortfarande väntar. ctx.system: mejlen läses som systemsteg. Returnerar id:n att behålla.
 */
async function awaitingRegistration(ctx: Ctx, overdue: readonly CaseAttachment[]): Promise<Set<string>> {
  const fromMail = overdue.filter((a) => a.uploadedBy === SYSTEM_ACTOR.userId);
  if (!fromMail.length) return new Set();
  const waiting = await ctx.system.table("inbound_emails").list({ classification: "order", status: "received", caseId: { isNull: true } });
  const paths = new Set(waiting.flatMap((m) => m.attachments.map((x) => x.path).filter((p): p is string => !!p)));
  return new Set(fromMail.filter((a) => paths.has(a.storagePath)).map((a) => a.id));
}

export type AttachmentRetentionResult = { unlinked: number; orphans: number };

export async function runAttachmentRetention(ctx: Ctx): Promise<AttachmentRetentionResult> {
  const port = requireAttachments(ctx);
  const now = ctx.now();
  // Lagringen först (se 2 ovan), sedan raderna.
  const stored = await port.listStoredPaths();
  // ctx.system: städningen är ett systemsteg och går igenom alla avtal.
  const rows = await ctx.system.table("case_attachments").list({ status: { in: ["pending", "uploaded"] } });
  let unlinked = 0;
  let orphans = 0;
  const removed = new Set<string>();
  const log = async (id: string, contractId: string, caseId: string | null, reason: "unlinked_24h" | "orphan") =>
    ctx.audit({ action: "attachment.deleted", entity: "case_attachment", entityId: id, contractId, details: { caseId, reason } });

  // Mejlets bilagor som väntar på registrering för hand behålls (se 1 ovan) – övriga okopplade raderas efter 24 timmar.
  const overdue = rows.filter((x) => attachmentUnlinkedOverdue(x, now));
  const awaiting = await awaitingRegistration(ctx, overdue);
  for (const a of overdue.filter((x) => !awaiting.has(x.id))) {
    await port.remove(a.id, "unlinked_24h");
    await log(a.id, a.contractId, null, "unlinked_24h");
    removed.add(a.id);
    unlinked++;
  }

  // Bilagor som hör till ett ärende rörs aldrig här (beslut 5, 2026-10-08).

  // 2. Filer utan levande rad (raderade, avvisade eller okända rader).
  const live = new Set(rows.filter((x) => !removed.has(x.id)).map((x) => x.storagePath));
  const removedPaths = new Set(rows.filter((x) => removed.has(x.id)).map((x) => x.storagePath));
  for (const path of stored) {
    if (live.has(path) || removedPaths.has(path)) continue;
    await port.removeStoredFile(path);
    const ref = attachmentIdOfPath(path);
    await ctx.audit({ action: "attachment.deleted", entity: "case_attachment", entityId: ref?.id ?? null, contractId: ref?.contractId ?? null, details: { caseId: null, reason: "orphan" } });
    orphans++;
  }
  return { unlinked, orphans };
}
