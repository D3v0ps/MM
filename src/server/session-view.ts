// Svaret från GET /api/session – det klienten bygger sin Session av (src/app/_shell/client-root.tsx).
import type { Actor, Role } from "@/api/roles";
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
  /**
   * Den inloggades egna roller (medlemskap, beslut 2026-10-08): fler än en ger rollväljaren i sidopanelens huvud. Tom när en
   * testare agerar som en testperson (då styr "Agera som") och för deltagaren.
   */
  ownRoles: Role[];
  /** Testmiljöns klocka (testtid), t.ex. "2027-02-01T09:40". */
  testNow?: string | null;
  /**
   * Begränsad testare (src/api/tester-access.ts, räknas på servern): inga priser, belopp, fakturaunderlag, interna mål eller
   * avtalssidan. Styr menyn, startsidan och texten "Visas inte för testare" i skärmarna. Servern lämnar ändå inte ut uppgifterna.
   */
  hidesCommercial: boolean;
};
