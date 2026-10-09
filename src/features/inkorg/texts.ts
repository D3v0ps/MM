// Texter, etiketter och små rena hjälpare för området inkorg – samma som den gamla prototypens views/inkorg.js.
// Isomorf och utan dataåtkomst: används både av hanterarna (vy-modellerna) och av skärmarna.
import type { EmailClassification, OrderField } from "@/data/schema";
import { addDays, dayOf, fmtDateShort, fmtTime, weekday, WEEKDAYS_SHORT } from "@/core/time";
import type { IconName } from "@/ui/icons";

export const NUMWORD: Record<number, string> = { 1: "en", 2: "två", 3: "tre", 4: "fyra", 5: "fem", 6: "sex", 7: "sju" };

/** "en arbetsdag" / "två arbetsdagar" – svarstiden på avrop enligt avtalskonfigurationen. */
export const workingDaysText = (n: number): string => `${NUMWORD[n] ?? n} arbetsdag${n === 1 ? "" : "ar"}`;
/** "en vecka" / "10 dagar" – första mötet enligt avtalskonfigurationen. */
export const meetingDaysText = (n: number): string => (n % 7 === 0 ? `${NUMWORD[n / 7] ?? n / 7} veck${n === 7 ? "a" : "or"}` : `${n} dagar`);
/** "tre dagar" – intern regel för när ett obokat första möte flaggas. */
export const flagDaysText = (n: number | null | undefined): string => (n ? `${NUMWORD[n] ?? n} ${n === 1 ? "dag" : "dagar"}` : "en tid");

/** "i dag kl. 08.41", "i går kl. 15.20", "i morgon", "fre 29 jan kl. 10.05" – relativt demoklockan/serverns tid. */
export function whenText(s: string | null | undefined, now: string): string {
  if (!s) return "–";
  const day = dayOf(s);
  const t = s.includes("T") ? ` kl. ${fmtTime(s)}` : "";
  const today = dayOf(now);
  if (day === today) return `i dag${t}`;
  if (day === addDays(today, -1)) return `i går${t}`;
  if (day === addDays(today, 1)) return `i morgon${t}`;
  return `${WEEKDAYS_SHORT[weekday(s)]} ${fmtDateShort(s)}${t}`;
}

/** "a, b och c" */
export const listJoin = (xs: readonly string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} och ${xs[xs.length - 1]}`);
/** Liten begynnelsebokstav utom för förkortningar (SYV). */
export const lc = (x: string): string => (/^[A-ZÅÄÖ]{2}/.test(x) ? x : x.charAt(0).toLowerCase() + x.slice(1));

/** Konfidens under detta markeras som osäker. */
export const LOW = 0.8;

/**
 * Feltext om beställarreferensen, skriven till Miljonbemanning (kärnans text i src/core/validation är skriven till kommunen).
 * pattern och lengthText kommer från avtalskonfigurationen (billing.buyerReference.pattern).
 */
export function refErrorMB(s: string | null | undefined, pattern: string, lengthText: string): string | null {
  const v = String(s ?? "").trim();
  if (!v) return "Beställarreferens saknas. Kommunen har inte angett någon – be handläggaren om den.";
  if (/\D/.test(v)) return "Beställarreferensen får bara innehålla siffror – inga mellanslag, bindestreck eller bokstäver.";
  if (!new RegExp(pattern).test(v)) return `Beställarreferensen ska vara ${lengthText} siffror. Här står ${v.length}.`;
  return null;
}

// ---------------------------------------------------------------- Inkorgens poster
export type InboxMethod = "template" | "ai" | "manual" | "portal" | "phone" | "registered";
export const METHOD: Record<InboxMethod, { label: string; icon: IconName; help: string }> = {
  template: { label: "Word-mall", icon: "file", help: "Word-mallen (01) tolkas utan AI, via de fasta etiketterna i tabellcellerna. Samma resultat varje gång." },
  ai: { label: "AI – fritext", icon: "sparkles", help: "Fritext och avvikande mallar tolkas med AI. Kontrollera mot originalet." },
  manual: { label: "Ingen tolkning", icon: "lock", help: "Ingen automatisk tolkning. En människa läser mejlet och registrerar beställningen i inkorgen." },
  portal: { label: "Portalen", icon: "globe", help: "Handläggaren fyllde i beställningen själv. Fälten validerades direkt i formuläret." },
  phone: { label: "Telefon", icon: "phone", help: "Registrerad av Miljonbemanning efter ett telefonsamtal med handläggaren." },
  // Beslut 4a (2026-10-08): ett mejl (eller en beställning som kom på annat sätt) som Miljonbemanning registrerade för hand.
  registered: { label: "Registrerad av Miljonbemanning", icon: "edit", help: "Uppgifterna skrevs in av Miljonbemanning från mejlet eller samtalet. Ingen automatisk tolkning." },
};
// order_protected (skyddade personuppgifter) finns kvar i typen för gamla mejl men visas som Övrigt (beslut 2026-10-07).
export const CLASSIFICATION: Record<EmailClassification, string> = { order: "Beställning", supplement: "Komplettering", order_protected: "Övrigt", other: "Övrigt" };
/** Etiketten för Övrigt som ser ut som ett avbrott av en insats (avbrott via mejl, beslut 2026-10-09). */
export const CANCELLATION_LABEL = "Avbrott";
export const CLASS_ICON: Partial<Record<EmailClassification, IconName>> = { supplement: "link", other: "message-circle" };
export type BadgeToneName = "blue" | "bluetone" | "grey" | "red" | "redfill" | "dark" | "outline" | "plan";
export const STATUS: Record<string, [string, BadgeToneName, IconName]> = {
  acknowledged: ["Väntar på beslut", "outline", "clock"],
  received: ["Väntar på beslut", "outline", "clock"],
  protected: ["Säker rutin", "red", "lock"],
  linked: ["Att föra in", "outline", "link"],
  other: ["Att besvara", "outline", "message"],
  accepted: ["Accepterad", "blue", "check"],
  declined: ["Avböjd", "dark", "x-circle"],
  applied: ["Införd i ärendet", "bluetone", "check"],
  handled: ["Hanterad", "bluetone", "check"],
};
export const statusLook = (s: string): [string, BadgeToneName, IconName] => STATUS[s] ?? [s, "grey", "circle"];

// ---------------------------------------------------------------- Fälten i det tolkade formuläret
// Beställningen följer portalens steg (beslut 2026-10-07, synpunkt #3–#9): kontakt, startdatum och omfattning; deltagaren;
// bakgrundsinformationen. Beslut 2026-10-09: deltagarens yrkesområde (primaryArea) frågas efter i steg 2 – bostadsort och
// föredragen kontaktväg inte längre (de visas bara när ett äldre mejl har dem). Beställarreferens, alternativt område och
// yrkesspår frågas inte efter – Miljonbemanning sätter dem vid accept. Gamla nycklar (plannedWeeks, protectedIdentity,
// accessibilityNeeds) finns kvar i typen för gamla mejl men visas inte.
export const FIELD_LABEL: Record<OrderField, string> = {
  referrerName: "Handläggare", referrerUnit: "Enhet", referrerPhone: "Handläggarens telefon", referrerEmail: "Handläggarens e-post",
  buyerReference: "Beställarreferens", desiredStart: "Önskat startdatum", plannedEnd: "Slutdatum", plannedWeeks: "Planerad omfattning",
  orderPeriod: "Omfattning", orderPeriodReason: "Motivering till annan tidsperiod",
  firstName: "Förnamn", lastName: "Efternamn", pnr: "Personnummer", phone: "Telefon", email: "E-post", city: "Bostadsort",
  preferredContact: "Föredragen kontaktväg", protectedIdentity: "Skyddat", accessibilityNeeds: "Anpassning",
  priorAssessment: "Kartläggning genomförd", background: "Bakgrundsinformation",
  primaryArea: "Yrkesområde", secondaryArea: "Avtalsområde (alternativt)", vocationalTrack: "Yrkesspår",
};
export const FIELD_GROUPS: readonly (readonly [string, readonly OrderField[]])[] = [
  ["1. Beställning och kontakt", ["referrerName", "referrerUnit", "referrerPhone", "referrerEmail", "desiredStart", "orderPeriod", "plannedEnd", "orderPeriodReason"]],
  ["2. Deltagare", ["firstName", "lastName", "pnr", "phone", "email", "primaryArea", "city", "preferredContact"]],
  ["3. Bakgrundsinformation om deltagaren", ["priorAssessment", "background"]],
  ["Uppgifter som Miljonbemanning sätter vid accept", ["buyerReference", "secondaryArea", "vocationalTrack"]],
];
/**
 * Fält som visas bara när mejlet har ett värde: de som inte frågas efter (sista gruppen, och bostadsort och kontaktväg sedan
 * 2026-10-09). Slutdatum och motivering bara vid annan tidsperiod.
 */
export const OPTIONAL_FIELDS: readonly OrderField[] = ["buyerReference", "secondaryArea", "vocationalTrack", "plannedEnd", "orderPeriodReason", "city", "preferredContact"];
/** Beställningsuppgifterna som samordnaren kan rätta (ink.correct). Avtalsområde och yrkesspår sätts i acceptdialogen. */
export const ORDER_FIELDS = ["desiredStart", "orderPeriod", "plannedEnd", "orderPeriodReason", "buyerReference"] as const;
export type OrderFieldKey = (typeof ORDER_FIELDS)[number];

// ---------------------------------------------------------------- Avslag
export const DECLINE_REASONS = [
  "Vi har inte kapacitet under önskad period",
  "Avtalsområdet kan inte erbjudas just nu",
  "Deltagaren har redan en aktiv insats hos oss",
  "Beställningen ligger utanför avtalets omfattning",
  "Annat skäl",
] as const;

// ---------------------------------------------------------------- Förfaller (deadlines)
export type DeadlineKindKey =
  | "avrop_svar" | "forsta_mote" | "veckorapport_registrering" | "veckorapport_publicering" | "manadsrapport"
  | "slutrapport" | "bestallarrapport" | "atgardsplan" | "fakturering" | "avvikelse_uppfoljning";
export const DL_KIND: Record<DeadlineKindKey, { label: string; icon: IconName; chain: ChainKey }> = {
  avrop_svar: { label: "Svar på avrop", icon: "inbox", chain: "samordnare" },
  forsta_mote: { label: "Första möte", icon: "calendar", chain: "samordnare" },
  veckorapport_registrering: { label: "Närvaroregistrering", icon: "check-square", chain: "coach" },
  veckorapport_publicering: { label: "Veckorapport", icon: "file", chain: "samordnare" },
  manadsrapport: { label: "Månadsrapport", icon: "file", chain: "coach" },
  slutrapport: { label: "Slutrapport", icon: "file", chain: "coach" },
  bestallarrapport: { label: "Beställarrapport", icon: "chart", chain: "avtalsansvarig" },
  atgardsplan: { label: "Åtgärdsplan", icon: "flag", chain: "avtalsansvarig" },
  fakturering: { label: "Fakturering", icon: "card", chain: "ekonom" },
  avvikelse_uppfoljning: { label: "Uppföljning av avvikelse", icon: "alert-circle", chain: "coach" },
};
export type ChainKey = "coach" | "samordnare" | "avtalsansvarig" | "ekonom";
export const CHAIN: Record<ChainKey, string[]> = { coach: ["Coach", "Samordnare", "Chef"], samordnare: ["Samordnare", "Chef"], avtalsansvarig: ["Avtalsansvarig", "Chef"], ekonom: ["Ekonom", "Chef"] };
export const kindLabel = (k: string): string => DL_KIND[k as DeadlineKindKey]?.label ?? k;

/** Beskrivning utan att upprepa typen ("Svar på avrop (acceptera eller avböj)" → "Acceptera eller avböj"). */
export function dlDesc(kind: string, label: string): string | null {
  const kl = kindLabel(kind);
  const lab = String(label || "");
  if (lab === kl) return null;
  if (lab.startsWith(kl)) {
    const rest = lab.slice(kl.length).trim();
    if (/^[:(]/.test(rest)) {
      const r = rest.replace(/^:\s*/, "").replace(/^\((.*)\)$/, "$1");
      return r ? r.charAt(0).toUpperCase() + r.slice(1) : null;
    }
  }
  return lab;
}

/** En förfallorad i vy-modellen (Förfaller och startsidan). */
export type DeadlineRow = {
  id: string;
  kind: DeadlineKindKey;
  label: string;
  dueAt: string;
  /** "i dag kl. 10.00" */
  dueWhen: string;
  /** "måndag 1 feb 2027 kl. 10.00" */
  dueLong: string;
  sla: { label: string; tone: "ok" | "soon" | "urgent" | "over" | "met" };
  bucket: "overdue" | "today" | "week";
  caseId: string | null;
  caseNumber: string | null;
  provisional: boolean;
  /** Ansvarig, t.ex. "Samordnare · Sara Lindqvist" eller coachens namn. */
  ownerName: string;
  chain: string[];
  /** Eskaleringssteg: 0 = ägaren, 1 = nästa, 2 = sista. */
  step: number;
  /** Sökväg för "Öppna" om rollen kan öppna vyn. */
  href: string | null;
  /** Månadsrapporter: huvudcoachens namn (för sammanslagna rader). */
  coachName: string | null;
};
export type DeadlineGroupRow = DeadlineRow & { aggregate?: { count: number; byCoach: string; href: string | null } };

/**
 * Månadsrapporter med samma förfallotid slås ihop till en rad per förfallotid (annars ~80 rader).
 * reportsHref = sökvägen till rapportlistan om rollen kan öppna den.
 */
export function groupDeadlines(list: readonly DeadlineRow[], reportsHref: string | null): DeadlineGroupRow[] {
  const out: DeadlineGroupRow[] = [];
  const agg = new Map<string, { row: DeadlineGroupRow; items: DeadlineRow[] }>();
  for (const x of list) {
    if (x.kind === "manadsrapport") {
      const key = `${x.kind}:${x.dueAt}`;
      let g = agg.get(key);
      if (!g) {
        g = { row: { ...x, id: `agg:${key}` }, items: [] };
        agg.set(key, g);
        out.push(g.row);
      }
      g.items.push(x);
    } else out.push(x);
  }
  for (const g of agg.values()) {
    const i = out.indexOf(g.row);
    if (g.items.length === 1) {
      out[i] = g.items[0];
      continue;
    }
    const counts = new Map<string, number>();
    for (const it of g.items) counts.set(it.coachName ?? "Utan coach", (counts.get(it.coachName ?? "Utan coach") ?? 0) + 1);
    // Prototypen: flest först (stabil sortering behåller ordningen vid lika antal).
    const byCoach = [...counts.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => (a.n < b.n ? 1 : a.n > b.n ? -1 : 0)).map((b) => `${b.name} ${b.n}`).join(" · ");
    out[i] = { ...g.row, ownerName: "Respektive huvudcoach", chain: CHAIN.coach, href: reportsHref, aggregate: { count: g.items.length, byCoach, href: reportsHref } };
  }
  return out;
}
