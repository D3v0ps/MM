// Kontrakt för området puls: deltagarens pulsmätning via engångslänk (/puls/:token?, publik, ingen inloggning).
// Källa: prototyp/src/views/admin.js (puls.svar och pulse.submit).
//
//   puls.link    -> PulseLinkView  länkens läge (öppen, använd, utgången eller saknas), språk och giltighetstid – inga personuppgifter
//   puls.submit  (prototypens pulse.submit) svaret sparas, länken förbrukas. "Ja" på fråga 5 blir en uppgift till samordnaren.
//
// Länken identifieras med sin token (sökvägen /puls/<token>); token lagras aldrig i klartext, bara som hash (pulse_invites.tokenHash).
// Utan token visas prototypens exempellänk (testdatat, demo_tags "pi-demo") – den finns inte i produktionsdatabasen.
// Deltagaren ser aldrig ärendenummer, namn eller coach. Länken skickas aldrig till skyddade ärenden (SPEC §7, CLAUDE.md punkt 8).
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import { PULSE_LANGS, type PulseLang } from "./texts";

export type PulseLinkState = "open" | "used" | "expired" | "missing";
export type PulseLinkView = {
  state: PulseLinkState;
  /** Språket länken skickades på (deltagaren kan byta). */
  language: PulseLang;
  /** Antal dagar länken gäller. */
  days: number;
  /** Var insatsen hålls (kontoret, t.ex. "Alby") – visas i sidhuvudet. */
  location: string;
};
/** Token ur länken. Ett felaktigt format visas som "Länken fungerar inte" (inte som ett tekniskt fel). */
const TokenSchema = z.string().max(300);
export const pulseLink = query("puls.link", z.object({ token: TokenSchema.optional() })).returns<PulseLinkView>();

const Score = z.number().int().nullable();
export const pulseSubmit = command("puls.submit", z.object({
  token: TokenSchema.optional(),
  language: z.enum(PULSE_LANGS),
  answers: z.object({
    q1: Score,
    q2: Score,
    q3: Score,
    q4: z.string().max(20).nullable(),
    q5: z.string().max(5).nullable(),
  }),
  text: z.string().max(500),
})).returns<Result<object, "not_found" | "used" | "expired" | "incomplete">>();
