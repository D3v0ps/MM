"use client";
// Delade delar för ledningsvyn och registret över avtalsavvikelser (prototypens hjälpkomponenter i views/ledning.js):
// stapel med målmarkeringar, flaggrad, kvitteringsdialog, trenddiagram, eskaleringstrappa och statusmärken.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { pct, plural } from "@/core/format";
import { MONTHS_SHORT, fmtDateTime, monthName } from "@/core/time";
import { useCommand } from "@/shell/backend";
import { DemoOnly } from "@/shell/runtime";
import {
  Badge, Button, Card, CaseLink, Chart, Empty, Field, Icon, Modal, ModalCancelButton, PerspectiveLink, Row, Stack, Table, TextArea, UserName, cn, useToast, type BadgeTone, type IconName,
} from "@/ui";
import { alertAck, CD_STATUS_LABEL, type AlertView, type CdStatusKey, type LadderStep, type LedningOverview, type TrendRow } from "../api";

export const pct0 = (v: number | null | undefined) => pct(v, 0);

// ---------------------------------------------------------------- Statusmärken
export const RR_STATUS: Record<string, { tone: BadgeTone; icon: IconName; label: string }> = {
  ok: { tone: "blue", icon: "check-circle", label: "Över internt mål" },
  below_internal: { tone: "grey", icon: "alert-circle", label: "Bevaka – under internt mål" },
  below_contract: { tone: "red", icon: "alert", label: "Åtgärd krävs – under avtalsmålet" },
  insufficient: { tone: "outline", icon: "minus-circle", label: "För litet underlag" },
};
const RR_SHORT: Record<string, string> = { ok: "Över internt mål", below_internal: "Bevaka", below_contract: "Åtgärd krävs", insufficient: "Litet underlag" };
/** "ok" utan internt mål (begränsade testare ser inte det interna målet): resultatgraden når avtalsmålet. */
const RR_OK_NO_INTERNAL = "Når avtalsmålet";
export function RrBadge({ status, short, noInternal }: { status: string; short?: boolean; noInternal?: boolean }) {
  const s = RR_STATUS[status] ?? RR_STATUS.insufficient;
  const label = noInternal && status === "ok" ? RR_OK_NO_INTERNAL : s.label;
  const shortLabel = noInternal && status === "ok" ? RR_OK_NO_INTERNAL : RR_SHORT[status] ?? s.label;
  return (
    <Badge tone={s.tone} icon={s.icon} title={short ? label : undefined}>
      {short ? shortLabel : label}
    </Badge>
  );
}
export const KPI_STATUS: Record<string, { tone: BadgeTone; icon: IconName; label: string }> = {
  ok: { tone: "blue", icon: "check-circle", label: "Når målet" },
  below_internal: { tone: "grey", icon: "alert-circle", label: "Under målet" },
  below_contract: { tone: "red", icon: "alert", label: "Under avtalsmålet" },
  no_target: { tone: "outline", icon: "minus-circle", label: "Mål ej fastställt" },
  no_data: { tone: "outline", icon: "minus-circle", label: "Inget underlag" },
  // Begränsade testare: KPI:n har bara Miljonbemannings interna mål, som inte visas.
  target_hidden: { tone: "outline", icon: "minus-circle", label: "Mål visas inte för testare" },
  insufficient: { tone: "outline", icon: "minus-circle", label: "För litet underlag" },
};
export function KpiStatusBadge({ status }: { status: string }) {
  const s = KPI_STATUS[status] ?? KPI_STATUS.no_data;
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}
const SEVERITY: Record<string, { tone: BadgeTone; icon: IconName; label: string }> = {
  critical: { tone: "red", icon: "alert", label: "Kritisk" },
  warning: { tone: "grey", icon: "alert-circle", label: "Bevaka" },
  info: { tone: "outline", icon: "info", label: "Information" },
};
const CD_STATUS_STYLE: Record<CdStatusKey, { tone: BadgeTone; icon: IconName }> = {
  closed: { tone: "blue", icon: "check-circle" },
  no_plan: { tone: "red", icon: "alert" },
  waiting: { tone: "grey", icon: "clock" },
  in_progress: { tone: "bluetone", icon: "activity" },
};
export function CdStatusBadge({ status }: { status: CdStatusKey }) {
  const s = CD_STATUS_STYLE[status];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {CD_STATUS_LABEL[status]}
    </Badge>
  );
}

// ---------------------------------------------------------------- Layout
/** Rutnät för nyckeltal (prototypens ldg-tiles: minst 210 px per ruta). */
export function Tiles({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,210px),1fr))] gap-4 max-[620px]:grid-cols-2 max-[620px]:gap-2.5">{children}</div>;
}
/** Stort tal (prototypens ldg-big). */
export function Big({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-[2.25rem] leading-[1.05] font-extrabold tabular-nums", className)}>{children}</span>;
}
/** Versal etikett (prototypens label-caps). */
export function Caps({ children, as: As = "span" }: { children: ReactNode; as?: "span" | "h3" }) {
  return <As className="text-label font-bold tracking-[0.09em] text-text-muted uppercase">{children}</As>;
}
/** Knapp som får radbrytas i smala kort (prototypens ldg-wrapbtn). */
export function WrapBtn({ children }: { children: ReactNode }) {
  return <span className="inline-flex max-w-full min-w-0 [&>a]:text-left [&>a]:whitespace-normal [&>button]:text-left [&>button]:whitespace-normal">{children}</span>;
}
/** Utfällbart avsnitt med pilmarkering (prototypens details.ldg-details). */
export function Details({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="-mx-1.5 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-mb px-1.5 font-bold underline underline-offset-3 hover:bg-antracit-ton [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-flex transition-transform duration-150 group-open:rotate-180" data-chevron="">
          <Icon name="chevron-down" />
        </span>
        {summary}
      </summary>
      {children}
    </details>
  );
}

// ---------------------------------------------------------------- Stapel med målmarkeringar
export type BarMarker = { value: number; label: string; tone?: "red" | "dark" };
/** Liten stapel med målmarkeringar (ingen förklaringsrad – används i tabeller). */
export function MiniBar({ value, max = 1, markers = [], tone, label }: { value: number | null; max?: number; markers?: BarMarker[]; tone?: "blue"; label: string }) {
  const w = Math.max(0, Math.min(100, ((value || 0) / max) * 100));
  return (
    <div role="img" aria-label={label} className="relative h-2.5 min-w-14 rounded-full bg-ljusgra-ton2">
      <div className={cn("absolute inset-y-0 left-0 rounded-full", tone === "blue" ? "bg-bla" : "bg-antracit")} style={{ width: `${w}%` }} />
      {markers.map((m) => (
        <div
          key={`${m.label}-${m.value}`}
          title={m.label}
          className={cn("absolute -top-1 -bottom-1 w-0.5", m.tone === "red" ? "bg-rod" : "bg-antracit")}
          style={{ left: `calc(${(m.value / max) * 100}% - 1px)` }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Flaggor
const ACK_SUGGESTIONS: Record<string, string> = {
  kpi: "Genomgång av ärenden i fas 5 och med arbetserbjudande tillsammans med coacherna på torsdag. Uppföljning om två veckor.",
  no_progress_escalated: "Avstämning med coachen denna vecka. Nytt veckomål och plan för nästa steg. Följs upp nästa måndag.",
  report_overdue: "Samordnaren ser till att rapporten levereras i dag. Påminnelserutinen gås igenom på nästa APT.",
  unbilled: "Ekonomen fakturerar om med rätt beställarreferens denna vecka. Kontroll av referenser före varje körning.",
  pulse_low: "Samordnaren kontaktar deltagaren. Stödet från coachen tas upp i nästa coachsamtal.",
  default: "Ansvarig är utsedd. Följs upp på nästa ledningsmöte.",
};
export type AckTarget = Pick<AlertView, "key" | "kind" | "title" | "text">;

/** Kvittera flagga med kort åtgärdsplan (prototypens AckModal). */
export function AckModal({ alert, onClose }: { alert: AckTarget; onClose: () => void }) {
  const [plan, setPlan] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const ack = useCommand(alertAck);
  const toast = useToast();
  const suggestion = ACK_SUGGESTIONS[alert.kind] ?? ACK_SUGGESTIONS.default;
  // Efter kvitteringen försvinner knappen Kvittera: fokus till nästa flagga i listan (annars föregående, annars sidans rubrik).
  const after = useRef<HTMLElement | null>(null);
  const save = async () => {
    if (plan.trim().length < 5) {
      setErr("Skriv en kort åtgärdsplan: vad görs, av vem och när.");
      return;
    }
    const res = await ack.run({ key: alert.key, plan: plan.trim() });
    if (!res.ok) {
      toast(res.message ?? "Flaggan kunde inte kvitteras.", "error");
      return;
    }
    toast("Flaggan är kvitterad. Åtgärdsplanen är sparad i revisionsloggen.");
    const row = document.querySelector<HTMLElement>(`[data-alert="${CSS.escape(alert.key)}"]`);
    const sib = (el: Element | null | undefined, dir: "next" | "prev"): HTMLElement | null => {
      let x = dir === "next" ? el?.nextElementSibling : el?.previousElementSibling;
      while (x && !x.hasAttribute("data-alert")) x = dir === "next" ? x.nextElementSibling : x.previousElementSibling;
      return (x as HTMLElement | null) ?? null;
    };
    after.current = sib(row, "next") ?? sib(row, "prev") ?? document.querySelector<HTMLElement>("#main h1[data-page-title]");
    onClose();
  };
  return (
    <Modal
      title="Kvittera flagga"
      onClose={onClose}
      dirty={!!plan.trim()}
      returnFocusTo={() => after.current}
      footer={
        <>
          <ModalCancelButton />
          <Button kind="primary" icon="check" pending={ack.pending} onClick={() => void save()}>
            Kvittera med åtgärdsplan
          </Button>
        </>
      }
    >
      <Stack gap="sm">
        <div className="font-bold">{alert.title}</div>
        <div className="text-text-muted">{alert.text}</div>
      </Stack>
      <Field
        label="Kort åtgärdsplan"
        id="ldg-ack-plan"
        required
        error={err}
        help="Vad görs, av vem och när? Planen sparas med ditt namn och tidpunkt. Flaggan försvinner från listan men finns kvar under Kvitterade flaggor."
      >
        <TextArea
          value={plan}
          rows={3}
          onValueChange={(v) => {
            setPlan(v);
            setErr(null);
          }}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-small text-text-muted">Förslag:</span>
        <Button
          kind="ghost"
          className="justify-start text-left whitespace-normal"
          onClick={() => {
            setPlan(suggestion);
            setErr(null);
          }}
        >
          {suggestion}
        </Button>
      </div>
    </Modal>
  );
}

/** En flagga med allvarlighet, tid, text, kvittering och länk (prototypens AlertRow). */
export function AlertRow({ a, onAck }: { a: AlertView; onAck?: (a: AlertView) => void }) {
  const sv = SEVERITY[a.severity] ?? SEVERITY.info;
  const canAck = !a.ack && !!onAck;
  return (
    <div tabIndex={-1} className="grid grid-cols-[24px_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 border-t border-ljusgra py-3 first:border-t-0 first:pt-0" data-alert={a.key}>
      <Icon name={sv.icon} size="lg" className={a.severity === "critical" ? "text-rod" : undefined} />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={sv.tone}>{sv.label}</Badge>
          <span className="text-small text-text-muted">{fmtDateTime(a.createdAt)}</span>
        </div>
        <div className="font-bold">{a.title}</div>
        <div>{a.text}</div>
        {a.ack && (
          <div className="text-small text-text-muted">
            <Icon name="check" /> Kvitterad av {a.ack.byName} {fmtDateTime(a.ack.at)}: {a.ack.plan}
          </div>
        )}
      </div>
      {(a.link || canAck) && (
        <div className="col-start-2 flex flex-wrap gap-1.5">
          {canAck && (
            <Button icon="check" onClick={() => onAck?.(a)}>
              Kvittera
            </Button>
          )}
          {a.link && (
            <Button kind="ghost" iconRight="arrow-right" to={a.link.href}>
              {a.link.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Trenddiagram
/** Bredd på en behållare – diagrammet ritas i verkliga pixlar så att etiketterna blir läsbara även på mobil. */
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

function Swatch({ kind }: { kind: "bar" | "small" | "line" | "contract" | "internal" }) {
  const cls = {
    bar: "size-3 rounded-[2px] bg-bla",
    small: "size-3 rounded-[2px] border-[1.5px] border-dashed border-bla bg-bla-ton2",
    line: "h-[3px] w-[18px] rounded-[2px] bg-antracit",
    contract: "h-0 w-5 border-t-2 border-dashed border-rod",
    internal: "h-0 w-5 border-t-2 border-dotted border-antracit",
  }[kind];
  return <span aria-hidden="true" className={cn("inline-block flex-none", cls)} />;
}

/** Resultatgrad per månad sedan avtalsstart med kumulativ linje och målen (prototypens TrendChart). */
export function TrendChart({ rows, contract, internal, minN }: { rows: TrendRow[]; contract: number | null; internal: number | null; minN: number }) {
  const [ref, W] = useWidth(640);
  const narrow = W < 480;
  const H = narrow ? 250 : 290;
  const m = { l: 44, r: 12, t: 26, b: 50 };
  const pw = Math.max(120, W - m.l - m.r);
  const ph = H - m.t - m.b;
  const vals = rows.flatMap((r) => [r.value, r.cumulative]).filter((v): v is number => v != null);
  const yMax = Math.min(1, Math.max(0.5, Math.ceil((Math.max(internal ?? 0, contract ?? 0, ...vals) + 0.04) * 10) / 10));
  const y = (v: number) => m.t + ph - (v / yMax) * ph;
  const n = Math.max(1, rows.length);
  const slot = pw / n;
  const bw = Math.min(58, slot * 0.58);
  const x = (i: number) => m.l + slot * i + slot / 2;
  const ticks: number[] = [];
  for (let t = 0; t <= yMax + 1e-9; t += 0.1) ticks.push(Math.round(t * 10) / 10);
  const cumPts = rows.map((r, i) => (r.cumulative != null ? [x(i), y(r.cumulative)] : null)).filter((p): p is number[] => !!p);
  const monthLbl = (mk: string, i: number) => {
    const [yy, mm] = mk.split("-");
    return `${MONTHS_SHORT[Number(mm) - 1]}${i === 0 || mm === "01" ? ` ${yy}` : ""}`;
  };
  const last = rows.filter((r) => r.cumulative != null).slice(-1)[0];
  const aria = `Resultatgrad per månad sedan avtalsstart. ${rows.map((r) => `${monthName(r.month)}: ${r.value == null ? "inga avslut" : `${pct0(r.value)} av ${r.den} avslut`}`).join(". ")}. Kumulativt sedan start ${last ? pct(last.cumulative) : "–"}. Avtalsmål ${pct0(contract)}${internal != null ? `, internt mål ${pct0(internal)}` : ""}.`;
  return (
    <Stack gap="sm" className="gap-2.5">
      <div ref={ref} className="w-full">
        <Chart viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-label={aria} className="w-auto max-w-full">
          {ticks.map((t) => (
            <g key={`t${t}`}>
              <line className={t === 0 ? "axis" : "grid-line"} x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} />
              <text x={m.l - 8} y={y(t) + 4} textAnchor="end" style={{ fill: "var(--color-text-muted)" }}>
                {Math.round(t * 100)} %
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            if (r.value == null) {
              return (
                <text key={`e${i}`} x={x(i)} y={y(0) - 8} textAnchor="middle" style={{ fill: "var(--color-text-muted)", fontSize: 12 }}>
                  inga avslut
                </text>
              );
            }
            const small = r.den < minN;
            const top = y(r.value);
            const hgt = Math.max(1, y(0) - top);
            const cum = r.cumulative != null ? y(r.cumulative) : null;
            const inside = cum != null && cum < top && top - cum < 26 && hgt > 22;
            return (
              <g key={`b${i}`}>
                <rect
                  x={x(i) - bw / 2}
                  y={top}
                  width={bw}
                  height={hgt}
                  rx={2}
                  style={small ? { fill: "var(--color-bla-ton2)", stroke: "var(--color-bla)", strokeWidth: 1.5, strokeDasharray: "4 3" } : { fill: "var(--color-bla)" }}
                >
                  <title>
                    {`${monthName(r.month)}: ${pct(r.value)} (${r.num} av ${r.den} avslut)${small ? " – litet underlag" : ""}`}
                  </title>
                </rect>
                <text x={x(i)} y={inside ? top + 16 : top - 7} textAnchor="middle" style={{ fontWeight: 700 }}>
                  {pct0(r.value)}
                </text>
              </g>
            );
          })}
          {internal != null && <line x1={m.l} x2={W - m.r} y1={y(internal)} y2={y(internal)} style={{ stroke: "var(--color-antracit)", strokeWidth: 2, strokeDasharray: "2 3" }} />}
          {contract != null && <line x1={m.l} x2={W - m.r} y1={y(contract)} y2={y(contract)} style={{ stroke: "var(--color-rod)", strokeWidth: 2, strokeDasharray: "7 4" }} />}
          {cumPts.length > 1 && (
            <polyline points={cumPts.map((p) => p.join(",")).join(" ")} style={{ fill: "none", stroke: "var(--color-antracit)", strokeWidth: 2.5, strokeLinejoin: "round" }} />
          )}
          {rows.map((r, i) =>
            r.cumulative != null ? (
              <circle key={`c${i}`} cx={x(i)} cy={y(r.cumulative)} r={4.5} style={{ fill: "var(--color-vit)", stroke: "var(--color-antracit)", strokeWidth: 2.5 }}>
                <title>{`Kumulativt t.o.m. ${monthName(r.month)}: ${pct(r.cumulative)} (${r.cumulativeN} avslut)`}</title>
              </circle>
            ) : null,
          )}
          {rows.map((r, i) => (
            <g key={`l${i}`}>
              <text x={x(i)} y={y(0) + 19} textAnchor="middle" style={{ fontWeight: 600 }}>
                {monthLbl(r.month, i)}
              </text>
              <text x={x(i)} y={y(0) + 36} textAnchor="middle" style={{ fill: "var(--color-text-muted)", fontSize: 12 }}>
                {`n = ${r.den > 0 ? r.den : 0}`}
              </text>
            </g>
          ))}
        </Chart>
      </div>
      <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-small text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Swatch kind="bar" />
          Resultatgrad per månad
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Swatch kind="small" />
          Litet underlag (färre än {minN} avslut)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Swatch kind="line" />
          Kumulativt sedan start{last ? ` (${pct(last.cumulative)})` : ""}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Swatch kind="contract" />
          Avtalsmål {pct0(contract)}
        </span>
        {internal != null && (
          <span className="inline-flex items-center gap-1.5">
            <Swatch kind="internal" />
            Internt mål {pct0(internal)}
          </span>
        )}
      </div>
      <Details summary="Visa siffrorna som tabell">
        <Table
          rowKey="month"
          caption="Resultatgrad per månad"
          rows={rows}
          columns={[
            { key: "month", label: "Månad", render: (r) => monthName(r.month) },
            {
              key: "value",
              label: "Resultatgrad",
              num: true,
              render: (r) => (
                <>
                  <span className="font-bold">{r.value == null ? "–" : pct(r.value)}</span>
                  <div className="text-small whitespace-nowrap text-text-muted">
                    {r.num} av {r.den} avslut
                  </div>
                </>
              ),
            },
            { key: "ex", label: "Räknas inte", num: true, render: (r) => r.excluded },
            {
              key: "cum",
              label: "Kumulativt",
              num: true,
              render: (r) =>
                r.cumulative == null ? (
                  "–"
                ) : (
                  <>
                    {pct(r.cumulative)}
                    <div className="text-small whitespace-nowrap text-text-muted">{r.cumulativeN} avslut</div>
                  </>
                ),
            },
          ]}
        />
      </Details>
    </Stack>
  );
}

// ---------------------------------------------------------------- Eskaleringstrappan
/** Texten efter tankstrecket ("Mindre avvikelse – påverkar inte …" → "Påverkar inte …"). */
const shortStepText = (t: string) => {
  const i = t.indexOf(" – ");
  const x = i > 0 ? t.slice(i + 3) : t;
  return x.charAt(0).toUpperCase() + x.slice(1);
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Trappan som steg (prototypens Ladder). counts = öppna per steg (registret); vertical = detaljvyn. */
export function Ladder({ ladder, current = null, counts = null, vertical }: { ladder: LadderStep[]; current?: number | null; counts?: Record<number, number> | null; vertical?: boolean }) {
  return (
    <ol aria-label="Eskaleringstrappan" className={cn("m-0 grid list-none items-stretch gap-2 p-0", vertical ? "grid-cols-1" : "grid-cols-5 max-[760px]:grid-cols-1")}>
      {ladder.map((s) => {
        const cur = current === s.step;
        const n = counts ? counts[s.step] || 0 : 0;
        const end = s.step === ladder.length - 1;
        return (
          <li
            key={s.step}
            aria-current={cur ? "step" : undefined}
            style={vertical ? undefined : { marginTop: `${(ladder.length - 1 - s.step) * 18}px` }}
            className={cn(
              "flex min-w-0 flex-col gap-1 rounded-mb border-[1.5px] border-line-strong bg-vit px-2.5 pt-2.5 pb-3 text-small max-[760px]:!mt-0",
              cur && "border-antracit bg-antracit text-vit",
              // Röd ram bara när en avvikelse faktiskt ligger på hävningssteget – annars samma grå ram som övriga steg.
              cur && end && "border-2 border-rod",
              cur && end && "shadow-[inset_0_0_0_2px_var(--color-rod)]",
            )}
          >
            <span className="text-label font-extrabold tracking-[0.08em] uppercase">Steg {s.step}</span>
            <span className="text-ui font-extrabold">{cap(s.level)}</span>
            {(!vertical || cur) && <span className={cn("text-small", cur ? "text-vit/85" : "text-text-muted")}>{shortStepText(s.text)}</span>}
            {counts && <span className="mt-auto text-small font-bold">{n > 0 ? `${n} ${n === 1 ? "öppen" : "öppna"}` : "Inga öppna"}</span>}
            {cur && !counts && <span className="mt-auto text-small font-bold">Här ligger avvikelsen</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Tidig uppmärksamhet per coach (ledningsvyn och chefens Min vecka). */
export function EarlyCard({ d, onAck }: { d: LedningOverview; onAck: (a: AckTarget) => void }) {
  return (
    <Card
      title="Tidig uppmärksamhet"
      icon="bell"
      actions={
        // Konturmärke med röd ikon: sidans röda ämne är flaggorna (Min veckas stil, beslut 2026-10-06).
        <Badge tone="outline" icon={d.escalatedCount ? "alert" : undefined} className={d.escalatedCount ? "[&_svg]:text-rod" : undefined}>
          {d.escalatedCount} ärenden
        </Badge>
      }
    >
      <Stack>
        <p>
          Ärenden med {d.escalateAfterWeeks} veckor eller fler i rad utan progression, per coach. <b>Coachen har fått påminnelser men ser inte att ärendet har eskalerats till dig.</b>
        </p>
        {d.early.length === 0 ? (
          <Empty icon="check-circle" title="Inga eskaleringar">
            Alla ärenden har progression eller bara en vecka utan.
          </Empty>
        ) : (
          d.early.map((g) => (
            <div key={g.coachId} className="flex min-w-0 flex-col gap-2.5 rounded-mb border border-ljusgra px-3.5 py-3">
              <Row between>
                <UserName name={g.coachName} />
                <span className="text-small text-text-muted">{plural(g.reminders, "påminnelse", "påminnelser")} till coachen denna vecka</span>
              </Row>
              {g.cases.map((w) => (
                <div key={w.caseId} className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-ljusgra pt-2.5 first-of-type:border-t-0 first-of-type:pt-0" data-early-case={w.caseId}>
                  <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5">
                    <Row gap="sm">
                      <CaseLink caseId={w.caseId} caseNumber={w.caseNumber} />
                      <span>{w.name}</span>
                      <Badge tone="outline" icon="alert" className="[&_svg]:text-rod">
                        {w.streak} veckor i rad
                      </Badge>
                    </Row>
                    <Row gap="sm">
                      {w.weeks.map((x) => (
                        <Badge tone="outline" key={x.key}>
                          {x.label}: {x.reason}
                        </Badge>
                      ))}
                    </Row>
                    <div className="text-text-muted">Coachen har fått {plural(w.streak, "påminnelse", "påminnelser")} (en per vecka), men ingen notis om eskaleringen.</div>
                    {w.ack && (
                      <div className="text-small">
                        <Icon name="check" /> Kvitterad av {w.ack.byName} {fmtDateTime(w.ack.at)}: {w.ack.plan}
                      </div>
                    )}
                  </div>
                  {!w.ack && (
                    <Button icon="check" onClick={() => onAck(w.alert)}>
                      Kvittera
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
        <DemoOnly>
          <div>
            <WrapBtn>
              <PerspectiveLink role="coach" to="/notiser" label="Se vad coachen Amira får (bara påminnelser)" />
            </WrapBtn>
          </div>
        </DemoOnly>
      </Stack>
    </Card>
  );
}
