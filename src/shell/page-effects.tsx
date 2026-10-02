"use client";
// Det skalet gör vid sidbyte – samma i appen och prototypen (navigeringen är grund i båda, se src/shell/nav.tsx):
//   Ny sida (push/replace till en annan sida): skrolla till toppen (eller till #id i adressen), flytta fokus till sidans
//     rubrik och meddela skärmläsare sidans titel.
//   Bara query ändras (flik, filter, månad): ingenting – skärmen sköter sig själv och fokus stannar där det är.
//   Tillbaka/framåt och omladdning: återställ skrollen som sparades för historikposten. Tillbaka/framåt till en annan sida
//     flyttar dessutom fokus till sidans rubrik (utan att skrolla) och meddelar skärmläsare sidans titel.
// Skrollen sparas per historikpost (nav.entry.key) i sessionStorage – bara siffror – med reserv i minnet (artefaktens ram
// kan sakna webblagring). Titeln: ruttens titel, eller skärmens egen via usePageTitle (t.ex. "Deltagarkort BOT-26-0143").
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { Nav } from "./nav";

// ---------------------------------------------------------------- Sparad skroll per historikpost
const PREFIX = "mm:scroll:";
const ORDER_KEY = "mm:scroll:order";
const MAX_KEYS = 50;
const memory = new Map<string, number>();

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveScroll(key: string, y: number): void {
  if (!key) return;
  const v = Math.max(0, Math.round(y));
  memory.set(key, v);
  const s = storage();
  if (!s) return;
  try {
    s.setItem(PREFIX + key, String(v));
    const order = (s.getItem(ORDER_KEY) ?? "").split(",").filter((k) => k && k !== key);
    order.push(key);
    while (order.length > MAX_KEYS) {
      const old = order.shift();
      if (old) s.removeItem(PREFIX + old);
    }
    s.setItem(ORDER_KEY, order.join(","));
  } catch {
    /* full eller spärrad webblagring – minnet räcker */
  }
}

export function readScroll(key: string): number | null {
  if (!key) return null;
  try {
    const raw = storage()?.getItem(PREFIX + key);
    if (raw != null && /^\d+$/.test(raw)) return Number(raw);
  } catch {
    /* ignoreras */
  }
  return memory.get(key) ?? null;
}

/**
 * Återställ skrollen när sidan har blivit tillräckligt lång och inte längre laddar (#main [data-loading]), längst 3 s.
 * Avbryts om användaren själv skrollar, trycker eller använder tangentbordet. Returnerar en avbrytfunktion.
 */
export function restoreScroll(target: number): () => void {
  let done = false;
  const t0 = performance.now();
  const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  const stop = () => {
    done = true;
    for (const ev of events) window.removeEventListener(ev, stop, true);
  };
  for (const ev of events) window.addEventListener(ev, stop, { capture: true, passive: true });
  // Klart när sidan har stått still på målet i några bildrutor (innehåll ovanför kan fortfarande byggas om).
  let steady = 0;
  const tick = () => {
    if (done) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const busy = !!document.querySelector("#main [data-loading]");
    window.scrollTo({ top: Math.max(0, Math.min(target, max)), behavior: "instant" });
    steady = max >= target && !busy ? steady + 1 : 0;
    if (steady >= 3 || performance.now() - t0 > 3000) {
      stop();
      return;
    }
    requestAnimationFrame(tick);
  };
  tick();
  return stop;
}

// ---------------------------------------------------------------- Sidans titel
type TitleToken = { text: string };
let titles: TitleToken[] = [];
const titleListeners = new Set<() => void>();
const emitTitle = () => titleListeners.forEach((l) => l());
const currentTitle = () => titles[titles.length - 1]?.text ?? null;

/** Skärmens egen titel (utan " – Miljonmatch"). null = ruttens titel. Försvinner när skärmen lämnas. */
export function usePageTitle(text: string | null | undefined): void {
  useEffect(() => {
    if (!text) return;
    const token: TitleToken = { text };
    titles = [...titles, token];
    emitTitle();
    return () => {
      titles = titles.filter((t) => t !== token);
      emitTitle();
    };
  }, [text]);
}

/** Titeln som skärmen har satt (för skalet). */
export function usePageTitleOverride(): string | null {
  return useSyncExternalStore(
    (l) => {
      titleListeners.add(l);
      return () => titleListeners.delete(l);
    },
    currentTitle,
    () => null,
  );
}

// ---------------------------------------------------------------- Meddelande och fokus
export const ROUTE_STATUS_ID = "mm-route-status";

/** Läs upp text i skalets levande region (#mm-route-status). Töms först, så att samma text läses upp igen. */
export function announce(text: string): void {
  const el = document.getElementById(ROUTE_STATUS_ID);
  if (!el) return;
  el.textContent = "";
  window.setTimeout(() => {
    el.textContent = text;
  }, 60);
}

/**
 * Fokus till sidans rubrik (h1[data-page-title]), annars #main. Skärmen kan byta ut rubriken när data har kommit (laddning →
 * innehåll): under en kort stund flyttas fokus till den nya rubriken om fokus har tappats. Slutar när användaren själv trycker
 * eller klickar.
 */
function focusPageTitle(): () => void {
  let stopped = false;
  const t0 = performance.now();
  const events = ["keydown", "pointerdown"] as const;
  const stop = () => {
    stopped = true;
    for (const ev of events) window.removeEventListener(ev, stop, true);
  };
  for (const ev of events) window.addEventListener(ev, stop, { capture: true, passive: true });
  const main = document.getElementById("main");
  let first = true;
  const tick = () => {
    if (stopped) return;
    const a = document.activeElement;
    // Första gången alltid (fokus ligger kvar på länken man klickade på), sedan bara om fokus har tappats.
    const lost = first || !a || a === document.body || a === main || !document.contains(a);
    first = false;
    if (lost) {
      const h1 = document.querySelector<HTMLElement>("#main h1[data-page-title]");
      if (h1) h1.focus({ preventScroll: true });
      else if (a !== main) main?.focus({ preventScroll: true });
    }
    if (performance.now() - t0 > 2000) {
      stop();
      return;
    }
    requestAnimationFrame(tick);
  };
  tick();
  return stop;
}

// ---------------------------------------------------------------- Kroken (körs i App)
let activeKey = "";

/**
 * pageKey = vilken sida som visas (rutt + parametrar; samma vid byte av bara query). title = sidans titel för
 * uppläsningen. hashTargets = appen får skrolla till #id i adressen (i prototypen är hashen själva rutten).
 */
export function usePageEffects(nav: Nav, pageKey: string, title: string, hashTargets: boolean): void {
  const prev = useRef<{ pageKey: string; key: string } | null>(null);
  const cancel = useRef<(() => void)[]>([]);
  const entry = nav.entry ?? { key: "", kind: "load" as const };

  // Spara positionen för posten som visas (strypt till en gång per bildruta) och när sidan lämnas.
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        saveScroll(activeKey, window.scrollY);
      });
    };
    const onHide = () => saveScroll(activeKey, window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onHide);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  useLayoutEffect(() => {
    const p = prev.current;
    if (p && p.pageKey === pageKey && p.key === entry.key) return;
    prev.current = { pageKey, key: entry.key };
    activeKey = entry.key;
    for (const c of cancel.current) c();
    cancel.current = [];
    const newPage = !p || p.pageKey !== pageKey;

    if (entry.kind === "pop" || (entry.kind === "load" && !p)) {
      const y = readScroll(entry.key);
      if (y != null && y > 0) cancel.current.push(restoreScroll(y));
      else if (entry.kind === "pop" && newPage) window.scrollTo(0, 0);
      // Tillbaka/framåt till en annan sida: som ett vanligt sidbyte för tangentbord och skärmläsare – fokus på sidans rubrik
      // (utan att skrolla, så att den återställda platsen står kvar) och sidans titel uppläst.
      if (entry.kind === "pop" && newPage && p?.pageKey) {
        cancel.current.push(focusPageTitle());
        announce(title);
      }
      return;
    }
    // push/replace till samma sida (bara query): skärmen sköter skroll och fokus själv.
    if (!p || !newPage) return;
    // Från en vidarebefordran ("/" till startsidan, till inloggningen): ingen sida visades – flytta inte fokus.
    if (!p.pageKey) return;
    const id = hashTargets ? decodeURIComponent(window.location.hash.slice(1)) : "";
    const target = id ? document.getElementById(id) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else window.scrollTo(0, 0);
    cancel.current.push(focusPageTitle());
    announce(title);
    // nav är objektet för den aktuella adressen; pageKey/title följer det.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, pageKey]);
}
