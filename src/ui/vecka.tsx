"use client";
// Min veckas kit (beslut 2026-10-06): alla MB-roller har en Min vecka i coachens stil – samma sidhuvud, nyckeltalsrad,
// avsnitt och högerkolumn, men med rollens egna uppgifter. Delarna kommer från coachens Min vecka
// (src/features/coach/screens/min-vecka.tsx) utan ändring i markup eller klasser. Stilreglerna: src/ui/README.md.
import type { ReactNode } from "react";
import { ROLE_LABEL, type Role } from "@/api/roles";
import { fmtDateTimeLong, fmtWeekday, isoWeek, type LocalDate } from "@/core/time";
import { Link } from "@/shell/nav";
import { useSession } from "@/shell/session";
import type { SlaView } from "./badge";
import { CaseLink } from "./case";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";
import { Grid } from "./layout";
import { Page } from "./page";

/** Nyckeltalen på smal skärm (prototypens co-kpis): mindre utfyllnad och siffror så att "4 av 15" får plats. */
export const WEEK_KPI_SM = "max-[620px]:p-3 max-[620px]:[&>div:nth-child(2)]:text-[1.625rem]";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Ingressen: "Måndag 1 februari · vecka 5. Det här behöver du göra i dag och under veckan – det mest brådskande överst." */
export function weekLead(today: LocalDate | null): string {
  const rest = "Det här behöver du göra i dag och under veckan – det mest brådskande överst.";
  return today ? `${cap(fmtWeekday(today))} · vecka ${isoWeek(today).week}. ${rest}` : rest;
}

/**
 * Ögonbrynet "Namn · Titel". Rollens etikett (samma som i sidopanelen) i stället för titeln när titeln saknas, när titeln
 * själv är ett rollnamn (t.ex. "Systemadministratör" på alla) eller när kollegan har flera roller – då säger titeln inte
 * vilken roll sidan visas i.
 */
export function weekEyebrow(user: { name: string; title?: string | null }, role: Role, ownRoles?: readonly Role[] | null): string | undefined {
  if (!user.name) return undefined;
  const title = (user.title ?? "").trim();
  const isRoleName = Object.values(ROLE_LABEL).some((l) => l.toLowerCase() === title.toLowerCase());
  const useRole = (ownRoles?.length ?? 0) > 1 || !title || isRoleName;
  return `${user.name} · ${useRole ? ROLE_LABEL[role] : title}`;
}

/**
 * Sidan Min vecka: rubriken MIN VECKA, ögonbrynet "Namn · Titel" (weekEyebrow), veckoingressen och en primär knapp (actions).
 * today = dagens datum (demoklockan i prototypen och minnesläget); null medan klockan hämtas.
 */
export function WeekPage({ today, actions, className, children }: { today: LocalDate | null; actions?: ReactNode; className?: string; children?: ReactNode }) {
  const { user, actor, ownRoles } = useSession();
  return (
    <Page title="Min vecka" eyebrow={weekEyebrow(user, actor.role, ownRoles)} lead={weekLead(today)} actions={actions} className={className}>
      {children}
    </Page>
  );
}

/** Nyckeltalsraden: fyra rutor, två kolumner på smal skärm. */
export function WeekKpis({ children }: { children?: ReactNode }) {
  return <Grid cols={4} className="max-[620px]:grid-cols-2 max-[620px]:gap-2.5">{children}</Grid>;
}

/** Ärendenumret efter namnet (liten, dämpad, bryts inte). */
export function CaseNo({ n }: { n: string }) {
  return <span className="text-small font-normal whitespace-nowrap text-text-muted tabular-nums tracking-[0.01em]">{n}</span>;
}

/** Namnet och ärendenumret som länk till deltagarkortet. */
export function CaseName({ caseId, name, caseNumber }: { caseId: string; name: string; caseNumber: string }) {
  return (
    <CaseLink caseId={caseId} caseNumber={caseNumber} className="-ml-1.5 gap-1.5 [&_span]:no-underline">
      {name} <CaseNo n={caseNumber} />
    </CaseLink>
  );
}

/**
 * Radens rubrik som länk (Min veckas listrader: länkad rubrik i stället för en Öppna-knapp). 44 px klickyta, understruken,
 * fet. Utan to: samma rubrik som text.
 */
export function TitleLink({ to, children, className }: { to?: string | null; children: ReactNode; className?: string }) {
  if (!to) return <span className={cn("font-bold [overflow-wrap:anywhere]", className)}>{children}</span>;
  return (
    <Link
      to={to}
      className={cn(
        "-ml-1.5 inline-flex min-h-11 items-center rounded-mb px-1.5 py-0.5 font-bold text-antracit underline underline-offset-3 [overflow-wrap:anywhere] hover:bg-antracit-ton",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Ett avsnitt utan något att göra: en rad i stället för ett helt kort (rubriken finns kvar och kan ta emot fokus). */
export function DoneLine({ id, title, icon, children }: { id?: string; title: string; icon: IconName; children: ReactNode }) {
  return (
    <section id={id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-ljusgra bg-vit px-[18px] py-3">
      <h2 id={id ? `${id}-rubrik` : undefined} tabIndex={-1} className="flex items-center gap-2 text-label font-extrabold tracking-[0.1em] uppercase">
        <Icon name={icon} />
        {title}
      </h2>
      <span className="inline-flex min-w-0 items-start gap-1.5 text-small text-text-muted">
        <Icon name="check-circle" className="mt-0.5 flex-none" />
        <span>{children}</span>
      </span>
    </section>
  );
}

/** Förfallotiden som text (ser inte ut som en knapp): "Senast måndag 10.00 · 48 min kvar". */
export function SlaText({ sla, dueAt, dueText }: { sla: SlaView; dueAt: string; dueText: string }) {
  const late = sla.tone === "over";
  return (
    <span title={`Förfaller ${fmtDateTimeLong(dueAt)}`} className="inline-flex items-center gap-1.5 text-small font-bold">
      <Icon name={late ? "alert" : "clock"} className={sla.tone === "urgent" || late ? "text-rod" : undefined} />
      Senast {dueText} · {sla.label.toLowerCase()}
    </span>
  );
}
