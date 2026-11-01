"use client";
// Min veckas kit (beslut 2026-10-06): alla MB-roller har en Min vecka i coachens stil – samma sidhuvud, nyckeltalsrad,
// avsnitt och högerkolumn, men med rollens egna uppgifter. Delarna kommer från coachens Min vecka
// (src/features/coach/screens/min-vecka.tsx) utan ändring i markup eller klasser. Stilreglerna: src/ui/README.md.
import { useId, useState, type ReactNode } from "react";
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

/** Ärendenumret efter namnet (dämpad, bryts inte). big = 16 px (att göra-listan: metarader minst 16 px). */
export function CaseNo({ n, big }: { n: string; big?: boolean }) {
  return <span className={cn("font-normal whitespace-nowrap text-text-muted tabular-nums tracking-[0.01em]", big ? "text-body" : "text-small")}>{n}</span>;
}

/** Namnet och ärendenumret som länk till deltagarkortet. */
export function CaseName({ caseId, name, caseNumber, big }: { caseId: string; name: string; caseNumber: string; big?: boolean }) {
  return (
    <CaseLink caseId={caseId} caseNumber={caseNumber} className="-ml-1.5 gap-1.5 [&_span]:no-underline">
      {name} <CaseNo n={caseNumber} big={big} />
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

// ---------------------------------------------------------------- Att göra-listan (paket 2, UX-genomgången 2026-10-31)
/**
 * Statusen under tiden i en att göra-rad – alltid text och ikon, aldrig bara färg. late = försenad (röd varningsikon),
 * urgent = brådskar (röd klocka), soon/plain = klocka, next = nästa möte, done = klart.
 */
export type TodoStatus = { text: string; tone: "late" | "urgent" | "soon" | "next" | "done" | "plain" };

const STATUS_ICON: Record<TodoStatus["tone"], IconName> = { late: "alert", urgent: "clock", soon: "clock", next: "arrow-right", done: "check-circle", plain: "clock" };

/** En rad i att göra-listan. Ordningen och sammanslagningen räknas med todoRows (src/core/todo.ts) – kitet har ingen klocka. */
export type TodoItem = {
  key: string;
  /** Tiden i vänsterkolumnen: "10.00" (dagens möte) eller "i dag kl. 10.00" (sista tid). Utan: tom kolumn. */
  when?: ReactNode;
  /** Statusen under tiden (text + ikon). */
  status?: TodoStatus | null;
  icon?: IconName;
  /** Rubriken (fet). Ofta CaseName eller en TitleLink. */
  title: ReactNode;
  /** Anmärkningar under rubriken (16 px): vad, varför, sammanslagna saker i samma ärende. */
  notes?: ReactNode[];
  /** Radens åtgärd – en knapp (Min veckas regel: högst en knapp per rad) eller en textlänk. */
  action?: ReactNode;
  /** Extra innehåll under anmärkningarna (t.ex. ett kvitteringsformulär eller en utfällbar lista). */
  children?: ReactNode;
  /** Röd vänsterkant – nästa möte. */
  marked?: boolean;
  /** Passerat och klart: grå yta. */
  muted?: boolean;
  /** id på raden (fokus efter en åtgärd) och data-testid. */
  id?: string;
  testId?: string;
};

function TodoStatusText({ s }: { s: TodoStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-body", (s.tone === "late" || s.tone === "urgent" || s.tone === "next") && "font-bold")}>
      <Icon name={STATUS_ICON[s.tone]} className={cn("flex-none", (s.tone === "late" || s.tone === "urgent") && "text-rod")} />
      {s.text}
    </span>
  );
}

function TodoRowView({ it, timed }: { it: TodoItem; timed: boolean }) {
  return (
    <li
      id={it.id}
      tabIndex={it.id ? -1 : undefined}
      data-testid={it.testId}
      className={cn(
        "flex min-w-0 flex-wrap items-start gap-x-4 gap-y-1.5 border-b border-ljusgra px-[18px] py-3 last:border-b-0",
        it.muted && "bg-ljusgra-ton",
        it.marked && "shadow-[inset_4px_0_0_var(--color-rod)]",
      )}
    >
      {timed && (
        <div className="flex w-[148px] flex-none flex-col gap-0.5 pt-2.5 text-body max-[620px]:w-full max-[620px]:flex-row max-[620px]:flex-wrap max-[620px]:gap-x-3 max-[620px]:pt-0">
          {it.when ? <span className="font-bold tabular-nums">{it.when}</span> : null}
          {it.status && <TodoStatusText s={it.status} />}
        </div>
      )}
      {/* Innehållet minst 18rem: i en smal kolumn hamnar knappen under texten i stället för att trycka ihop den. */}
      <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-0.5">
        <div className="flex min-h-11 min-w-0 items-center gap-2 font-bold">
          {it.icon && <Icon name={it.icon} className="flex-none" />}
          <span className="min-w-0 [overflow-wrap:anywhere]">{it.title}</span>
        </div>
        {it.notes?.map((n, i) => (
          <div key={i} className="text-body text-text-muted [overflow-wrap:anywhere]">
            {n}
          </div>
        ))}
        {it.children}
      </div>
      {it.action && <div className="flex flex-none flex-wrap items-center gap-2 self-center max-[620px]:w-full">{it.action}</div>}
    </li>
  );
}

/**
 * Att göra-listan – samma för alla MB-roller (paket 2): en rad per sak, sorterad på sista tid, varje sak en gång med sin
 * knapp. Skärmen sorterar och slår ihop med todoRows (src/core/todo.ts) och skickar färdiga rader. summary = t.ex.
 * "8 saker · 1 försenad" i kortets huvud. initial = visa de första raderna och knappen "Visa alla N". Tom lista: DoneLine med empty.
 */
export function TodoList({
  id, title, icon = "check-square", summary, items, empty, foot, initial,
}: {
  id?: string;
  title: string;
  icon?: IconName;
  summary?: ReactNode;
  items: readonly TodoItem[];
  empty?: ReactNode;
  foot?: ReactNode;
  initial?: number;
}) {
  const [all, setAll] = useState(false);
  const listId = useId();
  if (items.length === 0) {
    return (
      <DoneLine id={id} title={title} icon={icon}>
        {empty ?? "Inget att göra just nu."}
      </DoneLine>
    );
  }
  const shown = !initial || all ? items : items.slice(0, initial);
  const timed = items.some((x) => x.when || x.status);
  return (
    <section id={id} data-todo="" className="min-w-0 rounded-card border border-ljusgra bg-vit">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ljusgra px-[18px] py-3.5">
        <h2 id={id ? `${id}-rubrik` : undefined} tabIndex={id ? -1 : undefined} className="flex items-center gap-2 text-label font-extrabold tracking-[0.1em] uppercase">
          <Icon name={icon} />
          {title}
        </h2>
        <span className="flex-1" />
        {summary && <span className="text-body text-text-muted">{summary}</span>}
      </div>
      <ol id={listId} aria-label={title} className="m-0 flex list-none flex-col p-0">
        {shown.map((it) => (
          <TodoRowView key={it.key} it={it} timed={timed} />
        ))}
      </ol>
      {(foot || (initial && items.length > initial)) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-ljusgra px-[18px] py-2">
          {initial && items.length > initial ? (
            <button
              type="button"
              aria-expanded={all}
              aria-controls={listId}
              onClick={() => setAll(!all)}
              className="-ml-1.5 inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-mb px-1.5 text-body font-bold text-antracit underline underline-offset-3 hover:bg-antracit-ton"
            >
              <Icon name={all ? "chevron-up" : "chevron-down"} />
              {all ? "Visa färre" : `Visa alla ${items.length}`}
            </button>
          ) : null}
          {foot && <span className="text-body text-text-muted">{foot}</span>}
        </div>
      )}
    </section>
  );
}

/** Ett avsnitt som är stängt från början: knappen "Visa …" fäller ut innehållet (t.ex. veckokalendern bakom "Visa hela veckan"). */
export function WeekMore({ id, label, hideLabel, icon = "calendar", children }: { id?: string; label: string; hideLabel?: string; icon?: IconName; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <section id={id} className="flex min-w-0 flex-col gap-3">
      <div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen(!open)}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-mb border-2 border-antracit bg-vit px-4 py-2.5 text-ui font-bold text-antracit hover:bg-antracit-ton"
        >
          <Icon name={icon} />
          {open ? (hideLabel ?? "Dölj") : label}
          <Icon name={open ? "chevron-up" : "chevron-down"} />
        </button>
      </div>
      <div id={panel} hidden={!open}>
        {open ? children : null}
      </div>
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
