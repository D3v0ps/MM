// Kontrakt för området grupper: nivåer, grupper och taggar (coachmötet 2026-10-09, Karims beslut 3 och 4) och
// massanteckningar. Importeras av skärmar – aldrig hanterarna.
//
// Allt här är Miljonbemannings interna arbetsverktyg: en människa placerar deltagaren (aldrig AI), och nivån, grupperna
// och taggarna visas aldrig för kommunen, i rapporter, resultatfilen, exporter eller fakturor och skickas aldrig till AI.
// Massanteckningarna blir vanliga anteckningar (case_notes) – en per ifylld rad – och följer anteckningarnas regler.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import type { Role } from "@/api/roles";
import { LOG } from "@/api/invalidation";
import { CASE_NOTE_KINDS, GROUPING_CATEGORY_MAX, GROUPING_DESCRIPTION_MAX, GROUPING_NAME_MAX, type CaseNoteKind, type CaseStatus, type GroupingKind, type LocalDate, type LocalDateTime } from "@/data/schema";
import type { CaseGroupings } from "@/core/groupings";
import { IdSchema, LocalDateSchema } from "../_shared/schemas";

export type { CaseGroupings };

/** Frågorna som visar grupperingar och medlemskap (prefix) – och listorna som filtrerar på dem. */
const GROUPING_VIEWS = ["grupper.", "arenden.lista"] as const;

// ---------------------------------------------------------------- Avtalets nivåer, grupper och taggar
export type GroupingOption = { id: string; name: string; description: string; archived: boolean; members: number };
export type TagCategory = { category: string; values: GroupingOption[] };
export type GroupingCatalog = {
  contractId: string;
  /** Får skapa, byta namn på och arkivera (samordnare, avtalsansvarig, coach, systemadministratör). */
  canEdit: boolean;
  levels: GroupingOption[];
  groups: GroupingOption[];
  tags: TagCategory[];
  /** Standardnivåerna saknas i avtalet (ett nytt avtal) – kan läggas in med grupper.standard. */
  missingDefaults: boolean;
};
/** Avtalets grupperingar. arkiverade: också arkiverade (administrationsvyn). Antal aktiva medlemmar per gruppering. */
export const groupingCatalog = query("grupper.katalog", z.object({ arkiverade: z.boolean().optional() })).returns<GroupingCatalog | null>();

const Name = z.string().trim().min(1).max(GROUPING_NAME_MAX);
const Description = z.string().trim().max(GROUPING_DESCRIPTION_MAX);

/** Ny grupp eller tagg (nivåerna är alltid fem – de byter bara namn). Namnen väljer MB själva. */
export const groupingCreate = command("grupper.ny", z.object({
  kind: z.enum(["group", "tag"]),
  /** Taggens kategori (befintlig eller ny), t.ex. "Vill arbeta". Krävs för taggar. */
  category: z.string().trim().min(1).max(GROUPING_CATEGORY_MAX).optional(),
  name: Name,
  description: Description.optional(),
}), { invalidates: [...GROUPING_VIEWS, ...LOG] }).returns<Result<{ id: string }, "invalid" | "duplicate" | "no_contract">>();

/** Byt namn eller beskrivning. */
export const groupingRename = command("grupper.andra", z.object({ id: IdSchema, name: Name, description: Description }), {
  invalidates: [...GROUPING_VIEWS, ...LOG],
}).returns<Result<object, "not_found" | "invalid" | "duplicate">>();

/** Arkivera (kan inte väljas för fler deltagare – de som är med ligger kvar) eller återställ. Inget raderas. */
export const groupingArchive = command("grupper.arkivera", z.object({ id: IdSchema, archived: z.boolean() }), {
  invalidates: [...GROUPING_VIEWS, ...LOG],
}).returns<Result<object, "not_found" | "level" | "duplicate">>();

/** Lägg in standardvärdena (fem nivåer, Vill arbeta) i ett avtal som saknar dem. */
export const groupingDefaults = command("grupper.standard", z.object({}), { invalidates: [...GROUPING_VIEWS, ...LOG] }).returns<Result<{ added: number }, "no_contract">>();

// ---------------------------------------------------------------- Ett ärendes nivå, grupper och taggar
export type CaseGroupingsView = {
  caseId: string;
  /** Dagens datum (raden till coacherna sparas som en anteckning med dagens datum). */
  today: LocalDate;
  canEdit: boolean;
  current: CaseGroupings;
  /** Valen: aktiva grupperingar och de arkiverade som ärendet redan har (de kan tas bort men inte väljas på nytt). */
  options: { levels: GroupingOption[]; groups: GroupingOption[]; tags: TagCategory[] };
};
/** Nivå, grupper och taggar för ärendet (deltagarkortets huvud, kartläggningens kort). Null utan åtkomst. */
export const caseGroupingsView = query("grupper.arende", z.object({ caseId: IdSchema })).returns<CaseGroupingsView | null>();

/**
 * Sätt ärendets nivå, grupper och taggar (hela läget – det som skiljer sig läggs till eller tas bort). Sparas direkt.
 * tags: ett värde (eller null) per taggkategori som ska ändras; kategorier som inte finns med lämnas orörda.
 */
export const caseGroupingsSave = command("grupper.arendeSpara", z.object({
  caseId: IdSchema,
  levelId: IdSchema.nullable(),
  groupIds: z.array(IdSchema).max(50),
  tags: z.record(z.string().max(GROUPING_CATEGORY_MAX), IdSchema.nullable()),
}), { invalidates: [...GROUPING_VIEWS, "arenden.kortHistorik", ...LOG] }).returns<
  Result<{ added: number; removed: number; savedAt: LocalDateTime }, "not_found" | "forbidden" | "unknown" | "archived" | "wrong_kind" | "wrong_category" | "conflict">
>();

// ---------------------------------------------------------------- Massanteckningar (Workbuster-stil)
/** Skriver anteckningar: den som arbetar i ärendet (samma roller som arenden.noteSave). Chef och admin läser bara. */
export const MASS_NOTE_ROLES: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare"];
export const MASS_NOTE_SCOPES = ["mina", "niva", "grupp", "tagg"] as const;
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
/** Deltagarna i urvalet: mina ärenden (huvudcoach eller i teamet), en nivå, en grupp eller en tagg. Bara öppna ärenden. */
export const massNotePage = query("grupper.anteckningar", z.object({ urval: z.enum(MASS_NOTE_SCOPES), id: IdSchema.optional() })).returns<MassNotePage>();

/** Högst så många rader i en sparning. */
export const MASS_NOTE_MAX_ROWS = 200;
/**
 * Spara en anteckning per ifylld rad (vanliga anteckningar i deltagarkortet). Tomma rader skickas inte. Allt eller inget:
 * finns ett fel på någon rad (personnummer, datum, ärende) sparas ingenting och felen visas vid raderna (fields: caseId -> text).
 */
export const massNoteSave = command("grupper.anteckningarSpara", z.object({
  kind: z.enum(CASE_NOTE_KINDS),
  rows: z.array(z.object({ caseId: IdSchema, occurredOn: LocalDateSchema, body: z.string().trim().min(1).max(2000) })).min(1).max(MASS_NOTE_MAX_ROWS),
}), { invalidates: ["arenden.kortTidslinje", "arenden.kortManad", "arenden.kortHistorik", "coach.assessmentPage", ...LOG] }).returns<
  Result<{ saved: number }, "rows">
>();

export type { CaseNoteKind, GroupingKind };
