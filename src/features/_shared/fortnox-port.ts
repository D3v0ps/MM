// Porten till Fortnox (SPEC §7.15). Hanterarna når Fortnox bara via ctx.fortnox – aldrig en klient direkt. Isomorf.
//   Minnesläget (prototypen, utvecklingsläget, e2e): simulerad port (createSimulatedFortnox). "Skapa i Fortnox" sätter
//   statusen i Miljonmatch och fakturanumret räknas fram (fortnoxNumber i src/core/billing.ts). Inga anrop utanför.
//   Supabase-läget (testmiljön, produktion): ingen port förrän en riktig klient finns (beslut 2026-10-08, pengasäkerhet) –
//   ctx.fortnox saknas, knapparna döljs och ekonomen skapar fakturan i Fortnox för hand och markerar den som manuellt
//   fakturerad (ekonomi.billingMarkManual). Ingen status, inget nummer och ingen logg "skapad i Fortnox" utan port.
import type { Ctx } from "@/api/server";

export type FortnoxPort = {
  /** "simulated" = minnesläget. En riktig klient får ett eget värde när den byggs (och skärmarnas texter följer med). */
  provider: "simulated";
};

/** Den simulerade porten (minnesläget). Gör inga anrop – hanterarna sätter statusen själva. */
export const createSimulatedFortnox = (): FortnoxPort => ({ provider: "simulated" });

/** true = Fortnox är inte kopplat i körläget (ctx.fortnox saknas). */
export const fortnoxOff = (ctx: Pick<Ctx, "fortnox">): boolean => !ctx.fortnox;

/** Hanterarnas svar (felkoden fortnox_off) när Fortnox inte är kopplat. */
export const FORTNOX_OFF_ERROR = "Fortnox är inte kopplat ännu. Fakturan skapas i Fortnox för hand och markeras här som manuellt fakturerad.";
/** Skärmarnas text (fakturakörningen och kortet Fortnox-synk) när Fortnox inte är kopplat. */
export const FORTNOX_OFF_TEXT = "Fortnox är inte kopplat ännu. Skapa fakturan i Fortnox och välj Markera som manuellt fakturerad här.";
