// Märken och statusar. Status visas alltid med text + ikon, aldrig bara färg (Grön → blå, Gul → ljusgrå, Röd → röd).
import type { ReactNode } from "react";
import { CASE_STATUS_LABEL } from "@/core/labels";
import type { SlaStatus, SlaTone as CoreSlaTone } from "@/core/sla";
import { fmtDateTimeLong } from "@/core/time";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

const BADGE_TONE = {
  blue: "bg-bla text-antracit",
  bluetone: "bg-bla-ton2 text-antracit",
  grey: "bg-ljusgra text-antracit",
  red: "border-rod bg-vit text-antracit [&_svg]:text-rod",
  redfill: "border-2 border-rod bg-rod-ton2 font-extrabold text-antracit [&_svg]:text-rod",
  dark: "bg-antracit text-vit",
  outline: "border-line-strong bg-vit text-antracit",
  plan: "border-dashed border-antracit bg-vit font-bold text-antracit",
} as const;
export type BadgeTone = keyof typeof BADGE_TONE;

/** Litet märke. tone: blue | bluetone | grey (standard) | red | redfill | dark | outline | plan. */
export function Badge({ tone = "grey", icon, title, children, className }: { tone?: BadgeTone; icon?: IconName; title?: string; children?: ReactNode; className?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-[5px] rounded-full border-[1.5px] border-transparent px-[9px] py-[3px] align-middle text-meta leading-[1.35] font-bold whitespace-normal portal:text-body [&_svg]:size-3.5",
        BADGE_TONE[tone],
        className,
      )}
    >
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- Samlad status (Grön/Gul/Röd)
export type RagStatus = "green" | "yellow" | "red";
export const STATUS_TEXT: Record<RagStatus, string> = {
  green: "Grön – enligt plan",
  yellow: "Gul – risk eller extra åtgärd",
  red: "Röd – kräver omplanering eller dialog",
};
export const STATUS_SHORT: Record<RagStatus, string> = { green: "Grön", yellow: "Gul", red: "Röd" };
export const STATUS_ICON: Record<RagStatus, IconName> = { green: "check-circle", yellow: "alert-circle", red: "alert" };
const STATUS_TONE: Record<RagStatus | "none", string> = {
  green: "bg-bla text-antracit",
  yellow: "bg-ljusgra text-antracit",
  red: "border-2 border-rod bg-vit text-antracit [&_svg]:text-rod",
  none: "border-[1.5px] border-dashed border-line-strong bg-vit text-text-muted",
};
const PILL = "inline-flex items-center gap-1.5 rounded-full py-[3px] pr-2.5 pl-1.5 text-small font-bold whitespace-nowrap portal:text-body [&_svg]:size-4";

/** Samlad status. value null = "Ej bedömd". short = bara "Grön"/"Gul"/"Röd". */
export function Status({ value, short }: { value: RagStatus | null | undefined; short?: boolean }) {
  if (!value) {
    return (
      <span className={cn(PILL, STATUS_TONE.none)}>
        <Icon name="minus-circle" />
        Ej bedömd
      </span>
    );
  }
  return (
    <span className={cn(PILL, STATUS_TONE[value])}>
      <Icon name={STATUS_ICON[value]} />
      {short ? STATUS_SHORT[value] : STATUS_TEXT[value]}
    </span>
  );
}

// ---------------------------------------------------------------- Ärendestatus
/** Ärendets status (etiketterna kommer från src/core/labels – samma som prototypens statusLabel). */
export type CaseStatusValue = keyof typeof CASE_STATUS_LABEL;
const CASE_STATUS_LOOK: Record<CaseStatusValue, [BadgeTone, IconName]> = {
  received: ["grey", "inbox"],
  acknowledged: ["outline", "mail"],
  confirmed: ["bluetone", "check"],
  active: ["blue", "activity"],
  paused: ["grey", "pause"],
  closed: ["dark", "check-square"],
  declined: ["red", "x-circle"],
};

/** Ärendets status som märke (prototypens CaseStatus). */
export function CaseStatusBadge({ status }: { status: CaseStatusValue | string }) {
  const look = CASE_STATUS_LOOK[status as CaseStatusValue] ?? (["grey", "circle"] as [BadgeTone, IconName]);
  return (
    <Badge tone={look[0]} icon={look[1]}>
      {CASE_STATUS_LABEL[status as CaseStatusValue] ?? status}
    </Badge>
  );
}

// ---------------------------------------------------------------- SLA-klocka
export type SlaTone = CoreSlaTone;
/** Resultatet av slaStatus(dueAt, metAt, { now }) i src/core/sla – räknas i hanteraren och skickas i vy-modellen. */
export type SlaView = Pick<SlaStatus, "label" | "tone">;
const SLA_TONE: Record<SlaTone, string> = {
  ok: "bg-ljusgra-ton2 text-antracit",
  soon: "border-2 border-antracit bg-vit text-antracit",
  urgent: "border-2 border-rod bg-vit font-extrabold text-antracit [&_svg]:text-rod",
  over: "bg-antracit text-vit [&_svg]:text-rod",
  met: "bg-bla text-antracit",
};

/** SLA-klocka: "53 min kvar", "Försenad 2 tim", "I tid". dueAt ger tooltip med förfallotid. */
export function SlaBadge({ sla, dueAt, prefix }: { sla: SlaView; dueAt?: string | null; prefix?: string }) {
  const icon: IconName = sla.tone === "met" ? "check" : sla.tone === "over" ? "alert" : "clock";
  return (
    <span
      title={dueAt ? `Förfaller ${fmtDateTimeLong(dueAt)}` : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full py-[3px] pr-2.5 pl-[7px] text-small font-bold whitespace-nowrap tabular-nums portal:text-body [&_svg]:size-[15px]",
        SLA_TONE[sla.tone],
      )}
    >
      <Icon name={icon} />
      {prefix ? `${prefix} ` : ""}
      {sla.label}
    </span>
  );
}

// ---------------------------------------------------------------- Faser, AI och utvecklingsfas
/** Deltagarresan som stapel (fas n av total). */
export function PhaseBar({ phase, total = 5 }: { phase: number; total?: number }) {
  return (
    <div role="img" aria-label={`Fas ${phase} av ${total}`} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <div key={n} className={cn("h-2 rounded-[2px]", n < phase ? "bg-bla" : n === phase ? "bg-antracit" : "bg-ljusgra-ton2")} />
      ))}
    </div>
  );
}

/** "Fas 4 · Praktik/APL". name kommer från avtalskonfigurationen (phaseName). */
export function PhaseTag({ phase, name }: { phase: number; name: string }) {
  return (
    <Badge tone="outline">
      Fas {phase} · {name}
    </Badge>
  );
}

/** Markerar funktion som byggs i en senare utvecklingsfas enligt SPEC §12. */
export function BuildPhase({ fas }: { fas: number }) {
  return (
    <Badge tone="plan" icon="layers" title={`Byggs i utvecklingsfas ${fas} enligt SPEC §12`}>
      Byggs i fas {fas}
    </Badge>
  );
}

/** Märkning av AI-genererat innehåll. */
export function AiTag({ children = "AI-förslag" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[5px] rounded-[4px] bg-bla px-2 py-0.5 text-label font-extrabold tracking-[0.06em] whitespace-nowrap text-antracit uppercase [&_svg]:size-[13px]">
      <Icon name="sparkles" />
      {children}
    </span>
  );
}

/** Ruta för AI-förslag (blå kant, tonad yta). */
export function AiBox({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-2 rounded-mb border-[1.5px] border-bla bg-bla-ton px-3 py-2.5", className)}>{children}</div>;
}

/** Belägg för ett AI-förslag: citat och tidpunkt i inspelningen (sekunder). */
export function Evidence({ quote, t }: { quote: string; t?: number | null }) {
  return (
    <div className="flex flex-col gap-1 border-l-[3px] border-bla py-1 pl-2.5 text-small">
      <q className="italic">{quote}</q>
      {t != null && (
        <span className="font-bold tabular-nums">
          Tidpunkt {String(Math.floor(t / 60)).padStart(2, "0")}:{String(t % 60).padStart(2, "0")}
        </span>
      )}
    </div>
  );
}

/** Pågående inspelning (röd yta, vit blinkande punkt). */
export function RecIndicator({ children = "Spelar in" }: { children?: ReactNode }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 rounded-full bg-rod px-3 py-1.5 font-extrabold text-vit">
      <span aria-hidden="true" className="size-2.5 animate-blink rounded-full bg-vit" />
      {children}
    </span>
  );
}
