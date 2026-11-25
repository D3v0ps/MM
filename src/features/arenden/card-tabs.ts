// Deltagarkortets flikar (Karims beslut 2026-11-25): sex flikar i raden – Översikt, Närvaro, Möten, Anteckningar, Delmål och
// Progression och resultat – och resten under Mer (Tidslinje, Kartläggning, Månadsunderlag, Avvikelser, Praktik, Rapporter,
// Meddelanden och Historik). Bara presentationen ändrades: vilka flikar en roll får är desamma som förut (full åtkomst: alla,
// teamåtkomst: TEAM_TABS). Delmål är en egen flik (kortet låg förut sist under Händelser och utfall) och visas när
// CaseCard.progressGoals är sant – Miljonbemanning med full- eller teamåtkomst, och ärendet har delmål. Aldrig kommunen
// (kommunens deltagarsida är en egen skärm). Ren modell utan React – skärmen (screens/kort.tsx) och testerna läser den.
import { CASE_MORE_TABS, CASE_TABS, TEAM_TABS, type CaseCard, type CaseTab } from "./api";

/** Flikarnas namn. handelser heter Progression och resultat sedan 2026-11-25 (nyckeln är kvar, så att gamla länkar fungerar). */
export const CASE_TAB_LABEL: Record<CaseTab, string> = {
  oversikt: "Översikt", narvaro: "Närvaro", avstamningar: "Möten", anteckningar: "Anteckningar", delmal: "Delmål", handelser: "Progression och resultat",
  tidslinje: "Tidslinje", kartlaggning: "Kartläggning", manad: "Månadsunderlag", avvikelser: "Avvikelser", praktik: "Praktik", rapporter: "Rapporter",
  meddelanden: "Meddelanden", historik: "Historik",
};
/** Teamet ser inte Progression och resultat – fliken visar arbetsgivarkontakterna och händelserna (som före 2026-11-25). */
const TEAM_LABEL: Partial<Record<CaseTab, string>> = { handelser: "Arbetsgivarkontakter och händelser" };

export const isCaseTab = (v: string | null | undefined): v is CaseTab => !!v && (CASE_TABS as readonly string[]).includes(v);
const isMore = (t: CaseTab) => (CASE_MORE_TABS as readonly string[]).includes(t);

export type CardTabs = {
  /** Flikarna i raden, i ordning. */
  main: CaseTab[];
  /** Flikarna under Mer, i menyns ordning. Tom = ingen Mer. */
  more: CaseTab[];
  /** Alla flikar som rollen ser (main + more). */
  all: CaseTab[];
};

/** Flikarna som kortet visar för rollens åtkomst och ärendet. */
export function cardTabs(card: Pick<CaseCard, "access" | "progressGoals">): CardTabs {
  const allowed: readonly CaseTab[] = card.access === "team" ? TEAM_TABS : CASE_TABS;
  const all = CASE_TABS.filter((t) => allowed.includes(t) && (t !== "delmal" || card.progressGoals));
  return { main: all.filter((t) => !isMore(t)), more: all.filter(isMore), all };
}

/** Flikens namn för rollens åtkomst. */
export const cardTabLabel = (t: CaseTab, access: CaseCard["access"]): string => (access === "team" && TEAM_LABEL[t]) || CASE_TAB_LABEL[t];

/**
 * Fliken som ?flik= (och ?visa=rost) öppnar. Okänd eller saknad: Översikt. blocked = fliken finns men visas inte för rollens
 * åtkomst (teamet) – inte när Delmål saknas för att ärendet inte har några delmål.
 */
export function cardTabFor(flik: string | null | undefined, visa: string | null | undefined, tabs: Pick<CardTabs, "all">): { tab: CaseTab; blocked: boolean } {
  const shown = isCaseTab(flik) && tabs.all.includes(flik);
  // ?visa=rost ("Läs röstmeddelandet" på Min vecka): röstmeddelandena ligger under Meddelanden sedan 2026-10-09.
  const tab: CaseTab = shown ? flik : visa === "rost" && tabs.all.includes("meddelanden") ? "meddelanden" : "oversikt";
  return { tab, blocked: !shown && isCaseTab(flik) && flik !== "delmal" };
}
