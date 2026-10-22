// Följder av ett byte av yrkesområde (Karims beslut 2026-10-22: "Grupp och inbjudningar ändras direkt"). Bara för hanterare.
//
// Anropas av arenden.bytYrkesomrade (src/features/arenden/area-handlers.ts) sist i kommandot – efter att anteckningen, bytet
// (case_area_changes), ärendets yrkesområde (cases.primaryAreaCode) och revisionsloggen har skrivits. Ärendet har då redan det
// nya yrkesområdet.
//
// Yrkesområdet är deltagarens grupp (spår A, src/core/audience.ts): deltagaren bjuds in till det nya yrkesområdets kommande
// aktiviteter med målgrupp och tas bort ur det gamlas – samma systemsteg som efter en ändrad nivå, en startad och en avslutad
// insats (syncAudienceInvites i src/features/aktiviteter/audience-sync.ts). Den rör aldrig manuellt inbjudna, rader med
// registrerad närvaro eller aktiviteter som har börjat, loggar själv group_activity.audience_synced (id:n, koder och antal) och
// skickar meddelandet bara när aktiviteten har det påslaget.
//
// Bytet är redan sparat när funktionen körs, så den kastar aldrig: ett oväntat fel (databasen) loggas bara som feltyp, och
// jobbet report_schedule stämmer av inbjudningarna som skyddsnät vid nästa körning (ensureGroupActivities). Kommandots
// omräkning (CASE_FACTS och INBOX) täcker aktiviteterna, kortet, listorna och inkorgen.
import type { Ctx } from "@/api/server";
import { syncAudienceInvites } from "../aktiviteter/audience-sync";

/** Vad bytet gjorde med inbjudningarna: antal kommande aktiviteter deltagaren bjöds in till och togs bort ur. null = inte avstämt nu. */
export type CaseAreaFollowUp = { invited: number; removed: number } | null;

/** Grupp och inbjudningar efter ett byte av yrkesområde (se ovan). */
export async function afterCaseAreaChanged(ctx: Ctx, caseId: string): Promise<CaseAreaFollowUp> {
  try {
    // Ärendet läses via aktörens behörighet (kommandot har redan kontrollerat full åtkomst).
    const c = await ctx.repo.table("cases").get(caseId);
    if (!c) return null;
    const sync = await syncAudienceInvites(ctx, { contractId: c.contractId, caseIds: [c.id] });
    return { invited: sync.added, removed: sync.removed };
  } catch (e) {
    // Bara feltypen – aldrig felets text (den kan innehålla värden ur raderna).
    console.error("byt yrkesområde: inbjudningarna kunde inte stämmas av", e instanceof Error ? e.name : typeof e);
    return null;
  }
}
