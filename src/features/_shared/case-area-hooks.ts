// Följder av ett byte av yrkesområde (Karims beslut 2026-10-22: "Grupp och inbjudningar ändras direkt"). Bara för hanterare.
//
// Anropas av arenden.bytYrkesomrade (src/features/arenden/area-handlers.ts) sist i kommandot – efter att anteckningen, bytet
// (case_area_changes), ärendets yrkesområde (cases.primaryAreaCode) och revisionsloggen har skrivits. Ärendet har då redan det
// nya yrkesområdet.
//
// I DAG EN MEDVETEN TOM FUNKTION (no-op) – kopplas till inbjudningarna i integrationen: yrkesområdena blir grupper i ett annat
// spår, och där finns funktionen som lägger till och tar bort ärendets inbjudningar efter dess grupper (syncAudienceInvites).
// Integrationen ersätter kroppen nedan med ett anrop till den, med samma ctx (aktörens behörighet – ctx.repo – och dess
// revisionslogg). Kontraktet för integrationen:
//   - ctx är kommandots Ctx (aktören är coach, samordnare eller avtalsansvarig med full åtkomst till ärendet).
//   - caseId är ärendet som just bytt yrkesområde. Det gamla och det nya yrkesområdet finns i den senaste raden i
//     case_area_changes för ärendet (läs den via ctx.repo om de behövs).
//   - Funktionen får inte kasta för vanliga affärsfel (bytet är redan sparat) – det som inte går loggas som ett id/kod.
//   - Inga personuppgifter i loggar eller revisionslogg (bara id:n och koder).
//   - Kommandots omräkning (CASE_FACTS) täcker redan aktiviteterna, kortet och listorna.
import type { Ctx } from "@/api/server";

/** Grupp och inbjudningar efter ett byte av yrkesområde. Tom tills integrationen kopplar den (se ovan). */
export async function afterCaseAreaChanged(ctx: Ctx, caseId: string): Promise<void> {
  void ctx;
  void caseId;
}
