// Rutter för området praktik: arbetsgivarregistret och praktikplatserna (prototypens praktik.arbetsgivare).
import type { RouteDef } from "@/shell/routes";
import { PraktikScreen } from "./screens/praktik";

export const routes: RouteDef[] = [
  {
    path: "/praktik/:employerId?",
    // Arbetsgivarens namn visas som sidrubrik; titeln kan inte hämta data och säger därför "Arbetsgivare".
    title: (p) => (p.employerId ? "Arbetsgivare" : "Arbetsgivare och praktik"),
    roles: ["samordnare", "avtalsansvarig", "coach", "handledare"],
    area: "mb",
    screen: PraktikScreen,
  },
];
