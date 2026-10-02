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

/**
 * Text ur avtalskonfigurationen eller testdatat som nämner prototypen (t.ex. "Preliminärt i prototypen: …"). I appen tas
 * orden om prototypen bort, så att ingen utvecklartext syns för användarna. Prototypen visar texten som den är.
 */
export function withoutPrototypeWords(text: string, mode: RuntimeMode): string {
  if (mode === "demo") return text;
  return text.replace(/^I prototypen:\s*/i, "Tills vidare: ").replace(/\s+i prototypen\b/gi, "");
}

/** Samma som withoutPrototypeWords, som komponent (för texter i listor och tabeller). */
export function ProtoText({ children }: { children: string }) {
  return <>{withoutPrototypeWords(children, useRuntime())}</>;
}
