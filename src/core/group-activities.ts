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

// ---------------------------------------------------------------- Bjud in per yrkesområde, nivå eller enskilda
/**
 * Sätten att välja vilka som bjuds in (coachmötet 2026-10-09: "grupper åt gången, nivå åt gången, individuell nivå"; Karims beslut
 * 2026-10-22: grupperna är yrkesområdena). Yrkesområde och Nivå sätter aktivitetens målgrupp – de som tillkommer bjuds in
 * automatiskt fram till aktiviteten (src/core/audience.ts). Enskilda bjuds in för hand.
 */
export const INVITE_MODES = ["omrade", "niva", "enskilda"] as const;
export type InviteMode = (typeof INVITE_MODES)[number];
export const INVITE_MODE_LABEL: Record<InviteMode, string> = { omrade: "Yrkesområde", niva: "Nivå", enskilda: "Enskilda" };

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
/**
 * En nivå (id = nivåns id) eller ett yrkesområde (id = avtalsområdets kod) med sina deltagare (ärende-id:n): nivåns aktiva
 * medlemmar respektive ärendena med yrkesområdet.
 */
export type InviteGrouping = { id: string; kind: "level" | "area"; name: string; caseIds: readonly string[] };
/** En deltagare i en vald nivå som aldrig kan bjudas in (avslutad, avböjd, inte startad) – orsaken från servern. */
export type UninvitableMember = { caseId: string; caseNumber: string; name: string | null; reason: string };
/** En deltagare som hoppas över, och varför. */
export type InviteSkip = { caseId: string; caseNumber: string; name: string | null; reason: string };
export type InviteSelection = { invite: SelectableCase[]; skipped: InviteSkip[] };

const byNumber = (a: { caseNumber: string }, b: { caseNumber: string }) => (a.caseNumber < b.caseNumber ? -1 : a.caseNumber > b.caseNumber ? 1 : 0);

/**
 * Vilka i de valda nivåerna eller yrkesområdena som bjuds in den dagen (en gång var, i ärendenummerordning). Redan inbjudna och de
 * som inte kan bjudas in den dagen (inviteBlock – samma regel som servern och målgruppen) hoppas över med orsaken, liksom deltagare
 * vars insats inte pågår (others). Utan dag kan ingen bjudas in. Ren funktion – samma i skärmen och testerna.
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

/**
 * Orsaken som etikett i summeringen för flera deltagare ("Hoppas över: redan inbjudna (2), insatsen pausad (1)."). Orsakstexterna
 * är skrivna för en deltagare ("Redan inbjuden", "Insatsen är pausad") och blir fel svenska med ett antal framför.
 */
const SKIP_LABEL: Record<string, string> = {
  [ALREADY_INVITED_TEXT]: "redan inbjudna",
  [NO_DAY_TEXT]: "inget datum valt",
  [INVITE_BLOCK_TEXT.closed]: "insatsen avslutad",
  [INVITE_BLOCK_TEXT.declined]: "beställningen avböjd",
  [INVITE_BLOCK_TEXT.paused]: "insatsen pausad",
  [INVITE_BLOCK_TEXT.not_started]: "insatsen har inte startat",
  [INVITE_BLOCK_TEXT.ended]: "insatsen har slutat",
  [INVITE_BLOCK_TEXT.paused_week]: "uppehåll den veckan",
  // Serverns orsak för en deltagare i en nivå vars insats inte har startat (aktiviteter.form, others).
  "Insatsen har inte startat": "insatsen har inte startat",
};
export function skipLabel(reason: string): string {
  if (SKIP_LABEL[reason]) return SKIP_LABEL[reason];
  // Den vilande spärren för skyddade personuppgifter (orsaken från servern).
  if (reason.startsWith("Skyddade personuppgifter")) return "skyddade personuppgifter";
  return reason.charAt(0).toLocaleLowerCase("sv") + reason.slice(1);
}
/** Summeringen av de som hoppas över: "redan inbjudna (2), insatsen pausad (1)" – flest först. */
export function skipSummary(skipped: readonly Pick<InviteSkip, "reason">[]): string {
  return skipCounts(skipped.map((s) => ({ reason: skipLabel(s.reason) }))).map((c) => `${c.reason} (${c.count})`).join(", ");
}

/** Hur många som hoppas över per orsak, flest först: [{ reason: "Redan inbjuden", count: 2 }, …]. */
export function skipCounts(skipped: readonly Pick<InviteSkip, "reason">[]): { reason: string; count: number }[] {
  const m = new Map<string, number>();
  for (const s of skipped) m.set(s.reason, (m.get(s.reason) ?? 0) + 1);
  return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, "sv"));
}
