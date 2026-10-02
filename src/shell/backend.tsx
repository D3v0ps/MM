"use client";
// Klientsidans väg in i API:t. Riktiga appen skickar anropen till /api/rpc, prototypen kör hanterarna direkt i webbläsaren.
// Skärmarna använder bara useQuery/useCommand och vet inte vilken backend som körs.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, QueryClient, QueryClientProvider, useQuery as useTanstackQuery, useQueryClient } from "@tanstack/react-query";
import type { CommandDef, Invalidates, QueryDef } from "@/api/contract";

export type Backend = {
  mode: "demo" | "app";
  query(key: string, params: unknown): Promise<unknown>;
  command(key: string, payload: unknown): Promise<unknown>;
};

export class BackendError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

/** Transport för riktiga appen. */
export const httpBackend: Backend = {
  mode: "app",
  query: (key, params) => rpc("query", key, params),
  command: (key, payload) => rpc("command", key, payload),
};
async function rpc(kind: "query" | "command", key: string, input: unknown) {
  const res = await fetch("/api/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, key, input }),
    credentials: "same-origin",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new BackendError(res.status, body.code ?? "error", body.message ?? "Något gick fel. Försök igen.");
  return body.result;
}

const BackendContext = createContext<Backend | null>(null);

export function BackendProvider({ backend, children }: { backend: Backend; children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Prototypen har all data lokalt; riktiga appen hämtar om efter 20 sekunder.
            staleTime: backend.mode === "demo" ? Infinity : 20_000,
            retry: backend.mode === "demo" ? false : 1,
            refetchOnWindowFocus: backend.mode === "app",
          },
        },
      }),
  );
  return (
    <BackendContext.Provider value={backend}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </BackendContext.Provider>
  );
}

export function useBackend(): Backend {
  const b = useContext(BackendContext);
  if (!b) throw new Error("BackendProvider saknas");
  return b;
}

/**
 * Läs data. `params` null = hämta inte ännu.
 * keepPrevious: visa föregående svar medan nästa hämtas (isPlaceholderData) – bara när samma ärende eller post visas och en
 * parameter ändras (filter, månad). Aldrig när man byter till ett annat ärende eller mejl.
 */
export function useQuery<P, R>(def: QueryDef<P, R>, params: P | null, opts?: { enabled?: boolean; keepPrevious?: boolean }) {
  const backend = useBackend();
  return useTanstackQuery({
    queryKey: [def.key, params],
    queryFn: () => backend.query(def.key, params) as Promise<R>,
    enabled: params !== null && opts?.enabled !== false,
    placeholderData: opts?.keepPrevious ? keepPreviousData : undefined,
  });
}

/** Förhämta en fråga (samma nyckel som useQuery). Hämtar inte om svaret redan finns och är färskt. */
export function usePrefetch() {
  const backend = useBackend();
  const qc = useQueryClient();
  return useCallback(
    <P, R>(def: QueryDef<P, R>, params: P) => {
      void qc.prefetchQuery({ queryKey: [def.key, params], queryFn: () => backend.query(def.key, params) as Promise<R> });
    },
    [backend, qc],
  );
}

/** Räkna om frågorna efter ett kommando: alla, inga eller de vars nyckel börjar med något av prefixen. */
async function invalidate(qc: ReturnType<typeof useQueryClient>, inv: Invalidates) {
  if (inv === "none") return;
  if (inv === "all") return qc.invalidateQueries();
  return qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && inv.some((p) => (q.queryKey[0] as string).startsWith(p)) });
}

/**
 * Kör ett kommando. Efter ett lyckat anrop räknas frågorna om – alla (enkelt och korrekt i pilotens volym) om inte kommandot
 * anger något annat (CommandDef.invalidates, t.ex. "none" för loggkommandon) eller anroparen väljer (opts.invalidate).
 * Returnerar hanterarens resultat – affärsfel kommer som { ok: false, error }.
 */
export function useCommand<P, R>(def: CommandDef<P, R>, opts?: { invalidate?: Invalidates }) {
  const backend = useBackend();
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const invalidates = opts?.invalidate ?? def.invalidates ?? "all";
  const run = useCallback(
    async (payload: P): Promise<R> => {
      setPending(true);
      setError(null);
      try {
        const res = (await backend.command(def.key, payload)) as R;
        await invalidate(qc, invalidates);
        return res;
      } catch (e) {
        setError(e as Error);
        throw e;
      } finally {
        setPending(false);
      }
    },
    // invalidates är ett värde ur kontraktet (eller en konstant hos anroparen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backend, def.key, qc, typeof invalidates === "string" ? invalidates : invalidates.join("|")],
  );
  return useMemo(() => ({ run, pending, error }), [run, pending, error]);
}

/** Kör en fråga imperativt (t.ex. export). */
export function useQueryRunner() {
  const backend = useBackend();
  return useCallback(<P, R>(def: QueryDef<P, R>, params: P) => backend.query(def.key, params) as Promise<R>, [backend]);
}
