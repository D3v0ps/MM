// Steg efter mappningen: Karims beslut 2026-11-09 i testdatat (påhittade uppgifter) – deltagaren kom inte till första mötet.
// Prototypens tillstånd (createProtoState) och generatorerna ändras inte, så slumpen och ordningen ligger kvar.
//
//   Första mötet har varit  BOT-27-0043 (huvudcoach Erik, handläggare Omar) är bekräftat och har inte startat. Första mötet var
//                     fredag 29 januari kl. 14.00 – före demoklockan (måndag 1 februari kl. 09.12) – så flödet går att prova:
//                     "Deltagaren kom inte" på deltagarkortet och på Min vecka, sedan "Boka nytt första möte" eller "Avsluta –
//                     deltagaren kom aldrig". Ingen registrering finns i testdatat (first_meeting_no_shows är tom) – den görs av
//                     den som provar.
//                     Prototypens ärende hade första mötet onsdag 3 februari, ett startdatum och två planerade tillfällen redan
//                     innan insatsen startade, och ett samtycke registrerat vid mötet. Ett bekräftat ärende har inget startdatum och
//                     inga tillfällen förrän insatsen startar (arenden.caseStart, beslut 2026-10-08), och samtycket frågar coachen
//                     om vid första mötet – deltagaren kom inte, så ärendet har inget startdatum, inga tillfällen och inget samtycke.
//                     Planerat slut räknas från mötesdagen (beslut 7, 2026-10-08): tio veckor från vecka 4 – fredag 2 april.
//                     Notisen till Erik om tilldelningen säger det nya mötet. Paritetstestet mot den gamla prototypen jämför
//                     testdatat utan ändringen (withoutFirstMeetingDemo nedan).
import type { Activity, Consent, Db } from "../schema";

/** Ärendet vars första möte har varit (BOT-27-0043). */
export const SEED_NO_SHOW_CASE = "case-270043";
const MEETING_AT = "2027-01-29T14:00";
const PLANNED_END = "2027-04-02";
const NOTIFICATION = "un-17369";
const notificationBody = (when: string) => `Du är huvudcoach för BOT-27-0043 (Serviceyrken). Första möte ${when}.`;

/** Prototypens värden – återställs av withoutFirstMeetingDemo. */
const PROTOTYPE = { firstMeetingAt: "2027-02-03T14:00", startDate: "2027-02-03", plannedEnd: "2027-04-09", aiConsentStatus: "given" as const, when: "3 feb kl. 14.00" };
const PROTOTYPE_ACTIVITIES: readonly Activity[] = [
  { id: "a-14418", caseId: SEED_NO_SHOW_CASE, kind: "möte", startsAt: "2027-02-03T14:00", durationMin: 60, location: "Miljonbemanning Alby", note: "", groupActivityId: null, inviteSource: "manual" },
  { id: "a-14419", caseId: SEED_NO_SHOW_CASE, kind: "yrkesmoment", startsAt: "2027-02-04T09:00", durationMin: 180, location: "Miljonbemanning Alby", note: "", groupActivityId: null, inviteSource: "manual" },
];
const PROTOTYPE_CONSENT: Consent = {
  id: "cons-14811", personId: "p-5223", caseId: SEED_NO_SHOW_CASE, kind: "recording_and_ai", textVersion: "v1.0 (2026-10-01)", givenAt: "2027-02-03T14:00", informedBy: "u-erik",
  language: "lättläst svenska", revokedAt: null, declinedAt: null,
};
const PROTOTYPE_ACTIVITY_IDS = new Set(PROTOTYPE_ACTIVITIES.map((a) => a.id));

export function applyDecisions20261109(db: Db): void {
  const c = db.cases.find((k) => k.id === SEED_NO_SHOW_CASE);
  // Bara prototypens ärende som det var (bekräftat, första mötet 3 februari) – annars rörs ingenting.
  if (!c || c.status !== "confirmed" || c.firstMeetingAt !== PROTOTYPE.firstMeetingAt) return;
  Object.assign(c, { firstMeetingAt: MEETING_AT, startDate: null, plannedEnd: PLANNED_END, aiConsentStatus: "not_asked" });
  db.activities = db.activities.filter((a) => !(a.caseId === SEED_NO_SHOW_CASE && PROTOTYPE_ACTIVITY_IDS.has(a.id)));
  db.attendance = db.attendance.filter((x) => !(x.caseId === SEED_NO_SHOW_CASE && PROTOTYPE_ACTIVITY_IDS.has(x.activityId)));
  db.consents = db.consents.filter((x) => x.id !== PROTOTYPE_CONSENT.id);
  const n = db.user_notifications.find((x) => x.id === NOTIFICATION);
  if (n && n.body === notificationBody(PROTOTYPE.when)) n.body = notificationBody("29 jan kl. 14.00");
}

/** Talet i ett löpnummer-id ("a-14418" → 14418), annars NaN. */
const seqOf = (id: string, prefix: string): number => Number(new RegExp(`^${prefix}-(\\d+)$`).exec(id)?.[1] ?? NaN);
/** Raderna tillbaka på sin plats i ordningen (före första raden med ett högre löpnummer) – domänfunktionerna läser i ordning. */
function restored<T extends { id: string }>(rows: readonly T[], back: readonly T[], prefix: string): T[] {
  const missing = back.filter((b) => !rows.some((x) => x.id === b.id));
  if (!missing.length) return [...rows];
  const last = Math.max(...missing.map((b) => seqOf(b.id, prefix)));
  const at = rows.findIndex((x) => seqOf(x.id, prefix) > last);
  const out = [...rows];
  out.splice(at < 0 ? out.length : at, 0, ...missing.map((b) => ({ ...b })));
  return out;
}

/** Testdatat utan ändringen ovan (paritetstestet mot den gamla prototypen, som inte har den). */
export function withoutFirstMeetingDemo(db: Db): Db {
  const c = db.cases.find((k) => k.id === SEED_NO_SHOW_CASE);
  if (!c || c.firstMeetingAt !== MEETING_AT) return db;
  return {
    ...db,
    cases: db.cases.map((k) => (k.id === SEED_NO_SHOW_CASE ? { ...k, firstMeetingAt: PROTOTYPE.firstMeetingAt, startDate: PROTOTYPE.startDate, plannedEnd: PROTOTYPE.plannedEnd, aiConsentStatus: PROTOTYPE.aiConsentStatus } : k)),
    activities: restored(db.activities, PROTOTYPE_ACTIVITIES, "a"),
    consents: restored(db.consents, [PROTOTYPE_CONSENT], "cons"),
    user_notifications: db.user_notifications.map((x) => (x.id === NOTIFICATION && x.body === notificationBody("29 jan kl. 14.00") ? { ...x, body: notificationBody(PROTOTYPE.when) } : x)),
    first_meeting_no_shows: db.first_meeting_no_shows.filter((x) => x.caseId !== SEED_NO_SHOW_CASE),
  };
}
