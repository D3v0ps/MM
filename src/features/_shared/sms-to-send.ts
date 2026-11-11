// SMS att skicka (Karims beslut 2026-11-11, SPEC §9): SMS till deltagare är inte kopplat i produktionen och e-post till deltagare
// stoppas av spärrlistan – coachen skickar SMS:et själv. Coachens Min vecka visar en rad per SMS, för alla deltagare i avtalen där
// personen är coach (alla ser alla, punkt 6):
//   veckans tider      från fredag kl. 00.00 (Stockholms tid) för nästa ISO-vecka: en rad per deltagare i en pågående eller pausad
//                      insats med minst ett tillfälle i veckan som inte är inställt (egna tillfällen och gruppaktiviteter där
//                      deltagaren är inbjuden) – inte en pausad vecka. Raden står kvar tills den är markerad eller veckan är slut;
//                      texten följer schemat (bara tillfällen som inte har börjat).
//   kunde inte skickas kallelsen, inbjudan, ändrad tid eller plats (också Ändra tid, punkt 4) och inställd aktivitet: samordnaren
//                      har en öppen uppgift att ringa deltagaren (participant_contact) och utskicksloggen har SMS:et som stoppades
//                      eller misslyckades – texten är exakt den som skulle ha skickats. Går meddelandet fram automatiskt (SMS:et
//                      kopplat, eller mejlet) finns ingen uppgift och ingen rad.
// Samordnarens uppgift och coachens rad hör ihop: Markera som skickat stänger uppgiften, och klarmarkerar samordnaren uppgiften
// försvinner raden. Raderna räknas fram varje gång – inget genererat sparas. Markera som skickat sparar en rad i utskicksloggen
// (status sent_manually, 0042) med ett id som bestäms av raden – två samtidiga tryck ger en rad.
// Telefonnumret läses bara för ärenden där deltagarkortet visar kontaktuppgifterna (åtkomst full) – aldrig för kommunen eller
// ekonomen (frågan är bara coachens) – och lämnas bara ut till skärmen, aldrig till utskicksloggen eller revisionsloggen.
// Bara för hanterare – importeras aldrig av skärmar.
import type { Ctx } from "@/api/server";
import { caseAccessIn } from "@/core/access";
import { hasPhone } from "@/core/contact";
import { addDays, dayOf, isoWeek, monday, weekday, type LocalDateTime, type WeekKey } from "@/core/time";
import type { Activity, Case, OutboundMessage, Person } from "@/data/schema";
import { accessSourceFor } from "../rapporter/load";
import { coachCases } from "./coach-cases";
import { PARTICIPANT_TO } from "./messaging-port";
import { messageMatchesTask, PARTICIPANT_TEMPLATES, templateOfContactTask, weeklyScheduleMessage, type ParticipantTemplate } from "./participant-notify";

/** Mallen för veckans tider i utskicksloggen (SMS som coachen skickar själv). */
export const SCHEDULE_TEMPLATE = "veckoschema";
export type SmsKind = typeof SCHEDULE_TEMPLATE | ParticipantTemplate;

export type SmsToSend = {
  /** "vecka:<ärendets id>:<ISO-vecka>" eller "uppgift:<uppgiftens id>" – samma rad, samma nyckel. */
  key: string;
  kind: SmsKind;
  case: Case;
  person: Person;
  /** Numret att kopiera (personens nuvarande nummer). Bara till skärmen. */
  phone: string;
  /** SMS:et: bara tid, plats och Miljonbemannings telefonnummer (CLAUDE.md punkt 9). */
  text: string;
  /** Veckans tider: veckan. */
  week: { key: WeekKey; no: number } | null;
  /** Meddelandet som inte kunde skickas: samordnarens uppgift att ringa deltagaren. */
  taskId: string | null;
  /** Sorteringen: veckans första tid, eller tiden då meddelandet skulle ha skickats. */
  sortAt: LocalDateTime;
};

/** Insatserna som raderna gäller: bekräftade (kallelsen), pågående och pausade. */
const OPEN = ["confirmed", "active", "paused"] as const;
/** Veckans tider gäller pågående och pausade insatser (en pausad vecka får ingen rad). */
const RUNNING: readonly Case["status"][] = ["active", "paused"];
/** Statusarna för ett SMS som inte gick fram automatiskt. */
const NOT_DELIVERED: readonly OutboundMessage["status"][] = ["suppressed", "failed"];

/** Id:t för raden i utskicksloggen när SMS:et markerats som skickat – bestäms av raden (två samtidiga tryck ger en rad). */
export const manualSmsId = (key: string): string => `out-hand-${key.replace(/[^A-Za-z0-9-]/g, "-")}`;
/** Nyckeln för veckans tider. */
export const scheduleKey = (caseId: string, week: WeekKey): string => `vecka:${caseId}:${week}`;
/** Nyckeln för ett meddelande som inte kunde skickas. */
export const taskKey = (taskId: string): string => `uppgift:${taskId}`;

/**
 * Veckorna med veckans tider i dag: den här veckan (raden från i fredags står kvar tills veckan är slut, med tillfällena som
 * inte har börjat) och – från fredag kl. 00.00 – nästa vecka. now är Stockholms tid (ctx.now()).
 */
export function scheduleWeeks(now: LocalDateTime): { key: WeekKey; no: number; mon: string; upcoming: boolean }[] {
  const today = dayOf(now);
  const mon = monday(today);
  const weeks = [{ mon, upcoming: false }];
  if (weekday(today) >= 4) weeks.push({ mon: addDays(mon, 7), upcoming: true });
  return weeks.map((w) => ({ ...w, key: isoWeek(w.mon).key, no: isoWeek(w.mon).week }));
}

/**
 * Raderna i SMS att skicka för coachen (ctx.actor har rollen coach – hanteraren kontrollerar). only = bara ett ärende (Markera
 * som skickat räknar om just den raden).
 */
export async function smsToSend(ctx: Ctx, only?: { caseId: string }): Promise<SmsToSend[]> {
  const now = ctx.now();
  const cases = await coachCases(ctx, { status: { in: [...OPEN] }, ...(only ? { id: only.caseId } : {}) });
  if (!cases.length) return [];
  // Kontaktuppgifterna: samma regel som deltagarkortet (åtkomst full). Personen läses via ctx.repo – den som inte får se
  // personen får ingen rad (och den vilande spärren för skyddade personuppgifter gäller).
  const src = await accessSourceFor(ctx, cases);
  const full = cases.filter((c) => caseAccessIn(c, ctx.actor, src) === "full");
  const persons = full.length ? await ctx.repo.table("persons").list({ id: { in: [...new Set(full.map((c) => c.personId))] } }) : [];
  const personOf = new Map(persons.map((p) => [p.id, p]));
  const reach = full
    .map((c) => ({ c, p: personOf.get(c.personId) }))
    .filter((x): x is { c: Case; p: Person } => !!x.p && !x.p.protectedIdentity && hasPhone(x.p.phone ?? ""));
  if (!reach.length) return [];
  const [weekly, undelivered] = await Promise.all([scheduleRows(ctx, now, reach), undeliveredRows(ctx, now, reach)]);
  return [...weekly, ...undelivered].sort((a, b) => (a.sortAt < b.sortAt ? -1 : a.sortAt > b.sortAt ? 1 : a.key < b.key ? -1 : 1));
}

/** Redan markerade som skickade: id:n i utskicksloggen. ctx.system: coachen läser inte utskicksloggen – bara ja eller nej per rad. */
async function markedIds(ctx: Ctx, keys: readonly string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const rows = await ctx.system.table("outbound_messages").pick(["id"], { id: { in: keys.map(manualSmsId) } });
  return new Set(rows.map((r) => r.id));
}

/** Veckans tider: en rad per deltagare och vecka med tillfällen som inte har börjat och inte är inställda. */
async function scheduleRows(ctx: Ctx, now: LocalDateTime, reach: readonly { c: Case; p: Person }[]): Promise<SmsToSend[]> {
  const running = reach.filter((x) => RUNNING.includes(x.c.status));
  if (!running.length) return [];
  const weeks = scheduleWeeks(now);
  const from = `${weeks[0].mon}T00:00`;
  const to = `${addDays(weeks[weeks.length - 1].mon, 7)}T00:00`;
  // Tillfällena via ctx.repo (policyn för activities). Gruppaktiviteternas tillfällen: inte en inställd aktivitet.
  const acts = await ctx.repo.table("activities").list({ caseId: { in: running.map((x) => x.c.id) }, startsAt: { gte: from, lt: to } });
  const groupIds = [...new Set(acts.map((a) => a.groupActivityId).filter((x): x is string => !!x))];
  const cancelled = new Set(
    groupIds.length ? (await ctx.repo.table("group_activities").list({ id: { in: groupIds } })).filter((g) => !!g.cancelledAt).map((g) => g.id) : [],
  );
  const upcoming = acts.filter((a) => a.startsAt > now && !(a.groupActivityId && cancelled.has(a.groupActivityId)));
  const candidates: { x: { c: Case; p: Person }; w: (typeof weeks)[number]; slots: Activity[] }[] = [];
  for (const x of running) {
    for (const w of weeks) {
      if (x.c.pausedWeeks.includes(w.key)) continue;
      const end = addDays(w.mon, 7);
      const slots = upcoming.filter((a) => a.caseId === x.c.id && dayOf(a.startsAt) >= w.mon && dayOf(a.startsAt) < end);
      if (slots.length) candidates.push({ x, w, slots });
    }
  }
  const marked = await markedIds(ctx, candidates.map((k) => scheduleKey(k.x.c.id, k.w.key)));
  return candidates
    .filter((k) => !marked.has(manualSmsId(scheduleKey(k.x.c.id, k.w.key))))
    .map((k) => {
      const slots = [...k.slots].sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
      return {
        key: scheduleKey(k.x.c.id, k.w.key), kind: SCHEDULE_TEMPLATE, case: k.x.c, person: k.x.p, phone: (k.x.p.phone ?? "").trim(),
        text: weeklyScheduleMessage(slots.map((a) => ({ startsAt: a.startsAt, place: a.location })), k.w.upcoming),
        week: { key: k.w.key, no: k.w.no }, taskId: null, sortAt: slots[0].startsAt,
      };
    });
}

/**
 * Meddelanden som inte kunde skickas automatiskt: samordnarens öppna uppgift att ringa deltagaren och SMS:et i utskicksloggen
 * för samma möte eller aktivitet (samma mall, tid och plats) – det senaste. ctx.system: uppgiften är samordnarens och
 * utskicksloggen läses inte av coachen – bara för ärenden som coachen ser, och bara texten (tid, plats och telefonnummer) och
 * id:n lämnas ut.
 */
async function undeliveredRows(ctx: Ctx, now: LocalDateTime, reach: readonly { c: Case; p: Person }[]): Promise<SmsToSend[]> {
  const byCase = new Map(reach.map((x) => [x.c.id, x]));
  const tasks = (await ctx.system.table("tasks").list({ kind: "participant_contact", status: "open" }))
    .filter((t) => t.caseIds.length === 1 && byCase.has(t.caseIds[0]) && !!templateOfContactTask(t.text));
  if (!tasks.length) return [];
  const sms = (await ctx.system.table("outbound_messages").list({ caseId: { in: [...new Set(tasks.map((t) => t.caseIds[0]))] }, channel: "sms" }))
    .filter((m) => m.to === PARTICIPANT_TO.sms && NOT_DELIVERED.includes(m.status) && (PARTICIPANT_TEMPLATES as readonly string[]).includes(m.template))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  const marked = await markedIds(ctx, tasks.map((t) => taskKey(t.id)));
  const out: SmsToSend[] = [];
  for (const t of tasks) {
    if (marked.has(manualSmsId(taskKey(t.id)))) continue;
    const x = byCase.get(t.caseIds[0]) as { c: Case; p: Person };
    const template = templateOfContactTask(t.text) as ParticipantTemplate;
    // Kallelsen: bara inför ärendets första möte (bekräftat, mötet har inte varit).
    if (template === "kallelse" && !(x.c.status === "confirmed" && !!x.c.firstMeetingAt && x.c.firstMeetingAt > now)) continue;
    const m = sms.find((r) => r.caseId === x.c.id && r.template === template && messageMatchesTask(template, r.body, x.c.caseNumber, t.text));
    // Inget SMS i utskicksloggen (deltagaren hade inget nummer när meddelandet skulle skickas): ingen text att skicka – samordnaren ringer.
    if (!m) continue;
    out.push({ key: taskKey(t.id), kind: template, case: x.c, person: x.p, phone: (x.p.phone ?? "").trim(), text: m.body, week: null, taskId: t.id, sortAt: m.createdAt });
  }
  return out;
}
