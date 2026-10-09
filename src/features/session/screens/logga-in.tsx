"use client";
// Inloggning för Miljonbemannings personal (/logga-in, publik): e-post -> sexsiffrig kod -> inloggad (SPEC §4).
// Samma formulärstil som portalens inloggning (/portal/logga-in). Inloggningen sköts av AuthPort (useAuth):
//   riktiga appen = Supabase Auth via /api/auth/*, prototypen och utvecklingsläget = simulerad kod.
// Svaret på "skicka kod" avslöjar aldrig om adressen finns. Microsoft-inloggning (Entra) kommer senare.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ROLE_LABEL } from "@/api/roles";
import { safeReturnPath } from "@/core/return-path";
import { Link, useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { isAuthenticated, useAuth, useSession } from "@/shell/session";
import { Button, Card, DemoNote, Dot, Eyebrow, Field, IconText, Input, Notice, Stack, Stepper } from "@/ui";

/** Samma värden som i Supabase Auth (docs/DRIFT.md) och SPEC §4. */
const CODE = { digits: 6, minutes: 10, attempts: 5, idleMinutes: 60, maxHours: 12 } as const;

/** ?utloggad= sätts av src/proxy.ts (omladdning) och av App (utloggad under besöket, src/shell/app.tsx). */
export const LOGGED_OUT: Record<string, string> = {
  inaktiv: `Du har loggats ut eftersom du inte har gjort något på ${CODE.idleMinutes} minuter. Logga in igen.`,
  maxtid: `Du har loggats ut eftersom det har gått ${CODE.maxHours} timmar sedan du loggade in. Logga in igen.`,
  session: "Du har loggats ut. Logga in igen.",
  du: "Du är utloggad.",
};
/** Visas tillsammans med orsaken när ?till= finns: man kommer tillbaka till sidan man var på. */
export const BACK_AFTER_LOGIN = "Efter inloggningen kommer du tillbaka till sidan du var på.";

export function checkEmail(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (!s) return "Skriv din e-postadress.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return "Adressen är inte komplett. Den ska se ut ungefär så här: fornamn.efternamn@miljonbemanning.se.";
  return null;
}

export function checkCode(v: string): string | null {
  const s = v.replace(/\s/g, "");
  if (!s) return "Skriv koden från mejlet.";
  if (!/^\d+$/.test(s)) return "Koden består bara av siffror.";
  if (s.length !== CODE.digits) return `Koden har ${CODE.digits} siffror. Du har skrivit ${s.length}.`;
  return null;
}

export function LoggaInScreen({ query }: ScreenProps) {
  const session = useSession();
  const auth = useAuth();
  const nav = useNav();
  const [step, setStep] = useState<0 | 1>(0);
  const [email, setEmail] = useState("");
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [pending, setPending] = useState(false);
  const codeRef = useRef<HTMLDivElement>(null);
  const reasonKey = query.get("utloggad") ?? "";
  const reason = LOGGED_OUT[reasonKey];
  // Egen utloggning är ett lugnt besked; tidsgränserna en varning.
  const chose = reasonKey === "du";
  const backAfter = !!safeReturnPath(query.get("till"));

  useEffect(() => {
    if (step === 1) codeRef.current?.querySelector("input")?.focus();
    // Skrivbordet: e-postfältet har fokus direkt så att man bara kan börja skriva. Inte på mobilen – tangentbordet ska inte
    // fällas upp oombett.
    else if (window.matchMedia("(min-width: 901px)").matches) document.getElementById("login-email")?.focus();
  }, [step]);

  // Redan inloggad (riktiga appen). I prototypen och utvecklingsläget är man alltid någon testperson – där visas formuläret ändå.
  if (isAuthenticated(session) && auth?.kind !== "demo") {
    return (
      <Stack gap="lg">
        <Heading />
        <Notice tone="ok" title="Du är redan inloggad">
          Du är inloggad som {session.user.name} ({ROLE_LABEL[session.actor.role].toLowerCase()}).
        </Notice>
        <Button kind="primary" size="lg" block to="/" iconRight="arrow-right">
          Till startsidan
        </Button>
      </Stack>
    );
  }

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    setProblem(null);
    const err = checkEmail(email);
    setEmailErr(err);
    if (err || !auth) return;
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
    const err = checkCode(code);
    setCodeErr(err);
    if (err || !auth) return;
    setPending(true);
    const r = await auth.verifyCode(email.trim().toLowerCase(), code.replace(/\s/g, ""));
    setPending(false);
    if (r.ok) {
      // Riktiga appen laddar om sidan själv. Prototypen: till återhoppsadressen eller rollens startsida.
      nav.replace(safeReturnPath(query.get("till")) ?? "/");
      return;
    }
    if (r.error === "invalid_code" || r.error === "expired") setCodeErr(r.message);
    else setProblem(r.message);
  };

  const resend = async () => {
    setResent(false);
    if (await send()) setResent(true);
  };

  return (
    <Stack gap="lg">
      <Heading />
      {reason && (
        <Notice tone={chose ? "ok" : "warn"} icon={chose ? "check-circle" : "clock"}>
          {reason}
          {backAfter ? ` ${BACK_AFTER_LOGIN}` : ""}
        </Notice>
      )}
      <Stepper steps={["E-postadress", "Kod från mejlet"]} current={step} />
      <Card>
        {!auth ? (
          <Notice tone="warn">Inloggning med kod finns inte här. Välj testperson i fältet överst på sidan.</Notice>
        ) : step === 0 ? (
          <form className="flex flex-col gap-4" onSubmit={send} noValidate>
            <Field id="login-email" label="Din e-postadress" required error={emailErr ?? undefined} help="Använd din e-postadress på jobbet. Vi skickar en kod med sex siffror dit.">
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
          <form className="flex flex-col gap-4" onSubmit={login} noValidate>
            <Notice tone="info" title="Kolla din e-post" icon="mail">
              Om adressen <b className="[overflow-wrap:anywhere]">{email.trim().toLowerCase()}</b> finns hos oss har vi skickat en kod dit. Koden gäller i {CODE.minutes} minuter.
              Du har {CODE.attempts} försök.
            </Notice>
            {resent && <Notice tone="ok">Vi har skickat en ny kod. Den gamla koden gäller inte längre.</Notice>}
            <div ref={codeRef}>
              <Field
                id="login-code"
                label="Kod"
                required
                error={codeErr ?? undefined}
                help="Sex siffror. Koden står i mejlet från Miljonbemanning. Titta i skräpposten om mejlet inte har kommit."
              >
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
                  setResent(false);
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
      <Stack gap="sm" as="ul" className="m-0 list-none p-0 text-text-muted">
        <li>
          <IconText icon="key">Inloggning med ditt Microsoft-konto kommer senare. Tills vidare loggar du in med en kod som vi mejlar till dig.</IconText>
        </li>
        <li>
          <IconText icon="clock">
            Du loggas ut automatiskt efter {CODE.idleMinutes} minuter utan aktivitet, och alltid efter {CODE.maxHours} timmar.
          </IconText>
        </li>
        <li>
          <IconText icon="building">
            Arbetar du på en kommun?{" "}
            <Link to="/portal/logga-in" className="inline-flex min-h-11 items-center underline">
              Logga in i portalen för beställare
            </Link>
          </IconText>
        </li>
      </Stack>
      <DemoNote>Inget mejl skickas. Alla sex siffror fungerar som kod, och e-postadressen väljer testperson.</DemoNote>
    </Stack>
  );
}

function Heading() {
  return (
    <div className="flex flex-col gap-1.5">
      <Eyebrow>Inloggning för personal</Eyebrow>
      <h1 tabIndex={-1} data-page-title="" className="flex items-center gap-2.5 text-h1 font-extrabold tracking-[0.03em] uppercase">
        Logga in
        <Dot />
      </h1>
      <p className="text-text-muted">För dig som arbetar på Miljonbemanning. Vi mejlar en kod med sex siffror till dig.</p>
    </div>
  );
}
