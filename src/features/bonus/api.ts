// Kontrakt för området bonus (SPEC §7.17, beslut 2026-11-04 – incitamentsmodellen med bonussteg 1–5). Importeras av skärmar –
// aldrig hanterarna. Inga belopp i något svar här: coachen och kommunen ser aldrig belopp (beslut 2026-10-07). Bonusfakturan och
// beloppen finns bara hos ekonomen (ekonomi.bonus i src/features/ekonomi/api.ts). Inga dokument: kommunen läser bara
// redovisningsunderlaget (bonus_claims.snapshot) – intygen skickas på annat sätt.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import { BILLING, BONUS, CARD, LOG, NAV, PORTAL } from "@/api/invalidation";
import type { LocalDate, LocalDateTime, MonthKey } from "@/core/time";
import { BONUS_CHECKLIST_ITEMS, type BonusClaimStatus, type BonusDecisionVia, type BonusSource } from "@/data/schema";
import { IdSchema, LocalDateSchema } from "../_shared/schemas";

/** Läget med ikon i klarspråk (status visas alltid som text och ikon). */
export type BonusStatusIcon = "circle" | "help" | "send" | "check-circle" | "x-circle" | "minus-circle";

/**
 * Redovisningsunderlaget (v1): det som fryses i bonus_claims.snapshot när anspråket skickas till kommunen och som kommunen läser
 * som PDF. Byggs bara av godkända uppgifter (src/features/bonus/underlag.ts). Aldrig belopp, nivå, taggar, gruppaktiviteter,
 * gruppmål, anteckningar, personnummer eller deltagarens namn (namnet slås upp när kommunen visar underlaget – ekonomen läser
 * raden och ser aldrig namn).
 */
export type BonusUnderlag = {
  v: 1;
  claimId: string;
  caseNumber: string;
  contractNumber: string;
  customerName: string;
  step: number;
  stepLabel: string;
  /** Vad steget innebär enligt modellen (talen ur avtalskonfigurationen). */
  rule: string;
  /** När underlaget frystes (skickades) – i förhandsvisningen nu. */
  createdAt: LocalDateTime;
  sentByName: string | null;
  coachName: string | null;
  period: { start: LocalDate | null; end: LocalDate | null; plannedEnd: LocalDate | null; ongoing: boolean };
  /** Yrkesområdet ("G Lager och logistik") och yrkesspåret. */
  area: string;
  track: string | null;
  /** Målen ur den senaste godkända planen (mål 1 och 2). Tom = framgår inte. */
  goals: string[];
  attendance: { percent: number | null; planned: number; registered: number; attended: number; from: LocalDate | null; to: LocalDate | null; minPercent: number };
  /** Deltagarens egna tillfällen per typ under insatsen (inga gruppaktiviteter). */
  activities: { label: string; count: number }[];
  /** Progression före och efter: första och senaste godkända månadsbedömningen. */
  progression: {
    first: { month: MonthKey; overall: string | null };
    latest: { month: MonthKey; overall: string | null };
    rows: { label: string; first: number | null; latest: number | null }[];
    scale: string;
  } | null;
  reachedOn: LocalDate | null;
  event: { label: string; date: LocalDate } | null;
  /** Steg 5: senaste dag för steg 3 (start + veckor). */
  speed: { deadline: LocalDate; weeks: number } | null;
  /** Steg 4: steg 3:s resultatdatum och hur länge resultatet ska kvarstå. */
  sustain: { since: LocalDate; until: LocalDate; months: number } | null;
  verification: { kind: string; on: LocalDate | null } | null;
  /** Arbetsgivaren eller skolan och kontaktpersonen där. */
  actor: { name: string; contactName: string | null; phone: string | null; email: string | null } | null;
  /** Steg 1: coachens avbockning med var underlaget finns. */
  checklist: { label: string; where: string }[];
  comment: string;
};

// ---------------------------------------------------------------- Deltagarkortet: kortet Bonus
export type BonusStepRow = {
  step: number;
  label: string;
  status: BonusClaimStatus | "none";
  statusText: string;
  icon: BonusStatusIcon;
  /** Anspråket som räknas (eller det senaste avslagna eller återtagna), null = inget. */
  claimId: string | null;
  source: BonusSource | null;
  reachedOn: LocalDate | null;
  submittedAt: LocalDateTime | null;
  decidedAt: LocalDateTime | null;
  /** Coachen kan skapa ett nytt anspråk för steget. createProblem = varför inte. */
  canCreate: boolean;
  createProblem: string | null;
  /** Tidigare avslagna och återtagna anspråk för steget, nyast först. */
  history: { claimId: string; status: BonusClaimStatus; statusText: string; at: LocalDateTime | null }[];
};
/**
 * Kortet Bonus på deltagarkortet (Händelser och utfall). on false = bonus är avstängd i avtalet, eller aktören får inte se bonus
 * (teamet, begränsade testare – bonus är ett ekonomiskt villkor). Inga belopp.
 */
export type BonusCardView =
  | { on: false }
  | { on: true; caseId: string; caseNumber: string; canAct: boolean; steps: BonusStepRow[]; rules: string[] };
export const bonusCard = query("bonus.kort", z.object({ caseId: IdSchema })).returns<BonusCardView>();

// ---------------------------------------------------------------- Granska och skicka (coachen)
export type BonusChecklistRow = { item: (typeof BONUS_CHECKLIST_ITEMS)[number]; label: string; done: boolean; where: string };
export type BonusDecisionView = { decision: "approved" | "rejected"; at: LocalDateTime; byName: string; via: BonusDecisionVia; note: string | null };
export type BonusReviewView = {
  claimId: string;
  caseId: string;
  caseNumber: string;
  participantName: string;
  step: number;
  label: string;
  status: BonusClaimStatus;
  statusText: string;
  icon: BonusStatusIcon;
  source: BonusSource | null;
  /** Den som arbetar i ärendet granskar och skickar ett förslag. */
  canAct: boolean;
  canWithdraw: boolean;
  /** Samordnare och avtalsansvarig registrerar ett beslut som kommunen skickade med mejl. */
  canRecordMail: boolean;
  rule: string;
  fields: { basis: string; reachedOn: LocalDate | null; verificationKind: string | null; verificationOn: LocalDate | null; checklist: BonusChecklistRow[] };
  /** Steg 1: checklistan. Steg 2–5: verifieringens typ och datum. */
  needsChecklist: boolean;
  needsVerification: boolean;
  facts: {
    start: LocalDate | null;
    end: LocalDate | null;
    attendancePercent: number | null;
    attendanceMeets: boolean;
    minPercent: number;
    approvedAssessments: number;
    event: { label: string; date: LocalDate; actor: string; verificationKind: string | null } | null;
    step3: { status: BonusClaimStatus; statusText: string; reachedOn: LocalDate | null } | null;
    sustainDue: LocalDate | null;
    speedDeadline: LocalDate | null;
    windowEnd: LocalDate | null;
  };
  /** Det som saknas innan anspråket kan skickas (med de sparade fälten). */
  problems: string[];
  /** Underlaget som kommunen får (förhandsvisning – eller det frysta efter att det skickats). */
  underlag: BonusUnderlag;
  submitted: { at: LocalDateTime; byName: string } | null;
  withdrawn: { at: LocalDateTime; byName: string } | null;
  decision: BonusDecisionView | null;
  /** Steg 4 och 5: beslut om bonussteg 3 behövs innan kommunen kan godkänna. */
  waitingForStep3: boolean;
};
export const bonusReview = query("bonus.granska", z.object({ claimId: IdSchema })).returns<BonusReviewView | null>();

// ---------------------------------------------------------------- Kommunens beslut (portalen)
export type BonusPortalView = {
  claimId: string;
  caseId: string;
  caseNumber: string;
  participantName: string;
  step: number;
  label: string;
  status: BonusClaimStatus;
  statusText: string;
  icon: BonusStatusIcon;
  sentAt: LocalDateTime | null;
  underlag: BonusUnderlag;
  /** Handläggaren kan besluta: anspråket är skickat och obeslutat (och steg 3 är godkänt för steg 4 och 5). */
  canDecide: boolean;
  waitingForStep3: boolean;
  decision: BonusDecisionView | null;
};
export const bonusPortal = query("bonus.portal", z.object({ claimId: IdSchema })).returns<BonusPortalView | null>();

// ---------------------------------------------------------------- Kommandon
/** Omräkning efter ett kommando som skriver bonusanspråk: bonus, kortet, coachens Min vecka, portalen, ekonomin och räknarna. */
const AFTER = [BONUS, CARD, "coach.minVecka", PORTAL, BILLING, "inkorg.start", NAV, ...LOG] as const;
const StepSchema = z.number().int().min(1).max(5);
const ChecklistSchema = z.partialRecord(z.enum(BONUS_CHECKLIST_ITEMS), z.object({ done: z.boolean(), where: z.string().max(200) }).strict());
const FieldsSchema = {
  basis: z.string().max(500),
  reachedOn: LocalDateSchema.nullable(),
  verificationKind: z.string().max(200).nullable(),
  verificationOn: LocalDateSchema.nullable(),
  checklist: ChecklistSchema,
};

/** Coachen skapar ett anspråk för ett bonussteg (förslag att granska, källa manual). Steg 4 och 5 bygger på bonussteg 3. */
export const bonusCreate = command("bonus.skapa", z.object({ caseId: IdSchema, step: StepSchema }), { invalidates: [...AFTER] })
  .returns<Result<{ claimId: string }, "not_found" | "off" | "exists">>();

/** Spara fälten i ett förslag (kommentar, resultatdatum, verifiering, checklista). Personnummer stoppas. */
export const bonusSave = command("bonus.spara", z.object({ claimId: IdSchema, ...FieldsSchema }), { invalidates: [...AFTER] })
  .returns<Result<{ problems: string[] }, "not_found" | "locked" | "pnr">>();

/**
 * Skicka anspråket till kommunen: fälten sparas, redovisningsunderlaget byggs av godkända uppgifter och fryses, och den
 * beställande handläggaren får ett mejl med bara ärendenumret och en länk till portalen.
 */
export const bonusSubmit = command("bonus.skicka", z.object({ claimId: IdSchema, ...FieldsSchema }), { invalidates: [...AFTER] })
  .returns<Result<object, "not_found" | "locked" | "pnr" | "problems">>();

/** Återta ett förslag eller ett skickat anspråk som kommunen inte har beslutat om. Steg 4 och 5 som bygger på steg 3 följer med. */
export const bonusWithdraw = command("bonus.aterta", z.object({ claimId: IdSchema }), { invalidates: [...AFTER] })
  .returns<Result<{ withdrawn: number }, "not_found" | "locked">>();

/** Kommunens handläggare beslutar i portalen: godkänn eller avslå, med frivillig motivering. */
export const bonusDecide = command("bonus.besluta", z.object({ claimId: IdSchema, decision: z.enum(["approved", "rejected"]), note: z.string().max(1000).optional() }), {
  invalidates: [...AFTER, "notiser.", "inkorg.confirmation"],
}).returns<Result<object, "not_found" | "decided" | "needs_step3" | "pnr">>();

/**
 * Samordnaren eller avtalsansvarig registrerar ett beslut som kommunen skickade med mejl (mejl är kommunens formella kanal,
 * CLAUDE.md punkt 10). Motiveringen krävs – kommunens motivering eller en hänvisning till mejlet.
 */
export const bonusRecordMail = command("bonus.registreraMejl", z.object({ claimId: IdSchema, decision: z.enum(["approved", "rejected"]), note: z.string().trim().min(3).max(1000) }), {
  invalidates: [...AFTER, "notiser.", "inkorg.confirmation"],
}).returns<Result<object, "not_found" | "decided" | "needs_step3" | "pnr">>();

/**
 * Redovisningsunderlaget visas eller laddas ned (tyst): visningen loggas (bonus_claim.underlag_viewed / _downloaded) och svaret
 * har filnamnet (bara ärendenummer och steg) och underlaget med deltagarens namn för PDF:en, som byggs i webbläsaren.
 */
export const bonusUnderlag = command("bonus.underlag", z.object({ claimId: IdSchema, purpose: z.enum(["view", "download"]) }), { invalidates: "none" })
  .returns<Result<{ filename: string; underlag: BonusUnderlag; participantName: string }, "not_found">>();
