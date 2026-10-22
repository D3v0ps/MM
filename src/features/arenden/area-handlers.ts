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
//   Svaret      kom inte fram (nätverksfel, tidsgräns) efter att bytet skrevs: bytet läses om (ctx.repo, några försök) – finns
//   saknas:     det har ärendet bytt, och loggen och grupperna görs som vanligt. Går det inte att läsa om svarar hanteraren
//               "unknown" (försök igen) i stället för ett allmänt fel. Samma byte igen (eget, nyligen, samma nya yrkesområde och
//               spår, utan case.area_changed i loggen) gör klart kartläggningen, loggen och grupperna och svarar ok – aldrig
//               "inget har sparats" för ett byte som sparades.
//   Logg:       case.area_changed med id:n och koder – aldrig motiveringen (CLAUDE.md punkt 2).
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand, handleQuery } from "@/api/server";
import {
  AREA_CHANGE_STATUSES, AREA_CHANGERS, areaChangeNoteBody, areaChangeProblem, effectiveMonthOf, inOrder, motivationOf, nextAreaChangeSeq,
} from "@/core/area-changes";
import { areaName, personName } from "@/core/labels";
import { dayOf, diffMinutes } from "@/core/time";
import type { Ctx } from "@/api/server";
import { PolicyError, UniqueError } from "@/data/repo";
import type { Case, CaseAreaChange, CaseNote } from "@/data/schema";
import { TRACKS } from "@/data/seed/constants";
import { afterCaseAreaChanged, type CaseAreaFollowUp } from "../_shared/case-area-hooks";
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
const UNKNOWN = "Det gick inte att se om bytet sparades. Försök igen – har bytet redan sparats görs det klart, annars sparas det nu.";
/** Ett eget byte som inte blev klart görs klart av samma byte igen inom den här tiden (minuter). */
const FINISH_WITHIN_MINUTES = 60;
const code = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? "");
/** Ett byte som inte kunde skrivas: någon annan hann byta (nästa nummer tog slut, kedjan bröts) eller behörigheten nekade. */
const lostRace = (e: unknown): boolean => e instanceof UniqueError || e instanceof PolicyError || ["23505", "23514", "42501"].includes(code(e));

handleCommand(caseChangeArea, { roles: AREA_CHANGERS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  // Full åtkomst: personen läses via behörigheten (vilande spärr: bara namngivna ser personen i ett skyddat ärende).
  const person = await ctx.repo.table("persons").get(c.personId);
  if (!person) return fail("forbidden", "Du kan inte byta yrkesområde i det här ärendet.");
  const toArea = p.toArea.trim();
  const track = (p.vocationalTrack ?? "").trim();
  // Samma byte igen efter "unknown": bytet sparades men blev aldrig klart (svaret kom inte fram och det gick inte att läsa om).
  // Kartläggningen, loggen och grupperna görs nu, och svaret är ok.
  const unfinished = await unfinishedOwnChange(ctx, c, { toArea, track, fromArea: p.fromArea });
  if (unfinished) return ok({ changeId: unfinished.id, noteId: unfinished.noteId, effectiveMonth: unfinished.effectiveMonth, groups: await finishChange(ctx, c, unfinished) });
  // Dialogen visade ett annat yrkesområde än ärendet har nu: någon annan har bytt under tiden.
  if (p.fromArea && p.fromArea !== c.primaryAreaCode) return fail("conflict", CONFLICT);
  const areas = await ctx.repo.table("contract_areas").list({ contractId: c.contractId });
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
    // Svaret kom inte fram: bytet och ärendet skrivs tillsammans, så finns raden har ärendet bytt. Läses om några gånger – ett
    // nätverksfel brukar träffa också den första omläsningen.
    const saved = await readBack(ctx, change.id);
    if (saved === "unknown") {
      // Vet inte om bytet skrevs: anteckningen döljs om det går (är bytet skrivet är den låst och står kvar som motivering).
      // Samma byte igen gör klart eller sparar det (unfinishedOwnChange).
      await hideNote().catch(() => undefined);
      return fail("unknown", UNKNOWN);
    }
    if (!saved) {
      // Bytet skrevs inte. Anteckningen döljs (går inte det står den kvar som en vanlig anteckning).
      await hideNote().catch(() => undefined);
      throw e;
    }
  }
  const groups = await finishChange(ctx, c, change);
  return ok({ changeId: change.id, noteId, effectiveMonth, groups });
});

/** Bytet läst om efter ett tappat svar: raden, null (finns inte) eller "unknown" (gick inte att läsa – tre försök). */
async function readBack(ctx: Ctx, id: string): Promise<CaseAreaChange | null | "unknown"> {
  for (let i = 0; i < 3; i++) {
    try {
      return await ctx.repo.table("case_area_changes").get(id);
    } catch {
      // Försök igen.
    }
  }
  return "unknown";
}

/**
 * Ärendets senaste byte när det är ett eget byte som sparades men aldrig blev klart: samma nya yrkesområde och spår (och samma
 * gamla yrkesområde som dialogen visade), högst FINISH_WITHIN_MINUTES gammalt, ärendet har fortfarande bytets yrkesområde och
 * revisionsloggen saknar case.area_changed för bytet. Annars null.
 */
async function unfinishedOwnChange(ctx: Ctx, c: Case, p: { toArea: string; track: string; fromArea?: string }): Promise<CaseAreaChange | null> {
  if (c.primaryAreaCode !== p.toArea) return null;
  const last = inOrder(await ctx.repo.table("case_area_changes").list({ caseId: c.id })).at(-1);
  if (!last || last.changedBy !== ctx.actor.userId || last.toArea !== p.toArea || last.toTrack !== p.track || (p.fromArea && p.fromArea !== last.fromArea)) return null;
  const age = diffMinutes(last.changedAt, ctx.now());
  if (age < 0 || age > FINISH_WITHIN_MINUTES) return null;
  // Revisionsloggen läses av servern (bara om raden finns – samma uppslag som autosparningens logg i coach-hanterarna).
  const logged = await ctx.system.table("audit_log").list({ entity: "case", entityId: c.id, action: "case.area_changed" });
  return logged.some((l) => l.details?.changeId === last.id) ? null : last;
}

/**
 * Stegen efter bytet (bytet och ärendet är redan skrivna): kartläggningens valda yrkesspår, revisionsloggen och grupperna. c är
 * ärendet som det var när hanteraren läste det (före bytet, eller efter ett byte som görs klart).
 */
async function finishChange(ctx: Ctx, c: Case, change: CaseAreaChange): Promise<CaseAreaFollowUp> {
  // 3. Kartläggningens valda yrkesspår följer ärendets: det gamla hör till det gamla yrkesområdet. Utan valt spår frågar
  //    kartläggningen igen, och spåret som väljs där förs över till ärendet (coach.intakeSave).
  //    Bytet är redan gjort: går det inte (t.ex. en samtidig ändring i kartläggningen) står det gamla spåret kvar där tills
  //    coachen väljer ett nytt – det förs aldrig över till ärendet av en sparning som inte väljer spåret (coach.intakeSave).
  //    Ett byte som görs klart i efterhand rör bara kartläggningen om ärendets spår fortfarande är bytets.
  try {
    const cur = c.primaryAreaCode === change.toArea ? c : null;
    if (!cur || cur.vocationalTrack === change.toTrack) {
      const ia = await ctx.repo.table("intake_assessments").first({ caseId: c.id });
      if (ia && ia.chosenTrack !== change.toTrack) await ctx.repo.table("intake_assessments").updateIf(ia.id, { version: ia.version }, { chosenTrack: change.toTrack, version: ia.version + 1 });
    }
  } catch {
    // Inget att göra – se ovan.
  }
  // 4. Revisionsloggen: id:n och koder – aldrig motiveringen.
  await ctx.audit({
    action: "case.area_changed", entity: "case", entityId: c.id, contractId: c.contractId,
    details: {
      caseId: c.id, fromArea: change.fromArea, toArea: change.toArea, effectiveMonth: change.effectiveMonth, changeId: change.id, noteId: change.noteId, seq: change.seq,
      ...(change.toTrack !== change.fromTrack ? { trackChanged: true } : {}),
    },
  });
  // 5. Grupp och inbjudningar: det nya yrkesområdets kommande aktiviteter med målgrupp (src/features/_shared/case-area-hooks.ts).
  return afterCaseAreaChanged(ctx, c.id);
}
