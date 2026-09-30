"use client";
// Klientroten i riktiga appen: navigering, API via /api/rpc och inloggad användare.
import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { App } from "@/shell/app";
import { BackendProvider, httpBackend } from "@/shell/backend";
import { RuntimeProvider } from "@/shell/runtime";
import { SessionProvider, type Session } from "@/shell/session";
import { APP_ROUTES } from "@/shell/route-table";
import type { Persona } from "@/data/actors";
import type { Role } from "@/api/roles";
import { NextNavProvider } from "./next-nav";

type Loaded = { persona: Persona | null } | { error: true };

export function ClientRoot() {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dev-session", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("session"))))
      .then((body: { persona: Persona | null }) => !cancelled && setLoaded({ persona: body.persona }))
      .catch(() => !cancelled && setLoaded({ error: true }));
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (!loaded) return null;
  if ("error" in loaded || !loaded.persona) return <p className="p-8">Inloggningen kunde inte hämtas.</p>;
  const persona = loaded.persona;
  const session: Session = {
    actor: persona.actor,
    user: persona.user,
    // Utvecklingsläget: byt testperson. I produktion loggar man in med Microsoft eller e-postkod.
    switchRole: async (role: Role, userId?: string) => {
      await fetch("/api/dev-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, userId: userId ?? persona.actor.userId }),
      });
      router.replace("/");
      setVersion((v) => v + 1);
    },
  };
  return (
    <RuntimeProvider mode="app">
      <BackendProvider key={`${persona.actor.userId}|${persona.actor.role}`} backend={httpBackend}>
        <SessionProvider session={session}>
          <Suspense>
            <NextNavProvider>
              <App routes={APP_ROUTES} />
            </NextNavProvider>
          </Suspense>
        </SessionProvider>
      </BackendProvider>
    </RuntimeProvider>
  );
}
