// Rutter för området puls: deltagarens pulsmätning via engångslänk (prototypens puls.svar). Publik – ingen inloggning.
import type { RouteDef } from "@/shell/routes";
import { PulsScreen } from "./screens/puls";

export const routes: RouteDef[] = [{ path: "/puls/:token?", title: "Pulsmätning", roles: ["deltagare"], area: "puls", screen: PulsScreen, public: true }];
