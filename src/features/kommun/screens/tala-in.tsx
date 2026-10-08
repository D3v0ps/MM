"use client";
// "Tala in" i kommunens portal (docs/PLAN-ROST.md, flöde 2): vid beställningens bakgrund och vid nytt meddelande.
// Handläggaren talar i stället för att skriva. Talet blir text i fältet – handläggaren läser, rättar och skickar själv.
// Inget ljud sparas: det raderas direkt när det blivit text. Portalens klarspråk: korta meningar, 18 px text (portallayouten).
// I testmiljön är AI:n simulerad – då står det tydligt att texten är påhittad (beslut 2026-10-07, synpunkt #9).
import { useState } from "react";
import { useCommand, useQuery, useQueryRunner } from "@/shell/backend";
import { AiTag, Button, Icon, Recorder, SimulatedAiNotice, type RecordedAudio } from "@/ui";
import { uploadStart } from "@/features/rost/api";
import { runVoiceFlow } from "@/features/rost/client";
import { dictationFinish, dictationOptions, dictationState, type DictationState } from "../api";

/** Lägg den inlästa texten efter det som redan står i fältet (högst max tecken). */
export const joinText = (cur: string, add: string, max: number): string => (cur.trim() ? `${cur.trimEnd()} ${add.trim()}` : add.trim()).slice(0, max);

export function TalaIn({ fieldId, caseId, onText }: {
  /** Fältet som texten hamnar i (för id och etiketter). */
  fieldId: string;
  /** Ärendet (meddelanden). Utan ärende: en ny beställning. */
  caseId?: string;
  onText: (text: string) => void;
}) {
  const q = useQuery(dictationOptions, caseId ? { caseId } : {});
  const start = useCommand(uploadStart);
  const finish = useCommand(dictationFinish);
  const runQuery = useQueryRunner();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "uploading" | "processing">("idle");
  const [done, setDone] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const o = q.data;
  if (!o) return null;
  if (!o.enabled) {
    return o.reason ? (
      <p className="flex items-start gap-2 text-body text-text-muted portal:text-portal">
        <Icon name="lock" className="mt-1 flex-none" />
        {o.reason}
      </p>
    ) : null;
  }
  const go = async (audio: RecordedAudio) => {
    setErr(null);
    setDone(false);
    // En simulerad inspelning (prototypen, utan mikrofon) räknas som en kort diktering på tjugo sekunder.
    const durationSec = audio.simulated ? Math.min(o.maxMinutes * 60, Math.max(20, audio.durationSec ?? 0)) : audio.durationSec;
    const res = await runVoiceFlow<DictationState>({
      audio,
      durationSec,
      minPhaseMs: 500,
      errorText: "Talet kunde inte bli text. Försök igen, eller skriv i fältet.",
      onPhase: setPhase,
      start: (meta) => start.run({ purpose: "dictation", caseId: caseId ?? null, ...meta }),
      finish: (ticket) => finish.run({ uploadId: ticket.uploadId, durationSec }),
      poll: (s) => runQuery(dictationState, { aiRunId: s.aiRunId }),
    });
    setPhase("idle");
    const text = res.ok && res.state.status === "succeeded" ? res.state.text : null;
    if (!text) {
      setErr(res.ok ? res.state.error || "Talet kunde inte bli text. Försök igen, eller skriv i fältet." : res.message);
      return;
    }
    onText(text);
    setSimulated(res.ok && res.state.simulated);
    setDone(true);
    setOpen(false);
    setTimeout(() => document.getElementById(fieldId)?.focus(), 30);
  };
  return (
    <div className="flex flex-col gap-2.5">
      {!open && (
        <div>
          <Button kind="secondary" icon="mic" onClick={() => setOpen(true)}>
            Tala in
          </Button>
        </div>
      )}
      {open && (
        <section aria-label="Tala in" className="flex flex-col gap-2.5 rounded-mb border-[1.5px] border-bla bg-bla-ton px-3.5 py-3">
          <p>Tala in i stället för att skriva. Du kan ändra texten innan du skickar.</p>
          <p className="text-text-muted">Inget ljud sparas. Ljudet tas bort direkt när det har blivit text.</p>
          {phase === "idle" ? (
            <Recorder
              idPrefix={`${fieldId}-tala`}
              maxSeconds={Math.max(60, o.maxMinutes * 60)}
              texts={{ start: "Börja tala in", stop: "Klar", maxInfo: "Du kan tala i högst {min} minuter." }}
              onRecorded={(a) => void go(a)}
            >
              <div>
                <Button kind="ghost" onClick={() => setOpen(false)}>
                  Stäng
                </Button>
              </div>
            </Recorder>
          ) : (
            <div role="status" aria-live="polite" className="flex items-center gap-2 font-bold">
              <Icon name="refresh" />
              {phase === "uploading" ? "Skickar talet …" : "Gör om talet till text …"}
            </div>
          )}
        </section>
      )}
      {err && (
        <div role="alert" className="flex items-start gap-2 font-bold">
          <Icon name="alert-circle" className="mt-1 flex-none text-rod" />
          {err}
        </div>
      )}
      {done && (
        <p role="status" className="flex flex-wrap items-center gap-2">
          <AiTag>Inläst text</AiTag>
          Texten står nu i fältet. Läs den och rätta det som blev fel innan du skickar.
        </p>
      )}
      {done && simulated && <SimulatedAiNotice who="you" />}
    </div>
  );
}
