// Kontrakt för området aktiviteter: gruppaktiviteter och aktivitetsvyn (coachmötet 2026-10-09). Importeras av skärmar –
// aldrig hanterarna.
//
// En gruppaktivitet är ett tillfälle för flera deltagare ("CV-verkstad tisdag 13.00"). Varje inbjuden deltagare har en egen
// rad i activities (groupActivityId) – veckorapporten, närvarograden och fakturan räknar raderna som förut. Alla på
// Miljonbemanning i avtalet ser alla gruppaktiviteter ("alla ser alla", beslut 2026-10-09) och de som arbetar i ärendena
// (samordnare, avtalsansvarig, coach, handledare) skapar, ändrar, bjuder in, ställer in, tar närvaro och skriver anteckningar.
// Kommunen och ekonomen ser inga gruppaktiviteter. Namnet är internt: det syns aldrig i rapporter, resultatfil eller export.
//
// Spår G: deltagarna bjuds in per grupp, nivå eller enskilt (samma kommandon – skärmen räknar ut vilka med selectByGroupings)
// och får ett meddelande med tid, plats och Miljonbemannings telefonnummer när de bjuds in, när tid eller plats ändras och när
// aktiviteten ställs in (notify – kryssrutan i dialogen, bara för en aktivitet som inte har börjat). Gruppmålet (goal) är ett
// internt arbetsverktyg: alla klarar det automatiskt, coachen markerar den som inte klarade det (aktiviteter.malResultat).
import { z } from "zod";
import { command, query, type Fail, type Result } from "@/api/contract";
import { AKTIVITETER, CARD, CASE_FACTS, INBOX, LOG } from "@/api/invalidation";
import { GROUP_ACTIVITY_KINDS, GROUP_GOAL_MAX, type CaseStatus, type GroupActivityKind, type LocalDate, type LocalDateTime } from "@/data/schema";
import { INVITE_MODES, type InviteGrouping, type UninvitableMember } from "@/core/group-activities";
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
  /**
   * Gruppmålet för deltagaren (null när aktiviteten saknar mål): achieved = Klarade eller Klarade inte, auto = ingen har valt –
   * alla klarar målet automatiskt (Karims beslut 2) och vyn märker det.
   */
  goal: { achieved: boolean; auto: boolean } | null;
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
        /** Gruppmålet (internt), eller null. */
        goal: string | null;
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
  /**
   * Avtalets aktiva nivåer och grupper med sina deltagare – inbjudan per nivå eller grupp (spår G). Bara deltagare den inloggade
   * får se (policyn för grouping_members). Tomt när avtalet saknar nivåer och grupper.
   */
  groupings: InviteGrouping[];
  /** Deltagare i nivåerna och grupperna vars insats inte pågår (avslutad, avböjd, inte startad) – hoppas över med orsaken. */
  others: UninvitableMember[];
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
  /** Gruppmålet (internt, valfritt). Tom text = inget mål. Utelämnat vid ändring = oförändrat. */
  goal: z.string().trim().max(GROUP_GOAL_MAX, `Gruppmålet får vara högst ${GROUP_GOAL_MAX} tecken.`).nullable().optional(),
};
/**
 * Meddelandet till deltagarna (spår G): kryssrutan i dialogen ("Skicka inbjudan till deltagarna", förvald). Bara för en aktivitet
 * som inte har börjat – annars skickas inget. Utelämnat = inget meddelande.
 */
const Notify = { notify: z.boolean().optional() };
/**
 * Hur deltagarna valdes (spår G) – till revisionsloggen. via = grupp, nivå eller enskilda; groupingIds = de valda nivåerna eller
 * grupperna. skipUninvitable: deltagare som inte kan vara med (insatsens läge, en annan aktivitet vid samma tid …) hoppas över
 * och räknas upp i svaret (skipped) i stället för att stoppa hela inbjudan – så bjuds en hel grupp eller nivå in.
 */
const Selection = {
  via: z.enum(INVITE_MODES).optional(),
  groupingIds: z.array(IdSchema).max(50).optional(),
  skipUninvitable: z.boolean().optional(),
};
/** Hur meddelandet till deltagarna gick (null: inget skickades – rutan var inte ikryssad, eller aktiviteten har börjat). */
export type NotifyOutcome = {
  /** Deltagare som meddelandet skickas till (e-post eller SMS). */
  sent: number;
  /** Deltagare som samordnaren fått en uppgift att ringa (ingen kanal nådde fram). */
  tasks: number;
  /** En mening i klarspråk till den som bjöd in, ändrade eller ställde in. */
  summary: string;
} | null;
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
export const groupActivityCreate = command("aktiviteter.skapa", z.object({ ...Fields, ...Notify, ...Selection, caseIds: z.array(IdSchema).max(200) }), { invalidates: ACTIVITY_WRITES }).returns<
  | Result<
    { groupActivityId: string; invited: number; replaced: number; skipped: InviteProblem[]; notified: NotifyOutcome },
    "holiday" | "not_invitable" | "overlap" | "not_found" | "contract" | "responsible" | "goal"
  >
  | Problems<"not_invitable" | "overlap">
>();

/**
 * Ändra namn, typ, tid, längd, plats eller ansvarig – tid, längd, plats och typ ändras på alla deltagares tillfällen. Tiden kan
 * inte flyttas när närvaro är registrerad (has_attendance). En ny dag prövas mot helgdagar och deltagarnas insatser, och en ny
 * tid eller längd mot deltagarnas andra tillfällen (not_invitable, overlap – som när aktiviteten skapas). restricted: någon
 * deltagare kan inte ändras av aktören (vilande spärren för skyddade personuppgifter) – ingenting ändras.
 */
export const groupActivityUpdate = command("aktiviteter.andra", z.object({ id: IdSchema, ...Fields, ...Notify }), { invalidates: ACTIVITY_WRITES }).returns<
  | Result<
    { changed: number; replaced: number; notified: NotifyOutcome },
    "not_found" | "cancelled" | "has_attendance" | "holiday" | "not_invitable" | "overlap" | "responsible" | "restricted" | "goal"
  >
  | Problems<"not_invitable" | "overlap">
>();

/**
 * Bjud in fler deltagare (redan inbjudna hoppas över). Samma regler som när aktiviteten skapas. Per grupp eller nivå
 * (skipUninvitable) hoppas de över som inte kan vara med (skipped) – enskilt valda stoppar inbjudan som förut.
 */
export const groupActivityInvite = command("aktiviteter.bjudIn", z.object({
  id: IdSchema, caseIds: z.array(IdSchema).min(1).max(200), replaceOverlapping: z.boolean().optional(), ...Notify, ...Selection,
}), {
  invalidates: ACTIVITY_WRITES,
}).returns<
  | Result<{ invited: number; already: number; replaced: number; skipped: InviteProblem[]; notified: NotifyOutcome }, "not_found" | "cancelled" | "not_invitable" | "overlap" | "contract">
  | Problems<"not_invitable" | "overlap">
>();

/** Ta bort en deltagare – bara om närvaro inte är registrerad. notify: deltagaren får beskedet att aktiviteten är inställd för hen. */
export const groupActivityRemove = command("aktiviteter.taBort", z.object({ id: IdSchema, caseId: IdSchema, ...Notify }), { invalidates: ACTIVITY_WRITES }).returns<
  Result<{ notified: NotifyOutcome }, "not_found" | "cancelled" | "has_attendance">
>();

/**
 * Ställ in aktiviteten: deltagarnas tillfällen tas bort. Går inte när närvaro är registrerad (aktiviteten är genomförd).
 * Aktiviteten märks som inställd först (en gång – två samtidiga försök ger cancelled för det andra), sedan tas tillfällena bort.
 * kept: tillfällen som hann få närvaro registrerad under tiden – de ligger kvar. restricted: någon deltagare kan inte ändras av
 * aktören (vilande spärren för skyddade personuppgifter) – ingenting ändras.
 */
export const groupActivityCancel = command("aktiviteter.stallIn", z.object({ id: IdSchema, ...Notify }), { invalidates: ACTIVITY_WRITES }).returns<
  Result<{ removed: number; kept: number; notified: NotifyOutcome }, "not_found" | "cancelled" | "has_attendance" | "restricted">
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

/**
 * Gruppmålet för en deltagare (Karims beslut 2): alla klarar målet automatiskt – coachen markerar Klarade inte (achieved: false)
 * och kan ändra tillbaka (achieved: true). Bara när aktiviteten har ett mål och har startat, för en inbjuden deltagare. Internt:
 * påverkar aldrig veckomål, progression, samlad status, rapporter, resultatfil, export eller faktura.
 */
export const groupGoalResultSet = command("aktiviteter.malResultat", z.object({ id: IdSchema, caseId: IdSchema, achieved: z.boolean() }), {
  invalidates: [AKTIVITETER, CARD, ...LOG],
}).returns<Result<{ changed: boolean }, "not_found" | "cancelled" | "no_goal" | "not_started" | "not_invited">>();
