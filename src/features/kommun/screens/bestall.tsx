"use client";
// Beställ ny insats i portalen (/portal/bestall) – prototypens kom.bestall, ändrad efter synpunkterna från genomgången
// 2026-10-06 (beslut 2026-10-07) och coachmötet 2026-10-09. Tre steg med uppgifter och en granskning innan beställningen skickas:
//   1. Beställning och kontakt: namn, enhet (fritext), telefon, e-post, önskat startdatum och omfattningen – 6 eller 12
//      månader (avtalets alternativ, planerat slut räknas fram) eller annan tidsperiod med slutdatum och motivering.
//      Ingen beställarreferens och inget planerat slutdatum att fylla i (Miljonbemanning fyller i referensen).
//   2. Deltagare: namn, personnummer, telefon och/eller e-post och yrkesområdet (obligatoriskt, avtalets avtalsområden).
//      Ingen fråga om skydd och ingen anpassning (beslut 2026-10-07). Ingen bostadsort, ingen fråga om kontaktväg och ingen
//      adress (beslut 2026-10-09) – kallelsen går med SMS om telefonnummer finns, annars med e-post.
//   3. Bakgrundsinformation om deltagaren: har en kartläggning genomförts (ja eller nej), bifoga fil (bara vid ja) och
//      fritext (med "Tala in"). Yrkesspåret väljer Miljonbemanning.
//   Granskning: inga belopp – inget ordervärde någonstans (synpunkt #10 och #11).
// Beställningen sparas med arenden.caseCreate (delat kommando), som ger ärendenummer och skickar ordererkännandet.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { hasPhone } from "@/core/contact";
import { PRIOR_ASSESSMENT_LABEL } from "@/core/labels";
import { orderPeriodEnd } from "@/core/time";
import { emailValid, pnrFormatValid } from "@/core/validation";
import type { PriorAssessment } from "@/data/schema";
import { attachmentRemove, caseCreate, caseUpdate, ORDER_REASON_MAX, ORDER_REASON_MIN, type AttachmentRow } from "@/features/arenden/api";
import { AttachmentList, AttachmentPicker } from "@/features/arenden/screens/attachments";
import { useCommand, useQuery } from "@/shell/backend";
import { leaveWithoutAsking, useDraft, useUnsavedGuard } from "@/shell/guard";
import { path, useNav } from "@/shell/nav";
import {
  Button, Card, DemoNote, ErrorNotice, ErrorSummary, Eyebrow, focusFirstError, FormGrid, Icon, Input, Kv, Loading, Notice, PerspectiveLink, Seg, Select, Stack, TextArea, Timeline,
  cn, useConfirm, useToast, Field,
} from "@/ui";
import { kommunDuplicate, kommunOrderForm, kommunReceipt, type KomDuplicate, type KomOrderForm } from "../api";
import { CONTACT_PHONE, fD, fDT, fDTL, fullText, maskPnr, statusName } from "../texts";
import { KomHead, KomPage, OkLine } from "./parts";
import { joinText, TalaIn } from "./tala-in";

const STEPS = ["Beställning och kontakt", "Deltagare", "Bakgrundsinformation om deltagaren", "Granska och skicka"] as const;
const DATA_STEPS = 3;
/** Kartläggning: ja eller nej ("Vet inte" togs bort 2026-10-09 – äldre beställningar med "Vet inte" visas som förut). */
type PriorAnswer = Extract<PriorAssessment, "yes" | "no">;
const PRIOR: { value: PriorAnswer; label: string }[] = [
  { value: "yes", label: "Ja" },
  { value: "no", label: "Nej" },
];
/** Minst så här många siffror i deltagarens telefonnummer (samma som förut när SMS var förvalt). */
/** Valet "Annan tidsperiod" (övriga val är antal månader ur avtalet). */
const OTHER = "annan";
/** Längsta bakgrundsinformation (samma som arenden.caseCreate). */
const BACKGROUND_MAX = 4000;

type Order = {
  contactName: string;
  unit: string;
  contactPhone: string;
  contactEmail: string;
  desiredStart: string;
  /** Antal månader som text ("6", "12") eller "annan". */
  period: string | null;
  otherEnd: string;
  periodReason: string;
  firstName: string;
  lastName: string;
  pnr: string;
  phone: string;
  email: string;
  /** Yrkesområdet: avtalsområdets kod ("" = inte valt). */
  primaryArea: string;
  priorAssessment: PriorAnswer | null;
  background: string;
  /** Bifogade filer – bara när en kartläggning har genomförts (svaret ja). */
  attachments: AttachmentRow[];
};
type Base = Pick<Order, "contactName" | "unit" | "contactPhone" | "contactEmail" | "desiredStart">;

function initialOrder(m: KomOrderForm, keep?: Base): Order {
  const base: Base = keep ?? { contactName: m.me.name, unit: m.me.unit, contactPhone: m.me.phone, contactEmail: m.me.email, desiredStart: m.defaultStart };
  return {
    ...base, period: null, otherEnd: "", periodReason: "", firstName: "", lastName: "", pnr: "", phone: "", email: "", primaryArea: "",
    priorAssessment: null, background: "", attachments: [],
  };
}

/** Planerat slut vid 6 eller 12 månader: räknas fram från startdatumet (samma regel som servern). */
const periodEnd = (f: Pick<Order, "period" | "desiredStart" | "otherEnd">): string => {
  if (f.period === OTHER) return f.otherEnd;
  return f.period && f.desiredStart ? orderPeriodEnd(f.desiredStart, Number(f.period)) : "";
};
/** "6 månader" eller "Annan tidsperiod". */
const periodLabel = (p: string | null): string => (!p ? "Inte vald" : p === OTHER ? "Annan tidsperiod" : `${p} månader`);

/** Fältet som ett fel gäller (länkarna i felsammanfattningen). */
const ERROR_FIELD: Record<string, string> = {
  contactName: "kom-o-name", unit: "kom-o-unit", contactPhone: "kom-o-phone", contactEmail: "kom-o-email", desiredStart: "kom-o-start", period: "kom-o-period",
  otherEnd: "kom-o-end", periodReason: "kom-o-reason", firstName: "kom-o-fn", lastName: "kom-o-ln", pnr: "kom-o-pnr", phone: "kom-o-dphone", email: "kom-o-demail",
  primaryArea: "kom-o-area", priorAssessment: "kom-o-prior", attachments: "kom-o-files",
};

function validateStep(step: number, f: Order, m: KomOrderForm, dups: readonly KomDuplicate[], uploading: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 0) {
    if (!f.contactName.trim()) e.contactName = "Skriv ditt namn.";
    if (!f.unit.trim()) e.unit = "Skriv vilken enhet du arbetar på.";
    if (f.contactPhone.replace(/\D/g, "").length < 7) e.contactPhone = "Skriv ett telefonnummer där vi når dig.";
    if (!emailValid(f.contactEmail)) e.contactEmail = "Skriv en hel e-postadress.";
    if (!f.desiredStart) e.desiredStart = "Välj ett önskat startdatum.";
    else if (f.desiredStart < m.today) e.desiredStart = "Datumet har redan passerat. Välj ett senare datum.";
    if (!f.period) e.period = "Välj hur länge insatsen ska pågå.";
    if (f.period === OTHER) {
      if (!f.otherEnd) e.otherEnd = "Välj ett slutdatum.";
      else if (f.desiredStart && f.otherEnd <= f.desiredStart) e.otherEnd = "Slutdatumet måste komma efter startdatumet.";
      if (f.periodReason.trim().length < ORDER_REASON_MIN) e.periodReason = "Skriv varför insatsen behöver en annan längd.";
    }
  }
  if (step === 1) {
    if (!f.firstName.trim()) e.firstName = "Skriv deltagarens förnamn.";
    if (!f.lastName.trim()) e.lastName = "Skriv deltagarens efternamn.";
    if (!pnrFormatValid(f.pnr)) e.pnr = "Skriv tolv siffror så här: ÅÅÅÅMMDD-NNNN.";
    else if (dups.length) e.pnr = "Personen har redan en pågående insats. En person kan inte ha två pågående insatser samtidigt.";
    // Kallelsen går med e-post eller SMS (beslut 2026-10-09): telefonnummer eller e-postadress krävs. Numret prövas med samma
    // regel som SMS:et (src/core/phone.ts) – ett nummer som inte går att skicka till sparas inte.
    const digits = f.phone.replace(/\D/g, "").length;
    if (!digits && !f.email.trim()) e.phone = "Skriv deltagarens telefonnummer. Har deltagaren ingen telefon? Skriv e-postadressen i stället.";
    else if (f.phone.trim() && !hasPhone(f.phone)) e.phone = "Skriv hela telefonnumret med riktnummer, till exempel 070-123 45 67.";
    // Utan telefonnummer är e-postadressen den enda vägen – då går fältet inte att lämna tomt.
    if (f.email.trim() && !emailValid(f.email)) e.email = digits ? "Skriv en hel e-postadress, eller lämna fältet tomt." : "Skriv en hel e-postadress. Vi behöver telefonnummer eller e-postadress för kallelsen.";
    if (!f.primaryArea || !m.areas.some((a) => a.value === f.primaryArea)) e.primaryArea = "Välj ett yrkesområde.";
  }
  if (step === 2) {
    if (!f.priorAssessment) e.priorAssessment = "Svara om en kartläggning har genomförts.";
    if (uploading && f.priorAssessment === "yes") e.attachments = "Vänta tills filerna är uppladdade.";
  }
  return e;
}

export function PortalOrderScreen() {
  const q = useQuery(kommunOrderForm, {});
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <Loading />;
  return <OrderForm m={q.data} />;
}

/** Stegvisare: steg 1–3 numreras, granskningen visas som ett eget, onumrerat moment. */
function KomStepper({ current }: { current: number }) {
  return (
    <ol aria-label="Steg i beställningen" className="m-0 flex list-none flex-wrap gap-2 p-0">
      {STEPS.map((label, i) => {
        const review = i === DATA_STEPS;
        const done = i < current;
        const now = i === current;
        return (
          <li key={label} aria-current={now ? "step" : undefined} className={cn("flex items-center gap-2 pr-2 font-semibold text-text-muted portal:text-portal", now && "font-extrabold text-antracit")}>
            <span
              className={cn(
                "grid size-[30px] place-items-center rounded-full border-2 border-line-strong text-small font-extrabold portal:text-body [&_svg]:size-4",
                done && "border-bla bg-bla text-antracit",
                now && "border-antracit bg-antracit text-vit",
              )}
            >
              {done ? <Icon name="check" /> : review ? <Icon name="eye" /> : i + 1}
            </span>
            {done && <span className="sr-only">Klart: </span>}
            {label}
          </li>
        );
      })}
    </ol>
  );
}

/** Adressen för ett steg: ?steg=1–4 (granskningen är 4). fran=granskning när man ändrar från granskningen. */
const stepPath = (step: number, fromReview = false) => path("/portal/bestall", { steg: step > 0 ? step + 1 : null, fran: fromReview ? "granskning" : null });

/** Första steget som inte är klart (granskningen = 3 när allt är ifyllt). */
function firstOpenStep(f: Order, m: KomOrderForm, dups: readonly KomDuplicate[]): number {
  for (const s of [0, 1, 2]) if (Object.keys(validateStep(s, f, m, dups, false)).length) return s;
  return DATA_STEPS;
}

function OrderForm({ m }: { m: KomOrderForm }) {
  const nav = useNav();
  const toast = useToast();
  const confirm = useConfirm();
  const create = useCommand(caseCreate);
  const update = useCommand(caseUpdate);
  const removeFile = useCommand(attachmentRemove);
  // Utkastminne (bara i minnet – personnumret sparas aldrig i webblagring): det ifyllda finns kvar om man lämnar sidan.
  const draft = useDraft<Order>("portal-bestall", () => initialOrder(m));
  const f = draft.value;
  const setF = draft.set;
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialOrder(m)));
  // Steget ligger i adressen (?steg=, push): webbläsarens Tillbaka går till föregående steg.
  const urlStep = Math.min(DATA_STEPS, Math.max(0, (Number(nav.query.get("steg")) || 1) - 1));
  const fromReview = nav.query.get("fran") === "granskning";
  // Felen visas för steget där användaren tryckte Nästa (eller Skicka).
  const [errStep, setErrStep] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState<{ caseId: string; caseNumber: string } | null>(null);
  const headRef = useRef<HTMLHeadingElement | HTMLDivElement | null>(null);

  const pnrOk = pnrFormatValid(f.pnr);
  const dupQ = useQuery(kommunDuplicate, pnrOk ? { pnr: f.pnr.trim() } : null);
  const dups = pnrOk ? (dupQ.data ?? []) : [];
  // Ett steg längre fram än det som är ifyllt (t.ex. efter omladdning, när utkastet inte finns kvar): visa första ofärdiga steget.
  const open = firstOpenStep(f, m, dups);
  const step = Math.min(urlStep, open);
  const showErr = errStep === step;
  const goStep = (to: number, opts?: { fromReview?: boolean }) => nav.push(stepPath(to, opts?.fromReview));
  useEffect(() => {
    if (!done && urlStep > step) nav.replace(stepPath(step));
  }, [done, urlStep, step, nav]);
  // Nytt steg (eller kvittot): överst på sidan och fokus på stegets rubrik.
  useEffect(() => {
    try {
      window.scrollTo({ top: 0 });
      headRef.current?.focus({ preventScroll: true });
    } catch {
      /* fokus är valfritt */
    }
  }, [step, done]);
  const dirty = !done && JSON.stringify(f) !== baseline;
  useUnsavedGuard(dirty, "Beställningen är inte skickad. Det du har fyllt i finns kvar om du kommer tillbaka, men försvinner om du laddar om sidan.");
  const cancel = async () => {
    if (dirty) {
      const ok = await confirm({
        title: "Avbryta beställningen?",
        body: "Beställningen skickas inte och det du har fyllt i försvinner.",
        confirmLabel: "Avbryt beställningen",
        cancelLabel: "Fortsätt fylla i",
        tone: "danger",
      });
      if (!ok) return;
    }
    setF(initialOrder(m));
    draft.clear();
    leaveWithoutAsking(() => nav.push("/portal"));
  };

  const set = <K extends keyof Order>(k: K) => (v: Order[K]) => setF((x) => ({ ...x, [k]: v }));
  // Svaret Nej på kartläggningen: bifogade filer hör bara till svaret Ja. Finns filer frågar vi först och tar sedan bort dem
  // på servern (samma som "Ta bort" i listan) – inga uppladdningar blir kvar utan beställning.
  const choosePrior = async (v: PriorAnswer) => {
    if (v === f.priorAssessment) return;
    if (v === "no" && uploading) {
      toast("Vänta tills filerna är uppladdade.", "error");
      return;
    }
    if (v === "no" && f.attachments.length) {
      const n = f.attachments.length;
      const ok = await confirm({
        title: n === 1 ? "Ta bort den bifogade filen?" : "Ta bort de bifogade filerna?",
        body: `Du har svarat nej på frågan om kartläggning. ${n === 1 ? "Filen du har bifogat tas bort." : `De ${n} filerna du har bifogat tas bort.`}`,
        confirmLabel: n === 1 ? "Ta bort filen" : "Ta bort filerna",
        cancelLabel: "Behåll svaret ja",
        tone: "danger",
      });
      if (!ok) return;
      const left: AttachmentRow[] = [];
      for (const a of f.attachments) {
        const r = await removeFile.run({ attachmentId: a.id }).catch(() => null);
        if (!r || !r.ok) left.push(a);
      }
      if (left.length) {
        setF((x) => ({ ...x, attachments: left }));
        toast("Alla filer kunde inte tas bort. Försök igen.", "error");
        return;
      }
      setF((x) => ({ ...x, priorAssessment: "no", attachments: [] }));
      return;
    }
    setF((x) => ({ ...x, priorAssessment: v }));
  };
  const errs = validateStep(step, f, m, dups, uploading);
  const E = (k: string) => (showErr ? errs[k] : undefined);
  const end = periodEnd(f);

  const next = () => {
    if (Object.keys(errs).length) {
      // Felsammanfattningen överst i steget läses upp; fokus till första fältet med fel.
      setErrStep(step);
      focusFirstError(document.getElementById("main"));
      return;
    }
    setErrStep(null);
    goStep(fromReview ? DATA_STEPS : step + 1);
  };
  const back = () => {
    setErrStep(null);
    goStep(Math.max(0, step - 1));
  };
  const submit = async () => {
    for (const s of [0, 1, 2]) {
      if (Object.keys(validateStep(s, f, m, dups, uploading)).length) {
        goStep(s);
        setErrStep(s);
        toast("Några uppgifter behöver rättas innan du kan skicka.", "error");
        return;
      }
    }
    const period = f.period === OTHER
      ? { plannedEnd: f.otherEnd, orderPeriodReason: f.periodReason.trim() }
      : { orderPeriodMonths: Number(f.period) };
    // Ingen bostadsort och ingen kontaktväg (beslut 2026-10-09): servern väljer SMS eller e-post efter uppgifterna.
    const payload = {
      source: "portal" as const, referrerUnit: f.unit.trim(), firstName: f.firstName.trim(), lastName: f.lastName.trim(), pnr: f.pnr.trim(),
      phone: f.phone.trim(), email: f.email.trim(), primaryArea: f.primaryArea, desiredStart: f.desiredStart, ...period,
      priorAssessment: f.priorAssessment, background: f.background.trim(),
      attachmentIds: f.priorAssessment === "yes" ? f.attachments.map((a) => a.id) : [],
    };
    const res = await create.run(payload).catch(() => null);
    if (!res) {
      toast("Beställningen kunde inte skickas. Försök igen.", "error");
      return;
    }
    if (!res.ok) {
      const to = res.error === "order_period" || res.error === "unit" ? 0 : res.error === "area" ? 1 : res.error === "prior_assessment" || res.error === "attachments" ? 2 : null;
      if (to != null) {
        goStep(to);
        setErrStep(to);
      }
      toast(res.message ?? "Beställningen kunde inte skickas.", "error");
      return;
    }
    // Beställarens kontaktuppgifter för just den här beställningen, om någon annan ska vara kontaktperson.
    if (f.contactName !== m.me.name || f.contactPhone !== m.me.phone || f.contactEmail !== m.me.email) {
      await update
        .run({ caseId: res.caseId, patch: { referrerName: f.contactName.trim(), referrerPhone: f.contactPhone.trim(), referrerEmail: f.contactEmail.trim() } })
        .catch(() => null);
    }
    draft.clear();
    setDone({ caseId: res.caseId, caseNumber: res.caseNumber });
    toast(`Beställningen är skickad. Ärendenummer ${res.caseNumber}.`);
  };
  const again = () => {
    const fresh = initialOrder(m, { contactName: f.contactName, unit: f.unit, contactPhone: f.contactPhone, contactEmail: f.contactEmail, desiredStart: f.desiredStart });
    setDone(null);
    setF(fresh);
    draft.clear();
    setBaseline(JSON.stringify(fresh));
    setErrStep(null);
    nav.replace(stepPath(0));
  };

  if (done) return <OrderDone caseId={done.caseId} customerName={m.customerName} onAgain={again} headRef={headRef as RefObject<HTMLDivElement | null>} />;

  const periodOptions = [
    ...m.periods.months.map((n) => ({ value: String(n), label: `${n} månader` })),
    ...(m.periods.allowOther ? [{ value: OTHER, label: "Annan tidsperiod" }] : []),
  ];

  let body: ReactNode = null;
  if (step === 0) {
    body = (
      <Stack>
        <Notice tone="info" title="Uppgifterna kommer från ditt konto">
          Ändra om någon annan ska vara kontaktperson för den här beställningen.
        </Notice>
        <FormGrid>
          <Field id="kom-o-name" label="Ditt namn" required error={E("contactName")} help="Den som beställer och är kontaktperson hos kommunen.">
            <Input value={f.contactName} onValueChange={set("contactName")} autoComplete="name" />
          </Field>
          <Field id="kom-o-unit" label="Enhet" required error={E("unit")} help="Skriv vilken enhet du arbetar på, till exempel Arbetsmarknadsenheten Alby.">
            <Input value={f.unit} onValueChange={set("unit")} maxLength={120} />
          </Field>
          <Field id="kom-o-phone" label="Ditt telefonnummer" required error={E("contactPhone")} help="Hit ringer vi om vi har frågor om beställningen.">
            <Input type="tel" value={f.contactPhone} onValueChange={set("contactPhone")} autoComplete="tel" />
          </Field>
          <Field id="kom-o-email" label="Din e-postadress" required error={E("contactEmail")} help="Hit skickar vi ordererkännandet.">
            <Input type="email" value={f.contactEmail} onValueChange={set("contactEmail")} autoComplete="email" />
          </Field>
        </FormGrid>
        <Field
          id="kom-o-start"
          label="Önskat startdatum"
          required
          error={E("desiredStart")}
          help={`Vi bokar första mötet inom ${m.firstMeetingWithin} från beställningen. Startdatumet bekräftas i orderbekräftelsen.`}
        >
          <Input type="date" value={f.desiredStart} onValueChange={set("desiredStart")} />
        </Field>
        <Field id="kom-o-period" label="Omfattning" required error={E("period")} help="Hur länge insatsen ska pågå. Välj en annan tidsperiod bara om insatsen behöver en annan längd.">
          <Seg id="kom-o-period" ariaLabel="Omfattning" value={f.period} onValueChange={(v) => set("period")(v)} options={periodOptions} />
        </Field>
        {f.period && f.period !== OTHER && (
          <p className="flex items-start gap-2">
            <Icon name="calendar" className="mt-1 flex-none" />
            <span>
              Planerat slut: <b>{end ? fD(end) : "–"}</b>. Det räknas från startdatumet. Börjar insatsen ett annat datum räknar vi om
              slutdatumet från första mötet. Du ser det i orderbekräftelsen.
            </span>
          </p>
        )}
        {f.period === OTHER && (
          <Stack>
            <Field id="kom-o-end" label="Slutdatum" required error={E("otherEnd")} help="Den sista dagen i insatsen.">
              <Input type="date" value={f.otherEnd} onValueChange={set("otherEnd")} />
            </Field>
            <Field
              id="kom-o-reason"
              label="Motivering"
              required
              error={E("periodReason")}
              help={`Berätta varför insatsen behöver en annan längd. Skriv inga diagnoser eller uppgifter om hälsa. Högst ${ORDER_REASON_MAX} tecken.`}
            >
              <TextArea rows={3} maxLength={ORDER_REASON_MAX} value={f.periodReason} onValueChange={set("periodReason")} />
            </Field>
          </Stack>
        )}
      </Stack>
    );
  }
  if (step === 1) {
    body = (
      <Stack>
        <Notice tone="info" title="Lämna bara de uppgifter som behövs">
          Vi använder uppgifterna för att kalla deltagaren och planera insatsen. Skriv inga diagnoser, inga uppgifter om hälsa och inga uppgifter om brott.
        </Notice>
        <FormGrid>
          <Field id="kom-o-fn" label="Förnamn" required error={E("firstName")} help="Som i folkbokföringen.">
            <Input value={f.firstName} onValueChange={set("firstName")} />
          </Field>
          <Field id="kom-o-ln" label="Efternamn" required error={E("lastName")} help="Som i folkbokföringen.">
            <Input value={f.lastName} onValueChange={set("lastName")} />
          </Field>
        </FormGrid>
        <Field
          id="kom-o-pnr"
          label="Personnummer eller samordningsnummer"
          required
          error={E("pnr") ?? (dups.length ? "Personen har redan en pågående insats." : undefined)}
          help="Tolv siffror: ÅÅÅÅMMDD-NNNN. Samordningsnummer skrivs på samma sätt. Numret visas bara maskerat i tjänsten."
        >
          <Input value={f.pnr} inputMode="numeric" maxLength={15} onValueChange={set("pnr")} />
        </Field>
        {dups.length > 0 && <DupNotice dups={dups} onOpen={(id) => nav.push(`/portal/deltagare/${encodeURIComponent(id)}`)} />}
        {/* Telefon eller e-post krävs (beslut 2026-10-09): en grupp med en rubrik, så att markeringen för obligatoriskt inte
            hoppar mellan fälten. Skärmläsaren läser rubriken när fokus kommer in i gruppen. */}
        <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          <legend className="mb-3 p-0 text-ui font-bold portal:text-h3">
            Hur når vi deltagaren? Fyll i telefonnummer eller e-postadress
            <span className="font-extrabold before:ml-0.5 before:text-rod before:content-['*']">
              <span className="sr-only">(obligatoriskt)</span>
            </span>
          </legend>
          <FormGrid>
            <Field id="kom-o-dphone" label="Deltagarens telefonnummer" error={E("phone")} help="Vi skickar kallelsen med e-post eller SMS. Går det inte ringer vi deltagaren.">
              <Input type="tel" value={f.phone} onValueChange={set("phone")} />
            </Field>
            <Field id="kom-o-demail" label="Deltagarens e-postadress" error={E("email")} help="Har deltagaren en e-postadress? Då skickar vi kallelsen dit.">
              <Input type="email" value={f.email} onValueChange={set("email")} />
            </Field>
          </FormGrid>
        </fieldset>
        <Field
          id="kom-o-area"
          label="Yrkesområde"
          required
          error={E("primaryArea")}
          help={`Det yrkesområde deltagaren ska arbeta mot.${m.otherAreaName ? ` Välj ${m.otherAreaName} om inget passar.` : ""}`}
        >
          <Select value={f.primaryArea} onValueChange={set("primaryArea")} placeholder="Välj yrkesområde" options={m.areas} />
        </Field>
      </Stack>
    );
  }
  if (step === 2) {
    body = (
      <Stack>
        <Field
          id="kom-o-prior"
          label="Har en kartläggning genomförts?"
          required
          error={E("priorAssessment")}
          help="Till exempel hos kommunen eller Arbetsförmedlingen. Svarar du ja kan du bifoga kartläggningen."
        >
          <Seg id="kom-o-prior" ariaLabel="Har en kartläggning genomförts?" value={f.priorAssessment} onValueChange={(v) => void choosePrior(v)} options={PRIOR} />
        </Field>
        {f.priorAssessment === "yes" && (
          <Field id="kom-o-files" label="Bifoga fil" error={E("attachments")} help="Bifoga kartläggningen om du har den. Det går också bra att inte bifoga något.">
            <AttachmentPicker
              id="kom-o-files"
              caseId={null}
              rows={f.attachments}
              onRows={(rows) => setF((x) => ({ ...x, attachments: rows }))}
              maxFiles={m.attachments.maxFiles}
              accept={m.attachments.accept}
              typesText={m.attachments.typesText}
              onBusy={setUploading}
            />
          </Field>
        )}
        <Field
          id="kom-o-bg"
          label="Bakgrundsinformation"
          help="Var så detaljerad som möjligt – det är en bra utgångspunkt för oss. Skriv om erfarenhet, utbildning, mål och vad personen behöver. Skriv inga diagnoser eller uppgifter om hälsa."
        >
          <TextArea rows={8} maxLength={BACKGROUND_MAX} value={f.background} onValueChange={set("background")} />
        </Field>
        <TalaIn fieldId="kom-o-bg" onText={(t) => setF((x) => ({ ...x, background: joinText(x.background, t, BACKGROUND_MAX) }))} />
      </Stack>
    );
  }
  if (step === 3) {
    const edit = (to: number) => {
      setErrStep(null);
      goStep(to, { fromReview: true });
    };
    body = (
      <Stack>
        <Card>
          <Stack>
            <ReviewSection
              title="Beställning och kontakt"
              onEdit={() => edit(0)}
              items={[
                ["Beställare", `${f.contactName}, ${f.unit}`],
                ["Telefon", f.contactPhone],
                ["E-post", f.contactEmail],
                ["Önskat startdatum", fD(f.desiredStart)],
                ["Omfattning", periodLabel(f.period)],
                ["Planerat slut", end ? fD(end) : "–"],
                f.period === OTHER && ["Motivering", f.periodReason],
              ]}
            />
            <ReviewSection
              title="Deltagare"
              onEdit={() => edit(1)}
              items={[
                ["Namn", `${f.firstName} ${f.lastName}`],
                ["Personnummer", maskPnr(f.pnr)],
                ["Telefon", f.phone || "Inte angivet"],
                ["E-post", f.email || "Inte angivet"],
                ["Yrkesområde", m.areas.find((a) => a.value === f.primaryArea)?.label ?? "–"],
              ]}
            />
            <ReviewSection
              title="Bakgrundsinformation om deltagaren"
              onEdit={() => edit(2)}
              items={[
                ["Kartläggning genomförd", f.priorAssessment ? PRIOR_ASSESSMENT_LABEL[f.priorAssessment] : "–"],
                f.priorAssessment === "yes" && ["Bifogade filer", f.attachments.length ? `${f.attachments.length} ${f.attachments.length === 1 ? "fil" : "filer"}` : "Inga"],
                ["Bakgrundsinformation", f.background || "Inte angivet"],
              ]}
            />
            {f.priorAssessment === "yes" && f.attachments.length > 0 && <AttachmentList rows={f.attachments} />}
          </Stack>
        </Card>
        <Notice tone="info" title="När du skickar">
          Beställningen får ett ärendenummer och du får ordererkännandet här och i ett mejl. Senast {fDTL(m.answerDue)} får du besked om startdatum och coach.
        </Notice>
      </Stack>
    );
  }

  return (
    <KomPage>
      <KomHead
        eyebrow={`${m.customerName} · beställning`}
        title="Beställ ny insats"
        lead={step === 0 ? "Fyll i uppgifterna i tre korta steg och granska innan du skickar. Du kan gå tillbaka och ändra." : undefined}
      />
      <KomStepper current={step} />
      <Card>
        <Stack>
          <Stack gap="sm">
            <Eyebrow>{step < DATA_STEPS ? `Steg ${step + 1} av ${DATA_STEPS}` : "Granska innan du skickar"}</Eyebrow>
            <h2 tabIndex={-1} ref={headRef as RefObject<HTMLHeadingElement | null>} className="text-h2 font-extrabold outline-none portal:text-[1.25rem]">
              {STEPS[step]}
            </h2>
          </Stack>
          {showErr && step < DATA_STEPS && (
            <ErrorSummary
              title="Rätta det här innan du går vidare"
              items={Object.entries(errs).map(([k, text]) => ({ id: ERROR_FIELD[k] ?? "kom-o-name", text }))}
            />
          )}
          {body}
        </Stack>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-3">
          {step > 0 && !fromReview && (
            <Button icon="arrow-left" onClick={back}>
              Tillbaka
            </Button>
          )}
          {/* Avbryt finns på alla steg – frågar först om något är ifyllt. */}
          <Button kind="ghost" icon="x" onClick={() => void cancel()}>
            Avbryt
          </Button>
        </span>
        {step < 3 && fromReview ? (
          <Button kind="primary" size="lg" icon="check" onClick={next}>
            Spara och tillbaka till granskningen
          </Button>
        ) : step < 3 ? (
          <Button kind="primary" size="lg" iconRight="arrow-right" onClick={next}>
            {step === 2 ? "Nästa: granska" : `Nästa: ${STEPS[step + 1].toLowerCase()}`}
          </Button>
        ) : (
          <Button kind="primary" size="lg" icon="send" pending={create.pending} onClick={() => void submit()}>
            Skicka beställningen
          </Button>
        )}
      </div>
      <DemoNote>Beställningen och filerna sparas bara i den här webbläsaren. Mejlet skickas inte på riktigt – utskicket syns i utskicksloggen hos Miljonbemanning.</DemoNote>
      <div className="flex flex-wrap items-center gap-3">
        <PerspectiveLink role="samordnare" to="/inkorg" label="Se hur beställningar tas emot hos Miljonbemanning" />
      </div>
    </KomPage>
  );
}

/** Ett avsnitt i granskningen med knappen "Ändra". */
function ReviewSection({ title, onEdit, items }: { title: string; onEdit: () => void; items: readonly ([string, string] | false)[] }) {
  return (
    <div className="flex flex-col gap-2.5 [&+&]:border-t [&+&]:border-ljusgra [&+&]:pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-body font-extrabold tracking-[0.09em] text-text-muted uppercase">{title}</div>
        <Button kind="ghost" icon="edit" onClick={onEdit} ariaLabel={`Ändra ${title.toLowerCase()}`}>
          Ändra
        </Button>
      </div>
      <Kv items={items} />
    </div>
  );
}

function DupNotice({ dups, onOpen }: { dups: readonly KomDuplicate[]; onOpen: (caseId: string) => void }) {
  return (
    <Notice tone="critical" title="Personen har redan en pågående insats">
      <Stack gap="sm">
        <span>En person kan ha flera insatser över tid, men inte två samtidigt.</span>
        {dups.map((c, i) =>
          c.caseId && c.caseNumber && c.status ? (
            <span key={c.caseId} className="flex flex-wrap items-center gap-2.5">
              <span>
                Pågående insats: <b>{c.caseNumber}</b> ({statusName(c.status)}).
              </span>
              <Button iconRight="arrow-right" onClick={() => onOpen(c.caseId as string)}>
                Öppna insatsen
              </Button>
            </span>
          ) : (
            <span key={`annan-${i}`}>
              Insatsen är beställd av en annan handläggare.{CONTACT_PHONE ? ` Ring oss på ${CONTACT_PHONE} så hjälper vi dig.` : " Hör av dig till oss på Miljonbemanning så hjälper vi dig."}
            </span>
          ),
        )}
      </Stack>
    </Notice>
  );
}

/**
 * Hur deltagaren kallas, i löpande text. Kallelsen går med e-post eller SMS beroende på vad som finns och fungerar, annars ringer
 * Miljonbemanning (notifyParticipant, beslut 2026-10-09) – kvittot lovar därför ingen viss kanal. Äldre beställningar kan ha brev.
 */
const inviteText = (label: string | null | undefined): string => {
  if (label === "Brev") return "Deltagaren får en kallelse med brev.";
  if (label === "SMS" || label === "E-post") return "Deltagaren får en kallelse med e-post eller SMS. Går det inte ringer vi deltagaren.";
  return "Vi kontaktar deltagaren och bokar tiden.";
};

/** Kvittot: ärendenummer, ordererkännande, mejlet och hur det går vidare. */
function OrderDone({ caseId, customerName, onAgain, headRef }: { caseId: string; customerName: string; onAgain: () => void; headRef: RefObject<HTMLDivElement | null> }) {
  const q = useQuery(kommunReceipt, { caseId });
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading) return <Loading />;
  const c = q.data;
  if (!c) {
    return (
      <KomPage>
        <Notice tone="critical" title="Beställningen hittades inte">
          Ladda om sidan och försök igen.
        </Notice>
      </KomPage>
    );
  }
  return (
    <KomPage>
      <KomHead eyebrow={`${customerName} · beställning`} title="Tack! Beställningen är skickad" />
      <Card tone="blue">
        <Stack>
          <Stack gap="sm">
            <div className="text-body font-extrabold tracking-[0.09em] text-text-muted uppercase">Ärendenummer</div>
            <div ref={headRef} tabIndex={-1} className="text-[clamp(1.75rem,8vw,2.5rem)] leading-[1.1] font-extrabold tracking-[0.02em] tabular-nums outline-none">
              {c.caseNumber}
            </div>
            <p>Ärendenumret är beställningens nummer. Använd det i stället för personnummer när du kontaktar oss om deltagaren.</p>
          </Stack>
          <Stack gap="sm">
            <div className="text-body font-extrabold tracking-[0.09em] text-text-muted uppercase">Ordererkännande</div>
            <p>{fullText(c.ackText)}</p>
          </Stack>
        </Stack>
      </Card>
      {c.mail && (
        <Card title="Mejlet du får" icon="mail">
          <Stack gap="sm">
            <div className="flex flex-col gap-1.5 rounded-mb border-[1.5px] border-line-strong bg-ljusgra-ton px-4 py-3.5 [overflow-wrap:anywhere]">
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-body text-text-muted">
                <span>Från: {c.mail.from}</span>
                <span className="[overflow-wrap:anywhere]">Till: {c.mail.to}</span>
                <span>{fDT(c.mail.at)}</span>
              </div>
              <div>{fullText(c.mail.body)}</div>
            </div>
            <OkLine>Mejlet innehåller bara ärendenumret – inga personuppgifter.</OkLine>
          </Stack>
        </Card>
      )}
      <Card title="Så här går det vidare" icon="list">
        <Timeline
          items={[
            {
              icon: "check",
              filled: true,
              title: "Beställningen är mottagen",
              sub: fDTL(c.referredAt),
              body: <span>Den har fått ärendenummer {c.caseNumber}.{c.areaName ? ` Yrkesområde: ${c.areaName}.` : ""}</span>,
            },
            { icon: "calendar", title: "Orderbekräftelse", sub: `Senast ${fDTL(c.avropDue)}`, body: <span>Du får startdatum, ansvarig coach och tid för första mötet i portalen.</span> },
            {
              icon: "users",
              title: "Första mötet med deltagaren",
              sub: `Senast ${fD(c.firstMeetingDue)}`,
              body: <span>{inviteText(c.contactLabel)}</span>,
            },
          ]}
        />
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button kind="primary" size="lg" iconRight="arrow-right" to={`/portal/deltagare/${encodeURIComponent(c.caseId)}`}>
          Se beställningen
        </Button>
        <Button size="lg" icon="plus" onClick={onAgain}>
          Beställ en till
        </Button>
        <Button kind="ghost" size="lg" icon="arrow-left" to="/portal">
          Till start
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <PerspectiveLink role="samordnare" to={`/inkorg?arende=${encodeURIComponent(c.caseId)}`} label="Se hur beställningen landar hos Miljonbemanning" />
      </div>
    </KomPage>
  );
}
