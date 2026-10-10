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
  GROUPING_MEMBER_WRITERS, GROUPING_WRITERS, groupingFilterOptions, groupingIdsByCase, planCaseGroupings, sameName, slotOf,
} from "@/core/groupings";
import { dayOf, fmtDate } from "@/core/time";
import { looksLikePnr } from "@/core/validation";
import { UniqueError } from "@/data/repo";
import type { Case, Contract, Grouping, GroupingMember } from "@/data/schema";
import { sha256Hex } from "../rost/sha256";
import { accessSourceFor } from "../rapporter/load";
import {
  caseGroupingsSave, caseGroupingsView, groupingArchive, groupingCatalog, groupingCreate, groupingDefaults, groupingFilterData, groupingRename, MASS_NOTE_ROLES, massNotePage,
  massNoteSave, type GroupingCatalog, type GroupingFilterData, type GroupingOption, type MassNoteRow, type TagCategory,
} from "./api";

// ---------------------------------------------------------------- Hjälpare
/**
 * Avtalen aktören arbetar i: aktiva avtal där hen är medlem (utan medlemskap, t.ex. systemadministratören: alla aktiva).
 * Fast ordning (id) – samma svar i båda körlägena, oavsett i vilken ordning databasen lämnar raderna.
 */
async function actorContracts(ctx: Ctx): Promise<Contract[]> {
  const all = (await ctx.repo.table("contracts").list()).filter((c) => c.status === "active" && isOperational(c.config)).sort((a, b) => a.id.localeCompare(b.id));
  const mine = all.filter((c) => ctx.actor.contractIds.includes(c.id));
  return mine.length ? mine : all;
}
/** Det valda avtalet (bara bland aktörens), eller det första när inget är valt. Null: avtalet finns inte för aktören. */
async function contractFor(ctx: Ctx, contractId: string | undefined): Promise<Contract | null> {
  const cs = await actorContracts(ctx);
  return contractId ? (cs.find((c) => c.id === contractId) ?? null) : (cs[0] ?? null);
}
/** Avtalen att välja mellan i skärmarna (visas bara när aktören har fler än ett). */
const contractChoices = (cs: readonly Contract[]) => cs.map((c) => ({ id: c.id, name: `${c.name} (${c.casePrefix})` }));

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

/** Pågående ärenden: de som visas i Anteckningar och räknas i katalogens antal. */
const OPEN_STATUSES: readonly Case["status"][] = ["confirmed", "active", "paused"];

/** Antal aktiva medlemskap per gruppering – bara i pågående ärenden (openCaseIds), som raderna i Anteckningar. */
function countByGrouping(members: readonly GroupingMember[], openCaseIds: ReadonlySet<string>): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of activeMembers(members)) if (openCaseIds.has(x.caseId)) m.set(x.groupingId, (m.get(x.groupingId) ?? 0) + 1);
  return m;
}

async function buildCatalog(ctx: Ctx, contract: Contract, contracts: readonly Contract[], withArchived: boolean): Promise<GroupingCatalog> {
  const [gs, ms, open] = await Promise.all([
    ctx.repo.table("groupings").list({ contractId: contract.id }),
    ctx.repo.table("grouping_members").list({ contractId: contract.id, removedAt: { isNull: true } }),
    ctx.repo.table("cases").pick(["status"], { contractId: contract.id, status: { in: OPEN_STATUSES } }),
  ]);
  return {
    contractId: contract.id,
    contracts: contractChoices(contracts),
    canEdit: GROUPING_WRITERS.includes(ctx.actor.role),
    ...catalogOf(gs, countByGrouping(ms, new Set(open.map((c) => c.id))), (g) => withArchived || g.archivedAt == null),
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
  const contracts = await actorContracts(ctx);
  const contract = p.contractId ? contracts.find((c) => c.id === p.contractId) : contracts[0];
  return contract ? buildCatalog(ctx, contract, contracts, !!p.arkiverade) : null;
});

// ---------------------------------------------------------------- grupper.ny / andra / arkivera / standard
handleCommand(groupingCreate, { roles: GROUPING_WRITERS }, async (ctx, p) => {
  // I ett ärende (kortet Nivå och grupp): ärendets avtal – efter kontrollen att aktören arbetar i ärendet och avtalet.
  let contract: Contract | null;
  if (p.caseId) {
    const L = await caseWithAccess(ctx, p.caseId);
    if (!L || (L.access !== "full" && L.access !== "team")) return fail("not_found", "Ärendet finns inte, eller så har du inte behörighet att se det.");
    contract = await contractFor(ctx, L.c.contractId);
  } else contract = await contractFor(ctx, p.contractId);
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

handleCommand(groupingDefaults, { roles: GROUPING_WRITERS }, async (ctx, p) => {
  const contract = await contractFor(ctx, p.contractId);
  if (!contract) return fail("no_contract", "Det finns inget aktivt avtal att lägga till i.");
  const table = ctx.repo.table("groupings");
  const have = new Set((await table.list({ contractId: contract.id })).map((g) => g.id));
  // Samma id som migrationen 0031 – finns standardvärdena redan läggs inget till.
  const add = defaultGroupings(contract.id, ctx.now()).filter((g) => !have.has(g.id)).map((g) => ({ ...g, createdBy: ctx.actor.userId }));
  for (const g of add) await table.insert(g);
  if (add.length) await ctx.audit({ action: "grouping.defaults_added", entity: "contract", entityId: contract.id, contractId: contract.id, details: { count: add.length } });
  return ok({ added: add.length });
});

// ---------------------------------------------------------------- grupper.filter
handleQuery(groupingFilterData, { roles: GROUPING_READERS }, async (ctx): Promise<GroupingFilterData | null> => {
  // Alla aktörens avtal (listorna visar ärenden i alla) – varje ärende filtreras på sitt eget avtals grupperingar.
  const contracts = await actorContracts(ctx);
  if (!contracts.length) return null;
  const ids = contracts.map((c) => c.id);
  const [gs, ms] = await Promise.all([
    ctx.repo.table("groupings").list({ contractId: { in: ids }, archivedAt: { isNull: true } }),
    ctx.repo.table("grouping_members").list({ contractId: { in: ids }, removedAt: { isNull: true } }),
  ]);
  const byCase: Record<string, string[]> = {};
  for (const [caseId, gids] of groupingIdsByCase(ms)) byCase[caseId] = [...gids];
  return { ...groupingFilterOptions(gs, contracts), byCase };
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
    canEdit: GROUPING_MEMBER_WRITERS.includes(ctx.actor.role) && access === "full",
    current: caseGroupings(c.id, ms, gs),
    options: catalogOf(gs, new Map(), (g) => g.archivedAt == null || mine.has(g.id)),
  };
});

// ---------------------------------------------------------------- grupper.arendeSpara
handleCommand(caseGroupingsSave, { roles: GROUPING_MEMBER_WRITERS }, async (ctx, p) => {
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
  const member = (g: Pick<Grouping, "id" | "kind" | "category">): GroupingMember => ({
    id: ctx.newId("gm"), contractId: c.contractId, caseId: c.id, groupingId: g.id, kind: g.kind, slot: slotOf(g), addedAt: now, addedBy: me, removedAt: null, removedBy: null,
  });
  // Det som hunnit ändras – tas tillbaka om ett senare steg misslyckas (allt eller inget).
  const removed: GroupingMember[] = [];
  const added: GroupingMember[] = [];
  try {
    // Borttagningar först: en ny nivå eller tagg krockar aldrig med den gamla i det unika indexet.
    for (const m of plan.plan.remove) {
      await table.update(m.id, { removedAt: now, removedBy: me });
      removed.push(m);
      await log("grouping_member.removed", m);
    }
    for (const g of plan.plan.add) {
      const m = member(g);
      await table.insert(m);
      added.push(m);
      await log("grouping_member.added", m);
    }
  } catch (e) {
    // Ett steg misslyckades (nätverk, databasen eller någon annan som samtidigt satte en nivå eller tagg i samma kategori):
    // ta tillbaka det som hann ändras, så att ärendet inte står utan nivå. Varje steg för sig – bästa försök. Ett medlemskap
    // som tagits bort återställs som en ny rad (inget raderas, och borttagna rader ändras aldrig tillbaka).
    for (const m of added) {
      await table.update(m.id, { removedAt: now, removedBy: me }).then(() => log("grouping_member.removed", m)).catch(() => undefined);
    }
    for (const m of removed) {
      const g = gs.find((x) => x.id === m.groupingId);
      if (!g) continue;
      const back = member(g);
      await table.insert(back).then(() => log("grouping_member.added", back)).catch(() => undefined);
    }
    // Någon annan satte samtidigt en nivå eller tagg i samma kategori (databasens unika index, UNIQUE_KEYS i minnet).
    if (e instanceof UniqueError) return fail("conflict", "Någon annan ändrade samtidigt. Ladda om sidan och försök igen.");
    throw e;
  }
  return ok({ added: plan.plan.add.length, removed: plan.plan.remove.length, savedAt: now });
});

// ---------------------------------------------------------------- grupper.anteckningar (massanteckningar)
handleQuery(massNotePage, { roles: MASS_NOTE_ROLES }, async (ctx, p) => {
  const now = ctx.now();
  const today = dayOf(now);
  // Ett avtal i taget (varje avtal har sina egna nivåer, grupper och taggar) – det valda, annars det första.
  const contracts = await actorContracts(ctx);
  const contract = (p.contractId ? contracts.find((c) => c.id === p.contractId) : contracts[0]) ?? null;
  if (!contract) return { today, catalog: null, rows: [] };
  const catalog = await buildCatalog(ctx, contract, contracts, false);
  const cases = await ctx.repo.table("cases").list({ contractId: contract.id, status: { in: OPEN_STATUSES } });
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
    ctx.repo.table("groupings").list({ contractId: contract.id, kind: "level" }),
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
/**
 * Anteckningens id i en massanteckning: härlett ur aktören, skärmens sparnyckel och ärendet. Ett nytt försök med samma
 * nyckel (efter ett avbrott mitt i sparningen) ger samma id – det som redan sparats sparas inte igen.
 */
const massNoteId = (userId: string, saveKey: string, caseId: string): string => `note-mn-${sha256Hex(`${userId}|${saveKey}|${caseId}`).slice(0, 32)}`;

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
  // Idempotent: varje rad har ett id ur sparnyckeln. Avbryts sparningen halvvägs (nätverk, timeout) och skärmen försöker
  // igen med samma nyckel sparas bara det som saknas – aldrig dubbletter. Har texten (typen, datumet) ändrats sedan dess
  // ändras den egna anteckningen, så att det som står på skärmen är det som är sparat.
  const table = ctx.repo.table("case_notes");
  const me = ctx.actor.userId;
  for (const x of ok_) {
    const id = massNoteId(me, p.saveKey, x.c.id);
    const via = { caseId: x.c.id, via: "massanteckningar" };
    const cur = await table.get(id);
    if (cur) {
      if (!cur.removedAt && cur.authorId === me && (cur.body !== x.body || cur.occurredOn !== x.occurredOn || cur.kind !== p.kind || cur.audience !== x.audience)) {
        await table.update(id, { occurredOn: x.occurredOn, kind: p.kind, audience: x.audience, body: x.body, updatedAt: ctx.now() });
        await ctx.audit({ action: "case_note.updated", entity: "case_note", entityId: id, contractId: x.c.contractId, details: via });
      }
      continue;
    }
    try {
      await table.insert({
        id, contractId: x.c.contractId, caseId: x.c.id, authorId: me, occurredOn: x.occurredOn, kind: p.kind, audience: x.audience, body: x.body, createdAt: ctx.now(),
        updatedAt: null, removedAt: null, removedBy: null,
      });
    } catch (e) {
      // Samma id finns redan (två samtidiga försök med samma nyckel): raden är sparad.
      if (e instanceof UniqueError) continue;
      throw e;
    }
    // Samma loggrad som en vanlig anteckning (bara id:n) – via säger att den skrevs i massanteckningarna.
    await ctx.audit({ action: "case_note.created", entity: "case_note", entityId: id, contractId: x.c.contractId, details: via });
  }
  return ok({ saved: ok_.length });
});
