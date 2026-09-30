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
})).returns<Result<{ employerId: string }, "name" | "orgNr" | "email" | "duplicate" | "areas">>();

export const RIGHT_KEYS = ["uppgift", "handledning", "timing", "uppfoljning"] as const;
export const praktikSetRight = command("praktik.setRight", z.object({ placementId: IdSchema, right: z.enum(RIGHT_KEYS), value: z.boolean() })).returns<Result<object, "not_found">>();
export const praktikAddFollowUp = command("praktik.addFollowUp", z.object({ placementId: IdSchema, date: LocalDateSchema })).returns<Result<object, "not_found" | "date">>();
