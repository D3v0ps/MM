"use client";
// Inspelning i webbläsaren (röstinspelningen, docs/PLAN-ROST.md). Samma komponent i riktiga appen och i prototypen.
//
//   Spela in   MediaRecorder: webm/opus i Chrome, Edge och Firefox, mp4 i Safari. Tydlig inspelningsindikator (röd punkt,
//              ikon, text och tid), paus, fortsätt och stopp. Stoppar själv vid avtalets längsta tid. Felmeddelande på svenska
//              om mikrofon saknas eller nekas. Varnar innan sidan lämnas mitt i en inspelning.
//   Ladda upp  en ljudfil (m4a, mp3, wav, webm) som alternativ.
//   Simulera   bara i prototypen (DemoOnly): en tidtagning utan mikrofon, för artefakter som saknar mikrofonåtkomst.
//
// Komponenten spelar bara in. Uppladdningen och transkriberingen gör skärmen (onRecorded får ljudet när inspelningen är
// stoppad). Ingen dataåtkomst här – samma regler som resten av src/ui.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRuntime } from "@/shell/runtime";
import { Badge } from "./badge";
import { Button } from "./button";
import { cn } from "./cn";
import { DemoNote } from "./feedback";
import { Icon } from "./icons";

/** Ljudet som spelats in eller valts. */
export type RecordedAudio = {
  /** Ljudet. Null för en simulerad inspelning (prototypen). */
  blob: Blob | null;
  /** Filtypen, t.ex. "audio/webm;codecs=opus" eller "audio/mp4". */
  mimeType: string;
  /** Längd i hela sekunder. Null för en uppladdad fil vars längd inte gick att läsa. */
  durationSec: number | null;
  bytes: number;
  /** Simulerad inspelning utan mikrofon (bara prototypen). */
  simulated: boolean;
  /** Inspelning i webbläsaren eller vald fil. */
  source: "recording" | "file";
  /** Filnamnet när en fil valts. */
  fileName: string | null;
};

/** Texterna i komponenten. Standard: svenska (RECORDER_TEXTS_SV). Deltagarens sida skickar sitt språk. */
export type RecorderTexts = {
  start: string;
  pause: string;
  resume: string;
  stop: string;
  /** "Spelar in" – följs av tiden. */
  recording: string;
  /** "Inspelningen är pausad" – följs av tiden. */
  paused: string;
  /** "Högst {min} minuter." */
  maxInfo: string;
  /** Visas när inspelningen stoppats vid längsta tiden. */
  maxReached: string;
  /** Upplästa lägen (skärmläsare). */
  startedSr: string;
  pausedSr: string;
  resumedSr: string;
  stoppedSr: string;
  /** Tips under knapparna medan inspelningen pågår (valfritt). */
  hint: string;
  starting: string;
  noSupport: string;
  denied: string;
  noMic: string;
  micError: string;
  /** Varning innan sidan lämnas mitt i en inspelning. */
  leaveWarning: string;
  fileLabel: string;
  fileHelp: string;
  fileButton: string;
  fileType: string;
  fileSize: string;
  chosen: string;
  simulate: string;
  simulateNote: string;
};

export const RECORDER_TEXTS_SV: RecorderTexts = {
  start: "Starta inspelning",
  pause: "Pausa",
  resume: "Fortsätt",
  stop: "Stoppa",
  recording: "Spelar in",
  paused: "Inspelningen är pausad",
  maxInfo: "Högst {minText}.",
  maxReached: "Inspelningen stoppades efter {minText}. Det är den längsta tillåtna tiden.",
  startedSr: "Inspelningen har startat.",
  pausedSr: "Inspelningen är pausad.",
  resumedSr: "Inspelningen fortsätter.",
  stoppedSr: "Inspelningen är stoppad.",
  hint: "",
  starting: "Startar mikrofonen …",
  noSupport: "Inspelning fungerar inte i den här webbläsaren. Använd en annan webbläsare, till exempel Chrome, Edge eller Safari.",
  denied: "Webbläsaren har inte fått använda mikrofonen. Tillåt mikrofonen för sidan i webbläsarens inställningar och försök igen.",
  noMic: "Ingen mikrofon hittades. Anslut en mikrofon eller ett headset och försök igen.",
  micError: "Mikrofonen kunde inte startas. Stäng andra program som använder mikrofonen och försök igen.",
  leaveWarning: "Inspelningen pågår. Om du lämnar sidan försvinner den.",
  fileLabel: "Ljudfil",
  fileHelp: "Filformat: m4a, mp3, wav eller webm. Högst {mb} MB.",
  fileButton: "Använd filen",
  fileType: "Filtypen stöds inte. Välj en fil i formatet m4a, mp3, wav eller webm.",
  fileSize: "Filen är för stor. Den får vara högst {mb} MB.",
  chosen: "Vald fil",
  simulate: "Simulera en inspelning",
  simulateNote: "Mikrofonen används inte i prototypen. Du kan simulera en inspelning: tiden går, men inget ljud spelas in.",
};

/** Filändelser som tas emot och deras filtyp (när webbläsaren inte anger någon). */
const FILE_TYPES: Record<string, string> = { m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", webm: "audio/webm" };
export const RECORDER_ACCEPT = ".m4a,.mp3,.wav,.webm,audio/mp4,audio/x-m4a,audio/mpeg,audio/wav,audio/x-wav,audio/webm";
/** Samma gräns som lagringen (AUDIO_MAX_BYTES i src/features/_shared/audio-port.ts). */
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Filtypen för en vald fil: webbläsarens typ, annars från filändelsen. Null om filen inte tas emot. */
export function audioFileType(file: { name: string; type: string }): string | null {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const byExt = FILE_TYPES[ext] ?? null;
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("audio/") || t === "video/webm" || t === "video/mp4") {
    // Vissa webbläsare anger video/webm eller video/mp4 för ljudfiler – använd ljudtypen.
    if (t.startsWith("video/")) return byExt ?? t.replace("video/", "audio/");
    return t;
  }
  return byExt;
}

/** Bästa inspelningsformatet i webbläsaren: webm/opus (Chrome, Edge, Firefox) eller mp4 (Safari). "" = webbläsarens standard. */
function pickMimeType(): string {
  const MR = typeof window !== "undefined" ? window.MediaRecorder : undefined;
  if (!MR || typeof MR.isTypeSupported !== "function") return "";
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"]) {
    try {
      if (MR.isTypeSupported(t)) return t;
    } catch {
      /* prova nästa */
    }
  }
  return "";
}

type Phase = "idle" | "starting" | "recording" | "paused";
type Session = { recorder: MediaRecorder | null; stream: MediaStream | null; chunks: Blob[]; mimeType: string; simulated: boolean };

export type RecorderProps = {
  /** Längsta inspelning i sekunder (avtalets maxMinutes × 60). Inspelningen stoppas där. */
  maxSeconds: number;
  /** Ljudet när inspelningen stoppats eller en fil valts. */
  onRecorded: (audio: RecordedAudio) => void;
  /** Visa inspelningen (standard). */
  record?: boolean;
  /** Visa "ladda upp ljudfil". */
  upload?: boolean;
  /** Inaktiv (t.ex. samtycke saknas eller uppladdning pågår). */
  disabled?: boolean;
  /** Egna texter (t.ex. "Spela in samtalet", "Stoppa och tolka", deltagarens språk). */
  texts?: Partial<RecorderTexts>;
  /** Prefix för fältens id (unika på sidan). */
  idPrefix?: string;
  /** Stora knappar (deltagarens mobilvy). */
  size?: "lg";
  /** Visa "Simulera en inspelning" i prototypen. Standard: ja. */
  allowSimulate?: boolean;
  /** Största fil som får väljas (byte). */
  maxBytes?: number;
  /** Extra innehåll under knapparna (t.ex. Avbryt). */
  children?: ReactNode;
  className?: string;
  /** Språk och riktning för texterna (deltagarens sida). */
  lang?: string;
  dir?: "ltr" | "rtl";
  /** Anropas när inspelningen startar, pausas och stoppas (t.ex. för att låsa andra val medan den pågår). */
  onActiveChange?: (active: boolean) => void;
};

/**
 * Inspelningsknappar med indikator. Anropar onRecorded en gång per inspelning (eller vald fil). Stoppar mikrofonen när
 * inspelningen är klar och när komponenten tas bort.
 */
export function Recorder({
  maxSeconds, onRecorded, record = true, upload = false, disabled, texts, idPrefix, size, allowSimulate = true, maxBytes = DEFAULT_MAX_BYTES, children, className, lang, dir,
  onActiveChange,
}: RecorderProps) {
  const t: RecorderTexts = { ...RECORDER_TEXTS_SV, ...texts };
  const demo = useRuntime() === "demo";
  const auto = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = idPrefix ?? `rec${auto}`;
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [simulated, setSimulated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  // Tid: summan av de inspelade avsnitten (pauser räknas inte) + pågående avsnitt sedan startMs.
  const clock = useRef<{ doneMs: number; startMs: number | null }>({ doneMs: 0, startMs: null });
  const onRecordedRef = useRef(onRecorded);
  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);
  const activeNow = phase === "recording" || phase === "paused" || phase === "starting";
  useEffect(() => {
    onActiveChange?.(activeNow);
  }, [activeNow, onActiveChange]);
  const maxMin = Math.max(1, Math.round(maxSeconds / 60));
  const minText = `${maxMin} ${maxMin === 1 ? "minut" : "minuter"}`;
  const mb = Math.round(maxBytes / (1024 * 1024));

  const elapsedMs = () => clock.current.doneMs + (clock.current.startMs != null ? Date.now() - clock.current.startMs : 0);

  const release = useCallback(() => {
    const s = session.current;
    session.current = null;
    if (!s) return;
    try {
      if (s.recorder && s.recorder.state !== "inactive") {
        s.recorder.ondataavailable = null;
        s.recorder.onstop = null;
        s.recorder.stop();
      }
    } catch {
      /* redan stoppad */
    }
    s.stream?.getTracks().forEach((tr) => tr.stop());
  }, []);
  // Mikrofonen stängs om komponenten tas bort mitt i en inspelning (ingen inspelning skickas då).
  useEffect(() => release, [release]);

  const focusControl = (name: "pause" | "start") => {
    setTimeout(() => document.getElementById(`${id}-${name}`)?.focus(), 30);
  };

  const finish = useCallback(
    (reason: "stop" | "max") => {
      const s = session.current;
      if (!s) return;
      const durationSec = Math.max(1, Math.round(elapsedMs() / 1000));
      clock.current = { doneMs: 0, startMs: null };
      setPhase("idle");
      setSeconds(0);
      setAnnounce(t.stoppedSr);
      setNotice(reason === "max" ? fill(t.maxReached, { min: maxMin, minText }) : null);
      if (s.simulated || !s.recorder) {
        session.current = null;
        onRecordedRef.current({ blob: null, mimeType: s.mimeType || "audio/webm", durationSec, bytes: durationSec * 4000, simulated: true, source: "recording", fileName: null });
        return;
      }
      const rec = s.recorder;
      rec.onstop = () => {
        const type = rec.mimeType || s.mimeType || "audio/webm";
        const blob = new Blob(s.chunks, { type });
        s.stream?.getTracks().forEach((tr) => tr.stop());
        session.current = null;
        onRecordedRef.current({ blob, mimeType: type, durationSec, bytes: blob.size, simulated: false, source: "recording", fileName: null });
      };
      try {
        if (rec.state !== "inactive") rec.stop();
        else rec.onstop?.(new Event("stop"));
      } catch {
        rec.onstop?.(new Event("stop"));
      }
    },
    [maxMin, minText, t.maxReached, t.stoppedSr],
  );

  // Tidtagningen: uppdateras fyra gånger i sekunden medan inspelningen pågår. Stoppar vid längsta tiden.
  useEffect(() => {
    if (phase !== "recording") return undefined;
    const tick = setInterval(() => {
      const ms = elapsedMs();
      setSeconds(Math.floor(ms / 1000));
      if (ms >= maxSeconds * 1000) finish("max");
    }, 250);
    return () => clearInterval(tick);
  }, [phase, maxSeconds, finish]);

  // Varning innan sidan lämnas mitt i en inspelning.
  useEffect(() => {
    if (phase !== "recording" && phase !== "paused") return undefined;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = t.leaveWarning;
      return t.leaveWarning;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase, t.leaveWarning]);

  const begin = (s: Session) => {
    session.current = s;
    clock.current = { doneMs: 0, startMs: Date.now() };
    setSeconds(0);
    setSimulated(s.simulated);
    setPhase("recording");
    setAnnounce(t.startedSr);
    focusControl("pause");
  };

  const start = async () => {
    setError(null);
    setNotice(null);
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md || typeof md.getUserMedia !== "function" || typeof window.MediaRecorder === "undefined") {
      setError(t.noSupport);
      return;
    }
    setPhase("starting");
    let stream: MediaStream;
    try {
      stream = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const name = (e as { name?: string } | null)?.name ?? "";
      setPhase("idle");
      setError(name === "NotAllowedError" || name === "SecurityError" ? t.denied : name === "NotFoundError" || name === "OverconstrainedError" ? t.noMic : t.micError);
      return;
    }
    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((tr) => tr.stop());
      setPhase("idle");
      setError(t.noSupport);
      return;
    }
    const s: Session = { recorder, stream, chunks: [], mimeType: recorder.mimeType || mimeType, simulated: false };
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) s.chunks.push(ev.data);
    };
    recorder.onerror = () => {
      release();
      clock.current = { doneMs: 0, startMs: null };
      setPhase("idle");
      setError(t.micError);
    };
    // Ljudet samlas i bitar varje sekund, så att inget går förlorat vid paus.
    recorder.start(1000);
    begin(s);
  };

  const startSimulated = () => {
    setError(null);
    setNotice(null);
    begin({ recorder: null, stream: null, chunks: [], mimeType: "audio/webm", simulated: true });
  };

  const pause = () => {
    const s = session.current;
    if (!s) return;
    try {
      if (s.recorder && s.recorder.state === "recording") s.recorder.pause();
    } catch {
      /* ignoreras */
    }
    const c = clock.current;
    clock.current = { doneMs: c.doneMs + (c.startMs != null ? Date.now() - c.startMs : 0), startMs: null };
    setSeconds(Math.floor(clock.current.doneMs / 1000));
    setPhase("paused");
    setAnnounce(t.pausedSr);
    setTimeout(() => document.getElementById(`${id}-resume`)?.focus(), 30);
  };
  const resume = () => {
    const s = session.current;
    if (!s) return;
    try {
      if (s.recorder && s.recorder.state === "paused") s.recorder.resume();
    } catch {
      /* ignoreras */
    }
    clock.current = { ...clock.current, startMs: Date.now() };
    setPhase("recording");
    setAnnounce(t.resumedSr);
    focusControl("pause");
  };

  const chooseFile = (f: File | null) => {
    setFileError(null);
    setFile(null);
    if (!f) return;
    if (!audioFileType(f)) {
      setFileError(t.fileType);
      return;
    }
    if (f.size > maxBytes) {
      setFileError(fill(t.fileSize, { mb }));
      return;
    }
    setFile(f);
  };
  const useFile = () => {
    if (!file) return;
    const type = audioFileType(file);
    if (!type) return;
    onRecordedRef.current({ blob: file, mimeType: type, durationSec: null, bytes: file.size, simulated: false, source: "file", fileName: file.name });
  };

  const active = phase === "recording" || phase === "paused";
  const big = size === "lg" ? "lg" : "md";
  return (
    <div className={cn("flex flex-col gap-3", className)} lang={lang} dir={dir}>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </p>
      {record && (
        <div className="flex flex-col gap-2.5">
          {!active && (
            <div className="flex flex-wrap items-center gap-2.5">
              <Button id={`${id}-start`} kind="primary" size={big} icon="mic" disabled={disabled || phase === "starting"} pending={phase === "starting"} onClick={() => void start()}>
                {phase === "starting" ? t.starting : t.start}
              </Button>
              <span className="text-small text-text-muted">{fill(t.maxInfo, { min: maxMin, minText })}</span>
            </div>
          )}
          {active && (
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-2.5">
                {phase === "recording" ? (
                  // Tiden uppdateras varje sekund – role timer läses inte upp hela tiden (lägena läses upp ovan).
                  <span role="timer" className="inline-flex items-center gap-2 rounded-full bg-rod px-3 py-1.5 font-extrabold text-vit tabular-nums">
                    <span aria-hidden="true" className="size-2.5 animate-blink rounded-full bg-vit" />
                    {t.recording} {mmss(seconds)}
                  </span>
                ) : (
                  <Badge tone="grey" icon="pause">
                    {t.paused} · {mmss(seconds)}
                  </Badge>
                )}
                <span className="text-small text-text-muted tabular-nums">
                  {fill(t.maxInfo, { min: maxMin, minText })}
                  {simulated && <span lang="sv"> Simulerad inspelning – inget ljud spelas in.</span>}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                {phase === "recording" ? (
                  <Button id={`${id}-pause`} kind="secondary" size={big} icon="pause" onClick={pause}>
                    {t.pause}
                  </Button>
                ) : (
                  <Button id={`${id}-resume`} kind="secondary" size={big} icon="play" onClick={resume}>
                    {t.resume}
                  </Button>
                )}
                <Button kind="danger" size={big} icon="stop" onClick={() => finish("stop")}>
                  {t.stop}
                </Button>
              </div>
              {t.hint && <p className="text-small text-text-muted">{t.hint}</p>}
            </div>
          )}
          {notice && (
            <p role="status" className="flex items-start gap-1.5 text-small font-bold">
              <Icon name="clock" className="mt-px" />
              {notice}
            </p>
          )}
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-mb border-2 border-rod bg-rod-ton px-3 py-2.5">
              <Icon name="alert-circle" className="mt-0.5 flex-none text-rod" />
              <span>{error}</span>
            </div>
          )}
          {demo && allowSimulate && !active && (
            <DemoNote>
              <span className="flex flex-col items-start gap-2">
                <span>{t.simulateNote}</span>
                <Button kind="secondary" icon="play" disabled={disabled} onClick={startSimulated}>
                  {t.simulate}
                </Button>
              </span>
            </DemoNote>
          )}
        </div>
      )}
      {upload && !active && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-file`} className="text-ui font-bold portal:text-h3">
            {t.fileLabel}
          </label>
          <div id={`${id}-file-help`} className="text-small text-text-muted portal:text-portal">
            {fill(t.fileHelp, { mb })}
          </div>
          <input
            id={`${id}-file`}
            type="file"
            accept={RECORDER_ACCEPT}
            disabled={disabled}
            aria-describedby={`${id}-file-help${fileError ? ` ${id}-file-error` : ""}`}
            aria-invalid={fileError ? true : undefined}
            onChange={(e) => chooseFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
          />
          {fileError && (
            <div id={`${id}-file-error`} role="alert" className="flex items-start gap-1.5 text-small font-bold">
              <Icon name="alert-circle" className="mt-px text-rod" />
              {fileError}
            </div>
          )}
          {file && (
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge tone="outline" icon="file">
                {t.chosen}: {file.name}
              </Badge>
              <Button kind="primary" size={big} icon="upload" disabled={disabled} onClick={useFile}>
                {t.fileButton}
              </Button>
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
