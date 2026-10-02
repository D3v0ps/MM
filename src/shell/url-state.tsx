"use client";
// Listornas val (filter, sortering, antal visade rader) ligger i adressen, så att Tillbaka och omladdning visar samma lista.
// Bara koder, id:n och siffror i adressen (CLAUDE.md). Söktext kan vara ett namn: den ligger bara i minnet (useMemoryState) –
// aldrig i adressen och aldrig i webblagring – och försvinner vid omladdning.
import { useCallback, useState } from "react";
import { useNav, type Nav } from "./nav";
import { useSession } from "./session";

/** Adressens query just nu – också efter en replace tidigare i samma klick (nav.query är från senaste renderingen). */
function liveQuery(nav: Nav): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams(nav.query);
  const hashRouted = nav.href("/").startsWith("#");
  const raw = hashRouted ? (window.location.hash.split("?")[1] ?? "") : window.location.search;
  return new URLSearchParams(raw);
}

export type QueryPatch = Record<string, string | number | boolean | null | undefined>;

/**
 * Ändra några parametrar i adressen (replace – ingen ny historikpost). null, undefined, false och "" tar bort parametern,
 * true skrivs som "1". Anroparen tar själv bort standardvärden (skicka null), så att adressen hålls kort.
 */
export function useQueryPatch(): (patch: QueryPatch) => void {
  const nav = useNav();
  return useCallback(
    (patch: QueryPatch) => {
      const q = liveQuery(nav);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === false || v === "") q.delete(k);
        else q.set(k, v === true ? "1" : String(v));
      }
      const s = q.toString();
      nav.replace(s ? `${nav.path}?${s}` : nav.path);
    },
    [nav],
  );
}

/** Ett värde ur adressen som måste vara ett av de tillåtna (annars standardvärdet). */
export function pick<T extends string>(query: URLSearchParams, name: string, allowed: readonly T[], fallback: T): T {
  const v = query.get(name);
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Ett positivt heltal ur adressen (t.ex. ?visa=100), annars standardvärdet. */
export function pickInt(query: URLSearchParams, name: string, fallback: number, max = 100_000): number {
  const v = query.get(name);
  if (!v || !/^\d{1,6}$/.test(v)) return fallback;
  const n = Number(v);
  return n > 0 && n <= max ? n : fallback;
}

const memory = new Map<string, unknown>();

/**
 * Tillstånd som ligger kvar i minnet när man lämnar sidan och kommer tillbaka (t.ex. söktext), per användare och sida.
 * Aldrig i adressen och aldrig i webblagring. Rensas när sidan laddas om.
 */
export function useMemoryState<T>(key: string, initial: T): [T, (v: T) => void] {
  const nav = useNav();
  const { actor } = useSession();
  const k = `${actor.userId}|${nav.path}|${key}`;
  const [v, setV] = useState<T>(() => (memory.has(k) ? (memory.get(k) as T) : initial));
  const set = useCallback(
    (x: T) => {
      memory.set(k, x);
      setV(x);
    },
    [k],
  );
  return [v, set];
}
