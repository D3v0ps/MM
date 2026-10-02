// Kontrakt för området kommun – kommunens portal (prototypens views/kommun.js). Importeras av skärmar – aldrig hanterarna.
//
// Portalen är skriven för ovana användare. Vy-modellerna innehåller bara det kommunen får se: aldrig interna mål,
// coachanteckningar, interna flaggor eller personnummer i klartext (bara maskerat – "Visa" är ett eget kommando som loggas).
// Kommunens chef ser deltagare med skyddade personuppgifter bara som ärendenummer och status (restricted).
//
// Delade kommandon som portalen använder finns i andra områden:
//   beställning        arenden.caseCreate (+ arenden.caseUpdate för beställarens kontaktuppgifter)
//   meddelanden        arenden.messageSend, arenden.messageRead (läskvitto, tyst)
//   rapporter          rapporter.dokument + PortalReport (rapportsidan), rapporter.reportOpen (kvittens, tyst)
//   visningslogg       session.auditView (case.view, tyst)
//
// Inloggningen (/portal/logga-in) går via AuthPort (useAuth i src/shell/session.tsx) och har inget eget kommando här.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import type { CaseSource, CaseStatus, ContractDeviationSource, ContractDeviationType, ReportKind, TaskKind } from "@/data/schema";
import type { ProgressionRuleText } from "@/core/config";
import { IdSchema, MonthKeySchema } from "../_shared/schemas";
import type { BuilderFileResult, BuilderView } from "../rapporter/api";

// ================================================================ Gemensamma delar
/** Ärendet så som kommunen ser det (lista och deltagarens sida). Texterna byggs av skärmen (texts.ts). */
export type KomCase = {
  id: string;
  caseNumber: string;
  status: CaseStatus;
  /** Deltagarens namn, eller "Skyddade personuppgifter" för kommunens chef. */
  name: string;
  protectedIdentity: boolean;
  /** Kommunens chef och skyddade personuppgifter: bara ärendenummer och status (inga personuppgifter, inga meddelanden). */
  restricted: boolean;
  /** "G Lager och logistik" (null = inte valt än). */
  primaryAreaName: string | null;
  secondaryAreaName: string | null;
  vocationalTrack: string;
  phase: number;
  /** Fasens namn i avtalet, t.ex. "Praktik/APL". */
  phaseName: string;
  source: CaseSource;
  referredAt: string;
  acknowledgedAt: string | null;
  confirmedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  firstMeetingAt: string | null;
  location: string;
  startDate: string | null;
  plannedStart: string | null;
  desiredStart: string | null;
  plannedEnd: string | null;
  endDate: string | null;
  /** "Arbete", "Avbrott: flytt" … (null = ingen avslutsorsak). */
  endReasonLabel: string | null;
  /** Besked om startdatum och coach senast (avtalets tidsgräns för svar på avrop). */
  avropDue: string | null;
  /** Första mötet senast (avtalets tidsgräns). */
  firstMeetingDue: string | null;
  referrerId: string | null;
  referrerName: string;
};

/** Rapport i portalen (levererad till läsaren). */
export type KomReportRow = {
  id: string;
  kind: ReportKind;
  /** "Månadsrapport januari 2027", "Veckorapport närvaro, vecka 4" … */
  title: string;
  /** "BOT-26-0143 · Nadia Warsame", "25 januari–31 januari · alla dina deltagare" … */
  sub: string;
  deliveredAt: string | null;
  version: number;
  openedAt: string | null;
  /** Levererad till läsaren och inte öppnad. */
  unread: boolean;
  /** Miljonbemanning rättar rapporten – den levererade versionen syns tills den nya är levererad. */
  correcting: boolean;
};

/** Uppgift från Miljonbemanning till handläggaren (t.ex. "Miljonbemanning behöver ditt beslut"). */
export type KomTask = {
  id: string;
  kind: TaskKind | null;
  caseId: string | null;
  caseNumber: string | null;
  text: string;
  createdAt: string;
};

/** Säkert meddelande i ärendet. */
export type KomMessage = {
  id: string;
  /** "Du", "Amira Haddad, Miljonbemanning", "Maria Ekdahl, Botkyrka kommun". */
  senderLabel: string;
  mine: boolean;
  /** Skickat av någon hos kommunen (svar på en mötesförfrågan). */
  fromCustomer: boolean;
  meeting: boolean;
  createdAt: string;
  body: string;
  /** Från någon annan och inte läst av den inloggade. */
  unread: boolean;
  /** Egna meddelanden: läst av mottagaren. */
  read: boolean;
  readAt: string | null;
};

// ================================================================ Startsidan (/portal, handläggaren)
export type KomEvent = {
  key: string;
  kind: "declined" | "coach" | "confirmed";
  at: string;
  caseId: string;
  /** Orderbekräftelsen öppnas som rapport. */
  reportId: string | null;
  title: string;
  sub: string;
};
export type KomUnreadMessage = { id: string; caseId: string; caseNumber: string; meeting: boolean; senderLabel: string; createdAt: string };
export type KomStart = {
  firstName: string;
  unit: string | null;
  customerName: string;
  tasks: KomTask[];
  /** Olästa händelser i handläggarens ärenden (avböjd beställning, ny coach, ny orderbekräftelse), senaste först. */
  events: KomEvent[];
  unreadMessages: KomUnreadMessage[];
  /** Olästa rapporter utom orderbekräftelser (de visas bland händelserna), senaste först. */
  unreadReports: KomReportRow[];
  /** Alla olästa rapporter (även orderbekräftelser) och meddelanden. */
  unreadTotal: number;
  active: number;
  waiting: number;
};
export const kommunStart = query("kommun.start", z.object({})).returns<KomStart>();

// ================================================================ Beställning (/portal/bestall)
export type KomOrderForm = {
  customerName: string;
  today: string;
  /** Förval: måndag om två veckor. */
  defaultStart: string;
  me: { name: string; unit: string; phone: string; email: string };
  /** Senast använda beställarreferens (annars enhetens sparade). */
  lastBuyerRef: string;
  /** Avtalets mönster för beställarreferensen (valideras direkt i formuläret och igen av arenden.caseCreate). */
  buyerReference: { required: boolean; pattern: string };
  /** Spärrade referenser som kommunens ekonomi inte känner igen. */
  blockedRefs: string[];
  weeks: { min: number; max: number };
  /** "en vecka" – avtalets tidsgräns för första mötet. */
  firstMeetingWithin: string;
  areas: { code: string; name: string }[];
  /** Förslag på yrkesspår per avtalsområde. */
  tracks: Record<string, string[]>;
  /** Pris per deltagarvecka i öre, exklusive moms. Saknas för begränsade testare i testmiljön (src/api/tester-access.ts). */
  prices?: { areaCode: string; validFrom: string; validTo: string | null; priceOre: number }[];
  /** Besked om startdatum och coach senast, om beställningen skickas nu. */
  answerDue: string | null;
};
export const kommunOrderForm = query("kommun.bestallning", z.object({})).returns<KomOrderForm>();

/** Pågående insats för samma person. caseId och caseNumber är null när insatsen är beställd av en annan handläggare. */
export type KomDuplicate = { caseId: string | null; caseNumber: string | null; status: CaseStatus | null };
/** Dubblettkontroll medan handläggaren skriver personnumret (numret skickas i anropet, aldrig i URL:en eller loggen). */
export const kommunDuplicate = query("kommun.dubblett", z.object({ pnr: z.string().max(20) })).returns<KomDuplicate[]>();

/** Kvittot efter skickad beställning: ordererkännandet och mejlet som skickades till handläggaren. */
export type KomReceipt = {
  caseId: string;
  caseNumber: string;
  protectedIdentity: boolean;
  referredAt: string;
  avropDue: string | null;
  firstMeetingDue: string | null;
  /** Ordererkännandets text (null vid skyddade personuppgifter – då skickas en generisk bekräftelse). */
  ackText: string | null;
  /** Mejlet till handläggaren (bara ärendenummer, eller generisk bekräftelse). */
  mail: { from: string; to: string; at: string; body: string } | null;
  /** Deltagarens kontaktväg ("SMS" …), null vid skyddade personuppgifter. */
  contactLabel: string | null;
};
export const kommunReceipt = query("kommun.kvitto", z.object({ caseId: IdSchema })).returns<KomReceipt | null>();

// ================================================================ Deltagare (/portal/deltagare)
export type KomCaseRow = KomCase & {
  /** Olästa meddelanden till handläggaren. */
  unread: number;
  /** Avböjd de senaste 30 dagarna (syns i standardfiltret). */
  recentlyDeclined: boolean;
};
export type KomCaseList = {
  chef: boolean;
  customerName: string;
  /** Kommunens chef: enheten ("Arbetsmarknadsenheten"). */
  unit: string | null;
  phaseCount: number;
  /** Avtalet har inte bestämt om handläggaren ser egna, enhetens eller alla deltagare. */
  scopeUnset: boolean;
  /** Olästa först, sedan status och senast beställda. */
  rows: KomCaseRow[];
};
export const kommunCaseList = query("kommun.deltagareLista", z.object({})).returns<KomCaseList>();

export type KomAttTile = {
  /** "februari hittills", "januari" */
  label: string;
  planned: number;
  present: number;
  late: number;
  absentValid: number;
  absentInvalid: number;
  unregistered: number;
  rate: number | null;
};
export type KomCaseDetail = {
  kind: "ok";
  chef: boolean;
  today: string;
  customerName: string;
  phaseCount: number;
  case: KomCase;
  /** Olästa rapporter till handläggaren (0 för chefen). */
  unreadReports: number;
  /** Händelser i ärendet (avböjd, ny coach) som handläggaren inte har sett – kommun.caseSeen när ärendet öppnas. */
  unseenEvents: number;
  tasks: KomTask[];
  /** null = kommunens chef och skyddade personuppgifter (meddelandena visas bara för handläggaren). */
  messages: KomMessage[] | null;
  /** Handläggaren som beställde skriver meddelanden. */
  canWrite: boolean;
  coachChanges: { at: string; fromName: string; toName: string }[];
  order: {
    coachName: string | null;
    weeks: number | null;
    /** Pris per vecka och beställningens värde. Saknas för begränsade testare i testmiljön (src/api/tester-access.ts). */
    priceOre?: number;
    valueOre?: number;
    buyerReference: string | null;
    team: { name: string; roleLabel: string }[];
    /** Levererad orderbekräftelse (öppnas som rapport). */
    ocReportId: string | null;
    /** Ordererkännandets text (när beställningen är ordererkänd). */
    ackText: string | null;
  };
  /** null = inte startat än. restricted = skyddade personuppgifter (kommunens chef). */
  attendance: { restricted: true } | { restricted: false; month: KomAttTile; prev: KomAttTile; repeated: { count: number; withinDays: number } | null } | null;
  /** null = skyddade personuppgifter (kommunens chef). */
  participant: { pnrMasked: string | null; canReveal: boolean; contactLabel: string | null; city: string; accessibilityNeeds: string } | null;
  /** Ett möjligt bonusanspråk (arbete påbörjat). Funktionen är avstängd tills modellen är bestämd. Alltid false för begränsade testare. */
  bonus: boolean;
  seesCoachNotes: boolean;
  reports: KomReportRow[];
};
export type KomCaseResult = KomCaseDetail | { kind: "not_found" } | { kind: "denied" };
export const kommunCase = query("kommun.deltagare", z.object({ caseId: IdSchema })).returns<KomCaseResult>();

// ================================================================ Rapporter och meddelanden (/portal/rapporter)
export type KomThread = {
  caseId: string;
  caseNumber: string;
  name: string;
  lastSender: string;
  lastAt: string;
  lastBody: string;
  meeting: boolean;
  unread: number;
  count: number;
};
export type KomReports = {
  chef: boolean;
  customerName: string;
  unit: string | null;
  /** Levererade till läsaren: olästa först, sedan senast levererade. */
  reports: KomReportRow[];
  /** Rapporter till läsaren som är på väg (veckorapport som väntar på närvaron, beställarrapport som är ett utkast). */
  coming: { id: string; title: string; dueAt: string | null }[];
  unreadMessages: number;
  /** Meddelanden per deltagare (handläggaren). Olästa först. */
  threads: KomThread[];
};
export const kommunReports = query("kommun.rapporter", z.object({})).returns<KomReports>();

// ================================================================ Beställarrapport (/portal/bestallarrapport, kommunens chef)
export type KomRate = { value: number | null; num: number; den: number; prelim: number; excluded: number; minN: number };
export type KomSummary = {
  month: string;
  active: number;
  started: number;
  closed: number;
  byArea: { code: string; name: string; active: number; started: number; closed: number }[];
  byTrack: { track: string; active: number }[];
  result: { rolling: KomRate; sinceStart: KomRate; month: KomRate };
  attendanceRate: number | null;
  attendance: { present: number; late: number; absentValid: number; absentInvalid: number };
  pulse: { enough: boolean; satisfaction: number | null; closer: number | null; responses: number; minN: number };
  progression: { assessed: number; clear: number; any: number; areaDist: { key: string; label: string; clear: number; n: number }[] };
  deviations: number;
  contractDeviations: number;
};
export type KomActionPlan = {
  id: string;
  type: ContractDeviationType;
  /** "Steg 0 · mindre avvikelse" eller nivån. */
  stepText: string;
  raisedAt: string;
  source: ContractDeviationSource;
  description: string;
  actionPlan: string;
  actionPlanDue: string | null;
};
export type KomChef = {
  customerName: string;
  /** Beställarrapporterna till chefen, äldst först. */
  months: { month: string; delivered: boolean }[];
  latestDelivered: string | null;
  /** Vald månad (standard: senast levererade). */
  month: string | null;
  /** Den valda rapporten när den är levererad. */
  report: { id: string; approvedByName: string; approvedAt: string | null; deliveredAt: string | null } | null;
  /** Den valda rapporten när den är ett utkast: senast levererad. */
  pending: { dueAt: string | null } | null;
  /** Rapportens frysta siffror (null för utkast). Grupper under minN redovisas som "färre än 5" av skärmen. */
  summary: KomSummary | null;
  /** Avtalets mål för resultatgraden (aldrig Miljonbemannings interna mål). */
  contractTarget: number;
  /** Minsta antal för att redovisa en grupp (pulse.minNForAggregate). */
  minN: number;
  pendingPlans: KomActionPlan[];
  approvedPlans: { id: string; description: string; actionPlan: string; approvedAt: string; closed: boolean }[];
  warnings: number;
  managerName: string;
  statisticsPerYear: number;
  /**
   * Avtalets regler för tydlig och någon progression i klarspråk (progressionRuleText), t.ex. "Minst ett område på nivå 2
   * eller högre". Räknas bara på de obligatoriska områdena; excluded säger vilka områden som inte räknas.
   */
  progressionRule: ProgressionRuleText;
};
export const kommunChef = query("kommun.chef", z.object({ month: MonthKeySchema.nullable().optional() })).returns<KomChef>();

// ================================================================ Hämta resultat (/portal/resultat, kommunens chef – rapporter steg 3)
// Resultaten från de levererade månadsrapporterna som en fil (Excel eller CSV) för kommunens egna sammanställningar.
// Bara kommunens chef, bara ärenden i chefens enhet och bara om avtalet tillåter individrapporter. Ärenden med skyddade
// personuppgifter kommer aldrig med. Fältbeskrivningen: docs/RESULTATFIL.md.

/** Förhandsvisning: antal rapporter och deltagare för perioden (inga namn, ingen loggning). */
export type ResultPreview = {
  /** Avtalet har resultatfilen (customerVisibility.seesIndividualReports). Annars är resten tomt. */
  allowed: boolean;
  contractId: string | null;
  /** Månaderna som kan väljas, senaste först: från avtalets start till innevarande månad. */
  months: { value: string; label: string }[];
  from: string;
  to: string;
  /** "oktober 2026 – december 2026" */
  periodLabel: string;
  /** Felet för perioden (samma regler som exporten), eller null. */
  periodError: string | null;
  /** Högst så här många månader i en fil. */
  maxMonths: number;
  participants: number;
  reports: number;
  /** Filnamnet för Excel (bara avtal och period). */
  xlsxFilename: string;
};
export const resultExportPreview = query("kommun.resultatForhandsvisning", z.object({ from: MonthKeySchema.optional(), to: MonthKeySchema.optional() })).returns<ResultPreview>();

export const RESULT_TABLES = ["resultat", "progression", "handelser", "avslut", "faltbeskrivning"] as const;
export type ResultTable = (typeof RESULT_TABLES)[number];
/**
 * Hämta resultatfilen. Ett kommando (inte en fråga) eftersom samma hanterare bygger filen och skriver revisionsloggen –
 * misslyckas loggningen lämnas ingen fil ut. Excel kommer som base64, CSV som text (en tabell per hämtning).
 */
export const resultExport = command("kommun.resultatExport", z.object({
  contractId: IdSchema,
  from: MonthKeySchema,
  to: MonthKeySchema,
  format: z.enum(["xlsx", "csv"]),
  table: z.enum(RESULT_TABLES).optional(),
})).returns<Result<{ filename: string; mime: string; encoding: "text" | "base64"; content: string; rows: number; cases: number }, "forbidden" | "period" | "empty" | "schema">>();

// ================================================================ Rapporter från Miljonbemanning (/portal/resultat/rapporter – rapporter steg 4)
// Rapporter som Miljonbemanning har byggt i rapportbyggaren och delat med kommunens chef. Chefen kan inte ändra något (inte
// urval, uppdelning eller period). Siffrorna räknas med chefens egen behörighet: bara ärenden i chefens enhet, aldrig skyddade
// personuppgifter, grupper med färre än N deltagare visas som "färre än N" och Miljonbemannings interna mål visas aldrig.
// Bara ett avtal i taget (samma som resultatfilen). Varje visning och varje hämtning loggas.
export type { BuilderView };

export type SharedReportRow = { id: string; title: string; outputLabel: string; datasetLabel: string; periodLabel: string; sharedAt: string | null };
export const sharedReports = query("kommun.delade", z.object({})).returns<{ allowed: boolean; reports: SharedReportRow[] }>();

/**
 * En delad rapport (tyst kommando – det fryser rapporter som saknar fakta och loggar visningen, saved_report.viewed). Skärmen
 * kör det en gång per sidvisning. error är en klarspråkstext när rapporten inte kan visas (found: false = finns inte längre).
 */
export type SharedReportView = { allowed: boolean; found: boolean; title: string; view: BuilderView | null; error: string | null };
export const sharedReport = command("kommun.delad", z.object({ savedReportId: IdSchema })).returns<SharedReportView>();

/** Hämta den delade rapporten (Excel, CSV eller PDF – PDF bara för sammanställningar). Loggas export.saved_report innan svaret. */
export const sharedReportExport = command("kommun.deladExport", z.object({
  savedReportId: IdSchema,
  format: z.enum(["xlsx", "csv", "pdf"]),
})).returns<Result<BuilderFileResult, "forbidden" | "not_found" | "period" | "empty" | "column_missing" | "too_many_groups" | "too_large" | "definition">>();

// ================================================================ Inloggningen (bara prototypens snabbval)
/**
 * E-postadresserna till testpersonerna som prototypens inloggning kan fylla i ("Fyll i Maria Ekdahl (handläggare)").
 * Används bara i prototypen (knapparna ligger i DemoNote). Läser via ctx.repo – bara användare som läsaren redan får se.
 * Kan tas bort när testpersonerna i sessionen (PersonaOption) har e-postadress.
 */
export const kommunTestPersonas = query("kommun.testpersoner", z.object({ userIds: z.array(IdSchema).max(5) })).returns<{ userId: string; email: string }[]>();

// ================================================================ Kommandon (prototypens kom.*)
/** Handläggaren har öppnat ärendet i portalen – händelser före den tiden räknas som lästa på startsidan (tyst). */
export const kommunCaseSeen = command("kommun.caseSeen", z.object({ caseId: IdSchema })).returns<Result<object, "not_found">>();

/** Handläggaren markerar en uppgift från Miljonbemanning som klar. */
export const kommunTaskDone = command("kommun.taskDone", z.object({ taskId: IdSchema })).returns<Result<object, "not_found" | "forbidden">>();

/** Kommunens chef godkänner en åtgärdsplan för en avtalsavvikelse. Avtalsansvarig får ett mejl utan personuppgifter. */
export const kommunApproveActionPlan = command("kommun.approveActionPlan", z.object({ id: IdSchema })).returns<
  Result<object, "not_found" | "already_approved">
>();

/** Visa hela personnumret (tyst). Bara beställande handläggare (kommunens åtkomst till ärendet). Visningen loggas (pnr.revealed). */
export const kommunRevealPnr = command("kommun.visaPersonnummer", z.object({ caseId: IdSchema })).returns<Result<{ pnr: string }, "not_found" | "forbidden" | "missing">>();

// ================================================================ "Tala in" (röstinspelning, docs/PLAN-ROST.md, flöde 2)
// Handläggaren talar in i stället för att skriva – vid beställningens bakgrund (/portal/bestall) och i meddelanden.
// Flödet: rost.uploadStart (purpose dictation) -> webbläsaren laddar upp ljudet (appen) -> kommun.dictationFinish
// (transkribering, ljudet raderas direkt) -> texten tillbaka till fältet. Handläggaren läser, rättar och skickar själv.
// Inget ljud sparas. Aldrig för skyddade personuppgifter.

/** Får handläggaren tala in här? caseId: ett ärende (meddelanden). Utan caseId: en ny beställning. */
export type DictationOptions = { enabled: boolean; maxMinutes: number; reason: string | null };
export const dictationOptions = query("kommun.dictationOptions", z.object({ caseId: IdSchema.optional(), protectedOrder: z.boolean().optional() })).returns<DictationOptions>();

/** Läget för en inspelning. text = den inlästa texten när transkriberingen är klar (bara till den som talade in). */
export type DictationState = { aiRunId: string; status: "running" | "succeeded" | "failed"; error: string | null; audioDeletedAt: string | null; text: string | null };
export const dictationFinish = command("kommun.dictationFinish", z.object({
  uploadId: IdSchema,
  durationSec: z.number().min(0).max(86_400).nullish(),
})).returns<Result<DictationState, "not_found" | "forbidden" | "disabled" | "protected" | "no_consent" | "link_missing" | "link_used" | "link_expired" | "audio_missing">>();
export const dictationState = query("kommun.dictationState", z.object({ aiRunId: IdSchema })).returns<DictationState | null>();
