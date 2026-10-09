"use client";
// Pulsmätning (/puls/:token?, prototypens puls.svar): deltagarens mobilvy utan inloggning. Engångslänk, fem frågor,
// smileys 1–5, språkval (svenska, engelska, arabiska, somaliska) och frivillighetstext – exakt den gamla prototypens texter.
// Coachen ser aldrig enskilda svar. Länken skickas aldrig till skyddade ärenden.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCommand, useQuery } from "@/shell/backend";
import type { ScreenProps } from "@/shell/routes";
import { DemoOnly } from "@/shell/runtime";
import { Badge, Brand, Button, DemoNote, ErrorNotice, Icon, Loading, Notice, PerspectiveLink, PulsePhone, Row, Seg, Smiley, Smileys, Stack, cn, toast, type IconName } from "@/ui";
import { pulseLink, pulseSubmit, type PulseLinkView } from "../api";
import { LANG_LABEL, PT, PULSE_LANGS, tr, type PulseLang } from "../texts";

const Q4_VALUES = ["jobb", "praktik", "utbildning", "svenska", "annat"] as const;
type Q4 = (typeof Q4_VALUES)[number];
type Answers = { q1: number | null; q2: number | null; q3: number | null; q4: Q4 | null; q5: "ja" | "nej" | null };
type Preview = "live" | "used" | "expired";

const MOUTH: Record<number, string> = { 1: "M8 17 Q12 13 16 17", 2: "M8.5 16.5 Q12 14.8 15.5 16.5", 3: "M8.5 15.5 L15.5 15.5", 4: "M8.5 14.5 Q12 17 15.5 14.5", 5: "M7.5 14 Q12 19.5 16.5 14" };
/** Ansikte 1–5 (ritas här – kitets Smiley är bara knappen). */
const Face = ({ v }: { v: number }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="10" />
    <line x1="9" y1="9.5" x2="9.01" y2="9.5" />
    <line x1="15" y1="9.5" x2="15.01" y2="9.5" />
    <path d={MOUTH[v]} />
  </svg>
);

/** Behörighetsfel (403): sidan är deltagarens – en inloggad kollega som öppnar länken får klartext, inte "Din roll har inte behörighet". */
const isForbidden = (e: unknown) => e instanceof Error && (e as { code?: unknown }).code === "forbidden";

export function PulsScreen({ params }: ScreenProps) {
  const token = params.token;
  const q = useQuery(pulseLink, token ? { token } : {});
  return (
    <div className="flex w-[min(420px,100%)] flex-col gap-4">
      {q.error ? (
        isForbidden(q.error) ? (
          <Notice tone="info" title="Den här sidan är för deltagaren">
            Öppna länken i ett privat fönster eller logga ut först.
          </Notice>
        ) : (
          <ErrorNotice error={q.error} />
        )
      ) : !q.data ? (
        <Loading />
      ) : (
        <Pulse link={q.data} token={token} />
      )}
    </div>
  );
}

function Pulse({ link, token }: { link: PulseLinkView; token: string | undefined }) {
  const submitCmd = useCommand(pulseSubmit);
  const [lang, setLang] = useState<PulseLang>(link.language);
  const [step, setStep] = useState(0); // 0 = intro, 1–5 = frågor, 6 = tack
  const [ans, setAns] = useState<Answers>({ q1: null, q2: null, q3: null, q4: null, q5: null });
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview>("live");
  const t = PT[lang];
  const days = link.days;
  const state =
    link.state === "missing" ? "missing" : preview === "used" ? "used" : preview === "expired" ? "expired" : step === 6 ? "thanks" : link.state === "open" ? "open" : link.state;
  const qKey = `q${step}` as "q1" | "q2" | "q3" | "q4" | "q5";
  // Vid varje stegbyte (Börja, Nästa, Tillbaka, tack): fokus till rubriken, så att skärmläsaren läser den nya frågan.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.querySelector<HTMLElement>("[data-step-heading]")?.focus();
  }, [step, state]);
  const answered = step >= 1 && step <= 5 && ans[qKey] != null;
  const set = <K extends keyof Answers>(k: K, v: Answers[K]) => setAns((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    const r = await submitCmd.run({ ...(token ? { token } : {}), language: lang, answers: ans, text: ans.q5 === "ja" || text ? text : "" }).catch(() => null);
    if (!r || !r.ok) {
      toast(r && !r.ok && r.error === "used" ? t.used : r && !r.ok && r.error === "expired" ? t.expired : t.missing, "error");
      return;
    }
    setStep(6);
  };

  const scale = (k: "q1" | "q2" | "q3") => (
    <Stack gap="sm">
      <Smileys ariaLabel={t[k]}>
        {[1, 2, 3, 4, 5].map((v) => (
          <Smiley key={v} pressed={ans[k] === v} ariaLabel={`${v} – ${t.scale[v - 1]}`} onClick={() => set(k, v)}>
            <Face v={v} />
            <span>{v}</span>
          </Smiley>
        ))}
      </Smileys>
      <Row between className="text-body text-text-muted">
        <span>1 = {t.scale[0]}</span>
        <span>5 = {t.scale[4]}</span>
      </Row>
      <p aria-live="polite" className="min-h-[1.5em] font-bold">
        {ans[k] != null ? `${t.chose}: ${t.scale[(ans[k] as number) - 1]}` : ""}
      </p>
    </Stack>
  );
  const question = () => {
    if (step <= 3) return scale(qKey as "q1" | "q2" | "q3");
    if (step === 4) {
      return (
        <div role="group" aria-label={t.q4} className="flex flex-col gap-2">
          {Q4_VALUES.map((v) => (
            <Smiley key={v} pressed={ans.q4 === v} onClick={() => set("q4", v)} className="min-h-[52px] w-full flex-row justify-start gap-2.5 px-3.5 py-2.5 text-start text-body [&_svg]:size-[22px]">
              <Icon name={ans.q4 === v ? "check-circle" : "circle"} />
              {t.q4o[v]}
            </Smiley>
          ))}
        </div>
      );
    }
    return (
      <Stack>
        <div role="group" aria-label={t.q5} className="grid grid-cols-2 gap-4">
          {([["ja", t.yes], ["nej", t.no]] as const).map(([v, l]) => (
            <Smiley key={v} pressed={ans.q5 === v} onClick={() => set("q5", v)} className="min-h-14 text-[1.0625rem]">
              {l}
            </Smiley>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pulse-text" className="font-bold">
            {t.textLabel}
          </label>
          <div className="text-body text-text-muted" id="pulse-text-help">
            {t.textHelp}
          </div>
          <textarea id="pulse-text" rows={3} maxLength={500} value={text} aria-describedby="pulse-text-help" onChange={(e) => setText(e.target.value)} />
        </div>
      </Stack>
    );
  };
  const screen = (icon: IconName, title: string, children: ReactNode) => (
    <div className="flex flex-col items-center gap-4 py-3 text-center">
      <Icon name={icon} size="xl" />
      <h1 data-step-heading="" tabIndex={-1} className="text-[1.375rem] font-extrabold outline-none">{title}</h1>
      {children}
    </div>
  );
  const bulletIcons: IconName[] = ["clock", "check-circle", "eye-off", "calendar"];
  let content: ReactNode;
  if (state === "missing") content = screen("alert-circle", t.missing, <p>{t.missingText}</p>);
  else if (state === "thanks") content = screen("check-circle", t.thanks, <>{ans.q5 === "ja" && <p>{t.thanksContact}</p>}<p className="text-text-muted">{t.close}</p></>);
  else if (state === "used") content = screen("lock", t.used, <p>{t.usedText}</p>);
  else if (state === "expired") content = screen("clock", t.expired, <p>{tr(t.expiredText, { days })}</p>);
  else if (step === 0) {
    content = (
      <Stack>
        <h1 data-step-heading="" tabIndex={-1} className="text-[1.5rem] font-extrabold outline-none">{t.title}</h1>
        <p>{t.intro}</p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {t.bullets.map((b, i) => (
            <li key={i} className="flex flex-nowrap items-start gap-2.5">
              <Icon name={bulletIcons[i]} className="mt-1 flex-none" />
              <span>{tr(b, { days })}</span>
            </li>
          ))}
        </ul>
        <Button kind="primary" size="lg" block icon={lang === "ar" ? undefined : "arrow-right"} onClick={() => setStep(1)}>
          {t.start}
        </Button>
      </Stack>
    );
  } else {
    content = (
      <Stack>
        <Stack gap="sm">
          <span className="text-small text-text-muted">{tr(t.of, { n: step })}</span>
          <div aria-hidden="true" className="grid grid-cols-5 gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className={cn("h-2 rounded-[2px] bg-ljusgra-ton2", n < step && "bg-bla", n === step && "bg-antracit")} />
            ))}
          </div>
        </Stack>
        <h1 data-step-heading="" tabIndex={-1} className="text-[1.3125rem] font-extrabold outline-none">{t[qKey]}</h1>
        {question()}
        <Row between>
          <Button kind="ghost" onClick={() => setStep(step - 1)}>
            {t.back}
          </Button>
          {step < 5 ? (
            <Button kind="primary" disabled={!answered} onClick={() => setStep(step + 1)}>
              {t.next}
            </Button>
          ) : (
            <Button kind="primary" icon="send" disabled={!answered} pending={submitCmd.pending} onClick={() => void submit()}>
              {t.submit}
            </Button>
          )}
        </Row>
      </Stack>
    );
  }
  return (
    <>
      <PulsePhone lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className="pulse-phone">
        <Row between>
          <span dir="ltr">
            <Brand name="Miljonbemanning" size="sm" />
          </span>
          <span className="text-small text-text-muted" lang="sv">
            {link.location}
          </span>
        </Row>
        {state !== "thanks" && (
          <Stack gap="sm">
            <Seg
              ariaLabel={t.language}
              value={lang}
              onValueChange={setLang}
              options={PULSE_LANGS.map((code) => ({ value: code, label: LANG_LABEL[code], lang: code, dir: code === "ar" ? "rtl" : "ltr" }))}
            />
            {lang !== "sv" && (
              <span lang="sv" dir="ltr">
                <Badge tone="plan" icon="globe">
                  Översättning – granskas av människa
                </Badge>
              </span>
            )}
          </Stack>
        )}
        {content}
      </PulsePhone>
      <div lang="sv" className="flex flex-col gap-2">
        <DemoNote>
          Deltagaren öppnar en engångslänk från SMS eller e-post – ingen inloggning. Länken är signerad, gäller i {days} dagar och fungerar bara en gång. Coachen ser inte enskilda svar. &quot;Ja&quot; på fråga 5 blir en uppgift till samordnaren, och lågt betyg på fråga 3 går till chefen.
        </DemoNote>
        <DemoOnly>
          <div className="flex flex-col gap-1">
            <span className="text-small font-bold">Förhandsvisa länkens lägen</span>
            <Seg
              ariaLabel="Förhandsvisa länkens lägen"
              value={preview}
              onValueChange={setPreview}
              options={[
                { value: "live", label: "Aktuell länk" },
                { value: "used", label: "Redan använd" },
                { value: "expired", label: "Har gått ut" },
              ]}
            />
          </div>
          <Row gap="sm">
            <PerspectiveLink role="chef" to="/ledning?flik=puls" label="Se sammanställningen som chef" />
            <PerspectiveLink role="samordnare" to="/min-vecka" label="Se samordnarens uppgift" />
          </Row>
        </DemoOnly>
      </div>
    </>
  );
}
