// Revisionsloggen i klarspråk: åtgärdskoder, objekt och detaljer som läsbar svenska (SPEC: klarspråk).
// Isomorf och utan I/O – hanteraren skickar in uppslagen (namn på användare, ärendenummer, rapporter).
// Texterna är exakt den gamla prototypens (prototyp/src/views/admin.js, ACTION_LABEL m.fl.).
import { attLabel, endReasonLabel, eventLabel, reportKindLabel } from "@/core/labels";
import { fmtDate, fmtDateTime, fmtWeekKey, monthName } from "@/core/time";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const ACTION_LABEL: Record<string, string> = {
  "case.view": "Visade deltagarkort", "pnr.revealed": "Visade personnummer", "report.view": "Visade rapport", "transcript.view": "Visade transkript",
  "case.created": "Skapade ärende", "case.accepted": "Accepterade avrop", "case.declined": "Avböjde avrop", "case.updated": "Ändrade ärende",
  "case.buyer_reference_changed": "Ändrade beställarreferens", "case.first_meeting_booked": "Bokade första möte", "case.coach_changed": "Bytte huvudcoach", "case.closed": "Avslutade ärende",
  "email.received": "Tog emot mejl", "email.handled": "Hanterade mejl", "email.linked": "Kopplade mejl till ärende", "email.supplement_applied": "Förde in komplettering",
  "attendance.registered": "Registrerade närvaro", "report.published": "Publicerade veckorapport", "report.approved": "Godkände rapport", "report.delivered": "Levererade rapport", "report.corrected": "Rättade rapport",
  "check_in.saved": "Sparade avstämning", "check_in.approved": "Godkände avstämning", "deviation.created": "Skapade avvikelse", "deviation.saved": "Sparade avvikelse", "deviation.customer_called": "Kallade kommunen till uppföljning",
  "assessment.saved": "Sparade månadsbedömning", "assessment.approved": "Godkände månadsbedömning", "intake.saved": "Sparade kartläggning", "intake.approved": "Godkände kartläggning",
  "event.added": "Registrerade händelse", "result.verified": "Verifierade resultat", "message.sent": "Skickade meddelande", "alert.acknowledged": "Kvitterade flagga",
  "consent.given": "Registrerade samtycke", "consent.declined": "Registrerade nej till samtycke", "consent.revoked": "Återkallade samtycke",
  "ai.run": "AI-körning", "audio.deleted": "Raderade ljudfil", "transcript.deleted": "Raderade råtranskript",
  "billing.view": "Visade fakturaunderlag", "billing.zero_week_approved": "Godkände vecka utan närvaro", "billing.approved": "Godkände fakturor", "billing.fortnox_created": "Skapade fakturor i Fortnox", "billing.manual": "Markerade manuellt fakturerad",
  "export.billing": "Exporterade fakturaunderlag", "export.audit_log": "Exporterade revisionslogg", "notify.email": "Skickade e-post", "kpi.computed": "Beräknade nyckeltal",
  "org_rule.updated": "Ändrade interna regler", "customer_user.invited": "Bjöd in kommunanvändare", "customer_user.blocked": "Spärrade kommunanvändare", "customer_user.reactivated": "Aktiverade kommunanvändare",
  "template.saved": "Sparade ny mallversion", "job.run_manual": "Körde bakgrundsjobb manuellt", "audit.log_check": "Signerade loggkontroll",
  "pulse.submitted": "Pulssvar inskickat", "employer.added": "Lade till arbetsgivare", "placement.four_rights_updated": "Ändrade de fyra rätten", "placement.follow_up_added": "Lade till uppföljningsdatum",
  "case.view_denied": "Nekades att öppna deltagarkort", "ai.blocked": "AI stoppades", "notify.suppressed": "Stoppade utskick", "email.registered_by_phone": "Registrerade avrop per telefon", "case.order_details_corrected": "Rättade beställningsuppgifter",
  "billing.fortnox_run": "Körde överföring till Fortnox", "billing.fortnox_status_synced": "Hämtade fakturastatus från Fortnox", "billing.credited_and_reissued": "Krediterade och fakturerade på nytt", "billing.run_closed": "Stängde fakturakörning",
  "task.created": "Skapade uppgift", "task.done": "Markerade uppgift som klar", "auth.login": "Loggade in", "contract_deviation.created": "Registrerade avtalsavvikelse", "contract_deviation.updated": "Ändrade avtalsavvikelse",
  "contract_deviation.action_plan_approved": "Godkände åtgärdsplan", "contract_deviation.closed": "Stängde avtalsavvikelse", "report.quality_reviewed": "Kvalitetsgranskade rapport", "report.final_text_saved": "Sparade slutrapportens text",
  "report.summary_saved": "Sparade sammanfattning i rapport", "report.correction_reason": "Angav orsak till rättelse", view: "Visade",
  // Synpunkter i testmiljön (src/features/synpunkter) – finns inte i prototypen.
  "feedback.created": "Lämnade synpunkt", "feedback.replied": "Svarade på synpunkt", "feedback.status_changed": "Ändrade status på synpunkt",
};
/** Okänd åtgärdskod blir läsbar text i stället för kod: "billing.new_thing" → "Billing new thing". */
export const actionLabel = (code: string | null | undefined): string => ACTION_LABEL[code ?? ""] ?? cap(String(code || "").replace(/[._]/g, " "));

export const ENTITY_LABEL: Record<string, string> = {
  customer_user: "Kommunanvändare", contract_deviation: "Avtalsavvikelse", task: "Uppgift", case: "Ärende", person: "Person", report: "Rapport", inbound_email: "Mejl", ai_run: "AI-körning",
  attendance: "Närvaro", check_in: "Avstämning", deviation: "Avvikelse", monthly_assessment: "Månadsbedömning", intake_assessment: "Kartläggning", outcome_event: "Händelse", alert: "Flagga",
  consent: "Samtycke", billing_run: "Fakturakörning", contract: "Avtal", org_config: "Interna regler", profile: "Användare", template: "Mall", job: "Bakgrundsjobb", audit_log: "Revisionslogg",
  pulse_response: "Pulssvar", employer: "Arbetsgivare", placement: "Praktikplats", feedback: "Synpunkt",
};
/** Objektets typ i tabellen: "Ärende", "Mall" … Okänd typ blir läsbar text. */
export const entityLabel = (entity: string | null | undefined): string => ENTITY_LABEL[entity ?? ""] ?? cap(String(entity || "").replace(/_/g, " "));

const DETAIL_KEY: Record<string, string> = {
  number: "Ärendenummer", source: "Kanal", parseMethod: "Tolkning", template: "Mall", to: "Till", from: "Från", kind: "Typ", provider: "Leverantör", reason: "Orsak", status: "Status",
  month: "Månad", week: "Vecka", count: "Antal", format: "Format", rows: "Rader", role: "Roll", unit: "Enhet", domain: "Domän", version: "Version", language: "Språk",
  contactRequested: "Vill bli kontaktad", right: "Rätt", value: "Värde", date: "Datum", areas: "Områden", checked: "Kontrollerade poster", deviations: "Avvikelser", withinSla: "Inom SLA",
  leadCoachId: "Huvudcoach", firstMeetingAt: "Första möte", fields: "Fält", missing: "Saknas", classification: "Klassning", via: "Via", kpi: "Nyckeltal", window: "Period",
  audioDeleted: "Ljud raderat", automatic: "Automatiskt", waiting: "Väntar", endReason: "Avslutsorsak", resultClass: "Resultatklass", channel: "Kanal", note: "Anteckning",
  plan: "Åtgärdsplan", filter: "Filter", aiUsed: "AI använd", fromCheckIn: "Från avstämning", deviationId: "Avvikelse", invoiceNo: "Fakturanummer", idempotencyKey: "Idempotensnyckel",
  idempotencyKeys: "Idempotensnycklar", by: "Av", previous: "Tidigare version", at: "Tidpunkt", created: "Skapade", skippedAlreadyCreated: "Redan skapade",
  skippedDuplicates: "Dubbletter som hoppades över", blocked: "Stoppade", notApproved: "Inte godkända", changed: "Ändrade", buyerReference: "Beställarreferens", toRole: "Till roll",
  caseIds: "Ärenden", emailId: "Mejl", method: "Inloggning", hadCustomerApproval: "Godkänd av kommunen", type: "Typ", level: "Nivå", step: "Steg", sentToCustomer: "Skickad till kommunen",
  acknowledged: "Kvitterad", parse: "Tolkning", priority: "Hur viktigt", replyId: "Svar",
};
/** Kodvärden i loggen som läsbar svenska. Nyckelberoende först, sedan generella ord. */
const FIELD_WORD: Record<string, string> = {
  buyerReference: "beställarreferens", purchaseOrderNumber: "inköpsordernummer", primaryArea: "avtalsområde", secondaryArea: "andra avtalsområde", vocationalTrack: "yrkesspår",
  desiredStart: "önskad start", plannedWeeks: "antal veckor", plannedEnd: "planerat slut", plannedEndDate: "planerat slut", startDate: "startdatum", endDate: "slutdatum",
  backgroundInfo: "bakgrund", aiConsent: "AI-samtycke", meetingDay: "mötesdag", meetingTime: "mötestid", location: "plats", ordererContact: "beställarens kontaktuppgifter",
  referrerId: "handläggare", leadCoachId: "huvudcoach", phase: "fas", tags: "taggar", pausedWeeks: "pausade veckor", firstMeetingAt: "första möte", team: "team", status: "status",
  area: "avtalsområde", unit: "enhet", contactName: "kontaktperson", contactPhone: "telefon", contactEmail: "e-post", person: "deltagare",
};
const WINDOW: Record<string, string> = { rolling_6m: "rullande 6 månader", since_start: "sedan avtalsstart", month: "per månad", rolling_3m: "rullande 3 månader" };
const VALUE_BY_KEY: Record<string, Record<string, string>> = {
  parseMethod: { template: "Word-mall", ai: "AI", manual: "manuellt", freetext: "fritext" },
  source: { email: "e-post", portal: "portalen", phone: "telefon", manual: "manuellt" },
  channel: { email: "e-post", sms: "SMS", portal: "portalen", app: "appen", brev: "brev", letter: "brev" },
  window: WINDOW,
  by: { customer: "kommunen", coach: "coachen", system: "systemet" },
  method: { email_otp: "e-post och engångskod", entra: "Microsoft Entra ID" },
  role: { handlaggare: "handläggare", chef: "chef", admin: "systemadmin", avtalsansvarig: "avtalsansvarig", samordnare: "samordnare", coach: "coach", handledare: "handledare", ekonom: "ekonom" },
  toRole: { samordnare: "samordnare", avtalsansvarig: "avtalsansvarig", chef: "chef", coach: "coach", kommun_handlaggare: "kommunens handläggare" },
  language: { sv: "svenska", en: "engelska", ar: "arabiska", so: "somaliska" },
  right: { uppgift: "rätt arbetsuppgift", handledning: "rätt handledning", timing: "rätt tidpunkt", uppfoljning: "rätt uppföljning" },
  format: { csv: "CSV", xlsx: "Excel", pdf: "PDF", sie: "SIE", peppol: "Peppol" },
};
const AI_KIND: Record<string, string> = {
  parse_email: "tolka mejl", transcribe_extract: "transkribering och utkast", extract_notes: "utkast från anteckningar", extract_teams: "utkast från Teams-transkript",
  report_summary: "sammanfattning till rapport", monthly_draft: "utkast till månadsbedömning",
};
const STATUS_WORD: Record<string, string> = {
  open: "öppen", closed: "stängd", action_plan: "åtgärdsplan", handled: "hanterat", accepted: "accepterat", declined: "avböjt", protected: "skyddade personuppgifter", other: "övrigt",
  linked: "kopplat", received: "mottaget", acknowledged: "ordererkänt", draft: "utkast", approved: "godkänd", delivered: "levererad", succeeded: "klar", failed: "fel", given: "givet",
  revoked: "återkallat", active: "pågår", paused: "pausad",
};

export type AuditEntryLike = { action: string; entity: string; entityId: string | null; details: Record<string, unknown> };

/** Uppslag som hanteraren skickar in. Deltagare visas aldrig med namn – bara ärendenummer. */
export type AuditLookups = {
  /** Namn på en användare (MB eller kommun), null om id:t inte är en användare. */
  userName(id: string): string | null;
  /** Ärendenummer för ett ärende-id, null om det inte finns. */
  caseNumber(id: string): string | null;
  /** Nyckeltalets etikett i avtalets konfiguration. */
  kpiLabel(key: string): string | null;
  /** Mallens namn (mallkatalogen). */
  templateLabel(key: string): string;
};

const KPI_LABEL: Record<string, string> = { placeringsgrad: "Placeringsgrad", yttranden_i_tid: "Yttranden i tid", nojdhet: "Nöjdhet" };

function kindWord(a: AuditEntryLike, s: string): string {
  if (a.action === "ai.run" || a.entity === "ai_run") return AI_KIND[s] ?? s;
  if (a.action === "event.added") return eventLabel(s);
  if (String(a.action).startsWith("report.") || a.entity === "report") return reportKindLabel(s);
  return AI_KIND[s] ?? (reportKindLabel(s) !== s ? reportKindLabel(s) : eventLabel(s) !== s ? eventLabel(s) : s);
}

function fmtDetail(k: string, v: unknown, a: AuditEntryLike, l: AuditLookups): string {
  if (v === true) return "Ja";
  if (v === false) return "Nej";
  if (Array.isArray(v)) return v.map((x) => fmtDetail(k, x, a, l)).join(", ");
  if (v && typeof v === "object") return Object.entries(v).map(([kk, vv]) => `${(DETAIL_KEY[kk] ?? FIELD_WORD[kk] ?? kk).toLowerCase()} ${fmtDetail(kk, vv, a, l)}`).join(", ");
  const s = String(v);
  if (k === "template") return l.templateLabel(s);
  if (["fields", "checked", "missing"].includes(k)) return FIELD_WORD[s] ?? s;
  if (k === "kind") return kindWord(a, s);
  if (k === "kpi") return l.kpiLabel(s) ?? KPI_LABEL[s] ?? s;
  if (k === "endReason") return endReasonLabel(s);
  if (k === "status" && a.action === "attendance.registered") return attLabel(s);
  if (k === "status") return STATUS_WORD[s] ?? s;
  if (VALUE_BY_KEY[k]?.[s]) return VALUE_BY_KEY[k][s];
  if (/^(u|k)-[a-z]+$/.test(s)) return l.userName(s) ?? "–";
  if (/^case-\d+$/.test(s)) return l.caseNumber(s) ?? s;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return fmtDateTime(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtDate(s);
  if (/^\d{4}-W\d{2}$/.test(s)) return fmtWeekKey(s);
  if (/^\d{4}-\d{2}$/.test(s) && k === "month") return monthName(s);
  return s;
}

/** Detaljerna i en loggrad som läsbar text: "Tolkning: Word-mall · Kanal: e-post". */
export function detailText(a: AuditEntryLike, l: AuditLookups): string {
  const x = a.details ?? {};
  if (a.action === "org_rule.updated" && isSnapshot(x.from) && isSnapshot(x.to)) return ruleDiffText(x.from, x.to);
  return Object.entries(x)
    .filter(([k, v]) => v != null && v !== "" && k !== "caseId" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${DETAIL_KEY[k] ?? cap(FIELD_WORD[k] ?? k)}: ${fmtDetail(k, v, a, l)}`)
    .join(" · ");
}

// ---------------------------------------------------------------- Interna regler (ändringshistorik)
/** Ögonblicksbild av reglerna för påminnelser och eskalering (sparas i revisionsloggen före och efter en ändring). */
export type RuleSnapshot = { remind: number; esc: number; to: string[]; channels: string[]; assign: string[] };
const isSnapshot = (v: unknown): v is RuleSnapshot => !!v && typeof v === "object" && "remind" in v && "esc" in v;

const ESC_WORD: Record<string, string> = { chef: "chef/controller", avtalsansvarig: "avtalsansvarig", samordnare: "samordnare" };
export const escWord = (r: string): string => ESC_WORD[r] ?? r;
export const weeksWord = (n: number): string => (n === 1 ? "1 vecka" : `${n} veckor`);
const chWord = (c: string) => (c === "app" ? "appen" : "e-post");

/** "Påminnelse efter 1 vecka → 2 veckor; mottagare chef/controller → chef/controller, avtalsansvarig". */
export function ruleDiffText(a: RuleSnapshot, b: RuleSnapshot): string {
  const parts: string[] = [];
  if (a.remind !== b.remind) parts.push(`påminnelse efter ${weeksWord(a.remind)} → ${weeksWord(b.remind)}`);
  if (a.esc !== b.esc) parts.push(`eskalering efter ${weeksWord(a.esc)} → ${weeksWord(b.esc)} i rad`);
  if (a.to.join() !== b.to.join()) parts.push(`mottagare ${a.to.map(escWord).join(", ")} → ${b.to.map(escWord).join(", ")}`);
  if (a.channels.join() !== b.channels.join()) parts.push(`kanaler ${a.channels.map(chWord).join(" och ")} → ${b.channels.map(chWord).join(" och ")}`);
  if ((a.assign ?? []).join() !== (b.assign ?? []).join()) parts.push(`kanaler vid tilldelning → ${(b.assign ?? []).map(chWord).join(" och ")}`);
  return parts.length ? cap(parts.join("; ")) : "Inga ändringar";
}

// ---------------------------------------------------------------- Bakgrundsjobb
export const JOB_NAME: Record<string, string> = {
  inbox: "Läs avrop@-inkorgen", weekly: "Publicera veckorapporter", att_remind: "Påminnelser om närvaroregistrering", progress: "Progressionspåminnelser",
  audio: "Radera ljud efter transkribering", transcripts: "Radera råtranskript", kpi: "Beräkna nyckeltal", retention: "Gallring enligt PUB-avtalet",
};
export const JOB_KEYS = ["inbox", "weekly", "att_remind", "progress", "audio", "transcripts", "kpi", "retention"] as const;
export type JobKey = (typeof JOB_KEYS)[number];

/** Visningar och exporter som chef/controller stickprovar i första hand (SPEC §10). */
export const VIEW_ACTIONS = ["case.view", "pnr.revealed", "report.view", "transcript.view"] as const;
