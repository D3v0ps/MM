// Hanterare för området aktiviteter: gruppaktiviteter och aktivitetsvyn (coachmötet 2026-10-09). Registreras via
// src/api/handlers.ts – importeras aldrig av skärmar.
//
// Läsning och skrivning går via ctx.repo (policyn/RLS: group_activities för Miljonbemanning i avtalet utom ekonomen, deltagarnas
// tillfällen i activities, närvaron i attendance och anteckningarna i case_notes med samma regler som förut). Revisionsloggen
// får en rad per ändring med id:n, tider och antal – aldrig namnet, platsen eller anteckningens text.
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { GROUP_KIND_LABEL, INVITE_BLOCK_TEXT, inviteBlock } from "@/core/group-activities";
import { ABSENCE_REASONS } from "@/core/labels";
import { addDays, dayOf, fmtDate, type LocalDate } from "@/core/time";
import { by, uniq } from "@/core/util";
import { GROUP_ACTIVITY_KINDS, type Activity, type Case, type GroupActivity, type Person } from "@/data/schema";
import { NOTE_PNR_TEXT, noteProblem } from "../_shared/notes";
import {
  groupActivityCancel, groupActivityCreate, groupActivityForm, groupActivityInvite, groupActivityList, groupActivityNotes, groupActivityRemove, groupActivityUpdate,
  groupActivityView, type GroupActivityListRow, type GroupParticipant, type InviteProblem,
} from "./api";

/** De som arbetar i ärendena skapar, ändrar, bjuder in, tar närvaro och skriver anteckningar (policyns CASE_WORKERS). */
const GROUP_WRITERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare"];
/** Alla på Miljonbemanning utom ekonomen läser ("alla ser alla", beslut 2026-10-09). Chef och systemadministratör i läsläge. */
const GROUP_READERS: readonly Role[] = [...GROUP_WRITERS, "chef", "admin"];

const NOT_FOUND = "Aktiviteten finns inte, eller så har du inte behörighet att se den.";
const CANCELLED = "Aktiviteten är inställd och kan inte ändras.";
const CASES_NOT_FOUND = "Någon av deltagarna finns inte längre eller får inte bjudas in av dig. Ladda om sidan.";
const HAS_ATTENDANCE_TIME = "Närvaron är redan registrerad för minst en deltagare. Tiden kan inte flyttas – ändra namn, plats eller längd i stället.";

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

/** Ärenden som inte kan bjudas in dagen – i ärendenummerordning. */
function problemsOf(cases: readonly Case[], day: LocalDate): InviteProblem[] {
  return cases
    .map((c) => ({ c, block: inviteBlock(c, day) }))
    .filter((x) => x.block)
    .sort((a, b) => (a.c.caseNumber < b.c.caseNumber ? -1 : 1))
    .map((x) => ({ caseId: x.c.id, caseNumber: x.c.caseNumber, reason: INVITE_BLOCK_TEXT[x.block!] }));
}
const problemsText = (problems: readonly InviteProblem[]) =>
  `${problems.length === 1 ? "En deltagare" : `${problems.length} deltagare`} kan inte bjudas in: ${problems.map((x) => `${x.caseNumber} (${x.reason.toLowerCase()})`).join(", ")}.`;

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

/** Deltagarnas tillfällen: samma tid, längd, plats och typ som aktiviteten. Skrivs via behörigheten (activities, workOn). */
async function addParticipants(ctx: Ctx, g: GroupActivity, cases: readonly Case[]): Promise<string[]> {
  const ids: string[] = [];
  for (const c of [...cases].sort(by<Case>("caseNumber"))) {
    const id = ctx.newId("a");
    await ctx.repo.table("activities").insert({ id, caseId: c.id, kind: g.kind, startsAt: g.startsAt, durationMin: g.durationMin, location: g.location, note: "", groupActivityId: g.id });
    ids.push(id);
  }
  return ids;
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
  return { now, canCreate: GROUP_WRITERS.includes(ctx.actor.role), upcoming: upcoming.map(row), earlier: earlier.map(row) };
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
  const participants: GroupParticipant[] = [];
  for (const a of acts) {
    const c = await ctx.repo.table("cases").get(a.caseId);
    if (!c) continue;
    const person = await ctx.repo.table("persons").get(c.personId);
    const at = regOf.get(a.id);
    participants.push({
      activityId: a.id, caseId: c.id, caseNumber: c.caseNumber, name: nameOf(person),
      attendance: at ? { status: at.status, reason: at.reason, source: at.source } : null,
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
    },
    participants,
    canEdit: GROUP_WRITERS.includes(ctx.actor.role) && !g.cancelledAt,
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
  };
});

// ================================================================ Kommandon
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
  const holiday = await holidayOn(ctx, day);
  if (holiday && !p.acceptHoliday) return fail("holiday", holidayText(day, holiday));
  const problems = problemsOf(cases, day);
  if (problems.length) return { ...fail("not_invitable", problemsText(problems)), problems };
  const responsibleId = p.responsibleId ?? null;
  if (!(await responsibleOk(ctx, contractId, responsibleId))) return fail("responsible", "Välj en coach i avtalet som ansvarig.");
  const g: GroupActivity = {
    id: ctx.newId("ga"), contractId, name: p.name.trim(), kind: p.kind, startsAt: p.startsAt, durationMin: p.durationMin, location: p.location.trim(), responsibleId,
    createdBy: ctx.actor.userId, createdAt: now, updatedAt: null, updatedBy: null, cancelledAt: null, cancelledBy: null,
  };
  await ctx.repo.table("group_activities").insert(g);
  const activityIds = await addParticipants(ctx, g, cases);
  // Loggen: id:n, typ, tid och antal – aldrig namnet eller platsen. caseIds gör att kortets Historik visar raden.
  await ctx.audit({
    action: "group_activity.created", entity: "group_activity", entityId: g.id, contractId,
    details: { kind: g.kind, startsAt: g.startsAt, durationMin: g.durationMin, count: cases.length, caseIds: [...ids].sort(), activityIds, ...(holiday ? { holiday: true } : {}) },
  });
  return ok({ groupActivityId: g.id, invited: cases.length });
});

handleCommand(groupActivityUpdate, { roles: GROUP_WRITERS }, async (ctx, p) => {
  const g = await groupOf(ctx, p.id);
  if (!g) return fail("not_found", NOT_FOUND);
  if (g.cancelledAt) return fail("cancelled", CANCELLED);
  const acts = await participantsOf(ctx, g.id);
  const moved = p.startsAt !== g.startsAt;
  const day = dayOf(p.startsAt);
  if (moved) {
    if (acts.length && (await ctx.repo.table("attendance").list({ activityId: { in: acts.map((a) => a.id) } })).length) return fail("has_attendance", HAS_ATTENDANCE_TIME);
    const holiday = day !== dayOf(g.startsAt) ? await holidayOn(ctx, day) : null;
    if (holiday && !p.acceptHoliday) return fail("holiday", holidayText(day, holiday));
    const cases = (await Promise.all(uniq(acts.map((a) => a.caseId)).map((id) => ctx.repo.table("cases").get(id)))).filter((c): c is Case => !!c);
    const problems = problemsOf(cases, day);
    if (problems.length) return { ...fail("not_invitable", `Aktiviteten kan inte flyttas till ${fmtDate(day)}. ${problemsText(problems)}`), problems };
  }
  const responsibleId = p.responsibleId ?? null;
  if (responsibleId !== g.responsibleId && !(await responsibleOk(ctx, g.contractId, responsibleId))) return fail("responsible", "Välj en coach i avtalet som ansvarig.");
  const next = { name: p.name.trim(), kind: p.kind, startsAt: p.startsAt, durationMin: p.durationMin, location: p.location.trim(), responsibleId };
  const fields = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== g[k]);
  if (!fields.length) return ok({ changed: 0 });
  const now = ctx.now();
  await ctx.repo.table("group_activities").update(g.id, { ...next, updatedAt: now, updatedBy: ctx.actor.userId });
  // Tid, längd, plats och typ ändras på alla deltagarnas tillfällen.
  const actFields = fields.filter((k) => k === "kind" || k === "startsAt" || k === "durationMin" || k === "location");
  if (actFields.length) {
    for (const a of acts) await ctx.repo.table("activities").update(a.id, { kind: next.kind, startsAt: next.startsAt, durationMin: next.durationMin, location: next.location });
  }
  await ctx.audit({
    action: "group_activity.updated", entity: "group_activity", entityId: g.id, contractId: g.contractId,
    details: { fields, ...(moved ? { startsAt: next.startsAt } : {}), count: acts.length, caseIds: uniq(acts.map((a) => a.caseId)).sort() },
  });
  return ok({ changed: fields.length });
});

handleCommand(groupActivityInvite, { roles: GROUP_WRITERS }, async (ctx, p) => {
  const g = await groupOf(ctx, p.id);
  if (!g) return fail("not_found", NOT_FOUND);
  if (g.cancelledAt) return fail("cancelled", CANCELLED);
  const invited = new Set((await participantsOf(ctx, g.id)).map((a) => a.caseId));
  const wanted = uniq(p.caseIds);
  const ids = wanted.filter((id) => !invited.has(id));
  if (!ids.length) return ok({ invited: 0, already: wanted.length });
  const cases = await ctx.repo.table("cases").list({ id: { in: ids } });
  if (cases.length !== ids.length) return fail("not_found", CASES_NOT_FOUND);
  if (cases.some((c) => c.contractId !== g.contractId)) return fail("contract", "Deltagarna måste höra till aktivitetens avtal.");
  const problems = problemsOf(cases, dayOf(g.startsAt));
  if (problems.length) return { ...fail("not_invitable", problemsText(problems)), problems };
  const activityIds = await addParticipants(ctx, g, cases);
  await ctx.audit({ action: "group_activity.invited", entity: "group_activity", entityId: g.id, contractId: g.contractId, details: { count: cases.length, caseIds: [...ids].sort(), activityIds } });
  return ok({ invited: cases.length, already: wanted.length - ids.length });
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
  return ok({});
});

handleCommand(groupActivityCancel, { roles: GROUP_WRITERS }, async (ctx, p) => {
  const g = await groupOf(ctx, p.id);
  if (!g) return fail("not_found", NOT_FOUND);
  if (g.cancelledAt) return fail("cancelled", "Aktiviteten är redan inställd.");
  const acts = await participantsOf(ctx, g.id);
  if (acts.length && (await ctx.repo.table("attendance").list({ activityId: { in: acts.map((a) => a.id) } })).length) {
    return fail("has_attendance", "Närvaron är redan registrerad – aktiviteten har genomförts och kan inte ställas in. Ta bort enskilda deltagare utan närvaro i stället.");
  }
  for (const a of acts) await ctx.repo.table("activities").remove(a.id);
  await ctx.repo.table("group_activities").update(g.id, { cancelledAt: ctx.now(), cancelledBy: ctx.actor.userId });
  await ctx.audit({
    action: "group_activity.cancelled", entity: "group_activity", entityId: g.id, contractId: g.contractId,
    details: { removed: acts.length, activityIds: acts.map((a) => a.id), caseIds: uniq(acts.map((a) => a.caseId)).sort() },
  });
  return ok({ removed: acts.length });
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
