// Rutter för sessionen.
import { ROLES } from "@/api/roles";
import type { RouteDef } from "@/shell/routes";
import { UiShowcase, UiShowcasePortal, UiShowcasePuls } from "@/ui/__showcase";
import { DiagnosScreen } from "./screens";

export const routes: RouteDef[] = [
  { path: "/diagnos", title: "Diagnos", roles: ROLES, area: "mb", screen: DiagnosScreen },
  // Tillfällig granskningssida för komponentbiblioteket (src/ui/__showcase.tsx).
  { path: "/ui", title: "Komponenter", roles: ROLES, area: "mb", screen: UiShowcase },
  { path: "/ui/portal", title: "Komponenter i kommunportalen", roles: ROLES, area: "portal", screen: UiShowcasePortal },
  { path: "/ui/puls", title: "Komponenter i pulsmätningen", roles: ROLES, area: "puls", screen: UiShowcasePuls },
];
