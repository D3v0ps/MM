// Geometrin för den interna månadsrapportens diagram – ren och utan React, så att sidan (SVG) och PDF:en (react-pdf Svg) ritar
// samma sak av samma vy-modell.
//
// Formen (dataviz-metoden): liggande staplar med en serie för storlek (antal, andel), och ett divergerande stapeldiagram för
// flödet per yrkesområde (avslutade till vänster, startade till höger om nollan). MB:s profil: antracit för den första serien,
// blått för den andra (alltid med värdet utskrivet vid stapeln och tabellen bredvid – blått är 2,8:1 mot vitt), avtalets mål som
// röd streckad linje och det interna målet som antracit prickad linje. Inget grönt. Staplarna är högst 24 px (här 16), med
// rundad dataände och rak bas; axeln är en hårfin linje.

// Färgerna sätts av ritarna: sidan med temats variabler (var(--color-antracit) …), PDF:en med PDF_COLOR (pdf/theme.ts).

/** Stapel med rundad dataände (radie r) och rak bas: från x0 åt höger (dir 1) eller åt vänster (dir -1). */
export function barPath(x0: number, y: number, w: number, h: number, dir: 1 | -1 = 1, r = 4): string {
  if (w <= 0) return "";
  const rr = Math.max(0, Math.min(r, w, h / 2));
  const x1 = x0 + dir * w;
  const f = (n: number) => Math.round(n * 100) / 100;
  // Basen (x0) är rak, dataänden (x1) har två rundade hörn.
  return [
    `M${f(x0)} ${f(y)}`,
    `H${f(x1 - dir * rr)}`,
    `Q${f(x1)} ${f(y)} ${f(x1)} ${f(y + rr)}`,
    `V${f(y + h - rr)}`,
    `Q${f(x1)} ${f(y + h)} ${f(x1 - dir * rr)} ${f(y + h)}`,
    `H${f(x0)}`,
    "Z",
  ].join(" ");
}

/** Kortar en etikett till högst n tecken ("…" sist). */
export const cutLabel = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);
/** Ungefär så många tecken av fet Montserrat som ryms på bredden (ca 0,6 em per tecken). */
export const charsFor = (width: number, fontSize: number): number => Math.max(4, Math.floor(width / (fontSize * 0.6)));

// ---------------------------------------------------------------- Liggande staplar (en serie)
export type HBarInput = { label: string; value: number; valueText: string };
export type HBarTarget = { kind: "contract" | "internal"; value: number; label: string };
export type HBarGeometry = {
  width: number;
  height: number;
  /** Plotytans vänsterkant (axeln) och bredd. */
  x0: number;
  plotW: number;
  labelW: number;
  rows: { y: number; cy: number; w: number; label: string; valueText: string; valueX: number }[];
  targets: { kind: HBarTarget["kind"]; x: number; label: string; labelY: number }[];
  /** Mållinjernas övre och nedre ände. */
  top: number;
  bottom: number;
};

export function hbarLayout(
  bars: readonly HBarInput[], unit: "antal" | "andel", targets: readonly HBarTarget[],
  o: { width: number; fontSize: number; rowH: number; barH: number; labelW: number; valueW: number },
): HBarGeometry {
  const labelLine = o.fontSize + 5;
  const top = 6 + targets.length * labelLine;
  const x0 = o.labelW + 8;
  const plotW = Math.max(40, o.width - x0 - o.valueW);
  const max = unit === "andel" ? 1 : Math.max(1, ...bars.map((b) => b.value));
  const x = (v: number) => x0 + (Math.max(0, Math.min(v, max)) / max) * plotW;
  const maxChars = charsFor(o.labelW, o.fontSize);
  const rows = bars.map((b, i) => {
    const y = top + i * o.rowH + (o.rowH - o.barH) / 2;
    const w = Math.max(0, x(b.value) - x0);
    return { y, cy: top + i * o.rowH + o.rowH / 2, w: b.value > 0 ? Math.max(1, w) : 0, label: cutLabel(b.label, maxChars), valueText: b.valueText, valueX: x0 + w + 5 };
  });
  const bottom = top + Math.max(1, bars.length) * o.rowH;
  return {
    width: o.width, height: bottom + 4, x0, plotW, labelW: o.labelW, rows, top, bottom,
    targets: targets.map((t, i) => ({ kind: t.kind, x: x(t.value), label: t.label, labelY: 6 + i * labelLine + o.fontSize })),
  };
}

// ---------------------------------------------------------------- Flödet: avslutade till vänster, startade till höger
export type FlowInput = { label: string; started: number; ended: number };
export type FlowGeometry = {
  width: number;
  height: number;
  labelW: number;
  /** Nollan (mitten av plotytan) och halvans bredd. */
  cx: number;
  half: number;
  top: number;
  bottom: number;
  rows: { y: number; cy: number; label: string; started: number; ended: number; startedW: number; endedW: number }[];
};

export function flowLayout(rows: readonly FlowInput[], o: { width: number; fontSize: number; rowH: number; barH: number; labelW: number; valueW: number }): FlowGeometry {
  const top = o.fontSize + 10;
  const plotX = o.labelW + 8;
  const half = Math.max(30, (o.width - plotX - 2 * o.valueW) / 2);
  const cx = plotX + o.valueW + half;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.started, r.ended)));
  const maxChars = charsFor(o.labelW, o.fontSize);
  const w = (v: number) => (v > 0 ? Math.max(1, (v / max) * half) : 0);
  return {
    width: o.width, labelW: o.labelW, cx, half, top,
    bottom: top + Math.max(1, rows.length) * o.rowH,
    height: top + Math.max(1, rows.length) * o.rowH + 4,
    rows: rows.map((r, i) => ({
      y: top + i * o.rowH + (o.rowH - o.barH) / 2, cy: top + i * o.rowH + o.rowH / 2, label: cutLabel(r.label, maxChars), started: r.started, ended: r.ended,
      startedW: w(r.started), endedW: w(r.ended),
    })),
  };
}
