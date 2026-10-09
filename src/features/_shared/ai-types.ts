// Typer för AI-förslagen i veckoavstämningen (kontrakt – importeras av skärmar via src/features/coach/api.ts).
// Den simulerade AI:n finns i ai-sim.ts (bara för hanterare).
import type { AiConsentStatus, EmployerContacts, GoalStatus } from "@/data/schema";

/** Ett förslag med belägg. t = sekunder in i samtalet (null för inklistrade anteckningar). */
export type AiFieldSuggestion<T> = { value: T | null; quote: string; t: number | null; noEvidence?: boolean };
export type CheckInSuggestions = {
  /** Förslag till coachens kommentar om närvaron (fri text). Närvarostatusen registreras i Närvaro – aldrig av AI. */
  attendanceComment: AiFieldSuggestion<string>;
  goalStatus: AiFieldSuggestion<GoalStatus>;
  nextGoal: AiFieldSuggestion<string>;
  phase: AiFieldSuggestion<number>;
  activitiesDone: AiFieldSuggestion<string[]>;
  employerContacts: AiFieldSuggestion<EmployerContacts>;
  obstacles: AiFieldSuggestion<string[]>;
  note: AiFieldSuggestion<string>;
};
/** Fälten AI föreslår, i formulärets ordning (Närvaro, Fas, Veckomål, Aktiviteter, Arbetsgivarkontakter, Hinder, Anteckning). Samlad status finns inte med. */
export const AI_FIELDS = ["attendanceComment", "phase", "goalStatus", "nextGoal", "activitiesDone", "employerContacts", "obstacles", "note"] as const;
export type AiField = (typeof AI_FIELDS)[number];

/** Underlaget: inspelning i rummet, uppladdad ljudfil, Teams-transkript eller inklistrade anteckningar. */
export const AI_SOURCES = ["recording", "upload", "teams", "notes"] as const;
export type AiSource = (typeof AI_SOURCES)[number];

/**
 * Inspelning erbjuds som huvudväg ("Spela in mötet") så länge deltagaren inte har sagt nej eller återkallat samtycket.
 * Är frågan inte ställd ställs den i mötet. Servern spärrar alltid inspelning utan registrerat samtycke – det här styr bara knapparna.
 */
export const recordingOffered = (consent: AiConsentStatus | null | undefined): boolean => consent !== "declined" && consent !== "revoked";
