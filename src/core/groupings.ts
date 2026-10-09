// Grupper, nivåer och taggar (coachmötet 2026-10-09, Karims beslut 3) – ren domänlogik utan I/O.
//
// Miljonbemannings interna arbetsverktyg: en människa (Adam i kartläggningen, coacherna, samordnaren) placerar deltagaren på
// en av fem nivåer, i grupper som MB skapar fritt och med taggar (t.ex. "Vill arbeta": Heltid, Deltid, Vet inte än). AI
// placerar aldrig någon och bedömer aldrig motivation. Allt är internt – aldrig synligt för kommunen, i rapporter,
// resultatfilen, exporter, fakturor eller i underlaget till AI.
//
// Reglerna (samma i databasen, 0031, och i minnet, UNIQUE_KEYS och policy.ts):
//   * högst en aktiv nivå per ärende och högst ett aktivt värde per taggkategori – medlemskapets slot ("level",
//     "tag:<kategori>") och ett partiellt unikt index (case_id, slot) där removed_at är null; grupper har ingen slot
//   * en arkiverad gruppering kan inte väljas för fler deltagare (befintliga medlemskap ligger kvar tills de tas bort)
//   * inget raderas: grupperingar arkiveras, medlemskap får removedAt
import type { Grouping, GroupingKind, GroupingMember } from "@/data/schema";
import { GROUPING_CATEGORY_MAX, GROUPING_DESCRIPTION_MAX, GROUPING_NAME_MAX } from "@/data/schema";
import type { LocalDateTime } from "./time";
import { looksLikePnr } from "./validation";

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
/** De fem nivåerna med namn (Karims beslut 3). Bara ordet "nivå" blandas ihop med nivå 0–3 i månadsbedömningen och Fas 1–5. */
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

/** Standardvärdena för ett avtal: fem nivåer och taggkategorin "Vill arbeta". Inga standardgrupper – MB skapar dem fritt. */
export function defaultGroupings(contractId: string, at: LocalDateTime): Grouping[] {
  const base = { contractId, description: "", createdAt: at, createdBy: null, updatedAt: null, updatedBy: null, archivedAt: null, archivedBy: null };
  return [
    ...DEFAULT_LEVELS.map((name, i): Grouping => ({ ...base, id: defaultLevelId(contractId, i + 1), kind: "level", category: null, name, sortOrder: i + 1 })),
    ...DEFAULT_WANTS_WORK.map((t, i): Grouping => ({ ...base, id: defaultWantsWorkId(contractId, t.slug), kind: "tag", category: WANTS_WORK_CATEGORY, name: t.name, sortOrder: i + 1 })),
  ];
}

// ---------------------------------------------------------------- Validering
export const GROUPING_KIND_LABEL: Record<GroupingKind, string> = { level: "Nivå", group: "Grupp", tag: "Tagg" };

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
  groups: { id: string; name: string }[];
  tags: { id: string; category: string; name: string }[];
};

/** Ärendets aktiva nivå, grupper och taggar (i grupperingarnas ordning). */
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
    groups: mine.filter((g) => g.kind === "group").map((g) => ({ id: g.id, name: g.name })),
    tags: mine
      .filter((g) => g.kind === "tag")
      .sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "", "sv") || byOrder(a, b))
      .map((g) => ({ id: g.id, category: g.category ?? "", name: g.name })),
  };
}

/** Index: ärende -> id för dess aktiva grupperingar (filtren i listorna). */
export function groupingIdsByCase(members: readonly GroupingMember[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of activeMembers(members)) {
    const s = out.get(m.caseId);
    if (s) s.add(m.groupingId);
    else out.set(m.caseId, new Set([m.groupingId]));
  }
  return out;
}

/** Filtret i listorna: nivå, grupp och tagg (id eller tomt). Alla valda måste stämma. */
export type GroupingFilter = { level?: string | null; group?: string | null; tag?: string | null };
export function matchesGroupingFilter(ids: ReadonlySet<string> | undefined, f: GroupingFilter): boolean {
  for (const want of [f.level, f.group, f.tag]) if (want && !ids?.has(want)) return false;
  return true;
}

// ---------------------------------------------------------------- Ändra ett ärendes nivå, grupper och taggar
/** Det önskade läget: nivån (eller ingen), grupperna och ett värde (eller inget) per taggkategori. */
export type CaseGroupingState = { levelId: string | null; groupIds: readonly string[]; tags: Readonly<Record<string, string | null>> };
export type CaseGroupingPlan = { add: Grouping[]; remove: GroupingMember[] };
export type CaseGroupingError = "unknown" | "archived" | "wrong_kind" | "wrong_category";

/**
 * Vad som ska läggas till och tas bort för att ärendet ska få det önskade läget. Bara avtalets grupperingar; en arkiverad
 * gruppering kan behållas men inte väljas på nytt. Taggkategorier som inte finns med i tags lämnas orörda.
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
  for (const id of new Set(want.groupIds)) {
    const e = check(id, "group");
    if (e) return { ok: false, error: e, groupingId: id };
    wanted.add(id);
  }
  const touchedCategories = new Set(Object.keys(want.tags));
  for (const [category, id] of Object.entries(want.tags)) {
    if (!id) continue;
    const e = check(id, "tag", category);
    if (e) return { ok: false, error: e, groupingId: id };
    wanted.add(id);
  }
  // Det som ska bort: nivån och grupperna styrs helt av läget; taggar bara i de kategorier som finns med.
  const remove = active.filter((m) => {
    if (wanted.has(m.groupingId)) return false;
    const g = byId.get(m.groupingId);
    if (m.kind === "tag") return !!g && touchedCategories.has(g.category ?? "");
    return true;
  });
  const add = [...wanted].filter((id) => !has.has(id)).map((id) => byId.get(id)!);
  // Borttagningar först, så att en ny nivå eller tagg aldrig krockar med den gamla i det unika indexet.
  return { ok: true, plan: { add, remove } };
}

export const CASE_GROUPING_ERROR_TEXT: Record<CaseGroupingError, string> = {
  unknown: "Nivån, gruppen eller taggen finns inte längre. Ladda om sidan.",
  archived: "Nivån, gruppen eller taggen är arkiverad och kan inte väljas.",
  wrong_kind: "Valet passar inte här. Ladda om sidan.",
  wrong_category: "Taggen hör till en annan kategori. Ladda om sidan.",
};
