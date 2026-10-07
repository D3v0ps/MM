"use client";
// Gemensamt för skärmarna i området ärenden (prototypens hjälpare i views/arenden.js): texter, märken, faktarutnät,
// tabell som blir lista på smala kort och vilka sidor rollen får öppna.
import type { ReactNode } from "react";
import { path, useNav } from "@/shell/nav";
import type { Role } from "@/api/roles";
import { fmtDate, fmtDateShort, fmtTime, fmtWeekday, weekday, WEEKDAYS_SHORT } from "@/core/time";
import { Badge, cn, ErrorNotice, Icon, Loading, Notice, Refreshing, Table, type BadgeTone, type IconName, type TableProps } from "@/ui";
import type { AttendanceSummary, CaseFlag } from "../api";

// ---------------------------------------------------------------- Texter
export const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
export const clip = (s: string | null | undefined, n = 90) => (!s ? "" : s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const withDot = (s: string) => (/[.!?]$/.test(String(s).trim()) ? String(s).trim() : `${String(s).trim()}.`);
/** Datum utan år om det är innevarande år. */
export const fd = (s: string | null | undefined, today: string) => (!s ? "–" : String(s).slice(0, 4) === today.slice(0, 4) ? fmtDateShort(s) : fmtDate(s));
/** Personnummer i fritext (stoppas i meddelanden och avvikelser – använd ärendenumret). */
export const PNR_RE = /\b(\d{6}|\d{8})[-+]?\d{4}\b/;
export const PNR_ERROR = "Ta bort personnumret. Använd ärendenumret i stället.";
export const pct0 = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "–" : `${(v * 100).toFixed(0)} %`);
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const GOAL: Record<string, string> = { yes: "Ja", partly: "Delvis", no: "Nej" };
export const MODE: Record<string, string> = { fysiskt: "Fysiskt möte", telefon: "Telefon", video: "Video" };
export const PLACEMENT: Record<string, string> = { ongoing: "Pågår", completed: "Avslutad", planned: "Planerad" };
const KIND: Record<string, [IconName, string]> = {
  möte: ["users", "Coachmöte"], yrkesmoment: ["tool", "Yrkesmoment"], praktikdag: ["briefcase", "Praktikdag"], arbetsgivarbesök: ["building", "Arbetsgivarbesök"], annat: ["circle", "Annat"],
};
export const actLabel = (kind: string) => (KIND[kind] ?? KIND.annat)[1];
export const actIcon = (kind: string): IconName => (KIND[kind] ?? KIND.annat)[0];
/** De fyra rätten för en praktikplats. */
export const FOUR: [key: "uppgift" | "handledning" | "timing" | "uppfoljning", label: string, help: string][] = [
  ["uppgift", "Arbetsuppgifter", "Kopplade till yrkesspåret."],
  ["handledning", "Handledning", "Handledare hos arbetsgivaren med mål och ansvar."],
  ["timing", "Tidpunkt", "Rätt tidpunkt: coachen bedömer att deltagaren är redo för krav, tempo och rutiner."],
  ["uppfoljning", "Uppföljning", "Planerade datum. Återkopplingen dokumenteras och leder till nästa steg."],
];

// ---------------------------------------------------------------- Vilka sidor rollen får öppna (rutternas roller)
const OPENS: Record<string, readonly Role[]> = {
  "sam.inkorg": ["samordnare", "avtalsansvarig"],
  "coach.avstamning": ["coach"],
  "coach.manad": ["coach"],
  "coach.kartlaggning": ["coach"],
  "coach.handelse": ["coach"],
  "coach.narvaro": ["coach", "handledare"],
  "rapport.visa": ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "kommun_handlaggare", "kommun_chef"],
  "praktik.arbetsgivare": ["samordnare", "avtalsansvarig", "coach", "handledare"],
  "arende.kort": ["samordnare", "avtalsansvarig", "coach", "handledare", "chef", "admin"],
  "chef.oversikt": ["chef"],
  "chef.avvikelser": ["chef", "avtalsansvarig", "samordnare"],
};
/** Får rollen öppna vyn (prototypens canOpen)? */
export const canOpen = (view: string, role: Role) => (OPENS[view] ?? []).includes(role);

// ---------------------------------------------------------------- Märken
const ATT: Record<string, [BadgeTone, IconName, string]> = {
  present: ["blue", "check", "Närvarande"], late: ["bluetone", "clock", "Sen"], absent_valid: ["grey", "minus-circle", "Giltig frånvaro"],
  absent_invalid: ["red", "x-circle", "Ogiltig frånvaro"], none: ["outline", "help", "Saknar registrering"],
};
export function AttBadge({ status }: { status: string | null | undefined }) {
  const [tone, icon, label] = ATT[status ?? "none"] ?? ATT.none;
  return <Badge tone={tone} icon={icon}>{label}</Badge>;
}

const FLAG: Record<string, [IconName, string]> = {
  stuck: ["clock", "Fastnat"], absence: ["x-circle", "Upprepad frånvaro"], first_meeting: ["calendar", "Möte ej bokat"], no_progress: ["bell", "Ingen progression"],
  no_progress_escalated: ["flag", "Eskalerad"], report_overdue: ["file", "Rapport försenad"], unbilled: ["card", "Ofakturerat"], pulse_contact: ["phone", "Vill bli kontaktad"], ai_draft: ["sparkles", "AI-utkast"],
};
export const SEV: Record<string, { tone: BadgeTone; label: string; icon: IconName }> = {
  critical: { tone: "red", label: "Kritisk", icon: "alert" }, warning: { tone: "grey", label: "Varning", icon: "alert-circle" }, info: { tone: "outline", label: "Information", icon: "info" },
};
/** Flaggor som små märken (ärendelistan). */
export function FlagBadges({ list, className }: { list: readonly CaseFlag[] | null | undefined; className?: string }) {
  if (!list || !list.length) return <span className="text-small text-text-muted">–</span>;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {list.map((a) => {
        const f = FLAG[a.kind] ?? (["flag", a.title] as [IconName, string]);
        const s = SEV[a.severity] ?? SEV.info;
        return (
          <Badge key={a.key} tone={s.tone} icon={f[0]} title={`${s.label}: ${a.title}`} className="px-[7px] py-0.5">
            {f[1]}
          </Badge>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Layout
/** Faktarutnät: etikett ovanför värdet (prototypens Facts). */
export function Facts({ items }: { items: readonly ([string, ReactNode] | null | false)[] }) {
  return (
    <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(min(100%,190px),1fr))] gap-x-5 gap-y-3.5 max-[620px]:grid-cols-2 max-[620px]:gap-x-3.5 max-[620px]:gap-y-3">
      {items
        .filter((x): x is [string, ReactNode] => !!x)
        .map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-meta leading-[1.3] font-semibold text-text-muted">{k}</dt>
            <dd className="m-0 mt-[3px] min-w-0 leading-[1.4] [overflow-wrap:anywhere] hyphens-auto">{v == null || v === "" ? "–" : v}</dd>
          </div>
        ))}
    </dl>
  );
}

/** Versal etikett i ett kort (prototypens arn-label). */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-2 text-label font-extrabold tracking-[0.1em] text-text-muted uppercase", className)}>{children}</div>;
}

/** Kort lista med ikon per rad (prototypens arn-mini). */
export function MiniList({ items }: { items: { key: string; icon: IconName; children: ReactNode }[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {items.map((x) => (
        <li key={x.key} className="flex min-w-0 items-start gap-2">
          <Icon name={x.icon} className="mt-0.5" />
          <span className="min-w-0">{x.children}</span>
        </li>
      ))}
    </ul>
  );
}

/** Tid som "Mån 1 feb kl. 10.00" (kort) eller "Måndag 1 februari kl. 10.00". */
export const whenText = (s: string, short?: boolean) =>
  short ? `${cap(WEEKDAYS_SHORT[weekday(s)])} ${fmtDateShort(s)} kl. ${fmtTime(s)}` : `${cap(fmtWeekday(s))} kl. ${fmtTime(s)}`;

/** Tillfällen (moment, praktikdagar, möten) som en kort lista. */
export function ActList({ acts, empty, short }: { acts: readonly { id: string; kind: string; startsAt: string; location: string }[]; empty: string; short?: boolean }) {
  if (acts.length === 0) return <p className="text-small text-text-muted">{empty}</p>;
  return (
    <MiniList
      items={acts.map((a) => ({
        key: a.id,
        icon: actIcon(a.kind),
        children: (
          <>
            <span className="font-bold">{whenText(a.startsAt, short)}</span> · {actLabel(a.kind)}
            <span className="text-small text-text-muted"> · {a.location}</span>
          </>
        ),
      }))}
    />
  );
}

/** Närvarograd i en tabellcell (prototypens AttCell). */
export function AttCell({ st }: { st: AttendanceSummary }) {
  const reg = st.planned - st.unregistered;
  if (reg <= 0) return <span className="text-small text-text-muted">{st.unregistered > 0 ? `${st.unregistered} saknar registrering` : "Inga tillfällen"}</span>;
  return (
    <div>
      <span className="font-bold">{pct0(st.rate)}</span>
      <div className="text-small text-text-muted">
        {st.present + st.late} av {reg}
        {st.unregistered > 0 ? ` · ${st.unregistered} saknas` : ""}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Tabell som blir lista på smala kort
/** Listrad för smala kort: knapp om raden går att öppna, annars en vanlig rad. */
export function MItem({ onClick, children }: { onClick?: (() => void) | null; children: ReactNode }) {
  const cls = "flex w-full min-w-0 items-start gap-3 px-[18px] py-3 text-left max-[620px]:flex-wrap";
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, "cursor-pointer border-0 bg-transparent text-inherit [font:inherit] hover:bg-ljusgra-ton")}>
      {children}
    </button>
  ) : (
    <div className={cls}>{children}</div>
  );
}
export const LiMain = ({ children }: { children: ReactNode }) => <span className="flex min-w-0 flex-1 flex-col gap-[3px] max-[620px]:basis-[calc(100%-44px)]">{children}</span>;
export const LiTitle = ({ children }: { children: ReactNode }) => <span className="block font-bold">{children}</span>;
export const LiSub = ({ children }: { children: ReactNode }) => <span className="block text-small text-text-muted">{children}</span>;
export const LiSide = ({ children }: { children: ReactNode }) => (
  <span className="flex flex-none flex-col items-end gap-1 max-[620px]:w-full max-[620px]:flex-row max-[620px]:flex-wrap max-[620px]:justify-start">{children}</span>
);

/**
 * Tabell när kortet är brett, lista när kortet är smalt (container query) – ingen text utanför kortet på 400 px.
 * size "sm" byter vid 560 px kortbredd, annars vid 880 px.
 */
export function RespTable<R>({
  size = "lg",
  mobile,
  ...props
}: TableProps<R> & { size?: "sm" | "lg"; mobile: (row: R, click: (() => void) | null) => ReactNode }) {
  const keyOf = (r: R, i: number) => {
    const k = props.rowKey ?? ("id" as keyof R);
    return typeof k === "function" ? k(r) : String((r as Record<string, unknown>)[k as string] ?? i);
  };
  return (
    <div className="@container">
      <div className={size === "sm" ? "@max-[560px]:hidden" : "@max-[880px]:hidden"}>
        <Table {...props} className={cn("[&_th]:whitespace-normal [&_th]:align-bottom [&_td]:px-2 [&_th]:px-2 [&_td:first-child]:pl-4 [&_th:first-child]:pl-4", props.className)} />
      </div>
      <div className={cn("hidden", size === "sm" ? "@max-[560px]:block" : "@max-[880px]:block")}>
        {props.rows.length === 0 ? (
          <div className="px-[18px] py-4">
            <p className="text-small text-text-muted">{props.empty}</p>
          </div>
        ) : (
          <div role="list" aria-label={props.caption || "Lista"} className="flex flex-col [&>[role=listitem]+[role=listitem]]:border-t [&>[role=listitem]+[role=listitem]]:border-ljusgra">
            {props.rows.map((r, i) => (
              <div role="listitem" key={keyOf(r, i)} {...props.rowAttrs?.(r)}>
                {mobile(r, props.onRowClick ? () => props.onRowClick?.(r) : null)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Flikar
/** Laddning och fel för en flik. */
export function TabQuery<T>({
  q,
  children,
}: {
  q: { data: T | undefined; error: unknown; isLoading: boolean; isPlaceholderData?: boolean; refetch: () => unknown };
  children: (d: NonNullable<T>) => ReactNode;
}) {
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data === undefined) return <Loading />;
  if (q.data === null) return <Notice tone="info" title="Den delen visas inte för din roll" />;
  return <Refreshing busy={!!q.isPlaceholderData}>{children(q.data as NonNullable<T>)}</Refreshing>;
}


/** Sökväg till en sida för ärendet, t.ex. caseLink("/avstamning", id). */
export const caseLink = (base: string, caseId: string, query?: Record<string, string | null>) => path(`${base}/${encodeURIComponent(caseId)}`, query);

/** De fyra rätten som små märken ("Uppföljning saknas"). */
export function FourBadges({ rights, className }: { rights: Record<string, boolean> | null; className?: string }) {
  return (
    <div className={`flex flex-wrap gap-1 ${className ?? ""}`}>
      {FOUR.map(([key, label]) => {
        const ok = !rights || rights[key];
        return (
          <Badge key={key} tone={ok ? "bluetone" : "outline"} icon={ok ? "check" : "x"} className={cn("px-[7px] py-0.5", !ok && "[&_svg]:text-rod")}>
            {label}
            {ok ? "" : " saknas"}
          </Badge>
        );
      })}
    </div>
  );
}

/** RespTable där en rad kan leda till en annan sida. */
export function NavTable<R extends { id: string }>({
  to,
  mobile,
  ...props
}: Omit<Parameters<typeof RespTable<R>>[0], "onRowClick" | "mobile"> & { to: ((r: R) => string) | null; mobile: (r: R) => ReactNode }) {
  const nav = useNav();
  return (
    <RespTable<R>
      {...props}
      onRowClick={to ? (r) => nav.push(to(r)) : undefined}
      mobile={(r, click) => <MItem onClick={click}>{mobile(r)}</MItem>}
    />
  );
}

/** Fyra nyckeltal i rad (två kolumner på smal skärm). */
export function KpiRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-4 max-[620px]:grid-cols-2 max-[620px]:gap-2.5 max-[620px]:[&>div]:p-3 max-[620px]:[&>div>div:nth-child(2)]:text-[1.5rem]">
      {children}
    </div>
  );
}

