// Rutter för området admin (prototypens admin.avtal, admin.anvandare, admin.integrationer, admin.mallar och admin.logg).
import type { RouteDef } from "@/shell/routes";
import { AnvandareScreen } from "./screens/anvandare";
import { AvtalScreen } from "./screens/avtal";
import { IntegrationerScreen } from "./screens/integrationer";
import { LoggScreen } from "./screens/logg";
import { MallarScreen } from "./screens/mallar";

/** Titeln på avtalssidan beror på fliken (prototypens titel för admin.avtal). Sidan ligger inte i menyn (beslut 2026-10-06). */
const avtalTitle = (_p: Record<string, string>, q: URLSearchParams): string =>
  q.get("flik") === "interna" ? "Interna regler (Miljonbemanning)" : "Avtal och konfiguration";

export const routes: RouteDef[] = [
  { path: "/admin/avtal", title: avtalTitle, roles: ["admin"], area: "mb", screen: AvtalScreen },
  { path: "/admin/anvandare", title: "Användare och roller", roles: ["admin", "avtalsansvarig"], area: "mb", screen: AnvandareScreen },
  { path: "/admin/integrationer", title: "Underbiträden och integrationer", roles: ["admin"], area: "mb", screen: IntegrationerScreen },
  { path: "/admin/mallar", title: (_p, q) => (q.get("flik") === "logg" ? "Utskickslogg" : "Mallar och utskick"), roles: ["admin", "samordnare"], area: "mb", screen: MallarScreen },
  { path: "/admin/logg", title: "Revisionslogg", roles: ["admin", "chef"], area: "mb", screen: LoggScreen },
];
