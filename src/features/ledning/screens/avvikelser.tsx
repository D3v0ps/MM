"use client";
// Register över avtalsavvikelser, varningar och klagomål (/avtalsavvikelser/:id?, prototypens chef.avvikelser). SPEC §7.16 och §3.
// Eskaleringstrappa, viten och antal varningar före uppsägning kommer från avtalskonfigurationen via frågorna.
import { useState } from "react";
import { TESTER_HIDDEN_TEXT } from "@/api/tester-access";
import { kr, plural } from "@/core/format";
import { fmtDate, fmtDateShort, fmtDateTime, monthName } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { DemoOnly } from "@/shell/runtime";
import {
  Badge, BuildPhase, Button, Card, CaseLink, CellSub, Check, DateInput, DemoNote, Empty, ErrorNotice, Field, FormGrid, Icon, Input, Kpi, Kv, Loading, Modal, Notice,
  Page, PerspectiveLink, QueryView, Row, Seg, Select, SlaBadge, Split, Stack, TabPanel, Table, Tabs, TextArea, Timeline, useCopy, useDownload, useToast,
  type TimelineItem,
} from "@/ui";
import { auditView } from "@/features/session/api";
import {
  CD_LEVELS, CD_SOURCES, CD_TYPES, cdevDetail, cdevClose, cdevMonth, cdevRegister, cdevSave, cdLevelLabel, cdSourceLabel, cdTypeLabel, stepLabel,
  type CdevDetail, type CdevForm, type CdevRegister, type CdevRow,
} from "../api";
import { CdStatusBadge, Ladder, Tiles, WrapBtn } from "./parts";

type Penalty = "" | "deviation" | "information";
const penaltyOptions = (p: NonNullable<CdevForm["penalties"]>) => [
  { value: "", label: "Inget vite" },
  { value: "deviation", label: `Vite för avvikelse – ${kr(p.deviationOre)}` },
  { value: "information", label: `Vite för bristfällig information – ${kr(p.insufficientInformationOre)}` },
];
const monthOptions = (ms: string[]) => ms.map((mk) => ({ value: mk, label: monthName(mk) }));
const typeHelpOf = (f: CdevForm, type: string) => (type === "ekonomi" ? f.economicHelp : CD_TYPES.find((x) => x.value === type)?.help);

export function AvvikelserScreen({ params }: ScreenProps) {
  return params.id ? <DetailView id={params.id} /> : <Register />;
}

// ================================================================ Registret
function Register() {
  const q = useQuery(cdevRegister, {});
  const [showNew, setShowNew] = useState(false);
  const d = q.data;
  return (
    <Page
      title="Avtalsavvikelser"
      eyebrow={`Avvikelser, varningar och klagomål${d ? ` · ${d.customerName}` : ""}`}
      lead="Register enligt avtalets uppföljning och sanktioner. Kommunen godkänner åtgärdsplanerna. Klagomål från deltagare, arbetsgivare och kommun registreras här också."
      actions={
        <>
          <WrapBtn>
            <Button kind="primary" icon="plus" disabled={!d} onClick={() => setShowNew(true)}>
              Registrera avvikelse eller klagomål
            </Button>
          </WrapBtn>
          <DemoOnly>
            <WrapBtn>
              <PerspectiveLink role="kommun_chef" to="/portal/bestallarrapport" label="Här godkänner kommunens chef åtgärdsplaner" />
            </WrapBtn>
          </DemoOnly>
        </>
      }
    >
      <QueryView query={q}>{(data) => <RegisterContent d={data} />}</QueryView>
      {showNew && d && <NewDeviationModal form={d.form} onClose={() => setShowNew(false)} />}
    </Page>
  );
}

function RegisterContent({ d }: { d: CdevRegister }) {
  const nav = useNav();
  const [filter, setFilter] = useState<"open" | "all" | "klagomal">("open");
  const [tab, setTab] = useState<"register" | "apt">("register");
  const f = d.form;
  const open = d.rows.filter((x) => x.statusKey !== "closed");
  const rows = filter === "open" ? open : filter === "klagomal" ? d.rows.filter((x) => x.type === "klagomål") : d.rows;
  const c = d.counts;
  return (
    <>
      <Tiles>
        <Kpi
          label="Öppna"
          value={String(c.open)}
          sub={`varav ${c.openComplaints} klagomål`}
          tone={c.open ? "watch" : undefined}
          statusText={c.open ? "Bevaka – öppna avvikelser" : undefined}
        />
        <Kpi label="Väntar på kommunens godkännande" value={String(c.waiting)} sub="Åtgärdsplaner skickade till kommunens chef" />
        <Kpi
          label="Skriftliga varningar"
          value={`${c.warnings} av ${f.warningsBeforeTermination}`}
          tone={c.warnings > 0 ? "alert" : undefined}
          statusText={c.warnings > 0 ? `${plural(c.warnings, "varning", "varningar")} från kommunen` : undefined}
          sub={`${f.warningsBeforeTermination} varningar kan leda till uppsägning`}
        />
        {c.penaltiesOre !== undefined && f.penalties ? (
          <Kpi label="Viten" value={kr(c.penaltiesOre)} sub={`${kr(f.penalties.deviationOre)} per tillfälle enligt avtalet`} />
        ) : (
          <Kpi label="Viten" value={TESTER_HIDDEN_TEXT} />
        )}
      </Tiles>
      <Card title="Eskaleringstrappan" icon="layers" actions={<BuildPhase fas={2} />}>
        <Stack>
          <Ladder ladder={f.ladder} counts={d.stepCounts} current={d.maxStep} />
          <div className="text-small text-text-muted">
            {d.maxStep == null ? "Inga öppna avvikelser." : `Högsta steg bland öppna avvikelser: ${stepLabel(f.ladder, d.maxStep)}.`} Skriftlig varning kan ges på steg {f.warningSteps.min}–
            {f.warningSteps.max}. Kommunen kan också hålla inne betalning, ta ut vite, besluta om avropsstopp och flytta Miljonbemanning sist i rangordningen vid upprepade fel.
          </div>
        </Stack>
      </Card>
      <Tabs
        id="cdev"
        ariaLabel="Avvikelser"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "register", label: "Register", icon: "list", count: open.length },
          { id: "apt", label: "Månadssammanställning för APT", icon: "clipboard" },
        ]}
      />
      <TabPanel tabsId="cdev" active={tab}>
        {tab === "register" ? (
          <Stack>
            <Seg
              ariaLabel="Filter"
              value={filter}
              onValueChange={setFilter}
              options={[
                { value: "open", label: `Öppna (${open.length})` },
                { value: "all", label: `Alla (${d.rows.length})` },
                { value: "klagomal", label: "Klagomål" },
              ]}
            />
            <Card flush>
              <Table
                caption="Register över avtalsavvikelser"
                rows={rows}
                empty="Inga avvikelser i det här urvalet."
                onRowClick={(x) => nav.push(`/avtalsavvikelser/${encodeURIComponent(x.id)}`)}
                rowTone={(x) => (x.statusKey === "no_plan" ? "alert" : x.statusKey === "closed" ? "muted" : null)}
                columns={registerColumns}
              />
            </Card>
          </Stack>
        ) : (
          <MonthSummary months={d.aptMonths} initial={d.lastMonth} />
        )}
      </TabPanel>
      <DemoNote>
        Registret är förifyllt med påhittade avvikelser. Kommunens chef godkänner åtgärdsplaner i sin portal – byt perspektiv för att prova. Det du registrerar här sparas i din webbläsare och
        kan återställas med knappen Återställ.
      </DemoNote>
    </>
  );
}

const registerColumns = [
  { key: "raisedAt", label: "Datum", nowrap: true, render: (x: CdevRow) => fmtDate(x.raisedAt) },
  {
    key: "type",
    label: "Typ och nivå",
    render: (x: CdevRow) => (
      <div className="flex flex-col gap-1">
        <span className="font-bold">{cdTypeLabel(x.type)}</span>
        <CellSub>
          {cdLevelLabel(x.level)} · steg {x.escalationStep}
        </CellSub>
      </div>
    ),
  },
  {
    key: "description",
    label: "Beskrivning",
    render: (x: CdevRow) => (
      <div className="max-w-[40ch] min-w-[200px]">
        {x.description}
        <CellSub>{cdSourceLabel(x.source)}</CellSub>
      </div>
    ),
  },
  {
    key: "plan",
    label: "Åtgärdsplan",
    render: (x: CdevRow) =>
      x.hasPlan ? (
        <div className="flex flex-col gap-0.5">
          <span className="whitespace-nowrap">Klart {x.actionPlanDue ? fmtDate(x.actionPlanDue) : "–"}</span>
          <CellSub>{x.customerApprovedAt ? `Godkänd av kommunen ${fmtDateShort(x.customerApprovedAt)}` : "Inte godkänd av kommunen"}</CellSub>
        </div>
      ) : (
        <span className="text-text-muted">Saknas</span>
      ),
  },
  {
    key: "status",
    label: "Status",
    render: (x: CdevRow) => (
      <div className="flex max-w-[200px] min-w-[150px] flex-col gap-1">
        <span>
          <CdStatusBadge status={x.statusKey} />
        </span>
        <CellSub>
          {x.warningIssued ? "Skriftlig varning" : "Ingen varning"} · {x.penaltyOre === undefined ? `vite: ${TESTER_HIDDEN_TEXT.toLowerCase()}` : x.penaltyOre ? `vite ${kr(x.penaltyOre)}` : "inget vite"}
          {x.orderStop ? " · avropsstopp" : ""}
        </CellSub>
      </div>
    ),
  },
];

// ================================================================ Ny avvikelse eller klagomål
type NewForm = {
  type: string;
  source: string;
  level: string;
  escalationStep: string;
  raisedOn: string;
  description: string;
  caseNumber: string;
  actionPlan: string;
  actionPlanDue: string;
  ownerId: string;
  warningIssued: boolean;
  penaltyKind: Penalty;
  penaltyOffsetMonth: string;
  orderStop: boolean;
};

function NewDeviationModal({ form, onClose }: { form: CdevForm; onClose: () => void }) {
  const nav = useNav();
  const toast = useToast();
  const save = useCommand(cdevSave);
  const [f, setF] = useState<NewForm>({
    type: "", source: "", level: "", escalationStep: "", raisedOn: form.today, description: "", caseNumber: "", actionPlan: "", actionPlanDue: "",
    ownerId: form.defaultOwnerId, warningIssued: false, penaltyKind: "", penaltyOffsetMonth: "", orderStop: false,
  });
  const [err, setErr] = useState<Partial<Record<keyof NewForm, string | null>>>({});
  const [stepTouched, setStepTouched] = useState(false);
  const ws = form.warningSteps;
  const isWarnStep = (s: number) => s >= ws.min && s <= ws.max;
  const set = <K extends keyof NewForm>(k: K) => (v: NewForm[K]) => {
    if (k === "escalationStep") setStepTouched(true);
    setF((o) => {
      const n = { ...o, [k]: v };
      if (k === "level" && !stepTouched) n.escalationStep = String(CD_LEVELS.find((x) => x.value === v)?.step ?? 0);
      const s = Number(n.escalationStep);
      if (n.escalationStep === "" || !isWarnStep(s)) n.warningIssued = false;
      return n;
    });
    setErr((e) => ({ ...e, [k]: null }));
  };
  const typeHelp = typeHelpOf(form, f.type);
  const levelHelp = CD_LEVELS.find((x) => x.value === f.level)?.help;
  const step = f.escalationStep === "" ? null : Number(f.escalationStep);
  const can = form.canManage;
  const submit = async () => {
    const e: Partial<Record<keyof NewForm, string>> = {};
    if (!f.type) e.type = "Välj typ av avvikelse.";
    if (!f.source) e.source = "Välj varifrån avvikelsen kommer.";
    if (!f.level) e.level = "Välj nivå.";
    if (f.description.trim().length < 10) e.description = "Beskriv vad som hänt med minst en mening.";
    if (!f.raisedOn) e.raisedOn = "Ange datum.";
    if (f.actionPlan.trim() && !f.actionPlanDue) e.actionPlanDue = "Ange när åtgärderna ska vara klara.";
    if (Object.keys(e).length) {
      setErr(e);
      return;
    }
    const res = await save.run({
      data: {
        type: f.type as CdevRow["type"], source: f.source as CdevRow["source"], level: f.level as CdevRow["level"], escalationStep: step ?? 0, raisedOn: f.raisedOn,
        description: f.description.trim(), caseNumber: f.caseNumber.trim(), actionPlan: f.actionPlan.trim(), actionPlanDue: f.actionPlanDue || null, ownerId: f.ownerId || null,
        warningIssued: !!f.warningIssued, penaltyKind: f.penaltyKind || null, penaltyOffsetMonth: f.penaltyOffsetMonth || null, orderStop: !!f.orderStop,
      },
    });
    if (!res.ok) {
      if (res.error === "case_not_found") {
        setErr((o) => ({ ...o, caseNumber: res.message ?? "Hittar inget ärende med det numret." }));
        return;
      }
      toast(res.error === "warning_step" || res.error === "forbidden" ? res.message ?? "Kunde inte spara." : "Avvikelsen kunde inte sparas. Kontrollera fälten.", "error");
      if (res.fields) setErr((o) => ({ ...o, ...Object.fromEntries(Object.keys(res.fields ?? {}).map((k) => [k, "Obligatoriskt fält."])) }));
      return;
    }
    toast(
      `${f.type === "klagomål" ? "Klagomålet" : "Avvikelsen"} är registrerad.${res.sentToCustomer ? " Kommunens chef har fått en notis om att åtgärdsplanen väntar på godkännande." : ""}`,
    );
    onClose();
    nav.push(`/avtalsavvikelser/${encodeURIComponent(res.id)}`);
  };
  return (
    <Modal
      wide
      title="Registrera avvikelse eller klagomål"
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button kind="primary" icon="check" pending={save.pending} onClick={() => void submit()}>
            Registrera
          </Button>
        </>
      }
    >
      <FormGrid>
        <Field full label="Typ" id="cd-type" required help={typeHelp || "Kvalitet, process, avtal, ekonomi eller klagomål."} error={err.type}>
          <Seg id="cd-type" value={f.type} onValueChange={set("type")} options={CD_TYPES.map((x) => ({ value: x.value, label: x.label }))} />
        </Field>
        <Field label="Källa" id="cd-source" required help="Vem påtalade eller upptäckte avvikelsen?" error={err.source}>
          <Select value={f.source} onValueChange={set("source")} placeholder="Välj källa" options={CD_SOURCES.map((x) => ({ value: x.value, label: x.label }))} />
        </Field>
        <Field label="Datum" id="cd-date" required help="När avvikelsen påtalades eller upptäcktes." error={err.raisedOn}>
          <DateInput value={f.raisedOn} onValueChange={set("raisedOn")} />
        </Field>
        <Field label="Nivå" id="cd-level" required help={levelHelp || "Mindre, större eller allvarlig enligt avtalet."} error={err.level}>
          <Seg id="cd-level" value={f.level} onValueChange={set("level")} options={CD_LEVELS.map((x) => ({ value: x.value, label: x.label }))} />
        </Field>
        <Field label="Steg i eskaleringstrappan" id="cd-step" help="Föreslås utifrån nivån. Ändra om kommunen har angett ett annat steg.">
          <Select value={f.escalationStep} onValueChange={set("escalationStep")} placeholder="Välj steg" options={form.ladder.map((s) => ({ value: String(s.step), label: stepLabel(form.ladder, s.step) }))} />
        </Field>
        <Field full label="Beskrivning" id="cd-desc" required help="Beskriv vad som hänt. Skriv inga namn eller personnummer – använd ärendenummer." error={err.description}>
          <TextArea value={f.description} onValueChange={set("description")} rows={3} />
        </Field>
        <Field label="Ärendenummer (valfritt)" id="cd-case" help={`Om avvikelsen gäller ett visst ärende, till exempel ${form.caseNumberExample}.`} error={err.caseNumber}>
          <Input value={f.caseNumber} onValueChange={set("caseNumber")} />
        </Field>
        <Field label="Ansvarig hos Miljonbemanning" id="cd-owner" help="Den som driver åtgärderna.">
          <Select value={f.ownerId} onValueChange={set("ownerId")} options={form.owners} />
        </Field>
        <Field full label="Åtgärdsplan (kan fyllas i senare)" id="cd-plan" help="Vad görs, av vem och när? Planen skickas till kommunens chef för godkännande.">
          <TextArea value={f.actionPlan} onValueChange={set("actionPlan")} rows={3} />
        </Field>
        <Field label="Åtgärderna klara senast" id="cd-due" help="Tidsplan för åtgärdsplanen." error={err.actionPlanDue}>
          <DateInput value={f.actionPlanDue} onValueChange={set("actionPlanDue")} />
        </Field>
        <div className="col-span-full flex flex-col gap-2">
          <span className="text-label font-extrabold tracking-[0.1em] text-text-muted uppercase">Sanktioner från kommunen</span>
          <Check id="cd-warning" checked={f.warningIssued} disabled={!(step != null && isWarnStep(step)) || !can} onCheckedChange={set("warningIssued")}>
            Kommunen har gett en skriftlig varning (räknas mot {form.warningsBeforeTermination}). Kan bara ges på steg {ws.min}–{ws.max}.
          </Check>
          {/* Vitesvalet saknas för begränsade testare (servern lämnar inte ut avtalets viten). */}
          {form.penalties && (
            <Field
              label="Vite"
              id="cd-penalty"
              help={`Enligt avtalet ${kr(form.penalties.deviationOre)} per tillfälle vid avvikelse och ${kr(form.penalties.insufficientInformationOre)} vid bristfällig löpande information.`}
            >
              <Select value={f.penaltyKind} onValueChange={(v) => set("penaltyKind")(v as Penalty)} disabled={!can} options={penaltyOptions(form.penalties)} />
            </Field>
          )}
          {form.penalties && f.penaltyKind && (
            <Field label="Avräknas på faktura för" id="cd-offset" help="Kommunen kan avräkna vitet på en kommande faktura.">
              <Select value={f.penaltyOffsetMonth} onValueChange={set("penaltyOffsetMonth")} placeholder="Inte bestämt" options={monthOptions(form.offsetMonths)} />
            </Field>
          )}
          <Check id="cd-stop" checked={f.orderStop} disabled={!can} onCheckedChange={set("orderStop")}>
            Kommunen har beslutat om avropsstopp
          </Check>
          {!can && <span className="text-small text-text-muted">Varningar, viten och avropsstopp registreras av avtalsansvarig eller chef.</span>}
        </div>
      </FormGrid>
    </Modal>
  );
}

// ================================================================ Månadssammanställning för APT och kvalitetsmöte
function MonthSummary({ months, initial }: { months: string[]; initial: string }) {
  const [mk, setMk] = useState(initial);
  const q = useQuery(cdevMonth, { month: mk });
  const copy = useCopy();
  const download = useDownload();
  const logExport = useCommand(auditView);
  const s = q.data;
  const doExport = async () => {
    if (!s) return;
    // Exporter loggas i revisionsloggen (CLAUDE.md punkt 3). Bara månad – texten innehåller inga personuppgifter.
    await logExport.run({ action: "export.contract_deviations", entity: "contract_deviation", entityId: null, details: { month: s.month } }).catch(() => undefined);
    await download(`avvikelser-${s.month}.txt`, s.text, "text/plain;charset=utf-8");
  };
  return (
    <Card
      title={`Underlag för APT och kvalitetsmöte – ${monthName(mk)}`}
      icon="clipboard"
      actions={
        <>
          <Button icon="copy" disabled={!s} onClick={() => s && void copy(s.text)}>
            Kopiera text
          </Button>
          <Button kind="ghost" icon="download" disabled={!s} onClick={() => void doExport()}>
            Exportera
          </Button>
        </>
      }
    >
      <Stack className="[&_h3]:mt-1.5 [&_h3]:text-label [&_h3]:font-extrabold [&_h3]:tracking-[0.1em] [&_h3]:uppercase [&_ul]:m-0 [&_ul]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-[1.2em]">
        <Field label="Månad" id="ldg-apt-month" help="Sammanställningen räknas fram ur registret för vald månad.">
          <Select value={mk} onValueChange={setMk} options={monthOptions(months)} />
        </Field>
        {q.error ? (
          <ErrorNotice error={q.error} />
        ) : !s ? (
          <Loading />
        ) : (
          <>
            <Tiles>
              <Kpi label="Nya under månaden" value={String(s.createdCount)} sub={`varav ${s.complaints} klagomål`} />
              <Kpi label="Öppna vid månadens slut" value={String(s.openAtEnd)} />
              <Kpi label="Avslutade" value={String(s.closed)} />
              <Kpi label="Avvikelser på deltagarnivå" value={String(s.participantDeviations)} sub="Från veckoavstämningar med röd status" />
            </Tiles>
            <h3>Nya och öppna</h3>
            {s.items.length === 0 ? (
              <p className="text-text-muted">Inga avvikelser eller klagomål.</p>
            ) : (
              <ul>
                {s.items.map((x) => (
                  <li key={x.id}>
                    <span className="font-bold">
                      {cdTypeLabel(x.type)}, {cdLevelLabel(x.level).toLowerCase()}
                    </span>{" "}
                    – {x.description} {x.isNew && <Badge tone="dark">Ny</Badge>} <CdStatusBadge status={x.statusKey} />
                  </li>
                ))}
              </ul>
            )}
            <h3>Åtgärder</h3>
            {s.actions.length === 0 ? (
              <p className="text-text-muted">Inga åtgärdsplaner under månaden.</p>
            ) : (
              <ul>
                {s.actions.map((x) => (
                  <li key={x.id}>
                    {x.actionPlan} <span className="text-small text-text-muted">(klart senast {x.actionPlanDue ? fmtDate(x.actionPlanDue) : "datum saknas"})</span>{" "}
                    <CdStatusBadge status={x.statusKey} />
                  </li>
                ))}
              </ul>
            )}
            <h3>Lärdomar</h3>
            {s.lessons.length === 0 ? (
              <p className="text-text-muted">Inga lärdomar registrerade ännu. Lärdomar skrivs när en avvikelse markeras som klar.</p>
            ) : (
              <ul>
                {s.lessons.map((x) => (
                  <li key={x.id}>
                    {x.lessons}{" "}
                    <span className="text-small text-text-muted">
                      ({cdTypeLabel(x.type).toLowerCase()}, {fmtDate(x.raisedAt)})
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-small text-text-muted">
              Skriftliga varningar hittills: {s.warnings} av {s.warningsBeforeTermination}. Viten hittills:{" "}
              {s.penaltiesOre === undefined ? TESTER_HIDDEN_TEXT.toLowerCase() : kr(s.penaltiesOre)}.
            </p>
          </>
        )}
      </Stack>
    </Card>
  );
}

// ================================================================ Detaljvy för en avvikelse
function DetailView({ id }: { id: string }) {
  const q = useQuery(cdevDetail, { id });
  const crumbs = [{ label: "Avtalsavvikelser", to: "/avtalsavvikelser" }];
  if (q.error || !q.data) {
    return (
      <Page title="Avtalsavvikelser" crumbs={crumbs}>
        {q.error ? <ErrorNotice error={q.error} /> : <Loading />}
      </Page>
    );
  }
  if (!q.data.found) {
    return (
      <Page title="Avtalsavvikelser" crumbs={crumbs}>
        <Notice tone="warn" title="Avvikelsen finns inte">
          Den kan ha tagits bort när demodatan återställdes.
        </Notice>
        <div>
          <Button icon="arrow-left" to="/avtalsavvikelser">
            Till registret
          </Button>
        </div>
      </Page>
    );
  }
  return <Detail key={id} d={q.data} />;
}

function Detail({ d }: { d: Extract<CdevDetail, { found: true }> }) {
  const { cd, form } = d;
  const toast = useToast();
  const save = useCommand(cdevSave);
  const closeCmd = useCommand(cdevClose);
  const [editPlan, setEditPlan] = useState(false);
  const [plan, setPlan] = useState({ actionPlan: cd.actionPlan, actionPlanDue: cd.actionPlanDue ?? "", ownerId: cd.ownerId ?? form.defaultOwnerId });
  const [planErr, setPlanErr] = useState<{ actionPlan?: string | null; actionPlanDue?: string | null }>({});
  const [lessons, setLessons] = useState(cd.lessons);
  const [lessonsErr, setLessonsErr] = useState<string | null>(null);
  const [editSanction, setEditSanction] = useState(false);
  const [sanc, setSanc] = useState({
    escalationStep: String(cd.escalationStep ?? 0), warningIssued: cd.warningIssued, penaltyKind: (cd.penaltyKind ?? "") as Penalty, penaltyOffsetMonth: cd.penaltyOffsetMonth ?? "",
    orderStop: cd.orderStop,
  });
  const closed = cd.statusKey === "closed";
  const ws = form.warningSteps;
  const isWarnStep = (s: number) => s >= ws.min && s <= ws.max;
  const wbt = form.warningsBeforeTermination;

  const savePlan = async () => {
    const e: typeof planErr = {};
    if (plan.actionPlan.trim().length < 10) e.actionPlan = "Skriv åtgärdsplanen med minst en mening.";
    if (!plan.actionPlanDue) e.actionPlanDue = "Ange när åtgärderna ska vara klara.";
    if (Object.keys(e).length) {
      setPlanErr(e);
      return;
    }
    const res = await save.run({ id: cd.id, data: { actionPlan: plan.actionPlan.trim(), actionPlanDue: plan.actionPlanDue, ownerId: plan.ownerId || null } });
    if (!res.ok) {
      toast("Åtgärdsplanen kunde inte sparas.", "error");
      return;
    }
    toast(res.sentToCustomer ? "Åtgärdsplanen är sparad och skickad till kommunens chef för godkännande. Mejlet innehåller inga personuppgifter." : "Åtgärdsplanen är sparad.");
    setEditPlan(false);
  };
  const saveSanctions = async () => {
    const res = await save.run({
      id: cd.id,
      data: {
        escalationStep: Number(sanc.escalationStep), warningIssued: !!sanc.warningIssued, penaltyKind: sanc.penaltyKind || null,
        penaltyOffsetMonth: sanc.penaltyKind ? sanc.penaltyOffsetMonth || null : null, orderStop: !!sanc.orderStop,
      },
    });
    if (!res.ok) {
      toast(res.error === "warning_step" || res.error === "forbidden" ? res.message ?? "Kunde inte spara." : "Kunde inte spara.", "error");
      return;
    }
    toast("Steg, varning och vite är sparade.");
    setEditSanction(false);
  };
  const close = async () => {
    if (lessons.trim().length < 10) {
      setLessonsErr("Skriv vad ni har lärt er – det används i månadssammanställningen till APT.");
      return;
    }
    const res = await closeCmd.run({ id: cd.id, lessons: lessons.trim() });
    if (!res.ok) {
      toast(res.message ?? "Avvikelsen kunde inte markeras som klar.", "error");
      return;
    }
    toast("Avvikelsen är markerad som klar. Lärdomen finns med i månadssammanställningen.");
  };

  const timeline: TimelineItem[] = [
    { key: "reg", icon: "flag", title: `Registrerad – ${cdSourceLabel(cd.source).toLowerCase()}`, sub: fmtDateTime(cd.raisedAt), filled: true },
    ...(cd.hasPlan
      ? [{ key: "plan", icon: "clipboard" as const, title: "Åtgärdsplan skickad till kommunen", sub: cd.planSubmittedAt ? fmtDateTime(cd.planSubmittedAt) : cd.actionPlanDue ? `Klart senast ${fmtDate(cd.actionPlanDue)}` : "" }]
      : []),
    ...(cd.customerApprovedAt
      ? [{ key: "ok", icon: "check" as const, title: `Godkänd av kommunen${cd.approvedByName ? ` (${cd.approvedByName})` : ""}`, sub: fmtDateTime(cd.customerApprovedAt), filled: true }]
      : []),
    ...(cd.warningIssued ? [{ key: "warn", icon: "alert" as const, title: "Skriftlig varning från kommunen", sub: cd.warningIssuedAt ? fmtDateTime(cd.warningIssuedAt) : "", tone: "red" as const }] : []),
    ...(closed ? [{ key: "closed", icon: "check-circle" as const, title: "Klar", sub: cd.closedOn ? (cd.closedOn.length > 10 ? fmtDateTime(cd.closedOn) : fmtDate(cd.closedOn)) : "–", filled: true }] : []),
  ];

  return (
    <Page
      title={cd.type === "klagomål" ? "Klagomål" : "Avtalsavvikelse"}
      eyebrow={`Registrerad ${fmtDate(cd.raisedAt)} · ${cdSourceLabel(cd.source)}`}
      crumbs={[{ label: "Avtalsavvikelser", to: "/avtalsavvikelser" }, { label: `${cdTypeLabel(cd.type)} ${fmtDateShort(cd.raisedAt)}` }]}
      actions={
        <DemoOnly>
          <WrapBtn>
            <PerspectiveLink
              role="kommun_chef"
              to="/portal/bestallarrapport"
              label={cd.hasPlan && !cd.customerApprovedAt && !closed ? "Godkänn planen som kommunens chef" : "Se kommunens chefsvy"}
            />
          </WrapBtn>
        </DemoOnly>
      }
    >
      <Row gap="sm">
        <Badge tone="dark">{cdTypeLabel(cd.type)}</Badge>
        <Badge tone="outline">Nivå: {cdLevelLabel(cd.level).toLowerCase()}</Badge>
        <Badge tone="outline" icon="layers">
          {stepLabel(form.ladder, cd.escalationStep)}
        </Badge>
        <CdStatusBadge status={cd.statusKey} />
        {cd.orderStop && (
          <Badge tone="red" icon="alert">
            Avropsstopp
          </Badge>
        )}
      </Row>
      <Split wide>
        <Stack>
          <Card title="Beskrivning" icon="file">
            <Stack>
              <p>{cd.description}</p>
              <Kv
                items={[
                  ["Typ", cdTypeLabel(cd.type)],
                  ["Nivå", cdLevelLabel(cd.level)],
                  ["Källa", cdSourceLabel(cd.source)],
                  ["Datum", fmtDateTime(cd.raisedAt)],
                  cd.caseId && cd.caseNumber ? ["Ärende", <CaseLink key="c" caseId={cd.caseId} caseNumber={cd.caseNumber} />] : null,
                  ["Ansvarig", cd.ownerName ?? "Ingen utsedd"],
                  cd.registeredByName ? ["Registrerad av", cd.registeredByName] : null,
                ]}
              />
            </Stack>
          </Card>
          <Card
            title="Åtgärdsplan"
            icon="clipboard"
            tone={cd.statusKey === "no_plan" ? "red" : undefined}
            actions={
              !closed && !editPlan ? (
                <Button icon="edit" onClick={() => setEditPlan(true)}>
                  {cd.hasPlan ? "Ändra åtgärdsplan" : "Skriv åtgärdsplan"}
                </Button>
              ) : undefined
            }
          >
            {editPlan ? (
              <Stack>
                <Field label="Åtgärdsplan" id="cd-edit-plan" required help="Vad görs, av vem och när? En ändrad plan skickas till kommunen för nytt godkännande." error={planErr.actionPlan}>
                  <TextArea
                    rows={4}
                    value={plan.actionPlan}
                    onValueChange={(v) => {
                      setPlan({ ...plan, actionPlan: v });
                      setPlanErr({ ...planErr, actionPlan: null });
                    }}
                  />
                </Field>
                <FormGrid>
                  <Field label="Klart senast" id="cd-edit-due" required help="Tidsplan för åtgärderna." error={planErr.actionPlanDue}>
                    <DateInput
                      value={plan.actionPlanDue}
                      onValueChange={(v) => {
                        setPlan({ ...plan, actionPlanDue: v });
                        setPlanErr({ ...planErr, actionPlanDue: null });
                      }}
                    />
                  </Field>
                  <Field label="Ansvarig" id="cd-edit-owner" help="Den som driver åtgärderna.">
                    <Select value={plan.ownerId} onValueChange={(v) => setPlan({ ...plan, ownerId: v })} options={form.owners} />
                  </Field>
                </FormGrid>
                <div className="flex items-start gap-2.5 rounded-mb border-[1.5px] border-dashed border-line-strong bg-vit px-3 py-2.5 text-small text-text-muted">
                  <Icon name="mail" className="mt-px" />
                  <div>
                    <b className="font-bold text-antracit">Kommunens chef får:</b> &quot;En åtgärdsplan inom avtalet med Miljonbemanning väntar på ert godkännande. Logga in i portalen för att
                    läsa den.&quot; Inga personuppgifter i mejlet.
                  </div>
                </div>
                <Row>
                  <Button kind="primary" icon="send" pending={save.pending} onClick={() => void savePlan()}>
                    Spara och skicka till kommunen
                  </Button>
                  <Button
                    kind="ghost"
                    onClick={() => {
                      setEditPlan(false);
                      setPlanErr({});
                    }}
                  >
                    Avbryt
                  </Button>
                </Row>
              </Stack>
            ) : cd.hasPlan ? (
              <Stack>
                <p>{cd.actionPlan}</p>
                <Kv
                  items={[
                    [
                      "Klart senast",
                      cd.actionPlanDue ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          {fmtDate(cd.actionPlanDue)}
                          {!closed && d.planDue && <SlaBadge sla={d.planDue.sla} dueAt={d.planDue.dueAt} />}
                        </span>
                      ) : (
                        "Inget datum"
                      ),
                    ],
                    [
                      "Kommunens godkännande",
                      cd.customerApprovedAt ? (
                        <Badge tone="blue" icon="check-circle">
                          Godkänd {fmtDateTime(cd.customerApprovedAt)}
                        </Badge>
                      ) : (
                        <Badge tone="grey" icon="clock">
                          Väntar på kommunens chef
                        </Badge>
                      ),
                    ],
                  ]}
                />
                {!cd.customerApprovedAt && !closed && (
                  <div className="text-small text-text-muted">
                    Kommunens chef{d.customerChefName ? `, ${d.customerChefName},` : ""} godkänner planen i sin portal.
                    <DemoOnly> Byt perspektiv för att se och godkänna den där.</DemoOnly>
                  </div>
                )}
              </Stack>
            ) : (
              <Empty icon="clipboard" title="Ingen åtgärdsplan ännu">
                Avtalet kräver en åtgärdsplan med tidsplan som kommunen godkänner.
              </Empty>
            )}
          </Card>
          {closed ? (
            <Card title="Lärdomar" icon="book">
              <p>{cd.lessons || "Inga lärdomar registrerade."}</p>
            </Card>
          ) : (
            <Card title="Markera som klar" icon="check-circle">
              <Stack>
                {cd.hasPlan && !cd.customerApprovedAt && (
                  <Notice tone="warn" title="Planen är inte godkänd av kommunen">
                    Du kan markera avvikelsen som klar, men kommunens godkännande saknas. Det syns i registret.
                  </Notice>
                )}
                <Field
                  label="Lärdomar"
                  id="cd-lessons"
                  required
                  help="Vad ändrar vi i arbetssättet? Texten kommer med i månadssammanställningen till APT och kvalitetsmötet."
                  error={lessonsErr}
                >
                  <TextArea
                    rows={3}
                    value={lessons}
                    onValueChange={(v) => {
                      setLessons(v);
                      setLessonsErr(null);
                    }}
                  />
                </Field>
                <div>
                  <Button kind="primary" icon="check" pending={closeCmd.pending} onClick={() => void close()}>
                    Markera som klar
                  </Button>
                </div>
              </Stack>
            </Card>
          )}
        </Stack>
        <Stack>
          <Card title="Eskaleringstrappan" icon="layers">
            <Ladder ladder={form.ladder} current={cd.escalationStep} vertical />
          </Card>
          <Card
            title="Varning, vite och avropsstopp"
            icon="shield"
            actions={
              form.canManage && !editSanction ? (
                <Button kind="ghost" icon="edit" onClick={() => setEditSanction(true)}>
                  Ändra
                </Button>
              ) : undefined
            }
          >
            {editSanction ? (
              <Stack>
                <Field label="Steg i eskaleringstrappan" id="cd-s-step" help={`Skriftlig varning kan ges på steg ${ws.min}–${ws.max}.`}>
                  <Select
                    value={sanc.escalationStep}
                    onValueChange={(v) => setSanc({ ...sanc, escalationStep: v, warningIssued: isWarnStep(Number(v)) ? sanc.warningIssued : false })}
                    options={form.ladder.map((s) => ({ value: String(s.step), label: stepLabel(form.ladder, s.step) }))}
                  />
                </Field>
                <Check id="cd-s-warning" checked={sanc.warningIssued} disabled={!isWarnStep(Number(sanc.escalationStep))} onCheckedChange={(v) => setSanc({ ...sanc, warningIssued: v })}>
                  Skriftlig varning från kommunen (räknas mot {wbt})
                </Check>
                {form.penalties && (
                  <Field label="Vite" id="cd-s-penalty" help={`${kr(form.penalties.deviationOre)} per tillfälle enligt avtalet.`}>
                    <Select value={sanc.penaltyKind} onValueChange={(v) => setSanc({ ...sanc, penaltyKind: v as Penalty })} options={penaltyOptions(form.penalties)} />
                  </Field>
                )}
                {form.penalties && sanc.penaltyKind && (
                  <Field label="Avräknas på faktura för" id="cd-s-offset" help="Kommunen kan avräkna vitet på en kommande faktura.">
                    <Select value={sanc.penaltyOffsetMonth} onValueChange={(v) => setSanc({ ...sanc, penaltyOffsetMonth: v })} placeholder="Inte bestämt" options={monthOptions(form.offsetMonths)} />
                  </Field>
                )}
                <Check id="cd-s-stop" checked={sanc.orderStop} onCheckedChange={(v) => setSanc({ ...sanc, orderStop: v })}>
                  Kommunen har beslutat om avropsstopp
                </Check>
                <Row>
                  <Button kind="primary" icon="check" pending={save.pending} onClick={() => void saveSanctions()}>
                    Spara
                  </Button>
                  <Button kind="ghost" onClick={() => setEditSanction(false)}>
                    Avbryt
                  </Button>
                </Row>
              </Stack>
            ) : (
              <Kv
                items={[
                  [
                    "Skriftlig varning",
                    cd.warningIssued ? (
                      <Badge tone="red" icon="alert">
                        Ja
                      </Badge>
                    ) : (
                      "Nej"
                    ),
                  ],
                  ["Varningar totalt", `${d.totalWarnings} av ${wbt}`],
                  ["Vite", cd.penaltyOre === undefined ? TESTER_HIDDEN_TEXT : cd.penaltyOre ? kr(cd.penaltyOre) : "Inget"],
                  cd.penaltyOre !== undefined && cd.penaltyOre > 0 ? ["Avräkning", cd.penaltyOffsetMonth ? `Faktura för ${monthName(cd.penaltyOffsetMonth)}` : "Inte bestämt"] : null,
                  ["Avropsstopp", cd.orderStop ? "Ja" : "Nej"],
                ]}
              />
            )}
          </Card>
          <Card title="Händelser" icon="clock">
            <Timeline items={timeline} />
          </Card>
        </Stack>
      </Split>
    </Page>
  );
}
