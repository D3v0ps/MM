"use client";
// Vilken miljö skärmarna körs i. Skärmarna ska se likadana ut i båda – bara prototypens förklaringar skiljer.
import { createContext, useContext, type ReactNode } from "react";

export type RuntimeMode = "demo" | "app";
const RuntimeContext = createContext<RuntimeMode>("app");

export function RuntimeProvider({ mode, children }: { mode: RuntimeMode; children: ReactNode }) {
  return <RuntimeContext.Provider value={mode}>{children}</RuntimeContext.Provider>;
}
export const useRuntime = (): RuntimeMode => useContext(RuntimeContext);

/** Visas bara i prototypen: förklaringar av vad som är simulerat och genvägar mellan perspektiv. */
export function DemoOnly({ children }: { children: ReactNode }) {
  return useRuntime() === "demo" ? <>{children}</> : null;
}
