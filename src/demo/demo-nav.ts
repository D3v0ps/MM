"use client";
// Navigering i prototypen: byt roll (testperson) och öppna en sökväg i samma steg, och kör scenariosteg.
import { useCallback } from "react";
import type { Role } from "@/api/roles";
import { useQueryRunner } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import { useSession } from "@/shell/session";
import { demoRefs, EMPTY_REFS } from "./api";
import { fullPath } from "./paths";
import { demoRole } from "./roles";
import { needsRefs, scenarioById, stepPath } from "./scenarios";
import { setScenario, stopScenario } from "./scenario-store";

/** Visa prototypen som rollens testperson och öppna sökvägen (som den gamla prototypens MM.nav(view, params, { role })). */
export function useGoAs() {
  const session = useSession();
  const nav = useNav();
  return useCallback(
    (role: Role, to: string) => {
      const personaId = demoRole(role).personaId;
      const same = role === session.actor.role && (!personaId || session.actor.userId === personaId);
      if (!same) session.switchRole?.(role, personaId ?? undefined);
      if (!same || fullPath(nav.path, nav.query) !== to) nav.push(to);
    },
    [session, nav],
  );
}

/** Starta, byt steg i och avsluta testscenarier. */
export function useScenarioActions() {
  const goAs = useGoAs();
  const run = useQueryRunner();
  const go = useCallback(
    async (id: string, i: number) => {
      const def = scenarioById(id);
      if (!def) return;
      const step = Math.max(0, Math.min(def.steps.length - 1, i));
      setScenario({ active: id, step });
      const st = def.steps[step];
      // Taggade ärenden och rapporter slås upp när steget öppnas (de kan ha skapats under scenariot).
      const refs = needsRefs(st) ? await run(demoRefs, {}).catch(() => EMPTY_REFS) : EMPTY_REFS;
      goAs(st.role, stepPath(st, refs));
    },
    [goAs, run],
  );
  return { start: (id: string, step = 0) => void go(id, step), gotoStep: (id: string, i: number) => void go(id, i), stop: stopScenario };
}
