// Rutter för området kommun – kommunens portal (rutt-tabellen i docs/ARKITEKTUR.md, prototypens kom.*-vyer).
// Portallayouten (area "portal") har ingen meny på inloggningen och på handläggarens startsida.
import { CUSTOMER_ROLES } from "@/api/roles";
import type { RouteDef } from "@/shell/routes";
import { PortalOrderScreen } from "./screens/bestall";
import { PortalChefScreen } from "./screens/chef";
import { PortalDeltagareScreen } from "./screens/deltagare";
import { PortalLoginScreen } from "./screens/logga-in";
import { PortalRapporterScreen } from "./screens/rapporter";
import { PortalStartScreen } from "./screens/start";

export const routes: RouteDef[] = [
  { path: "/portal/logga-in", title: "Logga in", roles: CUSTOMER_ROLES, area: "portal", screen: PortalLoginScreen, public: true },
  { path: "/portal/bestall", title: "Beställ ny insats", roles: ["kommun_handlaggare"], area: "portal", screen: PortalOrderScreen },
  // Listan heter "Enhetens deltagare" för kommunens chef (skärmen sätter titeln när rollen är känd).
  { path: "/portal/deltagare/:caseId?", title: (p) => (p.caseId ? "Deltagare" : "Mina deltagare"), roles: CUSTOMER_ROLES, area: "portal", screen: PortalDeltagareScreen },
  // Med reportId: rapportsidan (PortalReport sätter rubriken med period som titel).
  { path: "/portal/rapporter/:reportId?", title: "Rapporter och meddelanden", roles: CUSTOMER_ROLES, area: "portal", screen: PortalRapporterScreen },
  { path: "/portal/bestallarrapport", title: "Beställarrapport", roles: ["kommun_chef"], area: "portal", screen: PortalChefScreen },
  { path: "/portal", title: "Start", roles: ["kommun_handlaggare"], area: "portal", screen: PortalStartScreen },
];
