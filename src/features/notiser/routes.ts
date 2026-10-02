// Rutter för området notiser (prototypens vy notiser – all MB-personal ser sina egna notiser).
import { SUPPLIER_ROLES } from "@/api/roles";
import type { RouteDef } from "@/shell/routes";
import { NotiserScreen } from "./screens/notiser";

export const routes: RouteDef[] = [{ path: "/notiser", title: "Notiser", roles: SUPPLIER_ROLES, area: "mb", screen: NotiserScreen }];
