"use client";
// Dialoger i avropsinkorgen: Acceptera, Avböj och Rätta uppgifter (prototypens AcceptModal, DeclineModal och CorrectModal).
// Acceptdialogen (beslut 2026-10-07, synpunkt #8): Miljonbemanning väljer avtalsområde och yrkesspår, omfattningen är
// förifylld ur beställningen (6/12 månader eller annan tidsperiod) och beställarreferensen är valfri. Handläggarens
// bakgrundsinformation och bilagor visas som underlag. Inga belopp.
// Samma dialog för avtalets intagsansvarige (Karims beslut 2026-11-09): coachens Min vecka och deltagarkortet öppnar AcceptModal
// med Ta emot. Underlaget kommer från arenden.acceptForm (inkorgens frågor når coachen aldrig); för den intagsansvarige heter
// dialogen Ta emot, huvudcoachen är förvald (hen själv) och kvittensen är en kort ruta – inte inkorgens kvittens.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ParamsOf } from "@/api/contract";
import { addWorkingDays, dayOf, fmtDate, fmtWeekday, holidayName, isWorkingDay, orderPeriodEnd } from "@/core/time";
import { FIRST_MEETING_DEFAULT_TIME } from "@/core/first-meeting";
import { caseAccept, caseAcceptForm, caseDecline, ORDER_REASON_MAX, ORDER_REASON_MIN, type AcceptFormView } from "@/features/arenden/api";
import { CaseBackgroundCard } from "@/features/arenden/screens/attachments";
import { useCommand, useQuery } from "@/shell/backend";
import { useSession } from "@/shell/session";
import {
  Button, cn, DateInput, ErrorNotice, ErrorSummary, Field, FormGrid, Icon, Input, Loading, Modal, Notice, Seg, Select, SlaBadge, TextArea, TimeInput, toast,
} from "@/ui";
import { inboxCorrect, inboxDecisionForm, type CorrectForm } from "../api";
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

/**
 * Acceptera (samordnare och avtalsansvarig) eller Ta emot (avtalets intagsansvarige – intake). Underlaget: arenden.acceptForm.
 * Svarar servern null finns beställningen inte, är redan besvarad eller så får rollen inte ta emot den.
 */
export function AcceptModal({
  caseId, caseNumber, onClose, onShowEmail, next = null, intake = false,
}: { caseId: string; caseNumber: string; onClose: () => void; onShowEmail?: (id: string) => void; next?: NextAction; intake?: boolean }) {
  const q = useQuery(caseAcceptForm, { caseId });
  const verb = intake ? "Ta emot" : "Acceptera";
  // Underlaget som dialogen fick behålls: när den intagsansvarige har tagit emot beställningen räknas frågan om och svarar null
  // (beställningen väntar inte längre på svar) – kvittensen ska ändå stå kvar tills dialogen stängs.
  const [kept, setKept] = useState<AcceptFormView | null>(null);
  if (q.data && q.data !== kept) setKept(q.data);
  const form = q.data ?? kept;
  if (!form && q.data === null) {
    return (
      <Modal title={`${verb} ${caseNumber}`} onClose={onClose} footer={<Button kind="primary" onClick={onClose}>Stäng</Button>}>
        <Notice tone="warn" title={intake ? "Beställningen kan inte tas emot här" : "Avropet kan inte accepteras här"}>
          {intake
            ? `${caseNumber} är redan besvarad, eller så tas den emot av samordnaren. Ladda om sidan för att se läget.`
            : `${caseNumber} finns inte, eller så har du inte behörighet att se den. Ladda om sidan för att se läget.`}
        </Notice>
      </Modal>
    );
  }
  if (!form) return <Loader title={`${verb} ${caseNumber}`} onClose={onClose} error={q.error} />;
  return <AcceptForm f={form} onClose={onClose} onShowEmail={onShowEmail} next={next} />;
}

/** Valet "Annan tidsperiod" (övriga val är antal månader ur avtalet). */
const OTHER = "annan";
const periodOptions = (p: { months: number[]; allowOther: boolean }) => [
  ...p.months.map((n) => ({ value: String(n), label: `${n} månader` })),
  ...(p.allowOther ? [{ value: OTHER, label: "Annan tidsperiod" }] : []),
];

function AcceptForm({ f, onClose, onShowEmail, next }: { f: AcceptFormView; onClose: () => void; onShowEmail?: (id: string) => void; next: NextAction }) {
  const accept = useCommand(caseAccept);
  const role = useSession().actor.role;
  // Den intagsansvarige tar emot (Karims beslut 2026-11-09): samma dialog med orden Ta emot.
  const intake = f.intake;
  const [invitation, setInvitation] = useState("");
  // Ingen kollega har rollen huvudcoach ännu (tom databas): avropet kan inte accepteras förrän någon fått rollen.
  const noCoach = f.coaches.length === 0;
  // Förvald huvudcoach: den intagsansvarige själv (går att byta) – annars ingen.
  const [coach, setCoach] = useState(f.defaultCoachId && f.coaches.some((u) => u.id === f.defaultCoachId) ? f.defaultCoachId : "");
  // Arbetsgivarmatchare och SYV/metodstöd (beslut 2026-10-08): vem som helst av MB-personalen utom ekonom och admin.
  const [matcher, setMatcher] = useState("");
  const [counselor, setCounselor] = useState("");
  const [date, setDate] = useState(f.defaultDate);
  const [time, setTime] = useState(FIRST_MEETING_DEFAULT_TIME);
  const [period, setPeriod] = useState(f.orderPeriodMonths != null ? String(f.orderPeriodMonths) : f.orderPeriodReason ? OTHER : "");
  const [end, setEnd] = useState(f.orderPeriodMonths == null && f.orderPeriodReason ? f.plannedEnd ?? "" : "");
  const [reason, setReason] = useState(f.orderPeriodReason ?? "");
  const [area, setArea] = useState(f.primaryArea ?? "");
  const [area2, setArea2] = useState(f.secondaryArea ?? "");
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
  const other = period === OTHER;
  // Äldre beställning i veckor (före 2026-10-07) får behålla veckorna om ingen omfattning väljs.
  const legacyWeeks = !period && !!f.plannedWeeks;
  const errs: Record<string, string | null> = {
    coach: !coach ? "Välj huvudcoach." : null,
    // Samma regel som servern (firstMeetingBookingProblem i arenden.caseAccept): inte passerat, inte före beställningen och en
    // arbetsdag. En tid som redan har passerat i dag nekas av servern (felet visas då).
    date: !date
      ? "Välj datum för första mötet."
      : date < f.today
        ? "Datumet har redan passerat."
        : date < dayOf(f.referredAt)
          ? `Första mötet kan inte vara före beställningen ${fmtDate(f.referredAt)}.`
          : !isWorkingDay(date)
            ? `${holidayName(date) || "Dagen"} är inte en arbetsdag. Välj en vardag.`
            : null,
    time: !time ? "Välj tid för första mötet." : null,
    area: !area ? "Välj avtalsområde." : null,
    area2: area2 && area2 === area ? "Välj ett annat alternativt område än det första, eller inget." : null,
    period: !period && !legacyWeeks ? "Välj hur länge insatsen ska pågå." : null,
    end: other && !end ? "Välj slutdatum." : other && date && end <= date ? "Slutdatumet måste komma efter första mötet." : null,
    reason: other && reason.trim().length < ORDER_REASON_MIN ? "Skriv varför insatsen behöver en annan längd." : null,
  };
  // Beställarreferensen är valfri – formatet kontrolleras bara om något har skrivits.
  const refNow = ref.trim() ? refErrorMB(ref, f.refPattern, f.refLen) : null;
  const refErr = refServerErr || refNow;
  /** Fältordning i dialogen: vid fel scrollas och fokuseras det första felaktiga fältet. */
  const ORDER: [string, string][] = [
    ["coach", `ink-coach-${coach || f.coaches[0]?.id}`], ["date", "ink-fm-date"], ["time", "ink-fm-time"], ["area", "ink-area"], ["area2", "ink-area2"],
    ["period", "ink-period"], ["end", "ink-end"], ["reason", "ink-reason"], ["ref", "ink-ref"],
  ];
  const plannedEnd = period && !other && date ? orderPeriodEnd(date, Number(period)) : null;

  const submit = async () => {
    setTried(true);
    const all: Record<string, string | null> = { ...errs, ref: refNow };
    const first = ORDER.find(([k]) => all[k]);
    if (first) {
      // Felsammanfattningen överst och felet vid fältet räcker – ingen toast (den täckte knappen).
      focusField(first[1]);
      return;
    }
    const res = await accept.run({
      caseId: f.caseId, leadCoachId: coach, firstMeetingAt: `${date}T${time}`, buyerReference: ref.trim() || null,
      primaryArea: area, secondaryArea: area2 || null,
      ...(period && !other ? { orderPeriodMonths: Number(period) } : other ? { plannedEnd: end, orderPeriodReason: reason.trim() } : {}),
      team: [
        ...(matcher && matcher !== coach ? [{ userId: matcher, role: "employer_matcher" as const }] : []),
        ...(counselor && counselor !== coach && counselor !== matcher ? [{ userId: counselor, role: "guidance_counselor" as const }] : []),
      ],
    });
    if (!res.ok) {
      const field = res.error === "buyer_ref" ? "ink-ref" : res.error === "area" ? "ink-area" : res.error === "order_period" ? "ink-period"
        : res.error === "past" || res.error === "before_order" || res.error === "not_working_day" ? "ink-fm-date" : null;
      if (res.error === "buyer_ref") setRefServerErr(res.message || `Beställarreferensen ska vara ${f.refLen} siffror.`);
      toast(
        res.message
          ? `${intake ? "Beställningen kan inte tas emot ännu." : "Avropet kan inte accepteras ännu."} ${res.message}`
          : intake ? "Beställningen kunde inte tas emot. Försök igen." : "Avropet kunde inte accepteras. Försök igen.",
        "error",
      );
      if (field) focusField(field);
      return;
    }
    toast(intake ? `${f.caseNumber} är mottagen. Orderbekräftelsen är skickad till kommunen.` : `${f.caseNumber} är accepterat. Orderbekräftelsen är skickad till kommunen.`);
    setInvitation(res.invitation);
    setDone(true);
  };

  if (done && intake) {
    // Den intagsansvariges kvittens: vad som har hänt – inkorgens kvittens (ordererkännande, mejl och notiser) läser coachen inte.
    return (
      <Modal title="Deltagaren är mottagen" onClose={onClose} footer={<Button kind="primary" onClick={onClose}>Klart</Button>}>
        <div ref={doneRef} className="flex flex-col gap-4">
          <Notice tone="ok" title={`${f.caseNumber} är mottagen`}>
            Första mötet är bokat {fmtWeekday(date)} kl. {time.replace(":", ".")}. {invitation}
          </Notice>
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5">
            <li>Orderbekräftelsen är publicerad i portalen. Kommunen har fått ett mejl utan personuppgifter.</li>
            <li>Samordnarna har fått en notis i appen om att deltagaren är mottagen.</li>
            <li>Huvudcoachen och teamet har fått en notis om tilldelningen.</li>
          </ul>
        </div>
      </Modal>
    );
  }

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
      title={`${intake ? "Ta emot" : "Acceptera"} ${f.caseNumber}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>{f.supplementPending ? "Stäng" : "Avbryt"}</Button>
          {/* En komplettering väntar i inkorgen: den intagsansvarige tar inte emot förrän samordnaren har fört in den. */}
          {!f.supplementPending && (
            <Button kind="primary" icon="check" pending={accept.pending} disabled={noCoach} onClick={() => void submit()}>{intake ? "Ta emot" : "Acceptera avropet"}</Button>
          )}
        </>
      }
    >
      {tried && (
        <ErrorSummary
          title={intake ? "Rätta det här innan du tar emot" : "Rätta det här innan du accepterar"}
          items={ORDER.filter(([k]) => (k === "ref" ? refNow : errs[k])).map(([k, id]) => ({ id, text: (k === "ref" ? refNow : errs[k]) as string }))}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-small text-text-muted">Från {f.from} · {f.displayName}</span>
        {f.avropSla && <SlaBadge sla={f.avropSla.sla} dueAt={f.avropSla.dueAt} prefix="Svar:" />}
      </div>
      {f.supplementPending && (
        <Notice tone="warn" icon="link" title="En komplettering väntar i inkorgen">
          Kommunen har skickat en komplettering som väntar i inkorgen. Be samordnaren föra in den innan du tar emot.
        </Notice>
      )}
      <CaseBackgroundCard bg={f.background} title="Underlag från handläggaren" />
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
        {noCoach ? (
          <Notice tone="warn" icon="users" title="Ingen kollega har rollen huvudcoach ännu">
            <div className="flex flex-col gap-2">
              <span>Lägg till kollegan under Användare och roller och ge rollen Huvudcoach. Sedan kan avropet accepteras.</span>
              {(role === "admin" || role === "avtalsansvarig") && (
                <div>
                  <Button kind="secondary" icon="users" to="/admin/anvandare">Öppna Användare och roller</Button>
                </div>
              )}
            </div>
          </Notice>
        ) : (
          <div className="text-text-muted">
            Samma coach genom hela insatsen. Antal aktiva ärenden visas för att fördela jämnt.{intake ? " Du är förvald – välj en annan coach om någon annan ska ha deltagaren." : ""}
          </div>
        )}
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
      </fieldset>

      {/* Teamet visas bara när det finns kollegor att välja (arbetsgivarmatchare, SYV). Teamvalet Handledare finns inte (beslut 2026-10-09). */}
      {f.staff.length > 0 && (
        <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
          <legend className="mb-0.5 p-0 text-ui font-bold">Team (valfritt)</legend>
          <div className="text-text-muted">Arbetsgivarmatchare och SYV. De får också en notis om tilldelningen.</div>
          <FormGrid>
            <Field id="ink-matcher" label="Arbetsgivarmatchare (valfritt)">
              <Select
                value={matcher}
                onValueChange={setMatcher}
                placeholder="Ingen"
                options={f.staff.filter((u) => u.id !== coach && u.id !== counselor).map((u) => ({ value: u.id, label: u.name }))}
              />
            </Field>
            <Field id="ink-syv" label="SYV/metodstöd (valfritt)">
              <Select
                value={counselor}
                onValueChange={setCounselor}
                placeholder="Ingen"
                options={f.staff.filter((u) => u.id !== coach && u.id !== matcher).map((u) => ({ value: u.id, label: u.name }))}
              />
            </Field>
          </FormGrid>
        </fieldset>
      )}

      <FormGrid>
        <Field
          id="ink-fm-date" label="Första möte – datum" required error={tried ? errs.date : null}
          help={f.desiredStart ? `Kommunen önskar start ${fmtDate(f.desiredStart)}.` : undefined}
        >
          {/* Förifyllt med kommunens önskade start när den går att boka (Karims beslut 2026-11-11, acceptDefaultDate). */}
          <DateInput value={date} onValueChange={setDate} />
        </Field>
        <Field id="ink-fm-time" label="Första möte – tid" required help="Mötet hålls i Alby om inget annat bokas." error={tried ? errs.time : null}>
          <TimeInput value={time} onValueChange={setTime} />
        </Field>
        {/* Ingen varning för ett datum efter avtalets gräns (Karims beslut 2026-11-11: "Det ska inte vara med"). */}
        {date && !isWorkingDay(date) && (
          <div className="col-span-full">
            <Notice tone="warn" title="Inte en arbetsdag">{fmtWeekday(date)} är {holidayName(date)?.toLowerCase() ?? "en helgdag"}. Välj en vardag.</Notice>
          </div>
        )}
        <Field
          id="ink-area" label="Avtalsområde" required error={tried ? errs.area : null}
          help={f.primaryArea ? "Förifyllt från beställningen." : undefined}
        >
          <Select value={area} onValueChange={setArea} placeholder="Välj område" options={f.areas} />
        </Field>
        <Field id="ink-area2" label="Alternativt område (valfritt)" help="Om det första området inte fungerar." error={tried ? errs.area2 : null}>
          <Select value={area2} onValueChange={setArea2} placeholder="Inget" options={f.areas.filter((a) => a.value !== area)} />
        </Field>
        <Field
          id="ink-period" label="Omfattning" required error={tried ? errs.period : null} full
          help={legacyWeeks ? `Beställningen gäller ${f.plannedWeeks} veckor (äldre beställning). Välj en omfattning om den ska ändras.` : "Förifylld från beställningen."}
        >
          <Seg id="ink-period" ariaLabel="Omfattning" value={period} onValueChange={(v) => setPeriod(v)} options={periodOptions(f.periods)} />
        </Field>
        {plannedEnd && <p className="col-span-full m-0 text-text-muted">Planerat slut: {fmtDate(plannedEnd)}.</p>}
        {other && (
          <>
            <Field id="ink-end" label="Slutdatum" required help="Den sista dagen i insatsen." error={tried ? errs.end : null}>
              <DateInput value={end} onValueChange={setEnd} />
            </Field>
            <Field id="ink-reason" label="Motivering" required help="Varför insatsen behöver en annan längd." error={tried ? errs.reason : null} full>
              <TextArea value={reason} onValueChange={setReason} rows={2} maxLength={ORDER_REASON_MAX} />
            </Field>
          </>
        )}
        <Field
          id="ink-ref" label="Beställarreferens (valfritt)" error={refErr}
          help={`${f.refLen} siffror. Kan också fyllas i på fakturan.`}
        >
          <Input value={ref} inputMode="numeric" maxLength={12} onValueChange={(v) => { setRef(v); setRefServerErr(null); }} />
        </Field>
      </FormGrid>

      <Notice tone="info" icon="bell" title={intake ? "När du tar emot" : "När du accepterar"}>
        Orderbekräftelsen publiceras i portalen, teamet får en notis och deltagaren får kallelse.{intake ? " Samordnarna får en notis i appen om att deltagaren är mottagen." : ""}
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
        Hittills i avtalet: {f.declined} av {f.total} avrop avböjda.
      </Notice>
      <Field id="ink-decline-reason" label="Orsak" required help="Syns för kommunen i portalen." error={tried ? errs.reason : null}>
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
  const other = v.orderPeriod === OTHER;
  const errs = {
    buyerReference: v.buyerReference ? refErrorMB(v.buyerReference, f.refPattern, f.refLen) : null,
    plannedEnd: other && v.plannedEnd && v.desiredStart && v.plannedEnd <= v.desiredStart ? "Slutdatumet måste komma efter startdatumet." : null,
    orderPeriodReason: other && v.orderPeriodReason.trim().length > 0 && v.orderPeriodReason.trim().length < ORDER_REASON_MIN ? "Skriv motiveringen med minst en mening." : null,
  };
  const save = async () => {
    setTried(true);
    if (Object.values(errs).some(Boolean)) return;
    // Vid 6 eller 12 månader räknas slutdatumet vid accept – slutdatum och motivering gäller bara annan tidsperiod.
    const next: Record<OrderFieldKey, string | null> = {
      ...v, plannedEnd: other ? v.plannedEnd || null : f.current.plannedEnd || null, orderPeriodReason: other ? v.orderPeriodReason.trim() || null : null,
    };
    const patch: Partial<Record<OrderFieldKey, string | null>> = {};
    for (const k of ORDER_FIELDS) if ((f.current[k] ?? "") !== (next[k] ?? "")) patch[k] = next[k];
    const checked = ORDER_FIELDS.filter((k) => next[k] != null && next[k] !== "");
    const res = await correct.run({ caseId: f.caseId, emailId: f.emailId, patch: patch as ParamsOf<typeof inboxCorrect>["patch"], checked });
    if (!res.ok) {
      toast(res.message || "Uppgifterna kunde inte sparas.", "error");
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
      <p className="text-text-muted">
        Jämför med originalmejlet. Det du sparar markeras som kontrollerat av dig och loggas. Uppgifter om deltagaren rättas i deltagarkortet. Avtalsområdet väljer du när du accepterar.
      </p>
      <FormGrid>
        <Field id="ink-c-start" label="Önskat startdatum" help={`Kommunens önskemål.${low("desiredStart")}`}>
          <DateInput value={v.desiredStart} onValueChange={set("desiredStart")} />
        </Field>
        <Field id="ink-c-period" label="Omfattning" help={`6 eller 12 månader, eller annan tidsperiod med motivering.${low("orderPeriod")}`} full>
          <Seg id="ink-c-period" ariaLabel="Omfattning" value={v.orderPeriod} onValueChange={set("orderPeriod")} options={periodOptions(f.periods)} />
        </Field>
        {other && (
          <>
            <Field id="ink-c-end" label="Slutdatum" help={`Den sista dagen i insatsen.${low("plannedEnd")}`} error={tried ? errs.plannedEnd : null}>
              <DateInput value={v.plannedEnd} onValueChange={set("plannedEnd")} />
            </Field>
            <Field id="ink-c-reason" label="Motivering" help={`Varför insatsen behöver en annan längd.${low("orderPeriodReason")}`} error={tried ? errs.orderPeriodReason : null} full>
              <TextArea value={v.orderPeriodReason} onValueChange={set("orderPeriodReason")} rows={2} maxLength={ORDER_REASON_MAX} />
            </Field>
          </>
        )}
        <Field id="ink-c-ref" label="Beställarreferens (valfritt)" help={`${f.refLen} siffror, bara siffror – om kommunen har angett en.${low("buyerReference")}`} error={tried ? errs.buyerReference : null}>
          <Input value={v.buyerReference} inputMode="numeric" maxLength={12} onValueChange={set("buyerReference")} />
        </Field>
      </FormGrid>
    </Modal>
  );
}

/** Standarddatum för bokning av första möte (nästa arbetsdag). */
export const nextWorkingDay = (today: string): string => addWorkingDays(today, 1);
