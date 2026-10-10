// Gruppaktiviteter (coachmötet 2026-10-09): vem kan bjudas in en viss dag, och typernas namn. Ren domänlogik – samma regel
// i inbjudningskomponenten (som visar varför en deltagare inte kan väljas) och i hanterarna (som nekar).
import type { ActivityKind, Case, GroupActivityKind } from "@/data/schema";
import { addMinutes, fmtTime, isoWeek, type LocalDate, type LocalDateTime } from "./time";

/** Varför ett ärende inte kan bjudas in en viss dag. */
export type InviteBlock = "closed" | "declined" | "paused" | "not_started" | "ended" | "paused_week";
export const INVITE_BLOCK_TEXT: Record<InviteBlock, string> = {
  closed: "Insatsen är avslutad",
  declined: "Beställningen är avböjd",
  paused: "Insatsen är pausad",
  not_started: "Insatsen har inte startat den dagen",
  ended: "Insatsen har slutat den dagen",
  paused_week: "Uppehåll den veckan",
};

export type InviteCase = Pick<Case, "status" | "startDate" | "endDate" | "pausedWeeks">;

/**
 * Kan ärendet bjudas in till en aktivitet den här dagen? Avslutade, avböjda och pausade ärenden kan inte bjudas in, inte heller
 * före insatsens start, efter slutet eller en vecka med uppehåll – deltagarens tillfälle skulle annars räknas i veckorapporten och
 * närvarograden för en vecka hen inte är inskriven. null = kan bjudas in.
 */
export function inviteBlock(c: InviteCase, day: LocalDate): InviteBlock | null {
  if (c.status === "closed") return "closed";
  if (c.status === "declined") return "declined";
  if (c.status === "paused") return "paused";
  if (c.status !== "active" || !c.startDate || day < c.startDate) return "not_started";
  if (c.endDate && day > c.endDate) return "ended";
  if (c.pausedWeeks.includes(isoWeek(day).key)) return "paused_week";
  return null;
}

/** Typerna en gruppaktivitet kan ha, med namn (samma ord som i närvaron och veckorapporten). */
export const GROUP_KIND_LABEL: Record<GroupActivityKind, string> = { yrkesmoment: "Yrkesmoment", arbetsgivarbesök: "Arbetsgivarbesök", annat: "Annan aktivitet" };

/** Typen som ord i en mening ("Har redan yrkesmoment kl. 09.00–12.00"). */
export const ACTIVITY_KIND_WORD: Record<ActivityKind, string> = {
  möte: "möte", yrkesmoment: "yrkesmoment", praktikdag: "praktikdag", arbetsgivarbesök: "arbetsgivarbesök", annat: "annan aktivitet",
};

type Slot = { startsAt: LocalDateTime; durationMin: number };
/** Två tillfällen överlappar i tid (start före den andras slut, åt båda hållen). Ett tillfälle som slutar när nästa börjar överlappar inte. */
export function overlaps(a: Slot, b: Slot): boolean {
  return a.startsAt < addMinutes(b.startsAt, b.durationMin) && b.startsAt < addMinutes(a.startsAt, a.durationMin);
}
/** "kl. 09.00–12.00" */
export const slotText = (a: Slot): string => `kl. ${fmtTime(a.startsAt)}–${fmtTime(addMinutes(a.startsAt, a.durationMin))}`;
