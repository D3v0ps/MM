// Revisionsloggen i klarspråk: åtgärdskoder, objekt och detaljer som läsbar svenska (SPEC: klarspråk).
// Isomorf och utan I/O – hanteraren skickar in uppslagen (namn på användare, ärendenummer, rapporter).
// Texterna är exakt den gamla prototypens (prototyp/src/views/admin.js, ACTION_LABEL m.fl.).
import { fileSizeText } from "@/core/attachments";
import { attLabel, endReasonLabel, eventLabel, reportKindLabel } from "@/core/labels";
import { fmtDate, fmtDateTime, fmtWeekKey, monthName } from "@/core/time";
import { prioLabel, statusLabel, typeLabel } from "@/features/synpunkter/model";
import { DATASET_LABEL, DIMENSION_LABEL, MEASURE_LABEL, OUTPUT_LABEL, SPLIT_LABEL } from "@/features/rapporter/builder/definition";
import { templateFor } from "@/features/rapporter/builder/templates";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const ACTION_LABEL: Record<string, string> = {
  "case.view": "Visade deltagarkort", "pnr.revealed": "Visade personnummer", "report.view": "Visade rapport", "transcript.view": "Visade transkript",
  "voice_note.view": "Visade röstmeddelanden",
  "case.created": "Skapade ärende", "case.accepted": "Accepterade avrop", "case.declined": "Avböjde avrop", "case.updated": "Ändrade ärende",
  "case.buyer_reference_changed": "Ändrade beställarreferens", "case.first_meeting_booked": "Bokade första möte", "case.coach_changed": "Bytte huvudcoach", "case.closed": "Avslutade ärende",
  "email.received": "Tog emot mejl", "email.handled": "Hanterade mejl", "email.linked": "Kopplade mejl till ärende", "email.supplement_applied": "Förde in komplettering",
  "attendance.registered": "Registrerade närvaro", "attendance.registered_all": "Registrerade närvaro för flera tillfällen", "report.published": "Publicerade veckorapport", "report.approved": "Godkände rapport", "report.delivered": "Levererade rapport", "report.corrected": "Rättade rapport",
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
  // Fakturan per avtal och månad (beslut 2026-10-07): ekonomen fyller i kommunens referens och inköpsordernummer per faktura.
  "billing.buyer_reference_set": "Fyllde i beställarreferens på faktura", "billing.purchase_order_set": "Fyllde i inköpsordernummer på faktura",
  "task.created": "Skapade uppgift", "task.updated": "Ändrade uppgift", "task.done": "Markerade uppgift som klar", "auth.login": "Loggade in", "contract_deviation.created": "Registrerade avtalsavvikelse", "contract_deviation.updated": "Ändrade avtalsavvikelse",
  "contract_deviation.action_plan_approved": "Åtgärdsplanen godkänd av kommunen", "contract_deviation.closed": "Stängde avtalsavvikelse", "report.quality_reviewed": "Kvalitetsgranskade rapport", "report.final_text_saved": "Sparade slutrapportens text",
  "report.summary_saved": "Sparade sammanfattning i rapport", "report.correction_reason": "Angav orsak till rättelse", view: "Visade",
  "report.downloaded": "Laddade ner rapport", "report.created": "Skapade rapportutkast",
  // Synpunkter i testmiljön (src/features/synpunkter) – finns inte i prototypen.
  "feedback.created": "Lämnade synpunkt", "feedback.replied": "Svarade på synpunkt", "feedback.status_changed": "Ändrade status på synpunkt",
  // Fria anteckningar i deltagarkortet (rapporter steg 2) – finns inte i prototypen. Loggen har bara id:n, aldrig texten.
  "case_note.created": "Skrev anteckning", "case_note.updated": "Ändrade anteckning", "case_note.removed": "Tog bort anteckning",
  "case_note.used_in_summary": "Använde anteckning i sammanfattningen",
  // Kommunens resultatfil (rapporter steg 3). Loggen har id:n, period, antal och kolumnnamn – aldrig namn eller ärendenummer.
  "export.results": "Exporterade resultat", "export.results_blocked": "Stoppade resultatfilen", "report.facts_drift": "Rapportens fakta kunde inte föras tillbaka helt",
  // Rapportbyggaren (rapporter steg 4). Loggen har id:n, period, antal och vad rapporten räknar – aldrig titlar, namn,
  // ärendenummer eller urvalets värden.
  "saved_report.created": "Sparade rapport", "saved_report.updated": "Ändrade sparad rapport", "saved_report.shared": "Ändrade delning av rapport",
  "saved_report.archived": "Arkiverade rapport", "saved_report.viewed": "Visade sparad rapport", "export.saved_report": "Exporterade rapport",
  "saved_report.export_blocked": "Stoppade rapportfil", "export.results_mb": "Exporterade resultat för hela avtalet",
  // Beslut 2026-10-07: självregistrering, egna uppgifter i portalen och bilagor till beställningen. Loggen har id:n, typ,
  // storlek och domän – aldrig e-postadresser eller filnamn.
  "profile.self_registered": "Skapade konto själv", "auth.self_registration_started": "Begärde kod för nytt konto", "profile.updated": "Ändrade egna uppgifter",
  "attachment.upload_started": "Började ladda upp bilaga", "attachment.uploaded": "Laddade upp bilaga", "attachment.rejected": "Bilaga togs inte emot",
  "attachment.linked": "Kopplade bilagor till beställningen", "attachment.removed": "Tog bort bilaga", "attachment.viewed": "Hämtade bilaga", "attachment.deleted": "Raderade bilaga",
  // Skarp drift (beslut 2026-10-08): kollegorna läggs till och får roller i appen; rollväxling; avtalsansvarig väljs på avtalssidan.
  // Loggen har bara id:n, roller och domänen – aldrig namn eller adresser.
  "staff_user.added": "Lade till kollega", "staff_user.roles_changed": "Ändrade kollegas roller", "staff_user.blocked": "Spärrade kollega", "staff_user.reactivated": "Aktiverade kollega",
  "role.switched": "Bytte roll", "contract.manager_changed": "Bytte avtalsansvarig",
  // Beslut 4 (2026-10-08): beställningar registrerade i inkorgen (mejl, telefon eller annan väg). Loggen har id:n och kanal.
  "email.registered": "Registrerade beställning i inkorgen",
};
/** Okänd åtgärdskod blir läsbar text i stället för kod: "billing.new_thing" → "Billing new thing". */
export const actionLabel = (code: string | null | undefined): string => ACTION_LABEL[code ?? ""] ?? cap(String(code || "").replace(/[._]/g, " "));

export const ENTITY_LABEL: Record<string, string> = {
  customer_user: "Kommunanvändare", contract_deviation: "Avtalsavvikelse", task: "Uppgift", case: "Ärende", person: "Person", report: "Rapport", inbound_email: "Mejl", ai_run: "AI-körning",
  attendance: "Närvaro", check_in: "Avstämning", deviation: "Avvikelse", monthly_assessment: "Månadsbedömning", intake_assessment: "Kartläggning", outcome_event: "Händelse", alert: "Flagga",
  consent: "Samtycke", billing_run: "Fakturakörning", contract: "Avtal", org_config: "Interna regler", profile: "Användare", template: "Mall", job: "Bakgrundsjobb", audit_log: "Revisionslogg",
  pulse_response: "Pulssvar", employer: "Arbetsgivare", placement: "Praktikplats", feedback: "Synpunkt", case_note: "Anteckning",
  saved_report: "Sparad rapport", case_attachment: "Bilaga", invoice: "Faktura",
};
/** Objektets typ i tabellen: "Ärende", "Mall" … Okänd typ blir läsbar text. */
export const entityLabel = (entity: string | null | undefined): string => ENTITY_LABEL[entity ?? ""] ?? cap(String(entity || "").replace(/_/g, " "));

const DETAIL_KEY: Record<string, string> = {
  number: "Ärendenummer", source: "Kanal", parseMethod: "Tolkning", template: "Mall", to: "Till", from: "Från", kind: "Typ", provider: "Leverantör", reason: "Orsak", status: "Status",
  linkedProfile: "Handläggare med konto", receivedOn: "Mottagen dag", attachments: "Bilagor", linkedCases: "Kopplade ärenden",
  month: "Månad", week: "Vecka", count: "Antal", format: "Format", rows: "Rader", role: "Roll", unit: "Enhet", domain: "Domän", version: "Version", language: "Språk",
  contactRequested: "Vill bli kontaktad", right: "Rätt", value: "Värde", date: "Datum", areas: "Områden", checked: "Kontrollerade poster", deviations: "Avvikelser", withinSla: "Inom SLA",
  leadCoachId: "Huvudcoach", firstMeetingAt: "Första möte", fields: "Fält", missing: "Saknas", classification: "Klassning", via: "Via", kpi: "Nyckeltal", window: "Period",
  audioDeleted: "Ljud raderat", automatic: "Automatiskt", waiting: "Väntar", endReason: "Avslutsorsak", resultClass: "Resultatklass", channel: "Kanal", note: "Anteckning",
  plan: "Åtgärdsplan", filter: "Filter", aiUsed: "AI använd", fromCheckIn: "Från avstämning", deviationId: "Avvikelse", invoiceNo: "Fakturanummer", idempotencyKey: "Idempotensnyckel",
  idempotencyKeys: "Idempotensnycklar", by: "Av", previous: "Tidigare version", at: "Tidpunkt", created: "Skapade", skippedAlreadyCreated: "Redan skapade",
  skippedDuplicates: "Dubbletter som hoppades över", blocked: "Stoppade", notApproved: "Inte godkända", changed: "Ändrade", buyerReference: "Beställarreferens", toRole: "Till roll",
  caseIds: "Ärenden", emailId: "Mejl", method: "Inloggning", hadCustomerApproval: "Godkänd av kommunen", type: "Typ", level: "Nivå", step: "Steg", sentToCustomer: "Skickad till kommunen",
  acknowledged: "Kvitterad", parse: "Tolkning", priority: "Hur viktigt", replyId: "Svar", authorId: "Skriven av", roles: "Roller",
  table: "Tabell", cases: "Antal deltagare", schema: "Schemaversion", columns: "Kolumner", reportIds: "Rapporter",
  savedReportId: "Sparad rapport", dataset: "Uppgifter", audience: "Visning", output: "Visas som", measures: "Mått", groupBy: "Dela upp efter",
  split: "Dela upp per tid", sharingFrom: "Delning före", sharingTo: "Delning efter", column: "Kolumn", visibility: "Delning",
  day: "Dag", activityIds: "Tillfällen", attendanceIds: "Närvaroposter", skippedActivityIds: "Redan registrerade", contractIds: "Avtal", autosave: "Automatiskt",
  mimeType: "Filtyp", bytes: "Storlek", attachmentId: "Bilaga", attachmentIds: "Bilagor", how: "Hur", approvedOn: "Godkänd",
  // Första mötet (beslut 7, 2026-10-08): ombokning räknar om slutdatumet och ger en ny orderbekräftelse.
  rebooked: "Ombokat", plannedEnd: "Planerat slut", plannedWeeks: "Planerade veckor",
};
/** Kodvärden i loggen som läsbar svenska. Nyckelberoende först, sedan generella ord. */
const FIELD_WORD: Record<string, string> = {
  buyerReference: "beställarreferens", purchaseOrderNumber: "inköpsordernummer", primaryArea: "avtalsområde", secondaryArea: "andra avtalsområde", vocationalTrack: "yrkesspår",
  desiredStart: "önskad start", plannedWeeks: "antal veckor", plannedEnd: "planerat slut", plannedEndDate: "planerat slut", startDate: "startdatum", endDate: "slutdatum",
  backgroundInfo: "bakgrund", aiConsent: "AI-samtycke", meetingDay: "mötesdag", meetingTime: "mötestid", location: "plats", ordererContact: "beställarens kontaktuppgifter",
  referrerId: "handläggare", leadCoachId: "huvudcoach", phase: "fas", tags: "taggar", pausedWeeks: "pausade veckor", firstMeetingAt: "första möte", team: "team", status: "status",
  area: "avtalsområde", unit: "enhet", contactName: "kontaktperson", contactPhone: "telefon", contactEmail: "e-post", person: "deltagare",
  primaryAreaCode: "avtalsområde", secondaryAreaCode: "andra avtalsområde", referrerUnit: "beställarens enhet", events: "händelser", weeks: "veckor",
  endReason: "avslutsorsak", resultClass: "resultatklass", resultVerified: "verifiering", resultVerifiedAt: "verifieringsdatum", caseNumber: "ärendenummer",
};
const WINDOW: Record<string, string> = { rolling_6m: "rullande 6 månader", since_start: "sedan avtalsstart", month: "per månad", rolling_3m: "rullande 3 månader" };
const VALUE_BY_KEY: Record<string, Record<string, string>> = {
  parseMethod: { template: "Word-mall", ai: "AI", manual: "manuellt", freetext: "fritext" },
  source: { email: "e-post", portal: "portalen", phone: "telefon", manual: "manuellt" },
  channel: { email: "e-post", sms: "SMS", portal: "portalen", app: "appen", brev: "brev", letter: "brev", outside_portal: "utanför Miljonmatch", phone: "telefon", other: "annan väg" },
  window: WINDOW,
  by: { customer: "kommunen", coach: "coachen", system: "systemet", registered_by_mb: "kommunen (registrerat av Miljonbemanning)" },
  how: { möte: "på ett möte", brev: "med brev eller e-post", telefon: "på telefon", annat: "på annat sätt" },
  mimeType: {
    "application/pdf": "PDF", "application/msword": "Word", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
    "image/jpeg": "bild (JPEG)", "image/png": "bild (PNG)", "image/heic": "bild (HEIC)",
  },
  method: { email_otp: "e-post och engångskod", entra: "Microsoft Entra ID" },
  role: { handlaggare: "handläggare", chef: "chef", admin: "systemadmin", avtalsansvarig: "avtalsansvarig", samordnare: "samordnare", coach: "coach", handledare: "handledare", ekonom: "ekonom" },
  toRole: { samordnare: "samordnare", avtalsansvarig: "avtalsansvarig", chef: "chef", coach: "coach", kommun_handlaggare: "kommunens handläggare" },
  language: { sv: "svenska", en: "engelska", ar: "arabiska", so: "somaliska" },
  right: { uppgift: "rätt arbetsuppgift", handledning: "rätt handledning", timing: "rätt tidpunkt", uppfoljning: "rätt uppföljning" },
  format: { csv: "CSV", xlsx: "Excel", pdf: "PDF", sie: "SIE", peppol: "Peppol" },
  table: { alla: "alla flikar", resultat: "resultat", progression: "progression", handelser: "händelser", avslut: "avslut", faltbeskrivning: "fältbeskrivning" },
  reason: {
    columns_changed: "kolumnerna har ändrats – schemaversionen behöver höjas", column_missing: "en kolumn finns inte längre", too_large: "filen blev för stor",
    unlinked_24h: "uppladdad men inte skickad inom 24 timmar", retention: "gallring efter avslut eller avböjande (regeln togs bort 2026-10-08)", removed: "borttagen",
    orphan: "fil i lagringen utan bilaga (avstämning)", first_meeting_rebooked: "första mötet bokades om – ny version av orderbekräftelsen",
  },
  // "customer" och "kommun" finns bara i loggrader före 2026-10-07 (kommunens chef är borttagen).
  sharingFrom: { private: "Bara ägaren", mb: "Miljonbemanning i avtalet", customer: "Kommunens chef", __new: "Ny rapport" },
  sharingTo: { private: "Bara ägaren", mb: "Miljonbemanning i avtalet", customer: "Kommunens chef" },
  visibility: { private: "Bara ägaren", mb: "Miljonbemanning i avtalet", customer: "Kommunens chef" },
  audience: { mb: "Miljonbemanning", kommun: "Kommunens chef" },
  output: OUTPUT_LABEL,
  dataset: DATASET_LABEL,
  split: SPLIT_LABEL,
  groupBy: DIMENSION_LABEL,
  measures: MEASURE_LABEL,
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
  // Synpunkter i testmiljön: typ, hur viktigt och status med samma etiketter som dialogen (src/features/synpunkter/model.ts).
  if (a.entity === "feedback") {
    if (k === "type") return typeLabel(s);
    if (k === "priority") return prioLabel(s);
    if (k === "from" || k === "to") return statusLabel(s);
  }
  // Rapportbyggarens mallar (nycklar i koden) – inte utskickens mallar.
  if (k === "template" && (a.entity === "saved_report" || a.action === "export.saved_report")) return templateFor(s)?.name ?? s;
  if (k === "template") return l.templateLabel(s);
  if (["fields", "checked", "missing"].includes(k)) return FIELD_WORD[s] ?? s;
  if (k === "kind") return kindWord(a, s);
  if (k === "kpi") return l.kpiLabel(s) ?? s;
  if (k === "bytes" && Number.isFinite(Number(s))) return fileSizeText(Number(s));
  if (k === "endReason") return endReasonLabel(s);
  if (k === "status" && (a.action === "attendance.registered" || a.action === "attendance.registered_all")) return attLabel(s);
  if (k === "status") return STATUS_WORD[s] ?? s;
  if (VALUE_BY_KEY[k]?.[s]) return VALUE_BY_KEY[k][s];
  if (/^(u|k)-[a-z]+$/.test(s)) return l.userName(s) ?? "–";
  if (/^case-\d+$/.test(s)) return l.caseNumber(s) ?? s;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return fmtDateTime(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtDate(s);
  if (/^\d{4}-W\d{2}$/.test(s)) return fmtWeekKey(s);
  if (/^\d{4}-\d{2}$/.test(s) && (k === "month" || (a.action.startsWith("export.") && (k === "from" || k === "to")))) return monthName(s);
  return s;
}

/** Långa listor som visas som antal i loggtabellen ("74 rapporter") och i sin helhet i detaljvyn. */
const COUNTED: Record<string, [string, string]> = {
  columns: ["kolumn", "kolumner"], reportIds: ["rapport", "rapporter"], measures: ["mått", "mått"],
  activityIds: ["tillfälle", "tillfällen"], attendanceIds: ["närvaropost", "närvaroposter"], skippedActivityIds: ["tillfälle", "tillfällen"], caseIds: ["ärende", "ärenden"],
};

/**
 * Detaljerna i en loggrad som läsbar text: "Tolkning: Word-mall · Kanal: e-post". full = hela listorna (detaljvyn) i stället
 * för antal (tabellen).
 */
export function detailText(a: AuditEntryLike, l: AuditLookups, opts: { full?: boolean } = {}): string {
  // En ny sparad rapport som delas direkt: "Delning före: Ny rapport" (värdet null visas annars inte).
  const x = a.action === "saved_report.shared" && a.details?.sharingFrom === null ? { ...a.details, sharingFrom: "__new" } : (a.details ?? {});
  if (a.action === "org_rule.updated" && isSnapshot(x.from) && isSnapshot(x.to)) return ruleDiffText(x.from, x.to);
  return Object.entries(x)
    .filter(([k, v]) => v != null && v !== "" && k !== "caseId" && k !== "editSession" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => {
      const counted = COUNTED[k];
      const text = counted && Array.isArray(v) && !opts.full ? `${v.length} ${v.length === 1 ? counted[0] : counted[1]}` : fmtDetail(k, v, a, l);
      return `${DETAIL_KEY[k] ?? cap(FIELD_WORD[k] ?? k)}: ${text}`;
    })
    .join(" · ");
}

/** Har loggraden listor som tabellen visar som antal (och som detaljvyn visar i sin helhet)? */
export const hasFullDetail = (a: Pick<AuditEntryLike, "details">): boolean => {
  const x = a.details ?? {};
  return Object.keys(COUNTED).some((k) => Array.isArray(x[k]) && (x[k] as unknown[]).length > 0);
};

/** Hela detaljtexten när den skiljer sig från tabellens (listor som visas som antal), annars null. */
export function detailFullText(a: AuditEntryLike, l: AuditLookups): string | null {
  if (!hasFullDetail(a)) return null;
  return detailText(a, l, { full: true });
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
export const VIEW_ACTIONS = ["case.view", "pnr.revealed", "report.view", "transcript.view", "saved_report.viewed"] as const;
