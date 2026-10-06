"use client";
// Min vecka (/min-vecka) – coachens startsida: närvaro att registrera, dagens aktiviteter, AI-utkast, månadsbedömningar,
// meddelanden, påminnelser, flaggor, notiser, rapporter som förfaller och veckokalendern. Port av prototypens coach.minvecka.
import { useState } from "react";
import { plural } from "@/core/format";
import { addDays, dayOf, fmtDate, fmtDateShort, fmtDateTime, fmtDateTimeLong, fmtTime, fmtWeekday, fmtWeekKey, holidayName, isoWeek, monthName, MONTHS, relative, WEEKDAYS } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { Link, useNav } from "@/shell/nav";
import {
  AiTag, Badge, BuildPhase, Button, Card, CaseLink, CaseName, CaseNo, cn, DemoNote, DoneLine, Empty, Field, focusSection, Icon, Input, Kpi, List, ListItem, Meter, Notice, Row, SlaBadge,
  SlaText, Split, Stack, toast, focusSoon, WEEK_KPI_SM, WeekKpis, WeekPage, type IconName,
} from "@/ui";
import { alertAck } from "@/features/ledning/api";
import { notifRead } from "@/features/notiser/api";
import { minVecka, type CalendarActivity, type MinVeckaView } from "../api";
import { VoiceNotesInbox } from "@/features/rost/screens/coach-parts";
import { ATT, AttBadge, dayLabel, kindOf, lc, PageState, Persp } from "./shared";

/** KPI:erna på smal skärm (prototypens co-kpis) – delas med de andra rollernas Min vecka (src/ui/vecka.tsx). */
const KPI_SM = WEEK_KPI_SM;
const MONTHLY_STATUS: [string, string][] = [["draft", "Väntar på din bedömning"], ["reviewed", "Granskade, ska godkännas"], ["approved", "Godkända, ska levereras"]];

export function MinVeckaScreen() {
  const q = useQuery(minVecka, {});
  if (!q.data) return <PageState title="Min vecka" error={q.error} onRetry={() => void q.refetch()} />;
  return <MinVecka v={q.data} />;
}

function MinVecka({ v }: { v: MinVeckaView }) {
  const nav = useNav();
  const read = useCommand(notifRead);
  const [showAllMa, setShowAllMa] = useState(false);
  const now = v.now;
  const today = dayOf(now);
  const unreg = v.unregistered.count;
  const wLast = v.lastWeek.no;
  const regTone = v.reg.sla.tone;
  const next = v.today.find((a) => a.id === v.next?.id) ?? null;
  const pm = v.monthly.month;
  const maRows = showAllMa ? v.monthly.open : v.monthly.open.slice(0, 5);
  const openMessage = async (n: MinVeckaView["messages"][number]) => {
    if (n.notificationId) await read.run({ ids: [n.notificationId] }).catch(() => undefined);
    nav.push(`/arenden/${encodeURIComponent(n.caseId)}?flik=meddelanden`);
  };

  // Meddelanden från kommunen: överst när det finns olästa, annars en rad i högerkolumnen.
  const messagesCard =
    v.messages.length === 0 ? (
      <DoneLine id="mv-meddelanden" title="Meddelanden från kommunen" icon="message">
        Inga olästa meddelanden
      </DoneLine>
    ) : (
      <Card
        id="mv-meddelanden"
        title="Meddelanden från kommunen"
        icon="message"
        flush
        tone="blue"
        actions={<Badge tone="dark" icon="message">{plural(v.messages.reduce((n, m) => n + m.count, 0), "oläst", "olästa")}</Badge>}
      >
        <List>
          {v.messages.map((n) => (
            <ListItem key={n.caseId} icon="message" title={<CaseName caseId={n.caseId} name={n.name} caseNumber={n.caseNumber} />}>
              <span className="text-small">
                Från {n.from ?? "handläggaren"} · {fmtDateTime(n.createdAt)}
                {n.count > 1 ? ` · ${n.count} olästa` : ""}
              </span>
              {n.excerpt && <span className="text-small text-text-muted [overflow-wrap:break-word]">”{n.excerpt}”</span>}
              <div>
                <Button kind="primary" iconRight="arrow-right" pending={read.pending} onClick={() => void openMessage(n)}>
                  Läs och svara
                </Button>
              </div>
            </ListItem>
          ))}
        </List>
      </Card>
    );

  return (
    <WeekPage
      today={today}
      actions={
        <Button kind="primary" icon="check-square" to={`/narvaro?vecka=${unreg ? "forra" : "denna"}`}>
          Registrera närvaro
        </Button>
      }
    >
      <WeekKpis>
        <Kpi
          className={KPI_SM}
          onClick={() => focusSection("mv-narvaro")}
          actionHint="Visa"
          label="Närvaro att registrera"
          value={String(unreg)}
          tone={unreg > 0 && (regTone === "urgent" || regTone === "over") ? "alert" : undefined}
          sub={unreg > 0 ? `Vecka ${wLast} · senast ${v.reg.dueText} · ${v.reg.sla.label.toLowerCase()}` : `Vecka ${wLast} är klar`}
        />
        <Kpi
          className={KPI_SM}
          onClick={() => focusSection("mv-idag")}
          actionHint="Visa"
          label="Aktiviteter i dag"
          value={String(v.today.length)}
          sub={next && v.next ? `Nästa ${fmtTime(next.startsAt)}: ${kindOf(next.kind).label.toLowerCase()} med ${v.next.shortName}` : "Inga fler aktiviteter i dag"}
        />
        <Kpi
          className={KPI_SM}
          onClick={() => focusSection("mv-ai")}
          actionHint="Visa"
          label="AI-utkast att granska"
          value={String(v.drafts.length)}
          sub={v.drafts.length > 0 ? "Råtranskript raderas när du godkänner" : "Inget väntar"}
        />
        <Kpi
          className={KPI_SM}
          onClick={() => focusSection("mv-manad")}
          actionHint="Visa"
          label={<span className="[overflow-wrap:break-word] [hyphens:manual]">{`Månads­bedömningar ${MONTHS[Number(pm.slice(5, 7)) - 1]}`}</span>}
          value={`${v.monthly.done} av ${v.monthly.total}`}
          sub={`klara · förslag senast ${fmtDateShort(v.monthly.dueAt)}`}
        />
      </WeekKpis>

      {v.messages.length > 0 && messagesCard}

      <Split wide>
        <Stack>
          {unreg === 0 ? (
            <DoneLine id="mv-narvaro" title={`Närvaro – vecka ${wLast}`} icon="check-square">
              Allt är registrerat för vecka {wLast}. Veckorapporterna till handläggarna publiceras automatiskt.
            </DoneLine>
          ) : (
          <Card
            id="mv-narvaro"
            title={`Närvaro att registrera – vecka ${wLast}`}
            icon="check-square"
            tone="red"
            actions={<SlaText sla={v.reg.sla} dueAt={v.reg.dueAt} dueText={v.reg.dueText} />}
          >
              <Stack>
                <p>
                  <b>{plural(unreg, "tillfälle", "tillfällen")}</b> från förra veckan saknar närvaro. Registrera senast <b>{v.reg.dueText}</b>. Veckorapporten till varje
                  handläggare publiceras automatiskt när alla handläggarens deltagare är registrerade, senast {v.reg.pubText}.
                </p>
                <List className="rounded-mb border border-ljusgra">
                  {v.unregistered.byCase.map((r) => (
                    <ListItem
                      key={r.caseId}
                      title={<CaseName caseId={r.caseId} name={r.name} caseNumber={r.caseNumber} />}
                      sub={r.items.map((x) => `${dayLabel(x.startsAt)} ${lc(kindOf(x.kind).label)}`).join(" · ")}
                      side={<Badge tone="outline">{r.items.length} kvar</Badge>}
                    />
                  ))}
                </List>
                {v.unregistered.waitingFor.length > 0 && (
                  <Notice tone="warn" title="Väntar på dig">
                    {v.unregistered.waitingFor.length === 1 ? "Veckorapporten" : "Veckorapporterna"} till {v.unregistered.waitingFor.join(" och ")} publiceras när dina
                    tillfällen är registrerade.
                  </Notice>
                )}
                <Row>
                  <Button kind="primary" icon="check-square" to="/narvaro?vecka=forra">
                    Registrera närvaro för vecka {wLast}
                  </Button>
                  <Persp role="kommun_handlaggare" to="/portal/rapporter" label="Se vad handläggaren får" />
                </Row>
              </Stack>
          </Card>
          )}

          <Card id="mv-idag" title={`I dag – ${fmtWeekday(today)}`} icon="calendar" flush>
            {v.today.length === 0 ? (
              <Empty icon="calendar" title="Inga aktiviteter i dag" />
            ) : (
              <List>
                {v.today.map((a) => {
                  const k = kindOf(a.kind);
                  const past = a.startsAt < now;
                  const isNext = v.next?.id === a.id;
                  const ci = a.checkIn;
                  return (
                    <div
                      key={a.id}
                      className={cn(
                        "flex min-w-0 flex-wrap items-start gap-3 border-b border-ljusgra px-[18px] py-3 last:border-b-0",
                        past && "bg-ljusgra-ton",
                        isNext && "shadow-[inset_4px_0_0_var(--color-rod)]",
                      )}
                    >
                      <div className="flex w-16 flex-none flex-col gap-0.5">
                        <span className="text-[1.0625rem] font-extrabold tabular-nums">{fmtTime(a.startsAt)}</span>
                        <span className="text-small text-text-muted">{a.durationMin} min</span>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                        <div className="font-bold">
                          <CaseLink caseId={a.caseId} caseNumber={a.caseNumber} className="-ml-1.5">
                            {a.name}
                          </CaseLink>
                        </div>
                        <div className="text-small text-text-muted">
                          {k.label} · {a.location} · <span className="whitespace-nowrap">{a.caseNumber}</span>
                        </div>
                        <Row gap="sm">
                          {isNext && (
                            <Badge tone="dark" icon="clock">
                              Nästa · {relative(a.startsAt, now)}
                            </Badge>
                          )}
                          {past && <AttBadge at={a.attendance} />}
                          {ci && (
                            <Badge tone={ci.approved ? "blue" : "outline"} icon={ci.approved ? "check" : "edit"}>
                              {ci.approved ? "Avstämning godkänd" : "Avstämning påbörjad"}
                            </Badge>
                          )}
                        </Row>
                      </div>
                      <div className="flex flex-none flex-col items-end gap-1 max-[620px]:basis-full max-[620px]:flex-row max-[620px]:flex-wrap max-[620px]:items-center max-[620px]:pl-[76px]">
                        {a.kind === "möte" && !(ci && ci.approved) && (
                          <Button kind="secondary" icon="edit" to={`/avstamning/${encodeURIComponent(a.caseId)}${ci ? `?avstamning=${encodeURIComponent(ci.id)}` : ""}`}>
                            Avstämning
                          </Button>
                        )}
                        {past && !a.attendance && (
                          <Button kind="ghost" to={`/narvaro?vecka=denna&arende=${encodeURIComponent(a.caseId)}`}>
                            Registrera
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </List>
            )}
          </Card>

          {v.drafts.length === 0 ? (
            <DoneLine id="mv-ai" title="AI-utkast att granska" icon="sparkles">
              Inga AI-utkast väntar. När du spelar in en avstämning med samtycke hamnar utkastet här.
            </DoneLine>
          ) : (
          <Card id="mv-ai" title="AI-utkast att granska" icon="sparkles" actions={<BuildPhase fas={2} />} flush>
              <List>
                {v.drafts.map((ci) => (
                  <ListItem
                    key={ci.checkInId}
                    lead={<AiTag>AI-utkast</AiTag>}
                    title={<CaseName caseId={ci.caseId} name={ci.name} caseNumber={ci.caseNumber} />}
                    sub={`Avstämning ${fmtDateTimeLong(ci.heldAt)} · ${ci.inputMethod === "teams" ? "Teams-transkript" : ci.inputMethod === "notes" ? "inklistrade anteckningar" : "inspelning"}`}
                    side={
                      <Button kind="primary" iconRight="arrow-right" to={`/avstamning/${encodeURIComponent(ci.caseId)}?avstamning=${encodeURIComponent(ci.checkInId)}`}>
                        Granska
                      </Button>
                    }
                  >
                    <span className="text-small">
                      {ci.audioDeletedAt ? `Ljudet raderades ${fmtDateTime(ci.audioDeletedAt)}. ` : ""}Råtranskriptet raderas när du godkänner, senast {fmtDate(ci.rawTranscriptDeleteBy)}.
                    </span>
                  </ListItem>
                ))}
              </List>
          </Card>
          )}

          <VoiceNotesInbox />

          <Card
            id="mv-manad"
            title={`Månadsbedömningar – ${monthName(pm)}`}
            icon="clipboard"
            actions={
              <Badge tone="plan" icon="clock" title={v.monthly.dueNote}>
                Förslag: senast {fmtWeekday(v.monthly.dueAt)}
              </Badge>
            }
          >
            <Stack>
              <Stack gap="sm">
                <Meter value={v.monthly.done} max={Math.max(1, v.monthly.total)} tone="blue" label={`${v.monthly.done} av ${v.monthly.total} bedömningar godkända`} />
                <Row between className="text-small">
                  <span>
                    <b>
                      {v.monthly.done} av {v.monthly.total}
                    </b>{" "}
                    godkända · {v.monthly.open.length} utkast kvar
                  </span>
                  <span className="text-text-muted">{v.monthly.dueNote}</span>
                </Row>
              </Stack>
              {v.monthly.open.length === 0 ? (
                <Notice tone="ok" title="Alla bedömningar är godkända">
                  Månadsrapporterna kan godkännas och levereras.
                </Notice>
              ) : (
                <>
                  <div role="list" aria-label="Månadsbedömningar som återstår" className="flex flex-col rounded-mb border border-ljusgra">
                    {maRows.map((r) => (
                      <div role="listitem" key={r.caseId}>
                        <ListItem
                          title={<CaseName caseId={r.caseId} name={r.name} caseNumber={r.caseNumber} />}
                          side={
                            <Button kind="secondary" iconRight="arrow-right" to={`/manadsbedomning/${encodeURIComponent(r.caseId)}?manad=${pm}`}>
                              Bedöm
                            </Button>
                          }
                        >
                          <Row gap="sm">
                            <Badge tone="outline" icon="edit">
                              Utkast
                            </Badge>
                            {r.hasAi ? <AiTag>AI-utkast finns</AiTag> : <span className="text-small text-text-muted">Underlag: manuellt</span>}
                          </Row>
                        </ListItem>
                      </div>
                    ))}
                  </div>
                  {v.monthly.open.length > 5 && (
                    <div>
                      <Button kind="ghost" icon={showAllMa ? "chevron-up" : "chevron-down"} onClick={() => setShowAllMa(!showAllMa)}>
                        {showAllMa ? "Visa färre" : `Visa alla ${v.monthly.open.length}`}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </Stack>
          </Card>
        </Stack>

        <Stack>
          {v.messages.length === 0 && messagesCard}

          {v.reminders.length === 0 ? (
            <DoneLine title="Påminnelser" icon="bell">
              Inga påminnelser. Alla dina ärenden har dokumenterad progression.
            </DoneLine>
          ) : (
          <Card title="Påminnelser" icon="bell" flush>
              <List>
                {v.reminders.map((w) => (
                  <ListItem
                    key={w.caseId}
                    icon="bell"
                    title={<CaseName caseId={w.caseId} name={w.name} caseNumber={w.caseNumber} />}
                  >
                    <span className="text-small">
                      Ingen progression {w.streak === 1 ? "förra veckan" : `${w.streak} veckor i rad`}: {lc(w.reason)} ({fmtWeekKey(w.weekKey)}).
                    </span>
                    <div>
                      <Button kind="secondary" iconRight="arrow-right" to={`/avstamning/${encodeURIComponent(w.caseId)}`}>
                        Gör avstämning
                      </Button>
                    </div>
                  </ListItem>
                ))}
              </List>
            <div className="border-t border-ljusgra px-[18px] py-3 text-small text-text-muted">
              Påminnelsen kommer när veckomålet inte nåtts eller när en godkänd avstämning saknas. Planera nästa steg tillsammans med deltagaren.
            </div>
          </Card>
          )}

          {v.flags.length === 0 ? (
            <DoneLine id="mv-flaggor" title="Egna flaggor" icon="flag">
              Inga flaggor
            </DoneLine>
          ) : (
            <Card id="mv-flaggor" title="Egna flaggor" icon="flag" flush>
              <FlagList flags={v.flags} />
            </Card>
          )}

          <Card
            title="Olästa notiser"
            icon="bell"
            actions={
              <Button kind="secondary" iconRight="arrow-right" to="/notiser">
                Öppna notiser
              </Button>
            }
          >
            {v.unread.count === 0 ? (
              <p className="text-text-muted">Du har inga olästa notiser.</p>
            ) : (
              <Stack gap="sm">
                <p>
                  <b>{plural(v.unread.count, "oläst", "olästa")}.</b> {v.unread.count === 1 ? "Den senaste:" : "De senaste:"}
                </p>
                <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
                  {v.unread.latest.map((n) => (
                    <li key={n.id}>
                      <span className="font-bold">{n.title}</span>
                      {n.caseNumber && (
                        <>
                          {" "}
                          <CaseNo n={n.caseNumber} />
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </Stack>
            )}
          </Card>

          {!v.due.monthly && v.due.other.length === 0 ? (
            <DoneLine title="Rapporter som förfaller" icon="file">
              Inga rapporter förfaller inom 7 dagar
            </DoneLine>
          ) : (
          <Card title="Rapporter som förfaller" icon="file" flush>
              <List>
                {v.due.monthly && (
                  <ListItem
                    title={`Månadsrapporter ${monthName(pm)}: ${v.due.monthly.count} st`}
                    side={
                      <Button kind="ghost" to="/rapporter">
                        Visa
                      </Button>
                    }
                  >
                    <span className="text-small">
                      {MONTHLY_STATUS.filter(([k]) => (v.due.monthly?.byStatus[k as "draft"] ?? 0) > 0)
                        .map(([k, t]) => `${t}: ${v.due.monthly?.byStatus[k as "draft"]}`)
                        .join(" · ")}
                    </span>
                    <Row gap="sm">
                      <SlaBadge sla={v.due.monthly.sla} dueAt={v.due.monthly.dueAt} />
                      <Badge tone="plan">Förslag – ej fastställt</Badge>
                    </Row>
                  </ListItem>
                )}
                {v.due.other.map((x) => (
                  <ListItem
                    key={x.id}
                    title={x.label}
                    sub={x.caseNumber ? `${x.name} · ${x.caseNumber}` : undefined}
                    side={
                      x.href ? (
                        <Button kind="ghost" to={x.href}>
                          Öppna
                        </Button>
                      ) : undefined
                    }
                  >
                    <Row gap="sm">
                      <SlaBadge sla={x.sla} dueAt={x.dueAt} />
                      {x.provisional && <Badge tone="plan">Förslag – ej fastställt</Badge>}
                    </Row>
                  </ListItem>
                ))}
              </List>
          </Card>
          )}
        </Stack>
      </Split>

      <Card title={`Veckokalender – vecka ${isoWeek(today).week}`} icon="calendar">
        <WeekCalendar mon={v.calendar.mon} acts={v.calendar.activities} now={now} />
      </Card>
      <DemoNote>
        Kalendern visar aktiviteterna i dina aktiva ärenden. I den riktiga tjänsten kan den synkas med Outlook. Påminnelser om progression är interna regler för
        Miljonbemanning och går bara till dig.
      </DemoNote>
    </WeekPage>
  );
}

// Hjälpdelarna (CaseNo, CaseName, DoneLine, SlaText) ligger i Min veckas kit, src/ui/vecka.tsx.

// ---------------------------------------------------------------- Egna flaggor
const flagDomId = (key: string) => `flagga-${key.replace(/[^a-z0-9]/gi, "-")}`;

/** Flaggorna. Efter en kvittering hamnar fokus på nästa flagga (annars föregående, annars avsnittets rubrik). */
function FlagList({ flags }: { flags: MinVeckaView["flags"] }) {
  const after = (key: string) => {
    const i = flags.findIndex((f) => f.key === key);
    const next = flags[i + 1] ?? flags[i - 1];
    focusSoon(next ? flagDomId(next.key) : "mv-flaggor-rubrik");
  };
  return (
    <List>
      {flags.map((a) => (
        <FlagItem key={a.key} a={a} onAcked={() => after(a.key)} />
      ))}
    </List>
  );
}

function FlagItem({ a, onAcked }: { a: MinVeckaView["flags"][number]; onAcked: () => void }) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState("");
  const ack = useCommand(alertAck);
  const critical = a.severity === "critical";
  const primary: [string, string] | null =
    a.kind === "stuck" && a.caseId
      ? [`/kartlaggning/${encodeURIComponent(a.caseId)}`, "Slutför kartläggningen"]
      : a.kind === "absence" && a.caseId
        ? [`/avstamning/${encodeURIComponent(a.caseId)}`, "Gör avstämning"]
        : a.href
          ? [a.href, "Öppna"]
          : null;
  const id = `ack-${a.key.replace(/[^a-z0-9]/gi, "-")}`;
  const save = async () => {
    const res = await ack.run({ key: a.key, plan: plan.trim() }).catch(() => null);
    if (res && res.ok) {
      toast("Flaggan är kvitterad.");
      onAcked();
    } else toast("Flaggan kunde inte kvitteras.", "error");
  };
  // Kvittera visar fältet "Kort åtgärd" och knappen försvinner: fokus till fältet. Avbryt: fokus tillbaka till Kvittera.
  const openAck = () => {
    setOpen(true);
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  };
  const cancelAck = () => {
    setOpen(false);
    requestAnimationFrame(() => document.getElementById(`${id}-kvittera`)?.focus());
  };
  return (
    <div id={flagDomId(a.key)} tabIndex={-1} className="flex min-w-0 items-start gap-3 border-b border-ljusgra px-[18px] py-3 last:border-b-0">
      <Icon name={critical ? "alert" : "flag"} size="lg" className={critical ? "text-rod" : undefined} />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <Row gap="sm">
          <Badge tone={critical ? "red" : "grey"} icon={critical ? "alert" : "flag"}>
            {critical ? "Åtgärd krävs" : "Bevaka"}
          </Badge>
        </Row>
        <div className="font-bold">{a.title}</div>
        <div className="text-small">{a.text}</div>
        <Row gap="sm">
          {primary && (
            <Button kind="secondary" iconRight="arrow-right" to={primary[0]}>
              {primary[1]}
            </Button>
          )}
          {!open && (
            <Button id={`${id}-kvittera`} kind="ghost" icon="check" onClick={openAck}>
              Kvittera
            </Button>
          )}
        </Row>
        {open && (
          <Stack gap="sm" className="mt-1.5">
            <Field label="Kort åtgärd" id={id} help="Skriv vad du gör åt flaggan. Kvitteringen loggas.">
              <Input value={plan} onValueChange={setPlan} maxLength={160} />
            </Field>
            <Row gap="sm">
              <Button kind="primary" icon="check" disabled={!plan.trim()} pending={ack.pending} onClick={() => void save()}>
                Spara kvittering
              </Button>
              <Button kind="ghost" onClick={cancelAck}>
                Avbryt
              </Button>
            </Row>
          </Stack>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Veckokalendern
/** Slår ihop tillfällen med samma tid och typ (t.ex. gemensamt yrkesmoment) till en rad i kalendern. Coachträffar visas var för sig. */
function groupSlots(list: CalendarActivity[]): CalendarActivity[][] {
  const out: CalendarActivity[][] = [];
  const idx = new Map<string, number>();
  for (const a of list) {
    const k = a.kind === "möte" ? a.id : `${a.startsAt}|${a.kind}|${a.location}`;
    if (!idx.has(k)) {
      idx.set(k, out.length);
      out.push([]);
    }
    out[idx.get(k) as number].push(a);
  }
  return out;
}

const EV_BORDER: Record<string, string> = { mote: "border-l-antracit", yrke: "border-l-bla", praktik: "border-l-antracit [border-left-style:dashed]", "": "border-l-antracit" };

function WeekCalendar({ mon, acts, now }: { mon: string; acts: CalendarActivity[]; now: string }) {
  const nav = useNav();
  const today = dayOf(now);
  return (
    <Stack gap="sm" className="gap-3">
      <div className="grid grid-cols-5 gap-2.5 max-[1100px]:grid-cols-1">
        {[0, 1, 2, 3, 4].map((i) => {
          const day = addDays(mon, i);
          const list = acts.filter((a) => dayOf(a.startsAt) === day);
          const hol = holidayName(day);
          const isToday = day === today;
          return (
            <div
              key={day}
              data-testid="kalender-dag"
              className={cn("flex min-w-0 flex-col rounded-mb border border-ljusgra bg-vit", isToday && "border-antracit shadow-[inset_0_4px_0_var(--color-rod)]")}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-1 border-b border-ljusgra px-2.5 pt-2.5 pb-2">
                <span className="text-label font-extrabold tracking-[0.08em] uppercase">
                  {WEEKDAYS[i]} {fmtDateShort(day)}
                </span>
                {isToday ? <Badge tone="dark">I dag</Badge> : <span className="text-small text-text-muted">{plural(list.length, "tillfälle", "tillfällen")}</span>}
              </div>
              <div className="flex flex-col gap-1.5 p-2 max-[1100px]:flex-row max-[1100px]:flex-wrap">
                {hol && <span className="text-small text-text-muted">{hol}</span>}
                {list.length === 0 && !hol && <span className="text-small text-text-muted">Inga aktiviteter</span>}
                {groupSlots(list).map((grp) => {
                  const a = grp[0];
                  const k = kindOf(a.kind);
                  const past = a.startsAt < now;
                  const regd = grp.filter((x) => x.attendance).length;
                  const open = past ? grp.length - regd : 0;
                  const names = grp.map((x) => x.shortName);
                  const single = grp.length === 1;
                  const target = single && a.kind === "möte" ? `/avstamning/${encodeURIComponent(a.caseId)}` : `/narvaro?vecka=denna${single ? `&arende=${encodeURIComponent(a.caseId)}` : ""}`;
                  const icon: IconName | null = single ? (a.attendance ? ATT[a.attendance].icon : past ? "circle" : null) : past ? (open ? "circle" : "check-circle") : null;
                  const label = `${fmtTime(a.startsAt)} ${k.label} med ${names.join(", ")}${past ? (open ? `, ${open} ej registrerade` : ", närvaro registrerad") : ""}`;
                  const tile = cn(
                    "flex min-h-11 w-full min-w-0 flex-col gap-px rounded-[4px] border border-l-4 border-ljusgra bg-vit text-left text-meta leading-[1.35] text-antracit [font-family:inherit]",
                    "max-[1100px]:w-auto max-[1100px]:flex-[1_1_170px]",
                    EV_BORDER[k.cls],
                  );
                  const when = (
                    <span className="flex items-center gap-1 font-bold">
                      {fmtTime(a.startsAt)} · {k.label}
                      {!single ? ` (${grp.length})` : ""}
                      {icon && <Icon name={icon} className="ml-auto size-3.5" />}
                    </span>
                  );
                  if (single) {
                    // En deltagare: två mål – tiden och typen leder till avstämningen (eller närvaron), namnet till deltagarkortet.
                    return (
                      <div key={a.id} className={tile}>
                        <Link to={target} aria-label={label} className="flex min-h-11 flex-col justify-center rounded-t-[3px] px-2 pt-1.5 no-underline hover:bg-ljusgra-ton">
                          {when}
                        </Link>
                        <Link
                          to={`/arenden/${encodeURIComponent(a.caseId)}`}
                          className="inline-flex min-h-11 items-center rounded-b-[3px] px-2 pb-1 text-text-muted underline underline-offset-2 [overflow-wrap:anywhere] hover:bg-ljusgra-ton"
                        >
                          {names[0]}
                          <span className="sr-only"> – deltagarkortet</span>
                        </Link>
                      </div>
                    );
                  }
                  return (
                    <button type="button" key={a.id} onClick={() => nav.push(target)} aria-label={label} className={cn(tile, "cursor-pointer px-2 py-1.5 hover:bg-ljusgra-ton")}>
                      {when}
                      <span className="text-text-muted [overflow-wrap:anywhere]">{names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ")}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1.5 text-small text-text-muted">
        <span>
          <span className="mr-1.5 inline-block h-2.5 w-3.5 rounded-[2px] bg-antracit align-middle" />
          Coachträff
        </span>
        <span>
          <span className="mr-1.5 inline-block h-2.5 w-3.5 rounded-[2px] bg-bla align-middle" />
          Yrkesmoment
        </span>
        <span>
          <span className="mr-1.5 inline-block h-2.5 w-3.5 rounded-[2px] border-2 border-dashed border-antracit align-middle" />
          Praktikdag
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon name="check-circle" />
          närvaro registrerad
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon name="circle" />
          passerat, något ej registrerat
        </span>
        <span>(3) = antal deltagare vid gemensamt tillfälle</span>
      </div>
    </Stack>
  );
}
