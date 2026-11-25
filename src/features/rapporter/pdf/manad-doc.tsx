// PDF för den interna månadsrapporten (Karims beslut 2026-11-18) – samma vy-modell, samma avsnitt, tabeller och siffror som sidan
// (/manadsrapport). MB:s profil: logotypen överst, avtalet och perioden i det högerställda blocket, rubriker i versaler.
// Diagrammen ritas med react-pdf:s Svg (Path, Line, Text) av samma geometri som sidan (manad/charts.ts): antracit för den första
// serien, blått för den andra med värdet utskrivet vid stapeln, avtalets mål som röd streckad linje och det interna som antracit
// prickad. Montserrat är inbäddat (registerPdfFonts) – texten i Svg får typsnittet uttryckligen (ärver det inte från sidan).
// Efter sammanställningen kommer en bilaga med en kort uppställning per deltagare (samma uppgifter som raden och dess utfällning
// på sidan). Delmålen står bara som antal och resultatgraden bara när läsaren får se den (Karims beslut 2026-11-24).
// Byggs i webbläsaren efter att rapporter.manadsrapportPdf har loggat nedladdningen (samma mönster som rapporternas PDF):
//   const { renderOverviewPdf } = await import("../pdf/manad-doc");
import { G, Line, Path, pdf, Svg, Text, View } from "@react-pdf/renderer";
import type { SVGPresentationAttributes } from "@react-pdf/types";
import type { ReactNode } from "react";
import { pct } from "@/core/format";
import type { MonthlyOverviewView, ParticipantSort } from "../api";
import { barPath, flowLayout, hbarLayout } from "../manad/charts";
import { sortParticipants, type ActivityKindRow, type BarChartSpec, type EventRow, type FlowChartSpec, type LevelRow, type ParticipantRow, type RateView } from "../manad/model";
import { dtFull } from "../report-helpers";
import { Kv, PdfDocument, Sec, Small, Stack2, StatusIcon, Table, type Col, type Rag } from "./primitives";
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


/** Startade (antracit, höger) och avslutade (blått, vänster) per yrkesområde kring nollan. Rubrikerna ovanför nollan namnger serierna. */
export function PdfFlowChart({ spec }: { spec: FlowChartSpec }) {
  if (!spec.rows.length) return null;
  const g = flowLayout(spec.rows, { width: CONTENT_W, fontSize: FS, rowH: 13, barH: 8, labelW: 160, valueW: 22 });
  return (
    <View wrap={false} style={{ flexDirection: "column" }}>
      <ChartTitle>{spec.title}</ChartTitle>
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

/** Statusens ikon som i appen: bock (når målet), utropstecken (under det interna), triangel (under avtalets), streck (för litet underlag). */
const RATE_ICON: Record<RateView["status"], Rag | null> = { ok: "green", below_internal: "yellow", below_contract: "red", insufficient: null };

/** Resultatgraden: värdet, mätaren med målen och statusen i text med ikon. */
function PdfRate({ label, r }: { label: string; r: RateView }) {
  const W = 240;
  const x = (v: number) => Math.max(0, Math.min(1, v)) * W;
  const target = (v: number, kind: "contract" | "internal") => (
    <G key={kind}>
      {/* Vit botten under linjen, så att den syns mot både spåret och stapeln. */}
      <Line x1={x(v)} y1={0} x2={x(v)} y2={12} stroke={C.vit} strokeWidth={3} />
      <Line x1={x(v)} y1={0} x2={x(v)} y2={12} stroke={kind === "contract" ? C.rod : C.antracit} strokeWidth={1.5} strokeDasharray={kind === "contract" ? "3 1.5" : "1 1.5"} />
    </G>
  );
  return (
    <View wrap={false} style={{ flexDirection: "column", gap: 3, width: "48%" }}>
      <Text style={{ fontSize: PDF_SIZE.small, fontWeight: 700 }}>{`${label}: ${r.valueText} (${r.num} av ${r.den})`}</Text>
      <Svg width={W} height={12} viewBox={`0 0 ${W} 12`}>
        <Path d={barPath(0.25, 3, W - 0.5, 6, 1, 3)} fill={C.ljusgraTon} stroke={C.ljusgra} strokeWidth={0.5} />
        {r.value != null && r.value > 0 && <Path d={barPath(0, 3, x(r.value), 6, 1, 3)} fill={C.antracit} />}
        {r.contractTarget != null && target(r.contractTarget, "contract")}
        {r.internalTarget != null && target(r.internalTarget, "internal")}
      </Svg>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {r.contractTarget != null && <TargetKey kind="contract" label={`Avtalets mål ${pct(r.contractTarget)}`} />}
        {r.internalTarget != null && <TargetKey kind="internal" label={`Internt mål ${pct(r.internalTarget)}`} />}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <StatusIcon value={RATE_ICON[r.status]} />
        <Small>{`Status: ${r.statusText}`}</Small>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- Tabeller
const cols = (spec: [string, number, boolean?][]): Col[] => spec.map(([label, width, num]) => ({ label, width, num }));
/** Underrubrik i ett avsnitt – hamnar aldrig ensam sist på en sida (diagrammet eller tabellen efter den följer med). */
const H = ({ children }: { children: ReactNode }) => (
  <Text wrap={false} minPresenceAhead={90} style={{ fontSize: PDF_SIZE.small, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>
    {children}
  </Text>
);
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
const attCells = (x: OverviewPdfModel["attendance"]["total"]) => [x.label, x.rateText, String(x.planned), String(x.present), String(x.late), String(x.absentValid), String(x.absentInvalid), String(x.unregistered)];
const kindCells = (x: ActivityKindRow) => [x.label, String(x.held), String(x.inGroup), String(x.participants), x.rateText, String(x.withGoals)];
const eventCells = (x: EventRow) => [x.label, String(x.count), String(x.verified), String(x.participants)];

// ---------------------------------------------------------------- Bilagan: en kort uppställning per deltagare
const DetailLine = ({ label, value }: { label: string; value: string }) => (
  <View style={{ flexDirection: "row", gap: 6 }}>
    <Text style={{ width: "22%", fontSize: PDF_SIZE.small, fontWeight: 700, color: C.muted }}>{label}</Text>
    <Text style={{ flex: 1, fontSize: PDF_SIZE.small, lineHeight: 1.3 }}>{value}</Text>
  </View>
);
function ParticipantBlock({ x }: { x: ParticipantRow }) {
  const a = x.attendance;
  const attendance =
    a.registered + a.unregistered > 0
      ? `${x.activities.text}. ${a.rate == null ? "Ingen registrerad närvaro" : `Närvarograd ${a.rateText} (${a.detail})`}. Närvarande ${a.present}, sena ${a.late}, giltig frånvaro ${a.absentValid}, ogiltig frånvaro ${a.absentInvalid}, ej registrerade ${a.unregistered}.`
      : "Inga tillfällen";
  return (
    <View wrap={false} style={{ flexDirection: "column", gap: 2, paddingVertical: 5, borderBottomWidth: 0.75, borderBottomColor: C.ljusgra }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
        <Text style={{ fontSize: PDF_SIZE.small, fontWeight: 800 }}>{`${x.name} · ${x.caseNumber}`}</Text>
        <Text style={{ fontSize: PDF_SIZE.small }}>{x.areaLabel}</Text>
      </View>
      {!x.restricted && (
        <>
          <DetailLine label="Period" value={x.outside ? x.periodLines.join(", ") : x.periodText} />
          <DetailLine label="Närvaro" value={attendance} />
          <DetailLine label="Progression" value={x.progression.areas.length ? `${x.progression.text}. ${x.progression.areas.map((l) => l.text).join(" · ")}` : x.progression.text} />
          {x.goals.lines.length > 0 && <DetailLine label="Delmål" value={x.goals.text} />}
          {x.steps.length > 0 && <DetailLine label="Steg" value={x.steps.join(" · ")} />}
          {x.areaChanges.length > 0 && <DetailLine label="Byte av yrkesområde" value={x.areaChanges.join(" · ")} />}
          <DetailLine label="Resultat" value={x.results.length ? x.results.join(" · ") : "–"} />
        </>
      )}
    </View>
  );
}

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
          <Table cols={cols([["Avslutsorsak", 70], ["Avslutade", 30, true]])} rows={v.flow.endReasons.map((x) => ({ key: x.key, cells: [x.label, String(x.count)] }))} foot={["Totalt", String(v.flow.total.ended)]} />
        ) : (
          <Empty>{`Inga avslut i ${v.monthLabel}.`}</Empty>
        )}
      </Sec>

      <Sec title="Närvarograd">
        <PdfBarChart spec={v.attendance.chart} />
        {v.attendance.byArea.length ? (
          <Table
            cols={cols([["Yrkesområde", 22], ["Närvarograd", 14, true], ["Tillfällen", 10, true], ["Närvarande", 12, true], ["Sena", 7, true], ["Giltig frånvaro", 11, true], ["Ogiltig frånvaro", 11, true], ["Ej registrerade", 13, true]])}
            rows={v.attendance.byArea.map((x) => ({ key: x.key, cells: attCells(x) }))}
            foot={attCells(v.attendance.total)}
          />
        ) : (
          <Empty>Inga tillfällen i urvalet.</Empty>
        )}
      </Sec>

      <Sec title="Progression">
        <Kv
          items={[
            ["Godkända bedömningar", `${p.approved} av ${p.required}`], [p.clearLabel, `${p.clear} av ${p.approved}`], [p.anyLabel, `${p.any} av ${p.approved}`],
            ["Deltagarnas uppnådda delmål", String(p.achievedCount)],
          ]}
        />
        <H>Nivåer per progressionsområde</H>
        <PdfBarChart spec={p.levelChart} />
        <Table cols={LEVEL_COLS("Progressionsområde")} rows={p.areas.map((x) => ({ key: x.key, cells: levelCells(x) }))} foot={levelCells(p.total)} />
        {p.optional.length > 0 && (
          <>
            <H>Valfria områden</H>
            <Table cols={LEVEL_COLS("Valfritt område")} rows={p.optional.map((x) => ({ key: x.key, cells: levelCells(x) }))} />
          </>
        )}
        <H>Uppnådda delmål per progressionsområde</H>
        <PdfBarChart spec={p.goalChart} />
        <Table
          cols={cols([["Progressionsområde", 60], ["Uppnådda delmål", 20, true], ["Tränade delmål", 20, true]])}
          rows={[...p.areas, ...p.optional].map((x) => ({ key: x.key, cells: goalAreaCells(x) }))}
          foot={goalAreaCells(p.total)}
        />
      </Sec>

      <Sec title="Aktiviteter">
        <Kv items={[["Tillfällen", String(a.held)], ["Gruppaktiviteter", String(a.groupActivities)], ["Tillfällen med delmål", String(a.withGoals)], ["Deltagarnas tränade delmål", String(p.trainedCount)]]} />
        <H>Tillfällen per typ</H>
        <PdfBarChart spec={a.chart} />
        {a.byKind.length ? (
          <Table
            cols={cols([["Typ", 28], ["Tillfällen", 14, true], ["I grupp", 12, true], ["Deltagare", 14, true], ["Närvarograd", 16, true], ["Med delmål", 16, true]])}
            rows={a.byKind.map((x) => ({ key: x.key, cells: kindCells(x) }))}
            foot={kindCells(a.byKindTotal)}
          />
        ) : (
          <Empty>{`Inga tillfällen i ${v.monthLabel}.`}</Empty>
        )}
        <H>Delmål per progressionsområde</H>
        {a.goalAreas.length ? (
          <Table
            cols={cols([["Progressionsområde", 40], ["Tillfällen med delmål", 20, true], ["Deltagare som var med", 20, true], ["Tränade delmål", 20, true]])}
            rows={a.goalAreas.map((x) => ({ key: x.key, cells: [x.label, String(x.sessions), String(x.participants), String(x.trained)] }))}
          />
        ) : (
          <Empty>{`Inga tillfällen med delmål i ${v.monthLabel}.`}</Empty>
        )}
      </Sec>

      <Sec title="Resultat">
        <Kv items={[["Händelser", String(r.eventsTotal)], ["Verifierade händelser", String(r.verifiedTotal)], ["Avslut", String(r.closedTotal)], ["Verifierade resultat", String(r.verifiedResults)]]} />
        {r.month && r.rolling && (
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
            <PdfRate label={`Resultatgrad ${r.month.period}`} r={r.month} />
            <PdfRate label={`Resultatgrad ${r.rolling.period}`} r={r.rolling} />
          </View>
        )}
        <H>Avslut och resultat</H>
        {r.closures.length ? (
          <Table
            cols={cols([["Avslut", 55], ["Antal", 20, true], ["I resultatgraden", 25]])}
            rows={r.closures.map((x) => ({ key: x.key, cells: [x.label, String(x.count), x.counted ? "Räknas" : "Räknas inte"] }))}
            foot={["Totalt", String(r.closedTotal), `${r.closuresCounted} räknas`]}
          />
        ) : (
          <Empty>{`Inga avslut i ${v.monthLabel}.`}</Empty>
        )}
        <H>Händelser</H>
        <PdfBarChart spec={r.chart} />
        {r.events.length ? (
          <Table cols={cols([["Händelse", 55], ["Antal", 15, true], ["Verifierade", 15, true], ["Deltagare", 15, true]])} rows={r.events.map((x) => ({ key: x.kind, cells: eventCells(x) }))} foot={eventCells(r.eventTotal)} />
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
            cols={cols([["Deltagare", 17], ["Område", 9], ["Period", 14], ["Närvarograd", 13, true], ["Progression", 17], ["Resultat", 30]])}
            rows={participants.map((x) => ({
              key: x.caseId,
              // Som på sidan: delmålen (antal) under progressionen; tillfällena och resten står i bilagan.
              cells: [
                <Stack2 key="d" main={x.name} sub={x.caseNumber} />, x.areaCode || "–", <Lines key="p" xs={x.periodLines} />,
                x.attendance.rate == null ? "–" : <Stack2 key="n" main={x.attendance.rateText} sub={x.attendance.detail || undefined} />,
                <Stack2 key="g" main={x.progression.text} sub={x.goals.lines.length ? x.goals.lines.join(", ") : undefined} />,
                <Lines key="r" xs={x.results} />,
              ],
            }))}
          />
        ) : (
          <Empty>Inga deltagare i urvalet.</Empty>
        )}
      </Sec>

      {participants.length > 0 && (
        <View break style={{ flexDirection: "column", gap: 6 }}>
          <Sec title="Bilaga: per deltagare">
            <View style={{ flexDirection: "column" }}>
              {participants.map((x) => (
                <ParticipantBlock key={x.caseId} x={x} />
              ))}
            </View>
          </Sec>
        </View>
      )}
    </PdfDocument>
  );
}

/** Rapporten som PDF (application/pdf). */
export async function renderOverviewPdf(v: OverviewPdfModel, sort: ParticipantSort): Promise<Blob> {
  registerPdfFonts();
  return pdf(<OverviewPdf v={v} sort={sort} />).toBlob();
}
