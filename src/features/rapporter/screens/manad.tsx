"use client";
// Intern månadsrapport (/manadsrapport, Karims beslut 2026-11-18): allt som hände i avtalet under en månad – start och slut per
// yrkesområde, närvarograd, progression, aktiviteter, resultat och en rad per deltagare. Bara för Miljonbemanning (samordnare,
// avtalsansvarig, coach och chef); kommunen har ingen väg hit. Samma vy-modell som PDF:en (pdf/manad-doc.tsx). Coachen får inte
// resultatgraden (servern skickar den inte, Karims beslut 2026-11-24), och delmålen står bara som antal (aldrig namnen).
// Adressen: ?manad=YYYY-MM&omrade=<kod>&avtal=<id>&sortera=omrade|arende|narvaro – bara koder och id:n.
// Karims designregel: inga hjälptexter och inga förklarande underrader – rubriker, siffror, diagram och tabeller. Varje diagram har en tabell
// med samma tal.
import { useState } from "react";
import { pct } from "@/core/format";
import { fmtDate } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import type { ScreenProps } from "@/shell/routes";
import { pick, useQueryPatch } from "@/shell/url-state";
import {
  Badge, Button, Card, CellSub, ErrorNotice, Field, Kpi, Loading, Meter, Notice, Page, Refreshing, Select, Stack, Table, WEEK_KPI_SM, WeekKpis, useAuditView, useDownload, useToast,
  type BadgeTone, type Column, type IconName,
} from "@/ui";
import {
  monthlyOverview, monthlyOverviewPdf, monthlyOverviewViewed, PARTICIPANT_SORT_LABEL, PARTICIPANT_SORTS, sortParticipants,
  type ActivityKindRow, type AttendanceRow, type ClosureRow, type EventRow, type FlowRow, type GoalAreaRow, type LevelRow, type MonthlyOverviewView, type ParticipantRow,
  type ParticipantSort, type RateView,
} from "../api";
import { FlowChart, OverviewBarChart } from "../components/manad-charts";

const MONTH_RE = /^\d{4}-\d{2}$/;
const AREA_RE = /^[A-Z0-9]{1,4}$/;
const TITLE = "Intern månadsrapport";
type View = Extract<MonthlyOverviewView, { allowed: true }>;

export function ManadsrapportScreen({ query }: ScreenProps) {
  const patch = useQueryPatch();
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
    const ns = q.data.notStarted;
    return (
      <Page title={TITLE}>
        {ns && q.data.contracts.length > 1 && (
          <Field id="mr-avtal" label="Avtal" className="max-w-[320px]">
            <Select value={ns.contractId} options={q.data.contracts} onValueChange={(x) => patch({ avtal: x, omrade: null, manad: null })} />
          </Field>
        )}
        <Notice tone="info" title={ns ? `Avtalet startar ${fmtDate(ns.startsOn)}.` : "Det finns inget avtal i drift att visa."} />
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
      // Låt "Skapar PDF …" synas innan PDF:en byggs (bygget håller tråden).
      await new Promise((r) => setTimeout(r, 50));
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
/** Flera rader i en cell (nyckeln har platsen, så att två lika rader inte krockar). */
const Lines = ({ xs }: { xs: string[] }) => (xs.length ? <span className="flex flex-col">{xs.map((x, i) => <span key={`${i}:${x}`}>{x}</span>)}</span> : <>–</>);

// ---------------------------------------------------------------- 1. Start och slut per yrkesområde
const FLOW_COLS: Column<FlowRow>[] = [
  { key: "label", label: "Yrkesområde" },
  numCol<FlowRow>("atStart", "Vid månadens start", (r) => r.atStart),
  numCol<FlowRow>("started", "Startade", (r) => r.started),
  numCol<FlowRow>("ended", "Avslutade", (r) => r.ended),
  numCol<FlowRow>("atEnd", "Vid månadens slut", (r) => r.atEnd),
];
const REASON_COLS: Column<{ key: string; label: string; count: number }>[] = [{ key: "label", label: "Avslutsorsak" }, numCol("count", "Avslutade", (r: { count: number }) => r.count)];
function FlowSection({ v }: { v: View }) {
  return (
    <Card id="mr-flode" title="Start och slut per yrkesområde" icon="users">
      <Stack>
        <FlowChart spec={v.flow.chart} />
        <Table caption={`Start och slut per yrkesområde, ${v.monthLabel}`} columns={FLOW_COLS} rows={v.flow.rows} rowKey={(r) => r.code || "saknas"} empty="Inga deltagare i urvalet." footer={v.flow.rows.length ? <Foot columns={FLOW_COLS} row={v.flow.total} /> : undefined} />
        <SubHead>Avslutade per avslutsorsak</SubHead>
        <Table
          caption={`Avslutade per avslutsorsak, ${v.monthLabel}`}
          columns={REASON_COLS}
          rows={v.flow.endReasons}
          rowKey="key"
          empty={`Inga avslut i ${v.monthLabel}.`}
          footer={v.flow.endReasons.length ? <Foot columns={REASON_COLS} row={{ key: "total", label: "Totalt", count: v.flow.total.ended }} /> : undefined}
        />
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------- 2. Närvarograd
/** Kolumnrubrik på två rader (kitets rubriker bryts inte), så att tabellen ryms utan att rullas i sidled. */
const TwoLines = ({ a, b }: { a: string; b: string }) => (
  <>
    {a}
    <br />
    {b}
  </>
);
const ATT_COLS: Column<AttendanceRow>[] = [
  { key: "label", label: "Yrkesområde" },
  numCol<AttendanceRow>("rate", "Närvarograd", (r) => r.rateText),
  numCol<AttendanceRow>("planned", "Tillfällen", (r) => r.planned),
  numCol<AttendanceRow>("present", "Närvarande", (r) => r.present),
  numCol<AttendanceRow>("late", "Sena", (r) => r.late),
  { ...numCol<AttendanceRow>("absentValid", "", (r) => r.absentValid), label: <TwoLines a="Giltig" b="frånvaro" /> },
  { ...numCol<AttendanceRow>("absentInvalid", "", (r) => r.absentInvalid), label: <TwoLines a="Ogiltig" b="frånvaro" /> },
  { ...numCol<AttendanceRow>("unregistered", "", (r) => r.unregistered), label: <TwoLines a="Ej" b="registrerade" /> },
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
          <Kpi className={WEEK_KPI_SM} label="Deltagarnas uppnådda delmål" value={p.achievedCount} />
        </WeekKpis>
        <SubHead>Nivåer per progressionsområde</SubHead>
        <OverviewBarChart spec={p.levelChart} />
        <Table caption={`Nivåer per progressionsområde i godkända månadsbedömningar, ${v.monthLabel}`} columns={cols} rows={p.areas} rowKey="key" footer={<Foot columns={cols} row={p.total} />} />
        {p.optional.length > 0 && (
          <>
            <SubHead>Valfria områden</SubHead>
            <Table caption={`Valfria progressionsområden, ${v.monthLabel}`} columns={levelCols("Valfritt område")} rows={p.optional} rowKey="key" />
          </>
        )}
        <SubHead>Uppnådda delmål per progressionsområde</SubHead>
        <OverviewBarChart spec={p.goalChart} />
        <Table caption={`Deltagarnas delmål per progressionsområde, ${v.monthLabel}`} columns={GOAL_AREA_COLS} rows={[...p.areas, ...p.optional]} rowKey="key" footer={<Foot columns={GOAL_AREA_COLS} row={p.total} />} />
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------- 4. Aktiviteter
const KIND_COLS: Column<ActivityKindRow>[] = [
  { key: "label", label: "Typ" },
  numCol<ActivityKindRow>("held", "Tillfällen", (r) => r.held),
  numCol<ActivityKindRow>("inGroup", "I grupp", (r) => r.inGroup),
  numCol<ActivityKindRow>("participants", "Deltagare", (r) => r.participants),
  numCol<ActivityKindRow>("rate", "Närvarograd", (r) => r.rateText),
  numCol<ActivityKindRow>("withGoals", "Med delmål", (r) => r.withGoals),
];
const GOAL_SESSION_COLS: Column<GoalAreaRow>[] = [
  { key: "label", label: "Progressionsområde" },
  numCol<GoalAreaRow>("sessions", "Tillfällen med delmål", (r) => r.sessions),
  numCol<GoalAreaRow>("participants", "Deltagare som var med", (r) => r.participants),
  numCol<GoalAreaRow>("trained", "Tränade delmål", (r) => r.trained),
];
function ActivitySection({ v }: { v: View }) {
  const a = v.activities;
  return (
    <Card id="mr-aktiviteter" title="Aktiviteter" icon="calendar">
      <Stack>
        <WeekKpis>
          <Kpi className={WEEK_KPI_SM} label="Tillfällen" value={a.held} />
          {/* Mjukt bindestreck: ordet får brytas på en smal skärm. */}
          <Kpi className={WEEK_KPI_SM} label={"Grupp­aktiviteter"} value={a.groupActivities} />
          <Kpi className={WEEK_KPI_SM} label="Tillfällen med delmål" value={a.withGoals} />
          <Kpi className={WEEK_KPI_SM} label="Deltagarnas tränade delmål" value={v.progression.trainedCount} />
        </WeekKpis>
        <SubHead>Tillfällen per typ</SubHead>
        <OverviewBarChart spec={a.chart} />
        <Table caption={`Tillfällen per typ, ${v.monthLabel}`} columns={KIND_COLS} rows={a.byKind} rowKey="key" empty={`Inga tillfällen i ${v.monthLabel}.`} footer={a.byKind.length ? <Foot columns={KIND_COLS} row={a.byKindTotal} /> : undefined} />
        <SubHead>Delmål per progressionsområde</SubHead>
        <Table caption={`Tillfällen med delmål per progressionsområde, ${v.monthLabel}`} columns={GOAL_SESSION_COLS} rows={a.goalAreas} rowKey="key" empty={`Inga tillfällen med delmål i ${v.monthLabel}.`} />
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
    </div>
  );
}
const EVENT_COLS: Column<EventRow>[] = [
  { key: "label", label: "Händelse" },
  numCol<EventRow>("count", "Antal", (x) => x.count),
  numCol<EventRow>("verified", "Verifierade", (x) => x.verified),
  numCol<EventRow>("participants", "Deltagare", (x) => x.participants),
];
const CLOSURE_COLS: Column<ClosureRow>[] = [
  { key: "label", label: "Avslut" },
  numCol<ClosureRow>("count", "Antal", (x) => x.count),
  { key: "counted", label: "I resultatgraden", render: (x) => (x.counted ? "Räknas" : "Räknas inte") },
];
function ResultSection({ v }: { v: View }) {
  const r = v.results;
  const stepsShown = r.steps?.some((s) => s.submitted + s.approved > 0) ?? false;
  return (
    <Card id="mr-resultat" title="Resultat" icon="award">
      <Stack>
        <WeekKpis>
          <Kpi className={WEEK_KPI_SM} label="Händelser" value={r.eventsTotal} />
          <Kpi className={WEEK_KPI_SM} label="Verifierade händelser" value={r.verifiedTotal} />
          <Kpi className={WEEK_KPI_SM} label="Avslut" value={r.closedTotal} />
          <Kpi className={WEEK_KPI_SM} label="Verifierade resultat" value={r.verifiedResults} />
        </WeekKpis>
        {r.month && r.rolling && (
          <div className="grid grid-cols-2 gap-6 max-[760px]:grid-cols-1">
            <RateBlock label={`Resultatgrad ${r.month.period}`} r={r.month} />
            <RateBlock label={`Resultatgrad ${r.rolling.period}`} r={r.rolling} />
          </div>
        )}
        <SubHead>Avslut och resultat</SubHead>
        <Table
          caption={`Avslut efter hur de räknas i resultatgraden, ${v.monthLabel}`}
          columns={CLOSURE_COLS}
          rows={r.closures}
          rowKey="key"
          empty={`Inga avslut i ${v.monthLabel}.`}
          footer={
            r.closures.length ? (
              <tr>
                <td>Totalt</td>
                <td className="text-right tabular-nums">{r.closedTotal}</td>
                <td>{`${r.closuresCounted} räknas`}</td>
              </tr>
            ) : undefined
          }
        />
        <SubHead>Händelser</SubHead>
        <OverviewBarChart spec={r.chart} />
        <Table caption={`Händelser per typ, ${v.monthLabel}`} columns={EVENT_COLS} rows={r.events} rowKey="kind" empty={`Inga händelser i ${v.monthLabel}.`} footer={r.events.length ? <Foot columns={EVENT_COLS} row={r.eventTotal} /> : undefined} />
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
/** Det som inte ryms i tabellen: frånvaron uppdelad, nivåerna per progressionsområde, delmålen, tillfällena, stegen och bytet av yrkesområde. */
function ParticipantDetail({ r, id }: { r: ParticipantRow; id: string }) {
  const a = r.attendance;
  const items: [string, string[]][] = [
    ["Närvaro", a.registered + a.unregistered > 0 ? [`Närvarande ${a.present}`, `Sena ${a.late}`, `Giltig frånvaro ${a.absentValid}`, `Ogiltig frånvaro ${a.absentInvalid}`, `Ej registrerade ${a.unregistered}`] : ["Inga tillfällen"]],
    ["Progressionsområden", r.progression.areas.length ? r.progression.areas.map((x) => x.text) : [r.progression.text]],
    ["Delmål", r.goals.lines.length ? r.goals.lines : ["Inga"]],
    ["Tillfällen", [r.activities.text]],
    ...(r.steps.length ? ([["Progression och resultat", r.steps]] as [string, string[]][]) : []),
    ...(r.areaChanges.length ? ([["Byte av yrkesområde", r.areaChanges]] as [string, string[]][]) : []),
  ];
  return (
    <dl id={id} className="m-0 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-6 gap-y-3" data-participant-detail="">
      {items.map(([label, xs]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="text-label font-extrabold tracking-[0.08em] text-text-muted uppercase">{label}</dt>
          <dd className="m-0">
            <Lines xs={xs} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
const detailId = (r: ParticipantRow) => `mr-detalj-${r.caseId}`;
function ParticipantSection({ v, rows, sort, onSort }: { v: View; rows: ParticipantRow[]; sort: ParticipantSort; onSort: (s: ParticipantSort) => void }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const cols: Column<ParticipantRow>[] = [
    // Länken till deltagarkortet: namnet och ärendenumret (Table rowHref, linkKey).
    { key: "deltagare", label: "Deltagare", render: (r) => (<span className="flex flex-col">{r.name}<span className="font-normal whitespace-nowrap text-text-muted tabular-nums">{r.caseNumber}</span></span>) },
    // Koden syns (A–L), hela namnet läses upp och står i verktygstipset.
    { key: "area", label: "Område", render: (r) => (r.areaCode ? <span title={r.areaLabel}><span aria-hidden="true">{r.areaCode}</span><span className="sr-only">{r.areaLabel}</span></span> : "–") },
    { key: "period", label: "Period", render: (r) => <Lines xs={r.periodLines} /> },
    { key: "attendance", label: "Närvarograd", num: true, render: (r) => (r.attendance.rate == null ? "–" : <>{r.attendance.rateText}<CellSub>{r.attendance.detail}</CellSub></>) },
    // Delmålen (antal) under progressionen; tillfällena och resten står i utfällningen – tabellen ryms då utan att rullas i sidled.
    { key: "progression", label: "Progression", render: (r) => <>{r.progression.text}{r.goals.lines.length > 0 && <CellSub>{r.goals.lines.join(", ")}</CellSub>}</> },
    { key: "results", label: "Resultat", render: (r) => <Lines xs={r.results} /> },
    {
      key: "detalj",
      label: <span className="sr-only">Mer</span>,
      render: (r) =>
        r.restricted ? null : (
          <Button kind="ghost" icon={open.has(r.caseId) ? "chevron-up" : "chevron-down"} aria-expanded={open.has(r.caseId)} aria-controls={open.has(r.caseId) ? detailId(r) : undefined} ariaLabel={`Mer om ${r.caseNumber}`} onClick={() => toggle(r.caseId)} />
        ),
    },
  ];
  return (
    <Card id="mr-deltagare" title={`Per deltagare (${rows.length})`} icon="list">
      <Stack>
        <Field id="mr-sortera" label="Sortera" className="max-w-[320px]">
          <Select value={sort} options={PARTICIPANT_SORTS.map((s) => ({ value: s, label: PARTICIPANT_SORT_LABEL[s] }))} onValueChange={(x) => onSort(x as ParticipantSort)} />
        </Field>
        <Table
          caption={`Deltagare i ${v.monthLabel}`}
          // Behållaren är innehållsblocket för cellernas skärmläsartext (sr-only), så att den inte breddar sidan.
          className="relative"
          columns={cols}
          rows={rows}
          rowKey="caseId"
          rowHref={(r) => (r.restricted ? null : `/arenden/${r.caseId}`)}
          linkKey="deltagare"
          rowDetail={(r) => (open.has(r.caseId) && !r.restricted ? <ParticipantDetail r={r} id={detailId(r)} /> : null)}
          empty="Inga deltagare i urvalet."
        />
      </Stack>
    </Card>
  );
}
