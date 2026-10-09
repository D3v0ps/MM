"use client";

import { useEffect, useState } from "react";
import { cn } from "./cn";
import { Icon } from "./icons";

/**
 * Pågående bearbetning i flera steg (t.ex. inspelning → transkribering → förslag): rubrik med snurra, förfluten tid,
 * stegen med gjort/pågår/väntar som ikon + text (aldrig bara färg) och en rad om hur lång tid det brukar ta.
 * `current` är index för steget som pågår; `current >= steps.length` betyder att allt är klart.
 */
export function ProcessSteps({ title, steps, current, hint, className }: { title: string; steps: readonly string[]; current: number; hint?: string; className?: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const done = current >= steps.length;
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <div role="status" aria-live="polite" aria-busy={!done || undefined} className={cn("flex flex-col gap-3 rounded-mb border-[1.5px] border-bla bg-bla-ton px-4 py-3.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 font-extrabold uppercase tracking-[0.04em]">
          {done ? <Icon name="check" /> : <span aria-hidden="true" className="size-[18px] shrink-0 animate-spin rounded-full border-2 border-ljusgra border-t-antracit" />}
          {done ? "Klart" : title}
        </div>
        <span className="text-small font-medium tabular-nums text-text-muted" aria-label={`Förfluten tid ${mm} minuter ${seconds % 60} sekunder`}>
          {mm}:{ss}
        </span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === current ? "active" : "pending";
          return (
            <li key={s} className={cn("flex items-center gap-2.5", state === "pending" && "text-text-muted", state === "active" && "font-extrabold")}>
              {state === "active" ? (
                <span aria-hidden="true" className="size-4 shrink-0 animate-spin rounded-full border-2 border-ljusgra border-t-antracit" />
              ) : (
                <Icon name={state === "done" ? "check" : "circle"} className="shrink-0" />
              )}
              <span>{s}</span>
              <span className="sr-only">{state === "done" ? " – klart" : state === "active" ? " – pågår" : " – väntar"}</span>
            </li>
          );
        })}
      </ol>
      {hint && !done && <p className="text-small text-text-muted">{hint}</p>}
    </div>
  );
}
