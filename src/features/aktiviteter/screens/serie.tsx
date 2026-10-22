"use client";
// Återkommande aktivitet (Karims beslut 2026-10-22): Ändra (namn, plats, ansvarig, gruppmål och meddelandet – gäller kommande
// tillfällen som inte har börjat) och Avsluta serien (sista dagen blir i dag och kommande tillfällen utan närvaro ställs in). Dag,
// tid och längd ändras inte – då avslutas serien och en ny skapas. Delas av listan (Återkommande) och aktivitetsvyn.
import { useState } from "react";
import { plural } from "@/core/format";
import { GROUP_GOAL_MAX } from "@/data/schema";
import { useCommand } from "@/shell/backend";
import { Button, Check, ErrorNotice, Field, FormGrid, Input, Loading, Modal, Notice, Select, Stack, toast, useConfirm } from "@/ui";
import { groupActivitySeriesEnd, groupActivitySeriesUpdate } from "../api";
import { notifiedText, SERIES_NOTIFY_HELP, useActivityFormData } from "./form";

export type SeriesEditable = { id: string; name: string; location: string; responsibleId: string | null; goal: string | null; notify: boolean; schedule: string };

/** Avsluta serien: frågar först och säger vad som händer. Returnerar true när serien avslutades. */
export function useEndSeries() {
  const end = useCommand(groupActivitySeriesEnd);
  const confirm = useConfirm();
  const run = async (s: { id: string; name: string; schedule: string; notify: boolean }): Promise<boolean> => {
    const ok = await confirm({
      title: "Avsluta den återkommande aktiviteten?",
      body: (
        <Stack gap="sm">
          <p className="m-0">{`${s.name} (${s.schedule}) avslutas i dag. Inga nya tillfällen skapas, och kommande tillfällen utan registrerad närvaro ställs in.`}</p>
          <p className="m-0">{s.notify ? "Deltagarna får ett meddelande om att tillfällena är inställda." : "Deltagarna får inget meddelande – meddelandet är avstängt för den här aktiviteten."}</p>
        </Stack>
      ),
      confirmLabel: "Avsluta serien",
      cancelLabel: "Avbryt",
      tone: "danger",
    });
    if (!ok) return false;
    const res = await end.run({ id: s.id }).catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Den återkommande aktiviteten kunde inte avslutas.", "error");
      return false;
    }
    toast(
      `Den återkommande aktiviteten är avslutad.${res.cancelled ? ` ${plural(res.cancelled, "kommande tillfälle är inställt", "kommande tillfällen är inställda")}.` : ""}${res.kept ? ` ${plural(res.kept, "tillfälle", "tillfällen")} med närvaro ligger kvar.` : ""}${notifiedText(res.notified)}`,
    );
    return true;
  };
  return { run, pending: end.pending };
}

/** Ändra en återkommande aktivitet. */
export function SeriesEditModal({ s, onClose }: { s: SeriesEditable; onClose: () => void }) {
  const { data, error, retry } = useActivityFormData();
  const update = useCommand(groupActivitySeriesUpdate);
  const initial = { name: s.name, location: s.location, responsibleId: s.responsibleId ?? "", goal: s.goal ?? "", notify: s.notify };
  const [value, setValue] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof typeof value>(k: K) => (v: (typeof value)[K]) => setValue((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    setProblem(null);
    if (!value.name.trim() || !value.location.trim()) {
      setProblem("Skriv namn och plats.");
      return;
    }
    const res = await update.run({
      id: s.id, name: value.name.trim(), location: value.location.trim(), responsibleId: value.responsibleId || null, goal: value.goal.trim() || null, notify: value.notify,
    }).catch(() => null);
    if (!res || !res.ok) {
      setProblem(res && !res.ok && res.message ? res.message : "Ändringen kunde inte sparas.");
      return;
    }
    toast(res.changed ? `Ändringen gäller ${plural(res.occurrences, "kommande tillfälle", "kommande tillfällen")}.${notifiedText(res.notified)}` : "Inget var ändrat.");
    onClose();
  };
  return (
    <Modal
      title="Ändra den återkommande aktiviteten"
      wide
      onClose={onClose}
      dirty={JSON.stringify(value) !== JSON.stringify(initial)}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button kind="primary" icon="check" pending={update.pending} disabled={!data} onClick={() => void submit()}>
            Spara
          </Button>
        </>
      }
    >
      {!data ? (
        error ? <ErrorNotice error={error as Error} onRetry={retry} /> : <Loading />
      ) : (
        <Stack>
          <Notice tone="info" icon="info" title={`Varje vecka ${s.schedule}`}>
            Ändringen gäller alla kommande tillfällen som inte har börjat. Dag, tid och längd ändras inte – avsluta i stället den återkommande aktiviteten och skapa en ny.
          </Notice>
          {problem && <Notice tone="warn" title={problem} />}
          <FormGrid>
            <Field id="serie-namn" label="Namn" help="Syns bara för Miljonbemanning." required full>
              <Input value={value.name} onValueChange={set("name")} maxLength={120} />
            </Field>
            <Field id="serie-plats" label="Plats" help="Platsen står i inbjudan till deltagarna." required>
              <Input value={value.location} onValueChange={set("location")} maxLength={200} />
            </Field>
            <Field id="serie-ansvarig" label="Ansvarig coach" help="Valfritt.">
              <Select value={value.responsibleId} onValueChange={set("responsibleId")} placeholder="Ingen ansvarig" options={data.coaches.map((c) => ({ value: c.id, label: c.name }))} />
            </Field>
            <Field id="serie-mal" label="Gruppmål" help="Valfritt. Gäller varje tillfälle. Syns bara för Miljonbemanning." full>
              <Input value={value.goal} onValueChange={set("goal")} maxLength={GROUP_GOAL_MAX} />
            </Field>
          </FormGrid>
          <Check id="serie-meddela" checked={value.notify} onCheckedChange={set("notify")} aria-describedby="serie-meddela-hjalp">
            <span className="font-bold">Meddela deltagarna inför varje tillfälle</span>
            <span id="serie-meddela-hjalp" className="block text-body text-text-muted">
              {SERIES_NOTIFY_HELP}
            </span>
          </Check>
        </Stack>
      )}
    </Modal>
  );
}
