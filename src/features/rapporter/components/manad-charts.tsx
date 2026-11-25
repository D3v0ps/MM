"use client";
// Diagrammen i den interna månadsrapporten (sidan). PDF:en ritar samma geometri med react-pdf (pdf/manad-doc.tsx).
//   FlowChart – startade (antracit, till höger) och avslutade (blått, till vänster) insatser per yrkesområde kring nollan.
//   OverviewBarChart – liggande staplar med en serie (BarChart i src/ui) av vy-modellens BarChartSpec.
// Varje diagram har ett tillgängligt namn med alla värden, serierna namngivna i text i diagrammet (aldrig bara färg) och en tabell med
// samma tal bredvid sig (skärmen). Värdena står vid staplarna med vit kant; blått bär aldrig text. Tooltip per stapel (title).
import { useEffect, useRef, useState } from "react";
import { BarChart, Chart } from "@/ui";
import type { BarChartSpec, FlowChartSpec } from "../api";
import { barPath, flowLayout } from "../manad/charts";

/** Behållarens bredd – diagrammet ritas i verkliga pixlar, så att texten är läsbar också på mobil. */
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

/** Vit kant runt texten, så att en stapel eller linje aldrig skär igenom siffrorna. */
const HALO = { paintOrder: "stroke", stroke: "var(--color-vit)", strokeWidth: 4, strokeLinejoin: "round" } as const;

export function FlowChart({ spec }: { spec: FlowChartSpec }) {
  const [ref, W] = useWidth(640);
  const narrow = W < 520;
  const fs = 12;
  const g = flowLayout(spec.rows, { width: W, fontSize: fs, rowH: 30, barH: 16, labelW: narrow ? 104 : Math.min(250, Math.round(W * 0.32)), valueW: 30 });
  // Behållaren ritas alltid, så att bredden mäts också när den första visningen saknar rader. Serierna namnges av rubrikerna
  // Avslutade och Startade ovanför nollan – ingen separat förklaring.
  return (
    <div className="flex flex-col gap-2.5" data-chart="flow">
      <div ref={ref} className="w-full">
        {spec.rows.length > 0 && (
          <Chart viewBox={`0 0 ${W} ${g.height}`} width={W} height={g.height} aria-label={spec.ariaLabel} className="w-auto max-w-full">
            <text x={g.cx - 8} y={fs} textAnchor="end" style={{ fontWeight: 700 }}>
              Avslutade
            </text>
            <text x={g.cx + 8} y={fs} textAnchor="start" style={{ fontWeight: 700 }}>
              Startade
            </text>
            {g.rows.map((r, i) => (
              <g key={spec.rows[i].key} data-row={spec.rows[i].key}>
                <text x={g.labelW} y={r.cy + 4} textAnchor="end" style={{ fontWeight: 600 }}>
                  <title>{spec.rows[i].label}</title>
                  {r.label}
                </text>
                {r.endedW > 0 && (
                  <path data-bar="ended" d={barPath(g.cx - 1, r.y, r.endedW, 16, -1)} style={{ fill: "var(--color-bla)" }}>
                    <title>{`${spec.rows[i].label}: ${r.ended} avslutade`}</title>
                  </path>
                )}
                {r.startedW > 0 && (
                  <path data-bar="started" d={barPath(g.cx + 1, r.y, r.startedW, 16, 1)} style={{ fill: "var(--color-antracit)" }}>
                    <title>{`${spec.rows[i].label}: ${r.started} startade`}</title>
                  </path>
                )}
                <text data-value="ended" x={g.cx - 1 - r.endedW - 6} y={r.cy + 4} textAnchor="end" style={{ fontWeight: 700, ...HALO }}>
                  {r.ended}
                </text>
                <text data-value="started" x={g.cx + 1 + r.startedW + 6} y={r.cy + 4} textAnchor="start" style={{ fontWeight: 700, ...HALO }}>
                  {r.started}
                </text>
              </g>
            ))}
            {/* Nollan: en hårfin axel mellan serierna. */}
            <line className="axis" x1={g.cx} x2={g.cx} y1={g.top - 4} y2={g.bottom} />
          </Chart>
        )}
      </div>
    </div>
  );
}

/** Liggande staplar med en serie (kitets BarChart): mållinjerna ur vy-modellen, avtalets mål rött och det interna antracit. */
export function OverviewBarChart({ spec }: { spec: BarChartSpec }) {
  if (!spec.bars.length) return null;
  const contract = spec.targets.find((t) => t.kind === "contract")?.value ?? null;
  const internal = spec.targets.find((t) => t.kind === "internal")?.value ?? null;
  return (
    <div data-chart="bar">
      <BarChart title={spec.title} unit={spec.unit} bars={spec.bars.map((b) => ({ label: b.label, value: b.value }))} contractTarget={contract} internalTarget={internal} />
    </div>
  );
}
