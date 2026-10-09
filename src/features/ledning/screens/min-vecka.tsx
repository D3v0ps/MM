"use client";
// Min vecka för chef och controller (beslut 2026-10-06) i coachens stil (src/ui/vecka.tsx): flaggor att kvittera, tidig
// uppmärksamhet, det som förfaller, rapporter att granska och nyckeltalen i korthet. Ledningsvyn (/ledning) finns kvar
// oförändrad under fliken Ledning. Frågor som chefen redan har: ledning.overview, inkorg.deadlines, rapporter.lista och
// notiser.list – inga ekonomi-frågor. Begränsade testare: ledning.overview lämnar inte ut ofakturerat eller interna mål.
import { useState } from "react";
import { TESTER_HIDDEN_TEXT } from "@/api/tester-access";
import { pct, plural } from "@/core/format";
import { fmtDate } from "@/core/time";
import { inboxDeadlines, type DeadlinesView } from "@/features/inkorg/api";
import { dlDesc, groupDeadlines, kindLabel } from "@/features/inkorg/texts";
import { UnreadNotices } from "@/features/notiser/screens/olasta";
import { reportList, type ReportList } from "@/features/rapporter/api";
import { useWeekToday } from "@/features/vecka/today";
import { useQuery } from "@/shell/backend";
import {
  Badge, Button, Card, DoneLine, ErrorNotice, focusSection, Kpi, Kv, List, ListItem, Loading, SlaBadge, Split, Stack, TitleLink, WEEK_KPI_SM, WeekKpis, WeekPage,
} from "@/ui";
import { ledningOverview, type LedningOverview } from "../api";
import { AckModal, AlertRow, EarlyCard, RR_STATUS, RrBadge, type AckTarget } from "./parts";

export function ChefMinVeckaScreen() {
  const today = useWeekToday();
  const o = useQuery(ledningOverview, {});
  const d = useQuery(inboxDeadlines, {});
  const r = useQuery(reportList, {});
  const err = o.error ?? d.error ?? r.error;
  return (
    <WeekPage
      today={today}
      actions={
        <Button kind="primary" icon="chart" to="/ledning">
          Öppna Ledningsvyn
        </Button>
      }
    >
      {err ? (
        <ErrorNotice
          error={err}
          onRetry={() => {
            void o.refetch();
            void d.refetch();
            void r.refetch();
          }}
        />
      ) : !o.data || !d.data || !r.data ? (
        <Loading />
      ) : (
        <Week o={o.data} dl={d.data} reports={r.data} />
      )}
    </WeekPage>
  );
}

function Week({ o, dl, reports }: { o: LedningOverview; dl: DeadlinesView; reports: ReportList }) {
  const [ackAlert, setAckAlert] = useState<AckTarget | null>(null);
  const critical = o.criticalCount;
  const esc = plural(o.escalatedCount, "ärende", "ärenden");
  const rolling = o.rolling;
  // Bara ett rött ämne per sida: flaggorna. Resultatgraden blir röd bara när inga kritiska flaggor finns.
  const rrTone = rolling.status === "below_contract" ? (critical > 0 ? "watch" : "alert") : rolling.status === "below_internal" ? "watch" : undefined;
  const overdue = dl.rows.filter((x) => x.bucket === "overdue").length;
  const todayCount = dl.rows.filter((x) => x.bucket === "overdue" || x.bucket === "today").length;
  const weekCount = dl.rows.filter((x) => x.bucket === "week").length;
  const grouped = groupDeadlines(dl.rows, dl.reportsHref);
  const soon = [...grouped.filter((x) => x.bucket !== "week"), ...grouped.filter((x) => x.bucket === "week")].slice(0, 5);
  const rows = reports.rows;
  const lateReports = rows.filter((x) => x.overdue).length;
  const approval = rows.filter((x) => x.next.key === "approval").length;
  const reportsWeek = rows.filter((x) => x.week).length;
  const toReview = rows
    .filter((x) => !x.delivered && (x.overdue || x.next.key === "approval"))
    .sort((a, b) => ((a.dueAt || "9999") < (b.dueAt || "9999") ? -1 : 1))
    .slice(0, 5);
  const u = o.unbilled;

  return (
    <>
      <WeekKpis>
        <Kpi
          className={WEEK_KPI_SM}
          onClick={() => focusSection("mv-flaggor")}
          actionHint="Visa"
          label="Flaggor att hantera"
          value={String(o.alertCount)}
          tone={critical > 0 ? "alert" : undefined}
          statusText={critical > 0 ? plural(critical, "kritisk flagga", "kritiska flaggor") : undefined}
          sub={critical > 0 ? `${esc} med tidig uppmärksamhet` : `Inga kritiska · ${esc} med tidig uppmärksamhet`}
        />
        <Kpi
          className={WEEK_KPI_SM}
          to="/forfaller"
          actionHint="Visa"
          label="Förfaller i dag"
          value={String(todayCount)}
          tone={overdue > 0 ? "watch" : undefined}
          statusText="Försenat – eskaleras"
          sub={`${overdue} ${overdue === 1 ? "försenad" : "försenade"} · ${weekCount} till denna vecka`}
        />
        <Kpi
          className={WEEK_KPI_SM}
          to="/ledning"
          actionHint="Visa"
          label="Resultatgrad, rullande 6 mån"
          value={rolling.value == null ? "–" : pct(rolling.value)}
          tone={rrTone}
          statusText={rrTone ? RR_STATUS[rolling.status]?.label : undefined}
          sub={`${rolling.num} av ${rolling.den} avslut`}
        />
        <Kpi
          className={WEEK_KPI_SM}
          to="/rapporter?filter=forsenade"
          actionHint="Visa"
          label="Rapporter försenade"
          value={String(lateReports)}
          tone={lateReports > 0 ? "watch" : undefined}
          statusText="Försenat"
          sub={`${approval} väntar på godkännande · ${reportsWeek} förfaller denna vecka`}
        />
      </WeekKpis>

      <Split wide>
        <Stack>
          {o.flagAlerts.length === 0 ? (
            <DoneLine id="mv-flaggor" title="Flaggor för chef och controller" icon="flag">
              Inga flaggor att kvittera. Nya flaggor visas här när de uppstår.
            </DoneLine>
          ) : (
            <Card id="mv-flaggor" title="Flaggor för chef och controller" icon="flag" actions={<Badge tone="dark">{o.flagAlerts.length} att kvittera</Badge>}>
              <Stack>
                <div>
                  {o.flagAlerts.map((a) => (
                    <AlertRow key={a.key} a={a} onAck={setAckAlert} />
                  ))}
                </div>
                <p className="text-text-muted">Eskaleringar om utebliven progression visas under Tidig uppmärksamhet.</p>
              </Stack>
            </Card>
          )}

          <EarlyCard d={o} onAck={setAckAlert} />

          {soon.length === 0 ? (
            <DoneLine title="Förfaller snart" icon="clock">
              Inget förfaller i dag eller denna vecka.
            </DoneLine>
          ) : (
            <Card
              title="Förfaller snart"
              icon="clock"
              flush
              actions={
                <Button kind="ghost" iconRight="arrow-right" to="/forfaller">
                  Visa alla
                </Button>
              }
            >
              <List>
                {soon.map((x) => {
                  const desc = dlDesc(x.kind, x.label);
                  return (
                    <ListItem
                      key={x.id}
                      title={
                        <TitleLink to={x.href}>
                          {kindLabel(x.kind)}
                          {x.aggregate ? ` · ${x.aggregate.count} ärenden` : ""}
                        </TitleLink>
                      }
                      sub={[desc, x.aggregate ? null : x.caseNumber, x.ownerName].filter(Boolean).join(" · ")}
                      side={<SlaBadge sla={x.sla} dueAt={x.dueAt} />}
                    />
                  );
                })}
              </List>
            </Card>
          )}

          {toReview.length === 0 ? (
            <DoneLine title="Rapporter att granska" icon="file">
              Inga rapporter är försenade eller väntar på godkännande.
            </DoneLine>
          ) : (
            <Card
              title="Rapporter att granska"
              icon="file"
              flush
              actions={
                <Button kind="ghost" iconRight="arrow-right" to="/rapporter">
                  Visa alla
                </Button>
              }
            >
              <List>
                {toReview.map((x) => (
                  <ListItem
                    key={x.id}
                    title={<TitleLink to={`/rapporter/${encodeURIComponent(x.id)}`}>{x.title}</TitleLink>}
                    sub={`${x.sub} · ${x.statusLabel}`}
                    side={x.sla && x.dueAt ? <SlaBadge sla={x.sla} dueAt={x.dueAt} /> : undefined}
                  />
                ))}
              </List>
            </Card>
          )}
        </Stack>

        <Stack>
          <Card
            title="Nyckeltal i korthet"
            icon="chart"
            foot={
              <Button kind="ghost" iconRight="arrow-right" to="/ledning">
                Ledningsvyn
              </Button>
            }
          >
            <Stack gap="sm">
              <Kv
                items={[
                  ["Resultatgrad", `${rolling.value == null ? "–" : pct(rolling.value)} (${rolling.num} av ${rolling.den} avslut, rullande 6 månader)`],
                  ["Sedan avtalsstart", `${o.sinceStart.value == null ? "–" : pct(o.sinceStart.value)} sedan ${fmtDate(o.contractStart)}`],
                  ["Prognos", pct(o.forecast.value)],
                  ["Försenat", o.sla.overdueCount ? plural(o.sla.overdueCount, "uppgift", "uppgifter") : "Inget"],
                  [
                    "Ofakturerat",
                    !u
                      ? TESTER_HIDDEN_TEXT
                      : u.weeks
                        ? `${plural(u.weeks, "vecka", "veckor")} i ${plural(u.cases.length, "ärende", "ärenden")} äldre än ${u.warningDays} dagar`
                        : `Inga veckor äldre än ${u.warningDays} dagar`,
                  ],
                ]}
              />
              <div>
                <RrBadge status={rolling.status} noInternal={o.targets.internal == null} />
              </div>
            </Stack>
          </Card>

          <Card
            title="Avtalsavvikelser och varningar"
            icon="flag"
            flush
            foot={
              <Button kind="ghost" iconRight="arrow-right" to="/avtalsavvikelser">
                Öppna registret
              </Button>
            }
          >
            <List>
              <ListItem title={`${o.cds.open} öppna · ${o.cds.warnings} av ${o.cds.warningsBeforeTermination} varningar`}>
                <span>{o.cds.warningsBeforeTermination} skriftliga varningar kan leda till uppsägning av avtalet.</span>
              </ListItem>
              {o.cds.openPlans.map((x) => (
                <ListItem key={x.id} title={<TitleLink to={`/avtalsavvikelser/${encodeURIComponent(x.id)}`}>{x.description}</TitleLink>}>
                  {x.sla && x.dueAt ? (
                    <span>
                      <SlaBadge sla={x.sla} dueAt={x.dueAt} prefix="Åtgärdsplan" />
                    </span>
                  ) : (
                    <span className="text-small text-text-muted">{x.actionPlanDue ? `Åtgärdsplan klar senast ${fmtDate(x.actionPlanDue)}` : "Datum saknas"}</span>
                  )}
                </ListItem>
              ))}
            </List>
          </Card>

          <UnreadNotices />
        </Stack>
      </Split>
      {ackAlert && <AckModal alert={ackAlert} onClose={() => setAckAlert(null)} />}
    </>
  );
}
