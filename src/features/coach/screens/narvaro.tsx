"use client";
// Närvaro (/narvaro?vecka=forra|denna) – snabbregistrering med ett klick per tillfälle. Veckorapporten till handläggaren
// publiceras automatiskt när alla hennes deltagare är registrerade. Coach (egna ärenden) och handledare (teamärenden).
// Port av prototypens coach.narvaro och åtgärden coach.attendanceSet.
import { useState } from "react";
import { plural } from "@/core/format";
import { addDays, dayOf, fmtDateTime, fmtDateTimeLong, fmtTime, fmtWeekday, isWorkingDay, weekday, WEEKDAYS_SHORT, type LocalDate } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import type { ScreenProps } from "@/shell/routes";
import { useSession } from "@/shell/session";
import { Badge, Button, Card, cn, Empty, Notice, Page, Row, Seg, SlaBadge, Split, Stack, toast } from "@/ui";
import { attendanceSet, narvaroView, type NarvaroRow, type NarvaroView } from "../api";
import { ATT_OPTIONS, AttBadge, dayLabel, kindOf, MIN_VECKA_CRUMB, PageState, Persp } from "./shared";

type Week = "last" | "this";
type Show = "open" | "all";
type AttStatus = "present" | "late" | "absent_valid" | "absent_invalid";

export function NarvaroScreen({ query }: ScreenProps) {
  const q = useQuery(narvaroView, {});
  if (!q.data) return <PageState title="Närvaro" error={q.error} onRetry={() => void q.refetch()} />;
  const v = q.data;
  const param = query.get("vecka");
  const initial: Week = param === "forra" ? "last" : param === "denna" ? "this" : openOf(v, "last").length ? "last" : "this";
  return <Narvaro v={v} initial={initial} />;
}

const openOf = (v: NarvaroView, w: Week) => v.weeks[w].rows.filter((a) => a.startsAt < v.now && !a.attendance);

function Narvaro({ v, initial }: { v: NarvaroView; initial: Week }) {
  const { actor } = useSession();
  const role = actor.role;
  const set = useCommand(attendanceSet);
  const now = v.now;
  const today = dayOf(now);
  const defaultDay = (w: Week): string => (w === "this" && isWorkingDay(today) ? today : "all");
  const [week, setWeekRaw] = useState<Week>(initial);
  const [day, setDay] = useState<string>(() => defaultDay(initial));
  const [show, setShow] = useState<Show>(() => (openOf(v, initial).length > 0 ? "open" : "all"));
  const [pending, setPending] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, true>>({});
  const setWeek = (w: Week) => {
    setWeekRaw(w);
    setDay(defaultDay(w));
    setPending(null);
    setShow(openOf(v, w).length > 0 ? "open" : "all");
  };

  const wk = v.weeks[week];
  const mon = wk.mon;
  const all = wk.rows;
  const open = openOf(v, week);
  const passed = all.filter((a) => a.startsAt < now);
  const visible = all.filter((a) => (day === "all" || dayOf(a.startsAt) === day) && (show === "all" || (a.startsAt < now && !a.attendance) || touched[a.activityId]));
  const byDay = new Map<string, NarvaroRow[]>();
  for (const a of visible) byDay.set(dayOf(a.startsAt), [...(byDay.get(dayOf(a.startsAt)) ?? []), a]);
  const lastOpen = openOf(v, "last").length;

  const register = async (a: NarvaroRow, status: AttStatus, reason = "") => {
    setTouched((t) => ({ ...t, [a.activityId]: true }));
    setPending(null);
    const res = await set.run({ activityId: a.activityId, status, reason }).catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Närvaron kunde inte sparas.", "error");
      return;
    }
    if (res.published) toast(res.published.text);
  };
  const pick = (a: NarvaroRow, s: AttStatus) => {
    if (s === "absent_valid") setPending(a.activityId);
    else void register(a, s);
  };

  const dayOptions = [
    { value: "all", label: `Hela veckan${open.length ? ` (${open.length} kvar)` : ""}` },
    ...[0, 1, 2, 3, 4].map((i) => {
      const x: LocalDate = addDays(mon, i);
      const n = open.filter((a) => dayOf(a.startsAt) === x).length;
      return { value: x, label: `${dayLabel(x)}${n ? ` (${n})` : ""}` };
    }),
  ];
  // Perspektivbytet visar veckorapporten som den handläggare som berörs mest (prototypen: Maria Ekdahl när hon berörs).
  const customer = wk.reports[0]?.recipientId ?? null;

  const renderRow = (a: NarvaroRow) => {
    const k = kindOf(a.kind);
    const at = a.attendance;
    const future = a.startsAt >= now;
    const isPending = pending === a.activityId;
    return (
      <div
        key={a.activityId}
        data-testid="narvaro-rad"
        className={cn(
          "grid grid-cols-[58px_minmax(0,1fr)] items-start gap-x-[18px] gap-y-2.5 border-b border-ljusgra px-[18px] py-3.5 last:border-b-0",
          at && "bg-ljusgra-ton",
        )}
      >
        <div className="w-[58px] flex-none">
          <div className="text-[1.0625rem] font-extrabold tabular-nums">{fmtTime(a.startsAt)}</div>
          <div className="text-small text-text-muted">{WEEKDAYS_SHORT[weekday(a.startsAt)]}</div>
        </div>
        <div className="flex min-w-0 flex-col gap-[3px]">
          <div className="font-bold">{a.name}</div>
          <div className="text-small text-text-muted">
            {k.label} · {a.location} · {a.durationMin} min · <span data-testid="arendenummer" className="tabular-nums tracking-[0.01em]">{a.caseNumber}</span>
          </div>
          <Row gap="sm">
            {at ? (
              <AttBadge at={at} />
            ) : future ? (
              <Badge tone="outline" icon="clock">
                Planerat
              </Badge>
            ) : (
              <Badge tone="redfill" icon="alert">
                Ej registrerad
              </Badge>
            )}
            {at?.status === "absent_invalid" && a.repeated && (
              <Badge tone="red" icon="flag">
                Upprepad ogiltig frånvaro – föreslå åtgärdsplan
              </Badge>
            )}
          </Row>
          {at?.status === "absent_invalid" && <div className="text-small text-text-muted">{v.sameDayText}</div>}
        </div>
        <div className="col-start-2 flex min-w-0 flex-col gap-2 max-[560px]:col-span-full max-[560px]:col-start-1">
          {future ? (
            <span className="text-small text-text-muted">Registreras när tillfället har startat.</span>
          ) : (
            <>
              <Seg
                ariaLabel={`Närvaro för ${a.name} ${dayLabel(a.startsAt)} ${fmtTime(a.startsAt)}`}
                value={isPending ? "absent_valid" : (at?.status ?? null)}
                onValueChange={(s) => pick(a, s)}
                options={ATT_OPTIONS}
              />
              {isPending && (
                <div role="group" aria-label="Orsak till giltig frånvaro" className="flex flex-col gap-1.5 rounded-mb border-[1.5px] border-antracit px-3 py-2.5">
                  <span className="text-small font-bold">Välj orsak (inga andra detaljer):</span>
                  <Seg
                    ariaLabel="Orsak"
                    value={at?.status === "absent_valid" ? at.reason : null}
                    onValueChange={(r) => void register(a, "absent_valid", r)}
                    options={v.absenceReasons.map((r) => ({ value: r, label: r }))}
                  />
                  <div>
                    <Button kind="ghost" onClick={() => setPending(null)}>
                      Avbryt
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <Page
      title="Närvaro"
      eyebrow={role === "handledare" ? "Handledare – dina teamärenden" : "Snabbregistrering"}
      lead={`Ett klick per tillfälle. Förra veckans närvaro ska vara registrerad senast ${v.dueText}. När alla tillfällen för en handläggares deltagare är registrerade publiceras veckorapporten automatiskt.`}
      crumbs={role === "coach" ? [MIN_VECKA_CRUMB, { label: "Närvaro" }] : undefined}
    >
      <Row between>
        <Seg<Week>
          ariaLabel="Vecka"
          value={week}
          onValueChange={setWeek}
          options={[
            { value: "last", label: `Förra veckan (v. ${v.weeks.last.no})${lastOpen ? ` · ${lastOpen} kvar` : ""}` },
            { value: "this", label: `Den här veckan (v. ${v.weeks.this.no})` },
          ]}
        />
        <Seg<Show>
          ariaLabel="Visa"
          value={show}
          onValueChange={setShow}
          options={[
            { value: "open", label: `Ej registrerade (${open.length})` },
            { value: "all", label: `Alla (${all.length})` },
          ]}
        />
      </Row>

      <Card tone={open.length > 0 ? "red" : "blue"}>
        <div data-testid="narvaro-raknare" className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <span className="text-[2.5rem] leading-none font-extrabold tabular-nums" aria-hidden="true">
            {open.length}
          </span>
          <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
            <div className="text-[1.125rem] font-bold">
              {open.length === 0 ? `Alla passerade tillfällen vecka ${wk.no} är registrerade` : `${plural(open.length, "tillfälle", "tillfällen")} kvar – senast ${v.dueText}`}
            </div>
            <div className="text-small text-text-muted">
              {passed.length - open.length} av {passed.length} passerade tillfällen registrerade
              {all.length > passed.length ? ` · ${all.length - passed.length} planerade senare i veckan` : ""}. Registrera senast {fmtDateTimeLong(wk.dueAt)}.
            </div>
          </div>
          {open.length > 0 ? (
            <SlaBadge sla={wk.sla} dueAt={wk.dueAt} />
          ) : (
            <Badge tone="blue" icon="check">
              Klart
            </Badge>
          )}
        </div>
      </Card>

      {role === "handledare" && (
        <Notice tone="info" title="Dina teamärenden">
          Du ser tillfällen för {v.caseCount === 1 ? "det ärende" : `de ${v.caseCount} ärenden`} där du ingår i teamet. Ärenden med skyddade personuppgifter visas bara för
          namngiven coach.
        </Notice>
      )}

      <Stack gap="sm">
        <span className="text-label font-bold tracking-[0.09em] text-text-muted uppercase">Dag</span>
        <Seg
          ariaLabel="Dag"
          value={day}
          onValueChange={(x) => {
            setDay(x);
            setPending(null);
          }}
          options={dayOptions}
        />
      </Stack>

      <Card flush title={day === "all" ? `Tillfällen vecka ${wk.no}` : `Tillfällen ${fmtWeekday(day)}`} icon="list" actions={<span className="text-small text-text-muted">{visible.length} visas</span>}>
        {visible.length === 0 ? (
          <Empty
            icon="check-square"
            title={show === "open" ? "Inget kvar att registrera här" : "Inga tillfällen"}
            action={
              show === "open" ? (
                <Button kind="ghost" onClick={() => setShow("all")}>
                  Visa alla tillfällen
                </Button>
              ) : undefined
            }
          />
        ) : (
          [...byDay.entries()].map(([dayKey, list]) => (
            <div key={dayKey}>
              {day === "all" && (
                <div className="flex flex-wrap justify-between gap-2 bg-ljusgra-ton2 px-[18px] py-2.5 text-label font-extrabold tracking-[0.08em] uppercase">
                  <span>{fmtWeekday(dayKey)}</span>
                  <span>{list.filter((a) => a.startsAt < now && !a.attendance).length} kvar</span>
                </div>
              )}
              {list.map(renderRow)}
            </div>
          ))
        )}
      </Card>

      <Split>
        <Card
          title={`Veckorapporter – vecka ${wk.no}`}
          icon="file"
          foot={
            role === "coach" ? (
              <Persp
                role={customer ? "kommun_handlaggare" : "kommun_chef"}
                userId={customer ?? undefined}
                to="/portal/rapporter"
                label="Se veckorapporten från kundens håll"
              />
            ) : undefined
          }
        >
          {week === "this" ? (
            <p>
              Veckorapporten för vecka {wk.no} skapas {fmtWeekday(addDays(v.weeks.this.mon, 7))} och publiceras när allt är registrerat, senast {v.pubText}.
            </p>
          ) : wk.reports.length === 0 ? (
            <p className="text-text-muted">Inga veckorapporter berörs.</p>
          ) : (
            <Stack gap="sm">
              {wk.reports.map((x) => (
                <div key={x.recipientId} className="flex flex-wrap items-center justify-between gap-3 border-b border-ljusgra py-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-bold">{x.name}</span>
                    <span className="text-small text-text-muted">
                      {x.unit}
                      {x.mine > 0 ? ` · ${x.mine} av dina tillfällen kvar` : ""}
                    </span>
                  </div>
                  <Row gap="sm">
                    {x.publishedAt ? (
                      <Badge tone="blue" icon="check">
                        Publicerad {fmtDateTime(x.publishedAt)}
                      </Badge>
                    ) : (
                      <Badge tone="outline" icon="clock">
                        Väntar på närvaro{x.left > 0 ? ` (${x.left} kvar)` : ""}
                      </Badge>
                    )}
                    {x.reportId && role === "coach" && (
                      <Button kind="ghost" to={`/rapporter/${encodeURIComponent(x.reportId)}`}>
                        Se veckorapporten
                      </Button>
                    )}
                  </Row>
                </div>
              ))}
            </Stack>
          )}
          <p className="mt-2.5 text-small text-text-muted">
            Rapporten har en sektion per deltagare: planerade tillfällen, närvaro, frånvaro med orsak och risk. Handläggaren får ett mejl utan personuppgifter: ”Veckorapporten
            finns i portalen – logga in för att läsa.”
          </p>
        </Card>
        <Card title="Så fungerar registreringen" icon="info">
          <Stack gap="sm">
            <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
              <li>
                <b>Närvarande</b> eller <b>Sen</b> räknas som närvaro.
              </li>
              <li>
                <b>Giltig frånvaro</b> kräver en orsak: {v.absenceReasons.map((r) => r.toLowerCase()).join(", ")}. Inga andra detaljer.
              </li>
              <li>
                <b>Ogiltig frånvaro</b> {v.repeatedRule.absentInvalid} gånger inom {v.repeatedRule.withinDays} dagar ger en flagga och förslag på åtgärdsplan.
              </li>
              <li>Påminnelse fredag eftermiddag och måndag morgon. Saknas registreringen {v.dueText} går en påminnelse till samordnaren.</li>
            </ul>
            <Notice tone="info" title="Frånvaronotis samma dag – ej fastställd">
              En notis till handläggaren samma dag vid ogiltig frånvaro är ett tillval i avtalet som inte är beslutat. Den är avstängd i prototypen.
            </Notice>
          </Stack>
        </Card>
      </Split>
    </Page>
  );
}
