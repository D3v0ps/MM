// Rutter för området aktiviteter: gruppaktiviteterna och aktivitetsvyn (coachmötet 2026-10-09). /aktiviteter/ny före :id.
// Alla på Miljonbemanning utom ekonomen läser ("alla ser alla"); de som arbetar i ärendena skapar nya.
import type { RouteDef } from "@/shell/routes";
import { AktivitetScreen } from "./screens/aktivitet";
import { AktiviteterScreen } from "./screens/lista";
import { NyAktivitetScreen } from "./screens/ny";

const READERS = ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin"] as const;
const WRITERS = ["samordnare", "avtalsansvarig", "coach", "handledare"] as const;

export const routes: RouteDef[] = [
  { path: "/aktiviteter", title: "Aktiviteter", roles: READERS, area: "mb", screen: AktiviteterScreen },
  { path: "/aktiviteter/ny", title: "Ny aktivitet", roles: WRITERS, area: "mb", screen: NyAktivitetScreen },
  { path: "/aktiviteter/:id", title: "Aktivitet", roles: READERS, area: "mb", screen: AktivitetScreen },
];
