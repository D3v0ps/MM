// Formatering av belopp, procent och tal (svenska). Belopp är alltid öre (heltal).
const NBSP = " ";
const pad = (n: number) => String(n).padStart(2, "0");
const group = (n: number) => String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

/** öre -> "1 523 kr" (heltal kronor om jämnt, annars med ören) */
export function kr(ore?: number | null): string {
  if (ore == null) return "–";
  const neg = ore < 0;
  const k = Math.abs(ore) / 100;
  const s = Number.isInteger(k) ? group(k) : `${group(Math.floor(k))},${pad(Math.round((k % 1) * 100))}`;
  return `${neg ? "−" : ""}${s}${NBSP}kr`;
}
/** öre -> "1 523,00 kr" */
export function krExact(ore?: number | null): string {
  if (ore == null) return "–";
  const neg = ore < 0;
  const a = Math.abs(ore);
  return `${neg ? "−" : ""}${group(Math.floor(a / 100))},${pad(a % 100)}${NBSP}kr`;
}
/** 0.339 -> "33,9 %" */
export function pct(v?: number | null, dec = 1): string {
  if (v == null || Number.isNaN(v)) return "–";
  return `${(v * 100).toFixed(dec).replace(".", ",")}${NBSP}%`;
}
export const num = (n?: number | null): string => (n == null ? "–" : group(n));
export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
export const initials = (name?: string | null): string =>
  String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
