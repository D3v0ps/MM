// Avtalskonfigurationen i klarspråk (skärmen /admin/avtal). Isomorf och utan I/O – värdena kommer alltid från
// contracts.config; här finns bara hur de skrivs ut. Texterna är exakt den gamla prototypens (prototyp/src/views/admin.js).
import { isUnset, type SlaRule } from "@/core/config";
import { withinText } from "./templates";

export const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ---------------------------------------------------------------- Värden som inte är fastställda (ATT_FASTSTÄLLA)
export type UnsetItem = { path: string; value: string };
/** Alla ATT_FASTSTÄLLA i konfigurationen. Listelement skrivs med sin nyckel: "kpis.narvarograd.internalTarget". */
export function findUnset(obj: unknown, path: string[] = []): UnsetItem[] {
  if (isUnset(obj)) return [{ path: path.join("."), value: obj }];
  const out: UnsetItem[] = [];
  if (Array.isArray(obj)) {
    obj.forEach((x, i) => {
      const k = x && typeof x === "object" ? ((x as { key?: unknown; no?: unknown; code?: unknown }).key ?? (x as { no?: unknown }).no ?? (x as { code?: unknown }).code) : null;
      out.push(...findUnset(x, [...path, k ? String(k) : String(i)]));
    });
  } else if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) out.push(...findUnset(v, [...path, k]));
  return out;
}

/** Vad värdet gäller och vem som bestämmer (fråga till Botkyrka, internt beslut eller test). */
export const UNSET_INFO: Record<string, [string, number | "internt" | "test"]> = {
  "customerVisibility.scope": ["Vilka ärenden kommunens användare ser", 9],
  "result.definition": ["Resultatdefinition – vilka anställningar och studier som räknas", 6],
  "result.excludedFromDenominator": ["Vilka avslut som inte räknas i nämnaren", 6],
  "kpis.narvarograd.internalTarget": ["Internt mål för närvarograd", "internt"],
  "kpis.nojdhet.internalTarget": ["Internt mål för nöjdhet", "internt"],
  "sla.manadsrapport.due": ["Sista dag för månadsrapport", 8],
  "sla.slutrapport.within": ["Sista dag för slutrapport", 8],
  "attendance.sameDayNoticeOnInvalidAbsence": ["Frånvaronotis till kommunen samma dag", 7],
  "bonus.model": ["Incitamentsmodell för bonus", 13],
  retention: ["Gallring under avtalstiden", 11],
  "retentionRules.attachmentsAfterCloseDays": ["Gallring av bilagor till beställningen", 27],
  "ai.provider": ["AI-leverantör", "test"],
};
export const whoDecides = (q: number | "internt" | "test"): string =>
  q === "internt" ? "Beslutas internt av Miljonbemanning" : q === "test" ? "Väljs genom test i utvecklingsfas 2" : `Fråga ${q} till Botkyrka`;

// ---------------------------------------------------------------- Ord
export const WINDOW: Record<string, string> = { rolling_6m: "rullande 6 månader", since_start: "sedan avtalsstart", month: "per månad", rolling_3m: "rullande 3 månader" };
const FROM: Record<string, string> = { avrop_mottaget: "från att avropet kommit in", avslutsdatum: "från avslutsdatum", bestallning: "från beställning" };
export const UNIT: Record<string, string> = { participant_week: "Per deltagare och vecka" };
export const ROLE_WORD: Record<string, string> = { chef: "chef", controller: "controller", avtalsansvarig: "avtalsansvarig", samordnare: "samordnare", coach: "coach" };
export const DATA_ROLE: Record<string, string> = {
  processor: "Personuppgiftsbiträde – kommunen är personuppgiftsansvarig. PUB-avtal enligt SKR:s mall.",
};
export const LANGUAGE: Record<string, string> = { sv: "svenska", en: "engelska", ar: "arabiska", so: "somaliska" };
export const OCCASION: Record<string, string> = { week2: "vecka 2", exit: "vid avslut" };

/** "Inom 5 minuter från att avropet kommit in" eller förfallotiden i klarspråk. null = ej fastställt (visas som markering). */
export function slaRuleText(s: SlaRule): string | null {
  if (s.within && typeof s.within === "object") return `Inom ${withinText(s.within)} ${FROM[s.from ?? ""] ?? ""}`.trim();
  if (isUnset(s.within) || isUnset(s.due)) return null;
  if (s.due) return cap(String(s.due).replace(/(\d\d):(\d\d)/, "$1.$2"));
  return "–";
}
/** Mönstret som text: "^[0-9]{8,10}$" → "8–10 siffror", "^99[0-9]{7}$" → "9 siffror som börjar med 99". */
export function humanPattern(p: string): string {
  let m = String(p).match(/^\^\[0-9\]\{(\d+),(\d+)\}\$$/);
  if (m) return `${m[1]}–${m[2]} siffror`;
  m = String(p).match(/^\^(\d+)\[0-9\]\{(\d+)\}\$$/);
  if (m) return `${m[1].length + Number(m[2])} siffror som börjar med ${m[1]}`;
  return p;
}
