// Kontrakt för området ärenden (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
import { z } from "zod";
import { command, type Result } from "@/api/contract";
import { CASE_SOURCES, END_REASONS, PREFERRED_CONTACTS, TEAM_ROLES, type ResultClass } from "@/data/schema";
import { IdSchema, LocalDateSchema, LocalDateTimeSchema, LongText, ShortText, WeekKeySchema } from "../_shared/schemas";

// ---- Delade kommandon (portade från prototypens 03-domain.js)
// Samma beteende, valideringar, felkoder och texter som prototypens MM.defineAction. Nyckeln är "arenden.<prototypens namn>".
// Affärsfel returneras som { ok: false, error, message } – message är en text till användaren (klarspråk).
// Gemensamma felkoder: not_found = ärendet finns inte eller rollen får inte se det, forbidden = rollen får se men inte ändra.

/**
 * Ny beställning (portalen, telefon eller manuellt från mejl) – prototypens case.create.
 * Ger nästa ärendenummer i avtalets serie och skickar ordererkännande (eller generisk mottagningsbekräftelse vid
 * skyddade personuppgifter, plus en uppgift till avtalsansvarig). Kommunens handläggare beställer alltid i eget namn.
 * contractId: utelämnas = användarens aktiva avtal. Personnummer krypteras innan det sparas och skickas aldrig tillbaka.
 */
export const caseCreate = command("arenden.caseCreate", z.object({
  contractId: IdSchema.optional(),
  protectedIdentity: z.boolean().optional(),
  source: z.enum(CASE_SOURCES).optional(),
  /** Beställande handläggare. Ignoreras för kommunens handläggare (alltid den inloggade). */
  referrerId: IdSchema.nullable().optional(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  pnr: z.string().max(20).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  /** Bara när kontaktvägen är brev. Sparas aldrig vid skyddade personuppgifter. */
  address: z.string().max(300).nullable().optional(),
  preferredContact: z.enum(PREFERRED_CONTACTS).optional(),
  accessibilityNeeds: z.string().max(1000).optional(),
  language: z.string().max(60).optional(),
  needsInterpreter: z.boolean().optional(),
  buyerReference: z.string().max(40).optional(),
  purchaseOrderNumber: z.string().max(40).nullable().optional(),
  primaryArea: z.string().max(10).nullable().optional(),
  secondaryArea: z.string().max(10).nullable().optional(),
  vocationalTrack: z.string().max(200).optional(),
  desiredStart: LocalDateSchema.nullable().optional(),
  plannedWeeks: z.number().int().min(1).max(52).nullable().optional(),
  plannedEnd: LocalDateSchema.nullable().optional(),
  background: z.string().max(4000).optional(),
})).returns<Result<{ caseId: string; caseNumber: string }, "buyer_ref" | "po_number" | "duplicate" | "referrer" | "forbidden" | "no_contract">>();

/**
 * Acceptera avrop → orderbekräftelse (prototypens case.accept). Beställarreferensen valideras mot avtalets mönster
 * innan något sparas. Skapar orderbekräftelsen (levererad i portalen), teamet, notiser till coach och team, mejl till
 * kommunen och kallelse till deltagaren (aldrig vid skyddade personuppgifter).
 * buyerReference: utelämnas = ärendets nuvarande referens.
 */
export const caseAccept = command("arenden.caseAccept", z.object({
  caseId: IdSchema,
  leadCoachId: IdSchema,
  firstMeetingAt: LocalDateTimeSchema.optional(),
  startDate: LocalDateSchema.optional(),
  plannedWeeks: z.number().int().min(1).max(52).optional(),
  buyerReference: z.string().max(40).nullable().optional(),
  team: z.array(z.object({ userId: IdSchema, role: z.enum(TEAM_ROLES) })).max(10).optional(),
})).returns<Result<{ reportId: string; caseNumber: string }, "not_found" | "buyer_ref" | "wrong_status" | "forbidden" | "coach" | "team">>();

/** Avböj avrop med orsak (prototypens case.decline). Kommunen får ett mejl utan personuppgifter. */
export const caseDecline = command("arenden.caseDecline", z.object({
  caseId: IdSchema,
  reason: z.string().max(2000),
})).returns<Result<object, "not_found" | "reason" | "wrong_status" | "forbidden">>();

/** Fält som kan ändras med arenden.caseUpdate. Kommunens handläggare får bara ändra beställarens kontaktuppgifter. */
export const CasePatchSchema = z.strictObject({
  referrerName: ShortText.nullable(),
  referrerUnit: ShortText.nullable(),
  referrerPhone: z.string().max(40).nullable(),
  referrerEmail: z.string().max(200).nullable(),
  desiredStart: LocalDateSchema.nullable(),
  plannedStart: LocalDateSchema.nullable(),
  plannedWeeks: z.number().int().min(1).max(52).nullable(),
  plannedEnd: LocalDateSchema.nullable(),
  orderValueWeeks: z.number().int().min(1).max(104).nullable(),
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
})).returns<Result<{ changed: string[] }, "not_found" | "forbidden" | "po_number">>();

/** Ändra beställarreferens (prototypens case.setBuyerRef). source = t.ex. uppgiftens id eller "ekonom". */
export const caseSetBuyerRef = command("arenden.caseSetBuyerRef", z.object({
  caseId: IdSchema,
  reference: z.string().max(40),
  source: ShortText.optional(),
})).returns<Result<object, "not_found" | "buyer_ref" | "forbidden">>();

/** Boka första mötet (prototypens case.bookFirstMeeting). Kallelse via föredragen kontaktväg – aldrig vid skyddade personuppgifter. */
export const caseBookFirstMeeting = command("arenden.caseBookFirstMeeting", z.object({
  caseId: IdSchema,
  at: LocalDateTimeSchema,
})).returns<Result<object, "not_found" | "forbidden">>();

/** Byt huvudcoach med orsak (prototypens case.changeCoach). Nya coachen och kommunen får notis utan personuppgifter. */
export const caseChangeCoach = command("arenden.caseChangeCoach", z.object({
  caseId: IdSchema,
  toCoachId: IdSchema,
  reason: z.string().max(2000),
})).returns<Result<object, "not_found" | "reason" | "coach" | "forbidden">>();

/**
 * Avsluta insatsen (prototypens case.close): resultatklass enligt avtalets resultatdefinition, utkast till slutrapport
 * och exit-pulsmätning (inte vid skyddade personuppgifter). verified = arbete/studier är verifierat.
 */
export const caseClose = command("arenden.caseClose", z.object({
  caseId: IdSchema,
  endDate: z.union([LocalDateSchema, z.literal("")]).nullable().optional(),
  endReason: z.union([z.enum(END_REASONS), z.literal("")]).nullable().optional(),
  verified: z.boolean().optional(),
})).returns<Result<{ reportId: string; resultClass: ResultClass }, "not_found" | "missing" | "forbidden" | "wrong_status">>();

/**
 * Säkert meddelande i ärendet (prototypens message.send). Från Miljonbemanning: kommunen får ett mejl utan innehåll.
 * Från kommunen: huvudcoachen får en notis i appen och ett mejl. Bara beställande handläggare skriver från kommunen.
 */
export const messageSend = command("arenden.messageSend", z.object({
  caseId: IdSchema,
  body: LongText,
})).returns<Result<{ messageId: string }, "not_found" | "forbidden" | "empty">>();

/** Läskvitto: markera andras meddelanden i ärendet som lästa (prototypens message.read, tyst). Gör inget för läsroller. */
export const messageRead = command("arenden.messageRead", z.object({
  caseId: IdSchema,
})).returns<Result<{ marked: number }, "not_found">>();

/** Samtycke till inspelning och AI (prototypens consent.set). Kan inte registreras vid skyddade personuppgifter. */
export const consentSet = command("arenden.consentSet", z.object({
  caseId: IdSchema,
  value: z.enum(["given", "declined", "revoked"]),
  /** Språket informationen gavs på (standard "lättläst svenska"). */
  language: z.string().max(60).optional(),
})).returns<Result<object, "not_found" | "protected" | "forbidden">>();
