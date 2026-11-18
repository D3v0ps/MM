// Kontrakt för området delmål: delmål för progressionerna (Karims beslut 2026-11-11, SPEC §7.7 och §7.17). Importeras av skärmar
// – aldrig hanterarna.
//
// Katalogen per avtal (progress_goals): avtalsansvarig och systemadministratören lägger till, byter namn, ordnar, inaktiverar och
// väljer punkterna i steg 1–2. Ett delmål tas aldrig bort.
// Läget per ärende (case_progress_goals): Inte påbörjat, Tränar (satt automatiskt när närvaro registreras på ett tillfälle som
// tränar delmålet) och Uppnått (bara en människa – coach, samordnare, avtalsansvarig – aldrig AI). Ångra: tillbaka till Tränar
// eller Inte påbörjat. Allt loggas med id:n.
// Internt: kommunen och ekonomen ser aldrig delmålen. Inga frågor här når kommunen.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import type { Role } from "@/api/roles";
import { AKTIVITETER, BILLING, BONUS, CARD, DELMAL, LOG, MANADSRAPPORT, NAV, PORTAL } from "@/api/invalidation";
import type { LocalDate } from "@/core/time";
import { PROGRESS_EVIDENCE_KINDS, PROGRESS_GOAL_LABEL_MAX, STEP_ITEMS, type ProgressEvidenceKind, type ProgressGoalSource, type StepItem } from "@/data/schema";
import { IdSchema, LocalDateSchema } from "../_shared/schemas";

/** Läser och skriver katalogen (sidan Delmål): avtalsansvarig och systemadministratören (policyn progress_goals). */
export const CATALOG_ROLES: readonly Role[] = ["avtalsansvarig", "admin"];
/** Sätter Uppnått och Ångra: de som arbetar i ärendena med full åtkomst (coach, samordnare, avtalsansvarig). */
export const GOAL_SETTERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach"];
/** Läser delmålen på deltagarkortet: Miljonbemanning utom ekonomen (chef och systemadministratör i läsläge). Rollen handledare vilande. */
export const GOAL_READERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin"];

// ---------------------------------------------------------------- Valet "Tränar delmål" (formulären för tillfällen)
/** Ett progressionsområde med sina delmål – valet i formulären för gruppaktiviteter, återkommande aktiviteter och egna tillfällen. */
export type GoalPickerArea = { key: string; label: string; goals: { id: string; label: string; active: boolean }[] };
/**
 * Avtalets delmål för valet "Tränar delmål": områdena i avtalets ordning, aktiva delmål och de inaktiverade (de visas bara när de
 * redan står på tillfället). caseId: ärendets avtal; contractId: avtalet; utan båda: aktörens första avtal.
 */
export const goalPicker = query("delmal.val", z.object({ caseId: IdSchema.optional(), contractId: IdSchema.optional() })).returns<GoalPickerArea[]>();
/** Delmålen som ett tillfälle tränar (högst 20). */
export const GoalIdsSchema = z.array(IdSchema).max(20);

// ---------------------------------------------------------------- Katalogen (avtalsansvarig och systemadministratören)
export type CatalogGoal = {
  id: string;
  label: string;
  active: boolean;
  stepItems: StepItem[];
};
export type GoalCatalogView = {
  contractId: string;
  /** Aktörens avtal (fast ordning) – sidan visar ett val när de är fler än ett. */
  contracts: { id: string; name: string }[];
  canEdit: boolean;
  /** Avtalets progressionsområden med delmålen, i områdets ordning. */
  areas: { key: string; label: string; goals: CatalogGoal[] }[];
  /** Punkterna i steg 1–2 i modellens ordning. */
  stepItems: { key: StepItem; label: string; step: 1 | 2 }[];
};
export const goalCatalog = query("delmal.katalog", z.object({ contractId: IdSchema.optional() })).returns<GoalCatalogView | null>();

const Label = z.string().trim().min(1, "Skriv delmålet.").max(PROGRESS_GOAL_LABEL_MAX);
const StepItemsSchema = z.array(z.enum(STEP_ITEMS)).max(STEP_ITEMS.length);
/** Katalogen visas i valen för tillfällena, på deltagarkortet, i månadsbedömningen och i Progression och resultat. */
const CATALOG_WRITES = [DELMAL, AKTIVITETER, BONUS, "coach.assessmentPage", MANADSRAPPORT, ...LOG] as const;

/** Nytt delmål sist i området. duplicate: ett delmål med samma namn finns redan i området. */
export const goalCreate = command("delmal.ny", z.object({ contractId: IdSchema, areaKey: z.string().min(1).max(60), label: Label, stepItems: StepItemsSchema }), {
  invalidates: CATALOG_WRITES,
}).returns<Result<{ id: string }, "not_found" | "area" | "invalid" | "duplicate">>();
/** Byt namn och punkter i steg 1–2. */
export const goalUpdate = command("delmal.andra", z.object({ id: IdSchema, label: Label, stepItems: StepItemsSchema }), { invalidates: CATALOG_WRITES })
  .returns<Result<{ changed: boolean }, "not_found" | "invalid" | "duplicate">>();
/** Flytta upp eller ned inom området. */
export const goalMove = command("delmal.flytta", z.object({ id: IdSchema, direction: z.enum(["up", "down"]) }), { invalidates: CATALOG_WRITES })
  .returns<Result<{ moved: boolean }, "not_found">>();
/** Inaktivera (kan inte väljas igen – det som redan står ligger kvar) eller aktivera igen. Inget tas bort. */
export const goalSetActive = command("delmal.aktiv", z.object({ id: IdSchema, active: z.boolean() }), { invalidates: CATALOG_WRITES })
  .returns<Result<{ changed: boolean }, "not_found" | "duplicate">>();

// ---------------------------------------------------------------- Deltagarkortet: delmålen i ärendet
export type CaseGoalRowView = {
  goalId: string;
  label: string;
  state: "none" | "training" | "achieved";
  /** "Inte påbörjat", "Tränar (automatiskt)", "Tränar" eller "Uppnått 12 jan 2027". */
  stateText: string;
  icon: "circle" | "activity" | "check-circle";
  source: ProgressGoalSource | null;
  achievedOn: LocalDate | null;
  /** Underlaget som valdes vid Uppnått: "Mötesrapport 15 jan" (null = inget underlag). */
  evidenceLabel: string | null;
  /** Inaktiverat i katalogen (visas bara när ärendet har ett läge för det). */
  inactive: boolean;
};
export type CaseGoalsView =
  | { on: false }
  | {
      on: true;
      caseId: string;
      caseNumber: string;
      /** Sätter Uppnått och Ångra: den som arbetar i ärendet med full åtkomst, och insatsen har startat. */
      canEdit: boolean;
      today: LocalDate;
      /** Tidigaste dag för Uppnått: insatsens startdatum. */
      minDate: LocalDate | null;
      areas: { key: string; label: string; goals: CaseGoalRowView[] }[];
    };
export const caseGoals = query("delmal.arende", z.object({ caseId: IdSchema })).returns<CaseGoalsView>();
/**
 * Underlag att välja vid Uppnått: ärendets senaste passerade tillfällen, mötesrapporter och anteckningar (nyast först) – value är
 * "activity:<id>", "check_in:<id>" eller "case_note:<id>". Hämtas utan cache när dialogen öppnas. Bara den som får markera.
 */
export const goalEvidence = query("delmal.underlag", z.object({ caseId: IdSchema })).returns<{ value: string; label: string }[]>();

/** Omräkning efter Uppnått och Ångra: delmålen, Progression och resultat (punkterna och ett nytt förslag), månadsbedömningen och loggen. */
const CASE_GOAL_WRITES = [DELMAL, BONUS, CARD, "coach.minVecka", "coach.assessmentPage", PORTAL, BILLING, "inkorg.start", NAV, MANADSRAPPORT, ...LOG] as const;
export const EvidenceSchema = z.object({ kind: z.enum(PROGRESS_EVIDENCE_KINDS), id: IdSchema });
export type EvidenceInput = { kind: ProgressEvidenceKind; id: string };

/**
 * Markera uppnått (bara en människa – aldrig AI): dagen (i dag eller tidigare, inte före start) och frivilligt underlag i ärendet.
 * Ett delmål som räknas mot steg 1–2 kan ge ett förslag om Progression och resultat (reglerna i src/core/bonus.ts).
 */
export const goalAchieve = command("delmal.uppnatt", z.object({ caseId: IdSchema, goalId: IdSchema, achievedOn: LocalDateSchema, evidence: EvidenceSchema.nullable() }), {
  invalidates: CASE_GOAL_WRITES,
}).returns<Result<{ suggested: number }, "not_found" | "forbidden" | "wrong_status" | "date" | "inactive" | "evidence" | "already">>();

/** Ångra Uppnått: tillbaka till Tränar eller till Inte påbörjat (läget tas bort). */
export const goalUndo = command("delmal.angra", z.object({ caseId: IdSchema, goalId: IdSchema, to: z.enum(["training", "none"]) }), { invalidates: CASE_GOAL_WRITES })
  .returns<Result<object, "not_found" | "forbidden" | "not_achieved">>();
