// Hanterare: Byt yrkesområde på deltagarkortet (Karims beslut 2026-10-22). Registreras via ./handlers.ts.
//   Vem:        coach, samordnare och avtalsansvarig med full åtkomst (personen läses via behörigheten – vid skyddade
//               personuppgifter, vilande spärr, bara namngiven huvudcoach och avtalsansvarig). Chef och systemadministratör ser
//               bytena i läsläge. Kommunen och ekonomen nekas av rollkontrollen (ekonomen ser bytena i Ekonomi).
//   Regler:     areaChangeProblem i src/core/area-changes.ts (bekräftat, pågående eller pausat ärende, ett annat aktivt yrkesområde
//               i avtalet, motivering 10–300 tecken utan personnummer, yrkesspåret ett av det nya yrkesområdets spår eller tomt).
//   Skrivning:  via ctx.repo (RLS): först anteckningen med motiveringen (case_notes – låst efteråt: den ändras och tas aldrig bort,
//               0036), sedan bytet (case_area_changes, nästa nummer i ärendet – seq). Bytet ändrar ärendets yrkesområde,
//               yrkesspår och alternativ i samma transaktion (triggern case_area_changes_apply i 0036, policy.ts afterInsert i
//               minnet): bytet och ärendet skrivs alltid tillsammans, aldrig det ena utan det andra – inte heller om servern
//               stängs av mitt i. Sedan kartläggningens valda yrkesspår (samma som ärendets), revisionsloggen och sist
//               afterCaseAreaChanged (grupp och inbjudningar – systemsteget syncAudienceInvites, som bjuder in till det nya
//               yrkesområdets kommande aktiviteter och tar bort ur det gamlas). Det gamla yrkesspåret hör till det gamla
//               yrkesområdet och följer aldrig med – det sparas på bytet (fromTrack) för rapporterna före bytet.
//   Samtidigt:  två byten i samma ärende samtidigt – det andra får conflict (den unika nyckeln case_id + seq, och triggern som
//               kräver att bytet utgår från ärendets nuvarande yrkesområde). Kan bytet inte skrivas döljs anteckningen igen.
//   Svaret      kom inte fram (nätverksfel, tidsgräns) efter att bytet skrevs: bytet läses om (ctx.repo) – finns det har ärendet
//   saknas:     bytt, och loggen och grupperna görs som vanligt.
//   Logg:       case.area_changed med id:n och koder – aldrig motiveringen (CLAUDE.md punkt 2).
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand, handleQuery } from "@/api/server";
import {
  AREA_CHANGE_STATUSES, AREA_CHANGERS, areaChangeNoteBody, areaChangeProblem, effectiveMonthOf, inOrder, motivationOf, nextAreaChangeSeq,
} from "@/core/area-changes";
import { areaName, personName } from "@/core/labels";
import { dayOf } from "@/core/time";
import { PolicyError, UniqueError } from "@/data/repo";
import type { CaseAreaChange, CaseNote } from "@/data/schema";
import { TRACKS } from "@/data/seed/constants";
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
  const [profiles, notes] = changes.length
    ? await Promise.all([
      ctx.repo.table("profiles").list({ id: { in: [...new Set(changes.map((x) => x.changedBy))] } }),
      // Motiveringen: den låsta anteckningen, via behörigheten (samma läsare som anteckningarna i kortet).
      ctx.repo.table("case_notes").list({ id: { in: changes.map((x) => x.noteId) } }),
    ])
    : [[], []];
  const label = (code: string) => areaName(areas, code).trim();
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
    options: areas
      .filter((a) => a.active && a.code !== c.primaryAreaCode)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((a) => ({ code: a.code, name: a.name, tracks: [...(TRACKS[a.code as keyof typeof TRACKS] ?? [])] })),
    track: c.vocationalTrack,
    effectiveMonth: effectiveMonthOf(ctx.now()),
    history: inOrder(changes)
      .reverse()
      .map((x) => {
        const note = notes.find((n) => n.id === x.noteId);
        return {
          id: x.id, changedAt: x.changedAt, fromArea: x.fromArea, toArea: x.toArea, fromName: label(x.fromArea), toName: label(x.toArea), byName: personName(profiles, x.changedBy),
          effectiveMonth: x.effectiveMonth, motivation: note ? motivationOf(note.body, label(x.fromArea), label(x.toArea)) : null,
        };
      }),
  };
});

const CONFLICT = "Yrkesområdet har ändrats under tiden, kanske av en kollega. Ladda om sidan och försök igen – inget har sparats.";
const code = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? "");
/** Ett byte som inte kunde skrivas: någon annan hann byta (nästa nummer tog slut, kedjan bröts) eller behörigheten nekade. */
const lostRace = (e: unknown): boolean => e instanceof UniqueError || e instanceof PolicyError || ["23505", "23514", "42501"].includes(code(e));

handleCommand(caseChangeArea, { roles: AREA_CHANGERS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  // Full åtkomst: personen läses via behörigheten (vilande spärr: bara namngivna ser personen i ett skyddat ärende).
  const person = await ctx.repo.table("persons").get(c.personId);
  if (!person) return fail("forbidden", "Du kan inte byta yrkesområde i det här ärendet.");
  // Dialogen visade ett annat yrkesområde än ärendet har nu: någon annan har bytt under tiden.
  if (p.fromArea && p.fromArea !== c.primaryAreaCode) return fail("conflict", CONFLICT);
  const areas = await ctx.repo.table("contract_areas").list({ contractId: c.contractId });
  const toArea = p.toArea.trim();
  const track = (p.vocationalTrack ?? "").trim();
  const problem = areaChangeProblem(c, areas, toArea, p.motivation, track, TRACKS[toArea as keyof typeof TRACKS] ?? []);
  if (problem) return fail(problem.code, problem.text);
  const fromArea = c.primaryAreaCode as string;
  const now = ctx.now();
  const me = ctx.actor.userId;
  const effectiveMonth = effectiveMonthOf(now);
  // Bytets nummer i ärendet (seq): nästa efter de byten som finns. Två samtidiga byten får samma nummer och det andra stoppas
  // av den unika nyckeln – triggern och policyn kräver dessutom att bytet utgår från ärendets nuvarande yrkesområde.
  const seq = nextAreaChangeSeq(await ctx.repo.table("case_area_changes").list({ caseId: c.id }));

  // 1. Motiveringen – en vanlig anteckning i deltagarkortet (internt för Miljonbemanning, aldrig till kommunen). Den skrivs först
  //    (bytet pekar på den) och tas bort igen om bytet inte kan skrivas. Efteråt är den låst (0036, policy.ts caseNoteWrite).
  const noteId = ctx.newId("note");
  const label = (code: string) => areaName(areas, code).trim();
  const note: CaseNote = {
    id: noteId, contractId: c.contractId, caseId: c.id, authorId: me, occurredOn: dayOf(now), kind: "other", audience: "team",
    body: areaChangeNoteBody(label(fromArea), label(toArea), p.motivation), createdAt: now, updatedAt: null, removedAt: null, removedBy: null,
  };
  await ctx.repo.table("case_notes").insert(note);
  const hideNote = () => ctx.repo.table("case_notes").update(noteId, { removedAt: now, removedBy: me });
  // 2. Bytet (koder, id:n, tider och yrkesspåren – ekonomen läser raden för faktureringen). Ärendets yrkesområde, yrkesspår och
  //    alternativ ändras i samma transaktion (triggern case_area_changes_apply): ett alternativt yrkesområde som blir det nya tas
  //    bort (samma regel som när avropet accepteras). Har ärendet hunnit ändras nekas hela bytet.
  const change: CaseAreaChange = {
    id: ctx.newId("cac"), contractId: c.contractId, caseId: c.id, fromArea, toArea, effectiveMonth, changedBy: me, changedAt: now, noteId, seq,
    fromTrack: c.vocationalTrack, toTrack: track, fromSecondaryArea: c.secondaryAreaCode ?? null,
  };
  try {
    await ctx.repo.table("case_area_changes").insert(change);
  } catch (e) {
    if (lostRace(e)) {
      await hideNote();
      return fail("conflict", CONFLICT);
    }
    // Svaret kom inte fram: bytet och ärendet skrivs tillsammans, så finns raden har ärendet bytt.
    const saved = await ctx.repo.table("case_area_changes").get(change.id).catch(() => null);
    if (!saved) {
      // Bytet skrevs inte. Anteckningen döljs (går inte det – t.ex. för att bytet ändå skrevs och anteckningen är låst – står
      // den kvar som en vanlig anteckning).
      await hideNote().catch(() => undefined);
      throw e;
    }
  }
  // 3. Kartläggningens valda yrkesspår följer ärendets: det gamla hör till det gamla yrkesområdet. Utan valt spår frågar
  //    kartläggningen igen, och spåret som väljs där förs över till ärendet (coach.intakeSave).
  //    Bytet är redan gjort: går det inte (t.ex. en samtidig ändring i kartläggningen) står det gamla spåret kvar där tills
  //    coachen väljer ett nytt.
  try {
    const ia = await ctx.repo.table("intake_assessments").first({ caseId: c.id });
    if (ia && ia.chosenTrack !== track) await ctx.repo.table("intake_assessments").updateIf(ia.id, { version: ia.version }, { chosenTrack: track, version: ia.version + 1 });
  } catch {
    // Inget att göra – se ovan.
  }
  // 4. Revisionsloggen: id:n och koder – aldrig motiveringen.
  await ctx.audit({
    action: "case.area_changed", entity: "case", entityId: c.id, contractId: c.contractId,
    details: { caseId: c.id, fromArea, toArea, effectiveMonth, changeId: change.id, noteId, seq, ...(track !== c.vocationalTrack ? { trackChanged: true } : {}) },
  });
  // 5. Grupp och inbjudningar: det nya yrkesområdets kommande aktiviteter med målgrupp (src/features/_shared/case-area-hooks.ts).
  const groups = await afterCaseAreaChanged(ctx, c.id);
  return ok({ changeId: change.id, noteId, effectiveMonth, groups });
});
