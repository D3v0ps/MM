"use client";
// Appens skal: väljer rutt, kontrollerar roll och renderar skärmen i rätt layout.
// Används av både Next.js (src/app/client-root.tsx) och prototypen (src/demo/main.tsx).
import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { ROLE_LABEL } from "@/api/roles";
import { useNav, Link } from "./nav";
import { useSession } from "./session";
import { resolveRoute, START_PATH, titleOf, type RouteDef, type RouteMatch } from "./routes";
import { LayoutFor } from "./layouts";

export function App({ routes }: { routes: readonly RouteDef[] }) {
  const nav = useNav();
  const { actor } = useSession();
  const start = START_PATH[actor.role];

  useEffect(() => {
    if (nav.path === "/" || nav.path === "") nav.replace(start);
  }, [nav, start]);

  const match = resolveRoute(routes, nav.path);
  const title = match ? titleOf(match, nav.query) : "Sidan finns inte";
  useEffect(() => {
    document.title = `${title} – Miljonmatch`;
  }, [title]);

  if (nav.path === "/" || nav.path === "") return null;
  if (!match) return <Problem title="Sidan finns inte" text="Adressen leder inte till någon sida." start={start} />;
  if (!match.route.public && !match.route.roles.includes(actor.role)) {
    return (
      <LayoutFor match={match}>
        <Problem title="Du har inte behörighet till den här sidan" text={`Din roll (${ROLE_LABEL[actor.role]}) har inte tillgång till sidan.`} start={start} />
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

function Problem({ title, text, start }: { title: string; text: string; start: string }) {
  return (
    <div role="alert" className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2">{text}</p>
      <p className="mt-4">
        <Link to={start} className="underline">Till startsidan</Link>
      </p>
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
