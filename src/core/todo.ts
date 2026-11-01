// Att göra-listan på Min vecka (paket 2, UX-genomgången 2026-10-31): samma ordning och sammanslagning för alla MB-roller.
// Ren logik utan React – skärmarna bygger delarna av sina vy-modeller och kitet (src/ui/vecka.tsx, TodoList) ritar raderna.
//
// Regler:
//   - Sorteras på sista tid (dueAt). Det som saknar tidsgräns står efter det som har en.
//   - Vid samma tid (och för det som saknar tid): lägre vikt (weight) först, sedan i den ordning delarna kom.
//   - Delar med samma grupp (group – oftast ärendets id) blir en rad: ärendet står en gång. Raden får den tidigaste tiden
//     och den viktigaste delens åtgärd (lägst vikt); de andra delarna blir anmärkningar på raden.
//   - Delar utan grupp (null) står alltid på en egen rad.
import { addDays, dayOf, fmtDateShort, fmtTime, weekday, WEEKDAYS_SHORT, type LocalDateTime } from "./time";

export type TodoPart = {
  /** Unik nyckel för delen. */
  key: string;
  /** Sista tid (Stockholms tid). null = ingen tidsgräns. */
  dueAt: LocalDateTime | string | null;
  /** Ordningen när tiden är samma eller saknas, och vilken del i en grupp som ger raden dess knapp: lägre först. */
  weight: number;
  /** Delar med samma grupp slås ihop till en rad (t.ex. ärendets id). null = egen rad. */
  group?: string | null;
};

export type TodoRow<P extends TodoPart> = {
  /** Radens nyckel: gruppen (ärendet) eller den enda delens nyckel. */
  key: string;
  /** Den tidigaste tiden bland delarna (null om ingen del har en tid). */
  dueAt: string | null;
  /** Delen som ger raden dess rubrik och knapp (lägst vikt; vid lika vikt den med tidigast tid). */
  main: P;
  /** Övriga delar i samma grupp, i ordning (tid, vikt) – anmärkningar på raden. */
  rest: P[];
};

const cmpDue = (a: string | null, b: string | null): number => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);

/** Sortera och slå ihop delarna till rader (samma grupp en gång, sorterat på tid). Stabil – samma indata ger samma ordning. */
export function todoRows<P extends TodoPart>(parts: readonly P[]): TodoRow<P>[] {
  const order = new Map<P, number>(parts.map((p, i) => [p, i]));
  const byPart = (a: P, b: P) => cmpDue(a.dueAt, b.dueAt) || a.weight - b.weight || (order.get(a) ?? 0) - (order.get(b) ?? 0);
  const groups = new Map<string, P[]>();
  const rows: { key: string; parts: P[] }[] = [];
  for (const p of parts) {
    if (p.group) {
      const g = groups.get(p.group);
      if (g) {
        g.push(p);
        continue;
      }
      const list = [p];
      groups.set(p.group, list);
      rows.push({ key: `grupp:${p.group}`, parts: list });
    } else rows.push({ key: p.key, parts: [p] });
  }
  const out = rows.map(({ key, parts: ps }): TodoRow<P> => {
    const sorted = [...ps].sort(byPart);
    const main = [...ps].sort((a, b) => a.weight - b.weight || cmpDue(a.dueAt, b.dueAt) || (order.get(a) ?? 0) - (order.get(b) ?? 0))[0];
    return { key, dueAt: sorted[0].dueAt, main, rest: sorted.filter((p) => p !== main) };
  });
  const first = new Map(out.map((r) => [r, Math.min(...[r.main, ...r.rest].map((p) => order.get(p) ?? 0))]));
  return out.sort((a, b) => cmpDue(a.dueAt, b.dueAt) || a.main.weight - b.main.weight || (first.get(a) ?? 0) - (first.get(b) ?? 0));
}

/** Antal rader och hur många av dem som har passerat sin tid (now = klockan). */
export function todoSummary(rows: readonly { dueAt: string | null }[], now: string): { total: number; late: number } {
  return { total: rows.length, late: rows.filter((r) => r.dueAt !== null && r.dueAt < now).length };
}

/**
 * Tiden i klarspråk relativt till i dag: "i dag kl. 10.00", "i går kl. 16.00", "i morgon kl. 08.41", "ons 3 feb kl. 16.00"
 * (bara datum utan klockslag när tiden saknar klockslag). "–" utan tid.
 */
export function whenText(s: string | null | undefined, now: string): string {
  if (!s) return "–";
  const day = dayOf(s);
  const t = s.includes("T") ? ` kl. ${fmtTime(s)}` : "";
  const today = dayOf(now);
  if (day === today) return `i dag${t}`;
  if (day === addDays(today, -1)) return `i går${t}`;
  if (day === addDays(today, 1)) return `i morgon${t}`;
  return `${WEEKDAYS_SHORT[weekday(s)]} ${fmtDateShort(s)}${t}`;
}
