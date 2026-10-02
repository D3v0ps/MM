// Avtalskonfiguration (contracts.config) och Miljonbemannings interna regler (org_settings).
// CLAUDE.md punkt 4: avtalet är konfiguration – hårdkoda aldrig avtalsvärden. All konfiguration valideras med zod.
// SPEC §6.2 (Botkyrka) och §6.3 (skiss Kammarkollegiet). Värdena är exakt den gamla prototypens
// (prototyp/src/01-seed.js, CONFIG_BOT, CONFIG_KK och S.orgConfig) – med ett undantag: KK:s priser är i öre (priceOre)
// i stället för kronor (price), eftersom alla belopp ska vara öre (CLAUDE.md punkt 12).
//
// "ATT_FASTSTÄLLA" = värdet ska bekräftas med kunden (SPEC §13). Värdet får ha en förklaring efter, t.ex.
// "ATT_FASTSTÄLLA (förslag: 5 arbetsdagar)". En regel med det värdet ska inte aktiveras – visa "Ej fastställt".
import { z } from "zod";

// ---------------------------------------------------------------- ATT_FASTSTÄLLA
export const UNSET = "ATT_FASTSTÄLLA" as const;
/** Ett värde som ännu inte är fastställt, med eller utan förklaring efter. */
export type Unset = `${typeof UNSET}${string}`;
export const UnsetSchema = z.templateLiteral([UNSET, z.string()]);
/** Sant om värdet ska bekräftas (börjar med "ATT_FASTSTÄLLA"). */
export const isUnset = (v: unknown): v is Unset => typeof v === "string" && v.startsWith(UNSET);
/** Text som visas i stället för ett värde som inte är fastställt. */
export const UNSET_LABEL = "Ej fastställt";
/** Tillåt ett värde eller ATT_FASTSTÄLLA. */
const unsetOr = <S extends z.ZodType>(schema: S) => z.union([schema, UnsetSchema]);

/** Värdet som text: "Ej fastställt" om det inte är fastställt, annars formaterat (standard: String). */
export function configValueText<T>(v: T | Unset | null | undefined, format: (x: T) => string = (x) => String(x)): string {
  if (isUnset(v)) return UNSET_LABEL;
  if (v == null || v === "") return "–";
  return format(v as T);
}

/**
 * Förklaringen efter ATT_FASTSTÄLLA, i klarspråk (samma regler som prototypens adminvy):
 *   "ATT_FASTSTÄLLA (förslag: 5 arbetsdagar)"      -> "Förslag: 5 arbetsdagar"
 *   "ATT_FASTSTÄLLA (own | unit | all)"            -> "Alternativ: egna ärenden, enhetens ärenden eller alla"
 *   "ATT_FASTSTÄLLA enligt PUB-avtalet"            -> "Fastställs enligt PUB-avtalet"
 *   "ATT_FASTSTÄLLA"                               -> null
 */
export function unsetHint(v: unknown): string | null {
  if (!isUnset(v)) return null;
  const s = v.slice(UNSET.length).trim();
  if (!s) return null;
  if (s.startsWith("(") && s.endsWith(")")) {
    const inner = s.slice(1, -1).trim();
    if (/^förslag:/i.test(inner)) return `Förslag: ${inner.replace(/^förslag:\s*/i, "")}`;
    if (inner === "own | unit | all") return "Alternativ: egna ärenden, enhetens ärenden eller alla";
    const t = inner.replace(/\s*–\s*väljs genom test$/i, "");
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return `Fastställs ${s}`;
}

// ---------------------------------------------------------------- Byggstenar
const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum ska skrivas ÅÅÅÅ-MM-DD");
const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Klockslag ska skrivas TT:MM");
const RegexSchema = z.string().min(1).refine((p) => {
  try {
    new RegExp(p);
    return true;
  } catch {
    return false;
  }
}, "Ogiltigt mönster");
const Share = z.number().min(0).max(1);
const PosInt = z.int().min(1);

export const DataRoleSchema = z.enum(["processor", "controller"]);
export type DataRole = z.infer<typeof DataRoleSchema>;
/** Beställningskanaler (samma värden som cases.source). */
export const OrderChannelSchema = z.enum(["email", "portal", "phone"]);
export type OrderChannel = z.infer<typeof OrderChannelSchema>;
/** Prisenhet (price_items.unit, SPEC §6.1). */
export const PriceUnitSchema = z.enum(["participant_week", "month", "package", "each"]);
export type PriceUnit = z.infer<typeof PriceUnitSchema>;
/** Vilka ärenden kommunens handläggare ser: egna, enhetens eller alla. */
export const VisibilityScopeSchema = z.enum(["own", "unit", "all"]);
export type VisibilityScope = z.infer<typeof VisibilityScopeSchema>;
export const KpiWindowSchema = z.enum(["rolling_6m", "rolling_3m", "since_start", "month"]);
export type KpiWindow = z.infer<typeof KpiWindowSchema>;
/** Mottagare av KPI-varningar. "controller" = chef/controller (rollen chef i appen). */
export const KpiNotifyRoleSchema = z.enum(["chef", "controller", "avtalsansvarig", "samordnare", "coach"]);
export type KpiNotifyRole = z.infer<typeof KpiNotifyRoleSchema>;
export const PulseOccasionSchema = z.enum(["week2", "exit", "periodic"]);
export type PulseOccasion = z.infer<typeof PulseOccasionSchema>;
export const EscalationLevelSchema = z.enum(["mindre", "större", "allvarlig", "hävning"]);
export type EscalationLevel = z.infer<typeof EscalationLevelSchema>;
/** Progressionsnivå 0–3 (SPEC §6.2). Sätts alltid av coachen, aldrig av AI (CLAUDE.md punkt 5). */
export type ProgressLevel = 0 | 1 | 2 | 3;
export const PROGRESS_LEVELS: readonly ProgressLevel[] = [0, 1, 2, 3];

// ---------------------------------------------------------------- Avsnitt
const CustomerVisibilitySchema = z.strictObject({
  /** Egna ärenden, enhetens eller alla. ATT_FASTSTÄLLA tills kommunen bestämt. */
  scope: unsetOr(VisibilityScopeSchema).optional(),
  /** Preliminärt värde som används så länge scope inte är fastställt (det mest begränsade: own). */
  prototypeScope: VisibilityScopeSchema.optional(),
  seesIndividualReports: z.boolean(),
  seesCoachNotes: z.boolean(),
  seesSlaStats: z.boolean().optional(),
  /**
   * Kommunen läser deltagarens röstmeddelanden (participant_voice_notes) när coachen granskat dem. Standard: nej –
   * röstmeddelandena är underlag för coachen (docs/PLAN-ROST.md).
   */
  seesParticipantVoiceNotes: z.boolean().optional(),
});

const ReportDeliverySchema = z.strictObject({
  channel: z.enum(["portal"]),
  /** Rapporter som bilaga i vanlig e-post (CLAUDE.md punkt 9: bara om avtalet uttryckligen tillåter). */
  emailAttachmentAllowed: z.boolean(),
});

const PhaseSchema = z.strictObject({ no: PosInt, name: z.string().min(1) });
const StuckRuleSchema = z.strictObject({
  phase: PosInt,
  maxDays: PosInt,
  /** Räknas inte som fastnat om praktik är planerad. */
  unlessPlacementPlanned: z.boolean().optional(),
});

const AreaKeySchema = z.string().regex(/^[a-z][a-z_]*$/, "Områdesnyckel: små bokstäver och understreck");
const ProgressionSchema = z
  .strictObject({
    scale: z.record(z.enum(["0", "1", "2", "3"]), z.string().min(1)),
    areas: z.array(AreaKeySchema).min(1),
    optionalAreas: z.array(AreaKeySchema),
    areaLabels: z.record(z.string(), z.string().min(1)),
    /** Observation krävs från och med den här nivån. */
    observationRequiredFromLevel: z.int().min(0).max(3),
    /**
     * Tydlig progression (beslut 2026-10-01): ett område på minst den här nivån. Botkyrka: 2. Räknas bara på de
     * obligatoriska områdena (areas) – de valfria räknas aldrig i statistik (progressionFlags nedan).
     */
    clearFromLevel: z.int().min(1).max(3),
    /** Någon progression: ett område på minst den här nivån. Botkyrka: 1. Högst clearFromLevel. */
    anyFromLevel: z.int().min(0).max(3),
    /**
     * Äldre fritext ("minst ett område på nivå >= 2"). Läses inte längre – talen ovan gäller. Finns kvar som valfritt fält så
     * att en sparad konfiguration med texten fortfarande validerar.
     */
    statDefinition: z.strictObject({ clear: z.string().min(1), any: z.string().min(1) }).optional(),
  })
  .superRefine((p, ctx) => {
    for (const key of [...p.areas, ...p.optionalAreas]) {
      if (!p.areaLabels[key]) ctx.addIssue({ code: "custom", message: `Etikett saknas för progressionsområdet ${key}`, path: ["areaLabels", key] });
    }
    if (p.anyFromLevel > p.clearFromLevel) {
      ctx.addIssue({ code: "custom", message: "Någon progression (anyFromLevel) kan inte kräva en högre nivå än tydlig progression (clearFromLevel)", path: ["anyFromLevel"] });
    }
  });

const ResultSchema = z.strictObject({
  definition: z.string().min(1),
  /** Preliminär definition som används tills definitionen är fastställd (visas som preliminär). */
  prototypeDefinition: z.string().optional(),
  /** Avslutsorsaker som räknas som resultat (cases.end_reason). */
  countsAsResult: z.array(z.string().min(1)).min(1),
  excludedFromDenominator: unsetOr(z.array(z.string().min(1))),
  /** Preliminärt: avslutsorsaker som inte räknas i nämnaren tills excludedFromDenominator är fastställt. */
  prototypeExcluded: z.array(z.string().min(1)).optional(),
  requiresVerification: z.boolean(),
});

const KpiSchema = z.strictObject({
  key: z.string().min(1),
  label: z.string().min(1).optional(),
  windows: z.array(KpiWindowSchema).optional(),
  contractTarget: Share.optional(),
  internalTarget: unsetOr(Share).optional(),
  /** Minsta antal avslutade för att värdet ska visas som annat än preliminärt. */
  minN: PosInt.optional(),
  notify: z.strictObject({ belowInternal: z.array(KpiNotifyRoleSchema), belowContract: z.array(KpiNotifyRoleSchema) }).optional(),
});

/** Tidsgräns: exakt en av minuter, arbetsdagar eller kalenderdagar. */
const WithinSchema = z
  .strictObject({ minutes: PosInt.optional(), workingDays: PosInt.optional(), days: PosInt.optional() })
  .refine((w) => [w.minutes, w.workingDays, w.days].filter((x) => x != null).length === 1, "Ange exakt en av minutes, workingDays eller days");
export type Within = z.infer<typeof WithinSchema>;

const SlaRuleSchema = z.strictObject({
  key: z.string().min(1),
  label: z.string().min(1).optional(),
  /** Startpunkt, t.ex. avrop_mottaget, avslutsdatum, bestallning. */
  from: z.string().min(1).optional(),
  within: unsetOr(WithinSchema).optional(),
  /** Beskrivning av förfallotiden, t.ex. "måndag 10:00 för föregående vecka", eller ATT_FASTSTÄLLA. */
  due: z.string().min(1).optional(),
  /** Veckodag (0 = måndag) och klockslag för veckovisa tidsgränser. */
  weekday: z.int().min(0).max(6).optional(),
  time: TimeSchema.optional(),
  /** Sköts automatiskt av systemet (t.ex. ordererkännande). */
  automatic: z.boolean().optional(),
  /** Förslag som används preliminärt så länge regeln inte är fastställd. */
  proposal: z.strictObject({ nthWorkingDay: PosInt.optional(), workingDays: PosInt.optional() }).optional(),
});

const AttendanceSchema = z.strictObject({
  sameDayNoticeOnInvalidAbsence: unsetOr(z.boolean()),
  repeatedAbsenceRule: z.strictObject({ absentInvalid: PosInt, withinDays: PosInt }),
});

const PatternRuleSchema = z.strictObject({ required: z.boolean(), pattern: RegexSchema });
const BillingSchema = z.strictObject({
  unit: PriceUnitSchema,
  /** Debiterbar vecka = varje ISO-vecka med minst en inskriven dag, utom pausade veckor (SPEC §3.1). */
  billableWeekRule: z.enum(["every_iso_week_with_at_least_one_enrolled_day_excluding_paused_weeks"]),
  flagZeroAttendanceWeeks: z.boolean(),
  /** Veckan faktureras i månaden där torsdagen infaller. */
  weekToMonthRule: z.enum(["iso_thursday"]),
  invoicePer: z.enum(["case_and_month"]),
  collectiveInvoiceAllowed: z.boolean(),
  /** Kommunens beställarreferens (8–10 siffror). */
  buyerReference: PatternRuleSchema,
  /** Kommunens inköpsordernummer (nio siffror som börjar med 99). Aldrig våra egna nummer. */
  purchaseOrderNumber: PatternRuleSchema,
  invoicedObject: z.enum(["case_number"]),
  showAccruedAndRemaining: z.boolean(),
  separatePeriodicFromOther: z.boolean(),
  paymentTermsDays: PosInt,
  unbilledWarningDays: PosInt,
  format: z.string().min(1),
  fallback: z.array(z.string().min(1)),
});

const BonusSchema = z.strictObject({ enabled: z.boolean(), model: z.string().min(1), separateInvoice: z.boolean() });
const PulseSchema = z.strictObject({
  occasions: z.array(PulseOccasionSchema),
  periodicEveryDays: PosInt,
  languages: z.array(z.string().min(2)).min(1),
  /** Aggregat visas först från så här många svar. */
  minNForAggregate: PosInt,
});
const StatisticsSchema = z.strictObject({ onRequestMaxPerYear: PosInt, free: z.boolean() });
const TerminationSchema = z.strictObject({ returnDataWithinDays: PosInt, deleteAfterReturn: z.boolean() });
const EscalationStepSchema = z.strictObject({ step: z.int().min(0), level: EscalationLevelSchema, text: z.string().min(1) });
const PenaltiesSchema = z.strictObject({
  /** Vite per tillfälle vid avvikelse, i öre. */
  deviationOre: z.int().min(0),
  /** Vite vid bristfällig löpande information, i öre. */
  insufficientInformationOre: z.int().min(0),
});
// ---- AI-stöd och röstinspelning (SPEC §8, docs/PLAN-ROST.md, beslut 2026-09-30)
/**
 * AI-leverantörer som ett avtal kan godkänna. vertex_eu = Gemini via Google Cloud Vertex AI, EU multi-region-endpoint
 * (aiplatform.eu.rep.googleapis.com, location eu) – aldrig AI Studio-nyckel eller global endpoint (CLAUDE.md).
 * Modellen är en miljövariabel (MM_AI_MODEL). Vilken adapter servern kör (vertex eller simulerad) styrs av MM_AI_PROVIDER.
 */
export const AI_PROVIDERS = ["vertex_eu"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const AI_PROVIDER_LABEL: Record<AiProvider, string> = { vertex_eu: "Gemini Flash via Google Cloud Vertex AI (EU)" };
/** De tre inspelningsflödena: coachens avstämning, kommunens handläggare ("Tala in") och deltagarens egen inspelning via länk. */
export const RECORDING_KINDS = ["coach", "customer", "participant"] as const;
export type RecordingKind = (typeof RECORDING_KINDS)[number];
/** Språk för transkribering och deltagarens inspelning (ISO 639-1). */
const LanguageCodeSchema = z.string().regex(/^[a-z]{2}$/, "Språkkod: två små bokstäver, t.ex. sv");
const RecordingFlagsSchema = z.strictObject({
  /** Coachen spelar in avstämningen live eller laddar upp en ljudfil (kräver deltagarens samtycke, consents). */
  coach: z.boolean(),
  /** Kommunens handläggare talar in text (beställningens bakgrund, meddelanden). Inget ljud sparas. */
  customer: z.boolean(),
  /** Deltagaren spelar in via en länk utan inloggning (samtycke i länken). Inget ljud sparas. */
  participant: z.boolean(),
  /** När kommunen skriftligen godkände inspelningen för de påslagna delarna. Krävs om någon del är påslagen. */
  approvedByCustomerOn: LocalDateSchema.nullable(),
});
const AiSchema = z
  .strictObject({
    /** Godkänd AI-leverantör för avtalet, eller ATT_FASTSTÄLLA (då körs ingen AI – bara den simulerade i test). */
    provider: unsetOr(z.enum(AI_PROVIDERS)),
    /** Kommunens godkännande av inspelade avstämningar (SPEC §3.1). Visas i administrationen. */
    recordingApprovedByCustomer: LocalDateSchema.nullable(),
    /** Vilka inspelningsflöden som är påslagna i avtalet. Utan avsnittet är allt avstängt. */
    recording: RecordingFlagsSchema,
    /** Längsta inspelning i minuter per flöde. */
    maxMinutes: z.strictObject({ coach: PosInt, customer: PosInt, participant: PosInt }),
    /** Språk som deltagaren kan spela in på och som transkriberas (översätts till svenska). Svenska måste finnas med. */
    languages: z.array(LanguageCodeSchema).min(1),
    /** Så många dagar gäller deltagarens inspelningslänk. */
    participantLinkValidDays: PosInt,
  })
  .superRefine((ai, ctx) => {
    if (!ai.languages.includes("sv")) ctx.addIssue({ code: "custom", message: "Svenska (sv) måste finnas bland språken", path: ["languages"] });
    if (new Set(ai.languages).size !== ai.languages.length) ctx.addIssue({ code: "custom", message: "Språken måste vara unika", path: ["languages"] });
    const on = RECORDING_KINDS.some((k) => ai.recording[k]);
    if (on && !ai.recording.approvedByCustomerOn) {
      ctx.addIssue({ code: "custom", message: "Inspelning kräver kommunens skriftliga godkännande (datum)", path: ["recording", "approvedByCustomerOn"] });
    }
  });
const OrderWeeksSchema = z.strictObject({ min: PosInt, max: PosInt, note: z.string() }).refine((w) => w.max >= w.min, "max måste vara minst min");

/** Prislista i konfigurationen (KK-skissen). Belopp i öre, exkl. moms. */
const ConfigPriceItemSchema = z.strictObject({ code: z.string().min(1), unit: PriceUnitSchema, packageMonths: PosInt.optional(), priceOre: z.int().min(0) });
const MeetingMinimumSchema = z.strictObject({
  service: z.string().min(1),
  minMeetings: PosInt.optional(),
  minMinutesEach: PosInt.optional(),
  periodMonths: PosInt.optional(),
  minMeetingsPerMonth: PosInt.optional(),
});
const ExportSchema = z.strictObject({ key: z.string().min(1), format: z.string().min(1), fieldsPerCustomer: PosInt.optional() });
/** Avtalstexter i klarspråk som visas under Avtalsfakta i administrationen (prototypens CONTRACT_NOTES). */
const ContractTextsSchema = z.strictObject({
  /** Omfattning, t.ex. antal årsplatser, avtalsområden och rangordning. */
  scope: z.string().min(1).optional(),
  /** Uppsägning av avtalet (tidigaste tidpunkt och uppsägningstid). */
  termination: z.string().min(1).optional(),
});

// ---- Rapportutkast som skapas automatiskt (beslut 2026-10-01, rapportarbetet steg 1)
/** Rapporttyper som kan skapas automatiskt som utkast när perioden är slut (src/core/report-schedule.ts). */
export const AUTO_REPORT_KINDS = ["weekly_attendance", "monthly", "customer_summary"] as const;
export type AutoReportKind = (typeof AUTO_REPORT_KINDS)[number];
const ReportScheduleSchema = z
  .strictObject({
    /**
     * Rapporterna som skapas automatiskt (tom lista = inga):
     *   weekly_attendance  en per handläggare och ISO-vecka med minst ett inskrivet ärende hos handläggaren, när veckan är
     *                      slut (status waiting). Sista dag: sla[veckorapport_publicering] (veckodag och klockslag veckan efter).
     *   monthly            en per ärende och månad där ärendet är inskrivet minst monthly.minEnrolledDays dagar, när månaden
     *                      är slut (status draft). Sista dag: sla[manadsrapport] (n:e arbetsdagen efter månadsskiftet).
     *   customer_summary   en per aktiv chef hos kommunen och månad, när månaden är slut (status draft). Sista dag: customerSummaryDue.
     * Veckorapporten och månadsrapporten kräver att sla-regeln finns (kontrolleras i crossCheck nedan).
     */
    automatic: z.array(z.enum(AUTO_REPORT_KINDS)),
    /**
     * Månadsrapporten (beslut 2026-10-01): skapas bara för en månad där ärendet varit inskrivet minst så här många
     * kalenderdagar (startdatum och slutdatum räknas med). Botkyrka: 11 – färre dagar ger ingen rapport för månaden.
     */
    monthly: z.strictObject({ minEnrolledDays: PosInt }).optional(),
    /** Beställarrapportens sista dag: n:e arbetsdagen efter månadsskiftet och klockslaget. Ett förslag – inte fastställt med kommunen. */
    customerSummaryDue: z.strictObject({ nthWorkingDay: PosInt, time: TimeSchema }).optional(),
  })
  .superRefine((s, ctx) => {
    if (new Set(s.automatic).size !== s.automatic.length) ctx.addIssue({ code: "custom", message: "Rapporttyperna måste vara unika", path: ["automatic"] });
    if (s.automatic.includes("monthly") && !s.monthly) {
      ctx.addIssue({ code: "custom", message: "Månadsrapporten behöver ett minsta antal inskrivna dagar (monthly.minEnrolledDays)", path: ["monthly"] });
    }
    if (s.automatic.includes("customer_summary") && !s.customerSummaryDue) {
      ctx.addIssue({ code: "custom", message: "Beställarrapporten behöver en sista dag (customerSummaryDue)", path: ["customerSummaryDue"] });
    }
  });

// ---------------------------------------------------------------- Hela konfigurationen
const ContractConfigBase = z.strictObject({
  casePrefix: z.string().regex(/^[A-Z]{2,5}$/, "Prefix: 2–5 versaler"),
  dataRole: DataRoleSchema,
  thirdCountryProcessing: z.enum(["forbidden_without_written_approval"]).optional(),
  orderChannels: z.array(OrderChannelSchema).min(1).optional(),
  orderWeeks: OrderWeeksSchema.optional(),
  customerVisibility: CustomerVisibilitySchema.optional(),
  reportDelivery: ReportDeliverySchema.optional(),
  phases: z.array(PhaseSchema).min(1).optional(),
  stuckRules: z.array(StuckRuleSchema).optional(),
  progression: ProgressionSchema.optional(),
  result: ResultSchema.optional(),
  kpis: z.array(KpiSchema).optional(),
  sla: z.array(SlaRuleSchema).optional(),
  attendance: AttendanceSchema.optional(),
  billing: BillingSchema.optional(),
  bonus: BonusSchema.optional(),
  pulse: PulseSchema.optional(),
  statistics: StatisticsSchema.optional(),
  termination: TerminationSchema.optional(),
  retention: z.string().min(1).optional(),
  escalationLadder: z.array(EscalationStepSchema).min(1).optional(),
  warningsBeforeTermination: PosInt.optional(),
  penalties: PenaltiesSchema.optional(),
  economicDeviation: z.string().min(1).optional(),
  keyPersonnelChangeRequiresApproval: z.boolean().optional(),
  ai: AiSchema.optional(),
  priceItems: z.array(ConfigPriceItemSchema).optional(),
  meetingMinimums: z.array(MeetingMinimumSchema).optional(),
  exports: z.array(ExportSchema).optional(),
  texts: ContractTextsSchema.optional(),
  /** Rapportutkast som skapas automatiskt. Utan avsnittet skapas inga rapporter automatiskt. */
  reportSchedule: ReportScheduleSchema.optional(),
});

type ConfigShape = z.infer<typeof ContractConfigBase>;

/** Kontroller som går över flera avsnitt. */
function crossCheck(cfg: ConfigShape, ctx: z.RefinementCtx) {
  const phaseNos = new Set((cfg.phases ?? []).map((p) => p.no));
  if (cfg.phases && phaseNos.size !== cfg.phases.length) ctx.addIssue({ code: "custom", message: "Fasnumren måste vara unika", path: ["phases"] });
  for (const [i, r] of (cfg.stuckRules ?? []).entries()) {
    if (cfg.phases && !phaseNos.has(r.phase)) ctx.addIssue({ code: "custom", message: `Fas ${r.phase} finns inte`, path: ["stuckRules", i, "phase"] });
  }
  const unique = (xs: { key: string }[] | undefined, path: string) => {
    if (xs && new Set(xs.map((x) => x.key)).size !== xs.length) ctx.addIssue({ code: "custom", message: "Nycklarna måste vara unika", path: [path] });
  };
  unique(cfg.kpis, "kpis");
  unique(cfg.sla, "sla");
  if (cfg.escalationLadder && new Set(cfg.escalationLadder.map((s) => s.step)).size !== cfg.escalationLadder.length) {
    ctx.addIssue({ code: "custom", message: "Stegen i eskaleringstrappan måste vara unika", path: ["escalationLadder"] });
  }
  // Rapportutkasten: varje rapporttyp som skapas automatiskt måste ha en sista dag i sla – annars skulle inga rader skapas
  // utan att någon märker det (src/core/report-schedule.ts).
  const auto = cfg.reportSchedule?.automatic ?? [];
  const slaCfg = { sla: cfg.sla ?? [] };
  if (auto.includes("weekly_attendance") && !slaRule(slaCfg, "veckorapport_publicering")?.time) {
    ctx.addIssue({ code: "custom", message: "Veckorapporten behöver en sista dag: sla-regeln veckorapport_publicering med klockslag (time)", path: ["reportSchedule", "automatic"] });
  }
  if (auto.includes("monthly") && monthlyReportWorkingDay(slaCfg) == null) {
    ctx.addIssue({ code: "custom", message: "Månadsrapporten behöver en sista dag: sla-regeln manadsrapport med within.workingDays eller proposal.nthWorkingDay", path: ["reportSchedule", "automatic"] });
  }
}

/** Avtalskonfiguration. Allt utom casePrefix och dataRole är valfritt – ett avtal i utkast (t.ex. KK) har bara delar. */
export const ContractConfigSchema = ContractConfigBase.superRefine(crossCheck);
export type ContractConfig = z.infer<typeof ContractConfigSchema>;

/** Avsnitt som måste finnas för att ärenden ska kunna hanteras i avtalet (Botkyrka har alla). */
export const OPERATIONAL_SECTIONS = [
  "thirdCountryProcessing", "orderChannels", "orderWeeks", "customerVisibility", "reportDelivery", "phases", "stuckRules", "progression",
  "result", "kpis", "sla", "attendance", "billing", "bonus", "pulse", "statistics", "termination", "retention", "escalationLadder",
  "warningsBeforeTermination", "penalties", "economicDeviation", "keyPersonnelChangeRequiresApproval", "ai",
] as const satisfies readonly (keyof ConfigShape)[];
type OperationalSection = (typeof OPERATIONAL_SECTIONS)[number];

/** Konfiguration för ett avtal där ärenden hanteras: alla driftavsnitt finns. Hanterare för ärenden använder den här typen. */
export const OperationalConfigSchema = ContractConfigBase.required(
  Object.fromEntries(OPERATIONAL_SECTIONS.map((k) => [k, true])) as { [K in OperationalSection]: true },
).superRefine(crossCheck);
export type OperationalConfig = z.infer<typeof OperationalConfigSchema>;

// Deltyper som andra moduler behöver.
export type CustomerVisibility = OperationalConfig["customerVisibility"];
export type Phase = OperationalConfig["phases"][number];
export type StuckRule = OperationalConfig["stuckRules"][number];
export type ProgressionConfig = OperationalConfig["progression"];
export type ResultConfig = OperationalConfig["result"];
export type KpiDef = OperationalConfig["kpis"][number];
export type SlaRule = OperationalConfig["sla"][number];
export type AttendanceConfig = OperationalConfig["attendance"];
export type BillingConfig = OperationalConfig["billing"];
export type PulseConfig = OperationalConfig["pulse"];
export type EscalationStep = OperationalConfig["escalationLadder"][number];
/** AI-avsnittet (leverantör, inspelningsflöden, maxlängd, språk, länkens giltighet). */
export type AiConfig = OperationalConfig["ai"];
export type ConfigPriceItem = NonNullable<ContractConfig["priceItems"]>[number];
export type MeetingMinimum = NonNullable<ContractConfig["meetingMinimums"]>[number];
/** Rapportutkast som skapas automatiskt (reportSchedule). */
export type ReportSchedule = NonNullable<ContractConfig["reportSchedule"]>;

/** Validera rå konfiguration (t.ex. contracts.config från databasen). Kastar ZodError vid fel. */
export const parseContractConfig = (raw: unknown): ContractConfig => ContractConfigSchema.parse(raw);

/** Sant om avtalet har alla avsnitt som behövs för att hantera ärenden. */
export const isOperational = (cfg: ContractConfig): cfg is OperationalConfig =>
  OPERATIONAL_SECTIONS.every((k) => cfg[k] !== undefined);

/** Driftkonfigurationen för ett avtal. Kastar ett fel (utan personuppgifter) om avsnitt saknas, t.ex. för ett avtal i utkast. */
export function requireOperational(cfg: ContractConfig): OperationalConfig {
  if (isOperational(cfg)) return cfg;
  const missing = OPERATIONAL_SECTIONS.filter((k) => cfg[k] === undefined);
  throw new Error(`Avtalskonfigurationen (${cfg.casePrefix}) saknar ${missing.join(", ")}`);
}

/**
 * Sökvägar till värden som fortfarande är ATT_FASTSTÄLLA – för varningen i adminvyn (SPEC §6.2).
 * Listelement med nyckel skrivs med nyckeln: "kpis[narvarograd].internalTarget".
 */
export function unsetPaths(cfg: ContractConfig): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (isUnset(v)) out.push(path);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${x && typeof x === "object" && "key" in x ? String((x as { key: unknown }).key) : i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(cfg, "");
  return out;
}

// ---------------------------------------------------------------- Hjälpare
/** Mönstret för kommunens beställarreferens. */
export const buyerRefPattern = (cfg: Pick<OperationalConfig, "billing">): RegExp => new RegExp(cfg.billing.buyerReference.pattern);
/** Mönstret för kommunens inköpsordernummer. */
export const purchaseOrderPattern = (cfg: Pick<OperationalConfig, "billing">): RegExp => new RegExp(cfg.billing.purchaseOrderNumber.pattern);
/** Antal siffror i beställarreferensen ur mönstret, t.ex. "8–10" (tankstreck). Tom sträng om mönstret inte anger antal. */
export function buyerRefLengthText(cfg: Pick<OperationalConfig, "billing">): string {
  const p = cfg.billing.buyerReference.pattern;
  const range = p.match(/\{(\d+),(\d+)\}/);
  if (range) return `${range[1]}–${range[2]}`;
  const exact = p.match(/\{(\d+)\}/);
  return exact ? exact[1] : "";
}

/** Fasens namn, t.ex. fas 4 -> "Praktik/APL". "–" om fasen saknas. */
export function phaseName(cfg: Pick<OperationalConfig, "phases">, n: number | null | undefined): string {
  return cfg.phases.find((p) => p.no === n)?.name ?? "–";
}
/** "Fas 4 · Praktik/APL" */
export const phaseLabel = (cfg: Pick<OperationalConfig, "phases">, n: number): string => `Fas ${n} · ${phaseName(cfg, n)}`;

export type ProgressionArea = { key: string; label: string; optional: boolean };
/** Progressionsområdena med etiketter, i konfigurationens ordning. De valfria kommer sist om de tas med. */
export function progressionAreas(cfg: Pick<OperationalConfig, "progression">, opts: { includeOptional?: boolean } = {}): ProgressionArea[] {
  const p = cfg.progression;
  const main = p.areas.map((key) => ({ key, label: p.areaLabels[key] ?? key, optional: false }));
  return opts.includeOptional ? [...main, ...p.optionalAreas.map((key) => ({ key, label: p.areaLabels[key] ?? key, optional: true }))] : main;
}
// ---------------------------------------------------------------- Tydlig och någon progression (beslut 2026-10-01)
// Gränserna är tal i konfigurationen (clearFromLevel, anyFromLevel). Andelen med tydlig/någon progression räknas bara på de
// obligatoriska områdena (progressionAreas) – de valfria (hälsa, livskvalitet) räknas aldrig i statistik till kommunen.
type ProgressionRuleCfg = { progression: Pick<OperationalConfig["progression"], "clearFromLevel" | "anyFromLevel"> };

/** Tydlig progression i ett enskilt område: nivån är satt och minst clearFromLevel. */
export const levelIsClear = (cfg: ProgressionRuleCfg, level: number | null | undefined): boolean => level != null && level >= cfg.progression.clearFromLevel;
/** Någon progression i ett enskilt område: nivån är satt och minst anyFromLevel. */
export const levelIsAny = (cfg: ProgressionRuleCfg, level: number | null | undefined): boolean => level != null && level >= cfg.progression.anyFromLevel;

export type ProgressionFlags = {
  /** Bedömda obligatoriska områden (nivå satt). */
  assessed: number;
  /** Obligatoriska områden med tydlig progression. */
  clearCount: number;
  /** Obligatoriska områden med någon progression. */
  anyCount: number;
  /** Minst ett obligatoriskt område med tydlig progression. */
  clear: boolean;
  /** Minst ett obligatoriskt område med någon progression. */
  any: boolean;
};
/**
 * Tydlig och någon progression för en bedömning (månadsbedömningens areas). Filtrerar själv på de obligatoriska områdena –
 * valfria områden (optionalAreas) och okända nycklar räknas aldrig, även när de är bedömda.
 */
export function progressionFlags(
  cfg: { progression: Pick<OperationalConfig["progression"], "areas" | "clearFromLevel" | "anyFromLevel"> },
  areas: Readonly<Record<string, { level: number | null } | null | undefined>> | null | undefined,
): ProgressionFlags {
  let assessed = 0;
  let clearCount = 0;
  let anyCount = 0;
  for (const key of cfg.progression.areas) {
    const level = areas?.[key]?.level ?? null;
    if (level == null) continue;
    assessed++;
    if (levelIsClear(cfg, level)) clearCount++;
    if (levelIsAny(cfg, level)) anyCount++;
  }
  return { assessed, clearCount, anyCount, clear: clearCount > 0, any: anyCount > 0 };
}
export type ProgressionRuleText = {
  clear: string;
  any: string;
  /**
   * Vilka områden som inte räknas, med namn ur konfigurationen – null när avtalet saknar valfria områden. Botkyrka:
   * "Hälsa (funktionellt beskrivet) och livskvalitet (deltagarens egen skattning) är valfria områden och räknas inte."
   */
  excluded: string | null;
};
/**
 * Texterna för reglerna, byggda av talen och områdena: { clear: "Minst ett område på nivå 2 eller högre", any: "Minst ett
 * område på nivå 1 eller högre", excluded: "… är valfria områden och räknas inte." }. Kommunen ska kunna förstå vilka
 * områden som inte räknas utan att känna till begreppet "obligatoriska områden".
 */
export function progressionRuleText(cfg: {
  progression: Pick<OperationalConfig["progression"], "clearFromLevel" | "anyFromLevel" | "optionalAreas" | "areaLabels">;
}): ProgressionRuleText {
  const p = cfg.progression;
  const t = (n: number) => `Minst ett område på nivå ${n} eller högre`;
  const labels = p.optionalAreas.map((k, i) => {
    const l = p.areaLabels[k] ?? k;
    return i === 0 ? l : l.charAt(0).toLowerCase() + l.slice(1);
  });
  const names = labels.length <= 1 ? labels.join("") : `${labels.slice(0, -1).join(", ")} och ${labels[labels.length - 1]}`;
  const excluded = labels.length === 0 ? null : labels.length === 1 ? `${names} är ett valfritt område och räknas inte.` : `${names} är valfria områden och räknas inte.`;
  return { clear: t(p.clearFromLevel), any: t(p.anyFromLevel), excluded };
}

/** Skalans text för en nivå, t.ex. 2 -> "Tydlig". */
export const progressionScaleLabel = (cfg: Pick<OperationalConfig, "progression">, level: ProgressLevel): string =>
  cfg.progression.scale[String(level) as "0" | "1" | "2" | "3"];

/** SLA-regel per nyckel (t.ex. "avrop_svar"). */
export const slaRule = (cfg: Pick<ContractConfig, "sla">, key: string): SlaRule | null => cfg.sla?.find((x) => x.key === key) ?? null;
/** Regelns tidsgräns om den är fastställd, annars null (ATT_FASTSTÄLLA eller saknas). */
export function slaWithin(cfg: Pick<ContractConfig, "sla">, key: string): Within | null {
  const w = slaRule(cfg, key)?.within;
  return w && !isUnset(w) ? w : null;
}
/**
 * Månadsrapportens sista dag som n:e arbetsdagen efter månadsskiftet: den fastställda regeln (within.workingDays från
 * månadsskiftet), annars förslaget (proposal.nthWorkingDay – Botkyrka: 5). null om ingen av dem finns.
 */
export function monthlyReportWorkingDay(cfg: Pick<ContractConfig, "sla">): number | null {
  return slaWithin(cfg, "manadsrapport")?.workingDays ?? slaRule(cfg, "manadsrapport")?.proposal?.nthWorkingDay ?? null;
}
/** KPI-definition per nyckel (t.ex. "resultatgrad"). */
export const kpiDef = (cfg: Pick<ContractConfig, "kpis">, key: string): KpiDef | null => cfg.kpis?.find((x) => x.key === key) ?? null;
/** "Fastnat"-regel för en fas, om det finns någon. */
export const stuckRule = (cfg: Pick<OperationalConfig, "stuckRules">, phase: number): StuckRule | null =>
  cfg.stuckRules.find((r) => r.phase === phase) ?? null;
/** Synlighet för kommunens handläggare som gäller nu: fastställt värde, annars det preliminära, annars "own". */
export function effectiveVisibilityScope(cfg: Pick<OperationalConfig, "customerVisibility">): VisibilityScope {
  const v = cfg.customerVisibility;
  if (v.scope && !isUnset(v.scope)) return v.scope;
  return v.prototypeScope ?? "own";
}

// ---------------------------------------------------------------- AI och röstinspelning
/**
 * Är inspelningsflödet påslaget i avtalet? Kräver ai-avsnittet, flödet påslaget, kommunens godkännande (datum) och en
 * fastställd leverantör. Tål en äldre sparad konfiguration utan recording (ger false). Hanteraren kontrollerar dessutom
 * samtycke (coachen), att ärendet inte har skyddade personuppgifter och rollen.
 */
export function recordingEnabled(cfg: Pick<ContractConfig, "ai"> | null | undefined, kind: RecordingKind): boolean {
  const ai = cfg?.ai;
  const rec = ai?.recording as Partial<z.infer<typeof RecordingFlagsSchema>> | undefined;
  return !!ai && !!rec && rec[kind] === true && !!rec.approvedByCustomerOn && !isUnset(ai.provider);
}
/** Längsta inspelning i minuter för flödet, eller null om flödet inte är påslaget. */
export function recordingMaxMinutes(cfg: Pick<ContractConfig, "ai"> | null | undefined, kind: RecordingKind): number | null {
  if (!recordingEnabled(cfg, kind)) return null;
  return (cfg?.ai?.maxMinutes as Partial<Record<RecordingKind, number>> | undefined)?.[kind] ?? null;
}
/** Språken deltagaren kan spela in på (svenska först). Bara svenska om avtalet inte anger fler. */
export function aiLanguages(cfg: Pick<ContractConfig, "ai"> | null | undefined): string[] {
  const langs = (cfg?.ai?.languages as string[] | undefined) ?? [];
  return ["sv", ...langs.filter((l) => l !== "sv")];
}
/** Leverantören i klarspråk, "Ej fastställt" eller "–". */
export function aiProviderText(cfg: Pick<ContractConfig, "ai"> | null | undefined): string {
  const p = cfg?.ai?.provider;
  if (p == null) return "–";
  if (isUnset(p)) return UNSET_LABEL;
  return AI_PROVIDER_LABEL[p] ?? p;
}

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

// ---------------------------------------------------------------- Botkyrka (SPEC §6.2) – exakt prototypens CONFIG_BOT
// Tillägg: texts (prototypens CONTRACT_NOTES i admin.js, som var hårdkodade per avtal – CLAUDE.md punkt 4) och reportSchedule
// (rapportutkast som skapas automatiskt, beslut 2026-10-01 – samma regler och sista dagar som testdatats rapporter).
// Avvikelser från prototypen (beslut 2026-09-30, röstinspelning): ai-avsnittet har fastställd leverantör och inspelningsflödena
// (recording, maxMinutes, languages, participantLinkValidDays); customerVisibility.seesParticipantVoiceNotes = false.
// Avvikelse (beslut 2026-10-01, rapporter steg 2): progression.clearFromLevel/anyFromLevel (tal) ersätter fritexten
// statDefinition, och tydlig/någon progression räknas bara på de obligatoriska områdena.
// /*#__PURE__*/: konstanterna används bara av testdatat och servern. Utan markeringen följer de med i webbläsarens JS-paket
// (anropen kan ha sidoeffekter, så de får annars inte tas bort) – med priserna och de interna målen (beslut 2026-10-02).
export const BOTKYRKA_CONFIG: OperationalConfig = /*#__PURE__*/ deepFreeze(
  /*#__PURE__*/ OperationalConfigSchema.parse({
    casePrefix: "BOT",
    dataRole: "processor",
    thirdCountryProcessing: "forbidden_without_written_approval",
    orderChannels: ["email", "portal", "phone"],
    orderWeeks: { min: 4, max: 10, note: "Insatser på typiskt 4–10 veckor (utvärderingspriset byggde på 4 och 10 veckor)" },
    customerVisibility: { scope: "ATT_FASTSTÄLLA (own | unit | all)", prototypeScope: "own", seesIndividualReports: true, seesCoachNotes: false, seesSlaStats: false, seesParticipantVoiceNotes: false },
    reportDelivery: { channel: "portal", emailAttachmentAllowed: false },
    phases: [
      { no: 1, name: "Kartläggning" },
      { no: 2, name: "Yrkesförberedande grund" },
      { no: 3, name: "Yrkesspecifika moment" },
      { no: 4, name: "Praktik/APL" },
      { no: 5, name: "Matchning och slutrapport" },
    ],
    stuckRules: [{ phase: 1, maxDays: 10 }, { phase: 3, maxDays: 35, unlessPlacementPlanned: true }],
    progression: {
      scale: { "0": "Ingen / för tidigt att bedöma", "1": "Liten", "2": "Tydlig", "3": "Uppnått delmål" },
      areas: ["narvaro_rutiner", "yrkesfardigheter", "arbetskapacitet", "sjalvstandighet", "digital_sjalvstandighet", "instruktioner", "arbetsgivarkontakter", "beredskap", "sprak_kommunikation", "ovrigt"],
      optionalAreas: ["halsa_funktionellt", "livskvalitet_sjalvskattad"],
      areaLabels: {
        narvaro_rutiner: "Närvaro, punktlighet och rutiner",
        yrkesfardigheter: "Yrkesfärdigheter/praktisk förmåga",
        arbetskapacitet: "Arbetskapacitet och uthållighet",
        sjalvstandighet: "Självständighet och ansvarstagande",
        digital_sjalvstandighet: "Digital självständighet",
        instruktioner: "Förmåga att förstå och följa yrkesrelaterade instruktioner",
        arbetsgivarkontakter: "Arbetsgivarkontakter/nätverk",
        beredskap: "Beredskap för praktik, arbete eller studier",
        sprak_kommunikation: "Språk och kommunikation",
        ovrigt: "Övrig relevant progression",
        halsa_funktionellt: "Hälsa (funktionellt beskrivet)",
        livskvalitet_sjalvskattad: "Livskvalitet (deltagarens egen skattning)",
      },
      observationRequiredFromLevel: 1,
      // Beslut 2026-10-01: gränserna är tal (ersätter fritexten statDefinition "minst ett område på nivå >= 2" / ">= 1").
      clearFromLevel: 2,
      anyFromLevel: 1,
    },
    result: {
      definition: "ATT_FASTSTÄLLA",
      prototypeDefinition: "Preliminärt i prototypen: avslut till arbete eller studier som är verifierade räknas som resultat. Avbrott på grund av flytt eller kommunens beslut räknas inte i nämnaren.",
      countsAsResult: ["arbete", "studier"],
      excludedFromDenominator: "ATT_FASTSTÄLLA",
      prototypeExcluded: ["avbrott_flytt", "avbrott_kommunens_beslut"],
      requiresVerification: true,
    },
    kpis: [
      { key: "resultatgrad", label: "Resultatgrad (arbete eller studier)", windows: ["rolling_6m", "since_start"], contractTarget: 0.32, internalTarget: 0.35, minN: 10,
        notify: { belowInternal: ["chef", "controller"], belowContract: ["chef", "controller", "avtalsansvarig"] } },
      { key: "avrop_besvarade_i_tid", label: "Avrop besvarade inom en arbetsdag", windows: ["month"], internalTarget: 1.0 },
      { key: "forsta_mote_inom_en_vecka", label: "Första möte inom en vecka", windows: ["month"], internalTarget: 1.0 },
      { key: "veckorapporter_i_tid", label: "Veckorapporter i tid", windows: ["month"], internalTarget: 1.0 },
      { key: "manadsrapporter_i_tid", label: "Månadsrapporter i tid", windows: ["month"], internalTarget: 1.0 },
      { key: "narvarograd", label: "Närvarograd", windows: ["month"], internalTarget: "ATT_FASTSTÄLLA" },
      { key: "nojdhet", label: "Nöjdhet (andel 4–5)", windows: ["rolling_3m"], internalTarget: "ATT_FASTSTÄLLA" },
    ],
    sla: [
      { key: "ordererkannande", label: "Ordererkännande", from: "avrop_mottaget", within: { minutes: 5 }, automatic: true },
      { key: "avrop_svar", label: "Svar på avrop", from: "avrop_mottaget", within: { workingDays: 1 } },
      { key: "forsta_mote", label: "Första möte", from: "avrop_mottaget", within: { days: 7 } },
      { key: "veckorapport_registrering", label: "Närvaro registrerad", due: "måndag 10:00 för föregående vecka", weekday: 0, time: "10:00" },
      { key: "veckorapport_publicering", label: "Veckorapport publicerad", due: "måndag 16:00 för föregående vecka", weekday: 0, time: "16:00" },
      { key: "manadsrapport", label: "Månadsrapport", due: "ATT_FASTSTÄLLA (förslag: 5:e arbetsdagen efter månadsskiftet)", proposal: { nthWorkingDay: 5 } },
      { key: "slutrapport", label: "Slutrapport", from: "avslutsdatum", within: "ATT_FASTSTÄLLA (förslag: 5 arbetsdagar)", proposal: { workingDays: 5 } },
    ],
    attendance: { sameDayNoticeOnInvalidAbsence: "ATT_FASTSTÄLLA", repeatedAbsenceRule: { absentInvalid: 2, withinDays: 14 } },
    billing: {
      unit: "participant_week",
      billableWeekRule: "every_iso_week_with_at_least_one_enrolled_day_excluding_paused_weeks",
      flagZeroAttendanceWeeks: true,
      weekToMonthRule: "iso_thursday",
      invoicePer: "case_and_month",
      collectiveInvoiceAllowed: false,
      buyerReference: { required: true, pattern: "^[0-9]{8,10}$" },
      purchaseOrderNumber: { required: false, pattern: "^99[0-9]{7}$" },
      invoicedObject: "case_number",
      showAccruedAndRemaining: true,
      separatePeriodicFromOther: true,
      paymentTermsDays: 30,
      unbilledWarningDays: 45,
      format: "peppol_bis_3_via_fortnox",
      fallback: ["export_xlsx_pdf", "botkyrka_fakturaportal"],
    },
    bonus: { enabled: false, model: "ATT_FASTSTÄLLA enligt incitamentsmodellen", separateInvoice: true },
    pulse: { occasions: ["week2", "exit"], periodicEveryDays: 30, languages: ["sv", "en", "ar", "so"], minNForAggregate: 5 },
    statistics: { onRequestMaxPerYear: 2, free: true },
    termination: { returnDataWithinDays: 31, deleteAfterReturn: true },
    retention: "ATT_FASTSTÄLLA enligt PUB-avtalet",
    escalationLadder: [
      { step: 0, level: "mindre", text: "Mindre avvikelse – påverkar inte kärnverksamheten och kan åtgärdas enkelt och snabbt." },
      { step: 1, level: "större", text: "Större avvikelse – flera återkommande mindre avvikelser eller en avvikelse som kännbart påverkar kärnverksamheten. Skriftlig varning kan ges." },
      { step: 2, level: "allvarlig", text: "Allvarlig avvikelse – flera återkommande större avvikelser eller avbrott i kärnverksamheten. Skriftlig varning kan ges." },
      { step: 3, level: "allvarlig", text: "Upprepade allvarliga avvikelser. Skriftlig varning kan ges. Tre varningar kan leda till uppsägning." },
      { step: 4, level: "hävning", text: "Risk för hävning av avtalet." },
    ],
    warningsBeforeTermination: 3,
    penalties: { deviationOre: 2500000, insufficientInformationOre: 2500000 },
    economicDeviation: "Kostnader avviker från anbud, timmar stämmer inte med utfört uppdrag, fel pris eller fel/saknad information på fakturan.",
    keyPersonnelChangeRequiresApproval: true,
    // Beslut 2026-09-30 (SPEC §8.4, docs/PLAN-ROST.md): Gemini Flash via Vertex AI EU. Botkyrka har skriftligen godkänt inspelning
    // för coacher (2026-09-29) och för kommunens handläggare och deltagare (2026-09-30). Tills kontot i Google Cloud finns kör
    // testmiljön den simulerade leverantören (MM_AI_PROVIDER=simulated).
    ai: {
      provider: "vertex_eu",
      recordingApprovedByCustomer: "2026-09-29",
      recording: { coach: true, customer: true, participant: true, approvedByCustomerOn: "2026-09-30" },
      maxMinutes: { coach: 60, customer: 5, participant: 5 },
      languages: ["sv", "en", "ar", "so"],
      participantLinkValidDays: 7,
    },
    texts: {
      termination: "Uppsägning utan skäl tidigast två år efter start. Tre månaders uppsägningstid.",
      scope: "Minst 70 och upp till 100 årsplatser i tolv avtalsområden (A–L). Miljonbemanning är rangordnad 1 i alla områden.",
    },
    // Veckorapport (AFK: närvaro på deltagarnivå varje vecka), månadsrapport (mall 02) och beställarrapport (SPEC §7.11 e).
    // Månadsrapport bara för en månad med minst 11 inskrivna dagar (beslut 2026-10-01, samma regel som testdatat).
    // Beställarrapportens sista dag är inte fastställd med Botkyrka – förslaget är 8:e arbetsdagen kl. 16.00 (som testdatat).
    reportSchedule: {
      automatic: ["weekly_attendance", "monthly", "customer_summary"],
      monthly: { minEnrolledDays: 11 },
      customerSummaryDue: { nthWorkingDay: 8, time: "16:00" },
    },
  }),
);

// ---------------------------------------------------------------- Kammarkollegiet (SPEC §6.3, skiss) – prototypens CONFIG_KK
// Avvikelse från prototypen: priserna är i öre (priceOre: 412000) i stället för kronor (price: 4120).
// Tillägg: texts (prototypens CONTRACT_NOTES i admin.js).
// AI och röstinspelning är avstängda: avtalet saknar ai-avsnittet (recordingEnabled ger false för alla flöden).
// Tillägg: reportSchedule utan automatiska rapporter – kommunen ser inga individrapporter och KK:s månadsstatistik är en
// export (exports), inte en rapport per deltagare.
export const KK_CONFIG: ContractConfig = /*#__PURE__*/ deepFreeze(
  /*#__PURE__*/ ContractConfigSchema.parse({
    casePrefix: "KK",
    dataRole: "controller",
    customerVisibility: { seesIndividualReports: false, seesCoachNotes: false },
    priceItems: [
      { code: "startpaket", unit: "package", packageMonths: 4, priceOre: 412000 },
      { code: "forlangt_stod", unit: "month", priceOre: 120000 },
      { code: "forstarkt_stod", unit: "month", priceOre: 135000 },
      { code: "arbetstagarstod_startpaket", unit: "package", packageMonths: 4, priceOre: 408000 },
      { code: "csn_yttrande", unit: "each", priceOre: 69900 },
    ],
    kpis: [
      { key: "placeringsgrad", contractTarget: 0.6 },
      { key: "yttranden_i_tid", contractTarget: 0.8 },
      { key: "nojdhet", contractTarget: 0.7 },
    ],
    sla: [
      { key: "forsta_kontakt", from: "bestallning", within: { days: 5 } },
      { key: "forsta_mote", from: "bestallning", within: { days: 10 } },
    ],
    meetingMinimums: [
      { service: "startpaket", minMeetings: 4, minMinutesEach: 60, periodMonths: 4 },
      { service: "forlangt_stod", minMeetingsPerMonth: 1 },
    ],
    exports: [{ key: "kk_manadsstatistik", format: "xlsx", fieldsPerCustomer: 8 }],
    texts: {
      termination: "Enligt KK-avtalet – kontrolleras före start.",
      scope: "Rang 1 av 5 i kaskad. Beställningar som inte tas går vidare till nästa leverantör.",
    },
    reportSchedule: { automatic: [] },
  }),
);

// ---------------------------------------------------------------- Miljonbemannings interna regler (org_settings)
// Inte avtalskrav – styr notiser, påminnelser och eskalering. Prototypens S.orgConfig.
export const ESCALATION_ROLES = ["chef", "avtalsansvarig", "samordnare"] as const;
export type EscalationRole = (typeof ESCALATION_ROLES)[number];
/** Kanaler för personliga notiser: i appen och e-post (e-posten innehåller aldrig personuppgifter). */
export const APP_NOTIFY_CHANNELS = ["app", "email"] as const;
export type AppNotifyChannel = (typeof APP_NOTIFY_CHANNELS)[number];

const AppNotifyChannelSchema = z.enum(APP_NOTIFY_CHANNELS);
export const OrgSettingsSchema = z.strictObject({
  billing: z.strictObject({
    /** Internt mål: fakturor i Fortnox senast n:e arbetsdagen efter månadsskiftet. */
    fortnoxWithinWorkingDays: PosInt,
    internalGoal: z.boolean(),
  }),
  alerts: z.strictObject({
    /** Flagga när första mötet inte är bokat efter så här många dagar. */
    firstMeetingNotBookedAfterDays: PosInt,
    /** Klockslag då uppföljningar och åtgärdsplaner förfaller. */
    followUpDueTime: TimeSchema,
  }),
  notifications: z.strictObject({
    onAssignment: z.strictObject({
      to: z.array(z.enum(["lead_coach", "team"])).min(1),
      channels: z.array(AppNotifyChannelSchema).min(1),
      /** Låst: e-post innehåller aldrig personuppgifter (CLAUDE.md punkt 9). */
      emailContainsPersonalData: z.literal(false),
    }),
    progressionWatch: z
      .strictObject({
        internalRule: z.boolean(),
        noProgressSignals: z.array(z.enum(["weekly_goal_not_met", "no_approved_check_in"])),
        remindCoachAfterWeeks: PosInt,
        escalateAfterConsecutiveWeeks: PosInt,
        escalateTo: z.array(z.enum(ESCALATION_ROLES)).min(1),
        /** Låst: eskaleringen syns aldrig för coachen (styrs av behörigheten, inte av en inställning). */
        escalationVisibleToCoach: z.literal(false),
        reminderSchedule: z.string().min(1),
        channels: z.array(AppNotifyChannelSchema).min(1),
      })
      .refine((w) => w.escalateAfterConsecutiveWeeks > w.remindCoachAfterWeeks, {
        message: "Eskaleringen måste komma efter påminnelsen",
        path: ["escalateAfterConsecutiveWeeks"],
      }),
  }),
});
export type OrgSettings = z.infer<typeof OrgSettingsSchema>;
export const parseOrgSettings = (raw: unknown): OrgSettings => OrgSettingsSchema.parse(raw);

export const DEFAULT_ORG_SETTINGS: OrgSettings = deepFreeze(
  OrgSettingsSchema.parse({
    billing: { fortnoxWithinWorkingDays: 3, internalGoal: true },
    alerts: { firstMeetingNotBookedAfterDays: 3, followUpDueTime: "16:00" },
    notifications: {
      onAssignment: { to: ["lead_coach", "team"], channels: ["app", "email"], emailContainsPersonalData: false },
      progressionWatch: {
        internalRule: true,
        noProgressSignals: ["weekly_goal_not_met", "no_approved_check_in"],
        remindCoachAfterWeeks: 1,
        escalateAfterConsecutiveWeeks: 2,
        escalateTo: ["chef"],
        escalationVisibleToCoach: false,
        reminderSchedule: "måndag 08.00 för föregående vecka",
        channels: ["app", "email"],
      },
    },
  }),
);
