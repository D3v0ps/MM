"use client";
// Förfaller i dag och denna vecka (/forfaller) – port av prototypens vy sam.deadlines (SPEC §7.13).
import { Fragment, useState } from "react";
import { useQuery } from "@/shell/backend";
import { Badge, Card, CaseLink, CellSub, DemoNote, Empty, ErrorNotice, Grid, Icon, Kpi, Loading, Notice, Page, PerspectiveLink, Seg, SlaBadge, Table, TitleLink, type Column } from "@/ui";
import { inboxDeadlines, type DeadlinesView } from "../api";
import { DL_KIND, dlDesc, groupDeadlines, kindLabel, type DeadlineGroupRow, type DeadlineKindKey } from "../texts";
import { Caps, ProvBadge } from "./parts";

export function ForfallerScreen() {
  const q = useQuery(inboxDeadlines, {});
  return (
    <Page
      title="Förfaller i dag och denna vecka"
      eyebrow={q.data?.eyebrow}
      lead="Allt som förfaller inom 7 dagar enligt avtalets SLA-regler, räknat i arbetsdagar med svenska helgdagar. Det som passerat sista dag markeras och eskaleras: coach → samordnare → chef."
      actions={<PerspectiveLink role="kommun_handlaggare" to="/portal/rapporter" label="Se vad kommunen får levererat" />}
    >
      {q.error ? <ErrorNotice error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Loading /> : <Deadlines v={q.data} />}
      <DemoNote>
        Förfallotiderna räknas fram av SLA-reglerna och demoklockan. I tjänsten sparas de som rader med förfallotid och tidpunkt för leverans, så att ni kan visa vad som
        levererades och när om kommunen skulle hävda en avvikelse.
      </DemoNote>
    </Page>
  );
}

const BUCKETS: [DeadlineGroupRow["bucket"], string, "alert" | "clock" | "calendar", "red" | undefined, string | null][] = [
  ["overdue", "Försenat", "alert", "red", "Det som passerat sista dag eskaleras: coach → samordnare → chef."],
  ["today", "I dag", "clock", undefined, null],
  ["week", "Denna vecka", "calendar", undefined, null],
];

/** Eskaleringsväg: i tid = ägaren; passerad = nästa steg; mer än ett dygn = sista steget. */
function EscPath({ chain, step }: { chain: string[]; step: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-small text-text-muted" aria-label={`Eskaleringsväg: ${chain.join(", ")}. Ligger nu hos ${chain[step]}.`}>
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

function Deadlines({ v }: { v: DeadlinesView }) {
  const [kind, setKind] = useState<"alla" | DeadlineKindKey>("alla");
  const all = v.rows;
  const counts = new Map<string, number>();
  for (const x of all) counts.set(x.kind, (counts.get(x.kind) ?? 0) + 1);
  const filtered = all.filter((x) => kind === "alla" || x.kind === kind);
  const n = (b: string) => all.filter((x) => x.bucket === b).length;
  const prov = all.filter((x) => x.provisional).length;
  const options = [
    { value: "alla" as const, label: `Alla (${all.length})` },
    ...(Object.keys(DL_KIND) as DeadlineKindKey[]).filter((k) => counts.get(k)).map((k) => ({ value: k, label: `${kindLabel(k)} (${counts.get(k)})` })),
  ];
  const customerNote = (
    <Notice tone="info" icon="eye-off" title="Kommunen ser inte den här listan">Avtalskonfigurationen visar inte SLA-statistik för kommunen. Kommunen ser det som levereras i portalen.</Notice>
  );
  // Inget förfaller inom sju dagar (till exempel tom databas): en ruta i stället för fyra nollor och tre tomma tabeller.
  if (all.length === 0) {
    return (
      <>
        <Card>
          <Empty icon="check-circle" title="Inget förfaller den här veckan">
            Svar på avrop, första möten, veckorapporter och månadsrapporter dyker upp här sju dagar innan sista dag.
          </Empty>
        </Card>
        {customerNote}
      </>
    );
  }
  return (
    <>
      <Grid cols={4} className="max-[620px]:grid-cols-2 max-[620px]:gap-2.5">
        <Kpi label="Försenat" value={n("overdue")} tone={n("overdue") > 0 ? "alert" : undefined} statusText="Passerat sista dag" sub="Coach → samordnare → chef" />
        <Kpi label="I dag" value={n("today")} sub={`Senast ${v.today}`} />
        <Kpi label="Denna vecka" value={n("week")} sub="Inom 7 dagar" />
        <Kpi label="Ej fastställda" value={prov} sub="Regeln ska bekräftas med Botkyrka" />
      </Grid>
      {/* Typfiltret bara när det finns mer än en typ att välja mellan. */}
      {options.length > 1 && (
        <div className="flex flex-col gap-2">
          <Caps>Visa typ</Caps>
          <Seg ariaLabel="Filtrera på typ" value={kind} onValueChange={setKind} options={options} />
        </div>
      )}
      {BUCKETS.map(([b, title, icon, tone, sub]) => {
        const inBucket = filtered.filter((x) => x.bucket === b);
        const rows = groupDeadlines(inBucket, v.reportsHref);
        return (
          <Card key={b} title={`${title} (${inBucket.length})`} icon={icon} tone={rows.length > 0 ? tone : undefined} flush actions={sub && rows.length > 0 ? <span className="text-text-muted">{sub}</span> : null}>
            <DeadlineTable rows={rows} />
          </Card>
        );
      })}
      {v.unsetText && (
        <Notice tone="info" title="Märkningen Ej fastställd med Botkyrka">
          Förfallotiderna bygger på förslag i avtalskonfigurationen tills Botkyrka bekräftat: {v.unsetText}.
        </Notice>
      )}
      {customerNote}
    </>
  );
}
