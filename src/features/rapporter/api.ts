// Kontrakt för området rapporter (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
import { z } from "zod";
import { command, type Result } from "@/api/contract";
import { IdSchema } from "../_shared/schemas";

// ---- Delade kommandon (portade från prototypens 03-domain.js)
// Samma beteende och felkoder som prototypens MM.defineAction. Nyckeln är "rapporter.<prototypens namn>".
// Rollregler som i prototypens statuskort (rapporter.js, StatusCard): månads- och slutrapport godkänns av huvudcoachen,
// orderbekräftelse och veckorapport av samordnare/avtalsansvarig, beställarrapporten av avtalsansvarig.
// Leverans och rättelse: huvudcoachen (egna ärenden), samordnare och avtalsansvarig; beställarrapporten bara de två senare.

/** Godkänn en rapport (prototypens report.approve). Bara utkast eller granskad rapport som inte är ersatt. */
export const reportApprove = command("rapporter.reportApprove", z.object({
  reportId: IdSchema,
})).returns<Result<object, "not_found" | "forbidden" | "wrong_status">>();

/**
 * Leverera i portalen (prototypens report.deliver): mottagaren får ett mejl utan personuppgifter ("… finns i portalen –
 * logga in för att läsa"). Föregående version markeras som ersatt. Veckorapporten kan levereras när all närvaro är
 * registrerad (incomplete annars), slutrapporten när coachen skrivit rekommenderad fortsättning (final_text).
 */
export const reportDeliver = command("rapporter.reportDeliver", z.object({
  reportId: IdSchema,
})).returns<Result<object, "not_found" | "forbidden" | "not_approved" | "incomplete" | "final_text" | "wrong_status">>();

/** Rätta en rapport (prototypens report.correct): ny version som utkast. Den gamla sparas och syns tills rättelsen levererats. */
export const reportCorrect = command("rapporter.reportCorrect", z.object({
  reportId: IdSchema,
})).returns<Result<{ reportId: string; version: number }, "not_found" | "forbidden" | "wrong_status">>();

/**
 * Kvittens när kommunen öppnar en rapport (prototypens report.open, tyst). Bara mottagaren kvitterar – andra
 * kommunanvändare som läser rapporten loggas men kvitterar inte. Visningen loggas alltid.
 */
export const reportOpen = command("rapporter.reportOpen", z.object({
  reportId: IdSchema,
})).returns<Result<{ acknowledged: boolean }, "not_found">>();
