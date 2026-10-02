// Sidhuvud, kort och sektioner (prototypens Page, Card och Section).
import type { ReactNode } from "react";
import { Link } from "@/shell/nav";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";
import { Dot, Eyebrow } from "./layout";

export type Crumb = { label: string; to?: string };

export type PageProps = {
  /** Sidrubrik (versaler, röd punkt). */
  title: ReactNode;
  /** Liten versal rad ovanför rubriken, t.ex. "Samordnare · Sara Lindqvist". */
  eyebrow?: ReactNode;
  /** Ingress under rubriken. */
  lead?: ReactNode;
  /** Knappar till höger om rubriken. */
  actions?: ReactNode;
  /** Brödsmulor: [{ label: "Ärenden", to: "/arenden" }, { label: "BOT-26-0143" }]. */
  crumbs?: Crumb[];
  children?: ReactNode;
  className?: string;
};

/** Sida i MB:s arbetsyta: max 1240 px bred, rubrik med röd punkt. Använd en Page per skärm. */
export function Page({ title, eyebrow, lead, actions, crumbs, children, className }: PageProps) {
  return (
    <div className={cn("mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-8 pt-7 pb-24 max-[900px]:px-4 max-[900px]:pt-5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          {crumbs && crumbs.length > 0 && (
            <nav aria-label="Brödsmulor" className="flex flex-wrap items-center gap-1.5 text-small text-text-muted">
              {crumbs.map((c, i) => (
                <span key={`${i}-${c.label}`} className="flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden="true">/</span>}
                  {c.to ? (
                    <Link to={c.to} className="inline-flex min-h-11 items-center px-1 underline">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          {/* tabIndex -1 och data-page-title: skalet flyttar fokus hit vid sidbyte (src/shell/page-effects.tsx). */}
          <h1 tabIndex={-1} data-page-title="" className="flex items-center gap-2.5 text-h1 font-extrabold uppercase tracking-[0.03em]">
            <Dot className="size-2.5" />
            {title}
          </h1>
          {lead && <p className="max-w-[70ch] text-text-muted">{lead}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

const CARD_TONE = {
  red: "border-rod shadow-[inset_4px_0_0_var(--color-rod)]",
  blue: "border-bla shadow-[inset_4px_0_0_var(--color-bla)]",
  sub: "bg-ljusgra-ton",
} as const;

export type CardProps = {
  title?: ReactNode;
  icon?: IconName;
  /** Knappar/länkar till höger i kortets huvud. */
  actions?: ReactNode;
  /** red = kräver åtgärd (röd kant) · blue = klart/positivt (blå kant) · sub = tonad bakgrund. */
  tone?: keyof typeof CARD_TONE;
  /** Sidfot med knappar. */
  foot?: ReactNode;
  /** Ingen utfyllnad i kroppen (för tabeller och listor som går kant i kant). */
  flush?: boolean;
  id?: string;
  /** Rubriknivå (standard h2). */
  titleAs?: "h2" | "h3";
  /** Mål när kortet öppnas från deltagarkortets tidslinje (?mal=). */
  "data-mal"?: string;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
};

/** Kort med versal rubrik. Rubriken är en h2 (eller h3 med titleAs). */
export function Card({ title, icon, actions, tone, foot, flush, id, titleAs: H = "h2", className, bodyClassName, children, "data-mal": mal }: CardProps) {
  return (
    <section id={id} data-mal={mal} className={cn("min-w-0 rounded-card border border-ljusgra bg-vit", tone && CARD_TONE[tone], className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ljusgra px-[18px] py-3.5 portal:px-5">
          {title && (
            // Kort med id: rubriken kan ta emot fokus (focusSection – t.ex. en ruta på Min vecka som leder hit).
            <H
              id={id ? `${id}-rubrik` : undefined}
              tabIndex={id ? -1 : undefined}
              className="flex items-center gap-2 text-label font-extrabold uppercase tracking-[0.1em] portal:text-body portal:tracking-[0.08em]"
            >
              {icon && <Icon name={icon} />}
              {title}
            </H>
          )}
          <span className="flex-1" />
          {actions}
        </div>
      )}
      <div className={cn("min-w-0", flush ? "p-0" : "px-[18px] py-4 portal:px-5 portal:py-[18px]", bodyClassName)}>{children}</div>
      {foot && <div className="flex flex-wrap items-center gap-2.5 border-t border-ljusgra px-[18px] py-3 portal:px-5">{foot}</div>}
    </section>
  );
}

/**
 * Skrolla till ett avsnitt (element med id) och flytta fokus till dess rubrik – utan att ändra adressen (prototypens
 * adress är rutten). Används av knappar som leder till ett avsnitt längre ned på samma sida.
 */
export function focusSection(id: string): void {
  const sec = document.getElementById(id);
  if (!sec) return;
  const h = sec.querySelector<HTMLElement>("h2, h3") ?? sec;
  if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  sec.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
  h.focus({ preventScroll: true });
}

/**
 * Fokus till elementet med id – och igen under en kort stund om det byts ut eller fokus tappas (t.ex. när listan hämtas om
 * efter en åtgärd och knappen man tryckte på försvinner). Slutar när användaren själv trycker eller klickar.
 */
export function focusSoon(id: string, ms = 1500): void {
  if (typeof window === "undefined") return;
  const t0 = performance.now();
  let stopped = false;
  const stop = () => {
    stopped = true;
    window.removeEventListener("keydown", stop, true);
    window.removeEventListener("pointerdown", stop, true);
  };
  window.addEventListener("keydown", stop, true);
  window.addEventListener("pointerdown", stop, true);
  let first = true;
  const tick = () => {
    if (stopped) return;
    const el = document.getElementById(id);
    const a = document.activeElement;
    if (el && (first || !a || a === document.body || !a.isConnected) && a !== el) {
      if (!el.hasAttribute("tabindex") && !el.matches("a[href], button, input, select, textarea")) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: false });
      first = false;
    }
    if (performance.now() - t0 > ms) {
      stop();
      return;
    }
    requestAnimationFrame(tick);
  };
  tick();
}

/**
 * Fokus till rubriken i avsnittet (section) som innehåller elementet – t.ex. när ett formulär i avsnittet försvinner efter
 * att det sparats. Sidans rubrik om inget avsnitt finns.
 */
export function focusSectionOf(el: Element | null | undefined): void {
  const h = el?.closest("section")?.querySelector<HTMLElement>("h2, h3") ?? document.querySelector<HTMLElement>("#main h1");
  if (!h) return;
  if (!h.id) h.id = `rubrik-${Math.random().toString(36).slice(2, 9)}`;
  focusSoon(h.id);
}

/** Sektion utan ram: versal rubrik med röd punkt och innehåll under. */
export function Section({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-label font-extrabold uppercase tracking-[0.1em] portal:text-body">
          <Dot />
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
