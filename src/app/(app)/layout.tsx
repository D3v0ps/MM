// Skalet ligger i layouten, inte i sidan: det monteras en gång och ligger kvar när adressen byts (även om något skulle
// navigera via Next-routern). Alla sidor går genom samma rutt-tabell som prototypen (src/shell/route-table.ts).
import type { ReactNode } from "react";
import { ClientRoot } from "@/app/_shell/client-root";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ClientRoot />
      {children}
    </>
  );
}
