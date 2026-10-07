"use client";
// Gamla adresser som leder vidare (samma i appen och prototypen): skärmen byter adress med nav.replace – ingen ny
// historikpost, och valen i adressen (query) följer med. Används av /start, som gått upp i Min vecka (beslut 2026-10-06).
import { useEffect, type ComponentType } from "react";
import { useNav } from "./nav";
import type { ScreenProps } from "./routes";

/** Skärm som leder vidare till sökvägen to (query behålls). */
export function redirectScreen(to: string): ComponentType<ScreenProps> {
  function Redirect({ query }: ScreenProps) {
    const nav = useNav();
    const qs = query.toString();
    useEffect(() => {
      nav.replace(qs ? `${to}?${qs}` : to);
    }, [nav, qs]);
    return null;
  }
  Redirect.displayName = `Redirect(${to})`;
  return Redirect;
}
