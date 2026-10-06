"use client";
// Dialoger i avropsinkorgen: Acceptera, Avböj, Rätta uppgifter och Registrera efter telefonsamtal
// (prototypens AcceptModal, DeclineModal, CorrectModal och PhoneModal).
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ParamsOf } from "@/api/contract";
import { TESTER_HIDDEN_TEXT } from "@/api/tester-access";
import { kr } from "@/core/format";
import { addWorkingDays, dayOf, diffDays, fmtDate, fmtWeekday, holidayName, isWorkingDay } from "@/core/time";
import { pnrFormatValid } from "@/core/validation";
import { caseAccept, caseCreate, caseDecline } from "@/features/arenden/api";
import { useCommand, useQuery } from "@/shell/backend";
import {
  BuildPhase, Button, Check, cn, DateInput, ErrorNotice, Field, FormGrid, Icon, Input, Loading, Modal, Notice, Select, SlaBadge, TextArea, TimeInput, toast,
} from "@/ui";
import { inboxCorrect, inboxDecisionForm, inboxDuplicateCheck, inboxLinkPhoneOrder, inboxPhoneForm, type CorrectForm, type DecisionForm, type PhoneForm } from "../api";
import { DECLINE_REASONS, FIELD_LABEL, ORDER_FIELDS, refErrorMB, type OrderFieldKey } from "../texts";
import { ConfirmationCard } from "./cards";

/** Scrolla till fältet och ge det fokus (efter att felet visats). */
const focusField = (id: string) =>
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.focus({ preventScroll: true });
    }
  }, 0);

/** Dialog som hämtar sitt underlag först. */
function Loader({ title, onClose, error, children }: { title: string; onClose: () => void; error?: unknown; children?: ReactNode }) {
  return (
    <Modal title={title} onClose={onClose} footer={<Button kind="ghost" onClick={onClose}>Avbryt</Button>}>
      {error ? <ErrorNotice error={error} /> : children ?? <Loading />}
    </Modal>
  );
}

// ---------------------------------------------------------------- Acceptera
/** next = nästa avrop att hantera (knappen i kvittensen). */
export type NextAction = { label: string; open: () => void } | null;

export function AcceptModal({
  caseId, caseNumber, onClose, onShowEmail, next = null,
}: { caseId: string; caseNumber: string; onClose: () => void; onShowEmail?: (id: string) => void; next?: NextAction }) {
  const q = useQuery(inboxDecisionForm, { caseId });
  if (q.error || !q.data) return <Loader title={`Acceptera ${caseNumber}`} onClose={onClose} error={q.error ?? (q.data === null ? new Error() : undefined)} />;
  return <AcceptForm f={q.data} onClose={onClose} onShowEmail={onShowEmail} next={next} />;
}

const priceOn = (f: DecisionForm, date: string): number => f.prices?.find((p) => p.validFrom <= date && (!p.validTo || p.validTo >= date))?.priceOre ?? 0;
const exampleOn = (f: DecisionForm, date: string): boolean => !!f.prices?.find((p) => p.validFrom <= date && (!p.validTo || p.validTo >= date))?.exampleOnly;

function AcceptForm({ f, onClose, onShowEmail, next }: { f: DecisionForm; onClose: () => void; onShowEmail?: (id: string) => void; next: NextAction }) {
  const accept = useCommand(caseAccept);
  const [coach, setCoach] = useState("");
  const [team, setTeam] = useState<string[]>([]);
  const [date, setDate] = useState(f.defaultDate);
  const [time, setTime] = useState("10:00");
  const [weeks, setWeeks] = useState(f.plannedWeeks ? String(f.plannedWeeks) : "");
  const [ref, setRef] = useState(f.buyerReference || "");
  const [tried, setTried] = useState(false);
  const [refServerErr, setRefServerErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const doneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Dialogens innehåll börjar överst när bekräftelsen visas.
    if (!done) return;
    let el: HTMLElement | null = doneRef.current;
    while (el && !(el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === "auto")) el = el.parentElement;
    if (el) el.scrollTop = 0;
  }, [done]);

  const minActive = Math.min(...f.coaches.map((x) => x.active));
  const w = Number(weeks);
  const errs: Record<string, string | null> = {
    coach: !coach ? "Välj huvudcoach." : null,
    date: !date ? "Välj datum för första mötet." : date < f.today ? "Datumet har redan passerat." : null,
    time: !time ? "Välj tid för första mötet." : null,
    weeks: !(Number.isInteger(w) && w >= 1 && w <= 52) ? "Ange planerad omfattning i hela veckor (1–52)." : null,
  };
  const refNow = refErrorMB(ref, f.refPattern, f.refLen);
  const refErr = refServerErr || (tried || ref ? refNow : null);
  const refTitle = !ref.trim() ? "Beställarreferens saknas – avropet kan inte bekräftas" : "Beställarreferensen är fel – avropet kan inte bekräftas";
  /** Fältordning i dialogen: vid fel scrollas och fokuseras det första felaktiga fältet. */
  const ORDER: [string, string][] = [["coach", `ink-coach-${coach || f.coaches[0]?.id}`], ["date", "ink-fm-date"], ["time", "ink-fm-time"], ["weeks", "ink-weeks"], ["ref", "ink-ref"]];
  const late = !!date && !!f.firstMeetingDue && date > dayOf(f.firstMeetingDue);
  const daysAfter = date ? diffDays(f.referredAt, date) : 0;
  const price = priceOn(f, date || f.today);
  const example = exampleOn(f, date || f.today);

  const submit = async () => {
    setTried(true);
    const all: Record<string, string | null> = { ...errs, ref: refNow };
    const first = ORDER.find(([k]) => all[k]);
    if (first) {
      toast(first[0] === "ref" ? `${refTitle}.` : `Avropet kan inte accepteras ännu. ${all[first[0]]}`, "error");
      focusField(first[1]);
      return;
    }
    const res = await accept.run({
      caseId: f.caseId, leadCoachId: coach, firstMeetingAt: `${date}T${time}`, plannedWeeks: w, buyerReference: ref.trim(),
      team: team.map((id) => ({ userId: id, role: f.helpers.find((h) => h.id === id)?.teamRole ?? "vocational_supervisor" })),
    });
    if (!res.ok) {
      if (res.error === "buyer_ref") {
        setRefServerErr(refErrorMB(ref, f.refPattern, f.refLen) || `Beställarreferensen godkändes inte. Den ska vara ${f.refLen} siffror.`);
        toast(`${refTitle}.`, "error");
        focusField("ink-ref");
        return;
      }
      toast("Avropet kunde inte accepteras. Försök igen.", "error");
      return;
    }
    toast(`${f.caseNumber} är accepterat. Orderbekräftelsen är skickad till kommunen.`);
    setDone(true);
  };

  if (done) {
    return (
      <Modal
        title="Avropet är accepterat"
        onClose={onClose}
        wide
        footer={
          <>
            <Button kind={next ? "secondary" : "primary"} onClick={onClose}>
              Klart
            </Button>
            {next && (
              <Button kind="primary" iconRight="arrow-right" onClick={next.open}>
                {next.label}
              </Button>
            )}
          </>
        }
      >
        <div ref={doneRef} className="flex flex-col gap-4">
          <Notice tone="ok" title={`Orderbekräftelsen för ${f.caseNumber} är publicerad i portalen`}>Kommunen har fått ett mejl utan personuppgifter om att bekräftelsen finns att läsa.</Notice>
          <ConfirmationCard caseId={f.caseId} />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Acceptera ${f.caseNumber}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="check" pending={accept.pending} onClick={() => void submit()}>Acceptera avropet</Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-small text-text-muted">Från {f.from} · {f.areaName} · {f.displayName}</span>
        {f.avropSla && <SlaBadge sla={f.avropSla.sla} dueAt={f.avropSla.dueAt} prefix="Svar:" />}
      </div>
      {refNow && (tried || !f.buyerReference) && (
        <Notice tone="critical" title={refTitle}>
          {refNow} Fältet finns längst ned i dialogen.{f.pendingSup ? " Kompletteringen kan innehålla referensen." : ""}
        </Notice>
      )}
      {f.isProtected && (
        <Notice tone="critical" icon="lock" title="Skyddade personuppgifter">
          Deltagaren får ingen kallelse via SMS eller e-post. Den namngivna coachen ringer enligt den säkra rutinen. Bara coachen och avtalsansvarig ser namn och personnummer.
        </Notice>
      )}
      {f.pendingSup && (
        <Notice tone="info" icon="link" title="Det finns en komplettering att föra in först">
          {f.pendingSup.fromName} svarade {f.pendingSup.when} med uppgifter som saknas i avropet.
          {onShowEmail && (
            <div className="mt-2">
              <Button kind="secondary" icon="arrow-right" onClick={() => onShowEmail(f.pendingSup?.id ?? "")}>Visa kompletteringen</Button>
            </div>
          )}
        </Notice>
      )}

      <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
        <legend className="mb-0.5 p-0 text-ui font-bold">
          Huvudcoach<span aria-hidden="true" className="ml-0.5 text-rod">*</span>
          <span className="sr-only">(obligatoriskt)</span>
        </legend>
        <div className="text-text-muted">Samma coach genom hela insatsen. Antal aktiva ärenden visas för att fördela jämnt.</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,200px),1fr))] gap-2">
          {f.coaches.map((u) => (
            <label
              key={u.id}
              htmlFor={`ink-coach-${u.id}`}
              className={cn(
                "flex min-h-14 cursor-pointer items-center gap-2.5 rounded-mb border-[1.5px] border-line-strong px-3 py-2",
                coach === u.id && "border-2 border-antracit bg-bla-ton",
              )}
            >
              <input
                type="radio" name="ink-coach" id={`ink-coach-${u.id}`} value={u.id} checked={coach === u.id} onChange={() => setCoach(u.id)}
                className="m-0 size-5 flex-none accent-antracit"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-bold">{u.name}</span>
                <span className="text-small text-text-muted">{u.active} aktiva ärenden{u.active === minActive ? " · lägst" : ""}</span>
              </span>
            </label>
          ))}
        </div>
        {tried && errs.coach && (
          <div role="alert" className="flex items-start gap-1.5 text-small font-bold">
            <Icon name="alert-circle" className="mt-px text-rod" />
            {errs.coach}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-small text-text-muted"><BuildPhase fas={4} off /><span>Kapacitetstak per coach (aktiva ärenden mot tak).</span></div>
      </fieldset>

      <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
        <legend className="mb-0.5 p-0 text-ui font-bold">Team (valfritt)</legend>
        <div className="text-text-muted">Handledare, arbetsgivarmatchare och SYV. De får också en notis om tilldelningen.</div>
        {f.helpers.map((u) => (
          <Check key={u.id} id={`ink-team-${u.id}`} checked={team.includes(u.id)} onCheckedChange={(on) => setTeam(on ? [...team, u.id] : team.filter((x) => x !== u.id))}>
            {u.name} – {u.label}
          </Check>
        ))}
      </fieldset>

      <FormGrid>
        <Field
          id="ink-fm-date" label="Första möte – datum" required error={tried ? errs.date : null}
          help={`Ska vara inom ${f.meetingText} från avropet: senast ${f.firstMeetingDue ? fmtWeekday(f.firstMeetingDue) : "–"}.${f.desiredStart ? ` Kommunen önskar start ${fmtDate(f.desiredStart)}.` : ""}`}
        >
          <DateInput value={date} onValueChange={setDate} />
        </Field>
        <Field id="ink-fm-time" label="Första möte – tid" required help="Mötet hålls i Alby om inget annat bokas." error={tried ? errs.time : null}>
          <TimeInput value={time} onValueChange={setTime} />
        </Field>
        {late && (
          <div className="col-span-full">
            <Notice tone="warn" title={`Mötet ligger ${daysAfter} dagar efter avropet`}>
              Avtalet kräver att första mötet sker inom {f.meetingText} (senast {fmtDate(f.firstMeetingDue)}). Ärendet markeras i uppföljningen av nyckeltalet för första möte.
            </Notice>
          </div>
        )}
        {date && !isWorkingDay(date) && (
          <div className="col-span-full">
            <Notice tone="warn" title="Inte en arbetsdag">{fmtWeekday(date)} är {holidayName(date)?.toLowerCase() ?? "en helgdag"}. Välj en vardag.</Notice>
          </div>
        )}
        <Field
          id="ink-weeks" label="Planerad omfattning (veckor)" required error={tried ? errs.weeks : null}
          help={!f.prices
            ? `Används för orderns värde. Beställningens värde: ${TESTER_HIDDEN_TEXT.toLowerCase()}.`
            : price && w > 0
              ? `Beställningens värde: ${w} veckor × ${kr(price)} = ${kr(w * price)}${example ? " (exempelpris i prototypen)" : ""}.`
              : "Används för orderns värde och för upparbetat och återstående belopp på fakturan."}
        >
          <Input type="number" inputMode="numeric" value={weeks} onValueChange={setWeeks} />
        </Field>
        <Field
          id="ink-ref" label="Beställarreferens" required error={refErr}
          help={f.buyerReference
            ? `Från avropet. ${f.refLen} siffror, bara siffror. Krävs för att fakturan ska godkännas.`
            : `Kommunen har inte angett någon. Ordererkännandet bad om den. ${f.refLen} siffror. Utan giltig referens kan ärendet inte bekräftas.`}
        >
          <Input value={ref} inputMode="numeric" maxLength={12} onValueChange={(v) => { setRef(v); setRefServerErr(null); }} />
        </Field>
      </FormGrid>

      <Notice tone="info" icon="bell" title="Det här händer när du accepterar">
        Orderbekräftelsen publiceras i portalen och kommunen får ett mejl utan personuppgifter. Huvudcoachen och teamet får automatiskt en notis i appen och via e-post (bara ärendenummer).{" "}
        {f.isProtected ? "Ingen kallelse skickas till deltagaren." : "Deltagaren får kallelse via sin föredragna kontaktväg."}
      </Notice>
    </Modal>
  );
}

// ---------------------------------------------------------------- Avböj
export function DeclineModal({ caseId, caseNumber, onClose }: { caseId: string; caseNumber: string; onClose: () => void }) {
  const q = useQuery(inboxDecisionForm, { caseId });
  const decline = useCommand(caseDecline);
  const [reason, setReason] = useState("");
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  if (q.error || !q.data) return <Loader title={`Avböj ${caseNumber}`} onClose={onClose} error={q.error ?? (q.data === null ? new Error() : undefined)} />;
  const f = q.data;
  const other = reason === "Annat skäl";
  const errs = { reason: !reason ? "Välj en orsak." : null, text: other && !text.trim() ? "Beskriv orsaken." : null };
  const submit = async () => {
    setTried(true);
    if (errs.reason || errs.text) return;
    const full = text.trim() ? `${reason}: ${text.trim()}` : reason;
    const res = await decline.run({ caseId, reason: full });
    if (!res.ok) {
      toast("Avropet kunde inte avböjas.", "error");
      return;
    }
    toast(`${caseNumber} är avböjt. Kommunen har fått besked.`);
    onClose();
  };
  return (
    <Modal
      title={`Avböj ${caseNumber}`}
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="danger" icon="x-circle" pending={decline.pending} onClick={() => void submit()}>Avböj avropet</Button>
        </>
      }
    >
      <Notice tone="warn" title="Avböj bara om vi verkligen inte kan ta uppdraget">
        Obesvarade och ofta avböjda avrop kan flytta ned Miljonbemanning i kommunens rangordning. Hittills i avtalet: {f.declined} av {f.total} avrop avböjda.
      </Notice>
      <Field id="ink-decline-reason" label="Orsak" required help="Orsaken loggas och syns för kommunen i portalen." error={tried ? errs.reason : null}>
        <Select value={reason} onValueChange={setReason} placeholder="Välj orsak" options={DECLINE_REASONS.map((r) => ({ value: r, label: r }))} />
      </Field>
      <Field
        id="ink-decline-text" label={other ? "Beskrivning" : "Beskrivning (valfritt)"} required={other}
        help="Skriv kort och sakligt. Inga uppgifter om deltagarens hälsa eller andra känsliga uppgifter." error={tried ? errs.text : null}
      >
        <TextArea value={text} onValueChange={setText} rows={3} maxLength={400} />
      </Field>
      <div className="text-text-muted">
        Kommunen får ett mejl utan personuppgifter: <q>Vi kan tyvärr inte ta emot beställning {caseNumber}. Logga in i portalen för att läsa orsaken.</q>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Rätta uppgifter
export function CorrectModal({ f, onClose }: { f: CorrectForm; onClose: () => void }) {
  const correct = useCommand(inboxCorrect);
  const [v, setV] = useState<Record<OrderFieldKey, string>>(f.init);
  const [tried, setTried] = useState(false);
  const set = (k: OrderFieldKey) => (val: string) => setV({ ...v, [k]: val });
  const low = (k: OrderFieldKey) => f.lowNotes[k] ?? "";
  const w = Number(v.plannedWeeks);
  const errs = {
    buyerReference: v.buyerReference ? refErrorMB(v.buyerReference, f.refPattern, f.refLen) : null,
    plannedWeeks: v.plannedWeeks && !(Number.isInteger(w) && w >= 1 && w <= 52) ? "Ange hela veckor (1–52)." : null,
    primaryArea: !v.primaryArea ? "Välj avtalsområde." : null,
    plannedEnd: v.plannedEnd && v.desiredStart && v.plannedEnd < v.desiredStart ? "Slutdatum kan inte vara före startdatum." : null,
  };
  const save = async () => {
    setTried(true);
    if (Object.values(errs).some(Boolean)) return;
    const next: Record<OrderFieldKey, string | number | null> = { ...v, plannedWeeks: v.plannedWeeks ? w : null, secondaryArea: v.secondaryArea || null };
    const patch: Partial<Record<OrderFieldKey, string | number | null>> = {};
    for (const k of ORDER_FIELDS) if ((f.current[k] ?? "") !== (next[k] == null ? "" : String(next[k]))) patch[k] = next[k];
    const checked = ORDER_FIELDS.filter((k) => next[k] != null && next[k] !== "");
    const res = await correct.run({ caseId: f.caseId, emailId: f.emailId, patch: patch as ParamsOf<typeof inboxCorrect>["patch"], checked });
    if (!res.ok) {
      toast("Uppgifterna kunde inte sparas.", "error");
      return;
    }
    const edited = ORDER_FIELDS.filter((k) => (f.init[k] ?? "") !== (v[k] ?? ""));
    toast(edited.length ? `Rättat: ${edited.map((k) => FIELD_LABEL[k].toLowerCase()).join(", ")}. Ändringen är loggad.` : "Uppgifterna är markerade som kontrollerade. Kontrollen är loggad.");
    onClose();
  };
  return (
    <Modal
      title="Rätta beställningsuppgifter"
      onClose={onClose}
      wide
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="check" pending={correct.pending} onClick={() => void save()}>Spara och markera som kontrollerat</Button>
        </>
      }
    >
      <p className="text-text-muted">Jämför med originalmejlet. Det du sparar markeras som kontrollerat av dig och loggas. Uppgifter om deltagaren rättas i deltagarkortet.</p>
      <FormGrid>
        <Field id="ink-c-ref" label="Beställarreferens" help={`${f.refLen} siffror, bara siffror.${low("buyerReference")}`} error={tried ? errs.buyerReference : null}>
          <Input value={v.buyerReference} inputMode="numeric" maxLength={12} onValueChange={set("buyerReference")} />
        </Field>
        <Field id="ink-c-weeks" label="Planerad omfattning (veckor)" help={`Hela veckor.${low("plannedWeeks")}`} error={tried ? errs.plannedWeeks : null}>
          <Input type="number" inputMode="numeric" value={v.plannedWeeks} onValueChange={set("plannedWeeks")} />
        </Field>
        <Field id="ink-c-start" label="Önskat startdatum" help={`Kommunens önskemål.${low("desiredStart")}`}>
          <DateInput value={v.desiredStart} onValueChange={set("desiredStart")} />
        </Field>
        <Field id="ink-c-end" label="Planerat slutdatum" help={`Om kommunen angett det.${low("plannedEnd")}`} error={tried ? errs.plannedEnd : null}>
          <DateInput value={v.plannedEnd} onValueChange={set("plannedEnd")} />
        </Field>
        <Field id="ink-c-area" label="Avtalsområde (primärt)" required help={`Styr pris och yrkesspår.${low("primaryArea")}`} error={tried ? errs.primaryArea : null}>
          <Select value={v.primaryArea} onValueChange={set("primaryArea")} placeholder="Välj område" options={f.areas} />
        </Field>
        <Field id="ink-c-area2" label="Avtalsområde (alternativt)" help="Om det primära inte fungerar.">
          <Select value={v.secondaryArea} onValueChange={set("secondaryArea")} placeholder="Inget" options={f.areas} />
        </Field>
        <Field id="ink-c-track" label="Önskat yrkesspår" help="Kan ändras efter kartläggningen." full>
          <Input value={v.vocationalTrack} onValueChange={set("vocationalTrack")} />
        </Field>
      </FormGrid>
    </Modal>
  );
}

// ---------------------------------------------------------------- Registrera efter telefonsamtal
export function PhoneModal({ emailId, onClose }: { emailId: string; onClose: () => void }) {
  const q = useQuery(inboxPhoneForm, { emailId });
  if (q.error || !q.data) return <Loader title="Registrera efter telefonsamtal" onClose={onClose} error={q.error ?? (q.data === null ? new Error() : undefined)} />;
  return <PhoneFormView f={q.data} onClose={onClose} />;
}

type PhoneValues = { firstName: string; lastName: string; pnr: string; buyerReference: string; primaryArea: string; plannedWeeks: string; confirmed: boolean };

function PhoneFormView({ f, onClose }: { f: PhoneForm; onClose: () => void }) {
  const create = useCommand(caseCreate);
  const link = useCommand(inboxLinkPhoneOrder);
  const [v, setV] = useState<PhoneValues>({ firstName: "", lastName: "", pnr: "", buyerReference: f.brReference ?? "", primaryArea: "", plannedWeeks: "", confirmed: false });
  const [tried, setTried] = useState(false);
  const set = <K extends keyof PhoneValues>(key: K) => (val: PhoneValues[K]) => setV({ ...v, [key]: val });
  const pnrOk = pnrFormatValid(v.pnr);
  const dup = useQuery(inboxDuplicateCheck, pnrOk ? { pnr: v.pnr.trim() } : null).data?.duplicate ?? false;
  const w = Number(v.plannedWeeks);
  const who = f.referrerName || "handläggaren";
  const errs: Record<keyof PhoneValues, string | null> = {
    firstName: !v.firstName.trim() ? "Skriv förnamnet." : null,
    lastName: !v.lastName.trim() ? "Skriv efternamnet." : null,
    pnr: !v.pnr.trim() ? "Skriv personnummer eller samordningsnummer." : !pnrOk ? "Skriv som ÅÅÅÅMMDD-NNNN." : dup ? "Personen har redan en aktiv insats. Två aktiva ärenden samtidigt är inte tillåtet." : null,
    buyerReference: refErrorMB(v.buyerReference, f.refPattern, f.refLen),
    primaryArea: !v.primaryArea ? "Välj avtalsområde." : null,
    plannedWeeks: !(Number.isInteger(w) && w >= 1 && w <= 52) ? "Ange hela veckor (1–52)." : null,
    confirmed: !v.confirmed ? "Bekräfta att uppgifterna togs per telefon." : null,
  };
  const E = (key: keyof PhoneValues) => (tried ? errs[key] : null);
  const submit = async () => {
    setTried(true);
    if (Object.values(errs).some(Boolean)) return;
    const res = await create.run({
      protectedIdentity: true, source: "phone", referrerId: f.referrerId, firstName: v.firstName.trim(), lastName: v.lastName.trim(), pnr: v.pnr.trim(),
      buyerReference: v.buyerReference.trim(), primaryArea: v.primaryArea, plannedWeeks: w,
    });
    if (!res.ok) {
      toast("Ärendet kunde inte registreras.", "error");
      return;
    }
    await link.run({ emailId: f.emailId, caseId: res.caseId });
    toast(`${res.caseNumber} är registrerat med skyddade personuppgifter. Acceptera och tilldela en namngiven coach.`);
    onClose();
  };
  return (
    <Modal
      title="Registrera efter telefonsamtal"
      onClose={onClose}
      wide
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="lock" pending={create.pending || link.pending} onClick={() => void submit()}>Registrera ärendet</Button>
        </>
      }
    >
      <Notice tone="critical" icon="lock" title="Spara bara det som behövs">
        Namn, personnummer och handläggare. Ingen adress, telefon eller e-post till deltagaren. Ingen AI och inga automatiska utskick till deltagaren.
      </Notice>
      <p>
        Ring {who} på <b>{f.phone}</b> och fyll i uppgifterna under samtalet.
      </p>
      <FormGrid>
        <Field id="ink-p-first" label="Förnamn" required help="Som i folkbokföringen." error={E("firstName")}>
          <Input value={v.firstName} onValueChange={set("firstName")} autoComplete="off" />
        </Field>
        <Field id="ink-p-last" label="Efternamn" required help="Som i folkbokföringen." error={E("lastName")}>
          <Input value={v.lastName} onValueChange={set("lastName")} />
        </Field>
        <Field id="ink-p-pnr" label="Personnummer" required help="ÅÅÅÅMMDD-NNNN. Kontrolleras mot aktiva ärenden i avtalet." error={E("pnr") || (dup ? errs.pnr : null)}>
          <Input value={v.pnr} onValueChange={set("pnr")} inputMode="numeric" maxLength={13} />
        </Field>
        <Field
          id="ink-p-ref" label="Beställarreferens" required error={E("buyerReference")}
          help={f.brReference ? `${f.unit} har referensen ${f.brReference}. Stäm av i samtalet.` : `${f.refLen} siffror, bara siffror. Fråga handläggaren.`}
        >
          <Input value={v.buyerReference} onValueChange={set("buyerReference")} inputMode="numeric" maxLength={12} />
        </Field>
        <Field id="ink-p-area" label="Avtalsområde (primärt)" required help="Enligt handläggarens önskemål." error={E("primaryArea")}>
          <Select value={v.primaryArea} onValueChange={set("primaryArea")} placeholder="Välj område" options={f.areas} />
        </Field>
        <Field id="ink-p-weeks" label="Planerad omfattning (veckor)" required help="Hela veckor." error={E("plannedWeeks")}>
          <Input type="number" inputMode="numeric" value={v.plannedWeeks} onValueChange={set("plannedWeeks")} />
        </Field>
      </FormGrid>
      <div className="flex flex-col gap-1.5">
        <Check id="ink-p-confirm" checked={v.confirmed} onCheckedChange={set("confirmed")}>
          Jag har ringt {who} och tagit uppgifterna enligt den säkra rutinen.
        </Check>
        {E("confirmed") && (
          <div role="alert" className="flex items-start gap-1.5 text-small font-bold">
            <Icon name="alert-circle" className="mt-px text-rod" />
            {errs.confirmed}
          </div>
        )}
      </div>
      <div className="text-text-muted">
        Nästa ärendenummer blir {f.nextCaseNumber}. Efter registreringen ser bara avtalsansvarig och den namngivna coachen namn och personnummer.
      </div>
    </Modal>
  );
}

/** Standarddatum för bokning av första möte (nästa arbetsdag). */
export const nextWorkingDay = (today: string): string => addWorkingDays(today, 1);
