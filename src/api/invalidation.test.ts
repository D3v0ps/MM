// Exakt omräkning per kommando (D2 punkt 5): varje kommando anger i kontraktet vilka frågor det räknar om (CommandDef.invalidates).
// Mängden ska bestämmas av vilka tabeller kommandot skriver – prototypen (staleTime oändlig) hämtar aldrig om en fråga som
// inte räknas om. Testet mäter därför vilka tabeller varje fråga läser (MemoryRepo.table spåras medan frågan körs mot
// testdatat) och jämför med vad varje kommando skriver (deklarerat nedan ur hanterarna). För varje par (kommando, fråga)
// med gemensam tabell måste frågans nyckel matcha kommandots invalidates. Frågor utan exempel nedan stoppar testet, så
// listan hålls komplett när nya frågor tillkommer.
//
// Tre avgränsningar gör kontrollen träffsäker i stället för "allt läser allt":
//   1. Bara innehållsläsningar räknas (list, first, count, pick): en fråga som bara slår upp en rad med get(id) (ärendet
//      för åtkomstkontrollen, rapporten för en länk) visar inte tabellens innehåll.
//   2. Tabeller som nästan varje fråga läser för namn, åtkomst och konfiguration (LOOKUP_TABLES) räknas inte – de
//      kommandon som skriver dem anger sina mängder för hand (planen 5.3) och kontrolleras i det första testet.
//   3. Bara frågor som någon av kommandots roller själv kan köra räknas: en annan användare har egen cache (appen hämtar
//      om efter 20 s och vid fokus; prototypen byter persona med ny QueryClient).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import { MemoryRepo } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { AnyDef, CommandDef, QueryDef } from "./contract";
import { isSilentCommand, rolesOf } from "./handlers";

const apis = {
  ...(import.meta.glob("../features/*/api.ts", { eager: true }) as Record<string, Record<string, unknown>>),
  ...(import.meta.glob("../features/session/nav-api.ts", { eager: true }) as Record<string, Record<string, unknown>>),
};
const defs = (kind: "query" | "command") =>
  Object.values(apis)
    .flatMap((m) => Object.values(m))
    .filter((v): v is AnyDef => !!v && typeof v === "object" && (v as AnyDef).kind === kind && typeof (v as AnyDef).key === "string");
const queries = () => defs("query") as QueryDef<unknown, unknown>[];
const commands = () => defs("command") as CommandDef<unknown, unknown>[];

const NADIA = "case-260143";
type Sample = { actor: string; params: unknown; testerId?: string };
const one = (actor: string, params: unknown = {}): Sample[] => [{ actor, params }];
/**
 * Exempel per fråga: testperson och parametrar som ger ett riktigt svar (inte null). Frågor med rollgrenar (t.ex.
 * navCounts) körs som flera personer, så att alla grenars tabeller räknas.
 */
const SAMPLES: Record<string, Sample[]> = {
  "admin.contract": one("u-robin"), "admin.orgRules": one("u-robin"), "admin.users": one("u-robin"),
  "admin.integrations": one("u-robin"), "admin.templates": one("u-robin"), "admin.auditLog": [...one("u-robin"), ...one("u-karin")],
  "admin.auditDetail": one("u-robin", { id: "__first_log__" }),
  "arenden.lista": [...one("u-sara"), ...one("u-amira"), ...one("u-petra")], "arenden.kort": [...one("u-amira", { caseId: NADIA }), ...one("u-sara", { caseId: NADIA })],
  "arenden.kortOversikt": one("u-amira", { caseId: NADIA }), "arenden.kortKartlaggning": one("u-amira", { caseId: NADIA }),
  "arenden.kortAvstamningar": one("u-amira", { caseId: NADIA }), "arenden.kortNarvaro": one("u-amira", { caseId: NADIA }),
  "arenden.kortTidslinje": [...one("u-amira", { caseId: NADIA, visa: "alla" }), ...one("u-petra", { caseId: "case-260167", visa: "alla" })],
  "arenden.kortTidslinjeText": [...one("u-amira", { caseId: NADIA, id: "msg:msg-3" }), ...one("u-amira", { caseId: NADIA, id: "ci:ci-12498" })],
  "arenden.kortManad": one("u-amira", { caseId: NADIA, manad: "2027-01" }), "arenden.kortHandelser": one("u-amira", { caseId: NADIA }),
  "arenden.kortAvvikelser": one("u-amira", { caseId: "case-260148" }), "arenden.kortPraktik": one("u-amira", { caseId: NADIA }),
  "arenden.kortRapporter": one("u-amira", { caseId: NADIA }), "arenden.kortMeddelanden": one("u-amira", { caseId: NADIA }),
  "arenden.kortHistorik": [...one("u-amira", { caseId: NADIA }), ...one("u-karin", { caseId: NADIA })], "arenden.handledare": one("u-petra"),
  "coach.recordingState": one("u-amira", { aiRunId: "ai-run-mehmet" }), "coach.minVecka": one("u-amira"), "coach.narvaro": [...one("u-amira"), ...one("u-petra")],
  "coach.casePicker": [...one("u-amira", { kind: "avstamning" }), ...one("u-amira", { kind: "manad", month: "2027-01" }), ...one("u-amira", { kind: "kartlaggning" }), ...one("u-amira", { kind: "handelse" })],
  "coach.checkInPage": [...one("u-amira", { caseId: NADIA }), ...one("u-amira", { caseId: "case-260130" })],
  "coach.checkInAttendance": one("u-amira", { caseId: NADIA, date: "2027-01-28" }), "coach.aiRunInfo": one("u-amira", { runId: "ai-run-mehmet" }),
  "coach.checkInReceipt": one("u-amira", { caseId: NADIA, checkInId: "ci-12498" }), "coach.assessmentPage": one("u-amira", { caseId: NADIA, month: "2027-01" }),
  "coach.intakePage": one("u-amira", { caseId: NADIA }), "coach.eventsPage": one("u-amira", { caseId: NADIA }),
  "ekonomi.run": one("u-lars", { month: "2027-01" }), "ekonomi.line": one("u-lars", { month: "2027-01", caseId: NADIA }), "ekonomi.csv": one("u-lars", { month: "2027-01" }),
  "ekonomi.preview": one("u-lars", { month: "2027-01", caseId: NADIA }), "ekonomi.case": one("u-lars", { caseId: NADIA }), "ekonomi.caseList": one("u-lars"), "ekonomi.priceList": one("u-lars"), "ekonomi.start": one("u-lars"),
  "inkorg.list": one("u-sara"), "inkorg.item": [...one("u-sara", { id: "em-103" }), ...one("u-sara", { id: "em-101" }), ...one("u-sara", { id: "em-105" }), ...one("u-sara", { id: "em-104" })], "inkorg.confirmation": one("u-sara", { caseId: "case-270049" }),
  "inkorg.decisionForm": one("u-sara", { caseId: "case-270050" }), "inkorg.duplicateCheck": one("u-sara", { pnr: "19900101-1234" }),
  "inkorg.start": one("u-sara"), "inkorg.deadlines": one("u-sara"), "inkorg.registerForm": [...one("u-sara"), ...one("u-sara", { emailId: "em-102" })],
  "kommun.start": one("k-maria"), "kommun.bestallning": one("k-maria"), "kommun.dubblett": one("k-maria", { pnr: "19900101-1234" }),
  "kommun.kvitto": one("k-maria", { caseId: NADIA }), "kommun.deltagareLista": one("k-maria"), "kommun.deltagare": one("k-maria", { caseId: NADIA }),
  "kommun.rapporter": one("k-maria"), "kommun.profil": one("k-maria"), "kommun.dictationOptions": one("k-maria", { caseId: NADIA }),
  "kommun.dictationState": one("k-maria", { aiRunId: "ai-run-mehmet" }),
  "ledning.head": one("u-karin"), "ledning.overview": one("u-karin"), "ledning.coaches": one("u-karin"), "ledning.areas": one("u-karin"), "ledning.pulse": one("u-karin"),
  "ledning.cdevRegister": one("u-karin"), "ledning.cdevDetail": one("u-karin", { id: "cd-2" }), "ledning.cdevMonth": one("u-karin", { month: "2027-01" }),
  "notiser.list": [...one("u-amira"), ...one("u-sara")], "praktik.list": one("u-amira"), "praktik.employer": one("u-amira", { employerId: "emp-1" }),
  "puls.link": one("deltagare", {}),
  "rapporter.lista": [...one("u-sara"), ...one("u-amira")], "rapporter.dokument": one("u-sara", { reportId: "rep-16008" }), "rapporter.visa": [...one("u-sara", { reportId: "rep-16008" }), ...one("u-sara", { reportId: "rep-16011" })],
  "rapporter.byggKatalog": one("u-sara"), "rapporter.sparadeLista": one("u-sara"), "rapporter.sparad": one("u-sara", { savedReportId: "sr-seed-privat" }),
  "rapporter.resultatfilForhandsvisning": one("u-johan", { from: "2026-12", to: "2027-01" }),
  "rost.link": one("deltagare", {}), "rost.sendStatus": one("deltagare", { aiRunId: "ai-run-mehmet" }), "rost.caseVoice": one("u-amira", { caseId: NADIA }), "rost.pendingNotes": one("u-amira"),
  "session.ping": one("u-amira"), "session.navCounts": [...one("u-amira"), ...one("u-sara"), ...one("u-karin"), ...one("k-maria")],
  "feedback.list": [{ actor: "u-johan", params: {}, testerId: "tester-karim" }],
  // Nivåer, grupper och taggar och massanteckningar (coachmötet 2026-10-09).
  "grupper.katalog": [...one("u-sara", { arkiverade: true }), ...one("u-amira")], "grupper.arende": one("u-amira", { caseId: NADIA }), "grupper.filter": one("u-amira"),
  "grupper.anteckningar": [...one("u-amira", { urval: "mina" }), ...one("u-amira", { urval: "grupp", id: "grp-c-bot-g-mandag" })],
};

/**
 * Tabeller varje kommando skriver (ur hanterarna, inklusive hjälpare: publishWeeklyIfComplete → reports, customerDecisionTask
 * → tasks, notifyAssignment → user_notifications, utskick → outbound_messages, bakgrundsjobb → jobs). Revisionsloggen taggas
 * efter vilka läsare raden når: "audit_log:case" (raden hör till ett ärende och syns i kortets Historik), "audit_log:export"
 * (export.results – kommunens kolumnspärr), "audit_log:audio" (audio.deleted – integrationssidan), "audit_log:org_rule"
 * (interna regler) och "audit_log" (bara den fullständiga loggen hos chef och systemadministratör).
 */
const AUDIT = "audit_log";
const AUDIT_CASE = "audit_log:case";
const WRITES: Record<string, string[]> = {
  "admin.setOrgRule": ["org_settings", "audit_log:org_rule", AUDIT], "admin.runJob": ["*"], "admin.logCheck": ["log_checks", AUDIT], "admin.saveTemplate": ["template_versions", AUDIT],
  "admin.inviteCustomer": ["profiles", "memberships", "outbound_messages", AUDIT], "admin.setCustomerActive": ["profiles"],
  // Kollegorna och rollväxlingen (beslut 2026-10-08).
  "admin.inviteStaff": ["profiles", "memberships", "outbound_messages", AUDIT], "admin.setStaffRoles": ["memberships", AUDIT], "admin.setStaffActive": ["profiles", AUDIT],
  "admin.setContractManager": ["contracts", AUDIT], "session.vaxlaRoll": ["role_choices", AUDIT],
  "arenden.caseCreate": ["persons", "case_counters", "cases", "tasks", "outbound_messages", "case_attachments", "profiles", AUDIT_CASE, AUDIT],
  "arenden.bilagaStart": ["case_attachments", AUDIT], "arenden.bilagaKlar": ["case_attachments", AUDIT], "arenden.bilagaTaBort": ["case_attachments", AUDIT],
  "arenden.bilagaHamta": [AUDIT],
  "arenden.caseAccept": ["cases", "reports", "inbound_emails", "case_team", "user_notifications", "outbound_messages", AUDIT_CASE, AUDIT],
  "arenden.caseDecline": ["cases", "inbound_emails", "outbound_messages", AUDIT_CASE, AUDIT], "arenden.caseUpdate": ["cases", AUDIT_CASE, AUDIT],
  "arenden.caseSetBuyerRef": ["cases", AUDIT_CASE, AUDIT], "arenden.caseBookFirstMeeting": ["cases", "reports", "outbound_messages", AUDIT_CASE, AUDIT],
  "arenden.caseChangeCoach": ["cases", "case_team", "user_notifications", "outbound_messages", AUDIT_CASE, AUDIT],
  "arenden.caseClose": ["cases", "reports", "pulse_invites", AUDIT_CASE, AUDIT], "arenden.messageSend": ["messages", "user_notifications", "outbound_messages", AUDIT_CASE, AUDIT],
  // Starta insatsen, veckoplan, tillfällen och team (beslut 2026-10-08).
  "arenden.caseStart": ["cases", "activities", "case_status_history", AUDIT_CASE, AUDIT], "arenden.caseScheduleChange": ["cases", "activities", AUDIT_CASE, AUDIT],
  "arenden.activityAdd": ["activities", AUDIT_CASE, AUDIT], "arenden.activityRemove": ["activities", AUDIT_CASE, AUDIT],
  "arenden.caseSetTeam": ["case_team", "user_notifications", "outbound_messages", AUDIT_CASE, AUDIT],
  "arenden.messageRead": ["messages"], "arenden.consentSet": ["consents", "cases", AUDIT_CASE, AUDIT], "arenden.noteSave": ["case_notes", AUDIT_CASE, AUDIT],
  "arenden.noteRemove": ["case_notes", AUDIT_CASE, AUDIT], "arenden.visaPersonnummer": [AUDIT_CASE, AUDIT],
  "coach.attendanceSet": ["attendance", "reports", "outbound_messages", AUDIT_CASE, AUDIT],
  "coach.attendanceSetAll": ["attendance", "reports", "outbound_messages", AUDIT_CASE, AUDIT],
  "coach.checkinSave": ["check_ins", "cases", "ai_field_decisions", "ai_runs", "deviations", "tasks", AUDIT_CASE, AUDIT],
  "coach.deviationSave": ["deviations", "tasks", AUDIT_CASE, AUDIT], "coach.deviationCallCustomer": ["deviations", "messages", "outbound_messages", AUDIT_CASE, AUDIT],
  "coach.assessmentSave": ["monthly_assessments", "monthly_plans", "reports", AUDIT_CASE, AUDIT], "coach.intakeSave": ["intake_assessments", "cases", AUDIT_CASE, AUDIT],
  "coach.eventAdd": ["outcome_events", "audit_log:event", AUDIT_CASE, AUDIT], "coach.resultVerify": ["cases", "outcome_events", AUDIT_CASE, AUDIT],
  "coach.aiRun": ["ai_runs", "audit_log:audio", AUDIT_CASE, AUDIT], "coach.recordingFinish": ["ai_runs", "jobs", "check_ins", "audio_uploads", "audit_log:audio", AUDIT_CASE, AUDIT],
  "coach.monthlyDraft": ["ai_runs", "jobs", AUDIT_CASE, AUDIT],
  "ekonomi.billingApproveZeroWeek": ["billing_week_approvals", AUDIT_CASE, AUDIT], "ekonomi.billingApproveInvoice": ["invoice_drafts", AUDIT],
  "ekonomi.billingSendFortnox": ["invoice_drafts", "invoice_lines", "fortnox_runs", AUDIT], "ekonomi.billingMarkManual": ["invoice_drafts", "invoice_lines", AUDIT],
  "ekonomi.billingExport": [AUDIT], "ekonomi.invoiceSetBuyerRef": ["invoice_drafts", AUDIT], "ekonomi.invoiceSetPo": ["invoice_drafts", AUDIT],
  "ekonomi.fortnoxSync": ["fortnox_runs", "invoice_drafts", AUDIT], "ekonomi.reissue": ["invoice_credits", "invoice_drafts", AUDIT],
  "ekonomi.taskDone": ["tasks", AUDIT], "ekonomi.askCoordinator": ["tasks", AUDIT], "ekonomi.closeRun": ["billing_runs", AUDIT],
  "inkorg.emailSetStatus": ["inbound_emails", AUDIT_CASE, AUDIT], "inkorg.emailApplySupplement": ["cases", "inbound_emails", AUDIT_CASE, AUDIT],
  "inkorg.correct": ["cases", "inbound_emails", AUDIT_CASE, AUDIT],
  "inkorg.taskDone": ["tasks", AUDIT], "inkorg.revealPnr": [AUDIT_CASE, AUDIT],
  // Registrera beställning (beslut 4a): samma rader som caseCreate plus mejlet.
  "inkorg.register": ["persons", "case_counters", "cases", "case_status_history", "inbound_emails", "outbound_messages", "case_attachments", AUDIT_CASE, AUDIT],
  "kommun.caseSeen": ["case_seen"], "kommun.taskDone": ["tasks", AUDIT], "kommun.visaPersonnummer": [AUDIT_CASE, AUDIT], "kommun.profilSpara": ["profiles", AUDIT],
  "kommun.dictationFinish": ["ai_runs", "jobs", "audio_uploads", AUDIT],
  "ledning.alertAck": ["alert_acks", AUDIT_CASE, AUDIT], "ledning.cdevSave": ["contract_deviations", AUDIT], "ledning.cdevClose": ["contract_deviations", AUDIT],
  "ledning.cdevCustomerApproved": ["contract_deviations", AUDIT],
  "notiser.notifRead": ["notification_reads"],
  "praktik.employerAdd": ["employers", AUDIT], "praktik.setRight": ["placements", AUDIT_CASE, AUDIT], "praktik.addFollowUp": ["placements", AUDIT_CASE, AUDIT],
  "praktik.placementCreate": ["employers", "activities", "placements", "outcome_events", "audit_log:event", AUDIT_CASE, AUDIT], "praktik.placementEnd": ["activities", "placements", AUDIT_CASE, AUDIT],
  "puls.submit": ["pulse_responses", "pulse_invites", "tasks", AUDIT_CASE, AUDIT],
  "rapporter.reportApprove": ["reports", AUDIT_CASE, AUDIT], "rapporter.reportDeliver": ["reports", "outbound_messages", "user_notifications", AUDIT_CASE, AUDIT],
  "rapporter.reportCorrect": ["reports", AUDIT_CASE, AUDIT], "rapporter.reportOpen": ["reports", AUDIT_CASE, AUDIT], "rapporter.snapshot": ["reports"], "rapporter.download": [AUDIT_CASE, AUDIT],
  "rapporter.qualityReview": ["reports", AUDIT_CASE, AUDIT], "rapporter.saveFinal": ["reports", AUDIT_CASE, AUDIT], "rapporter.saveSummary": ["reports", AUDIT_CASE, AUDIT],
  "rapporter.correctionNote": ["reports", AUDIT_CASE, AUDIT], "rapporter.byggForhandsvisning": [AUDIT], "rapporter.byggExport": [AUDIT],
  "rapporter.sparadSpara": ["saved_reports", AUDIT], "rapporter.sparadDela": ["saved_reports", AUDIT], "rapporter.sparadArkivera": ["saved_reports", AUDIT], "rapporter.resultatfilExport": [AUDIT],
  "rost.uploadStart": [], "rost.send": ["voice_links", "participant_voice_notes", "ai_runs", "jobs", "audio_uploads", AUDIT_CASE, AUDIT],
  "rost.linkSend": ["voice_links", "outbound_messages", AUDIT_CASE, AUDIT], "rost.notesSeen": [AUDIT_CASE, AUDIT], "rost.noteReview": ["participant_voice_notes", AUDIT_CASE, AUDIT],
  "session.auditView": [AUDIT_CASE, AUDIT],
  "feedback.submit": ["feedback", AUDIT], "feedback.reply": ["feedback_replies", AUDIT], "feedback.setStatus": ["feedback", AUDIT],
  // Nivåer, grupper och taggar och massanteckningar (coachmötet 2026-10-09).
  "grupper.ny": ["groupings", AUDIT], "grupper.andra": ["groupings", AUDIT], "grupper.arkivera": ["groupings", AUDIT], "grupper.standard": ["groupings", AUDIT],
  "grupper.arendeSpara": ["grouping_members", AUDIT_CASE, AUDIT], "grupper.anteckningarSpara": ["case_notes", AUDIT_CASE, AUDIT],
};

/** Vilka loggrader en fråga som läser audit_log bryr sig om (se taggarna ovan). Nya läsare av loggen måste klassas här. */
const AUDIT_READS: Record<string, string[]> = {
  "admin.auditLog": [AUDIT, AUDIT_CASE, "audit_log:export", "audit_log:audio", "audit_log:org_rule", "audit_log:event"],
  "admin.auditDetail": [AUDIT, AUDIT_CASE, "audit_log:export", "audit_log:audio", "audit_log:org_rule", "audit_log:event"],
  "arenden.kortHistorik": [AUDIT_CASE],
  "admin.integrations": ["audit_log:audio"],
  "admin.orgRules": ["audit_log:org_rule"],
  // Rapportens modell läser när händelser registrerades (event.added) – skrivs bara av coach.eventAdd.
  "rapporter.dokument": ["audit_log:event"],
  "rapporter.visa": ["audit_log:event"],
};

/**
 * Tysta loggkommandon som med flit inte räknar om något (beslut D0 1.4): visningen loggas, men skärmen som visar loggen
 * (chefens Historik, revisionsloggen) hämtas om vid nästa sidvisning. Hämtningen av en bilaga (arenden.bilagaHamta) likaså.
 */
const SILENT_NONE = ["arenden.visaPersonnummer", "arenden.bilagaHamta", "inkorg.revealPnr", "kommun.visaPersonnummer", "rapporter.snapshot", "rapporter.download",
  "rapporter.byggForhandsvisning", "rapporter.byggExport", "rapporter.resultatfilExport", "rost.notesSeen", "session.auditView"];

/**
 * Tabeller som inte räknas automatiskt (avgränsning 2): namn, åtkomst och avtalskonfiguration som nästan varje fråga läser
 * (persons, profiles, organizations, contracts, memberships, contract_areas, org_settings, price_items, buyer_references) –
 * de få kommandon som skriver dem (admin.inviteCustomer, admin.setCustomerActive, admin.setOrgRule, arenden.caseCreate →
 * persons) har sina mängder i planen. Utskickslogg, bakgrundsjobb och AI-spår visas bara i admin och hämtas där vid nästa
 * sidvisning. Ärendena själva (cases) räknas: listor och översikter visar deras innehåll.
 */
const LOOKUP_TABLES = new Set([
  "persons", "profiles", "organizations", "contracts", "memberships", "contract_areas", "org_settings", "price_items", "buyer_references", "holidays", "app_settings",
  "demo_tags", "outbound_messages", "jobs", "audio_uploads", "ai_field_decisions", "case_counters",
]);
/** Rollöverlapp (avgränsning 3): undefined = alla roller. */
const sharesRole = (a: readonly string[] | undefined, b: readonly string[] | undefined) => !a || !b || a.some((r) => b.includes(r));

/**
 * Kända par (kommando, fråga) med gemensam tabell där omräkning ändå inte behövs – med orsak. "*" = alla kommandon
 * respektive alla frågor; table = bara den tabellen. Håll listan kort: ett nytt par ska hellre läggas till i kommandots
 * invalidates. Rader som inte längre träffar något par stoppar testet, så listan inte växer av gamla skäl.
 */
type Known = { command: string; query: string; table?: string; reason: string };
const KNOWN: Known[] = [
  // Ärendet läses bara för namn och ärendenummer (de ändras aldrig) – inte för det som kommandot ändrar.
  { command: "*", query: "notiser.list", table: "cases", reason: "notisens rubrik visar ärendenummer och namn" },
  { command: "*", query: "praktik.list", table: "cases", reason: "praktiksidan visar namn och ärendenummer för placeringarna" },
  { command: "*", query: "praktik.employer", table: "cases", reason: "som praktik.list" },
  { command: "*", query: "admin.templates", table: "cases", reason: "utskickshistoriken visar ärendenumret" },
  { command: "*", query: "rost.pendingNotes", table: "cases", reason: "röstinkorgen filtrerar på huvudcoach – coachbytet räknar om rost." },
  { command: "*", query: "rapporter.resultatfilForhandsvisning", table: "cases", reason: "räknar bara levererade rapporter; ärendets fält läses när filen byggs" },
  // Notiser som går till en annan användare: mottagarens lista hämtas i dennes session (appen: 20 s och vid fokus).
  { command: "arenden.caseAccept", query: "notiser.list", table: "user_notifications", reason: "notisen går till coachen" },
  { command: "arenden.messageSend", query: "session.navCounts", table: "user_notifications", reason: "notisen går till mottagaren (coachen när kommunen skriver) – avsändarens räknare berörs inte" },
  // Bilagor: en påbörjad uppladdning (pending) visas inte förrän den är klar (arenden.bilagaKlar räknar om).
  { command: "arenden.bilagaStart", query: "*", table: "case_attachments", reason: "raden är pending och visas inte förrän bilagaKlar" },
  { command: "rapporter.reportDeliver", query: "notiser.list", table: "user_notifications", reason: "notisen går till kommunen" },
  // Fält i ärendet som bara några skärmar visar.
  { command: "arenden.consentSet", query: "*", table: "cases", reason: "bara samtyckesfältet – kortet, listan, avstämningen, Min vecka och rösten räknas om" },
  { command: "coach.checkinSave", query: "coach.narvaro", table: "cases", reason: "fasen visas inte på närvarosidan" },
  { command: "coach.intakeSave", query: "session.navCounts", table: "cases", reason: "yrkesspåret påverkar inga räknare" },
  { command: "praktik.employerAdd", query: "*", table: "employers", reason: "en ny arbetsgivare har inga placeringar än" },
  { command: "coach.recordingFinish", query: "*", table: "check_ins", reason: "bara AI-utkastet i avstämningen – notiser, rapporter och räknare räknar godkända avstämningar; coachens skärmar och kortet räknas om" },
  // Massanteckningarna (coachmötet 2026-10-09): urvalets namn, ärendenummer och status, och Mina ärenden (teamet).
  { command: "*", query: "grupper.anteckningar", table: "cases", reason: "listan över urvalet hämtas om när sidan visas igen – en anteckning går att spara i alla ärenden man arbetar i" },
  { command: "*", query: "grupper.katalog", table: "cases", reason: "antalet per nivå, grupp och tagg räknar bara pågående ärenden – statusen ändras i andra vyer och antalet hämtas om när sidan visas igen" },
  { command: "*", query: "grupper.anteckningar", table: "case_team", reason: "Mina ärenden – tilldelningen hämtas om när sidan visas igen" },
  { command: "*", query: "grupper.arende", table: "case_team", reason: "teamet läses bara i behörighetsuppslaget – tilldelningen styr inte åtkomsten (beslut 2026-10-09)" },
];
/** Varje delad tabell måste täckas av en KNOWN-rad för paret; returnerar raderna som användes (eller null). */
function knownFor(command: string, query: string, tables: string[]): number[] | null {
  const used: number[] = [];
  for (const t of tables) {
    const i = KNOWN.findIndex((k) => (k.command === "*" || k.command === command) && (k.query === "*" || k.query === query) && (!k.table || k.table === t));
    if (i < 0) return null;
    used.push(i);
  }
  return used;
}

/** Frågor som bara slår upp rader (get) eller bara läser uppslagstabeller – de får ingen automatisk kontroll (men står i planen). */
const NO_TABLES = [
  "admin.auditDetail", "admin.users", "coach.aiRunInfo", "coach.checkInReceipt", "coach.recordingState", "ekonomi.priceList", "inkorg.duplicateCheck",
  "inkorg.registerForm", "kommun.bestallning", "kommun.dictationOptions", "kommun.dictationState", "kommun.dubblett", "kommun.kvitto", "kommun.profil", "puls.link",
  "rapporter.byggKatalog", "rapporter.sparad", "rost.link", "rost.sendStatus", "session.ping",
];

let rt: MemoryRuntime;
let trace: Set<string> | null = null;
/** Exempel som hanteraren avvisade (fel roll eller fel parametrar) – alla rapporteras på en gång. */
const badSamples: string[] = [];
const origTable = MemoryRepo.prototype.table;
beforeAll(() => {
  rt = createMemoryRuntime({ data: createSeed(), clock: demoClock(DEMO_START) });
  // Spåra vilka tabeller som läses (både ctx.repo och ctx.system går genom MemoryRepo.table). get(id) är ett uppslag och
  // räknas inte som innehåll (avgränsning 1) – list, first, count och pick gör det.
  MemoryRepo.prototype.table = function (this: MemoryRepo<never>, name: string) {
    const t = origTable.call(this, name as never) as unknown as Record<string, (...a: unknown[]) => unknown>;
    if (!trace) return t as never;
    const tr = trace;
    return new Proxy(t, {
      get(target, prop: string) {
        const v = target[prop];
        if (typeof v !== "function") return v;
        return (...a: unknown[]) => {
          if (prop !== "get") tr.add(name);
          return v.apply(target, a);
        };
      },
    }) as never;
  } as typeof origTable;
});
afterAll(() => {
  MemoryRepo.prototype.table = origTable;
});

const actorOf = (userId: string, testerId?: string): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId);
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return testerId ? { ...p.actor, testerId } : p.actor;
};
const matches = (inv: CommandDef<unknown, unknown>["invalidates"], key: string) => inv === "all" || (inv !== "none" && inv.some((p) => key.startsWith(p)));

async function readsOf(q: QueryDef<unknown, unknown>): Promise<Set<string>> {
  const samples = SAMPLES[q.key];
  if (!samples) throw new Error(`Frågan ${q.key} saknar exempel i SAMPLES (src/api/invalidation.test.ts)`);
  const out = new Set<string>();
  for (const s of samples) {
    const params = JSON.parse(JSON.stringify(s.params).replace("__first_log__", rt.raw().all("audit_log")[0]?.id ?? "log-x"));
    trace = new Set();
    try {
      await rt.run("query", q.key, params, actorOf(s.actor, s.testerId));
    } catch (e) {
      badSamples.push(`${q.key} som ${s.actor}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      for (const t of trace) out.add(t);
      trace = null;
    }
  }
  if (out.has("audit_log")) {
    out.delete("audit_log");
    const tags = AUDIT_READS[q.key];
    if (!tags) badSamples.push(`Frågan ${q.key} läser audit_log men saknas i AUDIT_READS`);
    for (const t of tags ?? []) out.add(t);
  }
  for (const t of LOOKUP_TABLES) out.delete(t);
  return out;
}

describe("exakt omräkning per kommando", () => {
  it("varje kommando har en mängd; 'all' bara för admin.runJob; de tysta loggkommandona 'none'", () => {
    const cs = commands();
    expect(cs.filter((c) => c.invalidates === undefined).map((c) => c.key)).toEqual([]);
    expect(cs.filter((c) => c.invalidates === "all").map((c) => c.key)).toEqual(["admin.runJob"]);
    const silent = cs.filter((c) => isSilentCommand(c.key));
    expect(silent.length).toBeGreaterThan(10);
    for (const c of silent) {
      if (SILENT_NONE.includes(c.key)) expect(c.invalidates, c.key).toBe("none");
      else expect(c.invalidates, c.key).not.toBe("none");
    }
    // Alla kommandon har en rad i WRITES och alla rader i WRITES finns som kommandon.
    const keys = cs.map((c) => c.key).sort();
    expect(Object.keys(WRITES).sort()).toEqual(keys);
  });

  it("frågor som läser en tabell ett kommando skriver räknas om av kommandot", async () => {
    // Första anropet läser in rapportutkasten (systemsteg) – körs utan spårning.
    await rt.run("query", "session.ping", {}, actorOf("u-amira"));
    const reads = new Map<string, Set<string>>();
    for (const q of queries()) reads.set(q.key, await readsOf(q));
    expect(badSamples).toEqual([]);
    // Varje fråga läste något (annars är exemplet fel) – utom de som inte har någon tabell att läsa.
    expect([...reads].filter(([, r]) => r.size === 0).map(([k]) => k).sort()).toEqual(NO_TABLES);

    const missing: string[] = [];
    const usedKnown = new Set<number>();
    for (const c of commands()) {
      if (c.invalidates === "all" || SILENT_NONE.includes(c.key)) continue;
      const writes = new Set(WRITES[c.key]);
      for (const [qk, r] of reads) {
        if (!sharesRole(rolesOf(c.key), rolesOf(qk))) continue;
        const shared = [...r].filter((t) => writes.has(t));
        if (!shared.length || matches(c.invalidates, qk)) continue;
        const k = knownFor(c.key, qk, shared);
        if (k) {
          for (const i of k) usedKnown.add(i);
          continue;
        }
        missing.push(`${c.key} skriver ${shared.join(", ")} som ${qk} läser – lägg till i invalidates`);
      }
    }
    expect(missing).toEqual([]);
    expect(KNOWN.filter((_, i) => !usedKnown.has(i)).map((k) => `${k.command} ${k.query} ${k.table ?? ""}`), "KNOWN-rader som inte längre behövs").toEqual([]);
  });
});
