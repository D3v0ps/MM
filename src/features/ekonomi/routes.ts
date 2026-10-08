// Rutter för området ekonomi (prototypens eko.start, eko.arende, eko.faktura och eko.korning). Bara ekonomen (beslut
// 2026-10-07, beslut 5: belopp syns bara för rollen ekonom).
// Ordningen spelar roll: /ekonomi/arende/… och /ekonomi/prislista står före /ekonomi/:month.
// Frågeparametrar i körningen: ?filter=anmarkning|godkannande (radernas filter) och ?arende=<caseId> (öppnar radens detalj).
// Förhandsvisningen: /ekonomi/:month/faktura (månadens faktura), ?faktura=<id> eller /ekonomi/:month/faktura/:caseId (ärendets rad).
import { monthName } from "@/core/time";
import type { RouteDef } from "@/shell/routes";
import { ArendeScreen } from "./screens/arende";
import { FakturaScreen } from "./screens/faktura";
import { KorningScreen } from "./screens/korning";
import { PrislistaScreen } from "./screens/prislista";
import { StartScreen } from "./screens/start";

const ROLES = ["ekonom"] as const;
const MONTH_RE = /^\d{4}-\d{2}$/;

export const routes: RouteDef[] = [
  { path: "/ekonomi", title: "Fakturering", roles: ROLES, area: "mb", screen: StartScreen },
  { path: "/ekonomi/arende/:caseId?", title: "Ärende (ekonomi)", roles: ROLES, area: "mb", screen: ArendeScreen },
  // Prislistan (beslut 5): flyttad hit från avtalssidan – bara ekonomen ser priser.
  { path: "/ekonomi/prislista", title: "Prislista", roles: ROLES, area: "mb", screen: PrislistaScreen },
  { path: "/ekonomi/:month/faktura/:caseId?", title: "Faktura", roles: ROLES, area: "mb", screen: FakturaScreen },
  {
    path: "/ekonomi/:month",
    title: (p) => (MONTH_RE.test(p.month ?? "") ? `Fakturakörning ${monthName(p.month)}` : "Fakturakörning"),
    roles: ROLES,
    area: "mb",
    screen: KorningScreen,
  },
];
