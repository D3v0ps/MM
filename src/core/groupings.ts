// Nivåer och taggar (coachmötet 2026-10-09, Karims beslut 3; Karims beslut 2026-10-22) – ren domänlogik utan I/O.
//
// Miljonbemannings interna arbetsverktyg: en människa (Adam i kartläggningen, coacherna, samordnaren) placerar deltagaren på
// en av fem nivåer och sätter taggar (t.ex. "Vill arbeta": Heltid, Deltid, Vet inte än). AI placerar aldrig någon och bedömer
// aldrig motivation. Allt är internt – aldrig synligt för kommunen, i rapporter, resultatfilen, exporter, fakturor eller i
// underlaget till AI.
//
// Karims beslut 2026-10-22: "Grupperna ändras om till yrkesområdena" och "Fria grupper ska tas bort". Deltagarens grupp är
// ärendets yrkesområde (cases.primaryAreaCode) – den härleds, ingen placerar den. Grupperingar av typen group finns bara kvar
// som historik (arkiverade av migrationen 0035) och visas aldrig. "Fem nivåer, deltagare är i exakt en nivå åt gången": nivån
// sätts i kartläggningen (krävs innan den godkänns), höjs eller byts sedan – den tas aldrig bort.
//
// Reglerna (samma i databasen, 0031 och 0035, och i minnet, UNIQUE_KEYS och policy.ts):
//   * högst en aktiv nivå per ärende och högst ett aktivt värde per taggkategori – medlemskapets slot ("level",
//     "tag:<kategori>") och ett partiellt unikt index (case_id, slot) där removed_at är null
//   * en arkiverad gruppering kan inte väljas för fler deltagare (befintliga medlemskap ligger kvar tills de tas bort)
//   * ingen ny aktiv grupp och inget nytt aktivt medlemskap i en grupp (0035)
//   * inget raderas: grupperingar arkiveras, medlemskap får removedAt – borttagna nivåer är nivåhistoriken
import type { Role } from "@/api/roles";
import type { Contract, Grouping, GroupingKind, GroupingMember } from "@/data/schema";
import { GROUPING_CATEGORY_MAX, GROUPING_DESCRIPTION_MAX, GROUPING_NAME_MAX } from "@/data/schema";
import type { LocalDateTime } from "./time";
import { looksLikePnr } from "./validation";

// ---------------------------------------------------------------- Roller (samma i policy.ts, RLS i 0031 och hanterarna)
/** Läser avtalets grupperingar och ärendenas medlemskap: Miljonbemanning utom ekonomen (internt – aldrig kommunen). */
export const GROUPING_READERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin"];
/** Skapar, byter namn på och arkiverar avtalets nivåer, grupper och taggar. */
export const GROUPING_WRITERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "admin"];
/**
 * Placerar deltagare i nivå, grupper och taggar (Karims beslut 3: en människa – Adam, coacherna, samordnaren). Inte
 * systemadministratören: hen arbetar i ärendena i läsläge (deltagarkortet) och sköter bara avtalets grupperingar.
 */
export const GROUPING_MEMBER_WRITERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach"];

// ---------------------------------------------------------------- Plats (slot)
export const LEVEL_SLOT = "level";
export const tagSlot = (category: string): string => `tag:${category}`;
/** Platsen ett medlemskap tar: "level", "tag:<kategori>" eller null (grupp). Samma regel som mm.grouping_slot (0031). */
export function slotOf(g: Pick<Grouping, "kind" | "category">): string | null {
  if (g.kind === "level") return LEVEL_SLOT;
  if (g.kind === "tag") return tagSlot(g.category ?? "");
  return null;
}

// ---------------------------------------------------------------- Standardvärden (migrationen 0031 och testdatat)
/**
 * De fem nivåerna med namn (Karims beslut 3). Ordet "nivå" står alltid för dessa fem – progressionsnivå 0–3 i månadsbedömningen
 * skrivs alltid ut som progressionsnivå, och Fas 1–5 är något annat.
 */
export const DEFAULT_LEVELS = [
  "Nivå 1 – Långt från arbete",
  "Nivå 2 – Behöver stöd för att komma igång",
  "Nivå 3 – På väg",
  "Nivå 4 – Nära arbete",
  "Nivå 5 – Redo för arbete",
] as const;
/** Taggkategorin för hur mycket deltagaren vill arbeta – deltagarens eget svar. */
export const WANTS_WORK_CATEGORY = "Vill arbeta";
export const DEFAULT_WANTS_WORK = [
  { slug: "heltid", name: "Heltid" },
  { slug: "deltid", name: "Deltid" },
  { slug: "vet-inte-an", name: "Vet inte än" },
] as const;
/** Id för standardvärdena – samma i migrationen 0031 och i testdatat. */
export const defaultLevelId = (contractId: string, n: number): string => `grp-${contractId}-niva-${n}`;
export const defaultWantsWorkId = (contractId: string, slug: string): string => `grp-${contractId}-vill-arbeta-${slug}`;

/** Standardvärdena för ett avtal: fem nivåer och taggkategorin "Vill arbeta". Inga grupper – grupperna är yrkesområdena. */
export function defaultGroupings(contractId: string, at: LocalDateTime): Grouping[] {
  const base = { contractId, description: "", createdAt: at, createdBy: null, updatedAt: null, updatedBy: null, archivedAt: null, archivedBy: null };
  return [
    ...DEFAULT_LEVELS.map((name, i): Grouping => ({ ...base, id: defaultLevelId(contractId, i + 1), kind: "level", category: null, name, sortOrder: i + 1 })),
    ...DEFAULT_WANTS_WORK.map((t, i): Grouping => ({ ...base, id: defaultWantsWorkId(contractId, t.slug), kind: "tag", category: WANTS_WORK_CATEGORY, name: t.name, sortOrder: i + 1 })),
  ];
}

// ---------------------------------------------------------------- Validering
export const GROUPING_KIND_LABEL: Record<GroupingKind, string> = { level: "Nivå", group: "Grupp (borttagen)", tag: "Tagg" };
/** Svaret när någon försöker skapa eller välja en fri grupp (Karims beslut 2026-10-22). */
export const FREE_GROUPS_REMOVED_TEXT = "Fria grupper finns inte längre. Grupperna är yrkesområdena och följer deltagarens yrkesområde.";
/** Kartläggningen godkänns bara med en nivå (Karims beslut 2026-10-22). */
export const LEVEL_REQUIRED_TEXT = "Välj nivå innan du godkänner kartläggningen.";
/** En deltagare är alltid i en nivå när den väl är satt – den byts, den tas inte bort. */
export const LEVEL_KEPT_TEXT = "En deltagare har alltid en nivå. Byt nivå i stället.";

/** Namnet på en nivå, grupp eller tagg: 1–80 tecken, inga personnummer. Null = godkänt. */
export function groupingNameError(name: string): string | null {
  const t = name.trim();
  if (!t) return "Skriv ett namn.";
  if ([...t].length > GROUPING_NAME_MAX) return `Namnet får vara högst ${GROUPING_NAME_MAX} tecken.`;
  if (looksLikePnr(t)) return "Namnet får inte innehålla personnummer.";
  return null;
}
export function groupingDescriptionError(text: string): string | null {
  if ([...text.trim()].length > GROUPING_DESCRIPTION_MAX) return `Beskrivningen får vara högst ${GROUPING_DESCRIPTION_MAX} tecken.`;
  if (looksLikePnr(text)) return "Beskrivningen får inte innehålla personnummer.";
  return null;
}
export function groupingCategoryError(category: string): string | null {
  const t = category.trim();
  if (!t) return "Skriv en kategori.";
  if ([...t].length > GROUPING_CATEGORY_MAX) return `Kategorin får vara högst ${GROUPING_CATEGORY_MAX} tecken.`;
  if (looksLikePnr(t)) return "Kategorin får inte innehålla personnummer.";
  return null;
}
/** Samma namn (utan hänsyn till stora och små bokstäver eller mellanslag runt) – två aktiva med samma namn blir förvirrande. */
export const sameName = (a: string, b: string): boolean => a.trim().toLocaleLowerCase("sv") === b.trim().toLocaleLowerCase("sv");

// ---------------------------------------------------------------- Ett ärendes nivå, grupper och taggar
export const activeMembers = (members: readonly GroupingMember[]): GroupingMember[] => members.filter((m) => m.removedAt == null);
export const byOrder = (a: Pick<Grouping, "sortOrder" | "name">, b: Pick<Grouping, "sortOrder" | "name">): number =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "sv");

export type CaseGroupings = {
  level: { id: string; name: string } | null;
  tags: { id: string; category: string; name: string }[];
};

/** Ärendets aktiva nivå och taggar (i grupperingarnas ordning). Gamla grupper (historik, 0035) visas aldrig. */
export function caseGroupings(caseId: string, members: readonly GroupingMember[], groupings: readonly Grouping[]): CaseGroupings {
  const byId = new Map(groupings.map((g) => [g.id, g]));
  const mine = activeMembers(members)
    .filter((m) => m.caseId === caseId)
    .map((m) => byId.get(m.groupingId))
    .filter((g): g is Grouping => !!g)
    .sort(byOrder);
  const level = mine.find((g) => g.kind === "level");
  return {
    level: level ? { id: level.id, name: level.name } : null,
    tags: mine
      .filter((g) => g.kind === "tag")
      .sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "", "sv") || byOrder(a, b))
      .map((g) => ({ id: g.id, category: g.category ?? "", name: g.name })),
  };
}

/** Index: ärende -> id för dess aktiva nivå och taggar (filtren i listorna). Gamla grupper räknas inte. */
export function groupingIdsByCase(members: readonly GroupingMember[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of activeMembers(members)) {
    if (m.kind === "group") continue;
    const s = out.get(m.caseId);
    if (s) s.add(m.groupingId);
    else out.set(m.caseId, new Set([m.groupingId]));
  }
  return out;
}

export type GroupingFilterOption = { id: string; name: string };
/**
 * Valen i filtren Nivå och Tagg (ärendelistan, coachens Närvaro): aktiva nivåer och taggar i ordning, taggarna som
 * "Vill arbeta: Heltid". Varje avtal har sina egna – finns grupperingar från fler än ett avtal står avtalets prefix efter
 * namnet ("Nivå 2 – … (BOT)"), så att ärenden i alla avtal kan filtreras på sina egna. Filtret Yrkesområde bygger på
 * avtalsområdena (yrkesomradeFilterOptions). Gamla grupper (0035) är aldrig med.
 */
export function groupingFilterOptions(
  groupings: readonly Grouping[],
  contracts: readonly Pick<Contract, "id" | "casePrefix">[],
): { levels: GroupingFilterOption[]; tags: GroupingFilterOption[] } {
  const active = groupings.filter((g) => g.archivedAt == null);
  const several = new Set(active.map((g) => g.contractId)).size > 1;
  const prefix = new Map(contracts.map((c) => [c.id, c.casePrefix]));
  const label = (g: Grouping, name: string) => (several ? `${name} (${prefix.get(g.contractId) ?? g.contractId})` : name);
  const byContract = (a: Grouping, b: Grouping) => a.contractId.localeCompare(b.contractId);
  const of = (kind: GroupingKind) => active.filter((g) => g.kind === kind);
  return {
    levels: of("level").sort((a, b) => byContract(a, b) || byOrder(a, b)).map((g) => ({ id: g.id, name: label(g, g.name) })),
    tags: of("tag")
      .sort((a, b) => byContract(a, b) || (a.category ?? "").localeCompare(b.category ?? "", "sv") || byOrder(a, b))
      .map((g) => ({ id: g.id, name: label(g, `${g.category}: ${g.name}`) })),
  };
}

/** Filtret i listorna: nivå och tagg (id eller tomt). Alla valda måste stämma. Yrkesområdet filtreras på ärendets kod. */
export type GroupingFilter = { level?: string | null; tag?: string | null };
export function matchesGroupingFilter(ids: ReadonlySet<string> | undefined, f: GroupingFilter): boolean {
  for (const want of [f.level, f.tag]) if (want && !ids?.has(want)) return false;
  return true;
}

/** Ett yrkesområde i filtren: koden (värdet i adressen) och "G – Lager och logistik". */
export type AreaFilterOption = { code: string; name: string };
/**
 * Valen i filtret Yrkesområde: avtalens aktiva avtalsområden (A–L) i bokstavsordning, "G – Lager och logistik". Med fler än ett
 * avtal står avtalets prefix efter namnet; koden kan då finnas i flera avtal – filtret gäller koden.
 */
export function yrkesomradeFilterOptions(
  areas: readonly { contractId: string; code: string; name: string; active: boolean }[],
  contracts: readonly Pick<Contract, "id" | "casePrefix">[],
): AreaFilterOption[] {
  const ids = new Set(contracts.map((c) => c.id));
  const active = areas.filter((a) => a.active && ids.has(a.contractId));
  const several = new Set(active.map((a) => a.contractId)).size > 1;
  const prefix = new Map(contracts.map((c) => [c.id, c.casePrefix]));
  const order = new Map(contracts.map((c, i) => [c.id, i]));
  const seen = new Map<string, string>();
  for (const a of [...active].sort((x, y) => x.code.localeCompare(y.code, "sv") || (order.get(x.contractId) ?? 0) - (order.get(y.contractId) ?? 0))) {
    const label = `${a.code} – ${a.name}${several ? ` (${prefix.get(a.contractId) ?? a.contractId})` : ""}`;
    seen.set(a.code, seen.has(a.code) ? `${seen.get(a.code)} / ${label}` : label);
  }
  return [...seen.entries()].map(([code, name]) => ({ code, name }));
}

// ---------------------------------------------------------------- Nivån: höja, byta och historiken
/** Nästa nivå efter den nuvarande (sorteringsordningen), eller null: ingen nivå än, okänd nivå eller redan högsta (nivå 5). */
export function nextLevelId(levels: readonly Grouping[], currentId: string | null): string | null {
  if (!currentId) return null;
  const sorted = levels.filter((g) => g.kind === "level" && g.archivedAt == null).sort(byOrder);
  const i = sorted.findIndex((g) => g.id === currentId);
  return i >= 0 && i < sorted.length - 1 ? sorted[i + 1].id : null;
}

export type LevelHistoryEntry = { levelId: string; name: string; from: LocalDateTime; until: LocalDateTime | null; byName: string | null };
/**
 * Ärendets nivåer över tid ("Nivå 1 från 9 okt (Amira), Nivå 2 från 22 okt (Sara)"): alla nivåmedlemskap, också borttagna,
 * i den ordning de sattes. names: användarens id -> namn (null när namnet inte får eller kan läsas).
 */
export function levelHistory(caseId: string, members: readonly GroupingMember[], groupings: readonly Grouping[], names: ReadonlyMap<string, string>): LevelHistoryEntry[] {
  const byId = new Map(groupings.map((g) => [g.id, g]));
  return members
    .filter((m) => m.caseId === caseId && m.kind === "level")
    .sort((a, b) => (a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : a.id < b.id ? -1 : 1))
    .map((m) => ({ levelId: m.groupingId, name: byId.get(m.groupingId)?.name ?? "Nivå", from: m.addedAt, until: m.removedAt, byName: names.get(m.addedBy) ?? null }));
}

// ---------------------------------------------------------------- Ändra ett ärendes nivå, grupper och taggar
/** Det önskade läget: nivån (eller ingen – bara innan den är satt) och ett värde (eller inget) per taggkategori. */
export type CaseGroupingState = { levelId: string | null; tags: Readonly<Record<string, string | null>> };
export type CaseGroupingPlan = { add: Grouping[]; remove: GroupingMember[] };
export type CaseGroupingError = "unknown" | "archived" | "wrong_kind" | "wrong_category";

/**
 * Vad som ska läggas till och tas bort för att ärendet ska få det önskade läget. Bara avtalets grupperingar; en arkiverad
 * gruppering kan behållas men inte väljas på nytt. Taggkategorier som inte finns med i tags lämnas orörda. Nivån styrs helt av
 * läget; gamla grupper (historik, 0035) rörs aldrig. En fri grupp kan inte väljas (wrong_kind).
 */
export function planCaseGroupings(
  current: readonly GroupingMember[],
  want: CaseGroupingState,
  groupings: readonly Grouping[],
): { ok: true; plan: CaseGroupingPlan } | { ok: false; error: CaseGroupingError; groupingId: string } {
  const byId = new Map(groupings.map((g) => [g.id, g]));
  const active = activeMembers(current);
  const has = new Set(active.map((m) => m.groupingId));
  const wanted = new Set<string>();
  const check = (id: string, kind: GroupingKind, category?: string): CaseGroupingError | null => {
    const g = byId.get(id);
    if (!g) return "unknown";
    if (g.kind !== kind) return "wrong_kind";
    if (kind === "tag" && g.category !== category) return "wrong_category";
    if (g.archivedAt && !has.has(id)) return "archived";
    return null;
  };
  if (want.levelId) {
    const e = check(want.levelId, "level");
    if (e) return { ok: false, error: e, groupingId: want.levelId };
    wanted.add(want.levelId);
  }
  const touchedCategories = new Set(Object.keys(want.tags));
  for (const [category, id] of Object.entries(want.tags)) {
    if (!id) continue;
    const e = check(id, "tag", category);
    if (e) return { ok: false, error: e, groupingId: id };
    wanted.add(id);
  }
  // Det som ska bort: nivån styrs helt av läget; taggar bara i de kategorier som finns med; gamla grupper aldrig.
  const remove = active.filter((m) => {
    if (wanted.has(m.groupingId)) return false;
    const g = byId.get(m.groupingId);
    if (m.kind === "tag") return !!g && touchedCategories.has(g.category ?? "");
    return m.kind === "level";
  });
  const add = [...wanted].filter((id) => !has.has(id)).map((id) => byId.get(id)!);
  // Borttagningar först, så att en ny nivå eller tagg aldrig krockar med den gamla i det unika indexet.
  return { ok: true, plan: { add, remove } };
}

export const CASE_GROUPING_ERROR_TEXT: Record<CaseGroupingError, string> = {
  unknown: "Nivån eller taggen finns inte längre. Ladda om sidan.",
  archived: "Nivån eller taggen är arkiverad och kan inte väljas.",
  wrong_kind: "Valet passar inte här. Ladda om sidan.",
  wrong_category: "Taggen hör till en annan kategori. Ladda om sidan.",
};
