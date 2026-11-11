// Deltagaren kom inte till första mötet (Karims beslut 2026-11-09, migration 0040). Ren domänlogik utan I/O: vem som
// registrerar, när det går och vad som stoppar en registrering.
//
// Besluten:
//   * Det gäller bara första mötet: ett bekräftat ärende där insatsen inte har startat (status confirmed, inget startdatum) och
//     vars bokade första möte har varit (Stockholms tid – firstMeetingAt <= klockan).
//   * Det är internt: kommunen får inget besked och ser det aldrig. Inget mejl, inget meddelande i portalen, ingen notis.
//   * Det faktureras aldrig och är ingen närvaro: inga tillfällen och ingen närvaro skapas, och inget som räknar närvaro,
//     rapporter, resultat, fakturor, bonus eller spärren för Ändra startdatum läser registreringen.
//   * Uteblev utan att meddela eller giltig frånvaro – orsaken krävs vid giltig frånvaro (kort och saklig, inga personnummer).
//   * Ett möte registreras en gång. Efter registreringen bokar man ett nytt första möte (arenden.caseBookFirstMeeting) eller
//     avslutar insatsen (deltagaren kom aldrig). Insatsen startas inte på ett möte som deltagaren inte kom till: startdatumet
//     sätts inte så länge ärendets nuvarande första möte är registrerat (samma regel som triggern cases_start_date_no_show_guard
//     i 0040). Efter ett nytt första möte gäller den vanliga regeln – tidigast det nya mötets dag, också samma dag.
//   * Nyckeltalet Första möte inom en vecka räknas på det första bokade mötet (firstBookedMeetingAt – Karims beslut 2026-11-09).
// Samma regler i databasen (triggrarna first_meeting_no_shows_check och cases_start_date_no_show_guard, 0040) och i policy.ts
// (first_meeting_no_shows, cases).
import type { Role } from "@/api/roles";
import type { Case, FirstMeetingNoShow, FirstMeetingNoShowKind } from "@/data/schema";
import { addDays, addWorkingDays, dayOf, fmtDate, fmtDateTime, holidayName, isWorkingDay, type LocalDateTime } from "./time";
import { looksLikePnr } from "./validation";

/** Registrerar att deltagaren inte kom: de som kan starta insatsen (samma som Starta insatsen och Ändra startdatum). */
export const NO_SHOW_REGISTRARS: readonly Role[] = ["coach", "samordnare", "avtalsansvarig"];
/** Orsakens längd i tecken (samma som kontrollen i tabellen, 0040). */
export const NO_SHOW_REASON_MAX = 300;

/** Slagen som ord (dialogens val, kortet och tidslinjen). */
export const NO_SHOW_KIND_LABEL: Record<FirstMeetingNoShowKind, string> = {
  uteblev: "Uteblev utan att meddela",
  giltig: "Giltig frånvaro",
};
/** Hjälptexten vid fältet Orsak. */
export const NO_SHOW_REASON_HELP = "Kort och sakligt, till exempel 'sjuk' eller 'krock med annan tid'. Inga personnummer, inga diagnoser och inga omdömen om personen.";

type CaseForNoShow = Pick<Case, "id" | "status" | "startDate" | "firstMeetingAt">;

/** Ärendet kan få en registrering: bekräftat och inte startat (inget startdatum). */
export const noShowOpen = (c: Pick<Case, "status" | "startDate">): boolean => c.status === "confirmed" && c.startDate == null;

/** Första mötet har varit: det är bokat och tiden har kommit (Stockholms tid – samma format som klockan). */
export const firstMeetingPassed = (c: Pick<Case, "firstMeetingAt">, now: LocalDateTime): boolean => !!c.firstMeetingAt && c.firstMeetingAt <= now;

/** Registreringen för ärendets nuvarande första möte, eller null (ett ombokat möte har ingen än). */
export function currentNoShow<T extends Pick<FirstMeetingNoShow, "caseId" | "meetingAt">>(c: Pick<Case, "id" | "firstMeetingAt">, rows: readonly T[]): T | null {
  if (!c.firstMeetingAt) return null;
  return rows.find((x) => x.caseId === c.id && x.meetingAt === c.firstMeetingAt) ?? null;
}

/** Knappen "Deltagaren kom inte": ärendet är öppet för det, mötet har varit och det är inte redan registrerat. */
export function canRegisterNoShow(c: CaseForNoShow, now: LocalDateTime, rows: readonly Pick<FirstMeetingNoShow, "caseId" | "meetingAt">[]): boolean {
  return noShowOpen(c) && firstMeetingPassed(c, now) && !currentNoShow(c, rows);
}

type NoShowDate = Pick<FirstMeetingNoShow, "caseId" | "meetingAt">;

/**
 * Starta insatsen och Ändra startdatum nekas så länge ärendets nuvarande första möte är registrerat (currentNoShow – samma regel
 * som triggern cases_start_date_no_show_guard i 0040). Efter ett nytt första möte gäller den vanliga regeln: tidigast mötets dag.
 */
export const noShowStartText = (x: Pick<FirstMeetingNoShow, "meetingAt">): string =>
  `Deltagaren kom inte till första mötet ${fmtDateTime(x.meetingAt)}. Boka ett nytt första möte innan insatsen startar – eller avsluta insatsen om deltagaren aldrig kom.`;

/**
 * Det första bokade mötet (Karims beslut 2026-11-09): det tidigaste mötet som deltagaren inte kom till, annars ärendets första möte.
 * Nyckeltalet Första möte inom en vecka räknas på det – en ombokning efter att deltagaren uteblev gör inte ärendet sent. Bara
 * datumen läses – aldrig slaget eller orsaken.
 */
export function firstBookedMeetingAt(c: Pick<Case, "id" | "firstMeetingAt">, rows: readonly NoShowDate[]): LocalDateTime | null {
  const own = rows.filter((x) => x.caseId === c.id).map((x) => x.meetingAt).sort();
  return own[0] ?? c.firstMeetingAt ?? null;
}

export type BookingProblem = { code: "past" | "before_order" | "same_time" | "not_working_day"; text: string };

/**
 * Vad som stoppar en bokning eller ombokning av första mötet (arenden.caseBookFirstMeeting och arenden.caseAccept – alla roller),
 * eller null: tiden har redan passerat, dagen är före beställningen, samma tid som det bokade mötet (bara när ett möte är bokat –
 * accept skickar firstMeetingAt null), eller inte en arbetsdag (helg eller helgdag – samma regel som dialogerna).
 */
export function firstMeetingBookingProblem(c: Pick<Case, "referredAt" | "firstMeetingAt">, at: LocalDateTime, now: LocalDateTime): BookingProblem | null {
  if (at <= now) return { code: "past", text: "Tiden har redan passerat. Välj en senare tid." };
  if (dayOf(at) < dayOf(c.referredAt)) return { code: "before_order", text: `Första mötet kan inte vara före beställningen ${fmtDate(c.referredAt)}.` };
  if (c.firstMeetingAt && at === c.firstMeetingAt) return { code: "same_time", text: `Första mötet är redan bokat ${fmtDateTime(at)}. Välj en annan tid.` };
  if (!isWorkingDay(at)) return { code: "not_working_day", text: `${holidayName(at) || "Dagen"} är inte en arbetsdag. Välj en vardag.` };
  return null;
}

/** Förvalt klockslag för första mötet i acceptdialogen (samordnarens Acceptera och den intagsansvariges Ta emot). */
export const FIRST_MEETING_DEFAULT_TIME = "10:00";

/**
 * Förvalt datum för första mötet i acceptdialogen (Karims beslut 2026-11-11: "behöver vi själva fylla i datumen fast kommunens
 * handläggare har skrivit in det"). Kommunens önskade start när den dagen går att boka – i dag eller senare, inte före
 * beställningens dag, en arbetsdag och med det förvalda klockslaget kvar (samma regel som servern, firstMeetingBookingProblem).
 * Annars den första dagen från och med den senaste av önskad start, i dag och beställningens dag som går att boka. Utan önskad
 * start: två arbetsdagar fram, som förut.
 */
export function acceptDefaultDate(o: { desiredStart: string | null | undefined; referredAt: LocalDateTime; now: LocalDateTime; time?: string }): string {
  const today = dayOf(o.now);
  const time = o.time ?? FIRST_MEETING_DEFAULT_TIME;
  if (!o.desiredStart) return addWorkingDays(today, 2);
  const order = dayOf(o.referredAt);
  const bookable = (d: string) => d >= order && isWorkingDay(d) && `${d}T${time}` > o.now;
  let d = [o.desiredStart, today, order].sort().at(-1)!;
  // Högst ett par veckor framåt (helger, helgdagar) – loopen är begränsad för säkerhets skull.
  for (let i = 0; i < 31 && !bookable(d); i++) d = addDays(d, 1);
  return d;
}

/** "Kom inte till första mötet 29 jan kl. 14.00" */
export const noShowTitle = (meetingAt: LocalDateTime): string => `Kom inte till första mötet ${fmtDateTime(meetingAt)}`;
/** "Kom inte till första mötet 29 jan kl. 14.00 – uteblev utan att meddela." (kortets ruta) */
export const noShowSentence = (x: Pick<FirstMeetingNoShow, "meetingAt" | "kind">): string => `${noShowTitle(x.meetingAt)} – ${NO_SHOW_KIND_LABEL[x.kind].toLowerCase()}.`;

export type NoShowProblem = { code: "wrong_status" | "no_meeting" | "conflict" | "not_passed" | "already" | "reason" | "pnr"; text: string };

/**
 * Vad som stoppar registreringen, eller null. Kontrolleras av hanteraren (arenden.caseFirstMeetingNoShow).
 *   wrong_status  ärendet är inte bekräftat, eller har ett startdatum (insatsen har startat)
 *   no_meeting    första mötet är inte bokat
 *   conflict      dialogen visade ett annat möte än ärendet har nu (bokat om under tiden)
 *   not_passed    mötets tid har inte kommit
 *   already       mötet är redan registrerat
 *   reason        giltig frånvaro utan orsak, eller orsaken är för lång
 *   pnr           orsaken ser ut att innehålla ett personnummer
 */
export function noShowProblem(o: {
  c: CaseForNoShow;
  now: LocalDateTime;
  /** Mötet som dialogen visade. */
  meetingAt: LocalDateTime;
  kind: FirstMeetingNoShowKind;
  reason: string | null | undefined;
  rows: readonly Pick<FirstMeetingNoShow, "caseId" | "meetingAt">[];
}): NoShowProblem | null {
  const { c, now } = o;
  if (c.status === "active" || c.status === "paused") return { code: "wrong_status", text: "Insatsen har redan startat. Registrera frånvaron under Närvaro." };
  if (c.status === "closed" || c.status === "declined") return { code: "wrong_status", text: "Ärendet är avslutat." };
  if (c.status !== "confirmed") return { code: "wrong_status", text: "Det går när avropet är accepterat och första mötet har varit." };
  if (c.startDate != null) return { code: "wrong_status", text: "Ärendet har redan ett startdatum. Det går bara före start." };
  if (!c.firstMeetingAt) return { code: "no_meeting", text: "Första mötet är inte bokat." };
  if (o.meetingAt !== c.firstMeetingAt) return { code: "conflict", text: "Första mötet har bokats om under tiden. Ladda om sidan – inget har sparats." };
  if (!firstMeetingPassed(c, now)) return { code: "not_passed", text: `Första mötet har inte varit än. Det är bokat ${fmtDateTime(c.firstMeetingAt)}.` };
  if (currentNoShow(c, o.rows)) return { code: "already", text: `Det är redan registrerat att deltagaren inte kom till mötet ${fmtDateTime(c.firstMeetingAt)}.` };
  const reason = (o.reason ?? "").trim();
  if (o.kind === "giltig" && !reason) return { code: "reason", text: "Skriv orsaken till den giltiga frånvaron." };
  if ([...reason].length > NO_SHOW_REASON_MAX) return { code: "reason", text: `Orsaken får vara högst ${NO_SHOW_REASON_MAX} tecken.` };
  if (looksLikePnr(reason)) return { code: "pnr", text: "Det ser ut som ett personnummer i orsaken. Ta bort det – ärendenumret räcker." };
  return null;
}
