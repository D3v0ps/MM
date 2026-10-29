// Målgruppen för en gruppaktivitet (Karims beslut 2026-10-22) – ren domänlogik utan I/O. "Grupperna (yrkesområdena) bjuds in
// till större gruppaktiviteter en gång i månaden" och "Nivå aktiviteterna sker 1-3 gånger i veckan": en aktivitet kan ha en
// målgrupp – en nivå eller ett yrkesområde – och då bjuds de aktiva deltagarna i målgruppen in automatiskt fram till aktiviteten.
//
// Regeln för vem som hör till målgruppen en viss dag (samma i synkningen, i formulärets antal och i testerna):
//   * nivå:         deltagarens aktiva nivå (grouping_members, slot level) är målgruppens nivå
//   * yrkesområde:  ärendets yrkesområde (cases.primaryAreaCode) är målgruppens avtalsområde
//   * och insatsen pågår den dagen (inviteBlock i src/core/group-activities.ts: status active, startad, inte slutad, ingen
//     uppehållsvecka). Bekräftade ärenden som inte har startat, pausade, avslutade och avböjda hör inte till målgruppen.
//   * och personen har inte skyddade personuppgifter (vilande spärr, CLAUDE.md punkt 8): en skyddad deltagare bjuds aldrig in
//     automatiskt – bara för hand av huvudcoachen eller avtalsansvarig, som förut. Kolumnen är alltid false i dag.
// Synkningen (planAudienceSync): de som hör till målgruppen och saknar en rad bjuds in (källan audience) – utom den som redan har
// ett annat tillfälle vid samma tid (hoppas över; deltagarens egna tillfällen ersätts aldrig automatiskt). Rader som målgruppen
// bjöd in och som inte längre hör till (ny nivå, nytt yrkesområde, avslutad eller pausad insats) tas bort – men bara utan
// registrerad närvaro. Manuellt inbjudna (källan manual) rörs aldrig.
import type { AreaCode, GroupAudience, InviteSource, LocalDateTime } from "@/data/schema";
import { inviteBlock, overlaps, type InviteCase } from "./group-activities";
import { addWorkingDays, dayOf, nthWorkingDay, type MonthKey } from "./time";

export type Audience = { kind: "level"; levelId: string } | { kind: "area"; areaCode: AreaCode };
type AudienceColumns = { audience: GroupAudience; audienceLevelId: string | null; audienceAreaCode: AreaCode | null };

/** Målgruppen ur raden (group_activities eller group_activity_series), eller null (inbjudna för hand). */
export function audienceOf(x: AudienceColumns): Audience | null {
  if (x.audience === "level" && x.audienceLevelId) return { kind: "level", levelId: x.audienceLevelId };
  if (x.audience === "area" && x.audienceAreaCode) return { kind: "area", areaCode: x.audienceAreaCode };
  return null;
}
/** Kolumnerna för en målgrupp (null = manual). */
export function audienceColumns(a: Audience | null): AudienceColumns {
  if (!a) return { audience: "manual", audienceLevelId: null, audienceAreaCode: null };
  return a.kind === "level" ? { audience: "level", audienceLevelId: a.levelId, audienceAreaCode: null } : { audience: "area", audienceLevelId: null, audienceAreaCode: a.areaCode };
}

/** "G – Lager och logistik" – yrkesområdet som det skrivs i valen. */
export const areaLabel = (code: AreaCode, name: string): string => `${code} – ${name}`;

/**
 * Målgruppen i klarspråk: "Nivå 2 – Behöver stöd …" eller "Yrkesområde G – Lager och logistik". Namnen slås upp av anroparen
 * (nivåns namn ur groupings, yrkesområdets ur contract_areas).
 */
export function audienceLabel(a: Audience, names: { level?: string | null; area?: string | null }): string {
  if (a.kind === "level") return names.level ?? "Nivå";
  return `Yrkesområde ${names.area ? areaLabel(a.areaCode, names.area) : a.areaCode}`;
}

/** Ett ärende som synkningen prövar. protectedIdentity: personen har skyddade personuppgifter (vilande spärr – alltid false i dag). */
export type AudienceCase = InviteCase & { id: string; caseNumber: string; primaryAreaCode: AreaCode | null; protectedIdentity?: boolean };

/** Ärendet hör till målgruppen (oavsett dag): nivån eller yrkesområdet stämmer. levelOf: ärende -> aktiv nivå (grouping id). */
export function inAudience(a: Audience, c: Pick<AudienceCase, "id" | "primaryAreaCode">, levelOf: ReadonlyMap<string, string>): boolean {
  return a.kind === "level" ? levelOf.get(c.id) === a.levelId : c.primaryAreaCode === a.areaCode;
}

/** Ärendet hör till målgruppen och kan vara med den dagen (insatsen pågår, inga skyddade personuppgifter). */
export function belongsOn(a: Audience, c: AudienceCase, levelOf: ReadonlyMap<string, string>, day: string): boolean {
  return !c.protectedIdentity && inAudience(a, c, levelOf) && inviteBlock(c, day) === null;
}

/** De som hör till målgruppen den dagen, i ärendenummerordning (formulärets antal "N deltagare just nu"). */
export function audienceMembersOn(a: Audience, cases: readonly AudienceCase[], levelOf: ReadonlyMap<string, string>, day: string): AudienceCase[] {
  return cases.filter((c) => belongsOn(a, c, levelOf, day)).sort((x, y) => (x.caseNumber < y.caseNumber ? -1 : x.caseNumber > y.caseNumber ? 1 : 0));
}

/** En deltagares rad i aktiviteten: hur hen bjöds in och om närvaro är registrerad. */
export type AudienceRow = { id: string; caseId: string; inviteSource: InviteSource; registered: boolean };
/** Ett annat tillfälle för ett ärende samma dag (eget eller i en annan gruppaktivitet). */
export type AudienceSlot = { caseId: string; startsAt: LocalDateTime; durationMin: number; groupActivityId: string | null };
export type AudiencePlan = {
  /** Ärenden att bjuda in (källan audience), i ärendenummerordning. */
  add: string[];
  /** Rader att ta bort (målgruppen bjöd in dem, de hör inte längre till målgruppen och närvaro saknas). */
  remove: AudienceRow[];
  /** Hör till målgruppen men har ett annat tillfälle vid samma tid – bjuds inte in. */
  skipped: { caseId: string; reason: "overlap" }[];
};

/**
 * Vad synkningen ska göra för en aktivitet med målgrupp (se överst i filen). scope: bara dessa ärenden prövas (t.ex. efter att ett
 * ärende bytt nivå) – null prövar alla. Ren funktion: samma svar i hanteraren, jobbet, testdatat och testerna.
 */
export function planAudienceSync(input: {
  activity: { id: string; startsAt: LocalDateTime; durationMin: number; audience: Audience };
  cases: readonly AudienceCase[];
  levelOf: ReadonlyMap<string, string>;
  rows: readonly AudienceRow[];
  others: readonly AudienceSlot[];
  scope?: ReadonlySet<string> | null;
}): AudiencePlan {
  const { activity: g, levelOf, scope } = input;
  const day = dayOf(g.startsAt);
  const inScope = (caseId: string) => !scope || scope.has(caseId);
  const invited = new Set(input.rows.map((r) => r.caseId));
  const caseOf = new Map(input.cases.map((c) => [c.id, c]));
  const plan: AudiencePlan = { add: [], remove: [], skipped: [] };
  const sorted = [...input.cases].sort((x, y) => (x.caseNumber < y.caseNumber ? -1 : x.caseNumber > y.caseNumber ? 1 : 0));
  for (const c of sorted) {
    if (!inScope(c.id) || invited.has(c.id) || !belongsOn(g.audience, c, levelOf, day)) continue;
    const busy = input.others.some((o) => o.caseId === c.id && o.groupActivityId !== g.id && overlaps(o, g));
    if (busy) plan.skipped.push({ caseId: c.id, reason: "overlap" });
    else plan.add.push(c.id);
  }
  for (const r of input.rows) {
    if (r.inviteSource !== "audience" || r.registered || !inScope(r.caseId)) continue;
    const c = caseOf.get(r.caseId);
    if (!c || !belongsOn(g.audience, c, levelOf, day)) plan.remove.push(r);
  }
  return plan;
}

/**
 * Planera en yrkesområdesträff (Grupper och nivåer): dagen som Ny aktivitet börjar med. Den här månaden: nästa arbetsdag om den
 * ligger kvar i månaden, annars null – inga arbetsdagar återstår och Planera visas bara för nästa månad (formuläret skulle annars
 * öppnas med ett datum i nästa månad). En senare månad: tionde arbetsdagen. today: dagens datum (YYYY-MM-DD).
 */
export function planMeetingDay(month: MonthKey, today: string): string | null {
  const thisMonth = dayOf(today).slice(0, 7);
  if (month < thisMonth) return null;
  if (month === thisMonth) {
    const next = addWorkingDays(dayOf(today), 1);
    return dayOf(next).slice(0, 7) === month ? dayOf(next) : null;
  }
  return nthWorkingDay(month, 10);
}
