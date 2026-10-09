// Rutter för området vecka: Min vecka (/min-vecka, prototypens coach.minvecka) – startsidan för alla MB-roller
// (beslut 2026-10-06). Rollen handledare är vilande (beslut 2026-10-09) och når inga sidor (STAFF_ROLES). /start (samordnarens och avtalsansvarigs gamla startsida) leder hit (src/features/inkorg/routes.ts).
import { STAFF_ROLES } from "@/api/roles";
import type { RouteDef } from "@/shell/routes";
import { MinVeckaScreen } from "./screens/min-vecka";

export const routes: RouteDef[] = [{ path: "/min-vecka", title: "Min vecka", roles: STAFF_ROLES, area: "mb", screen: MinVeckaScreen }];
