// Kontrakt för området ledning (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
// Skärmar: ledningsvyn (/ledning, prototypens chef.oversikt) och registret över avtalsavvikelser (/avtalsavvikelser/:id?,
// prototypens chef.avvikelser). Källa: prototyp/src/views/ledning.js.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import type { KpiStatus, ResultForecast, ResultStatus } from "@/core/kpi";
import type { SlaStatus } from "@/core/sla";
import type {
  AlertKind, AlertSeverity, ContractDeviationLevel, ContractDeviationSource, ContractDeviationStatus, ContractDeviationType, PenaltyKind, PulsePriority,
} from "@/data/schema";
import { IdSchema, LocalDateSchema, MonthKeySchema } from "../_shared/schemas";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

/**
 * Kvittera en flagga med en kort åtgärdsplan (prototypens alert.ack). key = flaggans stabila nyckel, t.ex.
 * "stuck:case-260143:3". Planen sparas i revisionsloggen. En ny kvittering ersätter den tidigare.
 */
export const alertAck = command("ledning.alertAck", z.object({
  key: z.string().min(1).max(200),
  plan: z.string().trim().min(1).max(2000),
})).returns<Result<object>>();

// ================================================================ Ledningsvyn (/ledning)
//
// Frågor (bara chef/controller):
//   ledning.head      -> LedningHead      sidhuvud och antal flaggor (räknaren på fliken Resultat och KPI:er)
//   ledning.overview  -> LedningOverview  fliken Resultat och KPI:er
//   ledning.coaches   -> LedningCoaches   fliken Per coach
//   ledning.areas     -> LedningAreas     fliken Per avtalsområde
//   ledning.pulse     -> LedningPulse     fliken Deltagarnas röst (aggregat först från minsta antal svar)

/** Flikarna i ledningsvyn (?flik=). */
export const LEDNING_TABS = ["kpi", "coacher", "omraden", "puls"] as const;
export type LedningTab = (typeof LEDNING_TABS)[number];

/** Resultatgrad utan interna detaljer som skärmen inte behöver. */
export type RateView = { value: number | null; num: number; den: number; prelim: number; excluded: number; status: ResultStatus; minN: number };

/** Resultatgradens mål från avtalskonfigurationen (kpis[resultatgrad]). Aldrig hårdkodat. internal = null för begränsade testare. */
export type ResultTargets = { contract: number | null; internal: number | null; minN: number };

/** En flagga som ledningen ser. link = bara om rollen kan öppna sidan (och det inte är ledningsvyn själv). */
export type AlertView = {
  key: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  text: string;
  createdAt: string;
  ack: { byName: string; at: string; plan: string } | null;
  link: { href: string; label: string } | null;
};

export type LedningHead = { customerName: string; contractNumber: string; alertCount: number };
export const ledningHead = query("ledning.head", z.object({})).returns<LedningHead>();

export type TrendRow = { month: string; value: number | null; num: number; den: number; excluded: number; cumulative: number | null; cumulativeN: number };

export type KpiRow = {
  key: string;
  label: string;
  value: number | null;
  num: number;
  den: number;
  /** Miljonbemannings interna mål. null när det inte är fastställt – och alltid för begränsade testare (src/api/tester-access.ts). */
  target: number | null;
  targetUnset: boolean;
  contractTarget: number | null;
  /** target_hidden = begränsad testare: KPI:n har bara ett internt mål, som inte visas. */
  status: KpiStatus | "target_hidden";
  provisional: boolean;
};

export type EarlyCase = {
  caseId: string;
  caseNumber: string;
  /** Namn enligt behörigheten (skyddade: "Skyddade personuppgifter"). */
  name: string;
  streak: number;
  weeks: { key: string; label: string; reason: string }[];
  /** Flaggan att kvittera (nyckel, rubrik och text till kvitteringsdialogen). */
  alert: Pick<AlertView, "key" | "kind" | "title" | "text">;
  ack: { byName: string; at: string; plan: string } | null;
};
export type EarlyCoach = { coachId: string; coachName: string; reminders: number; cases: EarlyCase[] };

export type CustomerCard = {
  /** Senast levererade beställarrapporten till kommunens chef. */
  latest: { id: string; month: string; deliveredAt: string } | null;
  /** Rullande resultatgrad i den rapporten (utan internt mål). */
  rolling: { value: number | null; num: number; den: number; minN: number } | null;
  contractTarget: number | null;
  /** Närmast följande rapport som inte är levererad (utkast). */
  next: { id: string; month: string } | null;
  nextRolling: { value: number | null; num: number; den: number } | null;
  correctionPending: boolean;
  /** Minsta gruppstorlek i kundens rapporter ("färre än 5"). */
  smallGroupN: number;
  canOpenReport: boolean;
};

export type LedningOverview = {
  contractStart: string;
  lastMonth: string;
  targets: ResultTargets;
  rolling: RateView;
  sinceStart: RateView;
  forecast: ResultForecast;
  trend: TrendRow[];
  /** Resultatdefinitionen är ATT_FASTSTÄLLA (öppen fråga 6). */
  resultDefinitionUnset: boolean;
  prototypeDefinition: string | null;
  /** Alla okvitterade flaggor för chef/controller (antal, kritiska). */
  alertCount: number;
  criticalCount: number;
  /** Flaggor att kvittera i kortet (utan eskaleringarna – de visas under Tidig uppmärksamhet). Resultatflaggan först. */
  flagAlerts: AlertView[];
  acked: AlertView[];
  rrAlert: AlertView | null;
  rrAckAt: string | null;
  escalateAfterWeeks: number;
  escalatedCount: number;
  early: EarlyCoach[];
  sla: { rows: KpiRow[]; targetText: string; overdueCount: number; canOpenDeadlines: boolean; seesSlaStats: boolean };
  /**
   * Ofakturerade veckor ur fakturaunderlaget. Saknas helt för begränsade testare i testmiljön (src/api/tester-access.ts) –
   * skärmen visar "Visas inte för testare".
   */
  unbilled?: { totalOre: number; weeks: number; cases: { caseId: string; caseNumber: string }[]; oldestDays: number | null; warningDays: number; canOpenBilling: boolean };
  cds: {
    open: number;
    warnings: number;
    warningsBeforeTermination: number;
    openPlans: { id: string; description: string; actionPlanDue: string | null; dueAt: string | null; sla: Pick<SlaStatus, "label" | "tone"> | null }[];
  };
  kpis: KpiRow[];
  customer: CustomerCard;
};
export const ledningOverview = query("ledning.overview", z.object({})).returns<LedningOverview>();

export type CoachRow = {
  id: string;
  name: string;
  active: number;
  rr: RateView;
  att: number;
  reg: number;
  attRate: number | null;
  wk: number;
  wkOk: number;
  ciRate: number | null;
  docMedian: number | null;
  docN: number;
  reminders: number;
  escalated: number;
};
export type LedningCoaches = {
  lastMonth: string;
  targets: ResultTargets;
  /**
   * Internt mål för dokumentationstid (SPEC §2 – Miljonbemannings eget mål, inte avtalsvärde). Saknas för begränsade testare
   * i testmiljön (src/api/tester-access.ts) – skärmen visar "Visas inte för testare" och ingen Bevaka-flagga.
   */
  docGoalMinutes?: number;
  escalateAfterWeeks: number;
  rows: CoachRow[];
  total: { active: number; reminders: number; escalated: number; att: number; reg: number; wk: number; wkOk: number };
  allDoc: number | null;
  all: RateView;
};
export const ledningCoaches = query("ledning.coaches", z.object({})).returns<LedningCoaches>();

export type AreaRow = { code: string; name: string; active: number; closed: number; rr: RateView };
export type LedningAreas = {
  lastMonth: string;
  minN: number;
  /** Gräns för små grupper i kundens rapporter (pulse.minNForAggregate). */
  smallGroupN: number;
  rows: AreaRow[];
  total: { active: number; closed: number };
  all: RateView;
  /** Aktiva någon gång under förra månaden – beställarrapportens räknesätt. */
  monthActive: number;
};
export const ledningAreas = query("ledning.areas", z.object({})).returns<LedningAreas>();

/** Aggregat för pulsmätningen. Fördelningar och andelar skickas bara när det finns minst minN svar. */
export type PulseAggregate = {
  invites: number;
  responses: number;
  responseRate: number | null;
  satisfaction: number | null;
  closer: number | null;
  support: number | null;
  q1: number[];
  q2: number[];
  q3: number[];
  priorities: [PulsePriority | string, number][];
};
export type LedningPulse = {
  minN: number;
  enough: boolean;
  periodicEveryDays: number;
  /**
   * Internt mål för svarsfrekvens (SPEC §2 – Miljonbemannings eget mål). Saknas för begränsade testare i testmiljön
   * (src/api/tester-access.ts) – skärmen visar "Visas inte för testare" och inget "Når målet"/"Under målet".
   */
  responseGoal?: number;
  stats: PulseAggregate | null;
  lowAlerts: AlertView[];
  lowOpen: number;
  contactRequested: number;
  perCoach: { id: string; name: string; responses: number; enough: boolean; satisfaction: number | null; support: number | null; responseRate: number | null }[];
};
export const ledningPulse = query("ledning.pulse", z.object({})).returns<LedningPulse>();

// ================================================================ Avtalsavvikelser (/avtalsavvikelser/:id?)
//
// Frågor (chef, avtalsansvarig, samordnare):
//   ledning.cdevRegister  -> CdevRegister   registret, nyckeltal, eskaleringstrappan och formulärets val
//   ledning.cdevDetail    -> CdevDetail     en avvikelse ({ found: false } om den inte finns eller inte får ses)
//   ledning.cdevMonth     -> CdevMonth      månadssammanställning för APT och kvalitetsmöte (med exporttexten)
// Kommandon:
//   ledning.cdevSave  { id?, data }   -> { id, sentToCustomer }  (prototypens cdev.save; fel: missing, warning_step, case_not_found, forbidden, not_found)
//   ledning.cdevClose { id, lessons } -> { id }                  (prototypens cdev.close; fel: not_found, lessons)

export const CD_TYPES: readonly { value: ContractDeviationType; label: string; help: string }[] = [
  { value: "kvalitet", label: "Kvalitet", help: "Insatsen eller rapporteringen håller inte den kvalitet som avtalet kräver." },
  { value: "process", label: "Process", help: "En rutin eller tidsgräns har inte följts, till exempel en rapport som kom för sent." },
  { value: "avtal", label: "Avtal", help: "Ett avtalskrav har inte uppfyllts, till exempel kontinuitet eller bemanning." },
  // Hjälptexten för ekonomi kommer från avtalskonfigurationen (economicDeviation) – se CdevForm.economicHelp.
  { value: "ekonomi", label: "Ekonomi", help: "" },
  { value: "klagomål", label: "Klagomål", help: "Klagomål eller reklamation från deltagare, arbetsgivare eller kommunen. Registreras i samma register." },
];
export const CD_LEVELS: readonly { value: ContractDeviationLevel; label: string; step: number; help: string }[] = [
  { value: "mindre", label: "Mindre", step: 0, help: "Påverkar inte kärnverksamheten och kan åtgärdas enkelt och snabbt." },
  { value: "större", label: "Större", step: 1, help: "Återkommande mindre avvikelser eller något som kännbart påverkar verksamheten." },
  { value: "allvarlig", label: "Allvarlig", step: 2, help: "Återkommande större avvikelser eller avbrott i kärnverksamheten." },
];
export const CD_SOURCES: readonly { value: ContractDeviationSource; label: string }[] = [
  { value: "beställare", label: "Kommunen påtalade" },
  { value: "intern", label: "Upptäckt internt" },
  { value: "deltagare", label: "Deltagare" },
  { value: "arbetsgivare", label: "Arbetsgivare" },
];
export const cdTypeLabel = (t: string | null | undefined): string => CD_TYPES.find((x) => x.value === t)?.label ?? (t || "–");
export const cdLevelLabel = (l: string | null | undefined): string => CD_LEVELS.find((x) => x.value === l)?.label ?? (l || "–");
export const cdSourceLabel = (s: string | null | undefined): string => CD_SOURCES.find((x) => x.value === s)?.label ?? (s || "–");

/** Visningsstatus räknas fram ur fälten, så att kommunens godkännande slår igenom direkt (prototypens cdStatus). */
export type CdStatusKey = "closed" | "no_plan" | "waiting" | "in_progress";
export const CD_STATUS_LABEL: Record<CdStatusKey, string> = {
  closed: "Klar",
  no_plan: "Åtgärdsplan saknas",
  waiting: "Väntar på kommunens godkännande",
  in_progress: "Åtgärdsplan godkänd – pågår",
};
export function cdStatusKey(cd: { status: ContractDeviationStatus; actionPlan: string | null | undefined; customerApprovedAt: string | null | undefined }): CdStatusKey {
  if (cd.status === "closed") return "closed";
  if (!String(cd.actionPlan ?? "").trim()) return "no_plan";
  if (!cd.customerApprovedAt) return "waiting";
  return "in_progress";
}

/** Ett steg i avtalets eskaleringstrappa (config.escalationLadder). */
export type LadderStep = { step: number; level: string; text: string };
/** "Steg 1 · Större" */
export function stepLabel(ladder: readonly LadderStep[], n: number): string {
  const s = ladder.find((x) => x.step === n);
  return s ? `Steg ${n} · ${s.level.charAt(0).toUpperCase()}${s.level.slice(1)}` : `Steg ${n}`;
}

export type CdevRow = {
  id: string;
  raisedAt: string;
  type: ContractDeviationType;
  level: ContractDeviationLevel;
  source: ContractDeviationSource;
  escalationStep: number;
  description: string;
  hasPlan: boolean;
  actionPlanDue: string | null;
  customerApprovedAt: string | null;
  statusKey: CdStatusKey;
  warningIssued: boolean;
  /** Vitets belopp. Saknas för begränsade testare i testmiljön (src/api/tester-access.ts). */
  penaltyOre?: number;
  orderStop: boolean;
};

/** Val i formulären (typer, källor, ansvariga, månader för avräkning av vite). Viten från avtalskonfigurationen. */
export type CdevForm = {
  economicHelp: string;
  owners: { value: string; label: string }[];
  defaultOwnerId: string;
  today: string;
  /** Innevarande och två följande månader (avräkning av vite). */
  offsetMonths: string[];
  /** Avtalets viten. Saknas för begränsade testare – vitesvalet visas då inte i formulären. */
  penalties?: { deviationOre: number; insufficientInformationOre: number };
  warningsBeforeTermination: number;
  ladder: LadderStep[];
  /** Chef och avtalsansvarig registrerar varningar, viten och avropsstopp. */
  canManage: boolean;
  /** Exempel på ärendenummer med avtalets prefix, t.ex. "BOT-26-0042". */
  caseNumberExample: string;
  /** Steg där kommunen kan ge skriftlig varning (1–3 i eskaleringstrappan). */
  warningSteps: { min: number; max: number };
};

export type CdevRegister = {
  customerName: string;
  rows: CdevRow[];
  /** penaltiesOre saknas för begränsade testare i testmiljön. */
  counts: { open: number; openComplaints: number; waiting: number; warnings: number; penaltiesOre?: number };
  stepCounts: Record<number, number>;
  maxStep: number | null;
  /** Månader för sammanställningen: avtalets start till innevarande månad. */
  aptMonths: string[];
  lastMonth: string;
  form: CdevForm;
};
export const cdevRegister = query("ledning.cdevRegister", z.object({})).returns<CdevRegister>();

export type CdevDetail =
  | { found: false }
  | {
      found: true;
      cd: CdevRow & {
        actionPlan: string;
        ownerId: string | null;
        ownerName: string | null;
        registeredByName: string | null;
        caseId: string | null;
        caseNumber: string | null;
        planSubmittedAt: string | null;
        approvedByName: string | null;
        warningIssuedAt: string | null;
        /** Vitet och fakturan det avräknas på. Saknas för begränsade testare i testmiljön. */
        penaltyKind?: PenaltyKind | null;
        penaltyOffsetMonth?: string | null;
        lessons: string;
        closedOn: string | null;
      };
      /** Förfallotid för en öppen åtgärdsplan (samma som listan Förfaller). */
      planDue: { dueAt: string; sla: Pick<SlaStatus, "label" | "tone"> } | null;
      totalWarnings: number;
      customerChefName: string | null;
      form: CdevForm;
    };
export const cdevDetail = query("ledning.cdevDetail", z.object({ id: IdSchema })).returns<CdevDetail>();

export type CdevMonthItem = { id: string; type: ContractDeviationType; level: ContractDeviationLevel; escalationStep: number; description: string; isNew: boolean; statusKey: CdStatusKey };
export type CdevMonth = {
  month: string;
  createdCount: number;
  complaints: number;
  openAtEnd: number;
  closed: number;
  participantDeviations: number;
  /** Nya och öppna (unika), i prototypens ordning. */
  items: CdevMonthItem[];
  actions: { id: string; actionPlan: string; actionPlanDue: string | null; statusKey: CdStatusKey }[];
  lessons: { id: string; lessons: string; type: ContractDeviationType; raisedAt: string }[];
  warnings: number;
  warningsBeforeTermination: number;
  /** Summan av viten. Saknas för begränsade testare (även raden i text). */
  penaltiesOre?: number;
  /** Texten för Kopiera text och Exportera (inga personuppgifter – beskrivningar skrivs med ärendenummer). */
  text: string;
};
export const cdevMonth = query("ledning.cdevMonth", z.object({ month: MonthKeySchema })).returns<CdevMonth>();

/** Fält som kan sparas. penaltyOre räknas i hanteraren från penaltyKind och avtalets viten – aldrig från klienten. */
export const CdevDataSchema = z.object({
  type: z.enum(["kvalitet", "process", "avtal", "ekonomi", "klagomål"]).optional(),
  level: z.enum(["mindre", "större", "allvarlig"]).optional(),
  source: z.enum(["beställare", "intern", "deltagare", "arbetsgivare"]).optional(),
  escalationStep: z.number().int().min(0).max(20).optional(),
  raisedOn: LocalDateSchema.optional(),
  description: z.string().max(5000).optional(),
  /** Ärendenummer, t.ex. BOT-26-0042 (tomt = inget ärende). Slås upp i hanteraren. */
  caseNumber: z.string().max(40).optional(),
  actionPlan: z.string().max(5000).optional(),
  actionPlanDue: LocalDateSchema.nullable().optional(),
  ownerId: IdSchema.nullable().optional(),
  warningIssued: z.boolean().optional(),
  penaltyKind: z.enum(["deviation", "information"]).nullable().optional(),
  penaltyOffsetMonth: MonthKeySchema.nullable().optional(),
  orderStop: z.boolean().optional(),
});
export type CdevData = z.infer<typeof CdevDataSchema>;

export const cdevSave = command("ledning.cdevSave", z.object({ id: IdSchema.optional(), data: CdevDataSchema }))
  .returns<Result<{ id: string; sentToCustomer: boolean }, "missing" | "warning_step" | "case_not_found" | "forbidden" | "not_found" | "no_contract">>();

export const cdevClose = command("ledning.cdevClose", z.object({ id: IdSchema, lessons: z.string().max(5000) }))
  .returns<Result<{ id: string }, "not_found" | "lessons">>();
