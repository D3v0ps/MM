"use client";
// Rapportlistan (prototypens rapporter.lista): alla rapporter till kommunen med snabbfilter, filter, sökning och status.
// Coachen ser sina ärenden och veckorapporter där hon har deltagare. Mest brådskande först.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { num } from "@/core/format";
import { fmtDateShort, monthEnd, monthName } from "@/core/time";
import { reportKindLabel, reportStatusLabel } from "@/core/labels";
import { useQuery } from "@/shell/backend";
import { Link } from "@/shell/nav";
import { pick, pickInt, useMemoryState, useQueryPatch } from "@/shell/url-state";
import type { ScreenProps } from "@/shell/routes";
import {
  Badge, Button, Card, DemoNote, ErrorNotice, Field, Grid, Icon, Input, Kpi, List, ListItem, Loading, Page, PerspectiveLink, Select, SlaBadge, Stack, Stepper, Table,
  type Column,
} from "@/ui";
import { reportList, type ReportList, type ReportListRow } from "../api";
import { ProvisionalNote, ReportStatusBadge } from "../components/parts";
import { LIFECYCLE, NO_DUE, QUICK_FILTERS, REPORT_LIST_KINDS, REPORT_LIST_STATUSES, ucfirst, type QuickFilter } from "../report-helpers";

const PAGE_SIZE = 30;
const ALIAS: Record<string, QuickFilter> = { forsenade: "overdue", "denna-vecka": "week", godkannande: "approval", leverans: "deliver" };

type Filter = { kind?: string; status?: string; quick?: QuickFilter; period?: string };
/** ?filter= – typ, status, snabbfilter (även svenska alias) eller månad (2027-01). */
function parseFilter(f: string | null): Filter {
  const x = String(f || "");
  if ((REPORT_LIST_KINDS as readonly string[]).includes(x)) return { kind: x };
  if ((REPORT_LIST_STATUSES as readonly string[]).includes(x)) return { status: x };
  if (x in QUICK_FILTERS) return { quick: x as QuickFilter };
  if (ALIAS[x]) return { quick: ALIAS[x] };
  if (/^\d{4}-\d{2}$/.test(x)) return { period: x };
  return {};
}

/** Mest brådskande först: ej levererade efter förfallotid, sedan levererade senast först (prototypens sortRows). */
function sortRows(rows: ReportListRow[]): ReportListRow[] {
  const open = rows.filter((x) => !x.delivered).sort((a, b) => ((a.dueAt || "9999") < (b.dueAt || "9999") ? -1 : 1));
  const done = rows.filter((x) => x.delivered).sort((a, b) => ((a.deliveredAt || a.periodEnd || "") > (b.deliveredAt || b.periodEnd || "") ? -1 : 1));
  return [...open, ...done];
}

/** Smal skärm (mobil): listan visas som kort i stället för tabell. */
function useNarrow(px = 620): boolean {
  const q = `(max-width: ${px}px)`;
  return useSyncExternalStore(
    (on) => {
      try {
        const m = window.matchMedia(q);
        m.addEventListener("change", on);
        return () => m.removeEventListener("change", on);
      } catch {
        return () => {};
      }
    },
    () => {
      try {
        return window.matchMedia(q).matches;
      } catch {
        return false;
      }
    },
    () => false,
  );
}

function Tile({ label, value, sub, alert, active, onClick }: { label: string; value: number; sub: string; alert?: boolean; active: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className="grid min-h-11 w-full cursor-pointer rounded-card border-0 bg-transparent p-0 text-left text-inherit [font:inherit]">
      <Kpi label={label} value={String(value)} sub={sub} tone={alert ? "alert" : active ? "watch" : undefined}>
        <span className="mt-auto inline-flex items-center gap-1 text-small font-bold">
          <Icon name={active ? "check" : "filter"} />
          {active ? "Filtret är på" : "Visa i listan"}
        </span>
      </Kpi>
    </button>
  );
}

function DueCell({ r }: { r: ReportListRow }) {
  if (!r.dueAt || !r.sla) return <span className="text-text-muted">–</span>;
  return (
    <div className="flex min-w-[150px] flex-col items-start gap-1">
      <SlaBadge sla={r.sla} dueAt={r.dueAt} />
      {r.dueText && <span className="text-small whitespace-nowrap text-text-muted">{r.dueText}</span>}
      {!r.delivered && <ProvisionalNote text={r.provisional} />}
    </div>
  );
}

export function RapporterListaScreen({ query }: ScreenProps) {
  const q = useQuery(reportList, {});
  if (q.error) return <Page title="Rapporter"><ErrorNotice error={q.error} onRetry={() => void q.refetch()} /></Page>;
  if (q.isLoading || !q.data) return <Page title="Rapporter"><Loading /></Page>;
  return <ListView data={q.data} query={query} />;
}

const QUICK_KEYS = Object.keys(QUICK_FILTERS) as QuickFilter[];

function ListView({ data, query }: { data: ReportList; query: URLSearchParams }) {
  const patch = useQueryPatch();
  // ?filter= (scenarier och länkar) är en ingång: den översätts till listans parametrar med replace.
  const filter = query.get("filter");
  useEffect(() => {
    if (filter === null) return;
    const f = parseFilter(filter);
    patch({ filter: null, typ: f.kind ?? null, status: f.status ?? null, period: f.period ?? null, snabb: f.quick ?? null, visa: null });
  }, [filter, patch]);
  const initial = filter !== null ? parseFilter(filter) : null;
  // Valen ligger i adressen (Tillbaka och omladdning visar samma lista). Söktexten kan vara ett namn: bara i minnet.
  const kind = initial ? (initial.kind ?? "all") : pick(query, "typ", ["all", ...REPORT_LIST_KINDS], "all");
  const status = initial ? (initial.status ?? "all") : pick(query, "status", ["all", ...REPORT_LIST_STATUSES], "all");
  const period = initial ? (initial.period ?? "all") : data.months.includes(query.get("period") ?? "") ? (query.get("period") as string) : "all";
  const quick: QuickFilter | null = initial ? (initial.quick ?? null) : (QUICK_KEYS as readonly string[]).includes(query.get("snabb") ?? "") ? (query.get("snabb") as QuickFilter) : null;
  const [text, setText] = useMemoryState("q", "");
  const limit = pickInt(query, "visa", PAGE_SIZE);
  const setKind = (v: string) => patch({ typ: v === "all" ? null : v });
  const setStatus = (v: string) => patch({ status: v === "all" ? null : v });
  const setPeriod = (v: string) => patch({ period: v === "all" ? null : v });
  const setQuick = (v: QuickFilter | null) => patch({ snabb: v });
  const setLimit = (n: number) => patch({ visa: n > PAGE_SIZE ? n : null });
  const narrow = useNarrow();
  const all = data.rows;
  const counts = useMemo(
    () => ({
      overdue: all.filter((x) => x.overdue).length,
      week: all.filter((x) => x.week).length,
      approval: all.filter((x) => x.next.key === "approval").length,
      deliver: all.filter((x) => x.next.key === "deliver").length,
    }),
    [all],
  );
  const blockedWeek = all.filter((x) => (x.week || x.overdue) && x.next.key === "blocked").length;
  const search = text.trim().toLowerCase();
  const rows = sortRows(
    all.filter(
      (x) =>
        (kind === "all" || x.kind === kind) &&
        (status === "all" || x.eff === status) &&
        (period === "all" || ((x.periodStart || "") <= monthEnd(period) && (x.periodEnd || x.periodStart || "") >= `${period}-01`)) &&
        (!quick || (quick === "overdue" ? x.overdue : quick === "week" ? x.week : x.next.key === quick)) &&
        (!search || x.search.includes(search)),
    ),
  );
  const shown = rows.slice(0, limit);
  const anyFilter = kind !== "all" || status !== "all" || period !== "all" || !!quick || !!search;
  const reset = () => {
    setKind("all");
    setStatus("all");
    setPeriod("all");
    setQuick(null);
    setText("");
    setLimit(PAGE_SIZE);
  };
  const toggleQuick = (k: QuickFilter) => {
    setQuick(quick === k ? null : k);
    setLimit(PAGE_SIZE);
  };
  const hrefOf = (x: ReportListRow) => `/rapporter/${encodeURIComponent(x.id)}`;
  const columns: Column<ReportListRow>[] = [
    {
      key: "title", label: "Rapport",
      // Rubriken är en riktig länk (ny flik med ctrl/cmd eller mittenklick); klick i resten av raden öppnar också rapporten.
      render: (x) => (
        <div className="flex min-w-[200px] flex-col gap-0.5">
          <Link to={hrefOf(x)} className="inline-flex min-h-11 items-center font-bold underline underline-offset-3">
            {x.title}
          </Link>
          <span className="text-small text-text-muted">{x.sub}</span>
        </div>
      ),
    },
    {
      key: "status", label: "Status",
      render: (x) => (
        <div className="flex min-w-[170px] flex-col items-start gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <ReportStatusBadge eff={x.eff} label={x.statusLabel} />
            {x.overdue && (
              <Badge tone="red" icon="alert">
                Försenad
              </Badge>
            )}
          </div>
          <span className="text-small text-text-muted">{x.next.label}</span>
        </div>
      ),
    },
    { key: "due", label: "Förfaller", render: (x) => <DueCell r={x} /> },
    { key: "version", label: "Version", num: true, render: (x) => <span className="whitespace-nowrap">{x.version}</span> },
  ];
  const coach = data.coach;
  return (
    <Page
      title="Rapporter"
      eyebrow={coach ? "Dina ärenden" : `${data.customerName} · avtal ${data.contractNumber}`}
      lead={
        coach
          ? "Månadsrapporter, slutrapporter och orderbekräftelser för dina ärenden, och veckorapporter där du har deltagare. Rapporterna byggs bara av godkända uppgifter."
          : "Alla rapporter till kommunen: veckorapporter, månadsrapporter, slutrapporter, orderbekräftelser och beställarrapporter. Rapporterna byggs bara av godkända uppgifter och levereras i portalen."
      }
      actions={<PerspectiveLink role="kommun_handlaggare" to="/portal/rapporter" label="Se kommunens rapportsida" />}
    >
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,165px),1fr))" }}>
        <Tile label="Försenade" value={counts.overdue} alert={counts.overdue > 0} active={quick === "overdue"} onClick={() => toggleQuick("overdue")}
          sub={counts.overdue > 0 ? "Förfallotiden har passerat. Vitesrisk." : "Inga försenade rapporter."} />
        <Tile label="Förfaller denna vecka" value={counts.week} active={quick === "week"} onClick={() => toggleQuick("week")}
          sub={`Till och med ${fmtDateShort(data.weekEnd)}.${blockedWeek > 0 ? ` ${blockedWeek} väntar på underlag.` : ""}`} />
        <Tile label="Väntar på godkännande" value={counts.approval} active={quick === "approval"} onClick={() => toggleQuick("approval")} sub="Underlaget är godkänt." />
        <Tile label="Väntar på leverans" value={counts.deliver} active={quick === "deliver"} onClick={() => toggleQuick("deliver")} sub="Godkända men inte levererade." />
      </div>
      <Card title="Filter" icon="filter" actions={anyFilter ? <Button kind="ghost" icon="x" onClick={reset}>Rensa filter</Button> : null}>
        <Grid cols={4}>
          <Field label="Typ" id="rap-kind">
            <Select value={kind} onValueChange={(v) => { setKind(v); setLimit(PAGE_SIZE); }}
              options={[{ value: "all", label: "Alla typer" }, ...REPORT_LIST_KINDS.map((k) => ({ value: k, label: reportKindLabel(k) }))]} />
          </Field>
          <Field label="Status" id="rap-status">
            <Select value={status} onValueChange={(v) => { setStatus(v); setLimit(PAGE_SIZE); }}
              options={[{ value: "all", label: "Alla statusar" }, ...REPORT_LIST_STATUSES.map((s) => ({ value: s, label: reportStatusLabel(s) }))]} />
          </Field>
          <Field label="Period" id="rap-period">
            <Select value={period} onValueChange={(v) => { setPeriod(v); setLimit(PAGE_SIZE); }}
              options={[{ value: "all", label: "Hela avtalsperioden" }, ...data.months.map((mk) => ({ value: mk, label: ucfirst(monthName(mk)) }))]} />
          </Field>
          <Field label="Sök" id="rap-q">
            <Input type="search" value={text} onValueChange={(v) => { setText(v); setLimit(PAGE_SIZE); }} placeholder="Ärendenummer eller namn" />
          </Field>
        </Grid>
      </Card>
      <Card
        flush
        title={`${num(rows.length)} ${rows.length === 1 ? "rapport" : "rapporter"}${quick ? ` · ${QUICK_FILTERS[quick].toLowerCase()}` : ""}`}
        actions={<span className="text-small text-text-muted">Mest brådskande först</span>}
        foot={
          rows.length > limit ? (
            <>
              <Button kind="secondary" icon="chevron-down" onClick={() => setLimit(limit + PAGE_SIZE)}>
                Visa {Math.min(PAGE_SIZE, rows.length - limit)} till
              </Button>
              <span className="text-small text-text-muted">
                Visar {shown.length} av {num(rows.length)}
              </span>
            </>
          ) : null
        }
      >
        {narrow ? (
          <List>
            {shown.length === 0 ? (
              <div className="px-[18px] py-3 text-text-muted">Inga rapporter matchar filtret.</div>
            ) : (
              shown.map((x) => (
                <ListItem key={x.id} to={hrefOf(x)} marked={x.overdue} chevron title={x.title} sub={x.sub}>
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <ReportStatusBadge eff={x.eff} label={x.statusLabel} />
                    {x.sla && <SlaBadge sla={x.sla} dueAt={x.dueAt} />}
                  </span>
                  <span className="block text-small text-text-muted">
                    {x.next.label}
                    {x.version > 1 ? ` · version ${x.version}` : ""}
                  </span>
                  {!x.delivered && <ProvisionalNote text={x.provisional} />}
                </ListItem>
              ))
            )}
          </List>
        ) : (
          <Table columns={columns} rows={shown} caption="Rapporter" empty="Inga rapporter matchar filtret." rowTone={(x) => (x.overdue ? "alert" : null)} rowHref={hrefOf} linkKey={false} />
        )}
      </Card>
      <Card title="Så fungerar rapporterna" icon="info">
        <Stack>
          <Stepper steps={LIFECYCLE} current={-1} />
          <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
            <li>Rapporter byggs bara av godkända uppgifter: registrerad närvaro, godkända avstämningar och godkända månadsbedömningar.</li>
            <li>Coachen granskar och godkänner. Samordnaren kan kvalitetsgranska innan leverans (valfritt).</li>
            <li>Leveransen sker i kommunens portal. Mejlet innehåller bara en notis utan personuppgifter.{data.emailAttachmentAllowed ? "" : " Bilaga i e-post är avstängd."}</li>
            <li>När mottagaren öppnar rapporten första gången blir den kvitterad.</li>
            <li>Rättelse skapar en ny version. Den gamla versionen sparas, och kommunen ser den tills den nya versionen är levererad.</li>
            <li>En levererad rapport är låst. Den visas som den såg ut vid leveransen, även om underlaget ändras senare.</li>
          </ul>
        </Stack>
      </Card>
      <DemoNote>
        Listan räknas fram ur demodata. Förfallotider för månads-, slut- och beställarrapporter är förslag tills {data.customerName} har fastställt dem (&quot;{NO_DUE}&quot;).
      </DemoNote>
    </Page>
  );
}
