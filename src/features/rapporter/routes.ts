// Rutter för området rapporter (rutt-tabellen i docs/ARKITEKTUR.md). Kommunen ser rapporterna i portalen
// (/portal/rapporter/:reportId, området kommun – med PortalReport från components/portal-report.tsx).
// Rapportbyggaren (rapporter steg 4): samordnare, avtalsansvarig och chef. "ny" och "resultatfil" står före :savedReportId.
// Den interna månadsrapporten (/manadsrapport, Karims beslut 2026-11-18): samordnare, avtalsansvarig, coach och chef.
import type { Role } from "@/api/roles";
import type { RouteDef } from "@/shell/routes";
import { ByggScreen } from "./screens/bygg";
import { ByggListaScreen } from "./screens/bygg-lista";
import { ResultatfilMbScreen } from "./screens/bygg-resultatfil";
import { SparadScreen } from "./screens/bygg-sparad";
import { RapporterListaScreen } from "./screens/lista";
import { RapportVisaScreen } from "./screens/visa";
import { ManadsrapportScreen } from "./screens/manad";
import { MANAD_ROLES } from "./manad/api";

const BUILDERS: readonly Role[] = ["samordnare", "avtalsansvarig", "chef"];

export const routes: RouteDef[] = [
  { path: "/rapporter", title: "Rapporter", roles: ["samordnare", "avtalsansvarig", "coach", "chef"], area: "mb", screen: RapporterListaScreen },
  // Titeln är "Rapport" – rubriken med period (t.ex. "Månadsrapport januari 2027") står på sidan (URL:en innehåller bara id:t).
  { path: "/rapporter/:reportId", title: "Rapport", roles: ["samordnare", "avtalsansvarig", "coach", "chef"], area: "mb", screen: RapportVisaScreen },
  // Den interna månadsrapporten (Karims beslut 2026-11-18): samordnare, avtalsansvarig, coach och chef – aldrig ekonomen eller kommunen.
  // ?manad=YYYY-MM&omrade=<kod>&avtal=<id>&sortera=… – bara koder och id:n i adressen.
  { path: "/manadsrapport", title: "Intern månadsrapport", roles: MANAD_ROLES, area: "mb", screen: ManadsrapportScreen },
  { path: "/rapportbyggare", title: "Rapportbyggare", roles: BUILDERS, area: "mb", screen: ByggListaScreen },
  { path: "/rapportbyggare/ny", title: "Ny rapport", roles: BUILDERS, area: "mb", screen: ByggScreen },
  { path: "/rapportbyggare/resultatfil", title: "Resultatfil för hela avtalet", roles: BUILDERS, area: "mb", screen: ResultatfilMbScreen },
  // Titeln är "Sparad rapport" – rapportens namn står på sidan (URL:en innehåller bara id:t).
  { path: "/rapportbyggare/:savedReportId", title: "Sparad rapport", roles: BUILDERS, area: "mb", screen: SparadScreen },
];
