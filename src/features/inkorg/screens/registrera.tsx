"use client";
// Registrera beställning (/inkorg/registrera, beslut 4a 2026-10-08): samordnaren eller avtalsansvarig registrerar ett avrop som
// kom med mejl, telefon eller på annat sätt – samma fält som kommunens formulär (portal/bestall.tsx) plus hur och när det kom
// och kommunens handläggare. ?mejl=<id> förifyller formuläret ur ett inläst mejl som inte kunde bli ett ärende automatiskt.
// Personnumret ur mejlet lämnas aldrig ut till skärmen: lämnas fältet tomt använder servern numret i mejlet.
import { useMemo, useState, type ReactNode } from "react";
import { fmtDateTimeLong, orderPeriodEnd } from "@/core/time";
import { emailValid, pnrFormatValid } from "@/core/validation";
import type { PreferredContact, PriorAssessment } from "@/data/schema";
import { ORDER_REASON_MAX, ORDER_REASON_MIN, type AttachmentRow } from "@/features/arenden/api";
import { AttachmentPicker } from "@/features/arenden/screens/attachments";
import { useCommand, useQuery } from "@/shell/backend";
import { leaveWithoutAsking, useDraft, useUnsavedGuard } from "@/shell/guard";
import { useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import {
  Button, Card, DateInput, ErrorNotice, ErrorSummary, Field, focusFirstError, FormGrid, Icon, Input, Loading, Notice, Page, Seg, Select, Stack, TextArea, TimeInput,
  useConfirm, useToast, type IconName,
} from "@/ui";
import { inboxDuplicateCheck, inboxRegister, inboxRegisterForm, type RegisterChannel, type RegisterForm } from "../api";
import { refErrorMB } from "../texts";

const CHANNELS: { value: RegisterChannel; label: string; icon: IconName }[] = [
  { value: "email", label: "Mejl", icon: "mail" },
  { value: "phone", label: "Telefon", icon: "phone" },
  { value: "other", label: "Annat sätt", icon: "message" },
];
const CONTACTS: { value: PreferredContact; label: string; icon: IconName }[] = [
  { value: "sms", label: "SMS", icon: "message" },
  { value: "phone", label: "Telefon", icon: "phone" },
  { value: "email", label: "E-post", icon: "mail" },
  { value: "letter", label: "Brev", icon: "file" },
];
const PRIOR: { value: PriorAssessment; label: string }[] = [
  { value: "yes", label: "Ja" },
  { value: "no", label: "Nej" },
  { value: "unknown", label: "Vet inte" },
];
const OTHER = "annan";
const NEW_HANDLER = "";
const BACKGROUND_MAX = 4000;

type Reg = {
  channel: RegisterChannel;
  receivedDate: string;
  receivedTime: string;
  /** Handläggare med konto (profilens id) eller "" = uppgifterna skrivs in. */
  handlerId: string;
  referrerName: string;
  referrerEmail: string;
  referrerUnit: string;
  referrerPhone: string;
  desiredStart: string;
  period: string | null;
  otherEnd: string;
  periodReason: string;
  buyerReference: string;
  firstName: string;
  lastName: string;
  pnr: string;
  phone: string;
  email: string;
  city: string;
  preferredContact: PreferredContact;
  address: string;
  priorAssessment: PriorAssessment | null;
  background: string;
  attachments: AttachmentRow[];
};

function initialReg(m: RegisterForm): Reg {
  const e = m.email;
  const p = e?.prefill;
  const received = e?.receivedAt ?? m.now;
  const known = p ? m.handlers.find((h) => h.email.toLowerCase() === p.referrerEmail.toLowerCase()) : null;
  const period = p?.orderPeriod && (p.orderPeriod === OTHER ? m.periods.allowOther : m.periods.months.includes(Number(p.orderPeriod))) ? p.orderPeriod : null;
  const contact = (CONTACTS.find((c) => c.value === p?.preferredContact)?.value ?? "sms") as PreferredContact;
  const prior = (PRIOR.find((x) => x.value === p?.priorAssessment)?.value ?? null) as PriorAssessment | null;
  return {
    channel: e ? "email" : "phone", receivedDate: received.slice(0, 10), receivedTime: received.slice(11, 16),
    handlerId: known?.id ?? NEW_HANDLER, referrerName: p?.referrerName ?? "", referrerEmail: p?.referrerEmail ?? "", referrerUnit: p?.referrerUnit ?? "", referrerPhone: p?.referrerPhone ?? "",
    desiredStart: p?.desiredStart ?? "", period, otherEnd: period === OTHER ? p?.plannedEnd ?? "" : "", periodReason: period === OTHER ? p?.orderPeriodReason ?? "" : "",
    buyerReference: p?.buyerReference ?? "",
    firstName: p?.firstName ?? "", lastName: p?.lastName ?? "", pnr: "", phone: p?.phone ?? "", email: p?.email ?? "", city: p?.city ?? "", preferredContact: contact, address: "",
    priorAssessment: prior, background: p?.background ?? "", attachments: [],
  };
}

const ERROR_FIELD: Record<string, string> = {
  channel: "reg-channel", receivedDate: "reg-received-date", receivedTime: "reg-received-time", handlerId: "reg-handler", referrerName: "reg-ref-name", referrerEmail: "reg-ref-email",
  referrerUnit: "reg-ref-unit", desiredStart: "reg-start", period: "reg-period", otherEnd: "reg-end", periodReason: "reg-reason", buyerReference: "reg-ref",
  firstName: "reg-fn", lastName: "reg-ln", pnr: "reg-pnr", phone: "reg-phone", email: "reg-email", city: "reg-city", address: "reg-addr", priorAssessment: "reg-prior", attachments: "reg-files",
};

function validate(f: Reg, m: RegisterForm, dup: boolean, uploading: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  const receivedAt = `${f.receivedDate}T${f.receivedTime}`;
  if (!f.receivedDate) e.receivedDate = "Ange vilken dag beställningen kom.";
  if (!f.receivedTime) e.receivedTime = "Ange klockslaget.";
  if (f.receivedDate && f.receivedTime && receivedAt > m.now) e.receivedTime = "Mottagen tid kan inte vara i framtiden.";
  if (!f.handlerId) {
    if (!f.referrerName.trim()) e.referrerName = "Skriv handläggarens namn.";
    const email = f.referrerEmail.trim().toLowerCase();
    if (!emailValid(email)) e.referrerEmail = "Skriv handläggarens hela e-postadress.";
    else if (m.customerDomains.length && !m.customerDomains.includes(email.split("@")[1] ?? "")) e.referrerEmail = `Adressen ska ha kommunens domän (${m.customerDomains.map((d) => `@${d}`).join(", ")}).`;
    if (!f.referrerUnit.trim()) e.referrerUnit = "Skriv vilken enhet handläggaren arbetar på.";
  }
  if (!f.desiredStart) e.desiredStart = "Välj ett önskat startdatum.";
  if (!f.period) e.period = "Välj hur länge insatsen ska pågå.";
  if (f.period === OTHER) {
    if (!f.otherEnd) e.otherEnd = "Välj ett slutdatum.";
    else if (f.desiredStart && f.otherEnd <= f.desiredStart) e.otherEnd = "Slutdatumet måste komma efter startdatumet.";
    if (f.periodReason.trim().length < ORDER_REASON_MIN) e.periodReason = "Skriv varför insatsen behöver en annan längd.";
  }
  const refErr = f.buyerReference.trim() ? refErrorMB(f.buyerReference, m.refPattern, m.refLen) : null;
  if (refErr) e.buyerReference = refErr;
  if (!f.firstName.trim()) e.firstName = "Skriv deltagarens förnamn.";
  if (!f.lastName.trim()) e.lastName = "Skriv deltagarens efternamn.";
  const pnrInMail = !!m.email?.prefill.pnrMasked;
  if (!f.pnr.trim()) {
    if (!pnrInMail) e.pnr = "Skriv personnumret så här: ÅÅÅÅMMDD-NNNN.";
  } else if (!pnrFormatValid(f.pnr.trim())) e.pnr = "Skriv tolv siffror så här: ÅÅÅÅMMDD-NNNN.";
  else if (dup) e.pnr = "Personen har redan en pågående insats. En person kan inte ha två pågående insatser samtidigt.";
  if ((f.preferredContact === "sms" || f.preferredContact === "phone") && f.phone.replace(/\D/g, "").length < 8) e.phone = "Skriv deltagarens telefonnummer – det behövs för kallelsen.";
  if (f.email.trim() && !emailValid(f.email)) e.email = "Skriv en hel e-postadress, eller lämna fältet tomt.";
  if (f.preferredContact === "email" && !f.email.trim()) e.email = "Skriv deltagarens e-postadress – e-post är vald som kontaktväg.";
  // Bostadsorten är valfri (beslut 2026-10-09: "Vi behöver inte veta var de bor").
  if (f.preferredContact === "letter" && f.address.trim().length < 6) e.address = "Skriv hela adressen – kallelsen ska skickas med brev.";
  if (!f.priorAssessment) e.priorAssessment = "Svara om en kartläggning har genomförts (vet inte går bra).";
  if (uploading) e.attachments = "Vänta tills filerna är uppladdade.";
  return e;
}

export function RegistreraScreen({ query }: ScreenProps) {
  const emailId = query.get("mejl") ?? undefined;
  const q = useQuery(inboxRegisterForm, { emailId });
  return (
    <Page
      title="Registrera beställning"
      eyebrow="Avropsinkorg"
      crumbs={[{ label: "Avropsinkorg", to: "/inkorg" }, { label: "Registrera beställning" }]}
      lead="En beställning som kom med mejl, telefon eller på annat sätt."
    >
      {q.error ? <ErrorNotice error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Loading /> : <RegisterForm key={q.data.email?.id ?? "ny"} m={q.data} />}
    </Page>
  );
}

function RegisterForm({ m }: { m: RegisterForm }) {
  const nav = useNav();
  const toast = useToast();
  const confirm = useConfirm();
  const register = useCommand(inboxRegister);
  // Utkastminne per mejl (bara i minnet – personnumret sparas aldrig i webblagring).
  const draft = useDraft<Reg>(`inkorg-registrera|${m.email?.id ?? "ny"}`, () => initialReg(m));
  const f = draft.value;
  const setF = draft.set;
  const baseline = useMemo(() => JSON.stringify(initialReg(m)), [m]);
  const [showErr, setShowErr] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const set = <K extends keyof Reg>(k: K) => (v: Reg[K]) => setF((x) => ({ ...x, [k]: v }));

  const pnrOk = pnrFormatValid(f.pnr.trim());
  const dupQ = useQuery(inboxDuplicateCheck, pnrOk ? { pnr: f.pnr.trim() } : null);
  const dup = pnrOk && !!dupQ.data?.duplicate;
  const errs = validate(f, m, dup, uploading);
  const E = (k: string) => (showErr ? errs[k] : undefined);
  const dirty = !done && JSON.stringify(f) !== baseline;
  useUnsavedGuard(dirty, "Beställningen är inte registrerad. Det du har fyllt i finns kvar om du kommer tillbaka, men försvinner om du laddar om sidan.");

  const handler = m.handlers.find((h) => h.id === f.handlerId) ?? null;
  const end = f.period === OTHER ? f.otherEnd : f.period && f.desiredStart ? orderPeriodEnd(f.desiredStart, Number(f.period)) : "";
  const periodOptions = [...m.periods.months.map((n) => ({ value: String(n), label: `${n} månader` })), ...(m.periods.allowOther ? [{ value: OTHER, label: "Annan tidsperiod" }] : [])];

  const cancel = async () => {
    if (dirty) {
      const ok = await confirm({ title: "Avbryta registreringen?", body: "Beställningen registreras inte och det du har fyllt i försvinner.", confirmLabel: "Avbryt registreringen", cancelLabel: "Fortsätt fylla i", tone: "danger" });
      if (!ok) return;
    }
    draft.clear();
    leaveWithoutAsking(() => nav.push(m.email ? `/inkorg/${encodeURIComponent(m.email.id)}` : "/inkorg"));
  };

  const submit = async () => {
    if (Object.keys(errs).length) {
      setShowErr(true);
      focusFirstError(document.getElementById("main"));
      return;
    }
    const period = f.period === OTHER
      ? { orderPeriodMonths: null, plannedEnd: f.otherEnd, orderPeriodReason: f.periodReason.trim() }
      : { orderPeriodMonths: Number(f.period), plannedEnd: null, orderPeriodReason: null };
    const res = await register
      .run({
        channel: f.channel, receivedAt: `${f.receivedDate}T${f.receivedTime}`, emailId: m.email?.id, referrerId: f.handlerId || null,
        referrerName: handler?.name ?? f.referrerName.trim(), referrerEmail: handler?.email ?? f.referrerEmail.trim(), referrerUnit: f.referrerUnit.trim() || handler?.unit || "",
        referrerPhone: f.referrerPhone.trim() || handler?.phone || "",
        firstName: f.firstName.trim(), lastName: f.lastName.trim(), pnr: f.pnr.trim(), phone: f.phone.trim(), email: f.email.trim(), city: f.city.trim(),
        address: f.preferredContact === "letter" ? f.address.trim() : null, preferredContact: f.preferredContact, desiredStart: f.desiredStart || null, ...period,
        priorAssessment: f.priorAssessment, background: f.background.trim(), buyerReference: f.buyerReference.trim(), attachmentIds: f.attachments.map((a) => a.id),
      })
      .catch(() => null);
    if (!res) {
      toast("Beställningen kunde inte registreras. Försök igen.", "error");
      return;
    }
    if (!res.ok) {
      setShowErr(true);
      toast(res.message ?? "Beställningen kunde inte registreras.", "error");
      return;
    }
    setDone(true);
    draft.clear();
    toast(`Beställningen är registrerad. Ärendenummer ${res.caseNumber}.`);
    leaveWithoutAsking(() => nav.push(`/inkorg/${encodeURIComponent(res.emailId)}`));
  };

  const section = (title: string, icon: IconName, children: ReactNode) => (
    <Card title={title} icon={icon}>
      <Stack>{children}</Stack>
    </Card>
  );

  return (
    <Stack>
      {m.email && (
        <Notice tone="info" icon="mail" title={`Från mejlet ”${m.email.subject}”`}>
          Från {m.email.from} ({m.email.fromAddress}), mottaget {m.email.receivedLong}. Fälten nedan är förifyllda med det som gick att läsa ut – kontrollera mot originalet.
          {m.email.attachments > 0 && ` ${m.email.attachments === 1 ? "Mejlets bilaga kopplas" : `Mejlets ${m.email.attachments} bilagor kopplas`} till ärendet.`}
        </Notice>
      )}
      {showErr && Object.keys(errs).length > 0 && (
        <ErrorSummary title="Rätta det här innan du registrerar" items={Object.entries(errs).map(([k, text]) => ({ id: ERROR_FIELD[k] ?? "reg-channel", text }))} />
      )}

      {section("Hur beställningen kom", "inbox", (
        <>
          {m.email ? (
            <p className="flex items-start gap-2">
              <Icon name="mail" className="mt-1 flex-none" />
              <span>Beställningen kom med <b>mejl</b> till avrop@ – mejlet kopplas till ärendet.</span>
            </p>
          ) : (
            <Field id="reg-channel" label="Beställningen kom med" required>
              <Seg id="reg-channel" ariaLabel="Beställningen kom med" value={f.channel} onValueChange={set("channel")} options={CHANNELS} />
            </Field>
          )}
          <FormGrid>
            <Field id="reg-received-date" label="Mottagen dag" required error={E("receivedDate")} help="Svarstiden räknas från när beställningen kom – inte från när den registreras.">
              <DateInput value={f.receivedDate} onValueChange={set("receivedDate")} />
            </Field>
            <Field id="reg-received-time" label="Klockslag" required error={E("receivedTime")} help="Ungefär går bra.">
              <TimeInput value={f.receivedTime} onValueChange={set("receivedTime")} />
            </Field>
          </FormGrid>
          <p className="flex items-start gap-2 text-text-muted">
            <Icon name="clock" className="mt-1 flex-none" />
            <span>Svar till kommunen senast {m.answerText} efter mottagandet{f.receivedDate && f.receivedTime ? ` (mottaget ${fmtDateTimeLong(`${f.receivedDate}T${f.receivedTime}`)})` : ""}.</span>
          </p>
        </>
      ))}

      {section("Kommunens handläggare", "users", (
        <>
          <Field id="reg-handler" label="Handläggare" required help={m.handlers.length ? "Välj handläggaren om hen har konto, annars skriv uppgifterna." : "Skriv handläggarens uppgifter."}>
            <Select
              id="reg-handler"
              value={f.handlerId}
              onValueChange={(v) => {
                const h = m.handlers.find((x) => x.id === v);
                setF((x) => ({ ...x, handlerId: v, referrerName: h ? h.name : x.referrerName, referrerEmail: h ? h.email : x.referrerEmail, referrerUnit: h ? h.unit : x.referrerUnit, referrerPhone: h ? h.phone : x.referrerPhone }));
              }}
              options={[{ value: NEW_HANDLER, label: "Skriv uppgifterna (har inget konto, eller okänd)" }, ...m.handlers.map((h) => ({ value: h.id, label: `${h.name}${h.unit ? ` – ${h.unit}` : ""}` }))]}
            />
          </Field>
          <FormGrid>
            <Field id="reg-ref-name" label="Namn" required={!handler} error={E("referrerName")}>
              <Input value={f.referrerName} onValueChange={set("referrerName")} readOnly={!!handler} />
            </Field>
            <Field id="reg-ref-email" label="E-postadress" required={!handler} error={E("referrerEmail")} help="Hit går ordererkännandet och orderbekräftelsen. Mejlen innehåller bara ärendenumret.">
              <Input type="email" value={f.referrerEmail} onValueChange={set("referrerEmail")} readOnly={!!handler} />
            </Field>
            <Field id="reg-ref-unit" label="Enhet" required={!handler} error={E("referrerUnit")} help="Till exempel Arbetsmarknadsenheten Alby.">
              <Input value={f.referrerUnit} onValueChange={set("referrerUnit")} maxLength={120} />
            </Field>
            <Field id="reg-ref-phone" label="Telefon">
              <Input type="tel" value={f.referrerPhone} onValueChange={set("referrerPhone")} />
            </Field>
          </FormGrid>
        </>
      ))}

      {section("Beställningen", "clipboard", (
        <>
          <FormGrid>
            <Field id="reg-start" label="Önskat startdatum" required error={E("desiredStart")} help="Startdatumet bekräftas i orderbekräftelsen.">
              <DateInput value={f.desiredStart} onValueChange={set("desiredStart")} />
            </Field>
            <Field id="reg-ref" label="Beställarreferens" error={E("buyerReference")} help={`Kommunens referens, ${m.refLen} siffror. Valfri nu – krävs innan fakturan skapas.`}>
              <Input value={f.buyerReference} onValueChange={set("buyerReference")} inputMode="numeric" maxLength={20} />
            </Field>
          </FormGrid>
          <Field id="reg-period" label="Omfattning" required error={E("period")} help="Hur länge insatsen ska pågå. Annan tidsperiod bara om insatsen behöver en annan längd.">
            <Seg id="reg-period" ariaLabel="Omfattning" value={f.period} onValueChange={(v) => set("period")(v)} options={periodOptions} />
          </Field>
          {f.period && f.period !== OTHER && end && (
            <p className="flex items-start gap-2">
              <Icon name="calendar" className="mt-1 flex-none" />
              <span>Planerat slut: <b>{end}</b> (räknas om från första mötet när avropet accepteras).</span>
            </p>
          )}
          {f.period === OTHER && (
            <FormGrid>
              <Field id="reg-end" label="Slutdatum" required error={E("otherEnd")}>
                <DateInput value={f.otherEnd} onValueChange={set("otherEnd")} />
              </Field>
              <Field id="reg-reason" label="Motivering" required error={E("periodReason")} help={`Varför insatsen behöver en annan längd. Inga diagnoser. Högst ${ORDER_REASON_MAX} tecken.`} full>
                <TextArea rows={3} maxLength={ORDER_REASON_MAX} value={f.periodReason} onValueChange={set("periodReason")} />
              </Field>
            </FormGrid>
          )}
        </>
      ))}

      {section("Deltagare", "user", (
        <>
          <FormGrid>
            <Field id="reg-fn" label="Förnamn" required error={E("firstName")}>
              <Input value={f.firstName} onValueChange={set("firstName")} />
            </Field>
            <Field id="reg-ln" label="Efternamn" required error={E("lastName")}>
              <Input value={f.lastName} onValueChange={set("lastName")} />
            </Field>
          </FormGrid>
          <Field
            id="reg-pnr"
            label="Personnummer eller samordningsnummer"
            required={!m.email?.prefill.pnrMasked}
            error={E("pnr") ?? (dup ? "Personen har redan en pågående insats." : undefined)}
            help={m.email?.prefill.pnrMasked ? `Mejlet har ett personnummer (${m.email.prefill.pnrMasked}). Lämna fältet tomt för att använda det.` : "Tolv siffror: ÅÅÅÅMMDD-NNNN."}
          >
            <Input value={f.pnr} inputMode="numeric" maxLength={15} onValueChange={set("pnr")} />
          </Field>
          <FormGrid>
            <Field id="reg-phone" label="Deltagarens telefonnummer" required={f.preferredContact === "sms" || f.preferredContact === "phone"} error={E("phone")} help="För kallelse och påminnelser. SMS:en innehåller aldrig personuppgifter.">
              <Input type="tel" value={f.phone} onValueChange={set("phone")} />
            </Field>
            <Field id="reg-email" label="Deltagarens e-postadress" required={f.preferredContact === "email"} error={E("email")}>
              <Input type="email" value={f.email} onValueChange={set("email")} />
            </Field>
            <Field id="reg-city" label="Bostadsort (valfritt)" error={E("city")} help="Bara om beställningen har den. Vi behöver inte veta var deltagaren bor.">
              <Input value={f.city} onValueChange={set("city")} />
            </Field>
          </FormGrid>
          <Field id="reg-contact" label="Hur vill deltagaren bli kontaktad?" required help="Kallelsen till första mötet går den vägen.">
            <Seg id="reg-contact" ariaLabel="Föredragen kontaktväg" value={f.preferredContact} onValueChange={set("preferredContact")} options={CONTACTS} />
          </Field>
          {f.preferredContact === "letter" && (
            <Field id="reg-addr" label="Fullständig adress" required error={E("address")} help="Behövs bara när kallelsen skickas med brev. Annars sparas ingen adress.">
              <TextArea rows={2} value={f.address} onValueChange={set("address")} />
            </Field>
          )}
        </>
      ))}

      {section("Bakgrundsinformation om deltagaren", "file", (
        <>
          <Field id="reg-prior" label="Har en kartläggning genomförts?" required error={E("priorAssessment")} help="Till exempel hos kommunen eller Arbetsförmedlingen.">
            <Seg id="reg-prior" ariaLabel="Har en kartläggning genomförts?" value={f.priorAssessment} onValueChange={(v) => set("priorAssessment")(v)} options={PRIOR} />
          </Field>
          <Field id="reg-files" label="Bilagor" error={E("attachments")} help="Till exempel kartläggningen. Filerna syns bara för dem som arbetar med deltagaren.">
            <AttachmentPicker id="reg-files" caseId={null} rows={f.attachments} onRows={(rows) => setF((x) => ({ ...x, attachments: rows }))} maxFiles={m.attachments.maxFiles} accept={m.attachments.accept} typesText={m.attachments.typesText} onBusy={setUploading} />
          </Field>
          <Field id="reg-bg" label="Bakgrundsinformation" help="Det handläggaren berättade om erfarenhet, utbildning, mål och behov. Inga diagnoser eller uppgifter om hälsa.">
            <TextArea rows={6} maxLength={BACKGROUND_MAX} value={f.background} onValueChange={set("background")} />
          </Field>
        </>
      ))}

      <Notice tone="info" title="När du registrerar">
        Ärendet får ärendenummer och handläggaren får ordererkännandet. Beställningen hamnar i Att hantera.
      </Notice>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button kind="ghost" icon="x" onClick={() => void cancel()}>Avbryt</Button>
        <Button kind="primary" size="lg" icon="check" pending={register.pending} onClick={() => void submit()}>Registrera beställningen</Button>
      </div>
    </Stack>
  );
}
