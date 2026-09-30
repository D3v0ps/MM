// Rutter för området rapporter (rutt-tabellen i docs/ARKITEKTUR.md). Kommunen ser rapporterna i portalen
// (/portal/rapporter/:reportId, området kommun – med PortalReport från components/portal-report.tsx).
import type { RouteDef } from "@/shell/routes";
import { RapporterListaScreen } from "./screens/lista";
import { RapportVisaScreen } from "./screens/visa";

export const routes: RouteDef[] = [
  { path: "/rapporter", title: "Rapporter", roles: ["samordnare", "avtalsansvarig", "coach", "chef"], area: "mb", screen: RapporterListaScreen },
  // Titeln är "Rapport" – rubriken med period (t.ex. "Månadsrapport januari 2027") står på sidan (URL:en innehåller bara id:t).
  { path: "/rapporter/:reportId", title: "Rapport", roles: ["samordnare", "avtalsansvarig", "coach", "handledare", "chef"], area: "mb", screen: RapportVisaScreen },
];
