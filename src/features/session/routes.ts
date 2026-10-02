// Rutter för sessionen.
import { ROLES } from "@/api/roles";
import type { RouteDef } from "@/shell/routes";
import { DiagnosScreen } from "./screens";
import { LoggaInScreen } from "./screens/logga-in";

export const routes: RouteDef[] = [
  // Inloggning för Miljonbemannings personal (e-post + kod; Microsoft-inloggning kommer senare). Kommunen: /portal/logga-in.
  { path: "/logga-in", title: "Logga in", roles: ROLES, area: "auth", screen: LoggaInScreen, public: true },
  { path: "/diagnos", title: "Diagnos", roles: ROLES, area: "mb", screen: DiagnosScreen },
];
