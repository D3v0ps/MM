// Hanterare för området grupper: nivåer, grupper och taggar och massanteckningar (coachmötet 2026-10-09).
// Allt läses och skrivs via ctx.repo – policyn (minnet) och RLS (0031) avgör vad rollen ser och får ändra; hanterarna ger
// begripliga fel innan. ctx.system bara för behörighetsuppslaget (accessSourceFor: flaggor och id:n).
// Revisionsloggen får bara id:n och typ – aldrig namnen på grupperna eller anteckningarnas text.
// Inget här skickas till AI, till kommunen, till rapporter eller exporter (Karims beslut 3).
import { fail, ok } from "@/api/contract";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { caseAccessIn, displayName, type AccessSource, type CaseAccess } from "@/core/access";
import { isOperational } from "@/core/config";
import {
  activeMembers, byOrder, CASE_GROUPING_ERROR_TEXT, caseGroupings, defaultGroupings, groupingCategoryError, groupingDescriptionError, groupingNameError, GROUPING_READERS,
  GROUPING_WRITERS, planCaseGroupings, sameName, slotOf,
} from "@/core/groupings";
import { dayOf, fmtDate } from "@/core/time";
import { looksLikePnr } from "@/core/validation";
import { UniqueError } from "@/data/repo";
import type { Case, Contract, Grouping, GroupingMember } from "@/data/schema";
import { accessSourceFor } from "../rapporter/load";
import {
  caseGroupingsSave, caseGroupingsView, groupingArchive, groupingCatalog, groupingCreate, groupingDefaults, groupingRename, MASS_NOTE_ROLES, massNotePage, massNoteSave,
  type GroupingCatalog, type GroupingOption, type MassNoteRow, type TagCategory,
} from "./api";

// ---------------------------------------------------------------- Hjälpare
/** Avtalet som aktören arbetar i: ett aktivt avtal där hen är medlem (admin: första aktiva). */
async function mainContract(ctx: Ctx): Promise<Contract | null> {
  const contracts = (await ctx.repo.table("contracts").list()).filter((c) => c.status === "active" && isOperational(c.config));
  return contracts.find((c) => ctx.actor.contractIds.includes(c.id)) ?? contracts[0] ?? null;
}

const option = (g: Grouping, counts: Map<string, number>): GroupingOption => ({
  id: g.id, name: g.name, description: g.description, archived: g.archivedAt != null, members: counts.get(g.id) ?? 0,
});

/** Nivåer, grupper och taggar (per kategori) i ordning. keep: arkiverade som ska följa med (t.ex. de ärendet har). */
function catalogOf(groupings: readonly Grouping[], counts: Map<string, number>, keep: (g: Grouping) => boolean) {
  const shown = groupings.filter(keep).slice().sort(byOrder);
  const tags = new Map<string, Grouping[]>();
  for (const g of shown.filter((x) => x.kind === "tag")) tags.set(g.category ?? "", [...(tags.get(g.category ?? "") ?? []), g]);
  return {
    levels: shown.filter((g) => g.kind === "level").map((g) => option(g, counts)),
    groups: shown.filter((g) => g.kind === "group").map((g) => option(g, counts)),
    tags: [...tags.entries()].sort(([a], [b]) => a.localeCompare(b, "sv")).map(([category, values]): TagCategory => ({ category, values: values.map((g) => option(g, counts)) })),
  };
}

function countByGrouping(members: readonly GroupingMember[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of activeMembers(members)) m.set(x.groupingId, (m.get(x.groupingId) ?? 0) + 1);
  return m;
}

async function buildCatalog(ctx: Ctx, contract: Contract, withArchived: boolean): Promise<GroupingCatalog> {
  const [gs, ms] = await Promise.all([
    ctx.repo.table("groupings").list({ contractId: contract.id }),
    ctx.repo.table("grouping_members").list({ contractId: contract.id, removedAt: { isNull: true } }),
  ]);
  return {
    contractId: contract.id,
    canEdit: GROUPING_WRITERS.includes(ctx.actor.role),
    ...catalogOf(gs, countByGrouping(ms), (g) => withArchived || g.archivedAt == null),
    missingDefaults: !gs.some((g) => g.kind === "level"),
  };
}

/** Ärendet och aktörens åtkomst (via ctx.repo – null om rollen inte ser ärendet). */
async function caseWithAccess(ctx: Ctx, caseId: string): Promise<{ c: Case; access: CaseAccess; src: AccessSource } | null> {
  const c = await ctx.repo.table("cases").get(caseId);
  if (!c) return null;
  const src = await accessSourceFor(ctx, [c]);
  return { c, access: caseAccessIn(c, ctx.actor, src), src };
}

// ---------------------------------------------------------------- grupper.katalog
handleQuery(groupingCatalog, { roles: GROUPING_READERS }, async (ctx, p): Promise<GroupingCatalog | null> => {
  const contract = await mainContract(ctx);
  return contract ? buildCatalog(ctx, contract, !!p.arkiverade) : null;
});

// ---------------------------------------------------------------- grupper.ny / andra / arkivera / standard
handleCommand(groupingCreate, { roles: GROUPING_WRITERS }, async (ctx, p) => {
  const contract = await mainContract(ctx);
  if (!contract) return fail("no_contract", "Det finns inget aktivt avtal att lägga till i.");
  const category = p.kind === "tag" ? (p.category ?? "").trim() : null;
  const err = groupingNameError(p.name) ?? groupingDescriptionError(p.description ?? "") ?? (p.kind === "tag" ? groupingCategoryError(category ?? "") : null);
  if (err) return fail("invalid", err);
  const table = ctx.repo.table("groupings");
  const same = (await table.list({ contractId: contract.id, kind: p.kind })).filter((g) => (g.category ?? null) === category);
  if (same.some((g) => g.archivedAt == null && sameName(g.name, p.name))) {
    return fail("duplicate", p.kind === "tag" ? "Det finns redan en tagg med det namnet i kategorin." : "Det finns redan en grupp med det namnet.");
  }
  const id = ctx.newId("grp");
  await table.insert({
    id, contractId: contract.id, kind: p.kind, category, name: p.name.trim(), description: (p.description ?? "").trim(),
    sortOrder: Math.max(0, ...same.map((g) => g.sortOrder)) + 1, createdAt: ctx.now(), createdBy: ctx.actor.userId,
    updatedAt: null, updatedBy: null, archivedAt: null, archivedBy: null,
  });
  // Bara id och typ – aldrig namnet.
  await ctx.audit({ action: "grouping.created", entity: "grouping", entityId: id, contractId: contract.id, details: { kind: p.kind } });
  return ok({ id });
});

handleCommand(groupingRename, { roles: GROUPING_WRITERS }, async (ctx, p) => {
  const table = ctx.repo.table("groupings");
  const g = await table.get(p.id);
  if (!g) return fail("not_found", "Nivån, gruppen eller taggen finns inte längre.");
  const err = groupingNameError(p.name) ?? groupingDescriptionError(p.description);
  if (err) return fail("invalid", err);
  const name = p.name.trim();
  const description = p.description.trim();
  if (name === g.name && description === g.description) return ok({});
  const others = (await table.list({ contractId: g.contractId, kind: g.kind })).filter((x) => x.id !== g.id && x.archivedAt == null && (x.category ?? null) === (g.category ?? null));
  if (others.some((x) => sameName(x.name, name))) return fail("duplicate", "Det namnet används redan.");
  await table.update(g.id, { name, description, updatedAt: ctx.now(), updatedBy: ctx.actor.userId });
  await ctx.audit({ action: "grouping.updated", entity: "grouping", entityId: g.id, contractId: g.contractId, details: { kind: g.kind } });
  return ok({});
});

handleCommand(groupingArchive, { roles: GROUPING_WRITERS }, async (ctx, p) => {
  const table = ctx.repo.table("groupings");
  const g = await table.get(p.id);
  if (!g) return fail("not_found", "Nivån, gruppen eller taggen finns inte längre.");
  // De fem nivåerna arkiveras inte – de byter namn (Karims beslut 3: fem nivåer).
  if (g.kind === "level") return fail("level", "Nivåerna kan inte arkiveras. Byt namn i stället.");
  if ((g.archivedAt != null) === p.archived) return ok({});
  if (!p.archived) {
    const others = (await table.list({ contractId: g.contractId, kind: g.kind })).filter((x) => x.id !== g.id && x.archivedAt == null && (x.category ?? null) === (g.category ?? null));
    if (others.some((x) => sameName(x.name, g.name))) return fail("duplicate", "Det finns redan en aktiv med samma namn. Byt namn på den först.");
  }
  await table.update(g.id, p.archived ? { archivedAt: ctx.now(), archivedBy: ctx.actor.userId } : { archivedAt: null, archivedBy: null });
  await ctx.audit({ action: p.archived ? "grouping.archived" : "grouping.restored", entity: "grouping", entityId: g.id, contractId: g.contractId, details: { kind: g.kind } });
  return ok({});
});

handleCommand(groupingDefaults, { roles: GROUPING_WRITERS }, async (ctx) => {
  const contract = await mainContract(ctx);
  if (!contract) return fail("no_contract", "Det finns inget aktivt avtal att lägga till i.");
  const table = ctx.repo.table("groupings");
  const have = new Set((await table.list({ contractId: contract.id })).map((g) => g.id));
  // Samma id som migrationen 0031 – finns standardvärdena redan läggs inget till.
  const add = defaultGroupings(contract.id, ctx.now()).filter((g) => !have.has(g.id)).map((g) => ({ ...g, createdBy: ctx.actor.userId }));
  for (const g of add) await table.insert(g);
  if (add.length) await ctx.audit({ action: "grouping.defaults_added", entity: "contract", entityId: contract.id, contractId: contract.id, details: { count: add.length } });
  return ok({ added: add.length });
});

// ---------------------------------------------------------------- grupper.arende
handleQuery(caseGroupingsView, { roles: GROUPING_READERS }, async (ctx, p) => {
  const L = await caseWithAccess(ctx, p.caseId);
  if (!L || (L.access !== "full" && L.access !== "team")) return null;
  const { c, access } = L;
  const [gs, ms] = await Promise.all([
    ctx.repo.table("groupings").list({ contractId: c.contractId }),
    ctx.repo.table("grouping_members").list({ caseId: c.id, removedAt: { isNull: true } }),
  ]);
  const mine = new Set(ms.map((m) => m.groupingId));
  return {
    caseId: c.id,
    today: dayOf(ctx.now()),
    canEdit: GROUPING_WRITERS.includes(ctx.actor.role) && access === "full",
    current: caseGroupings(c.id, ms, gs),
    options: catalogOf(gs, new Map(), (g) => g.archivedAt == null || mine.has(g.id)),
  };
});

// ---------------------------------------------------------------- grupper.arendeSpara
handleCommand(caseGroupingsSave, { roles: GROUPING_WRITERS }, async (ctx, p) => {
  const L = await caseWithAccess(ctx, p.caseId);
  if (!L || L.access === "none" || L.access === "restricted") return fail("not_found", "Ärendet finns inte, eller så har du inte behörighet att se det.");
  if (L.access !== "full") return fail("forbidden", "Du kan inte ändra nivå, grupper eller taggar i det här ärendet.");
  const { c } = L;
  const [gs, current] = await Promise.all([
    ctx.repo.table("groupings").list({ contractId: c.contractId }),
    ctx.repo.table("grouping_members").list({ caseId: c.id, removedAt: { isNull: true } }),
  ]);
  const plan = planCaseGroupings(current, { levelId: p.levelId, groupIds: p.groupIds, tags: p.tags }, gs);
  if (!plan.ok) return fail(plan.error, CASE_GROUPING_ERROR_TEXT[plan.error]);
  const table = ctx.repo.table("grouping_members");
  const now = ctx.now();
  const me = ctx.actor.userId;
  const log = (action: string, m: Pick<GroupingMember, "id" | "groupingId" | "kind">) =>
    ctx.audit({ action, entity: "grouping_member", entityId: m.id, contractId: c.contractId, details: { caseId: c.id, groupingId: m.groupingId, kind: m.kind } });
  try {
    // Borttagningar först: en ny nivå eller tagg krockar aldrig med den gamla i det unika indexet.
    for (const m of plan.plan.remove) {
      await table.update(m.id, { removedAt: now, removedBy: me });
      await log("grouping_member.removed", m);
    }
    for (const g of plan.plan.add) {
      const m: GroupingMember = {
        id: ctx.newId("gm"), contractId: c.contractId, caseId: c.id, groupingId: g.id, kind: g.kind, slot: slotOf(g), addedAt: now, addedBy: me, removedAt: null, removedBy: null,
      };
      await table.insert(m);
      await log("grouping_member.added", m);
    }
  } catch (e) {
    // Någon annan satte samtidigt en nivå eller tagg i samma kategori (databasens unika index, UNIQUE_KEYS i minnet).
    if (e instanceof UniqueError) return fail("conflict", "Någon annan ändrade samtidigt. Ladda om sidan och försök igen.");
    throw e;
  }
  return ok({ added: plan.plan.add.length, removed: plan.plan.remove.length, savedAt: now });
});

// ---------------------------------------------------------------- grupper.anteckningar (massanteckningar)
const OPEN_STATUSES: readonly Case["status"][] = ["confirmed", "active", "paused"];

handleQuery(massNotePage, { roles: MASS_NOTE_ROLES }, async (ctx, p) => {
  const now = ctx.now();
  const today = dayOf(now);
  const contract = await mainContract(ctx);
  const catalog = contract ? await buildCatalog(ctx, contract, false) : null;
  const cases = (await ctx.repo.table("cases").list({ status: { in: OPEN_STATUSES } })).filter((c) => !contract || c.contractId === contract.id);
  let chosen: Case[];
  if (p.urval === "mina") {
    const team = new Set((await ctx.repo.table("case_team").list({ userId: ctx.actor.userId })).map((t) => t.caseId));
    chosen = cases.filter((c) => c.leadCoachId === ctx.actor.userId || team.has(c.id));
  } else {
    if (!p.id) return { today, catalog, rows: [] };
    const ms = await ctx.repo.table("grouping_members").list({ groupingId: p.id, removedAt: { isNull: true } });
    const ids = new Set(ms.map((m) => m.caseId));
    chosen = cases.filter((c) => ids.has(c.id));
  }
  const src = await accessSourceFor(ctx, chosen);
  const [persons, levels, gs] = await Promise.all([
    chosen.length ? ctx.repo.table("persons").list({ id: { in: [...new Set(chosen.map((c) => c.personId))] } }) : [],
    chosen.length ? ctx.repo.table("grouping_members").list({ caseId: { in: chosen.map((c) => c.id) }, kind: "level", removedAt: { isNull: true } }) : [],
    contract ? ctx.repo.table("groupings").list({ contractId: contract.id, kind: "level" }) : [],
  ]);
  const personById = new Map(persons.map((x) => [x.id, x]));
  const levelName = new Map(gs.map((g) => [g.id, g.name]));
  const levelOf = new Map(levels.map((m) => [m.caseId, levelName.get(m.groupingId) ?? null]));
  const rows: MassNoteRow[] = chosen
    .map((c) => ({ c, access: caseAccessIn(c, ctx.actor, src) }))
    // Bara ärenden där rollen får skriva anteckningar (full eller team) – vilande spärr: skyddade visas inte.
    .filter((x) => x.access === "full" || x.access === "team")
    .map(({ c, access }) => ({
      caseId: c.id, caseNumber: c.caseNumber, name: displayName(c, personById.get(c.personId), access), status: c.status, levelName: levelOf.get(c.id) ?? null,
      minDate: dayOf(c.referredAt),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "sv") || a.caseNumber.localeCompare(b.caseNumber));
  return { today, catalog, rows };
});

// ---------------------------------------------------------------- grupper.anteckningarSpara
handleCommand(massNoteSave, { roles: MASS_NOTE_ROLES }, async (ctx, p) => {
  const today = dayOf(ctx.now());
  const errors: Record<string, string> = {};
  const ok_: { c: Case; occurredOn: string; body: string; audience: "full" | "team" }[] = [];
  const seen = new Set<string>();
  for (const r of p.rows) {
    if (seen.has(r.caseId)) {
      errors[r.caseId] = "Deltagaren finns två gånger. Skriv en anteckning per deltagare.";
      continue;
    }
    seen.add(r.caseId);
    const L = await caseWithAccess(ctx, r.caseId);
    if (!L || (L.access !== "full" && L.access !== "team")) {
      errors[r.caseId] = "Ärendet finns inte, eller så har du inte behörighet att skriva i det.";
      continue;
    }
    if (looksLikePnr(r.body)) {
      errors[r.caseId] = "Det ser ut som ett personnummer i texten. Ta bort det – ärendenumret räcker.";
      continue;
    }
    if (r.occurredOn > today) {
      errors[r.caseId] = "Datumet kan inte vara senare än i dag.";
      continue;
    }
    if (r.occurredOn < dayOf(L.c.referredAt)) {
      errors[r.caseId] = `Datumet kan inte vara före beställningen (${fmtDate(L.c.referredAt)}).`;
      continue;
    }
    // Teamet skriver för hela teamet; skyddade personuppgifter (vilande): alltid bara full åtkomst.
    const protectedPerson = !!L.src.person(L.c.personId)?.protectedIdentity;
    ok_.push({ c: L.c, occurredOn: r.occurredOn, body: r.body, audience: L.access === "team" && !protectedPerson ? "team" : "full" });
  }
  const bad = Object.keys(errors).length;
  if (bad) return fail("rows", bad === 1 ? "En rad behöver rättas. Inget är sparat." : `${bad} rader behöver rättas. Inget är sparat.`, errors);
  const table = ctx.repo.table("case_notes");
  for (const x of ok_) {
    const id = ctx.newId("note");
    await table.insert({
      id, contractId: x.c.contractId, caseId: x.c.id, authorId: ctx.actor.userId, occurredOn: x.occurredOn, kind: p.kind, audience: x.audience, body: x.body, createdAt: ctx.now(),
      updatedAt: null, removedAt: null, removedBy: null,
    });
    // Samma loggrad som en vanlig anteckning (bara id:n) – via säger att den skrevs i massanteckningarna.
    await ctx.audit({ action: "case_note.created", entity: "case_note", entityId: id, contractId: x.c.contractId, details: { caseId: x.c.id, via: "massanteckningar" } });
  }
  return ok({ saved: ok_.length });
});
