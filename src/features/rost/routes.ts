// Rutter för området röst: deltagarens inspelningslänk (/rost/:token?, publik – ingen inloggning, samma layout som pulslänken).
// Utan token visas testdatats exempellänk (demo_tags "vl-demo") – den finns inte i produktionsdatabasen.
import type { RouteDef } from "@/shell/routes";
import { RostScreen } from "./screens/rost";

export const routes: RouteDef[] = [{ path: "/rost/:token?", title: "Röstmeddelande", roles: ["deltagare"], area: "puls", screen: RostScreen, public: true }];
