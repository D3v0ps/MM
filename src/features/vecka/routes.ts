// Rutter för området vecka: Min vecka (/min-vecka, prototypens coach.minvecka) – startsidan för alla MB-roller
// (beslut 2026-10-06). /start (samordnarens och avtalsansvarigs gamla startsida) leder hit (src/features/inkorg/routes.ts).
import { SUPPLIER_ROLES } from "@/api/roles";
import type { RouteDef } from "@/shell/routes";
import { MinVeckaScreen } from "./screens/min-vecka";

export const routes: RouteDef[] = [{ path: "/min-vecka", title: "Min vecka", roles: SUPPLIER_ROLES, area: "mb", screen: MinVeckaScreen }];
