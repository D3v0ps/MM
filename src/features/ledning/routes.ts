// Rutter för området ledning (prototypens chef.oversikt och chef.avvikelser).
import type { RouteDef } from "@/shell/routes";
import { AvvikelserScreen } from "./screens/avvikelser";
import { LedningScreen } from "./screens/ledning";

export const routes: RouteDef[] = [
  { path: "/ledning", title: "Ledningsvy", roles: ["chef"], area: "mb", screen: LedningScreen },
  {
    path: "/avtalsavvikelser/:id?",
    title: (p) => (p.id ? "Avtalsavvikelse" : "Avtalsavvikelser"),
    roles: ["chef", "avtalsansvarig", "samordnare"],
    area: "mb",
    screen: AvvikelserScreen,
  },
];
