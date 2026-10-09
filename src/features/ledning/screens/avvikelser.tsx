"use client";
// Register över avtalsavvikelser, varningar och klagomål (/avtalsavvikelser/:id?, prototypens chef.avvikelser). SPEC §7.16 och §3.
// Eskaleringstrappa, viten och antal varningar före uppsägning kommer från avtalskonfigurationen via frågorna.
import { useState, useSyncExternalStore } from "react";
import { TESTER_HIDDEN_TEXT } from "@/api/tester-access";
import { plural } from "@/core/format";
import { fmtDate, fmtDateShort, fmtDateTime, monthName } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { useDraft, useUnsavedGuard } from "@/shell/guard";
import { Link, useNav } from "@/shell/nav";
import { pick, useQueryPatch } from "@/shell/url-state";
import type { ScreenProps } from "@/shell/routes";
import {
  Badge, BuildPhase, Button, Card, CaseLink, CellSub, Check, DateInput, Empty, ErrorNotice, ErrorSummary, Field, focusFirstError, FormGrid, Input, Kpi, Kv, List, ListItem, Loading,
  Modal, ModalCancelButton, Notice,
  Page, QueryView, Row, Seg, Select, SlaBadge, Split, Stack, TabPanel, Table, Tabs, TextArea, Timeline, useCopy, useDownload, useToast,
  type TimelineItem,
} from "@/ui";
import { auditView } from "@/features/session/api";
import {
  CD_LEVELS, CD_SOURCES, CD_TYPES, cdevDetail, cdevClose, cdevCustomerApproved, cdevMonth, cdevRegister, cdevSave, cdLevelLabel, cdSourceLabel, cdTypeLabel, CUSTOMER_APPROVAL_HOW,
  stepLabel, type CdevDetail, type CdevForm, type CdevRegister, type CdevRow, type CustomerApprovalHow,
} from "../api";
import { CdStatusBadge, Ladder, Tiles, WrapBtn } from "./parts";

type Penalty = "" | "deviation" | "information";
// Vitesvalet utan belopp – belopp syns bara för ekonomen (beslut 5, 2026-10-07).
const PENALTY_OPTIONS = [
  { value: "", label: "Inget vite" },
  { value: "deviation", label: "Vite för avvikelse" },
  { value: "information", label: "Vite för bristfällig information" },
];
const PENALTY_LABEL: Record<string, string> = { deviation: "Vite för avvikelse", information: "Vite för bristfällig information" };
const monthOptions = (ms: string[]) => ms.map((mk) => ({ value: mk, label: monthName(mk) }));
const typeHelpOf = (f: CdevForm, type: string) => (type === "ekonomi" ? f.economicHelp : CD_TYPES.find((x) => x.value === type)?.help);

/** Smal skärm (mobil): registret visas som lista i stället för tabell med fem kolumner. */
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
      lead="Avtalsavvikelser, varningar, åtgärdsplaner och klagomål."
      actions={
        <>
          <WrapBtn>
            <Button kind="primary" icon="plus" disabled={!d} onClick={() => setShowNew(true)}>
              Registrera avvikelse eller klagomål
            </Button>
          </WrapBtn>
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
  // Filter och flik i adressen (?visa=alla|klagomal, ?flik=apt), så att Tillbaka från en avvikelse visar samma lista.
  const patch = useQueryPatch();
  const visa = nav.query.get("visa");
  const filter = visa === "alla" ? "all" : visa === "klagomal" ? "klagomal" : "open";
  const setFilter = (v: "open" | "all" | "klagomal") => patch({ visa: v === "open" ? null : v === "all" ? "alla" : v });
  const tab = pick(nav.query, "flik", ["register", "apt"] as const, "register");
  const setTab = (v: "register" | "apt") => patch({ flik: v === "register" ? null : v });
  const narrow = useNarrow();
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
        <Kpi label="Väntar på kommunens godkännande" value={String(c.waiting)} sub="Åtgärdsplaner som kommunen inte har godkänt än" />
        <Kpi
          label="Skriftliga varningar"
          value={`${c.warnings} av ${f.warningsBeforeTermination}`}
          tone={c.warnings > 0 ? "alert" : undefined}
          statusText={c.warnings > 0 ? `${plural(c.warnings, "varning", "varningar")} från kommunen` : undefined}
          sub={`${f.warningsBeforeTermination} varningar kan leda till uppsägning`}
        />
        {c.penalties !== undefined ? (
          <Kpi label="Viten" value={String(c.penalties)} sub={`${c.penalties === 1 ? "Avvikelse" : "Avvikelser"} där kommunen tagit ut vite. Beloppet står i avtalet.`} />
        ) : (
          <Kpi label="Viten" value={TESTER_HIDDEN_TEXT} />
        )}
      </Tiles>
      <Card title="Eskaleringstrappan" icon="layers" actions={<BuildPhase fas={2} />}>
        <Stack>
          <Ladder ladder={f.ladder} counts={d.stepCounts} current={d.maxStep} />
          <div className="text-text-muted">
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
              {narrow ? (
                <List>
                  {rows.length === 0 ? (
                    <div className="px-[18px] py-3 text-text-muted">Inga avvikelser i det här urvalet.</div>
                  ) : (
                    rows.map((x) => (
                      <ListItem
                        key={x.id}
                        to={`/avtalsavvikelser/${encodeURIComponent(x.id)}`}
                        chevron
                        marked={x.statusKey === "no_plan"}
                        title={cdTypeLabel(x.type)}
                        sub={`${cdLevelLabel(x.level)} · steg ${x.escalationStep} · ${fmtDate(x.raisedAt)}`}
                      >
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          <CdStatusBadge status={x.statusKey} />
                        </span>
                        <span className="block text-small text-text-muted">
                          {x.hasPlan ? (x.customerApprovedAt ? `Åtgärdsplan godkänd av kommunen ${fmtDateShort(x.customerApprovedAt)}` : "Åtgärdsplan inte godkänd av kommunen") : "Åtgärdsplan saknas"}
                        </span>
                      </ListItem>
                    ))
                  )}
                </List>
              ) : (
                <Table
                  caption="Register över avtalsavvikelser"
                  rows={rows}
                  empty="Inga avvikelser i det här urvalet."
                  rowHref={(x) => `/avtalsavvikelser/${encodeURIComponent(x.id)}`}
                  linkKey={false}
                  rowTone={(x) => (x.statusKey === "no_plan" ? "alert" : x.statusKey === "closed" ? "muted" : null)}
                  columns={registerColumns}
                />
              )}
            </Card>
          </Stack>
        ) : (
          <MonthSummary months={d.aptMonths} initial={d.lastMonth} />
        )}
      </TabPanel>
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
        {/* Riktig länk: ny flik med ctrl/cmd eller mittenklick. Klick i resten av raden öppnar också avvikelsen. */}
        <Link to={`/avtalsavvikelser/${encodeURIComponent(x.id)}`} className="inline-flex min-h-11 items-center font-bold underline underline-offset-3">
          {cdTypeLabel(x.type)}
        </Link>
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
          {x.warningIssued ? "Skriftlig varning" : "Ingen varning"} · {x.hasPenalty === undefined ? `vite: ${TESTER_HIDDEN_TEXT.toLowerCase()}` : x.hasPenalty ? "vite" : "inget vite"}
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
  // Felsammanfattningen överst i dialogen (samma mönster som Lägg till kollega): fält i formulärets ordning.
  const ERR_FIELDS: [keyof NewForm, string][] = [
    ["type", "cd-type"], ["source", "cd-source"], ["raisedOn", "cd-date"], ["level", "cd-level"], ["description", "cd-desc"], ["caseNumber", "cd-case"], ["actionPlanDue", "cd-due"],
  ];
  const errItems = ERR_FIELDS.filter(([k]) => err[k]).map(([k, id]) => ({ id, text: err[k] as string }));
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
      focusFirstError(document.querySelector<HTMLElement>("[role=dialog]"));
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
      `${f.type === "klagomål" ? "Klagomålet" : "Avvikelsen"} är registrerad.${res.sentToCustomer ? " Lämna åtgärdsplanen till kommunen för godkännande." : ""}`,
    );
    onClose();
    nav.push(`/avtalsavvikelser/${encodeURIComponent(res.id)}`);
  };
  return (
    <Modal
      wide
      title="Registrera avvikelse eller klagomål"
      onClose={onClose}
      dirty={!!(f.description.trim() || f.actionPlan.trim() || f.caseNumber.trim())}
      footer={
        <>
          <ModalCancelButton />
          <Button kind="primary" icon="check" pending={save.pending} onClick={() => void submit()}>
            Registrera
          </Button>
        </>
      }
    >
      <Stack>
        <ErrorSummary items={errItems} title="Rätta det här innan du registrerar" />
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
          <Field label="Ansvarig hos Miljonbemanning" id="cd-owner">
            <Select value={f.ownerId} onValueChange={set("ownerId")} options={form.owners} />
          </Field>
          <Field full label="Åtgärdsplan (kan fyllas i senare)" id="cd-plan" help="Vad görs, av vem och när?">
            <TextArea value={f.actionPlan} onValueChange={set("actionPlan")} rows={3} />
          </Field>
          <Field label="Åtgärderna klara senast" id="cd-due" error={err.actionPlanDue}>
            <DateInput value={f.actionPlanDue} onValueChange={set("actionPlanDue")} />
          </Field>
          <div className="col-span-full flex flex-col gap-2">
            <span className="text-label font-extrabold tracking-[0.1em] text-text-muted uppercase">Sanktioner från kommunen</span>
            <Check id="cd-warning" checked={f.warningIssued} disabled={!(step != null && isWarnStep(step)) || !can} onCheckedChange={set("warningIssued")}>
              Kommunen har gett en skriftlig varning (räknas mot {form.warningsBeforeTermination}). Kan bara ges på steg {ws.min}–{ws.max}.
            </Check>
            {/* Vitesvalet saknas för begränsade testare. Beloppet visas aldrig här (beslut 5) – det står i avtalet. */}
            {form.penaltyChoice && (
              <Field label="Vite" id="cd-penalty" help="Välj om kommunen har tagit ut vite.">
                <Select value={f.penaltyKind} onValueChange={(v) => set("penaltyKind")(v as Penalty)} disabled={!can} options={PENALTY_OPTIONS} />
              </Field>
            )}
            {form.penaltyChoice && f.penaltyKind && (
              <Field label="Avräknas på faktura för" id="cd-offset">
                <Select value={f.penaltyOffsetMonth} onValueChange={set("penaltyOffsetMonth")} placeholder="Inte bestämt" options={monthOptions(form.offsetMonths)} />
              </Field>
            )}
            <Check id="cd-stop" checked={f.orderStop} disabled={!can} onCheckedChange={set("orderStop")}>
              Kommunen har beslutat om avropsstopp
            </Check>
            {!can && <span className="text-text-muted">Varningar, viten och avropsstopp registreras av avtalsansvarig eller chef.</span>}
          </div>
        </FormGrid>
      </Stack>
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
        <Field label="Månad" id="ldg-apt-month">
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
              <Kpi label="Avvikelser på deltagarnivå" value={String(s.participantDeviations)} sub="Från mötesrapporter med röd status" />
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
            <p className="text-text-muted">
              Skriftliga varningar hittills: {s.warnings} av {s.warningsBeforeTermination}. Viten hittills:{" "}
              {s.penalties === undefined ? TESTER_HIDDEN_TEXT.toLowerCase() : s.penalties}.
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
          Den kan ha tagits bort, eller så stämmer länken inte.
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
  // Lärdomarna: utkastminne i minnet och fråga innan sidan lämnas med osparad text.
  const lessonsDraft = useDraft(`avtalsavvikelse-lardomar|${cd.id}`, cd.lessons);
  const lessons = lessonsDraft.value;
  const setLessons = lessonsDraft.set;
  const [lessonsErr, setLessonsErr] = useState<string | null>(null);
  const planDirty = editPlan && plan.actionPlan.trim() !== (cd.actionPlan ?? "").trim();
  // Medan det skickas/sparas (kommandot och omhämtningen efteråt) frågar vakten inte: annars varnar sidan för text som just
  // har skickats, innan fältet hunnit tömmas.
  useUnsavedGuard(((cd.statusKey !== "closed" && lessons.trim() !== (cd.lessons ?? "").trim()) || planDirty) && !save.pending && !closeCmd.pending);
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
    toast(res.sentToCustomer ? "Åtgärdsplanen är sparad. Lämna den till kommunen och registrera godkännandet här." : "Åtgärdsplanen är sparad.");
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
    lessonsDraft.clear();
    toast("Avvikelsen är markerad som klar. Lärdomen finns med i månadssammanställningen.");
  };

  const timeline: TimelineItem[] = [
    // Datum utan klockslag: avvikelsen registreras med dag, inte tidpunkt (klockslaget vore påhittat).
    { key: "reg", icon: "flag", title: `Registrerad – ${cdSourceLabel(cd.source).toLowerCase()}`, sub: fmtDate(cd.raisedAt), filled: true },
    ...(cd.hasPlan
      ? [{ key: "plan", icon: "clipboard" as const, title: "Åtgärdsplan skickad till kommunen", sub: cd.planSubmittedAt ? fmtDateTime(cd.planSubmittedAt) : cd.actionPlanDue ? `Klart senast ${fmtDate(cd.actionPlanDue)}` : "" }]
      : []),
    ...(cd.customerApprovedAt
      ? [{ key: "ok", icon: "check" as const, title: `Godkänd av kommunen${cd.approvedByName ? ` (registrerat av ${cd.approvedByName})` : ""}`, sub: fmtDate(cd.customerApprovedAt), filled: true }]
      : []),
    ...(cd.warningIssued ? [{ key: "warn", icon: "alert" as const, title: "Skriftlig varning från kommunen", sub: cd.warningIssuedAt ? fmtDateTime(cd.warningIssuedAt) : "", tone: "red" as const }] : []),
    ...(closed ? [{ key: "closed", icon: "check-circle" as const, title: "Klar", sub: cd.closedOn ? (cd.closedOn.length > 10 ? fmtDateTime(cd.closedOn) : fmtDate(cd.closedOn)) : "–", filled: true }] : []),
  ];

  return (
    <Page
      title={cd.type === "klagomål" ? "Klagomål" : "Avtalsavvikelse"}
      eyebrow={`Registrerad ${fmtDate(cd.raisedAt)} · ${cdSourceLabel(cd.source)}`}
      crumbs={[{ label: "Avtalsavvikelser", to: "/avtalsavvikelser" }, { label: `${cdTypeLabel(cd.type)} ${fmtDateShort(cd.raisedAt)}` }]}
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
                  ["Datum", fmtDate(cd.raisedAt)],
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
                  <Field label="Klart senast" id="cd-edit-due" required error={planErr.actionPlanDue}>
                    <DateInput
                      value={plan.actionPlanDue}
                      onValueChange={(v) => {
                        setPlan({ ...plan, actionPlanDue: v });
                        setPlanErr({ ...planErr, actionPlanDue: null });
                      }}
                    />
                  </Field>
                  <Field label="Ansvarig" id="cd-edit-owner">
                    <Select value={plan.ownerId} onValueChange={(v) => setPlan({ ...plan, ownerId: v })} options={form.owners} />
                  </Field>
                </FormGrid>
                <p className="text-text-muted">
                  Kommunen godkänner planen utanför Miljonmatch, till exempel på ett möte. Avtalsansvarig registrerar godkännandet här. Ingen får något mejl.
                </p>
                <Row>
                  <Button kind="primary" icon="check" pending={save.pending} onClick={() => void savePlan()}>
                    Spara åtgärdsplanen
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
                          Godkänd {fmtDate(cd.customerApprovedAt)}
                        </Badge>
                      ) : (
                        <Badge tone="grey" icon="clock">
                          Väntar på kommunen
                        </Badge>
                      ),
                    ],
                  ]}
                />
                {!cd.customerApprovedAt && !closed && (d.canRegisterApproval ? <CustomerApprovalForm id={cd.id} /> : (
                  <p className="text-text-muted">Kommunen godkänner planen utanför Miljonmatch. Avtalsansvarig registrerar godkännandet här.</p>
                ))}
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
                  {/* Primär bara när inget annat väntar: finns en plan som kommunen inte godkänt är Registrera godkännandet huvudhandlingen. */}
                  <Button kind={cd.customerApprovedAt || !cd.hasPlan ? "primary" : "secondary"} icon="check" pending={closeCmd.pending} onClick={() => void close()}>
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
                {form.penaltyChoice && (
                  <Field label="Vite" id="cd-s-penalty" help="Välj om kommunen har tagit ut vite.">
                    <Select value={sanc.penaltyKind} onValueChange={(v) => setSanc({ ...sanc, penaltyKind: v as Penalty })} options={PENALTY_OPTIONS} />
                  </Field>
                )}
                {form.penaltyChoice && sanc.penaltyKind && (
                  <Field label="Avräknas på faktura för" id="cd-s-offset">
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
                  ["Vite", cd.hasPenalty === undefined ? TESTER_HIDDEN_TEXT : cd.hasPenalty ? (PENALTY_LABEL[cd.penaltyKind ?? ""] ?? "Ja") : "Inget"],
                  cd.hasPenalty ? ["Avräkning", cd.penaltyOffsetMonth ? `Faktura för ${monthName(cd.penaltyOffsetMonth)}` : "Inte bestämt"] : null,
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

// ---------------------------------------------------------------- Kommunens godkännande (avtalsansvarig registrerar)
/** Kommunen godkände åtgärdsplanen utanför Miljonmatch: datum och hur. Bara avtalsansvarig (ledning.cdevCustomerApproved). */
function CustomerApprovalForm({ id }: { id: string }) {
  const toast = useToast();
  const cmd = useCommand(cdevCustomerApproved);
  const [approvedOn, setApprovedOn] = useState("");
  const [how, setHow] = useState<CustomerApprovalHow | "">("");
  const [err, setErr] = useState<{ approvedOn?: string; how?: string }>({});
  const submit = async () => {
    const e: typeof err = {};
    if (!approvedOn) e.approvedOn = "Ange dagen då kommunen godkände planen.";
    if (!how) e.how = "Välj hur kommunen godkände planen.";
    setErr(e);
    if (Object.keys(e).length || !how) return;
    const res = await cmd.run({ id, approvedOn, how }).catch(() => null);
    if (!res) return toast("Godkännandet kunde inte registreras.", "error");
    if (!res.ok) {
      if (res.error === "date") setErr({ approvedOn: res.message ?? "Kontrollera datumet." });
      else toast(res.message ?? "Godkännandet kunde inte registreras.", "error");
      return;
    }
    toast("Kommunens godkännande är registrerat.");
  };
  return (
    <section aria-labelledby={`cd-approve-${id}`} className="flex flex-col gap-3 rounded-mb border-[1.5px] border-ljusgra px-3.5 py-3">
      <h3 id={`cd-approve-${id}`} className="m-0 font-extrabold">
        Registrera kommunens godkännande
      </h3>
      <p className="m-0 text-text-muted">Gör det när kommunen har godkänt planen, till exempel på ett möte eller i ett brev.</p>
      <FormGrid>
        <Field label="Datum" id={`cd-approve-date-${id}`} required help="Dagen då kommunen godkände planen." error={err.approvedOn}>
          <DateInput value={approvedOn} onValueChange={(v) => { setApprovedOn(v); setErr((o) => ({ ...o, approvedOn: undefined })); }} />
        </Field>
        <Field label="Hur" id={`cd-approve-how-${id}`} required help="Hur kommunen lämnade sitt godkännande." error={err.how}>
          <Select
            value={how}
            placeholder="Välj"
            options={CUSTOMER_APPROVAL_HOW.map((x) => ({ value: x.value, label: x.label }))}
            onValueChange={(v) => { setHow(v as CustomerApprovalHow | ""); setErr((o) => ({ ...o, how: undefined })); }}
          />
        </Field>
      </FormGrid>
      <Row>
        <Button kind="primary" icon="check-circle" pending={cmd.pending} onClick={() => void submit()}>
          Registrera godkännandet
        </Button>
      </Row>
    </section>
  );
}
