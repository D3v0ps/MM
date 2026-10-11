"use client";
// Min vecka för systemadministratören (beslut 2026-10-06) i coachens stil (src/ui/vecka.tsx): bakgrundsjobben, utskick som
// inte gick iväg, användarna och – bara för testare i testmiljön – synpunkterna. Sidorna under fliken Administratör finns
// kvar. Frågor som rollen redan har: admin.integrations (begränsade testare får inte underbiträdena – här läses bara jobben
// och avrop@), admin.users, admin.templates (bara läge, tid, kanal, mall och ärendenummer – aldrig mottagare eller text) och
// notiser.list. Avtal och konfiguration länkas härifrån, men inte för begränsade testare (sidan är stängd för dem).
import { useEffect, useState } from "react";
import { isTesterHiddenPath } from "@/api/tester-access";
import { plural } from "@/core/format";
import { addDays, dayOf, fmtDateTime, fmtTime, type LocalDate } from "@/core/time";
import { UnreadNotices } from "@/features/notiser/screens/olasta";
import type { FeedbackView } from "@/features/synpunkter/api";
import { useWeekToday } from "@/features/vecka/today";
import { useQuery } from "@/shell/backend";
import { useSession } from "@/shell/session";
import {
  BuildPhase, Button, Card, DemoNote, DoneLine, ErrorNotice, focusSection, Icon, Kpi, Kv, List, ListItem, Loading, Split, Stack, TitleLink, WEEK_KPI_SM, WeekKpis, WeekPage,
} from "@/ui";
import { adminIntegrations, adminTemplates, adminUsers, type IntegrationsView, type JobRow, type TemplatesView, type UsersView } from "../api";
import { CHANNEL_LABEL } from "../templates";
import { JOB_STATUS } from "./parts";

/** Avtal och konfiguration – inte i menyn (beslut 2026-10-06), länkas från Användare och roller och härifrån. */
const CONTRACT_PATH = "/admin/avtal";
/**
 * Utskick som inte gick iväg räknas för de senaste sju dagarna (i dag och sex dagar bakåt) – Min vecka visar det som behöver
 * kontrolleras nu. Äldre fel finns kvar i utskicksloggen. Utskick kan inte kvitteras, så utan gräns skulle rutan vara röd
 * för alltid efter ett enda fel.
 */
const SEND_DAYS = 7;
/** Jobb som inte är klara först (fel, väntar, inte aktiverade), sedan de klara – i övrigt samma ordning som på integrationssidan. */
const JOB_ORDER: Record<JobRow["status"], number> = { failed: 0, waiting: 1, disabled: 2, ok: 3 };

export function AdminMinVeckaScreen() {
  const today = useWeekToday();
  const i = useQuery(adminIntegrations, {});
  const u = useQuery(adminUsers, {});
  const t = useQuery(adminTemplates, {});
  const err = i.error ?? u.error ?? t.error;
  return (
    <WeekPage
      today={today}
      actions={
        <Button kind="primary" icon="database" to="/admin/integrationer">
          Underbiträden och integrationer
        </Button>
      }
    >
      {err ? (
        <ErrorNotice
          error={err}
          onRetry={() => {
            void i.refetch();
            void u.refetch();
            void t.refetch();
          }}
        />
      ) : !i.data || !u.data || !t.data || !today ? (
        <Loading />
      ) : (
        <Week i={i.data} u={u.data} t={t.data} today={today} />
      )}
      <DemoNote>Integrationerna och jobben är simulerade. Jobben körs på Underbiträden och integrationer.</DemoNote>
    </WeekPage>
  );
}

function Week({ i, u, t, today }: { i: IntegrationsView; u: UsersView; t: TemplatesView; today: LocalDate }) {
  const { hidesCommercial } = useSession();
  const jobs = i.jobs.map((j, idx) => ({ j, idx })).sort((a, b) => JOB_ORDER[a.j.status] - JOB_ORDER[b.j.status] || a.idx - b.idx).map((x) => x.j);
  const okJobs = i.jobs.filter((j) => j.status === "ok").length;
  const waiting = i.jobs.filter((j) => j.status === "waiting").length;
  const disabled = i.jobs.filter((j) => j.status === "disabled").length;
  const failedJobs = i.jobs.filter((j) => j.status === "failed").length;
  const since = addDays(today, -(SEND_DAYS - 1));
  const failedSends = t.sendLog.filter((n) => n.status === "failed" && dayOf(n.at) >= since);
  const users = u.kpis.mbActive + u.kpis.customerActive;
  const contractLink = u.isAdmin && !(hidesCommercial && isTesterHiddenPath(CONTRACT_PATH));

  return (
    <>
      <WeekKpis>
        <Kpi
          className={WEEK_KPI_SM}
          onClick={() => focusSection("mv-jobb")}
          actionHint="Visa"
          label="Bakgrundsjobb"
          value={`${okJobs} av ${i.jobs.length}`}
          tone={failedJobs ? "watch" : undefined}
          statusText={plural(failedJobs, "jobb med fel", "jobb med fel")}
          sub={`klara · ${waiting} väntar · ${plural(disabled, "inte aktiverat", "inte aktiverade")}`}
        />
        <Kpi
          className={WEEK_KPI_SM}
          onClick={() => focusSection("mv-utskick")}
          actionHint="Visa"
          label="Utskick som inte gick iväg"
          value={String(failedSends.length)}
          tone={failedSends.length ? "alert" : undefined}
          statusText="Kontrollera utskicksloggen"
          sub={failedSends.length ? `De senaste ${SEND_DAYS} dagarna` : `Alla utskick de senaste ${SEND_DAYS} dagarna har gått iväg`}
        />
        <Kpi
          className={WEEK_KPI_SM}
          to="/admin/anvandare"
          actionHint="Visa"
          label="Användare"
          value={String(users)}
          sub={`aktiva konton · ${u.kpis.invited} inbjudna har inte loggat in`}
        />
        <Kpi
          className={WEEK_KPI_SM}
          to="/admin/integrationer"
          actionHint="Visa"
          label="Avrop@ senast läst"
          value={i.inboxState === "not_connected" ? "Inte kopplad" : i.inboxReadAt ? fmtTime(i.inboxReadAt) : "–"}
          sub={i.inboxState === "not_connected" ? "Så här kopplar du: Underbiträden och integrationer" : i.latestMail ? `Senaste mejl ${fmtDateTime(i.latestMail)}` : "Inga mejl"}
        />
      </WeekKpis>

      <Split wide>
        <Stack>
          <Card
            id="mv-jobb"
            title="Bakgrundsjobb"
            icon="refresh"
            flush
            foot={
              <Button kind="ghost" iconRight="arrow-right" to="/admin/integrationer">
                Alla jobb och Kör nu
              </Button>
            }
          >
            <List>
              {jobs.map((j) => (
                <ListItem key={j.key} title={j.name} sub={`${j.schedule}${j.last ? ` · senast ${fmtDateTime(j.last)}` : ""}`} side={JOB_STATUS[j.status]}>
                  <span>{j.result}</span>
                  {j.phase && (
                    <span>
                      <BuildPhase fas={j.phase} />
                    </span>
                  )}
                </ListItem>
              ))}
            </List>
          </Card>

          {failedSends.length === 0 ? (
            <DoneLine id="mv-utskick" title="Utskick som inte gick iväg" icon="mail">
              Alla utskick de senaste {SEND_DAYS} dagarna har gått iväg.
            </DoneLine>
          ) : (
            <Card
              id="mv-utskick"
              title="Utskick som inte gick iväg"
              icon="mail"
              tone="red"
              flush
              foot={
                <>
                  <span className="text-text-muted">De senaste {SEND_DAYS} dagarna. Kontrollera mottagaren och kanalen i utskicksloggen.</span>
                  <Button kind="ghost" iconRight="arrow-right" to="/admin/mallar?flik=logg">
                    Utskicksloggen
                  </Button>
                </>
              }
            >
              <List>
                {failedSends.map((n) => (
                  <ListItem
                    key={n.id}
                    icon="alert"
                    title={n.templateLabel}
                    sub={[fmtDateTime(n.at), CHANNEL_LABEL[n.channel] ?? n.channel, n.caseNumber].filter(Boolean).join(" · ")}
                  />
                ))}
              </List>
            </Card>
          )}

          <FeedbackCard />
        </Stack>

        <Stack>
          <Card
            title="Användare och roller"
            icon="users"
            foot={
              <>
                <Button kind="secondary" iconRight="arrow-right" to="/admin/anvandare">
                  Användare och roller
                </Button>
                {contractLink && (
                  <Button kind="ghost" icon="settings" to={CONTRACT_PATH}>
                    Avtal och konfiguration
                  </Button>
                )}
              </>
            }
          >
            <Kv
              items={[
                ["Miljonbemanning", `${u.kpis.mbActive} aktiva konton`],
                [u.customerName, `${u.kpis.customerActive} aktiva konton i ${u.kpis.unitCount} enheter`],
                ["Väntande inbjudningar", `${u.kpis.invited} har inte loggat in ännu`],
              ]}
            />
          </Card>

          <Card title="Mallar och loggar" icon="mail" flush>
            <List>
              <ListItem title={<TitleLink to="/admin/mallar">Mallar och utskick</TitleLink>}>
                <span>Texterna i e-post och SMS. Inga personuppgifter.</span>
              </ListItem>
              <ListItem title={<TitleLink to="/admin/mallar?flik=logg">Utskicksloggen</TitleLink>} sub={`${t.sendLog.length} utskick`} />
              <ListItem title={<TitleLink to="/admin/logg">Revisionslogg</TitleLink>}>
                <span>Visningar, ändringar, exporter och AI-körningar.</span>
              </ListItem>
            </List>
          </Card>

          <UnreadNotices />
        </Stack>
      </Split>
    </>
  );
}

/** Synpunkter från testarna – bara för testare i testmiljön (session.feedback saknas annars). Bara antal, ingen text. */
function FeedbackCard() {
  const { feedback } = useSession();
  const [list, setList] = useState<FeedbackView[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!feedback) return;
    let live = true;
    feedback.list().then(
      (l) => live && setList(l),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [feedback]);
  if (!feedback) return null;
  const n = (s: FeedbackView["status"]) => (list ?? []).filter((x) => x.status === s).length;
  return (
    <Card title="Synpunkter från testarna" icon="message">
      {failed ? (
        <p className="text-text-muted">Synpunkterna kunde inte hämtas.</p>
      ) : !list ? (
        <Loading />
      ) : (
        <Stack gap="sm">
          <p>
            <b>{plural(n("ny"), "ny", "nya")}</b> · {n("diskutera")} att diskutera · {n("andras")} ska ändras
          </p>
          <p className="inline-flex items-start gap-1.5 text-text-muted">
            <Icon name="info" className="mt-1 flex-none" />
            <span>Öppna Alla synpunkter i raden Testmiljö överst för att läsa och svara.</span>
          </p>
        </Stack>
      )}
    </Card>
  );
}
