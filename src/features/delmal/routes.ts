// Rutter för området delmål (Karims beslut 2026-11-11). Adressen har bara avtalets id (?avtal=) – aldrig namn.
//   /avtal/delmal  katalogen: avtalsansvarig (fliken Avtalet) och systemadministratören (länken på Avtal och konfiguration)
// Delmålen i ett ärende står på deltagarkortet (fliken Händelser och utfall).
import type { RouteDef } from "@/shell/routes";
import { CATALOG_ROLES } from "./api";
import { DelmalKatalogScreen } from "./screens/katalog";

export const routes: RouteDef[] = [
  { path: "/avtal/delmal", title: "Delmål", roles: CATALOG_ROLES, area: "mb", screen: DelmalKatalogScreen },
];
