// Små generiska hjälpare utan beroenden.
export const by = <T>(key: keyof T | ((x: T) => unknown), dir: 1 | -1 = 1) => (a: T, b: T): number => {
  const x = (typeof key === "function" ? key(a) : a[key]) as never;
  const y = (typeof key === "function" ? key(b) : b[key]) as never;
  return x < y ? -dir : x > y ? dir : 0;
};
export function groupBy<T>(arr: readonly T[], fn: (x: T) => string): Record<string, T[]> {
  const m: Record<string, T[]> = {};
  for (const x of arr) (m[fn(x)] ??= []).push(x);
  return m;
}
export const sum = <T>(arr: readonly T[], fn: (x: T) => number = (x) => x as unknown as number): number =>
  arr.reduce((s, x) => s + fn(x), 0);
export const uniq = <T>(arr: readonly T[]): T[] => [...new Set(arr)];
export const cls = (...xs: unknown[]): string => xs.filter(Boolean).join(" ");
export function assertNever(x: never): never {
  throw new Error(`Oväntat värde: ${String(x)}`);
}

/** Deterministisk slump (mulberry32) – bara för testdata. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
    weighted: <T>(pairs: readonly (readonly [T, number])[]): T => {
      const tot = pairs.reduce((s, p) => s + p[1], 0);
      let r = next() * tot;
      for (const [v, w] of pairs) if ((r -= w) < 0) return v;
      return pairs[pairs.length - 1][0];
    },
    shuffle: <T>(arr: readonly T[]): T[] => {
      const b = arr.slice();
      for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]];
      }
      return b;
    },
  };
}
export type Rng = ReturnType<typeof rng>;
