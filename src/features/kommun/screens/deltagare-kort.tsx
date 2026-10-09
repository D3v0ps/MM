"use client";
// Deltagarens sida i portalen (/portal/deltagare/:caseId?flik=) – prototypens CaseDetail i views/kommun.js.
// Flikarna Översikt, Rapporter och Meddelanden. Bara handläggaren som beställde ser sidan (beslut 2026-10-07: kommunen har
// bara rollen handläggare). Inga belopp, inget ordervärde och ingen beställarreferens (synpunkt #10 och #11). Bakgrunds-
// informationen och bilagorna från beställningen visas under Översikt. Visningen loggas (case.view).
import { useEffect, useState, type ReactNode } from "react";
import { pct } from "@/core/format";
import { messageRead, messageSend } from "@/features/arenden/api";
import { CaseBackgroundCard } from "@/features/arenden/screens/attachments";
import { auditView } from "@/features/session/api";
import { useCommand, useQuery } from "@/shell/backend";
import { useDraft, useUnsavedGuard } from "@/shell/guard";
import { path, useNav } from "@/shell/nav";
import {
  Badge, Button, Card, Empty, ErrorNotice, Field, focusSoon, Grid, Icon, Kpi, Kv, List, Loading, MaskedPnr, Notice, PerspectiveLink, PhaseBar, Stack, TabPanel, Tabs,
  TextArea, Timeline, cn, useAuditView, useToast, type TimelineItem,
} from "@/ui";
import { kommunCase, kommunCaseSeen, kommunRevealPnr, type KomAttTile, type KomCaseDetail, type KomMessage } from "../api";
import { fD, fDT, fDTL, fullText, looksLikePnr, orderPeriodLabel, phaseText, statusText } from "../texts";
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
        lead={statusText(c, d.phaseCount)}
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
function AttTile({ t }: { t: KomAttTile }) {
  const reg = t.planned - t.unregistered;
  return (
    <Kpi
      label={t.label}
      value={t.rate == null ? "–" : pct(t.rate, 0)}
      sub={
        reg > 0
          ? `Närvarande ${t.present + t.late} av ${reg} tillfällen${t.unregistered > 0 ? ` · ${t.unregistered} inte registrerade än` : ""}`
          : t.planned > 0
            ? "Närvaron är inte registrerad än"
            : "Inga tillfällen ännu"
      }
    >
      {(t.absentValid > 0 || t.absentInvalid > 0) && (
        <div className="text-body">
          Giltig frånvaro: {t.absentValid} · Ogiltig frånvaro: {t.absentInvalid}
        </div>
      )}
    </Kpi>
  );
}

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
        <Stack>
          {c.status === "active" && (
            <Stack gap="sm">
              <PhaseBar phase={c.phase} total={d.phaseCount} />
              <div className="text-body text-text-muted">
                Fas {c.phase} av {d.phaseCount} · {phaseText(c.phaseName)}
              </div>
            </Stack>
          )}
          <Timeline items={tl} />
        </Stack>
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
            {o.team.length > 0 && <div className="text-body text-text-muted">Team: {o.team.map((t) => `${t.name} (${t.roleLabel.toLowerCase()})`).join(", ")}</div>}
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
        {c.acknowledgedAt && o.ackText && (
          <details className="group mt-3.5">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-bold underline underline-offset-3 [&::-webkit-details-marker]:hidden">
              <Icon name="chevron-down" className="transition-transform group-open:rotate-180" />
              Visa ordererkännandet
            </summary>
            <div className="mt-2 flex flex-col gap-1.5 rounded-mb border-[1.5px] border-line-strong bg-ljusgra-ton px-4 py-3.5 [overflow-wrap:anywhere]">
              <div className="text-body text-text-muted">
                Skickat till dig {fDT(c.acknowledgedAt)}
              </div>
              <div>{fullText(o.ackText)}</div>
            </div>
          </details>
        )}
      </Card>
      <Card title="Närvaro" icon="check-square">
        {d.attendance == null ? (
          <Muted>Närvaron visas här när insatsen har startat.</Muted>
        ) : (
          <Stack>
            <Grid cols={2} className="gap-3">
              <AttTile t={d.attendance.month} />
              <AttTile t={d.attendance.prev} />
            </Grid>
            {d.attendance.repeated && (
              <Notice tone="warn" title="Upprepad ogiltig frånvaro">
                {d.attendance.repeated.count} gånger de senaste {d.attendance.repeated.withinDays} dagarna. Coachen tar kontakt med dig om ett
                uppföljningsmöte.
              </Notice>
            )}
            <Muted>Närvaron redovisas varje vecka i veckorapporten. Frånvaro visas bara som kategori.</Muted>
            <span>
              <Button kind="ghost" iconRight="arrow-right" to="/portal/rapporter?filter=weekly_attendance">
                Till veckorapporterna
              </Button>
            </span>
          </Stack>
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
            ["Kontaktväg", d.participant.contactLabel ?? "–"],
            ["Bostadsort", d.participant.city || "–"],
            ["Avtalsområde", c.primaryAreaName ? `${c.primaryAreaName}${c.secondaryAreaName ? ` (alternativt ${c.secondaryAreaName})` : ""}` : "Väljs av Miljonbemanning"],
            ["Yrkesspår", c.vocationalTrack || "Väljs av Miljonbemanning"],
          ]}
        />
      </Card>
      <CaseBackgroundCard bg={d.background} title="Bakgrundsinformation från beställningen" />
    </Stack>
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
