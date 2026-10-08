"use client";
// Deltagarens röstmeddelande (/rost/:token, publik – ingen inloggning, länken är behörigheten). Mobilvy i lättläst svenska
// med språkval (svenska, engelska, arabiska, somaliska – översättningarna märks "granskas av människa"). Samtycke med
// kryssruta innan inspelningen, inspelning (högst avtalets minuter), lyssna, skicka och kvitto. Inget ljud sparas: det
// raderas direkt efter transkriberingen, och coachen får texten (översatt till svenska) som underlag att granska.
// Länken skickas aldrig till skyddade ärenden och fungerar bara en gång.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCommand, useQuery, useQueryRunner } from "@/shell/backend";
import type { ScreenProps } from "@/shell/routes";
import { DemoOnly } from "@/shell/runtime";
import { Badge, Brand, Button, Check, DemoNote, ErrorNotice, Icon, Loading, PerspectiveLink, PulsePhone, Recorder, Row, Seg, Stack, cn, type IconName, type RecordedAudio } from "@/ui";
import { rostLink, rostSend, rostSendStatus, uploadStart, type RostLang, type RostLinkView, type VoiceState } from "../api";
import { runVoiceFlow } from "../client";
import { ROST_LANG_LABEL, RT, tr } from "../texts";

type Preview = "live" | "used" | "expired";
type Step = "record" | "review" | "sending" | "thanks";

export function RostScreen({ params }: ScreenProps) {
  const token = params.token;
  const q = useQuery(rostLink, token ? { token } : {});
  return (
    <div className="flex w-[min(460px,100%)] flex-col gap-4">
      {q.error ? <ErrorNotice error={q.error} /> : !q.data ? <Loading /> : <Rost link={q.data} token={token} />}
    </div>
  );
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

function Rost({ link, token }: { link: RostLinkView; token: string | undefined }) {
  const start = useCommand(uploadStart);
  const send = useCommand(rostSend);
  const runQuery = useQueryRunner();
  const [lang, setLang] = useState<RostLang>(link.language);
  const [consent, setConsent] = useState(false);
  const [step, setStep] = useState<Step>("record");
  const [audio, setAudio] = useState<RecordedAudio | null>(null);
  const [phase, setPhase] = useState<"uploading" | "processing">("uploading");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview>("live");
  const t = RT[lang];
  const rtl = lang === "ar";
  const days = link.days;
  const state = preview !== "live" && link.state === "open" && step !== "thanks" ? preview : link.state;
  const tokenArg = token ? { token } : {};
  // Vid varje stegbyte (inspelad, skickas, tack, spela in igen): fokus till rubriken, så att skärmläsaren läser det nya läget.
  // Medan meddelandet skickas finns ingen rubrik – stegen läses upp av statusrutan.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.querySelector<HTMLElement>("[data-step-heading]")?.focus();
  }, [step, state]);

  const doSend = async () => {
    if (!audio) return;
    setError(null);
    setStep("sending");
    // En simulerad inspelning (prototypen, utan mikrofon) räknas som ett kort meddelande på en halv minut.
    const durationSec = audio.simulated ? Math.min(link.maxMinutes * 60, Math.max(30, audio.durationSec ?? 0)) : audio.durationSec;
    const res = await runVoiceFlow<VoiceState>({
      audio,
      durationSec,
      errorText: t.sendError,
      minPhaseMs: 600,
      onPhase: setPhase,
      start: (meta) => start.run({ purpose: "participant", ...tokenArg, consent: true, ...meta }),
      finish: (ticket) => send.run({ ...tokenArg, uploadId: ticket.uploadId, language: lang, consent: true, durationSec }),
      poll: (s) => runQuery(rostSendStatus, { ...tokenArg, aiRunId: s.aiRunId }),
    });
    if (res.ok && res.state.status === "succeeded") {
      setAudio(null);
      setStep("thanks");
      return;
    }
    // Felet visas på deltagarens språk (texterna från servern är på svenska).
    setError(res.ok ? t.sendError : res.error === "link_used" ? t.usedText : res.error === "link_expired" ? tr(t.expiredText, { days }) : t.sendError);
    setStep("review");
  };

  const screen = (icon: IconName, title: string, children: ReactNode) => (
    <div className="flex flex-col items-center gap-4 py-3 text-center">
      <Icon name={icon} size="xl" />
      <h1 data-step-heading="" tabIndex={-1} className="text-[1.375rem] font-extrabold outline-none">{title}</h1>
      {children}
    </div>
  );
  const bulletIcons: IconName[] = ["check-circle", "clock", "trash", "user", "calendar"];

  let content: ReactNode;
  if (step === "thanks") {
    content = screen("check-circle", t.thanks, <><p>{t.thanksText}</p><p className="text-text-muted">{t.close}</p></>);
  } else if (state === "missing") content = screen("alert-circle", t.missing, <p>{t.missingText}</p>);
  else if (state === "used") content = screen("lock", t.used, <p>{t.usedText}</p>);
  else if (state === "expired") content = screen("clock", t.expired, <p>{tr(t.expiredText, { days })}</p>);
  else if (state === "disabled") content = screen("mic", t.disabled, <p>{t.disabledText}</p>);
  else if (step === "sending") {
    const steps = [t.sending, t.processing];
    const i = phase === "uploading" ? 0 : 1;
    content = (
      <div role="status" aria-live="polite" className="flex flex-col gap-2.5 rounded-mb border-[1.5px] border-bla bg-bla-ton px-3.5 py-3">
        {steps.map((s, n) => (
          <div key={s} className={cn("flex items-center gap-2", n > i && "text-text-muted", n === i && "font-extrabold")}>
            <Icon name={n < i ? "check" : n === i ? "refresh" : "circle"} />
            {s}
          </div>
        ))}
      </div>
    );
  } else if (step === "review" && audio) {
    content = (
      <Review
        audio={audio}
        texts={t}
        error={error}
        pending={start.pending || send.pending}
        onSend={() => void doSend()}
        onRedo={() => {
          setAudio(null);
          setError(null);
          setStep("record");
        }}
      />
    );
  } else {
    content = (
      <Stack>
        <h1 data-step-heading="" tabIndex={-1} className="text-[1.5rem] font-extrabold outline-none">{t.title}</h1>
        <p>{t.intro}</p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {t.bullets.map((b, i) => (
            <li key={i} className="flex flex-nowrap items-start gap-2.5">
              <Icon name={bulletIcons[i] ?? "check"} className="mt-1 flex-none" />
              <span>{tr(b, { days, min: link.maxMinutes })}</span>
            </li>
          ))}
        </ul>
        <section aria-labelledby="rost-consent-title" className="flex flex-col gap-2.5 rounded-mb border-[1.5px] border-antracit bg-vit px-3.5 py-3">
          <h2 id="rost-consent-title" className="text-h3 font-extrabold">
            {t.consentTitle}
          </h2>
          <p id="rost-consent-text">{t.consentText}</p>
          <Check id="rost-consent" checked={consent} onCheckedChange={setConsent}>
            {t.consentCheck}
          </Check>
          <span className="text-small text-text-muted" lang="sv" dir="ltr">
            Samtyckestext {link.consentVersion}
          </span>
        </section>
        <p className="flex items-start gap-2 text-body">
          <Icon name="shield" className="mt-1 flex-none" />
          {t.tip}
        </p>
        {!consent && <p className="text-body font-bold">{t.consentNeeded}</p>}
        <Recorder
          idPrefix="rost-rec"
          size="lg"
          disabled={!consent}
          maxSeconds={link.maxMinutes * 60}
          texts={t.recorder}
          lang={lang}
          dir={rtl ? "rtl" : "ltr"}
          onRecorded={(a) => {
            setAudio(a);
            setError(null);
            setStep("review");
          }}
        />
      </Stack>
    );
  }

  return (
    <>
      <PulsePhone lang={lang} dir={rtl ? "rtl" : "ltr"} className="pulse-phone rost-phone">
        <Row between>
          <span dir="ltr">
            <Brand name="Miljonbemanning" size="sm" />
          </span>
          <span className="text-small text-text-muted" lang="sv">
            {link.location}
          </span>
        </Row>
        {step !== "thanks" && step !== "sending" && (
          <Stack gap="sm">
            <Seg
              ariaLabel={t.language}
              value={lang}
              onValueChange={setLang}
              options={link.languages.map((code) => ({ value: code, label: ROST_LANG_LABEL[code], lang: code, dir: code === "ar" ? "rtl" : "ltr" }))}
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
          Deltagaren öppnar en engångslänk från SMS eller e-post – ingen inloggning. Samtycket ges i länken innan något spelas in. Ljudet raderas direkt efter
          transkriberingen och coachen får texten, översatt till svenska, som underlag att granska. Länken gäller i {days} dagar och fungerar en gång. I prototypen är
          transkriberingen och översättningen simulerade.
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
            <PerspectiveLink role="coach" to="/min-vecka" label="Se röstmeddelandet som coach" />
          </Row>
        </DemoOnly>
      </div>
    </>
  );
}

/** Inspelningen är klar: lyssna, skicka eller spela in igen. */
function Review({
  audio, texts: t, error, pending, onSend, onRedo,
}: {
  audio: RecordedAudio;
  texts: (typeof RT)[RostLang];
  error: string | null;
  pending: boolean;
  onSend: () => void;
  onRedo: () => void;
}) {
  // Uppspelning av den egna inspelningen (bara i webbläsaren – ingenting skickas förrän deltagaren trycker Skicka).
  const url = useMemo(() => (audio.blob ? URL.createObjectURL(audio.blob) : null), [audio.blob]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return (
    <Stack>
      <h1 data-step-heading="" tabIndex={-1} className="text-[1.375rem] font-extrabold outline-none">{t.doneTitle}</h1>
      <p className="font-bold tabular-nums">{tr(t.length, { time: mmss(audio.durationSec ?? 0) })}</p>
      {url && (
        <div className="flex flex-col gap-1.5">
          <span id="rost-listen" className="font-bold">
            {t.listen}
          </span>
          <audio controls src={url} aria-labelledby="rost-listen" className="w-full" />
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-mb border-2 border-rod bg-rod-ton px-3 py-2.5">
          <Icon name="alert-circle" className="mt-0.5 flex-none text-rod" />
          <span>{error}</span>
        </div>
      )}
      <Button kind="primary" size="lg" block icon="send" pending={pending} onClick={onSend}>
        {t.send}
      </Button>
      <Button kind="secondary" size="lg" block icon="refresh" disabled={pending} onClick={onRedo}>
        {t.redo}
      </Button>
    </Stack>
  );
}
