// Hanterare: SMS att skicka på coachens Min vecka (Karims beslut 2026-11-11, SPEC §9). Raderna räknas fram i
// src/features/_shared/sms-to-send.ts. Registreras via handlers.ts – importeras aldrig av skärmar.
import { fail, ok } from "@/api/contract";
import { handleCommand, handleQuery } from "@/api/server";
import { UniqueError } from "@/data/repo";
import type { OutboundMessage } from "@/data/schema";
import { leadCoachFirstName } from "../_shared/coach-cases";
import { PARTICIPANT_TO } from "../_shared/messaging-port";
import { manualSmsId, SCHEDULE_TEMPLATE, smsToMark, smsToSend, tasksCoveredBySchedule } from "../_shared/sms-to-send";
import { smsAttSkicka, smsMarkSent, type SmsToSendRow } from "./api";

const nameOf = (p: { firstName: string; lastName: string }): string => `${p.firstName} ${p.lastName}`;

handleQuery(smsAttSkicka, { roles: ["coach"] }, async (ctx) => {
  const rows = await smsToSend(ctx);
  const profiles = rows.length ? await ctx.repo.table("profiles").list() : [];
  return {
    rows: rows.map((r): SmsToSendRow => ({
      key: r.key, kind: r.kind, week: r.week?.no ?? null, slots: r.slots?.map((x) => ({ id: x.id, startsAt: x.startsAt })) ?? null, messageId: r.messageId,
      caseId: r.case.id, caseNumber: r.case.caseNumber, name: nameOf(r.person), mine: r.mine, leadCoach: leadCoachFirstName(profiles, r.case.leadCoachId),
      phone: r.phone, text: r.text,
    })),
  };
});

const CHANGED_TEXT = "Tiderna har ändrats sedan du kopierade texten. Kopiera den nya texten och skicka den.";
const GONE_TEXT = "SMS:et finns inte längre att skicka – det är redan hanterat eller har ändrats.";
const NOT_FOUND_TEXT = "SMS:et finns inte.";

/**
 * Markera som skickat. Raden räknas om på servern för ärendet utan klockan (smsToMark – granskningen 2026-11-11: en markering
 * stoppas aldrig bara för att tiden har gått): finns den inte längre (hanterad), har veckans tillfällen ändrats (id och tid) eller
 * har ett nytt meddelande kommit stoppas markeringen. Utskicksloggen får en rad med kanalen sms, status sent_manually, mallen
 * (veckans tider eller meddelandets mall), texten, ärendet, vem (sentBy) och när – aldrig numret eller adressen. Id:t bestäms av
 * raden: trycker två coacher samtidigt stoppas den andra skrivningen av primärnyckeln och svaret blir already. Samordnarens
 * uppgift att ringa deltagaren stängs (bara om den fortfarande är öppen) – för veckans tider uppgifterna om en inbjudan eller
 * ändrad tid som texten har med. Revisionsloggen får bara id:n.
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
  if (await ctx.system.table("outbound_messages").get(id)) return ok({ already: true });
  const row = await smsToMark(ctx, p.key);
  if (!row || row.case.id !== c.id) return fail("changed", GONE_TEXT);
  const sameSlots = (xs: readonly { id: string; startsAt: string }[] | undefined) =>
    !!xs && !!row.slots && new Set(xs.map((x) => `${x.id}|${x.startsAt}`)).size === row.slots.length
      && row.slots.every((x) => xs.some((y) => y.id === x.id && y.startsAt === x.startsAt));
  const same = row.kind === SCHEDULE_TEMPLATE
    ? (p.slots ? sameSlots(p.slots) : true) && row.accepted.includes(p.text)
    : p.messageId ? p.messageId === row.messageId : row.accepted.includes(p.text);
  if (!same) return fail("changed", CHANGED_TEXT);
  const now = ctx.now();
  const me = ctx.actor.userId;
  const msg: OutboundMessage = {
    id, createdAt: now, channel: "sms", to: PARTICIPANT_TO.sms, template: row.kind, subject: null, body: row.kind === SCHEDULE_TEMPLATE ? p.text : row.text, caseId: c.id,
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
  // Samordnarens uppgifter att ringa deltagaren om samma meddelande – för veckans tider om en inbjudan eller ändrad tid som texten
  // har med: SMS:et är skickat – ingen dubbel hantering. ctx.system: uppgiften går till rollen samordnare. Bara om den fortfarande
  // är öppen (samordnaren kan ha klarmarkerat den samtidigt).
  const taskIds = row.taskId ? [row.taskId] : row.slots ? await tasksCoveredBySchedule(ctx, c, row.slots) : [];
  for (const taskId of taskIds) {
    const done = await ctx.system.table("tasks").updateIf(taskId, { status: "open" }, { status: "done", doneAt: now, doneBy: me, doneNote: "SMS skickat för hand från Min vecka." });
    if (done) {
      await ctx.audit({
        action: "task.done", entity: "task", entityId: taskId, contractId: c.contractId,
        details: { kind: "participant_contact", caseId: c.id, template: row.taskId ? row.kind : SCHEDULE_TEMPLATE, sentManually: true, messageId: id },
      });
    }
  }
  return ok({ already: false });
});
