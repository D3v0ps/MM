"use client";
// Tillfällig granskningssida (/ui): alla komponenter och varianter i MB:s profil. Påhittade exempelvärden – inga personuppgifter.
import { useState } from "react";
import {
  AiBox,
  AiTag,
  Avatar,
  Badge,
  BigButton,
  BigButtons,
  BuildPhase,
  Button,
  Card,
  CaseLink,
  CaseStatusBadge,
  CellSub,
  Chart,
  Check,
  DateInput,
  DemoNote,
  Divider,
  Drawer,
  Empty,
  ErrorNotice,
  Evidence,
  Eyebrow,
  Field,
  FormGrid,
  Grid,
  ICON_NAMES,
  Icon,
  Input,
  Kpi,
  Kv,
  List,
  ListItem,
  Loading,
  MaskedPnr,
  Meter,
  Modal,
  Notice,
  Page,
  Paper,
  PaperFixedText,
  PerspectiveLink,
  PhaseBar,
  PhaseTag,
  PulsePhone,
  RecIndicator,
  Row,
  Section,
  Seg,
  Select,
  SlaBadge,
  Smiley,
  Smileys,
  Split,
  Stack,
  Status,
  Stepper,
  Table,
  TabPanel,
  Tabs,
  TextArea,
  TimeInput,
  Timeline,
  UserName,
  XBox,
  useConfirm,
  useCopy,
  useDownload,
  useTextDialog,
  useToast,
  type BadgeTone,
  type CaseStatusValue,
  type Column,
  type SlaTone,
} from "@/ui";

type Row1 = { id: string; caseId: string; number: string; name: string; phase: number; status: CaseStatusValue; amountOre: number; tone?: "alert" | "muted" | "selected" };
const ROWS: Row1[] = [
  { id: "r1", caseId: "case-demo-1", number: "BOT-27-0048", name: "Deltagare A", phase: 4, status: "active", amountOre: 1_523_00, tone: "alert" },
  { id: "r2", caseId: "case-demo-2", number: "BOT-27-0049", name: "Deltagare B", phase: 1, status: "acknowledged", amountOre: 0 },
  { id: "r3", caseId: "case-demo-3", number: "BOT-26-0143", name: "Deltagare C", phase: 5, status: "closed", amountOre: 4_120_00, tone: "muted" },
  { id: "r4", caseId: "case-demo-4", number: "BOT-26-0112", name: "Deltagare D", phase: 2, status: "paused", amountOre: 890_50, tone: "selected" },
];

export function UiShowcase() {
  const toast = useToast();
  const confirm = useConfirm();
  const showText = useTextDialog();
  const download = useDownload();
  const copy = useCopy();
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState<"oversikt" | "narvaro" | "rapporter">("oversikt");
  const [status, setStatus] = useState<"green" | "yellow" | "red" | null>("yellow");
  const [multi, setMulti] = useState<string[]>(["lager"]);
  const [ref, setRef] = useState("5510298");
  const [area, setArea] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("2027-02-01");
  const [time, setTime] = useState("09:12");
  const [checked, setChecked] = useState(true);
  const [smiley, setSmiley] = useState<number | null>(4);
  const [lastConfirm, setLastConfirm] = useState<string>("–");

  const columns: Column<Row1>[] = [
    { key: "number", label: "Ärende", render: (r) => <CaseLink caseId={r.caseId} caseNumber={r.number} />, nowrap: true },
    { key: "name", label: "Deltagare", render: (r) => (<><div>{r.name}</div><CellSub>Lager och logistik</CellSub></>) },
    { key: "phase", label: "Fas", render: (r) => <PhaseTag phase={r.phase} name={["Kartläggning", "Planering", "Insats", "Praktik/APL", "Avslut"][r.phase - 1]} /> },
    { key: "status", label: "Status", render: (r) => <CaseStatusBadge status={r.status} /> },
    { key: "amount", label: "Belopp", num: true, render: (r) => `${(r.amountOre / 100).toLocaleString("sv-SE")} kr` },
  ];

  return (
    <Page
      eyebrow="Utvecklare · Komponenter"
      title="Komponenter"
      lead="Granskningssida för MB:s komponentbibliotek (src/ui). Alla komponenter och varianter, med påhittade exempel."
      crumbs={[{ label: "Diagnos", to: "/diagnos" }, { label: "Komponenter" }]}
      actions={
        <>
          <Button kind="ghost" icon="download" onClick={() => void download("exempel.csv", "ärende;belopp\nBOT-27-0048;1523\n")}>
            Ladda ned exempel
          </Button>
          <Button kind="primary" icon="plus">
            Huvudåtgärd
          </Button>
        </>
      }
    >
      <Section title="Knappar">
        <Row>
          <Button kind="primary" icon="check">Primär</Button>
          <Button>Sekundär</Button>
          <Button kind="ghost" icon="arrow-left">Textknapp</Button>
          <Button kind="danger" icon="trash">Ta bort</Button>
          <Button kind="red">Röd – stor text</Button>
          <Button kind="blue" icon="send">Blå yta</Button>
          <Button icon="refresh" ariaLabel="Uppdatera" title="Uppdatera" />
          <Button kind="primary" disabled>Inaktiv</Button>
          <Button kind="primary" pending>Sparar…</Button>
          <Button to="/diagnos" iconRight="arrow-right">Länk som knapp</Button>
        </Row>
        <Row>
          <Button kind="primary" size="lg" icon="file-plus">Stor knapp</Button>
          <Button block kind="secondary" className="max-w-md">Hela bredden</Button>
        </Row>
      </Section>

      <Section title="Märken och status">
        <Row gap="sm">
          {(["blue", "bluetone", "grey", "red", "redfill", "dark", "outline", "plan"] as BadgeTone[]).map((t) => (
            <Badge key={t} tone={t} icon={t === "red" || t === "redfill" ? "alert" : undefined}>
              {t}
            </Badge>
          ))}
        </Row>
        <Row gap="sm">
          <Status value="green" />
          <Status value="yellow" />
          <Status value="red" />
          <Status value={null} />
          <Status value="green" short />
          <Status value="red" short />
        </Row>
        <Row gap="sm">
          {(["received", "acknowledged", "confirmed", "active", "paused", "closed", "declined"] as CaseStatusValue[]).map((s) => (
            <CaseStatusBadge key={s} status={s} />
          ))}
        </Row>
        <Row gap="sm">
          {(
            [
              ["ok", "Senast 2 feb kl. 08.41"],
              ["soon", "6 tim kvar"],
              ["urgent", "53 min kvar"],
              ["over", "Försenad 2 dagar"],
              ["met", "I tid"],
            ] as [SlaTone, string][]
          ).map(([tone, label]) => (
            <SlaBadge key={tone} sla={{ tone, label }} dueAt="2027-02-02T08:41" />
          ))}
          <SlaBadge sla={{ tone: "urgent", label: "53 min kvar" }} prefix="Svar:" />
        </Row>
        <Split>
          <Stack gap="sm">
            <Eyebrow>Fasbana</Eyebrow>
            <PhaseBar phase={3} />
            <Row gap="sm">
              <PhaseTag phase={4} name="Praktik/APL" />
              <BuildPhase fas={2} />
              <AiTag />
              <RecIndicator>Spelar in 03:12</RecIndicator>
            </Row>
          </Stack>
          <AiBox>
            <Row gap="sm">
              <AiTag />
              <span className="text-small text-text-muted">Förslag – coachen bedömer</span>
            </Row>
            <p>Deltagaren beskriver att arbetet på lagret går bra och att hen vill fortsätta praktiken.</p>
            <Evidence quote="Jag trivs med tempot och vill gärna stanna kvar." t={192} />
          </AiBox>
        </Split>
      </Section>

      <Section title="Nyckeltal">
        <Grid cols={4}>
          <Kpi label="Att hantera i inkorgen" value="6" tone="alert" sub="Närmast: 53 min kvar" />
          <Kpi label="Första möten ej bokade" value="1" tone="watch" statusText="Flaggat" sub="1 flaggat efter tre dagar" />
          <Kpi label="Resultatgrad" value="33,9 %" sub="Avtalets mål 32 %" />
          <Kpi label="Fakturerat januari" value="182 340 kr" sub="47 ärenden" />
        </Grid>
        <Card title="Avrop besvarade inom en arbetsdag" icon="clock">
          <Stack gap="sm">
            <div className="text-[2rem] leading-[1.1] font-extrabold tabular-nums">95,7 %</div>
            <Meter value={0.957} markers={[{ value: 1, label: "Internt mål 100 %" }, { value: 0.9, label: "Avtalets krav 90 %", tone: "red" }]} tone="blue" />
          </Stack>
        </Card>
      </Section>

      <Section title="Kort och listor">
        <Grid cols={3}>
          <Card title="Kräver åtgärd" icon="alert" tone="red">
            Kort med röd kant.
          </Card>
          <Card title="Klart" icon="check-circle" tone="blue">
            Kort med blå kant.
          </Card>
          <Card title="Tonad yta" tone="sub" foot={<Button kind="ghost">Sidfot</Button>}>
            Kort med tonad bakgrund och sidfot.
          </Card>
        </Grid>
        <Card
          title="Avropsinkorg"
          icon="inbox"
          flush
          actions={
            <Button kind="ghost" iconRight="arrow-right" to="/diagnos">
              Öppna inkorgen
            </Button>
          }
        >
          <List>
            <ListItem
              lead={<SlaBadge sla={{ tone: "urgent", label: "53 min kvar" }} />}
              title="BOT-27-0048 · Beställning lager/logistik"
              sub="Beställning · Word-mall"
              side={<Button>Öppna</Button>}
            />
            <ListItem icon="file" title="Månadsrapport januari 2027" sub="Levererad 1 feb kl. 09.03" onClick={() => toast("Raden valdes.")} chevron marked />
            <ListItem icon="users" title="Länk till en sida" sub="Hela raden är en länk" to="/diagnos" chevron />
          </List>
        </Card>
      </Section>

      <Section title="Tabell">
        <Card flush>
          <Table
            caption="Exempel på ärenden"
            columns={columns}
            rows={ROWS}
            rowTone={(r) => r.tone}
            onRowClick={(r) => toast(`Rad ${r.number} valdes.`)}
            footer={
              <tr>
                <td colSpan={4}>Summa</td>
                <td className="text-right tabular-nums">6 533,50 kr</td>
              </tr>
            }
          />
        </Card>
        <Table columns={columns.slice(0, 2)} rows={[] as Row1[]} empty="Inga ärenden att visa." />
      </Section>

      <Section title="Formulär">
        <Card title="Formulär">
          <FormGrid>
            <Field label="Beställarreferens" help="8–10 siffror. Den får ni av kommunens ekonomi." required error={/^\d{8,10}$/.test(ref) ? undefined : `Beställarreferensen ska vara 8–10 siffror. Du har skrivit ${ref.length}.`}>
              <Input value={ref} onValueChange={setRef} inputMode="numeric" maxLength={10} />
            </Field>
            <Field label="Avtalsområde" help="Välj det område insatsen gäller.">
              <Select
                value={area}
                onValueChange={setArea}
                placeholder="Välj avtalsområde"
                options={[
                  { value: "A", label: "A Lager och logistik" },
                  { value: "B", label: "B Restaurang och storkök" },
                  { value: "J", label: "J Parti- och detaljhandel" },
                ]}
              />
            </Field>
            <Field label="Datum för första möte">
              <DateInput value={date} onValueChange={setDate} />
            </Field>
            <Field label="Klockslag">
              <TimeInput value={time} onValueChange={setTime} />
            </Field>
            <Field label="Anteckning" help="Skriv sakligt. Inga diagnoser." full>
              <TextArea value={note} onValueChange={setNote} rows={3} />
            </Field>
            <Field label="Samlad status" full>
              <Seg
                value={status}
                onValueChange={setStatus}
                options={[
                  { value: "green", label: "Grön", icon: "check-circle", tone: "green" },
                  { value: "yellow", label: "Gul", icon: "alert-circle", tone: "yellow" },
                  { value: "red", label: "Röd", icon: "alert", tone: "red" },
                ]}
              />
            </Field>
            <Field label="Yrkesspår (flerval)" full>
              <Seg multi value={multi} onValueChange={setMulti} options={["lager", "kök", "städ", "vård"]} />
            </Field>
            <Check checked={checked} onCheckedChange={setChecked}>
              Deltagaren har gett samtycke till inspelning
            </Check>
          </FormGrid>
        </Card>
      </Section>

      <Section title="Flikar">
        <Tabs
          id="showcase-tabs"
          ariaLabel="Ärendets flikar"
          active={tab}
          onChange={setTab}
          tabs={[
            { id: "oversikt", label: "Översikt", icon: "home" },
            { id: "narvaro", label: "Närvaro", count: 3 },
            { id: "rapporter", label: "Rapporter", count: 0 },
          ]}
        />
        <TabPanel tabsId="showcase-tabs" active={tab}>
          <p>Innehåll för fliken {tab}.</p>
        </TabPanel>
      </Section>

      <Section title="Meddelanden">
        <Notice title="Information">Blå ruta för information.</Notice>
        <Notice tone="warn" title="Varning">Grå ruta med antracit kant.</Notice>
        <Notice tone="critical" title="Kritiskt">Röd ruta – läses upp direkt.</Notice>
        <Notice tone="ok" title="Klart">Allt är registrerat.</Notice>
        <DemoNote>Den här rutan visas bara i prototypen.</DemoNote>
        <Split>
          <Card>
            <Empty icon="inbox" title="Inget att hantera" action={<Button kind="ghost">Visa alla</Button>}>
              Alla avrop är besvarade.
            </Empty>
          </Card>
          <Card>
            <Loading />
            <ErrorNotice onRetry={() => toast("Försöker igen.")} />
          </Card>
        </Split>
      </Section>

      <Section title="Dialoger, toasts och filer">
        <Row>
          <Button onClick={() => setModal(true)}>Öppna dialog</Button>
          <Button
            kind="danger"
            onClick={async () => {
              const ok = await confirm({ title: "Avböj avropet?", body: "Kommunen får ett mejl med ärendenumret.", confirmLabel: "Avböj", tone: "danger" });
              setLastConfirm(ok ? "Bekräftat" : "Avbrutet");
            }}
          >
            Bekräftelse
          </Button>
          <span className="text-small text-text-muted">Senaste svar: {lastConfirm}</span>
          <Button onClick={() => toast("Avropet är accepterat.")}>Toast</Button>
          <Button onClick={() => toast("Något gick fel. Försök igen.", "error")}>Toast (fel)</Button>
          <Button onClick={() => showText({ title: "Innehåll i exempel.csv", text: "ärende;belopp\nBOT-27-0048;1523", note: "Filen kunde inte sparas direkt här. Kopiera innehållet i stället." })}>
            Textdialog
          </Button>
          <Button icon="copy" onClick={() => void copy("BOT-27-0048")}>
            Kopiera
          </Button>
          <Button onClick={() => setDrawer(true)}>Låda</Button>
        </Row>
        {modal && (
          <Modal
            title="Acceptera avrop"
            onClose={() => setModal(false)}
            footer={
              <>
                <Button kind="ghost" onClick={() => setModal(false)}>
                  Avbryt
                </Button>
                <Button kind="primary" onClick={() => setModal(false)}>
                  Acceptera
                </Button>
              </>
            }
          >
            <Field label="Huvudcoach" help="Coachen får en notis.">
              <Select value="" onValueChange={() => undefined} placeholder="Välj coach" options={["Coach 1", "Coach 2"]} />
            </Field>
          </Modal>
        )}
        {drawer && (
          <Drawer title="Feedback" onClose={() => setDrawer(false)}>
            <p>Innehåll i lådan.</p>
          </Drawer>
        )}
      </Section>

      <Section title="Data">
        <Split>
          <Card title="Nyckel och värde">
            <Kv
              items={[
                ["Ärendenummer", <CaseLink key="c" caseId="case-demo-1" caseNumber="BOT-27-0048" />],
                ["Personnummer", <MaskedPnr key="p" masked="••••••••-0000" onReveal={async () => "20000101-0000"} />],
                ["Skyddad", <MaskedPnr key="s" masked={null} hidden />],
                ["Huvudcoach", <UserName key="u" name="Coach Exempel" />],
                ["Saknas", null],
              ]}
            />
          </Card>
          <Card title="Tidslinje">
            <Timeline
              items={[
                { icon: "inbox", title: "Avrop mottaget", sub: "1 feb kl. 08.41", filled: true },
                { icon: "check", title: "Orderbekräftelse skickad", sub: "1 feb kl. 09.12" },
                { icon: "alert", title: "Avvikelse", sub: "Upprepad frånvaro", tone: "red" },
              ]}
            />
          </Card>
        </Split>
        <Stepper steps={["Deltagare", "Insats", "Kontakt", "Granska"]} current={2} />
        <Row>
          <Avatar name="Sara Lindqvist" />
          <Avatar name="Amira Haddad" size="sm" />
          <UserName name="Petra Ek" />
          <PerspectiveLink role="kommun_handlaggare" to="/portal" />
        </Row>
        <Card title="Diagram">
          <Chart viewBox="0 0 320 120" aria-label="Resultatgrad per månad: 30, 32 och 34 procent">
            <line className="grid-line" x1="30" x2="310" y1="20" y2="20" />
            <line className="axis" x1="30" x2="310" y1="100" y2="100" />
            {[30, 32, 34].map((v, i) => (
              <rect key={v} x={60 + i * 90} y={100 - v * 2} width="40" height={v * 2} className={i === 2 ? "fill-bla" : "fill-antracit"} />
            ))}
            {["nov", "dec", "jan"].map((m, i) => (
              <text key={m} x={80 + i * 90} y="115" textAnchor="middle">
                {m}
              </text>
            ))}
          </Chart>
        </Card>
      </Section>

      <Section title="PDF-förhandsvisning">
        <Paper
          title="Månadsrapport januari 2027"
          draft="Utkast – inte levererad"
          info={[
            ["Avtal", "Exempelavtal"],
            ["Ärende", "BOT-27-0048"],
            ["Period", "januari 2027"],
          ]}
        >
          <h2>Närvaro</h2>
          <table>
            <thead>
              <tr>
                <th>Vecka</th>
                <th>Planerat</th>
                <th>Närvarande</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>v. 1</td>
                <td>4</td>
                <td>4</td>
              </tr>
              <tr>
                <td>v. 2</td>
                <td>5</td>
                <td>3</td>
              </tr>
            </tbody>
          </table>
          <h2>Moment</h2>
          <ul className="m-0 list-none p-0">
            <li>
              <XBox checked />
              Studiebesök
            </li>
            <li>
              <XBox />
              Jobbsökaraktivitet
            </li>
          </ul>
          <PaperFixedText>Rapporten bygger bara på godkända uppgifter.</PaperFixedText>
        </Paper>
      </Section>

      <Section title="Kommunportalen (18 px) och pulsmätningen">
        <Split>
          <div data-area="portal" className="flex flex-col gap-4 rounded-card border border-dashed border-line-strong p-4 text-portal">
            <Eyebrow>Arbetsmarknadsenheten · Exempelkommun</Eyebrow>
            <h2 className="text-[1.25rem] font-extrabold">Portalens storlekar</h2>
            <BigButtons ariaLabel="Vad vill du göra?">
              <BigButton primary icon="file-plus" title="Beställ ny insats" sub="Tre korta steg och en granskning." to="/diagnos" />
              <BigButton icon="users" title="Mina deltagare" sub="3 pågår · 1 väntar på start" onClick={() => toast("Mina deltagare")} />
            </BigButtons>
            <Field label="E-postadress" help="Du får en kod med sex siffror.">
              <Input type="email" value="" onValueChange={() => undefined} />
            </Field>
            <Row>
              <Button kind="primary">Skicka</Button>
              <Button kind="ghost" icon="arrow-left">
                Till start
              </Button>
              <Badge tone="dark">Ny</Badge>
            </Row>
          </div>
          <div className="flex justify-center rounded-card bg-ljusgra-ton2 p-4">
            <PulsePhone>
              <Row between>
                <span className="text-body">
                  <b className="font-extrabold tracking-[0.08em] uppercase">Miljonbemanning</b>
                </span>
                <span className="text-small text-text-muted">Alby</span>
              </Row>
              <h2 className="text-[1.3125rem] font-extrabold">Hur nöjd är du med stödet?</h2>
              <Smileys ariaLabel="Hur nöjd är du med stödet?">
                {[1, 2, 3, 4, 5].map((v) => (
                  <Smiley key={v} pressed={smiley === v} onClick={() => setSmiley(v)} ariaLabel={`${v} av 5`}>
                    <Icon name={v <= 2 ? "frown" : v === 3 ? "meh" : "smile"} />
                    <span>{v}</span>
                  </Smiley>
                ))}
              </Smileys>
              <Button kind="primary" block iconRight="arrow-right">
                Nästa
              </Button>
            </PulsePhone>
          </div>
        </Split>
      </Section>

      <Section title="Ikoner">
        <Divider />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
          {ICON_NAMES.map((n) => (
            <div key={n} className="flex items-center gap-2 text-small">
              <Icon name={n} />
              <span>{n}</span>
            </div>
          ))}
        </div>
      </Section>
    </Page>
  );
}

/** /ui/portal – samma komponenter i kommunportalens layout (18 px, toppmeny). */
export function UiShowcasePortal() {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [choice, setChoice] = useState<string | null>("pagar");
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className="flex flex-col gap-2">
        <Eyebrow>Arbetsmarknadsenheten · Exempelkommun</Eyebrow>
        <h1 className="flex items-center gap-2.5 text-[1.75rem] font-extrabold tracking-[0.03em] uppercase">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-full bg-rod" />
          Välkommen, Maria
        </h1>
        <p className="max-w-[62ch] text-text-muted">Vad vill du göra i dag?</p>
      </header>
      <Card title="Olästa rapporter och meddelanden (2)" icon="mail" flush>
        <List>
          <ListItem icon="file" title={<>Månadsrapport januari 2027 <Badge tone="dark">Ny</Badge></>} sub="BOT-26-0112 · Levererad 1 februari 2027 klockan 09.03" to="/ui/portal" chevron marked />
          <ListItem icon="file" title="Månadsrapport januari 2027" sub="BOT-26-0108 · Levererad 1 februari 2027 klockan 09.00" onClick={() => toast("Rapporten öppnas.")} chevron />
        </List>
      </Card>
      <BigButtons ariaLabel="Vad vill du göra?">
        <BigButton primary icon="file-plus" title="Beställ ny insats" sub="Tre korta steg och en granskning. Det tar ungefär fem minuter." to="/ui/portal" />
        <BigButton icon="users" title="Mina deltagare" sub="3 pågår · 1 väntar på start" to="/ui/portal" />
        <BigButton icon="mail" title="Rapporter och meddelanden" sub="Inga olästa" onClick={() => setOpen(true)} />
      </BigButtons>
      <Seg
        ariaLabel="Visa"
        value={choice}
        onValueChange={setChoice}
        options={[
          { value: "pagar", label: "Pågår och på väg (29)" },
          { value: "avslutade", label: "Avslutade (42)" },
          { value: "alla", label: "Alla (71)" },
        ]}
      />
      <Field label="Sök" help="Skriv ett namn eller ett ärendenummer, till exempel BOT-26-0143.">
        <Input type="search" value={email} onValueChange={setEmail} />
      </Field>
      <Notice tone="ok" title="Du är uppdaterad">
        Du har inga uppgifter, inga nya händelser och inga olästa rapporter eller meddelanden.
      </Notice>
      <Grid cols={2}>
        <Kpi label="Pågår" value="29" sub="Deltagare i insats" />
        <Kpi label="Resultatgrad" value="33,9 %" sub="Avtalets mål 32 %" tone="watch" statusText="Bevaka" />
      </Grid>
      <Row>
        <Button kind="primary" iconRight="arrow-right">
          Fortsätt
        </Button>
        <Button kind="ghost" icon="arrow-left">
          Till start
        </Button>
        <Button onClick={() => toast("Meddelandet är skickat.")}>Visa toast</Button>
      </Row>
      <DemoNote>Portalens text är 18 px och knapparna minst 52 px höga.</DemoNote>
      {open && (
        <Modal title="Skicka meddelande" onClose={() => setOpen(false)} footer={<Button kind="primary" onClick={() => setOpen(false)}>Skicka</Button>}>
          <Field label="Meddelande" help="Skriv inte personnummer.">
            <TextArea value="" onValueChange={() => undefined} />
          </Field>
        </Modal>
      )}
    </>
  );
}

/** /ui/puls – deltagarens mobilvy. */
export function UiShowcasePuls() {
  const [v, setV] = useState<number | null>(null);
  const [lang, setLang] = useState("sv");
  return (
    <div className="flex w-[min(420px,100%)] flex-col gap-4">
      <PulsePhone lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
        <Row between>
          <span className="inline-flex items-baseline gap-0.5 text-body font-extrabold tracking-[0.08em] uppercase" dir="ltr">
            Miljonbemanning
            <span aria-hidden="true" className="ml-0.5 inline-block size-[9px] rounded-full bg-rod-logo" />
          </span>
          <span className="text-small text-text-muted" lang="sv">
            Alby
          </span>
        </Row>
        <Seg
          ariaLabel="Språk"
          value={lang}
          onValueChange={setLang}
          options={[
            { value: "sv", label: "Svenska", lang: "sv" },
            { value: "en", label: "English", lang: "en" },
            { value: "ar", label: "العربية", lang: "ar", dir: "rtl" },
            { value: "so", label: "Soomaali", lang: "so" },
          ]}
        />
        <h1 className="text-[1.3125rem] font-extrabold">Hur nöjd är du med stödet?</h1>
        <Smileys ariaLabel="Hur nöjd är du med stödet?">
          {[1, 2, 3, 4, 5].map((n) => (
            <Smiley key={n} pressed={v === n} onClick={() => setV(n)} ariaLabel={`${n} av 5`}>
              <Icon name={n <= 2 ? "frown" : n === 3 ? "meh" : "smile"} />
              <span>{n}</span>
            </Smiley>
          ))}
        </Smileys>
        <Row between>
          <Button kind="ghost">Tillbaka</Button>
          <Button kind="primary" disabled={v === null}>
            Nästa
          </Button>
        </Row>
      </PulsePhone>
      <DemoNote>Deltagaren öppnar en engångslänk – ingen inloggning.</DemoNote>
    </div>
  );
}
