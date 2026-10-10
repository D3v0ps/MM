// Navigering per roll med sökvägar (rutt-tabellen i docs/ARKITEKTUR.md). MB-personalen (beslut 2026-10-06): Notiser överst,
// den gemensamma gruppen "Min vardag" (COMMON_NAV) och en rollflik (ROLE_TAB). Kommunportalen: KOM_NAV (PORTAL_NAV).
// Räknarna kommer från frågan navCounts (src/features/session/nav-api.ts).
import { isSupplierRole, SUPPLIER_ROLES, type CustomerRole, type Role, type SupplierRole } from "@/api/roles";
import { isTesterHiddenPath, roleHiddenFromTesters } from "@/api/tester-access";
import type { NavCounts } from "@/features/session/nav-api";
import { MONTHS, addMonths, monthKey, type LocalDateTime } from "@/core/time";
import type { IconName } from "@/ui/icons";

export type NavCountKey = Exclude<keyof NavCounts, "notifications">;

export type NavItem = {
  /** Sökväg. Aktiv när sökvägen är samma eller ligger under (längsta träff vinner). */
  to: string;
  label: string;
  icon: IconName;
  /** Räknare till höger. "inbox" visas neutral, övriga med röd ring (kräver åtgärd). */
  count?: NavCountKey;
};
export type NavGroup = { label: string; items: NavItem[] };

/**
 * Rader som beror på tid (t.ex. förra månadens fakturakörning). now = serverns/demoklockans tid.
 * hidesCommercial = begränsad testare: stängda sidor (Ekonomi) visas inte (src/api/tester-access.ts).
 */
export type NavContext = { now: LocalDateTime | null; hidesCommercial?: boolean };
type NavItemDef = NavItem | ((ctx: NavContext) => NavItem | null);
type NavGroupDef = { label: string; items: NavItemDef[] };

const INKORG: NavItem = { to: "/inkorg", label: "Avropsinkorg", icon: "inbox", count: "inbox" };
const FORFALLER: NavItem = { to: "/forfaller", label: "Förfaller", icon: "clock", count: "deadlines" };
const ARENDEN: NavItem = { to: "/arenden", label: "Ärenden", icon: "list" };
const RAPPORTER: NavItem = { to: "/rapporter", label: "Rapporter", icon: "file" };
/** Rapportbyggaren (rapporter steg 4) – samordnare, avtalsansvarig och chef. */
const BYGG: NavItem = { to: "/rapportbyggare", label: "Bygg rapport", icon: "chart" };
const PRAKTIK: NavItem = { to: "/praktik", label: "Arbetsgivare och praktik", icon: "briefcase" };
const AVVIKELSER: NavItem = { to: "/avtalsavvikelser", label: "Avtalsavvikelser", icon: "flag" };
const LOGG: NavItem = { to: "/admin/logg", label: "Revisionslogg", icon: "book" };
/** Massanteckningar (coachmötet 2026-10-09). Grupper och nivåer nås därifrån – systemadministratören har dem i sin flik. */
const ANTECKNINGAR: NavItem = { to: "/anteckningar", label: "Anteckningar", icon: "edit" };

/** Förra månadens fakturakörning ("Fakturakörning januari" den 1 februari). */
const fakturakorning = ({ now }: NavContext): NavItem | null => {
  if (!now) return null;
  const month = addMonths(monthKey(now), -1);
  return { to: `/ekonomi/${month}`, label: `Fakturakörning ${MONTHS[Number(month.slice(5, 7)) - 1]}`, icon: "file" };
};

/**
 * Den gemensamma gruppen "Min vardag" (beslut 2026-10-06): samma menyval i samma ordning för alla MB-roller. Ett val visas
 * bara för rollerna i roles – samma roller som ruttens (testet i src/shell/route-table.test.ts kontrollerar det), så menyn
 * visar aldrig något som rollen inte når. Behörigheterna ändras inte här.
 */
export const COMMON_NAV: { roles: readonly SupplierRole[]; item: (role: SupplierRole) => NavItem }[] = [
  { roles: SUPPLIER_ROLES, item: () => ({ to: "/min-vecka", label: "Min vecka", icon: "calendar" }) },
  // Räknaren (oregistrerade tillfällen) gäller coachens egna ärenden.
  { roles: ["coach", "handledare"], item: (r) => ({ to: "/narvaro", label: "Närvaro", icon: "check-square", ...(r === "coach" ? { count: "unregistered" as const } : {}) }) },
  // Gruppaktiviteterna (coachmötet 2026-10-09): alla på Miljonbemanning utom ekonomen ("alla ser alla").
  { roles: ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin"], item: () => ({ to: "/aktiviteter", label: "Aktiviteter", icon: "users" }) },
  // Coachen: sina ärenden. Handledaren: listan över tilldelade ärenden (/handledare) – inte två ärendelistor i menyn.
  {
    roles: ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin"],
    item: (r) => (r === "coach" ? { ...ARENDEN, label: "Mina ärenden" } : r === "handledare" ? { to: "/handledare", label: "Mina tilldelade ärenden", icon: "list" } : ARENDEN),
  },
  // Massanteckningar (coachmötet 2026-10-09): en rad per deltagare i en grupp, nivå eller tagg. Samma roller som rutten.
  { roles: ["samordnare", "avtalsansvarig", "coach", "handledare"], item: () => ANTECKNINGAR },
  { roles: ["samordnare", "avtalsansvarig", "coach", "chef"], item: () => RAPPORTER },
  { roles: ["samordnare", "avtalsansvarig", "coach", "handledare"], item: () => PRAKTIK },
];
export const COMMON_GROUP_LABEL = "Min vardag";

/** En rollflik per roll (beslut 2026-10-06). Coach och handledare har ingen. */
const ROLE_TAB: Partial<Record<SupplierRole, NavGroupDef>> = {
  samordnare: { label: "Samordning", items: [INKORG, FORFALLER, BYGG] },
  avtalsansvarig: { label: "Avtalet", items: [INKORG, FORFALLER, AVVIKELSER, { to: "/admin/anvandare", label: "Kommunanvändare", icon: "users" }, BYGG] },
  chef: { label: "Ledning", items: [{ to: "/ledning", label: "Ledningsvy", icon: "chart" }, AVVIKELSER, FORFALLER, BYGG, LOGG] },
  // Ekonomi bara för ekonomen (beslut 5, 2026-10-07: belopp syns bara för rollen ekonom). Prislistan har flyttat hit från avtalssidan.
  ekonom: { label: "Ekonomi", items: [{ to: "/ekonomi", label: "Fakturering", icon: "card" }, fakturakorning, { to: "/ekonomi/prislista", label: "Prislista", icon: "list" }] },
  // Avtal och konfiguration (/admin/avtal) ligger inte i menyn (beslut 2026-10-06) – sidan nås från Användare och roller och Min vecka.
  admin: {
    label: "Administratör",
    items: [
      { to: "/admin/anvandare", label: "Användare och roller", icon: "users" },
      { to: "/admin/integrationer", label: "Underbiträden och integrationer", icon: "database" },
      { to: "/admin/mallar", label: "Mallar och utskick", icon: "mail" },
      { to: "/grupper", label: "Grupper och nivåer", icon: "layers" },
      LOGG,
    ],
  },
};

/** Notiser ligger överst i sidopanelen för alla MB-roller (antal olästa från navCounts.notifications). */
export const NOTIFICATIONS_ITEM: NavItem = { to: "/notiser", label: "Notiser", icon: "bell" };

/**
 * Sidopanelens grupper för en roll: den gemensamma gruppen Min vardag och rollens flik (tom lista för kommun och deltagare).
 * En begränsad testare ser aldrig en stängd sida i menyn; agerar hen ändå i en roll som är dold för testare (ekonom) är
 * menyn tom, som förut.
 */
export function navFor(role: Role, ctx: NavContext): NavGroup[] {
  if (!isSupplierRole(role)) return [];
  if (ctx.hidesCommercial && roleHiddenFromTesters(role)) return [];
  const common: NavGroupDef = { label: COMMON_GROUP_LABEL, items: COMMON_NAV.filter((c) => c.roles.includes(role)).map((c) => c.item(role)) };
  const tab = ROLE_TAB[role];
  return [common, ...(tab ? [tab] : [])]
    .map((g) => ({
      label: g.label,
      items: g.items
        .map((it) => (typeof it === "function" ? it(ctx) : it))
        .filter((it): it is NavItem => it !== null && !(ctx.hidesCommercial && isTesterHiddenPath(it.to))),
    }))
    .filter((g) => g.items.length > 0);
}

export type PortalNavItem = { to: string; label: string };

/**
 * Kommunportalens meny (inga förkortningar). Kommunen har bara rollen handläggare (beslut 2026-10-07) – beställarrapporten,
 * resultatfilen och rapporterna som Miljonbemanning delade med kommunens chef finns inte längre i portalen.
 */
export const PORTAL_NAV: Record<CustomerRole, PortalNavItem[]> = {
  kommun_handlaggare: [
    { to: "/portal", label: "Start" },
    { to: "/portal/bestall", label: "Beställ ny insats" },
    { to: "/portal/deltagare", label: "Mina deltagare" },
    { to: "/portal/rapporter", label: "Rapporter och meddelanden" },
    { to: "/portal/mina-uppgifter", label: "Mina uppgifter" },
  ],
};

/** Portalens meny för rollen. */
export const portalNavFor = (role: CustomerRole): PortalNavItem[] => PORTAL_NAV[role];

/** Portalens inloggning och handläggarens startsida har ingen meny (SPEC §7.0). */
export const PORTAL_LOGIN_PATH = "/portal/logga-in";
export const PORTAL_START_PATH = "/portal";
/** Mina uppgifter – dit leder första inloggningen efter självregistreringen (?forsta=1). */
export const PORTAL_PROFILE_PATH = "/portal/mina-uppgifter";
export const PORTAL_FIRST_LOGIN_PATH = "/portal/mina-uppgifter?forsta=1";

/** Vilken av sökvägarna som är aktiv: samma sökväg eller en undersida; längsta träff vinner. */
export function activePath(current: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  for (const c of candidates) {
    const hit = current === c || current.startsWith(c.endsWith("/") ? c : `${c}/`);
    if (hit && (!best || c.length > best.length)) best = c;
  }
  return best;
}
