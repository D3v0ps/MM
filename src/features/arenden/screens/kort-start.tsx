"use client";
// Dialogerna Starta insatsen och Ändra veckoplan (samma veckoplansredigerare), Lägg till tillfälle och Ändra team
// (beslut 2026-10-08, skarp drift: utan dem blev ett ärende aldrig "Pågår" och inga tillfällen fanns att registrera närvaro på).
// Används av deltagarkortet (kort.tsx, kort-flikar.tsx) och av Närvaro (src/features/coach/screens/narvaro.tsx).
import { useState } from "react";
import type { WeekPlanKind } from "@/core/config";
import { plural } from "@/core/format";
import type { WeekPlanRow } from "@/core/schedule";
import { addWorkingDays, dayOf, fmtDate, fmtDateTimeLong, isWorkingDay, holidayName, WEEKDAYS } from "@/core/time";
import { useCommand } from "@/shell/backend";
import { Button, Check, DateInput, DateTimeInput, Field, FormGrid, Input, Kv, Modal, Notice, Select, Stack, TimeInput, toast } from "@/ui";
import type { ActivityKind, TeamRole } from "@/data/schema";
import { activityAdd, caseScheduleChange, caseSetTeam, caseStart, type CaseCard } from "../api";
import { Label, MiniList } from "./common";

// ---------------------------------------------------------------- Veckoplanen
const KIND_LABEL: Record<WeekPlanKind, string> = { möte: "Coachträff", yrkesmoment: "Yrkesmoment", praktikdag: "Praktikdag" };
const KIND_OPTIONS = (Object.keys(KIND_LABEL) as WeekPlanKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }));
const ALL_KIND_LABEL: Record<ActivityKind, string> = { ...KIND_LABEL, arbetsgivarbesök: "Arbetsgivarbesök", annat: "Annat" };
const DURATIONS = [30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480];
/** "45 minuter", "1 timme", "1,5 timmar", "3 timmar". */
export const durationLabel = (min: number) => {
  if (min < 60) return `${min} minuter`;
  const h = min / 60;
  const text = Number.isInteger(h) ? String(h) : h.toFixed(1).replace(".", ",");
  return `${text} ${h === 1 ? "timme" : "timmar"}`;
};
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
/** Starta insatsen (bekräftat ärende med bokat första möte) eller ändra veckoplanen i ett pågående ärende. */
export function StartModal({ card: c, mode, onClose }: { card: CaseCard; mode: "start" | "plan"; onClose: () => void }) {
  const start = useCommand(caseStart);
  const change = useCommand(caseScheduleChange);
  const s = c.start;
  const initialPlan = mode === "start" ? (s?.plan ?? []) : (c.weekPlan ?? []);
  const [startDate, setStartDate] = useState(s?.startDate ?? dayOf(c.now));
  const [days, setDays] = useState<PlanDay[]>(() => planToDays(initialPlan, c.location ? `Miljonbemanning ${c.location}` : "Miljonbemanning"));
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<{ date?: string | null; plan?: string | null }>({});
  const meetingDay = s ? dayOf(s.firstMeetingAt) : null;
  const perWeek = days.filter((d) => d.on).length;
  const end = c.endDate ?? c.plannedEnd;

  const submit = async () => {
    setTried(true);
    const e: { date?: string; plan?: string } = {};
    if (mode === "start") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) e.date = "Välj startdatum.";
      else if (meetingDay && startDate < meetingDay) e.date = `Startdatumet kan inte vara före första mötet ${fmtDate(meetingDay)}.`;
      else if (end && startDate > end) e.date = `Startdatumet ligger efter planerat slut ${fmtDate(end)}.`;
    }
    const pe = dayErrors(days);
    if (pe) e.plan = pe;
    setErr(e);
    if (Object.keys(e).length) return;
    const plan = daysToPlan(days);
    if (mode === "start") {
      const res = await start.run({ caseId: c.caseId, startDate, plan }).catch(() => null);
      if (!res || !res.ok) {
        toast(res && !res.ok && res.message ? res.message : "Insatsen kunde inte startas.", "error");
        return;
      }
      toast(`Insatsen är startad. ${plural(res.activities, "tillfälle", "tillfällen")} är inplanerade${end ? ` till och med ${fmtDate(end)}` : ""}.`);
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
            mode === "start" && s ? ["Första mötet", fmtDateTimeLong(s.firstMeetingAt)] : null,
            ["Planerat slut", end ? fmtDate(end) : "Inte angivet"],
          ]}
        />
        {mode === "start" ? (
          <>
            <Field id="arn-start-date" label="Startdatum" required error={tried ? err.date : null} help="Första mötets dag om inget annat gäller. Insatsen kan inte starta före första mötet. Från det här datumet räknas veckorna.">
              <DateInput value={startDate} onValueChange={(v) => { setStartDate(v); setErr({ ...err, date: null }); }} />
            </Field>
            {startDate && !isWorkingDay(startDate) && (
              <Notice tone="warn" title="Inte en arbetsdag">{holidayName(startDate) ?? "Dagen"} – första tillfället blir nästa vardag enligt planen.</Notice>
            )}
          </>
        ) : (
          <Notice tone="info" icon="info" title="Vad som ändras">
            Kommande tillfällen utan registrerad närvaro ersätts av den nya planen från och med i dag. Tillfällen med registrerad närvaro rörs aldrig.
            Praktikdagar som hör till en praktik ligger kvar om planen inte själv innehåller praktikdagar.
          </Notice>
        )}
        <WeekPlanEditor days={days} onChange={(d) => { setDays(d); if (err.plan) setErr({ ...err, plan: null }); }} idPrefix="arn-plan" error={tried ? err.plan : null} />
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
export function ActivityModal({ cases, caseId, now, onClose }: { cases: ActivityCaseOption[]; caseId?: string | null; now: string; onClose: () => void }) {
  const add = useCommand(activityAdd);
  const [sel, setSel] = useState(caseId && cases.some((x) => x.caseId === caseId) ? caseId : cases.length === 1 ? cases[0].caseId : "");
  const chosen = cases.find((x) => x.caseId === sel) ?? null;
  const [kind, setKind] = useState<ActivityKind>("yrkesmoment");
  const [at, setAt] = useState(`${addWorkingDays(dayOf(now), 1)}T09:00`);
  const [duration, setDuration] = useState(180);
  const [location, setLocation] = useState("");
  const [tried, setTried] = useState(false);
  const loc = location || (chosen?.location ? `Miljonbemanning ${chosen.location}` : "Miljonbemanning");
  const errs = {
    sel: !sel ? "Välj deltagare." : null,
    at: !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) ? "Välj datum och tid." : null,
    loc: !loc.trim() ? "Skriv plats." : null,
  };
  const submit = async () => {
    setTried(true);
    if (errs.sel || errs.at || errs.loc) return;
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
      title="Lägg till tillfälle"
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="plus" pending={add.pending} onClick={() => void submit()}>Lägg till tillfälle</Button>
        </>
      }
    >
      <FormGrid>
        {cases.length > 1 ? (
          <Field id="arn-act-case" label="Deltagare" required error={tried ? errs.sel : null} full>
            <Select value={sel} onValueChange={setSel} placeholder="Välj deltagare" options={cases.map((x) => ({ value: x.caseId, label: `${x.name} · ${x.caseNumber}` }))} />
          </Field>
        ) : (
          <Kv items={[["Ärende", chosen ? <span key="n"><span className="font-bold tabular-nums">{chosen.caseNumber}</span> · {chosen.name}</span> : "–"]]} />
        )}
        <Field id="arn-act-kind" label="Typ" required>
          <Select value={kind} onValueChange={(v) => setKind(v as ActivityKind)} options={(Object.keys(ALL_KIND_LABEL) as ActivityKind[]).map((k) => ({ value: k, label: ALL_KIND_LABEL[k] }))} />
        </Field>
        <Field id="arn-act-at" label="Datum och tid" required error={tried ? errs.at : null}>
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
            <Notice tone="warn" title="Inte en arbetsdag">{holidayName(at) ?? "Dagen är en helg"}. Tillfället läggs ändå till om du vill.</Notice>
          </div>
        )}
      </FormGrid>
    </Modal>
  );
}

// ---------------------------------------------------------------- Ändra team
/** Handledare, arbetsgivarmatchare och SYV/metodstöd. Huvudcoachen byts med Byt huvudcoach. */
export function TeamModal({ card: c, onClose }: { card: CaseCard; onClose: () => void }) {
  const save = useCommand(caseSetTeam);
  const opts = c.teamOptions ?? { supervisors: [], staff: [] };
  const [supervisors, setSupervisors] = useState<string[]>(c.team.filter((t) => t.role === "vocational_supervisor").map((t) => t.userId));
  const [matcher, setMatcher] = useState(c.team.find((t) => t.role === "employer_matcher")?.userId ?? "");
  const [counselor, setCounselor] = useState(c.team.find((t) => t.role === "guidance_counselor")?.userId ?? "");
  const [err, setErr] = useState<string | null>(null);
  const staffOptions = (exclude: string[]) => opts.staff.filter((u) => !exclude.includes(u.id)).map((u) => ({ value: u.id, label: u.name }));
  const submit = async () => {
    const team: { userId: string; role: TeamRole }[] = supervisors.map((userId) => ({ userId, role: "vocational_supervisor" as const }));
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
        <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
          <legend className="mb-0.5 p-0 text-ui font-bold">Handledare</legend>
          <div className="text-small text-text-muted">Yrkesspecifika handledare – alla med rollen handledare i avtalet. De ser ärendets moment, närvaro och praktik.</div>
          {opts.supervisors.length === 0 ? (
            <p className="m-0 text-text-muted">Ingen kollega har rollen handledare ännu. Systemadministratören ger rollen under Användare och roller.</p>
          ) : (
            opts.supervisors.map((u) => (
              <Check key={u.id} id={`arn-team-${u.id}`} checked={supervisors.includes(u.id)} onCheckedChange={(on) => { setErr(null); setSupervisors(on ? [...supervisors, u.id] : supervisors.filter((x) => x !== u.id)); }}>
                {u.name}
              </Check>
            ))
          )}
        </fieldset>
        <FormGrid>
          <Field id="arn-team-matcher" label="Arbetsgivarmatchare (valfritt)" help="Vem som helst av Miljonbemannings personal utom ekonom och systemadministratör.">
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
              { key: "s", icon: "users", children: "Handledaren ser ärendet direkt under Mina tilldelade ärenden och i Närvaro, och får notiser och påminnelser. Den som tas bort får inga fler notiser men kan fortfarande öppna ärendet under Ärenden." },
              { key: "l", icon: "book", children: "Ändringen sparas i revisionsloggen." },
            ]}
          />
        </div>
      </Stack>
    </Modal>
  );
}
