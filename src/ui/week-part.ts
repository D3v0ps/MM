"use client";
// Min vecka för den som har flera roller (Karims beslut 7, 2026-10-09): alla rollernas uppgifter på samma sida, i ordning efter
// vad som brådskar. Varje rolls Min vecka (src/features/*/screens/min-vecka.tsx) ritas då som en DEL av sidan i stället för en
// egen sida – WeekPage blir ett avsnitt med rollens rubrik, avsnittens id:n får rolldelens suffix (inga dubbletter) och
// nyckeltalsrutorna (Kpi) rapporterar sin brådska så att sidan kan lägga den mest brådskande delen överst
// (src/features/vecka/screens/min-vecka.tsx). Utan rolldel (en roll) är allt som förut.
import { createContext, useContext, useEffect, useId } from "react";

export type WeekPart = {
  /** Rubriken för rolldelen, t.ex. "Samordning". */
  label: string;
  /** Suffix för avsnittens id:n i delen (t.ex. "ekonom" → "mv-uppgifter-ekonom"). */
  idPrefix: string;
  /** En nyckeltalsruta rapporterar sin brådska (0 = inget, 1 = bevaka, 2 = kräver åtgärd). */
  report(tileId: string, weight: number): void;
};

export const WeekPartContext = createContext<WeekPart | null>(null);
/** Rolldelen skärmen ritas i (null = en egen sida, som för den som har en roll). */
export const useWeekPart = (): WeekPart | null => useContext(WeekPartContext);

/** Id för ett avsnitt på Min vecka – unikt också när flera rollers delar står på samma sida. */
export function useWeekId(): (id: string) => string {
  const part = useWeekPart();
  return (id) => (part ? `${id}-${part.idPrefix}` : id);
}

/** Brådskan för en nyckeltalsruta: "alert" = 2, "watch" = 1, annars 0. */
export const urgencyOf = (tone: "alert" | "watch" | null | undefined): number => (tone === "alert" ? 2 : tone === "watch" ? 1 : 0);

/** Nyckeltalsrutan rapporterar sin brådska till rolldelen (bara när den ritas i en rolldel). */
export function useReportUrgency(tone: "alert" | "watch" | null | undefined) {
  const part = useWeekPart();
  const id = useId();
  const weight = urgencyOf(tone);
  useEffect(() => {
    if (!part) return;
    part.report(id, weight);
    return () => part.report(id, 0);
  }, [part, id, weight]);
}
