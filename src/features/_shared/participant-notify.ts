// Meddelanden till deltagare (beslut 2026-10-09, coachmötet): kallelse till första mötet och inbjudan till aktivitet.
// En funktion för alla utskick till deltagare – den väljer kanalerna och skickar samma innehåll överallt:
//   tid, plats och Miljonbemannings telefonnummer (CONTACT_PHONE). Aldrig namn, personnummer, ärendenummer eller vad
//   insatsen gäller (CLAUDE.md punkt 9).
// Kanalerna (kommunen anger inte längre kontaktväg i beställningen, beslut 2026-10-09):
//   e-post     när deltagaren har en e-postadress
//   SMS        när SMS är kopplat (46elks) och deltagaren har ett telefonnummer
//   utringning dessutom, när den är kopplad och deltagaren har ett telefonnummer – en kort inspelning utan personuppgifter
//              som hänvisar till SMS:et eller mejlet (ringer bara när något av dem gick iväg)
//   brev       bara kallelsen: när deltagaren har valt brev och adressen finns (skickas för hand, som förut)
//   ingen      en uppgift till samordnaren: "Ring deltagaren och kalla till första mötet" med ärendenumret – aldrig namnet
// Deltagarens valda kontaktväg (persons.preferredContact, som coachen kan ändra) går först när den kanalen är kopplad.
// En kanal räknas bara när utskicket når fram: e-post som spärrlistan stoppar (MM_EMAIL_ALLOWLIST, ctx.messaging.emailReaches)
// och telefonnummer som inte går att tolka räknas inte. Sådana utskick, och SMS och utringning som inte är kopplade, sparas i
// utskicksloggen med orsak – så syns varför inget gick. Stoppas eller misslyckas ett utskick först när det skickas (t.ex. 46elks
// avvisar numret) får samordnaren uppgiften av jobbet (participantSendStopped), om inget annat skriftligt utskick gick.
// Går kallelsen eller inbjudan ut med någon kanal stängs en öppen uppgift att ringa för samma möte (ombokning efter att en
// kontaktväg tillkommit) – annars ringer samordnaren med fel tid.
// Kontaktuppgifterna prövas med samma regler överallt (src/core/contact.ts: hasPhone, hasEmail).
// Isomorf: samma kod i Next.js och i prototypen. Utskicken går bara via ctx.notify (servern: src/server/notify).
import type { Ctx, OutgoingMessage } from "@/api/server";
import { SYSTEM_ACTOR } from "@/api/roles";
import { hasEmail, hasPhone } from "@/core/contact";
import { fmtTime, fmtWeekday, type LocalDateTime } from "@/core/time";
import type { Case, OutboundMessage, Person, PreferredContact, Task } from "@/data/schema";
import { CONTACT_PHONE } from "./contact";
import {
  EMAIL_INVALID_REASON, EMAIL_NOT_ALLOWED_REASON, isParticipantRecipient, messagingOf, PARTICIPANT_TO, PHONE_FORMAT_REASON, PHONE_MISSING_REASON,
  PHONE_NOT_ALLOWED_REASON, SMS_OFF_REASON, type MessagingStatus, type ParticipantChannel,
} from "./messaging-port";

/** Mallarna för utskick till deltagare (src/server/notify/templates.ts och adminvyns mallkatalog). */
export type ParticipantTemplate = "kallelse" | "aktivitetsinbjudan";

/** Det kanalvalet behöver om deltagaren. */
export type ParticipantContact = Pick<Person, "email" | "phone" | "preferredContact" | "address">;

/** Kanaler som inte når deltagaren men sparas i utskicksloggen med orsak. */
export type OffChannel = "email" | "sms" | "call";

export type ChannelPlan = {
  /** Kanalerna som utskicket går till, i ordning. Tom = ingen kanal (uppgift till samordnaren). */
  send: ParticipantChannel[];
  /**
   * Kanaler som inte når deltagaren – sparas som stoppade (eller, för ett nummer med fel format, som misslyckade) med orsak:
   * SMS och utringning som inte är kopplade, e-post som spärrlistan stoppar och adresser eller nummer som inte går att använda.
   */
  off: OffChannel[];
};

/**
 * Texten i den inspelning som spelas upp vid utringningen (MM_CALL_AUDIO_URL, public/ljud/README.md). Sparas som utskickets
 * text i utskicksloggen, så att det syns vad deltagaren fick höra. Inga personuppgifter, ingen tid – den står i SMS:et och mejlet.
 */
export const CALL_RECORDING_TEXT =
  `Inspelat meddelande: Hej, det här är Miljonbemanning. Du har fått en inbjudan till ett möte hos oss. Tid och plats står i ditt SMS eller mejl.${CONTACT_PHONE ? ` Har du frågor, ring ${CONTACT_PHONE}.` : ""}`;

/** Ordningen när deltagaren har valt en kontaktväg. Kanaler som inte används filtreras bort. */
const ORDER: Record<PreferredContact, readonly ParticipantChannel[]> = {
  sms: ["sms", "email", "brev", "call"],
  phone: ["sms", "call", "email", "brev"],
  email: ["email", "sms", "brev", "call"],
  letter: ["brev", "email", "sms", "call"],
};

/**
 * Kanalvalet (rent – testas i alla kombinationer i participant-notify.test.ts). letter = brev får användas (kallelsen; inbjudan
 * till en aktivitet går aldrig som brev – det hinner inte fram).
 */
export function planParticipantChannels(p: ParticipantContact, status: MessagingStatus, opts: { letter?: boolean } = {}): ChannelPlan {
  const reach = contactReach(p, status);
  const phone = reach.phone === "ok" || reach.phone === "sms_off";
  const use = new Set<ParticipantChannel>();
  const off: OffChannel[] = [];
  // En adress eller ett nummer som finns men inte når fram sparas med orsak (servern och minnesläget avgör orsaken).
  if (reach.email === "ok") use.add("email");
  else if (reach.email !== "none") off.push("email");
  if (reach.phone === "ok") use.add("sms");
  else if (reach.phone !== "none") off.push("sms");
  if ((opts.letter ?? true) && p.preferredContact === "letter" && (p.address ?? "").trim()) use.add("brev");
  // Utringningen hänvisar till SMS:et eller mejlet – den görs bara när något av dem går iväg.
  if (phone && (use.has("email") || use.has("sms"))) {
    if (status.call.connected) use.add("call");
    else off.push("call");
  }
  const order = ORDER[p.preferredContact] ?? ORDER.sms;
  return { send: order.filter((ch) => use.has(ch)), off };
}

/** Hur e-posten och telefonen når deltagaren. none = uppgiften saknas. */
type EmailReachState = "ok" | "none" | "invalid" | "blocked";
type PhoneReachState = "ok" | "none" | "invalid" | "sms_off";

/** E-post: giltig adress som spärrlistan släpper igenom. Telefon: nummer som går att tolka och SMS kopplat. */
function contactReach(p: Pick<ParticipantContact, "email" | "phone">, status: MessagingStatus): { email: EmailReachState; phone: PhoneReachState } {
  const email = (p.email ?? "").trim();
  const phone = (p.phone ?? "").trim();
  return {
    email: !email ? "none" : !hasEmail(email) ? "invalid" : status.emailReaches && !status.emailReaches(email) ? "blocked" : "ok",
    phone: !phone ? "none" : !hasPhone(phone) ? "invalid" : status.sms.connected ? "ok" : "sms_off",
  };
}

/** Varför utskicket inte nådde deltagaren – uppgiftens förklaring till samordnaren. Aldrig adressen eller numret. */
export type UnreachableReason = "no_email" | "bad_email" | "email_blocked" | "email_failed" | "no_phone" | "bad_phone" | "sms_off" | "phone_blocked" | "sms_failed";

const UNREACHABLE_TEXT: Record<UnreachableReason, string> = {
  no_email: "deltagaren har ingen e-postadress",
  bad_email: "e-postadressen har fel format",
  email_blocked: "e-post till deltagarens adress är spärrad just nu",
  email_failed: "mejlet kunde inte skickas",
  no_phone: "deltagaren har inget telefonnummer",
  bad_phone: "telefonnumret har fel format",
  sms_off: "SMS är inte kopplat",
  phone_blocked: "SMS till numret är spärrat just nu",
  sms_failed: "SMS:et kunde inte skickas",
};

/** Orsakerna när kanalvalet inte hittade någon kanal (notifyParticipant). */
export function unreachableReasons(p: Pick<ParticipantContact, "email" | "phone">, status: MessagingStatus): UnreachableReason[] {
  const r = contactReach(p, status);
  const email: Record<EmailReachState, UnreachableReason | null> = { ok: null, none: "no_email", invalid: "bad_email", blocked: "email_blocked" };
  const phone: Record<PhoneReachState, UnreachableReason | null> = { ok: null, none: "no_phone", invalid: "bad_phone", sms_off: "sms_off" };
  return [email[r.email], phone[r.phone]].filter((x): x is UnreachableReason => !!x);
}

/** Orsaken till ett stoppat eller misslyckat utskick (outbound_messages.statusReason) som förklaring i uppgiften. */
function reasonOfRow(m: Pick<OutboundMessage, "channel" | "statusReason">): UnreachableReason {
  const r = m.statusReason ?? "";
  if (m.channel === "email") return r === EMAIL_INVALID_REASON ? "bad_email" : r === EMAIL_NOT_ALLOWED_REASON ? "email_blocked" : "email_failed";
  if (r === PHONE_MISSING_REASON) return "no_phone";
  if (r === PHONE_FORMAT_REASON) return "bad_phone";
  if (r === SMS_OFF_REASON) return "sms_off";
  if (r === PHONE_NOT_ALLOWED_REASON) return "phone_blocked";
  return "sms_failed";
}

/** Platsen i en mening: trimmad, ett mellanslag mellan orden, högst 120 tecken. */
const placeText = (place: string): string => place.trim().replace(/\s+/g, " ").slice(0, 120) || "Miljonbemanning";
const phoneSentence = (): string => (CONTACT_PHONE ? ` Frågor? Ring ${CONTACT_PHONE}.` : "");

/** Texten till deltagaren: bara tid, plats och Miljonbemannings telefonnummer. */
export function participantMessage(template: ParticipantTemplate, when: LocalDateTime, place: string): string {
  const where = placeText(place);
  if (template === "aktivitetsinbjudan") {
    return `Hej! Du är inbjuden till en aktivitet hos Miljonbemanning ${fmtWeekday(when)} kl. ${fmtTime(when)}, ${where}.${phoneSentence()}`;
  }
  return `Välkommen till Miljonbemanning! Ditt första möte är ${fmtWeekday(when)} klockan ${fmtTime(when)} i ${where}.${phoneSentence()}`;
}

/** Uppgiftens första mening per mall – kallelsens uppgift ersätts (inte dubbleras) när mötet bokas om. */
const TASK_START: Record<ParticipantTemplate, string> = {
  kallelse: "Ring deltagaren och kalla till första mötet",
  aktivitetsinbjudan: "Ring deltagaren och bjud in till aktiviteten",
};

/** Är uppgiften (tasks.text, kind participant_contact) uppgiften att ringa och kalla till första mötet? */
export const isKallelseTask = (text: string): boolean => text.startsWith(TASK_START.kallelse);

const isParticipantTemplate = (t: string): t is ParticipantTemplate => t === "kallelse" || t === "aktivitetsinbjudan";

/** Uppgiftens början: mallen, ärendenumret, tiden och platsen. Samma början = samma möte eller aktivitet. */
const taskHead = (template: ParticipantTemplate, caseNumber: string, when: LocalDateTime, place: string): string =>
  `${TASK_START[template]} – ärende ${caseNumber}, ${fmtWeekday(when)} kl. ${fmtTime(when)}, ${placeText(place)}.`;

/**
 * Uppgiften till samordnaren när ingen kanal fanns eller inget utskick gick fram. Ärendenumret, tiden, platsen och varför –
 * aldrig namnet, adressen eller numret.
 */
export function contactTaskText(template: ParticipantTemplate, caseNumber: string, when: LocalDateTime, place: string, reasons: readonly UnreachableReason[]): string {
  const head = taskHead(template, caseNumber, when, place);
  const set = new Set(reasons);
  if (set.has("no_email") && set.has("no_phone") && set.size === 2) return `${head} Deltagaren har varken e-postadress eller telefonnummer – fråga beställande handläggare.`;
  const what = template === "kallelse" ? "Kallelsen" : "Inbjudan";
  const texts = [...set].map((r) => UNREACHABLE_TEXT[r]);
  const check = set.has("bad_phone") && set.has("bad_email") ? " – kontrollera numret och adressen" : set.has("bad_phone") ? " – kontrollera numret" : set.has("bad_email") ? " – kontrollera adressen" : "";
  return `${head} ${what} kunde inte skickas${texts.length ? `: ${listSv(texts)}${check}` : ""}.`;
}

export type NotifyParticipantInput = {
  caseId: string;
  template: ParticipantTemplate;
  /** Tiden för mötet eller aktiviteten (Stockholms tid). */
  when: LocalDateTime;
  /** Platsen, t.ex. "Alby" eller "Miljonbemanning, Kontorsgatan 1". Inga namn. */
  place: string;
};

export type NotifyParticipantResult = {
  /** Kanalerna som utskicket går till (i kön, skickat eller brev att skicka för hand). Tom = ingen kanal. */
  channels: ParticipantChannel[];
  /** Kanaler som inte når deltagaren – stoppade (eller misslyckade) med orsak i utskicksloggen. */
  off: OffChannel[];
  /** Uppgiften till samordnaren när ingen kanal fanns (ny eller uppdaterad). */
  taskId: string | null;
  /** Inget utskick: skyddade personuppgifter (vilande spärr) eller ärendet/personen går inte att läsa för användaren. */
  blocked: boolean;
  /** En mening i klarspråk till den som bokade, t.ex. "Kallelsen skickas med e-post." – aldrig "skickad": utskicket ligger i kön. */
  summary: string;
};

const CHANNEL_TEXT: Record<"email" | "sms", string> = { email: "e-post", sms: "SMS" };
const listSv = (xs: readonly string[]): string => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} och ${xs[xs.length - 1]}` : xs.join(""));

/**
 * Meningen till den som bokade mötet eller bjöd in. Brevet skickas för hand; samtalet hänvisar till SMS:et eller mejlet.
 * "skickas", inte "är skickad": utskicket ligger i kön och kan stoppas när det skickas – då får samordnaren en uppgift.
 */
export function notifySummary(template: ParticipantTemplate, r: Pick<NotifyParticipantResult, "channels" | "taskId" | "blocked">): string {
  const what = template === "kallelse" ? "Kallelsen" : "Inbjudan";
  if (r.blocked) return `${what} skickades inte.`;
  const sent = r.channels.filter((c): c is "email" | "sms" => c === "email" || c === "sms");
  const letter = r.channels.includes("brev");
  const call = r.channels.includes("call") ? " Deltagaren blir också uppringd med ett inspelat meddelande." : "";
  if (sent.length) return `${what} skickas med ${listSv(sent.map((c) => CHANNEL_TEXT[c]))}.${letter ? " Ett brev skickas också för hand." : ""}${call}`;
  if (letter) return `${what} ska skickas som brev. Brevet skickas för hand.`;
  return `${what} kunde inte skickas. Samordnaren har fått en uppgift att ringa deltagaren.`;
}

/**
 * Skicka ett meddelande till deltagaren i ärendet (kallelse eller inbjudan). Läser ärendet och personen via ctx.repo – den som
 * inte får se personen kan inte skicka. Skyddade personuppgifter (vilande spärr, CLAUDE.md punkt 8): inget utskick och ingen uppgift.
 * Exporteras för senare spår (inbjudan till gruppaktiviteter): notifyParticipant(ctx, { caseId, template, when, place }).
 */
export async function notifyParticipant(ctx: Ctx, input: NotifyParticipantInput): Promise<NotifyParticipantResult> {
  const c = await ctx.repo.table("cases").get(input.caseId);
  const person = c ? await ctx.repo.table("persons").get(c.personId) : null;
  if (!c || !person || person.protectedIdentity) {
    const blocked = { channels: [], off: [], taskId: null, blocked: true };
    return { ...blocked, summary: notifySummary(input.template, blocked) };
  }
  const status = messagingOf(ctx);
  const plan = planParticipantChannels(person, status, { letter: input.template === "kallelse" });
  const text = participantMessage(input.template, input.when, input.place);
  const invitation = { when: input.when, place: input.place };
  const send = (ch: ParticipantChannel) =>
    ctx.notify({
      // Brev är en egen kanal i utskicksloggen (outbound_messages.channel "brev") – som förut. OutgoingMessage säger "letter".
      channel: ch as OutgoingMessage["channel"],
      to: PARTICIPANT_TO[ch],
      template: input.template,
      body: ch === "call" ? CALL_RECORDING_TEXT : text,
      caseId: c.id,
      // Tid och plats till jobbet: stoppas utskicket när det skickas får samordnaren uppgiften (participantSendStopped).
      invitation,
    });
  for (const ch of plan.send) await send(ch);
  // Når inte deltagaren: en rad i utskicksloggen med orsaken (servern och minnesläget stoppar dem utan att skicka).
  for (const ch of plan.off) await send(ch);

  let taskId: string | null = null;
  if (!plan.send.length) taskId = await contactTask(ctx, input, c, unreachableReasons(person, status));
  else await closeContactTasks(ctx, input, c, plan.send);
  const result = { channels: plan.send, off: plan.off, taskId, blocked: false };
  return { ...result, summary: notifySummary(input.template, result) };
}

/** Öppna uppgifter att ringa för samma sak: kallelsen i ärendet (en åt gången), eller inbjudan med samma tid och plats. */
async function openContactTasks(ctx: Ctx, input: NotifyParticipantInput, c: Pick<Case, "id" | "caseNumber">): Promise<Task[]> {
  const head = taskHead(input.template, c.caseNumber, input.when, input.place);
  return (await ctx.system.table("tasks").list({ kind: "participant_contact", status: "open" }))
    .filter((x) => x.caseIds.includes(c.id) && (input.template === "kallelse" ? isKallelseTask(x.text) : x.text.startsWith(head)));
}

/**
 * Uppgift till samordnaren när ingen kanal fanns eller inget utskick gick fram. En öppen uppgift för kallelsen i samma ärende
 * uppdateras (ombokning) i stället för att dubbleras; en inbjudan med samma tid och plats skapas inte två gånger. Ändringen
 * loggas (task.updated). ctx.system: uppgiften går till en annan roll (samordnaren) och dubblettkontrollen ska se alla öppna uppgifter.
 */
async function contactTask(ctx: Ctx, input: NotifyParticipantInput, c: Pick<Case, "id" | "caseNumber" | "contractId">, reasons: readonly UnreachableReason[]): Promise<string> {
  const t = ctx.system.table("tasks");
  const text = contactTaskText(input.template, c.caseNumber, input.when, input.place, reasons);
  const same = (await openContactTasks(ctx, input, c))[0];
  if (same) {
    if (same.text !== text) {
      await t.update(same.id, { text });
      await ctx.audit({ action: "task.updated", entity: "task", entityId: same.id, contractId: c.contractId, details: { kind: "participant_contact", caseId: c.id, template: input.template } });
    }
    return same.id;
  }
  const task: Task = {
    id: ctx.newId("task"), toRole: "samordnare", toId: null, fromId: ctx.actor.userId, createdAt: ctx.now(), status: "open", kind: "participant_contact",
    caseIds: [input.caseId], text, deviationId: null, emailId: null, responseId: null, month: null, doneAt: null, doneBy: null, doneNote: null,
  };
  await t.insert(task);
  await ctx.audit({ action: "task.created", entity: "task", entityId: task.id, contractId: c.contractId, details: { kind: "participant_contact", caseId: c.id, template: input.template } });
  return task.id;
}

/**
 * Kallelsen eller inbjudan gick ut med någon kanal: en öppen uppgift att ringa för samma möte stängs, så att samordnaren inte
 * ringer med en gammal tid (t.ex. ombokning efter att coachen lagt till en e-postadress). Kallelsen: alla öppna kallelseuppgifter
 * i ärendet. Inbjudan: bara uppgiften med samma tid och plats. Stängs av systemet med en anteckning och loggas (task.done).
 */
async function closeContactTasks(ctx: Ctx, input: NotifyParticipantInput, c: Pick<Case, "id" | "caseNumber" | "contractId">, channels: readonly ParticipantChannel[]): Promise<void> {
  const open = await openContactTasks(ctx, input, c);
  if (!open.length) return;
  const via = listSv(uniqText(channels.map((ch) => CLOSE_TEXT[ch])));
  const doneNote = input.template === "kallelse" ? `Kallelsen skickades med ${via} vid ombokningen.` : `Inbjudan skickades med ${via}.`;
  for (const x of open) {
    await ctx.system.table("tasks").update(x.id, { status: "done", doneAt: ctx.now(), doneBy: SYSTEM_ACTOR.userId, doneNote });
    await ctx.audit({
      action: "task.done", entity: "task", entityId: x.id, contractId: c.contractId,
      details: { kind: "participant_contact", caseId: c.id, template: input.template, auto: true, channels: [...channels] },
    });
  }
}

const CLOSE_TEXT: Record<ParticipantChannel, string> = { email: "e-post", sms: "SMS", call: "utringning", brev: "brev" };
const uniqText = (xs: readonly string[]): string[] => [...new Set(xs)];

/** Kanalerna som är skriftliga utskick. Samtalet hänvisar till dem; brevet skickas för hand och kan inte misslyckas. */
const WRITTEN: readonly string[] = ["email", "sms", "brev"];

/**
 * Jobbet send_message (servern): ett utskick till en deltagare stoppades eller misslyckades när det skulle skickas – t.ex. spärrlistan
 * för e-post, 46elks avvisade numret eller alla försök tog slut. Gick inget annat skriftligt utskick i samma omgång (samma ärende,
 * mall, tid och text) får samordnaren uppgiften att ringa – samma text och dubblettkontroll som när ingen kanal fanns. Ett
 * utskick som fortfarande ligger i kön avgör själv när det är klart. Kallelsen: bara när den gäller ärendets nuvarande första
 * möte (en ombokning har en egen omgång). Vilande spärr: ingen uppgift för skyddade personuppgifter.
 * ctx = systemstegens Ctx (service role). Returnerar uppgiftens id, eller null när ingen uppgift behövs.
 */
export async function participantSendStopped(ctx: Ctx, messageId: string, invitation: { when: LocalDateTime; place: string } | null | undefined): Promise<string | null> {
  if (!invitation) return null;
  const out = ctx.system.table("outbound_messages");
  const row = await out.get(messageId);
  if (!row || !row.caseId || !isParticipantRecipient(row.to) || !isParticipantTemplate(row.template)) return null;
  if ((row.channel !== "email" && row.channel !== "sms") || (row.status !== "suppressed" && row.status !== "failed")) return null;
  const c = await ctx.system.table("cases").get(row.caseId);
  const person = c ? await ctx.system.table("persons").get(c.personId) : null;
  if (!c || !person || person.protectedIdentity) return null;
  if (row.template === "kallelse" && c.firstMeetingAt !== invitation.when) return null;
  const round = (await out.list({ caseId: c.id, template: row.template })).filter((m) => m.createdAt === row.createdAt && m.body === row.body && WRITTEN.includes(m.channel));
  if (round.some((m) => m.status === "queued" || m.status === "sent" || m.status === "manual")) return null;
  // Varför: orsaken per kanal; en kanal utan rad betyder att uppgiften saknades när utskicket lades.
  const mail = round.find((m) => m.channel === "email");
  const sms = round.find((m) => m.channel === "sms");
  const reasons: UnreachableReason[] = [mail ? reasonOfRow(mail) : "no_email", sms ? reasonOfRow(sms) : "no_phone"];
  return contactTask(ctx, { caseId: c.id, template: row.template, when: invitation.when, place: invitation.place }, c, reasons);
}
