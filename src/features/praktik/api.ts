// Kontrakt för området praktik: det gemensamma arbetsgivarregistret och praktikplatserna med de fyra rätten (SPEC §7.9, fas 3).
// Skärm: /praktik/:employerId? (prototypens praktik.arbetsgivare i prototyp/src/views/admin.js).
//
//   praktik.list        -> EmployerListView    registret, nyckeltal och uppföljningar de närmaste sju dagarna
//   praktik.employer    -> EmployerDetailView  kontaktuppgifter och praktikplatser (namn bara för ärenden man har åtkomst till)
//   praktik.employerAdd, praktik.setRight, praktik.addFollowUp (prototypens employer.add, employer.setRight, employer.addFollowUp)
//
// Deltagarnas namn och ärendenummer visas bara för teamet i ärendet. Praktikplatser i andra team visas utan namn och
// utan ärendenummer (period, arbetsuppgifter och de fyra rätten) – så att registret visar hur arbetsgivaren används.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import { NAV, LOG, CASES, START, COACH, PORTAL, REPORTS, MGMT, BILLING, INBOX, CASE_STATS, AKTIVITETER } from "@/api/invalidation";
import type { FourRights, PlacementStatus } from "@/data/schema";
import { IdSchema, LocalDateSchema, ShortText } from "../_shared/schemas";

export type AreaOption = { code: string; name: string };
export type EmployerRow = {
  id: string;
  name: string;
  orgNr: string;
  contactName: string;
  phone: string;
  areas: AreaOption[];
  total: number;
  ongoing: number;
  next: string | null;
};
export type UpcomingRow = {
  key: string;
  date: string;
  employerId: string;
  employerName: string;
  /** "Nadia Warsame · BOT-26-0143" för egna ärenden, annars "Deltagare i ett annat team" eller "Skyddade personuppgifter". */
  who: string;
  rightsDone: number;
};
export type EmployerListView = {
  /** Coach och handledare ser uppföljningar bara i sina egna ärenden. */
  mineOnly: boolean;
  employers: EmployerRow[];
  kpis: { employers: number; ongoing: number; total: number; upcoming: number; full: number };
  /** De sex första uppföljningarna. */
  upcoming: UpcomingRow[];
  areas: AreaOption[];
  /** Bara prototypen: ärendet i genomgången (Nadia) – för perspektivbytet till kundens vy. */
  demoCaseId: string | null;
};
export const praktikList = query("praktik.list", z.object({})).returns<EmployerListView>();

export type PlacementCardView = {
  id: string;
  caseId: string;
  caseNumber: string;
  who: string;
  /** Teamet i ärendet kan bocka i de fyra rätten och planera uppföljning. */
  canEdit: boolean;
  /** Beställande handläggare (bara id) – för perspektivbytet i prototypen. */
  referrerId: string | null;
  startsOn: string;
  endsOn: string | null;
  supervisorName: string;
  tasks: string;
  goals: string;
  status: PlacementStatus;
  fourRights: FourRights;
  followUpDates: string[];
  rightsDone: number;
};
/** Praktikplats i ett annat team (samma avtal, inte skyddade personuppgifter): utan namn, ärendenummer och fritext. */
export type OtherPlacementRow = { id: string; who: string; startsOn: string; endsOn: string | null; rightsDone: number };
export type PlacementGroup = { mine: PlacementCardView[]; others: OtherPlacementRow[] };
export type EmployerDetailView =
  | { found: false }
  | {
      found: true;
      employer: {
        id: string;
        name: string;
        orgNr: string;
        contactName: string;
        phone: string;
        email: string;
        areas: AreaOption[];
        createdAt: string | null;
        createdByName: string | null;
      };
      ongoing: PlacementGroup;
      done: PlacementGroup;
      ongoingCount: number;
      doneCount: number;
      /** "Praktikplatser" (samordnare, avtalsansvarig) eller "Praktikplatser i dina ärenden". */
      scopeLabel: string;
      today: string;
    };
export const praktikEmployer = query("praktik.employer", z.object({ employerId: IdSchema })).returns<EmployerDetailView>();

export const praktikEmployerAdd = command("praktik.employerAdd", z.object({
  name: ShortText,
  orgNr: ShortText,
  contactName: ShortText,
  phone: ShortText,
  email: ShortText,
  areas: z.array(z.string().max(5)).max(20),
}), { invalidates: ["praktik.", "coach.eventsPage", "arenden.kortPraktik", ...LOG] }).returns<Result<{ employerId: string }, "name" | "orgNr" | "email" | "duplicate" | "areas">>();

export const RIGHT_KEYS = ["uppgift", "handledning", "timing", "uppfoljning"] as const;
export const praktikSetRight = command("praktik.setRight", z.object({ placementId: IdSchema, right: z.enum(RIGHT_KEYS), value: z.boolean() }), { invalidates: ["praktik.", CASES, "coach.minVecka", "coach.intakePage", ...START, "rapporter.dokument", "rapporter.visa", "kommun.deltagare", NAV, ...LOG] }).returns<Result<object, "not_found">>();
export const praktikAddFollowUp = command("praktik.addFollowUp", z.object({ placementId: IdSchema, date: LocalDateSchema }), { invalidates: ["praktik.", CASES, "coach.minVecka", "coach.intakePage", ...START, "rapporter.dokument", "rapporter.visa", "kommun.deltagare", NAV, ...LOG] }).returns<Result<object, "not_found" | "date">>();

// ---- Ny praktik och avslutad praktik (beslut 2026-10-08, skarp drift: inga placeringar kunde skapas i appen)
/**
 * Ny praktik i ett pågående ärende (huvudcoachen, samordnare, avtalsansvarig): befintlig arbetsgivare eller en ny
 * (namn, ort, kontaktperson, telefon, e-post – orten används bara som plats för praktikdagarna), handledare hos
 * arbetsgivaren, startdag, slutdag (valfri – annars till planerat slut), praktikdagar i veckan samt tid och längd.
 * Skapar placeringen, händelsen praktik_startad (verifiering tom tills praktikavtalet laddas upp) och praktikdagarna som
 * tillfällen – de ersätter yrkesmoment utan närvaro samma dagar. Logg placement.created och event.added.
 */
export const placementCreate = command("praktik.placementCreate", z.object({
  caseId: IdSchema,
  /** Befintlig arbetsgivare – eller newEmployer. */
  employerId: IdSchema.nullable().optional(),
  newEmployer: z.object({ name: ShortText, city: z.string().max(100).optional(), contactName: z.string().max(200).optional(), phone: z.string().max(40).optional(), email: z.string().max(200).optional() }).optional(),
  supervisorName: z.string().max(200).optional(),
  startsOn: LocalDateSchema,
  endsOn: LocalDateSchema.nullable().optional(),
  /** Veckodagar 0–4 (måndag–fredag). */
  weekdays: z.array(z.number().int().min(0).max(4)).min(1).max(5),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMin: z.number().int().min(60).max(600),
  tasks: z.string().max(2000).optional(),
}), { invalidates: ["praktik.", CASES, COACH, PORTAL, INBOX, REPORTS, MGMT, BILLING, ...START, ...CASE_STATS, NAV, AKTIVITETER, ...LOG] }).returns<
  Result<{ placementId: string; employerId: string; days: number }, "not_found" | "forbidden" | "wrong_status" | "employer" | "period" | "weekdays" | "email">
>();

/**
 * Avsluta praktiken: slutdag och status avslutad; praktikdagar efter slutdagen utan registrerad närvaro tas bort.
 * Utfallet (arbete, erbjudande …) registreras som en händelse i ärendet. Logg placement.ended.
 */
export const placementEnd = command("praktik.placementEnd", z.object({ placementId: IdSchema, endsOn: LocalDateSchema }), {
  invalidates: ["praktik.", CASES, COACH, PORTAL, INBOX, REPORTS, MGMT, BILLING, ...START, ...CASE_STATS, NAV, AKTIVITETER, ...LOG],
}).returns<Result<{ removed: number }, "not_found" | "forbidden" | "date" | "wrong_status">>();
