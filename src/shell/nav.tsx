"use client";
// Navigering som fungerar både i Next.js (riktiga URL:er) och i prototypen (hash-URL:er i en enda HTML-fil).
// Skärmar använder bara useNav() och <Link to="...">. URL:er innehåller aldrig personuppgifter – bara id:n.
import { createContext, useContext, type AnchorHTMLAttributes, type ComponentType, type ReactNode } from "react";

export type Nav = {
  /** Aktuell sökväg utan query, t.ex. '/arenden/case-260143' */
  path: string;
  query: URLSearchParams;
  push(to: string): void;
  replace(to: string): void;
  back(): void;
  /** href-attributet för en intern länk (prototypen: '#/…'). */
  href(to: string): string;
};

export type LinkImpl = ComponentType<{ href: string; className?: string; children?: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>>;

const NavContext = createContext<{ nav: Nav; LinkImpl: LinkImpl } | null>(null);

export function NavProvider({ nav, LinkImpl, children }: { nav: Nav; LinkImpl: LinkImpl; children: ReactNode }) {
  return <NavContext.Provider value={{ nav, LinkImpl }}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const v = useContext(NavContext);
  if (!v) throw new Error("NavProvider saknas");
  return v.nav;
}

/** Intern länk. `to` är en sökväg med ev. query, t.ex. '/arenden/case-1?flik=meddelanden'. */
export function Link({ to, ...rest }: { to: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const v = useContext(NavContext);
  if (!v) throw new Error("NavProvider saknas");
  const L = v.LinkImpl;
  return <L href={v.nav.href(to)} {...rest} />;
}

/** Bygg en sökväg med query: path('/arenden', { flik: 'x' }) */
export function path(base: string, query?: Record<string, string | number | null | undefined | false>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== null && v !== undefined && v !== false && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

// ---------------------------------------------------------------- Mönstermatchning av rutter
/** '/arenden/:caseId' matchar '/arenden/case-1' -> { caseId: 'case-1' }. ':x?' är valfritt sista segment. */
export function matchPath(pattern: string, actual: string): Record<string, string> | null {
  const ps = pattern.split("/").filter(Boolean);
  const as = actual.split("/").filter(Boolean);
  const params: Record<string, string> = {};
  for (let i = 0; i < Math.max(ps.length, as.length); i++) {
    const p = ps[i];
    const a = as[i];
    if (p === undefined) return null;
    if (p.startsWith(":")) {
      const optional = p.endsWith("?");
      const name = p.slice(1, optional ? -1 : undefined);
      if (a === undefined) {
        if (optional) continue;
        return null;
      }
      params[name] = decodeURIComponent(a);
      continue;
    }
    if (p !== a) return null;
  }
  return params;
}

// ---------------------------------------------------------------- Hash-navigering (prototypen)
/** Läs '#/arenden/x?flik=y' -> { path, query } */
export function parseHash(hash: string): { path: string; query: URLSearchParams } {
  const h = hash.replace(/^#/, "") || "/";
  const [p, q = ""] = h.split("?");
  return { path: p.startsWith("/") ? p : `/${p}`, query: new URLSearchParams(q) };
}
