// Kontrakt för området grupper: yrkesområden, nivåer och taggar (coachmötet 2026-10-09, Karims beslut 3 och 4; Karims beslut
// 2026-10-22) och massanteckningar. Importeras av skärmar – aldrig hanterarna.
//
// Allt här är Miljonbemannings interna arbetsverktyg: en människa placerar deltagaren på en nivå (aldrig AI), och nivån och
// taggarna visas aldrig för kommunen, i rapporter, resultatfilen, exporter eller fakturor och skickas aldrig till AI.
// Grupperna är yrkesområdena (Karims beslut 2026-10-22): deltagarens grupp är ärendets yrkesområde – den härleds, ingen placerar
// den, och fria grupper kan inte skapas eller väljas (felet group). Nivån: exakt en åt gången – den sätts i kartläggningen, höjs
// (grupper.nivaHoj) eller byts (grupper.nivaByt), och tas aldrig bort.
// Massanteckningarna blir vanliga anteckningar (case_notes) – en per ifylld rad – och följer anteckningarnas regler.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import type { Role } from "@/api/roles";
import { AKTIVITETER, CASE_FACTS, INBOX, LOG } from "@/api/invalidation";
import { CASE_NOTE_KINDS, GROUPING_CATEGORY_MAX, GROUPING_DESCRIPTION_MAX, GROUPING_NAME_MAX, type CaseNoteKind, type CaseStatus, type GroupingKind, type LocalDate, type LocalDateTime } from "@/data/schema";
import type { AreaFilterOption, CaseGroupings } from "@/core/groupings";
import type { MonthKey } from "@/core/time";
import { IdSchema, LocalDateSchema } from "../_shared/schemas";

export type { CaseGroupings };

/** Frågorna som visar grupperingar och medlemskap (prefix) – och listorna som filtrerar på dem. Aktiviteterna visar nivåns namn. */
const GROUPING_VIEWS = ["grupper.", "arenden.lista", AKTIVITETER] as const;
/**
 * En ny nivå bjuder in till och tar bort ur kommande aktiviteter för nivån (målgruppen, Karims beslut 2026-10-22): tillfällena
 * (activities) räknas som närvaron gör – samma breda mängd (CASE_FACTS, där aktiviteterna ingår).
 */
const LEVEL_WRITES = [...GROUPING_VIEWS, ...CASE_FACTS, INBOX, "praktik."] as const;

// ---------------------------------------------------------------- Avtalets nivåer, grupper och taggar
export type GroupingOption = { id: string; name: string; description: string; archived: boolean; members: number };
export type TagCategory = { category: string; values: GroupingOption[] };
export type GroupingCatalog = {
  /** Avtalet som visas. Varje avtal har sina egna nivåer, yrkesområden och taggar. */
  contractId: string;
  /** Aktörens avtal (fast ordning) – skärmarna visar ett val när de är fler än ett. */
  contracts: { id: string; name: string }[];
  /** Får byta namn på nivåer och taggar, lägga till och arkivera taggar (samordnare, avtalsansvarig, coach, systemadministratör). */
  canEdit: boolean;
  levels: GroupingOption[];
  /** Yrkesområdena (avtalets aktiva avtalsområden A–L) – grupperna. members: pågående ärenden med yrkesområdet. */
  areas: { code: string; name: string; members: number }[];
  tags: TagCategory[];
  /** Standardnivåerna saknas i avtalet (ett nytt avtal) – kan läggas in med grupper.standard. */
  missingDefaults: boolean;
};
/**
 * Avtalets grupperingar. arkiverade: också arkiverade (administrationsvyn). contractId: ett av aktörens avtal (utan: det
 * första). Antal aktiva medlemmar per gruppering – bara i pågående ärenden (som raderna i Anteckningar).
 */
export const groupingCatalog = query("grupper.katalog", z.object({ arkiverade: z.boolean().optional(), contractId: IdSchema.optional() })).returns<GroupingCatalog | null>();

const Name = z.string().trim().min(1).max(GROUPING_NAME_MAX);
const Description = z.string().trim().max(GROUPING_DESCRIPTION_MAX);

/**
 * Ny tagg (nivåerna är alltid fem – de byter bara namn). Namnen väljer MB själva. Avtalet: ärendets (caseId), annars det valda
 * (contractId) eller aktörens första. Fria grupper finns inte längre (Karims beslut 2026-10-22) – kind group nekas (group).
 */
export const groupingCreate = command("grupper.ny", z.object({
  kind: z.enum(["group", "tag"]),
  caseId: IdSchema.optional(),
  contractId: IdSchema.optional(),
  /** Taggens kategori (befintlig eller ny), t.ex. "Vill arbeta". Krävs för taggar. */
  category: z.string().trim().min(1).max(GROUPING_CATEGORY_MAX).optional(),
  name: Name,
  description: Description.optional(),
}), { invalidates: [...GROUPING_VIEWS, ...LOG] }).returns<Result<{ id: string }, "invalid" | "duplicate" | "no_contract" | "not_found" | "group">>();

/** Byt namn eller beskrivning (nivåer och taggar – en gammal grupp ändras inte, group). */
export const groupingRename = command("grupper.andra", z.object({ id: IdSchema, name: Name, description: Description }), {
  invalidates: [...GROUPING_VIEWS, ...LOG],
}).returns<Result<object, "not_found" | "invalid" | "duplicate" | "group">>();

/** Arkivera en tagg (kan inte väljas för fler deltagare – de som är med ligger kvar) eller återställ. Inget raderas. En gammal grupp återställs aldrig (group). */
export const groupingArchive = command("grupper.arkivera", z.object({ id: IdSchema, archived: z.boolean() }), {
  invalidates: [...GROUPING_VIEWS, ...LOG],
}).returns<Result<object, "not_found" | "level" | "duplicate" | "group">>();

/** Lägg in standardvärdena (fem nivåer, Vill arbeta) i ett avtal som saknar dem (det valda, annars aktörens första). */
export const groupingDefaults = command("grupper.standard", z.object({ contractId: IdSchema.optional() }), { invalidates: [...GROUPING_VIEWS, ...LOG] }).returns<Result<{ added: number }, "no_contract">>();

// ---------------------------------------------------------------- Filtret i coachens listor (Närvaro)
export type GroupingFilterData = {
  levels: { id: string; name: string }[];
  /** Yrkesområdena (avtalens aktiva avtalsområden): koden och "G – Lager och logistik". */
  areas: AreaFilterOption[];
  tags: { id: string; name: string }[];
  /** Ärende -> id för dess aktiva nivå och taggar (bara ärenden rollen ser – policyn/RLS). */
  byCase: Record<string, string[]>;
  /** Ärende -> yrkesområdets kod (cases.primaryAreaCode), för ärenden rollen ser. */
  areaByCase: Record<string, string | null>;
};
/**
 * Filtret Yrkesområde, Nivå och Tagg för listor som inte har det i sin egen fråga (coachens Närvaro). Alla aktörens avtal –
 * med fler än ett står avtalets prefix efter namnet. Null utan avtal.
 */
export const groupingFilterData = query("grupper.filter", z.object({})).returns<GroupingFilterData | null>();

// ---------------------------------------------------------------- Ett ärendes nivå, grupper och taggar
export type CaseGroupingsView = {
  caseId: string;
  /** Dagens datum (raden till coacherna sparas som en anteckning med dagens datum). */
  today: LocalDate;
  canEdit: boolean;
  current: CaseGroupings;
  /** Deltagarens grupp: ärendets yrkesområde ("G – Lager och logistik"), eller null när det saknas. Härleds – väljs inte här. */
  area: string | null;
  /** Nästa nivå (Höj nivå), eller null: ingen nivå än eller redan högsta. */
  nextLevel: { id: string; name: string } | null;
  /** Nivåerna över tid, äldst först ("Nivå 1 från 9 okt (Amira)"). */
  levelHistory: { name: string; from: LocalDateTime; until: LocalDateTime | null; byName: string | null }[];
  /** Valen: aktiva nivåer och taggar och de arkiverade som ärendet redan har (de kan tas bort men inte väljas på nytt). */
  options: { levels: GroupingOption[]; tags: TagCategory[] };
};
/** Nivå, yrkesområde och taggar för ärendet (deltagarkortets huvud, kartläggningens kort). Null utan åtkomst. */
export const caseGroupingsView = query("grupper.arende", z.object({ caseId: IdSchema })).returns<CaseGroupingsView | null>();

/**
 * Sätt ärendets nivå och taggar (hela läget – det som skiljer sig läggs till eller tas bort). Sparas direkt. tags: ett värde (eller
 * null) per taggkategori som ska ändras; kategorier som inte finns med lämnas orörda. En satt nivå tas aldrig bort (level) –
 * den byts. Fria grupper finns inte (groupIds med innehåll nekas: group). En ny nivå bjuder in till nivåns kommande aktiviteter.
 */
export const caseGroupingsSave = command("grupper.arendeSpara", z.object({
  caseId: IdSchema,
  levelId: IdSchema.nullable(),
  groupIds: z.array(IdSchema).max(50).optional(),
  tags: z.record(z.string().max(GROUPING_CATEGORY_MAX), IdSchema.nullable()),
}), { invalidates: [...LEVEL_WRITES, "arenden.kortHistorik"] }).returns<
  Result<
    {
      added: number; removed: number; savedAt: LocalDateTime;
      /** Ny nivå: kommande aktiviteter som deltagaren bjöds in till och togs bort ur. null = nivån ändrades inte. */
      invites: { invited: number; removed: number } | null;
    },
    "not_found" | "forbidden" | "unknown" | "archived" | "wrong_kind" | "wrong_category" | "conflict" | "level" | "group"
  >
>();

/** Svaret när nivån höjts eller bytts. invited/removed: kommande aktiviteter för nivåerna (målgruppen) som deltagaren bjöds in till eller togs bort ur. */
export type LevelChange = { levelId: string; levelName: string; savedAt: LocalDateTime; invited: number; removed: number };
/**
 * Höj nivå: ett klick till nästa nivå (Karims beslut 2026-10-22: "deltagare kan utvecklas och levlas upp till nästa nivå").
 * fromLevelId: nivån skärmen visade – har någon annan ändrat under tiden blir det conflict (inget dubbelt steg). top: redan på
 * högsta nivån. no_level: ingen nivå än (sätts i kartläggningen).
 */
export const caseLevelRaise = command("grupper.nivaHoj", z.object({ caseId: IdSchema, fromLevelId: IdSchema }), { invalidates: [...LEVEL_WRITES, "arenden.kortHistorik"] }).returns<
  Result<LevelChange, "not_found" | "forbidden" | "no_level" | "top" | "conflict">
>();
/** Byt nivå: välj vilken som helst av de fem. fromLevelId: nivån skärmen visade (null = ingen). */
export const caseLevelSet = command("grupper.nivaByt", z.object({ caseId: IdSchema, levelId: IdSchema, fromLevelId: IdSchema.nullable() }), {
  invalidates: [...LEVEL_WRITES, "arenden.kortHistorik"],
}).returns<Result<LevelChange, "not_found" | "forbidden" | "unknown" | "archived" | "wrong_kind" | "conflict" | "same">>();

// ---------------------------------------------------------------- Översikten (/grupper)
export type OverviewMember = { caseId: string; caseNumber: string; name: string; status: CaseStatus };
export type GroupingOverview = {
  contractId: string;
  contracts: { id: string; name: string }[];
  today: LocalDate;
  /** Den här och nästa månad (yrkesområdesträffarna). */
  months: MonthKey[];
  /** Byta namn på nivåer och taggar, nya taggar (GROUPING_WRITERS). */
  canEdit: boolean;
  /** Höja och byta nivå (GROUPING_MEMBER_WRITERS). */
  canPlace: boolean;
  /** Planera en träff (de som skapar aktiviteter). */
  canPlan: boolean;
  /** Öppna sidan Kartläggning (bara coachen) – andra som placerar väljer nivån direkt i raden. */
  canIntake: boolean;
  /** Yrkesområdena: aktiva deltagare (pågående insatser) och månadens träffar (aktiviteter med målgruppen yrkesområdet). */
  areas: {
    code: string;
    name: string;
    /** Pågående insatser (bjuds in till träffarna), pausade och bekräftade som väntar på start – summan är urvalet i Anteckningar. */
    active: number;
    paused: number;
    waiting: number;
    meetings: { month: MonthKey; items: { id: string; name: string; startsAt: LocalDateTime }[] }[];
  }[];
  /** De fem nivåerna med deltagarna (pågående och bekräftade insatser) och nivåns återkommande aktiviteter. */
  levels: (GroupingOption & {
    nextLevel: { id: string; name: string } | null;
    people: OverviewMember[];
    series: { id: string; name: string; schedule: string; nextId: string | null }[];
  })[];
  /** Pågående och bekräftade insatser utan nivå – att kartlägga. */
  unplaced: (OverviewMember & { intake: "none" | "draft" | "approved" })[];
  tags: TagCategory[];
  missingDefaults: boolean;
};
/**
 * Översikten Grupper och nivåer: yrkesområdena med deltagare och månadens träffar, nivåerna med deltagare och återkommande
 * aktiviteter, de som saknar nivå och taggarna. Ett avtal i taget (contractId: ett av aktörens, utan: det första). Null utan avtal.
 */
export const groupingOverview = query("grupper.oversikt", z.object({ contractId: IdSchema.optional() })).returns<GroupingOverview | null>();

// ---------------------------------------------------------------- Massanteckningar (Workbuster-stil)
/**
 * Skriver anteckningar: den som arbetar i ärendet (samma roller som arenden.noteSave). Chef och admin läser bara. Rollen
 * handledare är vilande (Karims beslut 2026-10-09) – rutten /anteckningar tar bort den (routes.ts).
 */
export const MASS_NOTE_ROLES: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare"];
/** Urvalen: mina ärenden, en nivå, ett yrkesområde (gruppen – Karims beslut 2026-10-22) eller en tagg. */
export const MASS_NOTE_SCOPES = ["mina", "niva", "omrade", "tagg"] as const;
export type MassNoteScope = (typeof MASS_NOTE_SCOPES)[number];
export type MassNoteRow = {
  caseId: string;
  caseNumber: string;
  name: string;
  status: CaseStatus;
  /** Nivåns namn (internt). */
  levelName: string | null;
  /** Första dag en anteckning får gälla (beställningen). */
  minDate: LocalDate;
};
export type MassNotePage = {
  today: LocalDate;
  catalog: GroupingCatalog | null;
  rows: MassNoteRow[];
};
/**
 * Deltagarna i urvalet: mina ärenden (huvudcoach eller i teamet), en nivå, ett yrkesområde (id = avtalsområdets kod) eller en
 * tagg. Bara öppna ärenden, ett avtal i taget (contractId: ett av aktörens avtal, utan: det första).
 */
export const massNotePage = query("grupper.anteckningar", z.object({ urval: z.enum(MASS_NOTE_SCOPES), id: IdSchema.optional(), contractId: IdSchema.optional() })).returns<MassNotePage>();

/** Högst så många rader i en sparning. */
export const MASS_NOTE_MAX_ROWS = 200;
/** Skärmens sparnyckel: slumpad när skärmen börjar ett nytt utkast, samma vid varje nytt försök tills sparningen lyckats. */
export const MassNoteSaveKeySchema = z.string().regex(/^[A-Za-z0-9-]{16,64}$/);
/**
 * Spara en anteckning per ifylld rad (vanliga anteckningar i deltagarkortet). Tomma rader skickas inte. Kontrollen är allt
 * eller inget: finns ett fel på någon rad (personnummer, datum, ärende) sparas ingenting och felen visas vid raderna
 * (fields: caseId -> text). Sparningen är idempotent: varje rad får ett id ur sparnyckeln (saveKey) och ärendet, så ett nytt
 * försök efter ett avbrott mitt i sparningen (nätverk, timeout) sparar bara det som saknas – aldrig dubbletter.
 */
export const massNoteSave = command("grupper.anteckningarSpara", z.object({
  saveKey: MassNoteSaveKeySchema,
  kind: z.enum(CASE_NOTE_KINDS),
  rows: z.array(z.object({ caseId: IdSchema, occurredOn: LocalDateSchema, body: z.string().trim().min(1).max(2000) })).min(1).max(MASS_NOTE_MAX_ROWS),
}), { invalidates: ["arenden.kortTidslinje", "arenden.kortManad", "arenden.kortHistorik", "coach.assessmentPage", "aktiviteter.visa", ...LOG] }).returns<
  Result<{ saved: number }, "rows">
>();

export type { CaseNoteKind, GroupingKind };
