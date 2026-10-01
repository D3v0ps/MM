// Navigering per roll – port av prototypens NAV (sidopanelen) och KOM_NAV (kommunportalen), med sökvägar i stället för vy-id.
// Sökvägarna följer rutt-tabellen i docs/ARKITEKTUR.md. Räknarna kommer från frågan navCounts (src/features/session/nav-api.ts).
import type { CustomerRole, Role, SupplierRole } from "@/api/roles";
import type { NavCounts } from "@/features/session/nav-api";
import { MONTHS, addMonths, monthKey, type LocalDateTime } from "@/core/time";
import type { IconName } from "@/ui/icons";

export type NavCountKey = Exclude<keyof NavCounts, "notifications" | "resultFile">;

export type NavItem = {
  /** Sökväg. Aktiv när sökvägen är samma eller ligger under (längsta träff vinner). */
  to: string;
  label: string;
  icon: IconName;
  /** Räknare till höger. "inbox" visas neutral, övriga med röd ring (kräver åtgärd). */
  count?: NavCountKey;
};
export type NavGroup = { label: string; items: NavItem[] };

/** Rader som beror på tid (t.ex. förra månadens fakturakörning). now = serverns/demoklockans tid. */
export type NavContext = { now: LocalDateTime | null };
type NavItemDef = NavItem | ((ctx: NavContext) => NavItem | null);
type NavGroupDef = { label: string; items: NavItemDef[] };

const START: NavItem = { to: "/start", label: "Startsida", icon: "home" };
const INKORG: NavItem = { to: "/inkorg", label: "Avropsinkorg", icon: "inbox", count: "inbox" };
const FORFALLER: NavItem = { to: "/forfaller", label: "Förfaller", icon: "clock", count: "deadlines" };
const ARENDEN: NavItem = { to: "/arenden", label: "Ärenden", icon: "list" };
const RAPPORTER: NavItem = { to: "/rapporter", label: "Rapporter", icon: "file" };
const PRAKTIK: NavItem = { to: "/praktik", label: "Arbetsgivare och praktik", icon: "briefcase" };
const AVVIKELSER: NavItem = { to: "/avtalsavvikelser", label: "Avtalsavvikelser", icon: "flag" };
const LOGG: NavItem = { to: "/admin/logg", label: "Revisionslogg", icon: "book" };

/** Förra månadens fakturakörning ("Fakturakörning januari" den 1 februari). */
const fakturakorning = ({ now }: NavContext): NavItem | null => {
  if (!now) return null;
  const month = addMonths(monthKey(now), -1);
  return { to: `/ekonomi/${month}`, label: `Fakturakörning ${MONTHS[Number(month.slice(5, 7)) - 1]}`, icon: "file" };
};

const NAV_DEF: Record<SupplierRole, NavGroupDef[]> = {
  samordnare: [
    { label: "Arbete", items: [START, INKORG, FORFALLER, ARENDEN] },
    { label: "Uppföljning", items: [RAPPORTER, PRAKTIK] },
  ],
  avtalsansvarig: [
    { label: "Arbete", items: [START, INKORG, FORFALLER, ARENDEN] },
    { label: "Avtalet", items: [RAPPORTER, AVVIKELSER, { to: "/admin/anvandare", label: "Kommunanvändare", icon: "users" }] },
  ],
  coach: [
    {
      label: "Min vardag",
      items: [
        { to: "/min-vecka", label: "Min vecka", icon: "calendar" },
        { to: "/narvaro", label: "Närvaro", icon: "check-square", count: "unregistered" },
        { to: "/arenden", label: "Mina ärenden", icon: "list" },
      ],
    },
    { label: "Uppföljning", items: [RAPPORTER, PRAKTIK] },
  ],
  handledare: [
    {
      label: "Min vardag",
      items: [
        { to: "/handledare", label: "Mina tilldelade ärenden", icon: "list" },
        { to: "/narvaro", label: "Närvaro", icon: "check-square" },
        PRAKTIK,
      ],
    },
  ],
  chef: [
    { label: "Ledning", items: [{ to: "/ledning", label: "Ledningsvy", icon: "chart" }, AVVIKELSER, FORFALLER] },
    { label: "Insyn", items: [ARENDEN, RAPPORTER, LOGG] },
  ],
  ekonom: [{ label: "Ekonomi", items: [{ to: "/ekonomi", label: "Fakturering", icon: "card" }, fakturakorning] }],
  admin: [
    {
      label: "Administration",
      items: [
        { to: "/admin/avtal", label: "Avtal och konfiguration", icon: "settings" },
        { to: "/admin/anvandare", label: "Användare och roller", icon: "users" },
        { to: "/admin/integrationer", label: "Underbiträden och integrationer", icon: "database" },
        { to: "/admin/mallar", label: "Mallar och utskick", icon: "mail" },
        LOGG,
      ],
    },
  ],
};

/** Notiser ligger överst i sidopanelen för alla MB-roller (antal olästa från navCounts.notifications). */
export const NOTIFICATIONS_ITEM: NavItem = { to: "/notiser", label: "Notiser", icon: "bell" };

/** Sidopanelens grupper för en roll (tom lista för kommun och deltagare). */
export function navFor(role: Role, ctx: NavContext): NavGroup[] {
  const groups = (NAV_DEF as Partial<Record<Role, NavGroupDef[]>>)[role] ?? [];
  return groups.map((g) => ({
    label: g.label,
    items: g.items.map((it) => (typeof it === "function" ? it(ctx) : it)).filter((it): it is NavItem => it !== null),
  }));
}

/** requires = menyvalet visas bara när navCounts säger att avtalet har funktionen (t.ex. resultFile). */
export type PortalNavItem = { to: string; label: string; requires?: "resultFile" };

/** Kommunportalens meny (inga förkortningar). */
export const PORTAL_NAV: Record<CustomerRole, PortalNavItem[]> = {
  kommun_handlaggare: [
    { to: "/portal", label: "Start" },
    { to: "/portal/bestall", label: "Beställ ny insats" },
    { to: "/portal/deltagare", label: "Mina deltagare" },
    { to: "/portal/rapporter", label: "Rapporter och meddelanden" },
  ],
  kommun_chef: [
    { to: "/portal/bestallarrapport", label: "Beställarrapport" },
    { to: "/portal/deltagare", label: "Enhetens deltagare" },
    { to: "/portal/rapporter", label: "Rapporter" },
    { to: "/portal/resultat", label: "Hämta resultat", requires: "resultFile" },
  ],
};

/** Portalens meny för rollen: menyval med requires visas bara när avtalet har funktionen (navCounts). */
export function portalNavFor(role: CustomerRole, counts: Pick<NavCounts, "resultFile"> | null | undefined): PortalNavItem[] {
  return PORTAL_NAV[role].filter((it) => !it.requires || !!counts?.[it.requires]);
}

/** Portalens inloggning och handläggarens startsida har ingen meny (SPEC §7.0). */
export const PORTAL_LOGIN_PATH = "/portal/logga-in";
export const PORTAL_START_PATH = "/portal";

/** Vilken av sökvägarna som är aktiv: samma sökväg eller en undersida; längsta träff vinner. */
export function activePath(current: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  for (const c of candidates) {
    const hit = current === c || current.startsWith(c.endsWith("/") ? c : `${c}/`);
    if (hit && (!best || c.length > best.length)) best = c;
  }
  return best;
}
