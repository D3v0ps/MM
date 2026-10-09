"use client";
// Deltagarkortets flikar Översikt, Kartläggning, Möten (avstämningar) och Närvaro (prototypens views/arenden.js).
// Tidslinjen och Månadsunderlaget (rapporter steg 2) ligger i kort-tidslinje.tsx och kort-manad.tsx.
import { useState } from "react";
import { useCommand, useQuery } from "@/shell/backend";
import { path } from "@/shell/nav";
import { useSession } from "@/shell/session";
import { dayOf, fmtDateTime, fmtDateTimeLong, fmtTime, fmtWeek, fmtWeekday, fmtWeekKey, fmtWeekRange, relative } from "@/core/time";
import { AiTag, Badge, Button, Card, Empty, Grid, Icon, Kpi, Kv, List, ListItem, Meter, Notice, SlaBadge, Spacer, Stack, Status, toast, useConfirm, type Column } from "@/ui";
import { activityRemove, caseAttendance, caseCheckIns, caseIntake, caseOverview, type CaseAttendance, type CaseAttendanceWeek, type CaseCheckInRow } from "../api";
import {
  ActList, AttBadge, actIcon, actLabel, canOpen, cap, caseLink, clip, fd, FourBadges, GOAL, KpiRow, LiMain, LiSide, LiSub, LiTitle, MItem, MODE, NavTable, pct0, plural, RespTable, SEV,
  TabQuery,
} from "./common";
import { CaseBackgroundCard } from "./attachments";
import type { TabProps } from "./kort";


// ---------------------------------------------------------------- Översikt
export function TabOversikt({ card, setTab, openModal }: TabProps) {
  const q = useQuery(caseOverview, { caseId: card.caseId });
  const role = useSession().actor.role;
  const team = card.access === "team";
  const now = card.now;
  const today = dayOf(now);
  const needsMeeting = card.status === "confirmed" && !card.firstMeetingAt;
  return (
    <TabQuery q={q}>
      {(o) => {
        const nm = o.nextMeeting;
        const lc = o.latest;
        const ast = o.attendance;
        const alerts = card.flags;
        const pl = o.placement;
        return (
          <Stack>
            {needsMeeting && (
              <Notice tone="critical" title="Första mötet är inte bokat">
                <Stack gap="sm">
                  <div>
                    Mötet ska hållas {card.firstMeeting.withinText}. {card.firstMeeting.sla && <SlaBadge sla={card.firstMeeting.sla} dueAt={card.firstMeeting.dueAt} />}
                  </div>
                  {card.manage && (
                    <div>
                      {/* Sekundär här: den primära "Boka första möte" ligger i åtgärdsraden i huvudet. */}
                      <Button kind="secondary" icon="calendar" onClick={() => openModal("meeting")}>
                        Boka första möte
                      </Button>
                    </div>
                  )}
                </Stack>
              </Notice>
            )}
            {card.start && (
              <Notice tone="info" icon="play" title={dayOf(card.start.firstMeetingAt) <= today ? "Första mötet har hållits – starta insatsen" : "Nästa steg efter första mötet: starta insatsen"}>
                <Stack gap="sm">
                  <div>
                    Första mötet {fmtDateTimeLong(card.start.firstMeetingAt)}. När insatsen startar blir ärendet Pågår, tillfällena skapas enligt veckoplanen och närvaron kan registreras.
                  </div>
                  <div>
                    <Button kind="primary" icon="play" onClick={() => openModal("start")}>
                      Starta insatsen
                    </Button>
                  </div>
                </Stack>
              </Notice>
            )}
            <Grid>
              <Card title="Nästa möte" icon="calendar">
                {nm ? (
                  <Stack gap="sm">
                    <div className="text-h3 font-bold">{dayOf(nm.startsAt) === today ? `I dag kl. ${fmtTime(nm.startsAt)}` : cap(fmtDateTimeLong(nm.startsAt))}</div>
                    <div className="text-small text-text-muted">
                      {relative(nm.startsAt, now)} · {nm.first ? "Första mötet" : "Coachmöte"} · {nm.location}
                    </div>
                  </Stack>
                ) : (
                  <p className="text-text-muted">{o.closed ? "Insatsen är avslutad." : "Inget möte bokat."}</p>
                )}
              </Card>
              {!team && (
                <Card title="Senaste möte" icon="check-square">
                  {lc ? (
                    <Stack gap="sm">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Status value={lc.overallStatus} />
                      </div>
                      <div className="text-small text-text-muted">
                        {cap(fmtWeekday(lc.heldAt))} · {lc.mode ? MODE[lc.mode] || lc.mode : "–"} · veckomål: {(lc.goalStatus && GOAL[lc.goalStatus]) || "Ej angivet"}
                      </div>
                      {lc.nextGoal && (
                        <div>
                          <span className="text-small text-text-muted">Nästa mål:</span> {lc.nextGoal}
                        </div>
                      )}
                      {lc.note && <div className="text-small">{clip(lc.note, 140)}</div>}
                    </Stack>
                  ) : (
                    <p className="text-text-muted">Ingen godkänd mötesrapport ännu.</p>
                  )}
                  {o.drafts.count > 0 && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone="outline" icon="edit">{plural(o.drafts.count, "utkast", "utkast")} att granska</Badge>
                      {o.drafts.ai && <AiTag>Utkast från AI</AiTag>}
                    </div>
                  )}
                </Card>
              )}
              <Card title={`Närvaro ${o.weeksLabel}`} icon="activity">
                {ast.planned - ast.unregistered > 0 ? (
                  <Stack gap="sm">
                    <div className="text-[1.75rem] leading-[1.1] font-extrabold tabular-nums">{pct0(ast.rate)}</div>
                    <Meter value={ast.rate || 0} max={1} label={`Närvarograd ${pct0(ast.rate)}`} />
                    <div className="text-small text-text-muted">
                      {ast.present + ast.late} av {ast.planned - ast.unregistered} tillfällen · {ast.absentInvalid} ogiltig frånvaro
                      {ast.unregistered > 0 ? ` · ${ast.unregistered} saknar registrering` : ""}
                    </div>
                  </Stack>
                ) : (
                  <p className="text-text-muted">{ast.unregistered > 0 ? `${ast.unregistered} tillfällen saknar registrering.` : "Inga tillfällen under perioden."}</p>
                )}
                <div className="mt-2">
                  <Button kind="ghost" iconRight="arrow-right" className="whitespace-normal" onClick={() => setTab("narvaro")}>
                    Visa närvaro per vecka
                  </Button>
                </div>
              </Card>
            </Grid>
            <div className={team && alerts.length === 0 ? "flex flex-col gap-4" : "grid grid-cols-2 items-start gap-5 max-[980px]:grid-cols-1 [&>*]:min-w-0"}>
              {(!team || alerts.length > 0) && (
                <Card title="Flaggor för ärendet" icon="flag" flush>
                  {alerts.length === 0 ? (
                    <div className="px-[18px] py-4">
                      <p className="text-text-muted">Inga flaggor för din roll just nu.</p>
                    </div>
                  ) : (
                    <List>
                      {alerts.map((a) => {
                        const s = SEV[a.severity] ?? SEV.info;
                        const link = a.sameCase ? (
                          a.sameCase.tab ? (
                            <Button kind="ghost" iconRight="arrow-right" onClick={() => setTab(a.sameCase!.tab as never)}>Visa</Button>
                          ) : null
                        ) : canOpen(a.view, role) ? (
                          <Button kind="ghost" iconRight="arrow-right" to={a.href}>Öppna</Button>
                        ) : null;
                        return (
                          <ListItem key={a.key} side={link ?? undefined}>
                            <span className="flex flex-wrap items-center gap-1.5">
                              <Badge tone={s.tone} icon={s.icon}>{s.label}</Badge>
                              <span className="font-bold">{a.title}</span>
                            </span>
                            <span className="text-small">{a.text}</span>
                          </ListItem>
                        );
                      })}
                    </List>
                  )}
                </Card>
              )}
              <Card title={team ? "Kommande moment och praktikdagar" : "Kommande 14 dagar"} icon="clock">
                <ActList acts={o.upcoming.slice(0, 8)} empty="Inga planerade tillfällen de närmaste två veckorna." />
                {o.upcoming.length > 8 && <p className="mt-2 text-small text-text-muted">och {o.upcoming.length - 8} till.</p>}
              </Card>
            </div>
            {pl && (
              <Card
                title="Pågående praktik"
                icon="briefcase"
                actions={
                  <Button kind="ghost" iconRight="arrow-right" onClick={() => setTab("praktik")}>
                    Visa praktiken
                  </Button>
                }
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-bold">{pl.employerName ?? "Arbetsgivare"}</span>
                  <span className="text-small text-text-muted">
                    {fd(pl.startsOn, today)} – {fd(pl.endsOn, today)} · handledare {pl.supervisorName}
                  </span>
                </div>
                <FourBadges rights={pl.fourRights} className="mt-2" />
              </Card>
            )}
            {/* Beställningens bakgrund och bilagor – bara med full åtkomst (samordnare, avtalsansvarig, huvudcoach). */}
            {card.background && <CaseBackgroundCard bg={card.background} title="Bakgrund från beställningen" />}
          </Stack>
        );
      }}
    </TabQuery>
  );
}

// ---------------------------------------------------------------- Kartläggning
export function TabKartlaggning({ card }: TabProps) {
  const q = useQuery(caseIntake, { caseId: card.caseId });
  const role = useSession().actor.role;
  const can = canOpen("coach.kartlaggning", role);
  return (
    <TabQuery q={q}>
      {({ intake: ia, stuck }) => {
        const link = can && (
          <Button kind={ia && ia.approved ? "secondary" : "primary"} iconRight="arrow-right" to={caseLink("/kartlaggning", card.caseId)}>
            {!ia ? "Påbörja kartläggningen" : ia.approved || !card.edit ? "Öppna kartläggningen" : "Fortsätt kartläggningen"}
          </Button>
        );
        if (!ia) {
          return (
            <Card>
              <Empty icon="clipboard" title="Kartläggningen är inte påbörjad" action={card.edit && link}>
                Kartläggningen görs vecka 1. Den dokumenterar den reella kompetensen och är underlag för validering, matchning och CV.
              </Empty>
            </Card>
          );
        }
        const v = (x: string) => x || "Framgår inte";
        const inPhase1 = stuck && stuck.phase === 1;
        return (
          <Stack>
            {!ia.approved && (
              <Notice tone={inPhase1 ? "warn" : "info"} title="Kartläggningen är inte godkänd">
                {inPhase1 ? `Ärendet har varit i fas 1 i ${stuck.days} dagar (gräns ${stuck.maxDays}). ` : ""}Uppgifterna används i rapporter först när kartläggningen är godkänd.
              </Notice>
            )}
            <Card
              title="Kartläggning vecka 1"
              icon="clipboard"
              actions={ia.approved ? <Badge tone="blue" icon="check">Godkänd</Badge> : <Badge tone="outline" icon="edit">Utkast</Badge>}
              foot={
                <>
                  <span className="text-small text-text-muted">
                    {ia.approved ? `Godkänd ${fmtDateTime(ia.approvedAt)} av ${ia.approvedByName ?? "–"}` : "Sparad som utkast"}
                  </span>
                  <Spacer />
                  {link}
                </>
              }
            >
              <Kv
                items={[
                  ["Arbetslivserfarenhet", v(ia.workExperience)], ["Utbildning", v(ia.education)], ["Språk", v(ia.languageNotes)], ["Digital vana", v(ia.digitalSkills)],
                  ["Körkort", v(ia.drivingLicence)], ["Yrkesmål", v(ia.workGoals)], ["Valt yrkesspår", ia.chosenTrack || "Inte valt ännu"],
                  ["Behov av anpassning", ia.adaptations || "Inga behov angivna"], ["Första veckomål", v(ia.firstWeekGoal)],
                ]}
              />
            </Card>
            <p className="text-text-muted">Behov av anpassning beskrivs funktionellt – vad som behövs i vardagen – aldrig som diagnos.</p>
          </Stack>
        );
      }}
    </TabQuery>
  );
}

// ---------------------------------------------------------------- Avstämningar
export function TabAvstamningar({ card }: TabProps) {
  const q = useQuery(caseCheckIns, { caseId: card.caseId });
  const role = useSession().actor.role;
  const [n, setN] = useState(12);
  const can = canOpen("coach.avstamning", role);
  const today = dayOf(card.now);
  return (
    <TabQuery q={q}>
      {({ checkIns: list }) => {
        const drafts = list.filter((x) => !x.approved);
        const cols: Column<CaseCheckInRow>[] = [
          { key: "heldAt", label: "Datum", nowrap: true, render: (x) => <><span className="font-bold">{fd(x.heldAt, today)}</span><div className="text-small text-text-muted">{fmtWeek(x.heldAt)} · kl. {fmtTime(x.heldAt)}</div></> },
          { key: "mode", label: "Form", render: (x) => (x.mode ? MODE[x.mode] : "–") || "–" },
          { key: "goal", label: "Veckomål", render: (x) => (x.approved ? (x.goalStatus && GOAL[x.goalStatus]) || "–" : "–") },
          { key: "phase", label: "Fas", nowrap: true, render: (x) => (x.approved && x.phase ? `Fas ${x.phase}` : "–") },
          { key: "overall", label: "Samlad status", render: (x) => (x.approved ? <Status value={x.overallStatus} short /> : <Status value={null} />) },
          { key: "obst", label: "Hinder", render: (x) => (x.obstacles.length ? x.obstacles.join(", ") : "–") },
          { key: "note", label: "Anteckning", render: (x) => (x.approved ? <span className="text-small">{clip(x.note, 80) || "–"}</span> : <span className="text-small text-text-muted">Granskas av coachen</span>) },
          { key: "st", label: "Status", render: (x) => <StatusCell x={x} /> },
        ];
        const open = can ? (x: CaseCheckInRow) => path(`/avstamning/${encodeURIComponent(card.caseId)}`, { avstamning: x.id }) : null;
        return (
          <Stack>
            {drafts.length > 0 && (
              <Notice tone="info" title={`${plural(drafts.length, "utkast", "utkast")} väntar på granskning`}>
                Utkast används inte i rapporter. Rapporter byggs bara av godkända mötesrapporter. AI-förslag sätter aldrig samlad status – coachen väljer.
              </Notice>
            )}
            <Card
              flush
              title={`Möten (${list.length})`}
              icon="check-square"
              actions={card.edit && can && card.status === "active" && <Button kind="primary" icon="mic" to={caseLink("/avstamning", card.caseId, { spela: "1" })}>Spela in mötet</Button>}
              foot={
                list.length > n && (
                  <>
                    <span className="text-small text-text-muted">Visar {n} av {list.length}</span>
                    <Spacer />
                    <Button icon="chevron-down" onClick={() => setN(list.length)}>Visa alla</Button>
                  </>
                )
              }
            >
              <NavTable
                columns={cols}
                rows={list.slice(0, n)}
                rowAttrs={(x) => ({ "data-mal": `ci:${x.id}` })}
                caption="Möten"
                empty="Inga möten ännu."
                to={open}
                mobile={(x) => (
                  <>
                    <LiMain>
                      <LiTitle>{fd(x.heldAt, today)} · {(x.mode && MODE[x.mode]) || "Form saknas"}</LiTitle>
                      <LiSub>
                        {fmtWeek(x.heldAt)} · kl. {fmtTime(x.heldAt)}
                        {x.approved ? ` · veckomål ${String((x.goalStatus && GOAL[x.goalStatus]) || "–").toLowerCase()}${x.phase ? ` · fas ${x.phase}` : ""}` : ""}
                      </LiSub>
                      {x.obstacles.length > 0 && <span className="text-small">Hinder: {x.obstacles.join(", ")}</span>}
                      <span>{x.approved ? <span className="text-small">{clip(x.note, 80) || "–"}</span> : <span className="text-small text-text-muted">Granskas av coachen</span>}</span>
                      <StatusCell x={x} />
                    </LiMain>
                    <LiSide>{x.approved ? <Status value={x.overallStatus} short /> : <Status value={null} />}</LiSide>
                  </>
                )}
              />
            </Card>
          </Stack>
        );
      }}
    </TabQuery>
  );
}

function StatusCell({ x }: { x: CaseCheckInRow }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {x.approved ? <Badge tone="blue" icon="check">Godkänd</Badge> : <Badge tone="outline" icon="edit">Utkast</Badge>}
      {x.ai && !x.approved && <AiTag>Utkast från AI</AiTag>}
    </div>
  );
}

// ---------------------------------------------------------------- Närvaro
export function TabNarvaro({ card, setTab, openModal }: TabProps) {
  const q = useQuery(caseAttendance, { caseId: card.caseId });
  const role = useSession().actor.role;
  const team = card.access === "team";
  const today = dayOf(card.now);
  const canReg = (card.edit || team) && canOpen("coach.narvaro", role) && card.status === "active";
  const running = card.status === "active" || card.status === "paused";
  // Veckoplanen ändras av den som får ändra i ärendet; enstaka tillfällen av alla som arbetar i det (även teamet).
  const canPlan = card.edit && running;
  const canEditActivities = (card.edit || team) && running;
  return (
    <TabQuery q={q}>
      {(a: CaseAttendance) => {
        if (!a.started) {
          return (
            <Card>
              <Empty
                icon="calendar"
                title="Insatsen har inte startat"
                action={card.start ? <Button kind="primary" icon="play" onClick={() => openModal("start")}>Starta insatsen</Button> : undefined}
              >
                {card.start
                  ? "Starta insatsen efter första mötet – då skapas tillfällena enligt veckoplanen och närvaron kan registreras."
                  : card.status === "confirmed"
                    ? "Insatsen startas när första mötet är bokat och hållet."
                    : "Närvaro registreras från första mötet."}
              </Empty>
            </Card>
          );
        }
        const total = a.total;
        const s4 = a.last4;
        const cols: Column<CaseAttendanceWeek>[] = [
          { key: "w", label: "Vecka", nowrap: true, render: (w) => <><span className="font-bold">{fmtWeekKey(w.key)}</span><div className="text-small text-text-muted">{fmtWeekRange(w.key)}</div></> },
          { key: "p", label: "Tillfällen", num: true, render: (w) => (w.paused ? <Badge tone="grey" icon="pause">Pausad</Badge> : <>{w.stats.planned}{w.future > 0 && <div className="text-small text-text-muted">+{w.future} kommande</div>}</>) },
          { key: "n", label: "Närvarande", num: true, render: (w) => (w.paused ? "–" : w.stats.present) },
          { key: "l", label: "Sen", num: true, render: (w) => (w.paused ? "–" : w.stats.late) },
          { key: "g", label: "Giltig frånvaro", num: true, render: (w) => (w.paused ? "–" : w.stats.absentValid) },
          { key: "o", label: "Ogiltig frånvaro", num: true, render: (w) => (w.paused ? "–" : w.stats.absentInvalid > 0 ? <span className="font-bold">{w.stats.absentInvalid}</span> : 0) },
          { key: "u", label: "Saknar registrering", num: true, render: (w) => (w.paused ? "–" : w.stats.unregistered > 0 ? <Badge tone="outline" icon="help">{w.stats.unregistered}</Badge> : 0) },
          { key: "r", label: "Närvarograd", num: true, render: (w) => (w.paused ? <span className="text-small text-text-muted">Debiteras inte</span> : w.stats.rate == null ? "–" : <span className="font-bold">{pct0(w.stats.rate)}</span>) },
        ];
        return (
          <Stack>
            {a.repeated && (
              <Notice tone="critical" title="Upprepad ogiltig frånvaro">
                <Stack gap="sm">
                  <div>
                    {a.repeated.dates.length} ogiltiga frånvarotillfällen inom {a.repeated.withinDays} dagar ({a.repeated.dates.map((x) => fd(x, today)).join(", ")}). Avtalets regel:{" "}
                    {a.repeated.absentInvalid} tillfällen inom {a.repeated.withinDays} dagar. Förslag: åtgärdsplan och uppföljningsmöte med handläggaren.
                  </div>
                  {!team && (
                    <div>
                      <Button icon="flag" onClick={() => setTab("avvikelser")}>Gå till avvikelser</Button>
                    </div>
                  )}
                </Stack>
              </Notice>
            )}
            <KpiRow>
              <Kpi label="Närvarograd hela insatsen" value={pct0(total.rate)} sub={`${total.present + total.late} av ${total.planned - total.unregistered} registrerade tillfällen`} />
              <Kpi label={`Närvarograd ${a.weeksLabel}`} value={pct0(s4.rate)} sub={`${s4.present + s4.late} av ${s4.planned - s4.unregistered} tillfällen`} />
              <Kpi label="Ogiltig frånvaro" value={total.absentInvalid} sub="tillfällen under insatsen" tone={a.repeated ? "alert" : undefined} />
              <Kpi
                label="Saknar registrering"
                value={total.unregistered}
                sub={total.unregistered > 0 ? (a.registerBy ? `registrera senast ${a.registerBy}` : "registrera så snart som möjligt") : "allt är registrerat"}
                tone={total.unregistered > 0 ? "watch" : undefined}
              />
            </KpiRow>
            {total.reasons.length > 0 && (
              <p>
                <span className="font-bold">Skäl till giltig frånvaro:</span> {total.reasons.map(([r, n]) => `${r} (${n})`).join(" · ")}
              </p>
            )}
            <Card
              flush
              title="Närvaro per vecka"
              icon="calendar"
              actions={
                <>
                  {canReg && <Button kind="primary" icon="check-square" to="/narvaro">Registrera närvaro</Button>}
                  {canPlan && <Button icon="calendar" onClick={() => openModal("plan")}>Ändra veckoplan</Button>}
                  {canEditActivities && <Button icon="plus" onClick={() => openModal("activity")}>Lägg till tillfälle</Button>}
                </>
              }
            >
              <RespTable
                columns={cols}
                rows={a.weeks}
                rowKey="key"
                rowAttrs={(w) => ({ "data-mal": `att:${w.key}` })}
                caption="Närvaro per vecka"
                empty="Inga veckor ännu."
                rowTone={(w) => (w.paused ? "muted" : w.stats.absentInvalid > 0 ? "alert" : null)}
                mobile={(w) => (
                  <MItem>
                    <LiMain>
                      <LiTitle>{fmtWeekKey(w.key)}</LiTitle>
                      <LiSub>{fmtWeekRange(w.key)}</LiSub>
                      {w.paused ? (
                        <span><Badge tone="grey" icon="pause">Pausad – debiteras inte</Badge></span>
                      ) : (
                        <>
                          <span className="text-small">
                            {plural(w.stats.planned, "tillfälle", "tillfällen")}
                            {w.future > 0 ? ` (+${w.future} kommande)` : ""} · närvarande {w.stats.present} · sen {w.stats.late} · giltig frånvaro {w.stats.absentValid}
                          </span>
                          {(w.stats.absentInvalid > 0 || w.stats.unregistered > 0) && (
                            <span className="flex flex-wrap gap-1.5">
                              {w.stats.absentInvalid > 0 && <Badge tone="red" icon="x-circle">{w.stats.absentInvalid} ogiltig frånvaro</Badge>}
                              {w.stats.unregistered > 0 && <Badge tone="outline" icon="help">{w.stats.unregistered} saknar registrering</Badge>}
                            </span>
                          )}
                        </>
                      )}
                    </LiMain>
                    <LiSide>
                      {!w.paused && w.stats.rate != null && (
                        <>
                          <span className="font-bold">{pct0(w.stats.rate)}</span>
                          <span className="text-small text-text-muted">närvaro</span>
                        </>
                      )}
                    </LiSide>
                  </MItem>
                )}
              />
            </Card>
            <Card flush title="Senaste tillfällen" icon="list">
              <RespTable
                size="sm"
                caption="Senaste tillfällen"
                empty="Inga tillfällen ännu."
                rows={a.past}
                columns={[
                  { key: "d", label: "Tid", nowrap: true, render: (x) => <>{cap(fmtWeekday(x.startsAt))}<div className="text-small text-text-muted">kl. {fmtTime(x.startsAt)}</div></> },
                  { key: "k", label: "Tillfälle", render: (x) => <><span className="inline-flex items-center gap-1.5"><Icon name={actIcon(x.kind)} />{actLabel(x.kind)}</span><div className="text-small text-text-muted">{x.location}</div></> },
                  { key: "s", label: "Närvaro", render: (x) => <AttBadge status={x.attendance?.status} /> },
                  { key: "r", label: "Skäl", render: (x) => x.attendance?.reason || "–" },
                ]}
                mobile={(x) => (
                  <MItem>
                    <Icon name={actIcon(x.kind)} />
                    <LiMain>
                      <LiTitle>{cap(fmtWeekday(x.startsAt))} kl. {fmtTime(x.startsAt)}</LiTitle>
                      <LiSub>{actLabel(x.kind)} · {x.location}</LiSub>
                      <span><AttBadge status={x.attendance?.status} /></span>
                      {x.attendance?.reason && <span className="text-small">Skäl: {x.attendance.reason}</span>}
                    </LiMain>
                  </MItem>
                )}
              />
            </Card>
            <UpcomingList rows={a.upcoming} canEdit={canEditActivities} />
          </Stack>
        );
      }}
    </TabQuery>
  );
}

/** Kommande tillfällen – kan tas bort tills närvaro registrerats (beslut 2026-10-08). */
function UpcomingList({ rows, canEdit }: { rows: CaseAttendance["upcoming"]; canEdit: boolean }) {
  const remove = useCommand(activityRemove);
  const confirm = useConfirm();
  const onRemove = async (a: CaseAttendance["upcoming"][number]) => {
    const ok = await confirm({
      title: "Ta bort tillfället?",
      body: `${actLabel(a.kind)} ${fmtDateTimeLong(a.startsAt)} tas bort. Bara tillfällen utan registrerad närvaro kan tas bort.`,
      confirmLabel: "Ta bort",
      cancelLabel: "Avbryt",
      tone: "danger",
    });
    if (!ok) return;
    const res = await remove.run({ activityId: a.id }).catch(() => null);
    if (!res || !res.ok) toast(res && !res.ok && res.message ? res.message : "Tillfället kunde inte tas bort.", "error");
    else toast("Tillfället är borttaget.");
  };
  return (
    <Card flush title="Kommande tillfällen" icon="calendar">
      {rows.length === 0 ? (
        <Empty icon="calendar" title="Inga kommande tillfällen" />
      ) : (
        <List>
          {rows.map((a) => (
            <ListItem
              key={a.id}
              icon={actIcon(a.kind)}
              title={cap(fmtDateTimeLong(a.startsAt))}
              sub={`${actLabel(a.kind)} · ${a.location} · ${a.durationMin} min`}
              side={canEdit ? <Button kind="ghost" icon="trash" pending={remove.pending} onClick={() => void onRemove(a)}>Ta bort</Button> : undefined}
            />
          ))}
        </List>
      )}
    </Card>
  );
}
