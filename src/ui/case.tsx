"use client";
// Ärendelänk, maskerat personnummer, perspektivbyte (bara prototypen) och visningslogg.
// Ingen dataåtkomst här – skärmen skickar in värden och callbacks.
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { isCustomerRole, perspectiveOf, type Role } from "@/api/roles";
import { Link, useNav } from "@/shell/nav";
import { useRuntime } from "@/shell/runtime";
import { useSession } from "@/shell/session";
import { Button } from "./button";
import { cn } from "./cn";
import { toast } from "./toast";

/** Sökväg till ärendet för en roll: kommunen → portalen, ekonom → ekonomivyn, övriga → ärendekortet. Deltagaren: ingen. */
export function casePathFor(role: Role, caseId: string): string | null {
  const id = encodeURIComponent(caseId);
  if (isCustomerRole(role)) return `/portal/deltagare/${id}`;
  if (role === "ekonom") return `/ekonomi/arende/${id}`;
  if (role === "deltagare") return null;
  return `/arenden/${id}`;
}

/** Ärendenumret som länk till rätt vy för rollen. canOpen=false visar bara numret. Klick bubblar inte till tabellraden. */
export function CaseLink({ caseId, caseNumber, children, canOpen = true, className }: { caseId: string; caseNumber: string; children?: ReactNode; canOpen?: boolean; className?: string }) {
  const { actor } = useSession();
  const to = canOpen ? casePathFor(actor.role, caseId) : null;
  if (!to) return <span className={cn("font-bold tabular-nums tracking-[0.01em]", className)}>{children ?? caseNumber}</span>;
  return (
    <Link
      to={to}
      onClick={(e: MouseEvent) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex min-h-11 items-center rounded-mb px-1.5 py-0.5 font-bold text-antracit tabular-nums underline underline-offset-3 hover:bg-antracit-ton",
        className,
      )}
    >
      {children ?? caseNumber}
    </Link>
  );
}

/**
 * Maskerat personnummer. masked = t.ex. "••••••••-1234" (från vy-modellen). onReveal hämtar hela numret via ett
 * kommando som loggar visningen i revisionsloggen. hidden = rollen får inte se numret (skyddade, ekonom).
 */
export function MaskedPnr({ masked, onReveal, hidden }: { masked: string | null | undefined; onReveal?: () => Promise<string | null | undefined>; hidden?: boolean }) {
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (hidden) return <span className="text-text-muted">Visas inte för din roll</span>;
  if (!masked) return <span className="text-text-muted">–</span>;
  const reveal = async () => {
    if (!onReveal) return;
    setBusy(true);
    try {
      const v = await onReveal();
      if (v) setShown(v);
      else toast("Personnumret kunde inte visas.", "error");
    } catch {
      toast("Personnumret kunde inte visas.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="tabular-nums tracking-[0.01em]">{shown ?? masked}</span>
      {shown ? (
        <span className="text-small text-text-muted">(visning loggad)</span>
      ) : (
        onReveal && (
          <Button kind="ghost" icon="eye" className="min-h-11 px-2 py-1" pending={busy} onClick={() => void reveal()}>
            Visa
          </Button>
        )
      )}
    </span>
  );
}

/**
 * Bara i prototypen: byt roll och visa samma sak från andra sidan (leverantör ↔ kund).
 * role = rollen att byta till, userId = testperson (valfritt), to = sökväg som ska visas efter bytet.
 */
export function PerspectiveLink({ role, userId, to, label }: { role: Role; userId?: string; to: string; label?: string }) {
  const runtime = useRuntime();
  const session = useSession();
  const nav = useNav();
  if (runtime !== "demo" || !session.switchRole) return null;
  const toCustomer = perspectiveOf(role) === "kund";
  return (
    <Button
      kind="secondary"
      icon="refresh"
      className="border-dashed"
      title="Prototypfunktion – finns inte i den riktiga tjänsten"
      onClick={() => {
        session.switchRole?.(role, userId);
        nav.push(to);
      }}
    >
      {label ?? (toCustomer ? "Se samma sak från kundens håll" : "Se samma sak från leverantörens håll")}
    </Button>
  );
}

const seen = new Set<string>();

/**
 * Loggar en visning en gång per sidladdning och användare (deltagarkort, rapport, transkript).
 * key = t.ex. `case.view:${caseId}` (null = logga inte ännu). log = anropa ett tyst kommando som skriver revisionsloggen.
 */
export function useAuditView(key: string | null | undefined, log: () => unknown) {
  const { actor } = useSession();
  const logRef = useRef(log);
  useEffect(() => {
    logRef.current = log;
  });
  useEffect(() => {
    if (!key) return;
    const k = `${actor.userId}|${actor.role}|${key}`;
    if (seen.has(k)) return;
    seen.add(k);
    void logRef.current();
  }, [key, actor.userId, actor.role]);
}
