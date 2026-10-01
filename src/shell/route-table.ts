// Alla rutter i appen. Ordningen spelar roll: mer specifika mönster före generella.
import type { RouteDef } from "./routes";
import { routes as inkorg } from "@/features/inkorg/routes";
import { routes as arenden } from "@/features/arenden/routes";
import { routes as coach } from "@/features/coach/routes";
import { routes as rapporter } from "@/features/rapporter/routes";
import { routes as ledning } from "@/features/ledning/routes";
import { routes as ekonomi } from "@/features/ekonomi/routes";
import { routes as kommun } from "@/features/kommun/routes";
import { routes as admin } from "@/features/admin/routes";
import { routes as praktik } from "@/features/praktik/routes";
import { routes as puls } from "@/features/puls/routes";
import { routes as rost } from "@/features/rost/routes";
import { routes as notiser } from "@/features/notiser/routes";
import { routes as session } from "@/features/session/routes";

export const APP_ROUTES: readonly RouteDef[] = [
  ...session,
  ...inkorg,
  ...arenden,
  ...coach,
  ...rapporter,
  ...ledning,
  ...ekonomi,
  ...kommun,
  ...admin,
  ...praktik,
  ...puls,
  ...rost,
  ...notiser,
];
