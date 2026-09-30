// Pågående testscenario (vilket och vilket steg). Sparas i webbläsaren med samma nyckel som den gamla prototypen.
// Tillståndet ligger på modulnivå så att det överlever rollbyten (då monteras skärmarna och prototypfältet om).
import { useSyncExternalStore } from "react";

export const LS_SCENARIO = "miljonmatch-prototyp-aktivt-scenario";

export type ScenarioState = { active: string | null; step: number };
const NONE: ScenarioState = { active: null, step: 0 };

function read(): ScenarioState {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_SCENARIO) ?? "null") as Partial<ScenarioState> | null;
    if (saved && typeof saved.active === "string") return { active: saved.active, step: Number(saved.step) || 0 };
  } catch {
    /* privat läge eller trasigt värde */
  }
  return NONE;
}

let state: ScenarioState | null = null;
const listeners = new Set<() => void>();
const current = (): ScenarioState => (state ??= typeof localStorage === "undefined" ? NONE : read());

export function setScenario(next: ScenarioState): void {
  state = next;
  try {
    localStorage.setItem(LS_SCENARIO, JSON.stringify({ active: next.active, step: next.step }));
  } catch {
    /* ignoreras */
  }
  listeners.forEach((f) => f());
}

/** Avsluta scenariot (som prototypens MM.stopScenario). */
export const stopScenario = (): void => setScenario({ active: null, step: current().step });

export function useScenarioState(): ScenarioState {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    current,
    () => NONE,
  );
}
