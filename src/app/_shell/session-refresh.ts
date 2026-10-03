// Utloggad under tiden (t.ex. efter 60 minuters inaktivitet, src/proxy.ts): /api/rpc svarar 401. Då hämtas sessionen om
// EN gång – inte en gång per misslyckad fråga – och appen leder till inloggningen med ?till=<sökväg> (src/shell/app.tsx).
// Ren funktion utan React (testas i session-refresh.test.ts); klientroten äger spärren tillsammans med sin backend.
import { BackendError, type Backend } from "@/shell/backend";

export type SessionRefresh = {
  /** Backend som hämtar sessionen om vid första 401. Felet kastas vidare, så frågan visar sitt fel som vanligt. */
  backend: Backend;
  /** Sessionen är hämtad: inloggad = spärren släpps (nästa 401 hämtar om igen), utloggad = spärren står kvar. */
  sessionLoaded(authenticated: boolean): void;
  /** Bara för tester: är spärren satt? */
  pending(): boolean;
  /** Varför sessionen gick ut (från 401-svaret): "idle", "max" eller "session" (okänt) – null när ingen 401 setts. */
  loggedOut(): "idle" | "max" | "session" | null;
};

/**
 * Första 401 från /api/rpc kör reload() (= ny GET /api/session). Fler 401 medan sessionen hämtas, eller efter att en
 * utloggad session laddats (inloggningssidan visas), gör ingenting – flera samtidiga frågor på en sida ger annars lika
 * många sessionshämtningar. Efter inloggningen laddas sidan om (hardNavigate), så spärren lever aldrig längre än så.
 */
export function createSessionRefresh(inner: Backend, reload: () => void): SessionRefresh {
  let unauthenticated = false;
  let reason: "idle" | "max" | "session" | null = null;
  const on401 = (e: unknown): never => {
    if (e instanceof BackendError && e.status === 401 && !unauthenticated) {
      unauthenticated = true;
      reason = e.reason === "idle" || e.reason === "max" ? e.reason : "session";
      reload();
    }
    throw e;
  };
  return {
    backend: {
      mode: inner.mode,
      query: (k, p) => inner.query(k, p).catch(on401),
      command: (k, p, o) => inner.command(k, p, o).catch(on401),
    },
    sessionLoaded: (authenticated) => {
      if (authenticated) {
        unauthenticated = false;
        reason = null;
      }
    },
    pending: () => unauthenticated,
    loggedOut: () => reason,
  };
}
