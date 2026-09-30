"use client";
// Ledningsvy för chef/controller (/ledning, prototypens chef.oversikt): resultat mot mål, prognos, trend, flaggor med
// kvittens, tidig uppmärksamhet, SLA, ofakturerat, avtalsavvikelser, per coach, per avtalsområde och deltagarnas röst.
// Mål, minsta antal och övriga avtalsvärden kommer från avtalskonfigurationen via frågorna – aldrig hårdkodade här.
import { useState, type ReactNode } from "react";
import { kr, pct, plural } from "@/core/format";
import { fmtDate, fmtDateTime, monthName } from "@/core/time";
import { useQuery } from "@/shell/backend";
import { path, useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { DemoOnly } from "@/shell/runtime";
import {
  Badge, BuildPhase, Button, Card, CaseLink, CellSub, DemoNote, Empty, Grid, Icon, Kpi, Meter, Notice, Page, PerspectiveLink, QueryView, Row, SlaBadge, Split,
  Stack, TabPanel, Table, Tabs, UserName, cn, type MeterMarker, type TabDef,
} from "@/ui";
import {
  LEDNING_TABS, ledningAreas, ledningCoaches, ledningHead, ledningOverview, ledningPulse,
  type AlertView, type CustomerCard as CustomerCardData, type LedningOverview, type LedningTab, type ResultTargets,
} from "../api";
import { AckModal, AlertRow, Big, Caps, Details, KpiStatusBadge, KPI_STATUS, MiniBar, pct0, RR_STATUS, RrBadge, Tiles, TrendChart, WrapBtn, type AckTarget, type BarMarker } from "./parts";

const TABS: TabDef<LedningTab>[] = [
  { id: "kpi", label: "Resultat och KPI:er", icon: "target" },
  { id: "coacher", label: "Per coach", icon: "users" },
  { id: "omraden", label: "Per avtalsområde", icon: "grid" },
  { id: "puls", label: "Deltagarnas röst", icon: "smile" },
];
const isTab = (v: string | null): v is LedningTab => !!v && (LEDNING_TABS as readonly string[]).includes(v);
const fmtMin = (v: number | null | undefined) => (v == null ? "–" : `${String(Math.round(v * 10) / 10).replace(".", ",")} min`);

/** Målmarkeringar: avtalsmålet i rött, internt mål i antracit. */
function goalMarkers(t: ResultTargets): (MeterMarker & BarMarker)[] {
  const out: (MeterMarker & BarMarker)[] = [];
  if (t.contract != null) out.push({ value: t.contract, label: `Avtalsmål ${pct0(t.contract)}`, tone: "red" });
  if (t.internal != null) out.push({ value: t.internal, label: `Internt mål ${pct0(t.internal)}`, tone: "dark" });
  return out;
}

export function LedningScreen({ query }: ScreenProps) {
  const nav = useNav();
  const flik = query.get("flik");
  const tab: LedningTab = isTab(flik) ? flik : "kpi";
  const head = useQuery(ledningHead, {});
  const [ackAlert, setAckAlert] = useState<AckTarget | null>(null);
  const h = head.data;
  return (
    <Page
      title="Ledningsvy"
      eyebrow={h ? `Chef och controller · ${h.customerName}, avtal ${h.contractNumber}` : "Chef och controller"}
      lead="Resultat mot mål, flaggor och tidig uppmärksamhet. Allt är i läsläge – du kvitterar flaggor med en kort åtgärdsplan."
      actions={
        <DemoOnly>
          <WrapBtn>
            <PerspectiveLink role="kommun_chef" to="/portal/bestallarrapport" label="Så ser kommunens chef resultatet – utan internt mål" />
          </WrapBtn>
        </DemoOnly>
      }
    >
      <Tabs
        id="ldg"
        ariaLabel="Ledningsvyns flikar"
        active={tab}
        onChange={(id) => nav.replace(path("/ledning", { flik: id === "kpi" ? null : id }))}
        tabs={TABS.map((t) => (t.id === "kpi" ? { ...t, count: h?.alertCount ?? null } : t))}
      />
      <TabPanel tabsId="ldg" active={tab}>
        {tab === "kpi" && <KpiTab onAck={setAckAlert} />}
        {tab === "coacher" && <CoachTab />}
        {tab === "omraden" && <AreaTab />}
        {tab === "puls" && <PulseTab onAck={setAckAlert} />}
      </TabPanel>
      {ackAlert && <AckModal alert={ackAlert} onClose={() => setAckAlert(null)} />}
    </Page>
  );
}

// ================================================================ Flik: Resultat och KPI:er
function KpiTab({ onAck }: { onAck: (a: AckTarget) => void }) {
  const q = useQuery(ledningOverview, {});
  return <QueryView query={q}>{(d) => <KpiContent d={d} onAck={onAck} />}</QueryView>;
}

function KpiContent({ d, onAck }: { d: LedningOverview; onAck: (a: AckTarget) => void }) {
  const { targets: t, rolling, sinceStart, forecast } = d;
  const meterMax = Math.max(0.6, Math.ceil((Math.max(rolling.value || 0, forecast.value || 0) + 0.05) * 10) / 10);
  const markers = goalMarkers(t);
  const tone = rolling.status === "below_contract" ? "alert" : rolling.status === "below_internal" ? "watch" : undefined;
  const critical = d.criticalCount;
  const esc = plural(d.escalatedCount, "ärende", "ärenden");
  return (
    <Stack gap="lg">
      <Tiles>
        <Kpi
          label="Resultatgrad, rullande 6 mån"
          value={rolling.value == null ? "–" : pct(rolling.value)}
          tone={tone}
          statusText={tone ? RR_STATUS[rolling.status]?.label : undefined}
          sub={`${rolling.num} av ${rolling.den} avslut · minst ${rolling.minN} krävs för flagga`}
        >
          {!tone && <RrBadge status={rolling.status} />}
        </Kpi>
        <Kpi label="Sedan avtalsstart" value={sinceStart.value == null ? "–" : pct(sinceStart.value)} sub={`${sinceStart.num} av ${sinceStart.den} avslut sedan ${fmtDate(d.contractStart)}`} />
        <Kpi label="Prognos" value={pct(forecast.value)} sub={`Om ${forecast.candidates} deltagare med arbetserbjudande eller i fas 5 når resultat`} />
        <Kpi
          label="Flaggor att hantera"
          value={String(d.alertCount)}
          tone={critical > 0 ? "alert" : undefined}
          statusText={critical > 0 ? plural(critical, "kritisk flagga", "kritiska flaggor") : undefined}
          sub={critical > 0 ? `${esc} med tidig uppmärksamhet` : `Inga kritiska · ${esc} med tidig uppmärksamhet`}
        />
      </Tiles>

      <Split wide>
        <Card title="Resultatgrad mot mål" icon="target" actions={<BuildPhase fas={2} />}>
          <Stack>
            <div className="flex flex-wrap items-end gap-x-7 gap-y-4">
              <Stack gap="xs" className="gap-0.5">
                <Caps>Rullande 6 månader</Caps>
                <Big>{rolling.value == null ? "–" : pct(rolling.value)}</Big>
                <span className="text-small text-text-muted">
                  {rolling.num} av {rolling.den} avslut räknas · {rolling.excluded} räknas inte · {rolling.prelim} väntar på verifiering
                </span>
              </Stack>
              <Stack gap="xs" className="gap-0.5">
                <Caps>Sedan start</Caps>
                <span className="text-[1.5rem] font-bold tabular-nums">{sinceStart.value == null ? "–" : pct(sinceStart.value)}</span>
                <span className="text-small text-text-muted">n = {sinceStart.den}</span>
              </Stack>
              <Stack gap="sm" className="gap-1.5">
                <div>
                  <RrBadge status={rolling.status} />
                </div>
                {d.rrAlert && (
                  <div>
                    <Button icon="check" onClick={() => d.rrAlert && onAck(d.rrAlert)}>
                      Kvittera flaggan
                    </Button>
                  </div>
                )}
                {!d.rrAlert && d.rrAckAt && (
                  <span className="text-small text-text-muted">
                    <Icon name="check" /> Flaggan kvitterad {fmtDateTime(d.rrAckAt)}
                  </span>
                )}
              </Stack>
            </div>
            <Meter
              value={rolling.value || 0}
              max={meterMax}
              markers={markers}
              label={`Resultatgrad ${pct(rolling.value)}. Avtalsmål ${pct0(t.contract)}, internt mål ${pct0(t.internal)}. Skala 0 till ${pct0(meterMax)}.`}
            />
            <div className="text-small text-text-muted">
              Skala 0–{pct0(meterMax)}. Under {pct0(t.internal)} blir flaggan <b>Bevaka</b> (till chef och controller). Under {pct0(t.contract)} blir den <b>Åtgärd krävs</b> (även till
              avtalsansvarig). Ingen flagga förrän minst {t.minN} avslut finns i fönstret.
            </div>
            {d.resultDefinitionUnset && (
              <Notice tone="warn" title="Resultatdefinitionen är inte fastställd (öppen fråga 6)">
                <Stack gap="sm">
                  {d.prototypeDefinition && <span>{d.prototypeDefinition}</span>}
                  <span>
                    I skarp drift är flaggorna Bevaka och Åtgärd krävs <b>vilande</b> tills definitionen är fastställd tillsammans med Botkyrka.
                  </span>
                  <DemoOnly>
                    <span>
                      <Button kind="ghost" iconRight="arrow-right" to="/om/fragor">
                        Se de öppna frågorna
                      </Button>
                    </span>
                  </DemoOnly>
                </Stack>
              </Notice>
            )}
            <Stack gap="sm">
              <Caps as="h3">Per månad sedan avtalsstart</Caps>
              <TrendChart rows={d.trend} contract={t.contract} internal={t.internal} minN={t.minN} />
            </Stack>
          </Stack>
        </Card>
        <Stack>
          <Card title="Prognos" icon="trending-up">
            <Stack>
              <Big>{pct(forecast.value)}</Big>
              <p>
                Om de <b>{forecast.candidates}</b> deltagarna med arbetserbjudande eller i fas 5 når resultat blir resultatgraden <b>{pct(forecast.value)}</b>.
              </p>
              <Meter value={forecast.value || 0} max={meterMax} markers={markers} label={`Prognos ${pct(forecast.value)}`} />
              <Stack gap="sm">
                <div>
                  <Caps>Bara de med arbetserbjudande</Caps>
                  <div>
                    <b>{pct(forecast.offerOnly)}</b> ({plural(forecast.withOffer, "deltagare", "deltagare")})
                  </div>
                </div>
                <div>
                  <Caps>Väntar på verifiering</Caps>
                  <div>{forecast.prelim} avslut med resultat räknas med i prognosen.</div>
                </div>
              </Stack>
              <div className="text-small text-text-muted">Prognosen är ett räkneexempel för ledningen. Den visas inte för kommunen.</div>
            </Stack>
          </Card>
          <CustomerCard c={d.customer} liveValue={rolling.value} />
        </Stack>
      </Split>

      <Split>
        <Card
          title="Flaggor för chef och controller"
          icon="flag"
          actions={<Badge tone={d.flagAlerts.length ? "dark" : "outline"}>{d.flagAlerts.length} att kvittera</Badge>}
        >
          <Stack>
            {d.flagAlerts.length === 0 ? (
              <Empty icon="check-circle" title="Inga flaggor att kvittera">
                Nya flaggor visas här när de uppstår.
              </Empty>
            ) : (
              <div>
                {d.flagAlerts.map((a) => (
                  <AlertRow key={a.key} a={a} onAck={onAck} />
                ))}
              </div>
            )}
            <div className="text-small text-text-muted">Eskaleringar om utebliven progression visas under Tidig uppmärksamhet.</div>
            {d.acked.length > 0 && (
              <Details summary={`Kvitterade flaggor (${d.acked.length})`}>
                <div>
                  {d.acked.map((a) => (
                    <AlertRow key={a.key} a={a} />
                  ))}
                </div>
              </Details>
            )}
          </Stack>
        </Card>
        <EarlyCard d={d} onAck={onAck} />
      </Split>

      <Grid cols={3}>
        <SlaCard d={d} />
        <UnbilledCard d={d} />
        <Card title="Avtalsavvikelser och varningar" icon="flag">
          <Stack>
            <div className="flex flex-wrap items-center gap-5">
              <Stack gap="xs" className="gap-0">
                <Caps>Öppna</Caps>
                <Big>{d.cds.open}</Big>
              </Stack>
              <Stack gap="xs" className="gap-0">
                <Caps>Varningar</Caps>
                <Big>
                  {d.cds.warnings} av {d.cds.warningsBeforeTermination}
                </Big>
              </Stack>
            </div>
            <Stack gap="sm">
              <span className="text-small font-bold">Öppna åtgärdsplaner</span>
              {d.cds.openPlans.length === 0 ? (
                <span className="text-small text-text-muted">Inga öppna åtgärdsplaner.</span>
              ) : (
                d.cds.openPlans.map((x) => (
                  <Row between key={x.id} className="gap-1.5">
                    <span className="min-w-0 flex-[1_1_140px] text-small">{x.description.length > 60 ? `${x.description.slice(0, 58)}…` : x.description}</span>
                    {x.sla && x.dueAt ? (
                      <SlaBadge sla={x.sla} dueAt={x.dueAt} />
                    ) : x.actionPlanDue ? (
                      <span className="text-small">Klart senast {fmtDate(x.actionPlanDue)}</span>
                    ) : (
                      <span className="text-small text-text-muted">Datum saknas</span>
                    )}
                  </Row>
                ))
              )}
            </Stack>
            <div className="text-small text-text-muted">{d.cds.warningsBeforeTermination} skriftliga varningar kan leda till uppsägning av avtalet.</div>
            <div>
              <Button iconRight="arrow-right" to="/avtalsavvikelser">
                Öppna registret
              </Button>
            </div>
          </Stack>
        </Card>
      </Grid>

      <Stack gap="md" className="gap-3">
        <Card title="Övriga KPI:er" icon="chart" flush>
          <Table
            rowKey="key"
            caption="KPI:er mot mål"
            rows={d.kpis}
            columns={[
              { key: "label", label: "KPI", render: (x) => <span className="font-bold">{x.label}</span> },
              { key: "period", label: "Period", render: (x) => (x.key === "resultatgrad" ? "Rullande 6 mån" : x.key === "nojdhet" ? "Rullande 3 mån" : monthName(d.lastMonth)) },
              { key: "value", label: "Utfall", num: true, nowrap: true, render: (x) => <span className="font-bold">{x.value == null ? "–" : pct(x.value)}</span> },
              { key: "n", label: "Underlag", num: true, nowrap: true, render: (x) => `${x.num} av ${x.den}` },
              {
                key: "target",
                label: "Mål",
                render: (x) =>
                  x.key === "resultatgrad" ? `Internt ${pct0(x.target)} · avtal ${pct0(x.contractTarget)}` : x.targetUnset ? <Badge tone="plan">Ej fastställt</Badge> : pct0(x.target),
              },
              { key: "status", label: "Status", render: (x) => <KpiStatusBadge status={x.status} /> },
            ]}
          />
        </Card>
        <p className="text-small text-text-muted">
          Mål som inte är fastställda med Botkyrka ger ingen flagga förrän de är fastställda. Sista dag för månadsrapporterna är ett förslag tills kommunen bekräftat den (öppen fråga 8).
        </p>
      </Stack>
      <DemoNote>
        Siffrorna räknas fram ur påhittade testdata varje gång sidan visas. I den riktiga tjänsten räknar ett schemalagt jobb om resultatgraden varje vecka och skickar veckosammanfattning via
        e-post till chef och controller.
      </DemoNote>
    </Stack>
  );
}

/** Kundens omdöme om resultatgraden – samma regel och text som i kommunens beställarrapport. */
function CustVerdict({ r, target }: { r: CustomerCardData["rolling"]; target: number | null }) {
  if (!r || r.den < r.minN) {
    return (
      <Badge tone="grey" icon="info">
        För få avslut för att bedöma
      </Badge>
    );
  }
  return target != null && r.value != null && r.value >= target ? (
    <Badge tone="blue" icon="check-circle">
      Når avtalsmålet
    </Badge>
  ) : (
    <Badge tone="red" icon="alert">
      Under avtalsmålet
    </Badge>
  );
}

function CustomerCard({ c, liveValue }: { c: CustomerCardData; liveValue: number | null }) {
  const r = c.rolling;
  const n = c.smallGroupN;
  return (
    <Card title="Så ser kommunens chef resultatet" icon="building" tone="sub">
      <Stack gap="sm">
        {c.latest && r ? (
          <>
            <p>
              I beställarrapporten för <b>{monthName(c.latest.month)}</b>: resultatgrad <b>{r.value == null ? "–" : pct(r.value)}</b> ({r.num} av {r.den} avslut, rullande 6 månader) mot
              avtalsmålet <b>{pct0(c.contractTarget)}</b>.
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <CustVerdict r={r} target={c.contractTarget} />
            </div>
            <p className="text-small">
              Det är den senast levererade rapporten (levererad {fmtDateTime(c.latest.deliveredAt)}). Den visas när kommunens chef öppnar beställarrapporten.
            </p>
          </>
        ) : (
          <p>Kommunens chef har inte fått någon beställarrapport ännu. Siffrorna syns för kommunen först när avtalsansvarig har godkänt och levererat den första rapporten.</p>
        )}
        {c.next && c.nextRolling && (
          <p className="text-small">
            Rapporten för {monthName(c.next.month)} är ett utkast tills avtalsansvarig godkänner den. Med dagens underlag visar den {c.nextRolling.value == null ? "–" : pct(c.nextRolling.value)} (
            {c.nextRolling.num} av {c.nextRolling.den} avslut).
          </p>
        )}
        {c.correctionPending && (
          <p className="text-small">En rättad version av rapporten väntar på leverans. Kommunens chef ser den levererade versionen tills den nya har levererats.</p>
        )}
        {r && r.value != null && liveValue != null && pct(liveValue) !== pct(r.value) && (
          <p className="text-small text-text-muted">Ledningsvyns {pct(liveValue)} räknas fram till i dag och tar med avslut som ännu inte finns i en levererad rapport.</p>
        )}
        <p className="text-small text-text-muted">
          Kommunen ser inte det interna målet, prognosen, jämförelsen per coach eller flaggorna. Grupper med färre än {n} personer redovisas som &quot;färre än {n}&quot;.
        </p>
        <Row gap="sm">
          <DemoOnly>
            <WrapBtn>
              <PerspectiveLink
                role="kommun_chef"
                to="/portal/bestallarrapport"
                label={c.latest ? `Se ${monthName(c.latest.month)} som kommunens chef` : "Se beställarrapporten som kommunens chef"}
              />
            </WrapBtn>
          </DemoOnly>
          {c.next && c.canOpenReport && (
            <WrapBtn>
              <Button kind="ghost" iconRight="arrow-right" to={`/rapporter/${encodeURIComponent(c.next.id)}`}>
                {`Öppna utkastet för ${monthName(c.next.month)}`}
              </Button>
            </WrapBtn>
          )}
        </Row>
      </Stack>
    </Card>
  );
}

function EarlyCard({ d, onAck }: { d: LedningOverview; onAck: (a: AckTarget) => void }) {
  return (
    <Card
      title="Tidig uppmärksamhet"
      icon="bell"
      actions={
        <Badge tone={d.escalatedCount ? "red" : "outline"} icon={d.escalatedCount ? "alert" : undefined}>
          {d.escalatedCount} ärenden
        </Badge>
      }
    >
      <Stack>
        <p className="text-small">
          Ärenden med {d.escalateAfterWeeks} veckor eller fler i rad utan progression, per coach. <b>Coachen har fått påminnelser men ser inte att ärendet har eskalerats till dig.</b>
        </p>
        {d.early.length === 0 ? (
          <Empty icon="check-circle" title="Inga eskaleringar">
            Alla ärenden har progression eller bara en vecka utan.
          </Empty>
        ) : (
          d.early.map((g) => (
            <div key={g.coachId} className="flex min-w-0 flex-col gap-2.5 rounded-mb border border-ljusgra px-3.5 py-3">
              <Row between>
                <UserName name={g.coachName} />
                <span className="text-small text-text-muted">{plural(g.reminders, "påminnelse", "påminnelser")} till coachen denna vecka</span>
              </Row>
              {g.cases.map((w) => (
                <div key={w.caseId} className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-ljusgra pt-2.5 first-of-type:border-t-0 first-of-type:pt-0" data-early-case={w.caseId}>
                  <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5">
                    <Row gap="sm">
                      <CaseLink caseId={w.caseId} caseNumber={w.caseNumber} />
                      <span>{w.name}</span>
                      <Badge tone="red" icon="alert">
                        {w.streak} veckor i rad
                      </Badge>
                    </Row>
                    <Row gap="sm">
                      {w.weeks.map((x) => (
                        <Badge tone="outline" key={x.key}>
                          {x.label}: {x.reason}
                        </Badge>
                      ))}
                    </Row>
                    <div className="text-small text-text-muted">Coachen har fått {plural(w.streak, "påminnelse", "påminnelser")} (en per vecka), men ingen notis om eskaleringen.</div>
                    {w.ack && (
                      <div className="text-small">
                        <Icon name="check" /> Kvitterad av {w.ack.byName} {fmtDateTime(w.ack.at)}: {w.ack.plan}
                      </div>
                    )}
                  </div>
                  {!w.ack && (
                    <Button icon="check" onClick={() => onAck(w.alert)}>
                      Kvittera
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
        <DemoOnly>
          <div>
            <WrapBtn>
              <PerspectiveLink role="coach" to="/notiser" label="Se vad coachen Amira får (bara påminnelser)" />
            </WrapBtn>
          </div>
        </DemoOnly>
      </Stack>
    </Card>
  );
}

function SlaCard({ d }: { d: LedningOverview }) {
  const s = d.sla;
  return (
    <Card title="SLA-uppfyllnad" icon="clock">
      <Stack>
        <div className="text-small text-text-muted">
          {monthName(d.lastMonth)} · {s.targetText}
        </div>
        {s.rows.map((x) => {
          const st = KPI_STATUS[x.status] ?? KPI_STATUS.no_data;
          return (
            <div className="flex flex-col gap-1" key={x.key} data-sla-row={x.key}>
              <Row between className="gap-1.5">
                <span className="text-small font-bold">{x.label}</span>
                <span className="font-bold tabular-nums">{x.value == null ? "–" : pct(x.value)}</span>
              </Row>
              <MiniBar
                value={x.value || 0}
                tone={x.status === "ok" ? "blue" : undefined}
                markers={x.target != null ? [{ value: x.target, label: `Mål ${pct0(x.target)}` }] : []}
                label={`${x.label}: ${pct(x.value)}${x.target != null ? `, mål ${pct0(x.target)}` : ""}. ${st.label}.`}
              />
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="text-small text-text-muted">
                  {x.num} av {x.den}
                  {x.target != null ? ` · mål ${pct0(x.target)}` : ""}
                </span>
                <KpiStatusBadge status={x.status} />
              </div>
              {x.provisional && <span className="text-small text-text-muted">Sista dag är inte fastställd med Botkyrka.</span>}
            </div>
          );
        })}
        <Row between>
          <span className="font-bold">Försenat just nu</span>
          <Badge tone={s.overdueCount ? "red" : "blue"} icon={s.overdueCount ? "alert" : "check"}>
            {s.overdueCount ? plural(s.overdueCount, "uppgift", "uppgifter") : "Inget"}
          </Badge>
        </Row>
        {s.canOpenDeadlines && (
          <div>
            <WrapBtn>
              <Button kind="ghost" iconRight="arrow-right" to="/forfaller">
                Förfaller i dag och denna vecka
              </Button>
            </WrapBtn>
          </div>
        )}
        {!s.seesSlaStats && <div className="text-small text-text-muted">SLA-statistiken visas inte för kommunen (beslut i ledningen, öppen fråga 17).</div>}
      </Stack>
    </Card>
  );
}

function UnbilledCard({ d }: { d: LedningOverview }) {
  const u = d.unbilled;
  return (
    <Card
      title="Ofakturerat"
      icon="card"
      tone={u.weeks ? "red" : undefined}
      actions={
        u.weeks ? (
          <Badge tone="red" icon="alert">
            Kräver åtgärd
          </Badge>
        ) : (
          <Badge tone="blue" icon="check-circle">
            Når målet
          </Badge>
        )
      }
    >
      <Stack>
        <Big>{kr(u.totalOre)}</Big>
        <p>
          {u.weeks === 0 ? (
            `Inga debiterbara veckor äldre än ${u.warningDays} dagar är ofakturerade.`
          ) : (
            <>
              <b>{u.weeks} veckor</b> i {plural(u.cases.length, "ärende", "ärenden")} är äldre än {u.warningDays} dagar utan faktura.
            </>
          )}
        </p>
        {u.cases.length > 0 && (
          <Row gap="sm">
            {u.cases.map((c) => (
              <CaseLink key={c.caseId} caseId={c.caseId} caseNumber={c.caseNumber} />
            ))}
          </Row>
        )}
        <div className="text-small text-text-muted">
          Mål: 0 veckor. Preskription två månader efter utfört arbete. Äldsta veckan: {u.oldestDays != null ? `${u.oldestDays} dagar` : "–"}.
        </div>
        {u.canOpenBilling ? (
          <div>
            <Button kind="ghost" iconRight="arrow-right" to="/ekonomi">
              Till faktureringen
            </Button>
          </div>
        ) : (
          <div className="text-small text-text-muted">Ekonomen hanterar fakturorna. Du ser beloppen här.</div>
        )}
      </Stack>
    </Card>
  );
}

// ================================================================ Flik: Per coach
function Num({ strong, children, sub }: { strong?: boolean; children: ReactNode; sub?: ReactNode }) {
  return (
    <>
      <span className={cn(strong !== false && "font-bold")}>{children}</span>
      {sub != null && <CellSub className="whitespace-nowrap">{sub}</CellSub>}
    </>
  );
}

function CoachTab() {
  const q = useQuery(ledningCoaches, {});
  return (
    <QueryView query={q}>
      {(d) => {
        const t = d.targets;
        const markers = goalMarkers(t);
        const docOver = d.allDoc != null && d.allDoc > d.docGoalMinutes;
        const all = d.all;
        const allTone = all.status === "below_contract" ? "alert" : all.status === "below_internal" ? "watch" : undefined;
        const tot = d.total;
        const lm = monthName(d.lastMonth);
        return (
          <Stack gap="lg">
            <Tiles>
              <Kpi label="Aktiva ärenden just nu" value={String(tot.active)} sub={`status aktiv i dag · fördelade på ${d.rows.length} coacher`} />
              <Kpi
                label="Resultatgrad, alla"
                value={all.value == null ? "–" : pct(all.value)}
                sub={`${d.rows.filter((r) => r.rr.status === "below_contract").length} av ${d.rows.length} coacher under avtalsmålet`}
                tone={allTone}
                statusText={allTone ? RR_STATUS[all.status]?.label : undefined}
              />
              <Kpi
                label="Dokumentationstid"
                value={fmtMin(d.allDoc)}
                tone={docOver ? "watch" : undefined}
                statusText={docOver ? "Bevaka – över internt mål" : undefined}
                sub={`median utan AI, ${lm} · internt mål högst ${d.docGoalMinutes} min`}
              />
              <Kpi label="Påminnelser denna vecka" value={String(tot.reminders)} sub={`${tot.escalated} ärenden eskalerade till dig`} />
            </Tiles>
            <Card title="Per coach" icon="users" flush actions={<span className="text-small text-text-muted">Aktiva just nu · resultatgrad rullande 6 mån · övrigt {lm}</span>}>
              <div className="[&_td]:px-2 [&_td:first-child]:pl-3 [&_th]:px-2 [&_th]:whitespace-normal [&_th:first-child]:pl-3">
                <Table
                  caption="Nyckeltal per coach"
                  rows={d.rows}
                  columns={[
                    { key: "name", label: "Coach", nowrap: true, render: (r) => <UserName name={r.name} /> },
                    { key: "active", label: "Aktiva nu", num: true },
                    {
                      key: "rr",
                      label: "Resultatgrad",
                      render: (r) => (
                        <div className="flex min-w-[136px] flex-col gap-[5px]">
                          <Row between className="gap-1.5">
                            <span className="font-bold tabular-nums">{r.rr.value == null ? "–" : pct(r.rr.value)}</span>
                            <span className="text-small text-text-muted tabular-nums">
                              {r.rr.num} av {r.rr.den}
                            </span>
                          </Row>
                          <MiniBar value={r.rr.value || 0} max={0.6} markers={markers} tone={r.rr.status === "ok" ? "blue" : undefined} label={`Resultatgrad ${pct(r.rr.value)}`} />
                          <div>
                            <RrBadge status={r.rr.status} short />
                          </div>
                        </div>
                      ),
                    },
                    { key: "att", label: "Närvaro", num: true, render: (r) => <Num sub={`${r.att} av ${r.reg}`}>{r.attRate == null ? "–" : pct(r.attRate)}</Num> },
                    { key: "ci", label: "Avstämningar", num: true, render: (r) => <Num sub={`${r.wkOk} av ${r.wk} veckor`}>{r.ciRate == null ? "–" : pct(r.ciRate)}</Num> },
                    { key: "doc", label: "Dokumentation", num: true, render: (r) => <Num sub="median utan AI"><span className="whitespace-nowrap">{fmtMin(r.docMedian)}</span></Num> },
                    { key: "rem", label: "Påminnelser", num: true, render: (r) => <Num sub={`${r.escalated} eskalerade`}>{r.reminders}</Num> },
                  ]}
                  footer={
                    <tr>
                      <td>Alla coacher</td>
                      <td className="text-right tabular-nums">{tot.active}</td>
                      <td>
                        {all.value == null ? "–" : pct(all.value)}
                        <CellSub className="whitespace-nowrap">
                          {all.num} av {all.den}
                        </CellSub>
                      </td>
                      <td className="text-right tabular-nums">{tot.reg ? pct(tot.att / tot.reg) : "–"}</td>
                      <td className="text-right tabular-nums">{tot.wk ? pct(tot.wkOk / tot.wk) : "–"}</td>
                      <td className="text-right tabular-nums">{fmtMin(d.allDoc)}</td>
                      <td className="text-right tabular-nums">
                        {tot.reminders}
                        <CellSub className="whitespace-nowrap">{tot.escalated} eskalerade</CellSub>
                      </td>
                    </tr>
                  }
                />
              </div>
            </Card>
            <Grid cols={3}>
              <Notice tone="info" title="Så räknas det">
                Resultatgrad: avslut med verifierat resultat delat med avslut som räknas. Under {t.minN} avslut markeras underlaget som för litet och ingen flagga sätts. Närvarograd: närvarande
                eller sen delat med registrerade tillfällen. Godkända avstämningar: andel veckor med en godkänd veckoavstämning (startveckor och pausade veckor räknas inte).
              </Notice>
              <Notice tone="info" title="Dokumentationstid – baslinje">
                Median minuter från avstämningens slut till godkänd dokumentation, för avstämningar gjorda <b>utan AI</b>. Baslinjen mäts i fas 1. Internt mål: högst {d.docGoalMinutes} minuter.
                Tidsvinsten med AI-stöd jämförs mot baslinjen i fas 2.
              </Notice>
              <Notice tone="warn" title="Påminnelser och eskaleringar">
                Coachen får en påminnelse när ett ärende saknar progression en vecka. Efter {d.escalateAfterWeeks} veckor i rad eskaleras det till dig. Coachen ser bara sina påminnelser – aldrig
                eskaleringen eller den här jämförelsen.
              </Notice>
            </Grid>
          </Stack>
        );
      }}
    </QueryView>
  );
}

// ================================================================ Flik: Per avtalsområde
function AreaTab() {
  const q = useQuery(ledningAreas, {});
  return (
    <QueryView query={q}>
      {(d) => {
        const maxActive = Math.max(1, ...d.rows.map((r) => r.active));
        const smallCount = d.rows.filter((r) => r.rr.den < d.minN).length;
        const lm = monthName(d.lastMonth);
        return (
          <Stack gap="lg">
            <Tiles>
              <Kpi label="Aktiva just nu" value={String(d.total.active)} sub={`Deltagare med status aktiv i dag, i ${d.rows.filter((r) => r.active > 0).length} av ${d.rows.length} avtalsområden`} />
              <Kpi label={`Aktiva under ${lm}`} value={String(d.monthActive)} sub="Aktiva någon gång under månaden – samma räknesätt som i beställarrapporten till kommunen" />
              <Kpi label="Avslutade sedan start" value={String(d.total.closed)} sub={`${d.all.num} med verifierat resultat`} />
              <Kpi label="Områden med litet underlag" value={String(smallCount)} sub={`färre än ${d.minN} avslut som räknas`} />
            </Tiles>
            <Card title="Per avtalsområde" icon="grid" flush actions={<span className="text-small text-text-muted">Resultatgrad sedan avtalsstart</span>}>
              <Table
                caption="Deltagare och resultat per avtalsområde"
                rowKey="code"
                rows={d.rows}
                columns={[
                  {
                    key: "name",
                    label: "Avtalsområde",
                    render: (r) => (
                      <>
                        <span className="font-bold">{r.code}</span> {r.name}
                      </>
                    ),
                  },
                  {
                    key: "active",
                    label: "Aktiva nu",
                    render: (r) => (
                      <div className="flex min-w-[110px] flex-nowrap items-center gap-1.5">
                        <span className="min-w-[2ch] text-right font-bold tabular-nums">{r.active}</span>
                        <div className="flex-1">
                          <MiniBar value={r.active} max={maxActive} tone="blue" label={`${r.active} aktiva just nu`} />
                        </div>
                      </div>
                    ),
                  },
                  { key: "closed", label: "Avslutade", num: true },
                  {
                    key: "rr",
                    label: "Resultatgrad",
                    num: true,
                    nowrap: true,
                    render: (r) =>
                      r.rr.value == null ? (
                        <span className="text-text-muted">–</span>
                      ) : (
                        <>
                          <span className={r.rr.den < d.minN ? "text-text-muted" : "font-bold"}>{pct(r.rr.value)}</span>
                          <CellSub>
                            {r.rr.num} av {r.rr.den}
                          </CellSub>
                        </>
                      ),
                  },
                  {
                    key: "n",
                    label: "Underlag",
                    render: (r) =>
                      r.rr.den >= d.minN ? (
                        <Badge tone="outline" icon="check">
                          Tillräckligt
                        </Badge>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <span>
                            <Badge tone="grey" icon="alert-circle">
                              Litet underlag
                            </Badge>
                          </span>
                          {r.rr.den > 0 && r.rr.den < d.smallGroupN && <CellSub>Kommunen ser &quot;färre än {d.smallGroupN}&quot;</CellSub>}
                        </div>
                      ),
                  },
                ]}
                footer={
                  <tr>
                    <td>Alla områden</td>
                    <td>{d.total.active}</td>
                    <td className="text-right tabular-nums">{d.total.closed}</td>
                    <td className="text-right tabular-nums">{d.all.value == null ? "–" : pct(d.all.value)}</td>
                    <td />
                  </tr>
                }
              />
            </Card>
            <Grid cols={2}>
              <Notice tone="info" title="Små grupper">
                Resultatgrad i områden med färre än {d.minN} avslut svänger kraftigt och ska inte jämföras rakt av. I beställarrapporten till kommunen redovisas grupper med färre än {d.smallGroupN}{" "}
                personer som &quot;färre än {d.smallGroupN}&quot;.
              </Notice>
              <Notice tone="info" title="Två sätt att räkna aktiva">
                &quot;Aktiva just nu&quot; är deltagare med status aktiv i dag. Beställarrapporten räknar i stället alla som var aktiva någon gång under månaden, även de som avslutades eller
                startade under månaden.
                {d.monthActive !== d.total.active ? ` Därför skiljer sig talen åt: ${d.total.active} just nu och ${d.monthActive} under ${lm}.` : ""}
              </Notice>
            </Grid>
          </Stack>
        );
      }}
    </QueryView>
  );
}

// ================================================================ Flik: Deltagarnas röst (puls)
const PULSE_Q = [
  { key: "q1", text: "Hur trivs du hos oss?" },
  { key: "q2", text: "Känner du att du kommer närmare jobb eller studier?" },
  { key: "q3", text: "Får du det stöd du behöver av din coach?" },
] as const;
const SCALE = ["1 – Mycket dåligt", "2 – Dåligt", "3 – Varken eller", "4 – Bra", "5 – Mycket bra"];
const PRIORITY: Record<string, string> = { jobb: "Hitta jobb", praktik: "Praktik", utbildning: "Utbildning", svenska: "Bli säkrare på svenska", annat: "Annat" };

/** Fördelningsrader: etikett, stapel och antal (prototypens ldg-dist). */
function DistGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,10.5em)_minmax(0,1fr)_6.5em] items-center gap-x-3 gap-y-2 text-ui max-[520px]:grid-cols-[minmax(0,1fr)_6em] max-[520px]:[&>[role=img]]:order-3 max-[520px]:[&>[role=img]]:col-span-full">
      {children}
    </div>
  );
}
function Dist({ counts }: { counts: number[] }) {
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <DistGrid>
      {counts
        .slice()
        .reverse()
        .map((n, ri) => {
          const i = 4 - ri;
          return (
            <DistRow key={i} label={SCALE[i]} value={total ? n / total : 0} tone={i >= 3 ? "blue" : undefined} aria={`${SCALE[i]}: ${n} svar`}>
              {n} · {total ? pct0(n / total) : "–"}
            </DistRow>
          );
        })}
    </DistGrid>
  );
}
function DistRow({ label, value, tone, aria, children }: { label: string; value: number; tone?: "blue"; aria: string; children: ReactNode }) {
  return (
    <>
      <span className="text-small">{label}</span>
      <MiniBar value={value} tone={tone} label={aria} />
      <span className="text-right text-small whitespace-nowrap tabular-nums">{children}</span>
    </>
  );
}

function PulseTab({ onAck }: { onAck: (a: AlertView) => void }) {
  const q = useQuery(ledningPulse, {});
  return (
    <QueryView query={q}>
      {(d) => {
        const st = d.stats;
        const rateOk = !!st && st.responseRate != null && st.responseRate >= d.responseGoal;
        const prioTotal = st ? st.priorities.reduce((a, [, n]) => a + n, 0) : 0;
        return (
          <Stack gap="lg">
            <Row between>
              <Row gap="sm">
                <BuildPhase fas={2} />
                <span className="text-small text-text-muted">Rullande 3 månader · vecka 2 och vid avslut, plus var {d.periodicEveryDays}:e dag för längre insatser</span>
              </Row>
              <DemoOnly>
                <WrapBtn>
                  <PerspectiveLink role="deltagare" to="/puls" label="Se pulsmätningen som deltagaren" />
                </WrapBtn>
              </DemoOnly>
            </Row>
            {!d.enough || !st ? (
              <Notice tone="info" title={`Färre än ${d.minN} svar`}>
                Aggregat visas först när det finns minst {d.minN} svar. Det skyddar deltagarna från att kunna identifieras.
              </Notice>
            ) : (
              <>
                <Tiles>
                  <Kpi
                    label="Svarsfrekvens"
                    value={pct(st.responseRate)}
                    tone={rateOk ? undefined : "watch"}
                    statusText={rateOk ? undefined : "Under målet"}
                    sub={`${st.responses} svar på ${st.invites} utskick · internt mål ${pct0(d.responseGoal)}`}
                  >
                    {rateOk && (
                      <div>
                        <Badge tone="blue" icon="check-circle">
                          Når målet
                        </Badge>
                      </div>
                    )}
                  </Kpi>
                  <Kpi label="Nöjdhet" value={pct(st.satisfaction)} sub="Andel som svarat 4 eller 5 på fråga 1 (trivsel)" />
                  <Kpi label="Närmare jobb eller studier" value={pct(st.closer)} sub="Andel 4 eller 5 på fråga 2" />
                  <Kpi label="Stöd från coachen" value={pct(st.support)} sub="Andel 4 eller 5 på fråga 3" />
                </Tiles>
                <Split>
                  <Card title="Fördelning per fråga" icon="chart">
                    <Stack gap="lg">
                      {PULSE_Q.map((x, i) => (
                        <Stack gap="sm" key={x.key}>
                          <div className="font-bold">
                            {i + 1}. {x.text}
                          </div>
                          <Dist counts={st[x.key]} />
                        </Stack>
                      ))}
                    </Stack>
                  </Card>
                  <Stack>
                    <Card title="Vad är viktigast just nu?" icon="compass">
                      <DistGrid>
                        {st.priorities.map(([key, n]) => (
                          <DistRow key={key} label={PRIORITY[key] ?? key} value={prioTotal ? n / prioTotal : 0} aria={`${PRIORITY[key] ?? key}: ${n}`}>
                            {n} · {prioTotal ? pct0(n / prioTotal) : "–"}
                          </DistRow>
                        ))}
                      </DistGrid>
                      <div className="mt-2.5 text-small text-text-muted">Fråga 4. Används för att planera praktik, utbildning och språkstöd.</div>
                    </Card>
                    <Card
                      title="Lågt betyg på stödet från coachen"
                      icon="frown"
                      tone={d.lowOpen > 0 ? "red" : undefined}
                      actions={
                        d.lowOpen > 0 ? (
                          <Badge tone="red" icon="alert">
                            {d.lowOpen} att kvittera
                          </Badge>
                        ) : (
                          <Badge tone="outline" icon="check">
                            Inget att kvittera
                          </Badge>
                        )
                      }
                    >
                      <Stack>
                        <p className="text-small">
                          Svar med 1 eller 2 på fråga 3 går till dig som chef – <b>inte till coachen</b>. Du ser datum och betyg, inte vem som svarat.
                        </p>
                        {d.lowAlerts.length === 0 ? (
                          <span className="text-small text-text-muted">Inga låga betyg de senaste veckorna.</span>
                        ) : (
                          <div>
                            {d.lowAlerts.map((a) => (
                              <AlertRow key={a.key} a={a} onAck={onAck} />
                            ))}
                          </div>
                        )}
                      </Stack>
                    </Card>
                    <Card title="Önskar kontakt" icon="phone">
                      <p>
                        <b>{plural(d.contactRequested, "deltagare", "deltagare")}</b> har svarat Ja på fråga 5 (vill bli kontaktad). Det blir en uppgift till samordnaren, som avgör vem som tar
                        kontakten.
                      </p>
                    </Card>
                  </Stack>
                </Split>
                <Card title="Per coach" icon="users" flush>
                  <Table
                    caption="Pulsmätning per coach"
                    rows={d.perCoach}
                    columns={[
                      { key: "name", label: "Coach", render: (r) => <UserName name={r.name} /> },
                      { key: "n", label: "Svar", num: true, render: (r) => r.responses },
                      { key: "sat", label: "Nöjdhet", num: true, render: (r) => (r.enough ? pct(r.satisfaction) : <span className="text-text-muted">Färre än {d.minN} svar</span>) },
                      { key: "sup", label: "Stöd från coachen", num: true, render: (r) => (r.enough ? pct(r.support) : <span className="text-text-muted">–</span>) },
                      { key: "rate", label: "Svarsfrekvens", num: true, render: (r) => (r.enough && r.responseRate != null ? pct(r.responseRate) : <span className="text-text-muted">–</span>) },
                    ]}
                  />
                </Card>
              </>
            )}
            <Notice tone="info" title="Vem ser vad">
              <ul className="m-0 flex list-disc flex-col gap-1 pl-[1.2em]">
                <li>Coachen ser inte enskilda svar – bara samma aggregat som här, och först vid minst {d.minN} svar.</li>
                <li>Lågt betyg på stödet från coachen (fråga 3) går till chef, inte till coachen.</li>
                <li>Svarar deltagaren Ja på fråga 5 får samordnaren en uppgift.</li>
                <li>Kommunen ser antal svar och andel nöjda i beställarrapporten.</li>
              </ul>
            </Notice>
            <DemoNote>
              Svaren är påhittade. I den riktiga tjänsten skickas pulslänken som SMS eller e-post (signerad engångslänk som gäller i 7 dagar), aldrig till deltagare med skyddade
              personuppgifter. Deltagandet är frivilligt.
            </DemoNote>
          </Stack>
        );
      }}
    </QueryView>
  );
}
