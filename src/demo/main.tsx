// Prototypens startpunkt. Byggs till en enda HTML-fil (npm run demo:build) och publiceras som artefakt.
// Skärmar, rutter och hanterare är exakt samma kod som i riktiga appen. Bara i prototypen: prototypfältet
// (perspektiv, roll, demodatum, scenarier, feedback, återställ), sidorna under /om och frågan demo.refs.
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import { App } from "@/shell/app";
import { BackendProvider } from "@/shell/backend";
import { guardedNavigate, NavProvider, newNavKey, parseHash, type LinkImpl, type Nav, type NavEntry } from "@/shell/nav";
import { RuntimeProvider } from "@/shell/runtime";
import { SessionProvider, type Session } from "@/shell/session";
import { APP_ROUTES } from "@/shell/route-table";
import { START_PATH } from "@/shell/routes";
import { listPersonas, ownRolesOf, personaFor, type Persona } from "@/data/actors";
import type { Role } from "@/api/roles";
import { DownloadProvider } from "@/ui/download";
import { toast } from "@/ui/toast";
import { bootDemo, type DemoRuntime } from "./demo-runtime";
import { DEMO_ROUTES } from "./routes";
import { PrototypeChrome } from "./chrome";
import { artifactDownload } from "./download";
import { initFeedback } from "./feedback-store";
import { stopScenario } from "./scenario-store";
import "./handlers";

const PERSONA_KEY = "miljonmatch-prototyp-v2-persona";
/** Senast visade sökväg – öppnas igen när prototypen startas utan adress (som den gamla prototypen). */
const PATH_KEY = "miljonmatch-prototyp-v2-sokvag";
const ROUTES = [...DEMO_ROUTES, ...APP_ROUTES];

const HashLink: LinkImpl = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);

const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* privat läge */
  }
};

/** Räknas upp vid varje navigering – så att ett rollbyte vet om anroparen själv navigerade i samma steg. */
let navSeq = 0;

// Historikposter: samma modell som appen (src/app/_shell/next-nav.tsx). Varje post får en nyckel i history.state, så att
// skalet kan spara och återställa skrollen vid tillbaka/framåt (src/shell/page-effects.tsx).
const stateKey = (): string | undefined => {
  try {
    const s = window.history.state as { mmKey?: unknown } | null;
    return typeof s?.mmKey === "string" ? s.mmKey : undefined;
  } catch {
    return undefined;
  }
};
const stamp = (key: string, hash: string) => {
  try {
    window.history.replaceState({ mmKey: key }, "", hash);
  } catch {
    /* historiken kan vara spärrad i artefaktens ram */
  }
};
let entry: NavEntry = { key: "", kind: "load" };
/** Hash som en egen push just satte – dess hashchange är inte tillbaka/framåt. */
let ownHash: string | null = null;

function useHashNav(): Nav {
  const [hash, setHash] = useState(() => {
    const key = stateKey() ?? newNavKey();
    if (!stateKey()) stamp(key, window.location.hash || "#/");
    entry = { key, kind: "load" };
    return window.location.hash;
  });
  useEffect(() => {
    // Skrollen sköts av skalet (page-effects), inte av webbläsaren.
    try {
      window.history.scrollRestoration = "manual";
    } catch {
      /* ignoreras */
    }
    const on = () => {
      const h = window.location.hash;
      if (ownHash !== null && h === ownHash) {
        ownHash = null;
      } else {
        ownHash = null;
        // Tillbaka/framåt har postens nyckel. En vanlig hash-länk som inte fångades (ny post utan nyckel) räknas som push.
        const key = stateKey();
        if (key) entry = { key, kind: "pop" };
        else {
          entry = { key: newNavKey(), kind: "push" };
          stamp(entry.key, h);
        }
      }
      setHash(h);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    const p = hash.replace(/^#/, "");
    if (p && p !== "/") lsSet(PATH_KEY, p);
  }, [hash]);
  return useMemo(() => {
    const { path, query } = parseHash(hash);
    return {
      path,
      query,
      // Tillståndet uppdateras direkt (inte först vid hashchange), så att ett rollbyte och en navigering
      // i samma klick blir en enda rendering – skärmen visas aldrig med fel roll.
      push: (to) => {
        navSeq++;
        guardedNavigate(to, () => {
          const h = `#${to}`;
          if (window.location.hash === h) {
            entry = { key: entry.key, kind: "replace" };
          } else {
            entry = { key: newNavKey(), kind: "push" };
            ownHash = h;
            window.location.hash = to;
            stamp(entry.key, h);
          }
          setHash(h);
        });
      },
      replace: (to) => {
        navSeq++;
        guardedNavigate(to, () => {
          entry = { key: entry.key || newNavKey(), kind: "replace" };
          stamp(entry.key, `#${to}`);
          setHash(`#${to}`);
        });
      },
      back: () => window.history.back(),
      href: (to) => `#${to}`,
      entry,
    };
  }, [hash]);
}

type Chosen = { userId: string; role: Role };
function readPersona(): Chosen | null {
  try {
    return JSON.parse(lsGet(PERSONA_KEY) ?? "null") as Chosen | null;
  } catch {
    return null;
  }
}

function Root({ initial }: { initial: DemoRuntime }) {
  const nav = useHashNav();
  const [demo, setDemo] = useState(initial);
  const [generation, setGeneration] = useState(0);
  const personas = useMemo(() => listPersonas(demo.rt.raw()), [demo]);
  const [picked, setPicked] = useState<Chosen | null>(readPersona);
  const persona: Persona = useMemo(() => {
    const p = picked && personaFor(demo.rt.raw(), picked.userId, picked.role);
    return p && p.actor.role === picked?.role ? p : (personas.find((x) => x.actor.role === picked?.role) ?? personas[0]);
  }, [picked, demo, personas]);
  const actor = persona.actor;
  const backend = useMemo(() => demo.backend(() => actor), [demo, actor]);

  const pick = useCallback((p: Persona) => {
    const v = { userId: p.actor.userId, role: p.actor.role };
    lsSet(PERSONA_KEY, JSON.stringify(v));
    setPicked(v);
  }, []);

  const session: Session = useMemo(() => {
    // Byter testperson. Anroparen navigerar oftast själv i samma klick (t.ex. PerspectiveLink); annars öppnas
    // rollens startsida – samma som när man byter testperson i riktiga appens utvecklingsläge.
    const switchRole = (role: Role, userId?: string) => {
      const byId = userId ? personaFor(demo.rt.raw(), userId, role) : null;
      const next = byId && byId.actor.role === role ? byId : personas.find((p) => p.actor.role === role);
      if (!next) return;
      const before = navSeq;
      pick(next);
      queueMicrotask(() => {
        if (navSeq === before) nav.push(START_PATH[next.actor.role]);
      });
    };
    return {
      actor: persona.actor,
      user: persona.user,
      personas: personas.map((p) => ({
        userId: p.actor.userId,
        role: p.actor.role,
        name: p.user.name,
        title: p.user.title,
        // Adressen används bara av prototypens snabbval på kommunens inloggning (servern lämnar aldrig ut den här).
        email: p.user.email,
        isDefaultForRole: (p as Persona & { isDefaultForRole?: boolean }).isDefaultForRole,
      })),
      switchRole,
      // Rollväxling för egna roller (beslut 2026-10-08): samma rollväljare som i appen – prototypen byter persona.
      ownRoles: ownRolesOf(demo.rt.raw(), persona.actor.userId),
      chooseRole: async (role: Role) => switchRole(role, persona.actor.userId),
      // Simulerad inloggning med e-post och kod: vilken sexsiffrig kod som helst godtas och inloggningen byter till
      // testpersonen med adressen. En ny adress på avtalets kommundomän skapar ett konto som handläggare
      // (självregistrering, beslut 2026-10-07). I riktiga appen skickar Supabase koden med e-post (se src/server/auth).
      auth: {
        kind: "demo",
        sendCode: async (email: string) => {
          const e = email.trim().toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, error: "invalid_email", message: "Skriv en giltig e-postadress." };
          return { ok: true };
        },
        verifyCode: async (email: string, code: string) => {
          if (!/^\d{6}$/.test(code.trim())) return { ok: false, error: "invalid_code", message: "Koden har sex siffror." };
          const e = email.trim().toLowerCase();
          const hit = personas.find((p) => p.user.email.toLowerCase() === e) ?? listPersonas(demo.rt.raw()).find((p) => p.user.email.toLowerCase() === e);
          if (hit) {
            pick(hit);
            return { ok: true };
          }
          const created = await demo.selfRegister(e, persona.actor);
          const fresh = created.ok ? personaFor(demo.rt.raw(), created.profileId, "kommun_handlaggare") : null;
          if (!fresh) return { ok: false, error: "not_invited", message: "Koden stämmer inte eller har gått ut. Begär en ny kod." };
          pick(fresh);
          return { ok: true, created: true };
        },
        signOut: async () => undefined,
      },
    };
  }, [persona, personas, demo, nav, pick]);

  // Återställ: nya testdata utan omladdning, samordnaren på startsidan (som den gamla prototypens MM.resetDemo).
  const reset = useCallback(async () => {
    demo.reset();
    stopScenario();
    const fresh = await bootDemo();
    const first = listPersonas(fresh.rt.raw()).find((p) => p.actor.role === "samordnare");
    if (first) pick(first);
    setDemo(fresh);
    setGeneration((g) => g + 1);
    nav.push("/om");
    toast("Demodata återställd. Allt du gjort i prototypen är borttaget.");
  }, [demo, nav, pick]);

  return (
    <RuntimeProvider mode="demo">
      <DownloadProvider impl={artifactDownload}>
        <BackendProvider key={`${generation}|${actor.userId}|${actor.role}`} backend={backend}>
          <SessionProvider session={session}>
            <NavProvider nav={nav} LinkImpl={HashLink}>
              <PrototypeChrome routes={ROUTES} onReset={() => void reset()} />
              <App routes={ROUTES} />
            </NavProvider>
          </SessionProvider>
        </BackendProvider>
      </DownloadProvider>
    </RuntimeProvider>
  );
}

async function main() {
  const el = document.getElementById("root")!;
  // Utan adress: senast visade sida, annars prototypens startsida med scenarierna.
  if (!window.location.hash || window.location.hash === "#" || window.location.hash === "#/") {
    window.history.replaceState(null, "", `#${lsGet(PATH_KEY) || "/om"}`);
  }
  void initFeedback();
  const demo = await bootDemo();
  createRoot(el).render(
    <StrictMode>
      <Root initial={demo} />
    </StrictMode>,
  );
}
void main();
