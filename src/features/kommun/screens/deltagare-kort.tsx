"use client";
// Deltagarens sida i portalen (/portal/deltagare/:caseId?flik=) – prototypens CaseDetail i views/kommun.js.
// Flikarna Översikt, Rapporter och Meddelanden. Kommunens chef läser i tredje person ("Handläggaren (namn)") och ser deltagare
// med skyddade personuppgifter bara som ärendenummer och status. Visningen loggas (case.view).
import { useEffect, useState, type ReactNode } from "react";
import { kr, pct } from "@/core/format";
import { messageRead, messageSend } from "@/features/arenden/api";
import { auditView } from "@/features/session/api";
import { useCommand, useQuery } from "@/shell/backend";
import { path, useNav } from "@/shell/nav";
import {
  Badge, BuildPhase, Button, Card, Empty, ErrorNotice, Field, Grid, Icon, Kpi, Kv, List, Loading, MaskedPnr, Notice, PerspectiveLink, PhaseBar, Stack, TabPanel, Tabs,
  TextArea, Timeline, cn, useAuditView, useToast, type TimelineItem,
} from "@/ui";
import { kommunCase, kommunCaseSeen, kommunRevealPnr, type KomAttTile, type KomCaseDetail, type KomMessage } from "../api";
import { fD, fDT, fDTL, fullText, looksLikePnr, phaseText, statusText } from "../texts";
import { KOM_TABS, KStatus, KomHead, KomPage, ReportRowItem, reportPath } from "./parts";
import { taskTitle, useTaskDone } from "./start";

type Tab = "oversikt" | "rapporter" | "meddelanden";
const TABS: readonly Tab[] = ["oversikt", "rapporter", "meddelanden"];
const SOURCE_TEXT: Record<string, string> = { portal: "portalen", email: "mejl", phone: "telefon" };

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
  const back = { label: ok?.chef ? "Alla enhetens deltagare" : "Alla mina deltagare", to: "/portal/deltagare" };
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
          Du ser bara de deltagare som du själv har beställt en insats för. Så fungerar behörigheten i den riktiga tjänsten också.
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
  const unreadMsgs = d.chef || !d.messages ? [] : d.messages.filter((m) => m.unread);
  // Perspektivbyte: skyddade ärenden öppnas som avtalsansvarig (samordnaren har inte full åtkomst). Samma flik som här.
  const mbRole = c.protectedIdentity ? "avtalsansvarig" : "samordnare";
  return (
    <KomPage>
      <KomHead
        back={back}
        eyebrow={`Ärendenummer ${c.caseNumber}${c.primaryAreaName ? ` · ${c.primaryAreaName}` : ""}`}
        title={c.name}
        lead={statusText(c, d.chef, d.phaseCount)}
        actions={
          <>
            <KStatus c={c} />
            <PerspectiveLink role={mbRole} to={path(`/arenden/${encodeURIComponent(c.id)}`, { flik: tab })} label="Se samma deltagare hos Miljonbemanning" />
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
        {tab === "meddelanden" &&
          (d.messages == null ? (
            <Notice tone="info" icon="lock" title="Meddelandena visas bara för handläggaren">
              Deltagaren har skyddade personuppgifter. Meddelanden om deltagaren kan bara läsas av handläggaren som beställde insatsen ({c.referrerName}).
            </Notice>
          ) : (
            <Messages d={d} messages={d.messages} />
          ))}
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
  const chef = d.chef;
  const doneTask = useTaskDone();
  const reveal = useCommand(kommunRevealPnr);
  const msgs = d.messages ?? [];
  const lastReq = msgs.filter((m) => m.meeting).pop();
  const answered = !!lastReq && msgs.some((m) => m.createdAt > lastReq.createdAt && m.fromCustomer);
  const Who = chef ? `Handläggaren (${c.referrerName})` : "Du";
  const referrer = c.referrerName;
  const o = d.order;

  const tl: TimelineItem[] = [
    { key: "mottagen", icon: "inbox", title: "Mottagen", filled: true, sub: fDT(c.referredAt), body: <span>Beställningen kom in via {SOURCE_TEXT[c.source] ?? "portalen"}{chef ? ` från ${referrer}` : ""}.</span> },
    {
      key: "erkand",
      icon: "mail",
      title: "Ordererkänd",
      filled: !!c.acknowledgedAt,
      sub: c.acknowledgedAt ? fDT(c.acknowledgedAt) : c.protectedIdentity ? "Ingen automatisk bekräftelse vid skyddade personuppgifter" : "Väntar",
      body: c.acknowledgedAt ? <span>{Who} fick ärendenummer {c.caseNumber}. Det är beställningens nummer.</span> : undefined,
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
      body: <span>Startdatum och coach är klara.</span>,
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
        <Notice tone="critical" icon={lastReq && !answered ? "calendar" : "message"} title={unreadMsgs.length === 1 ? "Du har ett nytt meddelande" : `Du har ${unreadMsgs.length} nya meddelanden`}>
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
      {lastReq && !answered && unreadMsgs.length === 0 && !chef && (
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
      {lastReq && !answered && chef && (
        <Card title="Mötesförfrågan till handläggaren" icon="calendar" tone="blue">
          <Stack gap="sm">
            <p>{lastReq.body}</p>
            <div className="text-body text-text-muted">
              Skickad till {referrer} av {lastReq.senderLabel}, {fDT(lastReq.createdAt)}. Handläggaren har inte svarat än.
            </div>
            <span>
              <Button icon="message" onClick={() => onTab("meddelanden")}>
                Läs hela tråden
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
                ["Planerad omfattning", `${o.weeks || "–"} veckor${c.plannedEnd ? `, till ${fD(c.plannedEnd)}` : ""}`],
                [
                  "Beställningens värde",
                  o.weeks ? (
                    <>
                      <span>{kr(o.valueOre)}</span>
                      <span className="block text-body text-text-muted">
                        {o.weeks} veckor × {kr(o.priceOre)}, exklusive moms
                      </span>
                    </>
                  ) : (
                    "–"
                  ),
                ],
                ["Beställarreferens", o.buyerReference || "–"],
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
                ? `${Who} får orderbekräftelsen senast ${fDTL(c.avropDue)}.`
                : `Miljonbemanning ringer ${chef ? "handläggaren" : "dig"} för att gå igenom beställningen enligt den säkra rutinen.`}
            </p>
            <Muted>Den innehåller startdatum, ansvarig coach, tid för första mötet, planerad omfattning och beställningens värde.</Muted>
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
                Skickat till {chef ? referrer : "dig"} {fDT(c.acknowledgedAt)}
              </div>
              <div>{fullText(o.ackText)}</div>
            </div>
          </details>
        )}
      </Card>
      <Card title="Närvaro" icon="check-square">
        {d.attendance == null ? (
          <Muted>Närvaron visas här när insatsen har startat.</Muted>
        ) : d.attendance.restricted ? (
          <p>Deltagaren har skyddade personuppgifter. Närvaron visas bara för handläggaren som beställde insatsen ({referrer}).</p>
        ) : (
          <Stack>
            <Grid cols={2} className="gap-3">
              <AttTile t={d.attendance.month} />
              <AttTile t={d.attendance.prev} />
            </Grid>
            {d.attendance.repeated && (
              <Notice tone="warn" title="Upprepad ogiltig frånvaro">
                {d.attendance.repeated.count} gånger de senaste {d.attendance.repeated.withinDays} dagarna. Coachen tar kontakt med {chef ? "handläggaren" : "dig"} om ett
                uppföljningsmöte.
              </Notice>
            )}
            <Muted>Närvaron redovisas varje vecka i veckorapporten{chef ? " till handläggaren" : ""}. Frånvaro visas bara som kategori.</Muted>
            {!chef && (
              <span>
                <Button kind="ghost" iconRight="arrow-right" to="/portal/rapporter?filter=weekly_attendance">
                  Till veckorapporterna
                </Button>
              </span>
            )}
          </Stack>
        )}
      </Card>
      <Card title="Uppgifter om deltagaren" icon="user">
        {d.participant == null ? (
          <p>Deltagaren har skyddade personuppgifter. Bara handläggaren som beställde ({referrer}) ser namn och personnummer.</p>
        ) : (
          <Stack>
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
                !c.protectedIdentity && ["Kontaktväg", d.participant.contactLabel ?? "–"],
                !c.protectedIdentity && ["Bostadsort", d.participant.city || "–"],
                !c.protectedIdentity && ["Anpassning", d.participant.accessibilityNeeds || "Inget angivet"],
                ["Avtalsområde", c.primaryAreaName ? `${c.primaryAreaName}${c.secondaryAreaName ? ` (alternativt ${c.secondaryAreaName})` : ""}` : "–"],
                ["Yrkesspår", c.vocationalTrack || "–"],
                chef && ["Handläggare", referrer],
              ]}
            />
            {c.protectedIdentity && (
              <Notice tone="info" icon="lock" title="Skyddade personuppgifter">
                Om deltagaren sparar vi bara namn och personnummer. Inga mejl eller SMS går till deltagaren.
              </Notice>
            )}
          </Stack>
        )}
      </Card>
      {d.bonus && (
        <Card title="Bonusanspråk" icon="award" actions={<BuildPhase fas={3} />}>
          <p>
            Deltagaren har påbörjat arbete. Enligt avtalet kan det bli aktuellt med ett bonusanspråk som {chef ? "kommunen" : "du"} beslutar om här. Modellen för bonus är inte
            bestämd än, så funktionen är avstängd.
          </p>
        </Card>
      )}
      {!d.seesCoachNotes && (
        <p className="flex items-center gap-1.5 text-body text-text-muted">
          <Icon name="eye-off" /> Coachens egna anteckningar visas inte för beställaren. Så står det i avtalet.
        </p>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------- Rapporter
function Reports({ d }: { d: KomCaseDetail }) {
  const chef = d.chef;
  return (
    <Stack>
      <Card flush title="Levererade rapporter" icon="file">
        {d.reports.length === 0 ? (
          <Empty icon="file" title="Inga rapporter än">
            Rapporterna visas här när Miljonbemanning har levererat dem. {chef ? "Handläggaren" : "Du"} får ett mejl utan personuppgifter när en ny rapport finns.
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
        {chef
          ? "Veckorapporterna om närvaro går till handläggaren och samlar alla handläggarens deltagare."
          : "Veckorapporterna om närvaro samlar alla dina deltagare och finns under Rapporter och meddelanden."}
      </Muted>
      {!chef && (
        <span>
          <Button iconRight="arrow-right" to="/portal/rapporter">
            Till alla rapporter
          </Button>
        </span>
      )}
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
  const [text, setText] = useState("");
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
      setErr(null);
      toast("Meddelandet är skickat. Miljonbemanning får en notis utan personuppgifter.");
    } else toast(res && !res.ok && res.message ? res.message : "Meddelandet kunde inte skickas.", "error");
  };

  return (
    <Stack>
      <Card title="Säkra meddelanden" icon="lock">
        <Stack>
          {messages.length === 0 ? (
            <Empty icon="message" title="Inga meddelanden än">
              {d.chef
                ? `Här skriver handläggaren och Miljonbemanning till varandra om ärendenummer ${c.caseNumber}.`
                : `Här skriver du och Miljonbemanning till varandra om ärendenummer ${c.caseNumber}.`}
            </Empty>
          ) : (
            <div role="log" aria-label="Meddelanden" className="flex flex-col gap-3">
              {messages.map((m) => (
                <div
                  key={m.id}
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
                      <Badge tone="red" icon="bell">
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
                help={`Skriv så lite personuppgifter som möjligt och inga personnummer. Miljonbemanning får ett mejl med texten "Du har ett nytt meddelande om ärende ${c.caseNumber} – logga in för att läsa." Själva meddelandet skickas aldrig med e-post.`}
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
