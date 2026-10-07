"use client";
// Delade delar för skärmarna i området inkorg: perspektivlänkar (bara prototypen), rader och små märken.
import type { ReactNode } from "react";
import type { Role } from "@/api/roles";
import { useCommand } from "@/shell/backend";
import { useRuntime } from "@/shell/runtime";
import { useSession } from "@/shell/session";
import { Badge, cn, Icon, MaskedPnr, PerspectiveLink, type IconName } from "@/ui";
import { inboxRevealPnr, type FieldNote, type FormField, type PnrView } from "../api";

/** Sant i prototypen (perspektivlänkar och förklaringar visas bara där). */
export const useIsDemo = (): boolean => useRuntime() === "demo";

/** Testpersonen som visas för en roll i prototypen (t.ex. Maria Ekdahl för kommunens handläggare). */
export function usePersona(role: Role): { userId: string; name: string } | null {
  const s = useSession();
  const p = s.personas?.find((x) => x.role === role && x.isDefaultForRole) ?? s.personas?.find((x) => x.role === role);
  return p ? { userId: p.userId, name: p.name } : null;
}

/**
 * Perspektivbyte till kommunen (bara prototypen): beställande handläggare om det är testpersonen (Maria), annars kommunens chef.
 */
export function KommunSwitch({ c, label = "Se vad kommunen fick" }: { c: { id: string; referrerId: string | null } | null; label?: string }) {
  const maria = usePersona("kommun_handlaggare");
  const eva = usePersona("kommun_chef");
  if (!c) return null;
  const to = `/portal/deltagare/${encodeURIComponent(c.id)}`;
  return maria && c.referrerId === maria.userId
    ? <PerspectiveLink role="kommun_handlaggare" userId={maria.userId} to={to} label={label} />
    : <PerspectiveLink role="kommun_chef" userId={eva?.userId} to={to} label={`${label} (kommunens chef)`} />;
}

/** Knappar som får brytas (perspektivlänkar med lång text). */
export const WrapBtns = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5 [&_a]:max-w-full [&_a]:text-left [&_a]:whitespace-normal [&_button]:max-w-full [&_button]:text-left [&_button]:whitespace-normal", className)}>
    {children}
  </div>
);

/** Rad med ikon och text (prototypens row-sm med align-items: flex-start). */
export const IconLine = ({ icon, children, className }: { icon: IconName; children?: ReactNode; className?: string }) => (
  <div className={cn("flex items-start gap-1.5", className)}>
    <Icon name={icon} className="mt-0.5 flex-none" />
    <span className="min-w-0">{children}</span>
  </div>
);

/** Citat (utskick, svar). */
export const Quote = ({ children }: { children?: ReactNode }) => (
  <blockquote className="m-0 rounded-r-mb border-l-[3px] border-antracit bg-ljusgra-ton px-3.5 py-2.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{children}</blockquote>
);

/** Versal etikett (prototypens label-caps). */
export const Caps = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <span className={cn("text-label font-bold tracking-[0.09em] text-text-muted uppercase", className)}>{children}</span>
);

/**
 * Rad i ett kort på startsidan: märke till vänster, text i mitten och knapp till höger (prototypens ink-mini-row).
 * Smalt kort: märket ovanför texten.
 */
export function MiniRow({ left, main, sub, right }: { left?: ReactNode; main: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-ljusgra px-[18px] py-3 [grid-template-areas:'l_r''m_r'] last:border-b-0",
        "@min-[560px]:grid-cols-[minmax(170px,max-content)_minmax(0,1fr)_auto] @min-[560px]:[grid-template-areas:'l_m_r']",
      )}
      data-mini-row=""
    >
      {left && (
        <div className="min-w-0 justify-self-start [grid-area:l]" data-mini-left="">
          {left}
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-0.5 [grid-area:m]" data-mini-main="">
        <span className="font-bold [overflow-wrap:anywhere]">{main}</span>
        {sub && <span className="text-small text-text-muted [overflow-wrap:anywhere]">{sub}</span>}
      </div>
      <div className="[grid-area:r]">{right}</div>
    </div>
  );
}
/** Behållare för MiniRow (kortets bredd styr uppställningen). */
export const MiniList = ({ children }: { children?: ReactNode }) => <div className="@container flex flex-col">{children}</div>;

/** Märkningen "Ej fastställd med Botkyrka". */
export const ProvBadge = () => (
  <Badge tone="outline" icon="help" title="Regeln är ett förslag i avtalskonfigurationen och ska fastställas med Botkyrka.">
    Ej fastställd med Botkyrka
  </Badge>
);

/** Maskerat personnummer med "Visa" (tyst kommando som loggar visningen). */
export function Pnr({ v }: { v: PnrView }) {
  const reveal = useCommand(inboxRevealPnr);
  return (
    <MaskedPnr
      masked={v.masked}
      hidden={v.hidden}
      onReveal={v.caseId ? async () => {
        const r = await reveal.run({ caseId: v.caseId ?? undefined });
        return r.ok ? r.text : null;
      } : undefined}
    />
  );
}

function Note({ n }: { n: FieldNote | null }) {
  if (!n) return null;
  switch (n.kind) {
    case "missing":
      return <Badge tone="red" icon="alert">Saknas</Badge>;
    case "corrected":
    case "checked":
      return <Badge tone="bluetone" icon="check" title={n.title}>{n.kind === "corrected" ? "Rättad" : "Kontrollerad"}</Badge>;
    case "supplement":
      return <Badge tone="bluetone" icon="link" title={n.title}>Från komplettering</Badge>;
    case "low":
      return <Badge tone="grey" icon="alert-circle">Osäker {n.pct}</Badge>;
    case "pct":
      return <span className="text-small text-text-muted">{n.pct}</span>;
  }
}

/** En rad i det tolkade formuläret: etikett, värde och status (saknas, osäker, rättad …). */
export function FieldRow({ f }: { f: FormField }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-ljusgra px-[18px] py-2 last:border-b-0",
        "@min-[520px]:grid-cols-[190px_minmax(0,1fr)_auto]",
        f.state === "missing" && "bg-rod-ton shadow-[inset_4px_0_0_var(--color-rod)]",
        f.state === "low" && "bg-ljusgra-ton",
      )}
    >
      <div className="col-span-full text-small font-semibold text-text-muted @min-[520px]:col-span-1">{f.label}</div>
      <div className="min-w-0 [overflow-wrap:anywhere]">
        {f.pnr ? <Pnr v={f.pnr} /> : f.value != null ? f.value : f.state === "missing" ? <span className="font-bold">Saknas</span> : <span className="text-text-muted">Framgår inte</span>}
      </div>
      <div className="justify-self-end">
        <Note n={f.note} />
      </div>
    </div>
  );
}

/** Grupprubrik i formuläret ("1. Beställning och kontakt"). */
export const GroupTitle = ({ children }: { children?: ReactNode }) => (
  <div className="px-[18px] pt-3.5 pb-1.5 text-label font-extrabold tracking-[0.1em] uppercase">{children}</div>
);

/** Förklaringsraden överst i formuläret. */
export const Legend = ({ children }: { children?: ReactNode }) => (
  <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 border-b border-ljusgra px-[18px] py-3 text-small text-text-muted">{children}</div>
);
