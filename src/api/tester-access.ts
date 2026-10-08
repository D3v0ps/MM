// Testmiljön: vad testarna får se (beslut 2026-10-02, Karim). En plats för regeln – servern, sessionsvyn, menyn och skärmarna
// läser den härifrån.
//
// Testarna (profiles.is_tester, bara i testmiljön) agerar som testpersoner med påhittade testdata. Bara testarna i
// FULL_ACCESS_TESTERS ser allt. Alla andra testare – även testare som läggs till senare – är begränsade (neka som standard):
// de ser inga priser, belopp i kronor, fakturaunderlag, prisartiklar, viten i kronor, bonusunderlag, Miljonbemannings interna
// mål (t.ex. 35 % för resultatgraden) eller avtalssidan – vilken testperson de än agerar som.
// Avtalsmålet (t.ex. 32 %) är avtalets gemensamma mål som kommunen själv ser – det visas för alla.
//
// Actor.testerId sätts bara av servern i testmiljön (src/server/identity.ts) och är den inloggade testarens EGEN profil, även
// när testaren agerar som en testperson. I produktion, i prototypen och i minnesläget finns ingen testerId – då ändras
// ingenting. (Minnesläget kan simulera en testare för e2e: POST /api/dev-session med testerId.)
//
// Beslut 5 (2026-10-07) generaliserar spärren för belopp: hidesMoney nedan gäller alla roller utom ekonomen.
//
// Spärren ligger i Next-servern: hela frågor och kommandon som bara handlar om pengar och villkor nekas i execute()
// (HandlerOpts.commercial), och i frågor där belopp bara är en del tas fälten bort i svaret (typade, valfria fält).
import type { Actor, Role } from "./roles";

/** Testare med fullständig åtkomst (profiles.id i TESTERS, src/data/supabase/seed-rows.ts): Karim och Ali. */
export const FULL_ACCESS_TESTERS: readonly string[] = ["tester-karim", "tester-ali"];

/**
 * true = den inloggade är en begränsad testare: en testare (testerId finns) som inte står i FULL_ACCESS_TESTERS.
 * false = ingen testare (riktiga användare, produktion, prototypen, minnesläget) eller en testare med fullständig åtkomst.
 */
export function hidesCommercial(actor: Pick<Actor, "testerId"> | null | undefined): boolean {
  const id = actor?.testerId;
  if (id === undefined || id === null) return false;
  return !FULL_ACCESS_TESTERS.includes(id);
}

/**
 * Pengar syns bara för rollen ekonom (beslut 5, Karim 2026-10-07): belopp i kronor, priser, prisartiklar, viten i kronor,
 * bonus, ofakturerat i kronor, AI-kostnader och fakturor med belopp lämnas bara ut när aktören har rollen ekonom OCH inte är
 * en begränsad testare. Alla andra roller – samordnare, avtalsansvarig, coach, handledare, chef, systemadministratör,
 * kommunen och deltagaren – får samma skydd som en begränsad testare: beloppsfälten tas bort i svaren (antal veckor och
 * ärenden visas i stället), och frågor och kommandon som bara handlar om pengar är öppna bara för ekonomen (roles).
 */
export const MONEY_ROLES: readonly Role[] = ["ekonom"];
/** true = rollen får se belopp om aktören inte är en begränsad testare (samma regel som hidesMoney, för kod utan Actor). */
export const moneyVisible = (role: Role | string, hideCommercial: boolean): boolean => (MONEY_ROLES as readonly string[]).includes(role) && !hideCommercial;
/** true = belopp i kronor ska tas bort i svaret till aktören (alla utom ekonomen, och alltid för begränsade testare). */
export function hidesMoney(actor: Pick<Actor, "testerId" | "role"> | null | undefined): boolean {
  if (!actor) return true;
  return !moneyVisible(actor.role, hidesCommercial(actor));
}
/** Texten där ett belopp annars hade stått, för andra roller än ekonomen. */
export const MONEY_HIDDEN_TEXT = "Visas bara för ekonomen";

/** Roller som en begränsad testare inte får agera som (hela rollen handlar om fakturering och belopp). */
export const ROLES_HIDDEN_FROM_TESTERS: readonly Role[] = ["ekonom"];
export const roleHiddenFromTesters = (role: Role | string): boolean => (ROLES_HIDDEN_FROM_TESTERS as readonly string[]).includes(role);

/** Texten som står där ett belopp, ett pris eller ett internt mål annars står. */
export const TESTER_HIDDEN_TEXT = "Visas inte för testare";
/** Felkoden och texten när en hel sida (fråga eller kommando) nekas för en begränsad testare. */
export const TESTER_HIDDEN_CODE = "tester_hidden";
export const TESTER_HIDDEN_PAGE = "Den här sidan visas inte för testare.";

/**
 * Sidor (sökvägar) som är stängda för begränsade testare: avtalssidan med alla flikar och Ekonomi. Används av menyn,
 * startsidan och skärmskalet (src/shell). Servern nekar dessutom frågorna bakom sidorna.
 */
export const TESTER_HIDDEN_PATHS: readonly string[] = ["/admin/avtal", "/ekonomi"];
export const isTesterHiddenPath = (p: string): boolean => TESTER_HIDDEN_PATHS.some((x) => p === x || p.startsWith(`${x}/`));

/**
 * Får en begränsad testare anropa nyckeln med den här rollen? En begränsad testare som (från tiden före spärren) fortfarande
 * agerar som en ekonom nekas allt utom sessionens egna frågor (menyns räknare) – byte av testperson går via
 * /api/session/impersonate och påverkas inte.
 */
export function testerRoleBlocks(actor: Pick<Actor, "testerId" | "role">, key: string): boolean {
  return hidesCommercial(actor) && roleHiddenFromTesters(actor.role) && !key.startsWith("session.");
}
