"use client";
// Navigering i Next.js: riktiga URL:er, men varje byte är grunt (history.pushState/replaceState). Alla sidor är samma
// klientträd (ClientRoot i (app)/layout.tsx), så ett sidbyte behöver inget serveranrop: Next synkar usePathname och
// useSearchParams med historiken (node_modules/next/dist/docs/01-app/02-guides/single-page-applications.md, "Shallow routing
// on the client").
// Tillbaka/framåt mellan poster som skapats i det här dokumentet hanteras av Next utan serveranrop: Nexts patchade pushState
// kopierar in dokumentets interna träd (__NA, __PRIVATE_NEXTJS_INTERNALS_TREE) i varje post, och det trädet finns i Nexts cache.
// Poster från ett tidigare dokument (före en omladdning, eller när man kommer tillbaka från en annan webbplats utan
// webbläsarens sidcache) bär det dokumentets träd. Med dem visar Next fel sida och fel titel efter ett serveranrop – därför
// laddas sidan om på postens adress i stället (som Next själv gör med poster utan __NA). Skrollen återställs efter omladdningen.
// Kontrollen måste köras FÖRE Nexts popstate-lyssnare. Lyssnare på window körs i den ordning de lades till (också med
// capture), och Next lägger sin vid hydreringen – därför ligger den i ett skript som körs före hydreringen
// (POP_GUARD_SCRIPT, next/script beforeInteractive i src/app/layout.tsx). Skriptet läser nycklarna i OWN_KEYS_GLOBAL.
// Skalet sköter det Next annars gör vid sidbyte: skroll, fokus, titel och meddelande till skärmläsare (src/shell/page-effects.tsx).
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, type ReactNode } from "react";
import { guardedNavigate, newNavKey, NavProvider, type LinkImpl, type Nav, type NavEntry } from "@/shell/nav";
import { OWN_KEYS_GLOBAL } from "./pop-guard";

/** Vanlig länk: klicket fångas av <Link> (src/shell/nav.tsx). Ingen next/link – den förhämtar sidan från servern. */
const PlainLink: LinkImpl = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);

type MmState = { mmKey?: string } & Record<string, unknown>;
const stateKey = (): string | undefined => {
  const s = window.history.state as MmState | null;
  return typeof s?.mmKey === "string" ? s.mmKey : undefined;
};

/** Historikposten som visas (en navigering i taget i hela fönstret, därför på modulnivå). */
let entry: NavEntry | null = null;
/** Nycklarna för posterna som skapats (push) eller laddats i det här dokumentet – bara de kan Next visa utan omladdning. */
const ownKeys = new Set<string>();
if (typeof window !== "undefined") (window as unknown as Record<string, unknown>)[OWN_KEYS_GLOBAL] = ownKeys;

/** Första laddningen: postens sparade nyckel (omladdning) eller en ny som skrivs in i posten. */
function currentEntry(): NavEntry {
  if (typeof window === "undefined") return { key: "ssr", kind: "load" };
  const saved = stateKey();
  if (entry) {
    // Posten har bytts utan att appen själv navigerade: tillbaka/framåt. (React kan rita om redan i Nexts popstate-lyssnare,
    // före vår – därför avgörs det också här, när adressen läses.)
    if (saved && saved !== entry.key) entry = { key: saved, kind: "pop" };
    return entry;
  }
  const key = saved ?? newNavKey();
  // Den spridda __NA gör att Next inte behandlar anropet som en navigering.
  if (!saved) window.history.replaceState({ ...((window.history.state as object | null) ?? {}), mmKey: key }, "", window.location.href);
  entry = { key, kind: "load" };
  ownKeys.add(key);
  return entry;
}

export function NextNavProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const search = useSearchParams();

  useEffect(() => {
    window.history.scrollRestoration = "manual";
    // Tillbaka/framåt: posten som visas nu. Next uppdaterar sökvägen i en transition, så det hinner sättas före renderingen.
    // (Den här lyssnaren körs efter Nexts – därför avgörs "pop" också i currentEntry().)
    const onPop = () => {
      const key = stateKey();
      if (key && !ownKeys.has(key)) {
        // Reserv om skriptet före hydreringen saknas: posten kommer från ett tidigare dokument – ladda om på dess adress.
        window.location.reload();
        return;
      }
      entry = { key: key ?? newNavKey(), kind: "pop" };
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const searchStr = search?.toString() ?? "";
  const nav = useMemo<Nav>(() => {
    const current = () => window.location.pathname + window.location.search;
    const go = (to: string, mode: "push" | "replace") =>
      guardedNavigate(to, () => {
        const target = new URL(to, window.location.href);
        const same = target.pathname + target.search === current();
        if (mode === "push" && !same) {
          const key = newNavKey();
          entry = { key, kind: "push" };
          ownKeys.add(key);
          window.history.pushState({ mmKey: key }, "", to);
        } else {
          entry = { key: currentEntry().key, kind: "replace" };
          window.history.replaceState({ mmKey: entry.key }, "", to);
        }
      });
    return {
      path: pathname,
      query: new URLSearchParams(searchStr),
      push: (to) => go(to, "push"),
      replace: (to) => go(to, "replace"),
      back: () => window.history.back(),
      href: (to) => to,
      entry: currentEntry(),
    };
  }, [pathname, searchStr]);
  return (
    <NavProvider nav={nav} LinkImpl={PlainLink}>
      {children}
    </NavProvider>
  );
}
