"use client";
// BarChart – liggande stapeldiagram med ett mått (rapportbyggaren, rapporter steg 4). Tabellen visas alltid bredvid.
//
// Staplarna är antracit (kontrast). Avtalets mål är en röd streckad lodrät linje, det interna målet (bara Miljonbemanning)
// en antracit prickad linje – samma streckning som TrendChart. Linjerna ritas ovanpå staplarna med en vit kontur under sig,
// så att de syns där de korsar en stapel. Värdena ritas sist med vit kant, så att linjerna inte skär igenom dem. Etiketterna ("Avtalets mål 32,0 %") är antracit text – röd bara på linjen.
// Små grupper (kommunens läge) får ingen stapel, bara texten ("färre än 5"). Inget grönt, blått aldrig som text eller tunn linje.
// large (kommunens portal, 18 px brödtext): större text i diagrammet och förklaringen; på smal skärm står gruppens namn på en egen
// rad ovanför stapeln, så att namnet inte behöver kortas.
import { useEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { Chart } from "./data";

export type BarChartBar = { label: string; value: number | null; small?: boolean };
export type BarChartProps = {
  /** Diagrammets namn i sammanfattningen för skärmläsare, t.ex. "Resultatgrad per avtalsområde, september 2026 – januari 2027". */
  title: string;
  unit: "antal" | "andel";
  bars: readonly BarChartBar[];
  contractTarget?: number | null;
  /** Bara i Miljonbemannings läge – ritas inte utan värde. */
  internalTarget?: number | null;
  /** Texten för en liten grupp ("färre än 5"). */
  smallText?: string;
  /** Kommunens portal: större text (16 px i diagrammet, portalens 18 px i förklaringen). */
  large?: boolean;
  className?: string;
};

/** "41,7 %" eller "12" (– när värdet saknas). */
export const barValueText = (unit: BarChartProps["unit"], v: number | null): string =>
  v == null ? "–" : unit === "andel" ? `${(Math.round(v * 1000) / 10).toFixed(1).replace(".", ",")} %` : String(Math.round(v * 10) / 10).replace(".", ",");

/** Bredd på behållaren – diagrammet ritas i verkliga pixlar så att etiketterna blir läsbara även på mobil. */
function useWidth(init = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(init);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const upd = () => {
      const x = Math.round(el.getBoundingClientRect().width);
      if (x > 0) setW((old) => (Math.abs(old - x) > 1 ? x : old));
    };
    upd();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", upd);
      return () => window.removeEventListener("resize", upd);
    }
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Målsymbolerna i förklaringen (kopia av Swatch i ledning/screens/parts.tsx – src/ui importerar aldrig från features). */
function TargetSwatch({ kind }: { kind: "contract" | "internal" }) {
  const cls = kind === "contract" ? "h-0 w-5 border-t-2 border-dashed border-rod" : "h-0 w-5 border-t-2 border-dotted border-antracit";
  return <span aria-hidden="true" className={cn("inline-block flex-none", cls)} />;
}

/** Vit kant runt texten (ritas under texten), så att en mållinje som korsar den inte skär igenom bokstäverna. */
const HALO = { paintOrder: "stroke", stroke: "var(--color-vit)", strokeWidth: 4, strokeLinejoin: "round" } as const;

export function BarChart({ title, unit, bars, contractTarget = null, internalTarget = null, smallText = "", large = false, className }: BarChartProps) {
  const [ref, W] = useWidth(640);
  const narrow = W < 480;
  // Textstorlek och mått: 12 px för Miljonbemanning, 16 px i portalen.
  const fs = large ? 16 : 12;
  const BAR_H = large ? 22 : 18;
  const base = Math.round(fs / 3); // från radens mitt till textens baslinje
  // Smal skärm i portalen: namnet på en egen rad ovanför stapeln (aldrig kortat).
  const stacked = large && narrow;
  const ROW_H = stacked ? fs + 6 + BAR_H + 10 : large ? 38 : 30;
  const labelW = stacked ? 0 : Math.min(narrow ? 128 : large ? 280 : 230, Math.round(W * 0.4));
  const targets = [contractTarget != null ? "contract" : null, internalTarget != null ? "internal" : null].filter(Boolean) as ("contract" | "internal")[];
  const tl = fs + 5; // höjden per måletikett ovanför plottytan
  const m = { l: stacked ? 8 : labelW + 12, r: narrow ? (large ? 64 : 52) : large ? 80 : 64, t: 8 + targets.length * tl, b: 8 };
  const pw = Math.max(80, W - m.l - m.r);
  const H = m.t + Math.max(1, bars.length) * ROW_H + m.b;
  /** Stapelns mitt (y) för rad i. */
  const barY = (i: number) => (stacked ? m.t + i * ROW_H + fs + 6 + BAR_H / 2 : m.t + i * ROW_H + ROW_H / 2);
  const values = bars.map((b) => b.value).filter((v): v is number => v != null);
  const max = unit === "andel" ? 1 : Math.max(1, ...values, ...(contractTarget != null ? [contractTarget] : []), ...(internalTarget != null ? [internalTarget] : []));
  const x = (v: number) => m.l + (Math.max(0, Math.min(v, max)) / max) * pw;
  const fmt = (v: number | null) => barValueText(unit, v);
  // Fet Montserrat är ungefär 0,62 em bred per tecken (portalen räknar av bredden; Miljonbemanning har fasta gränser).
  const maxChars = stacked ? Math.floor((W - 16) / (fs * 0.62)) : large ? Math.floor((labelW - 4) / (fs * 0.62)) : narrow ? 17 : 32;
  const cut = (s: string) => (s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s);
  const aria = `${title}. ${bars.map((b) => `${b.label}: ${b.small ? smallText : fmt(b.value)}`).join(". ")}.${contractTarget != null ? ` Avtalets mål ${fmt(contractTarget)}.` : ""}${internalTarget != null ? ` Internt mål ${fmt(internalTarget)}.` : ""}`;
  const line = (v: number, kind: "contract" | "internal") => (
    <g key={kind} data-target={kind}>
      {/* Vit kontur under linjen, så att den syns där den korsar en antracit stapel. */}
      <line data-outline="true" x1={x(v)} x2={x(v)} y1={m.t - 4} y2={H - m.b} style={{ stroke: "var(--color-vit)", strokeWidth: 6 }} />
      <line
        x1={x(v)}
        x2={x(v)}
        y1={m.t - 4}
        y2={H - m.b}
        style={kind === "contract" ? { stroke: "var(--color-rod)", strokeWidth: 2, strokeDasharray: "7 4" } : { stroke: "var(--color-antracit)", strokeWidth: 2, strokeDasharray: "2 3" }}
      />
    </g>
  );
  // Måletiketten centreras på linjen men hålls inom diagrammet (i portalen efter etikettens ungefärliga bredd).
  const labelX = (v: number, text: string) => {
    if (!large) return Math.min(Math.max(x(v), m.l + 40), W - m.r);
    const half = Math.ceil((text.length * fs * 0.6) / 2) + 2;
    return Math.min(Math.max(x(v), half), W - half);
  };
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div ref={ref} className="w-full">
        <Chart viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-label={aria} className={cn("w-auto max-w-full", large && "[&_text]:text-[16px]")}>
          <line className="axis" x1={m.l} x2={m.l} y1={m.t - 4} y2={H - m.b} />
          {bars.map((b, i) => {
            const cy = barY(i);
            return (
              <g key={`b${i}`}>
                {!stacked && (
                  <text data-label="true" x={m.l - 8} y={cy + base} textAnchor="end" style={{ fontWeight: 600 }}>
                    <title>{b.label}</title>
                    {cut(b.label)}
                  </text>
                )}
                {b.small ? (
                  !stacked && (
                    <text x={m.l + 6} y={cy + base} style={{ fill: "var(--color-text-muted)" }}>
                      {smallText}
                    </text>
                  )
                ) : (
                  <>
                    {b.value != null && b.value > 0 && (
                      <rect data-bar="true" x={m.l} y={cy - BAR_H / 2} width={Math.max(1, x(b.value) - m.l)} height={BAR_H} rx={2} style={{ fill: "var(--color-antracit)" }}>
                        <title>{`${b.label}: ${fmt(b.value)}`}</title>
                      </rect>
                    )}
                  </>
                )}
              </g>
            );
          })}
          {/* Mållinjerna efter (ovanpå) staplarna. */}
          {internalTarget != null && line(internalTarget, "internal")}
          {contractTarget != null && line(contractTarget, "contract")}
          {/* Smal skärm i portalen: namnen (ovanför staplarna) och "färre än 5" efter mållinjerna med vit kant – linjen korsar dem. */}
          {stacked &&
            bars.map((b, i) => (
              <g key={`l${i}`}>
                <text data-label="true" x={m.l} y={m.t + i * ROW_H + fs} textAnchor="start" style={{ fontWeight: 600, ...HALO }}>
                  <title>{b.label}</title>
                  {cut(b.label)}
                </text>
                {b.small && (
                  <text x={m.l + 6} y={barY(i) + base} style={{ fill: "var(--color-text-muted)", ...HALO }}>
                    {smallText}
                  </text>
                )}
              </g>
            ))}
          {/* Värdena sist, med vit kant runt texten, så att en mållinje aldrig skär igenom siffrorna. */}
          {bars.map((b, i) =>
            b.small ? null : (
              <text
                key={`v${i}`}
                data-value="true"
                x={(b.value != null ? x(b.value) : m.l) + 6}
                y={barY(i) + base}
                style={{ fontWeight: 700, ...HALO }}
              >
                {fmt(b.value)}
              </text>
            ),
          )}
          {contractTarget != null && (
            <text data-target-label="contract" x={labelX(contractTarget, `Avtalets mål ${fmt(contractTarget)}`)} y={fs + 1} textAnchor="middle" style={{ fill: "var(--color-antracit)", fontWeight: 700 }}>
              {`Avtalets mål ${fmt(contractTarget)}`}
            </text>
          )}
          {internalTarget != null && (
            <text data-target-label="internal" x={labelX(internalTarget, `Internt mål ${fmt(internalTarget)}`)} y={contractTarget != null ? fs + 1 + tl : fs + 1} textAnchor="middle" style={{ fill: "var(--color-antracit)", fontWeight: 700 }}>
              {`Internt mål ${fmt(internalTarget)}`}
            </text>
          )}
        </Chart>
      </div>
      {targets.length > 0 && (
        <div className={cn("flex flex-wrap gap-x-[18px] gap-y-1.5 text-meta text-text-muted", large && "text-portal")}>
          {contractTarget != null && (
            <span className="inline-flex items-center gap-1.5">
              <TargetSwatch kind="contract" />
              Avtalets mål
            </span>
          )}
          {internalTarget != null && (
            <span className="inline-flex items-center gap-1.5">
              <TargetSwatch kind="internal" />
              Internt mål
            </span>
          )}
        </div>
      )}
    </div>
  );
}
