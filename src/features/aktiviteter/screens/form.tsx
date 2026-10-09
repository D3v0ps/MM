"use client";
// Fälten för en gruppaktivitet (namn, typ, datum, tid, längd, plats, ansvarig) – samma i Ny aktivitet och i Ändra-dialogen.
// Formulärets data (typer, coacher, deltagare att bjuda in, helgdagar) hämtas färskt varje gång formuläret öppnas
// (useQueryRunner, ingen cache): en deltagare som just startat eller avslutats syns som den är. Servern prövar ändå allt igen.
import { useCallback, useEffect, useState } from "react";
import { dayOf, fmtDate, timeOf, type LocalDate } from "@/core/time";
import { useQueryRunner } from "@/shell/backend";
import { Field, FormGrid, Input, Notice, Select, useConfirm, DateInput, TimeInput } from "@/ui";
import { durationLabel } from "@/features/arenden/screens/kort-start";
import type { GroupActivityKind } from "@/data/schema";
import { groupActivityForm, type GroupActivityForm, type InviteProblem } from "../api";

export type ActivityFormState = { name: string; kind: GroupActivityKind; date: string; time: string; durationMin: number; location: string; responsibleId: string };

const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 420, 480];
const durationOptions = (current: number) => [...new Set([...DURATIONS, current])].sort((a, b) => a - b).map((m) => ({ value: String(m), label: durationLabel(m) }));

/** Formulärets data, hämtad utan cache när formuläret öppnas. */
export function useActivityFormData(): { data: GroupActivityForm | null; error: unknown; retry: () => void } {
  const runQuery = useQueryRunner();
  const [data, setData] = useState<GroupActivityForm | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    runQuery(groupActivityForm, {})
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e: unknown) => {
        if (alive) setError(e);
      });
    return () => {
      alive = false;
    };
  }, [runQuery, round]);
  const retry = useCallback(() => {
    setError(null);
    setRound((r) => r + 1);
  }, []);
  return { data, error, retry };
}

/** Startvärden: i morgon kl. 13.00, 90 minuter, avtalets plats och den inloggade som ansvarig om hen är coach. */
export function blankForm(f: GroupActivityForm, tomorrow: LocalDate): ActivityFormState {
  return { name: "", kind: "yrkesmoment", date: tomorrow, time: "13:00", durationMin: 90, location: f.defaultLocation, responsibleId: f.me ?? "" };
}
/** Formulärets värden ur en befintlig aktivitet. */
export function formOf(a: { name: string; kind: GroupActivityKind; startsAt: string; durationMin: number; location: string; responsibleId: string | null }): ActivityFormState {
  return { name: a.name, kind: a.kind, date: dayOf(a.startsAt), time: timeOf(a.startsAt), durationMin: a.durationMin, location: a.location, responsibleId: a.responsibleId ?? "" };
}

/** Felen i klarspråk per fält. */
export function formErrors(s: ActivityFormState): Partial<Record<"name" | "date" | "time" | "location", string>> {
  const e: Partial<Record<"name" | "date" | "time" | "location", string>> = {};
  if (!s.name.trim()) e.name = "Skriv vad aktiviteten heter.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) e.date = "Välj datum.";
  if (!/^\d{2}:\d{2}$/.test(s.time)) e.time = "Välj tid.";
  if (!s.location.trim()) e.location = "Skriv var aktiviteten är.";
  return e;
}

/** Värdena till kommandot. */
export const payloadOf = (s: ActivityFormState) => ({
  name: s.name.trim(), kind: s.kind, startsAt: `${s.date}T${s.time}`, durationMin: s.durationMin, location: s.location.trim(), responsibleId: s.responsibleId || null,
});

/** Helgdagens namn för datumet (formulärets lista), eller null. */
export const holidayOf = (f: GroupActivityForm, date: string): string | null => f.holidays.find((h) => h.date === date)?.name ?? null;

export function ActivityFields({
  form, value, onChange, tried, idPrefix,
}: {
  form: GroupActivityForm;
  value: ActivityFormState;
  onChange: (next: ActivityFormState) => void;
  tried: boolean;
  idPrefix: string;
}) {
  const errs = tried ? formErrors(value) : {};
  const set = <K extends keyof ActivityFormState>(k: K) => (v: ActivityFormState[K]) => onChange({ ...value, [k]: v });
  const holiday = holidayOf(form, value.date);
  return (
    <FormGrid>
      <Field id={`${idPrefix}-namn`} label="Namn" help="Till exempel CV-verkstad. Namnet syns bara för Miljonbemanning." required error={errs.name} full>
        <Input value={value.name} onValueChange={set("name")} maxLength={120} />
      </Field>
      <Field id={`${idPrefix}-typ`} label="Typ" help="Typen syns i närvaron och i veckorapporten till kommunen." required>
        <Select value={value.kind} onValueChange={(v) => set("kind")(v as GroupActivityKind)} options={form.kinds} />
      </Field>
      <Field id={`${idPrefix}-ansvarig`} label="Ansvarig coach" help="Valfritt.">
        <Select value={value.responsibleId} onValueChange={set("responsibleId")} placeholder="Ingen ansvarig" options={form.coaches.map((c) => ({ value: c.id, label: c.name }))} />
      </Field>
      <Field id={`${idPrefix}-datum`} label="Datum" required error={errs.date}>
        <DateInput value={value.date} onValueChange={set("date")} />
      </Field>
      <Field id={`${idPrefix}-tid`} label="Tid" help="När aktiviteten börjar." required error={errs.time}>
        <TimeInput value={value.time} onValueChange={set("time")} />
      </Field>
      <Field id={`${idPrefix}-langd`} label="Längd" required>
        <Select value={String(value.durationMin)} onValueChange={(v) => set("durationMin")(Number(v))} options={durationOptions(value.durationMin)} />
      </Field>
      <Field id={`${idPrefix}-plats`} label="Plats" required error={errs.location}>
        <Input value={value.location} onValueChange={set("location")} maxLength={200} />
      </Field>
      {holiday && (
        <div className="col-span-full">
          <Notice tone="warn" icon="calendar" title="Helgdag">
            {fmtDate(value.date)} är en helgdag ({holiday}). Du får bekräfta om aktiviteten ska ligga där ändå. Närvaron registreras inte automatiskt på helgdagar.
          </Notice>
        </div>
      )}
    </FormGrid>
  );
}

/** Deltagarna som stoppade: "BOT-26-0143: Insatsen är avslutad". */
export function ProblemList({ problems }: { problems: readonly InviteProblem[] }) {
  return (
    <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
      {problems.map((p) => (
        <li key={p.caseId}>
          <span className="tabular-nums">{p.caseNumber}</span>: {p.reason}
        </li>
      ))}
    </ul>
  );
}

/** Skicka kommandot – vid helgdag frågar dialogen först och skickar sedan igen med acceptHoliday. */
export function useHolidayConfirm() {
  const confirm = useConfirm();
  return async <R extends { ok: boolean; error?: string; message?: string }>(send: (acceptHoliday: boolean) => Promise<R | null>): Promise<R | null> => {
    const first = await send(false);
    if (!first || first.ok || first.error !== "holiday") return first;
    const ok = await confirm({ title: "Lägga aktiviteten på en helgdag?", body: first.message ?? "Dagen är en helgdag.", confirmLabel: "Ja, lägg den där", cancelLabel: "Välj en annan dag" });
    return ok ? send(true) : null;
  };
}
