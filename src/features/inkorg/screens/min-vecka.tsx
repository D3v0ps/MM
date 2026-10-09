"use client";
// Min vecka för samordnare och avtalsansvarig (beslut 2026-10-06) – dagens startsida /start flyttad in i Min veckas stil
// (src/ui/vecka.tsx): det mest brådskande först – inkorgen, första möten, förfallotider och flaggor – samt uppgifter och
// avtalsavvikelser. Port av prototypens vy sam.start (SPEC §7.0). /start leder hit.
import { useState } from "react";
import { caseBookFirstMeeting } from "@/features/arenden/api";
import { alertAck } from "@/features/ledning/api";
import { UnreadNotices } from "@/features/notiser/screens/olasta";
import { addWorkingDays, dayOf, fmtTime, fmtWeekday } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { useSession } from "@/shell/session";
import {
  Badge, BuildPhase, Button, Card, CaseLink, DateInput, DemoNote, DoneLine, ErrorNotice, Field, focusSection, FormGrid, Icon, Kpi, Loading, Meter, Modal, Notice,
  PerspectiveLink, SlaBadge, Split, Stack, TextArea, TimeInput, TitleLink, toast, WEEK_KPI_SM, WeekKpis, WeekPage,
} from "@/ui";
import { inboxRowPath, inboxStart, inboxTaskDone, type AlertView, type StartView } from "../api";
import { CLASSIFICATION, METHOD } from "../texts";
import { Caps, IconLine, MiniList, MiniRow, ProvBadge, Quote, useIsDemo, usePersona, WrapBtns } from "./parts";

const SEV: Record<AlertView["severity"], [string, "red" | "grey" | "outline", "alert" | "alert-circle" | "info"]> = {
  critical: ["Kritisk", "red", "alert"],
  warning: ["Bevaka", "grey", "alert-circle"],
  info: ["Info", "outline", "info"],
};

export function SamMinVeckaScreen() {
  const q = useQuery(inboxStart, {});
  return (
    <WeekPage
      today={q.data?.today ?? null}
      actions={
        <Button kind="primary" icon="inbox" to="/inkorg">
          Öppna avropsinkorgen
        </Button>
      }
    >
      {q.error ? <ErrorNotice error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Loading /> : <Week v={q.data} />}
      <DemoNote>Siffrorna räknas fram ur demodata och demoklockan. Flaggor och förfallotider följer reglerna i avtalskonfigurationen och de interna reglerna för notiser.</DemoNote>
    </WeekPage>
  );
}

function Week({ v }: { v: StartView }) {
  const { actor } = useSession();
  const coach = usePersona("coach");
  const demo = useIsDemo();
  const [ackFor, setAckFor] = useState<AlertView | null>(null);
  const [book, setBook] = useState<StartView["firstMeetings"]["rows"][number] | null>(null);
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [showAcked, setShowAcked] = useState(false);
  const taskDone = useCommand(inboxTaskDone);
  const handles = actor.role === "avtalsansvarig";
  const urgent = v.urgent;
  const urgentTone = urgent?.sla && (urgent.sla.sla.tone === "urgent" || urgent.sla.sla.tone === "over") ? "alert" : undefined;
  const crit = v.alerts.filter((a) => a.severity === "critical").length;
  const shownAlerts = showAllAlerts ? v.alerts : v.alerts.slice(0, 5);
  const fm = v.firstMeetings;
  const dl = v.deadlines;
  // e2e läser rutornas status (data-inkorg-tile, data-tone och data-tile-state på statusraden).
  const tile = (tone: "alert" | "watch" | undefined) => ({ "data-inkorg-tile": "", "data-tone": tone });

  return (
    <>
      <WeekKpis>
        <Kpi
          className={WEEK_KPI_SM}
          dataAttrs={tile(urgentTone)}
          to={urgent ? inboxRowPath(urgent) : "/inkorg"}
          actionHint="Visa"
          label="Att hantera i inkorgen"
          value={String(v.items.length)}
          tone={urgentTone}
          statusText={urgent?.sla?.sla.tone === "over" ? "Svarstiden har passerat" : "Svarstiden går snart ut"}
          // Undertexten som vanlig text (som coachens ruta): rutan är redan röd när svarstiden brådskar – inget rött märke i den.
          sub={urgent?.sla ? `Närmast: ${urgent.sla.sla.label.toLowerCase()}` : "Inget väntar på svar"}
        />
        <Kpi
          className={WEEK_KPI_SM}
          dataAttrs={tile(fm.flagged > 0 ? "watch" : undefined)}
          onClick={() => focusSection("mv-forsta-moten")}
          actionHint="Visa"
          label="Första möten ej bokade"
          value={String(fm.rows.length)}
          tone={fm.flagged > 0 ? "watch" : undefined}
          statusText="Flaggat"
          sub={fm.flagged > 0 ? `${fm.flagged} ${fm.flagged === 1 ? "flaggat" : "flaggade"} efter ${v.flagDaysText}` : `Ska bokas inom ${v.meetingText}`}
        />
        {/* Bevaka i stället för röd: bara ett rött ämne per sida (inkorgens svarstid). */}
        <Kpi
          className={WEEK_KPI_SM}
          dataAttrs={tile(dl.overdue > 0 ? "watch" : undefined)}
          to="/forfaller"
          actionHint="Visa"
          label="Förfaller i dag"
          value={String(dl.soonCount)}
          tone={dl.overdue > 0 ? "watch" : undefined}
          statusText="Försenat – eskaleras"
          sub={`${dl.overdue} ${dl.overdue === 1 ? "försenad" : "försenade"} · ${dl.weekCount} till denna vecka`}
        />
        <Kpi
          className={WEEK_KPI_SM}
          dataAttrs={tile(crit > 0 ? "watch" : undefined)}
          onClick={() => focusSection("mv-flaggor")}
          actionHint="Visa"
          label="Flaggor att kvittera"
          value={String(v.alerts.length)}
          tone={crit > 0 ? "watch" : undefined}
          statusText="Kritiska flaggor"
          sub={`${crit} ${crit === 1 ? "kritisk" : "kritiska"} · kvitteras med kort åtgärdsplan`}
        />
      </WeekKpis>

      <Split wide>
        <Stack>
          {v.items.length === 0 ? (
            <DoneLine id="mv-inkorg" title="Avropsinkorg" icon="inbox">
              Inkorgen är tom. Alla avrop är besvarade.
            </DoneLine>
          ) : (
            <Card
              id="mv-inkorg"
              title="Avropsinkorg"
              icon="inbox"
              flush
              foot={
                <IconLine icon="bell">
                  När du accepterar får huvudcoachen och teamet <b>automatiskt en notis</b> – {v.notifyEmail ? "i appen och som e-post utan personuppgifter" : "i appen"}.
                </IconLine>
              }
            >
              <MiniList>
                {v.items.map((x) => (
                  <MiniRow
                    key={x.id}
                    left={x.sla ? <SlaBadge sla={x.sla.sla} dueAt={x.sla.dueAt} /> : <Badge tone="outline" icon="message">Övrigt</Badge>}
                    main={
                      <TitleLink to={inboxRowPath(x)}>
                        {x.caseNumber && !x.subject.includes(x.caseNumber) ? (
                          <>
                            <span className="tabular-nums tracking-[0.01em]">{x.caseNumber}</span>&nbsp;·&nbsp;
                          </>
                        ) : (
                          ""
                        )}
                        {x.subject}
                      </TitleLink>
                    }
                    sub={`${x.from} · ${CLASSIFICATION[x.cls]} · ${(METHOD[x.method] ?? METHOD.manual).label}${x.missing.length ? ` · saknar ${x.missing.join(" och ")}` : ""}`}
                  />
                ))}
              </MiniList>
            </Card>
          )}

          {v.alerts.length === 0 && v.acked.length === 0 ? (
            <DoneLine id="mv-flaggor" title={`Flaggor (${v.alerts.length})`} icon="flag">
              Inga öppna flaggor. Allt är kvitterat.
            </DoneLine>
          ) : (
            <Card
              id="mv-flaggor"
              title={`Flaggor (${v.alerts.length})`}
              icon="flag"
              flush
              actions={
                v.acked.length > 0 ? (
                  <Button kind="ghost" onClick={() => setShowAcked(!showAcked)}>
                    {showAcked ? "Dölj kvitterade" : `Visa kvitterade (${v.acked.length})`}
                  </Button>
                ) : null
              }
              foot={
                v.alerts.length > 5 ? (
                  <Button kind="ghost" onClick={() => setShowAllAlerts(!showAllAlerts)}>
                    {showAllAlerts ? "Visa färre" : `Visa alla ${v.alerts.length}`}
                  </Button>
                ) : undefined
              }
            >
              {v.alerts.length === 0 ? (
                <p className="px-[18px] py-3 text-text-muted">Inga öppna flaggor. Allt är kvitterat.</p>
              ) : (
                <div className="flex flex-col">
                  {shownAlerts.map((a) => {
                    const [sl, tone, icon] = SEV[a.severity] ?? SEV.info;
                    return (
                      <div key={a.key} className="flex min-w-0 items-start gap-3 border-b border-ljusgra px-[18px] py-3 last:border-b-0">
                        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={tone} icon={icon}>
                              {sl}
                            </Badge>
                            {a.phase && <BuildPhase fas={a.phase} />}
                            <span className="text-small text-text-muted">{a.when}</span>
                          </div>
                          <TitleLink to={a.href}>{a.title}</TitleLink>
                          <span>{a.text}</span>
                          <div>
                            <Button kind="secondary" icon="check" onClick={() => setAckFor(a)}>
                              Kvittera
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {showAcked && (
                <div className="flex flex-col border-t-2 border-ljusgra">
                  {v.acked.map((a) => (
                    <div key={`ack-${a.key}`} className="flex min-w-0 items-start gap-3 border-b border-ljusgra px-[18px] py-3 last:border-b-0">
                      <Icon name="check-circle" className="mt-0.5" />
                      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                        <span className="font-bold">{a.title}</span>
                        <span className="text-text-muted">{a.text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {fm.rows.length === 0 ? (
            <DoneLine id="mv-forsta-moten" title="Första möten som inte är bokade" icon="calendar">
              Alla första möten är bokade.
            </DoneLine>
          ) : (
            <Card id="mv-forsta-moten" title="Första möten som inte är bokade" icon="calendar" flush>
              <MiniList>
                {fm.rows.map((c) => (
                  <MiniRow
                    key={c.caseId}
                    left={c.due ? <SlaBadge sla={c.due.sla} dueAt={c.due.dueAt} /> : null}
                    main={<CaseLink caseId={c.caseId} caseNumber={c.caseNumber} className="-ml-1.5" />}
                    sub={c.sub}
                    right={
                      <Button kind="secondary" icon="calendar" onClick={() => setBook(c)}>
                        Boka
                      </Button>
                    }
                  />
                ))}
              </MiniList>
            </Card>
          )}

          {v.toStart.length > 0 && (
            <Card
              id="mv-starta"
              title="Insatser att starta"
              icon="play"
              flush
              foot={<span className="text-text-muted">Första mötet har hållits. Starta insatsen så att tillfällen, närvaro och rapporter kommer igång – coachen kan också göra det.</span>}
            >
              <MiniList>
                {v.toStart.map((c) => (
                  <MiniRow
                    key={c.caseId}
                    main={<CaseLink caseId={c.caseId} caseNumber={c.caseNumber} className="-ml-1.5" />}
                    sub={c.sub}
                    right={
                      <Button kind="primary" icon="play" to={`/arenden/${encodeURIComponent(c.caseId)}?starta=1`}>
                        Starta insatsen
                      </Button>
                    }
                  />
                ))}
              </MiniList>
            </Card>
          )}

          {v.noCoach.length === 0 ? (
            <DoneLine title="Ärenden utan coach" icon="user">
              Alla ärenden har en coach. Coach tilldelas när avropet accepteras.
            </DoneLine>
          ) : (
            <Card title="Ärenden utan coach" icon="user" flush foot={<span className="text-text-muted">Coach tilldelas när avropet accepteras.</span>}>
              <MiniList>
                {v.noCoach.map((c) => (
                  <MiniRow
                    key={c.caseId}
                    left={c.sla ? <SlaBadge sla={c.sla.sla} dueAt={c.sla.dueAt} /> : null}
                    main={<span className="tabular-nums tracking-[0.01em]">{c.caseNumber}</span>}
                    sub={c.sub}
                    right={
                      <Button kind="secondary" to={`/inkorg?arende=${encodeURIComponent(c.caseId)}`}>
                        Tilldela
                      </Button>
                    }
                  />
                ))}
              </MiniList>
            </Card>
          )}

          {v.tasks.length === 0 ? (
            <DoneLine title={`Öppna uppgifter (${v.tasks.length})`} icon="check-square">
              Inga öppna uppgifter. Uppgifter till din roll visas här.
            </DoneLine>
          ) : (
            <Card title={`Öppna uppgifter (${v.tasks.length})`} icon="check-square" flush>
              <div className="flex flex-col">
                {v.tasks.map((t) => (
                  <div key={t.id} className="flex min-w-0 items-start gap-3 border-b border-ljusgra px-[18px] py-3 last:border-b-0">
                    <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                      <TitleLink to={t.emailId ? `/inkorg/${encodeURIComponent(t.emailId)}` : t.caseId ? `/inkorg?arende=${encodeURIComponent(t.caseId)}` : null}>{t.text}</TitleLink>
                      <span className="text-small text-text-muted">{t.sub}</span>
                      <div>
                        <Button
                          kind="secondary"
                          icon="check"
                          pending={taskDone.pending}
                          onClick={async () => {
                            const r = await taskDone.run({ taskId: t.id });
                            if (r.ok) toast("Uppgiften är markerad som klar.");
                          }}
                        >
                          Markera som klar
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </Stack>

        <Stack>
          {dl.soon.length === 0 && dl.week.length === 0 ? (
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
              <MiniList>
                {dl.soon.map((x) => (
                  <MiniRow key={x.id} left={<SlaBadge sla={x.sla} dueAt={x.dueAt} />} main={<TitleLink to={x.href}>{x.label}</TitleLink>} sub={x.sub} />
                ))}
                {dl.week.map((x) => (
                  <MiniRow
                    key={x.id}
                    left={<SlaBadge sla={x.sla} dueAt={x.dueAt} />}
                    main={`${x.label}${x.count ? ` · ${x.count} ärenden` : ""}`}
                    sub={x.sub}
                    right={x.provisional ? <ProvBadge /> : null}
                  />
                ))}
                {dl.weekGrouped > 3 && (
                  <div className="border-b border-ljusgra px-[18px] py-3 text-small text-text-muted last:border-b-0">
                    + {dl.weekGrouped - 3} till denna vecka (totalt {dl.weekCount} som förfaller)
                  </div>
                )}
              </MiniList>
            </Card>
          )}

          <Card
            title={handles ? "Avtalet: avvikelser och frågor" : "Avtalsavvikelser"}
            icon="flag"
            actions={<BuildPhase fas={2} />}
            flush
            foot={
              v.deviationsHref ? (
                <Button kind="ghost" iconRight="arrow-right" to={v.deviationsHref}>
                  Alla avtalsavvikelser
                </Button>
              ) : undefined
            }
          >
            <MiniList>
              {v.deviations.length === 0 && <div className="px-[18px] py-3 text-text-muted">Inga öppna avtalsavvikelser.</div>}
              {v.deviations.map((x) => (
                <MiniRow
                  key={x.id}
                  left={x.due ? <SlaBadge sla={x.due.sla} dueAt={x.due.dueAt} prefix="Åtgärdsplan" /> : null}
                  main={<TitleLink to={x.href}>{x.description}</TitleLink>}
                  sub={x.sub}
                />
              ))}
              {handles && v.summaryReport && (
                <MiniRow
                  left={v.summaryReport.due ? <SlaBadge sla={v.summaryReport.due.sla} dueAt={v.summaryReport.due.dueAt} /> : null}
                  main={v.summaryReport.title}
                  sub="Lämnas till kommunen utanför Miljonmatch. Byggs bara av godkända uppgifter."
                  right={
                    v.summaryReport.href ? (
                      <Button kind="secondary" to={v.summaryReport.href}>
                        Granska
                      </Button>
                    ) : null
                  }
                />
              )}
              {handles && (
                <MiniRow
                  left={
                    <Badge tone={v.warnings.issued > 0 ? "red" : "outline"} icon="alert-circle">
                      {v.warnings.issued} av {v.warnings.max}
                    </Badge>
                  }
                  main="Skriftliga varningar"
                  sub={v.warnings.text}
                />
              )}
            </MiniList>
          </Card>

          {v.kpis.map((k) => (
            <Kpi key={k.key} label={k.label} value={k.value} tone={k.below ? "watch" : undefined} statusText="Under internt mål" sub={k.sub}>
              {k.meter && (
                <Meter
                  value={k.meter.value}
                  max={1}
                  tone="blue"
                  label={k.meter.valueText}
                  markers={k.meter.target != null ? [{ value: k.meter.target, label: k.meter.targetText, tone: "dark" }] : []}
                />
              )}
              {k.late.length > 0 && (
                <div className="flex flex-col">
                  <span className="text-small text-text-muted">Inte i tid:</span>
                  <span className="flex flex-wrap items-center gap-x-1 text-small">
                    {k.late.map((c) => (
                      <CaseLink key={c.caseId} caseId={c.caseId} caseNumber={c.caseNumber} />
                    ))}
                  </span>
                </div>
              )}
            </Kpi>
          ))}

          <Card
            title="Tilldelning ger notis"
            icon="bell"
            foot={
              demo ? (
                <WrapBtns>
                  <PerspectiveLink role="coach" userId={coach?.userId} to="/notiser" label={`Se coachens notiser (${coach?.name.split(" ")[0] ?? ""})`} />
                </WrapBtns>
              ) : undefined
            }
          >
            <div className="flex flex-col gap-2">
              <p>Huvudcoach och team får en notis direkt när ett avrop accepteras eller coachen byts. E-posten innehåller bara ärendenumret.</p>
              <Quote>{v.assign.quote}</Quote>
              {v.assign.latest.length > 0 && (
                <>
                  <Caps className="mt-1.5">Senast skickade</Caps>
                  {v.assign.latest.map((n) => (
                    <IconLine key={n.id} icon="user" className="text-small">
                      <b>{n.name}</b> · {n.caseNumber} · {n.when}
                    </IconLine>
                  ))}
                </>
              )}
            </div>
          </Card>

          <UnreadNotices />
        </Stack>
      </Split>

      {ackFor && <AckModal a={ackFor} onClose={() => setAckFor(null)} />}
      {book && <BookModal c={book} today={v.today} meetingText={v.meetingText} onClose={() => setBook(null)} />}
    </>
  );
}

function AckModal({ a, onClose }: { a: AlertView; onClose: () => void }) {
  const ack = useCommand(alertAck);
  const [plan, setPlan] = useState("");
  const [tried, setTried] = useState(false);
  const err = plan.trim().length < 10 ? "Skriv en kort åtgärdsplan – vad görs, av vem och när." : null;
  const submit = async () => {
    setTried(true);
    if (err) return;
    const r = await ack.run({ key: a.key, plan: plan.trim() });
    if (!r.ok) {
      toast("Flaggan kunde inte kvitteras.", "error");
      return;
    }
    toast("Flaggan är kvitterad. Åtgärdsplanen är sparad i revisionsloggen.");
    onClose();
  };
  return (
    <Modal
      title="Kvittera flagga"
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button kind="primary" icon="check" pending={ack.pending} onClick={() => void submit()}>
            Kvittera
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <span className="font-bold">{a.title}</span>
        <span>{a.text}</span>
      </div>
      <Field
        id="ink-ack-plan"
        label="Kort åtgärdsplan"
        required
        help="Vad görs, av vem och när? Till exempel: Sara ringer handläggaren i dag före kl. 12 och bokar mötet."
        error={tried ? err : null}
      >
        <TextArea value={plan} onValueChange={setPlan} rows={3} maxLength={500} />
      </Field>
      <div className="text-text-muted">Kvitteringen sparas med namn och tid. Flaggan kommer tillbaka om läget ändras.</div>
    </Modal>
  );
}

function BookModal({ c, today, meetingText, onClose }: { c: StartView["firstMeetings"]["rows"][number]; today: string; meetingText: string; onClose: () => void }) {
  const bookCmd = useCommand(caseBookFirstMeeting);
  const [date, setDate] = useState(addWorkingDays(today, 1));
  const [time, setTime] = useState("10:00");
  const [tried, setTried] = useState(false);
  const due = c.due?.dueAt ?? null;
  const err = !date ? "Välj datum." : date < today ? "Datumet har redan passerat." : null;
  const submit = async () => {
    setTried(true);
    if (err || !time) return;
    const r = await bookCmd.run({ caseId: c.caseId, at: `${date}T${time}` });
    if (!r.ok) {
      toast(r.message ?? "Mötet kunde inte bokas.", "error");
      return;
    }
    toast(`Första mötet för ${c.caseNumber} är bokat ${fmtWeekday(date)} kl. ${fmtTime(`${date}T${time}`)}. Kallelse skickad.`);
    onClose();
  };
  return (
    <Modal
      title={`Boka första möte – ${c.caseNumber}`}
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button kind="primary" icon="calendar" pending={bookCmd.pending} onClick={() => void submit()}>
            Boka mötet
          </Button>
        </>
      }
    >
      <p>
        Huvudcoach: <b>{c.coachName}</b>. Mötet ska vara bokat senast {c.dueText} (inom {meetingText} från avropet).
      </p>
      <FormGrid>
        <Field id="ink-b-date" label="Datum" required help="En vardag." error={tried ? err : null}>
          <DateInput value={date} onValueChange={setDate} />
        </Field>
        <Field id="ink-b-time" label="Tid" required help="Mötet hålls i Alby.">
          <TimeInput value={time} onValueChange={setTime} />
        </Field>
      </FormGrid>
      {due && date > dayOf(due) && (
        <Notice tone="warn" title={`Senare än ${meetingText} efter avropet`}>
          Mötet markeras i uppföljningen av nyckeltalet för första möte.
        </Notice>
      )}
      <div className="text-text-muted">Deltagaren får kallelse via sin föredragna kontaktväg och en SMS-påminnelse dagen före. Inga personuppgifter i utskicket.</div>
    </Modal>
  );
}
