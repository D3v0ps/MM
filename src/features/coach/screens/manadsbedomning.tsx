"use client";
// Månadsbedömning (/manadsbedomning/:caseId?manad=2027-01) – nivå 0–3 per progressionsområde, konkret observation från
// avtalets nivå, samlad status och plan för nästa månad. Nivån är tom tills coachen väljer; AI-förslag visas men fylls aldrig i.
// Port av prototypens coach.manad. Utkastet sparas automatiskt på servern (useAutosave, beslut 2026-10-02): 2 s efter
// senaste ändringen, när sidan lämnas och när den döljs – samma kommando som "Spara utkast" (autosave: true, en loggrad per
// besök). Godkända bedömningar sparas aldrig automatiskt.
import { useEffect, useRef, useState } from "react";
import { AUTOSAVE_ASSESSMENT } from "@/api/invalidation";
import { pct, plural } from "@/core/format";
import { addMonths, fmtDateShort, fmtDateTime, fmtWeekday, MONTHS, monthName } from "@/core/time";
import { newEditSession, useAutosave, type AutosaveResult } from "@/shell/autosave";
import { useCommand, useQuery } from "@/shell/backend";
import { useDraft, useUnsavedGuard } from "@/shell/guard";
import type { ScreenProps } from "@/shell/routes";
import {
  AiBox, AiTag, AutosaveStatus, Badge, BuildPhase, Button, Card, cn, DateInput, Divider, Field, Grid, Icon, Input, Kpi, Kv, Notice, Page, Row, Seg, Select, Split, Stack, Status,
  STATUS_ICON, STATUS_TEXT, Table, TextArea, toast, type SegOption,
} from "@/ui";
import { AI_OFF_TEXT, appendToSummary, ASSESSMENT_SUMMARY_MAX, assessmentPage, assessmentSave, canAppendToSummary, minVecka, monthlyDraft, noteInSummary, type AssessmentPage } from "../api";
import { breakable, CaseHeadView, caseCrumbs, CasePicker, Chips, customerPerspective, GateView, PageState, Persp, ToCaseButton, useCaseView } from "./shared";

type Ok = Extract<AssessmentPage, { kind: "ok" }>;
type Rag = "green" | "yellow" | "red";
type Level = 0 | 1 | 2 | 3;
const STATUS_OPTIONS: SegOption<Rag>[] = (["green", "yellow", "red"] as const).map((v) => ({ value: v, label: STATUS_TEXT[v], icon: STATUS_ICON[v], tone: v }));
const monShort = (mk: string) => MONTHS[Number(mk.slice(5, 7)) - 1];
/** "Minst ett område …" -> "minst ett område …" (texterna från avtalet i en mening). */
const lcfirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function ManadsbedomningScreen({ params, query }: ScreenProps) {
  const month = query.get("manad") || undefined;
  if (!params.caseId) {
    return (
      <CasePicker
        kind="manad"
        month={month}
        title={(m) => `Månadsbedömning ${monthName(m)}`}
        lead={(x) => `Välj deltagare. ${x.monthDueNote}: senast ${fmtWeekday(x.monthDueAt)}.`}
        basePath="/manadsbedomning"
        actionLabel="Bedöm"
      />
    );
  }
  return <Manad caseId={params.caseId} month={month} />;
}

function Manad({ caseId, month }: { caseId: string; month?: string }) {
  const q = useQuery(assessmentPage, { caseId, month });
  const v = q.data;
  // Appen: AI-utkastet skrivs i bakgrunden – hämta om vyn tills det är klart.
  const running = v?.kind === "ok" && v.aiDraft?.status === "running";
  useEffect(() => {
    if (!running) return undefined;
    const t = setTimeout(() => void q.refetch(), 2000);
    return () => clearTimeout(t);
  }, [running, q]);
  const title = month ? `Månadsbedömning ${monthName(month)}` : "Månadsbedömning";
  if (!v) return <PageState title={title} error={q.error} onRetry={() => void q.refetch()} />;
  if (v.kind === "gate") return <GateView gate={v.gate} title="Månadsbedömning" listPath="/manadsbedomning" />;
  return <ManadForm key={`${caseId}|${v.month}`} v={v} />;
}

/** Efter godkännandet: nästa deltagare att bedöma, i samma ordning som Min vecka (coach.minVecka finns oftast redan i cachen). */
function NextToAssess({ caseId }: { caseId: string }) {
  const q = useQuery(minVecka, {});
  const next = q.data?.monthly.open.find((x) => x.caseId !== caseId);
  if (!q.data) return null;
  if (!next) {
    return (
      <span className="inline-flex min-h-11 items-center gap-1.5 font-bold">
        <Icon name="check-circle" />
        Alla månadsbedömningar för {monthName(q.data.monthly.month)} är klara.
      </span>
    );
  }
  return (
    <Button kind="primary" iconRight="arrow-right" to={`/manadsbedomning/${encodeURIComponent(next.caseId)}?manad=${q.data.monthly.month}`}>
      Nästa att bedöma: {next.name} ({next.caseNumber})
    </Button>
  );
}

type AreaState = { level: Level | null; observation: string; nextStep: string };
type Plan = { goal1: string; goal2: string; plannedActivities: string; plannedEmployerContact: string; plannedAdaptation: string; nextCustomerMeeting: string };

function ManadForm({ v }: { v: Ok }) {
  const save = useCommand(assessmentSave);
  // Automatisk utkastsparning räknar bara om utkastlistor och kortet – inte sidan själv och inte sidopanelens räknare.
  const draftSave = useCommand(assessmentSave, { invalidate: AUTOSAVE_ASSESSMENT });
  const [editSession] = useState(newEditSession);
  useCaseView(v.head.caseId);
  const c = v.head;
  const month = v.month;
  const reqFrom = v.requiredFrom;
  const ma0 = v.assessment;
  // Utkastminne (bara i minnet): nivåer, observationer, status, sammanfattning och plan finns kvar om sidan lämnas osparad.
  const initialAreas = (): Record<string, AreaState> => Object.fromEntries(v.areas.map((a) => [a.key, { level: a.level, observation: a.observation || "", nextStep: a.nextStep || "" }]));
  const initialPlan = (): Plan => ({
    goal1: v.plan?.goal1 ?? "", goal2: v.plan?.goal2 ?? "", plannedActivities: v.plan?.plannedActivities ?? "", plannedEmployerContact: v.plan?.plannedEmployerContact ?? "",
    plannedAdaptation: v.plan?.plannedAdaptation ?? "", nextCustomerMeeting: v.plan?.nextCustomerMeeting ?? "",
  });
  const draftKey = `manadsbedomning|${c.caseId}|${month}`;
  const areasDraft = useDraft<Record<string, AreaState>>(`${draftKey}|omraden`, initialAreas);
  const overallDraft = useDraft<Rag | null>(`${draftKey}|status`, ma0?.overallStatus ?? null);
  const summaryDraft = useDraft<string>(`${draftKey}|sammanfattning`, ma0?.summary ?? "");
  const planDraft = useDraft<Plan>(`${draftKey}|plan`, initialPlan);
  const [areas, setAreas] = [areasDraft.value, areasDraft.set];
  const [overall, setOverall] = [overallDraft.value, overallDraft.set];
  const [summary, setSummary] = [summaryDraft.value, summaryDraft.set];
  const [plan, setPlan] = [planDraft.value, planDraft.set];
  // Sparat läge och senaste sparningstid i samma minne som fälten: Tillbaka visar formuläret som sparat, inte "osparat".
  const baselineDraft = useDraft<string>(`${draftKey}|sparat`, () => JSON.stringify([initialAreas(), ma0?.overallStatus ?? null, ma0?.summary ?? "", initialPlan()]));
  const [baseline, setBaseline] = [baselineDraft.value, baselineDraft.set];
  const savedAtDraft = useDraft<string | null>(`${draftKey}|sparadtid`, null);
  // Radens version (0022): skickas som expectedVersion – samma bedömning sparad i en annan flik ger "conflict", inget skrivs över.
  const versionDraft = useDraft<number | null>(`${draftKey}|version`, ma0?.version ?? null);
  const versionRef = useRef<number | null>(versionDraft.value);
  useEffect(() => {
    versionRef.current = versionDraft.value;
  }, [versionDraft.value]);
  const rememberVersion = (version: number) => {
    versionRef.current = version;
    versionDraft.set(version);
  };
  const restored = areasDraft.restored || overallDraft.restored || summaryDraft.restored || planDraft.restored;
  const forgetDraft = () => [areasDraft, overallDraft, summaryDraft, planDraft, baselineDraft, savedAtDraft, versionDraft].forEach((d) => d.clear());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [approvedNow, setApprovedNow] = useState(false);
  // Anteckningar som lagts in i sammanfattningen: added = visas som "Tillagd" tills sidan laddas om; used = skickas med
  // nästa sparning (servern loggar dem) och töms när sparningen lyckats.
  const [added, setAdded] = useState<string[]>([]);
  const [used, setUsed] = useState<string[]>([]);
  const summaryTooLong = summary.length > ASSESSMENT_SUMMARY_MAX;
  const setArea = (k: string, patch: Partial<AreaState>) => {
    setAreas((x) => ({ ...x, [k]: { ...x[k], ...patch } }));
    if (errors[k]) setErrors((e) => {
      const n = { ...e };
      delete n[k];
      return n;
    });
  };
  const setP = (k: keyof Plan, val: string) => setPlan((p) => ({ ...p, [k]: val }));
  const levels = Object.values(areas).map((a) => a.level).filter((x): x is Level => x != null);
  // Avtalets gränser (assessmentPage.progressionRule) – bara de obligatoriska områdena finns i formuläret.
  const rule = v.progressionRule;
  const clear = levels.some((x) => x >= rule.clearFromLevel);
  const any = levels.some((x) => x >= rule.anyFromLevel);
  const nextMonth = addMonths(month, 1);
  const approved = ma0?.status === "approved";
  const persp = customerPerspective(v.referrer);
  const changeKey = JSON.stringify([areas, overall, summary, plan]);
  const dirty = !approved && changeKey !== baseline;
  const areasPayload = () => Object.fromEntries(Object.entries(areas).map(([k, a]) => [k, { level: a.level, observation: a.observation.trim(), nextStep: a.nextStep.trim() }]));
  // Automatisk utkastsparning: samma kommando som "Spara utkast". För lång sammanfattning → "invalid" tills den kortats.
  // Anteckningar som lagts in i sammanfattningen skickas med en gång (servern loggar dem) och töms sedan.
  const autosave = useAutosave({
    enabled: !approved && !approvedNow && !save.pending,
    dirty,
    changeKey,
    initialSavedAt: savedAtDraft.value,
    save: async ({ keepalive }): Promise<AutosaveResult> => {
      const snapshot = JSON.stringify([areas, overall, summary, plan]);
      if (summary.trim().length > ASSESSMENT_SUMMARY_MAX) return { ok: false, reason: "invalid", text: "Sparas inte automatiskt – sammanfattningen är för lång" };
      const usedNow = used;
      const res = await draftSave
        .run(
          {
            caseId: c.caseId, month, areas: areasPayload(), summary: summary.trim(), overallStatus: overall, approve: false, plan: { ...plan, status: "draft" },
            usedNoteIds: usedNow.length ? usedNow : undefined, autosave: true, editSession, expectedVersion: versionRef.current ?? undefined,
          },
          { keepalive },
        )
        .catch(() => null);
      if (!res) return { ok: false, reason: "failed" };
      if (!res.ok) {
        // Godkänd i en annan flik, eller sparad där sedan den här fliken öppnades: inget skrivs över.
        if (res.error === "approved") return { ok: false, reason: "invalid", text: "Bedömningen är redan godkänd – inget sparas. Ladda om sidan." };
        if (res.error === "conflict") return { ok: false, reason: "invalid", text: "Bedömningen har ändrats i en annan flik eller på en annan enhet – ladda om sidan. Inget skrivs över." };
        return { ok: false, reason: "failed" };
      }
      rememberVersion(res.version);
      setUsed((u) => u.filter((id) => !usedNow.includes(id)));
      setBaseline(snapshot);
      savedAtDraft.set(res.savedAt);
      return { ok: true, savedAt: res.savedAt };
    },
  });
  // Medan det skickas/sparas (kommandot och omhämtningen efteråt) frågar vakten inte: annars varnar sidan för text som just
  // har skickats, innan fältet hunnit tömmas. Utkastet sparas först (trySave) – frågan visas bara om det inte gick.
  useUnsavedGuard(dirty && !save.pending, undefined, { trySave: () => autosave.flush() });
  const restartDraft = () => {
    setAreas(initialAreas());
    setOverall(ma0?.overallStatus ?? null);
    setSummary(ma0?.summary ?? "");
    setPlan(initialPlan());
    setErrors({});
    forgetDraft();
  };

  const doSave = async (approve: boolean) => {
    // Sammanfattningen stoppas på skärmen innan anropet – coachen ska aldrig få det allmänna felet "Ogiltiga uppgifter.".
    if (summary.trim().length > ASSESSMENT_SUMMARY_MAX) {
      toast(SUMMARY_TOO_LONG, "error");
      document.getElementById("cm-summary")?.focus();
      return;
    }
    // En pågående autosparning får bli klar först (anteckningarna loggas en gång).
    await autosave.settle();
    const res = await save
      .run({
        caseId: c.caseId,
        month,
        areas: areasPayload(),
        summary: summary.trim(),
        overallStatus: overall,
        approve,
        plan: { ...plan, status: approve ? "approved" : "draft" },
        usedNoteIds: used.length ? used : undefined,
        expectedVersion: versionRef.current ?? undefined,
      })
      .catch(() => null);
    if (!res) {
      toast("Bedömningen kunde inte sparas.", "error");
      return;
    }
    if (!res.ok) {
      if (res.error === "incomplete") {
        const missing = "missing" in res ? res.missing : [];
        const e: Record<string, string> = {};
        for (const k of missing) e[k] = areas[k]?.level == null ? "Välj nivå." : `Skriv en konkret observation. Mallen kräver belägg från nivå ${reqFrom}.`;
        if (!overall) e.overall = "Välj samlad status.";
        setErrors(e);
        toast(`Bedömningen kan inte godkännas: ${plural(missing.length, "område saknar", "områden saknar")} uppgifter${!overall ? " och samlad status saknas" : ""}.`, "error");
        setTimeout(() => {
          const first = document.querySelector<HTMLElement>('[data-row-alert="true"] select, #cm-overall');
          if (!first) return;
          try {
            first.scrollIntoView({ block: "center" });
          } catch {
            /* ignoreras */
          }
          first.focus?.();
        }, 40);
      } else toast(res.message || "Bedömningen kunde inte sparas.", "error");
      return;
    }
    setErrors({});
    setUsed([]);
    rememberVersion(res.version);
    // Sparat läge först, sedan glöms minnet (sidan hämtas om och visar det sparade).
    setBaseline(JSON.stringify([areas, overall, summary, plan]));
    autosave.markSaved(res.savedAt);
    forgetDraft();
    if (approve) {
      setApprovedNow(true);
      toast("Månadsbedömningen är godkänd. Månadsrapporten är granskad och kan godkännas och levereras.");
      try {
        window.scrollTo({ top: 0 });
      } catch {
        /* ignoreras */
      }
    } else toast("Utkastet är sparat.");
  };

  const crumbs = caseCrumbs(c, `Månadsbedömning ${monShort(month)}`);
  if (approved && ma0) {
    return (
      <Page title={`Månadsbedömning ${monthName(month)}`} eyebrow={`${c.name} · ${c.caseNumber}`} crumbs={crumbs}>
        <Notice tone="ok" title={approvedNow ? "Bedömningen är godkänd" : `Godkänd ${ma0.decidedAt ? fmtDateTime(ma0.decidedAt) : ""}`}>
          Månadsrapporten byggs av den godkända bedömningen. {v.report ? `Rapportens status: ${v.report.statusLabel.toLowerCase()}.` : ""} En godkänd bedömning ändras genom en
          rättad rapportversion.
        </Notice>
        <Row>
          {v.report && (
            <Button kind="primary" icon="file" to={`/rapporter/${encodeURIComponent(v.report.id)}`}>
              Förhandsgranska månadsrapporten
            </Button>
          )}
          {approvedNow && <NextToAssess caseId={c.caseId} />}
          <ToCaseButton caseId={c.caseId} />
          <Button kind="secondary" to="/min-vecka">
            Till Min vecka
          </Button>
          <Persp role={persp.role} userId={persp.userId} to="/portal/rapporter" label="Se kommunens rapportlista" />
        </Row>
        <Card title="Progressionsområden" icon="chart" flush>
          <Table
            caption="Godkänd bedömning"
            rowKey="key"
            rows={v.areas}
            columns={[
              { key: "a", label: "Område", render: (r) => <span className="font-bold">{r.label}</span> },
              { key: "l", label: "Nivå", nowrap: true, render: (r) => (r.level != null ? `${r.level} – ${v.scale[r.level]}` : "–") },
              { key: "o", label: "Konkret observation", render: (r) => r.observation || <span className="text-text-muted">–</span> },
              { key: "n", label: "Nästa steg", render: (r) => r.nextStep || "–" },
            ]}
          />
        </Card>
        <Card title="Samlad status och sammanfattning" icon="clipboard">
          <Stack gap="sm">
            <Status value={ma0.overallStatus} />
            <p className="whitespace-pre-line">{ma0.summary || "–"}</p>
          </Stack>
        </Card>
        <NotesPanel v={v} />
      </Page>
    );
  }

  const b = v.basis;
  const areaErrors = Object.keys(errors).filter((k) => k !== "overall").length;
  return (
    <Page
      title={`Månadsbedömning ${monthName(month)}`}
      eyebrow={`${c.name} · ${c.caseNumber}`}
      crumbs={crumbs}
      lead={`Bedöm förändringen jämfört med föregående månad. Nivån är tom tills du väljer. Konkret observation krävs från nivå ${reqFrom}.`}
      actions={
        <Badge tone="plan" icon="clock" title={v.dueNote}>
          Förslag: senast {fmtWeekday(v.dueAt)}
        </Badge>
      }
    >
      {restored && dirty && (
        <Notice tone="info" icon="edit" title="Ditt osparade utkast är återställt">
          <Row gap="sm">
            <span>Det du fyllde i senast finns kvar. Det är inte sparat ännu.</span>
            <Button kind="ghost" icon="reset" onClick={restartDraft}>
              Börja om
            </Button>
          </Row>
        </Notice>
      )}
      <Split wide>
        <Card title="Underlag för månaden" icon="book">
          <Stack>
            <CaseHeadView head={c} />
            <Grid cols={3}>
              <Kpi label="Godkända avstämningar" value={String(b.checkIns.length)} sub={b.checkIns.length ? b.checkIns.map((x) => fmtDateShort(x)).join(", ") : "Inga i månaden"} />
              <Kpi
                label="Närvarograd"
                value={b.attendance.rate != null ? pct(b.attendance.rate, 0) : "–"}
                sub={`${b.attendance.present + b.attendance.late} av ${b.attendance.planned - b.attendance.unregistered} tillfällen`}
              />
              <Kpi label="Händelser" value={String(b.events.length)} sub={b.events.length ? b.events.join(", ") : "Inga registrerade"} />
            </Grid>
            <p className="text-body text-text-muted">{v.dueNote}. Rapporten byggs bara av godkända uppgifter – aldrig av råtranskript.</p>
          </Stack>
        </Card>
        <Card title="Skala och statistik" icon="info">
          <Stack gap="sm">
            <Kv items={([0, 1, 2, 3] as const).map((n) => [`Nivå ${n}`, v.scale[n]] as const)} />
            <Divider />
            <p className="text-body">
              <b>Tydlig progression</b> = {lcfirst(rule.clear)}. <b>Någon progression</b> = {lcfirst(rule.any)}. Bara de obligatoriska områdena räknas. Gränserna står i avtalet.
            </p>
            <Row gap="sm">
              <Badge tone={clear ? "blue" : "outline"} icon={clear ? "check" : "minus"}>
                Tydlig: {clear ? "ja" : "nej"}
              </Badge>
              <Badge tone={any ? "bluetone" : "outline"} icon={any ? "check" : "minus"}>
                Någon: {any ? "ja" : "nej"}
              </Badge>
              <span className="text-small text-text-muted">med dina val hittills</span>
            </Row>
          </Stack>
        </Card>
      </Split>

      {v.aiOk ? (
        <>
          <Notice tone="info" title="AI-stöd">
            AI har skrivit utkast till observationer utifrån månadens godkända avstämningar och närvaron, med källor. Där underlaget inte räcker står det <b>Framgår inte</b> och inget
            nivåförslag ges. Nivåförslaget visas under rullgardinen men fylls aldrig i. <BuildPhase fas={2} />
          </Notice>
          <AiDraftCard v={v} />
        </>
      ) : (
        <p className="text-body text-text-muted">
          AI-stöd används inte i det här ärendet{c.protected ? "" : " eftersom deltagaren inte har samtyckt"}. Dokumentera manuellt.
        </p>
      )}

      <Card title="Progressionsområden" icon="chart" flush actions={<span className="text-small text-text-muted">{levels.length} av {v.areas.length} bedömda</span>}>
        <div className="overflow-x-auto">
          <table data-testid="progressionsomraden" className="w-full min-w-[860px] table-fixed border-collapse text-body max-[760px]:block max-[760px]:min-w-0">
            <caption className="sr-only">Progressionsområden med nivå, observation och nästa steg</caption>
            <colgroup className="max-[760px]:hidden">
              <col style={{ width: "20%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "37%" }} />
              <col style={{ width: "21%" }} />
            </colgroup>
            <thead className="max-[760px]:hidden">
              <tr>
                {["Område", "Nivå 0–3", "Konkret observation", "Nästa steg"].map((h) => (
                  <th key={h} scope="col" className="border-b-2 border-antracit bg-vit px-3 py-2.5 text-left text-label font-extrabold tracking-[0.08em] text-text-muted uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="max-[760px]:block">
              {v.areas.map((src) => {
                const k = src.key;
                const a = areas[k];
                const err = errors[k];
                const lab = src.label;
                const needObs = a.level != null && a.level >= reqFrom;
                const aiObs = src.aiObservationDraft;
                const noEv = !!aiObs?.noEvidence;
                const aiLvl = !noEv ? src.aiLevelSuggestion : null;
                const td = "border-b border-ljusgra px-3 py-2.5 align-top max-[760px]:block max-[760px]:w-full max-[760px]:border-b-0 max-[760px]:px-1 max-[760px]:py-1.5";
                const label = "max-[760px]:before:mb-1 max-[760px]:before:block max-[760px]:before:text-label max-[760px]:before:font-extrabold max-[760px]:before:tracking-[0.08em] max-[760px]:before:text-text-muted max-[760px]:before:uppercase max-[760px]:before:content-[attr(data-label)]";
                return (
                  <tr
                    key={k}
                    data-row-alert={err ? "true" : undefined}
                    className={cn(
                      "max-[760px]:block max-[760px]:border-b-2 max-[760px]:border-ljusgra max-[760px]:py-2",
                      err && "[&>td:first-child]:shadow-[inset_4px_0_0_var(--color-rod)] max-[760px]:pl-2 max-[760px]:shadow-[inset_4px_0_0_var(--color-rod)] max-[760px]:[&>td:first-child]:shadow-none",
                    )}
                  >
                    <td lang="sv" className={cn(td, "font-bold [overflow-wrap:break-word] [hyphens:manual]")}>
                      {breakable(lab)}
                    </td>
                    <td data-label="Nivå 0–3" className={cn(td, label)}>
                      <Stack gap="sm">
                        <label className="sr-only" htmlFor={`lvl-${k}`}>
                          Nivå för {lab}
                        </label>
                        <Select
                          id={`lvl-${k}`}
                          value={a.level == null ? "" : String(a.level)}
                          invalid={!!(err && a.level == null)}
                          placeholder="Välj nivå"
                          onValueChange={(x) => setArea(k, { level: x === "" ? null : (Number(x) as Level) })}
                          options={([0, 1, 2, 3] as const).map((n) => ({ value: String(n), label: `${n} – ${v.scale[n]}` }))}
                        />
                        {aiLvl != null && (
                          <div data-testid="ai-nivaforslag" className="block text-[0.875rem] leading-normal">
                            <span className="mr-1.5 align-[1px]">
                              <AiTag>AI</AiTag>
                            </span>
                            <span>
                              Förslag: <b>{`${aiLvl} – ${v.scale[aiLvl]}`}</b>
                            </span>
                          </div>
                        )}
                        {noEv && (
                          <div className="block text-[0.875rem] leading-normal">
                            <span className="mr-1.5 align-[1px]">
                              <AiTag>AI</AiTag>
                            </span>
                            <span className="text-text-muted">Inget nivåförslag</span>
                          </div>
                        )}
                      </Stack>
                    </td>
                    <td data-label="Konkret observation" className={cn(td, label)}>
                      <Stack gap="sm">
                        <label className="sr-only" htmlFor={`obs-${k}`}>
                          Konkret observation för {lab}
                        </label>
                        <TextArea id={`obs-${k}`} rows={2} value={a.observation} invalid={!!(err && a.level != null)} onValueChange={(x) => setArea(k, { observation: x })} maxLength={400} />
                        {needObs && !a.observation.trim() && !err && <span className="text-body text-text-muted">Obligatorisk från nivå {reqFrom}.</span>}
                        {err && (
                          <div role="alert" className="flex items-start gap-1.5 text-body font-bold text-antracit">
                            <Icon name="alert-circle" className="mt-1 flex-none text-rod" />
                            {err}
                          </div>
                        )}
                        {aiObs && !noEv && (
                          <AiBox>
                            <Row gap="sm">
                              <AiTag>AI-utkast</AiTag>
                              <span className="text-small text-text-muted">Källa: {aiObs.sources.join(", ") || "godkända avstämningar"}</span>
                            </Row>
                            <div>{aiObs.text}</div>
                            <div>
                              <Button kind="secondary" icon="copy" onClick={() => setArea(k, { observation: aiObs.text })}>
                                Använd utkastet
                              </Button>
                            </div>
                          </AiBox>
                        )}
                        {noEv && (
                          <AiBox className="border-dashed bg-vit">
                            <Row gap="sm">
                              <AiTag>AI-utkast</AiTag>
                              <span className="font-bold">Framgår inte</span>
                            </Row>
                            <div className="text-body text-text-muted">
                              {aiObs?.text || "Framgår inte av månadens godkända avstämningar."} Skriv din egen observation om du bedömer området.
                            </div>
                          </AiBox>
                        )}
                      </Stack>
                    </td>
                    <td data-label="Nästa steg" className={cn(td, label)}>
                      <label className="sr-only" htmlFor={`next-${k}`}>
                        Nästa steg för {lab}
                      </label>
                      <Input id={`next-${k}`} value={a.nextStep} onValueChange={(x) => setArea(k, { nextStep: x })} maxLength={160} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <NotesPanel
        v={v}
        summary={summary}
        added={added}
        onAdd={(id, text) => {
          setSummary((s0) => appendToSummary(s0, text));
          setAdded((a) => [...a, id]);
          setUsed((u) => (u.includes(id) ? u : [...u, id]));
          // Fältet ligger längre ned i ett annat kort – kvittensen läses upp (role=status) och knappen behåller fokus.
          toast("Anteckningen är tillagd i sammanfattningen. Skriv om texten så att den passar kommunen.");
        }}
      />

      <Split>
        <Card title="Samlad status och sammanfattning" icon="clipboard">
          <Stack>
            <Field label="Samlad status" id="cm-overall" required error={errors.overall} help="Ditt val. Föreslås aldrig av AI.">
              <Seg<Rag>
                id="cm-overall"
                ariaLabel="Samlad status"
                value={overall}
                onValueChange={(x) => {
                  setOverall(x);
                  setErrors((e) => {
                    const n = { ...e };
                    delete n.overall;
                    return n;
                  });
                }}
                options={STATUS_OPTIONS}
              />
            </Field>
            <Field
              label="Kort sammanfattning"
              id="cm-summary"
              help="Två till fyra meningar om månaden. Sakligt och funktionellt."
              error={summaryTooLong ? SUMMARY_TOO_LONG : undefined}
            >
              <TextArea rows={4} value={summary} onValueChange={setSummary} aria-describedby="cm-summary-count" />
              {/* Räknaren läses som beskrivning av fältet – inte vid varje tangenttryckning. Över gränsen läses felet upp (role=alert i Field). */}
              <div id="cm-summary-count" className={cn("text-small", summaryTooLong ? "font-bold" : "text-text-muted")}>
                {summary.length} av {ASSESSMENT_SUMMARY_MAX} tecken
              </div>
            </Field>
            {ma0?.aiSummaryDraft && (
              <AiBox>
                <Row gap="sm">
                  <AiTag>AI-utkast</AiTag>
                  <span className="text-small text-text-muted">Bygger bara på godkända avstämningar och registrerad närvaro</span>
                </Row>
                <div>{ma0.aiSummaryDraft}</div>
                <div>
                  <Button kind="secondary" icon="copy" onClick={() => setSummary(ma0.aiSummaryDraft ?? "")}>
                    Använd utkastet
                  </Button>
                </div>
              </AiBox>
            )}
          </Stack>
        </Card>
        <Card title={`Plan för ${monthName(nextMonth)}`} icon="target">
          <Stack>
            <Field label="Mål 1" id="pl-g1" help="Det viktigaste målet nästa månad.">
              <Input value={plan.goal1} onValueChange={(x) => setP("goal1", x)} maxLength={140} />
            </Field>
            <Field label="Mål 2" id="pl-g2" help="Ett andra mål, gärna kopplat till yrkesspåret.">
              <Input value={plan.goal2} onValueChange={(x) => setP("goal2", x)} maxLength={140} />
            </Field>
            {v.goals.length > 0 && <Chips label="Förslag på mål" items={v.goals} onPick={(g) => setP(plan.goal1 ? "goal2" : "goal1", g)} />}
            {v.aiDraft?.plan && !v.aiDraft.plan.noEvidence && (
              <AiBox>
                <Row gap="sm">
                  <AiTag>AI-utkast</AiTag>
                  <span className="text-small text-text-muted">Källa: {v.aiDraft.plan.sources.join(", ") || "godkända avstämningar"}</span>
                </Row>
                <div>{v.aiDraft.plan.text}</div>
                <span className="text-body text-text-muted">Underlag för planen – skriv målen och aktiviteterna själv.</span>
              </AiBox>
            )}
            <Field label="Planerade aktiviteter" id="pl-act" help="Vad deltagaren ska göra och hur ofta.">
              <Input value={plan.plannedActivities} onValueChange={(x) => setP("plannedActivities", x)} maxLength={200} />
            </Field>
            <Field label="Planerad arbetsgivarkontakt" id="pl-emp" help="Till exempel studiebesök, intervju eller praktikstart.">
              <Input value={plan.plannedEmployerContact} onValueChange={(x) => setP("plannedEmployerContact", x)} maxLength={200} />
            </Field>
            <Field label="Planerad anpassning" id="pl-adapt" help="Beskriv funktionellt, aldrig diagnos. Lämna tomt om ingen behövs.">
              <Input value={plan.plannedAdaptation} onValueChange={(x) => setP("plannedAdaptation", x)} maxLength={200} />
            </Field>
            <Field label="Nästa möte med kommunen" id="pl-meet" help="Datum för uppföljning med handläggaren, om det är bokat.">
              <DateInput value={plan.nextCustomerMeeting} onValueChange={(x) => setP("nextCustomerMeeting", x)} />
            </Field>
          </Stack>
        </Card>
      </Split>

      {Object.keys(errors).length > 0 && (
        <Notice tone="critical" title="Bedömningen är inte komplett">
          {plural(areaErrors, "område är markerat", "områden är markerade")}
          {errors.overall ? " och samlad status saknas" : ""}. Mallen kräver alltid belägg eller exempel från nivå {reqFrom}.
        </Notice>
      )}
      <Row>
        <Button kind="primary" size="lg" icon="check" pending={save.pending} onClick={() => void doSave(true)}>
          Godkänn bedömningen
        </Button>
        <Button kind="secondary" icon="file" pending={save.pending} onClick={() => void doSave(false)}>
          Spara utkast
        </Button>
        <AutosaveStatus state={autosave.state} savedAt={autosave.savedAt} invalidText={autosave.invalidText} />
      </Row>
    </Page>
  );
}

const SUMMARY_TOO_LONG = `Sammanfattningen får vara högst ${ASSESSMENT_SUMMARY_MAX} tecken. Korta texten innan du lägger till fler anteckningar.`;

/**
 * ANTECKNINGAR FRÅN MÅNADEN (rapporter steg 2): de fria anteckningarna kommer inte med i rapporten av sig själva. Coachen
 * lägger in det som behövs i sammanfattningen, skriver om texten för kommunen och godkänner. Utan onAdd (godkänd
 * bedömning) visas panelen utan knappar. Anteckningarna skickas aldrig till AI.
 */
function NotesPanel({ v, summary = "", added = [], onAdd }: { v: Ok; summary?: string; added?: string[]; onAdd?: (id: string, text: string) => void }) {
  const word = MONTHS[Number(v.month.slice(5, 7)) - 1];
  return (
    <Card title="Anteckningar från månaden" icon="edit">
      <Stack gap="sm">
        {onAdd ? (
          <p className="m-0">
            Anteckningar från {word}. De kommer inte med i rapporten av sig själva. Lägg till det som behövs i sammanfattningen och skriv om texten så att den passar
            kommunen. Det du godkänner kommer med i månadsrapporten.
          </p>
        ) : (
          <p className="m-0">Anteckningar från {word}. Bedömningen är godkänd. Det som står i sammanfattningen kommer med i månadsrapporten.</p>
        )}
        {v.notes.length === 0 ? (
          <p className="m-0 text-text-muted">Inga anteckningar från {word}.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label={`Anteckningar från ${word}`}>
            {v.notes.map((n) => {
              // Tillagd nu, eller texten finns redan i sammanfattningen (till exempel efter omladdning).
              const done = added.includes(n.id) || noteInSummary(summary, n.body);
              const fits = canAppendToSummary(summary, n.body);
              const tooLongId = `note-${n.id}-too-long`;
              return (
                <li key={n.id} className="flex flex-col gap-1.5 rounded-mb border border-ljusgra px-3.5 py-3">
                  <div className="text-small text-text-muted">
                    <b className="text-antracit">{fmtDateShort(n.occurredOn)}</b> · {n.kindLabel} · {n.authorName}
                  </div>
                  <p className="m-0 whitespace-pre-line [overflow-wrap:anywhere]">{n.body}</p>
                  {onAdd && (
                    <div className="flex flex-col items-start gap-1">
                      {/* aria-disabled i stället för disabled: knappen behåller fokus när den byter till "Tillagd", och skärmläsaren hör varför den inte går att använda. */}
                      {done ? (
                        <Button icon="check" aria-disabled="true">Tillagd i sammanfattningen</Button>
                      ) : (
                        <Button
                          icon="plus"
                          aria-disabled={fits ? undefined : "true"}
                          aria-describedby={fits ? undefined : tooLongId}
                          onClick={() => {
                            if (fits) onAdd(n.id, n.body);
                          }}
                        >
                          Lägg till i sammanfattningen
                        </Button>
                      )}
                      {!done && !fits && <span id={tooLongId} className="text-body font-bold">{SUMMARY_TOO_LONG}</span>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Stack>
    </Card>
  );
}

/**
 * "Skapa AI-utkast från godkända avstämningar" (coach.monthlyDraft): utkast till observation per område, sammanfattning och
 * plan – bara från månadens godkända avstämningar och registrerad närvaro. Nivåerna och samlad status väljer coachen själv.
 */
function AiDraftCard({ v }: { v: Ok }) {
  const draft = useCommand(monthlyDraft);
  const d = v.aiDraft;
  const n = v.basis.checkIns.length;
  // AI av (produktion utan leverantör, beslut 2026-10-08): klartext i stället för en knapp som inte fungerar.
  if (v.aiOff) {
    return (
      <Card title="AI-utkast från godkända avstämningar" icon="sparkles">
        <Notice tone="warn" title="Tal till text är inte kopplat ännu">
          {AI_OFF_TEXT} Observationerna, sammanfattningen och planen skrivs manuellt – det är fullt likvärdigt.
        </Notice>
      </Card>
    );
  }
  const create = async () => {
    const res = await draft.run({ caseId: v.head.caseId, month: v.month }).catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "AI-utkastet kunde inte skapas. Skriv observationerna själv.", "error");
      return;
    }
    if (res.status === "failed") toast(res.error ?? "AI-utkastet kunde inte skapas. Skriv observationerna själv.", "error");
    else if (res.status === "succeeded") toast("AI-utkasten är klara. Granska dem och välj nivåerna själv.");
    else toast("AI skriver utkasten. De visas här när de är klara.");
  };
  return (
    <Card title="AI-utkast från godkända avstämningar" icon="sparkles">
      <Stack gap="sm">
        <p>
          AI skriver ett utkast till observation för varje område, en sammanfattning och ett underlag för planen. Underlaget är bara månadens{" "}
          {n === 1 ? "godkända avstämning" : `${n} godkända avstämningar`} och den registrerade närvaron – aldrig råtranskript. Du väljer nivåerna och den samlade
          statusen själv.
        </p>
        <Row gap="sm">
          <Button kind="secondary" icon="sparkles" pending={draft.pending || d?.status === "running"} onClick={() => void create()}>
            {d?.status === "succeeded" ? "Skapa nya AI-utkast" : "Skapa AI-utkast från godkända avstämningar"}
          </Button>
          {d?.status === "running" && (
            <span role="status" className="text-body font-bold">
              AI skriver utkasten …
            </span>
          )}
          {d?.status === "succeeded" && (
            <span className="text-small text-text-muted">
              <AiTag>AI-utkast</AiTag> Skapade {fmtDateTime(d.createdAt)}
            </span>
          )}
        </Row>
        {d?.status === "failed" && (
          <Notice tone="warn" title="AI-utkastet kunde inte skapas">
            {d.error ?? "Skriv observationerna själv."}
          </Notice>
        )}
      </Stack>
    </Card>
  );
}
