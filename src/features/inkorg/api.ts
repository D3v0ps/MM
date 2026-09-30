// Kontrakt för området inkorg (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import type { SlaStatus } from "@/core/sla";
import { INBOUND_EMAIL_STATUSES, type EmailClassification, type ParseMethod } from "@/data/schema";
import type { IconName } from "@/ui/icons";
import { IdSchema, LocalDateSchema } from "../_shared/schemas";
import { ORDER_FIELDS, type DeadlineRow, type InboxMethod, type OrderFieldKey } from "./texts";

export type { DeadlineRow, InboxMethod, OrderFieldKey };

// ---- Delade kommandon (portade från prototypens 03-domain.js)
// Samma beteende och felkoder som prototypens MM.defineAction. Nyckeln är "inkorg.<prototypens namn>".

/** Sätt mejlets status, t.ex. "handled" (prototypens email.setStatus). caseId kopplar mejlet till ett ärende. */
export const emailSetStatus = command("inkorg.emailSetStatus", z.object({
  emailId: IdSchema,
  status: z.enum(INBOUND_EMAIL_STATUSES),
  caseId: IdSchema.optional(),
})).returns<Result<object, "not_found">>();

/**
 * För in en komplettering i ärendet (prototypens email.applySupplement): beställarreferens och planerat slut från
 * kompletteringsmejlet. Det ursprungliga avropsmejlet får de tolkade uppgifterna och saknar dem inte längre.
 */
export const emailApplySupplement = command("inkorg.emailApplySupplement", z.object({
  emailId: IdSchema,
})).returns<Result<{ fields: string[] }, "not_found">>();

// ---- Området inkorg: startsidan (/start), avropsinkorgen (/inkorg/:emailId?) och förfaller (/forfaller)
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
  /** Skyddade personuppgifter – hanteras av avtalsansvarig. */
  isProtected: boolean;
  /** Uppgifter som saknas i avropet (etiketter i gemener), t.ex. ["beställarreferens", "planerat slutdatum"]. */
  missing: string[];
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
export type CaseFieldsView = { title: string; method: "portal" | "phone"; groups: FieldGroup[] };
export type AckView =
  | { kind: "none"; text: string }
  | { kind: "sent"; generic: boolean; ok: boolean; mins: number; limit: number; when: string; to: string; body: string; leak: boolean };
export type DuplicateView = { dups: { caseId: string; caseNumber: string; status: string }[] };
export type DeclinedView = { when: string; by: string | null; reason: string; mail: string | null };
export type CorrectForm = {
  caseId: string;
  emailId: string | null;
  init: Record<OrderFieldKey, string>;
  /** " AI var osäker (64 %) – kontrollera mot originalet." per fält. */
  lowNotes: Partial<Record<OrderFieldKey, string>>;
  areas: { value: string; label: string }[];
  refPattern: string;
  refLen: string;
};
export type ItemCase = { id: string; number: string; referrerId: string | null; leadCoachId: string | null; status: string };
export type PendingSupplement = { id: string; fromName: string; when: string };

export type OrderBodyView = {
  kind: "order";
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
  original: OriginalView;
  caseCard: { caseId: string; caseNumber: string; displayName: string; coachName: string; status: string; phase: string } | null;
  custMsgs: { id: string; sender: string; when: string; unread: boolean; body: string }[];
  draft: string;
  lastReply: { when: string; body: string } | null;
  replyMail: string | null;
  handled: boolean;
  handledText: string | null;
};
export type ProtectedBodyView = {
  kind: "protected";
  decided: boolean;
  declined: DeclinedView | null;
  original: OriginalView;
  timeline: { icon: IconName; filled: boolean; tone?: "red"; title: string; sub: string }[];
  ack: AckView;
  caseFields: CaseFieldsView | null;
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
  isProtected: boolean;
  /** Rollen hanterar posten (skyddade avrop: bara avtalsansvarig). */
  mine: boolean;
  /** Avropet väntar på beslut (acceptera eller avböj). */
  decision: boolean;
  /** Rollen kan registrera efter telefonsamtal (skyddat avrop utan ärende). */
  canPhone: boolean;
  managerName: string;
  correct: CorrectForm | null;
  body: OrderBodyView | SupplementBodyView | OtherBodyView | ProtectedBodyView;
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
  value: string;
  buyerReference: string;
  leadNotif: { title: string; emailBody: string; others: string } | null;
  custMail: string | null;
  isProtected: boolean;
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
  isProtected: boolean;
  coaches: { id: string; name: string; active: number }[];
  helpers: { id: string; name: string; teamRole: "vocational_supervisor" | "employer_matcher" | "guidance_counselor"; label: string }[];
  firstMeetingDue: string | null;
  desiredStart: string | null;
  plannedWeeks: number | null;
  buyerReference: string | null;
  referredAt: string;
  today: string;
  defaultDate: string;
  meetingText: string;
  refPattern: string;
  refLen: string;
  prices: { validFrom: string; validTo: string | null; priceOre: number; exampleOnly: boolean }[];
  pendingSup: PendingSupplement | null;
  declined: number;
  total: number;
};
export const inboxDecisionForm = query("inkorg.decisionForm", z.object({ caseId: IdSchema })).returns<DecisionForm | null>();

/** Underlag för registrering efter telefonsamtal (skyddat avrop). */
export type PhoneForm = {
  emailId: string;
  referrerId: string | null;
  referrerName: string | null;
  unit: string | null;
  brReference: string | null;
  phone: string;
  areas: { value: string; label: string }[];
  nextCaseNumber: string;
  refPattern: string;
  refLen: string;
};
export const inboxPhoneForm = query("inkorg.phoneForm", z.object({ emailId: IdSchema })).returns<PhoneForm | null>();

/** Har personen redan en pågående insats i avtalet? Svaret är bara ja eller nej (sökhash, aldrig klartext). */
export const inboxDuplicateCheck = query("inkorg.duplicateCheck", z.object({ pnr: z.string().max(20) })).returns<{ duplicate: boolean }>();

// ---------------------------------------------------------------- Startsidan
export type MiniDeadline = { id: string; kind: string; label: string; sub: string | null; dueAt: string; sla: SlaView; href: string | null; provisional: boolean; count: number | null };
export type AlertView = { key: string; severity: "critical" | "warning" | "info"; title: string; text: string; when: string; phase: number | null; href: string | null };
export type KpiCardView = {
  key: string;
  label: string;
  value: string;
  below: boolean;
  sub: string;
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
    rows: { caseId: string; caseNumber: string; due: SlaInfo | null; sub: string; isProtected: boolean; coachName: string; dueText: string }[];
    flagged: number;
  };
  deadlines: { soon: MiniDeadline[]; week: MiniDeadline[]; soonCount: number; overdue: number; weekCount: number };
  alerts: AlertView[];
  acked: { key: string; title: string; text: string }[];
  protectedItems: (InboxRow & { caseText: string })[];
  notifyEmail: boolean;
  kpis: KpiCardView[];
  assign: { quote: string; latest: { id: string; name: string; caseNumber: string; when: string }[] };
  noCoach: { caseId: string; caseNumber: string; sla: SlaInfo | null; sub: string }[];
  tasks: { id: string; text: string; sub: string; emailId: string | null; caseId: string | null }[];
  deviations: { id: string; description: string; sub: string; due: SlaInfo | null; href: string | null }[];
  deviationsHref: string | null;
  summaryReport: { id: string; title: string; due: SlaInfo | null; href: string | null } | null;
  warnings: { issued: number; max: number; text: string };
  meetingText: string;
  flagDaysText: string;
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
    buyerReference: z.string().max(40).nullable(),
    desiredStart: z.union([LocalDateSchema, z.literal("")]).nullable(),
    plannedEnd: z.union([LocalDateSchema, z.literal("")]).nullable(),
    plannedWeeks: z.number().int().min(1).max(52).nullable(),
    primaryArea: z.string().max(10).nullable(),
    secondaryArea: z.string().max(10).nullable(),
    vocationalTrack: z.string().max(200).nullable(),
  }).partial(),
  checked: z.array(z.enum(ORDER_FIELDS)).max(ORDER_FIELDS.length),
})).returns<Result<{ changed: string[] }, "not_found" | "buyer_ref" | "forbidden">>();

/**
 * Koppla mejlet med skyddade personuppgifter till ärendet som registrerats efter telefonsamtal (prototypens ink.linkPhoneOrder).
 * SLA räknas från mejlets mottagning. Uppgifterna om mejlet och det skyddade ärendet markeras som klara.
 */
export const inboxLinkPhoneOrder = command("inkorg.linkPhoneOrder", z.object({
  emailId: IdSchema,
  caseId: IdSchema,
})).returns<Result<object, "not_found" | "forbidden">>();

/** Markera en uppgift till rollen som klar (prototypens ink.taskDone). */
export const inboxTaskDone = command("inkorg.taskDone", z.object({ taskId: IdSchema })).returns<Result<object, "not_found">>();

/**
 * Visa personnummer (tyst, loggas som pnr.revealed i revisionsloggen): i mejltexten (emailId) eller för ärendets person (caseId).
 * Returnerar texten respektive numret. Aldrig för skyddade personuppgifter om rollen inte har full åtkomst.
 */
export const inboxRevealPnr = command("inkorg.revealPnr", z.object({
  emailId: IdSchema.optional(),
  caseId: IdSchema.optional(),
})).returns<Result<{ text: string }, "not_found" | "forbidden">>();
