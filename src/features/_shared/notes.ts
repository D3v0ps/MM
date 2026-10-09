// Kontrollen av en fri anteckning (case_notes, 0019) – samma för anteckningen i deltagarkortet (arenden.noteSave) och raderna i
// aktivitetsvyn (aktiviteter.anteckningar, coachmötet 2026-10-09). Inget framtida datum, inte före beställningen och inga
// personnummer i texten. Bara för hanterare.
import { looksLikePnr } from "@/core/validation";
import { dayOf, type LocalDate } from "@/core/time";
import type { Case } from "@/data/schema";

export const NOTE_PNR_TEXT = "Det ser ut som ett personnummer i texten. Ta bort det – ärendenumret räcker.";
export const NOTE_FUTURE_TEXT = "Datumet kan inte vara senare än i dag.";
export const NOTE_BEFORE_ORDER_TEXT = "Datumet kan inte vara före beställningen.";

/** Vad som stoppar anteckningen, eller null. */
export function noteProblem(c: Pick<Case, "referredAt">, occurredOn: LocalDate, body: string, today: LocalDate): { code: "pnr" | "date"; text: string } | null {
  if (occurredOn > today) return { code: "date", text: NOTE_FUTURE_TEXT };
  if (occurredOn < dayOf(c.referredAt)) return { code: "date", text: NOTE_BEFORE_ORDER_TEXT };
  if (looksLikePnr(body)) return { code: "pnr", text: NOTE_PNR_TEXT };
  return null;
}
