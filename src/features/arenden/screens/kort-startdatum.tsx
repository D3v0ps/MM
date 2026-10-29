"use client";
// Ändra startdatum på deltagarkortet (Karims beslut 2026-10-29). Bara Miljonbemanning: kommunens portal visar det nya
// startdatumet men aldrig ändringen eller motiveringen, och kommunen får inget meddelande. Huvudcoachen (och samordnare,
// avtalsansvarig) ändrar med en kort motivering – den sparas som en låst anteckning i deltagarkortet. Tillfällen före det nya
// datumet utan närvaro (eller med bara automatisk närvaro) tas bort; inga tillfällen skapas bakåt. Planerat slut ändras inte.
// Är en månad som ändringen rör redan fakturerad eller godkänd stoppas ändringen (ekonomen behöver kreditera först), och ett
// tillfälle före det nya datumet med registrerad närvaro stoppar också – felet står vid datumfältet. Knappen står vid
// startdatumet i kortets huvud och ändringarna listas under raden med motiveringen.
import { useState } from "react";
import { plural } from "@/core/format";
import { START_MOTIVATION_MAX, START_MOTIVATION_MIN } from "@/core/start-date";
import { fmtDate, fmtDateShort, holidayName, isWorkingDay } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { Button, cn, DateInput, Field, Kv, Modal, ModalCancelButton, Notice, Stack, TextArea, toast } from "@/ui";
import { caseChangeStart, caseStartView, type CaseStartView } from "../api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Knappen Ändra startdatum med dialogen – vid startdatumet i kortets huvud. Bara för den som får ändra, i en pågående insats. */
export function CaseStartChange({ caseId }: { caseId: string }) {
  const q = useQuery(caseStartView, { caseId });
  const [open, setOpen] = useState(false);
  const v = q.data;
  if (!v || !v.canChange) return null;
  return (
    <>
      <Button kind="ghost" icon="calendar" onClick={() => setOpen(true)}>
        Ändra startdatum
      </Button>
      {open && <StartDateModal v={v} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Ändringarna hittills under raden ("28 jan: 1 feb 2027 → 26 jan 2027 (Amira Haddad)") med motiveringen. Inget utan ändringar. */
export function CaseStartHistory({ caseId, className }: { caseId: string; className?: string }) {
  const q = useQuery(caseStartView, { caseId });
  const v = q.data;
  if (!v || v.history.length === 0) return null;
  return (
    <ul className={cn("m-0 flex list-none flex-col gap-1 p-0 text-small text-text-muted", className)} aria-label="Ändringar av startdatum" data-start-history="">
      {v.history.map((h) => (
        <li key={h.id}>
          {fmtDateShort(h.changedAt)}: startdatum {fmtDate(h.fromDate)} → {fmtDate(h.toDate)} ({h.byName})
          {h.motivation ? <span className="block">Motivering: {h.motivation}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Meningen efter ändringen: borttagna tillfällen, vad coachen gör vid en tidigare start och inbjudningarna. */
export function startChangedText(res: { startDate: string; removed: number; groups: { invited: number; removed: number } | null }, earlier: boolean): string {
  return [
    `Startdatumet är ändrat till ${fmtDate(res.startDate)}.`,
    res.removed ? `${plural(res.removed, "tillfälle", "tillfällen")} före det nya datumet togs bort.` : "",
    earlier ? "Inga tillfällen skapades bakåt – lägg till dem som hände och registrera närvaron under Närvaro." : "",
    res.groups?.invited ? `Deltagaren är inbjuden till ${plural(res.groups.invited, "kommande aktivitet", "kommande aktiviteter")}.` : "",
    res.groups?.removed ? `Deltagaren är borttagen ur ${plural(res.groups.removed, "kommande aktivitet", "kommande aktiviteter")}.` : "",
  ].filter(Boolean).join(" ");
}

function StartDateModal({ v, onClose }: { v: CaseStartView; onClose: () => void }) {
  const save = useCommand(caseChangeStart);
  const current = v.startDate ?? "";
  const [date, setDate] = useState(current);
  const [motivation, setMotivation] = useState("");
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ date?: string; motivation?: string }>({});
  const len = motivation.trim().length;
  // Samma kontroller som servern (planStartChange) för det som syns här – fakturan och närvaron prövas av servern.
  const localDateErr = !DATE_RE.test(date)
    ? "Välj det nya startdatumet."
    : date === current
      ? "Det är redan insatsens startdatum. Välj ett annat datum."
      : v.earliest && date < v.earliest
        ? `Startdatumet kan inte vara före första mötet ${fmtDate(v.earliest)}.`
        : v.latest && date > v.latest
          ? `Startdatumet kan inte vara efter planerat slut ${fmtDate(v.latest)}.`
          : null;
  const dateErr = (tried ? localDateErr : null) ?? serverErr.date ?? null;
  const motErr = tried && (len < START_MOTIVATION_MIN || len > START_MOTIVATION_MAX)
    ? `Skriv en kort motivering, ${START_MOTIVATION_MIN}–${START_MOTIVATION_MAX} tecken.`
    : (serverErr.motivation ?? null);
  const dirty = date !== current || motivation.trim() !== "";
  const submit = async () => {
    setTried(true);
    if (localDateErr || len < START_MOTIVATION_MIN || len > START_MOTIVATION_MAX) return;
    const res = await save.run({ caseId: v.caseId, startDate: date, expectedStartDate: current, motivation: motivation.trim() }).catch(() => null);
    if (!res || !res.ok) {
      if (res && !res.ok && (res.error === "motivation" || res.error === "pnr")) setServerErr({ motivation: res.message });
      else if (res && !res.ok && ["wrong_status", "same", "before_meeting", "after_end", "invoiced", "attendance"].includes(res.error)) setServerErr({ date: res.message });
      else toast(res && !res.ok && res.message ? res.message : "Startdatumet kunde inte ändras.", "error");
      return;
    }
    toast(startChangedText(res, date < current));
    onClose();
  };
  return (
    <Modal
      title="Ändra startdatum"
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          {/* Avbryt frågar som krysset när något är ifyllt (dirty). */}
          <ModalCancelButton />
          <Button kind="primary" icon="check" pending={save.pending} onClick={() => void submit()}>Ändra startdatum</Button>
        </>
      }
    >
      <Stack>
        <Kv
          items={[
            ["Nuvarande startdatum", fmtDate(current)],
            ["Första mötet", v.earliest ? fmtDate(v.earliest) : "Inte registrerat"],
            ["Planerat slut", v.latest ? fmtDate(v.latest) : "Inte angivet"],
          ]}
        />
        <Field
          id="arn-startdatum-ny"
          label="Nytt startdatum"
          required
          error={dateErr}
          help={`Tidigast första mötets dag${v.earliest ? ` (${fmtDate(v.earliest)})` : ""}${v.latest ? `, senast ${fmtDate(v.latest)}` : ""}. Veckorna i fakturaunderlaget räknas från startdatumet.`}
        >
          <DateInput
            value={date}
            invalid={!!dateErr}
            onValueChange={(x) => {
              setDate(x);
              setServerErr((e) => ({ ...e, date: undefined }));
            }}
          />
        </Field>
        {DATE_RE.test(date) && date !== current && !isWorkingDay(date) && (
          <Notice tone="warn" title="Inte en arbetsdag">{holidayName(date) ?? "Dagen"} är ingen arbetsdag. Startdatumet kan ändå vara den dagen.</Notice>
        )}
        <Field
          id="arn-startdatum-varfor"
          label="Motivering"
          required
          error={motErr}
          help="Kort varför, till exempel att deltagaren började en annan dag än den som registrerades. Skriv inga personnummer. Kommunen ser aldrig motiveringen."
        >
          <TextArea
            rows={3}
            value={motivation}
            maxLength={START_MOTIVATION_MAX}
            invalid={!!motErr}
            onValueChange={(x) => {
              setMotivation(x);
              setServerErr((e) => ({ ...e, motivation: undefined }));
            }}
          />
        </Field>
        <Notice tone="info" title="Det här händer">
          Tillfällen före det nya datumet utan närvaro tas bort. Inga tillfällen skapas bakåt – lägg till dem som hände och registrera närvaron. Planerat slut
          ändras inte. Motiveringen sparas som en anteckning i deltagarkortet och kan inte ändras efteråt. Kommunen ser det nya startdatumet i portalen men får
          inget meddelande. Är en månad som ändringen rör redan fakturerad stoppas ändringen – då behöver ekonomen kreditera fakturan först.
        </Notice>
      </Stack>
    </Modal>
  );
}
