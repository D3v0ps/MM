// Steg efter grupperingarna: återkommande nivåaktiviteter och månadens yrkesområdesträffar (Karims beslut 2026-10-22: "Nivå
// aktiviteterna sker 1-3 gånger i veckan", "Grupperna (yrkesområdena) bjuds in till större gruppaktiviteter en gång i
// månaden"). Påhittade namn och platser – inga personuppgifter. Skapade före DEMO_START (2027-02-01 09.12).
//
//   Återkommande aktiviteter (group_activity_series), en per nivå, från måndag 8 februari (vecka 6 – den här veckan, vecka 5,
//   rörs inte): tillfällena skapas med samma regel som servern (seriesOccurrenceStarts: i dag och 14 dagar framåt, inga helgdagar)
//   och deltagarna bjuds in med samma regel som den automatiska synkningen (planAudienceSync: aktiva deltagare på nivån, den som
//   har ett annat tillfälle vid samma tid hoppas över). Meddelandet till deltagarna är av (standard för en serie).
//   Månadens yrkesområdesträffar: vanliga gruppaktiviteter med målgruppen ett yrkesområde – Lager och logistik (G) och Lokalvård (F)
//   i februari, Kök, restaurang och måltidsservice (D) i mars.
// Samma funktioner som i appen gör att den första synkningen efter inläsningen inte ändrar något.
import { audienceColumns, planAudienceSync, type Audience, type AudienceCase, type AudienceSlot } from "@/core/audience";
import { defaultLevelId } from "@/core/groupings";
import { seriesOccurrenceStarts } from "@/core/group-series";
import { dayOf } from "@/core/time";
import type { Activity, Db, GroupActivity, GroupActivityKind, GroupActivitySeries } from "../schema";
import { NOW } from "./constants";

const CONTRACT = "c-bot";
const CREATED_AT = "2027-01-28T10:30";
const LOCATION = "Miljonbemanning Alby";

type SeriesSeed = { n: number; name: string; kind: GroupActivityKind; weekdays: number[]; startTime: string; durationMin: number; responsibleId: string; goal: string | null };
/** En serie per nivå (påhittade namn). Tiderna ligger utanför veckoplanens yrkesmoment (tisdag och torsdag 09.00–12.00). */
const SERIES: SeriesSeed[] = [
  { n: 1, name: "Kom igång-träff", kind: "annat", weekdays: [2, 4], startTime: "13:30", durationMin: 60, responsibleId: "u-amira", goal: null },
  { n: 2, name: "Vardag och rutiner", kind: "annat", weekdays: [1, 3], startTime: "13:30", durationMin: 90, responsibleId: "u-erik", goal: null },
  { n: 3, name: "Yrkessvenska", kind: "yrkesmoment", weekdays: [2, 4], startTime: "13:30", durationMin: 90, responsibleId: "u-amira", goal: "Alla presenterar sig på svenska" },
  { n: 4, name: "Jobbsök och CV", kind: "annat", weekdays: [1, 3], startTime: "13:30", durationMin: 90, responsibleId: "u-erik", goal: null },
  { n: 5, name: "Intervjuträning", kind: "annat", weekdays: [5], startTime: "10:00", durationMin: 120, responsibleId: "u-amira", goal: null },
];
export const seedSeriesId = (n: number): string => `ser-c-bot-niva-${n}`;

type MeetingSeed = { id: string; areaCode: string; name: string; startsAt: string; durationMin: number };
/** Månadens yrkesområdesträffar (vanliga aktiviteter med målgruppen ett yrkesområde). */
const MEETINGS: MeetingSeed[] = [
  { id: "ga-traff-c-bot-g-2027-02", areaCode: "G", name: "Yrkesområdesträff: lager och logistik", startsAt: "2027-02-17T14:00", durationMin: 90 },
  { id: "ga-traff-c-bot-f-2027-02", areaCode: "F", name: "Yrkesområdesträff: lokalvård", startsAt: "2027-02-24T14:00", durationMin: 90 },
  { id: "ga-traff-c-bot-d-2027-03", areaCode: "D", name: "Yrkesområdesträff: kök och restaurang", startsAt: "2027-03-10T14:00", durationMin: 90 },
];

export function addGroupActivities(db: Db): void {
  const holidays = new Set(db.holidays.map((h) => h.date));
  const levelOf = new Map(db.grouping_members.filter((m) => m.kind === "level" && m.removedAt == null).map((m) => [m.caseId, m.groupingId]));
  const cases: AudienceCase[] = db.cases.filter((c) => c.contractId === CONTRACT);
  // Deltagarnas tillfällen (för krockarna) – de nya raderna läggs till efter hand.
  const slots: AudienceSlot[] = db.activities.map((a) => ({ caseId: a.caseId, startsAt: a.startsAt, durationMin: a.durationMin, groupActivityId: a.groupActivityId }));
  const series: GroupActivitySeries[] = [];
  const occurrences: GroupActivity[] = [];

  const base = (createdBy: string): Pick<GroupActivity, "contractId" | "createdBy" | "createdAt" | "updatedAt" | "updatedBy" | "cancelledAt" | "cancelledBy" | "goalVersion"> => ({
    contractId: CONTRACT, createdBy, createdAt: CREATED_AT, updatedAt: null, updatedBy: null, cancelledAt: null, cancelledBy: null, goalVersion: 0,
  });

  for (const s of SERIES) {
    const audience: Audience = { kind: "level", levelId: defaultLevelId(CONTRACT, s.n) };
    const row: GroupActivitySeries = {
      id: seedSeriesId(s.n), contractId: CONTRACT, name: s.name, kind: s.kind, audience: "level", audienceLevelId: audience.levelId, audienceAreaCode: null,
      weekdays: s.weekdays, startTime: s.startTime, durationMin: s.durationMin, location: LOCATION, responsibleId: s.responsibleId, goal: s.goal,
      startsOn: "2027-02-08", endsOn: null, notify: false, createdBy: s.responsibleId, createdAt: CREATED_AT, updatedAt: null, updatedBy: null, endedAt: null, endedBy: null,
    };
    series.push(row);
    for (const startsAt of seriesOccurrenceStarts(row, { now: NOW, holidays, existing: new Set() })) {
      occurrences.push({
        ...base(s.responsibleId), id: `ga-${row.id}-${dayOf(startsAt)}`, name: s.name, kind: s.kind, startsAt, durationMin: s.durationMin, location: LOCATION,
        responsibleId: s.responsibleId, goal: s.goal, ...audienceColumns(audience), seriesId: row.id, notify: false,
      });
    }
  }
  for (const m of MEETINGS) {
    occurrences.push({
      ...base("u-sara"), id: m.id, name: m.name, kind: "annat", startsAt: m.startsAt, durationMin: m.durationMin, location: LOCATION, responsibleId: null, goal: null,
      ...audienceColumns({ kind: "area", areaCode: m.areaCode }), seriesId: null, notify: false,
    });
  }

  // Deltagarna: samma regel som den automatiska synkningen, i tidsordning (en ny rad räknas i nästa aktivitets krockar).
  const rows: Activity[] = [];
  for (const g of [...occurrences].sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : a.id < b.id ? -1 : 1))) {
    const audience: Audience = g.audience === "level" ? { kind: "level", levelId: g.audienceLevelId! } : { kind: "area", areaCode: g.audienceAreaCode! };
    const day = dayOf(g.startsAt);
    const plan = planAudienceSync({
      activity: { id: g.id, startsAt: g.startsAt, durationMin: g.durationMin, audience }, cases, levelOf, rows: [], others: slots.filter((x) => dayOf(x.startsAt) === day),
    });
    for (const caseId of plan.add) {
      const a: Activity = {
        id: `a-${g.id}-${caseId}`, caseId, kind: g.kind, startsAt: g.startsAt, durationMin: g.durationMin, location: g.location, note: "", groupActivityId: g.id, inviteSource: "audience",
      };
      rows.push(a);
      slots.push({ caseId, startsAt: a.startsAt, durationMin: a.durationMin, groupActivityId: g.id });
    }
  }
  db.group_activity_series.push(...series);
  db.group_activities.push(...occurrences);
  db.activities.push(...rows);
}
