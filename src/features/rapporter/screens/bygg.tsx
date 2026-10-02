"use client";
// Rapportbyggaren: byggaren (/rapportbyggare/ny och /rapportbyggare/:id?steg=). Fyra steg: 1 Börja med · 2 Urval · 3 Visa ·
// 4 Spara. Adressen innehåller bara steget, mallens nyckel, kopians id och avtalet – den osparade definitionen ligger i
// skärmens tillstånd. Förhandsvisningen räknas inte om av sig själv: knappen "Visa förhandsvisning" kör ett tyst kommando
// (rapporter.byggForhandsvisning) med den osparade definitionen – ett osparat utkast loggas inte.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useCommand, useQuery } from "@/shell/backend";
import { path, useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { Button, Card, Check, ErrorNotice, Eyebrow, Field, Icon, Input, Loading, Notice, Page, Select, Stack, Stepper } from "@/ui";
import {
  builderCatalog, builderExport, builderPreview, canonicalJson, charCount, definitionIssue, firstChars, MAX_COLUMNS, MAX_MEASURES, savedReport, savedReportSave, savedReportShare, SPLIT_LABEL,
  SPLITS, STANDARD_COLUMNS, TEMPLATE_KEYS, TITLE_HELP, titleError, VISIBILITY_LABEL, type BuilderCatalog, type BuilderView, type Dataset, type DefinitionStep, type Dimension,
  type ReportDefinition, type SavedReportDetail, type Split, type TemplateKey,
} from "../api";
import { BuilderViewPanel, DownloadStatus, useBuilderDownload } from "../components/builder-view";
import { RadioCards } from "../components/radio-cards";
import { ShareDialog } from "./bygg-dela";
import { VISIBILITY_ICON } from "./bygg-lista";

const STEPS = ["Börja med", "Urval", "Visa", "Spara"] as const;
const TITLES = ["Vad vill du se?", "Vilken period och vilka deltagare?", "Hur vill du se uppgifterna?", "Spara och hämta"] as const;
type Visibility = "private" | "mb" | "customer";
type Saved = Extract<SavedReportDetail, { found: true }>;
type Draft = { def: ReportDefinition; title: string; visibility: Visibility; templateKey: TemplateKey | null };

const isTemplateKey = (k: string | null | undefined): k is TemplateKey => !!k && (TEMPLATE_KEYS as readonly string[]).includes(k);
const defaultDef = (cat: BuilderCatalog, ds: Dataset): ReportDefinition => ({
  v: 1, dataset: ds, period: { kind: "senaste", months: 3 }, filters: {}, output: "sammanstallning", groupBy: null, split: "inget",
  measures: [cat.datasets.find((d) => d.key === ds)!.measures[0].key], columns: [], chart: null,
});
/** En sparad definition (kan vara ogiltig) som utkast: de kända fälten läggs på standardvärdena för datamängden. */
function draftDef(cat: BuilderCatalog, raw: Record<string, unknown>): ReportDefinition {
  const ds = (cat.datasets.some((d) => d.key === raw.dataset) ? raw.dataset : "deltagarmanader") as Dataset;
  return { ...defaultDef(cat, ds), ...(raw as Partial<ReportDefinition>), v: 1, dataset: ds };
}
/** "Kopia av …" kortas till 80 tecken (kodpunkter, som char_length i databasen – en emoji delas aldrig). */
const cut80 = (s: string) => (charCount(s) > 80 ? firstChars(s, 80).trimEnd() : s);

/** /rapportbyggare/ny (?mall=&kopia=&steg=&avtal=) */
export function ByggScreen({ query }: ScreenProps) {
  const kopia = query.get("kopia");
  const copyQ = useQuery(savedReport, kopia ? { savedReportId: kopia } : null);
  const avtal = query.get("avtal") ?? (copyQ.data?.found ? copyQ.data.contractId : undefined);
  const cat = useQuery(builderCatalog, kopia && !copyQ.data ? null : { contractId: avtal });
  if (cat.error) return <ErrorNotice error={cat.error} onRetry={() => void cat.refetch()} />;
  if (copyQ.error) return <ErrorNotice error={copyQ.error} />;
  if (!cat.data || (kopia && !copyQ.data)) return <Loading />;
  if (!cat.data.contractId) return <Page title="Ny rapport"><Notice tone="info" title="Du har inget avtal i drift att bygga rapporter för." /></Page>;
  return <Builder cat={cat.data} query={query} copy={copyQ.data?.found ? copyQ.data : null} saved={null} />;
}

/** Byggaren för en sparad rapport (/rapportbyggare/:id?steg=) – öppnas från SparadScreen. */
export function BuilderForSaved({ saved, query }: { saved: Saved; query: URLSearchParams }) {
  const cat = useQuery(builderCatalog, { contractId: saved.contractId });
  if (cat.error) return <ErrorNotice error={cat.error} onRetry={() => void cat.refetch()} />;
  if (!cat.data) return <Loading />;
  return <Builder cat={cat.data} query={query} copy={null} saved={saved} />;
}

function Builder({ cat, query, copy, saved }: { cat: BuilderCatalog; query: URLSearchParams; copy: Saved | null; saved: Saved | null }) {
  const nav = useNav();
  const mall = query.get("mall");
  const editing = !!saved;
  const contractId = saved?.contractId ?? cat.contractId!;
  const [draft, setDraft] = useState<Draft | null>(() => {
    if (saved) return { def: draftDef(cat, saved.definition), title: saved.title, visibility: saved.visibility, templateKey: isTemplateKey(saved.templateKey) ? saved.templateKey : null };
    if (copy) return { def: draftDef(cat, copy.definition), title: cut80(`Kopia av ${copy.title}`), visibility: "private", templateKey: isTemplateKey(copy.templateKey) ? copy.templateKey : null };
    const t = cat.templates.find((x) => x.key === mall);
    if (t && isTemplateKey(t.key)) return { def: draftDef(cat, t.definition), title: t.name, visibility: "private", templateKey: t.key };
    return null;
  });
  const [choice, setChoice] = useState<string>(mall ? `mall:${mall}` : "");
  const requested = Number(query.get("steg"));
  // En sparad rapport och en kopia börjar i steg 2: definitionen finns redan (steg 1 skulle ersätta den).
  const first = editing || copy ? 1 : 0;
  const step = !draft ? 0 : requested >= first + 1 && requested <= 4 ? requested - 1 : first;
  const headRef = useRef<HTMLHeadingElement | null>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headRef.current?.focus();
  }, [step]);

  const go = (s: number, extra: Record<string, string | undefined> = {}) => {
    const q = { steg: String(s + 1), ...extra };
    if (editing) nav.replace(path(`/rapportbyggare/${saved!.id}`, q));
    else nav.replace(path("/rapportbyggare/ny", { mall: draft?.templateKey ?? undefined, kopia: copy?.id, avtal: cat.contracts.length > 1 ? contractId : undefined, ...q }));
  };
  const setDef = (f: (d: ReportDefinition) => ReportDefinition) => setDraft((x) => (x ? { ...x, def: f(x.def) } : x));

  // ---- Förhandsvisningen (tyst kommando, på knapp)
  const previewCmd = useCommand(builderPreview);
  const [audience, setAudience] = useState<"mb" | "kommun">("mb");
  const [pv, setPv] = useState<{ key: string; view: BuilderView | null; error: string | null } | null>(null);
  // Det första felet i definitionen och steget där det rättas (period och urval i steg 2, visningen i steg 3).
  const issue = draft ? definitionIssue(draft.def) : null;
  const defError = issue?.message ?? null;
  const pvKey = draft ? `${canonicalJson(draft.def)}|${audience}` : "";
  const stale = !!pv && pv.key !== pvKey;
  const runPreview = async () => {
    if (!draft || previewCmd.pending) return;
    if (defError) {
      setPv({ key: pvKey, view: null, error: defError });
      return;
    }
    try {
      const r = await previewCmd.run({ contractId, definition: draft.def as unknown as Record<string, unknown>, ...(draft.templateKey ? { templateKey: draft.templateKey } : {}), audience });
      setPv({ key: pvKey, view: r.ok ? (r as unknown as BuilderView) : null, error: r.ok ? null : (r.message ?? "Förhandsvisningen kunde inte visas.") });
    } catch {
      setPv({ key: pvKey, view: null, error: "Förhandsvisningen kunde inte visas. Försök igen om en stund." });
    }
  };
  const dimensionValues = pv?.view?.dimensionValues ?? {};

  // ---- Spara och hämta
  const saveCmd = useCommand(savedReportSave);
  const shareCmd = useCommand(savedReportShare);
  const exportCmd = useCommand(builderExport);
  const dl = useBuilderDownload();
  const [tried, setTried] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const titleErr = draft ? titleError(draft.title) : null;
  const doSave = async () => {
    if (!draft) return;
    setSaveError(null);
    try {
      const r = await saveCmd.run({
        contractId, title: draft.title, definition: draft.def as unknown as Record<string, unknown>,
        ...(editing ? { savedReportId: saved!.id } : { visibility: draft.visibility, ...(draft.templateKey ? { templateKey: draft.templateKey } : {}) }),
      });
      if (!r.ok) {
        setSaveError(r.message ?? "Rapporten kunde inte sparas.");
        return;
      }
      if (editing && draft.visibility !== saved!.visibility) {
        const s = await shareCmd.run({ savedReportId: r.savedReportId, visibility: draft.visibility });
        if (!s.ok) {
          setSaveError(s.message ?? "Delningen kunde inte ändras.");
          return;
        }
      }
      setSharing(false);
      nav.push(path(`/rapportbyggare/${r.savedReportId}`, { sparad: "1" }));
    } catch {
      setSaveError("Rapporten kunde inte sparas. Försök igen om en stund.");
    }
  };
  const onSave = () => {
    setTried(true);
    if (!draft || titleErr || defError) return;
    const toCustomer = draft.visibility === "customer" && (!editing || saved!.visibility !== "customer");
    if (toCustomer) setSharing(true);
    else void doSave();
  };
  const fetchFile = (format: "xlsx" | "csv" | "pdf") => {
    if (!draft || defError) return;
    void dl.fetchFile(format, () => exportCmd.run({ contractId, definition: draft.def as unknown as Record<string, unknown>, ...(draft.templateKey ? { templateKey: draft.templateKey } : {}), format }));
  };

  // ---- Stegen
  let body: ReactNode = null;
  const ds = draft ? cat.datasets.find((d) => d.key === draft.def.dataset)! : null;
  if (step === 0) {
    const opts = [
      ...cat.templates.map((t) => ({ value: `mall:${t.key}`, label: t.name, help: t.sentence })),
      ...cat.datasets.map((d) => ({ value: `data:${d.key}`, label: d.label, help: d.help })),
    ];
    body = (
      <Stack>
        <RadioCards name="bygg-start" legend="Börja med en färdig mall" value={choice} onChange={setChoice} options={opts.slice(0, cat.templates.length)} />
        <RadioCards name="bygg-start" legend="Eller börja från början" value={choice} onChange={setChoice} options={opts.slice(cat.templates.length)} />
      </Stack>
    );
  } else if (draft && ds) {
    const def = draft.def;
    if (step === 1) {
      const months = cat.months.map((m) => ({ value: m.value, label: m.label }));
      const fixed = def.period.kind === "fast" ? def.period : null;
      const periodErr = fixed ? (fixed.to < fixed.from ? "Till-månaden kan inte vara före från-månaden." : monthsBetween(fixed.from, fixed.to) > cat.maxMonths ? `Välj högst ${cat.maxMonths} månader.` : null) : null;
      body = (
        <Stack>
          {editing && <p className="text-text-muted">Datamängden kan inte ändras i en sparad rapport. Gör en ny rapport i stället.</p>}
          {copy && <p className="text-text-muted">Datamängden kan inte ändras i en kopia. Gör en ny rapport i stället.</p>}
          <RadioCards
            name="bygg-period"
            legend="Period"
            value={def.period.kind}
            onChange={(v) => setDef((d) => ({ ...d, period: v === "senaste" ? { kind: "senaste", months: 3 } : { kind: "fast", from: cat.months[Math.min(3, cat.months.length - 1)]?.value ?? cat.months[0].value, to: cat.months[1]?.value ?? cat.months[0].value } }))}
            options={[{ value: "senaste", label: "De senaste hela månaderna" }, { value: "fast", label: "Välj månader" }]}
          />
          {def.period.kind === "senaste" ? (
            <Field id="bygg-antal" label="Antal månader" help="Räknas om varje gång rapporten öppnas. Den pågående månaden är inte med.">
              <Select value={String(def.period.months)} options={Array.from({ length: cat.maxMonths }, (_, i) => String(i + 1))} onValueChange={(v) => setDef((d) => ({ ...d, period: { kind: "senaste", months: Number(v) } }))} />
            </Field>
          ) : (
            <>
              <Field id="bygg-fran" label="Från månad" help={`Du kan välja högst ${cat.maxMonths} månader.`}>
                <Select value={fixed!.from} options={months} onValueChange={(v) => setDef((d) => ({ ...d, period: { kind: "fast", from: v, to: fixed!.to } }))} />
              </Field>
              <Field id="bygg-till" label="Till månad" help={`Du kan välja högst ${cat.maxMonths} månader.`} error={periodErr ?? undefined}>
                <Select value={fixed!.to} options={months} onValueChange={(v) => setDef((d) => ({ ...d, period: { kind: "fast", from: fixed!.from, to: v } }))} />
              </Field>
            </>
          )}
          <Filters ds={ds} def={def} setDef={setDef} dimensionValues={dimensionValues} />
          {issue?.step === "urval" && issue.message !== periodErr && <IssueNotice issue={issue} current={step} onGo={go} />}
        </Stack>
      );
    } else if (step === 2) {
      body = <ShowStep ds={ds} def={def} setDef={setDef} tried={tried} issue={issue} onGo={go} />;
    } else {
      const canCustomer = cat.canShareWithCustomer;
      const customerReason = !cat.customerSharingAllowed ? "Avtalet tillåter inte att rapporter delas med kommunen." : !canCustomer ? "Bara avtalsansvarig kan dela med kommunen." : null;
      const vis = [
        { value: "private", label: VISIBILITY_LABEL.private, icon: VISIBILITY_ICON.private },
        { value: "mb", label: "Alla på Miljonbemanning i avtalet", help: "Samordnare, avtalsansvarig och chef i avtalet.", icon: VISIBILITY_ICON.mb },
        { value: "customer", label: "Kommunens chef", help: customerReason ?? "Kommunens chef ser rapporten under Hämta resultat, med siffror bara för sin egen enhet.", icon: VISIBILITY_ICON.customer, disabled: !!customerReason },
      ];
      body = (
        <Stack>
          <Field id="bygg-namn" label="Namn på rapporten" help={TITLE_HELP} error={(tried && titleErr) || saveError || undefined} required>
            <Input value={draft.title} maxLength={80} onValueChange={(v) => { setSaveError(null); setDraft((x) => (x ? { ...x, title: v } : x)); }} />
          </Field>
          <RadioCards name="bygg-vem" legend="Vem ska se rapporten?" value={draft.visibility} onChange={(v) => setDraft((x) => (x ? { ...x, visibility: v as Visibility } : x))} options={vis} />
          {tried && issue && <IssueNotice issue={issue} current={step} onGo={go} />}
          <div className="flex flex-wrap gap-3">
            <Button kind="primary" icon="check" pending={saveCmd.pending || shareCmd.pending} onClick={onSave}>
              Spara rapporten
            </Button>
            <Button icon="download" pending={dl.busy === "xlsx"} onClick={() => fetchFile("xlsx")}>
              Hämta som Excel
            </Button>
            <Button icon="download" pending={dl.busy === "csv"} onClick={() => fetchFile("csv")}>
              Hämta som CSV
            </Button>
            {def.output === "sammanstallning" && (
              <Button icon="download" pending={dl.busy === "pdf"} onClick={() => fetchFile("pdf")}>
                Hämta som PDF
              </Button>
            )}
          </div>
          <DownloadStatus done={dl.done} error={dl.error} />
        </Stack>
      );
    }
  }

  const canNext = step === 0 ? !!choice : step === 1 ? issue?.step !== "urval" : true;
  const onNext = () => {
    if (step === 0) {
      const [kind, key] = choice.split(":");
      if (kind === "mall") {
        const t = cat.templates.find((x) => x.key === key);
        if (!t || !isTemplateKey(t.key)) return;
        setDraft({ def: draftDef(cat, t.definition), title: draft?.templateKey === t.key ? draft.title : t.name, visibility: draft?.visibility ?? "private", templateKey: t.key });
        setPv(null);
        go(1, { mall: t.key });
        return;
      }
      setDraft((x) => (x && x.def.dataset === key && !x.templateKey ? x : { def: defaultDef(cat, key as Dataset), title: copy ? (x?.title ?? "") : "", visibility: x?.visibility ?? "private", templateKey: null }));
      setPv(null);
      go(1, { mall: undefined });
      return;
    }
    if (step === 1 && issue?.step === "urval") return;
    if (step === 2) {
      setTried(true);
      if (issue) return;
      setTried(false);
    }
    go(step + 1);
  };

  const header = editing ? saved!.title : draft?.title && step > 0 ? draft.title : "Ny rapport";
  return (
    <Page
      title={editing ? "Ändra rapporten" : "Ny rapport"}
      lead={editing || (draft && step > 0) ? header : undefined}
      crumbs={[{ label: "Rapportbyggare", to: "/rapportbyggare" }, ...(editing ? [{ label: saved!.title, to: `/rapportbyggare/${saved!.id}` }] : []), { label: editing ? "Ändra" : "Ny rapport" }]}
    >
      <Stepper steps={STEPS} current={step} ariaLabel="Steg för att bygga en rapport" />
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-6 max-[980px]:grid-cols-1">
        <Card>
          <Stack>
            <Stack gap="sm">
              <Eyebrow>{`Steg ${step + 1} av ${STEPS.length}`}</Eyebrow>
              <h2 tabIndex={-1} ref={headRef as RefObject<HTMLHeadingElement | null>} className="text-h2 font-extrabold tracking-[0.03em] uppercase outline-none">
                {TITLES[step]}
              </h2>
            </Stack>
            {body}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {step > first ? (
                <Button icon="arrow-left" onClick={() => go(step - 1)}>
                  Tillbaka
                </Button>
              ) : editing || copy ? (
                <Button icon="arrow-left" to={`/rapportbyggare/${(saved ?? copy)!.id}`}>
                  Tillbaka
                </Button>
              ) : (
                <span />
              )}
              {step < 3 && (
                <Button kind="primary" iconRight="arrow-right" disabled={!canNext} onClick={onNext}>
                  Nästa
                </Button>
              )}
            </div>
          </Stack>
        </Card>
        {draft && step > 0 && (
          <PreviewCard
            view={pv?.view ?? null}
            error={pv?.error ?? null}
            stale={stale}
            pending={previewCmd.pending}
            hasPreview={!!pv}
            onRun={() => void runPreview()}
            audience={audience}
            setAudience={setAudience}
            customerAllowed={cat.customerSharingAllowed}
            minN={cat.minN}
            title={draft.title || "Ny rapport"}
          />
        )}
      </div>
      {sharing && draft && (
        <ShareDialog
          // Oförändrad sparad definition: visningen av den sparade rapporten (loggas). Annars utkastet som sparas och delas.
          source={editing && canonicalJson(draft.def) === canonicalJson(saved!.definition) ? { savedReportId: saved!.id } : { contractId, definition: draft.def, templateKey: draft.templateKey }}
          ownerIsMe
          title={draft.title}
          minN={cat.minN}
          isList={draft.def.output === "lista"}
          hasNames={draft.def.columns.includes("resultat.namn")}
          pending={saveCmd.pending || shareCmd.pending}
          onShare={() => void doSave()}
          onClose={() => setSharing(false)}
        />
      )}
    </Page>
  );
}

function monthsBetween(from: string, to: string): number {
  const [y1, m1] = from.split("-").map(Number);
  const [y2, m2] = to.split("-").map(Number);
  return (y2 * 12 + m2) - (y1 * 12 + m1) + 1;
}

// ---------------------------------------------------------------- Förhandsvisningen
function PreviewCard({ view, error, stale, pending, hasPreview, onRun, audience, setAudience, customerAllowed, minN, title }: {
  view: BuilderView | null; error: string | null; stale: boolean; pending: boolean; hasPreview: boolean; onRun: () => void; audience: "mb" | "kommun";
  setAudience: (a: "mb" | "kommun") => void; customerAllowed: boolean; minN: number; title: string;
}) {
  return (
    <Card>
      <Stack>
        <h2 className="text-h2 font-extrabold tracking-[0.03em] uppercase">Förhandsvisning</h2>
        {customerAllowed && (
          <Check id="bygg-som-kommun" checked={audience === "kommun"} onCheckedChange={(c) => setAudience(c ? "kommun" : "mb")} aria-describedby="bygg-som-kommun-help">
            Visa som kommunens chef ser den
          </Check>
        )}
        {customerAllowed && (
          <p id="bygg-som-kommun-help" className="-mt-2 text-small text-text-muted">
            {`Samma regler som när rapporten delas med kommunen: grupper med färre än ${minN} deltagare visas som "färre än ${minN}" och Miljonbemannings interna mål visas inte. Chefen ser bara ärenden i sin egen enhet, så siffrorna kan bli lägre.`}
          </p>
        )}
        {stale && <Notice tone="warn" title="Förhandsvisningen gäller inte dina senaste ändringar." />}
        <span>
          <Button kind={hasPreview && !stale ? "secondary" : "primary"} icon="eye" pending={pending} onClick={onRun}>
            {hasPreview ? "Uppdatera förhandsvisningen" : "Visa förhandsvisning"}
          </Button>
        </span>
        {pending && <Loading />}
        {!pending && error && <Notice tone="critical" title={error} />}
        {/* Alltid på sidan (levande region): skärmläsaren hör antalet när förhandsvisningen är klar. */}
        <p role="status" className="m-0 font-bold empty:sr-only">
          {!pending && view ? `${view.counts.casesText} deltagare, ${view.periodLabel}` : ""}
        </p>
        {!pending && view && <BuilderViewPanel view={view} title={title} headingLevel={3} />}
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------- Urvalet
type DsCat = BuilderCatalog["datasets"][number];
const PRIMARY_DIMS: readonly Dimension[] = ["avtalsomrade_kod", "yrkesspar"];

function Filters({ ds, def, setDef, dimensionValues }: { ds: DsCat; def: ReportDefinition; setDef: (f: (d: ReportDefinition) => ReportDefinition) => void; dimensionValues: BuilderView["dimensionValues"] }) {
  const [more, setMore] = useState(() => ds.dimensions.some((d) => !PRIMARY_DIMS.includes(d.key) && (def.filters[d.key]?.length ?? 0) > 0));
  const toggle = (dim: Dimension, value: string, on: boolean) =>
    setDef((d) => {
      const cur = d.filters[dim] ?? [];
      const next = on ? [...new Set([...cur, value])] : cur.filter((x) => x !== value);
      const filters = { ...d.filters };
      if (next.length) filters[dim] = next;
      else delete filters[dim];
      return { ...d, filters };
    });
  const group = (dim: DsCat["dimensions"][number]) => {
    const choices = dim.choices ?? (dimensionValues[dim.key as "yrkesspar" | "bestallare_enhet"] ?? []).map((v) => ({ value: v, label: v }));
    const chosen = def.filters[dim.key] ?? [];
    // Valda värden som inte finns bland valen (t.ex. ett yrkesspår innan förhandsvisningen har körts) visas också.
    const all = [...choices, ...chosen.filter((v) => !choices.some((c) => c.value === v)).map((v) => ({ value: v, label: v }))];
    const helpId = `bygg-dim-${dim.key}-help`;
    return (
      <fieldset key={dim.key} className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
        <legend className="mb-1 font-bold">{dim.label}</legend>
        <p id={helpId} className="m-0 text-small text-text-muted">
          {all.length ? "Välj inget för att ta med alla." : "Visa förhandsvisningen för att välja bland värdena i urvalet."}
        </p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4">
          {all.map((c, i) => (
            <Check key={c.value} id={`bygg-dim-${dim.key}-${i}`} checked={chosen.includes(c.value)} onCheckedChange={(on) => toggle(dim.key, c.value, on)} aria-describedby={helpId}>
              {c.label}
            </Check>
          ))}
        </div>
      </fieldset>
    );
  };
  const primary = ds.dimensions.filter((d) => PRIMARY_DIMS.includes(d.key));
  const rest = ds.dimensions.filter((d) => !PRIMARY_DIMS.includes(d.key));
  return (
    <Stack>
      {primary.map(group)}
      {rest.length > 0 && (
        <div className="flex flex-col gap-3">
          <span>
            <Button kind="ghost" icon={more ? "chevron-up" : "chevron-down"} aria-expanded={more} aria-controls="bygg-fler-urval" onClick={() => setMore((x) => !x)}>
              Fler urval
            </Button>
          </span>
          <div id="bygg-fler-urval" hidden={!more} className="flex flex-col gap-4">
            {more && rest.map(group)}
          </div>
        </div>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------- Visa
function ShowStep({ ds, def, setDef, tried, issue, onGo }: {
  ds: DsCat; def: ReportDefinition; setDef: (f: (d: ReportDefinition) => ReportDefinition) => void; tried: boolean; issue: Issue | null; onGo: (step: number) => void;
}) {
  const measureErr = tried && def.output === "sammanstallning" ? (def.measures.length < 1 ? "Välj minst ett mått." : def.measures.length > MAX_MEASURES ? "Välj högst fyra mått." : null) : null;
  const columnErr = tried && def.output === "lista" && def.columns.length > MAX_COLUMNS ? `Välj högst ${MAX_COLUMNS} kolumner.` : null;
  // Fel som inte visas vid måtten eller kolumnerna (t.ex. perioden från steg 2) visas här – annars gör "Nästa" ingenting synligt.
  const other = tried && issue && issue.message !== measureErr && issue.message !== columnErr ? issue : null;
  const idKey = `${ds.columns[0]?.qualified ?? ""}`;
  const sections = [...new Set(ds.columns.map((c) => c.section))];
  const setOutput = (o: string) =>
    setDef((d) =>
      o === "lista"
        ? { ...d, output: "lista", measures: [], groupBy: null, split: "inget", chart: null, columns: d.columns.length ? d.columns : [...STANDARD_COLUMNS[d.dataset]] }
        : { ...d, output: "sammanstallning", columns: [], measures: d.measures.length ? d.measures : [ds.measures[0].key] },
    );
  const toggleMeasure = (k: string, on: boolean) =>
    setDef((d) => {
      const measures = on ? [...d.measures, k as ReportDefinition["measures"][number]] : d.measures.filter((x) => x !== k);
      return { ...d, measures, chart: d.chart && !measures.includes(d.chart.measure) ? null : d.chart };
    });
  const toggleColumn = (q: string, on: boolean) =>
    setDef((d) => ({ ...d, columns: on ? ds.columns.map((c) => c.qualified).filter((x) => x === q || d.columns.includes(x)) : d.columns.filter((x) => x !== q) }));
  const chartable = ds.measures.filter((m) => m.chartable && def.measures.includes(m.key));
  return (
    <Stack>
      {other && <IssueNotice issue={other} current={2} onGo={onGo} />}
      <RadioCards
        name="bygg-visa"
        legend="Visa som"
        value={def.output}
        onChange={setOutput}
        options={[
          { value: "sammanstallning", label: "Sammanställning (rekommenderas)", help: "Siffror per grupp, till exempel per avtalsområde." },
          { value: "lista", label: "Lista med en rad per deltagare", help: "Raderna visas inte här. De finns bara i filen." },
        ]}
      />
      {def.output === "sammanstallning" ? (
        <>
          <Field id="bygg-gruppera" label="Dela upp efter" help="Varje värde blir en rad i tabellen.">
            <Select value={def.groupBy ?? ""} options={[{ value: "", label: "Ingen uppdelning" }, ...ds.dimensions.map((d) => ({ value: d.key, label: d.label }))]} onValueChange={(v) => setDef((d) => ({ ...d, groupBy: (v || null) as Dimension | null }))} />
          </Field>
          <Field id="bygg-tid" label="Dela upp per tid" help="Kvartal och halvår följer kalenderåret.">
            <Select value={def.split} options={SPLITS.map((s) => ({ value: s, label: SPLIT_LABEL[s] }))} onValueChange={(v) => setDef((d) => ({ ...d, split: v as Split }))} />
          </Field>
          <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0" aria-describedby="bygg-matt-help">
            <legend className="mb-1 font-bold">Visa</legend>
            <p id="bygg-matt-help" className="m-0 text-small text-text-muted">
              Välj ett till fyra mått.
            </p>
            {measureErr && (
              <p role="alert" className="m-0 flex items-center gap-1.5 font-bold text-antracit">
                <Icon name="alert-circle" className="text-rod" />
                {measureErr}
              </p>
            )}
            {ds.measures.map((m) => (
              <div key={m.key} className="flex flex-col">
                <Check id={`bygg-matt-${m.key}`} checked={def.measures.includes(m.key)} onCheckedChange={(on) => toggleMeasure(m.key, on)} aria-describedby={`bygg-matt-${m.key}-help`}>
                  {m.label}
                </Check>
                <p id={`bygg-matt-${m.key}-help`} className="m-0 -mt-1 pl-8 text-small text-text-muted">
                  {m.help}
                </p>
              </div>
            ))}
          </fieldset>
          <Field id="bygg-diagram" label="Stapeldiagram" help="Diagrammet visar ett mått. Tabellen visas alltid.">
            <Select value={def.chart?.measure ?? ""} options={[{ value: "", label: "Inget diagram" }, ...chartable.map((m) => ({ value: m.key, label: m.label }))]} onValueChange={(v) => setDef((d) => ({ ...d, chart: v ? { measure: v as ReportDefinition["measures"][number] } : null }))} />
          </Field>
        </>
      ) : (
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-1 font-bold">Kolumner</legend>
          <p className="m-0 text-small text-text-muted">{`Välj högst ${MAX_COLUMNS} kolumner.`}</p>
          {def.dataset !== "deltagarmanader" && <p className="m-0 text-small">Listan har ärendenummer men inga namn.</p>}
          {columnErr && <Notice tone="critical" title={columnErr} />}
          <span>
            <Button icon="refresh" onClick={() => setDef((d) => ({ ...d, columns: [...STANDARD_COLUMNS[d.dataset]] }))}>
              Standardkolumner
            </Button>
          </span>
          {sections.map((sec) => (
            <div key={sec} className="flex flex-col">
              <h3 className="mt-2 mb-0 text-label font-extrabold tracking-[0.08em] uppercase">{sec}</h3>
              {ds.columns.filter((c) => c.section === sec).map((c) => {
                const fixed = c.qualified === idKey;
                return (
                  <div key={c.qualified} className="flex flex-col">
                    <Check id={`bygg-kol-${c.key}`} checked={fixed || def.columns.includes(c.qualified)} disabled={fixed} onCheckedChange={(on) => toggleColumn(c.qualified, on)}>
                      <span className="flex flex-col">
                        <span>{c.description}</span>
                        <span className="text-small text-text-muted">{c.key}</span>
                        {fixed && <span className="text-small">Ärendenumret är alltid med.</span>}
                        {c.key === "namn" && <span className="text-small">Filen får deltagarnas namn.</span>}
                      </span>
                    </Check>
                  </div>
                );
              })}
            </div>
          ))}
        </fieldset>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------- Fel i definitionen
type Issue = { message: string; step: DefinitionStep };
/** Felet i definitionen med en knapp till steget där det rättas (när det är ett annat steg). */
function IssueNotice({ issue, current, onGo }: { issue: Issue; current: number; onGo: (step: number) => void }) {
  const target = issue.step === "urval" ? 1 : 2;
  return (
    <Notice tone="critical" title={issue.message}>
      {target !== current && (
        <Button icon="arrow-left" onClick={() => onGo(target)}>
          {target === 1 ? "Ändra period och urval" : "Ändra hur uppgifterna visas"}
        </Button>
      )}
    </Notice>
  );
}
