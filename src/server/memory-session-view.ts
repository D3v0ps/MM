// Minneslägets svar på GET /api/session (ren funktion – src/app/api/session/route.ts anropar den, testas i
// memory-session-view.test.ts).
import type { Role } from "@/api/roles";
import { hidesCommercial } from "@/api/tester-access";
import type { Persona } from "@/data/actors";
import type { PersonaOption } from "@/shell/session";
import type { SessionView } from "./session-view";

/**
 * Minnesläget: vald testperson (som /api/dev-session). En simulerad testare (POST /api/dev-session med testerId – bara
 * e2e och utveckling, src/server/runtime.ts) räknas som testare: raden Testmiljö med "Lämna synpunkt" och "Alla synpunkter"
 * visas som i testmiljön (beslut 2026-10-02, punkt 6). Ingen "Agera som"-lista och ingen impersonering här – testpersonen
 * byts i utvecklingsfältet, som behåller testerId. Vanliga testpersoner (utan testerId) är inte testare.
 */
export function memorySessionView(persona: Persona | null, personas: PersonaOption[], ownRoles: Role[] = []): SessionView {
  return {
    backend: "memory",
    environment: "memory",
    authenticated: !!persona,
    persona: persona ? { actor: persona.actor, user: persona.user } : undefined,
    isTester: !!persona?.actor.testerId,
    impersonating: false,
    personas,
    ownRoles,
    hidesCommercial: hidesCommercial(persona?.actor),
  };
}
