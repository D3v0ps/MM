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

// TILLFÄLLIG (bara för att testa PortalReport innan området kommun bygger /portal/rapporter) – tas bort.
import { PortalReport } from "./components/portal-report";
import type { ScreenProps } from "@/shell/routes";
function TmpPortalReport({ params, query }: ScreenProps) {
  return <PortalReport reportId={params.reportId} from={query.get("fran")} />;
}
routes.push({ path: "/portal/rapporter/:reportId", title: "Rapport", roles: ["kommun_handlaggare", "kommun_chef"], area: "portal", screen: TmpPortalReport });
