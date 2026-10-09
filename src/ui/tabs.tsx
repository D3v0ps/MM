// Flikar (prototypens Tabs): tablist med piltangenter, Home och End. Skärmen visar själv innehållet för aktiv flik –
// lägg det i <TabPanel> för rätt koppling för skärmläsare. Flikval i URL:en: onChange={(id) => nav.replace(path(base, { flik: id }))}.
// Flikbytet hoppar aldrig: sidan står kvar, och om flikraden har skrollats ovanför skärmen läggs den överst (inte sidans topp).
// sticky: flikraden ligger kvar överst när man skrollar i panelen (under --mm-sticky-top, t.ex. mobilens fasta topprad).
// Får flikarna inte plats syns tonade kanter och pilknappar, och den valda fliken skrollas in i flikraden.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

export type TabDef<T extends string = string> = { id: T; label: ReactNode; count?: number | null; icon?: IconName };

const tabDomId = (base: string, id: string) => `${base}-tab-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

/**
 * Höjden som fasta element överst tar (CSS-variabeln --mm-sticky-top i px, 0 på skrivbordet). Layouten sätter den på smal
 * skärm, så den läses där innehållet ligger (#main ärver den).
 */
export function stickyTop(from?: Element | null): number {
  if (typeof window === "undefined") return 0;
  const el = from ?? document.getElementById("main") ?? document.documentElement;
  const v = parseFloat(getComputedStyle(el).getPropertyValue("--mm-sticky-top"));
  return Number.isFinite(v) ? v : 0;
}

/**
 * Efter ett flikbyte: håll flikraden i bild utan att sidan hoppar.
 * - Fast flikrad (sticky) och panelen börjar ovanför flikradens underkant: skrolla så att panelen börjar direkt under den.
 * - Flikraden ligger ovanför skärmen: skrolla så att den hamnar överst.
 * - Annars: ingenting.
 */
export function anchorTabs(list: HTMLElement | null, panelId: string | null, sticky: boolean): void {
  if (!list) return;
  const top = stickyTop();
  const t = list.getBoundingClientRect();
  const panel = panelId ? document.getElementById(panelId) : null;
  const p = panel?.getBoundingClientRect();
  if (sticky && t.top <= top + 1 && p && p.top < t.bottom - 1) window.scrollBy(0, p.top - t.bottom);
  else if (t.top < top - 1) window.scrollBy(0, t.top - top);
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  onIntent,
  ariaLabel = "Flikar",
  id,
  sticky,
  className,
}: {
  tabs: readonly TabDef<T>[];
  active: T;
  onChange: (id: T) => void;
  /**
   * Användaren pekar på, fokuserar eller rör en flik – förhämta flikens data. När en flik får fokus anropas den också för
   * grannflikarna: med piltangenterna byts fliken i samma tryck, så nästa flik behöver vara hämtad innan dess.
   */
  onIntent?: (id: T) => void;
  ariaLabel?: string;
  /** Ange samma id på TabPanel. */
  id?: string;
  /** Flikraden ligger kvar överst när man skrollar (deltagarkortet). */
  sticky?: boolean;
  className?: string;
}) {
  const auto = useId();
  const base = id ?? `t${auto.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const listRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  // Tonade kanter och pilknappar när flikarna inte får plats.
  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro?.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure, tabs.length]);

  // Den valda fliken i bild i flikraden (scrollTo på flikraden – scrollIntoView kan flytta hela fönstret).
  useEffect(() => {
    const el = listRef.current;
    const tab = el?.querySelector<HTMLElement>(`#${CSS.escape(tabDomId(base, active))}`);
    if (!el || !tab || el.scrollWidth <= el.clientWidth) return;
    const l = tab.offsetLeft - el.offsetLeft;
    if (l < el.scrollLeft + 40 || l + tab.offsetWidth > el.scrollLeft + el.clientWidth - 40) {
      el.scrollTo({ left: Math.max(0, l - 48) });
    }
  }, [active, base]);

  // Fast flikrad: dess höjd (med marginal) i --mm-tabs-sticky-h, så att det som får fokus med tangentbordet hamnar under
  // flikraden och inte bakom den (html:s scroll-padding-top i globals.css).
  useEffect(() => {
    const el = wrapRef.current;
    if (!sticky || !el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty("--mm-tabs-sticky-h", `${Math.ceil(el.getBoundingClientRect().height) + 8}px`);
    set();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(set);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty("--mm-tabs-sticky-h");
    };
  }, [sticky]);

  // Flikradens läge på skärmen när användaren byter flik (före bytet) – efter bytet står den kvar där. Webbläsarens
  // skrollförankring kan annars flytta sidan när innehållet under flikraden blir kortare eller längre.
  const before = useRef<number | null>(null);
  const change = (next: T) => {
    before.current = wrapRef.current?.getBoundingClientRect().top ?? null;
    onChange(next);
  };

  // Förankring efter flikbyte (inte vid första renderingen).
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const was = before.current;
    before.current = null;
    const wrap = wrapRef.current;
    if (wrap && was !== null && was >= stickyTop() - 1) {
      const delta = wrap.getBoundingClientRect().top - was;
      if (Math.abs(delta) > 1) window.scrollBy(0, delta);
    }
    anchorTabs(wrap, id ? `${base}-panel` : null, !!sticky);
    // Fokus på body (t.ex. länken som byttes bort försvann): fokusera panelen utan att skrolla.
    const a = document.activeElement;
    if (id && (!a || a === document.body || !document.contains(a))) document.getElementById(`${base}-panel`)?.focus({ preventScroll: true });
  }, [active, base, id, sticky]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === active);
    let j: number | null = null;
    if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
    if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") j = 0;
    if (e.key === "End") j = tabs.length - 1;
    if (j === null) return;
    e.preventDefault();
    change(tabs[j].id);
    const target = j;
    setTimeout(() => listRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[target]?.focus({ preventScroll: true }), 0);
  };
  const nudge = (dir: -1 | 1) => {
    const el = listRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8 });
  };
  const arrow = "absolute top-0 bottom-0.5 z-10 flex w-11 cursor-pointer items-center border-0 bg-transparent text-antracit";
  return (
    <div ref={wrapRef} data-tabs-sticky={sticky ? "" : undefined} className={cn("relative", sticky && "sticky top-[var(--mm-sticky-top,0px)] z-20 bg-vit")}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKey}
        className={cn("flex gap-0.5 overflow-x-auto border-b-2 border-ljusgra [scrollbar-width:thin]", className)}
      >
        {tabs.map((t, i) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={tabDomId(base, t.id)}
              aria-selected={on}
              aria-controls={id ? `${base}-panel` : undefined}
              tabIndex={on ? 0 : -1}
              onClick={() => change(t.id)}
              onPointerEnter={onIntent ? () => onIntent(t.id) : undefined}
              onFocus={
                onIntent
                  ? () => {
                      onIntent(t.id);
                      if (tabs.length > 1) {
                        onIntent(tabs[(i + 1) % tabs.length].id);
                        onIntent(tabs[(i - 1 + tabs.length) % tabs.length].id);
                      }
                    }
                  : undefined
              }
              onTouchStart={onIntent ? () => onIntent(t.id) : undefined}
              className={cn(
                "-mb-0.5 inline-flex min-h-11 cursor-pointer items-center gap-1.5 border-0 border-b-[3px] border-transparent bg-transparent px-3.5 py-2.5 text-ui font-semibold whitespace-nowrap text-text-muted",
                "hover:text-antracit aria-selected:border-rod aria-selected:text-antracit portal:text-body",
              )}
            >
              {t.icon && <Icon name={t.icon} />}
              {t.label}
              {t.count != null && t.count !== 0 && (
                <>
                  <span className="sr-only"> </span>
                  <span className="rounded-full bg-ljusgra px-[7px] text-label text-antracit portal:text-body">{t.count}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      {/* Fler flikar åt sidan: tonad kant och pilknapp (för mus; tangentbordet använder piltangenterna i flikraden). */}
      {edge.left && (
        <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => nudge(-1)} className={cn(arrow, "left-0 justify-start bg-linear-to-r from-vit from-55% to-transparent pl-1")}>
          <Icon name="chevron-left" />
        </button>
      )}
      {edge.right && (
        <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => nudge(1)} className={cn(arrow, "right-0 justify-end bg-linear-to-l from-vit from-55% to-transparent pr-1")}>
          <Icon name="chevron-right" />
        </button>
      )}
    </div>
  );
}

/** Innehållet för aktiv flik. tabsId = samma id som på Tabs, active = aktiv flik. */
export function TabPanel({ tabsId, active, children, className }: { tabsId: string; active: string; children?: ReactNode; className?: string }) {
  return (
    <div
      role="tabpanel"
      id={`${tabsId}-panel`}
      aria-labelledby={tabDomId(tabsId, active)}
      tabIndex={0}
      // Ingen skrollförankring: webbläsaren ska inte flytta sidan när panelens innehåll byts eller växer.
      className={cn("min-w-0 [overflow-anchor:none]", className)}
    >
      {children}
    </div>
  );
}
