"use client";
// Diagnossida: visar att API:t svarar och vem som är inloggad. Innehåller inga personuppgifter.
import { useQuery } from "@/shell/backend";
import { sessionPing } from "./api";

export function DiagnosScreen() {
  const q = useQuery(sessionPing, {});
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Diagnos</h1>
      {q.isLoading && <p>Hämtar…</p>}
      {q.data && (
        <dl data-testid="diagnos" className="mt-4 grid grid-cols-[auto_1fr] gap-x-4">
          <dt>Tid</dt><dd>{q.data.now}</dd>
          <dt>Roll</dt><dd>{q.data.role}</dd>
          <dt>Användare</dt><dd>{q.data.userId}</dd>
        </dl>
      )}
    </div>
  );
}
