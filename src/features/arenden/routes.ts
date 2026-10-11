// Rutter för området ärenden (prototypens arenden.lista, arende.kort och hand.start).
import type { RouteDef } from "@/shell/routes";
import { DeltagarkortScreen } from "./screens/kort";
import { ArendenListaScreen } from "./screens/lista";

/** Rollerna som når ärendelistan och deltagarkortet. Chef och systemadmin i läsläge. */
const CASE_ROLES = ["samordnare", "avtalsansvarig", "coach", "chef", "admin"] as const;

export const routes: RouteDef[] = [
  { path: "/arenden", title: "Ärenden", roles: CASE_ROLES, area: "mb", screen: ArendenListaScreen },
  // Titeln kompletteras med ärendenumret av skärmen när kortet har hämtats (URL:en innehåller bara id:t).
  { path: "/arenden/:caseId", title: "Deltagarkort", roles: CASE_ROLES, area: "mb", screen: DeltagarkortScreen },
];
