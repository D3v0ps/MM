// Kontrakt för området aktiviteter: gruppaktiviteter och aktivitetsvyn (coachmötet 2026-10-09). Importeras av skärmar –
// aldrig hanterarna.
//
// En gruppaktivitet är ett tillfälle för flera deltagare ("CV-verkstad tisdag 13.00"). Varje inbjuden deltagare har en egen
// rad i activities (groupActivityId) – veckorapporten, närvarograden och fakturan räknar raderna som förut. Alla på
// Miljonbemanning i avtalet ser alla gruppaktiviteter ("alla ser alla", beslut 2026-10-09) och de som arbetar i ärendena
// (samordnare, avtalsansvarig, coach, handledare) skapar, ändrar, bjuder in, ställer in, tar närvaro och skriver anteckningar.
// Kommunen och ekonomen ser inga gruppaktiviteter. Namnet är internt: det syns aldrig i rapporter, resultatfil eller export.
//
// Spår G: deltagarna får ett meddelande med tid, plats och Miljonbemannings telefonnummer när de bjuds in, när tid eller plats
// ändras och när aktiviteten ställs in (notify – kryssrutan i dialogen, bara för en aktivitet som inte har börjat). Gruppmålet
// (goal) är ett internt arbetsverktyg: alla klarar det automatiskt, coachen markerar den som inte klarade det (aktiviteter.malResultat).
//
// Karims beslut 2026-10-22: grupperna är yrkesområdena och nivåaktiviteterna återkommer varje vecka. En aktivitet kan ha en
// målgrupp – en nivå eller ett yrkesområde (Bjud in deltagare: flikarna Yrkesområde, Nivå och Enskilda). Då bjuder servern in de
// aktiva deltagarna i målgruppen och håller listan aktuell fram till aktiviteten (audience-sync.ts). En återkommande aktivitet
// (aktiviteter.serieSkapa) har alltid en målgrupp; tillfällena skapas av servern 14 dagar framåt.
import { z } from "zod";
import { command, query, type Fail, type Result } from "@/api/contract";
import { AKTIVITETER, CARD, CASE_FACTS, INBOX, LOG } from "@/api/invalidation";
import { GROUP_ACTIVITY_KINDS, GROUP_GOAL_MAX, type CaseStatus, type GroupActivityKind, type InviteSource, type LocalDate, type LocalDateTime } from "@/data/schema";
import { INVITE_MODES, type InviteGrouping, type UninvitableMember } from "@/core/group-activities";
import { START_TIME_RE } from "@/core/group-series";
import { IdSchema, LocalDateSchema, LocalDateTimeSchema } from "../_shared/schemas";
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
  /** Tillfället hör till en återkommande aktivitet. */
  seriesId: string | null;
  /** Målgruppen i klarspråk ("Nivå 2 – …", "Yrkesområde G – Lager och logistik"), eller null (inbjudna för hand). */
  audienceLabel: string | null;
};
/** En återkommande aktivitet i listan (Karims beslut 2026-10-22). */
export type SeriesListRow = {
  id: string;
  name: string;
  kind: GroupActivityKind;
  /** "tis och tor 10.00" */
  schedule: string;
  durationMin: number;
  location: string;
  audienceLabel: string;
  responsibleId: string | null;
  responsibleName: string | null;
  goal: string | null;
  startsOn: LocalDate;
  endsOn: LocalDate | null;
  /** Deltagarna får meddelande inför varje tillfälle. */
  notify: boolean;
  /** Nästa tillfälle som inte är inställt, eller null. */
  next: { id: string; startsAt: LocalDateTime } | null;
  /** Kommande tillfällen (inte inställda). */
  upcoming: number;
};
export type GroupActivityList = {
  now: LocalDateTime;
  /** Får skapa nya (de som arbetar i ärendena) – chef och systemadministratör läser. */
  canCreate: boolean;
  /** Pågående återkommande aktiviteter (inte avslutade). */
  series: SeriesListRow[];
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
  /** Bjuden för hand eller av målgruppen (nivån eller yrkesområdet). */
  inviteSource: InviteSource;
  /** Hör till aktivitetens målgrupp i dag – tas inte bort för hand (synkningen skulle bjuda in hen igen), oavsett hur hen bjöds in. */
  audienceMember: boolean;
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
        /** Målgruppen (nivå eller yrkesområde) i klarspråk, eller null (inbjudna för hand). */
        audience: { kind: "level" | "area"; label: string } | null;
        /** Den återkommande aktiviteten tillfället hör till, eller null. */
        series: { id: string; name: string; schedule: string; endsOn: LocalDate | null; ended: boolean; notify: boolean; location: string; responsibleId: string | null; goal: string | null } | null;
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
   * Avtalets nivåer och yrkesområden med sina deltagare – målgruppen (Bjud in deltagare: Yrkesområde och Nivå). Nivåerna med
   * deltagare den inloggade får se (policyn för grouping_members); yrkesområdena är avtalets aktiva avtalsområden med de pågående
   * och pausade ärendena (candidates) som har yrkesområdet.
   */
  groupings: InviteGrouping[];
  /** Deltagare i nivåerna vars insats inte pågår (avslutad, avböjd, inte startad) – hoppas över med orsaken. */
  others: UninvitableMember[];
};
export const groupActivityForm = query("aktiviteter.form", z.object({})).returns<GroupActivityForm>();

// ================================================================ Kommandon
// Omräkning: tillfällena (activities) styr närvaron, veckorapporten, fakturaunderlaget, Min vecka och kortet – samma breda
// mängd som närvaron (CASE_FACTS, där aktiviteterna ingår) plus inkorgen och praktiksidan, som Lägg till tillfälle.
const ACTIVITY_WRITES = [...CASE_FACTS, INBOX, "praktik.", "grupper."] as const;
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
 * Målgruppen (Karims beslut 2026-10-22): en nivå (levelId) eller ett yrkesområde (areaCode, avtalsområdets kod). Servern bjuder in
 * de aktiva deltagarna i målgruppen och håller listan aktuell fram till aktiviteten. Blandas inte med enskilt valda (caseIds).
 */
export const AudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("level"), levelId: IdSchema }),
  z.object({ kind: z.literal("area"), areaCode: z.string().trim().min(1).max(10) }),
]);
export type AudienceInput = z.infer<typeof AudienceSchema>;
/** Hur deltagarna valdes – till revisionsloggen: yrkesområde, nivå eller enskilda. */
const Selection = { via: z.enum(INVITE_MODES).optional() };
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
 * Skapa en gruppaktivitet och bjud in deltagarna (en rad i activities per deltagare).
 *   Enskilda (caseIds): avslutade, avböjda och pausade ärenden nekas (not_invitable, problems), liksom deltagare som aktören inte
 *   arbetar i (vilande spärren för skyddade personuppgifter) och deltagare som redan har ett tillfälle med närvaro eller en annan
 *   gruppaktivitet vid samma tid. Ett eget tillfälle utan närvaro vid samma tid: overlap (problems) tills replaceOverlapping.
 *   Målgrupp (audience, Karims beslut 2026-10-22): servern bjuder in de aktiva deltagarna i nivån eller yrkesområdet (källan
 *   audience) och håller listan aktuell fram till aktiviteten; den som har ett annat tillfälle vid samma tid hoppas över (skipped).
 *   notify gäller också dem som tillkommer senare. Målgrupp och enskilda blandas inte (audience).
 * Helgdag: holiday tills acceptHoliday. Alla deltagare i samma avtal.
 */
export const groupActivityCreate = command("aktiviteter.skapa", z.object({
  ...Fields, ...Notify, ...Selection, caseIds: z.array(IdSchema).max(200), audience: AudienceSchema.optional(),
}), { invalidates: ACTIVITY_WRITES }).returns<
  | Result<
    { groupActivityId: string; invited: number; replaced: number; skipped: InviteProblem[]; notified: NotifyOutcome },
    "holiday" | "not_invitable" | "overlap" | "not_found" | "contract" | "responsible" | "goal" | "audience"
  >
  | Problems<"not_invitable" | "overlap">
>();

/**
 * Ändra namn, typ, tid, längd, plats eller ansvarig – tid, längd, plats och typ ändras på alla deltagares tillfällen. Tiden kan
 * inte flyttas när närvaro är registrerad (has_attendance). En ny dag prövas mot helgdagar och deltagarnas insatser, och en ny
 * tid eller längd mot deltagarnas andra tillfällen (not_invitable, overlap – som när aktiviteten skapas). restricted: någon
 * deltagare kan inte ändras av aktören (vilande spärren för skyddade personuppgifter) – ingenting ändras. series: ett tillfälle i en
 * återkommande aktivitet får inte ny dag, tid eller längd (avsluta serien och skapa en ny). Med målgrupp prövas inbjudningarna igen
 * efter en ny dag.
 */
export const groupActivityUpdate = command("aktiviteter.andra", z.object({ id: IdSchema, ...Fields, ...Notify }), { invalidates: ACTIVITY_WRITES }).returns<
  | Result<
    /** dropped: inbjudna av målgruppen som inte kan vara med vid den nya tiden och togs bort. */
    { changed: number; replaced: number; dropped: number; notified: NotifyOutcome },
    "not_found" | "cancelled" | "has_attendance" | "holiday" | "not_invitable" | "overlap" | "responsible" | "restricted" | "goal" | "series"
  >
  | Problems<"not_invitable" | "overlap">
>();

/**
 * Bjud in fler deltagare. Enskilda (caseIds): redan inbjudna hoppas över, samma regler som när aktiviteten skapas. Målgrupp
 * (audience): en aktivitet som saknar målgrupp och inte har börjat får nivån eller yrkesområdet som målgrupp – servern bjuder in de
 * aktiva deltagarna i den och håller listan aktuell (audience: aktiviteten har redan en målgrupp, eller har börjat).
 */
export const groupActivityInvite = command("aktiviteter.bjudIn", z.object({
  id: IdSchema, caseIds: z.array(IdSchema).max(200), audience: AudienceSchema.optional(), replaceOverlapping: z.boolean().optional(), ...Notify, ...Selection,
}), {
  invalidates: ACTIVITY_WRITES,
}).returns<
  | Result<{ invited: number; already: number; replaced: number; skipped: InviteProblem[]; notified: NotifyOutcome }, "not_found" | "cancelled" | "not_invitable" | "overlap" | "contract" | "audience">
  | Problems<"not_invitable" | "overlap">
>();

/**
 * Ta bort en deltagare – bara om närvaro inte är registrerad. notify: deltagaren får beskedet att aktiviteten är inställd för hen.
 * audience: deltagaren bjöds in av målgruppen (nivån eller yrkesområdet) och skulle bjudas in igen – byt nivå eller registrera frånvaro.
 */
export const groupActivityRemove = command("aktiviteter.taBort", z.object({ id: IdSchema, caseId: IdSchema, ...Notify }), { invalidates: ACTIVITY_WRITES }).returns<
  Result<{ notified: NotifyOutcome }, "not_found" | "cancelled" | "has_attendance" | "audience">
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

// ================================================================ Återkommande aktiviteter (Karims beslut 2026-10-22)
/**
 * Ny återkommande aktivitet: samma tid varje vecka på de valda veckodagarna (ISO 1–5, minst en – formuläret rekommenderar 1–3),
 * för en nivå eller ett yrkesområde (krävs), från startsOn till endsOn (valfritt). Servern skapar tillfällena från i dag och 14
 * dagar framåt (inga helgdagar) och bjuder in målgruppen. notify (standard av): deltagarna får ett meddelande inför varje
 * tillfälle. invalid: dagar, tid eller datum stämmer inte.
 */
export const groupActivitySeriesCreate = command("aktiviteter.serieSkapa", z.object({
  name: Fields.name,
  kind: Fields.kind,
  weekdays: z.array(z.number().int().min(1).max(5)).min(1).max(5),
  startTime: z.string().regex(START_TIME_RE),
  durationMin: Fields.durationMin,
  location: Fields.location,
  responsibleId: Fields.responsibleId,
  goal: Fields.goal,
  startsOn: LocalDateSchema,
  endsOn: LocalDateSchema.nullable().optional(),
  audience: AudienceSchema,
  notify: z.boolean().optional(),
}), { invalidates: ACTIVITY_WRITES }).returns<
  Result<{ seriesId: string; occurrences: number; invited: number; firstId: string | null }, "invalid" | "contract" | "responsible" | "goal" | "audience">
>();

/**
 * Ändra en återkommande aktivitet: namn, plats, ansvarig, gruppmål och meddelandet. Ändringen gäller också alla kommande tillfällen
 * som inte har börjat (inställda rörs inte). Dagar, tid och längd ändras inte – avsluta serien och skapa en ny. Ny plats och
 * meddelandet påslaget: deltagarna i de kommande tillfällena får aktivitet_andrad.
 */
export const groupActivitySeriesUpdate = command("aktiviteter.serieAndra", z.object({
  id: IdSchema, name: Fields.name, location: Fields.location, responsibleId: Fields.responsibleId, goal: Fields.goal, notify: z.boolean(),
}), { invalidates: ACTIVITY_WRITES }).returns<
  Result<{ changed: number; occurrences: number; notified: NotifyOutcome }, "not_found" | "ended" | "responsible" | "goal" | "restricted">
>();

/**
 * Avsluta en återkommande aktivitet: sista dagen blir i dag, inga nya tillfällen skapas, och kommande tillfällen utan registrerad
 * närvaro ställs in (deltagarna får aktivitet_installd om seriens meddelande är påslaget). kept: tillfällen som hann få närvaro.
 */
export const groupActivitySeriesEnd = command("aktiviteter.serieAvsluta", z.object({ id: IdSchema }), { invalidates: ACTIVITY_WRITES }).returns<
  Result<{ cancelled: number; kept: number; notified: NotifyOutcome }, "not_found" | "ended" | "restricted">
>();
