"use client";
// Beställ ny insats i portalen (/portal/bestall) – prototypens kom.bestall. Tre steg med uppgifter (som beställningsmallen)
// och en granskning innan beställningen skickas. Beställningen sparas med arenden.caseCreate (delat kommando), som ger
// ärendenummer och skickar ordererkännandet (eller en generisk bekräftelse vid skyddade personuppgifter).
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { OperationalConfig } from "@/core/config";
import { TESTER_HIDDEN_TEXT } from "@/api/tester-access";
import { kr } from "@/core/format";
import { addDays, monday } from "@/core/time";
import { buyerRefError, buyerRefLengthText, emailValid, pnrFormatValid } from "@/core/validation";
import type { PreferredContact } from "@/data/schema";
import { caseCreate, caseUpdate } from "@/features/arenden/api";
import { useCommand, useQuery } from "@/shell/backend";
import { leaveWithoutAsking, useDraft, useUnsavedGuard } from "@/shell/guard";
import { path, useNav } from "@/shell/nav";
import {
  Button, Card, DemoNote, ErrorNotice, ErrorSummary, Eyebrow, focusFirstError, FormGrid, Icon, Input, Kv, Loading, Notice, PerspectiveLink, Seg, Select, Stack, TextArea, Timeline,
  cn, useConfirm, useToast, Field, type IconName,
} from "@/ui";
import { kommunDuplicate, kommunOrderForm, kommunReceipt, type KomDuplicate, type KomOrderForm } from "../api";
import { fD, fDT, fDTL, fullText, maskPnr, SAFE_PHONE, statusName } from "../texts";
import { KomHead, KomPage, OkLine } from "./parts";
import { joinText, TalaIn } from "./tala-in";

const STEPS = ["Beställning och kontakt", "Deltagare", "Avtalsområde", "Granska och skicka"] as const;
const DATA_STEPS = 3;
const CONTACTS: { value: PreferredContact; label: string; icon: IconName }[] = [
  { value: "sms", label: "SMS", icon: "message" },
  { value: "phone", label: "Telefon", icon: "phone" },
  { value: "email", label: "E-post", icon: "mail" },
  { value: "letter", label: "Brev", icon: "file" },
];
const CONTACT_LABEL: Record<PreferredContact, string> = { sms: "SMS", phone: "Telefon", email: "E-post", letter: "Brev" };

type Order = {
  contactName: string;
  unit: string;
  contactPhone: string;
  contactEmail: string;
  buyerReference: string;
  desiredStart: string;
  plannedWeeks: number | null;
  plannedEnd: string;
  endTouched: boolean;
  protectedIdentity: boolean | null;
  firstName: string;
  lastName: string;
  pnr: string;
  phone: string;
  email: string;
  city: string;
  preferredContact: PreferredContact;
  address: string;
  accessibilityNeeds: string;
  primaryArea: string;
  secondaryArea: string;
  vocationalTrack: string;
  background: string;
};
type Base = Pick<Order, "contactName" | "unit" | "contactPhone" | "contactEmail" | "buyerReference" | "desiredStart" | "plannedWeeks" | "plannedEnd" | "endTouched">;

function initialOrder(m: KomOrderForm, keep?: Base): Order {
  const base: Base = keep ?? {
    contactName: m.me.name, unit: m.me.unit, contactPhone: m.me.phone, contactEmail: m.me.email, buyerReference: m.lastBuyerRef,
    desiredStart: m.defaultStart, plannedWeeks: null, plannedEnd: "", endTouched: false,
  };
  return {
    ...base, protectedIdentity: null, firstName: "", lastName: "", pnr: "", phone: "", email: "", city: "", preferredContact: "sms", address: "",
    accessibilityNeeds: "", primaryArea: "", secondaryArea: "", vocationalTrack: "", background: "",
  };
}
/** Planerat slut: fredagen i den sista veckan. */
const endFor = (start: string, weeks: number | null): string => (start && weeks ? addDays(monday(start), (weeks - 1) * 7 + 4) : "");

/** Avtalets mönster för beställarreferensen som konfiguration (buyerRefError läser bara mönstret). */
const refCfg = (m: KomOrderForm) => ({ billing: { buyerReference: m.buyerReference } }) as unknown as Pick<OperationalConfig, "billing">;
function refError(m: KomOrderForm, v: string): string | null {
  const e = buyerRefError(v, refCfg(m));
  if (e) return e;
  const ref = String(v).trim();
  if (m.blockedRefs.includes(ref)) return `Referensen ${ref} är spärrad. Kommunens ekonomi känner inte igen den. Kontrollera att inga siffror har blivit omkastade.`;
  return null;
}

/** Fältet som ett fel gäller (länkarna i felsammanfattningen). */
const ERROR_FIELD: Record<string, string> = {
  contactName: "kom-o-name", contactPhone: "kom-o-phone", contactEmail: "kom-o-email", buyerReference: "kom-o-ref", desiredStart: "kom-o-start", plannedWeeks: "kom-o-weeks",
  plannedEnd: "kom-o-end", protectedIdentity: "kom-o-prot", firstName: "kom-o-fn", lastName: "kom-o-ln", pnr: "kom-o-pnr", phone: "kom-o-dphone", email: "kom-o-demail",
  city: "kom-o-city", address: "kom-o-addr", primaryArea: "kom-o-area", secondaryArea: "kom-o-area2",
};

function validateStep(step: number, f: Order, m: KomOrderForm, dups: readonly KomDuplicate[]): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 0) {
    if (!f.contactName.trim()) e.contactName = "Skriv ditt namn.";
    if (f.contactPhone.replace(/\D/g, "").length < 7) e.contactPhone = "Skriv ett telefonnummer där vi når dig.";
    if (!emailValid(f.contactEmail)) e.contactEmail = "Skriv en hel e-postadress.";
    const re = refError(m, f.buyerReference);
    if (re) e.buyerReference = re;
    if (!f.desiredStart) e.desiredStart = "Välj ett önskat startdatum.";
    else if (f.desiredStart < m.today) e.desiredStart = "Datumet har redan passerat. Välj ett senare datum.";
    if (!f.plannedWeeks) e.plannedWeeks = "Välj hur många veckor insatsen ska pågå.";
    if (f.plannedEnd && f.desiredStart && f.plannedEnd <= f.desiredStart) e.plannedEnd = "Slutdatumet måste komma efter startdatumet.";
  }
  if (step === 1) {
    if (f.protectedIdentity == null) e.protectedIdentity = "Svara ja eller nej.";
    if (!f.firstName.trim()) e.firstName = "Skriv deltagarens förnamn.";
    if (!f.lastName.trim()) e.lastName = "Skriv deltagarens efternamn.";
    if (!pnrFormatValid(f.pnr)) e.pnr = "Skriv tolv siffror så här: ÅÅÅÅMMDD-NNNN.";
    else if (dups.length) e.pnr = "Personen har redan en pågående insats. En person kan inte ha två pågående insatser samtidigt.";
    if (f.protectedIdentity === false) {
      if ((f.preferredContact === "sms" || f.preferredContact === "phone") && f.phone.replace(/\D/g, "").length < 8) e.phone = "Skriv deltagarens telefonnummer. Vi behöver det för kallelsen.";
      if (f.email.trim() && !emailValid(f.email)) e.email = "Skriv en hel e-postadress, eller lämna fältet tomt.";
      if (f.preferredContact === "email" && !f.email.trim()) e.email = "Skriv deltagarens e-postadress. Du har valt e-post som kontaktväg.";
      if (!f.city.trim()) e.city = "Skriv deltagarens bostadsort.";
      if (f.preferredContact === "letter" && f.address.trim().length < 6) e.address = "Skriv hela adressen. Du har valt att kallelsen ska skickas med brev.";
    }
  }
  if (step === 2) {
    if (!f.primaryArea) e.primaryArea = "Välj ett avtalsområde.";
    if (f.secondaryArea && f.secondaryArea === f.primaryArea) e.secondaryArea = "Välj ett annat område än det första, eller inget.";
  }
  return e;
}

export function PortalOrderScreen() {
  const q = useQuery(kommunOrderForm, {});
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <Loading />;
  return <OrderForm m={q.data} />;
}

/** Stegvisare: steg 1–3 numreras, granskningen visas som ett eget, onumrerat moment. Hoppas steg 3 över visas ett streck. */
function KomStepper({ current, skipped }: { current: number; skipped: number | null }) {
  return (
    <ol aria-label="Steg i beställningen" className="m-0 flex list-none flex-wrap gap-2 p-0">
      {STEPS.map((label, i) => {
        const review = i === DATA_STEPS;
        const skip = i === skipped;
        const done = !skip && i < current;
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
              {skip ? <Icon name="minus" /> : done ? <Icon name="check" /> : review ? <Icon name="eye" /> : i + 1}
            </span>
            {done && <span className="sr-only">Klart: </span>}
            {skip ? `${label} (tas per telefon)` : label}
          </li>
        );
      })}
    </ol>
  );
}

/** Adressen för ett steg: ?steg=1–4 (granskningen är 4). fran=granskning när man ändrar från granskningen. */
const stepPath = (step: number, fromReview = false) => path("/portal/bestall", { steg: step > 0 ? step + 1 : null, fran: fromReview ? "granskning" : null });

/** Första steget som inte är klart (granskningen = 3 när allt är ifyllt). Steg 3 hoppas över vid skyddade personuppgifter. */
function firstOpenStep(f: Order, m: KomOrderForm, dups: readonly KomDuplicate[]): number {
  for (const s of f.protectedIdentity ? [0, 1] : [0, 1, 2]) if (Object.keys(validateStep(s, f, m, dups)).length) return s;
  return DATA_STEPS;
}

function OrderForm({ m }: { m: KomOrderForm }) {
  const nav = useNav();
  const toast = useToast();
  const confirm = useConfirm();
  const create = useCommand(caseCreate);
  const update = useCommand(caseUpdate);
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
  const [refTouched, setRefTouched] = useState(false);
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

  const set = <K extends keyof Order>(k: K) => (v: Order[K]) =>
    setF((x) => {
      const n: Order = { ...x, [k]: v };
      if ((k === "desiredStart" || k === "plannedWeeks") && !x.endTouched) n.plannedEnd = endFor(n.desiredStart, n.plannedWeeks);
      if (k === "plannedEnd") n.endTouched = true;
      if (k === "primaryArea" && n.secondaryArea === v) n.secondaryArea = "";
      return n;
    });
  const errs = validateStep(step, f, m, dups);
  const E = (k: string) => (showErr ? errs[k] : undefined);
  const refErr = refTouched || showErr ? refError(m, f.buyerReference) : null;
  const price = (() => {
    if (!f.primaryArea) return 0;
    const date = f.desiredStart || m.today;
    return m.prices?.find((p) => p.areaCode === f.primaryArea && p.validFrom <= date && (!p.validTo || p.validTo >= date))?.priceOre ?? 0;
  })();
  const areaLabel = (code: string) => {
    const a = m.areas.find((x) => x.code === code);
    return a ? `${a.code} ${a.name}` : "–";
  };

  const next = () => {
    if (Object.keys(errs).length) {
      // Felsammanfattningen överst i steget läses upp; fokus till första fältet med fel.
      setErrStep(step);
      focusFirstError(document.getElementById("main"));
      return;
    }
    setErrStep(null);
    goStep(fromReview ? DATA_STEPS : step === 1 && f.protectedIdentity ? 3 : step + 1);
  };
  const back = () => {
    setErrStep(null);
    goStep(step === 3 && f.protectedIdentity ? 1 : Math.max(0, step - 1));
  };
  const submit = async () => {
    for (const s of f.protectedIdentity ? [0, 1] : [0, 1, 2]) {
      if (Object.keys(validateStep(s, f, m, dups)).length) {
        goStep(s);
        setErrStep(s);
        toast("Några uppgifter behöver rättas innan du kan skicka.", "error");
        return;
      }
    }
    const common = { firstName: f.firstName.trim(), lastName: f.lastName.trim(), pnr: f.pnr.trim(), source: "portal" as const };
    // Skyddade personuppgifter: om deltagaren sparas bara namn och personnummer, men beställningens uppgifter från steg 1 följer med.
    const order = { buyerReference: f.buyerReference.trim(), desiredStart: f.desiredStart, plannedWeeks: f.plannedWeeks, plannedEnd: f.plannedEnd || null };
    const payload = f.protectedIdentity
      ? { ...common, ...order, protectedIdentity: true }
      : {
          ...common, ...order, protectedIdentity: false, phone: f.phone.trim(), email: f.email.trim(), city: f.city.trim(), preferredContact: f.preferredContact,
          address: f.preferredContact === "letter" ? f.address.trim() : null, accessibilityNeeds: f.accessibilityNeeds.trim(), primaryArea: f.primaryArea,
          secondaryArea: f.secondaryArea || null, vocationalTrack: f.vocationalTrack.trim(), background: f.background.trim(),
        };
    const res = await create.run(payload).catch(() => null);
    if (!res) {
      toast("Beställningen kunde inte skickas. Försök igen.", "error");
      return;
    }
    if (!res.ok) {
      if (res.error === "buyer_ref") {
        goStep(0);
        setErrStep(0);
        setRefTouched(true);
        toast("Beställarreferensen behöver rättas.", "error");
      } else toast(res.message ?? "Beställningen kunde inte skickas.", "error");
      return;
    }
    // Beställarens kontaktuppgifter för just den här beställningen, om någon annan ska vara kontaktperson.
    if (f.contactName !== m.me.name || f.contactPhone !== m.me.phone || f.contactEmail !== m.me.email) {
      await update
        .run({ caseId: res.caseId, patch: { referrerName: f.contactName.trim(), referrerUnit: f.unit, referrerPhone: f.contactPhone.trim(), referrerEmail: f.contactEmail.trim() } })
        .catch(() => null);
    }
    draft.clear();
    setDone({ caseId: res.caseId, caseNumber: res.caseNumber });
    toast(`Beställningen är skickad. Ärendenummer ${res.caseNumber}.`);
  };
  const again = () => {
    const fresh = initialOrder(m, { contactName: f.contactName, unit: f.unit, contactPhone: f.contactPhone, contactEmail: f.contactEmail, buyerReference: f.buyerReference, desiredStart: f.desiredStart, plannedWeeks: null, plannedEnd: "", endTouched: false });
    setDone(null);
    setF(fresh);
    draft.clear();
    setBaseline(JSON.stringify(fresh));
    setErrStep(null);
    nav.replace(stepPath(0));
  };

  if (done) return <OrderDone caseId={done.caseId} customerName={m.customerName} onAgain={again} headRef={headRef as RefObject<HTMLDivElement | null>} />;

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
          <Field id="kom-o-unit" label="Enhet" help="Hämtas från ditt konto.">
            <Input value={f.unit} onValueChange={set("unit")} />
          </Field>
          <Field id="kom-o-phone" label="Ditt telefonnummer" required error={E("contactPhone")} help="Hit ringer vi om vi har frågor om beställningen.">
            <Input type="tel" value={f.contactPhone} onValueChange={set("contactPhone")} autoComplete="tel" />
          </Field>
          <Field id="kom-o-email" label="Din e-postadress" required error={E("contactEmail")} help="Hit skickar vi ordererkännandet. Mejlet innehåller bara ärendenumret.">
            <Input type="email" value={f.contactEmail} onValueChange={set("contactEmail")} autoComplete="email" />
          </Field>
        </FormGrid>
        <Field
          id="kom-o-ref"
          label="Beställarreferens"
          required
          error={refErr ?? undefined}
          help={`${buyerRefLengthText(refCfg(m))} siffror, bara siffror. Referensen behövs för att fakturan ska hamna rätt hos kommunen. Den du använde senast är redan ifylld.`}
        >
          <Input
            value={f.buyerReference}
            inputMode="numeric"
            maxLength={14}
            onValueChange={(v) => {
              set("buyerReference")(v);
              setRefTouched(true);
            }}
          />
        </Field>
        {!refErr && refTouched && <OkLine>Beställarreferensen har rätt format.</OkLine>}
        <FormGrid>
          <Field
            id="kom-o-start"
            label="Önskat startdatum"
            required
            error={E("desiredStart")}
            help={`Vi bokar första mötet inom ${m.firstMeetingWithin} från beställningen. Startdatumet bekräftas i orderbekräftelsen.`}
          >
            <Input type="date" value={f.desiredStart} onValueChange={set("desiredStart")} />
          </Field>
          <Field id="kom-o-end" label="Planerat slutdatum" error={E("plannedEnd")} help="Räknas fram från startdatum och antal veckor. Du kan ändra det.">
            <Input type="date" value={f.plannedEnd} onValueChange={set("plannedEnd")} />
          </Field>
        </FormGrid>
        <Field
          id="kom-o-weeks"
          label="Planerad omfattning i veckor"
          required
          error={E("plannedWeeks")}
          help={`Insatser är oftast mellan ${m.weeks.min} och ${m.weeks.max} veckor. Fakturan räknas per vecka som deltagaren är inskriven.`}
        >
          <Seg
            id="kom-o-weeks"
            ariaLabel="Planerad omfattning i veckor"
            value={f.plannedWeeks == null ? null : String(f.plannedWeeks)}
            onValueChange={(v) => set("plannedWeeks")(Number(v))}
            options={Array.from({ length: m.weeks.max - m.weeks.min + 1 }, (_, i) => String(m.weeks.min + i))}
          />
        </Field>
      </Stack>
    );
  }
  if (step === 1) {
    body = (
      <Stack>
        <Notice tone="info" title="Lämna bara de uppgifter som behövs">
          Vi använder uppgifterna för att kalla deltagaren och planera insatsen. Skriv inga diagnoser, inga uppgifter om hälsa och inga uppgifter om brott. Beskriv i stället
          vad personen behöver.
        </Notice>
        <Field id="kom-o-prot" label="Har deltagaren skyddade personuppgifter?" required error={E("protectedIdentity")} help="Till exempel sekretessmarkering eller skyddad folkbokföring. Är du osäker, välj Ja.">
          <Seg
            id="kom-o-prot"
            ariaLabel="Skyddade personuppgifter"
            value={f.protectedIdentity == null ? null : f.protectedIdentity ? "ja" : "nej"}
            onValueChange={(v) => set("protectedIdentity")(v === "ja")}
            options={[
              { value: "nej", label: "Nej" },
              { value: "ja", label: "Ja", icon: "lock" },
            ]}
          />
        </Field>
        {f.protectedIdentity === true && (
          <Notice tone="critical" title={`Ring oss på ${SAFE_PHONE} så tar vi resten enligt den säkra rutinen.`}>
            Fyll bara i namn och personnummer här. Om deltagaren sparar vi bara namn och personnummer. Uppgifterna om beställningen från steg 1, till exempel
            beställarreferensen, sparas som vanligt. Vi skickar inga mejl eller SMS till deltagaren och använder ingen artificiell intelligens i ärendet.
          </Notice>
        )}
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
        {f.protectedIdentity === false && (
          <Stack>
            <FormGrid>
              <Field
                id="kom-o-dphone"
                label="Deltagarens telefonnummer"
                required={f.preferredContact === "sms" || f.preferredContact === "phone"}
                error={E("phone")}
                help="För kallelse och påminnelser. SMS:en innehåller aldrig personuppgifter."
              >
                <Input type="tel" value={f.phone} onValueChange={set("phone")} />
              </Field>
              <Field id="kom-o-demail" label="Deltagarens e-postadress" required={f.preferredContact === "email"} error={E("email")} help="Fyll bara i om deltagaren vill ha kallelsen med e-post.">
                <Input type="email" value={f.email} onValueChange={set("email")} />
              </Field>
            </FormGrid>
            <Field id="kom-o-city" label="Bostadsort" required error={E("city")} help="Bara orten, till exempel Alby, Tumba eller Fittja. Vi behöver den för att planera plats och resor.">
              <Input value={f.city} onValueChange={set("city")} />
            </Field>
            <Field id="kom-o-contact" label="Hur vill deltagaren bli kontaktad?" required help="Vi kallar till första mötet på det sätt du väljer här.">
              <Seg id="kom-o-contact" ariaLabel="Föredragen kontaktväg" value={f.preferredContact} onValueChange={set("preferredContact")} options={CONTACTS} />
            </Field>
            {f.preferredContact === "letter" && (
              <Field id="kom-o-addr" label="Fullständig adress" required error={E("address")} help="Behövs bara när kallelsen skickas med brev. Annars sparar vi ingen adress.">
                <TextArea rows={2} value={f.address} onValueChange={set("address")} />
              </Field>
            )}
            <Field
              id="kom-o-needs"
              label="Behov av anpassning"
              help="Beskriv vad som behövs, inte varför. Till exempel: tolk på somaliska, skriftliga instruktioner eller lokal utan trappor. Skriv inga diagnoser."
            >
              <TextArea rows={3} maxLength={500} value={f.accessibilityNeeds} onValueChange={set("accessibilityNeeds")} />
            </Field>
          </Stack>
        )}
      </Stack>
    );
  }
  if (step === 2) {
    const tracks = m.tracks[f.primaryArea] ?? [];
    body = (
      <Stack>
        <Field id="kom-o-area" label="Avtalsområde" required error={E("primaryArea")} help="Välj det område som passar deltagarens mål bäst. Området styr innehållet i insatsen och veckopriset.">
          <Select value={f.primaryArea} onValueChange={set("primaryArea")} placeholder="Välj avtalsområde" options={m.areas.map((a) => ({ value: a.code, label: `${a.code} – ${a.name}` }))} />
        </Field>
        <Field id="kom-o-area2" label="Alternativt avtalsområde" error={E("secondaryArea")} help="Om det första området inte passar efter kartläggningen. Du kan lämna det tomt.">
          <Select
            value={f.secondaryArea}
            onValueChange={set("secondaryArea")}
            placeholder="Inget alternativt område"
            options={m.areas.filter((a) => a.code !== f.primaryArea).map((a) => ({ value: a.code, label: `${a.code} – ${a.name}` }))}
          />
        </Field>
        <Field
          id="kom-o-track"
          label="Önskat yrkesspår"
          help={
            tracks.length
              ? "Välj ett förslag eller skriv ett eget. Coachen stämmer av yrkesspåret under kartläggningen."
              : "Skriv det yrke deltagaren siktar mot, om du vet. Coachen stämmer av yrkesspåret under kartläggningen."
          }
        >
          <Stack gap="sm">
            {tracks.length > 0 && <Seg ariaLabel="Förslag på yrkesspår" value={f.vocationalTrack} onValueChange={set("vocationalTrack")} options={tracks} />}
            <Input id="kom-o-track" value={f.vocationalTrack} onValueChange={set("vocationalTrack")} placeholder="Eget yrkesspår" />
          </Stack>
        </Field>
        <Field id="kom-o-bg" label="Bakgrund" help="Några meningar om erfarenhet, utbildning och mål. Skriv inga diagnoser eller andra känsliga uppgifter.">
          <TextArea rows={4} maxLength={1000} value={f.background} onValueChange={set("background")} />
        </Field>
        <TalaIn fieldId="kom-o-bg" protectedOrder={f.protectedIdentity === true} onText={(t) => setF((x) => ({ ...x, background: joinText(x.background, t, 1000) }))} />
      </Stack>
    );
  }
  if (step === 3) {
    const orderItems: [string, string][] = [
      ["Beställare", `${f.contactName}, ${f.unit}`],
      ["Telefon", f.contactPhone],
      ["E-post", f.contactEmail],
      ["Beställarreferens", f.buyerReference],
      ["Önskat startdatum", fD(f.desiredStart)],
      ["Planerat slutdatum", f.plannedEnd ? fD(f.plannedEnd) : "Inte angivet"],
      ["Omfattning", `${f.plannedWeeks} veckor`],
    ];
    const edit = (to: number) => {
      setErrStep(null);
      goStep(to, { fromReview: true });
    };
    body = f.protectedIdentity ? (
      <Stack>
        <Notice tone="critical" title={`Ring oss på ${SAFE_PHONE} så tar vi resten enligt den säkra rutinen.`}>
          Om deltagaren sparar vi bara namn och personnummer. Avtalsområde och övriga uppgifter tar vi i telefon. Mejlet du får är en kort bekräftelse på att vi har tagit emot
          beställningen – utan ärendenummer och utan personuppgifter.
        </Notice>
        <Card>
          <Stack>
            <ReviewSection title="Beställning och kontakt" onEdit={() => edit(0)} items={orderItems} />
            <ReviewSection title="Deltagare" onEdit={() => edit(1)} items={[["Namn", `${f.firstName} ${f.lastName}`], ["Personnummer", maskPnr(f.pnr)], ["Skyddade personuppgifter", "Ja"]]} />
          </Stack>
        </Card>
      </Stack>
    ) : (
      <Stack>
        <Card>
          <Stack>
            <ReviewSection title="Beställning och kontakt" onEdit={() => edit(0)} items={orderItems} />
            <ReviewSection
              title="Deltagare"
              onEdit={() => edit(1)}
              items={[
                ["Namn", `${f.firstName} ${f.lastName}`],
                ["Personnummer", maskPnr(f.pnr)],
                ["Telefon", f.phone || "Inte angivet"],
                ["E-post", f.email || "Inte angivet"],
                ["Bostadsort", f.city],
                ["Kontaktväg", CONTACT_LABEL[f.preferredContact]],
                f.preferredContact === "letter" && ["Adress", f.address],
                ["Anpassning", f.accessibilityNeeds || "Inget angivet"],
                ["Skyddade personuppgifter", "Nej"],
              ]}
            />
            <ReviewSection
              title="Avtalsområde"
              onEdit={() => edit(2)}
              items={[
                ["Avtalsområde", areaLabel(f.primaryArea)],
                ["Alternativt område", f.secondaryArea ? areaLabel(f.secondaryArea) : "Inget"],
                ["Yrkesspår", f.vocationalTrack || "Inte angivet"],
                ["Bakgrund", f.background || "Inte angivet"],
              ]}
            />
          </Stack>
        </Card>
        <Card title="Beställningens värde" icon="card">
          <Stack gap="sm">
            {m.prices ? (
              <>
                <div className="text-[2rem] leading-[1.1] font-extrabold tabular-nums">{kr(price * (f.plannedWeeks || 0))}</div>
                <div className="text-text-muted">
                  {f.plannedWeeks} veckor × {kr(price)} per vecka, exklusive moms. Fakturan räknas per vecka som deltagaren är inskriven. Pausade veckor faktureras inte.
                </div>
              </>
            ) : (
              <>
                <div className="font-bold">{TESTER_HIDDEN_TEXT}</div>
                <div className="text-text-muted">{f.plannedWeeks} veckor. Fakturan räknas per vecka som deltagaren är inskriven. Pausade veckor faktureras inte.</div>
              </>
            )}
          </Stack>
        </Card>
        <Notice tone="info" title="Det här händer när du skickar">
          Beställningen får ett ärendenummer direkt. Du ser ordererkännandet här på skärmen och får det i ett mejl. Mejlet innehåller bara ärendenumret – inga
          personuppgifter. Ärendenumret är beställningens nummer. Senast {fDTL(m.answerDue)} får du besked om startdatum och coach.
        </Notice>
      </Stack>
    );
  }

  return (
    <KomPage>
      <KomHead
        eyebrow={`${m.customerName} · beställning`}
        title="Beställ ny insats"
        lead={step === 0 ? "Samma uppgifter som i beställningsmallen, i tre korta steg och en granskning. Du kan gå tillbaka och ändra innan du skickar." : undefined}
      />
      <KomStepper current={step} skipped={f.protectedIdentity && step === 3 ? 2 : null} />
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
            {step === 1 && f.protectedIdentity ? "Nästa: granska" : `Nästa: ${STEPS[step + 1].toLowerCase()}`}
          </Button>
        ) : (
          <Button kind="primary" size="lg" icon="send" pending={create.pending} onClick={() => void submit()}>
            Skicka beställningen
          </Button>
        )}
      </div>
      <DemoNote>Beställningen sparas bara i den här webbläsaren. Mejlet skickas inte på riktigt – utskicket syns i utskicksloggen hos Miljonbemanning. Priserna är exempel.</DemoNote>
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
            <span key={`annan-${i}`}>Insatsen är beställd av en annan handläggare. Ring oss på {SAFE_PHONE} så hjälper vi dig.</span>
          ),
        )}
      </Stack>
    </Notice>
  );
}

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
  const prot = c.protectedIdentity;
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
          {prot ? (
            <Notice tone="critical" title={`Ring oss på ${SAFE_PHONE} så tar vi resten enligt den säkra rutinen.`}>
              Deltagaren har skyddade personuppgifter. Om deltagaren har vi bara sparat namn och personnummer. Beställarreferensen, startdatumet och omfattningen från steg 1 är
              sparade. Avtalsansvarig på Miljonbemanning har fått en uppgift att ringa dig.
            </Notice>
          ) : (
            <Stack gap="sm">
              <div className="text-body font-extrabold tracking-[0.09em] text-text-muted uppercase">Ordererkännande</div>
              <p>{fullText(c.ackText)}</p>
            </Stack>
          )}
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
            <OkLine>{prot ? "Mejlet är en kort bekräftelse utan ärendenummer och utan personuppgifter." : "Mejlet innehåller bara ärendenumret – inga personuppgifter."}</OkLine>
          </Stack>
        </Card>
      )}
      <Card title="Så här går det vidare" icon="list">
        <Timeline
          items={
            prot
              ? [
                  { icon: "check", filled: true, title: "Beställningen är mottagen", sub: fDTL(c.referredAt), body: <span>Den har fått ärendenummer {c.caseNumber}. Ingen automatisk behandling görs.</span> },
                  { icon: "phone", title: "Samtal med Miljonbemanning", sub: `Ring ${SAFE_PHONE}`, body: <span>Vi går igenom avtalsområde, kontaktväg och övriga uppgifter med dig enligt den säkra rutinen.</span> },
                  { icon: "calendar", title: "Orderbekräftelse", sub: "Efter telefonsamtalet", body: <span>Du får startdatum och ansvarig coach i portalen.</span> },
                  {
                    icon: "users",
                    title: "Första mötet med deltagaren",
                    sub: "Bokas efter telefonsamtalet",
                    body: <span>Miljonbemanning kallar deltagaren på det sätt ni kommer överens om i samtalet. Inga mejl eller SMS går till deltagaren.</span>,
                  },
                ]
              : [
                  { icon: "check", filled: true, title: "Beställningen är mottagen", sub: fDTL(c.referredAt), body: <span>Den har fått ärendenummer {c.caseNumber}.</span> },
                  { icon: "calendar", title: "Orderbekräftelse", sub: `Senast ${fDTL(c.avropDue)}`, body: <span>Du får startdatum, ansvarig coach och tid för första mötet i portalen.</span> },
                  {
                    icon: "users",
                    title: "Första mötet med deltagaren",
                    sub: `Senast ${fD(c.firstMeetingDue)}`,
                    body: <span>Deltagaren får en kallelse på det sätt du valde ({(c.contactLabel ?? "").toLowerCase()}).</span>,
                  },
                ]
          }
        />
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button kind="primary" size="lg" icon="plus" onClick={onAgain}>
          Beställ en till
        </Button>
        <Button size="lg" iconRight="arrow-right" to={`/portal/deltagare/${encodeURIComponent(c.caseId)}`}>
          Se beställningen
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <PerspectiveLink role={prot ? "avtalsansvarig" : "samordnare"} to={`/inkorg?arende=${encodeURIComponent(c.caseId)}`} label="Se hur beställningen landar hos Miljonbemanning" />
      </div>
    </KomPage>
  );
}
