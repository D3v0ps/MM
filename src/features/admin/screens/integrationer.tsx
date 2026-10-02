"use client";
// Underbiträden och integrationer (/admin/integrationer, prototypens admin.integrationer): var personuppgifterna behandlas,
// vilka tjänster Miljonmatch är kopplad till och hur bakgrundsjobben går. Integrationerna och jobben är simulerade i prototypen.
import type { ReactNode } from "react";
import { fmtDate, fmtDateTime } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { Badge, BuildPhase, Button, Card, CellSub, DemoNote, Grid, Icon, Kpi, Notice, Page, QueryView, Section, Split, Stack, Table, toast } from "@/ui";
import { TestDataReset } from "@/features/session/screens/test-data-reset";
import {
  adminIntegrations, adminRunJob, type DataProtectionView, type IntegrationStatus, type IntegrationsView, type JobRow, type JobStatusView, type SubprocessorStatus,
} from "../api";
import { KV, Masonry } from "./parts";

const INT_STATUS: Record<IntegrationStatus, ReactNode> = {
  active: <Badge tone="blue" icon="check-circle">Aktiv</Badge>,
  test: <Badge tone="bluetone" icon="sparkles">Test</Badge>,
  chosen: <Badge tone="bluetone" icon="clock">Vald – väntar på kommunens godkännande</Badge>,
  off: <Badge tone="grey" icon="minus-circle">Ej ansluten</Badge>,
  notchosen: <Badge tone="outline" icon="alert-circle">Ej vald</Badge>,
};
const JOB_STATUS: Record<JobStatusView, ReactNode> = {
  ok: <Badge tone="blue" icon="check">Klar</Badge>,
  waiting: <Badge tone="grey" icon="clock">Väntar</Badge>,
  disabled: <Badge tone="outline" icon="minus-circle">Inte aktiverad</Badge>,
  failed: <Badge tone="red" icon="alert">Fel</Badge>,
};

export function IntegrationerScreen() {
  const q = useQuery(adminIntegrations, {});
  return (
    <Page
      title="Underbiträden och integrationer"
      eyebrow="Systemadmin"
      lead="Var personuppgifterna behandlas, vilka tjänster Miljonmatch är kopplad till och hur bakgrundsjobben går. All data ligger i Stockholm."
    >
      {/* Bara testare i testmiljön: "Läs in testdata på nytt" (renderar ingenting för alla andra och i prototypen). */}
      <TestDataReset />
      <QueryView query={q}>{(d) => <IntegrationsContent d={d} />}</QueryView>
    </Page>
  );
}

function IntegrationsContent({ d }: { d: IntegrationsView }) {
  const run = useCommand(adminRunJob);
  // Korten byggs på servern (admin.integrations), så att leverantörerna och regionerna inte ligger i webbläsarens kod.
  const INT = d.integrations;
  const active = INT.filter((x) => x.status === "active").length;
  const runJob = async (j: JobRow) => {
    const r = await run.run({ key: j.key as never }).catch(() => null);
    if (!r || !r.ok) toast(r && !r.ok && r.message ? r.message : "Jobbet kunde inte köras.", "error");
    else toast(`${j.name} kördes (simulerat).`);
  };
  const dp = d.dataProtection;
  return (
    <>
      <Grid cols={dp ? 4 : 3}>
        {dp && <SubprocessorKpi dp={dp} />}
        <Kpi label="Integrationer" value={`${active} av ${INT.length}`} sub="aktiva" />
        <Kpi label="Bakgrundsjobb" value={d.jobs.length} sub={`${d.jobs.filter((j) => j.status === "failed").length} fel senaste dygnet`} />
        <Kpi label="Data lagras i" value={d.storage.place} sub={d.storage.detail} />
      </Grid>

      {/* Saknas för begränsade testare (servern lämnar inte ut uppgifterna). */}
      {dp ? (
        <DataProtection dp={dp} />
      ) : (
        <Notice tone="info">Underbiträdena, regionlåsningen och kommunens villkor visas inte för testare.</Notice>
      )}

      <Section title="Integrationer">
        <Masonry
          items={INT.map((x) => (
            <Card key={x.id} title={x.name} icon={x.icon} actions={<>{x.phase && <BuildPhase fas={x.phase} />}{INT_STATUS[x.status]}</>}>
              <Stack gap="sm">
                <p className="text-text-muted">{x.sub}</p>
                <KV items={x.items} />
              </Stack>
            </Card>
          ))}
        />
      </Section>

      <Card
        title="Bakgrundsjobb (tabellen jobs)"
        icon="refresh"
        flush
        foot={<span className="text-small text-text-muted">En skyddad route körs av cron varje minut. Jobben hämtas med FOR UPDATE SKIP LOCKED, är idempotenta, har ett begränsat antal försök och sparar felorsaken.</span>}
      >
        <Table
          caption="Bakgrundsjobb"
          rows={d.jobs}
          rowKey="key"
          columns={[
            {
              key: "name", label: "Jobb och schema",
              render: (j) => (
                <>
                  <span className="font-bold">{j.name}</span>
                  <CellSub>{j.schedule}</CellSub>
                  {j.phase && <div className="mt-1"><BuildPhase fas={j.phase} /></div>}
                </>
              ),
            },
            { key: "last", label: "Senaste körning", nowrap: true, render: (j) => (j.last ? <>{fmtDateTime(j.last)}{j.manual && <CellSub>Manuellt av {j.manualBy}</CellSub>}</> : "–") },
            { key: "status", label: "Status", render: (j) => JOB_STATUS[j.status] },
            { key: "result", label: "Resultat", render: (j) => <span className="text-small">{j.result}</span> },
            {
              key: "run", label: "Kör",
              render: (j) => (
                <Button kind="ghost" icon="play" disabled={j.disabled} title={`Kör ${j.name.toLowerCase()} nu`} onClick={() => void runJob(j)}>
                  Kör nu
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <DemoNote>Integrationerna och jobben är simulerade. &quot;Kör nu&quot; loggas i revisionsloggen men läser inga riktiga mejl och raderar ingenting.</DemoNote>
    </>
  );
}

function SubprocessorKpi({ dp }: { dp: DataProtectionView }) {
  const n = (st: SubprocessorStatus[]) => dp.subprocessors.filter((s) => st.includes(s.status)).length;
  const approved = n(["approved", "approved_test"]);
  const pending = n(["chosen"]);
  const notChosen = n(["not_chosen"]);
  const parts = [
    `${approved} ${approved === 1 ? "godkänd" : "godkända"}`,
    pending ? `${pending} väntar på godkännande` : null,
    notChosen ? `${notChosen} ej ${notChosen === 1 ? "vald" : "valda"}` : null,
  ];
  return <Kpi label="Underbiträden" value={dp.subprocessors.length} sub={parts.filter(Boolean).join(", ")} />;
}

/** Underbiträdena, Botkyrkas besked, regionlåsningen och "Så ser kommunen det" (bara för den som får se dem). */
function DataProtection({ dp }: { dp: DataProtectionView }) {
  const subStatus = (s: SubprocessorStatus) =>
    s === "approved" ? (
      <>
        <Badge tone="blue" icon="check">Godkänd</Badge>
        <CellSub>{fmtDate(dp.approvedOn)}</CellSub>
      </>
    ) : s === "approved_test" ? (
      <>
        <Badge tone="blue" icon="check">Godkänd</Badge>
        <CellSub>{fmtDate(dp.approvedOn)} · simulerad tills kontot i Google Cloud finns</CellSub>
      </>
    ) : s === "chosen" ? (
      <Badge tone="bluetone" icon="clock">Vald – väntar på kommunens godkännande</Badge>
    ) : (
      <Badge tone="outline" icon="alert-circle">Ej vald – fråga 18</Badge>
    );
  // Regionlåsningens punkter kommer från servern (leverantörer och regioner ligger inte i webbläsarens kod).
  const regions = dp.regions;
  // Botkyrkas besked gäller underbiträdena som fanns då – en leverantör som valts senare väntar på godkännande.
  const pending = dp.subprocessors.filter((s) => s.status === "chosen").map((s) => s.name);
  const title = `Botkyrka godkände underbiträdena ${fmtDate(dp.approvedOn)}${pending.length ? ` – ${pending.join(", ")} väntar på godkännande` : ""}`;
  return (
    <>
      <Notice tone="warn" title={title}>
        Beskedet ska in skriftligt i PUB-avtalets bilaga (förteckning över underbiträden), tillsammans med ett uttryckligt godkännande av eventuell åtkomst från tredje land – till exempel leverantörernas support. Det är ett förberedande steg (fas 0) som inte är klart ännu.
      </Notice>

      <Card
        title="Underbiträden"
        icon="shield"
        flush
        foot={<span className="text-small text-text-muted">Listan hålls kort. Ett nytt verktyg som behandlar personuppgifter – till exempel felrapportering – läggs till här och godkänns av kommunen först.</span>}
      >
        <Table
          caption="Underbiträden"
          rows={dp.subprocessors}
          columns={[
            { key: "name", label: "Leverantör", render: (s) => <span className="font-bold">{s.name}</span> },
            { key: "what", label: "Behandling" },
            { key: "where", label: "Plats", render: (s) => (<>{s.where}{s.us && <CellSub>Amerikanskt bolag – åtkomst från tredje land ska godkännas skriftligt</CellSub>}</>) },
            { key: "status", label: "Status", render: (s) => subStatus(s.status) },
          ]}
        />
      </Card>

      <Split>
        <Card title="Regionlåsning" icon="map-pin">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {regions.map((t, i) => (
              <li key={i} className="flex flex-nowrap items-start gap-1.5">
                <Icon name="check-circle" className="mt-0.5 flex-none" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Så ser kommunen det" icon="building">
          <Stack gap="sm">
            <p>Underbiträdesförteckningen och instruktionerna ingår i PUB-avtalet med Botkyrka. Kommunen är personuppgiftsansvarig och Miljonbemanning är personuppgiftsbiträde.</p>
            <p className="text-small text-text-muted">
              Vid avtalsslut lämnas data tillbaka inom {dp.returnDataWithinDays ?? "–"} dagar och raderas sedan. Incidenter rapporteras till kommunen enligt PUB-avtalet.
            </p>
          </Stack>
        </Card>
      </Split>
    </>
  );
}
