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

// ---------------------------------------------------------------- Bjud in per grupp, nivå eller enskilda (spår G)
/** Sätten att välja vilka som bjuds in (coachmötet 2026-10-09: "grupper åt gången, nivå åt gången, individuell nivå"). */
export const INVITE_MODES = ["grupp", "niva", "enskilda"] as const;
export type InviteMode = (typeof INVITE_MODES)[number];
export const INVITE_MODE_LABEL: Record<InviteMode, string> = { grupp: "Grupp", niva: "Nivå", enskilda: "Enskilda" };

export const ALREADY_INVITED_TEXT = "Redan inbjuden";
export const NO_DAY_TEXT = "Välj datum först";

/** Varför deltagaren inte kan väljas: redan inbjuden, ingen dag, eller insatsens läge den dagen. null = kan väljas. */
export function candidateBlockText(c: InviteCase & { caseId: string }, day: LocalDate | null, alreadyInvited: ReadonlySet<string>): string | null {
  if (alreadyInvited.has(c.caseId)) return ALREADY_INVITED_TEXT;
  if (!day) return NO_DAY_TEXT;
  const b = inviteBlock(c, day);
  return b ? INVITE_BLOCK_TEXT[b] : null;
}

/** En deltagare som kan bjudas in i avtalet (pågående eller pausad): det inviteBlock behöver, nummer och namn. */
export type SelectableCase = InviteCase & { caseId: string; caseNumber: string; name: string };
/** En nivå eller grupp med sina aktiva deltagare (ärende-id:n). */
export type InviteGrouping = { id: string; kind: "level" | "group"; name: string; caseIds: readonly string[] };
/** En deltagare i en vald grupp eller nivå som aldrig kan bjudas in (avslutad, avböjd, inte startad) – orsaken från servern. */
export type UninvitableMember = { caseId: string; caseNumber: string; name: string | null; reason: string };
/** En deltagare som hoppas över, och varför. */
export type InviteSkip = { caseId: string; caseNumber: string; name: string | null; reason: string };
export type InviteSelection = { invite: SelectableCase[]; skipped: InviteSkip[] };

const byNumber = (a: { caseNumber: string }, b: { caseNumber: string }) => (a.caseNumber < b.caseNumber ? -1 : a.caseNumber > b.caseNumber ? 1 : 0);

/**
 * Inbjudan per grupp eller nivå: alla aktiva deltagare i de valda grupperingarna (en gång var, i ärendenummerordning). Redan
 * inbjudna och de som inte kan bjudas in den dagen (inviteBlock – samma regel som servern) hoppas över med orsaken, liksom
 * deltagare i grupperna vars insats inte pågår (others). Utan dag kan ingen bjudas in. Ren funktion – samma i skärmen och testerna.
 */
export function selectByGroupings(
  groupingIds: readonly string[],
  groupings: readonly InviteGrouping[],
  candidates: readonly SelectableCase[],
  others: readonly UninvitableMember[],
  day: LocalDate | null,
  alreadyInvited: ReadonlySet<string>,
): InviteSelection {
  const chosen = new Set(groupingIds);
  const caseIds = new Set(groupings.filter((g) => chosen.has(g.id)).flatMap((g) => g.caseIds));
  const candidateOf = new Map(candidates.map((c) => [c.caseId, c]));
  const otherOf = new Map(others.map((o) => [o.caseId, o]));
  const invite: SelectableCase[] = [];
  const skipped: InviteSkip[] = [];
  for (const id of caseIds) {
    const c = candidateOf.get(id);
    if (!c) {
      const o = otherOf.get(id);
      if (o) skipped.push({ caseId: o.caseId, caseNumber: o.caseNumber, name: o.name, reason: o.reason });
      continue;
    }
    const reason = candidateBlockText(c, day, alreadyInvited);
    if (reason) skipped.push({ caseId: c.caseId, caseNumber: c.caseNumber, name: c.name, reason });
    else invite.push(c);
  }
  return { invite: invite.sort(byNumber), skipped: skipped.sort(byNumber) };
}

/** Hur många som hoppas över per orsak, flest först: [{ reason: "Redan inbjuden", count: 2 }, …]. */
export function skipCounts(skipped: readonly Pick<InviteSkip, "reason">[]): { reason: string; count: number }[] {
  const m = new Map<string, number>();
  for (const s of skipped) m.set(s.reason, (m.get(s.reason) ?? 0) + 1);
  return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, "sv"));
}
