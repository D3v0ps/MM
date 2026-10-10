"use client";
// Deltagarens sida i portalen (/portal/deltagare/:caseId?flik=) – prototypens CaseDetail i views/kommun.js.
// Flikarna Översikt, Rapporter och Meddelanden. Bara handläggaren som beställde ser sidan (beslut 2026-10-07: kommunen har
// bara rollen handläggare). Inga belopp, inget ordervärde och ingen beställarreferens (synpunkt #10 och #11). Visningen
// loggas (case.view). Handläggaren avbryter inte en insats i portalen – det görs med ett mejl till avrop@ med ärendenumret
// (beslut 2026-10-09). Beslut 2026-10-09 ("Vi behöver inte visa så mycket till kommunens handläggare"): ingen fasstapel,
// inget fasnamn, inget team, inget ordererkännande att visa, närvaron som en rad (närvarograden senaste månaden – för en
// avslutad insats den sista månaden i insatsen – och en länk till rapporterna, där veckorapporterna finns), ingen
// kontaktväg, bostadsort eller yrkesspår och ingen bakgrundsinformation från beställningen.
import { useEffect, useState, type ReactNode } from "react";
import { pct } from "@/core/format";
import { messageRead, messageSend } from "@/features/arenden/api";
import { auditView } from "@/features/session/api";
import { useCommand, useQuery } from "@/shell/backend";
import { useDraft, useUnsavedGuard } from "@/shell/guard";
import { path, useNav } from "@/shell/nav";
import {
  Badge, Button, Card, Empty, ErrorNotice, Field, focusSoon, Kv, List, Loading, MaskedPnr, Notice, PerspectiveLink, Stack, TabPanel, Tabs,
  TextArea, Timeline, cn, useAuditView, useToast, type TimelineItem,
} from "@/ui";
import { kommunCase, kommunCaseSeen, kommunRevealPnr, type KomCaseDetail, type KomMessage } from "../api";
import { fD, fDT, fDTL, fullText, looksLikePnr, ORDER_EMAIL, orderPeriodLabel, statusText } from "../texts";
import { KOM_TABS, KStatus, KomHead, KomPage, ReportRowItem, reportPath } from "./parts";
import { taskTitle, useTaskDone } from "./start";
import { joinText, TalaIn } from "./tala-in";

type Tab = "oversikt" | "rapporter" | "meddelanden";
const TABS: readonly Tab[] = ["oversikt", "rapporter", "meddelanden"];
const SOURCE_TEXT: Record<string, string> = { portal: "portalen", email: "mejl", phone: "telefon", other: "annan väg" };

export function CaseDetail({ caseId, tab: tab0 }: { caseId: string; tab: string | null }) {
  const q = useQuery(kommunCase, { caseId });
  const log = useCommand(auditView);
  const seen = useCommand(kommunCaseSeen);
  const d = q.data;
  const ok = d?.kind === "ok" ? d : null;
  // Visningen av deltagarens sida loggas en gång per sidvisning (CLAUDE.md punkt 3).
  useAuditView(ok ? `case.view:${ok.case.id}` : null, () => log.run({ action: "case.view", entity: "case", entityId: caseId }));
  // Händelser i ärendet (avböjd, ny coach) räknas som lästa när handläggaren har öppnat ärendet.
  const unseen = ok?.unseenEvents ?? 0;
  useEffect(() => {
    if (unseen > 0) void seen.run({ caseId }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseen, caseId]);

  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !d) return <Loading />;
  const back = { label: "Alla mina deltagare", to: "/portal/deltagare" };
  if (d.kind === "not_found") {
    return (
      <KomPage>
        <KomHead title="Deltagaren hittades inte" back={back} />
        <Notice tone="warn">Vi hittar ingen insats med det ärendenumret. Kontrollera numret.</Notice>
      </KomPage>
    );
  }
  if (d.kind === "denied") {
    return (
      <KomPage>
        <KomHead title="Du har inte tillgång" back={back} />
        <Notice tone="warn" title="Insatsen är beställd av en annan handläggare">
          Du ser bara de deltagare som du själv har beställt en insats för.
        </Notice>
      </KomPage>
    );
  }
  return <Detail d={d} tab={TABS.includes(tab0 as Tab) ? (tab0 as Tab) : "oversikt"} back={back} />;
}

function Detail({ d, tab, back }: { d: KomCaseDetail; tab: Tab; back: { label: string; to: string } }) {
  const nav = useNav();
  const c = d.case;
  const base = `/portal/deltagare/${encodeURIComponent(c.id)}`;
  const setTab = (t: Tab) => nav.replace(path(base, { flik: t === "oversikt" ? null : t }));
  const unreadMsgs = d.messages.filter((m) => m.unread);
  return (
    <KomPage>
      <KomHead
        back={back}
        eyebrow={`Ärendenummer ${c.caseNumber}${c.primaryAreaName ? ` · ${c.primaryAreaName}` : ""}`}
        title={c.name}
        lead={statusText(c)}
        actions={
          <>
            <KStatus c={c} />
            <PerspectiveLink role="samordnare" to={path(`/arenden/${encodeURIComponent(c.id)}`, { flik: tab })} label="Se samma deltagare hos Miljonbemanning" />
          </>
        }
      />
      <Tabs
        id="kom-deltagare"
        ariaLabel="Deltagarens insats"
        className={KOM_TABS}
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "oversikt", label: "Översikt", icon: "home" },
          { id: "rapporter", label: "Rapporter", icon: "file", count: d.unreadReports },
          { id: "meddelanden", label: "Meddelanden", icon: "message", count: unreadMsgs.length },
        ]}
      />
      <TabPanel tabsId="kom-deltagare" active={tab}>
        {tab === "oversikt" && <Overview d={d} unreadMsgs={unreadMsgs} onTab={setTab} />}
        {tab === "rapporter" && <Reports d={d} />}
        {tab === "meddelanden" && <Messages d={d} messages={d.messages} />}
      </TabPanel>
    </KomPage>
  );
}

// ---------------------------------------------------------------- Översikt
const Muted = ({ children, className }: { children?: ReactNode; className?: string }) => <p className={cn("text-text-muted", className)}>{children}</p>;

function Overview({ d, unreadMsgs, onTab }: { d: KomCaseDetail; unreadMsgs: KomMessage[]; onTab: (t: Tab) => void }) {
  const c = d.case;
  const doneTask = useTaskDone();
  const reveal = useCommand(kommunRevealPnr);
  const msgs = d.messages;
  const lastReq = msgs.filter((m) => m.meeting).pop();
  const answered = !!lastReq && msgs.some((m) => m.createdAt > lastReq.createdAt && m.fromCustomer);
  const o = d.order;

  const tl: TimelineItem[] = [
    { key: "mottagen", icon: "inbox", title: "Mottagen", filled: true, sub: fDT(c.referredAt), body: <span>Beställningen kom in via {SOURCE_TEXT[c.source] ?? "portalen"}.</span> },
    {
      key: "erkand",
      icon: "mail",
      title: "Ordererkänd",
      filled: !!c.acknowledgedAt,
      sub: c.acknowledgedAt ? fDT(c.acknowledgedAt) : "Väntar",
      body: c.acknowledgedAt ? <span>Du fick ärendenummer {c.caseNumber}. Det är beställningens nummer.</span> : undefined,
    },
  ];
  if (c.status === "declined") tl.push({ key: "avbojd", icon: "x", title: "Avböjd", filled: true, tone: "red", sub: fDT(c.declinedAt), body: <span>{c.declineReason ?? ""}</span> });
  else {
    tl.push({
      key: "bekraftad",
      icon: "check",
      title: "Bekräftad",
      filled: !!c.confirmedAt,
      sub: c.confirmedAt ? fDT(c.confirmedAt) : c.acknowledgedAt ? `Senast ${fDT(c.avropDue)}` : "Efter telefonsamtalet",
      body: <span>{c.confirmedAt ? "Startdatum och coach är klara." : "Då får du startdatum, ansvarig coach och tid för första mötet."}</span>,
    });
    d.coachChanges.forEach((h, i) =>
      tl.push({ key: `coach-${i}`, icon: "users", title: "Ny ansvarig coach", filled: true, sub: fDT(h.at), body: <span>{h.toName} tog över efter {h.fromName}.</span> }),
    );
    tl.push({
      key: "pagar",
      icon: "activity",
      title: "Pågår",
      filled: !!c.startDate && c.startDate <= d.today,
      sub: c.startDate ? `Start ${fD(c.startDate)}` : c.plannedStart ? `Planerad start ${fD(c.plannedStart)}` : c.desiredStart ? `Önskad start ${fD(c.desiredStart)}` : "",
    });
    tl.push({
      key: "avslutad",
      icon: "check-square",
      title: "Avslutad",
      filled: c.status === "closed",
      sub: c.endDate ? `${fD(c.endDate)}${c.endReasonLabel ? ` · ${c.endReasonLabel}` : ""}` : c.plannedEnd ? `Planerat slut ${fD(c.plannedEnd)}` : "",
    });
  }

  return (
    <Stack gap="lg">
      {d.tasks.map((t) => (
        <Notice key={t.id} tone="critical" icon="flag" title={taskTitle(t)}>
          <Stack gap="sm">
            <span>{fullText(t.text)}</span>
            <span className="text-body">Från Miljonbemanning, {fDT(t.createdAt)}.</span>
            <span className="flex flex-wrap items-center gap-3">
              <Button kind="primary" icon="message" onClick={() => onTab("meddelanden")}>
                Svara i meddelanden
              </Button>
              <Button kind="ghost" icon="check" onClick={() => void doneTask(t)}>
                Markera som klar
              </Button>
            </span>
          </Stack>
        </Notice>
      ))}
      {unreadMsgs.length > 0 && (
        // Nya meddelanden är blå (nytt till dig) – rött bara för uppgifterna ovan, som väntar på ditt beslut.
        <Notice tone="info" icon={lastReq && !answered ? "calendar" : "message"} title={unreadMsgs.length === 1 ? "Du har ett nytt meddelande" : `Du har ${unreadMsgs.length} nya meddelanden`}>
          <Stack gap="sm">
            <span>
              Från {unreadMsgs[unreadMsgs.length - 1].senderLabel}, {fDT(unreadMsgs[unreadMsgs.length - 1].createdAt)}.
            </span>
            <span>
              <Button kind="primary" icon="message" onClick={() => onTab("meddelanden")}>
                Läs och svara
              </Button>
            </span>
          </Stack>
        </Notice>
      )}
      {lastReq && !answered && unreadMsgs.length === 0 && (
        <Card title="Mötesförfrågan från coachen" icon="calendar" tone="blue">
          <Stack gap="sm">
            <p>{lastReq.body}</p>
            <div className="text-body text-text-muted">
              {lastReq.senderLabel} · {fDT(lastReq.createdAt)}
            </div>
            <span>
              <Button kind="primary" icon="reply" onClick={() => onTab("meddelanden")}>
                Svara
              </Button>
            </span>
          </Stack>
        </Card>
      )}
      <Card title="Så långt har insatsen kommit" icon="list">
        <Timeline items={tl} />
      </Card>
      <Card title="Orderbekräftelse" icon="check-circle">
        {c.confirmedAt ? (
          <Stack>
            <Kv
              items={[
                ["Startdatum", fD(c.startDate || c.plannedStart || (c.firstMeetingAt ?? "").slice(0, 10) || c.desiredStart)],
                ["Ansvarig coach", o.coachName ?? "–"],
                ["Första mötet", c.firstMeetingAt ? `${fDTL(c.firstMeetingAt)}, ${c.location || "Alby"}` : `Bokas senast ${fD(c.firstMeetingDue)}`],
                ["Omfattning", orderPeriodLabel(c)],
                ["Bekräftad", fDT(c.confirmedAt)],
              ]}
            />
            {o.ocReportId && (
              <span>
                <Button icon="file" to={reportPath(o.ocReportId, "deltagare")}>
                  Öppna orderbekräftelsen
                </Button>
              </span>
            )}
          </Stack>
        ) : c.status === "declined" ? (
          <p>Beställningen avböjdes. Ingen orderbekräftelse skickas.</p>
        ) : (
          <Stack gap="sm">
            <p>
              {c.acknowledgedAt
                ? `Du får orderbekräftelsen senast ${fDTL(c.avropDue)}.`
                : "Miljonbemanning går igenom beställningen och skickar ett ordererkännande till dig."}
            </p>
            <Muted>Den innehåller startdatum, ansvarig coach, tid för första mötet och omfattning.</Muted>
          </Stack>
        )}
      </Card>
      <Card title="Närvaro" icon="check-square">
        {d.attendance == null ? (
          <Muted>Närvaron visas här när insatsen har startat.</Muted>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <AttendanceLine a={d.attendance} />
            {/* Veckorapporterna gäller alla deltagare och finns bland rapporterna (inga typfilter – beslut 2026-10-09). */}
            <Button kind="ghost" iconRight="arrow-right" to="/portal/rapporter">
              Till rapporterna
            </Button>
          </div>
        )}
      </Card>
      <Card title="Uppgifter om deltagaren" icon="user">
        <Kv
          items={[
            [
              "Personnummer",
              <MaskedPnr
                key="pnr"
                masked={d.participant.pnrMasked}
                onReveal={
                  d.participant.canReveal
                    ? async () => {
                        const r = await reveal.run({ caseId: c.id });
                        return r.ok ? r.pnr : null;
                      }
                    : undefined
                }
              />,
            ],
            ["Yrkesområde", c.primaryAreaName ? `${c.primaryAreaName}${c.secondaryAreaName ? ` (alternativt ${c.secondaryAreaName})` : ""}` : "Väljs av Miljonbemanning"],
          ]}
        />
      </Card>
      {/* Avbrott görs med mejl (beslut 2026-10-09) – ärendenumret i ämnesraden kopplar mejlet till ärendet i avropsinkorgen. */}
      {c.status !== "closed" && c.status !== "declined" && (
        <p>
          Vill du avbryta insatsen? Mejla{" "}
          <a className="font-bold underline underline-offset-3 [overflow-wrap:anywhere]" href={`mailto:${ORDER_EMAIL}?subject=${encodeURIComponent(`Avbryta insatsen ${c.caseNumber}`)}`}>
            {ORDER_EMAIL}
          </a>{" "}
          med ärendenumret {c.caseNumber}.
        </p>
      )}
    </Stack>
  );
}

/**
 * Närvaron som en rad. "Inte registrerad än" bara när det finns passerade tillfällen och inget av dem är registrerat – inga
 * tillfällen i perioden (t.ex. pausad insats) har en egen text. En avslutad insats visar den sista månaden i insatsen.
 */
function AttendanceLine({ a }: { a: NonNullable<KomCaseDetail["attendance"]> }) {
  if (a.planned === 0) return <p>{a.ended ? "Det var inga tillfällen den sista månaden i insatsen." : "Det har inte varit några tillfällen den senaste månaden."}</p>;
  return (
    <p>
      {a.ended ? "Närvarograd den sista månaden i insatsen" : "Närvarograd senaste månaden"}: <b>{a.rate == null ? "närvaron är inte registrerad än" : pct(a.rate, 0)}</b>
    </p>
  );
}

// ---------------------------------------------------------------- Rapporter
function Reports({ d }: { d: KomCaseDetail }) {
  return (
    <Stack>
      <Card flush title="Levererade rapporter" icon="file">
        {d.reports.length === 0 ? (
          <Empty icon="file" title="Inga rapporter än">
            Rapporterna visas här när Miljonbemanning har levererat dem. Du får ett mejl utan personuppgifter när en ny rapport finns.
          </Empty>
        ) : (
          <List>
            {d.reports.map((r) => (
              <ReportRowItem key={r.id} r={r} from="deltagare" showSub={false} />
            ))}
          </List>
        )}
      </Card>
      {d.reports.some((r) => r.correcting) && <Muted>En rapport som rättas finns kvar här tills Miljonbemanning har levererat den nya versionen.</Muted>}
      <Muted>
        Rapporterna byggs bara av uppgifter som coachen har godkänt.{" "}
        Veckorapporterna om närvaro samlar alla dina deltagare och finns under Rapporter och meddelanden.
      </Muted>
      <span>
        <Button iconRight="arrow-right" to="/portal/rapporter">
          Till alla rapporter
        </Button>
      </span>
    </Stack>
  );
}

// ---------------------------------------------------------------- Meddelanden
function Messages({ d, messages }: { d: KomCaseDetail; messages: KomMessage[] }) {
  const c = d.case;
  const toast = useToast();
  const send = useCommand(messageSend);
  const read = useCommand(messageRead);
  const unread = messages.filter((m) => m.unread);
  // Meddelanden som var olästa när fliken öppnades markeras "Nytt" även efter läskvittot.
  const [newIds] = useState(() => new Set(unread.map((m) => m.id)));
  // Utkastet ligger kvar per ärende (bara i minnet) – också när man byter flik eller lämnar sidan och kommer tillbaka.
  const draft = useDraft(`portal-meddelande|${c.id}`, "");
  const text = draft.value;
  const setText = draft.set;
  // Medan det skickas/sparas (kommandot och omhämtningen efteråt) frågar vakten inte: annars varnar sidan för text som just
  // har skickats, innan fältet hunnit tömmas.
  useUnsavedGuard(!!text.trim() && !send.pending, "Meddelandet du har skrivit är inte skickat. Det finns kvar om du kommer tillbaka.");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (d.canWrite && unread.length > 0) void read.run({ caseId: c.id }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread.length]);
  const lastReq = messages.filter((m) => m.meeting).pop();
  const answered = !!lastReq && messages.some((m) => m.createdAt > lastReq.createdAt && m.fromCustomer);

  const submit = async () => {
    const body = text.trim();
    if (!body) return setErr("Skriv ett meddelande först.");
    if (looksLikePnr(body)) return setErr("Det ser ut som ett personnummer i texten. Ta bort det – ärendenumret räcker.");
    const res = await send.run({ caseId: c.id, body }).catch(() => null);
    if (res && res.ok) {
      setText("");
      draft.clear();
      setErr(null);
      toast("Meddelandet är skickat. Miljonbemanning får en notis utan personuppgifter.");
      // Fältet töms: fokus till det nya meddelandet.
      focusSoon(`kom-meddelande-${res.messageId}`);
    } else toast(res && !res.ok && res.message ? res.message : "Meddelandet kunde inte skickas.", "error");
  };

  return (
    <Stack>
      <Card title="Säkra meddelanden" icon="lock">
        <Stack>
          {messages.length === 0 ? (
            <Empty icon="message" title="Inga meddelanden än">
              {`Här skriver du och Miljonbemanning till varandra om ärendenummer ${c.caseNumber}.`}
            </Empty>
          ) : (
            <div role="log" aria-label="Meddelanden" className="flex flex-col gap-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  id={`kom-meddelande-${m.id}`}
                  tabIndex={-1}
                  className={cn(
                    "flex max-w-[90%] flex-col gap-1.5 self-start rounded-card bg-bla-ton px-3.5 py-3 [overflow-wrap:anywhere]",
                    m.mine && "self-end bg-antracit-ton",
                    m.meeting && "border-2 border-antracit bg-vit",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-body text-text-muted">
                    {m.meeting && (
                      <Badge tone="dark" icon="calendar">
                        Mötesförfrågan
                      </Badge>
                    )}
                    {newIds.has(m.id) && (
                      <Badge tone="dark" icon="bell">
                        Nytt
                      </Badge>
                    )}
                    <span className="font-bold text-antracit">{m.senderLabel}</span>
                    <span>{fDT(m.createdAt)}</span>
                  </div>
                  <div>{m.body}</div>
                  {m.mine && <div className="text-body text-text-muted">{m.read ? `Läst ${m.readAt ? fDT(m.readAt) : ""}` : "Inte läst än"}</div>}
                </div>
              ))}
            </div>
          )}
          {d.canWrite ? (
            <Stack>
              {lastReq && !answered && (
                <Stack gap="sm">
                  <div className="text-body font-extrabold tracking-[0.09em] text-text-muted uppercase">Snabbsvar på mötesförfrågan</div>
                  <div className="flex flex-wrap gap-2.5">
                    <Button
                      icon="check"
                      onClick={() => {
                        setText("Tack! Tiden passar. Jag kommer.");
                        setErr(null);
                      }}
                    >
                      Tiden passar
                    </Button>
                    <Button
                      icon="calendar"
                      onClick={() => {
                        setText("Tack! Den tiden passar tyvärr inte. Jag kan i stället ");
                        setErr(null);
                      }}
                    >
                      Föreslå en annan tid
                    </Button>
                  </div>
                </Stack>
              )}
              <Field
                id="kom-msg"
                label="Nytt meddelande"
                error={err ?? undefined}
                help="Skriv inga personnummer – ärendenumret räcker."
              >
                <TextArea
                  rows={4}
                  maxLength={2000}
                  value={text}
                  onValueChange={(v) => {
                    setText(v);
                    if (err) setErr(null);
                  }}
                />
              </Field>
              {draft.restored && text.trim() && <p className="font-bold">Det du skrev senast finns kvar. Meddelandet är inte skickat ännu.</p>}
              <TalaIn fieldId="kom-msg" caseId={c.id} onText={(t) => setText((x) => joinText(x, t, 2000))} />
              <span>
                <Button kind="primary" size="lg" icon="send" pending={send.pending} onClick={() => void submit()}>
                  Skicka meddelandet
                </Button>
              </span>
            </Stack>
          ) : (
            <Muted>Meddelanden om deltagaren skickas av handläggaren som beställde insatsen ({c.referrerName}). Du kan läsa dem här.</Muted>
          )}
        </Stack>
      </Card>
      <p className="text-body text-text-muted">Säkra meddelanden ersätter mejl med personuppgifter. Allt sparas under ärendenumret och syns för den ansvariga coachen.</p>
    </Stack>
  );
}
