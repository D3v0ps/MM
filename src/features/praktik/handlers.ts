// Hanterare för området praktik (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
// Källa: prototyp/src/views/admin.js (praktik.arbetsgivare, employer.add, employer.setRight, employer.addFollowUp).
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { accessIndex, caseAccessIn, displayName, type CaseAccess } from "@/core/access";
import { placementDays } from "@/core/schedule";
import { addDays, dayOf } from "@/core/time";
import { uniq } from "@/core/util";
import { emailValid } from "@/core/validation";
import type { Case, ContractArea, Placement } from "@/data/schema";
import { mainContract, userNames } from "../admin/shared";
import { canEditCase } from "../_shared/context";
import {
  placementCreate, placementEnd, praktikAddFollowUp, praktikEmployer, praktikEmployerAdd, praktikList, praktikSetRight, RIGHT_KEYS,
  type AreaOption, type EmployerRow, type OtherPlacementRow, type PlacementCardView, type PlacementGroup, type UpcomingRow,
} from "./api";

/** Rollerna som arbetar i ärendena och använder registret (policyn för employers och placements). */
const WORKERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare"];
const rightsDone = (pl: Pick<Placement, "fourRights">): number => RIGHT_KEYS.filter((k) => pl.fourRights?.[k]).length;
const canSee = (a: CaseAccess) => a === "full" || a === "team";

type Scope = {
  placements: Placement[];
  caseOf: (id: string) => Case | undefined;
  access: (caseId: string) => CaseAccess;
  who: (caseId: string) => string;
  areas: ContractArea[];
};

/**
 * Praktikplatserna och vem aktören får se namn för.
 * ctx.system: registret visar praktikplatserna hos arbetsgivaren (antal, period och de fyra rätten) även i andra team
 * i aktörens avtal – men då utan namn, ärendenummer och arbetsuppgifter (fritext). Åtkomsten räknas med samma regler
 * som behörigheten (caseAccess), och namn läses bara via ctx.repo för ärenden där aktören får se personen.
 * Aldrig med: praktikplatser i andra avtal, och praktikplatser för personer med skyddade personuppgifter – de syns bara
 * för den som får se personen (namngiven huvudcoach och avtalsansvarig), aldrig ens som antal (CLAUDE.md punkt 8).
 */
async function scopeFor(ctx: Ctx): Promise<Scope> {
  const main = await mainContract(ctx);
  const [allPlacements, cases, persons, team, profiles, contracts, areas] = await Promise.all([
    ctx.system.table("placements").list(),
    ctx.system.table("cases").list(),
    ctx.system.table("persons").list(),
    ctx.system.table("case_team").list(),
    ctx.system.table("profiles").list(),
    ctx.system.table("contracts").list(),
    ctx.repo.table("contract_areas").list({ contractId: main.id }),
  ]);
  const byCase = new Map(cases.map((c) => [c.id, c]));
  const src = accessIndex({ persons, case_team: team, profiles, contracts });
  const accessMap = new Map<string, CaseAccess>();
  const access = (caseId: string): CaseAccess => {
    let a = accessMap.get(caseId);
    if (a === undefined) {
      const c = byCase.get(caseId);
      a = c ? caseAccessIn(c, ctx.actor, src) : "none";
      accessMap.set(caseId, a);
    }
    return a;
  };
  const protectedPerson = new Set(persons.filter((p) => p.protectedIdentity).map((p) => p.id));
  const inScope = (caseId: string): boolean => {
    const c = byCase.get(caseId);
    if (!c || !ctx.actor.contractIds.includes(c.contractId)) return false;
    return canSee(access(caseId)) || !protectedPerson.has(c.personId);
  };
  const placements = allPlacements.filter((p) => inScope(p.caseId));
  // Namn bara för ärenden där aktören får se personen – läses med aktörens egen behörighet.
  const visibleIds = uniq(placements.map((p) => p.caseId).filter((id) => canSee(access(id))));
  const visibleCases = await ctx.repo.table("cases").list({ id: { in: visibleIds } });
  const people = await ctx.repo.table("persons").list({ id: { in: uniq(visibleCases.map((c) => c.personId)) } });
  const personOf = new Map(people.map((p) => [p.id, p]));
  const who = (caseId: string): string => {
    const a = access(caseId);
    const c = byCase.get(caseId);
    if (canSee(a) && c) return displayName(c, personOf.get(c.personId), a);
    return a === "restricted" ? "Skyddade personuppgifter" : "Deltagare i ett annat team";
  };
  return { placements, caseOf: (id) => byCase.get(id), access, who, areas };
}

const areaOptions = (areas: ContractArea[], codes: readonly string[]): AreaOption[] =>
  codes.map((code) => ({ code, name: areas.find((a) => a.code === code)?.name ?? "" }));

handleQuery(praktikList, { roles: WORKERS }, async (ctx) => {
  const s = await scopeFor(ctx);
  const employers = await ctx.repo.table("employers").list();
  const today = dayOf(ctx.now());
  const in7 = addDays(today, 7);
  const ongoing = s.placements.filter((p) => p.status === "ongoing");
  // Alla på Miljonbemanning ser alla ärenden i avtalet (beslut 2026-10-09) – ingen roll ser bara "sina" uppföljningar längre.
  const mineOnly = false;
  const upcomingAll = ongoing
    .filter((p) => !mineOnly || canSee(s.access(p.caseId)))
    .flatMap((p) => p.followUpDates.filter((x) => x >= today && x <= in7).map((x) => ({ p, x })))
    // Samma jämförelse som den gamla prototypen, så att ordningen blir densamma.
    .sort((a, b) => (a.x < b.x ? -1 : 1));
  const empName = (id: string) => employers.find((e) => e.id === id)?.name ?? "–";
  const upcoming: UpcomingRow[] = upcomingAll.slice(0, 6).map(({ p, x }) => {
    const c = s.caseOf(p.caseId);
    const ok = canSee(s.access(p.caseId)) && c;
    return { key: `${p.id}:${x}`, date: x, employerId: p.employerId, employerName: empName(p.employerId), who: ok ? `${s.who(p.caseId)} · ${c.caseNumber}` : s.who(p.caseId), rightsDone: rightsDone(p) };
  });
  const rows: EmployerRow[] = employers
    .map((e) => {
      const ps = s.placements.filter((p) => p.employerId === e.id);
      const on = ps.filter((p) => p.status === "ongoing");
      const next = on.flatMap((p) => p.followUpDates).filter((x) => x >= today).sort()[0] ?? null;
      return { id: e.id, name: e.name, orgNr: e.orgNr, contactName: e.contactName, phone: e.phone, areas: areaOptions(s.areas, e.areas), total: ps.length, ongoing: on.length, next };
    })
    .sort((a, b) => b.ongoing - a.ongoing || a.name.localeCompare(b.name, "sv"));
  const tag = await ctx.repo.table("demo_tags").get("nadia");
  return {
    mineOnly,
    employers: rows,
    kpis: { employers: employers.length, ongoing: ongoing.length, total: s.placements.length, upcoming: upcomingAll.length, full: ongoing.filter((p) => rightsDone(p) === 4).length },
    upcoming,
    areas: s.areas.map((a) => ({ code: a.code, name: a.name })),
    demoCaseId: tag?.entity === "cases" ? (tag.entityIds[0] ?? null) : null,
  };
});

handleQuery(praktikEmployer, { roles: WORKERS }, async (ctx, p) => {
  const e = await ctx.repo.table("employers").get(p.employerId);
  if (!e) return { found: false } as const;
  const s = await scopeFor(ctx);
  const name = await userNames(ctx);
  const ps = s.placements.filter((x) => x.employerId === e.id);
  const group = (list: Placement[]): PlacementGroup => {
    const mineList = list.filter((x) => canSee(s.access(x.caseId))).sort((a, b) => rightsDone(a) - rightsDone(b) || (a.startsOn < b.startsOn ? 1 : -1));
    const others = list.filter((x) => !mineList.includes(x)).sort((a, b) => (a.startsOn < b.startsOn ? 1 : -1));
    const mine: PlacementCardView[] = mineList.map((x) => {
      const c = s.caseOf(x.caseId);
      return {
        id: x.id, caseId: x.caseId, caseNumber: c?.caseNumber ?? "", who: s.who(x.caseId), canEdit: canSee(s.access(x.caseId)), referrerId: c?.referrerId ?? null,
        startsOn: x.startsOn, endsOn: x.endsOn, supervisorName: x.supervisorName, tasks: x.tasks, goals: x.goals, status: x.status, fourRights: x.fourRights,
        followUpDates: x.followUpDates, rightsDone: rightsDone(x),
      };
    });
    // Andra team: inga namn, inget ärendenummer och ingen fritext (arbetsuppgifterna skrivs av coachen i ärendet).
    const otherRows: OtherPlacementRow[] = others.map((x) => ({ id: x.id, who: s.who(x.caseId), startsOn: x.startsOn, endsOn: x.endsOn, rightsDone: rightsDone(x) }));
    return { mine, others: otherRows };
  };
  const on = ps.filter((x) => x.status === "ongoing");
  const done = ps.filter((x) => x.status !== "ongoing");
  return {
    found: true,
    employer: {
      id: e.id, name: e.name, orgNr: e.orgNr, contactName: e.contactName, phone: e.phone, email: e.email, areas: areaOptions(s.areas, e.areas),
      createdAt: e.createdAt, createdByName: e.createdAt ? name(e.createdBy) : null,
    },
    ongoing: group(on),
    done: group(done),
    ongoingCount: on.length,
    doneCount: done.length,
    // Alla på Miljonbemanning ser alla ärenden i avtalet (beslut 2026-10-09) – "i dina ärenden" gäller inte längre.
    scopeLabel: "Praktikplatser",
    today: dayOf(ctx.now()),
  };
});

/** Arbetsgivarregistret (SPEC §7.9) – delas av alla coacher. Inga uppgifter om deltagare här. */
handleCommand(praktikEmployerAdd, { roles: WORKERS }, async (ctx, p) => {
  const name = String(p.name || "").trim();
  if (!name) return fail("name", "Skriv företagets namn.");
  const orgNr = String(p.orgNr || "").trim();
  if (orgNr && !/^\d{6}-\d{4}$/.test(orgNr)) return fail("orgNr", "Skriv organisationsnumret med bindestreck, till exempel 556123-4567.");
  const email = String(p.email || "").trim();
  if (email && !emailValid(email)) return fail("email", "E-postadressen ser inte ut att stämma.");
  const existing = await ctx.repo.table("employers").list();
  if (existing.some((e) => e.name.toLowerCase() === name.toLowerCase() || (orgNr && e.orgNr === orgNr))) {
    return fail("duplicate", "Arbetsgivaren finns redan i registret (samma namn eller organisationsnummer).");
  }
  const main = await mainContract(ctx);
  const codes = new Set((await ctx.repo.table("contract_areas").list({ contractId: main.id })).map((a) => a.code));
  const areas = p.areas.filter((a) => codes.has(a));
  if (!areas.length) return fail("areas", "Välj minst ett avtalsområde.");
  const id = ctx.newId("emp");
  await ctx.repo.table("employers").insert({
    id, name, orgNr, contactName: String(p.contactName || "").trim(), phone: String(p.phone || "").trim(), email, areas, createdAt: ctx.now(), createdBy: ctx.actor.userId,
  });
  await ctx.audit({ action: "employer.added", entity: "employer", entityId: id, contractId: main.id, details: { areas } });
  return ok({ employerId: id });
});

/** De fyra rätten på en praktikplats. Bara teamet i ärendet (policyn för placements). */
handleCommand(praktikSetRight, { roles: WORKERS }, async (ctx, p) => {
  const pl = await ctx.repo.table("placements").get(p.placementId);
  if (!pl) return fail("not_found", "Praktikplatsen finns inte.");
  const c = await ctx.repo.table("cases").get(pl.caseId);
  await ctx.repo.table("placements").update(pl.id, { fourRights: { ...pl.fourRights, [p.right]: p.value } });
  await ctx.audit({ action: "placement.four_rights_updated", entity: "placement", entityId: pl.id, contractId: c?.contractId ?? null, details: { caseId: pl.caseId, right: p.right, value: p.value } });
  return ok({});
});

handleCommand(praktikAddFollowUp, { roles: WORKERS }, async (ctx, p) => {
  const pl = await ctx.repo.table("placements").get(p.placementId);
  if (!pl) return fail("not_found", "Praktikplatsen finns inte.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return fail("date", "Välj ett datum.");
  const c = await ctx.repo.table("cases").get(pl.caseId);
  await ctx.repo.table("placements").update(pl.id, { followUpDates: uniq([...pl.followUpDates, p.date]).sort() });
  await ctx.audit({ action: "placement.follow_up_added", entity: "placement", entityId: pl.id, contractId: c?.contractId ?? null, details: { caseId: pl.caseId, date: p.date } });
  return ok({});
});

// ---------------------------------------------------------------- Ny praktik och avslutad praktik (beslut 2026-10-08)
/** Planerar praktik: huvudcoachen, samordnare och avtalsansvarig (canEditCase). */
const PLANNERS: readonly Role[] = ["coach", "samordnare", "avtalsansvarig"];
const CASE_NOT_FOUND = "Ärendet finns inte, eller så har du inte behörighet att se det.";
const NO_EDIT = "Du har inte behörighet att ändra i ärendet.";

handleCommand(placementCreate, { roles: PLANNERS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", CASE_NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  if (c.status !== "active" && c.status !== "paused") return fail("wrong_status", "Praktik planeras när insatsen pågår.");
  const endsOn = p.endsOn ?? null;
  if (endsOn && endsOn < p.startsOn) return fail("period", "Slutdagen måste komma efter startdagen.");
  // Praktikdagarna planeras till slutdagen, annars till insatsens planerade slut.
  const until = endsOn ?? c.endDate ?? c.plannedEnd ?? p.startsOn;
  if (until < p.startsOn) return fail("period", "Startdagen ligger efter insatsens planerade slut.");

  // Arbetsgivaren: befintlig i registret eller en ny. Registret delas – inga uppgifter om deltagaren sparas där.
  let employer = p.employerId ? await ctx.repo.table("employers").get(p.employerId) : null;
  if (!employer) {
    const name = (p.newEmployer?.name ?? "").trim();
    if (!name) return fail("employer", "Välj en arbetsgivare i registret eller skriv namnet på en ny.");
    const email = (p.newEmployer?.email ?? "").trim();
    if (email && !emailValid(email)) return fail("email", "E-postadressen ser inte ut att stämma.");
    const existing = (await ctx.repo.table("employers").list()).find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (existing) employer = existing;
    else {
      const id = ctx.newId("emp");
      employer = await ctx.repo.table("employers").insert({
        id, name, orgNr: "", contactName: (p.newEmployer?.contactName ?? "").trim(), phone: (p.newEmployer?.phone ?? "").trim(), email,
        areas: c.primaryAreaCode ? [c.primaryAreaCode] : [], createdAt: ctx.now(), createdBy: ctx.actor.userId,
      });
      await ctx.audit({ action: "employer.added", entity: "employer", entityId: id, contractId: c.contractId, details: { areas: employer.areas, viaPlacement: true } });
    }
  }
  const city = (p.newEmployer?.city ?? "").trim();
  const location = city ? `${employer.name}, ${city}` : employer.name;
  const now = ctx.now();
  const today = dayOf(now);

  // Praktikdagarna som tillfällen: yrkesmoment utan närvaro samma dagar ersätts (bara kommande), dagar som redan har en
  // praktikdag hoppas över. Registrerad närvaro rörs aldrig.
  const days = placementDays(p.startsOn, until, uniq(p.weekdays), c.pausedWeeks);
  const acts = ctx.repo.table("activities");
  const existingActs = await acts.list({ caseId: c.id });
  const registered = new Set((await ctx.repo.table("attendance").list({ caseId: c.id })).map((a) => a.activityId));
  const daySet = new Set(days);
  let replaced = 0;
  for (const a of existingActs) {
    if (a.kind === "yrkesmoment" && daySet.has(dayOf(a.startsAt)) && !registered.has(a.id) && a.startsAt >= now) {
      await acts.remove(a.id);
      replaced++;
    }
  }
  const hasPractice = new Set(existingActs.filter((a) => a.kind === "praktikdag").map((a) => dayOf(a.startsAt)));
  let created = 0;
  for (const day of days) {
    if (hasPractice.has(day)) continue;
    await acts.insert({ id: ctx.newId("a"), caseId: c.id, kind: "praktikdag", startsAt: `${day}T${p.time}`, durationMin: p.durationMin, location, note: "" });
    created++;
  }

  const tasks = (p.tasks ?? "").trim();
  const supervisorName = (p.supervisorName ?? "").trim() || employer.contactName;
  const placementId = ctx.newId("pl");
  await ctx.repo.table("placements").insert({
    id: placementId, caseId: c.id, employerId: employer.id, startsOn: p.startsOn, endsOn, tasks, supervisorName, goals: "", followUpDates: [],
    status: p.startsOn <= today ? "ongoing" : "planned",
    // Rätt tidpunkt: coachen har bedömt att deltagaren är redo genom att planera praktiken. Uppföljningen planeras efteråt.
    fourRights: { uppgift: !!tasks, handledning: !!supervisorName, timing: true, uppfoljning: false },
  });
  // Händelsen som testdatat skapar – verifieringen är tom tills coachen laddar upp praktikavtalet.
  const eventId = ctx.newId("oe");
  await ctx.repo.table("outcome_events").insert({
    id: eventId, caseId: c.id, kind: "praktik_startad", occurredOn: p.startsOn, actor: employer.name, verificationKind: null, verificationPath: null, note: "", possibleBonus: false,
  });
  await ctx.audit({
    action: "placement.created", entity: "placement", entityId: placementId, contractId: c.contractId,
    details: { caseId: c.id, employerId: employer.id, startsOn: p.startsOn, endsOn, days: created, replaced },
  });
  await ctx.audit({ action: "event.added", entity: "outcome_event", entityId: eventId, contractId: c.contractId, details: { caseId: c.id, kind: "praktik_startad" } });
  return ok({ placementId, employerId: employer.id, days: created });
});

handleCommand(placementEnd, { roles: PLANNERS }, async (ctx, p) => {
  const pl = await ctx.repo.table("placements").get(p.placementId);
  if (!pl) return fail("not_found", "Praktikplatsen finns inte.");
  const c = await ctx.repo.table("cases").get(pl.caseId);
  if (!c) return fail("not_found", CASE_NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  if (pl.status === "completed") return fail("wrong_status", "Praktiken är redan avslutad.");
  if (p.endsOn < pl.startsOn) return fail("date", "Slutdagen kan inte vara före startdagen.");
  // Praktikdagar efter slutdagen utan registrerad närvaro tas bort.
  const acts = ctx.repo.table("activities");
  const registered = new Set((await ctx.repo.table("attendance").list({ caseId: c.id })).map((a) => a.activityId));
  const after = (await acts.list({ caseId: c.id, kind: "praktikdag" })).filter((a) => dayOf(a.startsAt) > p.endsOn && !registered.has(a.id));
  for (const a of after) await acts.remove(a.id);
  await ctx.repo.table("placements").update(pl.id, { endsOn: p.endsOn, status: "completed" });
  await ctx.audit({ action: "placement.ended", entity: "placement", entityId: pl.id, contractId: c.contractId, details: { caseId: c.id, endsOn: p.endsOn, removed: after.length } });
  return ok({ removed: after.length });
});
