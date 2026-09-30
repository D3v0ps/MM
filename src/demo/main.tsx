// Prototypens startpunkt. Byggs till en enda HTML-fil (npm run demo:build) och publiceras som artefakt.
// Skärmar, rutter och hanterare är exakt samma kod som i riktiga appen.
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import { App } from "@/shell/app";
import { BackendProvider } from "@/shell/backend";
import { NavProvider, parseHash, type LinkImpl, type Nav } from "@/shell/nav";
import { RuntimeProvider } from "@/shell/runtime";
import { SessionProvider, type Session } from "@/shell/session";
import { APP_ROUTES } from "@/shell/route-table";
import { listPersonas, personaFor, type Persona } from "@/data/actors";
import type { Role } from "@/api/roles";
import { bootDemo, type DemoRuntime } from "./demo-runtime";
import { DEMO_ROUTES } from "./routes";
import { PrototypeChrome } from "./chrome";

const PERSONA_KEY = "miljonmatch-prototyp-v2-persona";
const ROUTES = [...DEMO_ROUTES, ...APP_ROUTES];

const HashLink: LinkImpl = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);

function useHashNav(): Nav {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => {
      setHash(window.location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return useMemo(() => {
    const { path, query } = parseHash(hash);
    return {
      path,
      query,
      push: (to) => { window.location.hash = to; },
      replace: (to) => { window.history.replaceState(null, "", `#${to}`); setHash(`#${to}`); },
      back: () => window.history.back(),
      href: (to) => `#${to}`,
    };
  }, [hash]);
}

function readPersona(): { userId: string; role: Role } | null {
  try {
    return JSON.parse(localStorage.getItem(PERSONA_KEY) ?? "null");
  } catch {
    return null;
  }
}
function writePersona(v: { userId: string; role: Role }) {
  try {
    localStorage.setItem(PERSONA_KEY, JSON.stringify(v));
  } catch {
    /* ignoreras */
  }
}

function Root({ demo }: { demo: DemoRuntime }) {
  const nav = useHashNav();
  const personas = useMemo(() => listPersonas(demo.rt.raw()), [demo]);
  const [persona, setPersona] = useState<Persona>(() => {
    const saved = readPersona();
    return (saved && personaFor(demo.rt.raw(), saved.userId, saved.role)) || personas[0];
  });
  const actor = persona.actor;
  const backend = useMemo(() => demo.backend(() => actor), [demo, actor]);

  const session: Session = useMemo(
    () => ({
      actor: persona.actor,
      user: persona.user,
      switchRole: (role: Role, userId?: string) => {
        const next = (userId && personaFor(demo.rt.raw(), userId, role)) || personas.find((p) => p.actor.role === role);
        if (!next) return;
        writePersona({ userId: next.actor.userId, role: next.actor.role });
        setPersona(next);
        nav.push("/");
      },
    }),
    [persona, personas, demo, nav],
  );

  return (
    <RuntimeProvider mode="demo">
      <BackendProvider key={`${persona.actor.userId}|${persona.actor.role}`} backend={backend}>
        <SessionProvider session={session}>
          <NavProvider nav={nav} LinkImpl={HashLink}>
            <PrototypeChrome personas={personas} onReset={() => { demo.reset(); window.location.reload(); }} />
            <App routes={ROUTES} />
          </NavProvider>
        </SessionProvider>
      </BackendProvider>
    </RuntimeProvider>
  );
}

async function main() {
  const el = document.getElementById("root")!;
  const demo = await bootDemo();
  createRoot(el).render(
    <StrictMode>
      <Root demo={demo} />
    </StrictMode>,
  );
}
void main();
