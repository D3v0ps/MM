// Rutter. Varje område (src/features/<område>/routes.ts) exporterar sina rutter; route-table.ts samlar dem.
// Samma tabell används av Next.js (catch-all-rutt) och av prototypen (hash-navigering) – därför speglar prototypen appen exakt.
import type { ComponentType } from "react";
import type { Role } from "@/api/roles";
import { matchPath } from "./nav";

export type ScreenProps = { params: Record<string, string>; query: URLSearchParams };

export type RouteDef = {
  /** Sökvägsmönster, t.ex. '/arenden/:caseId' eller '/avstamning/:caseId?' */
  path: string;
  /** Sidans titel (dokumenttitel och brödsmulor). */
  title: string | ((params: Record<string, string>, query: URLSearchParams) => string);
  roles: readonly Role[];
  /** Layout: MB:s arbetsyta med sidopanel, kommunens portal, deltagarens mobilvy eller prototypens egna sidor. */
  area: "mb" | "portal" | "puls" | "om";
  screen: ComponentType<ScreenProps>;
  /** Utan inloggning (t.ex. portalens inloggning och pulslänken). */
  public?: boolean;
};

/** Startsida per roll. */
export const START_PATH: Record<Role, string> = {
  admin: "/admin/avtal",
  avtalsansvarig: "/start",
  samordnare: "/start",
  coach: "/min-vecka",
  handledare: "/handledare",
  chef: "/ledning",
  ekonom: "/ekonomi",
  kommun_handlaggare: "/portal",
  kommun_chef: "/portal/bestallarrapport",
  deltagare: "/puls",
};

export type RouteMatch = { route: RouteDef; params: Record<string, string> };

/** Första rutt som matchar. Mer specifika mönster ska stå före mer generella i tabellen. */
export function resolveRoute(routes: readonly RouteDef[], path: string): RouteMatch | null {
  for (const route of routes) {
    const params = matchPath(route.path, path);
    if (params) return { route, params };
  }
  return null;
}

export const titleOf = (m: RouteMatch, query: URLSearchParams): string =>
  typeof m.route.title === "function" ? m.route.title(m.params, query) : m.route.title;
