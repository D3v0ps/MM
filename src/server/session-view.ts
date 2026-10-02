// Svaret från GET /api/session – det klienten bygger sin Session av (src/app/_shell/client-root.tsx).
import type { Actor } from "@/api/roles";
import type { PersonaOption, SessionUser } from "@/shell/session";

export type SessionView = {
  backend: "memory" | "supabase";
  /** "memory" = utvecklingsläget, "staging" = testmiljön (påhittade testdata), "production" = drift. */
  environment: "memory" | "staging" | "production";
  authenticated: boolean;
  persona?: { actor: Actor; user: SessionUser };
  /** Den inloggades eget namn när en testare agerar som en testperson. */
  selfName?: string;
  isTester: boolean;
  impersonating?: boolean;
  /** Utvecklingsläget: alla testpersoner. Testmiljön: testarens valbara testpersoner. Annars tom. */
  personas: PersonaOption[];
  /** Testmiljöns klocka (testtid), t.ex. "2027-02-01T09:40". */
  testNow?: string | null;
};
