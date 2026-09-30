// Kontrakt: prototypens egna frågor. Registreras bara i prototypen (src/demo/handlers.ts importeras av src/demo/main.tsx).
import { z } from "zod";
import { query } from "@/api/contract";

export type DemoReportRef = { id: string; caseId: string; kind: string; month: string | null };

/** Uppslag som scenarierna behöver för att hitta rätt sökväg. Innehåller bara id:n – inga personuppgifter. */
export type DemoRefs = {
  /** Taggade ärenden i testdatat (prototypens S.script): tagg -> ärende-id. */
  cases: Record<string, string>;
  /** Första avstämningen med AI-utkast per taggat ärende (ärende-id -> avstämnings-id). */
  aiDraftCheckIns: Record<string, string>;
  /** Rapporter för de taggade ärendena, i tabellens ordning. */
  reports: DemoReportRef[];
};

export const demoRefs = query("demo.refs", z.object({})).returns<DemoRefs>();

export const EMPTY_REFS: DemoRefs = { cases: {}, aiDraftCheckIns: {}, reports: [] };
