// Kontrakt för området kommun – kommunens portal (prototypens views/kommun.js). Importeras av skärmar – aldrig hanterarna.
//
// Portalen är skriven för ovana användare. Vy-modellerna innehåller bara det kommunen får se: aldrig interna mål,
// coachanteckningar, interna flaggor, personnummer i klartext (bara maskerat – "Visa" är ett eget kommando som loggas),
// ordervärde eller andra belopp (synpunkt #10 och #11, beslut 2026-10-07).
// Kommunen har bara rollen handläggare (beslut 2026-10-07): ingen beställarrapport, resultatfil eller delade rapporter i
// portalen – Miljonbemanning tar fram dem och lämnar dem till kommunen. Alla med en adress på avtalets kommundomän kan skapa
// ett konto själva (självregistrering i inloggningen) och fyller i sina uppgifter under Mina uppgifter.
//
// Delade kommandon som portalen använder finns i andra områden:
//   beställning        arenden.caseCreate (+ arenden.caseUpdate för beställarens kontaktuppgifter)
//   bilagor            arenden.bilagaStart, arenden.bilagaKlar, arenden.bilagaTaBort, arenden.bilagaHamta
//   meddelanden        arenden.messageSend, arenden.messageRead (läskvitto, tyst)
//   rapporter          rapporter.dokument + PortalReport (rapportsidan), rapporter.reportOpen (kvittens, tyst)
//   visningslogg       session.auditView (case.view, tyst)
//
// Inloggningen (/portal/logga-in) går via AuthPort (useAuth i src/shell/session.tsx) och har inget eget kommando här.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import { NAV, LOG, PORTAL } from "@/api/invalidation";
import type { CaseSource, CaseStatus, ReportKind, TaskKind } from "@/data/schema";
import { IdSchema } from "../_shared/schemas";

// ================================================================ Gemensamma delar
/** Ärendet så som kommunen ser det (lista och deltagarens sida). Texterna byggs av skärmen (texts.ts). */
export type KomCase = {
  id: string;
  caseNumber: string;
  status: CaseStatus;
  /** Deltagarens namn. */
  name: string;
  /** "G Lager och logistik" (null = inte valt än – Miljonbemanning väljer när beställningen bekräftas). */
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
  /** Omfattningen: månader ur avtalet, null vid annan tidsperiod eller en äldre beställning i veckor (plannedWeeks). */
  orderPeriodMonths: number | null;
  /** Annan tidsperiod (motiveringen finns). */
  otherPeriod: boolean;
  plannedWeeks: number | null;
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
export type KomUnreadMessage = { id: string; caseId: string; caseNumber: string; meeting: boolean; senderLabel: string; createdAt: string };
export type KomStart = {
  firstName: string;
  unit: string | null;
  /** Enhet eller telefon saknas i profilen (t.ex. efter självregistreringen) – kortet "Fyll i dina uppgifter" visas. */
  profileIncomplete: boolean;
  customerName: string;
  tasks: KomTask[];
  unreadMessages: KomUnreadMessage[];
  /**
   * Olästa rapporter (också orderbekräftelser), senaste först. Beslut 2026-10-09 ("Vi behöver inte visa så mycket till
   * kommunens handläggare"): startsidan har inga händelser och inga siffror under knapparna – bara Att göra och det olästa.
   */
  unreadReports: KomReportRow[];
};
export const kommunStart = query("kommun.start", z.object({})).returns<KomStart>();

// ================================================================ Beställning (/portal/bestall)
// Synpunkt #3–#10 (beslut 2026-10-07): enheten är fritext, ingen beställarreferens, omfattningen 6 eller 12 månader (eller
// annan tidsperiod med motivering), inget planerat slutdatum att fylla i, ingen fråga om skyddade personuppgifter, ingen
// anpassning och "Bakgrundsinformation om deltagaren" (kartläggning, bilagor och fritext). Beslut 2026-10-09: yrkesområdet
// är obligatoriskt (avtalets avtalsområden), ingen bostadsort, ingen fråga om kontaktväg och kartläggningen besvaras med ja
// eller nej. Inga belopp.
export type KomOrderForm = {
  customerName: string;
  today: string;
  /** Förval: måndag om två veckor. */
  defaultStart: string;
  me: { name: string; unit: string; phone: string; email: string };
  /** Omfattningen: avtalets alternativ i månader (orderPeriods.months) och om annan tidsperiod går att välja. */
  periods: { months: number[]; allowOther: boolean };
  /** Bilagor: högsta storlek i byte, högsta antal och filtyperna (accept-attributet och texten). */
  attachments: { maxBytes: number; maxFiles: number; accept: string; typesText: string };
  /** "en vecka" – avtalets tidsgräns för första mötet. */
  firstMeetingWithin: string;
  /** Besked om startdatum och coach senast, om beställningen skickas nu. */
  answerDue: string | null;
  /** Yrkesområdena: avtalets aktiva avtalsområden (contract_areas, samma källa som acceptdialogen) – värdet är koden. */
  areas: { value: string; label: string }[];
  /** Namnet på avtalsområdet för "inget annat passar" (t.ex. "Övrigt") om avtalet har ett sådant – hjälptexten nämner det. */
  otherAreaName: string | null;
};
export const kommunOrderForm = query("kommun.bestallning", z.object({})).returns<KomOrderForm>();

/** Pågående insats för samma person. caseId och caseNumber är null när insatsen är beställd av en annan handläggare. */
export type KomDuplicate = { caseId: string | null; caseNumber: string | null; status: CaseStatus | null };
/** Dubblettkontroll medan handläggaren skriver personnumret (numret skickas i anropet, aldrig i URL:en eller loggen). */
export const kommunDuplicate = query("kommun.dubblett", z.object({ pnr: z.string().max(20) })).returns<KomDuplicate[]>();

/**
 * Kvittot efter beställningen. Beslut 2026-10-09 ("Vi behöver inte visa så mycket till kommunens handläggare"): bara
 * ärendenumret och när orderbekräftelsen kommer med mejl – inget mejl att visa och ingen tidslinje.
 */
export type KomReceipt = {
  caseId: string;
  caseNumber: string;
  /** Senast när orderbekräftelsen skickas (avtalets svarstid), null om den inte går att räkna ut. */
  avropDue: string | null;
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
  customerName: string;
  phaseCount: number;
  /** Avtalet har inte bestämt om handläggaren ser egna, enhetens eller alla deltagare. */
  scopeUnset: boolean;
  /** Olästa först, sedan status och senast beställda. */
  rows: KomCaseRow[];
};
export const kommunCaseList = query("kommun.deltagareLista", z.object({})).returns<KomCaseList>();

export type KomCaseDetail = {
  kind: "ok";
  today: string;
  customerName: string;
  phaseCount: number;
  case: KomCase;
  /** Olästa rapporter till handläggaren. */
  unreadReports: number;
  /** Händelser i ärendet (avböjd, ny coach) som handläggaren inte har sett – kommun.caseSeen när ärendet öppnas. */
  unseenEvents: number;
  tasks: KomTask[];
  messages: KomMessage[];
  /** Handläggaren som beställde skriver meddelanden. */
  canWrite: boolean;
  coachChanges: { at: string; fromName: string; toName: string }[];
  /**
   * Orderbekräftelsen – utan ordervärde, pris och beställarreferens (synpunkt #10 och #11). Beslut 2026-10-09: inget team
   * och inget ordererkännande att visa på deltagarens sida.
   */
  order: {
    coachName: string | null;
    /** Levererad orderbekräftelse (öppnas som rapport). */
    ocReportId: string | null;
  };
  /**
   * Närvarograden de senaste 30 dagarna – en rad, ingen uppdelning i giltig och ogiltig frånvaro (beslut 2026-10-09).
   * rate null = ingen närvaro registrerad under perioden. null = insatsen har inte startat än.
   */
  attendance: { rate: number | null } | null;
  participant: { pnrMasked: string | null; canReveal: boolean };
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
  customerName: string;
  unit: string | null;
  /**
   * Levererade till läsaren: olästa först, sedan senast levererade. Beslut 2026-10-09 ("Vi behöver inte visa så mycket till
   * kommunens handläggare"): inga rapporter "på väg", ingen sökning och bara filtren Olästa och Alla.
   */
  reports: KomReportRow[];
  unreadMessages: number;
  /** Meddelanden per deltagare (handläggaren). Olästa först. */
  threads: KomThread[];
};
export const kommunReports = query("kommun.rapporter", z.object({})).returns<KomReports>();

// ================================================================ Mina uppgifter (/portal/mina-uppgifter)
// Handläggarens egna uppgifter: namn, telefon och enhet (fritext). E-postadressen visas men ändras inte (den är inloggningen).
// Efter självregistreringen (beslut 2026-10-07) är namnet preliminärt (ur adressen) och enheten tom.
export type KomProfile = { name: string; email: string; phone: string; unit: string; customerName: string; incomplete: boolean };
export const kommunProfile = query("kommun.profil", z.object({})).returns<KomProfile>();

/** Spara egna uppgifter. Revisionsloggen får bara vilka fält som ändrats (profile.updated). */
export const kommunProfileSave = command("kommun.profilSpara", z.object({
  fullName: z.string().max(120),
  phone: z.string().max(40),
  unit: z.string().max(120),
}), { invalidates: [PORTAL, "admin.users", NAV, ...LOG] }).returns<Result<{ changed: string[] }, "name" | "phone" | "unit">>();

// ================================================================ Kommandon (prototypens kom.*)
/** Handläggaren har öppnat ärendet i portalen – händelser före den tiden räknas som lästa (tyst; startsidan visar inga händelser sedan 2026-10-09). */
export const kommunCaseSeen = command("kommun.caseSeen", z.object({ caseId: IdSchema }), { invalidates: [PORTAL, NAV] }).returns<Result<object, "not_found">>();

/** Handläggaren markerar en uppgift från Miljonbemanning som klar. */
export const kommunTaskDone = command("kommun.taskDone", z.object({ taskId: IdSchema }), { invalidates: ["kommun.start", "kommun.deltagare", "inkorg.start", "ekonomi.start", "arenden.kortManad", ...LOG] }).returns<Result<object, "not_found" | "forbidden">>();

/** Visa hela personnumret (tyst). Bara beställande handläggare (kommunens åtkomst till ärendet). Visningen loggas (pnr.revealed). */
export const kommunRevealPnr = command("kommun.visaPersonnummer", z.object({ caseId: IdSchema }), { invalidates: "none" }).returns<Result<{ pnr: string }, "not_found" | "forbidden" | "missing">>();

// ================================================================ "Tala in" (röstinspelning, docs/PLAN-ROST.md, flöde 2)
// Handläggaren talar in i stället för att skriva – vid beställningens bakgrundsinformation (/portal/bestall) och i meddelanden.
// Flödet: rost.uploadStart (purpose dictation) -> webbläsaren laddar upp ljudet (appen) -> kommun.dictationFinish
// (transkribering, ljudet raderas direkt) -> texten tillbaka till fältet. Handläggaren läser, rättar och skickar själv.
// Inget ljud sparas. I testmiljön är AI-leverantören simulerad: simulated = true och texten är påhittad (synpunkt #8).

/** Får handläggaren tala in här? caseId: ett ärende (meddelanden). Utan caseId: en ny beställning. */
export type DictationOptions = { enabled: boolean; maxMinutes: number; reason: string | null };
export const dictationOptions = query("kommun.dictationOptions", z.object({ caseId: IdSchema.optional() })).returns<DictationOptions>();

/**
 * Läget för en inspelning. text = den inlästa texten när transkriberingen är klar (bara till den som talade in).
 * simulated = den simulerade AI-leverantören (testmiljön) – skärmen säger att texten är påhittad.
 */
export type DictationState = { aiRunId: string; status: "running" | "succeeded" | "failed"; error: string | null; audioDeletedAt: string | null; text: string | null; simulated: boolean };
export const dictationFinish = command("kommun.dictationFinish", z.object({
  uploadId: IdSchema,
  durationSec: z.number().min(0).max(86_400).nullish(),
}), { invalidates: ["kommun.dictationState", "admin.integrations", ...LOG] }).returns<Result<DictationState, "not_found" | "forbidden" | "ai_off" | "disabled" | "protected" | "no_consent" | "link_missing" | "link_used" | "link_expired" | "audio_missing">>();
export const dictationState = query("kommun.dictationState", z.object({ aiRunId: IdSchema })).returns<DictationState | null>();
