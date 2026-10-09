// Etiketter och listor som visas för användaren (prototypens sel.statusLabel, endReasonLabel, eventLabel …).
// Texterna är exakt prototypens (prototyp/src/03-domain.js).
import {
  END_REASONS as SCHEMA_END_REASONS,
  OUTCOME_EVENT_KINDS,
  type AttendanceStatus,
  type CaseNoteAudience,
  type CaseNoteKind,
  type CaseStatus,
  type ContractArea,
  type EndReason,
  type InvoiceDisplayStatus,
  type OutboundStatus,
  type OutcomeEventKind,
  type PreferredContact,
  type PriorAssessment,
  type Profile,
  type ReportKind,
  type ReportStatus,
  type ResultClass,
  type TeamRole,
  type TrafficLight,
} from "@/data/schema";
import { hasContactDetails } from "./contact";
import { byId } from "./db-index";

export { phaseName, phaseLabel } from "./config";

const lookup = <K extends string>(map: Record<K, string>, key: string | null | undefined): string | undefined =>
  key == null ? undefined : (map as Record<string, string>)[key];

/** Har en kartläggning genomförts? (beställningens bakgrundsinformation, beslut 2026-10-07 synpunkt #7). */
export const PRIOR_ASSESSMENT_LABEL: Record<PriorAssessment, string> = { yes: "Ja", no: "Nej", unknown: "Vet inte" };

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  received: "Mottagen", acknowledged: "Ordererkänd", confirmed: "Bekräftad", active: "Pågår", paused: "Pausad", closed: "Avslutad", declined: "Avböjd",
};
export const statusLabel = (s: string): string => lookup(CASE_STATUS_LABEL, s) ?? s;

export const END_REASONS = SCHEMA_END_REASONS;
export const END_REASON_LABEL: Record<EndReason, string> = {
  arbete: "Arbete", studier: "Studier", avbrott_flytt: "Avbrott: flytt", avbrott_kommunens_beslut: "Avbrott: kommunens beslut",
  avbrott_deltagarens_val: "Avbrott: deltagarens val", avbrott_ovriga_skal: "Avbrott: övriga skäl", planerat_utan_resultat: "Planerat avslut utan resultat",
};
export const endReasonLabel = (r: string | null | undefined): string => lookup(END_REASON_LABEL, r) ?? "–";

/**
 * Hur ett avslut räknas i resultatgraden (cases.result_class). En ordlista för deltagarkortet och kommunens resultatfil
 * (rapporter steg 3): "Inget resultat" och "Räknas inte i resultatgraden" – inte "Ej resultat"/"Räknas inte i nämnaren".
 */
export const RESULT_CLASS_LABEL: Record<ResultClass, string> = { result: "Resultat", no_result: "Inget resultat", excluded: "Räknas inte i resultatgraden" };

/** Samlad status (mallarnas Grön/Gul/Röd) – samma ord som märkena (STATUS_SHORT i src/ui/badge.tsx använder den här). */
export const TRAFFIC_LIGHT_LABEL: Record<TrafficLight, string> = { green: "Grön", yellow: "Gul", red: "Röd" };

export const EVENT_KINDS = OUTCOME_EVENT_KINDS;
export const EVENT_LABEL: Record<OutcomeEventKind, string> = {
  praktik_startad: "Praktik/arbetsplatsförlagt moment startat", intervju_arbetsgivarkontakt: "Anställningsintervju eller konkret arbetsgivarkontakt", arbetserbjudande: "Arbetserbjudande",
  arbete_paborjat: "Arbete påbörjat", studier_paborjade: "Studier påbörjade/antagen", validering_uppnadd: "Validering/certifiering uppnådd", annat_resultat: "Annat konkret resultat",
  reell_kompetens: "Reell kompetens dokumenterad", vagledning_validering: "Vägledning till formell validering", yrkesbevis: "Yrkeskompetensbevis/diplom utfärdat",
};
export const eventLabel = (k: string): string => lookup(EVENT_LABEL, k) ?? k;

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: "Närvarande", late: "Sen", absent_valid: "Frånvaro, giltig", absent_invalid: "Frånvaro, ogiltig",
};
/** Närvarostatus som text. Saknad registrering -> "Ej registrerad". */
export const attLabel = (s: string | null | undefined): string => lookup(ATTENDANCE_LABEL, s) ?? "Ej registrerad";
/** Giltiga frånvaroorsaker. */
export const ABSENCE_REASONS = ["Sjukdom", "Vård av barn", "Myndighetsbesök", "Annat giltigt skäl"] as const;

export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  weekly_attendance: "Veckorapport närvaro", monthly: "Månadsrapport individ", final: "Slutrapport", order_confirmation: "Orderbekräftelse",
  customer_summary: "Beställarrapport", skills_certificate: "Yrkeskompetensbevis", statistics: "Statistik",
};
export const reportKindLabel = (k: string): string => lookup(REPORT_KIND_LABEL, k) ?? k;

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  draft: "Utkast", reviewed: "Granskad av coach", approved: "Godkänd", delivered: "Levererad", opened: "Kvitterad", waiting: "Väntar på närvaro",
};
export const reportStatusLabel = (s: string): string => lookup(REPORT_STATUS_LABEL, s) ?? s;

// Fria anteckningar i deltagarkortet (rapporter steg 2 – finns inte i prototypen).
export const CASE_NOTE_KIND_LABEL: Record<CaseNoteKind, string> = {
  conversation: "Samtal med deltagaren", customer_contact: "Kontakt med kommunen", practical: "Praktiskt", other: "Övrigt",
};
export const caseNoteKindLabel = (k: string): string => lookup(CASE_NOTE_KIND_LABEL, k) ?? k;
/**
 * Vem ser anteckningen (kort etikett i tidslinjen). Systemadministratören har full åtkomst i ärenden utan skyddade
 * personuppgifter (caseAccess) och läser därför anteckningarna – texterna säger det.
 */
export const CASE_NOTE_AUDIENCE_LABEL: Record<CaseNoteAudience, string> = {
  full: "Huvudcoach, samordnare, avtalsansvarig, chef och systemadministratör", team: "Även teamet",
};
/** I ärenden med skyddade personuppgifter, oavsett audience. */
export const CASE_NOTE_PROTECTED_AUDIENCE = "Bara namngiven huvudcoach och avtalsansvarig";

export const CONTACT_LABEL: Record<PreferredContact, string> = { sms: "SMS", phone: "Telefon", email: "E-post", letter: "Brev" };
export const contactLabel = (k: string): string => lookup(CONTACT_LABEL, k) ?? k;

/** Texten i stället för kontaktvägen när deltagaren saknar telefonnummer och e-postadress (Miljonbemannings vyer). */
export const NO_CONTACT_TEXT = "Kontaktuppgift saknas – kontakta handläggaren";
/** Samma sak i kommunens portal (läsaren är handläggaren). */
export const NO_CONTACT_TEXT_PORTAL = "Kontaktuppgift saknas";
/** Kontaktvägen i klarspråk ("SMS", "E-post" …), eller missingText när det inte finns något sätt att nå deltagaren. */
export const participantContactLabel = (p: Parameters<typeof hasContactDetails>[0] & { preferredContact: string }, missingText = NO_CONTACT_TEXT): string =>
  hasContactDetails(p) ? contactLabel(p.preferredContact) : missingText;

export const TEAM_ROLE_LABEL: Record<TeamRole, string> = {
  lead_coach: "Huvudcoach", vocational_supervisor: "Yrkesspecifik handledare", employer_matcher: "Arbetsgivarmatchare", guidance_counselor: "SYV/metodstöd",
};
export const teamLabel = (role: string): string => lookup(TEAM_ROLE_LABEL, role) ?? role;

export const INVOICE_STATUS_LABEL: Record<InvoiceDisplayStatus, string> = {
  draft: "Underlag", approved: "Godkänd", fortnox_created: "Skapad i Fortnox (ej bokförd)", booked: "Bokförd", sent: "Skickad (Peppol)", paid: "Betald",
  returned: "Returnerad av kommunen", manual: "Manuellt fakturerad", credited: "Krediterad", blocked: "Stoppad",
};
export const invoiceStatusLabel = (s: string): string => lookup(INVOICE_STATUS_LABEL, s) ?? s;

/** Utskickets status (outbound_messages.status) i utskicksloggen. Visas alltid med text + ikon. */
export const OUTBOUND_STATUS_LABEL: Record<OutboundStatus, string> = {
  queued: "Väntar på att skickas", sent: "Skickat", failed: "Kunde inte skickas", suppressed: "Stoppat", manual: "Skickas manuellt (brev)",
};
export const outboundStatusLabel = (s: string): string => lookup(OUTBOUND_STATUS_LABEL, s) ?? s;
/**
 * Orsaken (outbound_messages.statusReason) som text. De flesta orsaker sparas redan som svensk text (src/server/notify/decision.ts);
 * "redirected" = testmiljön skickade mejlet till testaren i stället för till testpersonen (MM_EMAIL_REDIRECT_TO).
 */
export const OUTBOUND_REASON_LABEL: Readonly<Record<string, string>> = { redirected: "Testmiljön: skickat till testarens adress i stället för till mottagaren" };
export const outboundReasonLabel = (r: string | null | undefined): string | null => (r ? (OUTBOUND_REASON_LABEL[r] ?? r) : null);

/** "G Lager och logistik" – områdeskod och namn. "–" om koden saknas. */
export function areaName(areas: readonly Pick<ContractArea, "code" | "name">[], code: string | null | undefined): string {
  if (!code) return "–";
  const a = areas.find((x) => x.code === code);
  return `${code} ${a?.name ?? ""}`;
}

/** Namnet på en användare (MB eller kommun). "system" = automatiska steg. "–" om användaren saknas. */
export function personName(profiles: readonly Profile[], id: string | null | undefined): string {
  if (!id) return "–";
  if (id === "system") return "Miljonmatch (automatiskt)";
  return byId(profiles).get(id)?.fullName ?? "–";
}
