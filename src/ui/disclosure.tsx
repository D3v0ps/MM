"use client";
// Hopfällbart innehåll (UX-genomgången, paket 1):
//   Disclosure   en knapp med aria-expanded som visar och döljer ett avsnitt (Grupper och nivåer: yrkesområdena och nivåernas
//                deltagare, förvalt ihopfällda när listan är lång). Innehållet finns kvar i sidan men är dolt (hidden).
//   MoreActions  "Fler val": de mindre vanliga åtgärderna bakom en knapp, så att sidan visar högst två knappar överst
//                (aktivitetsvyn). Esc och klick utanför stänger och lämnar fokus på knappen; ett val stänger panelen och
//                lämnar fokus på knappen innan åtgärden körs (en dialog som öppnas ger sedan tillbaka fokus dit).
// Disclosure-mönstret (WAI-ARIA), inte en meny: knapparna i panelen nås med Tab som vanligt.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, type ButtonKind } from "./button";
import { cn } from "./cn";

export type DisclosureProps = {
  /** Knappens text när innehållet är dolt, t.ex. "Visa deltagarna (23)". */
  label: ReactNode;
  /** Knappens text när innehållet visas (standard: samma som label). */
  openLabel?: ReactNode;
  defaultOpen?: boolean;
  /** Panelens id (annars genererat). */
  id?: string;
  kind?: ButtonKind;
  className?: string;
  buttonClassName?: string;
  /** Visas bara när innehållet är dolt, t.ex. en sammanfattning på en rad. */
  summary?: ReactNode;
  /** Visas alltid bredvid knappen, t.ex. de valda filtren som text. */
  aside?: ReactNode;
  children?: ReactNode;
};

/** Knapp + avsnitt som visas och döljs. Tillståndet ligger bara i minnet. */
export function Disclosure({ label, openLabel, defaultOpen = false, id, kind = "ghost", className, buttonClassName, summary, aside, children }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const auto = useId();
  const panelId = id ?? `mm-disclosure-${auto.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <div className={cn("flex flex-col gap-2", className)} data-disclosure={open ? "open" : "closed"}>
      {!open && summary}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button kind={kind} icon={open ? "chevron-up" : "chevron-down"} aria-expanded={open} aria-controls={panelId} className={buttonClassName} onClick={() => setOpen(!open)}>
          {open ? (openLabel ?? label) : label}
        </Button>
        {aside}
      </div>
      <div id={panelId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

export type MoreActionsProps = {
  /** Knappens text (standard "Fler val"). */
  label?: string;
  /** Knapparna i panelen (Button). */
  children?: ReactNode;
  className?: string;
};

/** "Fler val": de mindre vanliga åtgärderna bakom en knapp. */
export function MoreActions({ label = "Fler val", children, className }: MoreActionsProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const auto = useId();
  const panelId = `mm-more-${auto.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const toggleId = `${panelId}-knapp`;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      document.getElementById(toggleId)?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, toggleId]);
  // Panelens vänsterkant (i förhållande till knappen): högerkanten mot knappens högerkant, men alltid inom skärmen med 16 px
  // marginal – också när knappen står till vänster på en smal skärm. Mäts innan panelen ritas.
  const [left, setLeft] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const w = wrap.current;
    const panel = document.getElementById(panelId);
    if (!w || !panel) return;
    const r = w.getBoundingClientRect();
    const pw = panel.offsetWidth;
    const vw = document.documentElement.clientWidth;
    const x = Math.max(16, Math.min(r.right - pw, vw - 16 - pw));
    setLeft(Math.round(x - r.left));
  }, [open, panelId]);
  // Panelen öppnas: fokus på första valet.
  useEffect(() => {
    if (open) document.getElementById(panelId)?.querySelector<HTMLElement>("button, a[href]")?.focus();
  }, [open, panelId]);
  return (
    <div ref={wrap} className={cn("relative inline-block", className)} data-more-actions="">
      <Button icon={open ? "chevron-up" : "chevron-down"} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)} id={toggleId}>
        {label}
      </Button>
      <div
        id={panelId}
        hidden={!open}
        // Ett val: panelen stängs och fokus ligger på Fler val innan åtgärden körs (dialogen som öppnas ger tillbaka fokus dit).
        onClickCapture={(e) => {
          if (!(e.target as HTMLElement).closest("button, a[href]")) return;
          document.getElementById(toggleId)?.focus();
          setOpen(false);
        }}
        style={left === null ? undefined : { left }}
        className={cn(
          "absolute top-full z-30 mt-1 flex w-[min(340px,calc(100vw-32px))] flex-col gap-1 rounded-mb border border-ljusgra bg-vit p-2 shadow-pop",
          left === null && "right-0",
          "[&>*]:w-full [&>*]:justify-start [&>*]:whitespace-normal [&>*]:text-left",
        )}
      >
        {children}
      </div>
    </div>
  );
}
