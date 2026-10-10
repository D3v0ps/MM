"use client";
// Fälten för en gruppaktivitet (namn, typ, datum, tid, längd, plats, ansvarig, gruppmål) – samma i Ny aktivitet och i Ändra-dialogen.
// Formulärets data (typer, coacher, deltagare att bjuda in, helgdagar) hämtas färskt varje gång formuläret öppnas
// (useQueryRunner, ingen cache): en deltagare som just startat eller avslutats syns som den är. Servern prövar ändå allt igen.
import { useCallback, useEffect, useState } from "react";
import { plural } from "@/core/format";
import { dayOf, fmtDate, timeOf, type LocalDate } from "@/core/time";
import { useQueryRunner } from "@/shell/backend";
import { Check, Field, FormGrid, Input, Notice, Select, useConfirm, DateInput, TimeInput } from "@/ui";
import { durationLabel } from "@/features/arenden/screens/kort-start";
import { GROUP_GOAL_MAX, type GroupActivityKind } from "@/data/schema";
import { groupActivityForm, type GroupActivityForm, type InviteProblem, type NotifyOutcome } from "../api";

export type ActivityFormState = {
  name: string; kind: GroupActivityKind; date: string; time: string; durationMin: number; location: string; responsibleId: string;
  /** Gruppmålet (internt). Tomt = inget mål. */
  goal: string;
};

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
  return { name: "", kind: "yrkesmoment", date: tomorrow, time: "13:00", durationMin: 90, location: f.defaultLocation, responsibleId: f.me ?? "", goal: "" };
}
/** Formulärets värden ur en befintlig aktivitet. */
export function formOf(a: { name: string; kind: GroupActivityKind; startsAt: string; durationMin: number; location: string; responsibleId: string | null; goal: string | null }): ActivityFormState {
  return {
    name: a.name, kind: a.kind, date: dayOf(a.startsAt), time: timeOf(a.startsAt), durationMin: a.durationMin, location: a.location, responsibleId: a.responsibleId ?? "",
    goal: a.goal ?? "",
  };
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
  goal: s.goal.trim() || null,
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
      <Field id={`${idPrefix}-plats`} label="Plats" help="Platsen står i inbjudan till deltagarna." required error={errs.location}>
        <Input value={value.location} onValueChange={set("location")} maxLength={200} />
      </Field>
      <Field
        id={`${idPrefix}-mal`}
        label="Gruppmål"
        help="Valfritt. Ett mål för hela gruppen, till exempel Alla skriver ett CV. Alla räknas som att de klarade målet tills du markerar något annat. Syns bara för Miljonbemanning."
        full
      >
        <Input value={value.goal} onValueChange={set("goal")} maxLength={GROUP_GOAL_MAX} />
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

/** " 2 tillfällen vid samma tid är ersatta." – tom text när inget ersattes. */
export const replacedText = (n: number): string => (n ? ` ${plural(n, "tillfälle", "tillfällen")} vid samma tid ${n === 1 ? "är ersatt" : "är ersatta"}.` : "");

/** Det användaren har bekräftat: helgdagen, och att deltagarnas egna tillfällen vid samma tid ersätts. */
export type ActivityConfirmations = { acceptHoliday: boolean; replaceOverlapping: boolean };

/**
 * Skicka kommandot – frågar först och skickar sedan igen: vid helgdag (holiday → acceptHoliday) och när deltagare redan har ett
 * eget tillfälle vid samma tid (overlap → replaceOverlapping, dialogen räknar upp vilka). Avbryter användaren blir svaret null.
 */
export function useActivityConfirm() {
  const confirm = useConfirm();
  return async <R extends { ok: boolean; error?: string; message?: string }>(send: (c: ActivityConfirmations) => Promise<R | null>): Promise<R | null> => {
    const c: ActivityConfirmations = { acceptHoliday: false, replaceOverlapping: false };
    for (;;) {
      const res = await send({ ...c });
      if (!res || res.ok) return res;
      if (res.error === "holiday" && !c.acceptHoliday) {
        if (!(await confirm({ title: "Lägga aktiviteten på en helgdag?", body: res.message ?? "Dagen är en helgdag.", confirmLabel: "Ja, lägg den där", cancelLabel: "Välj en annan dag" }))) return null;
        c.acceptHoliday = true;
        continue;
      }
      if (res.error === "overlap" && !c.replaceOverlapping) {
        const problems = "problems" in res ? (res as { problems: InviteProblem[] }).problems : [];
        const ok = await confirm({
          title: "Ersätta tillfällen vid samma tid?",
          body: (
            <div className="flex flex-col gap-2">
              <p className="m-0">{res.message}</p>
              <ProblemList problems={problems} />
            </div>
          ),
          confirmLabel: "Ja, ersätt dem",
          cancelLabel: "Avbryt",
        });
        if (!ok) return null;
        c.replaceOverlapping = true;
        continue;
      }
      return res;
    }
  };
}

/** Startar aktiviteten efter nu? Bara då skickas meddelanden till deltagarna (servern gör samma kontroll). */
export const isUpcoming = (startsAt: string, now: string): boolean => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startsAt) && startsAt > now;

/**
 * Kryssrutan för meddelandet till deltagarna (förvald). Bara för en aktivitet som inte har börjat – annars en mening om att
 * inget skickas. Meddelandet innehåller bara tid, plats och Miljonbemannings telefonnummer.
 */
export function NotifyCheck({ id, checked, onChange, label, upcoming }: { id: string; checked: boolean; onChange: (on: boolean) => void; label: string; upcoming: boolean }) {
  if (!upcoming) return <p className="m-0 text-body text-text-muted">Aktiviteten har redan börjat. Inget meddelande skickas till deltagarna.</p>;
  return (
    <Check id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-hjalp`}>
      <span className="font-bold">{label}</span>
      <span id={`${id}-hjalp`} className="block text-body text-text-muted">
        E-post eller SMS med tid, plats och Miljonbemannings telefonnummer – inga namn. Den som inte går att nå ringer samordnaren.
      </span>
    </Check>
  );
}

/** Hur meddelandet gick, som en mening efter toasten ("" när inget skickades). */
export const notifiedText = (n: NotifyOutcome | undefined): string => (n ? ` ${n.summary}` : "");

/** De som servern hoppade över (inbjudan per grupp eller nivå): "1 deltagare hoppades över: BOT-26-0130 (är redan inbjuden …)." */
export const skippedText = (skipped: readonly InviteProblem[] | undefined): string =>
  skipped?.length ? ` ${plural(skipped.length, "deltagare hoppades över", "deltagare hoppades över")}: ${skipped.map((x) => `${x.caseNumber} (${x.reason.charAt(0).toLocaleLowerCase("sv")}${x.reason.slice(1)})`).join(", ")}.` : "";
