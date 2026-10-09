"use client";
// Min vecka för handledaren (beslut 2026-10-06) i coachens stil (src/ui/vecka.tsx): närvaro att registrera, dagens
// tillfällen, kommande sju dagar och praktikplatser att följa upp. Översikten från /handledare har flyttat hit; listan
// "Mina tilldelade ärenden" finns kvar på /handledare. Frågor som handledaren redan har: arenden.handledare och coach.narvaro
// (hanterarna filtrerar på teamet – alla ärenden i avtalet är läsbara sedan 2026-10-09, aldrig skyddade utan namngiven coach) samt notiser.list.
import { useState } from "react";
import { dayOf, fmtTime, fmtWeek, fmtWeekday, relative } from "@/core/time";
import { AttBadge, dayLabel, kindOf, lc } from "@/features/coach/screens/shared";
import { narvaroView, type NarvaroRow, type NarvaroView } from "@/features/coach/api";
import { UnreadNotices } from "@/features/notiser/screens/olasta";
import { useQuery } from "@/shell/backend";
import {
  Badge, Button, Card, CaseName, cn, DoneLine, ErrorNotice, focusSection, Icon, Kpi, List, ListItem, Loading, Row, SlaText, Split, Stack, WEEK_KPI_SM, WeekKpis, WeekPage,
} from "@/ui";
import { supervisorStart, type SupervisorStart } from "../api";
import { actIcon, actLabel, cap, plural } from "./common";

export function HandledareMinVeckaScreen() {
  const s = useQuery(supervisorStart, {});
  const n = useQuery(narvaroView, {});
  const err = s.error ?? n.error;
  return (
    <WeekPage
      today={n.data ? dayOf(n.data.now) : null}
      actions={
        <Button kind="primary" icon="check-square" to="/narvaro">
          Registrera närvaro
        </Button>
      }
    >
      {err ? (
        <ErrorNotice
          error={err}
          onRetry={() => {
            void s.refetch();
            void n.refetch();
          }}
        />
      ) : !s.data || !n.data ? (
        <Loading />
      ) : (
        <Week m={s.data} v={n.data} />
      )}
    </WeekPage>
  );
}

/** Förra veckans tillfällen utan närvaro, per ärende (samma räkning som Närvaro: passerade och inte registrerade). */
function openByCase(rows: NarvaroRow[], now: string) {
  const open = rows.filter((r) => r.startsAt < now && !r.attendance);
  const by = new Map<string, { caseId: string; caseNumber: string; name: string; items: NarvaroRow[] }>();
  for (const r of open) {
    const g = by.get(r.caseId) ?? { caseId: r.caseId, caseNumber: r.caseNumber, name: r.name, items: [] };
    g.items.push(r);
    by.set(r.caseId, g);
  }
  return { count: open.length, byCase: [...by.values()] };
}

function Week({ m, v }: { m: SupervisorStart; v: NarvaroView }) {
  const [showAllUp, setShowAllUp] = useState(false);
  const now = v.now;
  const today = dayOf(now);
  const last = v.weeks.last;
  const unreg = openByCase(last.rows, now);
  const regTone = last.sla.tone;
  // Dagens yrkesmoment och praktikdagar – samma slags tillfällen som Kommande sju dagar (coachträffarna hör till coachen).
  const todays = v.weeks.this.rows.filter((r) => dayOf(r.startsAt) === today && r.kind !== "möte");
  const next = todays.find((r) => r.startsAt >= now) ?? null;
  const g = m.groups;
  const up = showAllUp ? m.upcoming : m.upcoming.slice(0, 8);
  const week = fmtWeek(m.today);

  return (
    <>
      <WeekKpis>
        <Kpi
          className={WEEK_KPI_SM}
          onClick={() => focusSection("mv-narvaro")}
          actionHint="Visa"
          label="Närvaro att registrera"
          value={String(unreg.count)}
          tone={unreg.count > 0 && (regTone === "urgent" || regTone === "over") ? "alert" : undefined}
          sub={unreg.count > 0 ? `Vecka ${last.no} · senast ${v.dueText} · ${last.sla.label.toLowerCase()}` : `Vecka ${last.no} är klar`}
        />
        <Kpi
          className={WEEK_KPI_SM}
          onClick={() => focusSection("mv-idag")}
          actionHint="Visa"
          label="Tillfällen i dag"
          value={String(todays.length)}
          sub={next ? `Nästa ${fmtTime(next.startsAt)}: ${lc(kindOf(next.kind).label)} med ${next.name}` : todays.length ? "Inga fler tillfällen i dag" : "Inga yrkesmoment eller praktikdagar i dag"}
        />
        {/* Ett tal med en enhet (yrkesmomenten); praktikdagarna i undertexten – samma två tal som den gamla översikten. */}
        <Kpi
          className={WEEK_KPI_SM}
          onClick={() => focusSection("mv-kommande")}
          actionHint="Visa"
          label="Yrkesmoment den här veckan"
          value={String(m.vocationalMoments)}
          sub={`${plural(m.practiceDays, "praktikdag", "praktikdagar")} · ${week}`}
        />
        <Kpi
          className={WEEK_KPI_SM}
          onClick={() => focusSection("mv-praktik")}
          actionHint="Visa"
          label="Praktik som saknar något av de fyra rätten"
          value={String(m.missingFour.length)}
          tone={m.missingFour.length ? "watch" : undefined}
          sub={m.missingFour.length ? "Komplettera före nästa uppföljning" : "Alla praktikplatser är kompletta"}
        />
      </WeekKpis>

      <Split wide>
        <Stack>
          {unreg.count === 0 ? (
            <DoneLine id="mv-narvaro" title={`Närvaro – vecka ${last.no}`} icon="check-square">
              Allt är registrerat för vecka {last.no}.
            </DoneLine>
          ) : (
            <Card
              id="mv-narvaro"
              title={`Närvaro att registrera – vecka ${last.no}`}
              icon="check-square"
              tone="red"
              actions={<SlaText sla={last.sla} dueAt={last.dueAt} dueText={v.dueText} />}
            >
              <Stack>
                <p>
                  <b>{plural(unreg.count, "tillfälle", "tillfällen")}</b> från förra veckan saknar närvaro. Registrera senast <b>{v.dueText}</b>. Veckorapporten till handläggaren
                  publiceras automatiskt när alla deltagare är registrerade, senast {v.pubText}.
                </p>
                <List className="rounded-mb border border-ljusgra">
                  {unreg.byCase.map((r) => (
                    <ListItem
                      key={r.caseId}
                      title={<CaseName caseId={r.caseId} name={r.name} caseNumber={r.caseNumber} />}
                      sub={r.items.map((x) => `${dayLabel(dayOf(x.startsAt))} ${lc(kindOf(x.kind).label)}`).join(" · ")}
                      side={<Badge tone="outline">{r.items.length} kvar</Badge>}
                    />
                  ))}
                </List>
                <Row>
                  <Button kind="primary" icon="check-square" to="/narvaro?vecka=forra">
                    Registrera närvaro för vecka {last.no}
                  </Button>
                </Row>
              </Stack>
            </Card>
          )}

          {todays.length === 0 ? (
            <DoneLine id="mv-idag" title={`I dag – ${fmtWeekday(today)}`} icon="calendar">
              Inga yrkesmoment eller praktikdagar i dag.
            </DoneLine>
          ) : (
            <Card id="mv-idag" title={`I dag – ${fmtWeekday(today)}`} icon="calendar" flush>
              <List>
                {todays.map((a) => {
                  const past = a.startsAt < now;
                  const isNext = next?.activityId === a.activityId;
                  return (
                    <div
                      key={a.activityId}
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
                          <CaseName caseId={a.caseId} name={a.name} caseNumber={a.caseNumber} />
                        </div>
                        <div className="text-small text-text-muted">
                          {kindOf(a.kind).label} · {a.location}
                        </div>
                        {/* Nästa tillfälle: text och ikon, inte bara den röda kanten (som coachens Min vecka). */}
                        {(isNext || past) && (
                          <Row gap="sm">
                            {isNext && (
                              <Badge tone="dark" icon="clock">
                                Nästa · {relative(a.startsAt, now)}
                              </Badge>
                            )}
                            {past && <AttBadge at={a.attendance} />}
                          </Row>
                        )}
                      </div>
                      {past && !a.attendance && (
                        <div className="flex flex-none flex-col items-end gap-1 max-[620px]:basis-full max-[620px]:flex-row max-[620px]:pl-[76px]">
                          <Button kind="secondary" to={`/narvaro?vecka=denna&arende=${encodeURIComponent(a.caseId)}`}>
                            Registrera
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </List>
            </Card>
          )}

          {m.upcoming.length === 0 ? (
            <DoneLine id="mv-kommande" title="Kommande sju dagar" icon="calendar">
              Inga moment eller praktikdagar de närmaste sju dagarna.
            </DoneLine>
          ) : (
            <Card
              id="mv-kommande"
              title="Kommande sju dagar"
              icon="calendar"
              flush
              foot={
                m.upcoming.length > 8 ? (
                  <Button kind="ghost" icon={showAllUp ? "chevron-up" : "chevron-down"} onClick={() => setShowAllUp(!showAllUp)}>
                    {showAllUp ? "Visa färre" : `Visa alla ${m.upcoming.length}`}
                  </Button>
                ) : undefined
              }
            >
              <List>
                {up.map((a) => (
                  <ListItem
                    key={a.id}
                    icon={actIcon(a.kind)}
                    title={`${cap(fmtWeekday(a.startsAt))} kl. ${fmtTime(a.startsAt)} · ${actLabel(a.kind)}`}
                    sub={`${a.displayName} · ${a.caseNumber} · ${a.location}`}
                    to={`/arenden/${encodeURIComponent(a.caseId)}`}
                  />
                ))}
              </List>
            </Card>
          )}
        </Stack>

        <Stack>
          {m.missingFour.length === 0 ? (
            <DoneLine id="mv-praktik" title="Praktikplatser att komplettera" icon="briefcase">
              Alla pågående praktikplatser är kompletta (rätt arbetsuppgifter, handledning, tidpunkt och uppföljning).
            </DoneLine>
          ) : (
            <Card id="mv-praktik" title="Praktikplatser att komplettera" icon="briefcase" flush>
              <List>
                {m.missingFour.map((x) => (
                  <ListItem
                    key={x.caseId}
                    lead={<Icon name="alert-circle" className="mt-0.5" />}
                    title={x.employerName ?? "Praktikplats"}
                    sub={`${x.displayName} · ${x.caseNumber}`}
                    to={`/arenden/${encodeURIComponent(x.caseId)}?flik=praktik`}
                  >
                    <span>Saknas: {x.missing.join(", ")}</span>
                  </ListItem>
                ))}
              </List>
            </Card>
          )}

          <Card
            title="Mina tilldelade ärenden"
            icon="list"
            actions={
              <Button kind="secondary" iconRight="arrow-right" to="/handledare">
                Öppna listan
              </Button>
            }
          >
            <Stack gap="sm">
              <p>
                <b>{g.pagaende.length} pågående</b> · {g.start.length} väntar på start · {g.avslutade.length} avslutade
              </p>
              <p className="text-text-muted">Listan visar ärenden där du ingår i teamet. Alla ärenden i avtalet finns under Ärenden.</p>
            </Stack>
          </Card>

          <UnreadNotices />
        </Stack>
      </Split>
    </>
  );
}
