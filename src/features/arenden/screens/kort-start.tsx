"use client";
// Dialogerna Starta insatsen och Ändra veckoplan (samma veckoplansredigerare), Lägg till tillfälle och Ändra team
// (beslut 2026-10-08, skarp drift: utan dem blev ett ärende aldrig "Pågår" och inga tillfällen fanns att registrera närvaro på).
// Används av deltagarkortet (kort.tsx, kort-flikar.tsx) och av Närvaro (src/features/coach/screens/narvaro.tsx).
import { useState } from "react";
import type { WeekPlanKind } from "@/core/config";
import { EARLY_START_HELP, earlyStartDateProblem, movedMeetingAt, plannedEndFrom } from "@/core/early-start";
import { fmtDuration, plural } from "@/core/format";
import { defaultWeekPlan, type WeekPlanRow } from "@/core/schedule";
import { addWorkingDays, dayOf, fmtDate, fmtDateTimeLong, isWorkingDay, holidayName, timeOf, WEEKDAYS } from "@/core/time";
import { useCommand } from "@/shell/backend";
import { Button, Check, DateInput, DateTimeInput, Field, FormGrid, Input, Kv, Modal, Notice, Select, Stack, TimeInput, toast } from "@/ui";
import type { ActivityKind, TeamRole } from "@/data/schema";
import { activityAdd, activityMove, caseScheduleChange, caseSetTeam, caseStart, type CaseCard } from "../api";
import { Label, MiniList } from "./common";

// ---------------------------------------------------------------- Veckoplanen
const KIND_LABEL: Record<WeekPlanKind, string> = { möte: "Coachträff", yrkesmoment: "Yrkesmoment", praktikdag: "Praktikdag" };
const KIND_OPTIONS = (Object.keys(KIND_LABEL) as WeekPlanKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }));
const ALL_KIND_LABEL: Record<ActivityKind, string> = { ...KIND_LABEL, arbetsgivarbesök: "Arbetsgivarbesök", annat: "Annat" };
const DURATIONS = [30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480];
/** "45 minuter", "1 timme", "1,5 timmar", "3 timmar" – den delade formateraren (fmtDuration i src/core/format.ts). */
export const durationLabel = fmtDuration;
const durationOptions = (current: number) => [...new Set([...DURATIONS, current])].sort((a, b) => a - b).map((m) => ({ value: String(m), label: durationLabel(m) }));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** En veckodag i redigeraren (måndag–fredag). */
export type PlanDay = { on: boolean; kind: WeekPlanKind; time: string; durationMin: number; location: string };
/** Redigerarens tillstånd ur en veckoplan: en rad per veckodag, avstängda dagar får rimliga förval. */
export function planToDays(plan: readonly WeekPlanRow[], defaultLocation: string): PlanDay[] {
  return [0, 1, 2, 3, 4].map((d) => {
    const r = plan.find((x) => x.weekday === d);
    return r ? { on: true, kind: r.kind, time: r.time, durationMin: r.durationMin, location: r.location } : { on: false, kind: "yrkesmoment", time: "09:00", durationMin: 180, location: defaultLocation };
  });
}
export const daysToPlan = (days: readonly PlanDay[]): WeekPlanRow[] =>
  days.flatMap((d, weekday) => (d.on ? [{ weekday, kind: d.kind, time: d.time, durationMin: d.durationMin, location: d.location.trim() }] : []));
const dayErrors = (days: readonly PlanDay[]): string | null => {
  const on = days.filter((d) => d.on);
  if (!on.length) return "Välj minst en dag i veckan.";
  if (on.some((d) => !/^\d{2}:\d{2}$/.test(d.time))) return "Välj klockslag för varje vald dag.";
  if (on.some((d) => !d.location.trim())) return "Skriv plats för varje vald dag.";
  return null;
};

/** Veckoplanen dag för dag: kryssruta, typ, tid, längd och plats. */
export function WeekPlanEditor({ days, onChange, idPrefix, error }: { days: PlanDay[]; onChange: (days: PlanDay[]) => void; idPrefix: string; error?: string | null }) {
  const set = (i: number, patch: Partial<PlanDay>) => onChange(days.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0" aria-describedby={error ? `${idPrefix}-error` : undefined} aria-invalid={error ? true : undefined}>
      <legend className="mb-1 p-0 text-ui font-bold">Veckoplan</legend>
      <div className="-mt-0.5 mb-1 text-small text-text-muted">Kryssa i dagarna deltagaren är hos er. Helgdagar hoppas över av sig själva.</div>
      {days.map((d, i) => (
        <div key={i} className={d.on ? "rounded-mb border border-ljusgra bg-ljusgra-ton px-3 pb-2" : undefined}>
          <Check id={`${idPrefix}-d${i}`} checked={d.on} onCheckedChange={(on) => set(i, { on })}>
            <span className="font-bold">{cap(WEEKDAYS[i])}</span>
            {!d.on && <span className="text-small text-text-muted"> – inget tillfälle</span>}
          </Check>
          {d.on && (
            <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.4fr)] gap-2 max-[620px]:grid-cols-1">
              <Field id={`${idPrefix}-k${i}`} label="Typ">
                <Select value={d.kind} onValueChange={(v) => set(i, { kind: v as WeekPlanKind })} options={KIND_OPTIONS} />
              </Field>
              <Field id={`${idPrefix}-t${i}`} label="Tid">
                <TimeInput value={d.time} onValueChange={(v) => set(i, { time: v })} />
              </Field>
              <Field id={`${idPrefix}-l${i}`} label="Längd">
                <Select value={String(d.durationMin)} onValueChange={(v) => set(i, { durationMin: Number(v) })} options={durationOptions(d.durationMin)} />
              </Field>
              <Field id={`${idPrefix}-p${i}`} label="Plats">
                <Input value={d.location} onValueChange={(v) => set(i, { location: v })} maxLength={200} />
              </Field>
            </div>
          )}
        </div>
      ))}
      {error && (
        <div id={`${idPrefix}-error`} role="alert" className="mt-1 text-small font-bold">
          {error}
        </div>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------- Starta insatsen / Ändra veckoplan
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Starta insatsen (bekräftat ärende med bokat första möte) eller ändra veckoplanen i ett pågående ärende.
 * Deltagaren kom före det bokade mötet (Karims beslut 2026-11-09): ett startdatum före mötets dag går när dagen har varit eller
 * är i dag, inte ligger före beställningen och är en arbetsdag (samma regler som servern, src/core/early-start.ts). Dialogen
 * visar då klockslaget för mötet och säger vad som händer: första mötet flyttas, planerat slut räknas om och kommunen får en
 * uppdaterad orderbekräftelse. Veckoplanen följer det flyttade mötet så länge den inte har ändrats för hand.
 */
export function StartModal({ card: c, mode, onClose }: { card: CaseCard; mode: "start" | "plan"; onClose: () => void }) {
  const start = useCommand(caseStart);
  const change = useCommand(caseScheduleChange);
  const s = c.start;
  const initialPlan = mode === "start" ? (s?.plan ?? []) : (c.weekPlan ?? []);
  const defaultLocation = c.location ? `Miljonbemanning ${c.location}` : "Miljonbemanning";
  const [startDate, setStartDate] = useState(s?.startDate ?? dayOf(c.now));
  const [meetingTime, setMeetingTime] = useState(s ? timeOf(s.firstMeetingAt) : "10:00");
  // Veckoplanen som användaren har ändrat för hand – annars föreslås planen för mötet som gäller (det bokade eller det flyttade).
  const [edited, setEdited] = useState<PlanDay[] | null>(null);
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<{ date?: string | null; time?: string | null; plan?: string | null }>({});
  const meetingDay = s ? dayOf(s.firstMeetingAt) : null;
  const today = dayOf(c.now);
  // Startdatumet ligger före det bokade mötet: första mötet flyttas till startdagen.
  const early = mode === "start" && !!s && !!meetingDay && DATE.test(startDate) && startDate < meetingDay;
  const earlyProblem = early && s ? earlyStartDateProblem({ referredAt: s.earliest, firstMeetingAt: s.firstMeetingAt }, startDate, today) : null;
  const movedAt = early && s && TIME.test(meetingTime) ? movedMeetingAt({ firstMeetingAt: s.firstMeetingAt }, startDate, meetingTime) : null;
  const end = early && s ? plannedEndFrom(s.period, c.plannedEnd, startDate) : (c.endDate ?? c.plannedEnd);
  const suggested = early && s && movedAt && !earlyProblem
    ? defaultWeekPlan({ activities: s.planRows ? { defaultWeekPlan: s.planRows } : undefined }, movedAt)
    : initialPlan;
  const days = edited ?? planToDays(suggested, defaultLocation);
  const perWeek = days.filter((d) => d.on).length;

  const submit = async () => {
    setTried(true);
    const e: { date?: string; time?: string; plan?: string } = {};
    if (mode === "start") {
      if (!DATE.test(startDate)) e.date = "Välj startdatum.";
      else if (earlyProblem) e.date = earlyProblem.text;
      else if (end && startDate > end) e.date = `Startdatumet ligger efter planerat slut ${fmtDate(end)}.`;
      if (early && !TIME.test(meetingTime)) e.time = "Välj klockslag för mötet.";
    }
    const pe = dayErrors(days);
    if (pe) e.plan = pe;
    setErr(e);
    if (Object.keys(e).length) return;
    const plan = daysToPlan(days);
    if (mode === "start") {
      const res = await start.run({ caseId: c.caseId, startDate, plan, ...(early ? { meetingTime } : {}) }).catch(() => null);
      if (!res || !res.ok) {
        toast(res && !res.ok && res.message ? res.message : "Insatsen kunde inte startas.", "error");
        return;
      }
      const until = res.plannedEnd ?? end;
      toast(
        `Insatsen är startad. ${plural(res.activities, "tillfälle", "tillfällen")} är inplanerade${until ? ` till och med ${fmtDate(until)}` : ""}.`
        + (res.movedMeetingAt ? ` Första mötet är flyttat till ${fmtDateTimeLong(res.movedMeetingAt)} och kommunen har fått en uppdaterad orderbekräftelse.` : ""),
      );
    } else {
      const res = await change.run({ caseId: c.caseId, plan }).catch(() => null);
      if (!res || !res.ok) {
        toast(res && !res.ok && res.message ? res.message : "Veckoplanen kunde inte sparas.", "error");
        return;
      }
      toast(`Veckoplanen är ändrad: ${plural(res.removed, "tillfälle", "tillfällen")} togs bort och ${res.added} lades till. Tillfällen med registrerad närvaro är kvar.`);
    }
    onClose();
  };
  const pending = start.pending || change.pending;
  return (
    <Modal
      title={mode === "start" ? "Starta insatsen" : "Ändra veckoplan"}
      onClose={onClose}
      wide
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon={mode === "start" ? "play" : "check"} pending={pending} onClick={() => void submit()}>
            {mode === "start" ? "Starta insatsen" : "Spara veckoplanen"}
          </Button>
        </>
      }
    >
      <Stack>
        <Kv
          items={[
            ["Ärende", <span key="n" className="font-bold tabular-nums">{c.caseNumber}</span>],
            ["Huvudcoach", c.leadCoach?.name ?? "–"],
            mode === "start" && s ? [early ? "Bokat första möte" : "Första mötet", fmtDateTimeLong(s.firstMeetingAt)] : null,
            ["Planerat slut", end ? fmtDate(end) : "Inte angivet"],
          ]}
        />
        {mode === "start" ? (
          <>
            <Field id="arn-start-date" label="Startdatum" required error={tried ? err.date : null} help={EARLY_START_HELP}>
              <DateInput value={startDate} onValueChange={(v) => { setStartDate(v); setErr({ ...err, date: null }); }} />
            </Field>
            {early && (
              <Field
                id="arn-start-time" label="Klockslag för mötet" required error={tried ? err.time : null}
                help="När första mötet hölls den dagen. Det bokade mötets klockslag är förvalt."
              >
                <TimeInput value={meetingTime} onValueChange={(v) => { setMeetingTime(v); setErr({ ...err, time: null }); }} />
              </Field>
            )}
            {early && earlyProblem && !(tried && err.date) && (
              <Notice tone="warn" title="Välj ett annat startdatum">{earlyProblem.text}</Notice>
            )}
            {early && !earlyProblem && (
              <Notice tone="info" icon="info" title="Första mötet flyttas" id="arn-start-early">
                Deltagaren kom före det bokade mötet. Första mötet flyttas till {movedAt ? fmtDateTimeLong(movedAt) : fmtDate(startDate)} och planerat slut räknas om
                till {end ? fmtDate(end) : "det som gäller för omfattningen"}. Kommunen får en uppdaterad orderbekräftelse.
              </Notice>
            )}
            {!early && startDate && !isWorkingDay(startDate) && (
              <Notice tone="warn" title="Inte en arbetsdag">{holidayName(startDate) ?? "Dagen"} – första tillfället blir nästa vardag enligt planen.</Notice>
            )}
          </>
        ) : (
          <Notice tone="info" icon="info" title="Vad som ändras">
            Kommande tillfällen utan registrerad närvaro ersätts av den nya planen från och med i dag. Tillfällen med registrerad närvaro rörs aldrig.
            Praktikdagar som hör till en praktik ligger kvar om planen inte själv innehåller praktikdagar.
          </Notice>
        )}
        <WeekPlanEditor days={days} onChange={(d) => { setEdited(d); if (err.plan) setErr({ ...err, plan: null }); }} idPrefix="arn-plan" error={tried ? err.plan : null} />
        <p className="m-0 text-text-muted">
          {plural(perWeek, "tillfälle", "tillfällen")} per vecka{end ? ` till och med ${fmtDate(end)}` : ""}. Enstaka tillfällen kan läggas till eller tas bort efteråt under Närvaro.
        </p>
        {mode === "start" && (
          <div className="rounded-mb border border-ljusgra bg-vit px-3 py-2.5">
            <Label className="m-0">Det här händer när du startar</Label>
            <MiniList
              items={[
                { key: "s", icon: "play", children: <>Ärendet blir <b>Pågår</b> med startdatumet. Veckorna från startdatumet räknas i fakturaunderlaget.</> },
                { key: "a", icon: "calendar", children: "Tillfällena skapas enligt veckoplanen och visas under Närvaro och i Min vecka." },
                ...(early && !earlyProblem
                  ? [{ key: "m", icon: "mail" as const, children: "Första mötet flyttas till startdagen. Kommunen får ett mejl om att orderbekräftelsen är uppdaterad. Deltagaren får ingen kallelse – hen har redan kommit." }]
                  : []),
                { key: "l", icon: "book", children: "Starten sparas i historiken och revisionsloggen." },
              ]}
            />
          </div>
        )}
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------- Lägg till tillfälle
export type ActivityCaseOption = { caseId: string; caseNumber: string; name: string; location: string };
/** Ett enstaka tillfälle i ett pågående ärende. cases = ärendena att välja bland (ett = förvalt, inget val visas). */
/**
 * Tillfället som ska få ny tid (Ändra tid – Karims beslut 2026-11-11). Typen och deltagaren ändras inte; dag, tid, längd och plats
 * gör det, och deltagaren får den nya tiden (aktivitet_andrad) när rutan är ikryssad.
 */
export type ActivityMoveTarget = { activityId: string; caseNumber: string; name?: string | null; kind: ActivityKind; startsAt: string; durationMin: number; location: string };

/**
 * Lägg till tillfälle, eller med move: Ändra tid för ett befintligt tillfälle (samma fält och samma regler för dag och längd).
 * Längd är en vallista – ingen skriver timmar (Karims beslut 2026-11-11).
 */
export function ActivityModal({ cases, caseId, now, onClose, move }: { cases: ActivityCaseOption[]; caseId?: string | null; now: string; onClose: () => void; move?: ActivityMoveTarget }) {
  const add = useCommand(activityAdd);
  const change = useCommand(activityMove);
  const [sel, setSel] = useState(caseId && cases.some((x) => x.caseId === caseId) ? caseId : cases.length === 1 ? cases[0].caseId : "");
  const chosen = cases.find((x) => x.caseId === sel) ?? null;
  const [kind, setKind] = useState<ActivityKind>(move?.kind ?? "yrkesmoment");
  const [at, setAt] = useState(move?.startsAt ?? `${addWorkingDays(dayOf(now), 1)}T09:00`);
  const [duration, setDuration] = useState(move?.durationMin ?? 180);
  const [location, setLocation] = useState(move?.location ?? "");
  const [notify, setNotify] = useState(true);
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const loc = location || (move ? "" : chosen?.location ? `Miljonbemanning ${chosen.location}` : "Miljonbemanning");
  const errs = {
    sel: !move && !sel ? "Välj deltagare." : null,
    at: !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) ? "Välj datum och tid." : move && at <= now ? "Tiden har redan passerat. Välj en senare tid." : null,
    loc: !loc.trim() ? "Skriv plats." : null,
  };
  const dirty = !!move && (at !== move.startsAt || duration !== move.durationMin || loc.trim() !== move.location.trim());
  const submit = async () => {
    setTried(true);
    setServerErr(null);
    if (errs.sel || errs.at || errs.loc) return;
    if (move) {
      const res = await change.run({ activityId: move.activityId, expectedStartsAt: move.startsAt, startsAt: at, durationMin: duration, location: loc.trim(), notify }).catch(() => null);
      if (!res || !res.ok) {
        const msg = res && !res.ok && res.message ? res.message : "Tiden kunde inte ändras.";
        setServerErr(msg);
        toast(msg, "error");
        return;
      }
      toast(res.changed ? `${ALL_KIND_LABEL[move.kind]} för ${move.caseNumber} är flyttat till ${fmtDateTimeLong(at)}.${res.notified ? ` ${res.notified}` : ""}` : "Inget var ändrat.");
      onClose();
      return;
    }
    const res = await add.run({ caseId: sel, kind, startsAt: at, durationMin: duration, location: loc.trim() }).catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Tillfället kunde inte läggas till.", "error");
      return;
    }
    toast(`${ALL_KIND_LABEL[kind]} ${fmtDateTimeLong(at)} är tillagt${chosen ? ` för ${chosen.caseNumber}` : ""}.`);
    onClose();
  };
  return (
    <Modal
      title={move ? "Ändra tid" : "Lägg till tillfälle"}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          {move ? (
            <Button kind="primary" icon="check" pending={change.pending} onClick={() => void submit()}>Spara ny tid</Button>
          ) : (
            <Button kind="primary" icon="plus" pending={add.pending} onClick={() => void submit()}>Lägg till tillfälle</Button>
          )}
        </>
      }
    >
      <FormGrid>
        {move ? (
          <div className="col-span-full">
            <Kv
              items={[
                ["Ärende", <span key="n"><span className="font-bold tabular-nums">{move.caseNumber}</span>{move.name ? ` · ${move.name}` : ""}</span>],
                ["Tillfälle", `${ALL_KIND_LABEL[move.kind]} ${fmtDateTimeLong(move.startsAt)}, ${fmtDuration(move.durationMin)}`],
              ]}
            />
          </div>
        ) : cases.length > 1 ? (
          <Field id="arn-act-case" label="Deltagare" required error={tried ? errs.sel : null} full>
            <Select value={sel} onValueChange={setSel} placeholder="Välj deltagare" options={cases.map((x) => ({ value: x.caseId, label: `${x.name} · ${x.caseNumber}` }))} />
          </Field>
        ) : (
          <Kv items={[["Ärende", chosen ? <span key="n"><span className="font-bold tabular-nums">{chosen.caseNumber}</span> · {chosen.name}</span> : "–"]]} />
        )}
        {!move && (
          <Field id="arn-act-kind" label="Typ" required>
            <Select value={kind} onValueChange={(v) => setKind(v as ActivityKind)} options={(Object.keys(ALL_KIND_LABEL) as ActivityKind[]).map((k) => ({ value: k, label: ALL_KIND_LABEL[k] }))} />
          </Field>
        )}
        <Field id="arn-act-at" label={move ? "Ny dag och tid" : "Datum och tid"} required error={tried ? errs.at : null}>
          <DateTimeInput value={at} onValueChange={setAt} />
        </Field>
        <Field id="arn-act-dur" label="Längd" required>
          <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))} options={durationOptions(duration)} />
        </Field>
        <Field id="arn-act-loc" label="Plats" required error={tried ? errs.loc : null}>
          <Input value={loc} onValueChange={setLocation} maxLength={200} />
        </Field>
        {at && !isWorkingDay(at) && (
          <div className="col-span-full">
            <Notice tone="warn" title="Inte en arbetsdag">
              {holidayName(at) ?? "Dagen är en helg"}. {move ? "Välj en vardag." : "Tillfället läggs ändå till om du vill."}
            </Notice>
          </div>
        )}
        {move && (
          <div className="col-span-full">
            <Check id="arn-act-meddela" checked={notify} onCheckedChange={setNotify}>
              <span className="font-bold">Skicka den nya tiden till deltagaren</span>
            </Check>
          </div>
        )}
        {move && serverErr && (
          <div className="col-span-full">
            <Notice tone="critical" title="Tiden kan inte ändras">{serverErr}</Notice>
          </div>
        )}
      </FormGrid>
    </Modal>
  );
}

// ---------------------------------------------------------------- Ändra team
/**
 * Arbetsgivarmatchare och SYV/metodstöd. Huvudcoachen byts med Byt huvudcoach. Teamvalet Handledare finns inte (rollen
 * handledare borttagen, Karims beslut 2026-10-09).
 */
export function TeamModal({ card: c, onClose }: { card: CaseCard; onClose: () => void }) {
  const save = useCommand(caseSetTeam);
  const opts = c.teamOptions ?? { staff: [] };
  const [matcher, setMatcher] = useState(c.team.find((t) => t.role === "employer_matcher")?.userId ?? "");
  const [counselor, setCounselor] = useState(c.team.find((t) => t.role === "guidance_counselor")?.userId ?? "");
  const [err, setErr] = useState<string | null>(null);
  const staffOptions = (exclude: string[]) => opts.staff.filter((u) => !exclude.includes(u.id)).map((u) => ({ value: u.id, label: u.name }));
  const submit = async () => {
    const team: { userId: string; role: TeamRole }[] = [];
    if (matcher) team.push({ userId: matcher, role: "employer_matcher" });
    if (counselor) team.push({ userId: counselor, role: "guidance_counselor" });
    if (new Set(team.map((t) => t.userId)).size !== team.length) {
      setErr("Samma person kan bara ha en roll i teamet.");
      return;
    }
    const res = await save.run({ caseId: c.caseId, team }).catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Teamet kunde inte sparas.", "error");
      return;
    }
    toast(`Teamet för ${c.caseNumber} är sparat.${res.added ? ` ${plural(res.added, "ny medlem", "nya medlemmar")} har fått notis.` : ""}`);
    onClose();
  };
  return (
    <Modal
      title="Ändra team"
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="check" pending={save.pending} onClick={() => void submit()}>Spara teamet</Button>
        </>
      }
    >
      <Stack>
        <Kv items={[["Ärende", <span key="n" className="font-bold tabular-nums">{c.caseNumber}</span>], ["Huvudcoach", c.leadCoach ? `${c.leadCoach.name} – byts med Byt huvudcoach` : "Inte tilldelad"]]} />
        {err && <Notice tone="critical">{err}</Notice>}
        <FormGrid>
          <Field id="arn-team-matcher" label="Arbetsgivarmatchare (valfritt)">
            <Select value={matcher} onValueChange={(v) => { setMatcher(v); setErr(null); }} placeholder="Ingen" options={staffOptions([counselor])} />
          </Field>
          <Field id="arn-team-counselor" label="SYV/metodstöd (valfritt)">
            <Select value={counselor} onValueChange={(v) => { setCounselor(v); setErr(null); }} placeholder="Ingen" options={staffOptions([matcher])} />
          </Field>
        </FormGrid>
        <div className="rounded-mb border border-ljusgra bg-vit px-3 py-2.5">
          <Label className="m-0">Det här händer när du sparar</Label>
          <MiniList
            items={[
              { key: "n", icon: "bell", children: <>Nya medlemmar får en notis i appen och ett mejl utan personuppgifter: ”Du har fått ett nytt ärende i Miljonmatch: {c.caseNumber}.”</> },
              { key: "s", icon: "users", children: "Den som tas bort ur teamet får inga fler notiser men kan fortfarande öppna ärendet under Ärenden." },
              { key: "l", icon: "book", children: "Ändringen sparas i revisionsloggen." },
            ]}
          />
        </div>
      </Stack>
    </Modal>
  );
}
