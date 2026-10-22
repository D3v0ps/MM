// Målgruppen och de återkommande aktiviteterna (Karims beslut 2026-10-22) – systemsteg som håller gruppaktiviteterna aktuella.
// Bara för hanterare och jobb – importeras aldrig av skärmar.
//
// syncAudienceInvites(ctx, { contractId, caseIds?, groupActivityIds? })
//   För varje gruppaktivitet i avtalet som har en målgrupp (en nivå eller ett yrkesområde), inte är inställd och inte har börjat:
//   de aktiva deltagarna i målgruppen bjuds in (källan audience) och de som målgruppen bjöd in men som inte längre hör till den tas
//   bort – bara utan registrerad närvaro. Regeln (vem som hör till, krockar) är planAudienceSync i src/core/audience.ts. Manuellt
//   inbjudna rörs aldrig, startade och passerade aktiviteter rörs aldrig. Idempotent: en andra körning ändrar ingenting.
//   caseIds: bara dessa ärenden prövas (efter att ett ärende bytt nivå eller yrkesområde, startats eller avslutats).
//   groupActivityIds: bara dessa aktiviteter (en ny aktivitet, nya tillfällen i en serie).
//   Har aktiviteten meddelandet påslaget (group_activities.notify) får nya deltagare aktivitetsinbjudan och borttagna
//   aktivitet_installd (mallarna är oförändrade – CLAUDE.md punkt 9).
//   Anropas: efter att nivån ändrats (grupper.*), efter att en aktivitet med målgrupp skapats eller fått målgrupp, efter att en serie
//   skapats och nya tillfällen skapats, efter att en insats startats eller avslutats (arenden.caseStart, arenden.caseClose), och i
//   jobbet report_schedule som skyddsnät (ensureGroupActivities). Spår B och integrationen anropar den efter att ett ärende bytt
//   yrkesområde: syncAudienceInvites(ctx, { contractId: c.contractId, caseIds: [c.id] }).
//
// ensureSeriesOccurrences(ctx, { contractId?, seriesIds? })
//   Skapar tillfällena för de återkommande aktiviteterna från i dag och 14 dagar framåt (seriesOccurrenceStarts i
//   src/core/group-series.ts: seriens veckodagar, inga helgdagar, aldrig ett tillfälle som redan finns – också inställda) och
//   bjuder in målgruppen till de nya tillfällena. Idempotent: det unika indexet (series_id, starts_at) och UNIQUE_KEYS stoppar
//   dubbletter från samtidiga körningar.
//
// ctx.system används för läsningar och skrivningar: den automatiska inbjudan är ett systemsteg (som den automatiska närvaron) – den
// ska fungera likadant oavsett vem som ändrade nivån, och i jobbet finns ingen användare. Raderna skrivs med källan audience, som
// bara servern får skriva (0035). Revisionsloggen får id:n, koder och antal – aldrig namn.
import type { Ctx } from "@/api/server";
import { audienceOf, planAudienceSync, type AudienceCase, type AudienceSlot } from "@/core/audience";
import { isOperational } from "@/core/config";
import { seriesOccurrenceStarts, SERIES_HORIZON_DAYS } from "@/core/group-series";
import { addDays, dayOf, type LocalDate } from "@/core/time";
import { uniq } from "@/core/util";
import { UniqueError } from "@/data/repo";
import type { Activity, Case, GroupActivity, GroupActivitySeries } from "@/data/schema";
import type { NotifyOutcome } from "./api";
import { notifyAll, supersedeTasks, upcoming } from "./notify-all";

/** Vad synkningen gjorde i en aktivitet. */
export type AudienceSyncDetail = { added: string[]; removed: string[]; skipped: string[]; notifiedAdded: NotifyOutcome; notifiedRemoved: NotifyOutcome };
export type AudienceSyncResult = {
  /** Antal aktiviteter med målgrupp som prövades. */
  activities: number;
  added: number;
  removed: number;
  /** Deltagare i målgruppen som hade ett annat tillfälle vid samma tid. */
  skipped: number;
  /** Per aktivitet (bara de där något ändrades eller hoppades över). */
  details: Record<string, AudienceSyncDetail>;
};

const isCode = (e: unknown, code: string): boolean => (e as { code?: unknown } | null)?.code === code;

/**
 * Synka inbjudningarna i avtalets aktiviteter med målgrupp (se överst i filen). quiet: ingen loggrad per aktivitet – anroparen
 * loggar själv (aktiviteter.skapa, som har ärendena i sin rad group_activity.created).
 */
export async function syncAudienceInvites(
  ctx: Ctx,
  opts: { contractId: string; caseIds?: readonly string[]; groupActivityIds?: readonly string[]; quiet?: boolean },
): Promise<AudienceSyncResult> {
  const s = ctx.system;
  const now = ctx.now();
  const res: AudienceSyncResult = { activities: 0, added: 0, removed: 0, skipped: 0, details: {} };
  if (opts.caseIds && !opts.caseIds.length) return res;
  if (opts.groupActivityIds && !opts.groupActivityIds.length) return res;
  const groups = (await s.table("group_activities").list(
    { contractId: opts.contractId, cancelledAt: { isNull: true }, audience: { neq: "manual" }, startsAt: { gt: now }, ...(opts.groupActivityIds ? { id: { in: [...opts.groupActivityIds] } } : {}) },
    { orderBy: "startsAt" },
  )).sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : a.id < b.id ? -1 : 1));
  if (!groups.length) return res;
  res.activities = groups.length;
  const scope = opts.caseIds ? new Set(opts.caseIds) : null;
  const cases: Case[] = await s.table("cases").list({ contractId: opts.contractId, ...(scope ? { id: { in: [...scope] } } : {}) });
  const levelOf = new Map((await s.table("grouping_members").list({
    contractId: opts.contractId, kind: "level", removedAt: { isNull: true }, ...(scope ? { caseId: { in: [...scope] } } : {}),
  })).map((m) => [m.caseId, m.groupingId]));
  const rows = await s.table("activities").list({ groupActivityId: { in: groups.map((g) => g.id) } });
  const registered = new Set(rows.length ? (await s.table("attendance").pick(["activityId"], { activityId: { in: rows.map((r) => r.id) } })).map((r) => r.activityId) : []);
  // Deltagarnas andra tillfällen de dagar aktiviteterna ligger (krockarna). Nya rader läggs till efter hand.
  const first = dayOf(groups[0].startsAt);
  const last = dayOf(groups[groups.length - 1].startsAt);
  const caseIds = cases.map((c) => c.id);
  const slots: AudienceSlot[] = caseIds.length
    ? (await s.table("activities").pick(["caseId", "startsAt", "durationMin", "groupActivityId"], { caseId: { in: caseIds }, startsAt: { gte: `${first}T00:00`, lte: `${last}T23:59` } }))
      .map((a) => ({ caseId: a.caseId, startsAt: a.startsAt, durationMin: a.durationMin, groupActivityId: a.groupActivityId }))
    : [];
  const caseOf = new Map(cases.map((c) => [c.id, c]));
  for (const g of groups) {
    const audience = audienceOf(g);
    if (!audience) continue;
    const mine = rows.filter((r) => r.groupActivityId === g.id);
    const day = dayOf(g.startsAt);
    const plan = planAudienceSync({
      activity: { id: g.id, startsAt: g.startsAt, durationMin: g.durationMin, audience },
      cases: cases as AudienceCase[], levelOf, rows: mine.map((r) => ({ id: r.id, caseId: r.caseId, inviteSource: r.inviteSource, registered: registered.has(r.id) })),
      others: slots.filter((x) => dayOf(x.startsAt) === day), scope,
    });
    const added: string[] = [];
    for (const caseId of plan.add) {
      const a: Activity = {
        id: ctx.newId("a"), caseId, kind: g.kind, startsAt: g.startsAt, durationMin: g.durationMin, location: g.location, note: "", groupActivityId: g.id, inviteSource: "audience",
      };
      try {
        await s.table("activities").insert(a);
      } catch (e) {
        // En samtidig synkning eller inbjudan hann före (en rad per deltagare och aktivitet): deltagaren är redan inbjuden.
        if (e instanceof UniqueError || isCode(e, "23505")) continue;
        throw e;
      }
      added.push(caseId);
      slots.push({ caseId, startsAt: a.startsAt, durationMin: a.durationMin, groupActivityId: g.id });
    }
    const removed: string[] = [];
    for (const r of plan.remove) {
      try {
        await s.table("activities").remove(r.id);
      } catch (e) {
        // Främmande nyckeln attendance.activity_id (23503): närvaron registrerades under tiden – raden ligger kvar.
        if (isCode(e, "23503")) continue;
        throw e;
      }
      removed.push(r.caseId);
    }
    const skipped = plan.skipped.map((x) => x.caseId);
    if (!added.length && !removed.length && !skipped.length) continue;
    const removedCases = removed.map((id) => caseOf.get(id)).filter((c): c is Case => !!c);
    if (removedCases.length) await supersedeTasks(ctx, removedCases, g, "Deltagaren hör inte längre till aktivitetens målgrupp.");
    const send = g.notify && upcoming(ctx, g.startsAt);
    const slot = { when: g.startsAt, place: g.location };
    const detail: AudienceSyncDetail = {
      added, removed, skipped,
      notifiedAdded: send && added.length ? await notifyAll(ctx, g, "aktivitetsinbjudan", added, slot) : null,
      notifiedRemoved: send && removed.length ? await notifyAll(ctx, g, "aktivitet_installd", removed, slot) : null,
    };
    res.details[g.id] = detail;
    res.added += added.length;
    res.removed += removed.length;
    res.skipped += skipped.length;
    if (!opts.quiet && (added.length || removed.length)) {
      // Bara id:n och antal. caseIds (de som bjöds in eller togs bort) gör att kortets Historik visar raden i varje berört ärende.
      await ctx.audit({
        action: "group_activity.audience_synced", entity: "group_activity", entityId: g.id, contractId: g.contractId,
        details: {
          audience: g.audience, audienceId: g.audienceLevelId ?? g.audienceAreaCode, startsAt: g.startsAt, caseIds: uniq([...added, ...removed]).sort(),
          ...(added.length ? { addedCaseIds: [...added].sort() } : {}), ...(removed.length ? { removedCaseIds: [...removed].sort() } : {}),
          ...(skipped.length ? { skippedCaseIds: [...skipped].sort() } : {}), automatic: true,
        },
      });
    }
  }
  return res;
}

export type EnsureSeriesResult = { created: string[]; synced: AudienceSyncResult | null };

/**
 * Skapa de tillfällen som saknas i avtalets återkommande aktiviteter (se överst i filen) och bjud in målgruppen till dem. Utan
 * contractId: alla aktiva avtal. seriesIds: bara dessa serier (en ny serie).
 */
export async function ensureSeriesOccurrences(ctx: Ctx, opts: { contractId?: string; seriesIds?: readonly string[] } = {}): Promise<EnsureSeriesResult> {
  const s = ctx.system;
  const now = ctx.now();
  const today: LocalDate = dayOf(now);
  const series: GroupActivitySeries[] = (await s.table("group_activity_series").list({
    endedAt: { isNull: true }, ...(opts.contractId ? { contractId: opts.contractId } : {}), ...(opts.seriesIds ? { id: { in: [...opts.seriesIds] } } : {}),
  })).sort((a, b) => a.id.localeCompare(b.id));
  const out: EnsureSeriesResult = { created: [], synced: null };
  if (!series.length) return out;
  const holidays = new Set((await s.table("holidays").list({ date: { gte: today, lte: addDays(today, SERIES_HORIZON_DAYS) } })).map((h) => h.date));
  const byContract = new Map<string, string[]>();
  for (const x of series) {
    const existing = new Set((await s.table("group_activities").pick(["startsAt"], { seriesId: x.id })).map((g) => g.startsAt));
    const created: string[] = [];
    for (const startsAt of seriesOccurrenceStarts(x, { now, holidays, existing })) {
      const g: GroupActivity = {
        id: ctx.newId("ga"), contractId: x.contractId, name: x.name, kind: x.kind, startsAt, durationMin: x.durationMin, location: x.location, responsibleId: x.responsibleId,
        createdBy: x.createdBy, createdAt: now, updatedAt: null, updatedBy: null, cancelledAt: null, cancelledBy: null, goal: x.goal, goalVersion: 0,
        audience: x.audience, audienceLevelId: x.audienceLevelId, audienceAreaCode: x.audienceAreaCode, seriesId: x.id, notify: x.notify,
      };
      try {
        await s.table("group_activities").insert(g);
      } catch (e) {
        // En samtidig körning skapade tillfället (unikt series_id + starts_at).
        if (e instanceof UniqueError || isCode(e, "23505")) continue;
        throw e;
      }
      created.push(g.id);
    }
    if (!created.length) continue;
    out.created.push(...created);
    byContract.set(x.contractId, [...(byContract.get(x.contractId) ?? []), ...created]);
    await ctx.audit({
      action: "group_activity_series.occurrences_created", entity: "group_activity_series", entityId: x.id, contractId: x.contractId,
      details: { count: created.length, groupActivityIds: created },
    });
  }
  for (const [contractId, ids] of byContract) {
    const r = await syncAudienceInvites(ctx, { contractId, groupActivityIds: ids });
    out.synced = out.synced ? { ...out.synced, activities: out.synced.activities + r.activities, added: out.synced.added + r.added, removed: out.synced.removed + r.removed, skipped: out.synced.skipped + r.skipped, details: { ...out.synced.details, ...r.details } } : r;
  }
  return out;
}

/**
 * Jobbets steg (report_schedule, högst var tionde minut; minnesläget en gång per dag): nya tillfällen i alla aktiva avtals serier,
 * och sedan målgruppernas inbjudningar som skyddsnät (en ändring som inte hann synkas, en insats som startade eller tog slut).
 * Idempotent. Returnerar antalet skapade tillfällen och ändrade inbjudningar.
 */
export async function ensureGroupActivities(ctx: Ctx): Promise<{ created: number; changed: number }> {
  const contracts = (await ctx.system.table("contracts").list({ status: "active" }, { orderBy: "id" })).filter((c) => isOperational(c.config));
  let created = 0;
  let changed = 0;
  for (const c of contracts) {
    const r = await ensureSeriesOccurrences(ctx, { contractId: c.id });
    created += r.created.length;
    const sync = await syncAudienceInvites(ctx, { contractId: c.id });
    changed += sync.added + sync.removed;
  }
  return { created, changed };
}
