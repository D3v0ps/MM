"use client";
// Navigering som fungerar både i Next.js (riktiga URL:er) och i prototypen (hash-URL:er i en enda HTML-fil).
// Skärmar använder bara useNav() och <Link to="...">. URL:er innehåller aldrig personuppgifter – bara id:n.
import { createContext, useContext, type AnchorHTMLAttributes, type ComponentType, type MouseEvent, type ReactNode } from "react";

/**
 * Historikposten som visas. key följer posten (samma vid replace, ny vid push, postens egen vid tillbaka/framåt).
 * kind: load = sidan laddades (eller laddades om), push = ny post, replace = samma post med ny adress, pop = tillbaka/framåt.
 * Skalet (page-effects.tsx) använder den för skroll, fokus och titel vid sidbyte.
 */
export type NavEntry = { key: string; kind: "load" | "push" | "replace" | "pop" };

export type Nav = {
  /** Aktuell sökväg utan query, t.ex. '/arenden/case-260143' */
  path: string;
  query: URLSearchParams;
  push(to: string): void;
  replace(to: string): void;
  back(): void;
  /** href-attributet för en intern länk (prototypen: '#/…'). */
  href(to: string): string;
  /** Aktuell historikpost (saknas i enhetstester – räknas då som "load"). */
  entry?: NavEntry;
};

/** Ny nyckel för en historikpost: bara bokstäver och siffror (sparas i history.state och sessionStorage). */
export function newNavKey(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Vanligt vänsterklick utan ctrl/cmd/shift/alt, utan target och utan download – då navigerar appen själv. */
export function isPlainLeftClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  const a = e.currentTarget;
  const target = a.getAttribute("target");
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && (!target || target === "_self") && !a.hasAttribute("download");
}

// ---------------------------------------------------------------- Vakter före navigering
// Varje push/replace (och därmed varje Link) passerar vakterna. En vakt kan fråga användaren (t.ex. osparad text) och svara
// false för att stanna kvar. Utan vakter navigerar appen direkt (synkront).
export type BeforeNavigate = (to: string) => boolean | Promise<boolean>;
const guards = new Set<BeforeNavigate>();

/** Registrera en vakt. Returnerar en funktion som tar bort den. */
export function onBeforeNavigate(fn: BeforeNavigate): () => void {
  guards.add(fn);
  return () => {
    guards.delete(fn);
  };
}

/** true direkt när det inte finns några vakter, annars ett löfte (false = stanna kvar). */
export function runBeforeNavigate(to: string): true | Promise<boolean> {
  if (guards.size === 0) return true;
  return (async () => {
    for (const g of [...guards]) if (!(await g(to))) return false;
    return true;
  })();
}

/**
 * Målet när appen själv laddar om eller lämnar sidan (byte av testperson, utloggning). Vakterna frågar alltid för det –
 * också när sökvägen är densamma, eftersom allt på sidan laddas om.
 */
export const LEAVE_DOCUMENT = "about:leave";
let leavingDocument = false;

/**
 * Innan appen själv laddar om eller lämnar sidan: kör vakterna (frågar om osparad text). Anropas FÖRE det som inte går att
 * ångra, t.ex. att servern byter inloggad person – annars är bytet redan gjort om användaren väljer att stanna kvar.
 * true = fortsätt; då varnar inte heller webbläsaren (beforeunload) en gång till.
 */
export async function confirmLeaveDocument(): Promise<boolean> {
  const ok = await runBeforeNavigate(LEAVE_DOCUMENT);
  if (ok) leavingDocument = true;
  return ok;
}

/** Omladdningen blev inte av (t.ex. bytet misslyckades): varna som vanligt igen. */
export function cancelLeaveDocument(): void {
  leavingDocument = false;
}

/** true medan appen laddar om sidan efter att användaren redan har svarat på frågan (för beforeunload-varningarna). */
export function isLeavingDocument(): boolean {
  return leavingDocument;
}

/** Kör go() om vakterna tillåter navigeringen till `to`. Används av navigeringarna i appen och prototypen. */
export function guardedNavigate(to: string, go: () => void): void {
  const r = runBeforeNavigate(to);
  if (r === true) go();
  else void r.then((ok) => ok && go());
}

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

/** Som useNav, men null utanför en NavProvider (komponenter som också används utan navigering, t.ex. i tester). */
export function useNavOptional(): Nav | null {
  return useContext(NavContext)?.nav ?? null;
}

/**
 * Intern länk. `to` är en sökväg med ev. query, t.ex. '/arenden/case-1?flik=meddelanden'.
 * Vanligt klick: appen byter sida själv (nav.push – inget serveranrop, ingen omladdning). Ctrl/cmd-klick, mittenklick och
 * högerklick lämnas till webbläsaren (ny flik, länkmeny). Anroparens onClick körs först och kan stoppa med preventDefault.
 */
export function Link({ to, onClick, ...rest }: { to: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const v = useContext(NavContext);
  if (!v) throw new Error("NavProvider saknas");
  const L = v.LinkImpl;
  const nav = v.nav;
  return (
    <L
      href={nav.href(to)}
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || !isPlainLeftClick(e)) return;
        e.preventDefault();
        nav.push(to);
      }}
    />
  );
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
