// Hanterare: SMS att skicka på coachens Min vecka (Karims beslut 2026-11-11, SPEC §9). Raderna räknas fram i
// src/features/_shared/sms-to-send.ts. Registreras via handlers.ts – importeras aldrig av skärmar.
import { fail, ok } from "@/api/contract";
import { handleCommand, handleQuery } from "@/api/server";
import { UniqueError } from "@/data/repo";
import type { OutboundMessage } from "@/data/schema";
import { leadCoachFirstName } from "../_shared/coach-cases";
import { PARTICIPANT_TO } from "../_shared/messaging-port";
import { manualSmsId, smsToSend } from "../_shared/sms-to-send";
import { smsAttSkicka, smsMarkSent, type SmsToSendRow } from "./api";

const nameOf = (p: { firstName: string; lastName: string }): string => `${p.firstName} ${p.lastName}`;

handleQuery(smsAttSkicka, { roles: ["coach"] }, async (ctx) => {
  const rows = await smsToSend(ctx);
  const profiles = rows.length ? await ctx.repo.table("profiles").list() : [];
  return {
    rows: rows.map((r): SmsToSendRow => ({
      key: r.key, kind: r.kind, week: r.week?.no ?? null, caseId: r.case.id, caseNumber: r.case.caseNumber, name: nameOf(r.person),
      leadCoach: leadCoachFirstName(profiles, r.case.leadCoachId), phone: r.phone, text: r.text,
    })),
  };
});

const CHANGED_TEXT = "Tiderna har ändrats sedan du kopierade texten. Kopiera den nya texten och skicka den.";
const GONE_TEXT = "SMS:et finns inte längre att skicka – det är redan hanterat eller har ändrats.";
const NOT_FOUND_TEXT = "SMS:et finns inte.";

/**
 * Markera som skickat. Raden räknas om på servern för ärendet: finns den inte längre (hanterad, ändrad) eller har texten ändrats
 * stoppas markeringen. Utskicksloggen får en rad med kanalen sms, status sent_manually, mallen (veckans tider eller meddelandets
 * mall), texten, ärendet, vem (sentBy) och när – aldrig numret eller adressen. Id:t bestäms av raden: trycker två coacher samtidigt
 * stoppas den andra skrivningen av primärnyckeln och svaret blir already. Samordnarens uppgift att ringa deltagaren stängs (bara
 * om den fortfarande är öppen). Revisionsloggen får bara id:n.
 */
handleCommand(smsMarkSent, { roles: ["coach"] }, async (ctx, p) => {
  const [kind, ...rest] = p.key.split(":");
  // Ärendet raden gäller. Uppgiften (samordnarens) läses med ctx.system bara för att hitta ärendet – raden räknas sedan om via
  // coachens behörighet (smsToSend läser ärendet och personen via ctx.repo).
  const caseId = kind === "vecka" && rest.length === 2 ? rest[0] : kind === "uppgift" && rest.length === 1 ? ((await ctx.system.table("tasks").get(rest[0]))?.caseIds[0] ?? null) : null;
  const c = caseId ? await ctx.repo.table("cases").get(caseId) : null;
  if (!c) return fail("not_found", NOT_FOUND_TEXT);
  const id = manualSmsId(p.key);
  // ctx.system: coachen läser inte utskicksloggen – bara om raden redan finns (ja eller nej).
  const already = async () => !!(await ctx.system.table("outbound_messages").get(id));
  const row = (await smsToSend(ctx, { caseId: c.id })).find((r) => r.key === p.key);
  if (!row) return (await already()) ? ok({ already: true }) : fail("changed", GONE_TEXT);
  if (row.text !== p.text) return fail("changed", CHANGED_TEXT);
  const now = ctx.now();
  const me = ctx.actor.userId;
  const msg: OutboundMessage = {
    id, createdAt: now, channel: "sms", to: PARTICIPANT_TO.sms, template: row.kind, subject: null, body: row.text, caseId: c.id,
    status: "sent_manually", sentAt: now, statusReason: null, providerMessageId: null, sentBy: me,
  };
  try {
    // ctx.system: utskicksloggen skrivs bara av servern (policyn: ingen inloggad skriver) – som ctx.notify.
    await ctx.system.table("outbound_messages").insert(msg);
  } catch (e) {
    if (e instanceof UniqueError) return ok({ already: true });
    throw e;
  }
  const details = { caseId: c.id, template: row.kind, channel: "sms", ...(row.week ? { week: row.week.key } : {}), ...(row.taskId ? { taskId: row.taskId } : {}) };
  await ctx.audit({ action: "outbound_message.sent_manually", entity: "outbound_message", entityId: id, contractId: c.contractId, details });
  if (row.taskId) {
    // Samordnarens uppgift att ringa deltagaren om samma meddelande: SMS:et är skickat – ingen dubbel hantering. ctx.system:
    // uppgiften går till rollen samordnare. Bara om den fortfarande är öppen (samordnaren kan ha klarmarkerat den samtidigt).
    const done = await ctx.system.table("tasks").updateIf(row.taskId, { status: "open" }, { status: "done", doneAt: now, doneBy: me, doneNote: "SMS skickat för hand från Min vecka." });
    if (done) {
      await ctx.audit({
        action: "task.done", entity: "task", entityId: row.taskId, contractId: c.contractId,
        details: { kind: "participant_contact", caseId: c.id, template: row.kind, sentManually: true, messageId: id },
      });
    }
  }
  return ok({ already: false });
});
