"use client";
// Portalens inloggning (/portal/logga-in, publik) – prototypens kom.login: e-postadress -> kod med sex siffror -> inloggad.
//
// Inloggningen går via AuthPort (useAuth, src/shell/session.tsx):
//   riktiga appen   Supabase Auth via /api/auth/* (servern kontrollerar spärrat konto, tillåten domän och skriver revisionsloggen)
//   prototypen      simulerad: vilken sexsiffrig kod som helst godtas och inloggningen byter till testpersonen med adressen
// Själva kodkontrollen är simulerad i båda körlägena tills Supabase-inloggningen är godkänd (se DemoNote nedan).
// Svaret efter "Skicka kod" är alltid neutralt – skärmen avslöjar aldrig om en adress finns, är spärrad eller inte inbjuden.
// Självregistrering (beslut 2026-10-07, synpunkt #2): en adress på en kommundomän som har avtal med Miljonbemanning får ett
// konto vid första inloggningen och kommer till Mina uppgifter (r.created). Portalen nämner inte mejlbeställning (synpunkt #1).
// Sidan är publik och hämtar inga data: texterna gäller alla beställare, inte ett visst avtal.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ROLE_LABEL, isCustomerRole } from "@/api/roles";
import { safeReturnPath } from "@/core/return-path";
import { useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { useRuntime } from "@/shell/runtime";
import { isAuthenticated, useAuth, useSession } from "@/shell/session";
import { Button, Card, DemoNote, Field, Icon, Input, Notice, Stepper, useToast } from "@/ui";
import { BACK_AFTER_LOGIN, LOGGED_OUT } from "@/features/session/screens/logga-in";
import { kommunTestPersonas } from "../api";
import { PORTAL_FIRST_LOGIN_PATH } from "@/shell/nav-config";
import { AUTH } from "../texts";
import { KomHead, KomPage } from "./parts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Fel i e-postadressen (bara formatet – om adressen finns avgör servern utan att säga det). */
export function emailError(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (!s) return "Skriv din e-postadress.";
  if (!EMAIL_RE.test(s)) return "Adressen är inte komplett. Den ska se ut ungefär så här: fornamn.efternamn@kommun.se.";
  return null;
}
/** Fel i koden (prototypens texter). */
export function codeError(v: string): string | null {
  const s = v.replace(/\s/g, "");
  if (!/^\d+$/.test(s)) return "Koden består bara av siffror.";
  if (s.length !== AUTH.codeDigits) return `Koden har ${AUTH.codeDigits} siffror. Du har skrivit ${s.length}.`;
  return null;
}

export function PortalLoginScreen({ query }: ScreenProps) {
  const session = useSession();
  const auth = useAuth();
  const nav = useNav();
  const toast = useToast();
  const runtime = useRuntime();
  // Prototypen och utvecklingsläget: adressen för den valda testpersonen är förifylld (om det är en kommunanvändare).
  const demo = auth?.kind === "demo";
  const [email, setEmail] = useState(() => (demo && isCustomerRole(session.actor.role) ? session.user.email : ""));
  const [step, setStep] = useState<0 | 1>(0);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const codeRef = useRef<HTMLDivElement>(null);
  // Snabbval i prototypen: standardpersonerna för kommunens roller (adresserna hämtas bara i prototypen).
  const quick = runtime === "demo" ? (session.personas ?? []).filter((p) => isCustomerRole(p.role) && p.isDefaultForRole) : [];
  const quickMail = useQuery(kommunTestPersonas, quick.length && isAuthenticated(session) && session.actor.role !== "deltagare" ? { userIds: quick.map((p) => p.userId) } : null);

  useEffect(() => {
    if (step === 1) codeRef.current?.querySelector("input")?.focus();
  }, [step]);

  const heading = <KomHead eyebrow="Portal för beställare" title="Logga in" lead="För dig som beställer insatser från Miljonbemanning." />;
  // Utloggad (?utloggad= från src/proxy.ts eller från appen när sessionen gick ut under besöket): säg varför, och att man
  // kommer tillbaka till sidan man var på.
  const reason = LOGGED_OUT[query.get("utloggad") ?? ""];
  const backAfter = !!safeReturnPath(query.get("till"));

  // Redan inloggad i riktiga appen. I prototypen och utvecklingsläget är man alltid en testperson – där visas formuläret.
  if (isAuthenticated(session) && !demo) {
    return (
      <KomPage narrow>
        {heading}
        <Notice tone="ok" title="Du är redan inloggad">
          Du är inloggad som {session.user.name} ({ROLE_LABEL[session.actor.role].toLowerCase()}).
        </Notice>
        <Button kind="primary" size="lg" block to="/" iconRight="arrow-right">
          Till startsidan
        </Button>
      </KomPage>
    );
  }

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    setProblem(null);
    const err = emailError(email);
    setEmailErr(err);
    if (err || !auth) return false;
    setPending(true);
    const r = await auth.sendCode(email.trim().toLowerCase());
    setPending(false);
    if (!r.ok) {
      if (r.error === "invalid_email") setEmailErr(r.message);
      else setProblem(r.message);
      return false;
    }
    setCode("");
    setCodeErr(null);
    setStep(1);
    return true;
  };

  const login = async (e?: FormEvent) => {
    e?.preventDefault();
    setProblem(null);
    const err = codeError(code);
    setCodeErr(err);
    if (err || !auth) return;
    setPending(true);
    const r = await auth.verifyCode(email.trim().toLowerCase(), code.replace(/\s/g, ""));
    setPending(false);
    if (r.ok) {
      // Riktiga appen laddar om sidan själv. Prototypen: till återhoppsadressen eller rollens startsida ("/" leder dit) –
      // ett konto som skapades nu kommer först till Mina uppgifter.
      nav.replace(r.created ? PORTAL_FIRST_LOGIN_PATH : (safeReturnPath(query.get("till")) ?? "/"));
      toast("Du är inloggad.");
      return;
    }
    if (r.error === "invalid_code" || r.error === "expired" || r.error === "not_invited") setCodeErr(r.message);
    else setProblem(r.message);
  };

  const resend = async () => {
    if (await send()) toast("Vi har skickat en ny kod. Den gamla koden gäller inte längre.");
  };

  return (
    <KomPage narrow>
      {heading}
      {reason && (
        <Notice tone="warn" icon="clock">
          {reason}
          {backAfter ? ` ${BACK_AFTER_LOGIN}` : ""}
        </Notice>
      )}
      <Stepper steps={["E-postadress", "Kod från mejlet"]} current={step} />
      <Card>
        {!auth ? (
          <Notice tone="warn">Inloggning med kod finns inte här. Välj testperson i fältet överst på sidan.</Notice>
        ) : step === 0 ? (
          <form className="flex flex-col gap-4" onSubmit={(e) => void send(e)} noValidate>
            <Field id="kom-login-email" label="Din e-postadress" required error={emailErr ?? undefined} help="Använd din e-postadress på jobbet. Vi skickar en kod med sex siffror dit.">
              <Input
                type="email"
                value={email}
                autoComplete="email"
                inputMode="email"
                onValueChange={(v) => {
                  setEmail(v);
                  if (emailErr) setEmailErr(null);
                }}
              />
            </Field>
            <Button kind="primary" size="lg" block type="submit" iconRight="arrow-right" pending={pending}>
              Skicka kod
            </Button>
          </form>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={(e) => void login(e)} noValidate>
            <Notice tone="info" title="Kolla din e-post">
              Om adressen <b className="[overflow-wrap:anywhere]">{email.trim().toLowerCase()}</b> finns hos oss har vi skickat en kod dit. Koden gäller i {AUTH.codeMinutes} minuter. Du har{" "}
              {AUTH.maxAttempts} försök.
            </Notice>
            <div ref={codeRef}>
              <Field id="kom-login-code" label="Kod" required error={codeErr ?? undefined} help="Sex siffror. Koden står i mejlet från Miljonbemanning. Titta i skräpposten om mejlet inte har kommit.">
                <Input
                  value={code}
                  inputMode="numeric"
                  maxLength={8}
                  autoComplete="one-time-code"
                  onValueChange={(v) => {
                    setCode(v);
                    if (codeErr) setCodeErr(null);
                  }}
                />
              </Field>
            </div>
            <Button kind="primary" size="lg" block type="submit" icon="lock" pending={pending}>
              Logga in
            </Button>
            <div className="flex flex-wrap justify-between gap-3">
              <Button kind="ghost" icon="refresh" onClick={() => void resend()} disabled={pending}>
                Skicka en ny kod
              </Button>
              <Button
                kind="ghost"
                icon="arrow-left"
                onClick={() => {
                  setStep(0);
                  setCodeErr(null);
                  setProblem(null);
                }}
              >
                Byt e-postadress
              </Button>
            </div>
          </form>
        )}
        {problem && (
          <Notice tone="critical" className="mt-4">
            {problem}
          </Notice>
        )}
      </Card>
      <DemoNote>
        Inget mejl skickas. Alla sex siffror fungerar som kod, och e-postadressen väljer testperson. En ny adress som slutar på @botkyrka.se skapar ett nytt
        konto som handläggare. Själva kodkontrollen är simulerad tills inloggningen med
        Supabase är godkänd. I den riktiga tjänsten begränsas antalet försök per adress och per nätverksadress. Om e-postkod räcker för kommunens personal är en öppen
        fråga till kommunens IT-avdelning.
        {quick.length > 0 && (
          <span className="mt-2 flex flex-wrap gap-2.5">
            {quick.map((p) => (
              <Button
                key={p.userId}
                icon="user"
                onClick={() => {
                  const mail = quickMail.data?.find((x) => x.userId === p.userId)?.email;
                  if (!mail) return;
                  setEmail(mail);
                  setEmailErr(null);
                  setStep(0);
                }}
              >
                Fyll i {p.name} (handläggare)
              </Button>
            ))}
          </span>
        )}
      </DemoNote>
      <Card title="Varför en kod och inte en länk?" icon="help">
        <p>
          Kommunens e-postskydd, till exempel Microsoft Safe Links, öppnar länkar i mejl i förväg för att kontrollera dem. Då hinner en inloggningslänk användas upp
          innan du själv klickar på den. En kod fungerar alltid.
        </p>
      </Card>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        <li className="flex items-start gap-2.5">
          <Icon name="clock" className="mt-1 flex-none" />
          <span>
            Du loggas ut automatiskt efter {AUTH.idleMinutes} minuter utan aktivitet, och alltid efter {AUTH.maxHours} timmar.
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <Icon name="users" className="mt-1 flex-none" />
          <span>
            Första gången du loggar in skapas ditt konto. Det fungerar om du har en e-postadress i en kommun som har avtal med Miljonbemanning. Sedan fyller du i
            ditt namn, ditt telefonnummer och din enhet.
          </span>
        </li>
      </ul>
    </KomPage>
  );
}
