// Hanterare: Ändra startdatum på deltagarkortet (Karims beslut 2026-10-29). Registreras via ./handlers.ts.
//   Vem:        coach, samordnare och avtalsansvarig med full åtkomst (canEditCase – personen läses via behörigheten). Chef och
//               systemadministratör ser ändringarna i läsläge. Kommunen och ekonomen nekas av rollkontrollen och ser aldrig
//               ändringarna eller motiveringen – kommunen ser bara det nya startdatumet i portalen och får inget meddelande.
//   Regler:     planStartChange i src/core/start-date.ts (pågående eller pausad insats, ett annat datum, tidigast första mötets
//               dag, senast planerat slut, ingen av månaderna som ändringen rör fakturerad eller godkänd, inget tillfälle före det
//               nya datumet med närvaro som en människa registrerat och ingen godkänd mötesrapport före det, ingen månad som blir
//               utan månadsrapport med en lämnad eller godkänd rapport eller en godkänd bedömning, motivering 10–300 tecken utan
//               personnummer). En månadsbedömning som coachen har sparat i en sådan månad stoppar också (revisionsloggen,
//               reportsFor) – det en människa skrivit tas aldrig bort.
//   Skrivning:  via ctx.repo (RLS): först anteckningen med motiveringen (case_notes – låst efteråt: den ändras och tas aldrig bort,
//               0038), sedan ändringen (case_start_changes, nästa nummer i ärendet – seq). Ändringen ändrar ärendets startdatum i
//               samma transaktion (triggern case_start_changes_apply i 0038, policy.ts afterInsert) och prövar reglerna igen i
//               databasen. Sedan görs ändringen klar (finishStartChange i ./start-finish.ts): tillfällena före det nya datumet,
//               utkasten för en månad som blir utan månadsrapport, månadsbedömningarnas förifyllda närvaro, uppgiften att rätta
//               rapporter som redan är lämnade till kommunen, revisionsloggen och inbjudningarna. Inga tillfällen skapas bakåt.
//   Samtidigt:  två ändringar i samma ärende samtidigt – den andra får conflict (den unika nyckeln case_id + seq, och triggern som
//               kräver att ändringen utgår från ärendets nuvarande startdatum). Kan ändringen inte skrivas döljs anteckningen.
//   Avbrott:    ändringen är sparad när städningen börjar. Avbryts den loggas det som hann göras (failed) och svaret är ok med
//               incomplete – dialogen säger att startdatumet är ändrat och att resten görs klart. Ärendets senaste ändring som inte
//               är klar görs klar av nästa ändring i ärendet (vem som helst som får ändra) och av rapportjobbet. Samma ändring
//               igen (egen, samma datum och samma motivering) svarar som första gången; en annan motivering får conflict.
//   Logg:       case.start_date_changed med id:n och datum – aldrig motiveringen (CLAUDE.md punkt 2).
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { personName } from "@/core/labels";
import {
  NO_BILLING, nextStartChangeSeq, planStartChange, START_CHANGERS, startChangeBlockedText, startChangeMonths, startChangeNoteBody, startChangesInOrder, startMotivationOf,
  type StartChangeBilling,
} from "@/core/start-date";
import { dayOf, fmtDate, type LocalDate, type MonthKey } from "@/core/time";
import { uniq } from "@/core/util";
import { PolicyError, UniqueError } from "@/data/repo";
import type { Case, CaseNote, CaseStartChange } from "@/data/schema";
import { canEditCase } from "../_shared/context";
import { caseChangeStart, caseStartView, type CaseStartView } from "./api";
import { changeLogs, finishStartChange, reportsFor, startChangeLogged, type Finished } from "./start-finish";

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
  return {
    caseId: c.id,
    startDate: c.startDate,
    // Avslutad eller inte startad insats: ingen knapp (servern svarar wrong_status med orsaken).
    canChange: START_CHANGERS.includes(ctx.actor.role) && !startChangeBlockedText(c),
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
const REFUSED = "Startdatumet kunde inte ändras: ärendet, faktureringen, närvaron eller rapporterna har ändrats under tiden. Ladda om sidan och försök igen – inget har sparats.";
const UNKNOWN = "Det gick inte att se om ändringen sparades. Försök igen – har den redan sparats görs den klart, annars sparas den nu.";
const code = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? "");
/** En ändring som inte kunde skrivas: någon annan hann före (nästa nummer tog slut), ärendet ändrades eller behörigheten nekade. */
const lostRace = (e: unknown): boolean => e instanceof UniqueError || e instanceof PolicyError || ["23505", "23514", "42501"].includes(code(e));

handleCommand(caseChangeStart, { roles: START_CHANGERS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  // Full åtkomst: personen läses via behörigheten (vilande spärr: bara namngivna ser personen i ett skyddat ärende).
  if (!(await canEditCase(ctx, c))) return fail("forbidden", "Du kan inte ändra startdatumet i det här ärendet.");
  const me = ctx.actor.userId;
  // 1. Ärendets senaste ändring som inte blev klar (städningen avbröts) görs klar först – av den som ändrar härnäst, oavsett vem
  //    som gjorde ändringen och när. Det som återstår loggas på den ändringen.
  const last = startChangesInOrder(await ctx.repo.table("case_start_changes").list({ caseId: c.id })).at(-1) ?? null;
  const pending = last && c.startDate === last.toDate && !(await startChangeLogged(ctx, c.id, last.id)) ? await finishStartChange(ctx, c, last) : null;
  // 2. Samma ändring igen (dubbelklick, svaret kom inte fram): egen, samma datum och samma motivering – svaret som första gången.
  //    Samma datum med en annan motivering (två flikar) sparas inte: motiveringen som gäller står under startdatumet.
  if (last && last.changedBy === me && last.toDate === p.startDate && last.fromDate === p.expectedStartDate && c.startDate === p.startDate) {
    const note = await ctx.repo.table("case_notes").get(last.noteId);
    if (!note || startMotivationOf(note.body, last.fromDate, last.toDate) !== p.motivation.trim()) {
      return fail("conflict", `Du har redan ändrat startdatumet till ${fmtDate(last.toDate)} med en annan motivering. Ladda om sidan – motiveringen som sparades står under startdatumet.`);
    }
    return ok({ changeId: last.id, noteId: last.noteId, startDate: last.toDate, ...(await loggedResult(ctx, c.id, last.id, pending)) });
  }
  // Ett ärende som inte pågår (avslutat, inte startat) säger det – före konflikten, som annars skulle gälla ett tomt startdatum.
  const blocked = startChangeBlockedText(c);
  if (blocked) return fail("wrong_status", blocked);
  // Dialogen visade ett annat startdatum än ärendet har nu: någon annan har ändrat under tiden.
  if (c.startDate !== p.expectedStartDate) return fail("conflict", CONFLICT);
  const [activities, attendance, checkIns, billing, reports] = await Promise.all([
    ctx.repo.table("activities").list({ caseId: c.id }),
    ctx.repo.table("attendance").list({ caseId: c.id }),
    ctx.repo.table("check_ins").pick(["caseId", "heldAt", "status"], { caseId: c.id }),
    billingFor(ctx, c, p.startDate),
    reportsFor(ctx, c),
  ]);
  const plan = planStartChange({ case: c, to: p.startDate, motivation: p.motivation, activities, attendance, checkIns, billing, reports });
  if (!plan.ok) return fail(plan.problem.code, plan.problem.text);
  const { from, to } = plan.plan;
  const now = ctx.now();
  const seq = nextStartChangeSeq(await ctx.repo.table("case_start_changes").list({ caseId: c.id }));

  // 3. Motiveringen – en anteckning i deltagarkortet (internt för Miljonbemanning, aldrig till kommunen). Den skrivs först
  //    (ändringen pekar på den) och döljs igen om ändringen inte kan skrivas. Efteråt är den låst (0038, policy.ts caseNoteWrite).
  const noteId = ctx.newId("note");
  const note: CaseNote = {
    id: noteId, contractId: c.contractId, caseId: c.id, authorId: me, occurredOn: dayOf(now), kind: "other", audience: "team",
    body: startChangeNoteBody(from, to, p.motivation), createdAt: now, updatedAt: null, removedAt: null, removedBy: null,
  };
  await ctx.repo.table("case_notes").insert(note);
  const hideNote = () => ctx.repo.table("case_notes").update(noteId, { removedAt: now, removedBy: me });
  // 4. Ändringen (datum, id:n och tid). Ärendets startdatum ändras i samma transaktion (triggern case_start_changes_apply), som
  //    prövar reglerna igen: har ärendet, faktureringen, närvaron eller rapporterna hunnit ändras nekas hela ändringen.
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
  // 5. Ändringen är sparad: resten görs nu (finishStartChange kastar aldrig – ett avbrott svarar incomplete).
  return ok({ changeId: change.id, noteId, startDate: to, ...(await finishStartChange(ctx, c, change)) });
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
 * Svaret för en ändring som redan gjorts (samma ändring igen): det loggen säger att ändringen gjorde, alla försök tillsammans.
 * pending = det som gjordes nu (inbjudningarna och om något återstår).
 */
async function loggedResult(ctx: Ctx, caseId: string, changeId: string, pending: Finished | null): Promise<Finished> {
  const logs = await changeLogs(ctx, caseId, changeId);
  const ids = (k: string) => logs.flatMap((l) => (Array.isArray(l.details?.[k]) ? (l.details[k] as unknown[]) : []));
  return {
    removed: uniq(ids("removedActivityIds")).length,
    autoAttendanceRemoved: uniq(ids("removedAutoAttendanceIds")).length,
    groups: pending?.groups ?? null,
    droppedMonths: (uniq(ids("droppedMonths").map(String)) as MonthKey[]).sort(),
    draftMonths: (uniq(ids("draftMonths").map(String)) as MonthKey[]).sort(),
    corrections: uniq(ids("correctionReportIds")).length,
    incomplete: !logs.some((l) => l.details?.failed !== true),
  };
}

