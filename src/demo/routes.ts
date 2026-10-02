// Prototypens egna sidor (start och scenarier, genomgång av feedback, öppna frågor). Finns inte i riktiga appen.
import { ROLES } from "@/api/roles";
import type { RouteDef } from "@/shell/routes";
import { FragorScreen } from "./screens/fragor";
import { GenomgangScreen } from "./screens/genomgang";
import { OmStartScreen } from "./screens/start";

export const DEMO_ROUTES: RouteDef[] = [
  { path: "/om", title: "Om prototypen", roles: ROLES, area: "om", screen: OmStartScreen },
  { path: "/om/genomgang", title: "Genomgång av feedback", roles: ROLES, area: "om", screen: GenomgangScreen },
  { path: "/om/fragor", title: "Öppna frågor", roles: ROLES, area: "om", screen: FragorScreen },
];
