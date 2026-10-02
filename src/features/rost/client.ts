// Klientens del av röstinspelningen: ladda upp ljudet och vänta på transkriberingen. Samma i appen och prototypen.
//   1. start    kommandot rost.uploadStart (behörighet, avtal, samtycke) -> var ljudet ska laddas upp
//   2. upload   appen: PUT direkt till lagringen (signerad adress, privat bucket i Stockholm – Vercels funktioner tar högst
//               4,5 MB). Minnesläget och prototypen: ingen adress, inget laddas upp.
//   3. finish   områdets kommando (coach.recordingFinish, kommun.dictationFinish, rost.send): bekräftar uppladdningen och
//               startar transkriberingen. Minnesläget kör jobbet direkt; appen kör det direkt efter svaret (status running).
//   4. poll     områdets fråga tills körningen är klar (bara appen).
// Den lokala kopian (Blob) släpps när funktionen är klar – ljudet finns bara kvar i lagringen tills det transkriberats.
import type { Fail, Result } from "@/api/contract";
import type { RecordedAudio } from "@/ui/recorder";
import type { UploadStartInput, UploadTicket } from "./api";

export type VoicePhase = "uploading" | "processing";

/** Grundtypen utan parametrar ("audio/webm;codecs=opus" -> "audio/webm") – Content-Type vid uppladdningen. */
export const baseMime = (mime: string): string => String(mime || "audio/webm").split(";")[0].trim().toLowerCase();

/** Ladda upp ljudet till den signerade adressen. Ingen adress (minnesläget/prototypen) eller inget ljud: inget görs. */
export async function putAudio(ticket: UploadTicket, audio: RecordedAudio): Promise<void> {
  if (!ticket.uploadUrl || !audio.blob) return;
  const res = await fetch(ticket.uploadUrl, {
    method: "PUT",
    body: audio.blob,
    headers: { "content-type": baseMime(audio.mimeType), "x-upsert": "false", "cache-control": "no-store" },
    credentials: "omit",
  });
  if (!res.ok) throw new Error("Uppladdningen misslyckades");
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Läget för en körning (alla områdens vy-modeller har status och error). */
export type RunLike = { status: "running" | "succeeded" | "failed"; error: string | null };

export type VoiceFlowResult<S> = { ok: true; state: S } | { ok: false; error: string; message: string };

/**
 * Hela flödet: start -> uppladdning -> finish -> (vänta). onPhase anropas när uppladdningen och bearbetningen börjar.
 * minPhaseMs: visa varje steg minst så länge (så att förloppet går att följa även när allt går fort).
 */
export async function runVoiceFlow<S extends RunLike>(o: {
  audio: RecordedAudio;
  start: (meta: Pick<UploadStartInput, "mimeType" | "bytes" | "durationSec">) => Promise<Result<{ ticket: UploadTicket }, string>>;
  finish: (ticket: UploadTicket) => Promise<Result<S, string>>;
  poll?: (state: S) => Promise<S | null>;
  onPhase?: (p: VoicePhase) => void;
  /** Längd att rapportera (t.ex. en simulerad inspelning i prototypen). Standard: inspelningens. */
  durationSec?: number | null;
  minPhaseMs?: number;
  /** Text när något tekniskt går fel. */
  errorText: string;
  /** Hur länge vi väntar på transkriberingen innan vi ger upp (ms). */
  timeoutMs?: number;
}): Promise<VoiceFlowResult<S>> {
  const min = o.minPhaseMs ?? 0;
  const failOf = (r: Fail<string>): VoiceFlowResult<S> => ({ ok: false, error: r.error, message: r.message || o.errorText });
  try {
    o.onPhase?.("uploading");
    const t0 = Date.now();
    const durationSec = o.durationSec !== undefined ? o.durationSec : o.audio.durationSec;
    const started = await o.start({ mimeType: baseMime(o.audio.mimeType), bytes: o.audio.bytes || null, durationSec: durationSec ?? null });
    if (!started.ok) return failOf(started);
    await putAudio(started.ticket, o.audio);
    if (min) await sleep(Math.max(0, min - (Date.now() - t0)));
    o.onPhase?.("processing");
    const t1 = Date.now();
    const done = await o.finish(started.ticket);
    if (!done.ok) return failOf(done);
    let state = done as unknown as S;
    const deadline = Date.now() + (o.timeoutMs ?? 10 * 60_000);
    while (state.status === "running" && o.poll && Date.now() < deadline) {
      await sleep(2000);
      const next = await o.poll(state);
      if (next) state = next;
    }
    if (min) await sleep(Math.max(0, min - (Date.now() - t1)));
    if (state.status === "running") return { ok: false, error: "timeout", message: "Det tar längre tid än vanligt. Försök igen om en stund." };
    return { ok: true, state };
  } catch {
    return { ok: false, error: "network", message: o.errorText };
  }
}
