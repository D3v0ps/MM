// PDF för den interna månadsrapporten (Karims beslut 2026-11-18) – samma vy-modell, samma avsnitt, tabeller och siffror som sidan
// (/manadsrapport). MB:s profil: logotypen överst, avtalet och perioden i det högerställda blocket, rubriker i versaler.
// Diagrammen ritas med react-pdf:s Svg (Path, Line, Text) av samma geometri som sidan (manad/charts.ts): antracit för den första
// serien, blått för den andra med värdet utskrivet vid stapeln, avtalets mål som röd streckad linje och det interna som antracit
// prickad. Montserrat är inbäddat (registerPdfFonts) – texten i Svg får typsnittet uttryckligen (ärver det inte från sidan).
// Byggs i webbläsaren efter att rapporter.manadsrapportPdf har loggat nedladdningen (samma mönster som rapporternas PDF):
//   const { renderOverviewPdf } = await import("../pdf/manad-doc");
import { G, Line, Path, pdf, Svg, Text, View } from "@react-pdf/renderer";
import type { SVGPresentationAttributes } from "@react-pdf/types";
import type { ReactNode } from "react";
import { pct } from "@/core/format";
import type { MonthlyOverviewView, ParticipantSort } from "../api";
import { barPath, flowLayout, hbarLayout } from "../manad/charts";
import { sortParticipants, type BarChartSpec, type FlowChartSpec, type LevelRow, type RateView } from "../manad/model";
import { dtFull } from "../report-helpers";
import { Kv, PdfDocument, Sec, Small, Stack2, Table, type Col } from "./primitives";
import { PDF_COLOR, PDF_FONT, PDF_SIZE, registerPdfFonts } from "./theme";

export type OverviewPdfModel = Extract<MonthlyOverviewView, { allowed: true }>;

const C = PDF_COLOR;
/** Innehållets bredd på en A4 (595 pt minus sidmarginalerna 2 × 44 pt). */
const CONTENT_W = 507;
const FS = 7.5;
const TITLE = "Intern månadsrapport";
/**
 * Stilen för text i Svg: typsnittet och storleken måste anges på varje textelement (de ärvs inte från sidan). react-pdf läser
 * fontFamily, fontSize och fontWeight också i Svg, men typerna har bara presentationsattributen – därav omvandlingen.
 */
const svgText = (extra: { fontWeight?: number } = {}): SVGPresentationAttributes => ({ fontFamily: PDF_FONT, fontSize: FS, ...extra }) as unknown as SVGPresentationAttributes;

// ---------------------------------------------------------------- Diagram
function ChartTitle({ children }: { children: string }) {
  return <Text style={{ fontSize: PDF_SIZE.small, fontWeight: 700, marginBottom: 3 }}>{children}</Text>;
}
function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      <View style={{ width: 7, height: 7, borderRadius: 1.5, backgroundColor: color }} />
      <Text style={{ fontSize: PDF_SIZE.label }}>{label}</Text>
    </View>
  );
}
function TargetKey({ kind, label }: { kind: "contract" | "internal"; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      <Svg width={14} height={4} viewBox="0 0 14 4">
        <Line x1={0} y1={2} x2={14} y2={2} stroke={kind === "contract" ? C.rod : C.antracit} strokeWidth={1.5} strokeDasharray={kind === "contract" ? "4 2" : "1 2"} />
      </Svg>
      <Text style={{ fontSize: PDF_SIZE.label }}>{label}</Text>
    </View>
  );
}

/** Liggande staplar med en serie (samma som kitets BarChart på sidan). */
export function PdfBarChart({ spec }: { spec: BarChartSpec }) {
  if (!spec.bars.length) return null;
  const g = hbarLayout(spec.bars, spec.unit, spec.targets, { width: CONTENT_W, fontSize: FS, rowH: 13, barH: 8, labelW: 190, valueW: 44 });
  return (
    <View wrap={false} style={{ flexDirection: "column" }}>
      <ChartTitle>{spec.title}</ChartTitle>
      <Svg width={g.width} height={g.height} viewBox={`0 0 ${g.width} ${g.height}`}>
        <Line x1={g.x0} y1={g.top - 2} x2={g.x0} y2={g.bottom} stroke={C.ljusgra} strokeWidth={0.75} />
        {g.rows.map((r, i) => (
          <G key={spec.bars[i].key}>
            <Text x={g.labelW} y={r.cy + 2.6} textAnchor="end" fill={C.antracit} style={svgText({ fontWeight: 700 })}>
              {r.label}
            </Text>
            {r.w > 0 && <Path d={barPath(g.x0, r.y, r.w, 8, 1, 2.5)} fill={C.antracit} />}
            <Text x={r.valueX} y={r.cy + 2.6} fill={C.antracit} style={svgText({ fontWeight: 700 })}>
              {r.valueText}
            </Text>
          </G>
        ))}
        {g.targets.map((t) => (
          <G key={t.kind}>
            <Line x1={t.x} y1={g.top - 2} x2={t.x} y2={g.bottom} stroke={t.kind === "contract" ? C.rod : C.antracit} strokeWidth={1.2} strokeDasharray={t.kind === "contract" ? "4 2" : "1 2"} />
            <Text x={t.x} y={t.labelY} textAnchor="middle" fill={C.antracit} style={svgText({ fontWeight: 700 })}>
              {`${t.label} ${pct(spec.targets.find((x) => x.kind === t.kind)?.value)}`}
            </Text>
          </G>
        ))}
      </Svg>
      {spec.targets.length > 0 && (
        <View style={{ flexDirection: "row", gap: 10, marginTop: 2 }}>
          {spec.targets.map((t) => (
            <TargetKey key={t.kind} kind={t.kind} label={t.label} />
          ))}
        </View>
      )}
    </View>
  );
}

/** Startade (antracit, höger) och avslutade (blått, vänster) per yrkesområde kring nollan. */
export function PdfFlowChart({ spec }: { spec: FlowChartSpec }) {
  if (!spec.rows.length) return null;
  const g = flowLayout(spec.rows, { width: CONTENT_W, fontSize: FS, rowH: 13, barH: 8, labelW: 160, valueW: 22 });
  return (
    <View wrap={false} style={{ flexDirection: "column" }}>
      <ChartTitle>{spec.title}</ChartTitle>
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 2 }}>
        <Swatch color={C.antracit} label="Startade" />
        <Swatch color={C.bla} label="Avslutade" />
      </View>
      <Svg width={g.width} height={g.height} viewBox={`0 0 ${g.width} ${g.height}`}>
        <Text x={g.cx - 6} y={FS} textAnchor="end" fill={C.antracit} style={svgText({ fontWeight: 700 })}>
          Avslutade
        </Text>
        <Text x={g.cx + 6} y={FS} fill={C.antracit} style={svgText({ fontWeight: 700 })}>
          Startade
        </Text>
        {g.rows.map((r, i) => (
          <G key={spec.rows[i].key}>
            <Text x={g.labelW} y={r.cy + 2.6} textAnchor="end" fill={C.antracit} style={svgText({ fontWeight: 700 })}>
              {r.label}
            </Text>
            {r.endedW > 0 && <Path d={barPath(g.cx - 0.75, r.y, r.endedW, 8, -1, 2.5)} fill={C.bla} />}
            {r.startedW > 0 && <Path d={barPath(g.cx + 0.75, r.y, r.startedW, 8, 1, 2.5)} fill={C.antracit} />}
            <Text x={g.cx - 0.75 - r.endedW - 4} y={r.cy + 2.6} textAnchor="end" fill={C.antracit} style={svgText({ fontWeight: 700 })}>
              {String(r.ended)}
            </Text>
            <Text x={g.cx + 0.75 + r.startedW + 4} y={r.cy + 2.6} fill={C.antracit} style={svgText({ fontWeight: 700 })}>
              {String(r.started)}
            </Text>
          </G>
        ))}
        <Line x1={g.cx} y1={g.top - 3} x2={g.cx} y2={g.bottom} stroke={C.ljusgra} strokeWidth={0.75} />
      </Svg>
    </View>
  );
}

/** Resultatgraden: värdet, mätaren med målen och statusen i text. */
function PdfRate({ label, r }: { label: string; r: RateView }) {
  const W = 240;
  const x = (v: number) => Math.max(0, Math.min(1, v)) * W;
  return (
    <View wrap={false} style={{ flexDirection: "column", gap: 3, width: "48%" }}>
      <Text style={{ fontSize: PDF_SIZE.small, fontWeight: 700 }}>{`${label}: ${r.valueText} (${r.num} av ${r.den})`}</Text>
      <Svg width={W} height={12} viewBox={`0 0 ${W} 12`}>
        <Path d={barPath(0, 3, W, 6, 1, 3)} fill={C.ljusgraTon} />
        {r.value != null && r.value > 0 && <Path d={barPath(0, 3, x(r.value), 6, 1, 3)} fill={C.antracit} />}
        {r.contractTarget != null && <Line x1={x(r.contractTarget)} y1={0} x2={x(r.contractTarget)} y2={12} stroke={C.rod} strokeWidth={1.5} strokeDasharray="3 1.5" />}
        {r.internalTarget != null && <Line x1={x(r.internalTarget)} y1={0} x2={x(r.internalTarget)} y2={12} stroke={C.antracit} strokeWidth={1.5} strokeDasharray="1 1.5" />}
      </Svg>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {r.contractTarget != null && <TargetKey kind="contract" label={`Avtalets mål ${pct(r.contractTarget)}`} />}
        {r.internalTarget != null && <TargetKey kind="internal" label={`Internt mål ${pct(r.internalTarget)}`} />}
      </View>
      <Small>{`Status: ${r.statusText}`}</Small>
      {r.note ? <Small>{r.note}</Small> : null}
    </View>
  );
}

// ---------------------------------------------------------------- Tabeller
const cols = (spec: [string, number, boolean?][]): Col[] => spec.map(([label, width, num]) => ({ label, width, num }));
const H = ({ children }: { children: ReactNode }) => <Text style={{ fontSize: PDF_SIZE.small, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>{children}</Text>;
const Empty = ({ children }: { children: string }) => <Small muted>{children}</Small>;
/**
 * Flera rader i en tabellcell – en Text per rad. Aldrig "\n" i texten: radbrytningstecknet har ingen glyf i Montserrat, och react-pdf
 * lägger då in ett standardtypsnitt (Helvetica) i filen.
 */
const Lines = ({ xs }: { xs: string[] }) => (
  <View>
    {(xs.length ? xs : ["–"]).map((x, i) => (
      <Text key={i}>{x}</Text>
    ))}
  </View>
);
const levelCells = (r: LevelRow) => [r.label, ...r.levels.map(String), String(r.notAssessed)];
const LEVEL_COLS = (first: string) => cols([[first, 45], ["Nivå 0", 10, true], ["Nivå 1", 10, true], ["Nivå 2", 10, true], ["Nivå 3", 10, true], ["Ej bedömd", 15, true]]);
const goalAreaCells = (r: LevelRow) => [r.label, String(r.achieved), String(r.trained)];

export function OverviewPdf({ v, sort }: { v: OverviewPdfModel; sort: ParticipantSort }) {
  const p = v.progression;
  const a = v.activities;
  const r = v.results;
  const participants = sortParticipants(v.participants, sort);
  return (
    <PdfDocument
      metaTitle={`${TITLE} ${v.monthLabel} – ${v.contract.number}`}
      title={`${TITLE} ${v.monthLabel}`}
      label={v.partial ? "Månaden pågår" : null}
      info={[
        ["Avtal", `${v.contract.number}, ${v.contract.customerName}`], ["Period", v.monthLabel], ["Yrkesområde", v.area?.label ?? "Alla yrkesområden"], ["Hämtad", dtFull(v.generatedAt)],
      ]}
    >
      <Kv items={[["Deltagare", String(v.totals.participants)], ["Startade", String(v.totals.started)], ["Avslutade", String(v.totals.ended)], ["Närvarograd", v.attendance.total.rateText]]} />

      <Sec title="Start och slut per yrkesområde">
        <PdfFlowChart spec={v.flow.chart} />
        {v.flow.rows.length ? (
          <Table
            cols={cols([["Yrkesområde", 40], ["Vid månadens start", 15, true], ["Startade", 15, true], ["Avslutade", 15, true], ["Vid månadens slut", 15, true]])}
            rows={v.flow.rows.map((x) => ({ key: x.code || "saknas", cells: [x.label, String(x.atStart), String(x.started), String(x.ended), String(x.atEnd)] }))}
            foot={["Totalt", String(v.flow.total.atStart), String(v.flow.total.started), String(v.flow.total.ended), String(v.flow.total.atEnd)]}
          />
        ) : (
          <Empty>Inga deltagare i urvalet.</Empty>
        )}
        <H>Avslutade per avslutsorsak</H>
        {v.flow.endReasons.length ? (
          <Table cols={cols([["Avslutsorsak", 70], ["Avslutade", 30, true]])} rows={v.flow.endReasons.map((x) => ({ key: x.key, cells: [x.label, String(x.count)] }))} />
        ) : (
          <Empty>{`Inga avslut i ${v.monthLabel}.`}</Empty>
        )}
      </Sec>

      <Sec title="Närvarograd">
        <PdfBarChart spec={v.attendance.chart} />
        {v.attendance.byArea.length ? (
          <Table
            cols={cols([["Yrkesområde", 30], ["Tillfällen", 10, true], ["Närvarande", 10, true], ["Sena", 8, true], ["Giltig frånvaro", 10, true], ["Ogiltig frånvaro", 10, true], ["Ej registrerade", 11, true], ["Närvarograd", 11, true]])}
            rows={v.attendance.byArea.map((x) => ({ key: x.key, cells: [x.label, String(x.planned), String(x.present), String(x.late), String(x.absentValid), String(x.absentInvalid), String(x.unregistered), x.rateText] }))}
            foot={((t) => ["Totalt", String(t.planned), String(t.present), String(t.late), String(t.absentValid), String(t.absentInvalid), String(t.unregistered), t.rateText])(v.attendance.total)}
          />
        ) : (
          <Empty>Inga tillfällen i urvalet.</Empty>
        )}
      </Sec>

      <Sec title="Progression">
        <Kv
          items={[
            ["Godkända bedömningar", `${p.approved} av ${p.required}`], [p.clearLabel, `${p.clear} av ${p.approved}`], [p.anyLabel, `${p.any} av ${p.approved}`],
            ["Uppnådda delmål", String(p.achievedCount)],
          ]}
        />
        <PdfBarChart spec={p.levelChart} />
        <Table cols={LEVEL_COLS("Progressionsområde")} rows={p.areas.map((x) => ({ key: x.key, cells: levelCells(x) }))} foot={levelCells(p.total)} />
        {p.optional.length > 0 && (
          <>
            <H>Valfria områden</H>
            <Table cols={LEVEL_COLS("Valfritt område")} rows={p.optional.map((x) => ({ key: x.key, cells: levelCells(x) }))} />
          </>
        )}
        <H>Delmål</H>
        <PdfBarChart spec={p.goalChart} />
        <Table
          cols={cols([["Progressionsområde", 60], ["Uppnådda delmål", 20, true], ["Tränade delmål", 20, true]])}
          rows={[...p.areas, ...p.optional].map((x) => ({ key: x.key, cells: goalAreaCells(x) }))}
          foot={goalAreaCells(p.total)}
        />
        {p.achieved.length ? (
          <Table cols={cols([["Delmål", 45], ["Progressionsområde", 40], ["Deltagare", 15, true]])} rows={p.achieved.map((x) => ({ key: x.id, cells: [x.label, x.areaLabel, String(x.participants)] }))} />
        ) : (
          <Empty>{`Inga delmål uppnåddes i ${v.monthLabel}.`}</Empty>
        )}
      </Sec>

      <Sec title="Aktiviteter">
        <Kv items={[["Tillfällen", String(a.held)], ["Gruppaktiviteter", String(a.groupActivities)], ["Tillfällen med delmål", String(a.withGoals)], ["Tränade delmål", String(p.trainedCount)]]} />
        <PdfBarChart spec={a.chart} />
        {a.byKind.length ? (
          <Table
            cols={cols([["Typ", 30], ["Tillfällen", 13, true], ["I gruppaktiviteter", 15, true], ["Deltagare", 13, true], ["Närvarograd", 15, true], ["Delmål", 14, true]])}
            rows={a.byKind.map((x) => ({ key: x.kind, cells: [x.label, String(x.held), String(x.inGroup), String(x.participants), x.rateText, String(x.goals)] }))}
          />
        ) : (
          <Empty>{`Inga tillfällen i ${v.monthLabel}.`}</Empty>
        )}
        <H>Delmål som tillfällena tränade</H>
        {a.goals.length ? (
          <Table
            cols={cols([["Delmål", 38], ["Progressionsområde", 32], ["Tillfällen", 12, true], ["Deltagare som var med", 18, true]])}
            rows={a.goals.map((x) => ({ key: x.id, cells: [x.label, x.areaLabel, String(x.sessions ?? 0), String(x.participants)] }))}
          />
        ) : (
          <Empty>{`Inga tillfällen med delmål i ${v.monthLabel}.`}</Empty>
        )}
      </Sec>

      <Sec title="Resultat">
        <Kv items={[["Händelser", String(r.eventsTotal)], ["Verifierade händelser", String(r.verifiedTotal)], ["Avslut", String(r.closedTotal)], ["Verifierade resultat", String(r.month.num)]]} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
          <PdfRate label={`Resultatgrad ${r.month.period}`} r={r.month} />
          <PdfRate label={`Resultatgrad ${r.rolling.period}`} r={r.rolling} />
        </View>
        <H>Avslut och resultat</H>
        {r.closures.length ? (
          <Table cols={cols([["Avslut", 55], ["Antal", 20, true], ["I resultatgraden", 25]])} rows={r.closures.map((x) => ({ key: x.key, cells: [x.label, String(x.count), x.counted ? "Räknas" : "Räknas inte"] }))} />
        ) : (
          <Empty>{`Inga avslut i ${v.monthLabel}.`}</Empty>
        )}
        <H>Händelser</H>
        <PdfBarChart spec={r.chart} />
        {r.events.length ? (
          <Table
            cols={cols([["Händelse", 55], ["Antal", 15, true], ["Verifierade", 15, true], ["Deltagare", 15, true]])}
            rows={r.events.map((x) => ({ key: x.kind, cells: [x.label, String(x.count), String(x.verified), String(x.participants)] }))}
          />
        ) : (
          <Empty>{`Inga händelser i ${v.monthLabel}.`}</Empty>
        )}
        {r.steps && (
          <>
            <H>Progression och resultat</H>
            {r.steps.some((s) => s.submitted + s.approved > 0) ? (
              <Table
                cols={cols([["Steg", 50], ["Skickade till kommunen", 25, true], ["Godkända av kommunen", 25, true]])}
                rows={r.steps.map((s) => ({ key: String(s.step), cells: [s.label, String(s.submitted), String(s.approved)] }))}
              />
            ) : (
              <Empty>{`Inga steg nåddes i ${v.monthLabel}.`}</Empty>
            )}
          </>
        )}
      </Sec>

      <Sec title={`Per deltagare (${participants.length})`}>
        {participants.length ? (
          <Table
            cols={cols([["Deltagare", 14], ["Område", 9], ["Period", 12], ["Närvarograd", 12, true], ["Progression", 12], ["Delmål", 8], ["Tillfällen", 10, true], ["Resultat", 23]])}
            rows={participants.map((x) => ({
              key: x.caseId,
              cells: [
                <Stack2 key="d" main={x.name} sub={x.caseNumber} />, x.areaCode || "–", <Lines key="p" xs={[x.startText, `– ${x.endText === "Pågår" ? "pågår" : x.endText}`]} />,
                x.attendance.rate == null ? "–" : <Stack2 key="n" main={x.attendance.rateText} sub={x.attendance.detail || undefined} />, x.progression.text,
                <Lines key="g" xs={[x.goals.achieved ? `${x.goals.achieved} uppnådda` : "", x.goals.trained ? `${x.goals.trained} tränade` : ""].filter(Boolean)} />,
                x.activities.held ? <Stack2 key="a" main={String(x.activities.held)} sub={x.activities.inGroup ? `${x.activities.inGroup} i grupp` : undefined} /> : "–",
                <Lines key="r" xs={x.results} />,
              ],
            }))}
          />
        ) : (
          <Empty>Inga deltagare i urvalet.</Empty>
        )}
      </Sec>
    </PdfDocument>
  );
}

/** Rapporten som PDF (application/pdf). */
export async function renderOverviewPdf(v: OverviewPdfModel, sort: ParticipantSort): Promise<Blob> {
  registerPdfFonts();
  return pdf(<OverviewPdf v={v} sort={sort} />).toBlob();
}
