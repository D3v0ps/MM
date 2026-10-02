"use client";
// "Läs in testdata på nytt" – bara för testare i testmiljön (session.isTester och miljön staging). Adminvyn renderar den;
// för alla andra (och i prototypen och produktion) renderas ingenting. Själva inläsningen: POST /api/staging/seed
// (session.reloadTestData i src/app/_shell/client-root.tsx).
import { useState } from "react";
import { useSession } from "@/shell/session";
import { Button, Card, Notice, useConfirm } from "@/ui";

export function TestDataReset() {
  const session = useSession();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = session.reloadTestData;
  if (!session.isTester || session.environment !== "staging" || !reload) return null;

  const run = async () => {
    const yes = await confirm({
      title: "Läsa in testdatat på nytt?",
      body: (
        <>
          <p>
            <strong>Allt som har testats nollställs – för alla testare.</strong> Ärenden, närvaro, avstämningar, rapporter, meddelanden, utskick och
            fakturaunderlag blir som i början av testet.
          </p>
          <p className="mt-2">Testklockan börjar om på måndag 1 februari 2027 kl. 09.12. Revisionsloggen och er inloggning finns kvar. Det tar ungefär en halv minut.</p>
          <p className="mt-2">Alla som testar just nu får också om testdatat. Synpunkterna finns kvar.</p>
        </>
      ),
      confirmLabel: "Läs in testdata på nytt",
      tone: "danger",
    });
    if (!yes) return;
    setBusy(true);
    setError(null);
    const r = await reload();
    if (!r.ok) {
      setBusy(false);
      setError(r.message);
    }
  };

  return (
    <Card title="Testdata" icon="refresh" tone="sub">
      <div className="flex flex-col gap-3">
        <p>Testmiljön har bara påhittade testdata. Läs in testdatat på nytt när ni vill börja om, till exempel inför en ny testomgång.</p>
        <p>Allt som har testats nollställs för alla testare. Revisionsloggen och er inloggning finns kvar.</p>
        {error && <Notice tone="critical">{error}</Notice>}
        <div>
          <Button kind="danger" icon="refresh" pending={busy} onClick={() => void run()}>
            Läs in testdata på nytt
          </Button>
        </div>
        {busy && (
          <p role="status" className="text-text-muted">
            Läser in testdatat. Sidan laddas om när det är klart.
          </p>
        )}
      </div>
    </Card>
  );
}
