"use client";
// Klientroten i riktiga appen: navigering, API via /api/rpc och inloggad användare (GET /api/session).
//   Minnesläget (utveckling, e2e): vald testperson, byt i verktygsfältet (/api/dev-session). Inloggningssidorna simulerar
//   koden som i prototypen – adressen väljer testpersonen.
//   Supabase-läget: inloggning med e-post och kod (/api/auth/*). Inte inloggad = anonym session med bara publika sidor.
//   Testmiljön: rad överst "Testmiljö – påhittade testdata", testarens val av testperson och "Lämna synpunkt"
//   (src/features/synpunkter/panel.tsx – bara testare i testmiljön, session.feedback).
//   Minnesläget med en simulerad testare (POST /api/dev-session med testerId – e2e och utveckling): en enklare rad
//   "Testmiljö · Simulerad testare" med samma "Lämna synpunkt" och "Alla synpunkter", så att synpunkterna kan prövas med
//   den grunda navigeringen (beslut 2026-10-02, punkt 6). Testpersonen byts i utvecklingsfältet, som behåller testerId.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { isCustomerRole, ROLE_LABEL, type Role } from "@/api/roles";
import { safeReturnPath } from "@/core/return-path";
import { fmtDateFull, WEEKDAYS, weekday } from "@/core/time";
import { feedbackPortOf, type FeedbackPort } from "@/features/synpunkter/api";
import { FeedbackToolbar } from "@/features/synpunkter/panel";
import type { SessionView } from "@/server/session-view";
import { App } from "@/shell/app";
import { BackendProvider, httpBackend } from "@/shell/backend";
import { RuntimeProvider } from "@/shell/runtime";
import { ANONYMOUS, SessionProvider, type AuthPort, type AuthResult, type Session } from "@/shell/session";
import { APP_ROUTES } from "@/shell/route-table";
import { cancelLeaveDocument, confirmLeaveDocument } from "@/shell/nav";
import { PORTAL_FIRST_LOGIN_PATH } from "@/shell/nav-config";
import { createSessionRefresh } from "./session-refresh";
import { stayOrStart } from "./stay-or-start";
import { NextNavProvider } from "./next-nav";

type Loaded = { view: SessionView } | { error: true };

const FAILED: AuthResult = { ok: false, error: "error", message: "Något gick fel. Försök igen om en stund." };

async function postJson(url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const asResult = (json: Record<string, unknown>): AuthResult =>
  json.ok === true ? { ok: true, ...(json.created === true ? { created: true } : {}) } : json.ok === false && typeof json.error === "string" ? (json as unknown as AuthResult) : FAILED;

/** Återhopp efter inloggning: ?till= på inloggningssidan (bara egna sökvägar, safeReturnPath), annars startsidan för rollen. */
function returnPath(): string {
  return safeReturnPath(new URLSearchParams(window.location.search).get("till")) ?? "/";
}

/** Efter inloggning, utloggning och byte av testperson laddas sidan om – inga data från förra användaren ligger kvar. */
const hardNavigate = (to: string) => {
  window.location.assign(to);
  return new Promise<never>(() => undefined);
};

const here = () => window.location.pathname + window.location.search;

/** Inloggning i supabase-läget. Lyckad kod = sidan laddas om på återhoppsadressen (löftet löses inte). */
const liveAuth: AuthPort = {
  kind: "supabase",
  sendCode: async (email) => {
    try {
      return asResult((await postJson("/api/auth/code", { email })).json);
    } catch {
      return FAILED;
    }
  },
  verifyCode: async (email, code) => {
    let r: AuthResult;
    try {
      r = asResult((await postJson("/api/auth/verify", { email, code })).json);
    } catch {
      return FAILED;
    }
    // Kontot skapades nu (självregistrering): första gången till Mina uppgifter.
    return r.ok ? hardNavigate(r.created ? PORTAL_FIRST_LOGIN_PATH : returnPath()) : r;
  },
  signOut: async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  },
};

/** Utvecklingsläget: simulerad inloggning som i prototypen – vilken sexsiffrig kod som helst, adressen väljer testperson. */
const devAuth: AuthPort = {
  kind: "demo",
  sendCode: async (email) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? { ok: true } : { ok: false, error: "invalid_email", message: "Skriv en giltig e-postadress." }),
  verifyCode: async (email, code) => {
    if (!/^\d{6}$/.test(code.trim())) return { ok: false, error: "invalid_code", message: "Koden har sex siffror." };
    const { status, json } = await postJson("/api/dev-session", { email }).catch(() => ({ status: 500, json: {} as Record<string, unknown> }));
    if (status !== 200 || json.ok !== true) return { ok: false, error: "not_invited", message: "Koden stämmer inte eller har gått ut. Begär en ny kod." };
    return hardNavigate(json.created === true ? PORTAL_FIRST_LOGIN_PATH : returnPath());
  },
  signOut: async () => undefined,
};

export function ClientRoot() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  // Utloggad under tiden (t.ex. efter 60 minuters inaktivitet): första 401 från /api/rpc hämtar sessionen igen – en gång,
  // inte en per misslyckad fråga (session-refresh.ts) – och appen leder till inloggningen med ?till=<sökväg> (app.tsx).
  const refresh = useMemo(() => createSessionRefresh(httpBackend, reload), [reload]);
  const backend = refresh.backend;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session", { credentials: "same-origin", cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<SessionView>) : Promise.reject(new Error("session"))))
      .then((view) => {
        if (cancelled) return;
        refresh.sessionLoaded(view.authenticated);
        setLoaded({ view });
      })
      .catch(() => !cancelled && setLoaded({ error: true }));
    return () => {
      cancelled = true;
    };
  }, [version, refresh]);

  // Samma port så länge backend är densamma – annars hämtar "Alla synpunkter" om listan vid varje omrendering av roten.
  const feedbackPort = useMemo(() => feedbackPortOf(backend), [backend]);

  if (!loaded) return null;
  if ("error" in loaded) return <p className="p-8">Inloggningen kunde inte hämtas. Ladda om sidan.</p>;
  const { view } = loaded;
  const session = buildSession(view, {
    loggedOut: refresh.loggedOut(),
    switchDev: async (role, userId, testerId) => {
      // Fråga först (osparad text) och byt sedan – annars är servern redan bytt till den nya personen om man stannar kvar.
      if (!(await confirmLeaveDocument())) return;
      await postJson("/api/dev-session", { role, userId, ...(testerId ? { testerId } : {}) }).catch(() => null);
      await hardNavigate(stayOrStart(here(), role, view.hidesCommercial));
    },
    feedbackPort,
  });
  if (!session) return <p className="p-8">Inloggningen kunde inte hämtas. Ladda om sidan.</p>;
  const actor = session.actor;
  return (
    <RuntimeProvider mode="app">
      <BackendProvider key={`${actor.userId}|${actor.role}`} backend={backend}>
        <SessionProvider session={session}>
          <Suspense>
            <NextNavProvider>
              {/* Raden ligger innanför sessionen och navigeringen: "Lämna synpunkt" sparar sidan och rollen. */}
              {view.backend === "supabase" && view.environment === "staging" ? <StagingBar view={view} /> : view.backend === "memory" && view.isTester ? <SimulatedTesterBar /> : null}
              <App routes={APP_ROUTES} />
            </NextNavProvider>
          </Suspense>
        </SessionProvider>
      </BackendProvider>
    </RuntimeProvider>
  );
}

function buildSession(view: SessionView, o: { loggedOut: Session["loggedOut"] | null; switchDev: (role: Role, userId?: string, testerId?: string) => Promise<void>; feedbackPort: FeedbackPort }): Session | null {
  if (view.backend === "memory") {
    const persona = view.persona;
    if (!persona) return null;
    return {
      actor: persona.actor,
      user: persona.user,
      environment: "memory",
      hidesCommercial: view.hidesCommercial,
      personas: view.personas,
      // Simulerad testare (testerId): synpunkterna som i testmiljön. Servern (feedback.* kräver testerId) avgör ändå.
      isTester: view.isTester,
      feedback: view.isTester ? o.feedbackPort : undefined,
      // Utvecklingsläget: byt testperson. I testmiljön och i drift loggar man in med e-postkod.
      // En simulerad testare (e2e) förblir testare när testpersonen byts.
      switchRole: (role: Role, userId?: string) => void o.switchDev(role, userId ?? persona.actor.userId, persona.actor.testerId),
      auth: devAuth,
    };
  }
  // Utloggad under besöket (401 från /api/rpc): inloggningssidan får veta varför (?utloggad=…) via App.
  if (!view.authenticated || !view.persona) return { ...ANONYMOUS, auth: liveAuth, ...(o.loggedOut ? { loggedOut: o.loggedOut } : {}) };
  const { actor, user } = view.persona;
  return {
    authenticated: true,
    actor,
    user,
    auth: liveAuth,
    isTester: view.isTester,
    environment: view.environment,
    hidesCommercial: view.hidesCommercial,
    // Testmiljön: testaren läser in testdatat på nytt i adminvyn (POST /api/staging/seed). Sidan laddas om när det är klart.
    reloadTestData: view.isTester && view.environment === "staging" ? reloadTestData : undefined,
    // Testmiljön: synpunkterna (feedback.* via /api/rpc). Servern och RLS släpper bara igenom testare i testmiljön.
    feedback: view.isTester && view.environment === "staging" ? o.feedbackPort : undefined,
    // Fråga först (osparad text), logga sedan ut och ladda om.
    signOut: () => {
      void confirmLeaveDocument().then((ok) => ok && liveAuth.signOut().then(() => hardNavigate(isCustomerRole(actor.role) ? "/portal/logga-in" : "/logga-in")));
    },
  };
}

const RELOAD_FAILED = "Testdatat kunde inte läsas in. Försök igen.";

/** Testmiljön: läs in testdatat på nytt. Lyckas det laddas sidan om (inga gamla data ligger kvar i webbläsaren). */
async function reloadTestData(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const { status, json } = await postJson("/api/staging/seed", { confirm: true });
    if (status === 200 && json.ok === true) return hardNavigate(window.location.pathname + window.location.search);
    return { ok: false, message: typeof json.message === "string" && json.message ? json.message : RELOAD_FAILED };
  } catch {
    return { ok: false, message: RELOAD_FAILED };
  }
}

/**
 * Minnesläget med en simulerad testare (e2e, utveckling): samma rad som i testmiljön, men bara synpunkterna. Ingen
 * "Agera som"-lista (den går mot /api/session/impersonate, som inte finns i minnet) – testpersonen byts i utvecklingsfältet.
 */
function SimulatedTesterBar() {
  return (
    <div
      data-print="hide"
      role="region"
      aria-label="Testmiljö"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-dashed border-antracit bg-ljusgra-ton2 px-4 py-1.5 text-small"
    >
      <span className="font-extrabold tracking-[0.06em] uppercase">Testmiljö</span>
      <span>Simulerad testare – påhittade testdata</span>
      <span className="ml-auto">
        <FeedbackToolbar routes={APP_ROUTES} />
      </span>
    </div>
  );
}

/** Testmiljön: tydlig rad överst. Testaren väljer vilken testperson hen agerar som (bara i testmiljön). */
function StagingBar({ view }: { view: SessionView }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const actor = view.persona?.actor;
  const value = actor ? `${actor.userId}|${actor.role}` : "";
  // Valet i listan medan frågan om osparad text visas (annars hoppar listan tillbaka först när sidan laddats om).
  const [picked, setPicked] = useState(value);
  // Den valda testpersonen finns inte i listan (t.ex. en ekonom som valdes innan rollen stängdes för testaren): visa den ändå,
  // så att valet syns och testaren kan byta.
  const current = actor && !view.personas.some((p) => `${p.userId}|${p.role}` === value) ? { value, label: `${view.persona?.user.name ?? ""} – ${ROLE_LABEL[actor.role]}` } : null;
  const date = view.testNow ? `${WEEKDAYS[weekday(view.testNow)]} ${fmtDateFull(view.testNow)}` : null;

  const pick = async (v: string) => {
    const [userId, role] = v.split("|");
    // Fråga först (osparad text) och byt sedan. Stannar man kvar är ingenting bytt – och valet visar fortfarande samma person.
    if (!(await confirmLeaveDocument())) {
      setPicked(value);
      return;
    }
    setPicked(v);
    setBusy(true);
    setFailed(false);
    const { status } = await postJson("/api/session/impersonate", { userId, role }).catch(() => ({ status: 500 }));
    if (status === 200) return hardNavigate(stayOrStart(here(), role as Role, view.hidesCommercial));
    cancelLeaveDocument();
    setPicked(value);
    setBusy(false);
    setFailed(true);
  };

  return (
    <div
      data-print="hide"
      role="region"
      aria-label="Testmiljö"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-dashed border-antracit bg-ljusgra-ton2 px-4 py-1.5 text-small"
    >
      <span className="font-extrabold tracking-[0.06em] uppercase">Testmiljö</span>
      <span>
        Påhittade testdata{date ? ` · testdatum ${date}` : ""}
      </span>
      {view.isTester && view.personas.length > 0 && (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label htmlFor="test-persona" className="font-bold">
            Agera som:
          </label>
          <select id="test-persona" className="w-auto max-w-full py-1.5 text-small font-semibold" value={picked} disabled={busy} aria-busy={busy} onChange={(e) => {
              setPicked(e.target.value);
              void pick(e.target.value);
            }}>
            {current && (
              <option value={current.value} disabled>
                {current.label}
              </option>
            )}
            {view.personas.map((p) => (
              <option key={`${p.userId}|${p.role}`} value={`${p.userId}|${p.role}`}>
                {p.name} – {ROLE_LABEL[p.role]}
              </option>
            ))}
          </select>
          {view.impersonating && view.selfName && <span className="text-text-muted">Inloggad som {view.selfName} (testare)</span>}
          {failed && (
            <span role="alert" className="font-bold">
              Testpersonen kunde inte väljas. Försök igen.
            </span>
          )}
        </span>
      )}
      <span className="ml-auto">
        <FeedbackToolbar routes={APP_ROUTES} />
      </span>
    </div>
  );
}
