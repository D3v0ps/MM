// @vitest-environment jsdom
// Inspelningskomponenten: filtyper, felmeddelanden på svenska, simulerad inspelning bara i prototypen, paus och stopp.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeProvider, type RuntimeMode } from "@/shell/runtime";
import { normalizeAudioMime } from "@/features/_shared/audio-port";
import { audioFileType, pickMimeType, Recorder, RECORDING_MIME_PREFERENCE, type RecordedAudio } from "./recorder";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const wrap = (children: ReactNode, mode: RuntimeMode = "app") => <RuntimeProvider mode={mode}>{children}</RuntimeProvider>;

describe("audioFileType", () => {
  it("tar emot m4a, mp3, wav och webm – även när webbläsaren inte anger typen", () => {
    expect(audioFileType({ name: "samtal.m4a", type: "" })).toBe("audio/mp4");
    expect(audioFileType({ name: "samtal.MP3", type: "" })).toBe("audio/mpeg");
    expect(audioFileType({ name: "samtal.wav", type: "audio/wav" })).toBe("audio/wav");
    expect(audioFileType({ name: "samtal.webm", type: "video/webm" })).toBe("audio/webm");
    expect(audioFileType({ name: "samtal.pdf", type: "application/pdf" })).toBeNull();
    expect(audioFileType({ name: "film.avi", type: "" })).toBeNull();
  });
});

describe("pickMimeType", () => {
  it("föredrar mp4/AAC, sedan ogg/opus, sist webm/opus – och alla grundtyper tas emot av lagringen", () => {
    const only = (...ok: string[]) => ({ isTypeSupported: (t: string) => ok.includes(t) });
    // Chrome/Edge på Windows och macOS, Safari
    expect(pickMimeType(only("audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"))).toBe("audio/mp4;codecs=mp4a.40.2");
    expect(pickMimeType(only("audio/mp4"))).toBe("audio/mp4");
    // Firefox
    expect(pickMimeType(only("audio/webm;codecs=opus", "audio/ogg;codecs=opus"))).toBe("audio/ogg;codecs=opus");
    // Chrome på Linux och Chromebook
    expect(pickMimeType(only("audio/webm;codecs=opus", "audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(pickMimeType(only())).toBe("");
    expect(pickMimeType(undefined)).toBe("");
    expect(pickMimeType({})).toBe("");
    expect(pickMimeType({ isTypeSupported: () => { throw new Error("nej"); } })).toBe("");
    expect(RECORDING_MIME_PREFERENCE).toEqual(["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"]);
    for (const t of RECORDING_MIME_PREFERENCE) expect(normalizeAudioMime(t)).toBe(t.split(";")[0]);
  });
});

describe("Recorder", () => {
  it("appen: ingen simulering, och ett begripligt fel när webbläsaren saknar inspelning", async () => {
    render(wrap(<Recorder maxSeconds={300} onRecorded={() => undefined} />));
    expect(screen.queryByRole("button", { name: "Simulera en inspelning" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Starta inspelning" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("Inspelning fungerar inte i den här webbläsaren");
    expect(screen.getByText("Högst 5 minuter.")).toBeTruthy();
  });

  it("nekad mikrofon ger förklaringen på svenska", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error("nej"), { name: "NotAllowedError" }));
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    (window as unknown as { MediaRecorder: unknown }).MediaRecorder = class {};
    render(wrap(<Recorder maxSeconds={300} onRecorded={() => undefined} />));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Starta inspelning" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("Webbläsaren har inte fått använda mikrofonen");
    delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });

  it("prototypen: simulerad inspelning med indikator, paus och stopp vid längsta tiden", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "Date"] });
    const got: RecordedAudio[] = [];
    render(wrap(<Recorder maxSeconds={60} texts={{ stop: "Stoppa och tolka" }} onRecorded={(a) => got.push(a)} />, "demo"));
    fireEvent.click(screen.getByRole("button", { name: "Simulera en inspelning" }));
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByRole("timer").textContent).toBe("Spelar in 00:02");
    fireEvent.click(screen.getByRole("button", { name: "Pausa" }));
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("Inspelningen är pausad · 00:02")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fortsätt" }));
    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    // Stoppas vid längsta tiden (60 s) – pausen räknas inte
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ blob: null, simulated: true, source: "recording", durationSec: 60 });
    expect(screen.getByRole("status").textContent).toContain("Inspelningen stoppades efter 1 minut.");
  });
});
