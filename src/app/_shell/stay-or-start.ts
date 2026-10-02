// Vart appen går efter byte av testperson (utvecklingsläget och testmiljöns "Agera som"). Sidan laddas alltid om – inga
// data från förra testpersonen ligger kvar – men på listor och översikter stannar man kvar.
import type { Role } from "@/api/roles";
import { isTesterHiddenPath } from "@/api/tester-access";
import { APP_ROUTES } from "@/shell/route-table";
import { resolveRoute } from "@/shell/routes";

/**
 * Efter byte av testperson: stanna på samma sida när det är en lista eller översikt som den nya rollen får se (t.ex.
 * /arenden?status=pagar från samordnaren till avtalsansvarig), annars rollens startsida ("/" leder dit).
 * - Sidor för en enskild post (/arenden/:caseId, /avstamning/:caseId, /rapporter/:reportId …) leder alltid till startsidan:
 *   den nya personen har kanske inte åtkomst till just den posten, och deltagarkortet loggar då en nekad visning.
 * - En begränsad testare (hidesCommercial) stannar aldrig på en sida som är stängd för testare.
 * Sidan laddas ändå om – inga data från förra testpersonen ligger kvar.
 */
export function stayOrStart(pathWithQuery: string, role: Role, hidesCommercial?: boolean): string {
  const pathname = pathWithQuery.split(/[?#]/)[0] || "/";
  if (hidesCommercial && isTesterHiddenPath(pathname)) return "/";
  const m = resolveRoute(APP_ROUTES, pathname);
  if (!m || Object.keys(m.params).length > 0) return "/";
  return m.route.public || m.route.roles.includes(role) ? pathWithQuery : "/";
}
