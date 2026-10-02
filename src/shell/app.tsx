"use client";
// Appens skal: väljer rutt, kontrollerar roll och renderar skärmen i rätt layout.
// Används av både Next.js (src/app/client-root.tsx) och prototypen (src/demo/main.tsx).
import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { ROLE_LABEL, ROLES } from "@/api/roles";
import { PerspectiveLink } from "@/ui";
import { useNav, Link } from "./nav";
import { isAuthenticated, useSession } from "./session";
import { DemoOnly } from "./runtime";
import { isTesterHiddenPath, TESTER_HIDDEN_PAGE, TESTER_HIDDEN_TEXT } from "@/api/tester-access";
import { loginPathFor, resolveRoute, startPathFor, titleOf, type RouteDef, type RouteMatch } from "./routes";
import { LayoutFor } from "./layouts";

export function App({ routes }: { routes: readonly RouteDef[] }) {
  const nav = useNav();
  const session = useSession();
  const { actor } = session;
  const signedIn = isAuthenticated(session);
  const start = signedIn ? startPathFor(actor.role, session.hidesCommercial) : loginPathFor(nav.path);
  const match = resolveRoute(routes, nav.path);
  // Inte inloggad: bara publika sidor. Allt annat leder till rätt inloggning (portalen eller MB).
  const mustLogin = !signedIn && !(match && match.route.public);

  useEffect(() => {
    if (nav.path === "/" || nav.path === "") nav.replace(start);
    else if (mustLogin) nav.replace(`${loginPathFor(nav.path)}?till=${encodeURIComponent(nav.path)}`);
  }, [nav, start, mustLogin]);

  const hiddenForTester = signedIn && !!session.hidesCommercial && isTesterHiddenPath(nav.path);
  const title = hiddenForTester ? TESTER_HIDDEN_TEXT : match ? titleOf(match, nav.query) : "Sidan finns inte";
  useEffect(() => {
    document.title = `${title} – Miljonmatch`;
  }, [title]);

  if (nav.path === "/" || nav.path === "" || mustLogin) return null;
  if (!match) {
    return (
      <LayoutFor match={notFoundMatch(nav.path)}>
        <Problem title="Sidan finns inte" text="Adressen leder inte till någon sida." start={start} />
      </LayoutFor>
    );
  }
  if (!match.route.public && !match.route.roles.includes(actor.role)) {
    return (
      <LayoutFor match={match}>
        <Problem title="Du har inte behörighet till den här sidan" text={`Din roll (${ROLE_LABEL[actor.role]}) har inte tillgång till sidan.`} start={start}>
          <DemoOnly>
            {/* Knapparna får radbrytas: "Visa som kommunens handläggare" ryms inte på en rad vid 400 px. */}
            <div className="mt-6 flex flex-wrap gap-3 [&_button]:whitespace-normal">
              {match.route.roles.map((r) => (
                <PerspectiveLink key={r} role={r} to={nav.path + (nav.query.toString() ? `?${nav.query}` : "")} label={`Visa som ${ROLE_LABEL[r].toLowerCase()}`} />
              ))}
            </div>
          </DemoOnly>
        </Problem>
      </LayoutFor>
    );
  }
  // Begränsad testare (testmiljön): avtalssidan och Ekonomi är stängda. Servern nekar dessutom frågorna bakom sidorna.
  if (hiddenForTester) {
    return (
      <LayoutFor match={match}>
        <Problem title={TESTER_HIDDEN_PAGE.replace(/\.$/, "")} text="Sidan visar priser, belopp eller avtalets villkor. De uppgifterna visas inte för testare." start={start} />
      </LayoutFor>
    );
  }
  return <Screen match={match} />;
}

function Screen({ match }: { match: RouteMatch }) {
  const nav = useNav();
  const S = match.route.screen;
  const key = `${match.route.path}|${JSON.stringify(match.params)}`;
  return (
    <LayoutFor match={match}>
      <ErrorBoundary key={key}>
        <S params={match.params} query={nav.query} />
      </ErrorBoundary>
    </LayoutFor>
  );
}

/** Layout för en adress som inte finns: välj efter sökvägens början så att rätt navigering syns. */
/** "Sidan finns inte" i rätt layout: portalen, de publika länkarna (puls och deltagarens inspelningslänk /rost), prototypens sidor eller MB. */
export function notFoundMatch(p: string): RouteMatch {
  const publicLink = p.startsWith("/puls") || p === "/rost" || p.startsWith("/rost/");
  const area: RouteDef["area"] = p.startsWith("/portal") ? "portal" : publicLink ? "puls" : p.startsWith("/om") ? "om" : "mb";
  return { route: { path: p, title: "Sidan finns inte", roles: ROLES, area, screen: () => null }, params: {} };
}

function Problem({ title, text, start, children }: { title: string; text: string; start: string; children?: ReactNode }) {
  return (
    <div role="alert" className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2">{text}</p>
      <p className="mt-4">
        <Link to={start} className="underline">Till startsidan</Link>
      </p>
      {children}
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Inga personuppgifter i loggar – bara felets namn och komponentstacken.
    console.error("Skärmen kunde inte visas", error.name, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="p-8">
          <h1 className="text-xl font-bold">Något gick fel när sidan skulle visas</h1>
          <p className="mt-2">Försök ladda om sidan. Om felet finns kvar, kontakta systemadministratören.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
