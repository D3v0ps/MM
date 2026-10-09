// Rutter för området coach (prototypens coach.narvaro, coach.avstamning, coach.manad, coach.kartlaggning, coach.handelse).
// Min vecka (/min-vecka) ligger i området vecka – coachens skärm (screens/min-vecka.tsx) är förebilden för alla roller.
import { monthName } from "@/core/time";
import type { RouteDef } from "@/shell/routes";
import { AvstamningScreen } from "./screens/avstamning";
import { HandelseScreen } from "./screens/handelse";
import { KartlaggningScreen } from "./screens/kartlaggning";
import { ManadsbedomningScreen } from "./screens/manadsbedomning";
import { NarvaroScreen } from "./screens/narvaro";

const MONTH_RE = /^\d{4}-\d{2}$/;

export const routes: RouteDef[] = [
  { path: "/narvaro", title: "Närvaro", roles: ["coach", "handledare"], area: "mb", screen: NarvaroScreen },
  { path: "/avstamning/:caseId?", title: "Möte", roles: ["coach"], area: "mb", screen: AvstamningScreen },
  {
    path: "/manadsbedomning/:caseId?",
    title: (_p, q) => {
      const m = q.get("manad");
      return m && MONTH_RE.test(m) ? `Månadsbedömning ${monthName(m)}` : "Månadsbedömning";
    },
    roles: ["coach"],
    area: "mb",
    screen: ManadsbedomningScreen,
  },
  { path: "/kartlaggning/:caseId?", title: "Kartläggning", roles: ["coach"], area: "mb", screen: KartlaggningScreen },
  { path: "/handelse/:caseId?", title: (_p, q) => (q.get("lage") === "avslut" ? "Avsluta insatsen" : "Registrera händelse"), roles: ["coach"], area: "mb", screen: HandelseScreen },
];
