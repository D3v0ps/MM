// Rutter för området inkorg (rutt-tabellen i docs/ARKITEKTUR.md): prototypens sam.start, sam.inkorg och sam.deadlines.
import type { RouteDef } from "@/shell/routes";
import { ForfallerScreen } from "./screens/forfaller";
import { InkorgScreen } from "./screens/inkorg";
import { StartScreen } from "./screens/start";

export const routes: RouteDef[] = [
  { path: "/start", title: "Startsida", roles: ["samordnare", "avtalsansvarig"], area: "mb", screen: StartScreen },
  { path: "/inkorg/:emailId?", title: "Avropsinkorg", roles: ["samordnare", "avtalsansvarig"], area: "mb", screen: InkorgScreen },
  { path: "/forfaller", title: "Förfaller i dag och denna vecka", roles: ["samordnare", "avtalsansvarig", "chef"], area: "mb", screen: ForfallerScreen },
];
