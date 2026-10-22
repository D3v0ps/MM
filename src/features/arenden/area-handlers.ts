// Hanterare: Byt yrkesområde på deltagarkortet (Karims beslut 2026-10-22). Registreras via ./handlers.ts.
//   Vem:        coach, samordnare och avtalsansvarig med full åtkomst (personen läses via behörigheten – vid skyddade
//               personuppgifter, vilande spärr, bara namngiven huvudcoach och avtalsansvarig). Chef och systemadministratör ser
//               bytena i läsläge. Kommunen och ekonomen nekas av rollkontrollen (ekonomen ser bytena i Ekonomi).
//   Regler:     areaChangeProblem i src/core/area-changes.ts (bekräftat, pågående eller pausat ärende, ett annat aktivt yrkesområde
//               i avtalet, motivering 10–300 tecken utan personnummer).
//   Skrivning:  i ordning via ctx.repo (RLS): anteckningen med motiveringen (case_notes), bytet (case_area_changes), ärendets
//               yrkesområde (cases), revisionsloggen och sist afterCaseAreaChanged (grupp och inbjudningar).
//   Logg:       case.area_changed med id:n och koder – aldrig motiveringen (CLAUDE.md punkt 2).
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand, handleQuery } from "@/api/server";
import { AREA_CHANGE_STATUSES, AREA_CHANGERS, areaChangeProblem, effectiveMonthOf } from "@/core/area-changes";
import { areaName, personName } from "@/core/labels";
import { dayOf } from "@/core/time";
import type { CaseAreaChange, CaseNote } from "@/data/schema";
import { afterCaseAreaChanged } from "../_shared/case-area-hooks";
import { caseAreaView, caseChangeArea, type CaseAreaView } from "./api";

const NOT_FOUND = "Ärendet finns inte, eller så har du inte behörighet att se det.";
/** Läser yrkesområdet och bytena på kortet: Miljonbemanning som öppnar deltagarkortet. */
const AREA_VIEWERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin"];

handleQuery(caseAreaView, { roles: AREA_VIEWERS }, async (ctx, p): Promise<CaseAreaView | null> => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return null;
  // Full åtkomst = personen är läsbar via behörigheten (samma som kortets huvud).
  const person = await ctx.repo.table("persons").get(c.personId);
  if (!person) return null;
  const [areas, changes] = await Promise.all([
    ctx.repo.table("contract_areas").list({ contractId: c.contractId }),
    ctx.repo.table("case_area_changes").list({ caseId: c.id }),
  ]);
  const profiles = changes.length ? await ctx.repo.table("profiles").list({ id: { in: [...new Set(changes.map((x) => x.changedBy))] } }) : [];
  const role = ctx.actor.role;
  const may = AREA_CHANGERS.includes(role);
  const blocked = !AREA_CHANGE_STATUSES.includes(c.status)
    ? c.status === "closed" ? "Insatsen är avslutad. Yrkesområdet kan inte bytas." : "Yrkesområdet kan bytas när beställningen är bekräftad."
    : !c.primaryAreaCode ? "Yrkesområdet väljs när beställningen accepteras." : null;
  const current = c.primaryAreaCode ? { code: c.primaryAreaCode, name: areas.find((a) => a.code === c.primaryAreaCode)?.name ?? "" } : null;
  return {
    caseId: c.id,
    current,
    canChange: may && !blocked,
    blockedText: may ? blocked : null,
    options: areas.filter((a) => a.active && a.code !== c.primaryAreaCode).sort((a, b) => a.code.localeCompare(b.code)).map((a) => ({ code: a.code, name: a.name })),
    effectiveMonth: effectiveMonthOf(ctx.now()),
    history: [...changes]
      .sort((a, b) => (a.changedAt < b.changedAt ? 1 : a.changedAt > b.changedAt ? -1 : a.id < b.id ? 1 : -1))
      .map((x) => ({ id: x.id, changedAt: x.changedAt, fromArea: x.fromArea, toArea: x.toArea, byName: personName(profiles, x.changedBy), effectiveMonth: x.effectiveMonth })),
  };
});

handleCommand(caseChangeArea, { roles: AREA_CHANGERS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  // Full åtkomst: personen läses via behörigheten (vilande spärr: bara namngivna ser personen i ett skyddat ärende).
  const person = await ctx.repo.table("persons").get(c.personId);
  if (!person) return fail("forbidden", "Du kan inte byta yrkesområde i det här ärendet.");
  const areas = await ctx.repo.table("contract_areas").list({ contractId: c.contractId });
  const toArea = p.toArea.trim();
  const problem = areaChangeProblem(c, areas, toArea, p.motivation);
  if (problem) return fail(problem.code, problem.text);
  const fromArea = c.primaryAreaCode as string;
  const now = ctx.now();
  const me = ctx.actor.userId;
  const effectiveMonth = effectiveMonthOf(now);

  // 1. Motiveringen – en vanlig anteckning i deltagarkortet (internt för Miljonbemanning, aldrig till kommunen).
  const noteId = ctx.newId("note");
  const label = (code: string) => areaName(areas, code).trim();
  const note: CaseNote = {
    id: noteId, contractId: c.contractId, caseId: c.id, authorId: me, occurredOn: dayOf(now), kind: "other", audience: "team",
    body: `Byte av yrkesområde: ${label(fromArea)} → ${label(toArea)}. ${p.motivation.trim()}`, createdAt: now, updatedAt: null, removedAt: null, removedBy: null,
  };
  await ctx.repo.table("case_notes").insert(note);
  // 2. Bytet (bara koder, id:n och tider – ekonomen läser raden för faktureringen).
  const change: CaseAreaChange = { id: ctx.newId("cac"), contractId: c.contractId, caseId: c.id, fromArea, toArea, effectiveMonth, changedBy: me, changedAt: now, noteId };
  await ctx.repo.table("case_area_changes").insert(change);
  // 3. Ärendets yrkesområde. Ett alternativt yrkesområde som blir det nya tas bort (samma regel som när avropet accepteras).
  await ctx.repo.table("cases").update(c.id, { primaryAreaCode: toArea, ...(c.secondaryAreaCode === toArea ? { secondaryAreaCode: null } : {}) });
  // 4. Revisionsloggen: id:n och koder – aldrig motiveringen.
  await ctx.audit({
    action: "case.area_changed", entity: "case", entityId: c.id, contractId: c.contractId,
    details: { caseId: c.id, fromArea, toArea, effectiveMonth, changeId: change.id, noteId },
  });
  // 5. Grupp och inbjudningar (kopplas i integrationen – src/features/_shared/case-area-hooks.ts).
  await afterCaseAreaChanged(ctx, c.id);
  return ok({ changeId: change.id, noteId, effectiveMonth });
});
