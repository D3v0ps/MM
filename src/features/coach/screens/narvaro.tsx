"use client";
// Närvaro (/narvaro?vecka=forra|denna) – snabbregistrering med ett klick per tillfälle. Veckorapporten till handläggaren
// publiceras automatiskt när alla hennes deltagare är registrerade. Coach (ärenden där hen är huvudcoach) och handledare (teamärenden)
// – listan följer tilldelningen även om alla ärenden i avtalet är läsbara (beslut 2026-10-09).
// Port av prototypens coach.narvaro och åtgärden coach.attendanceSet.
// UX-genomgången, paket 1 (C4, C5):
//   * Ingressen säger regeln: registrera bara frånvaro och sen ankomst, senast kl. <tid> samma dag – övriga blir Närvarande
//     automatiskt. Klockslaget kommer från samma källa som jobbet auto_attendance (NarvaroView.autoAttendance).
//   * Listan först. Vecka, Visa, Dag och Yrkesområde/Nivå/Tagg ligger bakom knappen Filtrera – de valda filtren står som text.
//   * "Markera övriga som närvarande (N)" gäller hela den visade listan (ett kommando per dag, coach.attendanceSetAll – redan
//     registrerade ändras aldrig, enskilda rättas efteråt med radens knappar). Bekräftelsen finns kvar: Ångra skulle kräva att
//     närvaro kan tas bort, och det tillåter inte databasens regler (RLS) i dag.
//   * Statusen visas en gång per rad: knappgruppen visar den valda statusen, märket bara det som knappgruppen inte visar
//     (Ej registrerad, Planerat, orsaken och Automatiskt registrerad).
import { useState, type ReactNode } from "react";
import { uniq } from "@/core/util";
import { fmtDuration, plural } from "@/core/format";
import { addDays, dayOf, fmtDateTime, fmtDateTimeLong, fmtTime, fmtWeekday, isWorkingDay, weekday, WEEKDAYS_SHORT, type LocalDate } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { Link } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { useQueryPatch } from "@/shell/url-state";
import { useSession } from "@/shell/session";
import { Badge, Button, Card, cn, Disclosure, Empty, Notice, Page, Row, Seg, SlaBadge, Split, Stack, toast, useConfirm } from "@/ui";
import { activityRemove } from "@/features/arenden/api";
import { ActivityModal } from "@/features/arenden/screens/kort-start";
import { useGroupingFilter } from "@/features/grupper/screens/grouping-filter";
import { attendanceSet, attendanceSetAll, narvaroView, type NarvaroRow, type NarvaroView } from "../api";
import { ATT_OPTIONS, AutoBadge, dayLabel, kindOf, MIN_VECKA_CRUMB, PageState, Persp } from "./shared";

type Week = "last" | "this";
type Show = "open" | "all";

/** Tomt läge: säger vad som gör att tillfällen dyker upp (tom databas, nytt ärende utan schema). */
const NO_SESSIONS_TEXT = "Tillfällen skapas när insatsen startas – knappen Starta insatsen på deltagarkortet efter första mötet. Sedan registrerar du närvaron här med ett klick per tillfälle.";
type AttStatus = "present" | "late" | "absent_valid" | "absent_invalid";

export function NarvaroScreen({ query }: ScreenProps) {
  const q = useQuery(narvaroView, {});
  // Nivå, grupp och tagg (coachmötet 2026-10-09) – samma filter som i ärendelistan, kombineras med vecka, dag och visa.
  const gf = useGroupingFilter(query);
  if (!q.data) return <PageState title="Närvaro" error={q.error} onRetry={() => void q.refetch()} />;
  // ?arende=<id>: bara den deltagarens tillfällen (från deltagarkortet, Min vecka och handledarens lista). Veckorapporterna visas som vanligt.
  const caseId = query.get("arende");
  const v0 = caseId ? onlyCases(q.data, (id) => id === caseId) : q.data;
  const v = gf.active ? onlyCases(v0, gf.matches) : v0;
  const param = query.get("vecka");
  const initial: Week = param === "forra" ? "last" : param === "denna" ? "this" : openOf(v, "last").length ? "last" : "this";
  return <Narvaro v={v} initial={initial} caseId={caseId} filters={gf.fields} filterLabels={gf.labels} />;
}

/** "18:00" -> "18.00" (svensk tid i text). */
const clock = (at: string) => at.replace(":", ".");
/** Ingressen: regeln för den automatiska närvaron (C4). Utan automatisk närvaro: registrera varje tillfälle. */
export function narvaroLead(auto: NarvaroView["autoAttendance"], dueText: string): string {
  return auto.on
    ? `Registrera bara frånvaro och sen ankomst, senast kl. ${clock(auto.at)} samma dag. Övriga blir Närvarande automatiskt.`
    : `Ett klick per tillfälle. Förra veckans närvaro ska vara registrerad senast ${dueText}.`;
}

const onlyCases = (v: NarvaroView, keep: (caseId: string) => boolean): NarvaroView => ({
  ...v,
  weeks: { last: { ...v.weeks.last, rows: v.weeks.last.rows.filter((r) => keep(r.caseId)) }, this: { ...v.weeks.this, rows: v.weeks.this.rows.filter((r) => keep(r.caseId)) } },
});

/** "BOT-26-0174" för filtret (ärendenumret från raderna – inget namn i adressen). */
const filteredLabel = (v: NarvaroView, caseId: string): string =>
  [...v.weeks.last.rows, ...v.weeks.this.rows].find((r) => r.caseId === caseId)?.caseNumber ?? "en deltagare";

const openOf = (v: NarvaroView, w: Week) => v.weeks[w].rows.filter((a) => a.startsAt < v.now && !a.attendance);

function Narvaro({ v, initial, caseId, filters, filterLabels = [] }: { v: NarvaroView; initial: Week; caseId: string | null; filters?: ReactNode; filterLabels?: string[] }) {
  const { actor } = useSession();
  const patch = useQueryPatch();
  const role = actor.role;
  const set = useCommand(attendanceSet);
  const setAll = useCommand(attendanceSetAll);
  const confirm = useConfirm();
  const now = v.now;
  const today = dayOf(now);
  const defaultDay = (w: Week): string => (w === "this" && isWorkingDay(today) ? today : "all");
  const [week, setWeekRaw] = useState<Week>(initial);
  const [day, setDay] = useState<string>(() => defaultDay(initial));
  const [show, setShow] = useState<Show>(() => (openOf(v, initial).length > 0 ? "open" : "all"));
  const [pending, setPending] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, true>>({});
  // Tillfällen vars registrering pågår (radens kommando): knapparna ignorerar klick tills svaret kommit – två samtidiga
  // kommandon för samma tillfälle får annars skriva samma rad (dubbelklick). Medan "Markera alla" pågår gäller alla rader.
  const [inflight, setInflight] = useState<Record<string, true>>({});
  // Senaste "Markera övriga som närvarande": visas som statusrad (läses upp) tills veckan eller dagen byts – med
  // veckorapporterna som publicerades (i stället för en kvittens per rapport).
  const [bulk, setBulk] = useState<{ marked: number; total: number; published: string[] } | null>(null);
  // Lägg till och ta bort enstaka tillfällen (beslut 2026-10-08) – bara tillfällen utan registrerad närvaro kan tas bort.
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<NarvaroRow | null>(null);
  const remove = useCommand(activityRemove);
  const removeActivity = async (a: NarvaroRow) => {
    const ok = await confirm({
      title: "Ta bort tillfället?",
      body: `${kindOf(a.kind).label} ${dayLabel(a.startsAt)} ${fmtTime(a.startsAt)} för ${a.name} tas bort.`,
      confirmLabel: "Ta bort",
      cancelLabel: "Avbryt",
      tone: "danger",
    });
    if (!ok) return;
    const res = await remove.run({ activityId: a.activityId }).catch(() => null);
    if (!res || !res.ok) toast(res && !res.ok && res.message ? res.message : "Tillfället kunde inte tas bort.", "error");
    else toast("Tillfället är borttaget.");
  };
  const setWeek = (w: Week) => {
    // Veckan i adressen (replace): Tillbaka och omladdning visar samma vecka.
    patch({ vecka: w === "last" ? "forra" : "denna" });
    setWeekRaw(w);
    setDay(defaultDay(w));
    setPending(null);
    setBulk(null);
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
  /** Passerade tillfällen i den visade listan som saknar registrering – de som "Markera övriga som närvarande" gäller. */
  const openVisible = visible.filter((a) => a.startsAt < now && !a.attendance);
  const autoCount = all.filter((a) => a.attendance?.source === "auto").length;

  const register = async (a: NarvaroRow, status: AttStatus, reason = "") => {
    if (inflight[a.activityId] || setAll.pending) return;
    setTouched((t) => ({ ...t, [a.activityId]: true }));
    setPending(null);
    setInflight((x) => ({ ...x, [a.activityId]: true }));
    const res = await set.run({ activityId: a.activityId, status, reason }).catch(() => null);
    setInflight((x) => {
      const next = { ...x };
      delete next[a.activityId];
      return next;
    });
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
  /**
   * Markera övriga som närvarande: alla passerade tillfällen i den visade listan som saknar registrering. Ett kommando per dag
   * (coach.attendanceSetAll – en loggrad per dag, som förut). Bekräftelsen räknar upp dem: en registrering kan inte ångras
   * (närvaro kan inte tas bort), bara rättas på raden.
   */
  const markOthers = async () => {
    const list = openVisible;
    if (!list.length) return;
    const n = list.length;
    const ok = await confirm({
      title: `Markera ${n} som närvarande?`,
      body: (
        <Stack gap="sm">
          <p>Närvarande registreras för:</p>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
            {list.map((a) => (
              <li key={a.activityId}>
                {a.name} ({a.caseNumber}) · {dayLabel(a.startsAt)} {fmtTime(a.startsAt)} {kindOf(a.kind).label.toLowerCase()}
              </li>
            ))}
          </ul>
          <p>Tillfällen som redan är registrerade ändras inte. Enskilda rättar du efteråt med knapparna på raden.</p>
        </Stack>
      ),
      confirmLabel: `Markera ${n} som närvarande`,
      cancelLabel: "Avbryt",
    });
    if (!ok) return;
    // Raderna står kvar i läget "Ej registrerade" med sina knappar, så att enskilda kan rättas direkt.
    setTouched((t) => {
      const next = { ...t };
      for (const x of list) next[x.activityId] = true;
      return next;
    });
    setPending(null);
    let marked = 0;
    const published: string[] = [];
    for (const d of uniq(list.map((x) => dayOf(x.startsAt))).sort()) {
      const res = await setAll.run({ day: d, activityIds: list.filter((x) => dayOf(x.startsAt) === d).map((x) => x.activityId) }).catch(() => null);
      if (!res || !res.ok) {
        // not_found: listan var inaktuell – sidan räknas om av kommandot, så raderna visar det som gäller.
        toast(res && !res.ok && res.message ? res.message : "Närvaron kunde inte sparas.", "error");
        break;
      }
      marked += res.marked.length;
      published.push(...res.published.map((x) => x.text));
    }
    setBulk({ marked, total: n, published });
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
    const busy = !!inflight[a.activityId] || setAll.pending;
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
            {k.label} · {a.location} · {fmtDuration(a.durationMin)} · <span data-testid="arendenummer" className="tabular-nums tracking-[0.01em]">{a.caseNumber}</span>
            {a.leadCoach ? ` · huvudcoach ${a.leadCoach}` : ""}
          </div>
          {/* Statusen en gång per rad: den valda står i knappgruppen – här bara det som knappgruppen inte visar. */}
          <Row gap="sm">
            {at ? (
              <>
                {at.status === "absent_valid" && at.reason && <span className="text-body">Orsak: {at.reason}</span>}
                {at.source === "auto" && <AutoBadge />}
              </>
            ) : future ? (
              <Badge tone="outline" icon="clock">
                Planerat
              </Badge>
            ) : (
              // Kontur med ring, som AttBadge: räknarkortet ovanför är sidans enda röda ämne (Min veckas stil, beslut 2026-10-06).
              <Badge tone="outline" icon="circle">
                Ej registrerad
              </Badge>
            )}
            {at?.status === "absent_invalid" && a.repeated && (
              <Badge tone="outline" icon="flag" className="[&_svg]:text-rod">
                Upprepad ogiltig frånvaro – föreslå åtgärdsplan
              </Badge>
            )}
          </Row>
          {at?.status === "absent_invalid" && <div className="text-body text-text-muted">{v.sameDayText}</div>}
        </div>
        <div className="col-start-2 flex min-w-0 flex-col gap-2 max-[560px]:col-span-full max-[560px]:col-start-1">
          {future ? (
            <Row gap="sm">
              <span className="text-body text-text-muted">Registreras när tillfället har startat.</span>
              {a.groupActivityId ? (
                // Gruppaktivitet: deltagaren tas bort i aktivitetsvyn, så att det loggas på aktiviteten.
                <Button kind="ghost" icon="users" to={`/aktiviteter/${encodeURIComponent(a.groupActivityId)}`}>
                  Öppna gruppaktiviteten
                </Button>
              ) : (
                <>
                  {/* Ändra tid (Karims beslut 2026-11-11): samma dialog som Lägg till tillfälle – deltagaren får den nya tiden. */}
                  <Button kind="ghost" icon="clock" ariaLabel={`Ändra tid: ${a.name} ${dayLabel(a.startsAt)} ${fmtTime(a.startsAt)}`} onClick={() => setMoving(a)}>
                    Ändra tid
                  </Button>
                  <Button kind="ghost" icon="trash" pending={remove.pending} onClick={() => void removeActivity(a)}>
                    Ta bort
                  </Button>
                </>
              )}
            </Row>
          ) : (
            <>
              <Seg
                ariaLabel={`Närvaro för ${a.name} ${dayLabel(a.startsAt)} ${fmtTime(a.startsAt)}`}
                value={isPending ? "absent_valid" : (at?.status ?? null)}
                onValueChange={(s) => pick(a, s)}
                options={ATT_OPTIONS}
                busy={busy}
                className="max-[560px]:grid max-[560px]:grid-cols-2"
              />
              {isPending && (
                <div role="group" aria-label="Orsak till giltig frånvaro" className="flex flex-col gap-1.5 rounded-mb border-[1.5px] border-antracit px-3 py-2.5">
                  <span className="text-body font-bold">Välj orsak (inga andra detaljer):</span>
                  <Seg
                    ariaLabel="Orsak"
                    value={at?.status === "absent_valid" ? at.reason : null}
                    onValueChange={(r) => void register(a, "absent_valid", r)}
                    options={v.absenceReasons.map((r) => ({ value: r, label: r }))}
                    busy={busy}
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

  const filterText = [
    week === "last" ? `Förra veckan (v. ${v.weeks.last.no})` : `Den här veckan (v. ${v.weeks.this.no})`,
    show === "open" ? "Ej registrerade" : "Alla tillfällen",
    day === "all" ? "Hela veckan" : fmtWeekday(day),
    ...filterLabels,
  ].join(" · ");

  return (
    <Page
      title="Närvaro"
      eyebrow={role === "handledare" ? "Handledare – dina teamärenden" : "Snabbregistrering"}
      lead={`${
        role === "handledare" ? `Du ser tillfällen för ${v.caseCount === 1 ? "det ärende" : `de ${v.caseCount} ärenden`} där du ingår i teamet. ` : ""
      }${narvaroLead(v.autoAttendance, v.dueText)}`}
      crumbs={role === "coach" ? [MIN_VECKA_CRUMB, { label: "Närvaro" }] : undefined}
    >
      {caseId && (
        <Notice tone="info" icon="filter" title={`Visar bara ${filteredLabel(v, caseId)}`}>
          <Link to={`/narvaro?vecka=${week === "last" ? "forra" : "denna"}`} className="inline-flex min-h-11 items-center font-bold">
            Visa alla deltagare
          </Link>
        </Notice>
      )}
      {/* Filtren bakom en knapp – de valda står som text bredvid (C5). */}
      <Disclosure
        id="narvaro-filtren"
        kind="secondary"
        label="Filtrera"
        openLabel="Dölj filtren"
        aside={
          <span className="text-body" data-testid="narvaro-filtertext">
            <span className="font-bold">Visar: </span>
            {filterText}
          </span>
        }
      >
        <div className="flex flex-col gap-4 rounded-mb border border-ljusgra p-4">
          <Row gap="sm">
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
          <Stack gap="sm">
            <span className="text-label font-bold tracking-[0.09em] text-text-muted uppercase">Dag</span>
            <Seg
              ariaLabel="Dag"
              value={day}
              onValueChange={(x) => {
                setDay(x);
                setPending(null);
                setBulk(null);
              }}
              options={dayOptions}
            />
          </Stack>
          {filters && <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] items-end gap-x-4 gap-y-3">{filters}</div>}
        </div>
      </Disclosure>

      <Card
        flush
        title={day === "all" ? `Tillfällen vecka ${wk.no}` : `Tillfällen ${fmtWeekday(day)}`}
        icon="list"
        actions={
          <Row gap="sm">
            <span className="text-small text-text-muted">{visible.length} visas</span>
            {openVisible.length > 0 && (
              <Button kind="primary" icon="check-square" pending={setAll.pending} onClick={() => void markOthers()}>
                Markera övriga som närvarande ({openVisible.length})
              </Button>
            )}
            {v.cases.length > 0 && (
              <Button icon="plus" onClick={() => setAdding(true)}>
                Lägg till tillfälle
              </Button>
            )}
            {/* Ändra veckoplan (Karims beslut 2026-11-11): för deltagaren som listan visar – dialogen på deltagarkortet. */}
            {caseId && v.cases.some((x) => x.caseId === caseId) && (
              <Button icon="calendar" to={`/arenden/${encodeURIComponent(caseId)}?flik=narvaro&veckoplan=1`}>
                Ändra veckoplan
              </Button>
            )}
          </Row>
        }
      >
        {all.length > 0 && (
          <div
            data-testid="narvaro-raknare"
            className={cn("flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-ljusgra px-[18px] py-3.5", open.length > 0 ? "bg-rod-ton shadow-[inset_4px_0_0_var(--color-rod)]" : "bg-bla-ton")}
          >
            <span className="text-[2rem] leading-none font-extrabold tabular-nums" aria-hidden="true">
              {open.length}
            </span>
            <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
              <div className="text-[1.125rem] font-bold">
                {open.length === 0 ? `Alla passerade tillfällen vecka ${wk.no} är registrerade` : `${plural(open.length, "tillfälle", "tillfällen")} kvar – senast ${v.dueText}`}
              </div>
              <div className="text-body text-text-muted">
                {passed.length - open.length} av {passed.length} passerade tillfällen registrerade
                {autoCount > 0 ? ` (${autoCount} automatiskt registrerade)` : ""}
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
        )}
        {/* Statusraden finns alltid (tom tills något markerats), så att skärmläsare läser upp resultatet. */}
        <p role="status" aria-live="polite" className={cn("m-0 text-body font-bold", bulk && "border-b border-ljusgra px-[18px] py-3")}>
          {bulk ? [`${bulk.marked} av ${bulk.total} tillfällen markerade som närvarande. Rätta enskilda med knapparna på raden.`, ...bulk.published].join(" ") : ""}
        </p>
        {all.length === 0 ? (
          <Empty icon="calendar" title={`Inga tillfällen vecka ${wk.no}`}>
            {NO_SESSIONS_TEXT}
          </Empty>
        ) : visible.length === 0 ? (
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
                <div className="flex flex-wrap items-center justify-between gap-2 bg-ljusgra-ton2 px-[18px] py-2.5 text-label font-extrabold tracking-[0.08em] uppercase">
                  <span>{fmtWeekday(dayKey)}</span>
                  <span>{list.filter((x) => x.startsAt < now && !x.attendance).length} kvar</span>
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
                role="kommun_handlaggare"
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
          <p className="mt-2.5 text-body text-text-muted">
            Rapporten har en sektion per deltagare: planerade tillfällen, närvaro, frånvaro med orsak och risk. Handläggaren får ett mejl utan personuppgifter: ”Veckorapporten
            finns i portalen – logga in för att läsa.”
          </p>
        </Card>
        <Card title="Så fungerar registreringen" icon="info">
          <Stack gap="sm">
            <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
              {v.autoAttendance.on ? (
                <li data-testid="narvaro-regel">
                  <b>Registrera bara frånvaro och sen ankomst</b>, senast kl. {clock(v.autoAttendance.at)} samma dag. Kl. {clock(v.autoAttendance.at)} blir passerade
                  tillfällen utan registrering <b>Närvarande</b> automatiskt och märks <b>Automatiskt registrerad</b>. Du kan ändra dem efteråt. Helgdagar, pausade
                  veckor och veckor vars veckorapport redan har skickats registreras inte automatiskt.
                </li>
              ) : (
                <li data-testid="narvaro-regel">Närvaron registreras inte automatiskt. Registrera varje tillfälle.</li>
              )}
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
          </Stack>
        </Card>
      </Split>
      {adding && <ActivityModal cases={v.cases} caseId={caseId} now={now} onClose={() => setAdding(false)} />}
      {moving && (
        <ActivityModal
          cases={[]}
          now={now}
          onClose={() => setMoving(null)}
          move={{ activityId: moving.activityId, caseNumber: moving.caseNumber, name: moving.name, kind: moving.kind, startsAt: moving.startsAt, durationMin: moving.durationMin, location: moving.location }}
        />
      )}
    </Page>
  );
}
