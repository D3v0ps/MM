// SMS att skicka (Karims beslut 2026-11-11, SPEC §9): SMS till deltagare är inte kopplat i produktionen och e-post till deltagare
// stoppas av spärrlistan – coachen skickar SMS:et själv. Coachens Min vecka visar raderna för alla deltagare i avtalen där personen
// är coach (alla ser alla, punkt 6) – skärmen visar först coachens egna (huvudcoach eller i teamet, `mine`) med Visa alla för resten:
//   veckans tider      (granskningen 2026-11-11) från fredag kl. 00.00 (Stockholms tid) för nästa ISO-vecka – måndag–torsdag för
//                      den här veckan – och bara tills veckans första tillfälle börjar: en rad per deltagare i en pågående eller
//                      pausad insats med minst ett tillfälle i veckan som inte är inställt (egna tillfällen och gruppaktiviteter där
//                      deltagaren är inbjuden – inte praktikdagar, praktiken har egna tider) och inte en pausad vecka. Högst en rad
//                      per deltagare. Texten säger "nästa vecka" före veckans måndag och "den här veckan" sedan.
//   kunde inte skickas kallelsen, inbjudan, ändrad tid eller plats (också Ändra tid, punkt 4) och inställd aktivitet: samordnaren
//                      har en öppen uppgift att ringa deltagaren (participant_contact) och utskicksloggen har SMS:et som stoppades
//                      eller misslyckades – texten är exakt den som skulle ha skickats. Går meddelandet fram automatiskt (SMS:et
//                      kopplat, eller mejlet) finns ingen uppgift och ingen rad. Inbjudan, ändrad och inställd aktivitet: bara tills
//                      aktivitetens tid har passerat (jobbet stänger sedan uppgiften, closeExpiredContactTasks). Inbjudan och ändrad
//                      tid: bara så länge deltagaren har ett tillfälle på den tiden och platsen – och inte medan veckans tider för
//                      samma vecka har tillfället (ett SMS räcker).
// Samordnarens uppgift och coachens rad hör ihop: Markera som skickat stänger uppgiften, och klarmarkerar samordnaren uppgiften
// försvinner raden. Raderna räknas fram varje gång – inget genererat sparas. Markera som skickat sparar en rad i utskicksloggen
// (status sent_manually, 0042) med ett id som bestäms av raden – två samtidiga tryck ger en rad – och jämför det coachen såg utan
// klockan: veckans tillfällen (id och tid) eller meddelandets id (smsToMark).
// Telefonnumret läses bara för ärenden där deltagarkortet visar kontaktuppgifterna (åtkomst full) – aldrig för kommunen eller
// ekonomen (frågan är bara coachens) – och lämnas bara ut till skärmen, aldrig till utskicksloggen eller revisionsloggen.
// Bara för hanterare – importeras aldrig av skärmar.
import type { Ctx } from "@/api/server";
import { caseAccessIn } from "@/core/access";
import { hasPhone } from "@/core/contact";
import { addDays, dayOf, isoWeek, monday, weekday, type LocalDate, type LocalDateTime, type WeekKey } from "@/core/time";
import type { Activity, Case, OutboundMessage, Person } from "@/data/schema";
import { accessSourceFor } from "../rapporter/load";
import { coachCases } from "./coach-cases";
import { PARTICIPANT_TO } from "./messaging-port";
import {
  messageMatchesTask, PARTICIPANT_TEMPLATES, slotOfActivity, slotOfMessage, taskMatchesSlot, templateOfContactTask, weeklyScheduleMessage,
  whenInText, type ParticipantTemplate,
} from "./participant-notify";

/** Mallen för veckans tider i utskicksloggen (SMS som coachen skickar själv). */
export const SCHEDULE_TEMPLATE = "veckoschema";
export type SmsKind = typeof SCHEDULE_TEMPLATE | ParticipantTemplate;
/** Ett tillfälle i veckans tider: id och tid – det Markera som skickat jämför – och platsen (bara på servern). */
export type SmsSlot = { id: string; startsAt: LocalDateTime; location: string };

export type SmsToSend = {
  /** "vecka:<ärendets id>:<ISO-vecka>" eller "uppgift:<uppgiftens id>" – samma rad, samma nyckel. */
  key: string;
  kind: SmsKind;
  case: Case;
  person: Person;
  /** Deltagaren är coachens egen: huvudcoach eller i teamet (tilldelningen – alla ser alla, punkt 6). */
  mine: boolean;
  /** Numret att kopiera (personens nuvarande nummer). Bara till skärmen. */
  phone: string;
  /** SMS:et: bara tid, plats och Miljonbemannings telefonnummer (CLAUDE.md punkt 9). */
  text: string;
  /** Texterna som Markera som skickat godtar: veckans tider med "nästa vecka" och "den här veckan" (texten coachen kopierade
   *  före måndagen gäller också efteråt), annars meddelandets text. */
  accepted: string[];
  /** Veckans tider: veckan och tillfällena. */
  week: { key: WeekKey; no: number } | null;
  slots: SmsSlot[] | null;
  /** Meddelandet som inte kunde skickas: samordnarens uppgift att ringa deltagaren och SMS:et i utskicksloggen. */
  taskId: string | null;
  messageId: string | null;
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

export type ScheduleWeek = { key: WeekKey; no: number; mon: LocalDate };
const weekOf = (mon: LocalDate): ScheduleWeek => ({ key: isoWeek(mon).key, no: isoWeek(mon).week, mon });

/**
 * Veckan för veckans tider i dag (granskningen 2026-11-11): från fredag kl. 00.00 nästa vecka, måndag–torsdag den här veckan (raden
 * står bara tills veckans första tillfälle börjar). now är Stockholms tid (ctx.now()).
 */
export function scheduleWeek(now: LocalDateTime): ScheduleWeek {
  const today = dayOf(now);
  return weekOf(weekday(today) >= 4 ? addDays(monday(today), 7) : monday(today));
}
/** Veckan i en nyckel för veckans tider ("2027-W06") – måndagen. null för en nyckel som inte är en vecka. */
function weekOfKey(key: string): ScheduleWeek | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) return null;
  // Måndagen i ISO-veckan: 4 januari ligger alltid i vecka 1.
  const mon = addDays(monday(`${m[1]}-01-04`), (Number(m[2]) - 1) * 7);
  return isoWeek(mon).key === key ? weekOf(mon) : null;
}

type Reach = { c: Case; p: Person; mine: boolean };

/**
 * Raderna i SMS att skicka för coachen (ctx.actor har rollen coach – hanteraren kontrollerar): det som visas nu. Varje rad har
 * `mine` – skärmen och siffran vid Min vecka visar först coachens egna.
 */
export async function smsToSend(ctx: Ctx): Promise<SmsToSend[]> {
  const now = ctx.now();
  const reach = await reachable(ctx);
  if (!reach.length) return [];
  const weekly = await scheduleRows(ctx, reach, scheduleWeek(now), now);
  const undelivered = await undeliveredRows(ctx, reach, now, weekly);
  return [...weekly, ...undelivered].sort((a, b) => (a.sortAt < b.sortAt ? -1 : a.sortAt > b.sortAt ? 1 : a.key < b.key ? -1 : 1));
}

/** Siffran vid Min vecka (granskningen 2026-11-11): coachens egna meddelanden att skicka, och veckans tider som en sak. */
export const smsTaskCount = (rows: readonly SmsToSend[]): number =>
  rows.filter((r) => r.mine && r.kind !== SCHEDULE_TEMPLATE).length + (rows.some((r) => r.mine && r.kind === SCHEDULE_TEMPLATE) ? 1 : 0);

/**
 * Raden som Markera som skickat gäller, räknad utan klockan (granskningen 2026-11-11): veckans tider för veckan i nyckeln med alla
 * veckans tillfällen, eller meddelandet för uppgiften – också när tiden har passerat sedan coachen kopierade texten. null när raden
 * inte finns (uppgiften är stängd, ärendet syns inte, ingen telefon, redan markerad räknas av hanteraren).
 */
export async function smsToMark(ctx: Ctx, key: string): Promise<SmsToSend | null> {
  const [kind, ...rest] = key.split(":");
  if (kind === "vecka" && rest.length === 2) {
    const week = weekOfKey(rest[1]);
    const x = week ? (await reachable(ctx, rest[0]))[0] : null;
    return week && x ? ((await scheduleRows(ctx, [x], week, null))[0] ?? null) : null;
  }
  if (kind === "uppgift" && rest.length === 1) {
    // Uppgiften (samordnarens) läses med ctx.system bara för att hitta ärendet – raden räknas sedan via coachens behörighet.
    const t = await ctx.system.table("tasks").get(rest[0]);
    const x = t?.caseIds.length === 1 ? (await reachable(ctx, t.caseIds[0]))[0] : null;
    return x ? ((await undeliveredRows(ctx, [x], null, [])).find((r) => r.key === key) ?? null) : null;
  }
  return null;
}

/**
 * Deltagarna som raderna kan gälla: ärenden i coachens avtal med åtkomst full (samma regel som deltagarkortet – personen läses via
 * ctx.repo och den vilande spärren för skyddade personuppgifter gäller) och ett telefonnummer. mine = huvudcoach eller i teamet.
 */
async function reachable(ctx: Ctx, onlyCaseId?: string): Promise<Reach[]> {
  const cases = await coachCases(ctx, { status: { in: [...OPEN] }, ...(onlyCaseId ? { id: onlyCaseId } : {}) });
  if (!cases.length) return [];
  const src = await accessSourceFor(ctx, cases);
  const full = cases.filter((c) => caseAccessIn(c, ctx.actor, src) === "full");
  if (!full.length) return [];
  const [persons, team] = await Promise.all([
    ctx.repo.table("persons").list({ id: { in: [...new Set(full.map((c) => c.personId))] } }),
    ctx.repo.table("case_team").pick(["caseId"], { caseId: { in: full.map((c) => c.id) }, userId: ctx.actor.userId }),
  ]);
  const personOf = new Map(persons.map((p) => [p.id, p]));
  const myTeam = new Set(team.map((t) => t.caseId));
  return full
    .map((c) => ({ c, p: personOf.get(c.personId), mine: c.leadCoachId === ctx.actor.userId || myTeam.has(c.id) }))
    .filter((x): x is Reach => !!x.p && !x.p.protectedIdentity && hasPhone(x.p.phone ?? ""));
}

/** Redan markerade som skickade: id:n i utskicksloggen. ctx.system: coachen läser inte utskicksloggen – bara ja eller nej per rad. */
async function markedIds(ctx: Ctx, keys: readonly string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const rows = await ctx.system.table("outbound_messages").pick(["id"], { id: { in: keys.map(manualSmsId) } });
  return new Set(rows.map((r) => r.id));
}

const byTime = (a: { startsAt: string }, b: { startsAt: string }) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0);

/**
 * Veckans tider för veckan: en rad per deltagare med tillfällen i veckan som inte är inställda och inte är praktikdagar. now = det
 * som visas nu: bara tills veckans första tillfälle börjar och inte redan markerad. now = null (Markera som skickat): alla veckans
 * tillfällen, oberoende av klockan – hanteraren ser själv om raden redan är markerad.
 */
async function scheduleRows(ctx: Ctx, reach: readonly Reach[], week: ScheduleWeek, now: LocalDateTime | null): Promise<SmsToSend[]> {
  const running = reach.filter((x) => RUNNING.includes(x.c.status) && !x.c.pausedWeeks.includes(week.key));
  if (!running.length) return [];
  // Tillfällena via ctx.repo (policyn för activities). Gruppaktiviteternas tillfällen: inte en inställd aktivitet.
  const acts = (await ctx.repo.table("activities").list({ caseId: { in: running.map((x) => x.c.id) }, startsAt: { gte: `${week.mon}T00:00`, lt: `${addDays(week.mon, 7)}T00:00` } }))
    .filter((a) => a.kind !== "praktikdag");
  const groupIds = [...new Set(acts.map((a) => a.groupActivityId).filter((x): x is string => !!x))];
  const cancelled = new Set(
    groupIds.length ? (await ctx.repo.table("group_activities").list({ id: { in: groupIds } })).filter((g) => !!g.cancelledAt).map((g) => g.id) : [],
  );
  const live = acts.filter((a) => !(a.groupActivityId && cancelled.has(a.groupActivityId)));
  const candidates = running
    .map((x) => ({ x, slots: live.filter((a) => a.caseId === x.c.id).sort(byTime) }))
    .filter((k) => k.slots.length > 0 && (now === null || k.slots[0].startsAt > now));
  const marked = now === null ? new Set<string>() : await markedIds(ctx, candidates.map((k) => scheduleKey(k.x.c.id, week.key)));
  // Texten: "nästa vecka" före veckans måndag (från fredag), annars "den här veckan".
  const upcoming = now !== null && dayOf(now) < week.mon;
  const place = (a: Activity): SmsSlot => ({ id: a.id, startsAt: a.startsAt, location: a.location });
  return candidates
    .filter((k) => !marked.has(manualSmsId(scheduleKey(k.x.c.id, week.key))))
    .map((k) => ({
      key: scheduleKey(k.x.c.id, week.key), kind: SCHEDULE_TEMPLATE, case: k.x.c, person: k.x.p, mine: k.x.mine, phone: (k.x.p.phone ?? "").trim(),
      text: scheduleText(k.slots, upcoming), accepted: [scheduleText(k.slots, true), scheduleText(k.slots, false)], week: { key: week.key, no: week.no },
      slots: k.slots.map(place),
      taskId: null, messageId: null, sortAt: k.slots[0].startsAt,
    }));
}

/** Texten för veckans tider (weeklyScheduleMessage) ur tillfällena. */
export const scheduleText = (slots: readonly Pick<Activity, "startsAt" | "location">[], upcoming: boolean): string =>
  weeklyScheduleMessage(slots.map((a) => ({ startsAt: a.startsAt, place: a.location })), upcoming);

/**
 * Meddelanden som inte kunde skickas automatiskt: samordnarens öppna uppgift att ringa deltagaren och SMS:et i utskicksloggen
 * för samma möte eller aktivitet (samma mall, tid och plats) – det senaste. ctx.system: uppgiften är samordnarens och
 * utskicksloggen läses inte av coachen – bara för ärenden som coachen ser, och bara texten (tid, plats och telefonnummer) och
 * id:n lämnas ut. now = det som visas nu: inbjudan, ändrad och inställd aktivitet bara tills aktivitetens tid har passerat, och
 * inbjudan och ändrad tid inte medan veckans tider (weekly) har tillfället. now = null (Markera som skickat): utan klockan.
 * Inbjudan och ändrad tid alltid bara när deltagaren har ett tillfälle på den tiden och platsen (granskningen 2026-11-11).
 */
async function undeliveredRows(ctx: Ctx, reach: readonly Reach[], now: LocalDateTime | null, weekly: readonly SmsToSend[]): Promise<SmsToSend[]> {
  const byCase = new Map(reach.map((x) => [x.c.id, x]));
  const tasks = (await ctx.system.table("tasks").list({ kind: "participant_contact", status: "open" }))
    .filter((t) => t.caseIds.length === 1 && byCase.has(t.caseIds[0]) && !!templateOfContactTask(t.text));
  if (!tasks.length) return [];
  const caseIds = [...new Set(tasks.map((t) => t.caseIds[0]))];
  const sms = (await ctx.system.table("outbound_messages").list({ caseId: { in: caseIds }, channel: "sms" }))
    .filter((m) => m.to === PARTICIPANT_TO.sms && NOT_DELIVERED.includes(m.status) && (PARTICIPANT_TEMPLATES as readonly string[]).includes(m.template))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  const marked = await markedIds(ctx, tasks.map((t) => taskKey(t.id)));
  const found = tasks.flatMap((t) => {
    const x = byCase.get(t.caseIds[0]) as Reach;
    const template = templateOfContactTask(t.text) as ParticipantTemplate;
    const m = sms.find((r) => r.caseId === x.c.id && r.template === template && messageMatchesTask(template, r.body, x.c.caseNumber, t.text));
    const slot = m ? slotOfMessage(template, m.body) : null;
    // Inget SMS i utskicksloggen (deltagaren hade inget nummer när meddelandet skulle skickas): ingen text att skicka – samordnaren ringer.
    return m && slot && !marked.has(manualSmsId(taskKey(t.id))) ? [{ t, x, template, m, slot, when: whenInText(slot, m.createdAt) }] : [];
  });
  // Deltagarens tillfällen på meddelandenas tider (inbjudan och ändrad tid gäller ett tillfälle som finns).
  const times = [...new Set(found.flatMap((f) => (f.when && (f.template === "aktivitetsinbjudan" || f.template === "aktivitet_andrad") ? [f.when] : [])))];
  const acts = times.length ? await ctx.repo.table("activities").list({ caseId: { in: caseIds }, startsAt: { in: times } }) : [];
  const existing = new Map(caseIds.map((id) => [id, new Set(acts.filter((a) => a.caseId === id).map(slotOfActivity))]));
  // Veckans tider som visas: tiderna och platserna raden har med.
  const inWeekly = new Map(weekly.map((w) => [w.case.id, new Set((w.slots ?? []).map(slotOfActivity))]));
  const out: SmsToSend[] = [];
  for (const f of found) {
    const { t, x, template, m, slot, when } = f;
    // Kallelsen: bara inför ärendets första möte (bekräftat, mötet har inte varit).
    if (template === "kallelse") {
      if (!(x.c.status === "confirmed" && !!x.c.firstMeetingAt && (now === null || x.c.firstMeetingAt > now))) continue;
    } else {
      if (!when || (now !== null && when <= now)) continue;
      if ((template === "aktivitetsinbjudan" || template === "aktivitet_andrad") && !existing.get(x.c.id)?.has(slot)) continue;
      if (now !== null && template !== "aktivitet_installd" && inWeekly.get(x.c.id)?.has(slot)) continue;
    }
    out.push({
      key: taskKey(t.id), kind: template, case: x.c, person: x.p, mine: x.mine, phone: (x.p.phone ?? "").trim(), text: m.body, accepted: [m.body], week: null, slots: null,
      taskId: t.id, messageId: m.id, sortAt: m.createdAt,
    });
  }
  return out;
}

/**
 * Uppgifterna att ringa om en inbjudan eller ändrad tid som veckans tider har med (samma ärende, tid och plats) – stängs när
 * veckans tider markeras som skickade (ett SMS räcker). Bara öppna uppgifter för ärendet.
 */
export async function tasksCoveredBySchedule(ctx: Ctx, c: Pick<Case, "id" | "caseNumber">, slots: readonly Pick<Activity, "startsAt" | "location">[]): Promise<string[]> {
  const covered = slots.map(slotOfActivity);
  // ctx.system: uppgifterna är samordnarens – bara id:n för ärendets uppgifter lämnas ut.
  return (await ctx.system.table("tasks").list({ kind: "participant_contact", status: "open" }))
    .filter((t) => {
      const template = templateOfContactTask(t.text);
      return t.caseIds.length === 1 && t.caseIds[0] === c.id && (template === "aktivitetsinbjudan" || template === "aktivitet_andrad")
        && covered.some((slot) => taskMatchesSlot(template, c.caseNumber, slot, t.text));
    })
    .map((t) => t.id);
}
