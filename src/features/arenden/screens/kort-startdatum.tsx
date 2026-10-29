"use client";
// Ändra startdatum på deltagarkortet (Karims beslut 2026-10-29). Bara Miljonbemanning: kommunens portal visar det nya
// startdatumet men aldrig ändringen eller motiveringen, och kommunen får inget meddelande. Huvudcoachen (och samordnare,
// avtalsansvarig) ändrar med en kort motivering – den sparas som en låst anteckning i deltagarkortet. Tillfällen före det nya
// datumet utan registrerad närvaro eller med bara automatisk närvaro tas bort (den automatiska närvaron med dem); inga tillfällen
// skapas bakåt. Planerat slut ändras inte. Är en månad som ändringen rör redan fakturerad eller godkänd stoppas ändringen
// (kontakta ekonomen), och ett tillfälle med registrerad närvaro, en godkänd mötesrapport före det nya datumet eller en lämnad
// eller godkänd månadsrapport för en månad som blir för kort stoppar också – felet står vid datumfältet. Knappen står bland
// åtgärderna i kortets huvud (bara i en pågående eller pausad insats – raden med startdatumet ska rymmas på en rad) och
// ändringarna listas under raden med startdatumet, med motiveringen.
// Knappen och dialogen läser kortet (CaseCard.startChange, startdatum, första mötet och planerat slut); raden med ändringarna
// hämtar arenden.startdatum bara när ärendet har ändrat startdatum – kortet gör ingen egen fråga i onödan.
import { useState } from "react";
import { plural } from "@/core/format";
import { START_MOTIVATION_MAX, START_MOTIVATION_MIN } from "@/core/start-date";
import { dayOf, fmtDate, fmtDateShort, holidayName, isWorkingDay, monthName, type LocalDate, type MonthKey } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { Button, cn, DateInput, Field, Kv, Modal, ModalCancelButton, Notice, Stack, TextArea, toast } from "@/ui";
import { caseChangeStart, caseStartView, type CaseCard } from "../api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Det dialogen behöver ur kortet: ärendet, startdatumet och gränserna för ett nytt datum. */
type StartDialogData = { caseId: string; startDate: LocalDate | null; earliest: LocalDate | null; latest: LocalDate | null };

/**
 * Knappen Ändra startdatum med dialogen – bland åtgärderna i kortets huvud (CaseActions). Bara för den som får ändra, i en pågående
 * eller pausad insats (card.startChange.canChange).
 */
export function CaseStartChange({ card, className }: {
  card: Pick<CaseCard, "caseId" | "startDate" | "firstMeetingAt" | "endDate" | "plannedEnd" | "startChange">;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!card.startChange.canChange) return null;
  const v: StartDialogData = {
    caseId: card.caseId, startDate: card.startDate, earliest: card.firstMeetingAt ? dayOf(card.firstMeetingAt) : null, latest: card.endDate ?? card.plannedEnd,
  };
  return (
    <>
      <Button icon="calendar" className={className} onClick={() => setOpen(true)}>
        Ändra startdatum
      </Button>
      {open && <StartDateModal v={v} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Ändringarna hittills under raden ("28 jan: 1 feb 2027 → 26 jan 2027 (Amira Haddad)") med motiveringen. Inget utan ändringar –
 * frågan arenden.startdatum görs bara när kortet säger att det finns ändringar (changes).
 */
export function CaseStartHistory({ caseId, changes, className }: { caseId: string; changes: number; className?: string }) {
  const q = useQuery(caseStartView, { caseId }, { enabled: changes > 0 });
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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const listSv = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} och ${xs[xs.length - 1]}`);

/**
 * Meningen efter ändringen: borttagna tillfällen, vad coachen gör vid en tidigare start, månader utan månadsrapport (och om deras
 * utkast togs bort – bara när det fanns några), rapporter att rätta, inbjudningarna (deltagaren får aktivitetens vanliga meddelande)
 * och om något återstår.
 */
export function startChangedText(
  res: {
    startDate: string; removed: number; groups: { invited: number; removed: number } | null; droppedMonths: readonly MonthKey[]; draftMonths: readonly MonthKey[];
    corrections: number; incomplete: boolean;
  },
  earlier: boolean,
): string {
  const withDrafts = res.droppedMonths.filter((m) => res.draftMonths.includes(m)).map(monthName);
  const without = res.droppedMonths.filter((m) => !res.draftMonths.includes(m)).map(monthName);
  const g = res.groups;
  return [
    `Startdatumet är ändrat till ${fmtDate(res.startDate)}.`,
    res.removed ? `${plural(res.removed, "tillfälle", "tillfällen")} före det nya datumet togs bort.` : "",
    earlier ? "Inga tillfällen skapades bakåt – lägg till dem som hände och registrera närvaron under Närvaro." : "",
    withDrafts.length
      ? `${cap(listSv(withDrafts))} har nu för få dagar för en månadsrapport. Utkasten till månadsrapport och månadsbedömning för ${withDrafts.length === 1 ? "månaden" : "månaderna"} togs bort.`
      : "",
    without.length ? `${cap(listSv(without))} har nu för få dagar för en månadsrapport och får ingen månadsrapport eller månadsbedömning.` : "",
    res.corrections
      ? `${plural(res.corrections, "rapport", "rapporter")} är redan ${res.corrections === 1 ? "lämnad" : "lämnade"} till kommunen. Samordnaren har fått en uppgift att rätta ${res.corrections === 1 ? "den" : "dem"}.`
      : "",
    g?.invited ? `Deltagaren är inbjuden till ${plural(g.invited, "kommande aktivitet", "kommande aktiviteter")}.` : "",
    g?.removed ? `Deltagaren är borttagen ur ${plural(g.removed, "kommande aktivitet", "kommande aktiviteter")}.` : "",
    g?.invited || g?.removed ? "Deltagaren får aktivitetens vanliga meddelande med tid och plats, om aktiviteten skickar meddelanden." : "",
    res.incomplete ? "Allt hann inte göras klart. Resten görs klart automatiskt." : "",
  ].filter(Boolean).join(" ");
}

function StartDateModal({ v, onClose }: { v: StartDialogData; onClose: () => void }) {
  const save = useCommand(caseChangeStart);
  const current = v.startDate ?? "";
  const [date, setDate] = useState(current);
  const [motivation, setMotivation] = useState("");
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<{ date?: string; motivation?: string }>({});
  const len = motivation.trim().length;
  const tooLong = len > START_MOTIVATION_MAX;
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
  const motErr = (tried && len < START_MOTIVATION_MIN) || tooLong
    ? `Skriv en kort motivering, ${START_MOTIVATION_MIN}–${START_MOTIVATION_MAX} tecken.`
    : (serverErr.motivation ?? null);
  const dirty = date !== current || motivation.trim() !== "";
  const submit = async () => {
    setTried(true);
    if (localDateErr || len < START_MOTIVATION_MIN || tooLong) return;
    const res = await save.run({ caseId: v.caseId, startDate: date, expectedStartDate: current, motivation: motivation.trim() }).catch(() => null);
    if (!res || !res.ok) {
      if (res && !res.ok && (res.error === "motivation" || res.error === "pnr")) setServerErr({ motivation: res.message });
      else if (res && !res.ok && ["wrong_status", "same", "before_meeting", "after_end", "invoiced", "attendance", "report"].includes(res.error)) setServerErr({ date: res.message });
      // Inget svar (nätet): ändringen kan ha sparats – samma ändring igen gör den klar och svarar som första gången.
      else toast(res && !res.ok && res.message ? res.message : "Det gick inte att se om startdatumet ändrades. Försök igen – har det redan ändrats görs ändringen klar.", "error");
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
          help={`Kort varför, till exempel att deltagaren började en annan dag än den som registrerades. Skriv ${START_MOTIVATION_MIN}–${START_MOTIVATION_MAX} tecken. Skriv inga personnummer. Kommunen ser aldrig motiveringen.`}
        >
          <TextArea
            rows={3}
            value={motivation}
            invalid={!!motErr}
            aria-describedby="arn-startdatum-varfor-count"
            onValueChange={(x) => {
              setMotivation(x);
              setServerErr((e) => ({ ...e, motivation: undefined }));
            }}
          />
          {/* Räknaren läses som beskrivning av fältet – inte vid varje tangenttryckning. */}
          <div id="arn-startdatum-varfor-count" className={cn("text-small", tooLong ? "font-bold" : "text-text-muted")}>
            {len} av {START_MOTIVATION_MAX} tecken
          </div>
        </Field>
        <Notice tone="info" title="Det här händer">
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
            <li>
              Flyttas starten senare tas tillfällena före det nya datumet bort, om de saknar registrerad närvaro eller bara har automatisk närvaro. Den
              automatiska närvaron tas bort med dem.
            </li>
            <li>Inga tillfällen skapas bakåt – lägg till dem som hände och registrera närvaron. Planerat slut ändras inte.</li>
            <li>
              Får en månad för få dagar för en månadsrapport tas utkasten till månadsrapport och månadsbedömning bort. Har coachen sparat månadsbedömningen går det
              inte – det coachen skrivit tas aldrig bort.
            </li>
            <li>Är rapporter redan lämnade till kommunen får samordnaren en uppgift att rätta dem.</li>
            <li>
              Läggs deltagaren till i eller tas bort ur en kommande gruppaktivitet får deltagaren aktivitetens vanliga meddelande med tid och plats. Kommunen
              får inget meddelande men ser det nya startdatumet i portalen.
            </li>
            <li>Motiveringen sparas som en anteckning i deltagarkortet och kan inte ändras efteråt.</li>
            <li>Är en månad som ändringen rör redan fakturerad eller godkänd går det inte att ändra – kontakta ekonomen.</li>
          </ul>
        </Notice>
      </Stack>
    </Modal>
  );
}
