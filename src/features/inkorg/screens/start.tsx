"use client";
// Samordnarens och avtalsansvarigs startsida (/start) – port av prototypens vy sam.start (SPEC §7.0):
// det mest brådskande först – inkorgen, första möten, förfallotider och flaggor – samt uppgifter och avtalsavvikelser.
import { useState, type ReactNode } from "react";
import { caseBookFirstMeeting } from "@/features/arenden/api";
import { alertAck } from "@/features/ledning/api";
import { addWorkingDays, dayOf, fmtTime, fmtWeekday } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import { useSession } from "@/shell/session";
import {
  Badge, BuildPhase, Button, Card, CaseLink, cn, DateInput, DemoNote, Empty, ErrorNotice, Field, FormGrid, Grid, Icon, Kpi, Loading, Meter, Modal, Notice, Page,
  PerspectiveLink, SlaBadge, Split, TextArea, TimeInput, toast,
} from "@/ui";
import { inboxRowPath, inboxStart, inboxTaskDone, type AlertView, type StartView } from "../api";
import { CLASSIFICATION, METHOD } from "../texts";
import { Caps, IconLine, MiniList, MiniRow, ProvBadge, Quote, usePersona, useIsDemo, WrapBtns } from "./parts";

const ROLE_EYEBROW: Record<string, string> = { samordnare: "Samordnare", avtalsansvarig: "Avtalsansvarig" };
const SEV: Record<AlertView["severity"], [string, "red" | "grey" | "outline", "alert" | "alert-circle" | "info"]> = {
  critical: ["Kritisk", "red", "alert"],
  warning: ["Bevaka", "grey", "alert-circle"],
  info: ["Info", "outline", "info"],
};
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start" });

export function StartScreen() {
  const q = useQuery(inboxStart, {});
  const { actor, user } = useSession();
  return (
    <Page title="Startsida" eyebrow={`${ROLE_EYEBROW[actor.role] ?? actor.role} · ${user.name}`} lead={q.data?.lead}>
      {q.error ? <ErrorNotice error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Loading /> : <Start v={q.data} />}
      <DemoNote>Siffrorna räknas fram ur demodata och demoklockan. Flaggor och förfallotider följer reglerna i avtalskonfigurationen och de interna reglerna för notiser.</DemoNote>
    </Page>
  );
}

/** Klickbar nyckeltalsruta. Status visas alltid med text och ikon (inte bara ramfärg). */
function Tile({ label, value, sub, tone, statusText, onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "alert" | "watch"; statusText: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-inkorg-tile=""
      data-tone={tone}
      className={cn(
        "flex w-full min-w-0 cursor-pointer flex-col gap-1.5 rounded-card border border-ljusgra bg-vit px-[18px] py-4 text-left text-antracit [font:inherit] hover:border-antracit",
        tone === "alert" && "border-2 border-rod hover:border-rod",
        tone === "watch" && "border-2 border-antracit",
      )}
    >
      <span className="text-label font-extrabold tracking-[0.08em] text-text-muted uppercase">{label}</span>
      <span className="text-[2rem] leading-[1.1] font-extrabold tabular-nums">{value}</span>
      {tone && (
        <span data-tile-state="" className="inline-flex items-center gap-1.5 text-small font-extrabold [&_svg]:size-4">
          <Icon name={tone === "alert" ? "alert" : "eye"} className={tone === "alert" ? "text-rod" : undefined} />
          {statusText}
        </span>
      )}
      {sub && <span className="flex flex-wrap items-center gap-1.5 text-small text-text-muted">{sub}</span>}
    </button>
  );
}

function Start({ v }: { v: StartView }) {
  const nav = useNav();
  const { actor } = useSession();
  const role = actor.role;
  const coach = usePersona("coach");
  const demo = useIsDemo();
  const [ackFor, setAckFor] = useState<AlertView | null>(null);
  const [book, setBook] = useState<StartView["firstMeetings"]["rows"][number] | null>(null);
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [showAcked, setShowAcked] = useState(false);
  const taskDone = useCommand(inboxTaskDone);
  const handles = role === "avtalsansvarig";
  const urgent = v.urgent;
  const crit = v.alerts.filter((a) => a.severity === "critical").length;
  const shownAlerts = showAllAlerts ? v.alerts : v.alerts.slice(0, 5);
  const fm = v.firstMeetings;
  const dl = v.deadlines;

  return (
    <>
      <Grid cols={4}>
        <Tile
          label="Att hantera i inkorgen" value={v.items.length}
          tone={urgent?.sla && (urgent.sla.sla.tone === "urgent" || urgent.sla.sla.tone === "over") ? "alert" : undefined}
          statusText={urgent?.sla?.sla.tone === "over" ? "Svarstiden har passerat" : "Svarstiden går snart ut"}
          onClick={() => nav.push(urgent ? inboxRowPath(urgent) : "/inkorg")}
          sub={urgent?.sla ? <><span>Närmast:</span><SlaBadge sla={urgent.sla.sla} dueAt={urgent.sla.dueAt} /></> : "Inget väntar på svar"}
        />
        <Tile
          label="Första möten ej bokade" value={fm.rows.length} tone={fm.flagged > 0 ? "watch" : undefined} statusText="Flaggat" onClick={() => scrollTo("ink-fm")}
          sub={fm.flagged > 0 ? `${fm.flagged} ${fm.flagged === 1 ? "flaggat" : "flaggade"} efter ${v.flagDaysText}` : `Ska bokas inom ${v.meetingText}`}
        />
        <Tile
          label="Förfaller i dag" value={dl.soonCount} tone={dl.overdue > 0 ? "alert" : undefined} statusText="Försenat – eskaleras" onClick={() => nav.push("/forfaller")}
          sub={`${dl.overdue} ${dl.overdue === 1 ? "försenad" : "försenade"} · ${dl.weekCount} till denna vecka`}
        />
        <Tile
          label="Flaggor att kvittera" value={v.alerts.length} tone={crit > 0 ? "watch" : undefined} statusText="Kritiska flaggor" onClick={() => scrollTo("ink-flags")}
          sub={`${crit} ${crit === 1 ? "kritisk" : "kritiska"} · kvitteras med kort åtgärdsplan`}
        />
      </Grid>

      {handles && v.protectedItems.length > 0 && (
        <Card tone="red" title="Skyddade avrop" icon="lock">
          <div className="flex flex-col gap-2">
            {v.protectedItems.map((x) => (
              <div key={x.id} className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="font-bold">{x.subject}</span>
                  <span className="text-small text-text-muted">{x.from} · {x.receivedWhen} · {x.caseText}</span>
                </div>
                <span className="flex flex-wrap items-center gap-1.5">
                  {x.sla && <SlaBadge sla={x.sla.sla} dueAt={x.sla.dueAt} />}
                  <Button kind="primary" iconRight="arrow-right" to={inboxRowPath(x)}>Öppna</Button>
                </span>
              </div>
            ))}
            <div className="text-small text-text-muted">Flaggas direkt till dig som avtalsansvarig. Bara du och den namngivna coachen ser namn och personnummer.</div>
          </div>
        </Card>
      )}

      <Split wide>
        <Card
          title="Avropsinkorg" icon="inbox" flush
          actions={<Button kind="ghost" iconRight="arrow-right" to="/inkorg">Öppna inkorgen</Button>}
          foot={
            <IconLine icon="bell" className="text-small">
              När du accepterar får huvudcoachen och teamet <b>automatiskt en notis</b> – {v.notifyEmail ? "i appen och som e-post utan personuppgifter" : "i appen"}.
            </IconLine>
          }
        >
          {v.items.length === 0 ? (
            <Empty icon="check-circle" title="Inkorgen är tom">Alla avrop är besvarade.</Empty>
          ) : (
            <MiniList>
              {v.items.map((x) => (
                <MiniRow
                  key={x.id}
                  left={x.sla ? <SlaBadge sla={x.sla.sla} dueAt={x.sla.dueAt} /> : <Badge tone="outline" icon="message">Övrigt</Badge>}
                  main={<>{x.caseNumber && !x.subject.includes(x.caseNumber) ? <><span className="tabular-nums tracking-[0.01em]">{x.caseNumber}</span> · </> : ""}{x.subject}</>}
                  sub={`${x.from} · ${CLASSIFICATION[x.cls]} · ${(METHOD[x.method] ?? METHOD.manual).label}${x.missing.length ? ` · saknar ${x.missing.join(" och ")}` : ""}${x.isProtected && !handles ? " · hanteras av avtalsansvarig" : ""}`}
                  right={<Button kind="secondary" to={inboxRowPath(x)}>Öppna</Button>}
                />
              ))}
            </MiniList>
          )}
        </Card>
        <div className="flex flex-col gap-4">
          {v.kpis.map((k) => (
            <Kpi key={k.key} label={k.label} value={k.value} tone={k.below ? "watch" : undefined} statusText="Under internt mål" sub={k.sub}>
              {k.meter && (
                <Meter value={k.meter.value} max={1} tone="blue" label={k.meter.valueText} markers={k.meter.target != null ? [{ value: k.meter.target, label: k.meter.targetText, tone: "dark" }] : []} />
              )}
              {k.late.length > 0 && (
                <div className="flex flex-col">
                  <span className="text-small text-text-muted">Inte i tid:</span>
                  <span className="flex flex-wrap items-center gap-x-1 text-small">
                    {k.late.map((c) => <CaseLink key={c.caseId} caseId={c.caseId} caseNumber={c.caseNumber} />)}
                  </span>
                </div>
              )}
            </Kpi>
          ))}
          <Card
            title="Tilldelning ger notis" icon="bell"
            foot={demo ? <WrapBtns><PerspectiveLink role="coach" userId={coach?.userId} to="/notiser" label={`Se coachens notiser (${coach?.name.split(" ")[0] ?? ""})`} /></WrapBtns> : undefined}
          >
            <div className="flex flex-col gap-2">
              <p>Huvudcoach och team får en notis direkt när ett avrop accepteras eller coachen byts. E-posten innehåller bara ärendenumret.</p>
              <Quote>{v.assign.quote}</Quote>
              {v.assign.latest.length > 0 && (
                <>
                  <Caps className="mt-1.5">Senast skickade</Caps>
                  {v.assign.latest.map((n) => (
                    <IconLine key={n.id} icon="user" className="text-small"><b>{n.name}</b> · {n.caseNumber} · {n.when}</IconLine>
                  ))}
                </>
              )}
            </div>
          </Card>
        </div>
      </Split>

      <Split wide>
        <div id="ink-flags" className="scroll-mt-4">
          <Card
            title={`Flaggor (${v.alerts.length})`} icon="flag" flush
            actions={v.acked.length > 0 ? <Button kind="ghost" onClick={() => setShowAcked(!showAcked)}>{showAcked ? "Dölj kvitterade" : `Visa kvitterade (${v.acked.length})`}</Button> : null}
            foot={v.alerts.length > 5 ? <Button kind="ghost" onClick={() => setShowAllAlerts(!showAllAlerts)}>{showAllAlerts ? "Visa färre" : `Visa alla ${v.alerts.length}`}</Button> : undefined}
          >
            {v.alerts.length === 0 ? (
              <Empty icon="check-circle" title="Inga öppna flaggor">Allt är kvitterat.</Empty>
            ) : (
              <div className="flex flex-col">
                {shownAlerts.map((a) => {
                  const [sl, tone, icon] = SEV[a.severity] ?? SEV.info;
                  return (
                    <div key={a.key} className="flex min-w-0 items-start gap-3 border-b border-ljusgra px-[18px] py-3 last:border-b-0">
                      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={tone} icon={icon}>{sl}</Badge>
                          {a.phase && <BuildPhase fas={a.phase} />}
                          <span className="text-small text-text-muted">{a.when}</span>
                        </div>
                        <span className="font-bold">{a.title}</span>
                        <span className="text-small text-text-muted">{a.text}</span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button kind="secondary" icon="check" onClick={() => setAckFor(a)}>Kvittera</Button>
                          {a.href && <Button kind="ghost" iconRight="arrow-right" to={a.href}>Öppna</Button>}
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
                      <span className="text-small text-text-muted">{a.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
        <Card title="Förfaller snart" icon="clock" flush actions={<Button kind="ghost" iconRight="arrow-right" to="/forfaller">Visa alla</Button>}>
          <MiniList>
            {dl.soon.map((x) => (
              <MiniRow
                key={x.id} left={<SlaBadge sla={x.sla} dueAt={x.dueAt} />} main={x.label} sub={x.sub}
                right={x.href ? <Button kind="ghost" icon="arrow-right" title={`Öppna: ${x.label}`} ariaLabel={`Öppna: ${x.label}`} to={x.href} /> : null}
              />
            ))}
            {dl.week.map((x) => (
              <MiniRow key={x.id} left={<SlaBadge sla={x.sla} dueAt={x.dueAt} />} main={`${x.label}${x.count ? ` · ${x.count} ärenden` : ""}`} sub={x.sub} right={x.provisional ? <ProvBadge /> : null} />
            ))}
            {dl.weekGrouped > 3 && (
              <div className="border-b border-ljusgra px-[18px] py-3 text-small text-text-muted last:border-b-0">
                + {dl.weekGrouped - 3} till denna vecka (totalt {dl.weekCount} som förfaller)
              </div>
            )}
          </MiniList>
        </Card>
      </Split>

      <Grid cols={2}>
        <div id="ink-fm" className="scroll-mt-4">
          <Card title="Första möten som inte är bokade" icon="calendar" flush>
            {fm.rows.length === 0 ? (
              <Empty icon="check-circle" title="Alla första möten är bokade" />
            ) : (
              <MiniList>
                {fm.rows.map((c) => (
                  <MiniRow
                    key={c.caseId}
                    left={c.due ? <SlaBadge sla={c.due.sla} dueAt={c.due.dueAt} /> : null}
                    main={<CaseLink caseId={c.caseId} caseNumber={c.caseNumber} />}
                    sub={c.sub}
                    right={c.isProtected ? <span className="text-small text-text-muted">Coachen ringer</span> : <Button kind="secondary" icon="calendar" onClick={() => setBook(c)}>Boka</Button>}
                  />
                ))}
              </MiniList>
            )}
          </Card>
        </div>
        <Card title="Ärenden utan coach" icon="user" flush>
          {v.noCoach.length === 0 ? (
            <Empty icon="check-circle" title="Alla ärenden har en coach" />
          ) : (
            <MiniList>
              {v.noCoach.map((c) => (
                <MiniRow
                  key={c.caseId}
                  left={c.sla ? <SlaBadge sla={c.sla.sla} dueAt={c.sla.dueAt} /> : null}
                  main={<span className="tabular-nums tracking-[0.01em]">{c.caseNumber}</span>}
                  sub={c.sub}
                  right={<Button kind="secondary" to={`/inkorg?arende=${encodeURIComponent(c.caseId)}`}>Tilldela</Button>}
                />
              ))}
            </MiniList>
          )}
          <div className="px-[18px] py-2.5 text-small text-text-muted">Coach tilldelas när avropet accepteras.</div>
        </Card>
      </Grid>

      <Grid cols={2}>
        <Card title={`Öppna uppgifter (${v.tasks.length})`} icon="check-square" flush>
          {v.tasks.length === 0 ? (
            <Empty icon="check-circle" title="Inga öppna uppgifter">Uppgifter till din roll visas här.</Empty>
          ) : (
            <div className="flex flex-col">
              {v.tasks.map((t) => (
                <div key={t.id} className="flex min-w-0 items-start gap-3 border-b border-ljusgra px-[18px] py-3 last:border-b-0">
                  <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span className="font-bold">{t.text}</span>
                    <span className="text-small text-text-muted">{t.sub}</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {t.emailId && <Button kind="secondary" iconRight="arrow-right" to={`/inkorg/${encodeURIComponent(t.emailId)}`}>Öppna mejlet</Button>}
                      {t.caseId && <Button kind="secondary" iconRight="arrow-right" to={`/inkorg?arende=${encodeURIComponent(t.caseId)}`}>Öppna beställningen</Button>}
                      <Button
                        kind="ghost" icon="check" pending={taskDone.pending}
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
          )}
        </Card>
        <Card
          title={handles ? "Avtalet: avvikelser och frågor" : "Avtalsavvikelser"} icon="flag" actions={<BuildPhase fas={2} />} flush
          foot={v.deviationsHref ? <Button kind="ghost" iconRight="arrow-right" to={v.deviationsHref}>Alla avtalsavvikelser</Button> : undefined}
        >
          <MiniList>
            {v.deviations.length === 0 && <div className="px-[18px] py-3 text-text-muted">Inga öppna avtalsavvikelser.</div>}
            {v.deviations.map((x) => (
              <MiniRow
                key={x.id}
                left={x.due ? <SlaBadge sla={x.due.sla} dueAt={x.due.dueAt} prefix="Åtgärdsplan" /> : null}
                main={x.description}
                sub={x.sub}
                right={x.href ? <Button kind="ghost" icon="arrow-right" title="Öppna avvikelsen" ariaLabel="Öppna avvikelsen" to={x.href} /> : null}
              />
            ))}
            {handles && v.summaryReport && (
              <MiniRow
                left={v.summaryReport.due ? <SlaBadge sla={v.summaryReport.due.sla} dueAt={v.summaryReport.due.dueAt} /> : null}
                main={v.summaryReport.title}
                sub="Till kommunens chef. Byggs bara av godkända uppgifter."
                right={v.summaryReport.href ? <Button kind="secondary" to={v.summaryReport.href}>Granska</Button> : null}
              />
            )}
            {handles && (
              <MiniRow
                left={<Badge tone={v.warnings.issued > 0 ? "red" : "outline"} icon="alert-circle">{v.warnings.issued} av {v.warnings.max}</Badge>}
                main="Skriftliga varningar"
                sub={v.warnings.text}
              />
            )}
          </MiniList>
        </Card>
      </Grid>

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
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="check" pending={ack.pending} onClick={() => void submit()}>Kvittera</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <span className="font-bold">{a.title}</span>
        <span>{a.text}</span>
      </div>
      <Field id="ink-ack-plan" label="Kort åtgärdsplan" required help="Vad görs, av vem och när? Till exempel: Sara ringer handläggaren i dag före kl. 12 och bokar mötet." error={tried ? err : null}>
        <TextArea value={plan} onValueChange={setPlan} rows={3} maxLength={500} />
      </Field>
      <div className="text-small text-text-muted">Kvitteringen sparas med namn och tid. Flaggan kommer tillbaka om läget ändras.</div>
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
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="calendar" pending={bookCmd.pending} onClick={() => void submit()}>Boka mötet</Button>
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
      {due && date > dayOf(due) && <Notice tone="warn" title={`Senare än ${meetingText} efter avropet`}>Mötet markeras i uppföljningen av nyckeltalet för första möte.</Notice>}
      <div className="text-small text-text-muted">Deltagaren får kallelse via sin föredragna kontaktväg och en SMS-påminnelse dagen före. Inga personuppgifter i utskicket.</div>
    </Modal>
  );
}
