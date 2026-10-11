// Länkar från flaggor, deadlines och notiser. Domänfunktionerna returnerar prototypens vy-id och parametrar
// (samma som i den gamla prototypen) plus sökvägen enligt rutt-tabellen i docs/ARKITEKTUR.md.
// URL:er innehåller bara id:n – aldrig namn eller personnummer.

/** Prototypens vy-id, t.ex. "arende.kort". Handledarens hand.start är borttagen med rollen (beslut 2026-10-09). */
export type ViewId =
  | "sam.start" | "sam.inkorg" | "sam.deadlines"
  | "arenden.lista" | "arende.kort"
  | "coach.minvecka" | "coach.narvaro" | "coach.avstamning" | "coach.manad" | "coach.kartlaggning" | "coach.handelse"
  | "rapporter.lista" | "rapport.visa"
  | "chef.oversikt" | "chef.avvikelser"
  | "eko.start" | "eko.arende" | "eko.faktura" | "eko.korning"
  | "notiser";

export type ViewLink = { view: ViewId; params: Record<string, string> };

const q = (pairs: [string, string | undefined][]): string => {
  const s = pairs.filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join("&");
  return s ? `?${s}` : "";
};
const seg = (v: string | undefined) => (v ? `/${encodeURIComponent(v)}` : "");

/**
 * Sökväg för en länk. Parametrar som inte ingår i sökvägen blir query med svenska namn:
 * tab -> flik, month -> manad, mode close -> lage=avslut, week last/this -> vecka=forra/denna,
 * caseId i inkorgen -> arende, checkInId -> avstamning.
 */
export function linkHref(link: ViewLink): string {
  const p = link.params;
  switch (link.view) {
    case "sam.start": return "/min-vecka"; // /start har gått upp i Min vecka (beslut 2026-10-06)
    case "sam.inkorg": return `/inkorg${seg(p.emailId)}${q([["arende", p.caseId]])}`;
    case "sam.deadlines": return "/forfaller";
    case "arenden.lista": return `/arenden${q([["filter", p.filter]])}`;
    case "arende.kort": return `/arenden${seg(p.caseId)}${q([["flik", p.tab]])}`;
    case "coach.minvecka": return "/min-vecka";
    case "coach.narvaro": return `/narvaro${q([["vecka", p.week === "last" ? "forra" : p.week === "this" ? "denna" : p.week]])}`;
    case "coach.avstamning": return `/avstamning${seg(p.caseId)}${q([["avstamning", p.checkInId]])}`;
    case "coach.manad": return `/manadsbedomning${seg(p.caseId)}${q([["manad", p.month]])}`;
    case "coach.kartlaggning": return `/kartlaggning${seg(p.caseId)}`;
    case "coach.handelse": return `/handelse${seg(p.caseId)}${q([["lage", p.mode === "close" ? "avslut" : undefined]])}`;
    case "rapporter.lista": return `/rapporter${q([["filter", p.filter]])}`;
    case "rapport.visa": return `/rapporter${seg(p.reportId)}`;
    case "chef.oversikt": return `/ledning${q([["flik", p.tab]])}`;
    case "chef.avvikelser": return `/avtalsavvikelser${seg(p.id)}`;
    case "eko.start": return "/ekonomi";
    case "eko.arende": return `/ekonomi/arende${seg(p.caseId)}`;
    case "eko.faktura": return `/ekonomi${seg(p.month)}/faktura${seg(p.caseId)}`;
    case "eko.korning": return `/ekonomi${seg(p.month)}`;
    case "notiser": return "/notiser";
  }
}

/** Länk till en vy. */
export const viewLink = (view: ViewId, params: Record<string, string> = {}): ViewLink => ({ view, params });
