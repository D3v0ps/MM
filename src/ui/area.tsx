"use client";
// Vilken layout skärmen visas i. Komponenter som renderas utanför sidan (dialoger via Radix Portal) läser den
// för att få kommunportalens större text (variant `portal:` i globals.css matchar data-area="portal").
import { createContext, useContext, type ReactNode } from "react";

export type LayoutArea = "mb" | "portal" | "puls" | "om" | "auth";
const AreaContext = createContext<LayoutArea>("mb");

export function AreaProvider({ area, children }: { area: LayoutArea; children: ReactNode }) {
  return <AreaContext.Provider value={area}>{children}</AreaContext.Provider>;
}
export const useArea = (): LayoutArea => useContext(AreaContext);
/** data-area-attribut för element som renderas utanför layouten (t.ex. i en Radix Portal). */
export const useAreaAttr = (): { "data-area"?: "portal" } => (useArea() === "portal" ? { "data-area": "portal" } : {});
