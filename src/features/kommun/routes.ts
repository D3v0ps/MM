// Rutter för området kommun – kommunens portal (rutt-tabellen i docs/ARKITEKTUR.md, prototypens kom.*-vyer).
// Portallayouten (area "portal") har ingen meny på inloggningen och på handläggarens startsida.
// Kommunen har bara rollen handläggare (beslut 2026-10-07, synpunkt #14): chefens sidor (beställarrapporten, resultatfilen
// och rapporterna från Miljonbemanning) är borttagna. De gamla adresserna leder vidare till startsidan.
import { CUSTOMER_ROLES } from "@/api/roles";
import { redirectScreen } from "@/shell/redirect";
import type { RouteDef } from "@/shell/routes";
import { PortalOrderScreen } from "./screens/bestall";
import { PortalDeltagareScreen } from "./screens/deltagare";
import { PortalLoginScreen } from "./screens/logga-in";
import { PortalProfileScreen } from "./screens/mina-uppgifter";
import { PortalRapporterScreen } from "./screens/rapporter";
import { PortalStartScreen } from "./screens/start";

const toStart = redirectScreen("/portal");

export const routes: RouteDef[] = [
  { path: "/portal/logga-in", title: "Logga in", roles: CUSTOMER_ROLES, area: "portal", screen: PortalLoginScreen, public: true },
  { path: "/portal/bestall", title: "Beställ ny insats", roles: CUSTOMER_ROLES, area: "portal", screen: PortalOrderScreen },
  { path: "/portal/deltagare/:caseId?", title: (p) => (p.caseId ? "Deltagare" : "Mina deltagare"), roles: CUSTOMER_ROLES, area: "portal", screen: PortalDeltagareScreen },
  // Med reportId: rapportsidan (PortalReport sätter rubriken med period som titel).
  { path: "/portal/rapporter/:reportId?", title: "Rapporter och meddelanden", roles: CUSTOMER_ROLES, area: "portal", screen: PortalRapporterScreen },
  // Namn, telefon och enhet (självregistrerade handläggare fyller i dem här, ?forsta=1 efter första inloggningen).
  { path: "/portal/mina-uppgifter", title: "Mina uppgifter", roles: CUSTOMER_ROLES, area: "portal", screen: PortalProfileScreen },
  // Gamla adresser för kommunens chef (borttagen roll) – leder till startsidan.
  { path: "/portal/bestallarrapport", title: "Start", roles: CUSTOMER_ROLES, area: "portal", screen: toStart },
  { path: "/portal/resultat/rapporter/:savedReportId?", title: "Start", roles: CUSTOMER_ROLES, area: "portal", screen: toStart },
  { path: "/portal/resultat", title: "Start", roles: CUSTOMER_ROLES, area: "portal", screen: toStart },
  { path: "/portal", title: "Start", roles: CUSTOMER_ROLES, area: "portal", screen: PortalStartScreen },
];
