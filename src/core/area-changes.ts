// Byt yrkesområde (Karims beslut 2026-10-22, migration 0036). Ren domänlogik utan I/O: vem som byter och läser, kontrollen
// av ett byte och vilket yrkesområde (avtalsområde A–L) som gäller för en månad i faktureringen.
//
// "Vi ska kunna ha möjligheten för huvudcoachen att byta yrkeskategori på deltagarna med någon kortare motivering."
// Bytet gäller direkt för ärendet (cases.primaryAreaCode, grupp och inbjudningar). Fakturan räknas på det gamla yrkesområdet
// till och med bytesmånaden och på det nya från och med månaden efter (effectiveMonth) – samma månad faktureras aldrig på två
// yrkesområden. Bytena läses av ekonomen (case_area_changes har ingen fritext – motiveringen är en anteckning i case_notes).
import type { Role } from "@/api/roles";
import type { Case, CaseAreaChange, CaseStatus } from "@/data/schema";
import { addMonths, dayOf, monthKey, type LocalDateTime, type MonthKey } from "./time";
import { looksLikePnr } from "./validation";

/** Byter yrkesområde: huvudcoachen och de som leder ärendena (samma i hanteraren, RLS och policy.ts). */
export const AREA_CHANGERS: readonly Role[] = ["coach", "samordnare", "avtalsansvarig"];
/** Läser bytena: Miljonbemanning i avtalet, också ekonomen (faktureringen) – aldrig kommunen. */
export const AREA_CHANGE_READERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin", "ekonom"];
/** Ärenden där yrkesområdet kan bytas: bekräftade, pågående och pausade (inte avslutade, nekade eller obesvarade). */
export const AREA_CHANGE_STATUSES: readonly CaseStatus[] = ["confirmed", "active", "paused"];

/** Motiveringens längd i tecken (efter trim). */
export const AREA_MOTIVATION_MIN = 10;
export const AREA_MOTIVATION_MAX = 300;

/** Yrkesspåret som kan väljas i dialogen (fritext ur listan för det nya yrkesområdet) – tomt = väljs i kartläggningen. */
export const AREA_TRACK_MAX = 200;

/**
 * Anteckningen med motiveringen (case_notes.body): "Byte av yrkesområde: G Lager och logistik → C Bygg och anläggning. <motivering>".
 * Anteckningen är låst – den ändras och tas aldrig bort (0036, policy.ts caseNoteWrite) – och visas i bytets historik.
 */
export const areaChangeNoteBody = (fromLabel: string, toLabel: string, motivation: string): string => `${areaChangePrefix(fromLabel, toLabel)}${motivation.trim()}`;
const areaChangePrefix = (fromLabel: string, toLabel: string) => `Byte av yrkesområde: ${fromLabel} → ${toLabel}. `;
/** Motiveringen ur anteckningen (texten efter inledningen), eller hela texten om inledningen inte stämmer. */
export const motivationOf = (body: string, fromLabel: string, toLabel: string): string => {
  const prefix = areaChangePrefix(fromLabel, toLabel);
  return body.startsWith(prefix) ? body.slice(prefix.length) : body;
};

/** Månaden efter bytet ('YYYY-MM') – från den månaden faktureras det nya yrkesområdet (Stockholmstid). */
export const effectiveMonthOf = (changedAt: LocalDateTime): MonthKey => addMonths(monthKey(dayOf(changedAt)), 1);

/**
 * Bytena i den ordning de gjordes: bytets nummer i ärendet (seq – unikt per ärende, också för två byten samma minut), sedan
 * bytestid och id. Id:t avgör aldrig ordningen mellan två byten i samma ärende (i produktionen är id:t slumpat).
 */
export const inOrder = <T extends Pick<CaseAreaChange, "id" | "changedAt" | "seq">>(changes: readonly T[]): T[] =>
  [...changes].sort((a, b) => a.seq - b.seq || (a.changedAt < b.changedAt ? -1 : a.changedAt > b.changedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Nästa nummer för ett nytt byte i ärendet (seq): det högsta hittills plus ett. */
export const nextAreaChangeSeq = (changes: readonly Pick<CaseAreaChange, "seq">[]): number => changes.reduce((m, x) => Math.max(m, x.seq), 0) + 1;

/**
 * Yrkesområdet som gäller för fakturan en månad: det nya yrkesområdet i det senaste bytet som gäller från månaden eller
 * tidigare; annars det gamla yrkesområdet i det första bytet (månaden är före alla byten); annars ärendets yrkesområde (inga
 * byten). Bara ärendets egna byten räknas, i den ordning de gjordes (seq).
 */
export function areaForMonth(
  c: Pick<Case, "id" | "primaryAreaCode">,
  changes: readonly Pick<CaseAreaChange, "id" | "caseId" | "fromArea" | "toArea" | "effectiveMonth" | "changedAt" | "seq">[],
  month: MonthKey,
): string | null {
  const own = inOrder(changes.filter((x) => x.caseId === c.id));
  if (!own.length) return c.primaryAreaCode;
  const applied = own.filter((x) => x.effectiveMonth <= month);
  if (applied.length) return applied[applied.length - 1].toArea;
  return own[0].fromArea;
}

/** Bytena per ärende (uppslag för många ärenden, t.ex. hela avtalets fakturering). */
export function areaChangesByCase<T extends Pick<CaseAreaChange, "caseId">>(changes: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of changes) {
    const l = m.get(x.caseId);
    if (l) l.push(x);
    else m.set(x.caseId, [x]);
  }
  return m;
}

export type AreaChangeProblem = { code: "closed" | "area" | "same" | "no_area" | "motivation" | "pnr" | "track"; text: string };

/**
 * Vad som stoppar ett byte, eller null. Kontrolleras av hanteraren (arenden.bytYrkesomrade) med avtalets yrkesområden.
 *   closed      ärendet är avslutat, nekat eller inte bekräftat
 *   no_area     ärendet har inget yrkesområde att byta från (det väljs när beställningen accepteras)
 *   area        det nya yrkesområdet finns inte i avtalet eller är inte aktivt
 *   same        samma yrkesområde som nu
 *   motivation  motiveringen är kortare än 10 eller längre än 300 tecken
 *   pnr         motiveringen ser ut att innehålla ett personnummer
 *   track       yrkesspåret i det nya yrkesområdet är för långt eller ser ut som ett personnummer (tomt är tillåtet)
 */
export function areaChangeProblem(
  c: Pick<Case, "status" | "primaryAreaCode">,
  areas: readonly { code: string; active: boolean }[],
  toArea: string,
  motivation: string,
  track?: string | null,
): AreaChangeProblem | null {
  if (!AREA_CHANGE_STATUSES.includes(c.status)) {
    return { code: "closed", text: c.status === "closed" ? "Insatsen är avslutad. Yrkesområdet kan inte bytas." : "Yrkesområdet kan bytas när beställningen är bekräftad." };
  }
  if (!c.primaryAreaCode) return { code: "no_area", text: "Ärendet har inget yrkesområde ännu. Det väljs när beställningen accepteras." };
  if (!areas.some((a) => a.code === toArea && a.active)) return { code: "area", text: "Välj ett av avtalets yrkesområden i listan." };
  if (toArea === c.primaryAreaCode) return { code: "same", text: "Deltagaren har redan det yrkesområdet. Välj ett annat." };
  const m = motivation.trim();
  if (m.length < AREA_MOTIVATION_MIN || m.length > AREA_MOTIVATION_MAX) {
    return { code: "motivation", text: `Skriv en kort motivering, ${AREA_MOTIVATION_MIN}–${AREA_MOTIVATION_MAX} tecken.` };
  }
  if (looksLikePnr(m)) return { code: "pnr", text: "Det ser ut som ett personnummer i motiveringen. Ta bort det – ärendenumret räcker." };
  const t = (track ?? "").trim();
  if (t.length > AREA_TRACK_MAX || looksLikePnr(t)) return { code: "track", text: "Välj yrkesspåret i listan, eller lämna fältet tomt." };
  return null;
}
