"use client";
// Intern månadsrapport (/manadsrapport, Karims beslut 2026-11-18): allt som hände i avtalet under en månad – start och slut per
// yrkesområde, närvarograd, progression, aktiviteter, resultat och en rad per deltagare. Bara för Miljonbemanning (samordnare,
// avtalsansvarig, coach och chef); kommunen har ingen väg hit. Samma vy-modell som PDF:en (pdf/manad-doc.tsx).
// Adressen: ?manad=YYYY-MM&omrade=<kod>&avtal=<id>&sortera=omrade|arende|narvaro – bara koder och id:n.
// Karims designregel: inga hjälptexter och inga förklarande underrader – rubriker, siffror, diagram och tabeller. Varje diagram har en tabell
// med samma tal.
import { useState } from "react";
import { pct } from "@/core/format";
import { useCommand, useQuery } from "@/shell/backend";
import type { ScreenProps } from "@/shell/routes";
import { pick, useQueryPatch } from "@/shell/url-state";
import {
  Badge, Button, Card, CellSub, ErrorNotice, Field, Kpi, Loading, Meter, Notice, Page, Refreshing, Select, Stack, Table, WEEK_KPI_SM, WeekKpis, useAuditView, useDownload, useToast,
  type BadgeTone, type Column, type IconName,
} from "@/ui";
import {
  monthlyOverview, monthlyOverviewPdf, monthlyOverviewViewed, PARTICIPANT_SORT_LABEL, PARTICIPANT_SORTS, sortParticipants,
  type AttendanceRow, type FlowRow, type LevelRow, type MonthlyOverviewView, type ParticipantRow, type ParticipantSort, type RateView,
} from "../api";
import { FlowChart, OverviewBarChart } from "../components/manad-charts";

const MONTH_RE = /^\d{4}-\d{2}$/;
const AREA_RE = /^[A-Z0-9]{1,4}$/;
const TITLE = "Intern månadsrapport";
type View = Extract<MonthlyOverviewView, { allowed: true }>;

export function ManadsrapportScreen({ query }: ScreenProps) {
  const manad = query.get("manad");
  const omrade = query.get("omrade");
  const avtal = query.get("avtal");
  const sort = pick(query, "sortera", PARTICIPANT_SORTS, "omrade");
  const params = {
    ...(avtal ? { contractId: avtal } : {}),
    ...(manad && MONTH_RE.test(manad) ? { month: manad } : {}),
    ...(omrade && AREA_RE.test(omrade) ? { area: omrade } : {}),
  };
  const q = useQuery(monthlyOverview, params, { keepPrevious: true });
  if (q.error && !q.data) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Loading />;
  if (!q.data.allowed) {
    return (
      <Page title={TITLE}>
        <Notice tone="info" title="Det finns inget avtal i drift att visa." />
      </Page>
    );
  }
  return <Overview v={q.data} busy={q.isPlaceholderData} sort={sort} />;
}

// ---------------------------------------------------------------- Sidan
function Overview({ v, busy, sort }: { v: View; busy: boolean; sort: ParticipantSort }) {
  const patch = useQueryPatch();
  const logView = useCommand(monthlyOverviewViewed);
  const area = v.area?.code ?? null;
  // En visning per sidbesök och val (avtal, månad, yrkesområde) – inte medan föregående svar visas.
  useAuditView(busy ? null : `monthly_overview.view:${v.contractId}:${v.month}:${area ?? "alla"}`, () =>
    logView.run({ contractId: v.contractId, month: v.month, area }).catch(() => undefined),
  );
  const participants = sortParticipants(v.participants, sort);
  return (
    <Page title={TITLE} actions={<PdfButton v={v} sort={sort} busy={busy} />}>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3" data-filters="">
        {v.contracts.length > 1 && (
          <Field id="mr-avtal" label="Avtal" className="min-w-[240px]">
            <Select value={v.contractId} options={v.contracts} onValueChange={(x) => patch({ avtal: x, omrade: null })} />
          </Field>
        )}
        <Field id="mr-manad" label="Månad" className="min-w-[200px]">
          <Select value={v.month} options={v.months} onValueChange={(x) => patch({ manad: x })} />
        </Field>
        <Field id="mr-omrade" label="Yrkesområde" className="min-w-[260px]">
          <Select value={area ?? ""} options={[{ value: "", label: "Alla yrkesområden" }, ...v.areas]} onValueChange={(x) => patch({ omrade: x || null })} />
        </Field>
        {v.partial && (
          <Badge tone="outline" icon="clock" className="mb-3">
            Månaden pågår
          </Badge>
        )}
      </div>
      <Refreshing busy={busy}>
        <Stack gap="lg">
          <WeekKpis>
            <Kpi className={WEEK_KPI_SM} label="Deltagare" value={v.totals.participants} />
            <Kpi className={WEEK_KPI_SM} label="Startade" value={v.totals.started} />
            <Kpi className={WEEK_KPI_SM} label="Avslutade" value={v.totals.ended} />
            <Kpi className={WEEK_KPI_SM} label="Närvarograd" value={v.attendance.total.rateText} />
          </WeekKpis>
          <FlowSection v={v} />
          <AttendanceSection v={v} />
          <ProgressionSection v={v} />
          <ActivitySection v={v} />
          <ResultSection v={v} />
          <ParticipantSection v={v} rows={participants} sort={sort} onSort={(s) => patch({ sortera: s === "omrade" ? null : s })} />
        </Stack>
      </Refreshing>
    </Page>
  );
}

// ---------------------------------------------------------------- PDF
function PdfButton({ v, sort, busy }: { v: View; sort: ParticipantSort; busy: boolean }) {
  const cmd = useCommand(monthlyOverviewPdf);
  const download = useDownload();
  const toast = useToast();
  const [working, setWorking] = useState(false);
  const onClick = async () => {
    if (working || busy) return;
    setWorking(true);
    try {
      // Servern prövar behörigheten och loggar nedladdningen först; PDF:en byggs av samma vy-modell som sidan.
      const res = await cmd.run({ contractId: v.contractId, month: v.month, area: v.area?.code ?? null });
      if (!res.ok) {
        toast(res.message || "Rapporten kunde inte laddas ned.", "error");
        return;
      }
      const { renderOverviewPdf } = await import("../pdf/manad-doc");
      const blob = await renderOverviewPdf(v, sort);
      await download(res.filename, blob, "application/pdf");
    } catch {
      toast("PDF-filen kunde inte skapas. Försök igen.", "error");
    } finally {
      setWorking(false);
    }
  };
  return (
    <>
      <Button icon="download" aria-disabled={working || busy || undefined} aria-busy={working || undefined} onClick={() => void onClick()}>
        {working ? "Skapar PDF …" : "Ladda ner PDF"}
      </Button>
      <span role="status" className="sr-only">
        {working ? "Skapar PDF-filen. Det kan ta några sekunder." : ""}
      </span>
    </>
  );
}

// ---------------------------------------------------------------- Delar
const numCol = <R,>(key: string, label: string, get: (r: R) => string | number): Column<R> => ({ key, label, num: true, render: (r) => get(r) });
/** Summeringsrad i tabellens fot (samma kolumner som raderna). */
function Foot<R>({ columns, row }: { columns: Column<R>[]; row: R }) {
  return (
    <tr>
      {columns.map((c) => (
        <td key={c.key} className={c.num ? "text-right tabular-nums" : undefined}>
          {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
        </td>
      ))}
    </tr>
  );
}
const SubHead = ({ children }: { children: string }) => <h3 className="text-label font-extrabold tracking-[0.1em] uppercase">{children}</h3>;

// ---------------------------------------------------------------- 1. Start och slut per yrkesområde
const FLOW_COLS: Column<FlowRow>[] = [
  { key: "label", label: "Yrkesområde" },
  numCol<FlowRow>("atStart", "Vid månadens start", (r) => r.atStart),
  numCol<FlowRow>("started", "Startade", (r) => r.started),
  numCol<FlowRow>("ended", "Avslutade", (r) => r.ended),
  numCol<FlowRow>("atEnd", "Vid månadens slut", (r) => r.atEnd),
];
function FlowSection({ v }: { v: View }) {
  return (
    <Card id="mr-flode" title="Start och slut per yrkesområde" icon="users">
      <Stack>
        <FlowChart spec={v.flow.chart} />
        <Table caption={`Start och slut per yrkesområde, ${v.monthLabel}`} columns={FLOW_COLS} rows={v.flow.rows} rowKey={(r) => r.code || "saknas"} empty="Inga deltagare i urvalet." footer={v.flow.rows.length ? <Foot columns={FLOW_COLS} row={v.flow.total} /> : undefined} />
        <SubHead>Avslutade per avslutsorsak</SubHead>
        <Table
          caption={`Avslutade per avslutsorsak, ${v.monthLabel}`}
          columns={[{ key: "label", label: "Avslutsorsak" }, numCol("count", "Avslutade", (r: { count: number }) => r.count)]}
          rows={v.flow.endReasons}
          rowKey="key"
          empty={`Inga avslut i ${v.monthLabel}.`}
        />
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------- 2. Närvarograd
const ATT_COLS: Column<AttendanceRow>[] = [
  { key: "label", label: "Yrkesområde" },
  numCol<AttendanceRow>("planned", "Tillfällen", (r) => r.planned),
  numCol<AttendanceRow>("present", "Närvarande", (r) => r.present),
  numCol<AttendanceRow>("late", "Sena", (r) => r.late),
  numCol<AttendanceRow>("absentValid", "Giltig frånvaro", (r) => r.absentValid),
  numCol<AttendanceRow>("absentInvalid", "Ogiltig frånvaro", (r) => r.absentInvalid),
  numCol<AttendanceRow>("unregistered", "Ej registrerade", (r) => r.unregistered),
  numCol<AttendanceRow>("rate", "Närvarograd", (r) => r.rateText),
];
function AttendanceSection({ v }: { v: View }) {
  return (
    <Card id="mr-narvaro" title="Närvarograd" icon="check-square">
      <Stack>
        <OverviewBarChart spec={v.attendance.chart} />
        <Table caption={`Närvarograd per yrkesområde, ${v.monthLabel}`} columns={ATT_COLS} rows={v.attendance.byArea} rowKey="key" empty="Inga tillfällen i urvalet." footer={v.attendance.byArea.length ? <Foot columns={ATT_COLS} row={v.attendance.total} /> : undefined} />
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------- 3. Progression
/** Fördelningen per nivå (antal deltagare per område och nivå) – aldrig ett medelvärde. */
const levelCols = (first: string): Column<LevelRow>[] => [
  { key: "label", label: first },
  numCol<LevelRow>("l0", "Nivå 0", (r) => r.levels[0]),
  numCol<LevelRow>("l1", "Nivå 1", (r) => r.levels[1]),
  numCol<LevelRow>("l2", "Nivå 2", (r) => r.levels[2]),
  numCol<LevelRow>("l3", "Nivå 3", (r) => r.levels[3]),
  numCol<LevelRow>("notAssessed", "Ej bedömd", (r) => r.notAssessed),
];
const GOAL_AREA_COLS: Column<LevelRow>[] = [
  { key: "label", label: "Progressionsområde" },
  numCol<LevelRow>("achieved", "Uppnådda delmål", (r) => r.achieved),
  numCol<LevelRow>("trained", "Tränade delmål", (r) => r.trained),
];
const GOAL_COLS: Column<{ id: string; label: string; areaLabel: string; participants: number }>[] = [
  { key: "label", label: "Delmål" },
  { key: "areaLabel", label: "Progressionsområde" },
  numCol("participants", "Deltagare", (r: { participants: number }) => r.participants),
];
function ProgressionSection({ v }: { v: View }) {
  const p = v.progression;
  const cols = levelCols("Progressionsområde");
  return (
    <Card id="mr-progression" title="Progression" icon="trending-up">
      <Stack>
        <WeekKpis>
          <Kpi className={WEEK_KPI_SM} label="Godkända bedömningar" value={`${p.approved} av ${p.required}`} />
          <Kpi className={WEEK_KPI_SM} label={p.clearLabel} value={`${p.clear} av ${p.approved}`} />
          <Kpi className={WEEK_KPI_SM} label={p.anyLabel} value={`${p.any} av ${p.approved}`} />
          <Kpi className={WEEK_KPI_SM} label="Uppnådda delmål" value={p.achievedCount} />
        </WeekKpis>
        <OverviewBarChart spec={p.levelChart} />
        <Table caption={`Nivåer per progressionsområde i godkända månadsbedömningar, ${v.monthLabel}`} columns={cols} rows={p.areas} rowKey="key" footer={<Foot columns={cols} row={p.total} />} />
        {p.optional.length > 0 && (
          <>
            <SubHead>Valfria områden</SubHead>
            <Table caption={`Valfria progressionsområden, ${v.monthLabel}`} columns={levelCols("Valfritt område")} rows={p.optional} rowKey="key" />
          </>
        )}
        <SubHead>Delmål</SubHead>
        <OverviewBarChart spec={p.goalChart} />
        <Table caption={`Delmål per progressionsområde, ${v.monthLabel}`} columns={GOAL_AREA_COLS} rows={[...p.areas, ...p.optional]} rowKey="key" footer={<Foot columns={GOAL_AREA_COLS} row={p.total} />} />
        <Table caption={`Uppnådda delmål, ${v.monthLabel}`} columns={GOAL_COLS} rows={p.achieved} rowKey="id" empty={`Inga delmål uppnåddes i ${v.monthLabel}.`} />
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------- 4. Aktiviteter
function ActivitySection({ v }: { v: View }) {
  const a = v.activities;
  const kindCols: Column<(typeof a.byKind)[number]>[] = [
    { key: "label", label: "Typ" },
    numCol("held", "Tillfällen", (r: (typeof a.byKind)[number]) => r.held),
    numCol("inGroup", "I gruppaktiviteter", (r: (typeof a.byKind)[number]) => r.inGroup),
    numCol("participants", "Deltagare", (r: (typeof a.byKind)[number]) => r.participants),
    numCol("rate", "Närvarograd", (r: (typeof a.byKind)[number]) => r.rateText),
    numCol("goals", "Delmål", (r: (typeof a.byKind)[number]) => r.goals),
  ];
  const goalCols: Column<(typeof a.goals)[number]>[] = [
    { key: "label", label: "Delmål" },
    { key: "areaLabel", label: "Progressionsområde" },
    numCol("sessions", "Tillfällen", (r: (typeof a.goals)[number]) => r.sessions ?? 0),
    numCol("participants", "Deltagare som var med", (r: (typeof a.goals)[number]) => r.participants),
  ];
  return (
    <Card id="mr-aktiviteter" title="Aktiviteter" icon="calendar">
      <Stack>
        <WeekKpis>
          <Kpi className={WEEK_KPI_SM} label="Tillfällen" value={a.held} />
          <Kpi className={WEEK_KPI_SM} label="Gruppaktiviteter" value={a.groupActivities} />
          <Kpi className={WEEK_KPI_SM} label="Tillfällen med delmål" value={a.withGoals} />
          <Kpi className={WEEK_KPI_SM} label="Tränade delmål" value={v.progression.trainedCount} />
        </WeekKpis>
        <OverviewBarChart spec={a.chart} />
        <Table caption={`Tillfällen per typ, ${v.monthLabel}`} columns={kindCols} rows={a.byKind} rowKey="kind" empty={`Inga tillfällen i ${v.monthLabel}.`} />
        <SubHead>Delmål som tillfällena tränade</SubHead>
        <Table caption={`Delmål som tillfällena tränade, ${v.monthLabel}`} columns={goalCols} rows={a.goals} rowKey="id" empty={`Inga tillfällen med delmål i ${v.monthLabel}.`} />
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------- 5. Resultat
const RATE_LOOK: Record<RateView["status"], { tone: BadgeTone; icon: IconName }> = {
  ok: { tone: "blue", icon: "check-circle" },
  below_internal: { tone: "grey", icon: "alert-circle" },
  below_contract: { tone: "red", icon: "alert" },
  insufficient: { tone: "outline", icon: "minus-circle" },
};
function RateBlock({ label, r }: { label: string; r: RateView }) {
  const markers = [
    ...(r.contractTarget != null ? [{ value: r.contractTarget, label: `Avtalets mål ${pct(r.contractTarget)}`, tone: "red" as const }] : []),
    ...(r.internalTarget != null ? [{ value: r.internalTarget, label: `Internt mål ${pct(r.internalTarget)}`, tone: "dark" as const }] : []),
  ];
  return (
    <div className="flex flex-col gap-2" data-rate="">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-bold">{label}</span>
        <span className="text-h2 font-extrabold">
          {r.valueText} <span className="text-body font-semibold">({r.num} av {r.den})</span>
        </span>
      </div>
      <Meter value={r.value ?? 0} max={1} markers={markers} label={`${label}: ${r.value == null ? "inget underlag" : `${pct(r.value)}, ${r.num} av ${r.den}`}. ${markers.map((m) => m.label).join(". ")}`} />
      <span>
        <Badge tone={RATE_LOOK[r.status].tone} icon={RATE_LOOK[r.status].icon}>
          {r.statusText}
        </Badge>
      </span>
      {r.note && <p className="m-0">{r.note}</p>}
    </div>
  );
}
function ResultSection({ v }: { v: View }) {
  const r = v.results;
  const eventCols: Column<(typeof r.events)[number]>[] = [
    { key: "label", label: "Händelse" },
    numCol("count", "Antal", (x: (typeof r.events)[number]) => x.count),
    numCol("verified", "Verifierade", (x: (typeof r.events)[number]) => x.verified),
    numCol("participants", "Deltagare", (x: (typeof r.events)[number]) => x.participants),
  ];
  const stepsShown = r.steps?.some((s) => s.submitted + s.approved > 0) ?? false;
  return (
    <Card id="mr-resultat" title="Resultat" icon="award">
      <Stack>
        <WeekKpis>
          <Kpi className={WEEK_KPI_SM} label="Händelser" value={r.eventsTotal} />
          <Kpi className={WEEK_KPI_SM} label="Verifierade händelser" value={r.verifiedTotal} />
          <Kpi className={WEEK_KPI_SM} label="Avslut" value={r.closedTotal} />
          <Kpi className={WEEK_KPI_SM} label="Verifierade resultat" value={r.month.num} />
        </WeekKpis>
        <div className="grid grid-cols-2 gap-6 max-[760px]:grid-cols-1">
          <RateBlock label={`Resultatgrad ${r.month.period}`} r={r.month} />
          <RateBlock label={`Resultatgrad ${r.rolling.period}`} r={r.rolling} />
        </div>
        <SubHead>Avslut och resultat</SubHead>
        <Table
          caption={`Avslut efter hur de räknas i resultatgraden, ${v.monthLabel}`}
          columns={[{ key: "label", label: "Avslut" }, numCol("count", "Antal", (x: { count: number }) => x.count), { key: "counted", label: "I resultatgraden", render: (x: { counted: boolean }) => (x.counted ? "Räknas" : "Räknas inte") }]}
          rows={r.closures}
          rowKey="key"
          empty={`Inga avslut i ${v.monthLabel}.`}
        />
        <SubHead>Händelser</SubHead>
        <OverviewBarChart spec={r.chart} />
        <Table caption={`Händelser per typ, ${v.monthLabel}`} columns={eventCols} rows={r.events} rowKey="kind" empty={`Inga händelser i ${v.monthLabel}.`} />
        {r.steps && (
          <>
            <SubHead>Progression och resultat</SubHead>
            {stepsShown ? (
              <Table
                caption={`Steg i Progression och resultat, ${v.monthLabel}`}
                columns={[
                  { key: "label", label: "Steg" },
                  numCol("submitted", "Skickade till kommunen", (x: { submitted: number }) => x.submitted),
                  numCol("approved", "Godkända av kommunen", (x: { approved: number }) => x.approved),
                ]}
                rows={r.steps}
                rowKey="step"
              />
            ) : (
              <p className="m-0" data-steps-empty="">
                Inga steg nåddes i {v.monthLabel}.
              </p>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------- 6. Per deltagare
const Lines = ({ xs }: { xs: string[] }) => (xs.length ? <span className="flex flex-col">{xs.map((x) => <span key={x}>{x}</span>)}</span> : <>–</>);
const PART_COLS: Column<ParticipantRow>[] = [
  // Länken till deltagarkortet: namnet och ärendenumret (Table rowHref, linkKey).
  { key: "deltagare", label: "Deltagare", render: (r) => (<span className="flex flex-col">{r.name}<span className="font-normal whitespace-nowrap text-text-muted tabular-nums">{r.caseNumber}</span></span>) },
  // Koden syns (A–L), hela namnet läses upp och står i verktygstipset.
  { key: "area", label: "Område", render: (r) => (r.areaCode ? <span title={r.areaLabel}><span aria-hidden="true">{r.areaCode}</span><span className="sr-only">{r.areaLabel}</span></span> : "–") },
  { key: "period", label: "Period", nowrap: true, render: (r) => <Lines xs={[r.startText, `– ${r.endText === "Pågår" ? "pågår" : r.endText}`]} /> },
  { key: "attendance", label: "Närvarograd", num: true, render: (r) => (r.attendance.rate == null ? "–" : <>{r.attendance.rateText}<CellSub>{r.attendance.detail}</CellSub></>) },
  { key: "progression", label: "Progression", render: (r) => r.progression.text },
  { key: "goals", label: "Delmål", render: (r) => <Lines xs={[r.goals.achieved ? `${r.goals.achieved} uppnådda` : "", r.goals.trained ? `${r.goals.trained} tränade` : ""].filter(Boolean)} /> },
  { key: "activities", label: "Tillfällen", num: true, render: (r) => (r.activities.held ? <>{r.activities.held}{r.activities.inGroup > 0 && <CellSub>{`${r.activities.inGroup} i grupp`}</CellSub>}</> : "–") },
  { key: "results", label: "Resultat", render: (r) => <span className="block min-w-[220px]"><Lines xs={r.results} /></span> },
];
function ParticipantSection({ v, rows, sort, onSort }: { v: View; rows: ParticipantRow[]; sort: ParticipantSort; onSort: (s: ParticipantSort) => void }) {
  return (
    <Card id="mr-deltagare" title={`Per deltagare (${rows.length})`} icon="list">
      <Stack>
        <Field id="mr-sortera" label="Sortera" className="max-w-[320px]">
          <Select value={sort} options={PARTICIPANT_SORTS.map((s) => ({ value: s, label: PARTICIPANT_SORT_LABEL[s] }))} onValueChange={(x) => onSort(x as ParticipantSort)} />
        </Field>
        <Table caption={`Deltagare i ${v.monthLabel}`} columns={PART_COLS} rows={rows} rowKey="caseId" rowHref={(r) => `/arenden/${r.caseId}`} linkKey="deltagare" empty="Inga deltagare i urvalet." />
      </Stack>
    </Card>
  );
}

