"use client";
// Dagens datum för Min vecka (veckodagen och veckonumret i ingressen). Klockan kommer från servern (session.ping) – i
// prototypen och minnesläget demoklockan. Används av rollernas Min vecka som inte får klockan i sin egen fråga.
import { dayOf, type LocalDate } from "@/core/time";
import { sessionPing } from "@/features/session/api";
import { useQuery } from "@/shell/backend";

/** Dagens datum, eller null medan klockan hämtas. */
export function useWeekToday(): LocalDate | null {
  const now = useQuery(sessionPing, {}).data?.now;
  return now ? dayOf(now) : null;
}
