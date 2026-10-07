"use client";
// Deltagarkortets flikar Rapporter, Meddelanden och Historik (prototypens views/arenden.js).
import { useState, type FormEvent } from "react";
import { useCommand, useQuery } from "@/shell/backend";
import { useSession } from "@/shell/session";
import { DemoOnly } from "@/shell/runtime";
import { fmtDateTime } from "@/core/time";
import {
  Badge, Button, Card, Empty, Field, focusSoon, Icon, Spacer, Split, Stack, SlaBadge, Table, TextArea, Timeline, toast, cn, type BadgeTone, type Column, type IconName,
} from "@/ui";
import { useDraft, useUnsavedGuard } from "@/shell/guard";
import { caseHistory, caseMessages, caseReports, messageSend, type CaseReportRow } from "../api";
import { canOpen, fd, Label, LiMain, NavTable, PNR_ERROR, PNR_RE, TabQuery } from "./common";
import { CustSwitch, type TabProps } from "./kort";

// ---------------------------------------------------------------- Rapporter
const REPORT_LOOK: Record<string, [BadgeTone, IconName]> = {
  draft: ["outline", "edit"], reviewed: ["bluetone", "eye"], approved: ["bluetone", "check"], delivered: ["blue", "send"], opened: ["blue", "check-circle"], waiting: ["grey", "clock"],
};

export function TabRapporter({ card }: TabProps) {
  const q = useQuery(caseReports, { caseId: card.caseId });
  const role = useSession().actor.role;
  const can = canOpen("rapport.visa", role);
  const today = card.now.slice(0, 10);
  const StatusCell = ({ r }: { r: CaseReportRow }) => {
    const t = REPORT_LOOK[r.status] ?? (["grey", "circle"] as [BadgeTone, IconName]);
    return (
      <>
        <Badge tone={t[0]} icon={t[1]}>{r.statusLabel}</Badge>
        {r.correctionVersion != null && (
          <div className="text-text-muted">Rättelse pågår (version {r.correctionVersion}). Kommunen ser den här versionen tills rättelsen levereras.</div>
        )}
      </>
    );
  };
  const Due = ({ r }: { r: CaseReportRow }) =>
    r.dueAt && r.sla ? (
      <>
        <SlaBadge sla={r.sla} dueAt={r.dueAt} />
        {r.provisionalDue && <div className="text-small text-text-muted">Preliminär – ej fastställd i avtalet</div>}
      </>
    ) : (
      <>–</>
    );
  const Kind = ({ r }: { r: CaseReportRow }) => (
    <>
      <span className="font-bold">{r.kindLabel}</span>
      <div className="text-small text-text-muted">
        {r.periodText}
        {r.version > 1 ? ` · version ${r.version}` : ""}
      </div>
    </>
  );
  const cols: Column<CaseReportRow>[] = [
    { key: "k", label: "Rapport", render: (r) => <Kind r={r} /> },
    { key: "s", label: "Status", render: (r) => <StatusCell r={r} /> },
    { key: "due", label: "Tidsgräns", render: (r) => <Due r={r} /> },
    { key: "del", label: "Levererad", nowrap: true, render: (r) => (r.deliveredAt ? fmtDateTime(r.deliveredAt) : "–") },
    {
      key: "op",
      label: "Kommunen",
      render: (r) =>
        r.openedAt ? (
          <span className="inline-flex items-center gap-1.5">
            <Icon name="check" />
            Läst {fd(r.openedAt, today)}
          </span>
        ) : r.deliveredAt ? (
          <span className="text-small text-text-muted">Inte öppnad än</span>
        ) : (
          "–"
        ),
    },
  ];
  return (
    <TabQuery q={q}>
      {({ reports }) => (
        <Stack>
          <p className="max-w-[75ch] text-text-muted">
            Rapporter byggs bara av godkända uppgifter – godkända avstämningar och bedömningar. Kommunen ser levererade rapporter i portalen. Mejlet till kommunen innehåller bara
            ärendenumret.
          </p>
          <Card flush title={`Rapporter för ${card.caseNumber}`} icon="file" actions={<CustSwitch card={card} tab="rapporter" label={(who) => `Så ser ${who} rapporterna`} />}>
            <NavTable
              columns={cols}
              rows={reports}
              rowAttrs={(r) => ({ "data-mal": `rep:${r.id}` })}
              caption="Rapporter"
              empty="Inga rapporter ännu."
              to={can ? (r) => `/rapporter/${encodeURIComponent(r.id)}` : null}
              mobile={(r) => (
                <LiMain>
                  <div><Kind r={r} /></div>
                  <div><StatusCell r={r} /></div>
                  {r.dueAt && (
                    <div className="text-small">
                      Tidsgräns: <Due r={r} />
                    </div>
                  )}
                  <div className="text-small">
                    {r.deliveredAt ? `Levererad ${fmtDateTime(r.deliveredAt)}` : "Inte levererad"}
                    {r.openedAt ? ` · läst av kommunen ${fd(r.openedAt, today)}` : r.deliveredAt ? " · inte öppnad av kommunen än" : ""}
                  </div>
                </LiMain>
              )}
            />
          </Card>
        </Stack>
      )}
    </TabQuery>
  );
}

// ---------------------------------------------------------------- Meddelanden
export function TabMeddelanden({ card }: TabProps) {
  const q = useQuery(caseMessages, { caseId: card.caseId });
  const send = useCommand(messageSend);
  // Utkastet ligger kvar per ärende (bara i minnet) – också vid byte av flik och när man lämnar kortet.
  const draft = useDraft(`meddelande|${card.caseId}`, "");
  const body = draft.value;
  const setBody = draft.set;
  // Medan det skickas/sparas (kommandot och omhämtningen efteråt) frågar vakten inte: annars varnar sidan för text som just
  // har skickats, innan fältet hunnit tömmas.
  useUnsavedGuard(!!body.trim() && !send.pending, "Meddelandet du har skrivit är inte skickat. Det finns kvar som utkast om du kommer tillbaka.");
  const [err, setErr] = useState<string | null>(null);
  const k = card.referrer;
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const t = body.trim();
    if (!t) {
      setErr("Skriv ett meddelande innan du skickar.");
      return;
    }
    if (PNR_RE.test(t)) {
      setErr(PNR_ERROR);
      return;
    }
    setErr(null);
    const res = await send.run({ caseId: card.caseId, body: t }).catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Meddelandet kunde inte skickas.", "error");
      return;
    }
    setBody("");
    draft.clear();
    toast(`Meddelandet är skickat. ${k ? k.name : "Handläggaren"} får ett mejl utan personuppgifter.`);
    // Fältet töms: fokus till det nya meddelandet i tråden.
    focusSoon(`meddelande-${res.messageId}`);
  };
  return (
    <TabQuery q={q}>
      {({ messages }) => (
        <Split wide>
          <Card title="Säker tråd med kommunen" icon="lock">
            <Stack>
              {messages.length === 0 ? (
                <Empty icon="message" title="Inga meddelanden ännu">Här skriver ni med kommunens handläggare om ärendet. Det ersätter mejl med personuppgifter.</Empty>
              ) : (
                <div className="flex flex-col gap-3" aria-label="Meddelanden">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      id={`meddelande-${m.id}`}
                      tabIndex={-1}
                      data-mal={`msg:${m.id}`}
                      className={cn(
                        "flex max-w-[min(620px,94%)] min-w-0 flex-col gap-1 rounded-card border border-ljusgra px-3.5 py-2.5",
                        m.mine ? "self-end bg-ljusgra-ton" : "self-start border-bla bg-bla-ton",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-1.5 text-small">
                        <span className="font-bold">{m.senderName}</span>
                        <span className="text-text-muted">
                          {m.orgName} · {fmtDateTime(m.createdAt)}
                        </span>
                        {m.meetingRequest && <Badge tone="outline" icon="calendar">Kallelse till uppföljning</Badge>}
                      </div>
                      <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.body}</div>
                      <div className="text-small text-text-muted">{m.readText}</div>
                    </div>
                  ))}
                </div>
              )}
              {card.edit ? (
                <form className="flex flex-col gap-2" onSubmit={(e) => void submit(e)} noValidate>
                  <Field
                    label="Nytt meddelande"
                    id="arn-msg-body"
                    error={err}
                    help={`Skriv sakligt och använd ärendenumret i stället för personnummer. ${k ? k.name : "Handläggaren"} får ett mejl utan innehåll med en uppmaning att logga in.`}
                  >
                    <TextArea
                      value={body}
                      onValueChange={(v) => {
                        setBody(v);
                        if (err) setErr(null);
                      }}
                      rows={4}
                    />
                  </Field>
                  {draft.restored && body.trim() && <p className="font-bold">Ditt osparade utkast är återställt. Det är inte skickat ännu.</p>}
                  <div className="flex flex-wrap gap-3">
                    <Button kind="primary" type="submit" icon="send" pending={send.pending}>Skicka säkert meddelande</Button>
                  </div>
                </form>
              ) : (
                <p className="text-text-muted">{card.readOnly ? "Läsläge – du kan läsa tråden men inte skriva." : "Huvudcoach, samordnare och avtalsansvarig skriver i tråden."}</p>
              )}
            </Stack>
          </Card>
          <Stack>
            <Card title="Så fungerar det" icon="shield" tone="sub">
              <Stack gap="sm" className="text-small">
                <p>Meddelandena finns bara i portalen. Löpande information till kommunen är ett avtalskrav – bristfällig information kan ge vite.</p>
                <Label className="mt-1 mb-0">Mejlet som skickas</Label>
                <div className="flex items-start gap-2.5 rounded-mb border-[1.5px] border-dashed border-line-strong bg-vit px-3 py-2.5 text-small">
                  <Icon name="mail" className="mt-px" />
                  <div>Du har ett nytt meddelande om ärende {card.caseNumber} – logga in för att läsa.</div>
                </div>
                <p className="text-text-muted">Inget innehåll och inga personuppgifter i mejlet.</p>
              </Stack>
            </Card>
            <DemoOnly>
              <div>
                <CustSwitch card={card} tab="meddelanden" label={(who) => `Se tråden som ${who}`} />
              </div>
            </DemoOnly>
          </Stack>
        </Split>
      )}
    </TabQuery>
  );
}

// ---------------------------------------------------------------- Historik
export function TabHistorik({ card }: TabProps) {
  const q = useQuery(caseHistory, { caseId: card.caseId });
  const [n, setN] = useState(25);
  return (
    <TabQuery q={q}>
      {(h) => (
        <Split>
          <Card title="Status och coachbyten" icon="clock">
            {h.items.length ? (
              <Timeline
                items={h.items.map((it) => ({
                  key: it.id,
                  icon: it.icon,
                  filled: it.filled,
                  tone: it.red ? "red" : undefined,
                  title: it.title,
                  sub: it.sub,
                  body: (
                    <>
                      {it.reason && <div className="text-small">Orsak: {it.reason}</div>}
                      {it.customerNotifiedAt && <div className="text-small text-text-muted">Handläggaren fick notis {fmtDateTime(it.customerNotifiedAt)}</div>}
                      {it.leadCoachName && <div className="text-small text-text-muted">Huvudcoach: {it.leadCoachName}</div>}
                    </>
                  ),
                }))}
              />
            ) : (
              <p className="text-text-muted">Ingen historik ännu.</p>
            )}
          </Card>
          <Card
            flush
            title={h.ownOnly ? "Dina åtgärder i ärendet" : "Revisionslogg för ärendet"}
            icon="book"
            foot={
              h.log.length > n && (
                <>
                  <span className="text-small text-text-muted">Visar {n} av {h.log.length}</span>
                  <Spacer />
                  <Button icon="chevron-down" onClick={() => setN(h.log.length)}>Visa alla</Button>
                </>
              )
            }
          >
            {h.ownOnly && (
              <div className="px-[18px] pt-4">
                <p className="text-text-muted">
                  Här ser du det du själv har gjort i ärendet: godkända avstämningar och bedömningar, meddelanden, närvaro och ändringar. Statusändringar och coachbyten finns i kortet
                  Status och coachbyten.
                </p>
              </div>
            )}
            <Table
              caption={h.ownOnly ? "Dina åtgärder" : "Revisionslogg"}
              empty={h.ownOnly ? "Du har inte gjort några loggade ändringar i ärendet ännu." : "Inga loggade händelser ännu."}
              rows={h.log.slice(0, n)}
              className="[&_td]:px-2 [&_th]:px-2 [&_td:first-child]:pl-4 [&_th:first-child]:pl-4 [&_th]:whitespace-normal"
              columns={[
                { key: "t", label: "Tidpunkt", nowrap: true, render: (x) => fmtDateTime(x.occurredAt) },
                ...(h.ownOnly ? [] : [{ key: "a", label: "Vem", render: (x: (typeof h.log)[number]) => x.actorName }]),
                { key: "h", label: "Händelse", render: (x) => <><span>{x.text}</span>{x.sub && <div className="text-small text-text-muted">{x.sub}</div>}</> },
              ]}
            />
          </Card>
        </Split>
      )}
    </TabQuery>
  );
}
