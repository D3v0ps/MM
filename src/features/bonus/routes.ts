// Rutter för området bonus (SPEC §7.17, beslut 2026-11-04). URL:erna har bara anspråkets id – aldrig namn eller personnummer.
//   /bonus/:claimId         Granska och skicka (Miljonbemanning: den som arbetar i ärendet; chef och systemadministratör läser)
//   /portal/bonus/:claimId  kommunens beslut (?steg=beslut | bekrafta – en sak per skärm)
// Bonusfakturorna ligger hos ekonomen: /ekonomi/bonus/:month? (src/features/ekonomi/routes.ts).
import type { RouteDef } from "@/shell/routes";
import { BonusGranskaScreen } from "./screens/granska";
import { PortalBonusScreen } from "./screens/portal-beslut";

export const routes: RouteDef[] = [
  { path: "/bonus/:claimId", title: "Bonus", roles: ["samordnare", "avtalsansvarig", "coach", "chef", "admin"], area: "mb", screen: BonusGranskaScreen },
  { path: "/portal/bonus/:claimId", title: "Bonus", roles: ["kommun_handlaggare"], area: "portal", screen: PortalBonusScreen },
];
