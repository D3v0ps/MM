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
//     avslutar insatsen (deltagaren kom aldrig). Insatsen kan fortfarande startas som förut.
// Samma regler i databasen (triggern first_meeting_no_shows_check, 0040) och i policy.ts (first_meeting_no_shows).
import type { Role } from "@/api/roles";
import type { Case, FirstMeetingNoShow, FirstMeetingNoShowKind } from "@/data/schema";
import { fmtDateTime, type LocalDateTime } from "./time";
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
export const NO_SHOW_REASON_HELP = "Kort och sakligt. Inga personnummer och inga omdömen om personen.";

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
