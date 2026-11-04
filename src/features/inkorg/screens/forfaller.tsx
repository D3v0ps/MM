"use client";
// Förfaller i dag och denna vecka (/forfaller) – port av prototypens vy sam.deadlines (SPEC §7.13). Paket 2 (S7): förvalet
// "Mitt ansvar" med knappen Alla, regler som inte är fastställda i en fotnot och kort i stället för tabellen på smal skärm.
import { Fragment, useState } from "react";
import { useQuery } from "@/shell/backend";
import { Badge, Card, CaseLink, CellSub, cn, Empty, ErrorNotice, Grid, Icon, Kpi, Loading, Notice, Page, PerspectiveLink, Seg, SlaBadge, Table, TitleLink, type Column } from "@/ui";
import { inboxDeadlines, type DeadlinesView } from "../api";
import { DL_KIND, dlDesc, groupDeadlines, kindLabel, type DeadlineGroupRow, type DeadlineKindKey } from "../texts";
import { Caps, ProvBadge } from "./parts";

export function ForfallerScreen() {
  const q = useQuery(inboxDeadlines, {});
  return (
    <Page
      title="Förfaller i dag och denna vecka"
      eyebrow={q.data?.eyebrow}
      lead="Allt som förfaller inom 7 dagar, räknat i arbetsdagar."
      actions={<PerspectiveLink role="kommun_handlaggare" to="/portal/rapporter" label="Se vad kommunen får levererat" />}
    >
      {q.error ? <ErrorNotice error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Loading /> : <Deadlines v={q.data} />}
    </Page>
  );
}

const BUCKETS: [DeadlineGroupRow["bucket"], string, "alert" | "clock" | "calendar", "red" | undefined, string | null][] = [
  ["overdue", "Försenat", "alert", "red", "Det som passerat sista dag eskaleras: coach → samordnare → chef."],
  ["today", "I dag", "clock", undefined, null],
  ["week", "Denna vecka", "calendar", undefined, null],
];

/** Eskaleringsväg: i tid = ägaren; passerad = nästa steg; mer än ett dygn = sista steget. */
function EscPath({ chain, step, big }: { chain: string[]; step: number; big?: boolean }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-text-muted", big ? "text-body" : "text-small")} aria-label={`Eskaleringsväg: ${chain.join(", ")}. Ligger nu hos ${chain[step]}.`}>
      {chain.map((s, i) => (
        <Fragment key={s}>
          {i > 0 && <span aria-hidden="true">→</span>}
          {i === step ? <b className="text-antracit">{s}{step > 0 ? " (eskalerat)" : ""}</b> : <span>{s}</span>}
        </Fragment>
      ))}
    </span>
  );
}

function DeadlineTable({ rows }: { rows: DeadlineGroupRow[] }) {
  const columns: Column<DeadlineGroupRow>[] = [
    {
      key: "due", label: "Förfaller", render: (x) => (x.sla.tone === "ok" ? (
        <span className="inline-flex flex-nowrap items-center gap-1.5 whitespace-nowrap" title={`Förfaller ${x.dueLong}`}>
          <Icon name="clock" />
          <span className="font-bold">{x.dueWhen}</span>
        </span>
      ) : (
        <div className="flex flex-col items-start gap-1">
          <SlaBadge sla={x.sla} dueAt={x.dueAt} />
          <CellSub className="whitespace-nowrap">{x.dueWhen}</CellSub>
        </div>
      )),
    },
    {
      key: "what", label: "Vad", render: (x) => {
        const desc = dlDesc(x.kind, x.label);
        return (
          <div className="flex min-w-[190px] flex-col gap-[3px]">
            {/* Min veckas rader: rubriken är länken (hela raden går också att klicka) – ingen Öppna-knapp per rad. */}
            <span className="flex flex-nowrap items-center gap-1.5">
              <Icon name={DL_KIND[x.kind]?.icon ?? "clock"} className="flex-none" />
              <TitleLink to={x.href}>{kindLabel(x.kind)}</TitleLink>
            </span>
            {x.aggregate && <span><Badge tone="grey">{x.aggregate.count} ärenden</Badge></span>}
            {desc && <CellSub>{desc}</CellSub>}
            {x.aggregate && <span className="text-small text-text-muted">{x.aggregate.byCoach}</span>}
            {x.provisional && <span><ProvBadge /></span>}
          </div>
        );
      },
    },
    {
      key: "case", label: "Ärende", nowrap: true,
      render: (x) => (x.caseId && x.caseNumber && !x.aggregate ? <CaseLink caseId={x.caseId} caseNumber={x.caseNumber} /> : <span className="text-text-muted">{x.aggregate ? "Flera" : "–"}</span>),
    },
    {
      key: "owner", label: "Ansvarig och eskalering", render: (x) => (
        <div className="flex min-w-[170px] flex-col gap-[3px]">
          <span>{x.ownerName}</span>
          <EscPath chain={x.chain} step={x.step} />
        </div>
      ),
    },
  ];
  return (
    <Table
      caption="Det som förfaller"
      rows={rows}
      columns={columns}
      empty="Inget förfaller här."
      rowTone={(x) => (x.bucket === "overdue" ? "alert" : null)}
      rowHref={(x) => x.href}
      linkKey={false}
    />
  );
}

/** Mobilvyn (som ärendelistans): ett kort per rad i stället för en tabell som klipps. */
function DeadlineCards({ rows }: { rows: DeadlineGroupRow[] }) {
  if (!rows.length) return <p className="px-[18px] py-3 text-body text-text-muted">Inget förfaller här.</p>;
  return (
    <ul aria-label="Det som förfaller" className="m-0 flex list-none flex-col p-0">
      {rows.map((x) => {
        const desc = dlDesc(x.kind, x.label);
        return (
          <li key={x.id} className={cn("flex min-w-0 flex-col gap-1 border-b border-ljusgra px-4 py-3 last:border-b-0", x.bucket === "overdue" && "shadow-[inset_4px_0_0_var(--color-rod)]")}>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body">
              {x.sla.tone === "ok" ? (
                <span className="inline-flex items-center gap-1.5 font-bold">
                  <Icon name="clock" />
                  {x.dueWhen}
                </span>
              ) : (
                <>
                  <SlaBadge sla={x.sla} dueAt={x.dueAt} />
                  <span className="text-text-muted">{x.dueWhen}</span>
                </>
              )}
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon name={DL_KIND[x.kind]?.icon ?? "clock"} className="flex-none" />
              <TitleLink to={x.href}>{kindLabel(x.kind)}</TitleLink>
              {x.caseId && x.caseNumber && !x.aggregate ? <CaseLink caseId={x.caseId} caseNumber={x.caseNumber} /> : x.aggregate ? <Badge tone="grey">{x.aggregate.count} ärenden</Badge> : null}
            </span>
            {desc && <span className="text-body text-text-muted [overflow-wrap:anywhere]">{desc}</span>}
            {x.aggregate && <span className="text-body text-text-muted">{x.aggregate.byCoach}</span>}
            <span className="text-body">
              {x.ownerName}
              {x.provisional ? " · ej fastställd med Botkyrka" : ""}
            </span>
            <EscPath chain={x.chain} step={x.step} big />
          </li>
        );
      })}
    </ul>
  );
}

function Deadlines({ v }: { v: DeadlinesView }) {
  // S7 (paket 2): förvalet är det som är mitt ansvar – knappen Alla visar allt i avtalet.
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [kind, setKind] = useState<"alla" | DeadlineKindKey>("alla");
  const mineCount = v.rows.filter((x) => x.mine).length;
  const all = scope === "mine" ? v.rows.filter((x) => x.mine) : v.rows;
  const counts = new Map<string, number>();
  for (const x of all) counts.set(x.kind, (counts.get(x.kind) ?? 0) + 1);
  const filtered = all.filter((x) => kind === "alla" || x.kind === kind);
  const n = (b: string) => all.filter((x) => x.bucket === b).length;
  const prov = v.rows.filter((x) => x.provisional).length;
  const options = [
    { value: "alla" as const, label: `Alla typer (${all.length})` },
    ...(Object.keys(DL_KIND) as DeadlineKindKey[]).filter((k) => counts.get(k)).map((k) => ({ value: k, label: `${kindLabel(k)} (${counts.get(k)})` })),
  ];
  // Inget förfaller inom sju dagar (till exempel tom databas): en ruta i stället för fyra nollor och tre tomma tabeller.
  if (v.rows.length === 0) {
    return (
      <>
        <Card>
          <Empty icon="check-circle" title="Inget förfaller den här veckan">
            Svar på avrop, första möten, veckorapporter och månadsrapporter dyker upp här sju dagar innan sista dag.
          </Empty>
        </Card>
      </>
    );
  }
  return (
    <>
      <div className="flex flex-col gap-2">
        <Caps>Visa</Caps>
        <Seg
          ariaLabel="Visa det som är mitt ansvar eller allt"
          value={scope}
          onValueChange={(x) => {
            setScope(x);
            setKind("alla");
          }}
          options={[
            { value: "mine" as const, label: `Mitt ansvar (${mineCount})` },
            { value: "all" as const, label: `Alla (${v.rows.length})` },
          ]}
        />
      </div>
      <Grid cols={3} className="max-[620px]:grid-cols-3 max-[620px]:gap-2.5">
        <Kpi className="max-[620px]:p-3" label="Försenat" value={n("overdue")} tone={n("overdue") > 0 ? "alert" : undefined} statusText="Passerat sista dag" sub="Coach → samordnare → chef" />
        <Kpi className="max-[620px]:p-3" label="I dag" value={n("today")} sub={`Senast ${v.today}`} />
        <Kpi className="max-[620px]:p-3" label="Denna vecka" value={n("week")} sub="Inom 7 dagar" />
      </Grid>
      {/* Typfiltret bara när det finns mer än en typ att välja mellan. */}
      {options.length > 2 && (
        <div className="flex flex-col gap-2">
          <Caps>Visa typ</Caps>
          <Seg ariaLabel="Filtrera på typ" value={kind} onValueChange={setKind} options={options} />
        </div>
      )}
      {all.length === 0 && (
        <Notice tone="info" title="Inget som är ditt ansvar förfaller den här veckan">
          Tryck på Alla för att se allt som förfaller i avtalet.
        </Notice>
      )}
      {all.length > 0 &&
        BUCKETS.map(([b, title, icon, tone, sub]) => {
          const inBucket = filtered.filter((x) => x.bucket === b);
          const rows = groupDeadlines(inBucket, v.reportsHref);
          return (
            <Card key={b} title={`${title} (${inBucket.length})`} icon={icon} tone={rows.length > 0 ? tone : undefined} flush actions={sub && rows.length > 0 ? <span className="text-text-muted max-[760px]:hidden">{sub}</span> : null}>
              <div className="max-[760px]:hidden">
                <DeadlineTable rows={rows} />
              </div>
              <div className="hidden max-[760px]:block">
                <DeadlineCards rows={rows} />
              </div>
            </Card>
          );
        })}
      {/* Fotnot (S7): regler som inte är fastställda med kommunen. */}
      {v.unsetText && (
        <p className="m-0 max-w-[80ch] text-body text-text-muted">
          <Icon name="info" className="mr-1.5 inline align-[-3px]" />
          Ej fastställd med Botkyrka{prov ? ` (${prov} ${prov === 1 ? "förfallotid" : "förfallotider"})` : ""}: förfallotiden bygger på ett förslag i avtalskonfigurationen tills
          Botkyrka bekräftat – {v.unsetText}.
        </p>
      )}
    </>
  );
}
