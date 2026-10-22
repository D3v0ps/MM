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
//   aktivitet_installd (mallarna är oförändrade – CLAUDE.md punkt 9). Borttagningarna loggas, meddelas och får sina uppgifter
//   stängda per aktivitet innan något bjuds in, så att ett fel när inbjudningarna skrivs aldrig lämnar en borttagen rad utan logg.
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
import { audienceOf, belongsOn, planAudienceSync, type Audience, type AudienceCase, type AudienceSlot } from "@/core/audience";
import { isOperational } from "@/core/config";
import { isSystemSendTime, seriesOccurrenceStarts, SERIES_HORIZON_DAYS } from "@/core/group-series";
import { addDays, dayOf, type LocalDate } from "@/core/time";
import { uniq } from "@/core/util";
import { PolicyError, UniqueError } from "@/data/repo";
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
 * Ärendena i avtalet som målgruppen prövas mot (alla, eller bara caseIds), med den aktiva nivån och flaggan för skyddade
 * personuppgifter. ctx.system: systemsteg – flaggan läses som flagga, inget lämnas ut (vilande spärren, CLAUDE.md punkt 8: en
 * skyddad deltagare bjuds aldrig in automatiskt, belongsOn i src/core/audience.ts).
 */
export async function audienceCases(ctx: Ctx, contractId: string, caseIds: readonly string[] | null): Promise<{ cases: (Case & AudienceCase)[]; levelOf: Map<string, string> }> {
  const s = ctx.system;
  const scope = caseIds ? { id: { in: [...caseIds] } } : {};
  const cases: Case[] = await s.table("cases").list({ contractId, ...scope });
  const levelOf = new Map((await s.table("grouping_members").list({
    contractId, kind: "level", removedAt: { isNull: true }, ...(caseIds ? { caseId: { in: [...caseIds] } } : {}),
  })).map((m) => [m.caseId, m.groupingId]));
  const personIds = uniq(cases.map((c) => c.personId));
  const shielded = new Set(personIds.length ? (await s.table("persons").pick(["id"], { id: { in: personIds }, protectedIdentity: true })).map((p) => p.id) : []);
  return { cases: cases.map((c) => ({ ...c, protectedIdentity: shielded.has(c.personId) })), levelOf };
}

/**
 * De av ärendena som hör till aktivitetens målgrupp på aktivitetens dag (samma regel som synkningen) – de skulle synkningen
 * bjuda in igen. Tom mängd när aktiviteten saknar målgrupp.
 */
export async function audienceMembers(
  ctx: Ctx, g: Pick<GroupActivity, "contractId" | "startsAt" | "audience" | "audienceLevelId" | "audienceAreaCode">, caseIds: readonly string[],
): Promise<Set<string>> {
  const a = audienceOf(g);
  if (!a || !caseIds.length) return new Set();
  const { cases, levelOf } = await audienceCases(ctx, g.contractId, caseIds);
  const day = dayOf(g.startsAt);
  return new Set(cases.filter((c) => belongsOn(a, c, levelOf, day)).map((c) => c.id));
}

/**
 * Tar bort en deltagares rad i en gruppaktivitet: "removed", "gone" (raden var redan borta – en samtidig synkning, inställning
 * eller borttagning hann före) eller "kept" (närvaron registrerades under tiden: främmande nyckeln attendance.activity_id, 23503).
 * Supabase och minnet svarar PolicyError när ingen rad togs bort; systemet kontrollerar då att raden verkligen är borta – annars
 * är det ett riktigt behörighetsfel och det kastas vidare.
 */
export async function removeParticipantRow(ctx: Ctx, repo: Ctx["repo"], id: string): Promise<"removed" | "gone" | "kept"> {
  try {
    await repo.table("activities").remove(id);
    return "removed";
  } catch (e) {
    if (isCode(e, "23503")) return "kept";
    if (e instanceof PolicyError && !(await ctx.system.table("activities").get(id))) return "gone";
    throw e;
  }
}

/**
 * Synka inbjudningarna i avtalets aktiviteter med målgrupp (se överst i filen). quiet: ingen loggrad per aktivitet – anroparen
 * loggar själv (aktiviteter.skapa, som har ärendena i sin rad group_activity.created).
 *
 * Ordningen: först tas de rader bort som inte längre hör till målgruppen – i alla aktiviteter – och sedan bjuds de nya in, med
 * de borttagna raderna borta ur krockarna. Annars räknas den gamla nivåns tillfälle som en krock och deltagaren hoppas över i den
 * nya nivåns tillfälle vid samma tid (nivå 4 och nivå 2 har båda måndag och onsdag 13.30). En aktivitet som ställs in medan
 * synkningen pågår får inga nya rader: de som hann skrivas tas bort igen.
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
  const { cases, levelOf } = await audienceCases(ctx, opts.contractId, opts.caseIds ?? null);
  const rows = await s.table("activities").list({ groupActivityId: { in: groups.map((g) => g.id) } });
  const registered = new Set(rows.length ? (await s.table("attendance").pick(["activityId"], { activityId: { in: rows.map((r) => r.id) } })).map((r) => r.activityId) : []);
  // Deltagarnas andra tillfällen de dagar aktiviteterna ligger (krockarna). Borttagna rader tas bort och nya läggs till efter hand.
  const first = dayOf(groups[0].startsAt);
  const last = dayOf(groups[groups.length - 1].startsAt);
  const caseIds = cases.map((c) => c.id);
  let slots: AudienceSlot[] = caseIds.length
    ? (await s.table("activities").pick(["caseId", "startsAt", "durationMin", "groupActivityId"], { caseId: { in: caseIds }, startsAt: { gte: `${first}T00:00`, lte: `${last}T23:59` } }))
      .map((a) => ({ caseId: a.caseId, startsAt: a.startsAt, durationMin: a.durationMin, groupActivityId: a.groupActivityId }))
    : [];
  const caseOf = new Map(cases.map((c) => [c.id, c]));
  const gone = new Set<string>();
  const planFor = (g: GroupActivity, audience: Audience) => {
    const day = dayOf(g.startsAt);
    return planAudienceSync({
      activity: { id: g.id, startsAt: g.startsAt, durationMin: g.durationMin, audience },
      cases, levelOf,
      rows: rows.filter((r) => r.groupActivityId === g.id && !gone.has(r.id)).map((r) => ({ id: r.id, caseId: r.caseId, inviteSource: r.inviteSource, registered: registered.has(r.id) })),
      others: slots.filter((x) => dayOf(x.startsAt) === day), scope,
    });
  };

  // 1. Bort: rader som målgruppen bjöd in och som inte längre hör till (bara utan registrerad närvaro). Varje aktivitets
  //    borttagningar loggas, meddelas och får sina uppgifter stängda direkt – innan något bjuds in – så att ett fel i steg 2
  //    aldrig lämnar en borttagen rad utan revisionslogg (CLAUDE.md punkt 3). Raden loggas också med quiet (anroparen loggar
  //    bara sina inbjudningar).
  const removedOf = new Map<string, { removed: string[]; notified: NotifyOutcome }>();
  for (const g of groups) {
    const audience = audienceOf(g);
    if (!audience) continue;
    const removed: string[] = [];
    for (const r of planFor(g, audience).remove) {
      const out = await removeParticipantRow(ctx, s, r.id);
      if (out === "kept") continue;
      gone.add(r.id);
      if (out === "removed") removed.push(r.caseId);
    }
    if (!removed.length) continue;
    await ctx.audit({
      action: "group_activity.audience_synced", entity: "group_activity", entityId: g.id, contractId: g.contractId,
      details: {
        audience: g.audience, audienceId: g.audienceLevelId ?? g.audienceAreaCode, startsAt: g.startsAt, caseIds: uniq(removed).sort(), removedCaseIds: [...removed].sort(),
        automatic: true,
      },
    });
    const removedCases = removed.map((id) => caseOf.get(id)).filter((c): c is Case & AudienceCase => !!c);
    if (removedCases.length) await supersedeTasks(ctx, removedCases, g, "Deltagaren hör inte längre till aktivitetens målgrupp.");
    const send = g.notify && upcoming(ctx, g.startsAt);
    removedOf.set(g.id, { removed, notified: send ? await notifyAll(ctx, g, "aktivitet_installd", removed, { when: g.startsAt, place: g.location }) : null });
  }
  if (gone.size) {
    const goneKeys = new Set(rows.filter((r) => gone.has(r.id)).map((r) => `${r.groupActivityId}|${r.caseId}`));
    slots = slots.filter((x) => !(x.groupActivityId && goneKeys.has(`${x.groupActivityId}|${x.caseId}`)));
  }

  // 2. In: de som hör till målgruppen och saknar en rad, utan krock med deltagarens andra tillfällen.
  for (const g of groups) {
    const audience = audienceOf(g);
    if (!audience) continue;
    const plan = planFor(g, audience);
    const added: string[] = [];
    const insertedIds: string[] = [];
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
      insertedIds.push(a.id);
      slots.push({ caseId, startsAt: a.startsAt, durationMin: a.durationMin, groupActivityId: g.id });
    }
    // Ställdes aktiviteten in under tiden (aktiviteter.stallIn eller en avslutad serie): de nya raderna tas bort igen.
    if (insertedIds.length && (await s.table("group_activities").get(g.id))?.cancelledAt) {
      for (const id of insertedIds) await removeParticipantRow(ctx, s, id);
      added.length = 0;
    }
    const { removed, notified: notifiedRemoved } = removedOf.get(g.id) ?? { removed: [], notified: null };
    const skipped = plan.skipped.map((x) => x.caseId);
    if (!added.length && !removed.length && !skipped.length) continue;
    if (!opts.quiet && added.length) {
      // Bara id:n och antal. caseIds (de som bjöds in) gör att kortets Historik visar raden i varje berört ärende. Borttagningarna
      // har redan sin rad (steg 1).
      await ctx.audit({
        action: "group_activity.audience_synced", entity: "group_activity", entityId: g.id, contractId: g.contractId,
        details: {
          audience: g.audience, audienceId: g.audienceLevelId ?? g.audienceAreaCode, startsAt: g.startsAt, caseIds: uniq(added).sort(), addedCaseIds: [...added].sort(),
          ...(skipped.length ? { skippedCaseIds: [...skipped].sort() } : {}), automatic: true,
        },
      });
    }
    const send = g.notify && upcoming(ctx, g.startsAt);
    const detail: AudienceSyncDetail = {
      added, removed, skipped,
      notifiedAdded: send && added.length ? await notifyAll(ctx, g, "aktivitetsinbjudan", added, { when: g.startsAt, place: g.location }) : null,
      notifiedRemoved,
    };
    res.details[g.id] = detail;
    res.added += added.length;
    res.removed += removed.length;
    res.skipped += skipped.length;
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
    // Avslutades serien medan tillfällena skapades (aktiviteter.serieAvsluta läste de kommande tillfällena innan de fanns): de nya
    // ställs in direkt, i namnet på den som avslutade serien, och ingen bjuds in. Avslutet läser tillfällena igen efter att serien
    // markerats avslutad, så ett tillfälle som skapas före det fångas där och ett som skapas efter fångas här.
    const fresh = await s.table("group_activity_series").get(x.id);
    if (fresh?.endedAt) {
      for (const id of created) {
        if (!(await s.table("group_activities").updateIf(id, { cancelledAt: { isNull: true } }, { cancelledAt: now, cancelledBy: fresh.endedBy ?? x.createdBy }))) continue;
        await ctx.audit({
          action: "group_activity.cancelled", entity: "group_activity", entityId: id, contractId: x.contractId,
          details: { removed: 0, activityIds: [], caseIds: [], seriesId: x.id, automatic: true },
        });
      }
      continue;
    }
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
 * Idempotent. Returnerar antalet skapade tillfällen och ändrade inbjudningar. Bara dagtid (isSystemSendTime): på natten gör
 * steget ingenting, så att inga inbjudningar (e-post, SMS, utringning) går till deltagare mitt i natten – nästa körning efter
 * 08.00 skapar tillfällena och bjuder in.
 */
export async function ensureGroupActivities(ctx: Ctx): Promise<{ created: number; changed: number }> {
  if (!isSystemSendTime(ctx.now())) return { created: 0, changed: 0 };
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
