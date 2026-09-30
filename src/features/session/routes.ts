// Rutter för sessionen.
import { ROLES } from "@/api/roles";
import type { RouteDef } from "@/shell/routes";
import { DiagnosScreen } from "./screens";

export const routes: RouteDef[] = [{ path: "/diagnos", title: "Diagnos", roles: ROLES, area: "mb", screen: DiagnosScreen }];
