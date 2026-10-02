// Alla appens sidor går genom samma rutt-tabell som prototypen (src/shell/route-table.ts).
import { ClientRoot } from "@/app/_shell/client-root";

export const dynamic = "force-dynamic";

export default function Page() {
  return <ClientRoot />;
}
