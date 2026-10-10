// Hanterare för området aktiviteter: gruppaktiviteter och aktivitetsvyn (coachmötet 2026-10-09). Registreras via
// src/api/handlers.ts – importeras aldrig av skärmar.
//
// Läsning och skrivning går via ctx.repo (policyn/RLS: group_activities för Miljonbemanning i avtalet utom ekonomen, deltagarnas
// tillfällen i activities, närvaron i attendance och anteckningarna i case_notes med samma regler som förut). Revisionsloggen
// får en rad per ändring med id:n, tider och antal – aldrig namnet, platsen, gruppmålet eller anteckningens text.
//
// Spår G: meddelandet till deltagarna (notifyParticipant, src/features/_shared/participant-notify.ts) när de bjuds in, när tid eller
// plats ändras, när en deltagare tas bort och när aktiviteten ställs in – bara när kryssrutan är ikryssad och aktiviteten inte har
// börjat. Inbjudan per grupp eller nivå hoppar över de som inte kan vara med (skipUninvitable). Gruppmålet: group_activities.goal
// och coachens val per deltagare i group_goal_results (ingen rad = Klarade automatiskt) – ett val gäller bara målets version
// (goal_version) och deltagarens tillfälle det gjordes för.
import { fail, ok, type Fail } from "@/api/contract";
import { hasAnyRole, type Role } from "@/api/roles";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import {
  ACTIVITY_KIND_WORD, GROUP_KIND_LABEL, INVITE_BLOCK_TEXT, inviteBlock, overlaps, slotText, type InviteGrouping, type UninvitableMember,
} from "@/core/group-activities";
import { ABSENCE_REASONS } from "@/core/labels";
import { addDays, dayOf, fmtDate, type LocalDate, type LocalDateTime } from "@/core/time";
import { by, uniq } from "@/core/util";
import { looksLikePnr } from "@/core/validation";
import { GROUP_ACTIVITY_KINDS, type Activity, type Case, type CaseStatus, type GroupActivity, type Person } from "@/data/schema";
import { NOTE_PNR_TEXT, noteProblem } from "../_shared/notes";
import { closeActivityTasks, notifyManySummary, notifyParticipant, type ActivityTemplate, type NotifyParticipantResult } from "../_shared/participant-notify";
import {
  groupActivityCancel, groupActivityCreate, groupActivityForm, groupActivityInvite, groupActivityList, groupActivityNotes, groupActivityRemove, groupActivityUpdate,
  groupActivityView, groupGoalResultSet, type GroupActivityListRow, type GroupParticipant, type InviteProblem, type NotifyOutcome,
} from "./api";

/**
 * De som arbetar i ärendena skapar, ändrar, bjuder in, tar närvaro och skriver anteckningar (policyns CASE_WORKERS). Rollen
 * handledare är vilande (Karims beslut 2026-10-09): ingen kan få den och ingen sida når den, men regeln ligger kvar som i RLS.
 */
const GROUP_WRITERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare"];
/** Alla på Miljonbemanning utom ekonomen läser ("alla ser alla", beslut 2026-10-09). Chef och systemadministratör i läsläge. */
const GROUP_READERS: readonly Role[] = [...GROUP_WRITERS, "chef", "admin"];

const NOT_FOUND = "Aktiviteten finns inte, eller så har du inte behörighet att se den.";
const CANCELLED = "Aktiviteten är inställd och kan inte ändras.";
const CASES_NOT_FOUND = "Någon av deltagarna finns inte längre eller får inte bjudas in av dig. Ladda om sidan.";
const HAS_ATTENDANCE_TIME = "Närvaron är redan registrerad för minst en deltagare. Tiden kan inte flyttas – ändra namn, plats eller längd i stället.";
/** Vilande spärren för skyddade personuppgifter: aktören läser ärendet men arbetar inte i det (policyns workOn). */
const NOT_WORKABLE = "Skyddade personuppgifter – bara huvudcoachen och avtalsansvarig kan bjuda in deltagaren";
const RESTRICTED =
  "Någon av deltagarna har skyddade personuppgifter och kan bara ändras av huvudcoachen eller avtalsansvarig. Ingenting har ändrats – be någon av dem göra ändringen.";

const nameOf = (p: Pick<Person, "firstName" | "lastName"> | null | undefined): string => (p ? `${p.firstName} ${p.lastName}` : "–");

/** Gruppaktiviteten via behörigheten, eller null. */
const groupOf = (ctx: Ctx, id: string): Promise<GroupActivity | null> => ctx.repo.table("group_activities").get(id);
/** Deltagarnas tillfällen (en rad per deltagare). */
const participantsOf = (ctx: Ctx, groupActivityId: string): Promise<Activity[]> => ctx.repo.table("activities").list({ groupActivityId });

/** Helgdagens namn (tabellen holidays), eller null. */
async function holidayOn(ctx: Ctx, day: LocalDate): Promise<string | null> {
  return (await ctx.repo.table("holidays").get(day))?.name ?? null;
}
const holidayText = (day: LocalDate, name: string) => `${fmtDate(day)} är en helgdag (${name}). Vill du lägga aktiviteten där ändå?`;

/** En rad per ärende (orsakerna slås ihop), i ärendenummerordning. */
function mergeProblems(problems: readonly InviteProblem[]): InviteProblem[] {
  const byCase = new Map<string, InviteProblem>();
  for (const p of problems) {
    const cur = byCase.get(p.caseId);
    byCase.set(p.caseId, cur ? { ...cur, reason: `${cur.reason}. ${p.reason}` } : p);
  }
  return [...byCase.values()].sort((a, b) => (a.caseNumber < b.caseNumber ? -1 : 1));
}
/** Ärenden som inte kan bjudas in dagen – i ärendenummerordning. */
function problemsOf(cases: readonly Case[], day: LocalDate): InviteProblem[] {
  return mergeProblems(
    cases.map((c) => ({ c, block: inviteBlock(c, day) })).filter((x) => x.block).map((x) => ({ caseId: x.c.id, caseNumber: x.c.caseNumber, reason: INVITE_BLOCK_TEXT[x.block!] })),
  );
}
const problemsText = (problems: readonly InviteProblem[]) =>
  `${problems.length === 1 ? "En deltagare" : `${problems.length} deltagare`} kan inte bjudas in: ${problems.map((x) => `${x.caseNumber} (${x.reason.toLowerCase()})`).join(", ")}.`;

/**
 * Ärenden som aktören läser men inte arbetar i: personen går inte att läsa (vilande spärren för skyddade personuppgifter – en
 * annan coach eller samordnaren får bara ärendenummer och status). Prövas innan något skrivs, så att policyn (RLS activities,
 * workOn) aldrig stoppar mitt i en inbjudan. För de roller som skriver gruppaktiviteter är "personen läsbar" samma sak som workOn.
 */
async function notWorkable(ctx: Ctx, cases: readonly Case[]): Promise<InviteProblem[]> {
  if (!cases.length) return [];
  const readable = new Set((await ctx.repo.table("persons").pick(["id"], { id: { in: uniq(cases.map((c) => c.personId)) } })).map((p) => p.id));
  return cases.filter((c) => !readable.has(c.personId)).map((c) => ({ caseId: c.id, caseNumber: c.caseNumber, reason: NOT_WORKABLE }));
}

/**
 * Deltagarnas andra tillfällen som överlappar aktivitetens tid (samma dag; aktivitetens egna rader räknas inte). Ett eget tillfälle
 * utan närvaro kan ersättas (replaceable); ett tillfälle med registrerad närvaro eller en annan gruppaktivitet stoppar (blocking).
 * Utan kontrollen får deltagaren två planerade tillfällen samtidigt – båda räknas i veckorapporten, närvarograden och den
 * automatiska närvaron (avtalets veckoplan har t.ex. yrkesmoment tisdag och torsdag 09.00).
 */
async function overlapsFor(
  ctx: Ctx, cases: readonly Case[], slot: { startsAt: string; durationMin: number }, groupActivityId: string | null,
): Promise<{ blocking: InviteProblem[]; replace: InviteProblem[]; replaceable: Activity[] }> {
  const none = { blocking: [], replace: [], replaceable: [] };
  if (!cases.length) return none;
  const day = dayOf(slot.startsAt);
  const caseOf = new Map(cases.map((c) => [c.id, c]));
  const same = (await ctx.repo.table("activities").list({ caseId: { in: [...caseOf.keys()] }, startsAt: { gte: `${day}T00:00`, lte: `${day}T23:59` } }, { orderBy: "startsAt" }))
    .filter((a) => (!groupActivityId || a.groupActivityId !== groupActivityId) && overlaps(a, slot));
  if (!same.length) return none;
  const registered = new Set((await ctx.repo.table("attendance").pick(["activityId"], { activityId: { in: same.map((a) => a.id) } })).map((r) => r.activityId));
  const blocking: InviteProblem[] = [];
  const replace: InviteProblem[] = [];
  const replaceable: Activity[] = [];
  for (const a of same) {
    const c = caseOf.get(a.caseId)!;
    const p = (reason: string): InviteProblem => ({ caseId: c.id, caseNumber: c.caseNumber, reason });
    if (a.groupActivityId) blocking.push(p(`Är redan inbjuden till en annan aktivitet ${slotText(a)}`));
    else if (registered.has(a.id)) blocking.push(p(`Har redan ${ACTIVITY_KIND_WORD[a.kind]} ${slotText(a)} med registrerad närvaro`));
    else {
      replace.push(p(`Har redan ${ACTIVITY_KIND_WORD[a.kind]} ${slotText(a)}. Det ersätts av aktiviteten`));
      replaceable.push(a);
    }
  }
  return { blocking: mergeProblems(blocking), replace: mergeProblems(replace), replaceable };
}
const overlapText = (problems: readonly InviteProblem[]) =>
  `${problems.length === 1 ? "En deltagare har" : `${problems.length} deltagare har`} redan ett tillfälle vid samma tid. Det ersätts av aktiviteten om du fortsätter, så att deltagaren inte räknas två gånger i närvaron och veckorapporten.`;

/**
 * Alla kontroller för deltagare som ska vara med i aktiviteten vid tiden, innan något skrivs: insatsens läge den dagen, att
 * aktören arbetar i ärendet och andra tillfällen vid samma tid. Ett fel att svara med, eller de egna tillfällen som ska ersättas.
 */
async function participantCheck(
  ctx: Ctx, cases: readonly Case[], slot: { startsAt: string; durationMin: number }, groupActivityId: string | null, replaceOverlapping: boolean | undefined,
  prefix = "", skip = false,
): Promise<{ fail: Fail<"not_invitable" | "overlap"> & { problems: InviteProblem[] } } | { replaceable: Activity[]; cases: Case[]; skipped: InviteProblem[] }> {
  const ov = await overlapsFor(ctx, cases, slot, groupActivityId);
  const hard = mergeProblems([...problemsOf(cases, dayOf(slot.startsAt)), ...(await notWorkable(ctx, cases)), ...ov.blocking]);
  if (hard.length && !skip) return { fail: { ...fail("not_invitable", `${prefix}${problemsText(hard)}`), problems: hard } };
  // Per grupp eller nivå (skip): de som inte kan vara med hoppas över – resten bjuds in.
  const out = new Set(hard.map((x) => x.caseId));
  const replace = ov.replace.filter((x) => !out.has(x.caseId));
  if (replace.length && !replaceOverlapping) return { fail: { ...fail("overlap", `${prefix}${overlapText(replace)}`), problems: replace } };
  return { replaceable: ov.replaceable.filter((a) => !out.has(a.caseId)), cases: cases.filter((c) => !out.has(c.id)), skipped: hard };
}

/** Tar bort deltagarnas egna tillfällen som aktiviteten ersätter (bekräftat, utan närvaro – prövat i participantCheck). */
async function removeReplaced(ctx: Ctx, acts: readonly Activity[]): Promise<string[]> {
  for (const a of acts) await ctx.repo.table("activities").remove(a.id);
  return acts.map((a) => a.id);
}

/**
 * Deltagarnas rader i gruppaktiviteten som aktören inte ser (vilande spärren för skyddade personuppgifter). Bara antalet räknas,
 * med ctx.system – inget lämnas ut. Hanterare som ändrar eller tar bort alla deltagares rader nekar då hellre än att lämna
 * en deltagare kvar på den gamla tiden eller i en inställd aktivitet.
 */
async function hiddenParticipants(ctx: Ctx, groupActivityId: string, visible: number): Promise<boolean> {
  return (await ctx.system.table("activities").pick(["id"], { groupActivityId })).length > visible;
}

/** Ansvarig coach: null, eller en coach i avtalet. */
async function responsibleOk(ctx: Ctx, contractId: string, responsibleId: string | null): Promise<boolean> {
  if (!responsibleId) return true;
  return (await ctx.repo.table("memberships").list({ contractId, userId: responsibleId, role: "coach" })).length > 0;
}

/** Aktörens avtal för en ny aktivitet: det första aktiva avtalet hen är medlem i. */
async function primaryContractId(ctx: Ctx): Promise<string | null> {
  const contracts = (await ctx.repo.table("contracts").list({ status: "active" }, { orderBy: "id" })).filter((c) => ctx.actor.contractIds.includes(c.id));
  return contracts[0]?.id ?? null;
}

/**
 * Deltagarnas tillfällen: samma tid, längd, plats och typ som aktiviteten. Skrivs via behörigheten (activities, workOn). Den
 * unika nyckeln (group_activity_id, case_id) – 0030, UNIQUE_KEYS i minnet – stoppar en andra rad för samma deltagare (två
 * samtidiga inbjudningar): deltagaren räknas då som redan inbjuden.
 */
async function addParticipants(ctx: Ctx, g: GroupActivity, cases: readonly Case[]): Promise<{ activityIds: string[]; caseIds: string[]; already: string[] }> {
  const out = { activityIds: [] as string[], caseIds: [] as string[], already: [] as string[] };
  for (const c of [...cases].sort(by<Case>("caseNumber"))) {
    const id = ctx.newId("a");
    try {
      await ctx.repo.table("activities").insert({ id, caseId: c.id, kind: g.kind, startsAt: g.startsAt, durationMin: g.durationMin, location: g.location, note: "", groupActivityId: g.id });
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code !== "23505") throw e;
      out.already.push(c.id);
      continue;
    }
    out.activityIds.push(id);
    out.caseIds.push(c.id);
  }
  return out;
}

/** Gruppmålet: tom text = inget mål. Personnummer stoppas – målet gäller hela gruppen. */
const GOAL_PNR = "Det ser ut som ett personnummer i gruppmålet. Ta bort det – målet gäller hela gruppen.";
function goalText(goal: string | null | undefined): { goal: string | null } | { error: string } {
  const t = (goal ?? "").trim();
  if (!t) return { goal: null };
  return looksLikePnr(t) ? { error: GOAL_PNR } : { goal: t };
}

/**
 * Meddelandet till deltagarna (spår G): ett utskick per deltagare via notifyParticipant – tid, plats och Miljonbemannings
 * telefonnummer, aldrig namn. Kanalerna och uppgiften till samordnaren när ingen kanal finns avgörs där. Loggas som
 * group_activity.notified med mallen, ärendena och antalen. null när ingen deltagare berördes.
 */
async function notifyAll(
  ctx: Ctx, g: Pick<GroupActivity, "id" | "contractId">, template: ActivityTemplate, caseIds: readonly string[], slot: { when: LocalDateTime; place: string },
  previous?: LocalDateTime,
): Promise<NotifyOutcome> {
  const results: NotifyParticipantResult[] = [];
  for (const caseId of caseIds) results.push(await notifyParticipant(ctx, { caseId, template, when: slot.when, place: slot.place, previous: previous ?? null }));
  const summary = notifyManySummary(template, results);
  if (!summary) return null;
  const sent = results.filter((r) => !r.blocked && r.channels.some((c) => c === "email" || c === "sms")).length;
  const tasks = results.filter((r) => !r.blocked && r.taskId).length;
  await ctx.audit({
    action: "group_activity.notified", entity: "group_activity", entityId: g.id, contractId: g.contractId,
    details: { template, caseIds: [...caseIds].sort(), count: caseIds.length, sent, tasks, startsAt: slot.when },
  });
  return { sent, tasks, summary };
}
/** Meddelanden skickas bara inför en aktivitet som inte har börjat. */
const upcoming = (ctx: Ctx, startsAt: LocalDateTime): boolean => startsAt > ctx.now();

/**
 * Tiden eller platsen gäller inte längre (ny tid, inställd, borttagen deltagare): öppna uppgifter att ringa deltagarna om den
 * gamla tiden stängs (closeActivityTasks) – annars ringer samordnaren med fel tid.
 */
async function supersedeTasks(ctx: Ctx, cases: readonly Pick<Case, "id" | "caseNumber" | "contractId">[], was: Pick<GroupActivity, "startsAt" | "location">, note: string): Promise<void> {
  for (const c of cases) await closeActivityTasks(ctx, c, { when: was.startsAt, place: was.location }, note);
}

/** Orsaken för en deltagare i en nivå eller grupp som inte kan bjudas in alls (insatsen pågår inte). */
function memberReason(status: CaseStatus): string {
  if (status === "closed") return INVITE_BLOCK_TEXT.closed;
  if (status === "declined") return INVITE_BLOCK_TEXT.declined;
  return "Insatsen har inte startat";
}

// ================================================================ Frågor
handleQuery(groupActivityList, { roles: GROUP_READERS }, async (ctx) => {
  const now = ctx.now();
  const today = dayOf(now);
  const groups = await ctx.repo.table("group_activities").list({}, { orderBy: "startsAt" });
  const upcoming = groups.filter((g) => dayOf(g.startsAt) >= today);
  const earlier = groups.filter((g) => dayOf(g.startsAt) < today).reverse().slice(0, 100);
  const shown = [...upcoming, ...earlier];
  const acts = shown.length ? await ctx.repo.table("activities").list({ groupActivityId: { in: shown.map((g) => g.id) } }) : [];
  const regs = new Set(acts.length ? (await ctx.repo.table("attendance").pick(["activityId"], { activityId: { in: acts.map((a) => a.id) } })).map((r) => r.activityId) : []);
  const names = new Map<string, string>();
  for (const id of uniq(shown.map((g) => g.responsibleId).filter((x): x is string => !!x))) {
    const p = await ctx.repo.table("profiles").get(id);
    if (p) names.set(id, p.fullName);
  }
  const row = (g: GroupActivity): GroupActivityListRow => {
    const mine = acts.filter((a) => a.groupActivityId === g.id);
    return {
      id: g.id, name: g.name, kind: g.kind, startsAt: g.startsAt, durationMin: g.durationMin, location: g.location,
      responsibleName: g.responsibleId ? names.get(g.responsibleId) ?? null : null, invited: mine.length, registered: mine.filter((a) => regs.has(a.id)).length,
      cancelled: !!g.cancelledAt,
    };
  };
  return { now, canCreate: hasAnyRole(ctx.actor, GROUP_WRITERS), upcoming: upcoming.map(row), earlier: earlier.map(row) };
});

handleQuery(groupActivityView, { roles: GROUP_READERS }, async (ctx, p) => {
  const g = await groupOf(ctx, p.id);
  if (!g) return { kind: "gate" as const, title: "Aktiviteten finns inte", text: NOT_FOUND };
  const day = dayOf(g.startsAt);
  const acts = await participantsOf(ctx, g.id);
  const ids = acts.map((a) => a.id);
  const regs = ids.length ? await ctx.repo.table("attendance").list({ activityId: { in: ids } }) : [];
  const regOf = new Map(regs.map((r) => [r.activityId, r]));
  const caseIds = uniq(acts.map((a) => a.caseId));
  // Anteckningar från aktivitetens dag som den inloggade får läsa (samma regler som deltagarkortet).
  const notes = caseIds.length ? (await ctx.repo.table("case_notes").list({ caseId: { in: caseIds }, occurredOn: day }, { orderBy: "createdAt" })).filter((n) => !n.removedAt) : [];
  const profileName = async (id: string | null) => (id ? (await ctx.repo.table("profiles").get(id))?.fullName ?? null : null);
  const authorNames = new Map<string, string>();
  for (const id of uniq(notes.map((n) => n.authorId))) authorNames.set(id, (await profileName(id)) ?? "–");
  // Gruppmålet: coachens val per deltagare (ingen rad = Klarade automatiskt). Ett val gäller bara målet och inbjudan det gjordes
  // för: rader för en tidigare version av målet, eller från innan deltagaren bjöds in igen (ett annat tillfälle), räknas inte.
  const goalRows = g.goal ? await ctx.repo.table("group_goal_results").list({ groupActivityId: g.id, goalVersion: g.goalVersion }) : [];
  const goalOf = new Map(goalRows.map((r) => [r.activityId, r]));
  const participants: GroupParticipant[] = [];
  for (const a of acts) {
    const c = await ctx.repo.table("cases").get(a.caseId);
    if (!c) continue;
    const person = await ctx.repo.table("persons").get(c.personId);
    const at = regOf.get(a.id);
    participants.push({
      activityId: a.id, caseId: c.id, caseNumber: c.caseNumber, name: nameOf(person),
      attendance: at ? { status: at.status, reason: at.reason, source: at.source } : null,
      goal: g.goal ? { achieved: goalOf.get(a.id)?.achieved ?? true, auto: !goalOf.has(a.id) } : null,
      notes: notes.filter((n) => n.caseId === c.id).map((n) => ({ id: n.id, body: n.body, authorName: authorNames.get(n.authorId) ?? "–" })),
    });
  }
  participants.sort((x, y) => x.name.localeCompare(y.name, "sv") || (x.caseNumber < y.caseNumber ? -1 : 1));
  return {
    kind: "ok" as const,
    now: ctx.now(),
    activity: {
      id: g.id, contractId: g.contractId, name: g.name, kind: g.kind, startsAt: g.startsAt, durationMin: g.durationMin, location: g.location, responsibleId: g.responsibleId,
      responsibleName: await profileName(g.responsibleId), createdByName: (await profileName(g.createdBy)) ?? "–", cancelledAt: g.cancelledAt, holiday: await holidayOn(ctx, day),
      goal: g.goal,
    },
    participants,
    canEdit: hasAnyRole(ctx.actor, GROUP_WRITERS) && !g.cancelledAt,
    absenceReasons: [...ABSENCE_REASONS],
  };
});

handleQuery(groupActivityForm, { roles: GROUP_WRITERS }, async (ctx) => {
  const now = ctx.now();
  const today = dayOf(now);
  const contractId = await primaryContractId(ctx);
  if (!contractId) throw new Error("Inget aktivt avtal");
  const contract = await ctx.repo.table("contracts").get(contractId);
  const coachIds = uniq((await ctx.repo.table("memberships").list({ contractId, role: "coach" })).map((m) => m.userId));
  const coaches: { id: string; name: string }[] = [];
  for (const id of coachIds) {
    const p = await ctx.repo.table("profiles").get(id);
    if (p?.active) coaches.push({ id, name: p.fullName });
  }
  coaches.sort((a, b) => a.name.localeCompare(b.name, "sv"));
  // Pågående och pausade ärenden (pausade visas med orsaken men kan inte väljas). Avslutade och avböjda visas inte alls.
  const cases = (await ctx.repo.table("cases").list({ contractId, status: { in: ["active", "paused"] } })).sort(by<Case>("caseNumber"));
  const persons = cases.length ? await ctx.repo.table("persons").list({ id: { in: uniq(cases.map((c) => c.personId)) } }) : [];
  const personOf = new Map(persons.map((p) => [p.id, p]));
  const coachName = new Map(coaches.map((c) => [c.id, c.name]));
  const holidays = await ctx.repo.table("holidays").list({ date: { gte: today, lte: addDays(today, 366) } }, { orderBy: "date" });
  // Inbjudan per nivå eller grupp (spår G): avtalets aktiva nivåer och grupper med deltagarna den inloggade får se (policyn för
  // grouping_members). Deltagare vars insats inte pågår räknas upp som överhoppade med orsaken.
  const [gs, ms] = await Promise.all([
    ctx.repo.table("groupings").list({ contractId, archivedAt: { isNull: true }, kind: { in: ["level", "group"] } }),
    ctx.repo.table("grouping_members").list({ contractId, removedAt: { isNull: true }, kind: { in: ["level", "group"] } }),
  ]);
  const groupings: InviteGrouping[] = gs
    .sort((a, b) => (a.kind === b.kind ? a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "sv") : a.kind === "level" ? -1 : 1))
    .map((x) => ({ id: x.id, kind: x.kind as "level" | "group", name: x.name, caseIds: uniq(ms.filter((m) => m.groupingId === x.id).map((m) => m.caseId)).sort() }));
  const candidateIds = new Set(cases.filter((c) => personOf.has(c.personId)).map((c) => c.id));
  const otherIds = uniq(groupings.flatMap((x) => x.caseIds)).filter((id) => !candidateIds.has(id));
  const otherCases = otherIds.length ? await ctx.repo.table("cases").list({ id: { in: otherIds } }) : [];
  const otherPersons = otherCases.length ? await ctx.repo.table("persons").list({ id: { in: uniq(otherCases.map((c) => c.personId)) } }) : [];
  const otherPersonOf = new Map(otherPersons.map((x) => [x.id, x]));
  const others: UninvitableMember[] = otherCases.sort(by<Case>("caseNumber")).map((c) => {
    const person = otherPersonOf.get(c.personId);
    // Personen går inte att läsa (vilande spärren för skyddade personuppgifter): bara ärendenumret och orsaken.
    if (!person) return { caseId: c.id, caseNumber: c.caseNumber, name: null, reason: NOT_WORKABLE };
    return { caseId: c.id, caseNumber: c.caseNumber, name: nameOf(person), reason: memberReason(c.status) };
  });
  return {
    now,
    contractId,
    kinds: GROUP_ACTIVITY_KINDS.map((k) => ({ value: k, label: GROUP_KIND_LABEL[k] })),
    coaches,
    // Bara ärenden vars person den inloggade får se (vilande spärren för skyddade personuppgifter).
    candidates: cases.filter((c) => personOf.has(c.personId)).map((c) => ({
      caseId: c.id, caseNumber: c.caseNumber, name: nameOf(personOf.get(c.personId)), status: c.status, startDate: c.startDate, endDate: c.endDate,
      pausedWeeks: [...c.pausedWeeks], leadCoachName: c.leadCoachId ? coachName.get(c.leadCoachId) ?? null : null,
    })),
    holidays: holidays.map((h) => ({ date: h.date, name: h.name })),
    defaultLocation: contract?.config.activities?.defaultWeekPlan?.[0]?.location ?? "Miljonbemanning",
    me: coachIds.includes(ctx.actor.userId) ? ctx.actor.userId : null,
    groupings,
    others,
  };
});

// ================================================================ Kommandon
/** Nivåerna och grupperna som valdes (revisionsloggen) – bara de som finns i aktivitetens avtal. */
async function selectionLog(ctx: Ctx, contractId: string, p: { via?: string; groupingIds?: string[] }): Promise<Record<string, unknown>> {
  const ids = uniq(p.groupingIds ?? []);
  const known = ids.length ? (await ctx.repo.table("groupings").pick(["id"], { id: { in: ids }, contractId })).map((x) => x.id).sort() : [];
  return { ...(p.via ? { via: p.via } : {}), ...(known.length ? { groupingIds: known } : {}) };
}

handleCommand(groupActivityCreate, { roles: GROUP_WRITERS }, async (ctx, p) => {
  const now = ctx.now();
  const day = dayOf(p.startsAt);
  const ids = uniq(p.caseIds);
  const cases = ids.length ? await ctx.repo.table("cases").list({ id: { in: ids } }) : [];
  if (cases.length !== ids.length) return fail("not_found", CASES_NOT_FOUND);
  const contracts = uniq(cases.map((c) => c.contractId));
  if (contracts.length > 1) return fail("contract", "Deltagarna måste höra till samma avtal.");
  const contractId = contracts[0] ?? (await primaryContractId(ctx));
  if (!contractId || !ctx.actor.contractIds.includes(contractId)) return fail("contract", "Du kan bara skapa aktiviteter i avtal där du arbetar.");
  const goal = goalText(p.goal);
  if ("error" in goal) return fail("goal", goal.error);
  const holiday = await holidayOn(ctx, day);
  if (holiday && !p.acceptHoliday) return fail("holiday", holidayText(day, holiday));
  const check = await participantCheck(ctx, cases, p, null, p.replaceOverlapping, "", !!p.skipUninvitable);
  if ("fail" in check) return check.fail;
  const responsibleId = p.responsibleId ?? null;
  if (!(await responsibleOk(ctx, contractId, responsibleId))) return fail("responsible", "Välj en coach i avtalet som ansvarig.");
  const g: GroupActivity = {
    id: ctx.newId("ga"), contractId, name: p.name.trim(), kind: p.kind, startsAt: p.startsAt, durationMin: p.durationMin, location: p.location.trim(), responsibleId,
    createdBy: ctx.actor.userId, createdAt: now, updatedAt: null, updatedBy: null, cancelledAt: null, cancelledBy: null, goal: goal.goal, goalVersion: 0,
  };
  await ctx.repo.table("group_activities").insert(g);
  const replacedActivityIds = await removeReplaced(ctx, check.replaceable);
  const added = await addParticipants(ctx, g, check.cases);
  // Loggen: id:n, typ, tid och antal – aldrig namnet, platsen eller gruppmålet. caseIds gör att kortets Historik visar raden.
  await ctx.audit({
    action: "group_activity.created", entity: "group_activity", entityId: g.id, contractId,
    details: {
      kind: g.kind, startsAt: g.startsAt, durationMin: g.durationMin, count: added.caseIds.length, caseIds: [...added.caseIds].sort(), activityIds: added.activityIds,
      ...(replacedActivityIds.length ? { replacedActivityIds } : {}), ...(holiday ? { holiday: true } : {}), ...(g.goal ? { goal: true } : {}),
      ...(check.skipped.length ? { skippedCaseIds: check.skipped.map((x) => x.caseId) } : {}), ...(await selectionLog(ctx, contractId, p)),
    },
  });
  const notified = p.notify && upcoming(ctx, g.startsAt) ? await notifyAll(ctx, g, "aktivitetsinbjudan", added.caseIds, { when: g.startsAt, place: g.location }) : null;
  return ok({ groupActivityId: g.id, invited: added.caseIds.length, replaced: replacedActivityIds.length, skipped: check.skipped, notified });
});

handleCommand(groupActivityUpdate, { roles: GROUP_WRITERS }, async (ctx, p) => {
  const g = await groupOf(ctx, p.id);
  if (!g) return fail("not_found", NOT_FOUND);
  if (g.cancelledAt) return fail("cancelled", CANCELLED);
  const acts = await participantsOf(ctx, g.id);
  const moved = p.startsAt !== g.startsAt;
  const day = dayOf(p.startsAt);
  const responsibleId = p.responsibleId ?? null;
  // Gruppmålet: utelämnat = oförändrat.
  const goal = p.goal === undefined ? { goal: g.goal } : goalText(p.goal);
  if ("error" in goal) return fail("goal", goal.error);
  const next = { name: p.name.trim(), kind: p.kind, startsAt: p.startsAt, durationMin: p.durationMin, location: p.location.trim(), responsibleId, goal: goal.goal };
  const fields = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== g[k]);
  if (!fields.length) return ok({ changed: 0, replaced: 0, notified: null });
  // Tid, längd, plats och typ ändras på alla deltagarnas tillfällen – också de aktören inte ser måste kunna ändras.
  const actFields = fields.filter((k) => k === "kind" || k === "startsAt" || k === "durationMin" || k === "location");
  if (actFields.length && (await hiddenParticipants(ctx, g.id, acts.length))) return fail("restricted", RESTRICTED);
  let replaceable: Activity[] = [];
  const cases = (await Promise.all(uniq(acts.map((a) => a.caseId)).map((id) => ctx.repo.table("cases").get(id)))).filter((c): c is Case => !!c);
  if (moved || next.durationMin !== g.durationMin) {
    if (moved && acts.length && (await ctx.repo.table("attendance").list({ activityId: { in: acts.map((a) => a.id) } })).length) return fail("has_attendance", HAS_ATTENDANCE_TIME);
    const holiday = moved && day !== dayOf(g.startsAt) ? await holidayOn(ctx, day) : null;
    if (holiday && !p.acceptHoliday) return fail("holiday", holidayText(day, holiday));
    if (moved) {
      // Ny tid: samma kontroller som en inbjudan (insatsen den dagen och deltagarnas andra tillfällen – aktivitetens egna rader räknas inte).
      const check = await participantCheck(ctx, cases, next, g.id, p.replaceOverlapping, `Aktiviteten kan inte flyttas till ${fmtDate(day)}. `);
      if ("fail" in check) return check.fail;
      replaceable = check.replaceable;
    } else {
      // Ny längd: bara deltagarnas andra tillfällen samma dag.
      const ov = await overlapsFor(ctx, cases, next, g.id);
      if (ov.blocking.length) return { ...fail("not_invitable", `Längden kan inte ändras. ${problemsText(ov.blocking)}`), problems: ov.blocking };
      if (ov.replace.length && !p.replaceOverlapping) return { ...fail("overlap", overlapText(ov.replace)), problems: ov.replace };
      replaceable = ov.replaceable;
    }
  }
  if (responsibleId !== g.responsibleId && !(await responsibleOk(ctx, g.contractId, responsibleId))) return fail("responsible", "Välj en coach i avtalet som ansvarig.");
  const now = ctx.now();
  // Ett nytt mål (ändrat, borttaget eller inskrivet igen) får en ny version – coachens val för det tidigare målet gäller inte längre.
  const goalVersion = next.goal !== g.goal ? g.goalVersion + 1 : g.goalVersion;
  await ctx.repo.table("group_activities").update(g.id, { ...next, goalVersion, updatedAt: now, updatedBy: ctx.actor.userId });
  const replacedActivityIds = await removeReplaced(ctx, replaceable);
  if (actFields.length) {
    for (const a of acts) await ctx.repo.table("activities").update(a.id, { kind: next.kind, startsAt: next.startsAt, durationMin: next.durationMin, location: next.location });
  }
  await ctx.audit({
    action: "group_activity.updated", entity: "group_activity", entityId: g.id, contractId: g.contractId,
    details: {
      fields, ...(moved ? { startsAt: next.startsAt } : {}), count: acts.length, caseIds: uniq(acts.map((a) => a.caseId)).sort(),
      ...(replacedActivityIds.length ? { replacedActivityIds } : {}),
    },
  });
  // Ny tid eller plats (spår G): uppgifterna att ringa om den gamla tiden gäller inte längre, och deltagarna får den nya.
  let notified: NotifyOutcome = null;
  if (moved || next.location !== g.location) {
    await supersedeTasks(ctx, cases, g, "Aktiviteten har fått ny tid eller plats.");
    if (p.notify && upcoming(ctx, next.startsAt)) {
      notified = await notifyAll(ctx, g, "aktivitet_andrad", cases.map((c) => c.id), { when: next.startsAt, place: next.location }, g.startsAt);
    }
  }
  return ok({ changed: fields.length, replaced: replacedActivityIds.length, notified });
});

handleCommand(groupActivityInvite, { roles: GROUP_WRITERS }, async (ctx, p) => {
  const g = await groupOf(ctx, p.id);
  if (!g) return fail("not_found", NOT_FOUND);
  if (g.cancelledAt) return fail("cancelled", CANCELLED);
  const invited = new Set((await participantsOf(ctx, g.id)).map((a) => a.caseId));
  const wanted = uniq(p.caseIds);
  const ids = wanted.filter((id) => !invited.has(id));
  if (!ids.length) return ok({ invited: 0, already: wanted.length, replaced: 0, skipped: [], notified: null });
  const cases = await ctx.repo.table("cases").list({ id: { in: ids } });
  if (cases.length !== ids.length) return fail("not_found", CASES_NOT_FOUND);
  if (cases.some((c) => c.contractId !== g.contractId)) return fail("contract", "Deltagarna måste höra till aktivitetens avtal.");
  const check = await participantCheck(ctx, cases, g, g.id, p.replaceOverlapping, "", !!p.skipUninvitable);
  if ("fail" in check) return check.fail;
  const replacedActivityIds = await removeReplaced(ctx, check.replaceable);
  const added = await addParticipants(ctx, g, check.cases);
  if (added.caseIds.length || replacedActivityIds.length) {
    await ctx.audit({
      action: "group_activity.invited", entity: "group_activity", entityId: g.id, contractId: g.contractId,
      details: {
        count: added.caseIds.length, caseIds: [...added.caseIds].sort(), activityIds: added.activityIds, ...(replacedActivityIds.length ? { replacedActivityIds } : {}),
        ...(check.skipped.length ? { skippedCaseIds: check.skipped.map((x) => x.caseId) } : {}), ...(await selectionLog(ctx, g.contractId, p)),
      },
    });
  }
  const notified = p.notify && upcoming(ctx, g.startsAt) ? await notifyAll(ctx, g, "aktivitetsinbjudan", added.caseIds, { when: g.startsAt, place: g.location }) : null;
  return ok({ invited: added.caseIds.length, already: wanted.length - ids.length + added.already.length, replaced: replacedActivityIds.length, skipped: check.skipped, notified });
});

handleCommand(groupActivityRemove, { roles: GROUP_WRITERS }, async (ctx, p) => {
  const g = await groupOf(ctx, p.id);
  if (!g) return fail("not_found", NOT_FOUND);
  if (g.cancelledAt) return fail("cancelled", CANCELLED);
  const act = await ctx.repo.table("activities").first({ groupActivityId: g.id, caseId: p.caseId });
  if (!act) return fail("not_found", "Deltagaren är inte inbjuden till aktiviteten.");
  if (await ctx.repo.table("attendance").first({ activityId: act.id })) {
    return fail("has_attendance", "Närvaron är registrerad för deltagaren och tillfället kan inte tas bort. Ändra närvaron i stället.");
  }
  await ctx.repo.table("activities").remove(act.id);
  await ctx.audit({ action: "group_activity.removed_participant", entity: "group_activity", entityId: g.id, contractId: g.contractId, details: { caseIds: [p.caseId], activityIds: [act.id] } });
  // Deltagaren är inte längre med: uppgiften att ringa om inbjudan stängs, och deltagaren får beskedet att aktiviteten är inställd för hen.
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (c) await supersedeTasks(ctx, [c], g, "Deltagaren är borttagen från aktiviteten.");
  const notified = c && p.notify && upcoming(ctx, g.startsAt) ? await notifyAll(ctx, g, "aktivitet_installd", [c.id], { when: g.startsAt, place: g.location }) : null;
  return ok({ notified });
});

handleCommand(groupActivityCancel, { roles: GROUP_WRITERS }, async (ctx, p) => {
  const g = await groupOf(ctx, p.id);
  if (!g) return fail("not_found", NOT_FOUND);
  if (g.cancelledAt) return fail("cancelled", "Aktiviteten är redan inställd.");
  const acts = await participantsOf(ctx, g.id);
  if (await hiddenParticipants(ctx, g.id, acts.length)) return fail("restricted", RESTRICTED);
  const attendance = ctx.repo.table("attendance");
  if (acts.length && (await attendance.list({ activityId: { in: acts.map((a) => a.id) } })).length) {
    return fail("has_attendance", "Närvaron är redan registrerad – aktiviteten har genomförts och kan inte ställas in. Ta bort enskilda deltagare utan närvaro i stället.");
  }
  // Först inställd (villkorat: bara om den inte redan är inställd – två samtidiga försök ger ett svar var), sedan tas tillfällena
  // bort. Hinner någon registrera närvaro under tiden (en coach eller jobbet för automatisk närvaro) ligger det tillfället kvar –
  // aktiviteten är ändå inställd och ingen deltagare försvinner utan att det syns i loggen.
  const cancelled = await ctx.repo.table("group_activities").updateIf(g.id, { cancelledAt: { isNull: true } }, { cancelledAt: ctx.now(), cancelledBy: ctx.actor.userId });
  if (!cancelled) return fail("cancelled", "Aktiviteten är redan inställd.");
  const removed: Activity[] = [];
  const kept: Activity[] = [];
  for (const a of acts) {
    if (await attendance.first({ activityId: a.id })) {
      kept.push(a);
      continue;
    }
    try {
      await ctx.repo.table("activities").remove(a.id);
      removed.push(a);
    } catch (e) {
      // Främmande nyckeln attendance.activity_id (23503): närvaron registrerades mellan kontrollen och borttagningen.
      if ((e as { code?: unknown } | null)?.code !== "23503") throw e;
      kept.push(a);
    }
  }
  await ctx.audit({
    action: "group_activity.cancelled", entity: "group_activity", entityId: g.id, contractId: g.contractId,
    details: {
      removed: removed.length, activityIds: removed.map((a) => a.id), caseIds: uniq(acts.map((a) => a.caseId)).sort(),
      ...(kept.length ? { keptActivityIds: kept.map((a) => a.id) } : {}),
    },
  });
  // Spår G: uppgifterna att ringa om inbjudan stängs, och deltagarna vars tillfälle togs bort får beskedet att aktiviteten är inställd.
  const removedCases = (await Promise.all(uniq(removed.map((a) => a.caseId)).map((id) => ctx.repo.table("cases").get(id)))).filter((c): c is Case => !!c);
  await supersedeTasks(ctx, removedCases, g, "Aktiviteten är inställd.");
  const notified = p.notify && upcoming(ctx, g.startsAt) ? await notifyAll(ctx, g, "aktivitet_installd", removedCases.map((c) => c.id), { when: g.startsAt, place: g.location }) : null;
  return ok({ removed: removed.length, kept: kept.length, notified });
});

handleCommand(groupGoalResultSet, { roles: GROUP_WRITERS }, async (ctx, p) => {
  const g = await groupOf(ctx, p.id);
  if (!g) return fail("not_found", NOT_FOUND);
  if (g.cancelledAt) return fail("cancelled", CANCELLED);
  if (!g.goal) return fail("no_goal", "Aktiviteten har inget gruppmål. Skriv ett mål under Ändra först.");
  const now = ctx.now();
  if (g.startsAt >= now) return fail("not_started", "Gruppmålet markeras när aktiviteten har startat.");
  const act = await ctx.repo.table("activities").first({ groupActivityId: g.id, caseId: p.caseId });
  if (!act) return fail("not_invited", "Deltagaren är inte inbjuden till aktiviteten. Ladda om sidan.");
  const t = ctx.repo.table("group_goal_results");
  const set = async (): Promise<{ changed: boolean; wasAuto: boolean }> => {
    const row = await t.first({ groupActivityId: g.id, caseId: p.caseId });
    // Ett val för ett tidigare mål eller en tidigare inbjudan gäller inte (deltagaren står som Klarade automatiskt).
    const cur = row && row.goalVersion === g.goalVersion && row.activityId === act.id ? row : null;
    // Ingen rad = Klarade automatiskt: Klarade ändrar inget.
    if (!cur) {
      if (p.achieved) return { changed: false, wasAuto: true };
      const choice = { activityId: act.id, goalVersion: g.goalVersion, achieved: false, setBy: ctx.actor.userId, setAt: now };
      // En rad per deltagare och aktivitet: den gamla raden förs över till det nuvarande målet och tillfället.
      if (row) await t.update(row.id, choice);
      else await t.insert({ id: ctx.newId("ggr"), contractId: g.contractId, groupActivityId: g.id, caseId: p.caseId, ...choice });
      return { changed: true, wasAuto: true };
    }
    if (cur.achieved === p.achieved) return { changed: false, wasAuto: false };
    await t.update(cur.id, { achieved: p.achieved, setBy: ctx.actor.userId, setAt: now });
    return { changed: true, wasAuto: false };
  };
  let r: { changed: boolean; wasAuto: boolean };
  try {
    r = await set();
  } catch (e) {
    // Två samtidiga val för samma deltagare (unik nyckel, 23505): läs om och gör om valet.
    if ((e as { code?: unknown } | null)?.code !== "23505") throw e;
    r = await set();
  }
  if (r.changed) {
    // Loggen: ärendet och valet – aldrig målets text.
    await ctx.audit({
      action: "group_goal.marked", entity: "group_activity", entityId: g.id, contractId: g.contractId,
      details: { caseIds: [p.caseId], achieved: p.achieved, ...(r.wasAuto ? { wasAuto: true } : {}) },
    });
  }
  return ok({ changed: r.changed });
});

handleCommand(groupActivityNotes, { roles: GROUP_WRITERS }, async (ctx, p) => {
  const g = await groupOf(ctx, p.id);
  if (!g) return fail("not_found", NOT_FOUND);
  if (g.cancelledAt) return fail("cancelled", CANCELLED);
  const now = ctx.now();
  const day = dayOf(g.startsAt);
  if (day > dayOf(now)) return fail("date", "Anteckningar skrivs på aktivitetens dag eller senare.");
  const actOf = new Map((await participantsOf(ctx, g.id)).map((a) => [a.caseId, a]));
  const rows: { c: Case; body: string; audience: "full" }[] = [];
  const problems: InviteProblem[] = [];
  for (const n of p.notes) {
    if (!actOf.has(n.caseId)) return fail("not_invited", "En av deltagarna är inte inbjuden till aktiviteten. Ladda om sidan.");
    const c = await ctx.repo.table("cases").get(n.caseId);
    if (!c) return fail("not_invited", "En av deltagarna är inte inbjuden till aktiviteten. Ladda om sidan.");
    // Samma kontroll som anteckningar i deltagarkortet (src/features/_shared/notes.ts).
    const problem = noteProblem(c, day, n.body, dayOf(now));
    if (problem?.code === "date") return fail("date", problem.text);
    if (problem) problems.push({ caseId: c.id, caseNumber: c.caseNumber, reason: NOTE_PNR_TEXT });
    // Anteckningen syns för dem med full åtkomst – som en anteckning i deltagarkortet (alla på Miljonbemanning sedan 2026-10-09).
    rows.push({ c, body: n.body.trim(), audience: "full" });
  }
  if (problems.length) {
    return { ...fail("pnr", `Det ser ut som ett personnummer i anteckningen för ${problems.map((x) => x.caseNumber).join(", ")}. Ta bort det – ärendenumret räcker. Inget har sparats.`), problems };
  }
  const noteIds: string[] = [];
  for (const r of rows) {
    const id = ctx.newId("note");
    await ctx.repo.table("case_notes").insert({
      id, contractId: r.c.contractId, caseId: r.c.id, authorId: ctx.actor.userId, occurredOn: day, kind: "other", audience: r.audience, body: r.body, createdAt: now,
      updatedAt: null, removedAt: null, removedBy: null,
    });
    // Revisionsloggen: bara id:n – aldrig texten.
    await ctx.audit({ action: "case_note.created", entity: "case_note", entityId: id, contractId: r.c.contractId, details: { caseId: r.c.id, groupActivityId: g.id } });
    noteIds.push(id);
  }
  return ok({ saved: noteIds.length, noteIds });
});
