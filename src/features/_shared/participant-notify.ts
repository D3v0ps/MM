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
// SMS och utringning som inte är kopplade sparas i utskicksloggen som stoppade med orsak – så syns varför inget SMS gick.
// Isomorf: samma kod i Next.js och i prototypen. Utskicken går bara via ctx.notify (servern: src/server/notify).
import type { Ctx, OutgoingMessage } from "@/api/server";
import { hasPhone } from "@/core/phone";
import { fmtTime, fmtWeekday, type LocalDateTime } from "@/core/time";
import type { Case, Person, PreferredContact, Task } from "@/data/schema";
import { CONTACT_PHONE } from "./contact";
import { messagingOf, PARTICIPANT_TO, type MessagingStatus, type ParticipantChannel } from "./messaging-port";

/** Mallarna för utskick till deltagare (src/server/notify/templates.ts och adminvyns mallkatalog). */
export type ParticipantTemplate = "kallelse" | "aktivitetsinbjudan";

/** Det kanalvalet behöver om deltagaren. */
export type ParticipantContact = Pick<Person, "email" | "phone" | "preferredContact" | "address">;

export type ChannelPlan = {
  /** Kanalerna som utskicket går till, i ordning. Tom = ingen kanal (uppgift till samordnaren). */
  send: ParticipantChannel[];
  /** Kanaler som hade använts om de varit kopplade – sparas som stoppade med orsak. */
  off: ("sms" | "call")[];
};

/**
 * Texten i den inspelning som spelas upp vid utringningen (MM_CALL_AUDIO_URL, public/ljud/README.md). Sparas som utskickets
 * text i utskicksloggen, så att det syns vad deltagaren fick höra. Inga personuppgifter, ingen tid – den står i SMS:et och mejlet.
 */
export const CALL_RECORDING_TEXT =
  `Inspelat meddelande: Hej, det här är Miljonbemanning. Du har fått en inbjudan till ett möte hos oss. Tid och plats står i ditt SMS eller mejl.${CONTACT_PHONE ? ` Har du frågor, ring ${CONTACT_PHONE}.` : ""}`;

const isEmail = (v: string | null | undefined): boolean => {
  const s = String(v ?? "").trim();
  return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
};

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
  const phone = hasPhone(p.phone);
  const use = new Set<ParticipantChannel>();
  const off: ("sms" | "call")[] = [];
  if (isEmail(p.email)) use.add("email");
  if (phone) {
    if (status.sms.connected) use.add("sms");
    else off.push("sms");
  }
  if ((opts.letter ?? true) && p.preferredContact === "letter" && (p.address ?? "").trim()) use.add("brev");
  // Utringningen hänvisar till SMS:et eller mejlet – den görs bara när något av dem går iväg.
  if (phone && (use.has("email") || use.has("sms"))) {
    if (status.call.connected) use.add("call");
    else off.push("call");
  }
  const order = ORDER[p.preferredContact] ?? ORDER.sms;
  return { send: order.filter((ch) => use.has(ch)), off };
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

/** Uppgiften till samordnaren när ingen kanal fanns. Ärendenumret, tiden och platsen – aldrig namnet. */
export function contactTaskText(template: ParticipantTemplate, caseNumber: string, when: LocalDateTime, place: string, p: ParticipantContact): string {
  const head = `${TASK_START[template]} – ärende ${caseNumber}, ${fmtWeekday(when)} kl. ${fmtTime(when)}, ${placeText(place)}.`;
  const why = hasPhone(p.phone)
    ? `${template === "kallelse" ? "Kallelsen" : "Inbjudan"} kunde inte skickas: deltagaren har ingen e-postadress och SMS är inte kopplat.`
    : "Deltagaren har varken e-postadress eller telefonnummer – fråga beställande handläggare.";
  return `${head} ${why}`;
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
  /** Kanalerna som utskicket gick till (i kön, skickat eller brev att skicka för hand). Tom = ingen kanal. */
  channels: ParticipantChannel[];
  /** Kanaler som inte är kopplade – stoppade med orsak i utskicksloggen. */
  off: ("sms" | "call")[];
  /** Uppgiften till samordnaren när ingen kanal fanns (ny eller uppdaterad). */
  taskId: string | null;
  /** Inget utskick: skyddade personuppgifter (vilande spärr) eller ärendet/personen går inte att läsa för användaren. */
  blocked: boolean;
  /** En mening i klarspråk till den som bokade, t.ex. "Kallelsen är skickad med e-post." */
  summary: string;
};

const CHANNEL_TEXT: Record<"email" | "sms", string> = { email: "e-post", sms: "SMS" };
const listSv = (xs: readonly string[]): string => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} och ${xs[xs.length - 1]}` : xs.join(""));

/** Meningen till den som bokade mötet eller bjöd in. Brevet skickas för hand; samtalet hänvisar till SMS:et eller mejlet. */
export function notifySummary(template: ParticipantTemplate, r: Pick<NotifyParticipantResult, "channels" | "taskId" | "blocked">): string {
  const what = template === "kallelse" ? "Kallelsen" : "Inbjudan";
  if (r.blocked) return `${what} skickades inte.`;
  const sent = r.channels.filter((c): c is "email" | "sms" => c === "email" || c === "sms");
  const letter = r.channels.includes("brev");
  const call = r.channels.includes("call") ? " Deltagaren blir också uppringd med ett inspelat meddelande." : "";
  if (sent.length) return `${what} är skickad med ${listSv(sent.map((c) => CHANNEL_TEXT[c]))}.${letter ? " Ett brev skickas också för hand." : ""}${call}`;
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
  const plan = planParticipantChannels(person, messagingOf(ctx), { letter: input.template === "kallelse" });
  const text = participantMessage(input.template, input.when, input.place);
  const send = (ch: ParticipantChannel) =>
    ctx.notify({
      // Brev är en egen kanal i utskicksloggen (outbound_messages.channel "brev") – som förut. OutgoingMessage säger "letter".
      channel: ch as OutgoingMessage["channel"],
      to: PARTICIPANT_TO[ch],
      template: input.template,
      body: ch === "call" ? CALL_RECORDING_TEXT : text,
      caseId: c.id,
    });
  for (const ch of plan.send) await send(ch);
  // Inte kopplat: en rad i utskicksloggen med orsaken (servern och minnesläget stoppar dem utan att skicka).
  for (const ch of plan.off) await send(ch);

  let taskId: string | null = null;
  if (!plan.send.length) taskId = await contactTask(ctx, input, c, person);
  const result = { channels: plan.send, off: plan.off, taskId, blocked: false };
  return { ...result, summary: notifySummary(input.template, result) };
}

/**
 * Uppgift till samordnaren när ingen kanal fanns. En öppen uppgift för kallelsen i samma ärende uppdateras (ombokning) i stället
 * för att dubbleras; en inbjudan med samma tid och plats skapas inte två gånger.
 * ctx.system: uppgiften går till en annan roll (samordnaren) och dubblettkontrollen ska se alla öppna uppgifter.
 */
async function contactTask(ctx: Ctx, input: NotifyParticipantInput, c: Pick<Case, "id" | "caseNumber" | "contractId">, person: ParticipantContact): Promise<string> {
  const t = ctx.system.table("tasks");
  const text = contactTaskText(input.template, c.caseNumber, input.when, input.place, person);
  const open = (await t.list({ kind: "participant_contact", status: "open" })).filter((x) => x.caseIds.includes(input.caseId));
  const same = open.find((x) => (input.template === "kallelse" ? x.text.startsWith(TASK_START.kallelse) : x.text === text));
  if (same) {
    if (same.text !== text) await t.update(same.id, { text });
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
