// Kontrakt för området ärenden (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import { NAV, LOG, CARD, CASES, COACH, PORTAL, REPORTS, MGMT, INBOX, BILLING, CASE_STATS } from "@/api/invalidation";
import {
  ACTIVITY_KINDS, CASE_NOTE_AUDIENCES, CASE_NOTE_KINDS, CASE_SOURCES, END_REASONS, PREFERRED_CONTACTS, PRIOR_ASSESSMENTS, TEAM_ROLES, type PreferredContact, type PriorAssessment, type TeamRole,
  type ActivityKind, type CaseNoteAudience, type CaseNoteKind, type LocalDate, type LocalDateTime, type MonthKey, type AiConsentStatus, type AlertKind, type AlertSeverity, type AttendanceStatus, type CaseStatus, type CheckInMode, type FourRights,
  type GoalStatus, type OutcomeEventKind, type PlacementStatus, type ReportKind, type ReportStatus, type ResultClass, type TrafficLight,
} from "@/data/schema";
import type { SlaTone } from "@/core/sla";
import { WEEK_PLAN_KINDS } from "@/core/config";
import type { WeekPlanRow } from "@/core/schedule";
import { IdSchema, LocalDateSchema, LocalDateTimeSchema, LongText, MonthKeySchema, ShortText, WeekKeySchema } from "../_shared/schemas";
import type { ReportDocView } from "../rapporter/api";
import type { MonthlyGaps } from "../rapporter/model";

// ---- Delade kommandon (portade från prototypens 03-domain.js)
// Samma beteende, valideringar, felkoder och texter som prototypens MM.defineAction. Nyckeln är "arenden.<prototypens namn>".
// Affärsfel returneras som { ok: false, error, message } – message är en text till användaren (klarspråk).
// Gemensamma felkoder: not_found = ärendet finns inte eller rollen får inte se det, forbidden = rollen får se men inte ändra.

/** Högsta antal veckor i en beställning (12 månader kan bli 53 ISO-veckor, annan tidsperiod lite längre). */
export const MAX_ORDER_WEEKS = 60;
/** Motiveringen vid "Annan tidsperiod": minst och högst så här många tecken. */
export const ORDER_REASON_MIN = 10;
export const ORDER_REASON_MAX = 500;

/**
 * Ny beställning (portalen; telefon eller mejl registreras av Miljonbemanning) – prototypens case.create, ändrad efter
 * beslutet 2026-10-07 (synpunkt #3–#10): enheten är fritext, ingen beställarreferens, inget yrkesspår och ingen fråga om
 * skyddade personuppgifter i kommunens formulär. Beslut 2026-10-09: kommunen anger yrkesområdet (primaryArea – ett aktivt
 * avtalsområde, obligatoriskt för kommunen), ingen bostadsort och ingen kontaktväg (city och preferredContact är valfria –
 * utan kontaktväg blir den SMS, e-post eller telefon efter uppgifterna, se defaultPreferredContact). Omfattningen är
 * orderPeriodMonths (ett av avtalets alternativ – planerat slut räknas fram från önskat startdatum) eller "Annan
 * tidsperiod": plannedEnd och orderPeriodReason. Bakgrundsinformation om deltagaren: priorAssessment (kartläggning – ja
 * eller nej för kommunen; "vet inte" finns kvar för äldre beställningar och Miljonbemannings registrering), background och
 * bilagor (attachmentIds – egna uppladdningar med arenden.bilagaStart/bilagaKlar). Ger nästa ärendenummer i avtalets serie
 * och skickar ordererkännandet. Kommunens handläggare beställer alltid i eget namn. contractId: utelämnas = användarens
 * aktiva avtal. Personnummer krypteras innan det sparas och skickas aldrig tillbaka.
 */
// Omräkning brett med flit: ett nytt ärende syns i listor, inkorg, portal, KPI:er och fakturering.
export const caseCreate = command("arenden.caseCreate", z.object({
  contractId: IdSchema.optional(),
  source: z.enum(CASE_SOURCES).optional(),
  /** Beställande handläggare. Ignoreras för kommunens handläggare (alltid den inloggade). */
  referrerId: IdSchema.nullable().optional(),
  /** Enheten som handläggaren arbetar på (fritext, synpunkt #4). Sparas i profilen om den saknas där. */
  referrerUnit: z.string().max(120).optional(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  pnr: z.string().max(20).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  /** Bara när kontaktvägen är brev. */
  address: z.string().max(300).nullable().optional(),
  /** Utelämnas = SMS, e-post eller telefon efter uppgifterna (kommunens formulär frågar inte, beslut 2026-10-09). */
  preferredContact: z.enum(PREFERRED_CONTACTS).optional(),
  language: z.string().max(60).optional(),
  needsInterpreter: z.boolean().optional(),
  /** Bara Miljonbemanning (mejl eller telefon) – kommunens formulär har ingen beställarreferens (beslut 2026-10-07). */
  buyerReference: z.string().max(40).optional(),
  purchaseOrderNumber: z.string().max(40).nullable().optional(),
  /** Yrkesområdet (avtalsområdets kod) – obligatoriskt för kommunen (beslut 2026-10-09). Kan ändras när avropet accepteras. */
  primaryArea: z.string().max(10).nullable().optional(),
  /** Bara Miljonbemanning – alternativt område och yrkesspår sätts annars när avropet accepteras (synpunkt #8). */
  secondaryArea: z.string().max(10).nullable().optional(),
  vocationalTrack: z.string().max(200).optional(),
  desiredStart: LocalDateSchema.nullable().optional(),
  /** Omfattningen i månader (avtalets orderPeriods.months). */
  orderPeriodMonths: z.number().int().min(1).max(60).nullable().optional(),
  /** "Annan tidsperiod": slutdatumet och motiveringen. */
  plannedEnd: LocalDateSchema.nullable().optional(),
  orderPeriodReason: z.string().max(ORDER_REASON_MAX).nullable().optional(),
  /** Har en kartläggning genomförts? */
  priorAssessment: z.enum(PRIOR_ASSESSMENTS).nullable().optional(),
  /** Bakgrundsinformation om deltagaren (fritext). */
  background: z.string().max(4000).optional(),
  /** Bilagor som den inloggade redan har laddat upp (arenden.bilagaStart och arenden.bilagaKlar). */
  attachmentIds: z.array(IdSchema).max(10).optional(),
}), { invalidates: [CASES, INBOX, PORTAL, "coach.casePicker", "coach.minVecka", MGMT, BILLING, REPORTS, ...CASE_STATS, NAV, ...LOG] }).returns<
  Result<{ caseId: string; caseNumber: string }, "buyer_ref" | "po_number" | "duplicate" | "referrer" | "forbidden" | "no_contract" | "order_period" | "unit" | "area" | "prior_assessment" | "attachments">
>();

/**
 * Acceptera avrop → orderbekräftelse (prototypens case.accept). Avtalsområde och yrkesspår sätts här (synpunkt #8) –
 * avtalsområdet är förifyllt med yrkesområdet ur beställningen (beslut 2026-10-09) och krävs om ärendet saknar det. Första mötet är obligatoriskt: planerat slut
 * räknas från mötesdagen (beslut 7, 2026-10-08 – också vid ombokning, se caseBookFirstMeeting). Omfattningen (6/12 månader
 * eller annan tidsperiod) är förifylld ur beställningen och kan ändras; "annan tidsperiod" behåller slutdatumet. Beställarreferensen
 * är valfri (MB fyller i den här eller före faktureringen, beslut 2026-10-07) – formatet kontrolleras om något skrivits.
 * Skapar orderbekräftelsen (levererad i portalen), teamet, notiser till coach och team, mejl till kommunen och kallelse till
 * deltagaren. buyerReference: utelämnas = ärendets nuvarande referens.
 */
// Omräkning brett med flit: skapar orderbekräftelsen (reports), ändrar inkorgen och deadlines, och ger coachen ärendet.
export const caseAccept = command("arenden.caseAccept", z.object({
  caseId: IdSchema,
  leadCoachId: IdSchema,
  /** Första mötet – obligatoriskt: slutdatumet räknas från mötesdagen (beslut 7, 2026-10-08). */
  firstMeetingAt: LocalDateTimeSchema,
  primaryArea: z.string().max(10).nullable().optional(),
  secondaryArea: z.string().max(10).nullable().optional(),
  vocationalTrack: z.string().max(200).optional(),
  orderPeriodMonths: z.number().int().min(1).max(60).nullable().optional(),
  plannedEnd: LocalDateSchema.nullable().optional(),
  orderPeriodReason: z.string().max(ORDER_REASON_MAX).nullable().optional(),
  buyerReference: z.string().max(40).nullable().optional(),
  team: z.array(z.object({ userId: IdSchema, role: z.enum(TEAM_ROLES) })).max(10).optional(),
}), { invalidates: [CASES, INBOX, PORTAL, COACH, REPORTS, MGMT, BILLING, "praktik.", ...CASE_STATS, NAV, ...LOG] }).returns<
  Result<{ reportId: string; caseNumber: string }, "not_found" | "buyer_ref" | "wrong_status" | "forbidden" | "coach" | "team" | "area" | "track" | "order_period">
>();

/** Avböj avrop med orsak (prototypens case.decline). Kommunen får ett mejl utan personuppgifter. */
// Omräkning som caseAccept (samma listor, inkorg och deadlines berörs).
export const caseDecline = command("arenden.caseDecline", z.object({
  caseId: IdSchema,
  reason: z.string().max(2000),
}), { invalidates: [CASES, INBOX, PORTAL, COACH, REPORTS, MGMT, BILLING, "praktik.", ...CASE_STATS, NAV, ...LOG] }).returns<Result<object, "not_found" | "reason" | "wrong_status" | "forbidden">>();

/** Fält som kan ändras med arenden.caseUpdate. Kommunens handläggare får bara ändra beställarens kontaktuppgifter. */
export const CasePatchSchema = z.strictObject({
  referrerName: ShortText.nullable(),
  referrerUnit: ShortText.nullable(),
  referrerPhone: z.string().max(40).nullable(),
  referrerEmail: z.string().max(200).nullable(),
  desiredStart: LocalDateSchema.nullable(),
  plannedStart: LocalDateSchema.nullable(),
  plannedWeeks: z.number().int().min(1).max(MAX_ORDER_WEEKS).nullable(),
  plannedEnd: LocalDateSchema.nullable(),
  orderValueWeeks: z.number().int().min(1).max(104).nullable(),
  orderPeriodMonths: z.number().int().min(1).max(60).nullable(),
  orderPeriodReason: z.string().max(ORDER_REASON_MAX).nullable(),
  priorAssessment: z.enum(PRIOR_ASSESSMENTS).nullable(),
  meetingDay: z.number().int().min(0).max(6).nullable(),
  meetingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  location: ShortText,
  vocationalTrack: ShortText,
  secondaryAreaCode: z.string().max(10).nullable(),
  purchaseOrderNumber: z.string().max(40).nullable(),
  pausedWeeks: z.array(WeekKeySchema).max(60),
  pauseReason: ShortText.nullable(),
  backgroundInfo: z.string().max(4000),
}).partial();
export type CasePatch = z.infer<typeof CasePatchSchema>;
export const CUSTOMER_PATCH_FIELDS = ["referrerName", "referrerUnit", "referrerPhone", "referrerEmail"] as const satisfies readonly (keyof CasePatch)[];

/**
 * Ändra ärendefält med revisionslogg (prototypens case.update). Prototypens patch ordererContact { name, unit, phone, email }
 * motsvaras av referrerName, referrerUnit, referrerPhone och referrerEmail.
 */
export const caseUpdate = command("arenden.caseUpdate", z.object({
  caseId: IdSchema,
  patch: CasePatchSchema,
}), { invalidates: [CASES, PORTAL, INBOX, BILLING, COACH, REPORTS, MGMT, NAV, ...LOG] }).returns<Result<{ changed: string[] }, "not_found" | "forbidden" | "po_number">>();

/** Ändra beställarreferens (prototypens case.setBuyerRef). source = t.ex. uppgiftens id eller "ekonom". */
export const caseSetBuyerRef = command("arenden.caseSetBuyerRef", z.object({
  caseId: IdSchema,
  reference: z.string().max(40),
  source: ShortText.optional(),
}), { invalidates: [CASES, BILLING, INBOX, PORTAL, REPORTS, MGMT, "coach.minVecka", "admin.users", NAV, ...LOG] }).returns<Result<object, "not_found" | "buyer_ref" | "forbidden">>();

/**
 * Boka eller boka om första mötet (prototypens case.bookFirstMeeting). Slutdatumet, planerade veckor och ordervärdet i veckor
 * räknas om från mötesdagen (beslut 7, 2026-10-08; "annan tidsperiod" behåller kommunens slutdatum). Bokas mötet om efter att
 * orderbekräftelsen levererats skapas en ny version av den (den gamla märks ersatt) och kommunen får ett mejl utan
 * personuppgifter. Kallelse via föredragen kontaktväg – aldrig vid skyddade personuppgifter.
 */
// Omräkning som caseAccept: skriver ärendet, orderbekräftelsen (reports) och utskicken; slutdatumet påverkar deadlines, flaggor och fakturering.
export const caseBookFirstMeeting = command("arenden.caseBookFirstMeeting", z.object({
  caseId: IdSchema,
  at: LocalDateTimeSchema,
}), { invalidates: [CASES, INBOX, PORTAL, COACH, REPORTS, MGMT, BILLING, "praktik.", ...CASE_STATS, NAV, ...LOG] }).returns<Result<object, "not_found" | "forbidden" | "order_period">>();

/** Byt huvudcoach med orsak (prototypens case.changeCoach). Nya coachen och kommunen får notis utan personuppgifter. */
export const caseChangeCoach = command("arenden.caseChangeCoach", z.object({
  caseId: IdSchema,
  toCoachId: IdSchema,
  reason: z.string().max(2000),
}), { invalidates: [CASES, COACH, PORTAL, INBOX, MGMT, REPORTS, "praktik.", "rost.", "notiser.", NAV, ...LOG] }).returns<Result<object, "not_found" | "reason" | "coach" | "forbidden">>();

// ---- Starta insatsen, veckoplan, tillfällen och team (beslut 2026-10-08, skarp drift: i skarp drift blev ett ärende aldrig "Pågår")
const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Klockslag ska skrivas TT:MM");
/** En rad i veckoplanen: veckodag 0–4 (måndag–fredag), typ, klockslag, längd och plats. */
export const WeekPlanRowSchema = z.strictObject({
  weekday: z.number().int().min(0).max(4),
  kind: z.enum(WEEK_PLAN_KINDS),
  time: TimeSchema,
  durationMin: z.number().int().min(15).max(600),
  location: ShortText,
});
export const WeekPlanSchema = z.array(WeekPlanRowSchema).min(1).max(10);

/**
 * Starta insatsen: bekräftat ärende med bokat första möte. Startdatumet är första mötets dag om inget annat anges och
 * aldrig före mötet. Sätter status Pågår och startdatum, skapar tillfällena från startdatumet till planerat slut enligt
 * veckoplanen (helgdagar hoppas över, högst 60 veckor), statushistorik och loggen case.started. Huvudcoachen, samordnare
 * och avtalsansvarig.
 */
// Omräkning brett med flit: statusen och tillfällena syns i listor, Min vecka, närvaro, portal, rapporter, KPI:er och fakturering.
export const caseStart = command("arenden.caseStart", z.object({
  caseId: IdSchema,
  startDate: LocalDateSchema,
  plan: WeekPlanSchema,
}), { invalidates: [CASES, COACH, PORTAL, INBOX, REPORTS, MGMT, BILLING, "praktik.", ...CASE_STATS, NAV, ...LOG] }).returns<
  Result<{ activities: number; firstActivityAt: string | null }, "not_found" | "forbidden" | "wrong_status" | "no_meeting" | "start_date" | "no_end" | "plan">
>();

/**
 * Ändra veckoplanen för ett pågående ärende: framtida tillfällen utan registrerad närvaro ersätts av den nya planen;
 * tillfällen med närvaro rörs aldrig. Praktikdagar från en praktik rörs bara om planen själv innehåller praktikdagar.
 * Logg case.schedule_changed.
 */
export const caseScheduleChange = command("arenden.caseScheduleChange", z.object({
  caseId: IdSchema,
  plan: WeekPlanSchema,
}), { invalidates: [CASES, COACH, PORTAL, INBOX, REPORTS, MGMT, BILLING, "praktik.", ...CASE_STATS, NAV, ...LOG] }).returns<
  Result<{ removed: number; added: number }, "not_found" | "forbidden" | "wrong_status" | "no_end" | "plan">
>();

/** Lägg till ett enstaka tillfälle i ett pågående ärende (den som arbetar i ärendet). Logg activity.added. */
export const activityAdd = command("arenden.activityAdd", z.object({
  caseId: IdSchema,
  kind: z.enum(ACTIVITY_KINDS),
  startsAt: LocalDateTimeSchema,
  durationMin: z.number().int().min(15).max(600),
  location: ShortText,
}), { invalidates: [CASES, COACH, PORTAL, INBOX, REPORTS, MGMT, BILLING, "praktik.", ...CASE_STATS, NAV, ...LOG] }).returns<
  Result<{ activityId: string }, "not_found" | "forbidden" | "wrong_status" | "date" | "duplicate">
>();

/** Ta bort ett tillfälle som saknar registrerad närvaro. Logg activity.removed. */
export const activityRemove = command("arenden.activityRemove", z.object({ activityId: IdSchema }), {
  invalidates: [CASES, COACH, PORTAL, INBOX, REPORTS, MGMT, BILLING, "praktik.", ...CASE_STATS, NAV, ...LOG],
}).returns<Result<object, "not_found" | "forbidden" | "has_attendance">>();

/**
 * Ändra teamet (samordnare och avtalsansvarig): arbetsgivarmatchare och SYV/metodstöd läggs till eller tas bort (teamvalet
 * Handledare finns inte sedan 2026-10-09 – en befintlig yrkesspecifik handledare tas bort när teamet sparas). Huvudcoachen byts med arenden.caseChangeCoach (orsak och notis till kommunen). Nya medlemmar får samma notis som
 * vid accept (bara ärendenummer). Logg case.team_changed.
 */
export const caseSetTeam = command("arenden.caseSetTeam", z.object({
  caseId: IdSchema,
  team: z.array(z.object({ userId: IdSchema, role: z.enum(TEAM_ROLES) })).max(10),
}), { invalidates: [CASES, COACH, INBOX, MGMT, REPORTS, "praktik.", "rost.", "notiser.", NAV, ...LOG] }).returns<
  Result<{ added: number; removed: number }, "not_found" | "forbidden" | "wrong_status" | "team">
>();

// ---------------------------------------------------------------- Kontaktväg på deltagarkortet (coachmötet 2026-10-09)
/** Rollerna som ändrar deltagarens kontaktväg (Miljonbemanning frågar deltagaren vid första mötet). */
export const CONTACT_EDITORS = ["samordnare", "avtalsansvarig", "coach", "admin"] as const;
/** Kontaktvägarna som väljs på deltagarkortet. Brev finns kvar för äldre ärenden men väljs inte här. */
export const CARD_CONTACTS = ["sms", "phone", "email"] as const;
/**
 * Ändra deltagarens kontaktväg (SMS, telefon eller e-post), telefonnummer och e-postadress. Samma regler som Registrera
 * beställning (contactErrors i src/core/contact.ts). Skriver persons via behörigheten (mm.person_write, 0032 – admin bara
 * kontaktuppgifterna). Revisionslogg person.contact_changed med id:n och vilka fält som ändrades – aldrig värdena.
 */
export const caseSetContact = command("arenden.caseSetContact", z.object({
  caseId: IdSchema,
  preferredContact: z.enum(CARD_CONTACTS),
  phone: z.string().trim().max(40),
  email: z.string().trim().max(200),
}), { invalidates: [CASES, COACH, PORTAL, INBOX, REPORTS, ...LOG] }).returns<Result<{ changed: boolean }, "not_found" | "forbidden" | "phone" | "email">>();

/**
 * Avsluta insatsen (prototypens case.close): resultatklass enligt avtalets resultatdefinition, utkast till slutrapport
 * och exit-pulsmätning (inte vid skyddade personuppgifter). verified = arbete/studier är verifierat.
 */
// Omräkning brett med flit: avslutet skapar slutrapporten och pulsinbjudan och påverkar fakturering, KPI:er och portalen.
export const caseClose = command("arenden.caseClose", z.object({
  caseId: IdSchema,
  endDate: z.union([LocalDateSchema, z.literal("")]).nullable().optional(),
  endReason: z.union([z.enum(END_REASONS), z.literal("")]).nullable().optional(),
  verified: z.boolean().optional(),
}), { invalidates: [CASES, COACH, PORTAL, INBOX, REPORTS, MGMT, BILLING, "rost.", "puls.", ...CASE_STATS, NAV, ...LOG] }).returns<Result<{ reportId: string; resultClass: ResultClass }, "not_found" | "missing" | "forbidden" | "wrong_status">>();

/**
 * Säkert meddelande i ärendet (prototypens message.send). Från Miljonbemanning: kommunen får ett mejl utan innehåll.
 * Från kommunen: huvudcoachen får en notis i appen och ett mejl. Bara beställande handläggare skriver från kommunen.
 */
export const messageSend = command("arenden.messageSend", z.object({
  caseId: IdSchema,
  body: LongText,
}), { invalidates: [CARD, "arenden.lista", PORTAL, INBOX, "coach.minVecka", "notiser.", ...LOG] }).returns<Result<{ messageId: string }, "not_found" | "forbidden" | "empty">>();

/** Läskvitto: markera andras meddelanden i ärendet som lästa (prototypens message.read, tyst). Gör inget för läsroller. */
export const messageRead = command("arenden.messageRead", z.object({
  caseId: IdSchema,
  /** Bara det här meddelandet (texten fälldes ut i tidslinjen). Utan: alla olästa i ärendet (fliken Meddelanden). */
  messageId: IdSchema.optional(),
}), { invalidates: [CARD, "arenden.lista", PORTAL, "inkorg.item", "coach.minVecka", "notiser."] }).returns<Result<{ marked: number }, "not_found">>();

/** Samtycke till inspelning och AI (prototypens consent.set). */
export const consentSet = command("arenden.consentSet", z.object({
  caseId: IdSchema,
  value: z.enum(["given", "declined", "revoked"]),
  /** Språket informationen gavs på (standard "lättläst svenska"). */
  language: z.string().max(60).optional(),
}), { invalidates: [CARD, "arenden.lista", "coach.checkInPage", "coach.assessmentPage", "coach.minVecka", "rost.", ...LOG] }).returns<Result<object, "not_found" | "protected" | "forbidden">>();

// ---- Bilagor till beställningen (beslut 2026-10-07, synpunkt #7 och beslut 4)
// Delas av portalen (beställningen och deltagarens sida) och Miljonbemanning (deltagarkortet och inkorgen). Filerna ligger i
// den privata bucketen "bilagor" (Stockholm) – appen laddar upp direkt med en signerad adress; minnesläget skickar innehållet
// med arenden.bilagaKlar (contentBase64). Filnamnet visas bara i appen och hamnar aldrig i en URL eller i revisionsloggen.
// Läsrätt: den som laddade upp (innan beställningen skickats), samordnare, avtalsansvarig och namngiven huvudcoach (full
// åtkomst) och beställande handläggare – aldrig handledare, ekonom, chef eller admin (policy.ts case_attachments, 0024).

/** En bilaga i listorna. */
export type AttachmentRow = {
  id: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  /** "2,4 MB" */
  sizeText: string;
  uploadedByName: string;
  createdAt: string;
  /** Den inloggade får ta bort filen: egen uppladdning innan beställningen skickats, eller samordnare/avtalsansvarig när ärendet är avslutat eller avböjt (beslut 5, 2026-10-08). */
  canRemove: boolean;
};

/** Bakgrundsinformationen från beställningen (portalens deltagarsida, deltagarkortet och inkorgen). */
export type CaseBackground = {
  /** "6 månader", "Annan tidsperiod" eller "8 veckor" (äldre beställning). */
  orderPeriodText: string;
  orderPeriodReason: string | null;
  priorAssessment: PriorAssessment | null;
  text: string;
  attachments: AttachmentRow[];
};

/**
 * Börja ladda upp en bilaga. caseId null = en ny beställning som inte är skickad (kommunens handläggare). Kontroller: rollen,
 * ärendet (via behörigheten), filtyp (PDF, Word, bild), storlek (högst 10 MB) och antal (högst 10). Svaret: var webbläsaren
 * laddar upp (uploadUrl, null i minnesläget). Loggas attachment.upload_started (id, typ, storlek – aldrig filnamnet).
 */
export const attachmentStart = command("arenden.bilagaStart", z.object({
  caseId: IdSchema.nullable(),
  fileName: z.string().max(400),
  mimeType: z.string().max(200),
  bytes: z.number().int().min(0).max(1_000_000_000),
}), { invalidates: [...LOG] }).returns<Result<{ attachmentId: string; uploadUrl: string | null; token: string | null; maxBytes: number }, "not_found" | "forbidden" | "invalid" | "too_many" | "no_contract">>();

/**
 * Filen är uppladdad: storleken och filsignaturen kontrolleras (fel typ eller för stor = filen raderas). contentBase64 bara i
 * minnesläget och prototypen (ingen lagring att ladda upp till) – ignoreras på servern. Loggas attachment.uploaded.
 */
export const attachmentDone = command("arenden.bilagaKlar", z.object({
  attachmentId: IdSchema,
  contentBase64: z.string().max(14_500_000).optional(),
}), { invalidates: [CARD, PORTAL, INBOX, ...LOG] }).returns<Result<{ attachment: AttachmentRow }, "not_found" | "invalid">>();

/**
 * Ta bort en bilaga: den som laddade upp innan beställningen skickats, eller samordnare/avtalsansvarig i ärendet – tidigast när
 * ärendet är avslutat eller beställningen avböjd (beslut 5, 2026-10-08; ingen automatisk gallring av bilagor).
 */
export const attachmentRemove = command("arenden.bilagaTaBort", z.object({ attachmentId: IdSchema }), { invalidates: [CARD, PORTAL, INBOX, ...LOG] }).returns<
  Result<object, "not_found" | "forbidden">
>();

/**
 * Hämta en bilaga (tyst kommando – loggar attachment.viewed innan något lämnas ut; misslyckas loggningen lämnas inget ut).
 * Appen: en signerad adress som gäller i 60 sekunder (utan filnamn) – webbläsaren hämtar filen och sparar den med fileName.
 * Minnesläget: innehållet (base64).
 */
export const attachmentDownload = command("arenden.bilagaHamta", z.object({ attachmentId: IdSchema }), { invalidates: "none" }).returns<
  Result<{ url: string | null; contentBase64: string | null; fileName: string; mimeType: string }, "not_found">
>();

// ---- Skärmarna i området ärenden (prototypens views/arenden.js: arenden.lista, arende.kort, hand.start)
// Varje fråga returnerar en vy-modell med bara det skärmen visar och rollen får se. Personnummer skickas bara maskerat.
// Behörighet per ärende enligt caseAccess (src/core/access.ts): full = allt (alla på Miljonbemanning i avtalets ärenden sedan
// 2026-10-09); team = finns kvar i typen men ges inte längre (handledare/teammedlem utan coachanteckningar, bedömningar eller
// rapporter). Nivån restricted (skyddade personuppgifter) är vilande sedan 2026-10-07 och behandlas som ingen åtkomst.

/** Närvarostatistik (prototypens sel.attendanceStats). rate = (närvarande + sena) / registrerade, null om inget registrerats. */
export type AttendanceSummary = {
  planned: number;
  present: number;
  late: number;
  absentValid: number;
  absentInvalid: number;
  unregistered: number;
  rate: number | null;
};
/** Flagga (prototypens sel.alerts) för rollen – coach och handledare ser aldrig eskaleringar till chef. */
export type CaseFlag = {
  key: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  text: string;
  /** Sökvägen flaggan leder till. */
  href: string;
  /** Leder flaggan till en flik i samma deltagarkort? Då byter knappen flik ("Visa"). tab null = översikten. */
  sameCase: { tab: string | null } | null;
  /** Prototypens vy-id för länken (för att avgöra om rollen får öppna den). */
  view: string;
};

// ---------------------------------------------------------------- Ärendelistan (/arenden)
export type CaseListDetail = {
  areaCode: string | null;
  /** "G Lager och logistik" */
  areaName: string;
  vocationalTrack: string;
  phase: number;
  phaseName: string;
  leadCoachId: string | null;
  leadCoachName: string | null;
  /** Start: startdatum, annars planerat första möte, annars önskad start. */
  start: string | null;
  /** Visas under datumet när insatsen inte har startat. */
  startNote: "planerad start" | "önskad start" | null;
  /** Avslutsdatum, annars planerat slut. */
  end: string | null;
  /** Samlad status i senaste godkända avstämningen. */
  latest: { overallStatus: TrafficLight | null; heldAt: string } | null;
  /** De fyra senaste hela ISO-veckorna. */
  attendance: AttendanceSummary;
  flags: CaseFlag[];
  /** Olästa meddelanden från kommunen till den inloggade (0 för chef och systemadmin). */
  unread: number;
};
export type CaseListRow = {
  id: string;
  caseNumber: string;
  status: CaseStatus;
  referredAt: string;
  /** Sorteringsnyckel "planerat slut – närmast först" (avslutade och avböjda sist). */
  endSortKey: string;
  /** Namnet. Används också i sökningen. */
  displayName: string;
  /** Ärendet har flaggor för rollen. */
  flagged: boolean;
  /** Allvarligaste flaggan: 0 kritisk, 1 varning, 2 information, 9 ingen (sortering "Flaggade först"). */
  flagRank: number;
  /** Tilldelat mig: huvudcoach eller i teamet (listans val Mina ärenden / Alla ärenden, beslut 2026-10-09). */
  mine: boolean;
  detail: CaseListDetail;
};
export type CaseListModel = {
  customerName: string;
  today: string;
  /** De fyra senaste hela ISO-veckorna ("v. 1–4"). */
  weeks: { from: string; to: string; label: string };
  coaches: { id: string; name: string }[];
  areas: { code: string; name: string }[];
  phases: { no: number; name: string }[];
  rows: CaseListRow[];
};
export const caseList = query("arenden.lista", z.object({})).returns<CaseListModel>();
/** Listans urval för coach och handledare: egna (huvudcoach eller i teamet) eller alla ärenden i avtalet (beslut 2026-10-09). */
export const CASE_LIST_SCOPES = ["mina", "alla"] as const;

// ---------------------------------------------------------------- Deltagarkortet (/arenden/:caseId)
export type CaseTab =
  | "oversikt" | "tidslinje" | "kartlaggning" | "avstamningar" | "narvaro" | "manad" | "handelser" | "avvikelser" | "praktik" | "rapporter" | "meddelanden" | "historik";
export const CASE_TABS = [
  "oversikt", "tidslinje", "kartlaggning", "avstamningar", "narvaro", "manad", "handelser", "avvikelser", "praktik", "rapporter", "meddelanden", "historik",
] as const satisfies readonly CaseTab[];
/** Flikarna som teamet (handledare) ser – inga coachanteckningar, bedömningar eller rapporter. Tidslinjen visar bara teamets delar. */
export const TEAM_TABS = ["oversikt", "tidslinje", "narvaro", "praktik", "handelser"] as const satisfies readonly CaseTab[];

export type CaseCard = {
  kind: "ok";
  /** Klockan när frågan räknades (förval och kontroller i formulären). */
  now: string;
  caseId: string;
  caseNumber: string;
  displayName: string;
  access: "full" | "team";
  /** Får ändra i ärendet: samordnare och avtalsansvarig, huvudcoachen i egna ärenden. */
  edit: boolean;
  /** Samordnare eller avtalsansvarig med full åtkomst (byter coach, bokar möte). */
  manage: boolean;
  /** Chef och systemadmin ser ärendet i läsläge. */
  readOnly: boolean;
  status: CaseStatus;
  phase: number;
  phaseName: string;
  phaseCount: number;
  /** Sedan när ärendet är i nuvarande fas (bara pågående). */
  phaseSince: string | null;
  /** Fastnat i fasen (gränsen i avtalet). acked = flaggan är kvitterad med åtgärdsplan (samma källa som Min vecka och listan). */
  stuck: { days: number; phase: number; maxDays: number; acked: { byName: string; at: string } | null } | null;
  areaName: string;
  secondaryAreaName: string | null;
  vocationalTrack: string;
  referredAt: string;
  /** "mejl", "portalen", "telefon" */
  sourceText: string;
  startDate: string | null;
  firstMeetingAt: string | null;
  plannedEnd: string | null;
  endDate: string | null;
  endReasonLabel: string | null;
  /** Avslut till arbete eller studier som inte är verifierat. */
  resultPrelim: boolean;
  /**
   * Beställningens omfattning i veckor (inte för teamet). Inget pris och inget ordervärde – belopp syns bara för ekonomen
   * (synpunkt #10/#11 och beslut 5, 2026-10-07).
   */
  order: { weeks: number | null } | null;
  pnr: { masked: string | null; canReveal: boolean; hidden: boolean };
  contactText: string;
  /** Deltagarens föredragna kontaktväg ("SMS", "E-post" …). */
  contactLabel: string | null;
  /** Deltagaren saknar telefonnummer och e-postadress – kontaktvägen är bara förvalet (kallelsen når inte fram). */
  contactMissing: boolean;
  /**
   * Kontaktuppgifterna att ändra med Ändra kontaktväg (arenden.caseSetContact) – bara för samordnare, avtalsansvarig, coach
   * och systemadministratör med full åtkomst, annars null. Kommunen anger inte längre kontaktvägen (beslut 2026-10-09).
   */
  contact: { preferredContact: PreferredContact; phone: string; email: string } | null;
  languageText: string;
  /** Deltagarens språk (för samtyckets språkval). */
  language: string;
  accessibilityNeeds: string;
  /** Beställande handläggare. */
  referrer: { name: string; title: string; unit: string; email: string } | null;
  /** Inte för teamet. */
  buyer: { reference: string | null; problem: string | null; purchaseOrderNumber: string | null } | null;
  leadCoach: { id: string; name: string } | null;
  team: { userId: string; name: string; role: TeamRole; roleLabel: string }[];
  /** Teamet har en huvudcoach (för texten "Bara huvudcoach"). */
  hasLeadInTeam: boolean;
  /** Den inloggades roll i teamet (teamåtkomst). */
  myTeamRoleLabel: string | null;
  location: string;
  flags: CaseFlag[];
  /** Olästa meddelanden från kommunen till den inloggade. */
  unread: number;
  openDeviations: number;
  /** Samtycke till inspelning och AI (inte för teamet). */
  consent: {
    /** "not_applicable" (skyddade personuppgifter, vilande sedan 2026-10-07) visas som "not_asked". */
    value: Exclude<AiConsentStatus, "not_applicable">;
    givenAt: string | null;
    informedByName: string | null;
    textVersion: string | null;
    language: string | null;
    revokedAt: string | null;
  } | null;
  /** Första mötet: senaste tid enligt avtalet och text om tidsgränsen. */
  firstMeeting: { dueAt: string | null; sla: { label: string; tone: SlaTone } | null; withinText: string };
  keyPersonnelChangeRequiresApproval: boolean;
  customerSeesCoachNotes: boolean;
  /** Kommunens roll som har åtkomst till ärendet (bara för perspektivbytet i prototypen). */
  customerRole: "kommun_handlaggare" | null;
  /**
   * Bakgrundsinformation från beställningen (beslut 2026-10-07): omfattningen, om en kartläggning genomförts, texten och
   * bilagorna. Bara med full åtkomst (samordnare, avtalsansvarig, namngiven huvudcoach – chef och admin ser inte bilagorna).
   */
  background: CaseBackground | null;
  /** Coacher att byta till, med antal aktiva ärenden (bara samordnare och avtalsansvarig). */
  coachOptions: { id: string; name: string; active: number }[];
  /**
   * Starta insatsen (beslut 2026-10-08): bekräftat ärende med bokat första möte, för den som får ändra i ärendet.
   * Standardplanen ur avtalet med första mötets dag och tid, och startdatumet (första mötets dag).
   */
  start: { firstMeetingAt: string; startDate: string; plan: WeekPlanRow[] } | null;
  /** Nuvarande veckoplan i ett pågående ärende (ur kommande tillfällen, annars avtalets standard) – för Ändra veckoplan. */
  weekPlan: WeekPlanRow[] | null;
  /**
   * Kandidater till teamet (bara samordnare och avtalsansvarig i ett öppet ärende): all MB-personal utom ekonom och admin.
   * Teamvalet Handledare finns inte (rollen handledare borttagen, Karims beslut 2026-10-09).
   */
  teamOptions: { staff: { id: string; name: string }[] } | null;
};
export type CaseCardResult =
  | CaseCard
  | { kind: "not_found" }
  /** Ärendet finns men rollen har ingen åtkomst. */
  | { kind: "denied" };
export const caseCard = query("arenden.kort", z.object({ caseId: IdSchema })).returns<CaseCardResult>();

const CaseParams = z.object({ caseId: IdSchema });
type CaseActivity = { id: string; kind: ActivityKind; startsAt: string; location: string };

/** Flik Översikt. null = ingen åtkomst. */
export type CaseOverview = {
  nextMeeting: { startsAt: string; first: boolean; location: string } | null;
  closed: boolean;
  /** Senaste godkända avstämning (inte för teamet). */
  latest: { overallStatus: TrafficLight | null; heldAt: string; mode: CheckInMode | null; goalStatus: GoalStatus | null; nextGoal: string; note: string } | null;
  drafts: { count: number; ai: boolean };
  weeksLabel: string;
  attendance: AttendanceSummary;
  /** Kommande 14 dagar (teamet: inga coachmöten). */
  upcoming: CaseActivity[];
  placement: { employerName: string | null; startsOn: string; endsOn: string | null; supervisorName: string; fourRights: FourRights | null } | null;
};
export const caseOverview = query("arenden.kortOversikt", CaseParams).returns<CaseOverview | null>();

export type CaseIntake = {
  intake: {
    workExperience: string; education: string; languageNotes: string; digitalSkills: string; drivingLicence: string; workGoals: string;
    chosenTrack: string; adaptations: string; firstWeekGoal: string; approved: boolean; approvedAt: string | null; approvedByName: string | null;
  } | null;
  stuck: { days: number; phase: number; maxDays: number } | null;
};
export const caseIntake = query("arenden.kortKartlaggning", CaseParams).returns<CaseIntake | null>();

export type CaseCheckInRow = {
  id: string; heldAt: string; mode: CheckInMode | null; goalStatus: GoalStatus | null; phase: number | null; overallStatus: TrafficLight | null;
  obstacles: string[]; note: string; approved: boolean; ai: boolean;
};
export const caseCheckIns = query("arenden.kortAvstamningar", CaseParams).returns<{ checkIns: CaseCheckInRow[] } | null>();

export type CaseAttendanceWeek = { key: string; paused: boolean; stats: AttendanceSummary; future: number };
export type CaseAttendance = {
  started: boolean;
  weeks: CaseAttendanceWeek[];
  total: AttendanceSummary & { reasons: [string, number][] };
  last4: AttendanceSummary;
  weeksLabel: string;
  /** Upprepad ogiltig frånvaro enligt avtalets regel. */
  repeated: { dates: string[]; absentInvalid: number; withinDays: number } | null;
  /** Senaste tio passerade tillfällena, senaste först. */
  past: (CaseActivity & { attendance: { status: AttendanceStatus; reason: string } | null })[];
  /** Kommande tillfällen (högst tio) – kan tas bort tills närvaro registrerats (beslut 2026-10-08). */
  upcoming: (CaseActivity & { durationMin: number })[];
  /** "måndag 10.00" – när närvaron ska vara registrerad (avtalet), eller null. */
  registerBy: string | null;
};
export const caseAttendance = query("arenden.kortNarvaro", CaseParams).returns<CaseAttendance | null>();

// ---------------------------------------------------------------- Flik: Tidslinje (rapporter steg 2, SPEC §7.18)
/** Filterknapparna (visa=). */
export const TIMELINE_CATS = ["alla", "insatser", "narvaro", "progression", "resultat", "anteckningar", "ovrigt"] as const;
export type TimelineCat = (typeof TIMELINE_CATS)[number];
export type TimelineEntryCat = Exclude<TimelineCat, "alla">;
export const TIMELINE_CAT_LABEL: Record<TimelineCat, string> = {
  alla: "Allt", insatser: "Insatser och aktiviteter", narvaro: "Närvaro", progression: "Progression", resultat: "Resultat", anteckningar: "Anteckningar", ovrigt: "Övrigt",
};
/** Ikon för en post (namn i src/ui/icons). */
export type TimelineIcon =
  | "calendar" | "check-square" | "edit" | "briefcase" | "activity" | "pause" | "alert" | "clipboard" | "chart" | "award" | "users" | "flag" | "mic" | "file"
  | "message" | "check-circle" | "x-circle" | "minus-circle" | "info";
/** En fri anteckning i tidslinjen. Texten är innehållet (hela anteckningen, radbrytningar bevaras). */
export type TimelineNote = {
  id: string;
  kind: CaseNoteKind;
  audience: CaseNoteAudience;
  occurredOn: LocalDate;
  body: string;
  /** Författaren kan ändra (och ta bort) – bara den som skrev anteckningen och fortfarande arbetar i ärendet. */
  canEdit: boolean;
  /** Får ta bort: författaren, eller samordnare/avtalsansvarig med full åtkomst (beslut 2026-10-01). */
  canRemove: boolean;
  /** Författarens namn (bekräftelsetexten när någon annan tar bort anteckningen). */
  authorName: string;
  /** Borttagen av någon annan: visas bara för författaren ("Borttagen av Sara Lindqvist 29 jan"). */
  removed: { byName: string; at: LocalDateTime } | null;
};
export type TimelineEntry = {
  id: string;
  /** Datum (eller datum och tid) som posten sorteras och visas på. */
  at: string;
  /** Veckoposter visar veckan i stället för datumet ("Vecka 39"). */
  weekLabel?: string;
  cat: TimelineEntryCat;
  icon: TimelineIcon;
  title: string;
  sub?: string;
  /** Samlad status (månadsbedömning) – visas med ikon och text. */
  light?: TrafficLight | null;
  state?: "utkast" | "ej_verifierad" | "varning";
  /** Fliken som "Öppna" går till. */
  tab?: CaseTab;
  /** Månaden som fliken Månadsunderlag ska öppnas på (?manad=). */
  month?: MonthKey;
  note?: TimelineNote;
  /**
   * Posten har text som kan fällas ut i tidslinjen ("Visa text"): meddelandets text eller avstämningens anteckning och
   * hinder (arenden.kortTidslinjeText, hämtas först vid utfällning). Bara vid full åtkomst – teamet får aldrig sådana poster.
   */
  text?: "message" | "check_in";
};
export type CaseTimelineMonth = {
  month: MonthKey;
  /** Månadsrapportens status – bara vid full åtkomst. id null = ingen rapportrad än. */
  report: { id: string | null; statusLabel: string } | null;
  entries: TimelineEntry[];
};
export type CaseTimeline = {
  months: CaseTimelineMonth[];
  /** Det finns äldre månader med poster (för "Visa tidigare månader" – fore = den äldsta månaden här). */
  more: boolean;
  /** Får skriva anteckningar (den som arbetar i ärendet). */
  canWrite: boolean;
  /** Ärendet har inga poster alls (oavsett filter) – "Här samlas allt som händer i insatsen …". */
  empty: boolean;
};
export const caseTimeline = query("arenden.kortTidslinje", CaseParams.extend({ visa: z.enum(TIMELINE_CATS).optional(), fore: MonthKeySchema.optional() })).returns<CaseTimeline | null>();

/** Tidslinjepostens id för text som kan fällas ut: "msg:<meddelande>" eller "ci:<avstämning>". */
export const TIMELINE_TEXT_ID = /^(msg|ci):[A-Za-z0-9_-]{1,64}$/;
/** Texten bakom en tidslinjepost – samma uppgifter som fliken Meddelanden respektive Avstämningar visar. */
export type TimelineText =
  /** unreadByMe: meddelandet från kommunen är oläst av den som tittar – skärmen kör arenden.messageRead när texten fälls ut. */
  | { kind: "message"; senderName: string; orgName: string; createdAt: LocalDateTime; meetingRequest: boolean; body: string; readText: string; unreadByMe: boolean }
  /** note och attendanceComment bara när avstämningen är godkänd (utkast: tomma, som fliken – "Granskas av coachen"); hindren alltid. */
  | { kind: "check_in"; heldAt: LocalDateTime; approved: boolean; note: string; obstacles: string[]; attendanceComment: string };
/**
 * Texten som fälls ut i tidslinjen (beslut 2026-10-02, Karim): hämtas först när posten fälls ut – aldrig i grundfrågan.
 * Samma åtkomst som fliken (teamet och kommunen: null). Ingen extra loggning – flikarna loggar inte heller visning.
 */
export const caseTimelineText = query("arenden.kortTidslinjeText", CaseParams.extend({ id: z.string().regex(TIMELINE_TEXT_ID) })).returns<TimelineText | null>();

// ---------------------------------------------------------------- Fria anteckningar (case_notes)
/** Spara en ny anteckning eller ändra en egen. Personnummer och framtida datum nekas. Kommunen ser aldrig anteckningar. */
export const caseNoteSave = command("arenden.noteSave", z.object({
  caseId: IdSchema,
  noteId: IdSchema.optional(),
  occurredOn: LocalDateSchema,
  kind: z.enum(CASE_NOTE_KINDS),
  audience: z.enum(CASE_NOTE_AUDIENCES),
  body: z.string().trim().min(1).max(2000),
}), { invalidates: ["arenden.kortTidslinje", "arenden.kortManad", "arenden.kortHistorik", "coach.assessmentPage", ...LOG] }).returns<Result<{ noteId: string }, "not_found" | "forbidden" | "not_author" | "pnr" | "date">>();

/** Ta bort (dölja) en anteckning: författaren, eller samordnare och avtalsansvarig i avtalet. Inget raderas på riktigt. */
export const caseNoteRemove = command("arenden.noteRemove", z.object({
  caseId: IdSchema,
  noteId: IdSchema,
}), { invalidates: ["arenden.kortTidslinje", "arenden.kortManad", "arenden.kortHistorik", "coach.assessmentPage", ...LOG] }).returns<Result<object, "not_found" | "forbidden" | "not_author">>();

// ---------------------------------------------------------------- Flik: Månadsunderlag (?flik=manad)
/** Det som saknas innan månadsrapporten kan godkännas – bara antal, aldrig text (monthlyGaps i rapporter/model.ts). */
export type { MonthlyGaps };
/**
 * Raden om godkända mötesrapporter i "Innan rapporten kan godkännas": antalet godkända avstämningar under månaden (som
 * rapporten och dataexporten räknar dem). Jämförs aldrig med antalet veckor – en vecka över månadsskiftet hör till båda
 * månadernas veckorader, men avstämningen räknas bara i den månad den hölls. Det som saknas är utkasten (egen rad).
 */
export function checkInsApprovedGap(g: Pick<MonthlyGaps, "checkInsApproved">): { kind: "ok" | "info"; text: string } {
  const n = g.checkInsApproved;
  if (n === 0) return { kind: "info", text: "Ingen mötesrapport är godkänd än." };
  return { kind: "ok", text: n === 1 ? "1 mötesrapport är godkänd." : `${n} mötesrapporter är godkända.` };
}
export type CaseMonthOption = { month: MonthKey; current: boolean; delivered: boolean };
export type CaseMonthBasis = {
  /** Månaderna från startmånaden till innevarande månad (eller slutmånaden), senaste först. */
  months: CaseMonthOption[];
  /** Vald månad. */
  month: MonthKey;
  /** Insatsen hade inte startat i den valda månaden. */
  beforeStart: boolean;
  /** Progression över tid: områdena (obligatoriska + valfria som någon gång bedömts) × månader med godkänd bedömning. */
  matrix: { months: MonthKey[]; rows: { key: string; label: string; optional: boolean; levels: (number | null)[] }[]; scale: Record<string, string> };
  /** Förra månaden saknar bedömning (pågående ärende som startade före månadens slut). */
  missingMonth: MonthKey | null;
  /** Det som saknas (null när månaden är levererad eller före start). */
  gaps: MonthlyGaps | null;
  /** Samma dokument som månadsrapporten (monthlyPreview) – null när månaden är levererad eller före start. */
  doc: Extract<ReportDocView, { kind: "monthly" }> | null;
  /** Den levererade versionen, och en rättelse som är ett utkast. */
  delivered: { reportId: string; deliveredAt: LocalDateTime; version: number; correctionDraft: number | null } | null;
  /** Rapportraden för månaden om den finns (senaste version som inte är ersatt). */
  reportId: string | null;
  /** Huvudcoachen gör månadsbedömningen (räknat på servern). */
  canAssess: boolean;
};
export const caseMonthBasis = query("arenden.kortManad", CaseParams.extend({ manad: MonthKeySchema.optional() })).returns<CaseMonthBasis | null>();

export type CaseEventRow = {
  id: string; kind: OutcomeEventKind; label: string; occurredOn: string; actor: string; note: string; verificationKind: string | null;
  /** Möjligt bonusunderlag. Alltid false för teamet och för begränsade testare (bonus är ett ekonomiskt villkor). */
  needsVerification: boolean; possibleBonus: boolean;
};
export type CaseEvents = {
  events: CaseEventRow[];
  /** Arbetsgivarkontakter i godkända avstämningar (teamet). */
  checkInContacts: number;
  result: { endDate: string | null; endReasonLabel: string; resultClass: ResultClass | null; verifiedAt: string | null } | null;
  resultDefinitionUnset: boolean;
  prototypeDefinition: string | null;
  bonusEnabled: boolean;
};
export const caseEvents = query("arenden.kortHandelser", CaseParams).returns<CaseEvents | null>();

export type CaseDeviationRow = {
  id: string; createdAt: string; description: string; assessment: string; action: string; ownerName: string | null; followUpOn: string | null;
  needsCustomerDecision: boolean; followUpMeetingAt: string | null; open: boolean; fromCheckIn: boolean;
  /** Uppföljningens tidsgräns (öppna avvikelser). */
  due: { dueAt: string; sla: { label: string; tone: SlaTone } } | null;
};
export type CaseDeviations = {
  deviations: CaseDeviationRow[];
  repeated: { count: number; withinDays: number } | null;
  owners: { id: string; label: string }[];
  defaultOwnerId: string | null;
  defaultFollowUpOn: string;
  defaultCallAt: string;
  today: string;
  now: string;
};
export const caseDeviations = query("arenden.kortAvvikelser", CaseParams).returns<CaseDeviations | null>();

export type CasePlacements = {
  placements: {
    id: string; employerName: string | null; contactName: string | null; phone: string | null; status: PlacementStatus; startsOn: string; endsOn: string | null;
    tasks: string; goals: string; supervisorName: string; followUpDates: string[]; fourRights: FourRights;
  }[];
  contacts: { id: string; actor: string; label: string; occurredOn: string }[];
  checkInContacts: number;
  phase: number;
  today: string;
};
export const casePlacements = query("arenden.kortPraktik", CaseParams).returns<CasePlacements | null>();

export type CaseReportRow = {
  id: string; kind: ReportKind; kindLabel: string; periodText: string; version: number; status: ReportStatus; statusLabel: string;
  /** Version som håller på att rättas och inte levererats än. */
  correctionVersion: number | null;
  dueAt: string | null; sla: { label: string; tone: SlaTone } | null; provisionalDue: boolean; deliveredAt: string | null; openedAt: string | null;
};
export const caseReports = query("arenden.kortRapporter", CaseParams).returns<{ reports: CaseReportRow[] } | null>();

export type CaseMessageRow = { id: string; senderName: string; mine: boolean; orgName: string; createdAt: string; meetingRequest: boolean; body: string; readText: string };
export const caseMessages = query("arenden.kortMeddelanden", CaseParams).returns<{ messages: CaseMessageRow[] } | null>();

export type CaseHistoryItem = {
  id: string; icon: "users" | "check-square" | "x-circle" | "check" | "inbox"; filled: boolean; red: boolean; title: string; sub: string;
  reason: string | null; customerNotifiedAt: string | null; leadCoachName: string | null;
};
export type CaseLogRow = { id: string; occurredAt: string; actorName: string; text: string; sub: string };
export type CaseHistory = {
  items: CaseHistoryItem[];
  /** Coach och handledare ser bara sina egna åtgärder. */
  ownOnly: boolean;
  log: CaseLogRow[];
};
export const caseHistory = query("arenden.kortHistorik", CaseParams).returns<CaseHistory | null>();

/**
 * Visa hela personnumret (maskerat i vy-modellen). Bara roller med full åtkomst till ärendet. Visningen loggas i
 * revisionsloggen (pnr.revealed) – numret skickas aldrig i loggen.
 */
export const caseRevealPnr = command("arenden.visaPersonnummer", CaseParams, { invalidates: "none" }).returns<Result<{ pnr: string }, "not_found" | "forbidden" | "missing">>();

// Handledarens startsida (/handledare, arenden.handledare) är borttagen med rollen handledare (Karims beslut 2026-10-09).
