"use client";
// Små delar som rapportlistan, rapportsidan och kommunportalen delar: statusmärket, "Sista dag ej fastställd",
// mejlnotisen och perspektivbytet (bara prototypen).
import type { ReactNode } from "react";
import type { Role } from "@/api/roles";
import { useSession } from "@/shell/session";
import { Badge, Icon, PerspectiveLink } from "@/ui";
import type { ReportStatus } from "../api";
import { NO_DUE, statusLook } from "../report-helpers";

/** Rapportens status som märke (text + ikon). eff = status där levererad och öppnad är "opened". */
export function ReportStatusBadge({ eff, label }: { eff: ReportStatus; label: string }) {
  const [tone, icon] = statusLook({ status: eff });
  return (
    <Badge tone={tone} icon={icon}>
      {label}
    </Badge>
  );
}

/** Märket "Sista dag ej fastställd" med förklaringen som verktygstips. */
export const ProvisionalBadge = ({ text }: { text: string | null }) =>
  text ? (
    <Badge tone="outline" icon="help" title={text}>
      {NO_DUE}
    </Badge>
  ) : null;

/** Liten rad "Sista dag ej fastställd" (listan). */
export const ProvisionalNote = ({ text }: { text: string | null }) =>
  text ? (
    <span className="inline-flex items-center gap-1 text-small whitespace-nowrap text-text-muted" title={text}>
      <Icon name="help" />
      {NO_DUE}
    </span>
  ) : null;

/** Ruta som visar vad ett mejl innehåller (heldragen ram – det är inte en prototypförklaring). */
export function MailNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-mb border-[1.5px] border-line-strong bg-vit px-3 py-2.5 text-small text-text-muted">
      <Icon name="mail" className="mt-px" />
      <div>{children}</div>
    </div>
  );
}

/** Testpersonen som är förvald för rollen i prototypen (null utanför prototypen). */
export function useDefaultPersona(role: Role): string | null {
  const s = useSession();
  return s.personas?.find((p) => p.role === role && p.isDefaultForRole)?.userId ?? s.personas?.find((p) => p.role === role)?.userId ?? null;
}

/**
 * "Se som kommunen" (bara prototypen): byter till handläggaren som rapporten går till (mottagaren) och öppnar kommun-
 * portalens rapportsida. Rapporter utan mottagare i portalen (beställarrapporten) har ingen knapp.
 */
export function CustomerPerspective({ recipientId, reportId, label }: { recipientId: string | null; reportId: string; label: string }) {
  if (!recipientId) return null;
  return <PerspectiveLink role="kommun_handlaggare" userId={recipientId} to={`/portal/rapporter/${encodeURIComponent(reportId)}`} label={label} />;
}
