"use client";
// Underbiträden och integrationer (/admin/integrationer, prototypens admin.integrationer): var personuppgifterna behandlas,
// vilka tjänster Miljonmatch är kopplad till och hur bakgrundsjobben går. Integrationerna och jobben är simulerade i prototypen.
import type { ReactNode } from "react";
import { plural } from "@/core/format";
import { fmtDate, fmtDateTime, fmtTime } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { Badge, BuildPhase, Button, Card, CellSub, DemoNote, Grid, Icon, Kpi, Notice, Page, QueryView, Section, Split, Stack, Table, toast, type IconName } from "@/ui";
import { TestDataReset } from "@/features/session/screens/test-data-reset";
import { adminIntegrations, adminRunJob, type IntegrationsView, type JobRow, type JobStatusView } from "../api";
import { KV, Masonry } from "./parts";

type SubStatus = "approved" | "approved_test" | "not_chosen";
const SUBPROCESSORS: { id: string; name: string; what: string; where: string; status: SubStatus; us: boolean }[] = [
  { id: "supabase", name: "Supabase", what: "Databas, inloggning och fillagring", where: "Stockholm (eu-north-1)", status: "approved", us: true },
  { id: "vercel", name: "Vercel", what: "Applikation och serverfunktioner", where: "Funktioner i Stockholm (arn1)", status: "approved", us: true },
  { id: "ai", name: "AI-leverantör (en av två)", what: "Transkribering och textutkast", where: "Berget AI: Sverige · Google: EU multi-region", status: "approved_test", us: false },
  { id: "sms", name: "SMS-leverantör", what: "Påminnelser och pulslänkar", where: "Väljs – helst svensk", status: "not_chosen", us: false },
  { id: "epost", name: "E-postleverantör", what: "Notiser och inloggningskoder", where: "Väljs – helst inom EU", status: "not_chosen", us: false },
  { id: "microsoft", name: "Microsoft", what: "Inloggning (Entra ID) och avrop@-brevlådan (Graph)", where: "Befintligt Microsoft 365", status: "approved", us: true },
];

type IntStatus = "active" | "test" | "off" | "notchosen";
type Integration = { id: string; name: string; sub: string; icon: IconName; status: IntStatus; phase?: number; items: [string, string][] };

const INT_STATUS: Record<IntStatus, ReactNode> = {
  active: <Badge tone="blue" icon="check-circle">Aktiv</Badge>,
  test: <Badge tone="bluetone" icon="sparkles">Test</Badge>,
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
  const INT: Integration[] = [
    { id: "graph", name: "avrop@-brevlådan", sub: "Microsoft Graph", icon: "inbox", status: "active",
      items: [["Läses", "Var 2–5 minut"], ["Senast läst", `I dag kl. ${fmtTime(d.inboxReadAt)}`], ["Senaste mejl", d.latestMail ? fmtDateTime(d.latestMail) : "–"], ["Svar skickas", "Från avrop@ i samma tråd, så att kommunen ser hela konversationen"]] },
    { id: "entra", name: "Microsoft Entra ID", sub: "Inloggning för Miljonbemanning", icon: "key", status: "active", items: [["MFA", "Styrs av Microsoft 365"], ["Konton", "Bara inbjudna – ingen självregistrering"]] },
    { id: "fortnox", name: "Fortnox", sub: "Fakturor som Peppol BIS Billing 3", icon: "card", status: "off", phase: 2,
      items: [["Reserv i dag", "Export till Excel och PDF, eller Botkyrkas fakturaportal"], ["Öppen fråga", "Fråga 15: ingår Fortnox Integration och e-faktura i Miljonbemannings paket?"], ["Krav", "Omkörning får inte skapa dubbletter. Status synkas tillbaka."]] },
    { id: "sms", name: "SMS-leverantör", sub: "Påminnelser och pulslänkar", icon: "message", status: "notchosen",
      items: [["Öppen fråga", "Fråga 18: val av SMS- och e-postleverantör"], ["Önskemål", "Svensk leverantör med API"], ["Innehåll", "Bara tid, plats och telefonnummer – aldrig personuppgifter"]] },
    { id: "email", name: "E-postleverantör", sub: "Notiser och inloggningskoder", icon: "mail", status: "notchosen",
      items: [["Krav", "EU-baserad, med SMTP för inloggningskoder, SPF, DKIM och DMARC"], ["SPF", "En domän får bara ha en SPF-post – leverantörens include läggs i den befintliga posten för Microsoft 365"], ["Alternativ", "Graph sendMail från en egen brevlåda i Microsoft 365"]] },
    { id: "ai", name: "AI-leverantör", sub: "Transkribering och textutkast", icon: "sparkles", status: "test", phase: 2,
      items: [["I test", "Berget AI (Sverige)"], ["Alternativ", "Gemini via Vertex AI med EU-endpoint"], ["Aldrig", "AI Studio-nyckel eller global endpoint"], ["Anrop", `Bara via adaptern lib/ai/ – ${plural(d.aiRunCount, "körning", "körningar")} i prototypen`]] },
  ];
  const active = INT.filter((x) => x.status === "active").length;
  const approved = SUBPROCESSORS.filter((s) => s.status !== "not_chosen").length;
  const runJob = async (j: JobRow) => {
    const r = await run.run({ key: j.key as never }).catch(() => null);
    if (!r || !r.ok) toast(r && !r.ok && r.message ? r.message : "Jobbet kunde inte köras.", "error");
    else toast(`${j.name} kördes (simulerat).`);
  };
  const subStatus = (s: SubStatus) =>
    s === "approved" ? (
      <>
        <Badge tone="blue" icon="check">Godkänd</Badge>
        <CellSub>{fmtDate(d.approvedOn)}</CellSub>
      </>
    ) : s === "approved_test" ? (
      <Badge tone="bluetone" icon="check">Godkänd – väljs genom test</Badge>
    ) : (
      <Badge tone="outline" icon="alert-circle">Ej vald – fråga 18</Badge>
    );
  const regions = [
    "Supabase-projekten (produktion och staging) ligger i eu-north-1, Stockholm.",
    'Vercel-funktioner körs i arn1, Stockholm. vercel.json innehåller "regions": ["arn1"] – standardregionen iad1 (USA) används inte.',
    "Persondata behandlas bara i serverfunktionerna i arn1 – inte i Supabase Edge Functions, som körs närmast anroparen.",
    "Inga Vercel-specifika lagringstjänster (Blob, Edge Config) för persondata. Appen kan flyttas till annan drift.",
    d.thirdCountryForbidden ? "Behandling utanför EU/EES är förbjuden utan kommunens skriftliga förhandsgodkännande (avtalskonfigurationen)." : "Behandling utanför EU/EES enligt avtalet.",
  ];
  return (
    <>
      <Grid cols={4}>
        <Kpi label="Underbiträden" value={SUBPROCESSORS.length} sub={`${approved} godkända, ${SUBPROCESSORS.length - approved} ej valda`} />
        <Kpi label="Integrationer" value={`${active} av ${INT.length}`} sub="aktiva" />
        <Kpi label="Bakgrundsjobb" value={d.jobs.length} sub={`${d.jobs.filter((j) => j.status === "failed").length} fel senaste dygnet`} />
        <Kpi label="Data lagras i" value="Stockholm" sub="Supabase eu-north-1 · Vercel arn1" />
      </Grid>

      <Notice tone="warn" title={`Botkyrka godkände underbiträdena ${fmtDate(d.approvedOn)}`}>
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
          rows={SUBPROCESSORS}
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
              Vid avtalsslut lämnas data tillbaka inom {d.returnDataWithinDays ?? "–"} dagar och raderas sedan. Incidenter rapporteras till kommunen enligt PUB-avtalet.
            </p>
          </Stack>
        </Card>
      </Split>

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
