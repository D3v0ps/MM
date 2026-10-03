// Namngivna grupper av frågenycklar som kommandon räknar om (CommandDef.invalidates, useCommand i src/shell/backend.tsx).
// Bara strängkonstanter – filen är isomorf och importeras av kontrakten (api.ts) och av skärmar som behöver en smalare
// mängd (useCommand(def, { invalidate })). Ett prefix matchar början av frågans nyckel: "arenden.kort" täcker
// arenden.kortOversikt … arenden.kortTidslinjeText. Vilka frågor som läser vilka tabeller kontrolleras av
// src/api/invalidation.test.ts – lägg till en grupp här hellre än att skriva "all" på ett kommando.

/** Räknarna i sidopanelen (inkorg, deadlines, oregistrerad närvaro, notiser, chefens delade rapporter). */
export const NAV = "session.navCounts";
/** Revisionsloggen (chef och systemadministratör) – alla kommandon som skriver i loggen. */
export const LOG = ["admin.auditLog", "admin.auditDetail"] as const;
/** Deltagarkortet och alla dess flikar (arenden.kort, kortOversikt … kortHistorik, kortTidslinjeText). */
export const CARD = "arenden.kort";
/** Ärendelistan, kortet och handledarens startsida. */
export const CASES = "arenden.";
/** Coachens skärmar (Min vecka, närvaro, avstämning, månadsbedömning, kartläggning, händelser). */
export const COACH = "coach.";
/** Kommunens portal. */
export const PORTAL = "kommun.";
/** Rapporter (lista, dokument, rapportsida, rapportbyggaren). */
export const REPORTS = "rapporter.";
/** Ledningsvyn och avtalsavvikelserna – KPI:erna läser nästan allt. */
export const MGMT = "ledning.";
/** Startsidan och Förfaller: flaggor och deadlines (inkorgens OPS-tabeller). */
export const START = ["inkorg.start", "inkorg.deadlines"] as const;
/** Avropsinkorgen med start och deadlines. */
export const INBOX = "inkorg.";
/** Ekonomi: fakturaunderlag, körningar, fakturor. */
export const BILLING = "ekonomi.";
/** Adminsidor som räknar ärenden, avstämningar och körningar. */
export const CASE_STATS = ["admin.contract", "admin.integrations", "admin.orgRules"] as const;
/**
 * Ärendets fakta ändras (närvaro, avstämning, status, rapporter): allt som räknar KPI:er, flaggor, deadlines och
 * fakturering. Brett med flit – närvaron styr veckorapporter, fakturaunderlag, sidopanelens räknare och ledningens nyckeltal.
 */
export const CASE_FACTS = [CASES, COACH, PORTAL, REPORTS, MGMT, ...START, BILLING, ...CASE_STATS, NAV, ...LOG] as const;

// ---- Automatisk utkastsparning (D2 punkt 2): skärmen väljer en smalare mängd (useCommand(def, { invalidate })) än kontraktets.
// Ett utkast påverkar bara utkastlistor och kortet – aldrig sidan själv (formuläret ligger kvar), inte räknarna i sidopanelen.
/** Veckoavstämning sparad automatiskt som utkast. */
export const AUTOSAVE_CHECKIN = ["coach.minVecka", "coach.casePicker", "arenden.kortAvstamningar", "arenden.kortOversikt", "arenden.kortTidslinje", "arenden.kortManad", "arenden.kortHistorik", "arenden.lista", ...LOG] as const;
/** Månadsbedömning sparad automatiskt som utkast. */
export const AUTOSAVE_ASSESSMENT = ["coach.minVecka", "coach.casePicker", "arenden.kortManad", "arenden.kortTidslinje", "arenden.kortHistorik", ...LOG] as const;
/** Kartläggning sparad automatiskt som utkast. */
export const AUTOSAVE_INTAKE = ["coach.casePicker", "arenden.kortKartlaggning", "arenden.kortTidslinje", "arenden.kortHistorik", ...LOG] as const;
