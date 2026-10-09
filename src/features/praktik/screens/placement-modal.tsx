"use client";
// Ny praktik och Avsluta praktik (beslut 2026-10-08): dialogerna delas av deltagarkortets flik Praktik och arbetsgivarsidan
// under Arbetsgivare och praktik. Skapar placeringen, händelsen praktik_startad och praktikdagarna som tillfällen.
import { useState } from "react";
import { plural } from "@/core/format";
import { addDays, dayOf, fmtDate, WEEKDAYS } from "@/core/time";
import { emailValid } from "@/core/validation";
import { useCommand, useQuery } from "@/shell/backend";
import { Button, DateInput, Field, FormGrid, Input, Kv, Loading, Modal, Notice, Seg, Select, Stack, TextArea, TimeInput, toast } from "@/ui";
import { placementCreate, placementEnd, praktikList } from "../api";

const NEW = "__ny__";
const HOURS = [4, 5, 6, 7, 8].map((h) => ({ value: String(h * 60), label: `${h} timmar` }));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type PlacementCaseOption = { caseId: string; caseNumber: string; name: string; plannedEnd: string | null };

/**
 * Ny praktik. Antingen ett fast ärende (deltagarkortet) eller ett val bland ärenden (arbetsgivarsidan, employerId förvalt).
 * now = klockan ur vy-modellen (förval för startdagen).
 */
export function PlacementModal({
  cases, caseId, employerId, now, onClose,
}: { cases: PlacementCaseOption[]; caseId?: string | null; employerId?: string | null; now: string; onClose: () => void }) {
  const q = useQuery(praktikList, {});
  const create = useCommand(placementCreate);
  const today = dayOf(now);
  const [sel, setSel] = useState(caseId && cases.some((x) => x.caseId === caseId) ? caseId : cases.length === 1 ? cases[0].caseId : "");
  const chosen = cases.find((x) => x.caseId === sel) ?? null;
  const [emp, setEmp] = useState(employerId ?? "");
  const [f, setF] = useState({ name: "", city: "", contactName: "", phone: "", email: "", supervisorName: "", startsOn: today, endsOn: "", tasks: "" });
  const [weekdays, setWeekdays] = useState<string[]>(["0", "1", "2", "3", "4"]);
  const [time, setTime] = useState("08:00");
  const [duration, setDuration] = useState(420);
  const [tried, setTried] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const employers = q.data?.employers ?? [];
  const employer = employers.find((e) => e.id === emp) ?? null;
  const isNew = emp === NEW;
  const errs = {
    sel: !sel ? "Välj deltagare." : null,
    emp: !emp ? "Välj arbetsgivare, eller Ny arbetsgivare." : null,
    name: isNew && !f.name.trim() ? "Skriv arbetsgivarens namn." : null,
    email: isNew && f.email.trim() && !emailValid(f.email.trim()) ? "E-postadressen ser inte ut att stämma." : null,
    startsOn: !/^\d{4}-\d{2}-\d{2}$/.test(f.startsOn) ? "Välj startdag." : null,
    endsOn: f.endsOn && f.endsOn < f.startsOn ? "Slutdagen måste komma efter startdagen." : null,
    weekdays: !weekdays.length ? "Välj minst en praktikdag i veckan." : null,
  };
  const hasError = Object.values(errs).some(Boolean);
  const submit = async () => {
    setTried(true);
    if (hasError) return;
    const res = await create
      .run({
        caseId: sel,
        employerId: isNew ? null : emp,
        newEmployer: isNew ? { name: f.name.trim(), city: f.city.trim(), contactName: f.contactName.trim(), phone: f.phone.trim(), email: f.email.trim() } : undefined,
        supervisorName: f.supervisorName.trim(), startsOn: f.startsOn, endsOn: f.endsOn || null, weekdays: weekdays.map(Number), time, durationMin: duration, tasks: f.tasks.trim(),
      })
      .catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Praktiken kunde inte sparas.", "error");
      return;
    }
    toast(`Praktiken hos ${isNew ? f.name.trim() : (employer?.name ?? "arbetsgivaren")} är registrerad. ${plural(res.days, "praktikdag", "praktikdagar")} är inplanerade.`);
    onClose();
  };
  const until = f.endsOn || chosen?.plannedEnd || null;
  return (
    <Modal
      title="Ny praktik"
      onClose={onClose}
      wide
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="briefcase" pending={create.pending} onClick={() => void submit()}>Spara praktiken</Button>
        </>
      }
    >
      {!q.data ? (
        <Loading />
      ) : (
        <Stack>
          {cases.length > 1 ? (
            <Field id="pl-case" label="Deltagare" required error={tried ? errs.sel : null}>
              <Select value={sel} onValueChange={setSel} placeholder="Välj deltagare" options={cases.map((x) => ({ value: x.caseId, label: `${x.name} · ${x.caseNumber}` }))} />
            </Field>
          ) : (
            <Kv items={[["Ärende", chosen ? <span key="n"><span className="font-bold tabular-nums">{chosen.caseNumber}</span> · {chosen.name}</span> : "–"]]} />
          )}
          <FormGrid>
            <Field id="pl-emp" label="Arbetsgivare" required error={tried ? errs.emp : null} help="Ur det gemensamma registret, eller en ny som läggs till i registret." full>
              <Select
                value={emp}
                onValueChange={(v) => { setEmp(v); if (v !== NEW) { const e = employers.find((x) => x.id === v); if (e && !f.supervisorName) setF((x) => ({ ...x, supervisorName: e.contactName })); } }}
                placeholder="Välj arbetsgivare"
                options={[...employers.map((e) => ({ value: e.id, label: e.name })), { value: NEW, label: "Ny arbetsgivare …" }]}
              />
            </Field>
            {isNew && (
              <>
                <Field id="pl-name" label="Företag" required error={tried ? errs.name : null}>
                  <Input value={f.name} onValueChange={set("name")} maxLength={200} />
                </Field>
                <Field id="pl-city" label="Ort" help="Visas som plats på praktikdagarna.">
                  <Input value={f.city} onValueChange={set("city")} maxLength={100} />
                </Field>
                <Field id="pl-contact" label="Kontaktperson">
                  <Input value={f.contactName} onValueChange={set("contactName")} maxLength={200} />
                </Field>
                <Field id="pl-phone" label="Telefon">
                  <Input type="tel" value={f.phone} onValueChange={set("phone")} maxLength={40} />
                </Field>
                <Field id="pl-email" label="E-post" error={tried ? errs.email : null} full>
                  <Input type="email" value={f.email} onValueChange={set("email")} maxLength={200} />
                </Field>
              </>
            )}
            <Field id="pl-sup" label="Handledare hos arbetsgivaren" help="Den som handleder deltagaren på plats. Förifylld med kontaktpersonen." full>
              <Input value={f.supervisorName} onValueChange={set("supervisorName")} maxLength={200} />
            </Field>
            <Field id="pl-start" label="Startdag" required error={tried ? errs.startsOn : null}>
              <DateInput value={f.startsOn} onValueChange={set("startsOn")} />
            </Field>
            <Field id="pl-end" label="Slutdag (valfri)" error={tried ? errs.endsOn : null} help={chosen?.plannedEnd ? `Tom = till och med planerat slut ${fmtDate(chosen.plannedEnd)}.` : "Tom = till och med insatsens planerade slut."}>
              <DateInput value={f.endsOn} onValueChange={set("endsOn")} />
            </Field>
            <Field id="pl-days" label="Praktikdagar i veckan" required error={tried ? errs.weekdays : null} full>
              <Seg multi ariaLabel="Praktikdagar i veckan" value={weekdays} onValueChange={setWeekdays} options={[0, 1, 2, 3, 4].map((d) => ({ value: String(d), label: cap(WEEKDAYS[d]) }))} />
            </Field>
            <Field id="pl-time" label="Börjar klockan" required>
              <TimeInput value={time} onValueChange={setTime} />
            </Field>
            <Field id="pl-dur" label="Omfattning per dag" required>
              <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))} options={HOURS} />
            </Field>
            <Field id="pl-tasks" label="Arbetsuppgifter" help="Kopplade till yrkesspåret – det första av de fyra rätten." full>
              <TextArea value={f.tasks} onValueChange={set("tasks")} rows={2} maxLength={2000} />
            </Field>
          </FormGrid>
          <Notice tone="info" icon="calendar" title="Det här händer när du sparar">
            Praktikdagarna läggs in som tillfällen {until ? `till och med ${fmtDate(until)}` : ""} och ersätter yrkesmoment samma dagar som ännu saknar närvaro. Händelsen
            ”Praktik startad” registreras utan verifiering – ladda upp praktikavtalet under Händelser och utfall. Uppföljningsdatum och de fyra rätten fylls i på praktikplatsen.
          </Notice>
        </Stack>
      )}
    </Modal>
  );
}

/** Avsluta praktiken: slutdag. Utfallet registreras som en händelse i ärendet. */
export function EndPlacementModal({ placementId, employerName, startsOn, now, onClose }: { placementId: string; employerName: string; startsOn: string; now: string; onClose: () => void }) {
  const end = useCommand(placementEnd);
  const [endsOn, setEndsOn] = useState(dayOf(now));
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return setErr("Välj slutdag.");
    if (endsOn < startsOn) return setErr(`Slutdagen kan inte vara före startdagen ${fmtDate(startsOn)}.`);
    const res = await end.run({ placementId, endsOn }).catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Praktiken kunde inte avslutas.", "error");
      return;
    }
    toast(`Praktiken hos ${employerName} är avslutad ${fmtDate(endsOn)}.${res.removed ? ` ${plural(res.removed, "praktikdag", "praktikdagar")} efter slutdagen togs bort.` : ""}`);
    onClose();
  };
  return (
    <Modal
      title="Avsluta praktiken"
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="check" pending={end.pending} onClick={() => void submit()}>Avsluta praktiken</Button>
        </>
      }
    >
      <Stack>
        <Kv items={[["Arbetsgivare", employerName], ["Startade", fmtDate(startsOn)]]} />
        <Field id="pl-endson" label="Slutdag" required error={err} help="Praktikdagar efter slutdagen som saknar närvaro tas bort.">
          <DateInput value={endsOn} onValueChange={(v) => { setEndsOn(v); setErr(null); }} />
        </Field>
        <p className="m-0 text-text-muted">Ledde praktiken till arbete eller ett erbjudande? Registrera det som en händelse under Händelser och utfall.</p>
        {endsOn && endsOn > addDays(dayOf(now), 0) && <Notice tone="warn" title="Slutdagen ligger framåt i tiden">Praktiken markeras som avslutad redan nu.</Notice>}
      </Stack>
    </Modal>
  );
}
