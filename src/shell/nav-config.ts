// Navigering per roll med sökvägar (rutt-tabellen i docs/ARKITEKTUR.md). MB-personalen (beslut 2026-10-06): Notiser överst,
// den gemensamma gruppen "Min vardag" (COMMON_NAV) och rollflikarna (ROLE_TAB). Den som har flera roller (Karims beslut 7,
// 2026-10-09) får Min vardag med valen för alla sina roller och en flik per roll i en fast ordning (ROLE_TAB_ORDER) – ett
// menyval visas bara en gång (i den första gruppen där det finns). Kommunportalen: KOM_NAV (PORTAL_NAV).
// Räknarna kommer från frågan navCounts (src/features/session/nav-api.ts).
import { isDormantRole, isSupplierRole, sortRoles, STAFF_ROLES, type CustomerRole, type Role, type SupplierRole } from "@/api/roles";
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
  { roles: STAFF_ROLES, item: () => ({ to: "/min-vecka", label: "Min vecka", icon: "calendar" }) },
  // Räknaren (oregistrerade tillfällen) gäller coachens egna ärenden.
  { roles: ["coach"], item: () => ({ to: "/narvaro", label: "Närvaro", icon: "check-square", count: "unregistered" }) },
  // Gruppaktiviteterna (coachmötet 2026-10-09): alla på Miljonbemanning utom ekonomen ("alla ser alla").
  { roles: ["samordnare", "avtalsansvarig", "coach", "chef", "admin"], item: () => ({ to: "/aktiviteter", label: "Aktiviteter", icon: "users" }) },
  // Coachen: sina ärenden (alla ärenden i avtalet finns i listan).
  { roles: ["samordnare", "avtalsansvarig", "coach", "chef", "admin"], item: (r) => (r === "coach" ? { ...ARENDEN, label: "Mina ärenden" } : ARENDEN) },
  // Massanteckningar (coachmötet 2026-10-09): en rad per deltagare i en grupp, nivå eller tagg. Samma roller som rutten.
  { roles: ["samordnare", "avtalsansvarig", "coach"], item: () => ANTECKNINGAR },
  { roles: ["samordnare", "avtalsansvarig", "coach", "chef"], item: () => RAPPORTER },
  { roles: ["samordnare", "avtalsansvarig", "coach"], item: () => PRAKTIK },
];
export const COMMON_GROUP_LABEL = "Min vardag";

/** Rollflikarnas fasta ordning för den som har flera roller (Karims beslut 7, 2026-10-09): det dagliga arbetet först. */
export const ROLE_TAB_ORDER: readonly SupplierRole[] = ["samordnare", "avtalsansvarig", "chef", "ekonom", "admin"];

/** En rollflik per roll (beslut 2026-10-06). Coachen har ingen. */
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
 * Sidopanelens grupper för en roll eller alla roller (Karims beslut 7, 2026-10-09): den gemensamma gruppen Min vardag med
 * valen för alla rollerna och en flik per roll i ROLE_TAB_ORDER (tom lista för kommun och deltagare). Ett menyval visas en
 * gång – i den första gruppen där det finns. En begränsad testare ser aldrig en stängd sida i menyn; en roll som är dold för
 * testare (ekonom) ger ingen flik och inga val.
 */
export function navFor(role: Role | readonly Role[], ctx: NavContext): NavGroup[] {
  // Rollen handledare är vilande (Karims beslut 2026-10-09): ingen meny.
  const roles = sortRoles((typeof role === "string" ? [role] : role).filter((r): r is SupplierRole => isSupplierRole(r) && !isDormantRole(r)))
    .filter((r) => !(ctx.hidesCommercial && roleHiddenFromTesters(r)));
  if (!roles.length) return [];
  // Etiketten för ett gemensamt val: en annan roll än coachen går före ("Ärenden" i stället för coachens "Mina ärenden").
  const commonItem = (c: (typeof COMMON_NAV)[number]): NavItem | null => {
    const own = roles.filter((r) => c.roles.includes(r));
    if (!own.length) return null;
    return c.item(own.find((r) => r !== "coach") ?? own[0]);
  };
  const common: NavGroupDef = { label: COMMON_GROUP_LABEL, items: COMMON_NAV.map(commonItem).filter((x): x is NavItem => x !== null) };
  const tabs = ROLE_TAB_ORDER.filter((r) => roles.includes(r)).map((r) => ROLE_TAB[r]).filter((t): t is NavGroupDef => !!t);
  const seen = new Set<string>();
  return [common, ...tabs]
    .map((g) => ({
      label: g.label,
      items: g.items
        .map((it) => (typeof it === "function" ? it(ctx) : it))
        .filter((it): it is NavItem => it !== null && !(ctx.hidesCommercial && isTesterHiddenPath(it.to)))
        .filter((it) => (seen.has(it.to) ? false : (seen.add(it.to), true))),
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
