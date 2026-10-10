// Rutter för området grupper (coachmötet 2026-10-09): massanteckningar och administrationen av nivåer, grupper och taggar.
import { isDormantRole, type Role } from "@/api/roles";
import { GROUPING_READERS } from "@/core/groupings";
import type { RouteDef } from "@/shell/routes";
import { MASS_NOTE_ROLES } from "./api";
import { AnteckningarScreen } from "./screens/anteckningar";
import { GrupperScreen } from "./screens/grupper";

// Den vilande rollen handledare (Karims beslut 2026-10-09) når ingen sida – hanterarna och RLS behåller den (src/api/roles.ts).
const pages = (roles: readonly Role[]) => roles.filter((r) => !isDormantRole(r));

export const routes: RouteDef[] = [
  { path: "/anteckningar", title: "Anteckningar", roles: pages(MASS_NOTE_ROLES), area: "mb", screen: AnteckningarScreen },
  { path: "/grupper", title: "Grupper och nivåer", roles: pages(GROUPING_READERS), area: "mb", screen: GrupperScreen },
];
