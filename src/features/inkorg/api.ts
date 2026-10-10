// Kontrakt för området inkorg (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
import { z } from "zod";
import type { TodayGroupActivity } from "../aktiviteter/api";
import { command, query, type Result } from "@/api/contract";
import { NAV, LOG, CARD, CASES, PORTAL, REPORTS, MGMT, INBOX, BILLING, CASE_STATS } from "@/api/invalidation";
import type { SlaStatus } from "@/core/sla";
import { INBOUND_EMAIL_STATUSES, PREFERRED_CONTACTS, PRIOR_ASSESSMENTS, type EmailClassification, type ParseMethod } from "@/data/schema";
import type { IconName } from "@/ui/icons";
import { ORDER_REASON_MAX, type CaseBackground } from "@/features/arenden/api";
import { IdSchema, LocalDateSchema, LocalDateTimeSchema } from "../_shared/schemas";
import { ORDER_FIELDS, type DeadlineRow, type InboxMethod, type OrderFieldKey } from "./texts";

export type { DeadlineRow, InboxMethod, OrderFieldKey };

// ---- Delade kommandon (portade från prototypens 03-domain.js)
// Samma beteende och felkoder som prototypens MM.defineAction. Nyckeln är "inkorg.<prototypens namn>".

/** Sätt mejlets status, t.ex. "handled" (prototypens email.setStatus). caseId kopplar mejlet till ett ärende. */
export const emailSetStatus = command("inkorg.emailSetStatus", z.object({
  emailId: IdSchema,
  status: z.enum(INBOUND_EMAIL_STATUSES),
  caseId: IdSchema.optional(),
}), { invalidates: [INBOX, "arenden.lista", CARD, "coach.minVecka", MGMT, NAV, ...LOG] }).returns<Result<object, "not_found">>();

/**
 * För in en komplettering i ärendet (prototypens email.applySupplement): omfattning, slutdatum, motivering och
 * beställarreferens från kompletteringsmejlet. Det ursprungliga avropsmejlet får de tolkade uppgifterna och saknar dem inte längre.
 */
export const emailApplySupplement = command("inkorg.emailApplySupplement", z.object({
  emailId: IdSchema,
}), { invalidates: [INBOX, CASES, PORTAL, BILLING, REPORTS, MGMT, NAV, ...LOG] }).returns<Result<{ fields: string[] }, "not_found">>();

// ---- Området inkorg: samordnarens och avtalsansvarigs Min vecka (inkorg.start – /min-vecka, /start leder dit),
// avropsinkorgen (/inkorg/:emailId?) och förfaller (/forfaller)
// Vy-modellerna har bara de fält skärmarna behöver. Tider som visas relativt klockan ("i dag kl. 08.41") och SLA-status
// räknas i hanterarna. Personnummer skickas aldrig omaskerat – bara maskerat, och "Visa" går via inkorgRevealPnr (loggas).

/** SLA-status (slaStatus i src/core/sla), räknad i hanteraren. */
export type SlaView = Pick<SlaStatus, "label" | "tone">;
/** Förfallotid och tidpunkt då den uppfylldes, med status. */
export type SlaInfo = { dueAt: string; metAt: string | null; sla: SlaView };

/** En post i inkorgen: ett mejl till avrop@ eller en beställning i portalen/per telefon. */
export type InboxRow = {
  /** Mejlets id, eller "case:<caseId>" för beställningar utan mejl. */
  id: string;
  kind: "email" | "case";
  emailId: string | null;
  caseId: string | null;
  caseNumber: string | null;
  receivedAt: string;
  receivedWhen: string;
  from: string;
  subject: string;
  method: InboxMethod;
  cls: EmailClassification;
  /** Mejlets status eller beställningens (acknowledged, received, accepted, declined). */
  status: string;
  /** Väntar på hantering (fliken "Att hantera"). */
  pending: boolean;
  sla: SlaInfo | null;
  /** Uppgifter som saknas i avropet (etiketter i gemener), t.ex. ["omfattning"]. */
  missing: string[];
  /** Övrigt som ser ut som ett avbrott av en insats (avbrott via mejl, beslut 2026-10-09) – etiketten "Avbrott". */
  cancellation: boolean;
};
/** Sökväg till posten i inkorgen. */
export const inboxRowPath = (r: Pick<InboxRow, "emailId" | "caseId">): string =>
  r.emailId ? `/inkorg/${encodeURIComponent(r.emailId)}` : `/inkorg?arende=${encodeURIComponent(r.caseId ?? "")}`;

export type InboxList = {
  /** Alla poster, senaste först (fliken "Alla"). */
  rows: InboxRow[];
  /** Id:n i fliken "Att hantera", mest brådskande först (samma lista och tal som menyn och startsidan). */
  pending: string[];
  /** Id:n i fliken "Hanterade", senast hanterade först. */
  handled: string[];
  /** Ordererkännande inom så här många minuter (avtalskonfigurationen). */
  ackMinutes: number;
  /** "en arbetsdag" – svarstiden på avrop. */
  answerText: string;
};
export const inboxList = query("inkorg.list", z.object({})).returns<InboxList>();

/** Maskerat personnummer för ett ärende. hidden = rollen får inte se numret. caseId = för "Visa" (inkorgRevealPnr). */
export type PnrView = { caseId: string | null; masked: string | null; hidden: boolean };
export type FieldNote =
  | { kind: "missing" }
  | { kind: "corrected" | "checked" | "supplement"; title: string }
  | { kind: "low" | "pct"; pct: string };
export type FormField = { key: string; label: string; value: string | null; pnr?: PnrView; state: "ok" | "low" | "missing"; note: FieldNote | null };
export type FieldGroup = { title: string; fields: FormField[] };

export type OriginalView = {
  emailId: string;
  fromName: string;
  fromAddress: string;
  receivedLong: string;
  subject: string;
  /** Mejltexten med personnummer maskerade. */
  body: string;
  hasPnr: boolean;
  /** Rollen får visa personnumret (full åtkomst, eller inget ärende). */
  mayReveal: boolean;
  attachments: string[];
};
export type ParsedView = { method: ParseMethod; help: string; nMissing: number; nLow: number; aiRun: string | null; groups: FieldGroup[] };
/** Beställningens uppgifter när de inte kommer ur en tolkning: portalen, telefon eller registrerad av Miljonbemanning (beslut 4a). */
export type CaseFieldsView = { title: string; method: "portal" | "phone" | "registered"; groups: FieldGroup[] };
export type AckView =
  | { kind: "none"; text: string }
  /** registered = ordererkännandet skickades när Miljonbemanning registrerade beställningen (inte inom minuterna från mottagandet). */
  | { kind: "sent"; generic: boolean; ok: boolean; mins: number; limit: number; when: string; to: string; body: string; leak: boolean; registered?: boolean };
export type DuplicateView = { dups: { caseId: string; caseNumber: string; status: string }[] };
export type DeclinedView = { when: string; by: string | null; reason: string; mail: string | null };
export type CorrectForm = {
  caseId: string;
  emailId: string | null;
  /** Formulärets startvärden (planerat slutdatum från mejlet om ärendet saknar det). */
  init: Record<OrderFieldKey, string>;
  /** Ärendets nuvarande värden – det som ändras skickas i patch. */
  current: Record<OrderFieldKey, string>;
  /** " AI var osäker (64 %) – kontrollera mot originalet." per fält. */
  lowNotes: Partial<Record<OrderFieldKey, string>>;
  /** Omfattningarna i avtalet (orderPeriods): månader och om annan tidsperiod går att välja. */
  periods: { months: number[]; allowOther: boolean };
  refPattern: string;
  refLen: string;
};
export type ItemCase = { id: string; number: string; referrerId: string | null; leadCoachId: string | null; status: string };
export type PendingSupplement = { id: string; fromName: string; when: string };

export type OrderBodyView = {
  kind: "order";
  /** Ett inläst avrop som inte kunde bli ett ärende automatiskt: registreras för hand (länk till formuläret, beslut 4a). */
  register: { emailId: string; reason: string } | null;
  decided: boolean;
  declined: DeclinedView | null;
  pendingSups: PendingSupplement[];
  missing: { title: string; critical: boolean; text: string } | null;
  refProblem: string | null;
  original: OriginalView | null;
  parsed: ParsedView | null;
  caseFields: CaseFieldsView | null;
  ack: AckView;
  dup: DuplicateView | null;
};
export type SupplementBodyView =
  | { kind: "supplement"; linked: false }
  | {
      kind: "supplement";
      linked: true;
      caseNumber: string;
      applied: boolean;
      appliedText: string | null;
      canAccept: boolean;
      origEmailId: string | null;
      rows: { key: string; label: string; now: string | null; next: string | null; low: boolean; pct: string }[];
      refErr: string | null;
      original: OriginalView;
      caseCard: { caseId: string; caseNumber: string; status: string; displayName: string; areaName: string; buyerReference: string | null; sla: SlaInfo | null };
    };
export type OtherBodyView = {
  kind: "other";
  caseNumber: string | null;
  /** Mejlet ser ut att gälla ett avbrott av en insats (parse.ts looksLikeCancellation). */
  cancellation: boolean;
  original: OriginalView;
  caseCard: { caseId: string; caseNumber: string; displayName: string; coachName: string; status: string; phase: string } | null;
  custMsgs: { id: string; sender: string; when: string; unread: boolean; body: string }[];
  draft: string;
  lastReply: { when: string; body: string } | null;
  replyMail: string | null;
  handled: boolean;
  handledText: string | null;
};

export type InboxItemDetail = {
  id: string;
  kind: "email" | "case";
  cls: EmailClassification;
  status: string;
  method: InboxMethod;
  subject: string;
  from: string;
  fromAddress: string | null;
  receivedWhen: string;
  case: ItemCase | null;
  /** SLA i huvudet med texten ovanför ("Svar på avropet", "Svar senast i dag kl. 10.05", "Besvarat i dag kl. 09.15"). */
  headSla: (SlaInfo & { text: string }) | null;
  handledText: string | null;
  steps: string[] | null;
  current: number;
  /** Avropet väntar på beslut (acceptera eller avböj). */
  decision: boolean;
  managerName: string;
  correct: CorrectForm | null;
  body: OrderBodyView | SupplementBodyView | OtherBodyView;
};
export const inboxItem = query("inkorg.item", z.object({ id: z.string().min(1).max(160) })).returns<InboxItemDetail | null>();

/** Orderbekräftelsen efter att avropet accepterats (kortet "Orderbekräftelse skickad"). */
export type ConfirmationView = {
  caseId: string;
  caseNumber: string;
  referrerId: string | null;
  leadCoachId: string | null;
  /** Orderbekräftelsens id om rollen kan öppna rapporten. */
  reportId: string | null;
  confirmed: string;
  coachName: string;
  team: string;
  firstMeeting: string;
  planned: string;
  buyerReference: string;
  leadNotif: { title: string; emailBody: string; others: string } | null;
  custMail: string | null;
  kallelse: { title: string; icon: IconName; body: string } | null;
};
export const inboxConfirmation = query("inkorg.confirmation", z.object({ caseId: IdSchema })).returns<ConfirmationView | null>();

/** Underlag för dialogerna Acceptera och Avböj. */
export type DecisionForm = {
  caseId: string;
  caseNumber: string;
  from: string;
  areaName: string;
  displayName: string;
  avropSla: SlaInfo | null;
  coaches: { id: string; name: string; active: number }[];
  /**
   * Arbetsgivarmatchare och SYV/metodstöd kan vara vem som helst av MB-personalen utom ekonom och systemadministratör.
   * Teamvalet Handledare finns inte (rollen handledare borttagen, Karims beslut 2026-10-09).
   */
  staff: { id: string; name: string }[];
  firstMeetingDue: string | null;
  desiredStart: string | null;
  /** Beställarreferensen om kommunen har angett en (valfri vid accept – beslut 2026-10-07). */
  buyerReference: string | null;
  referredAt: string;
  today: string;
  defaultDate: string;
  meetingText: string;
  refPattern: string;
  refLen: string;
  /** Avtalsområde och yrkesspår (synpunkt #8): Miljonbemanning väljer vid accept. */
  areas: { value: string; label: string }[];
  primaryArea: string | null;
  secondaryArea: string | null;
  vocationalTrack: string;
  /** Yrkesspår som förslag per avtalsområde (koden). Yrkesspåret är fritext. */
  tracks: Record<string, string[]>;
  /** Omfattningen ur beställningen (förifylld) och avtalets alternativ. */
  periods: { months: number[]; allowOther: boolean };
  orderPeriodMonths: number | null;
  orderPeriodReason: string | null;
  plannedEnd: string | null;
  /** Äldre beställning i veckor (före 2026-10-07). */
  plannedWeeks: number | null;
  /** Handläggarens bakgrundsinformation och bilagorna (underlag för beslutet). */
  background: CaseBackground;
  pendingSup: PendingSupplement | null;
  declined: number;
  total: number;
};
export const inboxDecisionForm = query("inkorg.decisionForm", z.object({ caseId: IdSchema })).returns<DecisionForm | null>();


/** Har personen redan en pågående insats i avtalet? Svaret är bara ja eller nej (sökhash, aldrig klartext). */
export const inboxDuplicateCheck = query("inkorg.duplicateCheck", z.object({ pnr: z.string().max(20) })).returns<{ duplicate: boolean }>();

// ---------------------------------------------------------------- Registrera beställning (beslut 4a, 2026-10-08)
// Samordnaren eller avtalsansvarig registrerar ett avrop som kom med mejl, telefon eller på annat sätt: samma fält som
// kommunens formulär plus hur och när det kom och kommunens handläggare. Ingen profil skapas för handläggaren – uppgifterna
// sparas på ärendet tills hen skapar konto själv (då kopplas ärendet via e-postadressen). Ett inläst mejl utan ärende
// (emailId) förifyller formuläret ur tolkningen; personnumret ur mejlet lämnas aldrig ut – det används när fältet lämnas tomt.
export const REGISTER_CHANNELS = ["email", "phone", "other"] as const;
export type RegisterChannel = (typeof REGISTER_CHANNELS)[number];

export type RegisterHandler = { id: string; name: string; email: string; unit: string; phone: string };
export type RegisterPrefill = {
  referrerName: string; referrerEmail: string; referrerUnit: string; referrerPhone: string;
  desiredStart: string; orderPeriod: string; plannedEnd: string; orderPeriodReason: string; buyerReference: string;
  firstName: string; lastName: string; phone: string; email: string; city: string; preferredContact: string; priorAssessment: string; background: string;
  /** Yrkesområdet ur mejlet (avtalsområdets kod), tomt när det saknas eller inte är ett aktivt avtalsområde (beslut 2026-10-09). */
  primaryArea: string;
  /** Personnumret finns i mejlet (maskerat) – lämnas fältet tomt används det. */
  pnrMasked: string | null;
};
export type RegisterForm = {
  today: string;
  /** Nu ("YYYY-MM-DDTHH:mm") – förval för mottagen tid. */
  now: string;
  periods: { months: number[]; allowOther: boolean };
  refPattern: string;
  refLen: string;
  attachments: { maxBytes: number; maxFiles: number; accept: string; typesText: string };
  customerName: string;
  /** Kommunens e-postdomäner (handläggarens adress måste ha en av dem). */
  customerDomains: string[];
  /** Kommunens handläggare med konto (att välja i stället för att skriva uppgifterna). */
  handlers: RegisterHandler[];
  /** Avtalets aktiva avtalsområden – yrkesområdet att välja (samma lista som kommunens formulär och Acceptera). */
  areas: { value: string; label: string }[];
  /** "en arbetsdag" – svarstiden räknas från mottagandet. */
  answerText: string;
  /** Mejlet som registreras (förifyllning), eller null vid telefon/annat. */
  email: { id: string; subject: string; from: string; fromAddress: string; receivedAt: string; receivedLong: string; attachments: number; prefill: RegisterPrefill } | null;
};
export const inboxRegisterForm = query("inkorg.registerForm", z.object({ emailId: IdSchema.optional() })).returns<RegisterForm>();

/**
 * Registrera beställningen: rad i inbound_emails (parse_method manual, registered_by/at – eller det inlästa mejlet uppdateras),
 * person och ärende (samma regler som arenden.caseCreate), ordererkännande till handläggaren, bilagor kopplas. Loggas
 * email.registered och case.created. Svaret har bara id:n och ärendenumret.
 */
export const inboxRegister = command("inkorg.register", z.object({
  channel: z.enum(REGISTER_CHANNELS),
  receivedAt: LocalDateTimeSchema,
  /** Det inlästa mejlet som registreras (kanalen är då mejl). */
  emailId: IdSchema.optional(),
  /** Kommunens handläggare med konto – annars uppgifterna nedan. */
  referrerId: IdSchema.nullable().optional(),
  referrerName: z.string().trim().max(120),
  referrerEmail: z.string().trim().max(200),
  referrerUnit: z.string().trim().max(120),
  referrerPhone: z.string().trim().max(40),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  /** Tomt med emailId = personnumret ur mejlet. */
  pnr: z.string().max(20),
  phone: z.string().max(40),
  email: z.string().max(200),
  city: z.string().max(100),
  address: z.string().max(300).nullable().optional(),
  preferredContact: z.enum(PREFERRED_CONTACTS),
  /**
   * Yrkesområdet (avtalsområdets kod, beslut 2026-10-09). Ett aktivt avtalsområde i avtalet, eller "" = inte angivet.
   * Utelämnat med emailId = yrkesområdet ur mejlet (som personnumret), om det är ett aktivt avtalsområde.
   */
  primaryArea: z.string().trim().max(10).optional(),
  desiredStart: LocalDateSchema.nullable(),
  orderPeriodMonths: z.number().int().min(1).max(60).nullable(),
  plannedEnd: LocalDateSchema.nullable(),
  orderPeriodReason: z.string().max(ORDER_REASON_MAX).nullable(),
  priorAssessment: z.enum(PRIOR_ASSESSMENTS).nullable(),
  background: z.string().max(4000),
  buyerReference: z.string().max(40),
  attachmentIds: z.array(IdSchema).max(10),
}), { invalidates: [CASES, INBOX, PORTAL, "coach.casePicker", "coach.minVecka", MGMT, BILLING, REPORTS, ...CASE_STATS, NAV, ...LOG] }).returns<
  Result<{ caseId: string; caseNumber: string; emailId: string }, "received_at" | "email" | "referrer" | "pnr" | "area" | "buyer_ref" | "order_period" | "duplicate" | "attachments" | "no_contract" | "not_found">
>();

// ---------------------------------------------------------------- Startsidan
export type MiniDeadline = { id: string; kind: string; label: string; sub: string | null; dueAt: string; sla: SlaView; href: string | null; provisional: boolean; count: number | null };
export type AlertView = { key: string; severity: "critical" | "warning" | "info"; title: string; text: string; when: string; phase: number | null; href: string | null };
export type KpiCardView = {
  key: string;
  label: string;
  value: string;
  /** Under Miljonbemannings interna mål. Alltid false för begränsade testare (det interna målet visas inte). */
  below: boolean;
  sub: string;
  /** target = internt mål (null för begränsade testare och när målet inte är fastställt). */
  meter: { value: number; valueText: string; target: number | null; targetText: string } | null;
  late: { caseId: string; caseNumber: string }[];
};
export type StartView = {
  /** "God morgon, Sara! Måndag 1 februari, v. 5. Det mest brådskande står först." */
  lead: string;
  items: InboxRow[];
  /** Mest brådskande avrop (svarstid som inte är uppfylld). */
  urgent: InboxRow | null;
  firstMeetings: {
    rows: { caseId: string; caseNumber: string; due: SlaInfo | null; sub: string; coachName: string; dueText: string }[];
    flagged: number;
  };
  /** soon = försenat och i dag, week = de tre första denna vecka (sammanslagna); weekGrouped = antal rader denna vecka efter sammanslagning. */
  deadlines: { soon: MiniDeadline[]; week: MiniDeadline[]; weekGrouped: number; soonCount: number; overdue: number; weekCount: number };
  alerts: AlertView[];
  acked: { key: string; title: string; text: string }[];
  notifyEmail: boolean;
  kpis: KpiCardView[];
  assign: { quote: string; latest: { id: string; name: string; caseNumber: string; when: string }[] };
  noCoach: { caseId: string; caseNumber: string; sla: SlaInfo | null; sub: string }[];
  /** Insatser att starta (beslut 2026-10-08): bekräftade ärenden vars första möte är i dag eller har passerat. */
  toStart: { caseId: string; caseNumber: string; firstMeetingAt: string; coachName: string; sub: string }[];
  /** Dagens gruppaktiviteter i avtalet (coachmötet 2026-10-09) med länk till aktivitetsvyn. */
  groupsToday: TodayGroupActivity[];
  /** Klockan nu (dagens gruppaktiviteter: passerade visar närvaron). */
  now: string;
  tasks: { id: string; text: string; sub: string; emailId: string | null; caseId: string | null }[];
  deviations: { id: string; description: string; sub: string; due: SlaInfo | null; href: string | null }[];
  deviationsHref: string | null;
  summaryReport: { id: string; title: string; due: SlaInfo | null; href: string | null } | null;
  warnings: { issued: number; max: number; text: string };
  meetingText: string;
  flagDaysText: string;
  /** Dagens datum (för bokning av första möte). */
  today: string;
};
export const inboxStart = query("inkorg.start", z.object({})).returns<StartView>();

// ---------------------------------------------------------------- Förfaller
export type DeadlinesView = {
  /** "måndag 1 februari · v. 5" */
  eyebrow: string;
  /** "måndag 1 februari" (dagens datum). */
  today: string;
  rows: DeadlineRow[];
  /** Sökväg till rapportlistan om rollen kan öppna den (sammanslagna månadsrapporter). */
  reportsHref: string | null;
  /** Regler som inte är fastställda: "månadsrapport – förslag: 5:e arbetsdagen …; slutrapport – förslag: 5 arbetsdagar". */
  unsetText: string | null;
};
export const inboxDeadlines = query("inkorg.deadlines", z.object({})).returns<DeadlinesView>();

// ---------------------------------------------------------------- Områdets egna kommandon (prototypens ink.*)

/**
 * Rätta eller bekräfta tolkade beställningsuppgifter (prototypens ink.correct). patch = ändrade fält, checked = fält som
 * markeras som kontrollerade. Mejlets tolkning får "Rättad" eller "Kontrollerad" med namn och tid.
 */
export const inboxCorrect = command("inkorg.correct", z.object({
  caseId: IdSchema,
  emailId: IdSchema.nullable().optional(),
  patch: z.strictObject({
    desiredStart: z.union([LocalDateSchema, z.literal("")]).nullable(),
    /** Omfattningen: antal månader ur avtalet ("6", "12"), "annan" eller "". */
    orderPeriod: z.string().regex(/^(\d{1,2}|annan)?$/).nullable(),
    plannedEnd: z.union([LocalDateSchema, z.literal("")]).nullable(),
    orderPeriodReason: z.string().max(500).nullable(),
    buyerReference: z.string().max(40).nullable(),
  }).partial(),
  checked: z.array(z.enum(ORDER_FIELDS)).max(ORDER_FIELDS.length),
}), { invalidates: [INBOX, CASES, PORTAL, BILLING, REPORTS, MGMT, NAV, ...LOG] }).returns<Result<{ changed: string[] }, "not_found" | "buyer_ref" | "forbidden" | "order_period">>();

/** Markera en uppgift till rollen som klar (prototypens ink.taskDone). */
export const inboxTaskDone = command("inkorg.taskDone", z.object({ taskId: IdSchema }), { invalidates: ["inkorg.start", "kommun.start", "kommun.deltagare", "ekonomi.start", "arenden.kortManad", ...LOG] }).returns<Result<object, "not_found">>();

/**
 * Visa personnummer (tyst, loggas som pnr.revealed i revisionsloggen): i mejltexten (emailId) eller för ärendets person (caseId).
 * Returnerar texten respektive numret. Aldrig för skyddade personuppgifter om rollen inte har full åtkomst.
 */
export const inboxRevealPnr = command("inkorg.revealPnr", z.object({
  emailId: IdSchema.optional(),
  caseId: IdSchema.optional(),
}), { invalidates: "none" }).returns<Result<{ text: string }, "not_found" | "forbidden">>();
