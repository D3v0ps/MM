// Typer för alla tabeller (SPEC §6.1) plus de tabeller den gamla prototypen använder utöver SPEC.
// Fält i camelCase, en rad = ett objekt med `id: string`. Tabellnamnen i `Tables` är desamma som i Postgres (snake_case).
// Tider är Stockholms lokala tid: LocalDate 'YYYY-MM-DD', LocalDateTime 'YYYY-MM-DDTHH:mm' (src/core/time.ts).
// Belopp är öre (heltal), priser exkl. moms. Avtalsvärden finns bara i contracts.config (src/core/config.ts).
//
// ================================================================ PORTNING FRÅN DEN GAMLA PROTOTYPEN
// Prototypens tillstånd (prototyp/src/01-seed.js, S.*) -> tabeller här. Namnbyten följer SPEC §6.1.
//
// Tillstånd i prototypen             -> tabell
//   S.contracts                      -> contracts + organizations (kund/leverantör bryts ut, se nedan)
//   S.areas                          -> contract_areas (får id)
//   S.priceItems                     -> price_items
//   S.users + S.customerUsers        -> profiles + memberships (rollen ligger i memberships, per avtal)
//   S.buyerReferences                -> buyer_references
//   S.persons                        -> persons
//   S.cases                          -> cases (+ case_team för c.team)
//   S.caseCounters {'c-bot:2026': n} -> case_counters (id = `${contractId}:${year}`, lastValue = n)
//   S.caseStatusHistory              -> case_status_history
//   S.inboundEmails                  -> inbound_emails
//   S.intakeAssessments              -> intake_assessments
//   S.activities / S.attendance      -> activities / attendance
//   S.checkIns                       -> check_ins
//   S.monthlyAssessments             -> monthly_assessments (en rad per ärende och månad, se typen)
//   S.monthlyPlans                   -> monthly_plans
//   S.outcomeEvents                  -> outcome_events
//   S.deviations                     -> deviations
//   S.contractDeviations             -> contract_deviations
//   S.employers / S.placements       -> employers / placements
//   S.reports                        -> reports
//   S.pulseInvites / pulseResponses  -> pulse_invites / pulse_responses
//   S.alertAcks {key: {by,at,plan}}  -> alert_acks (id = flaggans nyckel)
//   S.messages                       -> messages
//   S.billingRuns                    -> billing_runs
//   S.invoiceStatus {mån: {default, caseId: status}}
//                                    -> billing_runs.defaultInvoiceStatus (= default) + invoice_drafts.status (per ärende)
//   S.billingApprovals {mån: {zeroWeeks, approved, manual}}
//                                    -> billing_week_approvals (zeroWeeks, id = `${caseId}:${weekKey}`)
//                                       + invoice_drafts.approvedAt/approvedBy (approved) + invoice_drafts.manualInvoiceNo (manual)
//   S.ekoFortnox {runs, keys, credits, lastSync}
//                                    -> fortnox_runs (runs och lastSync, kind 'create'/'sync')
//                                       + invoice_drafts.fortnoxIdempotencyKey/fortnoxCreatedAt (keys) + invoice_credits (credits)
//   S.consents                       -> consents
//   S.aiRuns / S.aiFieldDecisions    -> ai_runs / ai_field_decisions
//   S.auditLog                       -> audit_log
//   S.notifications (utskick)        -> outbound_messages (at -> createdAt, + subject, status, sentAt)
//   S.userNotifications              -> user_notifications
//   S.notifRead {userId: {notisId: at}} -> notification_reads (id = `${userId}:${notisId}`) – gäller även beräknade notiser
//   S.tasks                          -> tasks
//   S.orgConfig                      -> org_settings (en rad, settings = OrgSettings)
//   S.komSeen {userId: {caseId: at}} -> case_seen (id = `${userId}:${caseId}`)
//   S.adminTemplates {key: [..]}     -> template_versions (grundtexterna ligger i koden, sparade versioner här)
//   S.adminJobRuns {key: {at, by}}   -> jobs (kind = key, status 'done', createdAt = at, createdBy = by, payload { manual: true })
//   S.logChecks                      -> log_checks
//   S.script {tagg: caseId}, S.meta.w4MissingActivityIds, c.tags, ci.tags, pi-demo
//                                    -> demo_tags (bara testdata)
//   S.deadlineOverrides              -> används inte (deadlines räknas fram; tabellen deadlines finns för produktionen)
//   (finns inte i prototypen)        -> voice_links, participant_voice_notes, audio_uploads (röstinspelning, beslut 2026-09-30,
//                                       docs/PLAN-ROST.md). Testdatat: src/data/seed/gen-voice.ts
//   (finns inte i prototypen)        -> case_notes (fria anteckningar i deltagarkortet, rapporter steg 2, 0019).
//                                       Testdatat: src/data/seed/gen-notes.ts
//   (finns inte i prototypen)        -> saved_reports (rapportbyggaren, rapporter steg 4, 0021).
//                                       Testdatat: src/data/seed/gen-saved-reports.ts
//
// Fältbyten (prototyp -> här):
//   contracts:  customerName/customerOrgNr/supplierName/supplierOrgNr -> customerId/supplierId (organizations.name/orgNr)
//               emailDomains -> organizations.emailDomains (kundens organisation)
//   areas:      (inget id) -> id; contractId, code, name, active oförändrade
//   priceItems: oförändrade (areaCode behålls – SPEC area_id? ersätts av områdeskoden)
//   users/customerUsers: name -> fullName; role -> memberships.role ('handlaggare' -> 'kommun_handlaggare', 'chef' -> 'kommun_chef');
//               org ('mb'/'customer') -> organizationId; unit -> customerUnit (även memberships.customerUnit);
//               buyerReferenceId, teamRole, lastLoginAt, invitedAt, invitedBy, title, email, phone, active oförändrade
//   buyerReferences: customer (namn) -> customerId; note behålls. (SPEC default_for_user_id ersätts av profiles.buyerReferenceId)
//   persons:    pnr -> personnummerEnc (krypterat, AES-256-GCM i produktion) + personnummerHash (HMAC, för sökning och dubbletter);
//               pnrLast4 -> personnummerLast4 (maskerad visning). Övriga fält oförändrade.
//   cases:      number -> caseNumber; primaryArea -> primaryAreaCode; secondaryArea -> secondaryAreaCode;
//               aiConsent -> aiConsentStatus; team -> tabellen case_team; tags -> demo_tags.
//               Nya fält från SPEC: referrerName/referrerUnit/referrerPhone/referrerEmail (beställarens kontaktuppgifter –
//               mejlavrop kan komma från handläggare utan konto, CLAUDE.md punkt 10).
//               Seedens hjälpfält forcePhase, coachChange, noMeeting, forcedEnd, interrupted finns inte (bara för att bygga testdata).
//               createdInDemo finns inte (demodata känns igen på id från ctx.newId, se memory-runtime).
//   caseStatusHistory: oförändrade (fromCoach/toCoach = SPEC from_coach/to_coach)
//   inboundEmails: attachments [{name, kind}] -> attachments [{name, kind, path}] (SPEC attachment_paths[])
//               extracted behåller prototypens nycklar (pnr, primaryArea, background …) – se OrderExtract.
//   outcomeEvents: verificationFile -> verificationPath
//   checkIns:   tags -> demo_tags. ai (AI-förslag med belägg) behålls på raden.
//   pulseInvites: demo -> demo_tags; nytt tokenHash (SPEC token_hash)
//   notifications: at -> createdAt; byTester finns inte
//   auditLog:   byTester finns inte (demodata känns igen på id från ctx.newId)
//
import type { Repo } from "./repo";
import type { Role } from "@/api/roles";
import type { LocalDate, LocalDateTime, MonthKey, WeekKey } from "@/core/time";
import type {
  AppNotifyChannel,
  ContractConfig,
  DataRole,
  KpiWindow,
  OrgSettings,
  PriceUnit,
  ProgressLevel,
  PulseOccasion,
} from "@/core/config";

export type { LocalDate, LocalDateTime, MonthKey, WeekKey, ProgressLevel, PriceUnit, DataRole, PulseOccasion };

/** Områdeskod inom avtalet, t.ex. "G" (Lager och logistik). Unik per avtal – (contract_id, code). */
export type AreaCode = string;
/** Id för en användare (profiles.id) eller "system" för automatiska steg. */
export type UserId = string;

// ================================================================ Statusar och kategorier (exakt prototypens värden)
export const ORGANIZATION_KINDS = ["supplier", "customer"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

export const CONTRACT_STATUSES = ["draft", "active"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CASE_STATUSES = ["received", "acknowledged", "confirmed", "active", "paused", "closed", "declined"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_SOURCES = ["email", "portal", "phone"] as const;
export type CaseSource = (typeof CASE_SOURCES)[number];

export const END_REASONS = ["arbete", "studier", "avbrott_flytt", "avbrott_kommunens_beslut", "avbrott_deltagarens_val", "avbrott_ovriga_skal", "planerat_utan_resultat"] as const;
export type EndReason = (typeof END_REASONS)[number];

/** Hur ett avslut räknas i resultatgraden. */
export const RESULT_CLASSES = ["result", "no_result", "excluded"] as const;
export type ResultClass = (typeof RESULT_CLASSES)[number];

/** Samtycke till inspelning och AI. not_applicable = skyddade personuppgifter (ingen AI). */
export const AI_CONSENT_STATUSES = ["given", "declined", "not_asked", "not_applicable", "revoked"] as const;
export type AiConsentStatus = (typeof AI_CONSENT_STATUSES)[number];

export const TEAM_ROLES = ["lead_coach", "vocational_supervisor", "employer_matcher", "guidance_counselor"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const PREFERRED_CONTACTS = ["sms", "phone", "email", "letter"] as const;
export type PreferredContact = (typeof PREFERRED_CONTACTS)[number];

export const ACTIVITY_KINDS = ["möte", "yrkesmoment", "praktikdag", "arbetsgivarbesök", "annat"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ATTENDANCE_STATUSES = ["present", "late", "absent_valid", "absent_invalid"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Utkast eller godkänd (kartläggning, avstämning, månadsbedömning, månadsplan). */
export const APPROVAL_STATUSES = ["draft", "approved"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const CHECK_IN_MODES = ["fysiskt", "telefon", "video"] as const;
export type CheckInMode = (typeof CHECK_IN_MODES)[number];

export const INPUT_METHODS = ["manual", "ai_recording", "ai_upload", "teams", "notes"] as const;
export type InputMethod = (typeof INPUT_METHODS)[number];

export const GOAL_STATUSES = ["yes", "partly", "no"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Samlad status (mallarnas Grön/Gul/Röd). Visas alltid som text + ikon; Grön -> blå, Gul -> ljusgrå, Röd -> röd. */
export const TRAFFIC_LIGHTS = ["green", "yellow", "red"] as const;
export type TrafficLight = (typeof TRAFFIC_LIGHTS)[number];

export const EMPLOYER_CONTACT_COUNTS = ["0", "1", "2+"] as const;
export type EmployerContactCount = (typeof EMPLOYER_CONTACT_COUNTS)[number];

export const OUTCOME_EVENT_KINDS = [
  "praktik_startad", "intervju_arbetsgivarkontakt", "arbetserbjudande", "arbete_paborjat", "studier_paborjade",
  "validering_uppnadd", "annat_resultat", "reell_kompetens", "vagledning_validering", "yrkesbevis",
] as const;
export type OutcomeEventKind = (typeof OUTCOME_EVENT_KINDS)[number];

export const DEVIATION_STATUSES = ["open", "closed"] as const;
export type DeviationStatus = (typeof DEVIATION_STATUSES)[number];

export const CONTRACT_DEVIATION_SOURCES = ["beställare", "intern", "deltagare", "arbetsgivare"] as const;
export type ContractDeviationSource = (typeof CONTRACT_DEVIATION_SOURCES)[number];
export const CONTRACT_DEVIATION_TYPES = ["kvalitet", "process", "avtal", "ekonomi", "klagomål"] as const;
export type ContractDeviationType = (typeof CONTRACT_DEVIATION_TYPES)[number];
export const CONTRACT_DEVIATION_LEVELS = ["mindre", "större", "allvarlig"] as const;
export type ContractDeviationLevel = (typeof CONTRACT_DEVIATION_LEVELS)[number];
/** open = åtgärdsplan saknas eller inte skickad, action_plan = plan finns (väntar på eller har kommunens godkännande), closed = klar. */
export const CONTRACT_DEVIATION_STATUSES = ["open", "action_plan", "closed"] as const;
export type ContractDeviationStatus = (typeof CONTRACT_DEVIATION_STATUSES)[number];
/** Vite för avvikelse eller för bristfällig löpande information (beloppen i avtalskonfigurationen, penalties). */
export const PENALTY_KINDS = ["deviation", "information"] as const;
export type PenaltyKind = (typeof PENALTY_KINDS)[number];

export const PLACEMENT_STATUSES = ["planned", "ongoing", "completed"] as const;
export type PlacementStatus = (typeof PLACEMENT_STATUSES)[number];

export const REPORT_KINDS = ["weekly_attendance", "monthly", "final", "order_confirmation", "customer_summary", "skills_certificate", "statistics"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
/** waiting = veckorapporten väntar på att all närvaro registreras. opened = kvitterad (används i etiketter och filter). */
export const REPORT_STATUSES = ["draft", "reviewed", "approved", "delivered", "opened", "waiting"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const PULSE_CHANNELS = ["sms", "email"] as const;
export type PulseChannel = (typeof PULSE_CHANNELS)[number];
/** Fråga 4: vad deltagaren vill prioritera. */
export const PULSE_PRIORITIES = ["jobb", "praktik", "utbildning", "svenska", "annat"] as const;
export type PulsePriority = (typeof PULSE_PRIORITIES)[number];
export type PulseScore = 1 | 2 | 3 | 4 | 5;

export const INBOUND_EMAIL_STATUSES = ["received", "acknowledged", "linked", "protected", "other", "accepted", "declined", "applied", "handled"] as const;
export type InboundEmailStatus = (typeof INBOUND_EMAIL_STATUSES)[number];
export const PARSE_METHODS = ["template", "ai", "manual"] as const;
export type ParseMethod = (typeof PARSE_METHODS)[number];
export const EMAIL_CLASSIFICATIONS = ["order", "supplement", "order_protected", "other"] as const;
export type EmailClassification = (typeof EMAIL_CLASSIFICATIONS)[number];

/** Fakturastatus per ärende och månad. blocked räknas fram (stoppande kontroll) och lagras inte. */
export const INVOICE_STATUSES = ["draft", "approved", "fortnox_created", "booked", "sent", "paid", "returned", "manual"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type InvoiceDisplayStatus = InvoiceStatus | "blocked";
export const INVOICE_KINDS = ["periodic", "bonus"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];
export const BILLING_RUN_STATUSES = ["draft", "closed"] as const;
export type BillingRunStatus = (typeof BILLING_RUN_STATUSES)[number];

export const TASK_STATUSES = ["open", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_KINDS = ["customer_decision", "protected_order", "billing_question", "pulse_contact"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const USER_NOTIFICATION_KINDS = ["assignment", "message", "progress_reminder", "progress_escalation"] as const;
export type UserNotificationKind = (typeof USER_NOTIFICATION_KINDS)[number];

/** Kanal för utskick. brev = kallelse per post (deltagarens föredragna kontaktväg letter). */
export const OUTBOUND_CHANNELS = ["email", "sms", "brev"] as const;
export type OutboundChannel = (typeof OUTBOUND_CHANNELS)[number];
/**
 * Utskickets status (src/server/notify): queued väntar på att skickas · sent lämnat till e-postleverantören ·
 * failed gick inte att skicka · suppressed stoppat med avsikt (t.ex. testmiljöns spärr, SMS utan leverantör) · manual skickas för hand (brev).
 */
export const OUTBOUND_STATUSES = ["queued", "sent", "failed", "suppressed", "manual"] as const;
export type OutboundStatus = (typeof OUTBOUND_STATUSES)[number];

export const ALERT_KINDS = [
  "kpi", "stuck", "absence", "first_meeting", "no_progress_escalated", "no_progress", "report_overdue",
  "unbilled", "pulse_contact", "pulse_low", "protected_order", "ai_draft",
  // Rapportarbetet steg 1: inskrivet ärende utan handläggare med aktivt konto – ingen veckorapport tar med deltagaren.
  "no_report_recipient",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const ALERT_SEVERITIES = ["critical", "warning", "info"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const DEADLINE_KINDS = [
  "avrop_svar", "forsta_mote", "veckorapport_registrering", "veckorapport_publicering", "manadsrapport",
  "slutrapport", "bestallarrapport", "atgardsplan", "fakturering", "avvikelse_uppfoljning",
] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];
export const DEADLINE_STATUSES = ["open", "met", "missed"] as const;
export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];

/**
 * transcribe_extract = coachens inspelning/ljudfil -> transkript -> förslag till avstämningen · transcribe_dictation = kommunens
 * "Tala in" (bara text tillbaka) · transcribe_participant = deltagarens inspelning -> transkript -> översättning till svenska.
 */
export const AI_RUN_KINDS = [
  "parse_email", "transcribe_extract", "extract_notes", "extract_teams", "report_summary", "monthly_draft", "transcribe_dictation", "transcribe_participant",
] as const;
export type AiRunKind = (typeof AI_RUN_KINDS)[number];
export const AI_RUN_STATUSES = ["running", "succeeded", "failed"] as const;
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];
export const AI_DECISIONS = ["accepted", "edited", "rejected"] as const;
export type AiDecision = (typeof AI_DECISIONS)[number];

export const CONSENT_KINDS = ["recording_and_ai"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/** Kanal för deltagarens inspelningslänk (samma som pulslänken). Aldrig vid skyddade personuppgifter. */
export const VOICE_LINK_CHANNELS = ["sms", "email"] as const;
export type VoiceLinkChannel = (typeof VOICE_LINK_CHANNELS)[number];
/** Deltagarens röstmeddelande: new = väntar på coachens granskning, reviewed = granskat (underlag), archived = arkiverat. */
export const VOICE_NOTE_STATUSES = ["new", "reviewed", "archived"] as const;
export type VoiceNoteStatus = (typeof VOICE_NOTE_STATUSES)[number];
/** Vad ljudet är till: coachens avstämning, kommunens "Tala in" eller deltagarens inspelning via länk. */
export const AUDIO_PURPOSES = ["checkin", "dictation", "participant"] as const;
export type AudioPurpose = (typeof AUDIO_PURPOSES)[number];
/**
 * Ljudfilens läge: pending = uppladdningsadressen är skapad men filen inte bekräftad · uploaded = filen finns ·
 * transcribed = transkriberad (raderas direkt) · failed = transkriberingen misslyckades (raderas senast efter 24 h) ·
 * deleted = ljudet är raderat (raden finns kvar som spår, utan innehåll).
 */
export const AUDIO_UPLOAD_STATUSES = ["pending", "uploaded", "transcribed", "failed", "deleted"] as const;
export type AudioUploadStatus = (typeof AUDIO_UPLOAD_STATUSES)[number];

export const INTEGRATION_KINDS = ["graph", "entra", "fortnox", "sms", "email", "ai"] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];
/** notchosen = leverantör inte vald ännu, test = testmiljö. */
export const INTEGRATION_STATUSES = ["active", "off", "notchosen", "test"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const BONUS_KINDS = ["work", "progression"] as const;
export type BonusKind = (typeof BONUS_KINDS)[number];

// ================================================================ Organisationer, avtal, användare
export type Organization = {
  id: string;
  name: string;
  orgNr: string;
  kind: OrganizationKind;
  /** Tillåtna e-postdomäner för inbjudan och inloggning (kund), t.ex. ["botkyrka.se"]. */
  emailDomains: string[];
};

export type Contract = {
  id: string;
  supplierId: string;
  customerId: string;
  name: string;
  contractNumber: string;
  dnr: string | null;
  startsOn: LocalDate;
  endsOn: LocalDate | null;
  casePrefix: string;
  dataRole: DataRole;
  /** Validerad med ContractConfigSchema (src/core/config.ts). Ärendehantering: requireOperational(config). */
  config: ContractConfig;
  status: ContractStatus;
  /** Avtalsansvarig (kundansvarig) hos Miljonbemanning. */
  contractManagerId: UserId | null;
};

export type ContractArea = {
  id: string;
  contractId: string;
  /** A–L i Botkyrka. */
  code: AreaCode;
  name: string;
  active: boolean;
};

export type PriceItem = {
  id: string;
  contractId: string;
  /** Avtalsområdet priset gäller, eller null för pris som gäller hela avtalet. */
  areaCode: AreaCode | null;
  code: string;
  unit: PriceUnit;
  packageMonths: number | null;
  /** Öre, exkl. moms. */
  priceOre: number;
  /** Momssats i procent, t.ex. 25. */
  vatRate: number;
  validFrom: LocalDate;
  validTo: LocalDate | null;
  fortnoxArticleNo: string | null;
  /** Priset är ett exempel i testdata (inte avtalets bekräftade pris). */
  exampleOnly: boolean;
};

/** Användare (MB-personal och kommunanvändare). id = auth.users.id i produktion. */
export type Profile = {
  id: string;
  organizationId: string;
  fullName: string;
  email: string;
  phone: string;
  title: string;
  active: boolean;
  lastLoginAt: LocalDateTime | null;
  /** Kommunens enhet, t.ex. "Arbetsmarknadsenheten Alby". Null för MB-personal. */
  customerUnit: string | null;
  /** Handläggarens sparade beställarreferens (förval vid beställning). */
  buyerReferenceId: string | null;
  /** Teamroll för handledare (yrkesspecifik handledare, arbetsgivarmatchare, SYV/metodstöd). */
  teamRole: TeamRole | null;
  invitedAt: LocalDateTime | null;
  invitedBy: UserId | null;
};

/** Roll per avtal. */
export type Membership = {
  id: string;
  userId: string;
  contractId: string;
  role: Role;
  customerUnit: string | null;
};

export type BuyerReference = {
  id: string;
  customerId: string;
  /** 8–10 siffror (mönstret i avtalskonfigurationen). */
  reference: string;
  unit: string;
  active: boolean;
  /** T.ex. varför referensen är spärrad. */
  note: string | null;
};

// ================================================================ Person och ärende
export type Person = {
  id: string;
  /** Personnummer krypterat på applikationsnivå (AES-256-GCM, nyckel i miljövariabel). Visas aldrig i klartext utan loggad "visa". */
  personnummerEnc: string;
  /**
   * HMAC-SHA256 av normaliserat personnummer (de tio sista siffrorna, ÅÅMMDDNNNN – samma normalisering som prototypens
   * dubblettkontroll) – för sökning och dubblettkontroll. Tom sträng när personnummer saknas (även personnummerEnc).
   */
  personnummerHash: string;
  /** Sista fyra siffrorna, för maskerad visning. */
  personnummerLast4: string;
  birthYear: number | null;
  firstName: string;
  lastName: string;
  /** Tom sträng när uppgiften saknas (alltid tom vid skyddade personuppgifter). */
  phone: string;
  email: string;
  city: string;
  /** Bara när kontaktvägen är brev. Aldrig vid skyddade personuppgifter (CLAUDE.md punkt 8). */
  address: string | null;
  preferredContact: PreferredContact;
  protectedIdentity: boolean;
  /** Anpassningsbehov, funktionellt beskrivet. */
  accessibilityNeeds: string;
  language: string;
  needsInterpreter: boolean;
};

/** Ärende = beställning (en anvisning i ett avtal). */
export type Case = {
  id: string;
  /** T.ex. "BOT-27-0049". Människornas nummer – används i utskick, aldrig i URL:er. */
  caseNumber: string;
  contractId: string;
  personId: string;
  status: CaseStatus;
  source: CaseSource;
  referredAt: LocalDateTime;
  /** Beställande handläggare (profiles.id) om hon har konto, annars null. */
  referrerId: string | null;
  referrerName: string | null;
  referrerUnit: string | null;
  referrerPhone: string | null;
  referrerEmail: string | null;
  /** Kommunens beställarreferens (krävs före fakturering). */
  buyerReference: string | null;
  /** Kommunens inköpsordernummer (99…) – aldrig våra egna nummer. */
  purchaseOrderNumber: string | null;
  primaryAreaCode: AreaCode | null;
  secondaryAreaCode: AreaCode | null;
  vocationalTrack: string;
  desiredStart: LocalDate | null;
  /** Planerad start enligt orderbekräftelsen. */
  plannedStart: LocalDate | null;
  plannedWeeks: number | null;
  plannedEnd: LocalDate | null;
  /** Beställningens värde i veckor (för upparbetat och återstående belopp). */
  orderValueWeeks: number | null;
  acknowledgedAt: LocalDateTime | null;
  confirmedAt: LocalDateTime | null;
  declinedAt: LocalDateTime | null;
  declineReason: string | null;
  firstMeetingAt: LocalDateTime | null;
  startDate: LocalDate | null;
  endDate: LocalDate | null;
  closedAt: LocalDateTime | null;
  endReason: EndReason | null;
  resultClass: ResultClass | null;
  resultVerifiedAt: LocalDateTime | null;
  /** Fas 1–5 (namnen i avtalskonfigurationen). */
  phase: number;
  /** När nuvarande fas började, om det inte framgår av godkända avstämningar. */
  phaseSince: LocalDate | null;
  leadCoachId: string | null;
  backgroundInfo: string;
  aiConsentStatus: AiConsentStatus;
  /** Veckodag för coachträffen (0 = måndag) och klockslag 'HH:mm'. */
  meetingDay: number | null;
  meetingTime: string | null;
  /** Ort, t.ex. "Alby". */
  location: string;
  /** Pausade ISO-veckor (debiteras inte). */
  pausedWeeks: WeekKey[];
  pauseReason: string | null;
  /** Mejlet som beställningen kom med när den registrerades efter telefonsamtal (skyddade personuppgifter). */
  sourceEmailId: string | null;
};

/** Status- och coachbyten. */
export type CaseStatusHistory = {
  id: string;
  caseId: string;
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus;
  fromCoach: string | null;
  toCoach: string | null;
  /** Fritext, eller avslutsorsakens nyckel vid avslut. */
  reason: string;
  changedBy: UserId;
  changedAt: LocalDateTime;
  customerNotifiedAt: LocalDateTime | null;
};

/** Löpnummer för ärendenummer per avtal och år. */
export type CaseCounter = {
  /** `${contractId}:${year}` */
  id: string;
  contractId: string;
  year: number;
  lastValue: number;
};

export type CaseTeamMember = {
  id: string;
  caseId: string;
  userId: string;
  role: TeamRole;
};

// ================================================================ Mejlavrop
export type EmailAttachment = { name: string; kind: string; path: string | null };

/**
 * Tolkade beställningsuppgifter (jsonb). Nycklarna är prototypens:
 * primaryArea/secondaryArea -> cases.primaryAreaCode/secondaryAreaCode, background -> cases.backgroundInfo,
 * pnr -> persons.personnummerEnc. Tom sträng = uppgiften framgår inte.
 * pnr: personnummer som det stod i mejlet – krypteras i produktion innan det sparas.
 */
export type OrderExtract = {
  referrerName?: string;
  referrerUnit?: string;
  referrerPhone?: string;
  referrerEmail?: string;
  buyerReference?: string;
  desiredStart?: LocalDate | "";
  plannedEnd?: LocalDate | "";
  plannedWeeks?: number | "";
  firstName?: string;
  lastName?: string;
  pnr?: string;
  phone?: string;
  email?: string;
  city?: string;
  preferredContact?: PreferredContact | "";
  protectedIdentity?: boolean;
  accessibilityNeeds?: string;
  primaryArea?: AreaCode;
  secondaryArea?: AreaCode;
  vocationalTrack?: string;
  background?: string;
};
export type OrderField = keyof OrderExtract;
/** Samordnarens rättelse eller bekräftelse av ett tolkat fält. */
export type FieldCorrection = { by: UserId; at: LocalDateTime; changed: boolean; from: string | number | boolean };

export type InboundEmail = {
  id: string;
  graphMessageId: string;
  receivedAt: LocalDateTime;
  fromAddress: string;
  fromName: string;
  subject: string;
  bodyText: string;
  attachments: EmailAttachment[];
  parseMethod: ParseMethod;
  classification: EmailClassification;
  extracted: OrderExtract;
  /** Säkerhet 0–1 per fält. */
  confidence: Partial<Record<OrderField, number>>;
  missingFields: OrderField[];
  corrections: Partial<Record<OrderField, FieldCorrection>>;
  status: InboundEmailStatus;
  caseId: string | null;
  /** När ordererkännandet (eller den generiska mottagningsbekräftelsen) skickades. */
  ackSentAt: LocalDateTime | null;
  /** generic = generisk mottagningsbekräftelse (skyddade personuppgifter eller otolkbart). */
  ackKind: "generic" | null;
  aiRunId: string | null;
  /** Hur mejlet kopplades till ärendet, t.ex. "ärendenummer i ämnesraden". */
  linkedBy: string | null;
  registeredBy: UserId | null;
  registeredAt: LocalDateTime | null;
  handledBy: UserId | null;
  handledAt: LocalDateTime | null;
};

// ================================================================ Coachning
export type IntakeAssessment = {
  id: string;
  caseId: string;
  workExperience: string;
  education: string;
  languageNotes: string;
  digitalSkills: string;
  drivingLicence: string;
  workGoals: string;
  chosenTrack: string;
  /** Anpassningar, funktionellt beskrivet. */
  adaptations: string;
  firstWeekGoal: string;
  status: ApprovalStatus;
  approvedBy: UserId | null;
  approvedAt: LocalDateTime | null;
  /** Radens version (0022): ökas vid varje sparning – en sparning med fel expectedVersion avvisas (två flikar). */
  version: number;
};

export type Activity = {
  id: string;
  caseId: string;
  kind: ActivityKind;
  startsAt: LocalDateTime;
  durationMin: number;
  location: string;
  note: string;
};

export type Attendance = {
  id: string;
  activityId: string;
  caseId: string;
  status: AttendanceStatus;
  /** Frånvaroorsak (giltig frånvaro) eller "Uteblev utan att meddela". Tom vid närvaro. */
  reason: string;
  registeredBy: UserId;
  registeredAt: LocalDateTime;
  customerNotifiedAt: LocalDateTime | null;
};

export type EmployerContacts = { count: EmployerContactCount | null; types: string[] };
/** AI-förslag med belägg: citat och tidpunkt (sekunder in i samtalet). Inklistrade anteckningar saknar tidpunkt (t = null).
 *  noEvidence = inget belägg hittades – förslaget visas som "Framgår inte". */
export type AiSuggestion<T> = { value: T; quote: string; t: number | null; noEvidence?: boolean };
export type TranscriptLine = { t: number | null; who: string; text: string };
/**
 * AI-utkast till en avstämning. Bedömningsfält (samlad status) föreslås aldrig – därför finns inget overallStatus här
 * (CLAUDE.md punkt 5). Råtranskriptet raderas när avstämningen godkänts, senast efter 30 dagar (punkt 7).
 * I databasen kan förslagen ligga i ai_runs.output/evidence – datalagret mappar.
 */
export type CheckInAiDraft = {
  goalStatus?: AiSuggestion<GoalStatus>;
  nextGoal?: AiSuggestion<string>;
  phase?: AiSuggestion<number>;
  activitiesDone?: AiSuggestion<string[]>;
  employerContacts?: AiSuggestion<EmployerContacts>;
  obstacles?: AiSuggestion<string[]>;
  note?: AiSuggestion<string>;
  transcript: TranscriptLine[];
  audioDeletedAt: LocalDateTime | null;
  rawTranscriptDeleteBy: LocalDateTime | null;
  rawTranscriptDeletedAt?: LocalDateTime | null;
};

/** Veckoavstämning. */
export type CheckIn = {
  id: string;
  caseId: string;
  heldAt: LocalDateTime;
  durationMin: number | null;
  mode: CheckInMode | null;
  inputMethod: InputMethod;
  goalStatus: GoalStatus | null;
  nextGoal: string;
  phase: number | null;
  activitiesDone: string[];
  employerContacts: EmployerContacts;
  /** Coachens bedömning – tom tills coachen valt. */
  overallStatus: TrafficLight | null;
  obstacles: string[];
  note: string;
  /** Coachens kommentar till veckans närvaro (valfri). */
  attendanceComment?: string | null;
  status: ApprovalStatus;
  approvedBy: UserId | null;
  approvedAt: LocalDateTime | null;
  aiRunId: string | null;
  /** Dokumentationstid i minuter: från mötets slut till godkänd dokumentation (mätning av AI-stödet, SPEC §8.5). */
  docMinutes: number | null;
  ai: CheckInAiDraft | null;
  /** Radens version (0022): ökas vid varje sparning – en sparning med fel expectedVersion avvisas (två flikar). */
  version: number;
};

/** AI-utkast till en observation, med källor ("Avstämning 15 jan"). noEvidence = "Framgår inte". */
export type AiObservationDraft = { text: string; sources: string[]; noEvidence?: boolean };
export type AreaAssessment = {
  /** Coachens bedömning 0–3 – null tills coachen gjort ett aktivt val (aldrig AI). */
  level: ProgressLevel | null;
  observation: string;
  nextStep: string;
  /** AI:s förslag visas bara som förslag. */
  aiLevelSuggestion: ProgressLevel | null;
  aiObservationDraft: AiObservationDraft | null;
};

/**
 * Månadsbedömning: prototypens form – en rad per ärende och månad med alla områden i `areas`
 * (nyckel = progressionsområde i avtalskonfigurationen). SPEC §6.1 har en rad per ärende, månad och område
 * (unik (case_id, month, area_key)); databasen kan ha den formen och datalagret mappar.
 */
export type MonthlyAssessment = {
  id: string;
  caseId: string;
  month: MonthKey;
  areas: Record<string, AreaAssessment>;
  status: ApprovalStatus;
  decidedBy: UserId | null;
  decidedAt: LocalDateTime | null;
  summary: string;
  aiSummaryDraft: string | null;
  overallStatus: TrafficLight | null;
  /** Radens version (0022): ökas vid varje sparning – en sparning med fel expectedVersion avvisas (två flikar). */
  version: number;
};

/** Plan för nästa månad (mall 02 avsnitt 7). */
export type MonthlyPlan = {
  id: string;
  caseId: string;
  month: MonthKey;
  goal1: string;
  goal2: string;
  plannedActivities: string;
  plannedEmployerContact: string;
  plannedAdaptation: string;
  nextCustomerMeeting: LocalDate | null;
  status: ApprovalStatus;
};

export type OutcomeEvent = {
  id: string;
  caseId: string;
  kind: OutcomeEventKind;
  occurredOn: LocalDate;
  /** Arbetsgivare, skola eller annan aktör. */
  actor: string;
  /** T.ex. "anställningsbevis", "antagningsbesked", "praktikavtal". */
  verificationKind: string | null;
  /** Sökväg till underlaget i privat lagring (prototypen: filnamn). */
  verificationPath: string | null;
  note: string;
  /** Kan ge bonus (arbete påbörjat). */
  possibleBonus: boolean;
};

/** Avvikelse, risk och åtgärd på deltagarnivå. */
export type Deviation = {
  id: string;
  caseId: string;
  createdAt: LocalDateTime;
  description: string;
  assessment: string;
  action: string;
  ownerId: UserId | null;
  followUpOn: LocalDate | null;
  needsCustomerDecision: boolean;
  followUpMeetingAt: LocalDateTime | null;
  status: DeviationStatus;
  /** Avstämningen där avvikelsen registrerades (vid Röd). */
  checkInId: string | null;
  closedAt?: LocalDateTime | null;
};

/** Avtalsavvikelser, varningar och klagomål (SPEC §7.16). */
export type ContractDeviation = {
  id: string;
  contractId: string;
  caseId: string | null;
  source: ContractDeviationSource;
  type: ContractDeviationType;
  level: ContractDeviationLevel;
  /** Steg i avtalets eskaleringstrappa (config.escalationLadder). */
  escalationStep: number;
  description: string;
  raisedAt: LocalDateTime;
  registeredBy: UserId | null;
  actionPlan: string;
  actionPlanDue: LocalDate | null;
  ownerId: UserId | null;
  /** När åtgärdsplanen skickades till kommunen för godkännande. */
  planSubmittedAt: LocalDateTime | null;
  customerApprovedAt: LocalDateTime | null;
  customerApprovedBy: UserId | null;
  warningIssued: boolean;
  warningIssuedAt: LocalDateTime | null;
  penaltyKind: PenaltyKind | null;
  /** Öre. */
  penaltyOre: number;
  /** Månaden då vitet avräknas på faktura. */
  penaltyOffsetMonth: MonthKey | null;
  orderStop: boolean;
  status: ContractDeviationStatus;
  lessons: string;
  closedAt: LocalDateTime | null;
  closedBy: UserId | null;
};

// ================================================================ Praktik
export type Employer = {
  id: string;
  name: string;
  orgNr: string;
  contactName: string;
  phone: string;
  email: string;
  /** Avtalsområden (koder) arbetsgivaren passar för. */
  areas: AreaCode[];
  createdAt: LocalDateTime | null;
  createdBy: UserId | null;
};

/** "Fyra rätt": rätt arbetsuppgift, handledning, timing och uppföljning. */
export type FourRights = { uppgift: boolean; handledning: boolean; timing: boolean; uppfoljning: boolean };

export type Placement = {
  id: string;
  caseId: string;
  employerId: string;
  startsOn: LocalDate;
  endsOn: LocalDate | null;
  tasks: string;
  supervisorName: string;
  goals: string;
  followUpDates: LocalDate[];
  status: PlacementStatus;
  fourRights: FourRights;
};

// ================================================================ Rapporter
export type FinalReportText = { obstacles: string; recommendation: string };
/**
 * Frusen kopia av en levererad rapport (vy-modellen som JSON). facts = rapportens fakta för kommunens resultatfil (bara koder,
 * tal, sanningsvärden och datum – src/features/rapporter/facts.ts), frysta i samma pass som modellen. jsonb – ingen migration.
 */
export type ReportSnapshot = { reportId: string; takenAt: LocalDateTime; deliveredAt: LocalDateTime | null; model: unknown; facts?: unknown };

export type Report = {
  id: string;
  contractId: string;
  /** Null för veckorapporter (per handläggare) och beställarrapporter. */
  caseId: string | null;
  /** Mottagare för rapporter utan ärende (veckorapport: handläggaren, beställarrapport: kommunens chef). */
  recipientUserId: string | null;
  kind: ReportKind;
  /** Veckorapporter. */
  week: WeekKey | null;
  /** Månads- och beställarrapporter. */
  month: MonthKey | null;
  periodStart: LocalDate | null;
  periodEnd: LocalDate | null;
  status: ReportStatus;
  version: number;
  dueAt: LocalDateTime | null;
  approvedBy: UserId | null;
  approvedAt: LocalDateTime | null;
  deliveredAt: LocalDateTime | null;
  deliveredTo: UserId[];
  /** Kvittens: när mottagaren själv öppnade rapporten. */
  openedAt: LocalDateTime | null;
  openedBy: UserId | null;
  /** Förfallotiden bygger på ett förslag som inte är fastställt (ATT_FASTSTÄLLA). */
  provisionalDue: boolean;
  pdfPath: string | null;
  /** AI-utkast till sammanfattning (beställarrapport). */
  aiSummaryDraft: string | null;
  /** Avtalsansvarigs sammanfattning (beställarrapport). */
  summary: string | null;
  summaryAiUsed: boolean;
  /** Slutrapportens kvarstående hinder och rekommenderade fortsättning (coachens text). */
  finalText: FinalReportText | null;
  /** Rättelse: föregående version. */
  previousId: string | null;
  /** Rättelse: id för den nya versionen som ännu inte levererats. */
  correctionPending: string | null;
  superseded: boolean;
  supersededAt: LocalDateTime | null;
  supersededBy: string | null;
  correctionReason: string | null;
  correctedBy: UserId | null;
  correctedAt: LocalDateTime | null;
  qualityReviewedBy: UserId | null;
  qualityReviewedAt: LocalDateTime | null;
  snapshot: ReportSnapshot | null;
};

// ================================================================ Puls
export type PulseInvite = {
  id: string;
  caseId: string;
  /** Hash av engångslänkens token (token lagras aldrig i klartext). */
  tokenHash: string | null;
  channel: PulseChannel;
  language: string;
  occasion: PulseOccasion;
  sentAt: LocalDateTime;
  expiresAt: LocalDateTime;
  usedAt: LocalDateTime | null;
};

export type PulseAnswers = { q1: PulseScore; q2: PulseScore; q3: PulseScore; q4: PulsePriority; q5: "ja" | "nej" };
/** Enskilda svar läses aldrig av coachen – bara aggregat från minNForAggregate svar. */
export type PulseResponse = {
  id: string;
  inviteId: string;
  caseId: string;
  coachId: string | null;
  occasion: PulseOccasion;
  language: string;
  answers: PulseAnswers;
  text: string;
  contactRequested: boolean;
  submittedAt: LocalDateTime;
};

// ================================================================ Bonus, KPI, flaggor, deadlines (SPEC)
/** Bonusanspråk (fas 3). */
export type BonusClaim = {
  id: string;
  caseId: string;
  kind: BonusKind;
  basis: string;
  evidencePaths: string[];
  submittedAt: LocalDateTime | null;
  customerDecision: "approved" | "rejected" | null;
  decidedBy: UserId | null;
  decidedAt: LocalDateTime | null;
  /** Öre. */
  amountOre: number | null;
  invoiceDraftId: string | null;
};

export type KpiSnapshot = {
  id: string;
  contractId: string;
  kpiKey: string;
  window: KpiWindow;
  value: number | null;
  numerator: number;
  denominator: number;
  computedAt: LocalDateTime;
};

/** Flagga. Prototypen räknar fram flaggorna och sparar bara kvittensen (alert_acks); tabellen finns för bakgrundsjobb. */
export type Alert = {
  id: string;
  /** Stabil nyckel, t.ex. "stuck:case-260143:3" – samma som i alert_acks. */
  key: string;
  contractId: string;
  caseId: string | null;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  message: string;
  recipientRoles: Role[];
  createdAt: LocalDateTime;
  acknowledgedBy: UserId | null;
  acknowledgedAt: LocalDateTime | null;
  actionPlan: string | null;
};

/** Kvittens av en flagga med kort åtgärdsplan. */
export type AlertAck = {
  /** = alertKey */
  id: string;
  alertKey: string;
  acknowledgedBy: UserId;
  acknowledgedAt: LocalDateTime;
  actionPlan: string;
};

/** SLA-bevakning. Prototypen räknar fram deadlines; tabellen finns för bakgrundsjobb. */
export type Deadline = {
  id: string;
  contractId: string;
  caseId: string | null;
  reportId: string | null;
  kind: DeadlineKind;
  dueAt: LocalDateTime;
  metAt: LocalDateTime | null;
  status: DeadlineStatus;
};

// ================================================================ Fakturering
export type BillingRun = {
  id: string;
  contractId: string;
  month: MonthKey;
  status: BillingRunStatus;
  createdBy: UserId;
  createdAt: LocalDateTime;
  closedAt: LocalDateTime | null;
  closedBy: UserId | null;
  /**
   * Status för ärenden som saknar egen rad i invoice_drafts (prototypens invoiceStatus[månad].default,
   * t.ex. "paid" för historiska månader i testdata). Null = "draft".
   */
  defaultInvoiceStatus: InvoiceStatus | null;
};

/** En faktura per ärende och månad (samlingsfakturor är inte tillåtna i Botkyrka). */
export type InvoiceDraft = {
  /** Prototypens form: `inv-${month}-${caseId}`. */
  id: string;
  billingRunId: string | null;
  contractId: string;
  month: MonthKey;
  kind: InvoiceKind;
  caseId: string | null;
  groupingKey: string;
  buyerReference: string | null;
  purchaseOrderNumber: string | null;
  /** Faktureringsobjekt = ärendenummer. */
  invoicedObject: string;
  /** Upparbetat och återstående på beställningen inklusive denna faktura (öre). Null = inte beräknat ännu (räknas fram ur underlaget). */
  accruedOre: number | null;
  remainingOre: number | null;
  /** Omfattar även Fortnox-status (fortnox_created, booked, sent, paid, returned) – SPEC fortnox_status. */
  status: InvoiceStatus;
  approvedBy: UserId | null;
  approvedAt: LocalDateTime | null;
  /** Fakturanummer när fakturan skapats manuellt (t.ex. i kommunens fakturaportal). */
  manualInvoiceNo: string | null;
  fortnoxDocumentNumber: string | null;
  /** `${month}:${caseId}` – samma faktura skapas aldrig två gånger. */
  fortnoxIdempotencyKey: string | null;
  fortnoxCreatedAt: LocalDateTime | null;
  syncedAt: LocalDateTime | null;
};

export type InvoiceLine = {
  id: string;
  invoiceDraftId: string;
  caseId: string;
  priceItemId: string;
  quantity: number;
  /** Öre, exkl. moms. */
  unitPriceOre: number;
  vatRate: number;
  description: string;
  isoWeeks: WeekKey[];
  zeroAttendanceWeeks: WeekKey[];
};

/** Godkänd debiterbar vecka utan närvaro (prototypens billingApprovals[mån].zeroWeeks). */
export type BillingWeekApproval = {
  /** `${caseId}:${weekKey}` */
  id: string;
  contractId: string;
  month: MonthKey;
  caseId: string;
  weekKey: WeekKey;
  approvedBy: UserId;
  approvedAt: LocalDateTime;
  note: string;
};

/** Kreditering av en returnerad faktura (prototypens ekoFortnox.credits). */
export type InvoiceCredit = {
  id: string;
  contractId: string;
  month: MonthKey;
  caseId: string;
  creditedAt: LocalDateTime;
  creditedBy: UserId;
  buyerReference: string | null;
};

/** Körning mot Fortnox: skapa fakturor eller hämta status (prototypens ekoFortnox.runs och lastSync). */
export type FortnoxRun = {
  id: string;
  contractId: string;
  month: MonthKey;
  kind: "create" | "sync";
  ranAt: LocalDateTime;
  ranBy: UserId;
  created: number;
  /** Hoppades över eftersom de redan var skapade (idempotens). */
  skipped: number;
  notReady: number;
  blocked: number;
  /** Antal fakturor som bytte status vid statushämtning. */
  changed: number;
};

// ================================================================ Integrationer, jobb, AI
export type Integration = {
  id: string;
  kind: IntegrationKind;
  name: string;
  status: IntegrationStatus;
  config: Record<string, unknown>;
  /** Hemligheter krypterade – aldrig i klartext. */
  secretsEnc: string | null;
  tokenExpiresAt: LocalDateTime | null;
};

/** Bakgrundsjobb (tabellen jobs + /api/jobs/run). Manuella körningar i adminvyn har payload.manual = true. */
export type Job = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  runAfter: LocalDateTime;
  lastError: string | null;
  createdAt: LocalDateTime;
  createdBy: UserId | null;
  finishedAt: LocalDateTime | null;
  /** När mm.claim_jobs senast hämtade jobbet (för att hitta jobb som fastnat i running). */
  startedAt?: LocalDateTime | null;
};

/** Varje AI-anrop. Aldrig för skyddade ärenden och aldrig utan samtycke. */
export type AiRun = {
  id: string;
  caseId: string | null;
  kind: AiRunKind;
  provider: string;
  model: string;
  inputRef: string | null;
  status: AiRunStatus;
  createdAt: LocalDateTime;
  audioSeconds: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Öre. */
  costOre: number;
  latencyMs: number | null;
  output: unknown;
  evidence: unknown;
  /** Ljudet raderas direkt efter lyckad transkribering. */
  inputDeletedAt: LocalDateTime | null;
};

/** Coachens beslut per AI-förslag. */
export type AiFieldDecision = {
  id: string;
  aiRunId: string | null;
  field: string;
  suggested: unknown;
  final: unknown;
  decision: AiDecision;
  changed: boolean;
  decidedBy: UserId;
  decidedAt: LocalDateTime;
};

/** Samtycke till inspelning och AI. */
export type Consent = {
  id: string;
  personId: string;
  caseId: string;
  kind: ConsentKind;
  /** T.ex. "v1.0 (2026-10-01)". */
  textVersion: string;
  givenAt: LocalDateTime | null;
  declinedAt: LocalDateTime | null;
  informedBy: UserId;
  /** T.ex. "lättläst svenska". */
  language: string | null;
  revokedAt: LocalDateTime | null;
};

// ================================================================ Röstinspelning (SPEC §8, docs/PLAN-ROST.md)
// Ljud raderas direkt efter lyckad transkribering (senast efter 24 h vid fel) – CLAUDE.md punkt 7. Aldrig för skyddade
// personuppgifter (punkt 8). Deltagarens inspelning och kommunens "Tala in" sparar bara text.

/** Deltagarens inspelningslänk (/rost/:token, publik, som pulslänken). Aldrig för skyddade ärenden. */
export type VoiceLink = {
  id: string;
  caseId: string;
  /** SHA-256 (hex) av länkens token – token lagras aldrig i klartext. Null i testdatats exempellänk (demo_tags "vl-demo"). */
  tokenHash: string | null;
  channel: VoiceLinkChannel;
  /** Förvalt språk på sidan (ISO 639-1, ett av avtalets ai.languages). Deltagaren kan byta. */
  language: string;
  sentAt: LocalDateTime;
  /** sentAt + avtalets ai.participantLinkValidDays. */
  expiresAt: LocalDateTime;
  /** När deltagaren skickade in sin inspelning (länken gäller en gång). */
  usedAt: LocalDateTime | null;
  /** Coachen som skickade länken. */
  createdBy: UserId;
};

/**
 * Deltagarens röstmeddelande som text: underlag för coachen (inte en rapport, inte en bedömning). Inget ljud sparas.
 * Kommunen läser dem bara om avtalet säger det (customerVisibility.seesParticipantVoiceNotes) och coachen granskat dem.
 */
export type ParticipantVoiceNote = {
  id: string;
  caseId: string;
  linkId: string;
  /** Språket deltagaren talade (ISO 639-1). */
  language: string;
  /** Texten på svenska (transkriptet, eller översättningen när deltagaren talade ett annat språk). Märks "AI-översättning". */
  textSv: string;
  /** Transkriptet på originalspråket. Null när deltagaren talade svenska (då är textSv originalet). */
  textOriginal: string | null;
  /** Samtyckestextens version som deltagaren godkände i länken, t.ex. "röst-v1.0 (2026-09-30)". */
  consentTextVersion: string;
  consentGivenAt: LocalDateTime;
  status: VoiceNoteStatus;
  createdAt: LocalDateTime;
  reviewedBy: UserId | null;
  reviewedAt: LocalDateTime | null;
  /** AI-körningen (transkribering + översättning). Null i testdatat. */
  aiRunId: string | null;
};

/**
 * Ljudfil i privat lagring (Supabase Storage, bucket "ljud", Stockholm). Skapas och ändras bara av systemet via ctx.audio
 * (service role) – användare läser bara läget. Sökvägen innehåller bara id:n, aldrig personuppgifter.
 */
export type AudioUpload = {
  id: string;
  /** Ärendet (coachens avstämning, deltagarens inspelning, kommunens meddelande). Null för "Tala in" i en ny beställning. */
  caseId: string | null;
  /** Den som spelade in: profiles.id, eller "deltagare" för deltagarens länk. */
  ownerId: UserId;
  purpose: AudioPurpose;
  /** Sökväg i bucketen, t.ex. "checkin/aud-….webm". */
  storagePath: string;
  /** Grundtypen utan parametrar, t.ex. "audio/webm". */
  mimeType: string;
  bytes: number | null;
  /** Längd i hela sekunder. */
  durationSec: number | null;
  status: AudioUploadStatus;
  createdAt: LocalDateTime;
  /** När ljudet raderades ur lagringen. */
  deletedAt: LocalDateTime | null;
};

// ================================================================ Fria anteckningar i deltagarkortet (0019, rapporter steg 2)
// Anteckningar som MB skriver i ärendet (SPEC §7.18). De kommer bara in i månadsrapporten genom att coachen lägger in dem i
// månadsbedömningens sammanfattning och godkänner den – aldrig av sig själva. Aldrig i loggar, AI, utskick eller export.
// Kommunen läser dem aldrig (inte heller när avtalet har customerVisibility.seesCoachNotes). Ingen hård radering: en
// borttagen anteckning får removedAt och removedBy och visas inte längre (bara för författaren, när någon annan tog bort den).
export const CASE_NOTE_KINDS = ["conversation", "customer_contact", "practical", "other"] as const;
export type CaseNoteKind = (typeof CASE_NOTE_KINDS)[number];
/** full = de med full åtkomst till ärendet (huvudcoach, samordnare, avtalsansvarig, chef, systemadministratör) · team = även teamet. */
export const CASE_NOTE_AUDIENCES = ["full", "team"] as const;
export type CaseNoteAudience = (typeof CASE_NOTE_AUDIENCES)[number];
/** Högsta längd på en anteckning (tecken). Samma gräns som kontrollen i 0019. */
export const CASE_NOTE_MAX = 2000;

export type CaseNote = {
  id: string;
  contractId: string;
  caseId: string;
  authorId: UserId;
  /** Dagen anteckningen gäller (förval i dag). */
  occurredOn: LocalDate;
  kind: CaseNoteKind;
  audience: CaseNoteAudience;
  /** 1–2000 tecken. Aldrig i loggar, AI, utskick eller export. */
  body: string;
  createdAt: LocalDateTime;
  /** Senaste ändringen av texten (bara författaren ändrar). */
  updatedAt: LocalDateTime | null;
  /** Borttagen (dold) – raden finns kvar tills den gallras. */
  removedAt: LocalDateTime | null;
  /** Vem som tog bort den: författaren, eller samordnare/avtalsansvarig i avtalet (beslut 2026-10-01). */
  removedBy: UserId | null;
};

// ================================================================ Sparade rapporter i rapportbyggaren (0021, rapporter steg 4)
// Miljonbemanning bygger rapporter av de levererade rapporternas frysta fakta och sparar definitionen (SPEC §7.11 k). En sparad
// rapport visas för ägaren (private), för samordnare, avtalsansvarig och chef i avtalet (mb) eller dessutom för kommunens chef
// (customer – bara avtalsansvarig delar med kommunen). Bara ägaren ändrar titel och definition; avtalsansvarig ändrar
// delningen och arkiverar. Rader raderas aldrig – de arkiveras. Definitionen innehåller aldrig personuppgifter, och titeln
// står aldrig i filnamn eller logg.
export const SAVED_REPORT_VISIBILITIES = ["private", "mb", "customer"] as const;
export type SavedReportVisibility = (typeof SAVED_REPORT_VISIBILITIES)[number];

export type SavedReport = {
  id: string;
  contractId: string;
  /** Den som skapade raden (profiles.id). Ändras aldrig. */
  ownerId: UserId;
  /** 3–80 tecken. Inga personnummer eller ärendenummer (kontrolleras av hanteraren). */
  title: string;
  /** Mallen rapporten började i (en nyckel i koden, TEMPLATES) – sätts när raden skapas. */
  templateKey: string | null;
  /**
   * Definitionen – ett jsonb-objekt med v = 1 (kontrollen i 0021). Innehållet valideras med zod i hanteraren
   * (ReportDefinitionSchema i src/features/rapporter/builder/definition.ts) – en äldre definition kan vara ogiltig.
   */
  definition: Record<string, unknown>;
  visibility: SavedReportVisibility;
  createdAt: LocalDateTime;
  /** Senaste ändringen av titel eller definition (bara ägaren). */
  updatedAt: LocalDateTime | null;
  updatedBy: UserId | null;
  /** Senaste ändringen av delningen. Satt när rapporten inte är privat. */
  sharedAt: LocalDateTime | null;
  sharedBy: UserId | null;
  /** Arkiverad – visas inte i listorna, och kommunen ser den inte. */
  archivedAt: LocalDateTime | null;
  archivedBy: UserId | null;
};

// ================================================================ Kommunikation och logg
/** Säkra meddelanden per ärende. */
export type Message = {
  id: string;
  caseId: string;
  senderId: UserId;
  body: string;
  createdAt: LocalDateTime;
  readBy: UserId[];
  readAt: LocalDateTime | null;
  /** meeting_request = kallelse till uppföljningsmöte (AFK 7.8). */
  kind: "meeting_request" | null;
};

/** Revisionslogg – append-only. Inga personuppgifter i details (bara id:n). */
export type AuditLogEntry = {
  id: string;
  occurredAt: LocalDateTime;
  /** profiles.id eller "system". */
  actorId: UserId | null;
  action: string;
  entity: string;
  entityId: string | null;
  contractId: string | null;
  details: Record<string, unknown>;
};

export type Holiday = {
  /** = date */
  id: string;
  date: LocalDate;
  name: string;
};

/** Utskick (e-post, SMS, brev). Innehåller aldrig personuppgifter – bara ärendenummer och "logga in för att läsa". */
export type OutboundMessage = {
  id: string;
  createdAt: LocalDateTime;
  channel: OutboundChannel;
  /** Mottagarens adress, maskerat nummer eller beskrivning (t.ex. "deltagare (SMS)"). */
  to: string;
  template: string;
  subject: string | null;
  body: string;
  caseId: string | null;
  status: OutboundStatus;
  sentAt: LocalDateTime | null;
  /** Varför utskicket stoppades, misslyckades eller skickades om (t.ex. "redirected" i testmiljön). Aldrig adresser eller personuppgifter. */
  statusReason?: string | null;
  /** E-postleverantörens id för utskicket (Resend). */
  providerMessageId?: string | null;
};

/** Personlig notis i appen. Exakt en mottagare – ingen ser andras notiser. */
export type UserNotification = {
  id: string;
  recipientId: UserId;
  kind: UserNotificationKind;
  caseId: string | null;
  createdAt: LocalDateTime;
  channels: AppNotifyChannel[];
  title: string;
  body: string;
  /** Texten i e-postnotisen (utan personuppgifter). */
  emailBody: string;
};

/** Läst-markering för notiser – både sparade (user_notifications.id) och beräknade (t.ex. "nprog:case-1:2027-W04"). */
export type NotificationRead = {
  /** `${userId}:${notificationKey}` */
  id: string;
  userId: UserId;
  notificationKey: string;
  readAt: LocalDateTime;
};

/** Uppgift till en roll (eller en namngiven kommunanvändare via toId). */
export type Task = {
  id: string;
  toRole: Role;
  toId: UserId | null;
  fromId: UserId;
  createdAt: LocalDateTime;
  status: TaskStatus;
  kind: TaskKind | null;
  caseIds: string[];
  text: string;
  deviationId: string | null;
  emailId: string | null;
  responseId: string | null;
  month: MonthKey | null;
  doneAt: LocalDateTime | null;
  doneBy: UserId | null;
  doneNote: string | null;
};

/** Miljonbemannings interna regler (en rad per organisation). */
export type OrgSettingsRow = {
  id: string;
  organizationId: string;
  /** Validerad med OrgSettingsSchema (src/core/config.ts). */
  settings: OrgSettings;
  updatedAt: LocalDateTime | null;
  updatedBy: UserId | null;
};

/** När en kommunanvändare senast öppnade ärendet i portalen (händelser före räknas som lästa på startsidan). */
export type CaseSeen = {
  /** `${userId}:${caseId}` */
  id: string;
  userId: UserId;
  caseId: string;
  seenAt: LocalDateTime;
};

/** Sparad version av en mall för e-post/SMS (grundtexterna finns i koden). Stoppas om texten innehåller personuppgifter. */
export type TemplateVersion = {
  id: string;
  templateKey: string;
  version: number;
  subject: string;
  body: string;
  savedAt: LocalDateTime;
  savedBy: UserId;
  note: string;
};

/** Månatlig loggkontroll (stickprov) av chef/controller, SPEC §10. */
export type LogCheck = {
  id: string;
  month: MonthKey;
  items: { logId: string; verdict: "ok" | "avvikelse" }[];
  note: string;
  signedBy: UserId;
  signedAt: LocalDateTime;
};

/**
 * BARA TESTDATA. Namngivna rader i testdatat som scenarier och demoförklaringar pekar på:
 * prototypens S.script (tagg -> ärende-id, t.ex. "nadia"), c.tags (t.ex. "prelim2", "ny-i-demo"), ci.tags ("ai-draft"),
 * S.meta.w4MissingActivityIds, pulslänken pi-demo och röstinspelningens exempel (vl-demo, pvn-nadia, pvn-yusuf).
 * Finns inte i produktionsdatabasen.
 */
export type DemoTag = {
  /** = tag */
  id: string;
  tag: string;
  /** Tabellen raderna finns i, t.ex. "cases", "activities", "check_ins", "pulse_invites". */
  entity: TableName;
  entityIds: string[];
};

// ================================================================ Synpunkter i testmiljön (0017, beslut 2026-10-01)
// "Lämna synpunkt" i testmiljöns verktygsfält. Samma modell som prototypens feedback (src/demo/feedback-store.ts).
// Bara inloggade testare i testmiljön läser och skriver (RLS: mm.auth_is_tester(); policy.ts: Actor.testerId).
// Synpunkterna hör inte till testdatat: "Läs in testdata på nytt" och seeden tömmer dem aldrig.
export const FEEDBACK_TYPES = ["fel", "forbattring", "fraga", "bra"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export const FEEDBACK_PRIORITIES = ["maste", "bor", "kan"] as const;
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];
export const FEEDBACK_STATUSES = ["ny", "diskutera", "andras", "klar", "avfardad"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** En synpunkt från en testare. */
export type Feedback = {
  id: string;
  type: FeedbackType;
  priority: FeedbackPriority;
  /** Testarens text (högst 4 000 tecken). Loggas aldrig. */
  text: string;
  status: FeedbackStatus;
  /** Rollen testaren agerade som när synpunkten lämnades (testpersonens roll). */
  role: Role;
  /** Sidan: bara sökväg och id:n – aldrig namn, personnummer eller fritext (sanitizeFeedbackPath). Null = hela Miljonmatch. */
  path: string | null;
  /** Skärmens titel ur rutt-tabellen, t.ex. "Deltagarkort". Null = hela Miljonmatch. */
  viewTitle: string | null;
  /** ctx.now() – testtid i testmiljön. */
  createdAt: LocalDateTime;
  /** Testarens egen profil (inte testpersonen). */
  authorId: UserId;
  statusChangedAt: LocalDateTime | null;
  statusChangedBy: UserId | null;
  /**
   * Riktig tid när synpunkten sparades. Sätts alltid av databasen (triggern i 0017) – hanteraren skickar null. Testklockan
   * (createdAt) börjar om när testdatat läses in på nytt, men synpunkterna finns kvar; listan sorteras därför på den här
   * tiden. Null i minnesläget.
   */
  submittedAt: LocalDateTime | null;
};

/** Svar på en synpunkt. */
export type FeedbackReply = {
  id: string;
  feedbackId: string;
  text: string;
  createdAt: LocalDateTime;
  /** Testarens egen profil. */
  authorId: UserId;
  /** Riktig tid när svaret sparades – sätts av databasen (som Feedback.submittedAt). Null i minnesläget. */
  submittedAt: LocalDateTime | null;
};

// ================================================================ Tabellerna
export type Tables = {
  organizations: Organization;
  contracts: Contract;
  contract_areas: ContractArea;
  price_items: PriceItem;
  profiles: Profile;
  memberships: Membership;
  buyer_references: BuyerReference;
  persons: Person;
  cases: Case;
  case_status_history: CaseStatusHistory;
  case_counters: CaseCounter;
  case_team: CaseTeamMember;
  inbound_emails: InboundEmail;
  intake_assessments: IntakeAssessment;
  activities: Activity;
  attendance: Attendance;
  check_ins: CheckIn;
  monthly_assessments: MonthlyAssessment;
  monthly_plans: MonthlyPlan;
  outcome_events: OutcomeEvent;
  deviations: Deviation;
  contract_deviations: ContractDeviation;
  employers: Employer;
  placements: Placement;
  reports: Report;
  pulse_invites: PulseInvite;
  pulse_responses: PulseResponse;
  bonus_claims: BonusClaim;
  kpi_snapshots: KpiSnapshot;
  alerts: Alert;
  alert_acks: AlertAck;
  deadlines: Deadline;
  billing_runs: BillingRun;
  invoice_drafts: InvoiceDraft;
  invoice_lines: InvoiceLine;
  billing_week_approvals: BillingWeekApproval;
  invoice_credits: InvoiceCredit;
  fortnox_runs: FortnoxRun;
  integrations: Integration;
  jobs: Job;
  ai_runs: AiRun;
  ai_field_decisions: AiFieldDecision;
  consents: Consent;
  messages: Message;
  audit_log: AuditLogEntry;
  holidays: Holiday;
  outbound_messages: OutboundMessage;
  user_notifications: UserNotification;
  notification_reads: NotificationRead;
  tasks: Task;
  org_settings: OrgSettingsRow;
  case_seen: CaseSeen;
  template_versions: TemplateVersion;
  log_checks: LogCheck;
  demo_tags: DemoTag;
  voice_links: VoiceLink;
  participant_voice_notes: ParticipantVoiceNote;
  audio_uploads: AudioUpload;
  feedback: Feedback;
  feedback_replies: FeedbackReply;
  case_notes: CaseNote;
  saved_reports: SavedReport;
};
export type TableName = keyof Tables & string;
export type AppRepo = Repo<Tables>;
/** Hela datat (eller en delmängd via Pick<Db, …>) – indata till domänfunktionerna i src/core. */
export type Db = { [N in TableName]: Tables[N][] };

/** Alla tabellnamn i migrationsordning (docs/PLAN-FAS1.md). */
export const TABLE_NAMES = [
  "holidays", "organizations", "contracts", "contract_areas", "price_items",
  "profiles", "memberships",
  "persons", "cases", "case_status_history", "case_counters", "case_team", "buyer_references",
  "inbound_emails",
  "intake_assessments", "activities", "attendance", "check_ins", "monthly_assessments", "monthly_plans", "outcome_events", "deviations", "consents", "employers", "placements",
  "reports", "messages", "user_notifications", "notification_reads", "tasks", "outbound_messages", "case_seen",
  "contract_deviations", "alerts", "alert_acks", "deadlines", "kpi_snapshots", "pulse_invites", "pulse_responses", "bonus_claims",
  "billing_runs", "invoice_drafts", "invoice_lines", "billing_week_approvals", "invoice_credits", "fortnox_runs", "integrations",
  "jobs", "ai_runs", "ai_field_decisions", "audit_log", "org_settings", "template_versions", "log_checks",
  "demo_tags",
  "voice_links", "participant_voice_notes", "audio_uploads",
  "feedback", "feedback_replies",
  "case_notes",
  "saved_reports",
] as const satisfies readonly TableName[];
// Kompileringskontroll: TABLE_NAMES innehåller varje tabell.
type MissingTables = Exclude<TableName, (typeof TABLE_NAMES)[number]>;
const allTablesListed: [MissingTables] extends [never] ? true : MissingTables = true;
void allTablesListed;

/** Tomt dataset med alla tabeller (t.ex. för seed och tester). */
export function emptyDb(): Db {
  return Object.fromEntries(TABLE_NAMES.map((n) => [n, []])) as unknown as Db;
}

/**
 * Unika nycklar utöver id – samma som databasens unika index, så att minnesläget stoppar samma dubbletter (UniqueError,
 * src/data/memory.ts): en närvarorad per tillfälle (0022, två samtidiga registreringar), ett pulssvar per länk (0016).
 */
export const UNIQUE_KEYS: { [N in TableName]?: readonly (keyof Tables[N] & string)[] } = {
  attendance: ["activityId"],
  pulse_responses: ["inviteId"],
};
