"use client";
// Månadsbedömning (/manadsbedomning/:caseId?manad=2027-01) – nivå 0–3 per progressionsområde, konkret observation från
// avtalets nivå, samlad status och plan för nästa månad. Nivån är tom tills coachen väljer; AI-förslag visas men fylls aldrig i.
// Port av prototypens coach.manad.
import { useState } from "react";
import { pct, plural } from "@/core/format";
import { addMonths, fmtDateShort, fmtDateTime, fmtWeekday, MONTHS, monthName } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import type { ScreenProps } from "@/shell/routes";
import {
  AiBox, AiTag, Badge, BuildPhase, Button, Card, cn, DateInput, Divider, Field, Grid, Icon, Input, Kpi, Kv, Notice, Page, Row, Seg, Select, Split, Stack, Status,
  STATUS_ICON, STATUS_TEXT, Table, TextArea, toast, type SegOption,
} from "@/ui";
import { assessmentPage, assessmentSave, type AssessmentPage } from "../api";
import { breakable, CaseHeadView, CasePicker, Chips, customerPerspective, GateView, MIN_VECKA_CRUMB, PageState, Persp, useCaseView } from "./shared";

type Ok = Extract<AssessmentPage, { kind: "ok" }>;
type Rag = "green" | "yellow" | "red";
type Level = 0 | 1 | 2 | 3;
const STATUS_OPTIONS: SegOption<Rag>[] = (["green", "yellow", "red"] as const).map((v) => ({ value: v, label: STATUS_TEXT[v], icon: STATUS_ICON[v], tone: v }));
const monShort = (mk: string) => MONTHS[Number(mk.slice(5, 7)) - 1];

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
  const title = month ? `Månadsbedömning ${monthName(month)}` : "Månadsbedömning";
  if (!v) return <PageState title={title} error={q.error} onRetry={() => void q.refetch()} />;
  if (v.kind === "gate") return <GateView gate={v.gate} title="Månadsbedömning" listPath="/manadsbedomning" />;
  return <ManadForm key={`${caseId}|${v.month}`} v={v} />;
}

type AreaState = { level: Level | null; observation: string; nextStep: string };
type Plan = { goal1: string; goal2: string; plannedActivities: string; plannedEmployerContact: string; plannedAdaptation: string; nextCustomerMeeting: string };

function ManadForm({ v }: { v: Ok }) {
  const save = useCommand(assessmentSave);
  useCaseView(v.head.caseId);
  const c = v.head;
  const month = v.month;
  const reqFrom = v.requiredFrom;
  const ma0 = v.assessment;
  const [areas, setAreas] = useState<Record<string, AreaState>>(() =>
    Object.fromEntries(v.areas.map((a) => [a.key, { level: a.level, observation: a.observation || "", nextStep: a.nextStep || "" }])),
  );
  const [overall, setOverall] = useState<Rag | null>(ma0?.overallStatus ?? null);
  const [summary, setSummary] = useState(ma0?.summary ?? "");
  const [plan, setPlan] = useState<Plan>(() => ({
    goal1: v.plan?.goal1 ?? "", goal2: v.plan?.goal2 ?? "", plannedActivities: v.plan?.plannedActivities ?? "", plannedEmployerContact: v.plan?.plannedEmployerContact ?? "",
    plannedAdaptation: v.plan?.plannedAdaptation ?? "", nextCustomerMeeting: v.plan?.nextCustomerMeeting ?? "",
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [approvedNow, setApprovedNow] = useState(false);
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
  const clear = levels.some((x) => x >= 2);
  const any = levels.some((x) => x >= 1);
  const nextMonth = addMonths(month, 1);
  const approved = ma0?.status === "approved";
  const persp = customerPerspective(v.referrer);

  const doSave = async (approve: boolean) => {
    const res = await save
      .run({
        caseId: c.caseId,
        month,
        areas: Object.fromEntries(Object.entries(areas).map(([k, a]) => [k, { level: a.level, observation: a.observation.trim(), nextStep: a.nextStep.trim() }])),
        summary: summary.trim(),
        overallStatus: overall,
        approve,
        plan: { ...plan, status: approve ? "approved" : "draft" },
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

  const crumbs = [MIN_VECKA_CRUMB, { label: `Månadsbedömning ${monShort(month)}` }];
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
            <p>{ma0.summary || "–"}</p>
          </Stack>
        </Card>
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
            <p className="text-small text-text-muted">{v.dueNote}. Rapporten byggs bara av godkända uppgifter – aldrig av råtranskript.</p>
          </Stack>
        </Card>
        <Card title="Skala och statistik" icon="info">
          <Stack gap="sm">
            <Kv items={([0, 1, 2, 3] as const).map((n) => [`Nivå ${n}`, v.scale[n]] as const)} />
            <Divider />
            <p className="text-small">
              <b>Tydlig progression</b> = minst ett område på nivå 2 eller högre. <b>Någon progression</b> = minst ett område på nivå 1 eller högre. Definitionen är konfigurerbar.
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
        <Notice tone="info" title="AI-stöd">
          AI har skrivit utkast till observationer utifrån månadens godkända avstämningar och närvaron, med källor. Där underlaget inte räcker står det <b>Framgår inte</b> och inget
          nivåförslag ges. Nivåförslaget visas under rullgardinen men fylls aldrig i. <BuildPhase fas={2} />
        </Notice>
      ) : (
        <p className="text-small text-text-muted">
          AI-stöd används inte i det här ärendet{c.protected ? " (skyddade personuppgifter)" : " eftersom deltagaren inte har samtyckt"}. Dokumentera manuellt.
        </p>
      )}

      <Card title="Progressionsområden" icon="chart" flush actions={<span className="text-small text-text-muted">{levels.length} av {v.areas.length} bedömda</span>}>
        <div className="overflow-x-auto">
          <table data-testid="progressionsomraden" className="w-full min-w-[860px] table-fixed border-collapse text-ui max-[760px]:block max-[760px]:min-w-0">
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
                        {needObs && !a.observation.trim() && !err && <span className="text-small text-text-muted">Obligatorisk från nivå {reqFrom}.</span>}
                        {err && (
                          <div role="alert" className="flex items-start gap-1.5 text-small font-bold text-antracit">
                            <Icon name="alert-circle" className="mt-px text-rod" />
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
                            <div className="text-small text-text-muted">
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
            <Field label="Kort sammanfattning" id="cm-summary" help="Två till fyra meningar om månaden. Sakligt och funktionellt.">
              <TextArea rows={4} value={summary} onValueChange={setSummary} maxLength={800} />
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
      </Row>
    </Page>
  );
}
