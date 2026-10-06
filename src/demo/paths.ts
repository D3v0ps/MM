// Den gamla prototypens vy-id och parametrar <-> sökvägar i appen (rutt-tabellen i docs/ARKITEKTUR.md).
// Används av scenarierna (varje steg är en vy med parametrar i den gamla prototypen) och av feedbacken:
// feedback som redan lämnats i den publicerade artefakten har vy-id (t.ex. "sam.inkorg" + { emailId }), och ny
// feedback sparar samma vy-id så att filtret "Den här vyn" och "Gå till vyn" fungerar för båda.
//
// Frågeparametrar (query) som inte står i rutt-tabellen – områdena ska läsa dem så här:
//   /inkorg?senaste=1            sam.inkorg { latest: true }  (senaste avropet som väntar på svar, scenario 3)
//   /inkorg?arende=<caseId>      sam.inkorg { caseId }
//   /arenden?filter=skyddade     arenden.lista { filter }
//   /narvaro?vecka=forra|denna   coach.narvaro { week: 'last' | 'this' }
//   /avstamning/<caseId>?avstamning=<checkInId>   coach.avstamning { caseId, checkInId }
//   /rapporter?filter=…          rapporter.lista { filter }
//   /ledning?flik=kpi|puls|coacher|omraden        chef.oversikt { tab }
//   /portal/deltagare/<caseId>?flik=…             kom.deltagare { caseId, tab }
//   (/arenden/<id>?flik=, /manadsbedomning/<id>?manad=, /handelse/<id>?lage=avslut, /admin/avtal?avtal=&flik=,
//    /admin/mallar?flik=logg står redan i rutt-tabellen.)
import { matchPath, path } from "@/shell/nav";

export type ViewParams = Record<string, unknown>;

const str = (v: unknown): string | null => (v === undefined || v === null || v === "" || v === false ? null : String(v));
const seg = (base: string, id: unknown): string => {
  const s = str(id);
  return s ? `${base}/${encodeURIComponent(s)}` : base;
};

type ViewDef = { view: string; pattern: string; to: (p: ViewParams) => string };

/** Ordning: mer specifika mönster före generella (samma regel som rutt-tabellen). */
const VIEWS: readonly ViewDef[] = [
  // /start leder till Min vecka (beslut 2026-10-06); mönstret finns kvar för feedback som redan lämnats på /start.
  { view: "sam.start", pattern: "/start", to: () => "/min-vecka" },
  { view: "sam.inkorg", pattern: "/inkorg/:emailId?", to: (p) => path(seg("/inkorg", p.emailId), { arende: str(p.caseId), senaste: p.latest === true ? 1 : null }) },
  { view: "sam.deadlines", pattern: "/forfaller", to: () => "/forfaller" },
  { view: "arenden.lista", pattern: "/arenden", to: (p) => path("/arenden", { filter: str(p.filter) }) },
  { view: "arende.kort", pattern: "/arenden/:caseId", to: (p) => (str(p.caseId) ? path(seg("/arenden", p.caseId), { flik: str(p.tab) }) : "/arenden") },
  { view: "hand.start", pattern: "/handledare", to: () => "/handledare" },
  { view: "coach.minvecka", pattern: "/min-vecka", to: () => "/min-vecka" },
  { view: "coach.narvaro", pattern: "/narvaro", to: (p) => path("/narvaro", { vecka: p.week === "last" ? "forra" : p.week === "this" ? "denna" : null }) },
  { view: "coach.avstamning", pattern: "/avstamning/:caseId?", to: (p) => path(seg("/avstamning", p.caseId), { avstamning: str(p.checkInId) }) },
  { view: "coach.manad", pattern: "/manadsbedomning/:caseId?", to: (p) => path(seg("/manadsbedomning", p.caseId), { manad: str(p.month) }) },
  { view: "coach.kartlaggning", pattern: "/kartlaggning/:caseId?", to: (p) => seg("/kartlaggning", p.caseId) },
  { view: "coach.handelse", pattern: "/handelse/:caseId?", to: (p) => path(seg("/handelse", p.caseId), { lage: p.mode === "close" ? "avslut" : null }) },
  { view: "rapporter.lista", pattern: "/rapporter", to: (p) => path("/rapporter", { filter: str(p.filter) }) },
  { view: "rapport.visa", pattern: "/rapporter/:reportId", to: (p) => seg("/rapporter", p.reportId) },
  { view: "chef.oversikt", pattern: "/ledning", to: (p) => path("/ledning", { flik: str(p.tab) }) },
  { view: "chef.avvikelser", pattern: "/avtalsavvikelser/:id?", to: (p) => seg("/avtalsavvikelser", p.id) },
  { view: "eko.start", pattern: "/ekonomi", to: () => "/ekonomi" },
  { view: "eko.arende", pattern: "/ekonomi/arende/:caseId", to: (p) => (str(p.caseId) ? seg("/ekonomi/arende", p.caseId) : "/ekonomi") },
  {
    view: "eko.faktura",
    pattern: "/ekonomi/:month/faktura/:caseId",
    to: (p) => (str(p.month) && str(p.caseId) ? `${seg("/ekonomi", p.month)}${seg("/faktura", p.caseId)}` : seg("/ekonomi", p.month)),
  },
  { view: "eko.korning", pattern: "/ekonomi/:month", to: (p) => seg("/ekonomi", p.month) },
  { view: "admin.avtal", pattern: "/admin/avtal", to: (p) => path("/admin/avtal", { avtal: str(p.contract), flik: str(p.tab) }) },
  { view: "admin.anvandare", pattern: "/admin/anvandare", to: () => "/admin/anvandare" },
  { view: "admin.integrationer", pattern: "/admin/integrationer", to: () => "/admin/integrationer" },
  { view: "admin.mallar", pattern: "/admin/mallar", to: (p) => path("/admin/mallar", { flik: str(p.tab) }) },
  { view: "admin.logg", pattern: "/admin/logg", to: () => "/admin/logg" },
  { view: "praktik.arbetsgivare", pattern: "/praktik/:employerId?", to: (p) => seg("/praktik", p.employerId) },
  { view: "puls.svar", pattern: "/puls/:token?", to: (p) => seg("/puls", p.token) },
  { view: "notiser", pattern: "/notiser", to: () => "/notiser" },
  { view: "kom.login", pattern: "/portal/logga-in", to: () => "/portal/logga-in" },
  { view: "kom.bestall", pattern: "/portal/bestall", to: () => "/portal/bestall" },
  { view: "kom.deltagare", pattern: "/portal/deltagare/:caseId?", to: (p) => path(seg("/portal/deltagare", p.caseId), { flik: str(p.tab) }) },
  { view: "kom.rapporter", pattern: "/portal/rapporter/:reportId?", to: (p) => seg("/portal/rapporter", p.reportId) },
  { view: "kom.chef", pattern: "/portal/bestallarrapport", to: () => "/portal/bestallarrapport" },
  { view: "kom.start", pattern: "/portal", to: () => "/portal" },
  { view: "om.feedback", pattern: "/om/genomgang", to: () => "/om/genomgang" },
  { view: "om.fragor", pattern: "/om/fragor", to: () => "/om/fragor" },
  { view: "om.start", pattern: "/om", to: () => "/om" },
];

const BY_VIEW = new Map(VIEWS.map((v) => [v.view, v]));

/** Sökvägen för en vy i den gamla prototypen, t.ex. pathForView("arende.kort", { caseId, tab: "avvikelser" }). Okänd vy -> null. */
export function pathForView(view: string, params: ViewParams = {}): string | null {
  const def = BY_VIEW.get(view);
  return def ? def.to(params ?? {}) : null;
}

/** Vy-id för en sökväg (utan query). Sidor som inte fanns i den gamla prototypen får sökvägen som id. */
export function viewForPath(p: string): { view: string; params: Record<string, string> } {
  for (const v of VIEWS) {
    const params = matchPath(v.pattern, p);
    if (params) return { view: v.view, params };
  }
  return { view: p, params: {} };
}

export const isKnownView = (view: string | null | undefined): boolean => !!view && BY_VIEW.has(view);

/** Aktuell sökväg med query, t.ex. "/arenden/case-1?flik=narvaro". */
export const fullPath = (p: string, query: URLSearchParams): string => {
  const q = query.toString();
  return q ? `${p}?${q}` : p;
};
