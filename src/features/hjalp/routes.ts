// Rutter för hjälpsidorna: lathunden för kollegor i MB:s arbetsyta och lathunden med mejlmallen i kommunens portal.
// Öppna för inloggade i respektive område – inga nya behörigheter.
import { CUSTOMER_ROLES, STAFF_ROLES } from "@/api/roles";
import type { RouteDef } from "@/shell/routes";
import { HJALP_TITLE, HjalpScreen, PortalHjalpScreen } from "./screens/hjalp";

export const HELP_PATH = "/hjalp";
export const PORTAL_HELP_PATH = "/portal/hjalp";

export const routes: RouteDef[] = [
  { path: HELP_PATH, title: HJALP_TITLE, roles: STAFF_ROLES, area: "mb", screen: HjalpScreen },
  { path: PORTAL_HELP_PATH, title: HJALP_TITLE, roles: CUSTOMER_ROLES, area: "portal", screen: PortalHjalpScreen },
];
