"use client";
// Min vecka (/min-vecka) – startsidan för alla MB-roller (beslut 2026-10-06): samma upplägg som coachens Min vecka (förebilden),
// med rollens egna uppgifter. Skärmen väljer rollens Min vecka; varje roll använder bara frågor den redan har. Rollskärmarna
// ligger i sina egna områden och delar kitet i src/ui/vecka.tsx.
import { AdminMinVeckaScreen } from "@/features/admin/screens/min-vecka";
import { HandledareMinVeckaScreen } from "@/features/arenden/screens/min-vecka-handledare";
import { MinVeckaScreen as CoachMinVeckaScreen } from "@/features/coach/screens/min-vecka";
import { EkonomMinVeckaScreen } from "@/features/ekonomi/screens/min-vecka";
import { SamMinVeckaScreen } from "@/features/inkorg/screens/min-vecka";
import { ChefMinVeckaScreen } from "@/features/ledning/screens/min-vecka";
import { useSession } from "@/shell/session";

export function MinVeckaScreen() {
  const { actor } = useSession();
  switch (actor.role) {
    case "coach":
      return <CoachMinVeckaScreen />;
    case "samordnare":
    case "avtalsansvarig":
      return <SamMinVeckaScreen />;
    case "handledare":
      return <HandledareMinVeckaScreen />;
    case "chef":
      return <ChefMinVeckaScreen />;
    case "ekonom":
      return <EkonomMinVeckaScreen />;
    case "admin":
      return <AdminMinVeckaScreen />;
    default:
      // Rutten släpper bara in MB-roller (SUPPLIER_ROLES).
      return null;
  }
}
