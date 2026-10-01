"use client";
// Layouter per område (RouteDef.area) – samma i riktiga appen och i prototypen:
//   mb      MB:s arbetsyta: antracit sidopanel med meny per roll och räknare
//   portal  kommunens portal: enkel toppmeny, 18 px text, inga förkortningar
//   puls    deltagarens mobilvy (pulsmätningen)
//   om      prototypens egna sidor
// Utvecklingsläget (riktiga appen i minnesläge) får en diskret rad överst för att välja testperson.
import { useState, type MouseEvent, type ReactNode } from "react";
import { isCustomerRole, ROLE_LABEL } from "@/api/roles";
import { navCounts } from "@/features/session/nav-api";
import { sessionPing } from "@/features/session/api";
import { AreaProvider, type LayoutArea } from "@/ui/area";
import { buttonVariants } from "@/ui/button";
import { cn } from "@/ui/cn";
import { ConfirmHost, TextDialogHost } from "@/ui/dialog";
import { Icon } from "@/ui/icons";
import { Avatar } from "@/ui/data";
import { Brand } from "@/ui/layout";
import { Toaster } from "@/ui/toast";
import { useQuery } from "./backend";
import { Link, useNav } from "./nav";
import { activePath, navFor, NOTIFICATIONS_ITEM, PORTAL_LOGIN_PATH, PORTAL_START_PATH, portalNavFor, type NavItem } from "./nav-config";
import type { RouteMatch } from "./routes";
import { useRuntime } from "./runtime";
import { useSession } from "./session";

export function LayoutFor({ match, children }: { match: RouteMatch; children: ReactNode }) {
  const area: LayoutArea = match.route.area;
  let body: ReactNode;
  if (area === "portal") body = <PortalLayout match={match}>{children}</PortalLayout>;
  else if (area === "puls") body = <PulsLayout>{children}</PulsLayout>;
  else if (area === "om") body = <OmLayout>{children}</OmLayout>;
  // Inloggningssidor: centrerad vy med ordmärket, utan menyer.
  else if (area === "auth") body = <AuthLayout>{children}</AuthLayout>;
  else body = <MbLayout>{children}</MbLayout>;
  return (
    <AreaProvider area={area}>
      <div className="flex flex-1 flex-col">
        <SkipLink />
        <DevBar />
        {body}
        <Toaster />
        <ConfirmHost />
        <TextDialogHost />
      </div>
    </AreaProvider>
  );
}

// ---------------------------------------------------------------- Gemensamt
function SkipLink() {
  return (
    <a
      href="#main"
      className="skip-link absolute -top-20 left-3 z-100 rounded-mb bg-antracit px-4 py-3 font-bold text-vit no-underline focus:top-[calc(env(safe-area-inset-top,0px)+8px)] focus:outline-3 focus:outline-rod"
      onClick={(e: MouseEvent) => {
        // Hash-navigeringen i prototypen får inte ändras – flytta bara fokus.
        e.preventDefault();
        document.getElementById("main")?.focus();
      }}
    >
      Hoppa till innehållet
    </a>
  );
}

/** Bara utvecklingsläget: välj testperson. Syns inte i prototypen (där finns prototypfältet) eller i produktion. */
function DevBar() {
  const runtime = useRuntime();
  const s = useSession();
  if (runtime !== "app" || !s.personas?.length || !s.switchRole) return null;
  const value = `${s.actor.userId}|${s.actor.role}`;
  return (
    <div data-print="hide" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-dashed border-line-strong bg-vit px-4 py-1.5 text-small">
      <label htmlFor="dev-persona" className="font-bold">
        Utvecklingsläge – testperson:
      </label>
      <select
        id="dev-persona"
        className="w-auto max-w-full py-1.5 text-small font-semibold"
        value={value}
        onChange={(e) => {
          const [userId, role] = e.target.value.split("|");
          const p = s.personas?.find((x) => x.userId === userId && x.role === role);
          if (p) s.switchRole?.(p.role, p.userId);
        }}
      >
        {s.personas.map((p) => (
          <option key={`${p.userId}|${p.role}`} value={`${p.userId}|${p.role}`}>
            {p.name} – {ROLE_LABEL[p.role]}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------- MB:s arbetsyta
function MbLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid flex-1 grid-cols-[256px_minmax(0,1fr)] max-[900px]:grid-cols-1">
      <Sidebar />
      <main id="main" tabIndex={-1} className="min-w-0 bg-vit">
        {children}
      </main>
    </div>
  );
}

function Sidebar() {
  const nav = useNav();
  const runtime = useRuntime();
  const session = useSession();
  const { actor, user } = session;
  const [open, setOpen] = useState(false);
  const counts = useQuery(navCounts, {}).data;
  // Klockan behövs bara för ekonomens "Fakturakörning <förra månaden>".
  const ping = useQuery(sessionPing, actor.role === "ekonom" ? {} : null).data;
  const groups = navFor(actor.role, { now: ping?.now ?? null });
  const active = activePath(nav.path, [NOTIFICATIONS_ITEM.to, ...groups.flatMap((g) => g.items.map((i) => i.to))]);
  const testData = runtime === "demo" || !!session.personas?.length;
  const unread = counts?.notifications ?? 0;

  return (
    <aside
      aria-label="Huvudmeny"
      data-print="hide"
      className={cn(
        "flex flex-col gap-[18px] bg-antracit px-3.5 py-5 text-vit [--mm-focus:var(--color-vit)]",
        "max-[900px]:flex-row max-[900px]:flex-wrap max-[900px]:items-center max-[900px]:gap-2.5 max-[900px]:px-4 max-[900px]:py-2.5",
      )}
    >
      <div className="px-2 py-1">
        <Brand name="Miljonmatch" />
      </div>
      <div className="-mt-3.5 px-2 text-[0.6875rem] font-semibold tracking-[0.12em] text-vit/78 uppercase max-[900px]:hidden">Miljonbemanning</div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="huvudmeny"
        onClick={() => setOpen(!open)}
        className={cn(buttonVariants({ kind: "ghost" }), "ml-auto hidden text-vit hover:not-disabled:bg-vit/8 max-[900px]:inline-flex")}
      >
        <Icon name="menu" />
        Meny
      </button>
      <nav id="huvudmeny" aria-label="Meny" className={cn("flex flex-col gap-0.5 max-[900px]:w-full", open ? "max-[900px]:flex" : "max-[900px]:hidden")}>
        <SideItem item={NOTIFICATIONS_ITEM} active={active === NOTIFICATIONS_ITEM.to} n={unread} hot srSuffix=" olästa" onPick={() => setOpen(false)} />
        {groups.map((g) => (
          <div key={g.label} className="flex flex-col gap-0.5">
            <div className="px-2.5 pt-3.5 pb-1.5 text-[0.6875rem] font-bold tracking-[0.12em] text-vit/72 uppercase">{g.label}</div>
            {g.items.map((it) => (
              <SideItem
                key={it.to}
                item={it}
                active={active === it.to}
                n={it.count ? (counts?.[it.count] ?? 0) : 0}
                hot={it.count !== "inbox"}
                onPick={() => setOpen(false)}
              />
            ))}
          </div>
        ))}
      </nav>
      <div className={cn("flex items-center gap-2.5 border-y border-vit/14 px-2 py-2.5", open ? "max-[900px]:flex max-[900px]:w-full" : "max-[900px]:hidden")}>
        <Avatar name={user.name} onDark />
        <div className="min-w-0 flex-1">
          <div className="text-ui leading-[1.2] font-bold">{user.name}</div>
          <div className="text-meta text-vit/80">{ROLE_LABEL[actor.role]}</div>
        </div>
        {session.signOut && (
          <button
            type="button"
            onClick={session.signOut}
            title="Logga ut"
            aria-label="Logga ut"
            className={cn(buttonVariants({ kind: "ghost", iconOnly: true }), "text-vit hover:not-disabled:bg-vit/8")}
          >
            <Icon name="logout" />
          </button>
        )}
      </div>
      {testData && <div className="mt-auto px-2 text-label leading-[1.4] text-vit/72 max-[900px]:hidden">Påhittade testdata.</div>}
    </aside>
  );
}

function SideItem({ item, active, n, hot, srSuffix, onPick }: { item: NavItem; active: boolean; n: number; hot: boolean; srSuffix?: string; onPick: () => void }) {
  return (
    <Link
      to={item.to}
      onClick={onPick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-11 w-full items-center gap-2.5 rounded-mb px-2.5 py-2 text-left text-ui font-medium text-vit no-underline hover:bg-vit/8",
        active &&
          "bg-vit/12 font-bold before:absolute before:top-2.5 before:bottom-2.5 before:-left-3.5 before:w-1 before:rounded-r-[3px] before:bg-rod max-[900px]:before:-left-1.5",
      )}
    >
      <Icon name={item.icon} />
      {item.label}
      {n > 0 && <span className="sr-only"> </span>}
      {n > 0 && (
        <span className={cn("ml-auto rounded-full bg-vit px-2 py-px text-label font-bold text-antracit", hot && "shadow-[0_0_0_2px_var(--color-rod)]")}>
          {n}
          {srSuffix && <span className="sr-only">{srSuffix}</span>}
        </span>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------- Kommunens portal
function PortalLayout({ match, children }: { match: RouteMatch; children: ReactNode }) {
  return (
    <div data-area="portal" className="flex-1 bg-vit text-portal">
      <PortalHeader match={match} />
      <main id="main" tabIndex={-1}>
        <div className="mx-auto flex max-w-[860px] flex-col gap-7 px-6 pt-8 pb-[104px] max-[620px]:px-4">{children}</div>
      </main>
    </div>
  );
}

function PortalHeader({ match }: { match: RouteMatch }) {
  const nav = useNav();
  const session = useSession();
  const { actor, user } = session;
  const path = match.route.path;
  // Kommunens chef: menyval som beror på avtalet ("Hämta resultat") – en liten fråga, inga tunga data.
  const counts = useQuery(navCounts, actor.role === "kommun_chef" && path !== PORTAL_LOGIN_PATH ? {} : null).data;
  const who = [user.name, user.unit].filter(Boolean).join(", ");
  const header = "flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-ljusgra px-6 py-3.5 max-[620px]:px-4 max-[620px]:py-3";
  const signOut = () => (session.signOut ? session.signOut() : nav.push(PORTAL_LOGIN_PATH));
  const logout = (
    <button type="button" onClick={signOut} className={cn(buttonVariants({ kind: "ghost" }), "text-body portal:text-body")}>
      <Icon name="logout" />
      Logga ut
    </button>
  );

  if (path === PORTAL_LOGIN_PATH || !isCustomerRole(actor.role)) {
    return (
      <header className={header} data-print="hide">
        <Brand name="Miljonbemanning" />
        <span className="text-body text-text-muted max-[1360px]:hidden">Portal för beställare</span>
      </header>
    );
  }
  // Handläggarens startsida: bara de stora knapparna – ingen annan navigering (SPEC §7.0).
  if (path === PORTAL_START_PATH) {
    return (
      <header className={header} data-print="hide">
        <Brand name="Miljonbemanning" />
        <span className="flex-1" />
        <span className="text-body text-text-muted">{who}</span>
        {logout}
      </header>
    );
  }
  const items = portalNavFor(actor.role, counts);
  const active = activePath(nav.path, items.map((i) => i.to));
  return (
    <header className={header} data-print="hide">
      <Brand name="Miljonbemanning" />
      <nav aria-label="Portalmeny" className="flex flex-1 flex-wrap items-center gap-1">
        {items.map((it) => (
          <Link
            key={it.to}
            to={it.to}
            aria-current={active === it.to ? "page" : undefined}
            className={cn(
              buttonVariants({ kind: active === it.to ? "primary" : "ghost" }),
              "min-h-11 px-3 py-2 text-body no-underline portal:min-h-11 portal:text-body",
            )}
          >
            {it.label}
          </Link>
        ))}
      </nav>
      <span className="text-body text-text-muted max-[1360px]:hidden">{who}</span>
      {logout}
    </header>
  );
}

// ---------------------------------------------------------------- Deltagarens mobilvy och prototypens sidor
function PulsLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="flex flex-1 justify-center bg-ljusgra-ton2 px-4 pt-6 pb-12">
      {children}
    </main>
  );
}

// ---------------------------------------------------------------- Inloggningssidor (area "auth", t.ex. /logga-in)
/** Centrerad kolumn med ordmärket överst. Inga menyer – den som loggar in har ingen roll ännu. */
function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center bg-ljusgra-ton2 px-4 pt-10 pb-16 max-[620px]:pt-6">
      <header className="mb-7 flex flex-col items-center gap-1" data-print="hide">
        <Brand name="Miljonmatch" size="lg" />
        <span className="text-label font-semibold tracking-[0.12em] text-text-muted uppercase">Miljonbemanning</span>
      </header>
      <main id="main" tabIndex={-1} className="w-full max-w-[520px]">
        {children}
      </main>
    </div>
  );
}

function OmLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="min-w-0 flex-1 bg-vit">
      {children}
    </main>
  );
}
