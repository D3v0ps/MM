// Hanterare: Ändra startdatum på deltagarkortet (Karims beslut 2026-10-29). Registreras via ./handlers.ts.
//   Vem:        coach, samordnare och avtalsansvarig med full åtkomst (canEditCase – personen läses via behörigheten). Chef och
//               systemadministratör ser ändringarna i läsläge. Kommunen och ekonomen nekas av rollkontrollen och ser aldrig
//               ändringarna eller motiveringen – kommunen ser bara det nya startdatumet i portalen och får inget meddelande.
//   Regler:     planStartChange i src/core/start-date.ts (pågående eller pausad insats, ett annat datum, tidigast första mötets
//               dag, senast planerat slut, ingen av månaderna som ändringen rör fakturerad eller godkänd, inget tillfälle före det
//               nya datumet med närvaro som en människa registrerat, motivering 10–300 tecken utan personnummer).
//   Skrivning:  via ctx.repo (RLS): först anteckningen med motiveringen (case_notes – låst efteråt: den ändras och tas aldrig bort,
//               0038), sedan ändringen (case_start_changes, nästa nummer i ärendet – seq). Ändringen ändrar ärendets startdatum i
//               samma transaktion (triggern case_start_changes_apply i 0038, policy.ts afterInsert) och prövar reglerna igen i
//               databasen. Sedan tas tillfällena före det nya startdatumet bort (de utan närvaro och de med bara automatisk
//               närvaro – den automatiska raden tas bort av servern, ctx.system, eftersom bara systemet skriver automatisk närvaro),
//               revisionsloggen skrivs och sist följer inbjudningarna till kommande gruppaktiviteter med målgrupp det nya datumet
//               (syncAudienceInvites). Inga tillfällen skapas bakåt i tiden – coachen lägger till det som hände.
//   Samtidigt:  två ändringar i samma ärende samtidigt – den andra får conflict (den unika nyckeln case_id + seq, och triggern som
//               kräver att ändringen utgår från ärendets nuvarande startdatum). Kan ändringen inte skrivas döljs anteckningen.
//   Svaret      kom inte fram efter att ändringen skrevs, eller städningen avbröts: samma ändring igen (egen, nyligen, samma datum,
//   saknas:     utan case.start_date_changed i loggen) gör klart tillfällena, loggen och inbjudningarna och svarar ok.
//   Logg:       case.start_date_changed med id:n och datum – aldrig motiveringen (CLAUDE.md punkt 2). Borttagna rader i
//               gruppaktiviteter som bjöds in för hand loggas också på aktiviteten (group_activity.removed_participant, samma
//               händelse som Ta bort i aktivitetsvyn); kommande rader som målgruppen bjöd in tar synkningen bort (sin logg och
//               aktivitetens meddelande).
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { personName } from "@/core/labels";
import {
  activitiesBeforeStart, NO_BILLING, nextStartChangeSeq, planStartChange, START_CHANGERS, startChangeBlockedText, startChangeMonths, startChangeNoteBody,
  startChangesInOrder, startMotivationOf, type StartChangeBilling,
} from "@/core/start-date";
import { dayOf, diffMinutes, type LocalDate } from "@/core/time";
import { uniq } from "@/core/util";
import { PolicyError, UniqueError } from "@/data/repo";
import type { Case, CaseNote, CaseStartChange } from "@/data/schema";
import { removeParticipantRow, syncAudienceInvites } from "../aktiviteter/audience-sync";
import { supersedeTasks } from "../aktiviteter/notify-all";
import { canEditCase } from "../_shared/context";
import { caseChangeStart, caseStartView, type CaseStartView } from "./api";

const NOT_FOUND = "Ärendet finns inte, eller så har du inte behörighet att se det.";
/** Läser startdatumet och ändringarna på kortet: Miljonbemanning som öppnar deltagarkortet. */
const START_VIEWERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin"];

handleQuery(caseStartView, { roles: START_VIEWERS }, async (ctx, p): Promise<CaseStartView | null> => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return null;
  // Full åtkomst = personen är läsbar via behörigheten (samma som kortets huvud).
  const person = await ctx.repo.table("persons").get(c.personId);
  if (!person) return null;
  const changes = await ctx.repo.table("case_start_changes").list({ caseId: c.id });
  const [profiles, notes] = changes.length
    ? await Promise.all([
      ctx.repo.table("profiles").list({ id: { in: uniq(changes.map((x) => x.changedBy)) } }),
      // Motiveringen: den låsta anteckningen, via behörigheten (samma läsare som anteckningarna i kortet).
      ctx.repo.table("case_notes").list({ id: { in: changes.map((x) => x.noteId) } }),
    ])
    : [[], []];
  const may = START_CHANGERS.includes(ctx.actor.role);
  const blocked = startChangeBlockedText(c);
  return {
    caseId: c.id,
    startDate: c.startDate,
    canChange: may && !blocked,
    blockedText: may ? blocked : null,
    earliest: c.firstMeetingAt ? dayOf(c.firstMeetingAt) : null,
    latest: c.endDate ?? c.plannedEnd,
    history: startChangesInOrder(changes)
      .reverse()
      .map((x) => {
        const note = notes.find((n) => n.id === x.noteId);
        return {
          id: x.id, changedAt: x.changedAt, fromDate: x.fromDate, toDate: x.toDate, byName: personName(profiles, x.changedBy),
          motivation: note ? startMotivationOf(note.body, x.fromDate, x.toDate) : null,
        };
      }),
  };
});

const CONFLICT = "Startdatumet har ändrats under tiden, kanske av en kollega. Ladda om sidan och försök igen – inget har sparats.";
const REFUSED = "Startdatumet kunde inte ändras: ärendet, faktureringen eller närvaron har ändrats under tiden. Ladda om sidan och försök igen – inget har sparats.";
const UNKNOWN = "Det gick inte att se om ändringen sparades. Försök igen – har den redan sparats görs den klart, annars sparas den nu.";
/** En egen ändring som inte blev klar görs klar av samma ändring igen inom den här tiden (minuter). */
const FINISH_WITHIN_MINUTES = 60;
const code = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? "");
/** En ändring som inte kunde skrivas: någon annan hann före (nästa nummer tog slut), ärendet ändrades eller behörigheten nekade. */
const lostRace = (e: unknown): boolean => e instanceof UniqueError || e instanceof PolicyError || ["23505", "23514", "42501"].includes(code(e));

type Finished = { removed: number; autoAttendanceRemoved: number; groups: { invited: number; removed: number } | null };

handleCommand(caseChangeStart, { roles: START_CHANGERS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  // Full åtkomst: personen läses via behörigheten (vilande spärr: bara namngivna ser personen i ett skyddat ärende).
  if (!(await canEditCase(ctx, c))) return fail("forbidden", "Du kan inte ändra startdatumet i det här ärendet.");
  // Samma ändring igen: ändringen sparades men svaret kom inte fram, eller städningen avbröts. Det som återstår görs nu.
  const again = await sameOwnChange(ctx, c, p);
  if (again) {
    const done = again.logged ?? (await finishChange(ctx, c, again.change));
    return ok({ changeId: again.change.id, noteId: again.change.noteId, startDate: again.change.toDate, ...done });
  }
  // Ett ärende som inte pågår (avslutat, inte startat) säger det – före konflikten, som annars skulle gälla ett tomt startdatum.
  const blocked = startChangeBlockedText(c);
  if (blocked) return fail("wrong_status", blocked);
  // Dialogen visade ett annat startdatum än ärendet har nu: någon annan har ändrat under tiden.
  if (c.startDate !== p.expectedStartDate) return fail("conflict", CONFLICT);
  const [activities, attendance, billing] = await Promise.all([
    ctx.repo.table("activities").list({ caseId: c.id }),
    ctx.repo.table("attendance").list({ caseId: c.id }),
    billingFor(ctx, c, p.startDate),
  ]);
  const plan = planStartChange({ case: c, to: p.startDate, motivation: p.motivation, activities, attendance, billing });
  if (!plan.ok) return fail(plan.problem.code, plan.problem.text);
  const { from, to } = plan.plan;
  const now = ctx.now();
  const me = ctx.actor.userId;
  const seq = nextStartChangeSeq(await ctx.repo.table("case_start_changes").list({ caseId: c.id }));

  // 1. Motiveringen – en anteckning i deltagarkortet (internt för Miljonbemanning, aldrig till kommunen). Den skrivs först
  //    (ändringen pekar på den) och döljs igen om ändringen inte kan skrivas. Efteråt är den låst (0038, policy.ts caseNoteWrite).
  const noteId = ctx.newId("note");
  const note: CaseNote = {
    id: noteId, contractId: c.contractId, caseId: c.id, authorId: me, occurredOn: dayOf(now), kind: "other", audience: "team",
    body: startChangeNoteBody(from, to, p.motivation), createdAt: now, updatedAt: null, removedAt: null, removedBy: null,
  };
  await ctx.repo.table("case_notes").insert(note);
  const hideNote = () => ctx.repo.table("case_notes").update(noteId, { removedAt: now, removedBy: me });
  // 2. Ändringen (datum, id:n och tid). Ärendets startdatum ändras i samma transaktion (triggern case_start_changes_apply), som
  //    prövar reglerna igen: har ärendet, faktureringen eller närvaron hunnit ändras nekas hela ändringen.
  const change: CaseStartChange = { id: ctx.newId("csc"), contractId: c.contractId, caseId: c.id, fromDate: from, toDate: to, changedBy: me, changedAt: now, noteId, seq };
  try {
    await ctx.repo.table("case_start_changes").insert(change);
  } catch (e) {
    if (lostRace(e)) {
      await hideNote();
      const cur = await ctx.repo.table("cases").get(c.id);
      return fail("conflict", cur && cur.startDate !== from ? CONFLICT : REFUSED);
    }
    // Svaret kom inte fram: ändringen och ärendet skrivs tillsammans, så finns raden har ärendet fått det nya datumet.
    const saved = await readBack(ctx, change.id);
    if (saved === "unknown") {
      await hideNote().catch(() => undefined);
      return fail("unknown", UNKNOWN);
    }
    if (!saved) {
      await hideNote().catch(() => undefined);
      throw e;
    }
  }
  return ok({ changeId: change.id, noteId, startDate: to, ...(await finishChange(ctx, c, change)) });
});

/**
 * Fakturornas läge för månaderna som ändringen rör (bara status, grupp och vilka ärenden en faktura har rader för – inga belopp).
 * ctx.system: coachen och samordnaren läser inte faktureringen (RLS), och kontrollen behöver bara veta om månaden är fakturerad.
 * Ingenting av det lämnas ut – svaret säger bara vilken månad som stoppar.
 */
async function billingFor(ctx: Ctx, c: Case, to: LocalDate): Promise<StartChangeBilling> {
  if (!c.startDate || c.startDate === to) return NO_BILLING;
  const months = startChangeMonths(c.startDate, to, c.pausedWeeks);
  if (!months.length) return NO_BILLING;
  const s = ctx.system;
  const [drafts, runs] = await Promise.all([
    s.table("invoice_drafts").pick(["contractId", "month", "kind", "groupingKey", "status"], { contractId: c.contractId, month: { in: months } }),
    s.table("billing_runs").pick(["contractId", "month", "status"], { contractId: c.contractId, month: { in: months } }),
  ]);
  const lines = drafts.length ? await s.table("invoice_lines").pick(["invoiceDraftId", "caseId"], { caseId: c.id, invoiceDraftId: { in: drafts.map((d) => d.id) } }) : [];
  return { drafts, lines, runs };
}

/** Ändringen läst om efter ett tappat svar: raden, null (finns inte) eller "unknown" (gick inte att läsa – tre försök). */
async function readBack(ctx: Ctx, id: string): Promise<CaseStartChange | null | "unknown"> {
  for (let i = 0; i < 3; i++) {
    try {
      return await ctx.repo.table("case_start_changes").get(id);
    } catch {
      // Försök igen.
    }
  }
  return "unknown";
}

/**
 * Ärendets senaste ändring när den är samma egna ändring som nu begärs: samma gamla och nya datum, gjord av den som frågar,
 * högst FINISH_WITHIN_MINUTES gammal, och ärendet har fortfarande det nya startdatumet. logged = vad loggen säger att ändringen
 * gjorde (den är klar), annars null (städningen och loggen återstår).
 */
async function sameOwnChange(ctx: Ctx, c: Case, p: { startDate: LocalDate; expectedStartDate: LocalDate }): Promise<{ change: CaseStartChange; logged: Finished | null } | null> {
  if (c.startDate !== p.startDate || p.startDate === p.expectedStartDate) return null;
  const last = startChangesInOrder(await ctx.repo.table("case_start_changes").list({ caseId: c.id })).at(-1);
  if (!last || last.changedBy !== ctx.actor.userId || last.toDate !== p.startDate || last.fromDate !== p.expectedStartDate) return null;
  const age = diffMinutes(last.changedAt, ctx.now());
  if (age < 0 || age > FINISH_WITHIN_MINUTES) return null;
  // Revisionsloggen läses av servern (bara om raden finns – samma uppslag som Byt yrkesområde).
  const log = (await ctx.system.table("audit_log").list({ entity: "case", entityId: c.id, action: "case.start_date_changed" })).find((l) => l.details?.changeId === last.id);
  if (!log) return { change: last, logged: null };
  const n = (k: string) => (Array.isArray(log.details?.[k]) ? (log.details[k] as unknown[]).length : 0);
  return { change: last, logged: { removed: n("removedActivityIds"), autoAttendanceRemoved: n("removedAutoAttendanceIds"), groups: null } };
}

/**
 * Stegen efter ändringen (ärendet har redan det nya startdatumet): tillfällena före det nya datumet, revisionsloggen och
 * inbjudningarna. Räknas fram ur dagens data, så att samma steg kan göras om (sameOwnChange).
 */
async function finishChange(ctx: Ctx, c: Case, change: CaseStartChange): Promise<Finished> {
  // 3. Tillfällena före det nya startdatumet: de utan närvaro och de med bara automatisk närvaro tas bort. Ett tillfälle som fått
  //    närvaro registrerad av en människa under tiden ligger kvar (kept) – det loggas.
  const [activities, attendance] = await Promise.all([ctx.repo.table("activities").list({ caseId: c.id }), ctx.repo.table("attendance").list({ caseId: c.id })]);
  const { remove, blocked } = activitiesBeforeStart(c.id, change.toDate, activities, attendance);
  const removed: string[] = [];
  const autoRemoved: string[] = [];
  const kept = blocked.map((b) => b.activityId);
  const groupRows = new Map<string, string[]>();
  const now = ctx.now();
  const audienceRow = new Set(activities.filter((a) => a.inviteSource === "audience").map((a) => a.id));
  for (const r of remove) {
    // En kommande rad som målgruppen (nivån eller yrkesområdet) bjöd in tar synkningen bort i steg 5 – med samma meddelande till
    // deltagaren som när nivån eller yrkesområdet ändras (när aktiviteten har meddelanden påslagna) och samma logg.
    if (r.groupActivityId && r.startsAt > now && audienceRow.has(r.activityId)) continue;
    // Den automatiska närvaroraden skrevs av systemet (jobbet auto_attendance) och tas bort av systemet – användare tar aldrig
    // bort närvaro. Raden finns bara för tillfällen som tas bort här.
    if (r.attendanceId) {
      await ctx.system.table("attendance").remove(r.attendanceId);
      autoRemoved.push(r.attendanceId);
    }
    const out = await removeParticipantRow(ctx, ctx.repo, r.activityId);
    if (out === "kept") {
      kept.push(r.activityId);
      continue;
    }
    if (out === "removed") removed.push(r.activityId);
    if (out === "removed" && r.groupActivityId) groupRows.set(r.groupActivityId, [...(groupRows.get(r.groupActivityId) ?? []), r.activityId]);
  }
  // Rader i gruppaktiviteter loggas också på aktiviteten (samma händelse som Ta bort i aktivitetsvyn), och uppgiften att ringa om
  // inbjudan stängs. Deltagaren får inget meddelande om en rad som coachen eller samordnaren bjöd in för hand (Ta bort i
  // aktivitetsvyn frågar om det – här finns ingen fråga): coachen berättar om ett kommande tillfälle försvinner.
  for (const [groupActivityId, activityIds] of groupRows) {
    const g = await ctx.repo.table("group_activities").get(groupActivityId);
    if (!g) continue;
    await ctx.audit({
      action: "group_activity.removed_participant", entity: "group_activity", entityId: g.id, contractId: g.contractId,
      details: { caseIds: [c.id], activityIds, via: "start_date_changed" },
    });
    await supersedeTasks(ctx, [c], g, "Startdatumet är ändrat – deltagaren är inte med i aktiviteten.");
  }
  // 4. Revisionsloggen: id:n och datum – aldrig motiveringen.
  await ctx.audit({
    action: "case.start_date_changed", entity: "case", entityId: c.id, contractId: c.contractId,
    details: {
      caseId: c.id, changeId: change.id, noteId: change.noteId, seq: change.seq, from: change.fromDate, to: change.toDate,
      removedActivityIds: removed, removedAutoAttendanceIds: autoRemoved, ...(kept.length ? { keptActivityIds: kept } : {}),
    },
  });
  // 5. Inbjudningarna till kommande gruppaktiviteter med målgrupp följer det nya startdatumet (samma systemsteg som när insatsen
  //    startar). Ändringen är redan sparad: ett fel här loggas bara som feltyp och jobbet report_schedule stämmer av senare.
  let groups: Finished["groups"] = null;
  try {
    const sync = await syncAudienceInvites(ctx, { contractId: c.contractId, caseIds: [c.id] });
    groups = { invited: sync.added, removed: sync.removed };
  } catch (e) {
    console.error("ändra startdatum: inbjudningarna kunde inte stämmas av", e instanceof Error ? e.name : typeof e);
  }
  return { removed: removed.length, autoAttendanceRemoved: autoRemoved.length, groups };
}
