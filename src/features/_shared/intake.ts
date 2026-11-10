// Intagsansvarig (Karims beslut 2026-11-09, migration 0041): en coach per avtal tar emot avtalets nya beställningar – får en notis
// när en beställning kommer in, bokar första mötet och trycker Ta emot utan samordnarens OK. Samordnarna får en notis i appen när
// en deltagare är mottagen. Utan intagsansvarig (contracts.intake_coach_id är null) är allt som förut: samordnaren tar emot.
// Bara för hanterare – importeras aldrig av skärmar.
//
// Notiserna går bara i appen (user_notifications, channels ["app"]) – aldrig e-post eller SMS – och har bara ärendenumret,
// tiden och kollegornas namn: aldrig deltagarens namn eller andra personuppgifter (CLAUDE.md punkt 2 och 9).
import type { Ctx } from "@/api/server";
import { isOperational, requireOperational } from "@/core/config";
import { avropDue } from "@/core/sla";
import { fmtDateTime, fmtDateTimeLong, type LocalDateTime } from "@/core/time";
import { uniq } from "@/core/util";
import type { Case, Contract, UserNotification } from "@/data/schema";

/** Beställningen väntar på svar – samma villkor som avropsinkorgen har för Acceptera (isOpen i inkorg/model.ts). */
export const isOpenOrder = (c: Pick<Case, "status">): boolean => c.status === "received" || c.status === "acknowledged";

/** Aktören agerar som coach och är avtalets intagsansvarige (samma regel som mm.is_intake_coach och policy.ts isIntakeCoach). */
export const isIntakeCoach = (actor: Ctx["actor"], contract: Pick<Contract, "intakeCoachId"> | null | undefined): boolean =>
  actor.role === "coach" && !!contract?.intakeCoachId && contract.intakeCoachId === actor.userId;

/** Avtalen där aktören är intagsansvarig. Läst via behörigheten (coachen läser sina avtal). */
export async function intakeContractIds(ctx: Ctx): Promise<string[]> {
  if (ctx.actor.role !== "coach" || !ctx.actor.contractIds.length) return [];
  const contracts = await ctx.repo.table("contracts").list({ id: { in: [...ctx.actor.contractIds] }, status: "active" });
  return contracts.filter((c) => isIntakeCoach(ctx.actor, c)).map((c) => c.id);
}

/**
 * Beställningarna som aktören ska ta emot: de som väntar på svar i avtalen där aktören är intagsansvarig. Tom lista för alla
 * andra – också för andra coacher. Läst via behörigheten.
 */
export async function ordersToReceive(ctx: Ctx): Promise<Case[]> {
  const ids = await intakeContractIds(ctx);
  if (!ids.length) return [];
  return ctx.repo.table("cases").list({ contractId: { in: ids }, status: { in: ["received", "acknowledged"] } });
}

const KIND_NEW = "new_order" as const;
const KIND_RECEIVED = "case_received" as const;
/** Notisen bara i appen: ingen e-post (emailBody tom) och inget SMS. */
const inApp = (ctx: Ctx, x: Pick<UserNotification, "recipientId" | "kind" | "caseId" | "title" | "body">): UserNotification => ({
  id: ctx.newId("un"), createdAt: ctx.now(), channels: ["app"], emailBody: "", ...x,
});

/**
 * En ny beställning har kommit in: avtalets intagsansvarige får en notis i appen ("Ny beställning att ta emot – BOT-…") med
 * länk till ärendet. Anropas där beställningen skapas (createOrder – portalen, det inlästa mejlavropet och samordnarens
 * registrering) och när en ny person blir intagsansvarig (intakeCoachChanged). Högst en notis per ärende och person. Ingen
 * notis utan intagsansvarig, eller när personen inte längre har rollen coach i avtalet eller är avstängd – då tar samordnaren
 * emot som förut.
 * ctx.system: notisen går till en annan användare (user_notifications skrivs bara av systemet), och den som skapar beställningen
 * – ofta kommunens handläggare – läser inte vem som är intagsansvarig.
 */
export async function notifyIntakeCoach(ctx: Ctx, c: Pick<Case, "id" | "caseNumber" | "contractId" | "status">, dueAt: LocalDateTime | null): Promise<void> {
  if (!isOpenOrder(c)) return;
  const s = ctx.system;
  const coachId = (await s.table("contracts").get(c.contractId))?.intakeCoachId;
  if (!coachId) return;
  const [membership, profile] = await Promise.all([
    s.table("memberships").first({ userId: coachId, contractId: c.contractId, role: "coach" }),
    s.table("profiles").get(coachId),
  ]);
  if (!membership || !profile || profile.active === false) return;
  if (await s.table("user_notifications").first({ caseId: c.id, kind: KIND_NEW, recipientId: coachId })) return;
  await s.table("user_notifications").insert(inApp(ctx, {
    recipientId: coachId, kind: KIND_NEW, caseId: c.id, title: `Ny beställning att ta emot – ${c.caseNumber}`,
    body: `Boka första mötet och tryck på Ta emot.${dueAt ? ` Kommunen ska ha svar senast ${fmtDateTime(dueAt)}.` : ""}`,
  }));
}

/**
 * En deltagare är mottagen: varje samordnare i avtalet utom den som tog emot får en notis i appen ("Ny deltagare mottagen –
 * BOT-…") med vem som tog emot, första mötet och huvudcoachen, och länk till ärendet. Efter varje lyckad accept, vem som än
 * tog emot. ctx.system: notiserna går till andra användare – user_notifications skrivs bara av systemet.
 */
export async function notifyCaseReceived(ctx: Ctx, c: Pick<Case, "id" | "caseNumber" | "contractId">, o: { firstMeetingAt: LocalDateTime; leadCoachId: string }): Promise<void> {
  const s = ctx.system;
  const me = ctx.actor.userId;
  const recipients = uniq((await s.table("memberships").list({ contractId: c.contractId, role: "samordnare" })).map((m) => m.userId)).filter((id) => id !== me);
  if (!recipients.length) return;
  const profiles = await s.table("profiles").list({ id: { in: uniq([...recipients, me, o.leadCoachId]) } });
  const name = (id: string) => profiles.find((p) => p.id === id)?.fullName ?? "–";
  const body = `Mottagen av ${name(me)}. Första mötet ${fmtDateTimeLong(o.firstMeetingAt)}. Huvudcoach: ${name(o.leadCoachId)}.`;
  for (const id of recipients) {
    if (profiles.find((p) => p.id === id)?.active === false) continue;
    await s.table("user_notifications").insert(inApp(ctx, { recipientId: id, kind: KIND_RECEIVED, caseId: c.id, title: `Ny deltagare mottagen – ${c.caseNumber}`, body }));
  }
}

/** Märk notiserna som lästa åt sina mottagare (en läsmarkering per notis – redan lästa rörs inte). ctx.system: andras notiser. */
async function markRead(ctx: Ctx, notices: readonly Pick<UserNotification, "id" | "recipientId">[]): Promise<void> {
  const s = ctx.system;
  const now = ctx.now();
  for (const n of notices) {
    const id = `${n.recipientId}:${n.id}`;
    if (await s.table("notification_reads").get(id)) continue;
    await s.table("notification_reads").insert({ id, userId: n.recipientId, notificationKey: n.id, readAt: now });
  }
}

/**
 * Beställningen väntar inte längre på svar (mottagen, avböjd eller avslutad utan att ha tagits emot): notisen "Ny beställning
 * att ta emot" är inte längre aktuell och märks som läst åt mottagaren – annars låg den kvar som oläst för något som redan är
 * gjort (kanske av samordnaren).
 * ctx.system: läsmarkeringen gäller en annan användares notis (eller aktörens egen – samma väg för båda).
 */
export async function settleNewOrderNotices(ctx: Ctx, caseId: string): Promise<void> {
  await markRead(ctx, await ctx.system.table("user_notifications").list({ caseId, kind: KIND_NEW }));
}

/**
 * Avtalets intagsansvarige har bytts eller tagits bort (admin.setIntakeCoach; rollen coach borttagen eller kollegan spärrad):
 *   - den förra personens olästa notiser "Ny beställning att ta emot" i avtalet märks som lästa – beställningarna är inte
 *     längre hens att ta emot;
 *   - den nya personen får en notis för varje beställning som väntar på svar i avtalet (notifyIntakeCoach: högst en per ärende
 *     och person, bara om personen har rollen coach och inte är spärrad) – annars visste hen inte om dem förrän på Min vecka.
 * Anropas efter att avtalet har ändrats. ctx.system: notiser och läsmarkeringar gäller andra användare, och den som ändrar
 * (systemadministratören) arbetar inte i ärendena.
 */
export async function intakeCoachChanged(ctx: Ctx, contract: Pick<Contract, "id" | "config">, from: string | null, to: string | null): Promise<void> {
  const s = ctx.system;
  if (from && from !== to) {
    const old = await s.table("user_notifications").list({ kind: KIND_NEW, recipientId: from });
    const caseIds = uniq(old.map((n) => n.caseId).filter((id): id is string => !!id));
    const inContract = new Set(caseIds.length ? (await s.table("cases").list({ id: { in: caseIds }, contractId: contract.id })).map((c) => c.id) : []);
    await markRead(ctx, old.filter((n) => !!n.caseId && inContract.has(n.caseId)));
  }
  if (!to || to === from) return;
  const cfg = isOperational(contract.config) ? requireOperational(contract.config) : null;
  const waiting = await s.table("cases").list({ contractId: contract.id, status: { in: ["received", "acknowledged"] } }, { orderBy: "referredAt" });
  for (const c of waiting) await notifyIntakeCoach(ctx, c, cfg ? avropDue(c, cfg) : null);
}

/**
 * Finns en komplettering från kommunen som väntar i avropsinkorgen – ett svar med ärendenumret som är kopplat till ärendet men
 * inte infört (samma villkor som inkorgens "komplettering att föra in": classification supplement, status linked)? Bara ja
 * eller nej. Den intagsansvarige tar inte emot beställningen förrän samordnaren har fört in kompletteringen – annars bokades
 * första mötet och orderbekräftelsen på uppgifter som kommunen redan har rättat (till exempel omfattningen).
 * ctx.system: coachen läser aldrig avropsinkorgens mejl (policyn och RLS för inbound_emails); svaret lämnar inget ur mejlet.
 */
export async function hasPendingSupplement(ctx: Ctx, caseId: string): Promise<boolean> {
  return (await ctx.system.table("inbound_emails").count({ caseId, classification: "supplement", status: "linked" })) > 0;
}

/** Texten när en komplettering väntar – samma i dialogen och i svaret från arenden.caseAccept. */
export const PENDING_SUPPLEMENT_TEXT = "Kommunen har skickat en komplettering som väntar i inkorgen. Be samordnaren föra in den innan du tar emot.";
