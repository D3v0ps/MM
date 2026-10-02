// Rutter för området ekonomi (prototypens eko.start, eko.arende, eko.faktura och eko.korning).
// Ordningen spelar roll: /ekonomi/arende/… står före /ekonomi/:month.
// Frågeparametrar i körningen: ?filter=stoppade|godkannande|klara (startsidans genvägar) och ?arende=<caseId> (öppnar fakturans detalj).
import { monthName } from "@/core/time";
import type { RouteDef } from "@/shell/routes";
import { ArendeScreen } from "./screens/arende";
import { FakturaScreen } from "./screens/faktura";
import { KorningScreen } from "./screens/korning";
import { StartScreen } from "./screens/start";

const ROLES = ["ekonom", "chef"] as const;
const MONTH_RE = /^\d{4}-\d{2}$/;

export const routes: RouteDef[] = [
  { path: "/ekonomi", title: "Fakturering", roles: ROLES, area: "mb", screen: StartScreen },
  { path: "/ekonomi/arende/:caseId?", title: "Ärende (ekonomi)", roles: ROLES, area: "mb", screen: ArendeScreen },
  { path: "/ekonomi/:month/faktura/:caseId", title: "Faktura", roles: ROLES, area: "mb", screen: FakturaScreen },
  {
    path: "/ekonomi/:month",
    title: (p) => (MONTH_RE.test(p.month ?? "") ? `Fakturakörning ${monthName(p.month)}` : "Fakturakörning"),
    roles: ROLES,
    area: "mb",
    screen: KorningScreen,
  },
];
