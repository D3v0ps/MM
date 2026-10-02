// Typer för AI-förslagen i veckoavstämningen (kontrakt – importeras av skärmar via src/features/coach/api.ts).
// Den simulerade AI:n finns i ai-sim.ts (bara för hanterare).
import type { EmployerContacts, GoalStatus } from "@/data/schema";

/** Ett förslag med belägg. t = sekunder in i samtalet (null för inklistrade anteckningar). */
export type AiFieldSuggestion<T> = { value: T | null; quote: string; t: number | null; noEvidence?: boolean };
export type CheckInSuggestions = {
  goalStatus: AiFieldSuggestion<GoalStatus>;
  nextGoal: AiFieldSuggestion<string>;
  phase: AiFieldSuggestion<number>;
  activitiesDone: AiFieldSuggestion<string[]>;
  employerContacts: AiFieldSuggestion<EmployerContacts>;
  obstacles: AiFieldSuggestion<string[]>;
  note: AiFieldSuggestion<string>;
};
/** Fälten AI föreslår, i formulärets ordning. Samlad status finns inte med. */
export const AI_FIELDS = ["goalStatus", "nextGoal", "phase", "activitiesDone", "employerContacts", "obstacles", "note"] as const;
export type AiField = (typeof AI_FIELDS)[number];

/** Underlaget: inspelning i rummet, uppladdad ljudfil, Teams-transkript eller inklistrade anteckningar. */
export const AI_SOURCES = ["recording", "upload", "teams", "notes"] as const;
export type AiSource = (typeof AI_SOURCES)[number];
