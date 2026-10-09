// Rutter för området inkorg (rutt-tabellen i docs/ARKITEKTUR.md): prototypens sam.start, sam.inkorg och sam.deadlines.
// Startsidan /start har gått upp i Min vecka (beslut 2026-10-06): adressen leder vidare till /min-vecka, där samordnarens och
// avtalsansvarigs Min vecka (screens/min-vecka.tsx) visas. Sedan 2026-10-08 (skarp drift, tom databas) leder /start rätt för
// alla MB-roller – alla börjar på Min vecka, och en gammal länk eller ett bokmärke ska inte ge "Du har inte behörighet".
import { SUPPLIER_ROLES } from "@/api/roles";
import type { RouteDef } from "@/shell/routes";
import { redirectScreen } from "@/shell/redirect";
import { ForfallerScreen } from "./screens/forfaller";
import { InkorgScreen } from "./screens/inkorg";
import { RegistreraScreen } from "./screens/registrera";

export const routes: RouteDef[] = [
  { path: "/start", title: "Min vecka", roles: SUPPLIER_ROLES, area: "mb", screen: redirectScreen("/min-vecka") },
  // keepMounted: valt mejl i adressen (/inkorg/<id>) byter inte sida – listan och skrollen står kvar.
  // Registrera beställning (beslut 4a, 2026-10-08): mejl, telefon eller annan väg. Före det valfria mejl-id:t i inkorgen.
  { path: "/inkorg/registrera", title: "Registrera beställning", roles: ["samordnare", "avtalsansvarig"], area: "mb", screen: RegistreraScreen },
  { path: "/inkorg/:emailId?", title: "Avropsinkorg", roles: ["samordnare", "avtalsansvarig"], area: "mb", screen: InkorgScreen, keepMounted: true },
  { path: "/forfaller", title: "Förfaller i dag och denna vecka", roles: ["samordnare", "avtalsansvarig", "chef"], area: "mb", screen: ForfallerScreen },
];
