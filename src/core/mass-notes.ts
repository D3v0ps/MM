// Massanteckningar (coachmötet 2026-10-09, Karims beslut 4) – ren logik för skärmen Anteckningar (/anteckningar).
// En rad per deltagare: bara ifyllda rader blir anteckningar, tomma (eller bara mellanslag) hoppas över. Texten skickas
// trimmad. Personnummer och datum kontrolleras av servern per rad (grupper.anteckningarSpara) – allt eller inget.
import { looksLikePnr } from "./validation";
import type { LocalDate } from "./time";

export type MassNoteInput = { caseId: string; occurredOn: LocalDate; body: string };

/** Raderna som ska sparas, i listans ordning: ifyllda rader, trimmade. */
export function massNoteRowsToSave(rows: readonly { caseId: string }[], texts: Readonly<Record<string, string>>, occurredOn: LocalDate): MassNoteInput[] {
  return rows.map((r) => ({ caseId: r.caseId, occurredOn, body: (texts[r.caseId] ?? "").trim() })).filter((r) => r.body.length > 0);
}

/** Rader med något som ser ut som ett personnummer (skärmen visar felet vid raden innan något skickas). */
export function massNotePnrRows(rows: readonly MassNoteInput[]): string[] {
  return rows.filter((r) => looksLikePnr(r.body)).map((r) => r.caseId);
}
