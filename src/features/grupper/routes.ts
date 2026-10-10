// Rutter för området grupper (coachmötet 2026-10-09): massanteckningar och administrationen av nivåer, grupper och taggar.
import { GROUPING_READERS } from "@/core/groupings";
import type { RouteDef } from "@/shell/routes";
import { MASS_NOTE_ROLES } from "./api";
import { AnteckningarScreen } from "./screens/anteckningar";
import { GrupperScreen } from "./screens/grupper";

export const routes: RouteDef[] = [
  { path: "/anteckningar", title: "Anteckningar", roles: MASS_NOTE_ROLES, area: "mb", screen: AnteckningarScreen },
  { path: "/grupper", title: "Grupper och nivåer", roles: GROUPING_READERS, area: "mb", screen: GrupperScreen },
];
