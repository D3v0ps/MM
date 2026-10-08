"use client";
// Delar som portalens skärmar använder (prototypens Head, OkLine, MoreBtn, KStatus och ReportRow i views/kommun.js).
// Portalen är skriven för ovana användare: 18 px text (portallayouten), korta meningar, hjälptext vid varje fält.
import type { ReactNode } from "react";
import type { ReportKind } from "@/data/schema";
import { path } from "@/shell/nav";
import { Badge, Button, Dot, Eyebrow, Icon, ListItem, cn, type IconName } from "@/ui";
import type { KomCase, KomReportRow } from "../api";
import { fD, fDT, statusLook } from "../texts";

/**
 * Innehållet på en portalsida (prototypens .kom): en kolumn med 24 px mellanrum. Knapparnas text radbryts på smala skärmar
 * (prototypens .kom .btn { white-space: normal }), så att inget går utanför skärmen.
 */
export function KomPage({ children, narrow, className }: { children?: ReactNode; narrow?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-6 [&_a]:max-w-full [&_a]:whitespace-normal [&_button:not([role=tab])]:max-w-full [&_button:not([role=tab])]:whitespace-normal",
        narrow && "mx-auto w-[min(580px,100%)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Flikarna radbryts under 480 px och visas utan ikoner (prototypens .kom .tabs). */
export const KOM_TABS = "max-[480px]:flex-wrap max-[480px]:overflow-x-visible max-[480px]:[&_[role=tab]]:p-2.5 max-[480px]:[&_svg]:hidden";

/** Sidhuvud: tillbaka, överrubrik, rubrik med röd punkt, ingress och knappar. */
export function KomHead({ eyebrow, title, lead, back, actions }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; back?: { label: string; to: string }; actions?: ReactNode }) {
  return (
    <header className="flex min-w-0 flex-col gap-2">
      {back && (
        <div className="-ml-3 self-start">
          <Button kind="ghost" icon="arrow-left" to={back.to}>
            {back.label}
          </Button>
        </div>
      )}
      {eyebrow && <Eyebrow className="portal:text-body">{eyebrow}</Eyebrow>}
      <h1 tabIndex={-1} data-page-title="" className="flex items-center gap-2.5 text-[clamp(1.375rem,4.8vw,1.75rem)] font-extrabold tracking-[0.03em] uppercase [overflow-wrap:anywhere]">
        <Dot className="size-2.5 flex-none" />
        {title}
      </h1>
      {lead && <p className="max-w-[62ch] text-text-muted">{lead}</p>}
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

/** Bekräftelse med bock ("Beställarreferensen har rätt format."). */
export function OkLine({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 text-portal font-bold">
      <Icon name="check-circle" className="mt-0.5 text-antracit" />
      <span>{children}</span>
    </div>
  );
}

/** "Visa fler (n till)" i kortets fot. */
export function MoreButton({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-t border-ljusgra px-5 py-3">
      <Button icon="chevron-down" onClick={onMore}>
        Visa fler ({total - shown} till)
      </Button>
    </div>
  );
}

/** Insatsens status som märke (text + ikon). */
export function KStatus({ c }: { c: Pick<KomCase, "status" | "firstMeetingAt"> }) {
  const s = statusLook(c);
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}

/** Rubrikrad med märken bredvid (radbryts på smal skärm). */
export function TitleRow({ children }: { children?: ReactNode }) {
  return <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">{children}</span>;
}

/** Underrad i en lista (samma storlek som ListItem sub). */
export function SubLine({ children }: { children?: ReactNode }) {
  return <span className="block text-small text-text-muted portal:text-portal">{children}</span>;
}

/**
 * Blå kant på olästa rader (Min veckas stil: nytt till dig är blått, rött bara för det som brådskar – beslut 2026-10-06).
 * Märket "Ny" säger detsamma i text.
 */
export const UNREAD_EDGE = "shadow-[inset_4px_0_0_var(--color-bla)]";

/** Stor ikon först på en rad i portalens listor. */
export const LeadIcon = ({ name }: { name: IconName }) => <Icon name={name} size="lg" className="mt-0.5 flex-none" />;

export const KIND_ICON: Partial<Record<ReportKind, IconName>> = {
  weekly_attendance: "check-square",
  monthly: "file",
  final: "award",
  order_confirmation: "check-circle",
  customer_summary: "chart",
};

/**
 * Rapportsidan i portalen. fran = sidan som länkade hit (tillbakaknappen). extra = listans val eller månaden, som
 * tillbakaknappen tar med sig (lista=filter=monthly&visa=30, manad=2026-10) – bara koder och siffror.
 */
export const reportPath = (id: string, fran: "start" | "rapporter" | "deltagare", extra?: { lista?: string | null; manad?: string | null }) =>
  path(`/portal/rapporter/${encodeURIComponent(id)}`, { fran, lista: extra?.lista || null, manad: extra?.manad || null });

/** En levererad rapport i en lista. Olästa har blå kant och märket "Ny". lista = listans val (för tillbakaknappen). */
export function ReportRowItem({ r, from, showSub = true, lista }: { r: KomReportRow; from: "start" | "rapporter" | "deltagare"; showSub?: boolean; lista?: string }) {
  return (
    <ListItem
      to={reportPath(r.id, from, { lista })}
      className={r.unread ? UNREAD_EDGE : undefined}
      lead={<LeadIcon name={KIND_ICON[r.kind] ?? "file"} />}
      chevron
      title={
        <TitleRow>
          <span>{r.title}</span>
          {r.unread && <Badge tone="dark">Ny</Badge>}
          {r.correcting && (
            <Badge tone="outline" icon="edit">
              Rättas – en ny version kommer
            </Badge>
          )}
        </TitleRow>
      }
      sub={showSub ? r.sub : undefined}
    >
      <SubLine>
        Levererad {fDT(r.deliveredAt)}
        {r.version > 1 ? ` · version ${r.version}` : ""}
        {!r.unread && r.openedAt ? ` · läst ${fD(r.openedAt)}` : ""}
      </SubLine>
    </ListItem>
  );
}
