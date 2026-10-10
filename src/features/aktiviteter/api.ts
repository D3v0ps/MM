// Kontrakt för området aktiviteter: gruppaktiviteter och aktivitetsvyn (coachmötet 2026-10-09). Importeras av skärmar –
// aldrig hanterarna.
//
// En gruppaktivitet är ett tillfälle för flera deltagare ("CV-verkstad tisdag 13.00"). Varje inbjuden deltagare har en egen
// rad i activities (groupActivityId) – veckorapporten, närvarograden och fakturan räknar raderna som förut. Alla på
// Miljonbemanning i avtalet ser alla gruppaktiviteter ("alla ser alla", beslut 2026-10-09) och de som arbetar i ärendena
// (samordnare, avtalsansvarig, coach, handledare) skapar, ändrar, bjuder in, ställer in, tar närvaro och skriver anteckningar.
// Kommunen och ekonomen ser inga gruppaktiviteter. Namnet är internt: det syns aldrig i rapporter, resultatfil eller export.
import { z } from "zod";
import { command, query, type Fail, type Result } from "@/api/contract";
import { AKTIVITETER, CARD, CASE_FACTS, INBOX, LOG } from "@/api/invalidation";
import { GROUP_ACTIVITY_KINDS, type CaseStatus, type GroupActivityKind, type LocalDate, type LocalDateTime } from "@/data/schema";
import { IdSchema, LocalDateTimeSchema } from "../_shared/schemas";
import type { AttMark } from "../coach/api";

// ================================================================ Frågor
/** En gruppaktivitet i listan. */
export type GroupActivityListRow = {
  id: string;
  name: string;
  kind: GroupActivityKind;
  startsAt: LocalDateTime;
  durationMin: number;
  location: string;
  responsibleName: string | null;
  /** Antal inbjudna och antal med registrerad närvaro (passerade). */
  invited: number;
  registered: number;
  cancelled: boolean;
};
export type GroupActivityList = {
  now: LocalDateTime;
  /** Får skapa nya (de som arbetar i ärendena) – chef och systemadministratör läser. */
  canCreate: boolean;
  /** I dag och framåt, tidigast först. */
  upcoming: GroupActivityListRow[];
  /** Före i dag, senast först (högst 100). */
  earlier: GroupActivityListRow[];
};
export const groupActivityList = query("aktiviteter.lista", z.object({})).returns<GroupActivityList>();

/** Dagens gruppaktivitet på Min vecka (coach och samordnare): länk till aktivitetsvyn, antal inbjudna och registrerade. */
export type TodayGroupActivity = {
  id: string;
  name: string;
  kind: GroupActivityKind;
  startsAt: LocalDateTime;
  durationMin: number;
  location: string;
  invited: number;
  registered: number;
  responsibleName: string | null;
};

/** En deltagare i aktivitetsvyn: närvaron som på Närvaro-skärmen och dagens anteckningar. */
export type GroupParticipant = {
  activityId: string;
  caseId: string;
  caseNumber: string;
  name: string;
  attendance: AttMark;
  /** Anteckningar från aktivitetens dag (case_notes, occurredOn = dagen) som den inloggade får läsa. */
  notes: { id: string; body: string; authorName: string }[];
};
export type GroupActivityView =
  | { kind: "gate"; title: string; text: string }
  | {
      kind: "ok";
      now: LocalDateTime;
      activity: {
        id: string;
        contractId: string;
        name: string;
        kind: GroupActivityKind;
        startsAt: LocalDateTime;
        durationMin: number;
        location: string;
        responsibleId: string | null;
        responsibleName: string | null;
        createdByName: string;
        cancelledAt: LocalDateTime | null;
        /** Dagen är en helgdag (tabellen holidays): namnet. */
        holiday: string | null;
      };
      participants: GroupParticipant[];
      /** Får ändra, bjuda in, ta närvaro och skriva anteckningar (de som arbetar i ärendena, inte inställd). */
      canEdit: boolean;
      /** Giltig frånvaro: orsakerna (samma som Närvaro). */
      absenceReasons: string[];
    };
export const groupActivityView = query("aktiviteter.visa", z.object({ id: IdSchema })).returns<GroupActivityView>();

/** En deltagare som kan bjudas in (inbjudningskomponenten räknar ut om hen kan väljas den valda dagen – inviteBlock). */
export type InviteCandidate = {
  caseId: string;
  caseNumber: string;
  name: string;
  status: CaseStatus;
  startDate: LocalDate | null;
  endDate: LocalDate | null;
  pausedWeeks: string[];
  leadCoachName: string | null;
};
/** Formuläret för en ny eller ändrad gruppaktivitet: typer, coacher, deltagare att bjuda in och helgdagar. */
export type GroupActivityForm = {
  now: LocalDateTime;
  contractId: string;
  kinds: { value: GroupActivityKind; label: string }[];
  coaches: { id: string; name: string }[];
  /** Pågående och pausade ärenden i avtalet (pausade visas men kan inte väljas). */
  candidates: InviteCandidate[];
  /** Helgdagar från i dag och ett år framåt – varningen i formuläret. */
  holidays: { date: LocalDate; name: string }[];
  defaultLocation: string;
  /** Den inloggade, om hen är coach i avtalet (förval för ansvarig). */
  me: string | null;
};
export const groupActivityForm = query("aktiviteter.form", z.object({})).returns<GroupActivityForm>();

// ================================================================ Kommandon
// Omräkning: tillfällena (activities) styr närvaron, veckorapporten, fakturaunderlaget, Min vecka och kortet – samma breda
// mängd som närvaron (CASE_FACTS, där aktiviteterna ingår) plus inkorgen och praktiksidan, som Lägg till tillfälle.
const ACTIVITY_WRITES = [...CASE_FACTS, INBOX, "praktik."] as const;
const Fields = {
  name: z.string().trim().min(1, "Skriv ett namn.").max(120),
  kind: z.enum(GROUP_ACTIVITY_KINDS),
  startsAt: LocalDateTimeSchema,
  durationMin: z.number().int().min(5).max(720),
  location: z.string().trim().min(1, "Skriv plats.").max(200),
  responsibleId: IdSchema.nullable().optional(),
  /** Dagen är en helgdag och användaren har bekräftat att aktiviteten ska ligga där ändå. */
  acceptHoliday: z.boolean().optional(),
  /**
   * Deltagare har redan ett eget tillfälle (utan närvaro) som överlappar aktivitetens tid, och användaren har bekräftat att det
   * ska ersättas av aktiviteten – annars räknas deltagaren två gånger i veckorapporten, närvarograden och den automatiska närvaron.
   */
  replaceOverlapping: z.boolean().optional(),
};
/** Ärendet som stoppade (inbjudan eller ny tid) och varför – visas i dialogen. */
export type InviteProblem = { caseId: string; caseNumber: string; reason: string };
/** Nekat för vissa deltagare: vilka och varför. */
type Problems<E extends string> = Fail<E> & { problems: InviteProblem[] };

/**
 * Skapa en gruppaktivitet och bjud in deltagarna (en rad i activities per deltagare). Avslutade, avböjda och pausade ärenden
 * nekas (not_invitable, problems), liksom deltagare som aktören inte arbetar i (vilande spärren för skyddade personuppgifter) och
 * deltagare som redan har ett tillfälle med närvaro eller en annan gruppaktivitet vid samma tid. Ett eget tillfälle utan närvaro
 * vid samma tid: overlap (problems) tills replaceOverlapping – då ersätts det. Helgdag: holiday tills acceptHoliday. Alla
 * deltagare i samma avtal.
 */
export const groupActivityCreate = command("aktiviteter.skapa", z.object({ ...Fields, caseIds: z.array(IdSchema).max(200) }), { invalidates: ACTIVITY_WRITES }).returns<
  Result<{ groupActivityId: string; invited: number; replaced: number }, "holiday" | "not_invitable" | "overlap" | "not_found" | "contract" | "responsible"> | Problems<"not_invitable" | "overlap">
>();

/**
 * Ändra namn, typ, tid, längd, plats eller ansvarig – tid, längd, plats och typ ändras på alla deltagares tillfällen. Tiden kan
 * inte flyttas när närvaro är registrerad (has_attendance). En ny dag prövas mot helgdagar och deltagarnas insatser, och en ny
 * tid eller längd mot deltagarnas andra tillfällen (not_invitable, overlap – som när aktiviteten skapas). restricted: någon
 * deltagare kan inte ändras av aktören (vilande spärren för skyddade personuppgifter) – ingenting ändras.
 */
export const groupActivityUpdate = command("aktiviteter.andra", z.object({ id: IdSchema, ...Fields }), { invalidates: ACTIVITY_WRITES }).returns<
  | Result<{ changed: number; replaced: number }, "not_found" | "cancelled" | "has_attendance" | "holiday" | "not_invitable" | "overlap" | "responsible" | "restricted">
  | Problems<"not_invitable" | "overlap">
>();

/** Bjud in fler deltagare (redan inbjudna hoppas över). Samma regler som när aktiviteten skapas. */
export const groupActivityInvite = command("aktiviteter.bjudIn", z.object({ id: IdSchema, caseIds: z.array(IdSchema).min(1).max(200), replaceOverlapping: z.boolean().optional() }), {
  invalidates: ACTIVITY_WRITES,
}).returns<
  Result<{ invited: number; already: number; replaced: number }, "not_found" | "cancelled" | "not_invitable" | "overlap" | "contract"> | Problems<"not_invitable" | "overlap">
>();

/** Ta bort en deltagare – bara om närvaro inte är registrerad. */
export const groupActivityRemove = command("aktiviteter.taBort", z.object({ id: IdSchema, caseId: IdSchema }), { invalidates: ACTIVITY_WRITES }).returns<
  Result<object, "not_found" | "cancelled" | "has_attendance">
>();

/**
 * Ställ in aktiviteten: deltagarnas tillfällen tas bort. Går inte när närvaro är registrerad (aktiviteten är genomförd).
 * Aktiviteten märks som inställd först (en gång – två samtidiga försök ger cancelled för det andra), sedan tas tillfällena bort.
 * kept: tillfällen som hann få närvaro registrerad under tiden – de ligger kvar. restricted: någon deltagare kan inte ändras av
 * aktören (vilande spärren för skyddade personuppgifter) – ingenting ändras.
 */
export const groupActivityCancel = command("aktiviteter.stallIn", z.object({ id: IdSchema }), { invalidates: ACTIVITY_WRITES }).returns<
  Result<{ removed: number; kept: number }, "not_found" | "cancelled" | "has_attendance" | "restricted">
>();

/** Högst så många tecken i en anteckningsrad (samma gräns som en anteckning i deltagarkortet). */
export const ACTIVITY_NOTE_MAX = 2000;
/**
 * Anteckningar i aktivitetsvyn: en rad per deltagare, sparas som vanliga anteckningar (case_notes) med aktivitetens dag som
 * datum och ingen tid. Samma kontroll som anteckningar i deltagarkortet – personnummer stoppas (pnr, problems), inget framtida
 * datum. Alla eller ingen: stoppar en rad sparas inget.
 */
export const groupActivityNotes = command("aktiviteter.anteckningar", z.object({
  id: IdSchema,
  notes: z.array(z.object({ caseId: IdSchema, body: z.string().trim().min(1).max(ACTIVITY_NOTE_MAX) })).min(1).max(200),
}), { invalidates: [AKTIVITETER, CARD, "coach.assessmentPage", ...LOG] }).returns<
  Result<{ saved: number; noteIds: string[] }, "not_found" | "cancelled" | "date" | "not_invited"> | Problems<"pnr">
>();
